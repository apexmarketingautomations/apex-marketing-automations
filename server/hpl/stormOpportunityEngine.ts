/**
 * server/hpl/stormOpportunityEngine.ts
 *
 * Storm & Weather Opportunity Engine
 *
 * Converts NOAA/NWS weather events into structured contractor + insurance
 * opportunity signals. Correlates storm paths with property data to generate
 * prioritized contractor routing queues.
 *
 * Sources (existing): sentinel-home-svc.ts → NOAA NWS API
 * This engine adds: property correlation, opportunity scoring, insurance crossover,
 * and persistent storm event tracking.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { STORM_TRADE_MAP } from "./permitParser";
import { upsertProperty } from "./propertyIntelligenceEngine";
import type { StormEvent, ServiceTrade, PropertyEntity } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

// Hail size thresholds for scoring
const HAIL_CRITICAL_IN = 2.0;   // softball
const HAIL_HIGH_IN     = 1.0;   // quarter
const HAIL_MEDIUM_IN   = 0.75;  // dime

// Wind speed thresholds (mph)
const WIND_CRITICAL_MPH = 90;
const WIND_HIGH_MPH     = 58;
const WIND_MEDIUM_MPH   = 40;

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _hpl_storm_events (
        id                    SERIAL PRIMARY KEY,
        event_id              TEXT        NOT NULL UNIQUE,
        event_type            TEXT        NOT NULL,
        severity              TEXT        NOT NULL,
        county                TEXT        NOT NULL,
        state                 TEXT        NOT NULL,
        started_at            TIMESTAMPTZ NOT NULL,
        expires_at            TIMESTAMPTZ,
        lat                   REAL,
        lng                   REAL,
        radius_miles          REAL,
        hail_size_inches      REAL,
        wind_speed_mph        REAL,
        affected_properties   INTEGER,
        primary_trades        TEXT[]      DEFAULT ARRAY[]::TEXT[],
        insurance_cross_fit   BOOLEAN     DEFAULT FALSE,
        opportunity_score     INTEGER     DEFAULT 0,
        source                TEXT        NOT NULL DEFAULT 'noaa',
        raw_data              JSONB       DEFAULT '{}',
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS hpl_storm_county_idx ON _hpl_storm_events (county, started_at DESC);
      CREATE INDEX IF NOT EXISTS hpl_storm_score_idx  ON _hpl_storm_events (opportunity_score DESC);
      CREATE INDEX IF NOT EXISTS hpl_storm_type_idx   ON _hpl_storm_events (event_type, started_at DESC);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[HPL-STORM] Failed to ensure table:", err?.message);
  }
}

// ── Opportunity scoring ───────────────────────────────────────────────────────

export function scoreStormOpportunity(event: Omit<StormEvent, "opportunityScore" | "primaryTrades" | "insuranceCrossFit">): {
  score: number;
  primaryTrades: ServiceTrade[];
  insuranceCrossFit: boolean;
} {
  let score = 0;
  const trades = STORM_TRADE_MAP[event.eventType] ?? ["roofing", "restoration"];
  let insuranceCrossFit = false;

  // Severity base score
  switch (event.severity) {
    case "extreme": score += 40; insuranceCrossFit = true; break;
    case "severe":  score += 30; insuranceCrossFit = true; break;
    case "moderate": score += 18; break;
    case "minor":   score += 8;  break;
  }

  // Event type bonuses
  switch (event.eventType) {
    case "hail":      score += 20; insuranceCrossFit = true; break;
    case "hurricane": score += 25; insuranceCrossFit = true; break;
    case "tornado":   score += 22; insuranceCrossFit = true; break;
    case "wind":      score += 15; insuranceCrossFit = score >= 40; break;
    case "flood":     score += 18; insuranceCrossFit = true; break;
    case "freeze":    score += 10; break;
    case "severe_storm": score += 12; break;
  }

  // Hail size bonus
  if (event.hailSizeInches != null) {
    if      (event.hailSizeInches >= HAIL_CRITICAL_IN) score += 20;
    else if (event.hailSizeInches >= HAIL_HIGH_IN)     score += 12;
    else if (event.hailSizeInches >= HAIL_MEDIUM_IN)   score +=  6;
  }

  // Wind speed bonus
  if (event.windSpeedMph != null) {
    if      (event.windSpeedMph >= WIND_CRITICAL_MPH) score += 15;
    else if (event.windSpeedMph >= WIND_HIGH_MPH)     score +=  8;
    else if (event.windSpeedMph >= WIND_MEDIUM_MPH)   score +=  4;
  }

  return {
    score: Math.min(score, 100),
    primaryTrades: trades,
    insuranceCrossFit,
  };
}

// ── Ingest storm event ────────────────────────────────────────────────────────

export async function ingestStormEvent(
  raw: Omit<StormEvent, "opportunityScore" | "primaryTrades" | "insuranceCrossFit">,
  rawData?: Record<string, unknown>,
): Promise<StormEvent> {
  await ensureTable();

  const { score, primaryTrades, insuranceCrossFit } = scoreStormOpportunity(raw);
  const event: StormEvent = { ...raw, opportunityScore: score, primaryTrades, insuranceCrossFit };

  const tradesArr = primaryTrades.length > 0
    ? `ARRAY[${primaryTrades.map(t => `'${t}'`).join(",")}]::TEXT[]`
    : "ARRAY[]::TEXT[]";
  const rawJson = JSON.stringify(rawData ?? {}).replace(/'/g, "''");

  try {
    await db.execute(sql.raw(`
      INSERT INTO _hpl_storm_events (
        event_id, event_type, severity, county, state,
        started_at, expires_at, lat, lng, radius_miles,
        hail_size_inches, wind_speed_mph, affected_properties,
        primary_trades, insurance_cross_fit, opportunity_score, source, raw_data
      ) VALUES (
        '${event.eventId}',
        '${event.eventType}',
        '${event.severity}',
        '${event.county}',
        '${event.state}',
        '${event.startedAt}',
        ${event.expiresAt ? `'${event.expiresAt}'` : "NULL"},
        ${event.lat ?? "NULL"},
        ${event.lng ?? "NULL"},
        ${event.radiusMiles ?? "NULL"},
        ${event.hailSizeInches ?? "NULL"},
        ${event.windSpeedMph ?? "NULL"},
        ${event.affectedProperties ?? "NULL"},
        ${tradesArr},
        ${insuranceCrossFit},
        ${score},
        '${raw.source}',
        '${rawJson}'::jsonb
      )
      ON CONFLICT (event_id) DO UPDATE SET
        opportunity_score   = GREATEST(_hpl_storm_events.opportunity_score, ${score}),
        insurance_cross_fit = _hpl_storm_events.insurance_cross_fit OR ${insuranceCrossFit},
        expires_at          = COALESCE('${event.expiresAt ?? ""}', _hpl_storm_events.expires_at)
    `));

    console.log(`[HPL-STORM] Ingested ${event.eventType} event in ${event.county}, FL — score=${score}`);
  } catch (err: any) {
    console.error("[HPL-STORM] Ingest failed:", err?.message);
  }

  return event;
}

// ── Translate NWS HomeSvc signal to StormEvent ────────────────────────────────

export function normalizeNWSSignal(signal: {
  id: string;
  signalType: string;
  severity: string;
  areaDesc: string;
  state: string;
  sent: string;
  expires: string | null;
  lat: number | null;
  lng: number | null;
  headline?: string;
}): Omit<StormEvent, "opportunityScore" | "primaryTrades" | "insuranceCrossFit"> {
  const typeMap: Record<string, StormEvent["eventType"]> = {
    hail:          "hail",
    high_wind:     "wind",
    flood:         "flood",
    flash_flood:   "flood",
    freeze:        "freeze",
    tornado:       "tornado",
    severe_storm:  "severe_storm",
    thunderstorm:  "severe_storm",
    winter_storm:  "freeze",
  };

  const severityMap: Record<string, StormEvent["severity"]> = {
    extreme: "extreme", severe: "severe", moderate: "moderate", minor: "minor",
    critical: "extreme", high: "severe", medium: "moderate", low: "minor",
  };

  const eventType = typeMap[signal.signalType] ?? "severe_storm";
  const severity  = severityMap[signal.severity?.toLowerCase()] ?? "moderate";

  // Extract county name from areaDesc (e.g. "Lee County in Florida")
  const countyMatch = signal.areaDesc.match(/^([A-Z][a-zA-Z\s-]+?)(?:\s+(?:County|counties))?(?:,|\s+in|\s+FL|\s*$)/i);
  const county = countyMatch ? countyMatch[1].trim().toUpperCase() : signal.areaDesc.substring(0, 20).toUpperCase();

  return {
    eventId: signal.id,
    eventType,
    severity,
    county,
    state:    signal.state,
    startedAt: signal.sent,
    expiresAt: signal.expires ?? undefined,
    lat:      signal.lat ?? undefined,
    lng:      signal.lng ?? undefined,
    source:   "noaa_nws",
  };
}

// ── Query ─────────────────────────────────────────────────────────────────────

export async function getActiveStormEvents(opts: {
  county?: string;
  state?: string;
  minScore?: number;
  limit?: number;
} = {}): Promise<StormEvent[]> {
  await ensureTable();
  const { county, state, minScore = 30, limit = 50 } = opts;
  const conditions = [`opportunity_score >= ${minScore}`, `created_at >= NOW() - INTERVAL '72 hours'`];
  if (county) conditions.push(`county = '${county.replace(/'/g, "''")}'`);
  if (state)  conditions.push(`state = '${state}'`);
  const where = `WHERE ${conditions.join(" AND ")}`;
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _hpl_storm_events ${where}
      ORDER BY opportunity_score DESC, started_at DESC
      LIMIT ${limit}
    `));
    const rows = (result as any).rows ?? result;
    return Array.isArray(rows) ? rows.map(mapStormRow) : [];
  } catch { return []; }
}

export async function getStormOpportunityStats(): Promise<{
  activeEvents: number;
  avgScore: number;
  topCounties: string[];
  insuranceCrossFitCount: number;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                                                      AS active_events,
        AVG(opportunity_score)                                        AS avg_score,
        ARRAY_AGG(county ORDER BY opportunity_score DESC)            AS counties,
        SUM(CASE WHEN insurance_cross_fit THEN 1 ELSE 0 END)         AS insurance_cross
      FROM _hpl_storm_events
      WHERE created_at >= NOW() - INTERVAL '72 hours'
    `));
    const rows = (result as any).rows ?? result;
    const r = rows[0] ?? {};
    const counties: string[] = (r.counties ?? []).filter(Boolean);
    const seen = new Set<string>();
    const topCounties = counties.filter(c => { if (seen.has(c)) return false; seen.add(c); return true; }).slice(0, 5);
    return {
      activeEvents: Number(r.active_events ?? 0),
      avgScore: parseFloat(r.avg_score ?? "0"),
      topCounties,
      insuranceCrossFitCount: Number(r.insurance_cross ?? 0),
    };
  } catch { return { activeEvents: 0, avgScore: 0, topCounties: [], insuranceCrossFitCount: 0 }; }
}

// ── Property correlation — link storm events to affected properties ────────────

export async function correlateStormToProperties(
  event: StormEvent,
  properties: Partial<PropertyEntity>[],
): Promise<void> {
  for (const prop of properties) {
    if (!prop.propertyAddress || !prop.county) continue;
    if (prop.county !== event.county) continue;

    const existingExposure = prop.stormExposureScore ?? 0;
    const newExposure = Math.min(existingExposure + event.opportunityScore * 0.3, 100);

    await upsertProperty({
      propertyAddress: prop.propertyAddress,
      county:          prop.county,
      state:           prop.state ?? event.state,
      apexPropertyId:  prop.apexPropertyId,
      stormExposureScore: Math.round(newExposure),
      activeSignals:   [...(prop.activeSignals ?? []), event.eventType as any],
    });
  }
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function mapStormRow(r: any): StormEvent {
  return {
    eventId:            r.event_id,
    eventType:          r.event_type as StormEvent["eventType"],
    severity:           r.severity as StormEvent["severity"],
    county:             r.county,
    state:              r.state,
    startedAt:          r.started_at instanceof Date ? r.started_at.toISOString() : String(r.started_at),
    expiresAt:          r.expires_at ? (r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at)) : undefined,
    lat:                r.lat ?? undefined,
    lng:                r.lng ?? undefined,
    radiusMiles:        r.radius_miles ?? undefined,
    hailSizeInches:     r.hail_size_inches ?? undefined,
    windSpeedMph:       r.wind_speed_mph ?? undefined,
    affectedProperties: r.affected_properties ?? undefined,
    primaryTrades:      r.primary_trades ?? [],
    insuranceCrossFit:  Boolean(r.insurance_cross_fit),
    opportunityScore:   Number(r.opportunity_score ?? 0),
    source:             r.source ?? "unknown",
  };
}
