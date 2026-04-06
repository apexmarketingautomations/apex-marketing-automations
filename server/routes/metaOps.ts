import type { Express } from "express";
import { asyncHandler, parseIntParam } from "./helpers";
import { db } from "../db";
import { messages, commentAutoReplies, subAccounts } from "@shared/schema";
import { eq, and, gte, desc, sql, or } from "drizzle-orm";

export function registerMetaOpsRoutes(app: Express) {

  app.get("/api/meta-ops/health/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!subAccountId) return res.status(400).json({ error: "Invalid subAccountId" });

    const now = new Date();
    const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const h1 = new Date(now.getTime() - 60 * 60 * 1000);

    const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
    if (!account) return res.status(404).json({ error: "Account not found" });

    const hasPageId = !!account.metaPageId;
    const hasToken = !!account.metaAccessToken;
    const hasIgId = !!(account as any).metaInstagramAccountId;
    const commentConfig = (account.config as any)?.commentBot || {};

    let tokenValid = false;
    let pageName = "";
    let tokenError = "";
    if (hasPageId && hasToken) {
      try {
        const { validateMetaConfigForAccount } = await import("../metaConfig");
        const v = await validateMetaConfigForAccount(subAccountId);
        tokenValid = v.valid;
        pageName = v.pageName || "";
        tokenError = v.error || "";
      } catch (e: any) {
        tokenError = e.message;
      }
    }

    const [fbDmIn24h] = await db.select({ c: sql<number>`count(*)` }).from(messages)
      .where(and(eq(messages.subAccountId, subAccountId), eq(messages.channel, "facebook"), eq(messages.direction, "inbound"), gte(messages.createdAt, h24)));
    const [fbDmOut24h] = await db.select({ c: sql<number>`count(*)` }).from(messages)
      .where(and(eq(messages.subAccountId, subAccountId), eq(messages.channel, "facebook"), eq(messages.direction, "outbound"), gte(messages.createdAt, h24)));
    const [fbDmFailed24h] = await db.select({ c: sql<number>`count(*)` }).from(messages)
      .where(and(eq(messages.subAccountId, subAccountId), eq(messages.channel, "facebook"), eq(messages.direction, "outbound"), eq(messages.status, "failed"), gte(messages.createdAt, h24)));

    const [igDmIn24h] = await db.select({ c: sql<number>`count(*)` }).from(messages)
      .where(and(eq(messages.subAccountId, subAccountId), eq(messages.channel, "instagram"), eq(messages.direction, "inbound"), gte(messages.createdAt, h24)));
    const [igDmOut24h] = await db.select({ c: sql<number>`count(*)` }).from(messages)
      .where(and(eq(messages.subAccountId, subAccountId), eq(messages.channel, "instagram"), eq(messages.direction, "outbound"), gte(messages.createdAt, h24)));
    const [igDmFailed24h] = await db.select({ c: sql<number>`count(*)` }).from(messages)
      .where(and(eq(messages.subAccountId, subAccountId), eq(messages.channel, "instagram"), eq(messages.direction, "outbound"), eq(messages.status, "failed"), gte(messages.createdAt, h24)));

    const [commentStats24h] = await db.select({
      total: sql<number>`count(*)`,
      replied: sql<number>`count(*) filter (where status = 'replied')`,
      skipped: sql<number>`count(*) filter (where status = 'skipped')`,
      failed: sql<number>`count(*) filter (where status = 'failed')`,
      rateLimited: sql<number>`count(*) filter (where status = 'rate_limited')`,
    }).from(commentAutoReplies)
      .where(and(eq(commentAutoReplies.subAccountId, subAccountId), gte(commentAutoReplies.createdAt, h24)));

    const [fbComments24h] = await db.select({ c: sql<number>`count(*)` }).from(commentAutoReplies)
      .where(and(eq(commentAutoReplies.subAccountId, subAccountId), eq(commentAutoReplies.platform, "facebook"), gte(commentAutoReplies.createdAt, h24)));
    const [igComments24h] = await db.select({ c: sql<number>`count(*)` }).from(commentAutoReplies)
      .where(and(eq(commentAutoReplies.subAccountId, subAccountId), eq(commentAutoReplies.platform, "instagram"), gte(commentAutoReplies.createdAt, h24)));

    const [lastFbDm] = await db.select({ t: messages.createdAt }).from(messages)
      .where(and(eq(messages.subAccountId, subAccountId), eq(messages.channel, "facebook"), eq(messages.direction, "inbound")))
      .orderBy(desc(messages.createdAt)).limit(1);
    const [lastIgDm] = await db.select({ t: messages.createdAt }).from(messages)
      .where(and(eq(messages.subAccountId, subAccountId), eq(messages.channel, "instagram"), eq(messages.direction, "inbound")))
      .orderBy(desc(messages.createdAt)).limit(1);
    const [lastFbReply] = await db.select({ t: messages.createdAt }).from(messages)
      .where(and(eq(messages.subAccountId, subAccountId), eq(messages.channel, "facebook"), eq(messages.direction, "outbound"), eq(messages.status, "sent")))
      .orderBy(desc(messages.createdAt)).limit(1);
    const [lastIgReply] = await db.select({ t: messages.createdAt }).from(messages)
      .where(and(eq(messages.subAccountId, subAccountId), eq(messages.channel, "instagram"), eq(messages.direction, "outbound"), eq(messages.status, "sent")))
      .orderBy(desc(messages.createdAt)).limit(1);
    const [lastComment] = await db.select({ t: commentAutoReplies.createdAt }).from(commentAutoReplies)
      .where(eq(commentAutoReplies.subAccountId, subAccountId))
      .orderBy(desc(commentAutoReplies.createdAt)).limit(1);
    const [lastCommentReply] = await db.select({ t: commentAutoReplies.repliedAt }).from(commentAutoReplies)
      .where(and(eq(commentAutoReplies.subAccountId, subAccountId), eq(commentAutoReplies.status, "replied")))
      .orderBy(desc(commentAutoReplies.repliedAt)).limit(1);

    const [repliedPerHour] = await db.select({ c: sql<number>`count(*)` }).from(commentAutoReplies)
      .where(and(eq(commentAutoReplies.subAccountId, subAccountId), eq(commentAutoReplies.status, "replied"), gte(commentAutoReplies.repliedAt, h1)));

    const aiCfg = (account.aiPromptConfig as any) || {};

    res.json({
      account: { id: subAccountId, name: account.name, pageId: account.metaPageId, igAccountId: (account as any).metaInstagramAccountId },
      credentials: { hasPageId, hasToken, hasIgId, tokenValid, pageName, tokenError },
      autoReply: { enabled: aiCfg.autoReplyEnabled !== false, hasPersona: !!(aiCfg.systemPrompt && aiCfg.systemPrompt.length > 200) },
      commentBot: { enabled: commentConfig.enabled !== false, maxPerHour: commentConfig.maxRepliesPerHour || 30, repliedThisHour: Number(repliedPerHour?.c || 0), replyStyle: commentConfig.replyStyle || "layla" },
      channels: {
        facebookDm: {
          status: hasPageId && hasToken && tokenValid ? "connected" : hasToken ? "token_issue" : "disconnected",
          inbound24h: Number(fbDmIn24h?.c || 0),
          outbound24h: Number(fbDmOut24h?.c || 0),
          failed24h: Number(fbDmFailed24h?.c || 0),
          lastInbound: lastFbDm?.t || null,
          lastOutbound: lastFbReply?.t || null,
        },
        instagramDm: {
          status: hasIgId && hasToken && tokenValid ? "connected" : hasToken && hasIgId ? "token_issue" : hasToken ? "no_ig_account" : "disconnected",
          inbound24h: Number(igDmIn24h?.c || 0),
          outbound24h: Number(igDmOut24h?.c || 0),
          failed24h: Number(igDmFailed24h?.c || 0),
          lastInbound: lastIgDm?.t || null,
          lastOutbound: lastIgReply?.t || null,
        },
        facebookComments: {
          status: hasPageId && hasToken && tokenValid ? "connected" : "disconnected",
          total24h: Number(fbComments24h?.c || 0),
          lastEvent: lastComment?.t || null,
          lastReply: lastCommentReply?.t || null,
        },
        instagramComments: {
          status: hasIgId && hasToken ? "connected" : "disconnected",
          total24h: Number(igComments24h?.c || 0),
          lastEvent: null,
          lastReply: null,
        },
      },
      commentStats24h: {
        total: Number(commentStats24h?.total || 0),
        replied: Number(commentStats24h?.replied || 0),
        skipped: Number(commentStats24h?.skipped || 0),
        failed: Number(commentStats24h?.failed || 0),
        rateLimited: Number(commentStats24h?.rateLimited || 0),
      },
    });
  }));

  app.get("/api/meta-ops/dm-feed/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!subAccountId) return res.status(400).json({ error: "Invalid subAccountId" });
    const channel = req.query.channel as string || "all";
    const status = req.query.status as string || "all";
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const conditions = [
      eq(messages.subAccountId, subAccountId),
      or(eq(messages.channel, "facebook"), eq(messages.channel, "instagram")),
    ];
    if (channel !== "all") conditions.push(eq(messages.channel, channel));
    if (status !== "all") conditions.push(eq(messages.status, status));

    const rows = await db.select({
      id: messages.id,
      direction: messages.direction,
      channel: messages.channel,
      body: messages.body,
      status: messages.status,
      contactPhone: messages.contactPhone,
      senderId: messages.senderId,
      traceId: messages.traceId,
      createdAt: messages.createdAt,
    }).from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ c: sql<number>`count(*)` }).from(messages)
      .where(and(...conditions));

    res.json({ messages: rows, total: Number(total?.c || 0), limit, offset });
  }));

  app.get("/api/meta-ops/comment-feed/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!subAccountId) return res.status(400).json({ error: "Invalid subAccountId" });
    const status = req.query.status as string || "all";
    const platform = req.query.platform as string || "all";
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const conditions = [eq(commentAutoReplies.subAccountId, subAccountId)];
    if (status !== "all") conditions.push(eq(commentAutoReplies.status, status as any));
    if (platform !== "all") conditions.push(eq(commentAutoReplies.platform, platform as any));

    const rows = await db.select().from(commentAutoReplies)
      .where(and(...conditions))
      .orderBy(desc(commentAutoReplies.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ c: sql<number>`count(*)` }).from(commentAutoReplies)
      .where(and(...conditions));

    const [stats] = await db.select({
      total: sql<number>`count(*)`,
      replied: sql<number>`count(*) filter (where status = 'replied')`,
      skipped: sql<number>`count(*) filter (where status = 'skipped')`,
      failed: sql<number>`count(*) filter (where status = 'failed')`,
      processing: sql<number>`count(*) filter (where status = 'processing')`,
      rateLimited: sql<number>`count(*) filter (where status = 'rate_limited')`,
    }).from(commentAutoReplies).where(eq(commentAutoReplies.subAccountId, subAccountId));

    res.json({ comments: rows, total: Number(total?.c || 0), stats: {
      total: Number(stats?.total || 0),
      replied: Number(stats?.replied || 0),
      skipped: Number(stats?.skipped || 0),
      failed: Number(stats?.failed || 0),
      processing: Number(stats?.processing || 0),
      rateLimited: Number(stats?.rateLimited || 0),
    }, limit, offset });
  }));

  app.get("/api/meta-ops/failed-events/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!subAccountId) return res.status(400).json({ error: "Invalid subAccountId" });
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const failedDms = await db.select({
      id: messages.id,
      type: sql<string>`'dm'`,
      channel: messages.channel,
      direction: messages.direction,
      body: messages.body,
      status: messages.status,
      contactPhone: messages.contactPhone,
      createdAt: messages.createdAt,
      errorMessage: sql<string>`null`,
    }).from(messages)
      .where(and(
        eq(messages.subAccountId, subAccountId),
        eq(messages.status, "failed"),
        or(eq(messages.channel, "facebook"), eq(messages.channel, "instagram"))
      ))
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    const failedComments = await db.select({
      id: commentAutoReplies.id,
      type: sql<string>`'comment'`,
      platform: commentAutoReplies.platform,
      commentText: commentAutoReplies.commentText,
      replyText: commentAutoReplies.replyText,
      status: commentAutoReplies.status,
      errorMessage: commentAutoReplies.errorMessage,
      commentId: commentAutoReplies.commentId,
      postId: commentAutoReplies.postId,
      createdAt: commentAutoReplies.createdAt,
    }).from(commentAutoReplies)
      .where(and(eq(commentAutoReplies.subAccountId, subAccountId), eq(commentAutoReplies.status, "failed")))
      .orderBy(desc(commentAutoReplies.createdAt))
      .limit(limit);

    res.json({ failedDms, failedComments });
  }));

  app.post("/api/meta-ops/retry-comment/:commentReplyId", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.commentReplyId, "commentReplyId");
    if (!id) return res.status(400).json({ error: "Invalid id" });

    const [record] = await db.select().from(commentAutoReplies).where(eq(commentAutoReplies.id, id));
    if (!record) return res.status(404).json({ error: "Comment reply not found" });
    if (record.status !== "failed") return res.status(400).json({ error: "Only failed records can be retried" });

    await db.delete(commentAutoReplies).where(eq(commentAutoReplies.id, id));

    try {
      const { handleCommentEvent } = await import("../services/commentBot/commentHandler");
      await handleCommentEvent({
        platform: record.platform as "facebook" | "instagram",
        subAccountId: record.subAccountId,
        pageId: "",
        postId: record.postId,
        commentId: record.commentId,
        commentText: record.commentText || "",
        commenterId: record.commenterId || "unknown",
        commenterName: record.commenterName || null,
      });
      res.json({ success: true, message: "Retry queued" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  app.post("/api/meta-ops/retry-dm/:messageId", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.messageId, "messageId");
    if (!id) return res.status(400).json({ error: "Invalid id" });

    const [msg] = await db.select().from(messages).where(eq(messages.id, id));
    if (!msg) return res.status(404).json({ error: "Message not found" });
    if (msg.status !== "failed" || msg.direction !== "outbound") return res.status(400).json({ error: "Only failed outbound messages can be retried" });

    try {
      const { getMetaConfig, buildMetaUrl } = await import("../metaConfig");
      const metaCfg = await getMetaConfig(msg.subAccountId);
      const endpoint = msg.channel === "instagram" ? "me" : metaCfg.pageId;
      const url = `https://graph.facebook.com/v19.0/${endpoint}/messages${metaCfg.appsecretProof ? `?appsecret_proof=${metaCfg.appsecretProof}` : ""}`;

      const sendRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: msg.senderId || msg.contactPhone },
          message: { text: msg.body },
          access_token: metaCfg.accessToken,
        }),
      });

      if (sendRes.ok) {
        await db.update(messages).set({ status: "sent" }).where(eq(messages.id, id));
        res.json({ success: true, message: "Message resent successfully" });
      } else {
        const errData = await sendRes.json() as any;
        res.status(502).json({ error: `Meta API error: ${errData?.error?.message || "Unknown"}` });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  app.get("/api/meta-ops/dm-threads/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!subAccountId) return res.status(400).json({ error: "Invalid subAccountId" });
    const channel = req.query.channel as string || "all";
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);

    const channelCondition = channel !== "all"
      ? eq(messages.channel, channel)
      : or(eq(messages.channel, "facebook"), eq(messages.channel, "instagram"));

    const threads = await db.execute(sql`
      SELECT
        m.contact_phone,
        m.channel,
        m.sender_id,
        MAX(m.created_at) as last_message_at,
        COUNT(*) as message_count,
        COUNT(*) FILTER (WHERE m.direction = 'inbound') as inbound_count,
        COUNT(*) FILTER (WHERE m.direction = 'outbound') as outbound_count,
        COUNT(*) FILTER (WHERE m.status = 'failed') as failed_count,
        (SELECT body FROM messages m2 WHERE m2.sub_account_id = m.sub_account_id AND m2.contact_phone = m.contact_phone AND m2.channel = m.channel ORDER BY m2.created_at DESC LIMIT 1) as last_message,
        (SELECT direction FROM messages m2 WHERE m2.sub_account_id = m.sub_account_id AND m2.contact_phone = m.contact_phone AND m2.channel = m.channel ORDER BY m2.created_at DESC LIMIT 1) as last_direction
      FROM messages m
      WHERE m.sub_account_id = ${subAccountId}
        AND (m.channel = 'facebook' OR m.channel = 'instagram')
        ${channel !== "all" ? sql`AND m.channel = ${channel}` : sql``}
      GROUP BY m.contact_phone, m.channel, m.sender_id
      ORDER BY MAX(m.created_at) DESC
      LIMIT ${limit}
    `);

    res.json({ threads: threads.rows });
  }));

  app.post("/api/meta-ops/config/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!subAccountId) return res.status(400).json({ error: "Invalid subAccountId" });

    const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
    if (!account) return res.status(404).json({ error: "Account not found" });

    const currentConfig = (account.config as any) || {};
    const body = req.body;

    if (body.commentBot !== undefined) {
      currentConfig.commentBot = { ...currentConfig.commentBot, ...body.commentBot };
    }

    await db.update(subAccounts).set({ config: currentConfig }).where(eq(subAccounts.id, subAccountId));
    res.json({ success: true, config: currentConfig });
  }));

  app.post("/api/meta-ops/toggle-auto-reply/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!subAccountId) return res.status(400).json({ error: "Invalid subAccountId" });

    const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
    if (!account) return res.status(404).json({ error: "Account not found" });

    const aiCfg = (account.aiPromptConfig as any) || {};
    const newState = !(aiCfg.autoReplyEnabled !== false);
    aiCfg.autoReplyEnabled = newState;
    await db.update(subAccounts).set({ aiPromptConfig: aiCfg }).where(eq(subAccounts.id, subAccountId));
    res.json({ autoReplyEnabled: newState });
  }));

  app.get("/api/meta-ops/permissions/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!subAccountId) return res.status(400).json({ error: "Invalid subAccountId" });

    const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
    if (!account) return res.status(404).json({ error: "Account not found" });

    const token = account.metaAccessToken;
    const pageId = account.metaPageId;

    if (!token || !pageId) {
      return res.json({ configured: false, permissions: [], subscriptions: [], igAccount: null });
    }

    let permissions: any[] = [];
    let subscriptions: any[] = [];
    let igAccount: any = null;
    let tokenDebug: any = null;

    try {
      const permRes = await fetch(`https://graph.facebook.com/v19.0/me/permissions?access_token=${token}`);
      const permData = await permRes.json() as any;
      permissions = (permData.data || []).map((p: any) => ({ name: p.permission, status: p.status }));
    } catch {}

    try {
      const subRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/subscribed_apps?access_token=${token}`);
      const subData = await subRes.json() as any;
      subscriptions = (subData.data || []).map((s: any) => ({ name: s.name, fields: s.subscribed_fields }));
    } catch {}

    try {
      const igRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account{id,username,name}&access_token=${token}`);
      const igData = await igRes.json() as any;
      igAccount = igData.instagram_business_account || null;
    } catch {}

    try {
      const debugRes = await fetch(`https://graph.facebook.com/v19.0/debug_token?input_token=${token}&access_token=${token}`);
      const debugData = await debugRes.json() as any;
      tokenDebug = debugData.data || null;
    } catch {}

    res.json({
      configured: true,
      permissions,
      subscriptions,
      igAccount,
      tokenDebug: tokenDebug ? {
        isValid: tokenDebug.is_valid,
        expiresAt: tokenDebug.expires_at ? new Date(tokenDebug.expires_at * 1000).toISOString() : "never",
        scopes: tokenDebug.scopes,
        type: tokenDebug.type,
      } : null,
    });
  }));

  app.post("/api/meta-ops/backfill/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!subAccountId) return res.status(400).json({ error: "Invalid subAccountId" });
    const dryRun = req.body.dryRun === true;
    const maxPosts = parseInt(req.body.maxPosts) || 5;

    const { backfillComments } = await import("../services/commentBot/commentBackfill");
    const result = await backfillComments({ subAccountId, maxPosts, dryRun });
    res.json(result);
  }));

  app.get("/api/meta-ops/dm-analytics/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!subAccountId) return res.status(400).json({ error: "Invalid subAccountId" });

    const d7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const dailyStats = await db.execute(sql`
      SELECT
        DATE(created_at) as day,
        channel,
        direction,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_count
      FROM messages
      WHERE sub_account_id = ${subAccountId}
        AND (channel = 'facebook' OR channel = 'instagram')
        AND created_at >= ${d7}
      GROUP BY DATE(created_at), channel, direction
      ORDER BY day DESC
    `);

    const responseTimeStats = await db.execute(sql`
      SELECT
        channel,
        AVG(response_time_ms) as avg_response_ms,
        MIN(response_time_ms) as min_response_ms,
        MAX(response_time_ms) as max_response_ms
      FROM (
        SELECT
          m_in.channel,
          EXTRACT(EPOCH FROM (m_out.created_at - m_in.created_at)) * 1000 as response_time_ms
        FROM messages m_in
        JOIN messages m_out ON
          m_out.sub_account_id = m_in.sub_account_id
          AND m_out.contact_phone = m_in.contact_phone
          AND m_out.channel = m_in.channel
          AND m_out.direction = 'outbound'
          AND m_out.created_at > m_in.created_at
          AND m_out.created_at < m_in.created_at + interval '10 minutes'
          AND m_out.status = 'sent'
        WHERE m_in.sub_account_id = ${subAccountId}
          AND m_in.direction = 'inbound'
          AND (m_in.channel = 'facebook' OR m_in.channel = 'instagram')
          AND m_in.created_at >= ${d7}
      ) t
      GROUP BY channel
    `);

    res.json({ dailyStats: dailyStats.rows, responseTimeStats: responseTimeStats.rows });
  }));
}
