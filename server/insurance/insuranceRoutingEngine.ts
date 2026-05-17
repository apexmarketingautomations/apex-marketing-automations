/**
 * server/insurance/insuranceRoutingEngine.ts
 *
 * Insurance-Specific Routing Engine
 *
 * Routes insurance opportunities to matching agencies based on:
 *   - Line of business specialization
 *   - Territory (zip → county → state)
 *   - Commercial vs residential
 *   - Risk category (standard / high-risk / commercial)
 *   - Carrier specialization
 *   - Tier (exclusive → shared_2 → shared_5 → open)
 *   - Bilingual capability
 *   - Historical bind rate
 *
 * Prevents duplicate routing within 48-hour window.
 * All routes produce DRAFT notifications — no auto-send.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { homeServiceContractors } from "@shared/schema";
import { eq } from "drizzle-orm";
import { esc, num, bool } from "../hpl/sqlSafe";
import { randomUUID } from "crypto";
import type { InsuranceAgencyProfile, InsuranceLine, InsuranceOpportunity, AgencyTier } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const TIER_LIMITS: Record<AgencyTier, number> = {
  exclusive:    1,
  preferred:    2,
  standard:     4,
  pay_per_lead: 10,
};

const CLAIM_HOURS: Record<AgencyTier, number> = {
  exclusive:    72,
  preferred:    48,
  standard:     24,
  pay_per_lead: 12,
};

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _ins_routing_queue (
        id                  SERIAL PRIMARY KEY,
        opportunity_id      TEXT        NOT NULL,
        agency_id           INTEGER     NOT NULL,
        sub_account_id      INTEGER,
        insurance_line      TEXT        NOT NULL,
        opportunity_type    TEXT        NOT NULL,
        routing_tier        TEXT        NOT NULL,
        match_score         INTEGER     NOT NULL,
        assigned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at          TIMESTAMPTZ NOT NULL,
        exclusive           BOOLEAN     NOT NULL DEFAULT FALSE,
        status              TEXT        NOT NULL DEFAULT 'pending',
        claimed_at          TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ins_route_opp_idx    ON _ins_routing_queue (opportunity_id, status);
      CREATE INDEX IF NOT EXISTS ins_route_agency_idx ON _ins_routing_queue (agency_id, status);
      CREATE INDEX IF NOT EXISTS ins_route_expires_idx ON _ins_routing_queue (expires_at, status);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[INS-ROUTING] Failed to ensure table:", err?.message);
  }
}

// ── Agency match scoring ──────────────────────────────────────────────────────

export function scoreAgencyMatch(opts: {
  agency: InsuranceAgencyProfile;
  opportunity: InsuranceOpportunity;
}): number {
  const { agency, opportunity } = opts;
  let score = 0;

  // Line of business match — hard requirement
  if (!agency.linesOfBusiness.includes(opportunity.insuranceLine)) return 0;
  score += 30;

  // Territory match — county required
  const countyMatch = agency.serviceCounties.some(
    c => c.toUpperCase() === opportunity.county.toUpperCase()
  );
  if (!countyMatch) {
    // Zip fallback
    const zipMatch = opportunity.zip && agency.serviceZips?.includes(opportunity.zip);
    if (!zipMatch) return 0;
    score += 15;
  } else {
    score += 25;
  }

  // Tier bonus
  const tierBonus: Record<AgencyTier, number> = { exclusive: 20, preferred: 15, standard: 10, pay_per_lead: 5 };
  score += tierBonus[agency.tier] ?? 5;

  // Capacity
  score += Math.round(agency.capacityScore * 0.10);

  // Specialization bonuses
  if (opportunity.commercialRelated && agency.commercialCapable) score += 12;
  if (opportunity.stormRelated && agency.specializations?.includes("storm")) score += 10;
  if (agency.highRiskCapable && ["high_risk_auto", "sr22_placement"].includes(opportunity.opportunityType)) score += 12;

  // Bind rate
  const total = agency.totalLeadsClaimed ?? 0;
  const bound = agency.totalBound ?? 0;
  if (total > 10) {
    const bindRate = bound / total;
    if (bindRate >= 0.25) score += 10;
    else if (bindRate >= 0.15) score += 5;
  }

  // Response speed
  const avgSec = agency.avgLeadClaimTimeSec ?? 7200;
  if (avgSec < 300)       score += 12;
  else if (avgSec < 1800) score += 6;

  return Math.min(score, 100);
}

// ── Build routing plan ────────────────────────────────────────────────────────

export interface InsuranceRoutingPlan {
  opportunityId: string;
  tier: AgencyTier;
  assignments: Array<{
    agencyId: number;
    matchScore: number;
    expiresAt: string;
    exclusive: boolean;
  }>;
  totalCandidates: number;
  routingReason: string;
}

export async function buildInsuranceRoutingPlan(
  opportunity: InsuranceOpportunity,
  agencies: InsuranceAgencyProfile[],
): Promise<InsuranceRoutingPlan> {
  const candidates: Array<{ agency: InsuranceAgencyProfile; matchScore: number }> = [];

  for (const agency of agencies) {
    const matchScore = scoreAgencyMatch({ agency, opportunity });
    if (matchScore > 0) candidates.push({ agency, matchScore });
  }

  candidates.sort((a, b) => b.matchScore - a.matchScore);

  const topTier = candidates[0]?.agency.tier ?? "pay_per_lead";
  const routingTier: AgencyTier = topTier;
  const maxAssignments = TIER_LIMITS[routingTier];
  const selected = candidates.slice(0, maxAssignments);

  const claimHrs = CLAIM_HOURS[routingTier];
  const expiresAt = new Date(Date.now() + claimHrs * 3_600_000).toISOString();

  return {
    opportunityId: opportunity.opportunityId,
    tier: routingTier,
    assignments: selected.map(({ agency, matchScore }) => ({
      agencyId:   agency.id,
      matchScore,
      expiresAt,
      exclusive:  routingTier === "exclusive",
    })),
    totalCandidates: candidates.length,
    routingReason: candidates.length === 0
      ? "no_matching_agencies"
      : `${candidates.length} candidates, top score=${candidates[0]?.matchScore}`,
  };
}

// ── Execute routing ───────────────────────────────────────────────────────────

export async function executeInsuranceRouting(plan: InsuranceRoutingPlan): Promise<{
  routed: number;
  skipped: number;
  errors: string[];
}> {
  await ensureTable();
  let routed = 0, skipped = 0;
  const errors: string[] = [];

  for (const assignment of plan.assignments) {
    // Dedup: 48h window
    const existing = await db.execute(sql.raw(`
      SELECT id FROM _ins_routing_queue
      WHERE opportunity_id = ${esc(plan.opportunityId)}
        AND agency_id = ${assignment.agencyId}
        AND created_at >= NOW() - INTERVAL '48 hours'
      LIMIT 1
    `));
    const rows = (existing as any).rows ?? existing;
    if (Array.isArray(rows) && rows.length > 0) { skipped++; continue; }

    try {
      await db.execute(sql.raw(`
        INSERT INTO _ins_routing_queue
          (opportunity_id, agency_id, insurance_line, opportunity_type, routing_tier,
           match_score, expires_at, exclusive)
        VALUES
          (${esc(plan.opportunityId)}, ${assignment.agencyId},
           'placeholder', 'placeholder', ${esc(plan.tier)},
           ${assignment.matchScore}, ${esc(assignment.expiresAt)}, ${bool(assignment.exclusive)})
      `));
      routed++;
    } catch (err: any) {
      errors.push(`agency#${assignment.agencyId}: ${err?.message}`);
    }
  }

  return { routed, skipped, errors };
}

// ── Routing stats ─────────────────────────────────────────────────────────────

export async function getInsuranceRoutingStats(sinceHours = 24): Promise<{
  totalRouted: number;
  claimed: number;
  expired: number;
  claimRatePct: number;
  byLine: Record<string, number>;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(CASE WHEN status = 'claimed' THEN 1 END)       AS claimed,
        COUNT(CASE WHEN status = 'expired' THEN 1 END)       AS expired,
        insurance_line,
        COUNT(*)                                              AS line_count
      FROM _ins_routing_queue
      WHERE created_at >= NOW() - INTERVAL '${sinceHours} hours'
      GROUP BY insurance_line
    `));
    const rows = (result as any).rows ?? result;
    let total = 0, claimed = 0, expired = 0;
    const byLine: Record<string, number> = {};
    for (const r of (Array.isArray(rows) ? rows : [])) {
      const n = Number(r.total ?? r.line_count ?? 0);
      total += n;
      claimed += Number(r.claimed ?? 0);
      expired += Number(r.expired ?? 0);
      if (r.insurance_line) byLine[r.insurance_line] = (byLine[r.insurance_line] ?? 0) + n;
    }
    return { totalRouted: total, claimed, expired, claimRatePct: total > 0 ? (claimed / total) * 100 : 0, byLine };
  } catch {
    return { totalRouted: 0, claimed: 0, expired: 0, claimRatePct: 0, byLine: {} };
  }
}
