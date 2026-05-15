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
  | "failed";

export interface ContactUpsertInput {
  subAccountId: number;

  // Identity — use real values when known, null/undefined when not
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
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
  /^crash lead$/i,
  /^unidentified/i,
  /^unknown$/i,
  /^vehicle crash$/i,
  /^incident lead$/i,
  /^legal lead$/i,
  /^booking lead$/i,
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
    skipTraceStatus: input.skipTraceStatus ?? "not_attempted",
    enrichmentProvider: input.enrichmentProvider ?? null,
    enrichmentAttemptedAt: input.enrichmentAttemptedAt ?? null,
    enrichmentCompletedAt: input.enrichmentCompletedAt ?? null,
    enrichmentConfidence: input.enrichmentConfidence ?? null,
    normalizedPhone: normPhone,
    normalizedEmail: normEmail,
    contactQualityScore: input.contactQualityScore ?? null,
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

  // Phone: only overwrite if existing is blank
  if (input.phone && !existing.phone) {
    patch.phone = input.phone;
    if (normPhone) patch.normalizedPhone = normPhone;
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
      not_attempted: 0, pending: 1, attempted: 2, failed: 2, no_match: 3, matched: 4,
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

  // Address: fill if existing is blank
  if (input.address && !existing.address) patch.address = input.address;
  if (input.formattedAddress && !existing.formattedAddress) patch.formattedAddress = input.formattedAddress;
  if (input.city && !existing.city) patch.city = input.city;
  if (input.state && !existing.state) patch.state = input.state;
  if (input.zip && !existing.zip) patch.zip = input.zip;
  if (input.lat && !existing.lat) patch.lat = input.lat;
  if (input.lng && !existing.lng) patch.lng = input.lng;
  if (input.geocodeStatus && !existing.geocodeStatus) patch.geocodeStatus = input.geocodeStatus;

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

  // Quality score: take the higher of the two
  if (input.contactQualityScore !== undefined && input.contactQualityScore !== null) {
    const higher = Math.max(input.contactQualityScore, existing.contactQualityScore ?? 0);
    if (higher !== existing.contactQualityScore) {
      patch.contactQualityScore = higher;
    }
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
