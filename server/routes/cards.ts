import type { Express, Request, Response } from "express";
import { digitalCards } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import crypto from "crypto";
import { asyncHandler, parseIntParam, verifyAccountOwnership } from "./helpers";

export function registerCardsRoutes(app: Express) {
  // ---- TapCard Checkout ----
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
      metadata: {
        plan: plan,
        planTier: planTier,
        source: "tapcard_funnel",
      },
      success_url: `${baseUrl}/digital-card-builder?checkout=success`,
      cancel_url: `${baseUrl}/cards?checkout=cancelled`,
      payment_method_collection: "always",
    });

    res.json({ url: session.url });
  }));

  // ---- Digital Business Cards ----
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
    const { name, title, company, phone, email, website, bio, photoUrl, googleReviewLink, slug, links, theme } = req.body;
    const existing = await db.select().from(digitalCards).where(eq(digitalCards.subAccountId, subAccountId)).limit(1);
    if (existing.length > 0) {
      const [updated] = await db.update(digitalCards).set({
        name, title, company, phone, email, website, bio, photoUrl, googleReviewLink, slug, links, theme, updatedAt: new Date(),
      }).where(eq(digitalCards.subAccountId, subAccountId)).returning();
      res.json(updated);
    } else {
      const [created] = await db.insert(digitalCards).values({
        subAccountId, name, title, company, phone, email, website, bio, photoUrl, googleReviewLink, slug, links, theme,
      }).returning();
      res.json(created);
    }
  }));

  // Public card viewer by slug
  app.get("/api/public-card/:slug", asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const [card] = await db.select().from(digitalCards).where(eq(digitalCards.slug, slug)).limit(1);
    if (!card) return res.status(404).json({ error: "Card not found" });
    res.json(card);
  }));

  // ---- Portal Tokens ----
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
      subAccountId,
      token,
      label: label || "Client Portal Link",
      active: true,
    });
    res.json(portalToken);
  }));

  app.delete("/api/portal-tokens/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    await storage.deletePortalToken(id);
    res.json({ ok: true });
  }));

  // ---- Public Portal (no auth) ----
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
      accountName: account.name,
      industry: account.industry,
      metrics: {
        totalMessages: msgs.length,
        totalContacts: contactsList.length,
        totalDeals: dealsList.length,
        totalDealValue: dealsList.reduce((s, d) => s + (d.value || 0), 0),
        upcomingAppointments: appts.filter(a => a.status === "scheduled").length,
      },
      recentMessages: msgs.slice(0, 10),
      upcomingAppointments: appts.filter(a => a.status === "scheduled").slice(0, 10),
    });
  }));
}
