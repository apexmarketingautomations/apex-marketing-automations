/**
 * server/ai/index.ts
 *
 * Public surface of the Apex AI Orchestration Layer (Stage 5).
 *
 * Consumers outside server/ai/ should import from here, not from individual modules.
 * server/aiGateway.ts is the backward-compatible API for existing code.
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  AITaskType,
  ProviderName,
  ModelCapability,
  ModelProfile,
  ModelCostProfile,
  ProviderHealth,
  ProviderHealthStatus,
  AIRequestOptions,
  AIUsage,
  AICallTrace,
  FallbackReason,
  BudgetContext,
  BudgetStatus,
  StructuredOutputResult,
  EmbeddingRequest,
  EmbeddingResult,
  OCRDocumentType,
  OCRRequest,
  OCRResult,
} from "./types";

// ── Provider registry ─────────────────────────────────────────────────────────
export {
  recordProviderSuccess,
  recordProviderFailure,
  markProviderHealthy,
  isCircuitOpen,
  isQuotaBackoff,
  isProviderAvailable,
  getModelsForProvider,
  getModel,
  getModelsByCapability,
  getBestAvailableModels,
  getProviderHealth,
  getAllProviderHealth,
  computeProviderStatus,
  logRegistryStartup,
} from "./providerRegistry";

// ── Observability ─────────────────────────────────────────────────────────────
export {
  observeAICall,
  observeAIWarning,
  generateRequestId,
  estimateCostUsd,
  logProviderStatusAtStartup,
  updateMetrics,
  getProcessMetrics,
} from "./aiObservability";

// ── Budget manager ────────────────────────────────────────────────────────────
export {
  checkBudget,
  recordSpend,
  setEmergencyShutdown,
  isEmergencyShutdownActive,
  getBudgetReport,
} from "./aiBudgetManager";
export type { BudgetReport } from "./aiBudgetManager";

// ── Model capabilities ────────────────────────────────────────────────────────
export {
  TASK_REQUIRED_CAPABILITIES,
  TASK_PROVIDER_PREFERENCE,
  TASK_MODEL_OVERRIDES,
  getProviderPreference,
  getRequiredCapabilities,
  getPreferredModel,
  buildRoutingPlan,
  isImageInputRequired,
  isEmbeddingTask,
  isImageGenerationTask,
} from "./modelCapabilities";

// ── Task router ───────────────────────────────────────────────────────────────
export {
  buildPlan,
  isAnyProviderAvailable,
  getPrimaryProvider,
  logRoutingPlan,
} from "./aiTaskRouter";
export type { RoutingCandidate, RoutingPlan } from "./aiTaskRouter";

// ── Fallback engine ───────────────────────────────────────────────────────────
export {
  withFallback,
  withFallbackSafe,
} from "./aiFallbackEngine";
export type { FallbackResult, FallbackError } from "./aiFallbackEngine";

// ── Structured output ─────────────────────────────────────────────────────────
export {
  extractJSON,
  parseStructuredOutput,
  parseJSON,
  parseJSONArray,
  isObject,
  isNonEmptyArray,
  isArray,
  requiresKeys,
} from "./aiStructuredOutput";
export type { Validator } from "./aiStructuredOutput";

// ── Audit trail ───────────────────────────────────────────────────────────────
export {
  writeAuditEntry,
  getAuditLog,
  getAuditSummary,
} from "./auditTrailService";
export type { AIAuditEntry, AuditSummary, AuditQueryOptions } from "./auditTrailService";

// ── Execution policy engine ───────────────────────────────────────────────────
export {
  checkExecutionPolicy,
  assertTenantBoundary,
  isEmergencyPolicyShutdown,
  setEmergencyPolicyShutdown,
  disableTaskType,
  enableTaskType,
  grantAccountAction,
  revokeAccountAction,
  getPolicyReport,
} from "./executionPolicyEngine";
export type {
  AIAction,
  PolicyContext,
  PolicyResult,
  PolicyReport,
} from "./executionPolicyEngine";

// ── Agent coordinator ─────────────────────────────────────────────────────────
export { runAgent } from "./agentCoordinator";
export type {
  AgentDefinition,
  AgentRunOptions,
  AgentResult,
} from "./agentCoordinator";
