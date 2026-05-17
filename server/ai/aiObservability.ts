/**
 * server/ai/aiObservability.ts
 *
 * Observability for every AI call in the Apex AI Orchestration Layer.
 *
 * Emits structured logs that Axiom picks up via the Railway log drain.
 * Sends errors to Sentry when available.
 *
 * Design principles:
 *  - NEVER throw — observability must never break the hot path
 *  - All Axiom/Sentry calls are fire-and-forget (no await in hot path)
 *  - Fields are snake_case for Axiom APL query compatibility
 *  - Log lines prefixed with [AI-OBS] for easy grep
 */

import crypto from "crypto";
import type { AICallTrace, AITaskType, ProviderName } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const LOG_TAG = "AI-OBS";

// Axiom ingest — populated from env at startup
let _axiomEndpoint: string | null = null;
let _axiomToken: string | null = null;
let _axiomEnabled = false;

function initAxiom(): void {
  _axiomEndpoint = process.env.AXIOM_INGEST_URL || "https://api.axiom.co/v1/datasets/apex-logs/ingest";
  _axiomToken    = process.env.AXIOM_INGEST_TOKEN || process.env.AXIOM_TOKEN || null;
  _axiomEnabled  = !!_axiomToken;
  if (!_axiomEnabled) {
    console.log(`[${LOG_TAG}] Axiom not configured — AI calls will be logged to stdout only`);
  }
}

// Lazy init on first use
let _initialized = false;
function ensureInit(): void {
  if (_initialized) return;
  _initialized = true;
  initAxiom();
}

// ── Request ID generation ─────────────────────────────────────────────────────

export function generateRequestId(): string {
  return crypto.randomBytes(8).toString("hex");
}

// ── Cost estimation ───────────────────────────────────────────────────────────

/** Cost per 1k tokens by provider+model (USD). Used when usage is known. */
const COST_TABLE: Record<string, { input: number; output: number }> = {
  // Anthropic
  "anthropic:claude-sonnet-4-6":           { input: 0.003,    output: 0.015 },
  "anthropic:claude-3-5-haiku-20241022":   { input: 0.0008,   output: 0.004 },
  "anthropic:claude-opus-4-5":             { input: 0.015,    output: 0.075 },
  // OpenAI
  "openai:gpt-4o-mini":                    { input: 0.00015,  output: 0.0006 },
  "openai:gpt-4o":                         { input: 0.0025,   output: 0.01 },
  "openai:text-embedding-3-small":         { input: 0.00002,  output: 0 },
  "openai:text-embedding-3-large":         { input: 0.00013,  output: 0 },
  // Gemini
  "gemini:gemini-2.5-flash":               { input: 0.000075, output: 0.0003 },
};

export function estimateCostUsd(
  provider: ProviderName,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const key = `${provider}:${model}`;
  const rate = COST_TABLE[key];
  if (!rate) return 0;
  return (promptTokens / 1000) * rate.input + (completionTokens / 1000) * rate.output;
}

// ── Core observability entry point ────────────────────────────────────────────

/** Emit a structured log entry for one AI call. Non-blocking. */
export function observeAICall(trace: AICallTrace): void {
  ensureInit();

  // Estimate cost if not already set
  if (trace.usage && !trace.usage.estimatedCostUsd) {
    trace.usage.estimatedCostUsd = estimateCostUsd(
      trace.provider,
      trace.model,
      trace.usage.promptTokens ?? 0,
      trace.usage.completionTokens ?? 0,
    );
  }

  // Structured stdout log — picked up by Axiom Railway drain
  const logEntry = {
    _time:              trace.timestamp,
    type:               "ai_call",
    request_id:         trace.requestId,
    task_type:          trace.taskType ?? "chat",
    provider:           trace.provider,
    model:              trace.model,
    latency_ms:         trace.latencyMs,
    success:            trace.success,
    fallback_triggered: trace.fallbackTriggered,
    fallback_chain:     trace.fallbackChain.join("→"),
    fallback_reason:    trace.fallbackReason ?? null,
    prompt_tokens:      trace.usage?.promptTokens ?? null,
    completion_tokens:  trace.usage?.completionTokens ?? null,
    total_tokens:       trace.usage?.totalTokens ?? null,
    estimated_cost_usd: trace.usage?.estimatedCostUsd ?? null,
    route:              trace.route ?? null,
    trace_id:           trace.traceId ?? null,
    sub_account_id:     trace.subAccountId ?? null,
    error:              trace.error ?? null,
  };

  console.log(`[${LOG_TAG}] ${JSON.stringify(logEntry)}`);

  // Fire-and-forget to Axiom
  if (_axiomEnabled) {
    // allow-silent-catch: Axiom is non-critical observability — never break the AI call
    sendToAxiom(logEntry).catch(() => {});
  }

  // Send errors to Sentry
  if (!trace.success && trace.error) {
    // allow-silent-catch: Sentry is non-critical — never break the AI call
    sendErrorToSentry(trace).catch(() => {});
  }
}

/** Log a warning-level AI event (e.g., soft budget limit). */
export function observeAIWarning(
  context: {
    requestId: string;
    provider: ProviderName;
    model: string;
    route?: string;
    traceId?: string;
    subAccountId?: string | number;
    warning: string;
  }
): void {
  ensureInit();
  console.warn(
    `[${LOG_TAG}] AI_WARNING requestId=${context.requestId} provider=${context.provider} ` +
    `model=${context.model} route=${context.route ?? "?"} warning=${context.warning}`
  );
}

// ── Axiom ingest ──────────────────────────────────────────────────────────────

async function sendToAxiom(entry: Record<string, unknown>): Promise<void> {
  if (!_axiomEndpoint || !_axiomToken) return;
  await fetch(_axiomEndpoint, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${_axiomToken}`,
    },
    body: JSON.stringify([entry]),
    signal: AbortSignal.timeout(5_000),
  });
}

// ── Sentry integration ────────────────────────────────────────────────────────

async function sendErrorToSentry(trace: AICallTrace): Promise<void> {
  // Dynamically import Sentry so we don't hard-dep it — if not installed, silently skip
  let Sentry: any;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — optional dep; silently skipped if not installed
    Sentry = await import("@sentry/node");
  } catch { // allow-silent-catch: Sentry SDK not installed — skip error reporting
    return;
  }

  Sentry.withScope((scope: any) => {
    scope.setTag("ai.provider", trace.provider);
    scope.setTag("ai.model", trace.model);
    scope.setTag("ai.task_type", trace.taskType ?? "chat");
    scope.setTag("ai.route", trace.route ?? "unknown");
    scope.setTag("ai.fallback_triggered", String(trace.fallbackTriggered));
    scope.setExtra("ai.latency_ms", trace.latencyMs);
    scope.setExtra("ai.fallback_chain", trace.fallbackChain.join("→"));
    scope.setExtra("ai.fallback_reason", trace.fallbackReason ?? null);
    scope.setExtra("ai.usage", trace.usage ?? null);
    scope.setExtra("ai.request_id", trace.requestId);
    if (trace.subAccountId) scope.setExtra("sub_account_id", trace.subAccountId);
    Sentry.captureException(new Error(`AI call failed: [${trace.provider}/${trace.model}] ${trace.error}`));
  });
}

// ── Provider startup observability ────────────────────────────────────────────

/**
 * Log the current provider status at startup.
 * Called from aiGateway.logProviderStartup() — delegates here for structured output.
 */
export function logProviderStatusAtStartup(providers: {
  name: ProviderName;
  configured: boolean;
  isPrimary: boolean;
  modelId?: string;
}[]): void {
  ensureInit();

  const lines = providers.map(p =>
    `${p.isPrimary ? "[PRIMARY]" : "[FALLBACK]"} ${p.name}: ${p.configured ? "✓" : "✗ not configured"}` +
    (p.modelId ? ` model=${p.modelId}` : "")
  );

  console.log(`[${LOG_TAG}] Provider status at startup:`);
  for (const line of lines) {
    console.log(`[${LOG_TAG}]   ${line}`);
  }
}

// ── Aggregate metric helpers ──────────────────────────────────────────────────

/** A lightweight in-memory counter for the current process lifetime. */
interface ProcessMetrics {
  totalCalls:     number;
  totalSuccesses: number;
  totalFailures:  number;
  totalFallbacks: number;
  estimatedCostUsd: number;
  callsByProvider: Record<string, number>;
  callsByTaskType: Record<string, number>;
}

const _metrics: ProcessMetrics = {
  totalCalls:       0,
  totalSuccesses:   0,
  totalFailures:    0,
  totalFallbacks:   0,
  estimatedCostUsd: 0,
  callsByProvider:  {},
  callsByTaskType:  {},
};

export function updateMetrics(trace: AICallTrace): void {
  _metrics.totalCalls++;
  if (trace.success) _metrics.totalSuccesses++;
  else               _metrics.totalFailures++;
  if (trace.fallbackTriggered) _metrics.totalFallbacks++;
  _metrics.estimatedCostUsd += trace.usage?.estimatedCostUsd ?? 0;
  _metrics.callsByProvider[trace.provider] = (_metrics.callsByProvider[trace.provider] ?? 0) + 1;
  const tt = trace.taskType ?? "chat";
  _metrics.callsByTaskType[tt] = (_metrics.callsByTaskType[tt] ?? 0) + 1;
}

export function getProcessMetrics(): Readonly<ProcessMetrics> {
  return { ..._metrics };
}
