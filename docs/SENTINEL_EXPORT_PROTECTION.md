# Sentinel: Export Protection & Score Band System

**Document version:** 1.0  
**System:** Apex Marketing OS — Sentinel Crash Lead Ingestion  
**Relevant modules:** `contactUpsertService.ts` (`deriveExportEligible()`), `scoringWorker.ts` (v2.0)

---

## Table of Contents

1. [Overview](#overview)
2. [Export Eligibility Rules](#export-eligibility-rules)
3. [Score Band System](#score-band-system)
4. [Score Band Interpretation for Exports](#score-band-interpretation-for-exports)
5. [Scoring Dimensions (v2.0)](#scoring-dimensions-v20)
6. [D-Band vs. A-Band Contact: Concrete Examples](#d-band-vs-a-band-contact-concrete-examples)
7. [Confidence Gates](#confidence-gates)
8. [How FLHSMV Enrichment Elevates a Contact](#how-flhsmv-enrichment-elevates-a-contact)
9. [What Gets Blocked and Why](#what-gets-blocked-and-why)
10. [Migration: Backfilled Roadway Contacts](#migration-backfilled-roadway-contacts)
11. [Operational Checklist: Verifying Export Quality](#operational-checklist-verifying-export-quality)

---

## Overview

The Sentinel export protection layer exists to prevent low-quality, unactionable, or legally ambiguous contacts from reaching downstream attorney intake systems, CRMs, and outreach workflows. Two mechanisms work in tandem:

1. **`deriveExportEligible()`** — a hard gate in `contactUpsertService.ts` that enforces mandatory field requirements. No contact passes this gate without meeting every criterion simultaneously.
2. **`scoringWorker.ts` v2.0** — a composite scoring engine that quantifies contact quality on a 0–100 scale and enforces a minimum threshold (`QUALIFY_THRESHOLD = 55`). Contacts below this threshold are flagged `isPlaceholder=true` and withheld from routing and exports regardless of their field completeness.

Together, these layers ensure that only **real, reachable, addressable people with a verified connection to the crash incident** are delivered to law firm clients.

---

## Export Eligibility Rules

`deriveExportEligible()` accepts six parameters and returns a boolean. All conditions must be true simultaneously — these are AND conditions, not OR.

```typescript
function deriveExportEligible(
  name:              string | null,    // param 1
  phone:             string | null,    // param 2
  email:             string | null,    // param 3
  isPlaceholder:     boolean,          // param 4
  score:             number,           // param 5
  addressConfidence: number            // param 6  ← added in v2.0
): boolean
```

### Gate Conditions

| Condition | Rule | Blocks When |
|-----------|------|-------------|
| Real name | `name` is non-null and not a placeholder string | Name is null, `"UNKNOWN"`, `"N/A"`, or empty |
| Reachability | `phone !== null OR email !== null` | Neither phone nor email is available |
| Address confidence | `addressConfidence > 0.15` | Address is a roadway string, null, or below minimum confidence |
| Not a placeholder | `isPlaceholder === false` | `scoringWorker.ts` qualify gate set `isPlaceholder=true` |
| Minimum score | `score >= QUALIFY_THRESHOLD (55)` | Contact scored below Band B |

**All five conditions must pass.** A contact with a valid phone number, real name, and score of 80 is still blocked if `addressConfidence <= 0.15`. A contact with a DHSMV address and score of 60 is still blocked if `isPlaceholder=true` (set by the scoring qualify gate).

---

## Score Band System

`scoringWorker.ts` v2.0 computes a composite 0–100 score for each contact. Contacts are then assigned to a band:

| Band | Score Range | Label | Export Status |
|------|-------------|-------|---------------|
| A+ | 90–100 | Immediately actionable | Export eligible |
| A | 75–89 | Strong | Export eligible |
| B | 55–74 | Moderate | Export eligible |
| C | 35–54 | Weak | NOT export eligible |
| D | 0–34 | Roadway placeholder | NOT export eligible |

`QUALIFY_THRESHOLD = 55` is the boundary between Band B and Band C. Contacts at exactly 55 qualify (Band B minimum). Contacts at 54 do not (Band C maximum).

Contacts scoring below 55 have `isPlaceholder` set to `true` by the scoring qualify gate. This flag persists until the contact is re-scored after additional enrichment. A re-score that produces a result >= 55 clears `isPlaceholder=false` and the contact becomes routing-eligible.

---

## Score Band Interpretation for Exports

### Band A+ (90–100): Immediately Actionable

Contact has a verified residential address (confirmed or skip-traced), at least one working phone number, a confirmed connection to the incident via `incidentFingerprint`, and all identity fields populated. This contact is ready for immediate attorney outreach with no additional validation steps required.

**Typical profile:** Named driver or passenger with DHSMV registration address, skip-traced phone, `addressConfidence >= 0.95`, `addressType = 'verified_residence'`.

### Band A (75–89): Strong

Contact has high-confidence address data and at least phone or email. May lack a secondary contact channel or skip-trace confirmation. Suitable for export and outreach; attorney intake team may want to attempt a quick address verification call before filing.

**Typical profile:** Named contact with DHSMV registration address (`addressConfidence = 0.90`), has phone, not yet skip-traced.

### Band B (55–74): Moderate

Contact has sufficient data for export but carries some uncertainty. Address may be FLHSMV license address only (`addressConfidence = 0.85`) without DHSMV confirmation. Phone or email present. Incident connection established via fingerprint.

**Typical profile:** Named contact with FLHSMV address only, has phone, `incidentFingerprint` confirmed. DHSMV lookup failed or plate not found.

### Band C (35–54): Weak — Blocked

Contact has partial data that is insufficient for reliable outreach. Typical issues: address missing or below threshold, name incomplete, no contact channel. Not exported. May be re-scored after additional enrichment.

### Band D (0–34): Roadway Placeholder — Blocked

Contact was created from a crash record but could not be associated with a real person at an actionable address. The `address` field contains only a highway intersection string or is null. `addressConfidence <= 0.15`. These contacts represent the crash scene location, not an enriched individual.

---

## Scoring Dimensions (v2.0)

`scoringWorker.ts` v2.0 replaces the legacy non-null address check with confidence-tiered scoring across all dimensions.

### `enrichment_quality` (replaces non-null address check)

This dimension now evaluates `addressConfidence` against explicit tiers rather than simply checking if an address field is populated:

| Address State | addressConfidence | Points Awarded |
|--------------|-------------------|----------------|
| No address / roadway string | 0.00–0.15 | 0 |
| FLHSMV license address | 0.85 | Partial credit |
| DHSMV registration address | 0.90 | Higher credit |
| Skip-traced address | 0.95+ | Full credit |
| Geocoded/confirmed | 1.00 | Maximum credit |

A contact with `address = "I-95 NB MM 142"` and `addressConfidence = 0.15` scored the same as a contact with a real address under v1.0. Under v2.0, the roadway contact earns 0 points for this dimension.

### `residential_intelligence` (new in v2.0, max 10 points)

This bonus dimension rewards contacts with verified residential signals beyond the raw address field:

| Signal | Points | Condition |
|--------|--------|-----------|
| Verified residence | +5 | `addressType = 'verified_residence'` |
| Registration address | +3 | `registrationAddress` is populated (FLHSMV or DHSMV) |
| Incident fingerprint | +2 | `incidentFingerprint` is set and valid |

Maximum: 10 points. These points are additive. A contact with a verified residence, a populated registration address, and an incident fingerprint earns all 10 points.

---

## D-Band vs. A-Band Contact: Concrete Examples

### D-Band Contact (Score: 18)

```
firstName:            null
lastName:             null
address:              "I-95 NORTHBOUND MM 142 NEAR BOCA RATON"
registrationAddress:  null
addressConfidence:    0.15
addressType:          'unknown'
addressSource:        null
isPlaceholder:        true
phone:                null
email:                null
workflowStage:        'scored'
enrichmentTags:       ['crash-lead', 'sentinel-auto']
incidentFingerprint:  "a3f9..." (set)
scoreBand:            'D'
exportEligible:       false
```

**Why blocked:** No name, no phone, no email, `addressConfidence = 0.15`, `isPlaceholder = true`. Fails every gate condition. The address field contains the crash scene roadway string, which the migration backfill moved to `incidentLocation` — the `address` field is effectively null in practice.

### A-Band Contact (Score: 84)

```
firstName:            "JOHN"
lastName:             "DOE"
address:              "1234 PALM AVE, BOCA RATON FL 33432"
registrationAddress:  "1234 PALM AVE, BOCA RATON FL 33432"
addressConfidence:    0.90
addressType:          'registration'
addressSource:        'dhsmv'
registrationAddressSource: 'dhsmv'
isPlaceholder:        false
phone:                "+15615551234"
email:                null
workflowStage:        'routed'
enrichmentTags:       ['crash-lead', 'sentinel-auto', 'flhsmv-enriched',
                       'plate:FL-ABC123', 'dhsmv-enriched', 'has-phone']
incidentFingerprint:  "a3f9..." (set)
scoreBand:            'A'
exportEligible:       true
```

**Why eligible:** Real name, has phone, `addressConfidence = 0.90 > 0.15`, `isPlaceholder = false`, `score = 84 >= 55`. Passes every gate condition.

---

## Confidence Gates

The `addressConfidence` value is used as a gate at two distinct checkpoints:

### Gate 1: `deriveExportEligible()` — Hard Export Block

```
addressConfidence <= 0.15  →  exportEligible = false  (regardless of score or other fields)
addressConfidence >  0.15  →  confidence gate passes; other conditions still evaluated
```

The `0.15` threshold was chosen to match the `addressConfidence` value assigned during the migration backfill to roadway-placeholder contacts. Any contact at exactly `0.15` is a known-placeholder. Any contact above `0.15` has received at least some enrichment signal.

### Gate 2: `scoringWorker.ts` `enrichment_quality` dimension

`addressConfidence` feeds into the scoring formula with tiered point values. A contact at `0.85` (FLHSMV) scores meaningfully higher than one at `0.15`, pushing it from D-band into B-band territory when combined with other positive signals.

### Gate 3: `isPlaceholder` flag — Total Export Block

`isPlaceholder = true` is a binary override that blocks export eligibility entirely. It is set by:
- `crashIngestPipeline.ts` at stub creation (all new contacts start as placeholders).
- `scoringWorker.ts` qualify gate: contacts scoring below 55 have `isPlaceholder` re-set to `true`.

`isPlaceholder` is cleared to `false` by `crashReportWorker.ts` during enrichment. If a contact passes through enrichment (i.e., has `flhsmv-enriched` tag and real name/address), it enters scoring as `isPlaceholder=false`. Scoring may re-set it to `true` if the score is too low.

---

## How FLHSMV Enrichment Elevates a Contact

A contact begins in D-band. FLHSMV enrichment alone is sufficient to push it to B-band in most cases:

```
Before FLHSMV enrichment:
  name: null
  address: null (or roadway string from migration)
  addressConfidence: 0.00–0.15
  isPlaceholder: true
  score: ~15–25  →  Band D
  exportEligible: false

After FLHSMV enrichment (name + license address applied):
  name: "JOHN DOE"
  address: "1234 PALM AVE, BOCA RATON FL 33432"
  addressConfidence: 0.85
  isPlaceholder: false
  score: ~58–70  →  Band B (assuming phone found or other positive signals)
  exportEligible: true (if phone also present)
```

**What FLHSMV adds to the score:**
- `enrichment_quality`: Jumps from 0 to partial credit (address at 0.85).
- `residential_intelligence`: +3 for `registrationAddress` populated, +2 for `incidentFingerprint` = +5 bonus points.
- Name completeness: Adds to identity dimension.
- `isPlaceholder = false`: Removes the scoring disqualification.

**What can keep a post-FLHSMV contact out of Band B:**
- No phone and no email → fails the `deriveExportEligible()` reachability gate even at score 60.
- Score below 55 due to missing secondary signals → scoring qualify gate re-sets `isPlaceholder=true`.
- DHSMV lookup failed and skip-trace not yet run → stuck at `addressConfidence=0.85`, eligible but not at maximum quality.

---

## What Gets Blocked and Why

| Contact Type | Blocked? | Primary Reason | Resolution Path |
|-------------|----------|----------------|----------------|
| Fresh stub, no enrichment | Yes | `isPlaceholder=true`, no name, no address | Run enrichment worker |
| Roadway placeholder (post-migration) | Yes | `addressConfidence=0.15`, `isPlaceholder=true` | Requires FLHSMV match |
| FLHSMV-enriched, no phone/email | Yes | Fails reachability gate | Run skip-trace to find phone |
| FLHSMV-enriched, score=48 (Band C) | Yes | Below `QUALIFY_THRESHOLD=55` | Additional enrichment to raise score |
| DHSMV-enriched, score=80, `isPlaceholder=true` | Yes | Scoring qualify gate override | Investigate why score reported < 55 at qualify time; re-score |
| Valid contact, `addressConfidence=0.14` | Yes | Confidence gate in `deriveExportEligible()` | This should not occur post-migration; investigate data integrity |
| Named contact, phone present, score=55, `addressConfidence=0.90` | No | All gates pass | Eligible for export |

---

## Migration: Backfilled Roadway Contacts

A one-time migration was run to correct pre-v2.0 contacts that had highway intersection strings stored in the `address` field.

**Before migration:**
```
address:           "SR-80 WB AT PALM BEACH BLVD"  ← roadway string in address
addressConfidence: null
```

**After migration:**
```
address:              null  ← cleared
incidentLocation:     "SR-80 WB AT PALM BEACH BLVD"  ← moved to correct field
addressConfidence:    0.15  ← sentinel value marking known-placeholder
isPlaceholder:        true  ← scoring gate will block export
```

**Why `addressConfidence = 0.15` and not `0.00`?**

`0.15` is a deliberate sentinel value that distinguishes "migrated roadway placeholder" from "brand new stub with no data at all" (`0.00`). This allows analytics queries to separately count:
- Contacts that were never enriched (`addressConfidence = 0.00`)
- Contacts that were identified as roadway placeholders during migration (`addressConfidence = 0.15`)
- Contacts with real enrichment data (`addressConfidence >= 0.85`)

The `deriveExportEligible()` gate blocks both `0.00` and `0.15` with the same `<= 0.15` condition.

---

## Operational Checklist: Verifying Export Quality

Use this checklist before enabling a new export destination or after a pipeline incident.

### Pre-Export Verification

- [ ] **Confirm `QUALIFY_THRESHOLD` is set to 55** in `scoringWorker.ts` configuration. A misconfigured threshold is the most common source of low-quality exports.
- [ ] **Verify `deriveExportEligible()` signature** includes the `addressConfidence` parameter as the 6th argument in all call sites. A call site missing this parameter passes `undefined`, which evaluates as `0` — all contacts would pass the confidence gate incorrectly.
- [ ] **Check that the migration was applied** to the target environment. Query: `SELECT COUNT(*) FROM contacts WHERE address LIKE '%NORTHBOUND%' OR address LIKE '%SOUTHBOUND%' OR address LIKE '%MM %'`. Count should be 0 in a correctly migrated dataset.

### Spot-Check Export Queue

- [ ] **Sample 10 contacts from the export queue** and verify each has:
  - Non-null, non-placeholder `firstName` + `lastName`
  - At least one of: `phone`, `email`
  - `addressConfidence > 0.15`
  - `isPlaceholder = false`
  - `score >= 55`
  - `enrichmentTags` includes `flhsmv-enriched`
- [ ] **Verify no D-band contacts are in the export queue.** Query: `SELECT COUNT(*) FROM contacts WHERE scoreBand='D' AND exportEligible=true`. Count must be 0.
- [ ] **Verify no contacts with `isPlaceholder=true` are in the export queue.** Query: `SELECT COUNT(*) FROM contacts WHERE isPlaceholder=true AND exportEligible=true`. Count must be 0.

### Tag Rate Health Checks

- [ ] **DHSMV enrichment rate:** `COUNT(has: dhsmv-enriched) / COUNT(has: flhsmv-enriched)` should be > 60% under normal conditions. Drop below 50% indicates DHSMV/Nimble pipeline degradation.
- [ ] **Skip-trace phone rate:** `COUNT(has: has-phone) / COUNT(has: flhsmv-enriched)` should be > 40% after skip-trace pass completes.
- [ ] **B-band or higher rate:** `COUNT(scoreBand IN ('A+','A','B')) / COUNT(has: flhsmv-enriched)` should be > 70% for a healthy enrichment cycle.

### Score Distribution Sanity Check

After any scoring worker change, run the score distribution query and compare against baseline:

| Band | Expected Share | Alert If |
|------|---------------|---------|
| A+ (90–100) | 5–15% | > 30% (scoring too generous) or < 2% |
| A (75–89) | 20–35% | > 50% or < 10% |
| B (55–74) | 25–40% | < 15% (enrichment may be degraded) |
| C (35–54) | 10–20% | > 35% (pipeline quality issue) |
| D (0–34) | 5–15% | > 30% (enrichment not running) |

Significant deviations from these bands indicate either a scoring misconfiguration or a pipeline degradation (e.g., FLHSMV API down, DHSMV/Nimble failure, skip-trace service unavailable).
