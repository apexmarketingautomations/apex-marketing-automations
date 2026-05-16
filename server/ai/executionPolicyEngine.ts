/**
 * server/ai/executionPolicyEngine.ts
 *
 * AI Execution Policy Engine
 *
 * Every AI agent call is checked through this engine before execution begins.
 * The engine enforces:
 *   - Tenant boundary isolation (subAccountId must match request context)
 *   - Action-level restrictions (what an agent can and cannot do)
 *   - Approval gate requirements (human-in-the-loop before certain outputs)
 *   - Role-based AI permissions (which task types are allowed per account tier)
 *   - Loop prevention (no recursive agent calls)
 *   - Emergency shutdown propagation
 *
 * Design: stateless evaluation — checks are pure functions over policy + context.
 * No DB calls here; policy config comes from env vars + module-level overrides.
 */

import type { AITaskType } from "./types";

// ── Policy definitions ────────────────────────────────────────────────────────

/**
 * Actions an AI agent might attempt. Categorized by risk level.
 * Restricted actions require explicit per-account enablement.
 */
export type AIAction =
  | "read_contact"           // read contact data
  | "read_case"              // read case/signal data
  | "write_message_draft"    // create a draft (not sent)
  | "send_sms"               // trigger outbound SMS
  | "send_email"             // trigger outbound email
  | "update_contact"         // modify contact record
  | "create_case"            // create new intelligence case
  | "update_case_score"      // update scoring on existing case
  | "enqueue_job"            // add work to a BullMQ queue
  | "trigger_workflow"       // start a named workflow
  | "escalate_to_human"      // notify human operator
  | "approve_communication"  // mark comms for send
  | "external_api_call"      // call third-party API
  | "delete_data";           // delete any record

/** Risk classification of each action. */
const ACTION_RISK: Record<AIAction, "low" | "medium" | "high" | "critical"> = {
  read_contact:          "low",
  read_case:             "low",
  write_message_draft:   "low",
  send_sms:              "high",
  send_email:            "high",
  update_contact:        "medium",
  create_case:           "medium",
  update_case_score:     "low",
  enqueue_job:           "medium",
  trigger_workflow:      "high",
  escalate_to_human:     "medium",
  approve_communication: "critical",
  external_api_call:     "high",
  delete_data:           "critical",
};

/** Actions that ALWAYS require human approval before the AI output is acted on. */
const APPROVAL_REQUIRED_ACTIONS = new Set<AIAction>([
  "send_sms",
  "send_email",
  "approve_communication",
  "delete_data",
  "trigger_workflow",
  "external_api_call",
]);

/** Actions permanently blocked — AI may never trigger these directly. */
const PERMANENTLY_BLOCKED_ACTIONS = new Set<AIAction>([
  "delete_data",
  "approve_communication",
]);

/** Task types that are globally disabled (set via env or runtime toggle). */
const _disabledTaskTypes = new Set<AITaskType>();

/** Per-subAccount overrides: subAccountId -> set of allowed extra actions. */
const _accountActionOverrides = new Map<string, Set<AIAction>>();

// ── Context + result types ────────────────────────────────────────────────────

export interface PolicyContext {
  subAccountId?: number | string;
  taskType: AITaskType | string;
  agentName: string;
  requestedActions?: AIAction[];
  /** Depth of current agent call stack — prevents recursive loops. */
  callDepth?: number;
  /** Whether this call is inside an already-approved workflow. */
  workflowApproved?: boolean;
  /** User role that initiated the request. */
  callerRole?: "admin" | "operator" | "system" | "api";
}

export interface PolicyResult {
  allowed: boolean;
  approvalRequired: boolean;
  approvalState: "auto" | "pending" | "rejected";
  blockedActions: AIAction[];
  allowedActions: AIAction[];
  reason?: string;
}

// ── Core policy check ─────────────────────────────────────────────────────────

export function checkExecutionPolicy(ctx: PolicyContext): PolicyResult {
  const blocked: AIAction[] = [];
  const allowed: AIAction[] = [];
  const requested = ctx.requestedActions ?? [];

  // 1. Emergency shutdown
  if (isEmergencyPolicyShutdown()) {
    return {
      allowed: false,
      approvalRequired: false,
      approvalState: "rejected",
      blockedActions: requested,
      allowedActions: [],
      reason: "emergency_policy_shutdown",
    };
  }

  // 2. Recursive call guard
  const depth = ctx.callDepth ?? 0;
  if (depth > 3) {
    return {
      allowed: false,
      approvalRequired: false,
      approvalState: "rejected",
      blockedActions: requested,
      allowedActions: [],
      reason: "max_call_depth_exceeded",
    };
  }

  // 3. Disabled task type
  if (_disabledTaskTypes.has(ctx.taskType as AITaskType)) {
    return {
      allowed: false,
      approvalRequired: false,
      approvalState: "rejected",
      blockedActions: requested,
      allowedActions: [],
      reason: `task_type_disabled:${ctx.taskType}`,
    };
  }

  // 4. Evaluate each requested action
  let requiresApproval = false;
  const accountKey = String(ctx.subAccountId ?? "global");
  const accountOverrides = _accountActionOverrides.get(accountKey) ?? new Set<AIAction>();

  for (const action of requested) {
    // Permanently blocked — never allowed
    if (PERMANENTLY_BLOCKED_ACTIONS.has(action)) {
      blocked.push(action);
      continue;
    }

    const risk = ACTION_RISK[action] ?? "high";

    // Critical actions require admin or system caller
    if (risk === "critical" && ctx.callerRole !== "admin" && ctx.callerRole !== "system") {
      if (!accountOverrides.has(action)) {
        blocked.push(action);
        continue;
      }
    }

    // High-risk actions need account override or workflow approval
    if (risk === "high" && !ctx.workflowApproved && !accountOverrides.has(action)) {
      blocked.push(action);
      continue;
    }

    // Approval-required actions set the flag but are otherwise allowed
    if (APPROVAL_REQUIRED_ACTIONS.has(action)) {
      requiresApproval = true;
    }

    allowed.push(action);
  }

  // 5. Final decision
  const policyBlocked = blocked.length > 0 && blocked.length === requested.length && requested.length > 0;

  return {
    allowed: !policyBlocked,
    approvalRequired: requiresApproval,
    approvalState: requiresApproval ? "pending" : "auto",
    blockedActions: blocked,
    allowedActions: allowed,
    reason: blocked.length > 0 ? `blocked_actions:${blocked.join(",")}` : undefined,
  };
}

// ── Tenant boundary guard ─────────────────────────────────────────────────────

/**
 * Verifies that the AI agent is only accessing data for the correct tenant.
 * Call before any DB read/write inside an agent.
 */
export function assertTenantBoundary(
  requestSubAccountId: number | string | undefined,
  resourceSubAccountId: number | string | null | undefined,
): void {
  if (requestSubAccountId == null || resourceSubAccountId == null) return;
  if (String(requestSubAccountId) !== String(resourceSubAccountId)) {
    throw new Error(
      `AI tenant boundary violation: request for subAccount=${requestSubAccountId} ` +
      `tried to access subAccount=${resourceSubAccountId}`
    );
  }
}

// ── Runtime controls ──────────────────────────────────────────────────────────

let _emergencyPolicyShutdown = false;

export function isEmergencyPolicyShutdown(): boolean {
  return _emergencyPolicyShutdown ||
    (process.env.AI_POLICY_EMERGENCY_SHUTDOWN ?? "").toLowerCase() === "true";
}

export function setEmergencyPolicyShutdown(active: boolean): void {
  _emergencyPolicyShutdown = active;
  console.warn(`[AI-POLICY] Emergency shutdown ${active ? "ACTIVATED" : "deactivated"}`);
}

export function disableTaskType(taskType: AITaskType): void {
  _disabledTaskTypes.add(taskType);
}

export function enableTaskType(taskType: AITaskType): void {
  _disabledTaskTypes.delete(taskType);
}

export function grantAccountAction(subAccountId: number | string, action: AIAction): void {
  const key = String(subAccountId);
  if (!_accountActionOverrides.has(key)) _accountActionOverrides.set(key, new Set());
  _accountActionOverrides.get(key)!.add(action);
}

export function revokeAccountAction(subAccountId: number | string, action: AIAction): void {
  _accountActionOverrides.get(String(subAccountId))?.delete(action);
}

// ── Policy report ─────────────────────────────────────────────────────────────

export interface PolicyReport {
  emergencyShutdown: boolean;
  disabledTaskTypes: string[];
  accountOverrides: Record<string, string[]>;
  permanentlyBlockedActions: string[];
  approvalRequiredActions: string[];
  generatedAt: string;
}

export function getPolicyReport(): PolicyReport {
  const accountOverrides: Record<string, string[]> = {};
  for (const [id, actions] of _accountActionOverrides.entries()) {
    accountOverrides[id] = Array.from(actions);
  }
  return {
    emergencyShutdown: isEmergencyPolicyShutdown(),
    disabledTaskTypes: Array.from(_disabledTaskTypes),
    accountOverrides,
    permanentlyBlockedActions: Array.from(PERMANENTLY_BLOCKED_ACTIONS),
    approvalRequiredActions: Array.from(APPROVAL_REQUIRED_ACTIONS),
    generatedAt: new Date().toISOString(),
  };
}
