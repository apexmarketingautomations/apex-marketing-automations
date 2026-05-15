# Stage 4A — Semantic Throttling Architecture
**Apex Marketing OS | Safe Reactivation of Embedding Workers**
**Status:** DESIGN-COMPLETE — Workers PAUSED (Stage 3 observation window)
**Authored:** 2026-05-15
**Depends on:** Stage 3 (pgvector, HNSW index, embedding_store), Stage 4A (BullMQ + Upstash Redis)
**Reactivation gate:** 8 clearance gates must pass before embedding workers restart
**Do not reactivate without explicit clearance.**

---

## 1. Current Semantic State

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Stage 3 Status: PAUSED (observation window active)                     │
│                                                                         │
│  embedding_store:    0 vectors (HNSW index loaded, no data populated)   │
│  contact_ai_profiles: 0 rows                                            │
│  legal_case_ai_summary: 0 rows                                          │
│                                                                         │
│  HNSW index:  active, ef_search=40, vector_cosine_ops                   │
│               m=16, ef_construction=64                                  │
│               Expected latency: 2–5ms at steady state                   │
│                                                                         │
│  Daily cap:   2,000 embeddings                                          │
│  Token budget: 100,000 tokens/day                                       │
│  Batch size:  25 records/call                                           │
│  Batch delay: 500ms between batches                                     │
│                                                                         │
│  Activation:  PAUSED — do not reactivate until clearance gates pass     │
│               (see Section 8 for gate list)                             │
└─────────────────────────────────────────────────────────────────────────┘
```

**What was built in Stage 3:**
- `embedding_store` table with HNSW cosine index (pgvector 0.8.0)
- `contact_ai_profiles` and `legal_case_ai_summary` entity-specific tables
- `apex-embeddings` and `apex-semantic` queue definitions in STAGE_4A_QUEUE_ARCHITECTURE.md
- Model selection decision: `text-embedding-3-small` (1536 dimensions, $0.00002/1K tokens)

**What is NOT running:**
- No auto-embedding workers
- No semantic indexing jobs
- No AI memory orchestration or RAG pipelines
- No production semantic UI search (queries return empty until vectors exist)

---

## 2. Why Throttling Is Critical

The naive approach — "just run the embedding worker" — has four specific failure modes that throttling prevents. Understanding each failure mode justifies every design decision below.

### Failure Mode 1: Queue Storm

The current `server/intelligence/worker.ts` uses a plain `setInterval` + in-memory `jobQueue` (from `server/jobQueue.ts`, which is a bare JavaScript array). If the embedding worker triggered batch embedding of all 9,562 contacts at once, the in-memory queue would accumulate ~383 jobs (9562 / 25 per batch). A Railway restart drops all 383 silently. With BullMQ this becomes 383 durable jobs that survive restarts — but they also compete with the routing queue (`apex-routing`, concurrency 3, SLA < 30 seconds). The concurrency contracts in STAGE_4A_QUEUE_ARCHITECTURE.md only hold if `apex-embeddings` does not flood the Redis connection pool with 383 simultaneous job state transitions.

**Throttling solution:** Daily cap (2,000/day) + rate limiter (100 jobs/minute in BullMQ) prevents the storm. At 25 records per batch, 2,000 jobs/day = 50,000 records/day maximum — far beyond current scale of ~37K total embeddable records.

### Failure Mode 2: HNSW Index Rebuild

pgvector's HNSW index is an approximate nearest-neighbor graph. Bulk inserts rebuild graph edges, and rebuilding a 37K-node graph (all contacts + incidents + legal leads) from scratch takes 2–5 minutes during which query latency spikes from 2–5ms to 200–500ms. Any semantic search initiated during that window returns degraded results.

**Throttling solution:** Insert rate capped at 200/minute + a bulk-pause threshold at 500 queued jobs. Spreading inserts across multiple sessions (day 1: 100, day 3: 500, day 7: 2,000) means the HNSW graph grows incrementally rather than in one rebuild burst.

### Failure Mode 3: Railway Memory OOM

The Railway container runs the Express server, all intelligence workers (rollup every 15min, scoring every 30min — both in `server/intelligence/worker.ts`), and BullMQ workers on a single Node.js process. A batch of 1,000 embeddings = ~80MB RAM spike (each 1536-dim float32 vector = ~6KB; 1000 vectors = 6MB, but OpenAI response parsing buffers 10–15× that). Railway's entry-tier containers cap at 512MB total. A 1,000-embed spike + concurrent scoring cycle = OOM kill.

**Throttling solution:** Batch size capped at 25 records per call (configurable via `EMBEDDING_BATCH_SIZE`). 25 embeddings × ~6KB = 150KB; 10–15× parsing overhead = ~2MB — safe at any Railway tier.

### Failure Mode 4: Re-embedding Waste

If a contact's `firstName`, `lastName`, `county`, `state`, `sourcePipeline`, and `leadType` haven't changed, re-embedding it produces an identical vector. Every re-embed wastes tokens (against the 100k/day budget) and an HNSW upsert (which still triggers a partial graph rebuild). With 9,562 contacts and daily enrichment touching ~100 records, naive re-embedding would waste 99% of the daily token budget on unchanged content.

**Throttling solution:** Content hashing (`SHA256` of the embedding content string) compared against `embedding_store.content_hash` before any API call. Unchanged records are skipped at O(1) Redis lookup cost.

---

## 3. Embedding Queue Design

The `apex-embeddings` queue is defined in `docs/STAGE_4A_QUEUE_ARCHITECTURE.md`. The parameters below are the authoritative source for worker implementation — do not redefine them in worker code.

```typescript
// server/semantic/embeddingQueue.ts
// Queue parameters mirror STAGE_4A_QUEUE_ARCHITECTURE.md Section 3.4 exactly.

import { Queue, Worker } from 'bullmq';

export const EMBEDDING_QUEUE_CONFIG = {
  name: 'apex-embeddings',
  concurrency: 10,
  limiter: {
    max: 100,              // 100 jobs/minute burst cap — well under OpenAI 1M tokens/min limit
    duration: 60_000,
  },
  defaultJobOptions: {
    priority: 2,           // LOW — below routing (10), intake (7), enrichment (5), OCR (3)
    attempts: 2,           // 2 attempts only — embedding failures are non-critical
    backoff: { type: 'exponential' as const, delay: 30_000 },
    removeOnComplete: { count: 200, age: 86_400 },
    removeOnFail: false,   // Keep for DLQ audit
    timeout: 30_000,       // 30s: a batch of 25 records through OpenAI should complete in < 5s
  },
};

// Entity types that support embedding
export type EmbeddableEntityType =
  | 'contact'         // server/services/contactUpsertService.ts creates/updates contacts
  | 'incident'        // sentinel_incidents: crash, legal, home service incidents
  | 'legal_signal'    // legal_signals: CourtListener + Hillsborough filings
  | 'case';           // intelligence_cases: synthesized case intelligence

// Embedding trigger sources — determines priority and throttling behavior
export type EmbedTrigger =
  | 'enrichment'   // Contact updated by enrichment pipeline (skip-trace, property lookup)
  | 'scoring'      // Contact scored by scoringEngine (run after each scoring cycle)
  | 'manual'       // Operator-triggered via admin UI or MCP tool
  | 'backfill';    // Historical records: lowest priority, spread across days

export interface EmbedJobPayload {
  entityType: EmbeddableEntityType;
  entityId: number;
  contentHash: string;        // SHA256 of content string — precomputed to enable fast dedup check
  force?: boolean;            // Override change detection — use for model upgrades only
  triggeredBy: EmbedTrigger;
  subAccountId?: number;      // For multi-tenant scoping of metrics
  traceId: string;            // UUID — correlates with acquisition/OCR/scoring traces
}

// BullMQ job ID format: dedup key ensuring one embedding job per entity at a time.
// BullMQ will ignore add() if a job with this ID is already waiting or active.
export function buildEmbedJobId(entityType: EmbeddableEntityType, entityId: number): string {
  return `embed:${entityType}:${entityId}`;
}

export async function enqueueEmbedJob(
  queue: Queue,
  payload: EmbedJobPayload,
  options?: { delay?: number },
): Promise<string | null> {
  // Do not enqueue if worker is not cleared for reactivation
  if (!isEmbeddingWorkerCleared()) {
    console.debug(`[EMBED-QUEUE] Skipping enqueue — worker not cleared (entityType=${payload.entityType} entityId=${payload.entityId})`);
    return null;
  }

  const jobId = buildEmbedJobId(payload.entityType, payload.entityId);
  await queue.add(payload.entityType, payload, {
    ...EMBEDDING_QUEUE_CONFIG.defaultJobOptions,
    jobId,
    delay: options?.delay ?? 0,
  });
  return jobId;
}

// Quick check: is the embedding worker cleared for reactivation?
// Checks both env var and DB feature flag. Cached for 60 seconds.
let workerClearedCache: { value: boolean; cachedAt: number } | null = null;
export function isEmbeddingWorkerCleared(): boolean {
  const now = Date.now();
  if (workerClearedCache && now - workerClearedCache.cachedAt < 60_000) {
    return workerClearedCache.value;
  }
  // Env var check (synchronous — DB flag check happens async in worker startup)
  const value = process.env.EMBEDDING_WORKER_ENABLED === 'true';
  workerClearedCache = { value, cachedAt: now };
  return value;
}
```

---

## 4. Change Detection (Do Not Re-embed Unchanged Records)

This module is the primary defense against wasting the daily token budget. Every embedding call must pass through `shouldEmbed()` first.

```typescript
// server/semantic/changeDetector.ts

import crypto from 'crypto';
import { db } from '../db';
import { embeddingStore } from '@shared/schema';
import { and, eq } from 'drizzle-orm';
import { getRedisClient } from '../queues/redisClient';
import type { EmbeddableEntityType } from './embeddingQueue';

// Redis dedup key TTL: 1 hour
// If a contact is updated and re-embedded, the new hash replaces the old.
// If Redis is evicted (Upstash free tier eviction), the DB slow path catches it.
const DEDUP_CACHE_TTL_S = 3_600;

export async function shouldEmbed(
  entityType: EmbeddableEntityType,
  entityId: number,
  newContentHash: string,
  force = false,
): Promise<{ embed: boolean; reason: string }> {
  if (force) {
    return { embed: true, reason: 'force_flag_set' };
  }

  // Fast path: Redis lookup (~0.5ms vs ~5ms Neon round-trip)
  const redis = getRedisClient();
  const dedupKey = `apex:dedup:embed:${entityType}:${entityId}`;
  if (redis) {
    const cachedHash = await redis.get(dedupKey);
    if (cachedHash === newContentHash) {
      return { embed: false, reason: 'content_unchanged_cache' };
    }
  }

  // Slow path: DB lookup for cache miss or Redis unavailability
  const existing = await db
    .select({ contentHash: embeddingStore.contentHash })
    .from(embeddingStore)
    .where(and(
      eq(embeddingStore.sourceType, entityType),
      eq(embeddingStore.sourceId, String(entityId)),
    ))
    .limit(1);

  if (existing[0]?.contentHash === newContentHash) {
    // Populate Redis cache to speed up future checks
    if (redis) {
      await redis.set(dedupKey, newContentHash, 'EX', DEDUP_CACHE_TTL_S);
    }
    return { embed: false, reason: 'content_unchanged_db' };
  }

  return {
    embed: true,
    reason: existing.length > 0 ? 'content_changed' : 'new_entity',
  };
}

// Update the dedup cache after a successful embed — prevents immediate re-embed
export async function markEmbedded(
  entityType: EmbeddableEntityType,
  entityId: number,
  contentHash: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  const dedupKey = `apex:dedup:embed:${entityType}:${entityId}`;
  await redis.set(dedupKey, contentHash, 'EX', DEDUP_CACHE_TTL_S);
}

// ── Content builders ──────────────────────────────────────────────────────────
// These functions produce the canonical string that gets embedded.
// The SHA256 of this string is used for change detection.
// IMPORTANT: changing these functions invalidates ALL existing embeddings for that entity type.
// If you change a builder, increment the model version in embedding_store.metadata
// and trigger a full backfill for that entity type.

export function buildEmbedContent(
  entityType: EmbeddableEntityType,
  record: Record<string, unknown>,
): string {
  switch (entityType) {
    case 'contact':
      // Matches buildContactEmbeddingContent() from STAGE_3_EMBEDDING_STRATEGY.md
      return [
        record.firstName,
        record.lastName,
        record.city,
        record.state,
        record.county,
        record.sourcePipeline,
        record.leadType,
        record.leadVertical,
        record.leadSubtype,
        // Include intent signals if available (contact_ai_profiles.intent_signals)
        Array.isArray(record.intentSignals) ? record.intentSignals.join(' ') : null,
        Array.isArray(record.tags) ? record.tags.join(' ') : null,
        record.notes ?? null,
      ]
        .filter(Boolean)
        .join(' | ');

    case 'incident':
      // Matches buildIncidentEmbeddingContent() from STAGE_3_EMBEDDING_STRATEGY.md
      return [
        record.reportNumber,
        record.incidentType,
        record.location,
        record.county,
        record.state,
        record.severity,
        record.injurySeverity,
        // Truncate narrative to 500 chars — embedding budget
        typeof record.narrativeSummary === 'string'
          ? record.narrativeSummary.substring(0, 500)
          : null,
        Array.isArray(record.vehicleTypes) ? record.vehicleTypes.join(' ') : null,
      ]
        .filter(Boolean)
        .join(' | ');

    case 'legal_signal':
      // New builder for legal_signals table (not in Stage 3 doc)
      return [
        record.caseTitle,
        record.plaintiff,
        record.defendant,
        record.court,
        record.county,
        record.state,
        record.practiceArea,
        record.incidentType,
        typeof record.summary === 'string'
          ? record.summary.substring(0, 800)
          : null,
      ]
        .filter(Boolean)
        .join(' | ');

    case 'case':
      // Matches buildCaseEmbeddingContent() from STAGE_3_EMBEDDING_STRATEGY.md
      return [
        record.title,
        record.caseType,
        record.county,
        record.state,
        record.status,
        typeof record.summary === 'string'
          ? record.summary.substring(0, 800)
          : null,
      ]
        .filter(Boolean)
        .join(' | ');

    default:
      // Fallback for future entity types — JSON stringify is last resort
      return JSON.stringify(record).substring(0, 1000);
  }
}

export function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Estimate token count without calling the API.
// OpenAI's tokenization is approximately 4 chars per token for English text.
// This estimate is used for budget tracking — actual tokens consumed are logged
// from the API response and used for the authoritative counter.
export function estimateTokenCount(content: string): number {
  return Math.ceil(content.length / 4);
}
```

---

## 5. Daily Budget Enforcement

All budget counters live in Redis. The counters reset at midnight UTC (48-hour TTL ensures cleanup without a cron dependency). The budget module is designed to fail open gracefully when Redis is unavailable — it logs a warning rather than blocking all embedding.

```typescript
// server/semantic/tokenBudget.ts

import { getRedisClient } from '../queues/redisClient';

// All limits configurable via Railway env vars
// Start conservative: raise only after observing stable behavior for 7 days
const DAILY_LIMITS = {
  maxEmbeds:   parseInt(process.env.EMBEDDING_DAILY_CAP    ?? '2000'),
  maxTokens:   parseInt(process.env.EMBEDDING_TOKEN_BUDGET ?? '100000'),
  batchSize:   parseInt(process.env.EMBEDDING_BATCH_SIZE   ?? '25'),
  batchDelayMs: parseInt(process.env.EMBEDDING_BATCH_DELAY_MS ?? '500'),
};

// Redis key format for daily counters
const redisKey = {
  count:  (date: string) => `apex:embed:daily:count:${date}`,
  tokens: (date: string) => `apex:embed:daily:tokens:${date}`,
};

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface BudgetStatus {
  allowed: boolean;
  remaining: number;       // Embeds remaining today
  tokensRemaining: number; // Tokens remaining today
  reason?: string;
}

export async function checkEmbeddingBudget(): Promise<BudgetStatus> {
  const redis = getRedisClient();
  if (!redis) {
    console.warn('[EMBED-BUDGET] Redis unavailable — budget enforcement disabled');
    return {
      allowed: true,
      remaining: DAILY_LIMITS.maxEmbeds,
      tokensRemaining: DAILY_LIMITS.maxTokens,
    };
  }

  const date = todayDate();
  const [rawCount, rawTokens] = await redis.mget(
    redisKey.count(date),
    redisKey.tokens(date),
  );

  const embedCount  = parseInt(rawCount  ?? '0');
  const tokenCount  = parseInt(rawTokens ?? '0');

  if (embedCount >= DAILY_LIMITS.maxEmbeds) {
    return {
      allowed: false,
      remaining: 0,
      tokensRemaining: DAILY_LIMITS.maxTokens - tokenCount,
      reason: `Daily embed cap reached: ${embedCount}/${DAILY_LIMITS.maxEmbeds}. Resets at midnight UTC.`,
    };
  }

  if (tokenCount >= DAILY_LIMITS.maxTokens) {
    return {
      allowed: false,
      remaining: DAILY_LIMITS.maxEmbeds - embedCount,
      tokensRemaining: 0,
      reason: `Daily token budget reached: ${tokenCount}/${DAILY_LIMITS.maxTokens}. Resets at midnight UTC.`,
    };
  }

  return {
    allowed: true,
    remaining: DAILY_LIMITS.maxEmbeds - embedCount,
    tokensRemaining: DAILY_LIMITS.maxTokens - tokenCount,
  };
}

export async function recordEmbeddingUsage(
  embedCount: number,
  tokenCount: number,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const date = todayDate();
  const pipeline = redis.pipeline();
  pipeline.incrby(redisKey.count(date),  embedCount);
  pipeline.incrby(redisKey.tokens(date), tokenCount);
  // 48-hour TTL: survives the day rollover without a cron dependency
  pipeline.expire(redisKey.count(date),  172_800);
  pipeline.expire(redisKey.tokens(date), 172_800);
  await pipeline.exec();
}

// Convenience: get current daily usage for monitoring dashboards
export async function getDailyUsage(): Promise<{
  embedsUsed: number;
  embedsLimit: number;
  tokensUsed: number;
  tokensLimit: number;
  date: string;
}> {
  const redis = getRedisClient();
  const date = todayDate();

  if (!redis) {
    return {
      embedsUsed: 0,
      embedsLimit: DAILY_LIMITS.maxEmbeds,
      tokensUsed: 0,
      tokensLimit: DAILY_LIMITS.maxTokens,
      date,
    };
  }

  const [rawCount, rawTokens] = await redis.mget(
    redisKey.count(date),
    redisKey.tokens(date),
  );

  return {
    embedsUsed:  parseInt(rawCount  ?? '0'),
    embedsLimit: DAILY_LIMITS.maxEmbeds,
    tokensUsed:  parseInt(rawTokens ?? '0'),
    tokensLimit: DAILY_LIMITS.maxTokens,
    date,
  };
}

export { DAILY_LIMITS };
```

---

## 6. Batch Orchestration Pattern

The batch orchestrator is the core of the embedding worker. It combines budget enforcement, change detection, OpenAI API calls, and HNSW upserts into a single safe execution unit.

```typescript
// server/semantic/embeddingBatcher.ts
// Used by: server/semantic/embeddingWorker.ts (BullMQ worker handler)
// Pattern: mirrors server/crashReportWorker.ts concurrency model (MAX_CONCURRENT + p-limit)

import pLimit from 'p-limit';  // p-limit ^7.3.0 already in package.json
import pRetry from 'p-retry';  // p-retry ^7.1.1 already in package.json
import OpenAI from 'openai';    // openai ^6.19.0 already in package.json
import { db } from '../db';
import { embeddingStore } from '@shared/schema';
import { sql } from 'drizzle-orm';
import {
  checkEmbeddingBudget,
  recordEmbeddingUsage,
  DAILY_LIMITS,
} from './tokenBudget';
import {
  buildEmbedContent,
  computeContentHash,
  estimateTokenCount,
  shouldEmbed,
  markEmbedded,
} from './changeDetector';
import type { EmbeddableEntityType } from './embeddingQueue';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;

// p-limit concurrency matches DAILY_LIMITS.batchSize (25) per the queue contract.
// This prevents more than batchSize concurrent requests to OpenAI within one processBatch() call.
const limit = pLimit(DAILY_LIMITS.batchSize);

export interface EmbedRecord {
  entityType: EmbeddableEntityType;
  entityId: number;
  record: Record<string, unknown>;
}

export interface BatchResult {
  embedded: number;
  skipped: number;     // unchanged content — not a failure
  failed: number;
  tokensCost: number;
}

export async function processBatch(entities: EmbedRecord[]): Promise<BatchResult> {
  const budget = await checkEmbeddingBudget();
  if (!budget.allowed) {
    console.info(`[EMBED-BATCHER] Budget exhausted: ${budget.reason}`);
    return { embedded: 0, skipped: entities.length, failed: 0, tokensCost: 0 };
  }

  // Cap the batch to the remaining daily allowance
  const allowedCount = Math.min(budget.remaining, DAILY_LIMITS.batchSize, entities.length);
  const batch = entities.slice(0, allowedCount);

  let embedded = 0;
  let skipped = 0;
  let failed = 0;
  let tokensCost = 0;

  const results = await Promise.allSettled(
    batch.map((entity) =>
      limit(async () => {
        const content = buildEmbedContent(entity.entityType, entity.record);
        const contentHash = computeContentHash(content);

        // Change detection: skip if content unchanged
        const { embed, reason } = await shouldEmbed(
          entity.entityType,
          entity.entityId,
          contentHash,
        );
        if (!embed) {
          console.debug(`[EMBED-BATCHER] Skip ${entity.entityType}:${entity.entityId} (${reason})`);
          skipped++;
          return;
        }

        // Estimate tokens before calling API
        const estimatedTokens = estimateTokenCount(content);

        // Call OpenAI with retry (p-retry: 2 attempts, exponential backoff)
        const embeddingData = await pRetry(
          async () => {
            const response = await openai.embeddings.create({
              model: MODEL,
              input: content,
              encoding_format: 'float',
            });
            return {
              vector: response.data[0].embedding,
              actualTokens: response.usage.total_tokens,
            };
          },
          {
            retries: 2,
            minTimeout: 1_000,
            maxTimeout: 10_000,
            onFailedAttempt: (error) => {
              console.warn(
                `[EMBED-BATCHER] OpenAI attempt ${error.attemptNumber} failed for ` +
                `${entity.entityType}:${entity.entityId}: ${error.message}`
              );
            },
          },
        );

        // Upsert into embedding_store (Drizzle ORM)
        // The UNIQUE constraint on (source_type, source_id, model) handles concurrent upserts safely.
        await db.insert(embeddingStore).values({
          sourceType: entity.entityType,
          sourceId: String(entity.entityId),
          contentHash,
          contentPreview: content.substring(0, 500),
          embedding: embeddingData.vector as unknown as string,  // pgvector column type
          model: MODEL,
          dimensions: DIMENSIONS,
          metadata: {
            triggeredBy: entity.record._triggeredBy ?? 'batch',
            subAccountId: entity.record.subAccountId ?? null,
          },
        }).onConflictDoUpdate({
          target: [
            embeddingStore.sourceType,
            embeddingStore.sourceId,
            // Note: 'model' column not available in older schema — add if missing
          ],
          set: {
            embedding: sql`EXCLUDED.embedding`,
            contentHash: sql`EXCLUDED.content_hash`,
            contentPreview: sql`EXCLUDED.content_preview`,
            updatedAt: sql`NOW()`,
          },
        });

        // Record actual token usage (not estimate)
        await recordEmbeddingUsage(1, embeddingData.actualTokens);
        await markEmbedded(entity.entityType, entity.entityId, contentHash);

        tokensCost += embeddingData.actualTokens;
        embedded++;

        console.debug(
          `[EMBED-BATCHER] Embedded ${entity.entityType}:${entity.entityId} ` +
          `(${embeddingData.actualTokens} tokens, contentHash=${contentHash.slice(0, 8)}...)`
        );
      }),
    ),
  );

  failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) {
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason?.message ?? String(r.reason));
    console.error(`[EMBED-BATCHER] ${failed} failures in batch:`, errors);
  }

  // Delay between batches — prevents rate limit storms and gives HNSW time to settle
  await new Promise((r) => setTimeout(r, DAILY_LIMITS.batchDelayMs));

  console.info(
    `[EMBED-BATCHER] Batch complete: ${embedded} embedded, ${skipped} skipped, ` +
    `${failed} failed, ${tokensCost} tokens consumed`
  );

  return { embedded, skipped, failed, tokensCost };
}
```

---

## 7. HNSW Index Protection

The HNSW index in Neon (`embedding_store_hnsw_cosine_idx`) is sensitive to mass-insert operations. These rules protect query latency during the graduated reactivation process.

```typescript
// server/semantic/hnswGuard.ts
// Consulted by the embedding worker before bulk backfill operations.
// NOT consulted for normal incremental embedding (individual entity updates).
// Only the backfill scheduler (apex-maintenance queue) needs to call these functions.

import { db } from '../db';
import { sql } from 'drizzle-orm';
import { getRedisClient } from '../queues/redisClient';

// Thresholds derived from pgvector HNSW behavior at <200K vectors
export const HNSW_SAFETY = {
  // Insert rate that HNSW can sustain without degrading query latency
  maxInsertPerMinute: 200,

  // If apex-embeddings waiting count exceeds this, pause 60s to let HNSW settle.
  // BullMQ limiter (100/min) makes this unlikely — this is a defense-in-depth check.
  bulkPauseThreshold: 500,

  // Alert if p95 query latency exceeds this threshold (5× normal 2–5ms)
  queryLatencyWarnMs: 25,

  // ef_search parameter for HNSW queries
  // 40 = default, good recall for <200K vectors
  // Increase to 80 for higher-recall semantic search (at 2× query cost)
  defaultEfSearch: 40,
};

// Check current HNSW query latency via pg_stat_user_indexes or a test query
export async function checkHnswLatency(): Promise<{
  latencyMs: number;
  healthy: boolean;
  warning?: string;
}> {
  const start = Date.now();
  try {
    // Execute a test cosine similarity query against embedding_store
    // Uses the HNSW index directly — measures real query latency
    await db.execute(sql`
      SELECT 1
      FROM embedding_store
      ORDER BY embedding <=> '[${sql.raw(Array(DIMENSIONS).fill(0).join(','))}]'
      LIMIT 1
    `);
    const latencyMs = Date.now() - start;

    if (latencyMs > HNSW_SAFETY.queryLatencyWarnMs) {
      return {
        latencyMs,
        healthy: false,
        warning: `HNSW latency ${latencyMs}ms exceeds warning threshold ${HNSW_SAFETY.queryLatencyWarnMs}ms — HNSW may be rebuilding`,
      };
    }

    return { latencyMs, healthy: true };
  } catch (err) {
    return {
      latencyMs: Date.now() - start,
      healthy: false,
      warning: `HNSW health check failed: ${(err as Error).message}`,
    };
  }
}

// Before any bulk backfill: calculate how many days it should be spread over
// to avoid mass-insert HNSW rebuild degradation.
// Rule: never add more than 10% of total vectors in a single session.
export function calculateSafeBatchSchedule(
  totalToEmbed: number,
  currentVectorCount: number,
): {
  daysRequired: number;
  embedsPerDay: number;
  summary: string;
} {
  if (currentVectorCount === 0) {
    // Empty index: initial population can be faster (no graph to protect)
    return {
      daysRequired: 1,
      embedsPerDay: Math.min(totalToEmbed, DAILY_LIMITS.maxEmbeds),
      summary: `Empty index: safe to populate in one session at ${Math.min(totalToEmbed, DAILY_LIMITS.maxEmbeds)} embeds/day`,
    };
  }

  const safeInsertPct = 0.10;  // 10% of current total per day
  const safeInsertsPerDay = Math.max(
    Math.ceil(currentVectorCount * safeInsertPct),
    100,  // Minimum viable batch — don't spread below 100/day
  );

  const capInsertsPerDay = Math.min(safeInsertsPerDay, DAILY_LIMITS.maxEmbeds);
  const daysRequired = Math.ceil(totalToEmbed / capInsertsPerDay);

  return {
    daysRequired,
    embedsPerDay: capInsertsPerDay,
    summary: daysRequired === 1
      ? `Safe to run in single session: ${totalToEmbed} embeds (${(totalToEmbed / currentVectorCount * 100).toFixed(1)}% of index)`
      : `Spread over ${daysRequired} days: ${capInsertsPerDay} embeds/day (10% of current ${currentVectorCount} vectors per session)`,
  };
}

// Store backfill progress in Redis so it survives Railway restarts
export async function recordBackfillProgress(
  entityType: string,
  lastProcessedId: number,
  totalProcessed: number,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  await redis.hset(`apex:backfill:${entityType}`, {
    lastProcessedId: String(lastProcessedId),
    totalProcessed: String(totalProcessed),
    updatedAt: new Date().toISOString(),
  });
}

export async function getBackfillProgress(entityType: string): Promise<{
  lastProcessedId: number;
  totalProcessed: number;
} | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  const data = await redis.hgetall(`apex:backfill:${entityType}`);
  if (!data?.lastProcessedId) return null;
  return {
    lastProcessedId: parseInt(data.lastProcessedId),
    totalProcessed: parseInt(data.totalProcessed ?? '0'),
  };
}
```

---

## 8. Reactivation Plan — 8 Clearance Gates

Stage 3 embedding workers are paused. This section defines exactly when and how they restart. No single gate can be bypassed.

### Gate Definitions

**Gate 1 — Redis + BullMQ Stable**
- Upstash Redis connected, not returning connection errors
- `getRedisClient()` returns a live client (not null)
- All 11 BullMQ queues visible in @bull-board dashboard
- Zero connection resets in past 7 days (check Axiom logs for `ioredis ECONNRESET`)
- Required uptime: 7 consecutive days

**Gate 2 — Dead Letter Queue Operational**
- `apex-dlq` queue exists and accepting jobs
- DLQ sweeper (`apex-maintenance` queue job `dead-letter-sweep`) running on schedule
- Test procedure: manually inject a job that throws unconditionally, verify it lands in `apex-dlq` within 3 BullMQ retry cycles

**Gate 3 — Sentry Active, No Critical Errors**
- `SENTRY_DSN` set in Railway — verify in Railway env dashboard
- Test: `Sentry.captureMessage('Embedding reactivation gate 3 test')` visible in Sentry project
- No unresolved Sentry issues with severity `error` or `critical` in past 72 hours
- Specifically: zero `UNCAUGHT_EXCEPTION` or `UNHANDLED_REJECTION` errors from intelligence workers

**Gate 4 — Axiom Log Drain Active**
- `AXIOM_API_KEY` set in Railway
- Logs appearing in Axiom workspace within 60 seconds of production events
- Test: check for `[APEX-INTEL] Rollup cycle complete` log in Axiom — this fires every 15 minutes from `server/intelligence/rollupWorker.ts`

**Gate 5 — Queue Health Dashboard Returning Correct Metrics**
- `/api/internal/queue-health` endpoint returns accurate job counts for all queues
- `apex-embeddings` queue shows: `waiting: 0, active: 0, failed: 0`
- No stale or stuck jobs from pre-Phase 4A in-memory queue (verify `server/jobQueue.ts` has been replaced or bridged)

**Gate 6 — Worker Isolation Tested**
- Start the `apex-embeddings` BullMQ worker in isolation (no other workers running)
- Enqueue 5 test embed jobs with synthetic payloads (valid entity type + record, `force: true`)
- Verify: all 5 jobs complete successfully, vectors inserted into `embedding_store`
- Verify: `apex-routing` and `apex-intake` workers unaffected — check @bull-board for zero cross-queue interference
- Restart the Railway service and verify embed jobs survive (were not silently dropped)

**Gate 7 — Contact Count Stable**
- Review `contacts` table row count over past 7 days (query from Neon dashboard)
- Expected: stable growth of ~20 new contacts/day from crash ingestion
- Alert if: contact count spikes > 2× daily average (would indicate enrichment pipeline runaway)
- Context: 9,562 contacts at Stage 3 snapshot (2026-05-15). At 7-day check, expect ~9,562–9,700.

**Gate 8 — HNSW Latency Baseline**
- Run `checkHnswLatency()` 10 times (with 1-second spacing) and record p95
- Target: p95 < 10ms (2× the steady-state 2–5ms baseline)
- Alert threshold: p95 > 25ms means HNSW index needs `VACUUM ANALYZE embedding_store` before proceeding
- Tool: run from `server/tests/hnswLatencyCheck.ts` (add this file)

---

### Graduated Reactivation Schedule

Once all 8 gates pass, reactivation follows this schedule. Do not accelerate — the schedule exists to protect HNSW.

```
Day 1 (Reactivation):
  EMBEDDING_WORKER_ENABLED=true in Railway
  EMBEDDING_DAILY_CAP=100         ← 100 embeds maximum
  EMBEDDING_TOKEN_BUDGET=5000     ← ~250 contacts at 20 tokens each
  Monitor: HNSW latency after first 100 inserts (run checkHnswLatency())
  Monitor: apex-embeddings queue in @bull-board — should drain smoothly
  Monitor: No OOM kills in Railway logs

Day 3 (if Day 1 stable):
  EMBEDDING_DAILY_CAP=500
  EMBEDDING_TOKEN_BUDGET=25000
  Monitor: Same as Day 1 + check routing queue SLA is unaffected
  Expected: ~500 contacts embedded over the day

Day 7 (if Days 1–6 stable):
  EMBEDDING_DAILY_CAP=2000        ← Standard cap (matches Stage 3 design)
  EMBEDDING_TOKEN_BUDGET=100000   ← Standard budget
  Monitor: Daily usage report via getDailyUsage()
  Expected: ~2000 contacts embedded over the day (approaching full contact coverage)

Day 14 (if Days 1–13 stable):
  Enable backfill queue:
    → Queue: apex-maintenance job 'embedding-backfill-contacts'
    → Schedule: weekdays only, 02:00–04:00 UTC window (low-traffic period)
    → Rate: calculateSafeBatchSchedule(remainingUnembedded, currentVectorCount)
    → Expected: embed all ~37K records over 3–7 days at 2,000/day
  Monitor: HNSW latency throughout backfill (run checkHnswLatency() every 30 minutes)

Post-backfill:
  Standard operation: embedding triggers from enrichment + scoring pipelines
  EMBEDDING_DAILY_CAP: 2000 (sufficient for daily delta — ~100 new/updated records/day)
  Backfill queue: disable after completion
```

---

## 9. Embedding Worker Registration

The embedding worker integrates with the existing intelligence worker pattern. It does NOT replace `server/intelligence/worker.ts` — it runs alongside it in the same process.

```typescript
// server/semantic/embeddingWorker.ts
// Registered by: server/startup/workerRegistry.ts (Phase 4A)
// Pattern: mirrors server/intelligence/rollupWorker.ts lifecycle management

import { Worker, type Job } from 'bullmq';
import { EMBEDDING_QUEUE_CONFIG, type EmbedJobPayload } from './embeddingQueue';
import { processBatch } from './embeddingBatcher';
import { checkHnswLatency, HNSW_SAFETY } from './hnswGuard';
import { isFeatureEnabled } from '../featureFlags';
import type { RedisOptions } from 'ioredis';

let embeddingWorker: Worker | null = null;

export async function startEmbeddingWorker(redisOptions: RedisOptions): Promise<void> {
  // Double-check clearance at startup
  const cleared = process.env.EMBEDDING_WORKER_ENABLED === 'true' ||
    await isFeatureEnabled('embedding_worker_enabled');

  if (!cleared) {
    console.log('[EMBED-WORKER] Not starting — EMBEDDING_WORKER_ENABLED=false (Stage 3 observation window)');
    return;
  }

  // Gate: HNSW latency check before starting
  const { healthy, latencyMs, warning } = await checkHnswLatency();
  if (!healthy) {
    console.error(`[EMBED-WORKER] HNSW latency check failed (${latencyMs}ms): ${warning}`);
    console.error('[EMBED-WORKER] Refusing to start — run: VACUUM ANALYZE embedding_store');
    return;
  }
  console.log(`[EMBED-WORKER] HNSW latency: ${latencyMs}ms (healthy)`);

  embeddingWorker = new Worker<EmbedJobPayload>(
    EMBEDDING_QUEUE_CONFIG.name,
    async (job: Job<EmbedJobPayload>) => {
      const { entityType, entityId, contentHash, force, triggeredBy } = job.data;

      console.debug(
        `[EMBED-WORKER] Processing ${entityType}:${entityId} | trigger=${triggeredBy} | traceId=${job.data.traceId}`
      );

      // Fetch the full record from DB based on entity type
      const record = await fetchEntityRecord(entityType, entityId);
      if (!record) {
        console.warn(`[EMBED-WORKER] Entity not found: ${entityType}:${entityId} — skipping`);
        return;
      }

      await processBatch([{ entityType, entityId, record }]);
    },
    {
      connection: redisOptions,
      concurrency: EMBEDDING_QUEUE_CONFIG.concurrency,
      limiter: EMBEDDING_QUEUE_CONFIG.limiter,
    },
  );

  embeddingWorker.on('failed', (job, err) => {
    console.error(
      `[EMBED-WORKER] Job failed: ${job?.data.entityType}:${job?.data.entityId} — ${err.message}`
    );
  });

  embeddingWorker.on('stalled', (jobId) => {
    console.warn(`[EMBED-WORKER] Job stalled: ${jobId}`);
  });

  console.log('[EMBED-WORKER] Embedding worker started — apex-embeddings queue active');
}

export async function stopEmbeddingWorker(): Promise<void> {
  if (embeddingWorker) {
    await embeddingWorker.close();
    embeddingWorker = null;
    console.log('[EMBED-WORKER] Embedding worker stopped');
  }
}

// Helper: fetch entity record for embedding
async function fetchEntityRecord(
  entityType: EmbedJobPayload['entityType'],
  entityId: number,
): Promise<Record<string, unknown> | null> {
  const { db } = await import('../db');
  const { contacts, sentinelIncidents, legalSignals, intelligenceCases } = await import('@shared/schema');
  const { eq } = await import('drizzle-orm');

  switch (entityType) {
    case 'contact': {
      const rows = await db.select().from(contacts).where(eq(contacts.id, entityId)).limit(1);
      return (rows[0] as Record<string, unknown>) ?? null;
    }
    case 'incident': {
      const rows = await db.select().from(sentinelIncidents).where(eq(sentinelIncidents.id, entityId)).limit(1);
      return (rows[0] as Record<string, unknown>) ?? null;
    }
    case 'legal_signal': {
      const rows = await db.select().from(legalSignals).where(eq(legalSignals.id, entityId)).limit(1);
      return (rows[0] as Record<string, unknown>) ?? null;
    }
    case 'case': {
      const rows = await db.select().from(intelligenceCases).where(eq(intelligenceCases.id, entityId)).limit(1);
      return (rows[0] as Record<string, unknown>) ?? null;
    }
    default:
      return null;
  }
}
```

---

## 10. Integration with Existing Workers

The embedding worker integrates with the intelligence worker cycle (`server/intelligence/worker.ts`) via event hooks, NOT by modifying that file. The existing worker's `SCORING_TRIGGER_EVENTS` set and `scheduleScoringForAccount()` function remain unchanged.

```typescript
// Integration points — add these to existing pipeline files after Gate clearance:

// server/services/contactUpsertService.ts — after successful upsert:
// IF EMBEDDING_WORKER_ENABLED=true AND contact content changed:
//   await enqueueEmbedJob(embeddingQueue, {
//     entityType: 'contact', entityId: contact.id,
//     contentHash: computeContentHash(buildEmbedContent('contact', contact)),
//     triggeredBy: 'enrichment',
//     traceId: crypto.randomUUID(),
//   });

// server/intelligence/scoringEngine.ts — after scoring cycle:
// IF EMBEDDING_WORKER_ENABLED=true AND score changed significantly:
//   Enqueue embed for updated contacts (triggeredBy: 'scoring')
//   This allows the semantic layer to reflect scoring-derived intent signals

// server/crashIngestPipeline.ts — after new incident created:
// IF EMBEDDING_WORKER_ENABLED=true:
//   Enqueue embed for new sentinel_incident (triggeredBy: 'enrichment')

// NOTE: Do NOT modify these files during Phase 4A foundation work.
// Add integration points only after all 8 clearance gates pass.
```

---

## 11. Retention and Cleanup

Vectors accumulate over time. Without cleanup, the HNSW index grows indefinitely, increasing query latency and memory pressure. The cleanup job runs in the `apex-maintenance` queue, monthly, during the low-traffic window (02:00–04:00 UTC).

```typescript
// server/semantic/embeddingRetention.ts
// Scheduled as: apex-maintenance queue job 'embedding-monthly-cleanup'
// Frequency: 1st of each month at 02:00 UTC (BullMQ repeatable job)

export const RETENTION_RULES = {
  contact: {
    // Keep: export_eligible = true (these are active leads)
    // Keep: active in past 90 days (updated_at > NOW() - INTERVAL '90 days')
    // Delete: archived > 180 days AND export_eligible = false
    maxArchiveDays: 180,
    keepIfExportEligible: true,
    keepIfActiveDays: 90,
  },
  incident: {
    // Keep 1 year — incidents have long legal relevance windows
    retentionDays: 365,
  },
  legal_signal: {
    // Keep 2 years — statutes of limitations are typically 2–4 years in FL
    retentionDays: 730,
  },
  case: {
    // Keep indefinitely while case is active; 2 years after close
    retentionDaysAfterClose: 730,
  },
} as const;

// Cleanup SQL (run directly for transparency — not through Drizzle ORM abstraction):

export const CLEANUP_QUERIES = {
  // Contact embeddings: delete for archived, non-export-eligible contacts inactive > 180 days
  contacts: `
    DELETE FROM embedding_store
    WHERE source_type = 'contact'
      AND source_id::integer IN (
        SELECT id FROM contacts
        WHERE status = 'archived'
          AND export_eligible = false
          AND updated_at < NOW() - INTERVAL '180 days'
      )
  `,

  // Incident embeddings: delete after 1 year
  incidents: `
    DELETE FROM embedding_store
    WHERE source_type = 'incident'
      AND created_at < NOW() - INTERVAL '365 days'
  `,

  // Legal signal embeddings: delete after 2 years
  legal_signals: `
    DELETE FROM embedding_store
    WHERE source_type = 'legal_signal'
      AND created_at < NOW() - INTERVAL '730 days'
  `,

  // Clear dedup cache keys for deleted embeddings (Redis)
  // Run: SCAN + DEL for keys matching apex:dedup:embed:{type}:{id} where entity is deleted
  // This prevents stale cache entries from blocking future re-embedding of new entities
  // with the same ID (unlikely but possible after ID reuse in testing).
};

// After running cleanup queries, run VACUUM to reclaim HNSW graph space:
// VACUUM ANALYZE embedding_store;
// This triggers HNSW graph compaction and should be done in the maintenance window.
```

---

## 12. Monitoring and Observability

The embedding worker exposes metrics for the queue health dashboard (`/api/internal/queue-health`) and Axiom log drain.

```typescript
// Structured log fields to emit on every embedding batch (parsed by Axiom):
const EMBED_LOG_FIELDS = {
  component: 'embed-worker',
  entityType: string,           // 'contact' | 'incident' | 'legal_signal' | 'case'
  batchSize: number,
  embedded: number,
  skipped: number,
  failed: number,
  tokensConsumed: number,
  budgetRemaining: number,
  budgetTokensRemaining: number,
  hnswLatencyMs: number,        // Checked every 100 embeds during backfill
  triggeredBy: string,
  traceId: string,
};

// Key Axiom queries for embedding health:
// 1. Daily embed throughput:       sum(embedded) group by date(timestamp)
// 2. Token burn rate:              sum(tokensConsumed) group by date(timestamp)
// 3. Skip rate:                    sum(skipped) / (sum(embedded) + sum(skipped))
// 4. HNSW latency trend:           percentile(hnswLatencyMs, 0.95) group by hour(timestamp)
// 5. Budget exhaustion events:     filter(budgetRemaining == 0)
```

---

## 13. Cross-References

| Document | Relationship |
|---|---|
| `docs/STAGE_3_VECTOR_ARCHITECTURE.md` | `embedding_store` schema, HNSW index parameters, model selection rationale |
| `docs/STAGE_3_EMBEDDING_STRATEGY.md` | Content builders (contacts, incidents, cases), cost estimates, population roadmap |
| `docs/STAGE_3_OBSERVATION_WINDOW.md` | Current pause rationale, clearance criteria, operational metrics snapshot |
| `docs/STAGE_4A_QUEUE_ARCHITECTURE.md` | `apex-embeddings` queue parameters (authoritative), `apex-semantic` queue, `apex-maintenance` |
| `docs/STAGE_4A_OCR_ORCHESTRATION.md` | Phase 5 hook: document entities → embed queue (not activated in Phase 4A) |
| `server/intelligence/worker.ts` | Existing scoring + rollup worker — embedding worker must not interfere with it |
| `server/intelligence/rollupWorker.ts` | Rollup cycle pattern reference for worker lifecycle management |
| `server/jobQueue.ts` | Legacy in-memory queue being replaced by BullMQ — embedding worker uses BullMQ only |
| `server/featureFlags.ts` | `isFeatureEnabled('embedding_worker_enabled')` — DB-backed flag check |
| `server/services/contactUpsertService.ts` | Integration point: enqueue embed after contact upsert (add post-clearance) |
