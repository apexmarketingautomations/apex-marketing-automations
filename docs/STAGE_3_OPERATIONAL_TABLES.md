# STAGE 3 OPERATIONAL TABLES
**Apex Marketing Automations — Table Reference**
Generated: 2026-05-15
Status: ALL TABLES LIVE — 21 tables, 13 indexes, 0 rows

---

## Quick Reference

| Table | Category | FK Dependencies | Vector | UNIQUE Constraints |
|-------|----------|----------------|--------|-------------------|
| `account_tier_history` | Account | `sub_accounts`, `users` | — | — |
| `admin_audit_log` | Security | `users` | — | — |
| `api_keys` | Security | `sub_accounts`, `users` | — | `key_hash` |
| `agent_outcome_log` | Intelligence | None | — | — |
| `twilio_account_registry` | Comms | `sub_accounts` | — | `twilio_account_sid` |
| `embedding_store` | AI/Vector | None | `vector(1536) NOT NULL` | `(source_type, source_id, model)` |
| `contact_ai_profiles` | AI/CRM | `contacts` | `vector(1536) NULL` | `contact_id` |
| `contact_merge_log` | CRM | `contacts`, `users` | — | — |
| `enrichment_provider_log` | CRM | `contacts` | — | — |
| `message_delivery_log` | Comms | `messages` | — | — |
| `sentinel_actions` | Sentinel | `sentinel_incidents` | — | — |
| `sentinel_incident_ai_triage` | Sentinel | `sentinel_incidents` | — | `incident_id` |
| `legal_lead_delivery_log` | Legal | `legal_leads`, `legal_attorneys` | — | — |
| `home_service_signal_scores` | Home Services | `home_service_signals` | — | `signal_id` |
| `legal_case_ai_summary` | Legal/AI | `intelligence_cases` | `vector(1536) NULL` | `intelligence_case_id` |
| `workflow_ai_suggestions` | Workflows | `workflows` | — | — |
| `brain_learning_feedback` | Intelligence | `users`, `universal_events` | — | — |
| `agent_performance_metrics` | Intelligence | None (plain INT) | — | `(agent_id, metric_date)` |
| `funnel_analytics` | Analytics | None (plain INT) | — | — |
| `ad_performance_ai_insights` | Ads | None (plain INT) | — | — |
| `distribution_performance` | Distribution | None (plain INT) | — | `(buyer_id, metric_date)` |

---

## Group A — No External FK Dependencies

### `account_tier_history`

Audit trail for subscription tier changes across sub-accounts.

```sql
CREATE TABLE account_tier_history (
  id BIGSERIAL PRIMARY KEY,
  sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id) ON DELETE CASCADE,
  changed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  previous_tier VARCHAR(50),
  new_tier VARCHAR(50) NOT NULL,
  reason TEXT,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Intended writers:** Admin UI tier change flow, Stripe webhook on plan change
**Intended readers:** Billing audit queries, admin dashboard

---

### `admin_audit_log`

Permanent record of all operator-level actions. Append-only by design.

```sql
CREATE TABLE admin_audit_log (
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
```

**Indexes:** `(user_id, created_at DESC)`, `(action, created_at DESC)`
**Intended writers:** All admin routes (via `internalOnly` middleware in Stage 4+)
**Intended readers:** Security audit, compliance reporting

**Note:** No `updated_at` — rows are immutable once written.

---

### `api_keys`

API key management for external service access. Keys are stored as SHA-256 hashes, never plaintext.

```sql
CREATE TABLE api_keys (
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
```

**Design:** `key_hash` is the SHA-256 of the raw key. `key_prefix` (e.g., `apex_sk_1234`) is shown to the user for identification. The raw key is shown once at creation and never stored.
**Intended writers:** API key management UI (Stage 4)
**Intended readers:** Auth middleware on API key routes

---

### `agent_outcome_log`

Records outcomes for every agent task across all pipelines. Already implicitly receiving data via `reportOutcome` pipeline writing to `universal_events(agent.outcome)`. This table provides structured, queryable storage for the same data.

```sql
CREATE TABLE agent_outcome_log (
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
```

**Indexes:** `(pipeline, created_at DESC)`, `(contact_id)` WHERE NOT NULL
**Intended writers:** `reportOutcome` pipeline (Stage 4 — wire to this table in addition to `universal_events`)
**Intended readers:** Apex Intelligence brain, agent performance dashboard

**Current state:** 0 rows — `reportOutcome` still writes only to `universal_events`. Structural fan-out to this table is Stage 4 scope.

---

### `twilio_account_registry`

Tracks Twilio sub-account SIDs and their mapping to platform sub-accounts. Auth tokens are stored encrypted (encryption at application layer, not DB layer).

```sql
CREATE TABLE twilio_account_registry (
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
```

**Intended writers:** Twilio account provisioning flow (Stage 4+)
**Intended readers:** Messaging pipeline, Twilio webhook handler

---

### `embedding_store`

Central vector store. See [STAGE_3_VECTOR_ARCHITECTURE.md](STAGE_3_VECTOR_ARCHITECTURE.md) for full architecture.

```sql
CREATE TABLE embedding_store (
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
```

**Indexes:** HNSW cosine (`m=16, ef_construction=64`), B-tree on `(source_type, source_id)`, B-tree on `created_at DESC`
**Current state:** 0 rows — HNSW index live and validated, awaiting Stage 4 population worker

---

## Group B — FK to Verified Existing Tables

### `contact_ai_profiles`

One-to-one with `contacts`. Stores AI-generated profile data including intent classification and optional semantic embedding.

```sql
CREATE TABLE contact_ai_profiles (
  id BIGSERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  summary TEXT,
  intent_signals TEXT[],
  predicted_intent VARCHAR(100),
  intent_confidence NUMERIC(4,3),
  lifecycle_stage VARCHAR(50),
  last_enriched_at TIMESTAMPTZ,
  embedding vector(1536),               -- NULL until Stage 4 population
  embedding_model VARCHAR(100),
  embedding_updated_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(contact_id)
);
```

**Valid `lifecycle_stage` values:** `raw`, `enriched`, `qualified`, `contacted`, `converted`
**Valid `predicted_intent` examples:** `injury_claim`, `home_service`, `legal_consult`, `none`
**Intended writers:** AI profile enrichment pipeline (Stage 4)
**Intended readers:** Apex Intelligence brain, contact scoring, lead qualification

---

### `contact_merge_log`

Immutable record of every contact deduplication merge. The `merged_contact_id` column does not have a FK constraint because the merged contact may be deleted.

```sql
CREATE TABLE contact_merge_log (
  id BIGSERIAL PRIMARY KEY,
  primary_contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  merged_contact_id INTEGER NOT NULL,    -- No FK — merged contact may be deleted
  merged_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  merge_reason VARCHAR(100),
  confidence NUMERIC(4,3),
  field_snapshot JSONB,                  -- Snapshot of merged contact fields at time of merge
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Intended writers:** Contact deduplication pipeline (Stage 4), manual merge UI
**Intended readers:** Contact history view, compliance audit

---

### `enrichment_provider_log`

Per-attempt audit log for every external enrichment call. Captures cost, fields returned, and raw response for provider reconciliation.

```sql
CREATE TABLE enrichment_provider_log (
  id BIGSERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  provider VARCHAR(100) NOT NULL,        -- 'batchdata', 'whitepages', 'lexisnexis', ...
  attempt_type VARCHAR(100),             -- 'skip_trace', 'reverse_phone', 'identity_verify'
  status VARCHAR(50) NOT NULL,           -- 'success', 'no_match', 'error', 'throttled'
  fields_returned TEXT[],                -- Which fields came back populated
  cost_units NUMERIC(10,4),             -- Provider-specific cost unit (varies by provider)
  raw_response JSONB,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Indexes:** `(contact_id, created_at DESC)`, `(provider, status)`
**Intended writers:** `contactEnrichmentWorker`, `retroSkipTrace` pipeline
**Intended readers:** Enrichment cost dashboard, provider performance analysis

---

### `message_delivery_log`

Delivery status tracking for every message across all channels (SMS, email, voice). Timestamps capture the full delivery lifecycle.

```sql
CREATE TABLE message_delivery_log (
  id BIGSERIAL PRIMARY KEY,
  message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  channel VARCHAR(50) NOT NULL,          -- 'sms', 'email', 'voice', 'whatsapp'
  provider VARCHAR(100),                 -- 'twilio', 'sendgrid', 'plivo'
  provider_message_id TEXT,              -- Provider's message SID/ID for webhook correlation
  status VARCHAR(50) NOT NULL,           -- 'queued', 'sent', 'delivered', 'failed', 'undelivered'
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
```

**Index:** `(status, created_at DESC)`
**Intended writers:** Twilio webhook handler, SendGrid event webhook
**Intended readers:** Messaging analytics, delivery rate dashboard

---

### `sentinel_actions`

Actions taken by the Sentinel AI on incidents. Records what action was attempted, its result, and any errors.

```sql
CREATE TABLE sentinel_actions (
  id BIGSERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES sentinel_incidents(id) ON DELETE CASCADE,
  action_type VARCHAR(100) NOT NULL,     -- 'send_sms', 'create_lead', 'assign_attorney', ...
  status VARCHAR(50) NOT NULL DEFAULT 'pending',   -- 'pending', 'executed', 'failed', 'skipped'
  payload JSONB,                         -- Input to the action
  result JSONB,                          -- Output from the action
  error TEXT,
  triggered_by VARCHAR(100),             -- 'sentinel_triage', 'autonomy_layer', 'operator'
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Index:** `(incident_id, created_at DESC)`
**Intended writers:** Sentinel AI action dispatcher (Stage 4)
**Intended readers:** Sentinel incident view, action audit

---

### `sentinel_incident_ai_triage`

One-to-one with `sentinel_incidents`. Stores the AI triage result: score, severity, and recommended action. Updated on re-triage.

```sql
CREATE TABLE sentinel_incident_ai_triage (
  id BIGSERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES sentinel_incidents(id) ON DELETE CASCADE,
  triage_score NUMERIC(4,3),             -- 0.000–1.000 overall priority score
  severity VARCHAR(50),                  -- 'low', 'medium', 'high', 'critical'
  confidence NUMERIC(4,3),
  recommended_action TEXT,
  reasoning TEXT,
  signals JSONB,                         -- Breakdown of signal weights used in scoring
  model VARCHAR(100),                    -- LLM model that performed the triage
  triaged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(incident_id)
);
```

**Intended writers:** Sentinel AI triage pipeline (Stage 4)
**Intended readers:** Sentinel dashboard, autonomy layer

---

### `legal_lead_delivery_log`

Delivery audit for every legal lead sent to an attorney. Captures price, timing, and acceptance/rejection outcome.

```sql
CREATE TABLE legal_lead_delivery_log (
  id BIGSERIAL PRIMARY KEY,
  legal_lead_id INTEGER NOT NULL REFERENCES legal_leads(id) ON DELETE CASCADE,
  attorney_id INTEGER REFERENCES legal_attorneys(id) ON DELETE SET NULL,
  delivery_channel VARCHAR(100) NOT NULL,   -- 'api', 'email', 'sms', 'webhook'
  status VARCHAR(50) NOT NULL,              -- 'sent', 'delivered', 'accepted', 'rejected', 'failed'
  delivered_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  price_cents INTEGER,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Index:** `(status, created_at DESC)`
**Intended writers:** Legal lead distribution pipeline
**Intended readers:** Distribution performance dashboard, attorney billing

---

### `home_service_signal_scores`

One-to-one with `home_service_signals`. AI-computed priority score for each signal.

```sql
CREATE TABLE home_service_signal_scores (
  id BIGSERIAL PRIMARY KEY,
  signal_id INTEGER NOT NULL REFERENCES home_service_signals(id) ON DELETE CASCADE,
  score NUMERIC(5,4) NOT NULL,           -- 0.0000–1.0000
  score_version VARCHAR(50),             -- Scoring model version
  signals_used JSONB,                    -- Which signals contributed and their weights
  model VARCHAR(100),
  scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(signal_id)
);
```

**Intended writers:** Home service scoring pipeline (Stage 4)
**Intended readers:** Home service lead prioritization

---

### `legal_case_ai_summary`

One-to-one with `intelligence_cases`. AI-generated structured summary with optional embedding.

```sql
CREATE TABLE legal_case_ai_summary (
  id BIGSERIAL PRIMARY KEY,
  intelligence_case_id INTEGER NOT NULL REFERENCES intelligence_cases(id) ON DELETE CASCADE,
  summary TEXT,
  key_facts TEXT[],
  recommended_actions TEXT[],
  risk_level VARCHAR(50),                -- 'low', 'medium', 'high', 'critical'
  confidence NUMERIC(4,3),
  embedding vector(1536),               -- NULL until Stage 4 population
  embedding_model VARCHAR(100),
  embedding_updated_at TIMESTAMPTZ,
  model VARCHAR(100),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(intelligence_case_id)
);
```

**Intended writers:** Legal case AI summarization pipeline (Stage 4)
**Intended readers:** Apex Intelligence brain, attorney case briefing

---

### `workflow_ai_suggestions`

AI-generated suggestions for improving existing workflows. Tracked with status so operators can apply or dismiss.

```sql
CREATE TABLE workflow_ai_suggestions (
  id BIGSERIAL PRIMARY KEY,
  workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  suggestion_type VARCHAR(100) NOT NULL,   -- 'add_step', 'reorder', 'change_trigger', 'optimize_timing'
  suggestion TEXT NOT NULL,
  reasoning TEXT,
  confidence NUMERIC(4,3),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',   -- 'pending', 'applied', 'dismissed'
  applied_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  model VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Intended writers:** Workflow AI analysis pipeline (Stage 4)
**Intended readers:** Workflow builder UI, operator review queue

---

### `brain_learning_feedback`

Feedback loop for the Apex Intelligence brain. Captures operator corrections and implicit signals for reinforcement.

```sql
CREATE TABLE brain_learning_feedback (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_id BIGINT REFERENCES universal_events(id) ON DELETE SET NULL,
  feedback_type VARCHAR(100) NOT NULL,   -- 'correction', 'approval', 'rejection', 'implicit'
  signal VARCHAR(100) NOT NULL,          -- 'score_override', 'lead_qualified', 'dismissed_recommendation'
  context JSONB,
  weight NUMERIC(5,4) NOT NULL DEFAULT 1.0,   -- Relative importance of this feedback signal
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Index:** `(signal, created_at DESC)`
**Intended writers:** Operator UI actions, autonomy layer observation
**Intended readers:** Brain learning pipeline (Stage 5)

---

## Group C — Plain INTEGER (Parent Tables Pending)

### `agent_performance_metrics`

Daily performance aggregates per agent. UNIQUE on `(agent_id, metric_date)` enables upsert-style updates.

```sql
CREATE TABLE agent_performance_metrics (
  id BIGSERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL,             -- Plain INT — ai_agents table pending
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
```

---

### `funnel_analytics`

Conversion funnel metrics by campaign/website/date. All parent IDs stored as plain INTEGER.

```sql
CREATE TABLE funnel_analytics (
  id BIGSERIAL PRIMARY KEY,
  campaign_id INTEGER,                   -- Plain INT — campaigns table pending
  website_id INTEGER,                    -- Plain INT — websites table pending
  entry_page_id INTEGER,                 -- Plain INT — website_pages table pending
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
```

---

### `ad_performance_ai_insights`

AI-generated insights for advertising campaigns. Insights are pending until an operator applies or dismisses.

```sql
CREATE TABLE ad_performance_ai_insights (
  id BIGSERIAL PRIMARY KEY,
  campaign_id INTEGER,                   -- Plain INT — campaigns table pending
  recommendation_id INTEGER,             -- Plain INT — ai_recommendations table pending
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
```

---

### `distribution_performance`

Daily distribution metrics per buyer. UNIQUE on `(buyer_id, metric_date)` enables upsert-style aggregation.

```sql
CREATE TABLE distribution_performance (
  id BIGSERIAL PRIMARY KEY,
  buyer_id INTEGER NOT NULL,             -- Plain INT — lead_buyers table pending
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
```

---

## FK Gap Resolution Log

These 7 table references were planned but the parent tables don't exist in the DB. Resolved by using plain INTEGER columns without FK constraints:

| Planned FK Target | Affected Tables | Resolution |
|------------------|-----------------|-----------|
| `legal_cases` | `legal_case_ai_summary` | → Mapped to `intelligence_cases` (exists) |
| `campaigns` | `funnel_analytics`, `ad_performance_ai_insights` | → Plain `INTEGER campaign_id` |
| `ai_agents` | `agent_performance_metrics` | → Plain `INTEGER agent_id` |
| `ai_recommendations` | `ad_performance_ai_insights` | → Plain `INTEGER recommendation_id` |
| `websites` | `funnel_analytics` | → Plain `INTEGER website_id` |
| `website_pages` | `funnel_analytics` | → Plain `INTEGER entry_page_id`, `exit_page_id` |
| `lead_buyers` | `distribution_performance` | → Plain `INTEGER buyer_id` |

FK constraints can be added in a future stage when parent tables are created.

---

## Index Summary

| Index | Table | Type | Columns |
|-------|-------|------|---------|
| `embedding_store_hnsw_cosine_idx` | `embedding_store` | HNSW cosine | `embedding` |
| `embedding_store_source_idx` | `embedding_store` | B-tree | `(source_type, source_id)` |
| `embedding_store_created_at_idx` | `embedding_store` | B-tree | `created_at DESC` |
| `agent_outcome_log_pipeline_idx` | `agent_outcome_log` | B-tree | `(pipeline, created_at DESC)` |
| `agent_outcome_log_contact_idx` | `agent_outcome_log` | B-tree (partial) | `contact_id` WHERE NOT NULL |
| `enrichment_provider_log_contact_idx` | `enrichment_provider_log` | B-tree | `(contact_id, created_at DESC)` |
| `enrichment_provider_log_provider_idx` | `enrichment_provider_log` | B-tree | `(provider, status)` |
| `sentinel_actions_incident_idx` | `sentinel_actions` | B-tree | `(incident_id, created_at DESC)` |
| `admin_audit_log_user_idx` | `admin_audit_log` | B-tree | `(user_id, created_at DESC)` |
| `admin_audit_log_action_idx` | `admin_audit_log` | B-tree | `(action, created_at DESC)` |
| `brain_learning_feedback_signal_idx` | `brain_learning_feedback` | B-tree | `(signal, created_at DESC)` |
| `message_delivery_log_status_idx` | `message_delivery_log` | B-tree | `(status, created_at DESC)` |
| `legal_lead_delivery_log_status_idx` | `legal_lead_delivery_log` | B-tree | `(status, created_at DESC)` |
