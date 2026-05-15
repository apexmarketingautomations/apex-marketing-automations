# APEX INCIDENT INTELLIGENCE
**Structured Operational Incident Management**
Version: 1.0 | Generated: 2026-05-15
Phase: 4A (Planned)

---

## Purpose

The Incident Intelligence layer converts raw signals into **structured operational incidents** — deduplicated, geo-aware, severity-scored events that serve as the primary unit of work for operator response.

An **incident** is NOT a contact. It is the event that may eventually produce one or more contacts after enrichment and entity resolution succeeds.

---

## Incident Definition

An incident is a real-world event that:
- Has a verifiable location and timestamp
- Has a measurable severity
- May involve one or more real people or entities
- Has a defined enrichment path
- Has a lifecycle (new → enriching → resolved → closed)

### Incident Types

| Type | Example | Source Signal |
|------|---------|--------------|
| `crash_incident` | Multi-vehicle collision on I-4 | `sentinel_incidents` |
| `pedestrian_incident` | Pedestrian struck at intersection | `sentinel_incidents` |
| `bicycle_incident` | Cyclist hit on road | `sentinel_incidents` |
| `recall_incident` | CPSC product recall affecting consumers | `legal_signals` |
| `injury_incident` | Slip and fall at business | `legal_signals` |
| `permit_cluster` | 15 roofing permits in ZIP 32801 | `home_service_signals` |
| `storm_event` | Category 1 landfall, 3 counties | weather connector |
| `booking_event` | Arrest booking with injury flag | jail booking feed |
| `business_opening` | New business DBPR license issued | DBPR connector |

---

## Current State

**`sentinel_incidents`** (7,449 rows) is the primary incident store.

Problems with the current state:
1. No `incident_fingerprint` — same crash appears as multiple rows after re-scrape
2. No clustering — five incidents on the same road segment are unrelated rows
3. No severity scoring pipeline — `severity` field populated at ingest but not scored
4. No enrichment queue — incidents sit without triggering skip trace
5. No incident timeline — evidence accumulates silently with no visible log
6. No relationship to contacts — incidents that produced contacts have no back-link

---

## Incident Intelligence Requirements

### 1. Incident Fingerprint

The `incident_fingerprint` is a stable, deterministic identifier computed from the physical and temporal properties of an event. It enables:
- Deduplication across re-scrapes and multi-source ingestion
- Merging of multiple signal sources into a single incident
- Stable URLs and deep links into incident records

**Crash fingerprint schema:**
```sql
ALTER TABLE sentinel_incidents
  ADD COLUMN IF NOT EXISTS incident_fingerprint VARCHAR(64),
  ADD COLUMN IF NOT EXISTS fingerprint_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_confidence NUMERIC(4,3) DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS enrichment_status VARCHAR(50) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS enrichment_queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS persons_identified INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS persons_enriched INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cluster_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_fingerprint
  ON sentinel_incidents(incident_fingerprint)
  WHERE incident_fingerprint IS NOT NULL;
```

**Fingerprint algorithm (v1):**
```
SHA256(
  county_normalized + "|" +
  ROUND(lat * 1000)::text + "|" +
  ROUND(lng * 1000)::text + "|" +
  DATE_TRUNC('hour', incident_date)::text + "|" +
  incident_type
)
```

The `fingerprint_version` column enables algorithm upgrades without breaking existing data.

### 2. Incident Clustering

Related incidents within the same geography and time window should be grouped into a **cluster** — a single operational work unit.

**Cluster definition:**
- Same county
- Within 0.5 km radius (lat/lng bounding box)
- Within 48-hour window
- Same incident type

**Cluster table:**
```sql
CREATE TABLE incident_clusters (
  id SERIAL PRIMARY KEY,
  cluster_type VARCHAR(100) NOT NULL,        -- 'crash_cluster', 'permit_cluster'
  county VARCHAR(100),
  lat_center REAL,
  lng_center REAL,
  radius_km REAL DEFAULT 0.5,
  time_window_start TIMESTAMPTZ,
  time_window_end TIMESTAMPTZ,
  incident_count INTEGER DEFAULT 1,
  max_severity VARCHAR(50),
  enrichment_status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sentinel_incidents ADD COLUMN IF NOT EXISTS cluster_id INTEGER REFERENCES incident_clusters(id);
```

### 3. Incident Severity Scoring

**`sentinel_incident_ai_triage`** (Stage 3 — schema live, 0 rows) is the destination for severity scores.

**Severity scoring dimensions:**
| Factor | Weight | Source |
|--------|--------|--------|
| Fatality flag | 40% | `sentinel_incidents.severity` = 'fatal' |
| Injury flag | 25% | severity = 'serious' or 'moderate' |
| Vehicle count | 10% | raw_data parsing |
| Hazmat flag | 10% | incident type or raw description |
| Highway location | 5% | road type (interstate vs local) |
| Time of day | 5% | rush hour = higher exposure |
| Multi-vehicle | 5% | vehicle_count > 1 |

**Score output:**
```typescript
{
  severity_score: 0.87,           // 0.000–1.000
  injury_probability: 0.75,       // estimated P(injury | crash)
  fatality_flag: false,
  recommended_action: "Enrich immediately — high-severity crash",
  triage_notes: "3-vehicle collision on I-95, rush hour, moderate injuries reported"
}
```

**Scoring is deterministic, not AI-generated.** The weighted formula runs in TypeScript with no LLM call. LLM enrichment of `triage_notes` is optional and gated behind a feature flag.

### 4. Enrichment Queue

Every incident that scores above the threshold gets queued for enrichment:

```
severity_score >= 0.5 → queue for BatchData skip trace
severity_score >= 0.7 → priority queue
severity_score < 0.3 → log and hold (do not enrich)
```

**Enrichment queue table:**
```sql
CREATE TABLE enrichment_queue (
  id BIGSERIAL PRIMARY KEY,
  incident_id INTEGER REFERENCES sentinel_incidents(id),
  contact_id INTEGER REFERENCES contacts(id),
  queue_type VARCHAR(50) NOT NULL,    -- 'skip_trace', 'phone_append', 'email_append'
  priority INTEGER DEFAULT 5,         -- 1 = highest, 10 = lowest
  status VARCHAR(50) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_attempted_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  scheduled_for TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_enrichment_queue_status ON enrichment_queue(status, priority, scheduled_for);
```

### 5. Incident Timeline

Every significant state change on an incident must be logged:

```sql
CREATE TABLE incident_timeline (
  id BIGSERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES sentinel_incidents(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,   -- 'signal_received', 'fingerprint_computed',
                                      -- 'severity_scored', 'enrichment_queued',
                                      -- 'contact_created', 'case_created'
  actor VARCHAR(100),                 -- 'crash_ingest_pipeline', 'manual', user_id
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_incident_timeline_incident ON incident_timeline(incident_id, created_at DESC);
```

### 6. Incident → Contact Relationship

When an enriched incident produces a verified contact, the relationship must be recorded:

```sql
CREATE TABLE incident_contacts (
  id BIGSERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES sentinel_incidents(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  role VARCHAR(50),                    -- 'victim', 'witness', 'at_fault'
  confidence NUMERIC(4,3),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(incident_id, contact_id)
);
```

---

## Incident Lifecycle States

```
pending          → signal received, fingerprint not yet computed
deduplicating    → fingerprint check in progress
new              → new unique incident, awaiting severity scoring
scoring          → severity score being computed
ready_to_enrich  → scored >= threshold, queued for enrichment
enriching        → skip trace / data append in progress
partially_enriched → some persons identified, some pending
enriched         → all identified persons have phone/email
contacts_created → CRM contacts created for all identified persons
case_created     → Case Intel record created
archived         → incident closed with no actionable result
```

---

## Incident UI Requirements (Phase 4A)

The **Incidents** view is separate from **Contacts**.

### Incidents View
- Shows: all `sentinel_incidents` regardless of enrichment status
- Grouped by: county → severity → date
- Columns: County, Type, Severity Score, Date, Persons Identified, Enrichment Status, Actions
- Filters: County, Severity (A/B/C/D), Date Range, Enrichment Status
- Quick actions: "Enrich Now" button → triggers skip trace queue

### NOT in Incidents View
- Export-eligible contacts (those go in Contacts view)
- Recall entities or business records

---

## Phase 4A Deliverables (Incident Intelligence)

- [ ] `incident_fingerprint` column + index + population script for existing 7,449 rows
- [ ] `incident_clusters` table + clustering algorithm
- [ ] `sentinel_incident_ai_triage` population — severity scoring job (deterministic)
- [ ] `enrichment_queue` table + background worker (throttled)
- [ ] `incident_timeline` table + event writing in crash ingest pipeline
- [ ] `incident_contacts` relationship table
- [ ] `GET /api/incidents` — new endpoint with county grouping and severity filter
- [ ] UI: Incidents tab separate from Contacts tab
- [ ] `enrichment_status` column on `sentinel_incidents`
