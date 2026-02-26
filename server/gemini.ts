import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.Gemini_API_Key_saas });

export function isGeminiConfigured(): boolean {
  return !!process.env.Gemini_API_Key_saas;
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
  const delays = [1000, 2000, 4000];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
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

  return response.text ?? "";
}

export async function* geminiChatStream(
  messages: ChatMessage[],
  options: GeminiOptions = {}
): AsyncGenerator<string> {
  const { contents, config } = prepareRequest(messages, options);

  const response = await ai.models.generateContentStream({
    model: "gemini-2.5-flash",
    contents,
    config,
  });

  for await (const chunk of response) {
    const text = chunk.text;
    if (text) {
      yield text;
    }
  }
}

export async function geminiGenerateImage(prompt: string): Promise<string | null> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: prompt,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    });

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
