# Apex Sentinel — Phone Number Preservation

**Status:** Production (deployed 2026-05-16)
**Module:** `server/services/contactUpsertService.ts`, `server/workers/enrichmentWorker.ts`
**Fixes:** Source intelligence preservation regression (BatchData clobbering source-phone status)
**Depends on:** Victim-Centric Architecture, Skip-Trace Optimization

---

## Table of Contents

1. [Overview](#overview)
2. [The Regression — Root Cause Analysis](#the-regression--root-cause-analysis)
3. [The Fix — Exact Code Changes](#the-fix--exact-code-changes)
4. [Phone Normalization Rules](#phone-normalization-rules)
5. [Phone Deduplication](#phone-deduplication)
6. [Phone Merge Rules](#phone-merge-rules)
7. [Backfill Migration](#backfill-migration)
8. [Skip-Trace Eligibility Flow](#skip-trace-eligibility-flow)
9. [Cost Impact](#cost-impact)
10. [Monitoring](#monitoring)

---

## Overview

Sentinel's primary value is turning first-party government intelligence — sheriff bookings,
court filings, crash reports, FLHSMV/DHSMV data — into verified contact records. When those
sources provide a phone number, that phone has already been validated by the source system.
It is higher quality than anything a third-party skip-trace service can produce.

The preservation system enforces one principle: **if a source gave us a phone, that phone
is authoritative, and no third-party enrichment should ever contradict or override it.**

This document covers the mechanics of that guarantee: how phones are normalized, stored,
deduplicated, merged, and protected from being overwritten or misrepresented by downstream
enrichment pipelines.

---

## The Regression — Root Cause Analysis

### What Happened

A regression caused contacts with valid source-provided phones to display a "No Match"
badge in the CRM. The bug was a status-clobbering problem, not a data-loss problem — the
phone was preserved, but the `skipTraceStatus` was overwritten to reflect a failed BatchData
lookup rather than the source intelligence that made BatchData unnecessary.

### The Fault Path (Step-by-Step)

```
Step 1 — Source ingest creates contact with phone

  upsertContact({
    phone: "8135551234",          // Sheriff booking phone
    phoneSource: "sheriff_booking",
    phoneConfidence: 0.90,
    skipTraceStatus: undefined,   // Not explicitly set
  })

  // BUG: auto-derive logic was absent — status defaulted to "not_attempted"
  skipTraceStatus = "not_attempted"    // WRONG: should have been "source_matched"
```

```
Step 2 — enrichmentWorker.handleSkipTrace() is called on this contact

  // The idempotency guard in handleSkipTrace (BEFORE the fix):
  if (!force && contact.skipTraceStatus === "matched") {
    return { enriched: false }  // Only exits if already BatchData-matched
  }
  // contact.skipTraceStatus is "not_attempted" → guard does NOT fire
  // contact.phone is set, but there was no phone-presence guard
  // Execution continues to BatchData call
```

```
Step 3 — BatchData is called, returns no_match

  // BatchData receives: { firstName: "John", lastName: "Smith", state: "FL" }
  // No address to match on (or highway address) → returns no_match
  // Worker writes:
  skipTraceStatus = "no_match"
  enrichmentConfidence = 0.0
```

```
Step 4 — mergeContact() statusRank comparison

  statusRank = {
    not_attempted: 0,
    pending:       1,
    attempted:     2,
    failed:        2,
    no_match:      3,   // ← incoming from BatchData
    matched:       4,
    // source_matched did not exist yet
  }

  // "no_match" (3) > "not_attempted" (0) → patch applied
  patch.skipTraceStatus = "no_match"
```

```
Step 5 — CRM renders contact

  contact.phone = "8135551234"   (preserved — phone guard worked)
  contact.skipTraceStatus = "no_match"

  CRM badge logic:
    if skipTraceStatus === "no_match" → show red "No Match" badge

  Result: Contact with a valid sheriff-booking phone displays "No Match"
```

### Why the Phone Was Not Lost

The existing phone merge guard in `mergeContact()` was functioning correctly:

```typescript
// contactUpsertService.ts — mergeContact()
const incomingPhoneConf = input.phoneConfidence ?? (input.phone ? PHONE_CONFIDENCE.UNKNOWN : 0);
const existingPhoneConf = (existing as any).phoneConfidence ?? (existing.phone ? PHONE_CONFIDENCE.UNKNOWN : 0);
if (input.phone && (incomingPhoneConf > existingPhoneConf || !existing.phone)) {
  patch.phone = input.phone;
  // ...
}
```

Because `updateContactSkipTrace()` only writes `phone` when `status === "matched"` — and
BatchData returned `no_match` — the phone field was untouched. The bug was entirely in the
`skipTraceStatus` field: BatchData's negative result overwrote the implied "this contact
has a source phone" meaning of the previous status.

### Summary of the Regression

| Stage | Field | Expected Value | Actual Value (Bug) |
|-------|-------|---------------|---------------------|
| Ingest | `skipTraceStatus` | `source_matched` | `not_attempted` |
| BatchData | `skipTraceStatus` | (should not run) | `no_match` |
| CRM display | Badge | None or "Source" | "No Match" (red) |
| `phone` | Value | `8135551234` | `8135551234` (correct) |

The phone survived. The meaning attached to the phone was corrupted.

---

## The Fix — Exact Code Changes

### Change 1: Auto-Derive `source_matched` in `upsertContact()`

**File:** `server/services/contactUpsertService.ts`
**Location:** `baseValues` construction, line ~373

```typescript
// BEFORE (missing auto-derive):
skipTraceStatus: input.skipTraceStatus ?? "not_attempted",

// AFTER (auto-promote when phone is present):
skipTraceStatus: input.skipTraceStatus ?? (input.phone ? "source_matched" : "not_attempted"),
```

This means any call to `upsertContact()` that includes a phone number — without an explicit
`skipTraceStatus` override — will automatically set `source_matched`. Callers that pass
`skipTraceStatus: "not_attempted"` explicitly will get exactly what they asked for, but
omitting the field (the common case) now produces the safe default.

### Change 2: Phone-Presence Guard in `handleSkipTrace()`

**File:** `server/workers/enrichmentWorker.ts`
**Location:** `handleSkipTrace()`, after the existing `matched` idempotency check

```typescript
// BEFORE (only guarded on BatchData status):
if (!force && contact.skipTraceStatus === "matched") {
  console.log(`[${WORKER_TAG}] Contact ${contactId} already skip-traced — skipping`);
  return { enriched: false };
}
// No phone-presence guard — BatchData ran regardless of whether phone existed

// AFTER (phone-presence guard added):
if (!force && contact.skipTraceStatus === "matched") {
  console.log(`[${WORKER_TAG}] Contact ${contactId} already skip-traced — skipping`);
  return { enriched: false };
}

// SOURCE INTELLIGENCE GUARD — never run BatchData when source already provided a phone.
if (!force && contact.phone) {
  const alreadySourceMatched = contact.skipTraceStatus === "source_matched";
  if (!alreadySourceMatched) {
    await db.update(contacts)
      .set({ skipTraceStatus: "source_matched" })
      .where(eq(contacts.id, contactId));
    console.log(`[${WORKER_TAG}] Contact ${contactId} already has source phone — promoted to source_matched, skipping BatchData`);
  }
  return { enriched: false };
}
```

This guard runs after the existing `matched` check and catches any contact that somehow
reached the worker with a phone but without `source_matched` status (e.g., existing records
created before the fix, or records where the caller explicitly set `not_attempted`).

### Change 3: `statusRank` Updated to Include `source_matched`

**File:** `server/services/contactUpsertService.ts`
**Location:** `mergeContact()`, statusRank constant

```typescript
// BEFORE:
const statusRank: Record<string, number> = {
  not_attempted: 0, pending: 1, attempted: 2, failed: 2,
  no_match: 3, matched: 4,
};

// AFTER (source_matched added at rank 5 — highest):
const statusRank: Record<string, number> = {
  not_attempted: 0, pending: 1, attempted: 2, failed: 2,
  no_match: 3, matched: 4, source_matched: 5,
};
```

With `source_matched` at rank 5, no BatchData result (rank 3 for `no_match`, rank 4 for
`matched`) can ever downgrade a contact that already has source intelligence. Even a
BatchData `matched` result (rank 4) cannot overwrite `source_matched` (rank 5).

### New Status Value: `source_matched`

```typescript
// contactUpsertService.ts — SkipTraceStatus type
export type SkipTraceStatus =
  | "not_attempted"
  | "pending"
  | "attempted"
  | "matched"
  | "no_match"
  | "failed"
  /** Source already provided a valid phone — skip trace is unnecessary and must NOT run. */
  | "source_matched";
```

**Semantics of `source_matched`:**
- The contact has a phone from a first-party source (sheriff, FLHSMV, court, DHSMV)
- BatchData has not run and will not run unless `force: true` is passed
- The CRM must render this as a positive identity state, not as "no data"
- It ranks above `matched` because source intelligence has higher confidence than skip-trace

---

## Phone Normalization Rules

All phone numbers in Sentinel pass through `normalizePhone()` before storage or comparison.
This ensures that `(813) 555-1234`, `813-555-1234`, and `8135551234` all resolve to the
same deduplicated record.

### The Normalization Function

```typescript
// server/services/contactUpsertService.ts
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length < 7) return null;
  return digits;
}
```

### Rules

| Input Format | Normalized Output | Notes |
|---|---|---|
| `(813) 555-1234` | `8135551234` | Standard US format |
| `813-555-1234` | `8135551234` | Hyphenated |
| `813.555.1234` | `8135551234` | Dotted |
| `+1 813 555 1234` | `18135551234` | E.164 with country code |
| `1-813-555-1234` | `18135551234` | Country code with hyphens |
| `813 555 1234` | `8135551234` | Space-separated |
| `5551234` | `5551234` | 7-digit (retained — valid short number) |
| `555123` | `null` | Less than 7 digits — rejected |
| `(800) CALL-NOW` | `null` | Letters stripped → too short |
| `null` | `null` | Null passthrough |
| `""` | `null` | Empty string → null |

### Edge Cases

**Country code handling:** The normalizer strips everything except digits. `+1` becomes `1`
and is included in the normalized string. This means `+1 813 555 1234` normalizes to
`18135551234` while `813 555 1234` normalizes to `8135551234`. These are stored as
different `normalizedPhone` values and will not deduplicate against each other. Callers
should strip leading `1` for domestic Florida contacts before calling `upsertContact()`.

**Extension numbers:** `813-555-1234 ext. 5` normalizes to `81355512345`. The extension
digits are included because `replace(/[^0-9]/g, "")` treats all non-digits identically.
Callers should strip extensions before passing phone values.

**International numbers:** Numbers with more than 11 digits after stripping are stored as-is
(the 7-digit minimum is the only gate). International numbers from foreign court systems or
databases will store correctly but may not deduplicate against domestic representations.

**Test and placeholder numbers:** Numbers like `000-000-0000`, `555-555-5555`, and
`123-456-7890` pass normalization (they have enough digits). A future blocklist of known
test numbers can be added to `normalizePhone()` as a pre-check.

---

## Phone Deduplication

The `normalizedPhone` column is the second of three deduplication strategies in
`upsertContact()`. It provides a robust fall-through when `sourceExternalId` is absent
or does not match — which happens when the same person appears in two different source
systems (e.g., a crash victim who is also a court defendant).

### Dedup Architecture

```
upsertContact() dedup strategy:

  [1] sourceExternalId match  ─── strongest: same record in source system
        │ miss
        ↓
  [2] normalizedPhone match   ─── mid: same person by phone number
        │ miss
        ↓
  [3] normalizedEmail match   ─── fallback: same person by email
        │ miss
        ↓
  [4] INSERT new contact
```

### Phone Dedup Query

```typescript
// Step 2: Try dedup by normalized phone (within same sub-account)
if (normPhone) {
  const existing = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.subAccountId, subAccountId),   // scoped to tenant
        eq(contacts.normalizedPhone, normPhone),    // digits-only comparison
      ),
    )
    .limit(1);

  if (existing[0]) {
    const updated = await mergeContact(existing[0], input, ...);
    return { contactId: existing[0].id, action: updated ? "updated" : "noop", ... };
  }
}
```

### Dedup Scope

Deduplication is always scoped to `subAccountId`. A phone number that appears in Sub-Account
A and Sub-Account B will create two separate contact records — cross-account matches are
never performed. This is intentional: different accounts may represent different law firm
clients with non-overlapping lead pools.

### Database Index

```sql
-- Assumed index supporting phone dedup performance:
CREATE UNIQUE INDEX contacts_sub_account_normalized_phone_idx
  ON contacts (sub_account_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL;
```

This partial unique index enforces dedup at the database level (preventing race conditions
in concurrent upserts) while excluding contacts without a normalized phone from the index.

---

## Phone Merge Rules

When a phone-based dedup hit occurs, `mergeContact()` applies confidence-based merge logic
to decide whether the incoming phone should replace the existing one.

### The Phone Confidence Scale

```typescript
export const PHONE_CONFIDENCE = {
  VERIFIED_GOVERNMENT: 0.95,   // FLHSMV, DHSMV direct — FL government agency verified
  SHERIFF_BOOKING:     0.90,   // Booking record — directly from booking form
  COURT_FILING:        0.85,   // Court filing — party contact info on official record
  REGISTRATION:        0.85,   // DHSMV registration — vehicle owner phone on file
  BATCHDATA:           0.72,   // BatchData skip-trace result
  GOOGLE_PLACES:       0.70,   // Google Places — business phone from Maps
  INFERRED:            0.50,   // Inferred / probabilistic match
  UNKNOWN:             0.30,   // Source unknown or not specified
} as const;
```

### Merge Decision Logic

```typescript
// mergeContact() — phone merge block
const incomingPhoneConf = input.phoneConfidence ?? (input.phone ? PHONE_CONFIDENCE.UNKNOWN : 0);
const existingPhoneConf = (existing as any).phoneConfidence ?? (existing.phone ? PHONE_CONFIDENCE.UNKNOWN : 0);

if (input.phone && (incomingPhoneConf > existingPhoneConf || !existing.phone)) {
  patch.phone           = input.phone;
  patch.normalizedPhone = normPhone;
  patch.phoneSource     = input.phoneSource;
  patch.phoneConfidence = input.phoneConfidence;
  patch.phoneAcquiredAt = input.phoneAcquiredAt ?? new Date();
}
```

### Who Wins in Each Scenario

| Existing Source | Existing Conf | Incoming Source | Incoming Conf | Winner |
|---|---|---|---|---|
| None | 0 | Sheriff Booking | 0.90 | Incoming — existing is blank |
| BatchData | 0.72 | Sheriff Booking | 0.90 | Incoming — government beats skip-trace |
| Sheriff Booking | 0.90 | BatchData | 0.72 | Existing — higher confidence retained |
| Court Filing | 0.85 | FLHSMV | 0.95 | Incoming — FLHSMV is highest government |
| FLHSMV | 0.95 | Sheriff Booking | 0.90 | Existing — FLHSMV is never downgraded |
| Unknown | 0.30 | BatchData | 0.72 | Incoming — skip-trace beats unattributed |
| Unknown | 0.30 | Unknown | 0.30 | Existing — equal confidence, no change |
| Sheriff Booking | 0.90 | Court Filing | 0.85 | Existing — equal government tier, no change |

### Null and Missing Confidence Handling

Contacts without a `phoneConfidence` value on record are treated conservatively:
- If they have a phone, they are assigned `PHONE_CONFIDENCE.UNKNOWN` (0.30) for comparison
- If they have no phone, they are assigned 0

This means any source-attributed phone (minimum `GOOGLE_PLACES` at 0.70) will win over
an existing phone with no recorded confidence, even if that phone was provided by a
high-quality source that simply did not set `phoneConfidence` on the upsert call.

**Action item for callers:** always set `phoneSource` and `phoneConfidence` on `upsertContact()`
calls that include a phone. Unattributed phones lose merge priority to any attributed source.

---

## Backfill Migration

The regression created a population of production contacts with:
- `phone` set (valid source-provided number)
- `skipTraceStatus = "no_match"` (BatchData negative result, which should never have run)

These contacts display incorrectly in the CRM and waste future skip-trace budget if
retroSkipTrace is ever re-run without a guard.

### 3-Pass Backfill

**Pass 1 — Identify affected contacts**

```sql
-- Contacts with a phone but status of no_match (BatchData clobbered source status)
SELECT id, phone, skip_trace_status, phone_source, phone_confidence
FROM contacts
WHERE sub_account_id = :sub_account_id
  AND phone IS NOT NULL
  AND normalized_phone IS NOT NULL
  AND skip_trace_status = 'no_match'
ORDER BY created_at DESC;
```

**Pass 2 — Promote status to `source_matched`**

```sql
-- Heal the status field for all contacts with a phone and no_match status
UPDATE contacts
SET skip_trace_status = 'source_matched',
    updated_at = now()
WHERE phone IS NOT NULL
  AND normalized_phone IS NOT NULL
  AND skip_trace_status = 'no_match';
```

This is safe because the phone is already present — the update only corrects the status
label to match reality. No phone data is touched.

**Pass 3 — Backfill `not_attempted` contacts with phones**

```sql
-- Contacts that were never skip-traced because they had a phone,
-- but still show not_attempted (created before the auto-derive fix)
UPDATE contacts
SET skip_trace_status = 'source_matched',
    updated_at = now()
WHERE phone IS NOT NULL
  AND normalized_phone IS NOT NULL
  AND skip_trace_status = 'not_attempted';
```

### Backfill Safety

- Both updates are scoped by the presence of a non-null phone — no phoneless contacts
  are affected
- The updates are idempotent — re-running them on already-fixed contacts is a no-op
- No CRM webhook is fired by direct SQL updates — contact owners are not notified of the
  status correction
- `exportEligible` is not changed — contacts that were export-eligible before the backfill
  remain so

---

## Skip-Trace Eligibility Flow

The complete decision tree that determines whether BatchData runs for a given contact.
All gates are evaluated in order; the first gate that fires terminates the flow.

```
handleSkipTrace(contactId, force=false)
│
├─ [Gate 1] isBatchDataDisabled() === true
│     → return { enriched: false }
│     → reason: "circuit_breaker" (kill switch or quota exhausted)
│
├─ [Gate 2] contact not found in DB
│     → throw Error (BullMQ retries up to 3x)
│
├─ [Gate 3] !force && contact.skipTraceStatus === "matched"
│     → return { enriched: false }
│     → reason: "already_batchdata_matched" (idempotency)
│
├─ [Gate 4] !force && contact.phone exists
│     → if skipTraceStatus !== "source_matched":
│           UPDATE skipTraceStatus = "source_matched"
│     → return { enriched: false }
│     → reason: "source_matched" (source intelligence gate)
│
├─ [Gate 5] resolveBatchDataKey() returns null
│     → return { enriched: false }
│     → reason: "no_api_key"
│
├─ [Gate 6] firstName is blank or length < 2
│     → UPDATE skipTraceStatus = "no_match"
│     → return { enriched: false }
│     → reason: "name_insufficient"
│
├─ [Gate 7] No residential address available
│     (selectSkipTraceAddress() returns null)
│     → BatchData call proceeds but will likely return no_match
│     → Not a hard gate in current code — opportunity for future gate
│
└─ [ELIGIBLE] All gates passed
      → UPDATE skipTraceStatus = "pending"
      → Call BatchData API
      → Write result (matched/no_match/failed)
```

### Gate Rationale

**Gate 1 — Circuit breaker:** Protects against runaway spend when BatchData is disabled via
`BATCHDATA_DISABLED=true` env var or when the account has exhausted its monthly quota.

**Gate 2 — Contact existence:** Ensures we never process a job for a deleted or migrated
contact. BullMQ retries handle transient DB issues.

**Gate 3 — BatchData idempotency:** Prevents re-running BatchData on contacts that already
produced a match. Can be bypassed with `force: true` for manual re-enrichment.

**Gate 4 — Source intelligence gate (the key fix):** Never runs BatchData when the contact
already has a phone from any source. This is the gate added in the regression fix.

**Gate 5 — API key gate:** Fails gracefully when no BatchData credentials are configured.
This handles local development, staging environments, and key rotation windows.

**Gate 6 — Name gate:** BatchData's skip-trace-by-name endpoint requires a real name to
function. Contacts with placeholder names (`"Unidentified Crash Incident"`) or blank first
names will produce `no_match` 100% of the time — calling BatchData is pure waste.

### BLOCKED_TAGS

Certain contact classifications must never be skip-traced regardless of phone status:

```typescript
const BLOCKED_TAGS = new Set([
  "legal-lead",
  "attorney",
  "fda-recall",
  "osha-violation",
  "local-business",
  "entity",
  "placeholder",
]);
```

Contacts with any of these tags are excluded from retro skip trace scheduling. The
enrichmentWorker does not currently check tags inline (the tag check happens at scheduling
time in `runRetroSkipTraceAllAccounts()`), but any contact that reaches the worker with a
phone will be caught by Gate 4.

---

## Cost Impact

### Assumptions

- Average BatchData skip-trace cost: $0.05 per call
- Arrest/jail booking contacts with source-provided phone: approximately 60–70%
- Court filing contacts with source-provided phone: approximately 40–55%
- FLHSMV crash contacts with source-provided phone: approximately 25–35% (after DHSMV enrichment)

### Monthly Savings Estimate

For an account processing 1,000 new contacts per month across arrest, court, and crash
pipelines:

| Source | Monthly Contacts | Source-Phone Rate | Calls Saved | Savings |
|---|---|---|---|---|
| Arrest / Jail Booking | 400 | 65% | 260 | $13.00 |
| Court Filing | 300 | 48% | 144 | $7.20 |
| FLHSMV Crash | 300 | 30% | 90 | $4.50 |
| **Total** | **1,000** | **49%** | **494** | **$24.70/mo** |

At scale (10 active sub-accounts), this represents approximately $250/month in direct
BatchData credit savings per 10,000 contacts processed monthly.

### Additional Benefit: Hit Rate Improvement

By removing contacts with source phones from the BatchData pool, the effective hit rate of
remaining skip-trace runs improves. BatchData's `matched` rate on contacts without any prior
phone is approximately 35–45%. Previously, this rate was diluted by contacts that had phones
and would have returned either a match (redundant spend) or no_match (wasted spend).

---

## Monitoring

### Key Queries

**Source-matched coverage by source:**
```sql
SELECT
  source,
  COUNT(*) AS total_contacts,
  COUNT(*) FILTER (WHERE skip_trace_status = 'source_matched') AS source_matched,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE skip_trace_status = 'source_matched') / COUNT(*),
    1
  ) AS source_matched_pct
FROM contacts
WHERE sub_account_id = :sub_account_id
GROUP BY source
ORDER BY total_contacts DESC;
```

**Residual no_match contacts with phones (regression indicator):**
```sql
SELECT COUNT(*) AS problem_contacts
FROM contacts
WHERE phone IS NOT NULL
  AND normalized_phone IS NOT NULL
  AND skip_trace_status = 'no_match';
-- Expected: 0 after backfill. Any positive count indicates new regression or incomplete backfill.
```

**BatchData calls by outcome:**
```sql
SELECT
  skip_trace_status,
  COUNT(*) AS contacts,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM contacts
WHERE enrichment_provider = 'batchdata'
GROUP BY skip_trace_status
ORDER BY contacts DESC;
```

**Phone confidence distribution:**
```sql
SELECT
  phone_source,
  ROUND(AVG(phone_confidence), 3) AS avg_confidence,
  COUNT(*) AS contacts
FROM contacts
WHERE phone IS NOT NULL
GROUP BY phone_source
ORDER BY avg_confidence DESC;
```

### Alerts

| Condition | Alert | Action |
|---|---|---|
| Contacts with `phone IS NOT NULL` and `skip_trace_status = 'no_match'` > 0 | Warning | Re-run backfill Pass 1 and Pass 2 |
| BatchData `no_match` rate > 70% | Warning | Check address quality, name quality gates |
| `source_matched` rate for `jail_booking` source < 50% | Warning | Check booking ingest phone capture |
| BatchData cost spike without proportional `matched` increase | Critical | Check for guard bypass, review force flags |
