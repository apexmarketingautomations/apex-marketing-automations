# STAGE 3 OBSERVATION WINDOW
**Apex Marketing Automations — AI Infrastructure Stability Assessment**
Generated: 2026-05-15
Status: ACTIVE OBSERVATION — Stage 4 execution PAUSED pending clearance

---

## Purpose

Stage 3 established the vector, operational, and routing infrastructure. Before activating any
intelligence workloads (embedding workers, semantic search, AI memory, RAG pipelines), this window
verifies the new infrastructure is operationally stable under real ingestion traffic.

**Stage 4 is NOT active.** None of the following are running:
- Auto-embedding workers
- Semantic indexing jobs
- AI memory orchestration
- Recursive AI summaries
- RAG pipelines
- Autonomous retrieval systems
- Production semantic UI search

---

## 1. Current Operational Metrics (Snapshot: 2026-05-15 ~05:30 UTC)

### 1.1 Database

| Metric | Value | Δ from Pre-Stage 3 |
|--------|-------|--------------------|
| Total DB size | **155 MB** | +6 MB (+4%) |
| Table count | **179 tables** | +25 tables |
| Largest table | `universal_events` — 63 MB, 237,734 rows | — |
| Contacts | 14 MB, 9,562 rows | +5 routing columns |
| Legal leads | 12 MB, 20,128 rows | unchanged |
| Legal signals | 7.5 MB, 3,153 rows | unchanged |
| Sentinel incidents | 5.3 MB, 7,449 rows | unchanged |
| Crash reports | 4 MB, 3,092 rows | unchanged |
| Intelligence cases | 2.3 MB, 1,251 rows | unchanged |

### 1.2 New Infrastructure Tables (all empty — no intelligence workloads active)

| Table | Size | Rows | Status |
|-------|------|------|--------|
| `embedding_store` | 56 kB | 0 | HNSW index loaded, zero vectors |
| `contact_ai_profiles` | 24 kB | 0 | Schema only |
| `legal_case_ai_summary` | 24 kB | 0 | Schema only |
| `agent_outcome_log` | 32 kB | 0 | Indexes loaded, awaiting writes |
| `enrichment_provider_log` | 32 kB | 0 | Indexes loaded, awaiting writes |
| `skip_trace_requests` | 16 kB | 0 | Awaiting first manual action |
| `contact_enrichment_events` | 16 kB | 0 | Awaiting first manual action |
| `contact_routing_rules` | ~40 kB | 12 | 12 seeded routing rules |
| `contact_routing_audit` | 24 kB | 0 | Awaiting first routing write |

### 1.3 Contact Pipeline Health

| Segment | Count | % of Total |
|---------|-------|-----------|
| Total contacts | 9,562 | 100% |
| Export eligible | **990** | **10.4%** |
| Individuals | 5,073 | 53.1% |
| Recall entities | 3,659 | 38.3% |
| Local businesses | 766 | 8.0% |
| Placeholders | 64 | 0.7% |
| Has phone | 1,801 | 18.8% |
| Has email | 21 | 0.2% |
| Skip-traced (matched) | 34 | 0.4% |

> **Observation:** 1,801 contacts have phones but only 990 are export-eligible. The gap (811) is
> individuals with real phones but either empty first_name, placeholder name, or entity-type lead_type.
> This is expected — the `export_eligible` logic is conservative by design.

### 1.4 Ingestion Rate Baselines (from 30-min post-deploy window, 2026-05-15 ~02:00 UTC)

| Pipeline | Rate | Per Hour | Per Day (projected) |
|----------|------|----------|---------------------|
| Crash ingest | 20 events / 30 min | ~40/hr | ~960/day |
| Crash leads created | 10 / 30 min | ~20/hr | ~480/day |
| Agent outcomes | 32 / 30 min | ~64/hr | ~1,536/day |
| Autonomy cycles | 9 / 30 min | ~18/hr | ~432/day |
| Score updates | 1,596 / ~10 min | ~9,576/hr | ~229,824/day |
| Strategic insights | 6 / 13 min | ~28/hr | ~662/day |
| Cognitive memories stored | 12 / 13 min | ~55/hr | ~1,330/day |
| Messages sent | 6 / 3 min | ~120/hr | ~2,880/day |

---

## 2. DB Growth Projections

### 2.1 Without Embedding Population (Organic Growth Only)

| Horizon | Contacts | Incidents | Legal Leads | Est. DB Size |
|---------|----------|-----------|-------------|-------------|
| Current | 9,562 | 7,449 | 20,128 | 155 MB |
| 30 days | ~23,962 | ~36,249 | ~34,528 | ~230 MB |
| 90 days | ~52,162 | ~93,849 | ~63,728 | ~390 MB |
| 180 days | ~94,562 | ~180,249 | ~107,528 | ~650 MB |

*Assumes: crashes +960/day, incidents +960/day, legal leads ~500/day*

### 2.2 With Full Embedding Population (Stage 4 activated)

Each 1536-dim float32 vector occupies **6,144 bytes (6.1 kB)** in `embedding_store`.
HNSW graph overhead adds ~128 bytes per node.

| Entity | Current Rows | Vector Data | HNSW Index RAM |
|--------|-------------|-------------|----------------|
| Contacts | 9,562 | 58 MB | 1.2 MB |
| Legal leads | 20,128 | 123 MB | 2.6 MB |
| Sentinel incidents | 7,449 | 45 MB | 0.95 MB |
| Intelligence cases | 1,251 | 7.6 MB | 0.16 MB |
| **Total** | **38,390** | **~234 MB** | **~5 MB** |

**Post-embedding DB size: ~155 MB + ~234 MB = ~389 MB**

At 30-day organic growth + embedding all new records:
~230 MB base + ~87 MB new vectors = **~317 MB additional** → **~547 MB total**

Neon Pro plan supports up to **10 GB** of storage. Current trajectory reaches 1 GB around
**month 6** if all entity types are embedded. Well within limits for the observation period.

---

## 3. Expected Embedding Costs

### 3.1 Initial Backfill Cost (one-time)

Using `text-embedding-3-small` at **$0.00002 per 1K tokens**:

| Entity | Rows | Avg Tokens | Total Tokens | Cost |
|--------|------|-----------|-------------|------|
| Contacts | 9,562 | 20 | 191K | $0.0038 |
| Legal leads | 20,128 | 30 | 604K | $0.0121 |
| Sentinel incidents | 7,449 | 60 | 447K | $0.0089 |
| Intelligence cases | 1,251 | 80 | 100K | $0.0020 |
| **Total backfill** | **38,390** | — | **~1.34M** | **~$0.027** |

> **Initial backfill costs approximately $0.03. Negligible.**

### 3.2 Ongoing Embedding Cost (per day, post-activation)

| Source | New Records/Day | Avg Tokens | Daily Tokens | Daily Cost |
|--------|----------------|-----------|-------------|-----------|
| New crash contacts | 480 | 20 | 9.6K | $0.00019 |
| New incidents | 960 | 60 | 57.6K | $0.00115 |
| New legal leads | 500 | 30 | 15K | $0.00030 |
| New cases | ~4 | 80 | 320 | $0.000006 |
| **Daily total** | **~1,944** | — | **~82.5K** | **~$0.0017** |

**Monthly ongoing embedding cost: ~$0.05**
**Annual ongoing embedding cost: ~$0.62**

> Embedding costs are operationally negligible. The bottleneck is API rate limits and
> Railway CPU, not token cost.

### 3.3 Expected Token Costs (LLM inference — not yet active)

These apply only when `legal_case_ai_summary` population begins (Stage 6):

| Operation | Model | Tokens/Op | Cost/Op | Monthly Volume | Monthly Cost |
|-----------|-------|-----------|---------|----------------|-------------|
| Case summary generation | GPT-4o | ~2,000 in + 500 out | ~$0.013 | ~120 cases | ~$1.56 |
| Contact AI profile | GPT-4o mini | ~500 in + 200 out | ~$0.0001 | ~14,400/mo | ~$1.44 |
| Skip trace intent signal | GPT-4o mini | ~300 in + 100 out | ~$0.00006 | ~480/day | ~$0.87/mo |

**Total projected LLM cost at Stage 5–6 activation: ~$3–5/month**

---

## 4. Vector Index Performance

### 4.1 HNSW Index Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| Index type | HNSW | Hierarchical Navigable Small World |
| Operator class | `vector_cosine_ops` | Cosine similarity (OpenAI L2-normalized vectors) |
| `m` | 16 | Neighbors per node — default |
| `ef_construction` | 64 | Build-time search depth — default |
| `ef_search` (default) | 40 | Query-time recall depth |

### 4.2 Expected Query Latency by Vector Count

| Vector Count | ef_search=40 | ef_search=100 | ef_search=200 |
|-------------|-------------|--------------|--------------|
| 1,000 | <1 ms | <1 ms | <1 ms |
| 10,000 | 1–3 ms | 2–5 ms | 3–8 ms |
| 38,390 (current backfill target) | 2–5 ms | 4–10 ms | 6–15 ms |
| 100,000 | 5–10 ms | 8–18 ms | 12–25 ms |
| 500,000 | 10–20 ms | 15–35 ms | 20–50 ms |

> At the current 38K target vector count, even `ef_search=200` returns results in <15ms.
> HNSW tuning is not a concern until the index exceeds ~200K vectors (~12 months of growth).

### 4.3 Index Maintenance

HNSW auto-updates on every INSERT. No REINDEX required for incremental population.

If deleted rows exceed 10% of total (e.g., contact deduplication purge):
```sql
REINDEX INDEX CONCURRENTLY embedding_store_hnsw_cosine_idx;
-- Estimated duration at 38K vectors: <30 seconds, zero read locks
```

---

## 5. Pipeline Throughput Projections

### 5.1 Embedding Worker Throughput (when activated)

The Stage 4 embedding worker design uses batches of 100 with 200ms throttle.

| Metric | Value |
|--------|-------|
| Batch size | 100 vectors |
| Throttle between batches | 200ms |
| Theoretical throughput | 500 vectors/min |
| OpenAI API rate limit (tier 1) | 500 RPM / 200K TPM |
| Effective throughput (token-limited) | ~2,400 vectors/hour at 20 tokens avg |
| Time to embed full 38,390 backfill | **~16 hours** (single worker, conservative) |
| Time to embed with 5 parallel batches | **~3.2 hours** |

> Recommended backfill approach: single worker, off-peak hours (02:00–06:00 UTC),
> contacts first (cheapest, most value), incidents second, legal leads third.

### 5.2 Daily New Record Embedding (steady state)

At ~1,944 new records/day × 200ms/batch ÷ 100/batch = **~3.9 seconds/day** of worker time.
This is trivially small — a scheduled cron every 15 minutes with a 10-batch cap handles it easily.

### 5.3 Queue Health (current)

No embedding queue exists yet (Stage 4 not activated). Contacts awaiting embedding: **38,390**.
No jobs are backed up. The queue is flat and ready.

---

## 6. Scaling Bottlenecks

### 6.1 Current Bottlenecks (Observed)

| Bottleneck | Severity | Impact | Mitigation |
|-----------|---------|--------|-----------|
| `universal_events` table growth | MEDIUM | 63 MB / 237K rows — largest table. ~2.5K rows/day | Archive events older than 90 days to cold storage |
| No phone for 81% of contacts | HIGH | Skip trace coverage too low to be client-useful | Embedding + scoring will prioritize which contacts to skip-trace |
| Score update volume | MEDIUM | 1,596 score updates per 10 min = ~230K/day | Ensure `intelligence_scores` index on `updated_at` |
| Recall entity contamination | HIGH | 38% of contacts are non-exportable entities | Already fixed via `export_eligible` column |
| Crash placeholder accumulation | LOW | 64 placeholders, growing ~1/day | Already gated by `export_eligible = false` |

### 6.2 Future Bottlenecks (Projected at Stage 4+)

| Bottleneck | Trigger Point | Mitigation |
|-----------|--------------|-----------|
| HNSW memory overhead | ~200K vectors (~$5/mo RAM) | Neon auto-scales compute; acceptable |
| OpenAI embedding rate limits | >500 RPM concurrent requests | Batch worker with 200ms throttle stays well under |
| Neon connection pool saturation | >50 concurrent connections | Already using Neon serverless pooler |
| `embedding_store` table bloat | >500K vectors | Implement retention policy (see §9) |
| `contact_enrichment_events` log growth | >1M rows (~12 months) | Partition by month or archive >6 months |

---

## 7. Recommended Stage 4 Rollout Strategy

Stage 4 should activate in **three phases**, each separated by a 48-hour observation window.

### Phase 4A — Contacts Only (lowest risk)

**Activate:**
- Embedding population worker (contacts table only)
- Batch size: 100, throttle: 500ms (conservative)
- Run window: 02:00–06:00 UTC daily until backfill complete
- Target: embed all 9,562 contacts (~3 hours)

**Gate to Phase 4B:**
- Zero Railway errors during embed run
- `embedding_store` count = 9,562
- Cosine similarity self-test passes on 10 random contacts
- DB size within projected range (+60 MB)

### Phase 4B — Semantic Search API (read-only, no writes)

**Activate:**
- `GET /api/contacts/search?q=:text` endpoint (text → embedding → cosine similarity → top 20)
- `GET /api/contacts/:id/similar` endpoint (contact → similar contacts)
- `ef_search = 40` (default, fast)

**Gate to Phase 4C:**
- p50 latency < 10ms, p99 < 50ms on 100 test queries
- Zero embedding errors in logs
- No increase in DB connection saturation

### Phase 4C — Full Entity Embedding (incidents, legal leads, cases)

**Activate:**
- Extend worker to cover `sentinel_incidents`, `legal_leads`, `intelligence_cases`
- Same throttle and window strategy as Phase 4A
- Total additional: 28,828 vectors

**Gate to Stage 5:**
- All 38,390 vectors present in `embedding_store`
- Cross-entity search working (contact ↔ incident similarity)
- HNSW index stats healthy (no graph degradation)

---

## 8. Recommended Embedding Throttling Strategy

| Scenario | Batch Size | Throttle | Concurrency | Notes |
|----------|-----------|---------|-------------|-------|
| Initial backfill (off-peak) | 100 | 200ms | 1 worker | Conservative, no impact on API |
| Initial backfill (fast mode) | 100 | 50ms | 3 workers | Stays under 500 RPM rate limit |
| Steady-state daily new records | 50 | 500ms | 1 worker | Trivial volume — very conservative |
| Re-embedding on model upgrade | 100 | 200ms | 1 worker | Run in maintenance window |
| Manual trigger (admin UI) | 10 | 1,000ms | 1 worker | User-initiated, must be gentle |

**Hard limits:**
- Never exceed 400 RPM to OpenAI (buffer below 500 RPM limit)
- Never exceed 150K tokens/minute (buffer below 200K TPM limit)
- Always use `content_hash` check before re-embedding (skip unchanged records)
- Always write to `enrichment_provider_log` for every API call attempt

---

## 9. Recommended Vector Retention Strategy

### 9.1 Retention Tiers

| Tier | Criteria | Retention | Action |
|------|---------|-----------|--------|
| **Active** | Contact has phone OR email, updated <90 days | Indefinite | Keep in `embedding_store` |
| **Warm** | Contact has no phone/email but enrichment pending | 6 months | Keep, flag for skip-trace |
| **Cold** | Placeholder or entity type, no activity >6 months | 12 months | Move to `embedding_archive` (future) |
| **Expired** | Recall entity / OSHA entity / local business, no conversion | 6 months | Delete from embedding_store |

### 9.2 Cleanup Query (run monthly, Stage 5+)

```sql
-- Remove embeddings for entity-type leads older than 6 months with no activity
DELETE FROM embedding_store
WHERE source_type = 'contact'
  AND source_id IN (
    SELECT id::text FROM contacts
    WHERE lead_type IN ('recall_entity', 'osha_entity', 'local_business')
      AND updated_at < NOW() - INTERVAL '6 months'
  );
```

### 9.3 Model Upgrade Path

When `text-embedding-4-small` or equivalent releases:
```
Phase 1: Write new model rows alongside old (UNIQUE constraint allows coexistence)
Phase 2: Validate recall improvement on 1,000 test queries in staging
Phase 3: Switch search queries to new model slug (WHERE model = 'text-embedding-4-small')
Phase 4: Delete old model rows (DELETE WHERE model = 'text-embedding-3-small')
```
No downtime. No index rebuild. Zero contact updates needed.

---

## 10. Recommended Archival Strategy

### 10.1 `universal_events` (63 MB / 237K rows — largest table)

**Problem:** Fastest-growing table in the system. ~2,500 new rows/day.
**Projection:** 1 GB in ~14 months without archival.

**Recommended:**
```sql
-- Monthly archive job (Stage 5)
CREATE TABLE IF NOT EXISTS universal_events_archive (LIKE universal_events INCLUDING ALL);
INSERT INTO universal_events_archive SELECT * FROM universal_events WHERE created_at < NOW() - INTERVAL '90 days';
DELETE FROM universal_events WHERE created_at < NOW() - INTERVAL '90 days';
```
Keeps hot table under 20 MB (last 90 days active). Archive is queryable but not indexed.

### 10.2 `contact_enrichment_events` and `skip_trace_requests`

**Projection at steady state:** ~480 new contacts/day × 1 enrichment event each = ~175K rows/year.

**Recommended:** Partition by year at 500K rows. Until then, retain all rows. These are the
audit trail — do not delete.

### 10.3 `agent_outcome_log` and `enrichment_provider_log`

**Projection:** ~64 agent outcomes/hour = ~560K rows/year. Growing fast once Stage 4 activates.

**Recommended:** Keep 180 days hot. Archive older rows to `agent_outcome_log_archive`.
Daily summary rollup into a new `agent_outcome_daily_summary` table for dashboards.

---

## 11. Monitoring Checklist (Observation Period)

### During Observation Window (now → Stage 4 clearance)

Check daily:

- [ ] Railway dashboard: CPU < 80% sustained, Memory < 85% sustained
- [ ] Railway logs: zero `Error:`, `FATAL:`, `OOM`, `Connection refused`
- [ ] Neon console: DB size growth within projection (±10%)
- [ ] `embedding_store`: still 0 rows (no unauthorized embedding writes)
- [ ] `agent_outcome_log`: accumulating rows from `reportOutcome` pipeline
- [ ] `enrichment_provider_log`: 0 rows until first manual skip trace is run
- [ ] `skip_trace_requests`: 0 rows until first manual skip trace is run
- [ ] Pipeline throughput: crash_ingested, crash_lead_created events flowing in Railway logs
- [ ] Query latency: no slow query warnings in Railway logs (>5 second queries)
- [ ] DB connections: Neon serverless auto-scales; watch for pool exhaustion warnings

### Key SQL Health Queries

```sql
-- DB size trend
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;

-- Embedding store vector count (should stay 0 until Stage 4 activated)
SELECT COUNT(*), model FROM embedding_store GROUP BY model;

-- Pipeline throughput (last hour)
SELECT event_type, COUNT(*) AS events
FROM universal_events
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY event_type
ORDER BY events DESC
LIMIT 20;

-- Agent outcome pipeline health
SELECT pipeline, outcome, COUNT(*) FROM agent_outcome_log
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY pipeline, outcome;

-- Skip trace requests status (post-Stage 3.5)
SELECT status, COUNT(*) FROM skip_trace_requests
GROUP BY status;

-- Export eligible contacts sanity check
SELECT export_eligible, lead_type, COUNT(*)
FROM contacts
GROUP BY export_eligible, lead_type
ORDER BY export_eligible DESC, COUNT(*) DESC;
```

---

## 12. Stage 4 Clearance Criteria

Stage 4 may be activated when ALL of the following are true:

```
[ ] 72-hour observation window complete with no Railway errors
[ ] DB size growth within 10% of projection
[ ] embedding_store has 0 unauthorized writes
[ ] agent_outcome_log is accumulating rows from reportOutcome pipeline
[ ] Manual skip trace tested end-to-end: skip_trace_requests + contact_enrichment_events populated
[ ] Export endpoint tested: /api/reports/export returns only export_eligible=true contacts
[ ] Admin login and contacts view verified by operator
[ ] Explicit approval from lead architect to proceed
```

**DO NOT ACTIVATE Stage 4 automatically.**
**Await operator sign-off after the 72-hour observation window.**

---

## Summary

| Category | Status |
|---------|--------|
| Stage 3 infrastructure | ✅ LIVE — 21 tables + HNSW index on production |
| Stage 3.5 skip trace observability | ✅ LIVE — skip_trace_requests + contact_enrichment_events |
| Contact routing enforcement | ✅ LIVE — export_eligible enforced on all exports |
| Embedding workers | 🔴 NOT ACTIVATED |
| Semantic search endpoints | 🔴 NOT ACTIVATED |
| AI memory orchestration | 🔴 NOT ACTIVATED |
| RAG pipelines | 🔴 NOT ACTIVATED |
| Stage 4 status | ⏸️ PAUSED — awaiting clearance |
| Initial embedding backfill cost | ~$0.03 (negligible) |
| Ongoing monthly embedding cost | ~$0.05 (negligible) |
| DB at full Stage 4 population | ~389 MB (well within Neon Pro limits) |
| HNSW query latency (38K vectors) | 2–5ms (ef_search=40) |
| Recommended Stage 4 start window | 72 hours post-observation clearance |
