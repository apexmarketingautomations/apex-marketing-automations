/**
 * server/newResident/residentOpportunityAgent.ts
 *
 * Resident Opportunity Agent (Phase 9A)
 *
 * Purpose:
 *   AI advisory layer for new-resident opportunity processing.
 *   Generates structured recommendations for timing, workflow selection,
 *   business category prioritization, and communication drafts.
 *
 * STRICT RULES — this agent:
 *   - NEVER infers race, religion, politics, or protected attributes
 *   - NEVER auto-executes workflows
 *   - NEVER bypasses approval systems
 *   - NEVER sends communications
 *   - Only produces structured, audited recommendations
 *   - Always sets requiresApproval: true
 *   - All outputs are advisory — humans decide what to act on
 *
 * Intelligence model:
 *   Deterministic scoring (no LLM calls) for primary recommendations.
 *   LLM-optional enhancement for natural language explanations only.
 *   System works fully without any external AI keys.
 */

import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num } from "../hpl/sqlSafe";
import type {
  ResidentAgentRecommendation,
  ResidentOpportunityCategory,
  ResidentWorkflowType,
  ResidentServiceCategory,
  HouseholdLifecycleStage,
} from "./types";
import { scoreResidentOpportunity, persistOpportunityScore, recencyScore } from "./residentOpportunityScoring";

// ── ID builder ─────────────────────────────────────────────────────────────────

function buildRecommendationId(householdId: string, type: string, ts: string): string {
  const raw = `rec|${householdId}|${type}|${ts}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── Timing recommendation logic ───────────────────────────────────────────────

function getTimingRecommendation(daysSinceMove: number, lifecycleStage: HouseholdLifecycleStage): {
  window:     string;
  urgency:    "high" | "medium" | "low";
  rationale:  string;
} {
  if (daysSinceMove <= 7) {
    return {
      window:    "Act within 48 hours — peak week-1 window",
      urgency:   "high",
      rationale: "New residents form local preferences in the first 1-2 weeks. This is the highest-value window.",
    };
  }
  if (daysSinceMove <= 14) {
    return {
      window:    "Act within 7 days — strong week-2 window",
      urgency:   "high",
      rationale: "Still early in the move-in cycle. Residents are actively discovering local services.",
    };
  }
  if (daysSinceMove <= 30) {
    return {
      window:    "Act within 2 weeks — month-1 opportunity",
      urgency:   "medium",
      rationale: "Residents are settling in and beginning to establish routines. Service discovery is still active.",
    };
  }
  if (daysSinceMove <= 90) {
    return {
      window:    "Act within 30 days — settling-in window",
      urgency:   "medium",
      rationale: "Household is settling. Home improvement and personal services remain relevant.",
    };
  }
  return {
    window:    "Opportunity window reducing — act if high-value match",
    urgency:   "low",
    rationale: "Household has been in residence for 3+ months. Selective outreach for highest-fit services only.",
  };
}

// ── Business category priority matrix ────────────────────────────────────────

function prioritizeCategories(
  opportunityCategories: ResidentOpportunityCategory[],
  homeownerLikelihood:   number,
  daysSinceMove:         number,
): { category: ResidentOpportunityCategory; priority: number; reason: string }[] {
  return opportunityCategories
    .map((cat) => {
      let priority = 50;
      let reason   = "";

      if (cat === "home_services" && homeownerLikelihood >= 65) {
        priority = 90;
        reason   = "Homeowner + new property = high home service demand";
      } else if (cat === "insurance" && homeownerLikelihood >= 60) {
        priority = 85;
        reason   = "New homeowner needs home/auto insurance review";
      } else if (cat === "personal_services") {
        priority = 75;
        reason   = "Universal — everyone needs local personal services";
      } else if (cat === "lawn_outdoor" && homeownerLikelihood >= 60 && daysSinceMove <= 60) {
        priority = 80;
        reason   = "New homeowners often need immediate lawn/outdoor services";
      } else if (cat === "food_beverage" && daysSinceMove <= 30) {
        priority = 70;
        reason   = "Residents actively discovering local restaurants in first month";
      } else if (cat === "home_improvement" && homeownerLikelihood >= 70) {
        priority = 75;
        reason   = "New homeowners frequently undertake improvements in first 90 days";
      } else if (cat === "security_tech" && homeownerLikelihood >= 60) {
        priority = 65;
        reason   = "Home security is a common new homeowner purchase";
      }

      return { category: cat, priority, reason };
    })
    .sort((a, b) => b.priority - a.priority);
}

// ── Generate timing recommendation ───────────────────────────────────────────

export function generateTimingRecommendation(opts: {
  householdId:      string;
  tenantId:         string;
  residentEventId:  string;
  daysSinceMove:    number;
  lifecycleStage:   HouseholdLifecycleStage;
  moveConfidence:   number;
}): ResidentAgentRecommendation {
  const timing = getTimingRecommendation(opts.daysSinceMove, opts.lifecycleStage);
  const ts     = new Date().toISOString();

  return {
    recommendationId:            buildRecommendationId(opts.householdId, "timing", ts),
    residentEventId:             opts.residentEventId,
    householdId:                 opts.householdId,
    tenantId:                    opts.tenantId,
    recommendationType:          "timing",
    priority:                    timing.urgency,
    reason:                      timing.rationale,
    suggestedBusinessCategories: [],
    timingWindow:                timing.window,
    confidenceNote:              `Move confidence: ${opts.moveConfidence}%. ${timing.rationale}`,
    requiresApproval:            true,
    createdAt:                   ts,
  };
}

// ── Generate workflow recommendation ─────────────────────────────────────────

export function generateWorkflowRecommendation(opts: {
  householdId:           string;
  tenantId:              string;
  residentEventId:       string;
  opportunityCategories: ResidentOpportunityCategory[];
  homeownerLikelihood:   number;
  daysSinceMove:         number;
  topWorkflows:          ResidentWorkflowType[];
}): ResidentAgentRecommendation {
  const prioritized = prioritizeCategories(opts.opportunityCategories, opts.homeownerLikelihood, opts.daysSinceMove);
  const topCats     = prioritized.slice(0, 3).map((p) => p.category as ResidentServiceCategory);
  const topPriority = prioritized[0];
  const workflow    = opts.topWorkflows[0] ?? "neighborhood_welcome_package";
  const ts          = new Date().toISOString();

  return {
    recommendationId:            buildRecommendationId(opts.householdId, "workflow", ts),
    residentEventId:             opts.residentEventId,
    householdId:                 opts.householdId,
    tenantId:                    opts.tenantId,
    recommendationType:          "workflow",
    priority:                    topPriority?.priority >= 80 ? "high" : topPriority?.priority >= 65 ? "medium" : "low",
    reason:                      topPriority?.reason ?? "Standard new-resident introduction recommended",
    suggestedWorkflow:           workflow,
    suggestedBusinessCategories: topCats,
    confidenceNote:              `Top opportunity: ${topPriority?.category ?? "general"} (${topPriority?.priority ?? 50}/100). Homeowner likelihood: ${opts.homeownerLikelihood}%.`,
    requiresApproval:            true,
    createdAt:                   ts,
  };
}

// ── Generate business match recommendation ────────────────────────────────────

export function generateBusinessMatchRecommendation(opts: {
  householdId:           string;
  tenantId:              string;
  residentEventId:       string;
  matchedBusinesses:     Array<{ businessName: string; serviceCategory: string; matchScore: number }>;
  daysSinceMove:         number;
}): ResidentAgentRecommendation {
  const topMatch = opts.matchedBusinesses[0];
  const ts       = new Date().toISOString();
  const urgency  = opts.daysSinceMove <= 14 ? "high" : opts.daysSinceMove <= 30 ? "medium" : "low";

  return {
    recommendationId:            buildRecommendationId(opts.householdId, "business_match", ts),
    residentEventId:             opts.residentEventId,
    householdId:                 opts.householdId,
    tenantId:                    opts.tenantId,
    recommendationType:          "business_match",
    priority:                    urgency,
    reason:                      topMatch
      ? `${opts.matchedBusinesses.length} local business${opts.matchedBusinesses.length > 1 ? "es" : ""} matched. Top: ${topMatch.businessName} (${topMatch.serviceCategory}, score ${topMatch.matchScore}/100).`
      : "No business matches found for this geography.",
    suggestedBusinessCategories: opts.matchedBusinesses.slice(0, 3).map((m) => m.serviceCategory as ResidentServiceCategory),
    confidenceNote:              `${opts.matchedBusinesses.length} match${opts.matchedBusinesses.length !== 1 ? "es" : ""} found. All require human approval before outreach.`,
    requiresApproval:            true,
    createdAt:                   ts,
  };
}

// ── Full analysis pipeline ────────────────────────────────────────────────────

export async function analyzeResidentOpportunity(opts: {
  householdId:           string;
  tenantId:              string;
  residentEventId:       string;
  moveConfidence:        number;
  homeownerLikelihood:   number;
  daysSinceMove:         number;
  signalCount:           number;
  lifecycleStage:        HouseholdLifecycleStage;
  opportunityCategories: ResidentOpportunityCategory[];
  estimatedHomeValue?:   number;
  matchedBusinesses?:    Array<{ businessName: string; serviceCategory: string; matchScore: number }>;
}): Promise<{
  score:           ReturnType<typeof scoreResidentOpportunity>;
  recommendations: ResidentAgentRecommendation[];
}> {
  // 1. Score the opportunity
  const score = scoreResidentOpportunity({
    householdId:           opts.householdId,
    tenantId:              opts.tenantId,
    moveConfidence:        opts.moveConfidence,
    homeownerLikelihood:   opts.homeownerLikelihood,
    daysSinceMove:         opts.daysSinceMove,
    signalCount:           opts.signalCount,
    estimatedHomeValue:    opts.estimatedHomeValue,
    opportunityCategories: opts.opportunityCategories,
  });

  // 2. Persist score (GREATEST() — scores never regress)
  await persistOpportunityScore(score).catch(() => {});  // allow-silent-catch: non-fatal, returns safe default

  // 3. Generate recommendations
  const recommendations: ResidentAgentRecommendation[] = [];

  recommendations.push(generateTimingRecommendation({
    householdId:     opts.householdId,
    tenantId:        opts.tenantId,
    residentEventId: opts.residentEventId,
    daysSinceMove:   opts.daysSinceMove,
    lifecycleStage:  opts.lifecycleStage,
    moveConfidence:  opts.moveConfidence,
  }));

  if (score.recommendedWorkflows.length > 0) {
    recommendations.push(generateWorkflowRecommendation({
      householdId:           opts.householdId,
      tenantId:              opts.tenantId,
      residentEventId:       opts.residentEventId,
      opportunityCategories: opts.opportunityCategories,
      homeownerLikelihood:   opts.homeownerLikelihood,
      daysSinceMove:         opts.daysSinceMove,
      topWorkflows:          score.recommendedWorkflows,
    }));
  }

  if (opts.matchedBusinesses && opts.matchedBusinesses.length > 0) {
    recommendations.push(generateBusinessMatchRecommendation({
      householdId:       opts.householdId,
      tenantId:          opts.tenantId,
      residentEventId:   opts.residentEventId,
      matchedBusinesses: opts.matchedBusinesses,
      daysSinceMove:     opts.daysSinceMove,
    }));
  }

  // 4. Persist recommendations
  await persistRecommendations(recommendations);

  return { score, recommendations };
}

// ── Persistence ───────────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _nr_agent_recommendations (
        id                        SERIAL PRIMARY KEY,
        recommendation_id         TEXT NOT NULL UNIQUE,
        resident_event_id         TEXT NOT NULL,
        household_id              TEXT NOT NULL,
        tenant_id                 TEXT NOT NULL,
        recommendation_type       TEXT NOT NULL,
        priority                  TEXT NOT NULL DEFAULT 'medium',
        reason                    TEXT NOT NULL,
        suggested_workflow        TEXT,
        suggested_biz_categories  JSONB NOT NULL DEFAULT '[]',
        timing_window             TEXT,
        confidence_note           TEXT NOT NULL,
        requires_approval         BOOLEAN NOT NULL DEFAULT TRUE,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS nr_recs_tenant_idx    ON _nr_agent_recommendations (tenant_id, priority, created_at DESC);
      CREATE INDEX IF NOT EXISTS nr_recs_household_idx ON _nr_agent_recommendations (household_id, tenant_id);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[NR-AGENT] Failed to ensure table:", err?.message);
  }
}

async function persistRecommendations(recs: ResidentAgentRecommendation[]): Promise<void> {
  await ensureTable();
  for (const rec of recs) {
    try {
      await db.execute(sql.raw(`
        INSERT INTO _nr_agent_recommendations (
          recommendation_id, resident_event_id, household_id, tenant_id,
          recommendation_type, priority, reason,
          suggested_workflow, suggested_biz_categories,
          timing_window, confidence_note, requires_approval
        ) VALUES (
          ${esc(rec.recommendationId)}, ${esc(rec.residentEventId)},
          ${esc(rec.householdId)}, ${esc(rec.tenantId)},
          ${esc(rec.recommendationType)}, ${esc(rec.priority)}, ${esc(rec.reason)},
          ${rec.suggestedWorkflow ? esc(rec.suggestedWorkflow) : "NULL"},
          ${esc(JSON.stringify(rec.suggestedBusinessCategories))},
          ${rec.timingWindow ? esc(rec.timingWindow) : "NULL"},
          ${esc(rec.confidenceNote)}, TRUE
        )
        ON CONFLICT (recommendation_id) DO NOTHING
      `));
    } catch { /* skip */ }  // allow-silent-catch: non-fatal, returns safe default
  }
}

export async function getAgentRecommendations(opts: {
  tenantId:  string;
  priority?: string;
  limit?:    number;
}): Promise<ResidentAgentRecommendation[]> {
  await ensureTable();
  const filters: string[] = [`tenant_id = ${esc(opts.tenantId)}`];
  if (opts.priority) filters.push(`priority = ${esc(opts.priority)}`);

  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _nr_agent_recommendations
      WHERE ${filters.join(" AND ")}
      ORDER BY
        CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT ${num(opts.limit ?? 50)}
    `));
    return ((result as any).rows ?? result ?? []).map((r: any): ResidentAgentRecommendation => {
      let cats: any[] = [];
      try { cats = typeof r.suggested_biz_categories === "string" ? JSON.parse(r.suggested_biz_categories) : r.suggested_biz_categories ?? []; } catch {}  // allow-silent-catch: non-fatal, returns safe default
      return {
        recommendationId:            r.recommendation_id,
        residentEventId:             r.resident_event_id,
        householdId:                 r.household_id,
        tenantId:                    r.tenant_id,
        recommendationType:          r.recommendation_type,
        priority:                    r.priority,
        reason:                      r.reason,
        suggestedWorkflow:           r.suggested_workflow || undefined,
        suggestedBusinessCategories: cats,
        timingWindow:                r.timing_window || undefined,
        confidenceNote:              r.confidence_note ?? "",
        requiresApproval:            true,
        createdAt:                   r.created_at?.toISOString?.() ?? new Date().toISOString(),
      };
    });
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}
