import type { Express, Request, Response } from "express";
import express from "express";
import crypto from "crypto";
import { db } from "../db";
import { contentPosts, contentMedia } from "@shared/schema";

const STUDIO_WEBHOOK_SECRET =
  process.env.STUDIO_WEBHOOK_SECRET || crypto.randomBytes(32).toString("hex");

const CHARACTER_TO_SUBACCOUNT: Record<string, number> = {
  Layla: 22,
};
const DEFAULT_SUBACCOUNT_ID = 13;

export function registerStudioWebhook(app: Express): void {
  console.log("════════════════════════════════════════════════════════════════");
  console.log("[STUDIO-WEBHOOK] POST /webhook/studio is live");
  console.log(`[STUDIO-WEBHOOK] Secret (send as x-webhook-secret header):`);
  console.log(`[STUDIO-WEBHOOK]   ${STUDIO_WEBHOOK_SECRET}`);
  if (!process.env.STUDIO_WEBHOOK_SECRET) {
    console.log("[STUDIO-WEBHOOK] (auto-generated; set STUDIO_WEBHOOK_SECRET env var to make permanent)");
  }
  console.log("════════════════════════════════════════════════════════════════");

  app.post("/webhook/studio", express.json({ limit: "5mb" }), async (req: Request, res: Response) => {
    try {
      const provided = req.header("x-webhook-secret") || "";
      const expectedBuf = Buffer.from(STUDIO_WEBHOOK_SECRET);
      const providedBuf = Buffer.from(provided);
      if (
        providedBuf.length !== expectedBuf.length ||
        !crypto.timingSafeEqual(providedBuf, expectedBuf)
      ) {
        return res.status(401).json({ error: "invalid or missing x-webhook-secret" });
      }

      const {
        type,
        url,
        character,
        prompt,
        shot_type,
        aspect_ratio,
        face_swapped,
        generated_at,
        suggested_caption,
        tags,
      } = req.body ?? {};

      if (!type || !url) {
        return res.status(400).json({ error: "type and url are required" });
      }
      if (type !== "image" && type !== "video") {
        return res.status(400).json({ error: "type must be 'image' or 'video'" });
      }

      const subAccountId =
        (character && CHARACTER_TO_SUBACCOUNT[character]) || DEFAULT_SUBACCOUNT_ID;

      const hashtags =
        Array.isArray(tags) && tags.length > 0
          ? tags.map((t: string) => `#${String(t).replace(/^#/, "").trim()}`).join(" ")
          : null;

      const titleParts = [character, shot_type, aspect_ratio].filter(Boolean);
      const title = titleParts.length > 0 ? titleParts.join(" • ") : "Studio drop";

      const [post] = await db
        .insert(contentPosts)
        .values({
          subAccountId,
          title,
          caption: suggested_caption ?? prompt ?? null,
          hashtags,
          contentType: type,
          status: "draft",
          approvalStatus: "not_required",
          createdByUserId: "studio-webhook",
        })
        .returning();

      const [media] = await db
        .insert(contentMedia)
        .values({
          subAccountId,
          postId: post.id,
          fileUrl: url,
          fileType: type,
          sortOrder: 0,
          altText:
            prompt ??
            (character ? `${character} ${shot_type ?? ""}`.trim() : null) ??
            null,
        })
        .returning();

      console.log(
        `[STUDIO-WEBHOOK] queued post ${post.id} (${type}) sub=${subAccountId} char=${character ?? "?"} face_swapped=${!!face_swapped} generated_at=${generated_at ?? "?"}`,
      );

      res.status(201).json({
        success: true,
        postId: post.id,
        mediaId: media.id,
        subAccountId,
        status: post.status,
      });
    } catch (err: any) {
      console.error(`[STUDIO-WEBHOOK] error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });
}
