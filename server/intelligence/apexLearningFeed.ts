import { emitUniversalEvent, EVENT_TYPES } from "./eventEmitter";

// =====================================================================
// LEVEL 1 — Operator & Core Intelligence
// =====================================================================

export function emitOperatorConversation(
  subAccountId: number,
  direction: "inbound" | "outbound",
  messagePreview: string,
  metadata?: Record<string, unknown>
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.OPERATOR_CONVERSATION,
    sourceModule: "operator",
    subAccountId,
    metadata: {
      direction,
      messagePreview: messagePreview.substring(0, 300),
      ...metadata,
    },
  });
}

export function emitOperatorToolExecution(
  subAccountId: number,
  toolName: string,
  success: boolean,
  durationMs: number,
  metadata?: Record<string, unknown>
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.OPERATOR_TOOL_EXECUTED,
    sourceModule: "operator",
    subAccountId,
    metadata: {
      toolName,
      success,
      durationMs,
      ...metadata,
    },
  });
}

export function emitOperatorActionApproval(
  subAccountId: number,
  toolName: string,
  summary: string,
  approved: boolean
): void {
  emitUniversalEvent({
    eventType: approved ? EVENT_TYPES.OPERATOR_ACTION_APPROVED : EVENT_TYPES.OPERATOR_ACTION_REJECTED,
    sourceModule: "operator",
    subAccountId,
    metadata: { toolName, summary },
  });
}

export function emitScoreUpdated(
  accountId: number,
  scoreType: string,
  entityType: string,
  entityId: string,
  scoreValue: number,
  scoreBand: string
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.SCORE_UPDATED,
    sourceModule: "intelligence-scoring",
    subAccountId: accountId,
    entityType,
    entityId,
    metadata: { scoreType, scoreValue, scoreBand },
  });
}

export function emitAgentTaskResult(
  subAccountId: number,
  taskType: string,
  title: string,
  success: boolean,
  metadata?: Record<string, unknown>
): void {
  emitUniversalEvent({
    eventType: success ? EVENT_TYPES.AGENT_TASK_COMPLETED : EVENT_TYPES.AGENT_TASK_FAILED,
    sourceModule: "agent-brain",
    subAccountId,
    metadata: { taskType, title, ...metadata },
  });
}

export function emitAgentBriefing(
  subAccountId: number,
  summary: string,
  tasksCompleted: number,
  tasksFailed: number
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.AGENT_BRIEFING_GENERATED,
    sourceModule: "agent-brain",
    subAccountId,
    metadata: { summary: summary.substring(0, 500), tasksCompleted, tasksFailed },
  });
}

export function emitCallAnalyzed(
  accountId: number,
  callId: number,
  outcome: string,
  engagementScore: number,
  agentScore: number
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.CALL_ANALYZED,
    sourceModule: "call-intelligence",
    subAccountId: accountId,
    entityType: "call",
    entityId: String(callId),
    metadata: { outcome, engagementScore, agentScore },
  });
}

export function emitCallPatternsInjected(
  totalCalls: number,
  conversionRate: number,
  avgEngagement: number
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.CALL_PATTERNS_INJECTED,
    sourceModule: "call-intelligence",
    metadata: { totalCalls, conversionRate, avgEngagement },
  });
}

export function emitAutonomyGapDetected(
  accountId: number,
  gapType: string,
  gapCount: number
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.AUTONOMY_GAP_DETECTED,
    sourceModule: "autonomy",
    subAccountId: accountId,
    metadata: { gapType, gapCount },
  });
}

export function emitAutonomyActionResult(
  accountId: number,
  actionType: string,
  success: boolean,
  metadata?: Record<string, unknown>
): void {
  emitUniversalEvent({
    eventType: success ? EVENT_TYPES.AUTONOMY_ACTION_COMPLETED : EVENT_TYPES.AUTONOMY_ACTION_FAILED,
    sourceModule: "autonomy",
    subAccountId: accountId,
    metadata: { actionType, ...metadata },
  });
}

// =====================================================================
// LEVEL 2 — Silent Data Pipelines
// =====================================================================

export function emitAgentTaskCreated(
  subAccountId: number,
  taskId: number,
  taskType: string,
  title: string,
  priority: number,
  urgent: boolean
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.AGENT_TASK_CREATED,
    sourceModule: "task-agent",
    subAccountId,
    entityType: "agent_task",
    entityId: String(taskId),
    metadata: { taskType, title, priority, urgent },
  });
}

export function emitAgentTaskRunning(
  subAccountId: number,
  taskId: number,
  taskType: string,
  title: string
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.AGENT_TASK_RUNNING,
    sourceModule: "task-agent",
    subAccountId,
    entityType: "agent_task",
    entityId: String(taskId),
    metadata: { taskType, title },
  });
}

export function emitAgentTaskRetry(
  subAccountId: number,
  taskId: number,
  taskType: string,
  attempt: number,
  maxAttempts: number,
  error: string
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.AGENT_TASK_RETRY,
    sourceModule: "task-agent",
    subAccountId,
    entityType: "agent_task",
    entityId: String(taskId),
    metadata: { taskType, attempt, maxAttempts, error: error.substring(0, 300) },
  });
}

export function emitWorkerJobResult(
  jobId: number,
  jobType: string,
  status: "completed" | "failed" | "retry",
  subAccountId?: number | null,
  metadata?: Record<string, unknown>
): void {
  const eventType = status === "completed"
    ? EVENT_TYPES.WORKER_JOB_COMPLETED
    : status === "failed"
      ? EVENT_TYPES.WORKER_JOB_FAILED
      : EVENT_TYPES.WORKER_JOB_RETRY;
  emitUniversalEvent({
    eventType,
    sourceModule: "agent-worker",
    subAccountId: subAccountId ?? undefined,
    entityType: "worker_job",
    entityId: String(jobId),
    metadata: { jobType, ...metadata },
  });
}

export function emitCrashIngested(
  subAccountId: number,
  reportId: number,
  severity: string,
  location: string,
  qualifies: boolean
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.CRASH_INGESTED,
    sourceModule: "crash-ingest",
    subAccountId,
    entityType: "crash_report",
    entityId: String(reportId),
    metadata: { severity, location: location.substring(0, 200), qualifies },
  });
}

export function emitCrashLeadCreated(
  subAccountId: number,
  reportId: number,
  severity: string,
  location: string
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.CRASH_LEAD_CREATED,
    sourceModule: "crash-ingest",
    subAccountId,
    entityType: "crash_report",
    entityId: String(reportId),
    metadata: { severity, location: location.substring(0, 200) },
  });
}

export function emitCrashLeadRecovered(
  subAccountId: number,
  reportId: number
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.CRASH_LEAD_RECOVERED,
    sourceModule: "crash-ingest",
    subAccountId,
    entityType: "crash_report",
    entityId: String(reportId),
  });
}

export function emitBillingRecord(
  subAccountId: number,
  billingId: number,
  channel: string,
  provider: string,
  billedAmount: number,
  margin: number,
  direction: string
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.BILLING_RECORD_CREATED,
    sourceModule: "billing",
    subAccountId,
    entityType: "message_billing",
    entityId: String(billingId),
    metadata: { channel, provider, billedAmount, margin, direction },
  });
}

export function emitWalletDeducted(
  subAccountId: number,
  amount: number,
  remaining: number,
  channel: string
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.WALLET_DEDUCTED,
    sourceModule: "billing",
    subAccountId,
    metadata: { amount, remaining, channel },
  });
}

export function emitPlatformProfit(
  subAccountId: number,
  amount: number,
  source: string
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.PLATFORM_PROFIT_RECORDED,
    sourceModule: "billing",
    subAccountId,
    metadata: { amount, source },
  });
}

export function emitPropertyLeadCreated(
  subAccountId: number,
  leadId: number,
  address: string
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.PROPERTY_LEAD_CREATED,
    sourceModule: "property",
    subAccountId,
    entityType: "property_lead",
    entityId: String(leadId),
    metadata: { address: address.substring(0, 200) },
  });
}

export function emitPropertyLeadUpdated(
  subAccountId: number | null,
  leadId: number,
  changes: string
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.PROPERTY_LEAD_UPDATED,
    sourceModule: "property",
    subAccountId: subAccountId ?? undefined,
    entityType: "property_lead",
    entityId: String(leadId),
    metadata: { changes },
  });
}

export function emitSkipTraceCompleted(
  subAccountId: number | null,
  leadId: number,
  resultId: number,
  phonesFound: number
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.SKIP_TRACE_COMPLETED,
    sourceModule: "property",
    subAccountId: subAccountId ?? undefined,
    entityType: "skip_trace",
    entityId: String(resultId),
    metadata: { leadId, phonesFound },
  });
}

export function emitStandaloneOrderCreated(
  orderId: number,
  amount: number,
  cardId: number
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.STANDALONE_ORDER_CREATED,
    sourceModule: "standalone-cards",
    entityType: "standalone_order",
    entityId: String(orderId),
    metadata: { amount, cardId },
  });
}

export function emitStandaloneReferralCreated(
  referralId: number,
  referrerUserId: number,
  orderId: number
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.STANDALONE_REFERRAL_CREATED,
    sourceModule: "standalone-cards",
    entityType: "standalone_referral",
    entityId: String(referralId),
    metadata: { referrerUserId, orderId },
  });
}

export function emitStandalonePageView(
  page: string,
  cardSlug?: string,
  referralCode?: string
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.STANDALONE_PAGE_VIEW,
    sourceModule: "standalone-cards",
    metadata: { page, cardSlug, referralCode },
  });
}

// =====================================================================
// LEVEL 3 — Cognitive Loop (Brain Self-Awareness)
// =====================================================================

export function emitEpisodicMemoryCreated(
  subAccountId: number,
  memoryType: string,
  category: string | null,
  sourceEvent: string | null
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.EPISODIC_MEMORY_CREATED,
    sourceModule: "episodic-memory",
    subAccountId,
    metadata: { memoryType, category, sourceEvent },
  });
}

export function emitCognitiveMemoryStored(
  subAccountId: number,
  memoryType: string,
  key: string,
  isUpdate: boolean
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.COGNITIVE_MEMORY_STORED,
    sourceModule: "cognitive-memory",
    subAccountId,
    metadata: { memoryType, key, isUpdate },
  });
}

export function emitRecommendationCreated(
  accountId: number,
  entityType: string,
  recommendationType: string,
  priority: string
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.RECOMMENDATION_CREATED,
    sourceModule: "recommendation-engine",
    subAccountId: accountId,
    entityType,
    metadata: { recommendationType, priority },
  });
}

export function emitRecommendationsBatchGenerated(
  accountId: number,
  totalGenerated: number
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.RECOMMENDATIONS_BATCH_GENERATED,
    sourceModule: "recommendation-engine",
    subAccountId: accountId,
    metadata: { totalGenerated },
  });
}

export function emitStrategicInsightGenerated(
  subAccountId: number,
  insightCount: number,
  healthGrade: string,
  healthScore: number
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.STRATEGIC_INSIGHT_GENERATED,
    sourceModule: "strategic-advisor",
    subAccountId,
    metadata: { insightCount, healthGrade, healthScore },
  });
}

export function emitNetworkBenchmarksComputed(
  benchmarkCount: number,
  patternCount: number
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.NETWORK_BENCHMARKS_COMPUTED,
    sourceModule: "network-intelligence",
    metadata: { benchmarkCount, patternCount },
  });
}

export function emitPlaybookPatternsDerived(
  accountId: number,
  patternsFound: number,
  matchesFound: number
): void {
  emitUniversalEvent({
    eventType: EVENT_TYPES.PLAYBOOK_PATTERNS_DERIVED,
    sourceModule: "cross-platform-patterns",
    subAccountId: accountId,
    metadata: { patternsFound, matchesFound },
  });
}
