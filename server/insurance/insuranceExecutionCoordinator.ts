/**
 * server/insurance/insuranceExecutionCoordinator.ts
 *
 * Insurance Execution Coordinator
 *
 * Single entry point for executing any approved insurance workflow.
 * Routes by workflow type → channel adapter → transport.
 *
 * Callers:
 *   - POST /api/insurance/execute-workflow/:id  (admin-triggered)
 *   - Future: scheduled executor cron (once Phase 9 cron wiring is complete)
 *
 * This coordinator does NOT call assertApproved() itself — each transport
 * adapter calls it as its own first line. This ensures the gate runs
 * immediately before the channel fires, not at scheduling time.
 *
 * Execution flow:
 *   1. Read workflow type from DB
 *   2. Resolve channel (SMS / email / voice) by type
 *   3. Dispatch to adapter
 *   4. Return TransportResult — adapter has already marked executed/failed
 *
 * Bulk execution:
 *   executeApprovedBatch() runs all approved-and-due workflows for an agency,
 *   respecting per-run limits and inter-message delays to avoid carrier spam
 *   flags. It never sends more than MAX_BATCH_PER_RUN in a single sweep.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { esc, num } from "../hpl/sqlSafe";
import {
  channelForWorkflowType,
  sendInsuranceSms,
  sendInsuranceEmail,
  sendInsuranceVoice,
  type TransportResult,
} from "./insuranceTransportAdapters";
import { runPreExecutionValidation } from "./insuranceWorkflowCoordinator";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum workflows executed in a single batch sweep. */
const MAX_BATCH_PER_RUN = 20;

/** Minimum milliseconds between sends within a batch sweep (anti-spam). */
const INTER_SEND_DELAY_MS = 400;

// ── Single workflow execution ─────────────────────────────────────────────────

export interface ExecuteWorkflowOptions {
  workflowId:    number;
  callerAgencyId: number;
  subAccountId:  number;
  baseUrl?:      string;
  minScore?:     number;
  channelOverride?: "sms" | "email" | "voice";
}

/**
 * Execute a single approved workflow.
 * Returns TransportResult from the adapter — check result.ok before trusting delivery.
 */
export async function executeInsuranceWorkflow(
  opts: ExecuteWorkflowOptions,
): Promise<TransportResult> {
  // Resolve the workflow type so we can pick the right channel
  let workflowType: string | null = null;
  try {
    const result = await db.execute(sql.raw(`
      SELECT workflow_type FROM _ins_workflow_queue
      WHERE id = ${num(opts.workflowId)} LIMIT 1
    `));
    const rows = (result as any).rows ?? result;
    workflowType = Array.isArray(rows) && rows[0] ? String(rows[0].workflow_type) : null;
  } catch (err: any) {
    return {
      ok:         false,
      channel:    "sms",
      workflowId: opts.workflowId,
      error:      `db_error: ${err?.message}`,
    };
  }

  if (!workflowType) {
    return {
      ok:         false,
      channel:    "sms",
      workflowId: opts.workflowId,
      error:      "workflow_not_found",
    };
  }

  const channel = opts.channelOverride ?? channelForWorkflowType(workflowType);

  const adapterOpts = {
    workflowId:    opts.workflowId,
    callerAgencyId: opts.callerAgencyId,
    subAccountId:  opts.subAccountId,
    minScore:      opts.minScore,
    baseUrl:       opts.baseUrl,
  };

  switch (channel) {
    case "email": return sendInsuranceEmail(adapterOpts);
    case "voice": return sendInsuranceVoice(adapterOpts);
    case "sms":
    default:      return sendInsuranceSms(adapterOpts);
  }
}

// ── Batch execution ───────────────────────────────────────────────────────────

export interface BatchExecutionOptions {
  callerAgencyId: number;
  subAccountId:   number;
  baseUrl?:       string;
  minScore?:      number;
  maxPerRun?:     number;
  /** Run pre-execution score sweep before sending (recommended: true) */
  runPreExecSweep?: boolean;
}

export interface BatchExecutionResult {
  attempted:  number;
  succeeded:  number;
  failed:     number;
  gateBlocked: number;
  results:    TransportResult[];
  preExecCancelled?: number;
}

/**
 * Execute all approved-and-due workflows for an agency in a single sweep.
 * Safe to call from a cron or admin trigger.
 */
export async function executeApprovedBatch(
  opts: BatchExecutionOptions,
): Promise<BatchExecutionResult> {
  const {
    callerAgencyId,
    subAccountId,
    baseUrl,
    minScore = 30,
    maxPerRun = MAX_BATCH_PER_RUN,
    runPreExecSweep = true,
  } = opts;

  let preExecCancelled = 0;

  // Step 1: optional pre-exec score sweep — cleans up stale/low-score workflows
  if (runPreExecSweep) {
    try {
      const sweepResult = await runPreExecutionValidation({ minScore, agencyId: callerAgencyId });
      preExecCancelled = sweepResult.cancelled;
    } catch (err: any) {
      console.warn("[INS-EXEC] Pre-exec sweep failed:", err?.message);
    }
  }

  // Step 2: fetch approved-and-due workflows for this agency
  let workflows: Array<{ id: number; workflow_type: string }> = [];
  try {
    const result = await db.execute(sql.raw(`
      SELECT id, workflow_type
      FROM _ins_workflow_queue
      WHERE status = 'approved'
        AND agency_id = ${num(callerAgencyId)}
        AND scheduled_at <= NOW()
        AND approval_required = TRUE
        AND approved_at IS NOT NULL
        AND approved_by IS NOT NULL
        AND approved_by NOT IN ('system', 'auto', '')
      ORDER BY scheduled_at ASC
      LIMIT ${num(maxPerRun)}
    `));
    const rows = (result as any).rows ?? result;
    workflows = Array.isArray(rows) ? rows : [];
  } catch (err: any) {
    console.error("[INS-EXEC] Batch fetch failed:", err?.message);
    return { attempted: 0, succeeded: 0, failed: 0, gateBlocked: 0, results: [], preExecCancelled };
  }

  console.log(`[INS-EXEC] Batch: ${workflows.length} approved workflows for agency#${callerAgencyId}`);

  const results: TransportResult[] = [];
  let succeeded = 0, failed = 0, gateBlocked = 0;

  for (const wf of workflows) {
    const result = await executeInsuranceWorkflow({
      workflowId:    wf.id,
      callerAgencyId,
      subAccountId,
      baseUrl,
      minScore,
    });

    results.push(result);

    if (result.ok) {
      succeeded++;
    } else if (result.gateCode) {
      gateBlocked++;
      console.warn(`[INS-EXEC] Gate blocked wf#${wf.id}: ${result.gateCode} — ${result.error}`);
    } else {
      failed++;
      console.error(`[INS-EXEC] Send failed wf#${wf.id}: ${result.error}`);
    }

    // Inter-send delay — prevent carrier rate-limit blocks
    if (workflows.indexOf(wf) < workflows.length - 1) {
      await new Promise(resolve => setTimeout(resolve, INTER_SEND_DELAY_MS));
    }
  }

  console.log(`[INS-EXEC] Batch done: ${succeeded} sent, ${failed} failed, ${gateBlocked} gate-blocked, ${preExecCancelled} pre-cancelled`);

  return {
    attempted:  workflows.length,
    succeeded,
    failed,
    gateBlocked,
    results,
    preExecCancelled,
  };
}
