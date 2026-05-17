/**
 * server/insurance/insuranceApprovalGate.ts
 *
 * Transport-Layer Approval Gate
 *
 * Every communication channel (SMS, voice, email, iMessage, webhook) that
 * originates from an insurance workflow MUST pass through `assertApproved()`
 * before any payload is handed to a transport adapter.
 *
 * Contract enforced here:
 *   1. approval_required = TRUE
 *   2. approved_at IS NOT NULL
 *   3. approved_by IS NOT NULL (named actor — not "system")
 *   4. Pre-execution opportunity score re-check (score still ≥ threshold)
 *   5. Suppression re-check (household not opted out)
 *   6. Tenant ownership re-check (workflow belongs to caller's agency)
 *   7. Staleness cancel (workflow > 7 days old with no approval → auto-cancel)
 *
 * On any gate failure this throws `ApprovalGateError` — callers MUST NOT
 * catch-and-continue; they should let it propagate so the transport adapter
 * never fires.
 *
 * Audit log: every call (pass or fail) is written to `_ins_approval_audit`.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool } from "../hpl/sqlSafe";
import { randomUUID } from "crypto";

// ── Custom error ──────────────────────────────────────────────────────────────

export class ApprovalGateError extends Error {
  constructor(
    public readonly code: ApprovalGateCode,
    message: string,
    public readonly workflowId: number,
  ) {
    super(`[APPROVAL_GATE:${code}] wf#${workflowId} — ${message}`);
    this.name = "ApprovalGateError";
  }
}

export type ApprovalGateCode =
  | "APPROVAL_NOT_REQUIRED_FLAG_MISSING"  // approval_required = FALSE
  | "NOT_APPROVED"                          // approved_at IS NULL
  | "APPROVER_MISSING"                      // approved_by IS NULL or 'system'
  | "SCORE_BELOW_THRESHOLD"                // opportunity score dropped
  | "HOUSEHOLD_SUPPRESSED"                  // opt-out / DNC
  | "TENANT_MISMATCH"                       // workflow belongs to different agency
  | "WORKFLOW_STALE"                         // > 7 days, auto-cancelled
  | "WORKFLOW_NOT_FOUND"                    // id doesn't exist
  | "WORKFLOW_ALREADY_EXECUTED"             // status = executed
  | "WORKFLOW_CANCELLED";                   // status = cancelled

// ── Audit table bootstrap ─────────────────────────────────────────────────────

let _auditEnsured = false;

async function ensureAuditTable(): Promise<void> {
  if (_auditEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _ins_approval_audit (
        id              SERIAL PRIMARY KEY,
        audit_id        TEXT        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
        workflow_id     INTEGER     NOT NULL,
        gate_result     TEXT        NOT NULL,  -- 'PASS' | gate code on fail
        gate_code       TEXT,
        agency_id       INTEGER,
        approver        TEXT,
        score_at_exec   INTEGER,
        score_threshold INTEGER,
        suppressed      BOOLEAN,
        tenant_ok       BOOLEAN,
        error_message   TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ins_aa_workflow_idx ON _ins_approval_audit (workflow_id);
      CREATE INDEX IF NOT EXISTS ins_aa_result_idx   ON _ins_approval_audit (gate_result, created_at DESC);
    `);
    _auditEnsured = true;
  } catch (err: any) {
    console.error("[APPROVAL_GATE] Failed to ensure audit table:", err?.message);
  }
}

// ── Audit writer ──────────────────────────────────────────────────────────────

async function writeAudit(opts: {
  workflowId: number;
  gateResult: "PASS" | ApprovalGateCode;
  gateCode?: ApprovalGateCode;
  agencyId?: number;
  approver?: string;
  scoreAtExec?: number;
  scoreThreshold?: number;
  suppressed?: boolean;
  tenantOk?: boolean;
  errorMessage?: string;
}): Promise<void> {
  await ensureAuditTable();
  try {
    await db.execute(sql.raw(`
      INSERT INTO _ins_approval_audit
        (workflow_id, gate_result, gate_code, agency_id, approver,
         score_at_exec, score_threshold, suppressed, tenant_ok, error_message)
      VALUES
        (${num(opts.workflowId)}, ${esc(opts.gateResult)}, ${esc(opts.gateCode)},
         ${num(opts.agencyId)}, ${esc(opts.approver)},
         ${num(opts.scoreAtExec)}, ${num(opts.scoreThreshold)},
         ${bool(opts.suppressed)}, ${bool(opts.tenantOk)},
         ${esc(opts.errorMessage)})
    `));
  } catch (err: any) {
    // Never let audit failure block the gate decision — just log
    console.error("[APPROVAL_GATE] Audit write failed:", err?.message);
  }
}

// ── Main gate function ────────────────────────────────────────────────────────

export interface AssertApprovedOptions {
  workflowId:       number;
  callerAgencyId:   number;
  minScore?:        number;   // default 30 — opportunity score floor at execution time
  staleAfterDays?:  number;   // default 7 — workflows older than this auto-cancel
}

/**
 * assertApproved — call this immediately before handing a payload to any
 * transport adapter (SMS, voice, email, etc.).
 *
 * Throws ApprovalGateError on any gate failure.
 * Returns the workflow row on success (for template variable hydration).
 */
export async function assertApproved(opts: AssertApprovedOptions): Promise<Record<string, unknown>> {
  await ensureAuditTable();

  const {
    workflowId,
    callerAgencyId,
    minScore = 30,
    staleAfterDays = 7,
  } = opts;

  // ── 1. Fetch workflow row ──────────────────────────────────────────────────
  const wfResult = await db.execute(sql.raw(`
    SELECT * FROM _ins_workflow_queue WHERE id = ${num(workflowId)} LIMIT 1
  `));
  const wfRows = (wfResult as any).rows ?? wfResult;
  const wf: Record<string, unknown> = Array.isArray(wfRows) ? wfRows[0] : undefined;

  if (!wf) {
    await writeAudit({ workflowId, gateResult: "WORKFLOW_NOT_FOUND", gateCode: "WORKFLOW_NOT_FOUND" });
    throw new ApprovalGateError("WORKFLOW_NOT_FOUND", "workflow row does not exist", workflowId);
  }

  // ── 2. Status guards ───────────────────────────────────────────────────────
  if (wf.status === "executed") {
    await writeAudit({ workflowId, gateResult: "WORKFLOW_ALREADY_EXECUTED", gateCode: "WORKFLOW_ALREADY_EXECUTED" });
    throw new ApprovalGateError("WORKFLOW_ALREADY_EXECUTED", "already executed", workflowId);
  }
  if (wf.status === "cancelled") {
    await writeAudit({ workflowId, gateResult: "WORKFLOW_CANCELLED", gateCode: "WORKFLOW_CANCELLED" });
    throw new ApprovalGateError("WORKFLOW_CANCELLED", "workflow was cancelled", workflowId);
  }

  // ── 3. Staleness check — auto-cancel if too old ───────────────────────────
  const createdAt = new Date(wf.created_at as string).getTime();
  const ageMs = Date.now() - createdAt;
  const staleLimitMs = staleAfterDays * 86_400_000;
  if (ageMs > staleLimitMs && !wf.approved_at) {
    // Mark cancelled in DB
    try {
      await db.execute(sql.raw(`
        UPDATE _ins_workflow_queue
        SET status = 'cancelled', error_message = 'auto-cancelled: stale > ${staleAfterDays}d'
        WHERE id = ${num(workflowId)}
      `));
    } catch { /* best effort */ }
    await writeAudit({ workflowId, gateResult: "WORKFLOW_STALE", gateCode: "WORKFLOW_STALE", agencyId: callerAgencyId });
    throw new ApprovalGateError("WORKFLOW_STALE", `created ${Math.round(ageMs / 86_400_000)}d ago, never approved`, workflowId);
  }

  // ── 4. Approval flag check ─────────────────────────────────────────────────
  if (wf.approval_required !== true) {
    await writeAudit({ workflowId, gateResult: "APPROVAL_NOT_REQUIRED_FLAG_MISSING", gateCode: "APPROVAL_NOT_REQUIRED_FLAG_MISSING" });
    throw new ApprovalGateError("APPROVAL_NOT_REQUIRED_FLAG_MISSING", "approval_required is not TRUE — data integrity error", workflowId);
  }
  if (!wf.approved_at) {
    await writeAudit({ workflowId, gateResult: "NOT_APPROVED", gateCode: "NOT_APPROVED", agencyId: callerAgencyId });
    throw new ApprovalGateError("NOT_APPROVED", "approved_at is NULL — human approval required", workflowId);
  }

  // ── 5. Approver identity check ────────────────────────────────────────────
  const approver = String(wf.approved_by ?? "").trim();
  if (!approver || approver.toLowerCase() === "system" || approver.toLowerCase() === "auto") {
    await writeAudit({ workflowId, gateResult: "APPROVER_MISSING", gateCode: "APPROVER_MISSING", approver });
    throw new ApprovalGateError("APPROVER_MISSING", `approver '${approver}' is not a named human actor`, workflowId);
  }

  // ── 6. Tenant ownership check ─────────────────────────────────────────────
  const wfAgencyId = wf.agency_id != null ? Number(wf.agency_id) : null;
  const tenantOk = wfAgencyId == null || wfAgencyId === callerAgencyId;
  if (!tenantOk) {
    await writeAudit({ workflowId, gateResult: "TENANT_MISMATCH", gateCode: "TENANT_MISMATCH", agencyId: callerAgencyId, tenantOk: false });
    throw new ApprovalGateError("TENANT_MISMATCH", `workflow belongs to agency#${wfAgencyId}, caller is agency#${callerAgencyId}`, workflowId);
  }

  // ── 7. Pre-execution opportunity score re-check ───────────────────────────
  let currentScore: number | null = null;
  const householdId = wf.household_id as string | null;
  if (householdId) {
    try {
      const scoreResult = await db.execute(sql.raw(`
        SELECT policy_opportunity_score FROM _ins_households
        WHERE household_id = ${esc(householdId)} LIMIT 1
      `));
      const scoreRows = (scoreResult as any).rows ?? scoreResult;
      if (Array.isArray(scoreRows) && scoreRows[0]) {
        currentScore = Number(scoreRows[0].policy_opportunity_score ?? 0);
      }
    } catch { /* table may not exist yet — skip score check */ }
  }

  if (currentScore !== null && currentScore < minScore) {
    await writeAudit({
      workflowId,
      gateResult: "SCORE_BELOW_THRESHOLD",
      gateCode:   "SCORE_BELOW_THRESHOLD",
      agencyId:   callerAgencyId,
      approver,
      scoreAtExec:    currentScore,
      scoreThreshold: minScore,
    });
    throw new ApprovalGateError("SCORE_BELOW_THRESHOLD", `score=${currentScore} < threshold=${minScore}`, workflowId);
  }

  // ── 8. Suppression re-check ───────────────────────────────────────────────
  let suppressed = false;
  if (householdId) {
    try {
      const suppResult = await db.execute(sql.raw(`
        SELECT id FROM _ins_suppression_list
        WHERE household_id = ${esc(householdId)}
          AND (expires_at IS NULL OR expires_at > NOW())
        LIMIT 1
      `));
      const suppRows = (suppResult as any).rows ?? suppResult;
      suppressed = Array.isArray(suppRows) && suppRows.length > 0;
    } catch { /* suppression table may not exist yet — skip */ }
  }

  if (suppressed) {
    await writeAudit({
      workflowId, gateResult: "HOUSEHOLD_SUPPRESSED", gateCode: "HOUSEHOLD_SUPPRESSED",
      agencyId: callerAgencyId, approver, suppressed: true,
    });
    throw new ApprovalGateError("HOUSEHOLD_SUPPRESSED", `household ${householdId} is on suppression list`, workflowId);
  }

  // ── PASS — write audit and return workflow row ─────────────────────────────
  await writeAudit({
    workflowId,
    gateResult:     "PASS",
    agencyId:       callerAgencyId,
    approver,
    scoreAtExec:    currentScore ?? undefined,
    scoreThreshold: minScore,
    suppressed:     false,
    tenantOk:       true,
  });

  console.log(`[APPROVAL_GATE] PASS wf#${workflowId} approver=${approver} score=${currentScore ?? "n/a"}`);
  return wf;
}

// ── Approve a workflow (called by the Executor UI) ────────────────────────────

export async function approveWorkflow(opts: {
  workflowId:  number;
  approvedBy:  string;
  agencyId?:   number;
  draftContent?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!opts.approvedBy || opts.approvedBy.trim().toLowerCase() === "system") {
    return { success: false, error: "approvedBy must be a named human actor" };
  }
  try {
    await db.execute(sql.raw(`
      UPDATE _ins_workflow_queue
      SET
        approved_at    = NOW(),
        approved_by    = ${esc(opts.approvedBy)},
        draft_content  = COALESCE(${esc(opts.draftContent)}, draft_content),
        status         = 'approved'
      WHERE id = ${num(opts.workflowId)}
        AND status     = 'pending'
        AND approval_required = TRUE
    `));
    console.log(`[APPROVAL_GATE] Workflow #${opts.workflowId} approved by ${opts.approvedBy}`);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

// ── Reject a workflow ─────────────────────────────────────────────────────────

export async function rejectWorkflow(opts: {
  workflowId:  number;
  rejectedBy:  string;
  reason?:     string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await db.execute(sql.raw(`
      UPDATE _ins_workflow_queue
      SET
        status        = 'cancelled',
        error_message = ${esc(`Rejected by ${opts.rejectedBy}: ${opts.reason ?? "no reason given"}`)}
      WHERE id = ${num(opts.workflowId)}
        AND status IN ('pending', 'approved')
    `));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

// ── Query: pending approvals for a given agency ───────────────────────────────

export async function getPendingApprovals(opts: {
  agencyId?: number;
  limit?: number;
} = {}): Promise<any[]> {
  await ensureAuditTable();
  const { agencyId, limit = 50 } = opts;
  const conditions = [`status IN ('pending', 'approved')`];
  if (agencyId) conditions.push(`agency_id = ${num(agencyId)}`);
  const where = `WHERE ${conditions.join(" AND ")}`;
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        wq.*,
        aa.gate_result    AS last_gate_result,
        aa.score_at_exec  AS last_score_check,
        aa.created_at     AS last_checked_at
      FROM _ins_workflow_queue wq
      LEFT JOIN LATERAL (
        SELECT gate_result, score_at_exec, created_at
        FROM _ins_approval_audit
        WHERE workflow_id = wq.id
        ORDER BY created_at DESC LIMIT 1
      ) aa ON TRUE
      ${where}
      ORDER BY wq.scheduled_at ASC
      LIMIT ${num(limit)}
    `));
    return (result as any).rows ?? result ?? [];
  } catch { return []; }
}

// ── Query: approval audit timeline for one workflow ───────────────────────────

export async function getWorkflowAuditTimeline(workflowId: number): Promise<any[]> {
  await ensureAuditTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _ins_approval_audit
      WHERE workflow_id = ${num(workflowId)}
      ORDER BY created_at ASC
    `));
    return (result as any).rows ?? result ?? [];
  } catch { return []; }
}
