// @ts-nocheck
/**
 * server/queues/queueFactory.ts
 * ------------------------------
 * BullMQ Queue registry for Apex Marketing OS.
 *
 * Queue hierarchy (priority order, high → low):
 *   apex-routing       — contact routing, lead delivery (HIGH)
 *   apex-notifications — SMS/email alerts, webhooks (HIGH)
 *   apex-intake        — inbound webhook processing (HIGH)
 *   apex-enrichment    — skip trace, address validation (MEDIUM)
 *   apex-scoring       — contact quality, case scoring (MEDIUM)
 *   apex-crm           — CRM updates, lifecycle changes (MEDIUM)
 *   apex-general       — legacy jobQueue.ts migrations (MEDIUM)
 *   apex-ocr           — document ingestion, OCR extraction (LOW)
 *   apex-embeddings    — vector embedding generation (LOW)
 *   apex-semantic      — semantic indexing, reranking (LOW)
 *   apex-maintenance   — cleanup, archival, health checks (BACKGROUND)
 *
 * All queues share the same Upstash Redis instance but use isolated
 * BullMQ connections. Workers are defined in server/workers/*.ts.
 */

import { Queue, QueueEvents, type ConnectionOptions } from "bullmq";
import { createRedisConnection, isRedisAvailable } from "../redis";

// ─── Connection config passed to every Queue/Worker ──────────────────────────
// BullMQ requires a fresh ioredis instance per Queue AND per Worker.

export function getBullMQConnection(): ConnectionOptions {
  const url = process.env.UPSTASH_REDIS_URL;
  if (!url) {
    throw new Error("[QUEUE-FACTORY] UPSTASH_REDIS_URL not set");
  }

  // Return URL string — BullMQ will create its own ioredis connection.
  // This avoids the "shared connection" anti-pattern.
  return {
    url,
    tls: {},
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  } as unknown as ConnectionOptions;
}

// ─── Queue names (single source of truth) ────────────────────────────────────

export const QUEUE_NAMES = {
  ROUTING: "apex-routing",
  NOTIFICATIONS: "apex-notifications",
  INTAKE: "apex-intake",
  ENRICHMENT: "apex-enrichment",
  SCORING: "apex-scoring",
  CRM: "apex-crm",
  GENERAL: "apex-general",       // Legacy jobQueue.ts drop-in
  OCR: "apex-ocr",
  EMBEDDINGS: "apex-embeddings",
  SEMANTIC: "apex-semantic",
  MAINTENANCE: "apex-maintenance",
  DEAD_LETTER: "apex-dead-letters", // All exhausted jobs land here for replay
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

// ─── Default job options per queue ────────────────────────────────────────────

const HIGH_PRIORITY_DEFAULTS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 2_000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 2_000 }, // Keep more failures for debugging
};

const MEDIUM_PRIORITY_DEFAULTS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 1_000 },
};

const LOW_PRIORITY_DEFAULTS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 30_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

const BACKGROUND_DEFAULTS = {
  attempts: 2,
  backoff: { type: "fixed" as const, delay: 60_000 },
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 200 },
};

// ─── Queue registry ───────────────────────────────────────────────────────────

let queues: Map<QueueName, Queue> | null = null;

function createQueue(name: QueueName, defaultJobOptions: object): Queue {
  const connection = createRedisConnection();
  return new Queue(name, {
    connection,
    defaultJobOptions,
  });
}

/**
 * Initialise all BullMQ queues.
 * Call once at startup, AFTER initRedis() confirms connection.
 * Queues are singletons — safe to call multiple times.
 */
export function initQueues(): Map<QueueName, Queue> {
  if (queues) return queues;

  if (!isRedisAvailable()) {
    console.warn("[QUEUE-FACTORY] Redis not available — BullMQ queues not initialised");
    return new Map();
  }

  console.log("[QUEUE-FACTORY] Initialising BullMQ queues...");

  queues = new Map<QueueName, Queue>([
    [QUEUE_NAMES.ROUTING,       createQueue(QUEUE_NAMES.ROUTING,       HIGH_PRIORITY_DEFAULTS)],
    [QUEUE_NAMES.NOTIFICATIONS, createQueue(QUEUE_NAMES.NOTIFICATIONS,  HIGH_PRIORITY_DEFAULTS)],
    [QUEUE_NAMES.INTAKE,        createQueue(QUEUE_NAMES.INTAKE,         HIGH_PRIORITY_DEFAULTS)],
    [QUEUE_NAMES.ENRICHMENT,    createQueue(QUEUE_NAMES.ENRICHMENT,     MEDIUM_PRIORITY_DEFAULTS)],
    [QUEUE_NAMES.SCORING,       createQueue(QUEUE_NAMES.SCORING,        MEDIUM_PRIORITY_DEFAULTS)],
    [QUEUE_NAMES.CRM,           createQueue(QUEUE_NAMES.CRM,            MEDIUM_PRIORITY_DEFAULTS)],
    [QUEUE_NAMES.GENERAL,       createQueue(QUEUE_NAMES.GENERAL,        MEDIUM_PRIORITY_DEFAULTS)],
    [QUEUE_NAMES.OCR,           createQueue(QUEUE_NAMES.OCR,            LOW_PRIORITY_DEFAULTS)],
    [QUEUE_NAMES.EMBEDDINGS,    createQueue(QUEUE_NAMES.EMBEDDINGS,     LOW_PRIORITY_DEFAULTS)],
    [QUEUE_NAMES.SEMANTIC,      createQueue(QUEUE_NAMES.SEMANTIC,       LOW_PRIORITY_DEFAULTS)],
    [QUEUE_NAMES.MAINTENANCE,   createQueue(QUEUE_NAMES.MAINTENANCE,    BACKGROUND_DEFAULTS)],
    [QUEUE_NAMES.DEAD_LETTER,   createQueue(QUEUE_NAMES.DEAD_LETTER, {
      // DLQ jobs never auto-retry — they wait for operator replay
      attempts:         1,
      removeOnComplete: { count: 100 },
      removeOnFail:     { count: 5_000 }, // keep lots of DLQ failures for audit
    })],
  ]);

  console.log(`[QUEUE-FACTORY] ✅ ${queues.size} queues ready: ${[...queues.keys()].join(", ")}`);
  return queues;
}

/**
 * Get a specific queue by name.
 * Returns null if Redis is unavailable (graceful degradation).
 */
export function getQueue(name: QueueName): Queue | null {
  return queues?.get(name) ?? null;
}

/**
 * Get the general-purpose queue (used by legacyAdapter.ts).
 */
export function getGeneralQueue(): Queue | null {
  return queues?.get(QUEUE_NAMES.GENERAL) ?? null;
}

/**
 * Typed queue getters — used by workers so they don't have to handle null.
 * Throws if the queue wasn't initialised (Redis unavailable at startup).
 */
function requireQueue(name: QueueName): Queue {
  const q = queues?.get(name);
  if (!q) throw new Error(`[QUEUE-FACTORY] Queue ${name} not initialised — is Redis connected?`);
  return q;
}

export function getEnrichmentQueue():  Queue { return requireQueue(QUEUE_NAMES.ENRICHMENT); }
export function getScoringQueue():     Queue { return requireQueue(QUEUE_NAMES.SCORING); }
export function getMaintenanceQueue(): Queue { return requireQueue(QUEUE_NAMES.MAINTENANCE); }
export function getRoutingQueue():     Queue { return requireQueue(QUEUE_NAMES.ROUTING); }
export function getDeadLetterQueue():  Queue { return requireQueue(QUEUE_NAMES.DEAD_LETTER); }
export { isRedisAvailable };

// ─── Dead Letter Queue helpers ────────────────────────────────────────────────

export interface DeadLetterEnvelope {
  /** Name of the source queue the job came from */
  sourceQueue: QueueName;
  /** Original BullMQ job name */
  jobName: string;
  /** Original job payload */
  payload: unknown;
  /** Number of attempts that were made */
  attempts: number;
  /** Last error message */
  lastError: string;
  /** ISO timestamp of failure */
  failedAt: string;
  /** Optional metadata for replay routing */
  meta?: Record<string, unknown>;
}

/**
 * Push a failed job to the dead letter queue.
 * Call this from worker `failed` event handlers.
 */
export async function sendToDeadLetterQueue(envelope: DeadLetterEnvelope): Promise<string | undefined> {
  try {
    const dlq = queues?.get(QUEUE_NAMES.DEAD_LETTER);
    if (!dlq) {
      console.error("[DLQ] Dead letter queue not initialised — job lost!", envelope.jobName);
      return undefined;
    }
    const job = await dlq.add(`dlq:${envelope.sourceQueue}:${envelope.jobName}`, envelope, {
      removeOnComplete: false, // keep DLQ completions forever for audit
      removeOnFail: { count: 5_000 },
    });
    console.warn(`[DLQ] ☠ Job dead-lettered: ${envelope.sourceQueue}/${envelope.jobName} — ${envelope.lastError}`);
    return job.id;
  } catch (err: any) {
    console.error(`[DLQ] Failed to write to dead letter queue: ${err?.message}`);
    return undefined;
  }
}

/**
 * Fetch paginated dead letter jobs for the admin API.
 */
export async function getDeadLetterJobs(opts: {
  start?: number;
  end?: number;
  sourceQueue?: string;
}): Promise<{ jobs: Array<{ id: string; data: DeadLetterEnvelope; failedAt: string }>; total: number }> {
  const dlq = queues?.get(QUEUE_NAMES.DEAD_LETTER);
  if (!dlq) return { jobs: [], total: 0 };

  const { start = 0, end = 49, sourceQueue } = opts;

  // BullMQ getJobs returns jobs in all states
  const [waiting, failed] = await Promise.all([
    dlq.getJobs(["waiting"], start, end),
    dlq.getJobs(["failed"], start, end),
  ]);
  const allJobs = [...waiting, ...failed];

  const filtered = sourceQueue
    ? allJobs.filter(j => (j.data as DeadLetterEnvelope).sourceQueue === sourceQueue)
    : allJobs;

  return {
    jobs: filtered.map(j => ({
      id:       j.id ?? "unknown",
      data:     j.data as DeadLetterEnvelope,
      failedAt: (j.data as DeadLetterEnvelope).failedAt ?? new Date(j.timestamp).toISOString(),
    })),
    total: filtered.length,
  };
}

/**
 * Replay a DLQ job by re-enqueueing it to its source queue.
 * The job is removed from the DLQ after successful re-enqueue.
 */
export async function replayDeadLetterJob(jobId: string): Promise<{ ok: boolean; newJobId?: string; error?: string }> {
  const dlq = queues?.get(QUEUE_NAMES.DEAD_LETTER);
  if (!dlq) return { ok: false, error: "DLQ not initialised" };

  const job = await dlq.getJob(jobId);
  if (!job) return { ok: false, error: `DLQ job ${jobId} not found` };

  const envelope = job.data as DeadLetterEnvelope;
  const sourceQueue = queues?.get(envelope.sourceQueue);
  if (!sourceQueue) return { ok: false, error: `Source queue ${envelope.sourceQueue} not found` };

  try {
    const replayed = await sourceQueue.add(
      envelope.jobName,
      envelope.payload,
      { attempts: 3, backoff: { type: "exponential", delay: 5_000 } }
    );
    await job.remove();
    console.log(`[DLQ] ↩ Replayed job ${jobId} → ${envelope.sourceQueue} as ${replayed.id}`);
    return { ok: true, newJobId: replayed.id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "replay failed" };
  }
}

// ─── Queue health snapshot ────────────────────────────────────────────────────

export interface QueueHealthSnapshot {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  timestamp: string;
}

/**
 * Fetch job counts for all queues.
 * Used by the /api/operator/queue-health endpoint.
 */
export async function getQueueHealthSnapshot(): Promise<QueueHealthSnapshot[]> {
  if (!queues) return [];

  const snapshots = await Promise.allSettled(
    [...queues.entries()].map(async ([name, queue]) => {
      const counts = await queue.getJobCounts(
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed",
        "paused"
      );
      const isPaused = await queue.isPaused();

      return {
        name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
        paused: isPaused,
        timestamp: new Date().toISOString(),
      } satisfies QueueHealthSnapshot;
    })
  );

  return snapshots
    .filter((r): r is PromiseFulfilledResult<QueueHealthSnapshot> => r.status === "fulfilled")
    .map(r => r.value);
}

/**
 * Gracefully close all queue connections.
 * Call in SIGTERM handler.
 */
export async function closeQueues(): Promise<void> {
  if (!queues) return;

  await Promise.allSettled([...queues.values()].map(q => q.close()));
  queues = null;
  console.log("[QUEUE-FACTORY] All queues closed");
}
