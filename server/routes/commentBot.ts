import type { Express, Request, Response } from "express";
import { db } from "../db";
import { commentAutoReplies, subAccounts } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

function getTenant(req: Request): number {
  const id = (req as any).tenant?.subAccountId;
  if (!id || typeof id !== "number") {
    throw new Error("Tenant context missing or invalid");
  }
  return id;
}

export function registerCommentBotRoutes(app: Express) {

  app.get("/api/comment-bot/replies", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const { platform, status, limit: limitStr } = req.query;
      const limit = Math.min(parseInt(limitStr as string) || 50, 200);

      const conditions = [eq(commentAutoReplies.subAccountId, subAccountId)];
      if (platform) conditions.push(eq(commentAutoReplies.platform, platform as string));
      if (status) conditions.push(eq(commentAutoReplies.status, status as string));

      const rows = await db.select().from(commentAutoReplies)
        .where(and(...conditions))
        .orderBy(desc(commentAutoReplies.createdAt))
        .limit(limit);

      res.json(rows);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/comment-bot/stats", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);

      const allReplies = await db.select({
        status: commentAutoReplies.status,
        sentiment: commentAutoReplies.sentiment,
        platform: commentAutoReplies.platform,
      }).from(commentAutoReplies)
        .where(eq(commentAutoReplies.subAccountId, subAccountId));

      const stats = {
        total: allReplies.length,
        replied: allReplies.filter(r => r.status === "replied").length,
        skipped: allReplies.filter(r => r.status === "skipped").length,
        failed: allReplies.filter(r => r.status === "failed").length,
        disabled: allReplies.filter(r => r.status === "disabled").length,
        byPlatform: {
          facebook: allReplies.filter(r => r.platform === "facebook").length,
          instagram: allReplies.filter(r => r.platform === "instagram").length,
        },
        bySentiment: {
          positive: allReplies.filter(r => r.sentiment === "positive").length,
          negative: allReplies.filter(r => r.sentiment === "negative").length,
          neutral: allReplies.filter(r => r.sentiment === "neutral").length,
          question: allReplies.filter(r => r.sentiment === "question").length,
          spam: allReplies.filter(r => r.sentiment === "spam").length,
        },
      };

      res.json(stats);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/comment-bot/config", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const [account] = await db.select({
        config: subAccounts.config,
      }).from(subAccounts).where(eq(subAccounts.id, subAccountId));

      if (!account) return res.status(404).json({ error: "Account not found" });

      const commentConfig = (account.config as any)?.commentBot || {
        enabled: true,
        replyStyle: "friendly",
        skipRepliesOnReplies: true,
        maxRepliesPerHour: 30,
      };

      res.json(commentConfig);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/comment-bot/config", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const { enabled, replyStyle, skipRepliesOnReplies, maxRepliesPerHour } = req.body;

      const [account] = await db.select().from(subAccounts)
        .where(eq(subAccounts.id, subAccountId));
      if (!account) return res.status(404).json({ error: "Account not found" });

      const currentConfig = (account.config as any) || {};
      const updatedConfig = {
        ...currentConfig,
        commentBot: {
          ...(currentConfig.commentBot || {}),
          ...(enabled !== undefined ? { enabled } : {}),
          ...(replyStyle ? { replyStyle } : {}),
          ...(skipRepliesOnReplies !== undefined ? { skipRepliesOnReplies } : {}),
          ...(maxRepliesPerHour !== undefined ? { maxRepliesPerHour } : {}),
        },
      };

      await db.update(subAccounts).set({ config: updatedConfig })
        .where(eq(subAccounts.id, subAccountId));

      res.json(updatedConfig.commentBot);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
