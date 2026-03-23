import type { Express, Request, Response } from "express";
import { digitalCards, cardAnalyticsEvents } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { eq, sql, and, desc, gte } from "drizzle-orm";
import crypto from "crypto";
import { asyncHandler, parseIntParam, verifyAccountOwnership } from "./helpers";

function generateVCard(card: any): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${card.name || ""}`,
    `N:${(card.name || "").split(" ").reverse().join(";")};;;`,
  ];
  if (card.title) lines.push(`TITLE:${card.title}`);
  if (card.company) lines.push(`ORG:${card.company}`);
  if (card.phone) lines.push(`TEL;TYPE=CELL:${card.phone}`);
  if (card.email) lines.push(`EMAIL;TYPE=INTERNET:${card.email}`);
  if (card.website) lines.push(`URL:${card.website}`);
  if (card.location) lines.push(`ADR;TYPE=WORK:;;${card.location};;;;`);
  if (card.bio) lines.push(`NOTE:${card.bio.replace(/\n/g, "\\n")}`);
  if (card.photoUrl) lines.push(`PHOTO;VALUE=URI:${card.photoUrl}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export function registerCardsRoutes(app: Express) {
  app.post("/api/card-checkout", asyncHandler(async (req, res) => {
    const { plan, interval } = req.body;
    const { getUncachableStripeClient } = await import("../stripeClient");
    const stripe = await getUncachableStripeClient();

    let priceInCents: number;
    let productName: string;
    let planTier: string;

    if (plan === "tapcard") {
      priceInCents = interval === "yearly" ? 6999 : 999;
      productName = interval === "yearly" ? "TapCard — Annual" : "TapCard — Monthly";
      planTier = "starter";
    } else if (plan === "tapcard_pro") {
      priceInCents = interval === "yearly" ? 38400 : 4800;
      productName = interval === "yearly" ? "TapCard Pro — Annual" : "TapCard Pro — Monthly";
      planTier = "pro";
    } else {
      return res.status(400).json({ error: "Invalid plan" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: productName },
          unit_amount: priceInCents,
          recurring: { interval: interval === "yearly" ? "year" : "month" },
        },
        quantity: 1,
      }],
      metadata: { plan, planTier, source: "tapcard_funnel" },
      success_url: `${baseUrl}/digital-card-builder?checkout=success`,
      cancel_url: `${baseUrl}/cards?checkout=cancelled`,
      payment_method_collection: "always",
    });
    res.json({ url: session.url });
  }));

  app.get("/api/digital-card/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const [card] = await db.select().from(digitalCards).where(eq(digitalCards.subAccountId, subAccountId)).limit(1);
    if (!card) return res.status(404).json({ error: "No card found" });
    res.json(card);
  }));

  app.post("/api/digital-card/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const {
      name, preferredName, title, company, phone, email, website, bio,
      photoUrl, coverImageUrl, logoImageUrl, googleReviewLink, slug,
      brandColor, accentColor, theme, layoutVariant, bookingUrl, calendarUrl,
      location, tagline, socialLinks, links, services, testimonial,
      leadCaptureEnabled, seoTitle, seoDescription, ogImageUrl,
      status, isActive, isPublic,
    } = req.body;

    const normalizedSlug = slug ? slug.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 64) : undefined;

    if (normalizedSlug) {
      const [conflict] = await db.select({ id: digitalCards.id })
        .from(digitalCards)
        .where(and(eq(digitalCards.slug, normalizedSlug), sql`${digitalCards.subAccountId} != ${subAccountId}`))
        .limit(1);
      if (conflict) return res.status(409).json({ error: "Slug already taken" });
    }

    const data: any = {
      name, preferredName, title, company, phone, email, website, bio,
      photoUrl, coverImageUrl, logoImageUrl, googleReviewLink,
      slug: normalizedSlug, brandColor, accentColor, theme, layoutVariant,
      bookingUrl, calendarUrl, location, tagline, socialLinks, links,
      services, testimonial, leadCaptureEnabled, seoTitle, seoDescription,
      ogImageUrl, status, isActive, isPublic, updatedAt: new Date(),
    };

    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

    const existing = await db.select().from(digitalCards).where(eq(digitalCards.subAccountId, subAccountId)).limit(1);
    if (existing.length > 0) {
      const [updated] = await db.update(digitalCards).set(data)
        .where(eq(digitalCards.subAccountId, subAccountId)).returning();
      res.json(updated);
    } else {
      const [created] = await db.insert(digitalCards).values({ subAccountId, ...data }).returning();
      res.json(created);
    }
  }));

  app.get("/api/public-card/:slug", asyncHandler(async (req, res) => {
    const slug = req.params.slug.toLowerCase();
    const [card] = await db.select().from(digitalCards).where(eq(digitalCards.slug, slug)).limit(1);
    if (!card) return res.status(404).json({ error: "Card not found" });
    if (!card.isActive || !card.isPublic) return res.status(404).json({ error: "Card not available" });

    await db.update(digitalCards).set({ viewCount: sql`${digitalCards.viewCount} + 1` }).where(eq(digitalCards.id, card.id));

    res.json(card);
  }));

  app.get("/api/public-card/:slug/vcard", asyncHandler(async (req, res) => {
    const slug = req.params.slug.toLowerCase();
    const [card] = await db.select().from(digitalCards).where(eq(digitalCards.slug, slug)).limit(1);
    if (!card || !card.isActive || !card.isPublic) return res.status(404).json({ error: "Card not found" });

    const vcard = generateVCard(card);
    const filename = `${(card.name || "contact").replace(/\s+/g, "_")}.vcf`;
    res.setHeader("Content-Type", "text/vcard; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await db.update(digitalCards).set({ saveContactCount: sql`${digitalCards.saveContactCount} + 1` }).where(eq(digitalCards.id, card.id));

    res.send(vcard);
  }));

  app.post("/api/public-card/:slug/event", asyncHandler(async (req, res) => {
    const slug = req.params.slug.toLowerCase();
    const [card] = await db.select({ id: digitalCards.id, isActive: digitalCards.isActive, isPublic: digitalCards.isPublic }).from(digitalCards).where(eq(digitalCards.slug, slug)).limit(1);
    if (!card || !card.isActive || !card.isPublic) return res.status(404).json({ error: "Card not found" });

    const { eventType, eventTarget, visitorId } = req.body;
    if (typeof eventTarget === "string" && eventTarget.length > 500) return res.status(400).json({ error: "eventTarget too long" });
    if (typeof visitorId === "string" && visitorId.length > 200) return res.status(400).json({ error: "visitorId too long" });
    const allowed = ["view", "click_phone", "click_email", "click_website", "click_booking",
      "click_social", "click_link", "click_review", "save_contact", "share", "qr_scan", "form_submit"];
    if (!allowed.includes(eventType)) return res.status(400).json({ error: "Invalid event type" });

    await db.insert(cardAnalyticsEvents).values({
      cardId: card.id,
      eventType,
      eventTarget: eventTarget || null,
      visitorId: visitorId || null,
      userAgent: req.headers["user-agent"] || null,
      referrer: req.headers.referer || null,
    });

    if (eventType === "share") {
      await db.update(digitalCards).set({ shareCount: sql`${digitalCards.shareCount} + 1` }).where(eq(digitalCards.id, card.id));
    }

    res.json({ ok: true });
  }));

  app.get("/api/digital-card/:subAccountId/analytics", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const [card] = await db.select().from(digitalCards).where(eq(digitalCards.subAccountId, subAccountId)).limit(1);
    if (!card) return res.status(404).json({ error: "No card found" });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const events = await db.select()
      .from(cardAnalyticsEvents)
      .where(and(eq(cardAnalyticsEvents.cardId, card.id), gte(cardAnalyticsEvents.createdAt, thirtyDaysAgo)))
      .orderBy(desc(cardAnalyticsEvents.createdAt));

    const summary: Record<string, number> = {};
    for (const e of events) {
      summary[e.eventType] = (summary[e.eventType] || 0) + 1;
    }

    res.json({
      totalViews: card.viewCount || 0,
      totalSaves: card.saveContactCount || 0,
      totalShares: card.shareCount || 0,
      last30Days: summary,
      recentEvents: events.slice(0, 50),
    });
  }));

  app.get("/api/check-slug/:slug", asyncHandler(async (req, res) => {
    const slug = req.params.slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!slug || slug.length < 2) return res.json({ available: false, reason: "Slug must be at least 2 characters" });
    const reserved = ["admin", "api", "card", "cards", "settings", "login", "register", "dashboard"];
    if (reserved.includes(slug)) return res.json({ available: false, reason: "This slug is reserved" });
    const [existing] = await db.select({ id: digitalCards.id }).from(digitalCards).where(eq(digitalCards.slug, slug)).limit(1);
    const subAccountIdParam = req.query.subAccountId;
    if (existing && subAccountIdParam) {
      const [ownCard] = await db.select({ id: digitalCards.id }).from(digitalCards)
        .where(and(eq(digitalCards.slug, slug), eq(digitalCards.subAccountId, parseInt(subAccountIdParam as string)))).limit(1);
      if (ownCard) return res.json({ available: true });
    }
    res.json({ available: !existing });
  }));

  app.get("/api/portal-tokens/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const tokens = await storage.getPortalTokens(subAccountId);
    res.json(tokens);
  }));

  app.post("/api/portal-tokens/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const token = crypto.randomBytes(32).toString("hex");
    const { label } = req.body;
    const portalToken = await storage.createPortalToken({
      subAccountId, token, label: label || "Client Portal Link", active: true,
    });
    res.json(portalToken);
  }));

  app.delete("/api/portal-tokens/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    await storage.deletePortalToken(id);
    res.json({ ok: true });
  }));

  app.get("/api/portal/:token", asyncHandler(async (req, res) => {
    const portalToken = await storage.getPortalTokenByToken(req.params.token as string);
    if (!portalToken) return res.status(404).json({ error: "Invalid or expired portal link" });
    if (portalToken.expiresAt && new Date(portalToken.expiresAt) < new Date()) {
      return res.status(410).json({ error: "Portal link has expired" });
    }
    const account = await storage.getSubAccount(portalToken.subAccountId);
    if (!account) return res.status(404).json({ error: "Account not found" });
    const [msgs, appts, contactsList, dealsList] = await Promise.all([
      storage.getMessages(portalToken.subAccountId),
      storage.getAppointments(portalToken.subAccountId),
      storage.getContacts(portalToken.subAccountId),
      storage.getDeals(portalToken.subAccountId),
    ]);
    res.json({
      accountName: account.name, industry: account.industry,
      metrics: {
        totalMessages: msgs.length, totalContacts: contactsList.length,
        totalDeals: dealsList.length,
        totalDealValue: dealsList.reduce((s, d) => s + (d.value || 0), 0),
        upcomingAppointments: appts.filter(a => a.status === "scheduled").length,
      },
      recentMessages: msgs.slice(0, 10),
      upcomingAppointments: appts.filter(a => a.status === "scheduled").slice(0, 10),
    });
  }));
}
