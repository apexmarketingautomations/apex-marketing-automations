# Crash Ingest Pipeline — End-to-End Proof Run

**Date:** 2026-04-07  
**Environment:** Development  
**Pipeline version:** `server/crashIngestPipeline.ts`

## Test Harness Results

### Scenario: `success`
```
traceId: TEST-f6e9287d
inserted: 3 | skipped: 0 | leads: 3 | failed: 0

Inserted crash reports:
  SENTINEL-33C355154EA6B317 | CRASH WITH INJURIES | I-75 NB MM 131, LEE County, FL
  SENTINEL-A6F74419B836459B | FATAL CRASH           | US-41 at Collier Blvd, COLLIER County, FL
  SENTINEL-5AC86D07D98CCCAB | ROLLOVER WITH ENTRAPMENT | SR-776 near Kings Hwy, CHARLOTTE County, FL

All 3 are qualifying types → 3 contact leads created (source=sentinel_crash)
```

### Scenario: `duplicate`
```
traceId: TEST-48d2e459
inserted: 3 | skipped: 3 | leads: 3 | failed: 0

SHA-256 dedup working: 3 exact duplicates skipped, 3 new (unique traceId produces new hashes) inserted.
```

### Scenario: `empty`
```
responseStatus: empty | inserted: 0
```

### Scenario: `malformed`
```
responseStatus: error | failed: 1
error: "Malformed incident: missing type or location"
```

### Scenario: `transient_failure`
```
responseStatus: error | failed: 3
error: "Simulated transient HTTP failure after 3 attempts with exponential backoff"
```

## Auth Tests
```
No-secret request  → HTTP 401
Wrong-secret request → HTTP 401
```

## DB State (at proof run completion)
```
source          | count
----------------|-------
manual          |     5
sentinel_auto   |    76

sentinel_crash contacts (leads): 61

Recent inserts (processed_to_lead=true, retry_count=0):
  id=83 | SENTINEL-901885E1E8137249 | TEST-48d2e459
  id=82 | SENTINEL-BACF4C0DB9D5FF65 | TEST-48d2e459
  id=81 | SENTINEL-1D10D8D1B673534E | TEST-48d2e459
  id=80 | SENTINEL-5AC86D07D98CCCAB | TEST-f6e9287d (ROLLOVER WITH ENTRAPMENT, CHARLOTTE)
  id=79 | SENTINEL-A6F74419B836459B | TEST-f6e9287d (FATAL CRASH, COLLIER)
  id=78 | SENTINEL-33C355154EA6B317 | TEST-f6e9287d (CRASH WITH INJURIES, LEE)
```

## Live Feed Poll (auto-ingest from FLHSMV/Sentinel)
At startup, the live FLHSMV feed returned 26 incidents — all previously seen, all correctly deduped to 0 new inserts.
```json
{
  "responseStatus": "ok",
  "countReturned": 26,
  "countParsed": 26,
  "countInserted": 0,
  "countSkipped": 26,
  "countConvertedToLeads": 0,
  "countFailed": 0,
  "durationMs": 953
}
```

## Lead Qualification Logic
Non-qualifying crashes are inserted with `processedToLead=true` (no lead needed).  
Qualifying crash types: `INJUR | FATAL | ENTRAP | EXTRICAT | TRAUMA | ROADBLOCK | HIT AND RUN | H&R | ROLLOVER` or `severity=critical`.  
Recovery pass re-checks `qualifiesForLead` from `rawPayload` before creating a lead — non-qualifying records are finalized without creating a lead.
