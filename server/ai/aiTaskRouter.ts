/**
 * server/ai/aiTaskRouter.ts
 *
 * Task-aware provider routing for the Apex AI Orchestration Layer.
 *
 * The Task Router takes a task type and produces an ordered list of
 * {provider, modelId} candidates that the fallback engine will try in sequence.
 *
 * Routing decisions factor in:
 *  1. Task-type capability requirements (from modelCapabilities.ts)
 *  2. Provider health (from providerRegistry.ts) — skips open circuits and quota backoffs
 *  3. Provider configuration (is the API key set?)
 *  4. Budget availability (from aiBudgetManager.ts)
 *  5. forceProvider/forceModel overrides (from AIRequestOptions)
 *
 * The router never calls any AI API — it only produces a routing plan.
 */

import type { AITaskType, ProviderName, AIRequestOptions, BudgetContext } from "./types";
import {
  getProviderPreference,
  getPreferredModel,
} from "./modelCapabilities";
import { isProviderAvailable } from "./providerRegistry";
import { checkBudget }         from "./aiBudgetManager";

// ── Provider configuration checks ────────────────────────────────────────────

/** Returns true if the Anthropic API key is present and looks valid. */
function isAnthropicConfigured(): boolean {
  const key = (
    process.env.ANTHROPIC_API_KEY ||
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ||
    ""
  ).trim();
  return key.length > 10;
}

/** Returns true if a valid OpenAI API key is present. */
function isOpenAIConfigured(): boolean {
  const isValidKey = (k: string | undefined) =>
    !!k && k.startsWith("sk-") && !k.startsWith("sk-ant-");
  return (
    isValidKey(process.env.OPENAI_APEX_INT_KEY) ||
    isValidKey(process.env.AI_INTEGRATIONS_OPENAI_API_KEY)
  );
}

/** Returns true if a Gemini API key is present. */
function isGeminiConfigured(): boolean {
  return !!(
    process.env.GEMINI_API_KEY_              ||
    process.env.Gemini_API_Key_saas          ||
    process.env.GEMINI_API_KEY               ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
  );
}

/** Returns true if Ollama is accessible locally. */
function isOllamaConfigured(): boolean {
  return !!(process.env.OLLAMA_BASE_URL || process.env.OLLAMA_ENABLED === "true");
}

function isProviderConfigured(provider: ProviderName): boolean {
  switch (provider) {
    case "anthropic": return isAnthropicConfigured();
    case "openai":    return isOpenAIConfigured();
    case "gemini":    return isGeminiConfigured();
    case "ollama":    return isOllamaConfigured();
  }
}

// ── Routing plan ──────────────────────────────────────────────────────────────

export interface RoutingCandidate {
  provider: ProviderName;
  modelId: string;
  /** Why this candidate was included */
  reason: string;
}

export interface RoutingPlan {
  candidates: RoutingCandidate[];
  /** Budget check result */
  budgetAllowed: boolean;
  budgetReason?: string;
  /** Whether any candidate is available */
  anyAvailable: boolean;
}

/**
 * Build a routing plan for the given task type and options.
 *
 * Returns an ordered list of {provider, modelId} to try.
 * The fallback engine iterates this list until one succeeds.
 */
export function buildPlan(
  taskType: AITaskType = "chat",
  options: AIRequestOptions = {},
): RoutingPlan {
  const { forceProvider, forceModel, subAccountId, budgetContext } = options;

  // 1. Budget check
  const ctx: BudgetContext = { taskType, subAccountId, ...budgetContext };
  const budget = checkBudget(ctx);
  if (!budget.allowed) {
    return {
      candidates:   [],
      budgetAllowed: false,
      budgetReason:  budget.reason,
      anyAvailable:  false,
    };
  }

  // 2. Force override — skip all routing logic
  if (forceProvider || forceModel) {
    const provider = (forceProvider ?? "anthropic") as ProviderName;
    const modelId  = forceModel ?? getPreferredModel(taskType, provider) ?? "claude-sonnet-4-6";
    return {
      candidates:   [{ provider, modelId, reason: "forced" }],
      budgetAllowed: true,
      anyAvailable:  true,
    };
  }

  // 3. Capability-aware provider preference list
  const preferenceOrder = getProviderPreference(taskType);

  const candidates: RoutingCandidate[] = [];

  for (const provider of preferenceOrder) {
    if (!isProviderConfigured(provider)) {
      continue; // silently skip unconfigured providers
    }
    if (!isProviderAvailable(provider)) {
      console.log(
        `[TASK-ROUTER] Skipping ${provider} for task=${taskType} — provider unavailable (circuit/quota)`
      );
      continue;
    }

    const modelId = getPreferredModel(taskType, provider);
    if (!modelId) continue;

    candidates.push({
      provider,
      modelId,
      reason: `preferred for task=${taskType}`,
    });
  }

  // 4. Ensure Gemini is always the last-resort fallback (if configured)
  const hasGemini = candidates.some(c => c.provider === "gemini");
  if (!hasGemini && isGeminiConfigured()) {
    const geminiModel = getPreferredModel(taskType, "gemini") ?? "gemini-2.5-flash";
    candidates.push({
      provider: "gemini",
      modelId:  geminiModel,
      reason:   "last-resort fallback",
    });
  }

  return {
    candidates,
    budgetAllowed: true,
    anyAvailable:  candidates.length > 0,
  };
}

// ── Convenience exports ───────────────────────────────────────────────────────

/** Check if any AI provider is currently configured and available. */
export function isAnyProviderAvailable(): boolean {
  const providers: ProviderName[] = ["anthropic", "openai", "gemini"];
  return providers.some(p => isProviderConfigured(p) && isProviderAvailable(p));
}

/** Get the currently preferred primary provider (first in the "chat" preference list). */
export function getPrimaryProvider(): ProviderName | null {
  const plan = buildPlan("chat");
  return plan.candidates[0]?.provider ?? null;
}

/** Log routing decisions for debugging. */
export function logRoutingPlan(taskType: AITaskType, plan: RoutingPlan): void {
  if (!plan.anyAvailable) {
    console.warn(
      `[TASK-ROUTER] No available provider for task=${taskType} ` +
      (plan.budgetAllowed ? "(routing constraints)" : `(budget: ${plan.budgetReason})`)
    );
    return;
  }
  const chain = plan.candidates.map(c => `${c.provider}/${c.modelId}`).join(" → ");
  console.log(`[TASK-ROUTER] task=${taskType} plan: ${chain}`);
}
