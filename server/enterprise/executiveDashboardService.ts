/**
 * Executive Dashboard Service — Phase 11
 *
 * Assembles the full platform health snapshot for the executive dashboard.
 * All data is pre-aggregated server-side — zero raw DB/JSON leakage to clients.
 *
 * Dashboard sections:
 *  1. Platform Health  — queue depth, error rates, uptime indicators
 *  2. AI Intelligence  — AI requests today, token spend, handoff rate
 *  3. Billing Overview — ARR, MRR, top accounts by spend
 *  4. Tenant Health    — active/suspended accounts, quota alerts
 *  5. Pipeline Metrics — leads today, conversions, skip-trace runs
 *  6. ROI Summary      — platform-wide impact numbers
 */

import { db } from "../db";
import { pool } from "../db";
import {
  subAccounts,
  enterpriseTenantQuotas,
  enterpriseUsageMeters,
  enterpriseRoiSnapshots,
  contacts,
} from "@shared/schema";
import { desc, eq, gte, sql as dSql, count } from "drizzle-orm";
import { getPlatformRoiSummary } from "./roiAnalyticsEngine";
import { getPlatformUsageReport } from "./billingMeteringEngine";
import { getVendorRunState } from "../vendorConfig";
import { getPlatformAuditFeed } from "./operationalAuditService";

export interface PlatformHealthSnapshot {
  generatedAt:     string;
  platform: {
    totalAccounts:   number;
    activeAccounts:  number;
    suspendedAccounts: number;
    quotaAlertsCount: number;   // accounts > 80% on any metric
  };
  aiMetrics: {
    tokensToday:     number;
    estimatedCostToday: number;
    smsToday:        number;
    voiceMinToday:   number;
  };
  billing: {
    totalMonthlySpend:     number;
    projectedMonthly:      number;
    topAccountsBySpend:    { subAccountId: number; spend: number }[];
  };
  pipeline: {
    totalContactsAllAccounts: number;
    leadsLast24h:             number;
    skipTraceRunsToday:       number;
    batchDataLastRun:         { ranAt: string | null; count: number; error: string | null };
  };
  roi: {
    totalAccounts:           number;
    totalLeads:              number;
    totalConversions:        number;
    totalHoursSaved:         number;
    totalMissedCallRecovery: number;
    totalRevenueImpact:      number;
  };
  recentAuditEvents: {
    eventType: string;
    actor:     string;
    createdAt: string;
  }[];
}

/** Assemble the full executive dashboard snapshot. */
export async function getExecutiveDashboard(): Promise<PlatformHealthSnapshot> {
  const now    = new Date();
  const today  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const month  = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    accountStats,
    aiMetrics,
    billingData,
    pipelineData,
    roiSummary,
    recentAudit,
  ] = await Promise.all([
    _getAccountStats(),
    _getAiMetrics(today),
    _getBillingData(month, now),
    _getPipelineData(today),
    getPlatformRoiSummary(),
    getPlatformAuditFeed(10),
  ]);

  const vendorState = getVendorRunState();
  const bdRun = vendorState.batchData;

  return {
    generatedAt: now.toISOString(),
    platform: accountStats,
    aiMetrics,
    billing:  billingData,
    pipeline: {
      ...pipelineData,
      batchDataLastRun: {
        ranAt: bdRun?.ranAt?.toISOString() || null,
        count: bdRun?.count || 0,
        error: bdRun?.error || null,
      },
    },
    roi: roiSummary,
    recentAuditEvents: recentAudit.map(e => ({
      eventType: e.eventType,
      actor:     e.actor,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

/** Dashboard for a single sub-account (org-level view). */
export async function getAccountDashboard(subAccountId: number): Promise<{
  subAccountId:  number;
  usageSummary:  Record<string, { used: number; limit: number; pct: number }>;
  latestRoi:     any;
  monthlySpend:  number;
  recentAudit:   { eventType: string; actor: string; createdAt: string }[];
}> {
  const now   = new Date();
  const month = new Date(now.getFullYear(), now.getMonth(), 1);

  const [usageRows, roiRow, spendRows, auditRows] = await Promise.all([
    db.select().from(enterpriseTenantQuotas)
      .where(eq(enterpriseTenantQuotas.subAccountId, subAccountId)).limit(1),
    db.select().from(enterpriseRoiSnapshots)
      .where(eq(enterpriseRoiSnapshots.subAccountId, subAccountId))
      .orderBy(desc(enterpriseRoiSnapshots.computedAt)).limit(1),
    db.select({ total: dSql<number>`SUM(total_cost)` })
      .from(enterpriseUsageMeters)
      .where(eq(enterpriseUsageMeters.subAccountId, subAccountId)),
    pool.query(
      `SELECT event_type, actor, created_at FROM enterprise_audit_events WHERE sub_account_id=$1 ORDER BY created_at DESC LIMIT 10`,
      [subAccountId]
    ).catch(() => ({ rows: [] })), // allow-silent-catch: enterprise_audit_events table may not exist yet on first boot
  ]);

  const quota = usageRows[0] || null;
  const usage: Record<string, { used: number; limit: number; pct: number }> = {};

  const metrics: [string, string, string][] = [
    ["ai_tokens",  "usedAiTokens",   "monthlyAiTokens"],
    ["sms",        "usedSms",        "monthlySms"],
    ["voice_min",  "usedVoiceMin",   "monthlyVoiceMin"],
    ["email",      "usedEmail",      "monthlyEmail"],
    ["enrichment", "usedEnrichment", "monthlyEnrichment"],
  ];

  for (const [metric, usedKey, limitKey] of metrics) {
    const used  = Number(quota?.[usedKey as keyof typeof quota]  || 0);
    const limit = Number(quota?.[limitKey as keyof typeof quota] || 0);
    usage[metric] = { used, limit, pct: limit > 0 ? Math.round((used / limit) * 100) : 0 };
  }

  return {
    subAccountId,
    usageSummary: usage,
    latestRoi:    roiRow[0] || null,
    monthlySpend: parseFloat(String(spendRows[0]?.total || 0)),
    recentAudit:  (auditRows as any).rows.map((r: any) => ({
      eventType: r.event_type,
      actor:     r.actor,
      createdAt: r.created_at?.toISOString?.() || r.created_at,
    })),
  };
}

// ── Internal aggregators ──────────────────────────────────────────────────────

async function _getAccountStats() {
  const [allAccounts, quotaRows] = await Promise.all([
    db.select({ id: subAccounts.id }).from(subAccounts),
    db.select({ subAccountId: enterpriseTenantQuotas.subAccountId, suspended: enterpriseTenantQuotas.suspended,
                usedAiTokens: enterpriseTenantQuotas.usedAiTokens, monthlyAiTokens: enterpriseTenantQuotas.monthlyAiTokens,
                usedSms: enterpriseTenantQuotas.usedSms, monthlySms: enterpriseTenantQuotas.monthlySms,
    }).from(enterpriseTenantQuotas),
  ]);

  const total     = allAccounts.length;
  const suspended = quotaRows.filter(q => q.suspended).length;
  let quotaAlerts = 0;

  for (const q of quotaRows) {
    const aiPct  = q.monthlyAiTokens && q.monthlyAiTokens > 0 ? (q.usedAiTokens || 0) / q.monthlyAiTokens : 0;
    const smsPct = q.monthlySms      && q.monthlySms > 0      ? (q.usedSms      || 0) / q.monthlySms      : 0;
    if (aiPct > 0.8 || smsPct > 0.8) quotaAlerts++;
  }

  return {
    totalAccounts:    total,
    activeAccounts:   total - suspended,
    suspendedAccounts: suspended,
    quotaAlertsCount: quotaAlerts,
  };
}

async function _getAiMetrics(since: Date) {
  const rows = await pool.query(
    `SELECT metric_type, SUM(quantity) as qty, SUM(total_cost) as cost
     FROM enterprise_usage_meters
     WHERE created_at >= $1
     GROUP BY metric_type`,
    [since]
  ).catch(() => ({ rows: [] })); // allow-silent-catch: enterprise_usage_meters table may not exist yet on first boot

  let tokensToday = 0, estimatedCostToday = 0, smsToday = 0, voiceMinToday = 0;
  for (const r of (rows as any).rows) {
    if (r.metric_type === "ai_tokens")  { tokensToday = parseInt(r.qty || 0); estimatedCostToday = parseFloat(r.cost || 0); }
    if (r.metric_type === "sms")        smsToday        = parseInt(r.qty || 0);
    if (r.metric_type === "voice_min")  voiceMinToday   = parseFloat(r.qty || 0);
  }

  return { tokensToday, estimatedCostToday, smsToday, voiceMinToday };
}

async function _getBillingData(since: Date, until: Date) {
  const report = await getPlatformUsageReport(since, until);

  const byAccount = new Map<number, number>();
  let totalMonthlySpend = 0;
  for (const row of report) {
    const prev = byAccount.get(row.subAccountId) || 0;
    byAccount.set(row.subAccountId, prev + row.totalCost);
    totalMonthlySpend += row.totalCost;
  }

  const topAccountsBySpend = Array.from(byAccount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([subAccountId, spend]) => ({ subAccountId, spend: parseFloat(spend.toFixed(4)) }));

  const now        = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysPassed  = now.getDate();
  const projection  = daysPassed > 0 ? daysInMonth / daysPassed : 1;

  return {
    totalMonthlySpend:  parseFloat(totalMonthlySpend.toFixed(4)),
    projectedMonthly:   parseFloat((totalMonthlySpend * projection).toFixed(4)),
    topAccountsBySpend,
  };
}

async function _getPipelineData(since: Date) {
  const [totalContacts, leadsToday, skipTraceToday] = await Promise.all([
    pool.query(`SELECT COUNT(*) as c FROM contacts`).catch(() => ({ rows: [{ c: 0 }] })), // allow-silent-catch: contacts table analytics fallback
    pool.query(`SELECT COUNT(*) as c FROM contacts WHERE created_at >= $1`, [since]).catch(() => ({ rows: [{ c: 0 }] })), // allow-silent-catch: contacts table analytics fallback
    pool.query(`SELECT COUNT(*) as c FROM enterprise_usage_meters WHERE metric_type='enrichment' AND created_at >= $1`, [since]).catch(() => ({ rows: [{ c: 0 }] })), // allow-silent-catch: meters table may not exist yet
  ]);

  return {
    totalContactsAllAccounts: parseInt((totalContacts as any).rows[0]?.c || 0),
    leadsLast24h:             parseInt((leadsToday as any).rows[0]?.c || 0),
    skipTraceRunsToday:       parseInt((skipTraceToday as any).rows[0]?.c || 0),
  };
}
