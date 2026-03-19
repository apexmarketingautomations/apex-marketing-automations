import OpenAI from "openai";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_APEX_INT_KEY });
  }
  return _client;
}

let rateLimitedUntil: number = 0;
const RATE_LIMIT_COOLDOWN_MS = 60_000;

export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_APEX_INT_KEY;
}

export function isOpenAIRateLimited(): boolean {
  return Date.now() < rateLimitedUntil;
}

export function isOpenAIAvailable(): boolean {
  return isOpenAIConfigured() && !isOpenAIRateLimited();
}

function markRateLimited(): void {
  rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  console.warn(`[OPENAI] Rate limited — cooling off for ${RATE_LIMIT_COOLDOWN_MS / 1000}s (until ${new Date(rateLimitedUntil).toISOString()})`);
}

function is429Error(error: any): boolean {
  const status = error?.status ?? error?.statusCode ?? error?.httpStatusCode;
  if (status === 429) return true;
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("429") || message.includes("rate limit") || message.includes("quota");
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface OpenAIOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

function isRetryableError(error: any): boolean {
  if (error?.code === "ECONNRESET" || error?.code === "ETIMEDOUT" || error?.code === "ENOTFOUND") {
    return true;
  }
  const status = error?.status ?? error?.statusCode ?? error?.httpStatusCode;
  if (status === 429 || status === 500 || status === 503) {
    return true;
  }
  const message = String(error?.message ?? "").toLowerCase();
  if (message.includes("429") || message.includes("rate limit") || message.includes("500") || message.includes("503") || message.includes("network") || message.includes("timeout") || message.includes("econnreset")) {
    return true;
  }
  return false;
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  if (isOpenAIRateLimited()) {
    throw new Error("OpenAI is rate-limited. Try again in a minute.");
  }

  const delays = [1000, 2000, 4000];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (is429Error(error)) {
        markRateLimited();
        throw error;
      }
      if (attempt < maxAttempts && isRetryableError(error)) {
        const delay = delays[attempt - 1];
        console.log(`OpenAI API retry attempt ${attempt}/${maxAttempts - 1} after ${delay}ms: ${error?.message ?? error}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Unexpected retry loop exit");
}

function buildMessages(messages: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map(m => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));
}

export async function openaiChat(
  messages: ChatMessage[],
  options: OpenAIOptions = {}
): Promise<string> {
  const { temperature = 0.7, maxTokens = 4096, jsonMode = false } = options;

  const response = await withRetry(() =>
    getClient().chat.completions.create({
      model: "gpt-4o",
      messages: buildMessages(messages),
      temperature,
      max_tokens: maxTokens,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    })
  );

  return response.choices[0]?.message?.content ?? "";
}

export async function* openaiChatStream(
  messages: ChatMessage[],
  options: OpenAIOptions = {}
): AsyncGenerator<string> {
  const { temperature = 0.7, maxTokens = 4096 } = options;

  const stream = await withRetry(() =>
    getClient().chat.completions.create({
      model: "gpt-4o",
      messages: buildMessages(messages),
      temperature,
      max_tokens: maxTokens,
      stream: true,
    })
  );

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) {
      yield text;
    }
  }
}
