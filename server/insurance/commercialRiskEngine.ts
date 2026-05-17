/**
 * server/insurance/commercialRiskEngine.ts
 *
 * Commercial Risk Engine
 *
 * Converts business registration signals, DBPR license data, and contractor
 * activity into structured commercial insurance opportunities.
 *
 * Coverage opportunities detected:
 *   - General Liability (any business with employees/customers)
 *   - Workers Compensation (contractor/trade businesses)
 *   - Business Owner Policy (small businesses with property)
 *   - Commercial Auto (fleet vehicles)
 *   - Professional Liability (licensed professionals)
 *   - Commercial Property (owned business locations)
 *
 * Crossover with HPL:
 *   - Contractor licenses → contractor package opportunities
 *   - Permit activity → business growth indicators
 *   - Property ownership → commercial property coverage
 *
 * REAL DATA ONLY. No fabricated business intelligence.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool, arr } from "../hpl/sqlSafe";
import type { CommercialRiskEntity, InsuranceLine, InsuranceSignalType } from "./types";

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _ins_commercial_risks (
        id                          SERIAL PRIMARY KEY,
        business_id                 TEXT        NOT NULL UNIQUE,
        business_name               TEXT        NOT NULL,
        owner_name                  TEXT,
        phone                       TEXT,
        email                       TEXT,
        address                     TEXT        NOT NULL,
        county                      TEXT        NOT NULL,
        state                       TEXT        NOT NULL DEFAULT 'FL',

        business_type               TEXT,
        dbpr_license_type           TEXT,
        dbpr_license_number         TEXT,
        employee_count              INTEGER,
        annual_revenue              INTEGER,

        has_contractor_license      BOOLEAN     DEFAULT FALSE,
        has_fleet_vehicles          BOOLEAN     DEFAULT FALSE,
        property_owner              BOOLEAN     DEFAULT FALSE,

        gl_opportunity              BOOLEAN     DEFAULT FALSE,
        wc_opportunity              BOOLEAN     DEFAULT FALSE,
        bop_opportunity             BOOLEAN     DEFAULT FALSE,
        commercial_auto_opportunity BOOLEAN     DEFAULT FALSE,
        prof_liability_opportunity  BOOLEAN     DEFAULT FALSE,

        opportunity_score           INTEGER     DEFAULT 0,
        estimated_annual_premium    INTEGER,
        active_signals              TEXT[]      DEFAULT ARRAY[]::TEXT[],

        created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ins_comm_county_idx ON _ins_commercial_risks (county, opportunity_score DESC);
      CREATE INDEX IF NOT EXISTS ins_comm_score_idx  ON _ins_commercial_risks (opportunity_score DESC);
      CREATE INDEX IF NOT EXISTS ins_comm_type_idx   ON _ins_commercial_risks (business_type);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[INS-COMMERCIAL] Failed to ensure table:", err?.message);
  }
}

// ── DBPR license → business type mapping ─────────────────────────────────────

const DBPR_LICENSE_TO_BUSINESS: Record<string, string> = {
  "contractor":       "contractor",
  "roofing":          "contractor",
  "electrical":       "contractor",
  "plumbing":         "contractor",
  "hvac":             "contractor",
  "salon":            "personal_services",
  "barbershop":       "personal_services",
  "cosmetology":      "personal_services",
  "nail_salon":       "personal_services",
  "massage":          "personal_services",
  "spa":              "personal_services",
  "real_estate":      "real_estate",
  "mortgage":         "financial_services",
  "insurance":        "financial_services",
  "restaurant":       "food_beverage",
  "food_service":     "food_beverage",
  "childcare":        "childcare",
  "medical":          "healthcare",
  "dental":           "healthcare",
  "pharmacy":         "healthcare",
  "veterinary":       "healthcare",
};

// ── Opportunity detection ─────────────────────────────────────────────────────

export function detectCommercialOpportunities(entity: Partial<CommercialRiskEntity>): {
  gl: boolean;
  wc: boolean;
  bop: boolean;
  commercialAuto: boolean;
  profLiability: boolean;
  score: number;
  estimatedPremium: number;
} {
  const btype = entity.businessType ?? "";
  const isContractor = entity.hasContractorLicense || btype === "contractor";
  const isPersonalServices = btype === "personal_services";
  const isHealthcare = btype === "healthcare";
  const isFood = btype === "food_beverage";
  const employees = entity.employeeCount ?? 1;

  let score = 20;
  let premium = 0;

  // GL — virtually every business
  const gl = true;
  score += 20;
  premium += isContractor ? 3_500 : 1_800;

  // Workers Comp — any business with employees
  const wc = employees >= 2 || isContractor;
  if (wc) { score += 18; premium += employees * 800; }

  // BOP — small businesses with property exposure
  const bop = (entity.propertyOwner || isFood || isPersonalServices) && employees < 100;
  if (bop) { score += 15; premium += 2_200; }

  // Commercial Auto — fleets or contractors
  const commercialAuto = Boolean(entity.hasFleetVehicles) || isContractor;
  if (commercialAuto) { score += 15; premium += 2_800; }

  // Professional Liability — licensed professionals
  const profLiability = isHealthcare || btype === "real_estate" || btype === "financial_services";
  if (profLiability) { score += 20; premium += 4_000; }

  // Size bonus
  if (employees >= 10)      { score += 10; }
  else if (employees >= 5)  { score += 5; }
  if ((entity.annualRevenue ?? 0) >= 1_000_000) { score += 10; premium += 1_500; }

  return {
    gl,
    wc,
    bop,
    commercialAuto,
    profLiability,
    score: Math.min(score, 100),
    estimatedPremium: premium,
  };
}

// ── Upsert commercial risk ────────────────────────────────────────────────────

export async function upsertCommercialRisk(
  entity: Partial<CommercialRiskEntity> & { businessId: string; businessName: string; address: string; county: string; state: string },
): Promise<{ businessId: string; isNew: boolean }> {
  await ensureTable();

  const opps = detectCommercialOpportunities(entity);
  const signalsArr = arr(entity.activeSignals as string[] | undefined);

  try {
    const result = await db.execute(sql.raw(`
      INSERT INTO _ins_commercial_risks (
        business_id, business_name, owner_name, phone, email,
        address, county, state,
        business_type, dbpr_license_type, dbpr_license_number,
        employee_count, annual_revenue,
        has_contractor_license, has_fleet_vehicles, property_owner,
        gl_opportunity, wc_opportunity, bop_opportunity,
        commercial_auto_opportunity, prof_liability_opportunity,
        opportunity_score, estimated_annual_premium, active_signals
      ) VALUES (
        ${esc(entity.businessId)}, ${esc(entity.businessName)}, ${esc(entity.ownerName)},
        ${esc(entity.phone)}, ${esc(entity.email)},
        ${esc(entity.address)}, ${esc(entity.county)}, ${esc(entity.state)},
        ${esc(entity.businessType)}, ${esc(entity.dbprLicenseType)}, ${esc(entity.dbprLicenseNumber)},
        ${num(entity.employeeCount)}, ${num(entity.annualRevenue)},
        ${bool(entity.hasContractorLicense)}, ${bool(entity.hasFleetVehicles)}, ${bool(entity.propertyOwner)},
        ${bool(opps.gl)}, ${bool(opps.wc)}, ${bool(opps.bop)},
        ${bool(opps.commercialAuto)}, ${bool(opps.profLiability)},
        ${opps.score}, ${opps.estimatedPremium}, ${signalsArr}
      )
      ON CONFLICT (business_id) DO UPDATE SET
        employee_count              = GREATEST(_ins_commercial_risks.employee_count, EXCLUDED.employee_count),
        annual_revenue              = GREATEST(_ins_commercial_risks.annual_revenue, EXCLUDED.annual_revenue),
        has_contractor_license      = _ins_commercial_risks.has_contractor_license OR EXCLUDED.has_contractor_license,
        has_fleet_vehicles          = _ins_commercial_risks.has_fleet_vehicles OR EXCLUDED.has_fleet_vehicles,
        gl_opportunity              = TRUE,
        wc_opportunity              = _ins_commercial_risks.wc_opportunity OR EXCLUDED.wc_opportunity,
        bop_opportunity             = _ins_commercial_risks.bop_opportunity OR EXCLUDED.bop_opportunity,
        commercial_auto_opportunity = _ins_commercial_risks.commercial_auto_opportunity OR EXCLUDED.commercial_auto_opportunity,
        opportunity_score           = GREATEST(_ins_commercial_risks.opportunity_score, EXCLUDED.opportunity_score),
        estimated_annual_premium    = GREATEST(_ins_commercial_risks.estimated_annual_premium, EXCLUDED.estimated_annual_premium),
        active_signals              = (
          SELECT ARRAY_AGG(DISTINCT elem)
          FROM UNNEST(_ins_commercial_risks.active_signals || EXCLUDED.active_signals) AS elem
        ),
        updated_at                  = NOW()
      RETURNING (xmax = 0) AS is_new
    `));

    const rows = (result as any).rows ?? result;
    const isNew = Array.isArray(rows) && rows[0]?.is_new === true;
    return { businessId: entity.businessId, isNew };
  } catch (err: any) {
    console.error("[INS-COMMERCIAL] Upsert failed:", err?.message);
    return { businessId: entity.businessId, isNew: false };
  }
}

// ── Ingest from DBPR license ──────────────────────────────────────────────────

export async function ingestDbprLicense(license: {
  licenseNumber: string;
  licenseType: string;
  businessName: string;
  ownerName?: string;
  address: string;
  county: string;
  state: string;
  phone?: string;
  email?: string;
  isContractor?: boolean;
}): Promise<{ businessId: string; isNew: boolean }> {
  const businessId = `dbpr_${license.licenseNumber}`;
  const businessType = DBPR_LICENSE_TO_BUSINESS[license.licenseType.toLowerCase()] ?? "other";

  return upsertCommercialRisk({
    businessId,
    businessName: license.businessName,
    ownerName: license.ownerName,
    phone: license.phone,
    email: license.email,
    address: license.address,
    county: license.county,
    state: license.state,
    businessType,
    dbprLicenseType: license.licenseType,
    dbprLicenseNumber: license.licenseNumber,
    hasContractorLicense: license.isContractor,
    activeSignals: ["dbpr_license_issued", ...(license.isContractor ? ["contractor_license" as InsuranceSignalType] : [])],
  });
}

// ── Query ─────────────────────────────────────────────────────────────────────

export async function getTopCommercialOpportunities(opts: {
  county?: string;
  businessType?: string;
  minScore?: number;
  limit?: number;
} = {}): Promise<CommercialRiskEntity[]> {
  await ensureTable();
  const { county, businessType, minScore = 40, limit = 25 } = opts;
  const conditions = [`opportunity_score >= ${minScore}`];
  if (county)       conditions.push(`county = ${esc(county)}`);
  if (businessType) conditions.push(`business_type = ${esc(businessType)}`);
  const where = `WHERE ${conditions.join(" AND ")}`;

  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _ins_commercial_risks ${where}
      ORDER BY opportunity_score DESC
      LIMIT ${limit}
    `));
    const rows = (result as any).rows ?? result;
    return Array.isArray(rows) ? rows.map(mapCommercialRow) : [];
  } catch { return []; }
}

export async function getCommercialStats(): Promise<{
  total: number;
  avgScore: number;
  contractorCount: number;
  glCount: number;
  wcCount: number;
  bopCount: number;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                                           AS total,
        AVG(opportunity_score)                             AS avg_score,
        COUNT(CASE WHEN has_contractor_license THEN 1 END) AS contractors,
        COUNT(CASE WHEN gl_opportunity THEN 1 END)         AS gl,
        COUNT(CASE WHEN wc_opportunity THEN 1 END)         AS wc,
        COUNT(CASE WHEN bop_opportunity THEN 1 END)        AS bop
      FROM _ins_commercial_risks
    `));
    const rows = (result as any).rows ?? result;
    const r = rows[0] ?? {};
    return {
      total:           Number(r.total ?? 0),
      avgScore:        parseFloat(r.avg_score ?? "0"),
      contractorCount: Number(r.contractors ?? 0),
      glCount:         Number(r.gl ?? 0),
      wcCount:         Number(r.wc ?? 0),
      bopCount:        Number(r.bop ?? 0),
    };
  } catch {
    return { total: 0, avgScore: 0, contractorCount: 0, glCount: 0, wcCount: 0, bopCount: 0 };
  }
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function mapCommercialRow(r: any): CommercialRiskEntity {
  return {
    businessId:                r.business_id,
    businessName:              r.business_name,
    ownerName:                 r.owner_name ?? undefined,
    phone:                     r.phone ?? undefined,
    email:                     r.email ?? undefined,
    address:                   r.address,
    county:                    r.county,
    state:                     r.state,
    businessType:              r.business_type ?? undefined,
    dbprLicenseType:           r.dbpr_license_type ?? undefined,
    dbprLicenseNumber:         r.dbpr_license_number ?? undefined,
    employeeCount:             r.employee_count ?? undefined,
    annualRevenue:             r.annual_revenue ?? undefined,
    hasContractorLicense:      Boolean(r.has_contractor_license),
    hasFleetVehicles:          Boolean(r.has_fleet_vehicles),
    propertyOwner:             Boolean(r.property_owner),
    glOpportunity:             Boolean(r.gl_opportunity),
    wcOpportunity:             Boolean(r.wc_opportunity),
    bopOpportunity:            Boolean(r.bop_opportunity),
    commercialAutoOpportunity: Boolean(r.commercial_auto_opportunity),
    opportunityScore:          Number(r.opportunity_score ?? 0),
    activeSignals:             r.active_signals ?? [],
    createdAt:                 r.created_at?.toISOString?.() ?? undefined,
  };
}
