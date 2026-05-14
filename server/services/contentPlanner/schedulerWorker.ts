import { db } from "../../db";
import { eq, and, lte, or, sql } from "drizzle-orm";
import { contentPosts, contentPostPlatforms, contentPublishingJobs } from "@shared/schema";
import { publishPost } from "./publisher";
import crypto from "crypto";

const INSTANCE_ID = `worker-${crypto.randomUUID().slice(0, 8)}`;
const POLL_INTERVAL_MS = 30_000;
const LOCK_TTL_MS = 120_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_DEFAULT_ATTEMPTS = 5;

let isRunning = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let stats = {
  jobsProcessed: 0,
  jobsSucceeded: 0,
  jobsFailed: 0,
  lastPollAt: null as Date | null,
  startedAt: null as Date | null,
  isRunning: false,
};

function backoffMs(attempt: number): number {
  const base = 60_000;
  const jitter = Math.random() * 15_000;
  return Math.min(base * Math.pow(2, attempt) + jitter, 3_600_000);
}

async function ensureScheduledJobsExist(): Promise<void> {
  const now = new Date();
  const duePosts = await db.select().from(contentPosts)
    .where(and(
      eq(contentPosts.status, "scheduled"),
      lte(contentPosts.scheduledAt, now),
    ));

  for (const post of duePosts) {
    const postPlatforms = await db.select().from(contentPostPlatforms)
      .where(eq(contentPostPlatforms.postId, post.id));

    if (postPlatforms.length === 0) continue;

    for (const pp of postPlatforms) {
      const existingJobs = await db.select({ id: contentPublishingJobs.id })
        .from(contentPublishingJobs)
        .where(and(
          eq(contentPublishingJobs.postId, post.id),
          eq(contentPublishingJobs.platform, pp.platform),
          or(
            eq(contentPublishingJobs.status, "queued"),
            eq(contentPublishingJobs.status, "processing"),
            eq(contentPublishingJobs.status, "published"),
          )
        ));

      if (existingJobs.length > 0) continue;

      await db.insert(contentPublishingJobs).values({
        subAccountId: post.subAccountId,
        postId: post.id,
        platform: pp.platform,
        socialAccountId: pp.socialAccountId,
        status: "queued",
        trigger: "scheduled",
        scheduledAtUtc: post.scheduledAt,
        attemptCount: 0,
        maxAttempts: MAX_DEFAULT_ATTEMPTS,
      });
      console.log(`[CP-WORKER] Created queued job for post ${post.id} platform ${pp.platform}`);
    }
  }
}

async function claimNextJob(): Promise<any | null> {
  const now = new Date();
  const lockExpiry = new Date(now.getTime() + LOCK_TTL_MS);

  const result = await db.execute(sql`
    UPDATE content_publishing_jobs 
    SET status = 'processing',
        lock_owner = ${INSTANCE_ID},
        lock_expires_at = ${lockExpiry},
        started_at = ${now},
        attempt_count = attempt_count + 1,
        updated_at = ${now}
    WHERE id = (
      SELECT id FROM content_publishing_jobs
      WHERE status = 'queued'
        AND (scheduled_at_utc IS NULL OR scheduled_at_utc <= ${now})
        AND (next_retry_at IS NULL OR next_retry_at <= ${now})
      ORDER BY scheduled_at_utc ASC NULLS LAST, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  const rows = (result as any).rows;
  return rows && rows.length > 0 ? rows[0] : null;
}

async function refreshHeartbeat(jobId: number): Promise<void> {
  const lockExpiry = new Date(Date.now() + LOCK_TTL_MS);
  await db.update(contentPublishingJobs)
    .set({ lockExpiresAt: lockExpiry, updatedAt: new Date() })
    .where(and(
      eq(contentPublishingJobs.id, jobId),
      eq(contentPublishingJobs.lockOwner, INSTANCE_ID),
    ));
}

async function isJobStillProcessing(jobId: number): Promise<boolean> {
  const [job] = await db.select({ status: contentPublishingJobs.status })
    .from(contentPublishingJobs)
    .where(and(
      eq(contentPublishingJobs.id, jobId),
      eq(contentPublishingJobs.lockOwner, INSTANCE_ID),
      eq(contentPublishingJobs.status, "processing"),
    ));
  return !!job;
}

async function markJobPublished(jobId: number, externalPostId: string | null): Promise<void> {
  await db.update(contentPublishingJobs).set({
    status: "published",
    externalPostId,
    completedAt: new Date(),
    lockOwner: null,
    lockExpiresAt: null,
    updatedAt: new Date(),
  }).where(and(
    eq(contentPublishingJobs.id, jobId),
    eq(contentPublishingJobs.lockOwner, INSTANCE_ID),
    eq(contentPublishingJobs.status, "processing"),
  ));
}

async function markJobFailed(jobId: number, error: string, attemptCount: number, maxAttempts: number): Promise<void> {
  const stillProcessing = await isJobStillProcessing(jobId);
  if (!stillProcessing) {
    console.log(`[CP-WORKER] Job ${jobId} no longer owned by us (cancelled?), skipping failure update`);
    return;
  }

  if (attemptCount >= maxAttempts) {
    await db.update(contentPublishingJobs).set({
      status: "failed",
      errorMessage: error,
      completedAt: new Date(),
      lockOwner: null,
      lockExpiresAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(contentPublishingJobs.id, jobId),
      eq(contentPublishingJobs.lockOwner, INSTANCE_ID),
    ));
    console.log(`[CP-WORKER] Job ${jobId} permanently failed after ${attemptCount} attempts: ${error}`);
  } else {
    const retryAt = new Date(Date.now() + backoffMs(attemptCount));
    await db.update(contentPublishingJobs).set({
      status: "queued",
      errorMessage: error,
      nextRetryAt: retryAt,
      lockOwner: null,
      lockExpiresAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(contentPublishingJobs.id, jobId),
      eq(contentPublishingJobs.lockOwner, INSTANCE_ID),
    ));
    console.log(`[CP-WORKER] Job ${jobId} attempt ${attemptCount}/${maxAttempts} failed, retry at ${retryAt.toISOString()}: ${error}`);
  }
}

async function processJob(job: any): Promise<void> {
  const heartbeatTimer = setInterval(() => refreshHeartbeat(job.id), HEARTBEAT_INTERVAL_MS);

  try {
    const isTestMode = process.env.TEST_PUBLISH === "true";

    if (isTestMode) {
      console.log(`[CP-WORKER][TEST] Simulating publish for job ${job.id} (post=${job.post_id}, platform=${job.platform})`);
      await new Promise(r => setTimeout(r, 1000));
      const fakeExternalId = `test_${job.platform}_${Date.now()}`;
      await markJobPublished(job.id, fakeExternalId);
      console.log(`[CP-WORKER][TEST] Job ${job.id} simulated success — externalPostId=${fakeExternalId}`);
      stats.jobsSucceeded++;
    } else {
      const result = await publishPost({
        postId: job.post_id,
        subAccountId: job.sub_account_id,
        trigger: job.trigger || "scheduled",
        platforms: [job.platform],
        recordJob: false,
      });

      const platformResult = result.results.find((r: any) => r.platform === job.platform);
      if (platformResult?.success) {
        await markJobPublished(job.id, platformResult.externalPostId);
        console.log(`[CP-WORKER] Job ${job.id} published — externalPostId=${platformResult.externalPostId}`);
        stats.jobsSucceeded++;

        // Report to Apex Intelligence brain (fire-and-forget)
        import("../../operator/apexIntelligence").then(({ reportOutcome }) => reportOutcome({
          agentName:    "content-publisher",
          action:       "content_published",
          subject:      `post-${job.post_id}`,
          result:       `Content published — platform: ${job.platform} externalId: ${platformResult.externalPostId || "unknown"}`,
          confidence:   0.85,
          subAccountId: job.sub_account_id,
          niche:        "content",
          metadata: {
            postId:   job.post_id,
            platform: job.platform,
            trigger:  job.trigger,
            jobId:    job.id,
          },
        // allow-silent-catch: fire-and-forget telemetry
        })).catch(() => {});
      } else {
        const errMsg = platformResult?.errorMessage || "Unknown publish error";
        await markJobFailed(job.id, errMsg, job.attempt_count, job.max_attempts);
        stats.jobsFailed++;
      }
    }
  } catch (err: any) {
    await markJobFailed(job.id, err.message, job.attempt_count || 1, job.max_attempts || MAX_DEFAULT_ATTEMPTS);
    stats.jobsFailed++;
  } finally {
    clearInterval(heartbeatTimer);
    stats.jobsProcessed++;
  }
}

async function pollOnce(): Promise<void> {
  stats.lastPollAt = new Date();

  try {
    await ensureScheduledJobsExist();

    let job = await claimNextJob();
    let processed = 0;
    while (job && processed < 5) {
      await processJob(job);
      processed++;
      job = await claimNextJob();
    }
  } catch (err: any) {
    console.error(`[CP-WORKER] Poll error: ${err.message}`);
  }
}

export function startContentPublisherWorker(): void {
  if (isRunning) {
    console.log("[CP-WORKER] Already running, skipping start");
    return;
  }
  isRunning = true;
  stats.isRunning = true;
  stats.startedAt = new Date();

  console.log(`[CP-WORKER] Started (id=${INSTANCE_ID}) — polling every ${POLL_INTERVAL_MS / 1000}s`);

  setTimeout(() => pollOnce(), 5000);

  pollTimer = setInterval(() => pollOnce(), POLL_INTERVAL_MS);
}

export function stopContentPublisherWorker(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  isRunning = false;
  stats.isRunning = false;
  console.log("[CP-WORKER] Stopped");
}

export function getPublisherStats() {
  return { ...stats, instanceId: INSTANCE_ID };
}

export async function getQueueStats(subAccountId?: number) {
  const query = subAccountId
    ? sql`SELECT status, COUNT(*)::int as count FROM content_publishing_jobs WHERE sub_account_id = ${subAccountId} GROUP BY status`
    : sql`SELECT status, COUNT(*)::int as count FROM content_publishing_jobs GROUP BY status`;
  const result = await db.execute(query);
  const rows = (result as any).rows || [];
  const byStatus: Record<string, number> = {};
  for (const row of rows) {
    byStatus[row.status] = row.count;
  }
  return {
    queued: byStatus.queued || 0,
    processing: byStatus.processing || 0,
    published: byStatus.published || 0,
    failed: byStatus.failed || 0,
    cancelled: byStatus.cancelled || 0,
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
  };
}
