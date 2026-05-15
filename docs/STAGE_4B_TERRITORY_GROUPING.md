# STAGE 4B — Territory Grouping Architecture
**Apex Marketing OS | Incident vs Contact Intelligence Series**
**Status:** DESIGN COMPLETE — ready for implementation sprint
**Date:** 2026-05-15

---

## Executive Summary

Apex currently uses raw `county` text on contacts as the sole geographic grouping mechanism. This produces three operational problems: (1) operators can only filter by exact county name, not by named territories spanning multiple counties; (2) there is no DMA-level aggregation for regional trend analysis; (3) CRM list queries must do expensive string-match filtering instead of an indexed foreign-key join.

This document specifies a four-level territory hierarchy (`county → ZIP → named_territory → DMA`), a `territories` lookup table, an indexed `territory_id` foreign key on `contacts`, a county-based backfill procedure, and the API endpoints and TypeScript helpers that surface territory context in the CRM and scoring pipeline.

---

## 1. Problem Statement

### 1.1 Current State

```
contacts.county = "Hillsborough"     ← raw text, no FK, no index on this predicate
contacts.county = "hillsborough"     ← case mismatch from different ingest paths
contacts.county = "Hillsborough County"  ← trailing "County" suffix
contacts.county = NULL               ← 30%+ of crash records missing county entirely
```

CRM filter `WHERE county = 'Hillsborough'` misses two of these four records. The retro skip trace already applies a `.replace(" County", "")` workaround. There is no concept of a named territory (e.g., "Tampa Bay I-4 Corridor") that spans multiple counties, and no DMA grouping for bulk pricing or regional trend dashboards.

### 1.2 Impact

| Problem | Consequence |
|---------|-------------|
| No normalized county | Filter miss rate ~30% |
| No multi-county territories | Operators cannot define "I-4 Corridor" as a single filter |
| No DMA grouping | No regional trend queries |
| No territory_id FK | Every territory filter is a string scan |
| Inconsistent county format | Dedup logic fails across ingest paths |

---

## 2. Territory Hierarchy

Apex uses four levels. Each level is a refinement of the previous:

```
DMA (Nielsen Media Market)
  └── Named Territory  (operator-defined, spans 1-N counties)
       └── County       (Florida 67-county standard)
            └── ZIP     (5-digit USPS code)
```

### 2.1 Level Definitions

| Level | Key | Example | Managed By |
|-------|-----|---------|------------|
| DMA | `dma_code` | 539 (Tampa-St. Pete-Sarasota) | System seed |
| Named Territory | `territory_slug` | `tampa-bay-i4-corridor` | Admin UI |
| County | `county_name` | `Hillsborough` | System seed |
| ZIP | `zip_code` | `33601` | System seed |

### 2.2 Florida DMA Map (Production Seed)

| DMA Code | DMA Name | Counties |
|----------|----------|---------|
| 539 | Tampa-St. Pete-Sarasota | Hillsborough, Pinellas, Pasco, Sarasota, Manatee, Polk |
| 528 | Miami-Fort Lauderdale | Miami-Dade, Broward, Palm Beach, Monroe |
| 534 | Orlando-Daytona Beach | Orange, Osceola, Brevard, Flagler, Lake, Marion, Putnam, Seminole, St. Johns, Sumter, Volusia |
| 561 | Jacksonville | Duval, Clay, Nassau, Baker, St. Johns |
| 571 | Fort Myers-Naples | Lee, Collier, Charlotte, Hendry, Glades |
| 518 | West Palm Beach-Fort Pierce | Palm Beach, Martin, St. Lucie, Indian River, Okeechobee |
| 686 | Mobile-Pensacola | Escambia, Santa Rosa, Okaloosa, Walton |
| 598 | Tallahassee-Thomasville | Leon, Gadsden, Jefferson, Wakulla, Taylor, Madison |

---

## 3. Database Schema

### 3.1 `territories` Table

```sql
CREATE TABLE territories (
  id              serial         PRIMARY KEY,
  slug            text           NOT NULL UNIQUE,     -- 'hillsborough-county', 'tampa-bay-i4-corridor'
  name            text           NOT NULL,            -- display name: "Hillsborough County"
  level           text           NOT NULL,            -- 'county' | 'zip' | 'named' | 'dma'
  parent_id       integer        REFERENCES territories(id),
  dma_code        integer,                            -- Nielsen DMA code (non-null for DMA rows)
  county_names    text[]         NOT NULL DEFAULT '{}', -- canonical county list this territory covers
  zip_codes       text[]         NOT NULL DEFAULT '{}',
  state           text           NOT NULL DEFAULT 'FL',
  is_active       boolean        NOT NULL DEFAULT true,
  created_at      timestamp      NOT NULL DEFAULT now(),
  updated_at      timestamp      NOT NULL DEFAULT now()
);

-- Unique slug index
CREATE UNIQUE INDEX idx_territories_slug ON territories (slug);

-- Fast lookup by level
CREATE INDEX idx_territories_level ON territories (level, is_active);

-- DMA lookup
CREATE INDEX idx_territories_dma_code ON territories (dma_code) WHERE dma_code IS NOT NULL;

-- County name array lookup (GIN for @> operator)
CREATE INDEX idx_territories_county_names_gin ON territories USING GIN (county_names);
```

### 3.2 `contacts` Table — New Column

```sql
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS territory_id integer REFERENCES territories(id),
  ADD COLUMN IF NOT EXISTS view_class    varchar(30) DEFAULT 'contact',
  ADD COLUMN IF NOT EXISTS workflow_stage varchar(50) DEFAULT 'NEW',
  ADD COLUMN IF NOT EXISTS incident_fingerprint text;

-- Index for territory-based CRM queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_account_territory
  ON contacts (account_id, territory_id);

-- Index for view_class (CRM split)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_account_view_class
  ON contacts (account_id, view_class);

-- Index for workflow_stage
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_account_workflow_stage
  ON contacts (account_id, workflow_stage);
```

### 3.3 Drizzle Schema

```typescript
// shared/schema.ts additions

export const territories = pgTable("territories", {
  id:           serial("id").primaryKey(),
  slug:         text("slug").notNull().unique(),
  name:         text("name").notNull(),
  level:        text("level").notNull(),  // 'county' | 'zip' | 'named' | 'dma'
  parentId:     integer("parent_id").references((): AnyPgColumn => territories.id),
  dmaCode:      integer("dma_code"),
  countyNames:  text("county_names").array().notNull().default([]),
  zipCodes:     text("zip_codes").array().notNull().default([]),
  state:        text("state").notNull().default("FL"),
  isActive:     boolean("is_active").notNull().default(true),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
});

export type Territory = typeof territories.$inferSelect;
export type InsertTerritory = typeof territories.$inferInsert;
```

---

## 4. County Normalization

All ingest paths must normalize county before writing to `contacts`. Normalization is a pure function, never hits the DB, runs synchronously.

### 4.1 `normalizeCounty()` Helper

```typescript
// server/lib/countyNormalizer.ts

const COUNTY_SUFFIX_RE = /\s+county$/i;
const WHITESPACE_RE    = /\s+/g;

// Florida 67-county canonical list (lowercase, no "county" suffix)
const FL_COUNTIES = new Set([
  "alachua", "baker", "bay", "bradford", "brevard", "broward",
  "calhoun", "charlotte", "citrus", "clay", "collier", "columbia",
  "desoto", "dixie", "duval", "escambia", "flagler", "franklin",
  "gadsden", "gilchrist", "glades", "gulf", "hamilton", "hardee",
  "hendry", "hernando", "highlands", "hillsborough", "holmes",
  "indian river", "jackson", "jefferson", "lafayette", "lake",
  "lee", "leon", "levy", "liberty", "madison", "manatee",
  "marion", "martin", "miami-dade", "monroe", "nassau", "okaloosa",
  "okeechobee", "orange", "osceola", "palm beach", "pasco", "pinellas",
  "polk", "putnam", "santa rosa", "sarasota", "seminole", "st. johns",
  "st. lucie", "sumter", "suwannee", "taylor", "union", "volusia",
  "wakulla", "walton", "washington",
]);

/**
 * Normalize a raw county string to title-cased canonical form.
 * Returns null if the value cannot be matched to a Florida county.
 *
 * Examples:
 *   "Hillsborough County" → "Hillsborough"
 *   "hillsborough"        → "Hillsborough"
 *   "MIAMI DADE"          → "Miami-Dade"
 *   "Dade"                → null  (Dade was renamed Miami-Dade in 1997)
 */
export function normalizeCounty(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let normalized = raw
    .trim()
    .replace(COUNTY_SUFFIX_RE, "")
    .replace(WHITESPACE_RE, " ")
    .toLowerCase();

  // Handle common aliases
  const ALIASES: Record<string, string> = {
    "dade":        "miami-dade",
    "st johns":    "st. johns",
    "st lucie":    "st. lucie",
    "saint johns": "st. johns",
    "saint lucie": "st. lucie",
  };
  normalized = ALIASES[normalized] ?? normalized;

  if (!FL_COUNTIES.has(normalized)) return null;

  // Title-case: "miami-dade" → "Miami-Dade"
  return normalized
    .split(/[\s-]/)
    .map((w, i) => {
      const sep = normalized.includes("-") && i > 0 ? "-" : " ";
      return (i === 0 ? "" : sep) + w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join("")
    .trim();
}
```

### 4.2 `resolveTerritory()` Helper

After county normalization, resolve the county to a `territory_id` using a cached lookup table loaded once at startup.

```typescript
// server/lib/territoryResolver.ts

import { db } from "../db";
import { territories } from "../../shared/schema";
import { eq, sql } from "drizzle-orm";

// Module-level cache: countyName → territory_id
// Refreshed every 6 hours (territories rarely change)
let _countyCache: Map<string, number> | null = null;
let _cacheLoadedAt: number = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function loadCountyCache(): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: territories.id, countyNames: territories.countyNames })
    .from(territories)
    .where(eq(territories.level, "county"));

  const map = new Map<string, number>();
  for (const row of rows) {
    for (const county of row.countyNames) {
      map.set(county.toLowerCase(), row.id);
    }
  }
  return map;
}

async function getCountyCache(): Promise<Map<string, number>> {
  const now = Date.now();
  if (!_countyCache || now - _cacheLoadedAt > CACHE_TTL_MS) {
    _countyCache = await loadCountyCache();
    _cacheLoadedAt = now;
  }
  return _countyCache;
}

/**
 * Resolve a normalized county name to a territory_id.
 * Returns null if no matching territory exists.
 */
export async function resolveTerritory(
  normalizedCounty: string | null,
): Promise<number | null> {
  if (!normalizedCounty) return null;
  const cache = await getCountyCache();
  return cache.get(normalizedCounty.toLowerCase()) ?? null;
}

/**
 * Invalidate the territory cache (call after seeding new territories).
 */
export function invalidateTerritoryCache(): void {
  _countyCache = null;
}
```

---

## 5. Seed Data

### 5.1 County Seed Migration

```sql
-- Migration: 0045_territories_seed.sql
-- Run once; idempotent via ON CONFLICT DO NOTHING

INSERT INTO territories (slug, name, level, county_names, state)
VALUES
  ('alachua-county',     'Alachua',      'county', ARRAY['Alachua'],      'FL'),
  ('baker-county',       'Baker',         'county', ARRAY['Baker'],        'FL'),
  ('bay-county',         'Bay',           'county', ARRAY['Bay'],          'FL'),
  ('brevard-county',     'Brevard',       'county', ARRAY['Brevard'],      'FL'),
  ('broward-county',     'Broward',       'county', ARRAY['Broward'],      'FL'),
  ('charlotte-county',   'Charlotte',     'county', ARRAY['Charlotte'],    'FL'),
  ('citrus-county',      'Citrus',        'county', ARRAY['Citrus'],       'FL'),
  ('clay-county',        'Clay',          'county', ARRAY['Clay'],         'FL'),
  ('collier-county',     'Collier',       'county', ARRAY['Collier'],      'FL'),
  ('duval-county',       'Duval',         'county', ARRAY['Duval'],        'FL'),
  ('escambia-county',    'Escambia',      'county', ARRAY['Escambia'],     'FL'),
  ('flagler-county',     'Flagler',       'county', ARRAY['Flagler'],      'FL'),
  ('hernando-county',    'Hernando',      'county', ARRAY['Hernando'],     'FL'),
  ('highlands-county',   'Highlands',     'county', ARRAY['Highlands'],    'FL'),
  ('hillsborough-county','Hillsborough',  'county', ARRAY['Hillsborough'], 'FL'),
  ('indian-river-county','Indian River',  'county', ARRAY['Indian River'], 'FL'),
  ('lake-county',        'Lake',          'county', ARRAY['Lake'],         'FL'),
  ('lee-county',         'Lee',           'county', ARRAY['Lee'],          'FL'),
  ('leon-county',        'Leon',          'county', ARRAY['Leon'],         'FL'),
  ('manatee-county',     'Manatee',       'county', ARRAY['Manatee'],      'FL'),
  ('marion-county',      'Marion',        'county', ARRAY['Marion'],       'FL'),
  ('martin-county',      'Martin',        'county', ARRAY['Martin'],       'FL'),
  ('miami-dade-county',  'Miami-Dade',    'county', ARRAY['Miami-Dade'],   'FL'),
  ('monroe-county',      'Monroe',        'county', ARRAY['Monroe'],       'FL'),
  ('nassau-county',      'Nassau',        'county', ARRAY['Nassau'],       'FL'),
  ('okaloosa-county',    'Okaloosa',      'county', ARRAY['Okaloosa'],     'FL'),
  ('orange-county',      'Orange',        'county', ARRAY['Orange'],       'FL'),
  ('osceola-county',     'Osceola',       'county', ARRAY['Osceola'],      'FL'),
  ('palm-beach-county',  'Palm Beach',    'county', ARRAY['Palm Beach'],   'FL'),
  ('pasco-county',       'Pasco',         'county', ARRAY['Pasco'],        'FL'),
  ('pinellas-county',    'Pinellas',      'county', ARRAY['Pinellas'],     'FL'),
  ('polk-county',        'Polk',          'county', ARRAY['Polk'],         'FL'),
  ('putnam-county',      'Putnam',        'county', ARRAY['Putnam'],       'FL'),
  ('santa-rosa-county',  'Santa Rosa',    'county', ARRAY['Santa Rosa'],   'FL'),
  ('sarasota-county',    'Sarasota',      'county', ARRAY['Sarasota'],     'FL'),
  ('seminole-county',    'Seminole',      'county', ARRAY['Seminole'],     'FL'),
  ('st-johns-county',    'St. Johns',     'county', ARRAY['St. Johns'],    'FL'),
  ('st-lucie-county',    'St. Lucie',     'county', ARRAY['St. Lucie'],    'FL'),
  ('sumter-county',      'Sumter',        'county', ARRAY['Sumter'],       'FL'),
  ('volusia-county',     'Volusia',       'county', ARRAY['Volusia'],      'FL'),
  ('walton-county',      'Walton',        'county', ARRAY['Walton'],       'FL')
ON CONFLICT (slug) DO NOTHING;

-- DMA rows
INSERT INTO territories (slug, name, level, dma_code, county_names, state)
VALUES
  ('dma-tampa',       'Tampa-St. Pete-Sarasota', 'dma', 539,
   ARRAY['Hillsborough','Pinellas','Pasco','Sarasota','Manatee','Polk'], 'FL'),
  ('dma-miami',       'Miami-Fort Lauderdale',   'dma', 528,
   ARRAY['Miami-Dade','Broward','Palm Beach','Monroe'], 'FL'),
  ('dma-orlando',     'Orlando-Daytona Beach',   'dma', 534,
   ARRAY['Orange','Osceola','Brevard','Flagler','Lake','Marion','Putnam','Seminole','St. Johns','Sumter','Volusia'], 'FL'),
  ('dma-jacksonville','Jacksonville',             'dma', 561,
   ARRAY['Duval','Clay','Nassau','St. Johns'], 'FL'),
  ('dma-fort-myers',  'Fort Myers-Naples',        'dma', 571,
   ARRAY['Lee','Collier','Charlotte'], 'FL')
ON CONFLICT (slug) DO NOTHING;

-- Sample named territory
INSERT INTO territories (slug, name, level, county_names, state)
VALUES
  ('i4-corridor', 'I-4 Corridor', 'named',
   ARRAY['Hillsborough','Polk','Osceola','Orange','Seminole','Volusia'], 'FL')
ON CONFLICT (slug) DO NOTHING;
```

---

## 6. Backfill Procedure

After schema migration and seed, backfill `territory_id` on all existing contacts using their existing `county` text.

```sql
-- Phase 1: Normalize county text and set territory_id in batches
-- Run until 0 rows affected

UPDATE contacts c
SET
  territory_id = t.id,
  updated_at   = now()
FROM territories t
WHERE
  -- Match normalized county: strip " County" suffix, lower, trim
  t.level = 'county'
  AND LOWER(TRIM(REGEXP_REPLACE(c.county, '\s+[Cc]ounty$', ''))) = ANY(
    SELECT LOWER(unnest(t.county_names))
  )
  AND c.territory_id IS NULL
  AND c.county IS NOT NULL
LIMIT 2000;
```

TypeScript batch runner:

```typescript
// server/scripts/backfillTerritories.ts

import { pool } from "../db";
import { normalizeCounty } from "../lib/countyNormalizer";
import { resolveTerritory } from "../lib/territoryResolver";

const BATCH_SIZE = 500;
const DELAY_MS   = 100;

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export async function backfillTerritories(): Promise<void> {
  let offset = 0;
  let updated = 0;

  console.log("[TERRITORY-BACKFILL] Starting territory_id backfill...");

  while (true) {
    const { rows } = await pool.query<{ id: number; county: string | null }>(
      `SELECT id, county FROM contacts
       WHERE territory_id IS NULL AND county IS NOT NULL
       ORDER BY id
       LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset],
    );

    if (rows.length === 0) break;

    for (const row of rows) {
      const normalized  = normalizeCounty(row.county);
      const territoryId = await resolveTerritory(normalized);

      if (territoryId) {
        await pool.query(
          `UPDATE contacts SET territory_id = $1, updated_at = now() WHERE id = $2`,
          [territoryId, row.id],
        );
        updated++;
      }
    }

    console.log(`[TERRITORY-BACKFILL] Processed ${offset + rows.length} rows, updated ${updated}`);
    offset += rows.length;
    await sleep(DELAY_MS);
  }

  console.log(`[TERRITORY-BACKFILL] Complete — ${updated} contacts assigned territory_id`);
}
```

---

## 7. Ingest Pipeline Integration

### 7.1 Crash Ingest Handler

```typescript
// server/crashIngest.ts — add after county extraction

import { normalizeCounty }  from "./lib/countyNormalizer";
import { resolveTerritory } from "./lib/territoryResolver";

// ... existing county extraction ...
const rawCounty     = extracted.county || geocodedCounty || null;
const county        = normalizeCounty(rawCounty);
const territoryId   = await resolveTerritory(county);

await storage.createContact({
  // ... existing fields ...
  county,
  territoryId,
  // territory_id is set; legacy county text preserved for backward compat
});
```

### 7.2 Sentinel Signal Handler

Same pattern — normalize county from crash scene address, resolve `territory_id` before insert.

### 7.3 Home Service Signal Handler

```typescript
const county      = normalizeCounty(signal.propertyCounty);
const territoryId = await resolveTerritory(county);
// pass territoryId to contact upsert
```

---

## 8. API Endpoints

### 8.1 `GET /api/territories` — Account Territory List

Returns all territories with contact counts for the given account. Used to populate the CRM filter dropdown.

```typescript
// GET /api/territories?accountId=3&level=county

interface TerritoryWithCount {
  id:           number;
  slug:         string;
  name:         string;
  level:        string;
  contactCount: number;
  incidentCount: number;
}
```

```sql
SELECT
  t.id,
  t.slug,
  t.name,
  t.level,
  COUNT(c.id) FILTER (WHERE c.view_class = 'contact')  AS contact_count,
  COUNT(c.id) FILTER (WHERE c.view_class IN ('signal','incident')) AS incident_count
FROM territories t
LEFT JOIN contacts c ON c.territory_id = t.id AND c.account_id = :accountId
WHERE t.is_active = true
  AND (:level IS NULL OR t.level = :level)
GROUP BY t.id
ORDER BY contact_count DESC, t.name;
```

### 8.2 `GET /api/territories/:id` — Territory Detail

```typescript
interface TerritoryDetail extends TerritoryWithCount {
  countyNames:  string[];
  zipCodes:     string[];
  dmaCode:      number | null;
  parentId:     number | null;
  recentSignals: number;    // signals last 7 days
  hotLeadCount:  number;    // contacts with grade A+ or A
}
```

### 8.3 `GET /api/territories/stats` — DMA Heat Map

Aggregate contact and signal counts by DMA for the regional trend dashboard.

```sql
SELECT
  t.dma_code,
  t.name AS dma_name,
  COUNT(c.id) FILTER (WHERE c.view_class = 'contact')  AS contacts,
  COUNT(c.id) FILTER (WHERE c.view_class IN ('signal','incident')) AS signals,
  COUNT(c.id) FILTER (WHERE c.created_at >= now() - interval '7 days') AS last_7_days
FROM territories t
LEFT JOIN territories county ON county.dma_code = t.dma_code AND county.level = 'county'
LEFT JOIN contacts c ON c.territory_id = county.id AND c.account_id = :accountId
WHERE t.level = 'dma'
GROUP BY t.dma_code, t.name
ORDER BY signals DESC;
```

---

## 9. CRM Integration

### 9.1 Contacts View — Territory Filter

The territory filter in the Contacts and Incidents CRM views uses the `territory_id` FK for O(log n) indexed lookup instead of string scan.

```typescript
// server/routes/crm/contacts.ts

const { territory } = req.query;  // territory slug or id

let territoryId: number | null = null;
if (territory) {
  const t = await db.query.territories.findFirst({
    where: eq(territories.slug, territory as string),
  });
  territoryId = t?.id ?? null;
}

// Apply to WHERE clause:
if (territoryId !== null) {
  conditions.push(eq(contacts.territoryId, territoryId));
}
```

### 9.2 Named Territory Support

Operators can define a named territory (e.g., "I-4 Corridor") that spans multiple counties. A contact assigned to any of those counties resolves to a county-level territory. To filter by named territory, the query uses the `county_names` array:

```sql
-- Filter contacts by named territory "I-4 Corridor"
SELECT c.*
FROM contacts c
JOIN territories county_t ON county_t.id = c.territory_id
JOIN territories named_t  ON county_t.county_names && named_t.county_names
WHERE named_t.slug = 'i4-corridor'
  AND c.account_id = :accountId;
```

---

## 10. Migration Plan

| Phase | Action | Risk | Downtime |
|-------|--------|------|---------|
| Phase 1 | Create `territories` table + seed counties + DMA | Zero — additive | None |
| Phase 2 | `ALTER TABLE contacts ADD COLUMN territory_id` + index | Zero — nullable column | None |
| Phase 3 | Backfill existing contacts (batched, 500 rows/100ms) | Zero — background job | None |
| Phase 4 | Update ingest handlers to call `resolveTerritory()` | Low — additive only | None |
| Phase 5 | CRM filter switch from `county text` to `territory_id` FK | Low — behind feature flag | None |

### 10.1 Rollback

If any phase fails:
- Phase 1: `DROP TABLE territories CASCADE`
- Phase 2: `ALTER TABLE contacts DROP COLUMN territory_id`
- Phase 3: No data loss — `territory_id` reverts to NULL
- Phase 4: Revert ingest code, redeploy
- Phase 5: Disable feature flag, CRM reverts to string-based county filter

---

## 11. Observability

### 11.1 Axiom Events

| Event | Fields | When |
|-------|--------|------|
| `territory.resolved` | `contactId, county, territoryId, cached` | Each ingest |
| `territory.resolve_miss` | `contactId, rawCounty, normalizedCounty` | County not in DB |
| `territory.backfill_batch` | `processed, updated, offset` | Each batch iteration |
| `territory.cache_refresh` | `countyCount, durationMs` | Cache reload |

### 11.2 Validation Query

After backfill, run to confirm coverage:

```sql
SELECT
  COUNT(*) FILTER (WHERE territory_id IS NOT NULL)     AS assigned,
  COUNT(*) FILTER (WHERE territory_id IS NULL AND county IS NOT NULL) AS unresolved,
  COUNT(*) FILTER (WHERE county IS NULL)               AS no_county,
  COUNT(*)                                             AS total
FROM contacts
WHERE account_id = 3;
```

Expected: `assigned` ≥ 60% of total on first run (many records have NULL county).

---

*Document status: DESIGN COMPLETE — ready for implementation sprint.*
*Author: Apex Marketing OS Architecture | Generated: 2026-05-15*
*Related: STAGE_4B_INCIDENT_CONTACT_SPLIT.md | STAGE_4B_OPERATIONAL_CRM.md | APEX_TERRITORY_INTELLIGENCE.md*
