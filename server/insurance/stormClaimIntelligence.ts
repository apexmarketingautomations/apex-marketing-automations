/**
 * server/insurance/stormClaimIntelligence.ts
 *
 * Storm Claim Intelligence
 *
 * Correlates HPL storm event data with household/property intelligence to
 * generate insurance claim opportunity scores.
 *
 * Inputs:
 *   - _hpl_storm_events (storm score, county, type, hail size, wind speed)
 *   - _hpl_properties   (roof age, storm exposure, estimated value)
 *   - _ins_households   (homeowner flag, insurance signals)
 *
 * Outputs:
 *   - Claim opportunity records in _ins_storm_opportunities
 *   - Contractor+insurance crossover flags
 *   - Outreach timing recommendations
 *
 * REAL DATA ONLY. No fabricated claim indicators.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool, isoDate } from "../hpl/sqlSafe";
import type { StormEvent } from "../hpl/types";

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _ins_storm_opportunities (
        id                      SERIAL PRIMARY KEY,
        storm_event_id          TEXT        NOT NULL,
        apex_property_id        TEXT,
        household_id            TEXT,
        county                  TEXT        NOT NULL,
        state                   TEXT        NOT NULL,

        claim_opportunity_score INTEGER     DEFAULT 0,
        roof_replacement_likely BOOLEAN     DEFAULT FALSE,
        insurance_crossover     BOOLEAN     DEFAULT FALSE,
        contractor_crossover    BOOLEAN     DEFAULT FALSE,

        storm_type              TEXT,
        storm_severity          TEXT,
        hail_size_inches        REAL,
        wind_speed_mph          REAL,
        storm_score             INTEGER,

        roof_age_estimate       INTEGER,
        estimated_home_value    INTEGER,
        storm_exposure_score    INTEGER,

        outreach_ready_at       TIMESTAMPTZ,
        status                  TEXT        NOT NULL DEFAULT 'new',
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ins_storm_county_idx  ON _ins_storm_opportunities (county, claim_opportunity_score DESC);
      CREATE INDEX IF NOT EXISTS ins_storm_status_idx  ON _ins_storm_opportunities (status, outreach_ready_at);
      CREATE INDEX IF NOT EXISTS ins_storm_event_idx   ON _ins_storm_opportunities (storm_event_id);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[INS-STORM] Failed to ensure table:", err?.message);
  }
}

// ── Claim opportunity scoring ─────────────────────────────────────────────────

export function scoreClaimOpportunity(opts: {
  stormScore: number;
  stormType: string;
  hailSizeInches?: number;
  windSpeedMph?: number;
  roofAgeYears?: number;
  estimatedHomeValue?: number;
  stormExposureScore?: number;
  isInsuranceCrossFit?: boolean;
}): {
  claimScore: number;
  roofReplacementLikely: boolean;
  insuranceCrossover: boolean;
  outreachDelayHours: number;
} {
  let score = 0;

  // Storm severity contribution
  score += Math.round(opts.stormScore * 0.4);

  // Roof age — the primary claim driver
  const roofAge = opts.roofAgeYears ?? 0;
  if (roofAge >= 20)      { score += 30; }
  else if (roofAge >= 15) { score += 20; }
  else if (roofAge >= 10) { score += 10; }

  // Hail size
  if ((opts.hailSizeInches ?? 0) >= 2.0)      score += 20;
  else if ((opts.hailSizeInches ?? 0) >= 1.0)  score += 12;
  else if ((opts.hailSizeInches ?? 0) >= 0.75) score += 6;

  // Wind speed
  if ((opts.windSpeedMph ?? 0) >= 90)     score += 15;
  else if ((opts.windSpeedMph ?? 0) >= 58) score += 8;

  // Home value — higher value = more urgency
  const homeVal = opts.estimatedHomeValue ?? 0;
  if (homeVal >= 500_000)       score += 10;
  else if (homeVal >= 300_000)  score += 6;
  else if (homeVal >= 150_000)  score += 3;

  // Storm exposure context
  if ((opts.stormExposureScore ?? 0) >= 70) score += 8;

  const claimScore = Math.min(score, 100);
  const roofReplacementLikely = roofAge >= 15 && (opts.stormScore >= 40 || (opts.hailSizeInches ?? 0) >= 1.0);
  const insuranceCrossover = opts.isInsuranceCrossFit ?? (claimScore >= 50);

  // Outreach timing: hail/hurricane same day; wind/severe 4h; others 24h
  const outreachDelayHours =
    ["hail", "hurricane", "tornado"].includes(opts.stormType) ? 2 :
    ["wind", "flood"].includes(opts.stormType) ? 6 : 24;

  return { claimScore, roofReplacementLikely, insuranceCrossover, outreachDelayHours };
}

// ── Process storm event → generate opportunities ──────────────────────────────

export async function processStormOpportunities(event: StormEvent): Promise<{
  generated: number;
  errors: number;
}> {
  await ensureTable();
  let generated = 0;
  let errors = 0;

  try {
    // Pull all properties in the affected county with roof age data
    const properties = await db.execute(sql.raw(`
      SELECT
        apex_property_id, county, state,
        roof_age_estimate, estimated_value, storm_exposure_score
      FROM _hpl_properties
      WHERE county = ${esc(event.county)}
        AND state = ${esc(event.state)}
        AND (roof_age_estimate IS NOT NULL OR estimated_value IS NOT NULL)
      LIMIT 500
    `));
    const propRows = (properties as any).rows ?? properties;
    if (!Array.isArray(propRows)) return { generated: 0, errors: 0 };

    for (const prop of propRows) {
      try {
        const { claimScore, roofReplacementLikely, insuranceCrossover, outreachDelayHours } =
          scoreClaimOpportunity({
            stormScore:         event.opportunityScore,
            stormType:          event.eventType,
            hailSizeInches:     event.hailSizeInches,
            windSpeedMph:       event.windSpeedMph,
            roofAgeYears:       prop.roof_age_estimate,
            estimatedHomeValue: prop.estimated_value,
            stormExposureScore: prop.storm_exposure_score,
            isInsuranceCrossFit: event.insuranceCrossFit,
          });

        if (claimScore < 30) continue; // below threshold — skip

        const outreachReadyAt = new Date(Date.now() + outreachDelayHours * 3_600_000).toISOString();

        await db.execute(sql.raw(`
          INSERT INTO _ins_storm_opportunities (
            storm_event_id, apex_property_id, county, state,
            claim_opportunity_score, roof_replacement_likely,
            insurance_crossover, contractor_crossover,
            storm_type, storm_severity, hail_size_inches, wind_speed_mph, storm_score,
            roof_age_estimate, estimated_home_value, storm_exposure_score,
            outreach_ready_at
          ) VALUES (
            ${esc(event.eventId)}, ${esc(prop.apex_property_id)},
            ${esc(prop.county)}, ${esc(prop.state)},
            ${claimScore}, ${bool(roofReplacementLikely)},
            ${bool(insuranceCrossover)}, ${bool(roofReplacementLikely)},
            ${esc(event.eventType)}, ${esc(event.severity)},
            ${num(event.hailSizeInches)}, ${num(event.windSpeedMph)}, ${num(event.opportunityScore)},
            ${num(prop.roof_age_estimate)}, ${num(prop.estimated_value)}, ${num(prop.storm_exposure_score)},
            ${isoDate(outreachReadyAt)}
          )
          ON CONFLICT DO NOTHING
        `));
        generated++;
      } catch { errors++; }
    }
  } catch (err: any) {
    console.error("[INS-STORM] Processing failed:", err?.message);
  }

  console.log(`[INS-STORM] ${event.eventType} in ${event.county} → ${generated} opportunities`);
  return { generated, errors };
}

// ── Query ready opportunities ─────────────────────────────────────────────────

export async function getReadyStormOpportunities(opts: {
  county?: string;
  minScore?: number;
  limit?: number;
  insuranceCrossoverOnly?: boolean;
} = {}): Promise<any[]> {
  await ensureTable();
  const { county, minScore = 40, limit = 50, insuranceCrossoverOnly = false } = opts;
  const conditions = [
    `status = 'new'`,
    `claim_opportunity_score >= ${minScore}`,
    `outreach_ready_at <= NOW()`,
  ];
  if (county)                conditions.push(`county = ${esc(county)}`);
  if (insuranceCrossoverOnly) conditions.push(`insurance_crossover = TRUE`);
  const where = `WHERE ${conditions.join(" AND ")}`;

  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _ins_storm_opportunities ${where}
      ORDER BY claim_opportunity_score DESC
      LIMIT ${limit}
    `));
    return (result as any).rows ?? result ?? [];
  } catch { return []; }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getStormClaimStats(): Promise<{
  totalOpportunities: number;
  readyForOutreach: number;
  roofReplacementCount: number;
  insuranceCrossoverCount: number;
  avgClaimScore: number;
  topCounties: string[];
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                                                    AS total,
        COUNT(CASE WHEN outreach_ready_at <= NOW() AND status = 'new' THEN 1 END) AS ready,
        COUNT(CASE WHEN roof_replacement_likely THEN 1 END)         AS roof_replacement,
        COUNT(CASE WHEN insurance_crossover THEN 1 END)             AS ins_crossover,
        AVG(claim_opportunity_score)                                AS avg_score,
        ARRAY_AGG(county ORDER BY claim_opportunity_score DESC)     AS counties
      FROM _ins_storm_opportunities
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `));
    const rows = (result as any).rows ?? result;
    const r = rows[0] ?? {};
    const counties: string[] = (r.counties ?? []).filter(Boolean);
    const seen = new Set<string>();
    const topCounties = counties.filter(c => { if (seen.has(c)) return false; seen.add(c); return true; }).slice(0, 5);

    return {
      totalOpportunities:     Number(r.total ?? 0),
      readyForOutreach:        Number(r.ready ?? 0),
      roofReplacementCount:    Number(r.roof_replacement ?? 0),
      insuranceCrossoverCount: Number(r.ins_crossover ?? 0),
      avgClaimScore:           parseFloat(r.avg_score ?? "0"),
      topCounties,
    };
  } catch {
    return { totalOpportunities: 0, readyForOutreach: 0, roofReplacementCount: 0, insuranceCrossoverCount: 0, avgClaimScore: 0, topCounties: [] };
  }
}
