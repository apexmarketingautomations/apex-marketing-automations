/**
 * server/workers/routingWorker.ts
 *
 * BullMQ Worker consuming the `apex-routing` queue.
 *
 * Routing decisions:
 *   assign_territory  — match a contact/incident to a territory
 *   route_contact     — assign contact to best-fit sub-account / PI / operator
 *   score_and_route   — score then immediately route (compound job)
 *   export_lead       — mark contact export-eligible and emit export event
 *
 * Design:
 *   - Idempotent: skips if contact already in correct state
 *   - Priority: concurrency = 5 (routing is lightweight DB work)
 *   - Observable: structured stdout logs for Axiom pickup
 */

import { Worker, Job } from "bullmq";
import { db } from "../db";
import { contacts } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { getBullMQConnection, QUEUE_NAMES, getRoutingQueue, getScoringQueue } from "../queues/queueFactory";
import { logSystemEvent } from "../systemLogger";

const WORKER_TAG  = "ROUTING-WORKER";
const MAX_CONCURRENCY = 5;

// ── Job payload ───────────────────────────────────────────────────────────────

export type RoutingJobType =
  | "assign_territory"
  | "route_contact"
  | "score_and_route"
  | "export_lead";

export interface RoutingJobData {
  jobType: RoutingJobType;
  contactId: number;
  subAccountId: number;
  /** Override target territory */
  territoryId?: number;
  /** Force re-route even if already routed */
  force?: boolean;
}

// ── Enqueue helper ────────────────────────────────────────────────────────────

export async function enqueueRoutingJob(data: RoutingJobData): Promise<string | undefined> {
  try {
    const queue  = getRoutingQueue();
    const jobKey = `route-${data.jobType}-${data.contactId}`;
    const job    = await queue.add(`routing:${data.jobType}:${data.contactId}`, data, {
      jobId:    jobKey,
      attempts:  3,
      backoff:   { type: "exponential", delay: 3_000 },
      removeOnComplete: { count: 500 },
      removeOnFail:     { count: 200 },
    });
    return job.id;
  } catch (err: any) {
    console.warn(`[${WORKER_TAG}] Failed to enqueue routing job contact=${data.contactId}: ${err?.message}`);
    return undefined;
  }
}

// ── Job handlers ──────────────────────────────────────────────────────────────

async function handleAssignTerritory(
  job: Job<RoutingJobData>
): Promise<{ assigned: boolean; territoryId: number | null }> {
  const { contactId, territoryId: forcedTerritory } = job.data;

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contact) throw new Error(`Contact ${contactId} not found`);

  // If caller explicitly supplies a territory, use it
  if (forcedTerritory) {
    await db.update(contacts)
      .set({ territoryId: forcedTerritory })
      .where(eq(contacts.id, contactId));
    console.log(`[${WORKER_TAG}] ✓ assign_territory contact=${contactId} territory=${forcedTerritory} (forced)`);
    return { assigned: true, territoryId: forcedTerritory };
  }

  // Auto-match by county if territories table is populated
  try {
    const rows = await db.execute<{ id: number }>(sql`
      SELECT t.id
        FROM territories t
        WHERE t.sub_account_id = ${contact.subAccountId}
          AND t.is_active = true
          AND (
            ${contact.county} = ANY(t.identifiers)
            OR t.identifier = ${contact.county}
          )
        ORDER BY t.id
        LIMIT 1
    `);

    const matched = rows.rows[0]?.id ?? null;
    if (matched) {
      await db.update(contacts)
        .set({ territoryId: matched })
        .where(eq(contacts.id, contactId));
      console.log(`[${WORKER_TAG}] ✓ assign_territory contact=${contactId} territory=${matched} (county=${contact.county})`);
    } else {
      console.log(`[${WORKER_TAG}] assign_territory contact=${contactId} — no territory matched county=${contact.county}`);
    }
    return { assigned: !!matched, territoryId: matched };
  } catch (err: any) {
    // allow-silent-catch: territories table may not exist yet — non-fatal
    console.warn(`[${WORKER_TAG}] Territory lookup failed: ${err?.message}`);
    return { assigned: false, territoryId: null };
  }
}

async function handleRouteContact(
  job: Job<RoutingJobData>
): Promise<{ routed: boolean; workflowStage: string }> {
  const { contactId, force } = job.data;

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contact) throw new Error(`Contact ${contactId} not found`);

  // Idempotency: skip if already routed (unless forced)
  if (!force && contact.workflowStage === "routed") {
    console.log(`[${WORKER_TAG}] Contact ${contactId} already routed — skipping`);
    return { routed: false, workflowStage: "routed" };
  }

  // Must be non-placeholder and scored to route
  if (contact.isPlaceholder) {
    console.log(`[${WORKER_TAG}] Contact ${contactId} is still placeholder — cannot route`);
    return { routed: false, workflowStage: contact.workflowStage ?? "new" };
  }

  const qualityScore = contact.contactQualityScore ?? 0;
  const stage = qualityScore >= 55 ? "routed" : "scored";

  await db.update(contacts)
    .set({
      workflowStage:  stage,
      exportEligible: qualityScore >= 55,
    })
    .where(eq(contacts.id, contactId));

  if (stage === "routed") {
    try {
      logSystemEvent("info", "routing-worker", `Contact ${contactId} routed`, {
        contactId,
        subAccountId: contact.subAccountId,
        score: qualityScore,
      });
    } catch { // allow-silent-catch: logging failure is non-fatal
    }
  }

  console.log(`[${WORKER_TAG}] ✓ route_contact contact=${contactId} stage=${stage} score=${qualityScore}`);
  return { routed: stage === "routed", workflowStage: stage };
}

async function handleScoreAndRoute(
  job: Job<RoutingJobData>
): Promise<{ queued: boolean }> {
  const { contactId, subAccountId } = job.data;

  // Enqueue scoring job — scoring worker will update contact and we'll re-route after
  try {
    const scoringQueue = getScoringQueue();
    await scoringQueue.add(`score:${contactId}`, { contactId, subAccountId, force: false }, {
      jobId:    `score-${contactId}`,
      attempts:  2,
      removeOnComplete: { count: 200 },
    });

    // Enqueue a follow-up route_contact job (delayed 5s to allow scoring to complete)
    const routingQueue = getRoutingQueue();
    await routingQueue.add(`routing:route_contact:${contactId}`, {
      jobType: "route_contact" as const,
      contactId,
      subAccountId,
    }, {
      jobId:   `route-route_contact-${contactId}-after-score`,
      delay:    5_000,
      attempts: 2,
      removeOnComplete: { count: 200 },
    });

    console.log(`[${WORKER_TAG}] ✓ score_and_route contact=${contactId} — queued scoring + delayed routing`);
    return { queued: true };
  } catch (err: any) {
    console.warn(`[${WORKER_TAG}] score_and_route enqueue error: ${err?.message}`);
    return { queued: false };
  }
}

async function handleExportLead(
  job: Job<RoutingJobData>
): Promise<{ exported: boolean }> {
  const { contactId } = job.data;

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contact) throw new Error(`Contact ${contactId} not found`);

  if (!contact.exportEligible) {
    console.log(`[${WORKER_TAG}] Contact ${contactId} not export-eligible — skipping export`);
    return { exported: false };
  }

  // Mark as exported in workflow stage
  await db.update(contacts)
    .set({ workflowStage: "exported" })
    .where(eq(contacts.id, contactId));

  console.log(`[${WORKER_TAG}] ✓ export_lead contact=${contactId}`);
  return { exported: true };
}

// ── Worker factory ────────────────────────────────────────────────────────────

let _worker: Worker | null = null;

export function startRoutingWorker(): void {
  if (_worker) return;

  _worker = new Worker<RoutingJobData>(
    QUEUE_NAMES.ROUTING,
    async (job) => {
      const start = Date.now();
      console.log(`[${WORKER_TAG}] Processing job=${job.id} type=${job.data.jobType} contact=${job.data.contactId}`);

      let result: Record<string, unknown>;
      switch (job.data.jobType) {
        case "assign_territory":  result = await handleAssignTerritory(job);  break;
        case "route_contact":     result = await handleRouteContact(job);      break;
        case "score_and_route":   result = await handleScoreAndRoute(job);     break;
        case "export_lead":       result = await handleExportLead(job);        break;
        default:
          console.warn(`[${WORKER_TAG}] Unknown job type: ${(job.data as any).jobType}`);
          result = {};
      }

      console.log(`[${WORKER_TAG}] ✓ job=${job.id} type=${job.data.jobType} latency=${Date.now() - start}ms`);
      return result;
    },
    {
      connection:  getBullMQConnection(),
      concurrency: MAX_CONCURRENCY,
    }
  );

  _worker.on("failed", (job, err) => {
    console.error(`[${WORKER_TAG}] Job ${job?.id} failed: ${err?.message}`);
  });

  console.log(`[${WORKER_TAG}] Started — concurrency=${MAX_CONCURRENCY} queue=${QUEUE_NAMES.ROUTING}`);
}

export async function stopRoutingWorker(): Promise<void> {
  if (!_worker) return;
  await _worker.close();
  _worker = null;
  console.log(`[${WORKER_TAG}] Stopped`);
}
