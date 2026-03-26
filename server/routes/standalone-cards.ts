import type { Express, Request, Response } from "express";
import {
  standaloneCardUsers, standaloneCards, standaloneOrders,
  standaloneReferralCodes, standaloneReferrals,
} from "@shared/schema";
import { db } from "../db";
import { eq, sql, and, or, desc, ilike } from "drizzle-orm";
import crypto from "crypto";
import { asyncHandler } from "./helpers";

const CARD_PRICE_CENTS = 4900;
const PROMO_PRICE_CENTS = 2450;
const PROMO_LIMIT = 20;
const COMMISSION_CENTS = 1000;
const ADMIN_SECRET = process.env.STANDALONE_ADMIN_SECRET || "apex-admin-2024";

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

function generateReferralCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

export async function handleStandaloneCardWebhook(session: any) {
  const meta = session.metadata || {};
  const referralCode = meta.referralCode || null;

  let cardData: any;
  if (meta.cardData) {
    cardData = JSON.parse(meta.cardData);
  } else {
    const socials = meta.cd_socials ? JSON.parse(meta.cd_socials) : {};
    let customLinks = null;
    try { customLinks = meta.cd_customLinks ? JSON.parse(meta.cd_customLinks) : null; } catch {}
    cardData = {
      fullName: meta.cd_fullName || "",
      email: meta.cd_email || "",
      phone: meta.cd_phone || "",
      businessName: meta.cd_businessName || "",
      title: meta.cd_title || "",
      website: meta.cd_website || "",
      address: meta.cd_address || "",
      bio: meta.cd_bio || "",
      profileImageUrl: meta.cd_profileImageUrl || "",
      logoUrl: meta.cd_logoUrl || "",
      reviewLink: meta.cd_reviewLink || "",
      bookingLink: meta.cd_bookingLink || "",
      themeColor: meta.cd_themeColor || "#0ea5e9",
      instagramUrl: socials.instagramUrl || "",
      facebookUrl: socials.facebookUrl || "",
      tiktokUrl: socials.tiktokUrl || "",
      linkedinUrl: socials.linkedinUrl || "",
      youtubeUrl: socials.youtubeUrl || "",
      customLinks,
    };
  }

  if (!cardData.email) return;

  let [existingUser] = await db.select().from(standaloneCardUsers)
    .where(eq(standaloneCardUsers.email, cardData.email)).limit(1);

  if (!existingUser) {
    [existingUser] = await db.insert(standaloneCardUsers).values({
      name: cardData.fullName,
      email: cardData.email,
      phone: cardData.phone || null,
    }).returning();
  }

  const [existingOrder] = await db.select().from(standaloneOrders)
    .where(eq(standaloneOrders.stripeCheckoutSessionId, session.id)).limit(1);
  if (existingOrder) return;

  let slug = generateSlug(cardData.fullName);
  const [slugConflict] = await db.select({ id: standaloneCards.id })
    .from(standaloneCards).where(eq(standaloneCards.slug, slug)).limit(1);
  if (slugConflict) {
    slug = slug + "-" + crypto.randomBytes(2).toString("hex");
  }

  const editToken = crypto.randomBytes(32).toString("hex");
  await db.insert(standaloneCards).values({
    userId: existingUser.id,
    slug,
    fullName: cardData.fullName,
    businessName: cardData.businessName || null,
    title: cardData.title || null,
    phone: cardData.phone || null,
    email: cardData.email,
    website: cardData.website || null,
    address: cardData.address || null,
    bio: cardData.bio || null,
    profileImageUrl: cardData.profileImageUrl || null,
    logoUrl: cardData.logoUrl || null,
    reviewLink: cardData.reviewLink || null,
    bookingLink: cardData.bookingLink || null,
    instagramUrl: cardData.instagramUrl || null,
    facebookUrl: cardData.facebookUrl || null,
    tiktokUrl: cardData.tiktokUrl || null,
    linkedinUrl: cardData.linkedinUrl || null,
    youtubeUrl: cardData.youtubeUrl || null,
    customLinks: cardData.customLinks || null,
    themeColor: cardData.themeColor || "#0ea5e9",
    editToken,
    published: true,
  });

  const [order] = await db.insert(standaloneOrders).values({
    userId: existingUser.id,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: session.payment_intent || null,
    amount: session.amount_total || CARD_PRICE_CENTS,
    paymentStatus: "paid",
    referralCodeUsed: referralCode,
  }).returning();

  const [existingRefCode] = await db.select().from(standaloneReferralCodes)
    .where(eq(standaloneReferralCodes.userId, existingUser.id)).limit(1);
  if (!existingRefCode) {
    await db.insert(standaloneReferralCodes).values({
      userId: existingUser.id,
      code: generateReferralCode(),
      active: true,
    });
  }

  if (referralCode) {
    const [refCodeRecord] = await db.select().from(standaloneReferralCodes)
      .where(and(
        eq(standaloneReferralCodes.code, referralCode),
        eq(standaloneReferralCodes.active, true),
      )).limit(1);

    if (refCodeRecord && refCodeRecord.userId !== existingUser.id) {
      const [referrerUser] = await db.select().from(standaloneCardUsers)
        .where(eq(standaloneCardUsers.id, refCodeRecord.userId)).limit(1);

      if (referrerUser && referrerUser.email !== cardData.email) {
        const [existingReferral] = await db.select().from(standaloneReferrals)
          .where(eq(standaloneReferrals.referredOrderId, order.id)).limit(1);

        if (!existingReferral) {
          await db.insert(standaloneReferrals).values({
            referrerUserId: refCodeRecord.userId,
            referredUserId: existingUser.id,
            referredOrderId: order.id,
            commissionAmount: COMMISSION_CENTS,
            status: "pending",
          });
        }
      }
    }
  }
}

function generateVCard(card: any, baseUrl?: string): string {
  const lines = [
    "BEGIN:VCARD", "VERSION:3.0",
    `FN:${card.fullName || ""}`,
    `N:${(card.fullName || "").split(" ").reverse().join(";")};;;`,
  ];
  if (card.title) lines.push(`TITLE:${card.title}`);
  if (card.businessName) lines.push(`ORG:${card.businessName}`);
  if (card.phone) lines.push(`TEL;TYPE=CELL:${card.phone}`);
  if (card.email) lines.push(`EMAIL;TYPE=INTERNET:${card.email}`);
  if (card.website) lines.push(`URL;TYPE=WORK:${card.website}`);
  if (card.slug && baseUrl) lines.push(`URL;TYPE=HOME:${baseUrl}/standalone/card/${card.slug}`);
  if (card.address) lines.push(`ADR;TYPE=WORK:;;${card.address};;;;`);
  const noteLines: string[] = [];
  if (card.bio) noteLines.push(card.bio.replace(/\n/g, "\\n"));
  if (card.slug && baseUrl) noteLines.push(`Digital Card: ${baseUrl}/standalone/card/${card.slug}`);
  if (noteLines.length) lines.push(`NOTE:${noteLines.join("\\n")}`);
  if (card.profileImageUrl) lines.push(`PHOTO;VALUE=URI:${card.profileImageUrl}`);
  if (card.instagramUrl) lines.push(`X-SOCIALPROFILE;TYPE=instagram:${card.instagramUrl}`);
  if (card.facebookUrl) lines.push(`X-SOCIALPROFILE;TYPE=facebook:${card.facebookUrl}`);
  if (card.linkedinUrl) lines.push(`X-SOCIALPROFILE;TYPE=linkedin:${card.linkedinUrl}`);
  if (card.tiktokUrl) lines.push(`X-SOCIALPROFILE;TYPE=tiktok:${card.tiktokUrl}`);
  if (card.youtubeUrl) lines.push(`X-SOCIALPROFILE;TYPE=youtube:${card.youtubeUrl}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export function registerStandaloneCardsRoutes(app: Express) {

  app.get("/api/standalone/promo-status", asyncHandler(async (_req, res) => {
    const [result] = await db.select({ count: sql<number>`count(*)` })
      .from(standaloneOrders)
      .where(eq(standaloneOrders.paymentStatus, "paid"));
    const paidCount = Number(result.count);
    res.json({
      promoActive: paidCount < PROMO_LIMIT,
      spotsTaken: paidCount,
      spotsTotal: PROMO_LIMIT,
      spotsLeft: Math.max(0, PROMO_LIMIT - paidCount),
      regularPrice: CARD_PRICE_CENTS,
      promoPrice: PROMO_PRICE_CENTS,
    });
  }));

  app.post("/api/standalone/check-slug", asyncHandler(async (req, res) => {
    const { slug } = req.body;
    const normalized = slug?.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 64);
    if (!normalized || normalized.length < 2) return res.json({ available: false });
    const reserved = ["admin", "api", "card", "cards", "create", "preview", "checkout", "success", "dashboard"];
    if (reserved.includes(normalized)) return res.json({ available: false });
    const [existing] = await db.select({ id: standaloneCards.id })
      .from(standaloneCards).where(eq(standaloneCards.slug, normalized)).limit(1);
    res.json({ available: !existing });
  }));

  app.post("/api/standalone/create-checkout", asyncHandler(async (req, res) => {
    const { cardData, referralCode } = req.body;
    if (!cardData?.fullName || !cardData?.email) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    const { getUncachableStripeClient } = await import("../stripeClient");
    const stripe = await getUncachableStripeClient();

    const [paidResult] = await db.select({ count: sql<number>`count(*)` })
      .from(standaloneOrders)
      .where(eq(standaloneOrders.paymentStatus, "paid"));
    const paidCount = Number(paidResult.count);
    const priceInCents = paidCount < PROMO_LIMIT ? PROMO_PRICE_CENTS : CARD_PRICE_CENTS;

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const meta: Record<string, string> = {
      source: "standalone_card",
      referralCode: referralCode || "",
      cd_fullName: (cardData.fullName || "").slice(0, 500),
      cd_email: (cardData.email || "").slice(0, 500),
      cd_phone: (cardData.phone || "").slice(0, 500),
      cd_businessName: (cardData.businessName || "").slice(0, 500),
      cd_title: (cardData.title || "").slice(0, 500),
      cd_website: (cardData.website || "").slice(0, 500),
      cd_address: (cardData.address || "").slice(0, 500),
      cd_bio: (cardData.bio || "").slice(0, 500),
      cd_profileImageUrl: (cardData.profileImageUrl || "").slice(0, 500),
      cd_logoUrl: (cardData.logoUrl || "").slice(0, 500),
      cd_reviewLink: (cardData.reviewLink || "").slice(0, 500),
      cd_bookingLink: (cardData.bookingLink || "").slice(0, 500),
      cd_themeColor: (cardData.themeColor || "#0ea5e9").slice(0, 500),
    };
    const socialUrls = JSON.stringify({
      instagramUrl: cardData.instagramUrl || "",
      facebookUrl: cardData.facebookUrl || "",
      tiktokUrl: cardData.tiktokUrl || "",
      linkedinUrl: cardData.linkedinUrl || "",
      youtubeUrl: cardData.youtubeUrl || "",
    });
    meta.cd_socials = socialUrls.slice(0, 500);
    if (cardData.customLinks && cardData.customLinks.length > 0) {
      meta.cd_customLinks = JSON.stringify(cardData.customLinks).slice(0, 500);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: cardData.email,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: "Digital Business Card",
            description: paidCount < PROMO_LIMIT
              ? "50% Launch Discount — Limited Time"
              : "One-time purchase — yours forever",
          },
          unit_amount: priceInCents,
        },
        quantity: 1,
      }],
      metadata: meta,
      success_url: `${baseUrl}/standalone/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/standalone/preview`,
    });

    res.json({ url: session.url, sessionId: session.id });
  }));

  app.get("/api/standalone/session/:sessionId", asyncHandler(async (req, res) => {
    const { getUncachableStripeClient } = await import("../stripeClient");
    const stripe = await getUncachableStripeClient();

    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    if (session.metadata?.source !== "standalone_card") {
      return res.status(404).json({ error: "Session not found" });
    }

    const email = session.metadata.cd_email || session.customer_email || "";

    let [user] = await db.select().from(standaloneCardUsers)
      .where(eq(standaloneCardUsers.email, email)).limit(1);

    if (!user && session.payment_status === "paid") {
      try {
        await handleStandaloneCardWebhook(session);
        [user] = await db.select().from(standaloneCardUsers)
          .where(eq(standaloneCardUsers.email, email)).limit(1);
      } catch (e: any) {
        console.error("[STANDALONE] Fallback fulfillment error:", e.message);
      }
    }

    if (!user) {
      return res.json({ status: "processing", message: "Payment is being processed" });
    }

    const [card] = await db.select().from(standaloneCards)
      .where(eq(standaloneCards.userId, user.id)).orderBy(desc(standaloneCards.createdAt)).limit(1);

    const [refCode] = await db.select().from(standaloneReferralCodes)
      .where(eq(standaloneReferralCodes.userId, user.id)).limit(1);

    res.json({
      status: session.payment_status === "paid" ? "complete" : "processing",
      card,
      referralCode: refCode?.code,
      email: user.email,
    });
  }));

  app.get("/api/standalone/card/:slug", asyncHandler(async (req, res) => {
    const slug = req.params.slug.toLowerCase();
    const [card] = await db.select().from(standaloneCards)
      .where(and(eq(standaloneCards.slug, slug), eq(standaloneCards.published, true))).limit(1);
    if (!card) return res.status(404).json({ error: "Card not found" });

    const [refCode] = await db.select().from(standaloneReferralCodes)
      .where(eq(standaloneReferralCodes.userId, card.userId)).limit(1);

    res.json({ ...card, referralCode: refCode?.code });
  }));

  app.get("/api/standalone/card/:slug/vcard", asyncHandler(async (req, res) => {
    const slug = req.params.slug.toLowerCase();
    const [card] = await db.select().from(standaloneCards)
      .where(and(eq(standaloneCards.slug, slug), eq(standaloneCards.published, true))).limit(1);
    if (!card) return res.status(404).json({ error: "Card not found" });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const vcard = generateVCard(card, baseUrl);
    const filename = `${(card.fullName || "contact").replace(/\s+/g, "_")}.vcf`;
    res.setHeader("Content-Type", "text/vcard; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(vcard);
  }));

  app.get("/api/standalone/card-edit/:token", asyncHandler(async (req, res) => {
    const token = req.params.token;
    if (!token || token.length < 20) return res.status(400).json({ error: "Invalid token" });

    const [card] = await db.select().from(standaloneCards)
      .where(eq(standaloneCards.editToken, token)).limit(1);
    if (!card) return res.status(404).json({ error: "Card not found or invalid edit link" });

    res.json(card);
  }));

  app.put("/api/standalone/card-edit/:token", asyncHandler(async (req, res) => {
    const token = req.params.token;
    if (!token || token.length < 20) return res.status(400).json({ error: "Invalid token" });

    const [card] = await db.select().from(standaloneCards)
      .where(eq(standaloneCards.editToken, token)).limit(1);
    if (!card) return res.status(404).json({ error: "Card not found or invalid edit link" });

    const { updates } = req.body;
    if (!updates) return res.status(400).json({ error: "No updates provided" });

    const allowed: Record<string, any> = {};
    const fields = ["fullName","businessName","title","phone","website","address","bio",
      "profileImageUrl","logoUrl","reviewLink","bookingLink","instagramUrl","facebookUrl",
      "tiktokUrl","linkedinUrl","youtubeUrl","customLinks","themeColor"];
    for (const f of fields) {
      if (f in updates) allowed[f] = updates[f];
    }
    allowed.updatedAt = new Date();

    await db.update(standaloneCards).set(allowed).where(eq(standaloneCards.id, card.id));
    const [updated] = await db.select().from(standaloneCards).where(eq(standaloneCards.id, card.id)).limit(1);
    res.json(updated);
  }));

  app.post("/api/standalone/dashboard", asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const [user] = await db.select().from(standaloneCardUsers)
      .where(eq(standaloneCardUsers.email, email.toLowerCase().trim())).limit(1);
    if (!user) return res.status(404).json({ error: "No account found with that email" });

    let cards = await db.select().from(standaloneCards)
      .where(eq(standaloneCards.userId, user.id)).orderBy(desc(standaloneCards.createdAt));

    for (const c of cards) {
      if (!c.editToken) {
        const newToken = crypto.randomBytes(32).toString("hex");
        await db.update(standaloneCards).set({ editToken: newToken }).where(eq(standaloneCards.id, c.id));
        (c as any).editToken = newToken;
      }
    }

    const [refCode] = await db.select().from(standaloneReferralCodes)
      .where(eq(standaloneReferralCodes.userId, user.id)).limit(1);

    const referrals = await db.select().from(standaloneReferrals)
      .where(eq(standaloneReferrals.referrerUserId, user.id))
      .orderBy(desc(standaloneReferrals.createdAt));

    const pending = referrals.filter(r => r.status === "pending")
      .reduce((s, r) => s + r.commissionAmount, 0);
    const approved = referrals.filter(r => r.status === "approved")
      .reduce((s, r) => s + r.commissionAmount, 0);
    const paid = referrals.filter(r => r.status === "paid")
      .reduce((s, r) => s + r.commissionAmount, 0);

    res.json({
      user,
      cards,
      referralCode: refCode?.code,
      referralStats: {
        totalReferrals: referrals.length,
        pendingEarnings: pending,
        approvedEarnings: approved,
        paidEarnings: paid,
      },
    });
  }));

  // ---- Admin Routes ----

  app.get("/api/standalone/admin/orders", asyncHandler(async (req, res) => {
    const secret = req.headers["x-admin-secret"];
    if (secret !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    const search = (req.query.search as string) || "";
    let orders;
    if (search) {
      const users = await db.select().from(standaloneCardUsers)
        .where(or(
          ilike(standaloneCardUsers.email, `%${search}%`),
          ilike(standaloneCardUsers.name, `%${search}%`),
        ));
      const userIds = users.map(u => u.id);
      if (userIds.length === 0) return res.json([]);
      orders = await db.select().from(standaloneOrders)
        .where(sql`${standaloneOrders.userId} = ANY(${userIds})`)
        .orderBy(desc(standaloneOrders.createdAt));
    } else {
      orders = await db.select().from(standaloneOrders)
        .orderBy(desc(standaloneOrders.createdAt));
    }

    const enriched = await Promise.all(orders.map(async (o) => {
      const [user] = await db.select().from(standaloneCardUsers)
        .where(eq(standaloneCardUsers.id, o.userId)).limit(1);
      return { ...o, user };
    }));
    res.json(enriched);
  }));

  app.get("/api/standalone/admin/referrals", asyncHandler(async (req, res) => {
    const secret = req.headers["x-admin-secret"];
    if (secret !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    const referrals = await db.select().from(standaloneReferrals)
      .orderBy(desc(standaloneReferrals.createdAt));

    const enriched = await Promise.all(referrals.map(async (r) => {
      const [referrer] = await db.select().from(standaloneCardUsers)
        .where(eq(standaloneCardUsers.id, r.referrerUserId)).limit(1);
      const [referred] = await db.select().from(standaloneCardUsers)
        .where(eq(standaloneCardUsers.id, r.referredUserId)).limit(1);
      return { ...r, referrer, referred };
    }));
    res.json(enriched);
  }));

  app.get("/api/standalone/admin/users", asyncHandler(async (req, res) => {
    const secret = req.headers["x-admin-secret"];
    if (secret !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });
    const users = await db.select().from(standaloneCardUsers).orderBy(desc(standaloneCardUsers.createdAt));
    res.json(users);
  }));

  app.get("/api/standalone/admin/cards", asyncHandler(async (req, res) => {
    const secret = req.headers["x-admin-secret"];
    if (secret !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });
    const cards = await db.select().from(standaloneCards).orderBy(desc(standaloneCards.createdAt));
    res.json(cards);
  }));

  app.post("/api/standalone/admin/referrals/:id/approve", asyncHandler(async (req, res) => {
    const secret = req.headers["x-admin-secret"];
    if (secret !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    const id = parseInt(req.params.id);
    await db.update(standaloneReferrals)
      .set({ status: "approved" })
      .where(and(eq(standaloneReferrals.id, id), eq(standaloneReferrals.status, "pending")));
    res.json({ ok: true });
  }));

  app.post("/api/standalone/admin/referrals/:id/pay", asyncHandler(async (req, res) => {
    const secret = req.headers["x-admin-secret"];
    if (secret !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    const id = parseInt(req.params.id);
    await db.update(standaloneReferrals)
      .set({ status: "paid", paidAt: new Date() })
      .where(and(eq(standaloneReferrals.id, id), eq(standaloneReferrals.status, "approved")));
    res.json({ ok: true });
  }));

  app.post("/api/standalone/admin/create-card", asyncHandler(async (req, res) => {
    const secret = req.headers["x-admin-secret"];
    if (secret !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    const { cardData } = req.body;
    if (!cardData?.fullName || !cardData?.email) return res.status(400).json({ error: "Name and email required" });

    let [user] = await db.select().from(standaloneCardUsers)
      .where(eq(standaloneCardUsers.email, cardData.email)).limit(1);
    if (!user) {
      [user] = await db.insert(standaloneCardUsers).values({
        name: cardData.fullName, email: cardData.email, phone: cardData.phone || null,
      }).returning();
    }

    let slug = generateSlug(cardData.fullName);
    const [conflict] = await db.select({ id: standaloneCards.id }).from(standaloneCards).where(eq(standaloneCards.slug, slug)).limit(1);
    if (conflict) slug = slug + "-" + crypto.randomBytes(2).toString("hex");

    const adminEditToken = crypto.randomBytes(32).toString("hex");
    const [card] = await db.insert(standaloneCards).values({
      userId: user.id, slug, fullName: cardData.fullName,
      businessName: cardData.businessName || null, title: cardData.title || null,
      phone: cardData.phone || null, email: cardData.email,
      website: cardData.website || null, address: cardData.address || null,
      bio: cardData.bio || null, profileImageUrl: cardData.profileImageUrl || null,
      logoUrl: cardData.logoUrl || null, reviewLink: cardData.reviewLink || null,
      bookingLink: cardData.bookingLink || null, instagramUrl: cardData.instagramUrl || null,
      facebookUrl: cardData.facebookUrl || null, tiktokUrl: cardData.tiktokUrl || null,
      linkedinUrl: cardData.linkedinUrl || null, youtubeUrl: cardData.youtubeUrl || null,
      customLinks: cardData.customLinks || null, themeColor: cardData.themeColor || "#0ea5e9",
      editToken: adminEditToken,
      published: true,
    }).returning();

    const refCode = generateReferralCode();
    await db.insert(standaloneReferralCodes).values({ userId: user.id, code: refCode, active: true }).onConflictDoNothing();

    res.json({ card, referralCode: refCode });
  }));

  app.get("/api/standalone/admin/stats", asyncHandler(async (req, res) => {
    const secret = req.headers["x-admin-secret"];
    if (secret !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    const [userCount] = await db.select({ count: sql<number>`count(*)` }).from(standaloneCardUsers);
    const [cardCount] = await db.select({ count: sql<number>`count(*)` }).from(standaloneCards);
    const [orderCount] = await db.select({ count: sql<number>`count(*)` }).from(standaloneOrders).where(eq(standaloneOrders.paymentStatus, "paid"));
    const [referralCount] = await db.select({ count: sql<number>`count(*)` }).from(standaloneReferrals);
    const [revenue] = await db.select({ total: sql<number>`coalesce(sum(amount), 0)` }).from(standaloneOrders).where(eq(standaloneOrders.paymentStatus, "paid"));

    res.json({
      users: Number(userCount.count),
      cards: Number(cardCount.count),
      paidOrders: Number(orderCount.count),
      referrals: Number(referralCount.count),
      totalRevenue: Number(revenue.total),
    });
  }));
}
