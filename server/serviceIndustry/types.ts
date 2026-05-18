/**
 * server/serviceIndustry/types.ts
 *
 * Canonical types for the Apex Service Industry Operating System.
 * All service industry modules import from here — no circular deps.
 */

// ── Business verticals ────────────────────────────────────────────────────────

export type ServiceVertical =
  | "barber"
  | "salon"
  | "nail_salon"
  | "spa"
  | "med_spa"
  | "massage_therapy"
  | "esthetician"
  | "tattoo"
  | "beauty_suite"
  | "wellness"
  | "lash_artist"
  | "other_appointment";

export type BusinessScale =
  | "solo"          // 1 operator
  | "small"         // 2-5 chairs/rooms
  | "mid"           // 6-15
  | "multi_location" // 2+ locations same owner
  | "franchise";    // licensed franchise

// ── Appointment status ────────────────────────────────────────────────────────

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show"
  | "rescheduled"
  | "waitlisted";

// ── Customer lifecycle ────────────────────────────────────────────────────────

export type CustomerLifecycle =
  | "new"             // first visit
  | "active"          // visited in last 60 days
  | "at_risk"         // 61-120 days since last visit
  | "lapsed"          // 121-365 days
  | "lost"            // 365+ days
  | "vip"             // top-spend or frequency flag
  | "member";         // active membership/package holder

// ── Missed call status ────────────────────────────────────────────────────────

export type MissedCallStatus =
  | "detected"
  | "response_queued"
  | "response_sent"
  | "replied"         // customer responded
  | "booked"          // converted to booking
  | "escalated"       // handed to human
  | "suppressed"      // DNC / business hours block
  | "expired";        // no response after max attempts

// ── Receptionist session state ────────────────────────────────────────────────

export type ReceptionistSessionState =
  | "greeting"
  | "qualification"
  | "booking_intent"
  | "faq_handling"
  | "reschedule"
  | "cancellation"
  | "review_request"
  | "human_handoff"
  | "closed";

// ── Review platform ───────────────────────────────────────────────────────────

export type ReviewPlatform =
  | "google"
  | "yelp"
  | "facebook"
  | "healthgrades"
  | "zocdoc"
  | "booksy"
  | "vagaro"
  | "square"
  | "other";

export type ReviewSentiment = "positive" | "neutral" | "negative";

// ── Workflow types ────────────────────────────────────────────────────────────

export type ServiceWorkflowType =
  | "missed_call_recovery"
  | "post_appointment_review"
  | "reactivation_60d"
  | "reactivation_120d"
  | "birthday_message"
  | "membership_reminder"
  | "package_expiry"
  | "no_show_followup"
  | "vip_appreciation"
  | "referral_request"
  | "loyalty_milestone";

// ── Business intelligence entity ──────────────────────────────────────────────

export interface ServiceBusinessEntity {
  businessId:        string;        // SHA256(name|address)[0:24]
  businessName:      string;
  ownerName?:        string;
  phone?:            string;
  email?:            string;
  website?:          string;
  address:           string;
  city:              string;
  county:            string;
  state:             string;
  zip?:              string;

  vertical:          ServiceVertical;
  scale:             BusinessScale;
  staffCount?:       number;
  chairCount?:       number;

  // License/registration
  dbprLicenseType?:  string;
  dbprLicenseNumber?: string;
  hasContractorLicense?: boolean;

  // Intelligence scores
  intelligenceScore:    number;   // 0-100 composite
  retentionScore?:      number;   // 0-100 estimated client retention
  reputationScore?:     number;   // 0-100 from reviews
  operationalChaosScore?: number; // 0-100 — higher = more opportunity

  // Appointment signals
  estimatedMonthlyAppointments?: number;
  avgNoShowRate?:     number;
  avgCancellationRate?: number;

  // Review signals
  googleRating?:      number;
  reviewCount?:       number;
  lastReviewDate?:    string;

  // Operational signals
  hasMissedCallIssue?: boolean;
  hasBookingSystem?:   boolean;
  hasOnlineBooking?:   boolean;
  hasLoyaltyProgram?:  boolean;

  // Multi-location
  locationGroupId?:   string;
  locationCount?:     number;
  isHeadquarters?:    boolean;

  // Commercial crossover
  commercialInsuranceOpportunity?: boolean;
  wcOpportunity?:     boolean;
  bopOpportunity?:    boolean;

  activeSignals?:     string[];
  createdAt?:         string;
  updatedAt?:         string;
}

// ── Customer entity ───────────────────────────────────────────────────────────

export interface ServiceCustomer {
  customerId:        string;        // SHA256(phone|businessId)[0:24]
  businessId:        string;
  phone?:            string;
  email?:            string;
  firstName?:        string;
  lastName?:         string;
  birthMonth?:       number;
  birthDay?:         number;

  lifecycle:         CustomerLifecycle;
  visitCount:        number;
  totalSpend:        number;        // estimated lifetime value
  avgVisitValue?:    number;
  lastVisitAt?:      string;
  firstVisitAt?:     string;
  nextAppointmentAt?: string;

  preferredService?:  string;
  preferredStaff?:    string;
  preferredDayOfWeek?: number;

  isMember:          boolean;
  membershipType?:   string;
  membershipExpires?: string;

  packageBalance?:   number;        // remaining prepaid visits
  loyaltyPoints?:    number;

  noShowCount?:      number;
  cancellationCount?: number;
  reviewLeft?:       boolean;

  communicationPreference?: "sms" | "email" | "both" | "none";
  optedOut:          boolean;

  churnRiskScore?:   number;        // 0-100
  upsellScore?:      number;        // 0-100

  createdAt?:        string;
  updatedAt?:        string;
}

// ── Appointment entity ────────────────────────────────────────────────────────

export interface ServiceAppointment {
  appointmentId:     string;
  businessId:        string;
  customerId?:       string;
  phone?:            string;
  staffId?:          string;
  staffName?:        string;

  service:           string;
  durationMinutes?:  number;
  value?:            number;

  status:            AppointmentStatus;
  scheduledAt:       string;
  completedAt?:      string;
  cancelledAt?:      string;

  noShowAt?:         string;
  rescheduleCount?:  number;
  bookingSource?:    string;        // walk-in | phone | online | ai-receptionist

  reviewRequested?:  boolean;
  reviewReceivedAt?: string;

  notes?:            string;
  createdAt?:        string;
}

// ── Missed call record ────────────────────────────────────────────────────────

export interface MissedCallRecord {
  missedCallId:      string;
  businessId:        string;
  subAccountId?:     number;
  callerPhone:       string;
  calledAt:          string;
  status:            MissedCallStatus;

  responseAttempts:  number;
  lastResponseAt?:   string;
  firstResponseAt?:  string;
  customerRepliedAt?: string;
  bookedAt?:         string;
  escalatedAt?:      string;

  recoveryScore?:    number;        // likelihood of conversion
  isRepeatCaller?:   boolean;
  isExistingCustomer?: boolean;

  suppressionReason?: string;
  createdAt?:        string;
}

// ── Receptionist session ──────────────────────────────────────────────────────

export interface ReceptionistSession {
  sessionId:         string;
  businessId:        string;
  subAccountId?:     number;
  callerPhone:       string;
  channel:           "sms" | "voice" | "chat";
  state:             ReceptionistSessionState;

  intentDetected?:   string;        // booking | faq | complaint | reschedule
  appointmentBooked?: boolean;
  humanHandoffAt?:   string;
  handoffReason?:    string;

  messageCount:      number;
  startedAt:         string;
  lastMessageAt?:    string;
  closedAt?:         string;

  afterHours:        boolean;
  businessHoursEnforced: boolean;
  escalationTriggered: boolean;

  auditLog:          Array<{ role: "ai" | "user" | "system"; content: string; at: string }>;
}

// ── Review record ─────────────────────────────────────────────────────────────

export interface ReviewRecord {
  reviewId:          string;
  businessId:        string;
  platform:          ReviewPlatform;
  rating:            number;        // 1-5
  sentiment:         ReviewSentiment;
  reviewText?:       string;
  reviewerName?:     string;
  publishedAt?:      string;

  responseGenerated?: boolean;
  responseDraft?:    string;
  respondedAt?:      string;

  flaggedNegative:   boolean;
  alertSentAt?:      string;
  createdAt?:        string;
}

// ── Business hours ────────────────────────────────────────────────────────────

export interface BusinessHours {
  mon?: { open: string; close: string } | null;
  tue?: { open: string; close: string } | null;
  wed?: { open: string; close: string } | null;
  thu?: { open: string; close: string } | null;
  fri?: { open: string; close: string } | null;
  sat?: { open: string; close: string } | null;
  sun?: { open: string; close: string } | null;
}
