# Apex Platform Architecture

> **Platform names:** "Apex Marketing Automations" (the SaaS platform) / "Apex Sentinel" (the crash/accident pipeline specifically).
> **Deployment host:** Railway (managed containers + managed Postgres + Upstash Redis).
> **Primary language:** TypeScript (Node.js, Express, Drizzle ORM).

---

## 1. Queue Architecture

### Queue System

The platform uses **BullMQ** backed by **Upstash Redis** (`UPSTASH_REDIS_URL`). When Redis is unavailable the system falls back transparently to an **in-memory queue** (legacy behaviour, non-durable).

**Entry point:** `server/jobQueue.ts` re-exports everything from `server/queues/legacyAdapter.ts`. All existing callers use the same `jobQueue.enqueue()` / `jobQueue.registerHandler()` API surface regardless of which backend is active.

**Queue initialization:** `server/queues/queueFactory.ts` → `initQueues()`. Called once at startup after Redis is confirmed reachable.

### Queue Names and Purposes

| Queue name | Priority tier | Purpose |
|---|---|---|
| `apex-routing` | HIGH | Contact routing, lead delivery |
| `apex-notifications` | HIGH | SMS/email alerts, webhook fan-out |
| `apex-intake` | HIGH | Inbound webhook processing |
| `apex-enrichment` | MEDIUM | Skip-trace, address validation |
| `apex-scoring` | MEDIUM | Contact quality, case scoring |
| `apex-crm` | MEDIUM | CRM updates, lifecycle changes |
| `apex-general` | MEDIUM | Legacy `jobQueue.ts` drop-in migrations |
| `apex-ocr` | LOW | Document ingestion, OCR extraction |
| `apex-embeddings` | LOW | Vector embedding generation |
| `apex-semantic` | LOW | Semantic indexing, re-ranking |
| `apex-maintenance` | BACKGROUND | Cleanup, archival, health checks |

### Job Schema / Payload Shape

```typescript
interface BullJobData {
  jobType: string;           // e.g. "meta_campaign_sync", "send_email"
  payload: Record<string, any>;
  maxAttempts: number;
  createdAt: string;         // ISO timestamp
}
```

Internal in-memory representation adds: `id`, `status`, `attempts`, `startedAt`, `completedAt`, `error`, `result`.

### Concurrency Settings

- BullMQ worker: **5 concurrent jobs** (`MAX_CONCURRENT = 5` in `legacyAdapter.ts`)
- In-memory fallback: same 5-concurrent cap

### Dead Letter / Retry Config

Per tier (set in `queueFactory.ts`):

| Tier | Attempts | Backoff type | Initial delay | Keep-on-complete | Keep-on-fail |
|---|---|---|---|---|---|
| HIGH | 5 | exponential | 2 s | 500 | 2,000 |
| MEDIUM | 3 | exponential | 5 s | 200 | 1,000 |
| LOW | 3 | exponential | 30 s | 100 | 500 |
| BACKGROUND | 2 | fixed | 60 s | 50 | 200 |

BullMQ re-throws handler errors so failed jobs land in BullMQ's failed set (not a separate DLQ). Failed jobs are retained per the `removeOnFail` count above.

> **Note:** The Sentinel crash pipeline (see §2) does NOT use BullMQ. It runs its own polling loop directly against the `crash_reports` Postgres table as a custom job queue using row-level locking (`lockedAt` / `lockedBy` columns).

---

## 2. Worker Flows

### CrashReportWorker (`server/crashReportWorker.ts`)

**Started by:** `index.ts` calls `startCrashReportWorker()` at boot.

**Poll interval:** Every **5 minutes** (`WORKER_INTERVAL_MS = 5 * 60 * 1000`).

**Full flow per tick:**

1. Re-entrance guard: if previous tick is still running, skip.
2. Check FLHSMV health status. If `blocked` or `down`, enter 2-minute cooldown then demote to `degraded` so next tick can probe.
3. Reset stuck jobs: any `crash_reports` row with `lockedAt` older than 15 minutes is released back to PENDING.
4. **drainQueue loop** (up to 50 batches × 5 = 250 jobs per tick):
   a. `getAndLockPendingReports(5, WORKER_ID)` — atomically locks up to 5 PENDING rows.
   b. For each locked row → `processReport(reportId, reportNumber)`.
   c. If FLHSMV health degrades mid-drain, stop immediately.
   d. 500 ms delay between batches.
5. Recovery sweep: on first tick after FLHSMV recovers from unhealthy state, reset FAILED rows back to PENDING via `recoverFailedCrashReports()`.
6. Every 12th tick: log a backlog diagnostic (pending follow-up count, max service failure count).

**Per-report flow inside `processReport()`:**

1. Load crash report from DB. Check 14-day age limit → if exceeded, set `AWAITING`.
2. Determine search path by `source`:
   - `sentinel_followup`: search FLHSMV by county + crash date (`searchReportByCountyDate`), score candidates (highway match +40, mile marker +25, street word overlap +20, GPS distance +10, time within 30 min +5), require score ≥ 20 (`MIN_MATCH_SCORE`).
   - Any other source: search FLHSMV by `reportNumber` directly (`searchReport`).
3. If `not_found`: increment `retryCount`. Under `MAX_RETRIES` (5) → keep PENDING. At limit → `NOT_FOUND`.
4. If `upstream_error` or `network_error`: increment `serviceFailureCount`. Under `MAX_SERVICE_FAILURES` (20) → keep PENDING. At limit → `FAILED`.
5. If found: fetch full detail via `fetchReportDetail(reportNumber)`.
6. Detail fetch failure: same service failure counter logic.
7. On success:
   - Write `status = "COMPLETED"`, store `searchResult` + `detail` in `data` JSONB.
   - For `sentinel_followup`: validate and atomically link back to `sentinel_auto` parent via `mergeCrashReportData()` (sets parent status to `COMPLETED` in the same write). Fan-out FLHSMV data to any sibling duplicate sentinel rows.
   - Fire `enrichCrashLeadContacts()` (async, fire-and-forget).
   - Report telemetry to Apex Intelligence (fire-and-forget).

**FLHSMV session management:** Session cookies cached for 5 minutes (`SESSION_TTL_MS`). Refreshed via a HEAD request to `crashreportrequest/` on expiry or on 401/403.

**FLHSMV proxy:** All FLHSMV requests route through ScrapingBee when `SCRAPINGBEE_API_KEY` is set (see §7).

### RetroSkipTrace Scheduler (`server/retroSkipTrace.ts`)

**Started by:** `index.ts` calls `startRetroSkipTraceScheduler()` at boot.

**Schedule:** Runs once **2 minutes after boot**, then every **6 hours**.

**Flow:**

1. Query all non-archived sub-accounts. Include account if it has `sentinel_config.enabled = true` OR its ID is in `CRASH_LEAD_ACCOUNT_IDS` (3, 4).
2. For each eligible account:
   - Load up to 5,000 contacts.
   - Filter: must have `crash-lead` or `sentinel-auto` tag, no `skip-traced` tag, no phone, has an address, `skipTraceStatus` is `not_attempted` or `pending`.
   - Process in **batches of 10** with **2-second delays** between batches.
   - Each contact: call `skipTraceLookup()` via BatchData. On match → `updateContactSkipTrace()` (adds `skip-traced` + `has-phone` tags, updates status to `matched`). On no match → status `no_match`. On fail → `failed`.
   - `runRetroSkipTrace()` returns `RetroStats`.

**Requires:** `BATCHDATA_API_KEY` (or legacy `BATCH_DATA`). Exits silently if missing.

### RetroFLHSMVEnrich (`server/retroFLHSMVEnrich.ts`)

**Trigger:** Admin-only HTTP POST to `/api/internal/retro-flhsmv-enrich` with `x-admin-secret` header. Fire-and-forget (responds immediately, runs in background).

**Flow:**

1. Require `SCRAPINGBEE_API_KEY`. Exit gracefully if absent.
2. Query DB for crash_reports where `status = 'COMPLETE'` AND `official_report_number IS NOT NULL` (up to `limit`, default 500).
3. Process in **batches of 3** with **4-second delays** between batches.
4. For each row: call `fetchReportDetail(officialReportNumber)` through ScrapingBee.
5. On success: call `enrichCrashLeadContacts()` — same function used by the main worker. Idempotent via `upsertContact`.

**Purpose:** Back-fills driver name/address on contacts that were created as placeholders before FLHSMV data was available.

---

## 3. Ingestion Flows

### Sentinel Auto Ingest (`server/crashIngestPipeline.ts`)

**What it does:** Polls the FHP HSMV live feed (via `fetchFHPHSMVFeedSafe()` in `server/sentinel.ts`) every **5 minutes** and inserts new crash incidents into `crash_reports`.

**Qualifying criteria for leads:**
- `incident.type` must contain one of: `INJUR`, `FATAL`, `ENTRAP`, `EXTRICAT`, `TRAUMA`, `ROLLOVER`, `HIT AND RUN`, `H&R`, `HIT & RUN`, `PEDESTRIAN`, `BICYCLE`, `MOTORCYCLE`, `SIGNAL 4`, `SIGNAL4`, `CRITICAL`
- `incident.severity` must be `critical` or `high`

**Dedup logic (two levels):**

1. **Primary:** SHA-256 hash of `{id}|{type}|{received}|{location}` → synthetic `reportNumber` = `SENTINEL-{16 hex chars}`. If `getCrashReportByNumber()` returns a row → skip.
2. **Secondary:** FHP incident `id` lookup via `getSentinelAutoCrashReportByFhpIncidentId()`. Catches re-sent incidents where the FHP feed mutates fields (changing `received` timestamp etc.), producing a different primary hash but the same underlying event. Logged as `countSkippedDuplicateFhpId`.

**What gets written to `crash_reports` at ingest:**

```
status:         "AWAITING"
source:         "sentinel_auto"
subAccountId:   defaultSubAccountId (first sub-account in DB, or 1)
processedToLead: false (or true if non-qualifying — skip retry)
retryCount:      0
serviceFailureCount: 0
rawPayload:     { id, type, location, lat, lng, severity, ... }
data:           { type, location, county, lat, lng, severity, received, remarks, googleMaps, source, state, fetchedAt, ingestTraceId, qualifiesForLead }
ingestTraceId:  UUID (12-char, per poll cycle)
```

**Contact creation at ingest time:**

For qualifying incidents, `createLeadFromCrash()` is called immediately:
- Builds a placeholder name: `"Unidentified Crash Incident — {COUNTY}"`
- Checks if location looks like a highway pattern. If yes, **skips skip-trace** (BatchData will return no_match on highway addresses 100% of the time).
- If address is residential and `BATCHDATA_API_KEY` is set: calls `skipTraceLookup()` and populates real name/phone/email if found.
- Calls `upsertContact()` for **every active crash-enabled account** (fan-out).
- Sends SMS alert to account owner phones (rate-limited to once per 15 minutes per account).
- Calls `storage.markCrashReportAsLead(reportId)` to set `processedToLead = true`.

**Lead recovery pass:** Runs every **60 minutes**. Finds `sentinel_auto` rows with `processedToLead = false`. Retries `createLeadFromCrash()` up to `LEAD_RECOVERY_MAX_RETRIES` (3) times.

### Sentinel Follow-up Jobs

**What they are:** A `sentinel_followup` source crash_reports row with `reportNumber = "FLHSMV-FOLLOWUP-{FHP_INCIDENT_ID}"`. Created (by code not in the files read) when the sentinel auto ingest creates a `sentinel_auto` row and queues a follow-up to search FLHSMV for the official report number.

**How the worker processes them:** The CrashReportWorker detects `source === "sentinel_followup"` and uses county + crash date discovery (`searchReportByCountyDate`) instead of a direct report number lookup. The `data` JSONB on the follow-up row must contain `county`, `crashDate`, and optionally `lat`, `lng`, `received` for scoring, plus `sentinelReportId` and `sentinelReportNumber` for linkback.

### Manual Crash Report Requests

`source = "manual"` (or other non-sentinel sources). The report number is a real FLHSMV report number entered by a user. The worker calls `searchReport(reportNumber)` directly, then `fetchReportDetail()`. No follow-up linkback needed.

### Contact Creation: Ingest Time vs Enrichment Time

| Stage | When | What |
|---|---|---|
| Ingest time | During `createLeadFromCrash()` | Placeholder name, crash-scene address, severity tags, optional skip-trace if non-highway |
| FLHSMV enrichment | After worker completes report, `enrichCrashLeadContacts()` | Real driver name + home address from official report, plate tag, DHSMV registration note, skip-trace on home address |
| Retro passes | Admin-triggered | Same enrichment, applied retroactively to existing records |

---

## 4. Routing Logic

### `getActiveAccountIds()` — `server/crashIngestPipeline.ts`

Called before every fan-out of crash leads. Cached for **5 minutes** in module-level variables.

**Logic:**

1. Load all sub-accounts from DB.
2. For each active sub-account: call `getSentinelConfig(account.id)`.
3. Include account if `config.enabled === true` AND `config.niche` is `"accident"` or `"crash"`.
4. **Fallback:** if no accounts are configured, fall back to hard-coded IDs `[GIOVANNI_ACCOUNT_ID (4), APEX_MAIN_ACCOUNT_ID (3)]`.

### `CRASH_LEAD_ACCOUNT_IDS` Set — `server/vendorConfig.ts`

```typescript
export const CRASH_LEAD_ACCOUNT_IDS = new Set<number>([3, 4]);
```

Used in `runRetroSkipTraceAllAccounts()` to unconditionally include accounts 3 and 4 in retro skip-trace runs, even if their `sentinel_config` is absent or disabled.

### Account IDs That Receive Crash Leads

| ID | Name | Basis |
|---|---|---|
| 3 | Apex Marketing Automations (platform owner) | `APEX_MAIN_ACCOUNT_ID` hard-coded + `CRASH_LEAD_ACCOUNT_IDS` |
| 4 | Crash Connect — Giovanni | `GIOVANNI_ACCOUNT_ID` hard-coded + `CRASH_LEAD_ACCOUNT_IDS` |
| Additional | Any sub-account with `sentinel_config.enabled = true` AND `niche = "accident"` or `"crash"` | Dynamic via `getActiveAccountIds()` |

### `subAccountId` Resolution by Source

| Source | `subAccountId` on `crash_reports` row | `subAccountId` for contacts |
|---|---|---|
| `sentinel_auto` | `defaultSubAccountId` (first sub-account in DB, or `1`) | All accounts returned by `getActiveAccountIds()` (fan-out) |
| `sentinel_followup` | Copied from parent `sentinel_auto` row at queue time | Scoped to `report.subAccountId` only (not fan-out) |
| `manual` | Set by the requesting user's sub-account | Same as above |

---

## 5. Account / Subaccount Structure

### Hierarchy

```
Owner (users table)
  └── SubAccount (sub_accounts table, id = integer)
        ├── sentinelConfig (sentinel_config table, FK sub_account_id)
        ├── contacts
        ├── messages
        ├── workflows
        └── ... (all CRM entities are scoped to sub_account_id)
```

### Sentinel Config Per Subaccount

Table: `sentinel_config` (FK `sub_account_id`)

Key fields:
- `enabled` (boolean): gates whether sentinel leads are delivered to this account
- `niche` (text): must be `"accident"` or `"crash"` for crash leads; other values (e.g. `"roofing"`, `"beauty"`) exclude the account from crash lead fan-out

The platform explicitly guards against non-crash accounts receiving crash leads in `getActiveAccountIds()`:
> "Only deliver crash leads to accounts that have Sentinel ENABLED with niche=accident. Roofing, beauty, home service accounts must never receive crash leads in their CRM."

### Unconditional Crash Lead Accounts

Accounts 3 and 4 receive crash leads even if their `sentinel_config` is absent or has `enabled = false`. This is the fallback in `getActiveAccountIds()` and the unconditional include in `runRetroSkipTraceAllAccounts()`.

### Plan / Feature Gating for Sentinel

Sentinel feature availability is gated via `sentinel_config.enabled`. There is no higher-level subscription plan gate in the files read — `enabled` on the config row is the sole gate. Accounts without a `sentinel_config` row are excluded from crash leads.

---

## 6. Environment Variables

| Variable | Purpose | Owner/Service | Required | Default |
|---|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Railway (Postgres) | Yes | None |
| `UPSTASH_REDIS_URL` | Redis connection for BullMQ job queues | Upstash (Railway add-on) | No (falls back to in-memory) | None |
| `SCRAPINGBEE_API_KEY` | ScrapingBee proxy credentials for FLHSMV requests | ScrapingBee | Strongly recommended (FLHSMV IP-blocks direct egress) | None |
| `SCRAPINGBEE_MODE` | Proxy tier: `"premium"` (~10 credits/req) or `"stealth"` (~75 credits/req) | ScrapingBee | No | `"premium"` |
| `BATCHDATA_API_KEY` | BatchData skip-trace API key | BatchData | No (skip-trace silently disabled) | None |
| `BATCH_DATA` | Legacy alias for `BATCHDATA_API_KEY` | BatchData | No | None |
| `NIMBLE_API_USERNAME` | Nimble Pipeline API username | Nimble | No (DHSMV reg lookup skipped if missing) | None |
| `NIMBLE_API_PASSWORD` | Nimble Pipeline API password | Nimble | No | None |
| `NIMBLE_PROXY_USERNAME` | Nimble residential proxy username | Nimble | No | None |
| `NIMBLE_PROXY_PASSWORD` | Nimble residential proxy password | Nimble | No | None |
| `APIFY_API_KEY` | Apify scraping token | Apify | No (scrapers silently disabled) | None |
| `APIFY_TOKEN` | Legacy alias for `APIFY_API_KEY` | Apify | No | None |
| `APIFY_KEY` | Legacy alias for `APIFY_API_KEY` | Apify | No | None |
| `TWILIO_ACCOUNT_SID` | Twilio account identifier | Twilio | No (SMS disabled) | None |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | Twilio | No | None |
| `TWILIO_PHONE_NUMBER` | Default Twilio outbound number | Twilio | No | None |
| `STRIPE_API_SECRET` | Stripe secret key for subscriptions | Stripe | No (billing disabled) | None |
| `OPENAI_APEX_INT_KEY` | OpenAI API key for AI features | OpenAI | No | None |
| `COURTLISTENER_API_TOKEN` | CourtListener legal research token | CourtListener | No (free tier used) | None |
| `STANDALONE_ADMIN_SECRET` | Secret for admin-only internal endpoints | Platform | No | `"201120062017"` |
| `NODE_ENV` | Environment flag | Railway | No | `"development"` |
| `APEX_PARENT_ACCOUNT_ID` | Parent account ID for telemetry | Platform | No | `3` |

---

## 7. Provider Ownership

### FLHSMV (Florida Highway Safety and Motor Vehicles)

- **What it provides:** Official crash report search (`/CRRService/api/CrashReport/SearchReport`) and full detail (`/CRRService/api/CrashReport/GetReport`).
- **How accessed:** HTTP POST/GET to `services.flhsmv.gov`. Session cookies refreshed by hitting the home page first.
- **File that owns the client:** `server/crashReportWorker.ts` — `flhsmvFetch()`, `refreshSession()`, `searchReport()`, `searchReportByCountyDate()`, `fetchReportDetail()`.
- **IP block situation:** FLHSMV's Akamai edge has been returning cached HTTP 503s to the server's egress IP range. All requests route through ScrapingBee when `SCRAPINGBEE_API_KEY` is set.
- **Session handling:** Cookies cached in module-level variables for 5 minutes. Rotates through 4 User-Agent strings.

### ScrapingBee

- **Credentials:** `SCRAPINGBEE_API_KEY`
- **Mode selection:** `SCRAPINGBEE_MODE` = `"premium"` (default, ~10 credits/request) or `"stealth"` (~75 credits/request, full Akamai + Cloudflare bypass).
- **What it bypasses:** Akamai IP block on FLHSMV services.
- **How it works:** All FLHSMV requests (session refresh, search, detail) are routed through `https://app.scrapingbee.com/api/v1/` with `premium_proxy=true` (or `stealth_proxy=true`). Original request headers are forwarded with `Spb-` prefix via `forward_headers=true`.
- **Used by:** `crashReportWorker.ts` (active worker) and `retroFLHSMVEnrich.ts` (admin-triggered retro job).

### Nimble

- **What it provides:** Two capabilities:
  1. **Pipeline API** (`https://api.nimbleway.com/v1/pipeline`): Managed scraping with JS rendering, CAPTCHA bypass, geo-targeting. Used for DHSMV vehicle registration lookup.
  2. **Residential Proxy** (`gw.nimbleway.com:7000`): Raw proxy access via `nimbleProxyUrl()`.
- **Credentials:** Pipeline uses `NIMBLE_API_USERNAME` + `NIMBLE_API_PASSWORD` (Basic Auth). Proxy uses `NIMBLE_PROXY_USERNAME` + `NIMBLE_PROXY_PASSWORD`.
- **What it's used for:** DHSMV vehicle registration lookup via `server/dhsmvRegistrationLookup.ts`. Given a Florida plate number, queries `services.flhsmv.gov/MVCheckWeb` through Nimble to get registered owner name, mailing address, vehicle year/make/model/color, and registration expiration.
- **File that owns the client:** `server/nimbleClient.ts` — `nimblePipelineFetch()`, `nimbleProxyUrl()`.
- **Graceful degradation:** If Nimble credentials are absent, `lookupRegistration()` returns `{ found: false, error: "Nimble not configured" }` without crashing.

### BatchData

- **What it provides:** Skip-trace — given an address, returns persons associated with that property including names, phone numbers, emails, and mailing addresses.
- **Credentials:** `BATCHDATA_API_KEY` (canonical) or `BATCH_DATA` (legacy alias), resolved via `resolveBatchDataKey()` in `server/vendorConfig.ts`.
- **What triggers it:**
  1. Ingest time (conditional): `createLeadFromCrash()` in `crashIngestPipeline.ts`, only if location does NOT look like a highway address.
  2. FLHSMV enrichment time: `enrichCrashLeadContacts()` in `crashReportWorker.ts`, on driver's home address from official report.
  3. Retro pass: `runRetroSkipTrace()` / `runRetroSkipTraceAllAccounts()` in `retroSkipTrace.ts`.
- **File that owns the client:** `server/skip-trace.ts` (dynamically imported; not read directly but referenced as `skipTraceLookup()`).
- **Current status:** Functional but conservative — ingest-time skip-trace is intentionally suppressed for highway addresses because BatchData returns `no_match` 100% of the time on FHP incident locations (which are always highway references). Real skip-trace happens at FLHSMV enrichment time using the driver's home address.
- **Run tracking:** `recordBatchDataRun(count, source, error)` in `vendorConfig.ts` stores the last run result in memory.

### Twilio

- **Purpose:** SMS messaging — outbound alerts to account owner phones when a new critical crash lead arrives (via `createLeadFromCrash()` → `publishEventAsync(EVENT_TYPES.MESSAGE_SENT, ...)`), plus the platform's full conversational SMS / automation messaging.
- **Credentials:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.
- **Per-account numbers:** Sub-accounts can have their own `account.twilioNumber`; falls back to `TWILIO_PHONE_NUMBER`.

### Apify

- **Purpose:** Web scraping workflows (scrapers, not directly tied to crash pipeline). Credentials: `APIFY_API_KEY`.
- **Status:** Disabled if key is absent (logs error, does not crash).

### Stripe

- **Purpose:** Subscription billing, webhook handling.
- **Credentials:** `STRIPE_API_SECRET`, webhook secret loaded via `getStripeWebhookSecret()`.

### OpenAI

- **Purpose:** AI features (agent conversations, content generation, embeddings).
- **Credentials:** `OPENAI_APEX_INT_KEY`.

### CourtListener

- **Purpose:** Legal research API (case law, dockets).
- **Credentials:** `COURTLISTENER_API_TOKEN` (optional; free tier without token).

---

## 8. Retry Behavior

### CrashReportWorker: Two Separate Failure Counters

The worker distinguishes between two completely different failure types using two separate columns on `crash_reports`:

| Counter | Column | Max | What increments it | Status when maxed |
|---|---|---|---|---|
| `retryCount` | `retry_count` | 5 (`MAX_RETRIES`) | Report not found in FLHSMV system | `NOT_FOUND` |
| `serviceFailureCount` | `service_failure_count` | 20 (`MAX_SERVICE_FAILURES`) | FLHSMV returned HTTP 5xx/4xx/network error | `FAILED` |

**Important:** A report that is being blocked by FLHSMV returning HTTP 503 will have `retry_count = 0` but a climbing `service_failure_count`. This is intentional and the backlog diagnostic log (every 12th tick) makes this visible.

### FLHSMV `fetchWithRetry`

Each individual HTTP call to FLHSMV (inside `fetchWithRetry`) has up to **3 attempts** (0 original + 2 retries) with 2-second linear backoff. On 401/403, forces a session refresh before retrying. Timeout: 30 seconds per request.

### Job Queue Retry Config

BullMQ level (set in `queueFactory.ts` via `defaultJobOptions`): MEDIUM priority queues (including `apex-general`) use **3 attempts** with exponential backoff starting at **5 seconds**.

### 14-Day Auto-Check Window

The worker checks each report's age at the start of `processReport()`:

```typescript
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
if (ageMs > MAX_AGE_MS) {
  // Set status = "AWAITING", add explanation log
}
```

After 14 days, automatic retry stops. The report is set to `AWAITING` with a message explaining that manual retry is available at any time. FLHSMV official reports typically take 3–10 days to appear in the state system.

### Status Transitions by Cause

| Condition | Resulting status |
|---|---|
| Report not found, `retryCount < 5` | `PENDING` (will retry next tick) |
| Report not found, `retryCount >= 5` | `NOT_FOUND` |
| FLHSMV service error, `serviceFailureCount < 20` | `PENDING` (will retry next tick) |
| FLHSMV service error, `serviceFailureCount >= 20` | `FAILED` |
| Report is older than 14 days | `AWAITING` |
| FLHSMV returned report + detail successfully | `COMPLETED` |

---

## 9. Incident Lifecycle

### State Machine for `crash_reports` Rows

```
                ┌──────────────────────────────────────────────────────────────┐
                │                                                              │
 sentinel_auto  │  AWAITING  ──────────────────────────────────────────────►  │
 inserts here   │                (no FLHSMV data yet, just CAD ping)          │
                │                                                              │
                └──────────────────────────────────────────────────────────────┘
                                         │
                         follow-up worker links FLHSMV data
                                         │
                                         ▼
PENDING ◄─── not found (retryCount < 5) ─┬─ found → COMPLETED
             service error (failCount<20) │
                                          │
             NOT_FOUND ◄─ not found, 5   │
             FAILED ◄─── service error, 20│
             AWAITING ◄─ age > 14 days    │
```

Full state transition table:

| From | Condition | To |
|---|---|---|
| Any | Ingest of new sentinel_auto incident | `AWAITING` |
| Any | Manual/follow-up queued, worker picks up | Worker sets `PROCESSING` implicitly via row lock |
| PENDING | FLHSMV search found + detail fetched | `COMPLETED` |
| PENDING | FLHSMV not_found, retryCount < MAX_RETRIES | `PENDING` (incremented retryCount) |
| PENDING | FLHSMV not_found, retryCount >= MAX_RETRIES | `NOT_FOUND` |
| PENDING | FLHSMV upstream/network error, serviceFailureCount < MAX_SERVICE_FAILURES | `PENDING` (incremented serviceFailureCount) |
| PENDING | FLHSMV upstream/network error, serviceFailureCount >= MAX_SERVICE_FAILURES | `FAILED` |
| PENDING | Age > 14 days | `AWAITING` |
| FAILED | Admin calls `recoverFailedCrashReports()` or recovery sweep | `PENDING` |
| AWAITING | sentinel_auto parent, follow-up worker atomically merges FLHSMV data | `COMPLETED` |

### sentinel_auto vs sentinel_followup Source Differences

| Aspect | `sentinel_auto` | `sentinel_followup` |
|---|---|---|
| Created by | `crashIngestPipeline.startCrashIngestPipeline()` | Queued after sentinel_auto insert (code outside read files) |
| Initial status | `AWAITING` (not PENDING) | `PENDING` |
| `reportNumber` | `SENTINEL-{sha256}` of FHP incident metadata | `FLHSMV-FOLLOWUP-{FHP_INCIDENT_ID}` |
| FLHSMV search method | N/A — parent waits for follow-up worker | County + date discovery with scoring |
| Completed by | Atomically by follow-up worker via `mergeCrashReportData()` | `processReport()` sets its own status to COMPLETED |
| `processedToLead` | Set to `true` by `createLeadFromCrash()` | Always `false` (follow-ups are not leads themselves) |

### `processedToLead` Flag

`crash_reports.processedToLead` (boolean):
- `false` at insert for qualifying incidents (lead creation happens in parallel and sets it `true`)
- `true` for non-qualifying incidents at insert (skipped immediately)
- Set to `true` by `markCrashReportAsLead()` after successful contact fan-out
- Used by the lead recovery pass to find rows still needing `createLeadFromCrash()`

---

## 10. Enrichment Lifecycle

### Stage 1: Ingest-Time (in `createLeadFromCrash()`)

Written to contact at first `upsertContact()` call:
- `firstName`/`lastName`: placeholder `"Unidentified Crash Incident — {COUNTY}"` (or real name if skip-trace found one)
- `address`: FHP incident location (highway reference)
- `city`: `"{County} County"`
- `state`: `"FL"`
- `source`: `"sentinel_crash"`
- `channel`: `"sentinel"`
- `leadVertical`: `"personal_injury"`
- `leadSubtype`: `"crash"`
- `tags`: `["crash-lead", "sentinel-auto", "{severity}"]`, plus `"has-phone"` / `"no-phone"` / `"skip-traced"` if BatchData ran
- `sourceExternalId`: `"crash:{reportNumber}:acct{accountId}"`
- `rawSourceType`: `"flhsmv_hsmv_cad"`

**Skip-trace (conditional):** Only if location is NOT a highway pattern AND `BATCHDATA_API_KEY` is set. Suppressed for highway addresses (FHP locations are always highway references).

### Stage 2: FLHSMV Worker Enrichment (`enrichCrashLeadContacts()`)

Called after `processReport()` completes. Uses driver's HOME address from official FLHSMV report:

- Real driver name replaces placeholder if contact still has placeholder
- `address`: driver's home address (replaces highway address)
- `skipTraceStatus`: updated to `matched`/`no_match`/`failed`/`not_attempted`
- Tags added: `"flhsmv-enriched"`, `"plate:{STATE}-{PLATE}"`, `"dhsmv-registration-found"` (if lookup succeeded), `"has-phone"` / `"no-phone"` / `"skip-traced"` (if BatchData ran)
- `rawSourceType`: updated to `"flhsmv_official"`
- Notes appended with: official report number, driver name + address, crash metadata, insurance company, plate/tag, DHSMV registration info, skip-trace summary

### Stage 3: DHSMV Registration Lookup (inside `enrichCrashLeadContacts()`)

If the crash report has a plate number:
- Calls `lookupRegistration(plate, state)` via Nimble Pipeline API to query `services.flhsmv.gov/MVCheckWeb`.
- Returns: registered owner name, mailing address, vehicle year/make/model/color, registration expiration.
- **Note:** Registered owner may differ from driver (spouse, employer vehicle, rental).
- Result appended to contact notes as `"DHSMV Registration (plate {plate}): ..."`.
- Tag `"dhsmv-registration-found"` added to contact if lookup succeeded.
- Graceful degradation: skipped silently if Nimble credentials absent.

### Stage 4: Skip-Trace (BatchData, inside `enrichCrashLeadContacts()`)

If `BATCHDATA_API_KEY` is set AND driver's home address is available AND address does NOT look like a highway:
- Calls `skipTraceLookup({ address: driverHomeAddress, state: "FL", city: ... })`.
- Updates `skipTraceStatus`, adds `"skip-traced"` / `"has-phone"` / `"no-phone"` tags.
- Notes include all persons found with all phones/emails.

### Stage 5: Retro Passes

Two admin-triggered retro sweeps:

**`retroFLHSMVEnrich`** (POST `/api/internal/retro-flhsmv-enrich`):
- For all COMPLETE crash_reports with `official_report_number`, re-fetches FLHSMV detail and calls `enrichCrashLeadContacts()`.
- Fixes contacts that were created as placeholders before FLHSMV data was available.

**`retroSkipTrace`** (POST `/api/internal/retro-skip-trace` or scheduled every 6h):
- For all contacts with `crash-lead`/`sentinel-auto` tag, no phone, an address, and `skipTraceStatus` not yet completed.
- Calls BatchData skip-trace on each eligible contact.

### Contact Dedup Key Format

Primary dedup key (strongest): `sourceExternalId` = `"crash:{reportNumber}:acct{accountId}"`

Example: `"crash:SENTINEL-A3F8C2D1E4B56789:acct4"`

Secondary dedup keys (within same sub-account):
1. `normalizedPhone` (digits only, min 7 digits)
2. `normalizedEmail` (lowercase, trimmed)

### Tags Added at Each Stage

| Tag | Added at |
|---|---|
| `crash-lead` | Ingest time |
| `sentinel-auto` | Ingest time |
| `{severity}` (e.g. `"critical"`) | Ingest time |
| `skip-traced` | Skip-trace (any stage) |
| `has-phone` | Skip-trace match |
| `no-phone` | Skip-trace no_match |
| `flhsmv-enriched` | FLHSMV Stage 2 |
| `plate:{STATE}-{PLATE}` | FLHSMV Stage 2 (if plate number found) |
| `dhsmv-registration-found` | DHSMV Stage 3 (if lookup succeeded) |

---

## 11. Deployment Procedures

### Platform

Railway (managed container hosting). Each git push to the default branch triggers a Railway build and deploy.

### Environment Variables

Managed in the Railway dashboard under the service's Variables tab. Never committed to source code. `vendorConfig.ts` is the single authoritative resolver for all vendor credentials — always import from there, never read `process.env` directly for vendor keys.

### Migration Strategy

**Two migration layers:**

1. **Drizzle-kit schema migrations** (`shared/schema.ts` → `drizzle.config.ts`). Standard ORM-managed DDL. Run via `npm run db:push` or `drizzle-kit migrate`. These define the canonical schema.

2. **Boot-time data migrations** (`server/dataMigrations.ts` → `runDataMigrations()`). Idempotent SQL fixes that must run BEFORE Drizzle synchronizes the schema (e.g. deduplication before adding a unique constraint). Registered in the `MIGRATIONS` array.
   - Only run in production (`NODE_ENV === "production"`).
   - Called from `index.ts` during startup.
   - Each migration is tracked in `_data_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)`.
   - Protected by `pg_try_advisory_xact_lock` to prevent concurrent application across multiple Railway instances.

### Branch → PR → Railway Preview → Merge → Production Flow

1. Create a feature branch.
2. Open a PR. Railway creates a preview deployment from the PR branch.
3. Verify in preview (env vars copied from production or set per-preview).
4. Merge PR to main → Railway automatically deploys to production.
5. Boot-time data migrations run automatically on the new production container.

### How to Trigger Retro Jobs (Admin Endpoints)

```bash
# Retro skip-trace — all accounts
curl -X POST https://<domain>/api/internal/retro-skip-trace \
  -H "x-admin-secret: <STANDALONE_ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{}'

# Retro skip-trace — single account
curl -X POST https://<domain>/api/internal/retro-skip-trace \
  -H "x-admin-secret: <STANDALONE_ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"subAccountId": 4}'

# Retro FLHSMV enrichment
curl -X POST https://<domain>/api/internal/retro-flhsmv-enrich \
  -H "x-admin-secret: <STANDALONE_ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"limit": 500, "dryRun": false}'
```

Both endpoints respond immediately and run in the background (fire-and-forget). Monitor Railway logs for `[RETRO-SKIP-TRACE]` and `[RETRO-FLHSMV]` prefixes.

Default `STANDALONE_ADMIN_SECRET` is `"201120062017"` — set a real secret in Railway.

---

## 12. Failure Recovery

### FLHSMV IP Block Recovery (ScrapingBee Fallback)

If FLHSMV starts returning HTTP 503 (or 401/403/429):
1. `recordFailure(statusCode, msg)` is called, which sets `healthStatus.status = "blocked"` (for 401/403/429) or `"down"` (for 502/503).
2. Worker enters 2-minute cooldown (`COOLDOWN_DURATION_MS`).
3. After cooldown expires, status is demoted to `"degraded"` so the next tick runs a probe request.
4. If FLHSMV recovers → `recordSuccess()` sets status back to `"ok"` → `runRecoverySweep()` resets any FAILED rows back to PENDING.

**Immediate action:** Set `SCRAPINGBEE_API_KEY` in Railway env vars if not already set, or switch `SCRAPINGBEE_MODE` from `"premium"` to `"stealth"` if premium proxies are being blocked.

### What Happens When BatchData Is Exhausted

`resolveBatchDataKey()` returns `null` if `BATCHDATA_API_KEY` is empty. All callers guard against null:
- `createLeadFromCrash()`: skips skip-trace, contact created as placeholder.
- `enrichCrashLeadContacts()`: skips BatchData step, notes have no phone data.
- `runRetroSkipTrace()`: logs error and returns `{ processed: 0, ... }` immediately.

Contacts remain in `skipTraceStatus = "not_attempted"` and can be retroactively skip-traced when the key is renewed.

### What Happens When Nimble Is Not Configured

`isNimbleConfigured()` returns `false` if `NIMBLE_API_USERNAME` or `NIMBLE_API_PASSWORD` is missing. `lookupRegistration()` returns `{ found: false, error: "Nimble not configured" }`. The `enrichCrashLeadContacts()` caller wraps this in a try/catch and continues — the tag `"dhsmv-registration-found"` is simply not added.

### Recovery Sweep (`runRecoverySweep()`)

Called automatically on the first worker tick after FLHSMV health transitions from unhealthy back to `"ok"`. Calls `storage.recoverFailedCrashReports(MAX_RETRIES)` which resets FAILED rows (where `retryCount < MAX_RETRIES`) back to PENDING so they will be picked up on the next tick.

Also triggerable manually via the admin UI (not documented in read files, but the storage method is exposed).

### Manual Retry via UI

Crash reports in `AWAITING`, `FAILED`, or `NOT_FOUND` status can be manually retried via the UI (sets the row back to `PENDING`). The CrashReportWorker will pick it up on the next 5-minute tick.

---

## 13. Schema Migrations

### Migration System: How It Works

Boot-time idempotent SQL, registered in `server/dataMigrations.ts`:

```typescript
const MIGRATIONS: DataMigration[] = [
  { name: "YYYY-MM-DD-descriptive-name", sql: `...` },
  // ...
];
```

**Execution flow:**
1. On boot (production only), `runDataMigrations()` is called from `index.ts`.
2. Creates `_data_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)` if it doesn't exist.
3. For each migration: check if `name` exists in `_data_migrations`. If yes, skip.
4. If not applied: acquire `pg_try_advisory_xact_lock(7421430021)` inside a transaction.
5. Re-check (double-check pattern against TOCTOU race).
6. Execute the SQL with `tx.execute(sql.raw(migration.sql))`.
7. Insert into `_data_migrations`.
8. Commit.

**Advisory lock key:** `7421430021` — ensures only one Railway instance applies a given migration even during rolling deployments.

### Migration List

| Migration ID | What It Does |
|---|---|
| `2026-04-25-dedupe-apex-module-coverage` | Deduplicates `apex_module_coverage` rows by `(account_id, module_group)`, then creates a unique index to prevent future duplicates |
| `2026-05-13-standalone-card-leads` | Creates `standalone_card_leads` table with `card_id`, `name`, `phone`, `email`, `message`, `owner_notes` columns |
| `2026-05-13-standalone-card-leads-owner-notes` | Adds `owner_notes TEXT` column to `standalone_card_leads` (additive, `ADD COLUMN IF NOT EXISTS`) |
| `2026-05-13-standalone-card-services` | Adds `services JSONB DEFAULT '[]'` column to `standalone_cards` |
| `2026-05-14-contact-lifecycle-fields` | Adds 12 new columns to `contacts`: `identity_status`, `skip_trace_status`, `enrichment_provider`, `enrichment_attempted_at`, `enrichment_completed_at`, `enrichment_confidence`, `source_external_id`, `raw_source_type`, `lead_vertical`, `lead_subtype`, `normalized_phone`, `normalized_email`, `county`, `contact_quality_score`. Creates 5 indexes. Backfills `skip_trace_status` from existing tags, backfills `identity_status`, backfills `normalized_phone` |
| `2026-05-14-users-role-column` | Adds `role VARCHAR(20) NOT NULL DEFAULT 'member'` to `users` |
| `2026-05-14-stage3-operational-tables` | Creates 16 new operational tables including `account_tier_history`, `admin_audit_log`, `api_keys`, `agent_outcome_log`, `twilio_account_registry`, `embedding_store` (with pgvector HNSW index), `contact_ai_profiles`, `contact_merge_log`, `enrichment_provider_log`, `message_delivery_log`, `sentinel_actions`, `sentinel_incident_ai_triage`, `legal_lead_delivery_log`, `home_service_signal_scores`, `legal_case_ai_summary`, `workflow_ai_suggestions`, `brain_learning_feedback`, `agent_performance_metrics`, `funnel_analytics`, `ad_performance_ai_insights`, `distribution_performance` |
| `2026-05-15-contact-routing-fields` | Adds routing columns to `contacts` (`source_pipeline`, `lead_type`, `route_rule_id`, `route_reason`, `export_eligible`). Creates `contact_routing_rules` and `contact_routing_audit` tables. Seeds 3 default routing rules. Backfills `source_pipeline` and `lead_type` from existing contact data. Backfills `export_eligible` |
| `2026-05-15-stage3-recovery-and-skip-trace-observability` | Recovery/idempotent re-creation of all Stage 3 tables (safe `IF NOT EXISTS`). Creates `skip_trace_requests` and `contact_enrichment_events` tables with supporting indexes |
| `2026-05-15-crash-reports-official-number` | Adds `official_report_number TEXT` column to `crash_reports`. Creates index. Backfills from 3 paths: `data->'officialFlhsmv'->>'reportNumber'`, `data->'searchResult'->>'ReportNumber'`, and `data->>'discoveredReportNumber'` |
| `2026-05-15-contacts-flhsmv-enriched-tag` | Adds `driver_address TEXT` column to `contacts`. Creates partial index on `contacts (sub_account_id, skip_trace_status)` for contacts awaiting FLHSMV-sourced skip-trace |

### How to Add a New Migration Safely

1. Append a new `DataMigration` object to the `MIGRATIONS` array in `server/dataMigrations.ts`.
2. Use a unique `name` in format `YYYY-MM-DD-descriptive-name`.
3. Write the SQL defensively: use `IF NOT EXISTS`, `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING` everywhere to make it fully idempotent.
4. Do NOT modify existing migrations — they have already been applied and the tracking table will skip them.
5. Test in a dev/preview environment first (migrations only run in `production`; in dev, use `scripts/run-data-migrations.ts` to run manually).
6. Deploy — migrations run automatically at boot time before routes are registered.

### Rollback Strategy

**There is no automated rollback.** The migration system is append-only and forward-only:

- Applied migrations cannot be un-applied via the migration system.
- To undo a migration, write a new migration that reverses the change (e.g., `DROP COLUMN IF EXISTS`, `DROP TABLE IF EXISTS`, `DROP INDEX IF EXISTS`).
- The advisory lock prevents concurrent application but provides no rollback capability.
- For destructive changes (dropping columns/tables), always take a database snapshot (Railway provides point-in-time backups) before deploying.
