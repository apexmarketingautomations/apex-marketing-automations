/**
 * server/serviceIndustry/localBusinessIntelligenceEngine.ts
 *
 * Local Business Intelligence Engine
 *
 * Builds and maintains intelligence profiles on every local service business.
 * Correlates: DBPR licenses, review signals, social activity, website quality,
 * appointment volume estimates, staffing, missed-call indicators, and commercial
 * crossover opportunity signals.
 *
 * Intelligence score (0-100) composite:
 *   - Reputation health     (0-25): review count × rating velocity
 *   - Operational chaos     (0-25): no booking system + no website + missed calls
 *   - Retention indicators  (0-25): avg visit frequency signals
 *   - Commercial crossover  (0-25): staff count + multi-location + revenue signals
 *
 * Higher operational chaos score = higher service opportunity for Apex.
 * Higher intelligence score = more data depth we have on the business.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool, arr } from "../hpl/sqlSafe";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import type {
  ServiceBusinessEntity, ServiceVertical, BusinessScale,
} from "./types";

// ── Business ID ───────────────────────────────────────────────────────────────

export function buildBusinessId(name: string, address: string, city: string): string {
  const raw = `${name.toLowerCase().trim()}|${address.toLowerCase().trim()}|${city.toLowerCase().trim()}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── Vertical detection ────────────────────────────────────────────────────────

const VERTICAL_KEYWORDS: Array<{ keywords: string[]; vertical: ServiceVertical }> = [
  { keywords: ["barber", "barbershop", "beard"],             vertical: "barber" },
  { keywords: ["salon", "hair salon", "hair studio"],        vertical: "salon" },
  { keywords: ["nail", "nails", "manicure", "pedicure"],     vertical: "nail_salon" },
  { keywords: ["med spa", "medspa", "medical spa", "botox", "filler", "laser"], vertical: "med_spa" },
  { keywords: ["spa", "day spa", "resort spa"],              vertical: "spa" },
  { keywords: ["massage", "therapy", "therapist", "lmt"],   vertical: "massage_therapy" },
  { keywords: ["esthetician", "esthetics", "facial", "skin care", "skincare"], vertical: "esthetician" },
  { keywords: ["tattoo", "ink", "piercing"],                 vertical: "tattoo" },
  { keywords: ["lash", "lashes", "eyelash", "brow"],        vertical: "lash_artist" },
  { keywords: ["suite", "beauty suite", "booth rental"],     vertical: "beauty_suite" },
  { keywords: ["wellness", "holistic", "yoga", "pilates", "fitness"], vertical: "wellness" },
];

export function detectVertical(name: string, licenseType?: string): ServiceVertical {
  const haystack = `${name} ${licenseType ?? ""}`.toLowerCase();
  for (const { keywords, vertical } of VERTICAL_KEYWORDS) {
    if (keywords.some(kw => haystack.includes(kw))) return vertical;
  }
  return "other_appointment";
}

// ── Scale detection ───────────────────────────────────────────────────────────

export function detectScale(staffCount?: number, locationCount?: number): BusinessScale {
  if ((locationCount ?? 1) > 1) return "multi_location";
  if ((staffCount ?? 1) <= 1)   return "solo";
  if ((staffCount ?? 1) <= 5)   return "small";
  return "mid";
}

// ── Intelligence scoring ──────────────────────────────────────────────────────

export function scoreBusinessIntelligence(entity: Partial<ServiceBusinessEntity>): {
  intelligenceScore:    number;
  operationalChaosScore: number;
  reputationScore:      number;
  retentionScore:       number;
  commercialScore:      number;
} {
  let reputationScore = 0;
  let operationalChaos = 0;
  let retentionScore = 0;
  let commercialScore = 0;

  // ── Reputation (0-25) ────────────────────────────────────────────────────
  const rating = entity.googleRating ?? 0;
  const reviews = entity.reviewCount ?? 0;
  if (rating >= 4.5) reputationScore += 10;
  else if (rating >= 4.0) reputationScore += 6;
  else if (rating >= 3.5) reputationScore += 3;
  // Low review count is opportunity signal, not scored high
  if (reviews >= 50)  reputationScore += 10;
  else if (reviews >= 20) reputationScore += 6;
  else if (reviews >= 5)  reputationScore += 3;
  // Recent reviews
  if (entity.lastReviewDate) {
    const daysSince = (Date.now() - new Date(entity.lastReviewDate).getTime()) / 86_400_000;
    if (daysSince < 30) reputationScore += 5;
    else if (daysSince < 90) reputationScore += 2;
  }

  // ── Operational Chaos (0-25) — high = more opportunity ─────────────────
  if (!entity.hasBookingSystem)  operationalChaos += 10;
  if (!entity.hasOnlineBooking)  operationalChaos += 7;
  if (entity.hasMissedCallIssue) operationalChaos += 6;
  if (!entity.hasLoyaltyProgram) operationalChaos += 2;

  // ── Retention signals (0-25) ─────────────────────────────────────────────
  const noShowRate = entity.avgNoShowRate ?? 0;
  const cancelRate = entity.avgCancellationRate ?? 0;
  if (noShowRate < 0.05)  retentionScore += 10;
  else if (noShowRate < 0.10) retentionScore += 5;
  if (cancelRate < 0.10)  retentionScore += 10;
  else if (cancelRate < 0.20) retentionScore += 5;
  if (entity.hasLoyaltyProgram) retentionScore += 5;

  // ── Commercial crossover (0-25) ───────────────────────────────────────────
  const staff = entity.staffCount ?? 1;
  if (staff >= 10)     commercialScore += 15;
  else if (staff >= 5) commercialScore += 10;
  else if (staff >= 2) commercialScore += 5;
  if ((entity.locationCount ?? 1) > 1) commercialScore += 8;
  if (entity.dbprLicenseType)          commercialScore += 2;

  const intelligenceScore = Math.min(
    reputationScore + operationalChaos + retentionScore + commercialScore, 100
  );

  return {
    intelligenceScore,
    operationalChaosScore: operationalChaos,
    reputationScore,
    retentionScore,
    commercialScore,
  };
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _svc_businesses (
        id                            SERIAL PRIMARY KEY,
        business_id                   TEXT        NOT NULL UNIQUE,
        business_name                 TEXT        NOT NULL,
        owner_name                    TEXT,
        phone                         TEXT,
        email                         TEXT,
        website                       TEXT,
        address                       TEXT        NOT NULL,
        city                          TEXT        NOT NULL,
        county                        TEXT        NOT NULL,
        state                         TEXT        NOT NULL DEFAULT 'FL',
        zip                           TEXT,

        vertical                      TEXT        NOT NULL DEFAULT 'other_appointment',
        scale                         TEXT        NOT NULL DEFAULT 'solo',
        staff_count                   INTEGER,
        chair_count                   INTEGER,

        dbpr_license_type             TEXT,
        dbpr_license_number           TEXT,

        intelligence_score            INTEGER     NOT NULL DEFAULT 0,
        operational_chaos_score       INTEGER     NOT NULL DEFAULT 0,
        reputation_score              INTEGER     NOT NULL DEFAULT 0,
        retention_score               INTEGER     NOT NULL DEFAULT 0,
        commercial_score              INTEGER     NOT NULL DEFAULT 0,

        estimated_monthly_appointments INTEGER,
        avg_no_show_rate              NUMERIC(5,4),
        avg_cancellation_rate         NUMERIC(5,4),

        google_rating                 NUMERIC(3,1),
        review_count                  INTEGER,
        last_review_date              DATE,

        has_missed_call_issue         BOOLEAN     DEFAULT FALSE,
        has_booking_system            BOOLEAN     DEFAULT FALSE,
        has_online_booking            BOOLEAN     DEFAULT FALSE,
        has_loyalty_program           BOOLEAN     DEFAULT FALSE,

        location_group_id             TEXT,
        location_count                INTEGER     DEFAULT 1,
        is_headquarters               BOOLEAN     DEFAULT FALSE,

        commercial_insurance_opportunity BOOLEAN  DEFAULT FALSE,
        wc_opportunity                BOOLEAN     DEFAULT FALSE,
        bop_opportunity               BOOLEAN     DEFAULT FALSE,

        active_signals                TEXT[]      DEFAULT ARRAY[]::TEXT[],
        created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS svc_biz_county_idx  ON _svc_businesses (county, intelligence_score DESC);
      CREATE INDEX IF NOT EXISTS svc_biz_vertical_idx ON _svc_businesses (vertical, operational_chaos_score DESC);
      CREATE INDEX IF NOT EXISTS svc_biz_score_idx   ON _svc_businesses (intelligence_score DESC);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[SVC-BIZ] Failed to ensure table:", err?.message);
  }
}

// ── Upsert ────────────────────────────────────────────────────────────────────

export async function upsertServiceBusiness(
  entity: Partial<ServiceBusinessEntity> & {
    businessName: string; address: string; city: string; county: string; state: string;
  },
): Promise<{ businessId: string; isNew: boolean }> {
  await ensureTable();

  const businessId = entity.businessId ?? buildBusinessId(entity.businessName, entity.address, entity.city);
  const vertical   = entity.vertical ?? detectVertical(entity.businessName, entity.dbprLicenseType);
  const scale      = entity.scale    ?? detectScale(entity.staffCount, entity.locationCount);
  const scores     = scoreBusinessIntelligence({ ...entity, vertical, scale });
  const signalsArr = arr(entity.activeSignals as string[] | undefined);

  // Commercial crossover flags
  const staff = entity.staffCount ?? 1;
  const wcOpp  = staff >= 2 || vertical === "massage_therapy" || vertical === "med_spa";
  const bopOpp = ["salon", "nail_salon", "spa", "med_spa", "tattoo"].includes(vertical);
  const commOpp = wcOpp || bopOpp || (entity.locationCount ?? 1) > 1;

  try {
    const result = await db.execute(sql.raw(`
      INSERT INTO _svc_businesses (
        business_id, business_name, owner_name, phone, email, website,
        address, city, county, state, zip,
        vertical, scale, staff_count, chair_count,
        dbpr_license_type, dbpr_license_number,
        intelligence_score, operational_chaos_score, reputation_score, retention_score, commercial_score,
        estimated_monthly_appointments, avg_no_show_rate, avg_cancellation_rate,
        google_rating, review_count, last_review_date,
        has_missed_call_issue, has_booking_system, has_online_booking, has_loyalty_program,
        location_group_id, location_count, is_headquarters,
        commercial_insurance_opportunity, wc_opportunity, bop_opportunity,
        active_signals
      ) VALUES (
        ${esc(businessId)}, ${esc(entity.businessName)}, ${esc(entity.ownerName)},
        ${esc(entity.phone)}, ${esc(entity.email)}, ${esc(entity.website)},
        ${esc(entity.address)}, ${esc(entity.city)}, ${esc(entity.county)},
        ${esc(entity.state)}, ${esc(entity.zip)},
        ${esc(vertical)}, ${esc(scale)}, ${num(entity.staffCount)}, ${num(entity.chairCount)},
        ${esc(entity.dbprLicenseType)}, ${esc(entity.dbprLicenseNumber)},
        ${num(scores.intelligenceScore)}, ${num(scores.operationalChaosScore)},
        ${num(scores.reputationScore)}, ${num(scores.retentionScore)}, ${num(scores.commercialScore)},
        ${num(entity.estimatedMonthlyAppointments)}, ${num(entity.avgNoShowRate)},
        ${num(entity.avgCancellationRate)},
        ${num(entity.googleRating)}, ${num(entity.reviewCount)},
        ${entity.lastReviewDate ? esc(entity.lastReviewDate) : "NULL"},
        ${bool(entity.hasMissedCallIssue)}, ${bool(entity.hasBookingSystem)},
        ${bool(entity.hasOnlineBooking)}, ${bool(entity.hasLoyaltyProgram)},
        ${esc(entity.locationGroupId)}, ${num(entity.locationCount ?? 1)}, ${bool(entity.isHeadquarters)},
        ${bool(commOpp)}, ${bool(wcOpp)}, ${bool(bopOpp)},
        ${signalsArr}
      )
      ON CONFLICT (business_id) DO UPDATE SET
        staff_count               = GREATEST(_svc_businesses.staff_count, EXCLUDED.staff_count),
        google_rating             = COALESCE(EXCLUDED.google_rating, _svc_businesses.google_rating),
        review_count              = GREATEST(_svc_businesses.review_count, EXCLUDED.review_count),
        intelligence_score        = GREATEST(_svc_businesses.intelligence_score, EXCLUDED.intelligence_score),
        operational_chaos_score   = GREATEST(_svc_businesses.operational_chaos_score, EXCLUDED.operational_chaos_score),
        has_missed_call_issue     = _svc_businesses.has_missed_call_issue OR EXCLUDED.has_missed_call_issue,
        commercial_insurance_opportunity = _svc_businesses.commercial_insurance_opportunity OR EXCLUDED.commercial_insurance_opportunity,
        wc_opportunity            = _svc_businesses.wc_opportunity OR EXCLUDED.wc_opportunity,
        bop_opportunity           = _svc_businesses.bop_opportunity OR EXCLUDED.bop_opportunity,
        active_signals            = (
          SELECT ARRAY_AGG(DISTINCT elem)
          FROM UNNEST(_svc_businesses.active_signals || EXCLUDED.active_signals) AS elem
        ),
        updated_at                = NOW()
      RETURNING (xmax = 0) AS is_new
    `));
    const rows = (result as any).rows ?? result;
    return { businessId, isNew: Array.isArray(rows) && rows[0]?.is_new === true };
  } catch (err: any) {
    console.error("[SVC-BIZ] Upsert failed:", err?.message);
    return { businessId, isNew: false };
  }
}

// ── Query: top businesses by chaos score ──────────────────────────────────────

export async function getTopOpportunityBusinesses(opts: {
  county?:    string;
  vertical?:  ServiceVertical;
  minScore?:  number;
  limit?:     number;
} = {}): Promise<ServiceBusinessEntity[]> {
  await ensureTable();
  const { county, vertical, minScore = 40, limit = 25 } = opts;
  const conditions = [`operational_chaos_score >= ${minScore}`];
  if (county)   conditions.push(`county = ${esc(county)}`);
  if (vertical) conditions.push(`vertical = ${esc(vertical)}`);
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _svc_businesses
      WHERE ${conditions.join(" AND ")}
      ORDER BY operational_chaos_score DESC, intelligence_score DESC
      LIMIT ${num(limit)}
    `));
    const rows = (result as any).rows ?? result;
    return Array.isArray(rows) ? rows.map(mapBusinessRow) : [];
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getBusinessIntelligenceStats(): Promise<{
  total: number;
  avgChaosScore: number;
  highChaosCount: number;
  missedCallCount: number;
  byVertical: Record<string, number>;
  commercialOpportunityCount: number;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                                                    AS total,
        AVG(operational_chaos_score)                               AS avg_chaos,
        COUNT(CASE WHEN operational_chaos_score >= 60 THEN 1 END)  AS high_chaos,
        COUNT(CASE WHEN has_missed_call_issue THEN 1 END)          AS missed_call,
        COUNT(CASE WHEN commercial_insurance_opportunity THEN 1 END) AS commercial_opp,
        vertical,
        COUNT(*) AS v_count
      FROM _svc_businesses
      GROUP BY vertical
    `));
    const rows = (result as any).rows ?? result;
    let total = 0, avgChaos = 0, highChaos = 0, missedCall = 0, commOpp = 0;
    const byVertical: Record<string, number> = {};
    for (const r of (Array.isArray(rows) ? rows : [])) {
      const n = Number(r.total ?? r.v_count ?? 0);
      total += Number(r.total ?? 0);
      avgChaos = parseFloat(r.avg_chaos ?? "0");
      highChaos = Number(r.high_chaos ?? 0);
      missedCall = Number(r.missed_call ?? 0);
      commOpp = Number(r.commercial_opp ?? 0);
      if (r.vertical) byVertical[r.vertical] = (byVertical[r.vertical] ?? 0) + Number(r.v_count ?? 0);
    }
    return { total, avgChaosScore: avgChaos, highChaosCount: highChaos, missedCallCount: missedCall, byVertical, commercialOpportunityCount: commOpp };
  } catch {  // allow-silent-catch: non-fatal, returns safe default
    return { total: 0, avgChaosScore: 0, highChaosCount: 0, missedCallCount: 0, byVertical: {}, commercialOpportunityCount: 0 };
  }
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function mapBusinessRow(r: any): ServiceBusinessEntity {
  return {
    businessId:           r.business_id,
    businessName:         r.business_name,
    ownerName:            r.owner_name ?? undefined,
    phone:                r.phone ?? undefined,
    email:                r.email ?? undefined,
    website:              r.website ?? undefined,
    address:              r.address,
    city:                 r.city,
    county:               r.county,
    state:                r.state,
    zip:                  r.zip ?? undefined,
    vertical:             r.vertical,
    scale:                r.scale,
    staffCount:           r.staff_count ?? undefined,
    chairCount:           r.chair_count ?? undefined,
    dbprLicenseType:      r.dbpr_license_type ?? undefined,
    dbprLicenseNumber:    r.dbpr_license_number ?? undefined,
    intelligenceScore:    Number(r.intelligence_score ?? 0),
    operationalChaosScore: Number(r.operational_chaos_score ?? 0),
    reputationScore:      Number(r.reputation_score ?? 0),
    retentionScore:       Number(r.retention_score ?? 0),
    googleRating:         r.google_rating ? Number(r.google_rating) : undefined,
    reviewCount:          r.review_count ?? undefined,
    lastReviewDate:       r.last_review_date?.toISOString?.() ?? undefined,
    hasMissedCallIssue:   Boolean(r.has_missed_call_issue),
    hasBookingSystem:     Boolean(r.has_booking_system),
    hasOnlineBooking:     Boolean(r.has_online_booking),
    hasLoyaltyProgram:    Boolean(r.has_loyalty_program),
    locationGroupId:      r.location_group_id ?? undefined,
    locationCount:        r.location_count ?? 1,
    isHeadquarters:       Boolean(r.is_headquarters),
    commercialInsuranceOpportunity: Boolean(r.commercial_insurance_opportunity),
    wcOpportunity:        Boolean(r.wc_opportunity),
    bopOpportunity:       Boolean(r.bop_opportunity),
    activeSignals:        r.active_signals ?? [],
    createdAt:            r.created_at?.toISOString?.() ?? undefined,
    updatedAt:            r.updated_at?.toISOString?.() ?? undefined,
  };
}
