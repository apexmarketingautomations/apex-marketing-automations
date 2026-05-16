# Apex Sentinel — Victim-Centric Architecture

**Status:** Production (deployed 2026-05-16)
**Replaces:** Sentinel v1 address model (highway strings in `contacts.address`)
**Owner:** Apex Marketing OS / Crash Intelligence Pipeline

---

## Table of Contents

1. [Overview and Motivation](#overview-and-motivation)
2. [What Changed from v1](#what-changed-from-v1)
3. [Pipeline Chain with Stage Diagram](#pipeline-chain-with-stage-diagram)
4. [Address Type Taxonomy](#address-type-taxonomy)
5. [New Schema Columns](#new-schema-columns)
6. [Enrichment Chain Detail](#enrichment-chain-detail)
7. [Deduplication Strategy](#deduplication-strategy)
8. [Export Protection Rules](#export-protection-rules)
9. [Scoring Integration (v2.0)](#scoring-integration-v20)
10. [Incident Fingerprint](#incident-fingerprint)
11. [Operational Invariants](#operational-invariants)

---

## Overview and Motivation

Sentinel is Apex's crash-lead intelligence pipeline. It monitors the Florida Highway Patrol
HSMV live CAD feed (`trafficincidents.flhsmv.gov`), converts qualifying crash events into
contact records, and progressively enriches those records with official government data
from FLHSMV and DHSMV.

### The v1 Problem

In v1, the crash scene location string from the FHP CAD feed was written directly into
`contacts.address`. These strings are highway references, not residential addresses:

```
contacts.address = "I-75 NB MM 131, LEE County, FL"
contacts.address = "US-41 & COLONIAL BLVD, LEE County, FL"
contacts.address = "SR-82 MM 14 EB, HENDRY County, FL"
```

This caused three compounding failures:

1. **BatchData skip-trace returned `no_match` 100% of the time** — skip-trace expects a
   residential address; highway markers have no property ownership record. Every call
   burned API credits with no return.

2. **CRM address field was misleading** — attorneys and intake staff saw roadway strings in
   the address field and treated them as residential locations, poisoning outreach.

3. **Scoring rewarded junk data** — the v1 scorer gave full "has address" credit for
   `"I-75 NB MM 131"` because it was non-null. A placeholder contact looked as complete
   as one with a real home address.

### The v2 Solution

The victim-centric architecture separates crash scene from victim residence as distinct
data layers:

- **Incident layer** — crash scene geographic reference, stored in `incidentLocation` /
  `incidentLat` / `incidentLng`. This is where the collision happened.
- **Contact layer** — residential address intelligence from government sources and
  skip-trace, stored in the typed address fields. This is where the person lives.

`contacts.address` is now reserved exclusively for residential data. A contact's address
field starts null and is populated only when genuine residential intelligence is available.

---

## What Changed from v1

| Concern | v1 Behavior | v2 Behavior |
|---|---|---|
| `contacts.address` at ingest | Set to FHP CAD location string | Left null; `incidentLocation` stores crash scene |
| Skip-trace eligibility | All crash contacts eligible | Blocked when `looksLikeHighwayAddress()` is true |
| Address scoring | Non-null address = full credit | `addressConfidence` drives proportional credit |
| Export gate | Name + phone sufficient | Also requires `addressConfidence > 0.15` OR phone/email |
| Placeholder block | No explicit block | `isPlaceholder=true` blocks all exports |
| Scoring dimensions | `enrichment_quality` (address presence) | `enrichment_quality` (address confidence) + `residential_intelligence` bonus |
| Incident dedup | None beyond CAD row | SHA256 `incidentFingerprint` ties all sub-account contacts to one incident |
| DHSMV lookup | Not present | Plate → DHSMV registration → owner address (confidence 0.90) |
| Address type tracking | None | `addressType` discriminator (verified_residence, registration, mailing, incident_location, unknown) |

---

## Pipeline Chain with Stage Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 1: FHP HSMV CAD Signal                                       │
│  Source: trafficincidents.flhsmv.gov (scraped every 5 minutes)      │
│  Output: crash type, location string, county, lat/lng, severity     │
│  Key:    incidentLocation = "I-75 NB MM 131, LEE County, FL"        │
│          incidentLat / incidentLng = validated Florida coordinates   │
│          contacts.address = null (NOT set here)                      │
│          addressConfidence = 0.15 (INCIDENT_LOCATION)               │
│          isPlaceholder = true                                        │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 2: FLHSMV Official Crash Report                              │
│  Trigger: crashReportWorker polls FLHSMV Search + Detail APIs       │
│  Waits up to 14 days for the official report to appear              │
│  Output: driver name, license address, plate number, vehicle info   │
│  Key:    driver.Address → driverAddress (after looksLikeHighway check) │
│          addressConfidence = 0.85 (FLHSMV_LICENSE)                  │
│          registrationAddress = driverAddress                        │
│          registrationAddressSource = "flhsmv_report"               │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 3: DHSMV Registration Lookup (Plate → Owner)                 │
│  Trigger: enrichCrashLeadContacts(), if vehicle has plate number    │
│  Source:  services.flhsmv.gov/MVCheckWeb (via Nimble pipeline proxy) │
│  Output:  registered owner name + mailing address                   │
│  Key:    registrationAddress = ownerAddress                         │
│          registrationAddressSource = "dhsmv"                        │
│          addressConfidence = 0.90 (DHSMV_REGISTRATION)              │
│  Note:   DHSMV address beats FLHSMV license (owner > driver addr)   │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 4: BatchData Skip-Trace                                      │
│  Trigger: retroSkipTrace on contacts with registrationAddress set   │
│           (NOT on incident_location strings)                        │
│  Input:   probableResidence (best residential address before this)  │
│  Output:  phone, email, mailing address, all household members      │
│  Key:     mailingAddress = result.mailingAddress                    │
│           addressConfidence = 0.72 (BATCHDATA_INFERRED)             │
│           skipTraceStatus = "matched" | "no_match"                  │
│  Guard:   looksLikeHighwayAddress() → skip, do not burn credits     │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 5: Contact Intelligence (Export-Ready)                       │
│  Gate:    addressConfidence > 0.15 OR has phone/email               │
│           isPlaceholder = false (set by FLHSMV enrichment)          │
│  Fields:  verifiedResidence (geocode-confirmed)                     │
│           probableResidence (best pre-geocode estimate)             │
│           addressConfidence >= 0.72 (BatchData) or 0.90+ (DHSMV)   │
│  Score:   enrichment_quality + residential_intelligence bonus        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Address Type Taxonomy

The `addressType` discriminator records which semantic category the current
`contacts.address` value belongs to. This is the definitive source of truth for what
the address field contains at any moment in a contact's lifecycle.

| `addressType` | `addressConfidence` | Meaning | Example |
|---|---|---|---|
| `verified_residence` | 0.95 | Geocode-confirmed residential address | `"4521 SW 25th Ave, Cape Coral, FL 33914"` |
| `registration` | 0.85–0.90 | FLHSMV/DHSMV registration or license address | `"1840 NE Pine Island Rd, Cape Coral, FL 33909"` |
| `mailing` | 0.72 | BatchData mailing address from skip-trace | `"PO Box 3310, Fort Myers, FL 33918"` |
| `probable_residence` | 0.61 | Aggregated best-guess, not yet geocoded | `"3210 Del Prado Blvd S, Cape Coral, FL"` |
| `incident_location` | 0.15 | Crash scene / highway reference | `"I-75 NB MM 131, LEE County, FL"` |
| `unknown` | 0.0 | No address data available | `null` |

### Design Rules

1. `addressType` and `addressConfidence` always move together — if one changes, both change.
2. Address confidence only moves upward in `mergeContact()`. A FLHSMV enrichment run
   cannot downgrade a contact that already has a DHSMV-quality address.
3. `incident_location` type is valid only at contact creation. Any subsequent enrichment
   must produce a type of `registration` or higher to advance the contact.
4. `verifiedResidence` is set separately from `contacts.address` — it is the geocoded
   confirmation copy and survives any future address merges.

---

## New Schema Columns

All columns added in the 2026-05-16 migration to `contacts` table
(source: `shared/schema.ts`):

```typescript
// Crash scene — NEVER used for residential purposes
incidentLocation: text("incident_location"),
incidentLat:      real("incident_lat"),
incidentLng:      real("incident_lng"),

// Government registration data
registrationAddress:        text("registration_address"),
registrationAddressSource:  text("registration_address_source"),  // 'dhsmv' | 'flhsmv_report'
registrationAddressSourcAt: timestamp("registration_address_sourced_at"),

// Skip-trace output
mailingAddress: text("mailing_address"),

// Address intelligence tiers
probableResidence: text("probable_residence"),
verifiedResidence: text("verified_residence"),

// Confidence + metadata
addressConfidence: real("address_confidence").default(0.0),
addressType:       text("address_type").default("unknown"),
addressSource:     text("address_source"),

// Incident linkage
incidentFingerprint: text("incident_fingerprint"),

// Placeholder guard
isPlaceholder: boolean("is_placeholder").default(true).notNull(),
```

Indexes supporting the new model:

```sql
CREATE INDEX idx_contacts_is_placeholder     ON contacts(sub_account_id, is_placeholder);
CREATE INDEX idx_contacts_incident_fingerprint ON contacts(incident_fingerprint);
```

---

## Enrichment Chain Detail

### Stage 1 — FHP CAD Ingest (`crashIngestPipeline.ts`)

The ingest pipeline gates skip-trace eligibility before calling BatchData:

```typescript
// Skip-trace at ingest time is only useful if the address is residential.
// FHP incident locations are highway references (e.g. "I-75 NB MM 131") —
// BatchData returns no_match on these 100% of the time and wastes credits.
const looksLikeHighway = /\b(I-\d|US-\d|SR-\d|CR-\d|FL-\d|MM\s*\d|INTERSTATE|HIGHWAY|HWY)\b/i
  .test(incident.location || "");

if (batchDataKey && incident.location && !looksLikeHighway) {
  // BatchData call — only for genuinely residential locations
}
```

When writing the initial contact, the crash scene goes to `incidentLocation`, not `address`:

```typescript
await upsertContact({
  subAccountId: accountId,
  // ...
  // Do NOT write highway/intersection strings into contact.address.
  incidentLocation: incident.location,
  incidentLat:      incident.lat ?? null,
  incidentLng:      incident.lng ?? null,
  // address intentionally omitted — will be populated by FLHSMV enrichment
  addressType:       "incident_location",
  addressConfidence: 0.15,   // ADDRESS_CONFIDENCE.INCIDENT_LOCATION
  addressSource:     "fhp_cad",
  isPlaceholder:     true,
});
```

### Stage 2 — FLHSMV Report Enrichment (`crashReportWorker.ts → enrichCrashLeadContacts()`)

When the official FLHSMV crash report becomes available, the driver's license address is
extracted and validated:

```typescript
const { ADDRESS_CONFIDENCE, looksLikeHighwayAddress } = await import("./services/contactUpsertService");
const rawDriverAddress = driver.Address?.trim() || null;
// Reject highway-looking addresses that slipped through FLHSMV
const driverAddress = rawDriverAddress && !looksLikeHighwayAddress(rawDriverAddress)
  ? rawDriverAddress
  : null;
```

### Stage 3 — DHSMV Registration Lookup (`dhsmvRegistrationLookup.ts`)

If the crash report includes a plate number, DHSMV is queried for the registered owner:

```typescript
const reg = await lookupRegistration(plateNumber, vehicle?.TagState ?? "FL");
if (reg.found && reg.ownerAddress && !looksLikeHighwayAddress(reg.ownerAddress)) {
  dhsmvOwnerAddress = reg.ownerAddress;
  enrichmentTags.push("dhsmv-enriched");
}
```

DHSMV beats FLHSMV license address in the confidence ranking:

```typescript
// Priority: DHSMV owner address (0.90) > FLHSMV driver address (0.85) > null
const bestAddress     = dhsmvOwnerAddress ?? driverAddress;
const bestAddressConf = dhsmvOwnerAddress ? ADDRESS_CONFIDENCE.DHSMV_REGISTRATION  // 0.90
                      : driverAddress     ? ADDRESS_CONFIDENCE.FLHSMV_LICENSE       // 0.85
                      : ADDRESS_CONFIDENCE.UNKNOWN;                                 // 0.0
```

The address note written to the contact's notes field includes provenance:

```typescript
const addressNote = bestAddress
  ? `Residential address (${bestAddressSrc}, confidence ${(bestAddressConf * 100).toFixed(0)}%): ${bestAddress}`
  : "No residential address recovered — skip trace required";
```

### Stage 4 — BatchData Skip-Trace (`retroSkipTrace.ts`)

Skip-trace runs against `contact.address` (now a residential address, not a highway string).
The mailing address returned by BatchData is captured in `mailingAddress`:

```typescript
const mailingAddr = result.mailingAddress || null;

await storage.updateContact(contact.id, {
  address: mailingAddr || (contact.address ?? undefined),
  email:   result.ownerEmail || (contact.email ?? undefined),
});
```

The `updateContactSkipTrace()` helper in `contactUpsertService.ts` atomically updates
skip-trace status and tags:

```typescript
await updateContactSkipTrace(contact.id, {
  status:    "matched",
  phone:     result.ownerPhone || null,
  firstName: result.ownerName && !isPlaceholderName(result.ownerName)
    ? result.ownerName.trim().split(" ")[0] : null,
  provider:  "batchdata",
  confidence: result.totalPersonsFound > 0 ? 0.8 : 0.5,
});
```

---

## Deduplication Strategy

The `upsertContact()` function in `contactUpsertService.ts` applies a three-tier dedup chain
before inserting a new record:

```typescript
// Dedup strategy (in order of precedence):
//   1. source_external_id match (strongest — same incident/record in source system)
//   2. normalized_phone match within same sub-account
//   3. normalized_email match within same sub-account
//   4. If none match → insert new contact
```

### Crash-Specific Dedup Keys

At ingest time, the `sourceExternalId` is set per account:

```typescript
const sourceExternalId = report.reportNumber
  ? `crash:${report.reportNumber}`
  : `crash:${report.id}`;

// Fan-out: each account gets its own keyed record
await upsertContact({
  sourceExternalId: `${sourceExternalId}:acct${accountId}`,
  // ...
});
```

This means one crash report with report number `SENTINEL-AB12CD34EF56` creates:
- `crash:SENTINEL-AB12CD34EF56:acct3` in account 3
- `crash:SENTINEL-AB12CD34EF56:acct4` in account 4

Both records share the same `incidentFingerprint` (see below), enabling incident-level
analytics and dedup across accounts.

### Merge Rules in `mergeContact()`

When an existing contact is found, the merge function applies confidence-gated rules:

- **Address**: only upgrade — higher confidence wins. Residential addresses cannot be
  replaced by lower-confidence data (e.g., a subsequent FHP scan cannot overwrite a
  DHSMV registration address with an `incident_location` string).
- **incidentLocation**: first write wins (the crash scene is the crash scene).
- **registrationAddress**: DHSMV (0.90) beats FLHSMV report (0.85) in the same field.
- **verifiedResidence**: always written — geocode confirmation is authoritative.
- **skipTraceStatus**: only upgrades along the status rank ladder:
  `not_attempted → pending → attempted → failed/no_match → matched`.

---

## Export Protection Rules

A contact must pass all of the following to appear in CRM exports or be sent to
downstream systems:

### Rule 1: Not a Placeholder

```typescript
// Hard gate: isPlaceholder contacts cannot qualify regardless of score.
const qualifies = score >= QUALIFY_THRESHOLD && !contact.isPlaceholder;
```

`isPlaceholder` starts as `true` at ingest. It is set to `false` only by
`enrichCrashLeadContacts()` when a real driver name has been recovered from FLHSMV.

### Rule 2: Address Confidence Gate

```typescript
export function deriveExportEligible(
  firstName:         string | null | undefined,
  phone:             string | null | undefined,
  email:             string | null | undefined,
  leadType:          string | null | undefined,
  override?:         boolean | null,
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
```

The combined logic means:
- A contact with only `addressConfidence=0.15` (incident location) and no phone/email
  is blocked from export.
- A contact with `addressConfidence=0.15` but a verified phone (from an early skip-trace
  hit) is allowed through — the phone is the contactable artifact.
- A contact with `addressConfidence >= 0.90` (DHSMV registration) and a phone is
  fully export-eligible.

### Rule 3: Placeholder Name Guard

`mergeContact()` enforces that real names never get overwritten with placeholder names,
and placeholder names never count as real identifiers:

```typescript
// Name: only overwrite if incoming is a real name and existing is a placeholder
if (
  input.firstName &&
  !isPlaceholderName(input.firstName) &&
  isPlaceholderName(existing.firstName)
) {
  patch.firstName = input.firstName;
}
```

The `isPlaceholderName()` function matches against:

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
```

---

## Scoring Integration (v2.0)

The `computeContactScore()` function in `server/workers/scoringWorker.ts` was updated to
reflect the victim-centric architecture.

### Enrichment Quality (25 pts) — v2 Logic

Address points are now proportional to `addressConfidence`, not address presence:

```typescript
// Address scoring now uses addressConfidence, NOT mere non-null presence.
// A roadway string ("I-75 NB MM 131") must NEVER score the same as a real home address.
const addrConf = c.addressConfidence ?? 0;
if (addrConf >= 0.90) enrichQuality += 8;       // verified residence / DHSMV
else if (addrConf >= 0.80) enrichQuality += 6;  // FLHSMV driver license
else if (addrConf >= 0.60) enrichQuality += 4;  // BatchData inferred
else if (addrConf > 0.15) enrichQuality += 2;   // probable household
else if (addrConf > 0) enrichQuality += 1;      // incident location only — minimal credit
```

Geocode-confirmed residential still earns the maximum bonus:

```typescript
// Geocode-confirmed residential is the gold standard (+7 only for residential confirmation)
if (contact.geocodeStatus === "verified" && (c.addressType ?? "unknown") !== "incident_location") {
  enrichQuality += 7;
}
```

### Residential Intelligence Bonus (10 pts) — New in v2

A new sub-score dimension rewards contacts that have progressed through the enrichment chain:

```typescript
// 1b. Residential intelligence bonus (separate from enrichment_quality, max 10pts)
let residentialBonus = 0;
if (c.verifiedResidence)    residentialBonus += 5;  // geocode-confirmed residential
if (c.registrationAddress)  residentialBonus += 3;  // FLHSMV/DHSMV registration
if (c.incidentFingerprint)  residentialBonus += 2;  // linked to official crash report
breakdown.residential_intelligence = Math.min(residentialBonus, 10);
```

### v1 vs v2 Score Comparison

A fully enriched crash contact in v2 can earn up to 35 points from address intelligence
alone (25 enrichment_quality + 10 residential_intelligence), compared to a maximum of
~18 points in v1 for the same contact. A pure highway-location placeholder without phone
earns at most 1 point from address intelligence in v2 (down from 8 in v1).

---

## Incident Fingerprint

Every contact created from a crash report carries a stable `incidentFingerprint` that
ties it back to the originating incident, regardless of which sub-account received the
fan-out copy.

### Format

```typescript
// Stable incident fingerprint — SHA256 of the canonical crash identifier.
// Format: SHA256("crash:" + reportNumber)
const incidentFingerprint = crypto
  .createHash("sha256")
  .update(`crash:${sentinelReportNumber}`)
  .digest("hex");
```

Example: for report number `SENTINEL-AB12CD34EF56`, the fingerprint is:
```
SHA256("crash:SENTINEL-AB12CD34EF56") → "3f7a2d9e1b5c4a8f..."
```

### Usage

- **Cross-account dedup**: if the same crash report arrives via two different polling
  cycles and is assigned to accounts 3 and 4, both contacts carry the same fingerprint.
- **Analytics**: the `idx_contacts_incident_fingerprint` index allows instant lookup of
  all contacts associated with one incident.
- **Scoring**: the `residential_intelligence` dimension awards 2 pts for having a
  fingerprint, confirming the contact is linked to a real government crash record.
- **Notes**: the enrichment note includes the fingerprint for human-readable audit trails:
  ```
  Incident fingerprint: 3f7a2d9e1b5c4a8f...
  ```

### Database Index

```sql
CREATE INDEX idx_contacts_incident_fingerprint ON contacts(incident_fingerprint);
```

---

## Operational Invariants

These invariants are enforced by the codebase and must not be violated by any future
change to the crash pipeline:

1. `contacts.address` must never hold a highway reference string. If `looksLikeHighwayAddress()`
   returns `true` for a candidate address, it must be routed to `incidentLocation`, not `address`.

2. `addressConfidence` is monotonically non-decreasing per contact. The merge logic in
   `mergeContact()` only writes a new confidence value when `incomingConfidence > existingConfidence`.

3. `isPlaceholder=true` is the birth state of every crash contact. It is cleared only when
   `enrichCrashLeadContacts()` successfully writes a real driver name from FLHSMV.

4. `incidentLocation` is write-once (first write wins). A second scan of the same crash must
   not overwrite the originally recorded crash scene.

5. Skip-trace must never be called on a contact whose `contacts.address` or `probableResidence`
   matches `looksLikeHighwayAddress()`. The guard in `crashIngestPipeline.ts` and the design
   intent in `retroSkipTrace.ts` enforce this. Violations waste BatchData credits and return
   false negatives.

6. `incidentFingerprint` for a given `reportNumber` is always `SHA256("crash:" + reportNumber)`.
   This formula must not change because existing contact records depend on it for dedup
   convergence.

7. The fan-out `sourceExternalId` format must remain `crash:<reportNumber>:acct<accountId>`.
   The `isAlreadyEnriched()` function in `retroFLHSMVEnrich.ts` queries with a `LIKE` prefix
   `crash:<reportNumber>:` — any deviation in format breaks idempotency.
