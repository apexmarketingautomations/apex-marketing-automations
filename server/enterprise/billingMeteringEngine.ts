/**
 * Billing Metering Engine — Phase 11
 *
 * Tracks every unit of consumption (AI tokens, SMS, voice, email, enrichment)
 * and writes to enterprise_usage_meters for billing, reporting, and quota enforcement.
 *
 * Design:
 *  - `recordUsage()` is fire-and-forget; never blocks the calling path.
 *  - `getUsageReport()` aggregates meters for a given period.
 *  - `estimateMonthlyCost()` projects spend from current usage.
 *  - Also calls `incrementUsage()` in tenantGovernanceService to keep quota counters in sync.
 */

import { db } from "../db";
import { enterpriseUsageMeters } from "@shared/schema";
import { eq, and, gte, lte, sql as dSql } from "drizzle-orm";
import { incrementUsage } from "./tenantGovernanceService";
import type { QuotaMetric } from "./tenantGovernanceService";

export interface UsageRecord {
  subAccountId: number;
  metric:       QuotaMetric;
  quantity:     number;
  unitCost?:    number;  // USD per unit
  metadata?:    Record<string, unknown>;
}

// Unit costs in USD (approximate; override with env vars for precision billing)
const UNIT_COSTS: Record<QuotaMetric, number> = {
  ai_tokens:  0.000003,   // $3 per 1M tokens (blended Claude rate)
  sms:        0.0079,     // Twilio per SMS segment
  voice_min:  0.014,      // Twilio per minute
  email:      0.0001,     // SendGrid per email
  enrichment: 0.25,       // BatchData per skip-trace call
};

function currentPeriod(): { start: Date; end: Date } {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end:   new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
  };
}

/** Record a usage event. Fire-and-forget from calling code. */
export async function recordUsage(record: UsageRecord): Promise<void> {
  const { start, end } = currentPeriod();
  const unitCost = record.unitCost ?? UNIT_COSTS[record.metric] ?? 0;

  await db.insert(enterpriseUsageMeters).values({
    subAccountId: record.subAccountId,
    metricType:   record.metric,
    periodStart:  start,
    periodEnd:    end,
    quantity:     record.quantity,
    unitCost,
    totalCost:    parseFloat((unitCost * record.quantity).toFixed(6)),
    metadata:     record.metadata || null,
  }).catch(err => console.error("[BILLING-METER] Insert failed:", err?.message));

  // Keep quota counters in sync (non-blocking)
  incrementUsage(record.subAccountId, record.metric, record.quantity).catch(() => {}); // allow-silent-catch: quota sync
}

/** Convenience wrappers for common usage types */
export function meterAiTokens(subAccountId: number, tokens: number, metadata?: Record<string, unknown>): void {
  recordUsage({ subAccountId, metric: "ai_tokens", quantity: tokens, metadata }).catch(() => {}); // allow-silent-catch: metering
}

export function meterSms(subAccountId: number, segments: number, metadata?: Record<string, unknown>): void {
  recordUsage({ subAccountId, metric: "sms", quantity: segments, metadata }).catch(() => {}); // allow-silent-catch: metering
}

export function meterVoice(subAccountId: number, minutes: number, metadata?: Record<string, unknown>): void {
  recordUsage({ subAccountId, metric: "voice_min", quantity: minutes, metadata }).catch(() => {}); // allow-silent-catch: metering
}

export function meterEmail(subAccountId: number, count: number, metadata?: Record<string, unknown>): void {
  recordUsage({ subAccountId, metric: "email", quantity: count, metadata }).catch(() => {}); // allow-silent-catch: metering
}

export function meterEnrichment(subAccountId: number, calls: number, metadata?: Record<string, unknown>): void {
  recordUsage({ subAccountId, metric: "enrichment", quantity: calls, metadata }).catch(() => {}); // allow-silent-catch: metering
}

export interface UsageReportLine {
  metric:      string;
  totalUsage:  number;
  totalCost:   number;
  eventCount:  number;
}

/** Aggregate usage for a sub-account within a date range. */
export async function getUsageReport(
  subAccountId: number,
  since: Date,
  until: Date,
): Promise<UsageReportLine[]> {
  const rows = await db
    .select({
      metric:     enterpriseUsageMeters.metricType,
      totalUsage: dSql<number>`SUM(${enterpriseUsageMeters.quantity})`,
      totalCost:  dSql<number>`SUM(${enterpriseUsageMeters.totalCost})`,
      eventCount: dSql<number>`COUNT(*)`,
    })
    .from(enterpriseUsageMeters)
    .where(and(
      eq(enterpriseUsageMeters.subAccountId, subAccountId),
      gte(enterpriseUsageMeters.createdAt, since),
      lte(enterpriseUsageMeters.createdAt, until),
    ))
    .groupBy(enterpriseUsageMeters.metricType);

  return rows.map(r => ({
    metric:     r.metric,
    totalUsage: Number(r.totalUsage || 0),
    totalCost:  Number(r.totalCost  || 0),
    eventCount: Number(r.eventCount || 0),
  }));
}

/** Platform-wide aggregation (for super admin dashboard). */
export async function getPlatformUsageReport(since: Date, until: Date): Promise<
  { subAccountId: number; metric: string; totalUsage: number; totalCost: number }[]
> {
  return db
    .select({
      subAccountId: enterpriseUsageMeters.subAccountId,
      metric:       enterpriseUsageMeters.metricType,
      totalUsage:   dSql<number>`SUM(${enterpriseUsageMeters.quantity})`,
      totalCost:    dSql<number>`SUM(${enterpriseUsageMeters.totalCost})`,
    })
    .from(enterpriseUsageMeters)
    .where(and(
      gte(enterpriseUsageMeters.createdAt, since),
      lte(enterpriseUsageMeters.createdAt, until),
    ))
    .groupBy(enterpriseUsageMeters.subAccountId, enterpriseUsageMeters.metricType)
    .then(rows => rows.map(r => ({
      subAccountId: r.subAccountId,
      metric:       r.metric,
      totalUsage:   Number(r.totalUsage || 0),
      totalCost:    Number(r.totalCost  || 0),
    })));
}

/** Project monthly cost from current usage plus days-remaining scaling. */
export async function estimateMonthlyCost(subAccountId: number): Promise<{
  currentMonthSpend: number;
  projectedMonthEnd: number;
  byMetric: Record<string, number>;
}> {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const daysInMonth = end.getDate();
  const daysPassed  = now.getDate();
  const projection  = daysPassed > 0 ? daysInMonth / daysPassed : 1;

  const report = await getUsageReport(subAccountId, start, now);

  let currentMonthSpend = 0;
  const byMetric: Record<string, number> = {};
  for (const line of report) {
    currentMonthSpend += line.totalCost;
    byMetric[line.metric] = line.totalCost;
  }

  return {
    currentMonthSpend: parseFloat(currentMonthSpend.toFixed(4)),
    projectedMonthEnd: parseFloat((currentMonthSpend * projection).toFixed(4)),
    byMetric,
  };
}
