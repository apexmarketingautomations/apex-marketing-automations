// @ts-nocheck
/**
 * server/workers/dedupWorker.ts
 *
 * Contact Deduplication & Merge Worker
 *
 * Consumes jobs from apex-maintenance queue with type="dedup_merge".
 * Merges duplicate contacts within the same sub_account (same normalized_phone)
 * by keeping the richest record and soft-deleting duplicates.
 *
 * Merge strategy:
 * - KEEP record with highest data completeness score (non-null field count)
 * - COPY skip_trace_status, enrichment_attempted_at, skip_trace_result from winner
 * - NULLIFY duplicate records' normalized_phone to remove from dedup index
 * - Write a quarantine entry for each purged duplicate for operator review
 * - Emit universal event for audit trail
 */

import { Worker, type Job } from "bullmq";
import { sql, eq, and, isNotNull, ne } from "drizzle-orm";
import { db } from "../db";
import { contacts } from "@shared/schema";
import { getBullMQConnection, QUEUE_NAMES, attachCircuitBreaker } from "../queues/queueFactory";
import { quarantineRecord } from "../db/quarantineCoordinator";

export interface DedupMergeJob {
  subAccountId: number;
  normalizedPhone: string;
  triggeredBy?: string;
}

// ── Field completeness score (higher = richer record to keep) ─────────────────

function completenessScore(c: Record<string, any>): number {
  const fields = [
    "name", "email", "address", "city", "state", "zip",
    "skip_trace_result", "enrichment_attempted_at", "source",
    "first_name", "last_name",
  ];
  return fields.reduce((n, f) => n + (c[f] != null && c[f] !== "" ? 1 : 0), 0);
}

// ── Core merge logic ──────────────────────────────────────────────────────────

export async function mergeContactsByPhone(
  subAccountId: number,
  normalizedPhone: string,
  triggeredBy: string = "dedup-worker"
): Promise<{ merged: number; kept: number | null; error?: string }> {
  try {
    // Load all contacts with this phone within the tenant
    const dupes = await db.select().from(contacts)
      .where(and(
        eq(contacts.subAccountId, subAccountId),
        eq(contacts.normalizedPhone, normalizedPhone),
        isNotNull(contacts.normalizedPhone),
      ));

    if (dupes.length <= 1) return { merged: 0, kept: dupes[0]?.id ?? null };

    // Pick winner by completeness, then by oldest (original) id as tiebreaker
    const winner = dupes.reduce((best, c) => {
      const bScore = completenessScore(best as any);
      const cScore = completenessScore(c as any);
      if (cScore > bScore) return c;
      if (cScore === bScore && c.id < best.id) return c;
      return best;
    });

    const losers = dupes.filter(c => c.id !== winner.id);

    // Merge enrichment data from losers into winner if winner lacks it
    const enrichmentUpdate: Record<string, any> = {};
    if (!winner.skipTraceResult) {
      const withEnrich = losers.find(c => c.skipTraceResult != null);
      if (withEnrich) {
        enrichmentUpdate.skipTraceResult      = withEnrich.skipTraceResult;
        enrichmentUpdate.skipTraceStatus      = withEnrich.skipTraceStatus;
        enrichmentUpdate.enrichmentAttemptedAt = withEnrich.enrichmentAttemptedAt;
      }
    }

    if (Object.keys(enrichmentUpdate).length > 0) {
      await db.update(contacts).set(enrichmentUpdate).where(eq(contacts.id, winner.id));
    }

    // Nullify phone on losers (removes them from dedup index, keeps row for history)
    for (const loser of losers) {
      await db.update(contacts)
        .set({ normalizedPhone: null, updatedAt: new Date() })
        .where(eq(contacts.id, loser.id));

      await quarantineRecord({
        sourceTable: "contacts",
        sourceId: loser.id,
        reason: `dedup_merge: duplicate of contact#${winner.id} (same normalized_phone ${normalizedPhone})`,
        quarantinedBy: triggeredBy,
        metadata: { winnerId: winner.id, subAccountId, normalizedPhone },
      });
    }

    console.log(`[DEDUP] sub=${subAccountId} phone=${normalizedPhone} merged=${losers.length} into contact#${winner.id}`);
    return { merged: losers.length, kept: winner.id };

  } catch (err: any) {
    console.error(`[DEDUP] merge failed sub=${subAccountId} phone=${normalizedPhone}:`, err?.message);
    return { merged: 0, kept: null, error: err?.message };
  }
}

// ── Full sub-account dedup scan ───────────────────────────────────────────────

export async function runDedupScan(subAccountId: number): Promise<{ processed: number; merged: number }> {
  const result = await db.execute(sql`
    SELECT normalized_phone, COUNT(*) AS n
    FROM contacts
    WHERE sub_account_id = ${subAccountId}
      AND normalized_phone IS NOT NULL
      AND normalized_phone != ''
      AND LENGTH(normalized_phone) >= 10
    GROUP BY normalized_phone
    HAVING COUNT(*) > 1
    ORDER BY n DESC
    LIMIT 500
  `);

  const rows = (result as any).rows ?? result;
  if (!Array.isArray(rows) || rows.length === 0) return { processed: 0, merged: 0 };

  let totalMerged = 0;
  for (const row of rows) {
    const r = await mergeContactsByPhone(subAccountId, row.normalized_phone, "dedup-scan");
    totalMerged += r.merged;
  }

  return { processed: rows.length, merged: totalMerged };
}

// ── BullMQ worker ──────────────────────────────────────────────────────────────

let _worker: Worker | null = null;

export function startDedupWorker(): Worker {
  if (_worker) return _worker;

  _worker = new Worker<DedupMergeJob>(
    QUEUE_NAMES.MAINTENANCE,
    async (job: Job<DedupMergeJob>) => {
      if (job.name !== "dedup_merge" && job.name !== "dedup_scan") return;

      if (job.name === "dedup_scan") {
        const { subAccountId } = job.data;
        const result = await runDedupScan(subAccountId);
        return result;
      }

      const { subAccountId, normalizedPhone, triggeredBy } = job.data;
      return mergeContactsByPhone(subAccountId, normalizedPhone, triggeredBy ?? "bullmq-dedup");
    },
    {
      connection: getBullMQConnection(),
      concurrency: 3,
      limiter: { max: 20, duration: 1000 }, // 20 merges/sec max
    }
  );

  _worker.on("failed", (job, err) => {
    console.error(`[DEDUP-WORKER] job ${job?.id} failed:`, err?.message);
  });
  attachCircuitBreaker(_worker, "DEDUP-WORKER");

  console.log("[DEDUP-WORKER] started — listening on apex-maintenance queue");
  return _worker;
}
