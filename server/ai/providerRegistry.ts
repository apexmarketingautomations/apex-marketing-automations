/**
 * server/ai/providerRegistry.ts
 *
 * Provider registry for the Apex AI Orchestration Layer.
 *
 * Responsibilities:
 *  - Self-registration of providers with capability profiles
 *  - Health tracking: consecutive failures, circuit breaker timestamps, error rates
 *  - Cost profiles per model (used by budget manager)
 *  - Latency profiles (observed p50)
 *  - Rate limit tracking
 *  - Provider selection queries: "give me healthy providers that can do X"
 *
 * Design: in-memory only, process-scoped. Rebuilt at startup.
 * Persistent health history (if needed) lives in the budget manager / DB layer.
 */

import type {
  ProviderName,
  ModelProfile,
  ModelCapability,
  ProviderHealth,
  ProviderHealthStatus,
} from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const CIRCUIT_BREAKER_THRESHOLD  = 5;    // consecutive failures before trip
const CIRCUIT_BREAKER_WINDOW_MS  = 180_000; // 3 min window
const CIRCUIT_BREAKER_COOLDOWN_MS = 120_000; // 2 min cooldown
const QUOTA_COOLDOWN_MS          = 300_000; // 5 min retry after 402/429 billing
const ERROR_RATE_WINDOW          = 100;  // rolling window size
const DEGRADED_THRESHOLD_PCT     = 20;  // >20% error rate = degraded

// ── Built-in model catalogue ──────────────────────────────────────────────────

/** All models the system knows about. New models can be added here. */
const MODEL_CATALOGUE: ModelProfile[] = [
  // ── Anthropic ──────────────────────────────────────────────────────────────
  {
    modelId:       "claude-sonnet-4-6",
    name:          "Claude Sonnet 4.6",
    provider:      "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 8_096,
    capabilities:  ["long-context", "structured-json", "function-calling", "streaming", "image-input"],
    cost:          { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015 },
    p50LatencyMs:  800,
    p99LatencyMs:  4_000,
    qualityTier:   1,
  },
  {
    modelId:       "claude-3-5-haiku-20241022",
    name:          "Claude Haiku 3.5",
    provider:      "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 8_096,
    capabilities:  ["long-context", "structured-json", "function-calling", "streaming", "low-cost", "low-latency"],
    cost:          { inputPer1kTokens: 0.0008, outputPer1kTokens: 0.004 },
    p50LatencyMs:  350,
    p99LatencyMs:  2_000,
    qualityTier:   2,
  },
  {
    modelId:       "claude-opus-4-5",
    name:          "Claude Opus 4.5",
    provider:      "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 32_768,
    capabilities:  ["long-context", "structured-json", "function-calling", "streaming", "image-input"],
    cost:          { inputPer1kTokens: 0.015, outputPer1kTokens: 0.075 },
    p50LatencyMs:  1_200,
    p99LatencyMs:  8_000,
    qualityTier:   1,
  },
  // ── OpenAI ─────────────────────────────────────────────────────────────────
  {
    modelId:       "gpt-4o-mini",
    name:          "GPT-4o mini",
    provider:      "openai",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    capabilities:  ["long-context", "structured-json", "function-calling", "streaming", "low-cost", "low-latency"],
    cost:          { inputPer1kTokens: 0.00015, outputPer1kTokens: 0.0006 },
    p50LatencyMs:  400,
    p99LatencyMs:  3_000,
    qualityTier:   2,
  },
  {
    modelId:       "gpt-4o",
    name:          "GPT-4o",
    provider:      "openai",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    capabilities:  ["long-context", "structured-json", "function-calling", "streaming", "image-input"],
    cost:          { inputPer1kTokens: 0.0025, outputPer1kTokens: 0.01 },
    p50LatencyMs:  600,
    p99LatencyMs:  5_000,
    qualityTier:   1,
  },
  {
    modelId:       "dall-e-3",
    name:          "DALL-E 3",
    provider:      "openai",
    contextWindow: 4_000,
    maxOutputTokens: 0,
    capabilities:  ["image-output"],
    cost:          { inputPer1kTokens: 0, outputPer1kTokens: 0 }, // charged per image
    p50LatencyMs:  8_000,
    p99LatencyMs:  20_000,
    qualityTier:   1,
  },
  {
    modelId:       "text-embedding-3-small",
    name:          "text-embedding-3-small",
    provider:      "openai",
    contextWindow: 8_191,
    maxOutputTokens: 0,
    capabilities:  ["embeddings", "low-cost", "low-latency"],
    cost:          { inputPer1kTokens: 0.00002, outputPer1kTokens: 0, embeddingPer1kDims: 0.00002 },
    p50LatencyMs:  200,
    p99LatencyMs:  1_000,
    qualityTier:   3,
  },
  {
    modelId:       "text-embedding-3-large",
    name:          "text-embedding-3-large",
    provider:      "openai",
    contextWindow: 8_191,
    maxOutputTokens: 0,
    capabilities:  ["embeddings"],
    cost:          { inputPer1kTokens: 0.00013, outputPer1kTokens: 0, embeddingPer1kDims: 0.00013 },
    p50LatencyMs:  300,
    p99LatencyMs:  1_500,
    qualityTier:   2,
  },
  // ── Google Gemini ──────────────────────────────────────────────────────────
  {
    modelId:       "gemini-2.5-flash",
    name:          "Gemini 2.5 Flash",
    provider:      "gemini",
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    capabilities:  ["long-context", "structured-json", "function-calling", "streaming", "image-input", "low-cost", "low-latency"],
    cost:          { inputPer1kTokens: 0.000075, outputPer1kTokens: 0.0003 },
    p50LatencyMs:  500,
    p99LatencyMs:  4_000,
    qualityTier:   2,
  },
  {
    modelId:       "gemini-2.0-flash-exp",
    name:          "Gemini 2.0 Flash (image gen)",
    provider:      "gemini",
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    capabilities:  ["image-output", "streaming"],
    cost:          { inputPer1kTokens: 0.0001, outputPer1kTokens: 0.0004 },
    p50LatencyMs:  4_000,
    p99LatencyMs:  15_000,
    qualityTier:   2,
  },
  {
    modelId:       "gemini-embedding-exp",
    name:          "Gemini Embedding (experimental)",
    provider:      "gemini",
    contextWindow: 2_048,
    maxOutputTokens: 0,
    capabilities:  ["embeddings", "low-cost"],
    cost:          { inputPer1kTokens: 0.000025, outputPer1kTokens: 0, embeddingPer1kDims: 0.000025 },
    p50LatencyMs:  300,
    p99LatencyMs:  1_500,
    qualityTier:   3,
  },
  // ── Ollama (local) ─────────────────────────────────────────────────────────
  {
    modelId:       "llama3.2:3b",
    name:          "Llama 3.2 3B (local)",
    provider:      "ollama",
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    capabilities:  ["low-cost", "low-latency", "local", "streaming"],
    cost:          { inputPer1kTokens: 0, outputPer1kTokens: 0 },
    p50LatencyMs:  300,
    p99LatencyMs:  2_000,
    qualityTier:   3,
  },
  {
    modelId:       "nomic-embed-text",
    name:          "Nomic Embed Text (local)",
    provider:      "ollama",
    contextWindow: 8_192,
    maxOutputTokens: 0,
    capabilities:  ["embeddings", "low-cost", "low-latency", "local"],
    cost:          { inputPer1kTokens: 0, outputPer1kTokens: 0, embeddingPer1kDims: 0 },
    p50LatencyMs:  50,
    p99LatencyMs:  300,
    qualityTier:   3,
  },
];

// ── Provider health state ─────────────────────────────────────────────────────

interface ProviderHealthState extends ProviderHealth {
  /** Recent call results for rolling error rate — true=success, false=failure */
  _recentCalls: boolean[];
  /** Failure timestamps within the circuit breaker window */
  _failureTimestamps: number[];
}

const _healthState = new Map<ProviderName, ProviderHealthState>();

function initHealth(provider: ProviderName): ProviderHealthState {
  const state: ProviderHealthState = {
    provider,
    status:                "healthy",
    checkedAt:             new Date(),
    consecutiveFailures:   0,
    circuitTrippedAt:      null,
    quotaResetAt:          null,
    errorRatePct:          0,
    observedP50Ms:         0,
    _recentCalls:          [],
    _failureTimestamps:    [],
  };
  _healthState.set(provider, state);
  return state;
}

function getHealthState(provider: ProviderName): ProviderHealthState {
  return _healthState.get(provider) ?? initHealth(provider);
}

// ── Health mutation ───────────────────────────────────────────────────────────

/** Record a successful call to a provider. Updates error rate and resets failures. */
export function recordProviderSuccess(provider: ProviderName, latencyMs: number): void {
  const s = getHealthState(provider);

  s.consecutiveFailures = 0;
  s.checkedAt = new Date();

  // Rolling window
  s._recentCalls.push(true);
  if (s._recentCalls.length > ERROR_RATE_WINDOW) s._recentCalls.shift();
  const failures = s._recentCalls.filter(x => !x).length;
  s.errorRatePct = Math.round((failures / s._recentCalls.length) * 100);

  // Observed p50 (simple EWMA — α=0.1)
  if (s.observedP50Ms === 0) {
    s.observedP50Ms = latencyMs;
  } else {
    s.observedP50Ms = Math.round(s.observedP50Ms * 0.9 + latencyMs * 0.1);
  }

  // Recover from degraded if error rate is back below threshold
  if (s.status === "degraded" && s.errorRatePct < DEGRADED_THRESHOLD_PCT) {
    s.status = "healthy";
    console.log(`[PROVIDER-REGISTRY] ${provider} recovered from degraded → healthy`);
  }

  // Check circuit breaker cooldown
  if (s.circuitTrippedAt !== null) {
    const age = Date.now() - s.circuitTrippedAt.getTime();
    if (age >= CIRCUIT_BREAKER_COOLDOWN_MS) {
      console.log(`[PROVIDER-REGISTRY] ${provider} circuit breaker auto-reset after ${Math.round(age / 1000)}s`);
      s.circuitTrippedAt = null;
      s._failureTimestamps = [];
      s.status = "healthy";
    }
  }
}

/** Record a failed call. May trip circuit breaker or mark quota-exhausted. */
export function recordProviderFailure(
  provider: ProviderName,
  opts: {
    isQuotaError?: boolean;
    isAuthError?: boolean;
    isTransient?: boolean;
  } = {},
): void {
  const s = getHealthState(provider);
  const now = Date.now();

  s.consecutiveFailures++;
  s.checkedAt = new Date();

  // Rolling window
  s._recentCalls.push(false);
  if (s._recentCalls.length > ERROR_RATE_WINDOW) s._recentCalls.shift();
  const failures = s._recentCalls.filter(x => !x).length;
  s.errorRatePct = Math.round((failures / s._recentCalls.length) * 100);

  if (opts.isQuotaError) {
    s.status = "quota-exhausted";
    s.quotaResetAt = new Date(now + QUOTA_COOLDOWN_MS);
    console.warn(`[PROVIDER-REGISTRY] ${provider} quota exhausted — backing off until ${s.quotaResetAt.toISOString()}`);
    return;
  }

  if (opts.isAuthError) {
    s.status = "unavailable";
    console.error(`[PROVIDER-REGISTRY] ${provider} auth error — marking unavailable`);
    return;
  }

  // Circuit breaker window
  s._failureTimestamps.push(now);
  s._failureTimestamps = s._failureTimestamps.filter(t => now - t < CIRCUIT_BREAKER_WINDOW_MS);

  if (s._failureTimestamps.length >= CIRCUIT_BREAKER_THRESHOLD && s.circuitTrippedAt === null) {
    s.circuitTrippedAt = new Date(now);
    console.warn(
      `[PROVIDER-REGISTRY] ${provider} circuit breaker TRIPPED — ` +
      `${s._failureTimestamps.length} failures in ${CIRCUIT_BREAKER_WINDOW_MS / 1000}s. ` +
      `Cooling off for ${CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s.`
    );
  }

  if (s.errorRatePct >= DEGRADED_THRESHOLD_PCT && s.status === "healthy") {
    s.status = "degraded";
    console.warn(`[PROVIDER-REGISTRY] ${provider} error rate ${s.errorRatePct}% — marking degraded`);
  }
}

/** Force-mark a provider as healthy (e.g., after manual intervention). */
export function markProviderHealthy(provider: ProviderName): void {
  const s = getHealthState(provider);
  s.status = "healthy";
  s.consecutiveFailures = 0;
  s.circuitTrippedAt = null;
  s.quotaResetAt = null;
  s._failureTimestamps = [];
  s.checkedAt = new Date();
  console.log(`[PROVIDER-REGISTRY] ${provider} manually restored to healthy`);
}

// ── Circuit breaker query ─────────────────────────────────────────────────────

/** Returns true if this provider's circuit breaker is open (= provider is bypassed). */
export function isCircuitOpen(provider: ProviderName): boolean {
  const s = getHealthState(provider);
  if (s.circuitTrippedAt === null) return false;

  const age = Date.now() - s.circuitTrippedAt.getTime();
  if (age >= CIRCUIT_BREAKER_COOLDOWN_MS) {
    // Auto-reset
    console.log(`[PROVIDER-REGISTRY] ${provider} circuit breaker auto-reset`);
    s.circuitTrippedAt = null;
    s._failureTimestamps = [];
    if (s.status !== "quota-exhausted" && s.status !== "unavailable") {
      s.status = "healthy";
    }
    return false;
  }
  return true;
}

/** Returns true if the quota backoff window is still active. */
export function isQuotaBackoff(provider: ProviderName): boolean {
  const s = getHealthState(provider);
  if (s.quotaResetAt === null) return false;
  if (Date.now() >= s.quotaResetAt.getTime()) {
    s.quotaResetAt = null;
    if (s.status === "quota-exhausted") {
      s.status = "healthy";
      console.log(`[PROVIDER-REGISTRY] ${provider} quota backoff expired — restoring healthy`);
    }
    return false;
  }
  return true;
}

/** True if the provider can accept requests right now. */
export function isProviderAvailable(provider: ProviderName): boolean {
  if (isCircuitOpen(provider)) return false;
  if (isQuotaBackoff(provider)) return false;
  const s = getHealthState(provider);
  return s.status !== "unavailable";
}

// ── Model catalogue queries ───────────────────────────────────────────────────

/** Get all known models for a provider. */
export function getModelsForProvider(provider: ProviderName): ModelProfile[] {
  return MODEL_CATALOGUE.filter(m => m.provider === provider);
}

/** Get a specific model by ID. */
export function getModel(modelId: string): ModelProfile | undefined {
  return MODEL_CATALOGUE.find(m => m.modelId === modelId);
}

/** Get all models that have a specific capability. */
export function getModelsByCapability(capability: ModelCapability): ModelProfile[] {
  return MODEL_CATALOGUE.filter(m => m.capabilities.includes(capability));
}

/**
 * Get the best available model for a given set of required capabilities.
 * Respects provider health — skips providers with open circuits.
 * Returns in quality-tier order (tier 1 first).
 */
export function getBestAvailableModels(
  requiredCapabilities: ModelCapability[],
  options: {
    excludeProviders?: ProviderName[];
    preferredProviders?: ProviderName[];
    maxQualityTier?: 1 | 2 | 3;
  } = {}
): ModelProfile[] {
  const { excludeProviders = [], preferredProviders = [], maxQualityTier = 3 } = options;

  let candidates = MODEL_CATALOGUE.filter(model => {
    // Must have all required capabilities
    if (!requiredCapabilities.every(cap => model.capabilities.includes(cap))) return false;
    // Must not be excluded
    if (excludeProviders.includes(model.provider)) return false;
    // Must not exceed quality tier limit
    if (model.qualityTier > maxQualityTier) return false;
    // Provider must be available
    if (!isProviderAvailable(model.provider)) return false;
    return true;
  });

  // Sort: preferred providers first, then by quality tier
  candidates.sort((a, b) => {
    const aPreferred = preferredProviders.indexOf(a.provider);
    const bPreferred = preferredProviders.indexOf(b.provider);
    if (aPreferred !== bPreferred) {
      if (aPreferred === -1) return 1;
      if (bPreferred === -1) return -1;
      return aPreferred - bPreferred;
    }
    return a.qualityTier - b.qualityTier;
  });

  return candidates;
}

// ── Health status read ────────────────────────────────────────────────────────

/** Get the current health snapshot for a provider. */
export function getProviderHealth(provider: ProviderName): ProviderHealth {
  const s = getHealthState(provider);
  return {
    provider:             s.provider,
    status:               s.status,
    checkedAt:            s.checkedAt,
    consecutiveFailures:  s.consecutiveFailures,
    circuitTrippedAt:     s.circuitTrippedAt,
    quotaResetAt:         s.quotaResetAt,
    errorRatePct:         s.errorRatePct,
    observedP50Ms:        s.observedP50Ms,
  };
}

/** Get health for all known providers. */
export function getAllProviderHealth(): Record<ProviderName, ProviderHealth> {
  const providers: ProviderName[] = ["anthropic", "openai", "gemini", "ollama"];
  const result: Partial<Record<ProviderName, ProviderHealth>> = {};
  for (const p of providers) {
    result[p] = getProviderHealth(p);
  }
  return result as Record<ProviderName, ProviderHealth>;
}

/** Determine if a provider status is "effectively" healthy for routing. */
export function computeProviderStatus(provider: ProviderName): ProviderHealthStatus {
  if (!isProviderAvailable(provider)) {
    const s = getHealthState(provider);
    if (s.status === "quota-exhausted") return "quota-exhausted";
    return "unavailable";
  }
  const s = getHealthState(provider);
  return s.status;
}

/** Log a startup summary of the registry. */
export function logRegistryStartup(): void {
  const providers: ProviderName[] = ["anthropic", "openai", "gemini"];
  const summary = providers.map(p => {
    const models = getModelsForProvider(p).map(m => m.modelId).join(", ");
    return `${p}: [${models}]`;
  });
  console.log(`[PROVIDER-REGISTRY] Loaded ${MODEL_CATALOGUE.length} models — ${summary.join(" | ")}`);
}
