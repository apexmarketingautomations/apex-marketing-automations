import OpenAI from "openai";
import { geminiChat, geminiChatStream, isGeminiAvailable, isGeminiConfigured } from "./gemini";
import crypto from "crypto";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const OPENAI_MODEL = "gpt-4o-mini";
const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 30_000;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_WINDOW_MS = 60_000;
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
}

export interface AIResponse {
  text: string;
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

function isOpenAIConfigured(): boolean {
  return !!(
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
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

function generateRequestId(): string {
  return crypto.randomBytes(8).toString("hex");
}

function logObservability(entry: {
  requestId: string;
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
    openai.chat.completions.create({
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
    openai.chat.completions.create({
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
  const { temperature = 0.7, maxTokens = 4096, jsonMode = false } = options;
  const text = await geminiChat(messages, { temperature, maxTokens, jsonMode });
  return {
    text,
    provider: "gemini",
    model: GEMINI_FALLBACK_MODEL,
  };
}

export async function aiChat(
  messages: ChatMessage[],
  options: AIOptions = {}
): Promise<AIResponse> {
  const requestId = generateRequestId();
  const route = options.route;
  const start = Date.now();
  let fallbackTriggered = false;

  if (isOpenAIConfigured() && !isCircuitOpen()) {
    for (let attempt = 0; attempt <= MAX_OPENAI_RETRIES; attempt++) {
      try {
        const result = await callOpenAI(messages, options);
        logObservability({
          requestId,
          route,
          provider: "openai",
          model: result.model,
          latencyMs: Date.now() - start,
          success: true,
          fallbackTriggered: false,
        });
        return result;
      } catch (err: any) {
        recordOpenAIFailure();
        if (attempt < MAX_OPENAI_RETRIES) {
          console.warn(`[AI-GATEWAY] OpenAI attempt ${attempt + 1} failed (retrying): ${err?.message}`);
          continue;
        }
        console.warn(`[AI-GATEWAY] OpenAI failed after ${MAX_OPENAI_RETRIES + 1} attempt(s): ${err?.message} — falling back to Gemini`);
        fallbackTriggered = true;
      }
    }
  } else if (!isOpenAIConfigured()) {
    fallbackTriggered = true;
  } else {
    fallbackTriggered = true;
    console.log("[AI-GATEWAY] Circuit breaker open — routing directly to Gemini");
  }

  if (!isGeminiAvailable()) {
    const latencyMs = Date.now() - start;
    logObservability({ requestId, route, provider: "gemini", latencyMs, success: false, fallbackTriggered, error: "No AI provider available" });
    throw new Error("No AI provider available (OpenAI circuit open, Gemini unavailable)");
  }

  try {
    const result = await callGemini(messages, options);
    logObservability({
      requestId,
      route,
      provider: "gemini",
      model: result.model,
      latencyMs: Date.now() - start,
      success: true,
      fallbackTriggered,
    });
    return result;
  } catch (err: any) {
    logObservability({
      requestId,
      route,
      provider: "gemini",
      latencyMs: Date.now() - start,
      success: false,
      fallbackTriggered,
      error: err?.message,
    });
    throw err;
  }
}

export async function* aiChatStream(
  messages: ChatMessage[],
  options: AIOptions = {}
): AsyncGenerator<string> {
  const requestId = generateRequestId();
  const route = options.route;
  const start = Date.now();
  let chunksYielded = 0;
  let fallbackTriggered = false;

  const shouldUseOpenAI = isOpenAIConfigured() && !isCircuitOpen();

  if (shouldUseOpenAI) {
    for (let attempt = 0; attempt <= MAX_OPENAI_RETRIES; attempt++) {
      try {
        const { temperature = 0.7, maxTokens = 4096, jsonMode = false, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const stream = await openai.chat.completions.create({
            model: OPENAI_MODEL,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            temperature,
            max_tokens: maxTokens,
            stream: true,
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          });

          clearTimeout(timer);

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content ?? "";
            if (delta) {
              chunksYielded++;
              yield delta;
            }
          }

          logObservability({
            requestId,
            route,
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
              requestId,
              route,
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
        if (attempt < MAX_OPENAI_RETRIES) {
          console.warn(`[AI-GATEWAY] OpenAI stream attempt ${attempt + 1} failed (retrying): ${err?.message}`);
          continue;
        }
        console.warn(`[AI-GATEWAY] OpenAI stream failed after ${MAX_OPENAI_RETRIES + 1} attempt(s): ${err?.message} — falling back to Gemini`);
        fallbackTriggered = true;
      }
    }
  } else {
    if (!shouldUseOpenAI && isOpenAIConfigured()) {
      console.log("[AI-GATEWAY] Circuit breaker open — routing stream directly to Gemini");
    }
    fallbackTriggered = !isOpenAIConfigured() ? false : true;
  }

  if (!isGeminiAvailable()) {
    logObservability({ requestId, route, provider: "gemini", latencyMs: Date.now() - start, success: false, fallbackTriggered, error: "No AI provider available" });
    throw new Error("No AI provider available for streaming");
  }

  try {
    const { temperature = 0.7, maxTokens = 4096 } = options;
    const geminiStream = geminiChatStream(messages, { temperature, maxTokens });
    for await (const chunk of geminiStream) {
      yield chunk;
    }
    logObservability({
      requestId,
      route,
      provider: "gemini",
      model: GEMINI_FALLBACK_MODEL,
      latencyMs: Date.now() - start,
      success: true,
      fallbackTriggered,
    });
  } catch (err: any) {
    logObservability({
      requestId,
      route,
      provider: "gemini",
      latencyMs: Date.now() - start,
      success: false,
      fallbackTriggered,
      error: err?.message,
    });
    throw err;
  }
}

export async function aiChatWithTools(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  options: AIOptions = {}
): Promise<AIResponse> {
  const requestId = generateRequestId();
  const route = options.route;
  const start = Date.now();
  let fallbackTriggered = false;

  if (isOpenAIConfigured() && !isCircuitOpen()) {
    for (let attempt = 0; attempt <= MAX_OPENAI_RETRIES; attempt++) {
      try {
        const result = await callOpenAIWithTools(messages, tools, options);
        logObservability({
          requestId,
          route,
          provider: "openai",
          model: result.model,
          latencyMs: Date.now() - start,
          success: true,
          fallbackTriggered: false,
        });
        return result;
      } catch (err: any) {
        recordOpenAIFailure();
        if (attempt < MAX_OPENAI_RETRIES) {
          console.warn(`[AI-GATEWAY] OpenAI (tools) attempt ${attempt + 1} failed (retrying): ${err?.message}`);
          continue;
        }
        console.warn(`[AI-GATEWAY] OpenAI (tools) failed after ${MAX_OPENAI_RETRIES + 1} attempt(s): ${err?.message} — falling back to Gemini`);
        fallbackTriggered = true;
      }
    }
  } else {
    fallbackTriggered = !isOpenAIConfigured() ? false : true;
    if (!isOpenAIConfigured()) {
      console.log("[AI-GATEWAY] OpenAI not configured — using Gemini for tools call");
    }
  }

  if (!isGeminiAvailable()) {
    const latencyMs = Date.now() - start;
    logObservability({ requestId, route, provider: "gemini", latencyMs, success: false, fallbackTriggered, error: "No AI provider available" });
    throw new Error("No AI provider available for tool-calling request");
  }

  const toolDescriptions = tools
    .map((t) => `Tool: ${t.function.name} — ${t.function.description || ""}`)
    .join("\n");
  const messagesWithTools = [
    ...messages,
    {
      role: "system" as const,
      content: `Available tools:\n${toolDescriptions}\n\nIf you need to call a tool, include it in your response using the :::action{...}::: format.`,
    },
  ];

  try {
    const result = await callGemini(messagesWithTools, options);
    logObservability({
      requestId,
      route,
      provider: "gemini",
      model: result.model,
      latencyMs: Date.now() - start,
      success: true,
      fallbackTriggered,
    });
    return result;
  } catch (err: any) {
    logObservability({
      requestId,
      route,
      provider: "gemini",
      latencyMs: Date.now() - start,
      success: false,
      fallbackTriggered,
      error: err?.message,
    });
    throw err;
  }
}

export async function* aiChatWithToolsStream(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  options: AIOptions = {}
): AsyncGenerator<string> {
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

  yield* aiChatStream(augmentedMessages, options);
}

export function isAIConfigured(): boolean {
  return isOpenAIConfigured() || isGeminiConfigured();
}
