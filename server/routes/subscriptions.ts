import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { asyncHandler, getUserId } from "./helpers";
import { provisionRoomOSAccount } from "../services/roomOS/provisioning";
import { TRIAL_DAYS_DEFAULT } from "@shared/schema";

export function registerSubscriptionsRoutes(app: Express) {
  // ---- Subscription Management ----
  app.get("/api/subscription", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const userId = getUserId(user);
    const sub = await storage.getSubscription(userId);
    if (!sub) {
      const allAccounts = await storage.getSubAccounts();
      const userAccounts = allAccounts.filter((a: any) => a.ownerUserId === userId);
      const bestPlan = userAccounts.length > 0
        ? (userAccounts.find((a: any) => a.plan === "enterprise")?.plan
          || userAccounts.find((a: any) => a.plan === "pro")?.plan
          || userAccounts[0]?.plan
          || "free")
        : "free";
      return res.json({ planTier: bestPlan, status: bestPlan !== "free" ? "active" : "inactive", aiCredits: 0 });
    }

    if (sub.isGrandfathered && sub.paymentStatus === "failed" && sub.paymentFailedAt) {
      const hoursSinceFail = (Date.now() - new Date(sub.paymentFailedAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceFail >= 72) {
        await storage.updateSubscription(sub.id, {
          isGrandfathered: false,
          paymentStatus: "revoked",
        });
        await storage.createAuditLog({
          action: "LEGACY_STATUS_REVOKED",
          performedBy: user?.claims?.sub || user?.id || "system",
          details: {
            message: "72-hour grace period expired. Grandfathered pricing permanently revoked.",
            subscriptionId: sub.id,
            hoursSinceFail: Math.round(hoursSinceFail),
          },
        });
        console.log(`[ENFORCEMENT] User ${user.id} Legacy status auto-revoked after 72hr grace period`);
        const updated = await storage.getSubscription(user.id);
        return res.json(updated);
      }
    }

    res.json(sub);
  }));

  app.post("/api/subscription/checkout", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      tier: z.enum(["starter", "pro", "enterprise"]),
      interval: z.enum(["monthly", "yearly"]).default("monthly"),
      isBlitz: z.boolean().default(false),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const monthlyPrices: Record<string, number> = {
      starter: 9700,
      pro: 29700,
      enterprise: 49700,
    };

    const yearlyPrices: Record<string, number> = {
      starter: 7700,
      pro: 23700,
      enterprise: 39700,
    };

    const blitzPrices: Record<string, number> = {
      starter: 4800,
      pro: 14800,
      enterprise: 24800,
    };

    const tierNames: Record<string, string> = {
      starter: "Starter AI",
      pro: "Pro",
      enterprise: "Enterprise",
    };

    const isBlitz = parsed.data.isBlitz;
    const isYearly = parsed.data.interval === "yearly";
    let unitAmount: number;

    if (isBlitz) {
      unitAmount = blitzPrices[parsed.data.tier];
    } else if (isYearly) {
      unitAmount = yearlyPrices[parsed.data.tier];
    } else {
      unitAmount = monthlyPrices[parsed.data.tier];
    }

    const billingInterval = isYearly ? "year" as const : "month" as const;

    try {
      const { getUncachableStripeClient } = await import("../stripeClient");
      const stripe = await getUncachableStripeClient();

      const productName = isBlitz
        ? `${tierNames[parsed.data.tier]} (Legacy Grandfathered)`
        : tierNames[parsed.data.tier];

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_collection: "always",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: productName },
            unit_amount: unitAmount,
            recurring: { interval: billingInterval },
          },
          quantity: 1,
        }],
        metadata: {
          userId: user.id,
          tierName: parsed.data.tier,
          isGrandfathered: isBlitz ? "true" : "false",
          billingInterval: parsed.data.interval,
        },
        subscription_data: {
          trial_period_days: isBlitz ? 0 : TRIAL_DAYS_DEFAULT,
          metadata: {
            userId: user.id,
            tierName: parsed.data.tier,
            isGrandfathered: isBlitz ? "true" : "false",
            billingInterval: parsed.data.interval,
          },
        },
        success_url: `${req.protocol}://${req.get("host")}/billing?success=true`,
        cancel_url: `${req.protocol}://${req.get("host")}/billing?canceled=true`,
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("[STRIPE] Checkout error:", err.message);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  }));

  app.post("/api/subscription/roomos-checkout", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      cbUsername: z.string().min(1).max(64),
      plan: z.enum(["roomos_starter", "roomos_pro"]),
      email: z.string().email(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const roomosPrices: Record<string, number> = {
      roomos_starter: 1900,
      roomos_pro: 4900,
    };

    const roomosPlanNames: Record<string, string> = {
      roomos_starter: "roomOS Starter",
      roomos_pro: "roomOS Pro",
    };

    const unitAmount = roomosPrices[parsed.data.plan];
    const productName = roomosPlanNames[parsed.data.plan];

    try {
      const { getUncachableStripeClient } = await import("../stripeClient");
      const stripe = await getUncachableStripeClient();

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_collection: "always",
        customer_email: parsed.data.email,
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: productName },
            unit_amount: unitAmount,
            recurring: { interval: "month" },
          },
          quantity: 1,
        }],
        metadata: {
          source: "roomos",
          userId: user.id,
          cbUsername: parsed.data.cbUsername,
          roomosPlan: parsed.data.plan,
          email: parsed.data.email,
          firstName: user.firstName || user.displayName || parsed.data.cbUsername,
        },
        subscription_data: {
          metadata: {
            source: "roomos",
            userId: user.id,
            cbUsername: parsed.data.cbUsername,
            roomosPlan: parsed.data.plan,
          },
        },
        success_url: `${req.protocol}://${req.get("host")}/roomos?welcome=true`,
        cancel_url: `${req.protocol}://${req.get("host")}/pricing?canceled=true`,
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("[STRIPE] roomOS checkout error:", err.message);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  }));
}

export { provisionRoomOSAccount };
