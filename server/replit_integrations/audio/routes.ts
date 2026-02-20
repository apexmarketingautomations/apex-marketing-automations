import express, { type Express, type Request, type Response } from "express";
import { openai, speechToText, ensureCompatibleFormat } from "./client";
import { chatStorage } from "../chat/storage";

const audioBodyParser = express.json({ limit: "50mb" });

export function registerAudioRoutes(app: Express): void {
  app.post("/api/audio/transcribe", audioBodyParser, async (req: Request, res: Response) => {
    try {
      const { audio } = req.body;

      if (!audio) {
        return res.status(400).json({ error: "Audio data (base64) is required" });
      }

      const rawBuffer = Buffer.from(audio, "base64");
      const { buffer: audioBuffer, format: inputFormat } = await ensureCompatibleFormat(rawBuffer);
      const transcript = await speechToText(audioBuffer, inputFormat);

      res.json({ transcript });
    } catch (error) {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    }
  });

  app.post("/api/audio/voice-chat/:subAccountId", audioBodyParser, async (req: Request, res: Response) => {
    try {
      const subAccountId = parseInt(req.params.subAccountId as string);
      const { audio, voice = "alloy" } = req.body;

      if (!audio) {
        return res.status(400).json({ error: "Audio data (base64) is required" });
      }

      const rawBuffer = Buffer.from(audio, "base64");
      const { buffer: audioBuffer, format: inputFormat } = await ensureCompatibleFormat(rawBuffer);
      const userTranscript = await speechToText(audioBuffer, inputFormat);

      await chatStorage.createMessage(subAccountId, userTranscript, "inbound", "voice", "web");

      const msgs = await chatStorage.getMessagesByAccount(subAccountId);
      const chatHistory = msgs.slice(-20).reverse().map((m: any) => ({
        role: m.direction === "inbound" ? "user" as const : "assistant" as const,
        content: m.body,
      }));

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      res.write(`data: ${JSON.stringify({ type: "user_transcript", data: userTranscript })}\n\n`);

      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: chatHistory,
        stream: true,
      });

      let assistantTranscript = "";

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          assistantTranscript += delta.content;
          res.write(`data: ${JSON.stringify({ type: "transcript", data: delta.content })}\n\n`);
        }
      }

      await chatStorage.createMessage(subAccountId, assistantTranscript, "outbound", "voice", "web");

      res.write(`data: ${JSON.stringify({ type: "done", transcript: assistantTranscript })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error processing voice message:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Failed to process voice message" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to process voice message" });
      }
    }
  });
}
