/**
 * server/insurance/householdRiskEngine.ts
 *
 * Household Risk Engine
 *
 * Builds and maintains household-level intelligence entities by correlating:
 *   - Crash data (existing crashIntelligencePipeline)
 *   - Property ownership (HPL _hpl_properties)
 *   - Permit history (HPL permitParser)
 *   - Weather/storm exposure (HPL stormOpportunityEngine)
 *   - Business ownership (DBPR / commercial signals)
 *   - Vehicle records (crash signals, registration)
 *
 * Storage: lazy _ins_households table.
 * Household ID: SHA256(normalizedPrimaryAddress)[0:24]
 * Score: GREATEST() pattern — never regresses on update.
 *
 * REAL DATA ONLY. No fabricated risk factors.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { createHash } from "crypto";
import { esc, num, bool, arr, isoDate } from "../hpl/sqlSafe";
import type { HouseholdEntity, InsuranceSignalType, VehicleRecord } from "./types";

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _ins_households (
        id                         SERIAL PRIMARY KEY,
        household_id               TEXT        NOT NULL UNIQUE,
        primary_address            TEXT        NOT NULL,
        county                     TEXT        NOT NULL,
        state                      TEXT        NOT NULL DEFAULT 'FL',
        zip                        TEXT,

        primary_name               TEXT,
        primary_phone              TEXT,
        primary_email              TEXT,
        resident_count             INTEGER,
        has_teen_driver            BOOLEAN     DEFAULT FALSE,
        has_senior                 BOOLEAN     DEFAULT FALSE,

        vehicle_count              INTEGER     DEFAULT 0,
        vehicles                   JSONB       DEFAULT '[]',

        property_count             INTEGER     DEFAULT 0,
        primary_property_apex_id   TEXT,
        is_homeowner               BOOLEAN     DEFAULT FALSE,
        estimated_home_value       INTEGER,
        roof_age_estimate          INTEGER,

        crash_count_12mo           INTEGER     DEFAULT 0,
        dui_count_36mo             INTEGER     DEFAULT 0,
        storm_exposure_score       INTEGER     DEFAULT 0,
        flood_zone                 TEXT,

        policy_opportunity_score   INTEGER     DEFAULT 0,
        bundling_opportunity       BOOLEAN     DEFAULT FALSE,
        estimated_household_premium INTEGER,

        business_owner             BOOLEAN     DEFAULT FALSE,
        business_type              TEXT,
        dbpr_license_count         INTEGER     DEFAULT 0,
        commercial_opportunity     BOOLEAN     DEFAULT FALSE,

        active_signals             TEXT[]      DEFAULT ARRAY[]::TEXT[],
        enrichment_sources         TEXT[]      DEFAULT ARRAY[]::TEXT[],
        last_scored_at             TIMESTAMPTZ,
        created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ins_hh_county_idx ON _ins_households (county, policy_opportunity_score DESC);
      CREATE INDEX IF NOT EXISTS ins_hh_score_idx  ON _ins_households (policy_opportunity_score DESC);
      CREATE INDEX IF NOT EXISTS ins_hh_phone_idx  ON _ins_households (primary_phone) WHERE primary_phone IS NOT NULL;
      CREATE INDEX IF NOT EXISTS ins_hh_zip_idx    ON _ins_households (zip) WHERE zip IS NOT NULL;
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[INS-HOUSEHOLD] Failed to ensure table:", err?.message);
  }
}

// ── Household ID ──────────────────────────────────────────────────────────────

export function buildHouseholdId(address: string, county: string, state: string): string {
  const normalized = `${address.toLowerCase().trim()}|${county.toLowerCase().trim()}|${state.toLowerCase().trim()}`;
  return createHash("sha256").update(normalized).digest("hex").substring(0, 24);
}

// ── Upsert household ──────────────────────────────────────────────────────────

export async function upsertHousehold(
  entity: Partial<HouseholdEntity> & { primaryAddress: string; county: string; state: string },
): Promise<{ householdId: string; isNew: boolean }> {
  await ensureTable();

  const householdId = entity.householdId ?? buildHouseholdId(entity.primaryAddress, entity.county, entity.state);
  const vehiclesJson = JSON.stringify(entity.vehicles ?? []).replace(/'/g, "''");
  const signalsArr   = arr(entity.activeSignals as string[] | undefined);
  const sourcesArr   = arr(entity.enrichmentSources);

  try {
    const result = await db.execute(sql.raw(`
      INSERT INTO _ins_households (
        household_id, primary_address, county, state, zip,
        primary_name, primary_phone, primary_email,
        resident_count, has_teen_driver, has_senior,
        vehicle_count, vehicles,
        property_count, primary_property_apex_id, is_homeowner,
        estimated_home_value, roof_age_estimate,
        crash_count_12mo, dui_count_36mo, storm_exposure_score, flood_zone,
        policy_opportunity_score, bundling_opportunity, estimated_household_premium,
        business_owner, business_type, dbpr_license_count, commercial_opportunity,
        active_signals, enrichment_sources, last_scored_at
      ) VALUES (
        ${esc(householdId)}, ${esc(entity.primaryAddress)}, ${esc(entity.county)}, ${esc(entity.state)}, ${esc(entity.zip)},
        ${esc(entity.primaryName)}, ${esc(entity.primaryPhone)}, ${esc(entity.primaryEmail)},
        ${num(entity.residentCount)}, ${bool(entity.hasTeenDriver)}, ${bool(entity.hasSenior)},
        ${num(entity.vehicleCount ?? (entity.vehicles?.length ?? 0))}, '${vehiclesJson}'::jsonb,
        ${num(entity.propertyCount)}, ${esc(entity.primaryPropertyApexId)}, ${bool(entity.isHomeowner)},
        ${num(entity.estimatedHomeValue)}, ${num(entity.roofAgeEstimate)},
        ${num(entity.crashCount12Mo)}, ${num(entity.duiCount36Mo)}, ${num(entity.stormExposureScore)}, ${esc(entity.floodZone)},
        ${num(entity.policyOpportunityScore ?? 0)}, ${bool(entity.bundlingOpportunity)}, ${num(entity.estimatedHouseholdPremium)},
        ${bool(entity.businessOwner)}, ${esc(entity.businessType)}, ${num(entity.dbprLicenseCount)}, ${bool(entity.commercialOpportunity)},
        ${signalsArr}, ${sourcesArr}, NOW()
      )
      ON CONFLICT (household_id) DO UPDATE SET
        primary_name               = COALESCE(EXCLUDED.primary_name, _ins_households.primary_name),
        primary_phone              = COALESCE(EXCLUDED.primary_phone, _ins_households.primary_phone),
        primary_email              = COALESCE(EXCLUDED.primary_email, _ins_households.primary_email),
        resident_count             = COALESCE(EXCLUDED.resident_count, _ins_households.resident_count),
        has_teen_driver            = _ins_households.has_teen_driver OR COALESCE(EXCLUDED.has_teen_driver, FALSE),
        vehicle_count              = GREATEST(_ins_households.vehicle_count, EXCLUDED.vehicle_count),
        is_homeowner               = _ins_households.is_homeowner OR COALESCE(EXCLUDED.is_homeowner, FALSE),
        estimated_home_value       = COALESCE(EXCLUDED.estimated_home_value, _ins_households.estimated_home_value),
        roof_age_estimate          = COALESCE(EXCLUDED.roof_age_estimate, _ins_households.roof_age_estimate),
        crash_count_12mo           = GREATEST(_ins_households.crash_count_12mo, EXCLUDED.crash_count_12mo),
        dui_count_36mo             = GREATEST(_ins_households.dui_count_36mo, EXCLUDED.dui_count_36mo),
        storm_exposure_score       = GREATEST(_ins_households.storm_exposure_score, EXCLUDED.storm_exposure_score),
        flood_zone                 = COALESCE(EXCLUDED.flood_zone, _ins_households.flood_zone),
        policy_opportunity_score   = GREATEST(_ins_households.policy_opportunity_score, EXCLUDED.policy_opportunity_score),
        bundling_opportunity       = _ins_households.bundling_opportunity OR COALESCE(EXCLUDED.bundling_opportunity, FALSE),
        business_owner             = _ins_households.business_owner OR COALESCE(EXCLUDED.business_owner, FALSE),
        commercial_opportunity     = _ins_households.commercial_opportunity OR COALESCE(EXCLUDED.commercial_opportunity, FALSE),
        dbpr_license_count         = GREATEST(_ins_households.dbpr_license_count, EXCLUDED.dbpr_license_count),
        active_signals             = (
          SELECT ARRAY_AGG(DISTINCT elem)
          FROM UNNEST(_ins_households.active_signals || EXCLUDED.active_signals) AS elem
        ),
        enrichment_sources         = (
          SELECT ARRAY_AGG(DISTINCT elem)
          FROM UNNEST(_ins_households.enrichment_sources || EXCLUDED.enrichment_sources) AS elem
        ),
        last_scored_at             = NOW(),
        updated_at                 = NOW()
      RETURNING (xmax = 0) AS is_new
    `));

    const rows = (result as any).rows ?? result;
    const isNew = Array.isArray(rows) && rows[0]?.is_new === true;
    return { householdId, isNew };
  } catch (err: any) {
    console.error("[INS-HOUSEHOLD] Upsert failed:", err?.message);
    return { householdId, isNew: false };
  }
}

// ── Correlate from HPL property ───────────────────────────────────────────────

export async function correlateFromHPLProperty(hplPropertyId: string): Promise<string | null> {
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        apex_property_id, property_address, county, state, zip,
        owner_name, owner_phone, owner_email,
        estimated_value, roof_age_estimate, storm_exposure_score,
        active_signals
      FROM _hpl_properties
      WHERE apex_property_id = ${esc(hplPropertyId)}
      LIMIT 1
    `));
    const rows = (result as any).rows ?? result;
    if (!Array.isArray(rows) || !rows[0]) return null;

    const r = rows[0];
    const { householdId } = await upsertHousehold({
      primaryAddress:      r.property_address,
      county:              r.county,
      state:               r.state ?? "FL",
      zip:                 r.zip,
      primaryName:         r.owner_name,
      primaryPhone:        r.owner_phone,
      primaryEmail:        r.owner_email,
      isHomeowner:         true,
      estimatedHomeValue:  r.estimated_value,
      roofAgeEstimate:     r.roof_age_estimate,
      stormExposureScore:  r.storm_exposure_score ?? 0,
      primaryPropertyApexId: hplPropertyId,
      propertyCount:       1,
      activeSignals:       (r.active_signals ?? []) as InsuranceSignalType[],
      enrichmentSources:   ["hpl_property_correlation"],
    });
    return householdId;
  } catch (err: any) {
    console.error("[INS-HOUSEHOLD] HPL correlation failed:", err?.message);
    return null;
  }
}

// ── Correlate from crash ──────────────────────────────────────────────────────

export async function correlateFromCrash(opts: {
  address: string;
  county: string;
  state: string;
  driverName?: string;
  driverPhone?: string;
  isDui?: boolean;
  vehicleCount?: number;
}): Promise<string> {
  const signals: InsuranceSignalType[] = ["crash_event"];
  if (opts.isDui) signals.push("dui_incident");

  const { householdId } = await upsertHousehold({
    primaryAddress:   opts.address,
    county:           opts.county,
    state:            opts.state,
    primaryName:      opts.driverName,
    primaryPhone:     opts.driverPhone,
    crashCount12Mo:   1,
    duiCount36Mo:     opts.isDui ? 1 : 0,
    vehicleCount:     opts.vehicleCount ?? 1,
    activeSignals:    signals,
    enrichmentSources: ["crash_correlation"],
  });
  return householdId;
}

// ── Query ─────────────────────────────────────────────────────────────────────

export async function getTopHouseholds(opts: {
  county?: string;
  zip?: string;
  minScore?: number;
  limit?: number;
  hasPhone?: boolean;
} = {}): Promise<HouseholdEntity[]> {
  await ensureTable();
  const { county, zip, minScore = 50, limit = 25, hasPhone } = opts;
  const conditions: string[] = [`policy_opportunity_score >= ${minScore}`];
  if (county)   conditions.push(`county = ${esc(county)}`);
  if (zip)      conditions.push(`zip = ${esc(zip)}`);
  if (hasPhone) conditions.push(`primary_phone IS NOT NULL`);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _ins_households ${where}
      ORDER BY policy_opportunity_score DESC
      LIMIT ${limit}
    `));
    const rows = (result as any).rows ?? result;
    return Array.isArray(rows) ? rows.map(mapHouseholdRow) : [];
  } catch { return []; }
}

export async function getHouseholdStats(): Promise<{
  total: number;
  avgScore: number;
  homeownersCount: number;
  bundlingCount: number;
  commercialCount: number;
  highRiskCount: number;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                                                              AS total,
        AVG(policy_opportunity_score)                                         AS avg_score,
        COUNT(CASE WHEN is_homeowner THEN 1 END)                             AS homeowners,
        COUNT(CASE WHEN bundling_opportunity THEN 1 END)                     AS bundling,
        COUNT(CASE WHEN commercial_opportunity THEN 1 END)                   AS commercial,
        COUNT(CASE WHEN crash_count_12mo > 0 OR dui_count_36mo > 0 THEN 1 END) AS high_risk
      FROM _ins_households
    `));
    const rows = (result as any).rows ?? result;
    const r = rows[0] ?? {};
    return {
      total:           Number(r.total ?? 0),
      avgScore:        parseFloat(r.avg_score ?? "0"),
      homeownersCount: Number(r.homeowners ?? 0),
      bundlingCount:   Number(r.bundling ?? 0),
      commercialCount: Number(r.commercial ?? 0),
      highRiskCount:   Number(r.high_risk ?? 0),
    };
  } catch {
    return { total: 0, avgScore: 0, homeownersCount: 0, bundlingCount: 0, commercialCount: 0, highRiskCount: 0 };
  }
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function mapHouseholdRow(r: any): HouseholdEntity {
  return {
    householdId:              r.household_id,
    primaryAddress:           r.primary_address,
    county:                   r.county,
    state:                    r.state,
    zip:                      r.zip ?? undefined,
    primaryName:              r.primary_name ?? undefined,
    primaryPhone:             r.primary_phone ?? undefined,
    primaryEmail:             r.primary_email ?? undefined,
    residentCount:            r.resident_count ?? undefined,
    hasTeenDriver:            Boolean(r.has_teen_driver),
    hasSenior:                Boolean(r.has_senior),
    vehicleCount:             r.vehicle_count ?? 0,
    vehicles:                 r.vehicles ?? [],
    propertyCount:            r.property_count ?? 0,
    primaryPropertyApexId:    r.primary_property_apex_id ?? undefined,
    isHomeowner:              Boolean(r.is_homeowner),
    estimatedHomeValue:       r.estimated_home_value ?? undefined,
    roofAgeEstimate:          r.roof_age_estimate ?? undefined,
    crashCount12Mo:           r.crash_count_12mo ?? 0,
    duiCount36Mo:             r.dui_count_36mo ?? 0,
    stormExposureScore:       r.storm_exposure_score ?? 0,
    floodZone:                r.flood_zone ?? undefined,
    policyOpportunityScore:   r.policy_opportunity_score ?? 0,
    bundlingOpportunity:      Boolean(r.bundling_opportunity),
    estimatedHouseholdPremium: r.estimated_household_premium ?? undefined,
    businessOwner:            Boolean(r.business_owner),
    businessType:             r.business_type ?? undefined,
    dbprLicenseCount:         r.dbpr_license_count ?? 0,
    commercialOpportunity:    Boolean(r.commercial_opportunity),
    activeSignals:            r.active_signals ?? [],
    enrichmentSources:        r.enrichment_sources ?? [],
    lastScoredAt:             r.last_scored_at?.toISOString?.() ?? undefined,
    createdAt:                r.created_at?.toISOString?.() ?? undefined,
    updatedAt:                r.updated_at?.toISOString?.() ?? undefined,
  };
}
