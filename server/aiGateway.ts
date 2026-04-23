import OpenAI from "openai";
import { geminiChat, geminiChatStream, geminiGenerateImage, isGeminiAvailable, isGeminiConfigured } from "./gemini";
import crypto from "crypto";

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
  if (fallbackKey) {
    if (primary && !isValidOpenAIKey(primary)) {
      console.warn(
        "[AI-GATEWAY] OPENAI_APEX_INT_KEY does not look like an OpenAI key " +
        "(prefix not 'sk-' or starts with 'sk-ant-'). Falling back to Replit-managed AI_INTEGRATIONS_OPENAI_API_KEY.",
      );
    }
    return { apiKey: fallbackKey, baseURL: fallbackBase, source: "AI_INTEGRATIONS_OPENAI_API_KEY" };
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
  provider: "openai" | "gemini";
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
  return !!process.env.OPENAI_APEX_INT_KEY;
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
  openaiConfigured: boolean;
  geminiConfigured: boolean;
  activeProvider: "openai" | "gemini";
} {
  const circuitOpen = isCircuitOpen();
  const openaiConfigured = isOpenAIConfigured();
  const geminiConfigured = isGeminiConfigured();

  return {
    primary: "OpenAI",
    fallback: "Gemini",
    circuitBreakerOpen: circuitOpen,
    circuitBreakerTrippedAt: circuitBreaker.trippedAt
      ? new Date(circuitBreaker.trippedAt).toISOString()
      : null,
    openaiConfigured,
    geminiConfigured,
    activeProvider: circuitOpen || !openaiConfigured ? "gemini" : "openai",
  };
}

export function isAIConfigured(): boolean {
  return isOpenAIConfigured() || isGeminiConfigured();
}

function generateRequestId(): string {
  return crypto.randomBytes(8).toString("hex");
}

function logObservability(entry: {
  requestId: string;
  traceId?: string;
  subAccountId?: string | number;
  route?: string;
  provider: "openai" | "gemini";
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

function selectProvider(): "openai" | "gemini" {
  return isOpenAIConfigured() && !isCircuitOpen() ? "openai" : "gemini";
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
          throw err;
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
    if (provider === "openai") {
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
          throw err;
        }
      }
      return;
    }

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
    // Whether mid-stream or pre-stream, throw the error so callers can handle it
    // explicitly via try/catch. We never yield a "[AI Error: ...]" string — that
    // would be indistinguishable from real model output and could leak to UI.
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
  provider: "openai" | "gemini";
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
    if (provider === "openai") {
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
              toolCalls.push({
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
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
          throw err;
        }
      }
    }

    if (!isGeminiAvailable()) {
      logObservability({ requestId, traceId, subAccountId, route, provider: "gemini", model: GEMINI_FALLBACK_MODEL, latencyMs: Date.now() - start, success: false, fallbackTriggered: false, error: "No AI provider available" });
      return { text: "", ok: false, errorMessage: "No AI provider available. This action could not be completed.", toolCalls: [], provider: "gemini", model: GEMINI_FALLBACK_MODEL };
    }

    logObservability({ requestId, traceId, subAccountId, route, provider: "gemini", model: GEMINI_FALLBACK_MODEL, latencyMs: Date.now() - start, success: false, fallbackTriggered: true, error: "Gemini fallback does not support multi-turn tool calling" });
    // INVARIANT: text === "" when ok === false. Caller decides on user-facing wording.
    return {
      text: "",
      ok: false,
      errorMessage: "Gemini fallback does not support multi-turn tool calling. Primary AI provider currently unavailable.",
      toolCalls: [],
      provider: "gemini",
      model: GEMINI_FALLBACK_MODEL,
    };
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
  const openaiActive = isOpenAIConfigured();
  const geminiActive = isGeminiConfigured();
  const providers: string[] = [];
  if (openaiActive) providers.push(`OpenAI (${OPENAI_MODEL}, key=OPENAI_APEX_INT_KEY)`);
  if (geminiActive) providers.push(`Gemini (${GEMINI_FALLBACK_MODEL})`);
  if (providers.length === 0) {
    console.warn("[AI-GATEWAY] No AI providers configured. AI features will be unavailable.");
  } else {
    console.log(`[AI-GATEWAY] Providers active: ${providers.join(", ")}. Timeout=${DEFAULT_TIMEOUT_MS}ms, CircuitBreaker=${CIRCUIT_BREAKER_THRESHOLD} failures/${CIRCUIT_BREAKER_WINDOW_MS / 1000}s window.`);
  }
}
