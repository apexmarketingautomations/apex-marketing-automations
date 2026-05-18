/**
 * server/ai/types.ts
 *
 * Shared types for the Apex AI Orchestration Layer (Stage 5).
 *
 * All modules under server/ai/ import from here — never from each other's
 * concrete implementations — to avoid circular deps.
 */

// ── Task types ────────────────────────────────────────────────────────────────

/**
 * Standardized task types that the application requests. The AI Router maps
 * each task type to the optimal provider + model based on capability profiles.
 */
export type AITaskType =
  | "reasoning"          // complex multi-step reasoning, chain-of-thought
  | "extraction"         // structured data extraction from text/documents
  | "ocr-assist"         // OCR correction / document understanding
  | "embeddings"         // vector embedding generation
  | "classification"     // label/category assignment
  | "scoring"            // numeric scoring / ranking
  | "summarization"      // text condensation / synopsis
  | "workflow-analysis"  // workflow parsing, step identification
  | "semantic-retrieval" // RAG-style retrieval reranking
  | "image-generation"   // create images from prompts
  | "chat"               // general conversational response
  | "code"               // code generation / analysis
  | "reranking";         // cross-encoder reranking of candidates

// ── Provider names ────────────────────────────────────────────────────────────

export type ProviderName = "anthropic" | "openai" | "gemini" | "ollama" | "groq";

// ── Capability flags ──────────────────────────────────────────────────────────

/**
 * Discrete capabilities a model may have. Used by the registry to filter
 * which providers can service a given task type.
 */
export type ModelCapability =
  | "long-context"         // 100k+ token context window
  | "structured-json"      // reliable native JSON mode / tool calling
  | "image-input"          // vision / multimodal input
  | "image-output"         // image generation
  | "embeddings"           // produce vector embeddings
  | "low-cost"             // optimized for token cost
  | "low-latency"          // optimized for first-token latency
  | "function-calling"     // native tool / function call schema
  | "streaming"            // supports server-sent event streaming
  | "local"                // runs on local hardware (Ollama)
  | "reranking";           // cross-encoder reranking

// ── Model profiles ────────────────────────────────────────────────────────────

export interface ModelCostProfile {
  /** USD per 1k input tokens */
  inputPer1kTokens: number;
  /** USD per 1k output tokens */
  outputPer1kTokens: number;
  /** USD per 1k dimensions (embeddings only) — 0 for non-embedding models */
  embeddingPer1kDims?: number;
}

export interface ModelProfile {
  /** Unique model identifier (as used in API calls) */
  modelId: string;
  /** Display name */
  name: string;
  /** Provider that owns this model */
  provider: ProviderName;
  /** Max context window in tokens */
  contextWindow: number;
  /** Max output tokens */
  maxOutputTokens: number;
  /** What this model can do */
  capabilities: ModelCapability[];
  /** Cost profile for budget calculations */
  cost: ModelCostProfile;
  /** Expected p50 latency in ms (first token for streaming) */
  p50LatencyMs: number;
  /** Expected p99 latency in ms */
  p99LatencyMs: number;
  /** Tier for quality comparisons (1=highest, 3=economy) */
  qualityTier: 1 | 2 | 3;
}

// ── Provider health ───────────────────────────────────────────────────────────

export type ProviderHealthStatus = "healthy" | "degraded" | "unavailable" | "quota-exhausted";

export interface ProviderHealth {
  provider: ProviderName;
  status: ProviderHealthStatus;
  /** Timestamp when this status was last updated */
  checkedAt: Date;
  /** Consecutive failures since last recovery */
  consecutiveFailures: number;
  /** Circuit breaker tripped timestamp */
  circuitTrippedAt: Date | null;
  /** If quota-exhausted, when to retry */
  quotaResetAt: Date | null;
  /** Rolling error rate (last 100 calls) */
  errorRatePct: number;
  /** p50 latency observed in last 100 calls (ms) */
  observedP50Ms: number;
}

// ── Standardized AI request / response ───────────────────────────────────────

export interface AIRequestOptions {
  /** What kind of work this is — drives routing and fallback */
  taskType?: AITaskType;
  /** Temperature override (0–1) */
  temperature?: number;
  /** Max output tokens */
  maxTokens?: number;
  /** Enforce JSON output */
  jsonMode?: boolean;
  /** Hard timeout override in ms */
  timeoutMs?: number;
  /** Logical route name for observability ("chat:respond", "enrichment:score", …) */
  route?: string;
  /** Distributed trace ID (passed through to logs) */
  traceId?: string;
  /** Sub-account ID for per-account budget tracking */
  subAccountId?: string | number;
  /** Force a specific provider (skip routing) */
  forceProvider?: ProviderName;
  /** Force a specific model ID (skip routing) */
  forceModel?: string;
  /** Budget context for this call — checked before routing */
  budgetContext?: BudgetContext;
}

export interface AIUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Estimated cost in USD */
  estimatedCostUsd?: number;
}

export interface AICallTrace {
  /** Unique ID for this specific request */
  requestId: string;
  /** Task type (if specified) */
  taskType?: AITaskType;
  /** Provider actually used */
  provider: ProviderName;
  /** Model actually used */
  model: string;
  /** Wall time from request to first token (streaming) or full response */
  latencyMs: number;
  /** Whether a fallback provider was used */
  fallbackTriggered: boolean;
  /** Ordered fallback chain that was tried */
  fallbackChain: ProviderName[];
  /** Why the primary provider was skipped */
  fallbackReason?: FallbackReason;
  /** Token usage and cost */
  usage?: AIUsage;
  /** Whether the call ultimately succeeded */
  success: boolean;
  /** Error message on failure */
  error?: string;
  /** Route name for grouping in dashboards */
  route?: string;
  /** Trace ID for correlation */
  traceId?: string;
  /** Sub-account context */
  subAccountId?: string | number;
  /** ISO timestamp */
  timestamp: string;
}

// ── Fallback reasons ──────────────────────────────────────────────────────────

export type FallbackReason =
  | "quota-exhausted"
  | "rate-limited"
  | "circuit-open"
  | "timeout"
  | "auth-error"
  | "provider-unavailable"
  | "not-configured"
  | "capability-mismatch"
  | "budget-exceeded"
  | "transient-error";

// ── Budget ────────────────────────────────────────────────────────────────────

export interface BudgetContext {
  /** Per-call cost cap in USD — reject if estimated cost exceeds this */
  maxCostPerCallUsd?: number;
  /** Sub-account ID for per-account tracking */
  subAccountId?: string | number;
  /** Task type for per-task tracking */
  taskType?: AITaskType;
}

export interface BudgetStatus {
  /** Whether this call is allowed */
  allowed: boolean;
  /** Whether we're past the soft warning threshold */
  softLimitBreached: boolean;
  /** Whether we're past the hard limit */
  hardLimitBreached: boolean;
  /** Reason if blocked */
  reason?: string;
  /** Current period spend in USD */
  currentSpendUsd: number;
  /** Hard limit in USD */
  hardLimitUsd: number;
}

// ── Structured output ─────────────────────────────────────────────────────────

export interface StructuredOutputResult<T> {
  /** Parsed and validated output */
  data: T | null;
  /** Whether parsing and validation succeeded */
  valid: boolean;
  /** Raw text from the model (for debugging) */
  rawText: string;
  /** Number of parse/validate attempts made */
  attempts: number;
  /** Parse error if valid=false */
  parseError?: string;
  /** Confidence score from model (0–1), if extractable */
  confidence?: number;
}

// ── Embedding ─────────────────────────────────────────────────────────────────

export interface EmbeddingRequest {
  /** Text to embed */
  text: string;
  /** Unique identifier for this document (for dedup) */
  documentId: string;
  /** SHA256 of text — used for change detection */
  contentHash: string;
  /** Optional namespace */
  namespace?: string;
}

export interface EmbeddingResult {
  documentId: string;
  vector: number[];
  model: string;
  dimensions: number;
  provider: ProviderName;
}

// ── OCR ───────────────────────────────────────────────────────────────────────

export type OCRDocumentType =
  | "crash-report"
  | "court-filing"
  | "permit"
  | "license"
  | "invoice"
  | "contract"
  | "general";

export interface OCRRequest {
  /** Base64-encoded image or PDF bytes */
  content: string;
  /** MIME type */
  mimeType: string;
  /** Document type hint for routing */
  documentType: OCRDocumentType;
  /** If true, use high-accuracy (higher cost) route */
  highAccuracy?: boolean;
}

export interface OCRResult {
  /** Raw extracted text */
  text: string;
  /** Structured fields extracted (document-type specific) */
  fields?: Record<string, string | number | null>;
  /** Confidence score 0–1 */
  confidence: number;
  /** Provider used */
  provider: ProviderName;
  /** Model used */
  model: string;
}
