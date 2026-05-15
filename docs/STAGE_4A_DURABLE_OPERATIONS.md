# Stage 4A — Durable Operations: Master Plan

**Status:** PLANNING  
**Authored:** 2026-05-15  
**Depends on:** Stage 1 (auth), Stage 2 (roles), Stage 3 (pgvector + embedding store)  
**Unlocks:** Stage 4B (OCR pipeline), Stage 5 (Inngest step-functions)

---

## 1. Executive Summary

### Current State: Fragile In-Memory Prototype

Apex's operational layer was built correctly for speed-of-iteration. It works well under a single Railway process with no restarts. The fragility surfaces the moment Railway redeploys — which happens on every push, every environment variable change, and every crash.

The critical gaps are:

- **`server/jobQueue.ts`** — a plain JavaScript array (`this.queue: Job[] = []`). Every queued job is destroyed on restart. There is no persistence, no acknowledgment, and no replay.
- **`server/eventBus.ts`** — subscribers are stored in `new Map<string, Subscription[]>()`. The dedup window (`recentEventKeys`) is a `Map<string, number>()`. Both are process-local. A restart silently drops in-flight events.
- **`server/rateLimiter.ts`** — six `express-rate-limit` instances with zero Redis store configuration. Each restarts its counters at process start. Under horizontal scaling (Railway duplicate), each instance has independent counters — a bad actor gets 2× the limit for free.
- **`server/systemLogger.ts`** — writes exclusively to Neon via `db.insert(systemLogs)`. If the DB connection pool is saturated or Neon has a hiccup, the logging path itself fails silently (caught internally with `console.error`). No external drain exists.
- **No Sentry, no Axiom, no PagerDuty.** Worker crashes surface only in Railway's ephemeral log stream. There is no alert path.
- **30+ `setInterval` calls** scattered across pipeline files with no centralized scheduler. Each runs on its own cadence with no coordination, no backpressure, no observability.

### Target State: Durable Event-Driven Infrastructure

After Stage 4A:

- All background jobs survive Railway restarts (persisted in Upstash Redis via BullMQ)
- Failed jobs accumulate in a Dead Letter Queue with full payload, stack trace, and replay capability
- Session persistence uses `connect-pg-simple` (already in `replitAuth.ts`, already working)
- Rate limiters share state across restarts and across future instances via Redis
- `systemLogger.ts` emits to console (always) + Neon DB (best-effort) + Axiom (drain)
- Sentry captures uncaught exceptions and worker failures with full context
- Every ingestion pipeline continues to work without modification

### What Changes vs. What Stays the Same

| Component | Change | Stays Same |
|-----------|--------|------------|
| `server/jobQueue.ts` | BullMQ facade (same `enqueue`/`registerHandler` API) | Handler registration pattern |
| `server/eventBus.ts` | Subscribers re-register at boot; Redis pub/sub for cross-process | All `EVENT_TYPES` constants |
| `server/rateLimiter.ts` | Add `RedisStore` (falls back to memory) | All six limiter exports, same config |
| `server/systemLogger.ts` | Add console + Axiom drain alongside DB write | `logSystemEvent` function signature |
| All ingestion pipelines | None — they call `jobQueue.enqueue()` and `eventBus.publish()` | Entire pipeline logic |
| Neon schema | Additive only (2 new tables) | All existing tables untouched |
| Railway service structure | Single process, same port | No new services required |
| Frontend | None | Entire client codebase |

### Timeline

```
Week 1: Redis provisioning + BullMQ installation + queue facade
Week 2: Worker isolation + DLQ setup + observability (Sentry + Axiom)
Week 3: Rate limiter migration + logger hardening
Week 4: Validation gates + load testing + Stage 4B readiness check
```

---

## 2. Critical Risk Assessment

| Risk | Current State | Impact | Resolution |
|------|--------------|--------|------------|
| In-memory job queue | `jobQueue.ts`: `private queue: Job[] = []` | **CRITICAL** — Railway restart destroys all queued work. Embedding jobs, skip-trace retries, OCR batches silently vanish. | BullMQ + Upstash Redis |
| In-memory event bus | `eventBus.ts`: `private subscribers = new Map()`, dedup via `Map<string, number>` | **HIGH** — Active event handlers re-register at boot, but events in-flight at the moment of restart are dropped. The `recentEventKeys` dedup window resets. | Redis pub/sub + BullMQ event fanout for critical paths |
| In-memory session store | `memorystore` is in `package.json` but `replitAuth.ts` already uses `connect-pg-simple` (Neon sessions table) | **MEDIUM** — Sessions are actually Neon-backed. Risk is Neon pool saturation during session read. | Confirm `sessions` table exists; add TTL cleanup job |
| Logging tied to DB | `systemLogger.ts`: only `db.insert(systemLogs)` — DB error is caught and swallowed | **HIGH** — DB failure = blind operation. No external visibility. | Console fallback (always) + Axiom log drain |
| No external error tracking | `console.error` only across all worker files | **HIGH** — No alert on worker failure, crash, or unhandled rejection | Sentry DSN + Railway error hook |
| In-memory rate limiter | `rateLimiter.ts`: six `rateLimit()` instances, no store option set | **MEDIUM** — Resets on restart; under multi-instance would be trivially bypassable | `rate-limit-redis` store backed by Upstash |
| Scattered `setInterval` | 30+ files each scheduling their own intervals; no coordination | **MEDIUM** — No backpressure, overlapping runs possible, no central kill switch | BullMQ repeatable jobs replace interval-based scheduling |
| No distributed locks | Skip trace and embedding batch share no lock primitive | **MEDIUM** — Concurrent duplicate processing possible across future instances | Redis lock module (Redlock pattern) |

---

## 3. What Does NOT Change in Phase 4A

The following are explicitly frozen for Phase 4A. Do not touch them.

### Ingestion Pipelines (all pass-through)

- `server/crashIngestPipeline.ts` — Sentinel crash ingestion
- `server/courtFilingPipeline.ts` — Court filing ingestion
- `server/courtListenerPipeline.ts` — CourtListener API sync
- `server/arrestIngestPipeline.ts` — Arrest record ingestion
- `server/jailBookingPipeline.ts` — Jail booking ingestion
- `server/legalSignalPipeline.ts` — Legal signal ingestion
- `server/homeServiceSignalPipeline.ts` — Home services signals
- `server/apifyAttorneyScraper.ts` — Attorney enrichment

All of these call `jobQueue.enqueue()` or `eventBus.publish()`. Because the Phase 4A queue facade preserves the exact same method signatures, zero changes to pipeline code are required.

### Exports and Routing

- All property route handlers (`server/routes/property.ts`)
- All contact upsert logic (`server/services/contactUpsertService.ts`)
- All storage layer methods (`server/storage.ts`)

### Neon Schema

Phase 4A adds exactly 2 tables (`queue_health_snapshots`, `dead_letter_jobs`). All existing tables are untouched. No column changes. No index changes. All Drizzle migrations remain forward-compatible.

### Railway Service Structure

Single Node.js process on Railway. No new Railway services. No Docker Compose changes. BullMQ workers run inside the same process as Express (acceptable at current volume; Stage 4B introduces worker isolation if needed).

### Frontend

Zero client-side changes. The queue migration is entirely server-internal.

---

## 4. Migration Execution Order

Dependencies are linear. Do not skip steps.

```
Step 1: Upstash Redis
    │
    ▼
Step 2: BullMQ Install + Queue Abstraction
    │
    ▼
Step 3: Replace jobQueue.ts Facade
    │
    ▼
Step 4: Worker Class Isolation
    │
    ▼
Step 5: Dead Letter Queue
    │
    ├──────────────────────────────┐
    ▼                              ▼
Step 6: Observability          Step 7: OCR Queue Foundation
(Sentry + Axiom)
    │
    ▼
Step 8: Embedding Throttle
    │
    ▼
Step 9: Incident/Contact Separation
```

### Step 1 — Upstash Redis Provisioning

**Deliverable:** `UPSTASH_REDIS_URL` in Railway env vars; `redis.ping()` returns `PONG`

```typescript
// server/redis.ts — canonical module, imported by everything else
import { Redis } from "ioredis";

const UPSTASH_URL = process.env.UPSTASH_REDIS_URL;

if (!UPSTASH_URL && process.env.NODE_ENV === "production") {
  console.error("[REDIS] UPSTASH_REDIS_URL not set — durable queue DISABLED");
}

export const redis = UPSTASH_URL
  ? new Redis(UPSTASH_URL, {
      maxRetriesPerRequest: null, // BullMQ requirement
      enableReadyCheck: false,
      tls: { rejectUnauthorized: false },
      lazyConnect: true,
    })
  : null;

export const isRedisAvailable = (): boolean =>
  redis !== null && (redis.status === "ready" || redis.status === "connecting");

// Health check used by Gate 1
export async function pingRedis(): Promise<boolean> {
  try {
    if (!redis) return false;
    const result = await redis.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}
```

**Validation:** `npx ts-node -e "import('./server/redis').then(m => m.pingRedis()).then(console.log)"`

---

### Step 2 — BullMQ Installation + Queue Abstraction Layer

**Install:**
```bash
npm install ioredis bullmq rate-limit-redis @sentry/node @axiomhq/js
```

**Queue abstraction** — wraps BullMQ behind a stable interface that jobQueue callers already use:

```typescript
// server/queues/queueManager.ts
import { Queue, QueueEvents } from "bullmq";
import { redis } from "../redis";

const QUEUE_DEFAULTS = {
  defaultJobOptions: {
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 5_000 },
  },
};

export type QueuePriority = "high" | "medium" | "low" | "background";

const QUEUE_NAMES: Record<QueuePriority, string> = {
  high:       "apex:queue:high",
  medium:     "apex:queue:medium",
  low:        "apex:queue:low",
  background: "apex:queue:background",
};

const queues = new Map<QueuePriority, Queue>();

export function getQueue(priority: QueuePriority = "medium"): Queue | null {
  if (!redis) return null;
  if (!queues.has(priority)) {
    queues.set(
      priority,
      new Queue(QUEUE_NAMES[priority], { connection: redis, ...QUEUE_DEFAULTS })
    );
  }
  return queues.get(priority)!;
}

export function allQueues(): Queue[] {
  return [...queues.values()];
}
```

---

### Step 3 — Replace `jobQueue.ts` with BullMQ Facade

The facade preserves the exact existing API surface: `enqueue()`, `registerHandler()`, `getStats()`, `getHistory()`, `getJob()`. Callers do not change.

```typescript
// server/jobQueue.ts — drop-in BullMQ facade
import crypto from "crypto";
import { Queue, Worker, Job as BullJob, QueueEvents } from "bullmq";
import { redis, isRedisAvailable } from "./redis";
import { getQueue } from "./queues/queueManager";
import * as Sentry from "@sentry/node";

export interface Job {
  id: string;
  type: string;
  payload: Record<string, any>;
  status: "queued" | "running" | "completed" | "failed";
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: any;
}

type JobHandler = (payload: Record<string, any>) => Promise<any>;

// In-memory fallback — identical to original implementation
class InMemoryJobQueue {
  private handlers = new Map<string, JobHandler>();
  private queue: Job[] = [];
  private running = 0;
  private history: Job[] = [];
  private readonly MAX_CONCURRENT = 5;
  private readonly MAX_HISTORY = 1000;

  registerHandler(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
    console.log(`[JOB-QUEUE:MEMORY] Handler registered: ${jobType}`);
  }

  enqueue(jobType: string, payload: Record<string, any>, maxAttempts = 3): string {
    const job: Job = {
      id: crypto.randomUUID(),
      type: jobType,
      payload,
      status: "queued",
      attempts: 0,
      maxAttempts,
      createdAt: new Date().toISOString(),
    };
    this.queue.push(job);
    this.processNext();
    return job.id;
  }

  private async processNext(): Promise<void> {
    if (this.running >= this.MAX_CONCURRENT || this.queue.length === 0) return;
    const job = this.queue.shift();
    if (!job) return;
    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = "failed";
      job.error = `No handler for type: ${job.type}`;
      this.addToHistory(job);
      this.processNext();
      return;
    }
    this.running++;
    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.attempts++;
    try {
      job.result = await handler(job.payload);
      job.status = "completed";
      job.completedAt = new Date().toISOString();
    } catch (err: any) {
      if (job.attempts < job.maxAttempts) {
        job.status = "queued";
        this.queue.push(job);
      } else {
        job.status = "failed";
        job.error = err?.message;
        job.completedAt = new Date().toISOString();
      }
    }
    if (job.status !== "queued") this.addToHistory(job);
    this.running--;
    this.processNext();
  }

  private addToHistory(job: Job): void {
    this.history.push(job);
    if (this.history.length > this.MAX_HISTORY) {
      this.history = this.history.slice(-this.MAX_HISTORY);
    }
  }

  getStats() {
    return {
      queued: this.queue.length,
      running: this.running,
      completed: this.history.filter(j => j.status === "completed").length,
      failed: this.history.filter(j => j.status === "failed").length,
      registeredHandlers: [...this.handlers.keys()],
      backend: "memory" as const,
    };
  }

  getHistory(limit = 50, jobType?: string): Job[] {
    let jobs = this.history;
    if (jobType) jobs = jobs.filter(j => j.type === jobType);
    return jobs.slice(-limit);
  }

  getJob(jobId: string): Job | undefined {
    return this.queue.find(j => j.id === jobId) || this.history.find(j => j.id === jobId);
  }
}

class DurableJobQueue {
  private handlers = new Map<string, JobHandler>();
  private workers: Worker[] = [];

  registerHandler(jobType: string, handler: JobHandler, priority: "high" | "medium" | "low" | "background" = "medium"): void {
    this.handlers.set(jobType, handler);

    const queueName = `apex:queue:${priority}`;
    const worker = new Worker(
      queueName,
      async (bullJob: BullJob) => {
        if (bullJob.name !== jobType) return; // handled by other worker
        return handler(bullJob.data);
      },
      {
        connection: redis!,
        concurrency: parseInt(process.env[`WORKER_CONCURRENCY_${priority.toUpperCase()}`] || "5"),
      }
    );

    worker.on("failed", (job, err) => {
      Sentry.captureException(err, {
        tags: { jobType, queue: queueName },
        extra: { jobId: job?.id, payload: job?.data },
      });
      console.error(`[JOB-QUEUE:DURABLE] Job failed: ${jobType} — ${err.message}`);
    });

    this.workers.push(worker);
    console.log(`[JOB-QUEUE:DURABLE] Handler registered: ${jobType} on ${queueName}`);
  }

  async enqueue(
    jobType: string,
    payload: Record<string, any>,
    maxAttempts = 3,
    priority: "high" | "medium" | "low" | "background" = "medium"
  ): Promise<string> {
    const queue = getQueue(priority);
    if (!queue) throw new Error("Redis unavailable for durable queue");

    const job = await queue.add(jobType, payload, {
      attempts: maxAttempts,
      jobId: crypto.randomUUID(),
    });

    return job.id!;
  }

  getStats() {
    return {
      queued: -1, // async — use /api/admin/queue-health
      running: -1,
      completed: -1,
      failed: -1,
      registeredHandlers: [...this.handlers.keys()],
      backend: "bullmq" as const,
    };
  }

  getHistory(_limit = 50, _jobType?: string): Job[] {
    return []; // BullMQ history is queried async via QueueEvents
  }

  getJob(_jobId: string): Job | undefined {
    return undefined; // async — use queue.getJob(id)
  }
}

// Feature flag: DURABLE_QUEUE_ENABLED=true → BullMQ, else in-memory fallback
const useDurable = process.env.DURABLE_QUEUE_ENABLED === "true" && isRedisAvailable();

class JobQueueFacade {
  private impl: DurableJobQueue | InMemoryJobQueue;

  constructor() {
    this.impl = useDurable ? new DurableJobQueue() : new InMemoryJobQueue();
    console.log(`[JOB-QUEUE] Backend: ${useDurable ? "BullMQ (Upstash Redis)" : "in-memory (fallback)"}`);
  }

  registerHandler(jobType: string, handler: JobHandler): void {
    this.impl.registerHandler(jobType, handler);
  }

  enqueue(jobType: string, payload: Record<string, any>, maxAttempts = 3): string {
    if (this.impl instanceof DurableJobQueue) {
      // fire-and-forget, return optimistic ID
      const id = crypto.randomUUID();
      this.impl.enqueue(jobType, payload, maxAttempts).catch(err => {
        Sentry.captureException(err, { tags: { jobType, stage: "enqueue" } });
        console.error(`[JOB-QUEUE] Enqueue failed for ${jobType}:`, err.message);
      });
      return id;
    }
    return (this.impl as InMemoryJobQueue).enqueue(jobType, payload, maxAttempts);
  }

  getStats() { return this.impl.getStats(); }
  getHistory(limit?: number, jobType?: string) { return this.impl.getHistory(limit, jobType); }
  getJob(jobId: string) { return this.impl.getJob(jobId); }
}

export const jobQueue = new JobQueueFacade();
```

---

### Step 4 — Worker Class Isolation

Separate worker classes per domain prevent one domain's failures from blocking another.

```typescript
// server/workers/embeddingWorker.ts
import { Worker } from "bullmq";
import { redis } from "../redis";
import * as Sentry from "@sentry/node";

export function startEmbeddingWorker(): Worker {
  const worker = new Worker(
    "apex:queue:background",
    async (job) => {
      if (job.name !== "generate_embedding") return;
      const { entityType, entityId, text } = job.data;
      // embedding logic here
    },
    {
      connection: redis!,
      concurrency: parseInt(process.env.WORKER_CONCURRENCY_BACKGROUND || "2"),
      limiter: { max: 10, duration: 1000 }, // 10 embeddings/sec max
    }
  );

  worker.on("failed", (job, err) => {
    Sentry.captureException(err, {
      tags: { worker: "embedding", jobName: job?.name },
    });
  });

  return worker;
}
```

Domain workers to create:
- `server/workers/embeddingWorker.ts` — OpenAI embedding generation
- `server/workers/ocrWorker.ts` — Document OCR via R2
- `server/workers/skipTraceWorker.ts` — Skip trace enrichment
- `server/workers/contactEnrichWorker.ts` — Contact enrichment
- `server/workers/incidentWorker.ts` — Incident processing
- `server/workers/notificationWorker.ts` — Email/SMS dispatch

---

### Step 5 — Dead Letter Queue Setup and Error Classification

BullMQ automatically moves jobs that exhaust `attempts` to the failed set. Apex needs a secondary DLQ that writes to Neon for permanent record and operator replay.

```typescript
// server/workers/dlqProcessor.ts
import { QueueEvents } from "bullmq";
import { redis } from "../redis";
import { db } from "../db";
import { deadLetterJobs } from "@shared/schema";
import * as Sentry from "@sentry/node";

const QUEUE_NAMES = ["apex:queue:high", "apex:queue:medium", "apex:queue:low", "apex:queue:background"];

export function startDLQProcessor(): void {
  for (const queueName of QUEUE_NAMES) {
    const queueEvents = new QueueEvents(queueName, { connection: redis! });

    queueEvents.on("failed", async ({ jobId, failedReason }) => {
      try {
        // Fetch job details
        const { Queue } = await import("bullmq");
        const q = new Queue(queueName, { connection: redis! });
        const job = await q.getJob(jobId);
        if (!job) return;

        const attemptsMade = job.attemptsMade;
        const maxAttempts = job.opts.attempts ?? 3;

        if (attemptsMade < maxAttempts) return; // not yet exhausted

        await db.insert(deadLetterJobs).values({
          jobId,
          queueName,
          jobType: job.name,
          payload: job.data,
          errorMessage: failedReason,
          errorStack: job.stacktrace?.join("\n"),
          errorClass: failedReason?.split(":")[0] || "UnknownError",
          attemptCount: attemptsMade,
          firstAttemptedAt: new Date(job.processedOn || Date.now()),
          lastAttemptedAt: new Date(),
          movedToDlqAt: new Date(),
          traceId: job.data?.traceId,
          accountId: job.data?.accountId || null,
          subAccountId: job.data?.subAccountId || null,
          contactId: job.data?.contactId || null,
          incidentId: job.data?.incidentId || null,
        }).onConflictDoNothing();

        Sentry.captureMessage(`DLQ: ${job.name} exhausted after ${attemptsMade} attempts`, {
          level: "error",
          tags: { queue: queueName, jobType: job.name },
          extra: { jobId, payload: job.data, error: failedReason },
        });

        console.error(`[DLQ] Job ${jobId} (${job.name}) moved to dead letter — ${failedReason}`);
      } catch (err: any) {
        console.error("[DLQ] Failed to write DLQ entry:", err.message);
      }
    });
  }
}
```

**Error classification for retry policy:**

| Error Class | Retry Policy | Notes |
|-------------|-------------|-------|
| `NetworkError` | Exponential backoff, 5 attempts | Transient — always retry |
| `RateLimitError` | Fixed 60s delay, 3 attempts | Wait for window reset |
| `ValidationError` | No retry (DLQ immediately) | Bad data won't self-heal |
| `AuthError` | No retry | Credential issue, needs human |
| `TimeoutError` | Exponential backoff, 3 attempts | Transient |
| `UnknownError` | Default policy, 3 attempts | Safety net |

---

### Step 6 — Observability Integration

#### Sentry

```typescript
// server/observability/sentry.ts
import * as Sentry from "@sentry/node";

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.warn("[SENTRY] SENTRY_DSN not set — error tracking disabled");
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1,
    integrations: [
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
    ],
    beforeSend(event) {
      // Strip PII from payloads
      if (event.extra?.payload) {
        delete event.extra.payload.ssn;
        delete event.extra.payload.password;
      }
      return event;
    },
  });

  console.log("[SENTRY] Initialized");
}
```

Call `initSentry()` at the top of `server/index.ts` before any other middleware.

#### Axiom Log Drain + Hardened systemLogger

```typescript
// server/systemLogger.ts — hardened replacement
import { db } from "./db";
import { systemLogs } from "@shared/schema";
import { desc, eq, and, gte } from "drizzle-orm";

export type LogSeverity = "debug" | "info" | "warn" | "error" | "critical";

// Always write to console — never loses a log
function writeToConsole(severity: LogSeverity, module: string, message: string, metadata?: Record<string, any>): void {
  const entry = JSON.stringify({ ts: new Date().toISOString(), severity, module, message, ...metadata });
  if (severity === "error" || severity === "critical") {
    process.stderr.write(entry + "\n");
  } else {
    process.stdout.write(entry + "\n");
  }
}

// Axiom drain — fire and forget, never blocks the caller
async function writeToAxiom(severity: LogSeverity, module: string, message: string, metadata?: Record<string, any>): Promise<void> {
  const apiKey = process.env.AXIOM_API_KEY;
  const dataset = process.env.AXIOM_DATASET;
  if (!apiKey || !dataset) return;

  try {
    await fetch(`https://api.axiom.co/v1/datasets/${dataset}/ingest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ _time: new Date().toISOString(), severity, module, message, ...metadata }]),
    });
  } catch {
    // Axiom failure must never propagate — swallow silently
  }
}

export async function logSystemEvent(
  severity: LogSeverity,
  module: string,
  message: string,
  metadata?: Record<string, any>
): Promise<void> {
  // Layer 1: console — synchronous, never fails
  writeToConsole(severity, module, message, metadata);

  // Layer 2: Axiom drain — async, swallowed on failure
  writeToAxiom(severity, module, message, metadata).catch(() => undefined);

  // Layer 3: Neon DB — best-effort, original behavior preserved
  try {
    await db.insert(systemLogs).values({ severity, module, message, metadata: metadata || null });
  } catch {
    // DB failure is tolerable — console + Axiom already captured it
  }
}

export async function logSystemError(module: string, message: string, metadata?: Record<string, any>): Promise<void> {
  return logSystemEvent("error", module, message, metadata);
}

export async function getSystemLogs(options?: {
  severity?: string;
  module?: string;
  limit?: number;
  offset?: number;
  since?: Date;
}) {
  const conditions = [];
  if (options?.severity) conditions.push(eq(systemLogs.severity, options.severity));
  if (options?.module) conditions.push(eq(systemLogs.module, options.module));
  if (options?.since) conditions.push(gte(systemLogs.timestamp, options.since));

  return db
    .select()
    .from(systemLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(systemLogs.timestamp))
    .limit(options?.limit || 100)
    .offset(options?.offset || 0);
}
```

---

### Step 7 — OCR Queue Orchestration Foundation

BullMQ flow for document → OCR → embed → store:

```typescript
// server/workers/ocrWorker.ts
import { Worker, FlowProducer } from "bullmq";
import { redis } from "../redis";

export const ocrFlow = new FlowProducer({ connection: redis! });

// Enqueue a document for full OCR + embedding pipeline
export async function enqueueDocumentPipeline(params: {
  documentId: string;
  r2Key: string;
  accountId: number;
  traceId: string;
}): Promise<void> {
  await ocrFlow.add({
    name: "ocr_extract",
    queueName: "apex:queue:medium",
    data: params,
    children: [
      {
        name: "embed_document",
        queueName: "apex:queue:background",
        data: params,
      },
    ],
  });
}
```

---

### Step 8 — Semantic Embedding Throttling

OpenAI rate limits embedding calls. BullMQ's built-in rate limiter prevents 429s:

```typescript
// server/workers/embeddingWorker.ts — with throttle
const worker = new Worker(
  "apex:queue:background",
  async (job) => { /* embedding logic */ },
  {
    connection: redis!,
    concurrency: 2,
    limiter: {
      max: 50,         // 50 embedding jobs
      duration: 60_000, // per 60 seconds
    },
  }
);
```

---

### Step 9 — Incident/Contact Foundation Separation

Incident jobs and contact enrichment jobs compete for the same worker pool today. Phase 4A separates them into dedicated queues:

```
apex:queue:high       → incident alerts, sentinel events
apex:queue:medium     → contact enrichment, court filing ingestion
apex:queue:low        → skip trace retries, outbound email
apex:queue:background → embedding generation, OCR, analytics rollups
```

Each queue gets its own worker concurrency setting via env vars.

---

## 5. Rollback Protocol

Phase 4A is designed to be zero-risk rollback. No schema migrations are destructive. The feature flag is the escape hatch.

### Feature Flag

```bash
# In Railway environment variables:
DURABLE_QUEUE_ENABLED=true   # Phase 4A active
DURABLE_QUEUE_ENABLED=false  # Instant fallback to in-memory
```

The `JobQueueFacade` constructor reads this flag at boot. Setting it to `false` and deploying returns the system to the original in-memory `jobQueue.ts` behavior within seconds.

### Per-Queue Circuit Breaker

```typescript
// server/queues/circuitBreaker.ts
import { isRedisAvailable } from "../redis";

let failureCount = 0;
const FAILURE_THRESHOLD = 5;
const RECOVERY_WINDOW_MS = 30_000;
let lastFailureAt = 0;

export function recordQueueFailure(): void {
  failureCount++;
  lastFailureAt = Date.now();
}

export function isQueueHealthy(): boolean {
  if (Date.now() - lastFailureAt > RECOVERY_WINDOW_MS) {
    failureCount = 0;
  }
  return isRedisAvailable() && failureCount < FAILURE_THRESHOLD;
}
```

### Rollback Decision Tree

```
Redis connection fails at boot
    → DURABLE_QUEUE_ENABLED check bypassed
    → InMemoryJobQueue activated automatically
    → console.error("[JOB-QUEUE] Redis unavailable — falling back to in-memory")
    → Sentry alert fires (if DSN is set)

Redis drops mid-operation
    → circuitBreaker.recordQueueFailure()
    → After 5 failures → isQueueHealthy() = false
    → New enqueues route to in-memory fallback
    → Operator can set DURABLE_QUEUE_ENABLED=false + redeploy for full rollback

Schema additions (queue_health_snapshots, dead_letter_jobs)
    → Additive only — removing them requires a migration but causes zero downtime
    → DROP TABLE IF EXISTS dead_letter_jobs CASCADE; — safe at any time
```

---

## 6. Validation Gates

All 8 gates must pass before Stage 4B begins.

### Gate 1 — Redis Connection Health

```bash
# Manual check
curl https://your-railway-app.railway.app/api/admin/health | jq .redis
# Expected: { "connected": true, "latencyMs": <50 }
```

**Automated:** `/api/admin/health` endpoint pings Redis on every request to `/api/admin/*`.

---

### Gate 2 — BullMQ Round-Trip < 50ms

```typescript
// test/gates/gate2.ts
const start = Date.now();
const queue = getQueue("medium")!;
await queue.add("gate_test", { test: true });
const job = await queue.getJobs(["waiting"], 0, 0);
const latency = Date.now() - start;
console.assert(latency < 50, `BullMQ round-trip ${latency}ms exceeds 50ms threshold`);
```

---

### Gate 3 — Job Survives Railway Restart

Manual test procedure:
1. Enqueue a job via `POST /api/admin/test/enqueue` with `{ "type": "gate3_test", "delay": 120000 }` (2-minute delay)
2. Trigger Railway redeploy
3. After redeploy, check `GET /api/admin/queues/apex:queue:medium/delayed` — job must still exist
4. Wait for job to execute and check DLQ is empty

---

### Gate 4 — DLQ Populated Within 60s of Exhaustion

```typescript
// Enqueue a deliberately failing job
await queue.add("gate4_fail", {}, { attempts: 1, backoff: { type: "fixed", delay: 0 } });
// Wait 60 seconds
// Query: SELECT COUNT(*) FROM dead_letter_jobs WHERE job_type = 'gate4_fail';
// Expected: 1
```

---

### Gate 5 — systemLogger Falls Back on DB Failure

```typescript
// Temporarily set DATABASE_URL to invalid connection string
// Call logSystemEvent("error", "GATE5", "test fallback")
// Expected:
//   - JSON line appears in Railway stdout ✅
//   - Axiom receives event (check dashboard) ✅
//   - No unhandled exception thrown ✅
```

---

### Gate 6 — Sentry Test Error in Dashboard < 30s

```typescript
// POST /api/admin/test/sentry
// Handler:
import * as Sentry from "@sentry/node";
Sentry.captureException(new Error("Gate 6: Sentry test — ignore"));
// Expected: error appears in Sentry dashboard within 30 seconds
```

---

### Gate 7 — Rate Limit State Persists Across Restart

Manual test:
1. Fire 90 requests to any rate-limited endpoint (limit: 100/min)
2. Redeploy (Railway)
3. Fire 15 more requests — they should still be throttled (remaining: 10)
4. Without Redis store: counter would reset to 0 after restart, allowing all 15

---

### Gate 8 — All Pipelines Still Ingest After Migration

Run the full ingestion smoke test suite:

```bash
npm run test:smoke -- --suite pipelines
# Tests: crash ingest, court filing, arrest ingest, jail booking, legal signal
# Expected: all 5 pipelines complete without error, records appear in DB
```

If no automated smoke test exists, manually POST a test payload to each pipeline webhook endpoint and verify DB record creation.

---

## 7. DB Schema Additions (Phase 4A — Additive Only)

Both tables are pure additions. No existing table is modified.

```sql
-- Queue health tracking (supplements Redis visibility)
-- Populated by a BullMQ repeatable job every 60 seconds
CREATE TABLE IF NOT EXISTS queue_health_snapshots (
  id                   BIGSERIAL PRIMARY KEY,
  snapshot_at          TIMESTAMPTZ DEFAULT NOW(),
  queue_name           VARCHAR(100) NOT NULL,
  active_count         INTEGER DEFAULT 0,
  waiting_count        INTEGER DEFAULT 0,
  delayed_count        INTEGER DEFAULT 0,
  failed_count         INTEGER DEFAULT 0,
  completed_count_1h   INTEGER DEFAULT 0,
  dead_letter_count    INTEGER DEFAULT 0,
  oldest_waiting_ms    INTEGER,
  redis_connected      BOOLEAN DEFAULT true
);

CREATE INDEX idx_queue_health_name_time
  ON queue_health_snapshots(queue_name, snapshot_at DESC);

-- Retention: auto-delete snapshots older than 30 days
-- Add to a nightly maintenance job:
-- DELETE FROM queue_health_snapshots WHERE snapshot_at < NOW() - INTERVAL '30 days';


-- Dead letter registry — permanent record, supplements Redis DLQ
-- Operators can query, replay, and annotate failed jobs here
CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  id                   BIGSERIAL PRIMARY KEY,
  job_id               VARCHAR(200) NOT NULL UNIQUE,
  queue_name           VARCHAR(100) NOT NULL,
  job_type             VARCHAR(100) NOT NULL,
  payload              JSONB NOT NULL,
  error_message        TEXT,
  error_stack          TEXT,
  error_class          VARCHAR(200),
  attempt_count        INTEGER NOT NULL,
  first_attempted_at   TIMESTAMPTZ,
  last_attempted_at    TIMESTAMPTZ,
  moved_to_dlq_at      TIMESTAMPTZ DEFAULT NOW(),
  trace_id             VARCHAR(100),
  account_id           INTEGER,
  sub_account_id       INTEGER,
  contact_id           INTEGER,
  incident_id          INTEGER,
  replay_status        VARCHAR(50) DEFAULT 'pending',  -- pending | replayed | dismissed | archived
  replayed_at          TIMESTAMPTZ,
  replayed_by          VARCHAR(200),
  operator_notes       TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dlq_queue_name
  ON dead_letter_jobs(queue_name, moved_to_dlq_at DESC);
CREATE INDEX idx_dlq_replay_status
  ON dead_letter_jobs(replay_status)
  WHERE replay_status = 'pending';
CREATE INDEX idx_dlq_account
  ON dead_letter_jobs(account_id, moved_to_dlq_at DESC);
CREATE INDEX idx_dlq_trace
  ON dead_letter_jobs(trace_id);
```

### Drizzle Schema Additions

```typescript
// shared/schema.ts — add to existing schema exports

export const queueHealthSnapshots = pgTable("queue_health_snapshots", {
  id:                bigserial("id", { mode: "number" }).primaryKey(),
  snapshotAt:        timestamp("snapshot_at", { withTimezone: true }).defaultNow(),
  queueName:         varchar("queue_name", { length: 100 }).notNull(),
  activeCount:       integer("active_count").default(0),
  waitingCount:      integer("waiting_count").default(0),
  delayedCount:      integer("delayed_count").default(0),
  failedCount:       integer("failed_count").default(0),
  completedCount1h:  integer("completed_count_1h").default(0),
  deadLetterCount:   integer("dead_letter_count").default(0),
  oldestWaitingMs:   integer("oldest_waiting_ms"),
  redisConnected:    boolean("redis_connected").default(true),
});

export const deadLetterJobs = pgTable("dead_letter_jobs", {
  id:               bigserial("id", { mode: "number" }).primaryKey(),
  jobId:            varchar("job_id", { length: 200 }).notNull().unique(),
  queueName:        varchar("queue_name", { length: 100 }).notNull(),
  jobType:          varchar("job_type", { length: 100 }).notNull(),
  payload:          jsonb("payload").notNull(),
  errorMessage:     text("error_message"),
  errorStack:       text("error_stack"),
  errorClass:       varchar("error_class", { length: 200 }),
  attemptCount:     integer("attempt_count").notNull(),
  firstAttemptedAt: timestamp("first_attempted_at", { withTimezone: true }),
  lastAttemptedAt:  timestamp("last_attempted_at", { withTimezone: true }),
  movedToDlqAt:     timestamp("moved_to_dlq_at", { withTimezone: true }).defaultNow(),
  traceId:          varchar("trace_id", { length: 100 }),
  accountId:        integer("account_id"),
  subAccountId:     integer("sub_account_id"),
  contactId:        integer("contact_id"),
  incidentId:       integer("incident_id"),
  replayStatus:     varchar("replay_status", { length: 50 }).default("pending"),
  replayed_at:      timestamp("replayed_at", { withTimezone: true }),
  replayedBy:       varchar("replayed_by", { length: 200 }),
  operatorNotes:    text("operator_notes"),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

---

## 8. Environment Variables Required

Add all of the following to Railway environment variables before deploying Phase 4A.

```bash
# === Redis (Required for durable queue) ===
UPSTASH_REDIS_URL=rediss://default:{token}@{host}:{port}
UPSTASH_REDIS_TOKEN={token}          # REST fallback if TCP blocked

# === Feature Flags ===
DURABLE_QUEUE_ENABLED=true           # Set false to fall back to in-memory

# === Worker Concurrency Tuning ===
WORKER_CONCURRENCY_HIGH=3            # incident alerts, sentinel events
WORKER_CONCURRENCY_MEDIUM=5          # contact enrichment, ingestion
WORKER_CONCURRENCY_LOW=10            # skip trace retries, outbound email
WORKER_CONCURRENCY_BACKGROUND=2      # embeddings, OCR (rate-limited)

# === Error Tracking ===
SENTRY_DSN=https://{key}@o{org}.ingest.sentry.io/{project}

# === Log Drain ===
AXIOM_API_KEY=xaat-{key}
AXIOM_DATASET=apex-logs              # Create this dataset in Axiom dashboard
```

**Variables that do NOT change:**
- `DATABASE_URL` — Neon connection string (unchanged)
- `SESSION_SECRET` — Express session secret (unchanged)
- All existing API keys (Stripe, Twilio, SendGrid, etc.)

---

## 9. Operational Runbook Hooks

### Replay a DLQ Job

```sql
-- Find pending DLQ jobs for an account
SELECT id, job_id, job_type, queue_name, error_message, attempt_count, moved_to_dlq_at
FROM dead_letter_jobs
WHERE account_id = $1
  AND replay_status = 'pending'
ORDER BY moved_to_dlq_at DESC;
```

```typescript
// POST /api/admin/dlq/:jobId/replay
import { Queue } from "bullmq";
import { redis } from "../redis";

export async function replayDLQJob(dlqJobId: number, operatorEmail: string): Promise<void> {
  const record = await db.query.deadLetterJobs.findFirst({
    where: eq(deadLetterJobs.id, dlqJobId),
  });
  if (!record) throw new Error("DLQ job not found");

  const queue = new Queue(record.queueName, { connection: redis! });
  await queue.add(record.jobType, record.payload, { attempts: 3 });

  await db.update(deadLetterJobs)
    .set({ replayStatus: "replayed", replayedAt: new Date(), replayedBy: operatorEmail })
    .where(eq(deadLetterJobs.id, dlqJobId));
}
```

### Check Queue Health

```typescript
// GET /api/admin/queue-health
import { Queue } from "bullmq";
import { allQueues } from "../queues/queueManager";

export async function getQueueHealth() {
  return Promise.all(
    allQueues().map(async (queue) => ({
      name: queue.name,
      counts: await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
      isPaused: await queue.isPaused(),
    }))
  );
}
```

---

*Next document: `STAGE_4A_REDIS_PLAN.md` — Upstash Redis infrastructure, connection architecture, key namespace, and provisioning steps.*
