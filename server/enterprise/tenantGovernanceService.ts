/**
 * Tenant Governance Service
 *
 * Single source of truth for plan limits, quota enforcement, feature flags,
 * and account suspension. All other Phase 11 services gate through this module.
 *
 * Design rules:
 *  - `checkQuota()` is synchronous (reads cached quota row) for hot paths.
 *  - `incrementUsage()` is async-safe — uses DB UPDATE … RETURNING.
 *  - Quotas reset monthly. `ensurePeriodFresh()` auto-rolls the period.
 *  - Suspension is enforced here; callers receive a typed QuotaResult.
 */

import { db } from "../db";
import { pool } from "../db";
import { enterpriseTenantQuotas } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { logEnterpriseAudit } from "./operationalAuditService";

export type QuotaMetric =
  | "ai_tokens"
  | "sms"
  | "voice_min"
  | "email"
  | "enrichment";

export interface QuotaResult {
  allowed:   boolean;
  metric:    QuotaMetric;
  used:      number;
  limit:     number;
  remaining: number;
  suspended: boolean;
  reason?:   string;
}

// Default plan limits (0 = unlimited)
const PLAN_LIMITS: Record<string, Record<QuotaMetric, number>> = {
  starter: {
    ai_tokens:  500_000,
    sms:        1_000,
    voice_min:  100,
    email:      2_000,
    enrichment: 0,
  },
  pro: {
    ai_tokens:  2_000_000,
    sms:        10_000,
    voice_min:  1_000,
    email:      20_000,
    enrichment: 100,
  },
  enterprise: {
    ai_tokens:  0,
    sms:        0,
    voice_min:  0,
    email:      0,
    enrichment: 0,
  },
};

// In-process quota cache (avoid DB roundtrip on every AI call)
const _quotaCache = new Map<number, { quota: any; cachedAt: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

async function loadQuota(subAccountId: number): Promise<any> {
  const cached = _quotaCache.get(subAccountId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.quota;

  const [row] = await db
    .select()
    .from(enterpriseTenantQuotas)
    .where(eq(enterpriseTenantQuotas.subAccountId, subAccountId))
    .limit(1);

  if (!row) {
    const inserted = await ensureTenantQuota(subAccountId);
    _quotaCache.set(subAccountId, { quota: inserted, cachedAt: Date.now() });
    return inserted;
  }

  const fresh = await ensurePeriodFresh(row);
  _quotaCache.set(subAccountId, { quota: fresh, cachedAt: Date.now() });
  return fresh;
}

function invalidateCache(subAccountId: number): void {
  _quotaCache.delete(subAccountId);
}

/** Upserts a quota row for a new sub-account using the account's plan tier. */
export async function ensureTenantQuota(subAccountId: number, planTier = "starter"): Promise<any> {
  const limits = PLAN_LIMITS[planTier] || PLAN_LIMITS.starter;
  const now    = new Date();
  const start  = new Date(now.getFullYear(), now.getMonth(), 1);
  const end    = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const [row] = await db
    .insert(enterpriseTenantQuotas)
    .values({
      subAccountId,
      planTier,
      monthlyAiTokens:   limits.ai_tokens,
      monthlySms:        limits.sms,
      monthlyVoiceMin:   limits.voice_min,
      monthlyEmail:      limits.email,
      monthlyEnrichment: limits.enrichment,
      periodStart:       start,
      periodEnd:         end,
    })
    .onConflictDoNothing()
    .returning();

  return row || (await db.select().from(enterpriseTenantQuotas).where(eq(enterpriseTenantQuotas.subAccountId, subAccountId)).limit(1))[0];
}

/** Roll period forward if we've crossed into a new month. */
async function ensurePeriodFresh(quota: any): Promise<any> {
  const now = new Date();
  if (quota.periodEnd && now <= new Date(quota.periodEnd)) return quota;

  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const [updated] = await db
    .update(enterpriseTenantQuotas)
    .set({
      periodStart: start,
      periodEnd:   end,
      usedAiTokens:  0,
      usedSms:       0,
      usedVoiceMin:  0,
      usedEmail:     0,
      usedEnrichment: 0,
      updatedAt: new Date(),
    })
    .where(eq(enterpriseTenantQuotas.subAccountId, quota.subAccountId))
    .returning();

  return updated || quota;
}

/** Check quota before consuming. Returns QuotaResult with allowed flag. */
export async function checkQuota(subAccountId: number, metric: QuotaMetric, amount = 1): Promise<QuotaResult> {
  const quota = await loadQuota(subAccountId);

  if (quota.suspended) {
    return { allowed: false, metric, used: 0, limit: 0, remaining: 0, suspended: true, reason: quota.suspendReason || "Account suspended" };
  }

  const usedField  = `used${_cap(metric)}` as keyof typeof quota;
  const limitField = `monthly${_cap(metric)}` as keyof typeof quota;
  const used  = Number(quota[usedField]  || 0);
  const limit = Number(quota[limitField] || 0);

  if (limit === 0) {
    return { allowed: true, metric, used, limit: 0, remaining: Infinity, suspended: false };
  }

  const remaining = limit - used;
  if (remaining < amount) {
    await logEnterpriseAudit({
      eventType: `quota.${metric}_limit_hit`,
      actor:     "system",
      subAccountId,
      payload:   { metric, used, limit, requested: amount },
    }).catch(() => {}); // allow-silent-catch: fire-and-forget audit
    return { allowed: false, metric, used, limit, remaining: Math.max(0, remaining), suspended: false, reason: `${metric} quota exhausted (${used}/${limit})` };
  }

  return { allowed: true, metric, used, limit, remaining, suspended: false };
}

/** Atomically increment usage counter. Call after the action succeeds. */
export async function incrementUsage(subAccountId: number, metric: QuotaMetric, amount: number = 1): Promise<void> {
  const col = _usedColumn(metric);
  await pool.query(
    `UPDATE enterprise_tenant_quotas SET "${col}" = COALESCE("${col}", 0) + $1, updated_at = NOW() WHERE sub_account_id = $2`,
    [amount, subAccountId]
  ).catch(err => console.error("[TENANT-QUOTA] increment failed:", err?.message));
  invalidateCache(subAccountId);
}

/** Update plan tier and reset limits. */
export async function setTenantPlan(subAccountId: number, planTier: string, actorUserId = "system"): Promise<void> {
  const limits = PLAN_LIMITS[planTier] || PLAN_LIMITS.starter;

  await db
    .update(enterpriseTenantQuotas)
    .set({
      planTier,
      monthlyAiTokens:   limits.ai_tokens,
      monthlySms:        limits.sms,
      monthlyVoiceMin:   limits.voice_min,
      monthlyEmail:      limits.email,
      monthlyEnrichment: limits.enrichment,
      updatedAt: new Date(),
    })
    .where(eq(enterpriseTenantQuotas.subAccountId, subAccountId));

  invalidateCache(subAccountId);

  await logEnterpriseAudit({
    eventType: "tenant.plan_changed",
    actor:     actorUserId,
    subAccountId,
    payload:   { planTier, limits },
  }).catch(() => {}); // allow-silent-catch: fire-and-forget audit
}

/** Suspend or unsuspend an account. */
export async function setTenantSuspension(subAccountId: number, suspended: boolean, reason: string, actorUserId = "system"): Promise<void> {
  await db
    .update(enterpriseTenantQuotas)
    .set({ suspended, suspendReason: reason, updatedAt: new Date() })
    .where(eq(enterpriseTenantQuotas.subAccountId, subAccountId));

  invalidateCache(subAccountId);

  await logEnterpriseAudit({
    eventType: suspended ? "tenant.suspended" : "tenant.unsuspended",
    actor:     actorUserId,
    subAccountId,
    payload:   { reason },
  }).catch(() => {}); // allow-silent-catch: fire-and-forget audit
}

/** Read feature flags for an account. */
export async function getTenantFeatureFlags(subAccountId: number): Promise<Record<string, boolean>> {
  const quota = await loadQuota(subAccountId);
  return (quota.featureFlags as Record<string, boolean>) || {};
}

/** Set a single feature flag. */
export async function setFeatureFlag(subAccountId: number, flag: string, value: boolean, actorUserId = "system"): Promise<void> {
  const quota = await loadQuota(subAccountId);
  const flags = { ...(quota.featureFlags as Record<string, boolean> || {}), [flag]: value };

  await db
    .update(enterpriseTenantQuotas)
    .set({ featureFlags: flags, updatedAt: new Date() })
    .where(eq(enterpriseTenantQuotas.subAccountId, subAccountId));

  invalidateCache(subAccountId);

  await logEnterpriseAudit({
    eventType: "tenant.feature_flag_changed",
    actor:     actorUserId,
    subAccountId,
    payload:   { flag, value },
  }).catch(() => {}); // allow-silent-catch: fire-and-forget audit
}

/** Get current usage summary for a sub-account. */
export async function getUsageSummary(subAccountId: number): Promise<{
  planTier: string;
  periodStart: Date | null;
  periodEnd:   Date | null;
  usage: Record<QuotaMetric, { used: number; limit: number; pct: number }>;
  suspended: boolean;
}> {
  const quota = await loadQuota(subAccountId);
  const metrics: QuotaMetric[] = ["ai_tokens", "sms", "voice_min", "email", "enrichment"];

  const usage: any = {};
  for (const metric of metrics) {
    const used  = Number(quota[`used${_cap(metric)}`]  || 0);
    const limit = Number(quota[`monthly${_cap(metric)}`] || 0);
    usage[metric] = { used, limit, pct: limit > 0 ? Math.round((used / limit) * 100) : 0 };
  }

  return {
    planTier:    quota.planTier || "starter",
    periodStart: quota.periodStart ? new Date(quota.periodStart) : null,
    periodEnd:   quota.periodEnd   ? new Date(quota.periodEnd)   : null,
    usage,
    suspended:   !!quota.suspended,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _cap(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
           .replace(/^./, c => c.toUpperCase());
}

function _usedColumn(metric: QuotaMetric): string {
  const map: Record<QuotaMetric, string> = {
    ai_tokens:  "used_ai_tokens",
    sms:        "used_sms",
    voice_min:  "used_voice_min",
    email:      "used_email",
    enrichment: "used_enrichment",
  };
  return map[metric];
}
