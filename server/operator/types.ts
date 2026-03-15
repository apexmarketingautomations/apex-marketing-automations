export type AutonomyLevel = "observe" | "draft" | "execute";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "auto_approved" | "expired";

export type ToolCategory = "crm" | "workflow" | "site" | "messaging" | "campaign" | "system" | "diagnostics" | "appointment" | "creative" | "review" | "intelligence";

export interface OperatorTool {
  name: string;
  description: string;
  category: ToolCategory;
  autonomyRequired: AutonomyLevel;
  requiresApproval: boolean;
  parameters: ToolParameter[];
  validate: (params: Record<string, any>, context: OperatorContext) => ValidationResult;
  execute: (params: Record<string, any>, context: OperatorContext) => Promise<ToolResult>;
  summarizeForAudit?: (params: Record<string, any>, result: ToolResult) => string;
  idempotencyKey?: (params: Record<string, any>) => string;
}

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  description: string;
  default?: any;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  sideEffects?: string[];
  eventsFired?: string[];
}

export interface ToolExecutionResult {
  toolName: string;
  status: "success" | "failure" | "validation_error" | "approval_required" | "autonomy_blocked";
  result: ToolResult;
  auditLog: string;
  error?: string;
  durationMs: number;
  timestamp: string;
}

export interface OperatorContext {
  subAccountId: number;
  userId?: string;
  autonomyLevel: AutonomyLevel;
  sessionId: string;
  correlationId: string;
}

export interface OperatorPlan {
  id: string;
  sessionId: string;
  subAccountId: number;
  userIntent: string;
  steps: PlanStep[];
  status: "planning" | "ready" | "executing" | "completed" | "failed" | "awaiting_approval";
  createdAt: string;
  updatedAt: string;
  result?: any;
  error?: string;
}

export interface PlanStep {
  id: string;
  order: number;
  toolName: string;
  parameters: Record<string, any>;
  description: string;
  status: "pending" | "executing" | "completed" | "failed" | "skipped" | "awaiting_approval";
  requiresApproval: boolean;
  result?: ToolResult;
  error?: string;
}

export interface ApprovalRequest {
  id: string;
  planId: string;
  stepId: string;
  subAccountId: number;
  toolName: string;
  description: string;
  parameters: Record<string, any>;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  expiresAt: string;
}

export interface DiagnosticCheck {
  name: string;
  category: "workflow" | "integration" | "messaging" | "queue" | "campaign" | "system";
  severity: "info" | "warning" | "critical";
  status: "healthy" | "degraded" | "failing";
  message: string;
  details?: Record<string, any>;
  suggestedFix?: string;
  autoFixable: boolean;
  timestamp: string;
}

export interface TelemetryMetric {
  name: string;
  value: number;
  unit: string;
  tags: Record<string, string>;
  timestamp: string;
}

export interface OperatorMemory {
  subAccountId: number;
  key: string;
  value: any;
  updatedAt: string;
  expiresAt?: string;
}

export interface PlannerToolMeta {
  name: string;
  description: string;
  category: ToolCategory;
  autonomyLevel: AutonomyLevel;
  requiresApproval: boolean;
  parameterNames: string[];
}
