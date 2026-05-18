# APEX Feature Status Matrix
**Last Updated:** 2026-05-18

## Legend
- LIVE = Production-ready, fully functional
- PARTIAL = Works but has known gaps
- STUB = UI exists but logic not wired
- COMING-SOON = Intentionally disabled
- BROKEN = Known failure mode
- RISK = Works but has security/data risk

---

## Core Platform

| Feature | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| Multi-tenant auth (Firebase) | LIVE | LIVE | LIVE | Firebase + Passport dual-auth |
| Sub-account management | LIVE | LIVE | LIVE | |
| Billing / Stripe | LIVE | LIVE | LIVE | Subscription + credit wallet |
| Usage metering | LIVE | LIVE | LIVE | Per-call billing for AI/SMS/voice |
| Plan gating | LIVE | LIVE | LIVE | requirePlanFeature() |

## Crash / Sentinel Intelligence

| Feature | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| FHP crash signal ingestion | LIVE | — | LIVE | crashIngestPipeline.ts |
| FLHSMV enrichment | LIVE | — | LIVE | crashReportWorker.ts |
| DHSMV plate → owner lookup | LIVE | — | LIVE | dhsmvRegistrationLookup.ts |
| BatchData skip-trace | LIVE | — | LIVE | Guarded by source intelligence |
| Nimble skip-trace | LIVE | — | LIVE | nimbleClient.ts |
| Retro FLHSMV enrichment | LIVE | LIVE | LIVE | Admin POST endpoint + UI |
| Retro skip-trace | LIVE | LIVE | LIVE | retroSkipTrace.ts |
| Contact dedup | LIVE | — | LIVE | contactUpsertService.ts |
| Address confidence scoring | LIVE | — | LIVE | v2 victim-centric architecture |
| Phone confidence scoring | LIVE | — | LIVE | Source intelligence preservation |
| Sentinel config | LIVE | LIVE | LIVE | Per-account keywords + niche |
| Sentinel incidents list | LIVE | LIVE | LIVE | |
| Geofence ad deploy | LIVE | PARTIAL | PARTIAL | Meta approval needed |
| Lead distribution rules | LIVE | LIVE | LIVE | |
| Attorney routing | LIVE | LIVE | LIVE | resolver.ts |

## CRM / Contacts

| Feature | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| Contact list | LIVE | LIVE | LIVE | |
| Contact detail | LIVE | LIVE | LIVE | |
| Contact enrichment history | LIVE | LIVE | LIVE | |
| Deals pipeline | LIVE | LIVE | LIVE | |
| Appointments | LIVE | LIVE | LIVE | |
| Notes / activity log | LIVE | LIVE | LIVE | |

## Messaging

| Feature | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| SMS (Twilio) | LIVE | LIVE | LIVE | Unified billing |
| WhatsApp (Meta) | LIVE | LIVE | PARTIAL | Meta App Review required |
| Email (SendGrid) | LIVE | LIVE | LIVE | Sender verification flow |
| Voice (Vapi) | LIVE | LIVE | LIVE | |
| Inbox (unified) | LIVE | LIVE | LIVE | |
| Telegram bot | LIVE | PARTIAL | PARTIAL | Token-based, not all accounts |

## Reputation / Reviews

| Feature | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| Review list | LIVE | RISK | RISK | Frontend hardcodes accountId=1 |
| Review reply | LIVE | LIVE | LIVE | |
| AI review response | LIVE | LIVE | LIVE | |
| Google/Trustpilot links | LIVE | LIVE | LIVE | |
| Alert owner on bad review | LIVE | LIVE | LIVE | SMS via Twilio |

## Domain Manager

| Feature | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| Domain availability check | LIVE | LIVE | LIVE | RDAP-based |
| Domain search (multi-TLD) | LIVE | LIVE | LIVE | 30+ TLDs |
| Domain purchase (reserve) | LIVE | LIVE | LIVE | Reserving only — external registrar |
| DNS verification (TXT) | LIVE | LIVE | LIVE | |
| SSL configuration | STUB | LIVE | STUB | Returns "manual setup required" |
| Custom domain routing | LIVE | — | LIVE | middleware/customDomain.ts |

## Digital Card

| Feature | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| Card creation (sub-account) | LIVE | LIVE | LIVE | |
| Card public view | LIVE | LIVE | LIVE | /card/:slug |
| vCard download | LIVE | LIVE | LIVE | |
| Card analytics (views/clicks) | LIVE | LIVE | LIVE | |
| Card purchase (standalone) | LIVE | LIVE | LIVE | Stripe one-time payment |
| Card edit (token) | LIVE | LIVE | LIVE | Edit token system |

## Dynamic Pages

| Feature | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| Prompt → schema generation | LIVE | LIVE | LIVE | Groq/OpenAI/Gemini |
| Schema patching (incremental) | LIVE | LIVE | LIVE | Local patch engine first |
| Schema save | PARTIAL | LIVE | PARTIAL | In-memory only — no DB |
| Schema publish | PARTIAL | LIVE | PARTIAL | In-memory only — no DB |
| sitemap.xml | LIVE | — | PARTIAL | Only published in-memory pages |
| robots.txt | LIVE | — | LIVE | |
| llms.txt | LIVE | — | LIVE | |
| Structured data (JSON-LD) | LIVE | — | PARTIAL | Per published page |
| 90+ niche templates | LIVE | LIVE | LIVE | 18 industry categories |

## AI / Workflows

| Feature | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| AI chat (multi-provider) | LIVE | LIVE | LIVE | Anthropic → OpenAI → Groq → Gemini |
| AI streaming | LIVE | LIVE | LIVE | |
| Groq free tier | LIVE | — | LIVE | As fallback provider |
| Workflow automation | LIVE | LIVE | LIVE | BullMQ-backed |
| Operator brain | LIVE | — | LIVE | Persistent agent with memory |
| A/B testing | LIVE | LIVE | LIVE | |
| Content planner | LIVE | LIVE | LIVE | |
| Email campaigns | LIVE | LIVE | PARTIAL | Template system partial |

## Meta / Ads

| Feature | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| Meta OAuth | LIVE | LIVE | LIVE | |
| Lead forms | LIVE | LIVE | LIVE | |
| Meta messaging (DMs) | LIVE | LIVE | LIVE | |
| Ad creation | PARTIAL | LIVE | PARTIAL | Meta App Review required for ads |
| Google Ads | STUB | STUB | COMING-SOON | Not implemented |

## Admin / Internal

| Feature | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| Admin console | LIVE | LIVE | LIVE | isPlatformAdmin() gated |
| Profit report | LIVE | LIVE | LIVE | |
| System pulse health check | LIVE | LIVE | LIVE | |
| Message failure analysis | LIVE | LIVE | LIVE | |
| AI usage budget report | LIVE | LIVE | LIVE | Stage 5 registry |
| Emergency shutdown | LIVE | — | LIVE | setEmergencyShutdown() |
