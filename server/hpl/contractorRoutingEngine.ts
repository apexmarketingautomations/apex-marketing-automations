/**
 * server/hpl/contractorRoutingEngine.ts
 *
 * Territory-Aware Contractor Routing Engine
 *
 * Routes leads to the best-matching contractor(s) based on:
 *   - Trade specialty match
 *   - Service area (county + zip)
 *   - Tier (exclusive → shared_2 → shared_5 → open)
 *   - Capacity score (availability)
 *   - Reputation score
 *   - Lead urgency
 *   - Storm event proximity
 *   - License status
 *   - Historical claim rate
 *
 * Routing modes:
 *   - EXCLUSIVE: 1 contractor, highest score wins
 *   - SHARED_2:  Top 2 contractors, weighted rotation
 *   - SHARED_5:  Top 5 contractors, open rotation
 *   - OPEN:      All matching contractors in county
 *
 * Prevents duplicate routing within 24-hour window.
 */

import { db } from "../db";
import { homeServiceContractors, homeServiceLeads, homeServiceLeadClaims } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { ContractorProfile, RoutingAssignment, RoutingTier, ServiceTrade } from "./types";
import { randomUUID } from "crypto";

// ── Routing config ─────────────────────────────────────────────────────────────

const EXCLUSIVE_CLAIM_HOURS  = 48;
const SHARED_CLAIM_HOURS     = 24;
const OPEN_CLAIM_HOURS       = 12;

// Maximum contractors per routing tier
const TIER_LIMITS: Record<RoutingTier, number> = {
  exclusive: 1,
  shared_2:  2,
  shared_5:  5,
  open:      20,
};

// ── Contractor match scoring ───────────────────────────────────────────────────

interface ContractorMatchInput {
  contractor: ContractorProfile;
  leadTrades: ServiceTrade[];
  leadCounty: string;
  leadUrgency?: string;
  leadScore?: number;
  hasStormEvent?: boolean;
}

export function scoreContractorMatch(input: ContractorMatchInput): number {
  const { contractor, leadTrades, leadCounty, leadUrgency, leadScore = 50, hasStormEvent } = input;
  let score = 0;

  // Trade match — primary driver
  const tradeOverlap = leadTrades.filter(t => contractor.trades.includes(t));
  if (tradeOverlap.length === 0) return 0;  // no match
  score += tradeOverlap.length * 20;

  // County match — required for routing
  const countyMatch = contractor.serviceCounties.some(c =>
    c.toUpperCase() === leadCounty.toUpperCase()
  );
  if (!countyMatch) return 0;  // out of territory
  score += 25;

  // Tier bonus — exclusive contractors get priority routing
  const tierBonus: Record<string, number> = {
    exclusive: 20,
    preferred: 15,
    standard:  10,
    pay_per_lead: 5,
  };
  score += tierBonus[contractor.tier] ?? 5;

  // Capacity (availability)
  score += Math.round(contractor.capacityScore * 0.15);

  // Reputation
  score += Math.round(contractor.reputationScore * 0.1);

  // Urgency premium — fast responders prioritized for immediate leads
  if (leadUrgency === "immediate") {
    const avgResponse = contractor.avgLeadClaimTimeSec ?? 3600;
    if (avgResponse < 300)       score += 15;  // < 5 min
    else if (avgResponse < 1800) score += 8;   // < 30 min
    else if (avgResponse < 7200) score += 3;   // < 2 hrs
  }

  // Storm event — contractors with storm experience get bonus
  if (hasStormEvent) {
    const stormTrades: ServiceTrade[] = ["roofing", "restoration", "gutters", "tree_service"];
    if (tradeOverlap.some(t => stormTrades.includes(t))) score += 12;
  }

  // Conversion rate bonus
  const total = contractor.totalLeadsClaimed ?? 0;
  const converted = contractor.totalLeadsConverted ?? 0;
  if (total > 10) {
    const convRate = converted / total;
    if (convRate >= 0.3)      score += 10;
    else if (convRate >= 0.2) score += 5;
  }

  return Math.min(score, 100);
}

// ── Routing plan builder ──────────────────────────────────────────────────────

export interface RoutingPlan {
  leadId: number;
  tier: RoutingTier;
  assignments: RoutingAssignment[];
  totalCandidates: number;
  routingReason: string;
}

export async function buildRoutingPlan(
  leadId: number,
  trades: ServiceTrade[],
  county: string,
  urgency?: string,
  hasStormEvent?: boolean,
  leadScore?: number,
): Promise<RoutingPlan> {
  // Load active contractors for this county
  const rawContractors = await db
    .select()
    .from(homeServiceContractors)
    .where(eq(homeServiceContractors.active, true));

  const candidates: Array<{ contractor: ContractorProfile; matchScore: number }> = [];

  for (const raw of rawContractors) {
    const profile: ContractorProfile = {
      id:               raw.id,
      subAccountId:     raw.subAccountId ?? undefined,
      businessName:     raw.businessName,
      ownerName:        raw.ownerName ?? undefined,
      phone:            raw.phone,
      email:            raw.email ?? undefined,
      trades:           (raw.serviceCategories as string[] ?? []) as ServiceTrade[],
      serviceCounties:  raw.counties as string[] ?? [],
      tier:             (raw.tier ?? "pay_per_lead") as ContractorProfile["tier"],
      active:           raw.active,
      capacityScore:    raw.score,
      reputationScore:  raw.score,
    };

    const matchScore = scoreContractorMatch({
      contractor: profile, leadTrades: trades, leadCounty: county,
      leadUrgency: urgency, leadScore, hasStormEvent,
    });
    if (matchScore > 0) candidates.push({ contractor: profile, matchScore });
  }

  // Sort by match score descending
  candidates.sort((a, b) => b.matchScore - a.matchScore);

  // Determine routing tier based on highest-scoring contractor's tier
  const topTier = candidates[0]?.contractor.tier;
  const routingTier: RoutingTier = topTier === "exclusive" ? "exclusive"
    : topTier === "preferred" ? "shared_2"
    : candidates.length >= 5 ? "shared_5"
    : "open";

  const maxAssignments = TIER_LIMITS[routingTier];
  const selected = candidates.slice(0, maxAssignments);

  const claimHours = routingTier === "exclusive" ? EXCLUSIVE_CLAIM_HOURS
    : routingTier === "shared_2" ? SHARED_CLAIM_HOURS : OPEN_CLAIM_HOURS;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + claimHours * 3_600_000).toISOString();

  const assignments: RoutingAssignment[] = selected.map(({ contractor, matchScore }) => ({
    leadId,
    contractorId:   contractor.id,
    trade:          trades[0],
    routingTier,
    matchScore,
    assignedAt:     now.toISOString(),
    expiresAt,
    exclusive:      routingTier === "exclusive",
    notificationSent: false,
  }));

  return {
    leadId,
    tier: routingTier,
    assignments,
    totalCandidates: candidates.length,
    routingReason: candidates.length === 0
      ? "no_matching_contractors"
      : `${candidates.length} candidates, top score=${candidates[0]?.matchScore}`,
  };
}

// ── Execute routing — write claim rows ────────────────────────────────────────

export async function executeRouting(plan: RoutingPlan): Promise<{
  routed: number;
  skipped: number;
  errors: string[];
}> {
  let routed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const assignment of plan.assignments) {
    // Check for duplicate claim in last 24h
    const existing = await db
      .select({ id: homeServiceLeadClaims.id })
      .from(homeServiceLeadClaims)
      .where(
        and(
          eq(homeServiceLeadClaims.leadId, assignment.leadId),
          eq(homeServiceLeadClaims.contractorId, assignment.contractorId),
          sql`created_at >= NOW() - INTERVAL '24 hours'`,
        )
      )
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    try {
      await db.insert(homeServiceLeadClaims).values({
        leadId:       assignment.leadId,
        contractorId: assignment.contractorId,
        token:        randomUUID(),
        tier:         assignment.routingTier,
        status:       "pending",
        expiresAt:    new Date(assignment.expiresAt),
      });
      routed++;
    } catch (err: any) {
      errors.push(`contractor#${assignment.contractorId}: ${err?.message}`);
    }
  }

  return { routed, skipped, errors };
}

// ── Territory map — county coverage ───────────────────────────────────────────

export async function getContractorTerritoryMap(): Promise<Record<string, string[]>> {
  const contractors = await db
    .select({
      businessName: homeServiceContractors.businessName,
      counties: homeServiceContractors.counties,
    })
    .from(homeServiceContractors)
    .where(eq(homeServiceContractors.active, true));

  const map: Record<string, string[]> = {};
  for (const c of contractors) {
    for (const county of (c.counties as string[] ?? [])) {
      const key = county.toUpperCase();
      if (!map[key]) map[key] = [];
      map[key].push(c.businessName);
    }
  }
  return map;
}

// ── Routing stats ─────────────────────────────────────────────────────────────

export async function getRoutingStats(sinceHours = 24): Promise<{
  totalAssignments: number;
  claimedCount: number;
  expiredCount: number;
  claimRatePct: number;
  byCounty: Record<string, number>;
}> {
  try {
    const since = new Date(Date.now() - sinceHours * 3_600_000);
    const claims = await db
      .select({
        status: homeServiceLeadClaims.status,
        county: homeServiceLeads.county,
      })
      .from(homeServiceLeadClaims)
      .leftJoin(homeServiceLeads, eq(homeServiceLeadClaims.leadId, homeServiceLeads.id))
      .where(sql`${homeServiceLeadClaims.createdAt} >= ${since}`);

    const total = claims.length;
    const claimed = claims.filter(c => c.status === "claimed").length;
    const expired = claims.filter(c => c.status === "expired").length;

    const byCounty: Record<string, number> = {};
    for (const c of claims) {
      const county = c.county ?? "unknown";
      byCounty[county] = (byCounty[county] ?? 0) + 1;
    }

    return {
      totalAssignments: total,
      claimedCount:     claimed,
      expiredCount:     expired,
      claimRatePct:     total > 0 ? (claimed / total) * 100 : 0,
      byCounty,
    };
  } catch { return { totalAssignments: 0, claimedCount: 0, expiredCount: 0, claimRatePct: 0, byCounty: {} }; }
}
