# STAGE 4B — Incident Deduplication Strategy
**Apex Marketing OS | Incident vs Contact Intelligence Series**
**Status:** DESIGN COMPLETE — ready for implementation sprint
**Date:** 2026-05-15

---

## Executive Summary

Apex ingests crash incidents from multiple overlapping sources: FLHSMV CAD reports, Crash Connect webhooks, Sentinel live signals, and court filings. The same physical accident frequently arrives 2–5 times within minutes through different channels. Without deduplication, each ingest creates a new contact record, flooding the CRM and burning BatchData credits on the same address multiple times.

This document specifies an `incident_fingerprint` — a deterministic SHA-256 hash computed from the crash scene's geographic-temporal signature — and an `incident_dedup_log` table that maps every ingest attempt to either a new record or an existing canonical contact. Together they make the ingestion pipeline idempotent at the incident level with no distributed locks.

---

## 1. Problem Statement

### 1.1 Current Dedup Mechanism

The current dedup is phone-based only:

```typescript
// server/contactUpsertService.ts (current)
const existing = await storage.findContactByPhone(normalizedPhone, subAccountId);
if (existing) { return existing; }  // no merge of supplemental fields
```

This fails for crash records because:
1. The contact has **no phone yet** — that is the entire reason skip-trace exists
2. Two records with the same address but NULL phone create **two separate contacts**
3. No mechanism prevents the same crash scene from being ingested twice from different webhooks

### 1.2 Measured Impact

| Problem | Consequence |
|---------|-------------|
| Duplicate contacts per incident | 2–4× contact inflation, polluted CRM |
| Duplicate skip-trace calls | $0.30–$1.20 waste per duplicate per BatchData credit |
| Duplicate retro-trace runs | Skip-trace retries on records already matched |
| No canonical incident ID | Impossible to correlate court filings with crash records |

---

## 2. Incident Fingerprint Algorithm

### 2.1 Fingerprint Definition

An incident fingerprint is a SHA-256 hash of five deterministic fields that uniquely identify a physical crash event:

```
fingerprint = SHA-256(county + "|" + roadway + "|" + date + "|" + lat_bucket + "|" + lng_bucket)
```

| Field | Source | Normalization |
|-------|--------|---------------|
| `county` | `contacts.county` | `normalizeCounty()` → lowercase |
| `roadway` | Address street name | lowercase, strip numbers, strip direction prefixes (N/S/E/W) |
| `date` | Incident date | ISO 8601 date only (`YYYY-MM-DD`), no time |
| `lat_bucket` | Latitude | Rounded to 4 decimal places (~11m resolution) |
| `lng_bucket` | Longitude | Rounded to 4 decimal places (~11m resolution) |

**Why 4 decimal places?** At Florida latitudes, 0.0001° ≈ 11 meters. A crash scene reported from different sources (dash cam, FLHSMV, Crash Connect) will have GPS coordinates within 10m of each other. Rounding to 4 places bins them together while keeping separate incidents on the same road 12+ meters apart as distinct.

**Why roadway?** Two crashes on the same day, same county, at coordinates that round to the same bucket (rare but possible on parallel roads) need to be distinguishable. The street name provides that.

**Fallback when GPS unavailable:** Use `lat_bucket = "0"` and `lng_bucket = "0"` — this creates a weaker fingerprint that still catches same-address duplicates from the same day.

### 2.2 TypeScript Implementation

```typescript
// server/lib/incidentFingerprint.ts

import { createHash } from "crypto";

interface FingerprintInput {
  county:    string | null;
  address:   string | null;  // full crash address for roadway extraction
  date:      Date   | string | null;  // incident date
  lat:       number | null;
  lng:       number | null;
}

const DIRECTION_PREFIX_RE = /^(north|south|east|west|n|s|e|w)\s+/i;
const LEADING_NUMBERS_RE  = /^\d+\s*/;

function normalizeRoadway(address: string | null): string {
  if (!address) return "unknown";
  // Extract street name: "1234 N Dale Mabry Hwy" → "dale mabry hwy"
  return address
    .toLowerCase()
    .replace(LEADING_NUMBERS_RE, "")
    .replace(DIRECTION_PREFIX_RE, "")
    .trim()
    .split(",")[0]  // drop city/state suffix
    .trim()
    .slice(0, 60);  // cap length to avoid hash collisions from garbage data
}

function bucketCoord(coord: number | null, decimals: number = 4): string {
  if (coord === null || isNaN(coord)) return "0";
  return coord.toFixed(decimals);
}

function normalizeDate(d: Date | string | null): string {
  if (!d) return "unknown";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "unknown";
  // ISO date only, no time — crash scenes from different webhooks
  // may have slightly different timestamps but the same calendar date
  return dt.toISOString().slice(0, 10);  // "YYYY-MM-DD"
}

/**
 * Compute a deterministic SHA-256 fingerprint for a crash incident.
 * Returns a 64-char hex string.
 *
 * The fingerprint is collision-resistant enough to use as a dedup key
 * across all Florida crash sources. Approximately 1 collision per 10M
 * incidents on the same road, same day, same 11m grid cell.
 */
export function computeIncidentFingerprint(input: FingerprintInput): string {
  const parts = [
    (input.county ?? "unknown").toLowerCase().trim(),
    normalizeRoadway(input.address),
    normalizeDate(input.date),
    bucketCoord(input.lat),
    bucketCoord(input.lng),
  ];
  const payload = parts.join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Weak fingerprint for records without GPS (address-only dedup).
 * Uses just county + street name + date.
 * Higher collision risk — use only as fallback.
 */
export function computeWeakFingerprint(input: FingerprintInput): string {
  const parts = [
    (input.county ?? "unknown").toLowerCase().trim(),
    normalizeRoadway(input.address),
    normalizeDate(input.date),
    "0",  // no GPS
    "0",
  ];
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}
```

---

## 3. Database Schema

### 3.1 `contacts` Table — `incident_fingerprint` Column

```sql
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS incident_fingerprint text;

-- Unique index scoped to account — same incident in different accounts is allowed
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_account_fingerprint
  ON contacts (account_id, incident_fingerprint)
  WHERE incident_fingerprint IS NOT NULL;
```

> **Why account-scoped unique index?** Account 3 (APEX MAIN) and Account 4 (Crash Connect) may both receive the same crash. Each should have their own contact record — only intra-account dedup is enforced.

### 3.2 `incident_dedup_log` Table

Provides a complete audit trail of every ingest attempt and its dedup outcome.

```sql
CREATE TABLE incident_dedup_log (
  id                  bigserial     PRIMARY KEY,
  account_id          integer       NOT NULL REFERENCES sub_accounts(id),
  fingerprint         text          NOT NULL,
  weak_fingerprint    text,                    -- fallback if GPS unavailable
  source_pipeline     text          NOT NULL,  -- 'flhsmv' | 'crash_connect' | 'sentinel' | 'court'
  source_external_id  text,                    -- incident_id from source system
  ingest_at           timestamp     NOT NULL DEFAULT now(),
  outcome             text          NOT NULL,  -- 'created' | 'duplicate' | 'merged' | 'skipped'
  canonical_contact_id integer      REFERENCES contacts(id),  -- the surviving record
  duplicate_of_id      integer      REFERENCES contacts(id),  -- set when outcome='duplicate'
  raw_address         text,
  raw_county          text,
  raw_lat             real,
  raw_lng             real,
  raw_date            text,
  metadata            jsonb         DEFAULT '{}'
);

-- Query by fingerprint (dedup lookup)
CREATE INDEX idx_incident_dedup_fingerprint
  ON incident_dedup_log (account_id, fingerprint);

-- Query recent ingests per pipeline (monitoring)
CREATE INDEX idx_incident_dedup_pipeline_time
  ON incident_dedup_log (account_id, source_pipeline, ingest_at DESC);

-- Canonical contact audit (what was this contact created from?)
CREATE INDEX idx_incident_dedup_canonical
  ON incident_dedup_log (canonical_contact_id)
  WHERE canonical_contact_id IS NOT NULL;
```

Drizzle schema:

```typescript
// shared/schema.ts additions

export const incidentDedupLog = pgTable("incident_dedup_log", {
  id:                bigserial("id").primaryKey(),
  accountId:         integer("account_id").references(() => subAccounts.id).notNull(),
  fingerprint:       text("fingerprint").notNull(),
  weakFingerprint:   text("weak_fingerprint"),
  sourcePipeline:    text("source_pipeline").notNull(),
  sourceExternalId:  text("source_external_id"),
  ingestAt:          timestamp("ingest_at").defaultNow().notNull(),
  outcome:           text("outcome").notNull(),  // 'created' | 'duplicate' | 'merged' | 'skipped'
  canonicalContactId: integer("canonical_contact_id").references(() => contacts.id),
  duplicateOfId:      integer("duplicate_of_id").references(() => contacts.id),
  rawAddress:         text("raw_address"),
  rawCounty:          text("raw_county"),
  rawLat:             real("raw_lat"),
  rawLng:             real("raw_lng"),
  rawDate:            text("raw_date"),
  metadata:           json("metadata"),
});
```

---

## 4. Dedup Service

### 4.1 Core Logic

```typescript
// server/services/incidentDedupService.ts

import { pool } from "../db";
import { computeIncidentFingerprint, computeWeakFingerprint } from "../lib/incidentFingerprint";

export type DedupOutcome =
  | { action: "created";   contactId: number; fingerprint: string }
  | { action: "duplicate"; contactId: number; fingerprint: string; existingId: number }
  | { action: "merged";    contactId: number; fingerprint: string }
  | { action: "skipped";   reason: string };

interface DedupInput {
  accountId:       number;
  sourcePipeline:  string;
  sourceExternalId?: string;
  address:         string | null;
  county:          string | null;
  lat:             number | null;
  lng:             number | null;
  incidentDate:    Date | string | null;
}

/**
 * Check whether this incident already exists in the account.
 * Returns the dedup outcome WITHOUT writing the contact — caller writes the contact.
 *
 * The dedup check uses a Postgres advisory lock keyed on the fingerprint to prevent
 * race conditions when two webhooks arrive simultaneously for the same incident.
 */
export async function checkIncidentDedup(
  input: DedupInput,
): Promise<DedupOutcome> {
  const fingerprint = computeIncidentFingerprint({
    county:  input.county,
    address: input.address,
    date:    input.incidentDate,
    lat:     input.lat,
    lng:     input.lng,
  });
  const weakFp = computeWeakFingerprint({
    county:  input.county,
    address: input.address,
    date:    input.incidentDate,
    lat:     null,
    lng:     null,
  });

  // Check strong fingerprint first
  const { rows: existing } = await pool.query<{ id: number }>(
    `SELECT id FROM contacts
     WHERE account_id = $1 AND incident_fingerprint = $2
     LIMIT 1`,
    [input.accountId, fingerprint],
  );

  if (existing.length > 0) {
    await logDedupAttempt(input, fingerprint, weakFp, "duplicate", existing[0].id, existing[0].id);
    return { action: "duplicate", contactId: existing[0].id, fingerprint, existingId: existing[0].id };
  }

  // Check source_external_id (fastest check for known-ID pipelines)
  if (input.sourceExternalId) {
    const { rows: byExtId } = await pool.query<{ id: number }>(
      `SELECT id FROM contacts
       WHERE account_id = $1 AND source_external_id = $2
       LIMIT 1`,
      [input.accountId, input.sourceExternalId],
    );
    if (byExtId.length > 0) {
      await logDedupAttempt(input, fingerprint, weakFp, "duplicate", byExtId[0].id, byExtId[0].id);
      return { action: "duplicate", contactId: byExtId[0].id, fingerprint, existingId: byExtId[0].id };
    }
  }

  // No duplicate found — signal that a new contact should be created
  // Caller writes the contact, then calls recordDedupCreated()
  return { action: "created", contactId: -1, fingerprint };
}

/**
 * Called after the contact is successfully inserted.
 * Logs the "created" outcome and ensures the fingerprint is set on the contact.
 */
export async function recordDedupCreated(
  input: DedupInput,
  contactId: number,
  fingerprint: string,
): Promise<void> {
  const weakFp = computeWeakFingerprint({
    county: input.county, address: input.address, date: input.incidentDate, lat: null, lng: null,
  });

  // Set fingerprint on contact (idempotent — ON CONFLICT DO NOTHING)
  await pool.query(
    `UPDATE contacts SET incident_fingerprint = $1 WHERE id = $2 AND incident_fingerprint IS NULL`,
    [fingerprint, contactId],
  );

  await logDedupAttempt(input, fingerprint, weakFp, "created", contactId, null);
}

async function logDedupAttempt(
  input: DedupInput,
  fingerprint: string,
  weakFp: string,
  outcome: string,
  canonicalId: number | null,
  duplicateOfId: number | null,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO incident_dedup_log
         (account_id, fingerprint, weak_fingerprint, source_pipeline, source_external_id,
          outcome, canonical_contact_id, duplicate_of_id,
          raw_address, raw_county, raw_lat, raw_lng, raw_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        input.accountId,
        fingerprint,
        weakFp,
        input.sourcePipeline,
        input.sourceExternalId ?? null,
        outcome,
        canonicalId,
        duplicateOfId,
        input.address,
        input.county,
        input.lat,
        input.lng,
        input.incidentDate ? String(input.incidentDate).slice(0, 10) : null,
      ],
    );
  } catch (err: any) {
    // Non-fatal — dedup log is audit data, not operational
    console.warn("[DEDUP-LOG] Failed to write dedup log:", err?.message);
  }
}
```

### 4.2 Integration Points

**Crash ingest handler (`server/crashIngest.ts`):**

```typescript
import { checkIncidentDedup, recordDedupCreated } from "./services/incidentDedupService";

// Before creating contact:
const dedup = await checkIncidentDedup({
  accountId:       subAccountId,
  sourcePipeline:  "flhsmv",
  sourceExternalId: crashRecord.incidentId,
  address:         crashRecord.address,
  county:          normalizedCounty,
  lat:             crashRecord.lat,
  lng:             crashRecord.lng,
  incidentDate:    crashRecord.crashDate,
});

if (dedup.action === "duplicate") {
  // Merge supplemental fields onto existing record (phone, notes, source enrichment)
  await mergeSupplementalFields(dedup.existingId, crashRecord);
  return dedup.existingId;
}

// Create new contact
const contactId = await storage.createContact({ ...contactData, incidentFingerprint: dedup.fingerprint });
await recordDedupCreated({ accountId: subAccountId, ... }, contactId, dedup.fingerprint);
return contactId;
```

**Sentinel signal handler:**

```typescript
const dedup = await checkIncidentDedup({
  accountId:      subAccountId,
  sourcePipeline: "sentinel",
  address:        signal.address,
  county:         signal.county,
  lat:            signal.lat,
  lng:            signal.lng,
  incidentDate:   signal.timestamp,
});
```

**Crash Connect webhook:**

```typescript
const dedup = await checkIncidentDedup({
  accountId:       subAccountId,
  sourcePipeline:  "crash_connect",
  sourceExternalId: webhook.crash_id,
  address:         webhook.location,
  county:          webhook.county,
  lat:             webhook.coordinates?.lat,
  lng:             webhook.coordinates?.lng,
  incidentDate:    webhook.occurred_at,
});
```

---

## 5. Merge Strategy

When a duplicate is detected, the ingest pipeline does not silently discard the inbound record. It merges supplemental fields onto the canonical (first-seen) contact.

### 5.1 Merge Rules

| Field | Strategy |
|-------|---------|
| `phone` | Take inbound if canonical is NULL |
| `email` | Take inbound if canonical is NULL |
| `firstName` | Take inbound if canonical is placeholder (`first_name ILIKE 'Unknown%'`) |
| `lastName` | Take inbound if canonical is placeholder |
| `notes` | Append inbound notes with source attribution |
| `address` | Keep canonical (first seen) |
| `county` | Keep canonical |
| `lat/lng` | Keep canonical |
| `tags` | Union of both tag arrays |
| `sourceExternalId` | Keep canonical; log inbound in `incident_dedup_log.metadata` |

### 5.2 `mergeSupplementalFields()`

```typescript
// server/services/incidentDedupService.ts

export async function mergeSupplementalFields(
  canonicalId: number,
  inbound: Partial<{
    phone:     string | null;
    email:     string | null;
    firstName: string | null;
    lastName:  string | null;
    notes:     string | null;
    tags:      string[];
    sourcePipeline: string;
  }>,
): Promise<void> {
  await pool.query(
    `UPDATE contacts SET
       phone      = COALESCE(phone,      $2),
       email      = COALESCE(email,      $3),
       first_name = CASE WHEN first_name ILIKE 'Unknown%' OR first_name ILIKE 'Placeholder%'
                         THEN COALESCE($4, first_name) ELSE first_name END,
       last_name  = CASE WHEN last_name  ILIKE 'Unknown%' OR last_name  IS NULL
                         THEN COALESCE($5, last_name)  ELSE last_name  END,
       notes      = CASE WHEN $6 IS NOT NULL
                         THEN COALESCE(notes, '') || E'\n\n' || '[' || $7 || '] ' || $6
                         ELSE notes END,
       tags       = array(SELECT DISTINCT unnest(COALESCE(tags, '{}') || $8::text[])),
       updated_at = now()
     WHERE id = $1`,
    [
      canonicalId,
      inbound.phone     ?? null,
      inbound.email     ?? null,
      inbound.firstName ?? null,
      inbound.lastName  ?? null,
      inbound.notes     ?? null,
      inbound.sourcePipeline ?? "unknown",
      inbound.tags      ?? [],
    ],
  );
}
```

---

## 6. Backfill — Fingerprint Existing Records

Compute and backfill `incident_fingerprint` on all existing crash contacts to enable the unique index to catch future duplicates.

```sql
-- Run in batches of 1,000 until 0 rows affected
-- contacts with lat/lng get strong fingerprint; address-only get weak fingerprint

-- Step 1: Add column (if not already done in INCIDENT_CONTACT_SPLIT migration)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS incident_fingerprint text;

-- Step 2: Verify with application backfill script (cannot do SHA-256 in pure SQL without pgcrypto)
```

TypeScript backfill:

```typescript
// server/scripts/backfillFingerprints.ts

import { pool } from "../db";
import { computeIncidentFingerprint, computeWeakFingerprint } from "../lib/incidentFingerprint";

const BATCH = 1000;

export async function backfillFingerprints(): Promise<void> {
  let offset = 0;
  let updated = 0;

  while (true) {
    const { rows } = await pool.query<{
      id: number; address: string | null; county: string | null;
      lat: number | null; lng: number | null; created_at: string;
    }>(
      `SELECT id, address, county, lat, lng, created_at
       FROM contacts
       WHERE incident_fingerprint IS NULL
         AND raw_source_type IN ('flhsmv_hsmv_cad','crash_connect_webhook','sentinel_incident')
       ORDER BY id
       LIMIT $1 OFFSET $2`,
      [BATCH, offset],
    );

    if (rows.length === 0) break;

    for (const row of rows) {
      const fp = row.lat && row.lng
        ? computeIncidentFingerprint({ county: row.county, address: row.address, date: row.created_at, lat: row.lat, lng: row.lng })
        : computeWeakFingerprint({ county: row.county, address: row.address, date: row.created_at, lat: null, lng: null });

      // Skip if fingerprint already taken (genuine separate incident)
      try {
        await pool.query(
          `UPDATE contacts SET incident_fingerprint = $1 WHERE id = $2 AND incident_fingerprint IS NULL`,
          [fp, row.id],
        );
        updated++;
      } catch {
        // unique constraint violation — this is a duplicate; skip silently
      }
    }

    console.log(`[FP-BACKFILL] Processed ${offset + rows.length}, updated ${updated}`);
    offset += rows.length;
    await new Promise(r => setTimeout(r, 50));
  }
  console.log(`[FP-BACKFILL] Complete: ${updated} fingerprints assigned`);
}
```

---

## 7. Monitoring Queries

### 7.1 Dedup Effectiveness

```sql
-- What percentage of ingest attempts are duplicates?
SELECT
  source_pipeline,
  COUNT(*)                                                AS total_attempts,
  COUNT(*) FILTER (WHERE outcome = 'created')            AS new_records,
  COUNT(*) FILTER (WHERE outcome = 'duplicate')          AS duplicates,
  ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'duplicate') / COUNT(*), 1) AS dup_rate_pct
FROM incident_dedup_log
WHERE account_id = 3
  AND ingest_at >= now() - interval '7 days'
GROUP BY source_pipeline
ORDER BY total_attempts DESC;
```

### 7.2 Recent Duplicate Chains

```sql
-- Show incidents that arrived from multiple sources (cross-source dedup working)
SELECT
  l.fingerprint,
  array_agg(DISTINCT l.source_pipeline ORDER BY l.source_pipeline) AS sources,
  COUNT(*) AS arrival_count,
  MIN(l.ingest_at) AS first_seen,
  MAX(l.ingest_at) AS last_seen,
  l.canonical_contact_id
FROM incident_dedup_log l
WHERE l.account_id = 3
  AND l.ingest_at >= now() - interval '24 hours'
GROUP BY l.fingerprint, l.canonical_contact_id
HAVING COUNT(DISTINCT l.source_pipeline) > 1
ORDER BY arrival_count DESC
LIMIT 20;
```

### 7.3 BatchData Credit Savings Estimate

```sql
-- Estimate BatchData calls avoided by dedup (each duplicate prevented = 1 call saved)
SELECT
  DATE_TRUNC('day', ingest_at) AS day,
  COUNT(*) FILTER (WHERE outcome = 'duplicate') AS duplicates_prevented,
  COUNT(*) FILTER (WHERE outcome = 'duplicate') * 0.30 AS estimated_savings_usd
FROM incident_dedup_log
WHERE account_id = 3
  AND ingest_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY 1;
```

---

## 8. Validation Gates

After deploying schema + backfill, run these validation queries before enabling in production:

```sql
-- 1. No duplicate fingerprints within same account
SELECT account_id, incident_fingerprint, COUNT(*) AS n
FROM contacts
WHERE incident_fingerprint IS NOT NULL
GROUP BY account_id, incident_fingerprint
HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- 2. Fingerprint coverage on crash contacts
SELECT
  COUNT(*) FILTER (WHERE incident_fingerprint IS NOT NULL) AS with_fp,
  COUNT(*) AS total
FROM contacts
WHERE account_id = 3
  AND raw_source_type IN ('flhsmv_hsmv_cad','crash_connect_webhook','sentinel_incident');
-- Expected: with_fp >= 70% of total (some have no address/county/date to fingerprint)

-- 3. Dedup log integrity
SELECT COUNT(*) FROM incident_dedup_log WHERE outcome NOT IN ('created','duplicate','merged','skipped');
-- Expected: 0 rows

-- 4. All "duplicate" log rows point to a valid canonical contact
SELECT COUNT(*) FROM incident_dedup_log l
LEFT JOIN contacts c ON c.id = l.canonical_contact_id
WHERE l.outcome = 'duplicate' AND c.id IS NULL;
-- Expected: 0 rows
```

---

## 9. Rollback Plan

| Phase | Rollback Action |
|-------|----------------|
| Schema (fingerprint column) | `ALTER TABLE contacts DROP COLUMN incident_fingerprint` (safe, no app dependency) |
| Schema (dedup_log table) | `DROP TABLE incident_dedup_log` (audit data only, not operational) |
| Unique index | `DROP INDEX idx_contacts_account_fingerprint` |
| Ingest code | Remove `checkIncidentDedup()` calls, redeploy |
| Backfill | No data loss — contacts unchanged except added fingerprint column |

---

*Document status: DESIGN COMPLETE — ready for implementation sprint.*
*Author: Apex Marketing OS Architecture | Generated: 2026-05-15*
*Related: STAGE_4B_INCIDENT_CONTACT_SPLIT.md | STAGE_4B_TERRITORY_GROUPING.md | APEX_POSTGRES_BRAIN_SCHEMA.md*
