# STAGE 3 VECTOR ARCHITECTURE
**Apex Marketing Automations — Semantic Search & AI Memory Foundation**
Generated: 2026-05-15
Status: LIVE — embedding_store active with HNSW index, zero embeddings populated yet

---

## Overview

Stage 3 established the vector infrastructure layer that will power semantic search, AI memory recall, and similarity-driven intelligence across the Apex platform. No embeddings have been generated yet — this document covers the architecture, data flow, and population roadmap.

The vector layer has three tiers:

| Tier | Table | Role |
|------|-------|------|
| **Central store** | `embedding_store` | All platform embeddings — multi-model, multi-source, HNSW-indexed |
| **Contact intelligence** | `contact_ai_profiles` | Per-contact embedding (1536-dim) + intent signals |
| **Case intelligence** | `legal_case_ai_summary` | Per-case embedding (1536-dim) + structured summary |

---

## 1. The Central Store: `embedding_store`

### Schema

```sql
CREATE TABLE embedding_store (
  id BIGSERIAL PRIMARY KEY,
  source_type VARCHAR(100) NOT NULL,          -- 'contact', 'legal_lead', 'sentinel_incident', ...
  source_id TEXT NOT NULL,                     -- FK-equivalent: the row's ID as text
  content_hash VARCHAR(64) NOT NULL,           -- SHA-256 of embedded content (change detection)
  content_preview TEXT,                        -- First 500 chars of embedded text (debugging)
  embedding vector(1536) NOT NULL,             -- 1536-dim vector (OpenAI compatible)
  model VARCHAR(100) NOT NULL DEFAULT 'text-embedding-3-small',
  dimensions INTEGER NOT NULL DEFAULT 1536,
  metadata JSONB,                              -- Arbitrary context (sub_account_id, tags, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_type, source_id, model)        -- One embedding per source per model
);
```

### Why One Central Store

Alternatives considered and rejected:

| Option | Rejected Because |
|--------|-----------------|
| One table per entity type | Fragmented HNSW indexes; can't cross-entity search |
| Columnar embedding on entity table | drizzle-kit push risk; can't hot-swap models |
| External vector DB (Pinecone, Weaviate) | Additional infra dependency; Neon pgvector sufficient at current scale |
| IVFFlat index | Requires training data; fails on empty table |

**Central store advantages:**
- Single HNSW index covers all entity types
- Cross-entity similarity (find contacts similar to an incident) with one query
- Model upgrades: add rows with new model slug, old rows coexist during transition
- `content_hash` enables incremental re-embedding (skip unchanged content)

### Indexing Strategy

```
embedding_store_hnsw_cosine_idx  — HNSW, vector_cosine_ops, m=16, ef_construction=64
embedding_store_source_idx       — B-tree on (source_type, source_id)  [source lookup]
embedding_store_created_at_idx   — B-tree on created_at DESC            [recency queries]
```

**Why cosine similarity:** All OpenAI text-embedding models output L2-normalized vectors. Cosine similarity and dot product are equivalent on normalized vectors. Cosine is the conventional choice for text semantic search.

**Why HNSW over IVFFlat:**
| Dimension | HNSW | IVFFlat |
|-----------|------|---------|
| Empty table support | ✅ Yes | ❌ Requires training data (`lists` parameter) |
| Insert performance | ✅ Incremental graph update | ⚠️ Re-index via VACUUM ANALYZE |
| Query recall at <1M vectors | ✅ Excellent | ✅ Good |
| Parameter tuning | None at query time | `probes` must be tuned per dataset |
| Memory overhead | ~128 bytes/vector | ~8 bytes/vector |

For a dataset expected to reach 50k–200k vectors, HNSW's recall and operational simplicity outweigh its higher memory cost.

**HNSW parameters chosen:**
- `m = 16` — default; each node connects to 16 neighbors in both layers. Controls recall vs build time.
- `ef_construction = 64` — default; search depth during index construction. Higher = better recall, slower build.
- At runtime, `ef_search` (query-time parameter) defaults to 40; can be raised per-query for higher-recall use cases.

---

## 2. Entity-Specific Tables

### `contact_ai_profiles`

```sql
CREATE TABLE contact_ai_profiles (
  id BIGSERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  summary TEXT,                          -- Human-readable AI summary of the contact
  intent_signals TEXT[],                 -- ['injury_claim_likely', 'shopping_attorneys', ...]
  predicted_intent VARCHAR(100),         -- Top intent label
  intent_confidence NUMERIC(4,3),        -- 0.000–1.000
  lifecycle_stage VARCHAR(50),           -- 'raw', 'enriched', 'qualified', 'contacted', 'converted'
  last_enriched_at TIMESTAMPTZ,
  embedding vector(1536),                -- NULLABLE: populated after AI profile generation
  embedding_model VARCHAR(100),
  embedding_updated_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(contact_id)
);
```

**Design decisions:**
- `embedding` is NULLABLE — profile row can exist before embedding is generated
- UNIQUE on `contact_id` — one profile per contact
- No index on `embedding` yet — deferred until population begins (HNSW requires sufficient data to be useful)
- When populated: add `CREATE INDEX contact_ai_profiles_hnsw_idx ON contact_ai_profiles USING hnsw (embedding vector_cosine_ops)` in Stage 4 or 5

### `legal_case_ai_summary`

```sql
CREATE TABLE legal_case_ai_summary (
  id BIGSERIAL PRIMARY KEY,
  intelligence_case_id INTEGER NOT NULL REFERENCES intelligence_cases(id) ON DELETE CASCADE,
  summary TEXT,
  key_facts TEXT[],
  recommended_actions TEXT[],
  risk_level VARCHAR(50),               -- 'low', 'medium', 'high', 'critical'
  confidence NUMERIC(4,3),
  embedding vector(1536),               -- NULLABLE: populated after AI summary generation
  embedding_model VARCHAR(100),
  embedding_updated_at TIMESTAMPTZ,
  model VARCHAR(100),                   -- LLM used for summary generation
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(intelligence_case_id)
);
```

**Note:** `intelligence_cases` is the live table. `legal_cases` does not exist. All FKs reference `intelligence_cases(id)`.

---

## 3. Vector Dimensions: 1536

All vector columns are `vector(1536)`. This dimension is chosen for compatibility with:

| Model | Dimensions | Notes |
|-------|-----------|-------|
| `text-embedding-3-small` | 1536 | Recommended for production — cost-efficient |
| `text-embedding-ada-002` | 1536 | Legacy compatibility |
| `text-embedding-3-large` | 3072 | Can be truncated to 1536 via `dimensions` parameter |

If a future model with different dimensions is needed, add a new `embedding_store` row with a different `model` slug. The `UNIQUE(source_type, source_id, model)` constraint allows per-model coexistence.

---

## 4. Data Flow (When Population Begins)

### Contact Embedding Pipeline (Stage 4+)

```
contacts row updated/created
  │
  ▼
contactEnrichmentWorker (Stage 4)
  │ reads: contact fields, enrichment data, legal signals
  │ calls: OpenAI text-embedding-3-small API
  ▼
embedding_store INSERT (or UPDATE via content_hash check)
  │ source_type = 'contact'
  │ source_id = contact.id::text
  │ model = 'text-embedding-3-small'
  │
  ▼ (optional, async)
contact_ai_profiles UPSERT
  │ summary = GPT-4o structured summary
  │ intent_signals, predicted_intent
  │ embedding = copy from embedding_store
```

### Similarity Search Query Pattern

```sql
-- Find contacts similar to a known high-value crash victim
SELECT c.id, c.first_name, c.last_name,
       1 - (es.embedding <=> $1::vector) AS similarity
FROM embedding_store es
JOIN contacts c ON es.source_id = c.id::text
WHERE es.source_type = 'contact'
  AND es.model = 'text-embedding-3-small'
ORDER BY es.embedding <=> $1::vector
LIMIT 20;
-- $1 = embedding of the reference contact
-- Expected latency: 1–15 ms on HNSW at <50k vectors
```

### Cross-Entity Search Pattern

```sql
-- Find cases similar to a contact (cross-entity)
SELECT es.source_type, es.source_id,
       1 - (es.embedding <=> $1::vector) AS similarity
FROM embedding_store es
WHERE es.source_type IN ('contact', 'legal_lead', 'sentinel_incident')
  AND es.model = 'text-embedding-3-small'
ORDER BY es.embedding <=> $1::vector
LIMIT 10;
```

---

## 5. Storage Projections

At current row counts, full population would add:

| Source | Row Count | Bytes/Vector | Total |
|--------|-----------|-------------|-------|
| Contacts | 9,522 | 6.1 kB | ~58 MB |
| Legal leads | 19,442 | 6.1 kB | ~119 MB |
| Sentinel incidents | 7,170 | 6.1 kB | ~44 MB |
| Intelligence cases | ~800 | 6.1 kB | ~5 MB |

**HNSW index RAM at full contact embedding:** ~1.2 MB (9,522 × 128 bytes/node)

Neon Pro plan scales compute and storage dynamically. Full population of all entity types would add ~230 MB to the current 149 MB total — acceptable on the current billing tier.

---

## 6. Content Hashing Strategy

The `content_hash` column (SHA-256, 64 chars) enables incremental re-embedding:

```typescript
// Before embedding, hash the content string
const contentHash = crypto
  .createHash('sha256')
  .update(contentString)
  .digest('hex');

// Only re-embed if content changed
const existing = await db.select()
  .from(embeddingStore)
  .where(and(
    eq(embeddingStore.sourceType, sourceType),
    eq(embeddingStore.sourceId, sourceId),
    eq(embeddingStore.model, model),
  ))
  .limit(1);

if (existing[0]?.contentHash === contentHash) {
  return; // skip — content unchanged
}
```

This avoids unnecessary API calls when batch-re-embedding after a model upgrade.

---

## 7. Model Upgrade Path

The `UNIQUE(source_type, source_id, model)` constraint makes model migration non-destructive:

```
Phase 1: Insert new model embeddings alongside old
  → embedding_store has 2 rows per source (ada-002 + 3-small)

Phase 2: Switch query code to use new model slug

Phase 3: Delete old model rows
  → DELETE FROM embedding_store WHERE model = 'text-embedding-ada-002'
```

No index rebuild required at query switch time. No downtime.

---

## 8. What Stage 3 Does NOT Do

| Deferred To | Action |
|-------------|--------|
| Stage 4 | Embedding population worker |
| Stage 4 | Semantic search API endpoint |
| Stage 4 | HNSW index on `contact_ai_profiles.embedding` |
| Stage 5 | Memory retrieval integration into Apex Intelligence |
| Stage 5 | Cross-entity similarity scoring pipeline |
| Stage 5 | Embedding cache invalidation on contact update |

Stage 3 is purely infrastructure. No application code was changed.
