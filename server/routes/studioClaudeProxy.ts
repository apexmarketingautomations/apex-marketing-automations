import type { Express, Request, Response } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
import { verifyAccountOwnership } from "./helpers";
import { getLaylaAccountId } from "../services/laylaAccountResolver";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_VERSION = "2023-06-01";

const MAX_TOKENS_CAP = 4000;
const MAX_MESSAGES = 20;
const MAX_CONTENT_CHARS = 8000;

const claudeProxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many Claude requests. Please slow down." },
});

function getApiKey(): string | null {
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  return key.length > 0 ? key : null;
}

type RawMessage = { role?: unknown; content?: unknown };

function validateMessages(messages: unknown): { ok: true; messages: { role: string; content: string }[] } | { ok: false; error: string } {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: "messages must be a non-empty array" };
  }
  if (messages.length > MAX_MESSAGES) {
    return { ok: false, error: `messages may not exceed ${MAX_MESSAGES} entries` };
  }
  const cleaned: { role: string; content: string }[] = [];
  for (const m of messages as RawMessage[]) {
    if (!m || typeof m !== "object") {
      return { ok: false, error: "each message must be an object" };
    }
    const role = m.role;
    if (role !== "user" && role !== "assistant") {
      return { ok: false, error: "message role must be 'user' or 'assistant'" };
    }
    if (typeof m.content !== "string") {
      return { ok: false, error: "message content must be a string" };
    }
    if (m.content.length === 0 || m.content.length > MAX_CONTENT_CHARS) {
      return { ok: false, error: `message content length must be 1..${MAX_CONTENT_CHARS}` };
    }
    cleaned.push({ role, content: m.content });
  }
  return { ok: true, messages: cleaned };
}

export function registerStudioClaudeProxy(app: Express): void {
  console.log("[STUDIO-CLAUDE] proxy registered at /api/studio/claude/messages");

  app.post(
    "/api/studio/claude/messages",
    claudeProxyLimiter,
    express.json({ limit: "256kb" }),
    async (req: Request, res: Response) => {
      try {
        const laylaAccountId = await getLaylaAccountId();
        const allowed = await verifyAccountOwnership(req, res, laylaAccountId);
        if (!allowed) return;

        const apiKey = getApiKey();
        if (!apiKey) {
          return res.status(503).json({ error: "ANTHROPIC_API_KEY not configured" });
        }

        const body = (req.body ?? {}) as { max_tokens?: unknown; messages?: unknown };
        const validated = validateMessages(body.messages);
        if (!validated.ok) {
          return res.status(400).json({ error: validated.error });
        }
        const maxTokens = typeof body.max_tokens === "number" && body.max_tokens > 0
          ? Math.min(Math.floor(body.max_tokens), MAX_TOKENS_CAP)
          : 1000;

        const upstream = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: maxTokens,
            messages: validated.messages,
          }),
        });

        const text = await upstream.text();
        res
          .status(upstream.status)
          .type(upstream.headers.get("content-type") || "application/json")
          .send(text);
      } catch (err) {
        console.error(
          "[STUDIO-CLAUDE] proxy error:",
          err instanceof Error ? err.message : err,
        );
        res.status(502).json({
          error: err instanceof Error ? err.message : "claude proxy failed",
        });
      }
    },
  );
}
