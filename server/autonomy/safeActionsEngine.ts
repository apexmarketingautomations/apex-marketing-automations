import type {
  ActionRequest,
  ActionResult,
  ActionHandler,
  ActionAuditEntry,
  SafetyClassification,
  ActionCategory,
} from "./types";
import { setupHandlers } from "./handlers/setupHandlers";
import { repairHandlers } from "./handlers/repairHandlers";
import { optimizationHandlers } from "./handlers/optimizationHandlers";
import { storage } from "../storage";

const handlerRegistry = new Map<string, ActionHandler>();

function registerHandlers(handlers: ActionHandler[]) {
  for (const handler of handlers) {
    if (handlerRegistry.has(handler.actionType)) {
      throw new Error(`Duplicate action handler registered: ${handler.actionType}`);
    }
    handlerRegistry.set(handler.actionType, handler);
  }
}

registerHandlers(setupHandlers);
registerHandlers(repairHandlers);
registerHandlers(optimizationHandlers);

const BLOCKED_CLASSIFICATIONS: SafetyClassification[] = ["blocked"];

function validateSafetyClassification(handler: ActionHandler, dryRun?: boolean): {
  allowed: boolean;
  reason?: string;
} {
  if (BLOCKED_CLASSIFICATIONS.includes(handler.safetyClassification)) {
    return { allowed: false, reason: `Action "${handler.actionType}" is classified as blocked` };
  }
  if (handler.safetyClassification === "needs_review" && !dryRun) {
    return { allowed: false, reason: `Action "${handler.actionType}" requires review — use dry-run first, then approve` };
  }
  return { allowed: true };
}

async function logAuditEntry(entry: ActionAuditEntry): Promise<void> {
  try {
    await storage.createExecutionTimelineEntry({
      accountId: entry.accountId,
      relatedEntityType: "autonomy_action",
      relatedEntityId: entry.actionType,
      title: `[${entry.category.toUpperCase()}] ${entry.actionType}: ${entry.status}`,
      description: entry.result.changesSummary || entry.result.error || "",
      sourceModule: "autonomy_engine",
      severity: entry.status === "failed" ? "warning" : "info",
    });
  } catch (err) {
    console.error(`[SafeActionsEngine] Failed to log audit entry for ${entry.actionType}:`, err);
  }
}

export async function executeAction(request: ActionRequest): Promise<ActionResult> {
  const { accountId, actionType, params, triggeredBy, correlationId, dryRun } = request;
  const startTime = Date.now();

  const handler = handlerRegistry.get(actionType);
  if (!handler) {
    const result: ActionResult = {
      success: false,
      actionType,
      category: request.category,
      accountId,
      status: "failed",
      entitiesAffected: [],
      changesSummary: "",
      rollbackCapable: false,
      error: `Unknown action type: ${actionType}`,
      durationMs: Date.now() - startTime,
      executedAt: new Date().toISOString(),
    };

    await logAuditEntry({
      accountId,
      actionType,
      category: request.category,
      status: "failed",
      triggeredBy,
      correlationId,
      params,
      result,
      executedAt: result.executedAt,
    });

    return result;
  }

  const safetyCheck = validateSafetyClassification(handler, dryRun);
  if (!safetyCheck.allowed) {
    const result: ActionResult = {
      success: false,
      actionType,
      category: handler.category,
      accountId,
      status: "failed",
      entitiesAffected: [],
      changesSummary: "",
      rollbackCapable: false,
      error: safetyCheck.reason,
      durationMs: Date.now() - startTime,
      executedAt: new Date().toISOString(),
    };

    await logAuditEntry({
      accountId,
      actionType,
      category: handler.category,
      status: "failed",
      triggeredBy,
      correlationId,
      params,
      result,
      executedAt: result.executedAt,
    });

    return result;
  }

  if (dryRun) {
    const result: ActionResult = {
      success: true,
      actionType,
      category: handler.category,
      accountId,
      status: "completed",
      entitiesAffected: [],
      changesSummary: `[DRY RUN] Would execute: ${handler.description}`,
      rollbackCapable: !!handler.rollback,
      durationMs: Date.now() - startTime,
      executedAt: new Date().toISOString(),
    };

    await logAuditEntry({
      accountId,
      actionType,
      category: handler.category,
      status: "completed",
      triggeredBy,
      correlationId,
      params,
      result,
      executedAt: result.executedAt,
    });

    return result;
  }

  let result: ActionResult;
  try {
    result = await handler.execute(accountId, params);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    result = {
      success: false,
      actionType,
      category: handler.category,
      accountId,
      status: "failed",
      entitiesAffected: [],
      changesSummary: "",
      rollbackCapable: false,
      error: errorMessage,
      durationMs: Date.now() - startTime,
      executedAt: new Date().toISOString(),
    };
  }

  await logAuditEntry({
    accountId,
    actionType,
    category: handler.category,
    status: result.status,
    triggeredBy,
    correlationId,
    params,
    result,
    executedAt: result.executedAt,
  });

  return result;
}

export async function rollbackAction(
  accountId: number,
  actionType: string,
  rollbackPayload: Record<string, unknown>,
  triggeredBy: string
): Promise<ActionResult> {
  const startTime = Date.now();
  const handler = handlerRegistry.get(actionType);

  if (!handler) {
    const result: ActionResult = {
      success: false,
      actionType,
      category: "setup",
      accountId,
      status: "failed",
      entitiesAffected: [],
      changesSummary: "",
      rollbackCapable: false,
      error: `Unknown action type: ${actionType}`,
      durationMs: Date.now() - startTime,
      executedAt: new Date().toISOString(),
    };

    await logAuditEntry({
      accountId,
      actionType: `rollback:${actionType}`,
      category: "setup",
      status: "failed",
      triggeredBy,
      params: rollbackPayload,
      result,
      executedAt: result.executedAt,
    });

    return result;
  }

  if (!handler.rollback) {
    const result: ActionResult = {
      success: false,
      actionType,
      category: handler.category,
      accountId,
      status: "failed",
      entitiesAffected: [],
      changesSummary: "",
      rollbackCapable: false,
      error: `Action "${actionType}" does not support rollback`,
      durationMs: Date.now() - startTime,
      executedAt: new Date().toISOString(),
    };

    await logAuditEntry({
      accountId,
      actionType: `rollback:${actionType}`,
      category: handler.category,
      status: "failed",
      triggeredBy,
      params: rollbackPayload,
      result,
      executedAt: result.executedAt,
    });

    return result;
  }

  let result: ActionResult;
  try {
    result = await handler.rollback(accountId, rollbackPayload);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    result = {
      success: false,
      actionType,
      category: handler.category,
      accountId,
      status: "failed",
      entitiesAffected: [],
      changesSummary: "",
      rollbackCapable: false,
      error: `Rollback failed: ${errorMessage}`,
      durationMs: Date.now() - startTime,
      executedAt: new Date().toISOString(),
    };
  }

  await logAuditEntry({
    accountId,
    actionType: `rollback:${actionType}`,
    category: handler.category,
    status: result.status,
    triggeredBy,
    params: rollbackPayload,
    result,
    executedAt: result.executedAt,
  });

  return result;
}

export async function executeBatch(
  requests: ActionRequest[]
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const request of requests) {
    const result = await executeAction(request);
    results.push(result);
    if (!result.success) {
      console.warn(`[SafeActionsEngine] Batch action "${request.actionType}" failed: ${result.error}`);
    }
  }
  return results;
}

export function getAvailableActions(): {
  actionType: string;
  category: ActionCategory;
  description: string;
  safetyClassification: SafetyClassification;
  rollbackCapable: boolean;
}[] {
  return Array.from(handlerRegistry.values()).map(h => ({
    actionType: h.actionType,
    category: h.category,
    description: h.description,
    safetyClassification: h.safetyClassification,
    rollbackCapable: !!h.rollback,
  }));
}

export function getHandlerByType(actionType: string): ActionHandler | undefined {
  return handlerRegistry.get(actionType);
}

export function getHandlersByCategory(category: ActionCategory): ActionHandler[] {
  return Array.from(handlerRegistry.values()).filter(h => h.category === category);
}

export function getHandlerCount(): number {
  return handlerRegistry.size;
}
