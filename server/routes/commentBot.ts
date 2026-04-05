import type { Express, Request, Response } from "express";
import { db } from "../db";
import { commentAutoReplies, subAccounts, messages } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getMetaConfig } from "../metaConfig";

function getTenant(req: Request): number {
  const id = (req as any).tenant?.subAccountId;
  if (!id || typeof id !== "number") {
    throw new Error("Tenant context missing or invalid");
  }
  return id;
}

function requireAdmin(req: Request, res: Response): boolean {
  const secret = process.env.ADMIN_API_SECRET || process.env.ADMIN_USER_ID;
  if (!secret) {
    res.status(503).json({ error: "Admin API not configured" });
    return false;
  }
  const auth = req.headers["x-admin-secret"];
  if (auth !== secret) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

export function registerCommentBotRoutes(app: Express) {

  app.post("/api/comment-bot/reengage", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { dryRun = true, batchLimit = 20, reengageDays = 60, subAccountId = 22 } = req.body || {};
      const { runReengageJob } = await import("../services/commentBot/reengageJob");
      const result = await runReengageJob({
        dryRun: dryRun !== false,
        batchLimit: Math.min(batchLimit, 200),
        reengageDays,
        subAccountId,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/comment-bot/replies", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const { platform, status, sentiment, limit: limitStr } = req.query;
      const limit = Math.min(parseInt(limitStr as string) || 50, 200);

      const conditions = [eq(commentAutoReplies.subAccountId, subAccountId)];
      if (platform) conditions.push(eq(commentAutoReplies.platform, platform as string));
      if (status) conditions.push(eq(commentAutoReplies.status, status as string));
      if (sentiment) conditions.push(eq(commentAutoReplies.sentiment, sentiment as string));

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

  app.post("/api/comment-bot/sync-dms", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { subAccountId = 22, maxPages = 50 } = req.body || {};
      const metaCfg = await getMetaConfig(subAccountId);

      let convUrl: string | null = `https://graph.facebook.com/v19.0/${metaCfg.pageId}/conversations?fields=id,updated_time,participants,messages.limit(25){message,from,created_time}&limit=25&access_token=${metaCfg.accessToken}${metaCfg.appsecretProof ? `&appsecret_proof=${metaCfg.appsecretProof}` : ""}`;

      let totalConversations = 0;
      let totalMessages = 0;
      let skippedDuplicates = 0;
      let pageCount = 0;

      while (convUrl && pageCount < maxPages) {
        pageCount++;
        const convRes = await fetch(convUrl);
        const convData = await convRes.json() as any;
        if (!convData.data) {
          console.log(`[DM-SYNC] Error fetching conversations page ${pageCount}:`, convData.error?.message);
          break;
        }

        for (const conv of convData.data) {
          totalConversations++;
          const participants = conv.participants?.data || [];
          const otherUser = participants.find((p: any) => p.id !== metaCfg.pageId);
          const senderId = otherUser?.id || "unknown";
          const threadId = `${subAccountId}::${senderId}::facebook`;

          const msgList = conv.messages?.data || [];
          for (const msg of msgList) {
            if (!msg.message) continue;

            const isFromPage = msg.from?.id === metaCfg.pageId;
            const direction = isFromPage ? "outbound" : "inbound";
            const msgSid = `meta_${conv.id}_${msg.id || new Date(msg.created_time).getTime()}`;

            const existing = await db.select({ id: messages.id }).from(messages)
              .where(and(
                eq(messages.messageSid, msgSid),
                eq(messages.subAccountId, subAccountId),
              )).limit(1);

            if (existing.length > 0) {
              skippedDuplicates++;
              continue;
            }

            await db.insert(messages).values({
              subAccountId,
              direction,
              body: msg.message,
              status: "delivered",
              contactPhone: senderId,
              channel: "facebook",
              messageSid: msgSid,
              threadId,
              senderId: direction === "inbound" ? senderId : metaCfg.pageId,
              pageId: metaCfg.pageId,
              traceId: `sync-${Date.now()}`,
              createdAt: new Date(msg.created_time),
            });
            totalMessages++;
          }
        }

        console.log(`[DM-SYNC] Page ${pageCount}: ${convData.data.length} conversations, running total: ${totalMessages} messages synced`);
        convUrl = convData.paging?.next || null;
      }

      res.json({
        subAccountId,
        totalConversations,
        totalMessagesSynced: totalMessages,
        skippedDuplicates,
        pagesProcessed: pageCount,
        hasMore: !!convUrl,
      });
    } catch (err: any) {
      console.error("[DM-SYNC] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/comment-bot/manual-reply", async (req: Request, res: Response) => {
    try {
      const { commentId, replyText, platform } = req.body;
      if (!commentId || !replyText) {
        return res.status(400).json({ error: "commentId and replyText are required" });
      }

      const allAccounts = await db.select().from(subAccounts);
      const account = allAccounts.find(a => a.metaPageId && a.metaAccessToken);
      if (!account) {
        return res.status(400).json({ error: "No Meta account configured" });
      }

      const url = `https://graph.facebook.com/v19.0/${commentId}/comments`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: replyText,
          access_token: account.metaAccessToken,
        }),
      });
      const data = await response.json() as any;
      if (!response.ok) {
        console.error("[COMMENT-BOT] Manual reply failed:", data.error?.message);
        return res.status(400).json({ error: data.error?.message || "Reply failed" });
      }

      console.log(`[COMMENT-BOT] Manual reply sent to ${commentId}: ${replyText.slice(0, 50)}...`);
      res.json({ success: true, replyId: data.id });
    } catch (err: any) {
      console.error("[COMMENT-BOT] Manual reply error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/comment-bot/react", async (req: Request, res: Response) => {
    try {
      const { commentId, reactionType, platform } = req.body;
      if (!commentId || !reactionType) {
        return res.status(400).json({ error: "commentId and reactionType are required" });
      }

      const validReactions = ["LIKE", "LOVE", "HAHA", "WOW", "SAD", "ANGRY"];
      if (!validReactions.includes(reactionType)) {
        return res.status(400).json({ error: `Invalid reaction. Must be one of: ${validReactions.join(", ")}` });
      }

      const igOnlyReactions = ["LOVE", "HAHA", "WOW", "SAD", "ANGRY"];
      if (platform === "facebook" && igOnlyReactions.includes(reactionType)) {
        return res.status(400).json({ error: `${reactionType} reaction is only supported on Instagram` });
      }

      const allAccounts = await db.select().from(subAccounts);
      const account = allAccounts.find(a => a.metaPageId && a.metaAccessToken);
      if (!account) {
        return res.status(400).json({ error: "No Meta account configured" });
      }

      if (platform === "facebook") {
        const url = `https://graph.facebook.com/v19.0/${commentId}/likes`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token: account.metaAccessToken }),
        });
        const data = await response.json() as any;
        if (!response.ok) {
          return res.status(400).json({ error: data.error?.message || "React failed" });
        }
        res.json({ success: true });
      } else {
        const url = `https://graph.facebook.com/v19.0/${commentId}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hidden: false,
            access_token: account.metaAccessToken,
          }),
        });
        res.json({ success: true, note: "Instagram reactions require specific API access" });
      }
    } catch (err: any) {
      console.error("[COMMENT-BOT] React error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

}
