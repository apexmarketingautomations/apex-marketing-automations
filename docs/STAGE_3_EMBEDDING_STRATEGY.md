# STAGE 3 EMBEDDING STRATEGY
**Apex Marketing Automations — Semantic AI Roadmap**
Generated: 2026-05-15
Status: INFRASTRUCTURE READY — Population and search deferred to Stage 4+

---

## Executive Summary

Stage 3 built the embedding infrastructure. This document defines the strategy for populating, maintaining, and querying embeddings across the platform. No embedding generation code was written in Stage 3 — this is the blueprint for Stage 4 and Stage 5.

---

## 1. Model Selection

### Primary Model: `text-embedding-3-small`

| Property | Value |
|----------|-------|
| Provider | OpenAI |
| Model ID | `text-embedding-3-small` |
| Dimensions | 1536 |
| Max tokens | 8,191 |
| Cost | ~$0.00002 / 1K tokens |
| Throughput | ~10,000 embeddings/min (batch API) |

**Why `text-embedding-3-small` over alternatives:**

| Model | Dimensions | Cost/1K | Rationale |
|-------|-----------|---------|-----------|
| `text-embedding-3-small` | 1536 | $0.00002 | **Selected** — optimal recall/cost |
| `text-embedding-3-large` | 3072 | $0.00013 | 6.5× cost for marginal recall gain at <200k vectors |
| `text-embedding-ada-002` | 1536 | $0.00010 | Legacy — 5× cost, no advantage |

The DB schema stores `dimensions = 1536` and `model = 'text-embedding-3-small'` on every row, enabling zero-downtime model upgrades.

---

## 2. What Gets Embedded

### Priority 1 — Contacts (9,522 rows)

**Content string to embed:**
```typescript
function buildContactEmbeddingContent(contact: Contact): string {
  return [
    contact.firstName, contact.lastName,
    contact.city, contact.state,
    contact.leadVertical,           // 'crash', 'legal', 'home_service'
    contact.leadSubtype,            // 'rear_end', 'slip_fall', 'roof_damage'
    contact.intentSignals?.join(' '),
    contact.county,
    contact.tags?.join(' '),
  ]
    .filter(Boolean)
    .join(' | ');
}
```

**Expected output:** `"John Smith | Tampa | Florida | crash | rear_end | injury_claim_likely | Hillsborough | skip-traced has-phone"`

**Storage:** `embedding_store` (source_type='contact') + copy to `contact_ai_profiles.embedding`

**Estimated cost at current scale:** 9,522 contacts × ~20 tokens avg = ~190K tokens = **$0.004 total**

---

### Priority 2 — Legal Leads (19,442 rows)

**Content string to embed:**
```typescript
function buildLegalLeadEmbeddingContent(lead: LegalLead): string {
  return [
    lead.incidentType,
    lead.injuryType,
    lead.county, lead.state,
    lead.faultDescription,
    lead.priorClaims ? 'prior_claims' : null,
    lead.medicalTreatment ? 'medical_treatment' : null,
    lead.liabilityAdmitted ? 'liability_admitted' : null,
  ]
    .filter(Boolean)
    .join(' | ');
}
```

**Estimated cost:** 19,442 × ~30 tokens avg = ~583K tokens = **$0.012 total**

---

### Priority 3 — Sentinel Incidents (7,170 rows)

**Content string to embed:**
```typescript
function buildIncidentEmbeddingContent(incident: SentinelIncident): string {
  return [
    incident.incidentType,
    incident.location,
    incident.description?.substring(0, 500),
    incident.severity,
    incident.vehicleTypes?.join(' '),
  ]
    .filter(Boolean)
    .join(' | ');
}
```

**Estimated cost:** 7,170 × ~60 tokens avg = ~430K tokens = **$0.009 total**

---

### Priority 4 — Intelligence Cases (~800 rows)

**Content string to embed:**
```typescript
function buildCaseEmbeddingContent(kase: IntelligenceCase): string {
  return [
    kase.title,
    kase.summary?.substring(0, 800),
    kase.caseType,
    kase.county, kase.state,
    kase.status,
  ]
    .filter(Boolean)
    .join(' | ');
}
```

---

### Total Initial Population Cost Estimate

| Entity | Rows | Avg Tokens | Total Tokens | Cost |
|--------|------|-----------|-------------|------|
| Contacts | 9,522 | 20 | 190K | $0.004 |
| Legal leads | 19,442 | 30 | 583K | $0.012 |
| Sentinel incidents | 7,170 | 60 | 430K | $0.009 |
| Intelligence cases | 800 | 80 | 64K | $0.001 |
| **Total** | **36,934** | — | **1.27M** | **~$0.03** |

Full initial population costs approximately **$0.03 at current scale.** Negligible.

---

## 3. Population Worker Architecture (Stage 4)

### Design: Incremental Batch Worker

```typescript
// Stage 4 pseudocode — not yet implemented

async function embeddingPopulationWorker() {
  const BATCH_SIZE = 100;          // OpenAI batch endpoint limit
  const THROTTLE_MS = 200;         // Stay well under rate limits

  const contacts = await db.select()
    .from(contacts)
    .leftJoin(embeddingStore, and(
      eq(embeddingStore.sourceType, 'contact'),
      eq(embeddingStore.sourceId, sql`${contacts.id}::text`),
    ))
    .where(isNull(embeddingStore.id))   // Not yet embedded
    .limit(BATCH_SIZE);

  if (contacts.length === 0) return;   // All done

  const contents = contacts.map(c => buildContactEmbeddingContent(c));
  const hashes = contents.map(c => sha256(c));

  // Batch embed
  const embeddings = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: contents,
    encoding_format: 'float',
  });

  // Upsert into embedding_store
  await db.insert(embeddingStore)
    .values(contacts.map((c, i) => ({
      sourceType: 'contact',
      sourceId: String(c.id),
      contentHash: hashes[i],
      contentPreview: contents[i].substring(0, 500),
      embedding: embeddings.data[i].embedding,
      model: 'text-embedding-3-small',
      dimensions: 1536,
    })))
    .onConflictDoUpdate({
      target: [embeddingStore.sourceType, embeddingStore.sourceId, embeddingStore.model],
      set: {
        embedding: sql`EXCLUDED.embedding`,
        contentHash: sql`EXCLUDED.content_hash`,
        updatedAt: sql`NOW()`,
      },
    });

  await sleep(THROTTLE_MS);
  await reportOutcome('embedding_worker', 'success', { batchSize: contacts.length });
}
```

### Triggering Strategy

| Trigger | Method | When |
|---------|--------|------|
| Initial backfill | One-time job via `/api/internal/start-embedding-backfill` | Stage 4 deploy |
| New contact | Hook into `contactUpsertService` after save | Stage 4 |
| Content change | Compare `content_hash` before re-embedding | Always |
| Cron re-check | Weekly sweep for stale embeddings | Stage 5 |

---

## 4. Semantic Search Patterns (Stage 4+)

### Pattern 1 — Find Similar Contacts

```typescript
async function findSimilarContacts(referenceContactId: number, topK = 20) {
  const reference = await db.select()
    .from(embeddingStore)
    .where(and(
      eq(embeddingStore.sourceType, 'contact'),
      eq(embeddingStore.sourceId, String(referenceContactId)),
    ))
    .limit(1);

  if (!reference[0]) return [];

  return db.execute(sql`
    SELECT c.id, c.first_name, c.last_name,
           1 - (es.embedding <=> ${reference[0].embedding}::vector) AS similarity
    FROM embedding_store es
    JOIN contacts c ON es.source_id = c.id::text
    WHERE es.source_type = 'contact'
      AND es.model = 'text-embedding-3-small'
      AND es.source_id != ${String(referenceContactId)}
    ORDER BY es.embedding <=> ${reference[0].embedding}::vector
    LIMIT ${topK}
  `);
}
```

### Pattern 2 — Text-to-Contact Search

```typescript
async function searchContactsByText(query: string, topK = 10) {
  const queryEmbedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  });

  return db.execute(sql`
    SELECT c.id, c.first_name, c.last_name,
           1 - (es.embedding <=> ${queryEmbedding.data[0].embedding}::vector) AS similarity
    FROM embedding_store es
    JOIN contacts c ON es.source_id = c.id::text
    WHERE es.source_type = 'contact'
      AND es.model = 'text-embedding-3-small'
    ORDER BY es.embedding <=> ${queryEmbedding.data[0].embedding}::vector
    LIMIT ${topK}
  `);
}
// Example: searchContactsByText("Tampa rear-end accident injury attorney looking")
```

### Pattern 3 — Brain Memory Recall (Stage 5)

```typescript
async function recallRelevantMemories(currentContext: string, topK = 5) {
  const contextEmbedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: currentContext,
  });

  return db.execute(sql`
    SELECT es.source_type, es.source_id, es.content_preview,
           1 - (es.embedding <=> ${contextEmbedding.data[0].embedding}::vector) AS similarity
    FROM embedding_store es
    WHERE es.model = 'text-embedding-3-small'
    ORDER BY es.embedding <=> ${contextEmbedding.data[0].embedding}::vector
    LIMIT ${topK}
  `);
}
```

---

## 5. HNSW Runtime Tuning

The HNSW index was created with build-time parameters `m=16, ef_construction=64`. At query time, `ef_search` controls the recall-latency tradeoff and can be set per-session:

```sql
-- Default (ef_search = 40): fastest, slightly lower recall
SET hnsw.ef_search = 40;

-- Higher recall (for critical similarity searches):
SET hnsw.ef_search = 100;
```

**When to increase `ef_search`:**
- Apex Intelligence brain memory recall (correctness > latency)
- Attorney matching (need highest-quality matches)

**When to leave default:**
- Real-time contact search in UI (latency matters)
- Batch scoring runs (throughput matters)

At current expected scale (<50k vectors), even `ef_search=200` returns results in <10ms. Tuning becomes meaningful above 500k vectors.

---

## 6. Re-embedding on Model Upgrade

If OpenAI releases a new model (e.g., `text-embedding-4-small`) with better recall:

```
Step 1: Update worker to write new model slug alongside old
  → embedding_store has 2 rows per source

Step 2: Run backfill (both old and new coexist)

Step 3: Update search queries to use new model slug
  → WHERE model = 'text-embedding-4-small'

Step 4: Validate recall improvement in staging

Step 5: Delete old model rows
  DELETE FROM embedding_store WHERE model = 'text-embedding-3-small';
```

The `UNIQUE(source_type, source_id, model)` constraint and the `model` column make this zero-downtime.

---

## 7. Stage Roadmap

| Stage | Deliverable |
|-------|------------|
| **Stage 3 (done)** | `embedding_store` + HNSW index, `contact_ai_profiles`, `legal_case_ai_summary` schemas |
| **Stage 4** | Embedding population worker (contacts first), semantic search API endpoint, `contact_ai_profiles` population |
| **Stage 4** | HNSW index on `contact_ai_profiles.embedding` (after first 1k rows) |
| **Stage 4** | Wire `agent_outcome_log` writes from `reportOutcome` pipeline |
| **Stage 5** | Brain memory recall integration (embed + retrieve in Apex Intelligence reasoning loop) |
| **Stage 5** | Cross-entity similarity (contacts ↔ incidents ↔ legal leads) |
| **Stage 5** | Embedding cache invalidation on contact update webhook |
| **Stage 6** | `legal_case_ai_summary` population (LLM summarization + embedding) |
| **Stage 6** | Attorney-lead similarity matching via embedding distance |

---

## 8. Operational Notes

### Index Maintenance

HNSW in pgvector does NOT require manual `VACUUM ANALYZE + REINDEX` for incremental inserts. The graph auto-updates on each `INSERT`. The index is always queryable.

If the index becomes significantly stale (e.g., >10% of rows deleted), run:
```sql
REINDEX INDEX CONCURRENTLY embedding_store_hnsw_cosine_idx;
```
This is a background operation with no read lock.

### Storage Growth Monitoring

Check `embedding_store` size before and after each population batch:
```sql
SELECT pg_size_pretty(pg_total_relation_size('embedding_store')) AS total_size,
       COUNT(*) AS vector_count
FROM embedding_store;
```

At 36,934 projected vectors: ~225 MB data + ~5 MB HNSW index = ~230 MB total. Well within Neon Pro limits.

### Disaster Recovery

All embeddings are re-generatable from source data. If `embedding_store` is ever corrupted or accidentally dropped:

1. `DROP TABLE embedding_store CASCADE;` (removes HNSW index too)
2. Re-run the Stage 3 CREATE TABLE + index DDL
3. Re-run the population worker (Stage 4 backfill script)

Estimated re-population time at 36k vectors: ~4 minutes (100/batch × 200ms throttle × 370 batches)
