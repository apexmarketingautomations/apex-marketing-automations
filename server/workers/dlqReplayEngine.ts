/**
 * server/workers/dlqReplayEngine.ts
 *
 * Dead Letter Queue Replay Engine  (Phase 3)
 *
 * The DLQ (apex-dead-letters) captures jobs that have exhausted all retries
 * across all other queues. This engine provides:
 *
 *  1. inspectDLQ()       — read DLQ jobs with failure context
 *  2. replayJob()        — move a single DLQ job back to its origin queue
 *  3. replayAll()        — replay all matching DLQ jobs by pattern/queue
 *  4. purgeDLQ()         — remove jobs from DLQ after operator review
 *  5. getDLQStats()      — breakdown by origin queue, error type, age
 *
 * All replay operations re-enqueue with a fresh job ID and reset attempt count,
 * preserving the original payload unchanged. The DLQ entry is removed only
 * after successful re-enqueue.
 */

import { Queue, type JobJson } from "bullmq";
import { getBullMQConnection, QUEUE_NAMES } from "../queues/queueFactory";

export interface DLQJobSummary {
  id:           string;
  name:         string;
  originQueue:  string;
  data:         Record<string, any>;
  failedReason: string;
  attemptsMade: number;
  timestamp:    number;
  finishedOn?:  number;
  processedOn?: number;
}

export interface DLQStats {
  total:        number;
  byOriginQueue: Record<string, number>;
  byErrorType:  Record<string, number>;
  oldestJobMs:  number | null;
  newestJobMs:  number | null;
}

export interface ReplayResult {
  replayed:     number;
  failed:       number;
  errors:       string[];
}

function makeDLQ(): Queue {
  return new Queue(QUEUE_NAMES.DEAD_LETTER, { connection: getBullMQConnection() });
}

function makeTargetQueue(name: string): Queue {
  return new Queue(name, { connection: getBullMQConnection() });
}

// ── Inspect DLQ ───────────────────────────────────────────────────────────────

export async function inspectDLQ(limit: number = 100): Promise<DLQJobSummary[]> {
  const dlq = makeDLQ();
  try {
    const jobs = await dlq.getFailed(0, limit - 1);
    return jobs.map(j => ({
      id:           j.id ?? "",
      name:         j.name,
      originQueue:  (j.data as any)?._originQueue ?? QUEUE_NAMES.GENERAL,
      data:         j.data as Record<string, any>,
      failedReason: j.failedReason ?? "unknown",
      attemptsMade: j.attemptsMade,
      timestamp:    j.timestamp,
      finishedOn:   j.finishedOn,
      processedOn:  j.processedOn,
    }));
  } finally {
    await dlq.close();
  }
}

// ── DLQ Stats ─────────────────────────────────────────────────────────────────

export async function getDLQStats(): Promise<DLQStats> {
  const dlq = makeDLQ();
  try {
    const jobs = await dlq.getFailed(0, 999);
    const total = jobs.length;
    const byOriginQueue: Record<string, number> = {};
    const byErrorType: Record<string, number>   = {};
    let oldestJobMs: number | null = null;
    let newestJobMs: number | null = null;

    for (const j of jobs) {
      const origin = (j.data as any)?._originQueue ?? "unknown";
      byOriginQueue[origin] = (byOriginQueue[origin] ?? 0) + 1;

      const errType = (j.failedReason ?? "unknown").slice(0, 60);
      byErrorType[errType] = (byErrorType[errType] ?? 0) + 1;

      if (j.timestamp) {
        if (oldestJobMs === null || j.timestamp < oldestJobMs) oldestJobMs = j.timestamp;
        if (newestJobMs === null || j.timestamp > newestJobMs) newestJobMs = j.timestamp;
      }
    }

    return { total, byOriginQueue, byErrorType, oldestJobMs, newestJobMs };
  } finally {
    await dlq.close();
  }
}

// ── Replay single job ─────────────────────────────────────────────────────────

export async function replayJob(jobId: string): Promise<{ ok: boolean; error?: string }> {
  const dlq = makeDLQ();
  try {
    const job = await dlq.getJob(jobId);
    if (!job) return { ok: false, error: `DLQ job ${jobId} not found` };

    const originQueue = (job.data as any)?._originQueue ?? QUEUE_NAMES.GENERAL;
    const targetQ = makeTargetQueue(originQueue);

    try {
      // Re-enqueue with fresh attempt count, preserve payload
      const payload = { ...job.data as Record<string, any> };
      delete payload._originQueue; // strip routing metadata

      await targetQ.add(job.name, payload, {
        priority: 10, // medium priority for replays
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      });

      // Remove from DLQ after successful re-enqueue
      await job.remove();
      console.log(`[DLQ-REPLAY] replayed job ${jobId} → ${originQueue}`);
      return { ok: true };
    } finally {
      await targetQ.close();
    }
  } catch (err: any) {
    return { ok: false, error: err?.message };
  } finally {
    await dlq.close();
  }
}

// ── Replay all jobs matching filter ──────────────────────────────────────────

export async function replayAll(filter?: {
  originQueue?: string;
  jobName?:     string;
  maxAge?:      number; // ms — only replay jobs younger than this
  limit?:       number;
}): Promise<ReplayResult> {
  const dlq = makeDLQ();
  const result: ReplayResult = { replayed: 0, failed: 0, errors: [] };
  const limit = filter?.limit ?? 200;

  try {
    const jobs = await dlq.getFailed(0, limit - 1);
    const now = Date.now();

    for (const job of jobs) {
      const originQueue = (job.data as any)?._originQueue ?? QUEUE_NAMES.GENERAL;

      // Apply filters
      if (filter?.originQueue && originQueue !== filter.originQueue) continue;
      if (filter?.jobName && job.name !== filter.jobName) continue;
      if (filter?.maxAge && job.timestamp && (now - job.timestamp) > filter.maxAge) continue;

      const r = await replayJob(job.id ?? "");
      if (r.ok) result.replayed++;
      else {
        result.failed++;
        result.errors.push(`${job.id}: ${r.error}`);
      }
    }
  } finally {
    await dlq.close();
  }

  console.log(`[DLQ-REPLAY] replayAll: replayed=${result.replayed} failed=${result.failed}`);
  return result;
}

// ── Purge DLQ entries ─────────────────────────────────────────────────────────

export async function purgeDLQ(jobIds: string[]): Promise<{ purged: number; errors: string[] }> {
  const dlq = makeDLQ();
  let purged = 0;
  const errors: string[] = [];

  try {
    for (const id of jobIds) {
      const job = await dlq.getJob(id);
      if (!job) { errors.push(`${id}: not found`); continue; }
      await job.remove();
      purged++;
    }
  } finally {
    await dlq.close();
  }

  console.log(`[DLQ-REPLAY] purged ${purged}/${jobIds.length} DLQ entries`);
  return { purged, errors };
}
