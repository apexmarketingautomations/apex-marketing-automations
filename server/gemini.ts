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
}

export async function geminiChat(
  messages: ChatMessage[],
  options: GeminiOptions = {}
): Promise<string> {
  const { temperature = 0.7, maxTokens = 1500 } = options;

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

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
    config: {
      systemInstruction: systemInstruction,
      temperature,
      maxOutputTokens: maxTokens,
    },
  });

  return response.text ?? "";
}

export async function geminiGenerateImage(prompt: string): Promise<string | null> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: `Generate a detailed description of this image concept for a Facebook ad: ${prompt}. Describe colors, composition, and visual elements in detail.`,
      config: {
        temperature: 0.8,
        maxOutputTokens: 500,
      },
    });
    return null;
  } catch (err: any) {
    console.error("Gemini image description failed:", err.message);
    return null;
  }
}
