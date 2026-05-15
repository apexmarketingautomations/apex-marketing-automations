# Stage 4A — Queue Architecture
**Apex Marketing OS | BullMQ + Upstash Redis**
**Status:** Design-complete, pre-implementation
**Depends on:** Stage 3 (pgvector, 21 operational tables)
**Blocks:** Stage 4B (OCR pipeline activation), Stage 5 (step functions)

---

## 1. Objective

Replace `server/jobQueue.ts` — a plain JavaScript array with `MAX_CONCURRENT = 5` and no persistence — with BullMQ backed by Upstash Redis. Jobs currently in-flight when the Railway container restarts are silently lost. This stage makes every job durable without restructuring any existing ingestion code.

The migration must be **backward-compatible**: all callers of `jobQueue.enqueue()` and `jobQueue.getStats()` keep working on day one through a legacy adapter. Worker domains are activated queue-by-queue, not all at once.

---

## 2. BullMQ Selection Rationale

| Factor | BullMQ | Inngest | Temporal | pg-boss |
|---|---|---|---|---|
| Infrastructure dependency | Redis (Upstash) | Managed SaaS | Managed / self-hosted | Postgres only |
| Persistence across restarts | Yes — Redis AOF | Yes — managed | Yes — DB | Yes — Postgres |
| Step / saga functions | Basic flow | Advanced | Advanced | No |
| Cron / repeat jobs | Native | Native | Native | Native |
| Dead-letter queue | Native `failed` state | Native | Native | Limited |
| Ops complexity | Low | Low | High | Very low |
| Monthly cost at current volume | Upstash free → ~$10 | Free → $20+ per seat | High | $0 |
| Board UI (built-in) | bull-board / @bull-board | SaaS dashboard | SaaS dashboard | None |
| Node.js SDK maturity | Excellent — ioredis-native | Good | Good | Good |
| **Decision** | **CHOSEN** | Phase 5+ | Phase 6+ | Rejected |

**Why not pg-boss?** Apex already uses Neon for 21 operational tables plus pgvector. Adding queue polling load to the same Postgres instance during crash-ingest storms is a coupling risk. Redis is a purpose-built data structure store; queue throughput stays off the OLTP path.

**Why not Inngest?** No SaaS dependency in the critical path for a single-Railway deployment. Inngest is worth revisiting in Phase 5 for step functions and fan-out workflows.

**Upstash Redis** is chosen over a dedicated Redis VM because it is serverless, TCP-compatible with ioredis (BullMQ's underlying client), has a free tier sufficient for development, and bills per command — not per running instance.

---

## 3. Queue Hierarchy — All 11 Queues

### 3.1 Design Principles

- Queues are separated by **latency contract**, not by domain. A routing job and a crash-ingest job have incompatible SLAs and must not compete for the same concurrency slot.
- `removeOnComplete` keeps recent job data in Redis for debugging without unbounded growth.
- `removeOnFail: false` on all queues — failed jobs persist in Redis so the DLQ sweeper can read them.
- `jobId` is always the dedupe key; BullMQ ignores a duplicate `add()` if the job ID already exists in the queue.

### 3.2 HIGH PRIORITY — Concurrency 3

```typescript
// ─── apex-routing ───────────────────────────────────────────────────────────
// SLA: < 30 seconds end-to-end
// Jobs: contact-routing, lead-distribution, attorney-assignment, case-routing
{
  name: 'apex-routing',
  concurrency: 3,
  defaultJobOptions: {
    priority: 10,               // highest in BullMQ (lower number = higher priority)
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 200, age: 86400 },
    removeOnFail: false,
    timeout: 30_000,
  },
}

// ─── apex-notifications ─────────────────────────────────────────────────────
// SLA: < 60 seconds
// Jobs: sms-send, email-send, push-notification, webhook-outbound
{
  name: 'apex-notifications',
  concurrency: 3,
  defaultJobOptions: {
    priority: 8,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 500, age: 86400 },
    removeOnFail: false,
    timeout: 60_000,
  },
}

// ─── apex-intake ─────────────────────────────────────────────────────────────
// SLA: < 5 minutes
// Jobs: crash-ingest, arrest-ingest, court-filing-ingest, legal-signal-ingest,
//       permit-ingest, hillsborough-records-ingest, jail-booking-ingest
{
  name: 'apex-intake',
  concurrency: 3,
  defaultJobOptions: {
    priority: 7,
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000, age: 604800 },  // 7 days
    removeOnFail: false,
    timeout: 300_000,
  },
}
```

### 3.3 MEDIUM PRIORITY — Concurrency 5

```typescript
// ─── apex-enrichment ─────────────────────────────────────────────────────────
// SLA: < 30 minutes
// Jobs: skip-trace, phone-validation, address-validation, attorney-scrape,
//       property-lookup, transport-scrape
{
  name: 'apex-enrichment',
  concurrency: 5,
  defaultJobOptions: {
    priority: 5,
    attempts: 4,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 500, age: 259200 },   // 3 days
    removeOnFail: false,
    timeout: 120_000,
  },
}

// ─── apex-scoring ────────────────────────────────────────────────────────────
// SLA: < 10 minutes
// Jobs: lead-score, case-score, territory-score, legal-heat-score
{
  name: 'apex-scoring',
  concurrency: 5,
  defaultJobOptions: {
    priority: 5,
    attempts: 3,
    backoff: { type: 'fixed', delay: 5000 },
    removeOnComplete: { count: 300, age: 86400 },
    removeOnFail: false,
    timeout: 60_000,
  },
}

// ─── apex-crm ────────────────────────────────────────────────────────────────
// SLA: < 15 minutes
// Jobs: contact-upsert, lifecycle-update, export-eligibility-eval,
//       territory-assignment
{
  name: 'apex-crm',
  concurrency: 5,
  defaultJobOptions: {
    priority: 4,
    attempts: 4,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 300, age: 86400 },
    removeOnFail: false,
    timeout: 60_000,
  },
}
```

### 3.4 LOW PRIORITY — Rate-limited

```typescript
// ─── apex-embeddings ─────────────────────────────────────────────────────────
// Rate limit: 2000 jobs/day (enforced via daily counter in Redis)
// Batch size: 25 items per job
// Token budget: 100k tokens/day
// Jobs: contact-embed, incident-embed, legal-signal-embed, case-embed
// NOTE: PAUSED — Stage 3 observation window still active
{
  name: 'apex-embeddings',
  concurrency: 10,
  limiter: { max: 100, duration: 60_000 },   // 100 per minute burst cap
  defaultJobOptions: {
    priority: 2,
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 200, age: 86400 },
    removeOnFail: false,
    timeout: 30_000,
  },
}

// ─── apex-semantic ───────────────────────────────────────────────────────────
// Rate limit: 50 per hour
// Jobs: vector-index, similarity-search-warmup, embedding-backfill
{
  name: 'apex-semantic',
  concurrency: 10,
  limiter: { max: 50, duration: 3_600_000 },
  defaultJobOptions: {
    priority: 2,
    attempts: 1,                              // no retry storms on vector ops
    removeOnComplete: { count: 100, age: 86400 },
    removeOnFail: false,
    timeout: 30_000,
  },
}

// ─── apex-ocr ────────────────────────────────────────────────────────────────
// Rate limit: 200 per hour (Google DocAI + Textract combined)
// Jobs: document-ingest, ocr-extract, entity-extract, evidence-link
// Provider: google-docai primary → textract fallback
// NOT ACTIVATED — foundation only, gated by OCR_WORKER_ENABLED env var
{
  name: 'apex-ocr',
  concurrency: 2,
  limiter: { max: 200, duration: 3_600_000 },
  defaultJobOptions: {
    priority: 3,
    attempts: 3,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { count: 200, age: 604800 },
    removeOnFail: false,
    timeout: 600_000,
  },
}
```

### 3.5 BACKGROUND — Off-peak

```typescript
// ─── apex-maintenance ─────────────────────────────────────────────────────────
// Concurrency: 2 (never compete with production traffic)
// Jobs: db-health-check, dead-letter-sweep, archive-old-records,
//       vacuum-embeddings, queue-health-snapshot, embedding-daily-cap-reset
{
  name: 'apex-maintenance',
  concurrency: 2,
  defaultJobOptions: {
    priority: 1,
    attempts: 1,                             // maintenance jobs fail loudly and stop
    removeOnComplete: { count: 50, age: 86400 },
    removeOnFail: false,
    timeout: 120_000,
  },
}

// ─── apex-analytics ──────────────────────────────────────────────────────────
// Rate limit: 10 per hour (heavy Neon queries)
// Jobs: metric-rollup, cohort-rebuild, territory-heatmap-update
{
  name: 'apex-analytics',
  concurrency: 2,
  limiter: { max: 10, duration: 3_600_000 },
  defaultJobOptions: {
    priority: 1,
    attempts: 1,
    removeOnComplete: { count: 50, age: 86400 },
    removeOnFail: false,
    timeout: 180_000,
  },
}
```

---

## 4. Queue Factory Pattern

```typescript
// server/queues/queueFactory.ts
import { Queue, QueueEvents } from 'bullmq';
import type { DefaultJobOptions } from 'bullmq';
import { redis } from '../redis';
import { logSystemEvent } from '../systemLogger';

export interface QueueConfig {
  name: string;
  concurrency: number;
  defaultJobOptions: DefaultJobOptions;
  limiter?: { max: number; duration: number };
}

// Canonical registry — import this to add a job to any queue
const QUEUE_CONFIGS: QueueConfig[] = [
  {
    name: 'apex-routing',
    concurrency: 3,
    defaultJobOptions: {
      priority: 10,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 200, age: 86400 },
      removeOnFail: false,
    },
  },
  {
    name: 'apex-notifications',
    concurrency: 3,
    defaultJobOptions: {
      priority: 8,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 500, age: 86400 },
      removeOnFail: false,
    },
  },
  {
    name: 'apex-intake',
    concurrency: 3,
    defaultJobOptions: {
      priority: 7,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 1000, age: 604800 },
      removeOnFail: false,
    },
  },
  {
    name: 'apex-enrichment',
    concurrency: 5,
    defaultJobOptions: {
      priority: 5,
      attempts: 4,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { count: 500, age: 259200 },
      removeOnFail: false,
    },
  },
  {
    name: 'apex-scoring',
    concurrency: 5,
    defaultJobOptions: {
      priority: 5,
      attempts: 3,
      backoff: { type: 'fixed', delay: 5000 },
      removeOnComplete: { count: 300, age: 86400 },
      removeOnFail: false,
    },
  },
  {
    name: 'apex-crm',
    concurrency: 5,
    defaultJobOptions: {
      priority: 4,
      attempts: 4,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 300, age: 86400 },
      removeOnFail: false,
    },
  },
  {
    name: 'apex-embeddings',
    concurrency: 10,
    limiter: { max: 100, duration: 60_000 },
    defaultJobOptions: {
      priority: 2,
      attempts: 2,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 200, age: 86400 },
      removeOnFail: false,
    },
  },
  {
    name: 'apex-semantic',
    concurrency: 10,
    limiter: { max: 50, duration: 3_600_000 },
    defaultJobOptions: {
      priority: 2,
      attempts: 1,
      removeOnComplete: { count: 100, age: 86400 },
      removeOnFail: false,
    },
  },
  {
    name: 'apex-ocr',
    concurrency: 2,
    limiter: { max: 200, duration: 3_600_000 },
    defaultJobOptions: {
      priority: 3,
      attempts: 3,
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: { count: 200, age: 604800 },
      removeOnFail: false,
    },
  },
  {
    name: 'apex-maintenance',
    concurrency: 2,
    defaultJobOptions: {
      priority: 1,
      attempts: 1,
      removeOnComplete: { count: 50, age: 86400 },
      removeOnFail: false,
    },
  },
  {
    name: 'apex-analytics',
    concurrency: 2,
    limiter: { max: 10, duration: 3_600_000 },
    defaultJobOptions: {
      priority: 1,
      attempts: 1,
      removeOnComplete: { count: 50, age: 86400 },
      removeOnFail: false,
    },
  },
];

// Singleton queue instances — created once, reused everywhere
const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  if (!queues.has(name)) {
    const config = QUEUE_CONFIGS.find(c => c.name === name);
    if (!config) throw new Error(`[QUEUE-FACTORY] Unknown queue: ${name}`);
    if (!redis) throw new Error('[QUEUE-FACTORY] Redis not initialized');

    const queue = new Queue(name, {
      connection: redis,
      defaultJobOptions: config.defaultJobOptions,
    });

    queues.set(name, queue);
    logSystemEvent('info', 'queue-factory', `Queue initialized: ${name}`, { config });
  }
  return queues.get(name)!;
}

export function getAllQueues(): Queue[] {
  return QUEUE_CONFIGS.map(c => getQueue(c.name));
}

export function getQueueConfig(name: string): QueueConfig | undefined {
  return QUEUE_CONFIGS.find(c => c.name === name);
}

export async function closeAllQueues(): Promise<void> {
  await Promise.all([...queues.values()].map(q => q.close()));
  queues.clear();
}
```

---

## 5. Redis Connection

```typescript
// server/redis.ts
import { Redis } from 'ioredis';
import { logSystemEvent } from './systemLogger';

let _redis: Redis | null = null;

export function getRedis(): Redis | null {
  return _redis;
}

// Alias for convenient import
export { _redis as redis };

export async function initRedis(): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL;
  if (!url) {
    logSystemEvent('warn', 'redis', 'No Redis URL configured — running in legacy queue mode');
    return false;
  }

  try {
    _redis = new Redis(url, {
      maxRetriesPerRequest: null,   // Required by BullMQ
      enableReadyCheck: false,       // Required by BullMQ
      lazyConnect: false,
      connectTimeout: 10_000,
      commandTimeout: 5_000,
      retryStrategy: (times: number) => {
        if (times > 10) {
          logSystemEvent('error', 'redis', `Redis reconnect failed after ${times} attempts`);
          return null;               // Stop retrying
        }
        return Math.min(times * 500, 5000);
      },
    });

    await _redis.ping();
    logSystemEvent('info', 'redis', 'Redis connected', { url: url.replace(/:[^@]+@/, ':***@') });
    return true;
  } catch (err: any) {
    logSystemEvent('error', 'redis', `Redis connection failed: ${err.message}`);
    _redis = null;
    return false;
  }
}

export function isRedisAvailable(): boolean {
  return _redis !== null && _redis.status === 'ready';
}
```

---

## 6. Job Type Registry

```typescript
// server/queues/jobTypes.ts

export type ApexJobType =
  // ── Routing ──────────────────────────────────────────────────────────────
  | 'contact-routing'
  | 'lead-distribution'
  | 'attorney-assignment'
  | 'case-routing'
  // ── Notifications ────────────────────────────────────────────────────────
  | 'sms-send'
  | 'email-send'
  | 'push-notification'
  | 'webhook-outbound'
  // ── Intake ───────────────────────────────────────────────────────────────
  | 'crash-ingest'
  | 'arrest-ingest'
  | 'court-filing-ingest'
  | 'legal-signal-ingest'
  | 'permit-ingest'
  | 'hillsborough-records-ingest'
  | 'jail-booking-ingest'
  | 'home-service-signal-ingest'
  | 'court-listener-ingest'
  // ── Enrichment ───────────────────────────────────────────────────────────
  | 'skip-trace'
  | 'phone-validation'
  | 'address-validation'
  | 'attorney-scrape'
  | 'transport-scrape'
  | 'property-lookup'
  // ── Scoring ──────────────────────────────────────────────────────────────
  | 'lead-score'
  | 'case-score'
  | 'territory-score'
  | 'legal-heat-score'
  // ── CRM ──────────────────────────────────────────────────────────────────
  | 'contact-upsert'
  | 'lifecycle-update'
  | 'export-eligibility-eval'
  | 'territory-assignment'
  // ── Embeddings ───────────────────────────────────────────────────────────
  | 'contact-embed'
  | 'incident-embed'
  | 'legal-signal-embed'
  | 'case-embed'
  // ── Semantic ─────────────────────────────────────────────────────────────
  | 'vector-index'
  | 'similarity-search-warmup'
  | 'embedding-backfill'
  // ── OCR ──────────────────────────────────────────────────────────────────
  | 'document-ingest'
  | 'ocr-extract'
  | 'entity-extract'
  | 'evidence-link'
  // ── Maintenance ──────────────────────────────────────────────────────────
  | 'db-health-check'
  | 'dead-letter-sweep'
  | 'archive-records'
  | 'vacuum-embeddings'
  | 'queue-health-snapshot'
  | 'embedding-daily-cap-reset'
  // ── Analytics ────────────────────────────────────────────────────────────
  | 'metric-rollup'
  | 'cohort-rebuild'
  | 'territory-heatmap-update'
  // ── Legacy passthrough (for meta_campaign_sync and similar) ──────────────
  | 'meta_campaign_sync'
  | string;  // open for callers that have not migrated yet

// ── Canonical payload shapes ─────────────────────────────────────────────────

export interface JobPayloadMap {
  'crash-ingest': {
    incidentId: number;
    reportNumber: string;
    county: string;
    sourceConfidence: number;
    retryReason?: string;
    traceId?: string;
  };
  'arrest-ingest': {
    bookingId: number;
    externalId: string;
    county: string;
    sourceConfidence: number;
    traceId?: string;
  };
  'court-filing-ingest': {
    caseNumber: string;
    court: string;
    sourceUrl?: string;
    traceId?: string;
  };
  'legal-signal-ingest': {
    signalType: string;
    externalId: string;
    county?: string;
    traceId?: string;
  };
  'skip-trace': {
    contactId: number;
    subAccountId: number;
    priority: 'high' | 'normal' | 'low';
    triggeredBy: 'routing' | 'enrichment' | 'manual' | 'startup';
    traceId?: string;
  };
  'phone-validation': {
    contactId: number;
    phone: string;
    traceId?: string;
  };
  'address-validation': {
    contactId: number;
    address: string;
    traceId?: string;
  };
  'attorney-scrape': {
    county: string;
    practiceArea?: string;
    triggeredBy: 'scheduler' | 'manual';
    traceId?: string;
  };
  'lead-score': {
    contactId: number;
    subAccountId: number;
    triggeredBy: 'ingest' | 'enrichment' | 'manual';
    traceId?: string;
  };
  'case-score': {
    incidentId: number;
    subAccountId: number;
    traceId?: string;
  };
  'contact-upsert': {
    contactId: number;
    subAccountId: number;
    fingerprintHash: string;
    traceId?: string;
  };
  'export-eligibility-eval': {
    contactId: number;
    subAccountId: number;
    traceId?: string;
  };
  'contact-embed': {
    contactId: number;
    contentHash: string;
    entityType: 'contact';
    force?: boolean;
    traceId?: string;
  };
  'incident-embed': {
    incidentId: number;
    contentHash: string;
    entityType: 'incident';
    force?: boolean;
    traceId?: string;
  };
  'legal-signal-embed': {
    signalId: number;
    contentHash: string;
    entityType: 'legal_signal';
    force?: boolean;
    traceId?: string;
  };
  'document-ingest': {
    acquisitionJobId: number;
    documentType: string;
    storageKey: string;                // Cloudflare R2 object key
    sourceConfidence: number;
    linkedIncidentId?: number;
    linkedContactId?: number;
    traceId?: string;
  };
  'ocr-extract': {
    acquisitionJobId: number;
    storageKey: string;
    provider: 'google-docai' | 'textract';
    traceId?: string;
  };
  'entity-extract': {
    acquisitionJobId: number;
    rawOcrText: string;
    documentType: string;
    traceId?: string;
  };
  'dead-letter-sweep': Record<string, never>;
  'db-health-check': Record<string, never>;
  'queue-health-snapshot': Record<string, never>;
  'embedding-daily-cap-reset': Record<string, never>;
  'archive-records': {
    olderThanDays: number;
    tables: string[];
  };
  'metric-rollup': {
    subAccountId?: number;
    windowHours: number;
  };
  'territory-heatmap-update': {
    county?: string;
  };
  'meta_campaign_sync': {
    triggeredBy: 'scheduler' | 'startup' | 'manual';
    scheduledAt: string;
  };
}

// Queue routing — which queue handles which job type
export const JOB_QUEUE_MAP: Record<ApexJobType, string> = {
  'contact-routing':          'apex-routing',
  'lead-distribution':        'apex-routing',
  'attorney-assignment':      'apex-routing',
  'case-routing':             'apex-routing',
  'sms-send':                 'apex-notifications',
  'email-send':               'apex-notifications',
  'push-notification':        'apex-notifications',
  'webhook-outbound':         'apex-notifications',
  'crash-ingest':             'apex-intake',
  'arrest-ingest':            'apex-intake',
  'court-filing-ingest':      'apex-intake',
  'legal-signal-ingest':      'apex-intake',
  'permit-ingest':            'apex-intake',
  'hillsborough-records-ingest': 'apex-intake',
  'jail-booking-ingest':      'apex-intake',
  'home-service-signal-ingest': 'apex-intake',
  'court-listener-ingest':    'apex-intake',
  'skip-trace':               'apex-enrichment',
  'phone-validation':         'apex-enrichment',
  'address-validation':       'apex-enrichment',
  'attorney-scrape':          'apex-enrichment',
  'transport-scrape':         'apex-enrichment',
  'property-lookup':          'apex-enrichment',
  'lead-score':               'apex-scoring',
  'case-score':               'apex-scoring',
  'territory-score':          'apex-scoring',
  'legal-heat-score':         'apex-scoring',
  'contact-upsert':           'apex-crm',
  'lifecycle-update':         'apex-crm',
  'export-eligibility-eval':  'apex-crm',
  'territory-assignment':     'apex-crm',
  'contact-embed':            'apex-embeddings',
  'incident-embed':           'apex-embeddings',
  'legal-signal-embed':       'apex-embeddings',
  'case-embed':               'apex-embeddings',
  'vector-index':             'apex-semantic',
  'similarity-search-warmup': 'apex-semantic',
  'embedding-backfill':       'apex-semantic',
  'document-ingest':          'apex-ocr',
  'ocr-extract':              'apex-ocr',
  'entity-extract':           'apex-ocr',
  'evidence-link':            'apex-ocr',
  'db-health-check':          'apex-maintenance',
  'dead-letter-sweep':        'apex-maintenance',
  'archive-records':          'apex-maintenance',
  'vacuum-embeddings':        'apex-maintenance',
  'queue-health-snapshot':    'apex-maintenance',
  'embedding-daily-cap-reset': 'apex-maintenance',
  'metric-rollup':            'apex-analytics',
  'cohort-rebuild':           'apex-analytics',
  'territory-heatmap-update': 'apex-analytics',
  'meta_campaign_sync':       'apex-crm',        // legacy; lives in CRM queue
};
```

---

## 7. Idempotency Strategy

BullMQ deduplicates by `jobId`. Setting `jobId` to a content-derived key prevents duplicate job storms from:
- Webhook retries delivering the same crash report twice
- Crash-ingest sweep and live feed overlap
- Multiple enrichment triggers for the same contact within seconds

```typescript
// server/queues/dedupeKeys.ts
import type { ApexJobType, JobPayloadMap } from './jobTypes';

/**
 * Returns a stable, collision-resistant dedupe key for a given job.
 * BullMQ uses this as the Redis key; a second add() with the same jobId
 * is silently dropped if the job is still waiting or active.
 *
 * Rules:
 * - Keys MUST be deterministic from the payload — no timestamps, no UUIDs
 * - Keys MUST be specific enough that distinct logical operations don't collide
 * - For jobs with a content hash in the payload, include it (prevents re-embed
 *   after unrelated field updates)
 */
export function getDedupeKey(jobType: ApexJobType, payload: Record<string, any>): string {
  switch (jobType) {
    // ── Intake ───────────────────────────────────────────────────────────
    case 'crash-ingest':
      return `crash-ingest:${payload.reportNumber}`;
    case 'arrest-ingest':
      return `arrest-ingest:${payload.externalId}`;
    case 'court-filing-ingest':
      return `court-filing:${payload.caseNumber}`;
    case 'legal-signal-ingest':
      return `legal-signal:${payload.signalType}:${payload.externalId}`;
    case 'jail-booking-ingest':
      return `jail-booking:${payload.externalId}`;
    case 'home-service-signal-ingest':
      return `home-service:${payload.externalId}`;

    // ── Enrichment ───────────────────────────────────────────────────────
    case 'skip-trace':
      // One active skip-trace per contact; priority is honoured at enqueue time
      return `skip-trace:${payload.contactId}`;
    case 'phone-validation':
      return `phone-val:${payload.contactId}:${payload.phone}`;
    case 'address-validation':
      return `addr-val:${payload.contactId}`;
    case 'attorney-scrape':
      return `atty-scrape:${payload.county}:${payload.practiceArea || 'all'}`;

    // ── Scoring ──────────────────────────────────────────────────────────
    case 'lead-score':
      return `lead-score:${payload.contactId}`;
    case 'case-score':
      return `case-score:${payload.incidentId}`;

    // ── CRM ──────────────────────────────────────────────────────────────
    case 'contact-upsert':
      return `contact-upsert:${payload.contactId}:${payload.fingerprintHash}`;
    case 'export-eligibility-eval':
      return `export-eval:${payload.contactId}`;
    case 'territory-assignment':
      return `territory:${payload.contactId}`;

    // ── Embeddings ───────────────────────────────────────────────────────
    case 'contact-embed':
      // Content hash prevents re-embedding when nothing changed
      return `embed:contact:${payload.contactId}:${payload.contentHash}`;
    case 'incident-embed':
      return `embed:incident:${payload.incidentId}:${payload.contentHash}`;
    case 'legal-signal-embed':
      return `embed:legal-signal:${payload.signalId}:${payload.contentHash}`;

    // ── OCR ──────────────────────────────────────────────────────────────
    case 'document-ingest':
      return `doc-ingest:${payload.acquisitionJobId}`;
    case 'ocr-extract':
      return `ocr:${payload.acquisitionJobId}:${payload.provider}`;
    case 'entity-extract':
      return `entity-extract:${payload.acquisitionJobId}`;

    // ── Maintenance ──────────────────────────────────────────────────────
    case 'dead-letter-sweep':
      // Only one sweep at a time; BullMQ repeat jobs get unique IDs by design
      // but explicit dedup prevents manual double-triggers
      return `dlq-sweep:singleton`;
    case 'embedding-daily-cap-reset':
      return `embed-cap-reset:singleton`;

    // ── Fallback ─────────────────────────────────────────────────────────
    default:
      // For legacy job types without a registered key, hash the entire payload.
      // This provides reasonable dedup without crashing on unknown types.
      const hashInput = `${jobType}:${JSON.stringify(payload)}`;
      return `generic:${hashInput.length > 200 ? hashInput.slice(0, 200) : hashInput}`;
  }
}
```

---

## 8. Dead Letter Queue Architecture

### 8.1 Error Classification

All job failures are classified before DLQ entry. The classification drives replay eligibility.

```typescript
// server/queues/errorClassifier.ts
export type DlqErrorClass =
  | 'PROVIDER_ERROR'   // BatchData, Apify, ScrapingBee, DocAI temporary failures
  | 'RATE_LIMIT'       // Provider rate limit exceeded — delayed replay
  | 'AUTH_ERROR'       // Expired API key or token — no auto-replay, alert operator
  | 'VALIDATION_ERROR' // Bad payload, missing required fields — no replay
  | 'DB_ERROR'         // Neon connection / query failure — retry eligible
  | 'TIMEOUT'          // Job exceeded lockDuration — retry eligible
  | 'UNKNOWN';         // Classify manually via operator UI

export interface DlqRecord {
  id: string;
  jobId: string;
  queueName: string;
  jobType: string;
  payload: Record<string, any>;
  errorClass: DlqErrorClass;
  errorMessage: string;
  failedAt: Date;
  attemptsMade: number;
  replayEligible: boolean;
  replayedAt?: Date;
  replayJobId?: string;
}

const REPLAY_ELIGIBLE: DlqErrorClass[] = ['PROVIDER_ERROR', 'DB_ERROR', 'TIMEOUT'];
const REPLAY_DELAY_MS: Partial<Record<DlqErrorClass, number>> = {
  'RATE_LIMIT': 3_600_000,   // 1 hour
};

export function classifyError(err: Error): DlqErrorClass {
  const msg = err.message.toLowerCase();
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')) {
    return 'RATE_LIMIT';
  }
  if (msg.includes('unauthorized') || msg.includes('401') || msg.includes('403') || msg.includes('api key')) {
    return 'AUTH_ERROR';
  }
  if (msg.includes('validation') || msg.includes('missing required') || msg.includes('invalid payload')) {
    return 'VALIDATION_ERROR';
  }
  if (msg.includes('connection') || msg.includes('neon') || msg.includes('postgres') || msg.includes('pg')) {
    return 'DB_ERROR';
  }
  if (msg.includes('timeout') || msg.includes('lock expired')) {
    return 'TIMEOUT';
  }
  if (msg.includes('apify') || msg.includes('batchdata') || msg.includes('scrapingbee') || msg.includes('docai') || msg.includes('textract')) {
    return 'PROVIDER_ERROR';
  }
  return 'UNKNOWN';
}

export function isReplayEligible(errorClass: DlqErrorClass): boolean {
  return REPLAY_ELIGIBLE.includes(errorClass);
}

export function getReplayDelayMs(errorClass: DlqErrorClass): number {
  return REPLAY_DELAY_MS[errorClass] ?? 0;
}
```

### 8.2 DLQ Sweeper

The `dead-letter-sweep` maintenance job runs every 15 minutes. It reads all `failed` jobs from every BullMQ queue and writes them to the `dead_letter_jobs` Postgres table for operator inspection.

```typescript
// server/queues/dlqSweeper.ts — called by MaintenanceWorker
import { getAllQueues } from './queueFactory';
import { classifyError, isReplayEligible } from './errorClassifier';
import { db } from '../db';
import { deadLetterJobs } from '@shared/schema';
import { logSystemEvent } from '../systemLogger';

export async function sweepDeadLetters(): Promise<{ swept: number; errors: number }> {
  const queues = getAllQueues();
  let swept = 0;
  let errors = 0;

  for (const queue of queues) {
    const failedJobs = await queue.getFailed(0, 99);
    for (const job of failedJobs) {
      try {
        const lastErr = job.failedReason ? new Error(job.failedReason) : new Error('unknown');
        const errorClass = classifyError(lastErr);

        await db.insert(deadLetterJobs).values({
          jobId: job.id!,
          queueName: queue.name,
          jobType: job.name,
          payload: job.data,
          errorClass,
          errorMessage: job.failedReason ?? 'unknown',
          failedAt: new Date(job.finishedOn ?? Date.now()),
          attemptsMade: job.attemptsMade,
          replayEligible: isReplayEligible(errorClass),
        }).onConflictDoNothing();

        swept++;
      } catch (err: any) {
        errors++;
        logSystemEvent('error', 'dlq-sweeper', `Failed to record DLQ entry for job ${job.id}`, { error: err.message });
      }
    }
  }

  logSystemEvent('info', 'dlq-sweeper', `DLQ sweep complete`, { swept, errors });
  return { swept, errors };
}
```

### 8.3 DLQ Replay Endpoint

```typescript
// POST /internal/queue/dlq/:jobId/replay
// Requires: internalOnly middleware (Stage 2 auth)
router.post('/queue/dlq/:jobId/replay', internalOnly, async (req, res) => {
  const { jobId } = req.params;
  const record = await db.query.deadLetterJobs.findFirst({
    where: eq(deadLetterJobs.jobId, jobId),
  });
  if (!record) return res.status(404).json({ error: 'DLQ record not found' });
  if (!record.replayEligible) {
    return res.status(422).json({ error: 'Job not eligible for replay', errorClass: record.errorClass });
  }

  const newJobId = await durableJobQueue.enqueue(record.jobType, record.payload, 3);
  await db.update(deadLetterJobs)
    .set({ replayedAt: new Date(), replayJobId: newJobId })
    .where(eq(deadLetterJobs.jobId, jobId));

  res.json({ replayed: true, newJobId });
});
```

---

## 9. Legacy Backward-Compatibility Adapter

All existing callers of `jobQueue.enqueue()`, `jobQueue.getStats()`, and `jobQueue.getHistory()` continue to work unchanged on day one. The adapter routes to BullMQ when Redis is available and falls back to the in-memory queue when it is not.

```typescript
// server/queues/legacyAdapter.ts
import { getQueue } from './queueFactory';
import { getDedupeKey } from './dedupeKeys';
import { JOB_QUEUE_MAP } from './jobTypes';
import { isRedisAvailable } from '../redis';
import { jobQueue as legacyQueue } from '../jobQueue';
import { getAllQueues } from './queueFactory';
import type { ApexJobType } from './jobTypes';

function resolveQueueName(jobType: string): string {
  return JOB_QUEUE_MAP[jobType as ApexJobType] ?? 'apex-crm';
}

export const durableJobQueue = {
  /**
   * Enqueue a job. Returns the BullMQ job ID (string) or the legacy UUID.
   * Callers must not depend on the ID format — treat it as opaque.
   */
  async enqueue(
    jobType: string,
    payload: Record<string, any>,
    maxAttempts = 3,
  ): Promise<string> {
    if (!isRedisAvailable()) {
      // Graceful degradation — in-memory queue as before
      return legacyQueue.enqueue(jobType, payload, maxAttempts);
    }

    const queueName = resolveQueueName(jobType);
    const queue = getQueue(queueName);
    const jobId = getDedupeKey(jobType as ApexJobType, payload);

    const job = await queue.add(jobType, { ...payload, _traceId: payload.traceId }, {
      attempts: maxAttempts,
      jobId,
    });

    return job.id!;
  },

  /**
   * Aggregate stats across all BullMQ queues, matching the legacy getStats() shape
   * so operator/telemetry.ts and routes/analytics.ts continue to work.
   */
  async getStats(): Promise<{
    queued: number;
    running: number;
    completed: number;
    failed: number;
    registeredHandlers: string[];
  }> {
    if (!isRedisAvailable()) {
      return legacyQueue.getStats();
    }

    const queues = getAllQueues();
    const counts = await Promise.all(queues.map(q => q.getJobCounts(
      'wait', 'active', 'completed', 'failed', 'delayed',
    )));

    return counts.reduce(
      (acc, c) => ({
        queued:   acc.queued   + (c.wait ?? 0) + (c.delayed ?? 0),
        running:  acc.running  + (c.active ?? 0),
        completed: acc.completed + (c.completed ?? 0),
        failed:   acc.failed   + (c.failed ?? 0),
        registeredHandlers: acc.registeredHandlers,
      }),
      { queued: 0, running: 0, completed: 0, failed: 0, registeredHandlers: Object.keys(JOB_QUEUE_MAP) },
    );
  },

  getHistory: legacyQueue.getHistory.bind(legacyQueue),
  getJob:     legacyQueue.getJob.bind(legacyQueue),
};
```

**Migration path for existing callers:**
1. `server/operator/telemetry.ts` — replace `jobQueue.getStats()` with `await durableJobQueue.getStats()`
2. `server/operator/diagnostics.ts` — same
3. `server/routes/analytics.ts` — same for both getStats and getHistory
4. `server/metaCampaignSync.ts` — replace `jobQueue.registerHandler` + `jobQueue.enqueue` with BullMQ worker + `durableJobQueue.enqueue`

---

## 10. Scheduled Jobs (BullMQ Repeat Jobs)

All `setInterval()` scheduler calls in the current codebase are replaced by BullMQ repeat jobs. This means schedules survive container restarts and are not duplicated across hypothetical future horizontal scale.

```typescript
// server/queues/scheduledJobs.ts
import { getQueue } from './queueFactory';
import { logSystemEvent } from '../systemLogger';

export interface ScheduledJobDef {
  name: string;
  queueName: string;
  cron: string;
  payload?: Record<string, any>;
  tz?: string;
}

export const SCHEDULED_JOBS: ScheduledJobDef[] = [
  // ── Intake sweeps ──────────────────────────────────────────────────────
  {
    name: 'crash-ingest-sweep',
    queueName: 'apex-intake',
    cron: '0 */6 * * *',               // Every 6 hours
    payload: { triggeredBy: 'scheduler' },
  },
  {
    name: 'court-filing-sweep',
    queueName: 'apex-intake',
    cron: '30 */8 * * *',              // Every 8 hours, offset by 30m
    payload: { triggeredBy: 'scheduler' },
  },
  {
    name: 'hillsborough-records',
    queueName: 'apex-intake',
    cron: '0 2 * * *',                 // 2 AM daily (off-peak Neon)
    payload: { triggeredBy: 'scheduler' },
    tz: 'America/New_York',
  },
  {
    name: 'home-service-signal-sweep',
    queueName: 'apex-intake',
    cron: '15 */4 * * *',              // Every 4 hours
    payload: { triggeredBy: 'scheduler' },
  },
  {
    name: 'jail-booking-sweep',
    queueName: 'apex-intake',
    cron: '45 */6 * * *',
    payload: { triggeredBy: 'scheduler' },
  },
  // ── Maintenance ────────────────────────────────────────────────────────
  {
    name: 'retry-event-processor',
    queueName: 'apex-maintenance',
    cron: '*/15 * * * *',              // Replaces eventRetryProcessor setInterval
  },
  {
    name: 'dead-letter-sweep',
    queueName: 'apex-maintenance',
    cron: '*/15 * * * *',
  },
  {
    name: 'queue-health-snapshot',
    queueName: 'apex-maintenance',
    cron: '*/5 * * * *',
  },
  {
    name: 'embedding-daily-cap-reset',
    queueName: 'apex-maintenance',
    cron: '0 0 * * *',                 // Midnight UTC
    tz: 'UTC',
  },
  {
    name: 'db-archive-sweep',
    queueName: 'apex-maintenance',
    cron: '0 3 * * *',                 // 3 AM — lowest Neon load
    payload: { olderThanDays: 90, tables: ['event_logs', 'timeline_events'] },
    tz: 'America/New_York',
  },
  // ── Analytics ──────────────────────────────────────────────────────────
  {
    name: 'territory-heatmap-update',
    queueName: 'apex-analytics',
    cron: '0 */4 * * *',
  },
  {
    name: 'cohort-rebuild',
    queueName: 'apex-analytics',
    cron: '0 4 * * *',                 // Daily at 4 AM
    tz: 'America/New_York',
  },
  // ── Meta campaign sync — replaces metaCampaignSync setInterval ─────────
  {
    name: 'meta-campaign-sync',
    queueName: 'apex-crm',
    cron: '0 */6 * * *',
    payload: { triggeredBy: 'scheduler', scheduledAt: '' },  // scheduledAt filled at add time
  },
];

export async function registerScheduledJobs(): Promise<void> {
  for (const def of SCHEDULED_JOBS) {
    const queue = getQueue(def.queueName);
    await queue.add(
      def.name,
      def.payload ?? {},
      {
        repeat: { pattern: def.cron, tz: def.tz },
        jobId: `repeat:${def.name}`,
      },
    );
    logSystemEvent('info', 'scheduler', `Registered: ${def.name} [${def.cron}]`, { queue: def.queueName });
  }
}
```

---

## 11. Queue Health Dashboard Endpoint

```typescript
// GET /internal/health/queues
// Requires: internalOnly middleware
// Returns real-time queue depth, worker status, DLQ counts

router.get('/health/queues', internalOnly, async (_req, res) => {
  if (!isRedisAvailable()) {
    return res.json({ mode: 'legacy', message: 'Redis unavailable — in-memory queue active' });
  }

  const queues = getAllQueues();
  const snapshots = await Promise.all(
    queues.map(async (q) => {
      const counts = await q.getJobCounts('wait', 'active', 'completed', 'failed', 'delayed', 'paused');
      const isPaused = await q.isPaused();
      return {
        name: q.name,
        counts,
        isPaused,
      };
    }),
  );

  const dlqCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(deadLetterJobs)
    .where(isNull(deadLetterJobs.replayedAt));

  res.json({
    mode: 'bullmq',
    redis: { status: 'ready' },
    queues: snapshots,
    dlq: { unreplayedCount: Number(dlqCount[0]?.count ?? 0) },
    generatedAt: new Date().toISOString(),
  });
});
```

---

## 12. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `UPSTASH_REDIS_URL` | Yes (Stage 4A) | — | Upstash Redis TLS URL (rediss://) |
| `REDIS_URL` | Alt | — | Standard ioredis URL (fallback if UPSTASH not set) |
| `WORKER_CONCURRENCY_HIGH` | No | `3` | Concurrency for routing / notifications |
| `WORKER_CONCURRENCY_MEDIUM` | No | `5` | Concurrency for enrichment / scoring / CRM |
| `WORKER_CONCURRENCY_LOW` | No | `10` | Concurrency for embeddings / semantic |
| `WORKER_CONCURRENCY_BACKGROUND` | No | `2` | Concurrency for maintenance / analytics |
| `OCR_WORKER_ENABLED` | No | `false` | Activates OcrWorker (Stage 4B gate) |
| `SEMANTIC_WORKER_ENABLED` | No | `false` | Activates SemanticWorker (post-Stage-3 observation) |
| `DISABLE_BACKGROUND_WORKERS` | No | `false` | Existing flag — prevents all BullMQ workers from starting |
| `BULLMQ_BOARD_ENABLED` | No | `false` | Mounts @bull-board at /internal/queues/board |

---

## 13. Rollout Sequence

Stage 4A is a **dark launch**: BullMQ is wired up and running, but existing ingestion pipelines continue using the in-memory `jobQueue` until each domain is explicitly migrated.

| Step | What ships | Risk |
|---|---|---|
| 4A-1 | `redis.ts`, `queueFactory.ts`, `jobTypes.ts`, `dedupeKeys.ts` | None — new files only |
| 4A-2 | `legacyAdapter.ts` — `durableJobQueue` export | Low — adapter falls back to legacy when Redis is absent |
| 4A-3 | `scheduledJobs.ts` registered at startup | Low — BullMQ drops repeat jobs if queue already has them |
| 4A-4 | `MaintenanceWorker` activated — DLQ sweep, health snapshot | Low — read-only operations |
| 4A-5 | `metaCampaignSync` migrated from `jobQueue` to `durableJobQueue` | Medium — first real worker migration |
| 4A-6 | `IngestionWorker` activated — crash-ingest, arrest-ingest | Medium — replaces crashIngestPipeline setInterval |
| 4A-7 | Remaining workers activated per domain | Per-domain risk |
