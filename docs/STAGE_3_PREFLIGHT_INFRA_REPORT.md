# STAGE 3 PRE-FLIGHT INFRASTRUCTURE REPORT
**pgvector + Operational Table Foundation**
Generated: 2026-05-14 | Pre-flight executed: 2026-05-15 ~01:50 UTC
Status: CLEARED FOR EXECUTION — all blockers resolved

---

## Executive Summary

Stage 3 is cleared. pgvector 0.8.0 is already installed and active. PostgreSQL 17.8 is fully compatible. The DB is healthy and pipelines are running. 22 new operational and vector-enabled tables will be created — all additive, none destructive.

---

## 1. Environment Verification

### PostgreSQL Version
| Field | Value |
|-------|-------|
| Version | PostgreSQL 17.8 (ad62774) |
| Architecture | aarch64 |
| Platform | Neon serverless (aws-us-east-1) |
| Project | `patient-surf-58659251` |

### pgvector Extension Status

| Field | Value |
|-------|-------|
| Extension name | `vector` |
| Available version | 0.8.0 |
| Installed version | **0.8.0** ✅ |
| Install namespace | `public` |
| HNSW support | ✅ (added in 0.5.0) |
| IVFFlat support | ✅ |
| Cosine similarity | ✅ `vector_cosine_ops` |

**Critical finding:** `pgvector` is already installed and active. No `CREATE EXTENSION` is needed. The migration is idempotent: `CREATE EXTENSION IF NOT EXISTS vector` will be included as a no-op guard.

### Other Available Extensions (Not Yet Installed)

| Extension | Version | Use Case | Stage |
|-----------|---------|----------|-------|
| `pg_trgm` | 1.6 | Fuzzy text search | Future |
| `btree_gin` | 1.3 | GIN indexes on common types | Future |
| `btree_gist` | 1.7 | GiST indexes | Future |
| `pg_stat_statements` | 1.11 | Query performance monitoring | Future |
| `uuid-ossp` | 1.1 | UUID generation (using gen_random_uuid() instead) | Not needed |

---

## 2. Database Size Metrics (Pre-Stage 3 Snapshot)

### Overall Metrics
| Metric | Value |
|--------|-------|
| Total DB size | 149 MB |
| Public schema table count | 154 tables |
| Total table data | 113 MB (excluding system tables/WAL) |
| Largest table | `universal_events` (61 MB, 228,183 rows) |
| Second largest | `contacts` (13 MB, 9,522 rows) |
| Third largest | `legal_leads` (11 MB, 19,442 rows) |

### Active Data Tables (non-empty)
| Table | Data Size | Row Count |
|-------|-----------|-----------|
| `universal_events` | 43 MB | 228,183 |
| `contacts` | 12 MB | 9,522 |
| `legal_leads` | 6.5 MB | 19,442 |
| `legal_signals` | 2.2 MB | active |
| `sentinel_incidents` | 4.8 MB | 7,170+ |
| `crash_reports` | 3.6 MB | active |
| `intelligence_cases` | 1.4 MB | active |
| `agent_tasks` | 248 kB | active |
| `agent_memories` | 168 kB | active |

### Empty Tables (16 kB overhead each, 0 data rows)
87 tables at 16 kB each = ~1.4 MB overhead. Normal and expected.

---

## 3. Storage Impact Estimate for Stage 3

### New Operational Tables (22 tables, no vector data initially)
| Category | Tables | Estimated Initial Size |
|----------|--------|----------------------|
| Operational tables (no vector) | 19 | ~16 kB each → ~304 kB |
| `embedding_store` (with HNSW index) | 1 | ~64 kB (empty + index overhead) |
| `contact_ai_profiles` (vector column, no data) | 1 | ~16 kB |
| `legal_case_ai_summary` (vector column, no data) | 1 | ~16 kB |
| **Total immediate impact** | 22 | **~400 kB** |

### Future Storage Projections (when vectors are populated)

| Source | Rows | Dimensions | Vector Size | Table Size |
|--------|------|-----------|-------------|------------|
| Contacts | 9,522 | 1536 | 6.1 KB each | ~58 MB |
| Intelligence cases | ~800 | 1536 | 6.1 KB each | ~4.9 MB |
| Sentinel incidents | 7,170 | 1536 | 6.1 KB each | ~43 MB |
| Legal leads | 19,442 | 1536 | 6.1 KB each | ~119 MB |
| Documents/conversations | TBD | 1536 | 6.1 KB each | TBD |

**Note:** Neon scales compute dynamically. Vector storage is billed as regular storage. At current row counts, full contact embedding would add ~58 MB (within the existing 149 MB budget). Neon Pro plan handles this without issue.

### HNSW Index Memory Impact on `embedding_store`
| Metric | Value |
|--------|-------|
| HNSW `m` parameter | 16 (default) |
| `ef_construction` | 64 (default) |
| Index overhead per vector | ~16 × 2 × 4 bytes = 128 bytes per node |
| At 9,522 vectors | ~1.2 MB index RAM |
| Neon RAM | Scales with compute tier; no issue |

HNSW is chosen over IVFFlat because:
1. Works on empty tables (no training data required)
2. No `lists` parameter tuning needed
3. Better recall at comparable throughput for datasets < 1M vectors
4. Auto-rebuilds as data is inserted (no manual VACUUM ANALYZE + REINDEX)

---

## 4. Query Performance Impact Estimate

### Existing Query Patterns (unaffected)
Stage 3 creates only NEW tables. Zero changes to existing table schemas, indexes, or query paths.

| Pattern | Impact |
|---------|--------|
| Contact list queries | ✅ Unaffected — no schema change to `contacts` |
| Universal events pipeline | ✅ Unaffected |
| Sentinel ingestion | ✅ Unaffected |
| Legal lead pipeline | ✅ Unaffected |
| Auth/session queries | ✅ Unaffected |

### New Query Patterns Enabled by Stage 3
| Query Pattern | Table | Expected Latency |
|--------------|-------|-----------------|
| Embedding similarity search | `embedding_store` HNSW | 1–50 ms for top-k |
| Agent outcome lookup | `agent_outcome_log` | <5 ms (indexed) |
| Sentinel action history | `sentinel_actions` | <5 ms (indexed) |
| Enrichment provider audit | `enrichment_provider_log` | <10 ms |
| Contact AI profile lookup | `contact_ai_profiles` | <5 ms (B-tree on contact_id) |

---

## 5. Extension Conflict Check

| Extension | Status | Conflict Risk |
|-----------|--------|--------------|
| `vector` (pgvector) | Already installed | ✅ No conflict |
| `plpgsql` (built-in) | Active | ✅ No conflict |
| No other extensions installed | — | ✅ Clean slate |

**Finding:** No extension conflicts. Clean installation state.

---

## 6. Foreign Key Target Verification

Before creating tables, all FK references were verified against the live DB.

### FK Targets: EXIST ✅
| Target Table | Used By |
|-------------|---------|
| `sub_accounts` | account_tier_history, api_keys, twilio_account_registry |
| `contacts` | contact_ai_profiles, contact_merge_log, enrichment_provider_log |
| `users` | account_tier_history, admin_audit_log, api_keys, contact_merge_log, brain_learning_feedback |
| `legal_leads` | legal_lead_delivery_log |
| `legal_attorneys` | legal_lead_delivery_log |
| `messages` | message_delivery_log |
| `workflows` | workflow_ai_suggestions |
| `home_service_signals` | home_service_signal_scores |
| `sentinel_incidents` | sentinel_actions, sentinel_incident_ai_triage |
| `intelligence_cases` | legal_case_ai_summary (mapped from `legal_cases`) |
| `universal_events` | brain_learning_feedback |

### FK Targets: DO NOT EXIST — FK Constraint Dropped
| Planned Target | Status | Resolution |
|---------------|--------|-----------|
| `legal_cases` | NOT IN DB | → Map to `intelligence_cases` |
| `campaigns` | NOT IN DB | → `campaign_id` stored as plain INTEGER |
| `ai_agents` | NOT IN DB | → `agent_id` stored as plain INTEGER |
| `ai_recommendations` | NOT IN DB | → `recommendation_id` stored as plain INTEGER |
| `websites` | NOT IN DB | → `website_id` stored as plain INTEGER |
| `website_pages` | NOT IN DB | → `entry_page_id`, `exit_page_id` stored as plain INTEGER |
| `lead_buyers` | NOT IN DB | → `buyer_id` stored as plain INTEGER |

**Approach:** Use plain INTEGER columns without FK constraints for non-existent parent tables. This allows the Stage 3 tables to be created safely today and FK constraints to be added in a future stage when the parent tables are created.

---

## 7. Rollback Strategy

All Stage 3 objects are additive and independently reversible.

### Table Rollback
```sql
-- Drop all Stage 3 tables (reverse dependency order):
DROP TABLE IF EXISTS embedding_store CASCADE;
DROP TABLE IF EXISTS legal_case_ai_summary CASCADE;
DROP TABLE IF EXISTS contact_ai_profiles CASCADE;
DROP TABLE IF EXISTS brain_learning_feedback CASCADE;
DROP TABLE IF EXISTS distribution_performance CASCADE;
DROP TABLE IF EXISTS enrichment_provider_log CASCADE;
DROP TABLE IF EXISTS home_service_signal_scores CASCADE;
DROP TABLE IF EXISTS legal_lead_delivery_log CASCADE;
DROP TABLE IF EXISTS sentinel_incident_ai_triage CASCADE;
DROP TABLE IF EXISTS sentinel_actions CASCADE;
DROP TABLE IF EXISTS ad_performance_ai_insights CASCADE;
DROP TABLE IF EXISTS funnel_analytics CASCADE;
DROP TABLE IF EXISTS agent_performance_metrics CASCADE;
DROP TABLE IF EXISTS workflow_ai_suggestions CASCADE;
DROP TABLE IF EXISTS twilio_account_registry CASCADE;
DROP TABLE IF EXISTS message_delivery_log CASCADE;
DROP TABLE IF EXISTS contact_merge_log CASCADE;
DROP TABLE IF EXISTS agent_outcome_log CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS admin_audit_log CASCADE;
DROP TABLE IF EXISTS account_tier_history CASCADE;

-- Remove migration tracking:
DELETE FROM _data_migrations WHERE name = '2026-05-14-stage3-operational-tables';

-- pgvector extension (DO NOT REMOVE — was pre-existing before Stage 3):
-- Extension was already installed before Stage 3 started. Do not DROP.
```

**Safe to rollback if:** No application code writes to the new tables.
**Not safe to rollback if:** `agent_outcome_log` has started receiving data from `reportOutcome` pipeline.

### Extension Rollback
**DO NOT roll back the `vector` extension.** It was already installed before Stage 3 began. Rolling it back would drop all vector columns and any future vector indexes.

---

## 8. Pre-Flight Row Count Snapshot (for post-deploy comparison)

| Table | Row Count |
|-------|-----------|
| contacts | 9,522 |
| universal_events | 228,183 |
| sentinel_incidents | 7,170+ |
| legal_leads | 19,442 |
| intelligence_cases | active |
| sub_accounts | 5 |
| users | 2 |
| feature_flags | 81 |
| workflows | 4 |
| _data_migrations | 6 |

---

## 9. Migration Tracking State (Pre-Stage 3)

| Migration | Applied At |
|-----------|-----------|
| 2026-04-25-dedupe-apex-module-coverage | 2026-05-11 12:40 UTC |
| 2026-05-13-standalone-card-leads | 2026-05-13 16:18 UTC |
| 2026-05-13-standalone-card-leads-owner-notes | 2026-05-13 16:33 UTC |
| 2026-05-13-standalone-card-services | 2026-05-14 11:13 UTC |
| 2026-05-14-contact-lifecycle-fields | 2026-05-15 01:02 UTC |
| 2026-05-14-users-role-column | 2026-05-15 01:31 UTC |
| **2026-05-14-stage3-operational-tables** | **PENDING** |

---

## 10. Execution Decision

| Gate | Status |
|------|--------|
| pgvector installed | ✅ 0.8.0 — no action needed |
| PostgreSQL version compatible | ✅ PG17.8 |
| HNSW support available | ✅ |
| DB healthy (pipelines running) | ✅ |
| Backup branch created | ✅ pre-stage3-migration-20260514 |
| FK targets verified | ✅ 6 non-existent targets resolved |
| Rollback SQL written | ✅ |
| Storage impact acceptable | ✅ ~400 kB immediate, scalable |

**CLEARED FOR EXECUTION.**
