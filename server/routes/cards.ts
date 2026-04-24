import type { Express, Request, Response } from "express";
import { digitalCards, cardAnalyticsEvents, cardAnalyticsSessions } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { eq, sql, and, desc, gte } from "drizzle-orm";
import crypto from "crypto";
import { asyncHandler, parseIntParam, verifyAccountOwnership } from "./helpers";
import { emitWithTimeline, EVENT_TYPES } from "../intelligence/eventEmitter";

function isCardAccessible(card: { subAccountId?: number | null; purchaseId?: string | null; isActive?: boolean | null; isPublic?: boolean | null; status?: string | null; paymentStatus?: string | null }): boolean {
  if (card.subAccountId) {
    return !!(card.isActive && card.isPublic && card.status === "published");
  }
  if (card.purchaseId) {
    return card.paymentStatus === "paid";
  }
  return false;
}

function generateVCard(card: any, baseUrl?: string): string {
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
  if (card.website) lines.push(`URL;TYPE=WORK:${card.website}`);
  if (card.slug && baseUrl) lines.push(`URL;TYPE=HOME:${baseUrl}/card/${card.slug}`);
  if (card.location) lines.push(`ADR;TYPE=WORK:;;${card.location};;;;`);
  const noteLines: string[] = [];
  if (card.bio) noteLines.push(card.bio.replace(/\n/g, "\\n"));
  if (card.slug && baseUrl) noteLines.push(`Digital Card: ${baseUrl}/card/${card.slug}`);
  if (noteLines.length) lines.push(`NOTE:${noteLines.join("\\n")}`);
  if (card.photoUrl) lines.push(`PHOTO;VALUE=URI:${card.photoUrl}`);
  const socialLinks = card.socialLinks || {};
  if (socialLinks.instagram) lines.push(`X-SOCIALPROFILE;TYPE=instagram:${socialLinks.instagram}`);
  if (socialLinks.facebook) lines.push(`X-SOCIALPROFILE;TYPE=facebook:${socialLinks.facebook}`);
  if (socialLinks.linkedin) lines.push(`X-SOCIALPROFILE;TYPE=linkedin:${socialLinks.linkedin}`);
  if (socialLinks.twitter) lines.push(`X-SOCIALPROFILE;TYPE=twitter:${socialLinks.twitter}`);
  if (socialLinks.tiktok) lines.push(`X-SOCIALPROFILE;TYPE=tiktok:${socialLinks.tiktok}`);
  if (socialLinks.youtube) lines.push(`X-SOCIALPROFILE;TYPE=youtube:${socialLinks.youtube}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

const CARD_PRICE_CENTS = 2900;

export async function handleDigitalCardWebhook(session: any) {
  const meta = session.metadata || {};
  if (meta.source !== "digital_card") return;

  const cardData = JSON.parse(meta.cardData || "{}");
  const email = session.customer_email || cardData.email;
  if (!email) return;

  const [existing] = await db.select({ id: digitalCards.id })
    .from(digitalCards).where(eq(digitalCards.purchaseId, session.id)).limit(1);
  if (existing) return;

  let slug = (cardData.name || email.split("@")[0])
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  const [slugConflict] = await db.select({ id: digitalCards.id })
    .from(digitalCards).where(eq(digitalCards.slug, slug)).limit(1);
  if (slugConflict) slug = slug + "-" + crypto.randomBytes(2).toString("hex");

  const editToken = crypto.randomUUID();

  const [card] = await db.insert(digitalCards).values({
    ownerEmail: email,
    customerId: session.customer || null,
    purchaseId: session.id,
    paymentStatus: "paid",
    editToken,
    slug,
    name: cardData.name || "",
    preferredName: cardData.preferredName || "",
    title: cardData.title || "",
    company: cardData.company || "",
    phone: cardData.phone || "",
    email: cardData.email || email,
    website: cardData.website || "",
    bio: cardData.bio || "",
    photoUrl: cardData.photoUrl || "",
    coverImageUrl: cardData.coverImageUrl || "",
    logoImageUrl: cardData.logoImageUrl || "",
    googleReviewLink: cardData.googleReviewLink || "",
    brandColor: cardData.brandColor || "#6366f1",
    accentColor: cardData.accentColor || "#8b5cf6",
    theme: cardData.theme || "executive-dark",
    bookingUrl: cardData.bookingUrl || "",
    calendarUrl: cardData.calendarUrl || "",
    location: cardData.location || "",
    tagline: cardData.tagline || "",
    socialLinks: cardData.socialLinks || [],
    links: cardData.links || [],
    services: cardData.services || [],
    testimonial: cardData.testimonial || null,
    leadCaptureEnabled: false,
    isActive: true,
    isPublic: true,
    status: "published",
  }).returning();

  console.log(`[DIGITAL-CARD] Card created: /card/${slug} for ${email} (editToken: ${editToken})`);
  return card;
}

export function registerCardsRoutes(app: Express) {
  db.update(digitalCards)
    .set({ paymentStatus: "paid" })
    .where(and(
      sql`${digitalCards.subAccountId} IS NOT NULL`,
      sql`${digitalCards.paymentStatus} = 'pending'`
    ))
    .then((result) => {
      console.log("[cards] Fixed platform cards with pending payment_status");
    })
    .catch((err) => {
      console.error("[cards] Failed to fix platform card payment_status:", err);
    });

  app.post("/api/card-checkout", asyncHandler(async (req, res) => {
    const { cardData } = req.body;
    if (!cardData?.name || !cardData?.email) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    const { getUncachableStripeClient } = await import("../stripeClient");
    const stripe = await getUncachableStripeClient();

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: cardData.email,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: "Digital Business Card + Lead Funnel" },
          unit_amount: CARD_PRICE_CENTS,
        },
        quantity: 1,
      }],
      metadata: {
        source: "digital_card",
        cardData: JSON.stringify(cardData),
      },
      success_url: `${baseUrl}/card/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/standalone/card`,
    });
    res.json({ url: session.url, sessionId: session.id });
  }));

  app.get("/api/card/edit/:token", asyncHandler(async (req, res) => {
    const token = req.params.token;
    if (!token) return res.status(400).json({ error: "Token required" });
    const [card] = await db.select().from(digitalCards)
      .where(eq(digitalCards.editToken, token)).limit(1);
    if (!card) return res.status(404).json({ error: "Card not found" });
    res.json(card);
  }));

  app.put("/api/card/edit/:token", asyncHandler(async (req, res) => {
    const token = req.params.token;
    if (!token) return res.status(400).json({ error: "Token required" });
    const [card] = await db.select().from(digitalCards)
      .where(eq(digitalCards.editToken, token)).limit(1);
    if (!card) return res.status(404).json({ error: "Card not found" });

    const {
      name, preferredName, title, company, phone, email, website, bio,
      photoUrl, coverImageUrl, logoImageUrl, googleReviewLink,
      brandColor, accentColor, theme, bookingUrl, calendarUrl,
      location, tagline, socialLinks, links, services, testimonial,
      leadCaptureEnabled, seoTitle, seoDescription,
    } = req.body;

    const data: any = {
      name, preferredName, title, company, phone, email, website, bio,
      photoUrl, coverImageUrl, logoImageUrl, googleReviewLink,
      brandColor, accentColor, theme, bookingUrl, calendarUrl,
      location, tagline, socialLinks, links, services, testimonial,
      leadCaptureEnabled, seoTitle, seoDescription,
      updatedAt: new Date(),
    };
    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

    const [updated] = await db.update(digitalCards).set(data)
      .where(eq(digitalCards.id, card.id)).returning();
    res.json(updated);
  }));

  app.get("/api/card/session/:sessionId", asyncHandler(async (req, res) => {
    const { getUncachableStripeClient } = await import("../stripeClient");
    const stripe = await getUncachableStripeClient();
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    } catch (e: any) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (session.metadata?.source !== "digital_card") {
      return res.status(404).json({ error: "Session not found" });
    }

    const [card] = await db.select().from(digitalCards)
      .where(eq(digitalCards.purchaseId, session.id)).limit(1);

    if (!card && session.payment_status === "paid") {
      try {
        const created = await handleDigitalCardWebhook(session);
        if (created) {
          return res.json({
            status: "complete",
            card: created,
            editToken: created.editToken,
            slug: created.slug,
          });
        }
      } catch (e: any) {
        console.error("[DIGITAL-CARD] Fallback fulfillment error:", e.message);
      }
    }

    if (!card) {
      return res.json({ status: "processing", message: "Payment is being processed" });
    }

    res.json({
      status: "complete",
      card,
      editToken: card.editToken,
      slug: card.slug,
    });
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

    let normalizedSlug = slug ? slug.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 64) : undefined;

    if (!normalizedSlug && name) {
      normalizedSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
      const suffix = crypto.randomBytes(2).toString("hex");
      normalizedSlug = `${normalizedSlug}-${suffix}`;
    }

    if (normalizedSlug) {
      const [conflict] = await db.select({ id: digitalCards.id })
        .from(digitalCards)
        .where(and(eq(digitalCards.slug, normalizedSlug), sql`${digitalCards.subAccountId} != ${subAccountId}`))
        .limit(1);
      if (conflict) {
        const retrySuffix = crypto.randomBytes(3).toString("hex");
        normalizedSlug = `${normalizedSlug}-${retrySuffix}`;
      }
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
      emitWithTimeline({ eventType: EVENT_TYPES.CARD_CREATED, sourceModule: "cards", sourceTable: "digital_cards", sourceRecordId: String(updated.id), subAccountId, metadata: { action: "updated", slug: updated.slug } });
      res.json(updated);
    } else {
      const [created] = await db.insert(digitalCards).values({ subAccountId, ...data }).returning();
      emitWithTimeline({ eventType: EVENT_TYPES.CARD_CREATED, sourceModule: "cards", sourceTable: "digital_cards", sourceRecordId: String(created.id), subAccountId, metadata: { action: "created", slug: created.slug } });
      res.json(created);
    }
  }));

  app.get("/api/public-card/:slug", asyncHandler(async (req, res) => {
    const slug = req.params.slug.toLowerCase();
    const [card] = await db.select().from(digitalCards).where(eq(digitalCards.slug, slug)).limit(1);
    if (!card) return res.status(404).json({ error: "Card not found" });
    if (!isCardAccessible(card)) return res.status(403).json({ error: "Not available" });

    // Note: viewCount is incremented in /api/track/session (per-visit) to avoid
    // double-counting. Bot/preview fetches that don't run the tracker won't inflate counts.

    res.json(card);
  }));

  app.get("/api/public-card/:slug/vcard", asyncHandler(async (req, res) => {
    const slug = req.params.slug.toLowerCase();
    const [card] = await db.select().from(digitalCards).where(eq(digitalCards.slug, slug)).limit(1);
    if (!card) return res.status(404).json({ error: "Card not found" });
    if (!isCardAccessible(card)) return res.status(403).json({ error: "Not available" });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const vcard = generateVCard(card, baseUrl);
    const filename = `${(card.name || "contact").replace(/\s+/g, "_")}.vcf`;
    res.setHeader("Content-Type", "text/vcard; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await db.update(digitalCards).set({ saveContactCount: sql`${digitalCards.saveContactCount} + 1` }).where(eq(digitalCards.id, card.id));

    res.send(vcard);
  }));

  // Legacy endpoint — thin alias forwarding to the unified session-aware
  // tracking pipeline (Task #146 stabilization). Accepts the new fields
  // (sessionId, scrollDepth, timeOnPage) when callers send them.
  app.post("/api/public-card/:slug/event", asyncHandler(async (req, res) => {
    const slug = req.params.slug;
    const { eventType, eventTarget, visitorId, sessionId, scrollDepth, timeOnPage, referrer } = req.body || {};
    if (typeof slug !== "string" || typeof eventType !== "string") {
      return res.status(400).json({ error: "slug and eventType required" });
    }
    if ((sessionId && String(sessionId).length > 200) || (visitorId && String(visitorId).length > 200)) {
      return res.status(400).json({ error: "id too long" });
    }
    if (typeof eventTarget === "string" && eventTarget.length > 1000) {
      return res.status(400).json({ error: "eventTarget too long" });
    }
    const r = await persistTrackEvent({
      slug,
      sessionId: sessionId ? String(sessionId) : null,
      visitorId: visitorId ? String(visitorId) : null,
      eventType,
      eventTarget: eventTarget ?? null,
      scrollDepth: typeof scrollDepth === "number" ? scrollDepth : null,
      timeOnPage: typeof timeOnPage === "number" ? timeOnPage : null,
      referrer: referrer ?? (req.headers.referer as string | undefined) ?? null,
      userAgent: (req.headers["user-agent"] as string) || "",
      ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "",
    });
    if ("error" in r) {
      const code = r.error === "not_found" ? 404 : r.error === "unavailable" ? 403 : 400;
      return res.status(code).json({ error: r.error });
    }
    res.json({ ok: true });
  }));

  // -------------------------------------------------------------------------
  // Session-aware tracking (Task #146): visitor sessions, scroll/time/click
  // events, and a server-computed intent score (0–100) → Cold/Warm/Hot tier.
  // -------------------------------------------------------------------------

  function parseUaForSession(ua: string): { deviceType: string; browser: string } {
    const u = ua.toLowerCase();
    let deviceType = "desktop";
    if (/ipad|tablet/.test(u)) deviceType = "tablet";
    else if (/mobile|android|iphone|ipod/.test(u)) deviceType = "mobile";
    let browser = "other";
    if (/edg\//.test(u)) browser = "Edge";
    else if (/chrome\//.test(u) && !/edg\//.test(u)) browser = "Chrome";
    else if (/safari\//.test(u) && !/chrome\//.test(u)) browser = "Safari";
    else if (/firefox\//.test(u)) browser = "Firefox";
    else if (/opera|opr\//.test(u)) browser = "Opera";
    return { deviceType, browser };
  }

  // Deterministic intent score (Task #146 stabilization).
  //   +40 if totalTime > 20s
  //   +30 if maxScrollDepth > 75%
  //   +20 if any contact click (CLICKY_TYPES)
  //   +10 if returnVisit
  // Tier: hot ≥ 71, warm 31–70, else cold.
  function computeIntent(opts: {
    totalTimeMs: number;
    maxScrollDepth: number;
    clickCount: number;
    returnVisit: boolean;
  }): { intentScore: number; leadTier: "cold" | "warm" | "hot" } {
    let s = 0;
    if (opts.totalTimeMs > 20_000) s += 40;
    if (opts.maxScrollDepth > 75) s += 30;
    if (opts.clickCount > 0) s += 20;
    if (opts.returnVisit) s += 10;
    const intentScore = Math.min(100, s);
    const leadTier = intentScore >= 71 ? "hot" : intentScore >= 31 ? "warm" : "cold";
    return { intentScore, leadTier };
  }

  async function loadAccessibleCardBySlug(slug: string) {
    const [card] = await db.select().from(digitalCards).where(eq(digitalCards.slug, slug)).limit(1);
    if (!card) return { error: "not_found" as const };
    if (!isCardAccessible(card)) return { error: "unavailable" as const };
    return { card };
  }

  app.post("/api/track/session", asyncHandler(async (req, res) => {
    const { slug, sessionId, visitorId, referrer } = req.body || {};
    if (typeof slug !== "string" || typeof sessionId !== "string") {
      return res.status(400).json({ error: "slug and sessionId required" });
    }
    if (sessionId.length > 200 || (visitorId && String(visitorId).length > 200)) {
      return res.status(400).json({ error: "id too long" });
    }
    const result = await loadAccessibleCardBySlug(slug.toLowerCase());
    if ("error" in result) {
      return res.status(result.error === "not_found" ? 404 : 403).json({ error: result.error });
    }
    const card = result.card;

    const ua = (req.headers["user-agent"] as string) || "";
    const { deviceType, browser } = parseUaForSession(ua);
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";
    const ipHash = ip ? crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16) : null;
    const country = (req.headers["x-vercel-ip-country"] as string) || (req.headers["cf-ipcountry"] as string) || null;
    const region = (req.headers["x-vercel-ip-country-region"] as string) || (req.headers["cf-region"] as string) || null;

    let returnVisit = false;
    if (visitorId) {
      const [prior] = await db.select({ id: cardAnalyticsSessions.id })
        .from(cardAnalyticsSessions)
        .where(and(eq(cardAnalyticsSessions.cardId, card.id), eq(cardAnalyticsSessions.visitorId, String(visitorId))))
        .limit(1);
      if (prior) returnVisit = true;
    }

    const [existing] = await db.select().from(cardAnalyticsSessions).where(eq(cardAnalyticsSessions.sessionId, sessionId)).limit(1);
    if (existing) {
      const [updated] = await db.update(cardAnalyticsSessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(cardAnalyticsSessions.sessionId, sessionId))
        .returning();
      return res.json({ ok: true, session: updated });
    }

    const [created] = await db.insert(cardAnalyticsSessions).values({
      sessionId,
      cardId: card.id,
      visitorId: visitorId ? String(visitorId) : null,
      referrer: typeof referrer === "string" ? referrer.slice(0, 500) : null,
      userAgent: ua.slice(0, 500),
      deviceType,
      browser,
      country,
      region,
      ipHash,
      returnVisit,
    }).returning();

    await db.update(digitalCards).set({ viewCount: sql`${digitalCards.viewCount} + 1` }).where(eq(digitalCards.id, card.id));
    return res.json({ ok: true, session: created });
  }));

  const TRACKED_EVENT_TYPES = new Set([
    "view", "scroll", "section_view",
    "click_phone", "click_email", "click_website", "click_booking",
    "click_social", "click_link", "click_review", "save_contact",
    "share", "qr_scan", "form_submit", "copy", "exit",
  ]);
  // Contact-intent clicks only — counted toward the session "clicks" aggregate
  // and the +20 intent bonus. share/qr_scan are still recorded as events
  // (and bump digital_cards.shareCount) but are not contact-intent signals.
  const CLICKY_TYPES = new Set([
    "click_phone", "click_email", "click_website", "click_booking",
    "click_social", "click_link", "click_review", "save_contact",
  ]);

  async function persistTrackEvent(payload: {
    slug: string;
    sessionId?: string | null;
    visitorId?: string | null;
    eventType: string;
    eventTarget?: string | null;
    scrollDepth?: number | null;
    timeOnPage?: number | null;
    referrer?: string | null;
    userAgent: string;
    ip: string;
  }) {
    const lookup = await loadAccessibleCardBySlug(payload.slug.toLowerCase());
    if ("error" in lookup) return { error: lookup.error };
    const card = lookup.card;
    if (!TRACKED_EVENT_TYPES.has(payload.eventType)) return { error: "invalid_type" };

    const ua = payload.userAgent || "";
    const { deviceType } = parseUaForSession(ua);
    const ipHash = payload.ip ? crypto.createHash("sha256").update(payload.ip).digest("hex").slice(0, 16) : null;

    await db.insert(cardAnalyticsEvents).values({
      cardId: card.id,
      sessionId: payload.sessionId || null,
      eventType: payload.eventType,
      eventTarget: payload.eventTarget ? String(payload.eventTarget).slice(0, 500) : null,
      visitorId: payload.visitorId || null,
      userAgent: ua.slice(0, 500) || null,
      referrer: payload.referrer ? String(payload.referrer).slice(0, 500) : null,
      ipHash,
      deviceType,
      scrollDepth: typeof payload.scrollDepth === "number" ? Math.max(0, Math.min(100, Math.round(payload.scrollDepth))) : null,
      timeOnPage: typeof payload.timeOnPage === "number" ? Math.max(0, Math.round(payload.timeOnPage)) : null,
    });

    if (payload.eventType === "share") {
      await db.update(digitalCards).set({ shareCount: sql`${digitalCards.shareCount} + 1` }).where(eq(digitalCards.id, card.id));
    }
    if (payload.eventType === "save_contact") {
      await db.update(digitalCards).set({ saveContactCount: sql`${digitalCards.saveContactCount} + 1` }).where(eq(digitalCards.id, card.id));
    }

    if (payload.sessionId) {
      const [session] = await db.select().from(cardAnalyticsSessions).where(eq(cardAnalyticsSessions.sessionId, payload.sessionId)).limit(1);
      if (session) {
        const newClickCount = CLICKY_TYPES.has(payload.eventType) ? session.clickCount + 1 : session.clickCount;
        const newScroll = typeof payload.scrollDepth === "number"
          ? Math.max(session.maxScrollDepth, Math.min(100, Math.round(payload.scrollDepth)))
          : session.maxScrollDepth;
        const newTime = typeof payload.timeOnPage === "number"
          ? Math.max(session.totalTimeMs, Math.round(payload.timeOnPage))
          : session.totalTimeMs;
        const { intentScore, leadTier } = computeIntent({
          totalTimeMs: newTime,
          maxScrollDepth: newScroll,
          clickCount: newClickCount,
          returnVisit: session.returnVisit,
        });
        await db.update(cardAnalyticsSessions).set({
          lastSeenAt: new Date(),
          clickCount: newClickCount,
          maxScrollDepth: newScroll,
          totalTimeMs: newTime,
          intentScore,
          leadTier,
        }).where(eq(cardAnalyticsSessions.sessionId, payload.sessionId));
      }
    }

    const evMap: Record<string, string> = { view: EVENT_TYPES.CARD_OPENED, qr_scan: EVENT_TYPES.CARD_SCANNED };
    const mappedType = evMap[payload.eventType];
    if (mappedType && card.subAccountId) {
      emitWithTimeline({
        eventType: mappedType,
        sourceModule: "cards",
        sourceTable: "card_analytics_events",
        sourceRecordId: String(card.id),
        subAccountId: card.subAccountId,
        metadata: { eventType: payload.eventType, eventTarget: payload.eventTarget, deviceType },
      });
    }
    return { ok: true };
  }

  app.post("/api/track/event", asyncHandler(async (req, res) => {
    const { slug, sessionId, visitorId, eventType, eventTarget, scrollDepth, timeOnPage, referrer } = req.body || {};
    if (typeof slug !== "string" || typeof eventType !== "string") {
      return res.status(400).json({ error: "slug and eventType required" });
    }
    if ((sessionId && String(sessionId).length > 200) || (visitorId && String(visitorId).length > 200)) {
      return res.status(400).json({ error: "id too long" });
    }
    if (eventType.length > 64 || (eventTarget && String(eventTarget).length > 1000)) {
      return res.status(400).json({ error: "payload too large" });
    }
    const r = await persistTrackEvent({
      slug, sessionId: sessionId ? String(sessionId) : null,
      visitorId: visitorId ? String(visitorId) : null,
      eventType, eventTarget: eventTarget ?? null,
      scrollDepth: typeof scrollDepth === "number" ? scrollDepth : null,
      timeOnPage: typeof timeOnPage === "number" ? timeOnPage : null,
      referrer: referrer ?? (req.headers.referer as string | undefined) ?? null,
      userAgent: (req.headers["user-agent"] as string) || "",
      ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "",
    });
    if ("error" in r) {
      const code = r.error === "not_found" ? 404 : r.error === "unavailable" ? 403 : 400;
      return res.status(code).json({ error: r.error });
    }
    res.json({ ok: true });
  }));

  app.get("/api/cards/:id/sessions", asyncHandler(async (req, res) => {
    const cardId = parseIntParam(req.params.id, "id");
    const [card] = await db.select({ id: digitalCards.id, subAccountId: digitalCards.subAccountId }).from(digitalCards).where(eq(digitalCards.id, cardId)).limit(1);
    if (!card) return res.status(404).json({ error: "Card not found" });
    if (!card.subAccountId) return res.status(403).json({ error: "Not a platform card" });
    if (!(await verifyAccountOwnership(req, res, card.subAccountId))) return;

    const limit = Math.min(500, Math.max(1, parseInt((req.query.limit as string) || "100")));
    const sessions = await db.select().from(cardAnalyticsSessions)
      .where(eq(cardAnalyticsSessions.cardId, cardId))
      .orderBy(desc(cardAnalyticsSessions.lastSeenAt))
      .limit(limit);

    // Compute "top action" per session from its events: highest-priority click,
    // else "scroll" if any scroll milestone, else "view".
    const sessionIds = sessions.map(s => s.sessionId).filter(Boolean) as string[];
    const topActionBySession = new Map<string, string>();
    if (sessionIds.length > 0) {
      const events = await db.select({ sessionId: cardAnalyticsEvents.sessionId, eventType: cardAnalyticsEvents.eventType })
        .from(cardAnalyticsEvents)
        .where(sql`${cardAnalyticsEvents.sessionId} = ANY(${sessionIds})`);
      const priority: Record<string, number> = {
        save_contact: 100, click_booking: 90, click_phone: 80, click_email: 70,
        click_review: 60, click_website: 50, click_link: 40, click_social: 30,
        share: 25, qr_scan: 20, scroll: 10, view: 1,
      };
      for (const ev of events) {
        const sid = ev.sessionId; if (!sid) continue;
        const cur = topActionBySession.get(sid);
        const newRank = priority[ev.eventType] || 0;
        const curRank = cur ? (priority[cur] || 0) : -1;
        if (newRank > curRank) topActionBySession.set(sid, ev.eventType);
      }
    }
    const enriched = sessions.map(s => ({ ...s, topAction: topActionBySession.get(s.sessionId) || "view" }));
    res.json({ sessions: enriched });
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
