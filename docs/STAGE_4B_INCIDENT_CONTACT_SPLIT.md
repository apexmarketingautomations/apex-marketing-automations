# Stage 4B — Incident / Contact Split: view_class Architecture

**Status:** DESIGN  
**Authored:** 2026-05-15  
**Depends on:** Stage 3 (21 operational tables live), Stage 4A (durable queue infrastructure)  
**Unlocks:** Stage 5 (export pipeline segmentation, workflow automation by class)  
**Schema change type:** Additive only — no columns dropped, no types changed, no defaults altered

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Problem](#2-current-state-problem)
3. [The view_class System](#3-the-view_class-system)
4. [Schema Changes](#4-schema-changes)
5. [View Classification Rules](#5-view-classification-rules)
6. [Migration Script Logic](#6-migration-script-logic)
7. [Ingestion Pipeline Changes](#7-ingestion-pipeline-changes)
8. [What Does Not Change](#8-what-does-not-change)
9. [Validation Gates](#9-validation-gates)
10. [Rollback Plan](#10-rollback-plan)

---

## 1. Executive Summary

The `contacts` table currently stores four fundamentally different types of records under a single undifferentiated feed:

- **Raw crash signals** — an event happened at a location; no human identity exists yet
- **Incident stubs** — a crash is linked to a vehicle or plate but the person is still a placeholder
- **Verified contacts** — a real human with a phone number, name, and skip-trace result
- **Exportable opportunities** — a verified contact that has cleared quality scoring and is ready for attorney delivery

Every query across the API, the UI, and the export layer currently receives all four types mixed together. This causes three compounding problems: UI lists are polluted with pre-human data; export jobs must defensively filter at query time; and pipeline metrics cannot report enrichment rates, conversion rates, or delivery ratios with any precision.

Stage 4B introduces a `view_class` column that stamps each record with its semantic class at ingest time and promotes it through the class hierarchy as enrichment completes. No existing column changes. No existing query breaks. All writes continue as-is; only reads gain the ability to filter by class.

The net result: every consumer — the contacts list UI, the export pipeline, the routing engine, the analytics dashboard — can query its slice of the feed with a single index-backed predicate rather than reconstructing record type from a combination of `identityStatus`, `skipTraceStatus`, and `contactQualityScore`.

---

## 2. Current State Problem

### 2.1 The Mixed Feed

The live `contacts` table contains records that represent four different lifecycle stages, but there is no column that distinguishes them. Callers must reconstruct type from a conjunction of existing columns:

| What the caller wants | How it must infer it today |
|---|---|
| Raw crash event, no human | `identity_status = 'unidentified' AND normalized_phone IS NULL AND raw_source_type = 'crash'` |
| Crash with a placeholder person | `identity_status = 'placeholder' AND raw_source_type = 'crash'` |
| Enriched human, ready for outreach | `identity_status = 'verified' OR normalized_phone IS NOT NULL` |
| Attorney-deliverable opportunity | `contact_quality_score > 0.75 AND skip_trace_status = 'matched'` |

Every caller re-derives this logic independently. When the rules change — for example, when a new skip-trace provider is added — every caller must be updated.

### 2.2 Performance Consequences

The existing indexes are:

```
contacts_sub_skip_status_idx     (sub_account_id, skip_trace_status)
contacts_sub_identity_status_idx (sub_account_id, identity_status)
contacts_sub_external_id_idx     (sub_account_id, source_external_id)
contacts_sub_phone_idx           (sub_account_id, normalized_phone)
contacts_sub_vertical_idx        (sub_account_id, lead_vertical)
```

A query for "all exportable contacts" must join `identity_status = 'verified'` against `contact_quality_score > 0.75` — the second predicate hits no index. The planner falls back to a sequential scan on the filtered set from the identity index, which grows linearly with the crash ingest volume.

### 2.3 Export Pipeline Defensive Filtering

`server/routes/contacts.ts` and the export job handler both carry guard conditions that replicate the "is this actually a real person?" logic. A record that passes `identity_status = 'verified'` but has no phone and a quality score of 0.1 can reach the export queue. The export handler then drops it silently. There is no upstream gate.

### 2.4 Enrichment Rate Reporting Is Impossible

With all record types in one feed, the metric "what percentage of signals became contacts?" requires a full table scan grouped by multiple column combinations. There is no snapshot of how many records entered the pipeline as signals, making denominator calculation unreliable.

---

## 3. The view_class System

### 3.1 Definition

`view_class` is a denormalized classification label computed from existing column values. It is:

- **Computed at ingest time** from the record's identity status, phone, source type, and quality score
- **Promoted forward** as enrichment completes — a `signal` becomes an `incident`, then a `contact`, then an `opportunity`
- **Indexed** so any query filtering by class hits an index without touching raw classification columns
- **Never the source of truth** — it is always derivable from existing columns; it is stored as a cache for query performance

### 3.2 Class Values

| view_class | Semantic Meaning | Human Present? | Phone Present? | Export Eligible? |
|---|---|---|---|---|
| `signal` | Raw event; no human identity | No | No | Never |
| `incident` | Event with a vehicle or placeholder identity | Stub only | No | Never |
| `contact` | Verified human with recoverable phone | Yes | Yes or recoverable | Potentially |
| `opportunity` | Contact that has cleared quality and export gates | Yes | Yes | Yes |

### 3.3 Class Hierarchy and Promotion

```
[raw ingest]
     |
     v
  SIGNAL  (identityStatus=unidentified, no phone)
     |
     | skip-trace or crash report links a vehicle/plate
     v
  INCIDENT  (identityStatus=placeholder)
     |
     | skip-trace matches a person, phone is normalized
     v
  CONTACT  (identityStatus=verified OR normalized_phone present)
     |
     | contactQualityScore > 0.75 AND export_eligible=true
     v
  OPPORTUNITY  (ready for attorney delivery)
```

Promotion is one-directional. A `contact` never regresses to `signal`. If enrichment fails and a record is definitively unresolvable, `workflow_stage` is set to `DEAD`; `view_class` remains `contact` or `incident` depending on what was known.

### 3.4 Relationship to Existing Columns

`view_class` does not replace any existing column. The source-of-truth columns remain authoritative:

| view_class derivation | Authoritative columns used |
|---|---|
| `signal` | `identity_status`, `normalized_phone`, `raw_source_type` |
| `incident` | `identity_status`, `raw_source_type` |
| `contact` | `identity_status`, `normalized_phone` |
| `opportunity` | `contact_quality_score`, `export_eligible` |

---

## 4. Schema Changes

All changes are additive. Every new column is `NOT NULL` with a safe default so existing rows are never NULL and existing inserts that omit the column receive the correct baseline value.

### 4.1 ALTER TABLE Statements

```sql
-- Run in a single transaction; all are additive, no locks on existing data paths

BEGIN;

-- Primary classification label
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS view_class TEXT NOT NULL DEFAULT 'signal';

-- Workflow lifecycle state
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS workflow_stage TEXT NOT NULL DEFAULT 'NEW';

-- Export eligibility gate (explicit boolean, not derived at query time)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS export_eligible BOOLEAN NOT NULL DEFAULT false;

-- Lead type — maps to the attorney vertical or home-service category
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_type TEXT;
  -- Allowed values: 'accident' | 'pi' | 'storm' | 'property' | 'legal' | 'permit' | 'other'
  -- NULL is valid for legacy records; new ingest must populate this field

-- Source pipeline — which ingest path wrote this record
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source_pipeline TEXT;
  -- Examples: 'flhsmv_crash', 'apex_sentinel', 'manual_import', 'form_submit', 'webhook'
  -- NULL is valid for legacy records; new ingest must populate this field

COMMIT;
```

### 4.2 New Indexes

```sql
-- Primary filter for UI list views and export queries
CREATE INDEX IF NOT EXISTS contacts_sub_view_class_idx
  ON contacts (sub_account_id, view_class);

-- Filter for workflow automation (BullMQ workers need this)
CREATE INDEX IF NOT EXISTS contacts_sub_workflow_stage_idx
  ON contacts (sub_account_id, workflow_stage);

-- Export job index — only scans export_eligible=true rows
CREATE INDEX IF NOT EXISTS contacts_sub_export_eligible_idx
  ON contacts (sub_account_id, export_eligible)
  WHERE export_eligible = true;
```

The partial index on `export_eligible = true` is intentional: the vast majority of records are `export_eligible = false`. A standard B-tree index on a near-constant column wastes space and update cost; the partial index is tiny and only covers the rows the export pipeline actually touches.

### 4.3 New Table: incident_fingerprints

The `incident_fingerprint` concept requires its own table to avoid embedding a compound natural key in the `contacts` row. A fingerprint ties together multiple contact records that originate from the same crash event.

```sql
CREATE TABLE IF NOT EXISTS incident_fingerprints (
  id                   BIGSERIAL PRIMARY KEY,
  sub_account_id       INTEGER NOT NULL REFERENCES sub_accounts(id) ON DELETE CASCADE,
  fingerprint_hash     VARCHAR(64) NOT NULL,
  -- SHA-256 of: crash_date + location_lat_trunc + location_lon_trunc + raw_source_type
  -- Truncated to 4 decimal degrees (~11 m) to allow near-duplicate merging
  crash_date           DATE,
  raw_source_type      VARCHAR(100),
  county               VARCHAR(100),
  total_contacts       INTEGER NOT NULL DEFAULT 0,
  signal_count         INTEGER NOT NULL DEFAULT 0,
  incident_count       INTEGER NOT NULL DEFAULT 0,
  contact_count        INTEGER NOT NULL DEFAULT 0,
  opportunity_count    INTEGER NOT NULL DEFAULT 0,
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sub_account_id, fingerprint_hash)
);

CREATE INDEX IF NOT EXISTS incident_fingerprints_sub_county_idx
  ON incident_fingerprints (sub_account_id, county);

CREATE INDEX IF NOT EXISTS incident_fingerprints_sub_crash_date_idx
  ON incident_fingerprints (sub_account_id, crash_date DESC);
```

The `contacts` table references fingerprints via an optional foreign key added alongside the other columns:

```sql
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS incident_fingerprint_id BIGINT
    REFERENCES incident_fingerprints(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contacts_sub_fingerprint_idx
  ON contacts (sub_account_id, incident_fingerprint_id)
  WHERE incident_fingerprint_id IS NOT NULL;
```

### 4.4 Complete Column Delta Summary

| Column | Type | Default | Nullable | Notes |
|---|---|---|---|---|
| `view_class` | `TEXT` | `'signal'` | No | New; indexed |
| `workflow_stage` | `TEXT` | `'NEW'` | No | New; indexed |
| `export_eligible` | `BOOLEAN` | `false` | No | New; partial index |
| `lead_type` | `TEXT` | `NULL` | Yes | New; replaces ad-hoc `lead_vertical` mapping |
| `source_pipeline` | `TEXT` | `NULL` | Yes | New; audit trail for ingest path |
| `incident_fingerprint_id` | `BIGINT` | `NULL` | Yes | New FK to `incident_fingerprints` |

---

## 5. View Classification Rules

These rules define how `view_class` is assigned. They are applied both at ingest time (new records) and during the backfill migration (existing records). Rules are evaluated top-to-bottom; the first matching rule wins.

### 5.1 Classification Decision Table

| Priority | Condition | Assigned view_class | Rationale |
|---|---|---|---|
| 1 | `contact_quality_score > 0.75` AND `export_eligible = true` | `opportunity` | Quality-cleared, gate-cleared — deliverable |
| 2 | `identity_status = 'verified'` | `contact` | Person identity confirmed by enrichment provider |
| 3 | `normalized_phone IS NOT NULL` AND `normalized_phone != ''` | `contact` | Phone present is sufficient for outreach |
| 4 | `identity_status = 'placeholder'` AND `raw_source_type = 'crash'` | `incident` | Vehicle/plate known, person not yet resolved |
| 5 | `identity_status = 'placeholder'` | `incident` | Placeholder from any source |
| 6 | `identity_status = 'unidentified'` AND `raw_source_type = 'crash'` | `signal` | Pure crash event, no human link |
| 7 | *(catch-all)* | `signal` | All unclassified records default to signal |

### 5.2 SQL Derivation Expression

This expression can be used in both the migration backfill and as a computed-column equivalent for audit queries:

```sql
CASE
  WHEN contact_quality_score > 0.75 AND export_eligible = true
    THEN 'opportunity'
  WHEN identity_status = 'verified'
    THEN 'contact'
  WHEN normalized_phone IS NOT NULL AND normalized_phone != ''
    THEN 'contact'
  WHEN identity_status = 'placeholder'
    THEN 'incident'
  WHEN identity_status = 'unidentified' AND raw_source_type = 'crash'
    THEN 'signal'
  ELSE 'signal'
END AS view_class
```

### 5.3 Workflow Stage Assignment Rules

`workflow_stage` tracks the operational state of the record within its class. Initial values at ingest:

| Condition | Initial workflow_stage |
|---|---|
| `view_class = 'signal'` | `NEW` |
| `view_class = 'incident'` | `ENRICHING` (skip-trace queued) |
| `view_class = 'contact'` AND `skip_trace_status = 'matched'` | `READY` |
| `view_class = 'contact'` AND skip-trace not yet run | `ENRICHING` |
| `view_class = 'opportunity'` | `READY` |

Valid stage transitions:

```
NEW → ENRICHING → READY → CONTACTED → FOLLOW_UP → RETAINED
                                                 ↘ DEAD
                         → DEAD (skip-trace no_match or failed)
```

### 5.4 lead_type Mapping from Existing Columns

Where `lead_type` is not provided by the ingest pipeline, derive it from existing columns:

```sql
CASE
  WHEN lead_vertical ILIKE '%accident%' OR lead_vertical ILIKE '%crash%'
       OR raw_source_type ILIKE '%crash%'
    THEN 'accident'
  WHEN lead_vertical ILIKE '%personal injury%' OR lead_vertical ILIKE '%pi%'
    THEN 'pi'
  WHEN lead_vertical ILIKE '%storm%' OR lead_vertical ILIKE '%hail%'
    THEN 'storm'
  WHEN lead_vertical ILIKE '%property%' OR lead_vertical ILIKE '%water%'
    THEN 'property'
  WHEN lead_vertical ILIKE '%legal%'
    THEN 'legal'
  WHEN lead_vertical ILIKE '%permit%'
    THEN 'permit'
  WHEN lead_vertical IS NOT NULL
    THEN 'other'
  ELSE NULL
END AS lead_type
```

---

## 6. Migration Script Logic

The migration runs in three phases. Each phase is independently executable and idempotent. A failed phase can be re-run from its checkpoint without side effects.

### 6.1 Phase 1 — Schema Deployment (DDL)

Run first, before any data changes. All DDL changes are non-blocking `ADD COLUMN` operations on Postgres and will not lock existing reads or writes.

```sql
-- File: migrations/20260515_stage4b_view_class.sql

BEGIN;

-- Step 1: Add new columns to contacts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS view_class TEXT NOT NULL DEFAULT 'signal',
  ADD COLUMN IF NOT EXISTS workflow_stage TEXT NOT NULL DEFAULT 'NEW',
  ADD COLUMN IF NOT EXISTS export_eligible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lead_type TEXT,
  ADD COLUMN IF NOT EXISTS source_pipeline TEXT,
  ADD COLUMN IF NOT EXISTS incident_fingerprint_id BIGINT;

-- Step 2: Create incident_fingerprints table
CREATE TABLE IF NOT EXISTS incident_fingerprints (
  id                   BIGSERIAL PRIMARY KEY,
  sub_account_id       INTEGER NOT NULL REFERENCES sub_accounts(id) ON DELETE CASCADE,
  fingerprint_hash     VARCHAR(64) NOT NULL,
  crash_date           DATE,
  raw_source_type      VARCHAR(100),
  county               VARCHAR(100),
  total_contacts       INTEGER NOT NULL DEFAULT 0,
  signal_count         INTEGER NOT NULL DEFAULT 0,
  incident_count       INTEGER NOT NULL DEFAULT 0,
  contact_count        INTEGER NOT NULL DEFAULT 0,
  opportunity_count    INTEGER NOT NULL DEFAULT 0,
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sub_account_id, fingerprint_hash)
);

-- Step 3: Add FK after table exists
ALTER TABLE contacts
  ADD CONSTRAINT contacts_incident_fingerprint_fk
    FOREIGN KEY (incident_fingerprint_id)
    REFERENCES incident_fingerprints(id)
    ON DELETE SET NULL;

-- Step 4: Indexes
CREATE INDEX IF NOT EXISTS contacts_sub_view_class_idx
  ON contacts (sub_account_id, view_class);

CREATE INDEX IF NOT EXISTS contacts_sub_workflow_stage_idx
  ON contacts (sub_account_id, workflow_stage);

CREATE INDEX IF NOT EXISTS contacts_sub_export_eligible_idx
  ON contacts (sub_account_id, export_eligible)
  WHERE export_eligible = true;

CREATE INDEX IF NOT EXISTS contacts_sub_fingerprint_idx
  ON contacts (sub_account_id, incident_fingerprint_id)
  WHERE incident_fingerprint_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS incident_fingerprints_sub_county_idx
  ON incident_fingerprints (sub_account_id, county);

CREATE INDEX IF NOT EXISTS incident_fingerprints_sub_crash_date_idx
  ON incident_fingerprints (sub_account_id, crash_date DESC);

COMMIT;
```

### 6.2 Phase 2 — Safe Backfill (Batched DML)

Run after Phase 1 completes. The backfill processes existing records in batches of 500 to avoid long-running transactions and lock contention. It is idempotent: records already classified (where `view_class != 'signal'` OR where the derivation matches the stored value) are skipped in subsequent runs via the `WHERE` clause.

```sql
-- File: migrations/20260515_stage4b_backfill.sql
-- Run this in a loop until 0 rows updated

DO $$
DECLARE
  batch_size  INTEGER := 500;
  rows_updated INTEGER;
BEGIN
  LOOP
    -- Update view_class
    WITH batch AS (
      SELECT id
      FROM contacts
      WHERE view_class = 'signal'   -- only process unclassified records
        AND (
          identity_status IS NOT NULL
          OR normalized_phone IS NOT NULL
          OR raw_source_type IS NOT NULL
        )
      ORDER BY id
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE contacts c
    SET
      view_class = CASE
        WHEN c.contact_quality_score > 0.75 AND c.export_eligible = true
          THEN 'opportunity'
        WHEN c.identity_status = 'verified'
          THEN 'contact'
        WHEN c.normalized_phone IS NOT NULL AND c.normalized_phone != ''
          THEN 'contact'
        WHEN c.identity_status = 'placeholder'
          THEN 'incident'
        WHEN c.identity_status = 'unidentified' AND c.raw_source_type = 'crash'
          THEN 'signal'
        ELSE 'signal'
      END,
      workflow_stage = CASE
        WHEN c.skip_trace_status = 'matched' AND c.identity_status = 'verified'
          THEN 'READY'
        WHEN c.skip_trace_status IN ('pending', 'attempted')
          THEN 'ENRICHING'
        WHEN c.skip_trace_status = 'no_match' OR c.skip_trace_status = 'failed'
          THEN 'DEAD'
        ELSE 'NEW'
      END,
      lead_type = COALESCE(
        c.lead_type,  -- preserve if already set
        CASE
          WHEN c.lead_vertical ILIKE '%accident%' OR c.lead_vertical ILIKE '%crash%'
               OR c.raw_source_type ILIKE '%crash%'
            THEN 'accident'
          WHEN c.lead_vertical ILIKE '%personal injury%' OR c.lead_vertical ILIKE '%pi%'
            THEN 'pi'
          WHEN c.lead_vertical ILIKE '%storm%' OR c.lead_vertical ILIKE '%hail%'
            THEN 'storm'
          WHEN c.lead_vertical ILIKE '%property%' OR c.lead_vertical ILIKE '%water%'
            THEN 'property'
          WHEN c.lead_vertical ILIKE '%legal%'
            THEN 'legal'
          WHEN c.lead_vertical ILIKE '%permit%'
            THEN 'permit'
          WHEN c.lead_vertical IS NOT NULL
            THEN 'other'
          ELSE NULL
        END
      ),
      source_pipeline = COALESCE(
        c.source_pipeline,  -- preserve if already set
        CASE
          WHEN c.raw_source_type ILIKE '%crash%' OR c.raw_source_type ILIKE '%flhsmv%'
            THEN 'flhsmv_crash'
          WHEN c.raw_source_type ILIKE '%sentinel%'
            THEN 'apex_sentinel'
          WHEN c.raw_source_type ILIKE '%form%'
            THEN 'form_submit'
          WHEN c.raw_source_type ILIKE '%webhook%'
            THEN 'webhook'
          ELSE 'manual_import'
        END
      )
    FROM batch
    WHERE c.id = batch.id;

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    EXIT WHEN rows_updated = 0;

    RAISE NOTICE 'Backfill batch: % rows updated', rows_updated;
    PERFORM pg_sleep(0.05);  -- 50ms courtesy pause between batches
  END LOOP;
END $$;
```

### 6.3 Phase 3 — Verification Query

Run after Phase 2 to confirm the distribution looks correct before enabling index-backed queries in application code:

```sql
SELECT
  view_class,
  workflow_stage,
  COUNT(*) AS record_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS pct_of_total,
  COUNT(*) FILTER (WHERE export_eligible = true) AS export_eligible_count,
  AVG(contact_quality_score) AS avg_quality_score
FROM contacts
GROUP BY view_class, workflow_stage
ORDER BY view_class, workflow_stage;
```

Expected output shape (values will vary by account):

```
view_class   | workflow_stage | record_count | pct_of_total | export_eligible_count
-------------+----------------+--------------+--------------+----------------------
signal       | NEW            |         1200 |        57.14 |                     0
incident     | NEW            |          450 |        21.43 |                     0
incident     | ENRICHING      |           80 |         3.81 |                     0
contact      | ENRICHING      |          120 |         5.71 |                     0
contact      | READY          |          200 |         9.52 |                     0
contact      | DEAD           |           40 |         1.90 |                     0
opportunity  | READY          |           10 |         0.48 |                    10
```

Zero records in `opportunity` with `export_eligible = false` is a hard invariant. If this check fails, the backfill has a logic error.

---

## 7. Ingestion Pipeline Changes

### 7.1 Principle

New records must have `view_class`, `workflow_stage`, `lead_type`, and `source_pipeline` set at the point of insert. The backfill covers historical records; new ingestion must not depend on the backfill running again.

### 7.2 Classification Helper (TypeScript)

Add this function to `server/lib/contactClassifier.ts` (new file):

```typescript
// server/lib/contactClassifier.ts

export type ViewClass = 'signal' | 'incident' | 'contact' | 'opportunity';
export type WorkflowStage = 'NEW' | 'ENRICHING' | 'READY' | 'CONTACTED' | 'FOLLOW_UP' | 'RETAINED' | 'DEAD';
export type LeadType = 'accident' | 'pi' | 'storm' | 'property' | 'legal' | 'permit' | 'other';

interface ClassificationInput {
  identityStatus?: string | null;
  normalizedPhone?: string | null;
  rawSourceType?: string | null;
  contactQualityScore?: number | null;
  exportEligible?: boolean;
  skipTraceStatus?: string | null;
  leadVertical?: string | null;
}

/**
 * Derives view_class from existing column values.
 * Rules are evaluated in priority order; first match wins.
 * This function must remain pure — no DB calls, no side effects.
 */
export function deriveViewClass(input: ClassificationInput): ViewClass {
  const {
    identityStatus,
    normalizedPhone,
    rawSourceType,
    contactQualityScore,
    exportEligible,
  } = input;

  if (contactQualityScore != null && contactQualityScore > 0.75 && exportEligible === true) {
    return 'opportunity';
  }
  if (identityStatus === 'verified') {
    return 'contact';
  }
  if (normalizedPhone != null && normalizedPhone !== '') {
    return 'contact';
  }
  if (identityStatus === 'placeholder') {
    return 'incident';
  }
  // signal is the catch-all, including identityStatus='unidentified'
  return 'signal';
}

/**
 * Derives initial workflow_stage for a new record.
 * Only call this at insert time; stage transitions after that
 * are driven by enrichment workers.
 */
export function deriveInitialWorkflowStage(
  viewClass: ViewClass,
  skipTraceStatus?: string | null,
): WorkflowStage {
  if (skipTraceStatus === 'matched') return 'READY';
  if (skipTraceStatus === 'no_match' || skipTraceStatus === 'failed') return 'DEAD';
  if (skipTraceStatus === 'pending' || skipTraceStatus === 'attempted') return 'ENRICHING';
  if (viewClass === 'incident') return 'ENRICHING'; // incident implies skip-trace will be queued
  return 'NEW';
}

/**
 * Derives lead_type from lead_vertical and raw_source_type.
 * Returns null if no mapping can be made — that is valid for legacy records.
 */
export function deriveLeadType(
  leadVertical?: string | null,
  rawSourceType?: string | null,
): LeadType | null {
  const combined = [leadVertical, rawSourceType]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (combined.includes('accident') || combined.includes('crash') || combined.includes('flhsmv')) {
    return 'accident';
  }
  if (combined.includes('personal injury') || combined.includes(' pi ') || combined.includes('pi-')) {
    return 'pi';
  }
  if (combined.includes('storm') || combined.includes('hail') || combined.includes('wind')) {
    return 'storm';
  }
  if (combined.includes('property') || combined.includes('water') || combined.includes('flood')) {
    return 'property';
  }
  if (combined.includes('legal')) {
    return 'legal';
  }
  if (combined.includes('permit')) {
    return 'permit';
  }
  if (leadVertical != null) {
    return 'other';
  }
  return null;
}

/**
 * Derives source_pipeline from raw_source_type.
 */
export function deriveSourcePipeline(rawSourceType?: string | null): string {
  if (!rawSourceType) return 'manual_import';
  const r = rawSourceType.toLowerCase();
  if (r.includes('crash') || r.includes('flhsmv')) return 'flhsmv_crash';
  if (r.includes('sentinel')) return 'apex_sentinel';
  if (r.includes('form')) return 'form_submit';
  if (r.includes('webhook')) return 'webhook';
  return 'manual_import';
}
```

### 7.3 Crash Ingest Pipeline Integration

In the crash ingest handler (wherever `db.insert(contacts)` is called for crash records), add the classification fields:

```typescript
import {
  deriveViewClass,
  deriveInitialWorkflowStage,
  deriveLeadType,
  deriveSourcePipeline,
} from '../lib/contactClassifier';

// Inside the ingest handler, before db.insert():
const viewClass = deriveViewClass({
  identityStatus: record.identityStatus,
  normalizedPhone: record.normalizedPhone,
  rawSourceType: record.rawSourceType,
  contactQualityScore: record.contactQualityScore,
  exportEligible: false,          // new records never start export-eligible
  skipTraceStatus: record.skipTraceStatus,
});

const workflowStage = deriveInitialWorkflowStage(viewClass, record.skipTraceStatus);
const leadType = deriveLeadType(record.leadVertical, record.rawSourceType);
const sourcePipeline = deriveSourcePipeline(record.rawSourceType);

await db.insert(contacts).values({
  ...record,                       // all existing fields unchanged
  viewClass,
  workflowStage,
  exportEligible: false,
  leadType,
  sourcePipeline,
});
```

### 7.4 Enrichment Worker: Promotion Trigger

When the skip-trace worker completes (success or failure), it must update `view_class` and `workflow_stage` to reflect the new enrichment state:

```typescript
// Inside the skip-trace completion handler

import { deriveViewClass } from '../lib/contactClassifier';

const updatedViewClass = deriveViewClass({
  identityStatus: enrichedRecord.identityStatus,
  normalizedPhone: enrichedRecord.normalizedPhone,
  rawSourceType: enrichedRecord.rawSourceType,
  contactQualityScore: enrichedRecord.contactQualityScore,
  exportEligible: enrichedRecord.exportEligible,
});

await db
  .update(contacts)
  .set({
    // enrichment fields written by the existing worker — unchanged
    identityStatus: enrichedRecord.identityStatus,
    normalizedPhone: enrichedRecord.normalizedPhone,
    enrichmentProvider: enrichedRecord.enrichmentProvider,
    enrichmentCompletedAt: new Date(),
    enrichmentConfidence: enrichedRecord.enrichmentConfidence,
    skipTraceStatus: enrichedRecord.skipTraceStatus,
    // NEW: classification fields updated atomically with enrichment result
    viewClass: updatedViewClass,
    workflowStage: enrichedRecord.skipTraceStatus === 'matched' ? 'READY'
                 : enrichedRecord.skipTraceStatus === 'no_match' ? 'DEAD'
                 : enrichedRecord.skipTraceStatus === 'failed' ? 'DEAD'
                 : 'ENRICHING',
  })
  .where(eq(contacts.id, enrichedRecord.id));
```

### 7.5 Export Gate: Setting export_eligible

`export_eligible` must only be set to `true` by the export quality gate, not by the ingest or enrichment pipelines. The gate checks:

```typescript
// Export quality gate — runs after enrichment completes for a READY contact

const isExportEligible = (
  contact.contactQualityScore != null &&
  contact.contactQualityScore > 0.75 &&
  contact.skipTraceStatus === 'matched' &&
  contact.identityStatus === 'verified' &&
  contact.normalizedPhone != null &&
  contact.normalizedPhone !== ''
);

if (isExportEligible) {
  await db
    .update(contacts)
    .set({
      exportEligible: true,
      viewClass: 'opportunity',   // promote atomically
      workflowStage: 'READY',
    })
    .where(eq(contacts.id, contact.id));
}
```

---

## 8. What Does Not Change

This section is a hard commitment. The following components are not modified in Stage 4B.

### 8.1 Existing API Routes

| Route | Current Behavior | Change in Stage 4B |
|---|---|---|
| `GET /api/contacts` | Returns all contacts filtered by sub_account_id | **None** — existing filter parameters still work |
| `GET /api/contacts/:id` | Single contact fetch | **None** |
| `POST /api/contacts` | Create contact | **None** — new columns get defaults; caller need not supply them |
| `PATCH /api/contacts/:id` | Update contact | **None** — callers that don't send view_class leave it unchanged |
| `DELETE /api/contacts/:id` | Soft delete | **None** |

The `getContacts()` function signature in `server/storage.ts` (or equivalent) is not changed. `view_class` becomes an optional filter parameter that callers may supply; if omitted, behavior is identical to today.

### 8.2 Existing Ingestion Pipelines

All pipelines that currently write to `contacts` continue to function. The new columns have defaults:
- `view_class` defaults to `'signal'`
- `workflow_stage` defaults to `'NEW'`
- `export_eligible` defaults to `false`
- `lead_type` defaults to `NULL`
- `source_pipeline` defaults to `NULL`

An ingest pipeline that does not supply the new columns produces a `signal` at stage `NEW` — which is the correct classification for any record that has not explicitly been enriched.

### 8.3 Existing Routing Logic

The routing engine reads `lead_vertical`, `county`, `normalizedPhone`, and `contactQualityScore`. None of these columns change. `view_class` is not referenced by routing logic in Stage 4B.

### 8.4 Existing Export Jobs

The current export job runs a filter query. In Stage 4B, that query continues to function on the existing column set. After Stage 4B validation gates pass, the export job may be updated in a follow-on task to add `AND view_class = 'opportunity'` — but that update is not part of this stage and is not required for Stage 4B to be considered complete.

### 8.5 OCR, Semantic Search, Autonomous Agents

These capabilities are explicitly out of scope for Stage 4B. No vector operations, no embedding lookups, no LLM calls are introduced by this change.

---

## 9. Validation Gates

All six gates must pass before Stage 4B is marked complete. Run these after Phase 2 (backfill) finishes.

### Gate 1: No NULL view_class Values

```sql
SELECT COUNT(*) AS null_view_class_count
FROM contacts
WHERE view_class IS NULL;
-- Expected: 0
```

### Gate 2: No NULL workflow_stage Values

```sql
SELECT COUNT(*) AS null_workflow_stage_count
FROM contacts
WHERE workflow_stage IS NULL;
-- Expected: 0
```

### Gate 3: Opportunity Integrity — No export_eligible=true Non-Opportunities

```sql
SELECT COUNT(*) AS corrupt_export_eligible_count
FROM contacts
WHERE export_eligible = true
  AND view_class != 'opportunity';
-- Expected: 0
-- Rationale: export_eligible=true is only valid for view_class='opportunity'
```

### Gate 4: view_class / identity_status Consistency

```sql
SELECT COUNT(*) AS inconsistent_verified_count
FROM contacts
WHERE identity_status = 'verified'
  AND view_class NOT IN ('contact', 'opportunity');
-- Expected: 0
-- Rationale: a verified identity must be classified as at least 'contact'
```

### Gate 5: Index Existence

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'contacts'
  AND indexname IN (
    'contacts_sub_view_class_idx',
    'contacts_sub_workflow_stage_idx',
    'contacts_sub_export_eligible_idx',
    'contacts_sub_fingerprint_idx'
  );
-- Expected: 4 rows returned
```

### Gate 6: Backfill Coverage — No Unclassified Records with Known Identity

```sql
SELECT COUNT(*) AS unclassified_with_identity
FROM contacts
WHERE view_class = 'signal'
  AND identity_status IN ('verified', 'placeholder');
-- Expected: 0
-- Rationale: any record with a known identity_status must be 'incident' or higher
```

### Gate Pass Criteria

All six queries must return their expected value. If any gate fails:
1. Do not update application code to rely on `view_class` for filtering
2. Diagnose the backfill logic error against the failing records
3. Re-run Phase 2 (idempotent) with the corrected classification expression
4. Re-run all six gates

---

## 10. Rollback Plan

### 10.1 Risk Assessment

Stage 4B DDL changes are all `ADD COLUMN` and `CREATE TABLE` / `CREATE INDEX` operations. No existing column is altered, renamed, or dropped. No existing default is changed. Rollback risk is therefore low: the application continues to function on the pre-Stage-4B code path even if the new columns are present.

### 10.2 Rollback Scenarios

**Scenario A: Migration fails mid-DDL (Phase 1)**

The migration script runs in a single transaction. If it fails, Postgres rolls back the entire transaction. No partial state exists. Re-run Phase 1 after diagnosing the error.

**Scenario B: Backfill corrupts data (Phase 2)**

The backfill updates `view_class`, `workflow_stage`, `lead_type`, and `source_pipeline`. None of these are read by existing application code paths before Stage 4B validation is complete. To rollback:

```sql
-- Reset all backfill-written columns to defaults (idempotent)
UPDATE contacts
SET
  view_class     = 'signal',
  workflow_stage = 'NEW',
  lead_type      = NULL,
  source_pipeline = NULL
WHERE true;
-- Then re-run Phase 2 with corrected logic
```

**Scenario C: Application code referencing new columns causes errors**

New application code that reads `view_class` can be reverted via a standard git revert and Railway redeploy. The columns remain in the schema but are no longer queried. No data loss.

**Scenario D: Need to fully remove Stage 4B schema**

Only execute this if the schema additions must be completely removed (not just ignored):

```sql
-- DROP must be performed in dependency order
BEGIN;

ALTER TABLE contacts DROP COLUMN IF EXISTS incident_fingerprint_id;
ALTER TABLE contacts DROP COLUMN IF EXISTS view_class;
ALTER TABLE contacts DROP COLUMN IF EXISTS workflow_stage;
ALTER TABLE contacts DROP COLUMN IF EXISTS export_eligible;
ALTER TABLE contacts DROP COLUMN IF EXISTS lead_type;
ALTER TABLE contacts DROP COLUMN IF EXISTS source_pipeline;

DROP TABLE IF EXISTS incident_fingerprints CASCADE;

COMMIT;
```

This is a destructive operation. It should not be needed in a normal rollback scenario since the columns are additive and do not break existing code. Execute Scenario D only on explicit architect sign-off.

### 10.3 Rollback Decision Checklist

Before executing any rollback:

- [ ] Are all six validation gates failing, or only some?
- [ ] Is the failure in the schema (DDL) or the backfill data (DML)?
- [ ] Is existing application traffic affected, or only the new classification queries?
- [ ] Has the backfill-reset SQL (Scenario B) been attempted?
- [ ] Is the rollback to a previous git commit required, or is a data-only fix sufficient?

If only one or two gates fail and existing traffic is unaffected, prefer fixing the backfill expression over executing a full rollback.

---

## Appendix A: Column Reference — contacts Table After Stage 4B

| Column | Type | Nullable | Default | Source |
|---|---|---|---|---|
| `identity_status` | `varchar(50)` | Yes | `NULL` | Stage 3 drift fix |
| `skip_trace_status` | `varchar(50)` | Yes | `NULL` | Stage 3 drift fix |
| `enrichment_provider` | `varchar(100)` | Yes | `NULL` | Stage 3 drift fix |
| `enrichment_attempted_at` | `timestamptz` | Yes | `NULL` | Stage 3 drift fix |
| `enrichment_completed_at` | `timestamptz` | Yes | `NULL` | Stage 3 drift fix |
| `enrichment_confidence` | `numeric(5,2)` | Yes | `NULL` | Stage 3 drift fix |
| `source_external_id` | `varchar(255)` | Yes | `NULL` | Stage 3 drift fix |
| `raw_source_type` | `varchar(100)` | Yes | `NULL` | Stage 3 drift fix |
| `lead_vertical` | `varchar(100)` | Yes | `NULL` | Stage 3 drift fix |
| `lead_subtype` | `varchar(100)` | Yes | `NULL` | Stage 3 drift fix |
| `normalized_phone` | `varchar(20)` | Yes | `NULL` | Stage 3 drift fix |
| `normalized_email` | `varchar(255)` | Yes | `NULL` | Stage 3 drift fix |
| `county` | `varchar(100)` | Yes | `NULL` | Stage 3 drift fix |
| `contact_quality_score` | `numeric(5,2)` | Yes | `NULL` | Stage 3 drift fix |
| **`view_class`** | **`text`** | **No** | **`'signal'`** | **Stage 4B — NEW** |
| **`workflow_stage`** | **`text`** | **No** | **`'NEW'`** | **Stage 4B — NEW** |
| **`export_eligible`** | **`boolean`** | **No** | **`false`** | **Stage 4B — NEW** |
| **`lead_type`** | **`text`** | **Yes** | **`NULL`** | **Stage 4B — NEW** |
| **`source_pipeline`** | **`text`** | **Yes** | **`NULL`** | **Stage 4B — NEW** |
| **`incident_fingerprint_id`** | **`bigint`** | **Yes** | **`NULL`** | **Stage 4B — NEW** |

---

## Appendix B: Full Index List — contacts Table After Stage 4B

| Index Name | Columns | Type | Partial? |
|---|---|---|---|
| `contacts_sub_skip_status_idx` | `(sub_account_id, skip_trace_status)` | B-tree | No |
| `contacts_sub_identity_status_idx` | `(sub_account_id, identity_status)` | B-tree | No |
| `contacts_sub_external_id_idx` | `(sub_account_id, source_external_id)` | B-tree | No |
| `contacts_sub_phone_idx` | `(sub_account_id, normalized_phone)` | B-tree | No |
| `contacts_sub_vertical_idx` | `(sub_account_id, lead_vertical)` | B-tree | No |
| `contacts_sub_view_class_idx` | `(sub_account_id, view_class)` | B-tree | No |
| `contacts_sub_workflow_stage_idx` | `(sub_account_id, workflow_stage)` | B-tree | No |
| `contacts_sub_export_eligible_idx` | `(sub_account_id, export_eligible)` | B-tree | `WHERE export_eligible = true` |
| `contacts_sub_fingerprint_idx` | `(sub_account_id, incident_fingerprint_id)` | B-tree | `WHERE incident_fingerprint_id IS NOT NULL` |
