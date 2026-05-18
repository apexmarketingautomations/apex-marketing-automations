/**
 * server/hpl/propertyIntelligenceEngine.ts
 *
 * Property Intelligence Engine
 *
 * Canonical property entity storage with opportunity scoring.
 * Maintains the _hpl_properties table — a unified view of every property
 * touched by the HPL pipeline (signals, permits, storm events, skip trace).
 *
 * Scoring: 0–100 composite from value, signals, roof age, contacts, storm exposure.
 * Score never decreases on upsert (GREATEST() pattern).
 *
 * REAL DATA ONLY: all scoring uses real inputs. Never fabricates values.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { createHash } from "crypto";
import { esc, num, bool, arr } from "./sqlSafe";
import type { PropertyEntity, HPLSignalType } from "./types";

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _hpl_properties (
        id                           SERIAL PRIMARY KEY,
        apex_property_id             TEXT        NOT NULL UNIQUE,
        property_address             TEXT        NOT NULL,
        county                       TEXT        NOT NULL,
        state                        TEXT        NOT NULL DEFAULT 'FL',
        zip                          TEXT,
        lat                          REAL,
        lng                          REAL,

        owner_name                   TEXT,
        owner_phone                  TEXT,
        owner_email                  TEXT,
        mailing_address              TEXT,
        owner_in_state               BOOLEAN,
        occupancy_type               TEXT,

        property_type                TEXT,
        square_footage               INTEGER,
        year_built                   INTEGER,
        bedrooms                     INTEGER,
        bathrooms                    REAL,
        lot_size_sqft                INTEGER,

        estimated_value              INTEGER,
        assessed_value               INTEGER,
        equity_estimate              INTEGER,
        last_sale_price              INTEGER,
        last_sale_date               DATE,
        mortgage_balance             INTEGER,

        roof_age_estimate            INTEGER,
        last_roof_permit_date        DATE,
        weather_zone                 TEXT,
        storm_exposure_score         INTEGER     DEFAULT 0,

        active_signals               TEXT[]      DEFAULT ARRAY[]::TEXT[],
        insurance_indicators         TEXT[]      DEFAULT ARRAY[]::TEXT[],

        contractor_opportunity_score INTEGER     DEFAULT 0,
        urgency_score                INTEGER     DEFAULT 0,

        enrichment_sources           TEXT[]      DEFAULT ARRAY[]::TEXT[],
        last_enriched_at             TIMESTAMPTZ,
        skip_trace_completed         BOOLEAN     DEFAULT FALSE,

        created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS hpl_prop_county_idx ON _hpl_properties (county, contractor_opportunity_score DESC);
      CREATE INDEX IF NOT EXISTS hpl_prop_score_idx  ON _hpl_properties (contractor_opportunity_score DESC);
      CREATE INDEX IF NOT EXISTS hpl_prop_phone_idx  ON _hpl_properties (owner_phone) WHERE owner_phone IS NOT NULL;
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[HPL-ENGINE] Failed to ensure table:", err?.message);
  }
}

// ── Property ID ───────────────────────────────────────────────────────────────

export function buildApexPropertyId(address: string, county: string, state: string): string {
  const normalized = `${address.toLowerCase().trim()}|${county.toLowerCase().trim()}|${state.toLowerCase().trim()}`;
  return createHash("sha256").update(normalized).digest("hex").substring(0, 24);
}

// ── Opportunity scoring ───────────────────────────────────────────────────────

const SIGNAL_SCORES: Partial<Record<HPLSignalType, number>> = {
  storm_event:       25,
  hail_event:        28,
  hurricane_event:   30,
  insurance_claim:   20,
  roofing_permit:    15,
  hvac_permit:       12,
  pre_foreclosure:   18,
  ownership_change:  10,
  high_equity:       12,
  absentee_owner:    8,
};

export function scoreContractorOpportunity(entity: Partial<PropertyEntity>): number {
  let score = 20; // base

  // Property value tier
  const val = entity.estimatedValue ?? 0;
  if (val >= 500_000)      score += 15;
  else if (val >= 300_000) score += 10;
  else if (val >= 150_000) score += 5;

  // Active signal bonuses
  for (const sig of (entity.activeSignals ?? [])) {
    score += SIGNAL_SCORES[sig as HPLSignalType] ?? 5;
  }

  // Roof age — older roofs are higher opportunity
  const roofAge = entity.roofAgeEstimate ?? 0;
  if (roofAge >= 20)      score += 20;
  else if (roofAge >= 15) score += 12;
  else if (roofAge >= 10) score += 6;

  // Contact data quality
  if (entity.ownerPhone) score += 8;
  if (entity.ownerEmail) score += 4;

  // Storm exposure
  const stormExp = entity.stormExposureScore ?? 0;
  if (stormExp >= 70)      score += 15;
  else if (stormExp >= 50) score += 8;
  else if (stormExp >= 30) score += 3;

  return Math.min(score, 100);
}

// ── Upsert property ───────────────────────────────────────────────────────────

export async function upsertProperty(
  entity: Partial<PropertyEntity> & { propertyAddress: string; county: string; state: string },
): Promise<{ apexPropertyId: string; isNew: boolean }> {
  await ensureTable();

  const apexPropertyId = entity.apexPropertyId ?? buildApexPropertyId(entity.propertyAddress, entity.county, entity.state);
  const opportunityScore = scoreContractorOpportunity(entity);

  const signalsArr = arr(entity.activeSignals as string[] | undefined);
  const sourcesArr = arr(entity.enrichmentSources);

  try {
    const result = await db.execute(sql.raw(`
      INSERT INTO _hpl_properties (
        apex_property_id, property_address, county, state, zip, lat, lng,
        owner_name, owner_phone, owner_email, mailing_address, owner_in_state, occupancy_type,
        property_type, square_footage, year_built,
        estimated_value, assessed_value, equity_estimate, last_sale_price,
        roof_age_estimate, last_roof_permit_date, weather_zone, storm_exposure_score,
        active_signals, enrichment_sources,
        contractor_opportunity_score, last_enriched_at
      ) VALUES (
        '${apexPropertyId}',
        ${esc(entity.propertyAddress)},
        ${esc(entity.county)},
        ${esc(entity.state)},
        ${esc(entity.zip)},
        ${num(entity.lat)}, ${num(entity.lng)},
        ${esc(entity.ownerName)}, ${esc(entity.ownerPhone)}, ${esc(entity.ownerEmail)},
        ${esc(entity.mailingAddress)}, ${bool(entity.ownerInState)}, ${esc(entity.occupancyType)},
        ${esc(entity.propertyType)}, ${num(entity.squareFootage)}, ${num(entity.yearBuilt)},
        ${num(entity.estimatedValue)}, ${num(entity.assessedValue)}, ${num(entity.equityEstimate)}, ${num(entity.lastSalePrice)},
        ${num(entity.roofAgeEstimate)}, ${esc(entity.lastRoofPermitDate)}, ${esc(entity.weatherZone)}, ${num(entity.stormExposureScore)},
        ${signalsArr}, ${sourcesArr},
        ${opportunityScore}, NOW()
      )
      ON CONFLICT (apex_property_id) DO UPDATE SET
        owner_name               = COALESCE(EXCLUDED.owner_name, _hpl_properties.owner_name),
        owner_phone              = COALESCE(EXCLUDED.owner_phone, _hpl_properties.owner_phone),
        owner_email              = COALESCE(EXCLUDED.owner_email, _hpl_properties.owner_email),
        estimated_value          = COALESCE(EXCLUDED.estimated_value, _hpl_properties.estimated_value),
        roof_age_estimate        = COALESCE(EXCLUDED.roof_age_estimate, _hpl_properties.roof_age_estimate),
        weather_zone             = COALESCE(EXCLUDED.weather_zone, _hpl_properties.weather_zone),
        storm_exposure_score     = GREATEST(_hpl_properties.storm_exposure_score, EXCLUDED.storm_exposure_score),
        active_signals           = (
          SELECT ARRAY_AGG(DISTINCT elem)
          FROM UNNEST(_hpl_properties.active_signals || EXCLUDED.active_signals) AS elem
        ),
        enrichment_sources       = (
          SELECT ARRAY_AGG(DISTINCT elem)
          FROM UNNEST(_hpl_properties.enrichment_sources || EXCLUDED.enrichment_sources) AS elem
        ),
        contractor_opportunity_score = GREATEST(_hpl_properties.contractor_opportunity_score, EXCLUDED.contractor_opportunity_score),
        last_enriched_at         = NOW(),
        updated_at               = NOW()
      RETURNING (xmax = 0) AS is_new
    `));

    const rows = (result as any).rows ?? result;
    const isNew = Array.isArray(rows) && rows[0]?.is_new === true;
    return { apexPropertyId, isNew };
  } catch (err: any) {
    console.error("[HPL-ENGINE] Upsert failed:", err?.message);
    return { apexPropertyId, isNew: false };
  }
}

// ── Query ─────────────────────────────────────────────────────────────────────

export async function getTopOpportunities(opts: {
  county?: string;
  minScore?: number;
  limit?: number;
} = {}): Promise<PropertyEntity[]> {
  await ensureTable();
  const { county, minScore = 50, limit = 20 } = opts;
  const countyClause = county ? `AND county = '${county.replace(/'/g, "''")}'` : "";

  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _hpl_properties
      WHERE contractor_opportunity_score >= ${minScore} ${countyClause}
      ORDER BY contractor_opportunity_score DESC
      LIMIT ${limit}
    `));
    const rows = (result as any).rows ?? result;
    return Array.isArray(rows) ? rows.map(mapPropertyRow) : [];
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function mapPropertyRow(r: any): PropertyEntity {
  return {
    apexPropertyId:             r.apex_property_id,
    propertyAddress:            r.property_address,
    county:                     r.county,
    state:                      r.state,
    zip:                        r.zip ?? undefined,
    lat:                        r.lat ?? undefined,
    lng:                        r.lng ?? undefined,
    ownerName:                  r.owner_name ?? undefined,
    ownerPhone:                 r.owner_phone ?? undefined,
    ownerEmail:                 r.owner_email ?? undefined,
    mailingAddress:             r.mailing_address ?? undefined,
    ownerInState:               r.owner_in_state ?? undefined,
    occupancyType:              r.occupancy_type ?? undefined,
    propertyType:               r.property_type ?? undefined,
    squareFootage:              r.square_footage ?? undefined,
    yearBuilt:                  r.year_built ?? undefined,
    estimatedValue:             r.estimated_value ?? undefined,
    assessedValue:              r.assessed_value ?? undefined,
    roofAgeEstimate:            r.roof_age_estimate ?? undefined,
    weatherZone:                r.weather_zone ?? undefined,
    stormExposureScore:         r.storm_exposure_score ?? undefined,
    activeSignals:              r.active_signals ?? [],
    enrichmentSources:          r.enrichment_sources ?? [],
    contractorOpportunityScore: r.contractor_opportunity_score ?? 0,
    lastEnrichedAt:             r.last_enriched_at?.toISOString?.() ?? undefined,
    skipTraceCompleted:         Boolean(r.skip_trace_completed),
  };
}
