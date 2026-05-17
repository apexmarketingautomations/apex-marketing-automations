// @ts-nocheck
/**
 * server/workers/maintenanceWorker.ts
 *
 * BullMQ Worker consuming the `apex-maintenance` queue.
 * Also runs scheduled maintenance tasks via setInterval.
 *
 * Maintenance jobs:
 *   expire_opportunities  — mark opportunities past expiresAt as 'expired'
 *   age_placeholders      — alert on contacts stuck as placeholder > N hours
 *   queue_health_check    — check queue lag, emit warnings
 *   prune_dead_jobs       — clean up stale BullMQ job records
 *   rescore_stale         — re-score contacts whose score has expired
 *   expire_legal_leads    — mark legal leads past expiresAt as expired
 *
 * Scheduled intervals:
 *   Every 15 min: expire_opportunities, expire_legal_leads
 *   Every  1 hr:  age_placeholders, queue_health_check
 *   Every  6 hr:  prune_dead_jobs, rescore_stale
 */

import { Worker, Job } from "bullmq";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getBullMQConnection, QUEUE_NAMES, getMaintenanceQueue, getEnrichmentQueue, getScoringQueue, attachCircuitBreaker } from "../queues/queueFactory";

const WORKER_TAG = "MAINTENANCE-WORKER";

// ── Thresholds ────────────────────────────────────────────────────────────────

const PLACEHOLDER_ALERT_HOURS  = 24;   // alert if contact is placeholder > 24h
const RESCORE_STALE_HOURS      = 48;   // rescore if score is older than 48h
const MAX_MAINTENANCE_CONCURRENCY = 1; // one maintenance job at a time

// ── Job payload ───────────────────────────────────────────────────────────────

export type MaintenanceJobType =
  | "expire_opportunities"
  | "age_placeholders"
  | "queue_health_check"
  | "prune_dead_jobs"
  | "rescore_stale"
  | "expire_legal_leads";

export interface MaintenanceJobData {
  jobType: MaintenanceJobType;
  /** Optional sub-account scope (null = all accounts) */
  subAccountId?: number;
}

// ── Enqueue helper ────────────────────────────────────────────────────────────

export async function enqueueMaintenanceJob(data: MaintenanceJobData): Promise<void> {
  try {
    const queue = getMaintenanceQueue();
    await queue.add(`maint:${data.jobType}`, data, {
      jobId:    `maint-${data.jobType}-${Date.now()}`,
      attempts:  2,
      removeOnComplete: { count: 100 },
      removeOnFail:     { count: 50 },
    });
  } catch (err: any) {
    console.warn(`[${WORKER_TAG}] Failed to enqueue job type=${data.jobType}: ${err?.message}`);
  }
}

// ── Job handlers ──────────────────────────────────────────────────────────────

async function handleExpireOpportunities(): Promise<{ expired: number }> {
  try {
    const result = await db.execute(sql`
      UPDATE opportunities
        SET status     = 'expired',
            updated_at = now()
        WHERE status NOT IN ('expired', 'won', 'lost')
          AND expires_at < now()
    `);
    const expired = (result as any).rowCount ?? 0;
    if (expired > 0) console.log(`[${WORKER_TAG}] Expired ${expired} opportunities`);
    return { expired };
  } catch (err: any) {
    console.error(`[${WORKER_TAG}] expire_opportunities error: ${err?.message}`);
    return { expired: 0 };
  }
}

async function handleExpireLegalLeads(): Promise<{ expired: number }> {
  try {
    const result = await db.execute(sql`
      UPDATE legal_leads
        SET status     = 'expired',
            updated_at = now()
        WHERE status = 'available'
          AND expires_at < now()
    `);
    const expired = (result as any).rowCount ?? 0;
    if (expired > 0) console.log(`[${WORKER_TAG}] Expired ${expired} legal leads`);
    return { expired };
  } catch (err: any) {
    console.warn(`[${WORKER_TAG}] expire_legal_leads error: ${err?.message}`);
    return { expired: 0 };
  }
}

async function handleAgePlaceholders(): Promise<{ alertCount: number }> {
  try {
    const rows = await db.execute<{ cnt: string; vertical: string }>(sql`
      SELECT lead_vertical as vertical, COUNT(*) as cnt
        FROM contacts
        WHERE is_placeholder = true
          AND created_at < now() - INTERVAL '${PLACEHOLDER_ALERT_HOURS} hours'
        GROUP BY lead_vertical
        ORDER BY cnt DESC
        LIMIT 20
    `);
    const total = rows.rows.reduce((sum, r) => sum + parseInt(r.cnt, 10), 0);
    if (total > 0) {
      const breakdown = rows.rows.map(r => `${r.vertical || "unknown"}:${r.cnt}`).join(", ");
      console.warn(
        `[${WORKER_TAG}] PLACEHOLDER AGING ALERT: ${total} contacts stuck as placeholder > ${PLACEHOLDER_ALERT_HOURS}h ` +
        `[${breakdown}] — enrichment may be stalled or skip-trace disabled`
      );
    }
    return { alertCount: total };
  } catch (err: any) {
    console.warn(`[${WORKER_TAG}] age_placeholders error: ${err?.message}`);
    return { alertCount: 0 };
  }
}

async function handleQueueHealthCheck(): Promise<{ queueStats: Record<string, unknown> }> {
  const stats: Record<string, unknown> = {};
  try {
    const enrichmentQ = getEnrichmentQueue();
    const scoringQ    = getScoringQueue();
    const maintQ      = getMaintenanceQueue();

    for (const [name, q] of [
      ["enrichment", enrichmentQ],
      ["scoring", scoringQ],
      ["maintenance", maintQ],
    ] as const) {
      try {
        const counts = await q.getJobCounts("waiting", "active", "delayed", "failed");
        stats[name] = counts;
        if ((counts.waiting ?? 0) > 500) {
          console.warn(`[${WORKER_TAG}] ⚠ Queue lag: ${name} has ${counts.waiting} waiting jobs`);
        }
        if ((counts.failed ?? 0) > 50) {
          console.warn(`[${WORKER_TAG}] ⚠ Queue failures: ${name} has ${counts.failed} failed jobs`);
        }
      } catch (qErr: any) {
        stats[name] = { error: qErr?.message };
      }
    }
    return { queueStats: stats };
  } catch (err: any) {
    console.warn(`[${WORKER_TAG}] queue_health_check error: ${err?.message}`);
    return { queueStats: stats };
  }
}

async function handleRescoreStale(): Promise<{ rescored: number }> {
  try {
    // Find contacts whose scores are expired or missing
    const staleRows = await db.execute<{ id: number; sub_account_id: number }>(sql`
      SELECT c.id, c.sub_account_id
        FROM contacts c
        LEFT JOIN contact_scores cs ON cs.contact_id = c.id
        WHERE c.is_placeholder = false
          AND (cs.id IS NULL OR cs.expires_at < now())
        LIMIT 200
    `);

    const scoringQueue = getScoringQueue();
    let queued = 0;
    for (const row of staleRows.rows) {
      try {
        await scoringQueue.add(`score:${row.id}`, {
          contactId: row.id,
          subAccountId: row.sub_account_id,
        }, {
          jobId:    `score-${row.id}`,
          attempts:  2,
          removeOnComplete: { count: 200 },
        });
        queued++;
      } catch { // allow-silent-catch: individual job enqueue failure is non-fatal
      }
    }
    if (queued > 0) console.log(`[${WORKER_TAG}] Queued ${queued} contacts for rescore`);
    return { rescored: queued };
  } catch (err: any) {
    console.warn(`[${WORKER_TAG}] rescore_stale error: ${err?.message}`);
    return { rescored: 0 };
  }
}

// ── Worker factory ────────────────────────────────────────────────────────────

let _worker: Worker | null = null;
let _schedulerHandles: NodeJS.Timeout[] = [];

export function startMaintenanceWorker(): void {
  if (_worker) return;

  _worker = new Worker<MaintenanceJobData>(
    QUEUE_NAMES.MAINTENANCE,
    async (job) => {
      const start = Date.now();
      console.log(`[${WORKER_TAG}] Processing job=${job.id} type=${job.data.jobType}`);
      let result: Record<string, unknown> = {};

      switch (job.data.jobType) {
        case "expire_opportunities": result = await handleExpireOpportunities();  break;
        case "expire_legal_leads":   result = await handleExpireLegalLeads();     break;
        case "age_placeholders":     result = await handleAgePlaceholders();       break;
        case "queue_health_check":   result = await handleQueueHealthCheck();      break;
        case "rescore_stale":        result = await handleRescoreStale();          break;
        case "prune_dead_jobs":      /* no-op for now — BullMQ auto-prunes via removeOnComplete/removeOnFail */
                                     result = { pruned: 0 };                      break;
        default:
          console.warn(`[${WORKER_TAG}] Unknown job type: ${(job.data as any).jobType}`);
      }

      console.log(`[${WORKER_TAG}] ✓ job=${job.id} type=${job.data.jobType} latency=${Date.now() - start}ms`);
      return result;
    },
    {
      connection:  getBullMQConnection(),
      concurrency: MAX_MAINTENANCE_CONCURRENCY,
    }
  );

  _worker.on("failed", (job, err) => {
    console.error(`[${WORKER_TAG}] Job ${job?.id} failed: ${err?.message}`);
  });
  attachCircuitBreaker(_worker, WORKER_TAG);

  // ── Scheduled maintenance (no external cron dependency) ──────────────────────

  // Every 15 min: expire opportunities and legal leads
  // allow-silent-catch: scheduled enqueue failure is logged inside enqueueMaintenanceJob — swallow here to keep setInterval alive
  _schedulerHandles.push(setInterval(() => {
    enqueueMaintenanceJob({ jobType: "expire_opportunities" }).catch(() => {}); // allow-silent-catch: logged inside enqueueMaintenanceJob
    enqueueMaintenanceJob({ jobType: "expire_legal_leads" }).catch(() => {}); // allow-silent-catch: logged inside enqueueMaintenanceJob
  }, 15 * 60 * 1000));

  // Every 1 hr: placeholder aging alert + queue health
  _schedulerHandles.push(setInterval(() => {
    enqueueMaintenanceJob({ jobType: "age_placeholders" }).catch(() => {}); // allow-silent-catch: logged inside enqueueMaintenanceJob
    enqueueMaintenanceJob({ jobType: "queue_health_check" }).catch(() => {}); // allow-silent-catch: logged inside enqueueMaintenanceJob
  }, 60 * 60 * 1000));

  // Every 6 hr: rescore stale contacts
  _schedulerHandles.push(setInterval(() => {
    enqueueMaintenanceJob({ jobType: "rescore_stale" }).catch(() => {}); // allow-silent-catch: logged inside enqueueMaintenanceJob
  }, 6 * 60 * 60 * 1000));

  // Run initial checks after 2 min startup delay
  setTimeout(() => {
    enqueueMaintenanceJob({ jobType: "expire_opportunities" }).catch(() => {}); // allow-silent-catch: logged inside enqueueMaintenanceJob
    enqueueMaintenanceJob({ jobType: "queue_health_check" }).catch(() => {}); // allow-silent-catch: logged inside enqueueMaintenanceJob
  }, 2 * 60 * 1000);

  console.log(`[${WORKER_TAG}] Started — scheduled maintenance active`);
}

export async function stopMaintenanceWorker(): Promise<void> {
  for (const handle of _schedulerHandles) clearInterval(handle);
  _schedulerHandles = [];
  if (!_worker) return;
  await _worker.close();
  _worker = null;
  console.log(`[${WORKER_TAG}] Stopped`);
}
