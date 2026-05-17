# Apex Sentinel — Source Intelligence Preservation

**Status:** Production (deployed 2026-05-16)
**Module:** `server/services/contactUpsertService.ts`, `server/workers/enrichmentWorker.ts`
**Related:** `SENTINEL_ADDRESS_CONFIDENCE.md`, `SENTINEL_ENRICHMENT_LINEAGE.md`, `SENTINEL_INCIDENT_LINEAGE.md`

---

## Table of Contents

1. [The Problem](#the-problem)
2. [The Principle](#the-principle)
3. [Source Taxonomy](#source-taxonomy)
4. [Phone Confidence Scale](#phone-confidence-scale)
5. [The `source_matched` SkipTraceStatus](#the-source_matched-skiptraceutstatus)
6. [Auto-Derive Logic in `upsertContact()`](#auto-derive-logic-in-upsertcontact)
7. [Source Intelligence Guard in `enrichmentWorker`](#source-intelligence-guard-in-enrichmentworker)
8. [Phone Confidence Merge in `mergeContact()`](#phone-confidence-merge-in-mergecontact)
9. [Pipeline Coverage](#pipeline-coverage)
10. [Operational Invariants](#operational-invariants)
11. [Monitoring and Regression Detection](#monitoring-and-regression-detection)

---

## The Problem

### Background

Apex Sentinel acquires intelligence from multiple tiers of sources. The highest-value tier
consists of first-party government and law enforcement records: sheriff booking forms, FLHSMV
crash reports, DHSMV vehicle registration lookups, court filing party records, and jail intake
forms. These sources frequently contain direct contact phone numbers — numbers the subject
themselves provided to the government agency when completing the underlying form.

The second tier consists of commercial enrichment services. BatchData is the primary skip-trace
provider. It accepts a name and address and returns a probable phone number drawn from
household data aggregation. It costs a credit per lookup. It returns "no_match" on roughly
30–40% of crash leads.

### The Regression

Prior to the 2026-05-16 fix, a critical regression existed in the enrichment pipeline: first-party
source phones were being silently discarded, then the same contacts were being submitted to
BatchData for skip-tracing.

The failure mode was this:

1. `legalSignalPipeline.ts` ingests an arrest record. The sheriff booking form contains the
   subject's phone number. `upsertContact()` is called with `input.phone = "+13055551234"`.

2. The contact is created with `phone = "+13055551234"`. However, `skipTraceStatus` was
   being set to `"not_attempted"` — the default — regardless of whether a phone was present.

3. The enrichment queue processes the contact. `enrichmentWorker.ts::handleSkipTrace()`
   checks: `contact.skipTraceStatus === "matched"`. It is not matched — it is `not_attempted`.
   The guard passes. BatchData is called.

4. BatchData returns a phone number (possibly the same one, possibly different). The contact
   is marked `"matched"`. A credit is consumed.

5. If BatchData returned a different phone, and the code did not have confidence-gating,
   the BatchData result would overwrite the sheriff-provided number.

This happened silently. The CRM showed `skipTraceStatus: "matched"` and
`enrichmentProvider: "batchdata"` — indistinguishable from a contact that genuinely required
skip-tracing. There was no indication that the sheriff had already provided the phone.

### Operational Impact

**Direct cost:** Every contact that arrived with a source phone and was then skip-traced
via BatchData consumed a credit that should not have been spent. For high-volume sheriff
feed days (150+ bookings), this represented material BatchData credit waste.

**Data integrity risk:** If `mergeContact()` lacked confidence-gating on phone fields (it did
not prior to this fix), a BatchData phone at 0.72 confidence could silently overwrite a sheriff
booking phone at 0.90 confidence. The higher-quality, government-sourced number would be
replaced by a probabilistic match. Operators would then be calling numbers that BatchData
guessed rather than numbers the subject gave to law enforcement.

**CRM trust erosion:** Operators viewing a contact with `skipTraceStatus: "no_match"` on
a record that had a valid sheriff phone in it had no way to understand what happened. The
status meant "we tried BatchData and failed" but the contact already had a phone. The
inconsistency undermined operator confidence in the platform's data quality signals.

**Retroactive skip-trace waste:** `retroSkipTrace.ts` already had a guard at line 81:
`if (contact.phone) return false`. This prevented the bulk retrace job from touching
contacts with phones. However, the realtime enrichment queue in `enrichmentWorker.ts`
did not have an equivalent guard — contacts with source phones could be queued and
processed via BatchData between the time they were created and the time a retrace
eligibility check would have caught them.

### Root Cause

The root cause was a missing invariant in the upsert and enrichment path:

> "A contact with a phone is already enriched. BatchData should never run on it."

This invariant was understood operationally but was not enforced in code. The
`skipTraceStatus` field was initialized to `"not_attempted"` unconditionally, which made
contacts with source phones look identical to contacts that genuinely needed skip-tracing.

---

## The Principle

**First-party source intelligence always takes priority.**

If a government agency, law enforcement body, or official court system provides a phone number
for a subject, that number is the best phone number the platform will ever have for that person.
It was provided directly by the subject under legal obligation. No skip-trace service can
produce a more authoritative result.

This principle has three operational implications:

1. **Never discard source phones.** If `upsertContact()` is called with a phone from a
   first-party source, that phone must reach the contact record. No downstream process
   should overwrite it with lower-confidence data.

2. **Never re-purchase what you already have.** If a contact has a phone, BatchData must not
   run for that contact, regardless of `skipTraceStatus`. The phone's existence is sufficient
   to skip the enrichment step entirely.

3. **Status must reflect reality.** A contact with a source phone is enriched. Its
   `skipTraceStatus` must be `"source_matched"` — not `"not_attempted"`, not `"matched"`,
   not `"no_match"`. The status must distinguish between "enriched by us from a government
   source" and "enriched by BatchData" so operators can understand data provenance.

---

## Source Taxonomy

The following table describes every data source that Sentinel currently ingests, the
`phoneSource` string value it writes to the contact record, the phone confidence level it
carries, and the pipeline module that generates it.

| Source | `phoneSource` Value | Phone Confidence | Pipeline Module | Typical Fields |
|---|---|---|---|---|
| FL HSMV Crash Report | `"flhsmv"` | 0.95 | `crashReportWorker.ts` | name, DL address, plate, injury severity |
| DHSMV Registration | `"dhsmv"` | 0.85 | `crashReportWorker.ts` | owner name, registration address, plate |
| Sheriff Booking Form | `"sheriff_booking"` | 0.90 | `arrestIngestPipeline.ts` | name, DOB, booking phone, charge, bond |
| Court Filing Party | `"court_filing"` | 0.85 | `legalSignalPipeline.ts` | plaintiff/defendant name, case number, court |
| Jail Booking Record | `"jail_booking"` | 0.90 | `arrestIngestPipeline.ts` | inmate name, booking date, charge, phone |
| BatchData Skip Trace | `"batchdata"` | 0.72 | `enrichmentWorker.ts` | phone, mailing address (probabilistic) |
| Google Places | `"google_places"` | 0.70 | entity enrichment | business name, business phone |
| Manual Entry | `"manual"` | 0.30–0.90 | admin CRM | operator-entered fields |
| Unknown Source | `"unknown"` | 0.30 | legacy / backfill | no source metadata available |

**Notes on FLHSMV vs DHSMV confidence:**

FLHSMV crash reports are the authoritative government record. The phone on a crash report
(when present) comes from the Florida Highway Safety and Motor Vehicles system and represents
data entered by a law enforcement officer at the crash scene, cross-referenced against DMV
records. Confidence is set at 0.95.

DHSMV registration records come from the vehicle registration system. They contain the
registered owner's name and address but do not always contain a direct phone number. When a
phone is present in a DHSMV result, it is treated at 0.85 — slightly below FLHSMV because
the registration phone field is self-reported and may be stale.

**Note on BatchData:**

BatchData is classified as a secondary source. Its phone confidence of 0.72 means it will never
overwrite a phone from any primary source (minimum 0.85 from DHSMV). BatchData is explicitly
blocked from running when `contact.phone` is populated, regardless of the phone's origin.

---

## Phone Confidence Scale

The `PHONE_CONFIDENCE` constants are defined in `server/services/contactUpsertService.ts`
and are used throughout the pipeline to determine which phone wins in a merge and whether
a contact needs skip-tracing.

```typescript
export const PHONE_CONFIDENCE = {
  /** FL government agency verified (FLHSMV, DHSMV direct) */
  VERIFIED_GOVERNMENT: 0.95,
  /** Sheriff booking record — directly from booking form */
  SHERIFF_BOOKING:     0.90,
  /** Court filing — party contact info on official record */
  COURT_FILING:        0.85,
  /** DHSMV registration — vehicle owner phone on file */
  REGISTRATION:        0.85,
  /** BatchData skip-trace result */
  BATCHDATA:           0.72,
  /** Google Places — business phone from Maps */
  GOOGLE_PLACES:       0.70,
  /** Inferred / probabilistic match */
  INFERRED:            0.50,
  /** Source unknown or not specified */
  UNKNOWN:             0.30,
} as const;
```

The scale is designed with two structural properties:

1. **All primary source confidence values are above 0.80.** Any phone from FLHSMV, DHSMV,
   sheriff, or court exceeds 0.80 in confidence.

2. **All secondary source confidence values are below 0.80.** BatchData (0.72), Google Places
   (0.70), inferred (0.50), and unknown (0.30) all fall below the primary tier floor.

This gap means the merge logic does not need to know the specific source — it only needs to
compare confidence values. A confidence comparison of 0.90 > 0.72 is all that is required to
preserve a sheriff booking phone over a BatchData result.

---

## The `source_matched` SkipTraceStatus

### Why a New Status Was Needed

Before this fix, `SkipTraceStatus` had six values:

```
"not_attempted" — no enrichment has been tried
"pending"       — BatchData call in progress
"attempted"     — deprecated intermediate state
"failed"        — BatchData call errored
"no_match"      — BatchData returned no phone
"matched"       — BatchData returned a phone
```

None of these values meant "a first-party source already provided a phone." The value
`"not_attempted"` was used as the default for all new contacts including those created with
a source phone, which made them indistinguishable from contacts with no phone.

`"source_matched"` was added as the sixth distinct value (seventh token including `"attempted"`)
to mean exactly: "this contact has a phone provided by a first-party government or law
enforcement source; BatchData must not run."

### Status Rank Table

`mergeContact()` uses an integer rank to determine whether an incoming `skipTraceStatus`
should overwrite the existing one. Higher rank always wins:

```
not_attempted : 0   — brand new contact, no enrichment attempted
pending       : 1   — enrichment job is running
attempted     : 2   — deprecated; treated same as failed
failed        : 2   — BatchData errored; can be retried
no_match      : 3   — BatchData ran and returned no phone
matched       : 4   — BatchData ran and returned a phone
source_matched: 5   — first-party source provided phone (terminal)
```

`source_matched` at rank 5 is the highest possible status. It can never be overwritten by any
other status through normal pipeline operation. Once a contact reaches `source_matched`, it
stays there.

The rank table is defined inline in `mergeContact()`:

```typescript
const statusRank: Record<string, number> = {
  not_attempted: 0, pending: 1, attempted: 2, failed: 2,
  no_match: 3, matched: 4, source_matched: 5,
};
const incomingRank = statusRank[input.skipTraceStatus] ?? 0;
const existingRank = statusRank[existing.skipTraceStatus ?? "not_attempted"] ?? 0;
if (incomingRank > existingRank) {
  patch.skipTraceStatus = input.skipTraceStatus;
}
```

### How `source_matched` Prevents BatchData

Two independent guards prevent BatchData from running on a `source_matched` contact:

**Guard 1 — `enrichmentWorker.ts` source intelligence check (line 89):**
If `contact.phone` is non-null, the function promotes to `source_matched` and returns early
before making any HTTP call. This is the primary production guard.

**Guard 2 — `retroSkipTrace.ts` eligibility check (line 81):**
`isEligibleContact()` returns `false` if `contact.phone` is non-null. The bulk retrace job
will never queue a contact that already has a phone.

These guards operate at different layers (realtime queue vs batch job) and are independently
sufficient. The defense-in-depth ensures that even if one guard has a bug, the other catches
the case.

---

## Auto-Derive Logic in `upsertContact()`

### The One-Liner

In `server/services/contactUpsertService.ts`, the `baseValues` block that prepares the insert
payload contains:

```typescript
skipTraceStatus: input.skipTraceStatus ?? (input.phone ? "source_matched" : "not_attempted"),
```

This single expression is the primary mechanism that ensures new contacts arrive with the
correct status. It is evaluated during every `upsertContact()` call on the insert path.

### Reading the Logic

The expression uses the nullish coalescing operator (`??`). It means:

- If `input.skipTraceStatus` is explicitly set by the caller, use that value.
- Otherwise, if `input.phone` is present, default to `"source_matched"`.
- Otherwise, default to `"not_attempted"`.

The caller's explicit value takes precedence. This is the escape hatch. If a pipeline for any
reason needs to create a contact with a phone but explicitly set a different skip trace status,
it can do so by passing `input.skipTraceStatus = "not_attempted"`. The override is honored.
This is intentional: the system trusts pipeline callers to be explicit about their intent when
they deviate from the default.

### Why This Default Is Safe

Setting `skipTraceStatus = "source_matched"` when `input.phone` is present is safe because:

1. If the phone is genuinely from a first-party source (sheriff, FLHSMV, court), `source_matched`
   is the correct status. No further action needed.

2. If the phone is from an unknown origin (legacy ingest, manual entry without source metadata),
   `source_matched` is still the conservative choice. The alternative — `"not_attempted"` — would
   trigger BatchData to run, which would at best reproduce information already present and at
   worst overwrite a good phone with a probabilistic one.

3. `source_matched` is terminal. If a pipeline later decides the contact needs re-enrichment
   (e.g., the phone was invalid and was subsequently cleared), it can set `skipTraceStatus`
   explicitly back to `"not_attempted"`. This requires a deliberate action rather than happening
   silently.

### Cases That Could Violate the Default

The default is correct in almost all cases. The known exception patterns are:

**Pattern A — Phone is a placeholder or temporary value.** If a caller sets `input.phone` to a
known-invalid number (e.g., `"0000000000"`, `"5555555555"`) and does not normalize it, the
contact will be marked `source_matched` with a bad phone. Mitigation: `normalizePhone()` strips
invalid numbers before they reach the database. Any phone that survives normalization is treated
as valid.

**Pattern B — Phone comes from a source that should not block skip-tracing.** Hypothetically,
if a future pipeline ingest route accepted user-provided phone data of unknown reliability and
passed it through `upsertContact()`, it would be marked `source_matched` and would never be
skip-traced. The mitigation is to be deliberate: any ingest path that provides low-confidence
phones should pass `phoneConfidence: PHONE_CONFIDENCE.UNKNOWN` and, if BatchData re-tracing
is desired, explicitly set `skipTraceStatus: "not_attempted"`.

**Pattern C — Re-ingesting a contact that was previously failed.** If a contact was previously
marked `"failed"` due to a BatchData error and the pipeline re-ingests the contact with a
subsequently-acquired source phone, the auto-derive will produce `"source_matched"`. The merge
logic will accept this because `source_matched` (rank 5) outranks `failed` (rank 2). This is
correct behavior.

---

## Source Intelligence Guard in `enrichmentWorker`

### Location

`server/workers/enrichmentWorker.ts`, function `handleSkipTrace()`, lines 86–98.

### Full Guard Code

```typescript
// SOURCE INTELLIGENCE GUARD — never run BatchData when source already provided a phone.
// If a first-party source (sheriff, FLHSMV, court) already gave us a phone,
// running BatchData is wasted spend. Promote the status to source_matched and exit.
if (!force && contact.phone) {
  const alreadySourceMatched = contact.skipTraceStatus === "source_matched";
  if (!alreadySourceMatched) {
    await db.update(contacts)
      .set({ skipTraceStatus: "source_matched" })
      .where(eq(contacts.id, contactId));
    console.log(
      `[${WORKER_TAG}] Contact ${contactId} already has source phone — promoted to source_matched, skipping BatchData`
    );
  }
  return { enriched: false };
}
```

### Walkthrough

**Line 1 condition: `!force && contact.phone`**

The guard fires when two conditions are both true:
- `force` is false. The `force` flag is used by admin endpoints to explicitly re-run
  BatchData on a contact regardless of status. When an operator forces a retrace, this guard
  is bypassed intentionally. Force-retrace is a deliberate override.
- `contact.phone` is truthy. The contact has a phone number in the database at the time the
  enrichment job executes.

Note: `contact.phone` is checked at job execution time, not at job queue time. A contact could
have been queued for skip-tracing before its phone was recorded (e.g., a crash contact queued
immediately on ingest before FLHSMV enrichment ran and populated the phone field). By checking
`contact.phone` at execution time, the guard catches this race condition.

**Promotion block: `if (!alreadySourceMatched)`**

If the contact's current `skipTraceStatus` is already `"source_matched"`, no database write is
needed — the status is correct. The guard short-circuits without a write.

If the status is anything other than `"source_matched"` (e.g., `"not_attempted"`, `"no_match"`,
`"failed"`), the guard promotes the status to `"source_matched"` before returning. This corrects
any cases where the auto-derive logic did not run (legacy contacts, contacts created before this
fix, contacts whose status was set incorrectly by an older code path).

**Log line:**

```
[ENRICHMENT] Contact 14782 already has source phone — promoted to source_matched, skipping BatchData
```

This log line is observable in production and in Axiom (if structured logging is enabled). An
operator or engineer can search for `promoted to source_matched` to audit how many contacts per
day are being correctly intercepted by this guard.

**Return: `{ enriched: false }`**

The function returns `{ enriched: false }` without calling BatchData. The job completes
successfully. No credit is consumed. The BullMQ job is marked done.

### Guard Ordering

The guard is evaluated after two other early exits:

1. **BatchData disabled kill switch** (lines 71–74): If `BATCHDATA_DISABLED=true` in the
   environment, all skip-trace jobs return immediately. This is checked first.

2. **Already-matched idempotency check** (lines 80–84): If `skipTraceStatus === "matched"`,
   the contact was already skip-traced successfully via BatchData and does not need another
   call. This check is for BatchData idempotency.

3. **Source intelligence guard** (lines 86–98): This is the new guard. It fires after the
   already-matched check, which means a contact that was previously matched by BatchData and
   then subsequently acquired a source phone will not be re-processed (the already-matched
   check catches it first). This is fine: if BatchData ran first and the source phone arrived
   later, `mergeContact()` will have already handled the confidence comparison.

---

## Phone Confidence Merge in `mergeContact()`

### Location

`server/services/contactUpsertService.ts`, function `mergeContact()`, lines 511–523.

### Merge Logic

```typescript
// Phone: upgrade by confidence — higher-confidence source always wins.
// Government / sheriff source (0.85–0.95) beats BatchData (0.72).
// Never overwrite a higher-confidence phone with a lower-confidence one.
// If existing phone has no confidence recorded, treat as UNKNOWN (0.30).
const incomingPhoneConf = input.phoneConfidence ?? (input.phone ? PHONE_CONFIDENCE.UNKNOWN : 0);
const existingPhoneConf = (existing as any).phoneConfidence ?? (existing.phone ? PHONE_CONFIDENCE.UNKNOWN : 0);
if (input.phone && (incomingPhoneConf > existingPhoneConf || !existing.phone)) {
  patch.phone = input.phone;
  if (normPhone) patch.normalizedPhone = normPhone;
  if (input.phoneSource) (patch as any).phoneSource = input.phoneSource;
  if (input.phoneConfidence !== undefined) (patch as any).phoneConfidence = input.phoneConfidence;
  (patch as any).phoneAcquiredAt = input.phoneAcquiredAt ?? new Date();
}
```

### Behavior by Scenario

**Scenario A — BatchData phone arrives, contact has sheriff phone (0.90):**

```
incoming: phone="+13055559999", phoneConfidence=0.72 (BatchData)
existing: phone="+13055551234", phoneConfidence=0.90 (Sheriff)

incomingPhoneConf (0.72) > existingPhoneConf (0.90)? → false
existing.phone is null? → false
Condition fails → patch.phone is NOT set → sheriff phone preserved
```

**Scenario B — FLHSMV phone arrives, contact was created as placeholder (no phone):**

```
incoming: phone="+13055551234", phoneConfidence=0.95 (FLHSMV)
existing: phone=null, phoneConfidence=null

existing.phone is null? → true
Condition passes → patch.phone = "+13055551234"
phoneSource = "flhsmv", phoneConfidence = 0.95
```

**Scenario C — Court filing phone arrives, contact has BatchData phone (0.72):**

```
incoming: phone="+13055552345", phoneConfidence=0.85 (Court Filing)
existing: phone="+13055557777", phoneConfidence=0.72 (BatchData)

incomingPhoneConf (0.85) > existingPhoneConf (0.72)? → true
Condition passes → patch.phone = "+13055552345"
phoneSource = "court_filing", phoneConfidence = 0.85
skipTraceStatus promoted to source_matched (rank 5 > rank 4)
```

**Scenario D — Second BatchData result arrives, contact already has BatchData phone:**

```
incoming: phone="+13055553456", phoneConfidence=0.72 (BatchData)
existing: phone="+13055554567", phoneConfidence=0.72 (BatchData)

incomingPhoneConf (0.72) > existingPhoneConf (0.72)? → false
existing.phone is null? → false
Condition fails → existing BatchData phone preserved
```

This last scenario means that once a BatchData phone is on a contact, a second BatchData result
with equal confidence does not overwrite it. The first match wins. To update the phone, the
incoming confidence must strictly exceed the existing confidence.

### Treating Legacy Phones Without Confidence

Many contacts created before the 2026-05-16 migration do not have `phoneConfidence` recorded.
The merge logic handles this gracefully:

```typescript
const existingPhoneConf = (existing as any).phoneConfidence ?? (existing.phone ? PHONE_CONFIDENCE.UNKNOWN : 0);
```

If `phoneConfidence` is null but `existing.phone` is non-null, the existing phone is treated as
`PHONE_CONFIDENCE.UNKNOWN` (0.30). This means any incoming phone with source metadata (minimum
0.72 for BatchData, 0.85+ for primary sources) will upgrade a legacy phone without confidence.
This is the correct behavior: it retroactively migrates legacy contacts into the confidence system.

---

## Pipeline Coverage

The following pipelines have been audited for source intelligence awareness:

### `legalSignalPipeline.ts`

Handles arrest records and court filings from sheriff/court data feeds.

When `lead.subjectPhone` is present:
- `phoneSource` is set to `"sheriff_booking"` for arrest-type signals
- `phoneSource` is set to `"court_filing"` for court-type signals
- `phoneConfidence` is set to `0.85` (minimum for court; booking uses `SHERIFF_BOOKING` 0.90)
- `skipTraceStatus` auto-derives to `"source_matched"` via `upsertContact()`

When `lead.subjectPhone` is absent:
- `phoneSource` is null, `phoneConfidence` is null
- `skipTraceStatus` auto-derives to `"not_attempted"`
- Contact is eligible for BatchData skip-tracing

### `arrestIngestPipeline.ts`

Handles bulk ingest of arrest/booking records.

Phone fields from booking forms are passed directly to `upsertContact()`. The auto-derive
logic assigns `"source_matched"` when a phone is present. Contacts without booking phones
arrive as `"not_attempted"` and are eligible for enrichment.

Commentary in the pipeline (line 207):
```
// skipTraceStatus auto-defaults to "not_attempted" when no phone present.
```

This comment documents the intent explicitly — the pipeline relies on the auto-derive, not an
explicit status assignment.

### `crashIngestPipeline.ts`

Handles initial ingest of FHP CAD crash signals. At ingest time, crash contacts are created as
placeholder stubs. Phone data is not available at CAD ingest time (only the incident scene
coordinates and plate references are known). All crash contacts are created with:
- `phone = null`
- `skipTraceStatus = "not_attempted"` (auto-derived)

This is correct. The FLHSMV enrichment that follows in `crashReportWorker.ts` is what provides
residential intelligence and (rarely) phone numbers.

### `crashReportWorker.ts`

Handles FLHSMV report fetch and DHSMV registration lookup. When FLHSMV or DHSMV data contains
a phone number for a crash participant, it is passed through `mergeContact()` with:
- `phoneSource = "flhsmv"` or `"dhsmv"`
- `phoneConfidence = PHONE_CONFIDENCE.VERIFIED_GOVERNMENT` (0.95) or `PHONE_CONFIDENCE.REGISTRATION` (0.85)

If the phone is successfully merged, `mergeContact()` will also promote `skipTraceStatus` to
`"source_matched"` via the rank-based status merge logic.

**Important:** crash leads that do not receive a phone from FLHSMV/DHSMV enrichment proceed to
the BatchData skip-trace queue. Their `skipTraceStatus` remains `"not_attempted"`. The
enrichment worker will process them normally.

### `enrichmentWorker.ts`

Not a source pipeline, but the guard in `handleSkipTrace()` means it is source-intelligence
aware. It reads `contact.phone` at execution time and intercepts any contact that arrived with
a source phone regardless of how `skipTraceStatus` was set at creation time.

This makes the enrichment worker the last-resort safety net for contacts that slipped through
with a source phone and an incorrect `"not_attempted"` status.

---

## Operational Invariants

The following invariants must never be violated. Any code change that breaks an invariant must
not be merged without explicit architectural review.

**Invariant 1 — Source phones are never discarded.**
If `upsertContact()` is called with `input.phone` non-null, the phone must reach the
`contacts.phone` column unless an existing phone with strictly higher confidence already
occupies that field.

**Invariant 2 — BatchData never runs on a contact with a phone.**
`handleSkipTrace()` must always check `contact.phone` before making a BatchData API call.
Removing or moving the source intelligence guard without an equivalent replacement is
a breaking change.

**Invariant 3 — `source_matched` is terminal.**
Once a contact has `skipTraceStatus = "source_matched"`, no normal pipeline operation can
downgrade it. Only an explicit admin action with `force = true` can trigger a BatchData call
on such a contact, and even then, the phone confidence merge ensures the source phone is not
overwritten unless the incoming confidence is strictly higher.

**Invariant 4 — Lower-confidence phones never overwrite higher-confidence phones.**
The `mergeContact()` phone merge condition requires `incomingPhoneConf > existingPhoneConf`.
Strict greater-than means ties do not overwrite. A BatchData result (0.72) can never overwrite
a DHSMV phone (0.85), a court filing phone (0.85), a sheriff booking phone (0.90), or an FLHSMV
phone (0.95).

**Invariant 5 — `phoneSource` must be set whenever `phoneConfidence` is set.**
A `phoneConfidence` value without a corresponding `phoneSource` is meaningless for lineage
tracking. Every write that sets `phoneConfidence` must also set `phoneSource`. The inverse is
not required: a `phoneSource` without `phoneConfidence` is acceptable (legacy ingest) and will
be treated as `PHONE_CONFIDENCE.UNKNOWN` (0.30) by the merge logic.

**Invariant 6 — `retroSkipTrace.ts` must never be modified to process contacts with phones.**
The guard at `isEligibleContact()` line 81 (`if (contact.phone) return false`) is not a
performance optimization — it is a safety constraint. Removing it would cause the bulk
retrace job to re-process every phone-carrying contact in the database.

---

## Monitoring and Regression Detection

### Check: Source Phone Preservation Rate

How many contacts have a source-provided phone vs a BatchData phone?

```sql
SELECT
  phone_source,
  COUNT(*)                                           AS contact_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct
FROM contacts
WHERE phone IS NOT NULL
  AND phone_source IS NOT NULL
GROUP BY phone_source
ORDER BY contact_count DESC;
```

Expected result: `batchdata` should represent a minority. Primary sources (sheriff, FLHSMV,
court, DHSMV) should collectively exceed BatchData in volume if the platform has active
sheriff/legal feeds.

### Check: Status Consistency

Every contact with a source (non-BatchData) phone must be `source_matched`.

```sql
SELECT id, first_name, last_name, phone, phone_source, skip_trace_status
FROM contacts
WHERE phone IS NOT NULL
  AND phone_source IS NOT NULL
  AND phone_source != 'batchdata'
  AND skip_trace_status != 'source_matched'
LIMIT 50;
```

This query should return zero rows in a healthy system. Any rows returned indicate contacts
that have a primary source phone but were not correctly promoted.

### Check: Regression — BatchData Running on Source Contacts

Did BatchData run on a contact that already had a source phone?

```sql
SELECT
  c.id,
  c.first_name,
  c.last_name,
  c.phone,
  c.phone_source,
  c.phone_confidence,
  c.skip_trace_status,
  c.enrichment_provider,
  c.enrichment_completed_at
FROM contacts c
WHERE c.enrichment_provider = 'batchdata'
  AND c.enrichment_completed_at IS NOT NULL
  AND c.phone_confidence > 0.72
  AND c.phone_source != 'batchdata'
ORDER BY c.enrichment_completed_at DESC
LIMIT 50;
```

This finds contacts where BatchData ran (`enrichment_provider = 'batchdata'`) but the
resulting phone has higher confidence than BatchData (0.72), meaning the source phone
overwrote the BatchData result through the merge. These are contacts where source phones
arrived after a BatchData run had already completed.

### Check: Daily Source Match Rate

```sql
SELECT
  DATE_TRUNC('day', created_at) AS day,
  COUNT(*) FILTER (WHERE skip_trace_status = 'source_matched') AS source_matched,
  COUNT(*) FILTER (WHERE skip_trace_status = 'matched')        AS batchdata_matched,
  COUNT(*) FILTER (WHERE skip_trace_status = 'no_match')       AS no_match,
  COUNT(*) FILTER (WHERE skip_trace_status = 'not_attempted')  AS not_attempted,
  COUNT(*)                                                      AS total
FROM contacts
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;
```

An unexpected drop in `source_matched` on days where sheriff/FLHSMV feeds were active
indicates a regression in the auto-derive logic.

### Check: Contacts with No Status Consistency

```sql
SELECT
  skip_trace_status,
  phone IS NOT NULL        AS has_phone,
  phone_source IS NOT NULL AS has_source,
  COUNT(*)                 AS count
FROM contacts
GROUP BY 1, 2, 3
ORDER BY 1, 2;
```

The combination `(has_phone=true, has_source=true, skip_trace_status='not_attempted')` should
be zero or very close to zero. Any significant count there means the auto-derive did not fire
correctly on insert.

---

*Document version: 1.0 — 2026-05-16*
*Authors: Apex Engineering*
*See also: `SENTINEL_ENRICHMENT_LINEAGE.md`, `SENTINEL_ADDRESS_CONFIDENCE.md`*
