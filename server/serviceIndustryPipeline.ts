/**
 * server/serviceIndustryPipeline.ts
 *
 * Service Industry Operating System  (Phase 9)
 *
 * Unified signal pipeline for service-industry verticals:
 *   Barbers, Salons, Nail Salons, Massage Therapists, Spas, Barbershops
 *
 * Signals ingested:
 *   - Google Business Profile reviews (via webhook or scrape)
 *   - Appointment no-shows (from booking integrations)
 *   - Rebooking opportunities (clients past their typical interval)
 *   - License expirations (state cosmetology board data)
 *   - New competitor openings (permit data cross-referenced with business type)
 *
 * Output: service_industry_signals table → routing queue → sub-account delivery
 */

import { sql } from "drizzle-orm";
import { db } from "./db";
import { correlateSignal } from "./intelligence/correlationWorker";

export type ServiceVertical =
  | "barbershop" | "salon" | "nail_salon" | "massage" | "spa"
  | "tattoo" | "esthetics" | "barber_school" | "generic_service";

export type ServiceSignalType =
  | "negative_review" | "license_expiry" | "no_show" | "rebooking_opportunity"
  | "competitor_opening" | "staff_turnover" | "permit_issue" | "health_violation";

// ── Schema ─────────────────────────────────────────────────────────────────────

export async function ensureServiceIndustrySchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS service_industry_signals (
      id               SERIAL PRIMARY KEY,
      sub_account_id   INTEGER,
      vertical         TEXT        NOT NULL,
      signal_type      TEXT        NOT NULL,
      business_name    TEXT,
      business_address TEXT,
      county           TEXT,
      state            TEXT        DEFAULT 'FL',
      contact_phone    TEXT,
      contact_name     TEXT,
      contact_id       INTEGER,
      opportunity_score INTEGER    NOT NULL DEFAULT 0,
      signal_data      JSONB       NOT NULL DEFAULT '{}',
      source           TEXT,
      source_url       TEXT,
      status           TEXT        NOT NULL DEFAULT 'new',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sis_tenant_idx  ON service_industry_signals (sub_account_id, status);
    CREATE INDEX IF NOT EXISTS sis_vertical_idx ON service_industry_signals (vertical, signal_type);
    CREATE INDEX IF NOT EXISTS sis_score_idx   ON service_industry_signals (opportunity_score DESC);

    CREATE TABLE IF NOT EXISTS service_businesses (
      id               SERIAL PRIMARY KEY,
      sub_account_id   INTEGER,
      vertical         TEXT        NOT NULL,
      business_name    TEXT        NOT NULL,
      normalized_key   TEXT        NOT NULL UNIQUE,
      address          TEXT,
      county           TEXT,
      state            TEXT        DEFAULT 'FL',
      phone            TEXT,
      email            TEXT,
      google_place_id  TEXT,
      rating           NUMERIC(3,1),
      review_count     INTEGER     DEFAULT 0,
      license_number   TEXT,
      license_expiry   DATE,
      staff_count      INTEGER,
      is_client        BOOLEAN     DEFAULT false,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sb_tenant_idx   ON service_businesses (sub_account_id);
    CREATE INDEX IF NOT EXISTS sb_vertical_idx ON service_businesses (vertical);
    CREATE UNIQUE INDEX IF NOT EXISTS sb_key_idx ON service_businesses (normalized_key);
  `);
}

// ── Opportunity scoring ────────────────────────────────────────────────────────

function scoreServiceSignal(type: ServiceSignalType, data: Record<string, any>): number {
  switch (type) {
    case "negative_review":
      return data.rating <= 2 ? 80 : data.rating <= 3 ? 50 : 20;
    case "license_expiry": {
      const daysUntil = data.daysUntilExpiry ?? 999;
      return daysUntil <= 7 ? 95 : daysUntil <= 30 ? 75 : daysUntil <= 90 ? 50 : 20;
    }
    case "no_show":
      return 40;
    case "rebooking_opportunity":
      return 65;
    case "competitor_opening":
      return 55;
    case "health_violation":
      return 85;
    case "permit_issue":
      return 70;
    case "staff_turnover":
      return 45;
    default:
      return 30;
  }
}

// ── Ingest signal ──────────────────────────────────────────────────────────────

export async function ingestServiceSignal(params: {
  subAccountId?:   number;
  vertical:        ServiceVertical;
  signalType:      ServiceSignalType;
  businessName:    string;
  businessAddress?: string;
  county?:         string;
  state?:          string;
  contactPhone?:   string;
  contactName?:    string;
  signalData?:     Record<string, any>;
  source?:         string;
  sourceUrl?:      string;
}): Promise<{ id: number; score: number }> {
  await ensureServiceIndustrySchema();

  const score = scoreServiceSignal(params.signalType, params.signalData ?? {});

  const result = await db.execute(sql`
    INSERT INTO service_industry_signals
      (sub_account_id, vertical, signal_type, business_name, business_address,
       county, state, contact_phone, contact_name, opportunity_score, signal_data, source, source_url)
    VALUES
      (${params.subAccountId ?? null}, ${params.vertical}, ${params.signalType},
       ${params.businessName}, ${params.businessAddress ?? null},
       ${params.county ?? null}, ${params.state ?? "FL"},
       ${params.contactPhone ?? null}, ${params.contactName ?? null},
       ${score}, ${JSON.stringify(params.signalData ?? {})}::jsonb,
       ${params.source ?? null}, ${params.sourceUrl ?? null})
    RETURNING id
  `);
  const rows = (result as any).rows ?? result;
  const id = Number(Array.isArray(rows) ? rows[0]?.id : 0);

  // Cross-correlate high-score signals into intelligence cases
  if (score >= 50) {
    try {
      await correlateSignal({
        signalId:      id,
        signalTable:   "service_industry_signals",
        signalType:    params.signalType,
        canonicalName: params.businessName,
        entityType:    "company",
        address:       params.businessAddress,
        county:        params.county,
        state:         params.state,
        category:      params.signalType === "license_expiry" ? "license" :
                       params.signalType === "health_violation" ? "osha" : "other",
        opportunityScore: score,
      });
    } catch { /* non-fatal */ }  // allow-silent-catch: non-fatal, returns safe default
  }

  return { id, score };
}

// ── Query signals ──────────────────────────────────────────────────────────────

export async function getServiceSignals(params: {
  subAccountId?: number;
  vertical?:     ServiceVertical;
  minScore?:     number;
  status?:       string;
  limit?:        number;
}): Promise<any[]> {
  await ensureServiceIndustrySchema();

  const result = await db.execute(sql`
    SELECT * FROM service_industry_signals
    WHERE
      ${params.subAccountId !== undefined ? sql`sub_account_id = ${params.subAccountId} AND` : sql``}
      ${params.vertical ? sql`vertical = ${params.vertical} AND` : sql``}
      ${params.minScore  ? sql`opportunity_score >= ${params.minScore} AND` : sql``}
      ${params.status    ? sql`status = ${params.status} AND` : sql``}
      TRUE
    ORDER BY opportunity_score DESC, created_at DESC
    LIMIT ${params.limit ?? 100}
  `);

  const rows = (result as any).rows ?? result;
  return Array.isArray(rows) ? rows : [];
}
