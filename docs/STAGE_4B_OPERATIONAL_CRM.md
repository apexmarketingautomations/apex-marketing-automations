# STAGE 4B — Operational CRM Architecture
**Apex Marketing OS | Phase 4B — Split-View CRM**
**Status:** Design Document | **Target:** Node.js/Express + React + Neon | **Date:** 2026-05-15

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [CRM Navigation Structure](#2-crm-navigation-structure)
3. [Database Schema Additions](#3-database-schema-additions)
4. [New API Endpoints](#4-new-api-endpoints)
5. [Quick Filter Definitions](#5-quick-filter-definitions)
6. [Human-Readable Label Translation](#6-human-readable-label-translation)
7. [Per-View Filter Schemas](#7-per-view-filter-schemas)
8. [Count Aggregation Query](#8-count-aggregation-query)
9. [Bulk Action Support](#9-bulk-action-support)
10. [Frontend Component Breakdown](#10-frontend-component-breakdown)
11. [Zero-Downtime Migration](#11-zero-downtime-migration)
12. [Index Strategy](#12-index-strategy)
13. [Performance Guarantees](#13-performance-guarantees)

---

## 1. Executive Summary

### The Problem With the Current Feed

The existing CRM is a single chronological list rendered at `/contacts`. It mixes every row in the `contacts` table regardless of record type: raw crash placeholders with no phone or email sit adjacent to fully enriched, export-ready injury victims. Sentinel-detected incidents appear alongside attorney entities. Skip-trace failures appear next to verified, dialable contacts. There is no visual distinction, no operator affordance to know where to start, and no structural separation of actionability tiers.

The consequence is operator friction at every level:

| Pain Point | Root Cause | Business Cost |
|------------|-----------|---------------|
| Operators call placeholder contacts with `[unknown]` names | No `export_eligible` gate on the list view | Wasted dial time, negative first impressions |
| Skip trace queue is invisible until a contact is clicked | No dedicated "needs skip trace" surface | Manual auditing of 2,100+ rows |
| Signals (crash events, legal filings) are treated as contacts | `view_class` column does not drive routing | Signal noise corrupts CRM KPIs |
| No AI score visibility in the list | `contact_ai_profiles` table exists but no UX surface | Best leads are not prioritized |
| County-based territory work requires manual filtering every session | No persistent filter defaults per view | Territory operators repeat setup on every login |
| Sidebar badges show nothing — no counts per category | Single `/api/contacts` endpoint returns everything | Operators have no situational awareness |

### What the Split Achieves

Phase 4B replaces the single feed with **five dedicated views**, each backed by its own scoped API endpoint, its own filter schema, and its own set of quick filters relevant to that record type. The existing `/api/contacts` and `/api/leads` routes are not modified. All additions are purely additive.

**The five CRM views:**

| View | Route | `view_class` | Primary Audience |
|------|-------|-------------|-----------------|
| Incidents | `/crm/incidents` | `signal`, `incident` | Signal analysts, territory managers |
| Contacts | `/crm/contacts` | `contact` | Dialers, skip trace operators |
| Opportunities | `/crm/opportunities` | `opportunity` | Closers, attorneys |
| Cases | `/crm/cases` | existing case records | Case managers |
| Campaigns | `/crm/campaigns` | existing campaign records | Marketing operators |

---

## 2. CRM Navigation Structure

### 2.1 Route Map

```
/crm
├── /crm/incidents          ← view_class IN ('signal', 'incident')
├── /crm/contacts           ← view_class = 'contact'
├── /crm/opportunities      ← view_class = 'opportunity'
├── /crm/cases              ← existing case management (no change to routes)
└── /crm/campaigns          ← existing campaigns (no change to routes)
```

The `/crm` prefix is new. Existing `/contacts`, `/pipeline`, `/signals/*` routes remain unchanged and continue to render the legacy single-feed views. Both old and new routes coexist during migration.

### 2.2 Navigation Sidebar

```
┌────────────────────────────────────────┐
│  CRM                                   │
│                                        │
│  [Incidents]      (badge: N)           │
│  [Contacts]       (badge: N)           │
│  [Opportunities]  (badge: N)           │
│  [Cases]          (badge: N)           │
│  [Campaigns]      (badge: N)           │
└────────────────────────────────────────┘
```

Badge counts are loaded by a single `GET /api/crm/counts?accountId=` call on sidebar mount. Counts update on a 60-second polling interval — no WebSocket required at this stage.

### 2.3 Tab-Level Layout Pattern

Each CRM tab follows the same three-panel layout:

```
┌─────────────────────────────────────────────────────────────┐
│  [Tab: Incidents] [Tab: Contacts] [Tab: Opps] [Tab: Cases]  │
├───────────────┬─────────────────────────────────────────────┤
│  FILTER BAR   │  QUICK FILTERS (horizontal pill row)        │
│  county       │  [Hot Leads] [New Today] [Ready for Dialing]│
│  date range   │  [Needs Skip Trace] [High Severity]         │
│  grade        │                                             │
│  workflow     ├─────────────────────────────────────────────┤
│               │  LIST  (paginated, sortable)                │
│  [Apply]      │  ┌──────────────────────────────────────┐  │
│  [Reset]      │  │  Row | Name | Grade | Status | Tags  │  │
│               │  │  ...                                  │  │
│               │  └──────────────────────────────────────┘  │
│               │                                             │
│               │  [Prev] Page 1 of N [Next]                  │
└───────────────┴─────────────────────────────────────────────┘
```

---

## 3. Database Schema Additions

### 3.1 New Columns on `contacts`

These columns are additive. All existing queries continue to work unchanged.

```sql
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS view_class        varchar(30)  DEFAULT 'contact',
  ADD COLUMN IF NOT EXISTS workflow_stage    varchar(50)  DEFAULT 'NEW',
  ADD COLUMN IF NOT EXISTS export_eligible   boolean      DEFAULT false,
  ADD COLUMN IF NOT EXISTS lead_type         varchar(50),
  ADD COLUMN IF NOT EXISTS source_pipeline   varchar(100),
  ADD COLUMN IF NOT EXISTS severity          varchar(20),
  ADD COLUMN IF NOT EXISTS sms_opt_out       boolean      DEFAULT false;

-- Allowed values (enforced at app layer, not DB to avoid lock):
-- view_class:      'signal' | 'incident' | 'contact' | 'opportunity'
-- workflow_stage:  'NEW' | 'ENRICHING' | 'READY' | 'FOLLOW_UP' | 'RETAINED' | 'DEAD'
-- lead_type:       'individual' | 'attorney' | 'business' | 'placeholder' | 'recall'
-- severity:        'low' | 'medium' | 'high' | 'critical'
```

### 3.2 New Table: `contact_ai_profiles`

```sql
CREATE TABLE IF NOT EXISTS contact_ai_profiles (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id         integer     NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  account_id         integer     NOT NULL REFERENCES sub_accounts(id),
  letter_grade       varchar(3)  NOT NULL,   -- 'A+', 'A', 'B+', 'B', 'C', 'D', 'F'
  numeric_score      numeric(5,2) NOT NULL,  -- 0.00–100.00
  score_version      varchar(20)  DEFAULT 'v1',
  score_factors      jsonb,                  -- {phone: 25, email: 20, county: 15, ...}
  scored_at          timestamptz  DEFAULT now(),
  created_at         timestamptz  DEFAULT now(),
  updated_at         timestamptz  DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_ai_profiles_contact
  ON contact_ai_profiles (contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_ai_profiles_account_grade
  ON contact_ai_profiles (account_id, letter_grade);

CREATE INDEX IF NOT EXISTS idx_contact_ai_profiles_account_score
  ON contact_ai_profiles (account_id, numeric_score DESC);
```

### 3.3 Required Indexes on `contacts`

All filters that appear in the CRM endpoints must be indexed. Missing indexes cause full table scans which violate the 200ms p95 constraint.

```sql
-- view_class is the partition axis for every CRM query
CREATE INDEX IF NOT EXISTS idx_contacts_account_view_class
  ON contacts (account_id, view_class);

-- Workflow stage filtering (dialers, skip trace operators)
CREATE INDEX IF NOT EXISTS idx_contacts_account_workflow_stage
  ON contacts (account_id, workflow_stage);

-- Export eligible gate
CREATE INDEX IF NOT EXISTS idx_contacts_account_export_eligible
  ON contacts (account_id, export_eligible)
  WHERE export_eligible = true;

-- Skip trace status (Needs Skip Trace quick filter)
CREATE INDEX IF NOT EXISTS idx_contacts_skip_trace_status
  ON contacts (account_id, skip_trace_status)
  WHERE skip_trace_status = 'not_attempted';

-- County scoped queries (territory management)
CREATE INDEX IF NOT EXISTS idx_contacts_account_county
  ON contacts (account_id, county);

-- Enrichment recency (Recently Enriched quick filter)
CREATE INDEX IF NOT EXISTS idx_contacts_enrichment_completed_at
  ON contacts (account_id, enrichment_completed_at DESC)
  WHERE enrichment_completed_at IS NOT NULL;

-- Date range filtering on created_at
CREATE INDEX IF NOT EXISTS idx_contacts_account_created_at
  ON contacts (account_id, created_at DESC);

-- Severity for incident view
CREATE INDEX IF NOT EXISTS idx_contacts_account_severity
  ON contacts (account_id, severity)
  WHERE severity IN ('high', 'critical');

-- Phone presence for Ready For Dialing quick filter
CREATE INDEX IF NOT EXISTS idx_contacts_account_phone_notnull
  ON contacts (account_id, workflow_stage)
  WHERE phone IS NOT NULL AND sms_opt_out = false;

-- lead_type for entity separation
CREATE INDEX IF NOT EXISTS idx_contacts_account_lead_type
  ON contacts (account_id, lead_type);
```

---

## 4. New API Endpoints

All endpoints are additive. No existing routes are modified.

### 4.1 Incidents View

```typescript
// server/routes/crm/incidents.ts

/**
 * GET /api/crm/incidents
 *
 * Returns contacts where view_class IN ('signal', 'incident').
 * Used by the /crm/incidents tab.
 */
router.get(
  '/api/crm/incidents',
  requireAuth,
  requireAccountAccess,
  async (req: Request, res: Response): Promise<void> => {
    const params: CrmIncidentsParams = {
      accountId:  z.number().parse(Number(req.query.accountId)),
      county:     req.query.county    as string | undefined,
      severity:   req.query.severity  as string | undefined,   // 'low'|'medium'|'high'|'critical'
      dateFrom:   req.query.dateFrom  as string | undefined,   // ISO 8601
      dateTo:     req.query.dateTo    as string | undefined,   // ISO 8601
      page:       Number(req.query.page  ?? 1),
      limit:      Math.min(Number(req.query.limit ?? 50), 200),
    };
    // ...
  }
);
```

**SQL template:**

```sql
SELECT
  c.id,
  c.first_name,
  c.last_name,
  c.county,
  c.severity,
  c.view_class,
  c.workflow_stage,
  c.source_pipeline,
  c.created_at,
  c.lead_vertical,
  c.tags
FROM contacts c
WHERE
  c.account_id     = :accountId
  AND c.view_class IN ('signal', 'incident')
  AND (:county    IS NULL OR c.county = :county)
  AND (:severity  IS NULL OR c.severity = :severity)
  AND (:dateFrom  IS NULL OR c.created_at >= :dateFrom::timestamptz)
  AND (:dateTo    IS NULL OR c.created_at <= :dateTo::timestamptz)
ORDER BY c.created_at DESC
LIMIT :limit
OFFSET ((:page - 1) * :limit);
```

**Response shape:**

```typescript
interface CrmIncidentsResponse {
  data: IncidentRow[];
  pagination: {
    page:       number;
    limit:      number;
    total:      number;
    totalPages: number;
  };
  filters: {
    county:   string | null;
    severity: string | null;
    dateFrom: string | null;
    dateTo:   string | null;
  };
}
```

---

### 4.2 Contacts View

```typescript
// server/routes/crm/contacts.ts

/**
 * GET /api/crm/contacts
 *
 * Returns contacts where view_class = 'contact'.
 * Joined to contact_ai_profiles for grade display.
 * Used by the /crm/contacts tab.
 */
router.get(
  '/api/crm/contacts',
  requireAuth,
  requireAccountAccess,
  async (req: Request, res: Response): Promise<void> => {
    const params: CrmContactsParams = {
      accountId:  z.number().parse(Number(req.query.accountId)),
      hasPhone:   req.query.hasPhone  === 'true' ? true : undefined,
      hasEmail:   req.query.hasEmail  === 'true' ? true : undefined,
      grade:      req.query.grade     as string | undefined,   // 'A+'|'A'|'B+'|'B'|'C'|'D'|'F'
      workflow:   req.query.workflow  as string | undefined,   // workflow_stage value
      county:     req.query.county    as string | undefined,
      page:       Number(req.query.page  ?? 1),
      limit:      Math.min(Number(req.query.limit ?? 50), 200),
    };
    // ...
  }
);
```

**SQL template:**

```sql
SELECT
  c.id,
  c.first_name,
  c.last_name,
  c.phone,
  c.email,
  c.county,
  c.workflow_stage,
  c.export_eligible,
  c.skip_trace_status,
  c.identity_status,
  c.enrichment_completed_at,
  c.contact_quality_score,
  c.lead_vertical,
  c.tags,
  c.created_at,
  cap.letter_grade,
  cap.numeric_score
FROM contacts c
LEFT JOIN contact_ai_profiles cap
  ON cap.contact_id = c.id
  AND cap.account_id = c.account_id
WHERE
  c.account_id    = :accountId
  AND c.view_class = 'contact'
  AND (:hasPhone  IS NULL OR (c.phone IS NOT NULL) = :hasPhone)
  AND (:hasEmail  IS NULL OR (c.email IS NOT NULL) = :hasEmail)
  AND (:grade     IS NULL OR cap.letter_grade = :grade)
  AND (:workflow  IS NULL OR c.workflow_stage = :workflow)
  AND (:county    IS NULL OR c.county = :county)
ORDER BY
  COALESCE(cap.numeric_score, 0) DESC,
  c.created_at DESC
LIMIT :limit
OFFSET ((:page - 1) * :limit);
```

**Response shape:**

```typescript
interface CrmContactsResponse {
  data: ContactRow[];
  pagination: PaginationMeta;
  filters: {
    hasPhone: boolean | null;
    hasEmail: boolean | null;
    grade:    string | null;
    workflow: string | null;
    county:   string | null;
  };
}
```

---

### 4.3 Opportunities View

```typescript
// server/routes/crm/opportunities.ts

/**
 * GET /api/crm/opportunities
 *
 * Returns contacts where view_class = 'opportunity'.
 * Requires join to contact_ai_profiles; grade filter defaults to A,A+.
 * Used by the /crm/opportunities tab.
 */
router.get(
  '/api/crm/opportunities',
  requireAuth,
  requireAccountAccess,
  async (req: Request, res: Response): Promise<void> => {
    const gradeRaw = req.query.grade as string | undefined;
    const grades   = gradeRaw ? gradeRaw.split(',') : ['A+', 'A'];

    const params: CrmOpportunitiesParams = {
      accountId:  z.number().parse(Number(req.query.accountId)),
      grades,                                                     // default: ['A+','A']
      territory:  req.query.territory as string | undefined,      // county alias
      page:       Number(req.query.page  ?? 1),
      limit:      Math.min(Number(req.query.limit ?? 50), 200),
    };
    // ...
  }
);
```

**SQL template:**

```sql
SELECT
  c.id,
  c.first_name,
  c.last_name,
  c.phone,
  c.email,
  c.county,
  c.workflow_stage,
  c.export_eligible,
  c.lead_vertical,
  c.lead_type,
  c.source_pipeline,
  c.tags,
  c.created_at,
  cap.letter_grade,
  cap.numeric_score,
  cap.score_factors
FROM contacts c
INNER JOIN contact_ai_profiles cap
  ON cap.contact_id = c.id
  AND cap.account_id = c.account_id
WHERE
  c.account_id     = :accountId
  AND c.view_class = 'opportunity'
  AND cap.letter_grade = ANY(:grades)
  AND (:territory  IS NULL OR c.county = :territory)
ORDER BY
  cap.numeric_score DESC,
  c.created_at DESC
LIMIT :limit
OFFSET ((:page - 1) * :limit);
```

**Note:** Opportunities use `INNER JOIN` (not `LEFT JOIN`) on `contact_ai_profiles`. A record with no AI score cannot be an opportunity — the grade filter is mandatory for this view.

**Response shape:**

```typescript
interface CrmOpportunitiesResponse {
  data: OpportunityRow[];
  pagination: PaginationMeta;
  filters: {
    grades:    string[];
    territory: string | null;
  };
}
```

---

### 4.4 Count Aggregation Endpoint

```typescript
// server/routes/crm/counts.ts

/**
 * GET /api/crm/counts
 *
 * Returns sidebar badge counts for all CRM views.
 * Single query — no N+1. Used on sidebar mount and 60s polling.
 */
router.get(
  '/api/crm/counts',
  requireAuth,
  requireAccountAccess,
  async (req: Request, res: Response): Promise<void> => {
    const accountId = z.number().parse(Number(req.query.accountId));
    // Single aggregation query — see Section 8
  }
);
```

**Response shape:**

```typescript
interface CrmCountsResponse {
  incidents:     number;
  contacts:      number;
  opportunities: number;
  cases:         number;   // from existing cases table
  campaigns:     number;   // from existing campaigns table
  hotLeads:      number;   // grade IN ('A+','A') AND workflow_stage = 'READY'
  needsSkipTrace: number;  // skip_trace_status='not_attempted' AND identity_status!='verified'
  readyForDialing: number; // phone IS NOT NULL AND workflow_stage IN ('READY','FOLLOW_UP')
}
```

---

## 5. Quick Filter Definitions

Quick filters are horizontal pill buttons rendered above the list on each tab. Each pill maps to a fixed WHERE clause appended to the base view query. Only one quick filter can be active at a time; it composes with sidebar panel filters.

### 5.1 Hot Leads

**Label:** Hot Leads
**Views:** Contacts, Opportunities

```sql
AND cap.letter_grade IN ('A+', 'A')
AND c.workflow_stage = 'READY'
```

---

### 5.2 New Today

**Label:** New Today
**Views:** Contacts, Incidents

```sql
AND c.created_at >= now() - interval '24 hours'
AND c.view_class = 'contact'
```

For the Incidents view, substitute `view_class IN ('signal', 'incident')`.

---

### 5.3 Ready For Dialing

**Label:** Ready For Dialing
**Views:** Contacts

```sql
AND c.phone IS NOT NULL
AND c.workflow_stage IN ('READY', 'FOLLOW_UP')
AND c.sms_opt_out = false
```

---

### 5.4 Needs Skip Trace

**Label:** Needs Skip Trace
**Views:** Contacts

```sql
AND c.skip_trace_status = 'not_attempted'
AND c.identity_status != 'verified'
```

Note: Records where `identity_status` is NULL satisfy `!= 'verified'` in PostgreSQL (NULL comparisons return NULL, not TRUE). Application layer must handle this explicitly:

```sql
AND c.skip_trace_status = 'not_attempted'
AND (c.identity_status IS NULL OR c.identity_status != 'verified')
```

---

### 5.5 High Severity

**Label:** High Severity
**Views:** Incidents

```sql
AND c.severity IN ('high', 'critical')
```

---

### 5.6 Recently Enriched

**Label:** Recently Enriched
**Views:** Contacts

```sql
AND c.enrichment_completed_at >= now() - interval '7 days'
```

---

### 5.7 High Conversion Probability

**Label:** High Conversion
**Views:** Opportunities

```sql
AND cap.letter_grade IN ('A+', 'A')
AND c.export_eligible = true
```

---

### 5.8 Quick Filter Parameter Encoding

Quick filters are passed as a `quickFilter` query parameter. The backend resolves them to SQL clauses. This keeps URL state bookmarkable.

```
GET /api/crm/contacts?accountId=3&quickFilter=hot_leads
GET /api/crm/contacts?accountId=3&quickFilter=ready_for_dialing
GET /api/crm/contacts?accountId=3&quickFilter=needs_skip_trace
GET /api/crm/incidents?accountId=3&quickFilter=high_severity
```

**Backend resolution map:**

```typescript
const QUICK_FILTER_MAP: Record<string, QuickFilterClause> = {
  hot_leads: {
    joins:  ['LEFT JOIN contact_ai_profiles cap ON cap.contact_id = c.id AND cap.account_id = c.account_id'],
    where:  ["cap.letter_grade IN ('A+', 'A')", "c.workflow_stage = 'READY'"],
  },
  new_today: {
    joins:  [],
    where:  ["c.created_at >= now() - interval '24 hours'"],
  },
  ready_for_dialing: {
    joins:  [],
    where:  ["c.phone IS NOT NULL", "c.workflow_stage IN ('READY', 'FOLLOW_UP')", "c.sms_opt_out = false"],
  },
  needs_skip_trace: {
    joins:  [],
    where:  ["c.skip_trace_status = 'not_attempted'", "(c.identity_status IS NULL OR c.identity_status != 'verified')"],
  },
  high_severity: {
    joins:  [],
    where:  ["c.severity IN ('high', 'critical')"],
  },
  recently_enriched: {
    joins:  [],
    where:  ["c.enrichment_completed_at >= now() - interval '7 days'"],
  },
  high_conversion: {
    joins:  ['LEFT JOIN contact_ai_profiles cap ON cap.contact_id = c.id AND cap.account_id = c.account_id'],
    where:  ["cap.letter_grade IN ('A+', 'A')", "c.export_eligible = true"],
  },
};
```

---

## 6. Human-Readable Label Translation

These translations are applied at the frontend layer. Tags and status values stored in the database are infrastructure identifiers. Display labels must be operator-facing language.

### 6.1 Tag Labels

| Infrastructure Tag | Display Label | Context |
|-------------------|---------------|---------|
| `no-phone` | Needs Contact Info | Row badge on Contacts view |
| `skip-traced` | Recently Enriched | Row badge on Contacts view |
| `sentinel-auto` | Auto-Detected Incident | Row badge on Incidents view |
| `placeholder` | Unverified Record | Row badge — warning style |
| `verified` | Verified Contact | Row badge — success style |
| `court-sourced` | Legal Filing | Row badge on Incidents view |
| `jail-booking` | Recent Booking | Row badge on Incidents view |
| `home-service` | Home Service Signal | Row badge on Incidents view |
| `export-ready` | Export Ready | Row badge — primary style |

### 6.2 Status Field Labels

| Field | Raw Value | Display Label |
|-------|-----------|---------------|
| `identity_status` | `verified` | Verified |
| `identity_status` | `unverified` | Unverified |
| `identity_status` | `disputed` | Review Needed |
| `identity_status` | `placeholder` | Placeholder — No Identity |
| `skip_trace_status` | `not_attempted` | Not Enriched |
| `skip_trace_status` | `in_progress` | Enriching... |
| `skip_trace_status` | `completed` | Enriched |
| `skip_trace_status` | `failed` | Enrichment Failed |
| `workflow_stage` | `NEW` | New |
| `workflow_stage` | `ENRICHING` | Enriching |
| `workflow_stage` | `READY` | Ready |
| `workflow_stage` | `FOLLOW_UP` | Follow Up |
| `workflow_stage` | `RETAINED` | Retained |
| `workflow_stage` | `DEAD` | Dead |
| `export_eligible` | `true` | Export Ready |
| `export_eligible` | `false` | Not Export Ready |
| `severity` | `critical` | Critical |
| `severity` | `high` | High |
| `severity` | `medium` | Medium |
| `severity` | `low` | Low |

### 6.3 Grade Display

| `letter_grade` | Display | Color Token |
|---------------|---------|-------------|
| `A+` | A+ | `--color-grade-aplus` (emerald-600) |
| `A` | A | `--color-grade-a` (green-500) |
| `B+` | B+ | `--color-grade-bplus` (lime-500) |
| `B` | B | `--color-grade-b` (yellow-500) |
| `C` | C | `--color-grade-c` (orange-400) |
| `D` | D | `--color-grade-d` (red-400) |
| `F` | F | `--color-grade-f` (red-700) |

### 6.4 Translation Utility

```typescript
// client/src/lib/crmLabels.ts

export const TAG_LABELS: Record<string, string> = {
  'no-phone':       'Needs Contact Info',
  'skip-traced':    'Recently Enriched',
  'sentinel-auto':  'Auto-Detected Incident',
  'placeholder':    'Unverified Record',
  'verified':       'Verified Contact',
  'court-sourced':  'Legal Filing',
  'jail-booking':   'Recent Booking',
  'home-service':   'Home Service Signal',
  'export-ready':   'Export Ready',
};

export const WORKFLOW_LABELS: Record<string, string> = {
  NEW:        'New',
  ENRICHING:  'Enriching',
  READY:      'Ready',
  FOLLOW_UP:  'Follow Up',
  RETAINED:   'Retained',
  DEAD:       'Dead',
};

export const IDENTITY_LABELS: Record<string, string> = {
  verified:    'Verified',
  unverified:  'Unverified',
  disputed:    'Review Needed',
  placeholder: 'Placeholder — No Identity',
};

export const SKIP_TRACE_LABELS: Record<string, string> = {
  not_attempted: 'Not Enriched',
  in_progress:   'Enriching...',
  completed:     'Enriched',
  failed:        'Enrichment Failed',
};

export function resolveTagLabel(tag: string): string {
  return TAG_LABELS[tag] ?? tag;
}

export function resolveWorkflowLabel(stage: string): string {
  return WORKFLOW_LABELS[stage] ?? stage;
}
```

---

## 7. Per-View Filter Schemas

Each CRM tab renders a different set of filter controls in the left panel. Filters that are irrelevant to a view type do not appear — this prevents operator confusion.

### 7.1 Incidents View Filters

| Filter | Control Type | Query Param | Notes |
|--------|-------------|-------------|-------|
| County | Multi-select | `county` | Values from distinct `county` on account |
| Severity | Multi-select pill | `severity` | low, medium, high, critical |
| Date From | Date picker | `dateFrom` | ISO 8601 |
| Date To | Date picker | `dateTo` | ISO 8601 |
| Source Pipeline | Select | `sourcePipeline` | sentinel, court, jail, home-service |
| Lead Vertical | Select | `leadVertical` | crash, legal, home-service |

**API parameter block:**

```typescript
interface IncidentsFilterParams {
  accountId:      number;
  county?:        string;
  severity?:      'low' | 'medium' | 'high' | 'critical';
  dateFrom?:      string;  // ISO 8601
  dateTo?:        string;  // ISO 8601
  sourcePipeline?: string;
  leadVertical?:  string;
  quickFilter?:   string;
  page:           number;
  limit:          number;
}
```

---

### 7.2 Contacts View Filters

| Filter | Control Type | Query Param | Notes |
|--------|-------------|-------------|-------|
| County | Multi-select | `county` | |
| Has Phone | Toggle | `hasPhone` | true / false / any |
| Has Email | Toggle | `hasEmail` | true / false / any |
| AI Grade | Multi-select pill | `grade` | A+, A, B+, B, C, D, F |
| Workflow Stage | Multi-select | `workflow` | NEW, ENRICHING, READY, FOLLOW_UP |
| Skip Trace Status | Select | `skipTraceStatus` | not_attempted, in_progress, completed, failed |
| Identity Status | Select | `identityStatus` | verified, unverified, disputed, placeholder |
| Export Eligible | Toggle | `exportEligible` | |
| Date From | Date picker | `dateFrom` | Applied to `created_at` |
| Date To | Date picker | `dateTo` | Applied to `created_at` |

**API parameter block:**

```typescript
interface ContactsFilterParams {
  accountId:        number;
  county?:          string;
  hasPhone?:        boolean;
  hasEmail?:        boolean;
  grade?:           string;   // comma-separated: 'A+,A'
  workflow?:        string;   // comma-separated: 'READY,FOLLOW_UP'
  skipTraceStatus?: string;
  identityStatus?:  string;
  exportEligible?:  boolean;
  dateFrom?:        string;
  dateTo?:          string;
  quickFilter?:     string;
  page:             number;
  limit:            number;
}
```

---

### 7.3 Opportunities View Filters

| Filter | Control Type | Query Param | Notes |
|--------|-------------|-------------|-------|
| Territory (County) | Multi-select | `territory` | |
| AI Grade | Multi-select pill (default: A+, A) | `grade` | |
| Lead Vertical | Select | `leadVertical` | crash, legal, home-service |
| Export Eligible | Toggle | `exportEligible` | Default: any |
| Source Pipeline | Select | `sourcePipeline` | |

**API parameter block:**

```typescript
interface OpportunitiesFilterParams {
  accountId:       number;
  territory?:      string;
  grade?:          string;   // comma-separated; default 'A+,A'
  leadVertical?:   string;
  exportEligible?: boolean;
  sourcePipeline?: string;
  quickFilter?:    string;
  page:            number;
  limit:           number;
}
```

---

### 7.4 Cases and Campaigns Views

Cases and Campaigns use their existing filter schemas. No changes are required. The CRM navigation wraps them in the new tab chrome but does not modify their underlying components or endpoints.

---

## 8. Count Aggregation Query

The sidebar badge counts are produced by a single query that aggregates across all view types for the given account. This avoids five separate round-trips.

```sql
-- GET /api/crm/counts?accountId=:accountId
-- Returns one row with all badge counts

SELECT
  -- Primary view counts
  COUNT(*) FILTER (
    WHERE view_class IN ('signal', 'incident')
  )                                                         AS incidents,

  COUNT(*) FILTER (
    WHERE view_class = 'contact'
  )                                                         AS contacts,

  COUNT(*) FILTER (
    WHERE view_class = 'opportunity'
  )                                                         AS opportunities,

  -- Quick filter badge counts (most operationally important)
  COUNT(*) FILTER (
    WHERE view_class = 'contact'
    AND workflow_stage = 'READY'
    AND phone IS NOT NULL
    AND (sms_opt_out = false OR sms_opt_out IS NULL)
  )                                                         AS ready_for_dialing,

  COUNT(*) FILTER (
    WHERE view_class = 'contact'
    AND skip_trace_status = 'not_attempted'
    AND (identity_status IS NULL OR identity_status != 'verified')
  )                                                         AS needs_skip_trace,

  COUNT(*) FILTER (
    WHERE view_class IN ('signal', 'incident')
    AND severity IN ('high', 'critical')
  )                                                         AS high_severity,

  COUNT(*) FILTER (
    WHERE created_at >= now() - interval '24 hours'
    AND view_class = 'contact'
  )                                                         AS new_today

FROM contacts
WHERE account_id = :accountId;
```

Cases and campaigns counts are fetched from their respective tables in the same response handler and merged:

```typescript
// server/routes/crm/counts.ts

async function getCrmCounts(accountId: number): Promise<CrmCountsResponse> {
  const [contactCounts, casesCount, campaignsCount, hotLeadsCount] =
    await Promise.all([
      db.query(CONTACTS_AGGREGATE_QUERY, [accountId]),
      db.query(`SELECT COUNT(*) FROM cases WHERE account_id = $1`, [accountId]),
      db.query(`SELECT COUNT(*) FROM campaigns WHERE account_id = $1`, [accountId]),
      db.query(
        `SELECT COUNT(*) FROM contacts c
         INNER JOIN contact_ai_profiles cap ON cap.contact_id = c.id
         WHERE c.account_id = $1
           AND cap.letter_grade IN ('A+', 'A')
           AND c.workflow_stage = 'READY'`,
        [accountId]
      ),
    ]);

  return {
    incidents:       Number(contactCounts.rows[0].incidents),
    contacts:        Number(contactCounts.rows[0].contacts),
    opportunities:   Number(contactCounts.rows[0].opportunities),
    cases:           Number(casesCount.rows[0].count),
    campaigns:       Number(campaignsCount.rows[0].count),
    hotLeads:        Number(hotLeadsCount.rows[0].count),
    readyForDialing: Number(contactCounts.rows[0].ready_for_dialing),
    needsSkipTrace:  Number(contactCounts.rows[0].needs_skip_trace),
    highSeverity:    Number(contactCounts.rows[0].high_severity),
    newToday:        Number(contactCounts.rows[0].new_today),
  };
}
```

---

## 9. Bulk Action Support

Bulk actions operate on a set of contact IDs selected by the operator. All bulk actions are account-scoped — cross-account bulk operations are rejected at the middleware layer.

### 9.1 Bulk Workflow Stage Update

```typescript
// POST /api/crm/bulk/workflow-stage

interface BulkWorkflowStageRequest {
  accountId:     number;
  contactIds:    number[];  // max 500 per request
  workflowStage: 'NEW' | 'ENRICHING' | 'READY' | 'FOLLOW_UP' | 'RETAINED' | 'DEAD';
}
```

```sql
UPDATE contacts
SET
  workflow_stage = :workflowStage,
  updated_at     = now()
WHERE
  id = ANY(:contactIds)
  AND account_id = :accountId;  -- account_id guard is mandatory
```

**Audit log:** Every bulk workflow stage change is written to `contact_activities`:

```sql
INSERT INTO contact_activities (contact_id, account_id, activity_type, description, created_at)
SELECT
  id,
  :accountId,
  'bulk_workflow_update',
  'Workflow stage set to ' || :workflowStage || ' via bulk action',
  now()
FROM contacts
WHERE id = ANY(:contactIds) AND account_id = :accountId;
```

---

### 9.2 Bulk Export Flag

```typescript
// POST /api/crm/bulk/export-flag

interface BulkExportFlagRequest {
  accountId:      number;
  contactIds:     number[];  // max 500 per request
  exportEligible: boolean;
}
```

```sql
UPDATE contacts
SET
  export_eligible = :exportEligible,
  updated_at      = now()
WHERE
  id = ANY(:contactIds)
  AND account_id = :accountId;
```

**Guard:** Setting `export_eligible = true` is only permitted if the contact has either `phone IS NOT NULL` OR `email IS NOT NULL`. The backend validates this before executing the update.

```typescript
// Pre-validation query
const unqualified = await db.query(
  `SELECT id FROM contacts
   WHERE id = ANY($1)
     AND account_id = $2
     AND phone IS NULL
     AND email IS NULL`,
  [contactIds, accountId]
);

if (exportEligible && unqualified.rows.length > 0) {
  return res.status(422).json({
    error: 'EXPORT_INELIGIBLE',
    message: `${unqualified.rows.length} contacts cannot be marked export-eligible: no phone or email.`,
    invalidIds: unqualified.rows.map(r => r.id),
  });
}
```

---

### 9.3 Bulk Tag

```typescript
// POST /api/crm/bulk/tag

interface BulkTagRequest {
  accountId:  number;
  contactIds: number[];  // max 500 per request
  tags:       string[];  // tags to add (additive, not replace)
  action:     'add' | 'remove';
}
```

Tags are stored as `text[]` on `contacts.tags`. Postgres array operations handle add/remove without full rewrites:

```sql
-- Add tags
UPDATE contacts
SET
  tags       = array(SELECT DISTINCT unnest(tags || :newTags::text[])),
  updated_at = now()
WHERE
  id = ANY(:contactIds)
  AND account_id = :accountId;

-- Remove tags
UPDATE contacts
SET
  tags       = array(SELECT unnest(tags) EXCEPT SELECT unnest(:removeTags::text[])),
  updated_at = now()
WHERE
  id = ANY(:contactIds)
  AND account_id = :accountId;
```

---

### 9.4 Bulk Action Response Shape

All bulk actions return a consistent envelope:

```typescript
interface BulkActionResponse {
  success:   boolean;
  affected:  number;    // rows actually updated
  requested: number;    // IDs in the request
  skipped:   number;    // IDs not found or not owned by account
  errors:    BulkActionError[];
}
```

---

## 10. Frontend Component Breakdown

### 10.1 Shared Infrastructure

```
client/src/
└── pages/
│   └── crm/
│       ├── CrmLayout.tsx          ← Tab chrome, sidebar nav, counts polling
│       ├── IncidentsView.tsx      ← /crm/incidents
│       ├── ContactsView.tsx       ← /crm/contacts
│       ├── OpportunitiesView.tsx  ← /crm/opportunities
│       ├── CasesView.tsx          ← wraps existing cases page
│       └── CampaignsView.tsx     ← wraps existing campaigns page
└── components/
    └── crm/
        ├── CrmFilterPanel.tsx     ← Left panel; receives filterSchema prop
        ├── CrmQuickFilters.tsx    ← Horizontal pill row
        ├── CrmTable.tsx           ← Generic sortable/paginated table
        ├── CrmRowBadge.tsx        ← Tag → display label renderer
        ├── GradeChip.tsx          ← A+/A/B color chip
        ├── WorkflowStagePill.tsx  ← Workflow stage with color
        ├── BulkActionBar.tsx      ← Appears when rows are selected
        └── CrmCountBadge.tsx     ← Sidebar badge
```

### 10.2 What Each Tab Renders Differently

#### Incidents Tab (`/crm/incidents`)

- **Columns:** Date, County, Severity chip (color-coded), Source Pipeline, Lead Vertical, Type, Tags
- **Quick Filters:** High Severity, New Today
- **No grade column** — AI scoring does not apply to raw signals
- **No export flag column** — incidents are not directly exportable
- **Row click:** Opens signal/incident detail drawer, not contact profile
- **Default sort:** `created_at DESC`
- **Empty state:** "No incidents match your filters. Adjust date range or county."

#### Contacts Tab (`/crm/contacts`)

- **Columns:** Name, Phone (masked), Email (masked), County, Grade chip, Workflow Stage pill, Skip Trace Status, Export Eligible badge, Created Date
- **Quick Filters:** Hot Leads, New Today, Ready For Dialing, Needs Skip Trace, Recently Enriched
- **Bulk actions:** Workflow Stage Update, Export Flag, Tag
- **Row click:** Opens full contact profile (existing `/contacts/:id` page)
- **Default sort:** `numeric_score DESC, created_at DESC`
- **Empty state:** "No contacts found. Try adjusting your filters or import new contacts."

#### Opportunities Tab (`/crm/opportunities`)

- **Columns:** Name, Phone, Email, County (Territory), Grade chip, Score (numeric), Lead Vertical, Export Eligible, Source Pipeline
- **Quick Filters:** High Conversion (A+/A + export_eligible)
- **Grade pills default to A+ and A** — lower grades are hidden unless explicitly added to the filter
- **Bulk actions:** Export Flag, Tag
- **Row click:** Opens contact profile with opportunity context sidebar
- **Default sort:** `numeric_score DESC`
- **Empty state:** "No high-grade opportunities in this territory. Expand your grade filter or run skip trace on Contacts tab first."

#### Cases Tab (`/crm/cases`)

- Renders existing case management UI inside CRM tab chrome
- No filter or data changes
- Passes `accountId` prop from CRM layout context

#### Campaigns Tab (`/crm/campaigns`)

- Renders existing campaigns UI inside CRM tab chrome
- No filter or data changes

### 10.3 CrmFilterPanel Schema Prop

The filter panel receives a `filterSchema` prop that drives which controls render. Each view passes its own schema:

```typescript
// client/src/components/crm/CrmFilterPanel.tsx

interface FilterField {
  key:      string;
  label:    string;
  type:     'select' | 'multiselect' | 'toggle' | 'daterange' | 'pills';
  options?: { value: string; label: string }[];
}

interface CrmFilterPanelProps {
  schema:   FilterField[];
  values:   Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onReset:  () => void;
  onApply:  () => void;
}
```

Each view defines its own `FILTER_SCHEMA` constant. The panel component is shared and generic — it does not know what a "grade" or "severity" is.

### 10.4 State Management

CRM filter state is managed with TanStack Query + URL search params. Filter values are serialized into the URL so that:

- Browser back/forward works correctly
- Operators can bookmark or share filtered views
- Tab switches do not reset filter state

```typescript
// Serialization pattern
const [searchParams, setSearchParams] = useSearchParams();

const filters = {
  county:    searchParams.get('county')    ?? undefined,
  grade:     searchParams.get('grade')     ?? undefined,
  workflow:  searchParams.get('workflow')  ?? undefined,
  quickFilter: searchParams.get('quickFilter') ?? undefined,
};

const { data, isLoading } = useQuery({
  queryKey: ['crm-contacts', accountId, filters],
  queryFn:  () => fetchCrmContacts({ accountId, ...filters }),
  staleTime: 30_000,
});
```

---

## 11. Zero-Downtime Migration

### 11.1 Migration Phases

The migration from the single `/contacts` feed to the split CRM views proceeds in five phases. No phase requires downtime. The old routes remain functional throughout.

---

**Phase 1: Schema Migration (Day 1)**

Add the new columns and indexes to the `contacts` table and create `contact_ai_profiles`. All new columns have safe defaults; no existing query behavior changes.

```sql
-- Run as a single transaction
BEGIN;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS view_class      varchar(30)  DEFAULT 'contact',
  ADD COLUMN IF NOT EXISTS workflow_stage  varchar(50)  DEFAULT 'NEW',
  ADD COLUMN IF NOT EXISTS export_eligible boolean      DEFAULT false,
  ADD COLUMN IF NOT EXISTS lead_type       varchar(50),
  ADD COLUMN IF NOT EXISTS source_pipeline varchar(100),
  ADD COLUMN IF NOT EXISTS severity        varchar(20),
  ADD COLUMN IF NOT EXISTS sms_opt_out     boolean      DEFAULT false;

CREATE TABLE IF NOT EXISTS contact_ai_profiles ( ... );

COMMIT;

-- Indexes created CONCURRENTLY (no table lock)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_account_view_class
  ON contacts (account_id, view_class);
-- ... (all indexes from Section 3.3, each with CONCURRENTLY)
```

**Rollback:** All columns have defaults; dropping them is safe if needed.

---

**Phase 2: Backfill `view_class` (Day 1–2)**

Classify existing records by their inferred type. Run as a background job in batches of 1,000 rows to avoid table lock contention.

```sql
-- Batch backfill (run in loop until 0 rows affected)
UPDATE contacts
SET view_class = CASE
  WHEN raw_source_type IN ('sentinel_incident', 'crash_report', 'home_service_signal') THEN 'signal'
  WHEN raw_source_type IN ('legal_filing', 'court_record') THEN 'incident'
  WHEN lead_type = 'individual' AND (phone IS NOT NULL OR email IS NOT NULL) THEN 'contact'
  ELSE 'contact'  -- safe default for unclassified records
END
WHERE
  view_class IS NULL OR view_class = 'contact'  -- re-evaluate nulls and defaults
  AND id IN (
    SELECT id FROM contacts
    WHERE account_id = :accountId
    ORDER BY id
    LIMIT 1000
    OFFSET :batchOffset
  );
```

**Signal for completion:** The backfill worker logs batch progress to `system_logs`. A monitoring endpoint `GET /internal/crm/backfill-status` reports remaining unclassified rows.

---

**Phase 3: Deploy New API Endpoints (Day 2)**

Deploy the additive `/api/crm/*` routes alongside existing routes. Both old and new routes are live simultaneously. No UI change yet.

**Verification:**

```bash
# Smoke test — should return 200 with data
curl "https://api.apex.io/api/crm/counts?accountId=3" \
  -H "Authorization: Bearer $TOKEN"

curl "https://api.apex.io/api/crm/contacts?accountId=3&limit=5" \
  -H "Authorization: Bearer $TOKEN"
```

---

**Phase 4: Deploy Split CRM UI Behind Feature Flag (Day 3)**

Deploy the new `/crm/*` routes in React behind a feature flag. The legacy `/contacts` route continues to work. Operators who want to preview the new CRM navigate to `/crm/contacts` manually. No redirect yet.

Feature flag key: `crm_split_views_enabled`

```typescript
// client/src/App.tsx
const crmSplitEnabled = useFeatureFlag('crm_split_views_enabled');

// In route definitions:
{crmSplitEnabled && (
  <>
    <Route path="/crm/incidents"    component={IncidentsView} />
    <Route path="/crm/contacts"     component={ContactsView} />
    <Route path="/crm/opportunities" component={OpportunitiesView} />
  </>
)}
// Legacy routes remain:
<Route path="/contacts" component={LegacyContactsList} />
```

---

**Phase 5: Cut Over and Legacy Sunset (Day 7+)**

After at least 5 days of parallel operation with no issues:

1. Enable `crm_split_views_enabled` for all accounts
2. Add a redirect: `GET /contacts` → `GET /crm/contacts` (HTTP 302, preserves query params)
3. Update nav links to point to `/crm/*` routes
4. Keep legacy routes live for 30 days to catch any bookmarked URLs
5. After 30 days, remove legacy routes in a clean-up PR

**No database changes required for cut-over.** The schema migration is fully complete by Phase 1.

---

### 11.2 Rollback Procedure

If any phase introduces regressions:

| Phase | Rollback Action |
|-------|----------------|
| Phase 1 (Schema) | Drop new columns via migration (no data loss — columns were empty) |
| Phase 2 (Backfill) | Stop background job; re-set `view_class = 'contact'` for all rows (restores original behavior) |
| Phase 3 (API) | Remove CRM routes from router; redeploy previous build |
| Phase 4 (UI) | Disable feature flag; CRM UI disappears, legacy UI unchanged |
| Phase 5 (Cut-over) | Remove redirect; restore nav links to `/contacts` |

---

## 12. Index Strategy

All CRM list queries must hit an index. The following matrix maps each endpoint + filter combination to its covering index.

| Endpoint | Filter Applied | Index Used |
|----------|---------------|-----------|
| `/api/crm/incidents` | base (no filter) | `idx_contacts_account_view_class` |
| `/api/crm/incidents` | `county` | `idx_contacts_account_county` + filter on view_class |
| `/api/crm/incidents` | `severity` | `idx_contacts_account_severity` |
| `/api/crm/incidents` | `dateFrom/dateTo` | `idx_contacts_account_created_at` |
| `/api/crm/contacts` | base | `idx_contacts_account_view_class` |
| `/api/crm/contacts` | `hasPhone=true` | `idx_contacts_account_phone_notnull` |
| `/api/crm/contacts` | `workflow` | `idx_contacts_account_workflow_stage` |
| `/api/crm/contacts` | `county` | `idx_contacts_account_county` |
| `/api/crm/contacts` | `grade` | `idx_contact_ai_profiles_account_grade` (join) |
| `/api/crm/contacts` | `exportEligible=true` | `idx_contacts_account_export_eligible` |
| `/api/crm/contacts` | `skipTraceStatus` | `idx_contacts_skip_trace_status` |
| `/api/crm/contacts` | `enriched recently` | `idx_contacts_enrichment_completed_at` |
| `/api/crm/opportunities` | base | `idx_contacts_account_view_class` + `idx_contact_ai_profiles_account_grade` |
| `/api/crm/opportunities` | `territory` | `idx_contacts_account_county` |
| `/api/crm/counts` | aggregate | `idx_contacts_account_view_class` (single scan) |

**Never use:** `LIKE '%string%'` on unindexed text columns. If full-text search is required in a future phase, use a `tsvector` column with a GIN index — not an ad-hoc LIKE.

---

## 13. Performance Guarantees

### 13.1 Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| List query p95 latency | ≤ 200ms | Axiom query on `crm_list_duration_ms` |
| Count query p95 latency | ≤ 100ms | Single aggregate on indexed columns |
| Bulk action (500 rows) p95 | ≤ 500ms | Postgres batch UPDATE |
| Sidebar badge refresh | ≤ 100ms | Cached for 60s; stale-while-revalidate |

### 13.2 Query Execution Plan Validation

Before deploying each new CRM endpoint to production, run `EXPLAIN (ANALYZE, BUFFERS)` against the Neon staging branch with a representative dataset and confirm:

1. No `Seq Scan` on the `contacts` table
2. No `Nested Loop` with an inner `Seq Scan`
3. `Index Scan` or `Bitmap Index Scan` on the primary filter column
4. Actual rows returned close to estimated rows (statistics are fresh)

```sql
-- Example validation for contacts base query
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT c.id, c.first_name, c.last_name, c.phone, c.county,
       c.workflow_stage, c.export_eligible, c.created_at,
       cap.letter_grade, cap.numeric_score
FROM contacts c
LEFT JOIN contact_ai_profiles cap ON cap.contact_id = c.id AND cap.account_id = c.account_id
WHERE c.account_id = 3 AND c.view_class = 'contact'
ORDER BY COALESCE(cap.numeric_score, 0) DESC, c.created_at DESC
LIMIT 50 OFFSET 0;
```

Acceptable plan: `Index Scan using idx_contacts_account_view_class on contacts`.

### 13.3 Pagination Strategy

Phase 4B uses **offset pagination** as an acceptable baseline given current dataset sizes (~2,100 contacts per account). Offset pagination is adequate when:

- Total rows per account remain under 10,000
- No real-time feed requiring stable cursor position under concurrent inserts

If any account exceeds 10,000 contacts, migrate that endpoint to **cursor-based pagination** using `(numeric_score DESC, id DESC)` as the cursor key:

```sql
-- Cursor-based fallback (implement when accounts exceed 10k rows)
WHERE c.account_id = :accountId
  AND c.view_class = 'contact'
  AND (
    COALESCE(cap.numeric_score, 0) < :cursorScore
    OR (
      COALESCE(cap.numeric_score, 0) = :cursorScore
      AND c.id < :cursorId
    )
  )
ORDER BY COALESCE(cap.numeric_score, 0) DESC, c.id DESC
LIMIT :limit;
```

The response includes a `nextCursor` field when cursor pagination is active:

```typescript
interface PaginatedResponse<T> {
  data:       T[];
  nextCursor: string | null;   // base64-encoded {score, id} pair
  hasMore:    boolean;
  total?:     number;          // omitted in cursor mode (expensive COUNT)
}
```

---

*Document status: DESIGN COMPLETE — ready for implementation sprint.*
*Author: Apex Marketing OS Architecture | Generated: 2026-05-15*
*Related: APEX_CRM_INTELLIGENCE.md | APEX_POSTGRES_BRAIN_SCHEMA.md | STAGE_4A_OBSERVABILITY_PLAN.md | APEX_SIGNAL_ENGINE.md*
