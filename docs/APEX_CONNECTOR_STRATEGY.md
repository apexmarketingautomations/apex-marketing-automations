# APEX CONNECTOR STRATEGY
**Operational Connector Recommendations by Capability Category**
Version: 1.0 | Generated: 2026-05-15
Audit Basis: Full server inventory — all env vars, vendorConfig.ts, jobQueue.ts, server/

---

## Audit Summary

This document is based on a live code audit of the Apex server layer. Every connector listed below was evaluated against existing integrations before being recommended. Connectors that are already live are noted. Only connectors that materially improve intelligence quality, enrichment, automation, or observability are included.

### Current Vendor Inventory (Live as of 2026-05-15)

| Vendor | Purpose | Status |
|--------|---------|--------|
| BatchData | Skip trace / people search | ✅ Live |
| Apify | Web scraping (crashes, attorneys) | ✅ Live |
| ScrapingBee | Web scraping (backup) | ✅ Live |
| Nimble | Web data extraction | ✅ Live |
| CourtListener | Legal filings API | ✅ Live |
| Sentinel CAD | Crash / CAD incident data | ✅ Live |
| OpenAI | Embeddings + GPT-4o | ✅ Live |
| Anthropic Claude | Case summaries, AI gateway | ✅ Live |
| Google Gemini | AI gateway (fallback) | ✅ Live |
| Google Maps | Geocoding, distance | ✅ Live |
| Google Places | Business data, reviews | ✅ Live |
| Twilio | SMS + voice carrier | ✅ Live |
| VAPI | Voice AI (outbound calls) | ✅ Live |
| ElevenLabs | Voice synthesis | ✅ Live |
| Stripe | Billing / subscriptions | ✅ Live |
| Meta Ads | Campaign data sync | ✅ Live |
| Mailchimp | Email marketing | ✅ Live |
| SendGrid | Transactional email | ✅ Live |
| Resend | Transactional email | ✅ Live |
| Mailgun | Email (secondary) | ✅ Live |
| PropertyRadar | Distress signals, property data | ✅ Live |
| RentCast | Rental property data | ✅ Live |
| Cloudflare | CDN / R2 storage | ✅ Live |
| Google Calendar | Calendar sync | ✅ Live |
| Calendly | Scheduling | ✅ Live |
| LinkedIn | Social auth | ✅ Live |
| TikTok | Social ad integration | ✅ Live |

### Critical Gaps Identified

| Gap | Severity | Impact |
|-----|----------|--------|
| In-memory job queue (no Redis) | 🔴 Critical | All queued jobs lost on Railway restart/redeploy |
| No external error tracking | 🔴 Critical | Errors write to DB only — zero alerting on Railway crashes |
| No log aggregation | 🟡 High | Cannot query logs without DB access; no retention policy |
| No CPSC signal connector | 🟡 High | Phase 5 legal intelligence blocked |
| No OSHA signal connector | 🟡 High | Phase 5 legal intelligence blocked |
| No PACER connector | 🟡 High | Federal court signals missing entirely |
| No NWS/NOAA connector | 🟡 High | Storm events for roofing/restoration blocked |
| No document AI / OCR | 🟡 High | Police reports and crash PDFs not parseable |
| Email provider fragmentation | 🟠 Medium | 4 email vendors configured — wasteful, inconsistent delivery |
| No address normalization API | 🟠 Medium | Address data from signals is unstructured; no USPS validation |
| No phone validation | 🟠 Medium | Skip-traced phones not validated for carrier / line type |
| No re-ranking for semantic search | 🟢 Low | Phase 7 search precision improvement |

---

## Category 1 — Infrastructure

### Current State
- Railway hosting (live)
- Neon Postgres 17.8 (live)
- Cloudflare CDN + R2 (live)
- **In-memory job queue** — `server/jobQueue.ts` — custom implementation backed only by process memory. All queued jobs are lost on every Railway restart, redeploy, or OOM event.

---

### Connector 1.1 — Upstash Redis

**1. Purpose**
Persistent, serverless Redis for job queue backing, rate limiting, distributed locks, and short-lived caching. Replaces the in-memory `jobQueue.ts` with a durable, multi-process-safe queue.

**2. Apex Module**
- `server/jobQueue.ts` (replace in-memory queue)
- `server/rateLimiter.ts` (replace in-process rate limit state)
- `server/enrichment_queue` (Phase 4A worker — must survive restarts)
- `server/workers/embeddingWorker.ts` (Phase 7 — embedding batch queue)

**3. Expected Data Flow**
```
Enrichment trigger → Upstash Redis LPUSH → Railway worker POPs job
Worker processes → writes result to Neon → marks job complete in Redis
On Railway restart: Redis retains unprocessed jobs → worker resumes
```

**4. Cost Profile**
- Upstash Redis Free tier: 10,000 commands/day — sufficient for dev
- Pay-as-you-go: $0.20 per 100K commands
- Estimated production cost: $5–15/month at current throughput

**5. Operational Risks**
- Upstash free tier has 256 MB max key size — not a concern for job metadata
- Redis connection pool must be sized for Railway's concurrency model (default: 10 connections)
- Job deduplication must be implemented at enqueue time (idempotency key per job)

**6. Scaling Concerns**
- Upstash Redis scales serverlessly — no cluster management required
- At 960 crash events/day and 50% enrichment rate = ~480 jobs/day = negligible load
- Embedding backfill (Phase 7) may spike to 2,000 jobs/day — within Upstash free tier

**7. Security Considerations**
- TLS-only connections enforced by Upstash by default
- API key stored in Railway env var (`UPSTASH_REDIS_URL` + `UPSTASH_REDIS_TOKEN`)
- Never log Redis key contents — job payloads may contain contact_id references

**8. Required Queues/Workers**
```
queues:
  enrichment:skip_trace    priority: 1
  enrichment:phone_append  priority: 2
  embedding:contact        priority: 3
  embedding:incident       priority: 4
  signal:ingest            priority: 5
workers:
  enrichment_worker.ts (Phase 4A)
  embedding_worker.ts (Phase 7)
```

**9. DB Tables Impacted**
- `enrichment_queue` — job state synced to DB after completion
- `agent_outcome_log` — every job result logged here
- `skip_trace_requests` — written on job completion

**10. Future AI Use Cases**
- Rate-limit AI API calls (OpenAI, Anthropic) per sub-account using Redis sliding window
- Cache embedding vectors for frequently searched queries (avoid repeated API calls)
- Distributed lock for batch scoring jobs (prevent double-execution)

---

### Connector 1.2 — Cloudflare R2 (Document Storage)

**1. Purpose**
Object storage for raw crash reports, police report PDFs, legal documents, and CPSC recall attachments. Cloudflare R2 already has an API token configured — expand its use for document storage.

**2. Apex Module**
- `server/crashIngestPipeline.ts` (store raw crash report PDFs)
- `server/courtFilingPipeline.ts` (store court filing PDFs)
- `server/legalSignalPipeline.ts` (CPSC/OSHA document storage)
- Future: `APEX_DOCUMENT_INTELLIGENCE` (Phase 8 — OCR input source)

**3. Expected Data Flow**
```
Signal received → raw PDF extracted from source
→ Upload to R2 (bucket: apex-documents/{entity_type}/{id}.pdf)
→ Store R2 URL in sentinel_incidents.raw_data or legal_signals.raw_data
→ Document AI / OCR reads from R2 URL (Phase 8)
→ Parsed text returned to signal record
```

**4. Cost Profile**
- R2 Storage: $0.015/GB/month (first 10 GB free)
- R2 Operations: $0.36/million Class B reads (first 10M free)
- Estimated: < $1/month at current document volumes

**5. Operational Risks**
- R2 bucket must have lifecycle policies to delete documents after archival window
- Signed URLs must have short expiry (1 hour max) for client-side rendering
- Do not store PII in file names — use entity_id-based paths

**6. Scaling Concerns**
- R2 is globally distributed — no scaling actions required
- 3,092 crash reports × average 200 KB PDF = ~600 MB — well within free tier

**7. Security Considerations**
- Bucket must be private — no public access
- All access via signed URLs or internal service worker
- CLOUDFLARE_API_TOKEN already in Railway env — enable R2 API access

**8. Required Queues/Workers**
- No dedicated worker — document upload is synchronous on ingest

**9. DB Tables Impacted**
- `sentinel_incidents.raw_data` — R2 URL stored in JSONB
- `legal_signals.raw_data` — R2 URL stored in JSONB
- Future: `case_evidence.file_url` — direct R2 link

**10. Future AI Use Cases**
- OCR pipeline reads from R2 → sends to Document AI → extracts structured data
- Vector embedding of document text for semantic search across crash reports
- Chain-of-custody audit: immutable document storage with versioned URLs

---

## Category 2 — Observability

### Current State
- `systemLogger.ts` writes to `system_logs` table in Neon — DB-only logging
- `agent_outcome_log`, `enrichment_provider_log` — structured observability tables
- No external error tracking (no Sentry)
- No log aggregation (no Axiom, no Datadog)
- If the DB connection fails, all error logging fails silently

---

### Connector 2.1 — Sentry

**1. Purpose**
Real-time error tracking, stack traces, performance monitoring, and Railway deployment-aware alerting. Fills the critical gap where errors that cause the DB write to fail are currently invisible.

**2. Apex Module**
- `server/index.ts` — global Express error handler
- `server/crashIngestPipeline.ts` — ingest errors tracked per-pipeline
- `server/skip-trace.ts` — BatchData API failures surfaced immediately
- `server/workers/` — all background worker crashes captured

**3. Expected Data Flow**
```
Railway process throws unhandled error
→ Sentry SDK captures: stack trace, request context, env tag
→ Sentry stores and alerts (Slack or email)
→ Error also written to agent_outcome_log (dual-write)
→ Operator sees grouped error issue with breadcrumbs
```

**4. Cost Profile**
- Sentry Free: 5,000 errors/month, 10K performance traces — sufficient for current scale
- Sentry Team: $26/month — recommended for production (50K errors, alerts, releases)

**5. Operational Risks**
- Sentry SDK adds ~2ms to request lifecycle — negligible
- PII scrubbing must be configured: never send contact.phone, contact.email in error context
- Must filter out expected errors (e.g., 404 contact not found) to avoid noise

**6. Scaling Concerns**
- At 960 crash events/day, error rate should be < 0.5% = < 5 Sentry events/day
- Well within free tier for the foreseeable future

**7. Security Considerations**
- Configure `denyUrls` and `beforeSend` to scrub PII before transmission
- SENTRY_DSN in Railway env — never expose in client-side bundle
- Use environment tags (`production`, `staging`) to separate alert streams

**8. Required Queues/Workers**
- No queue required — SDK is synchronous in the hot path

**9. DB Tables Impacted**
- `agent_outcome_log` — dual-write: Sentry captures the error, DB records the context
- No new tables required

**10. Future AI Use Cases**
- Sentry AI (Autofix) can suggest code fixes for recurring Railway errors
- Sentry performance traces identify N+1 query patterns before they become incidents
- Feed Sentry error rates into Platform Ops health dashboard

---

### Connector 2.2 — Axiom

**1. Purpose**
Structured log aggregation and queryable log storage. Replaces the brittle pattern of writing all logs to the Neon DB (which fails if the DB is unavailable) with a dedicated log store that survives DB outages.

**2. Apex Module**
- `server/systemLogger.ts` — add Axiom as secondary log sink
- `server/crashIngestPipeline.ts` — ingest run logs queryable without DB access
- `server/signal_source_health` — connector health logs streamed to Axiom
- `server/dataMigrations.ts` — migration execution logs

**3. Expected Data Flow**
```
logSystemEvent('error', 'crash_ingest', 'Sentinel connector timeout')
→ PRIMARY: write to system_logs (Neon)
→ SECONDARY: write to Axiom (HTTP ingest endpoint)
→ Axiom stores structured log with timestamp, severity, module, metadata
→ Engineer queries Axiom: WHERE module = 'crash_ingest' AND severity = 'error'
→ Alert fires if error rate > threshold
```

**4. Cost Profile**
- Axiom Free: 500 GB ingest/month, 30-day retention — sufficient for current scale
- Axiom Pro: $25/month — if retention or ingest limits exceeded

**5. Operational Risks**
- Axiom HTTP ingest is fire-and-forget — log drops are possible during Railway cold starts
- Must implement buffered log drain (write to Axiom asynchronously, never block request path)
- Log volume estimate: ~50 log events/minute at peak = ~72K/day — well within free tier

**6. Scaling Concerns**
- Axiom ingests log streams natively from Railway via log drain integration (zero code change)
- Railway → Settings → Log Drain → Axiom endpoint — 15-minute setup

**7. Security Considerations**
- AXIOM_API_TOKEN in Railway env
- Scrub PII from log messages before Axiom send (phone, email, SSN)
- Use dataset-level access controls — only engineers access production logs

**8. Required Queues/Workers**
- No queue — asynchronous fire-and-forget HTTP write

**9. DB Tables Impacted**
- `system_logs` — remains primary store for query access from the app UI
- Axiom is secondary/external — no new DB tables

**10. Future AI Use Cases**
- Axiom AI query assistant: "Show me all skip trace failures in the last 7 days grouped by error type"
- Feed Axiom log patterns into anomaly detection (signal connector degradation)
- Correlate log events with Sentry errors for full incident reconstruction

---

## Category 3 — Communications

### Current State
- Twilio: SMS + voice (live, `twilioClient.ts`)
- VAPI: Voice AI (live)
- ElevenLabs: Voice synthesis (live)
- Mailchimp: Email marketing (live)
- SendGrid: Transactional email (live)
- Resend: Transactional email (live)
- Mailgun: Email (live, secondary)

**Problem:** 4 email providers active simultaneously. No single source of truth for transactional email delivery. Inconsistent templates, deliverability fragmented across providers.

---

### Connector 3.1 — Resend (Consolidate to Single Transactional Provider)

**1. Purpose**
Consolidate all transactional email — skip trace results, attorney notifications, SLA breach alerts, enrichment digests — onto one provider. Resend is already live and is the best fit: developer-friendly, React email templates, 3,000 free/month.

**Recommendation:** Keep Resend for all transactional email. Deactivate SendGrid and Mailgun. Keep Mailchimp only for marketing campaign sequences (newsletters, drip campaigns).

**2. Apex Module**
- `server/routes/property.ts` — skip trace completion notification
- `server/distribution/` — attorney distribution notifications (Phase 4D)
- `server/routing/` — SLA breach alerts
- `server/observability/` — daily ops digest (platform health summary)

**3. Expected Data Flow**
```
Skip trace completes → POST /api/contacts/:id/skip-trace returns success
→ resend.emails.send({ to: operator_email, subject: 'Skip Trace Complete', react: SkipTraceTemplate })
→ Delivery logged to enrichment_provider_log
→ Bounce / open / click webhook → universal_events
```

**4. Cost Profile**
- Resend Free: 3,000 emails/month, 100/day
- Resend Pro: $20/month — 50,000 emails/month
- Current estimated volume: < 500 transactional emails/month

**5. Operational Risks**
- Domain must be verified with SPF + DKIM — required for deliverability
- Rate limit: 100 emails/day on free tier — sufficient for operational alerts, not bulk

**6. Scaling Concerns**
- As attorney distribution scales (Phase 4D), notification volume increases
- At 50 distributions/day × 1 notification each = 1,500/month — within free tier

**7. Security Considerations**
- RESEND_API_KEY already in Railway env
- Never include raw contact PII in email body — use masked references (Contact #1234)
- All email links must use HTTPS with signed tokens

**8. Required Queues/Workers**
- Upstash Redis queue for async email send (prevents blocking request path)
- Retry logic for transient Resend failures (max 3 attempts, 30s exponential backoff)

**9. DB Tables Impacted**
- `enrichment_provider_log` — email send logged (provider='resend', request_type='notification')
- `universal_events` — email_delivered, email_bounced events

**10. Future AI Use Cases**
- LLM-personalized attorney briefings (case summary in email body)
- AI-generated daily digest: "Your top 5 leads in Orange County today" with quality scores
- Automated follow-up sequences triggered by lifecycle_status changes (Phase 8)

---

### Connector 3.2 — Twilio Verify (Phone Validation)

**1. Purpose**
Validate phone numbers appended by BatchData skip trace before they are marked export-eligible. Carrier lookup determines if a number is mobile, landline, or VOIP — critical for deciding between SMS outreach and voice call.

**2. Apex Module**
- `server/skip-trace.ts` — run Verify lookup after BatchData returns phone
- `server/services/contactUpsertService.ts` — store carrier data in contact record
- `server/routes/property.ts` — phone validation as part of skip trace audit trail

**3. Expected Data Flow**
```
BatchData returns phone: +14075551234
→ Twilio Verify Lookup API called
  → returns { carrier: 'AT&T', line_type: 'mobile', valid: true }
→ contact.phone_carrier = 'AT&T', contact.phone_line_type = 'mobile'
→ if line_type = 'mobile': enable SMS outreach
→ if line_type = 'landline': voice-only outreach
→ if valid = false: flag phone as invalid, do not set export_eligible
→ log to contact_enrichment_events
```

**4. Cost Profile**
- Twilio Lookup: $0.01 per lookup
- At 480 skip trace successes/day × $0.01 = $4.80/day = ~$144/month
- Twilio already has account — Lookup is a free add-on to existing subscription

**5. Operational Risks**
- Lookup adds ~200ms latency to skip trace flow — run asynchronously post-response
- Some carrier data may be stale (ported numbers show original carrier)
- VOIP numbers may be falsely flagged — add manual override for operators

**6. Scaling Concerns**
- Twilio Lookup scales horizontally — no rate limit concerns at current volume

**7. Security Considerations**
- TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN already in Railway env
- Phone numbers in API calls are not stored in Twilio — only response metadata retained

**8. Required Queues/Workers**
- Add Lookup call to enrichment queue job, after skip trace result received

**9. DB Tables Impacted**
- `contacts` — add `phone_carrier`, `phone_line_type`, `phone_validated` columns
- `contact_enrichment_events` — phone_validated event type
- `skip_trace_requests` — phone_valid flag on completion record

**10. Future AI Use Cases**
- Route mobile numbers to SMS AI sequence; landlines to VAPI voice flow
- Build carrier-based quality score adjustment (mobile = higher reachability = +0.05 quality boost)
- Detect VOIP/burner numbers and auto-flag as low-quality

---

## Category 4 — Signal Ingestion

### Current State
- Sentinel CAD: crash signals (~960/day) — live
- Apify: crash + attorney scraping — live
- ScrapingBee: web scraping backup — live
- CourtListener: federal/state legal filings — live
- Hillsborough court filings — live
- Home service signals — live

**Missing:** CPSC (recalls), OSHA (violations), PACER (federal dockets), NWS/NOAA (storms)

---

### Connector 4.1 — CPSC Recalls API

**1. Purpose**
Ingest U.S. Consumer Product Safety Commission recall notices as legal signals. CPSC recalls are the primary trigger for product liability mass tort opportunities. Free public API, no authentication required.

**2. Apex Module**
- New: `server/cpscRecallPipeline.ts`
- `server/legalSignalPipeline.ts` — CPSC signals route through legal signal pipeline
- `APEX_LEGAL_SIGNAL_INTELLIGENCE` — Phase 5 primary signal source

**3. Expected Data Flow**
```
Cron: every 6 hours → GET https://www.saferproducts.gov/RestWebServices/Recall
→ Parse recall records (recall_number, product, hazard, units_sold, injuries)
→ Compute signal_fingerprint: SHA256('cpsc|' + recall_number + '|recall')
→ Dedup check against legal_signals
→ If new: INSERT into legal_signals (signal_type='recall', source='cpsc')
→ Compute legal heat_score
→ If heat_score >= 0.60: queue for case summary generation
→ Log to signal_source_health
→ Emit signal.received event
```

**4. Cost Profile**
- Free public API — no authentication, no rate limits beyond reasonable use
- Poll frequency: every 6 hours = 4 calls/day

**5. Operational Risks**
- CPSC API has no SLA — can have downtime for hours at a time
- Recall data format can change without notice — connector must be resilient to schema changes
- Some recalls affect hundreds of thousands of units — heat scoring must cap at 1.0

**6. Scaling Concerns**
- CPSC publishes ~20–30 recalls/week — low volume, no scaling concern

**7. Security Considerations**
- Public API — no credentials to protect
- Do not cache raw CPSC data beyond 24 hours (data may be updated with corrections)

**8. Required Queues/Workers**
- Cron job: `cpsc_recall_ingest` every 6 hours
- Legal heat scoring job triggered on each new recall signal

**9. DB Tables Impacted**
- `legal_signals` — INSERT new recall signals
- `signal_source_health` — CPSC connector health record
- `enrichment_provider_log` — ingest run log
- Future: `legal_case_ai_summary` — case summaries for high-heat recalls

**10. Future AI Use Cases**
- LLM summary: "This recall affects 1.2M pressure cookers. Key hazard: steam burns. Settlement range: $500–$5,000/claimant."
- Match recall product categories against contacts (did any of our contacts buy this product?)
- Semantic similarity: find related past recalls for precedent-based heat scoring

---

### Connector 4.2 — OSHA Enforcement Data API

**1. Purpose**
Ingest OSHA workplace safety violations and fatality reports as legal signals for workers' compensation and personal injury attorneys. Free public dataset via OSHA Open Data API.

**2. Apex Module**
- New: `server/oshaSignalPipeline.ts`
- `server/legalSignalPipeline.ts` — OSHA signals normalized through legal pipeline
- Entity resolution: affected workers → `lead_type = 'osha_entity'`

**3. Expected Data Flow**
```
Cron: weekly → GET https://data.osha.gov/enforcement/inspections
→ Filter: FL jurisdiction, inspection_type IN ('fatality', 'injury')
→ Compute fingerprint: SHA256('osha|' + case_number + '|' + signal_type)
→ Dedup against legal_signals
→ If new: INSERT (signal_type='osha_violation', jurisdiction=FL, parties=[employer])
→ Compute heat_score (fatality = 0.85, injury = 0.65, near-miss = 0.40)
→ Queue for attorney distribution if heat_score >= 0.70
```

**4. Cost Profile**
- Free public API — OSHA Open Data, no authentication
- Weekly poll: 1 API call/week per jurisdiction

**5. Operational Risks**
- OSHA data has a publication lag of 30–90 days — signals are not real-time
- Must deduplicate against existing legal_leads (Hillsborough court data may overlap)
- Employer name normalization required (same employer can appear under multiple names)

**6. Scaling Concerns**
- Florida OSHA inspections: ~500–1,000/year — low volume

**7. Security Considerations**
- Public API — no credentials
- Do not expose individual worker names from OSHA records without consent check

**8. Required Queues/Workers**
- Cron job: `osha_signal_ingest` weekly
- Legal heat scoring triggered after each new record

**9. DB Tables Impacted**
- `legal_signals` (new rows, signal_type='osha_violation')
- `signal_source_health` (OSHA connector)
- `contacts` (employer entities as `lead_type='osha_entity'`)

**10. Future AI Use Cases**
- Identify repeat OSHA violators for targeted attorney outreach ("This employer has 7 violations in 3 years")
- Cross-reference OSHA fatalities with jail booking data (same location, same week)
- LLM: generate attorney briefing from OSHA violation record

---

### Connector 4.3 — NWS/NOAA Storm Events API

**1. Purpose**
Ingest weather event data (named storms, tornadoes, hail, wind events) to trigger roofing, restoration, and home service opportunity scoring. Free government API.

**2. Apex Module**
- New: `server/stormEventPipeline.ts`
- `APEX_BUSINESS_INTELLIGENCE` — storm events drive permit_cluster scoring boost
- `server/homeServiceSignalPipeline.ts` — storm overlay on existing home service signals

**3. Expected Data Flow**
```
Cron: daily → GET https://api.weather.gov/alerts/active?area=FL
→ Filter: event IN ['Hurricane', 'Tornado', 'Hail', 'High Wind', 'Thunderstorm']
→ Extract affected counties from geometry.coordinates
→ Compute fingerprint: SHA256('nws|' + event_id + '|' + county)
→ INSERT into home_service_signals (signal_type='storm_event', counties=[])
→ For each affected county:
    → Boost opportunity_score of all permit_clusters in that county by +0.25
    → Alert all roofing/restoration sub-accounts in that territory
    → Emit storm_opportunity_spike event to universal_events
```

**4. Cost Profile**
- Free — NWS public API, no rate limits for reasonable use

**5. Operational Risks**
- NWS API can be slow during active storm events (high government server load)
- Storm geometry polygons require PostGIS or manual lat/lng bounding box check
- Do not alert on advisory/watch levels — only confirmed events with damage reports

**6. Scaling Concerns**
- Florida averages 40+ weather events/month in hurricane season — manageable volume

**7. Security Considerations**
- Public API — no credentials
- Do not spam sub-accounts with alerts for every lightning strike — only high-severity events

**8. Required Queues/Workers**
- Cron job: `storm_event_ingest` every 6 hours (more frequent during hurricane season)
- Alert worker: sends Resend email + Twilio SMS to affected sub-accounts

**9. DB Tables Impacted**
- `home_service_signals` (storm_event rows)
- `permit_clusters` (opportunity_score boost update)
- `signal_source_health` (NWS connector)
- `universal_events` (storm_opportunity_spike)

**10. Future AI Use Cases**
- AI-generated storm impact briefing: "Category 2 made landfall in 3 territories. 847 roofing leads in affected zone. Expected lead surge: 48–72 hours."
- Historical storm → permit volume correlation model (Phase 10)
- Storm prediction integration: stage lead pipeline before landfall

---

## Category 5 — Enrichment

### Current State
- BatchData: skip trace — live
- PropertyRadar: distress signals + owner data — live
- RentCast: rental property data — live

**Gaps:** No address standardization, no phone carrier validation (Twilio Verify above), no email validation, no alternative skip trace fallback.

---

### Connector 5.1 — Melissa Data (Address Standardization + USPS Validation)

**1. Purpose**
Standardize and validate all addresses ingested from crash reports, court filings, and skip trace results. Converts "123 main st apt 2, orl fl 32801" to USPS-standardized "123 MAIN ST APT 2, ORLANDO FL 32801-1234" with ZIP+4. Required for accurate geocoding and mail deliverability.

**2. Apex Module**
- `server/services/contactUpsertService.ts` — address validation before INSERT
- `server/crashIngestPipeline.ts` — normalize crash location addresses
- `server/services/signalNormalizationService.ts` (planned Phase 4A)

**3. Expected Data Flow**
```
Contact created with address: "123 main st, orlando fl"
→ Melissa Global Address API call
→ Returns: { deliverable: true, standardized: "123 MAIN ST, ORLANDO FL 32801-2345", lat: 28.538, lng: -81.379 }
→ contact.address = standardized
→ contact.lat = 28.538, contact.lng = -81.379
→ territory_id assigned based on validated lat/lng
→ log to contact_enrichment_events (field: 'address', event_type: 'address_verified')
```

**4. Cost Profile**
- Melissa Global Address API: $0.002–0.005 per record
- At 960 new contacts/day: ~$1.92–4.80/day = ~$60–145/month
- Melissa free trial: 1,000 lookups free

**5. Operational Risks**
- Must handle P.O. Box addresses (non-deliverable for property data) — flag but do not reject
- Rural addresses may not have ZIP+4 — accept without requiring full USPS format
- API downtime: implement graceful degradation (store raw address, queue for later validation)

**6. Scaling Concerns**
- Melissa scales to millions of lookups/day — no concern at Apex's volume

**7. Security Considerations**
- MELISSA_API_KEY in Railway env
- Melissa does not retain address data beyond the API call

**8. Required Queues/Workers**
- Upstash Redis queue: `enrichment:address_validate`
- Run asynchronously after contact creation — do not block the ingest pipeline

**9. DB Tables Impacted**
- `contacts` — address standardized in-place (confidence-guarded)
- `contact_enrichment_events` — address_verified event
- `sentinel_incidents` — location field standardized (Phase 4A)

**10. Future AI Use Cases**
- Standardized addresses enable accurate territory assignment (ZIP → territory_id lookup)
- Enable property lien data enrichment (requires exact address match)
- Batch geocoding for heatmap accuracy in Territory Intelligence

---

### Connector 5.2 — Hunter.io (Email Validation)

**1. Purpose**
Validate email addresses appended by BatchData before setting `export_eligible = true`. Catches disposable emails, typos, and role addresses (info@, support@) that would bounce.

**2. Apex Module**
- `server/skip-trace.ts` — validate email_found before committing to contact record
- `server/services/contactUpsertService.ts` — email validation gate in `deriveExportEligible()`

**3. Expected Data Flow**
```
BatchData returns email: john.smith@example.com
→ Hunter.io Email Verifier API call
→ Returns: { result: 'deliverable', score: 92, disposable: false, role: false }
→ If score >= 70 AND deliverable AND !disposable: accept email
→ Else: log as invalid, do not set export_eligible
→ contact_enrichment_events: email_validated event
```

**4. Cost Profile**
- Hunter.io Free: 100 verifications/month — insufficient for production
- Hunter.io Starter: $34/month — 1,000 verifications
- Hunter.io Growth: $104/month — 5,000 verifications
- Estimated need: 480 skip traces/day × 30% email find rate = 144 validations/day = $34–104/month

**5. Operational Risks**
- Some valid emails score below 70 (corporate mail servers block external validation)
- Implement a manual override: operator can mark email as valid despite low score
- Rate limit: 10 req/second — add delay for batch operations

**6. Scaling Concerns**
- Hunter.io plans scale — switch to Growth tier as email find rate increases

**7. Security Considerations**
- HUNTER_API_KEY in Railway env
- Hunter.io does not retain queried emails (GDPR compliant)

**8. Required Queues/Workers**
- Add to enrichment queue as `enrichment:email_validate` job after skip trace completes

**9. DB Tables Impacted**
- `contacts` — email_valid boolean column (to add)
- `contact_enrichment_events` — email_validated event type
- `skip_trace_requests` — email_valid flag on completion

**10. Future AI Use Cases**
- Email quality score as an input to AI quality grade (A+ requires validated email)
- Detect corporate email vs. personal email → route differently (corporate → attorney, personal → individual)

---

## Category 6 — Territory Intelligence

### Current State
- Google Maps Geocoding: already live (GOOGLE_MAPS_API_KEY)
- Google Places: already live (GOOGLE_PLACES_API_KEY)
- No map rendering in UI

---

### Connector 6.1 — Mapbox GL JS (Map Visualization)

**1. Purpose**
Interactive map rendering for the Incidents view heatmap, Territory coverage visualization, and permit cluster display. Google Maps has a JavaScript SDK but Mapbox GL JS is lighter, faster, and better for custom data overlays at Apex's scale.

**2. Apex Module**
- Frontend: Incidents view heatmap (Phase 4A UI)
- Frontend: Territory Intelligence dashboard (Phase 4D)
- Frontend: Business opportunity permit cluster map (Phase 6)

**3. Expected Data Flow**
```
GET /api/territory/:id/heatmap returns lat_bucket, lng_bucket, count
→ Frontend renders Mapbox GL heatmap layer
→ Operator clicks county → filters contact list to that county
→ Incident pins show severity_score as color gradient
```

**4. Cost Profile**
- Mapbox Free: 50,000 map loads/month — sufficient for internal operator tool
- Mapbox Pay-as-you-go: $0.50 per 1,000 loads beyond free tier

**5. Operational Risks**
- Mapbox API key must be public-facing (embedded in client bundle) — restrict by domain
- Large heatmap datasets (>10,000 points) must be server-side clustered before rendering

**6. Scaling Concerns**
- Heatmap data must be pre-aggregated to lat/lng buckets server-side — never send raw lat/lng of 7,449 incidents to the client

**7. Security Considerations**
- MAPBOX_PUBLIC_TOKEN — public token with domain restriction (apexmarketingautomations.com only)
- Never expose contact lat/lng to the map layer — use county-level aggregation only

**8. Required Queues/Workers**
- No queue — map data served from cached API responses

**9. DB Tables Impacted**
- Read-only queries against `sentinel_incidents`, `contacts`, `permit_clusters`

**10. Future AI Use Cases**
- AI-recommended territory boundaries based on historical conversion density
- Predictive heatmap: "Next 30 days expected crash density by county" (Phase 10)

---

## Category 7 — Workflow Orchestration

### Current State
- `server/jobQueue.ts` — in-memory queue (critical gap: no persistence)
- `server/eventBus.ts` — internal event bus
- `server/featureFlags.ts` — feature flag system (live)

---

### Connector 7.1 — Inngest (Durable Workflow Orchestration)

**1. Purpose**
Replace the in-memory `jobQueue.ts` with a durable, step-based workflow system. Inngest handles retries, timeouts, step-level failure recovery, fan-out, and scheduled triggers — without requiring Redis or a separate queue infrastructure.

**2. Apex Module**
- `server/enrichment_queue` — skip trace workflows with automatic retry
- `server/workers/embeddingWorker.ts` — step-based embedding with per-entity failure isolation
- `server/signal_source_health` — scheduled signal ingest cron jobs
- `server/distributionEngine.ts` (Phase 4D) — multi-step attorney distribution flows

**3. Expected Data Flow**
```
Contact created → Inngest event: 'contact/created'
→ Inngest function: enrichContact
    step 1: validateAddress (Melissa)
    step 2: runSkipTrace (BatchData) [retry: 3x, timeout: 30s]
    step 3: validatePhone (Twilio Verify)
    step 4: validateEmail (Hunter.io)
    step 5: computeQualityScore
    step 6: routeContact
Each step is individually retried on failure without re-running prior steps.
```

**4. Cost Profile**
- Inngest Free: 100K step runs/month — sufficient for current volume
- Inngest Plus: $20/month — 1M step runs/month
- At 960 incidents/day × 6 steps = 5,760 step runs/day = 172,800/month → Plus tier

**5. Operational Risks**
- Inngest requires an HTTP endpoint (`/api/inngest`) to receive function calls from Inngest Cloud
- Railway must not block inbound Inngest calls (whitelist Inngest IP range)
- Long-running enrichment functions must set step timeout > 60s for BatchData calls

**6. Scaling Concerns**
- Inngest fan-out: 960 incidents/day at 6 steps each = well within Plus tier limits
- Inngest handles concurrent execution without Railway OOM (each step is a separate Railway invocation)

**7. Security Considerations**
- INNGEST_SIGNING_KEY + INNGEST_EVENT_KEY in Railway env
- Validate Inngest webhook signature on every incoming function call
- Never log contact PII in Inngest event payloads — use entity IDs only

**8. Required Queues/Workers**
- Inngest replaces all custom queue logic — no separate Redis required for workflow orchestration
- Upstash Redis still needed for rate limiting and caching (separate concern)

**9. DB Tables Impacted**
- `enrichment_queue` — job state tracked here for UI visibility (Inngest is the execution layer)
- `agent_outcome_log` — every Inngest step result logged
- `skip_trace_requests` — written by Inngest enrichContact step 2

**10. Future AI Use Cases**
- Multi-step AI reasoning workflows: "Score contact → if score < 0.5, attempt enrichment → re-score → route"
- Durable AI memory update: embedding creation as a reliable Inngest step (no lost embeddings)
- Attorney distribution with SLA tracking: Inngest sleep() until SLA deadline, then escalate

---

## Category 8 — AI / Memory

### Current State
- OpenAI: live (GPT-4o + embeddings)
- Anthropic Claude: live (claude-sonnet-4-6)
- Google Gemini: live (fallback)
- `aiGateway.ts`: provider routing live
- `embedding_store`: table live, HNSW index live, 0 rows (paused)

---

### Connector 8.1 — OpenAI API (text-embedding-3-small — Activate for Phase 7)

**1. Purpose**
Generate semantic vector embeddings for contacts, incidents, legal signals, and case records — enabling text-driven search and similarity matching. Already configured. Needs to be activated under throttling controls.

**2. Apex Module**
- `server/workers/embeddingWorker.ts` (Phase 7)
- `embedding_store` table (live, 0 rows)
- `server/aiGateway.ts` — route embedding calls through existing gateway

**3. Expected Data Flow**
```
Enriched contact (export_eligible=true) created
→ Inngest: embed_contact step queued
→ buildContactEmbeddingContent(contact) → 15–25 token string
→ openai.embeddings.create({ model: 'text-embedding-3-small', input: content })
→ INSERT INTO embedding_store (entity_type='contact', entity_id, embedding, content_hash)
→ HNSW index auto-updated
→ log to agent_outcome_log (tokens_used, latency_ms)
```

**4. Cost Profile**
- text-embedding-3-small: $0.02/1M tokens
- Initial backfill: ~635K tokens = $0.013
- Ongoing: 960 incidents/day × 40 tokens = $0.001/day = $0.30/month

**5. Operational Risks**
- OpenAI rate limits: 3M tokens/minute on Tier 2 — not a concern at Apex's volume
- Daily embedding cap (2,000/day) must be enforced to prevent runaway cost
- Content hash deduplication prevents re-embedding unchanged contacts

**6. Scaling Concerns**
- At 10× contact volume (100K contacts): backfill cost = $0.04 — still negligible
- HNSW index rebuild not required — Neon updates HNSW incrementally on INSERT

**7. Security Considerations**
- OPENAI_API_KEY already in Railway env
- Do not send full name + address in embedding input — use field concatenation without PII clustering

**8. Required Queues/Workers**
- Inngest: `embedding/contact` function (daily batch, throttled)
- Daily cap enforced via Redis counter

**9. DB Tables Impacted**
- `embedding_store` — primary write target
- `agent_outcome_log` — embedding operation log with token cost

**10. Future AI Use Cases**
- Semantic contact search: `GET /api/contacts/search?q=truck driver crash I-4 orange county`
- Similarity clustering: group contacts from the same incident cluster
- AI memory: retrieve relevant past cases for attorney copilot context

---

## Category 9 — Semantic Retrieval

### Current State
- pgvector 0.8.0 live, HNSW index live, 0 embeddings
- No semantic search endpoints

---

### Connector 9.1 — Cohere Rerank (Search Precision Layer)

**1. Purpose**
Re-rank semantic search results returned by pgvector HNSW before displaying to operators. HNSW returns approximate nearest neighbors — Cohere Rerank runs a cross-encoder to re-score results with higher precision. Meaningful improvement for legal intelligence search where relevance matters.

**2. Apex Module**
- `GET /api/contacts/search` (Phase 7)
- `GET /api/incidents/search` (Phase 7)
- `GET /api/cases/search` (Phase 5+)

**3. Expected Data Flow**
```
Operator query: "pedestrian struck on International Drive"
→ Embed query → HNSW top-50 from embedding_store
→ Send top-50 snippets to Cohere Rerank API
→ Cohere returns reranked top-10 by relevance
→ Return top-10 to operator
Result: significantly higher relevance than raw cosine similarity alone
```

**4. Cost Profile**
- Cohere Rerank: $0.001 per search (1 API call = 1 rerank)
- At 100 operator searches/day: $0.10/day = $3/month
- Optional — only needed if operator search quality complaints arise

**5. Operational Risks**
- Adds 200–400ms latency to search — acceptable for non-real-time search
- Cohere Rerank requires snippets (text content) not just IDs — `content_snapshot` in `embedding_store` must be populated

**6. Scaling Concerns**
- Phase 7 search volume will be low (internal operator tool) — no scaling concern

**7. Security Considerations**
- COHERE_API_KEY in Railway env
- content_snapshot sent to Cohere must be PII-scrubbed (no phone/email in snippet)

**8. Required Queues/Workers**
- Synchronous call in search endpoint — no queue needed

**9. DB Tables Impacted**
- `embedding_store.content_snapshot` — must be populated at embedding time for rerank input

**10. Future AI Use Cases**
- Teach reranker on operator click-through data (which results did they actually open?)
- Legal case search: rerank by legal relevance, not just semantic similarity

---

## Category 10 — Legal Intelligence

### Current State
- CourtListener: live (federal/state filings)
- Hillsborough court filings: live pipeline
- CPSC: planned (Connector 4.1 above)
- OSHA: planned (Connector 4.2 above)

---

### Connector 10.1 — PACER (Federal Court Dockets)

**1. Purpose**
Access federal court case dockets and complaint text for personal injury, product liability, and class action cases filed in federal courts. PACER provides the full complaint text, which is the primary input for legal case AI summaries.

**2. Apex Module**
- New: `server/pacerPipeline.ts`
- `server/courtFilingPipeline.ts` — extend to include federal cases
- `legal_signals` — PACER filings as signal_type='federal_filing'

**3. Expected Data Flow**
```
Weekly cron → PACER API query: district=M.D. Fla, nature_of_suit IN [360 (PI), 367 (product liability)]
→ Retrieve new case filings since last run
→ Parse docket entries: parties, attorneys, filing_date, case_type
→ Compute fingerprint: SHA256('pacer|' + docket_number + '|' + 'federal_filing')
→ INSERT into legal_signals
→ Extract plaintiff names → entity resolution → contacts (lead_type='individual' if victim)
→ Extract defendant attorneys → contacts (lead_type='attorney')
→ Heat score: class_action > mass_tort > standard_pi
```

**4. Cost Profile**
- PACER: $0.10 per page (individual case documents)
- PACER has a quarterly billing exemption if < $30/quarter — likely applicable for targeted queries
- Estimated: $10–30/month for targeted M.D. Florida PI/product liability queries

**5. Operational Risks**
- PACER requires a registered account and can throttle heavy scrapers
- PACER document format is HTML + PDF — requires parsing layer
- Case data can be sealed — connector must handle 403 responses gracefully

**6. Scaling Concerns**
- Scope queries to M.D. Florida (Orlando) and S.D. Florida (Miami) initially
- Weekly batch rather than daily to minimize per-page costs

**7. Security Considerations**
- PACER_USERNAME + PACER_PASSWORD in Railway env
- PACER credentials must never be logged — HTTP auth header scrubbed from all logs

**8. Required Queues/Workers**
- Cron job: `pacer_signal_ingest` weekly
- PDF parsing job (if Textract added — Connector 13.1)

**9. DB Tables Impacted**
- `legal_signals` (federal_filing rows)
- `legal_leads` (party records from complaints)
- `contacts` (plaintiff individuals if personal enough for identity resolution)
- `signal_source_health` (PACER connector health)

**10. Future AI Use Cases**
- Full complaint text → AI extraction: "Plaintiff injured on 2025-03-15 at XYZ warehouse. Lost wages: $45,000."
- Semantic search across complaint text for similar incident patterns
- Predict settlement probability from complaint specificity score

---

## Category 11 — Property Intelligence

### Current State
- PropertyRadar: distress signals, pre-foreclosure, owner name/phone — live
- RentCast: rental property data — live

**Gap:** No lien data, no AVM (automated valuation model) tied to crash victim addresses, no title/deed access.

---

### Connector 11.1 — ATTOM Data Solutions

**1. Purpose**
Property ownership records, automated valuation models (AVM), tax assessment, lien data, and foreclosure history tied to individual addresses. Enables the platform to assess economic standing of crash victims (property equity → personal injury damages potential) and identify property ownership for home service leads.

**2. Apex Module**
- `server/property-radar.ts` — complement or replace with ATTOM for broader data coverage
- `server/homeServiceSignalPipeline.ts` — attach property value to permit signals
- Future: contact detail view — "Property: 3BR, valued at $340K, $180K equity, 1 lien"

**3. Expected Data Flow**
```
Contact enriched with standardized address (Melissa Data output)
→ ATTOM AVM API call: GET /property/attomavm/detail?address=...
→ Returns: { estimatedValue: 340000, equityPct: 53, lienCount: 1, ownerName: "John Smith" }
→ Store in contact.raw_enrichment_data (JSONB)
→ Cross-validate owner name vs. contact name (identity confidence boost if match)
→ equity > 30% AND individual → quality_score += 0.05 (more to lose = stronger PI claimant)
→ log to contact_enrichment_events
```

**4. Cost Profile**
- ATTOM API: $0.05–0.15 per property lookup
- At 480 enriched contacts/day: $24–72/day — must be throttled
- Selective enrichment: only run for individual lead_types where incident_severity >= 'serious'
- Selective: ~50–100 lookups/day = $2.50–15/day = $75–450/month

**5. Operational Risks**
- ATTOM data lags public record updates by 30–90 days
- AVM estimates can be off by 10–20% — use as signal, not precise value
- Must guard against ATTOM lookup replacing a human-verified address (confidence guard applies)

**6. Scaling Concerns**
- Selective enrichment gate (severity >= 'serious') keeps volume manageable

**7. Security Considerations**
- ATTOM_API_KEY in Railway env
- Property data is public record — no special handling required
- Do not display raw equity estimates in client-facing views without legal review

**8. Required Queues/Workers**
- Inngest: `enrichment:property_lookup` step, runs after address validation
- Throttle: max 100 ATTOM calls/day via Redis counter

**9. DB Tables Impacted**
- `contacts` — property_value, property_equity, lien_count columns (to add)
- `contact_enrichment_events` — property_enriched event
- `home_service_signals` — property_value overlay for permit scoring

**10. Future AI Use Cases**
- "This crash victim owns a $420K home with $210K equity and 0 liens — high-value PI claimant"
- Property equity → settlement expectation model (Phase 10)
- Cross-reference foreclosure data with storm signals: distressed homeowner + storm damage = roofing/restoration conversion

---

## Category 12 — Business Intelligence

### Current State
- Google Places: live (GOOGLE_PLACES_API_KEY) — already provides business listings, ratings, hours
- Florida DBPR: planned connector (Phase 6)

---

### Connector 12.1 — Google Places API (Activate for Business Intel)

**1. Purpose**
Google Places is already configured and paid for. Activate it as the primary business data source for local business signal enrichment — competitor proximity analysis, review monitoring, and new business detection.

**2. Apex Module**
- `server/homeServiceSignalPipeline.ts` — enrich business signals with Places data
- `APEX_BUSINESS_INTELLIGENCE` — ICP matching for vertical operators
- Future: `business_opportunities.place_id` — stable Google identifier

**3. Expected Data Flow**
```
New DBPR license issued for "Sunshine Roofing LLC", Orange County
→ Google Places Text Search: "Sunshine Roofing Orlando FL"
→ Match: { place_id: 'ChIJ...', rating: 4.2, user_ratings_total: 47, types: ['roofing_contractor'] }
→ Store: business_opportunities.place_id, rating, review_count
→ Schedule: weekly review monitoring for active businesses
→ If rating drops > 0.5 in 30 days: emit review_spike event → reputation management alert
```

**4. Cost Profile**
- Places Text Search: $17 per 1,000 requests (after free $200/month credit)
- Places Details: $17 per 1,000 requests
- At current business signal volume: likely < $200/month (within free credit)

**5. Operational Risks**
- Google Places data is user-contributed — business category can be wrong
- $200/month free credit applies across all Google APIs — coordinate with Maps and Geocoding usage
- Places API has rate limits: 600 QPM — not a concern

**6. Scaling Concerns**
- Review monitoring can be batched weekly — no real-time polling required

**7. Security Considerations**
- GOOGLE_PLACES_API_KEY already in Railway env — add API restriction: Places API only

**8. Required Queues/Workers**
- Cron: weekly review monitoring job for active `business_opportunities`
- Inngest: `business/enrich` step after DBPR signal ingest

**9. DB Tables Impacted**
- `business_opportunities` — place_id, rating, review_count, last_review_check columns
- `home_service_signals` — place_id enrichment

**10. Future AI Use Cases**
- Review trend analysis: "This roofing company's rating dropped from 4.5 to 3.1 in 60 days — reputation management opportunity"
- Competitor mapping: "3 new roofing companies opened within 10 miles of your territory this month"
- Photo analysis: Google Places photos → AI visual assessment of business size and quality

---

## Category 13 — Document Intelligence

### Current State
- No OCR
- Crash reports stored as raw text/JSON
- Police report PDFs referenced but not parsed
- Legal document text not extracted

---

### Connector 13.1 — Google Cloud Document AI (OCR + Form Parsing)

**1. Purpose**
Extract structured data from crash report PDFs, police reports, CPSC recall documents, and court filing PDFs. Converts unstructured document images into typed fields (crash date, vehicle count, driver names, insurance information) that feed directly into incident scoring and entity resolution.

**2. Apex Module**
- `server/crashIngestPipeline.ts` — parse police report PDFs stored in R2
- `server/cpscRecallPipeline.ts` (Phase 5) — extract product and hazard fields from CPSC PDFs
- `server/courtFilingPipeline.ts` — extract party names and case facts from court documents

**3. Expected Data Flow**
```
Police report PDF uploaded to Cloudflare R2
→ Inngest: parse_document step triggered
→ Google Document AI: processDocument(pdf_bytes, processor='FORM_PARSER')
→ Returns structured key-value pairs:
    { "CRASH DATE": "2026-05-10", "VEHICLE 1 DRIVER": "John Smith", "INJURIES": "3" }
→ Map to sentinel_incidents columns: persons_identified += 1, persons raw names queued for entity resolution
→ Store parsed_fields in sentinel_incidents.raw_data.parsed_fields (JSONB)
→ log to agent_outcome_log (tokens: page_count, latency_ms)
```

**4. Cost Profile**
- Google Document AI Form Parser: $1.50 per 1,000 pages
- Crash report: avg 2 pages → $0.003/report
- At 960 crashes/day: $2.88/day = $86/month
- Selective: only process crashes with severity >= 'serious' (~30% = 288/day) = $25/month

**5. Operational Risks**
- OCR accuracy on handwritten police reports: 85–90% (not 100%) — human review for critical fields
- Document AI has a 15MB file size limit — large court filing PDFs must be split
- Processing latency: 3–8 seconds per page — must be async (not on the request path)

**6. Scaling Concerns**
- Document AI scales automatically — no configuration changes needed as volume grows

**7. Security Considerations**
- GOOGLE_CLOUD_API_KEY or service account JSON in Railway env
- Documents contain PII — pipeline must scrub before storing processed output
- Do not store raw OCR text in Neon — store only structured extracted fields

**8. Required Queues/Workers**
- Inngest: `document/parse` function with R2 URL as input
- Runs after R2 upload completes — non-blocking to ingest pipeline

**9. DB Tables Impacted**
- `sentinel_incidents.raw_data` — parsed_fields JSONB key added
- `legal_signals.raw_data` — document_text and parsed_fields keys added
- `agent_outcome_log` — document_parse operation log

**10. Future AI Use Cases**
- Full document → LLM extraction: "Parse this crash report and identify all injured parties with their addresses and insurance information"
- Document similarity: embed parsed document text for semantic search across crash reports
- Auto-population of incident fields from police report (reduces manual data entry to zero)

---

## Implementation Priority

| Priority | Connector | Phase | Reason |
|----------|-----------|-------|--------|
| 🔴 P1 | Upstash Redis | Immediate | In-memory queue is a production reliability risk |
| 🔴 P1 | Sentry | Immediate | No external error tracking = blind to Railway crashes |
| 🔴 P1 | Axiom (Railway log drain) | Immediate | 15-minute setup, critical for debugging |
| 🟡 P2 | Inngest | Phase 4A | Replace job queue before enrichment queue activates |
| 🟡 P2 | CPSC API | Phase 5 | Free, high-value legal signal source |
| 🟡 P2 | NWS/NOAA | Phase 6 | Free, high-value storm signal for home service |
| 🟡 P2 | Resend (consolidate) | Phase 4A | Remove SendGrid/Mailgun to reduce provider fragmentation |
| 🟡 P2 | Twilio Verify | Phase 4A | Phone validation gates export_eligible quality |
| 🟠 P3 | Melissa Data | Phase 4B | Address standardization improves territory assignment |
| 🟠 P3 | OSHA API | Phase 5 | Free, legal intelligence complement to CPSC |
| 🟠 P3 | PACER | Phase 5 | Federal court signal coverage |
| 🟠 P3 | Google Document AI | Phase 5 | OCR unlocks police report data |
| 🟠 P3 | ATTOM Data | Phase 5 | Property intelligence on crash victims |
| 🟠 P3 | Google Places (activate) | Phase 6 | Business intel — already paid for |
| 🟠 P3 | Hunter.io | Phase 4B | Email validation for quality gate |
| 🟢 P4 | Mapbox GL JS | Phase 4A UI | Map visualization |
| 🟢 P4 | Cohere Rerank | Phase 7 | Search precision improvement |
| 🟢 P4 | PACER | Phase 5 | Federal docket access |
