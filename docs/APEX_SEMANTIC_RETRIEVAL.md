# APEX SEMANTIC RETRIEVAL
**pgvector Similarity Search, Embedding Strategy, and Throttling**
Version: 1.0 | Generated: 2026-05-15
Phase: 7 (Planned) | Infrastructure: Ready (Stage 3)

---

## Purpose

Semantic Retrieval enables text-driven search across contacts, incidents, legal signals, and case intel — using vector embeddings stored in the Neon pgvector extension. Operators can search by meaning, not just keyword.

**Current status:** Infrastructure is live and verified. No embedding workers are running. Stage 4 is paused. Semantic Retrieval will not activate until Stage 4 clearance is granted and the observation window completes.

---

## Infrastructure State (Live as of 2026-05-15)

| Component | Status | Details |
|-----------|--------|---------|
| pgvector extension | ✅ Live | Version 0.8.0, Neon Postgres 17.8 |
| `embedding_store` table | ✅ Live | HNSW index, cosine similarity |
| HNSW index | ✅ Live | vector_cosine_ops, m=16, ef_construction=64 |
| Estimated query latency | ✅ Verified | 2–5ms at ef_search=40, ~38K vectors |
| Embedding workers | ❌ NOT RUNNING | Paused — Stage 4 observation window |
| Semantic search endpoints | ❌ NOT ACTIVE | Pending Phase 7 |
| AI memory orchestration | ❌ NOT ACTIVE | Pending Phase 9 |

**Do not activate any embedding workers until Stage 4 clearance is granted.**

---

## Embedding Store Schema

```sql
-- Already live in production
CREATE TABLE embedding_store (
  id BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(100) NOT NULL,         -- 'contact', 'incident', 'legal_signal', 'case'
  entity_id BIGINT NOT NULL,
  embedding_model VARCHAR(100) NOT NULL,     -- 'text-embedding-3-small'
  embedding_version INTEGER DEFAULT 1,
  embedding vector(1536),                    -- OpenAI text-embedding-3-small dimensions
  content_hash VARCHAR(64),                  -- SHA256 of content embedded
  content_snapshot TEXT,                     -- text that was embedded (for debug)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(entity_type, entity_id, embedding_model)
);

CREATE INDEX idx_embedding_store_hnsw
  ON embedding_store
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_embedding_store_entity ON embedding_store(entity_type, entity_id);
```

---

## Embedding Strategy

### Entity Priority Order

```
Phase 7A: contacts (export_eligible = true first, then all)
Phase 7B: sentinel_incidents (high-severity first)
Phase 7C: legal_signals (high heat_score first)
Phase 7D: intelligence_cases (all)
Phase 7E: legal_leads (export-eligible only)
```

### Content to Embed

**Contact embedding content:**
```typescript
function buildContactEmbeddingContent(contact: Contact): string {
  return [
    contact.firstName, contact.lastName,
    contact.county, contact.state,
    contact.sourcePipeline,
    contact.leadType,
    contact.notes ?? "",
  ].filter(Boolean).join(" ");
}
```

**Incident embedding content:**
```typescript
function buildIncidentEmbeddingContent(incident: SentinelIncident): string {
  return [
    incident.incidentType,
    incident.county,
    incident.location,
    incident.severity,
    incident.incidentDate?.toISOString().split("T")[0],
    JSON.stringify(incident.rawData?.description ?? ""),
  ].filter(Boolean).join(" ");
}
```

### Embedding Model

**Model:** `text-embedding-3-small` (OpenAI)
- Dimensions: 1536
- Cost: $0.02 per 1M tokens
- Average tokens per contact content: ~15–25 tokens
- Average tokens per incident content: ~30–50 tokens

**Cost projections (initial backfill):**
| Entity | Count | Avg Tokens | Total Tokens | Cost |
|--------|-------|-----------|-------------|------|
| Export-eligible contacts | 990 | 20 | 19,800 | $0.0004 |
| All contacts | 9,562 | 20 | 191,240 | $0.004 |
| Sentinel incidents | 7,449 | 40 | 297,960 | $0.006 |
| Legal signals | 3,153 | 40 | 126,120 | $0.003 |
| **Total backfill** | **21,154** | — | **635,120** | **~$0.013** |

**Negligible initial cost. Ongoing cost at 960 incidents/day = ~$0.001/day.**

---

## Embedding Worker Design

### Throttling Requirements

The embedding worker MUST be throttled to avoid Railway OOM and OpenAI rate limits:

```typescript
// server/workers/embeddingWorker.ts (Phase 7)

const EMBEDDING_BATCH_SIZE = 25;         // contacts per batch
const EMBEDDING_DELAY_MS = 500;          // 500ms between batches = 50/min rate
const EMBEDDING_MAX_CONCURRENT = 2;      // max parallel API calls
const EMBEDDING_DAILY_CAP = 2000;        // max embeddings per day (cost guard)

async function runEmbeddingBatch(entityType: string): Promise<void> {
  let processed = 0;
  
  while (processed < EMBEDDING_DAILY_CAP) {
    const batch = await getUnemeddedEntities(entityType, EMBEDDING_BATCH_SIZE);
    if (batch.length === 0) break;
    
    await Promise.all(
      batch.map(entity => embedEntity(entity))
    );
    
    processed += batch.length;
    
    // Respect rate limit
    await sleep(EMBEDDING_DELAY_MS);
    
    // Log progress
    await logEmbeddingProgress(entityType, processed);
  }
}
```

### Change Detection

Only re-embed when content actually changes:

```typescript
async function shouldReEmbed(entityId: number, entityType: string, content: string): Promise<boolean> {
  const contentHash = sha256(content);
  const existing = await db
    .select({ contentHash: embeddingStore.contentHash })
    .from(embeddingStore)
    .where(and(
      eq(embeddingStore.entityType, entityType),
      eq(embeddingStore.entityId, entityId)
    ))
    .limit(1);
  
  return existing.length === 0 || existing[0].contentHash !== contentHash;
}
```

---

## Semantic Search Endpoints (Phase 7)

### Text-to-Contact Search

```
GET /api/contacts/search?q=:text&limit=20&subAccountId=:id

Process:
1. Embed query text using text-embedding-3-small
2. Find top-20 nearest neighbors in embedding_store WHERE entity_type = 'contact'
3. Join to contacts WHERE sub_account_id = X AND export_eligible = true
4. Return ranked results with similarity score

SQL:
SELECT c.*, 1 - (e.embedding <=> $queryVector) AS similarity
FROM embedding_store e
JOIN contacts c ON c.id = e.entity_id AND e.entity_type = 'contact'
WHERE c.sub_account_id = $subAccountId
  AND c.export_eligible = true
ORDER BY e.embedding <=> $queryVector
LIMIT 20;
```

### Contact Similarity

```
GET /api/contacts/:id/similar?limit=10

Process:
1. Fetch embedding for contact :id
2. Find top-10 nearest neighbors (excluding :id itself)
3. Return with similarity score and matching fields

Use cases: "Find contacts similar to this crash victim"
```

### Incident Text Search

```
GET /api/incidents/search?q=:text&limit=20

Use case: "Find all crashes involving trucks on I-4"
→ Embeds query, returns semantically similar incidents
```

---

## Vector Retention and Archival

### Retention Policy

| Entity State | Retention |
|-------------|-----------|
| Export-eligible contacts | Indefinite |
| Archived contacts (lifecycle = archived) | 180 days from archive date |
| Placeholder contacts | Do not embed |
| Incidents (any severity) | 365 days |
| Legal signals | 365 days |
| Intelligence cases | Indefinite |

### Archival Query

```sql
-- Run monthly via cron
DELETE FROM embedding_store
WHERE entity_type = 'contact'
  AND entity_id IN (
    SELECT id FROM contacts
    WHERE lifecycle_status = 'archived'
      AND updated_at < NOW() - INTERVAL '180 days'
  );

DELETE FROM embedding_store
WHERE entity_type = 'incident'
  AND created_at < NOW() - INTERVAL '365 days';
```

---

## HNSW Query Tuning

For production use, set `ef_search` based on recall vs. latency tradeoff:

| Use Case | ef_search | Recall | Latency (38K vectors) |
|----------|-----------|--------|----------------------|
| Autocomplete / real-time | 20 | ~90% | 1–2ms |
| Standard operator search | 40 | ~95% | 2–5ms |
| AI memory recall | 80 | ~98% | 5–10ms |
| Batch re-ranking | 200 | ~99.5% | 15–25ms |

**Set per query:**
```sql
SET LOCAL hnsw.ef_search = 40;
SELECT ... ORDER BY embedding <=> $queryVector LIMIT 20;
```

---

## Semantic Retrieval Observability

Every embedding operation must log to `agent_outcome_log`:

```sql
INSERT INTO agent_outcome_log
  (agent_type, entity_id, action, status, tokens_used, latency_ms, created_at)
VALUES
  ('embedding_worker', $entityId, 'embed_contact', 'success', $tokens, $latencyMs, NOW());
```

Monitor:
- Embeddings created per day (by entity type)
- Re-embed rate (content change frequency)
- API token cost per day
- HNSW query latency (p50, p95, p99)
- Daily cap hit events (if capped, surface in admin)

---

## Phase 7 Deliverables (Semantic Retrieval)

- [ ] Embedding worker — contacts (export_eligible first, throttled)
- [ ] Embedding worker — incidents (high-severity first, throttled)
- [ ] `GET /api/contacts/search?q=:text` — semantic contact search
- [ ] `GET /api/contacts/:id/similar` — contact similarity
- [ ] `GET /api/incidents/search?q=:text` — incident text search
- [ ] Vector retention archival cron job
- [ ] Embedding observability in `agent_outcome_log`
- [ ] Daily cost monitoring dashboard
- [ ] HNSW latency percentile tracking
- [ ] Admin: embedding coverage report (% of entities embedded)
