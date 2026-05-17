import OpenAI from "openai";
import { geminiChat, geminiChatStream, geminiGenerateImage, isGeminiAvailable, isGeminiConfigured } from "./gemini";
import crypto from "crypto";

// ── Stage 5 AI Orchestration Layer ───────────────────────────────────────────
// Wire in registry health signals and observability from server/ai/
// All existing exports remain unchanged — this is additive only.
import {
  recordProviderSuccess,
  recordProviderFailure,
  logRegistryStartup,
  getBudgetReport,
  getProcessMetrics,
  isEmergencyShutdownActive,
} from "./ai/index";

// Re-export Stage 5 types and utilities so consumers can import from aiGateway
export type { AITaskType, ProviderName, AICallTrace, BudgetReport } from "./ai/index";
export {
  getBudgetReport,
  getProcessMetrics,
  isEmergencyShutdownActive,
  buildPlan as buildAIRoutingPlan,
  withFallback as withAIFallback,
  withFallbackSafe as withAIFallbackSafe,
  parseStructuredOutput,
  parseJSON as parseAIJSON,
  requiresKeys,
  getAllProviderHealth,
  setEmergencyShutdown,
} from "./ai/index";

// ── Anthropic provider (raw fetch — no SDK required) ─────────────────────────
const ANTHROPIC_URL     = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL   = "claude-sonnet-4-6";

export function isAnthropicConfigured(): boolean {
  const key = (
    process.env.ANTHROPIC_API_KEY ||
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ||
    ""
  ).trim();
  return key.length > 10;
}

function getAnthropicKey(): string {
  return (
    process.env.ANTHROPIC_API_KEY ||
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ||
    ""
  ).trim();
}

async function callAnthropic(
  messages: ChatMessage[],
  options: AIOptions = {}
): Promise<AIResponse> {
  const { temperature = 0.7, maxTokens = 4096, timeoutMs = DEFAULT_TIMEOUT_MS, jsonMode = false } = options;
  const _callStart = Date.now();

  // Anthropic requires system messages in a separate top-level field
  const systemMsg = messages.find(m => m.role === "system");
  const userMsgs  = messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Anthropic doesn't support response_format — enforce JSON via system prompt
  const systemContent = [
    systemMsg?.content || "",
    jsonMode ? "\n\nIMPORTANT: You MUST respond with valid JSON only. No prose, no markdown, no explanation. Raw JSON only." : "",
  ].filter(Boolean).join("");

  const body: Record<string, unknown> = {
    model:      ANTHROPIC_MODEL,
    max_tokens: Math.min(maxTokens, 8096),
    messages:   userMsgs,
  };
  if (systemContent) body.system = systemContent;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method:  "POST",
      signal:  controller.signal,
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         getAnthropicKey(),
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const preview = (await res.text()).slice(0, 300);
      throw Object.assign(
        new Error(`Anthropic HTTP ${res.status}: ${preview}`),
        { status: res.status }
      );
    }

    const data = await res.json() as any;
    const text = data?.content?.[0]?.text ?? "";
    recordProviderSuccess("anthropic", Date.now() - _callStart);
    return {
      text,
      ok:       true,
      provider: "anthropic" as any,
      model:    ANTHROPIC_MODEL,
      usage: {
        promptTokens:     data?.usage?.input_tokens,
        completionTokens: data?.usage?.output_tokens,
        totalTokens:      (data?.usage?.input_tokens ?? 0) + (data?.usage?.output_tokens ?? 0),
      },
    };
  } catch (err: any) {
    clearTimeout(timer);
    const { status } = (err as any) ?? {};
    recordProviderFailure("anthropic", {
      isQuotaError: status === 402 || status === 429,
      isAuthError:  status === 401 || status === 403,
      isTransient:  status === 500 || status === 503,
    });
    throw err;
  }
}


async function* callAnthropicStream(
  messages: ChatMessage[],
  options: AIOptions = {}
): AsyncGenerator<string> {
  const { temperature = 0.7, maxTokens = 4096, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const systemMsg = messages.find(m => m.role === "system");
  const userMsgs  = messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

  const body: Record<string, unknown> = {
    model:      ANTHROPIC_MODEL,
    max_tokens: Math.min(maxTokens, 8096),
    messages:   userMsgs,
    stream:     true,
  };
  if (systemMsg?.content) body.system = systemMsg.content;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method:  "POST",
      signal:  controller.signal,
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         getAnthropicKey(),
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const preview = (await res.text()).slice(0, 300);
      throw Object.assign(new Error(`Anthropic stream HTTP ${res.status}: ${preview}`), { status: res.status });
    }
    if (!res.body) throw new Error("Anthropic stream: no response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const event = JSON.parse(raw) as any;
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
              yield event.delta.text as string;
            }
          } catch { /* allow-silent-catch: intentionally skip malformed SSE JSON chunks in streaming parser */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (err: any) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Convert OpenAI-format multi-turn tool history to Anthropic's format.
 *
 * OpenAI:  assistant { tool_calls: [{id, function:{name,arguments}}] }
 *          tool     { tool_call_id, content }
 *
 * Anthropic: assistant { content: [{type:"tool_use", id, name, input}] }
 *            user      { content: [{type:"tool_result", tool_use_id, content}] }
 *
 * Consecutive tool messages are merged into one user message as required by Anthropic.
 */
function convertToAnthropicMessages(
  rawMessages: Array<{ role: string; content?: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string }>
): Array<{ role: "user" | "assistant"; content: any }> {
  const result: Array<{ role: "user" | "assistant"; content: any }> = [];
  let i = 0;
  while (i < rawMessages.length) {
    const msg = rawMessages[i];
    if (msg.role === "system") { i++; continue; }

    if (msg.role === "assistant") {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const content: any[] = [];
        if (msg.content) content.push({ type: "text", text: String(msg.content) });
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown>;
          try {
            input = typeof tc.function?.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : (tc.function?.arguments ?? {});
          } catch { input = {}; } // allow-silent-catch: malformed tool argument JSON replaced with empty object
          content.push({
            type: "tool_use",
            id:   tc.id || `tool_${i}`,
            name: tc.function?.name || "unknown",
            input,
          });
        }
        result.push({ role: "assistant", content });
      } else {
        result.push({ role: "assistant", content: msg.content || "" });
      }
      i++;
    } else if (msg.role === "tool") {
      // Merge consecutive tool messages into a single Anthropic user message
      const toolResults: any[] = [];
      while (i < rawMessages.length && rawMessages[i].role === "tool") {
        const t = rawMessages[i];
        toolResults.push({
          type:        "tool_result",
          tool_use_id: t.tool_call_id || "",
          content:     typeof t.content === "string" ? t.content : JSON.stringify(t.content ?? ""),
        });
        i++;
      }
      result.push({ role: "user", content: toolResults });
    } else {
      result.push({ role: "user", content: msg.content || "" });
      i++;
    }
  }
  return result;
}

async function callAnthropicWithTools(
  messages: Array<{ role: string; content?: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string }>,
  tools: ToolDefinition[],
  options: AIOptions = {}
): Promise<AIToolCallResponse> {
  const { maxTokens = 4096, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const anthropicTools = tools.map(t => ({
    name:         t.function.name,
    description:  t.function.description || "",
    input_schema: (t.function.parameters as any) || { type: "object", properties: {} },
  }));

  const systemMsg = messages.find(m => m.role === "system");
  // Convert full multi-turn history (including tool_calls + tool results) to Anthropic format
  const userMsgs  = convertToAnthropicMessages(messages);

  const body: Record<string, unknown> = {
    model:       ANTHROPIC_MODEL,
    max_tokens:  Math.min(maxTokens, 8096),
    messages:    userMsgs,
    tools:       anthropicTools,
    tool_choice: { type: "auto" },
  };
  if (systemMsg?.content) body.system = systemMsg.content;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method:  "POST",
      signal:  controller.signal,
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         getAnthropicKey(),
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const preview = (await res.text()).slice(0, 300);
      throw Object.assign(new Error(`Anthropic tools HTTP ${res.status}: ${preview}`), { status: res.status });
    }

    const data = await res.json() as any;
    const toolCalls: ToolCallResult[] = [];
    let text = "";

    for (const block of (data.content || [])) {
      if (block.type === "text") text += block.text;
      if (block.type === "tool_use") {
        toolCalls.push({
          id:        block.id,
          name:      block.name,
          arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input),
        });
      }
    }

    return { text, ok: true, toolCalls, provider: "anthropic", model: ANTHROPIC_MODEL, finishReason: data.stop_reason ?? undefined };
  } catch (err: any) {
    clearTimeout(timer);
    throw err;
  }
}

let _openaiClient: OpenAI | null = null;

function resolveOpenAICreds(): { apiKey: string | undefined; baseURL: string | undefined; source: string } {
  const primary = process.env.OPENAI_APEX_INT_KEY;
  const isValidOpenAIKey = (k: string | undefined) =>
    !!k && k.startsWith("sk-") && !k.startsWith("sk-ant-");

  if (isValidOpenAIKey(primary)) {
    return { apiKey: primary, baseURL: undefined, source: "OPENAI_APEX_INT_KEY" };
  }

  const fallbackKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const fallbackBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (isValidOpenAIKey(fallbackKey)) {
    if (primary && !isValidOpenAIKey(primary)) {
      console.warn(
        "[AI-GATEWAY] OPENAI_APEX_INT_KEY does not look like an OpenAI key " +
        "(prefix not 'sk-' or starts with 'sk-ant-'). Falling back to Replit-managed AI_INTEGRATIONS_OPENAI_API_KEY.",
      );
    }
    return { apiKey: fallbackKey, baseURL: fallbackBase, source: "AI_INTEGRATIONS_OPENAI_API_KEY" };
  }

  // AI_INTEGRATIONS_OPENAI_API_KEY is present but isn't a valid OpenAI key
  // (e.g. it's a Google/Gemini key starting with "AIza").  Log once and skip.
  if (fallbackKey && !isValidOpenAIKey(fallbackKey)) {
    console.warn(
      "[AI-GATEWAY] AI_INTEGRATIONS_OPENAI_API_KEY does not look like an OpenAI key " +
      "(expected prefix 'sk-'). Ignoring — will skip OpenAI and fall through to Gemini.",
    );
  }

  return { apiKey: primary, baseURL: undefined, source: primary ? "OPENAI_APEX_INT_KEY (invalid)" : "none" };
}

function getOpenAIClient(): OpenAI {
  if (!_openaiClient) {
    const { apiKey, baseURL, source } = resolveOpenAICreds();
    console.log(`[AI-GATEWAY] OpenAI client initialized (key source: ${source})`);
    _openaiClient = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }
  return _openaiClient;
}

const OPENAI_MODEL = "gpt-4o-mini";
const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 12_000;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_WINDOW_MS = 180_000;
const CIRCUIT_BREAKER_COOLDOWN_MS = 120_000;
const MAX_OPENAI_RETRIES = 1;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  route?: string;
  traceId?: string;
  subAccountId?: string | number;
}

export interface AIResponse {
  /**
   * The model's reply text. INVARIANT: if `ok === false`, this is always "" (empty string).
   * It will NEVER contain a "[AI Error: ...]" prefix or any error description.
   * This guarantees no caller can accidentally leak a raw AI gateway error to a customer
   * via patterns like `aiReply = result.text || fallback` (empty is falsy → fallback wins).
   */
  text: string;
  /** True when the AI call succeeded and `text` is real model output. False on any error. */
  ok: boolean;
  /** Original error message — populated only when `ok === false`. For logs/audit, never customer-facing. */
  errorMessage?: string;
  provider: "openai" | "gemini" | "anthropic";
  model?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

interface CircuitBreakerState {
  failures: number[];
  trippedAt: number | null;
}

const circuitBreaker: CircuitBreakerState = {
  failures: [],
  trippedAt: null,
};

export function isOpenAIConfigured(): boolean {
  const isValidOpenAIKey = (k: string | undefined) =>
    !!k && k.startsWith("sk-") && !k.startsWith("sk-ant-");
  return (
    isValidOpenAIKey(process.env.OPENAI_APEX_INT_KEY) ||
    isValidOpenAIKey(process.env.AI_INTEGRATIONS_OPENAI_API_KEY)
  );
}

// ── Anthropic quota/billing failure tracking ──────────────────────────────────
let _anthropicQuotaFailedAt: number | null = null;
const ANTHROPIC_QUOTA_COOLDOWN_MS = 300_000; // 5 min — re-check after this window

function isAnthropicQuotaFailed(): boolean {
  if (_anthropicQuotaFailedAt === null) return false;
  if (Date.now() - _anthropicQuotaFailedAt >= ANTHROPIC_QUOTA_COOLDOWN_MS) {
    _anthropicQuotaFailedAt = null;
    return false;
  }
  return true;
}

function markAnthropicQuotaFailed(): void {
  _anthropicQuotaFailedAt = Date.now();
  console.warn("[AI-GATEWAY] Anthropic quota/billing exhausted — routing all requests to Gemini");
}

function isQuotaError(err: any): boolean {
  const status = err?.status ?? err?.statusCode ?? err?.httpStatusCode;
  if (status === 429 || status === 402 || status === 529) return true;
  const msg = String(err?.message ?? "").toLowerCase();
  return (
    msg.includes("quota") ||
    msg.includes("insufficient_quota") ||
    msg.includes("billing") ||
    msg.includes("credit") ||
    msg.includes("rate limit") ||
    msg.includes("overloaded") ||
    msg.includes("529")
  );
}

function isAuthError(err: any): boolean {
  const status = err?.status ?? err?.statusCode ?? err?.httpStatusCode;
  return status === 401 || status === 403;
}

function isTransientError(err: any): boolean {
  if (isAuthError(err)) return false;
  const code = err?.code;
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND") return true;
  const status = err?.status ?? err?.statusCode ?? err?.httpStatusCode;
  if (status === 429 || status === 500 || status === 503) return true;
  const message = String(err?.message ?? "").toLowerCase();
  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("500") ||
    message.includes("503") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econnreset")
  );
}

function isCircuitOpen(): boolean {
  if (circuitBreaker.trippedAt !== null) {
    if (Date.now() - circuitBreaker.trippedAt >= CIRCUIT_BREAKER_COOLDOWN_MS) {
      circuitBreaker.trippedAt = null;
      circuitBreaker.failures = [];
      console.log("[AI-GATEWAY] Circuit breaker reset — OpenAI re-entering service");
    } else {
      return true;
    }
  }

  const now = Date.now();
  circuitBreaker.failures = circuitBreaker.failures.filter(
    (t) => now - t < CIRCUIT_BREAKER_WINDOW_MS
  );

  if (circuitBreaker.failures.length >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreaker.trippedAt = now;
    console.warn(
      `[AI-GATEWAY] Circuit breaker tripped — ${circuitBreaker.failures.length} failures in ${CIRCUIT_BREAKER_WINDOW_MS / 1000}s. Routing to Gemini for ${CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s.`
    );
    return true;
  }

  return false;
}

function recordOpenAIFailure(): void {
  circuitBreaker.failures.push(Date.now());
}

export function getAIProviderStatus(): {
  primary: string;
  fallback: string;
  circuitBreakerOpen: boolean;
  circuitBreakerTrippedAt: string | null;
  anthropicConfigured: boolean;
  openaiConfigured: boolean;
  geminiConfigured: boolean;
  activeProvider: "anthropic" | "openai" | "gemini" | "none";
} {
  const circuitOpen      = isCircuitOpen();
  const anthropicCfg     = isAnthropicConfigured();
  const openaiConfigured = isOpenAIConfigured();
  const geminiConfigured = isGeminiConfigured();

  let activeProvider: "anthropic" | "openai" | "gemini" | "none" = "none";
  if (anthropicCfg)                          activeProvider = "anthropic";
  else if (openaiConfigured && !circuitOpen) activeProvider = "openai";
  else if (geminiConfigured)                 activeProvider = "gemini";

  return {
    primary:  anthropicCfg ? "Anthropic" : openaiConfigured ? "OpenAI" : "Gemini",
    fallback: anthropicCfg ? "OpenAI/Gemini" : "Gemini",
    circuitBreakerOpen: circuitOpen,
    circuitBreakerTrippedAt: circuitBreaker.trippedAt
      ? new Date(circuitBreaker.trippedAt).toISOString()
      : null,
    anthropicConfigured: anthropicCfg,
    openaiConfigured,
    geminiConfigured,
    activeProvider,
  };
}

export function isAIConfigured(): boolean {
  return isAnthropicConfigured() || isOpenAIConfigured() || isGeminiConfigured();
}

function generateRequestId(): string {
  return crypto.randomBytes(8).toString("hex");
}

function logObservability(entry: {
  requestId: string;
  traceId?: string;
  subAccountId?: string | number;
  route?: string;
  provider: "openai" | "gemini" | "anthropic" | string;
  model?: string;
  latencyMs: number;
  success: boolean;
  fallbackTriggered: boolean;
  error?: string;
}): void {
  console.log(JSON.stringify({ type: "ai_request", ...entry }));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error(`AI call timed out after ${timeoutMs}ms`), { isTimeout: true }))
        );
      }),
    ]);
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function callOpenAI(
  messages: ChatMessage[],
  options: AIOptions = {}
): Promise<AIResponse> {
  const { temperature = 0.7, maxTokens = 4096, jsonMode = false, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const response = await withTimeout(
    getOpenAIClient().chat.completions.create({
      model: OPENAI_MODEL,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature,
      max_tokens: maxTokens,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    timeoutMs
  );

  const text = response.choices[0]?.message?.content ?? "";
  return {
    text,
    ok: true,
    provider: "openai",
    model: OPENAI_MODEL,
    usage: {
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
    },
  };
}

async function callOpenAIWithTools(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  options: AIOptions = {}
): Promise<AIResponse> {
  const { temperature = 0.7, maxTokens = 4096, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const response = await withTimeout(
    getOpenAIClient().chat.completions.create({
      model: OPENAI_MODEL,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature,
      max_tokens: maxTokens,
      tools: tools as any,
      tool_choice: "auto",
    }),
    timeoutMs
  );

  const message = response.choices[0]?.message;
  let text = message?.content ?? "";

  if (message?.tool_calls && message.tool_calls.length > 0) {
    text = JSON.stringify({ tool_calls: message.tool_calls });
  }

  return {
    text,
    ok: true,
    provider: "openai",
    model: OPENAI_MODEL,
    usage: {
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
    },
  };
}

async function callGemini(
  messages: ChatMessage[],
  options: AIOptions = {}
): Promise<AIResponse> {
  const { temperature = 0.7, maxTokens = 4096, jsonMode = false, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const text = await withTimeout(
    geminiChat(messages, { temperature, maxTokens, jsonMode }),
    timeoutMs
  );
  return {
    text,
    ok: true,
    provider: "gemini",
    model: GEMINI_FALLBACK_MODEL,
  };
}

function selectProvider(): "anthropic" | "openai" | "gemini" {
  if (isAnthropicConfigured() && !isAnthropicQuotaFailed()) {
    console.log("[AI-GATEWAY] Provider selected: anthropic");
    return "anthropic";
  }
  if (isAnthropicConfigured() && isAnthropicQuotaFailed()) {
    console.warn("[AI-GATEWAY] Anthropic unavailable, falling back to Gemini");
  }
  if (isOpenAIConfigured() && !isCircuitOpen()) {
    console.log("[AI-GATEWAY] Provider selected: openai");
    return "openai";
  }
  console.log("[AI-GATEWAY] Provider selected: gemini");
  return "gemini";
}

export async function aiChat(
  messages: ChatMessage[],
  options: AIOptions = {}
): Promise<AIResponse> {
  const requestId = generateRequestId();
  const { route, traceId, subAccountId } = options;
  const start = Date.now();
  const provider = selectProvider();

  try {
    // ── Anthropic (primary when ANTHROPIC_API_KEY is set) ──────────────────
    if (provider === "anthropic") {
      try {
        const result = await callAnthropic(messages, options);
        logObservability({
          requestId, traceId, subAccountId, route,
          provider: "anthropic" as any,
          model: result.model,
          latencyMs: Date.now() - start,
          success: true,
          fallbackTriggered: false,
        });
        return result;
      } catch (err: any) {
        if (isQuotaError(err)) markAnthropicQuotaFailed();
        console.warn(`[AI-GATEWAY] Anthropic failed (${err?.message}), falling back`);
        // Fall through to OpenAI → Gemini
        if (isOpenAIConfigured() && !isCircuitOpen()) {
          try {
            console.log("[AI-GATEWAY] OpenAI unavailable, falling back to Gemini");
            const result = await callOpenAI(messages, options);
            logObservability({ requestId, traceId, subAccountId, route, provider: "openai", model: result.model, latencyMs: Date.now() - start, success: true, fallbackTriggered: true });
            return result;
          } catch (openaiErr: any) {
            recordOpenAIFailure();
            console.warn(`[AI-GATEWAY] OpenAI fallback also failed: ${openaiErr?.message}`);
          }
        }
        if (isGeminiAvailable()) {
          console.log("[AI-GATEWAY] Anthropic unavailable, falling back to Gemini");
          const result = await callGemini(messages, options);
          logObservability({ requestId, traceId, subAccountId, route, provider: "gemini", model: result.model, latencyMs: Date.now() - start, success: true, fallbackTriggered: true });
          return result;
        }
        logObservability({ requestId, traceId, subAccountId, route, provider: "anthropic" as any, latencyMs: Date.now() - start, success: false, fallbackTriggered: false, error: "All providers failed" });
        return { text: "", ok: false, errorMessage: "All AI providers failed", provider: "anthropic" as any };
      }
    }

    if (provider === "openai") {
      for (let attempt = 0; attempt <= MAX_OPENAI_RETRIES; attempt++) {
        try {
          const result = await callOpenAI(messages, options);
          logObservability({
            requestId, traceId, subAccountId, route,
            provider: "openai",
            model: result.model,
            latencyMs: Date.now() - start,
            success: true,
            fallbackTriggered: false,
          });
          return result;
        } catch (err: any) {
          recordOpenAIFailure();
          if (!isAuthError(err) && attempt < MAX_OPENAI_RETRIES && isTransientError(err)) {
            console.warn(`[AI-GATEWAY] OpenAI attempt ${attempt + 1} failed (retrying): ${err?.message}`);
            continue;
          }
          // Do NOT throw — fall through to Gemini fallback below
          console.warn(`[AI-GATEWAY] OpenAI failed (${err?.message}), falling back to Gemini`);
          break;
        }
      }
    }

    if (!isGeminiAvailable()) {
      logObservability({ requestId, traceId, subAccountId, route, provider: "gemini", model: GEMINI_FALLBACK_MODEL, latencyMs: Date.now() - start, success: false, fallbackTriggered: false, error: "No AI provider available" });
      return { text: "", ok: false, errorMessage: "No AI provider available", provider: "gemini", model: GEMINI_FALLBACK_MODEL };
    }

    const result = await callGemini(messages, options);
    logObservability({
      requestId, traceId, subAccountId, route,
      provider: "gemini",
      model: result.model,
      latencyMs: Date.now() - start,
      success: true,
      fallbackTriggered: false,
    });
    return result;
  } catch (err: any) {
    const errorMessage = err?.message ?? "unknown";
    logObservability({ requestId, traceId, subAccountId, route, provider, model: provider === "openai" ? OPENAI_MODEL : GEMINI_FALLBACK_MODEL, latencyMs: Date.now() - start, success: false, fallbackTriggered: false, error: errorMessage });
    return { text: "", ok: false, errorMessage, provider, model: provider === "openai" ? OPENAI_MODEL : GEMINI_FALLBACK_MODEL };
  }
}

export async function* aiChatStream(
  messages: ChatMessage[],
  options: AIOptions = {}
): AsyncGenerator<string> {
  const requestId = generateRequestId();
  const { route, traceId, subAccountId } = options;
  const start = Date.now();
  let chunksYielded = 0;
  const provider = selectProvider();

  try {
    if (provider === "anthropic") {
      try {
        for await (const chunk of callAnthropicStream(messages, options)) {
          chunksYielded++;
          yield chunk;
        }
        logObservability({ requestId, traceId, subAccountId, route, provider: "anthropic" as any, model: ANTHROPIC_MODEL, latencyMs: Date.now() - start, success: true, fallbackTriggered: false });
        return;
      } catch (err: any) {
        if (isQuotaError(err)) markAnthropicQuotaFailed();
        if (chunksYielded > 0) {
          logObservability({ requestId, traceId, subAccountId, route, provider: "anthropic" as any, model: ANTHROPIC_MODEL, latencyMs: Date.now() - start, success: false, fallbackTriggered: false, error: `Mid-stream: ${err?.message}` });
          throw new Error(`Anthropic stream interrupted after ${chunksYielded} chunks: ${err?.message}`);
        }
        console.warn(`[AI-GATEWAY] Anthropic stream failed (${err?.message}), falling back`);
        console.log("[AI-GATEWAY] Anthropic unavailable, falling back to Gemini");
      }
    }

    // ── OpenAI (primary or Anthropic fallback) ────────────────────────────────
    if (isOpenAIConfigured() && !isCircuitOpen()) {
      for (let attempt = 0; attempt <= MAX_OPENAI_RETRIES; attempt++) {
        try {
          const { temperature = 0.7, maxTokens = 4096, jsonMode = false, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);

          try {
            const stream = await getOpenAIClient().chat.completions.create({
              model: OPENAI_MODEL,
              messages: messages.map((m) => ({ role: m.role, content: m.content })),
              temperature,
              max_tokens: maxTokens,
              stream: true,
              ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
            }, { signal: controller.signal });

            clearTimeout(timer);

            for await (const chunk of stream) {
              const delta = chunk.choices[0]?.delta?.content ?? "";
              if (delta) {
                chunksYielded++;
                yield delta;
              }
            }

            logObservability({
              requestId, traceId, subAccountId, route,
              provider: "openai",
              model: OPENAI_MODEL,
              latencyMs: Date.now() - start,
              success: true,
              fallbackTriggered: false,
            });
            return;
          } catch (err: any) {
            clearTimeout(timer);
            if (chunksYielded > 0) {
              logObservability({
                requestId, traceId, subAccountId, route,
                provider: "openai",
                model: OPENAI_MODEL,
                latencyMs: Date.now() - start,
                success: false,
                fallbackTriggered: false,
                error: `Mid-stream error (no fallback): ${err?.message}`,
              });
              throw new Error(`Stream interrupted after ${chunksYielded} chunks: ${err?.message}`);
            }
            throw err;
          }
        } catch (err: any) {
          if (chunksYielded > 0) throw err;
          recordOpenAIFailure();
          if (!isAuthError(err) && attempt < MAX_OPENAI_RETRIES && isTransientError(err)) {
            console.warn(`[AI-GATEWAY] OpenAI stream attempt ${attempt + 1} failed (retrying): ${err?.message}`);
            continue;
          }
          // Do NOT throw — fall through to Gemini streaming fallback below
          console.warn(`[AI-GATEWAY] OpenAI stream failed (${err?.message}), falling back to Gemini`);
          break;
        }
      }
    }

    // ── Gemini (final fallback) ────────────────────────────────────────────────
    if (!isGeminiAvailable()) {
      logObservability({ requestId, traceId, subAccountId, route, provider: "gemini", model: GEMINI_FALLBACK_MODEL, latencyMs: Date.now() - start, success: false, fallbackTriggered: false, error: "No AI provider available" });
      throw new Error("No AI provider available for streaming");
    }

    const { temperature = 0.7, maxTokens = 4096, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    const geminiStream = await withTimeout(
      Promise.resolve(geminiChatStream(messages, { temperature, maxTokens })),
      timeoutMs
    );
    for await (const chunk of geminiStream) {
      chunksYielded++;
      yield chunk;
    }
    logObservability({
      requestId, traceId, subAccountId, route,
      provider: "gemini",
      model: GEMINI_FALLBACK_MODEL,
      latencyMs: Date.now() - start,
      success: true,
      fallbackTriggered: false,
    });
  } catch (err: any) {
    logObservability({
      requestId, traceId, subAccountId, route,
      provider,
      model: provider === "openai" ? OPENAI_MODEL : GEMINI_FALLBACK_MODEL,
      latencyMs: Date.now() - start,
      success: false,
      fallbackTriggered: false,
      error: err?.message,
    });
    throw err;
  }
}

export interface ToolCallResult {
  id: string;
  name: string;
  arguments: string;
}

export interface AIToolCallResponse {
  /** Same INVARIANT as AIResponse.text — never contains "[AI Error: ...]". Empty when ok=false. */
  text: string;
  ok: boolean;
  errorMessage?: string;
  toolCalls: ToolCallResult[];
  provider: "openai" | "gemini" | "anthropic";
  model?: string;
  finishReason?: string;
}

export async function aiChatWithTools(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  options: AIOptions = {}
): Promise<AIResponse> {
  const result = await aiChatWithToolCalls(messages, tools, options);
  return {
    text: result.text,
    ok: result.ok,
    errorMessage: result.errorMessage,
    provider: result.provider,
    model: result.model,
  };
}

export async function aiChatWithToolCalls(
  messages: Array<{ role: string; content?: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string }>,
  tools: ToolDefinition[],
  options: AIOptions = {}
): Promise<AIToolCallResponse> {
  const requestId = generateRequestId();
  const { route, traceId, subAccountId } = options;
  const start = Date.now();
  const provider = selectProvider();

  try {
    // ── Anthropic (primary when ANTHROPIC_API_KEY is set) ─────────────────────
    if (provider === "anthropic") {
      try {
        const result = await callAnthropicWithTools(messages, tools, options);
        logObservability({ requestId, traceId, subAccountId, route, provider: "anthropic" as any, model: ANTHROPIC_MODEL, latencyMs: Date.now() - start, success: true, fallbackTriggered: false });
        return result;
      } catch (err: any) {
        if (isQuotaError(err)) markAnthropicQuotaFailed();
        console.warn(`[AI-GATEWAY] Anthropic (tools) failed (${err?.message}), falling back`);
        // fall through to OpenAI → Gemini
      }
    }

    // ── OpenAI (primary or Anthropic fallback) ────────────────────────────────
    if (isOpenAIConfigured() && !isCircuitOpen()) {
      for (let attempt = 0; attempt <= MAX_OPENAI_RETRIES; attempt++) {
        try {
          const { temperature = 0.7, maxTokens = 4096, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

          const response = await withTimeout(
            getOpenAIClient().chat.completions.create({
              model: OPENAI_MODEL,
              messages: messages as any,
              temperature,
              max_tokens: maxTokens,
              tools: tools as any,
              tool_choice: "auto",
            }),
            timeoutMs
          );

          const message = response.choices[0]?.message;
          const toolCalls: ToolCallResult[] = [];

          if (message?.tool_calls && message.tool_calls.length > 0) {
            for (const tc of message.tool_calls) {
              const tcAny = tc as any;
              toolCalls.push({
                id: tc.id,
                name: tcAny.function?.name ?? tcAny.name ?? "",
                arguments: tcAny.function?.arguments ?? tcAny.arguments ?? "",
              });
            }
          }

          logObservability({
            requestId, traceId, subAccountId, route,
            provider: "openai",
            model: OPENAI_MODEL,
            latencyMs: Date.now() - start,
            success: true,
            fallbackTriggered: false,
          });

          return {
            text: message?.content ?? "",
            ok: true,
            toolCalls,
            provider: "openai",
            model: OPENAI_MODEL,
            finishReason: response.choices[0]?.finish_reason ?? undefined,
          };
        } catch (err: any) {
          recordOpenAIFailure();
          if (!isAuthError(err) && attempt < MAX_OPENAI_RETRIES && isTransientError(err)) {
            console.warn(`[AI-GATEWAY] OpenAI (tools) attempt ${attempt + 1} failed (retrying): ${err?.message}`);
            continue;
          }
          // Do NOT throw — fall through to Gemini tool-call fallback below
          console.warn(`[AI-GATEWAY] OpenAI (tools) failed (${err?.message}), falling back to Gemini`);
          break;
        }
      }
    }

    if (!isGeminiAvailable()) {
      logObservability({ requestId, traceId, subAccountId, route, provider: "gemini", model: GEMINI_FALLBACK_MODEL, latencyMs: Date.now() - start, success: false, fallbackTriggered: false, error: "No AI provider available" });
      return { text: "", ok: false, errorMessage: "No AI provider available. This action could not be completed.", toolCalls: [], provider: "gemini", model: GEMINI_FALLBACK_MODEL };
    }

    // Gemini doesn't support native function calling in this path — degrade gracefully to plain
    // chat so the user gets a text answer instead of a generic "Sorry" apology. The bot.ts loop
    // receives toolCalls=[] and breaks out normally, streaming the text response.
    console.warn("[AI-GATEWAY] Primary providers unavailable — Gemini plain-chat fallback (no tool calls)");
    try {
      // Strip tool messages and assistant tool_call blocks so Gemini gets a clean conversation
      const geminiMsgs: ChatMessage[] = messages
        .filter(m => m.role !== "tool")
        .map(m => ({
          role: (m.role === "assistant" || m.role === "user" || m.role === "system"
            ? m.role : "user") as ChatMessage["role"],
          content: m.role === "assistant" && m.tool_calls
            ? (m.content || "I was about to run some tools to help with that.")
            : (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")),
        }));

      // Inject a brief tool-capability notice so Gemini knows what it can describe
      const toolNames = tools.slice(0, 8).map(t => t.function.name).join(", ");
      const sysIdx = geminiMsgs.findIndex(m => m.role === "system");
      const notice = `\n[Note: Direct tool execution unavailable right now. Describe steps clearly and offer to assist further. Available capabilities: ${toolNames}]`;
      if (sysIdx >= 0) {
        geminiMsgs[sysIdx] = { ...geminiMsgs[sysIdx], content: (geminiMsgs[sysIdx].content || "") + notice };
      }

      const geminiResult = await callGemini(geminiMsgs, options);
      logObservability({ requestId, traceId, subAccountId, route, provider: "gemini", model: GEMINI_FALLBACK_MODEL, latencyMs: Date.now() - start, success: true, fallbackTriggered: true });
      return { text: geminiResult.text, ok: true, toolCalls: [], provider: "gemini", model: GEMINI_FALLBACK_MODEL };
    } catch (geminiErr: any) {
      const errMsg = `Gemini fallback failed: ${geminiErr?.message ?? "unknown"}`;
      logObservability({ requestId, traceId, subAccountId, route, provider: "gemini", model: GEMINI_FALLBACK_MODEL, latencyMs: Date.now() - start, success: false, fallbackTriggered: true, error: errMsg });
      return { text: "", ok: false, errorMessage: errMsg, toolCalls: [], provider: "gemini", model: GEMINI_FALLBACK_MODEL };
    }
  } catch (err: any) {
    const errorMessage = err?.message ?? "unknown";
    logObservability({ requestId, traceId, subAccountId, route, provider, model: provider === "openai" ? OPENAI_MODEL : GEMINI_FALLBACK_MODEL, latencyMs: Date.now() - start, success: false, fallbackTriggered: false, error: errorMessage });
    return { text: "", ok: false, errorMessage, toolCalls: [], provider, model: provider === "openai" ? OPENAI_MODEL : GEMINI_FALLBACK_MODEL };
  }
}

export async function* aiChatWithToolsStream(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  options: AIOptions = {}
): AsyncGenerator<string> {
  const requestId = generateRequestId();
  const { route, traceId, subAccountId } = options;
  const start = Date.now();
  let chunksYielded = 0;
  const provider = selectProvider();

  const toolDescriptions = tools
    .map((t) => `Tool: ${t.function.name} — ${t.function.description || ""}`)
    .join("\n");

  const augmentedMessages: ChatMessage[] = [
    ...messages,
    {
      role: "system",
      content: `Available tools:\n${toolDescriptions}\n\nIf you need to call a tool, emit :::action{"action":"execute_tool","tool":"<toolName>","params":{...}}:::`,
    },
  ];

  try {
    for await (const chunk of aiChatStream(augmentedMessages, options)) {
      chunksYielded++;
      yield chunk;
    }
    logObservability({
      requestId, traceId, subAccountId, route,
      provider,
      model: provider === "openai" ? OPENAI_MODEL : GEMINI_FALLBACK_MODEL,
      latencyMs: Date.now() - start,
      success: true,
      fallbackTriggered: false,
    });
  } catch (err: any) {
    logObservability({
      requestId, traceId, subAccountId, route,
      provider,
      model: provider === "openai" ? OPENAI_MODEL : GEMINI_FALLBACK_MODEL,
      latencyMs: Date.now() - start,
      success: false,
      fallbackTriggered: false,
      error: `aiChatWithToolsStream error after ${chunksYielded} chunks: ${err?.message}`,
    });
    // Always throw — never yield an "[AI Error: ...]" string that could leak as model output.
    throw err;
  }
}

export async function aiGenerateImage(prompt: string): Promise<string | null> {
  const requestId = generateRequestId();
  const start = Date.now();
  const primaryProvider = selectProvider();
  let didFallback = false;

  try {
    if (primaryProvider === "openai" && isOpenAIConfigured()) {
      try {
        const response = await withTimeout(
          getOpenAIClient().images.generate({
            model: "dall-e-3",
            prompt,
            n: 1,
            size: "1024x1024",
            response_format: "b64_json",
          }),
          30_000
        );
        const b64 = response.data?.[0]?.b64_json;
        if (b64) {
          logObservability({
            requestId, provider: "openai", model: "dall-e-3",
            latencyMs: Date.now() - start, success: true, fallbackTriggered: false,
            route: "image_generation",
          });
          return `data:image/png;base64,${b64}`;
        }
        throw new Error("OpenAI image generation returned no data");
      } catch (err: any) {
        recordOpenAIFailure();
        didFallback = true;
        console.warn(`[AI-GATEWAY] OpenAI image generation failed, falling back to Gemini: ${err?.message}`);
      }
    }

    if (!isGeminiAvailable()) {
      logObservability({
        requestId, provider: "gemini", model: "gemini-2.0-flash-exp",
        latencyMs: Date.now() - start, success: false, fallbackTriggered: didFallback,
        route: "image_generation", error: "No image generation provider available",
      });
      return null;
    }

    const result = await geminiGenerateImage(prompt);
    logObservability({
      requestId, provider: "gemini", model: "gemini-2.0-flash-exp",
      latencyMs: Date.now() - start, success: result !== null,
      fallbackTriggered: didFallback,
      route: "image_generation",
    });
    return result;
  } catch (err: any) {
    logObservability({
      requestId, provider: "gemini", model: "gemini-2.0-flash-exp",
      latencyMs: Date.now() - start, success: false, fallbackTriggered: false,
      route: "image_generation", error: err?.message,
    });
    console.error("[AI-GATEWAY] Image generation failed:", err?.message);
    return null;
  }
}

export function logProviderStartup(): void {
  const anthropicActive = isAnthropicConfigured();
  const openaiActive    = isOpenAIConfigured();
  const geminiActive    = isGeminiConfigured();

  // Identify which Gemini key is active
  const geminiKeyName =
    process.env.GEMINI_API_KEY_                ? "GEMINI_API_KEY_" :
    process.env.Gemini_API_Key_saas            ? "Gemini_API_Key_saas" :
    process.env.GEMINI_API_KEY                 ? "GEMINI_API_KEY" :
    process.env.GOOGLE_GENERATIVE_AI_API_KEY   ? "GOOGLE_GENERATIVE_AI_API_KEY" :
    "none";

  const providers: string[] = [];
  if (anthropicActive) providers.push(`Anthropic (${ANTHROPIC_MODEL}) [PRIMARY]`);
  if (openaiActive)    providers.push(`OpenAI (${OPENAI_MODEL})`);
  if (geminiActive)    providers.push(`Gemini (${GEMINI_FALLBACK_MODEL}, slot=${geminiKeyName})`);

  if (providers.length === 0) {
    console.warn("[AI-GATEWAY] ⚠️  No AI providers configured.");
    console.warn("[AI-GATEWAY]    Gemini: check GEMINI_API_KEY_ / Gemini_API_Key_saas / GEMINI_API_KEY / GOOGLE_AI_KEY slots");
    console.warn("[AI-GATEWAY]    OpenAI: check OPENAI_APEX_INT_KEY slot");
    console.warn("[AI-GATEWAY]    Anthropic: check ANTHROPIC slot");
  } else {
    console.log(`[AI-GATEWAY] ✅ Providers active: ${providers.join(" | ")}`);
    console.log(`[AI-GATEWAY]    Timeout=${DEFAULT_TIMEOUT_MS}ms CB=${CIRCUIT_BREAKER_THRESHOLD}/${CIRCUIT_BREAKER_WINDOW_MS / 1000}s`);
    if (geminiActive) {
      console.log(`[AI-GATEWAY] Provider selected: gemini (slot: ${geminiKeyName})`);
    }
  }

  // Stage 5 registry startup log
  logRegistryStartup();
}
