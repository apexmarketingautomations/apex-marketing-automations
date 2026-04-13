export type SafetyClassification = "safe" | "needs_review" | "blocked";

export type ActionCategory = "setup" | "repair" | "optimization";

export type ActionStatus = "pending" | "executing" | "completed" | "failed" | "rolled_back";

export interface ActionRequest {
  accountId: number;
  actionType: string;
  category: ActionCategory;
  params: Record<string, unknown>;
  triggeredBy: string;
  correlationId?: string;
  dryRun?: boolean;
}

export interface ActionResult {
  success: boolean;
  actionType: string;
  category: ActionCategory;
  accountId: number;
  status: ActionStatus;
  entitiesAffected: EntityChange[];
  changesSummary: string;
  rollbackCapable: boolean;
  rollbackPayload?: Record<string, unknown>;
  error?: string;
  durationMs: number;
  executedAt: string;
}

export interface EntityChange {
  entityType: string;
  entityId: string;
  operation: "created" | "updated" | "deleted" | "restored";
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface ActionHandler {
  actionType: string;
  category: ActionCategory;
  description: string;
  safetyClassification: SafetyClassification;
  execute: (accountId: number, params: Record<string, unknown>) => Promise<ActionResult>;
  rollback?: (accountId: number, rollbackPayload: Record<string, unknown>) => Promise<ActionResult>;
}

export interface ActionAuditEntry {
  accountId: number;
  actionType: string;
  category: ActionCategory;
  status: ActionStatus;
  triggeredBy: string;
  correlationId?: string;
  params: Record<string, unknown>;
  result: ActionResult;
  executedAt: string;
}
