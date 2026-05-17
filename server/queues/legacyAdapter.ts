// @ts-nocheck
/**
 * server/queues/legacyAdapter.ts
 * --------------------------------
 * Drop-in BullMQ replacement for the in-memory JobQueue.
 *
 * Preserves the EXACT API surface of server/jobQueue.ts so no existing
 * caller needs to change:
 *   - jobQueue.registerHandler(type, handler)
 *   - jobQueue.enqueue(type, payload, maxAttempts?)  → returns job ID string
 *   - jobQueue.getStats()
 *   - jobQueue.getHistory(limit, jobType?)
 *   - jobQueue.getJob(jobId)
 *
 * Durability strategy:
 *   - If Redis is available: jobs are persisted to Upstash via BullMQ.
 *     Railway restarts are safe. Jobs survive.
 *   - If Redis is unavailable: falls back to the original in-memory behaviour
 *     with a console.warn. The app continues to function.
 *
 * Stats / history:
 *   - In-memory ring buffer (last 1000 jobs) for sync getStats()/getHistory().
 *   - BullMQ provides durable history — async queries available via getQueue().
 *   - Ring buffer is repopulated from BullMQ events as jobs complete.
 */

import crypto from "crypto";
import { Worker, type Job as BullMQJob } from "bullmq";
import { getGeneralQueue, QUEUE_NAMES, getBullMQConnection } from "./queueFactory";
import { isRedisAvailable } from "../redis";

// ─── Types (identical to server/jobQueue.ts for drop-in compat) ──────────────

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

// ─── Internal BullMQ job data shape ──────────────────────────────────────────

interface BullJobData {
  jobType: string;
  payload: Record<string, any>;
  maxAttempts: number;
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CONCURRENT = 5;
const MAX_HISTORY = 1_000;

// Circuit-breaker backoff delays (ms) — doubles each pause, capped at 5 min
const CB_BACKOFF_INITIAL = 15_000;
const CB_BACKOFF_MAX = 300_000;

// ─── DurableJobQueue ──────────────────────────────────────────────────────────

class DurableJobQueue {
  private handlers = new Map<string, JobHandler>();
  private history: Job[] = [];
  private activeCount = 0;

  // In-memory fallback queue (used when Redis is unavailable)
  private memQueue: Job[] = [];
  private memRunning = 0;
  private memProcessing = false;

  // BullMQ worker (initialised on first registerHandler when Redis is up)
  private bullWorker: Worker | null = null;
  private bullWorkerStarted = false;

  // Circuit-breaker state
  private cbPaused = false;
  private cbBackoffMs = CB_BACKOFF_INITIAL;
  private cbResumeTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Public API ─────────────────────────────────────────────────────────

  registerHandler(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
    console.log(`[JOB-QUEUE] Handler registered: ${jobType}`);

    // Start BullMQ worker on first registration (lazy init)
    if (isRedisAvailable() && !this.bullWorkerStarted) {
      this.startBullWorker();
    }
  }

  /**
   * Enqueue a job. Returns a job ID string immediately (sync).
   *
   * If Redis is available: persists to BullMQ (durable).
   * If Redis is unavailable: adds to in-memory queue (legacy behaviour).
   */
  enqueue(
    jobType: string,
    payload: Record<string, any>,
    maxAttempts: number = 3
  ): string {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    if (isRedisAvailable()) {
      // Durable path — persist to BullMQ
      const queue = getGeneralQueue();
      if (queue) {
        const data: BullJobData = { jobType, payload, maxAttempts, createdAt };
        queue
          .add(jobType, data, {
            jobId: id,
            attempts: maxAttempts,
            backoff: { type: "exponential", delay: 5_000 },
          })
          .catch((err) => {
            console.error(
              `[JOB-QUEUE] Failed to persist "${jobType}" to BullMQ — falling back to in-memory:`,
              err.message
            );
            // Fallback: add to memory queue
            this.addToMemoryQueue(id, jobType, payload, maxAttempts, createdAt);
          });

        return id;
      }
    }

    // In-memory fallback
    this.addToMemoryQueue(id, jobType, payload, maxAttempts, createdAt);
    return id;
  }

  getStats(): {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    registeredHandlers: string[];
    backend: "bullmq" | "memory";
  } {
    const usingBullMQ = isRedisAvailable() && this.bullWorkerStarted;

    return {
      queued: usingBullMQ ? 0 : this.memQueue.length, // BullMQ depth is async
      running: usingBullMQ ? this.activeCount : this.memRunning,
      completed: this.history.filter((j) => j.status === "completed").length,
      failed: this.history.filter((j) => j.status === "failed").length,
      registeredHandlers: [...this.handlers.keys()],
      backend: usingBullMQ ? "bullmq" : "memory",
    };
  }

  getHistory(limit: number = 50, jobType?: string): Job[] {
    let jobs = this.history;
    if (jobType) jobs = jobs.filter((j) => j.type === jobType);
    return jobs.slice(-limit);
  }

  getJob(jobId: string): Job | undefined {
    return (
      this.memQueue.find((j) => j.id === jobId) ||
      this.history.find((j) => j.id === jobId)
    );
  }

  // ─── BullMQ Worker ────────────────────────────────────────────────────────

  private startBullWorker(): void {
    if (this.bullWorkerStarted) return;

    try {
      const connection = getBullMQConnection();

      this.bullWorker = new Worker<BullJobData>(
        QUEUE_NAMES.GENERAL,
        async (bullJob: BullMQJob<BullJobData>) => {
          const { jobType, payload, maxAttempts, createdAt } = bullJob.data;

          const job: Job = {
            id: bullJob.id ?? bullJob.name,
            type: jobType,
            payload,
            status: "running",
            attempts: bullJob.attemptsMade + 1,
            maxAttempts,
            createdAt,
            startedAt: new Date().toISOString(),
          };

          this.activeCount++;

          try {
            const handler = this.handlers.get(jobType);
            if (!handler) {
              throw new Error(`No handler registered for job type: ${jobType}`);
            }

            job.result = await handler(payload);
            job.status = "completed";
            job.completedAt = new Date().toISOString();
          } catch (err: any) {
            job.status = "failed";
            job.error = err?.message ?? String(err);
            job.completedAt = new Date().toISOString();
            throw err; // Re-throw so BullMQ handles retry/DLQ
          } finally {
            this.activeCount = Math.max(0, this.activeCount - 1);
            this.addToHistory(job);
          }
        },
        {
          connection,
          concurrency: MAX_CONCURRENT,
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 2_000 },
        }
      );

      this.bullWorker.on("failed", (bullJob, err) => {
        if (bullJob) {
          console.error(
            `[JOB-QUEUE] BullMQ job failed: ${bullJob.data?.jobType} (id: ${bullJob.id}) — ${err.message}`
          );
        }
      });

      this.bullWorker.on("error", (err) => {
        const isQuotaError =
          err.message.includes("max requests limit exceeded") ||
          err.message.includes("QUOTA") ||
          err.message.includes("ERR max");

        if (isQuotaError && this.bullWorker && !this.cbPaused) {
          this.cbPaused = true;
          console.warn(
            `[JOB-QUEUE] ⚠ Redis quota exceeded — pausing BullMQ worker for ${this.cbBackoffMs / 1000}s. ` +
            `Upgrade Upstash plan or wait for quota reset.`
          );
          // Pause the worker so it stops hammering Redis
          this.bullWorker.pause().catch(() => undefined);  // allow-silent-catch: non-fatal, returns safe default

          // Clear any existing resume timer
          if (this.cbResumeTimer) clearTimeout(this.cbResumeTimer);

          this.cbResumeTimer = setTimeout(async () => {
            if (this.bullWorker) {
              try {
                await this.bullWorker.resume();
                console.log(
                  `[JOB-QUEUE] BullMQ worker resumed after ${this.cbBackoffMs / 1000}s backoff`
                );
                this.cbPaused = false;
                // Double backoff for next quota hit, capped at max
                this.cbBackoffMs = Math.min(this.cbBackoffMs * 2, CB_BACKOFF_MAX);
              } catch (resumeErr: any) {
                console.error("[JOB-QUEUE] Failed to resume worker:", resumeErr.message);
                this.cbPaused = false; // allow next error to re-trigger
              }
            }
          }, this.cbBackoffMs);
        } else if (!isQuotaError) {
          console.error("[JOB-QUEUE] BullMQ worker error:", err.message);
        }
        // Quota errors while already paused are silently swallowed — no log spam
      });

      this.bullWorkerStarted = true;
      console.log("[JOB-QUEUE] ✅ BullMQ worker started on apex-general queue");
    } catch (err: any) {
      console.error(
        "[JOB-QUEUE] Failed to start BullMQ worker — falling back to in-memory:",
        err.message
      );
    }
  }

  // ─── In-memory fallback (original jobQueue.ts behaviour) ─────────────────

  private addToMemoryQueue(
    id: string,
    jobType: string,
    payload: Record<string, any>,
    maxAttempts: number,
    createdAt: string
  ): void {
    const job: Job = {
      id,
      type: jobType,
      payload,
      status: "queued",
      attempts: 0,
      maxAttempts,
      createdAt,
    };
    this.memQueue.push(job);
    this.processMemoryNext();
  }

  private async processMemoryNext(): Promise<void> {
    if (this.memRunning >= MAX_CONCURRENT || this.memQueue.length === 0) return;
    if (this.memProcessing) return;

    this.memProcessing = true;
    const job = this.memQueue.shift();
    if (!job) {
      this.memProcessing = false;
      return;
    }

    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = "failed";
      job.error = `No handler registered for job type: ${job.type}`;
      this.addToHistory(job);
      console.error(`[JOB-QUEUE] ${job.error}`);
      this.memProcessing = false;
      this.processMemoryNext();
      return;
    }

    this.memRunning++;
    this.memProcessing = false;

    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.attempts++;

    try {
      job.result = await handler(job.payload);
      job.status = "completed";
      job.completedAt = new Date().toISOString();
    } catch (err: any) {
      const errMsg = err?.message ?? String(err);
      if (job.attempts < job.maxAttempts) {
        job.status = "queued";
        job.error = `Attempt ${job.attempts} failed: ${errMsg}`;
        console.warn(
          `[JOB-QUEUE] Retrying ${job.type} (${job.attempts}/${job.maxAttempts}): ${errMsg}`
        );
        this.memQueue.push(job);
      } else {
        job.status = "failed";
        job.error = errMsg;
        job.completedAt = new Date().toISOString();
        console.error(
          `[JOB-QUEUE] Job failed after ${job.maxAttempts} attempts: ${job.type} — ${errMsg}`
        );
      }
    }

    if (job.status !== "queued") {
      this.addToHistory(job);
    }

    this.memRunning--;
    this.processMemoryNext();
  }

  // ─── Shared history ring buffer ───────────────────────────────────────────

  private addToHistory(job: Job): void {
    this.history.push(job);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }
  }

  // ─── Graceful shutdown ────────────────────────────────────────────────────

  async close(): Promise<void> {
    if (this.cbResumeTimer) {
      clearTimeout(this.cbResumeTimer);
      this.cbResumeTimer = null;
    }
    if (this.bullWorker) {
      await this.bullWorker.close();
      console.log("[JOB-QUEUE] BullMQ worker closed");
    }
  }
}

// ─── Singleton export (drop-in for existing `import { jobQueue }` calls) ─────

export const jobQueue = new DurableJobQueue();
