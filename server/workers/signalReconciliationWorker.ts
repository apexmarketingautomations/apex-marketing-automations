// @ts-nocheck
/**
 * server/workers/signalReconciliationWorker.ts
 *
 * Signal Reconciliation Auto-Repair Worker  (Phase 3)
 *
 * Runs on a schedule via apex-maintenance queue. Reads detected issues from
 * reconciliationEngine and automatically repairs the ones that are safe to
 * auto-repair without operator intervention:
 *
 *   SAFE TO AUTO-REPAIR:
 *   - stale_enrichment_pending  → reset skip_trace_status to null + re-enqueue
 *   - stuck_crash_reports       → reset status to PENDING
 *
 *   OPERATOR-REQUIRED (quarantine + alert, do NOT auto-repair):
 *   - contacts_without_tenant   → quarantine + flag for operator
 *   - duplicate_contacts        → enqueue dedup_merge job
 *   - orphaned_case_signals     → quarantine
 */

import { Worker, Queue, type Job } from "bullmq";
import { sql, eq, and, lt, isNull } from "drizzle-orm";
import { db } from "../db";
import { contacts } from "@shared/schema";
import { getBullMQConnection, QUEUE_NAMES } from "../queues/queueFactory";
import { runReconciliationScan, type ReconciliationIssue } from "../db/reconciliationEngine";
import { quarantineRecord } from "../db/quarantineCoordinator";

export interface ReconciliationRepairJob {
  triggeredBy?: string;
  dryRun?: boolean;
}

export interface RepairResult {
  category:    string;
  action:      "auto_repaired" | "quarantined" | "enqueued" | "skipped";
  affectedCount: number;
  detail?:     string;
}

// ── Repair handlers ───────────────────────────────────────────────────────────

async function repairStaleEnrichment(issue: ReconciliationIssue, dryRun: boolean): Promise<RepairResult> {
  if (dryRun) return { category: issue.category, action: "auto_repaired", affectedCount: issue.affectedCount, detail: "dry-run" };

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await db.execute(sql`
    UPDATE contacts
    SET skip_trace_status = NULL, updated_at = NOW()
    WHERE skip_trace_status = 'pending'
      AND enrichment_attempted_at < ${cutoff.toISOString()}
  `);
  const affected = (result as any).rowCount ?? (result as any).count ?? issue.affectedCount;

  // Re-enqueue via enrichment queue
  const enrichQueue = new Queue(QUEUE_NAMES.ENRICHMENT, { connection: getBullMQConnection() });
  await enrichQueue.add("retro_enrich_stale", { reason: "stale_enrichment_repair", cutoff: cutoff.toISOString() }, { priority: 5 });
  await enrichQueue.close();

  console.log(`[RECONCILIATION-REPAIR] stale_enrichment: reset ${affected} contacts to null skip_trace_status`);
  return { category: issue.category, action: "auto_repaired", affectedCount: Number(affected) };
}

async function repairStuckCrashReports(issue: ReconciliationIssue, dryRun: boolean): Promise<RepairResult> {
  if (dryRun) return { category: issue.category, action: "auto_repaired", affectedCount: issue.affectedCount, detail: "dry-run" };

  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const result = await db.execute(sql.raw(`
    UPDATE crash_reports
    SET status = 'PENDING', updated_at = NOW()
    WHERE status = 'PROCESSING'
      AND updated_at < '${cutoff.toISOString()}'
  `));
  const affected = (result as any).rowCount ?? issue.affectedCount;
  console.log(`[RECONCILIATION-REPAIR] stuck_crash_reports: reset ${affected} to PENDING`);
  return { category: issue.category, action: "auto_repaired", affectedCount: Number(affected) };
}

async function quarantineContactsWithoutTenant(issue: ReconciliationIssue, dryRun: boolean): Promise<RepairResult> {
  if (dryRun) return { category: issue.category, action: "quarantined", affectedCount: issue.affectedCount, detail: "dry-run" };

  const result = await db.execute(sql`SELECT id FROM contacts WHERE sub_account_id IS NULL LIMIT 200`);
  const rows = (result as any).rows ?? result;
  let count = 0;
  if (Array.isArray(rows)) {
    for (const row of rows) {
      await quarantineRecord({
        sourceTable: "contacts",
        sourceId: Number(row.id),
        reason: "contacts_without_tenant: null sub_account_id at reconciliation scan",
        quarantinedBy: "reconciliation-worker",
        metadata: { detectedAt: new Date().toISOString() },
      });
      count++;
    }
  }
  console.log(`[RECONCILIATION-REPAIR] contacts_without_tenant: quarantined ${count} contacts`);
  return { category: issue.category, action: "quarantined", affectedCount: count };
}

async function enqueueDedupMerge(issue: ReconciliationIssue, dryRun: boolean): Promise<RepairResult> {
  if (dryRun) return { category: issue.category, action: "enqueued", affectedCount: issue.affectedCount, detail: "dry-run" };

  const maintenanceQueue = new Queue(QUEUE_NAMES.MAINTENANCE, { connection: getBullMQConnection() });
  // Enqueue bulk scans per affected sub-account
  const result = await db.execute(sql`
    SELECT DISTINCT sub_account_id FROM contacts
    WHERE normalized_phone IS NOT NULL
      AND normalized_phone != ''
    GROUP BY sub_account_id, normalized_phone
    HAVING COUNT(*) > 1
    LIMIT 50
  `);
  const rows = (result as any).rows ?? result;
  let enqueued = 0;
  if (Array.isArray(rows)) {
    const uniqueAccounts = [...new Set(rows.map((r: any) => Number(r.sub_account_id)))];
    for (const subAccountId of uniqueAccounts) {
      await maintenanceQueue.add("dedup_scan", { subAccountId, triggeredBy: "reconciliation-worker" }, { priority: 3 });
      enqueued++;
    }
  }
  await maintenanceQueue.close();
  console.log(`[RECONCILIATION-REPAIR] duplicate_contacts: enqueued ${enqueued} dedup_scan jobs`);
  return { category: issue.category, action: "enqueued", affectedCount: enqueued };
}

async function quarantineOrphanedCaseSignals(issue: ReconciliationIssue, dryRun: boolean): Promise<RepairResult> {
  if (dryRun) return { category: issue.category, action: "quarantined", affectedCount: issue.affectedCount, detail: "dry-run" };

  const result = await db.execute(sql`
    SELECT cs.id FROM case_signals cs
    WHERE NOT EXISTS (SELECT 1 FROM intelligence_cases ic WHERE ic.id = cs.case_id)
    LIMIT 100
  `);
  const rows = (result as any).rows ?? result;
  let count = 0;
  if (Array.isArray(rows)) {
    for (const row of rows) {
      await quarantineRecord({
        sourceTable: "case_signals",
        sourceId: Number(row.id),
        reason: "orphaned_case_signals: parent intelligence_case deleted",
        quarantinedBy: "reconciliation-worker",
        metadata: { detectedAt: new Date().toISOString() },
      });
      count++;
    }
  }
  return { category: issue.category, action: "quarantined", affectedCount: count };
}

// ── Main repair runner ────────────────────────────────────────────────────────

export async function runReconciliationRepair(
  triggeredBy: string = "scheduled",
  dryRun: boolean = false
): Promise<{ results: RepairResult[]; issuesFound: number; repaired: number }> {
  const scan = await runReconciliationScan();

  if (scan.issues.length === 0) {
    console.log("[RECONCILIATION-REPAIR] no issues found — nothing to repair");
    return { results: [], issuesFound: 0, repaired: 0 };
  }

  const results: RepairResult[] = [];

  for (const issue of scan.issues) {
    let result: RepairResult;
    try {
      switch (issue.category) {
        case "stale_enrichment_pending":
          result = await repairStaleEnrichment(issue, dryRun);
          break;
        case "stuck_crash_reports":
          result = await repairStuckCrashReports(issue, dryRun);
          break;
        case "contacts_without_tenant":
          result = await quarantineContactsWithoutTenant(issue, dryRun);
          break;
        case "duplicate_contacts_by_phone":
          result = await enqueueDedupMerge(issue, dryRun);
          break;
        case "orphaned_case_signals":
          result = await quarantineOrphanedCaseSignals(issue, dryRun);
          break;
        default:
          result = { category: issue.category, action: "skipped", affectedCount: issue.affectedCount, detail: "no auto-repair available" };
      }
    } catch (err: any) {
      result = { category: issue.category, action: "skipped", affectedCount: 0, detail: `error: ${err?.message}` };
      console.error(`[RECONCILIATION-REPAIR] error repairing ${issue.category}:`, err?.message);
    }
    results.push(result);
  }

  const repaired = results.filter(r => r.action !== "skipped").reduce((n, r) => n + r.affectedCount, 0);
  return { results, issuesFound: scan.issues.length, repaired };
}

// ── BullMQ worker ──────────────────────────────────────────────────────────────

let _worker: Worker | null = null;

export function startSignalReconciliationWorker(): Worker {
  if (_worker) return _worker;

  _worker = new Worker<ReconciliationRepairJob>(
    QUEUE_NAMES.MAINTENANCE,
    async (job: Job<ReconciliationRepairJob>) => {
      if (job.name !== "reconciliation_repair") return;
      return runReconciliationRepair(job.data.triggeredBy ?? "bullmq", job.data.dryRun ?? false);
    },
    { connection: getBullMQConnection(), concurrency: 1 }
  );

  _worker.on("failed", (job, err) => {
    console.error(`[RECONCILIATION-WORKER] job ${job?.id} failed:`, err?.message);
  });

  console.log("[RECONCILIATION-WORKER] started — listening on apex-maintenance queue");
  return _worker;
}
