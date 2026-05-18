/**
 * server/newResident/types.ts
 *
 * Canonical types for the New Resident Intelligence Engine (Phase 9A).
 *
 * All new-resident modules import from here — no circular deps.
 *
 * Design axioms:
 *   - "Local welcome intelligence" not surveillance advertising
 *   - Move confidence must be HIGH (≥70) before a household record is created
 *   - NO protected-attribute inference (race, religion, political affiliation)
 *   - Every opportunity routes through approval + compliance guard
 *   - Household data is tenant-isolated; cross-tenant queries are blocked
 *   - Source signals are public-record only (deeds, permits, USPS indicators)
 */

// ── Move signal sources (public-record only) ──────────────────────────────────

export type MoveSignalSource =
  | "property_deed_transfer"     // recorded deed change
  | "homestead_filing"           // homestead exemption application
  | "permit_new_address"         // permit filed at address with no prior history
  | "usps_address_change"        // USPS NCOA / address normalization indicator
  | "mailing_address_mismatch"   // tax mail address ≠ property address
  | "utility_activation_signal"  // utility hookup indicator (aggregated, not PII)
  | "voter_registration_change"  // public voter roll address update
  | "dmv_address_indicator"      // public DMV address change flag (no PII)
  | "lease_turnover_signal"      // rental listing taken off market, new tenants
  | "hoa_new_member"             // HOA membership record change
  | "internet_activation"        // ISP installation signal (aggregated)
  | "manual_ingest"              // operator-provided data
  | "partner_data_feed";         // third-party new-mover list (NCOA-compliant)

// ── Occupancy transition type ─────────────────────────────────────────────────

export type OccupancyTransitionType =
  | "purchase_owner_occupied"    // buyer moving in as primary residence
  | "purchase_investor"          // investor purchase, likely renter household
  | "renter_turnover"            // existing rental unit with new tenants
  | "family_change"              // household composition change, same address
  | "unknown";

// ── Service business categories for matching ──────────────────────────────────

export type ResidentServiceCategory =
  | "salon"
  | "barber"
  | "nail_salon"
  | "med_spa"
  | "gym_fitness"
  | "lawn_care"
  | "hvac"
  | "plumbing"
  | "electrical"
  | "general_contractor"
  | "roofing"
  | "pest_control"
  | "pool_service"
  | "restaurant"
  | "grocery_delivery"
  | "insurance_home"
  | "insurance_auto"
  | "insurance_bundle"
  | "moving_storage"
  | "interior_design"
  | "home_security"
  | "cleaning_service"
  | "childcare"
  | "pet_services"
  | "auto_dealer"
  | "custom";

// ── Resident workflow types ───────────────────────────────────────────────────

export type ResidentWorkflowType =
  | "homeowner_welcome"
  | "local_service_introduction"
  | "salon_barber_intro"
  | "insurance_onboarding"
  | "lawn_care_intro"
  | "hvac_inspection_offer"
  | "local_restaurant_offer"
  | "neighborhood_welcome_package"
  | "contractor_intro"
  | "home_security_intro"
  | "cleaning_service_intro"
  | "insurance_bundle_offer"
  | "custom_outreach";

// ── Opportunity category tags ─────────────────────────────────────────────────

export type ResidentOpportunityCategory =
  | "home_services"        // HVAC, plumbing, electrical, roofing
  | "personal_services"    // salon, barber, nail, gym
  | "insurance"            // home, auto, bundle
  | "food_beverage"        // restaurants, delivery
  | "retail_local"         // local shops
  | "home_improvement"     // contractor, painting, flooring
  | "lawn_outdoor"         // lawn care, landscaping, pool
  | "security_tech"        // home security, internet
  | "professional_services"; // legal, financial

// ── Lifecycle stage ───────────────────────────────────────────────────────────

export type HouseholdLifecycleStage =
  | "pre_move"             // signals detected, move not confirmed
  | "move_confirmed"       // deed/utility confirmed
  | "move_in_week_1"       // 0–7 days post move
  | "move_in_month_1"      // 8–30 days
  | "settling_in"          // 31–90 days
  | "established"          // 90+ days
  | "unknown";

// ── Confidence tier — guards against weak merges ─────────────────────────────

export type MoveConfidenceTier =
  | "high"     // ≥70 — creates household record
  | "medium"   // 40–69 — creates provisional record, flagged for review
  | "low";     // <40 — logged only, no household creation

// ── NEW RESIDENT EVENT — canonical event emitted by transition engine ─────────

export interface NewResidentEvent {
  residentEventId:        string;   // SHA256(address|county|ts)[0:24]
  householdId:            string;   // SHA256(normalizedAddress)[0:24]
  tenantId:               string;

  // Property
  propertyAddress:        string;
  normalizedAddress?:     string;
  county:                 string;
  state:                  string;
  zip?:                   string;

  // Move intelligence (NO protected attributes here)
  occupancyTransition:    OccupancyTransitionType;
  moveConfidence:         number;   // 0–100
  moveConfidenceTier:     MoveConfidenceTier;
  homeownerLikelihood:    number;   // 0–100
  renterLikelihood:       number;   // 0–100
  estimatedMoveDate?:     string;   // ISO date — approximate
  moveWindowDays:         number;   // how wide the uncertainty window is

  // Signals
  sourceSignals:          MoveSignalSource[];
  signalCount:            number;

  // Opportunity
  opportunityCategories:  ResidentOpportunityCategory[];
  opportunityScore:       number;   // 0–100 aggregate
  estimatedHomeValue?:    number;
  propertyType?:          string;

  // Lifecycle
  lifecycleStage:         HouseholdLifecycleStage;
  daysSinceMoveEstimate:  number;

  // Audit
  createdAt:              string;
  processedAt?:           string;
  suppressed:             boolean;  // compliance-suppressed
  suppressionReason?:     string;
}

// ── Resident household record (extended from insurance HouseholdEntity) ────────

export interface ResidentHousehold {
  householdId:            string;
  tenantId:               string;

  // Address
  propertyAddress:        string;
  county:                 string;
  state:                  string;
  zip?:                   string;

  // Occupancy
  occupancyTransition:    OccupancyTransitionType;
  lifecycleStage:         HouseholdLifecycleStage;
  estimatedMoveDate?:     string;
  moveConfidence:         number;
  homeownerLikelihood:    number;
  renterLikelihood:       number;

  // Opportunity scoring
  opportunityScore:       number;   // 0–100
  homeServiceScore:       number;   // 0–100 contractor/HVAC/plumbing
  personalServiceScore:   number;   // 0–100 salon/barber/gym
  insuranceScore:         number;   // 0–100 home/auto
  localBusinessScore:     number;   // 0–100 restaurant/retail

  // Property context (no PII derived inferences)
  estimatedHomeValue?:    number;
  propertyType?:          string;
  yearBuilt?:             number;

  // Workflow
  lastWorkflowAt?:        string;
  workflowCount:          number;
  suppressedAt?:          string;
  suppressionReason?:     string;

  // Audit
  createdAt:              string;
  updatedAt:              string;
}

// ── Business match result ─────────────────────────────────────────────────────

export interface ResidentBusinessMatch {
  matchId:                string;
  residentEventId:        string;
  householdId:            string;
  tenantId:               string;
  businessTenantId:       string;   // the matched business's tenant ID
  businessName:           string;
  serviceCategory:        ResidentServiceCategory;
  matchScore:             number;   // 0–100
  matchReasons:           string[];
  routingZip?:            string;
  routingCounty?:         string;
  serviceRadius?:         number;   // miles
  exclusiveTerritory:     boolean;
  workflowType:           ResidentWorkflowType;
  status:                 "pending" | "routed" | "approved" | "rejected" | "sent" | "suppressed";
  createdAt:              string;
}

// ── Workflow draft (approval-gated, NO auto-send) ─────────────────────────────

export interface ResidentWorkflowDraft {
  draftId:                string;
  residentEventId:        string;
  householdId:            string;
  tenantId:               string;
  workflowType:           ResidentWorkflowType;
  channel:                "sms" | "email" | "imessage" | "voice";
  messageOptions:         string[];   // 2-3 draft variants
  scheduledWindow:        string;     // e.g. "9AM-5PM local"
  status:                 "pending" | "approved" | "rejected" | "sent" | "suppressed";
  approvedBy?:            string;
  approvedAt?:            string;
  suppressionReason?:     string;
  createdAt:              string;
}

// ── Opportunity scoring breakdown ─────────────────────────────────────────────

export interface ResidentOpportunityScore {
  householdId:            string;
  tenantId:               string;
  overallScore:           number;      // 0–100
  homeServiceScore:       number;      // HVAC, plumbing, roofing — high for homeowners
  personalServiceScore:   number;      // salon, gym, barber
  insuranceScore:         number;      // home+auto bundle opportunity
  localBusinessScore:     number;      // restaurants, retail
  timingScore:            number;      // recency — higher in weeks 1-4
  scoreBreakdown: {
    moveConfidenceWeight: number;
    recencyWeight:        number;
    homeownerWeight:      number;
    propertyValueWeight:  number;
    opportunityCategoryWeight: number;
  };
  topCategories:          ResidentOpportunityCategory[];
  recommendedWorkflows:   ResidentWorkflowType[];
  scoredAt:               string;
}

// ── Compliance/suppression record ─────────────────────────────────────────────

export interface ResidentSuppression {
  suppressionId:          string;
  address?:               string;
  zip?:                   string;
  county?:                string;
  tenantId:               string;     // "global" for all-tenant suppression
  suppressionType:        "address" | "zip" | "county" | "opt_out" | "do_not_contact";
  source:                 string;     // who/what created suppression
  reason:                 string;
  expiresAt?:             string;     // null = permanent
  createdAt:              string;
}

// ── Agent recommendation (advisory only, never auto-executes) ─────────────────

export interface ResidentAgentRecommendation {
  recommendationId:       string;
  residentEventId:        string;
  householdId:            string;
  tenantId:               string;
  recommendationType:     "timing" | "workflow" | "business_match" | "hold";
  priority:               "high" | "medium" | "low";
  reason:                 string;
  suggestedWorkflow?:     ResidentWorkflowType;
  suggestedBusinessCategories: ResidentServiceCategory[];
  timingWindow?:          string;     // "Act within 30 days"
  confidenceNote:         string;     // human-readable rationale
  requiresApproval:       true;       // always true — agent never auto-executes
  createdAt:              string;
}
