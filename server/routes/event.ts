import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, desc, eq, sql as sqlOp, gt } from "drizzle-orm";
import { db } from "../db";
import { asyncHandler, isUserAdmin } from "./helpers";
import { getStripeSync } from "../stripeClient";
import {
  eventCampaigns,
  eventCardFulfillment,
  digitalCards,
  TRIAL_DAYS_DEFAULT,
} from "@shared/schema";
import { emitUniversalEvent } from "../intelligence/eventEmitter";
import crypto from "crypto";

const DEFAULT_CAMPAIGN_SLUG = "live-event-2026";

let cachedStarterPriceId: string | null = process.env.STRIPE_STARTER_PRICE_ID || null;

async function ensureStarterPriceId(stripe: any): Promise<string> {
  if (cachedStarterPriceId) return cachedStarterPriceId;
  const search = await stripe.products.search({
    query: "metadata['tier']:'starter' AND active:'true'",
    limit: 5,
  }).catch(() => ({ data: [] as any[] }));
  let product = search.data?.[0];
  if (!product) {
    product = await stripe.products.create({
      name: "Apex Starter",
      description: "Apex Starter monthly plan ($97/month) — auto-provisioned for event signups.",
      metadata: { tier: "starter", category: "subscription", autoCreated: "event" },
    });
  }
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 20 });
  let price = prices.data.find(
    (p: any) => p.unit_amount === 9700 && p.recurring?.interval === "month" && p.currency === "usd"
  );
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: 9700,
      recurring: { interval: "month" },
      nickname: "Starter Monthly",
    });
  }
  cachedStarterPriceId = price.id;
  return price.id;
}

async function getOrCreateDefaultCampaign() {
  const existing = await db.select().from(eventCampaigns).where(eq(eventCampaigns.slug, DEFAULT_CAMPAIGN_SLUG)).limit(1);
  if (existing[0]) return existing[0];
  const endsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [created] = await db.insert(eventCampaigns).values({
    slug: DEFAULT_CAMPAIGN_SLUG,
    name: "Live Event Campaign",
    totalInventory: 50,
    remainingInventory: 50,
    trialDays: TRIAL_DAYS_DEFAULT,
    defaultPlan: "starter",
    postTrialAmountCents: 9700,
    isActive: true,
    endsAt,
  }).returning();
  console.log(`[EVENT] Bootstrapped default campaign #${created.id} (${created.slug}), inventory=${created.remainingInventory}`);
  return created;
}

function makeSlug(fullName: string, email: string): string {
  const base = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24);
  const hash = crypto.createHash("sha1").update(`${email}:${Date.now()}`).digest("hex").slice(0, 6);
  return `${base || "card"}-${hash}`;
}

const signupSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email().max(180),
  shippingStreet: z.string().min(3).max(200),
  shippingCity: z.string().min(1).max(80),
  shippingState: z.string().min(1).max(60),
  shippingZip: z.string().min(3).max(20),
  shippingCountry: z.string().min(2).max(60).default("US"),
  campaignSlug: z.string().optional(),
});

export function registerEventRoutes(app: Express) {
  // Public — Stripe publishable key for the event signup form (no secrets)
  app.get("/api/event/config", (_req, res) => {
    const key = process.env.STRIPE_PUBLISHABLE_KEY || "";
    if (!key) return res.status(500).json({ error: "Stripe publishable key not configured" });
    res.json({ publishableKey: key });
  });

  // Public — live inventory counter
  app.get("/api/event/inventory", asyncHandler(async (req: Request, res: Response) => {
    const slug = (req.query.slug as string) || DEFAULT_CAMPAIGN_SLUG;
    let campaign = (await db.select().from(eventCampaigns).where(eq(eventCampaigns.slug, slug)).limit(1))[0];
    if (!campaign && slug === DEFAULT_CAMPAIGN_SLUG) {
      campaign = await getOrCreateDefaultCampaign();
    }
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const isOpen = campaign.isActive
      && campaign.remainingInventory > 0
      && (!campaign.endsAt || new Date(campaign.endsAt).getTime() > Date.now());
    res.json({
      campaignId: campaign.id,
      slug: campaign.slug,
      name: campaign.name,
      total: campaign.totalInventory,
      remaining: campaign.remainingInventory,
      trialDays: campaign.trialDays,
      postTrialAmountCents: campaign.postTrialAmountCents,
      isOpen,
      endsAt: campaign.endsAt,
    });
  }));

  // Public — start signup. Creates Stripe customer + setup_intent, stores
  // pending fulfillment row. Returns clientSecret for Stripe Elements.
  app.post("/api/event/signup", asyncHandler(async (req: Request, res: Response) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;

    const campaign = data.campaignSlug
      ? (await db.select().from(eventCampaigns).where(eq(eventCampaigns.slug, data.campaignSlug)).limit(1))[0]
      : await getOrCreateDefaultCampaign();
    if (!campaign || !campaign.isActive) return res.status(404).json({ error: "Campaign not active" });
    if (campaign.remainingInventory <= 0) return res.status(409).json({ error: "All cards claimed" });

    const stripeSync = await getStripeSync();
    const stripe = (stripeSync as any).stripe;

    const customer = await stripe.customers.create({
      email: data.email,
      name: data.fullName,
      shipping: {
        name: data.fullName,
        address: {
          line1: data.shippingStreet,
          city: data.shippingCity,
          state: data.shippingState,
          postal_code: data.shippingZip,
          country: data.shippingCountry,
        },
      },
      address: {
        line1: data.shippingStreet,
        city: data.shippingCity,
        state: data.shippingState,
        postal_code: data.shippingZip,
        country: data.shippingCountry,
      },
      metadata: {
        source: "event",
        campaignId: String(campaign.id),
        campaignSlug: campaign.slug,
      },
    });

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: {
        source: "event",
        campaignId: String(campaign.id),
        email: data.email,
      },
    });

    const [fulfillment] = await db.insert(eventCardFulfillment).values({
      campaignId: campaign.id,
      email: data.email,
      fullName: data.fullName,
      shippingStreet: data.shippingStreet,
      shippingCity: data.shippingCity,
      shippingState: data.shippingState,
      shippingZip: data.shippingZip,
      shippingCountry: data.shippingCountry,
      status: "pending",
      paymentMethodValidated: false,
      stripeCustomerId: customer.id,
      stripeSetupIntentId: setupIntent.id,
      acquisitionTag: "event",
    }).returning();

    emitUniversalEvent({
      eventType: "event.signup.started",
      sourceModule: "event",
      sourceTable: "event_card_fulfillment",
      sourceId: fulfillment.id,
      payload: { campaignId: campaign.id, email: data.email },
    });

    res.json({
      fulfillmentId: fulfillment.id,
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
    });
  }));

  // Public — finalize after client confirms setup_intent. Idempotent and
  // mirrored by the setup_intent.succeeded webhook so either path works.
  app.post("/api/event/finalize", asyncHandler(async (req: Request, res: Response) => {
    const { setupIntentId } = z.object({ setupIntentId: z.string() }).parse(req.body);
    const result = await validateAndProvision(setupIntentId);
    res.json(result);
  }));

  // Admin — list signups for the operator console.
  app.get("/api/event/admin/signups", asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Forbidden" });

    const slug = (req.query.slug as string) || DEFAULT_CAMPAIGN_SLUG;
    const campaign = (await db.select().from(eventCampaigns).where(eq(eventCampaigns.slug, slug)).limit(1))[0];
    if (!campaign) return res.json({ campaign: null, signups: [] });

    const signups = await db.select().from(eventCardFulfillment)
      .where(eq(eventCardFulfillment.campaignId, campaign.id))
      .orderBy(desc(eventCardFulfillment.createdAt))
      .limit(200);

    res.json({ campaign, signups });
  }));

  // Admin — mark a card as programmed/delivered. Creates the digital_cards
  // row at programming time so the NFC URL resolves immediately.
  app.post("/api/event/admin/fulfillment/:id/programmed", asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Forbidden" });

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const f = (await db.select().from(eventCardFulfillment).where(eq(eventCardFulfillment.id, id)).limit(1))[0];
    if (!f) return res.status(404).json({ error: "Not found" });
    if (!f.paymentMethodValidated) return res.status(400).json({ error: "Payment not yet validated" });

    let digitalCardId = f.digitalCardId;
    let slug = f.digitalCardSlug;
    if (!digitalCardId) {
      slug = makeSlug(f.fullName, f.email);
      const editToken = crypto.randomBytes(24).toString("hex");
      const [card] = await db.insert(digitalCards).values({
        slug,
        ownerEmail: f.email,
        editToken,
        name: f.fullName,
        email: f.email,
        brandColor: "#06b6d4",
        accentColor: "#a855f7",
        theme: "executive-dark",
        layoutVariant: "standard",
        isActive: true,
        isPublic: true,
        paymentStatus: "comped_event",
      } as any).returning();
      digitalCardId = card.id;
    }

    const [updated] = await db.update(eventCardFulfillment)
      .set({ status: "programmed", programmedAt: new Date(), digitalCardId, digitalCardSlug: slug, updatedAt: new Date() })
      .where(eq(eventCardFulfillment.id, id))
      .returning();

    emitUniversalEvent({
      eventType: "event.card.programmed",
      sourceModule: "event",
      sourceTable: "event_card_fulfillment",
      sourceId: id,
      payload: { campaignId: f.campaignId, slug, digitalCardId },
    });

    res.json({ ok: true, fulfillment: updated, cardUrl: `/card/${slug}` });
  }));

  app.post("/api/event/admin/fulfillment/:id/hot", asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Forbidden" });

    const id = parseInt(req.params.id, 10);
    const { isHotLead } = z.object({ isHotLead: z.boolean() }).parse(req.body);
    const [updated] = await db.update(eventCardFulfillment)
      .set({ isHotLead, updatedAt: new Date() })
      .where(eq(eventCardFulfillment.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    if (isHotLead) {
      emitUniversalEvent({
        eventType: "event.lead.flagged_hot",
        sourceModule: "event",
        sourceTable: "event_card_fulfillment",
        sourceId: id,
        payload: { email: updated.email },
      });
    }
    res.json({ ok: true, fulfillment: updated });
  }));

  app.post("/api/event/admin/fulfillment/:id/delivered", asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Forbidden" });
    const id = parseInt(req.params.id, 10);
    const [updated] = await db.update(eventCardFulfillment)
      .set({ status: "delivered", updatedAt: new Date() })
      .where(eq(eventCardFulfillment.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    emitUniversalEvent({
      eventType: "event.card.delivered",
      sourceModule: "event",
      sourceTable: "event_card_fulfillment",
      sourceId: id,
      payload: { email: updated.email },
    });
    res.json({ ok: true, fulfillment: updated });
  }));
}

// Idempotent: validates the setup_intent, atomically decrements inventory,
// creates the trial subscription. Safe to call from both the client finalize
// endpoint and the setup_intent.succeeded webhook.
export async function validateAndProvision(setupIntentId: string): Promise<{
  ok: boolean;
  alreadyProcessed?: boolean;
  fulfillmentId?: number;
  trialEndsAt?: string;
  error?: string;
}> {
  const fulfillment = (await db.select().from(eventCardFulfillment)
    .where(eq(eventCardFulfillment.stripeSetupIntentId, setupIntentId))
    .limit(1))[0];
  if (!fulfillment) return { ok: false, error: "Fulfillment not found" };
  if (fulfillment.paymentMethodValidated && fulfillment.stripeSubscriptionId) {
    return { ok: true, alreadyProcessed: true, fulfillmentId: fulfillment.id, trialEndsAt: fulfillment.trialEndsAt?.toISOString() };
  }

  const stripeSync = await getStripeSync();
  const stripe = (stripeSync as any).stripe;

  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  if (setupIntent.status !== "succeeded") {
    return { ok: false, error: `setup_intent status is ${setupIntent.status}` };
  }
  const paymentMethodId = setupIntent.payment_method as string;
  const customerId = setupIntent.customer as string;
  if (!paymentMethodId || !customerId) return { ok: false, error: "Missing payment method or customer" };

  // Atomic claim: only the first concurrent caller transitions the row from
  // false -> true. The losers see 0 rows and short-circuit with alreadyProcessed.
  // This prevents the webhook + finalize endpoint from both decrementing inventory.
  const claim = await db.update(eventCardFulfillment)
    .set({ paymentMethodValidated: true, updatedAt: new Date() })
    .where(and(
      eq(eventCardFulfillment.id, fulfillment.id),
      eq(eventCardFulfillment.paymentMethodValidated, false),
    ))
    .returning({ id: eventCardFulfillment.id });
  if (claim.length === 0) {
    const refreshed = (await db.select().from(eventCardFulfillment).where(eq(eventCardFulfillment.id, fulfillment.id)).limit(1))[0];
    return { ok: true, alreadyProcessed: true, fulfillmentId: fulfillment.id, trialEndsAt: refreshed?.trialEndsAt?.toISOString() };
  }

  // Atomic inventory decrement — never oversells. Uses Drizzle's typed update
  // with returning() so the row count is reliable across drivers.
  const decremented = await db.update(eventCampaigns)
    .set({ remainingInventory: sqlOp`${eventCampaigns.remainingInventory} - 1` })
    .where(and(
      eq(eventCampaigns.id, fulfillment.campaignId),
      eq(eventCampaigns.isActive, true),
      gt(eventCampaigns.remainingInventory, 0),
    ))
    .returning({ remaining: eventCampaigns.remainingInventory });

  if (decremented.length === 0) {
    // Roll back our claim so the operator can see the row is broken.
    await db.update(eventCardFulfillment)
      .set({ paymentMethodValidated: false, status: "cancelled", notes: "Inventory exhausted at validation time", updatedAt: new Date() })
      .where(eq(eventCardFulfillment.id, fulfillment.id));
    return { ok: false, error: "Inventory exhausted" };
  }

  // Set as default payment method on customer
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  }).catch((e: any) => console.error("[EVENT] customer.update default pm error:", e?.message));

  // Create subscription with 30-day trial on Starter plan
  const campaign = (await db.select().from(eventCampaigns).where(eq(eventCampaigns.id, fulfillment.campaignId)).limit(1))[0];
  const trialDays = campaign?.trialDays ?? TRIAL_DAYS_DEFAULT;
  const priceId = await ensureStarterPriceId(stripe);

  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    trial_period_days: trialDays,
    default_payment_method: paymentMethodId,
    payment_settings: { save_default_payment_method: "on_subscription" },
    metadata: {
      source: "event",
      campaignId: String(fulfillment.campaignId),
      fulfillmentId: String(fulfillment.id),
      email: fulfillment.email,
      tierName: "starter",
    },
  });

  const trialEndsAt = subscription.trial_end ? new Date(subscription.trial_end * 1000) : new Date(Date.now() + trialDays * 86400000);

  await db.update(eventCardFulfillment).set({
    paymentMethodValidated: true,
    stripeSubscriptionId: subscription.id,
    trialEndsAt,
    updatedAt: new Date(),
  }).where(eq(eventCardFulfillment.id, fulfillment.id));

  emitUniversalEvent({
    eventType: "event.signup.payment_validated",
    sourceModule: "event",
    sourceTable: "event_card_fulfillment",
    sourceId: fulfillment.id,
    payload: { campaignId: fulfillment.campaignId, customerId, subscriptionId: subscription.id },
  });
  emitUniversalEvent({
    eventType: "event.signup.completed",
    sourceModule: "event",
    sourceTable: "event_card_fulfillment",
    sourceId: fulfillment.id,
    payload: { campaignId: fulfillment.campaignId, email: fulfillment.email, trialEndsAt: trialEndsAt.toISOString() },
  });

  console.log(`[EVENT] Provisioned fulfillment #${fulfillment.id} — sub=${subscription.id}, trial ends ${trialEndsAt.toISOString()}`);
  return { ok: true, fulfillmentId: fulfillment.id, trialEndsAt: trialEndsAt.toISOString() };
}
