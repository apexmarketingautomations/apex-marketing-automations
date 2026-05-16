# Apex Platform — Intelligence Architecture

> Apex is an **AI-first legal and property intelligence platform**.
> It does not collect leads. It observes the physical world, reasons about what matters,
> and autonomously surfaces actionable opportunities to attorneys, contractors, and service firms.
>
> **Deployment:** Railway (Node.js + Postgres + Upstash Redis)
> **Language:** TypeScript throughout — server, client, shared schema

---

## The Model

```
SIGNAL LAYER          Raw world events (crashes, permits, arrests, weather...)
      ↓
INCIDENT LAYER        Organized, deduplicated, severity-scored real-world events
      ↓
ENRICHMENT LAYER      Signal → Person/Entity (BatchData, Nimble, FLHSMV, OCR...)
      ↓
CONTACT LAYER         Verified, actionable humans/businesses enter the CRM
      ↓
OPPORTUNITY LAYER     AI determines what is worth acting on and scores it
      ↓
WORKFLOW LAYER        Routing, campaigns, follow-ups, team assignments
      ↓
DOCUMENT LAYER        PDFs, police reports, intake docs, evidence lineage
      ↓
SEMANTIC/MEMORY       pgvector embeddings, AI memory, cross-case intelligence
      ↓
OBSERVABILITY         Redis, BullMQ, Sentry, workers, retries — keeps it stable
```

---

## Layer 1 — Signal Layer

**What it is:** Raw incoming activity from the physical world. Not contacts. Not leads. Events.

**Signal sources currently active:**

| Signal | Source | Ingest file |
|---|---|---|
| Vehicle crashes | FHP CAD / FLHSMV API | `crashIngestPipeline.ts` |
| Arrests / bookings | County jail systems | `arrestIngestPipeline.ts`, `jailBookingPipeline.ts`, `countyBookingScrapers.ts` |
| Court filings | CourtListener API, Hillsborough | `courtFilingPipeline.ts`, `courtListenerPipeline.ts`, `hillsboroughCourtFilingsPipeline.ts` |
| Property activity | Property Radar | `property-radar.ts`, `homeServiceSignalPipeline.ts` |
| Home service signals | Weather, permits, NOAA | `sentinel-home-svc.ts` |
| Legal signals | OSHA, FDA, CPSC, DBPR | `legalSignalPipeline.ts` |
| Meta ad activity | Facebook/Instagram campaigns | `metaCampaignSync.ts` |
| Transport signals | Apify scrapers | `apifyTransportScraper.ts` |

**Key principle:** Signals are **never contacts**. A crash at I-75 MM 131 is a signal. A named injury victim with a phone number is a contact. These are different things stored in different tables.

**Signal dedup:** Each signal is fingerprinted (SHA-256 of location + time + type) before writing to prevent duplicate ingest from multiple upstream sources.

---

## Layer 2 — Incident Layer

**What it is:** Signals organized into real-world incidents with full intelligence context.

**Core tables:** `crash_reports`, `sentinel_incidents`, `propertyLeads`, `sentinelConfig`

**Crash incident lifecycle (most mature pipeline):**

```
FHP CAD feed
  → crashIngestPipeline.ts detects new incident
  → SHA-256 dedup check (reportNumber = SENTINEL-<hash>)
  → crash_reports row created (status: AWAITING)
  → sentinel_incidents row created (for UI/geofence/alerting)
  → CrashReportWorker picks up the job
  → FLHSMV search → official report number confirmed
  → officialReportNumber column populated
  → Full FLHSMV detail fetched (driver, vehicles, narrative, injuries)
  → status: COMPLETE
```

**Status state machine (crash_reports.status):**

| Status | Meaning | Next transition |
|---|---|---|
| `AWAITING` | Just ingested, not yet processed | Worker picks up → PROCESSING |
| `PENDING` | Manual request queued | Worker picks up → PROCESSING |
| `PROCESSING` | Worker actively running | COMPLETE / FAILED / NOT_FOUND |
| `COMPLETE` | FLHSMV data confirmed and stored | Terminal (enrichment continues async) |
| `FAILED` | Upstream error, retries exhausted | Manual retry → PROCESSING |
| `NOT_FOUND` | FLHSMV has no matching report | Terminal (may appear later) |

**Incident intelligence stored per incident:**
- `officialReportNumber` — real FL government report number (not the synthetic hash)
- `rawPayload` — original FHP CAD signal as received
- `data` — full FLHSMV JSON (driver, vehicles, injuries, narrative, insurance, GPS)
- `retryCount` / `serviceFailureCount` — two separate counters tracking different failure types
- `ingestTraceId` — for cross-system tracing
- `lockedAt` / `lockedBy` — distributed lock for worker concurrency safety

**Territory assignment:** `resolveGeofenceTarget()` in `sentinel-accident-v2.ts` maps incident GPS coordinates to the correct sub-account territory.

---

## Layer 3 — Enrichment Layer

**What it is:** Signal → Person/Entity. This layer tries to identify the humans and businesses behind the raw incident data.

**Enrichment providers:**

| Provider | What it does | Credential env vars | File |
|---|---|---|---|
| FLHSMV (via ScrapingBee) | Driver name, home address, DOB, insurance, plate from crash report | `SCRAPINGBEE_API_KEY`, `SCRAPINGBEE_MODE` | `crashReportWorker.ts` |
| DHSMV (via Nimble) | Registered owner name + address from plate number | `NIMBLE_API_USERNAME`, `NIMBLE_API_PASSWORD` | `dhsmvRegistrationLookup.ts`, `nimbleClient.ts` |
| BatchData | Skip-trace: phone numbers from home address | `BATCHDATA_API_KEY` or `BATCH_DATA_KEY` | `skip-trace.ts` |
| Nimble Residential Proxy | Bypass Akamai/Cloudflare on government sites | `NIMBLE_PROXY_USERNAME`, `NIMBLE_PROXY_PASSWORD` | `nimbleClient.ts` |
| CourtListener | Case law, docket enrichment for legal signals | `COURTLISTENER_TOKEN` | `courtListenerPipeline.ts` |
| Apify | Attorney scraping, transport data | `APIFY_API_TOKEN` | `apifyAttorneyScraper.ts` |
| Property Radar | Property owner data | `PROPERTY_RADAR_API_KEY` | `property-radar.ts` |

**Enrichment stages for a crash lead — VICTIM-CENTRIC pipeline (v2, 2026-05-16):**

> **Core principle:** The enrichment target is THE PERSON, not the roadway.
> Incident locations (highway markers, intersections) NEVER become contact addresses.
> `contacts.address` holds residential intelligence only.

```
Stage 1 — Ingest time (crashIngestPipeline.ts)
  Placeholder contact created: "Unidentified Crash Incident"
  incidentLocation = crash scene ("I-75 NB MM 131") — stored separately, NEVER in contacts.address
  contacts.address = NULL (no residential data yet)
  addressConfidence = 0.00 | addressType = "unknown"
  incidentFingerprint = SHA256("crash:{reportNumber}") — stable dedup key
  isPlaceholder = true | workflowStage = "new"
  Tags: ["crash-lead", "sentinel-auto"]

Stage 2 — FLHSMV enrichment (crashReportWorker.ts → enrichCrashLeadContacts)
  Real driver name from FLHSMV official report
  Driver license address (residential) → registrationAddress field
  addressConfidence = 0.85 (FLHSMV license address)
  contacts.address = driver license address (first residential write)
  addressType = "registration" | addressSource = "flhsmv"
  Insurance company, vehicle info stored in notes
  isPlaceholder = false | workflowStage = "enriching"
  Tags: ["flhsmv-enriched", "plate:FL-XXXXX"]

Stage 3 — DHSMV registration lookup (dhsmvRegistrationLookup.ts via Nimble)
  Registered owner name + owner mailing address from DHSMV MVCheck portal
  registrationAddress upgraded if DHSMV owner address found
  addressConfidence = 0.90 (DHSMV registration — beats FLHSMV license)
  contacts.address upgraded to DHSMV owner address
  Tags: ["dhsmv-enriched"]

Stage 4 — Skip-trace (retroSkipTrace.ts / enrichmentWorker → BatchData)
  Target: probableResidence > registrationAddress (NEVER highway reference)
  Phone numbers from residential address
  mailingAddress field populated from BatchData result
  addressConfidence = 0.72 (BatchData inferred)
  contacts.address upgraded only if confidence beats current value
  Tags: ["skip-traced", "has-phone" or "no-phone"]

Stage 5 — Address geocode (enrichmentWorker → Google Geocoding API)
  Geocodes probableResidence or registrationAddress (NEVER incidentLocation)
  verifiedResidence field set on geocode confirmation
  addressConfidence = 0.95 (verified residential — highest possible)
  addressType = "verified_residence" | geocodeStatus = "verified"
  lat/lng set from residential geocode (not crash scene coordinates)
  workflowStage → "scored" → "routed"

Stage 6 — Retro passes (admin-triggered or scheduled)
  retroFLHSMVEnrich.ts — recover names on old placeholder contacts
  retroSkipTrace.ts — recover phones on contacts with residential addresses
```

**Contact dedup key:** `crash:{sentinelReportNumber}:acct{accountId}` (per sub-account)
**Incident dedup key:** `incidentFingerprint = SHA256("crash:{reportNumber}")` (cross-account)
**Merge guarantee:** `mergeContact()` only upgrades address confidence, never downgrades.
**Highway guard:** `looksLikeHighwayAddress()` in `contactUpsertService.ts` — highway strings are rejected from all residential address fields and skip-trace targets.

**Address confidence scale:**
| Level | Value | Source |
|-------|-------|--------|
| Verified residence | 0.95 | Google geocode confirmed residential |
| DHSMV registration | 0.90 | DHSMV registered owner address |
| FLHSMV license | 0.85 | Driver license address from crash report |
| BatchData inferred | 0.72 | Skip-trace mailing address |
| Probable household | 0.61 | Aggregated multi-source |
| Incident location | 0.15 | Highway/intersection scene — never for skip-trace |
| Unknown | 0.00 | No address data |

---

## Layer 4 — Contact Layer

**What it is:** Only verified, actionable humans or businesses become Contacts. This is the CRM intelligence layer.

**Core table:** `contacts`

**Contact enters the CRM when:**
- A real name is confirmed (not "Unidentified Crash Incident")
- OR a phone number is found
- OR a verified business entity is identified

**Once in the CRM, a contact can:**
- Enter automated workflows
- Be routed to attorneys/firms
- Be exported to third-party CRMs
- Be scored for opportunity value
- Receive SMS/email campaigns
- Be assigned to team members

**Contact quality fields:**
- `skipTraceStatus` — `not_attempted` / `pending` / `matched` / `no_match` / `failed`
- `enrichmentProvider` — which vendor produced the enrichment
- `enrichmentConfidence` — 0–1 score
- `contactQualityScore` — overall quality score
- `identityStatus` — how confident we are this is a real, unique person
- `exportEligible` — whether this contact is ready for attorney delivery

**UI surfaces:**
- **Lead Command Center** (`accident-leads.tsx`) — multi-filter, stackable, sortable, paginated
- **CRM** (`pipeline.tsx`) — mobile-first card layout with plate badges, filter bar, hide-unnamed toggle
- **Crash Reports** (`crash-reports.tsx`) — incident-level view linked to contacts

**Source dedup:** `contactUpsertService.ts` is the single entry point for all contact writes. Every upsert goes through dedup logic before touching the database.

---

## Layer 5 — Opportunity Layer

**What it is:** AI determines what is worth acting on. Not every contact is an opportunity. Not every incident becomes a case.

**Core files:**
- `server/intelligence/scoringEngine.ts` — contact/opportunity scoring
- `server/intelligence/recommendationEngine.ts` — what to do next
- `server/caseIntelligence.ts` — case value estimation
- `server/homeServiceLeadScorer.ts` — home service opportunity scoring
- `server/apexLeadEngine.ts` — lead qualification engine
- `server/legalSignalPipeline.ts` — legal opportunity identification

**Scoring dimensions:**
- Injury severity (fatalities, hospitalization indicators)
- Insurance coverage presence
- Time since incident (recency = higher value)
- Territory match (is this in a covered area?)
- Contact quality (phone confirmed, address verified)
- Case type value (PI vs property vs criminal)

**Opportunity output:** `opportunityScore` field on incidents and contacts. Drives routing priority in Layer 6.

---

## Layer 6 — Workflow Layer

**What it is:** Operational intelligence. How verified opportunities get acted on.

**Core files:**
- `server/routing/` — routing rules, resolver, gate, failure queue
- `server/callRequestFlow.ts` — intake call routing
- `server/homeServiceLeadDelivery.ts` — lead delivery to contractors
- `server/pushAlertService.ts` — real-time attorney/firm alerts
- `server/autonomy/` — autonomous action engine, safety policy, plan executor
- `server/operator/` — goal engine, planner, task agent, nudge system

**Workflow types:**
- `workflows` table — custom automation sequences
- `liveAutomations` — real-time trigger-based automations
- `emailCampaigns` — drip/blast campaigns
- `appointments` — scheduling integration
- SMS via Twilio (`twilioClient.ts`, `twilioClientFactory.ts`)

**Autonomy layer** (`server/autonomy/`):
- `safeActionsEngine.ts` — what the AI is allowed to do without human approval
- `safetyPolicy.ts` — guardrails on autonomous actions
- `planExecutor.ts` — executes multi-step plans built by the operator brain
- `approvals.ts` — human-in-the-loop approval gates for high-stakes actions

**Routing logic:**
- `server/routing/resolver.ts` — matches opportunity to correct attorney/firm account
- `server/routing/gate.ts` — eligibility checks before delivery
- `server/routing/failureQueue.ts` — dead-letter for failed routing attempts
- Territory assignment via `resolveGeofenceTarget()` using GPS coordinates

---

## Layer 7 — Document Intelligence Layer

**What it is:** PDFs, police reports, insurance documents, intake forms — parsed into structured data.

**Core queues:** `apex-ocr` (LOW priority BullMQ queue)

**Document types handled:**
- FLHSMV crash report PDFs (when digital API unavailable)
- Police narrative extraction
- Hillsborough court filings (`hillsboroughRecordsPipeline.ts`, `hillsboroughRecordsPipeline.ts`)
- Intake documents
- Insurance declarations

**Key files:**
- `server/callIntelligence.ts` — call recording transcription + extraction
- `server/hillsboroughCourtFilingsPipeline.ts` — court document parsing
- `server/chargeNormalizer.ts` — normalizes criminal charge descriptions across counties

**Evidence lineage:** Documents are linked back to their originating incident via `sourceRecordId` on the `eventLog` table — full chain of custody from raw signal to extracted data.

**Jotform integration:** `server/routes/publicForms.ts` handles intake form submissions, linking form responses back to contacts and incidents.

---

## Layer 8 — Semantic / Memory Layer

**What it is:** The platform's long-term intelligence. pgvector embeddings, AI memory, cross-case pattern recognition.

**Database:**
```sql
CREATE TABLE embedding_store (
  id          SERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,   -- 'contact', 'incident', 'document', 'case'
  source_id   TEXT NOT NULL,
  content     TEXT NOT NULL,
  embedding   vector(1536) NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- HNSW cosine similarity index for fast semantic search
CREATE INDEX embedding_store_hnsw_cosine_idx
  ON embedding_store
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**Queue:** `apex-embeddings` (LOW) and `apex-semantic` (LOW)

**Core files:**
- `server/operator/memory.ts` — operator brain short/long-term memory
- `server/operator/memoryEngine.ts` — memory read/write/retrieval
- `server/operator/episodicMemory.ts` — event-based memory (what happened, when, outcome)
- `server/operator/cognitiveLayer.ts` — cognitive context assembly for AI decisions
- `server/intelligence/networkIntelligence.ts` — relationship graph between contacts/entities
- `server/intelligence/crossPlatformPatterns.ts` — patterns across signal types
- `server/sharedIntelligence.ts` — shared context across accounts/sessions
- `server/dmContextAssembler.ts` — assembles dynamic context for AI model calls

**Operator Brain** (`server/operator/`):

The operator brain is the AI agent that runs Apex autonomously. Key components:

| File | Purpose |
|---|---|
| `agentBrain.ts` | Core agent reasoning loop |
| `goalEngine.ts` | Manages active goals and progress |
| `goalPlanner.ts` | Breaks goals into executable steps |
| `planExecutor.ts` | Executes plans, handles failures |
| `advisoryEngine.ts` | Generates strategic recommendations |
| `strategicAdvisor.ts` | Long-horizon planning and trend analysis |
| `trendDetection.ts` | Detects patterns across incidents/contacts |
| `nudgeSystem.ts` | Proactive user nudges based on intelligence |
| `telemetry.ts` | Reports outcomes back to the learning loop |
| `apexIntelligence.ts` | External reporting surface for agent outcomes |

**Learning feedback loop:**
```
Agent takes action
  → outcome recorded in brain_learning_feedback table
  → agent_performance_metrics updated
  → recommendationEngine adjusts future recommendations
  → goalEngine marks goal complete or retries with new plan
```

---

## Layer 9 — Observability + Orchestration

**What it is:** The operational backbone that keeps all 8 layers stable and recoverable.

### Queue System (BullMQ + Upstash Redis)

| Queue | Priority | Purpose |
|---|---|---|
| `apex-routing` | HIGH | Contact routing, lead delivery |
| `apex-notifications` | HIGH | SMS/email alerts, webhook fan-out |
| `apex-intake` | HIGH | Inbound webhook processing |
| `apex-enrichment` | MEDIUM | Skip-trace, address validation |
| `apex-scoring` | MEDIUM | Contact quality, opportunity scoring |
| `apex-crm` | MEDIUM | CRM updates, lifecycle changes |
| `apex-general` | MEDIUM | Legacy job migration drop-in |
| `apex-ocr` | LOW | Document ingestion, OCR extraction |
| `apex-embeddings` | LOW | Vector embedding generation |
| `apex-semantic` | LOW | Semantic indexing, re-ranking |
| `apex-maintenance` | BACKGROUND | Cleanup, archival, health checks |

**Note:** The Sentinel crash pipeline uses its own **Postgres-backed polling loop** (not BullMQ) for durability — crash_reports rows ARE the queue. Worker polls every 5 minutes.

### Retry Config (BullMQ)

| Tier | Attempts | Backoff | Initial delay |
|---|---|---|---|
| HIGH | 5 | exponential | 2s |
| MEDIUM | 3 | exponential | 5s |
| LOW | 2 | fixed | 10s |
| BACKGROUND | 1 | none | — |

### Monitoring

- **Sentry** (`server/instrument.ts`) — error tracking, performance tracing
- **PostHog** — product analytics, user behavior
- **`server/observability/`** — internal health checks, integration health, module registry
- **`server/pulse.ts`** — platform heartbeat / health signal
- **`server/startupChecks.ts`** — boot-time validation of all critical dependencies
- **`server/systemLogger.ts`** — structured logging with source tagging

### Failure Recovery

| Failure | Recovery |
|---|---|
| FLHSMV IP block | ScrapingBee premium proxy auto-activates when `SCRAPINGBEE_API_KEY` set |
| FLHSMV down | Worker marks jobs AWAITING, `runRecoverySweep()` retries when health recovers |
| BatchData exhausted | Skip-trace silently disabled, contacts get `skipTraceStatus: not_attempted` |
| Nimble not configured | Registration lookup skipped with warning log, contact still enriched from FLHSMV |
| Redis unavailable | In-memory queue fallback (non-durable) |
| Worker crash mid-job | `lockedAt` timeout (10 min) releases the lock, job re-enters queue |

### Admin Recovery Endpoints

All require `x-admin-secret` header:

```bash
# Re-enrich placeholder contacts from FLHSMV via ScrapingBee
POST /api/internal/retro-flhsmv-enrich
Body: { "limit": 500, "dryRun": false }

# Skip-trace contacts with addresses but no phone
POST /api/internal/retro-skip-trace
Body: { "subAccountId": 3 }   # omit for all accounts
```

UI trigger: **Crash Reports page → "Run Name Recovery"** amber panel.

---

## Schema Migration System

**Mechanism:** Boot-time idempotent SQL migrations in `server/dataMigrations.ts`.
Each migration has a unique string ID. The system checks if the migration was already applied before running it. Uses PostgreSQL advisory locks to prevent concurrent execution across Railway instances.

**To add a migration:**
```typescript
await runMigration(pool, "YYYY-MM-DD-descriptive-name", async (client) => {
  await client.query(`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`);
});
```

**Rollback:** There is no automated rollback. Migrations must be forward-only.
If a migration needs to be undone: write a new migration that reverses it.

---

## Environment Variables — Full Reference

| Variable | Layer | Provider | Required | Purpose |
|---|---|---|---|---|
| `DATABASE_URL` | All | Railway Postgres | YES | Primary database |
| `UPSTASH_REDIS_URL` | Orchestration | Upstash | YES | BullMQ queue backend |
| `SCRAPINGBEE_API_KEY` | Enrichment | ScrapingBee | YES* | Bypass FLHSMV Akamai block |
| `SCRAPINGBEE_MODE` | Enrichment | ScrapingBee | No | `premium` (default) or `stealth` |
| `NIMBLE_API_USERNAME` | Enrichment | Nimble | YES* | DHSMV registration lookup |
| `NIMBLE_API_PASSWORD` | Enrichment | Nimble | YES* | DHSMV registration lookup |
| `NIMBLE_PROXY_USERNAME` | Enrichment | Nimble | No | Residential proxy access |
| `NIMBLE_PROXY_PASSWORD` | Enrichment | Nimble | No | Residential proxy access |
| `BATCHDATA_API_KEY` | Enrichment | BatchData | No | Skip-trace phone lookup |
| `BATCH_DATA_KEY` | Enrichment | BatchData | No | Alias for BATCHDATA_API_KEY |
| `TWILIO_ACCOUNT_SID` | Workflow | Twilio | YES | SMS/voice |
| `TWILIO_AUTH_TOKEN` | Workflow | Twilio | YES | SMS/voice |
| `APIFY_API_TOKEN` | Signal | Apify | No | Web scraping agents |
| `PROPERTY_RADAR_API_KEY` | Signal | Property Radar | No | Property owner data |
| `COURTLISTENER_TOKEN` | Signal | CourtListener | No | Legal case data |
| `OPENAI_API_KEY` | Intelligence | OpenAI | YES | Embeddings + AI features |
| `ANTHROPIC_API_KEY` | Intelligence | Anthropic | YES | Claude operator brain |
| `SENTRY_DSN` | Observability | Sentry | No | Error tracking |
| `STANDALONE_ADMIN_SECRET` | All | Internal | No | Admin endpoint auth (default: `201120062017`) |
| `SENTINEL_CAD_API_KEY` | Signal | Internal | No | CAD feed ingest auth |

*Required for crash pipeline to function beyond placeholder contacts.

---

## Deployment Flow

```
1. Code change on feature branch
2. Push → GitHub PR → Railway auto-deploys preview environment
3. Test on Railway preview URL (apex-marketing-automations-pr-XX)
4. Merge PR to main → Railway auto-deploys production
5. On boot: dataMigrations.ts runs all pending migrations (idempotent)
6. startupChecks.ts validates all critical dependencies
7. Workers start: CrashReportWorker, BullMQ workers, RetroSkipTrace scheduler
```

---

## What Apex Is (One Paragraph)

Apex observes the physical world through a network of signal pipelines — crashes, arrests, court filings, permits, property activity, weather. It organizes those signals into incidents with severity, geography, and evidence context. It then enriches incidents into people using every available data source: government records, skip-trace vendors, proxy networks, and AI extraction. Verified people enter the CRM as contacts with full intelligence context. The operator brain — a persistent AI agent with episodic memory, goal tracking, and strategic reasoning — determines which contacts represent real opportunities, routes them to the right attorneys and service firms, and learns from every outcome. The entire system runs autonomously, with human oversight available at every layer but not required for routine operations.
