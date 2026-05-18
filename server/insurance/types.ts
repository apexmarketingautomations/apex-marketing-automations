/**
 * server/insurance/types.ts
 *
 * Canonical type definitions for the Apex Insurance Intelligence Engine.
 * All insurance modules import from here — no circular deps.
 */

// ── Insurance lines ───────────────────────────────────────────────────────────

export type InsuranceLine =
  | "auto"
  | "homeowner"
  | "flood"
  | "umbrella"
  | "commercial_auto"
  | "general_liability"
  | "workers_comp"
  | "bop"              // Business Owner Policy
  | "professional_liability"
  | "commercial_property"
  | "life"
  | "health";

// ── Signal types ──────────────────────────────────────────────────────────────

export type InsuranceSignalType =
  // Auto signals
  | "crash_event"
  | "dui_incident"
  | "vehicle_registration"
  | "moving_violation"
  | "vehicle_total_loss"
  | "sr22_indicator"
  | "fleet_vehicle_added"
  // Homeowner signals
  | "property_purchase"
  | "mortgage_recording"
  | "ownership_transfer"
  | "valuation_increase"
  | "remodel_permit"
  | "roof_permit"
  | "storm_exposure_event"
  | "flood_zone_change"
  // Commercial signals
  | "new_business_registration"
  | "dbpr_license_issued"
  | "contractor_license"
  | "payroll_growth"
  | "property_expansion"
  | "fleet_commercial"
  // Household transitions
  | "new_resident"
  | "household_growth"
  | "teen_driver_added"
  | "senior_transition"
  | "policy_lapse_indicator";

// ── Opportunity types ─────────────────────────────────────────────────────────

export type PolicyOpportunityType =
  // Auto
  | "auto_policy_replacement"
  | "high_risk_auto"
  | "sr22_placement"
  | "commercial_auto"
  | "fleet_policy"
  // Homeowner
  | "new_homeowner_coverage"
  | "policy_upgrade"
  | "roof_replacement_timing"
  | "flood_insurance"
  | "hurricane_coverage"
  // Bundling
  | "bundle_home_auto"
  | "bundle_commercial"
  // Commercial
  | "general_liability"
  | "workers_comp"
  | "bop_placement"
  | "contractor_package"
  | "commercial_property"
  // Life / other
  | "life_opportunity"
  | "umbrella_upgrade";

// ── Household entity ──────────────────────────────────────────────────────────

export interface HouseholdEntity {
  householdId: string;          // SHA256(primaryAddress)[0:24]
  primaryAddress: string;
  county: string;
  state: string;
  zip?: string;

  // Residents
  primaryName?: string;
  primaryPhone?: string;
  primaryEmail?: string;
  residentCount?: number;
  hasTeenDriver?: boolean;
  hasSenior?: boolean;

  // Vehicles
  vehicleCount?: number;
  vehicles?: VehicleRecord[];

  // Properties
  propertyCount?: number;
  primaryPropertyApexId?: string;
  isHomeowner?: boolean;
  estimatedHomeValue?: number;
  roofAgeEstimate?: number;

  // Risk
  crashCount12Mo?: number;
  duiCount36Mo?: number;
  stormExposureScore?: number;  // 0-100 from HPL
  floodZone?: string;

  // Scoring
  policyOpportunityScore?: number;  // 0-100
  bundlingOpportunity?: boolean;
  estimatedHouseholdPremium?: number;

  // Commercial
  businessOwner?: boolean;
  businessType?: string;
  dbprLicenseCount?: number;
  commercialOpportunity?: boolean;

  // Metadata
  activeSignals?: InsuranceSignalType[];
  enrichmentSources?: string[];
  lastScoredAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ── Vehicle record ────────────────────────────────────────────────────────────

export interface VehicleRecord {
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  isCommercial?: boolean;
  registrationState?: string;
  crashHistory?: number;
  estimatedValue?: number;
}

// ── Insurance opportunity ─────────────────────────────────────────────────────

export interface InsuranceOpportunity {
  opportunityId: string;
  householdId?: string;
  apexPropertyId?: string;
  opportunityType: PolicyOpportunityType;
  insuranceLine: InsuranceLine;

  urgencyScore: number;          // 0-100; higher = act sooner
  replacementLikelihood: number; // 0-100
  crossSellLikelihood: number;   // 0-100
  estimatedAnnualPremium?: number;

  triggerSignals: InsuranceSignalType[];
  county: string;
  state: string;
  zip?: string;

  primaryName?: string;
  primaryPhone?: string;
  primaryEmail?: string;

  insuranceCrossFit: boolean;
  stormRelated?: boolean;
  commercialRelated?: boolean;

  status: "new" | "routed" | "contacted" | "quoted" | "bound" | "lost" | "expired";
  expiresAt?: string;
  createdAt?: string;
}

// ── Policy score breakdown ────────────────────────────────────────────────────

export interface PolicyScoreBreakdown {
  total: number;
  autoScore: number;
  homeownerScore: number;
  commercialScore: number;
  bundlingBonus: number;
  urgencyMultiplier: number;
  factors: Record<string, number>;
}

// ── Agency / carrier profile ──────────────────────────────────────────────────

export type AgencyTier = "exclusive" | "preferred" | "standard" | "pay_per_lead";

export interface InsuranceAgencyProfile {
  id: number;
  subAccountId?: number;
  agencyName: string;
  ownerName?: string;
  phone: string;
  email?: string;
  licenseNumber?: string;
  licenseState?: string;

  linesOfBusiness: InsuranceLine[];
  serviceCounties: string[];
  serviceZips?: string[];
  tier: AgencyTier;
  active: boolean;

  carriersRepresented?: string[];
  specializations?: string[];
  bilingualCapable?: boolean;
  commercialCapable?: boolean;
  highRiskCapable?: boolean;

  capacityScore: number;
  reputationScore: number;
  avgLeadClaimTimeSec?: number;
  totalLeadsClaimed?: number;
  totalBound?: number;
}

// ── Insurance workflow types ──────────────────────────────────────────────────

export type InsuranceWorkflowType =
  | "new_opportunity_alert"
  | "storm_claim_outreach"
  | "quote_followup"
  | "policy_renewal_reminder"
  | "bundle_recommendation"
  | "commercial_outreach"
  | "high_risk_placement"
  | "lapse_reactivation"
  | "roof_replacement_timing"
  | "homeowner_welcome";

// ── Commercial risk entity ────────────────────────────────────────────────────

export interface CommercialRiskEntity {
  businessId: string;
  businessName: string;
  ownerName?: string;
  phone?: string;
  email?: string;
  address: string;
  county: string;
  state: string;

  businessType?: string;
  dbprLicenseType?: string;
  dbprLicenseNumber?: string;
  employeeCount?: number;
  annualRevenue?: number;

  hasContractorLicense?: boolean;
  hasFleetVehicles?: boolean;
  propertyOwner?: boolean;

  glOpportunity?: boolean;
  wcOpportunity?: boolean;
  bopOpportunity?: boolean;
  commercialAutoOpportunity?: boolean;

  opportunityScore: number;
  activeSignals?: InsuranceSignalType[];
  createdAt?: string;
}
