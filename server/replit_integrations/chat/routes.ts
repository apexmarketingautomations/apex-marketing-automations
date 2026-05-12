import type { Express, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { chatStorage } from "./storage";

// Lazy-instantiate to avoid crash when GEMINI key is absent
let _ai: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  const key = process.env.Gemini_API_Key_saas || process.env.GEMINI_API_KEY || "";
  if (!_ai) _ai = new GoogleGenAI({ apiKey: key });
  return _ai;
}

export function registerChatRoutes(app: Express): void {
  app.get("/api/chat-messages/:subAccountId", async (req: Request, res: Response) => {
    try {
      const subAccountId = parseInt(req.params.subAccountId as string);
      const msgs = await chatStorage.getMessagesByAccount(subAccountId);
      res.json(msgs);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.post("/api/chat-messages/:subAccountId", async (req: Request, res: Response) => {
    try {
      const subAccountId = parseInt(req.params.subAccountId as string);
      const { content } = req.body;

      await chatStorage.createMessage(subAccountId, content, "inbound", "chat", "web");

      const msgs = await chatStorage.getMessagesByAccount(subAccountId);
      const chatContents = msgs.slice(-20).reverse().map((m) => ({
        role: m.direction === "inbound" ? "user" as const : "model" as const,
        parts: [{ text: m.body }],
      }));

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const response = await getGeminiClient().models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: chatContents,
        config: {
          maxOutputTokens: 4096,
        },
      });

      let fullResponse = "";

      for await (const chunk of response) {
        const text = chunk.text ?? "";
        if (text) {
          fullResponse += text;
          res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
        }
      }

      await chatStorage.createMessage(subAccountId, fullResponse, "outbound", "chat", "web");

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error sending message:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Failed to send message" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to send message" });
      }
    }
  });
}
