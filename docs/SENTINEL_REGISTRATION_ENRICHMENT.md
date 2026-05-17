# Sentinel: Registration & Enrichment Pipeline

**Document version:** 1.0  
**System:** Apex Marketing OS — Sentinel Crash Lead Ingestion  
**Relevant modules:** `crashReportWorker.ts`, `dhsmvRegistrationLookup.ts`, `contactUpsertService.ts`

---

## Table of Contents

1. [Overview](#overview)
2. [Enrichment Flow — Sequence Diagram](#enrichment-flow--sequence-diagram)
3. [Data Sources: FLHSMV vs. DHSMV](#data-sources-flhsmv-vs-dhsmv)
4. [Plate Extraction](#plate-extraction)
5. [Address Priority Logic](#address-priority-logic)
6. [Field Mapping Table](#field-mapping-table)
7. [Tag Taxonomy](#tag-taxonomy)
8. [Confidence Assignment](#confidence-assignment)
9. [Idempotency Guarantees](#idempotency-guarantees)
10. [DHSMV Lookup Failure Handling](#dhsmv-lookup-failure-handling)

---

## Overview

After `crashIngestPipeline.ts` writes the initial stub contact records for a crash incident, `crashReportWorker.ts` drives the enrichment phase. The worker fetches the official FLHSMV crash report for each `sentinelReportNumber`, extracts all license plates found in the report, and attempts a DHSMV vehicle-registration lookup for each plate. The two data sources complement each other: FLHSMV supplies driver identity from the license record; DHSMV supplies owner identity from the vehicle registration record. When both are present, DHSMV wins on address because registration addresses carry higher confidence than driver-license addresses.

Enrichment is **non-destructive and idempotent**: contacts already tagged `flhsmv-enriched` are skipped entirely, and field updates only proceed when the incoming data carries higher `addressConfidence` than what is already stored.

---

## Enrichment Flow — Sequence Diagram

```
crashReportWorker.ts                  FLHSMV API                   DHSMV MVCheck (Nimble)
        |                                  |                                |
        |--- fetchOfficialReport(reportNo) -->                              |
        |<-- { drivers[], vehicles[] } ---                                  |
        |                                  |                                |
        |  for each driver record:         |                                |
        |    extractPlates(driver)         |                                |
        |    → [ "FL-ABC123", ... ]        |                                |
        |                                  |                                |
        |  for each plate:                 |                                |
        |--- lookupRegistration(plate) ---------------------------------------->
        |<-- { ownerName, ownerAddress } / null / error ---------------------
        |                                  |                                |
        |  buildContactPayload(            |                                |
        |    driver,      ← FLHSMV        |                                |
        |    registration ← DHSMV or null |                                |
        |  )                              |                                |
        |                                  |                                |
        |--- mergeContact(payload) ------> contactUpsertService.ts         |
        |<-- upsertResult                  |                                |
        |                                  |                                |
        |  applyEnrichmentTags(contact)    |                                |
        |  setWorkflowStage('enriching')   |                                |
        |  setIsPlaceholder(false)         |                                |
```

---

## Data Sources: FLHSMV vs. DHSMV

### Florida Highway Safety and Motor Vehicles (FLHSMV) — Crash Report

The FLHSMV crash report is the **authoritative incident record** generated from the FHP CAD signal. It is fetched once per `sentinelReportNumber` and contains structured driver and vehicle sections.

| Attribute | FLHSMV Field | Notes |
|-----------|-------------|-------|
| Person name | `driver.Name` | Format: `LAST, FIRST` — must be parsed and reordered |
| Address | `driver.Address` | Driver's **license** address; may lag actual residence |
| Address confidence | `0.85` (fixed) | License addresses are reliable but not always current |
| Address type | `'registration'` (license) | Stored as `addressType='registration'` at this stage |

**Name parsing:** `driver.Name` arrives as `"DOE, JOHN EDWARD"`. The enrichment layer splits on the first comma, trims, and reconstructs `firstName = "JOHN EDWARD"`, `lastName = "DOE"` before writing to the contact record.

### Department of Highway Safety and Motor Vehicles (DHSMV) — Vehicle Registration

The DHSMV MVCheck portal is queried **per plate** via the Nimble pipeline fetch mechanism in `dhsmvRegistrationLookup.ts`. This lookup returns the **registered owner** of the vehicle, which may differ from the driver listed in the crash report.

| Attribute | DHSMV Field | Notes |
|-----------|-------------|-------|
| Owner name | `ownerName` | Full name as registered; format varies |
| Owner address | `ownerAddress` | **Registration** address; legally required to be current |
| Address confidence | `0.90` (fixed) | Higher than license address — owners must update within 30 days of move |
| Address type | `'registration'` | Upgrades to `'verified_residence'` after skip-trace confirmation |

**Key distinction:** A driver involved in a crash may be operating a vehicle they do not own. The DHSMV record identifies the **owner**, who is typically the insured party and the primary outreach target for personal-injury law firms.

### Source Comparison

| Dimension | FLHSMV (Driver License) | DHSMV (Registration) |
|-----------|------------------------|----------------------|
| Identity source | State driver license record | Vehicle registration record |
| Address currency | Updated at license renewal (4–8 yr cycle) | Updated within 30 days of move (statutory) |
| Confidence | 0.85 | 0.90 |
| Nimble fetch required | No — REST API | Yes — MVCheck portal scrape |
| Available when | Always (crash report present) | Only when plate is extracted and lookup succeeds |
| Name format | `LAST, FIRST` | Varies |

---

## Plate Extraction

`crashReportWorker.ts` scans each `driver` and `vehicle` entry in the FLHSMV crash report for license plate data. Extraction logic:

1. **Primary field:** `vehicle.licensePlate` — structured field, preferred.
2. **Fallback field:** `vehicle.plateNumber` — unstructured string, may contain state prefix.
3. **Normalization:** Plates are normalized to the format `FL-XXXXXX` (uppercase, hyphen after state code). Non-FL plates are retained with their state prefix (e.g., `GA-XXXXX`) and still attempted against DHSMV, though hit rate is lower for out-of-state registrations.
4. **Deduplication:** If the same plate appears on multiple vehicle records within one report (e.g., data entry error), it is deduplicated before lookup.
5. **Invalid plate filter:** Plates matching `/^(EXEMPT|DIPLOMAT|TEST|NONE)$/i` are discarded without lookup attempt.

---

## Address Priority Logic

When both FLHSMV and DHSMV data are available, a deterministic priority rule resolves which address is written to the contact:

```
if (dhsmvRegistration?.ownerAddress) {
  // DHSMV wins — higher confidence
  contact.registrationAddress   = dhsmvRegistration.ownerAddress;
  contact.address               = dhsmvRegistration.ownerAddress;
  contact.addressConfidence     = 0.90;
  contact.addressType           = 'registration';
  contact.addressSource         = 'dhsmv';
  contact.registrationAddressSource = 'dhsmv';
} else if (flhsmvDriver?.address) {
  // FLHSMV fallback
  contact.registrationAddress   = flhsmvDriver.address;
  contact.address               = flhsmvDriver.address;
  contact.addressConfidence     = 0.85;
  contact.addressType           = 'registration';
  contact.addressSource         = 'flhsmv';
  contact.registrationAddressSource = 'flhsmv';
}
// If neither: address remains null, addressConfidence = 0.0
```

**Progressive address upgrade path:**

```
null (stub)
  → FLHSMV driver license address (confidence 0.85, source: flhsmv)
    → DHSMV registration address (confidence 0.90, source: dhsmv)       ← wins over FLHSMV
      → Skip-trace verified address (confidence 0.95+, source: skip-trace)
        → Geocoded/confirmed (confidence 1.0, type: verified_residence)
```

The `mergeContact()` function in `contactUpsertService.ts` enforces this upgrade path: it only overwrites `address` when the incoming `addressConfidence` is strictly greater than the stored value. DHSMV data (0.90) always beats stored FLHSMV data (0.85). Skip-trace data (0.95+) always beats DHSMV.

---

## Field Mapping Table

| Contact Field | Source | Value / Logic | Confidence |
|--------------|--------|---------------|------------|
| `firstName` | FLHSMV `driver.Name` | Parsed from `LAST, FIRST` format | — |
| `lastName` | FLHSMV `driver.Name` | Parsed from `LAST, FIRST` format | — |
| `address` | DHSMV (preferred) / FLHSMV | Best available per priority rule | 0.90 / 0.85 |
| `registrationAddress` | DHSMV (preferred) / FLHSMV | Same as `address` at enrichment time | 0.90 / 0.85 |
| `addressConfidence` | Derived | 0.90 (DHSMV), 0.85 (FLHSMV), 0.0 (none) | — |
| `addressType` | Derived | `'registration'` after enrichment | — |
| `addressSource` | Derived | `'dhsmv'` or `'flhsmv'` | — |
| `registrationAddressSource` | Derived | `'dhsmv'` or `'flhsmv'` | — |
| `isPlaceholder` | Set by worker | `false` (cleared on enrichment) | — |
| `viewClass` | Set by worker | `'incident_subject'` | — |
| `workflowStage` | Set by worker | `'enriching'` | — |
| `incidentFingerprint` | Derived | `SHA256("crash:" + sentinelReportNumber)` | — |
| `sourceExternalId` | Derived | `"crash:{reportNumber}:acct{accountId}"` | — |
| `enrichmentTags` | Accumulated | See Tag Taxonomy section | — |

---

## Tag Taxonomy

Tags are additive and permanent — they form an audit trail. The enrichment worker applies the following tags:

| Tag | Applied when | Meaning |
|-----|-------------|---------|
| `crash-lead` | Ingest | Contact originated from a crash report |
| `sentinel-auto` | Ingest | Contact was created by the Sentinel automation |
| `flhsmv-enriched` | After FLHSMV report parsed | FLHSMV driver data has been applied |
| `plate:FL-XXXXX` | Per plate extracted | Specific plate associated with this contact; one tag per plate |
| `dhsmv-enriched` | After successful DHSMV lookup | DHSMV registration data has been applied |
| `has-phone` | After phone found | Contact has at least one verified phone number |
| `skip-traced` | After skip-trace pass | Skip-trace service was run on this contact |

**Tag format for plates:** The literal plate number is embedded in the tag, e.g., `plate:FL-ABC123`. This allows downstream queries to group all contacts from the same vehicle across multiple crashes.

---

## Confidence Assignment

Confidence values are fixed per source tier and reflect the statutory currency requirements of each record type:

| Source | Fixed Confidence | Rationale |
|--------|-----------------|-----------|
| No address (stub/roadway) | `0.00–0.15` | Placeholder or highway intersection string only |
| FLHSMV driver license | `0.85` | License address updated at renewal; may be 4–8 years stale |
| DHSMV registration | `0.90` | Florida Statute §320.02 requires address update within 30 days of move |
| Skip-trace result | `0.95` (typical) | Commercial skip-trace with proprietary verification layer |
| Geocoded + confirmed | `1.00` | Address confirmed via field visit or postal delivery confirmation |

These fixed values feed directly into `scoringWorker.ts`'s `enrichment_quality` dimension and the `deriveExportEligible()` gate in `contactUpsertService.ts`.

---

## Idempotency Guarantees

The enrichment pipeline is safe to re-run on the same contact without producing duplicate writes or tag accumulation:

1. **Pre-flight tag check:** Before processing any contact, the worker checks for the `flhsmv-enriched` tag. If present, the contact is skipped entirely (`continue` in the loop). This is the primary idempotency guard.

2. **Confidence-gated merge:** `mergeContact()` compares incoming `addressConfidence` against the stored value. If the stored value is equal or higher, the address fields are not overwritten.

3. **Tag deduplication:** The tag system uses a `Set`-based accumulator. Applying `flhsmv-enriched` to a contact that already has it is a no-op.

4. **Plate deduplication:** Extracted plates are deduplicated before lookup, preventing redundant DHSMV calls within a single enrichment run.

5. **`incidentFingerprint` stability:** The fingerprint is computed deterministically from `sentinelReportNumber` and never changes between runs. Contacts with the same fingerprint can always be regrouped by incident without ambiguity.

---

## DHSMV Lookup Failure Handling

`dhsmvRegistrationLookup.ts` makes a best-effort lookup via the Nimble pipeline. The following failure modes are handled:

| Failure Mode | Behavior | Contact State |
|-------------|----------|---------------|
| Network timeout / Nimble unavailable | Logged as warning; lookup skipped for this plate | Falls back to FLHSMV address only |
| Plate not found in DHSMV | Returns `null`; no error thrown | Falls back to FLHSMV address only |
| Out-of-state plate (no FL record) | Returns `null` | Falls back to FLHSMV address only |
| DHSMV rate-limit / portal blocked | Nimble handles retry internally; if exhausted, returns `null` | Falls back to FLHSMV address only |
| Malformed response from portal | Parse error caught; returns `null` with error log | Falls back to FLHSMV address only |

**In all failure cases:**
- The contact is still tagged `flhsmv-enriched` (FLHSMV data was applied).
- The `dhsmv-enriched` tag is **not** applied.
- `addressSource` is set to `'flhsmv'`, `addressConfidence` to `0.85`.
- The contact remains eligible for a future DHSMV retry if the worker is re-run before `flhsmv-enriched` would cause a skip — note that because `flhsmv-enriched` is the idempotency guard, a manual tag removal is required to trigger re-enrichment for a specific contact.

**Operational note:** If DHSMV success rate drops below expected levels, check Nimble pipeline health and MVCheck portal availability. The `dhsmv-enriched` tag rate relative to `flhsmv-enriched` tag rate is the primary signal for DHSMV enrichment quality monitoring.
