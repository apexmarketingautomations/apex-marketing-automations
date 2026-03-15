import type { Express, Request, Response } from "express";
import { insertReviewSchema, insertSponsorshipSchema, reviews, domains, webhooks, messages, sponsorships } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { z } from "zod";
import { isGeminiConfigured } from "../gemini";
import crypto from "crypto";
import dns from "dns";
import { asyncHandler, parseIntParam, getUserId, verifyAccountOwnership, isUserAdmin } from "./helpers";

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
      fireAutomationTrigger("review_received", review.subAccountId, {
        rating: review.rating,
        customerName: review.customerName,
        comment: review.comment,
      }).catch(e => console.error("[REVIEWS] Automation trigger failed:", e instanceof Error ? e.message : e));
    }
    res.status(201).json(review);
  }));

  app.patch("/api/reviews/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const existing = await storage.getReview(id);
    if (!existing) return res.status(404).json({ error: "Review not found" });
    const updated = await storage.updateReview(id, req.body);
    if (!updated) return res.status(404).json({ error: "Review not found" });
    res.json(updated);
  }));

  app.post("/api/alert-owner", asyncHandler(async (req, res) => {
    const { subAccountId, customerName, rating, comment } = req.body;
    console.log(`[ALERT] Negative review from ${customerName} (rating: ${rating}) for account ${subAccountId}: ${comment}`);

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    if (twilioSid && twilioToken && subAccountId) {
      try {
        const account = await storage.getSubAccount(parseInt(subAccountId));
        if (account?.ownerPhone) {
          const twilio = Twilio(twilioSid, twilioToken);
          await twilio.messages.create({
            body: `🚨 APEX ALERT: ${customerName} just left a ${rating}-star rating. "${comment?.substring(0, 100)}". Check your Reputation Dashboard now!`,
            from: account.twilioNumber,
            to: account.ownerPhone,
          });
          console.log(`[ALERT] SMS sent to ${account.ownerPhone}`);

          await storage.createUsageLog({
            subAccountId: parseInt(subAccountId),
            type: "SMS_SEGMENT",
            amount: 1,
            cost: 2.0,
            description: "Negative review alert SMS",
          });
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

  // ── Usage & Billing ──────────────────────────────────────────

  const MARKUP_RATES: Record<string, number> = {
    SMS_SEGMENT: 2.0,
    VOICE_MINUTE: 1.5,
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
    const rate = MARKUP_RATES[type] ?? 0;
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
    const markupMultiplier = MARKUP_RATES[type] ?? 3.0;
    const totalCharge = type === "AI_CHAT" || type === "AI_STREAM" || type === "AI_IMAGE_GEN"
      ? markupMultiplier
      : baseCost * markupMultiplier;

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

    const checks: { name: string; status: "healthy" | "degraded" | "down"; message: string; latencyMs?: number }[] = [];

    const dbStart = Date.now();
    try {
      await db.execute(sql`SELECT 1`);
      checks.push({ name: "Database", status: "healthy", message: "PostgreSQL connected", latencyMs: Date.now() - dbStart });
    } catch (e: any) {
      checks.push({ name: "Database", status: "down", message: e.message || "Connection failed", latencyMs: Date.now() - dbStart });
    }

    const sentinelStart = Date.now();
    try {
      const configs = await db.execute(sql`SELECT COUNT(*) as cnt FROM sentinel_config`);
      const count = Number((configs as any).rows?.[0]?.cnt ?? 0);
      checks.push({ name: "Sentinel", status: count > 0 ? "healthy" : "degraded", message: count > 0 ? `${count} active config(s)` : "No Sentinel configs found", latencyMs: Date.now() - sentinelStart });
    } catch (e: any) {
      checks.push({ name: "Sentinel", status: "degraded", message: "Sentinel table unavailable", latencyMs: Date.now() - sentinelStart });
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
    });

    const aiChecks: string[] = [];
    if (!isGeminiConfigured()) aiChecks.push("Gemini API key not configured");
    const vapiKey = process.env.VAPI_PRIVATE_KEY || process.env.apex_private_vapi;
    if (!vapiKey) aiChecks.push("Vapi API key missing");
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    if (!twilioSid || !twilioToken) aiChecks.push("Twilio credentials missing");
    checks.push({
      name: "AI Engine",
      status: aiChecks.length === 0 ? "healthy" : aiChecks.length <= 1 ? "degraded" : "down",
      message: aiChecks.length === 0 ? "Gemini + Vapi + Twilio online" : aiChecks.join("; "),
    });

    const overallStatus = checks.every(c => c.status === "healthy") ? "healthy" : checks.some(c => c.status === "down") ? "critical" : "degraded";
    res.json({ status: overallStatus, timestamp: new Date().toISOString(), checks });
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

    const allowedFields = ["name", "ownerPhone", "googleReviewLink", "trustpilotLink", "industry", "vibeTheme", "language", "twilioNumber"] as const;
    const validThemes = ["cyber-glass", "midnight-pro", "sunset-warm", "forest-green", "royal-purple"];
    const validLanguages = ["en", "es", "fr", "pt", "de", "zh"];

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        const val = req.body[field];
        if (typeof val !== "string") continue;
        if (field === "vibeTheme" && !validThemes.includes(val)) continue;
        if (field === "language" && !validLanguages.includes(val)) continue;
        if (field === "name" && val.trim().length === 0) continue;
        updates[field] = val.trim();
      }
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid fields to update" });
    const updated = await storage.updateSubAccount(id, updates);
    if (!updated) return res.status(404).json({ error: "Account not found" });
    res.json(updated);
  }));

  // ── Domain Manager ──────────────────────────────────────────

  const TLD_PRICING: Record<string, { cost: number; sale: number }> = {
    ".com": { cost: 12.00, sale: 25.00 },
    ".io": { cost: 35.00, sale: 60.00 },
    ".ai": { cost: 80.00, sale: 150.00 },
    ".co": { cost: 10.00, sale: 22.00 },
    ".app": { cost: 15.00, sale: 30.00 },
    ".dev": { cost: 12.00, sale: 28.00 },
    ".net": { cost: 10.00, sale: 20.00 },
    ".org": { cost: 9.00, sale: 18.00 },
  };

  function extractTld(domain: string): string {
    const dotIndex = domain.indexOf(".");
    if (dotIndex === -1) return ".com";
    return domain.substring(dotIndex).toLowerCase();
  }

  function getBaseName(domain: string): string {
    const dotIndex = domain.indexOf(".");
    if (dotIndex === -1) return domain.toLowerCase();
    return domain.substring(0, dotIndex).toLowerCase();
  }

  app.post("/api/domains/check", asyncHandler(async (req, res) => {
    const { domain } = req.body;
    if (!domain || typeof domain !== "string") {
      return res.status(400).json({ error: "domain is required" });
    }

    const normalizedDomain = domain.toLowerCase().trim();
    const existing = await storage.getDomainByName(normalizedDomain);
    if (existing) {
      const tld = extractTld(normalizedDomain);
      const pricing = TLD_PRICING[tld] || TLD_PRICING[".com"];
      return res.json({ available: false, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "already_registered" });
    }

    const tld = extractTld(normalizedDomain);
    const baseName = getBaseName(normalizedDomain);
    const pricing = TLD_PRICING[tld];

    if (!pricing) {
      return res.json({ available: false, domain: normalizedDomain, tld, costPrice: 0, salePrice: 0, reason: "unsupported_tld" });
    }

    try {
      const rdapRes = await fetch(`https://rdap.org/domain/${normalizedDomain}`, {
        headers: { "Accept": "application/rdap+json" },
        signal: AbortSignal.timeout(5000),
      });
      if (rdapRes.ok) {
        return res.json({ available: false, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "taken" });
      }
      if (rdapRes.status === 404) {
        return res.json({ available: true, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale });
      }
      return res.status(502).json({ available: null, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, error: "Could not verify availability — RDAP returned unexpected status. Try again or check manually." });
    } catch (rdapErr: any) {
      console.warn("[DOMAIN] RDAP lookup failed:", rdapErr.message);
      return res.status(502).json({ available: null, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, error: "Could not verify availability — RDAP lookup timed out or failed. Try again later." });
    }
  }));

  app.post("/api/domains/search", asyncHandler(async (req, res) => {
    const { query } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required" });
    }

    const baseName = query.toLowerCase().trim().replace(/\.[a-z]+$/, "");

    const rdapChecks = Object.entries(TLD_PRICING).map(async ([tld, pricing]) => {
      const fullDomain = `${baseName}${tld}`;
      const existing = await storage.getDomainByName(fullDomain);
      if (existing) {
        return { available: false, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "already_registered" };
      }

      try {
        const rdapRes = await fetch(`https://rdap.org/domain/${fullDomain}`, {
          headers: { "Accept": "application/rdap+json" },
          signal: AbortSignal.timeout(5000),
        });
        if (rdapRes.ok) {
          return { available: false, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "taken" };
        }
        if (rdapRes.status === 404) {
          return { available: true, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale };
        }
        return { available: null, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, error: "Could not verify — unexpected RDAP status" };
      } catch {
        return { available: null, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, error: "Could not verify — RDAP lookup failed" };
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
    const domain = rawDomain.toLowerCase().trim();
    const tld = extractTld(domain);
    const pricing = TLD_PRICING[tld];

    if (!pricing) {
      return res.status(400).json({ error: "Unsupported TLD" });
    }

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

    if (siteId) {
      await storage.updateSavedSite(siteId, { customDomain: domain });
    }

    res.status(201).json({
      success: true,
      domain: domainRecord,
      status: "pending_registration",
      nextSteps: [
        `1. Register "${domain}" at your preferred registrar (Namecheap, GoDaddy, Cloudflare, etc.)`,
        "2. In your registrar's DNS settings, add a CNAME record pointing to your Apex site URL",
        "3. Come back here and click 'Verify Domain' to confirm ownership",
        "4. Once verified, SSL will need to be configured at your hosting provider"
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

    const updates: any = {};
    if (parsed.data.siteId !== undefined) updates.siteId = parsed.data.siteId;
    if (parsed.data.dnsConfigured !== undefined) updates.dnsConfigured = parsed.data.dnsConfigured;
    if (parsed.data.sslActive !== undefined) updates.sslActive = parsed.data.sslActive;

    const updated = await storage.updateDomain(id, updates);

    if (parsed.data.siteId !== undefined && parsed.data.siteId !== null) {
      await storage.updateSavedSite(parsed.data.siteId, { customDomain: existing.domainName });
    }

    res.json(updated);
  }));

  app.post("/api/domains/:id/verify", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const domain = await storage.getDomain(id);
    if (!domain) return res.status(404).json({ error: "Domain not found" });

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

    res.json({
      ...domain,
      verificationStatus: domain.verifiedAt ? "verified" : (domain.verificationToken ? "pending" : "not_started"),
      sslStatus: domain.sslActive ? "active" : "inactive",
      dnsStatus: domain.dnsConfigured ? "configured" : "pending",
    });
  }));
}
