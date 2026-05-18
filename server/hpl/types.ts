/**
 * server/hpl/types.ts
 *
 * Canonical type definitions for the HPL (Home Property Leads) intelligence engine.
 * All HPL modules import from here — no circular deps.
 */

// ── Service trades ─────────────────────────────────────────────────────────────

export type ServiceTrade =
  | "roofing"
  | "hvac"
  | "plumbing"
  | "electrical"
  | "windows_doors"
  | "gutters"
  | "siding"
  | "painting"
  | "flooring"
  | "insulation"
  | "restoration"
  | "waterproofing"
  | "foundation"
  | "landscaping"
  | "fencing"
  | "pool_spa"
  | "solar"
  | "tree_service"
  | "pest_control"
  | "general_contractor";

// ── HPL signal types ──────────────────────────────────────────────────────────

export type HPLSignalType =
  | "roofing_permit"
  | "hvac_permit"
  | "plumbing_permit"
  | "electrical_permit"
  | "renovation_permit"
  | "pool_permit"
  | "solar_permit"
  | "fence_permit"
  | "window_permit"
  | "siding_permit"
  | "storm_event"
  | "hail_event"
  | "wind_event"
  | "flood_event"
  | "hurricane_event"
  | "insurance_claim"
  | "pre_foreclosure"
  | "tax_delinquency"
  | "ownership_change"
  | "high_equity"
  | "absentee_owner";

// ── Property entity ───────────────────────────────────────────────────────────

export type PropertyType =
  | "single_family"
  | "condo"
  | "townhouse"
  | "multi_family"
  | "commercial"
  | "mobile_home"
  | "vacant_land"
  | "unknown";

export type OccupancyType =
  | "owner_occupied"
  | "tenant_occupied"
  | "vacant"
  | "unknown";

export interface PropertyEntity {
  apexPropertyId: string;         // SHA256(address|county|state)[0:24]
  propertyAddress: string;
  county: string;
  state: string;
  zip?: string;
  lat?: number;
  lng?: number;

  // Ownership
  ownerName?: string;
  ownerPhone?: string;
  ownerEmail?: string;
  mailingAddress?: string;
  ownerInState?: boolean;
  occupancyType?: OccupancyType;

  // Property attributes
  propertyType?: PropertyType;
  squareFootage?: number;
  yearBuilt?: number;
  bedrooms?: number;
  bathrooms?: number;
  lotSizeSqft?: number;

  // Financial
  estimatedValue?: number;
  assessedValue?: number;
  equityEstimate?: number;
  lastSalePrice?: number;
  lastSaleDate?: string;
  mortgageBalance?: number;

  // Condition signals
  roofAgeEstimate?: number;
  lastRoofPermitDate?: string;
  weatherZone?: string;
  stormExposureScore?: number;     // 0–100, higher = more exposed

  // Active signals
  activeSignals?: HPLSignalType[];
  permitHistory?: PermitRecord[];
  insuranceIndicators?: string[];

  // Opportunity scoring
  contractorOpportunityScore?: number; // 0–100
  urgencyScore?: number;               // 0–100

  // Enrichment metadata
  enrichmentSources?: string[];
  lastEnrichedAt?: string;
  skipTraceCompleted?: boolean;
}

// ── Permit records ────────────────────────────────────────────────────────────

export interface PermitRecord {
  permitId?: string;
  permitType: string;
  trade: ServiceTrade;
  status: "issued" | "finaled" | "expired" | "voided" | "pending";
  issuedDate?: string;
  finaledDate?: string;
  estimatedValue?: number;
  contractor?: string;
  description?: string;
  county: string;
  address: string;
}

// ── Storm events ──────────────────────────────────────────────────────────────

export interface StormEvent {
  eventId: string;
  eventType: "hail" | "wind" | "flood" | "hurricane" | "tornado" | "freeze" | "severe_storm";
  severity: "minor" | "moderate" | "severe" | "extreme";
  county: string;
  state: string;
  startedAt: string;
  expiresAt?: string;
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  hailSizeInches?: number;
  windSpeedMph?: number;
  affectedProperties?: number;
  primaryTrades: ServiceTrade[];
  insuranceCrossFit: boolean;
  opportunityScore: number;        // 0–100
  source: string;
}

// ── Contractor profile ────────────────────────────────────────────────────────

export interface ContractorProfile {
  id: number;
  subAccountId?: number;
  businessName: string;
  ownerName?: string;
  phone: string;
  email?: string;
  trades: ServiceTrade[];
  serviceCounties: string[];
  tier: "exclusive" | "preferred" | "standard" | "pay_per_lead";
  active: boolean;
  capacityScore: number;           // 0–100
  reputationScore: number;         // 0–100
  avgLeadClaimTimeSec?: number;
  totalLeadsClaimed?: number;
  totalLeadsConverted?: number;
  licenseNumber?: string;
  licenseExpiry?: string;
  insuranceCertified?: boolean;
}

// ── Routing ───────────────────────────────────────────────────────────────────

export type RoutingTier = "exclusive" | "shared_2" | "shared_5" | "open";

export interface RoutingAssignment {
  leadId: number;
  contractorId: number;
  trade: ServiceTrade;
  routingTier: RoutingTier;
  matchScore: number;
  assignedAt: string;
  expiresAt: string;
  exclusive: boolean;
  notificationSent: boolean;
}

// ── Workflow types ────────────────────────────────────────────────────────────

export type ContractorWorkflowType =
  | "missed_call_textback"
  | "estimate_followup"
  | "appointment_reminder"
  | "review_request"
  | "abandoned_estimate"
  | "storm_outreach"
  | "new_lead_notification"
  | "lead_expiry_warning"
  | "seasonal_campaign";
