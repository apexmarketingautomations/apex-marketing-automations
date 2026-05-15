# STAGE 4B — WORKFLOW VISIBILITY LAYER
**Apex Marketing OS — Contact Lifecycle Tracking**
Generated: 2026-05-15
Status: ARCHITECTURE DESIGN — Ready for implementation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Workflow Stages](#2-workflow-stages)
3. [Stage Transition Rules — Automatic](#3-stage-transition-rules--automatic)
4. [Stage Transition Rules — Manual (Operator)](#4-stage-transition-rules--manual-operator)
5. [Schema Changes](#5-schema-changes)
6. [Auto-Promotion Engine (BullMQ)](#6-auto-promotion-engine-bullmq)
7. [API Endpoints](#7-api-endpoints)
8. [CRM Workflow Column — UI Spec](#8-crm-workflow-column--ui-spec)
9. [Observability](#9-observability)
10. [Export Eligibility Auto-Set](#10-export-eligibility-auto-set)
11. [Migration Plan](#11-migration-plan)
12. [TypeScript Types](#12-typescript-types)

---

## 1. Executive Summary

### The Problem: Operators Are Flying Blind

The current Apex CRM surfaces raw contact data — name, phone, skip trace status — but provides no answer to the most important operational question an intake team asks fifty times a day:

> **"Where is this contact in the process, and what should we do with it right now?"**

Without a lifecycle stage, operators must:

- Manually inspect `skipTraceStatus`, `identityStatus`, and communication history to infer readiness
- Rely on memory or side spreadsheets to track follow-up obligations
- Perform manual database queries to answer "how many contacts are ready to dial today?"
- Discover opted-out or dead contacts by accident during outreach, wasting effort and risking compliance exposure

The result is friction, duplication of effort, and leads falling through cracks between the enrichment pipeline and the dialing desk.

### The Solution: `workflow_stage` as First-Class Data

Phase 4B introduces a `workflow_stage` column on the `contacts` table as the canonical lifecycle signal for every contact in the system. It is:

- **Machine-set** via the BullMQ auto-promotion engine when enrichment or communication events fire
- **Human-overridable** with a required reason field and full audit trail
- **Bulk-editable** for operators managing lists at scale
- **Filterable and sortable** in the CRM table view
- **Fully audited** via the `contact_workflow_events` table

Every stage change — automatic or manual — is an immutable event in `contact_workflow_events`. The contact detail view exposes this as a timeline. Nothing is inferred at query time; the stage is always ground truth, always readable from a single column.

### Business Impact

| Before 4B | After 4B |
|-----------|----------|
| "How many contacts are ready to dial?" requires a multi-join query | Single filter: `workflow_stage = 'READY'` |
| Operators manually check skip trace status before dialing | READY badge signals enrichment is done and phone is present |
| No record of when a contact moved between states | Full `contact_workflow_events` audit trail |
| Bulk moves require custom scripts | POST `/api/contacts/bulk-stage` up to 500 at once |
| Follow-up scheduling is manual and forgettable | BullMQ promotes CONTACTED → FOLLOW_UP after 48h automatically |

---

## 2. Workflow Stages

Stages are ordered. The canonical progression is left to right. Not every contact traverses every stage — DEAD is reachable from any stage, and ENRICHING can loop back to NEW.

```
NEW → ENRICHING → READY → CONTACTED → FOLLOW_UP → RETAINED
                ↘                                       ↑
                 NEW (no match)               (manual or case creation)
                
Any Stage → DEAD (opt-out, N failures, manual)
```

### Stage Reference

| Stage | Color | Hex | Meaning |
|-------|-------|-----|---------|
| `NEW` | Gray | `#6B7280` | Just ingested. No enrichment attempted, no action taken. Default for all contacts on write. |
| `ENRICHING` | Blue | `#3B82F6` | Skip trace in progress or enrichment job queued. Phone not yet confirmed. |
| `READY` | Green | `#10B981` | Skip trace matched, phone present, not opted out. Eligible for outreach. |
| `CONTACTED` | Yellow | `#F59E0B` | First contact attempt logged (call, SMS, or email). Awaiting response. |
| `FOLLOW_UP` | Orange | `#F97316` | Attempted contact, no response received within 48h. Scheduled for follow-up. |
| `RETAINED` | Purple | `#8B5CF6` | Converted: case created or engagement signed. Terminal success state. |
| `DEAD` | Red | `#EF4444` | Unresponsive after N attempts, opted out, or determined not viable. Terminal failure state. |

### Stage Invariants

- `workflow_stage` is `NOT NULL` with default `'NEW'`
- `RETAINED` and `DEAD` are terminal: automatic promotion does not move out of them
- Manual override can move out of any stage including terminal states (with required reason)
- `DEAD` is set automatically on opt-out regardless of current stage — this takes precedence over all other transitions

---

## 3. Stage Transition Rules — Automatic

Automatic transitions are evaluated by the BullMQ `contact.workflow.evaluate` job. They are never run in a real-time loop. Each transition is triggered by a specific upstream event or scheduled timer.

### Transition Matrix

```
NEW → ENRICHING
  Trigger: skipTraceStatus changes to 'pending' OR 'attempted'
  Evaluated by: enrichment.started event (BullMQ)
  Condition: contact.skipTraceStatus IN ('pending', 'attempted')

ENRICHING → READY
  Trigger: enrichment job completes with skipTraceStatus = 'matched'
  Evaluated by: enrichment.completed event (BullMQ)
  Condition: contact.skipTraceStatus = 'matched'
           AND contact.phone IS NOT NULL
           AND contact.smsOptOut IS NOT TRUE
           AND contact.emailOptOut IS NOT TRUE (at least one channel open)
           AND contact.workflow_stage = 'ENRICHING'

ENRICHING → NEW
  Trigger: enrichment job completes with skipTraceStatus = 'no_match'
  Evaluated by: enrichment.completed event (BullMQ)
  Condition: contact.skipTraceStatus = 'no_match'
           AND contact.workflow_stage = 'ENRICHING'
  Note: Contact reverts to NEW. No phone found. May be re-enriched later.

READY → CONTACTED
  Trigger: communication event logged against this contact
  Evaluated by: communication.logged event (BullMQ)
  Condition: Event type IN ('call_attempt', 'sms_sent', 'email_sent')
           AND contact.workflow_stage = 'READY'

CONTACTED → FOLLOW_UP
  Trigger: 48h timer from first contact attempt with no inbound response
  Evaluated by: Scheduled BullMQ job (delayed job set at CONTACTED transition time)
  Condition: contact.workflow_stage = 'CONTACTED'
           AND no inbound communication event logged in past 48h
           AND attempt_count < N (configurable, default 5)

CONTACTED/FOLLOW_UP → DEAD (automatic — opt-out)
  Trigger: smsOptOut OR emailOptOut set to true
  Evaluated by: contact.updated event (BullMQ)
  Condition: contact.smsOptOut = true OR contact.emailOptOut = true
  Note: Fires from ANY stage. Takes precedence over all other transitions.

CONTACTED/FOLLOW_UP → DEAD (automatic — exhausted attempts)
  Trigger: N failed contact attempts logged with no response
  Evaluated by: communication.logged event (BullMQ)
  Condition: attempt_count >= N (configurable per sub_account, default 5)
           AND no inbound event logged
```

### Transition Priority

When multiple conditions could apply simultaneously, priority is:

1. DEAD via opt-out (highest — compliance)
2. DEAD via exhausted attempts
3. ENRICHING → READY or ENRICHING → NEW
4. READY → CONTACTED
5. CONTACTED → FOLLOW_UP (lowest — time-based)

---

## 4. Stage Transition Rules — Manual (Operator)

### Single Contact Override

Any operator with CRM write access can move any contact to any stage, including out of terminal states (`RETAINED`, `DEAD`). A `reason` field is **required** — the API will reject the request without it.

Valid operator overrides:

| From | To | Common Reason |
|------|----|---------------|
| Any | `DEAD` | "Bad number, not viable" / "Client declined" |
| `DEAD` | `NEW` | "Re-engaging on operator request" |
| `DEAD` | `READY` | "Phone confirmed via inbound call" |
| `CONTACTED` | `RETAINED` | "Verbal commitment received, case intake started" |
| `FOLLOW_UP` | `RETAINED` | "Client called back, signed agreement" |
| `NEW` | `READY` | "Phone confirmed externally, skip trace not needed" |
| Any | Any | "Manual correction — [specific reason]" |

### Bulk Stage Update

Operators can update up to **500 contacts** in a single request. Bulk updates:

- Use a single batch SQL `UPDATE` — no N+1 queries
- Log one `contact_workflow_events` row per contact in a bulk `INSERT`
- Are tagged with `trigger_type = 'bulk'` in the audit table
- Require `reason` — same as single-contact updates
- Are scoped to `sub_account_id` — cross-account bulk updates are rejected at the API layer

---

## 5. Schema Changes

### 5.1 ALTER contacts — Add workflow_stage

```sql
-- Migration: add_workflow_stage_to_contacts
-- Safe to run with zero downtime (DEFAULT is applied server-side for new rows;
-- existing rows are backfilled in the migration plan below)

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS workflow_stage TEXT NOT NULL DEFAULT 'NEW';

-- Constraint: only valid stage values
ALTER TABLE contacts
  ADD CONSTRAINT contacts_workflow_stage_check
  CHECK (workflow_stage IN ('NEW', 'ENRICHING', 'READY', 'CONTACTED', 'FOLLOW_UP', 'RETAINED', 'DEAD'));

-- Index: filter and sort by stage within a sub_account (the primary CRM query pattern)
CREATE INDEX IF NOT EXISTS idx_contacts_sub_account_workflow_stage
  ON contacts (sub_account_id, workflow_stage);

-- Index: sort by stage alone (for global admin views)
CREATE INDEX IF NOT EXISTS idx_contacts_workflow_stage
  ON contacts (workflow_stage);
```

### 5.2 ALTER contacts — Add view_class and export_eligible

```sql
-- view_class: UI rendering hint (future: controls which columns appear in table view)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS view_class TEXT;

-- export_eligible: auto-set by promotion engine; also manually overridable
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS export_eligible BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_contacts_export_eligible
  ON contacts (sub_account_id, export_eligible)
  WHERE export_eligible = TRUE;
```

### 5.3 CREATE contact_workflow_events — Audit Table

```sql
CREATE TABLE IF NOT EXISTS contact_workflow_events (
  id              SERIAL PRIMARY KEY,
  contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  sub_account_id  INTEGER NOT NULL,
  from_stage      TEXT,                         -- NULL on first transition (initial set)
  to_stage        TEXT NOT NULL,
  trigger_type    TEXT NOT NULL                 -- 'automatic' | 'manual' | 'bulk'
                  CHECK (trigger_type IN ('automatic', 'manual', 'bulk')),
  trigger_reason  TEXT,                         -- required for manual/bulk; populated by engine for automatic
  triggered_by    TEXT NOT NULL,                -- 'system' | user ID string
  trace_id        TEXT,                         -- links to BullMQ job or HTTP request trace
  metadata        JSONB,                        -- optional: attempt_count, job_id, etc.
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index: timeline query (contact detail view — most common read)
CREATE INDEX IF NOT EXISTS idx_cwe_contact_id
  ON contact_workflow_events (contact_id, created_at DESC);

-- Index: stage funnel query (how many contacts entered READY this week?)
CREATE INDEX IF NOT EXISTS idx_cwe_sub_account_to_stage
  ON contact_workflow_events (sub_account_id, to_stage, created_at DESC);

-- Index: operator activity log (who moved what, when?)
CREATE INDEX IF NOT EXISTS idx_cwe_triggered_by
  ON contact_workflow_events (sub_account_id, triggered_by, created_at DESC);

-- Index: trace lookup (correlate with Axiom / Sentry)
CREATE INDEX IF NOT EXISTS idx_cwe_trace_id
  ON contact_workflow_events (trace_id)
  WHERE trace_id IS NOT NULL;
```

### 5.4 Full Schema Diagram (4B additions)

```
contacts (existing + extended)
├── id
├── sub_account_id
├── identityStatus
├── skipTraceStatus
├── tags
├── phone
├── email
├── smsOptOut
├── emailOptOut
├── createdAt
├── [NEW] workflow_stage TEXT NOT NULL DEFAULT 'NEW'
├── [NEW] view_class TEXT
└── [NEW] export_eligible BOOLEAN NOT NULL DEFAULT FALSE

contact_workflow_events [NEW TABLE]
├── id (PK)
├── contact_id → contacts(id)
├── sub_account_id
├── from_stage
├── to_stage
├── trigger_type ('automatic' | 'manual' | 'bulk')
├── trigger_reason
├── triggered_by ('system' | userId)
├── trace_id
├── metadata (JSONB)
└── created_at
```

---

## 6. Auto-Promotion Engine (BullMQ)

### Queue: `apex-crm`

All workflow evaluation jobs are enqueued to the existing `apex-crm` BullMQ queue. No new queue is created. The engine is strictly event-driven — there is no polling loop.

### Job Type: `contact.workflow.evaluate`

```typescript
// Job data shape
interface WorkflowEvaluateJobData {
  contactId: number;
  subAccountId: number;
  triggerEvent: WorkflowTriggerEvent;
  traceId: string;
}

type WorkflowTriggerEvent =
  | 'enrichment.started'      // skipTraceStatus → pending | attempted
  | 'enrichment.completed'    // skipTraceStatus → matched | no_match
  | 'communication.logged'    // call/sms/email event written
  | 'contact.updated'         // smsOptOut or emailOptOut changed
  | 'timer.follow_up_check';  // 48h delayed job fires
```

### Trigger Points

| Upstream Event | Job Enqueued By | Job Type |
|----------------|-----------------|----------|
| Skip trace job starts | Enrichment service | `contact.workflow.evaluate` with `enrichment.started` |
| Skip trace job completes | Enrichment service | `contact.workflow.evaluate` with `enrichment.completed` |
| Call/SMS/email logged | Communication service | `contact.workflow.evaluate` with `communication.logged` |
| Contact opt-out updated | Contact update handler | `contact.workflow.evaluate` with `contact.updated` |
| CONTACTED transition fires | Promotion engine itself | Delayed `contact.workflow.evaluate` with `timer.follow_up_check` — 48h delay |

### Promotion Engine Logic (Pseudocode)

```typescript
async function processWorkflowEvaluateJob(job: Job<WorkflowEvaluateJobData>) {
  const { contactId, subAccountId, triggerEvent, traceId } = job.data;

  // Single SELECT — fetch only what is needed for evaluation
  const contact = await db.query<ContactForEvaluation>(
    `SELECT id, sub_account_id, workflow_stage, skip_trace_status,
            phone, sms_opt_out, email_opt_out
     FROM contacts
     WHERE id = $1 AND sub_account_id = $2`,
    [contactId, subAccountId]
  );

  if (!contact) return; // Contact deleted — discard

  const currentStage = contact.workflow_stage;
  const nextStage = resolveNextStage(contact, triggerEvent);

  if (!nextStage || nextStage === currentStage) return; // No transition

  await applyStageTransition({
    contact,
    fromStage: currentStage,
    toStage: nextStage,
    triggerType: 'automatic',
    triggerReason: triggerEvent,
    triggeredBy: 'system',
    traceId,
  });

  // If transitioning TO CONTACTED, schedule the 48h FOLLOW_UP check
  if (nextStage === 'CONTACTED') {
    await scheduleFollowUpCheck(contactId, subAccountId, traceId);
  }
}

async function applyStageTransition(params: StageTransitionParams): Promise<void> {
  // Batch: UPDATE contact + INSERT audit event in a single transaction
  await db.transaction(async (trx) => {
    await trx.query(
      `UPDATE contacts
       SET workflow_stage = $1,
           export_eligible = CASE
             WHEN $1 = 'READY' AND grade IN ('A', 'A+') THEN TRUE
             ELSE export_eligible
           END,
           updated_at = NOW()
       WHERE id = $2`,
      [params.toStage, params.contact.id]
    );

    await trx.query(
      `INSERT INTO contact_workflow_events
         (contact_id, sub_account_id, from_stage, to_stage,
          trigger_type, trigger_reason, triggered_by, trace_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        params.contact.id,
        params.contact.sub_account_id,
        params.fromStage,
        params.toStage,
        params.triggerType,
        params.triggerReason,
        params.triggeredBy,
        params.traceId,
      ]
    );
  });

  // Fire Axiom log AFTER transaction commits
  await logStageTransitionToAxiom(params);
}
```

### Delayed Job — 48h Follow-Up Timer

```typescript
async function scheduleFollowUpCheck(
  contactId: number,
  subAccountId: number,
  traceId: string
): Promise<void> {
  await apexCrmQueue.add(
    'contact.workflow.evaluate',
    {
      contactId,
      subAccountId,
      triggerEvent: 'timer.follow_up_check',
      traceId,
    },
    {
      delay: 48 * 60 * 60 * 1000, // 48 hours in milliseconds
      jobId: `follow_up_check:${contactId}`, // Deduplicated — only one timer per contact
      removeOnComplete: true,
      removeOnFail: false,
    }
  );
}
```

### Job Configuration

```typescript
const workerOptions: WorkerOptions = {
  concurrency: 20,
  limiter: {
    max: 100,
    duration: 1000, // 100 evaluations/sec max
  },
};
```

---

## 7. API Endpoints

### 7.1 Single Stage Update

```
PATCH /api/contacts/:id/stage
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**

```typescript
interface PatchContactStageBody {
  stage: WorkflowStage;      // Required: target stage
  reason: string;            // Required: min 5 chars, max 500 chars
}
```

**Response — 200 OK:**

```typescript
interface PatchContactStageResponse {
  contactId: number;
  fromStage: WorkflowStage;
  toStage: WorkflowStage;
  eventId: number;           // ID of the contact_workflow_events row
  updatedAt: string;         // ISO 8601
}
```

**Error Responses:**

| Status | Code | Reason |
|--------|------|--------|
| `400` | `MISSING_REASON` | `reason` not provided or fewer than 5 characters |
| `400` | `INVALID_STAGE` | `stage` is not a valid WorkflowStage value |
| `403` | `FORBIDDEN` | Contact belongs to a different sub_account |
| `404` | `NOT_FOUND` | Contact ID does not exist |

**Implementation notes:**

- Operator identity is taken from the JWT (`req.user.id`) and written to `triggered_by`
- `trigger_type` is always `'manual'` for this endpoint
- No BullMQ job is enqueued — this is a synchronous write
- The 48h delayed timer for CONTACTED is NOT set by this endpoint — only by the auto-promotion engine

---

### 7.2 Bulk Stage Update

```
POST /api/contacts/bulk-stage
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**

```typescript
interface BulkStageUpdateBody {
  contactIds: number[];       // Required: 1–500 IDs
  stage: WorkflowStage;       // Required: target stage
  reason: string;             // Required: min 5 chars, max 500 chars
}
```

**Response — 200 OK:**

```typescript
interface BulkStageUpdateResponse {
  updated: number;            // Number of contacts actually updated
  skipped: number;            // Contacts already in target stage (no-op)
  failed: number;             // Contacts not found or access denied
  eventIds: number[];         // IDs of inserted contact_workflow_events rows
}
```

**Error Responses:**

| Status | Code | Reason |
|--------|------|--------|
| `400` | `MISSING_REASON` | `reason` not provided |
| `400` | `INVALID_STAGE` | `stage` value not recognized |
| `400` | `TOO_MANY_CONTACTS` | `contactIds` length exceeds 500 |
| `400` | `EMPTY_CONTACTS` | `contactIds` is empty |
| `403` | `FORBIDDEN` | One or more contactIds belong to a different sub_account |

**Implementation — Batch SQL (no N+1):**

```typescript
async function bulkUpdateStage(
  contactIds: number[],
  toStage: WorkflowStage,
  reason: string,
  operatorId: string,
  subAccountId: number,
  traceId: string
): Promise<BulkStageUpdateResponse> {
  return db.transaction(async (trx) => {
    // Step 1: Fetch current stages for all contacts in one query
    const current = await trx.query<{ id: number; workflow_stage: string }>(
      `SELECT id, workflow_stage
       FROM contacts
       WHERE id = ANY($1::int[])
         AND sub_account_id = $2`,
      [contactIds, subAccountId]
    );

    const toUpdate = current.rows.filter(c => c.workflow_stage !== toStage);
    const skipped = current.rows.length - toUpdate.length;
    const failed = contactIds.length - current.rows.length;

    if (toUpdate.length === 0) {
      return { updated: 0, skipped, failed, eventIds: [] };
    }

    const ids = toUpdate.map(c => c.id);

    // Step 2: Batch UPDATE contacts
    await trx.query(
      `UPDATE contacts
       SET workflow_stage = $1,
           updated_at = NOW()
       WHERE id = ANY($2::int[])
         AND sub_account_id = $3`,
      [toStage, ids, subAccountId]
    );

    // Step 3: Batch INSERT audit events
    // Build VALUES rows for unnest pattern
    const eventRows = toUpdate.map(c => ({
      contactId: c.id,
      fromStage: c.workflow_stage,
    }));

    const result = await trx.query<{ id: number }>(
      `INSERT INTO contact_workflow_events
         (contact_id, sub_account_id, from_stage, to_stage,
          trigger_type, trigger_reason, triggered_by, trace_id, created_at)
       SELECT
         unnest($1::int[]),
         $2,
         unnest($3::text[]),
         $4,
         'bulk',
         $5,
         $6,
         $7,
         NOW()
       RETURNING id`,
      [
        eventRows.map(r => r.contactId),
        subAccountId,
        eventRows.map(r => r.fromStage),
        toStage,
        reason,
        operatorId,
        traceId,
      ]
    );

    return {
      updated: toUpdate.length,
      skipped,
      failed,
      eventIds: result.rows.map(r => r.id),
    };
  });
}
```

---

### 7.3 Contact Timeline

```
GET /api/contacts/:id/timeline
Authorization: Bearer <token>
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | `50` | Max events to return |
| `before` | ISO 8601 string | none | Cursor for pagination |

**Response — 200 OK:**

```typescript
interface ContactTimelineResponse {
  contactId: number;
  events: ContactWorkflowEvent[];
  hasMore: boolean;
  nextCursor: string | null;   // ISO 8601 timestamp of oldest returned event
}

interface ContactWorkflowEvent {
  id: number;
  fromStage: WorkflowStage | null;
  toStage: WorkflowStage;
  triggerType: 'automatic' | 'manual' | 'bulk';
  triggerReason: string | null;
  triggeredBy: string;         // 'system' or user display name (resolved server-side)
  traceId: string | null;
  createdAt: string;           // ISO 8601
}
```

**Implementation — Single indexed query:**

```sql
SELECT
  cwe.id,
  cwe.from_stage,
  cwe.to_stage,
  cwe.trigger_type,
  cwe.trigger_reason,
  cwe.triggered_by,
  cwe.trace_id,
  cwe.created_at
FROM contact_workflow_events cwe
WHERE cwe.contact_id = $1
  AND cwe.sub_account_id = $2
  AND ($3::timestamptz IS NULL OR cwe.created_at < $3)
ORDER BY cwe.created_at DESC
LIMIT $4;
```

---

## 8. CRM Workflow Column — UI Spec

### Stage Badge

Each stage renders as a pill/badge in the contacts table. Colors match the color reference in Section 2.

```typescript
const STAGE_BADGE_CONFIG: Record<WorkflowStage, { label: string; hex: string; textHex: string }> = {
  NEW:        { label: 'New',        hex: '#6B7280', textHex: '#FFFFFF' },
  ENRICHING:  { label: 'Enriching', hex: '#3B82F6', textHex: '#FFFFFF' },
  READY:      { label: 'Ready',      hex: '#10B981', textHex: '#FFFFFF' },
  CONTACTED:  { label: 'Contacted', hex: '#F59E0B', textHex: '#1F2937' },
  FOLLOW_UP:  { label: 'Follow Up', hex: '#F97316', textHex: '#FFFFFF' },
  RETAINED:   { label: 'Retained',  hex: '#8B5CF6', textHex: '#FFFFFF' },
  DEAD:       { label: 'Dead',       hex: '#EF4444', textHex: '#FFFFFF' },
};
```

### Column Behaviors

| Behavior | Implementation |
|----------|----------------|
| **Sortable** | `ORDER BY workflow_stage ASC/DESC` (lexicographic; rendered order matches visual priority via client-side sort key mapping) |
| **Filterable** | Multi-select dropdown; sends `?stage[]=READY&stage[]=CONTACTED` to API; server uses `WHERE workflow_stage = ANY($1::text[])` |
| **Inline edit** | Single-click on badge opens stage picker; submits to `PATCH /api/contacts/:id/stage`; reason dialog required before submission |
| **Bulk edit** | Checkbox-select rows; "Change Stage" bulk action button; reason required; submits to `POST /api/contacts/bulk-stage` |

### Stage Sort Key (for meaningful visual ordering)

To sort by lifecycle position rather than alphabetically:

```typescript
const STAGE_SORT_ORDER: Record<WorkflowStage, number> = {
  NEW:       0,
  ENRICHING: 1,
  READY:     2,
  CONTACTED: 3,
  FOLLOW_UP: 4,
  RETAINED:  5,
  DEAD:      6,
};
```

Client maps stage to sort key before sorting; this preserves the natural lifecycle order in ascending sort.

### Quick Filter: "Ready For Dialing"

A pre-built filter preset available in the CRM filter bar. Applies:

```sql
WHERE workflow_stage = 'READY'
  AND phone IS NOT NULL
  AND sms_opt_out IS NOT TRUE
  AND sub_account_id = $1
```

Exposed in the UI as a single-click filter button labeled **"Ready For Dialing"**. Count badge shows how many contacts match in real time (debounced, 300ms).

### Contact Detail View — Timeline Panel

The contact detail page gains a **Lifecycle Timeline** panel below the contact information card. It renders `GET /api/contacts/:id/timeline` as a vertical event list:

```
● READY          2026-05-15  11:42 AM          [system — automatic]
  "enrichment.completed: skip trace matched"
─────────────────────────────────────────────
● ENRICHING      2026-05-15  11:38 AM          [system — automatic]
  "enrichment.started"
─────────────────────────────────────────────
● NEW            2026-05-15  11:37 AM          [system — automatic]
  Initial ingestion
```

For manual/bulk transitions, `triggered_by` resolves to the operator's display name and the reason is shown below the stage label.

---

## 9. Observability

### Axiom — Stage Transition Log

Every stage transition (automatic, manual, or bulk) logs a structured event to Axiom **after** the database transaction commits. Bulk updates log one event per contact — not one event for the batch.

**Dataset:** `apex-crm-events`

**Event schema:**

```typescript
interface AxiomWorkflowEvent {
  _time: string;             // ISO 8601 — Axiom timestamp field
  event: 'contact.stage.transition';
  contactId: number;
  subAccountId: number;
  fromStage: string | null;
  toStage: string;
  triggerType: 'automatic' | 'manual' | 'bulk';
  triggerEvent?: string;     // e.g. 'enrichment.completed' (automatic only)
  reason?: string;           // manual/bulk only
  triggeredBy: string;       // 'system' or userId
  traceId: string;
  durationMs?: number;       // time from trigger to transition commit
}
```

**Axiom log call:**

```typescript
async function logStageTransitionToAxiom(params: StageTransitionParams): Promise<void> {
  await axiom.ingest('apex-crm-events', [{
    _time: new Date().toISOString(),
    event: 'contact.stage.transition',
    contactId: params.contact.id,
    subAccountId: params.contact.sub_account_id,
    fromStage: params.fromStage ?? null,
    toStage: params.toStage,
    triggerType: params.triggerType,
    triggerEvent: params.triggerReason,
    triggeredBy: params.triggeredBy,
    traceId: params.traceId,
  }]);
}
```

### Sentry — Error Boundaries

| Failure Point | Sentry Handling |
|---------------|-----------------|
| `contact.workflow.evaluate` job throws | BullMQ retries (3x, exponential backoff); on exhaustion, Sentry issue with job data attached |
| `applyStageTransition` transaction fails | Sentry exception with `contactId`, `fromStage`, `toStage`, `traceId` as extra context |
| Axiom log call fails | Log to stderr + Sentry warning; does NOT roll back the DB transaction |
| Bulk update partial failure | Full transaction rollback; Sentry error with `contactIds`, `subAccountId` |

### Metrics to Monitor

| Metric | Query (Axiom) | Alert Threshold |
|--------|---------------|-----------------|
| ENRICHING → READY conversion rate | `count(toStage='READY') / count(fromStage='ENRICHING')` | < 40% over 24h |
| CONTACTED with no follow-up promotion | `count(fromStage='CONTACTED') AND toStage NOT IN ('FOLLOW_UP','RETAINED','DEAD')` after 50h | > 0 |
| Bulk update size | `max(batchSize)` | > 400 (approaching limit) |
| Time in ENRICHING | `avg(durationMs) WHERE toStage='READY'` | > 10 minutes (skip trace SLA) |

---

## 10. Export Eligibility Auto-Set

`export_eligible` is set to `TRUE` automatically when both conditions are met:

```
workflow_stage = 'READY'
AND grade IN ('A', 'A+')
```

This evaluation happens inside the `applyStageTransition` function as part of the same transaction that updates `workflow_stage`. It is not a separate job.

```sql
-- Applied inside applyStageTransition when toStage = 'READY'
UPDATE contacts
SET workflow_stage = 'READY',
    export_eligible = CASE
      WHEN grade IN ('A', 'A+') THEN TRUE
      ELSE export_eligible   -- preserve existing value if grade doesn't qualify
    END,
    updated_at = NOW()
WHERE id = $1;
```

**Clearing `export_eligible`:**

- When a contact transitions OUT of `READY` (to CONTACTED, DEAD, etc.), `export_eligible` is NOT automatically cleared — a contact that has already been exported should retain this flag
- Manual clearing is available via the contact edit panel
- Operators can bulk-clear via direct contact attribute update (not through the stage API)

**UI indicator:**

- Contacts with `export_eligible = TRUE` show a small export icon next to the stage badge in the CRM table
- The "Ready For Dialing" quick filter includes an "Export Eligible" sub-filter option

---

## 11. Migration Plan

### Step 1 — Schema Migrations (zero-downtime)

Run in order. Each migration is idempotent.

```sql
-- Migration 001: Add workflow_stage to contacts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS workflow_stage TEXT NOT NULL DEFAULT 'NEW';

ALTER TABLE contacts
  ADD CONSTRAINT IF NOT EXISTS contacts_workflow_stage_check
  CHECK (workflow_stage IN ('NEW', 'ENRICHING', 'READY', 'CONTACTED', 'FOLLOW_UP', 'RETAINED', 'DEAD'));

-- Migration 002: Add view_class and export_eligible
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS view_class TEXT;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS export_eligible BOOLEAN NOT NULL DEFAULT FALSE;

-- Migration 003: Create contact_workflow_events
CREATE TABLE IF NOT EXISTS contact_workflow_events (
  id              SERIAL PRIMARY KEY,
  contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  sub_account_id  INTEGER NOT NULL,
  from_stage      TEXT,
  to_stage        TEXT NOT NULL,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN ('automatic', 'manual', 'bulk')),
  trigger_reason  TEXT,
  triggered_by    TEXT NOT NULL,
  trace_id        TEXT,
  metadata        JSONB,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Migration 004: Indexes
CREATE INDEX IF NOT EXISTS idx_contacts_sub_account_workflow_stage
  ON contacts (sub_account_id, workflow_stage);

CREATE INDEX IF NOT EXISTS idx_contacts_workflow_stage
  ON contacts (workflow_stage);

CREATE INDEX IF NOT EXISTS idx_contacts_export_eligible
  ON contacts (sub_account_id, export_eligible)
  WHERE export_eligible = TRUE;

CREATE INDEX IF NOT EXISTS idx_cwe_contact_id
  ON contact_workflow_events (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cwe_sub_account_to_stage
  ON contact_workflow_events (sub_account_id, to_stage, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cwe_triggered_by
  ON contact_workflow_events (sub_account_id, triggered_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cwe_trace_id
  ON contact_workflow_events (trace_id)
  WHERE trace_id IS NOT NULL;
```

### Step 2 — Backfill Existing Contacts

All existing contacts default to `workflow_stage = 'NEW'` via the column default. No data migration is required for stage assignment.

However, a backfill job should be enqueued after migration to evaluate all contacts that already have a non-NEW status implied by their existing fields:

```sql
-- Identify contacts that should already be in ENRICHING (skip trace in progress)
-- These will be re-evaluated by the promotion engine
SELECT id FROM contacts
WHERE skip_trace_status IN ('pending', 'attempted')
  AND workflow_stage = 'NEW';

-- Identify contacts that should already be READY
SELECT id FROM contacts
WHERE skip_trace_status = 'matched'
  AND phone IS NOT NULL
  AND sms_opt_out IS NOT TRUE
  AND workflow_stage = 'NEW';
```

For each result set, enqueue `contact.workflow.evaluate` jobs with `triggerEvent = 'enrichment.completed'` (for matched) or `triggerEvent = 'enrichment.started'` (for in-progress). This promotes them to correct stages without special-casing migration logic.

**Backfill volume estimate:**

- Run in batches of 100 contacts
- 100ms delay between batches to avoid saturating the BullMQ queue
- Monitor via BullMQ dashboard; expect completion within minutes for typical list sizes

### Step 3 — Verification

After backfill completes, verify distribution looks reasonable:

```sql
SELECT
  workflow_stage,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as pct
FROM contacts
GROUP BY workflow_stage
ORDER BY
  CASE workflow_stage
    WHEN 'NEW'       THEN 0
    WHEN 'ENRICHING' THEN 1
    WHEN 'READY'     THEN 2
    WHEN 'CONTACTED' THEN 3
    WHEN 'FOLLOW_UP' THEN 4
    WHEN 'RETAINED'  THEN 5
    WHEN 'DEAD'      THEN 6
  END;
```

Expected: most existing contacts land in `NEW` or `READY`. Contacts in ENRICHING should be a small active cohort matching current skip trace jobs in flight.

---

## 12. TypeScript Types

```typescript
// WorkflowStage — canonical union type
export type WorkflowStage =
  | 'NEW'
  | 'ENRICHING'
  | 'READY'
  | 'CONTACTED'
  | 'FOLLOW_UP'
  | 'RETAINED'
  | 'DEAD';

// All valid stage values (use for validation)
export const WORKFLOW_STAGES: WorkflowStage[] = [
  'NEW', 'ENRICHING', 'READY', 'CONTACTED', 'FOLLOW_UP', 'RETAINED', 'DEAD',
];

// Terminal stages — automatic promotion does not move out of these
export const TERMINAL_STAGES: WorkflowStage[] = ['RETAINED', 'DEAD'];

// TriggerType
export type TriggerType = 'automatic' | 'manual' | 'bulk';

// WorkflowTriggerEvent — event names that initiate evaluation
export type WorkflowTriggerEvent =
  | 'enrichment.started'
  | 'enrichment.completed'
  | 'communication.logged'
  | 'contact.updated'
  | 'timer.follow_up_check';

// Contact — 4B extended shape
export interface Contact {
  id: number;
  subAccountId: number;
  identityStatus: string | null;
  skipTraceStatus: string | null;
  tags: string[];
  phone: string | null;
  email: string | null;
  smsOptOut: boolean;
  emailOptOut: boolean;
  createdAt: Date;
  // Phase 4B additions
  workflowStage: WorkflowStage;
  viewClass: string | null;
  exportEligible: boolean;
}

// ContactWorkflowEvent — audit row shape
export interface ContactWorkflowEvent {
  id: number;
  contactId: number;
  subAccountId: number;
  fromStage: WorkflowStage | null;
  toStage: WorkflowStage;
  triggerType: TriggerType;
  triggerReason: string | null;
  triggeredBy: string;
  traceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

// API request/response types
export interface PatchContactStageBody {
  stage: WorkflowStage;
  reason: string;
}

export interface PatchContactStageResponse {
  contactId: number;
  fromStage: WorkflowStage;
  toStage: WorkflowStage;
  eventId: number;
  updatedAt: string;
}

export interface BulkStageUpdateBody {
  contactIds: number[];
  stage: WorkflowStage;
  reason: string;
}

export interface BulkStageUpdateResponse {
  updated: number;
  skipped: number;
  failed: number;
  eventIds: number[];
}

export interface ContactTimelineResponse {
  contactId: number;
  events: ContactWorkflowEvent[];
  hasMore: boolean;
  nextCursor: string | null;
}

// BullMQ job data
export interface WorkflowEvaluateJobData {
  contactId: number;
  subAccountId: number;
  triggerEvent: WorkflowTriggerEvent;
  traceId: string;
}

// Internal — used by applyStageTransition
export interface StageTransitionParams {
  contact: Pick<Contact, 'id' | 'subAccountId'>;
  fromStage: WorkflowStage | null;
  toStage: WorkflowStage;
  triggerType: TriggerType;
  triggerReason: string | null;
  triggeredBy: string;
  traceId: string;
}

// UI badge config
export interface StageBadgeConfig {
  label: string;
  hex: string;
  textHex: string;
}

export const STAGE_BADGE_CONFIG: Record<WorkflowStage, StageBadgeConfig> = {
  NEW:        { label: 'New',        hex: '#6B7280', textHex: '#FFFFFF' },
  ENRICHING:  { label: 'Enriching', hex: '#3B82F6', textHex: '#FFFFFF' },
  READY:      { label: 'Ready',      hex: '#10B981', textHex: '#FFFFFF' },
  CONTACTED:  { label: 'Contacted', hex: '#F59E0B', textHex: '#1F2937' },
  FOLLOW_UP:  { label: 'Follow Up', hex: '#F97316', textHex: '#FFFFFF' },
  RETAINED:   { label: 'Retained',  hex: '#8B5CF6', textHex: '#FFFFFF' },
  DEAD:       { label: 'Dead',       hex: '#EF4444', textHex: '#FFFFFF' },
};

export const STAGE_SORT_ORDER: Record<WorkflowStage, number> = {
  NEW:       0,
  ENRICHING: 1,
  READY:     2,
  CONTACTED: 3,
  FOLLOW_UP: 4,
  RETAINED:  5,
  DEAD:      6,
};
```

---

## Implementation Checklist

### Database (run first, before any code ships)

- [ ] Migration 001: `ALTER TABLE contacts ADD COLUMN workflow_stage`
- [ ] Migration 002: `ALTER TABLE contacts ADD COLUMN view_class, export_eligible`
- [ ] Migration 003: `CREATE TABLE contact_workflow_events`
- [ ] Migration 004: All indexes on both tables
- [ ] Verify constraint and default are active
- [ ] Run distribution query (Step 3) to confirm baseline

### BullMQ / Backend

- [ ] Register `contact.workflow.evaluate` job type in `apex-crm` worker
- [ ] Implement `resolveNextStage()` with full transition matrix
- [ ] Implement `applyStageTransition()` with transaction + Axiom log
- [ ] Implement `scheduleFollowUpCheck()` with 48h delay and dedup `jobId`
- [ ] Wire `enrichment.started` event → enqueue evaluate job
- [ ] Wire `enrichment.completed` event → enqueue evaluate job
- [ ] Wire `communication.logged` event → enqueue evaluate job
- [ ] Wire `contact.updated` (opt-out fields) → enqueue evaluate job

### API

- [ ] `PATCH /api/contacts/:id/stage` — validation, auth, DB write, response
- [ ] `POST /api/contacts/bulk-stage` — validation, batch SQL, bulk audit insert
- [ ] `GET /api/contacts/:id/timeline` — pagination cursor, sub_account guard

### Frontend

- [ ] Stage badge component with color config
- [ ] Stage column in contacts table (sortable, filterable)
- [ ] Multi-select stage filter in filter bar
- [ ] "Ready For Dialing" quick filter preset
- [ ] Inline stage picker with reason dialog (single contact)
- [ ] Bulk stage update flow (checkbox select → Change Stage → reason modal)
- [ ] Lifecycle Timeline panel in contact detail view

### Backfill

- [ ] Enqueue evaluation jobs for contacts with `skip_trace_status = 'matched'` and phone present
- [ ] Enqueue evaluation jobs for contacts with `skip_trace_status IN ('pending', 'attempted')`
- [ ] Monitor BullMQ queue until drained
- [ ] Run distribution verification query

### Observability

- [ ] Confirm Axiom dataset `apex-crm-events` exists
- [ ] Verify stage transition events appear in Axiom after first production transition
- [ ] Set up Axiom alert for ENRICHING → READY conversion rate below 40%
- [ ] Verify Sentry captures BullMQ job failures with full context

---

*Document version: 4B.1 | Generated: 2026-05-15 | Apex Marketing OS*
