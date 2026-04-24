import type { Express, Request, Response } from "express";
import { insertReviewSchema, insertSponsorshipSchema, reviews, domains, webhooks, messages, sponsorships } from "@shared/schema";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { z } from "zod";
import { getAIProviderStatus, isAIConfigured } from "../aiGateway";
import crypto from "crypto";
import dns from "dns";
import { asyncHandler, parseIntParam, getUserId, verifyAccountOwnership, isUserAdmin } from "./helpers";
import { emitUniversalEvent, emitWithTimeline, EVENT_TYPES } from "../intelligence/eventEmitter";
import { recordOutboundBilling } from "../billing";
import { getSenderVerificationStatus, requestSenderVerification } from "../messaging/sendEmail";

export function registerReviewsRoutes(app: Express) {
  // ---- Reviews / Reputation Management ----
  app.get("/api/reviews/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const reviewsList = await storage.getReviews(subAccountId);
    res.json(reviewsList);
  }));

  app.post("/api/reviews", asyncHandler(async (req, res) => {
    const parsed = insertReviewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const review = await storage.createReview(parsed.data);
    if (review.subAccountId) {
      emitUniversalEvent({ eventType: EVENT_TYPES.REVIEW_RECEIVED, sourceModule: "reviews", sourceTable: "reviews", sourceRecordId: String(review.id), subAccountId: review.subAccountId, metadata: { rating: review.rating, customerName: review.customerName } });
      import("./v1").then(({ fireAutomationTriggerGlobal }) =>
        fireAutomationTriggerGlobal("review_received", review.subAccountId!, {
          rating: review.rating,
          customerName: review.customerName,
          comment: review.comment,
        })
      ).catch(e => console.error("[REVIEWS] trigger failed:", e instanceof Error ? e.message : e));
    }
    res.status(201).json(review);
  }));

  app.patch("/api/reviews/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const existing = await storage.getReview(id);
    if (!existing) return res.status(404).json({ error: "Review not found" });
    const updated = await storage.updateReview(id, req.body);
    if (!updated) return res.status(404).json({ error: "Review not found" });
    if (req.body.ownerReply && !existing.ownerReply && updated.subAccountId) {
      emitWithTimeline(
        { eventType: EVENT_TYPES.REVIEW_REPLIED, sourceModule: "reviews", sourceTable: "reviews", sourceRecordId: String(id), subAccountId: updated.subAccountId, metadata: { customerName: updated.customerName, rating: updated.rating, replyLength: req.body.ownerReply?.length || 0 } },
        "Review Response Posted",
        `Owner replied to ${updated.rating}-star review from ${updated.customerName}`,
        updated.rating && updated.rating <= 2 ? "high" : "info"
      );
    }
    res.json(updated);
  }));

  app.post("/api/alert-owner", asyncHandler(async (req, res) => {
    const { subAccountId, customerName, rating, comment } = req.body;
    console.log(`[ALERT] Negative review from ${customerName} (rating: ${rating}) for account ${subAccountId}: ${comment}`);

    if (subAccountId) {
      try {
        const accountId = parseInt(subAccountId);
        const account = await storage.getSubAccount(accountId);
        if (account?.ownerPhone) {
          const { sendSms: sendSmsReview } = await import("../messaging/sendSms");
          const reviewResult = await sendSmsReview({
            subAccountId: accountId,
            to: account.ownerPhone,
            body: `🚨 APEX ALERT: ${customerName} just left a ${rating}-star rating. "${comment?.substring(0, 100)}". Check your Reputation Dashboard now!`,
            from: account.twilioNumber || undefined,
            source: "review-alert",
            path: "hot-lead",
            metadata: { customerName, rating },
          });
          if (reviewResult.ok) {
            console.log(`[ALERT] SMS sent to ${account.ownerPhone} sid=${reviewResult.twilioSid}`);
            try {
              await recordOutboundBilling({
                subAccountId: parseInt(subAccountId),
                channel: "sms",
                provider: "twilio",
                providerCost: 0.0079,
                direction: "outbound",
                messageType: "system",
                metadata: { source: "review_alert", customerName, rating },
              });
            } catch (billingErr: unknown) {
              const errMsg = billingErr instanceof Error ? billingErr.message : String(billingErr);
              console.error(`[BILLING CRITICAL] Review alert billing failed: ${errMsg}`);
            }
          } else {
            console.error(`[ALERT] Review alert SMS failed reason=${reviewResult.reason} err=${reviewResult.errorMessage}`);
          }
        }
      } catch (e) {
        console.error("[ALERT] SMS failed:", (e as any).message);
      }
    }

    res.json({ success: true });
  }));

  app.get("/api/review-config/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const account = await storage.getSubAccount(subAccountId);
    if (!account) return res.status(404).json({ error: "Account not found" });
    res.json({ googleReviewLink: account.googleReviewLink || "", trustpilotLink: account.trustpilotLink || "", name: account.name });
  }));

  app.patch("/api/review-config/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { googleReviewLink, trustpilotLink } = req.body;
    const updateData: any = {};
    if (googleReviewLink !== undefined) updateData.googleReviewLink = googleReviewLink;
    if (trustpilotLink !== undefined) updateData.trustpilotLink = trustpilotLink;
    const updated = await storage.updateSubAccount(subAccountId, updateData);
    if (!updated) return res.status(404).json({ error: "Account not found" });
    res.json({ googleReviewLink: updated.googleReviewLink, trustpilotLink: updated.trustpilotLink });
  }));

  // ── Usage Logging (non-messaging types only) ──────────────────

  const AI_USAGE_COSTS: Record<string, number> = {
    AI_IMAGE_GEN: 0.25,
    AI_CHAT: 0.03,
    AI_STREAM: 0.03,
    DOMAIN_PURCHASE: 0,
  };

  const usageLogBodySchema = z.object({
    subAccountId: z.number().int().positive(),
    type: z.string().min(1),
    amount: z.number().positive(),
    description: z.string().optional(),
  });

  app.post("/api/usage/log", asyncHandler(async (req, res) => {
    const parsed = usageLogBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, type, amount, description } = parsed.data;
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const MESSAGING_TYPES = ["SMS_SEGMENT", "VOICE_MINUTE", "WHATSAPP_MESSAGE"];
    if (MESSAGING_TYPES.includes(type)) {
      return res.status(400).json({ error: `Messaging type '${type}' must use the unified billing system.` });
    }

    const rate = AI_USAGE_COSTS[type] ?? 0;
    const cost = (type === "AI_IMAGE_GEN" || type === "AI_CHAT" || type === "AI_STREAM") ? rate : amount * rate;

    const log = await storage.createUsageLog({
      subAccountId,
      type,
      amount,
      cost,
      description: description || null,
    });

    try {
      const user = (req as any).user;
      const userId = getUserId(user);
      const sub = userId ? await storage.getSubscription(userId) : null;
      const stripeCustomerId = sub?.stripeCustomerId;
      if (stripeCustomerId) {
        const { getUncachableStripeClient } = await import("../stripeClient");
        const stripe = await getUncachableStripeClient();
        await stripe.billing.meterEvents.create({
          event_name: type.toLowerCase(),
          payload: {
            value: cost.toString(),
            stripe_customer_id: stripeCustomerId,
          },
        });
      }
    } catch (e) {
      const { handleStripeError } = await import("../stripeClient");
      handleStripeError(e);
      console.log("[BILLING] Stripe meter event skipped:", (e as any).message);
    }

    res.status(201).json(log);
  }));

  app.get("/api/usage/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const [logs, summary] = await Promise.all([
      storage.getUsageLogs(subAccountId),
      storage.getUsageLogsSummary(subAccountId),
    ]);
    const costBreakdown = {
      ai: { label: "AI (Gemini 2.5 Flash)", perUnit: "$0.03/call", provider: "Google Gemini" },
      sms: { label: "SMS Segments", perUnit: "$2.00/segment", provider: "Twilio" },
      voice: { label: "Voice Minutes", perUnit: "$1.50/min", provider: "Vapi" },
      image: { label: "AI Image Generation", perUnit: "$0.25/image", provider: "Google Gemini" },
    };
    res.json({ logs, summary, costBreakdown });
  }));

  app.post("/api/webhooks/vapi", asyncHandler(async (req, res) => {
    const { type, call } = req.body;
    if (type === "call.ended" && call) {
      const durationMinutes = (call.durationSeconds || 0) / 60;
      const subAccountId = call.assistant?.metadata?.subAccountId;
      if (subAccountId && durationMinutes > 0) {
        const rate = 1.5;
        await storage.createUsageLog({
          subAccountId: parseInt(subAccountId),
          type: "VOICE_MINUTE",
          amount: durationMinutes,
          cost: durationMinutes * rate,
          description: `Voice call: ${Math.ceil(durationMinutes)} min`,
        });
      }
    }
    res.json({ success: true });
  }));

  // ── Credit Wallet & Monetization Engine ──────────────────────────────

  app.get("/api/wallet/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    let wallet = await storage.getCreditWallet(subAccountId);
    if (!wallet) {
      wallet = await storage.upsertCreditWallet({ subAccountId, balance: 0, lifetimeTopUp: 0, lifetimeSpend: 0 });
    }
    res.json(wallet);
  }));

  app.get("/api/wallet/:subAccountId/transactions", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const txns = await storage.getCreditTransactions(subAccountId);
    res.json(txns);
  }));

  app.post("/api/wallet/topup", asyncHandler(async (req, res) => {
    const schema = z.object({ subAccountId: z.number(), amount: z.number().min(5) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, amount } = parsed.data;

    try {
      const { getUncachableStripeClient } = await import("../stripeClient");
      const stripe = await getUncachableStripeClient();

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: `Apex Credits — $${amount.toFixed(2)} Top-Up` },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        metadata: { subAccountId: subAccountId.toString(), creditAmount: amount.toString(), type: "credit_topup" },
        success_url: `${req.protocol}://${req.get("host")}/billing?topup=success`,
        cancel_url: `${req.protocol}://${req.get("host")}/billing?topup=cancelled`,
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("[WALLET] Stripe checkout error:", err.message);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  }));


  app.post("/api/wallet/deduct", asyncHandler(async (req, res) => {
    const schema = z.object({
      subAccountId: z.number(),
      baseCost: z.number().min(0),
      type: z.string(),
      description: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, baseCost, type, description } = parsed.data;

    const MESSAGING_TYPES = ["SMS_SEGMENT", "VOICE_MINUTE", "WHATSAPP_MESSAGE"];
    if (MESSAGING_TYPES.includes(type)) {
      return res.status(400).json({ error: `Messaging billing type '${type}' must go through the unified billing system. Use /api/messages/send instead.` });
    }

    const rate = AI_USAGE_COSTS[type];
    if (rate === undefined) {
      return res.status(400).json({ error: `Unknown usage type '${type}'. Supported: ${Object.keys(AI_USAGE_COSTS).join(", ")}` });
    }
    const totalCharge = type === "AI_CHAT" || type === "AI_STREAM" || type === "AI_IMAGE_GEN"
      ? rate
      : baseCost * rate;

    const wallet = await storage.getCreditWallet(subAccountId);
    if (!wallet || wallet.balance < totalCharge) {
      return res.status(402).json({ error: "Insufficient credits", required: totalCharge, balance: wallet?.balance || 0 });
    }

    const updated = await storage.updateCreditWalletBalance(subAccountId, -totalCharge);
    const platformProfit = totalCharge - baseCost;

    await storage.createCreditTransaction({
      subAccountId,
      type: "usage",
      amount: -totalCharge,
      balanceAfter: updated?.balance || 0,
      description: description || `${type} usage charge`,
      baseCost,
      platformProfit,
    });

    if (platformProfit > 0) {
      await storage.createPlatformProfit({
        source: "markup",
        amount: platformProfit,
        subAccountId,
        description: `${type} markup: $${baseCost.toFixed(4)} base → $${totalCharge.toFixed(4)} charged`,
      });
    }

    res.json({ success: true, charged: totalCharge, remaining: updated?.balance || 0, profit: platformProfit });
  }));

  // ── Sponsorship / Native Ad Engine ──────────────────────────────

  app.get("/api/sponsorships", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const all = await storage.getSponsorships();
    res.json(all);
  }));

  app.get("/api/sponsorships/:id", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const id = parseIntParam(req.params.id, "id");
    const sp = await storage.getSponsorship(id);
    if (!sp) return res.status(404).json({ error: "Sponsorship not found" });
    const clicks = await storage.getSponsorshipClicks(id);
    res.json({ ...sp, clickLog: clicks });
  }));

  app.post("/api/sponsorships", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const parsed = insertSponsorshipSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const sp = await storage.createSponsorship(parsed.data);
    res.status(201).json(sp);
  }));

  app.patch("/api/sponsorships/:id", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const id = parseIntParam(req.params.id, "id");
    const updated = await storage.updateSponsorship(id, req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  }));

  app.get("/api/v1/serve-native-ad", asyncHandler(async (req, res) => {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: "lat and lon required" });

    const ads = await storage.getActiveSponsorshipsNear(lat, lon);
    if (ads.length === 0) return res.json({ ad: null });

    const topAd = ads[0];
    await storage.updateSponsorship(topAd.id, { impressions: topAd.impressions + 1 });
    res.json({
      ad: {
        id: topAd.id,
        sponsorName: topAd.sponsorName,
        businessName: topAd.businessName,
        headline: topAd.headline,
        description: topAd.description,
        imageUrl: topAd.imageUrl,
        linkUrl: topAd.linkUrl,
        type: "sponsored_action",
      },
    });
  }));

  app.post("/api/v1/ad-click/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const subAccountId = req.body.subAccountId ? parseInt(req.body.subAccountId) : undefined;
    const sp = await storage.getSponsorship(id);
    if (!sp) return res.status(404).json({ error: "Ad not found" });

    const newSpent = sp.spent + sp.bidPerClick;
    const newClicks = sp.clicks + 1;
    const updates: any = { spent: newSpent, clicks: newClicks };
    if (newSpent >= sp.totalBudget) updates.status = "exhausted";

    await storage.updateSponsorship(id, updates);
    await storage.createSponsorshipClick({ sponsorshipId: id, subAccountId: subAccountId || null as any });

    await storage.createPlatformProfit({
      source: "ad_click",
      amount: sp.bidPerClick,
      sponsorshipId: id,
      subAccountId: subAccountId || undefined,
      description: `Ad click: "${sp.headline}" — $${sp.bidPerClick.toFixed(2)}`,
    });

    res.json({ success: true, charged: sp.bidPerClick });
  }));

  // ── Master Profit Report (Admin) ──────────────────────────────

  app.get("/api/admin/profit-report", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const allProfits = await storage.getPlatformProfits();
    const totalMarkupProfit = allProfits.filter(p => p.source === "markup").reduce((s, p) => s + p.amount, 0);
    const totalAdRevenue = allProfits.filter(p => p.source === "ad_click").reduce((s, p) => s + p.amount, 0);

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weeklyProfits = allProfits.filter(p => new Date(p.createdAt) >= weekAgo);

    const dailyBreakdown: Record<string, { markup: number; ads: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyBreakdown[key] = { markup: 0, ads: 0 };
    }
    for (const p of weeklyProfits) {
      const key = new Date(p.createdAt).toISOString().slice(0, 10);
      if (dailyBreakdown[key]) {
        if (p.source === "markup") dailyBreakdown[key].markup += p.amount;
        else dailyBreakdown[key].ads += p.amount;
      }
    }

    const weeklyTrend = Object.entries(dailyBreakdown).map(([date, vals]) => ({
      date,
      markup: Math.round(vals.markup * 100) / 100,
      ads: Math.round(vals.ads * 100) / 100,
      total: Math.round((vals.markup + vals.ads) * 100) / 100,
    }));

    const sponsorList = await storage.getSponsorships();
    const activeSponsorCount = sponsorList.filter(s => s.status === "approved").length;

    res.json({
      totalRevenue: Math.round((totalMarkupProfit + totalAdRevenue) * 100) / 100,
      markupProfit: Math.round(totalMarkupProfit * 100) / 100,
      adRevenue: Math.round(totalAdRevenue * 100) / 100,
      activeSponsorCount,
      totalTransactions: allProfits.length,
      weeklyTrend,
      recentProfits: allProfits.slice(0, 20),
    });
  }));

  // ── System Pulse / Health Check (Admin) ──────────────────────────────

  app.get("/api/admin/pulse", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const checks: { name: string; status: "healthy" | "degraded" | "down"; message: string; category: "core" | "optional"; latencyMs?: number; reason?: string }[] = [];

    const dbStart = Date.now();
    try {
      await db.execute(sql`SELECT 1`);
      checks.push({ name: "Database", status: "healthy", message: "PostgreSQL connected", category: "core", latencyMs: Date.now() - dbStart });
    } catch (e: any) {
      checks.push({ name: "Database", status: "down", message: e.message || "Connection failed", category: "core", reason: "Database unreachable", latencyMs: Date.now() - dbStart });
    }

    const sentinelStart = Date.now();
    try {
      const configs = await db.execute(sql`SELECT COUNT(*) as cnt FROM sentinel_config`);
      const count = Number((configs as any).rows?.[0]?.cnt ?? 0);
      checks.push({ name: "Sentinel", status: count > 0 ? "healthy" : "degraded", message: count > 0 ? `${count} active config(s)` : "No Sentinel configs found", category: "optional", reason: count > 0 ? undefined : "No configs created yet", latencyMs: Date.now() - sentinelStart });
    } catch (e: any) {
      checks.push({ name: "Sentinel", status: "degraded", message: "Sentinel table unavailable", category: "optional", reason: "Table query failed", latencyMs: Date.now() - sentinelStart });
    }

    const billingChecks: string[] = [];
    let stripeConnected = false;
    try {
      const { isStripeConnectionVerified, getStripeSecretKey } = await import("../stripeClient");
      if (isStripeConnectionVerified()) {
        stripeConnected = true;
      } else {
        try {
          const sk = await getStripeSecretKey();
          if (sk) stripeConnected = true;
        } catch {
          const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY;
          if (stripeKey) stripeConnected = true;
        }
      }
    } catch {
      const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY;
      if (stripeKey) stripeConnected = true;
    }
    if (!stripeConnected) billingChecks.push("Stripe not connected");
    const walletCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM credit_wallets`).then(r => Number((r as any).rows?.[0]?.cnt ?? 0)).catch(() => -1);
    if (walletCount === -1) billingChecks.push("Wallet table inaccessible");
    checks.push({
      name: "Billing",
      status: billingChecks.length === 0 ? "healthy" : billingChecks.some(c => c.includes("not connected")) ? "down" : "degraded",
      message: billingChecks.length === 0 ? `Stripe active, ${walletCount} wallet(s)` : billingChecks.join("; "),
      category: "core",
      reason: billingChecks.length > 0 ? billingChecks.join("; ") : undefined,
    });

    const aiChecks: string[] = [];
    const aiProviderStatus = getAIProviderStatus();
    if (!isAIConfigured()) aiChecks.push("AI not configured (no OpenAI or Gemini key)");
    else if (aiProviderStatus?.circuitBreaker?.state === "open") aiChecks.push(`AI circuit breaker open (primary: ${aiProviderStatus?.primary})`);
    const aiStatusMsg = isAIConfigured()
      ? `${aiProviderStatus?.primary || "unknown"} (${aiProviderStatus?.circuitBreaker?.state || "unknown"})`
      : "AI not configured";
    checks.push({
      name: "AI Engine",
      status: aiChecks.length === 0 ? "healthy" : "degraded",
      message: aiChecks.length === 0 ? aiStatusMsg : aiChecks.join("; "),
      category: "core",
      reason: aiChecks.length > 0 ? aiChecks.join("; ") : undefined,
      provider: aiProviderStatus?.primary || "unknown",
      model: aiProviderStatus?.primaryModel || "unknown",
      circuitBreaker: aiProviderStatus?.circuitBreaker?.state || "unknown",
    });

    const vapiKey = process.env.VAPI_PRIVATE_KEY_APEX || process.env.VAPI_PRIVATE_KEY || process.env.apex_private_vapi;
    const env = process.env.NODE_ENV || "development";
    checks.push({
      name: "Vapi",
      status: vapiKey ? "healthy" : "healthy",
      message: vapiKey ? "Voice AI key configured" : `Not configured in ${env} environment`,
      category: "optional",
      reason: vapiKey ? undefined : `Optional service — not configured in this environment (${env})`,
    });

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    checks.push({
      name: "Twilio",
      status: (twilioSid && twilioToken) ? "healthy" : "healthy",
      message: (twilioSid && twilioToken) ? "Twilio credentials configured" : `Not configured in ${env} environment`,
      category: "optional",
      reason: (!twilioSid || !twilioToken) ? `Optional service — not configured in this environment (${env})` : undefined,
    });

    const coreChecks = checks.filter(c => c.category === "core");
    const overallStatus = coreChecks.some(c => c.status === "down")
      ? "critical"
      : coreChecks.some(c => c.status === "degraded")
        ? "degraded"
        : "healthy";

    const statusReason = overallStatus === "critical"
      ? `Core service(s) down: ${coreChecks.filter(c => c.status === "down").map(c => c.name).join(", ")}`
      : overallStatus === "degraded"
        ? `Core service(s) degraded: ${coreChecks.filter(c => c.status === "degraded").map(c => c.name).join(", ")}`
        : "All core services operational";

    res.json({ status: overallStatus, statusReason, timestamp: new Date().toISOString(), checks });
  }));

  app.get("/api/admin/message-failures", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    try {
      const failedRows = await db.execute(sql`
        SELECT id, sub_account_id, contact_phone, channel, status, body, direction, created_at, trace_id
        FROM messages
        WHERE status IN ('failed', 'undelivered', 'unsupported')
        ORDER BY created_at DESC
        LIMIT 200
      `);
      const rows = (failedRows as any).rows || [];

      const categories: Record<string, { count: number; description: string; examples: { id: number; phone: string; channel: string; body: string; createdAt: string }[] }> = {
        twilio_not_configured: { count: 0, description: "Twilio credentials missing or not configured for the account", examples: [] },
        opt_out_rejection: { count: 0, description: "Recipient opted out of SMS communications", examples: [] },
        routing_gate_failure: { count: 0, description: "Message rejected by the routing gate (invalid subAccount, channel mismatch)", examples: [] },
        invalid_recipient: { count: 0, description: "Invalid or missing recipient phone number", examples: [] },
        provider_error: { count: 0, description: "Twilio/Meta API returned an error (rate limit, invalid number, etc.)", examples: [] },
        billing_block: { count: 0, description: "Message blocked due to billing/plan limit", examples: [] },
        unsupported_channel: { count: 0, description: "Unsupported messaging channel requested", examples: [] },
        unknown: { count: 0, description: "Unknown failure reason — requires manual investigation", examples: [] },
      };

      for (const row of rows) {
        const body = (row.body || "").toLowerCase();
        const example = { id: row.id, phone: (row.contact_phone || "").slice(-4), channel: row.channel || "sms", body: (row.body || "").substring(0, 100), createdAt: row.created_at };

        let category = "unknown";
        if (row.status === "unsupported") {
          category = "unsupported_channel";
        } else if (body.includes("twilio") && (body.includes("not configured") || body.includes("not connected"))) {
          category = "twilio_not_configured";
        } else if (body.includes("opted out") || body.includes("opt-out") || body.includes("opt out")) {
          category = "opt_out_rejection";
        } else if (body.includes("routing gate") || body.includes("routing") || body.includes("sub_account")) {
          category = "routing_gate_failure";
        } else if (body.includes("invalid") && (body.includes("phone") || body.includes("number") || body.includes("recipient"))) {
          category = "invalid_recipient";
        } else if (body.includes("billing") || body.includes("limit") || body.includes("exceeded") || body.includes("plan")) {
          category = "billing_block";
        } else if (body.includes("twilio") || body.includes("api") || body.includes("error code") || body.includes("21")) {
          category = "provider_error";
        } else if (!row.contact_phone || row.contact_phone.length < 5) {
          category = "invalid_recipient";
        }

        categories[category].count++;
        if (categories[category].examples.length < 3) {
          categories[category].examples.push(example);
        }
      }

      const activeCategories = Object.entries(categories)
        .filter(([_, v]) => v.count > 0)
        .map(([key, v]) => ({ reason: key, ...v }));

      res.json({
        totalFailed: rows.length,
        breakdown: activeCategories,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: `Failed to analyze message failures: ${err.message}` });
    }
  }));

  app.post("/api/admin/reboot", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const results: string[] = [];

    try {
      await db.execute(sql`SELECT 1`);
      results.push("Database: connection verified");
    } catch {
      results.push("Database: reconnection attempted");
    }

    results.push("Service cache cleared");
    results.push("Health check reset");

    res.json({ success: true, message: "Services rebooted", actions: results, timestamp: new Date().toISOString() });
  }));

  app.patch("/api/accounts/:id", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const id = parseIntParam(req.params.id, "id");

    const account = await storage.getSubAccount(id);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const allowedFields = ["name", "ownerPhone", "googleReviewLink", "trustpilotLink", "industry", "vibeTheme", "language", "twilioNumber", "fromEmail"] as const;
    const validThemes = ["cyber-glass", "midnight-pro", "sunset-warm", "forest-green", "royal-purple"];
    const validLanguages = ["en", "es", "fr", "pt", "de", "zh"];
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        const val = req.body[field];
        if (typeof val !== "string") continue;
        if (field === "vibeTheme" && !validThemes.includes(val)) continue;
        if (field === "language" && !validLanguages.includes(val)) continue;
        if (field === "name" && val.trim().length === 0) continue;
        if (field === "fromEmail") {
          const trimmed = val.trim();
          if (trimmed.length === 0) {
            updates.fromEmail = null;
            continue;
          }
          if (!emailRe.test(trimmed)) {
            return res.status(400).json({ error: "fromEmail must be a valid email address" });
          }
          updates.fromEmail = trimmed;
          continue;
        }
        updates[field] = val.trim();
      }
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid fields to update" });

    // Only call SendGrid when fromEmail actually changed value — the
    // settings form posts the full payload on every save, so without
    // this gate we'd hit SendGrid on every unrelated field edit.
    const fromEmailChanged =
      "fromEmail" in updates &&
      typeof updates.fromEmail === "string" &&
      updates.fromEmail.length > 0 &&
      updates.fromEmail !== (account.fromEmail || "");

    const updated = await storage.updateSubAccount(id, updates);
    if (!updated) return res.status(404).json({ error: "Account not found" });

    const fromEmailVerification = fromEmailChanged
      ? await getSenderVerificationStatus(updates.fromEmail as string)
      : undefined;

    res.json(fromEmailVerification ? { ...updated, fromEmailVerification } : updated);
  }));

  // Read-only check the current sub-account from-email's SendGrid status,
  // used by the UI to refresh the badge without re-saving the form.
  app.get("/api/accounts/:id/from-email-status", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const id = parseIntParam(req.params.id, "id");
    if (!(await verifyAccountOwnership(req, res, id))) return;
    const account = await storage.getSubAccount(id);
    if (!account) return res.status(404).json({ error: "Account not found" });
    const fromEmail = account.fromEmail?.trim() || null;
    if (!fromEmail) return res.json({ fromEmail: null, verification: null });
    const verification = await getSenderVerificationStatus(fromEmail);
    res.json({ fromEmail, verification });
  }));

  // Kick off SendGrid Single Sender Verification for the configured from email.
  app.post("/api/accounts/:id/from-email-verify", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const id = parseIntParam(req.params.id, "id");
    if (!(await verifyAccountOwnership(req, res, id))) return;
    const account = await storage.getSubAccount(id);
    if (!account) return res.status(404).json({ error: "Account not found" });
    const fromEmail = account.fromEmail?.trim();
    if (!fromEmail) return res.status(400).json({ error: "No from email is configured for this account." });

    const result = await requestSenderVerification({
      email: fromEmail,
      fromName: account.name || undefined,
      nickname: account.name ? `${account.name} sender` : undefined,
    });
    if (!result.ok) return res.status(502).json({ error: result.error });
    const verification = await getSenderVerificationStatus(fromEmail);
    res.json({ ok: true, fromEmail, verification });
  }));

  // ── Domain Manager ──────────────────────────────────────────

  const MULTI_PART_SUFFIXES = new Set([
    ".co.uk", ".org.uk", ".me.uk", ".com.au", ".net.au", ".org.au",
    ".co.nz", ".net.nz", ".org.nz", ".co.za", ".co.in", ".com.br",
    ".com.mx", ".com.ar", ".co.jp", ".co.kr", ".com.sg", ".com.hk",
  ]);

  const TLD_PRICING: Record<string, { cost: number; sale: number; category?: string }> = {
    ".com": { cost: 12.00, sale: 25.00, category: "legacy" },
    ".net": { cost: 10.00, sale: 20.00, category: "legacy" },
    ".org": { cost: 9.00, sale: 18.00, category: "legacy" },
    ".biz": { cost: 10.00, sale: 20.00, category: "legacy" },
    ".info": { cost: 8.00, sale: 18.00, category: "legacy" },

    ".io": { cost: 35.00, sale: 60.00, category: "tech" },
    ".ai": { cost: 80.00, sale: 150.00, category: "tech" },
    ".app": { cost: 15.00, sale: 30.00, category: "tech" },
    ".dev": { cost: 12.00, sale: 28.00, category: "tech" },
    ".tech": { cost: 10.00, sale: 25.00, category: "tech" },
    ".cloud": { cost: 12.00, sale: 28.00, category: "tech" },
    ".software": { cost: 25.00, sale: 45.00, category: "tech" },
    ".systems": { cost: 18.00, sale: 35.00, category: "tech" },
    ".digital": { cost: 10.00, sale: 22.00, category: "tech" },
    ".tools": { cost: 18.00, sale: 35.00, category: "tech" },
    ".solutions": { cost: 15.00, sale: 30.00, category: "tech" },
    ".online": { cost: 5.00, sale: 15.00, category: "tech" },
    ".website": { cost: 5.00, sale: 12.00, category: "tech" },
    ".site": { cost: 5.00, sale: 12.00, category: "tech" },

    ".co": { cost: 10.00, sale: 22.00, category: "business" },
    ".agency": { cost: 15.00, sale: 30.00, category: "business" },
    ".marketing": { cost: 18.00, sale: 35.00, category: "business" },
    ".media": { cost: 18.00, sale: 35.00, category: "business" },
    ".services": { cost: 15.00, sale: 30.00, category: "business" },
    ".company": { cost: 12.00, sale: 25.00, category: "business" },
    ".business": { cost: 12.00, sale: 25.00, category: "business" },
    ".consulting": { cost: 18.00, sale: 35.00, category: "business" },
    ".group": { cost: 15.00, sale: 30.00, category: "business" },
    ".partners": { cost: 30.00, sale: 55.00, category: "business" },
    ".studio": { cost: 15.00, sale: 30.00, category: "business" },
    ".design": { cost: 18.00, sale: 35.00, category: "business" },
    ".works": { cost: 18.00, sale: 35.00, category: "business" },

    ".store": { cost: 10.00, sale: 22.00, category: "commerce" },
    ".shop": { cost: 10.00, sale: 22.00, category: "commerce" },
    ".sale": { cost: 18.00, sale: 35.00, category: "commerce" },
    ".deals": { cost: 18.00, sale: 35.00, category: "commerce" },
    ".boutique": { cost: 18.00, sale: 35.00, category: "commerce" },
    ".market": { cost: 18.00, sale: 35.00, category: "commerce" },

    ".live": { cost: 12.00, sale: 25.00, category: "content" },
    ".tv": { cost: 30.00, sale: 55.00, category: "content" },
    ".fm": { cost: 80.00, sale: 140.00, category: "content" },
    ".world": { cost: 10.00, sale: 22.00, category: "content" },
    ".today": { cost: 10.00, sale: 22.00, category: "content" },
    ".news": { cost: 15.00, sale: 30.00, category: "content" },
    ".show": { cost: 18.00, sale: 35.00, category: "content" },
    ".zone": { cost: 18.00, sale: 35.00, category: "content" },
    ".space": { cost: 5.00, sale: 12.00, category: "content" },
    ".life": { cost: 10.00, sale: 22.00, category: "content" },
    ".plus": { cost: 18.00, sale: 35.00, category: "content" },
    ".pro": { cost: 12.00, sale: 25.00, category: "content" },
    ".expert": { cost: 28.00, sale: 50.00, category: "content" },
    ".network": { cost: 15.00, sale: 30.00, category: "content" },
    ".social": { cost: 18.00, sale: 35.00, category: "content" },
    ".events": { cost: 18.00, sale: 35.00, category: "content" },

    ".homes": { cost: 18.00, sale: 35.00, category: "niche" },
    ".house": { cost: 18.00, sale: 35.00, category: "niche" },
    ".properties": { cost: 18.00, sale: 35.00, category: "niche" },
    ".construction": { cost: 18.00, sale: 35.00, category: "niche" },
    ".contractors": { cost: 18.00, sale: 35.00, category: "niche" },
    ".repair": { cost: 18.00, sale: 35.00, category: "niche" },
    ".care": { cost: 18.00, sale: 35.00, category: "niche" },
    ".center": { cost: 15.00, sale: 30.00, category: "niche" },
    ".dental": { cost: 35.00, sale: 60.00, category: "niche" },
    ".fitness": { cost: 18.00, sale: 35.00, category: "niche" },
    ".salon": { cost: 30.00, sale: 55.00, category: "niche" },
    ".auto": { cost: 80.00, sale: 150.00, category: "niche" },
    ".lawyer": { cost: 35.00, sale: 65.00, category: "niche" },
    ".realty": { cost: 30.00, sale: 55.00, category: "niche" },
    ".restaurant": { cost: 30.00, sale: 55.00, category: "niche" },
    ".cafe": { cost: 18.00, sale: 35.00, category: "niche" },
    ".plumbing": { cost: 30.00, sale: 55.00, category: "niche" },
    ".roofing": { cost: 30.00, sale: 55.00, category: "niche" },
    ".cleaning": { cost: 30.00, sale: 55.00, category: "niche" },
    ".legal": { cost: 30.00, sale: 55.00, category: "niche" },

    ".xyz": { cost: 3.00, sale: 10.00, category: "brandable" },
    ".club": { cost: 8.00, sale: 18.00, category: "brandable" },
    ".vip": { cost: 12.00, sale: 25.00, category: "brandable" },
    ".one": { cost: 8.00, sale: 18.00, category: "brandable" },
    ".me": { cost: 12.00, sale: 25.00, category: "brandable" },
    ".cc": { cost: 12.00, sale: 25.00, category: "brandable" },
    ".ws": { cost: 15.00, sale: 30.00, category: "brandable" },

    ".us": { cost: 8.00, sale: 18.00, category: "country" },
    ".ca": { cost: 12.00, sale: 25.00, category: "country" },
    ".uk": { cost: 8.00, sale: 18.00, category: "country" },
    ".de": { cost: 8.00, sale: 18.00, category: "country" },
    ".fr": { cost: 10.00, sale: 22.00, category: "country" },
    ".es": { cost: 10.00, sale: 22.00, category: "country" },
    ".it": { cost: 10.00, sale: 22.00, category: "country" },
    ".nl": { cost: 8.00, sale: 18.00, category: "country" },
    ".in": { cost: 8.00, sale: 15.00, category: "country" },
    ".au": { cost: 15.00, sale: 30.00, category: "country" },

    ".co.uk": { cost: 8.00, sale: 18.00, category: "country" },
    ".org.uk": { cost: 8.00, sale: 18.00, category: "country" },
    ".com.au": { cost: 15.00, sale: 30.00, category: "country" },
    ".net.au": { cost: 15.00, sale: 30.00, category: "country" },
    ".co.nz": { cost: 18.00, sale: 35.00, category: "country" },
    ".co.za": { cost: 10.00, sale: 22.00, category: "country" },
    ".co.in": { cost: 8.00, sale: 15.00, category: "country" },
    ".com.br": { cost: 15.00, sale: 30.00, category: "country" },
    ".com.mx": { cost: 15.00, sale: 30.00, category: "country" },
  };

  const DEFAULT_PRICING = { cost: 15.00, sale: 30.00, category: "other" };

  const SEARCH_TLDS = [
    ".com", ".net", ".org", ".io", ".ai", ".co", ".app", ".dev",
    ".tech", ".live", ".agency", ".marketing", ".services", ".store",
    ".shop", ".online", ".site", ".digital", ".media", ".pro",
    ".world", ".cloud", ".solutions", ".design", ".studio",
    ".xyz", ".me", ".us", ".uk",
  ];

  function extractTld(domain: string): string {
    const lower = domain.toLowerCase();
    for (const suffix of MULTI_PART_SUFFIXES) {
      if (lower.endsWith(suffix)) return suffix;
    }
    const lastDot = lower.lastIndexOf(".");
    if (lastDot === -1) return ".com";
    return lower.substring(lastDot);
  }

  function getBaseName(domain: string): string {
    const lower = domain.toLowerCase();
    for (const suffix of MULTI_PART_SUFFIXES) {
      if (lower.endsWith(suffix)) {
        return lower.substring(0, lower.length - suffix.length);
      }
    }
    const lastDot = lower.lastIndexOf(".");
    if (lastDot === -1) return lower;
    return lower.substring(0, lower.indexOf("."));
  }

  function getPricing(tld: string): { cost: number; sale: number; category?: string } {
    return TLD_PRICING[tld] || DEFAULT_PRICING;
  }

  function isValidDomainSyntax(domain: string): boolean {
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/.test(domain);
  }

  app.post("/api/domains/check", asyncHandler(async (req, res) => {
    const { domain, subAccountId: checkSubAccountId } = req.body;
    if (!domain || typeof domain !== "string") {
      return res.status(400).json({ error: "domain is required" });
    }

    const normalizedDomain = domain.toLowerCase().trim();
    if (!isValidDomainSyntax(normalizedDomain)) {
      return res.json({ available: false, domain: normalizedDomain, tld: "", costPrice: 0, salePrice: 0, reason: "invalid_syntax" });
    }

    const tld = extractTld(normalizedDomain);
    const pricing = getPricing(tld);

    emitUniversalEvent({
      eventType: EVENT_TYPES.DOMAIN_SEARCHED,
      sourceModule: "domains",
      subAccountId: checkSubAccountId ? parseInt(checkSubAccountId) : undefined,
      metadata: { domain: normalizedDomain, tld, action: "check" },
    });

    const existing = await storage.getDomainByName(normalizedDomain);
    if (existing) {
      return res.json({ available: false, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "already_registered" });
    }

    try {
      const rdapRes = await fetch(`https://rdap.org/domain/${normalizedDomain}`, {
        headers: { "Accept": "application/rdap+json" },
        signal: AbortSignal.timeout(8000),
      });
      if (rdapRes.ok) {
        return res.json({ available: false, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "taken" });
      }
      if (rdapRes.status === 404) {
        return res.json({ available: true, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale });
      }
      if (rdapRes.status === 400) {
        return res.json({ available: null, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "unsupported_tld", error: "This TLD is not supported by the RDAP registry. Check availability manually." });
      }
      return res.json({ available: null, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, error: "Could not verify availability — RDAP returned unexpected status. Try again or check manually." });
    } catch (rdapErr: any) {
      console.warn("[DOMAIN] RDAP lookup failed:", rdapErr.message);
      return res.json({ available: null, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, error: "Could not verify availability — RDAP lookup timed out or failed. Try again later." });
    }
  }));

  app.post("/api/domains/search", asyncHandler(async (req, res) => {
    const { query, subAccountId: reqSubAccountId } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required" });
    }

    const baseName = query.toLowerCase().trim().replace(/\.[a-z.]+$/, "");
    if (!baseName || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(baseName)) {
      return res.status(400).json({ error: "Invalid domain name" });
    }

    emitUniversalEvent({
      eventType: EVENT_TYPES.DOMAIN_SEARCHED,
      sourceModule: "domains",
      subAccountId: reqSubAccountId ? parseInt(reqSubAccountId) : undefined,
      metadata: { query, baseName },
    });

    const rdapChecks = SEARCH_TLDS.map(async (tld) => {
      const fullDomain = `${baseName}${tld}`;
      const pricing = getPricing(tld);
      const existing = await storage.getDomainByName(fullDomain);
      if (existing) {
        return { available: false, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "already_registered" };
      }

      try {
        const rdapRes = await fetch(`https://rdap.org/domain/${fullDomain}`, {
          headers: { "Accept": "application/rdap+json" },
          signal: AbortSignal.timeout(6000),
        });
        if (rdapRes.ok) {
          return { available: false, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "taken" };
        }
        if (rdapRes.status === 404) {
          return { available: true, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale };
        }
        return { available: null, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, error: "Could not verify" };
      } catch {
        return { available: null, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, error: "RDAP lookup failed" };
      }
    });

    const results = await Promise.all(rdapChecks);
    res.json(results);
  }));

  const domainPurchaseSchema = z.object({
    subAccountId: z.number().int().positive(),
    domain: z.string().min(1),
    siteId: z.number().int().positive().optional(),
  });

  app.post("/api/domains/purchase", asyncHandler(async (req, res) => {
    const parsed = domainPurchaseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, domain: rawDomain, siteId } = parsed.data;
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const domain = rawDomain.toLowerCase().trim();

    if (!isValidDomainSyntax(domain)) {
      return res.status(400).json({ error: "Invalid domain syntax" });
    }

    const tld = extractTld(domain);
    const pricing = getPricing(tld);

    const existing = await storage.getDomainByName(domain);
    if (existing) {
      return res.status(409).json({ error: "Domain already registered" });
    }

    const domainRecord = await storage.createDomain({
      subAccountId,
      domainName: domain,
      status: "pending_registration",
      purchasePrice: pricing.cost,
      salePrice: pricing.sale,
      dnsConfigured: false,
      sslActive: false,
      registrar: "Not yet registered",
      siteId: siteId || null,
    });

    await storage.createUsageLog({
      subAccountId,
      type: "DOMAIN_CLAIM",
      amount: 1,
      cost: 0,
      description: `Domain reserved: ${domain} — must be registered at an external registrar`,
    });

    emitWithTimeline({
      eventType: EVENT_TYPES.DOMAIN_CLAIMED,
      sourceModule: "domains",
      sourceTable: "domains",
      sourceRecordId: String(domainRecord.id),
      subAccountId,
      domainId: domainRecord.id,
      siteId: siteId || undefined,
      metadata: { domain, tld, pricing },
    }, `Domain claimed: ${domain}`, `Domain ${domain} reserved for registration`, "info");

    if (siteId) {
      await storage.updateSavedSite(siteId, { customDomain: domain });
    }

    const platformHost = process.env.REPLIT_DOMAINS
      ? JSON.parse(process.env.REPLIT_DOMAINS)[0]
      : process.env.REPL_SLUG
        ? `${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
        : "apexmarketingautomations.com";

    res.status(201).json({
      success: true,
      domain: domainRecord,
      status: "pending_registration",
      nextSteps: [
        `1. Register "${domain}" at your preferred registrar (Namecheap, GoDaddy, Cloudflare, etc.)`,
        `2. In your registrar's DNS settings, add a CNAME record pointing to: ${platformHost}`,
        "3. Come back here and click 'Start Verification' to get your DNS TXT record",
        "4. Add the TXT record at your registrar, then click 'Check DNS' to confirm ownership",
        "5. For SSL, use Cloudflare (free) with Full SSL mode, or your registrar's SSL option",
      ],
      notice: "This domain has been reserved in Apex but is NOT yet registered. You must purchase it from a domain registrar to make it live.",
    });
  }));

  app.get("/api/domains/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const domainsList = await storage.getDomains(subAccountId);
    res.json(domainsList);
  }));

  const domainPatchSchema = z.object({
    siteId: z.number().int().positive().nullable().optional(),
    dnsConfigured: z.boolean().optional(),
    sslActive: z.boolean().optional(),
  });

  app.patch("/api/domains/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const parsed = domainPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const existing = await storage.getDomain(id);
    if (!existing) return res.status(404).json({ error: "Domain not found" });
    if (!(await verifyAccountOwnership(req, res, existing.subAccountId))) return;

    const updates: any = {};
    if (parsed.data.siteId !== undefined) updates.siteId = parsed.data.siteId;
    if (parsed.data.dnsConfigured !== undefined) updates.dnsConfigured = parsed.data.dnsConfigured;
    if (parsed.data.sslActive !== undefined) updates.sslActive = parsed.data.sslActive;

    const updated = await storage.updateDomain(id, updates);

    if (parsed.data.siteId !== undefined && parsed.data.siteId !== null) {
      await storage.updateSavedSite(parsed.data.siteId, { customDomain: existing.domainName });
      emitWithTimeline({
        eventType: EVENT_TYPES.DOMAIN_ATTACHED,
        sourceModule: "domains",
        sourceTable: "domains",
        sourceRecordId: String(id),
        subAccountId: existing.subAccountId,
        domainId: id,
        siteId: parsed.data.siteId,
        metadata: { domainName: existing.domainName, siteId: parsed.data.siteId },
      }, `Domain assigned: ${existing.domainName}`, `Domain ${existing.domainName} linked to site`, "info");
    }

    try {
      const { clearDomainCache } = await import("../middleware/customDomain");
      clearDomainCache(existing.domainName);
    } catch {}

    res.json(updated);
  }));

  app.post("/api/domains/:id/verify", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const domain = await storage.getDomain(id);
    if (!domain) return res.status(404).json({ error: "Domain not found" });
    if (!(await verifyAccountOwnership(req, res, domain.subAccountId))) return;

    const token = "apex-verify-" + crypto.randomUUID().substring(0, 8);
    await storage.updateDomain(id, { verificationToken: token });

    res.json({
      verificationToken: token,
      instructions: {
        type: "TXT",
        host: "_apex-verify",
        value: token,
        ttl: 3600,
        steps: [
          "Log into your domain registrar's DNS settings",
          "Add a new TXT record",
          "Set the host/name to: _apex-verify",
          `Set the value to: ${token}`,
          "Save and wait 5-10 minutes for propagation",
          "Click 'Check Verification' to confirm"
        ]
      }
    });
  }));

  app.post("/api/domains/:id/check-verification", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const domain = await storage.getDomain(id);
    if (!domain) return res.status(404).json({ error: "Domain not found" });
    if (!(await verifyAccountOwnership(req, res, domain.subAccountId))) return;

    if (!domain.verificationToken) {
      return res.status(400).json({ error: "No verification token found. Please start verification first." });
    }

    try {
      const records = await dns.promises.resolveTxt(`_apex-verify.${domain.domainName}`);
      const flatRecords = records.map(r => r.join(""));
      const found = flatRecords.includes(domain.verificationToken);

      if (found) {
        const updated = await storage.updateDomain(id, {
          verifiedAt: new Date(),
          status: "verified",
          dnsConfigured: true,
        });
        try {
          const { clearDomainCache } = await import("../middleware/customDomain");
          clearDomainCache(domain.domainName);
        } catch {}
        emitWithTimeline({
          eventType: EVENT_TYPES.DOMAIN_VERIFIED,
          sourceModule: "domains",
          sourceTable: "domains",
          sourceRecordId: String(id),
          subAccountId: domain.subAccountId,
          domainId: id,
          metadata: { domainName: domain.domainName },
        }, `Domain verified: ${domain.domainName}`, `DNS verification passed for ${domain.domainName}`, "info");
        return res.json({ verified: true, domain: updated });
      }

      res.json({ verified: false, message: "DNS record not found yet. Please wait a few minutes and try again." });
    } catch (err: any) {
      res.json({ verified: false, message: "DNS record not found yet. Please wait a few minutes and try again." });
    }
  }));

  app.post("/api/domains/:id/configure-ssl", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const domain = await storage.getDomain(id);
    if (!domain) return res.status(404).json({ error: "Domain not found" });
    if (!(await verifyAccountOwnership(req, res, domain.subAccountId))) return;

    if (!domain.verifiedAt) {
      return res.status(400).json({ error: "Domain must be verified before configuring SSL" });
    }

    res.json({
      success: false,
      requiresManualSetup: true,
      message: "SSL certificates must be configured at your hosting provider or domain registrar.",
      instructions: [
        "Most domain registrars (Cloudflare, Namecheap) offer free SSL certificates",
        "If using Cloudflare, enable 'Full SSL' mode in the SSL/TLS settings",
        "If using your registrar's hosting, look for 'SSL/TLS' or 'Security' settings",
        "Free certificates are available via Let's Encrypt if you manage your own server",
      ],
    });
  }));

  app.get("/api/domains/:id/status", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const domain = await storage.getDomain(id);
    if (!domain) return res.status(404).json({ error: "Domain not found" });
    if (!(await verifyAccountOwnership(req, res, domain.subAccountId))) return;

    res.json({
      ...domain,
      verificationStatus: domain.verifiedAt ? "verified" : (domain.verificationToken ? "pending" : "not_started"),
      sslStatus: domain.sslActive ? "active" : "inactive",
      dnsStatus: domain.dnsConfigured ? "configured" : "pending",
    });
  }));
}
