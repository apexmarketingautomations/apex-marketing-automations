# Apex Sentinel — Address Confidence Scoring System

**Status:** Production (deployed 2026-05-16)
**Module:** `server/services/contactUpsertService.ts`
**Depends on:** Victim-Centric Architecture (see `SENTINEL_VICTIM_CENTRIC_ARCHITECTURE.md`)

---

## Table of Contents

1. [Purpose](#purpose)
2. [Scale Definition with Examples](#scale-definition-with-examples)
3. [Constants Reference](#constants-reference)
4. [How Confidence Flows Through the Pipeline](#how-confidence-flows-through-the-pipeline)
5. [The `looksLikeHighwayAddress` Guard](#the-looklikehighwayaddress-guard)
6. [The `deriveExportEligible` Function](#the-deriveexporteligible-function)
7. [Confidence Gates: Exports](#confidence-gates-exports)
8. [Confidence Gates: Scoring](#confidence-gates-scoring)
9. [How to Upgrade Confidence](#how-to-upgrade-confidence)
10. [Operational Implications](#operational-implications)
11. [Monitoring and Alerting](#monitoring-and-alerting)

---

## Purpose

Address confidence is a first-class data attribute on every contact record. It answers the
question: **"How much should the system trust `contacts.address` as a residential address?"**

Before this system existed, all address strings were treated as equivalent. A highway
reference like `"I-75 NB MM 131"` scored the same as a geocode-confirmed residential
address. This led to skip-trace credit waste (BatchData returns `no_match` on roadway
markers 100% of the time) and false-positive exports (attorneys received leads with
crash-scene locations in the address field).

Address confidence fixes this by:

1. Attaching a numeric trust score to every address value at write time.
2. Preventing confidence downgrades (residential intelligence is never overwritten by
   lower-quality data in `mergeContact()`).
3. Gating exports behind a minimum confidence threshold.
4. Driving proportional scoring instead of binary address-present/absent scoring.

---

## Scale Definition with Examples

The scale runs from 0.0 (no data) to 1.0 (maximum trust). There are seven defined levels,
each corresponding to a specific data source:

### 0.0 — UNKNOWN

No address data is available. The contact was just created and has not been enriched at all,
or enrichment failed completely.

```
contacts.address    = null
addressType         = "unknown"
addressConfidence   = 0.0
```

**When it occurs:** Initial contact creation when no address information is available from
any source. Also the default when FHP CAD coordinates are present but the location string
was explicitly blocked from `contacts.address`.

---

### 0.15 — INCIDENT_LOCATION

A roadway reference or crash scene string. This is a geographic description of where an
event occurred, not where a person lives. It has minimal value as residential intelligence.

```
contacts.address    = null           ← intentionally left null in v2
incidentLocation    = "I-75 NB MM 131, LEE County, FL"
addressType         = "incident_location"
addressConfidence   = 0.15
addressSource       = "fhp_cad"
```

The 0.15 value is non-zero so it is distinguishable from "no data at all" in queries and
scoring, but it is below the export gate threshold (> 0.15 required for address-based
export eligibility).

**When it occurs:** Stage 1 — FHP HSMV CAD ingest. Every crash contact starts here.

**Important:** In the v2 architecture, `contacts.address` is left null even when
`addressConfidence=0.15`. The incident location lives in `incidentLocation` only. A score
of 0.15 on `addressConfidence` signals "we know where the crash was, not where the person lives."

---

### 0.61 — PROBABLE_HOUSEHOLD

An aggregated best-guess residential address derived from multiple partial signals, none of
which is authoritative on its own. This might come from a combination of county records,
the license address, and partial skip-trace data that did not produce a full match.

```
contacts.address    = "3210 Del Prado Blvd S, Cape Coral, FL"
probableResidence   = "3210 Del Prado Blvd S, Cape Coral, FL"
addressType         = "probable_residence"
addressConfidence   = 0.61
addressSource       = "aggregated"
```

**When it occurs:** When enrichment produces a candidate address that is plausible but not
confirmed by a single authoritative government source. The address is above the export gate
and can be used for skip-trace targeting.

---

### 0.72 — BATCHDATA_INFERRED

An address returned by the BatchData skip-trace API for a given name + residential input.
BatchData searches property and public records to infer the current mailing or residential
address for a named individual.

```
contacts.address    = "4521 SW 25th Ave, Cape Coral, FL 33914"
mailingAddress      = "4521 SW 25th Ave, Cape Coral, FL 33914"
addressType         = "mailing"
addressConfidence   = 0.72
addressSource       = "batchdata"
skipTraceStatus     = "matched"
```

**When it occurs:** Stage 4 — BatchData skip-trace succeeds on a contact that already has
a residential address (registration or license). BatchData enrichment is only triggered
when the input address is residential (guarded by `looksLikeHighwayAddress()`).

---

### 0.85 — FLHSMV_LICENSE

The home address recorded on the driver's Florida state license, extracted from the official
FLHSMV crash report. This is a government-verified address at the time of license issuance,
though it may be up to 8 years old (FL license renewal cycle).

```
contacts.address           = "1840 NE Pine Island Rd, Cape Coral, FL 33909"
registrationAddress        = "1840 NE Pine Island Rd, Cape Coral, FL 33909"
registrationAddressSource  = "flhsmv_report"
addressType                = "registration"
addressConfidence          = 0.85
addressSource              = "flhsmv"
```

**When it occurs:** Stage 2 — `enrichCrashLeadContacts()` in `crashReportWorker.ts`
successfully retrieves the official FLHSMV crash report and extracts `driver.Address`.
The address is passed through `looksLikeHighwayAddress()` before being accepted.

---

### 0.90 — DHSMV_REGISTRATION

The registered owner address from the DHSMV (Department of Highway Safety and Motor Vehicles)
vehicle registration database. This is current as of the last registration renewal (FL vehicles
renew annually) and reflects the owner's legal registered address.

```
contacts.address           = "4521 SW 25th Ave, Cape Coral, FL 33914"
registrationAddress        = "4521 SW 25th Ave, Cape Coral, FL 33914"
registrationAddressSource  = "dhsmv"
registrationAddressSourcAt = "2026-05-16T14:32:00Z"
addressType                = "registration"
addressConfidence          = 0.90
addressSource              = "dhsmv"
tags                       = ["dhsmv-enriched", ...]
```

**When it occurs:** Stage 3 — `lookupRegistration()` in `dhsmvRegistrationLookup.ts`
successfully retrieves the registered owner from `services.flhsmv.gov/MVCheckWeb`. Requires
a plate number from the FLHSMV crash report.

DHSMV beats FLHSMV license in confidence because vehicle registration is renewed annually
versus the 8-year driver's license cycle. The registration address is more likely to be
current.

---

### 0.95 — VERIFIED_RESIDENCE

A geocode-confirmed residential address. The candidate address (from registration or
skip-trace) was submitted to a geocoding API, matched to a real residential parcel, and
confirmed as a valid deliverable address.

```
contacts.address    = "4521 SW 25th Ave, Cape Coral, FL 33914"
verifiedResidence   = "4521 SW 25th Ave, Cape Coral, FL 33914"
geocodeStatus       = "verified"
addressType         = "verified_residence"
addressConfidence   = 0.95
addressSource       = "google_geocode"
lat                 = 26.5812
lng                 = -81.9742
```

**When it occurs:** After geocoding confirms the residential address. The `verifiedResidence`
field is set atomically with `geocodeStatus="verified"` and the contact's lat/lng coordinates
are set to the residential location (not the crash scene).

---

## Constants Reference

Defined in `server/services/contactUpsertService.ts`:

```typescript
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
```

Always import and use these constants — never hardcode numeric confidence values. The
constants are the single source of truth; if thresholds change (e.g., due to a DHSMV data
quality audit), changing the constant propagates to all callers.

---

## How Confidence Flows Through the Pipeline

This section traces a single contact through its full lifecycle.

### T=0: FHP CAD Ingest

```
Source:            FHP HSMV live feed
addressType:       "incident_location"
addressConfidence: 0.15   ← ADDRESS_CONFIDENCE.INCIDENT_LOCATION
addressSource:     "fhp_cad"
contacts.address:  null   ← intentionally omitted
incidentLocation:  "I-75 NB MM 131, LEE County, FL"
isPlaceholder:     true
```

### T+0 to T+14 days: FLHSMV Official Report

The crash report worker polls FLHSMV until the official report appears (up to 14 days).
When found, `enrichCrashLeadContacts()` runs:

```typescript
const driverAddress = rawDriverAddress && !looksLikeHighwayAddress(rawDriverAddress)
  ? rawDriverAddress
  : null;

const bestAddressConf = dhsmvOwnerAddress ? ADDRESS_CONFIDENCE.DHSMV_REGISTRATION  // 0.90
                      : driverAddress     ? ADDRESS_CONFIDENCE.FLHSMV_LICENSE       // 0.85
                      : ADDRESS_CONFIDENCE.UNKNOWN;                                 // 0.0
```

If driver address is present and passes the highway guard:

```
addressType:       "registration"
addressConfidence: 0.85   ← ADDRESS_CONFIDENCE.FLHSMV_LICENSE
addressSource:     "flhsmv"
contacts.address:  "1840 NE Pine Island Rd, Cape Coral, FL 33909"
probableResidence: "1840 NE Pine Island Rd, Cape Coral, FL 33909"
isPlaceholder:     false  ← cleared by FLHSMV enrichment
```

### T+14 days (concurrent): DHSMV Registration Lookup

If plate number is available, DHSMV is queried in the same `enrichCrashLeadContacts()` call:

```
addressType:       "registration"
addressConfidence: 0.90   ← ADDRESS_CONFIDENCE.DHSMV_REGISTRATION (upgraded from 0.85)
addressSource:     "dhsmv"
registrationAddress:       "4521 SW 25th Ave, Cape Coral, FL 33914"
registrationAddressSource: "dhsmv"
tags:              [..., "dhsmv-enriched"]
```

The merge rule in `mergeContact()` applies:

```typescript
// Address: only upgrade — higher confidence wins.
const incomingConfidence = input.addressConfidence ?? 0;   // 0.90
const existingConfidence = (existing as any).addressConfidence ?? 0;  // 0.85

if (input.address) {
  if (incomingConfidence > existingConfidence || !existing.address) {
    patch.address = input.address;  // 0.90 > 0.85 → DHSMV wins
  }
}
```

### T+15 days: BatchData Skip-Trace (Retro Run)

The retro skip-trace job picks up contacts with `address` set (residential), skipping those
with highway-looking addresses:

```
mailingAddress:    "4521 SW 25th Ave, Cape Coral, FL 33914"  (confirmed match)
addressType:       "mailing"
addressConfidence: 0.72   ← ADDRESS_CONFIDENCE.BATCHDATA_INFERRED
```

Note: if BatchData returns the same address already in `contacts.address`, confidence stays
at 0.90 (DHSMV) because `mergeContact()` does not downgrade. The 0.72 would only apply if
BatchData returned a new, previously unknown address.

### T+15 days: Geocode Confirmation

If a geocoding run confirms the address as a valid residential parcel:

```
verifiedResidence: "4521 SW 25th Ave, Cape Coral, FL 33914"
geocodeStatus:     "verified"
addressType:       "verified_residence"
addressConfidence: 0.95   ← ADDRESS_CONFIDENCE.VERIFIED_RESIDENCE
addressSource:     "google_geocode"
lat:               26.5812
lng:               -81.9742
```

At this point the contact has maximum address confidence and full residential intelligence.

---

## The `looksLikeHighwayAddress` Guard

This function is the primary defense against highway strings entering the residential
address stack. It is called at every point where an address candidate is first received.

```typescript
/**
 * Returns true if the given address string looks like a highway reference,
 * not a residential or mailing address. These should never be skip-traced
 * or used as residential intelligence.
 */
export function looksLikeHighwayAddress(address: string | null | undefined): boolean {
  if (!address || address.trim().length < 3) return false;
  return /\b(I-\d|US-\d{1,3}|SR-\d|CR-\d|FL-\d|MM\s*\d|INTERSTATE|HIGHWAY\s+\d|HWY\s+\d|MILE\s+MARKER)\b/i
    .test(address);
}
```

### Pattern Coverage

| Pattern | Matches | Example |
|---|---|---|
| `I-\d` | Interstate highways | `I-75`, `I-4`, `I-275` |
| `US-\d{1,3}` | US routes | `US-41`, `US-27`, `US-1` |
| `SR-\d` | Florida state roads | `SR-82`, `SR-951` |
| `CR-\d` | County roads | `CR-951`, `CR-29` |
| `FL-\d` | Florida highway markers | `FL-80` |
| `MM\s*\d` | Mile markers | `MM 131`, `MM14` |
| `INTERSTATE` | Word form | `INTERSTATE 75` |
| `HIGHWAY\s+\d` | Word form | `HIGHWAY 41` |
| `HWY\s+\d` | Abbreviated | `HWY 27` |
| `MILE\s+MARKER` | Full phrase | `MILE MARKER 40` |

### Call Sites

1. **`crashIngestPipeline.ts`** — guards skip-trace at ingest time:
   ```typescript
   const looksLikeHighway = /\b(I-\d|US-\d|SR-\d|CR-\d|FL-\d|MM\s*\d|INTERSTATE|HIGHWAY|HWY)\b/i
     .test(incident.location || "");
   if (batchDataKey && incident.location && !looksLikeHighway) {
     // only skip-trace if address is residential
   }
   ```
   Note: the inline regex in `crashIngestPipeline.ts` is a subset of the function above.
   Future changes should consolidate to the exported function.

2. **`crashReportWorker.ts → enrichCrashLeadContacts()`** — guards FLHSMV driver address:
   ```typescript
   const driverAddress = rawDriverAddress && !looksLikeHighwayAddress(rawDriverAddress)
     ? rawDriverAddress
     : null;
   ```

3. **`crashReportWorker.ts → enrichCrashLeadContacts()`** — guards DHSMV owner address:
   ```typescript
   if (reg.found && reg.ownerAddress && !looksLikeHighwayAddress(reg.ownerAddress)) {
     dhsmvOwnerAddress = reg.ownerAddress;
   }
   ```

---

## The `deriveExportEligible` Function

Export eligibility is computed at every contact write and stored on the record. The full
signature:

```typescript
export function deriveExportEligible(
  firstName:          string | null | undefined,
  phone:              string | null | undefined,
  email:              string | null | undefined,
  leadType:           string | null | undefined,
  override?:          boolean | null,
  addressConfidence?: number | null,
): boolean
```

### Decision Logic (annotated)

```typescript
export function deriveExportEligible(
  firstName, phone, email, leadType, override, addressConfidence
): boolean {
  // Explicit override wins over all computed logic (admin/manual override)
  if (override != null) return override;

  // Entity leads (businesses, recall targets, placeholders) are never export-eligible
  if (ENTITY_LEAD_TYPES.has(leadType ?? "")) return false;

  // Must have a real (non-placeholder) name to be eligible
  if (!firstName || !firstName.trim() || isPlaceholderName(firstName)) return false;

  // Address confidence gate:
  //   - A contact with ONLY an incident location (≤ 0.15) and NO phone/email is blocked.
  //   - A contact with an incident location but a phone IS allowed (phone is the artifact).
  if ((addressConfidence ?? 0) <= ADDRESS_CONFIDENCE.INCIDENT_LOCATION) {
    if (!normalizePhone(phone) && !normalizeEmail(email)) return false;
  }

  // Final gate: must have at least one contactable artifact
  return !!(normalizePhone(phone) || normalizeEmail(email));
}
```

### Export Eligibility Matrix

| `addressConfidence` | Has phone or email | `isPlaceholder` | Export eligible? | Reason |
|---|---|---|---|---|
| 0.0 (unknown) | No | true | No | No identity, no contact |
| 0.15 (incident) | No | true | No | Highway-only, no contact |
| 0.15 (incident) | Yes | true | No | `isPlaceholder=true` hard gate in scorer |
| 0.15 (incident) | Yes | false | Yes | Phone compensates for low address confidence |
| 0.85 (FLHSMV) | No | false | No | No contactable artifact |
| 0.85 (FLHSMV) | Yes | false | Yes | Real address + phone |
| 0.90 (DHSMV) | Yes | false | Yes | High confidence address + phone |
| 0.95 (verified) | Yes | false | Yes | Maximum confidence |

### Where It Is Called

`deriveExportEligible()` is called in two places:

1. **`upsertContact()`** — at insert time to set the initial value.
2. **`mergeContact()`** — recalculated on every update from the final merged state.

```typescript
// Re-derive exportEligible from final merged state
const finalAddrConf = (patch as any).addressConfidence ?? (existing as any).addressConfidence ?? 0;
const derived = deriveExportEligible(
  finalFirstName, finalPhone, finalEmail, finalLeadType, undefined, finalAddrConf
);
if (derived !== existing.exportEligible) patch.exportEligible = derived;
```

---

## Confidence Gates: Exports

### CRM Export Gate

Contacts appear in exports and downstream integrations only when:

1. `exportEligible = true` (derived by `deriveExportEligible()`)
2. `isPlaceholder = false` (hard gate in `computeContactScore()`)
3. `score >= QUALIFY_THRESHOLD` (minimum scoring threshold, typically 40)

A contact that passes the address confidence gate but has `isPlaceholder=true` is still
blocked. Both conditions must pass.

### Skip-Trace Targeting Gate

The retro skip-trace job checks address quality before calling BatchData:

```typescript
function isEligibleContact(contact: any, crashOnly: boolean): boolean {
  // Must have an address to skip-trace against
  if (!contact.address) return false;
  // Must not have already been traced
  if ((contact.tags || []).includes("skip-traced")) return false;
  // Must not already have a phone
  if (contact.phone) return false;
  // ... additional filters
}
```

The critical guard is that `contact.address` must be set. In v2, `contacts.address` is
null for all incident-location-only contacts — so the retro skip-trace automatically skips
them without requiring an explicit `looksLikeHighwayAddress()` check at that stage.

---

## Confidence Gates: Scoring

### Enrichment Quality Sub-Score (25 pts max)

Address confidence drives a proportional score, not a binary present/absent check:

```typescript
const addrConf = c.addressConfidence ?? 0;
if (addrConf >= 0.90) enrichQuality += 8;       // DHSMV registration or verified residence
else if (addrConf >= 0.80) enrichQuality += 6;  // FLHSMV driver license
else if (addrConf >= 0.60) enrichQuality += 4;  // BatchData inferred
else if (addrConf > 0.15)  enrichQuality += 2;  // probable household
else if (addrConf > 0)     enrichQuality += 1;  // incident location — minimal credit
// addrConf === 0.0: +0 points
```

### Residential Intelligence Bonus (10 pts max)

Separate dimension that rewards having progressed through the enrichment chain:

```typescript
let residentialBonus = 0;
if (c.verifiedResidence)    residentialBonus += 5;  // geocode-confirmed
if (c.registrationAddress)  residentialBonus += 3;  // government registration
if (c.incidentFingerprint)  residentialBonus += 2;  // linked to official report
breakdown.residential_intelligence = Math.min(residentialBonus, 10);
```

### Points Earned by Address Tier (address intelligence total)

| Confidence Tier | `enrichment_quality` address points | Max `residential_intelligence` | Total address-related max |
|---|---|---|---|
| 0.0 (unknown) | 0 | 2 (fingerprint only) | 2 |
| 0.15 (incident) | 1 | 2 (fingerprint only) | 3 |
| 0.61 (probable) | 2 | 5 (fingerprint + partial) | 7 |
| 0.72 (BatchData) | 4 | 7 (all fields possible) | 11 |
| 0.85 (FLHSMV) | 6 | 10 (all fields) | 16 |
| 0.90 (DHSMV) | 8 | 10 (all fields) | 18 |
| 0.95 (verified) | 8 (+7 geocode bonus) | 10 (all fields) | 25 |

---

## How to Upgrade Confidence

This section documents what system action triggers each confidence level upgrade.

### Upgrade to 0.15 (INCIDENT_LOCATION)

**Triggered by:** FHP HSMV CAD ingest in `crashIngestPipeline.ts`.

```typescript
await upsertContact({
  incidentLocation:  incident.location,
  incidentLat:       incident.lat ?? null,
  incidentLng:       incident.lng ?? null,
  addressType:       "incident_location",
  addressConfidence: 0.15,
  addressSource:     "fhp_cad",
});
```

This is the birth state. Every crash contact starts here.

### Upgrade to 0.85 (FLHSMV_LICENSE)

**Triggered by:** FLHSMV crash report retrieval in `enrichCrashLeadContacts()`.

Requirements:
- `crashReportWorker` successfully fetches the official report
- `driver.Address` is non-null and non-empty
- `looksLikeHighwayAddress(driver.Address)` returns `false`

```typescript
// In enrichCrashLeadContacts():
const bestAddressConf = driverAddress ? ADDRESS_CONFIDENCE.FLHSMV_LICENSE : ADDRESS_CONFIDENCE.UNKNOWN;

await upsertContact({
  address:           driverAddress,
  addressConfidence: ADDRESS_CONFIDENCE.FLHSMV_LICENSE,  // 0.85
  addressType:       "registration",
  addressSource:     "flhsmv",
  registrationAddress:       driverAddress,
  registrationAddressSource: "flhsmv_report",
});
```

### Upgrade to 0.90 (DHSMV_REGISTRATION)

**Triggered by:** DHSMV plate lookup in `enrichCrashLeadContacts()`.

Requirements:
- Crash report contains `vehicle.TagNumber`
- `lookupRegistration()` returns `found=true`
- `reg.ownerAddress` is non-null and `looksLikeHighwayAddress()` returns `false`
- `isNimbleConfigured()` returns `true`

```typescript
// In enrichCrashLeadContacts():
const reg = await lookupRegistration(plateNumber, vehicle?.TagState ?? "FL");
if (reg.found && reg.ownerAddress && !looksLikeHighwayAddress(reg.ownerAddress)) {
  dhsmvOwnerAddress = reg.ownerAddress;
}
// ...
const bestAddressConf = dhsmvOwnerAddress
  ? ADDRESS_CONFIDENCE.DHSMV_REGISTRATION  // 0.90
  : ADDRESS_CONFIDENCE.FLHSMV_LICENSE;     // 0.85 fallback
```

### Upgrade to 0.72 (BATCHDATA_INFERRED)

**Triggered by:** BatchData skip-trace match in `retroSkipTrace.ts`.

Requirements:
- `contact.address` is set (not null) and is residential
- `isBatchDataDisabled()` returns `false`
- BatchData API returns at least one person match

Note: this upgrade only applies when BatchData returns a _new_ address. If the returned
mailing address matches the existing DHSMV registration address (confidence 0.90),
`mergeContact()` will not downgrade from 0.90 to 0.72.

### Upgrade to 0.95 (VERIFIED_RESIDENCE)

**Triggered by:** Geocoding API confirmation of a residential address.

Requirements:
- A candidate address exists in `contacts.address` at confidence >= 0.61
- Geocoding API returns a match with `locationType=ROOFTOP` or `RANGE_INTERPOLATED`
- The geocoded coordinates fall within Florida bounds (lat 24.4–31.1, lng -87.6 to -80.0)

```typescript
// After geocode confirmation:
await upsertContact({
  verifiedResidence: geocodedAddress,
  geocodeStatus:     "verified",
  addressType:       "verified_residence",
  addressConfidence: ADDRESS_CONFIDENCE.VERIFIED_RESIDENCE,  // 0.95
  addressSource:     "google_geocode",
  lat:               geocodeLat,
  lng:               geocodeLng,
});
```

---

## Operational Implications

### Skip-Trace Efficiency

Before the victim-centric architecture, roughly 40% of BatchData calls were against highway
references that returned `no_match` immediately. With `looksLikeHighwayAddress()` guarding
every call site and `contacts.address` being null for incident-only contacts, the retro
skip-trace job automatically skips all FHP CAD-origin contacts until they have been upgraded
to at least FLHSMV or DHSMV quality.

Effective skip-trace eligibility now requires:
- `contacts.address` is set (non-null)
- Contact is not already tagged `skip-traced`
- Contact does not already have a phone

### Export Volume

Contacts with only incident-location data (confidence 0.15) and no phone are excluded from
exports. This reduces "noise" leads delivered to attorneys. The expectation is that export
volume from crash contacts is lower in v2 but lead quality is meaningfully higher.

### CRM View Filtering

The `isPlaceholder` boolean column supports a fast index-based filter:

```sql
-- All non-placeholder contacts for an account:
SELECT * FROM contacts
WHERE sub_account_id = $1
  AND is_placeholder = false;

-- Contacts with residential intelligence:
SELECT * FROM contacts
WHERE sub_account_id = $1
  AND address_confidence >= 0.85;

-- Contacts at incident-only stage (not yet enriched):
SELECT * FROM contacts
WHERE sub_account_id = $1
  AND address_type = 'incident_location';
```

### Monitoring Address Confidence Distribution

A healthy pipeline should show a distribution moving toward higher confidence tiers over
time. A stuck distribution (all contacts at 0.15) indicates FLHSMV enrichment is failing.

```sql
SELECT
  address_type,
  address_confidence,
  COUNT(*) as contact_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as pct
FROM contacts
WHERE sub_account_id = $1
  AND source = 'sentinel_crash'
GROUP BY address_type, address_confidence
ORDER BY address_confidence DESC;
```

Expected steady-state distribution for a healthy crash pipeline (accounts processing
FLHSMV data):
- 0.90+ (DHSMV/verified): 30–50% of enriched contacts
- 0.85 (FLHSMV license): 20–35%
- 0.72 (BatchData): 10–20%
- 0.15 (incident only): 5–15% (new arrivals awaiting enrichment)
- 0.0 (unknown): < 5% (transient state only)

---

## Monitoring and Alerting

### Log Signals

Key log lines to monitor for address confidence health:

```
[CRASH-WORKER] DHSMV plate lookup: plate=ABC1234 owner=JOHN SMITH addr=4521 SW 25th Ave...
# Indicates: DHSMV enrichment working, confidence will reach 0.90

[CRASH-WORKER] enrichCrashLeadContacts: upsert failed for contact 12345: ...
# Indicates: FLHSMV enrichment failing, contacts stuck at 0.15

[DHSMV-REG] Nimble not configured — NIMBLE_API_USERNAME/PASSWORD missing
# Indicates: DHSMV lookups disabled, max reachable confidence is 0.85

[SKIP-TRACE] ⛔ Circuit breaker OPEN — BatchData calls suspended.
# Indicates: BatchData disabled, skip-trace upgrades (0.72) not running
```

### Environment Variable Kill Switches

| Variable | Effect on Confidence |
|---|---|
| `BATCHDATA_DISABLED=true` | Prevents 0.72 upgrades; contacts plateau at 0.85/0.90 |
| `NIMBLE_API_USERNAME` missing | Prevents 0.90 upgrades; contacts plateau at 0.85 |
| `SCRAPINGBEE_API_KEY` missing | FLHSMV direct fetch (may be blocked); 0.85/0.90 upgrades at risk |
| `BATCHDATA_API_KEY` missing | Same as `BATCHDATA_DISABLED=true` |

### Circuit Breaker State

The BatchData circuit breaker in `skip-trace.ts` trips automatically on HTTP 402/403 (quota
errors) and blocks all BatchData calls until the process restarts:

```typescript
export function isBatchDataDisabled(): boolean {
  if (process.env.BATCHDATA_DISABLED === "true") return true;
  return _circuitOpen;
}
```

When the circuit is open, `disabledResult()` is returned immediately with
`raw.disabled=true` and `raw.reason="circuit_breaker_open"`. Contacts in the retro
skip-trace queue are not skipped permanently — they will be re-attempted on the next
restart when the circuit resets.
