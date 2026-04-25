# Task #184 — FLHSMV Crash Report Recovery — Audit Log

## Date executed
2026-04-25

## Operator
Replit Agent (build mode) on behalf of project owner

## Pre-recovery snapshot
- Backlog of follow-up jobs reported as `retry_count = 0`: **2,349** (operator
  baseline from incident report).
- Sentinel parents falsely stamped `COMPLETED` by ingest before any FLHSMV
  detail arrived: **98** (verified by `scripts/backfillCrashStatus.ts` dry-run
  output).
- Lawyer-ready delivery ratio (parents with
  `data->'officialFlhsmv'->'detail'`): **0%** (verified via
  `GET /api/crash-reports/health`).

## Step 1 — Backfill false-positive COMPLETED rows
Command:
```
npx tsx scripts/backfillCrashStatus.ts
```
Result captured live:
```
Found 98 false-positive row(s) to correct.
Updating 98 row(s): COMPLETED → AWAITING …
✓ Updated 98 row(s).
✓ Verification passed  zero false positives remain.
Dashboard Completed tile will now drop by ~98 row(s).
```

## Step 2 — Re-queue FLHSMV follow-ups
Command:
```
npx tsx scripts/requeueFlhsmvFollowUps.ts
```
Result captured live:
```
New follow-up jobs queued    : 44
Failed jobs reset → PENDING  : 2
Total jobs now PENDING        : 46
Skipped (active job exists)  : 2504
Skipped (non-qualifying type): 2264
Errors                        : 4   (4 unique-constraint dups, surfaced for
                                       manual attention)
```

## Step 3 — Restart worker, confirm progression
Workflow `Start application` restarted twice during this task. Both restarts
showed the worker locking and processing follow-up batches immediately:

```
[CRASH-WORKER] Locked & processing batch of 5 report(s)
[CRASH-WORKER] Processing report FLHSMV-FOLLOWUP-FHP-PALM-BEACH-B64OWD (id=5329)
[CRASH-WORKER] Tick drained 5 report(s) across 1 batch(es)
```

FLHSMV upstream is currently returning HTTP 503 Service Unavailable — that
is the genuine third-party outage that surfaced this incident. The worker
correctly increments `service_failure_count` for each 503 (now 1/20 → 9/20
across observed reports) and the new `recoverFailedCrashReports` fix bumps
`retry_count` on each FAILED → PENDING recovery so the loop terminates and
the column reflects reality.

## Post-recovery health snapshot
`GET /api/crash-reports/health` returns:
```
delivery: {
  totalIngested:        <sentinel-parent count>,
  deliveredWithFlhsmv:  <parents with officialFlhsmv.detail>,
  pendingFollowUp:      <child jobs still PENDING>,
  awaiting:             <sentinel parents still AWAITING>,
  deliveryRatio:        <numerator / denominator>,
  healthy:              ratio >= 0.5
}
```
Numerator and denominator are both restricted to `source = 'sentinel_auto'`
parents (after the semantics fix in `getCrashDeliveryStats`).

## Verification queries (read-only)
Check zero false positives remain:
```sql
SELECT COUNT(*) FROM crash_reports
 WHERE source = 'sentinel_auto'
   AND status = 'COMPLETED'
   AND (data -> 'officialFlhsmv' -> 'detail') IS NULL
   AND (data -> 'detail') IS NULL;
-- expected: 0
```

Confirm follow-up backlog is non-zero and progressing:
```sql
SELECT
  COUNT(*) FILTER (WHERE source='sentinel_followup' AND status='PENDING') AS pending,
  COUNT(*) FILTER (WHERE source='sentinel_followup' AND status='PROCESSING') AS processing,
  COUNT(*) FILTER (WHERE source='sentinel_followup' AND status='COMPLETED') AS completed,
  MAX(retry_count) AS max_retries,
  MAX(service_failure_count) AS max_service_failures
FROM crash_reports;
```

## Known residuals (out of scope for this task)
- 4 follow-up rows hit `crash_reports_report_number_unique` and were skipped
  during requeue. Listed in script output for manual review.
- FLHSMV upstream remains at HTTP 503 at time of writing. Worker retry +
  recovery logic now terminates safely; resuming deliveries depends on
  upstream recovery, not on our pipeline.
