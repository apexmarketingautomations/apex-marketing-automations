# FLHSMV Crash Portal Outage — 2026-05-20

## Status
- Incident remains active as of **2026-05-21 20:33 EDT**.
- FLHSMV's public crash portal UI is reachable at `https://services.flhsmv.gov/CrashReportPurchasing/`.
- The backend crash search endpoint behind that portal is still returning **HTTP 503**.

## What we could verify publicly
- FLHSMV still officially directs users to the crash portal from:
  - `https://www.flhsmv.gov/traffic-crash-reports/`
  - `https://services.flhsmv.gov/CrashReportPurchasing/`
- We did **not** find a current public outage notice or ETA for this incident.
- The last official bulletin we found that explicitly names `Crash Report Purchasing` was an older planned outage:
  - `INFO22-013`
  - dated **2022-09-07**
  - planned maintenance window **2022-09-11 07:00-12:00 EST**

## First seen in Apex telemetry
- Earliest provable outage mark in production data:
  - **2026-05-20 10:00:24.739 EDT**
  - source row: `crash_reports.source = 'sentinel_followup'`
  - error pattern: `FLHSMV returned HTTP 500 — FLHSMV county/date search returned HTTP 500`

## Current technical picture
1. The legacy entry path `https://services.flhsmv.gov/crashreportrequest/` returns a real apology page with **HTTP 503**.
2. The current official entry path `https://services.flhsmv.gov/CrashReportPurchasing/` returns **HTTP 200** and renders normally.
3. After legal acceptance, the portal redirects through:
   - `POST /crashreportpurchasing/legal/accept`
   - `GET /crashreportpurchasing/cart/insertcart`
   - `GET /crashreportpurchasing/crashreport/eligibility`
4. From that live portal session, probing `/CRRService/api/CrashReport/SearchReport` still returns **HTTP 503** with the FLHSMV apology HTML.

## Affected Apex paths
- Cloud follow-up completion:
  - `server/crashReportWorker.ts`
- Local residential browser worker:
  - `scripts/flhsmv-playwright-agent.mjs`
- Police report PDF queue:
  - blocked indirectly because no follow-up reports reach `COMPLETED + official_report_number`

## What we changed during this incident
1. **Stopped claiming work while FLHSMV is down**
   - `scripts/flhsmv-playwright-agent.mjs` now:
     - uses the live `CrashReportPurchasing` portal
     - performs the legal accept bootstrap
     - probes the real search backend before claiming any queue work
     - exits cleanly if the backend is still `503`

2. **Stopped burning reports into FAILED during upstream outage**
   - `server/crashReportWorker.ts` now treats FLHSMV `502/503` as an outage deferral
   - affected rows are moved to `RETRY_LATER` with a future `next_attempt_at`
   - this protects the queue from repeated outage-driven hard failures

3. **Recovered outage-damaged follow-ups**
   - Requeued **386** `sentinel_followup` rows from `FAILED` back to `RETRY_LATER`
   - reset `service_failure_count`
   - scheduled a future retry window instead of immediate hammering

## Commits tied to this incident
- `deafadf` — `fix: defer flhsmv outage retries`
- `b97a93b` — `chore: probe live crash portal before claiming flhsmv jobs`

## Operational takeaway
- This is currently an **upstream FLHSMV search-backend outage**, not a broken Apex queue.
- The system is now in a protected holding pattern:
  - no new queue damage
  - no false hard failures from outage noise
  - backlog preserved for retry once FLHSMV search recovers

## Next check
- Re-run the local Playwright worker or the direct portal probe.
- Recovery signal is:
  - `CrashReportPurchasing` still loads, and
  - `/CRRService/api/CrashReport/SearchReport` stops returning `503`.
