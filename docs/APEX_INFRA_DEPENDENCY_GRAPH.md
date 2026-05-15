# APEX INFRASTRUCTURE DEPENDENCY GRAPH
**System Topology, Data Flow, and Provider Dependency Map**
Version: 1.0 | Generated: 2026-05-15

Legend:
  ✅ Live    🔄 Activate    📋 Planned    ❌ Missing
  → data flows to
  ⟵ reads from
  ⟷ bidirectional

---

## Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL WORLD                                     │
│  Crashes    Courts    Recalls    OSHA    Permits    Weather    Businesses   │
└──────┬─────────┬────────┬─────────┬────────┬──────────┬──────────┬─────────┘
       │         │        │         │        │          │          │
       ▼         ▼        ▼         ▼        ▼          ▼          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SIGNAL ENGINE LAYER                                 │
│                                                                             │
│  Sentinel CAD ✅   CourtListener ✅   CPSC API 📋   OSHA API 📋           │
│  Apify ✅          Hillsborough ✅    PACER 📋       NWS/NOAA 📋           │
│  ScrapingBee ✅    Nimble ✅          Florida DBPR 🔄                       │
│                                                                             │
│  → normalizeCounty() → computeFingerprint() → dedup check                  │
│  → INSERT sentinel_incidents / legal_signals / home_service_signals        │
│  → signal_source_health (connector status logging)                         │
│  → universal_events (signal.received event)                                │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      INCIDENT INTELLIGENCE LAYER                            │
│                                                                             │
│  Fingerprint dedup → Severity scoring (deterministic) → Cluster detection  │
│  → enrichment_queue INSERT (if severity_score >= 0.50)                     │
│  → sentinel_incident_ai_triage (severity scores)                           │
│  → incident_clusters (Phase 4A)                                            │
│  → incident_timeline (every state change logged)                           │
│  → universal_events (incident.created, incident.severity_scored)           │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ENRICHMENT LAYER                                    │
│                                                                             │
│  BatchData ✅ (skip trace)         Melissa Data ❌ (address validation)    │
│  Twilio Verify ❌ (phone valid)    Hunter.io ❌ (email validation)         │
│  ATTOM Data ❌ (property intel)    PropertyRadar ✅ (distress signals)     │
│  Google Document AI ❌ (OCR)       Cloudflare R2 ✅ (document storage)    │
│                                                                             │
│  Orchestrated by: Inngest ❌ (planned) / in-memory jobQueue.ts ✅ (live)  │
│  Queue backed by: Upstash Redis ❌ (planned) / process memory ✅ (live)   │
│                                                                             │
│  → skip_trace_requests (audit)                                              │
│  → contact_enrichment_events (field-level change log)                      │
│  → enrichment_provider_log (provider call log)                             │
│  → agent_outcome_log (every operation result)                              │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ENTITY RESOLUTION LAYER                               │
│                                                                             │
│  isPlaceholderName() → classifyLeadType() → computeIdentityConfidence()   │
│  → dedup check (exact phone/email match → fuzzy name+county match)         │
│  → deriveExportEligible() → SET export_eligible                            │
│                                                                             │
│  Writes to: contacts (lead_type, export_eligible, source_pipeline)         │
│  Links to: incident_contacts (incident ↔ contact relationship)             │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CRM INTELLIGENCE LAYER                              │
│                                                                             │
│  contacts (9,562 total, 990 export_eligible)                               │
│  contact_ai_profiles (quality grade: A+/A/B/C/D) — Phase 4B               │
│  contact_routing_rules (12 rules live)                                     │
│  contact_routing_audit (every routing decision logged)                     │
│                                                                             │
│  Feeds: Operator UI → filter bar → quick filter chips → county grouping    │
│  Feeds: Export endpoint → CSV (export_eligible=true enforced)              │
└──────────────┬─────────────────────────────────┬──────────────────────────┘
               │                                 │
               ▼                                 ▼
┌──────────────────────────┐      ┌──────────────────────────────────────────┐
│   CASE INTEL LAYER       │      │      DISTRIBUTION INTELLIGENCE LAYER     │
│                          │      │                                          │
│  intelligence_cases      │      │  contact_routing_rules → match logic     │
│  legal_case_ai_summary   │      │  → target_sub_account_id assigned       │
│  case_evidence           │      │  → SLA timer started                    │
│  case_assignments        │      │  → distribution_outcomes tracked        │
│                          │      │                                          │
│  Populated by:           │      │  Notifies via:                          │
│  Claude Sonnet 4.6 ✅    │      │  Resend ✅ (email notification)         │
│  GPT-4o ✅               │      │  Twilio ✅ (SMS alert)                  │
└──────────────────────────┘      └──────────────────────────────────────────┘
```

---

## Full Provider Dependency Map

```
                         ┌─── APEX INTELLIGENCE OS ───┐
                         │                             │
                         │   Railway (hosting) ✅      │
                         │   Neon Postgres 17.8 ✅     │
                         │   pgvector 0.8.0 ✅         │
                         │   Cloudflare CDN/R2 ✅       │
                         │   Upstash Redis ❌           │
                         └─────────────┬───────────────┘
                                       │
         ┌─────────────────────────────┼──────────────────────────────┐
         │                             │                              │
         ▼                             ▼                              ▼
┌─────────────────┐         ┌─────────────────────┐       ┌───────────────────┐
│  SIGNAL SOURCES │         │  ENRICHMENT STACK   │       │   AI / ML STACK   │
│                 │         │                     │       │                   │
│ Sentinel CAD ✅ │         │ BatchData ✅         │       │ Claude Sonnet ✅   │
│ Apify ✅        │         │ PropertyRadar ✅     │       │ OpenAI GPT-4o ✅  │
│ ScrapingBee ✅  │         │ RentCast ✅          │       │ Gemini ✅          │
│ CourtListener✅ │         │ Melissa Data ❌      │       │ ElevenLabs ✅     │
│ Hillsborough ✅ │         │ Twilio Verify ❌     │       │ OpenAI Embed ✅🔄 │
│ CPSC API ❌     │         │ Hunter.io ❌         │       │ Cohere Rerank ❌  │
│ OSHA API ❌     │         │ ATTOM Data ❌        │       │ pgvector HNSW ✅  │
│ PACER ❌        │         │ Google DocAI ❌      │       │                   │
│ NWS/NOAA ❌     │         │                     │       │ Used for:         │
│ DBPR 🔄         │         │ Orchestrated by:     │       │ Case summaries    │
│                 │         │ Inngest ❌            │       │ Triage notes      │
│ →sentinel_inc   │         │ (jobQueue.ts live ✅) │       │ Quality scoring   │
│ →legal_signals  │         │                     │       │ Semantic search   │
│ →home_svc_sig   │         │ Queue backed by:     │       │ Voice synthesis   │
│ →crash_reports  │         │ Upstash Redis ❌     │       │                   │
└─────────────────┘         │ (in-memory live ✅)  │       └───────────────────┘
                            └─────────────────────┘
         ┌─────────────────────────────┼──────────────────────────────┐
         │                             │                              │
         ▼                             ▼                              ▼
┌─────────────────┐         ┌─────────────────────┐       ┌───────────────────┐
│  COMMUNICATIONS │         │  TERRITORY INTEL    │       │  OBSERVABILITY    │
│                 │         │                     │       │                   │
│ Twilio ✅        │         │ Google Maps ✅       │       │ system_logs ✅    │
│ VAPI ✅          │         │ Google Places ✅🔄  │       │ agent_outcome ✅  │
│ Resend ✅        │         │ Mapbox GL JS ❌      │       │ enrichment_log ✅ │
│ Mailchimp ✅    │         │                     │       │ Sentry ❌         │
│ SendGrid ⚠️     │         │ Feeds:               │       │ Axiom ❌          │
│ Mailgun ⚠️      │         │ territories table ❌  │       │                   │
│                 │         │ heatmap endpoint ❌  │       │ Current gap:      │
│ Notification    │         │ territory_id FK ❌   │       │ All errors write  │
│ channels:       │         │                     │       │ to DB only.       │
│ Attorney alerts │         │ Geocoding pipeline:  │       │ If DB fails,      │
│ SLA breach SMS  │         │ address → lat/lng →  │       │ errors vanish.    │
│ Daily digests   │         │ county → territory   │       │                   │
│ Export notify   │         │                     │       └───────────────────┘
└─────────────────┘         └─────────────────────┘
```

---

## Data Flow: Crash Incident → Export-Eligible Contact

```
[1] SIGNAL INGEST
    Sentinel CAD / Apify
    ↓
    crashIngestPipeline.ts
    ↓
    computeCrashFingerprint(county, lat, lng, date, type)
    ↓
    fingerprint_check → sentinel_incidents (INSERT or UPDATE)
    ↓
    enrichment_provider_log (provider='sentinel_crash', status='success')

[2] INCIDENT SCORING
    sentinel_incidents.severity → severity_score (deterministic)
    ↓
    if severity_score >= 0.50 → enrichment_queue INSERT (priority by score)
    ↓
    incident_timeline (event: 'severity_scored')

[3] ENRICHMENT (ORCHESTRATED)
    enrichment_queue → Inngest: enrichContact function
    ↓
    STEP 1: Melissa Data → address standardization
            → contact.address (USPS normalized)
            → lat/lng → territory_id assigned
    ↓
    STEP 2: BatchData → skip trace
            → skip_trace_requests (status: pending → success/not_found)
            → contact.phone, contact.email (if found)
            → enrichment_provider_log
    ↓
    STEP 3: Twilio Verify → phone carrier lookup
            → contact.phone_carrier, contact.phone_line_type
            → contact_enrichment_events (phone_validated)
    ↓
    STEP 4: Hunter.io → email validation
            → contact_enrichment_events (email_validated)
    ↓
    STEP 5: ATTOM (if severity >= 'serious')
            → contact.property_value, property_equity
            → contact_enrichment_events (property_enriched)

[4] ENTITY RESOLUTION
    isPlaceholderName(firstName) → false
    leadType = classifyParticipant(participant) → 'individual'
    identityConfidence = computeConfidence({ phone, email, address, skipTraceVerified })
    ↓
    if identityConfidence >= 0.80:
      contact.export_eligible = true
      contact_enrichment_events (export_eligible_set)
      universal_events (contact.export_eligible_set)

[5] ROUTING
    contact_routing_rules → match(source_pipeline, lead_type, county, territory)
    ↓
    contact.target_sub_account_id = matched rule target
    contact_routing_audit (rule_id, reason, sla_deadline)
    ↓
    Resend email → attorney notification
    Twilio SMS → operator alert

[6] EXPORT
    GET /api/reports/export?subAccountId=X
    → WHERE export_eligible = true
    → CSV download
    → enrichment_provider_log (request_type='export')
```

---

## Data Flow: Legal Signal → Case Intel → Attorney Distribution

```
[1] LEGAL SIGNAL INGEST
    CourtListener / CPSC / OSHA / PACER
    ↓
    legalSignalPipeline.ts / cpscRecallPipeline.ts
    ↓
    signal_fingerprint = SHA256(court_id + case_number + signal_type)
    ↓
    legal_signals (INSERT or UPDATE)
    ↓
    signal_source_health (connector: courtlistener, status: success)

[2] LEGAL HEAT SCORING
    heat_score = Σ(claimant_count × 0.30 + injury_severity × 0.25 + recency × 0.20 + ...)
    ↓
    if heat_score >= 0.60:
      legal_case_ai_summary population queued
    if heat_score >= 0.75:
      attorney distribution queued

[3] CASE INTEL POPULATION
    intelligence_cases (INSERT case linked to legal_signal_id)
    ↓
    Claude Sonnet 4.6 → case summary (if feature flag enabled)
    OR deterministic template → case_summary
    ↓
    legal_case_ai_summary (case_summary, key_facts, heat_score)
    ↓
    case_score = Σ(severity × 0.30 + contact_completeness × 0.25 + ...)

[4] ATTORNEY DISTRIBUTION
    attorney_case_preferences → match(case_type, min_heat_score, counties)
    ↓
    case_assignments (sub_account_id, sla_deadline, status='active')
    ↓
    Resend → attorney briefing email (case summary in body)
    Twilio SMS → urgent alert for heat_score >= 0.85
```

---

## Data Flow: Embedding Worker (Phase 7 — PAUSED)

```
[TRIGGER] Contact export_eligible = true
    ↓
    Inngest: embed_contact event queued

[STEP 1] Check should_re_embed
    content = buildContactEmbeddingContent(contact)
    content_hash = SHA256(content)
    existing = SELECT content_hash FROM embedding_store WHERE entity_id = contact.id
    if existing.content_hash == content_hash: SKIP (no change)

[STEP 2] Embed
    OpenAI text-embedding-3-small API call
    → embedding: vector(1536)
    → tokens_used: ~20
    ↓
    agent_outcome_log (action: 'embed_contact', tokens_used, latency_ms)

[STEP 3] Store
    UPSERT embedding_store (entity_type='contact', entity_id, embedding, content_hash)
    HNSW index auto-updated

[DAILY CAP CHECK]
    Upstash Redis counter: embeddings_today_YYYY-MM-DD
    if counter >= 2000: STOP, alert operator
    INCR counter on each successful embed

[SEMANTIC SEARCH]
    GET /api/contacts/search?q="truck driver crash Orange County"
    → Embed query → vector q
    → SELECT ... ORDER BY embedding <=> q LIMIT 50
    → Cohere Rerank API → top 10 by relevance
    → Return to operator
```

---

## Failure Mode Analysis

### What Breaks if Each Provider Goes Down

| Provider | Failure Impact | Fallback | Recovery |
|----------|--------------|---------|---------|
| **Neon Postgres** | Full platform outage | None — primary store | Neon HA + read replicas |
| **Railway** | Full platform outage | None | Railway SLA 99.9% |
| **Sentinel CAD** | 0 new crash signals | Apify scraper as backup | signal_source_health alerts after 3 failures |
| **BatchData** | Skip trace stops | Log to enrichment_queue, retry when back | max 3 attempts, exponential backoff |
| **CourtListener** | Legal signal gap | PACER as fallback (Phase 5) | signal_source_health monitors |
| **Twilio** | No SMS/voice | Resend email fallback | VAPI can continue with existing calls |
| **VAPI** | No AI voice calls | Twilio direct dial fallback | graceful degradation |
| **Resend** | No transactional email | Mailchimp transactional as fallback | queue email sends, retry |
| **OpenAI** | Embeddings + GPT-4o stop | Anthropic Claude / Gemini via aiGateway | automatic provider fallback |
| **Anthropic** | Case summaries stop | OpenAI GPT-4o via aiGateway | automatic provider fallback |
| **Apify** | Scraping stops | ScrapingBee backup | ScrapingBee already configured |
| **Cloudflare** | CDN outage; R2 unavailable | No document storage fallback | Cloudflare SLA 99.99% |
| **In-memory queue** | Railway restart → ALL queued jobs lost | **No fallback** | **Fix: add Upstash Redis** |
| **No Sentry** | Railway errors invisible | **No alerting** | **Fix: add Sentry** |

### Single Points of Failure (Current)

```
┌────────────────────────────────────────────────────────────┐
│ CRITICAL SPOFs (no failover today)                         │
│                                                            │
│  1. In-memory jobQueue.ts                                  │
│     → All jobs lost on every Railway restart               │
│     → Fix: Upstash Redis + Inngest                         │
│                                                            │
│  2. Sentinel CAD as primary crash source                   │
│     → If Sentinel degrades: 0 crash signals/day            │
│     → Fix: Apify actors as automated fallback              │
│                                                            │
│  3. BatchData as sole skip trace provider                  │
│     → No fallback enrichment if BatchData outages          │
│     → Fix: LexisNexis Accurint as Phase 6 secondary        │
│                                                            │
│  4. No external error tracking                             │
│     → Errors silently lost if DB connection fails          │
│     → Fix: Sentry (2-hour setup)                           │
│                                                            │
│  5. No log retention outside Neon                          │
│     → Cannot debug post-mortem if DB unavailable           │
│     → Fix: Axiom log drain (15-minute setup)               │
└────────────────────────────────────────────────────────────┘
```

---

## Provider Dependency Chains

### Chain 1: Crash → Export-Eligible Contact

```
Sentinel CAD ──→ crashIngestPipeline ──→ sentinel_incidents
                          │
                     BatchData ──→ skip_trace_requests ──→ contacts.phone
                          │
                   Twilio Verify ──→ contacts.phone_line_type
                          │
                    Hunter.io ──→ contacts.email_valid
                          │
              deriveExportEligible() ──→ contacts.export_eligible = true
                          │
            contact_routing_rules ──→ contact_routing_audit
                          │
                   Resend / Twilio ──→ attorney notification
```

**Longest chain: 6 hops. Every hop is a failure point. Inngest step functions isolate failure to the failing step.**

### Chain 2: Legal Signal → Attorney Distribution

```
CourtListener / CPSC ──→ legal_signals ──→ heat_score computed
                                │
                    legal_case_ai_summary ──→ Claude Sonnet
                                │
                    intelligence_cases ──→ case_score computed
                                │
                 attorney_case_preferences ──→ match
                                │
                     case_assignments ──→ SLA timer
                                │
                    Resend ──→ attorney briefing email
```

### Chain 3: Storm Event → Roofing Opportunity

```
NWS/NOAA ──→ stormEventPipeline ──→ home_service_signals
                     │
              affected_counties ──→ permit_clusters (score boost)
                     │
         vertical_icp_configs ──→ matching roofing sub-accounts
                     │
              business_opportunities ──→ INSERT
                     │
         Resend email + Twilio SMS ──→ contractor alert
```

---

## Infrastructure Topology Diagram

```
                          INTERNET
                             │
                    ┌────────┴────────┐
                    │  Cloudflare CDN  │  ✅ Live
                    │  DDoS + WAF      │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │    Railway      │  ✅ Live
                    │  Node.js App   │  ~$20–50/month
                    │  (Express)      │
                    └────────┬────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
    ┌──────┴──────┐  ┌───────┴───────┐  ┌─────┴──────┐
    │   Neon DB   │  │ Upstash Redis │  │ Cloudflare │
    │ Postgres    │  │  (❌ MISSING) │  │     R2     │
    │ 17.8 ✅     │  │  Job queue   │  │  Docs ✅   │
    │ pgvector ✅ │  │  Rate limit   │  │            │
    └─────────────┘  └───────────────┘  └────────────┘

External Providers (ingress):
  ┌────────────────────────────────────────────────────┐
  │ Sentinel CAD → Railway → sentinel_incidents        │
  │ Apify → Railway → crash_reports                    │
  │ CourtListener → Railway → legal_signals            │
  │ BatchData ← Railway ← /api/contacts/:id/skip-trace │
  │ OpenAI ← Railway ← aiGateway.ts                   │
  │ Anthropic ← Railway ← aiGateway.ts                │
  │ Twilio ← Railway ← pushAlertService.ts            │
  │ Resend ← Railway ← email notifications            │
  │ Stripe ← Railway ← subscriptionGuard.ts           │
  └────────────────────────────────────────────────────┘

Observability (❌ external gaps):
  ┌────────────────────────────────────────────────────┐
  │ Railway console → Axiom log drain (❌ not wired)   │
  │ Express errors → Sentry (❌ not configured)        │
  │ Neon DB → agent_outcome_log (✅ internal only)     │
  │ Neon DB → system_logs (✅ internal only)           │
  └────────────────────────────────────────────────────┘
```

---

## Phase Rollout Dependency Order

```
IMMEDIATE (no phase dependency)
  ├── Add Sentry (2 hours)
  ├── Add Axiom log drain (15 minutes, Railway UI)
  └── Add Upstash Redis (4 hours — replace jobQueue.ts)

PHASE 4A (requires Upstash Redis + Inngest)
  ├── Inngest workflow engine
  ├── Resend consolidation (remove SendGrid + Mailgun)
  ├── Twilio Verify phone validation
  ├── incident_fingerprint + enrichment_queue (DB)
  └── Mapbox GL JS (UI — independent)

PHASE 4B (requires Phase 4A enrichment pipeline)
  ├── Hunter.io email validation
  ├── Melissa Data address standardization
  └── AI quality scoring (contact_ai_profiles population)

PHASE 5 (requires Phase 4A/4B complete)
  ├── CPSC recall connector (free — highest priority)
  ├── OSHA signal connector (free)
  ├── PACER federal docket connector
  ├── Google Document AI OCR
  ├── ATTOM property enrichment (selective)
  └── Legal heat scoring + attorney distribution

PHASE 6 (requires Phase 5 complete)
  ├── NWS/NOAA storm events
  ├── Florida DBPR connector (activate)
  ├── Google Places activation (business intel)
  └── Permit clustering + business opportunities

PHASE 7 (requires Phase 4A and observation window cleared)
  ├── OpenAI embedding worker activation
  ├── Semantic search endpoints
  └── Cohere Rerank (optional quality layer)

PHASE 8+ (requires Phase 7)
  ├── AI copilot (Claude) — operator-facing
  ├── Workflow AI — personalized outreach
  └── Autonomous optimization — closed-loop learning
```

---

## Quick Reference: Where Each Provider Writes

| Provider | Primary Table(s) | Log Table |
|----------|-----------------|---------|
| Sentinel CAD | `sentinel_incidents` | `enrichment_provider_log`, `signal_source_health` |
| Apify | `crash_reports`, `sentinel_incidents` | `enrichment_provider_log` |
| CourtListener | `legal_signals` | `enrichment_provider_log` |
| CPSC (planned) | `legal_signals` | `signal_source_health` |
| OSHA (planned) | `legal_signals` | `signal_source_health` |
| NWS/NOAA (planned) | `home_service_signals` | `signal_source_health` |
| BatchData | `contacts`, `skip_trace_requests` | `enrichment_provider_log` |
| Melissa Data (planned) | `contacts` (address fields) | `contact_enrichment_events` |
| Twilio Verify (planned) | `contacts` (phone_carrier, phone_line_type) | `contact_enrichment_events` |
| Hunter.io (planned) | `contacts` (email_valid) | `contact_enrichment_events` |
| ATTOM (planned) | `contacts` (property fields) | `contact_enrichment_events` |
| PropertyRadar | `contacts`, `home_service_signals` | `agent_outcome_log` |
| OpenAI Embeddings | `embedding_store` | `agent_outcome_log` |
| Claude Sonnet | `legal_case_ai_summary`, `contact_ai_profiles` | `agent_outcome_log` |
| Google Document AI (planned) | `sentinel_incidents.raw_data` | `agent_outcome_log` |
| Resend | None (fire-and-forget) | `enrichment_provider_log` |
| Twilio | None (fire-and-forget) | `enrichment_provider_log` |
| Stripe | `billing_*` tables | — |
| Sentry (planned) | External — no DB write | — |
| Axiom (planned) | External — no DB write | — |
| Inngest (planned) | `enrichment_queue` (status updates) | `agent_outcome_log` |
| Upstash Redis (planned) | In-memory only — job queue | — |
