# APEX POSTGRES BRAIN SCHEMA
**Phase 3 of 11 — AI-First Database Architecture**
Generated: 2026-05-14
Status: DESIGN DOCUMENT — No tables modified

---

## Design Principles

Every data flow in Apex follows this universal pipeline:

```
SOURCE → RAW INGEST → NORMALIZED RECORD → AI SUMMARY → ENTITY/ACCOUNT LINK → ACTION/AUTOMATION → OUTCOME → LEARNING MEMORY
```

For each product domain, this document maps:
1. **RAW TABLE** — exactly what came in from the source (immutable)
2. **NORMALIZED TABLE** — clean, typed, deduped operational record
3. **AI SUMMARY TABLE** — LLM-readable digest, embeddings, scores
4. **ACTIVITY/OUTCOME TABLE** — what happened, when, result, revenue

**Governing rule:** Do not create a table if an equivalent exists. For each domain:
- **A. REUSE** — existing table is correct, no change needed
- **B. EXTEND** — add columns to existing table via migration
- **C. CREATE** — new table required, with a compatibility view where needed

---

## TABLE OF CONTENTS

1. [Core SaaS Infrastructure](#1-core-saas-infrastructure)
2. [Auth & Admin](#2-auth--admin)
3. [Contacts & CRM](#3-contacts--crm)
4. [Inbox & Messaging](#4-inbox--messaging)
5. [Workflows & Automations](#5-workflows--automations)
6. [AI Agents & Operator](#6-ai-agents--operator)
7. [Websites, Funnels & Forms](#7-websites-funnels--forms)
8. [Ads & Campaigns](#8-ads--campaigns)
9. [Apex Sentinel](#9-apex-sentinel)
10. [Case Intelligence & Legal](#10-case-intelligence--legal)
11. [Home Service Signals](#11-home-service-signals)
12. [Enrichment & Skip Trace](#12-enrichment--skip-trace)
13. [Distribution & Routing](#13-distribution--routing)
14. [Billing & Plans](#14-billing--plans)
15. [Apex Intelligence Brain](#15-apex-intelligence-brain)
16. [Tracking & Attribution](#16-tracking--attribution)
17. [Platform Ops & Observability](#17-platform-ops--observability)
18. [Schema Migration Matrix](#18-schema-migration-matrix)
19. [Deployment Sequence](#19-deployment-sequence)

---

## 1. Core SaaS Infrastructure

### Existing Tables (REUSE/EXTEND)

| Table | Status | Row Count | Action |
|-------|--------|-----------|--------|
| `accounts` | REUSE | ~5 | Production data; do not drop |
| `sub_accounts` | REUSE | ~5 | Tenant isolation anchor |
| `users` | EXTEND | ~10 | Add `role` enum, keep `is_admin` varchar for compat |
| `sessions` | REUSE | live | connect-pg-simple; no change |
| `feature_flags` | REUSE | ~20 | Correct design, no change |
| `platform_settings` | REUSE | live | Global key-value config |

### Critical Fix Required (EXTEND `sub_accounts`)

The `APEX_PARENT_ACCOUNT_ID` constant in `server/middleware/tenant.ts` is hardcoded to `13` but the real admin account is `3`. Until the code is fixed, the DB needs a guard:

```sql
-- Run AFTER code fix, not as a workaround:
-- APEX_PARENT_ACCOUNT_ID must be set to 3 in server/middleware/tenant.ts
```

### New Tables Required

**`account_tier_history`** — audit trail for plan changes
```sql
CREATE TABLE account_tier_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  integer NOT NULL REFERENCES sub_accounts(id),
  old_tier    varchar(50),
  new_tier    varchar(50) NOT NULL,
  changed_by  varchar REFERENCES users(id),
  reason      text,
  stripe_event_id varchar,
  created_at  timestamptz DEFAULT now()
);
```

---

## 2. Auth & Admin

### Existing Tables

| Table | Status | Action |
|-------|--------|--------|
| `users` | EXTEND | Add `role` column (enum: owner, admin, member, viewer) |
| `sessions` | REUSE | No change |

### The `is_admin` Problem

`users.is_admin` is `varchar` storing the string `"true"` or `"false"`. This is live in production and cannot be changed without a migration. Strategy:

```sql
-- Layer B: Extend safely
ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar(20) DEFAULT 'member';

-- Backfill from existing is_admin
UPDATE users SET role = 'admin' WHERE is_admin = 'true';
UPDATE users SET role = 'member' WHERE is_admin != 'true' OR is_admin IS NULL;

-- Keep is_admin column for backward compatibility
-- Add computed view for clean access:
CREATE OR REPLACE VIEW users_v AS
  SELECT *, (is_admin = 'true' OR role IN ('admin', 'owner')) AS is_admin_bool
  FROM users;
```

### New Tables Required

**`admin_audit_log`** — every privileged action
```sql
CREATE TABLE admin_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     varchar REFERENCES users(id),
  account_id  integer,
  action      varchar(100) NOT NULL,
  entity_type varchar(50),
  entity_id   varchar,
  payload     jsonb,
  ip_address  varchar(45),
  user_agent  text,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX ON admin_audit_log (user_id, created_at DESC);
CREATE INDEX ON admin_audit_log (account_id, created_at DESC);
```

**`api_keys`** — for MCP tool layer and programmatic access
```sql
CREATE TABLE api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  integer NOT NULL REFERENCES sub_accounts(id),
  user_id     varchar REFERENCES users(id),
  key_hash    varchar(64) NOT NULL UNIQUE,
  key_prefix  varchar(8) NOT NULL,
  label       varchar(100),
  scopes      text[] DEFAULT '{}',
  last_used_at timestamptz,
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz DEFAULT now()
);
```

---

## 3. Contacts & CRM

### Existing Tables (largest domain)

| Table | Status | Row Count | Action |
|-------|--------|-----------|--------|
| `contacts` | EXTEND | ~2,100 | Add 14 pending columns + dedup key |
| `contact_notes` | REUSE | live | No change |
| `contact_tags` | REUSE | live | No change |
| `contact_activities` | REUSE | live | Activity log |
| `contact_sources` | REUSE | live | Source attribution |
| `contact_pipeline_stages` | REUSE | live | Pipeline/stage model |
| `contact_custom_fields` | REUSE | live | EAV extension |

### Schema Drift Fix (EXTEND `contacts`)

The following 14 columns exist in `schema.ts` but NOT in the live DB. Must be deployed:

```sql
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS identity_status           varchar(50),
  ADD COLUMN IF NOT EXISTS skip_trace_status         varchar(50),
  ADD COLUMN IF NOT EXISTS enrichment_provider       varchar(100),
  ADD COLUMN IF NOT EXISTS enrichment_attempted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS enrichment_completed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS enrichment_confidence     numeric(5,2),
  ADD COLUMN IF NOT EXISTS source_external_id        varchar(255),
  ADD COLUMN IF NOT EXISTS raw_source_type           varchar(100),
  ADD COLUMN IF NOT EXISTS lead_vertical             varchar(100),
  ADD COLUMN IF NOT EXISTS lead_subtype              varchar(100),
  ADD COLUMN IF NOT EXISTS normalized_phone          varchar(20),
  ADD COLUMN IF NOT EXISTS normalized_email          varchar(255),
  ADD COLUMN IF NOT EXISTS county                    varchar(100),
  ADD COLUMN IF NOT EXISTS contact_quality_score     numeric(5,2);
```

### Deduplication Key (CRITICAL GAP)

395 Hillsborough contacts are duplicated across accounts 2, 3, and 4. No dedup key exists:

```sql
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS global_dedup_hash varchar(64),
  ADD COLUMN IF NOT EXISTS canonical_contact_id integer REFERENCES contacts(id);

CREATE UNIQUE INDEX IF NOT EXISTS contacts_dedup_hash_account_idx
  ON contacts (global_dedup_hash, account_id)
  WHERE global_dedup_hash IS NOT NULL;
```

### New Tables Required

**`contact_ai_profiles`** — AI summary layer (Layer 3 of 4)
```sql
CREATE TABLE contact_ai_profiles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id         integer NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  account_id         integer NOT NULL,
  summary_text       text,
  embedding          vector(1536),
  intent_signals     jsonb DEFAULT '{}',
  risk_flags         jsonb DEFAULT '{}',
  propensity_score   numeric(5,4),
  recommended_action varchar(100),
  last_llm_model     varchar(100),
  last_scored_at     timestamptz,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now(),
  UNIQUE (contact_id, account_id)
);
CREATE INDEX ON contact_ai_profiles USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100)
  WHERE embedding IS NOT NULL;
```

**`contact_merge_log`** — dedup history
```sql
CREATE TABLE contact_merge_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  winner_id       integer NOT NULL REFERENCES contacts(id),
  loser_id        integer NOT NULL,
  merge_reason    varchar(100),
  merged_fields   jsonb,
  merged_by       varchar REFERENCES users(id),
  created_at      timestamptz DEFAULT now()
);
```

---

## 4. Inbox & Messaging

### Existing Tables

| Table | Status | Action |
|-------|--------|--------|
| `conversations` | REUSE | Core conversation record |
| `messages` | REUSE | Individual messages |
| `conversation_participants` | REUSE | Multi-party threads |
| `message_templates` | REUSE | Saved templates |
| `inbox_settings` | REUSE | Per-account inbox config |

### New Tables Required

**`message_delivery_log`** — Layer 4: outcome tracking
```sql
CREATE TABLE message_delivery_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      integer REFERENCES messages(id),
  account_id      integer NOT NULL,
  channel         varchar(30) NOT NULL,   -- sms, email, whatsapp, voice
  provider        varchar(50),            -- twilio, sendgrid, resend
  provider_msg_id varchar(255),
  status          varchar(30) NOT NULL,   -- sent, delivered, failed, read
  error_code      varchar(50),
  error_message   text,
  cost_cents      integer,
  sent_at         timestamptz,
  delivered_at    timestamptz,
  read_at         timestamptz,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX ON message_delivery_log (account_id, channel, sent_at DESC);
```

**`twilio_account_registry`** — Twilio is in legacy mode (A2P not registered)
```sql
CREATE TABLE twilio_account_registry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      integer NOT NULL REFERENCES sub_accounts(id),
  twilio_sid      varchar(34) NOT NULL,
  phone_number    varchar(20) NOT NULL,
  a2p_registered  boolean DEFAULT false,
  a2p_campaign_sid varchar(34),
  a2p_status      varchar(50),
  monthly_limit   integer DEFAULT 1000,
  created_at      timestamptz DEFAULT now()
);
```

---

## 5. Workflows & Automations

### Existing Tables

| Table | Status | Action |
|-------|--------|--------|
| `workflows` | REUSE | Workflow definitions |
| `workflow_steps` | REUSE | Step graph |
| `workflow_executions` | REUSE | Execution instances |
| `workflow_step_executions` | REUSE | Per-step results |
| `triggers` | REUSE | Trigger definitions |
| `automation_logs` | REUSE | General automation log |

### New Tables Required

**`workflow_ai_suggestions`** — AI recommends workflow improvements
```sql
CREATE TABLE workflow_ai_suggestions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      integer NOT NULL,
  workflow_id     integer REFERENCES workflows(id),
  suggestion_type varchar(50),    -- add_step, remove_step, change_timing, new_workflow
  title           varchar(255),
  description     text,
  confidence      numeric(5,4),
  status          varchar(30) DEFAULT 'pending',  -- pending, accepted, rejected, auto_applied
  applied_at      timestamptz,
  created_at      timestamptz DEFAULT now()
);
```

---

## 6. AI Agents & Operator

### Existing Tables

| Table | Status | Action |
|-------|--------|--------|
| `ai_agents` | REUSE | Agent definitions |
| `ai_agent_sessions` | REUSE | Conversation sessions |
| `ai_agent_messages` | REUSE | Session messages |
| `ai_operator_configs` | REUSE | Operator persona configs |
| `vapi_calls` | REUSE | Vapi voice call records |
| `vapi_call_transcripts` | REUSE | Transcript storage |

### New Tables Required

**`agent_performance_metrics`** — Layer 4: outcomes
```sql
CREATE TABLE agent_performance_metrics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      integer NOT NULL,
  agent_id        integer REFERENCES ai_agents(id),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  total_sessions  integer DEFAULT 0,
  successful_sessions integer DEFAULT 0,
  avg_resolution_time_secs integer,
  human_escalations integer DEFAULT 0,
  sentiment_avg   numeric(5,4),
  cost_cents      integer DEFAULT 0,
  revenue_attributed_cents integer DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (agent_id, period_start, period_end)
);
```

---

## 7. Websites, Funnels & Forms

### Existing Tables

| Table | Status | Action |
|-------|--------|--------|
| `websites` | REUSE | Website/funnel root records |
| `website_pages` | REUSE | Page definitions |
| `website_sections` | REUSE | Section blocks |
| `forms` | REUSE | Form definitions |
| `form_fields` | REUSE | Field schema |
| `form_submissions` | REUSE | Submitted data |

### New Tables Required

**`funnel_analytics`** — Layer 4: conversion outcomes
```sql
CREATE TABLE funnel_analytics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      integer NOT NULL,
  website_id      integer REFERENCES websites(id),
  session_id      varchar(100),
  visitor_id      varchar(100),
  entry_page_id   integer REFERENCES website_pages(id),
  exit_page_id    integer REFERENCES website_pages(id),
  converted       boolean DEFAULT false,
  conversion_value_cents integer,
  utm_source      varchar(255),
  utm_medium      varchar(255),
  utm_campaign    varchar(255),
  started_at      timestamptz NOT NULL,
  completed_at    timestamptz,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX ON funnel_analytics (account_id, started_at DESC);
```

---

## 8. Ads & Campaigns

### Existing Tables

| Table | Status | Action |
|-------|--------|--------|
| `campaigns` | REUSE | Campaign records |
| `campaign_contacts` | REUSE | Contact-campaign links |
| `ad_accounts` | REUSE | Connected ad platform accounts |
| `ad_campaigns` | REUSE | Platform-level campaigns |
| `ad_sets` | REUSE | Ad set records |
| `ads` | REUSE | Individual ads |
| `ad_analytics` | REUSE | Performance metrics |

### New Tables Required

**`ad_performance_ai_insights`** — Layer 3: AI analysis of ad data
```sql
CREATE TABLE ad_performance_ai_insights (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      integer NOT NULL,
  campaign_id     integer REFERENCES campaigns(id),
  analysis_period varchar(20),     -- daily, weekly, monthly
  period_date     date NOT NULL,
  insight_text    text,
  recommendations jsonb DEFAULT '[]',
  predicted_roas  numeric(8,4),
  budget_recommendation_cents integer,
  confidence      numeric(5,4),
  generated_at    timestamptz DEFAULT now()
);
```

---

## 9. Apex Sentinel

### Existing Tables

| Table | Status | Row Count | Action |
|-------|--------|-----------|--------|
| `sentinel_incidents` | REUSE | 7,092 | 7,085 stuck 'pending' — pipeline broken |
| `sentinel_rules` | REUSE | ~30 | Active rule set |
| `sentinel_notifications` | REUSE | live | Notification records |
| `sentinel_subscriptions` | REUSE | live | User/account subscriptions |
| `crash_reports` | REUSE | live | Raw crash ingest |

### Critical Gap: Sentinel Loop Not Closing

7,085 incidents are stuck at `status = 'pending'`. The ingest pipeline works but the delivery/action loop is not wired. The DB is not the problem — the worker is. But two tables need to be added to support proper closure:

**`sentinel_actions`** — what was done in response to an incident (Layer 4)
```sql
CREATE TABLE sentinel_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id     integer NOT NULL REFERENCES sentinel_incidents(id),
  account_id      integer NOT NULL,
  action_type     varchar(50) NOT NULL,   -- notify, escalate, auto_respond, snooze
  channel         varchar(30),            -- sms, email, push, webhook
  target          varchar(255),           -- phone, email address, URL
  payload         jsonb,
  status          varchar(30) DEFAULT 'pending',
  executed_at     timestamptz,
  result          jsonb,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX ON sentinel_actions (incident_id);
CREATE INDEX ON sentinel_actions (account_id, created_at DESC);
```

**`sentinel_incident_ai_triage`** — Layer 3: AI assessment of incident severity
```sql
CREATE TABLE sentinel_incident_ai_triage (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id         integer NOT NULL REFERENCES sentinel_incidents(id),
  severity_score      numeric(5,4),
  urgency             varchar(20),     -- critical, high, medium, low
  recommended_action  varchar(100),
  triage_notes        text,
  false_positive_prob numeric(5,4),
  triaged_at          timestamptz DEFAULT now(),
  UNIQUE (incident_id)
);
```

---

## 10. Case Intelligence & Legal

### Existing Tables

| Table | Status | Row Count | Action |
|-------|--------|-----------|--------|
| `legal_cases` | REUSE | ~400 | Court filing cases |
| `legal_leads` | REUSE | 19,312 | Generated leads — 0 delivered |
| `legal_attorneys` | BROKEN | 0 rows | Empty — delivery impossible |
| `legal_signals` | REUSE | live | Raw signal ingest |
| `case_filings` | REUSE | live | Raw filing records |
| `hillsborough_cases` | REUSE | ~395 | Source pipeline data |
| `pinellas_cases` | REUSE | live | Pinellas source data |
| `criminal_court_filings` | REUSE | live | Criminal case records |

### Critical Gap: Legal Lead Delivery Impossible

19,312 legal leads have been generated but `legal_attorneys` has 0 rows. No attorneys are registered, so leads cannot be routed to buyers.

```sql
-- legal_attorneys must be seeded. Schema already exists.
-- Verify columns:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'legal_attorneys';
-- Then seed from real attorney data before any routing logic runs.
```

### New Tables Required

**`legal_case_ai_summary`** — Layer 3: AI digest for buyer/routing decisions
```sql
CREATE TABLE legal_case_ai_summary (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             integer REFERENCES legal_cases(id),
  account_id          integer NOT NULL,
  case_type           varchar(100),
  jurisdiction        varchar(100),
  summary_text        text,
  claim_strength      numeric(5,4),
  settlement_estimate_cents integer,
  recommended_attorneys integer[],   -- array of legal_attorneys.id
  embedding           vector(1536),
  generated_at        timestamptz DEFAULT now(),
  UNIQUE (case_id)
);
```

**`legal_lead_delivery_log`** — Layer 4: outcome tracking for lead sales
```sql
CREATE TABLE legal_lead_delivery_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         integer NOT NULL REFERENCES legal_leads(id),
  attorney_id     integer REFERENCES legal_attorneys(id),
  account_id      integer NOT NULL,
  delivery_method varchar(30),     -- api, email, webhook, sms
  delivery_status varchar(30) NOT NULL,
  price_cents     integer,
  response_received boolean DEFAULT false,
  response_at     timestamptz,
  outcome         varchar(50),     -- accepted, rejected, no_response, converted
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX ON legal_lead_delivery_log (lead_id);
CREATE INDEX ON legal_lead_delivery_log (attorney_id, created_at DESC);
```

---

## 11. Home Service Signals

### Existing Tables

| Table | Status | Action |
|-------|--------|--------|
| `home_service_signals` | REUSE | Raw signal records |
| `home_service_leads` | REUSE | Processed leads |
| `home_service_providers` | REUSE | Provider registry |
| `permit_records` | REUSE | Permit filing data |
| `storm_damage_reports` | REUSE | Storm signal data |
| `foreclosure_records` | REUSE | Foreclosure filings |

### New Tables Required

**`home_service_signal_scores`** — Layer 3: AI scoring
```sql
CREATE TABLE home_service_signal_scores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id           integer NOT NULL REFERENCES home_service_signals(id),
  account_id          integer NOT NULL,
  urgency_score       numeric(5,4),
  job_value_estimate_cents integer,
  recommended_service varchar(100),
  best_contact_time   varchar(50),
  scored_at           timestamptz DEFAULT now(),
  UNIQUE (signal_id, account_id)
);
```

---

## 12. Enrichment & Skip Trace

### Existing Tables

| Table | Status | Action |
|-------|--------|--------|
| `skip_trace_jobs` | REUSE | Batch job records |
| `skip_trace_results` | REUSE | Per-contact results |
| `enrichment_queue` | REUSE | Processing queue |
| `enrichment_results` | REUSE | Enriched data |

### Pending Columns on `contacts` (see §3)

The 14 schema drift columns on `contacts` are the primary enrichment status fields. Deploy those first.

### New Tables Required

**`enrichment_provider_log`** — provider-level audit for billing and quality
```sql
CREATE TABLE enrichment_provider_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      integer REFERENCES contacts(id),
  account_id      integer NOT NULL,
  provider        varchar(100) NOT NULL,
  request_type    varchar(50),         -- skip_trace, email_verify, phone_lookup
  request_id      varchar(255),
  cost_cents      integer,
  records_returned integer DEFAULT 0,
  success         boolean,
  error_message   text,
  raw_response    jsonb,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX ON enrichment_provider_log (account_id, provider, created_at DESC);
CREATE INDEX ON enrichment_provider_log (contact_id);
```

---

## 13. Distribution & Routing

### Existing Tables

| Table | Status | Action |
|-------|--------|--------|
| `lead_distributions` | REUSE | Distribution records |
| `distribution_rules` | REUSE | Routing rule config |
| `distribution_logs` | REUSE | Delivery audit trail |
| `lead_buyers` | REUSE | Buyer registry |
| `routing_configs` | REUSE | Per-account routing |

### New Tables Required

**`distribution_performance`** — Layer 4: buyer-level outcome metrics
```sql
CREATE TABLE distribution_performance (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          integer NOT NULL,
  buyer_id            integer REFERENCES lead_buyers(id),
  lead_type           varchar(50),
  period_date         date NOT NULL,
  leads_sent          integer DEFAULT 0,
  leads_accepted      integer DEFAULT 0,
  leads_rejected      integer DEFAULT 0,
  avg_price_cents     integer,
  revenue_cents       integer DEFAULT 0,
  return_rate         numeric(5,4),
  created_at          timestamptz DEFAULT now(),
  UNIQUE (buyer_id, lead_type, period_date)
);
```

---

## 14. Billing & Plans

### Existing Tables

| Table | Status | Row Count | Action |
|-------|--------|-----------|--------|
| `subscriptions` | BROKEN | 0 rows | Empty — billing not enforced |
| `plans` | REUSE | ~10 | Tier definitions |
| `invoices` | REUSE | live | Invoice records |
| `payment_methods` | REUSE | live | Payment method storage |
| `stripe.*` tables | REUSE | live | Full Stripe sync schema |

### Critical Gap: Zero Subscriptions

All 5 accounts are on enterprise plan but `subscriptions` has 0 rows. Billing is a no-op.

```sql
-- DO NOT RUN AUTOMATICALLY — requires Stripe verification first
-- After confirming Stripe customer IDs, backfill:
INSERT INTO subscriptions (account_id, plan_id, stripe_subscription_id, status, current_period_start, current_period_end)
SELECT 
  sa.id,
  p.id,
  NULL,  -- fill from Stripe after verification
  'active',
  now(),
  now() + interval '1 month'
FROM sub_accounts sa
CROSS JOIN plans p
WHERE p.name = 'enterprise'
AND sa.id IN (2, 3, 4, 5);  -- verify list before executing
```

### Plan Name Normalization (EXTEND `plans`)

Legacy aliases exist in code: `agency_pro → pro`, `god_mode → enterprise`. Normalize:

```sql
ALTER TABLE plans ADD COLUMN IF NOT EXISTS legacy_aliases text[] DEFAULT '{}';

UPDATE plans SET legacy_aliases = ARRAY['agency_pro'] WHERE name = 'pro';
UPDATE plans SET legacy_aliases = ARRAY['god_mode'] WHERE name = 'enterprise';
```

---

## 15. Apex Intelligence Brain

### Existing Tables (Core)

| Table | Status | Row Count | Action |
|-------|--------|-----------|--------|
| `universal_events` | REUSE | 223,691 | Core event stream — do not alter |
| `ai_recommendations` | REUSE | live | Recommendation outputs |
| `ai_scores` | REUSE | live | Per-entity score records |
| `autonomy_configs` | REUSE | live | Autonomy tier settings |
| `intelligence_summaries` | REUSE | live | Account-level summaries |
| `episodic_memories` | REUSE | live | Long-term memory records |
| `brain_activity_log` | REUSE | live | Brain execution log |

### New Tables Required

**`brain_learning_feedback`** — humans correcting AI decisions (closes the learning loop)
```sql
CREATE TABLE brain_learning_feedback (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          integer NOT NULL,
  recommendation_id   integer REFERENCES ai_recommendations(id),
  event_id            integer REFERENCES universal_events(id),
  feedback_type       varchar(30) NOT NULL,  -- correct, incorrect, partial
  user_id             varchar REFERENCES users(id),
  correction_notes    text,
  used_in_training    boolean DEFAULT false,
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX ON brain_learning_feedback (account_id, created_at DESC);
CREATE INDEX ON brain_learning_feedback (used_in_training) WHERE used_in_training = false;
```

**`embedding_store`** — pgvector storage for semantic search across all entities
```sql
-- Requires: CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE embedding_store (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      integer NOT NULL,
  entity_type     varchar(50) NOT NULL,  -- contact, case, signal, document, conversation
  entity_id       varchar(100) NOT NULL,
  embedding_model varchar(100) NOT NULL,
  embedding       vector(1536) NOT NULL,
  content_hash    varchar(64),
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (entity_type, entity_id, account_id, embedding_model)
);
CREATE INDEX ON embedding_store USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
CREATE INDEX ON embedding_store (account_id, entity_type);
```

---

## 16. Tracking & Attribution

### Existing Tables

| Table | Status | Action |
|-------|--------|--------|
| `page_views` | REUSE | Web analytics |
| `session_events` | REUSE | Session-level events |
| `conversion_events` | REUSE | Conversion tracking |
| `attribution_models` | REUSE | Model definitions |
| `utm_tracking` | REUSE | UTM parameter storage |

No new tables required in this domain. Existing design is adequate.

---

## 17. Platform Ops & Observability

### Existing Tables

| Table | Status | Action |
|-------|--------|--------|
| `pipeline_run_log` | REUSE | Pipeline execution history |
| `cron_job_log` | REUSE | Scheduled job history |
| `error_log` | REUSE | Application errors |
| `webhook_deliveries` | REUSE | Outbound webhook log |
| `notification_log` | REUSE | Platform notification history |

### New Tables Required

**`agent_outcome_log`** — the `reportOutcome` function target (referenced in recent commits)
```sql
CREATE TABLE agent_outcome_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      integer NOT NULL,
  agent_name      varchar(100) NOT NULL,
  pipeline_name   varchar(100),
  run_id          uuid,
  outcome_type    varchar(50) NOT NULL,   -- success, failure, partial, skipped
  records_in      integer DEFAULT 0,
  records_out     integer DEFAULT 0,
  records_failed  integer DEFAULT 0,
  duration_ms     integer,
  cost_cents      integer,
  error_code      varchar(50),
  error_message   text,
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX ON agent_outcome_log (account_id, agent_name, created_at DESC);
CREATE INDEX ON agent_outcome_log (pipeline_name, created_at DESC);
```

---

## 18. Schema Migration Matrix

Summary of all actions across domains:

| Domain | Reuse | Extend | Create New | Tables to Create |
|--------|-------|--------|------------|-----------------|
| Core SaaS | 5 | 1 | 1 | account_tier_history |
| Auth & Admin | 2 | 1 | 2 | admin_audit_log, api_keys |
| Contacts & CRM | 7 | 1 | 2 | contact_ai_profiles, contact_merge_log |
| Inbox & Messaging | 5 | 0 | 2 | message_delivery_log, twilio_account_registry |
| Workflows | 6 | 0 | 1 | workflow_ai_suggestions |
| AI Agents | 6 | 0 | 1 | agent_performance_metrics |
| Websites/Funnels | 6 | 0 | 1 | funnel_analytics |
| Ads & Campaigns | 7 | 0 | 1 | ad_performance_ai_insights |
| Apex Sentinel | 5 | 0 | 2 | sentinel_actions, sentinel_incident_ai_triage |
| Case Intelligence | 6 | 0 | 2 | legal_case_ai_summary, legal_lead_delivery_log |
| Home Service | 6 | 0 | 1 | home_service_signal_scores |
| Enrichment | 4 | 0 | 1 | enrichment_provider_log |
| Distribution | 5 | 0 | 1 | distribution_performance |
| Billing | 4 | 1 | 1 | (subscriptions backfill, not structural) |
| Intelligence Brain | 7 | 0 | 2 | brain_learning_feedback, embedding_store |
| Tracking | 5 | 0 | 0 | — |
| Platform Ops | 5 | 0 | 1 | agent_outcome_log |
| **TOTAL** | **101** | **4** | **22** | **22 new tables** |

**Column additions (EXTEND actions):**
- `users` — `role` column
- `contacts` — 14 pending lifecycle columns + 2 dedup columns
- `sub_accounts` — (documented in code fix, no new column needed)
- `plans` — `legacy_aliases` column

---

## 19. Deployment Sequence

All changes must follow this sequence to avoid breaking production:

### Phase A — Zero-Risk Extensions (no data loss possible)
1. `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ...` (14 columns) — these are additive
2. `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS global_dedup_hash, canonical_contact_id`
3. `ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar(20)`
4. `ALTER TABLE plans ADD COLUMN IF NOT EXISTS legacy_aliases text[]`
5. Backfill `users.role` from `users.is_admin`

### Phase B — New Tables (no existing data affected)
6. Create all 22 new tables in order of dependency:
   - Tables with no foreign keys first (embedding_store, admin_audit_log, api_keys)
   - Tables referencing existing tables next (all domain-specific tables)
   - Tables referencing other new tables last (legal_case_ai_summary after legal_cases confirmed)

### Phase C — Critical Code Fix (must happen before Phase D)
7. **Fix `APEX_PARENT_ACCOUNT_ID` from `13` → `3`** in `server/middleware/tenant.ts`
8. Deploy code fix and verify admin session resolves correctly

### Phase D — Data Backfills (after code fix)
9. Verify `legal_attorneys` table and seed attorney data
10. Backfill `subscriptions` table after Stripe customer ID verification
11. Run dedup process on `contacts` to populate `global_dedup_hash`

### Phase E — Extensions requiring pgvector
12. `CREATE EXTENSION IF NOT EXISTS vector` (confirm Neon PG17 has pgvector)
13. Create `embedding_store` table with vector index
14. Add vector column to `contact_ai_profiles`
15. Begin embedding generation via background worker

### Rollback Strategy
Every `ALTER TABLE ADD COLUMN IF NOT EXISTS` is safe to roll back with `DROP COLUMN IF EXISTS`. Every new table can be `DROP TABLE IF EXISTS`. No existing data is touched until Phase D backfills, which are explicitly gated.

---

*Document complete. Next: `docs/APEX_MIGRATION_PLAN.md` (Phase 4)*
