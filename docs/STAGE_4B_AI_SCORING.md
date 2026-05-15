# Stage 4B — AI Contact Scoring Layer

**Status:** Architecture  
**Phase:** 4B (follows 4A Durable Operations)  
**Date:** 2026-05-15  
**Author:** Apex Systems Architecture  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Grade System](#2-grade-system)
3. [Scoring Factors and Weights](#3-scoring-factors-and-weights)
4. [Database Schema](#4-database-schema)
5. [BullMQ Job Design](#5-bullmq-job-design)
6. [Redis Cache Strategy](#6-redis-cache-strategy)
7. [Batch Scoring](#7-batch-scoring)
8. [API Surface](#8-api-surface)
9. [Drizzle Schema Definition](#9-drizzle-schema-definition)
10. [Observability](#10-observability)
11. [Rollout Order](#11-rollout-order)

---

## 1. Executive Summary

Stage 4B introduces a deterministic, async AI scoring layer that assigns every contact a numeric quality score (0–100) and a letter grade (D through A+). Scores drive prioritization in outreach workflows, agent call queues, and operator-level reporting.

Scoring is intentionally **not real-time**. All computation happens asynchronously via the existing `apex-scoring` BullMQ queue, results are written to a dedicated `contact_ai_profiles` table, and the computed score is cached in Upstash Redis for 4 hours. This design eliminates N+1 query patterns, avoids hot-path latency, and keeps scoring throughput decoupled from API request cycles.

pgvector is active on the platform but **semantic scoring is deferred** to a later phase. This phase is purely factor-based: eight weighted signals drawn from fields already present in the `contacts` table, with no embedding lookups.

### Design Constraints

| Constraint | Decision |
|---|---|
| No real-time scoring loops | Scores computed async; reads always served from cache or DB |
| No full vector scans | pgvector not queried this phase |
| No N+1 queries | Batch jobs use `WHERE contact_id = ANY($1)` with array params |
| Scoring queue | `apex-scoring` (MEDIUM priority, existing BullMQ queue) |
| Cache backend | Upstash Redis — key `apex:score:{contactId}`, TTL 4h |
| Concurrency | 10 simultaneous scoring workers |
| New table | `contact_ai_profiles` — one row per contact |

---

## 2. Grade System

Grades map numeric score ranges to actionable priority tiers. Agents and workflows consume the `letter_grade` field directly; numeric precision is available for sorting and reporting.

| Grade | Score Range | Qualifying Conditions | Priority Tier |
|---|---|---|---|
| **A+** | 90–100 | verified identity + phone present + email present + enriched (confidence ≥ 0.8) + high severity + created within 7 days + territory match | URGENT — immediate outreach |
| **A** | 80–89 | verified identity + phone present + enriched (confidence ≥ 0.5) + created within 30 days | HIGH — route to top of queue |
| **B** | 65–79 | phone or email present + partial enrichment (any enrichmentConfidence) | NORMAL — standard workflow |
| **C** | 45–64 | address present + skip trace attempted (status: `attempted`, `no_match`, or `matched`) | LOW — follow-up batch |
| **D** | 0–44 | signal only, no contact info, or stale (created > 90 days ago with no activity) | HOLD — archive candidate |

### Grade Promotion Rules

A contact moves up a grade tier only when **all** qualifying conditions for that tier are satisfied. A single failing condition (e.g., no phone) caps the score below the threshold regardless of other factor points. This prevents inflated scores from partially matched contacts.

---

## 3. Scoring Factors and Weights

All eight factors sum to **100 points maximum**. Factor scores are floored at 0 and capped at their stated maximum.

### Factor Definitions

| Factor | Field(s) | Max Points | Scoring Logic |
|---|---|---|---|
| `phone_present` | `contacts.phone` | 20 | 20 if non-null and non-empty; 0 otherwise |
| `email_present` | `contacts.email` | 10 | 10 if non-null and non-empty; 0 otherwise |
| `enrichment_quality` | `contacts.enrichmentConfidence` | 15 | `Math.round((enrichmentConfidence ?? 0) * 15)` |
| `identity_status` | `contacts.identityStatus` | 15 | verified=15, placeholder=5, unidentified=0 |
| `recency` | `contacts.createdAt` | 15 | Linear decay over 30 days — see formula below |
| `severity` | lead severity (see note) | 10 | high=10, medium=5, low=2, absent=0 |
| `source_confidence` | `contacts.rawSourceType` | 10 | See source confidence table below |
| `workflow_engagement` | deals, appointments, messages | 5 | 5 if any engagement record exists; 0 otherwise |

**Total:** 20 + 10 + 15 + 15 + 15 + 10 + 10 + 5 = **100**

### Recency Decay Formula

```
ageInDays = (now - contact.createdAt) / 86_400_000
recencyScore = ageInDays >= 30
  ? 0
  : Math.round(15 * (1 - ageInDays / 30))
```

A contact created today scores 15. A contact created 15 days ago scores approximately 7–8. A contact created 30 or more days ago scores 0 on this factor.

### Severity Field Note

The `contacts` table does not carry a `severity` column directly. Severity is resolved from the linked source record (e.g., `property_leads.severity` for crash leads, `hs_signals.severity` for homestead signals). The scoring worker performs a single JOIN or sub-select per contact to resolve severity. If no severity source is found, the factor contributes 0.

### Source Confidence Table

| `rawSourceType` value | Points |
|---|---|
| `flhsmv_hsmv_cad` | 10 |
| `crash_connect_webhook` | 10 |
| `hs_signal_*` (any homestead signal variant) | 8 |
| `facebook_lead_ad` | 7 |
| `google_lead_form` | 7 |
| `manual` | 4 |
| `api_import` | 4 |
| `null` / unknown | 0 |

### TypeScript Interfaces

```typescript
// server/scoring/types.ts

export interface ScoringInput {
  contactId: number;
  subAccountId: number;
  phone: string | null;
  email: string | null;
  enrichmentConfidence: number | null;
  identityStatus: "unidentified" | "placeholder" | "verified";
  createdAt: Date;
  rawSourceType: string | null;
  resolvedSeverity: "high" | "medium" | "low" | null;
  hasWorkflowEngagement: boolean;
}

export interface FactorBreakdown {
  phone_present: number;         // 0–20
  email_present: number;         // 0–10
  enrichment_quality: number;    // 0–15
  identity_status: number;       // 0–15
  recency: number;               // 0–15
  severity: number;              // 0–10
  source_confidence: number;     // 0–10
  workflow_engagement: number;   // 0–5
}

export interface GradeExplanation {
  topFactors: string[];          // e.g. ["verified identity", "phone present"]
  limitingFactors: string[];     // e.g. ["no email", "stale (42 days)"]
  gradeBoundary: string;         // e.g. "A (80-89)"
}

export interface ScoringResult {
  contactId: number;
  subAccountId: number;
  numericScore: number;          // 0–100, rounded to 1 decimal
  letterGrade: "A+" | "A" | "B" | "C" | "D";
  factorBreakdown: FactorBreakdown;
  gradeExplanation: GradeExplanation;
  scoredAt: Date;
  scoreVersion: number;          // bumped when scoring algorithm changes
}
```

### Scoring Algorithm (Reference Implementation)

```typescript
// server/scoring/scoreContact.ts

import type { ScoringInput, FactorBreakdown, ScoringResult, GradeExplanation } from "./types";

const SCORE_VERSION = 1;

const SOURCE_CONFIDENCE_MAP: Record<string, number> = {
  flhsmv_hsmv_cad:        10,
  crash_connect_webhook:  10,
  facebook_lead_ad:        7,
  google_lead_form:        7,
  manual:                  4,
  api_import:              4,
};

function resolveSourceConfidence(rawSourceType: string | null): number {
  if (!rawSourceType) return 0;
  if (rawSourceType.startsWith("hs_signal")) return 8;
  return SOURCE_CONFIDENCE_MAP[rawSourceType] ?? 0;
}

function resolveRecency(createdAt: Date): number {
  const ageInDays = (Date.now() - createdAt.getTime()) / 86_400_000;
  if (ageInDays >= 30) return 0;
  return Math.round(15 * (1 - ageInDays / 30));
}

function resolveIdentityStatus(status: ScoringInput["identityStatus"]): number {
  if (status === "verified")     return 15;
  if (status === "placeholder")  return 5;
  return 0;
}

function resolveSeverity(severity: ScoringInput["resolvedSeverity"]): number {
  if (severity === "high")   return 10;
  if (severity === "medium") return 5;
  if (severity === "low")    return 2;
  return 0;
}

function resolveLetterGrade(score: number): ScoringResult["letterGrade"] {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 45) return "C";
  return "D";
}

export function scoreContact(input: ScoringInput): ScoringResult {
  const breakdown: FactorBreakdown = {
    phone_present:      input.phone  ? 20 : 0,
    email_present:      input.email  ? 10 : 0,
    enrichment_quality: Math.round((input.enrichmentConfidence ?? 0) * 15),
    identity_status:    resolveIdentityStatus(input.identityStatus),
    recency:            resolveRecency(input.createdAt),
    severity:           resolveSeverity(input.resolvedSeverity),
    source_confidence:  resolveSourceConfidence(input.rawSourceType),
    workflow_engagement: input.hasWorkflowEngagement ? 5 : 0,
  };

  const numericScore = Math.min(
    100,
    Object.values(breakdown).reduce((sum, v) => sum + v, 0)
  );

  const letterGrade = resolveLetterGrade(numericScore);

  const topFactors: string[] = [];
  const limitingFactors: string[] = [];

  if (breakdown.phone_present === 20)   topFactors.push("phone present");
  else                                   limitingFactors.push("no phone (−20)");
  if (breakdown.email_present === 10)   topFactors.push("email present");
  else                                   limitingFactors.push("no email (−10)");
  if (breakdown.identity_status === 15) topFactors.push("verified identity");
  if (breakdown.identity_status === 0)  limitingFactors.push("unidentified (−15)");
  if (breakdown.recency === 0)          limitingFactors.push("stale contact (−15)");
  if (breakdown.severity === 10)        topFactors.push("high severity");
  if (breakdown.severity === 0)         limitingFactors.push("no severity signal (−10)");

  const gradeExplanation: GradeExplanation = {
    topFactors,
    limitingFactors,
    gradeBoundary: `${letterGrade} (${
      letterGrade === "A+" ? "90-100" :
      letterGrade === "A"  ? "80-89"  :
      letterGrade === "B"  ? "65-79"  :
      letterGrade === "C"  ? "45-64"  : "0-44"
    })`,
  };

  return {
    contactId:       input.contactId,
    subAccountId:    input.subAccountId,
    numericScore:    Math.round(numericScore * 10) / 10,
    letterGrade,
    factorBreakdown: breakdown,
    gradeExplanation,
    scoredAt:        new Date(),
    scoreVersion:    SCORE_VERSION,
  };
}
```

---

## 4. Database Schema

### `contact_ai_profiles` Table

```sql
-- Migration: add_contact_ai_profiles
-- Run after: contact lifecycle fields migration (Phase 5 / 2026-05-14)

CREATE TABLE contact_ai_profiles (
  id                serial        PRIMARY KEY,
  contact_id        integer       NOT NULL UNIQUE
                                  REFERENCES contacts(id) ON DELETE CASCADE,
  sub_account_id    integer       NOT NULL,
  numeric_score     real          NOT NULL DEFAULT 0,
  letter_grade      text          NOT NULL DEFAULT 'D',
  grade_explanation jsonb,
  factor_breakdown  jsonb,
  scored_at         timestamp     NOT NULL DEFAULT now(),
  score_version     integer       NOT NULL DEFAULT 1
);

-- Index: operator dashboard queries filter and sort by grade within account
CREATE INDEX idx_cap_sub_grade
  ON contact_ai_profiles (sub_account_id, letter_grade);

-- Index: sort contacts by score descending within account
CREATE INDEX idx_cap_sub_score_desc
  ON contact_ai_profiles (sub_account_id, numeric_score DESC);

-- Comments for documentation
COMMENT ON TABLE contact_ai_profiles IS
  'Async-computed AI quality scores for contacts. One row per contact. '
  'Written by apex-scoring BullMQ workers. Served via Redis cache (TTL 4h).';
COMMENT ON COLUMN contact_ai_profiles.score_version IS
  'Incremented when scoring algorithm changes. Enables targeted re-scoring.';
COMMENT ON COLUMN contact_ai_profiles.factor_breakdown IS
  'JSON map of factor name -> points awarded. Used for score explanation UI.';
```

### Retention Policy

`contact_ai_profiles` rows are hard-deleted when the parent contact is deleted (ON DELETE CASCADE). There is no soft-delete or archival — stale scores are simply overwritten by the next scoring run.

---

## 5. BullMQ Job Design

### Queue Configuration

| Setting | Value |
|---|---|
| Queue name | `apex-scoring` |
| Priority tier | MEDIUM |
| Worker concurrency | 10 |
| Retry attempts | 3 |
| Backoff | Exponential, 5s initial delay |
| Remove on complete | Last 200 |
| Remove on fail | Last 1,000 |

These settings are already defined in `server/queues/queueFactory.ts` under `MEDIUM_PRIORITY_DEFAULTS`. No changes to the queue factory are required for Phase 4B.

### Job Payload Type

```typescript
// server/scoring/scoringJob.ts

export type ScoringTrigger =
  | "enrichment_complete"
  | "workflow_stage_change"
  | "daily_batch"
  | "manual";

export interface ContactScoreJobPayload {
  type: "contact.score";
  contactId: number;
  subAccountId: number;
  trigger: ScoringTrigger;
  triggeredAt: string;   // ISO-8601
  batchId?: string;      // Only present for daily_batch trigger
}
```

### Enqueueing a Score Job

```typescript
// server/scoring/enqueueScoringJob.ts

import { getQueue } from "../queues/queueFactory";
import type { ContactScoreJobPayload, ScoringTrigger } from "./scoringJob";

export async function enqueueContactScore(
  contactId: number,
  subAccountId: number,
  trigger: ScoringTrigger,
  batchId?: string,
): Promise<void> {
  const queue = getQueue("apex-scoring");
  if (!queue) {
    console.warn(`[SCORING] Queue unavailable — skipping score for contact ${contactId}`);
    return;
  }

  const payload: ContactScoreJobPayload = {
    type: "contact.score",
    contactId,
    subAccountId,
    trigger,
    triggeredAt: new Date().toISOString(),
    ...(batchId ? { batchId } : {}),
  };

  await queue.add("contact.score", payload, {
    // Deduplicate: if a score job for this contact is already waiting,
    // do not add another one. jobId collision deduplicates automatically.
    jobId: `score:${contactId}`,
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 1_000 },
  });
}
```

Using `jobId: score:{contactId}` ensures that if multiple triggers fire in quick succession (e.g., enrichment completes while a batch job is pending), only one scoring job executes. BullMQ silently drops duplicate `jobId` additions when the job is in `waiting` or `delayed` state.

### Worker Implementation

```typescript
// server/workers/scoringWorker.ts

import { Worker, type Job } from "bullmq";
import { getBullMQConnection } from "../queues/queueFactory";
import { runContactScoring } from "../scoring/runContactScoring";
import type { ContactScoreJobPayload } from "../scoring/scoringJob";
import { axiomLog } from "../lib/axiom";

export function startScoringWorker(): Worker {
  const worker = new Worker<ContactScoreJobPayload>(
    "apex-scoring",
    async (job: Job<ContactScoreJobPayload>) => {
      const { contactId, subAccountId, trigger, triggeredAt } = job.data;

      if (job.data.type !== "contact.score") {
        // Future-proofing: other job types may share this queue
        return;
      }

      const start = Date.now();
      const result = await runContactScoring(contactId, subAccountId);

      await axiomLog("apex.scoring.job_complete", {
        contactId,
        subAccountId,
        trigger,
        triggeredAt,
        numericScore: result.numericScore,
        letterGrade:  result.letterGrade,
        durationMs:   Date.now() - start,
        scoreVersion: result.scoreVersion,
        jobId:        job.id,
      });
    },
    {
      connection:  getBullMQConnection(),
      concurrency: 10,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`[SCORING WORKER] Job ${job?.id} failed:`, err.message);
    axiomLog("apex.scoring.job_failed", {
      jobId:     job?.id,
      contactId: job?.data?.contactId,
      error:     err.message,
    }).catch(() => {});
  });

  return worker;
}
```

### Triggers

| Trigger | Source | Implementation |
|---|---|---|
| `enrichment_complete` | Called from enrichment worker after writing enrichmentCompletedAt | `enqueueContactScore(contactId, subAccountId, "enrichment_complete")` |
| `workflow_stage_change` | Called from CRM worker when deal stage changes | `enqueueContactScore(contactId, subAccountId, "workflow_stage_change")` |
| `daily_batch` | Nightly cron at 02:00 UTC | Batch job — see Section 7 |

---

## 6. Redis Cache Strategy

### Cache Key Format

```
apex:score:{contactId}
```

Example: `apex:score:14892`

### Cache Schema

The cached value is a JSON-serialized `ScoringResult`. Partial reads are not supported — consumers always read the full result and extract the field they need (e.g., `letterGrade`).

### TTL

**4 hours (14,400 seconds)**

Rationale: Scoring is triggered by enrichment completion and workflow changes, both of which are relatively infrequent. A 4-hour TTL ensures stale scores are not served indefinitely while avoiding unnecessary recomputation on every API request.

### Cache Write (after scoring)

```typescript
// server/scoring/runContactScoring.ts (cache write segment)

import { getRedis } from "../redis";
import type { ScoringResult } from "./types";

const SCORE_CACHE_TTL_SECONDS = 14_400; // 4 hours

export async function writeScoringCache(result: ScoringResult): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const key = `apex:score:${result.contactId}`;
  await redis.set(key, JSON.stringify(result), "EX", SCORE_CACHE_TTL_SECONDS);
}
```

### Cache Read (API layer)

```typescript
// server/scoring/readScoringCache.ts

import { getRedis } from "../redis";
import type { ScoringResult } from "./types";

export async function readScoringCache(
  contactId: number,
): Promise<ScoringResult | null> {
  const redis = getRedis();
  if (!redis) return null;

  const raw = await redis.get(`apex:score:${contactId}`);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ScoringResult;
  } catch {
    return null;
  }
}
```

### Cache Invalidation

Cache entries are invalidated explicitly when:

1. A new score is written (the write always overwrites the key with a fresh TTL).
2. A contact is deleted (the Redis key expires naturally — no explicit delete needed because the DB row cascades and the TTL handles expiry).

There is no manual cache invalidation endpoint. The 4-hour TTL is the invalidation mechanism for all other cases.

---

## 7. Batch Scoring

### Nightly Batch Job

A nightly maintenance job at **02:00 UTC** scores all contacts that have not received a score within the past 24 hours. This catches contacts that missed event-driven triggers (e.g., ingested before scoring workers were deployed).

```typescript
// server/scoring/batchScoringJob.ts

import { db } from "../db";
import { contacts, contactAiProfiles } from "../../shared/schema";
import { sql, lt, or, isNull } from "drizzle-orm";
import { enqueueContactScore } from "./enqueueScoringJob";
import { randomUUID } from "crypto";

const BATCH_CHUNK_SIZE = 500;

export async function runNightlyBatchScoring(): Promise<void> {
  const batchId = randomUUID();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000); // 24h ago

  // Single query — no N+1. Fetches only the two columns needed.
  // LEFT JOIN ensures contacts with no profile row are included.
  const rows = await db.execute<{ id: number; sub_account_id: number }>(sql`
    SELECT c.id, c.sub_account_id
    FROM contacts c
    LEFT JOIN contact_ai_profiles cap ON cap.contact_id = c.id
    WHERE cap.scored_at IS NULL
       OR cap.scored_at < ${cutoff.toISOString()}
    ORDER BY c.id
  `);

  console.log(`[BATCH SCORING] batchId=${batchId} contacts=${rows.rows.length}`);

  // Enqueue in chunks to avoid overwhelming the queue in a single burst
  for (let i = 0; i < rows.rows.length; i += BATCH_CHUNK_SIZE) {
    const chunk = rows.rows.slice(i, i + BATCH_CHUNK_SIZE);
    await Promise.all(
      chunk.map(row =>
        enqueueContactScore(row.id, row.sub_account_id, "daily_batch", batchId)
      )
    );
  }
}
```

### Cron Schedule

The batch job is registered in the `apex-maintenance` queue via BullMQ's repeatable job API at server startup:

```typescript
// server/workers/maintenanceScheduler.ts (segment)

await maintenanceQueue.add(
  "nightly-batch-scoring",
  { type: "batch.score_all" },
  {
    repeat: { pattern: "0 2 * * *", tz: "UTC" },
    jobId: "nightly-batch-scoring",
  }
);
```

### Batch Performance Budget

| Metric | Target |
|---|---|
| Max contacts per nightly run | 50,000 |
| Enqueue time for 50k contacts | < 60 seconds |
| Worker throughput (10 concurrent) | ~600 scores/minute |
| Time to clear 50k backlog | ~90 minutes |

If contact volume exceeds 50,000, the batch job should be split across multiple nightly windows (e.g., half at 02:00 UTC, half at 03:30 UTC) using a modulus on `contact_id`.

---

## 8. API Surface

### `GET /api/contacts/:id/score`

Returns the current score for a single contact. Reads from Redis cache first; falls back to DB if cache is cold.

**Request**

```
GET /api/contacts/14892/score
Authorization: Bearer <token>
```

**Response (200)**

```json
{
  "contactId": 14892,
  "subAccountId": 7,
  "numericScore": 82.0,
  "letterGrade": "A",
  "gradeBoundary": "A (80-89)",
  "scoredAt": "2026-05-15T03:21:44.000Z",
  "scoreVersion": 1,
  "factorBreakdown": {
    "phone_present": 20,
    "email_present": 0,
    "enrichment_quality": 12,
    "identity_status": 15,
    "recency": 13,
    "severity": 10,
    "source_confidence": 10,
    "workflow_engagement": 2
  },
  "gradeExplanation": {
    "topFactors": ["phone present", "verified identity", "high severity"],
    "limitingFactors": ["no email (−10)"],
    "gradeBoundary": "A (80-89)"
  }
}
```

**Response (404)** — contact not found or no score yet (score job pending)

```json
{ "error": "Score not yet computed. Try again in a few seconds." }
```

**Implementation Notes**

- Verify `subAccountId` ownership before returning — contacts are sub-account scoped.
- If Redis is unavailable, read directly from `contact_ai_profiles` (graceful degradation).
- Do not trigger a synchronous scoring run from this endpoint. Return 404 and let the caller retry.

---

### `GET /api/accounts/:id/score-distribution`

Returns aggregate grade distribution for an account. Used by the operator dashboard.

**Request**

```
GET /api/accounts/7/score-distribution
Authorization: Bearer <token>
```

**Response (200)**

```json
{
  "subAccountId": 7,
  "totalScored": 3241,
  "distribution": {
    "A+": { "count": 48,   "percentage": 1.5  },
    "A":  { "count": 312,  "percentage": 9.6  },
    "B":  { "count": 1107, "percentage": 34.2 },
    "C":  { "count": 987,  "percentage": 30.5 },
    "D":  { "count": 787,  "percentage": 24.3 }
  },
  "averageScore": 57.3,
  "computedAt": "2026-05-15T02:00:00.000Z"
}
```

**Implementation Notes**

- Query `contact_ai_profiles` using the `idx_cap_sub_grade` index — no full scan.
- Cache this response in Redis at `apex:score-dist:{subAccountId}` with TTL **1 hour**.
- Do not join back to `contacts` — all needed data is in `contact_ai_profiles`.

```sql
-- Underlying query (executed once, result cached)
SELECT
  letter_grade,
  COUNT(*)::integer          AS count,
  ROUND(AVG(numeric_score), 1) AS avg_score
FROM contact_ai_profiles
WHERE sub_account_id = $1
GROUP BY letter_grade
ORDER BY letter_grade;
```

---

## 9. Drizzle Schema Definition

```typescript
// shared/schema.ts — append after contacts table definition

import {
  pgTable,
  serial,
  integer,
  real,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const contactAiProfiles = pgTable(
  "contact_ai_profiles",
  {
    id:               serial("id").primaryKey(),
    contactId:        integer("contact_id")
                        .references(() => contacts.id, { onDelete: "cascade" })
                        .notNull()
                        .unique(),
    subAccountId:     integer("sub_account_id").notNull(),
    numericScore:     real("numeric_score").notNull().default(0),
    letterGrade:      text("letter_grade").notNull().default("D"),
    gradeExplanation: jsonb("grade_explanation"),
    factorBreakdown:  jsonb("factor_breakdown"),
    scoredAt:         timestamp("scored_at").notNull().defaultNow(),
    scoreVersion:     integer("score_version").notNull().default(1),
  },
  (table) => [
    index("idx_cap_sub_grade")
      .on(table.subAccountId, table.letterGrade),
    index("idx_cap_sub_score_desc")
      .on(table.subAccountId, table.numericScore),
  ]
);

export const insertContactAiProfileSchema =
  createInsertSchema(contactAiProfiles).omit({ id: true, scoredAt: true });

export type InsertContactAiProfile = z.infer<typeof insertContactAiProfileSchema>;
export type ContactAiProfile = typeof contactAiProfiles.$inferSelect;
```

### Upsert Pattern (no N+1)

```typescript
// server/scoring/runContactScoring.ts (DB write segment)

import { db } from "../db";
import { contactAiProfiles } from "../../shared/schema";
import { eq } from "drizzle-orm";
import type { ScoringResult } from "./types";

export async function persistScoringResult(result: ScoringResult): Promise<void> {
  await db
    .insert(contactAiProfiles)
    .values({
      contactId:        result.contactId,
      subAccountId:     result.subAccountId,
      numericScore:     result.numericScore,
      letterGrade:      result.letterGrade,
      gradeExplanation: result.gradeExplanation,
      factorBreakdown:  result.factorBreakdown,
      scoredAt:         result.scoredAt,
      scoreVersion:     result.scoreVersion,
    })
    .onConflictDoUpdate({
      target: contactAiProfiles.contactId,
      set: {
        numericScore:     result.numericScore,
        letterGrade:      result.letterGrade,
        gradeExplanation: result.gradeExplanation,
        factorBreakdown:  result.factorBreakdown,
        scoredAt:         result.scoredAt,
        scoreVersion:     result.scoreVersion,
      },
    });
}
```

The `INSERT ... ON CONFLICT DO UPDATE` pattern ensures there is always exactly one row per contact, eliminating the read-before-write anti-pattern that would otherwise cause N+1 issues under concurrent scoring.

---

## 10. Observability

All scoring events are logged to Axiom under the `apex.scoring` namespace.

### Event: `apex.scoring.job_complete`

Emitted after each successful contact score computation.

| Field | Type | Description |
|---|---|---|
| `contactId` | number | Contact being scored |
| `subAccountId` | number | Owning sub-account |
| `trigger` | string | What triggered the score: `enrichment_complete`, `workflow_stage_change`, `daily_batch`, `manual` |
| `triggeredAt` | ISO-8601 | When the job was enqueued |
| `numericScore` | number | Computed score (0–100) |
| `letterGrade` | string | Computed grade (D–A+) |
| `durationMs` | number | Wall-clock time for the scoring computation |
| `scoreVersion` | number | Algorithm version used |
| `jobId` | string | BullMQ job ID |

---

### Event: `apex.scoring.job_failed`

Emitted when a scoring job exhausts all retries.

| Field | Type | Description |
|---|---|---|
| `jobId` | string | BullMQ job ID |
| `contactId` | number | Contact that failed to score |
| `error` | string | Error message from the final attempt |

---

### Event: `apex.scoring.batch_started`

Emitted at the start of each nightly batch run.

| Field | Type | Description |
|---|---|---|
| `batchId` | UUID | Unique ID for this batch run |
| `contactCount` | number | Number of contacts enqueued |
| `startedAt` | ISO-8601 | Batch start timestamp |

---

### Event: `apex.scoring.cache_miss`

Emitted when the API serves a score from the DB (Redis cache miss).

| Field | Type | Description |
|---|---|---|
| `contactId` | number | Contact whose score was not cached |
| `subAccountId` | number | Owning sub-account |
| `servedFromDb` | boolean | Always true for this event |

---

### Sentry Instrumentation

Score computation errors (unexpected exceptions, DB write failures) are captured via Sentry with tag `component=scoring-worker` and `contact_id={contactId}`. Redis unavailability is treated as a warning (not an error) and logged to Axiom — scoring degrades to DB reads only, which is acceptable.

### Dashboard Queries (Axiom)

```
# Average score per trigger type (last 24h)
apex.scoring.job_complete
| summarize avg(numericScore) by trigger
| order by avg_numericScore desc

# Grade distribution from scoring events (last 7 days)
apex.scoring.job_complete
| summarize count() by letterGrade

# Scoring throughput per hour
apex.scoring.job_complete
| summarize count() by bin(1h)
```

---

## 11. Rollout Order

### Phase 1 — Infrastructure (Day 1)

1. Deploy `contact_ai_profiles` table migration.
2. Add Drizzle schema definition to `shared/schema.ts`.
3. Deploy `startScoringWorker()` — worker registers against the existing `apex-scoring` queue. No new jobs will be processed until contacts are enqueued.
4. Verify worker health via BullMQ dashboard or `/api/operator/queue-health`.

### Phase 2 — New Contact Scoring (Day 1–2)

1. Hook `enqueueContactScore(..., "enrichment_complete")` into the enrichment worker's completion callback.
2. Hook `enqueueContactScore(..., "workflow_stage_change")` into the deal stage-change handler.
3. All newly enriched or stage-changed contacts begin receiving scores automatically.
4. Verify via Axiom: confirm `apex.scoring.job_complete` events appear with expected score distributions.

### Phase 3 — Existing Contact Backfill (Day 2–3)

1. Enable the `nightly-batch-scoring` repeatable job in the maintenance scheduler.
2. On first run, the batch job will score all contacts with no existing score.
3. Monitor batch progress via `apex.scoring.batch_started` and `apex.scoring.job_complete` event counts in Axiom.
4. Verify that `contact_ai_profiles` row count approaches `contacts` row count.

### Phase 4 — API Exposure (Day 3)

1. Deploy `GET /api/contacts/:id/score` endpoint.
2. Deploy `GET /api/accounts/:id/score-distribution` endpoint.
3. Verify Redis cache hit rate via Axiom `apex.scoring.cache_miss` event frequency.
4. Wire operator dashboard to the distribution endpoint.

### Rollback

If scoring produces anomalous grade distributions (e.g., > 60% A+ from a scoring bug):

1. Pause the `apex-scoring` queue via BullMQ admin.
2. Bump `SCORE_VERSION` constant in `scoreContact.ts` and re-deploy with fix.
3. Truncate `contact_ai_profiles` (or filter by `score_version`).
4. Resume queue — nightly batch will re-score everything on next run.

Redis cache keys expire naturally within 4 hours; no manual cache flush required for rollback.

---

## Appendix A — Factor Weight Rationale

| Factor | Weight | Rationale |
|---|---|---|
| `phone_present` | 20 | Phone is the primary outreach channel; absence halves actionability |
| `email_present` | 10 | Secondary channel; present but less critical than phone for law firm leads |
| `enrichment_quality` | 15 | Confidence-weighted — partially enriched contacts score proportionally |
| `identity_status` | 15 | Verified identity dramatically increases campaign effectiveness |
| `recency` | 15 | Lead intent decays sharply after 30 days; stale contacts waste agent time |
| `severity` | 10 | High-severity incidents correlate with higher legal case value |
| `source_confidence` | 10 | First-party crash data (FLHSMV) is more reliable than third-party ads |
| `workflow_engagement` | 5 | Any prior contact indicates lead warmth; small signal but non-zero |

---

## Appendix B — Score Version History

| Version | Date | Changes |
|---|---|---|
| 1 | 2026-05-15 | Initial release — 8 factors, weights as documented above |

When the algorithm changes, increment `SCORE_VERSION` in `scoreContact.ts`, update this table, and trigger a full re-score via the batch job.
