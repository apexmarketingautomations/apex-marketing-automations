/**
 * server/communications/approvalWorkflowEngine.ts
 *
 * Generalized Approval Workflow Engine (Phase 10)
 *
 * Handles approval for ALL communication types across all verticals.
 * Generalizes the Phase 8 insurance-specific approval gate into a
 * platform-wide system.
 *
 * Approval required for:
 *   - Legal outreach (always)
 *   - Insurance outreach (always)
 *   - VIP outreach (always)
 *   - iMessage drafts (always)
 *   - First-contact sequences (configurable)
 *   - High-risk communications (configurable)
 *
 * Lifecycle:
 *   pending → approved → [sending → sent]
 *   pending → rejected  → [end]
 *   pending → expired   → [end] (auto after 48h)
 *   pending → escalated → [human escalation]
 *
 * Safety:
 *   - Named human approver required (≥2 chars, not 'system'/'auto')
 *   - Approval expires after 48h (configurable per workflow)
 *   - All approval actions written to immutable audit log
 *   - Tenant isolation enforced
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num } from "../hpl/sqlSafe";
import { createHash } from "crypto";
import type { ApprovalRecord, ApprovalStatus, CommWorkflowType } from "./types";
import { appendTimelineEvent } from "./communicationTimelineService";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_EXPIRY_HOURS = 48;
const SYSTEM_ACTOR_BLOCKLIST = ["system", "auto", "bot", "ai", "automated", ""];

// ── Error class ───────────────────────────────────────────────────────────────

export class ApprovalError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "ALREADY_PROCESSED"
      | "EXPIRED"
      | "APPROVER_INVALID"
      | "TENANT_MISMATCH"
      | "NOT_APPROVED",
    public readonly approvalId: string,
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

// ── ID builder ────────────────────────────────────────────────────────────────

function buildApprovalId(communicationId: string, workflowType: string): string {
  const raw = `approval|${communicationId}|${workflowType}|${Date.now()}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _comm_approvals (
        id                 SERIAL PRIMARY KEY,
        approval_id        TEXT        NOT NULL UNIQUE,
        communication_id   TEXT        NOT NULL,
        tenant_id          TEXT        NOT NULL,
        workflow_type      TEXT        NOT NULL,
        requested_by       TEXT        NOT NULL DEFAULT 'system',
        requested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status             TEXT        NOT NULL DEFAULT 'pending',
        approved_by        TEXT,
        approved_at        TIMESTAMPTZ,
        rejected_by        TEXT,
        rejected_at        TIMESTAMPTZ,
        rejection_reason   TEXT,
        expires_at         TIMESTAMPTZ NOT NULL,
        escalated_at       TIMESTAMPTZ,
        notes              TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS comm_appr_comm_idx   ON _comm_approvals (communication_id);
      CREATE INDEX IF NOT EXISTS comm_appr_tenant_idx ON _comm_approvals (tenant_id, status, expires_at);
      CREATE INDEX IF NOT EXISTS comm_appr_pending_idx ON _comm_approvals (status, expires_at)
        WHERE status = 'pending';
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[COMM-APPROVAL] Failed to ensure table:", err?.message);
  }
}

// ── Request approval ──────────────────────────────────────────────────────────

export async function requestApproval(opts: {
  communicationId: string;
  tenantId:        string;
  workflowType:    CommWorkflowType;
  requestedBy?:    string;
  expiryHours?:    number;
  notes?:          string;
}): Promise<{ approvalId: string; expiresAt: string }> {
  await ensureTable();

  const approvalId = buildApprovalId(opts.communicationId, opts.workflowType);
  const expiresAt  = new Date(Date.now() + (opts.expiryHours ?? DEFAULT_EXPIRY_HOURS) * 3_600_000).toISOString();

  await db.execute(sql.raw(`
    INSERT INTO _comm_approvals
      (approval_id, communication_id, tenant_id, workflow_type,
       requested_by, status, expires_at, notes)
    VALUES
      (${esc(approvalId)}, ${esc(opts.communicationId)}, ${esc(opts.tenantId)},
       ${esc(opts.workflowType)}, ${esc(opts.requestedBy ?? "system")},
       'pending', ${esc(expiresAt)}, ${esc(opts.notes ?? "")})
    ON CONFLICT (approval_id) DO NOTHING
  `));

  await appendTimelineEvent({
    communicationId: opts.communicationId,
    tenantId:        opts.tenantId,
    eventType:       "approval_requested",
    actor:           "system",
    description:     `Approval requested for ${opts.workflowType} — expires ${new Date(expiresAt).toLocaleString()}`,
    metadata:        { approvalId, workflowType: opts.workflowType, expiresAt },
  });

  console.log(`[COMM-APPROVAL] Requested: ${approvalId} workflow=${opts.workflowType} expires=${expiresAt}`);
  return { approvalId, expiresAt };
}

// ── Approve ───────────────────────────────────────────────────────────────────

export async function approveRequest(opts: {
  approvalId:  string;
  tenantId:    string;
  approvedBy:  string;
  notes?:      string;
}): Promise<void> {
  await ensureTable();

  const { approvalId, tenantId, approvedBy } = opts;

  // Validate approver identity
  if (SYSTEM_ACTOR_BLOCKLIST.includes(approvedBy.trim().toLowerCase()) || approvedBy.trim().length < 2) {
    throw new ApprovalError(
      `Invalid approver: '${approvedBy}'. A real human name is required.`,
      "APPROVER_INVALID", approvalId,
    );
  }

  // Load approval record
  const result = await db.execute(sql.raw(`
    SELECT * FROM _comm_approvals WHERE approval_id = ${esc(approvalId)} AND tenant_id = ${esc(tenantId)}
  `));
  const rows = (result as any).rows ?? result;
  const rec = Array.isArray(rows) ? rows[0] : null;

  if (!rec) throw new ApprovalError("Approval record not found", "NOT_FOUND", approvalId);
  if (rec.status !== "pending") throw new ApprovalError(`Already ${rec.status}`, "ALREADY_PROCESSED", approvalId);
  if (new Date(rec.expires_at) < new Date()) {
    // Auto-expire
    await db.execute(sql.raw(`UPDATE _comm_approvals SET status='expired' WHERE approval_id=${esc(approvalId)}`));
    throw new ApprovalError("Approval has expired", "EXPIRED", approvalId);
  }

  await db.execute(sql.raw(`
    UPDATE _comm_approvals
    SET status = 'approved', approved_by = ${esc(approvedBy)}, approved_at = NOW(),
        notes = COALESCE(NULLIF(${esc(opts.notes ?? "")}, ''), notes)
    WHERE approval_id = ${esc(approvalId)}
  `));

  await appendTimelineEvent({
    communicationId: rec.communication_id,
    tenantId,
    eventType:       "approved",
    actor:           "human",
    actorId:         approvedBy,
    description:     `Approved by ${approvedBy}`,
    metadata:        { approvalId },
  });

  console.log(`[COMM-APPROVAL] Approved: ${approvalId} by ${approvedBy}`);
}

// ── Reject ────────────────────────────────────────────────────────────────────

export async function rejectRequest(opts: {
  approvalId:       string;
  tenantId:         string;
  rejectedBy:       string;
  rejectionReason?: string;
}): Promise<void> {
  await ensureTable();

  const result = await db.execute(sql.raw(`
    SELECT * FROM _comm_approvals WHERE approval_id = ${esc(opts.approvalId)} AND tenant_id = ${esc(opts.tenantId)}
  `));
  const rows = (result as any).rows ?? result;
  const rec  = Array.isArray(rows) ? rows[0] : null;
  if (!rec) throw new ApprovalError("Approval not found", "NOT_FOUND", opts.approvalId);
  if (!["pending", "escalated"].includes(rec.status)) {
    throw new ApprovalError(`Cannot reject: status is ${rec.status}`, "ALREADY_PROCESSED", opts.approvalId);
  }

  await db.execute(sql.raw(`
    UPDATE _comm_approvals
    SET status = 'rejected', rejected_by = ${esc(opts.rejectedBy)},
        rejected_at = NOW(), rejection_reason = ${esc(opts.rejectionReason ?? "")}
    WHERE approval_id = ${esc(opts.approvalId)}
  `));

  await appendTimelineEvent({
    communicationId: rec.communication_id,
    tenantId:        opts.tenantId,
    eventType:       "rejected",
    actor:           "human",
    actorId:         opts.rejectedBy,
    description:     `Rejected by ${opts.rejectedBy}: ${opts.rejectionReason ?? "no reason given"}`,
    metadata:        { approvalId: opts.approvalId },
  });
}

// ── Assert approved (gate function for executors) ─────────────────────────────

export async function assertCommunicationApproved(opts: {
  communicationId: string;
  tenantId:        string;
}): Promise<ApprovalRecord> {
  await ensureTable();

  const result = await db.execute(sql.raw(`
    SELECT * FROM _comm_approvals
    WHERE communication_id = ${esc(opts.communicationId)}
      AND tenant_id = ${esc(opts.tenantId)}
    ORDER BY requested_at DESC
    LIMIT 1
  `));
  const rows = (result as any).rows ?? result;
  const rec  = Array.isArray(rows) ? rows[0] : null;

  if (!rec) throw new ApprovalError("No approval record for this communication", "NOT_FOUND", "");
  if (rec.status === "expired") throw new ApprovalError("Approval has expired", "EXPIRED", rec.approval_id);
  if (rec.status !== "approved") throw new ApprovalError(`Not approved: status=${rec.status}`, "NOT_APPROVED", rec.approval_id);
  if (!rec.approved_by || SYSTEM_ACTOR_BLOCKLIST.includes(rec.approved_by.toLowerCase())) {
    throw new ApprovalError("Approval lacks valid human approver", "APPROVER_INVALID", rec.approval_id);
  }

  return mapApprovalRow(rec);
}

// ── Expire stale pending approvals ────────────────────────────────────────────

export async function expireStaleApprovals(tenantId?: string): Promise<number> {
  await ensureTable();
  const tenantFilter = tenantId ? `AND tenant_id = ${esc(tenantId)}` : "";
  try {
    const result = await db.execute(sql.raw(`
      UPDATE _comm_approvals
      SET status = 'expired'
      WHERE status = 'pending'
        AND expires_at < NOW()
        ${tenantFilter}
      RETURNING approval_id, communication_id, tenant_id
    `));
    const rows = (result as any).rows ?? result ?? [];
    const expired = Array.isArray(rows) ? rows.length : 0;
    console.log(`[COMM-APPROVAL] Expired ${expired} stale approvals`);
    return expired;
  } catch { return 0; }  // allow-silent-catch: non-fatal, returns safe default
}

// ── Get pending approvals ─────────────────────────────────────────────────────

export async function getPendingApprovals(tenantId: string, limit = 50): Promise<ApprovalRecord[]> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _comm_approvals
      WHERE tenant_id = ${esc(tenantId)}
        AND status = 'pending'
        AND expires_at > NOW()
      ORDER BY requested_at DESC
      LIMIT ${num(limit)}
    `));
    return ((result as any).rows ?? result ?? []).map(mapApprovalRow);
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}

// ── Approval stats ────────────────────────────────────────────────────────────

export async function getApprovalStats(tenantId: string): Promise<{
  pending:  number;
  approved: number;
  rejected: number;
  expired:  number;
  avgTurnaroundMinutes: number;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(CASE WHEN status='pending' THEN 1 END)   AS pending,
        COUNT(CASE WHEN status='approved' THEN 1 END)  AS approved,
        COUNT(CASE WHEN status='rejected' THEN 1 END)  AS rejected,
        COUNT(CASE WHEN status='expired' THEN 1 END)   AS expired,
        AVG(EXTRACT(EPOCH FROM (approved_at - requested_at)) / 60) AS avg_minutes
      FROM _comm_approvals
      WHERE tenant_id = ${esc(tenantId)}
        AND created_at >= NOW() - INTERVAL '30 days'
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : {};
    return {
      pending:  Number(r?.pending ?? 0),
      approved: Number(r?.approved ?? 0),
      rejected: Number(r?.rejected ?? 0),
      expired:  Number(r?.expired ?? 0),
      avgTurnaroundMinutes: Number(r?.avg_minutes ?? 0),
    };
  } catch {  // allow-silent-catch: non-fatal, returns safe default
    return { pending: 0, approved: 0, rejected: 0, expired: 0, avgTurnaroundMinutes: 0 };
  }
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function mapApprovalRow(r: any): ApprovalRecord {
  return {
    approvalId:       r.approval_id,
    communicationId:  r.communication_id,
    tenantId:         r.tenant_id,
    workflowType:     r.workflow_type as CommWorkflowType,
    requestedBy:      r.requested_by ?? "system",
    requestedAt:      r.requested_at?.toISOString?.() ?? new Date().toISOString(),
    status:           r.status as ApprovalStatus,
    approvedBy:       r.approved_by || undefined,
    approvedAt:       r.approved_at?.toISOString?.() ?? undefined,
    rejectedBy:       r.rejected_by || undefined,
    rejectedAt:       r.rejected_at?.toISOString?.() ?? undefined,
    rejectionReason:  r.rejection_reason || undefined,
    expiresAt:        r.expires_at?.toISOString?.() ?? new Date().toISOString(),
    escalatedAt:      r.escalated_at?.toISOString?.() ?? undefined,
    notes:            r.notes || undefined,
  };
}
