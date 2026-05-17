# Apex Sentinel — Contact Merge Hierarchy

**Status:** Production (deployed 2026-05-16)
**Module:** `server/services/contactUpsertService.ts` — `upsertContact()`, `mergeContact()`
**Depends on:** Victim-Centric Architecture, Phone Preservation, Address Confidence

---

## Table of Contents

1. [Why Merge Exists](#why-merge-exists)
2. [The Merge Contract — Never Downgrade](#the-merge-contract--never-downgrade)
3. [Three-Tier Deduplication](#three-tier-deduplication)
4. [Phone Merge Hierarchy](#phone-merge-hierarchy)
5. [Address Merge Hierarchy](#address-merge-hierarchy)
6. [Name Merge](#name-merge)
7. [Tag Merge](#tag-merge)
8. [Status Merge](#status-merge)
9. [Enrichment Confidence Merge](#enrichment-confidence-merge)
10. [Field-by-Field Merge Table](#field-by-field-merge-table)
11. [Merge in Practice — Example Walkthroughs](#merge-in-practice--example-walkthroughs)
12. [Operational Invariants](#operational-invariants)

---

## Why Merge Exists

Sentinel observes multiple independent signal sources — crash events, jail bookings, court
filings, FLHSMV crash reports, DHSMV registration records, BatchData skip-trace results —
and each source may refer to the same person using different identifiers, different name
spellings, or different contact details.

Without merge, every new signal creates a new contact record. The same John Smith who was
involved in an I-75 crash, booked at the Hillsborough County Jail, and appeared as a
defendant in a DUI case would create three separate contact records. A law firm client
receiving leads from this account would see three duplicate entries, each with incomplete
information.

The merge system solves this by:

1. Detecting when a new upsert refers to an existing contact (deduplication)
2. Combining the incoming data with the existing record without destroying what is already
   known (merge)
3. Enforcing a confidence hierarchy so that higher-quality data always takes precedence
   over lower-quality data (conflict resolution)

### The Cross-Source Identity Problem

A single person may appear with these variations across sources:

| Source | First Name | Last Name | Phone | Address |
|---|---|---|---|---|
| FHP CAD (crash event) | Unidentified | Crash Incident — HILLSBOROUGH | null | I-75 NB MM 131 |
| DHSMV registration | JOHN | SMITH | null | 4821 Oak Ridge Dr, Tampa, FL 33613 |
| Sheriff booking | John | Smith | (813) 555-1234 | null |
| Court filing | JOHN A | SMITH | null | 4821 Oak Ridge Dr Tampa FL 33613 |
| BatchData skip-trace | John | Smith | (813) 555-9876 | 4821 Oak Ridge Dr, Tampa, FL 33613 |

The merge system must produce a single authoritative record:

```
firstName:     John
lastName:      Smith
phone:         (813) 555-1234   (sheriff booking — beats BatchData 0.90 > 0.72)
address:       4821 Oak Ridge Dr, Tampa, FL 33613  (DHSMV — 0.90 confidence)
skipTraceStatus: source_matched  (phone from source — BatchData unnecessary)
```

---

## The Merge Contract — Never Downgrade

The fundamental guarantee of `mergeContact()`:

> **Confidence only moves upward. A field can be upgraded to a higher-confidence value.
> It can be filled in when blank. It can never be replaced by a lower-confidence value.**

This contract applies to every field that has a confidence dimension:

- `phone` / `phoneConfidence` — higher confidence source always wins
- `address` / `addressConfidence` — higher confidence always wins; residential beats highway
- `skipTraceStatus` — statusRank is monotonically increasing
- `enrichmentConfidence` — always `Math.max(incoming, existing)`
- `identityStatus` — unidentified < placeholder < verified (never regresses)
- `exportEligible` — can become true, but becoming false requires explicit override

This contract means that the order in which signals arrive does not matter. Whether the
DHSMV registration enrichment runs before or after the BatchData skip-trace, the final
merged record will always prefer the higher-confidence source.

---

## Three-Tier Deduplication

Before any merge can happen, `upsertContact()` must determine whether the incoming data
refers to an existing contact. It uses three strategies in priority order.

### Tier 1 — Source External ID (Strongest)

```typescript
// Step 1: Try dedup by source_external_id
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
    return mergeContact(existing[0], input, ...);
  }
}
```

**What it matches:** The exact identifier from the originating system. For crash contacts,
this is the HSMV incident hash. For arrest contacts, this is the county + booking number.
For court filings, this is the case number + party role.

**Format conventions:**
- Crash: `crash:hash:<hsmvHash>:acct<subAccountId>`
- Arrest: `arrest:<county>:<bookingId>`
- Court: `court:<caseNumber>:<partyRole>`

**When it fires:** Every time the same record is re-ingested from the same source system.
Crash events are re-observed in the FHP feed as they are updated — the source external ID
ensures each update merges into the existing contact rather than creating duplicates.

**When it misses:** A person who appears in two different source systems (both a crash
victim and a court defendant) will have different source external IDs — Tier 1 will not
deduplicate them. Tier 2 handles this case.

### Tier 2 — Normalized Phone (Mid-strength)

```typescript
// Step 2: Try dedup by normalized phone
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
    return mergeContact(existing[0], input, ...);
  }
}
```

**What it matches:** Digits-only phone number within the same sub-account. `(813) 555-1234`,
`813-555-1234`, and `8135551234` all normalize to `8135551234` and match each other.

**When it fires:** A jail booking has a phone for John Smith. A later DHSMV enrichment also
finds a phone for the same person. If both phones normalize to the same value, Tier 2 merges
them into one record.

**When it misses:** If one source has a phone and another does not, there is no phone to
compare. Tier 3 handles this case (for sources with name + county data).

**Database enforcement:** A partial unique index on `(sub_account_id, normalized_phone)` where
`normalized_phone IS NOT NULL` prevents duplicate phone entries at the database level, catching
race conditions that application-level dedup might miss.

### Tier 3 — Normalized Email (Fallback)

```typescript
// Step 3: Try dedup by normalized email
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
    return mergeContact(existing[0], input, ...);
  }
}
```

**What it matches:** Lowercase, trimmed email address within the same sub-account. Less
common in Sentinel's government-source pipelines (court filings and booking records rarely
include email), but relevant for Meta lead ads and form submissions.

### Tier 4 — Insert New Contact (Miss)

If no tier matches, `upsertContact()` inserts a new contact row. The new row includes all
fields from `baseValues`, including the auto-derived `skipTraceStatus` and `identityStatus`.

### Dedup Scope: Always Sub-Account Scoped

All three tiers filter by `subAccountId`. The same person with the same phone appearing in
two different sub-accounts creates two separate contact records. Cross-account deduplication
is not performed — each sub-account represents an independent client with its own lead pool.

---

## Phone Merge Hierarchy

When a contact is found by Tier 1, 2, or 3 dedup, the incoming phone is compared against
the existing phone using the confidence scale.

### Confidence Scale

```typescript
export const PHONE_CONFIDENCE = {
  VERIFIED_GOVERNMENT: 0.95,   // FLHSMV, DHSMV — FL government agency direct
  SHERIFF_BOOKING:     0.90,   // Sheriff booking record — directly from booking form
  COURT_FILING:        0.85,   // Court filing — party contact info on official record
  REGISTRATION:        0.85,   // DHSMV registration — vehicle owner phone on file
  BATCHDATA:           0.72,   // BatchData skip-trace result
  GOOGLE_PLACES:       0.70,   // Google Places — business phone from Maps
  INFERRED:            0.50,   // Inferred / probabilistic match
  UNKNOWN:             0.30,   // Source unknown or not specified
} as const;
```

### Source Priority Order

```
Priority  Source                   Confidence   Notes
────────  ───────────────────────  ──────────   ────────────────────────────────────────
1         Verified Government      0.95         FLHSMV direct, DHSMV direct
2         Sheriff Booking          0.90         Jail booking form — arrestee provided
3         Court Filing             0.85         Official court record party contact
4         DHSMV Registration       0.85         Vehicle owner phone on record
5         BatchData                0.72         Skip-trace — inferred from data brokers
6         Google Places            0.70         Business phone — Maps profile
7         Inferred                 0.50         Probabilistic / model-derived
8         Unknown                  0.30         No source attribution
```

### The Merge Decision

```typescript
// mergeContact() — phone merge
const incomingPhoneConf = input.phoneConfidence ?? (input.phone ? PHONE_CONFIDENCE.UNKNOWN : 0);
const existingPhoneConf = (existing as any).phoneConfidence ?? (existing.phone ? PHONE_CONFIDENCE.UNKNOWN : 0);

if (input.phone && (incomingPhoneConf > existingPhoneConf || !existing.phone)) {
  patch.phone           = input.phone;
  patch.normalizedPhone = normPhone;
  patch.phoneSource     = input.phoneSource;
  patch.phoneConfidence = input.phoneConfidence;
  patch.phoneAcquiredAt = input.phoneAcquiredAt ?? new Date();
}
```

**Rule:** Incoming phone replaces existing phone only if `incomingConf > existingConf` or
existing phone is null. Equal confidence retains the existing phone (first write wins on ties).

**Implication for `BatchData`:** BatchData (0.72) can never overwrite a sheriff booking
phone (0.90), a court filing phone (0.85), or a FLHSMV-verified phone (0.95). BatchData
can only write to contacts that have no phone (no conflict) or that have a lower-confidence
prior phone (unknown, inferred, or Google Places).

---

## Address Merge Hierarchy

The victim-centric address architecture maintains multiple address fields per contact.
The merge rules for each field differ based on its role.

### Address Confidence Scale

```typescript
export const ADDRESS_CONFIDENCE = {
  VERIFIED_RESIDENCE:  0.95,   // Geocode-confirmed residential address
  DHSMV_REGISTRATION:  0.90,   // DHSMV registration (registered owner)
  FLHSMV_LICENSE:      0.85,   // FLHSMV crash report driver's license address
  BATCHDATA_INFERRED:  0.72,   // BatchData skip-trace mailing address
  PROBABLE_HOUSEHOLD:  0.61,   // Aggregated from multiple sources
  INCIDENT_LOCATION:   0.15,   // Crash scene / highway — NOT residential
  UNKNOWN:             0.0,    // No address or completely unknown
} as const;
```

### Address Fields and Their Merge Rules

**`incidentLocation`** — crash scene, highway marker
- Rule: first-write-wins (only set if blank)
- Confidence: always `INCIDENT_LOCATION` (0.15)
- Contract: NEVER used as a residential address for skip-trace or export
- Merge: `if (input.incidentLocation && !existing.incidentLocation)`

**`registrationAddress`** — vehicle registration owner address
- Rule: higher confidence wins (DHSMV 0.90 beats FLHSMV report 0.85)
- Merge: compare `registrationAddressSource === "dhsmv"` vs `"flhsmv_report"`
- Contract: captures the registered owner's home address — more reliable than crash scene

**`mailingAddress`** — BatchData skip-trace mailing address
- Rule: fill if blank (first BatchData result wins)
- Confidence: `BATCHDATA_INFERRED` (0.72)
- Merge: `if (input.mailingAddress && !existing.mailingAddress)`

**`probableResidence`** — best inferred residential address before geocode
- Rule: fill if blank
- Built from: `registrationAddress` or `mailingAddress`, whichever is set first
- Used as: geocode target for `address_verify` enrichment job

**`verifiedResidence`** — geocode-confirmed residential address
- Rule: always write (geocode confirmation is authoritative)
- Confidence: `VERIFIED_RESIDENCE` (0.95)
- Merge: `if (input.verifiedResidence)` — no guard, always overwrites

**`address`** (canonical contact address)
- Rule: higher address confidence wins
- Merge: `if (incomingConfidence > existingConfidence || !existing.address)`
- Contract: must never hold an `incidentLocation` value; highway strings are blocked by
  `looksLikeHighwayAddress()` guard before reaching this field

**`addressConfidence`** — upgrade-only
- Rule: `if (incomingConfidence > existingConfidence)`
- Contract: confidence only increases

### Address Selection for Skip-Trace

When `handleAddressVerify()` selects a geocode target:

```
Priority  Field               Confidence   Notes
────────  ──────────────────  ──────────   ────────────────────────────────────────
1         probableResidence   0.61+        Best available residential inference
2         registrationAddress 0.85–0.90    Registration owner address
3         address             varies       Only used if addressConfidence > 0.15
          (skip if highway)
—         incidentLocation    0.15         NEVER geocoded
```

### The Highway Guard

```typescript
export function looksLikeHighwayAddress(address: string | null | undefined): boolean {
  if (!address || address.trim().length < 3) return false;
  return /\b(I-\d|US-\d{1,3}|SR-\d|CR-\d|FL-\d|MM\s*\d|INTERSTATE|HIGHWAY\s+\d|HWY\s+\d|MILE\s+MARKER)\b/i.test(address);
}
```

Any address matching this pattern is rejected from `address` and routed to `incidentLocation`
instead. This prevents highway strings from contaminating the residential address field.

---

## Name Merge

Name merge enforces one inviolable rule: **a real name is never replaced by a placeholder,
and a placeholder is always replaced by a real name.**

### Placeholder Detection

```typescript
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
```

Empty or null names are treated as placeholders — they are not "real" names.

### Name Merge Logic

```typescript
// mergeContact() — name merge
if (
  input.firstName &&
  !isPlaceholderName(input.firstName) &&     // incoming is a real name
  isPlaceholderName(existing.firstName)       // existing is a placeholder
) {
  patch.firstName = input.firstName;
  if (input.lastName !== undefined) patch.lastName = input.lastName;
}
```

**Scenarios:**

| Existing Name | Incoming Name | Action |
|---|---|---|
| `Unidentified Crash Incident` | `John Smith` | Overwrite — incoming is real |
| `John Smith` | `Unidentified Crash Incident` | Retain existing — incoming is placeholder |
| `John Smith` | `Jonathan Smith` | Retain existing — real name never replaced by another real name |
| `John Smith` | `John Smith` | No change — identical |
| null | `John Smith` | Write incoming — existing is blank (treated as placeholder) |
| `Booking Lead` | `Mary Jones` | Overwrite — `Booking Lead` is a placeholder pattern |

### Why Real Names Don't Replace Each Other

Once a real name is recorded, it is locked. The system does not attempt to pick the "better"
real name from competing sources. Name quality comparison (e.g., `JOHN A SMITH` from a
court filing vs. `John Smith` from a booking) would require fuzzy matching and could
introduce errors. The first real name to arrive wins and is never replaced.

If name correction is needed, it must be performed via a manual override (explicit `firstName`
set on a privileged upsert, or direct database update with audit log).

---

## Tag Merge

Tags are additive. The merge system only adds tags — it never removes them.

```typescript
// mergeContact() — tag merge
const incomingTags = input.tags ?? [];
if (incomingTags.length > 0) {
  const existingTagSet = new Set(existing.tags ?? []);
  const newTags = incomingTags.filter(t => !existingTagSet.has(t));
  if (newTags.length > 0) {
    patch.tags = [...(existing.tags ?? []), ...newTags];
  }
}
```

### Tag Accumulation Use Cases

**Source tracking:** A contact can accumulate `sentinel-crash`, `jail-booking`, and
`court-filing` tags over time, recording every source system that observed them.

**Skip-trace outcomes:** `skip-traced` is added when BatchData runs. `has-phone` is added
on match. `no-phone` is added on no_match. These are never removed when a later source
provides a phone — the tag history is preserved.

**Quality signals:** `has-phone`, `has-address`, `export-ready` are added as data quality
improves. They are not removed when quality gates change.

**Lead classification:** `dui`, `personal-injury`, `property-damage` tags from ingestion
accumulate and reflect every legal matter the person is associated with.

**Blocked classifications:** `attorney`, `legal-lead`, `fda-recall` tags prevent
skip-tracing and export. Once set, these are permanent — they cannot be removed by a
later upsert even with no tags in the payload.

---

## Status Merge

`skipTraceStatus` uses a rank-based upgrade-only system.

### Status Rank Table

```typescript
const statusRank: Record<string, number> = {
  not_attempted:  0,   // No enrichment has been tried
  pending:        1,   // Job is queued or in-flight
  attempted:      2,   // API was called, result processing
  failed:         2,   // API call failed (same rank as attempted — retryable)
  no_match:       3,   // BatchData returned no result
  matched:        4,   // BatchData returned a phone match
  source_matched: 5,   // First-party source provided a phone — highest rank
};
```

### Merge Decision

```typescript
if (input.skipTraceStatus) {
  const incomingRank = statusRank[input.skipTraceStatus] ?? 0;
  const existingRank = statusRank[existing.skipTraceStatus ?? "not_attempted"] ?? 0;
  if (incomingRank > existingRank) {
    patch.skipTraceStatus = input.skipTraceStatus;
  }
}
```

### Status Transition Examples

| Existing Status | Incoming Status | Result | Reason |
|---|---|---|---|
| `not_attempted` | `source_matched` | `source_matched` | Rank 5 > 0 — upgrade |
| `not_attempted` | `no_match` | `no_match` | Rank 3 > 0 — upgrade |
| `no_match` | `matched` | `matched` | Rank 4 > 3 — upgrade |
| `no_match` | `source_matched` | `source_matched` | Rank 5 > 3 — upgrade (backfill case) |
| `source_matched` | `no_match` | `source_matched` | Rank 3 < 5 — rejected |
| `source_matched` | `matched` | `source_matched` | Rank 4 < 5 — rejected |
| `matched` | `no_match` | `matched` | Rank 3 < 4 — rejected |
| `matched` | `source_matched` | `source_matched` | Rank 5 > 4 — upgrade (gov source added later) |

The critical invariant: once a contact reaches `source_matched`, no BatchData result
(whether `matched` or `no_match`) can overwrite that status.

---

## Enrichment Confidence Merge

`enrichmentConfidence` represents the overall quality score assigned by the last enrichment
provider. It uses `Math.max()` — the highest confidence ever recorded is retained.

```typescript
// mergeContact() — enrichment confidence
if (input.enrichmentConfidence !== undefined && input.enrichmentConfidence !== null) {
  if (!existing.enrichmentConfidence || input.enrichmentConfidence > existing.enrichmentConfidence) {
    patch.enrichmentConfidence = input.enrichmentConfidence;
  }
}
```

This means if BatchData (0.72) runs first and then DHSMV enrichment (implicit 0.90) runs,
the final `enrichmentConfidence` reflects 0.90. The higher-quality enrichment is always
visible in the CRM score.

---

## Field-by-Field Merge Table

Complete reference for every field in the contacts table and how it merges.

| Field | Merge Strategy | Direction | Confidence Required | Notes |
|---|---|---|---|---|
| `firstName` | Placeholder override only | Incoming wins if existing is placeholder | None — name quality is binary | Real names never replaced |
| `lastName` | Same as firstName | Incoming wins if existing firstName is placeholder | None | Co-merged with firstName |
| `email` | Fill if blank | Incoming if existing is null | None | No confidence comparison |
| `normalizedEmail` | Derived from email | Same as email | — | Auto-computed |
| `phone` | Confidence-based | Higher confidence wins | `phoneConfidence` | BatchData never beats government source |
| `normalizedPhone` | Derived from phone | Co-merged with phone | — | Auto-computed |
| `phoneSource` | Co-merged with phone | Same as phone | — | Written with winning phone |
| `phoneConfidence` | Co-merged with phone | Same as phone | — | Written with winning phone |
| `phoneAcquiredAt` | Co-merged with phone | Same as phone | — | Written with winning phone |
| `address` | Confidence-based | Higher `addressConfidence` wins | `addressConfidence` | Highway strings blocked |
| `formattedAddress` | Fill if blank | Incoming if null | None | Set by geocoder |
| `city` | Fill if blank | Incoming if null | None | Set by geocoder or registration |
| `state` | Fill if blank | Incoming if null | None | |
| `zip` | Fill if blank | Incoming if null | None | |
| `lat` | Confidence-based | Incoming if higher addressConfidence | `addressConfidence` | Residential lat/lng only |
| `lng` | Confidence-based | Same as lat | `addressConfidence` | |
| `geocodeStatus` | Fill if blank | Incoming if null | None | |
| `incidentLocation` | First-write-wins | Incoming if null | None | Crash scene, not residential |
| `incidentLat` | First-write-wins | Incoming if null | None | |
| `incidentLng` | First-write-wins | Incoming if null | None | |
| `registrationAddress` | Confidence-based | DHSMV beats FLHSMV report | Source comparison | |
| `registrationAddressSource` | Co-merged | Same as registrationAddress | — | |
| `mailingAddress` | Fill if blank | Incoming if null | None | BatchData result |
| `probableResidence` | Fill if blank | Incoming if null | None | Geocode target |
| `verifiedResidence` | Always write | Incoming always wins | None | Geocode confirmation is authoritative |
| `addressConfidence` | Upgrade only | Incoming if higher | Direct comparison | Never decreases |
| `addressType` | Co-merged with confidence | Same as addressConfidence | — | |
| `addressSource` | Co-merged with confidence | Same as addressConfidence | — | |
| `skipTraceStatus` | Rank-based upgrade | Higher rank wins | `statusRank` | source_matched(5) is ceiling |
| `enrichmentProvider` | Fill if blank | Incoming if null | None | First enrichment provider recorded |
| `enrichmentAttemptedAt` | Fill if blank | Incoming if null | None | |
| `enrichmentCompletedAt` | Fill if blank | Incoming if null | None | |
| `enrichmentConfidence` | Math.max | Higher wins | Direct comparison | |
| `identityStatus` | Re-derived | From final merged state | None | unidentified < placeholder < verified |
| `exportEligible` | Re-derived or explicit | Explicit override or derived | None | Can become true; explicit false is sticky |
| `tags` | Additive | Always union | None | Never removes existing tags |
| `notes` | Append | Incoming appended with separator | None | Deduplication check before append |
| `leadVertical` | Fill if blank | Incoming if null | None | e.g., "personal_injury" |
| `leadSubtype` | Fill if blank | Incoming if null | None | e.g., "crash", "dui" |
| `county` | Fill if blank | Incoming if null | None | |
| `sourceExternalId` | Fill if blank | Incoming if null | None | First source ID recorded |
| `contactQualityScore` | Math.max | Higher wins | Direct comparison | Best quality score retained |
| `sourcePipeline` | Fill if blank | Incoming if null | None | First pipeline recorded |
| `leadType` | Fill if blank | Incoming if null | None | |
| `routeRuleId` | Fill if blank | Incoming if null | None | |
| `routeReason` | Fill if blank | Incoming if null | None | |

---

## Merge in Practice — Example Walkthroughs

### Example 1: Crash Event + DHSMV Enrichment

```
T=0  Crash ingest creates contact:
     firstName: "Unidentified Crash Incident"
     lastName: "— HILLSBOROUGH"
     phone: null
     address: null
     incidentLocation: "I-75 NB MM 131"
     addressConfidence: 0.15
     skipTraceStatus: "not_attempted"
     source: "sentinel_crash"
     sourceExternalId: "crash:hash:abc123:acct5"

T=1  DHSMV enrichment finds registration record for vehicle at crash:
     upsertContact({
       firstName: "JOHN",
       lastName: "SMITH",
       phone: null,
       registrationAddress: "4821 Oak Ridge Dr, Tampa, FL 33613",
       registrationAddressSource: "dhsmv",
       addressConfidence: 0.90,
       skipTraceStatus: "not_attempted",
       sourceExternalId: "crash:hash:abc123:acct5",  // same ID → Tier 1 dedup
     })

     mergeContact() applies:
       patch.firstName = "JOHN"          (real name replaces placeholder)
       patch.lastName = "SMITH"
       patch.registrationAddress = "4821 Oak Ridge Dr, Tampa, FL 33613"
       patch.address = "4821 Oak Ridge Dr, Tampa, FL 33613"  (0.90 > 0.15)
       patch.addressConfidence = 0.90
       patch.probableResidence = "4821 Oak Ridge Dr, Tampa, FL 33613"

     Result:
       firstName: "JOHN", phone: null, address: "4821 Oak Ridge Dr...", conf: 0.90
       skipTraceStatus: "not_attempted" (no phone yet — still eligible for skip trace)
```

### Example 2: Same Person Arrested + Phone Added

```
T=2  Jail booking comes in for the same person:
     upsertContact({
       firstName: "John",
       lastName: "Smith",
       phone: "(813) 555-1234",
       phoneSource: "sheriff_booking",
       phoneConfidence: 0.90,
       source: "jail_booking",
       sourceExternalId: "arrest:hillsborough:BK2024001234",  // different ID
     })

     Step 1 (Tier 1 dedup): sourceExternalId "arrest:hillsborough:BK2024001234" → no match
     Step 2 (Tier 2 dedup): normalizedPhone "8135551234" → no match (existing has no phone)
     Step 3 (Tier 3 dedup): no email → miss
     Step 4: INSERT new contact (this is a problem — same person, two records)
```

In this scenario, the crash contact and the jail booking create two records because there
is no phone overlap (crash contact has no phone) and no sourceExternalId overlap. This is
a known limitation of the current dedup strategy for cross-source same-person detection.

Future work: a name+county fuzzy dedup pass can be added as Tier 4 to catch this case.

### Example 3: BatchData Cannot Downgrade Source Phone

```
T=3  Retro skip trace runs on crash contact (before source_matched gate):
     enqueueEnrichment({ jobType: "skip_trace", contactId: 42 })

     handleSkipTrace():
       contact.phone = "8135551234"  (from sheriff booking, phoneConfidence: 0.90)
       contact.skipTraceStatus = "source_matched"

       [Gate 4] contact.phone exists → return { enriched: false }

     Result: BatchData never called. Contact status unchanged.
     Phone: "8135551234" (sheriff, 0.90) — unchanged.
```

---

## Operational Invariants

The following conditions must always hold in production. Violations indicate a bug or
a non-compliant upsert call.

1. **No contact has `phone IS NOT NULL` and `skipTraceStatus = 'no_match'`** after the
   backfill migration. This combination indicates either the regression recurred or a
   non-compliant update wrote directly to the database.

2. **No contact has `address` containing a highway reference string** (matching
   `looksLikeHighwayAddress()`). Highway strings belong in `incidentLocation`.

3. **No contact has `addressConfidence > 0.15` and an `address` that matches a highway
   pattern.** If `addressConfidence` is elevated but the address is a highway, the
   confidence was set incorrectly.

4. **No contact has `skipTraceStatus = 'source_matched'` and `phone IS NULL`.** The
   `source_matched` status implies a phone exists. A null phone with `source_matched`
   indicates an incomplete write.

5. **`normalizedPhone` always equals `phone.replace(/\D/g, '')` when `phone IS NOT NULL`.**
   If these diverge, a direct SQL update bypassed the normalization layer.

6. **`enrichmentConfidence` never decreases over time** for a given contact. Monitoring
   should alert if the enrichment confidence column regresses.

7. **Tags only grow** — the count of tags on any contact can only increase or stay the
   same between successive upserts. Any decrease indicates a non-additive write.
