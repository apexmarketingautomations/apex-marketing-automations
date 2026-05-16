/**
 * server/ai/agentCoordinator.ts
 *
 * Agent Execution Coordinator
 *
 * Central entry point for all specialized AI agent calls.
 * Orchestrates:
 *   1. Policy check (executionPolicyEngine)
 *   2. Budget check (aiBudgetManager)
 *   3. Agent execution with timeout
 *   4. Structured output validation
 *   5. Persistent audit trail write (auditTrailService)
 *   6. Provider health signal recording
 *
 * All agents are invoked through runAgent() — never called directly by routes.
 * This guarantees that every AI action is policy-gated, audited, and budget-bounded.
 */

import { randomUUID } from "crypto";
import { aiChat } from "../aiGateway";
import { checkBudget, recordSpend } from "./aiBudgetManager";
import { checkExecutionPolicy, assertTenantBoundary } from "./executionPolicyEngine";
import { writeAuditEntry } from "./auditTrailService";
import { parseStructuredOutput } from "./aiStructuredOutput";
import { buildPlan } from "./aiTaskRouter";
import { recordProviderSuccess, recordProviderFailure } from "./providerRegistry";
import type { AITaskType, ProviderName, Validator } from "./types";
import type { PolicyContext, AIAction } from "./executionPolicyEngine";

// ── Agent definition ──────────────────────────────────────────────────────────

export interface AgentDefinition<TOutput> {
  name: string;
  taskType: AITaskType;
  promptVersion: string;
  /** Build the system + user prompt from the input. */
  buildPrompt(input: unknown): { system: string; user: string };
  /** Output schema validator — returns true if output is valid. */
  outputValidator: Validator<TOutput>;
  /** Actions this agent may request. Policy engine will check each. */
  requestedActions?: AIAction[];
  /** Default confidence if model doesn't supply one (0–1). */
  defaultConfidence?: number;
  /** Max retries on invalid structured output. Default 2. */
  maxParseAttempts?: number;
  /** Timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Whether this agent requires human approval before its output is acted on. */
  requiresApproval?: boolean;
}

export interface AgentRunOptions {
  subAccountId?: number | string;
  workflowId?: string;
  workflowApproved?: boolean;
  callerRole?: PolicyContext["callerRole"];
  callDepth?: number;
  traceId?: string;
}

export interface AgentResult<TOutput> {
  ok: boolean;
  output?: TOutput;
  confidence?: number;
  approvalRequired?: boolean;
  approvalState?: "auto" | "pending" | "rejected";
  provider?: ProviderName;
  model?: string;
  latencyMs?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  parseAttempts?: number;
  error?: string;
  traceId: string;
  requestId: string;
}

// ── Core executor ─────────────────────────────────────────────────────────────

export async function runAgent<TOutput>(
  agent: AgentDefinition<TOutput>,
  input: unknown,
  opts: AgentRunOptions = {},
): Promise<AgentResult<TOutput>> {
  const traceId   = opts.traceId ?? randomUUID();
  const requestId = randomUUID();
  const start     = Date.now();

  // 1. Policy check
  const policy = checkExecutionPolicy({
    subAccountId:     opts.subAccountId,
    taskType:         agent.taskType,
    agentName:        agent.name,
    requestedActions: agent.requestedActions,
    callDepth:        opts.callDepth ?? 0,
    workflowApproved: opts.workflowApproved,
    callerRole:       opts.callerRole ?? "system",
  });

  if (!policy.allowed) {
    await writeAuditEntry({
      traceId, requestId,
      provider: "anthropic", model: "n/a",
      taskType: agent.taskType, agentName: agent.name,
      subAccountId: opts.subAccountId,
      promptVersion: agent.promptVersion,
      outputValid: false, fallbackTriggered: false,
      approvalRequired: policy.approvalRequired,
      approvalState: policy.approvalState,
      success: false, errorMessage: policy.reason,
    });
    return { ok: false, error: policy.reason, traceId, requestId };
  }

  // 2. Budget check
  const budget = await checkBudget({
    subAccountId: opts.subAccountId,
    taskType:     agent.taskType,
    maxCostPerCallUsd: 0.50,
  });

  if (!budget.allowed) {
    await writeAuditEntry({
      traceId, requestId,
      provider: "anthropic", model: "n/a",
      taskType: agent.taskType, agentName: agent.name,
      subAccountId: opts.subAccountId,
      promptVersion: agent.promptVersion,
      outputValid: false, fallbackTriggered: false,
      success: false, errorMessage: budget.reason,
    });
    return { ok: false, error: budget.reason ?? "budget_exceeded", traceId, requestId };
  }

  // 3. Build prompt
  const { system, user } = agent.buildPrompt(input);
  const maxAttempts = agent.maxParseAttempts ?? 2;
  const timeoutMs   = agent.timeoutMs ?? 30_000;

  // 4. Get routing plan for best available provider/model
  const plan = buildPlan({ taskType: agent.taskType, jsonMode: true });
  const primary = plan.candidates[0];
  const provider: ProviderName = (primary?.provider ?? "anthropic") as ProviderName;
  const model    = primary?.modelId ?? "claude-3-5-haiku-20241022";

  let lastRaw = "";
  let parseAttempts = 0;
  let output: TOutput | undefined;
  let outputValid = false;
  let errorMsg: string | undefined;
  let totalTokens: number | undefined;
  let estimatedCostUsd: number | undefined;
  let fallbackTriggered = false;

  // 5. Execute with retries on invalid output
  for (let attempt = 1; attempt <= maxAttempts + 1; attempt++) {
    parseAttempts = attempt;
    const retryNote = attempt > 1
      ? `\n\nPrevious attempt produced invalid JSON. You MUST respond with valid JSON only. No prose, no markdown. Previous output was: ${lastRaw.substring(0, 200)}`
      : "";

    try {
      const response = await withTimeout(
        aiChat(
          [
            { role: "system", content: system },
            { role: "user",   content: user + retryNote },
          ],
          { taskType: agent.taskType, jsonMode: true, timeoutMs, maxTokens: 4096 },
        ),
        timeoutMs,
      );

      lastRaw       = response.content;
      totalTokens   = response.usage?.totalTokens;
      estimatedCostUsd = estimateCost(model, response.usage);

      // Update health signal
      recordProviderSuccess(provider, Date.now() - start);

      // Validate structured output
      const parsed = parseStructuredOutput<TOutput>(lastRaw, agent.outputValidator);
      if (parsed.valid && parsed.data != null) {
        output      = parsed.data;
        outputValid = true;
        break;
      }
      errorMsg = parsed.parseError ?? "invalid_output";

    } catch (err: any) {
      errorMsg = err?.message ?? String(err);
      recordProviderFailure(provider, err);
      fallbackTriggered = true;
      if (attempt >= maxAttempts + 1) break;
    }
  }

  const latencyMs = Date.now() - start;

  // 6. Record spend
  if (estimatedCostUsd) {
    await recordSpend({
      provider,
      costUsd: estimatedCostUsd,
      subAccountId: opts.subAccountId,
      taskType: agent.taskType,
    });
  }

  // 7. Persist audit entry
  await writeAuditEntry({
    traceId, requestId,
    provider, model,
    taskType: agent.taskType,
    agentName: agent.name,
    subAccountId: opts.subAccountId,
    promptVersion: agent.promptVersion,
    totalTokens,
    estimatedCostUsd,
    latencyMs,
    outputConfidence: outputValid ? (agent.defaultConfidence ?? 0.8) : 0,
    outputValid,
    parseAttempts,
    fallbackTriggered,
    fallbackChain: fallbackTriggered ? [provider] : undefined,
    workflowId: opts.workflowId,
    approvalRequired: policy.approvalRequired || agent.requiresApproval,
    approvalState: policy.approvalState,
    success: outputValid,
    errorMessage: outputValid ? undefined : errorMsg,
  });

  if (!outputValid) {
    return { ok: false, error: errorMsg, traceId, requestId, latencyMs, provider, model };
  }

  return {
    ok: true,
    output,
    confidence: agent.defaultConfidence ?? 0.8,
    approvalRequired: policy.approvalRequired || agent.requiresApproval,
    approvalState: policy.approvalState,
    provider,
    model,
    latencyMs,
    totalTokens,
    estimatedCostUsd,
    parseAttempts,
    traceId,
    requestId,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`agent_timeout_${ms}ms`)), ms)
    ),
  ]);
}

function estimateCost(model: string, usage?: { totalTokens?: number }): number | undefined {
  if (!usage?.totalTokens) return undefined;
  const rates: Record<string, number> = {
    "claude-3-5-haiku-20241022": 0.0008,
    "claude-sonnet-4-6":         0.003,
    "gpt-4o-mini":               0.00015,
    "gpt-4o":                    0.0025,
  };
  const rate = rates[model] ?? 0.001;
  return (usage.totalTokens / 1000) * rate;
}
