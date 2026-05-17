// @ts-nocheck
import type { Express, Request, Response } from "express";
import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { verifyAccountOwnership } from "./helpers";
import { getLaylaAccountId } from "../services/laylaAccountResolver";

const MUAPI_BASE = "https://api.muapi.ai/api/v1";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const muapiProxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many studio requests. Please slow down." },
});

function getServerApiKey(): string | null {
  const key = (process.env.MUAPI_API_KEY || "").trim();
  return key.length > 0 ? key : null;
}

export function registerStudioMuapiProxy(app: Express): void {
  console.log("[STUDIO-MUAPI] proxy registered at /api/studio/muapi/*");

  app.post(
    "/api/studio/muapi/upload_file",
    muapiProxyLimiter,
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const laylaAccountId = await getLaylaAccountId();
        const allowed = await verifyAccountOwnership(req, res, laylaAccountId);
        if (!allowed) return;

        const apiKey = getServerApiKey();
        if (!apiKey) {
          return res.status(503).json({ error: "MUAPI_API_KEY not configured" });
        }
        if (!req.file) return res.status(400).json({ error: "missing file in form field 'file'" });

        const form = new FormData();
        const blob = new Blob([req.file.buffer], {
          type: req.file.mimetype || "application/octet-stream",
        });
        form.append("file", blob, req.file.originalname || "upload");

        const upstream = await fetch(`${MUAPI_BASE}/upload_file`, {
          method: "POST",
          headers: { "x-api-key": apiKey },
          body: form,
        });

        const text = await upstream.text();
        res.status(upstream.status).type(upstream.headers.get("content-type") || "application/json").send(text);
      } catch (err) {
        console.error("[STUDIO-MUAPI] upload error:", err instanceof Error ? err.message : err);
        res.status(502).json({ error: err instanceof Error ? err.message : "upload proxy failed" });
      }
    },
  );

  app.get(
    "/api/studio/muapi/predictions/:id/result",
    muapiProxyLimiter,
    async (req: Request, res: Response) => {
      try {
        const laylaAccountId = await getLaylaAccountId();
        const allowed = await verifyAccountOwnership(req, res, laylaAccountId);
        if (!allowed) return;

        const apiKey = getServerApiKey();
        if (!apiKey) {
          return res.status(503).json({ error: "MUAPI_API_KEY not configured" });
        }

        const upstream = await fetch(
          `${MUAPI_BASE}/predictions/${encodeURIComponent(req.params.id)}/result`,
          { headers: { "x-api-key": apiKey } },
        );
        const text = await upstream.text();
        res.status(upstream.status).type(upstream.headers.get("content-type") || "application/json").send(text);
      } catch (err) {
        console.error("[STUDIO-MUAPI] poll error:", err instanceof Error ? err.message : err);
        res.status(502).json({ error: err instanceof Error ? err.message : "poll proxy failed" });
      }
    },
  );

  app.post(
    "/api/studio/muapi/*endpoint",
    muapiProxyLimiter,
    express.json({ limit: "10mb" }),
    async (req: Request, res: Response) => {
      try {
        const laylaAccountId = await getLaylaAccountId();
        const allowed = await verifyAccountOwnership(req, res, laylaAccountId);
        if (!allowed) return;

        const apiKey = getServerApiKey();
        if (!apiKey) {
          return res.status(503).json({ error: "MUAPI_API_KEY not configured" });
        }

        const raw = (req.params as Record<string, string | string[]>).endpoint;
        const subPath = Array.isArray(raw) ? raw.join("/") : (raw ?? "");
        if (!subPath || subPath === "upload_file") {
          return res.status(400).json({ error: "invalid endpoint" });
        }

        const upstream = await fetch(`${MUAPI_BASE}/${subPath}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey },
          body: JSON.stringify(req.body ?? {}),
        });
        const text = await upstream.text();
        res.status(upstream.status).type(upstream.headers.get("content-type") || "application/json").send(text);
      } catch (err) {
        console.error("[STUDIO-MUAPI] post error:", err instanceof Error ? err.message : err);
        res.status(502).json({ error: err instanceof Error ? err.message : "post proxy failed" });
      }
    },
  );
}
