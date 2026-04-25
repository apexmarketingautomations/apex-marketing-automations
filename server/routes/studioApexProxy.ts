import type { Express, Request, Response } from "express";
import express from "express";

const APEX_URL =
  process.env.STUDIO_APEX_URL || "https://apexmarketingautomations.com/webhook/studio";

function getApexSecret(): string {
  return process.env.STUDIO_WEBHOOK_SECRET || "";
}

export function registerStudioApexProxy(app: Express): void {
  console.log("[STUDIO-APEX] proxy registered at /api/studio/apex");

  app.post(
    "/api/studio/apex",
    express.json({ limit: "10mb" }),
    async (req: Request, res: Response) => {
      try {
        const secret = getApexSecret();
        if (!secret) {
          console.error("[STUDIO-APEX] STUDIO_WEBHOOK_SECRET is not configured");
          return res.status(500).json({ error: "studio webhook secret not configured" });
        }

        const upstream = await fetch(APEX_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-webhook-secret": secret,
          },
          body: JSON.stringify(req.body ?? {}),
        });

        const text = await upstream.text();
        res
          .status(upstream.status)
          .type(upstream.headers.get("content-type") || "application/json")
          .send(text);
      } catch (err) {
        console.error(
          "[STUDIO-APEX] proxy error:",
          err instanceof Error ? err.message : err,
        );
        res
          .status(502)
          .json({ error: err instanceof Error ? err.message : "apex proxy failed" });
      }
    },
  );
}
