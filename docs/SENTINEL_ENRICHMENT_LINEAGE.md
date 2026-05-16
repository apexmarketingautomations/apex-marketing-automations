# Sentinel Enrichment Lineage

> Source-of-truth document for how contact records are built, enriched, and confidence-scored inside the Apex Signal Engine.

---

## Overview

Every crash lead contact passes through a deterministic 6-stage enrichment pipeline. Each stage has a defined confidence range and writes to a specific set of contact fields. Stages are additive — later stages never erase data established by an earlier high-confidence stage.

```
Stage 1: Signal Ingest          (confidence: N/A — raw event)
Stage 2: Plate / Registration   (confidence: 0.90)
Stage 3: FLHSMV Report          (confidence: 0.85)
Stage 4: DL Lookup              (confidence: 0.80)
Stage 5: Skip Trace             (confidence: 0.72 — BatchData inferred)
Stage 6: Geocode                (confidence: 0.95 — Google verified)
```

---

## Stage 1 — Signal Ingest

**Source**: FHP HSMV live feed, CAD ingest, manual entry  
**Writes**: `source`, `channel`, `location`, `lat`, `lng`, `severity`, `rawPayload`  
**Confidence**: Not scored — raw event record  
**Status after**: `skipTraceStatus = null`, `geocodeStatus = null`

The incident is detected and a `sentinel_incidents` record is created. No contact record exists yet.

---

## Stage 2 — Plate / Registration Lookup

**Source**: Florida DMV plate-to-owner lookup (ScrapingBee / Nimble)  
**Writes**: `firstName`, `lastName`, `address`, `registrationAddress`, `state`, `phone` (if registration includes it)  
**addressConfidence**: 0.90 (`ADDRESS_CONFIDENCE.REGISTRATION`)  
**addressSource**: `"registration"`  
**addressType**: `"registration"`  

If a phone number is found at this stage, `skipTraceStatus` is set to `source_matched` at Stage 5 to prevent BatchData spend.

---

## Stage 3 — FLHSMV Report Enrichment

**Source**: Florida HSMV crash report (official PDF → structured JSON)  
**Writes**: `firstName`, `lastName`, `dateOfBirth`, `dlNumber`, `phone` (if on report), `address`, `probableResidence`  
**addressConfidence**: 0.85 (`ADDRESS_CONFIDENCE.FLHSMV_REPORT`)  
**addressSource**: `"flhsmv"`  
**addressType**: `"registration"` or `"mailing"` (from report field)  
**Tags added**: `["flhsmv-enriched"]`

FLHSMV is a first-party government source. Any phone found here bypasses BatchData at Stage 5.

---

## Stage 4 — Driver License Lookup

**Source**: FLHSMV DL record (if DL number known from Stage 3)  
**Writes**: `firstName`, `lastName`, `address`, `probableResidence`, `dlStatus`  
**addressConfidence**: 0.88 (`ADDRESS_CONFIDENCE.DL_RECORD`)  
**addressSource**: `"dl_lookup"`  
**Notes**: Only runs when `dlNumber` is available. Refines residential address precision.

---

## Stage 5 — Skip Trace (BatchData)

**Source**: BatchData `/api/v1/property/skip-trace/name`  
**Writes**: `phone`, `normalizedPhone`, `mailingAddress`, `probableResidence`, `address` (if higher confidence)  
**Confidence**: 0.72 (`ADDRESS_CONFIDENCE.BATCHDATA_INFERRED`)  
**Cost**: ~$0.02–0.05 per lookup  

### Source Intelligence Guard (3-layer)

BatchData is **never called** when any of the following is true:

| Layer | Condition | Action |
|-------|-----------|--------|
| 1 | `isBatchDataDisabled()` returns true (kill switch) | Skip, log, return `{enriched: false}` |
| 2 | `contact.phone` is already populated | Set `skipTraceStatus = "source_matched"`, skip BatchData |
| 3 | `contact.skipTraceStatus === "matched"` and `force !== true` | Already enriched, skip |

### Skip Trace Status State Machine

```
null
  → pending          (job started, request in-flight)
    → matched        (phone found — terminal)
    → no_match       (name insufficient or no result — terminal)
    → failed         (HTTP error, timeout — retryable via DLQ)
    → source_matched (phone already present from a first-party source — terminal)
```

`source_matched` is a terminal status meaning "BatchData correctly skipped — phone came from a better source."

---

## Stage 6 — Geocode (Google Maps)

**Source**: Google Maps Geocoding API  
**Writes**: `formattedAddress`, `lat`, `lng`, `zip`, `city`, `county`, `verifiedResidence`, `address`  
**Confidence**: 0.95 (`ADDRESS_CONFIDENCE.VERIFIED_RESIDENCE`)  
**Geocode target priority**: `probableResidence` → `registrationAddress` → `address` (only if `addressConfidence > 0.15`)

**Never geocodes** `incidentLocation` / highway strings — those would set wrong lat/lng on the contact's residential record.

---

## Address Confidence Scale

| Value | Constant | Source |
|-------|----------|--------|
| 0.95  | `VERIFIED_RESIDENCE` | Google geocode confirmed |
| 0.90  | `REGISTRATION` | DMV plate-to-owner |
| 0.88  | `DL_RECORD` | Driver license record |
| 0.85  | `FLHSMV_REPORT` | FLHSMV crash report |
| 0.72  | `BATCHDATA_INFERRED` | BatchData skip trace |
| 0.30  | `PLAINTIFF_ASSERTION` | Self-reported / intake form |
| 0.15  | `INCIDENT_LOCATION` | Scene address — not residential |
| 0.00  | `UNKNOWN` | No address data |

A stage only overwrites `address` and `addressConfidence` if its confidence value is **strictly greater than** the existing value. This prevents lower-quality sources from degrading previously verified data.

---

## Field Ownership Map

| Field | Authoritative Stage |
|-------|---------------------|
| `firstName`, `lastName` | Stage 3 (FLHSMV) > Stage 2 (Plate) |
| `phone`, `normalizedPhone` | Stage 3 > Stage 2 > Stage 5 (BatchData) |
| `address` | Highest-confidence stage that produced a residential address |
| `probableResidence` | Stage 3 / Stage 4 / Stage 5 |
| `registrationAddress` | Stage 2 |
| `verifiedResidence` | Stage 6 only |
| `formattedAddress` | Stage 6 only |
| `lat`, `lng` | Stage 6 (residential geocode); Stage 1 (incident location only) |
| `county` | Stage 6 > Stage 3 |
| `dlNumber`, `dateOfBirth` | Stage 3 only |
| `skipTraceStatus` | Stage 5 state machine |
| `geocodeStatus` | Stage 6 (`verified` / `failed`) |
| `enrichmentProvider` | Stage 5 (`"batchdata"`) |

---

## Idempotency Guarantees

- Every enrichment job checks current contact state **before** mutating.
- `enqueueEnrichment` uses `jobId: enrich-{type}-{contactId}` to prevent duplicate BullMQ jobs.
- Skip trace is idempotent via `skipTraceStatus === "matched"` guard.
- Geocode is idempotent via `geocodeStatus === "verified"` (checked upstream before enqueue).

---

## Error Handling

All enrichment jobs use BullMQ with 3 attempts and exponential backoff (5 s base). After all retries are exhausted:

1. `captureWorkerError()` sends the failure to Sentry with `contactId`, `jobId`, `attempts`.
2. `sendToDeadLetterQueue()` routes the job envelope to `apex-dead-letters`.
3. Operators can replay via `POST /api/admin/dead-letters/:jobId/replay`.
