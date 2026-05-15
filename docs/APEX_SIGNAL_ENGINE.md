# APEX SIGNAL ENGINE
**Source: Operational Signal Collection and Normalization**
Version: 1.0 | Generated: 2026-05-15
Phase: Foundation (Partial — crash, legal, jail, home service active)

---

## Purpose

The Signal Engine is the raw data ingestion layer of the Apex Intelligence OS. It collects, normalizes, deduplicates, and stores operational signals from external sources — without promoting them directly into the CRM.

A **signal** is a raw real-world event. It is NOT a contact. It is NOT an opportunity. It is evidence that something happened somewhere that may or may not be actionable.

---

## Signal Taxonomy

### Active Connectors (Live)

| Signal Domain | Source | Table | Daily Volume |
|--------------|--------|-------|-------------|
| Vehicle crashes | Sentinel / FDOT / scrapers | `sentinel_incidents` | ~960/day |
| Legal filings | CourtListener, Hillsborough | `legal_signals`, `legal_leads` | ~500/day |
| Jail bookings | County booking records | `contacts` (jail_booking source) | variable |
| Home service | DBPR / permit feeds | `home_service_signals` | variable |
| Crash reports | Apify / public sources | `crash_reports` | ~100/day |

### Planned Connectors (Phase 5–6)

| Signal Domain | Source | Priority |
|--------------|--------|---------|
| CPSC product recalls | api.cpsc.gov | Phase 5 |
| OSHA violations | OSHA data portal | Phase 5 |
| Building permits | County permit APIs | Phase 6 |
| DBPR license changes | Florida DBPR | Phase 6 |
| Code enforcement | County code portals | Phase 6 |
| Weather events | NWS / NOAA | Phase 6 |
| Business openings | Yelp / Google / SoS | Phase 6 |
| Review spikes | Google Maps API | Phase 6 |
| Inspection results | County health / safety | Phase 6 |

---

## Current Signal Tables

### `sentinel_incidents` (7,449 rows)

The primary crash/incident signal store.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Primary key |
| sub_account_id | INTEGER | Which account received this signal |
| incident_type | TEXT | crash, pedestrian, bicycle, etc. |
| location | TEXT | Raw location string |
| county | TEXT | Normalized county |
| lat / lng | REAL | Geolocation |
| severity | TEXT | fatal, serious, moderate, minor |
| incident_date | TIMESTAMP | When it happened |
| source_hash | TEXT | Dedup key |
| raw_data | JSONB | Original payload |

**Missing:** `incident_fingerprint` — the stable cross-source dedup key. Planned for Phase 4A.

### `legal_signals` (3,153 rows)

Structured legal event signals from CourtListener and Hillsborough.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Primary key |
| signal_type | TEXT | recall, filing, judgment, etc. |
| jurisdiction | TEXT | State / court |
| case_number | TEXT | External case reference |
| parties | JSONB | Plaintiff / defendant |
| filing_date | DATE | When filed |
| source | TEXT | courtlistener, hillsborough, cpsc |

### `crash_reports` (3,092 rows)

Raw crash data from scrapers. Pre-normalized, pre-incident.

### `home_service_signals` (variable)

Permit activity, inspection results, DBPR licensing events.

---

## Signal Engine Requirements

### 1. Source Lineage

Every signal row must carry:

```sql
source_connector    VARCHAR(100)   -- 'sentinel_crash', 'courtlistener', 'dbpr'
source_version      VARCHAR(20)    -- connector version at time of ingest
source_url          TEXT           -- original URL or API endpoint
source_retrieved_at TIMESTAMPTZ   -- when the raw data was fetched
source_confidence   NUMERIC(4,3)  -- 0.000–1.000 reliability of this source
```

**Current gap:** `sentinel_incidents` and `crash_reports` lack `source_confidence` and `source_version`.

### 2. Deduplication

Each signal domain needs a **stable fingerprint** that can detect duplicates across runs, sources, and time.

**Crash fingerprint design (Phase 4A):**
```
incident_fingerprint = SHA256(
  county_normalized +
  lat_bucket(0.001°) +
  lng_bucket(0.001°) +
  incident_date_truncated(hour) +
  incident_type
)
```

**Legal signal fingerprint:**
```
signal_fingerprint = SHA256(
  court_id + case_number + signal_type
)
```

### 3. Replayability

Signals must be replayable. Raw payloads must be retained:
- `raw_data JSONB` on every signal table
- Never mutate the raw payload after ingest
- Normalized fields are derived columns, not the source of truth

### 4. Source Health Monitoring

Every connector must report to `enrichment_provider_log`:

```sql
INSERT INTO enrichment_provider_log
  (contact_id, provider, request_type, status, created_at)
VALUES
  (NULL, 'sentinel_crash', 'signal_ingest', 'success', NOW());
```

Add a dedicated `signal_source_health` table (Phase 4A):

```sql
CREATE TABLE signal_source_health (
  id BIGSERIAL PRIMARY KEY,
  connector VARCHAR(100) NOT NULL,
  last_successful_fetch TIMESTAMPTZ,
  last_attempted_fetch TIMESTAMPTZ,
  consecutive_failures INTEGER DEFAULT 0,
  avg_fetch_latency_ms INTEGER,
  records_last_run INTEGER,
  records_total BIGINT,
  status VARCHAR(50) DEFAULT 'healthy', -- healthy, degraded, down
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 5. Signal → Incident Promotion Rules

**DO NOT** auto-promote signals to contacts. Signal promotion must be:

```
Signal received
  → deduplication check (fingerprint lookup)
  → if new: create/update Incident record
  → severity scoring
  → enrichment queue (if severity >= threshold)
  → contact creation ONLY after enrichment succeeds AND identity verified
```

Promotion is blocked if:
- Fingerprint already exists (duplicate)
- Source confidence < 0.3
- Incident is older than 30 days without enrichment (stale)
- Entity type is non-person (business, vehicle, agency)

---

## Signal Normalization Pipeline

### Standard Normalization Steps

```
1. Receive raw payload (webhook, cron fetch, API poll)
2. Extract source metadata (connector, version, url, timestamp)
3. Normalize geography:
   - county: strip "County" suffix, uppercase, trim
   - lat/lng: round to 4 decimal places
   - state: 2-letter abbreviation
4. Normalize timestamp: UTC, TIMESTAMPTZ
5. Compute fingerprint (domain-specific hash)
6. Check fingerprint: INSERT if new, UPDATE if existing
7. Emit signal_received event to universal_events
8. Report to signal_source_health (success/failure)
```

### Normalization Functions (planned)

```typescript
// server/services/signalNormalizationService.ts

export function normalizeCounty(raw: string): string {
  return raw.replace(/\s+county$/i, "").toUpperCase().trim();
}

export function computeCrashFingerprint(incident: {
  county: string;
  lat: number;
  lng: number;
  incidentDate: Date;
  incidentType: string;
}): string {
  const latBucket = Math.round(incident.lat * 1000);
  const lngBucket = Math.round(incident.lng * 1000);
  const hourBucket = new Date(incident.incidentDate);
  hourBucket.setMinutes(0, 0, 0);
  const key = [
    normalizeCounty(incident.county),
    latBucket,
    lngBucket,
    hourBucket.toISOString(),
    incident.incidentType,
  ].join("|");
  return crypto.createHash("sha256").update(key).digest("hex");
}
```

---

## Connector Observability Requirements

Each connector must:

1. Log every fetch attempt to `signal_source_health`
2. Log every dedup decision (new vs existing) to `universal_events`
3. Never swallow errors silently — always write to `agent_outcome_log` on failure
4. Expose a health endpoint: `GET /api/internal/signal-health/:connector`
5. Emit `signal_source_degraded` event if 3 consecutive failures occur

---

## Anti-Patterns to Avoid

| Anti-Pattern | Why It's Wrong | Correct Approach |
|-------------|----------------|-----------------|
| Signal → Contact directly | Skips enrichment and entity resolution | Signal → Incident → Enrichment → Contact |
| Mutable raw payloads | Breaks replayability and audit trail | Immutable raw_data JSONB, derived normalized fields |
| Silent dedup failures | Signals appear as duplicates in CRM | Fingerprint + explicit dedup logging |
| Polling without health tracking | Source degradation is invisible | signal_source_health table + alert on 3x failures |
| Unlimited signal volume to contacts | Railway OOM, DB bloat | Severity threshold gates enrichment |

---

## Phase 4A Deliverables (Signal Engine)

- [ ] `incident_fingerprint` column + index on `sentinel_incidents`
- [ ] `signal_fingerprint` column + index on `legal_signals`
- [ ] `signal_source_health` table (new)
- [ ] `source_confidence` column on `sentinel_incidents`
- [ ] Fingerprint computation in `crashIngestPipeline.ts`
- [ ] Health reporting in each active connector
- [ ] `GET /api/internal/signal-health` admin endpoint
