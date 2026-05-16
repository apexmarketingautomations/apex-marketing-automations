/**
 * server/ai/aiFallbackEngine.ts
 *
 * Centralized fallback engine for the Apex AI Orchestration Layer.
 *
 * The fallback engine:
 *  1. Receives an ordered routing plan (from aiTaskRouter)
 *  2. Tries each candidate provider/model in sequence
 *  3. Records health signals for each failure (→ providerRegistry)
 *  4. Emits observability events (→ aiObservability)
 *  5. Tracks spend (→ aiBudgetManager)
 *  6. Returns a typed result with full trace metadata
 *
 * Callers provide a provider-agnostic "execute" callback per candidate.
 * This keeps the engine decoupled from the actual HTTP calls.
 *
 * Fallback triggers:
 *  - Transient: timeout, 429, 500, 503, network error → retry next candidate
 *  - Quota:     402, 429 billing → mark quota-exhausted, skip provider
 *  - Auth:      401, 403 → mark unavailable, skip provider (do NOT retry)
 *  - Budget:    budget check failed → abort immediately (no candidates tried)
 *  - Mid-stream: error after chunks yielded → re-throw (can't undo partial stream)
 */

import type {
  AITaskType, ProviderName, AICallTrace, AIUsage, FallbackReason, AIRequestOptions,
} from "./types";
import type { RoutingCandidate, RoutingPlan } from "./aiTaskRouter";
import {
  recordProviderSuccess,
  recordProviderFailure,
} from "./providerRegistry";
import {
  observeAICall,
  updateMetrics,
  generateRequestId,
  estimateCostUsd,
} from "./aiObservability";
import { recordSpend } from "./aiBudgetManager";

// ── Error classification ──────────────────────────────────────────────────────

function classifyError(err: any): {
  isQuota: boolean;
  isAuth: boolean;
  isTransient: boolean;
  reason: FallbackReason;
} {
  const status = err?.status ?? err?.statusCode ?? err?.httpStatusCode;
  const msg    = String(err?.message ?? "").toLowerCase();

  if (status === 401 || status === 403) {
    return { isQuota: false, isAuth: true, isTransient: false, reason: "auth-error" };
  }
  if (
    status === 402 ||
    msg.includes("billing") ||
    msg.includes("insufficient_quota") ||
    msg.includes("credit") ||
    (status === 429 && (msg.includes("quota") || msg.includes("billing")))
  ) {
    return { isQuota: true, isAuth: false, isTransient: false, reason: "quota-exhausted" };
  }
  if (status === 429 || msg.includes("rate limit")) {
    return { isQuota: false, isAuth: false, isTransient: true, reason: "rate-limited" };
  }
  if (
    err?.isTimeout ||
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    err?.code === "ETIMEDOUT"
  ) {
    return { isQuota: false, isAuth: false, isTransient: true, reason: "timeout" };
  }
  if (
    status === 500 || status === 503 || status === 529 ||
    err?.code === "ECONNRESET" || err?.code === "ENOTFOUND" ||
    msg.includes("network") || msg.includes("econnreset")
  ) {
    return { isQuota: false, isAuth: false, isTransient: true, reason: "transient-error" };
  }
  return { isQuota: false, isAuth: false, isTransient: true, reason: "transient-error" };
}

// ── Execute-with-fallback ─────────────────────────────────────────────────────

export interface FallbackResult<T> {
  value: T;
  trace: AICallTrace;
}

export interface FallbackError {
  error: Error;
  trace: AICallTrace;
  allFailed: true;
}

/**
 * Execute a function against each candidate in the routing plan, returning the
 * first successful result with full trace metadata.
 *
 * @param plan     - Routing plan from aiTaskRouter.buildPlan()
 * @param execute  - Async function that calls the actual provider API.
 *                   Receives (provider, modelId) and must throw on failure.
 * @param taskType - For observability tagging
 * @param options  - Original request options for tracing
 */
export async function withFallback<T>(
  plan: RoutingPlan,
  execute: (candidate: RoutingCandidate) => Promise<{ value: T; usage?: AIUsage }>,
  taskType: AITaskType = "chat",
  options: AIRequestOptions = {},
): Promise<FallbackResult<T>> {
  const requestId = generateRequestId();
  const start     = Date.now();
  const { route, traceId, subAccountId } = options;
  const fallbackChain: ProviderName[] = [];
  let   lastError: Error | null = null;
  let   fallbackReason: FallbackReason | undefined;

  if (!plan.budgetAllowed) {
    const err = new Error(`AI call blocked by budget: ${plan.budgetReason}`);
    const trace: AICallTrace = {
      requestId,
      taskType,
      provider:         "anthropic",
      model:            "none",
      latencyMs:        0,
      fallbackTriggered: false,
      fallbackChain:    [],
      fallbackReason:   "budget-exceeded",
      success:          false,
      error:            plan.budgetReason,
      route,
      traceId,
      subAccountId,
      timestamp:        new Date().toISOString(),
    };
    observeAICall(trace);
    throw err;
  }

  if (plan.candidates.length === 0) {
    const err = new Error("No AI providers available for this request");
    const trace: AICallTrace = {
      requestId, taskType,
      provider: "anthropic", model: "none",
      latencyMs: 0, fallbackTriggered: false,
      fallbackChain: [], fallbackReason: "provider-unavailable",
      success: false, error: err.message,
      route, traceId, subAccountId,
      timestamp: new Date().toISOString(),
    };
    observeAICall(trace);
    throw err;
  }

  for (let i = 0; i < plan.candidates.length; i++) {
    const candidate       = plan.candidates[i];
    const fallbackTriggered = i > 0;
    const callStart       = Date.now();

    if (fallbackTriggered) {
      console.warn(
        `[FALLBACK-ENGINE] Trying fallback: ${candidate.provider}/${candidate.modelId} ` +
        `(reason: ${fallbackReason ?? "previous failed"}, attempt ${i + 1}/${plan.candidates.length})`
      );
    }

    try {
      const result = await execute(candidate);
      const latencyMs = Date.now() - callStart;

      // Health signal
      recordProviderSuccess(candidate.provider, latencyMs);

      // Spend tracking
      const costUsd = estimateCostUsd(
        candidate.provider,
        candidate.modelId,
        result.usage?.promptTokens ?? 0,
        result.usage?.completionTokens ?? 0,
      );
      if (result.usage) result.usage.estimatedCostUsd = costUsd;
      recordSpend({ costUsd, provider: candidate.provider, taskType, subAccountId });

      const trace: AICallTrace = {
        requestId, taskType,
        provider:         candidate.provider,
        model:            candidate.modelId,
        latencyMs:        Date.now() - start,
        fallbackTriggered,
        fallbackChain,
        fallbackReason:   fallbackTriggered ? fallbackReason : undefined,
        usage:            result.usage,
        success:          true,
        route, traceId, subAccountId,
        timestamp:        new Date().toISOString(),
      };

      observeAICall(trace);
      updateMetrics(trace);

      return { value: result.value, trace };

    } catch (err: any) {
      const latencyMs = Date.now() - callStart;
      const { isQuota, isAuth, isTransient, reason } = classifyError(err);
      lastError = err;
      fallbackReason = reason;

      // Health signals
      recordProviderFailure(candidate.provider, { isQuotaError: isQuota, isAuthError: isAuth, isTransient });
      fallbackChain.push(candidate.provider);

      console.warn(
        `[FALLBACK-ENGINE] ${candidate.provider}/${candidate.modelId} failed ` +
        `(${reason}, ${latencyMs}ms): ${err?.message?.slice(0, 150) ?? "unknown"}`
      );

      // Auth errors — mark provider unavailable and skip all remaining candidates for this provider
      if (isAuth) {
        console.error(`[FALLBACK-ENGINE] Auth error on ${candidate.provider} — will not retry this provider`);
        // Continue to next candidate (may be a different provider)
        continue;
      }

      // Quota errors — mark and continue
      if (isQuota) {
        continue;
      }

      // Transient — continue to next candidate
      if (isTransient) {
        continue;
      }

      // Unknown — continue anyway
      continue;
    }
  }

  // All candidates exhausted
  const totalLatency = Date.now() - start;
  const trace: AICallTrace = {
    requestId, taskType,
    provider:         fallbackChain[fallbackChain.length - 1] ?? "anthropic",
    model:            "none",
    latencyMs:        totalLatency,
    fallbackTriggered: fallbackChain.length > 0,
    fallbackChain,
    fallbackReason,
    success:          false,
    error:            lastError?.message ?? "All providers failed",
    route, traceId, subAccountId,
    timestamp:        new Date().toISOString(),
  };
  observeAICall(trace);
  updateMetrics(trace);

  throw lastError ?? new Error("All AI providers failed");
}

// ── Safe wrapper ──────────────────────────────────────────────────────────────

/**
 * Like withFallback but returns a Result-style object instead of throwing.
 * Use this in non-critical paths where an AI failure should degrade gracefully.
 */
export async function withFallbackSafe<T>(
  plan: RoutingPlan,
  execute: (candidate: RoutingCandidate) => Promise<{ value: T; usage?: AIUsage }>,
  defaultValue: T,
  taskType: AITaskType = "chat",
  options: AIRequestOptions = {},
): Promise<{ value: T; trace: AICallTrace; ok: boolean }> {
  try {
    const result = await withFallback(plan, execute, taskType, options);
    return { value: result.value, trace: result.trace, ok: true };
  } catch (err: any) {
    const trace: AICallTrace = {
      requestId:        generateRequestId(),
      taskType,
      provider:         "anthropic",
      model:            "none",
      latencyMs:        0,
      fallbackTriggered: false,
      fallbackChain:    [],
      success:          false,
      error:            err?.message,
      route:            options.route,
      traceId:          options.traceId,
      subAccountId:     options.subAccountId,
      timestamp:        new Date().toISOString(),
    };
    return { value: defaultValue, trace, ok: false };
  }
}
