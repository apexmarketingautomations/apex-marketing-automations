# Sentinel: Incident Data Lineage

**Document version:** 1.0  
**System:** Apex Marketing OS — Sentinel Crash Lead Ingestion  
**Relevant modules:** `crashIngestPipeline.ts`, `crashReportWorker.ts`, `contactUpsertService.ts`, `scoringWorker.ts`

---

## Table of Contents

1. [Overview](#overview)
2. [Full Lineage Chain](#full-lineage-chain)
3. [Fingerprinting Design](#fingerprinting-design)
4. [Source External ID Format](#source-external-id-format)
5. [Data Lineage Table](#data-lineage-table)
6. [Address Upgrade Progression](#address-upgrade-progression)
7. [Workflow Stage Progression](#workflow-stage-progression)
8. [Tag-Based Audit Trail](#tag-based-audit-trail)
9. [No-Overwrite Guarantee](#no-overwrite-guarantee)
10. [Recovery and Retry Safety](#recovery-and-retry-safety)
11. [How Multiple Enrichment Passes Converge](#how-multiple-enrichment-passes-converge)

---

## Overview

Every contact created by the Sentinel system originates from a discrete real-world event — a crash recorded in the FHP Computer-Aided Dispatch (CAD) system. The entire lifecycle of that contact, from the raw CAD signal to a routed, actionable victim record, is traceable through a combination of deterministic identifiers, additive tags, and confidence-gated field upgrades.

This document describes the **lineage chain**: what data lives where, where it came from, how it changes over time, and what guarantees the system makes about data integrity across retries, re-enrichment, and multi-pass processing.

---

## Full Lineage Chain

```
[1] FHP CAD System
    └── Crash signal emitted: reportNumber, scene coordinates, involved plates
           |
           v
[2] crashIngestPipeline.ts  (ingest time)
    ├── Creates stub contact records (isPlaceholder=true, workflowStage='new')
    ├── Sets incidentFingerprint = SHA256("crash:" + reportNumber)
    ├── Sets incidentLocation, incidentLat, incidentLng from CAD scene data
    └── Sets sourceExternalId = "crash:{reportNumber}:acct{accountId}"
           |
           v
[3] crashReportWorker.ts  (enrichment time)
    ├── Fetches official FLHSMV crash report
    ├── Extracts driver names, license addresses, plates
    ├── Calls dhsmvRegistrationLookup per plate → owner name + registration address
    ├── Re-computes incidentFingerprint (must match ingest-time value)
    ├── Calls mergeContact() → address upgraded FLHSMV → DHSMV
    ├── Sets isPlaceholder=false, workflowStage='enriching'
    └── Applies enrichmentTags: flhsmv-enriched, plate:XXX, [dhsmv-enriched]
           |
           v
[4] scoringWorker.ts  (scoring time)
    ├── Computes composite score from enrichment_quality, residential_intelligence, etc.
    ├── Assigns score band (A+/A/B/C/D)
    ├── Sets isPlaceholder=true if score < QUALIFY_THRESHOLD (55) — qualify gate
    └── Sets workflowStage='scored'
           |
           v
[5] Skip-trace pass  (optional, triggered by workflow)
    ├── Verifies / augments address; may upgrade addressConfidence to 0.95+
    ├── Adds has-phone, skip-traced tags
    └── mergeContact() updates address only if confidence improves
           |
           v
[6] Routing / Export
    ├── deriveExportEligible() gate: name + phone/email + addressConfidence > 0.15
    │   + isPlaceholder=false + score >= 55
    ├── workflowStage → 'routed'
    └── Contact delivered to downstream attorney intake or CRM
           |
           v
[7] Outreach
    └── workflowStage → 'contacted'
```

---

## Fingerprinting Design

The `incidentFingerprint` ties together all contacts from the same physical crash event regardless of how many times the pipeline runs or how many sub-accounts receive the leads.

### Algorithm

```
incidentFingerprint = SHA256("crash:" + sentinelReportNumber)
```

- **Prefix `"crash:"`** is a namespace guard. If Sentinel later ingests other incident types (e.g., `"property:"`, `"fire:"`), fingerprints from different domains cannot collide.
- **`sentinelReportNumber`** is the FHP-assigned report number — globally unique per crash in the Florida system.
- The SHA256 output is stored as a lowercase hex string (64 characters).

### Why SHA256 and not the raw report number?

1. **Fixed-length indexing:** SHA256 produces a uniform 64-char string regardless of report number format changes over time.
2. **Obfuscation:** The raw report number is a government identifier. Hashing it reduces accidental exposure in logs and exports.
3. **Determinism across services:** Any service with the report number can independently compute the same fingerprint without a round-trip to the database.

### Computed at two points

| Computation Site | Module | Purpose |
|----------------|--------|---------|
| Ingest time | `crashIngestPipeline.ts` | Written to contact at creation |
| Enrichment time | `crashReportWorker.ts` | Verified / re-written; must match ingest value |

If the two values diverge (which should never happen for the same `sentinelReportNumber`), the enrichment worker logs an error and halts processing for that contact batch. This is a data-integrity sentinel check, not a normal code path.

---

## Source External ID Format

```
sourceExternalId = "crash:{reportNumber}:acct{accountId}"
```

### Components

| Segment | Example | Description |
|---------|---------|-------------|
| `crash:` | `crash:` | Record type prefix |
| `{reportNumber}` | `FL-2024-0049271` | FHP crash report number |
| `:acct{accountId}` | `:acct1042` | Sub-account identifier |

### Why contacts from the same crash have different `sourceExternalId`

Multiple sub-accounts (e.g., different law firm offices) may receive leads from the same crash. Each sub-account's copy of the contact gets a unique `sourceExternalId` because `accountId` differs. However, all copies share the same `incidentFingerprint`, enabling cross-account incident grouping for analytics and deduplication.

```
Crash FL-2024-0049271
  ├── Contact in acct1042: sourceExternalId = "crash:FL-2024-0049271:acct1042"
  ├── Contact in acct1087: sourceExternalId = "crash:FL-2024-0049271:acct1087"
  └── Both have:           incidentFingerprint = SHA256("crash:FL-2024-0049271")
```

---

## Data Lineage Table

Each field in the contact record has a defined origin, update policy, and confidence level.

| Field | Origin | Set At | Overwrite Policy | Confidence / Notes |
|-------|--------|--------|------------------|--------------------|
| `incidentFingerprint` | Computed: `SHA256("crash:"+reportNumber)` | Ingest + Enrichment | Never overwritten; verified at enrichment | Deterministic |
| `sourceExternalId` | Computed: `"crash:{rpt}:acct{id}"` | Ingest | Never overwritten | Stable identifier |
| `incidentLocation` | FHP CAD raw string | Ingest | **Never overwritten** | Raw scene descriptor |
| `incidentLat` | FHP CAD coordinates | Ingest | **Never overwritten** | Raw GPS from CAD |
| `incidentLng` | FHP CAD coordinates | Ingest | **Never overwritten** | Raw GPS from CAD |
| `firstName` | FLHSMV `driver.Name` parsed | Enrichment | Overwrite allowed if previously null | — |
| `lastName` | FLHSMV `driver.Name` parsed | Enrichment | Overwrite allowed if previously null | — |
| `address` | Progressive upgrade | Enrichment → skip-trace | Confidence-gated: higher wins | See Address Upgrade |
| `registrationAddress` | FLHSMV / DHSMV | Enrichment | Confidence-gated | 0.85 / 0.90 |
| `addressConfidence` | Derived from source tier | Enrichment / skip-trace | Higher value wins | 0.00–1.00 |
| `addressType` | Derived state | Progressive | Monotonically upgrades | `unknown` → `registration` → `verified_residence` |
| `addressSource` | Source identifier | Enrichment / skip-trace | Set with each address upgrade | `flhsmv`, `dhsmv`, `skip-trace` |
| `registrationAddressSource` | Source identifier | Enrichment | Set once | `flhsmv` or `dhsmv` |
| `isPlaceholder` | Scoring gate | Ingest (true) → Enrichment (false) → Scoring (conditional) | Scoring may re-set to true | Boolean |
| `viewClass` | Semantic classifier | Enrichment | Fixed after enrichment | `'incident_subject'` |
| `workflowStage` | Pipeline state machine | All stages | Monotonically advances | See Workflow Stage Progression |
| `enrichmentTags` | Accumulated audit tags | All stages | Additive only — never removed | See Tag-Based Audit Trail |
| `score` | Computed by scoringWorker | Scoring | Re-computed on re-score | 0–100 |
| `scoreBand` | Derived from score | Scoring | Re-derived on re-score | A+/A/B/C/D |

---

## Address Upgrade Progression

The `address` field begins as `null` and can only move forward — never backward — in confidence level. `mergeContact()` enforces this rule on every write.

```
State           addressType          addressConfidence   addressSource
-----------     ----------------     -----------------   -------------
null (stub)     'unknown'            0.00                null
  |
  v  [FLHSMV enrichment]
FLHSMV addr     'registration'       0.85                'flhsmv'
  |
  v  [DHSMV enrichment — if lookup succeeds]
DHSMV addr      'registration'       0.90                'dhsmv'
  |
  v  [skip-trace pass]
skip-trace      'registration'       0.95                'skip-trace'
  |
  v  [geocode + confirmation]
confirmed       'verified_residence' 1.00                'geocoded'
```

A contact that never receives a DHSMV hit will plateau at `0.85` until skip-trace is run. A roadway-placeholder contact that never receives any enrichment stays at `0.00–0.15` and is blocked from export.

---

## Workflow Stage Progression

`workflowStage` is a monotonically advancing state that reflects where in the pipeline a contact currently sits. It never moves backward.

| Stage | Set By | Contact State |
|-------|--------|---------------|
| `'new'` | `crashIngestPipeline.ts` | Stub created; no enrichment data |
| `'enriching'` | `crashReportWorker.ts` | FLHSMV/DHSMV data being applied |
| `'scored'` | `scoringWorker.ts` | Score computed; qualify gate applied |
| `'routed'` | Routing worker | Contact delivered to downstream intake |
| `'contacted'` | Outreach tracker | Outreach attempt logged |

Contacts that fail the qualify gate (`score < 55`) remain at `'scored'` with `isPlaceholder=true` and are not advanced to `'routed'`.

---

## Tag-Based Audit Trail

Tags are the primary human-readable audit log for a contact's history. They accumulate monotonically — once applied, a tag is never removed by automated processes.

```
Timeline of tag accumulation for a fully enriched contact:

[Ingest]
  + crash-lead
  + sentinel-auto

[FLHSMV enrichment]
  + flhsmv-enriched
  + plate:FL-ABC123

[DHSMV enrichment — success]
  + dhsmv-enriched

[Skip-trace]
  + skip-traced
  + has-phone

Final tag set:
  { crash-lead, sentinel-auto, flhsmv-enriched, plate:FL-ABC123, dhsmv-enriched, skip-traced, has-phone }
```

**Using tags for pipeline health monitoring:**

| Query | What it reveals |
|-------|----------------|
| `has: flhsmv-enriched, NOT dhsmv-enriched` | Contacts where DHSMV lookup failed |
| `has: flhsmv-enriched, NOT skip-traced` | Contacts awaiting skip-trace |
| `has: crash-lead, NOT flhsmv-enriched` | Contacts where enrichment worker has not run yet |
| `has: plate:FL-ABC123` | All contacts associated with a specific vehicle |
| Count of `dhsmv-enriched` / `flhsmv-enriched` | DHSMV enrichment success rate |

---

## No-Overwrite Guarantee

The Sentinel system makes an explicit architectural guarantee: **incident scene data is never overwritten, and field upgrades are strictly confidence-ordered**.

### Incident scene fields (immutable after ingest)

`incidentLocation`, `incidentLat`, and `incidentLng` are written once at ingest time from the raw FHP CAD signal. No subsequent enrichment pass — FLHSMV, DHSMV, skip-trace, or geocoding — modifies these fields. They represent the objective crash scene coordinates and are the legal anchor for the incident record.

### Address fields (confidence-gated upgrades)

`mergeContact()` in `contactUpsertService.ts` implements the upgrade gate:

```typescript
// Pseudocode — actual implementation in contactUpsertService.ts
function mergeContact(existing: Contact, incoming: ContactPayload): Contact {
  if (incoming.addressConfidence > (existing.addressConfidence ?? 0)) {
    existing.address            = incoming.address;
    existing.addressConfidence  = incoming.addressConfidence;
    existing.addressType        = incoming.addressType;
    existing.addressSource      = incoming.addressSource;
  }
  // All other address-related fields follow the same pattern
  return existing;
}
```

A write with `addressConfidence = 0.85` (FLHSMV) cannot overwrite a stored value of `0.90` (DHSMV). This makes re-ordering of enrichment jobs safe: whichever job runs last will only win if it carries higher confidence.

---

## Recovery and Retry Safety

The pipeline is designed for safe re-execution at any stage:

| Scenario | Safe? | Mechanism |
|----------|-------|-----------|
| Ingest job re-runs for same `reportNumber` | Yes | `sourceExternalId` uniqueness constraint prevents duplicate contact creation |
| Enrichment worker re-runs for already-enriched contact | Yes | `flhsmv-enriched` tag check causes skip |
| DHSMV lookup re-run after previous failure | Yes (with manual tag removal) | Without `flhsmv-enriched`, full enrichment re-executes |
| Scoring worker re-runs for already-scored contact | Yes | Score is recomputed and overwritten; tags accumulate but do not duplicate |
| Skip-trace re-run | Yes | `addressConfidence` gate prevents downgrade; `skip-traced` tag is idempotent |

**Manual recovery procedure for stuck contacts:** If a contact is stuck in `workflowStage='enriching'` and has `flhsmv-enriched` but address fields are incomplete, the operator must:
1. Remove the `flhsmv-enriched` tag.
2. Re-queue the contact for enrichment.
3. The worker will re-process from scratch, re-applying all enrichment data.

This is intentional: the tag is the idempotency guard, so removing it is the explicit "re-process" signal.

---

## How Multiple Enrichment Passes Converge

Because address upgrades are confidence-ordered, multiple enrichment passes from different sources always converge to the highest-quality available data regardless of execution order.

**Example: out-of-order enrichment**

```
Pass 1 (DHSMV arrives first):
  stored addressConfidence = 0.00
  incoming addressConfidence = 0.90
  → WRITE: address = DHSMV address, confidence = 0.90

Pass 2 (FLHSMV arrives late):
  stored addressConfidence = 0.90
  incoming addressConfidence = 0.85
  → SKIP: 0.85 < 0.90, no overwrite

Final state: DHSMV address, confidence 0.90 ✓
```

**Example: normal order enrichment**

```
Pass 1 (FLHSMV):
  stored addressConfidence = 0.00
  incoming addressConfidence = 0.85
  → WRITE: address = FLHSMV address, confidence = 0.85

Pass 2 (DHSMV):
  stored addressConfidence = 0.85
  incoming addressConfidence = 0.90
  → WRITE: address = DHSMV address, confidence = 0.90

Final state: DHSMV address, confidence 0.90 ✓
```

Both orderings produce the same final state. The system is **convergent** — multiple passes, retries, and redeliveries all resolve to the highest-confidence available data.
