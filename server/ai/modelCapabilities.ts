/**
 * server/ai/modelCapabilities.ts
 *
 * Capability-based routing map for the Apex AI Orchestration Layer.
 *
 * Maps task types → required capabilities → preferred providers → preferred models.
 * The Task Router uses these mappings to build ordered candidate lists.
 *
 * Design:
 *  - Static config — no DB, no env coupling
 *  - Providers are ordered by preference within each task type
 *  - All routing decisions are observable (logged at DEBUG level)
 */

import type { AITaskType, ModelCapability, ProviderName } from "./types";

// ── Task → capability mapping ─────────────────────────────────────────────────

/**
 * What capabilities are REQUIRED for each task type.
 * A provider is only eligible if its current models cover all required caps.
 */
export const TASK_REQUIRED_CAPABILITIES: Record<AITaskType, ModelCapability[]> = {
  "reasoning":          ["structured-json", "function-calling"],
  "extraction":         ["structured-json"],
  "ocr-assist":         ["image-input"],
  "embeddings":         ["embeddings"],
  "classification":     ["structured-json"],
  "scoring":            ["structured-json"],
  "summarization":      [],  // any provider works
  "workflow-analysis":  ["structured-json", "long-context"],
  "semantic-retrieval": [],  // reranking is done locally; any provider for generation
  "image-generation":   ["image-output"],
  "chat":               [],  // any provider works
  "code":               ["structured-json"],
  "reranking":          [],  // local or any
};

// ── Task → provider preference ────────────────────────────────────────────────

/**
 * Ordered preference list of providers for each task type.
 * The Task Router picks the first available provider from this list.
 *
 * Reasoning:
 *  - reasoning / workflow-analysis → Anthropic (best CoT); fallback to GPT-4o then Gemini
 *  - embeddings → OpenAI text-embedding; fallback to Gemini embedding; local Ollama as last resort
 *  - image-generation → OpenAI DALL-E 3; fallback to Gemini
 *  - ocr-assist → Gemini (1M context, multimodal); fallback to Anthropic Claude
 *  - classification/scoring → Anthropic (reliable JSON); fallback to GPT-4o-mini (cheap)
 *  - summarization/chat → Anthropic first; GPT-4o-mini as cheap fallback
 */
export const TASK_PROVIDER_PREFERENCE: Record<AITaskType, ProviderName[]> = {
  "reasoning":          ["anthropic", "openai", "gemini"],
  "extraction":         ["anthropic", "openai", "gemini"],
  "ocr-assist":         ["gemini",    "anthropic"],
  "embeddings":         ["openai",    "gemini",    "ollama"],
  "classification":     ["anthropic", "groq", "openai", "gemini"],
  "scoring":            ["anthropic", "groq", "openai", "gemini"],
  "summarization":      ["anthropic", "groq", "openai", "gemini"],
  "workflow-analysis":  ["anthropic", "openai",    "gemini"],
  "semantic-retrieval": ["anthropic", "openai",    "gemini"],
  "image-generation":   ["openai",    "gemini"],
  "chat":               ["anthropic", "openai",    "gemini"],
  "code":               ["anthropic", "openai",    "gemini"],
  "reranking":          ["ollama",    "anthropic", "openai", "gemini"],
};

// ── Task → preferred model overrides ─────────────────────────────────────────

/**
 * Preferred model IDs per provider per task type.
 * If a provider has no override here, the registry picks its highest-quality
 * model that has the required capabilities.
 */
export const TASK_MODEL_OVERRIDES: Partial<Record<AITaskType, Partial<Record<ProviderName, string>>>> = {
  // deep_reasoning → REASONING (120B via Groq)
  "reasoning": {
    anthropic: "claude-sonnet-4-6",
    groq:      "openai/gpt-oss-120b",
    openai:    "gpt-4o",
  },
  "extraction": {
    anthropic: "claude-sonnet-4-6",
    openai:    "gpt-4o-mini",
  },
  "ocr-assist": {
    gemini:    "gemini-2.5-flash",
    anthropic: "claude-sonnet-4-6",
  },
  "embeddings": {
    openai:    "text-embedding-3-small",
    gemini:    "gemini-embedding-exp",
    ollama:    "nomic-embed-text",
  },
  // lead_classification → FAST (8B instant)
  "classification": {
    anthropic: "claude-3-5-haiku-20241022",
    groq:      "llama-3.1-8b-instant",
    openai:    "gpt-4o-mini",
  },
  // scoring uses FAST too — high volume, low stakes
  "scoring": {
    anthropic: "claude-3-5-haiku-20241022",
    groq:      "llama-3.1-8b-instant",
    openai:    "gpt-4o-mini",
  },
  // case_analysis / summarization → SMART (70B versatile)
  "summarization": {
    anthropic: "claude-3-5-haiku-20241022",
    groq:      "llama-3.3-70b-versatile",
    openai:    "gpt-4o-mini",
    gemini:    "gemini-2.5-flash",
  },
  "workflow-analysis": {
    anthropic: "claude-sonnet-4-6",
    openai:    "gpt-4o",
    gemini:    "gemini-2.5-flash",
  },
  "image-generation": {
    openai:    "dall-e-3",
    gemini:    "gemini-2.0-flash-exp",
  },
  "chat": {
    anthropic: "claude-sonnet-4-6",
    openai:    "gpt-4o-mini",
    gemini:    "gemini-2.5-flash",
  },
  "code": {
    anthropic: "claude-sonnet-4-6",
    openai:    "gpt-4o",
  },
  "reranking": {
    ollama:    "llama3.2:3b",
    anthropic: "claude-3-5-haiku-20241022",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get the ordered provider preference list for a task type. */
export function getProviderPreference(taskType: AITaskType): ProviderName[] {
  return TASK_PROVIDER_PREFERENCE[taskType] ?? ["anthropic", "openai", "gemini"];
}

/** Get required capabilities for a task type. */
export function getRequiredCapabilities(taskType: AITaskType): ModelCapability[] {
  return TASK_REQUIRED_CAPABILITIES[taskType] ?? [];
}

/** Get the preferred model ID for a given task + provider combination. */
export function getPreferredModel(
  taskType: AITaskType,
  provider: ProviderName,
): string | undefined {
  return TASK_MODEL_OVERRIDES[taskType]?.[provider];
}

/**
 * Build a complete routing plan for a task: ordered list of {provider, modelId} tuples.
 * Does NOT check health — that is the Task Router's job.
 */
export function buildRoutingPlan(
  taskType: AITaskType,
): Array<{ provider: ProviderName; modelId: string }> {
  const providers = getProviderPreference(taskType);
  const plan: Array<{ provider: ProviderName; modelId: string }> = [];

  for (const provider of providers) {
    const modelId = getPreferredModel(taskType, provider);
    if (modelId) {
      plan.push({ provider, modelId });
    }
  }

  return plan;
}

/** Whether a given task type requires image input capability. */
export function isImageInputRequired(taskType: AITaskType): boolean {
  return getRequiredCapabilities(taskType).includes("image-input");
}

/** Whether a given task type is embedding-only. */
export function isEmbeddingTask(taskType: AITaskType): boolean {
  return taskType === "embeddings";
}

/** Whether a given task type produces image output. */
export function isImageGenerationTask(taskType: AITaskType): boolean {
  return taskType === "image-generation";
}
