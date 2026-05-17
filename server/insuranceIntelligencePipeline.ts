/**
 * server/insuranceIntelligencePipeline.ts
 *
 * Insurance Intelligence & Policy Opportunity Engine  (Phase 8)
 *
 * Detects insurance opportunity signals from crash data and legal signals,
 * scores them for attorney referral value, PIP/BI potential, and routes
 * matched opportunities to sub-accounts operating in insurance verticals.
 *
 * Signal sources:
 *   - crash_reports        → PIP (Personal Injury Protection) + BI opportunities
 *   - legal_signals        → Policy coverage disputes, bad faith claims
 *   - home_service_leads   → Homeowner insurance (storm/fire/flood damage)
 *   - arrest_records       → SR-22 / high-risk driver insurance
 *
 * Output: insurance_opportunities table with opportunity score, carrier hints,
 * contact match, and delivery queue entry.
 */

import { sql } from "drizzle-orm";
import { db } from "./db";
import { correlateSignal } from "./intelligence/correlationWorker";

// ── Schema bootstrap ─────────────────────────────────────────────────────────

export async function ensureInsuranceSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS insurance_opportunities (
      id                   SERIAL PRIMARY KEY,
      sub_account_id       INTEGER,
      signal_source        TEXT        NOT NULL,  -- crash_reports|legal_signals|home_service_leads|arrests
      signal_id            INTEGER     NOT NULL,
      opportunity_type     TEXT        NOT NULL,  -- pip|bi|homeowner|sr22|bad_faith|umbrella
      carrier_hint         TEXT,                  -- inferred likely carrier
      policy_limit_est     INTEGER,               -- estimated policy limit USD
      injury_severity      TEXT,                  -- minor|moderate|severe|fatal
      claimant_count       INTEGER     DEFAULT 1,
      opportunity_score    INTEGER     NOT NULL DEFAULT 0,  -- 0-100
      contact_id           INTEGER,               -- linked contacts.id
      contact_phone        TEXT,
      contact_name         TEXT,
      incident_date        DATE,
      incident_county      TEXT,
      status               TEXT        NOT NULL DEFAULT 'new',  -- new|qualified|referred|closed
      referral_attorney_id INTEGER,
      notes                TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS io_sub_account_idx ON insurance_opportunities (sub_account_id, status);
    CREATE INDEX IF NOT EXISTS io_score_idx       ON insurance_opportunities (opportunity_score DESC);
    CREATE INDEX IF NOT EXISTS io_source_idx      ON insurance_opportunities (signal_source, signal_id);
  `);
}

// ── Opportunity scoring ───────────────────────────────────────────────────────

interface CrashSignal {
  id:               number;
  subAccountId?:    number | null;
  reportNumber?:    string;
  incidentDate?:    Date;
  county?:          string;
  injuryCount?:     number;
  fatalityCount?:   number;
  vehicleCount?:    number;
  contactPhone?:    string;
  contactName?:     string;
  contactId?:       number;
}

function scoreCrashOpportunity(crash: CrashSignal): {
  score: number;
  type: string;
  injurySeverity: string;
  policyLimitEst: number;
} {
  let score = 0;
  let injurySeverity = "minor";
  let type = "pip";
  let policyLimitEst = 10_000;

  // Fatality → highest value BI case
  if ((crash.fatalityCount ?? 0) > 0) {
    score += 60;
    injurySeverity = "fatal";
    type = "bi";
    policyLimitEst = 500_000;
  } else if ((crash.injuryCount ?? 0) >= 3) {
    score += 45;
    injurySeverity = "severe";
    type = "bi";
    policyLimitEst = 100_000;
  } else if ((crash.injuryCount ?? 0) >= 1) {
    score += 30;
    injurySeverity = "moderate";
    type = "pip";
    policyLimitEst = 25_000;
  } else {
    score += 10;
    injurySeverity = "minor";
    type = "pip";
    policyLimitEst = 10_000;
  }

  // Multi-vehicle = higher BI exposure
  if ((crash.vehicleCount ?? 0) >= 3) score += 15;
  else if ((crash.vehicleCount ?? 0) === 2) score += 5;

  // Has contact info = actionable
  if (crash.contactPhone) score += 15;
  if (crash.contactName)  score += 5;

  // Recency bonus (within 7 days)
  if (crash.incidentDate) {
    const ageDays = (Date.now() - crash.incidentDate.getTime()) / 86_400_000;
    if (ageDays <= 7)  score += 10;
    else if (ageDays <= 30) score += 5;
  }

  return { score: Math.min(score, 100), type, injurySeverity, policyLimitEst };
}

// ── Process crash signals ─────────────────────────────────────────────────────

export async function processCrashInsuranceSignals(limit = 100): Promise<{
  processed: number;
  qualified: number;
}> {
  await ensureInsuranceSchema();

  // Fetch crash reports not yet processed for insurance
  const result = await db.execute(sql`
    SELECT cr.id, cr.sub_account_id, cr.report_number, cr.incident_date,
           cr.county, cr.injury_count, cr.fatality_count, cr.vehicle_count,
           c.phone AS contact_phone, c.name AS contact_name, c.id AS contact_id
    FROM crash_reports cr
    LEFT JOIN contacts c ON c.source_external_id = cr.report_number
    WHERE NOT EXISTS (
      SELECT 1 FROM insurance_opportunities io
      WHERE io.signal_source = 'crash_reports' AND io.signal_id = cr.id
    )
    ORDER BY cr.created_at DESC
    LIMIT ${limit}
  `);

  const rows = (result as any).rows ?? result;
  if (!Array.isArray(rows) || rows.length === 0) return { processed: 0, qualified: 0 };

  let qualified = 0;
  for (const row of rows) {
    const crash: CrashSignal = {
      id:           Number(row.id),
      subAccountId: row.sub_account_id ? Number(row.sub_account_id) : null,
      reportNumber: row.report_number,
      incidentDate: row.incident_date ? new Date(row.incident_date) : undefined,
      county:       row.county,
      injuryCount:  row.injury_count ? Number(row.injury_count) : 0,
      fatalityCount: row.fatality_count ? Number(row.fatality_count) : 0,
      vehicleCount:  row.vehicle_count ? Number(row.vehicle_count) : 0,
      contactPhone:  row.contact_phone,
      contactName:   row.contact_name,
      contactId:     row.contact_id ? Number(row.contact_id) : undefined,
    };

    const { score, type, injurySeverity, policyLimitEst } = scoreCrashOpportunity(crash);
    if (score < 20) continue; // below threshold — not worth pursuing

    await db.execute(sql`
      INSERT INTO insurance_opportunities
        (sub_account_id, signal_source, signal_id, opportunity_type, injury_severity,
         policy_limit_est, claimant_count, opportunity_score, contact_id, contact_phone,
         contact_name, incident_date, incident_county)
      VALUES
        (${crash.subAccountId ?? null}, 'crash_reports', ${crash.id}, ${type}, ${injurySeverity},
         ${policyLimitEst}, ${crash.injuryCount ?? 0}, ${score}, ${crash.contactId ?? null},
         ${crash.contactPhone ?? null}, ${crash.contactName ?? null},
         ${crash.incidentDate?.toISOString().slice(0, 10) ?? null}, ${crash.county ?? null})
      ON CONFLICT DO NOTHING
    `);

    // Correlate into intelligence case for cross-signal visibility
    try {
      await correlateSignal({
        signalId:      crash.id,
        signalTable:   "crash_reports",
        signalType:    type,
        canonicalName: crash.contactName ?? `Crash ${crash.reportNumber ?? crash.id}`,
        entityType:    "person",
        county:        crash.county ?? undefined,
        category:      "crash",
        detectedAt:    crash.incidentDate,
        opportunityScore: score,
        urgencyScore:  injurySeverity === "fatal" ? 90 : injurySeverity === "severe" ? 70 : 40,
        financialScore: Math.round(policyLimitEst / 5000),
        legalSeverity:  injurySeverity === "fatal" ? 90 : 50,
      });
    } catch { /* correlation is non-fatal */ }  // allow-silent-catch: non-fatal, returns safe default

    qualified++;
  }

  console.log(`[INSURANCE-PIPELINE] processed=${rows.length} qualified=${qualified}`);
  return { processed: rows.length, qualified };
}

// ── Get opportunities ─────────────────────────────────────────────────────────

export async function getInsuranceOpportunities(params: {
  subAccountId?: number;
  minScore?:     number;
  status?:       string;
  type?:         string;
  limit?:        number;
}): Promise<any[]> {
  await ensureInsuranceSchema();

  const result = await db.execute(sql`
    SELECT * FROM insurance_opportunities
    WHERE
      ${params.subAccountId ? sql`sub_account_id = ${params.subAccountId} AND` : sql``}
      ${params.minScore     ? sql`opportunity_score >= ${params.minScore} AND` : sql``}
      ${params.status       ? sql`status = ${params.status} AND` : sql``}
      ${params.type         ? sql`opportunity_type = ${params.type} AND` : sql``}
      TRUE
    ORDER BY opportunity_score DESC, created_at DESC
    LIMIT ${params.limit ?? 100}
  `);

  const rows = (result as any).rows ?? result;
  return Array.isArray(rows) ? rows : [];
}
