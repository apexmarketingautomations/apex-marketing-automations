/**
 * server/newResident/residentOpportunityScoring.ts
 *
 * Resident Opportunity Scoring Engine (Phase 9A)
 *
 * Purpose:
 *   Score individual household opportunities across multiple dimensions
 *   (home services, personal services, insurance, local business) using
 *   public-record signals — no PII inferences, no protected attributes.
 *
 * Scoring model:
 *   - Recency:           40% weight — highest in weeks 1-4 post move
 *   - Move confidence:   25% weight — confidence tier of the detection
 *   - Homeowner status:  20% weight — higher for home services categories
 *   - Property value:    10% weight — proxy for service opportunity size
 *   - Signal richness:    5% weight — more signals = more certainty
 *
 * All scores are 0–100. Scores never regress (GREATEST() upsert).
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num } from "../hpl/sqlSafe";
import type { ResidentOpportunityScore, ResidentOpportunityCategory, ResidentWorkflowType } from "./types";

// ── Recency decay function ────────────────────────────────────────────────────

/**
 * Returns a 0–100 recency score.
 * Day 0  = 100
 * Day 7  = ~90
 * Day 30 = ~65
 * Day 90 = ~35
 * Day 180 = ~10
 */
export function recencyScore(daysSinceMove: number): number {
  if (daysSinceMove <= 0) return 100;
  // Exponential decay: score = 100 * e^(-daysSinceMove / 60)
  const raw = 100 * Math.exp(-daysSinceMove / 60);
  return Math.round(Math.max(0, Math.min(100, raw)));
}

// ── Home value tier ───────────────────────────────────────────────────────────

function homeValueScore(estimatedHomeValue?: number): number {
  if (!estimatedHomeValue) return 30; // neutral baseline
  if (estimatedHomeValue >= 800_000) return 100;
  if (estimatedHomeValue >= 500_000) return 85;
  if (estimatedHomeValue >= 300_000) return 70;
  if (estimatedHomeValue >= 200_000) return 55;
  if (estimatedHomeValue >= 150_000) return 40;
  return 25;
}

// ── Signal richness ───────────────────────────────────────────────────────────

function signalRichnessScore(signalCount: number): number {
  if (signalCount >= 4) return 100;
  if (signalCount === 3) return 80;
  if (signalCount === 2) return 60;
  if (signalCount === 1) return 40;
  return 20;
}

// ── Category-specific scoring ─────────────────────────────────────────────────

function categoryScore(
  category: ResidentOpportunityCategory,
  homeownerLikelihood: number,
  recency: number,
  homeValue: number,
): number {
  switch (category) {
    case "home_services":
      return Math.round((homeownerLikelihood * 0.5) + (recency * 0.3) + (homeValue * 0.2));
    case "home_improvement":
      return Math.round((homeownerLikelihood * 0.4) + (recency * 0.4) + (homeValue * 0.2));
    case "insurance":
      return Math.round((homeownerLikelihood * 0.45) + (recency * 0.35) + (homeValue * 0.2));
    case "personal_services":
      // Universal — everyone needs a barber, salon etc.
      return Math.round((recency * 0.6) + 40);
    case "food_beverage":
      return Math.round((recency * 0.5) + 45);
    case "lawn_outdoor":
      return Math.round((homeownerLikelihood * 0.55) + (recency * 0.3) + (homeValue * 0.15));
    case "security_tech":
      return Math.round((homeownerLikelihood * 0.4) + (recency * 0.35) + (homeValue * 0.25));
    case "retail_local":
      return Math.round((recency * 0.55) + 35);
    case "professional_services":
      return Math.round((recency * 0.4) + (homeownerLikelihood * 0.3) + 20);
    default:
      return Math.round((recency * 0.5) + 30);
  }
}

// ── Recommended workflows from top categories ─────────────────────────────────

function recommendWorkflows(
  categories: ResidentOpportunityCategory[],
  homeownerLikelihood: number,
  daysSinceMove: number,
): ResidentWorkflowType[] {
  const workflows: ResidentWorkflowType[] = [];

  if (categories.includes("home_services") && homeownerLikelihood >= 60) {
    workflows.push("hvac_inspection_offer");
  }
  if (categories.includes("insurance") && homeownerLikelihood >= 60) {
    workflows.push("insurance_bundle_offer");
  } else if (categories.includes("insurance")) {
    workflows.push("insurance_onboarding");
  }
  if (categories.includes("personal_services")) {
    workflows.push("salon_barber_intro");
  }
  if (categories.includes("lawn_outdoor") && homeownerLikelihood >= 60) {
    workflows.push("lawn_care_intro");
  }
  if (categories.includes("food_beverage")) {
    workflows.push("local_restaurant_offer");
  }
  if (categories.includes("home_improvement") && homeownerLikelihood >= 60) {
    workflows.push("contractor_intro");
  }
  if (daysSinceMove <= 14) {
    workflows.push("neighborhood_welcome_package");
  }
  if (categories.includes("security_tech")) {
    workflows.push("home_security_intro");
  }

  // De-duplicate
  return [...new Set(workflows)].slice(0, 5);
}

// ── Main scoring function ─────────────────────────────────────────────────────

export function scoreResidentOpportunity(opts: {
  householdId:          string;
  tenantId:             string;
  moveConfidence:       number;
  homeownerLikelihood:  number;
  daysSinceMove:        number;
  signalCount:          number;
  estimatedHomeValue?:  number;
  opportunityCategories: ResidentOpportunityCategory[];
}): ResidentOpportunityScore {
  const recency     = recencyScore(opts.daysSinceMove);
  const homeValue   = homeValueScore(opts.estimatedHomeValue);
  const signalRich  = signalRichnessScore(opts.signalCount);
  const homeowner   = opts.homeownerLikelihood;
  const confidence  = opts.moveConfidence;

  // Overall score
  const overallScore = Math.round(
    recency    * 0.40 +
    confidence * 0.25 +
    homeowner  * 0.20 +
    homeValue  * 0.10 +
    signalRich * 0.05
  );

  // Category scores
  const homeServiceScore     = Math.min(100, categoryScore("home_services",     homeowner, recency, homeValue));
  const personalServiceScore = Math.min(100, categoryScore("personal_services", homeowner, recency, homeValue));
  const insuranceScore       = Math.min(100, categoryScore("insurance",          homeowner, recency, homeValue));
  const localBusinessScore   = Math.min(100, categoryScore("food_beverage",     homeowner, recency, homeValue));
  const timingScore          = recency;

  // Top categories by score
  const scoredCats = opts.opportunityCategories
    .map((cat) => ({
      cat,
      score: categoryScore(cat, homeowner, recency, homeValue),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((c) => c.cat);

  const recommendedWorkflows = recommendWorkflows(opts.opportunityCategories, homeowner, opts.daysSinceMove);

  return {
    householdId:   opts.householdId,
    tenantId:      opts.tenantId,
    overallScore:  Math.min(100, overallScore),
    homeServiceScore,
    personalServiceScore,
    insuranceScore,
    localBusinessScore,
    timingScore,
    scoreBreakdown: {
      moveConfidenceWeight:      confidence * 0.25,
      recencyWeight:             recency * 0.40,
      homeownerWeight:           homeowner * 0.20,
      propertyValueWeight:       homeValue * 0.10,
      opportunityCategoryWeight: signalRich * 0.05,
    },
    topCategories:        scoredCats,
    recommendedWorkflows,
    scoredAt:             new Date().toISOString(),
  };
}

// ── Persist scores ────────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _nr_opportunity_scores (
        id                      SERIAL PRIMARY KEY,
        household_id            TEXT NOT NULL,
        tenant_id               TEXT NOT NULL,
        overall_score           INTEGER NOT NULL DEFAULT 0,
        home_service_score      INTEGER NOT NULL DEFAULT 0,
        personal_service_score  INTEGER NOT NULL DEFAULT 0,
        insurance_score         INTEGER NOT NULL DEFAULT 0,
        local_business_score    INTEGER NOT NULL DEFAULT 0,
        timing_score            INTEGER NOT NULL DEFAULT 0,
        top_categories          JSONB NOT NULL DEFAULT '[]',
        recommended_workflows   JSONB NOT NULL DEFAULT '[]',
        score_breakdown         JSONB NOT NULL DEFAULT '{}',
        scored_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (household_id, tenant_id)
      );
      CREATE INDEX IF NOT EXISTS nr_scores_tenant_idx ON _nr_opportunity_scores (tenant_id, overall_score DESC);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[NR-SCORING] Failed to ensure table:", err?.message);
  }
}

export async function persistOpportunityScore(score: ResidentOpportunityScore): Promise<void> {
  await ensureTable();
  await db.execute(sql.raw(`
    INSERT INTO _nr_opportunity_scores (
      household_id, tenant_id,
      overall_score, home_service_score, personal_service_score,
      insurance_score, local_business_score, timing_score,
      top_categories, recommended_workflows, score_breakdown, scored_at
    ) VALUES (
      ${esc(score.householdId)}, ${esc(score.tenantId)},
      ${num(score.overallScore)}, ${num(score.homeServiceScore)}, ${num(score.personalServiceScore)},
      ${num(score.insuranceScore)}, ${num(score.localBusinessScore)}, ${num(score.timingScore)},
      ${esc(JSON.stringify(score.topCategories))},
      ${esc(JSON.stringify(score.recommendedWorkflows))},
      ${esc(JSON.stringify(score.scoreBreakdown))},
      NOW()
    )
    ON CONFLICT (household_id, tenant_id) DO UPDATE SET
      overall_score           = GREATEST(_nr_opportunity_scores.overall_score, EXCLUDED.overall_score),
      home_service_score      = GREATEST(_nr_opportunity_scores.home_service_score, EXCLUDED.home_service_score),
      personal_service_score  = GREATEST(_nr_opportunity_scores.personal_service_score, EXCLUDED.personal_service_score),
      insurance_score         = GREATEST(_nr_opportunity_scores.insurance_score, EXCLUDED.insurance_score),
      local_business_score    = GREATEST(_nr_opportunity_scores.local_business_score, EXCLUDED.local_business_score),
      timing_score            = EXCLUDED.timing_score,
      top_categories          = EXCLUDED.top_categories,
      recommended_workflows   = EXCLUDED.recommended_workflows,
      score_breakdown         = EXCLUDED.score_breakdown,
      scored_at               = NOW()
  `));
}

export async function getTopScoredHouseholds(opts: {
  tenantId:  string;
  minScore?: number;
  limit?:    number;
}): Promise<ResidentOpportunityScore[]> {
  await ensureTable();
  const { tenantId, minScore = 0, limit = 50 } = opts;
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _nr_opportunity_scores
      WHERE tenant_id = ${esc(tenantId)} AND overall_score >= ${num(minScore)}
      ORDER BY overall_score DESC
      LIMIT ${num(limit)}
    `));
    return ((result as any).rows ?? result ?? []).map((r: any): ResidentOpportunityScore => {
      let topCats: any[] = [];
      let recs: any[] = [];
      let breakdown: any = {};
      try { topCats  = typeof r.top_categories === "string" ? JSON.parse(r.top_categories) : r.top_categories ?? []; } catch {}  // allow-silent-catch: non-fatal, returns safe default
      try { recs     = typeof r.recommended_workflows === "string" ? JSON.parse(r.recommended_workflows) : r.recommended_workflows ?? []; } catch {}  // allow-silent-catch: non-fatal, returns safe default
      try { breakdown = typeof r.score_breakdown === "string" ? JSON.parse(r.score_breakdown) : r.score_breakdown ?? {}; } catch {}  // allow-silent-catch: non-fatal, returns safe default
      return {
        householdId:           r.household_id,
        tenantId:              r.tenant_id,
        overallScore:          Number(r.overall_score ?? 0),
        homeServiceScore:      Number(r.home_service_score ?? 0),
        personalServiceScore:  Number(r.personal_service_score ?? 0),
        insuranceScore:        Number(r.insurance_score ?? 0),
        localBusinessScore:    Number(r.local_business_score ?? 0),
        timingScore:           Number(r.timing_score ?? 0),
        scoreBreakdown:        breakdown,
        topCategories:         topCats,
        recommendedWorkflows:  recs,
        scoredAt:              r.scored_at?.toISOString?.() ?? new Date().toISOString(),
      };
    });
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}
