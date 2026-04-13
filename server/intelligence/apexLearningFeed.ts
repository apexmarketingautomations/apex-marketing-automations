import { emitUniversalEvent, EVENT_TYPES } from "./eventEmitter";

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
