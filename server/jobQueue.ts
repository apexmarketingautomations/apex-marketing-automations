import crypto from "crypto";

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

const MAX_CONCURRENT = 5;
const MAX_HISTORY = 1000;

class JobQueue {
  private handlers = new Map<string, JobHandler>();
  private queue: Job[] = [];
  private running = 0;
  private history: Job[] = [];
  private processing = false;

  registerHandler(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
    console.log(`[JOB-QUEUE] Handler registered: ${jobType}`);
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
    if (this.running >= MAX_CONCURRENT || this.queue.length === 0) return;

    const job = this.queue.shift();
    if (!job) return;

    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = "failed";
      job.error = `No handler registered for job type: ${job.type}`;
      this.addToHistory(job);
      console.error(`[JOB-QUEUE] ${job.error}`);
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
      const errMsg = err?.message || String(err);
      if (job.attempts < job.maxAttempts) {
        job.status = "queued";
        job.error = `Attempt ${job.attempts} failed: ${errMsg}`;
        console.warn(`[JOB-QUEUE] Retrying ${job.type} (${job.attempts}/${job.maxAttempts}): ${errMsg}`);
        this.queue.push(job);
      } else {
        job.status = "failed";
        job.error = errMsg;
        job.completedAt = new Date().toISOString();
        console.error(`[JOB-QUEUE] Job failed after ${job.maxAttempts} attempts: ${job.type} — ${errMsg}`);
      }
    }

    if (job.status !== "queued") {
      this.addToHistory(job);
    }

    this.running--;
    this.processNext();
  }

  private addToHistory(job: Job): void {
    this.history.push(job);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }
  }

  getStats(): {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    registeredHandlers: string[];
  } {
    return {
      queued: this.queue.length,
      running: this.running,
      completed: this.history.filter(j => j.status === "completed").length,
      failed: this.history.filter(j => j.status === "failed").length,
      registeredHandlers: [...this.handlers.keys()],
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

export const jobQueue = new JobQueue();
