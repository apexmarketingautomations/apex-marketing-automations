/**
 * Server-side data migrations that run on every boot.
 *
 * These are idempotent SQL fixes that must be applied BEFORE drizzle-kit
 * synchronizes the schema (e.g. when a new uniqueness constraint requires
 * existing duplicate rows to be cleaned up first).
 *
 * Each migration is wrapped in its own transaction with an advisory lock,
 * so concurrent server instances will not race. Already-applied migrations
 * are skipped via the `_data_migrations` tracking table.
 *
 * The same SQL is also available as files in `scripts/migrations/` for the
 * standalone runner (`scripts/run-data-migrations.ts`); the embedded copy
 * here is what runs in production where the bundled server cannot read
 * those files from disk.
 */

import { sql } from "drizzle-orm";
import { db } from "./db";

interface DataMigration {
  name: string;
  sql: string;
}

const ADVISORY_LOCK_KEY = 7421430021;

const MIGRATIONS: DataMigration[] = [
  {
    name: "2026-04-25-dedupe-apex-module-coverage",
    sql: `
      LOCK TABLE apex_module_coverage IN SHARE ROW EXCLUSIVE MODE;

      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY account_id, module_group
                 ORDER BY updated_at DESC NULLS LAST, id DESC
               ) AS rn
        FROM apex_module_coverage
      )
      DELETE FROM apex_module_coverage
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

      CREATE UNIQUE INDEX IF NOT EXISTS amc_lookup
        ON apex_module_coverage (account_id, module_group);
    `,
  },
  {
    name: "2026-05-13-standalone-card-leads",
    sql: `
      CREATE TABLE IF NOT EXISTS standalone_card_leads (
        id          SERIAL PRIMARY KEY,
        card_id     INTEGER NOT NULL REFERENCES standalone_cards(id) ON DELETE CASCADE,
        name        TEXT    NOT NULL,
        phone       TEXT,
        email       TEXT,
        message     TEXT,
        owner_notes TEXT,
        created_at  TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scl_card_id    ON standalone_card_leads (card_id);
      CREATE INDEX IF NOT EXISTS idx_scl_created_at ON standalone_card_leads (created_at DESC);
    `,
  },
  {
    name: "2026-05-13-standalone-card-leads-owner-notes",
    sql: `
      ALTER TABLE standalone_card_leads
        ADD COLUMN IF NOT EXISTS owner_notes TEXT;
    `,
  },
  {
    name: "2026-05-13-standalone-card-services",
    sql: `
      ALTER TABLE standalone_cards
        ADD COLUMN IF NOT EXISTS services JSONB DEFAULT '[]'::jsonb;
    `,
  },
  {
    name: "2026-05-14-contact-lifecycle-fields",
    sql: `
      -- Phase 5: Contact lifecycle + skip-trace structured status columns
      -- All additive-only — safe to run on live tables

      ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS identity_status       TEXT NOT NULL DEFAULT 'unidentified',
        ADD COLUMN IF NOT EXISTS skip_trace_status     TEXT NOT NULL DEFAULT 'not_attempted',
        ADD COLUMN IF NOT EXISTS enrichment_provider   TEXT,
        ADD COLUMN IF NOT EXISTS enrichment_attempted_at   TIMESTAMP,
        ADD COLUMN IF NOT EXISTS enrichment_completed_at   TIMESTAMP,
        ADD COLUMN IF NOT EXISTS enrichment_confidence REAL,
        ADD COLUMN IF NOT EXISTS source_external_id    TEXT,
        ADD COLUMN IF NOT EXISTS raw_source_type       TEXT,
        ADD COLUMN IF NOT EXISTS lead_vertical         TEXT,
        ADD COLUMN IF NOT EXISTS lead_subtype          TEXT,
        ADD COLUMN IF NOT EXISTS normalized_phone      TEXT,
        ADD COLUMN IF NOT EXISTS normalized_email      TEXT,
        ADD COLUMN IF NOT EXISTS county                TEXT,
        ADD COLUMN IF NOT EXISTS contact_quality_score REAL;

      -- Indexes for efficient filtering on the new status fields
      CREATE INDEX IF NOT EXISTS idx_contacts_sub_skip_status
        ON contacts (sub_account_id, skip_trace_status);

      CREATE INDEX IF NOT EXISTS idx_contacts_sub_identity_status
        ON contacts (sub_account_id, identity_status);

      CREATE INDEX IF NOT EXISTS idx_contacts_source_external_id
        ON contacts (sub_account_id, source_external_id)
        WHERE source_external_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_contacts_normalized_phone
        ON contacts (sub_account_id, normalized_phone)
        WHERE normalized_phone IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_contacts_lead_vertical
        ON contacts (sub_account_id, lead_vertical)
        WHERE lead_vertical IS NOT NULL;

      -- Backfill: any contact that already has the "skip-traced" tag gets
      -- its skip_trace_status set to 'attempted' so existing data is valid.
      -- Contacts with "has-phone" after skip-trace become 'matched';
      -- contacts with "no-phone" after skip-trace become 'no_match'.
      UPDATE contacts
      SET skip_trace_status = CASE
            WHEN 'skip-traced' = ANY(tags) AND 'has-phone' = ANY(tags) THEN 'matched'
            WHEN 'skip-traced' = ANY(tags) AND 'no-phone'  = ANY(tags) THEN 'no_match'
            WHEN 'skip-traced' = ANY(tags) THEN 'attempted'
            ELSE 'not_attempted'
          END
      WHERE skip_trace_status = 'not_attempted';

      -- Backfill identity_status: contacts with a real phone or real email
      -- (and not a placeholder first_name) are marked 'verified'.
      UPDATE contacts
      SET identity_status = 'verified'
      WHERE (phone IS NOT NULL AND phone != '')
         OR (email IS NOT NULL AND email != '')
      AND first_name NOT LIKE 'Crash Lead%'
      AND first_name NOT LIKE 'Unidentified%'
      AND identity_status = 'unidentified';

      -- Backfill normalized_phone from existing phone values (digits only)
      UPDATE contacts
      SET normalized_phone = regexp_replace(phone, '[^0-9]', '', 'g')
      WHERE phone IS NOT NULL
        AND phone != ''
        AND normalized_phone IS NULL;
    `,
  },
  {
    name: "2026-05-14-users-role-column",
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'member';
    `,
  },
  {
    name: "2026-05-14-stage3-operational-tables",
    sql: `
      CREATE EXTENSION IF NOT EXISTS vector;

      -- Group A: no external FK dependencies
      CREATE TABLE IF NOT EXISTS account_tier_history (
        id BIGSERIAL PRIMARY KEY,
        sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id) ON DELETE CASCADE,
        changed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        previous_tier VARCHAR(50),
        new_tier VARCHAR(50) NOT NULL,
        reason TEXT,
        effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        target_type VARCHAR(100),
        target_id TEXT,
        metadata JSONB,
        ip_address VARCHAR(50),
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id BIGSERIAL PRIMARY KEY,
        sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        key_hash VARCHAR(64) NOT NULL UNIQUE,
        key_prefix VARCHAR(12) NOT NULL,
        name VARCHAR(200) NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        last_used_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS agent_outcome_log (
        id BIGSERIAL PRIMARY KEY,
        agent_id INTEGER,
        task_id TEXT,
        pipeline VARCHAR(100) NOT NULL,
        outcome VARCHAR(50) NOT NULL,
        contact_id INTEGER,
        sub_account_id INTEGER,
        payload JSONB,
        duration_ms INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS twilio_account_registry (
        id BIGSERIAL PRIMARY KEY,
        sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id) ON DELETE CASCADE,
        twilio_account_sid VARCHAR(34) NOT NULL UNIQUE,
        twilio_auth_token_encrypted TEXT,
        friendly_name VARCHAR(200),
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        phone_numbers TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS embedding_store (
        id BIGSERIAL PRIMARY KEY,
        source_type VARCHAR(100) NOT NULL,
        source_id TEXT NOT NULL,
        content_hash VARCHAR(64) NOT NULL,
        content_preview TEXT,
        embedding vector(1536) NOT NULL,
        model VARCHAR(100) NOT NULL DEFAULT 'text-embedding-3-small',
        dimensions INTEGER NOT NULL DEFAULT 1536,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(source_type, source_id, model)
      );

      -- Group B: FK to verified existing tables
      CREATE TABLE IF NOT EXISTS contact_ai_profiles (
        id BIGSERIAL PRIMARY KEY,
        contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        summary TEXT,
        intent_signals TEXT[],
        predicted_intent VARCHAR(100),
        intent_confidence NUMERIC(4,3),
        lifecycle_stage VARCHAR(50),
        last_enriched_at TIMESTAMPTZ,
        embedding vector(1536),
        embedding_model VARCHAR(100),
        embedding_updated_at TIMESTAMPTZ,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(contact_id)
      );

      CREATE TABLE IF NOT EXISTS contact_merge_log (
        id BIGSERIAL PRIMARY KEY,
        primary_contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        merged_contact_id INTEGER NOT NULL,
        merged_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        merge_reason VARCHAR(100),
        confidence NUMERIC(4,3),
        field_snapshot JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS enrichment_provider_log (
        id BIGSERIAL PRIMARY KEY,
        contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        provider VARCHAR(100) NOT NULL,
        attempt_type VARCHAR(100),
        status VARCHAR(50) NOT NULL,
        fields_returned TEXT[],
        cost_units NUMERIC(10,4),
        raw_response JSONB,
        error_message TEXT,
        duration_ms INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS message_delivery_log (
        id BIGSERIAL PRIMARY KEY,
        message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
        channel VARCHAR(50) NOT NULL,
        provider VARCHAR(100),
        provider_message_id TEXT,
        status VARCHAR(50) NOT NULL,
        status_detail TEXT,
        delivered_at TIMESTAMPTZ,
        opened_at TIMESTAMPTZ,
        clicked_at TIMESTAMPTZ,
        failed_at TIMESTAMPTZ,
        error_code VARCHAR(50),
        error_message TEXT,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sentinel_actions (
        id BIGSERIAL PRIMARY KEY,
        incident_id INTEGER NOT NULL REFERENCES sentinel_incidents(id) ON DELETE CASCADE,
        action_type VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        payload JSONB,
        result JSONB,
        error TEXT,
        triggered_by VARCHAR(100),
        executed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sentinel_incident_ai_triage (
        id BIGSERIAL PRIMARY KEY,
        incident_id INTEGER NOT NULL REFERENCES sentinel_incidents(id) ON DELETE CASCADE,
        triage_score NUMERIC(4,3),
        severity VARCHAR(50),
        confidence NUMERIC(4,3),
        recommended_action TEXT,
        reasoning TEXT,
        signals JSONB,
        model VARCHAR(100),
        triaged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(incident_id)
      );

      CREATE TABLE IF NOT EXISTS legal_lead_delivery_log (
        id BIGSERIAL PRIMARY KEY,
        legal_lead_id INTEGER NOT NULL REFERENCES legal_leads(id) ON DELETE CASCADE,
        attorney_id INTEGER REFERENCES legal_attorneys(id) ON DELETE SET NULL,
        delivery_channel VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL,
        delivered_at TIMESTAMPTZ,
        accepted_at TIMESTAMPTZ,
        rejected_at TIMESTAMPTZ,
        rejection_reason TEXT,
        price_cents INTEGER,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS home_service_signal_scores (
        id BIGSERIAL PRIMARY KEY,
        signal_id INTEGER NOT NULL REFERENCES home_service_signals(id) ON DELETE CASCADE,
        score NUMERIC(5,4) NOT NULL,
        score_version VARCHAR(50),
        signals_used JSONB,
        model VARCHAR(100),
        scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(signal_id)
      );

      CREATE TABLE IF NOT EXISTS legal_case_ai_summary (
        id BIGSERIAL PRIMARY KEY,
        intelligence_case_id INTEGER NOT NULL REFERENCES intelligence_cases(id) ON DELETE CASCADE,
        summary TEXT,
        key_facts TEXT[],
        recommended_actions TEXT[],
        risk_level VARCHAR(50),
        confidence NUMERIC(4,3),
        embedding vector(1536),
        embedding_model VARCHAR(100),
        embedding_updated_at TIMESTAMPTZ,
        model VARCHAR(100),
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(intelligence_case_id)
      );

      CREATE TABLE IF NOT EXISTS workflow_ai_suggestions (
        id BIGSERIAL PRIMARY KEY,
        workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        suggestion_type VARCHAR(100) NOT NULL,
        suggestion TEXT NOT NULL,
        reasoning TEXT,
        confidence NUMERIC(4,3),
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        applied_at TIMESTAMPTZ,
        dismissed_at TIMESTAMPTZ,
        model VARCHAR(100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS brain_learning_feedback (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        event_id BIGINT REFERENCES universal_events(id) ON DELETE SET NULL,
        feedback_type VARCHAR(100) NOT NULL,
        signal VARCHAR(100) NOT NULL,
        context JSONB,
        weight NUMERIC(5,4) NOT NULL DEFAULT 1.0,
        processed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Group C: plain INTEGER (parent tables not yet created)
      CREATE TABLE IF NOT EXISTS agent_performance_metrics (
        id BIGSERIAL PRIMARY KEY,
        agent_id INTEGER NOT NULL,
        metric_date DATE NOT NULL,
        tasks_completed INTEGER NOT NULL DEFAULT 0,
        tasks_failed INTEGER NOT NULL DEFAULT 0,
        avg_duration_ms NUMERIC(12,2),
        p95_duration_ms NUMERIC(12,2),
        outcomes JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(agent_id, metric_date)
      );

      CREATE TABLE IF NOT EXISTS funnel_analytics (
        id BIGSERIAL PRIMARY KEY,
        campaign_id INTEGER,
        website_id INTEGER,
        entry_page_id INTEGER,
        exit_page_id INTEGER,
        sub_account_id INTEGER,
        date DATE NOT NULL,
        sessions INTEGER NOT NULL DEFAULT 0,
        leads INTEGER NOT NULL DEFAULT 0,
        conversions INTEGER NOT NULL DEFAULT 0,
        conversion_rate NUMERIC(6,4),
        avg_time_on_site_seconds INTEGER,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ad_performance_ai_insights (
        id BIGSERIAL PRIMARY KEY,
        campaign_id INTEGER,
        recommendation_id INTEGER,
        insight_type VARCHAR(100) NOT NULL,
        insight TEXT NOT NULL,
        metric_snapshot JSONB,
        confidence JSONB,
        impact_estimate TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        applied_at TIMESTAMPTZ,
        model VARCHAR(100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS distribution_performance (
        id BIGSERIAL PRIMARY KEY,
        buyer_id INTEGER NOT NULL,
        sub_account_id INTEGER,
        metric_date DATE NOT NULL,
        leads_sent INTEGER NOT NULL DEFAULT 0,
        leads_accepted INTEGER NOT NULL DEFAULT 0,
        leads_rejected INTEGER NOT NULL DEFAULT 0,
        acceptance_rate NUMERIC(6,4),
        avg_response_time_seconds NUMERIC(10,2),
        revenue_cents BIGINT NOT NULL DEFAULT 0,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(buyer_id, metric_date)
      );

      -- HNSW index on embedding_store (works on empty table, no training data needed)
      CREATE INDEX IF NOT EXISTS embedding_store_hnsw_cosine_idx
        ON embedding_store
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);

      -- Supporting B-tree indexes
      CREATE INDEX IF NOT EXISTS embedding_store_source_idx ON embedding_store(source_type, source_id);
      CREATE INDEX IF NOT EXISTS embedding_store_created_at_idx ON embedding_store(created_at DESC);
      CREATE INDEX IF NOT EXISTS agent_outcome_log_pipeline_idx ON agent_outcome_log(pipeline, created_at DESC);
      CREATE INDEX IF NOT EXISTS agent_outcome_log_contact_idx ON agent_outcome_log(contact_id) WHERE contact_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS enrichment_provider_log_contact_idx ON enrichment_provider_log(contact_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS enrichment_provider_log_provider_idx ON enrichment_provider_log(provider, status);
      CREATE INDEX IF NOT EXISTS sentinel_actions_incident_idx ON sentinel_actions(incident_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS admin_audit_log_user_idx ON admin_audit_log(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx ON admin_audit_log(action, created_at DESC);
      CREATE INDEX IF NOT EXISTS brain_learning_feedback_signal_idx ON brain_learning_feedback(signal, created_at DESC);
      CREATE INDEX IF NOT EXISTS message_delivery_log_status_idx ON message_delivery_log(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS legal_lead_delivery_log_status_idx ON legal_lead_delivery_log(status, created_at DESC);
    `,
  },
  {
    name: "2026-05-15-contact-routing-fields",
    sql: `
      -- Step 1: Add routing columns to contacts
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source_pipeline TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_type TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS route_rule_id INTEGER;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS route_reason TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS export_eligible BOOLEAN NOT NULL DEFAULT false;

      -- Step 2: Indexes on new contact columns
      CREATE INDEX IF NOT EXISTS idx_contacts_source_pipeline ON contacts(source_pipeline);
      CREATE INDEX IF NOT EXISTS idx_contacts_lead_type ON contacts(lead_type);
      CREATE INDEX IF NOT EXISTS idx_contacts_export_eligible ON contacts(sub_account_id, export_eligible);

      -- Step 3: Routing rules table (matches actual live schema — richer columns)
      CREATE TABLE IF NOT EXISTS contact_routing_rules (
        id SERIAL PRIMARY KEY,
        rule_name TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        match_source_pipeline TEXT,
        match_lead_type TEXT,
        match_lead_vertical TEXT,
        match_county TEXT,
        match_niche TEXT,
        target_sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id),
        description TEXT,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_routing_rules_pipeline_type ON contact_routing_rules(match_source_pipeline, match_lead_type);

      -- Step 4: Routing audit table
      CREATE TABLE IF NOT EXISTS contact_routing_audit (
        id BIGSERIAL PRIMARY KEY,
        contact_id INTEGER NOT NULL REFERENCES contacts(id),
        source_pipeline TEXT,
        source_record_id TEXT,
        matched_rule_id INTEGER,
        assigned_sub_account_id INTEGER,
        reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_routing_audit_contact_id ON contact_routing_audit(contact_id);
      CREATE INDEX IF NOT EXISTS idx_routing_audit_created_at ON contact_routing_audit(created_at);

      -- Step 5: Seed routing rules (idempotent — table may already have rows from prior session)
      INSERT INTO contact_routing_rules (rule_name, match_source_pipeline, match_lead_type, target_sub_account_id, priority, description, active)
      SELECT 'crash-ingest → APEX parent', 'crash_ingest', 'individual', id, 10, 'Real crash victims ingest to APEX master account', true
      FROM sub_accounts WHERE id = 3 LIMIT 1
      ON CONFLICT DO NOTHING;

      INSERT INTO contact_routing_rules (rule_name, match_source_pipeline, match_lead_type, target_sub_account_id, priority, description, active)
      SELECT 'crash-ingest placeholder', 'crash_ingest', 'placeholder', id, 5, 'Unidentified crash placeholders stay in APEX master only', true
      FROM sub_accounts WHERE id = 3 LIMIT 1
      ON CONFLICT DO NOTHING;

      INSERT INTO contact_routing_rules (rule_name, match_source_pipeline, match_lead_type, target_sub_account_id, priority, description, active)
      SELECT 'legal individual → APEX parent', 'legal_signal', 'individual', id, 10, 'Real individual legal leads route to APEX master', true
      FROM sub_accounts WHERE id = 3 LIMIT 1
      ON CONFLICT DO NOTHING;

      -- Step 6: Backfill source_pipeline from existing source values
      UPDATE contacts SET source_pipeline = 'sentinel_crash'     WHERE source = 'sentinel_crash'    AND source_pipeline IS NULL;
      UPDATE contacts SET source_pipeline = 'legal_pipeline'     WHERE source = 'legal_pipeline'    AND source_pipeline IS NULL;
      UPDATE contacts SET source_pipeline = 'jail_booking'       WHERE source = 'jail_booking'      AND source_pipeline IS NULL;
      UPDATE contacts SET source_pipeline = 'home_services'      WHERE source = 'home_services'     AND source_pipeline IS NULL;
      UPDATE contacts SET source_pipeline = 'hillsborough_pipeline' WHERE (source IS NULL OR source NOT IN ('sentinel_crash','legal_pipeline','jail_booking','home_services','apify_scrape','meta_lead','manual','form_submission','import')) AND source_pipeline IS NULL AND county IS NOT NULL;
      UPDATE contacts SET source_pipeline = COALESCE(source, 'manual') WHERE source_pipeline IS NULL;

      -- Step 7: Backfill lead_type
      -- Placeholders: crash incident marker names
      UPDATE contacts SET lead_type = 'placeholder'
      WHERE lead_type IS NULL
        AND (first_name ILIKE 'Unidentified Crash Incident%' OR first_name ILIKE 'Crash Lead%' OR first_name ILIKE 'Vehicle Crash%' OR first_name ILIKE 'Incident Lead%');

      -- Recall/OSHA/business entities
      UPDATE contacts SET lead_type = 'recall_entity'
      WHERE lead_type IS NULL AND tags @> ARRAY['recall']::text[];

      UPDATE contacts SET lead_type = 'osha_entity'
      WHERE lead_type IS NULL AND tags @> ARRAY['osha']::text[];

      UPDATE contacts SET lead_type = 'local_business'
      WHERE lead_type IS NULL AND (source IN ('apify_scrape') OR company IS NOT NULL AND first_name IS NULL);

      -- Attorneys
      UPDATE contacts SET lead_type = 'attorney'
      WHERE lead_type IS NULL AND (source = 'legal_pipeline' AND tags @> ARRAY['attorney']::text[]);

      -- Everything else with a real first name is an individual
      UPDATE contacts SET lead_type = 'individual'
      WHERE lead_type IS NULL AND first_name IS NOT NULL AND first_name <> '';

      -- Catch-all for remaining nulls
      UPDATE contacts SET lead_type = 'individual' WHERE lead_type IS NULL;

      -- Step 8: Backfill export_eligible
      -- Individuals with a real non-placeholder name AND (phone OR email) → true
      UPDATE contacts SET export_eligible = true
      WHERE lead_type = 'individual'
        AND first_name IS NOT NULL AND first_name <> ''
        AND first_name NOT ILIKE 'Unidentified%'
        AND first_name NOT ILIKE 'Crash Lead%'
        AND first_name NOT ILIKE 'Vehicle Crash%'
        AND first_name NOT ILIKE 'Incident Lead%'
        AND first_name NOT ILIKE 'Unknown%'
        AND first_name NOT ILIKE 'Legal Lead%'
        AND first_name NOT ILIKE 'Booking Lead%'
        AND (
          (phone IS NOT NULL AND phone <> '' AND regexp_replace(phone, '[^0-9]', '', 'g') <> '' AND length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 7)
          OR
          (email IS NOT NULL AND email LIKE '%@%' AND length(email) >= 5)
        );

      -- Ensure empty first_name individuals are never export_eligible
      UPDATE contacts SET export_eligible = false
      WHERE lead_type = 'individual'
        AND (first_name IS NULL OR first_name = '')
        AND export_eligible = true;
    `,
  },
  {
    name: "2026-05-15-stage3-recovery-and-skip-trace-observability",
    sql: `
      -- Stage 3 table recovery (idempotent IF NOT EXISTS — tables may already exist)
      CREATE EXTENSION IF NOT EXISTS vector;

      CREATE TABLE IF NOT EXISTS account_tier_history (
        id BIGSERIAL PRIMARY KEY,
        sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id) ON DELETE CASCADE,
        changed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        previous_tier VARCHAR(50), new_tier VARCHAR(50) NOT NULL,
        reason TEXT, effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id BIGSERIAL PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL, target_type VARCHAR(100), target_id TEXT,
        metadata JSONB, ip_address VARCHAR(50), user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id BIGSERIAL PRIMARY KEY,
        sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id) ON DELETE CASCADE,
        created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        key_hash VARCHAR(64) NOT NULL UNIQUE, key_prefix VARCHAR(12) NOT NULL,
        label VARCHAR(100), scopes TEXT[] NOT NULL DEFAULT '{}',
        last_used_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS agent_outcome_log (
        id BIGSERIAL PRIMARY KEY, pipeline VARCHAR(100) NOT NULL,
        agent_name VARCHAR(100), contact_id INTEGER, outcome VARCHAR(50) NOT NULL,
        detail JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS twilio_account_registry (
        id BIGSERIAL PRIMARY KEY,
        sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id) ON DELETE CASCADE,
        twilio_account_sid VARCHAR(34) NOT NULL UNIQUE, twilio_auth_token TEXT,
        friendly_name VARCHAR(100), phone_numbers TEXT[] DEFAULT '{}',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS embedding_store (
        id BIGSERIAL PRIMARY KEY, source_type VARCHAR(100) NOT NULL, source_id TEXT NOT NULL,
        content_hash VARCHAR(64) NOT NULL, content_preview TEXT,
        embedding vector(1536) NOT NULL, model VARCHAR(100) NOT NULL DEFAULT 'text-embedding-3-small',
        dimensions INTEGER NOT NULL DEFAULT 1536, metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(source_type, source_id, model)
      );
      CREATE TABLE IF NOT EXISTS contact_ai_profiles (
        id BIGSERIAL PRIMARY KEY, contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        summary TEXT, intent_signals TEXT[], predicted_intent VARCHAR(100),
        intent_confidence NUMERIC(4,3), lifecycle_stage VARCHAR(50), last_enriched_at TIMESTAMPTZ,
        embedding vector(1536), embedding_model VARCHAR(100), embedding_updated_at TIMESTAMPTZ,
        metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(contact_id)
      );
      CREATE TABLE IF NOT EXISTS contact_merge_log (
        id BIGSERIAL PRIMARY KEY,
        primary_contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        merged_contact_id INTEGER NOT NULL,
        merged_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        merge_reason TEXT, field_overwrites JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS enrichment_provider_log (
        id BIGSERIAL PRIMARY KEY, contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        provider VARCHAR(100) NOT NULL, request_type VARCHAR(100), status VARCHAR(50) NOT NULL,
        credits_used INTEGER DEFAULT 0, response_summary JSONB, error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS message_delivery_log (
        id BIGSERIAL PRIMARY KEY, message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        channel VARCHAR(50) NOT NULL, status VARCHAR(50) NOT NULL, provider_message_id TEXT,
        provider_response JSONB, error_code TEXT, error_message TEXT, delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sentinel_actions (
        id BIGSERIAL PRIMARY KEY, incident_id INTEGER NOT NULL REFERENCES sentinel_incidents(id) ON DELETE CASCADE,
        action_type VARCHAR(100) NOT NULL, performed_by VARCHAR(100),
        status VARCHAR(50) NOT NULL DEFAULT 'pending', result JSONB, error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS sentinel_incident_ai_triage (
        id BIGSERIAL PRIMARY KEY, incident_id INTEGER NOT NULL REFERENCES sentinel_incidents(id) ON DELETE CASCADE,
        severity_score NUMERIC(4,3), injury_probability NUMERIC(4,3),
        fatality_flag BOOLEAN DEFAULT false, recommended_action TEXT, triage_notes TEXT,
        model VARCHAR(100), triaged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(incident_id)
      );
      CREATE TABLE IF NOT EXISTS legal_lead_delivery_log (
        id BIGSERIAL PRIMARY KEY, legal_lead_id INTEGER NOT NULL REFERENCES legal_leads(id) ON DELETE CASCADE,
        attorney_id INTEGER REFERENCES legal_attorneys(id) ON DELETE SET NULL,
        delivery_method VARCHAR(50), status VARCHAR(50) NOT NULL, delivered_at TIMESTAMPTZ,
        response_received_at TIMESTAMPTZ, response_type VARCHAR(50), notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS home_service_signal_scores (
        id BIGSERIAL PRIMARY KEY, signal_id INTEGER NOT NULL REFERENCES home_service_signals(id) ON DELETE CASCADE,
        urgency_score NUMERIC(4,3), conversion_probability NUMERIC(4,3),
        recommended_contractor_tier VARCHAR(50), scoring_model VARCHAR(100),
        scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(signal_id)
      );
      CREATE TABLE IF NOT EXISTS legal_case_ai_summary (
        id BIGSERIAL PRIMARY KEY, intelligence_case_id INTEGER NOT NULL REFERENCES intelligence_cases(id) ON DELETE CASCADE,
        summary TEXT, key_facts TEXT[], recommended_actions TEXT[], risk_level VARCHAR(50),
        confidence NUMERIC(4,3), embedding vector(1536), embedding_model VARCHAR(100),
        embedding_updated_at TIMESTAMPTZ, model VARCHAR(100),
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(intelligence_case_id)
      );
      CREATE TABLE IF NOT EXISTS workflow_ai_suggestions (
        id BIGSERIAL PRIMARY KEY, workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        suggestion_type VARCHAR(100) NOT NULL, suggestion_text TEXT NOT NULL,
        confidence NUMERIC(4,3), accepted BOOLEAN, accepted_at TIMESTAMPTZ,
        model VARCHAR(100), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS brain_learning_feedback (
        id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        signal VARCHAR(100) NOT NULL, context JSONB, feedback_value NUMERIC(4,3),
        source_event_id INTEGER REFERENCES universal_events(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS agent_performance_metrics (
        id BIGSERIAL PRIMARY KEY, agent_id INTEGER NOT NULL, metric_type VARCHAR(100) NOT NULL,
        metric_value NUMERIC(10,4), period_start TIMESTAMPTZ, period_end TIMESTAMPTZ,
        metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS funnel_analytics (
        id BIGSERIAL PRIMARY KEY, campaign_id INTEGER, website_id INTEGER,
        entry_page_id INTEGER, exit_page_id INTEGER, session_id TEXT,
        steps_completed INTEGER DEFAULT 0, converted BOOLEAN DEFAULT false,
        conversion_value NUMERIC(10,2), time_to_convert_seconds INTEGER,
        metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ad_performance_ai_insights (
        id BIGSERIAL PRIMARY KEY, campaign_id INTEGER, recommendation_id INTEGER,
        insight_type VARCHAR(100) NOT NULL, insight_text TEXT NOT NULL,
        predicted_impact NUMERIC(4,3), model VARCHAR(100), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS distribution_performance (
        id BIGSERIAL PRIMARY KEY, buyer_id INTEGER NOT NULL, lead_type VARCHAR(100),
        total_delivered INTEGER DEFAULT 0, total_accepted INTEGER DEFAULT 0,
        total_rejected INTEGER DEFAULT 0, acceptance_rate NUMERIC(5,4),
        avg_response_seconds INTEGER, period_start TIMESTAMPTZ, period_end TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Stage 3 indexes
      CREATE INDEX IF NOT EXISTS embedding_store_hnsw_cosine_idx ON embedding_store USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
      CREATE INDEX IF NOT EXISTS embedding_store_source_idx ON embedding_store(source_type, source_id);
      CREATE INDEX IF NOT EXISTS embedding_store_created_at_idx ON embedding_store(created_at DESC);
      CREATE INDEX IF NOT EXISTS agent_outcome_log_pipeline_idx ON agent_outcome_log(pipeline, created_at DESC);
      CREATE INDEX IF NOT EXISTS agent_outcome_log_contact_idx ON agent_outcome_log(contact_id) WHERE contact_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS enrichment_provider_log_contact_idx ON enrichment_provider_log(contact_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS enrichment_provider_log_provider_idx ON enrichment_provider_log(provider, status);
      CREATE INDEX IF NOT EXISTS sentinel_actions_incident_idx ON sentinel_actions(incident_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS admin_audit_log_user_idx ON admin_audit_log(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx ON admin_audit_log(action, created_at DESC);
      CREATE INDEX IF NOT EXISTS brain_learning_feedback_signal_idx ON brain_learning_feedback(signal, created_at DESC);
      CREATE INDEX IF NOT EXISTS message_delivery_log_status_idx ON message_delivery_log(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS legal_lead_delivery_log_status_idx ON legal_lead_delivery_log(status, created_at DESC);

      -- Skip trace observability tables (Stage 3.5)
      CREATE TABLE IF NOT EXISTS skip_trace_requests (
        id BIGSERIAL PRIMARY KEY,
        contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        triggered_by TEXT NOT NULL, trigger_type VARCHAR(50) NOT NULL DEFAULT 'manual',
        provider VARCHAR(50) NOT NULL DEFAULT 'batchdata',
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        input_address TEXT, input_name TEXT, phone_found TEXT, email_found TEXT,
        phones_total INTEGER DEFAULT 0, emails_total INTEGER DEFAULT 0,
        credits_used INTEGER DEFAULT 1, error_code VARCHAR(100), error_message TEXT,
        provider_request_id TEXT, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_skip_trace_requests_contact ON skip_trace_requests(contact_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_skip_trace_requests_status ON skip_trace_requests(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_skip_trace_requests_trigger ON skip_trace_requests(trigger_type, created_at DESC);

      CREATE TABLE IF NOT EXISTS contact_enrichment_events (
        id BIGSERIAL PRIMARY KEY,
        contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        event_type VARCHAR(100) NOT NULL, previous_value JSONB, new_value JSONB,
        source VARCHAR(100), provider VARCHAR(50),
        skip_trace_request_id BIGINT REFERENCES skip_trace_requests(id) ON DELETE SET NULL,
        performed_by TEXT, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_enrichment_events_contact ON contact_enrichment_events(contact_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_enrichment_events_type ON contact_enrichment_events(event_type, created_at DESC);
    `,
  },
  {
    name: "2026-05-15-crash-reports-official-number",
    sql: `
      -- Add the official FLHSMV-issued accident report number as a first-class column.
      -- The existing report_number column is a synthetic dedup hash and must never
      -- be shown to users as the real accident report number.
      ALTER TABLE crash_reports
        ADD COLUMN IF NOT EXISTS official_report_number TEXT;

      CREATE INDEX IF NOT EXISTS idx_crash_reports_official_number
        ON crash_reports (official_report_number)
        WHERE official_report_number IS NOT NULL;

      -- Backfill path 1: sentinel parents enriched via follow-up worker
      -- (data->officialFlhsmv->reportNumber)
      UPDATE crash_reports
        SET official_report_number = data->'officialFlhsmv'->>'reportNumber'
        WHERE official_report_number IS NULL
          AND data->'officialFlhsmv'->>'reportNumber' IS NOT NULL
          AND data->'officialFlhsmv'->>'reportNumber' <> '';

      -- Backfill path 2: direct FLHSMV fetch (data->searchResult->ReportNumber)
      UPDATE crash_reports
        SET official_report_number = data->'searchResult'->>'ReportNumber'
        WHERE official_report_number IS NULL
          AND source NOT IN ('sentinel_auto', 'sentinel_followup')
          AND status = 'COMPLETED'
          AND data->'searchResult'->>'ReportNumber' IS NOT NULL
          AND data->'searchResult'->>'ReportNumber' <> '';

      -- Backfill path 3: discovered_report_number on completed follow-up jobs
      UPDATE crash_reports
        SET official_report_number = data->>'discoveredReportNumber'
        WHERE official_report_number IS NULL
          AND source = 'sentinel_followup'
          AND status = 'COMPLETED'
          AND data->>'discoveredReportNumber' IS NOT NULL
          AND data->>'discoveredReportNumber' <> '';
    `,
  },
  {
    name: "2026-05-15-contacts-flhsmv-enriched-tag",
    sql: `
      -- Add driver_address column to contacts so the FLHSMV home address
      -- (from which skip-trace is run) is stored separately from the crash
      -- scene address already in the address column.
      ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS driver_address TEXT;

      -- Index for contacts awaiting FLHSMV-sourced skip-trace
      CREATE INDEX IF NOT EXISTS idx_contacts_flhsmv_pending
        ON contacts (sub_account_id, skip_trace_status)
        WHERE skip_trace_status IN ('not_attempted', 'no_match')
          AND lead_subtype = 'crash';
    `,
  },
  {
    name: "2026-05-16-phase-4b-multi-vertical-intelligence",
    sql: `
      -- ── Phase 4B: Multi-Vertical Intelligence Infrastructure ──────────────────
      -- Adds: view_class, workflow_stage, incident_fingerprint, territory_id,
      --       is_placeholder on contacts; new territories, incidents,
      --       incident_contacts, opportunities, contact_scores tables.

      -- 1. Contacts — Phase 4B columns
      ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS view_class          TEXT NOT NULL DEFAULT 'placeholder',
        ADD COLUMN IF NOT EXISTS workflow_stage      TEXT NOT NULL DEFAULT 'new',
        ADD COLUMN IF NOT EXISTS incident_fingerprint TEXT,
        ADD COLUMN IF NOT EXISTS territory_id        INTEGER,
        ADD COLUMN IF NOT EXISTS is_placeholder      BOOLEAN NOT NULL DEFAULT true;

      CREATE INDEX IF NOT EXISTS idx_contacts_view_class
        ON contacts (sub_account_id, view_class);
      CREATE INDEX IF NOT EXISTS idx_contacts_workflow_stage
        ON contacts (sub_account_id, workflow_stage);
      CREATE INDEX IF NOT EXISTS idx_contacts_is_placeholder
        ON contacts (sub_account_id, is_placeholder);
      CREATE INDEX IF NOT EXISTS idx_contacts_incident_fingerprint
        ON contacts (incident_fingerprint)
        WHERE incident_fingerprint IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_contacts_territory
        ON contacts (territory_id)
        WHERE territory_id IS NOT NULL;

      -- 2. Territories table
      CREATE TABLE IF NOT EXISTS territories (
        id              SERIAL PRIMARY KEY,
        sub_account_id  INTEGER NOT NULL REFERENCES sub_accounts(id),
        name            TEXT NOT NULL,
        territory_type  TEXT NOT NULL DEFAULT 'county',
        identifier      TEXT NOT NULL,
        identifiers     TEXT[] DEFAULT '{}',
        center_lat      REAL,
        center_lng      REAL,
        radius_miles    REAL,
        boundary_json   JSONB,
        vertical        TEXT,
        is_active       BOOLEAN NOT NULL DEFAULT true,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_territories_sub_account
        ON territories (sub_account_id);
      CREATE INDEX IF NOT EXISTS idx_territories_identifier
        ON territories (identifier);
      CREATE INDEX IF NOT EXISTS idx_territories_vertical
        ON territories (sub_account_id, vertical);

      -- 3. Generic incidents table (vertical-agnostic)
      CREATE TABLE IF NOT EXISTS incidents (
        id               SERIAL PRIMARY KEY,
        sub_account_id   INTEGER REFERENCES sub_accounts(id),
        vertical         TEXT NOT NULL,
        signal_type      TEXT NOT NULL,
        incident_hash    TEXT NOT NULL UNIQUE,
        source_id        TEXT,
        title            TEXT NOT NULL,
        description      TEXT,
        severity         TEXT NOT NULL DEFAULT 'medium',
        status           TEXT NOT NULL DEFAULT 'new',
        county           TEXT,
        state            TEXT DEFAULT 'FL',
        city             TEXT,
        lat              REAL,
        lng              REAL,
        territory_id     INTEGER REFERENCES territories(id),
        occurred_at      TIMESTAMPTZ,
        detected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        source_system    TEXT,
        confidence       REAL,
        raw_data         JSONB,
        contact_count    INTEGER NOT NULL DEFAULT 0,
        opportunity_count INTEGER NOT NULL DEFAULT 0,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_incidents_sub_vertical
        ON incidents (sub_account_id, vertical);
      CREATE INDEX IF NOT EXISTS idx_incidents_signal_type
        ON incidents (signal_type);
      CREATE INDEX IF NOT EXISTS idx_incidents_status
        ON incidents (status);
      CREATE INDEX IF NOT EXISTS idx_incidents_county
        ON incidents (county);
      CREATE INDEX IF NOT EXISTS idx_incidents_territory
        ON incidents (territory_id);
      CREATE INDEX IF NOT EXISTS idx_incidents_detected_at
        ON incidents (detected_at DESC);
      CREATE INDEX IF NOT EXISTS idx_incidents_occurred_at
        ON incidents (occurred_at DESC);

      -- 4. Incident–contact junction
      CREATE TABLE IF NOT EXISTS incident_contacts (
        id          SERIAL PRIMARY KEY,
        incident_id INTEGER NOT NULL REFERENCES incidents(id),
        contact_id  INTEGER NOT NULL REFERENCES contacts(id),
        role        TEXT NOT NULL DEFAULT 'subject',
        auto_linked BOOLEAN NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_incident_contacts_incident
        ON incident_contacts (incident_id);
      CREATE INDEX IF NOT EXISTS idx_incident_contacts_contact
        ON incident_contacts (contact_id);

      -- 5. Opportunities table
      CREATE TABLE IF NOT EXISTS opportunities (
        id                  SERIAL PRIMARY KEY,
        sub_account_id      INTEGER NOT NULL REFERENCES sub_accounts(id),
        incident_id         INTEGER REFERENCES incidents(id),
        contact_id          INTEGER REFERENCES contacts(id),
        vertical            TEXT NOT NULL,
        opportunity_type    TEXT NOT NULL,
        title               TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'available',
        assigned_to         INTEGER,
        score               INTEGER,
        score_band          TEXT,
        territory_id        INTEGER REFERENCES territories(id),
        estimated_value_usd REAL,
        expires_at          TIMESTAMPTZ,
        notes               TEXT,
        raw_data            JSONB,
        claimed_at          TIMESTAMPTZ,
        won_at              TIMESTAMPTZ,
        lost_at             TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_opportunities_sub_vertical
        ON opportunities (sub_account_id, vertical);
      CREATE INDEX IF NOT EXISTS idx_opportunities_status
        ON opportunities (status);
      CREATE INDEX IF NOT EXISTS idx_opportunities_contact
        ON opportunities (contact_id);
      CREATE INDEX IF NOT EXISTS idx_opportunities_incident
        ON opportunities (incident_id);
      CREATE INDEX IF NOT EXISTS idx_opportunities_territory
        ON opportunities (territory_id);
      CREATE INDEX IF NOT EXISTS idx_opportunities_expires_at
        ON opportunities (expires_at)
        WHERE expires_at IS NOT NULL;

      -- 6. Contact scores table
      CREATE TABLE IF NOT EXISTS contact_scores (
        id             SERIAL PRIMARY KEY,
        contact_id     INTEGER NOT NULL REFERENCES contacts(id),
        sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id),
        score          INTEGER NOT NULL,
        score_band     TEXT NOT NULL,
        qualifies      BOOLEAN NOT NULL DEFAULT false,
        breakdown      JSONB,
        scorer_version TEXT NOT NULL DEFAULT 'v1',
        expires_at     TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_contact_scores_contact
        ON contact_scores (contact_id);
      CREATE INDEX IF NOT EXISTS idx_contact_scores_sub_band
        ON contact_scores (sub_account_id, score_band);
      CREATE INDEX IF NOT EXISTS idx_contact_scores_score
        ON contact_scores (score DESC);

      -- 7. Backfill is_placeholder from existing identityStatus
      UPDATE contacts
        SET is_placeholder = true
        WHERE identity_status IN ('unidentified', 'placeholder');
      UPDATE contacts
        SET is_placeholder = false
        WHERE identity_status = 'verified';

      -- 8. Backfill view_class from existing identity and tags
      UPDATE contacts
        SET view_class = 'enriched_contact'
        WHERE identity_status = 'verified';
      UPDATE contacts
        SET view_class = 'incident_subject'
        WHERE lead_subtype IN ('crash', 'arrest', 'dui')
          AND identity_status != 'verified';
    `,
  },
  {
    name: "2026-05-16-victim-centric-address-architecture",
    sql: `
      -- ── Victim-Centric Address Architecture ──────────────────────────────────
      -- Separates incident locations from residential intelligence.
      -- Adds typed address fields + confidence scoring to contacts table.

      -- 1. Incident location columns (crash scene / highway marker)
      ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS incident_location TEXT,
        ADD COLUMN IF NOT EXISTS incident_lat      REAL,
        ADD COLUMN IF NOT EXISTS incident_lng      REAL;

      -- 2. Registration address (DHSMV owner address)
      ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS registration_address         TEXT,
        ADD COLUMN IF NOT EXISTS registration_address_source  TEXT,
        ADD COLUMN IF NOT EXISTS registration_address_sourced_at TIMESTAMP;

      -- 3. Skip-trace mailing address (BatchData)
      ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS mailing_address TEXT;

      -- 4. Residential intelligence columns
      ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS probable_residence TEXT,
        ADD COLUMN IF NOT EXISTS verified_residence TEXT;

      -- 5. Address confidence scoring
      ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS address_confidence REAL DEFAULT 0.0,
        ADD COLUMN IF NOT EXISTS address_type       TEXT DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS address_source     TEXT;

      -- 6. Index for residential filtering and confidence queries
      CREATE INDEX IF NOT EXISTS idx_contacts_address_type
        ON contacts (sub_account_id, address_type)
        WHERE address_type IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_contacts_address_confidence
        ON contacts (sub_account_id, address_confidence)
        WHERE address_confidence > 0;

      -- 7. Backfill: existing contacts with 'crash' vertical whose address
      --    looks like a highway reference → move to incident_location, clear address,
      --    set address_confidence = 0.15, address_type = 'incident_location'
      UPDATE contacts
        SET incident_location   = address,
            incident_lat        = lat,
            incident_lng        = lng,
            address             = NULL,
            address_confidence  = 0.15,
            address_type        = 'incident_location',
            address_source      = 'fhp_cad'
        WHERE lead_subtype = 'crash'
          AND address IS NOT NULL
          AND (
            address ~* '\\m(I-[0-9]|US-[0-9]|SR-[0-9]|CR-[0-9]|FL-[0-9]|MM\\s*[0-9]|INTERSTATE|HIGHWAY|HWY)\\M'
            OR address ILIKE '% MM %'
            OR address ILIKE '%MILE MARKER%'
          )
          AND incident_location IS NULL;

      -- 8. Backfill: existing contacts enriched by FLHSMV (has 'flhsmv-enriched' tag)
      --    that have a non-null address not matching highway pattern →
      --    treat as registration-quality address
      UPDATE contacts
        SET registration_address        = address,
            registration_address_source = 'flhsmv_report',
            address_confidence          = 0.85,
            address_type                = 'registration',
            address_source              = 'flhsmv'
        WHERE lead_subtype = 'crash'
          AND 'flhsmv-enriched' = ANY(tags)
          AND address IS NOT NULL
          AND (
            address !~* '\\m(I-[0-9]|US-[0-9]|SR-[0-9]|CR-[0-9]|FL-[0-9]|MM\\s*[0-9]|INTERSTATE|HIGHWAY|HWY)\\M'
          )
          AND registration_address IS NULL;

      -- 9. Backfill: update incident_fingerprint for existing crash contacts
      --    that have a sourceExternalId (crash:<reportNumber>:acct<N>)
      UPDATE contacts
        SET incident_fingerprint = encode(
              digest(
                REGEXP_REPLACE(source_external_id, ':acct[0-9]+$', ''),
                'sha256'
              ),
              'hex'
            )
        WHERE lead_subtype = 'crash'
          AND source_external_id LIKE 'crash:%'
          AND incident_fingerprint IS NULL;
    `,
  },

  {
    name: "2026-05-16-phone-lineage-source-intelligence",
    sql: `
      -- Phone Lineage / Source Intelligence Preservation (2026-05-16)
      -- Tracks where each contact's phone came from, how confident we are,
      -- and when it was acquired. Enables the source_matched skip-trace gate
      -- that prevents BatchData from re-purchasing already-acquired intelligence.

      -- 1. Phone source — which system/feed provided this phone
      --    Values: 'flhsmv' | 'dhsmv' | 'sheriff_booking' | 'court_filing'
      --            | 'jail_booking' | 'batchdata' | 'google_places' | 'manual' | 'unknown'
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_source text;

      -- 2. Phone confidence — how reliable is this phone number (0.0–1.0)
      --    Scale: 0.95 (govt verified) → 0.90 (sheriff) → 0.85 (court/DHSMV)
      --           → 0.72 (batchdata) → 0.50 (inferred) → 0.30 (unknown)
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_confidence real;

      -- 3. Phone acquired at — when this phone was recorded
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_acquired_at timestamp;

      -- 4. Index: find contacts with a specific phone source for reporting
      CREATE INDEX IF NOT EXISTS idx_contacts_phone_source
        ON contacts(phone_source)
        WHERE phone_source IS NOT NULL;

      -- 5. Backfill: tag existing contacts that have phones from BatchData enrichment
      --    (skipTraceStatus='matched' + enrichmentProvider='batchdata' → phone_source='batchdata')
      UPDATE contacts
        SET phone_source     = 'batchdata',
            phone_confidence = 0.72,
            phone_acquired_at = COALESCE(enrichment_completed_at, updated_at, created_at)
        WHERE phone IS NOT NULL
          AND phone_source IS NULL
          AND skip_trace_status = 'matched'
          AND enrichment_provider = 'batchdata';

      -- 6. Backfill: contacts with phone but unknown source → mark as unknown confidence
      UPDATE contacts
        SET phone_source     = 'unknown',
            phone_confidence = 0.30,
            phone_acquired_at = COALESCE(updated_at, created_at)
        WHERE phone IS NOT NULL
          AND phone_source IS NULL;

      -- 7. Backfill: contacts that already have phones but skipTraceStatus='not_attempted'
      --    — these had source phones but were never marked correctly.
      --    Promote to source_matched so BatchData never re-traces them.
      UPDATE contacts
        SET skip_trace_status = 'source_matched'
        WHERE phone IS NOT NULL
          AND skip_trace_status = 'not_attempted';

      -- 8. Backfill: contacts with phone AND skipTraceStatus='no_match'
      --    — these were incorrectly marked no_match after skip trace ran on source phones.
      --    Restore to source_matched (the skip trace should never have run).
      UPDATE contacts
        SET skip_trace_status = 'source_matched'
        WHERE phone IS NOT NULL
          AND phone_source IS NOT NULL
          AND phone_source != 'batchdata'
          AND skip_trace_status = 'no_match';
    `,
  },
  {
    name: "2026-05-18-card-identity-dna",
    sql: `
      ALTER TABLE digital_cards ADD COLUMN IF NOT EXISTS identity_dna jsonb;
      ALTER TABLE standalone_cards ADD COLUMN IF NOT EXISTS identity_dna jsonb;
    `,
  },
  {
    name: "2026-05-18-dynamic-page-schemas",
    sql: `
      CREATE TABLE IF NOT EXISTS dynamic_page_schemas (
        id                serial PRIMARY KEY,
        account_id        integer NOT NULL,
        created_by_user_id integer,
        slug              text NOT NULL DEFAULT '',
        title             text NOT NULL DEFAULT 'Untitled',
        niche             text NOT NULL DEFAULT 'general',
        status            text NOT NULL DEFAULT 'draft',
        schema_json       jsonb NOT NULL DEFAULT '{}',
        published_at      timestamptz,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        version           integer NOT NULL DEFAULT 1,
        is_public         boolean NOT NULL DEFAULT false
      );
      CREATE INDEX IF NOT EXISTS idx_dynamic_page_schemas_account_id ON dynamic_page_schemas (account_id);
      CREATE INDEX IF NOT EXISTS idx_dynamic_page_schemas_status ON dynamic_page_schemas (account_id, status);
    `,
  },
  {
    // Account-consolidation provenance columns. Additive-only, safe on live
    // tables. Populated by the explicit consolidation migration
    // (server/services/accountConsolidation.ts) — NOT at boot.
    name: "2026-05-18-contact-consolidation-provenance",
    sql: `
      ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS original_sub_account_id  INTEGER,
        ADD COLUMN IF NOT EXISTS consolidated_at          TIMESTAMP,
        ADD COLUMN IF NOT EXISTS merged_into_contact_id   INTEGER;

      CREATE INDEX IF NOT EXISTS idx_contacts_merged_into
        ON contacts (merged_into_contact_id);

      -- crash_reports / sentinel_incidents keep their pre-consolidation account
      -- so the repoint is auditable and reversible without the snapshot table.
      ALTER TABLE crash_reports
        ADD COLUMN IF NOT EXISTS original_sub_account_id  INTEGER,
        ADD COLUMN IF NOT EXISTS consolidated_at          TIMESTAMP;

      ALTER TABLE sentinel_incidents
        ADD COLUMN IF NOT EXISTS original_sub_account_id  INTEGER,
        ADD COLUMN IF NOT EXISTS consolidated_at          TIMESTAMP;
    `,
  },
];

export async function runDataMigrations(): Promise<void> {
  if (MIGRATIONS.length === 0) {
    console.log("[DATA-MIGRATIONS] no migrations registered");
    return;
  }

  // Only auto-apply in production. In dev, the schema is the source of
  // truth and these out-of-band fixes are not needed (run them manually
  // via scripts/run-data-migrations.ts if you really want them on dev).
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[DATA-MIGRATIONS] skipping in NODE_ENV=${process.env.NODE_ENV ?? "<unset>"} — runs only in production`,
    );
    return;
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _data_migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
  } catch (err) {
    console.error(
      "[DATA-MIGRATIONS] failed to ensure tracking table:",
      err instanceof Error ? err.message : err,
    );
    throw err;
  }

  for (const migration of MIGRATIONS) {
    try {
      const existing = await db.execute<{ name: string }>(
        sql`SELECT name FROM _data_migrations WHERE name = ${migration.name}`,
      );
      const rows = (existing as unknown as { rows?: Array<{ name: string }> }).rows
        ?? (existing as unknown as Array<{ name: string }>);
      if (Array.isArray(rows) && rows.length > 0) {
        console.log(`[DATA-MIGRATIONS] skip  ${migration.name} (already applied)`);
        continue;
      }

      console.log(`[DATA-MIGRATIONS] apply ${migration.name}`);

      await db.transaction(async (tx) => {
        const lockResult = await tx.execute<{ ok: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS ok`,
        );
        const lockRows = (lockResult as unknown as { rows?: Array<{ ok: boolean }> }).rows
          ?? (lockResult as unknown as Array<{ ok: boolean }>);
        const acquired = Array.isArray(lockRows) && lockRows[0]?.ok === true;
        if (!acquired) {
          throw new Error(
            "another server instance is currently applying this migration — will retry on next boot",
          );
        }

        const recheck = await tx.execute<{ name: string }>(
          sql`SELECT name FROM _data_migrations WHERE name = ${migration.name}`,
        );
        const recheckRows = (recheck as unknown as { rows?: Array<{ name: string }> }).rows
          ?? (recheck as unknown as Array<{ name: string }>);
        if (Array.isArray(recheckRows) && recheckRows.length > 0) {
          return;
        }

        await tx.execute(sql.raw(migration.sql));
        await tx.execute(
          sql`INSERT INTO _data_migrations (name) VALUES (${migration.name})
              ON CONFLICT DO NOTHING`,
        );
      });

      console.log(`[DATA-MIGRATIONS] ok    ${migration.name}`);
    } catch (err) {
      console.error(
        `[DATA-MIGRATIONS] FAIL ${migration.name}:`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }

  console.log("[DATA-MIGRATIONS] complete");
}
