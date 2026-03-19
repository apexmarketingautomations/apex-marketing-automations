import { openaiChat, openaiChatStream, isOpenAIConfigured, isOpenAIAvailable } from "./openai";
import { geminiChat, geminiChatStream, geminiChatWithToolsStream, isGeminiConfigured, isGeminiAvailable } from "./gemini";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface AIOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export function isAIConfigured(): boolean {
  return isOpenAIConfigured() || isGeminiConfigured();
}

export function isAIAvailable(): boolean {
  return isOpenAIAvailable() || isGeminiAvailable();
}

export function getAIProviderStatus(): string {
  if (isOpenAIAvailable()) {
    return isGeminiConfigured() ? "OpenAI active, Gemini standby" : "OpenAI active";
  }
  if (isGeminiAvailable()) {
    return isOpenAIConfigured() ? "Gemini active (OpenAI unavailable)" : "Gemini active";
  }
  if (!isOpenAIConfigured() && !isGeminiConfigured()) {
    return "No AI provider configured";
  }
  return "AI providers rate-limited";
}

export async function aiChat(
  messages: ChatMessage[],
  options: AIOptions = {}
): Promise<string> {
  if (isOpenAIAvailable()) {
    try {
      const result = await openaiChat(messages, options);
      console.log("[AI] Request handled by OpenAI");
      return result;
    } catch (err: any) {
      console.warn(`[AI] OpenAI failed (${err?.message}), falling back to Gemini`);
    }
  }

  if (isGeminiAvailable()) {
    const result = await geminiChat(messages, options);
    console.log("[AI] Request handled by Gemini (fallback)");
    return result;
  }

  throw new Error("No AI provider available");
}

export async function* aiChatStream(
  messages: ChatMessage[],
  options: AIOptions = {}
): AsyncGenerator<string> {
  if (isOpenAIAvailable()) {
    let yielded = false;
    try {
      for await (const chunk of openaiChatStream(messages, options)) {
        yielded = true;
        yield chunk;
      }
      console.log("[AI] Streaming request handled by OpenAI");
      return;
    } catch (err: any) {
      if (yielded) {
        console.error(`[AI] OpenAI stream error mid-response (${err?.message}), cannot fall back`);
        throw err;
      }
      console.warn(`[AI] OpenAI stream failed before first chunk (${err?.message}), falling back to Gemini`);
    }
  }

  if (isGeminiAvailable()) {
    console.log("[AI] Streaming request handled by Gemini (fallback)");
    for await (const chunk of geminiChatStream(messages, options)) {
      yield chunk;
    }
    return;
  }

  throw new Error("No AI provider available");
}

type ToolStreamChunk = { type: "text" | "search_grounding"; text?: string; grounding?: any };

export async function* aiChatWithToolsStream(
  messages: ChatMessage[],
  options: AIOptions = {}
): AsyncGenerator<ToolStreamChunk> {
  if (isOpenAIAvailable()) {
    let yielded = false;
    try {
      for await (const chunk of openaiChatStream(messages, options)) {
        yielded = true;
        yield { type: "text", text: chunk };
      }
      console.log("[AI] Tool-stream request handled by OpenAI");
      return;
    } catch (err: any) {
      if (yielded) {
        console.error(`[AI] OpenAI tool-stream error mid-response (${err?.message}), cannot fall back`);
        throw err;
      }
      console.warn(`[AI] OpenAI tool-stream failed before first chunk (${err?.message}), falling back to Gemini`);
    }
  }

  if (isGeminiAvailable()) {
    console.log("[AI] Tool-stream request handled by Gemini (fallback)");
    for await (const chunk of geminiChatWithToolsStream(messages, options)) {
      yield chunk;
    }
    return;
  }

  throw new Error("No AI provider available");
}
