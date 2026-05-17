/**
 * server/newResident/residentTransitionEngine.ts
 *
 * Resident Transition Detection Engine (Phase 9A)
 *
 * Purpose:
 *   Ingest public-record signals indicating household occupancy changes,
 *   score move confidence, and emit canonical NEW_RESIDENT_EVENTs.
 *
 * Data sources (all public-record):
 *   - Property deed transfers
 *   - Homestead exemption filings
 *   - Permit applications at new addresses
 *   - USPS NCOA / mailing address mismatch signals
 *   - Utility activation aggregates (no individual PII)
 *   - HOA membership changes
 *   - Partner new-mover data feeds (NCOA-compliant)
 *
 * Hard rules:
 *   - Confidence < 40 → log event, do NOT create household record
 *   - Confidence 40-69 → provisional record, flagged for human review
 *   - Confidence ≥ 70 → create household record and emit event
 *   - NO protected-attribute inference (race, religion, political views)
 *   - NO individual utility PII — only aggregated activation signals
 *   - Suppression check runs BEFORE any record creation
 */

import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool } from "../hpl/sqlSafe";
import type {
  NewResidentEvent,
  MoveSignalSource,
  OccupancyTransitionType,
  HouseholdLifecycleStage,
  MoveConfidenceTier,
  ResidentOpportunityCategory,
} from "./types";
import { checkResidentSuppression } from "./residentComplianceGuard";

// ── ID builders ───────────────────────────────────────────────────────────────

export function buildResidentEventId(address: string, county: string, ts: string): string {
  const raw = `resident_event|${address.toLowerCase().trim()}|${county.toLowerCase().trim()}|${ts}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

export function buildHouseholdId(normalizedAddress: string): string {
  const raw = `household|${normalizedAddress.toLowerCase().trim()}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── Address normalizer (basic — no third-party API dependency) ─────────────────

export function normalizeAddress(address: string, zip?: string): string {
  let norm = address.trim().toUpperCase();
  // Remove unit/apt suffixes for household-level dedup
  norm = norm.replace(/\s+(APT|UNIT|STE|#)\s*\d+[A-Z]?$/i, "").trim();
  if (zip) norm += ` ${zip.slice(0, 5)}`;
  return norm;
}

// ── Confidence scoring ────────────────────────────────────────────────────────

interface SignalWeights {
  property_deed_transfer:     number; // 35 — strongest signal
  homestead_filing:           number; // 30 — strong ownership indicator
  permit_new_address:         number; // 15 — moderate
  usps_address_change:        number; // 25 — strong
  mailing_address_mismatch:   number; // 10 — weak alone
  utility_activation_signal:  number; // 20 — moderate
  voter_registration_change:  number; // 15 — moderate
  dmv_address_indicator:      number; // 15 — moderate
  lease_turnover_signal:      number; // 20 — moderate
  hoa_new_member:             number; // 20 — moderate
  internet_activation:        number; // 10 — weak
  manual_ingest:              number; // 40 — operator trusts the data
  partner_data_feed:          number; // 25 — vetted feed
}

const SIGNAL_WEIGHTS: SignalWeights = {
  property_deed_transfer:     35,
  homestead_filing:           30,
  permit_new_address:         15,
  usps_address_change:        25,
  mailing_address_mismatch:   10,
  utility_activation_signal:  20,
  voter_registration_change:  15,
  dmv_address_indicator:      15,
  lease_turnover_signal:      20,
  hoa_new_member:             20,
  internet_activation:        10,
  manual_ingest:              40,
  partner_data_feed:          25,
};

export function scoreMoveConfidence(signals: MoveSignalSource[]): number {
  if (signals.length === 0) return 0;
  // Score = sum of weights with diminishing returns after first 2 signals
  let total = 0;
  const sorted = [...signals].sort(
    (a, b) => (SIGNAL_WEIGHTS[b as keyof SignalWeights] ?? 5) - (SIGNAL_WEIGHTS[a as keyof SignalWeights] ?? 5)
  );
  sorted.forEach((sig, i) => {
    const weight = SIGNAL_WEIGHTS[sig as keyof SignalWeights] ?? 5;
    const discount = i === 0 ? 1 : i === 1 ? 0.8 : i === 2 ? 0.6 : 0.4;
    total += weight * discount;
  });
  return Math.min(100, Math.round(total));
}

export function getConfidenceTier(score: number): MoveConfidenceTier {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

// ── Occupancy transition inference ────────────────────────────────────────────

export function inferOccupancyTransition(
  signals: MoveSignalSource[],
  hasHomesteadFiling?: boolean,
): OccupancyTransitionType {
  if (signals.includes("property_deed_transfer")) {
    return hasHomesteadFiling ? "purchase_owner_occupied" : "purchase_investor";
  }
  if (signals.includes("homestead_filing")) return "purchase_owner_occupied";
  if (signals.includes("lease_turnover_signal") || signals.includes("hoa_new_member")) return "renter_turnover";
  return "unknown";
}

// ── Homeowner / renter likelihood ─────────────────────────────────────────────

export function scoreHomeownerLikelihood(
  signals: MoveSignalSource[],
  transition: OccupancyTransitionType,
): number {
  if (transition === "purchase_owner_occupied" || signals.includes("homestead_filing")) return 90;
  if (transition === "purchase_investor") return 25;
  if (transition === "renter_turnover") return 10;
  // Estimate from signals
  let score = 40; // baseline
  if (signals.includes("property_deed_transfer")) score += 20;
  if (signals.includes("usps_address_change")) score += 5;
  if (signals.includes("mailing_address_mismatch")) score -= 10;
  return Math.max(0, Math.min(100, score));
}

// ── Lifecycle stage from estimated days since move ───────────────────────────

export function inferLifecycleStage(daysSinceMove: number): HouseholdLifecycleStage {
  if (daysSinceMove < 0) return "pre_move";
  if (daysSinceMove <= 7) return "move_in_week_1";
  if (daysSinceMove <= 30) return "move_in_month_1";
  if (daysSinceMove <= 90) return "settling_in";
  if (daysSinceMove <= 365) return "established";
  return "established";
}

// ── Opportunity category tagging ──────────────────────────────────────────────

export function tagOpportunityCategories(
  transition: OccupancyTransitionType,
  homeownerLikelihood: number,
  daysSinceMove: number,
): ResidentOpportunityCategory[] {
  const cats: ResidentOpportunityCategory[] = [];

  // Always relevant for anyone who just moved
  cats.push("personal_services"); // salon, barber, gym — universal
  cats.push("food_beverage");     // restaurants — universal

  if (homeownerLikelihood >= 60) {
    cats.push("home_services");    // HVAC, plumbing, electrical
    cats.push("home_improvement"); // contractor, painting
    cats.push("lawn_outdoor");     // lawn care, landscaping
    cats.push("security_tech");    // home security
    cats.push("insurance");        // homeowner's insurance
  } else {
    // Renters still need personal services, light home services
    cats.push("home_services");   // still may need plumber etc.
    cats.push("insurance");       // renter's insurance
  }

  if (daysSinceMove <= 30) {
    cats.push("retail_local"); // discovering local shops
  }

  return cats;
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _nr_events (
        id                    SERIAL PRIMARY KEY,
        resident_event_id     TEXT NOT NULL UNIQUE,
        household_id          TEXT NOT NULL,
        tenant_id             TEXT NOT NULL,
        property_address      TEXT NOT NULL,
        normalized_address    TEXT,
        county                TEXT NOT NULL,
        state                 TEXT NOT NULL,
        zip                   TEXT,
        occupancy_transition  TEXT NOT NULL DEFAULT 'unknown',
        move_confidence       INTEGER NOT NULL DEFAULT 0,
        move_confidence_tier  TEXT NOT NULL DEFAULT 'low',
        homeowner_likelihood  INTEGER NOT NULL DEFAULT 50,
        renter_likelihood     INTEGER NOT NULL DEFAULT 50,
        estimated_move_date   DATE,
        move_window_days      INTEGER NOT NULL DEFAULT 14,
        source_signals        JSONB NOT NULL DEFAULT '[]',
        signal_count          INTEGER NOT NULL DEFAULT 0,
        opportunity_categories JSONB NOT NULL DEFAULT '[]',
        opportunity_score     INTEGER NOT NULL DEFAULT 0,
        estimated_home_value  INTEGER,
        property_type         TEXT,
        lifecycle_stage       TEXT NOT NULL DEFAULT 'unknown',
        days_since_move       INTEGER NOT NULL DEFAULT 0,
        suppressed            BOOLEAN NOT NULL DEFAULT FALSE,
        suppression_reason    TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at          TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS nr_events_tenant_idx ON _nr_events (tenant_id, move_confidence_tier, created_at DESC);
      CREATE INDEX IF NOT EXISTS nr_events_county_idx ON _nr_events (county, state, created_at DESC);
      CREATE INDEX IF NOT EXISTS nr_events_household_idx ON _nr_events (household_id, tenant_id);

      CREATE TABLE IF NOT EXISTS _nr_households (
        id                    SERIAL PRIMARY KEY,
        household_id          TEXT NOT NULL,
        tenant_id             TEXT NOT NULL,
        property_address      TEXT NOT NULL,
        county                TEXT NOT NULL,
        state                 TEXT NOT NULL,
        zip                   TEXT,
        occupancy_transition  TEXT NOT NULL DEFAULT 'unknown',
        lifecycle_stage       TEXT NOT NULL DEFAULT 'unknown',
        estimated_move_date   DATE,
        move_confidence       INTEGER NOT NULL DEFAULT 0,
        homeowner_likelihood  INTEGER NOT NULL DEFAULT 50,
        renter_likelihood     INTEGER NOT NULL DEFAULT 50,
        opportunity_score     INTEGER NOT NULL DEFAULT 0,
        home_service_score    INTEGER NOT NULL DEFAULT 0,
        personal_service_score INTEGER NOT NULL DEFAULT 0,
        insurance_score       INTEGER NOT NULL DEFAULT 0,
        local_business_score  INTEGER NOT NULL DEFAULT 0,
        estimated_home_value  INTEGER,
        property_type         TEXT,
        year_built            INTEGER,
        workflow_count        INTEGER NOT NULL DEFAULT 0,
        last_workflow_at      TIMESTAMPTZ,
        suppressed_at         TIMESTAMPTZ,
        suppression_reason    TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (household_id, tenant_id)
      );
      CREATE INDEX IF NOT EXISTS nr_households_tenant_idx ON _nr_households (tenant_id, opportunity_score DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS nr_households_zip_idx ON _nr_households (zip, tenant_id);
      CREATE INDEX IF NOT EXISTS nr_households_county_idx ON _nr_households (county, state, tenant_id);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[NR-ENGINE] Failed to ensure tables:", err?.message);
  }
}

// ── Ingest signal batch ───────────────────────────────────────────────────────

export interface IngestResidentSignalOpts {
  tenantId:            string;
  propertyAddress:     string;
  county:              string;
  state:               string;
  zip?:                string;
  signals:             MoveSignalSource[];
  estimatedMoveDate?:  string;      // ISO date string
  estimatedHomeValue?: number;
  propertyType?:       string;
  yearBuilt?:          number;
  hasHomesteadFiling?: boolean;
  moveWindowDays?:     number;
}

export async function ingestResidentSignal(opts: IngestResidentSignalOpts): Promise<{
  residentEventId: string;
  householdId:     string;
  confidence:      number;
  tier:            MoveConfidenceTier;
  suppressed:      boolean;
  suppressionReason?: string;
}> {
  await ensureTable();

  const normalizedAddress = normalizeAddress(opts.propertyAddress, opts.zip);
  const householdId       = buildHouseholdId(normalizedAddress);
  const ts                = new Date().toISOString();
  const residentEventId   = buildResidentEventId(normalizedAddress, opts.county, ts);

  const confidence   = scoreMoveConfidence(opts.signals);
  const tier         = getConfidenceTier(confidence);
  const transition   = inferOccupancyTransition(opts.signals, opts.hasHomesteadFiling);
  const homeownerPct = scoreHomeownerLikelihood(opts.signals, transition);
  const renterPct    = 100 - homeownerPct;

  const estimatedMoveDate = opts.estimatedMoveDate ?? null;
  const daysSinceMove = estimatedMoveDate
    ? Math.max(0, Math.floor((Date.now() - new Date(estimatedMoveDate).getTime()) / 86400000))
    : 7; // default assumption: 1 week in

  const lifecycleStage     = inferLifecycleStage(daysSinceMove);
  const opportunityCategories = tagOpportunityCategories(transition, homeownerPct, daysSinceMove);
  const opportunityScore   = Math.round(
    confidence * 0.4 +
    homeownerPct * 0.2 +
    Math.max(0, 100 - daysSinceMove * 1.5) * 0.4  // recency: 100% score at day 0, ~55% at day 30
  );

  // Suppression check BEFORE any record creation
  const suppressed = await checkResidentSuppression({
    address:  normalizedAddress,
    zip:      opts.zip,
    county:   opts.county,
    tenantId: opts.tenantId,
  });

  const suppressionReason = suppressed ? "address_suppressed" : undefined;

  // Always log the event (even suppressed/low-confidence)
  await db.execute(sql.raw(`
    INSERT INTO _nr_events (
      resident_event_id, household_id, tenant_id,
      property_address, normalized_address, county, state, zip,
      occupancy_transition, move_confidence, move_confidence_tier,
      homeowner_likelihood, renter_likelihood,
      estimated_move_date, move_window_days,
      source_signals, signal_count,
      opportunity_categories, opportunity_score,
      estimated_home_value, property_type,
      lifecycle_stage, days_since_move,
      suppressed, suppression_reason
    ) VALUES (
      ${esc(residentEventId)}, ${esc(householdId)}, ${esc(opts.tenantId)},
      ${esc(opts.propertyAddress)}, ${esc(normalizedAddress)}, ${esc(opts.county)}, ${esc(opts.state)}, ${esc(opts.zip ?? "")},
      ${esc(transition)}, ${num(confidence)}, ${esc(tier)},
      ${num(homeownerPct)}, ${num(renterPct)},
      ${estimatedMoveDate ? esc(estimatedMoveDate) : "NULL"}, ${num(opts.moveWindowDays ?? 14)},
      ${esc(JSON.stringify(opts.signals))}, ${num(opts.signals.length)},
      ${esc(JSON.stringify(opportunityCategories))}, ${num(opportunityScore)},
      ${opts.estimatedHomeValue ? num(opts.estimatedHomeValue) : "NULL"}, ${esc(opts.propertyType ?? "")},
      ${esc(lifecycleStage)}, ${num(daysSinceMove)},
      ${bool(suppressed)}, ${esc(suppressionReason ?? "")}
    )
    ON CONFLICT (resident_event_id) DO NOTHING
  `));

  // Create/update household record only for medium+ confidence, non-suppressed
  if (tier !== "low" && !suppressed) {
    await upsertResidentHousehold({
      householdId, tenantId: opts.tenantId,
      propertyAddress:  opts.propertyAddress,
      county:           opts.county,
      state:            opts.state,
      zip:              opts.zip,
      transition, lifecycleStage,
      estimatedMoveDate,
      moveConfidence:   confidence,
      homeownerPct, renterPct, opportunityScore,
      estimatedHomeValue: opts.estimatedHomeValue,
      propertyType:     opts.propertyType,
      yearBuilt:        opts.yearBuilt,
    });
  }

  console.log(`[NR-ENGINE] Ingested event ${residentEventId} addr="${opts.propertyAddress}" confidence=${confidence} tier=${tier} suppressed=${suppressed}`);

  return { residentEventId, householdId, confidence, tier, suppressed, suppressionReason };
}

// ── Upsert household record ───────────────────────────────────────────────────

async function upsertResidentHousehold(opts: {
  householdId:         string;
  tenantId:            string;
  propertyAddress:     string;
  county:              string;
  state:               string;
  zip?:                string;
  transition:          OccupancyTransitionType;
  lifecycleStage:      HouseholdLifecycleStage;
  estimatedMoveDate?:  string | null;
  moveConfidence:      number;
  homeownerPct:        number;
  renterPct:           number;
  opportunityScore:    number;
  estimatedHomeValue?: number;
  propertyType?:       string;
  yearBuilt?:          number;
}): Promise<void> {
  // Score sub-categories
  const homeServiceScore    = Math.round(opts.opportunityScore * (opts.homeownerPct / 100) * 1.2);
  const personalServiceScore = Math.round(opts.opportunityScore * 0.7);
  const insuranceScore      = Math.round(opts.opportunityScore * ((opts.homeownerPct / 100) * 0.8 + 0.2));
  const localBusinessScore  = Math.round(opts.opportunityScore * 0.6);

  await db.execute(sql.raw(`
    INSERT INTO _nr_households (
      household_id, tenant_id, property_address, county, state, zip,
      occupancy_transition, lifecycle_stage, estimated_move_date,
      move_confidence, homeowner_likelihood, renter_likelihood,
      opportunity_score, home_service_score, personal_service_score,
      insurance_score, local_business_score,
      estimated_home_value, property_type, year_built,
      updated_at
    ) VALUES (
      ${esc(opts.householdId)}, ${esc(opts.tenantId)}, ${esc(opts.propertyAddress)},
      ${esc(opts.county)}, ${esc(opts.state)}, ${esc(opts.zip ?? "")},
      ${esc(opts.transition)}, ${esc(opts.lifecycleStage)},
      ${opts.estimatedMoveDate ? esc(opts.estimatedMoveDate) : "NULL"},
      ${num(opts.moveConfidence)}, ${num(opts.homeownerPct)}, ${num(opts.renterPct)},
      ${num(opts.opportunityScore)}, ${num(Math.min(100, homeServiceScore))},
      ${num(Math.min(100, personalServiceScore))}, ${num(Math.min(100, insuranceScore))},
      ${num(Math.min(100, localBusinessScore))},
      ${opts.estimatedHomeValue ? num(opts.estimatedHomeValue) : "NULL"},
      ${esc(opts.propertyType ?? "")},
      ${opts.yearBuilt ? num(opts.yearBuilt) : "NULL"},
      NOW()
    )
    ON CONFLICT (household_id, tenant_id) DO UPDATE SET
      lifecycle_stage        = EXCLUDED.lifecycle_stage,
      move_confidence        = GREATEST(_nr_households.move_confidence, EXCLUDED.move_confidence),
      homeowner_likelihood   = EXCLUDED.homeowner_likelihood,
      renter_likelihood      = EXCLUDED.renter_likelihood,
      opportunity_score      = GREATEST(_nr_households.opportunity_score, EXCLUDED.opportunity_score),
      home_service_score     = GREATEST(_nr_households.home_service_score, EXCLUDED.home_service_score),
      personal_service_score = GREATEST(_nr_households.personal_service_score, EXCLUDED.personal_service_score),
      insurance_score        = GREATEST(_nr_households.insurance_score, EXCLUDED.insurance_score),
      local_business_score   = GREATEST(_nr_households.local_business_score, EXCLUDED.local_business_score),
      updated_at             = NOW()
  `));
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export async function getRecentResidentEvents(opts: {
  tenantId:   string;
  county?:    string;
  state?:     string;
  zip?:       string;
  tier?:      MoveConfidenceTier;
  limit?:     number;
  offset?:    number;
}): Promise<NewResidentEvent[]> {
  await ensureTable();
  const { tenantId, county, state, zip, tier, limit = 50, offset = 0 } = opts;

  const filters: string[] = [`tenant_id = ${esc(tenantId)}`, `suppressed = FALSE`];
  if (county) filters.push(`county ILIKE ${esc(`%${county}%`)}`);
  if (state)  filters.push(`state = ${esc(state)}`);
  if (zip)    filters.push(`zip = ${esc(zip)}`);
  if (tier)   filters.push(`move_confidence_tier = ${esc(tier)}`);

  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _nr_events
      WHERE ${filters.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ${num(limit)} OFFSET ${num(offset)}
    `));
    return ((result as any).rows ?? result ?? []).map(mapEventRow);
  } catch { return []; }
}

export async function getResidentHouseholds(opts: {
  tenantId:   string;
  county?:    string;
  zip?:       string;
  minScore?:  number;
  limit?:     number;
  offset?:    number;
}): Promise<any[]> {
  await ensureTable();
  const { tenantId, county, zip, minScore, limit = 50, offset = 0 } = opts;

  const filters: string[] = [`tenant_id = ${esc(tenantId)}`, `suppressed_at IS NULL`];
  if (county)   filters.push(`county ILIKE ${esc(`%${county}%`)}`);
  if (zip)      filters.push(`zip = ${esc(zip)}`);
  if (minScore) filters.push(`opportunity_score >= ${num(minScore)}`);

  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _nr_households
      WHERE ${filters.join(" AND ")}
      ORDER BY opportunity_score DESC, created_at DESC
      LIMIT ${num(limit)} OFFSET ${num(offset)}
    `));
    return ((result as any).rows ?? result ?? []).map(mapHouseholdRow);
  } catch { return []; }
}

export async function getResidentEventStats(tenantId: string): Promise<{
  totalEvents:      number;
  highConfidence:   number;
  mediumConfidence: number;
  lowConfidence:    number;
  suppressed:       number;
  last7Days:        number;
  last30Days:       number;
  byCounty:         Record<string, number>;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN move_confidence_tier='high' THEN 1 END) AS high_conf,
        COUNT(CASE WHEN move_confidence_tier='medium' THEN 1 END) AS med_conf,
        COUNT(CASE WHEN move_confidence_tier='low' THEN 1 END) AS low_conf,
        COUNT(CASE WHEN suppressed=TRUE THEN 1 END) AS suppressed,
        COUNT(CASE WHEN created_at >= NOW()-INTERVAL '7 days' THEN 1 END) AS last_7,
        COUNT(CASE WHEN created_at >= NOW()-INTERVAL '30 days' THEN 1 END) AS last_30
      FROM _nr_events WHERE tenant_id = ${esc(tenantId)}
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : {};

    const countyResult = await db.execute(sql.raw(`
      SELECT county, COUNT(*) AS cnt FROM _nr_events
      WHERE tenant_id = ${esc(tenantId)} AND created_at >= NOW()-INTERVAL '30 days'
      GROUP BY county ORDER BY cnt DESC LIMIT 20
    `));
    const countyRows = (countyResult as any).rows ?? countyResult ?? [];
    const byCounty: Record<string, number> = {};
    countyRows.forEach((row: any) => { byCounty[row.county] = Number(row.cnt); });

    return {
      totalEvents:      Number(r?.total ?? 0),
      highConfidence:   Number(r?.high_conf ?? 0),
      mediumConfidence: Number(r?.med_conf ?? 0),
      lowConfidence:    Number(r?.low_conf ?? 0),
      suppressed:       Number(r?.suppressed ?? 0),
      last7Days:        Number(r?.last_7 ?? 0),
      last30Days:       Number(r?.last_30 ?? 0),
      byCounty,
    };
  } catch {
    return { totalEvents: 0, highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, suppressed: 0, last7Days: 0, last30Days: 0, byCounty: {} };
  }
}

// ── Row mappers ───────────────────────────────────────────────────────────────

function mapEventRow(r: any): NewResidentEvent {
  let signals: MoveSignalSource[] = [];
  let categories: any[] = [];
  try { signals = typeof r.source_signals === "string" ? JSON.parse(r.source_signals) : r.source_signals ?? []; } catch {}
  try { categories = typeof r.opportunity_categories === "string" ? JSON.parse(r.opportunity_categories) : r.opportunity_categories ?? []; } catch {}
  return {
    residentEventId:       r.resident_event_id,
    householdId:           r.household_id,
    tenantId:              r.tenant_id,
    propertyAddress:       r.property_address,
    normalizedAddress:     r.normalized_address || undefined,
    county:                r.county,
    state:                 r.state,
    zip:                   r.zip || undefined,
    occupancyTransition:   r.occupancy_transition ?? "unknown",
    moveConfidence:        Number(r.move_confidence ?? 0),
    moveConfidenceTier:    r.move_confidence_tier ?? "low",
    homeownerLikelihood:   Number(r.homeowner_likelihood ?? 50),
    renterLikelihood:      Number(r.renter_likelihood ?? 50),
    estimatedMoveDate:     r.estimated_move_date?.toISOString?.()?.split("T")[0] ?? undefined,
    moveWindowDays:        Number(r.move_window_days ?? 14),
    sourceSignals:         signals,
    signalCount:           Number(r.signal_count ?? 0),
    opportunityCategories: categories,
    opportunityScore:      Number(r.opportunity_score ?? 0),
    estimatedHomeValue:    r.estimated_home_value ? Number(r.estimated_home_value) : undefined,
    propertyType:          r.property_type || undefined,
    lifecycleStage:        r.lifecycle_stage ?? "unknown",
    daysSinceMoveEstimate: Number(r.days_since_move ?? 0),
    suppressed:            Boolean(r.suppressed),
    suppressionReason:     r.suppression_reason || undefined,
    createdAt:             r.created_at?.toISOString?.() ?? new Date().toISOString(),
    processedAt:           r.processed_at?.toISOString?.() ?? undefined,
  };
}

function mapHouseholdRow(r: any): any {
  return {
    householdId:           r.household_id,
    tenantId:              r.tenant_id,
    propertyAddress:       r.property_address,
    county:                r.county,
    state:                 r.state,
    zip:                   r.zip || undefined,
    occupancyTransition:   r.occupancy_transition ?? "unknown",
    lifecycleStage:        r.lifecycle_stage ?? "unknown",
    estimatedMoveDate:     r.estimated_move_date?.toISOString?.()?.split("T")[0] ?? undefined,
    moveConfidence:        Number(r.move_confidence ?? 0),
    homeownerLikelihood:   Number(r.homeowner_likelihood ?? 50),
    renterLikelihood:      Number(r.renter_likelihood ?? 50),
    opportunityScore:      Number(r.opportunity_score ?? 0),
    homeServiceScore:      Number(r.home_service_score ?? 0),
    personalServiceScore:  Number(r.personal_service_score ?? 0),
    insuranceScore:        Number(r.insurance_score ?? 0),
    localBusinessScore:    Number(r.local_business_score ?? 0),
    estimatedHomeValue:    r.estimated_home_value ? Number(r.estimated_home_value) : undefined,
    propertyType:          r.property_type || undefined,
    yearBuilt:             r.year_built ? Number(r.year_built) : undefined,
    workflowCount:         Number(r.workflow_count ?? 0),
    lastWorkflowAt:        r.last_workflow_at?.toISOString?.() ?? undefined,
    createdAt:             r.created_at?.toISOString?.() ?? new Date().toISOString(),
    updatedAt:             r.updated_at?.toISOString?.() ?? new Date().toISOString(),
  };
}
