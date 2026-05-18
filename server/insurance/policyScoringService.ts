/**
 * server/insurance/policyScoringService.ts
 *
 * Policy Opportunity Scoring Service
 *
 * Deterministic 0–100 scoring for insurance opportunity quality.
 * No AI inference — pure rules. Scores are reproducible and auditable.
 *
 * Dimensions scored independently:
 *   - Auto opportunity score
 *   - Homeowner opportunity score
 *   - Commercial opportunity score
 *   - Bundling bonus
 *   - Urgency multiplier (time-sensitive signals)
 *
 * Final score = weighted composite, capped at 100.
 * Higher score = higher value, higher urgency, more likely to convert.
 */

import type {
  HouseholdEntity,
  InsuranceSignalType,
  PolicyScoreBreakdown,
  PolicyOpportunityType,
  InsuranceLine,
} from "./types";

// ── Signal base scores ────────────────────────────────────────────────────────

const SIGNAL_SCORES: Partial<Record<InsuranceSignalType, number>> = {
  // Auto — high urgency
  crash_event:           30,
  dui_incident:          35,
  vehicle_total_loss:    28,
  sr22_indicator:        32,
  moving_violation:      15,
  vehicle_registration:  8,
  fleet_vehicle_added:   18,
  teen_driver_added:     20,

  // Homeowner — medium urgency
  property_purchase:     28,
  mortgage_recording:    25,
  ownership_transfer:    22,
  roof_permit:           18,
  remodel_permit:        12,
  storm_exposure_event:  20,
  flood_zone_change:     22,
  valuation_increase:    10,

  // Commercial — high value
  new_business_registration: 25,
  dbpr_license_issued:   22,
  contractor_license:    20,
  fleet_commercial:      18,
  payroll_growth:        15,
  property_expansion:    14,

  // Household transitions
  new_resident:          12,
  household_growth:      10,
  policy_lapse_indicator: 30,
};

// ── Opportunity type mapping ──────────────────────────────────────────────────

interface OpportunityMatch {
  opportunityType: PolicyOpportunityType;
  insuranceLine: InsuranceLine;
  minScore: number;
}

export function detectOpportunityTypes(household: HouseholdEntity): OpportunityMatch[] {
  const opportunities: OpportunityMatch[] = [];
  const signals = new Set(household.activeSignals ?? []);

  // Auto opportunities
  if (signals.has("crash_event") || signals.has("dui_incident") || signals.has("sr22_indicator")) {
    opportunities.push({ opportunityType: "high_risk_auto", insuranceLine: "auto", minScore: 65 });
  }
  if (signals.has("sr22_indicator")) {
    opportunities.push({ opportunityType: "sr22_placement", insuranceLine: "auto", minScore: 70 });
  }
  if (signals.has("vehicle_registration") || signals.has("vehicle_total_loss")) {
    opportunities.push({ opportunityType: "auto_policy_replacement", insuranceLine: "auto", minScore: 50 });
  }
  if ((household.vehicleCount ?? 0) >= 3 || signals.has("fleet_commercial")) {
    opportunities.push({ opportunityType: "fleet_policy", insuranceLine: "commercial_auto", minScore: 55 });
  }

  // Homeowner opportunities
  if (signals.has("property_purchase") || signals.has("mortgage_recording")) {
    opportunities.push({ opportunityType: "new_homeowner_coverage", insuranceLine: "homeowner", minScore: 70 });
  }
  if (signals.has("storm_exposure_event") || (household.stormExposureScore ?? 0) >= 65) {
    opportunities.push({ opportunityType: "hurricane_coverage", insuranceLine: "homeowner", minScore: 60 });
  }
  if (signals.has("flood_zone_change")) {
    opportunities.push({ opportunityType: "flood_insurance", insuranceLine: "flood", minScore: 65 });
  }
  if ((household.roofAgeEstimate ?? 0) >= 15 || signals.has("roof_permit")) {
    opportunities.push({ opportunityType: "roof_replacement_timing", insuranceLine: "homeowner", minScore: 55 });
  }
  if (signals.has("valuation_increase")) {
    opportunities.push({ opportunityType: "policy_upgrade", insuranceLine: "homeowner", minScore: 50 });
  }

  // Bundling
  if (household.isHomeowner && (household.vehicleCount ?? 0) >= 1) {
    opportunities.push({ opportunityType: "bundle_home_auto", insuranceLine: "umbrella", minScore: 60 });
  }

  // Commercial
  if (signals.has("new_business_registration") || signals.has("dbpr_license_issued")) {
    opportunities.push({ opportunityType: "general_liability", insuranceLine: "general_liability", minScore: 60 });
    opportunities.push({ opportunityType: "bop_placement", insuranceLine: "bop", minScore: 55 });
  }
  if (signals.has("contractor_license")) {
    opportunities.push({ opportunityType: "contractor_package", insuranceLine: "general_liability", minScore: 65 });
    opportunities.push({ opportunityType: "workers_comp", insuranceLine: "workers_comp", minScore: 60 });
  }
  if (signals.has("fleet_commercial")) {
    opportunities.push({ opportunityType: "commercial_auto", insuranceLine: "commercial_auto", minScore: 60 });
  }

  // Lapse
  if (signals.has("policy_lapse_indicator")) {
    opportunities.push({ opportunityType: "auto_policy_replacement", insuranceLine: "auto", minScore: 70 });
    if (household.isHomeowner) {
      opportunities.push({ opportunityType: "new_homeowner_coverage", insuranceLine: "homeowner", minScore: 70 });
    }
  }

  return opportunities;
}

// ── Core scoring ──────────────────────────────────────────────────────────────

export function scorePolicy(household: HouseholdEntity): PolicyScoreBreakdown {
  const signals = household.activeSignals ?? [];
  const factors: Record<string, number> = {};

  // ── Auto score ────────────────────────────────────────────────────────────
  let autoScore = 0;
  if ((household.crashCount12Mo ?? 0) > 0) {
    autoScore += 30;
    factors["recent_crash"] = 30;
  }
  if ((household.duiCount36Mo ?? 0) > 0) {
    autoScore += 35;
    factors["dui_history"] = 35;
  }
  if (signals.includes("sr22_indicator")) {
    autoScore += 25;
    factors["sr22_required"] = 25;
  }
  if (signals.includes("teen_driver_added")) {
    autoScore += 20;
    factors["teen_driver"] = 20;
  }
  if ((household.vehicleCount ?? 0) >= 3) {
    autoScore += 10;
    factors["multi_vehicle"] = 10;
  }
  if (signals.includes("policy_lapse_indicator")) {
    autoScore += 20;
    factors["auto_lapse"] = 20;
  }
  autoScore = Math.min(autoScore, 100);

  // ── Homeowner score ───────────────────────────────────────────────────────
  let homeScore = 0;
  if (signals.includes("property_purchase") || signals.includes("mortgage_recording")) {
    homeScore += 35;
    factors["new_homeowner"] = 35;
  }
  if ((household.stormExposureScore ?? 0) >= 70) {
    homeScore += 20;
    factors["high_storm_exposure"] = 20;
  } else if ((household.stormExposureScore ?? 0) >= 50) {
    homeScore += 12;
    factors["moderate_storm_exposure"] = 12;
  }
  if ((household.roofAgeEstimate ?? 0) >= 20) {
    homeScore += 20;
    factors["aging_roof_20y"] = 20;
  } else if ((household.roofAgeEstimate ?? 0) >= 15) {
    homeScore += 12;
    factors["aging_roof_15y"] = 12;
  }
  if (signals.includes("flood_zone_change")) {
    homeScore += 18;
    factors["flood_zone"] = 18;
  }
  if ((household.estimatedHomeValue ?? 0) >= 500_000) {
    homeScore += 15;
    factors["high_value_home"] = 15;
  } else if ((household.estimatedHomeValue ?? 0) >= 300_000) {
    homeScore += 8;
    factors["mid_value_home"] = 8;
  }
  homeScore = Math.min(homeScore, 100);

  // ── Commercial score ──────────────────────────────────────────────────────
  let commercialScore = 0;
  if (household.businessOwner) {
    commercialScore += 25;
    factors["business_owner"] = 25;
  }
  if ((household.dbprLicenseCount ?? 0) >= 1) {
    commercialScore += 20;
    factors["dbpr_license"] = 20;
  }
  if (signals.includes("contractor_license")) {
    commercialScore += 20;
    factors["contractor_license"] = 20;
  }
  if (signals.includes("fleet_commercial")) {
    commercialScore += 18;
    factors["commercial_fleet"] = 18;
  }
  if (signals.includes("new_business_registration")) {
    commercialScore += 22;
    factors["new_business"] = 22;
  }
  commercialScore = Math.min(commercialScore, 100);

  // ── Bundling bonus ────────────────────────────────────────────────────────
  let bundlingBonus = 0;
  if (household.isHomeowner && (household.vehicleCount ?? 0) >= 1) {
    bundlingBonus = 10;
    factors["bundling_eligible"] = 10;
  }

  // ── Urgency multiplier ────────────────────────────────────────────────────
  // Time-sensitive signals boost the final score
  let urgencyMultiplier = 1.0;
  const urgentSignals: InsuranceSignalType[] = [
    "crash_event", "dui_incident", "property_purchase", "mortgage_recording",
    "policy_lapse_indicator", "vehicle_total_loss", "sr22_indicator",
  ];
  const urgentCount = signals.filter(s => urgentSignals.includes(s as InsuranceSignalType)).length;
  if (urgentCount >= 2)      urgencyMultiplier = 1.20;
  else if (urgentCount >= 1) urgencyMultiplier = 1.10;

  // ── Composite total ───────────────────────────────────────────────────────
  const raw = (autoScore * 0.35) + (homeScore * 0.35) + (commercialScore * 0.20) + bundlingBonus;
  const total = Math.min(Math.round(raw * urgencyMultiplier), 100);

  return { total, autoScore, homeownerScore: homeScore, commercialScore, bundlingBonus, urgencyMultiplier, factors };
}

// ── Estimated premium ─────────────────────────────────────────────────────────

export function estimateHouseholdPremium(household: HouseholdEntity): number {
  let annual = 0;

  // Auto: ~$1,400/vehicle baseline; high-risk 2x
  const vehicles = household.vehicleCount ?? 1;
  const isHighRisk = (household.crashCount12Mo ?? 0) > 0 || (household.duiCount36Mo ?? 0) > 0;
  annual += vehicles * (isHighRisk ? 2_800 : 1_400);

  // Home: $1,200 baseline; scales with value
  if (household.isHomeowner) {
    const homeVal = household.estimatedHomeValue ?? 250_000;
    annual += Math.round(homeVal * 0.006); // ~0.6% of home value
  }

  // Commercial: rough estimate by signal
  if (household.businessOwner) annual += 3_500;
  if ((household.dbprLicenseCount ?? 0) >= 1) annual += 2_000;

  return annual;
}

// ── Cross-sell likelihood ─────────────────────────────────────────────────────

export function crossSellLikelihood(household: HouseholdEntity): number {
  let score = 0;
  if (household.isHomeowner && (household.vehicleCount ?? 0) >= 1) score += 40;
  if (household.businessOwner) score += 25;
  if ((household.dbprLicenseCount ?? 0) >= 1) score += 20;
  if ((household.vehicleCount ?? 0) >= 3) score += 15;
  if ((household.stormExposureScore ?? 0) >= 60) score += 15;
  return Math.min(score, 100);
}
