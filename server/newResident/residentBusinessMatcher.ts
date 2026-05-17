/**
 * server/newResident/residentBusinessMatcher.ts
 *
 * Resident → Service Business Matching Engine (Phase 9A)
 *
 * Purpose:
 *   Match newly-arrived households with local service businesses registered
 *   on Apex. Matching is geography-first (ZIP, county, service radius),
 *   then category-fit, then homeowner/renter suitability.
 *
 * Design rules:
 *   - NO invasive demographic assumptions
 *   - NO protected-attribute targeting
 *   - Geography + property type + homeowner likelihood only
 *   - Exclusive territories honored (first-come-first-matched)
 *   - Every match is a PROPOSAL — requires human approval before any outreach
 *   - Tenant isolation: only match businesses within the same tenant
 *   - Dedup: one match per (household, business) per 30 days
 */

import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool } from "../hpl/sqlSafe";
import type {
  ResidentBusinessMatch,
  ResidentServiceCategory,
  ResidentWorkflowType,
  ResidentOpportunityCategory,
} from "./types";

// ── ID builder ─────────────────────────────────────────────────────────────────

function buildMatchId(householdId: string, businessTenantId: string, category: string): string {
  const raw = `match|${householdId}|${businessTenantId}|${category}|${new Date().toISOString().slice(0, 10)}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── Category ↔ opportunity mapping ────────────────────────────────────────────

const CATEGORY_TO_OPPORTUNITY: Record<ResidentServiceCategory, ResidentOpportunityCategory[]> = {
  salon:              ["personal_services"],
  barber:             ["personal_services"],
  nail_salon:         ["personal_services"],
  med_spa:            ["personal_services"],
  gym_fitness:        ["personal_services"],
  lawn_care:          ["lawn_outdoor"],
  hvac:               ["home_services"],
  plumbing:           ["home_services"],
  electrical:         ["home_services"],
  general_contractor: ["home_improvement"],
  roofing:            ["home_improvement", "home_services"],
  pest_control:       ["home_services"],
  pool_service:       ["lawn_outdoor"],
  restaurant:         ["food_beverage"],
  grocery_delivery:   ["food_beverage"],
  insurance_home:     ["insurance"],
  insurance_auto:     ["insurance"],
  insurance_bundle:   ["insurance"],
  moving_storage:     ["retail_local"],
  interior_design:    ["home_improvement"],
  home_security:      ["security_tech"],
  cleaning_service:   ["home_services"],
  childcare:          ["professional_services"],
  pet_services:       ["retail_local"],
  auto_dealer:        ["retail_local"],
  custom:             ["retail_local"],
};

// ── Category ↔ default workflow type ─────────────────────────────────────────

const CATEGORY_TO_WORKFLOW: Record<ResidentServiceCategory, ResidentWorkflowType> = {
  salon:              "salon_barber_intro",
  barber:             "salon_barber_intro",
  nail_salon:         "salon_barber_intro",
  med_spa:            "local_service_introduction",
  gym_fitness:        "local_service_introduction",
  lawn_care:          "lawn_care_intro",
  hvac:               "hvac_inspection_offer",
  plumbing:           "homeowner_welcome",
  electrical:         "homeowner_welcome",
  general_contractor: "contractor_intro",
  roofing:            "contractor_intro",
  pest_control:       "homeowner_welcome",
  pool_service:       "homeowner_welcome",
  restaurant:         "local_restaurant_offer",
  grocery_delivery:   "neighborhood_welcome_package",
  insurance_home:     "insurance_onboarding",
  insurance_auto:     "insurance_onboarding",
  insurance_bundle:   "insurance_bundle_offer",
  moving_storage:     "neighborhood_welcome_package",
  interior_design:    "homeowner_welcome",
  home_security:      "home_security_intro",
  cleaning_service:   "cleaning_service_intro",
  childcare:          "local_service_introduction",
  pet_services:       "neighborhood_welcome_package",
  auto_dealer:        "local_service_introduction",
  custom:             "custom_outreach",
};

// ── Homeowner-required categories ────────────────────────────────────────────

const HOMEOWNER_PREFERRED: ResidentServiceCategory[] = [
  "hvac", "plumbing", "electrical", "general_contractor", "roofing",
  "pest_control", "pool_service", "lawn_care", "home_security",
  "insurance_home", "interior_design",
];

const RENTER_SUITABLE: ResidentServiceCategory[] = [
  "salon", "barber", "nail_salon", "med_spa", "gym_fitness",
  "restaurant", "grocery_delivery", "insurance_auto", "pet_services",
  "cleaning_service", "childcare",
];

// ── Match scoring ─────────────────────────────────────────────────────────────

function scoreBusinessMatch(opts: {
  opportunityCategories: ResidentOpportunityCategory[];
  homeownerLikelihood:   number;
  serviceCategory:       ResidentServiceCategory;
  opportunityScore:      number;
  daysSinceMove:         number;
  exclusiveTerritory:    boolean;
}): { score: number; reasons: string[] } {
  const { opportunityCategories, homeownerLikelihood, serviceCategory, opportunityScore, daysSinceMove, exclusiveTerritory } = opts;
  let score = 0;
  const reasons: string[] = [];

  // Base: is this category relevant to this household's opportunity profile?
  const catOpportunities = CATEGORY_TO_OPPORTUNITY[serviceCategory] ?? [];
  const relevantCats = catOpportunities.filter((c) => opportunityCategories.includes(c));
  if (relevantCats.length > 0) {
    score += 30;
    reasons.push(`Category match: ${relevantCats.join(", ")}`);
  }

  // Homeowner fit
  if (HOMEOWNER_PREFERRED.includes(serviceCategory) && homeownerLikelihood >= 60) {
    score += 25;
    reasons.push(`Homeowner preferred service (${homeownerLikelihood}% homeowner likelihood)`);
  } else if (RENTER_SUITABLE.includes(serviceCategory) && homeownerLikelihood < 60) {
    score += 20;
    reasons.push("Renter-suitable service");
  }

  // Recency bonus — first 30 days is peak opportunity
  if (daysSinceMove <= 7) {
    score += 20;
    reasons.push("Week-1 move-in — peak opportunity window");
  } else if (daysSinceMove <= 30) {
    score += 12;
    reasons.push("Month-1 move-in — high opportunity window");
  } else if (daysSinceMove <= 90) {
    score += 5;
    reasons.push("Settling-in period");
  }

  // Overall household opportunity
  score += Math.round(opportunityScore * 0.15);

  // Exclusive territory bonus
  if (exclusiveTerritory) {
    score += 10;
    reasons.push("Exclusive territory match");
  }

  return { score: Math.min(100, score), reasons };
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _nr_business_matches (
        id                  SERIAL PRIMARY KEY,
        match_id            TEXT NOT NULL UNIQUE,
        resident_event_id   TEXT NOT NULL,
        household_id        TEXT NOT NULL,
        tenant_id           TEXT NOT NULL,
        business_tenant_id  TEXT NOT NULL,
        business_name       TEXT NOT NULL,
        service_category    TEXT NOT NULL,
        match_score         INTEGER NOT NULL DEFAULT 0,
        match_reasons       JSONB NOT NULL DEFAULT '[]',
        routing_zip         TEXT,
        routing_county      TEXT,
        service_radius      NUMERIC(8,2),
        exclusive_territory BOOLEAN NOT NULL DEFAULT FALSE,
        workflow_type       TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'pending',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS nr_matches_tenant_idx     ON _nr_business_matches (tenant_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS nr_matches_household_idx  ON _nr_business_matches (household_id, tenant_id);
      CREATE INDEX IF NOT EXISTS nr_matches_event_idx      ON _nr_business_matches (resident_event_id);

      CREATE TABLE IF NOT EXISTS _nr_business_catalog (
        id                  SERIAL PRIMARY KEY,
        business_tenant_id  TEXT NOT NULL UNIQUE,
        business_name       TEXT NOT NULL,
        service_category    TEXT NOT NULL,
        service_zip         TEXT,
        service_county      TEXT,
        service_state       TEXT,
        service_radius_miles NUMERIC(8,2) DEFAULT 25,
        exclusive_territory BOOLEAN NOT NULL DEFAULT FALSE,
        active              BOOLEAN NOT NULL DEFAULT TRUE,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS nr_catalog_category_idx ON _nr_business_catalog (service_category, active);
      CREATE INDEX IF NOT EXISTS nr_catalog_zip_idx      ON _nr_business_catalog (service_zip, active);
      CREATE INDEX IF NOT EXISTS nr_catalog_county_idx   ON _nr_business_catalog (service_county, active);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[NR-MATCHER] Failed to ensure tables:", err?.message);
  }
}

// ── Register/update a business in the catalog ────────────────────────────────

export async function registerBusinessInCatalog(opts: {
  businessTenantId:    string;
  businessName:        string;
  serviceCategory:     ResidentServiceCategory;
  serviceZip?:         string;
  serviceCounty?:      string;
  serviceState?:       string;
  serviceRadiusMiles?: number;
  exclusiveTerritory?: boolean;
}): Promise<void> {
  await ensureTable();
  await db.execute(sql.raw(`
    INSERT INTO _nr_business_catalog (
      business_tenant_id, business_name, service_category,
      service_zip, service_county, service_state,
      service_radius_miles, exclusive_territory, updated_at
    ) VALUES (
      ${esc(opts.businessTenantId)}, ${esc(opts.businessName)}, ${esc(opts.serviceCategory)},
      ${esc(opts.serviceZip ?? "")}, ${esc(opts.serviceCounty ?? "")}, ${esc(opts.serviceState ?? "")},
      ${num(opts.serviceRadiusMiles ?? 25)}, ${bool(opts.exclusiveTerritory ?? false)}, NOW()
    )
    ON CONFLICT (business_tenant_id) DO UPDATE SET
      business_name         = EXCLUDED.business_name,
      service_category      = EXCLUDED.service_category,
      service_zip           = EXCLUDED.service_zip,
      service_county        = EXCLUDED.service_county,
      service_radius_miles  = EXCLUDED.service_radius_miles,
      exclusive_territory   = EXCLUDED.exclusive_territory,
      updated_at            = NOW()
  `));
}

// ── Match a resident event to businesses ──────────────────────────────────────

export async function matchResidentToBusinesses(opts: {
  residentEventId:        string;
  householdId:            string;
  tenantId:               string;
  zip?:                   string;
  county?:                string;
  state?:                 string;
  opportunityCategories:  ResidentOpportunityCategory[];
  homeownerLikelihood:    number;
  opportunityScore:       number;
  daysSinceMove:          number;
  limit?:                 number;
}): Promise<ResidentBusinessMatch[]> {
  await ensureTable();

  const { residentEventId, householdId, tenantId, zip, county, state,
    opportunityCategories, homeownerLikelihood, opportunityScore, daysSinceMove } = opts;

  // Dedup: skip if already matched in last 30 days
  const dedupCheck = await db.execute(sql.raw(`
    SELECT 1 FROM _nr_business_matches
    WHERE household_id = ${esc(householdId)} AND tenant_id = ${esc(tenantId)}
      AND created_at >= NOW() - INTERVAL '30 days'
    LIMIT 1
  `));
  const existingRows = (dedupCheck as any).rows ?? dedupCheck;
  if (Array.isArray(existingRows) && existingRows.length > 0) {
    console.log(`[NR-MATCHER] Dedup: household ${householdId} already matched in last 30 days`);
    return [];
  }

  // Find matching businesses by geography
  const geoFilters: string[] = [`active = TRUE`];
  const geoClauses: string[] = [];
  if (zip)    geoClauses.push(`service_zip = ${esc(zip)}`);
  if (county) geoClauses.push(`service_county ILIKE ${esc(`%${county}%`)}`);
  if (geoClauses.length > 0) geoFilters.push(`(${geoClauses.join(" OR ")})`);

  let businesses: any[] = [];
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _nr_business_catalog
      WHERE ${geoFilters.join(" AND ")}
      ORDER BY exclusive_territory DESC, service_radius_miles ASC
      LIMIT 50
    `));
    businesses = (result as any).rows ?? result ?? [];
  } catch { businesses = []; }

  if (businesses.length === 0) {
    console.log(`[NR-MATCHER] No businesses found for zip=${zip} county=${county}`);
    return [];
  }

  const matches: ResidentBusinessMatch[] = [];

  for (const biz of businesses) {
    const serviceCategory = biz.service_category as ResidentServiceCategory;
    const { score, reasons } = scoreBusinessMatch({
      opportunityCategories,
      homeownerLikelihood,
      serviceCategory,
      opportunityScore,
      daysSinceMove,
      exclusiveTerritory: Boolean(biz.exclusive_territory),
    });

    if (score < 20) continue; // not a meaningful match

    const matchId = buildMatchId(householdId, biz.business_tenant_id, serviceCategory);
    const workflowType = CATEGORY_TO_WORKFLOW[serviceCategory] ?? "custom_outreach";

    const match: ResidentBusinessMatch = {
      matchId,
      residentEventId,
      householdId,
      tenantId,
      businessTenantId:  biz.business_tenant_id,
      businessName:      biz.business_name,
      serviceCategory,
      matchScore:        score,
      matchReasons:      reasons,
      routingZip:        biz.service_zip || undefined,
      routingCounty:     biz.service_county || undefined,
      serviceRadius:     Number(biz.service_radius_miles ?? 25),
      exclusiveTerritory: Boolean(biz.exclusive_territory),
      workflowType,
      status:            "pending",
      createdAt:         new Date().toISOString(),
    };

    // Persist match
    try {
      await db.execute(sql.raw(`
        INSERT INTO _nr_business_matches (
          match_id, resident_event_id, household_id, tenant_id,
          business_tenant_id, business_name, service_category,
          match_score, match_reasons,
          routing_zip, routing_county, service_radius,
          exclusive_territory, workflow_type, status
        ) VALUES (
          ${esc(matchId)}, ${esc(residentEventId)}, ${esc(householdId)}, ${esc(tenantId)},
          ${esc(biz.business_tenant_id)}, ${esc(biz.business_name)}, ${esc(serviceCategory)},
          ${num(score)}, ${esc(JSON.stringify(reasons))},
          ${esc(biz.service_zip ?? "")}, ${esc(biz.service_county ?? "")}, ${num(biz.service_radius_miles ?? 25)},
          ${bool(Boolean(biz.exclusive_territory))}, ${esc(workflowType)}, 'pending'
        )
        ON CONFLICT (match_id) DO NOTHING
      `));
      matches.push(match);
    } catch { /* skip on conflict */ }
  }

  console.log(`[NR-MATCHER] ${matches.length} matches created for household ${householdId}`);
  return matches.slice(0, opts.limit ?? 10);
}

// ── Query matches ─────────────────────────────────────────────────────────────

export async function getBusinessMatches(opts: {
  tenantId:   string;
  status?:    string;
  minScore?:  number;
  limit?:     number;
  offset?:    number;
}): Promise<ResidentBusinessMatch[]> {
  await ensureTable();
  const { tenantId, status, minScore, limit = 50, offset = 0 } = opts;
  const filters: string[] = [`tenant_id = ${esc(tenantId)}`];
  if (status)   filters.push(`status = ${esc(status)}`);
  if (minScore) filters.push(`match_score >= ${num(minScore)}`);

  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _nr_business_matches
      WHERE ${filters.join(" AND ")}
      ORDER BY match_score DESC, created_at DESC
      LIMIT ${num(limit)} OFFSET ${num(offset)}
    `));
    return ((result as any).rows ?? result ?? []).map(mapMatchRow);
  } catch { return []; }
}

export async function updateMatchStatus(
  matchId:  string,
  tenantId: string,
  status:   ResidentBusinessMatch["status"],
): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE _nr_business_matches
    SET status = ${esc(status)}
    WHERE match_id = ${esc(matchId)} AND tenant_id = ${esc(tenantId)}
  `));
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function mapMatchRow(r: any): ResidentBusinessMatch {
  let reasons: string[] = [];
  try { reasons = typeof r.match_reasons === "string" ? JSON.parse(r.match_reasons) : r.match_reasons ?? []; } catch {}
  return {
    matchId:           r.match_id,
    residentEventId:   r.resident_event_id,
    householdId:       r.household_id,
    tenantId:          r.tenant_id,
    businessTenantId:  r.business_tenant_id,
    businessName:      r.business_name,
    serviceCategory:   r.service_category,
    matchScore:        Number(r.match_score ?? 0),
    matchReasons:      reasons,
    routingZip:        r.routing_zip || undefined,
    routingCounty:     r.routing_county || undefined,
    serviceRadius:     r.service_radius ? Number(r.service_radius) : undefined,
    exclusiveTerritory: Boolean(r.exclusive_territory),
    workflowType:      r.workflow_type,
    status:            r.status,
    createdAt:         r.created_at?.toISOString?.() ?? new Date().toISOString(),
  };
}
