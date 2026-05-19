// @ts-nocheck
/**
 * contactUpsertService.ts
 *
 * SINGLE entry point for all contact creation/updating across every pipeline.
 *
 * Dedup strategy (in order of precedence):
 *   1. source_external_id match (strongest — same incident/record in source system)
 *   2. normalized_phone match within same sub-account
 *   3. normalized_email match within same sub-account
 *   4. If none match → insert new contact
 *
 * Guarantees:
 *   - NEVER overwrites a real name with a placeholder ("Crash Lead", "Unidentified…")
 *   - NEVER overwrites a real phone/email with a blank/null
 *   - NEVER marks skip_trace_status as 'matched' unless a real enrichment API was called
 *   - Always normalizes phone to digits-only for dedup
 *   - Always sets identity_status based on whether we actually have a real person identity
 *   - Always scoped to sub_account_id — no cross-account matches
 */

import { db } from "../db";
import { contacts } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

// ---- Canonical source slugs — use these everywhere ----
export const CONTACT_SOURCES = {
  CRASH:         "sentinel_crash",
  LEGAL:         "legal_pipeline",
  JAIL_BOOKING:  "jail_booking",
  HOME_SERVICES: "home_services",
  APIFY:         "apify_scrape",
  META_LEAD:     "meta_lead",
  MANUAL:        "manual",
  FORM:          "form_submission",
  IMPORT:        "import",
} as const;

export type ContactSource = typeof CONTACT_SOURCES[keyof typeof CONTACT_SOURCES];

// ---- Identity status values ----
export type IdentityStatus = "unidentified" | "placeholder" | "verified";

// ---- Skip-trace status values ----
export type SkipTraceStatus =
  | "not_attempted"
  | "pending"
  | "attempted"
  | "matched"
  | "no_match"
  | "failed"
  /** Source already provided a valid phone — skip trace is unnecessary and must NOT run. */
  | "source_matched";

export interface ContactUpsertInput {
  subAccountId: number;

  // Identity — use real values when known, null/undefined when not
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  /**
   * Where this phone came from. Use PHONE_CONFIDENCE source string values:
   * "flhsmv" | "dhsmv" | "sheriff_booking" | "court_filing" | "jail_booking"
   * "batchdata" | "google_places" | "manual" | "unknown"
   *
   * When set, the phone is treated as first-party source intelligence and
   * skipTraceStatus auto-promotes to "source_matched" — BatchData will not run.
   */
  phoneSource?: string | null;
  /** Confidence in this phone (0.0–1.0). Use PHONE_CONFIDENCE constants. */
  phoneConfidence?: number | null;
  /** When this phone was acquired. Defaults to now on write. */
  phoneAcquiredAt?: Date | null;
  company?: string | null;

  // Classification
  source: ContactSource;
  channel?: string | null;
  leadVertical?: string | null;   // e.g. "personal_injury", "criminal_defense", "family_law"
  leadSubtype?: string | null;    // e.g. "crash", "dui", "divorce"
  county?: string | null;

  // Dedup key from the originating system (incident ID, case number, event ID, etc.)
  sourceExternalId?: string | null;
  rawSourceType?: string | null;

  // Tags to merge (additive — never removes existing tags)
  tags?: string[];

  // Address / geo
  address?: string | null;
  formattedAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
  geocodeStatus?: string | null;

  // Notes / metadata
  notes?: string | null;

  // Override identity/skip status if caller has authoritative info
  identityStatus?: IdentityStatus;
  skipTraceStatus?: SkipTraceStatus;
  enrichmentProvider?: string | null;
  enrichmentAttemptedAt?: Date | null;
  enrichmentCompletedAt?: Date | null;
  enrichmentConfidence?: number | null;

  // Quality score (0–1)
  contactQualityScore?: number | null;

  // ── Contact lifecycle + dedup keys ──────────────────────────────────────────
  // NOTE: prior to 2026-05-18 these four fields were accepted by callers but
  // silently dropped here (not in baseValues) — `// @ts-nocheck` masked it.
  // That is why incident_fingerprint was NULL on every row in production.
  /** SHA256 cross-incident dedup fingerprint — links a contact to its source incident. */
  incidentFingerprint?: string | null;
  /** True until a verified identity is recovered. Drives default-view visibility. */
  isPlaceholder?: boolean | null;
  /** CRM view bucket: incident_subject | opportunity_lead | enriched_contact | placeholder | archived */
  viewClass?: string | null;
  /** Operational workflow stage: new | enriching | scored | routed | contacted | converted | closed */
  workflowStage?: string | null;

  // Routing fields (2026-05-15)
  sourcePipeline?: string | null;
  leadType?: string | null;
  routeRuleId?: number | null;
  routeReason?: string | null;
  // exportEligible is auto-derived when not explicitly set
  exportEligible?: boolean | null;

  // ── Victim-Centric Address Architecture (2026-05-16) ────────────────────────
  /** Raw crash scene / highway marker — NEVER a residential address. */
  incidentLocation?: string | null;
  incidentLat?:      number | null;
  incidentLng?:      number | null;
  /** Vehicle registration owner address (DHSMV or FLHSMV report). */
  registrationAddress?:        string | null;
  registrationAddressSource?:  string | null;   // 'dhsmv' | 'flhsmv_report'
  registrationAddressSourcAt?: Date | null;
  /** BatchData mailing address from skip-trace. */
  mailingAddress?: string | null;
  /** Best inferred residential address before geocode confirmation. */
  probableResidence?: string | null;
  /** Geocode-confirmed residential address. */
  verifiedResidence?: string | null;
  /**
   * 0.0–1.0 confidence score for current contact.address value.
   * Use ADDRESS_CONFIDENCE constants (see contactUpsertService).
   */
  addressConfidence?: number | null;
  /** What type of address contact.address currently holds. */
  addressType?:   string | null;
  /** System/provider that last set contact.address. */
  addressSource?: string | null;
}

export interface ContactUpsertResult {
  contactId: number;
  action: "created" | "updated" | "noop";
  identityStatus: IdentityStatus;
  skipTraceStatus: SkipTraceStatus;
}

// ---- Normalization helpers ----

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length < 7) return null;
  return digits;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed.includes("@") || trimmed.length < 5) return null;
  return trimmed;
}

const PLACEHOLDER_PATTERNS = [
  // Internal platform placeholder names
  /^crash lead$/i,
  /^unidentified/i,
  /^incident lead$/i,
  /^legal lead$/i,
  /^booking lead$/i,
  /^vehicle crash$/i,

  // Generic "unknown" variants
  /^unknown$/i,
  /^unknown\s+(driver|operator|person|victim|subject|male|female|individual)/i,
  /^no\s+(name|id|info|record)/i,
  /^n\/?a$/i,
  /^none$/i,
  /^null$/i,

  // FLHSMV / government report non-person strings
  /^driver\s+\d+$/i,           // "DRIVER 1", "DRIVER 2"
  /^occupant\s+\d+$/i,         // "OCCUPANT 1"
  /^witness\s+\d*$/i,          // "WITNESS", "WITNESS 1"
  /^pedestrian$/i,
  /^pedestrian\s+\d*$/i,       // "PEDESTRIAN 1"
  /^bicyclist$/i,
  /^motorcyclist$/i,
  /^passenger\s+\d*$/i,
  /^driver\s+deceased$/i,
  /^deceased\s+driver$/i,
  /^unlicensed\s+driver$/i,
  /^no\s+valid\s+dl$/i,
  /^no\s+valid\s+license$/i,
  /^commercial\s+vehicle/i,
  /^company\s+vehicle/i,
  /^government\s+vehicle/i,

  // Crash/incident type strings that can leak from CAD feeds
  /^(injury|fatal|property damage|hit and run|rear.?end|rollover|head.?on|side.?swipe)\s+(crash|accident|collision)$/i,
  /^crash\s+(type|incident|report|lead)$/i,
  /^(injury|fatal|minor)\s+crash$/i,
  /^traffic\s+(crash|incident|stop)$/i,
  /^test\b/i,                  // "Test", "Test User", "Test Vehicle"
  /^john\s+doe$/i,
  /^jane\s+doe$/i,
];

export function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name || !name.trim()) return true;
  return PLACEHOLDER_PATTERNS.some(p => p.test(name.trim()));
}

export function isRealContact(
  firstName: string | null | undefined,
  phone: string | null | undefined,
  email: string | null | undefined,
): boolean {
  const hasRealName = !!firstName && !isPlaceholderName(firstName);
  const hasRealPhone = !!normalizePhone(phone);
  const hasRealEmail = !!normalizeEmail(email);
  return hasRealName || hasRealPhone || hasRealEmail;
}

export function deriveIdentityStatus(
  firstName: string | null | undefined,
  phone: string | null | undefined,
  email: string | null | undefined,
  overrideStatus?: IdentityStatus,
): IdentityStatus {
  if (overrideStatus) return overrideStatus;
  if (!firstName && !phone && !email) return "unidentified";
  if (isPlaceholderName(firstName) && !normalizePhone(phone) && !normalizeEmail(email)) {
    return "placeholder";
  }
  return "verified";
}

const ENTITY_LEAD_TYPES = new Set(["recall_entity", "osha_entity", "local_business", "attorney", "placeholder"]);

/**
 * Address confidence constants — use these when setting addressConfidence.
 * Higher = more trustworthy as a residential/mailing address.
 */
export const ADDRESS_CONFIDENCE = {
  /** FLHSMV + DHSMV confirmed residential with geocode verification */
  VERIFIED_RESIDENCE:   0.95,
  /** DHSMV registration address (registered owner, not necessarily driver) */
  DHSMV_REGISTRATION:   0.90,
  /** FLHSMV crash report driver's license address */
  FLHSMV_LICENSE:       0.85,
  /** BatchData skip-trace inferred (name + address match) */
  BATCHDATA_INFERRED:   0.72,
  /** Probable household aggregated from multiple sources */
  PROBABLE_HOUSEHOLD:   0.61,
  /** Roadway / highway / intersection — NOT residential */
  INCIDENT_LOCATION:    0.15,
  /** No address or completely unknown */
  UNKNOWN:              0.0,
} as const;

/**
 * Phone confidence scale — mirrors address confidence but for phone numbers.
 *
 * Priority for merge: higher confidence always wins.
 * BatchData (0.72) must NEVER overwrite a government-source phone (0.85+).
 *
 * Example phoneSource values:
 *   "flhsmv" | "dhsmv" | "sheriff_booking" | "court_filing" | "jail_booking"
 *   "batchdata" | "google_places" | "manual" | "unknown"
 */
export const PHONE_CONFIDENCE = {
  /** FL government agency verified (FLHSMV, DHSMV direct) */
  VERIFIED_GOVERNMENT: 0.95,
  /** Sheriff booking record — directly from booking form */
  SHERIFF_BOOKING:     0.90,
  /** Court filing — party contact info on official record */
  COURT_FILING:        0.85,
  /** DHSMV registration — vehicle owner phone on file */
  REGISTRATION:        0.85,
  /** BatchData skip-trace result */
  BATCHDATA:           0.72,
  /** Google Places — business phone from Maps */
  GOOGLE_PLACES:       0.70,
  /** Inferred / probabilistic match */
  INFERRED:            0.50,
  /** Source unknown or not specified */
  UNKNOWN:             0.30,
} as const;

/**
 * Returns true if the given address string looks like a highway reference,
 * not a residential or mailing address. These should never be skip-traced
 * or used as residential intelligence.
 */
export function looksLikeHighwayAddress(address: string | null | undefined): boolean {
  if (!address || address.trim().length < 3) return false;
  // Use \d+ (one or more digits) so multi-digit highways like I-75, SR-82, US-41
  // are correctly detected. The previous \d (single digit) only matched I-1…I-9.
  return /\b(I-\d+|US-\d+|SR-\d+|CR-\d+|FL-\d+|MM\s*\d+|INTERSTATE|HIGHWAY\s+\d+|HWY\s+\d+|MILE\s+MARKER)\b/i.test(address);
}

/**
 * Returns the export-eligible status for a contact.
 * A contact must NOT be a roadway placeholder to be export-eligible,
 * even if it has a name and phone.
 */
export function deriveExportEligible(
  firstName: string | null | undefined,
  phone: string | null | undefined,
  email: string | null | undefined,
  leadType: string | null | undefined,
  override?: boolean | null,
  addressConfidence?: number | null,
): boolean {
  if (override != null) return override;
  if (ENTITY_LEAD_TYPES.has(leadType ?? "")) return false;
  if (!firstName || !firstName.trim() || isPlaceholderName(firstName)) return false;
  // Contacts whose only address is a roadway/highway reference are NOT export-eligible
  // even if they have a name and phone — the address confidence gate ensures
  // that only contacts with residential intelligence reach exports.
  if ((addressConfidence ?? 0) <= ADDRESS_CONFIDENCE.INCIDENT_LOCATION) {
    // Only block if they also have no phone/email (highway placeholder without contact info)
    // If they have a phone from skip-trace, allow export despite low address confidence
    if (!normalizePhone(phone) && !normalizeEmail(email)) return false;
  }
  return !!(normalizePhone(phone) || normalizeEmail(email));
}

/** Builds a crash-incident placeholder display name. */
export function buildCrashPlaceholderName(county: string | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const countyLabel = county
    ? county.replace(/\s+county$/i, "").toUpperCase().trim()
    : "UNKNOWN COUNTY";
  return {
    firstName: "Unidentified Crash Incident",
    lastName: `— ${countyLabel}`,
  };
}

// ---- Core upsert function ----

export async function upsertContact(input: ContactUpsertInput): Promise<ContactUpsertResult> {
  // ── Defensive highway address guard ──────────────────────────────────────
  // If any caller accidentally passes a roadway/intersection string as
  // input.address, intercept it here — before it touches baseValues or
  // mergeContact — and route it to incidentLocation instead.
  // This is the last line of defence; callers should already filter via
  // looksLikeHighwayAddress(), but we enforce it unconditionally here.
  if (looksLikeHighwayAddress(input.address)) {
    console.warn(
      `[UPSERT-GUARD] Highway string detected in input.address — redirecting to incidentLocation. ` +
      `source=${input.source} address="${input.address}"`
    );
    if (!input.incidentLocation) input = { ...input, incidentLocation: input.address };
    input = { ...input, address: null, addressConfidence: ADDRESS_CONFIDENCE.INCIDENT_LOCATION, addressType: "incident_location" };
  }

  const {
    subAccountId,
    source,
    sourceExternalId,
    tags = [],
  } = input;

  const normPhone = normalizePhone(input.phone);
  const normEmail = normalizeEmail(input.email);

  const identityStatus = deriveIdentityStatus(
    input.firstName,
    input.phone,
    input.email,
    input.identityStatus,
  );

  const exportEligible = deriveExportEligible(
    input.firstName,
    input.phone,
    input.email,
    input.leadType,
    input.exportEligible,
    input.addressConfidence,
  );

  // Build the full set of values we'd write on insert
  const baseValues = {
    subAccountId,
    firstName: input.firstName ?? "Unidentified",
    lastName: input.lastName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    company: input.company ?? null,
    source,
    channel: input.channel ?? null,
    tags,
    notes: input.notes ?? null,
    address: input.address ?? null,
    formattedAddress: input.formattedAddress ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    zip: input.zip ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    geocodeStatus: input.geocodeStatus ?? null,
    leadVertical: input.leadVertical ?? null,
    leadSubtype: input.leadSubtype ?? null,
    county: input.county ?? null,
    sourceExternalId: sourceExternalId ?? null,
    rawSourceType: input.rawSourceType ?? null,
    identityStatus,
    // Auto-promote to source_matched when a first-party source provides a phone.
    // This prevents retroSkipTrace and enrichmentWorker from spending BatchData
    // credits re-acquiring intelligence already in hand.
    skipTraceStatus: input.skipTraceStatus ?? (input.phone ? "source_matched" : "not_attempted"),
    enrichmentProvider: input.enrichmentProvider ?? null,
    enrichmentAttemptedAt: input.enrichmentAttemptedAt ?? null,
    enrichmentCompletedAt: input.enrichmentCompletedAt ?? null,
    enrichmentConfidence: input.enrichmentConfidence ?? null,
    normalizedPhone: normPhone,
    normalizedEmail: normEmail,
    // ── Phone lineage ───────────────────────────────────────────────────────
    phoneSource:     input.phoneSource ?? null,
    phoneConfidence: input.phoneConfidence ?? (input.phone ? PHONE_CONFIDENCE.UNKNOWN : null),
    phoneAcquiredAt: input.phone ? (input.phoneAcquiredAt ?? new Date()) : null,
    contactQualityScore: input.contactQualityScore ?? null,
    // ── Lifecycle + dedup keys (previously dropped — see ContactUpsertInput) ──
    incidentFingerprint: input.incidentFingerprint ?? null,
    isPlaceholder: input.isPlaceholder ?? (identityStatus !== "verified"),
    viewClass: input.viewClass ?? (identityStatus === "verified" ? "enriched_contact" : "placeholder"),
    workflowStage: input.workflowStage ?? "new",
    sourcePipeline: input.sourcePipeline ?? null,
    leadType: input.leadType ?? null,
    routeRuleId: input.routeRuleId ?? null,
    routeReason: input.routeReason ?? null,
    exportEligible,
    // ── Victim-centric address fields ──────────────────────────────────────
    incidentLocation: input.incidentLocation ?? null,
    incidentLat:      input.incidentLat ?? null,
    incidentLng:      input.incidentLng ?? null,
    registrationAddress:         input.registrationAddress ?? null,
    registrationAddressSource:   input.registrationAddressSource ?? null,
    registrationAddressSourcAt:  input.registrationAddressSourcAt ?? null,
    mailingAddress:    input.mailingAddress ?? null,
    probableResidence: input.probableResidence ?? null,
    verifiedResidence: input.verifiedResidence ?? null,
    addressConfidence: input.addressConfidence ?? 0.0,
    addressType:       input.addressType ?? "unknown",
    addressSource:     input.addressSource ?? null,
  } as const;

  // --- Step 1: Try dedup by source_external_id ---
  if (sourceExternalId) {
    const existing = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.subAccountId, subAccountId),
          eq(contacts.sourceExternalId, sourceExternalId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      const updated = await mergeContact(existing[0], input, baseValues, normPhone, normEmail, identityStatus);
      return {
        contactId: existing[0].id,
        action: updated ? "updated" : "noop",
        identityStatus: updated?.identityStatus ?? existing[0].identityStatus as IdentityStatus,
        skipTraceStatus: updated?.skipTraceStatus ?? existing[0].skipTraceStatus as SkipTraceStatus,
      };
    }
  }

  // --- Step 2: Try dedup by normalized phone ---
  if (normPhone) {
    const existing = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.subAccountId, subAccountId),
          eq(contacts.normalizedPhone, normPhone),
        ),
      )
      .limit(1);

    if (existing[0]) {
      const updated = await mergeContact(existing[0], input, baseValues, normPhone, normEmail, identityStatus);
      return {
        contactId: existing[0].id,
        action: updated ? "updated" : "noop",
        identityStatus: updated?.identityStatus ?? existing[0].identityStatus as IdentityStatus,
        skipTraceStatus: updated?.skipTraceStatus ?? existing[0].skipTraceStatus as SkipTraceStatus,
      };
    }
  }

  // --- Step 3: Try dedup by normalized email ---
  if (normEmail) {
    const existing = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.subAccountId, subAccountId),
          eq(contacts.normalizedEmail, normEmail),
        ),
      )
      .limit(1);

    if (existing[0]) {
      const updated = await mergeContact(existing[0], input, baseValues, normPhone, normEmail, identityStatus);
      return {
        contactId: existing[0].id,
        action: updated ? "updated" : "noop",
        identityStatus: updated?.identityStatus ?? existing[0].identityStatus as IdentityStatus,
        skipTraceStatus: updated?.skipTraceStatus ?? existing[0].skipTraceStatus as SkipTraceStatus,
      };
    }
  }

  // --- Step 4: Insert new contact ---
  const [inserted] = await db.insert(contacts).values(baseValues).returning({ id: contacts.id });
  return {
    contactId: inserted.id,
    action: "created",
    identityStatus,
    skipTraceStatus: baseValues.skipTraceStatus as SkipTraceStatus,
  };
}

/**
 * Merge incoming data onto an existing contact row.
 * Returns the patch applied (or null if nothing changed).
 */
async function mergeContact(
  existing: typeof contacts.$inferSelect,
  input: ContactUpsertInput,
  _baseValues: Record<string, unknown>,
  normPhone: string | null,
  normEmail: string | null,
  incomingIdentityStatus: IdentityStatus,
): Promise<{ identityStatus: IdentityStatus; skipTraceStatus: SkipTraceStatus } | null> {
  const patch: Partial<typeof contacts.$inferInsert> = {};

  // Name: only overwrite if incoming is a real name and existing is a placeholder
  if (
    input.firstName &&
    !isPlaceholderName(input.firstName) &&
    isPlaceholderName(existing.firstName)
  ) {
    patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
  }

  // Phone: upgrade by confidence — higher-confidence source always wins.
  // Government / sheriff source (0.85–0.95) beats BatchData (0.72).
  // Never overwrite a higher-confidence phone with a lower-confidence one.
  // If existing phone has no confidence recorded, treat as UNKNOWN (0.30).
  const incomingPhoneConf = input.phoneConfidence ?? (input.phone ? PHONE_CONFIDENCE.UNKNOWN : 0);
  const existingPhoneConf = (existing as any).phoneConfidence ?? (existing.phone ? PHONE_CONFIDENCE.UNKNOWN : 0);
  if (input.phone && (incomingPhoneConf > existingPhoneConf || !existing.phone)) {
    patch.phone = input.phone;
    if (normPhone) patch.normalizedPhone = normPhone;
    if (input.phoneSource) (patch as any).phoneSource = input.phoneSource;
    if (input.phoneConfidence !== undefined) (patch as any).phoneConfidence = input.phoneConfidence;
    (patch as any).phoneAcquiredAt = input.phoneAcquiredAt ?? new Date();
  }

  // Email: only overwrite if existing is blank
  if (input.email && !existing.email) {
    patch.email = input.email;
    if (normEmail) patch.normalizedEmail = normEmail;
  }

  // Source external ID: fill if missing
  if (input.sourceExternalId && !existing.sourceExternalId) {
    patch.sourceExternalId = input.sourceExternalId;
  }

  // Incident fingerprint: fill if missing (first write wins — stable dedup key)
  if (input.incidentFingerprint && !(existing as any).incidentFingerprint) {
    (patch as any).incidentFingerprint = input.incidentFingerprint;
  }

  // Lead classification: fill if missing
  if (input.leadVertical && !existing.leadVertical) patch.leadVertical = input.leadVertical;
  if (input.leadSubtype && !existing.leadSubtype) patch.leadSubtype = input.leadSubtype;
  if (input.county && !existing.county) patch.county = input.county;

  // Tags: merge (additive only)
  const incomingTags = input.tags ?? [];
  if (incomingTags.length > 0) {
    const existingTagSet = new Set(existing.tags ?? []);
    const newTags = incomingTags.filter(t => !existingTagSet.has(t));
    if (newTags.length > 0) {
      patch.tags = [...(existing.tags ?? []), ...newTags];
    }
  }

  // Enrichment fields: only upgrade (never downgrade)
  if (input.skipTraceStatus) {
    const statusRank: Record<string, number> = {
      // source_matched (5) is the highest rank — once a source provides a phone,
      // BatchData results must never overwrite that status back to "no_match".
      not_attempted: 0, pending: 1, attempted: 2, failed: 2, no_match: 3, matched: 4, source_matched: 5,
    };
    const incomingRank = statusRank[input.skipTraceStatus] ?? 0;
    const existingRank = statusRank[existing.skipTraceStatus ?? "not_attempted"] ?? 0;
    if (incomingRank > existingRank) {
      patch.skipTraceStatus = input.skipTraceStatus;
    }
  }
  if (input.enrichmentProvider && !existing.enrichmentProvider) {
    patch.enrichmentProvider = input.enrichmentProvider;
  }
  if (input.enrichmentAttemptedAt && !existing.enrichmentAttemptedAt) {
    patch.enrichmentAttemptedAt = input.enrichmentAttemptedAt;
  }
  if (input.enrichmentCompletedAt && !existing.enrichmentCompletedAt) {
    patch.enrichmentCompletedAt = input.enrichmentCompletedAt;
  }
  if (input.enrichmentConfidence !== undefined && input.enrichmentConfidence !== null) {
    if (!existing.enrichmentConfidence || input.enrichmentConfidence > existing.enrichmentConfidence) {
      patch.enrichmentConfidence = input.enrichmentConfidence;
    }
  }

  // Address: only upgrade — higher confidence wins.
  // Residential addresses always beat incident locations (never downgrade).
  const incomingConfidence = input.addressConfidence ?? 0;
  const existingConfidence = (existing as any).addressConfidence ?? 0;

  if (input.address) {
    if (incomingConfidence > existingConfidence || !existing.address) {
      patch.address = input.address;
    }
  }
  if (input.formattedAddress && !existing.formattedAddress) patch.formattedAddress = input.formattedAddress;
  if (input.city && !existing.city) patch.city = input.city;
  if (input.state && !existing.state) patch.state = input.state;
  if (input.zip && !existing.zip) patch.zip = input.zip;
  // Lat/lng: only set when coming from a residential geocode (not incident scene)
  if (input.lat && (!existing.lat || incomingConfidence > existingConfidence)) patch.lat = input.lat;
  if (input.lng && (!existing.lng || incomingConfidence > existingConfidence)) patch.lng = input.lng;
  if (input.geocodeStatus && !existing.geocodeStatus) patch.geocodeStatus = input.geocodeStatus;

  // ── Victim-centric address fields: always write, never erase ─────────────
  // incidentLocation: capture crash scene — only set if blank (first write wins)
  if (input.incidentLocation && !(existing as any).incidentLocation) {
    (patch as any).incidentLocation = input.incidentLocation;
    if (input.incidentLat && !(existing as any).incidentLat) (patch as any).incidentLat = input.incidentLat;
    if (input.incidentLng && !(existing as any).incidentLng) (patch as any).incidentLng = input.incidentLng;
  }
  // registrationAddress: higher confidence wins (DHSMV beats FLHSMV report)
  if (input.registrationAddress) {
    const existingRegConf = (existing as any).registrationAddressSource === "dhsmv" ? 0.90 : 0.85;
    const incomingRegConf = input.registrationAddressSource === "dhsmv" ? 0.90 : 0.85;
    if (!(existing as any).registrationAddress || incomingRegConf >= existingRegConf) {
      (patch as any).registrationAddress       = input.registrationAddress;
      (patch as any).registrationAddressSource = input.registrationAddressSource ?? null;
      (patch as any).registrationAddressSourcAt = input.registrationAddressSourcAt ?? new Date();
    }
  }
  // mailingAddress: fill if blank
  if (input.mailingAddress && !(existing as any).mailingAddress) {
    (patch as any).mailingAddress = input.mailingAddress;
  }
  // probableResidence: fill if blank or upgrade
  if (input.probableResidence && !(existing as any).probableResidence) {
    (patch as any).probableResidence = input.probableResidence;
  }
  // verifiedResidence: always write (geocode confirmation is authoritative)
  if (input.verifiedResidence) {
    (patch as any).verifiedResidence = input.verifiedResidence;
  }
  // addressConfidence: only upgrade
  if (incomingConfidence > existingConfidence) {
    (patch as any).addressConfidence = incomingConfidence;
    if (input.addressType)   (patch as any).addressType   = input.addressType;
    if (input.addressSource) (patch as any).addressSource = input.addressSource;
  }

  // Notes: append if incoming is not already in notes
  if (input.notes && input.notes.trim()) {
    if (!existing.notes || !existing.notes.includes(input.notes.trim())) {
      patch.notes = existing.notes
        ? `${existing.notes}\n---\n${input.notes.trim()}`
        : input.notes.trim();
    }
  }

  // Re-derive identity status from final merged state
  const finalFirstName = patch.firstName ?? existing.firstName;
  const finalPhone = patch.phone ?? existing.phone;
  const finalEmail = patch.email ?? existing.email;
  const finalIdentityStatus: IdentityStatus =
    input.identityStatus ??
    deriveIdentityStatus(finalFirstName, finalPhone, finalEmail);

  if (finalIdentityStatus !== existing.identityStatus) {
    patch.identityStatus = finalIdentityStatus;
  }

  // Lifecycle flags follow identity: once verified, the contact is no longer a
  // placeholder and graduates out of the placeholder view bucket. Never demote
  // a verified contact back to placeholder.
  if (finalIdentityStatus === "verified") {
    if ((existing as any).isPlaceholder === true) (patch as any).isPlaceholder = false;
    if ((existing as any).viewClass === "placeholder") (patch as any).viewClass = "enriched_contact";
  }
  if (input.workflowStage && (existing as any).workflowStage === "new" && input.workflowStage !== "new") {
    (patch as any).workflowStage = input.workflowStage;
  }

  // Quality score: take the higher of the two
  if (input.contactQualityScore !== undefined && input.contactQualityScore !== null) {
    const higher = Math.max(input.contactQualityScore, existing.contactQualityScore ?? 0);
    if (higher !== existing.contactQualityScore) {
      patch.contactQualityScore = higher;
    }
  }

  // Routing fields: fill if missing
  if (input.sourcePipeline && !existing.sourcePipeline) patch.sourcePipeline = input.sourcePipeline;
  if (input.leadType && !existing.leadType) patch.leadType = input.leadType;
  if (input.routeRuleId && !existing.routeRuleId) patch.routeRuleId = input.routeRuleId;
  if (input.routeReason && !existing.routeReason) patch.routeReason = input.routeReason;

  // Re-derive exportEligible from final merged state
  if (input.exportEligible != null) {
    if (input.exportEligible !== existing.exportEligible) patch.exportEligible = input.exportEligible;
  } else {
    const finalPhone = patch.phone ?? existing.phone;
    const finalEmail = patch.email ?? existing.email;
    const finalFirstName = patch.firstName ?? existing.firstName;
    const finalLeadType = patch.leadType ?? existing.leadType;
    const finalAddrConf = (patch as any).addressConfidence ?? (existing as any).addressConfidence ?? 0;
    const derived = deriveExportEligible(finalFirstName, finalPhone, finalEmail, finalLeadType, undefined, finalAddrConf);
    if (derived !== existing.exportEligible) patch.exportEligible = derived;
  }

  if (Object.keys(patch).length === 0) return null;

  await db.update(contacts).set(patch).where(eq(contacts.id, existing.id));

  return {
    identityStatus: (patch.identityStatus ?? existing.identityStatus) as IdentityStatus,
    skipTraceStatus: (patch.skipTraceStatus ?? existing.skipTraceStatus) as SkipTraceStatus,
  };
}

// ---- Convenience: update skip-trace result on an existing contact ----

export async function updateContactSkipTrace(
  contactId: number,
  result: {
    status: SkipTraceStatus;
    phone?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    provider: string;
    confidence?: number;
  },
): Promise<void> {
  const normPhone = normalizePhone(result.phone);
  const now = new Date();

  const patch: Partial<typeof contacts.$inferInsert> = {
    skipTraceStatus: result.status,
    enrichmentProvider: result.provider,
    enrichmentAttemptedAt: now,
    enrichmentCompletedAt: now,
  };

  if (result.confidence !== undefined) {
    patch.enrichmentConfidence = result.confidence;
  }

  if (result.status === "matched") {
    if (result.phone) patch.phone = result.phone;
    if (normPhone) patch.normalizedPhone = normPhone;
    if (result.firstName && !isPlaceholderName(result.firstName)) {
      patch.firstName = result.firstName;
    }
    if (result.lastName) patch.lastName = result.lastName;
    patch.identityStatus = "verified";
  }

  // Update tags: add 'skip-traced' + 'has-phone'/'no-phone'
  const existingRows = await db
    .select({ tags: contacts.tags, phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (existingRows[0]) {
    const existingTags = existingRows[0].tags ?? [];
    const tagSet = new Set(existingTags);
    tagSet.add("skip-traced");
    if (result.status === "matched" && (result.phone || existingRows[0].phone)) {
      tagSet.add("has-phone");
      tagSet.delete("no-phone");
    } else if (result.status === "no_match") {
      tagSet.add("no-phone");
    }
    patch.tags = [...tagSet];
  }

  await db.update(contacts).set(patch).where(eq(contacts.id, contactId));
}
