import type { Response } from "express";
import { geminiChatStream } from "./gemini";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  keepaliveIntervalMs?: number;
}

export function initSSE(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

export function sendSSE(res: Response, event: string, data: any): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function sendSSEData(res: Response, data: any): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function streamGeminiResponse(
  res: Response,
  messages: ChatMessage[],
  options: StreamOptions = {}
): Promise<string> {
  const { temperature = 0.7, maxTokens = 8192, keepaliveIntervalMs = 15000 } = options;

  initSSE(res);

  const keepalive = setInterval(() => {
    try {
      res.write(`:keepalive\n\n`);
    } catch {}
  }, keepaliveIntervalMs);

  let fullText = "";
  let closed = false;

  res.on("close", () => {
    closed = true;
    clearInterval(keepalive);
  });

  try {
    const stream = geminiChatStream(messages, { temperature, maxTokens });
    for await (const chunk of stream) {
      if (closed) break;
      fullText += chunk;
      sendSSEData(res, { content: chunk });
    }

    if (!closed) {
      sendSSEData(res, { done: true, fullText });
      res.end();
    }
  } catch (error: any) {
    clearInterval(keepalive);
    if (!closed) {
      sendSSEData(res, { error: error.message || "Streaming failed" });
      res.end();
    }
  } finally {
    clearInterval(keepalive);
  }

  return fullText;
}

export class ProgressStream {
  private res: Response;
  private keepalive: NodeJS.Timeout;
  private closed = false;

  constructor(res: Response, keepaliveIntervalMs = 15000) {
    this.res = res;
    initSSE(res);

    this.keepalive = setInterval(() => {
      try {
        if (!this.closed) res.write(`:keepalive\n\n`);
      } catch {}
    }, keepaliveIntervalMs);

    res.on("close", () => {
      this.closed = true;
      clearInterval(this.keepalive);
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  sendStep(stepId: string, status: string, label: string, detail?: string): void {
    if (this.closed) return;
    sendSSEData(this.res, { type: "step", stepId, status, label, detail });
  }

  sendProgress(message: string, percent?: number): void {
    if (this.closed) return;
    sendSSEData(this.res, { type: "progress", message, percent });
  }

  sendResult(data: any): void {
    if (this.closed) return;
    sendSSEData(this.res, { type: "result", ...data });
  }

  sendError(message: string): void {
    if (this.closed) return;
    sendSSEData(this.res, { type: "error", error: message });
  }

  end(data?: any): void {
    if (this.closed) return;
    clearInterval(this.keepalive);
    if (data) {
      sendSSEData(this.res, { done: true, ...data });
    } else {
      sendSSEData(this.res, { done: true });
    }
    this.res.end();
    this.closed = true;
  }
}
