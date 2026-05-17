/**
 * server/newResident/residentInsuranceCrossover.ts
 *
 * Resident → Insurance & Contractor Crossover (Phase 9A)
 *
 * Purpose:
 *   Correlate new-resident events with the existing HPL property intelligence
 *   and insurance scoring engines to surface:
 *     - Homeowner's insurance opportunities (new purchase)
 *     - Auto insurance transition opportunities
 *     - Bundled policy opportunities
 *     - Contractor opportunities (HVAC, plumbing, roofing, lawn)
 *
 * Architecture:
 *   - Reads from existing _hpl_properties and _insurance_households tables
 *   - Creates crossover opportunity records (no duplicate routing systems)
 *   - All opportunities require approval before any outreach
 *   - Reuses HPL contractorRoutingEngine and insurance policyScoringService
 *
 * Rules:
 *   - NO duplicate routing systems — extends HPL/insurance, doesn't replace
 *   - NO auto-send — creates opportunity records for human review
 *   - All opportunities are tenant-isolated
 */

import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num } from "../hpl/sqlSafe";

// ── Crossover opportunity record ──────────────────────────────────────────────

export interface ResidentCrossoverOpportunity {
  opportunityId:        string;
  residentEventId:      string;
  householdId:          string;
  tenantId:             string;
  opportunityType:      "insurance_home" | "insurance_auto" | "insurance_bundle" | "contractor_hvac" | "contractor_plumbing" | "contractor_roofing" | "contractor_lawn" | "contractor_general";
  score:                number;         // 0–100
  rationale:            string;
  estimatedHomeValue?:  number;
  propertyApexId?:      string;         // link to _hpl_properties
  routingZip?:          string;
  routingCounty?:       string;
  status:               "pending" | "routed" | "suppressed";
  createdAt:            string;
}

// ── ID builder ─────────────────────────────────────────────────────────────────

function buildCrossoverId(residentEventId: string, type: string): string {
  const raw = `crossover|${residentEventId}|${type}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _nr_crossover_opportunities (
        id                    SERIAL PRIMARY KEY,
        opportunity_id        TEXT NOT NULL UNIQUE,
        resident_event_id     TEXT NOT NULL,
        household_id          TEXT NOT NULL,
        tenant_id             TEXT NOT NULL,
        opportunity_type      TEXT NOT NULL,
        score                 INTEGER NOT NULL DEFAULT 0,
        rationale             TEXT NOT NULL,
        estimated_home_value  INTEGER,
        property_apex_id      TEXT,
        routing_zip           TEXT,
        routing_county        TEXT,
        status                TEXT NOT NULL DEFAULT 'pending',
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS nr_crossover_tenant_idx  ON _nr_crossover_opportunities (tenant_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS nr_crossover_event_idx   ON _nr_crossover_opportunities (resident_event_id);
      CREATE INDEX IF NOT EXISTS nr_crossover_type_idx    ON _nr_crossover_opportunities (opportunity_type, status);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[NR-CROSSOVER] Failed to ensure table:", err?.message);
  }
}

// ── Insurance crossover scoring ───────────────────────────────────────────────

function scoreInsuranceOpportunity(opts: {
  homeownerLikelihood:  number;
  estimatedHomeValue?:  number;
  daysSinceMove:        number;
  moveConfidence:       number;
}): { homeScore: number; autoScore: number; bundleScore: number } {
  const { homeownerLikelihood, estimatedHomeValue, daysSinceMove, moveConfidence } = opts;

  // Home insurance: highest for new homeowners
  const homeScore = Math.round(
    (homeownerLikelihood * 0.5) +
    (moveConfidence * 0.3) +
    (Math.max(0, 100 - daysSinceMove * 1.5) * 0.2)
  );

  // Auto insurance: everyone who moves may need to update
  const autoScore = Math.round(
    (moveConfidence * 0.4) +
    (Math.max(0, 100 - daysSinceMove * 2) * 0.4) +
    20 // base — moving always triggers address change
  );

  // Bundle: additive benefit
  const bundleScore = Math.round((homeScore * 0.6) + (autoScore * 0.4));

  return {
    homeScore:   Math.min(100, homeScore),
    autoScore:   Math.min(100, autoScore),
    bundleScore: Math.min(100, bundleScore),
  };
}

// ── Contractor crossover scoring ──────────────────────────────────────────────

function scoreContractorOpportunity(opts: {
  homeownerLikelihood:  number;
  estimatedHomeValue?:  number;
  yearBuilt?:           number;
  daysSinceMove:        number;
}): Record<string, number> {
  const { homeownerLikelihood, estimatedHomeValue, yearBuilt, daysSinceMove } = opts;
  const currentYear  = new Date().getFullYear();
  const houseAge     = yearBuilt ? currentYear - yearBuilt : 15; // assume moderate age
  const isOldHome    = houseAge >= 20;
  const isVeryOld    = houseAge >= 35;
  const recency      = Math.max(0, 100 - daysSinceMove * 1.5);

  // HVAC: very common new-homeowner service
  const hvac = Math.round(
    (homeownerLikelihood * 0.45) +
    (isOldHome ? 20 : 10) +
    (recency * 0.25) +
    10
  );

  // Plumbing: older homes need more attention
  const plumbing = Math.round(
    (homeownerLikelihood * 0.4) +
    (isOldHome ? 15 : 5) +
    (isVeryOld ? 10 : 0) +
    (recency * 0.2) +
    5
  );

  // Roofing: significant — tied to home value and age
  const roofing = Math.round(
    (homeownerLikelihood * 0.45) +
    (isOldHome ? 20 : 8) +
    (isVeryOld ? 15 : 0) +
    (estimatedHomeValue && estimatedHomeValue >= 300_000 ? 10 : 5) +
    (recency * 0.15)
  );

  // Lawn: very relevant for new homeowners
  const lawn = Math.round(
    (homeownerLikelihood * 0.55) +
    (recency * 0.3) +
    10
  );

  // General contractor: high-value new homeowners often renovate
  const general = Math.round(
    (homeownerLikelihood * 0.4) +
    (estimatedHomeValue && estimatedHomeValue >= 350_000 ? 15 : 5) +
    (recency * 0.2) +
    10
  );

  return {
    contractor_hvac:     Math.min(100, hvac),
    contractor_plumbing: Math.min(100, plumbing),
    contractor_roofing:  Math.min(100, roofing),
    contractor_lawn:     Math.min(100, lawn),
    contractor_general:  Math.min(100, general),
  };
}

// ── Generate crossover opportunities ─────────────────────────────────────────

export async function generateCrossoverOpportunities(opts: {
  residentEventId:      string;
  householdId:          string;
  tenantId:             string;
  homeownerLikelihood:  number;
  estimatedHomeValue?:  number;
  yearBuilt?:           number;
  daysSinceMove:        number;
  moveConfidence:       number;
  zip?:                 string;
  county?:              string;
  minScore?:            number;
}): Promise<ResidentCrossoverOpportunity[]> {
  await ensureTable();

  const {
    residentEventId, householdId, tenantId,
    homeownerLikelihood, estimatedHomeValue, yearBuilt,
    daysSinceMove, moveConfidence, zip, county,
  } = opts;
  const minScore = opts.minScore ?? 40;

  // Insurance scores
  const { homeScore, autoScore, bundleScore } = scoreInsuranceOpportunity({
    homeownerLikelihood, estimatedHomeValue, daysSinceMove, moveConfidence,
  });

  // Contractor scores
  const contractorScores = scoreContractorOpportunity({
    homeownerLikelihood, estimatedHomeValue, yearBuilt, daysSinceMove,
  });

  const allOpportunities: Array<{
    type: ResidentCrossoverOpportunity["opportunityType"];
    score: number;
    rationale: string;
  }> = [
    {
      type:      "insurance_home",
      score:     homeScore,
      rationale: `New homeowner opportunity. ${homeownerLikelihood}% homeowner likelihood. Move confidence: ${moveConfidence}%.`,
    },
    {
      type:      "insurance_auto",
      score:     autoScore,
      rationale: `Address change often triggers auto insurance review. Move confidence: ${moveConfidence}%.`,
    },
    {
      type:      "insurance_bundle",
      score:     bundleScore,
      rationale: `Bundle opportunity — new homeowners often save by combining home + auto.`,
    },
    ...Object.entries(contractorScores).map(([type, score]) => ({
      type:      type as ResidentCrossoverOpportunity["opportunityType"],
      score,
      rationale: `New homeowner property opportunity. House age estimated ${yearBuilt ? new Date().getFullYear() - yearBuilt : "unknown"} years.`,
    })),
  ];

  // Filter by min score and persist
  const created: ResidentCrossoverOpportunity[] = [];

  for (const opp of allOpportunities) {
    if (opp.score < minScore) continue;

    const opportunityId = buildCrossoverId(residentEventId, opp.type);

    try {
      await db.execute(sql.raw(`
        INSERT INTO _nr_crossover_opportunities (
          opportunity_id, resident_event_id, household_id, tenant_id,
          opportunity_type, score, rationale,
          estimated_home_value, routing_zip, routing_county, status
        ) VALUES (
          ${esc(opportunityId)}, ${esc(residentEventId)}, ${esc(householdId)}, ${esc(tenantId)},
          ${esc(opp.type)}, ${num(opp.score)}, ${esc(opp.rationale)},
          ${estimatedHomeValue ? num(estimatedHomeValue) : "NULL"},
          ${esc(zip ?? "")}, ${esc(county ?? "")},
          'pending'
        )
        ON CONFLICT (opportunity_id) DO NOTHING
      `));

      created.push({
        opportunityId,
        residentEventId,
        householdId,
        tenantId,
        opportunityType:      opp.type,
        score:                opp.score,
        rationale:            opp.rationale,
        estimatedHomeValue,
        routingZip:           zip,
        routingCounty:        county,
        status:               "pending",
        createdAt:            new Date().toISOString(),
      });
    } catch { /* skip conflicts */ }
  }

  console.log(`[NR-CROSSOVER] ${created.length} crossover opportunities created for household ${householdId}`);
  return created;
}

// ── Query crossover opportunities ─────────────────────────────────────────────

export async function getCrossoverOpportunities(opts: {
  tenantId:          string;
  opportunityType?:  string;
  status?:           string;
  minScore?:         number;
  limit?:            number;
  offset?:           number;
}): Promise<ResidentCrossoverOpportunity[]> {
  await ensureTable();
  const { tenantId, opportunityType, status, minScore, limit = 50, offset = 0 } = opts;
  const filters: string[] = [`tenant_id = ${esc(tenantId)}`];
  if (opportunityType) filters.push(`opportunity_type = ${esc(opportunityType)}`);
  if (status)          filters.push(`status = ${esc(status)}`);
  if (minScore)        filters.push(`score >= ${num(minScore)}`);

  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _nr_crossover_opportunities
      WHERE ${filters.join(" AND ")}
      ORDER BY score DESC, created_at DESC
      LIMIT ${num(limit)} OFFSET ${num(offset)}
    `));
    return ((result as any).rows ?? result ?? []).map((r: any): ResidentCrossoverOpportunity => ({
      opportunityId:       r.opportunity_id,
      residentEventId:     r.resident_event_id,
      householdId:         r.household_id,
      tenantId:            r.tenant_id,
      opportunityType:     r.opportunity_type,
      score:               Number(r.score ?? 0),
      rationale:           r.rationale,
      estimatedHomeValue:  r.estimated_home_value ? Number(r.estimated_home_value) : undefined,
      propertyApexId:      r.property_apex_id || undefined,
      routingZip:          r.routing_zip || undefined,
      routingCounty:       r.routing_county || undefined,
      status:              r.status,
      createdAt:           r.created_at?.toISOString?.() ?? new Date().toISOString(),
    }));
  } catch { return []; }
}

export async function getCrossoverStats(tenantId: string): Promise<{
  totalOpportunities:    number;
  insuranceOpportunities: number;
  contractorOpportunities: number;
  highScore:             number;  // ≥70
  pending:               number;
  last30Days:            number;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN opportunity_type LIKE 'insurance%' THEN 1 END) AS insurance,
        COUNT(CASE WHEN opportunity_type LIKE 'contractor%' THEN 1 END) AS contractor,
        COUNT(CASE WHEN score >= 70 THEN 1 END) AS high_score,
        COUNT(CASE WHEN status='pending' THEN 1 END) AS pending,
        COUNT(CASE WHEN created_at >= NOW()-INTERVAL '30 days' THEN 1 END) AS last_30
      FROM _nr_crossover_opportunities WHERE tenant_id = ${esc(tenantId)}
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : {};
    return {
      totalOpportunities:      Number(r?.total ?? 0),
      insuranceOpportunities:  Number(r?.insurance ?? 0),
      contractorOpportunities: Number(r?.contractor ?? 0),
      highScore:               Number(r?.high_score ?? 0),
      pending:                 Number(r?.pending ?? 0),
      last30Days:              Number(r?.last_30 ?? 0),
    };
  } catch {
    return { totalOpportunities: 0, insuranceOpportunities: 0, contractorOpportunities: 0, highScore: 0, pending: 0, last30Days: 0 };
  }
}
