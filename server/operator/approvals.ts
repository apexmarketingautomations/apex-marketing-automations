import crypto from "crypto";
import type { ApprovalRequest, ApprovalStatus } from "./types";

const APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1000;
const approvals = new Map<string, ApprovalRequest>();
const MAX_APPROVALS = 500;

export function createApproval(opts: {
  planId: string;
  stepId: string;
  subAccountId: number;
  toolName: string;
  description: string;
  parameters: Record<string, any>;
}): ApprovalRequest {
  const approval: ApprovalRequest = {
    id: crypto.randomUUID(),
    planId: opts.planId,
    stepId: opts.stepId,
    subAccountId: opts.subAccountId,
    toolName: opts.toolName,
    description: opts.description,
    parameters: opts.parameters,
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + APPROVAL_EXPIRY_MS).toISOString(),
  };

  approvals.set(approval.id, approval);
  cleanExpired();

  return approval;
}

export function resolveApproval(approvalId: string, status: "approved" | "rejected", resolvedBy?: string): ApprovalRequest | null {
  const approval = approvals.get(approvalId);
  if (!approval) return null;
  if (approval.status !== "pending") return approval;

  if (new Date(approval.expiresAt) < new Date()) {
    approval.status = "expired";
    return approval;
  }

  approval.status = status;
  approval.resolvedAt = new Date().toISOString();
  approval.resolvedBy = resolvedBy;

  return approval;
}

export function getApproval(approvalId: string): ApprovalRequest | null {
  return approvals.get(approvalId) || null;
}

export function getPendingApprovals(subAccountId?: number): ApprovalRequest[] {
  cleanExpired();
  let pending = [...approvals.values()].filter(a => a.status === "pending");
  if (subAccountId) pending = pending.filter(a => a.subAccountId === subAccountId);
  return pending.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getApprovalHistory(subAccountId?: number, limit = 50): ApprovalRequest[] {
  let all = [...approvals.values()];
  if (subAccountId) all = all.filter(a => a.subAccountId === subAccountId);
  return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
}

function cleanExpired(): void {
  const now = new Date();
  for (const [id, approval] of approvals) {
    if (approval.status === "pending" && new Date(approval.expiresAt) < now) {
      approval.status = "expired";
    }
  }
  if (approvals.size > MAX_APPROVALS) {
    const sorted = [...approvals.entries()].sort((a, b) => new Date(a[1].createdAt).getTime() - new Date(b[1].createdAt).getTime());
    const toRemove = sorted.slice(0, sorted.length - MAX_APPROVALS);
    for (const [id] of toRemove) {
      if (approvals.get(id)?.status !== "pending") approvals.delete(id);
    }
  }
}
