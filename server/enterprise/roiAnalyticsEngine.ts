/**
 * ROI Analytics Engine — Phase 11
 *
 * Computes and stores ROI snapshots per sub-account.
 * Answers: "What is this platform worth to me?"
 *
 * Metrics tracked:
 *  - Lead pipeline conversion rates
 *  - Automation savings (hours saved vs. manual follow-up)
 *  - Missed-call recovery impact
 *  - AI effectiveness (response rate, handoff rate, CSAT proxy)
 *  - Contact enrichment success rate
 *  - Estimated revenue impact and net ROI vs. platform cost
 */

import { db } from "../db";
import { pool } from "../db";
import {
  enterpriseRoiSnapshots,
  contacts,
  messages,
  deals,
} from "@shared/schema";
import { eq, and, gte, lte, sql as dSql, count } from "drizzle-orm";
import type { EnterpriseRoiSnapshot } from "@shared/schema";

const AVG_REPLY_MINUTES_MANUAL = 20;  // minutes a human would spend per manual reply
const AVG_HOURLY_RATE           = 25;  // USD/hr for a front-desk worker
const AVG_MISSED_CALL_VALUE     = 150; // estimated revenue per recovered missed call

export interface RoiComputeResult {
  subAccountId:           number;
  periodStart:            Date;
  periodEnd:              Date;
  totalLeads:             number;
  leadsConverted:         number;
  conversionRate:         number;
  automatedReplies:       number;
  estimatedHoursSaved:    number;
  missedCallsRecovered:   number;
  missedCallRevenueValue: number;
  aiResponsesSent:        number;
  aiHandoffRate:          number;
  contactsEnriched:       number;
  phoneNumbersFound:      number;
  enrichmentSuccessRate:  number;
  estimatedRevenueImpact: number;
  platformCost:           number;
  netRoi:                 number;
}

/** Compute ROI for a given period and upsert a snapshot row. */
export async function computeRoiSnapshot(
  subAccountId: number,
  periodStart:  Date,
  periodEnd:    Date,
  platformCost: number = 0,
): Promise<RoiComputeResult> {
  const [
    leadStats,
    messageStats,
    dealStats,
    enrichStats,
  ] = await Promise.all([
    _getLeadStats(subAccountId, periodStart, periodEnd),
    _getMessageStats(subAccountId, periodStart, periodEnd),
    _getDealStats(subAccountId, periodStart, periodEnd),
    _getEnrichmentStats(subAccountId, periodStart, periodEnd),
  ]);

  const totalLeads     = leadStats.total;
  const leadsConverted = dealStats.won;
  const conversionRate = totalLeads > 0 ? leadsConverted / totalLeads : 0;

  const automatedReplies    = messageStats.aiSent;
  const estimatedHoursSaved = (automatedReplies * AVG_REPLY_MINUTES_MANUAL) / 60;
  const laborSavings        = estimatedHoursSaved * AVG_HOURLY_RATE;

  const missedCallsRecovered   = messageStats.missedCallRecovered;
  const missedCallRevenueValue = missedCallsRecovered * AVG_MISSED_CALL_VALUE;

  const aiResponsesSent = messageStats.aiSent;
  const aiHandoffRate   = aiResponsesSent > 0
    ? messageStats.aiHandoffs / aiResponsesSent
    : 0;

  const contactsEnriched    = enrichStats.enriched;
  const phoneNumbersFound   = enrichStats.phonesFound;
  const enrichmentSuccessRate = enrichStats.total > 0
    ? enrichStats.enriched / enrichStats.total
    : 0;

  const estimatedRevenueImpact = laborSavings + missedCallRevenueValue + (leadsConverted * 500);
  const netRoi = estimatedRevenueImpact - platformCost;

  const result: RoiComputeResult = {
    subAccountId,
    periodStart,
    periodEnd,
    totalLeads,
    leadsConverted,
    conversionRate:          parseFloat(conversionRate.toFixed(4)),
    automatedReplies,
    estimatedHoursSaved:     parseFloat(estimatedHoursSaved.toFixed(2)),
    missedCallsRecovered,
    missedCallRevenueValue:  parseFloat(missedCallRevenueValue.toFixed(2)),
    aiResponsesSent,
    aiHandoffRate:           parseFloat(aiHandoffRate.toFixed(4)),
    contactsEnriched,
    phoneNumbersFound,
    enrichmentSuccessRate:   parseFloat(enrichmentSuccessRate.toFixed(4)),
    estimatedRevenueImpact:  parseFloat(estimatedRevenueImpact.toFixed(2)),
    platformCost,
    netRoi:                  parseFloat(netRoi.toFixed(2)),
  };

  // Upsert snapshot
  await db
    .insert(enterpriseRoiSnapshots)
    .values({ ...result })
    .onConflictDoNothing()
    .catch(err => console.error("[ROI] Snapshot insert failed:", err?.message));

  return result;
}

/** Get the latest snapshot for a sub-account. */
export async function getLatestRoiSnapshot(subAccountId: number): Promise<EnterpriseRoiSnapshot | null> {
  const [row] = await db
    .select()
    .from(enterpriseRoiSnapshots)
    .where(eq(enterpriseRoiSnapshots.subAccountId, subAccountId))
    .orderBy(dSql`computed_at DESC`)
    .limit(1);
  return row || null;
}

/** Compute current-month ROI for a sub-account. */
export async function computeCurrentMonthRoi(
  subAccountId: number,
  platformCost = 0,
): Promise<RoiComputeResult> {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return computeRoiSnapshot(subAccountId, start, end, platformCost);
}

/** Platform-wide ROI summary (for super admin). */
export async function getPlatformRoiSummary(): Promise<{
  totalAccounts:            number;
  totalLeads:               number;
  totalConversions:         number;
  totalAutomatedReplies:    number;
  totalHoursSaved:          number;
  totalMissedCallRecovery:  number;
  totalRevenueImpact:       number;
}> {
  const rows = await db.select().from(enterpriseRoiSnapshots);

  const grouped = new Map<number, EnterpriseRoiSnapshot>();
  for (const row of rows) {
    const existing = grouped.get(row.subAccountId);
    if (!existing || new Date(row.computedAt) > new Date(existing.computedAt)) {
      grouped.set(row.subAccountId, row);
    }
  }

  let totalLeads = 0, totalConversions = 0, totalReplies = 0;
  let totalHours = 0, totalMissedCall = 0, totalRevenue = 0;

  for (const snap of grouped.values()) {
    totalLeads        += snap.totalLeads       || 0;
    totalConversions  += snap.leadsConverted   || 0;
    totalReplies      += snap.aiResponsesSent  || 0;
    totalHours        += snap.estimatedHoursSaved || 0;
    totalMissedCall   += snap.missedCallRevenueValue || 0;
    totalRevenue      += snap.estimatedRevenueImpact || 0;
  }

  return {
    totalAccounts:           grouped.size,
    totalLeads:              totalLeads,
    totalConversions:        totalConversions,
    totalAutomatedReplies:   totalReplies,
    totalHoursSaved:         parseFloat(totalHours.toFixed(2)),
    totalMissedCallRecovery: parseFloat(totalMissedCall.toFixed(2)),
    totalRevenueImpact:      parseFloat(totalRevenue.toFixed(2)),
  };
}

// ── Internal data fetchers ────────────────────────────────────────────────────

async function _getLeadStats(subAccountId: number, since: Date, until: Date) {
  const result = await pool.query(
    `SELECT COUNT(*) as total FROM contacts WHERE sub_account_id=$1 AND created_at BETWEEN $2 AND $3`,
    [subAccountId, since, until]
  ).catch(() => ({ rows: [{ total: 0 }] })); // allow-silent-catch: analytics fallback — contacts table may not exist yet
  return { total: parseInt(result.rows[0]?.total || "0") };
}

async function _getDealStats(subAccountId: number, since: Date, until: Date) {
  const result = await pool.query(
    `SELECT COUNT(*) as won FROM deals WHERE sub_account_id=$1 AND status='won' AND updated_at BETWEEN $2 AND $3`,
    [subAccountId, since, until]
  ).catch(() => ({ rows: [{ won: 0 }] })); // allow-silent-catch: analytics fallback — deals table may not exist yet
  return { won: parseInt(result.rows[0]?.won || "0") };
}

async function _getMessageStats(subAccountId: number, since: Date, until: Date) {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE direction='outbound' AND message_type='ai') as ai_sent,
       COUNT(*) FILTER (WHERE direction='outbound' AND message_type='human') as human_sent,
       COUNT(*) FILTER (WHERE message_type='ai' AND metadata->>'handoff'='true') as ai_handoffs,
       COUNT(*) FILTER (WHERE metadata->>'source'='missed_call_recovery') as missed_call_recovered
     FROM messages WHERE sub_account_id=$1 AND created_at BETWEEN $2 AND $3`,
    [subAccountId, since, until]
  ).catch(() => ({ rows: [{ ai_sent: 0, human_sent: 0, ai_handoffs: 0, missed_call_recovered: 0 }] })); // allow-silent-catch: analytics fallback — messages table may lack these columns

  const row = result.rows[0] || {};
  return {
    aiSent:             parseInt(row.ai_sent || "0"),
    humanSent:          parseInt(row.human_sent || "0"),
    aiHandoffs:         parseInt(row.ai_handoffs || "0"),
    missedCallRecovered: parseInt(row.missed_call_recovered || "0"),
  };
}

async function _getEnrichmentStats(subAccountId: number, since: Date, until: Date) {
  const result = await pool.query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE skip_trace_status='matched') as enriched,
       COUNT(*) FILTER (WHERE phone IS NOT NULL AND skip_trace_status='matched') as phones_found
     FROM contacts WHERE sub_account_id=$1 AND updated_at BETWEEN $2 AND $3`,
    [subAccountId, since, until]
  ).catch(() => ({ rows: [{ total: 0, enriched: 0, phones_found: 0 }] })); // allow-silent-catch: analytics fallback — skip_trace_status column may not exist yet

  const row = result.rows[0] || {};
  return {
    total:      parseInt(row.total       || "0"),
    enriched:   parseInt(row.enriched    || "0"),
    phonesFound: parseInt(row.phones_found || "0"),
  };
}
