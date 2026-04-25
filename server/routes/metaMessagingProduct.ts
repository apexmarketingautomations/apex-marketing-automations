import type { Express, Request, Response, NextFunction } from "express";
import { asyncHandler, parseIntParam, verifyAccountOwnership } from "./helpers";
import { emitUniversalEvent, EVENT_TYPES } from "../intelligence/eventEmitter";
import { ensureNotProtectedAccount as ensureNotProtectedAccountMiddleware, isProtectedAccountId } from "../middleware/protectedAccount";
import { requireFeatureFlag } from "../middleware/featureGate";
import { db } from "../db";
import {
  subAccounts, messages, systemLogs, auditLogs, oauthTokens,
  webhooks, webhookDeliveryLogs, workflows, whiteLabelSettings,
  commentAutoReplies, usageLogs,
  metaMessagingBillingEvents, metaMessagingAnalyticsAggregates,
} from "@shared/schema";
import { eq, and, gte, desc, sql, or, asc, lt } from "drizzle-orm";
import crypto from "crypto";
import { randomUUID } from "crypto";

const META_MESSAGING_FLAG = "meta_messaging_2027";

const SAFETY_KEYWORDS = [
  { pattern: /\b(lawsuit|attorney|lawyer|sue|legal action|court)\b/i, flag: "litigation_risk", severity: "high" as const },
  { pattern: /\b(kill|threat|bomb|weapon|shoot)\b/i, flag: "threat_detected", severity: "critical" as const },
  { pattern: /\b(ssn|social security|credit card|bank account|routing number)\b/i, flag: "personal_data", severity: "high" as const },
  { pattern: /\b(fuck|shit|bitch|asshole|damn|hell)\b/i, flag: "profanity", severity: "medium" as const },
  { pattern: /\b(scam|fraud|fake|rip.?off|ponzi)\b/i, flag: "scam_accusation", severity: "medium" as const },
  { pattern: /\b(suicide|self.?harm|hurt myself)\b/i, flag: "crisis_flag", severity: "critical" as const },
];

export function detectSafetyFlags(text: string): Array<{ flag: string; severity: string; confidence: number }> {
  if (!text) return [];
  const flags: Array<{ flag: string; severity: string; confidence: number }> = [];
  for (const { pattern, flag, severity } of SAFETY_KEYWORDS) {
    if (pattern.test(text)) {
      const confidence = severity === "critical" ? 0.95 : severity === "high" ? 0.85 : 0.7;
      flags.push({ flag, severity, confidence });
    }
  }
  return flags;
}

const BILLING_RATES = {
  perMessage: { facebook: 0.005, instagram: 0.005 },
  perToken: 0.00002,
};

export function calculateBillingCost(channel: string, messageCount: number, tokenCount: number): {
  unitCostMessage: number; unitCostToken: number; totalCost: number;
} {
  const msgRate = BILLING_RATES.perMessage[channel as keyof typeof BILLING_RATES.perMessage] || 0.005;
  const unitCostMessage = msgRate;
  const unitCostToken = BILLING_RATES.perToken;
  const totalCost = (messageCount * msgRate) + (tokenCount * BILLING_RATES.perToken);
  return { unitCostMessage, unitCostToken, totalCost: Math.round(totalCost * 100000) / 100000 };
}

async function logAudit(action: string, performedBy: string, details: any) {
  try {
    await db.insert(auditLogs).values({ action, performedBy, details });
  } catch (err) { console.warn("[METAMESSAGINGPRODUCT] caught:", err instanceof Error ? err.message : err); }
}

async function logSystem(severity: string, module: string, message: string, metadata?: any) {
  try {
    await db.insert(systemLogs).values({ severity, module, message, metadata });
  } catch (err) { console.warn("[METAMESSAGINGPRODUCT] caught:", err instanceof Error ? err.message : err); }
}

function traceIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const traceId = (req.headers["x-trace-id"] as string) || randomUUID();
  (req as any).traceId = traceId;
  res.setHeader("x-trace-id", traceId);
  next();
}

async function logSystemWithTrace(severity: string, module: string, message: string, req: Request, extra?: any) {
  const traceId = (req as any).traceId || randomUUID();
  const userId = (req as any).user?.claims?.sub || (req as any).user?.id || "anonymous";
  const subAccountId = parseInt(req.params.subAccountId, 10) || undefined;
  try {
    await db.insert(systemLogs).values({
      severity,
      module,
      message,
      metadata: { traceId, userId, subAccountId, ...extra },
    });
  } catch (err) { console.warn("[METAMESSAGINGPRODUCT] caught:", err instanceof Error ? err.message : err); }
}

function redactPII(text: string): string {
  return text
    .replace(/\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g, "[SSN_REDACTED]")
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "[CC_REDACTED]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, "[EMAIL_REDACTED]")
    .replace(/\b\d{10,11}\b/g, "[PHONE_REDACTED]");
}

const oauthStateStore = new Map<string, { subAccountId: number; userId: string; timestamp: number }>();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const idempotencyStore = new Map<string, { response: any; timestamp: number }>();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function cleanStores() {
  const now = Date.now();
  for (const [key, val] of idempotencyStore) {
    if (now - val.timestamp > IDEMPOTENCY_TTL_MS) {
      idempotencyStore.delete(key);
    }
  }
  for (const [key, val] of oauthStateStore) {
    if (now - val.timestamp > OAUTH_STATE_TTL_MS) {
      oauthStateStore.delete(key);
    }
  }
}

setInterval(cleanStores, 60 * 60 * 1000);

const rateLimitCounters = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_RATE_LIMIT = 10;
const GLOBAL_RATE_LIMIT = 100;
let globalCounter = { count: 0, windowStart: Date.now() };

function checkRateLimit(key: string, limit: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = rateLimitCounters.get(key);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitCounters.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfter: 0 };
  }
  if (entry.count >= limit) {
    const retryAfter = Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }
  entry.count++;
  return { allowed: true, retryAfter: 0 };
}

function checkGlobalRateLimit(): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  if (now - globalCounter.windowStart > RATE_LIMIT_WINDOW_MS) {
    globalCounter = { count: 1, windowStart: now };
    return { allowed: true, retryAfter: 0 };
  }
  if (globalCounter.count >= GLOBAL_RATE_LIMIT) {
    const retryAfter = Math.ceil((globalCounter.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }
  globalCounter.count++;
  return { allowed: true, retryAfter: 0 };
}

function ensureNotProtectedAccount(account: any, res: Response): boolean {
  if (account.isProtected) {
    res.status(403).json({
      error: "This account is protected and cannot be modified",
      reason: account.protectedReason || "Account is marked as protected",
      banner: "PROTECTED_ACCOUNT_REFUSAL"
    });
    return false;
  }
  return true;
}

function requireAuth(req: Request, res: Response): { userId: string } | null {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return { userId: user.id || user.claims?.sub || "unknown" };
}

async function ensureSubAccountOwner(req: Request, res: Response, subAccountId: number): Promise<boolean> {
  return verifyAccountOwnership(req, res, subAccountId);
}

async function ensureNotProtected(res: Response, subAccountId: number): Promise<{ account: any } | null> {
  const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return null;
  }
  if (!ensureNotProtectedAccount(account, res)) return null;
  return { account };
}

async function authChain(req: Request, res: Response, subAccountId: number, requireNotProtected = true): Promise<{ userId: string; account: any } | null> {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  if (!(await ensureSubAccountOwner(req, res, subAccountId))) return null;
  const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
  if (!account) { res.status(404).json({ error: "Account not found" }); return null; }
  if (requireNotProtected && !ensureNotProtectedAccount(account, res)) return null;
  return { userId: auth.userId, account };
}

function extractSubAccountIdFromParams(req: Request): number | null {
  const raw = req.params.subAccountId;
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? null : parsed;
}

function extractSubAccountIdFromBody(req: Request): number | null {
  const raw = req.body?.subAccountId;
  if (!raw) return null;
  const parsed = typeof raw === "number" ? raw : parseInt(raw, 10);
  return isNaN(parsed) ? null : parsed;
}

const featureGate = requireFeatureFlag(META_MESSAGING_FLAG);
const protectedGuardParams = ensureNotProtectedAccountMiddleware(extractSubAccountIdFromParams);
const protectedGuardBody = ensureNotProtectedAccountMiddleware(extractSubAccountIdFromBody);

function generateDemoInboxData() {
  const channels = ["fb_dm", "ig_dm", "fb_comment", "ig_comment"] as const;
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
    "Hey love! So glad you reached out! Yes, the coaching program is life-changing. Let me send you the details...",
    "Hi there! Our premium package starts at $497/mo and includes weekly 1-on-1 sessions. Want me to break it down for you?",
    "Hey! I'd love to chat with you. I have openings next Tuesday and Thursday. Which works better?",
    "Thank you so much! Yes, I run exclusive group sessions monthly. The next one is filling up fast!",
    "Aww that means the world! Your friend has great taste. Let's find the perfect fit for you.",
    "Absolutely! Small businesses are my specialty. Let's hop on a quick call to see how I can help.",
    "YES! I love hearing that. Let's make it happen. Drop your number and I'll send you the enrollment link.",
    "I appreciate you asking! While I don't do discounts, I do have a payment plan that makes it super accessible.",
    "Of course! I'll DM you a link to our client success stories. The results speak for themselves!",
    "Great question! The fastest way is to book a free discovery call. Here's my calendar link...",
  ];

  const now = Date.now();
  const items: any[] = [];
  for (let i = 0; i < 20; i++) {
    const channel = channels[i % 4];
    const name = names[i % 10];
    const senderId = `demo_${200000 + i}`;
    const baseTime = now - (20 - i) * 1800000;
    const isComment = channel.includes("comment");

    items.push({
      id: `demo_msg_${i}`,
      threadId: `thread_${senderId}`,
      channel,
      senderName: name,
      senderId,
      body: inboundMessages[i % 10],
      direction: "inbound",
      timestamp: new Date(baseTime).toISOString(),
      unread: i < 5,
      priority: i === 0 ? "high" : i < 4 ? "medium" : "normal",
      safetyFlags: detectSafetyFlags(inboundMessages[i % 10]),
      isComment,
      postId: isComment ? `post_${1000 + Math.floor(i / 3)}` : undefined,
      aiSuggestion: {
        id: `ai_${i}`,
        text: aiReplies[i % 10],
        modelVersion: "gpt-4o-2025-04",
        confidence: 0.85 + Math.random() * 0.14,
        safetyFlags: detectSafetyFlags(aiReplies[i % 10]),
        status: i === 3 ? "pending_approval" : "suggested",
      },
    });
  }
  return items;
}

export function registerMetaMessagingProductRoutes(app: Express) {
  const BASE = "/api/meta-messaging/product";

  app.use(BASE, traceIdMiddleware);

  app.post(`${BASE}/create-subaccount`, asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const userId = user.id || user.claims?.sub || "unknown";

    const { name, industry, twilioNumber, whiteLabelConfig } = req.body;
    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ error: "name is required (min 2 chars)" });
    }

    const existingByName = await db.select({ id: subAccounts.id })
      .from(subAccounts)
      .where(and(eq(subAccounts.name, name.trim()), eq(subAccounts.ownerUserId, userId)))
      .limit(1);

    if (existingByName.length > 0) {
      return res.status(409).json({ error: "A sub-account with this name already exists for your user" });
    }

    const [newAccount] = await db.insert(subAccounts).values({
      name: name.trim(),
      twilioNumber: twilioNumber || "demo-number",
      industry: industry || null,
      ownerUserId: userId,
      isProtected: false,
      config: {
        mode: "demo",
        commentBot: { autoApprove: false, tonePreset: "friendly", blacklistWords: [], vipUsers: [], maxRepliesPerHour: 30 },
        dmBot: { manualApprove: true, safety: "conservative", rateLimit: 1, burst: 5, configVersion: "1.0.0", modelVersion: "gpt-4o-2025-04" },
      },
    }).returning();

    if (whiteLabelConfig) {
      try {
        await db.insert(whiteLabelSettings).values({
          userId,
          brandName: whiteLabelConfig.brandName || name.trim(),
          logoUrl: whiteLabelConfig.logoUrl || null,
          primaryColor: whiteLabelConfig.primaryColor || "#6366f1",
          accentColor: whiteLabelConfig.accentColor || "#06b6d4",
        }).onConflictDoUpdate({
          target: whiteLabelSettings.userId,
          set: {
            brandName: whiteLabelConfig.brandName || name.trim(),
            logoUrl: whiteLabelConfig.logoUrl || null,
            primaryColor: whiteLabelConfig.primaryColor || "#6366f1",
            accentColor: whiteLabelConfig.accentColor || "#06b6d4",
          },
        });
      } catch (err) { console.warn("[METAMESSAGINGPRODUCT] caught:", err instanceof Error ? err.message : err); }
    }

    await logAudit("meta_messaging_product.create_subaccount", userId, {
      subAccountId: newAccount.id,
      name: name.trim(),
      mode: "demo",
    });
    await logSystemWithTrace("info", "meta-messaging-product", `Sub-account ${newAccount.id} created by ${userId}`, req, {
      subAccountId: newAccount.id,
    });

    res.json({ success: true, subAccount: newAccount, traceId: (req as any).traceId });
  }));

  app.post(`${BASE}/meta/oauth/start`, asyncHandler(async (req: Request, res: Response) => {
    const { subAccountId } = req.body;
    if (!subAccountId) return res.status(400).json({ error: "subAccountId is required" });
    const sid = parseIntParam(String(subAccountId), "subAccountId");

    const ctx = await authChain(req, res, sid, true);
    if (!ctx) return;

    const appId = process.env.META_APP_ID || "DEMO_META_APP_ID";
    const redirectUri = `${req.protocol}://${req.get("host")}/api/meta-messaging/product/meta/oauth/callback`;
    const state = crypto.randomBytes(32).toString("hex");
    const scopes = "pages_messaging,pages_manage_metadata,instagram_basic,instagram_manage_messages,instagram_manage_comments,pages_read_engagement";

    oauthStateStore.set(state, { subAccountId: sid, userId: ctx.userId, timestamp: Date.now() });

    const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${scopes}&response_type=code`;

    await logAudit("meta_messaging_product.oauth_start", ctx.userId, {
      subAccountId: sid,
      operatorAssisted: true,
      note: "OAuth URL generated for human completion",
    });
    await logSystemWithTrace("info", "meta-messaging-product", `OAuth flow initiated for sub-account ${sid} by ${ctx.userId} (operator-assisted)`, req, {
      subAccountId: sid,
    });

    res.json({
      oauthUrl,
      instructions: "Please open the OAuth URL in your browser and complete the authorization. The token will be stored automatically upon callback.",
      state,
      expiresIn: "10 minutes",
      traceId: (req as any).traceId,
    });
  }));

  app.post(`${BASE}/meta/oauth/callback`, asyncHandler(async (req: Request, res: Response) => {
    const { code, state, subAccountId } = req.body;
    const auth = requireAuth(req, res);
    if (!auth) return;

    let sid: number;
    if (state && oauthStateStore.has(state)) {
      const storedState = oauthStateStore.get(state)!;
      if (Date.now() - storedState.timestamp > OAUTH_STATE_TTL_MS) {
        oauthStateStore.delete(state);
        return res.status(400).json({ error: "OAuth state expired. Please restart the OAuth flow." });
      }
      if (storedState.userId !== auth.userId) {
        await logAudit("meta_messaging_product.oauth_state_mismatch", auth.userId, {
          expectedUser: storedState.userId,
          actualUser: auth.userId,
        });
        return res.status(403).json({ error: "OAuth state does not match the authenticated user" });
      }
      sid = storedState.subAccountId;
      oauthStateStore.delete(state);
    } else if (subAccountId) {
      sid = parseIntParam(String(subAccountId), "subAccountId");
    } else {
      return res.status(400).json({ error: "state or subAccountId is required" });
    }

    const ctx = await authChain(req, res, sid, true);
    if (!ctx) return;
    const { userId, account } = ctx;

    const appId = process.env.META_APP_ID || "DEMO_META_APP_ID";
    const appSecret = process.env.META_APP_SECRET || "DEMO_META_APP_SECRET";

    let accessToken = `demo_token_${crypto.randomBytes(8).toString("hex")}`;
    let tokenExpiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    let providerAccountId = `demo_provider_${sid}`;

    if (code && appId !== "DEMO_META_APP_ID") {
      try {
        const redirectUri = `${req.protocol}://${req.get("host")}/api/meta-messaging/product/meta/oauth/callback`;
        const tokenRes = await fetch(
          `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`
        );
        const tokenData = await tokenRes.json() as any;
        if (tokenData.access_token) {
          accessToken = tokenData.access_token;
          tokenExpiry = new Date(Date.now() + (tokenData.expires_in || 5184000) * 1000);
        }
      } catch (err: any) {
        await logSystemWithTrace("error", "meta-messaging-product", `OAuth token exchange failed for ${sid}`, req, { error: err.message });
      }
    }

    const existing = await db.select().from(oauthTokens)
      .where(and(eq(oauthTokens.subAccountId, sid), eq(oauthTokens.provider, "meta")))
      .limit(1);

    if (existing.length > 0) {
      await db.update(oauthTokens).set({
        accessToken,
        tokenExpiry,
        providerAccountId,
        updatedAt: new Date(),
      }).where(eq(oauthTokens.id, existing[0].id));
    } else {
      await db.insert(oauthTokens).values({
        provider: "meta",
        subAccountId: sid,
        accessToken,
        tokenExpiry,
        scopes: "pages_messaging,instagram_manage_messages,instagram_manage_comments",
        providerAccountId,
        connectionType: "oauth",
      });
    }

    await db.update(subAccounts).set({
      metaAccessToken: accessToken,
    }).where(eq(subAccounts.id, sid));

    await logAudit("meta_messaging_product.oauth_callback", userId, {
      subAccountId: sid,
      humanApprovalLogged: true,
      tokenExpiry: tokenExpiry.toISOString(),
      reconnect: existing.length > 0,
    });
    await logSystemWithTrace("info", "meta-messaging-product", `OAuth completed for sub-account ${sid} (${existing.length > 0 ? 'reconnect' : 'new'})`, req, {
      subAccountId: sid,
      privacy: false,
    });

    res.json({
      success: true,
      tokenStatus: "active",
      tokenExpiry: tokenExpiry.toISOString(),
      reconnect: existing.length > 0,
      providerAccountId,
      traceId: (req as any).traceId,
    });
  }));

  app.get(`${BASE}/meta/oauth/status/:subAccountId`, asyncHandler(async (req: Request, res: Response) => {
    const sid = parseIntParam(req.params.subAccountId, "subAccountId");
    const ctx = await authChain(req, res, sid, false);
    if (!ctx) return;

    const tokens = await db.select().from(oauthTokens)
      .where(and(eq(oauthTokens.subAccountId, sid), eq(oauthTokens.provider, "meta")))
      .limit(1);

    if (tokens.length === 0) {
      return res.json({ connected: false, tokenStatus: "none" });
    }

    const token = tokens[0];
    const isExpired = token.tokenExpiry ? new Date(token.tokenExpiry) < new Date() : false;

    res.json({
      connected: !isExpired,
      tokenStatus: isExpired ? "expired" : "active",
      tokenExpiry: token.tokenExpiry?.toISOString() || null,
      providerAccountId: token.providerAccountId,
      scopes: token.scopes,
      needsReconnect: isExpired,
    });
  }));

  app.post(`${BASE}/test-webhook`, asyncHandler(async (req: Request, res: Response) => {
    const { subAccountId } = req.body;
    if (!subAccountId) return res.status(400).json({ error: "subAccountId is required" });
    const sid = parseIntParam(String(subAccountId), "subAccountId");

    const ctx = await authChain(req, res, sid, false);
    if (!ctx) return;
    const { userId } = ctx;

    const accountWebhooks = await db.select().from(webhooks)
      .where(and(eq(webhooks.subAccountId, sid), eq(webhooks.active, true)))
      .limit(5);

    const testPayload = {
      event: "test_webhook",
      subAccountId: sid,
      timestamp: new Date().toISOString(),
      data: {
        type: "meta_messaging_test",
        message: "This is a test webhook event from Meta Messaging 2027",
      },
    };

    const results: any[] = [];
    if (accountWebhooks.length === 0) {
      const [logEntry] = await db.insert(webhookDeliveryLogs).values({
        webhookId: 0,
        subAccountId: sid,
        targetUrl: "internal://test",
        eventType: "test_webhook",
        statusCode: 200,
        responseBody: JSON.stringify({ ok: true, message: "No webhooks configured — test event recorded internally" }),
        latencyMs: 1,
        success: true,
      }).returning();

      results.push({
        target: "internal://test",
        success: true,
        statusCode: 200,
        latencyMs: 1,
        message: "No external webhooks configured. Test event recorded internally.",
        deliveryLogId: logEntry.id,
      });
    } else {
      for (const wh of accountWebhooks) {
        const start = Date.now();
        try {
          const whRes = await fetch(wh.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(wh.secret ? { "X-Webhook-Secret": wh.secret } : {}),
            },
            body: JSON.stringify(testPayload),
            signal: AbortSignal.timeout(10000),
          });
          const latencyMs = Date.now() - start;
          const body = await whRes.text();

          const [logEntry] = await db.insert(webhookDeliveryLogs).values({
            webhookId: wh.id,
            subAccountId: sid,
            targetUrl: wh.url,
            eventType: "test_webhook",
            statusCode: whRes.status,
            responseBody: body.substring(0, 1000),
            latencyMs,
            success: whRes.ok,
          }).returning();

          results.push({ target: wh.url, success: whRes.ok, statusCode: whRes.status, latencyMs, deliveryLogId: logEntry.id });
        } catch (err: any) {
          const latencyMs = Date.now() - start;
          const [logEntry] = await db.insert(webhookDeliveryLogs).values({
            webhookId: wh.id,
            subAccountId: sid,
            targetUrl: wh.url,
            eventType: "test_webhook",
            statusCode: 0,
            latencyMs,
            success: false,
            errorMessage: err.message?.substring(0, 500),
          }).returning();
          results.push({ target: wh.url, success: false, error: err.message?.substring(0, 200), latencyMs, deliveryLogId: logEntry.id });
        }
      }
    }

    await logAudit("meta_messaging_product.test_webhook", userId, { subAccountId: sid, results: results.length });

    res.json({ success: true, results, testedAt: new Date().toISOString(), traceId: (req as any).traceId });
  }));

  app.get(`${BASE}/inbox/:subAccountId`, asyncHandler(async (req: Request, res: Response) => {
    const sid = parseIntParam(req.params.subAccountId, "subAccountId");
    const ctx = await authChain(req, res, sid, false);
    if (!ctx) return;
    const { account } = ctx;

    const mode = (account.config as any)?.mode || "demo";
    const channel = req.query.channel as string || "all";
    const unreadOnly = req.query.unread === "true";
    const priority = req.query.priority as string || "all";
    const safetyFlag = req.query.safetyFlag as string || "all";
    const cursor = req.query.cursor as string || undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    if (mode === "demo") {
      let items = generateDemoInboxData();
      if (channel !== "all") items = items.filter(i => i.channel === channel);
      if (unreadOnly) items = items.filter(i => i.unread);
      if (priority !== "all") items = items.filter(i => i.priority === priority);
      if (safetyFlag !== "all") items = items.filter(i => i.safetyFlags.some((f: any) => f.flag === safetyFlag));

      const startIdx = cursor ? parseInt(cursor) : 0;
      const page = items.slice(startIdx, startIdx + limit);
      const nextCursor = startIdx + limit < items.length ? String(startIdx + limit) : null;

      return res.json({
        items: page,
        nextCursor,
        total: items.length,
        mode: "demo",
      });
    }

    const metaChannels = ["facebook", "instagram", "fb_dm", "ig_dm", "fb_comment", "ig_comment"];
    const channelCond = channel !== "all"
      ? eq(messages.channel, channel)
      : or(...metaChannels.map(c => eq(messages.channel, c)));

    const threadRows = await db.execute(sql`
      SELECT
        m.contact_phone as sender_id,
        m.channel,
        m.thread_id,
        MAX(m.created_at) as last_message_at,
        COUNT(*) as message_count,
        (SELECT body FROM messages m2 WHERE m2.sub_account_id = m.sub_account_id
          AND m2.contact_phone = m.contact_phone AND m2.channel = m.channel
          ORDER BY m2.created_at DESC LIMIT 1) as last_message,
        (SELECT direction FROM messages m2 WHERE m2.sub_account_id = m.sub_account_id
          AND m2.contact_phone = m.contact_phone AND m2.channel = m.channel
          ORDER BY m2.created_at DESC LIMIT 1) as last_direction,
        (SELECT status FROM messages m2 WHERE m2.sub_account_id = m.sub_account_id
          AND m2.contact_phone = m.contact_phone AND m2.channel = m.channel
          ORDER BY m2.created_at DESC LIMIT 1) as last_status
      FROM messages m
      WHERE m.sub_account_id = ${sid}
        AND m.channel IN ('facebook','instagram','fb_dm','ig_dm','fb_comment','ig_comment')
        ${channel !== "all" ? sql`AND m.channel = ${channel}` : sql``}
      GROUP BY m.contact_phone, m.channel, m.thread_id
      ORDER BY MAX(m.created_at) DESC
      LIMIT ${limit}
    `);

    const items = (threadRows.rows || []).map((t: any) => {
      const sf = detectSafetyFlags(t.last_message || "");
      const hasFailed = t.last_status === "failed";
      const pr = sf.some(f => f.severity === "critical") ? "critical" : hasFailed ? "high" : sf.length > 0 ? "medium" : "normal";
      return {
        ...t,
        message_count: Number(t.message_count),
        safetyFlags: sf,
        priority: pr,
        unread: t.last_direction === "inbound" && t.last_status !== "read",
        aiSuggestion: null,
      };
    });

    let filtered = items;
    if (priority !== "all") filtered = filtered.filter((i: any) => i.priority === priority);
    if (unreadOnly) filtered = filtered.filter((i: any) => i.unread);
    if (safetyFlag !== "all") filtered = filtered.filter((i: any) => i.safetyFlags.some((f: any) => f.flag === safetyFlag));

    await logSystemWithTrace("info", "meta-messaging-product", "inbox read", req, { subAccountId: sid });

    res.json({ items: filtered, nextCursor: null, total: filtered.length, mode: "live", traceId: (req as any).traceId });
  }));

  app.post(`${BASE}/approve-send/:subAccountId`, asyncHandler(async (req: Request, res: Response) => {
    const sid = parseIntParam(req.params.subAccountId, "subAccountId");
    const ctx = await authChain(req, res, sid, true);
    if (!ctx) return;
    const { userId, account } = ctx;
    const traceId = (req as any).traceId || crypto.randomUUID();

    const idempotencyKey = req.headers["idempotency-key"] as string;
    if (!idempotencyKey) {
      return res.status(400).json({ error: "Idempotency-Key header is required" });
    }

    const existing = idempotencyStore.get(idempotencyKey);
    if (existing && Date.now() - existing.timestamp < IDEMPOTENCY_TTL_MS) {
      return res.status(200).json(existing.response);
    }

    const globalCheck = checkGlobalRateLimit();
    if (!globalCheck.allowed) {
      res.setHeader("Retry-After", String(globalCheck.retryAfter));
      return res.status(429).json({ error: "Global rate limit exceeded", retryAfter: globalCheck.retryAfter });
    }

    const accountCheck = checkRateLimit(`account_${sid}`, DEFAULT_RATE_LIMIT);
    if (!accountCheck.allowed) {
      res.setHeader("Retry-After", String(accountCheck.retryAfter));
      return res.status(429).json({ error: "Per-account rate limit exceeded", retryAfter: accountCheck.retryAfter });
    }

    const { messageId, finalText, editedText, modelVersion, confidence, safetyFlags: clientSafetyFlags } = req.body;
    const textToSend = editedText || finalText;
    if (!textToSend) return res.status(400).json({ error: "finalText or editedText is required" });

    const detectedFlags = detectSafetyFlags(textToSend);
    if (detectedFlags.some(f => f.severity === "critical")) {
      await logAudit("meta_messaging_product.approve_blocked", userId, {
        messageId, reason: "critical_safety_flag", flags: detectedFlags, traceId,
      });
      return res.status(400).json({ error: "Message contains critical safety flags and cannot be sent", safetyFlags: detectedFlags });
    }

    const isProduction = (account.config as any)?.mode === "live";
    const loggedText = isProduction ? redactPII(textToSend) : textToSend;

    const botConfig = (account.config as any)?.dmBot || {};

    await logSystemWithTrace("info", "meta-messaging-product", `Message approved: ${messageId || 'new'}`, req, {
      traceId,
      userId,
      subAccountId: sid,
      idempotencyKey,
      modelVersion: modelVersion || botConfig.modelVersion || "unknown",
      configVersion: botConfig.configVersion || "unknown",
      confidence: confidence || null,
      safetyFlags: detectedFlags,
      finalText: loggedText,
      privacy: true,
      edited: !!editedText,
    });

    const responsePayload = {
      success: true,
      traceId,
      idempotencyKey,
      messageId: messageId || `msg_${crypto.randomBytes(4).toString("hex")}`,
      status: "approved_and_queued",
      modelVersion: modelVersion || botConfig.modelVersion,
      approvedBy: userId,
      approvedAt: new Date().toISOString(),
    };

    idempotencyStore.set(idempotencyKey, { response: responsePayload, timestamp: Date.now() });

    await logAudit("meta_messaging_product.approve_send", userId, {
      traceId,
      subAccountId: sid,
      idempotencyKey,
      messageId: messageId || responsePayload.messageId,
      edited: !!editedText,
      modelVersion: modelVersion || botConfig.modelVersion,
    });

    emitUniversalEvent({ eventType: EVENT_TYPES.INBOX_MESSAGE_SENT, sourceModule: "inbox", sourceRecordId: messageId || responsePayload.messageId, subAccountId: sid, metadata: { approved: true, edited: !!editedText, traceId, modelVersion: modelVersion || botConfig.modelVersion, approvedBy: userId } });

    res.json(responsePayload);
  }));

  app.post(`${BASE}/bots/create-defaults/:subAccountId`, asyncHandler(async (req: Request, res: Response) => {
    const sid = parseIntParam(req.params.subAccountId, "subAccountId");
    const ctx = await authChain(req, res, sid, true);
    if (!ctx) return;
    const { userId, account } = ctx;

    const currentConfig = (account.config as any) || {};
    const configVersion = "1.0.0";
    const modelVersion = "gpt-4o-2025-04";

    const botDefaults = {
      dmBot: {
        enabled: true,
        manualApprove: true,
        safety: "conservative",
        rateLimit: 1,
        burst: 5,
        configVersion,
        modelVersion,
        autoPublish: false,
        channels: {
          fb_dm: { enabled: true, manualApprove: true },
          ig_dm: { enabled: true, manualApprove: true },
        },
      },
      commentBot: {
        enabled: true,
        autoApprove: false,
        tonePreset: "friendly",
        safety: "conservative",
        rateLimit: 1,
        burst: 5,
        configVersion,
        modelVersion,
        autoPublish: false,
        blacklistWords: [],
        vipUsers: [],
        maxRepliesPerHour: 30,
        channels: {
          fb_comment: { enabled: true, autoApprove: false },
          ig_comment: { enabled: true, autoApprove: false },
        },
      },
    };

    currentConfig.dmBot = botDefaults.dmBot;
    currentConfig.commentBot = botDefaults.commentBot;

    await db.update(subAccounts).set({ config: currentConfig }).where(eq(subAccounts.id, sid));

    await logAudit("meta_messaging_product.bots_created", userId, {
      subAccountId: sid,
      configVersion,
      modelVersion,
      dmBot: { manualApprove: true, safety: "conservative" },
      commentBot: { autoApprove: false, safety: "conservative" },
    });
    await logSystemWithTrace("info", "meta-messaging-product", `Default bots created for sub-account ${sid}`, req, {
      subAccountId: sid,
      configVersion,
      modelVersion,
    });

    res.json({ success: true, bots: botDefaults, traceId: (req as any).traceId });
  }));

  app.get(`${BASE}/bots/config/:subAccountId`, asyncHandler(async (req: Request, res: Response) => {
    const sid = parseIntParam(req.params.subAccountId, "subAccountId");
    const ctx = await authChain(req, res, sid, false);
    if (!ctx) return;

    const config = (ctx.account.config as any) || {};

    res.json({
      dmBot: config.dmBot || null,
      commentBot: config.commentBot || null,
      mode: config.mode || "demo",
    });
  }));

  app.post(`${BASE}/bots/update/:subAccountId`, asyncHandler(async (req: Request, res: Response) => {
    const sid = parseIntParam(req.params.subAccountId, "subAccountId");
    const ctx = await authChain(req, res, sid, true);
    if (!ctx) return;
    const { userId, account } = ctx;
    const { botType, settings } = req.body;

    if (!botType || !["dmBot", "commentBot"].includes(botType)) {
      return res.status(400).json({ error: "botType must be 'dmBot' or 'commentBot'" });
    }
    if (!settings || typeof settings !== "object") {
      return res.status(400).json({ error: "settings object is required" });
    }

    const currentConfig = (account.config as any) || {};
    const currentBot = currentConfig[botType] || {};

    if (settings.autoPublish !== undefined && settings.autoPublish !== currentBot.autoPublish) {
      if (!req.body.confirmAutoPublish) {
        return res.status(400).json({
          error: "AutoPublish toggle requires explicit confirmation",
          requiresConfirmation: true,
          currentValue: currentBot.autoPublish || false,
          requestedValue: settings.autoPublish,
        });
      }
      await logAudit("meta_messaging_product.auto_publish_toggled", userId, {
        subAccountId: sid,
        botType,
        oldValue: currentBot.autoPublish || false,
        newValue: settings.autoPublish,
        configVersion: currentBot.configVersion,
        modelVersion: currentBot.modelVersion,
      });
    }

    const updatedBot = { ...currentBot, ...settings };
    currentConfig[botType] = updatedBot;

    await db.update(subAccounts).set({ config: currentConfig }).where(eq(subAccounts.id, sid));

    await logAudit("meta_messaging_product.bot_config_updated", userId, {
      subAccountId: sid,
      botType,
      changes: Object.keys(settings),
      configVersion: updatedBot.configVersion,
      modelVersion: updatedBot.modelVersion,
    });

    emitUniversalEvent({ eventType: "bot_config_updated", sourceModule: "inbox", sourceTable: "sub_accounts", sourceRecordId: String(sid), subAccountId: sid, metadata: { botType, updatedFields: Object.keys(settings), modelVersion: updatedBot.modelVersion, configVersion: updatedBot.configVersion } });

    res.json({ success: true, botConfig: updatedBot, traceId: (req as any).traceId });
  }));

  app.post(`${BASE}/mode/:subAccountId`, asyncHandler(async (req: Request, res: Response) => {
    const sid = parseIntParam(req.params.subAccountId, "subAccountId");
    const ctx = await authChain(req, res, sid, true);
    if (!ctx) return;
    const { userId, account } = ctx;
    const { mode, confirmLive } = req.body;

    if (!mode || !["demo", "live"].includes(mode)) {
      return res.status(400).json({ error: "mode must be 'demo' or 'live'" });
    }

    if (mode === "live" && !confirmLive) {
      return res.status(400).json({
        error: "Switching to Live mode requires explicit confirmation",
        requiresConfirmation: true,
        warning: "Live mode will send real messages to real users. This action requires a two-step confirmation.",
      });
    }

    const currentConfig = (account.config as any) || {};
    currentConfig.mode = mode;

    await db.update(subAccounts).set({ config: currentConfig }).where(eq(subAccounts.id, sid));

    await logAudit("meta_messaging_product.mode_switch", userId, {
      subAccountId: sid,
      oldMode: (account.config as any)?.mode || "demo",
      newMode: mode,
    });
    await logSystemWithTrace("info", "meta-messaging-product", `Mode switched to ${mode} for sub-account ${sid}`, req, {
      subAccountId: sid,
    });

    emitUniversalEvent({ eventType: "account_mode_changed", sourceModule: "inbox", sourceTable: "sub_accounts", sourceRecordId: String(sid), subAccountId: sid, metadata: { oldMode: (account.config as any)?.mode || "demo", newMode: mode } });

    res.json({ success: true, mode, traceId: (req as any).traceId });
  }));

  app.post(`${BASE}/workflows/generate`, asyncHandler(async (req: Request, res: Response) => {
    const { subAccountId, industry, tone, businessHours, vipList, bannedWords } = req.body;
    if (!subAccountId) return res.status(400).json({ error: "subAccountId is required" });
    const sid = parseIntParam(String(subAccountId), "subAccountId");

    const ctx = await authChain(req, res, sid, true);
    if (!ctx) return;
    const { userId } = ctx;

    const templates = [
      {
        name: `Sales DM - ${industry || "General"}`,
        trigger: "new_dm_lead",
        steps: [
          { type: "detect_intent", config: { keywords: ["pricing", "cost", "buy", "purchase", "deal"] } },
          { type: "ai_respond", config: { tone: tone || "professional", template: `Hi! Thanks for reaching out about our ${industry || "services"}. I'd love to help you find the perfect solution.` } },
          { type: "qualify_lead", config: { questions: ["What's your budget range?", "When are you looking to get started?"] } },
          { type: "book_call", config: { calendarLink: true } },
        ],
      },
      {
        name: `Support DM - ${industry || "General"}`,
        trigger: "support_request",
        steps: [
          { type: "detect_intent", config: { keywords: ["help", "issue", "problem", "broken", "support"] } },
          { type: "ai_respond", config: { tone: tone || "empathetic", template: "I'm sorry to hear you're having trouble. Let me help you right away." } },
          { type: "escalate_if_needed", config: { severity_threshold: "high" } },
          { type: "resolve_and_followup", config: { followup_hours: 24 } },
        ],
      },
      {
        name: `Booking DM - ${industry || "General"}`,
        trigger: "booking_inquiry",
        steps: [
          { type: "detect_intent", config: { keywords: ["book", "appointment", "schedule", "available", "reserve"] } },
          { type: "ai_respond", config: { tone: tone || "friendly", template: "I'd love to get you scheduled! Let me check our availability." } },
          { type: "check_availability", config: { businessHours: businessHours || "9am-5pm" } },
          { type: "confirm_booking", config: { requireDeposit: false } },
        ],
      },
      {
        name: `Comment Auto-Reply - Brand Protect`,
        trigger: "negative_comment",
        steps: [
          { type: "detect_sentiment", config: { threshold: "negative" } },
          { type: "safety_check", config: { bannedWords: bannedWords || [] } },
          { type: "ai_respond", config: { tone: "professional", template: "Thank you for your feedback. We take all concerns seriously. Please DM us so we can resolve this." } },
          { type: "alert_team", config: { notify: true } },
        ],
      },
      {
        name: `Comment Auto-Reply - Lead Capture`,
        trigger: "engagement_comment",
        steps: [
          { type: "detect_intent", config: { keywords: ["interested", "how", "want", "need", "info"] } },
          { type: "check_vip", config: { vipList: vipList || [] } },
          { type: "ai_respond", config: { tone: tone || "enthusiastic", template: "Thanks for your interest! I just sent you a DM with all the details." } },
          { type: "send_dm_followup", config: { delay_seconds: 30 } },
        ],
      },
    ];

    const savedTemplates = [];
    for (const tpl of templates) {
      const [saved] = await db.insert(workflows).values({
        name: tpl.name,
        trigger: tpl.trigger,
        steps: tpl.steps,
        subAccountId: sid,
      }).returning();
      savedTemplates.push(saved);
    }

    await logAudit("meta_messaging_product.workflows_generated", userId, {
      subAccountId: sid,
      templateCount: savedTemplates.length,
      industry,
      tone,
    });

    res.json({ success: true, templates: savedTemplates, traceId: (req as any).traceId });
  }));

  app.get(`${BASE}/workflows/:subAccountId`, asyncHandler(async (req: Request, res: Response) => {
    const sid = parseIntParam(req.params.subAccountId, "subAccountId");
    const ctx = await authChain(req, res, sid, false);
    if (!ctx) return;

    const wfs = await db.select().from(workflows)
      .where(eq(workflows.subAccountId, sid))
      .limit(50);

    res.json({ workflows: wfs });
  }));

  app.put(`${BASE}/workflows/:workflowId`, asyncHandler(async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const workflowId = parseIntParam(req.params.workflowId, "workflowId");

    const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
    if (!wf) return res.status(404).json({ error: "Workflow not found" });
    if (wf.subAccountId) {
      const ctx = await authChain(req, res, wf.subAccountId, true);
      if (!ctx) return;
    }

    const { name, trigger, steps } = req.body;
    const updates: any = {};
    if (name) updates.name = name;
    if (trigger) updates.trigger = trigger;
    if (steps) updates.steps = steps;

    await db.update(workflows).set(updates).where(eq(workflows.id, workflowId));
    await logAudit("meta_messaging_product.workflow_updated", auth.userId, { workflowId, changes: Object.keys(updates) });

    const [updated] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
    res.json({ success: true, workflow: updated, traceId: (req as any).traceId });
  }));

  app.post(`${BASE}/configure-safety`, asyncHandler(async (req: Request, res: Response) => {
    const { subAccountId, safetyConfig } = req.body;
    if (!subAccountId) return res.status(400).json({ error: "subAccountId is required" });
    const sid = parseIntParam(String(subAccountId), "subAccountId");

    const ctx = await authChain(req, res, sid, false);
    if (!ctx) return;
    const { userId, account } = ctx;

    const currentConfig = (account.config as any) || {};
    currentConfig.safety = {
      ...currentConfig.safety,
      ...safetyConfig,
    };

    await db.update(subAccounts).set({ config: currentConfig }).where(eq(subAccounts.id, sid));

    await logAudit("meta_messaging_product.safety_configured", userId, {
      subAccountId: sid,
      safetyConfig,
    });

    res.json({ success: true, safety: currentConfig.safety, traceId: (req as any).traceId });
  }));

  app.get(`${BASE}/white-label`, asyncHandler(async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const settings = await db.select().from(whiteLabelSettings)
      .where(eq(whiteLabelSettings.userId, auth.userId))
      .limit(1);

    res.json({ settings: settings[0] || null });
  }));

  app.get(`${BASE}/demo-inbox`, (_req: Request, res: Response) => {
    res.json({ items: generateDemoInboxData(), mode: "demo" });
  });

  app.get(`${BASE}/safety-queue/:subAccountId`,
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
      return protectedGuardParams(req, res, async () => {
        const page = Math.max(parseInt(req.query.page as string) || 1, 1);
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const offset = (page - 1) * limit;
        const h24 = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const recentInbound = await db.select({
          id: messages.id,
          body: messages.body,
          channel: messages.channel,
          contactPhone: messages.contactPhone,
          createdAt: messages.createdAt,
          senderId: messages.senderId,
        }).from(messages)
          .where(and(
            eq(messages.subAccountId, subAccountId),
            eq(messages.direction, "inbound"),
            or(eq(messages.channel, "facebook"), eq(messages.channel, "instagram")),
            gte(messages.createdAt, h24),
          ))
          .orderBy(desc(messages.createdAt)).limit(500);

        const flaggedAll = recentInbound
          .map(m => ({ ...m, safetyFlags: detectSafetyFlags(m.body || "") }))
          .filter(m => m.safetyFlags.length > 0)
          .sort((a, b) => {
            const sev = { critical: 3, high: 2, medium: 1 };
            const maxA = Math.max(...a.safetyFlags.map(f => sev[f.severity as keyof typeof sev] || 0));
            const maxB = Math.max(...b.safetyFlags.map(f => sev[f.severity as keyof typeof sev] || 0));
            return maxB - maxA;
          });

        const paginated = flaggedAll.slice(offset, offset + limit);

        await logSystemWithTrace("info", "meta-messaging-product", "safety-queue read", req, { subAccountId, totalFlagged: flaggedAll.length });

        res.json({
          items: paginated,
          total: flaggedAll.length,
          page,
          limit,
          severityCounts: {
            critical: flaggedAll.filter(m => m.safetyFlags.some(f => f.severity === "critical")).length,
            high: flaggedAll.filter(m => m.safetyFlags.some(f => f.severity === "high")).length,
            medium: flaggedAll.filter(m => m.safetyFlags.some(f => f.severity === "medium")).length,
          },
          traceId: (req as any).traceId,
        });
      });
    })
  );

  app.post(`${BASE}/safety-test`,
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const { text } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "text is required" });
      }
      const flags = detectSafetyFlags(text);
      await logSystemWithTrace("info", "meta-messaging-product", "safety-test harness invoked", req, { textLength: text.length, flagCount: flags.length });
      res.json({ text, flags, flagged: flags.length > 0, traceId: (req as any).traceId });
    })
  );

  app.post(`${BASE}/seed-demo/:subAccountId`,
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

      const isProtected = await isProtectedAccountId(subAccountId);
      if (isProtected) {
        await logSystemWithTrace("security", "meta-messaging-product", "seed-demo blocked on protected account", req, { subAccountId });
        return res.status(403).json({ error: "Cannot seed demo data to a protected account", traceId: (req as any).traceId });
      }

      const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
      if (!account) return res.status(404).json({ error: "Account not found" });

      const now = new Date();
      const seededMessages: any[] = [];
      const channels = ["facebook", "instagram"];
      const names = ["Sarah Chen", "Marcus Rivera", "Priya Patel", "James Thompson", "Aisha Mohammed"];
      const bodies = [
        "Hi, I'd like to schedule a consultation",
        "What are your hours?",
        "Do you offer payment plans?",
        "I need help with my account",
        "Great service, thank you!",
      ];

      for (let i = 0; i < 20; i++) {
        const channel = channels[i % 2];
        const direction = i % 3 === 0 ? "outbound" : "inbound";
        const body = direction === "inbound" ? bodies[i % bodies.length] : `Thanks for reaching out, ${names[i % names.length]}! We'll get back to you shortly.`;
        try {
          const [msg] = await db.insert(messages).values({
            subAccountId,
            direction,
            body,
            status: direction === "outbound" ? "sent" : "received",
            contactPhone: `+1555${String(i).padStart(4, "0")}`,
            channel,
            senderId: `demo_sender_${i}`,
            traceId: (req as any).traceId,
          }).returning();
          seededMessages.push(msg);
        } catch (err) { console.warn("[METAMESSAGINGPRODUCT] caught:", err instanceof Error ? err.message : err); }
      }

      for (let i = 0; i < 5; i++) {
        try {
          await db.insert(metaMessagingBillingEvents).values({
            subAccountId,
            eventType: "dm_send",
            channel: channels[i % 2],
            messageCount: 1,
            tokenCount: 50 + i * 10,
            unitCostMessage: 0.005,
            unitCostToken: 0.00002,
            totalCost: 0.005 + (50 + i * 10) * 0.00002,
          });
        } catch (err) { console.warn("[METAMESSAGINGPRODUCT] caught:", err instanceof Error ? err.message : err); }
      }

      for (let d = 0; d < 7; d++) {
        const periodDate = new Date(now.getTime() - d * 86400000);
        periodDate.setHours(0, 0, 0, 0);
        for (const ch of channels) {
          try {
            await db.insert(metaMessagingAnalyticsAggregates).values({
              subAccountId,
              periodDate,
              channel: ch,
              inboundCount: 5 + Math.floor(Math.random() * 10),
              outboundCount: 3 + Math.floor(Math.random() * 8),
              failedCount: Math.floor(Math.random() * 2),
              avgResponseTimeMs: 200 + Math.random() * 300,
              commentCount: 2 + Math.floor(Math.random() * 5),
              commentReplyCount: 1 + Math.floor(Math.random() * 4),
              tokenUsage: 100 + Math.floor(Math.random() * 500),
            });
          } catch (err) { console.warn("[METAMESSAGINGPRODUCT] caught:", err instanceof Error ? err.message : err); }
        }
      }

      await logSystemWithTrace("info", "meta-messaging-product", "seed-demo completed", req, {
        subAccountId,
        messagesSeeded: seededMessages.length,
        billingEventsSeeded: 5,
        analyticsAggregatesSeeded: 14,
      });

      res.json({
        ok: true,
        seeded: {
          messages: seededMessages.length,
          billingEvents: 5,
          analyticsAggregates: 14,
        },
        traceId: (req as any).traceId,
      });
    })
  );

  app.get(`${BASE}/analytics/usage/:subAccountId`,
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
      const days = Math.min(parseInt(req.query.days as string) || 7, 90);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const aggregates = await db.select().from(metaMessagingAnalyticsAggregates)
        .where(and(
          eq(metaMessagingAnalyticsAggregates.subAccountId, subAccountId),
          gte(metaMessagingAnalyticsAggregates.periodDate, since),
        ))
        .orderBy(desc(metaMessagingAnalyticsAggregates.periodDate));

      const totalInbound = aggregates.reduce((s, a) => s + a.inboundCount, 0);
      const totalOutbound = aggregates.reduce((s, a) => s + a.outboundCount, 0);
      const totalFailed = aggregates.reduce((s, a) => s + a.failedCount, 0);
      const totalComments = aggregates.reduce((s, a) => s + a.commentCount, 0);
      const totalCommentReplies = aggregates.reduce((s, a) => s + a.commentReplyCount, 0);
      const avgResponseTimes = aggregates.filter(a => a.avgResponseTimeMs != null);
      const avgResponseTimeMs = avgResponseTimes.length > 0
        ? Math.round(avgResponseTimes.reduce((s, a) => s + (a.avgResponseTimeMs || 0), 0) / avgResponseTimes.length)
        : null;

      const dailyData = aggregates.reduce((acc: Record<string, any>, a) => {
        const dateKey = new Date(a.periodDate).toISOString().split("T")[0];
        if (!acc[dateKey]) acc[dateKey] = { date: dateKey, inbound: 0, outbound: 0, failed: 0, avgResponseTimeMs: 0, count: 0 };
        acc[dateKey].inbound += a.inboundCount;
        acc[dateKey].outbound += a.outboundCount;
        acc[dateKey].failed += a.failedCount;
        if (a.avgResponseTimeMs) {
          acc[dateKey].avgResponseTimeMs += a.avgResponseTimeMs;
          acc[dateKey].count += 1;
        }
        return acc;
      }, {});

      const dailyVolume = Object.values(dailyData).map((d: any) => ({
        date: d.date,
        inbound: d.inbound,
        outbound: d.outbound,
        failed: d.failed,
        avgResponseTimeMs: d.count > 0 ? Math.round(d.avgResponseTimeMs / d.count) : null,
      })).sort((a: any, b: any) => a.date.localeCompare(b.date));

      await logSystemWithTrace("info", "meta-messaging-product", "analytics/usage read", req, { subAccountId, days });

      res.json({
        period: { days, since: since.toISOString() },
        summary: { totalInbound, totalOutbound, totalFailed, totalComments, totalCommentReplies, avgResponseTimeMs },
        dailyVolume,
        traceId: (req as any).traceId,
      });
    })
  );

  app.get(`${BASE}/analytics/export/:subAccountId`,
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
      const days = Math.min(parseInt(req.query.days as string) || 30, 90);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const aggregates = await db.select().from(metaMessagingAnalyticsAggregates)
        .where(and(
          eq(metaMessagingAnalyticsAggregates.subAccountId, subAccountId),
          gte(metaMessagingAnalyticsAggregates.periodDate, since),
        ))
        .orderBy(desc(metaMessagingAnalyticsAggregates.periodDate));

      const csvHeader = "Date,Channel,Inbound,Outbound,Failed,AvgResponseTimeMs,Comments,CommentReplies,TokenUsage\n";
      const csvRows = aggregates.map(a => {
        const date = new Date(a.periodDate).toISOString().split("T")[0];
        return `${date},${a.channel},${a.inboundCount},${a.outboundCount},${a.failedCount},${a.avgResponseTimeMs || ""},${a.commentCount},${a.commentReplyCount},${a.tokenUsage}`;
      }).join("\n");

      await logSystemWithTrace("info", "meta-messaging-product", "analytics/export CSV generated", req, { subAccountId, days, rows: aggregates.length });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="meta-messaging-analytics-${subAccountId}-${days}d.csv"`);
      res.send(csvHeader + csvRows);
    })
  );

  app.post(`${BASE}/billing/record-event/:subAccountId`,
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
      return protectedGuardParams(req, res, async () => {
        const { eventType, channel, messageCount, tokenCount, messageId } = req.body;
        if (!eventType || !channel) {
          return res.status(400).json({ error: "eventType and channel are required" });
        }
        const billing = calculateBillingCost(channel, messageCount || 1, tokenCount || 0);
        const [event] = await db.insert(metaMessagingBillingEvents).values({
          subAccountId,
          eventType,
          messageId: messageId || null,
          channel,
          messageCount: messageCount || 1,
          tokenCount: tokenCount || 0,
          ...billing,
        }).returning();

        await logSystemWithTrace("info", "meta-messaging-product", "billing event recorded", req, { subAccountId, eventType, totalCost: billing.totalCost });

        res.json({ ok: true, event, traceId: (req as any).traceId });
      });
    })
  );

  app.get(`${BASE}/billing/usage/:subAccountId`,
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const billingEvents = await db.select().from(metaMessagingBillingEvents)
        .where(and(
          eq(metaMessagingBillingEvents.subAccountId, subAccountId),
          gte(metaMessagingBillingEvents.createdAt, monthStart),
        ));

      const totalMessages = billingEvents.reduce((s, e) => s + e.messageCount, 0);
      const totalTokens = billingEvents.reduce((s, e) => s + e.tokenCount, 0);
      const totalMessageCost = billingEvents.reduce((s, e) => s + (e.messageCount * e.unitCostMessage), 0);
      const totalTokenCost = billingEvents.reduce((s, e) => s + (e.tokenCount * e.unitCostToken), 0);
      const totalCost = billingEvents.reduce((s, e) => s + e.totalCost, 0);

      const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
      const plan = account?.plan || "starter";
      const limits: Record<string, { messages: number; tokens: number }> = {
        starter: { messages: 500, tokens: 50000 },
        pro: { messages: 2000, tokens: 200000 },
        enterprise: { messages: 10000, tokens: 1000000 },
      };
      const planLimits = limits[plan] || limits.starter;

      const channelBreakdown = billingEvents.reduce((acc: Record<string, { messages: number; tokens: number; cost: number }>, e) => {
        if (!acc[e.channel]) acc[e.channel] = { messages: 0, tokens: 0, cost: 0 };
        acc[e.channel].messages += e.messageCount;
        acc[e.channel].tokens += e.tokenCount;
        acc[e.channel].cost += e.totalCost;
        return acc;
      }, {});

      await logSystemWithTrace("info", "meta-messaging-product", "billing/usage read", req, { subAccountId });

      res.json({
        plan,
        period: { start: monthStart.toISOString(), end: new Date().toISOString() },
        usage: {
          totalMessages,
          messagesLimit: planLimits.messages,
          totalTokens,
          tokensLimit: planLimits.tokens,
          totalMessageCost: Math.round(totalMessageCost * 100) / 100,
          totalTokenCost: Math.round(totalTokenCost * 100) / 100,
          totalCost: Math.round(totalCost * 100) / 100,
        },
        channelBreakdown,
        eventCount: billingEvents.length,
        traceId: (req as any).traceId,
      });
    })
  );

  app.post(`${BASE}/billing/generate-test-invoice/:subAccountId`,
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const billingEvents = await db.select().from(metaMessagingBillingEvents)
        .where(and(
          eq(metaMessagingBillingEvents.subAccountId, subAccountId),
          gte(metaMessagingBillingEvents.createdAt, monthStart),
        ));

      const totalMessages = billingEvents.reduce((s, e) => s + e.messageCount, 0);
      const totalTokens = billingEvents.reduce((s, e) => s + e.tokenCount, 0);
      const totalCost = billingEvents.reduce((s, e) => s + e.totalCost, 0);

      const invoiceId = `INV-TEST-${subAccountId}-${Date.now()}`;

      await db.update(metaMessagingBillingEvents)
        .set({ invoiceId })
        .where(and(
          eq(metaMessagingBillingEvents.subAccountId, subAccountId),
          gte(metaMessagingBillingEvents.createdAt, monthStart),
        ));

      const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));

      const invoice = {
        invoiceId,
        subAccountId,
        accountName: account?.name || "Unknown",
        period: { start: monthStart.toISOString(), end: new Date().toISOString() },
        lineItems: [
          { description: "Meta Messaging - Per Message", quantity: totalMessages, unitPrice: 0.005, total: Math.round(totalMessages * 0.005 * 100) / 100 },
          { description: "Meta Messaging - AI Tokens", quantity: totalTokens, unitPrice: 0.00002, total: Math.round(totalTokens * 0.00002 * 100) / 100 },
        ],
        subtotal: Math.round(totalCost * 100) / 100,
        tax: 0,
        total: Math.round(totalCost * 100) / 100,
        status: "test",
        generatedAt: new Date().toISOString(),
      };

      await logSystemWithTrace("info", "meta-messaging-product", "test invoice generated", req, { subAccountId, invoiceId, totalCost });

      res.json({ ok: true, invoice, traceId: (req as any).traceId });
    })
  );

  app.get(`${BASE}/billing/invoices/:subAccountId`,
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

      const events = await db.select().from(metaMessagingBillingEvents)
        .where(eq(metaMessagingBillingEvents.subAccountId, subAccountId))
        .orderBy(desc(metaMessagingBillingEvents.createdAt));

      const invoiceMap = new Map<string, { invoiceId: string; totalCost: number; totalMessages: number; totalTokens: number; createdAt: Date }>();
      for (const e of events) {
        if (!e.invoiceId) continue;
        const existing = invoiceMap.get(e.invoiceId);
        if (existing) {
          existing.totalCost += e.totalCost;
          existing.totalMessages += e.messageCount;
          existing.totalTokens += e.tokenCount;
        } else {
          invoiceMap.set(e.invoiceId, {
            invoiceId: e.invoiceId,
            totalCost: e.totalCost,
            totalMessages: e.messageCount,
            totalTokens: e.tokenCount,
            createdAt: e.createdAt,
          });
        }
      }

      const invoices = Array.from(invoiceMap.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      res.json({ invoices, traceId: (req as any).traceId });
    })
  );

  app.post(`${BASE}/analytics/aggregate/:subAccountId`,
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
      return protectedGuardParams(req, res, async () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const channels = ["facebook", "instagram"];
        let aggregated = 0;

        for (const channel of channels) {
          const msgResults = await db.execute(sql`
            SELECT
              COUNT(*) FILTER (WHERE direction = 'inbound') as inbound_count,
              COUNT(*) FILTER (WHERE direction = 'outbound') as outbound_count,
              COUNT(*) FILTER (WHERE status = 'failed') as failed_count
            FROM messages
            WHERE sub_account_id = ${subAccountId}
              AND channel = ${channel}
              AND created_at >= ${yesterday}
              AND created_at < ${today}
          `);

          const commentResults = await db.execute(sql`
            SELECT
              COUNT(*) as comment_count,
              COUNT(*) FILTER (WHERE status = 'replied') as comment_reply_count
            FROM comment_auto_replies
            WHERE sub_account_id = ${subAccountId}
              AND platform = ${channel}
              AND created_at >= ${yesterday}
              AND created_at < ${today}
          `);

          const row = msgResults.rows[0] as any;
          const cRow = commentResults.rows[0] as any;

          if (row) {
            try {
              await db.insert(metaMessagingAnalyticsAggregates).values({
                subAccountId,
                periodDate: yesterday,
                channel,
                inboundCount: Number(row.inbound_count || 0),
                outboundCount: Number(row.outbound_count || 0),
                failedCount: Number(row.failed_count || 0),
                commentCount: Number(cRow?.comment_count || 0),
                commentReplyCount: Number(cRow?.comment_reply_count || 0),
              });
              aggregated++;
            } catch (err) { console.warn("[METAMESSAGINGPRODUCT] caught:", err instanceof Error ? err.message : err); }
          }
        }

        await logSystemWithTrace("info", "meta-messaging-product", "analytics aggregation completed", req, { subAccountId, aggregated });

        res.json({ ok: true, aggregated, date: yesterday.toISOString(), traceId: (req as any).traceId });
      });
    })
  );
}
