import type { Express, Request, Response } from "express";
import { asyncHandler, parseIntParam, verifyAccountOwnership } from "./helpers";
import { emitUniversalEvent, EVENT_TYPES } from "../intelligence/eventEmitter";
import { db } from "../db";
import { messages, commentAutoReplies, subAccounts, auditLogs, systemLogs, contacts } from "@shared/schema";
import { eq, and, gte, desc, sql, or, asc } from "drizzle-orm";

const SAFETY_KEYWORDS = [
  { pattern: /\b(lawsuit|attorney|lawyer|sue|legal action|court)\b/i, flag: "litigation_risk", severity: "high" },
  { pattern: /\b(kill|threat|bomb|weapon|shoot)\b/i, flag: "threat_detected", severity: "critical" },
  { pattern: /\b(ssn|social security|credit card|bank account|routing number)\b/i, flag: "personal_data", severity: "high" },
  { pattern: /\b(fuck|shit|bitch|asshole|damn|hell)\b/i, flag: "profanity", severity: "medium" },
  { pattern: /\b(scam|fraud|fake|rip.?off|ponzi)\b/i, flag: "scam_accusation", severity: "medium" },
  { pattern: /\b(suicide|self.?harm|hurt myself)\b/i, flag: "crisis_flag", severity: "critical" },
];

function detectSafetyFlags(text: string): Array<{ flag: string; severity: string }> {
  if (!text) return [];
  const flags: Array<{ flag: string; severity: string }> = [];
  for (const { pattern, flag, severity } of SAFETY_KEYWORDS) {
    if (pattern.test(text)) flags.push({ flag, severity });
  }
  return flags;
}

function sanitizeError(err: any): string {
  if (!err) return "An unexpected error occurred";
  const msg = err.message || String(err);
  if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT")) return "Service temporarily unavailable. Please try again.";
  if (msg.includes("access_token")) return "Authentication error. Please reconnect your Meta account.";
  if (msg.includes("rate limit") || msg.includes("too many")) return "Rate limit reached. Please wait a moment.";
  return msg.replace(/at\s+.*\n/g, "").substring(0, 200);
}

async function logAudit(action: string, performedBy: string, details: any) {
  try {
    await db.insert(auditLogs).values({ action, performedBy, details });
  } catch {}
}

async function logSystem(severity: string, module: string, message: string, metadata?: any) {
  try {
    await db.insert(systemLogs).values({ severity, module, message, metadata });
  } catch {}
}

function generateDemoData() {
  const channels = ["facebook", "instagram"] as const;
  const statuses = ["sent", "delivered", "read", "failed"] as const;
  const names = ["Sarah Chen", "Marcus Rivera", "Priya Patel", "James Thompson", "Aisha Mohammed", "Luca Ferrari", "Maya Johnson", "David Kim", "Elena Volkov", "Omar Hassan"];
  const inboundMessages = [
    "Hey! I saw your post about the coaching program. Can you tell me more?",
    "What are your prices for the premium package?",
    "I'm interested in booking a consultation. When are you available?",
    "Love your content! Do you offer group sessions?",
    "Hi there, I was referred by a friend. She said you're amazing!",
    "Quick question — do you work with small businesses?",
    "I've been following you for a while. Ready to take the next step!",
    "Can I get a discount if I sign up today?",
    "Do you have any testimonials I can look at?",
    "What's the best way to get started with your services?",
  ];
  const aiReplies = [
    "Hey love! So glad you reached out 💕 Yes, the coaching program is life-changing. Let me send you the details...",
    "Hi there! Our premium package starts at $497/mo and includes weekly 1-on-1 sessions. Want me to break it down for you?",
    "Hey! I'd love to chat with you. I have openings next Tuesday and Thursday. Which works better?",
    "Thank you so much! Yes, I run exclusive group sessions monthly. The next one is filling up fast!",
    "Aww that means the world! Your friend has great taste 😊 Let's find the perfect fit for you.",
    "Absolutely! Small businesses are my specialty. Let's hop on a quick call to see how I can help.",
    "YES! I love hearing that. Let's make it happen. Drop your number and I'll send you the enrollment link.",
    "I appreciate you asking! While I don't do discounts, I do have a payment plan that makes it super accessible.",
    "Of course! I'll DM you a link to our client success stories. The results speak for themselves!",
    "Great question! The fastest way is to book a free discovery call. Here's my calendar link...",
  ];
  const commentTexts = [
    "This is incredible content! 🔥", "How do I sign up?", "Tag your bestie who needs this!",
    "Is this available in my area?", "Wow, game changer!", "Just shared this with my team",
    "Can you do a live Q&A?", "Best advice I've seen today", "More of this please! 🙌", "DM sent!",
  ];

  const now = Date.now();
  const conversations: any[] = [];
  for (let i = 0; i < 10; i++) {
    const channel = channels[i % 2];
    const name = names[i];
    const senderId = `demo_${100000 + i}`;
    const msgs = [];
    const baseTime = now - (10 - i) * 3600000;
    msgs.push({
      id: 90000 + i * 3,
      direction: "inbound",
      channel,
      body: inboundMessages[i],
      status: "received",
      contactPhone: senderId,
      senderId,
      createdAt: new Date(baseTime).toISOString(),
      safetyFlags: detectSafetyFlags(inboundMessages[i]),
    });
    msgs.push({
      id: 90000 + i * 3 + 1,
      direction: "outbound",
      channel,
      body: aiReplies[i],
      status: i === 7 ? "pending_approval" : statuses[i % 3],
      contactPhone: senderId,
      senderId,
      createdAt: new Date(baseTime + 45000).toISOString(),
      aiGenerated: true,
      safetyFlags: detectSafetyFlags(aiReplies[i]),
    });
    conversations.push({
      senderId,
      name,
      channel,
      messages: msgs,
      lastMessageAt: new Date(baseTime + 45000).toISOString(),
      unread: i < 3,
      priority: i === 0 ? "high" : i < 4 ? "medium" : "normal",
      safetyFlags: [...detectSafetyFlags(inboundMessages[i]), ...detectSafetyFlags(aiReplies[i])],
    });
  }

  const demoComments: any[] = [];
  for (let i = 0; i < 10; i++) {
    demoComments.push({
      id: 80000 + i,
      platform: channels[i % 2],
      postId: `demo_post_${1000 + Math.floor(i / 3)}`,
      commentId: `demo_comment_${5000 + i}`,
      commentText: commentTexts[i],
      commenterName: names[i],
      commenterId: `demo_commenter_${i}`,
      replyText: i < 7 ? `Thanks so much! ${i < 3 ? "DM us for details 💌" : "We appreciate you! 🙏"}` : null,
      status: i < 7 ? "replied" : i === 7 ? "pending_approval" : i === 8 ? "skipped" : "failed",
      createdAt: new Date(now - (10 - i) * 1800000).toISOString(),
      repliedAt: i < 7 ? new Date(now - (10 - i) * 1800000 + 30000).toISOString() : null,
      safetyFlags: detectSafetyFlags(commentTexts[i]),
    });
  }

  return {
    conversations,
    comments: demoComments,
    stats: {
      inbound24h: 47,
      outbound24h: 39,
      avgResponseTimeSec: 52,
      failedCount: 2,
      botActive: true,
      slaMetPct: 94,
      trend7d: [12, 18, 15, 22, 19, 31, 47],
      commentStats: { total: 156, replied: 112, skipped: 31, failed: 8, pending: 5 },
    },
    analytics: {
      dailyVolume: Array.from({ length: 7 }, (_, i) => ({
        date: new Date(now - (6 - i) * 86400000).toISOString().split("T")[0],
        inbound: 10 + Math.floor(Math.random() * 25),
        outbound: 8 + Math.floor(Math.random() * 20),
        comments: 15 + Math.floor(Math.random() * 30),
      })),
      channelBreakdown: { facebookDm: 42, instagramDm: 35, facebookComments: 48, instagramComments: 31 },
      topPosts: [
        { postId: "demo_post_1001", platform: "facebook", comments: 34, replies: 28, engagement: 4.2 },
        { postId: "demo_post_1002", platform: "instagram", comments: 29, replies: 22, engagement: 5.1 },
        { postId: "demo_post_1000", platform: "facebook", comments: 21, replies: 18, engagement: 3.8 },
      ],
      responseTimeDistribution: { under30s: 12, under1m: 18, under5m: 8, over5m: 3 },
    },
    usage: {
      messagesUsed: 847,
      messagesLimit: 2000,
      commentsProcessed: 312,
      commentsLimit: 1000,
      periodStart: new Date(now - 30 * 86400000).toISOString(),
      periodEnd: new Date(now).toISOString(),
      invoices: [
        { id: "inv_demo_001", amount: 49.00, status: "paid", date: new Date(now - 30 * 86400000).toISOString() },
        { id: "inv_demo_002", amount: 49.00, status: "paid", date: new Date(now - 60 * 86400000).toISOString() },
      ],
    },
  };
}

export function registerMetaMessagingRoutes(app: Express) {

  app.get("/api/meta-messaging/dashboard/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const now = new Date();
    const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
    if (!account) return res.status(404).json({ error: "Account not found" });

    const aiCfg = (account.aiPromptConfig as any) || {};

    const [inbound24h] = await db.select({ c: sql<number>`count(*)` }).from(messages)
      .where(and(eq(messages.subAccountId, subAccountId), eq(messages.direction, "inbound"),
        or(eq(messages.channel, "facebook"), eq(messages.channel, "instagram")), gte(messages.createdAt, h24)));
    const [outbound24h] = await db.select({ c: sql<number>`count(*)` }).from(messages)
      .where(and(eq(messages.subAccountId, subAccountId), eq(messages.direction, "outbound"),
        or(eq(messages.channel, "facebook"), eq(messages.channel, "instagram")), gte(messages.createdAt, h24)));
    const [failed24h] = await db.select({ c: sql<number>`count(*)` }).from(messages)
      .where(and(eq(messages.subAccountId, subAccountId), eq(messages.status, "failed"),
        or(eq(messages.channel, "facebook"), eq(messages.channel, "instagram")), gte(messages.createdAt, h24)));

    const [commentReplied] = await db.select({ c: sql<number>`count(*)` }).from(commentAutoReplies)
      .where(and(eq(commentAutoReplies.subAccountId, subAccountId), eq(commentAutoReplies.status, "replied"), gte(commentAutoReplies.createdAt, h24)));

    const trend7d = await db.execute(sql`
      SELECT DATE(created_at) as day, COUNT(*) as count
      FROM messages WHERE sub_account_id = ${subAccountId}
        AND direction = 'inbound' AND (channel = 'facebook' OR channel = 'instagram')
        AND created_at >= ${d7}
      GROUP BY DATE(created_at) ORDER BY day ASC
    `);

    const connected = !!(account.metaPageId && account.metaAccessToken);

    res.json({
      accountName: account.name,
      connected,
      botActive: aiCfg.autoReplyEnabled !== false,
      hasPersona: !!(aiCfg.systemPrompt && aiCfg.systemPrompt.length > 200),
      kpi: {
        inbound24h: Number(inbound24h?.c || 0),
        outbound24h: Number(outbound24h?.c || 0),
        failed24h: Number(failed24h?.c || 0),
        commentsReplied24h: Number(commentReplied?.c || 0),
      },
      trend7d: (trend7d.rows || []).map((r: any) => ({ date: r.day, count: Number(r.count) })),
    });
  }));

  app.get("/api/meta-messaging/inbox/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const channel = req.query.channel as string || "all";
    const priority = req.query.priority as string || "all";
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const channelCond = channel !== "all"
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
        (SELECT direction FROM messages m2 WHERE m2.sub_account_id = m.sub_account_id AND m2.contact_phone = m.contact_phone AND m2.channel = m.channel ORDER BY m2.created_at DESC LIMIT 1) as last_direction,
        (SELECT status FROM messages m2 WHERE m2.sub_account_id = m.sub_account_id AND m2.contact_phone = m.contact_phone AND m2.channel = m.channel ORDER BY m2.created_at DESC LIMIT 1) as last_status
      FROM messages m
      WHERE m.sub_account_id = ${subAccountId}
        AND (m.channel = 'facebook' OR m.channel = 'instagram')
        ${channel !== "all" ? sql`AND m.channel = ${channel}` : sql``}
      GROUP BY m.contact_phone, m.channel, m.sender_id
      ORDER BY MAX(m.created_at) DESC
      LIMIT ${limit}
    `);

    const enriched = (threads.rows || []).map((t: any) => {
      const safetyFlags = detectSafetyFlags(t.last_message || "");
      const hasFailed = Number(t.failed_count) > 0;
      return {
        ...t,
        message_count: Number(t.message_count),
        inbound_count: Number(t.inbound_count),
        outbound_count: Number(t.outbound_count),
        failed_count: Number(t.failed_count),
        safetyFlags,
        priority: safetyFlags.some(f => f.severity === "critical") ? "critical" : hasFailed ? "high" : safetyFlags.length > 0 ? "medium" : "normal",
      };
    });

    if (priority !== "all") {
      const filtered = enriched.filter((t: any) => t.priority === priority);
      return res.json({ threads: filtered });
    }

    res.json({ threads: enriched });
  }));

  app.get("/api/meta-messaging/thread/:subAccountId/:senderId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const senderId = req.params.senderId;
    const channel = req.query.channel as string || "facebook";

    const threadMessages = await db.select({
      id: messages.id,
      direction: messages.direction,
      channel: messages.channel,
      body: messages.body,
      status: messages.status,
      createdAt: messages.createdAt,
    }).from(messages)
      .where(and(
        eq(messages.subAccountId, subAccountId),
        eq(messages.contactPhone, senderId),
        eq(messages.channel, channel),
      ))
      .orderBy(asc(messages.createdAt))
      .limit(100);

    const contact = await db.select().from(contacts)
      .where(and(eq(contacts.subAccountId, subAccountId), eq(contacts.phone, senderId)))
      .limit(1);

    const enriched = threadMessages.map(m => ({
      ...m,
      aiGenerated: m.direction === "outbound",
      safetyFlags: detectSafetyFlags(m.body || ""),
    }));

    res.json({
      messages: enriched,
      contact: contact[0] ? {
        name: [contact[0].firstName, contact[0].lastName].filter(Boolean).join(" ") || senderId,
        tags: contact[0].tags || [],
        source: contact[0].source,
      } : { name: senderId, tags: [], source: "unknown" },
    });
  }));

  app.post("/api/meta-messaging/approve/:subAccountId/:messageId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const messageId = parseIntParam(req.params.messageId, "messageId");
    const editedText = req.body.editedText as string | undefined;
    const userId = (req as any).user?.id || "system";

    const [msg] = await db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.subAccountId, subAccountId)));
    if (!msg) return res.status(404).json({ error: "Message not found" });
    if (msg.direction !== "outbound") return res.status(400).json({ error: "Can only approve outbound messages" });

    const textToSend = editedText || msg.body;
    if (!textToSend) return res.status(400).json({ error: "No message text" });

    const safetyFlags = detectSafetyFlags(textToSend);
    if (safetyFlags.some(f => f.severity === "critical")) {
      await logAudit("meta_messaging.approve_blocked", userId, { messageId, reason: "critical_safety_flag", flags: safetyFlags });
      return res.status(400).json({ error: "Message contains critical safety flags and cannot be sent", safetyFlags });
    }

    try {
      const { getMetaConfig } = await import("../metaConfig");
      const cfg = await getMetaConfig(subAccountId);
      const endpoint = msg.channel === "instagram" ? "me" : cfg.pageId;
      const url = `https://graph.facebook.com/v21.0/${endpoint}/messages${cfg.appsecretProof ? `?appsecret_proof=${cfg.appsecretProof}` : ""}`;

      const sendRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: msg.senderId || msg.contactPhone },
          message: { text: textToSend },
          access_token: cfg.accessToken,
        }),
      });

      if (!sendRes.ok) {
        const errData = await sendRes.json() as any;
        await logAudit("meta_messaging.approve_failed", userId, { messageId, error: errData?.error?.message });
        return res.status(502).json({ error: sanitizeError({ message: errData?.error?.message || "Send failed" }) });
      }

      await db.update(messages).set({ status: "sent", body: textToSend }).where(eq(messages.id, messageId));
      await logAudit("meta_messaging.approve_sent", userId, { messageId, edited: !!editedText, channel: msg.channel });
      await logSystem("info", "meta-messaging", `Message ${messageId} approved and sent by ${userId}`, { messageId, channel: msg.channel });
      emitUniversalEvent({ eventType: EVENT_TYPES.INBOX_MESSAGE_SENT, sourceModule: "inbox", sourceTable: "messages", sourceRecordId: String(messageId), subAccountId, metadata: { channel: msg.channel, approved: true, edited: !!editedText, approvedBy: userId } });
      res.json({ success: true, message: "Message sent successfully" });
    } catch (err: any) {
      await logAudit("meta_messaging.approve_error", userId, { messageId, error: err.message });
      res.status(500).json({ error: sanitizeError(err) });
    }
  }));

  app.post("/api/meta-messaging/send-reply/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { senderId, channel, text } = req.body;
    const userId = (req as any).user?.id || "system";

    if (!senderId || !channel || !text) return res.status(400).json({ error: "senderId, channel, and text are required" });

    const safetyFlags = detectSafetyFlags(text);
    if (safetyFlags.some(f => f.severity === "critical")) {
      return res.status(400).json({ error: "Message blocked by safety filter", safetyFlags });
    }

    try {
      const { getMetaConfig } = await import("../metaConfig");
      const cfg = await getMetaConfig(subAccountId);
      const endpoint = channel === "instagram" ? "me" : cfg.pageId;
      const url = `https://graph.facebook.com/v21.0/${endpoint}/messages${cfg.appsecretProof ? `?appsecret_proof=${cfg.appsecretProof}` : ""}`;

      const sendRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: senderId },
          message: { text },
          access_token: cfg.accessToken,
        }),
      });

      const sendData = await sendRes.json() as any;
      const status = sendRes.ok ? "sent" : "failed";
      const errorMessage = sendRes.ok ? undefined : `meta_api_${sendRes.status}: ${(sendData?.error?.message || JSON.stringify(sendData)).toString().substring(0, 500)}`;

      await db.insert(messages).values({
        subAccountId, channel, direction: "outbound", contactPhone: senderId,
        body: text, status, senderId,
        messageSid: sendData?.message_id,
        errorMessage,
      });

      await logAudit("meta_messaging.manual_reply", userId, { senderId, channel, status, length: text.length });

      if (!sendRes.ok) return res.status(502).json({ error: sanitizeError({ message: sendData?.error?.message }) });
      emitUniversalEvent({ eventType: EVENT_TYPES.INBOX_MESSAGE_SENT, sourceModule: "inbox", subAccountId, metadata: { senderId, channel, messageId: sendData?.message_id } });
      res.json({ success: true, messageId: sendData?.message_id });
    } catch (err: any) {
      res.status(500).json({ error: sanitizeError(err) });
    }
  }));

  app.get("/api/meta-messaging/moderation/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const pendingComments = await db.select().from(commentAutoReplies)
      .where(and(eq(commentAutoReplies.subAccountId, subAccountId), eq(commentAutoReplies.status, "processing")))
      .orderBy(desc(commentAutoReplies.createdAt)).limit(50);

    const recentReplied = await db.select().from(commentAutoReplies)
      .where(and(eq(commentAutoReplies.subAccountId, subAccountId), eq(commentAutoReplies.status, "replied")))
      .orderBy(desc(commentAutoReplies.repliedAt)).limit(20);

    const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
    const commentConfig = (account?.config as any)?.commentBot || {};

    res.json({
      pendingQueue: pendingComments.map(c => ({
        ...c,
        safetyFlags: detectSafetyFlags(c.commentText || ""),
        replySafetyFlags: detectSafetyFlags(c.replyText || ""),
      })),
      recentReplied: recentReplied.map(c => ({
        ...c,
        safetyFlags: detectSafetyFlags(c.replyText || ""),
      })),
      config: {
        autoApprove: commentConfig.autoApprove !== false,
        tonePreset: commentConfig.tonePreset || "friendly",
        blacklistWords: commentConfig.blacklistWords || [],
        vipUsers: commentConfig.vipUsers || [],
        maxRepliesPerHour: commentConfig.maxRepliesPerHour || 30,
      },
    });
  }));

  app.post("/api/meta-messaging/moderation-config/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const userId = (req as any).user?.id || "system";

    const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
    if (!account) return res.status(404).json({ error: "Account not found" });

    const currentConfig = (account.config as any) || {};
    const commentBot = currentConfig.commentBot || {};
    const body = req.body;

    if (body.autoApprove !== undefined) commentBot.autoApprove = body.autoApprove;
    if (body.tonePreset) commentBot.tonePreset = body.tonePreset;
    if (body.blacklistWords) commentBot.blacklistWords = body.blacklistWords;
    if (body.vipUsers) commentBot.vipUsers = body.vipUsers;
    if (body.maxRepliesPerHour) commentBot.maxRepliesPerHour = body.maxRepliesPerHour;

    currentConfig.commentBot = commentBot;
    await db.update(subAccounts).set({ config: currentConfig }).where(eq(subAccounts.id, subAccountId));
    await logAudit("meta_messaging.config_updated", userId, { subAccountId, changes: body });
    emitUniversalEvent({ eventType: "moderation_config_updated", sourceModule: "inbox", sourceTable: "sub_accounts", sourceRecordId: String(subAccountId), subAccountId, metadata: { updatedFields: Object.keys(body), autoApprove: commentBot.autoApprove, tonePreset: commentBot.tonePreset } });

    res.json({ success: true, config: commentBot });
  }));

  app.get("/api/meta-messaging/safety/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const h24 = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentInbound = await db.select({
      id: messages.id,
      body: messages.body,
      channel: messages.channel,
      contactPhone: messages.contactPhone,
      createdAt: messages.createdAt,
    }).from(messages)
      .where(and(
        eq(messages.subAccountId, subAccountId),
        eq(messages.direction, "inbound"),
        or(eq(messages.channel, "facebook"), eq(messages.channel, "instagram")),
        gte(messages.createdAt, h24),
      ))
      .orderBy(desc(messages.createdAt)).limit(200);

    const flaggedMessages = recentInbound
      .map(m => ({ ...m, safetyFlags: detectSafetyFlags(m.body || "") }))
      .filter(m => m.safetyFlags.length > 0);

    const flaggedComments = await db.select().from(commentAutoReplies)
      .where(and(eq(commentAutoReplies.subAccountId, subAccountId), gte(commentAutoReplies.createdAt, h24)))
      .orderBy(desc(commentAutoReplies.createdAt)).limit(200);

    const flaggedCommentItems = flaggedComments
      .map(c => ({ ...c, safetyFlags: detectSafetyFlags(c.commentText || "") }))
      .filter(c => c.safetyFlags.length > 0);

    const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
    const strictness = (account?.config as any)?.safetyStrictness || "medium";

    res.json({
      flaggedMessages,
      flaggedComments: flaggedCommentItems,
      totalFlagged: flaggedMessages.length + flaggedCommentItems.length,
      strictness,
      severityCounts: {
        critical: flaggedMessages.filter(m => m.safetyFlags.some(f => f.severity === "critical")).length +
                  flaggedCommentItems.filter(c => c.safetyFlags.some((f: any) => f.severity === "critical")).length,
        high: flaggedMessages.filter(m => m.safetyFlags.some(f => f.severity === "high")).length +
              flaggedCommentItems.filter(c => c.safetyFlags.some((f: any) => f.severity === "high")).length,
        medium: flaggedMessages.filter(m => m.safetyFlags.some(f => f.severity === "medium")).length +
                flaggedCommentItems.filter(c => c.safetyFlags.some((f: any) => f.severity === "medium")).length,
      },
    });
  }));

  app.get("/api/meta-messaging/analytics/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const days = Math.min(parseInt(req.query.days as string) || 7, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const dailyVolume = await db.execute(sql`
      SELECT DATE(created_at) as date, channel, direction,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_count
      FROM messages
      WHERE sub_account_id = ${subAccountId}
        AND (channel = 'facebook' OR channel = 'instagram')
        AND created_at >= ${since}
      GROUP BY DATE(created_at), channel, direction
      ORDER BY date ASC
    `);

    const commentVolume = await db.execute(sql`
      SELECT DATE(created_at) as date, platform, status, COUNT(*) as count
      FROM comment_auto_replies
      WHERE sub_account_id = ${subAccountId} AND created_at >= ${since}
      GROUP BY DATE(created_at), platform, status ORDER BY date ASC
    `);

    const channelBreakdown = await db.execute(sql`
      SELECT channel, COUNT(*) as total,
        COUNT(*) FILTER (WHERE direction = 'inbound') as inbound,
        COUNT(*) FILTER (WHERE direction = 'outbound') as outbound
      FROM messages
      WHERE sub_account_id = ${subAccountId}
        AND (channel = 'facebook' OR channel = 'instagram')
        AND created_at >= ${since}
      GROUP BY channel
    `);

    res.json({
      dailyVolume: dailyVolume.rows,
      commentVolume: commentVolume.rows,
      channelBreakdown: channelBreakdown.rows,
      period: { days, since: since.toISOString() },
    });
  }));

  app.get("/api/meta-messaging/usage/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [dmCount] = await db.select({ c: sql<number>`count(*)` }).from(messages)
      .where(and(eq(messages.subAccountId, subAccountId), eq(messages.direction, "outbound"),
        or(eq(messages.channel, "facebook"), eq(messages.channel, "instagram")),
        gte(messages.createdAt, monthStart)));

    const [commentCount] = await db.select({ c: sql<number>`count(*)` }).from(commentAutoReplies)
      .where(and(eq(commentAutoReplies.subAccountId, subAccountId), eq(commentAutoReplies.status, "replied"),
        gte(commentAutoReplies.createdAt, monthStart)));

    const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
    const plan = account?.plan || "starter";
    const limits: Record<string, { messages: number; comments: number }> = {
      starter: { messages: 500, comments: 200 },
      pro: { messages: 2000, comments: 1000 },
      enterprise: { messages: 10000, comments: 5000 },
    };
    const planLimits = limits[plan] || limits.starter;

    res.json({
      plan,
      period: { start: monthStart.toISOString(), end: new Date().toISOString() },
      usage: {
        messagesUsed: Number(dmCount?.c || 0),
        messagesLimit: planLimits.messages,
        commentsProcessed: Number(commentCount?.c || 0),
        commentsLimit: planLimits.comments,
      },
    });
  }));

  app.get("/api/meta-messaging/connect-status/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
    if (!account) return res.status(404).json({ error: "Account not found" });

    const steps = {
      metaConnected: !!(account.metaPageId && account.metaAccessToken),
      pageSelected: !!account.metaPageId,
      igConnected: !!(account as any).metaInstagramAccountId,
      tokenValid: false,
      webhookActive: false,
      pageName: "",
    };

    if (steps.metaConnected) {
      try {
        const { validateMetaConfigForAccount } = await import("../metaConfig");
        const v = await validateMetaConfigForAccount(subAccountId);
        steps.tokenValid = v.valid;
        steps.pageName = v.pageName || "";
      } catch {}

      try {
        const token = account.metaAccessToken;
        const subRes = await fetch(`https://graph.facebook.com/v21.0/${account.metaPageId}/subscribed_apps?access_token=${token}`);
        const subData = await subRes.json() as any;
        steps.webhookActive = (subData.data || []).length > 0;
      } catch {}
    }

    const completionPct = [steps.metaConnected, steps.pageSelected, steps.igConnected, steps.tokenValid, steps.webhookActive]
      .filter(Boolean).length * 20;

    res.json({ steps, completionPct, accountName: account.name });
  }));

  app.get("/api/meta-messaging/demo-data", asyncHandler(async (_req, res) => {
    res.json(generateDemoData());
  }));

  app.post("/api/meta-messaging/toggle-bot/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const userId = (req as any).user?.id || "system";

    const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
    if (!account) return res.status(404).json({ error: "Account not found" });

    const aiCfg = (account.aiPromptConfig as any) || {};
    const newState = !(aiCfg.autoReplyEnabled !== false);
    aiCfg.autoReplyEnabled = newState;
    await db.update(subAccounts).set({ aiPromptConfig: aiCfg }).where(eq(subAccounts.id, subAccountId));
    await logAudit("meta_messaging.bot_toggled", userId, { subAccountId, enabled: newState });

    res.json({ botActive: newState });
  }));
}
