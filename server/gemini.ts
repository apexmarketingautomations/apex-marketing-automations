import { GoogleGenAI } from "@google/genai";
import { recordSuccess } from "./pulse";

const ai = new GoogleGenAI({ apiKey: process.env.Gemini_API_Key_saas });

let rateLimitedUntil: number = 0;
const RATE_LIMIT_COOLDOWN_MS = 60_000;

export function isGeminiConfigured(): boolean {
  return !!process.env.Gemini_API_Key_saas;
}

export function isGeminiRateLimited(): boolean {
  return Date.now() < rateLimitedUntil;
}

export function isGeminiAvailable(): boolean {
  return isGeminiConfigured() && !isGeminiRateLimited();
}

function markRateLimited(): void {
  rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  console.warn(`[GEMINI] Rate limited — cooling off for ${RATE_LIMIT_COOLDOWN_MS / 1000}s (until ${new Date(rateLimitedUntil).toISOString()})`);
}

function is429Error(error: any): boolean {
  const status = error?.status ?? error?.statusCode ?? error?.httpStatusCode;
  if (status === 429) return true;
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("429") || message.includes("rate limit") || message.includes("resource has been exhausted");
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface GeminiOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

function prepareRequest(messages: ChatMessage[], options: GeminiOptions = {}) {
  const { temperature = 0.7, maxTokens = 4096, jsonMode = false } = options;

  let systemInstruction: string | undefined;
  const contents: { role: string; parts: { text: string }[] }[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = msg.content;
    } else {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }
  }

  const config: any = {
    systemInstruction: systemInstruction,
    temperature,
    maxOutputTokens: maxTokens,
  };

  if (jsonMode) {
    config.responseMimeType = "application/json";
  }

  return { contents, config };
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
  if (isGeminiRateLimited()) {
    throw new Error("Gemini is rate-limited. Try again in a minute.");
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
        console.log(`Gemini API retry attempt ${attempt}/${maxAttempts - 1} after ${delay}ms: ${error?.message ?? error}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Unexpected retry loop exit");
}

export async function geminiChat(
  messages: ChatMessage[],
  options: GeminiOptions = {}
): Promise<string> {
  const { contents, config } = prepareRequest(messages, options);

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
      config,
    })
  );

  recordSuccess("gemini");
  return response.text ?? "";
}

export async function* geminiChatStream(
  messages: ChatMessage[],
  options: GeminiOptions = {}
): AsyncGenerator<string> {
  const { contents, config } = prepareRequest(messages, options);

  const response = await withRetry(() =>
    ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents,
      config,
    })
  );

  for await (const chunk of response) {
    const text = chunk.text;
    if (text) {
      yield text;
    }
  }
}

export async function* geminiChatWithToolsStream(
  messages: ChatMessage[],
  options: GeminiOptions = {}
): AsyncGenerator<{ type: "text" | "search_grounding"; text?: string; grounding?: any }> {
  const { contents, config } = prepareRequest(messages, options);

  config.tools = [{ googleSearch: {} }];

  const response = await withRetry(() =>
    ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents,
      config,
    })
  );

  for await (const chunk of response) {
    if (chunk.text) {
      yield { type: "text", text: chunk.text };
    }
    
    if (chunk.groundingMetadata) {
      yield { type: "search_grounding", grounding: chunk.groundingMetadata };
    }
  }
}

export async function geminiGenerateImage(prompt: string): Promise<string | null> {
  try {
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-2.0-flash-exp",
        contents: prompt,
        config: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      })
    );

    if (response.candidates && response.candidates[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData?.mimeType?.startsWith("image/")) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
    }
    return null;
  } catch (err: any) {
    console.error("Gemini image generation failed:", err.message);
    return null;
  }
}
