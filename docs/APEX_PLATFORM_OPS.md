# APEX PLATFORM OPS
**Observability, Logging, Queue Health, and SLA Metrics**
Version: 1.0 | Generated: 2026-05-15
Phase: Ongoing

---

## Purpose

Platform Ops is the operational nervous system of the Apex Intelligence OS. It provides full observability into every signal ingestion, enrichment action, routing decision, AI call, and queue state — so that operators and engineers can detect problems before they affect customers.

**No silent failures. Every error writes a log. Every queue has a health metric. Every AI call has a cost trace.**

---

## Infrastructure Summary

| Component | Provider | Status |
|-----------|----------|--------|
| Database | Neon Postgres 17.8 | ✅ Live — `br-blue-moon-aqq8y9j9` |
| Vector store | pgvector 0.8.0 + HNSW | ✅ Live |
| Application host | Railway | ✅ Live |
| Crash ingestion | Sentinel / Apify | ✅ Live, ~960/day |
| Skip trace | BatchData API | ✅ Live |
| Auth | Role-based + internalOnly middleware | ✅ Live |
| Embedding workers | None | ❌ Paused — Stage 4 |
| Semantic search | None | ❌ Paused — Phase 7 |
| AI memory | None | ❌ Paused — Phase 9 |

---

## Observability Tables (Live)

### `agent_outcome_log`

Every AI agent action, worker execution, and background job result is logged here:

```sql
-- Schema (already live in production)
id BIGSERIAL PRIMARY KEY
agent_type     VARCHAR(100)    -- 'embedding_worker', 'skip_trace', 'routing_engine'
entity_id      BIGINT          -- contact_id, incident_id, etc.
action         VARCHAR(200)    -- 'embed_contact', 'skip_trace_attempt', 'route_contact'
status         VARCHAR(50)     -- 'success', 'failure', 'skipped', 'partial'
tokens_used    INTEGER         -- AI tokens consumed (0 for non-AI actions)
latency_ms     INTEGER         -- operation duration
error_message  TEXT            -- populated on failure
metadata       JSONB           -- arbitrary context
created_at     TIMESTAMPTZ
```

**Log every:**
- Skip trace attempt (success and failure)
- Routing decision (rule matched, contact assigned)
- Export attempt (contact exported)
- Embedding operation (entity embedded)
- AI summary generation (tokens used, model, latency)
- Dedup decision (fingerprint matched or new)

### `enrichment_provider_log`

Tracks every call to external enrichment providers:

```sql
-- Schema (already live in production)
id BIGSERIAL PRIMARY KEY
contact_id     INTEGER         -- NULL for signal-level calls
provider       VARCHAR(100)    -- 'batchdata', 'sentinel_crash', 'courtlistener', 'cpsc'
request_type   VARCHAR(100)    -- 'skip_trace', 'phone_append', 'signal_ingest'
status         VARCHAR(50)     -- 'success', 'not_found', 'error', 'rate_limited'
response_time_ms INTEGER
credits_used   INTEGER         -- API credits consumed
error_code     VARCHAR(50)
created_at     TIMESTAMPTZ
```

### `skip_trace_requests`

Full audit trail for every skip trace attempt:

```sql
-- Schema (live, created in Stage 3.5)
id BIGSERIAL PRIMARY KEY
contact_id     INTEGER NOT NULL
triggered_by   TEXT            -- user_id or 'system'
trigger_type   TEXT            -- 'manual', 'auto', 'queue'
provider       TEXT            -- 'batchdata'
status         TEXT            -- 'pending', 'success', 'not_found', 'error'
input_address  TEXT
input_name     TEXT
phone_found    TEXT
email_found    TEXT
phones_total   INTEGER
emails_total   INTEGER
credits_used   INTEGER
error_code     TEXT
error_message  TEXT
requested_at   TIMESTAMPTZ
completed_at   TIMESTAMPTZ
```

### `contact_enrichment_events`

Records every field-level change on a contact, with before/after values:

```sql
-- Schema (live, created in Stage 3.5)
id BIGSERIAL PRIMARY KEY
contact_id     INTEGER NOT NULL
event_type     TEXT            -- 'phone_appended', 'export_eligible_set', etc.
field_changed  TEXT            -- 'phone', 'email', 'export_eligible'
old_value      TEXT
new_value      TEXT
source         TEXT            -- 'batchdata', 'manual', 'crash_ingest'
confidence     NUMERIC(4,3)
triggered_by   TEXT
created_at     TIMESTAMPTZ
```

### `contact_routing_audit`

Every routing rule match and contact assignment:

```sql
-- Schema (live)
contact_id              INTEGER
rule_id                 INTEGER
target_sub_account_id   INTEGER
route_reason            TEXT
created_at              TIMESTAMPTZ
-- Enhanced in Phase 4D: sla_hours, sla_deadline, responded_at, sla_met
```

### `universal_events`

Platform-wide event bus. All significant state changes emit here:

```sql
-- Schema (already live in production)
id BIGSERIAL PRIMARY KEY
event_type     VARCHAR(200)    -- namespaced: 'contact.created', 'signal.received', etc.
entity_type    VARCHAR(100)    -- 'contact', 'incident', 'legal_signal', 'case'
entity_id      BIGINT
sub_account_id INTEGER
metadata       JSONB
created_at     TIMESTAMPTZ
```

**Standard event namespace:**
```
signal.received
signal.fingerprint_computed
signal.duplicate_detected
incident.created
incident.severity_scored
incident.enrichment_queued
contact.created
contact.merged
contact.export_eligible_set
contact.skip_trace_triggered
contact.phone_appended
contact.email_appended
contact.routed
contact.exported
case.created
case.assigned
case.retained
routing.sla_breached
embedding.created
embedding.cap_reached
```

### `signal_source_health`

Tracks connector status across all signal sources (Phase 4A — planned):

```sql
-- Schema (planned — see APEX_SIGNAL_ENGINE.md)
connector               VARCHAR(100)
last_successful_fetch   TIMESTAMPTZ
consecutive_failures    INTEGER
avg_fetch_latency_ms    INTEGER
records_last_run        INTEGER
records_total           BIGINT
status                  VARCHAR(50)   -- healthy, degraded, down
```

---

## Alerting Thresholds

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Crash ingest rate | < 600/day | < 300/day | Check Sentinel/Apify connector |
| Skip trace success rate | < 50% | < 30% | Check BatchData quota |
| Export-eligible contacts | < 800 | < 500 | Check enrichment pipeline |
| Routing rule match rate | < 70% | < 50% | Review routing rule coverage |
| DB storage growth | > 500 MB/day | > 1 GB/day | Evaluate archival policy |
| Signal source failures | 3 consecutive | 5 consecutive | Alert + pause connector |
| Agent_outcome_log errors | > 20/hour | > 100/hour | Investigate error type |
| Railway memory usage | > 400 MB | > 512 MB | Scale or investigate leak |
| HNSW query latency | > 20ms p95 | > 50ms p95 | Check index, ef_search |

---

## Daily Operations Checklist

Run these queries every morning to verify platform health:

```sql
-- 1. Crash ingest volume (last 24h)
SELECT COUNT(*) AS crashes_last_24h
FROM sentinel_incidents
WHERE created_at >= NOW() - INTERVAL '24 hours';

-- 2. Skip trace success rate (last 7 days)
SELECT
  status,
  COUNT(*) AS count,
  ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS pct
FROM skip_trace_requests
WHERE requested_at >= NOW() - INTERVAL '7 days'
GROUP BY status;

-- 3. Export-eligible contact count
SELECT COUNT(*) AS export_eligible
FROM contacts
WHERE export_eligible = true;

-- 4. Agent errors (last 24h)
SELECT agent_type, action, COUNT(*) AS errors
FROM agent_outcome_log
WHERE status = 'failure'
  AND created_at >= NOW() - INTERVAL '24 hours'
GROUP BY 1, 2
ORDER BY 3 DESC
LIMIT 20;

-- 5. Routing rule match rate (last 7 days)
SELECT
  COUNT(*) FILTER (WHERE route_reason IS NOT NULL) AS matched,
  COUNT(*) AS total,
  ROUND(COUNT(*) FILTER (WHERE route_reason IS NOT NULL)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS match_rate
FROM contact_routing_audit
WHERE created_at >= NOW() - INTERVAL '7 days';

-- 6. DB size trend
SELECT
  pg_size_pretty(pg_database_size(current_database())) AS total_db_size;

-- 7. Largest tables
SELECT
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  n_live_tup AS live_rows
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 15;
```

---

## Neon Branch Management

| Branch | Purpose | Access |
|--------|---------|--------|
| `main` (br-blue-moon-aqq8y9j9) | Production | Read-write via Railway |
| `dev` | Development + migration testing | Engineers only |
| `migration-YYYY-MM-DD` | Migration testing | Temporary, delete after verify |

**Never run DDL migrations directly on main without testing on a branch first.**

**Before any schema change:**
1. Create a new Neon branch from main
2. Run migration on the branch
3. Verify with SELECT queries
4. Apply to main via dataMigrations.ts on Railway deploy

---

## Queue Health Monitoring

When enrichment queue is activated (Phase 4A), monitor:

```sql
-- Enrichment queue depth
SELECT queue_type, status, priority, COUNT(*) AS count
FROM enrichment_queue
GROUP BY 1, 2, 3
ORDER BY priority, queue_type;

-- Stale queue items (pending > 1 hour)
SELECT COUNT(*) AS stale_pending
FROM enrichment_queue
WHERE status = 'pending'
  AND created_at < NOW() - INTERVAL '1 hour';

-- Failed attempts breakdown
SELECT error_message, COUNT(*) AS count
FROM enrichment_queue
WHERE status = 'failed'
  AND last_attempted_at >= NOW() - INTERVAL '24 hours'
GROUP BY 1
ORDER BY 2 DESC;
```

---

## Cost Monitoring

Track all external API costs in `agent_outcome_log.tokens_used` and a dedicated cost table:

```sql
CREATE TABLE api_cost_log (
  id BIGSERIAL PRIMARY KEY,
  provider VARCHAR(100) NOT NULL,         -- 'openai', 'batchdata', 'apify'
  operation VARCHAR(200),                 -- 'embed_contact', 'skip_trace', 'scrape'
  units_consumed BIGINT,                  -- tokens, API calls, or credits
  unit_type VARCHAR(50),                  -- 'tokens', 'credits', 'calls'
  cost_cents INTEGER,                     -- cost in cents (0 if free)
  sub_account_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_cost_log_provider ON api_cost_log(provider, created_at DESC);
```

**Daily cost budget alerts:**
```
OpenAI (embeddings) > $1.00/day   → Warning
OpenAI (embeddings) > $5.00/day   → Critical (kill embedding worker)
BatchData credits  < 100 remaining → Warning
BatchData credits  < 20 remaining  → Critical (pause skip trace)
```

---

## Platform Health Admin Endpoint

```
GET /api/internal/platform-health    (internalOnly middleware)

Response:
{
  db: { size_mb: 234, largest_tables: [...] },
  signals: { crashes_24h: 962, legal_24h: 123 },
  enrichment: { skip_trace_success_7d: "67%", export_eligible: 990 },
  routing: { routes_24h: 45, sla_breach_rate: "0%" },
  queue: { pending: 0, failed: 0, stale: 0 },
  costs: { openai_today_cents: 0, batchdata_credits_remaining: 847 },
  embedding: { total_embedded: 0, worker_status: "paused" },
  stage4_status: "PAUSED — observation window active"
}
```

---

## Stage 4 Clearance Gates (from STAGE_3_OBSERVATION_WINDOW.md)

Before activating any Stage 4 capability, all 8 gates must be cleared:

- [ ] 72-hour observation window completed (starts 2026-05-15)
- [ ] Zero agent_outcome_log errors from the dataMigration job
- [ ] Zero routing rule failures from `contact_routing_audit`
- [ ] Skip trace success rate >= 40% over 48 hours
- [ ] Export endpoint returning export_eligible=true contacts only
- [ ] DB storage growth < 500 MB/day
- [ ] Railway memory usage < 400 MB sustained
- [ ] Signal source health: sentinel connector shows healthy for 72+ hours

**Stage 4 is PAUSED until all gates are cleared.**

---

## Phase 4A Deliverables (Platform Ops)

- [x] `agent_outcome_log` — live
- [x] `enrichment_provider_log` — live
- [x] `skip_trace_requests` — live
- [x] `contact_enrichment_events` — live
- [x] `contact_routing_audit` — live
- [x] `universal_events` — live
- [ ] `signal_source_health` table (Phase 4A)
- [ ] `api_cost_log` table
- [ ] `GET /api/internal/platform-health` endpoint
- [ ] `GET /api/internal/signal-health/:connector` endpoint
- [ ] Daily ops checklist automation (cron-driven health check job)
- [ ] SLA breach alerting (Phase 4D)
- [ ] Cost budget enforcement (Phase 7 — before embedding activation)
