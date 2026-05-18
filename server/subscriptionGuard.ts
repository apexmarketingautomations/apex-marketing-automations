import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { subscriptions, usageLogs, PLAN_LIMITS } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { canBypassBilling, canBypassPlanLimits, logAuthBypass } from "./auth/authorization";

type SubStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete" | "suspended" | "unpaid";

const FULL_ACCESS: SubStatus[] = ["active", "trialing"];
const LIMITED_ACCESS: SubStatus[] = ["past_due"];

export function requireActiveSubscription() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (canBypassBilling(req)) {
      logAuthBypass(req, "requireActiveSubscription");
      return next();
    }

    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const userId = user.claims?.sub ?? user.id;

    try {
      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .limit(1);

      if (!sub) {
        return res.status(402).json({
          error: "No subscription found",
          message: "A subscription is required to access this feature. Please subscribe to continue.",
        });
      }

      const status = sub.status as SubStatus;

      if (FULL_ACCESS.includes(status)) {
        (req as any).subscription = sub;
        return next();
      }

      if (LIMITED_ACCESS.includes(status)) {
        (req as any).subscription = sub;
        (req as any).subscriptionWarning = "Your payment is past due. Please update your payment method.";
        return next();
      }

      return res.status(403).json({
        error: "Subscription inactive",
        status,
        message: "Your subscription is not active. Please update your billing to continue.",
      });
    } catch (err) {
      console.error("[SUBSCRIPTION-GUARD] Error checking subscription:", err);
      return res.status(500).json({ error: "Unable to verify subscription status" });
    }
  };
}

export function checkPlanLimitMiddleware(metricType: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (canBypassPlanLimits(req)) {
      logAuthBypass(req, `checkPlanLimitMiddleware:${metricType}`);
      return next();
    }

    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const subAccountId = Number(req.params.subAccountId || req.body?.subAccountId);
    if (!subAccountId || isNaN(subAccountId)) {
      return res.status(400).json({ error: "Missing subAccountId — cannot verify plan limits" });
    }

    try {
      const { subAccounts } = await import("@shared/schema");
      const [account] = await db
        .select()
        .from(subAccounts)
        .where(eq(subAccounts.id, subAccountId))
        .limit(1);

      const planName = account?.plan || "starter";
      const result = await checkPlanLimit(subAccountId, metricType, planName);
      if (!result.allowed) {
        return res.status(403).json({
          error: "Plan limit exceeded",
          metric: metricType,
          limit: result.limit,
          used: result.used,
          remaining: 0,
          message: `You have reached your ${metricType.replace(/_/g, " ")} limit (${result.used}/${result.limit}). Upgrade your plan for higher limits.`,
        });
      }
      (req as any).planLimitResult = result;
      return next();
    } catch (err) {
      console.error("[PLAN-LIMIT] Error checking plan limits:", err);
      return res.status(500).json({ error: "Unable to verify plan limits" });
    }
  };
}

export async function checkPlanLimit(
  accountId: number,
  metricType: string,
  planName?: string
): Promise<{ allowed: boolean; limit: number; used: number; remaining: number }> {
  const plan = (planName || "starter").toLowerCase();
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
  const limit = limits[metricType];

  if (!limit) return { allowed: true, limit: Infinity, used: 0, remaining: Infinity };

  const METRIC_TO_USAGE_TYPE: Record<string, string[]> = {
    messages_per_month: ["SMS_SEGMENT", "sms_sent"],
    automations: ["AUTOMATION_RUN", "automations_run"],
    contacts: ["CONTACT_CREATE", "contact_create"],
    ai_requests: ["AI_CHAT", "AI_STREAM", "AI_IMAGE_GEN", "ai_requests"],
    voice_minutes: ["VOICE_MINUTE", "voice_minutes"],
    integrations: ["INTEGRATION", "integrations"],
  };

  const usageTypes = METRIC_TO_USAGE_TYPE[metricType] || [metricType];

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  try {
    const conditions = usageTypes.map(t => sql`${usageLogs.type} = ${t}`);
    const typeCondition = conditions.length === 1
      ? conditions[0]
      : sql`(${sql.join(conditions, sql` OR `)})`;

    const [result] = await db
      .select({ total: sql<number>`COALESCE(SUM(${usageLogs.amount}), 0)` })
      .from(usageLogs)
      .where(
        and(
          eq(usageLogs.subAccountId, accountId),
          typeCondition,
          gte(usageLogs.createdAt, startOfMonth)
        )
      );

    const used = Number(result?.total || 0);
    const remaining = Math.max(0, limit - used);

    return {
      allowed: used < limit,
      limit,
      used,
      remaining,
    };
  } catch (err) {
    console.warn("[SUBSCRIPTIONGUARD] caught:", err instanceof Error ? err.message : err);
    return { allowed: true, limit, used: 0, remaining: limit };
  }
}
