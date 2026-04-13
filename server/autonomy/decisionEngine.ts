import { storage } from "../storage";
import type { AutonomySafetyClass, AutonomyAction, InsertAutonomyAction } from "@shared/schema";
import { evaluateSafetyPolicy, type SafetyContext, type SafetyEvaluation } from "./safetyPolicy";

export interface ClassificationResult extends SafetyEvaluation {}

export interface PolicyEvaluation {
  decision: "approve" | "deny" | "escalate" | "pending_auth";
  safetyClass: AutonomySafetyClass;
  explanation: string;
  reasons: string[];
  action: AutonomyAction;
}

export async function classifyAction(
  actionType: string,
  context: {
    accountId: number;
    confidenceScore: number;
    targetModule?: string;
    targetEntityType?: string;
    targetEntityId?: string;
    hasExternalAuth?: boolean;
    hasExternalAuthSatisfied?: boolean;
    hasPaymentIntent?: boolean;
    isDestructiveOverride?: boolean;
    metadata?: Record<string, unknown>;
  },
): Promise<ClassificationResult> {
  const policyRule = await storage.getAutonomyPolicyRule(actionType);
  const activeRule = policyRule?.active ? policyRule : null;

  const safetyContext: SafetyContext = {
    accountId: context.accountId,
    actionType,
    confidenceScore: context.confidenceScore,
    targetModule: context.targetModule,
    targetEntityType: context.targetEntityType,
    targetEntityId: context.targetEntityId,
    hasExternalAuth: context.hasExternalAuth,
    hasExternalAuthSatisfied: context.hasExternalAuthSatisfied,
    hasPaymentIntent: context.hasPaymentIntent,
    isDestructiveOverride: context.isDestructiveOverride,
    metadata: context.metadata,
  };

  return evaluateSafetyPolicy(safetyContext, activeRule);
}

export async function evaluatePolicy(
  actionData: InsertAutonomyAction,
): Promise<PolicyEvaluation> {
  const classification = await classifyAction(actionData.actionType, {
    accountId: actionData.accountId,
    confidenceScore: actionData.confidenceScore ?? 0,
    targetModule: actionData.targetModule ?? undefined,
    targetEntityType: actionData.targetEntityType ?? undefined,
    targetEntityId: actionData.targetEntityId ?? undefined,
  });

  let decision: "approve" | "deny" | "escalate" | "pending_auth";

  if (classification.blocked) {
    decision = "deny";
  } else if (classification.pendingAuth) {
    decision = "pending_auth";
  } else if (classification.safetyClass === "auto_execute" || classification.safetyClass === "auto_prepare") {
    decision = "approve";
  } else {
    decision = "escalate";
  }

  const action = await storage.createAutonomyAction({
    ...actionData,
    safetyClass: classification.safetyClass,
    status: classification.recommendedStatus,
    reason: classification.reasons.join("; "),
    explanation: `Decision: ${decision} | Rule: ${classification.ruleApplied || "none"} | Safety class: ${classification.safetyClass}`,
  });

  return {
    decision,
    safetyClass: classification.safetyClass,
    explanation: action.explanation || "",
    reasons: classification.reasons,
    action,
  };
}

export async function approveAction(actionId: number): Promise<AutonomyAction | undefined> {
  return storage.updateAutonomyAction(actionId, {
    status: "approved",
    updatedAt: new Date(),
  });
}

export async function resumeAction(actionId: number): Promise<AutonomyAction | undefined> {
  const action = await storage.getAutonomyAction(actionId);
  if (!action || action.status !== "pending_auth") return undefined;

  return storage.updateAutonomyAction(actionId, {
    status: "resumed",
    updatedAt: new Date(),
  });
}

export async function markExecuting(actionId: number): Promise<AutonomyAction | undefined> {
  return storage.updateAutonomyAction(actionId, {
    status: "executing",
    executedAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function markCompleted(
  actionId: number,
  result?: Record<string, unknown>,
  rollbackPayload?: Record<string, unknown>,
): Promise<AutonomyAction | undefined> {
  return storage.updateAutonomyAction(actionId, {
    status: "completed",
    executionResult: result ?? null,
    rollbackPayload: rollbackPayload ?? null,
    resolvedAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function markFailed(
  actionId: number,
  errorResult?: Record<string, unknown>,
): Promise<AutonomyAction | undefined> {
  return storage.updateAutonomyAction(actionId, {
    status: "failed",
    executionResult: errorResult ?? null,
    resolvedAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function rollbackAction(actionId: number): Promise<AutonomyAction | undefined> {
  return storage.updateAutonomyAction(actionId, {
    status: "rolled_back",
    resolvedAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function getActionAuditTrail(
  accountId: number,
  opts?: { limit?: number; actionType?: string; status?: string; safetyClass?: string },
): Promise<AutonomyAction[]> {
  return storage.getAutonomyActions(accountId, opts);
}
