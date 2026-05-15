# APEX PROVIDER MATRIX
**Side-by-Side Comparison of All Connectors by Category**
Version: 1.0 | Generated: 2026-05-15

Legend:
- Status: ✅ Live | 🔄 Activate (configured but idle) | 📋 Planned | ❌ Not integrated
- Tier: 🔴 Critical | 🟡 Recommended | 🟠 Optional | 🟢 Future

---

## Infrastructure

| Provider | Status | Tier | Phase | Cost/Month | Key Capability | Gap Filled |
|----------|--------|------|-------|-----------|---------------|-----------|
| **Neon Postgres** | ✅ Live | 🔴 Critical | Foundation | ~$19 (Pro) | Primary DB, pgvector | — |
| **Railway** | ✅ Live | 🔴 Critical | Foundation | ~$20–50 | App hosting | — |
| **Cloudflare CDN** | ✅ Live | 🔴 Critical | Foundation | ~$0 | CDN, R2 storage | — |
| **Upstash Redis** | ❌ Not integrated | 🔴 Critical | Immediate | $0–15 | Persistent job queue, rate limiting | Replaces in-memory queue — jobs survive restarts |
| **Cloudflare R2 (expand)** | 🔄 Activate | 🟡 Recommended | Phase 4A | < $1 | Document/PDF storage | Raw crash report PDF storage |

**Why Upstash over self-hosted Redis:** Railway doesn't support persistent volumes reliably. Upstash is serverless, has zero DevOps overhead, and is $0 for current volume.

**Why NOT:** Render Redis, Fly.io Redis, ElastiCache — all require ops overhead Apex cannot sustain on Railway.

---

## Observability

| Provider | Status | Tier | Phase | Cost/Month | Key Capability | Gap Filled |
|----------|--------|------|-------|-----------|---------------|-----------|
| `system_logs` table | ✅ Live | 🟡 Recommended | Foundation | $0 | In-app log query | — |
| `agent_outcome_log` | ✅ Live | 🔴 Critical | Stage 3 | $0 | AI/worker audit trail | — |
| **Sentry** | ❌ Not integrated | 🔴 Critical | Immediate | $0–26 | Error tracking, alerting | Zero visibility into Railway crashes |
| **Axiom** | ❌ Not integrated | 🔴 Critical | Immediate | $0 | Log aggregation, Railway log drain | Cannot query logs without DB access |
| PostHog | ❌ Not integrated | 🟢 Future | Phase 6 | $0–42 | Product analytics, operator behavior | Operator workflow optimization |
| Datadog | ❌ Not integrated | 🟢 Future | Phase 8 | $15–80 | APM, infrastructure monitoring | Overkill until Apex reaches $10K+ MRR |

**Why Sentry over Datadog:** Sentry's error tracking is best-in-class. Datadog APM adds cost and complexity not justified at current scale.

**Why Axiom over Papertrail/Logtail:** Axiom has a Railway-native log drain (15-minute setup), SQL-like query language, and the best free tier for Apex's log volume.

**Priority:** Both Sentry and Axiom can be configured in under 2 hours total. No code changes needed for Axiom (Railway log drain). Sentry requires adding `@sentry/node` and one `Sentry.init()` call.

---

## Communications

| Provider | Status | Tier | Phase | Cost/Month | Key Capability | Gap Filled |
|----------|--------|------|-------|-----------|---------------|-----------|
| **Twilio** | ✅ Live | 🔴 Critical | Foundation | Pay-per-use | SMS + voice carrier | — |
| **VAPI** | ✅ Live | 🔴 Critical | Foundation | Pay-per-min | AI voice calls | — |
| **ElevenLabs** | ✅ Live | 🟡 Recommended | Foundation | $5–22 | Voice synthesis | — |
| **Resend** | ✅ Live | 🔴 Critical | Foundation | $0–20 | Transactional email | **Consolidate all email here** |
| Mailchimp | ✅ Live | 🟡 Recommended | Foundation | $13+ | Email marketing campaigns | Keep for drip/marketing only |
| SendGrid | ✅ Live | ⚠️ Redundant | — | $15+ | Transactional email | **Deactivate — Resend handles this** |
| Mailgun | ✅ Live | ⚠️ Redundant | — | $15+ | Transactional email | **Deactivate — Resend handles this** |
| **Twilio Verify** | ❌ Not integrated | 🟡 Recommended | Phase 4A | ~$0.01/lookup | Phone carrier + validation | Phone quality gate before export_eligible |

**Consolidation recommendation:** Keep Resend (transactional) + Mailchimp (marketing). Remove SendGrid and Mailgun from Railway env and deactivate. This reduces $30+/month in redundant spend and eliminates split deliverability metrics.

**Twilio Verify vs. alternatives:**

| Provider | Cost | Line Type | Carrier | Validation |
|----------|------|-----------|---------|-----------|
| Twilio Verify | $0.01/lookup | ✅ | ✅ | ✅ |
| Numverify | $0.004/lookup | ✅ | ✅ | ✅ |
| AbstractAPI | $0.005/lookup | ✅ | Limited | ✅ |
| **Recommendation** | **Twilio** — already have account, unified billing |

---

## Signal Ingestion

| Provider | Status | Tier | Phase | Cost/Month | Signal Type | Volume |
|----------|--------|------|-------|-----------|------------|--------|
| **Sentinel CAD** | ✅ Live | 🔴 Critical | Foundation | ~$50–200 | Crash/CAD incidents | ~960/day |
| **Apify** | ✅ Live | 🟡 Recommended | Foundation | Pay-per-compute | Web scraping (crashes, attorneys) | ~100/day |
| **ScrapingBee** | ✅ Live | 🟠 Optional | Foundation | Pay-per-credit | Web scraping (backup) | Variable |
| **Nimble** | ✅ Live | 🟠 Optional | Foundation | Pay-per-call | Web data extraction | Variable |
| **CourtListener** | ✅ Live | 🔴 Critical | Foundation | $0 | Federal/state legal filings | ~500/day |
| **Hillsborough filings** | ✅ Live | 🟡 Recommended | Foundation | $0 | County court records | Variable |
| **CPSC API** | ❌ Not integrated | 🟡 Recommended | Phase 5 | $0 | Product recall signals | ~25/week |
| **OSHA API** | ❌ Not integrated | 🟡 Recommended | Phase 5 | $0 | Workplace violation signals | ~20/week |
| **NWS/NOAA** | ❌ Not integrated | 🟡 Recommended | Phase 6 | $0 | Storm events | ~10/week in FL |
| **PACER** | ❌ Not integrated | 🟠 Optional | Phase 5 | ~$10–30 | Federal court dockets | ~50/week |
| Florida DBPR | 🔄 Activate | 🟡 Recommended | Phase 6 | $0 | Business license changes | ~100/week |

**Scraper rationalization:**

| Provider | Capability | Cost | Recommendation |
|----------|-----------|------|---------------|
| Apify | Actors ecosystem, crash scraping | Pay-per-compute | **Keep — primary** |
| ScrapingBee | Simple JS-rendered pages | Pay-per-credit | **Keep — backup** |
| Nimble | AI-powered extraction | Pay-per-call | **Evaluate — may overlap with Apify** |

---

## Enrichment

| Provider | Status | Tier | Phase | Cost/Month | Capability | Data Quality |
|----------|--------|------|-------|-----------|-----------|-------------|
| **BatchData** | ✅ Live | 🔴 Critical | Foundation | Pay-per-lookup | Skip trace, people search | ⭐⭐⭐⭐ |
| **PropertyRadar** | ✅ Live | 🟡 Recommended | Foundation | $49–149 | Property distress, owner data | ⭐⭐⭐⭐ |
| **RentCast** | ✅ Live | 🟠 Optional | Foundation | $29–119 | Rental property data | ⭐⭐⭐ |
| **Melissa Data** | ❌ Not integrated | 🟡 Recommended | Phase 4A | $60–145 | Address standardization, USPS | ⭐⭐⭐⭐⭐ |
| **Hunter.io** | ❌ Not integrated | 🟡 Recommended | Phase 4B | $34–104 | Email validation | ⭐⭐⭐⭐ |
| **Twilio Verify** | ❌ Not integrated | 🟡 Recommended | Phase 4A | ~$14 | Phone validation, carrier | ⭐⭐⭐⭐ |
| **ATTOM Data** | ❌ Not integrated | 🟠 Optional | Phase 5 | $75–450 | Property AVM, liens, tax | ⭐⭐⭐⭐⭐ |
| LexisNexis Accurint | ❌ Not integrated | 🟢 Future | Phase 6 | $500+ | Alt skip trace (enterprise) | ⭐⭐⭐⭐⭐ |
| TLO (TransUnion) | ❌ Not integrated | 🟢 Future | Phase 6 | $500+ | Alt skip trace (enterprise) | ⭐⭐⭐⭐⭐ |

**Skip trace competitive comparison:**

| Provider | Hit Rate | Data Freshness | Cost/Lookup | Phone Quality | Email Quality |
|----------|----------|---------------|------------|--------------|--------------|
| **BatchData** | 65–75% | 30–90 days | ~$0.50–2.00 | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| LexisNexis Accurint | 80–90% | 7–30 days | ~$1.50–5.00 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| TLO | 75–85% | 14–60 days | ~$1.00–3.00 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Recommendation** | Stick with BatchData until hit rate < 50%, then add Accurint as fallback |

**Address standardization comparison:**

| Provider | USPS Validation | Geocoding | ZIP+4 | Cost/Record |
|----------|----------------|-----------|-------|------------|
| **Melissa** | ✅ | ✅ | ✅ | $0.002–0.005 |
| Google Maps Geocoding | ❌ | ✅ | ❌ | $0.005 |
| USPS Web Tools | ✅ | ❌ | ✅ | $0 |
| SmartyStreets | ✅ | ✅ | ✅ | $0.003 |
| **Recommendation** | **Melissa** — best data quality, competitive price, USPS certified |

---

## Territory Intelligence

| Provider | Status | Tier | Phase | Cost/Month | Capability |
|----------|--------|------|-------|-----------|-----------|
| **Google Maps Geocoding** | ✅ Live | 🔴 Critical | Foundation | ~$0–50 | Address → lat/lng | 
| **Google Maps Routes** | ✅ Live | 🟡 Recommended | Foundation | Pay-per-call | Distance matrix |
| **Mapbox GL JS** | ❌ Not integrated | 🟡 Recommended | Phase 4A UI | $0–50 | Interactive map rendering |
| Leaflet.js + OpenStreetMap | ❌ Not integrated | 🟠 Optional | Phase 4A UI | $0 | Free map rendering alternative |
| HERE Maps | ❌ Not integrated | 🟢 Future | Phase 6 | Pay-per-call | Alternative geocoding (if Google costs rise) |

**Map rendering comparison:**

| Provider | Rendering | Custom Layers | Heatmap | Cost | Recommendation |
|----------|-----------|---------------|---------|------|---------------|
| **Mapbox GL JS** | WebGL (fast) | ✅ | ✅ Native | $0–50/month | **Recommended** |
| Google Maps JS | DOM-based | ✅ | Custom only | $0–200/month | High cost at scale |
| Leaflet + OSM | DOM-based | ✅ | Plugin required | $0 | Lower quality, acceptable for MVP |
| **Recommendation** | **Mapbox** for heatmap-heavy views; Leaflet if budget is constrained |

---

## Workflow Orchestration

| Provider | Status | Tier | Phase | Cost/Month | Capability | Gap Filled |
|----------|--------|------|-------|-----------|-----------|-----------|
| **In-memory jobQueue.ts** | ✅ Live | ⚠️ Replace | — | $0 | Background jobs | **Critical gap: lost on restart** |
| **Inngest** | ❌ Not integrated | 🔴 Critical | Phase 4A | $0–20 | Durable step functions, cron, retry | Replaces in-memory queue |
| **Upstash Redis + BullMQ** | ❌ Not integrated | 🟡 Recommended | Phase 4A | $0–15 | Persistent queue (Redis-backed) | Rate limiting, caching (complementary) |
| Temporal | ❌ Not integrated | 🟢 Future | Phase 8 | $200+ | Enterprise workflow orchestration | Overkill until Apex has 10+ worker types |
| n8n (self-hosted) | ❌ Not integrated | 🟢 Future | Phase 8 | $0 | No-code workflow builder | Useful for non-engineer-built workflows |

**Workflow orchestration comparison:**

| Provider | Durable | Retries | Step-level | Cron | Cost | Complexity |
|----------|---------|---------|-----------|------|------|-----------|
| **Inngest** | ✅ | ✅ | ✅ | ✅ | $0–20 | Low |
| BullMQ + Redis | ✅ | ✅ | ❌ | ✅ | $0–15 | Medium |
| Temporal | ✅ | ✅ | ✅ | ✅ | $200+ | High |
| **Current (in-memory)** | ❌ | ❌ | ❌ | ❌ | $0 | Low |
| **Recommendation** | **Inngest** for workflow orchestration + **Upstash Redis** for rate limiting/caching — complementary roles |

---

## AI / Memory

| Provider | Status | Tier | Phase | Cost/Month | Model | Use Case |
|----------|--------|------|-------|-----------|-------|---------|
| **Anthropic Claude** | ✅ Live | 🔴 Critical | Foundation | Pay-per-token | claude-sonnet-4-6 | Case summaries, triage, copilot |
| **OpenAI GPT-4o** | ✅ Live | 🔴 Critical | Foundation | Pay-per-token | gpt-4o | AI gateway fallback, structured extraction |
| **OpenAI Embeddings** | 🔄 Activate | 🔴 Critical | Phase 7 | ~$0.30/month | text-embedding-3-small | Semantic search, memory |
| **Google Gemini** | ✅ Live | 🟠 Optional | Foundation | Pay-per-token | gemini-pro | AI gateway fallback |
| **ElevenLabs** | ✅ Live | 🟡 Recommended | Foundation | $5–22 | TTS | Voice synthesis for VAPI calls |
| Cohere Rerank | ❌ Not integrated | 🟠 Optional | Phase 7 | ~$3 | rerank-v3.5 | Semantic search precision |
| Pinecone | ❌ Not integrated | 🟢 Future | Phase 9 | $70+ | Vector DB | Overkill — pgvector handles this |
| LangSmith | ❌ Not integrated | 🟢 Future | Phase 9 | $39+ | LLM observability | Useful when LLM calls exceed 10K/day |

**AI provider cost comparison (per 1M tokens):**

| Provider | Input | Output | Embedding | Best For |
|----------|-------|--------|-----------|---------|
| Claude Sonnet 4.6 | $3.00 | $15.00 | N/A | Long reasoning, case summaries |
| GPT-4o | $5.00 | $15.00 | N/A | Structured JSON extraction |
| GPT-4o-mini | $0.15 | $0.60 | N/A | High-volume triage notes |
| text-embedding-3-small | N/A | N/A | $0.02 | Semantic search (primary) |
| text-embedding-3-large | N/A | N/A | $0.13 | Higher precision (6.5× cost) |
| Gemini 2.0 Flash | $0.10 | $0.40 | N/A | High-volume fallback |
| **Recommendation** | Claude Sonnet for quality tasks; GPT-4o-mini for volume tasks; text-embedding-3-small for all embeddings |

---

## Semantic Retrieval

| Provider | Status | Tier | Phase | Cost/Month | Capability |
|----------|--------|------|-------|-----------|-----------|
| **pgvector + HNSW** | ✅ Live | 🔴 Critical | Phase 7 | $0 (within Neon) | Vector similarity search |
| **OpenAI Embeddings** | 🔄 Activate | 🔴 Critical | Phase 7 | ~$0.30 | Text → vector conversion |
| **Cohere Rerank** | ❌ Not integrated | 🟠 Optional | Phase 7 | ~$3 | Re-rank search results |
| Pinecone | ❌ Not integrated | 🟢 Future | Phase 9 | $70+ | Managed vector DB |
| Weaviate | ❌ Not integrated | 🟢 Future | Phase 9 | $25+ | Managed vector DB |
| Qdrant | ❌ Not integrated | 🟢 Future | Phase 9 | $25+ | Managed vector DB |

**Why stay with pgvector:** At 38K vectors, pgvector HNSW delivers 2–5ms query latency. The break-even where a managed vector DB becomes worthwhile is approximately 10M vectors. Apex is at 0.4% of that threshold. Pinecone and Weaviate add operational cost and complexity with zero performance benefit at this scale.

---

## Legal Intelligence

| Provider | Status | Tier | Phase | Cost/Month | Coverage |
|----------|--------|------|-------|-----------|---------|
| **CourtListener** | ✅ Live | 🔴 Critical | Foundation | $0 | Federal + state court filings |
| **Hillsborough county** | ✅ Live | 🟡 Recommended | Foundation | $0 | County court records |
| **CPSC API** | ❌ Not integrated | 🟡 Recommended | Phase 5 | $0 | Product recall signals |
| **OSHA API** | ❌ Not integrated | 🟡 Recommended | Phase 5 | $0 | Workplace violations |
| **PACER** | ❌ Not integrated | 🟠 Optional | Phase 5 | $10–30 | Federal dockets + complaint text |
| Bloomberg Law | ❌ Not integrated | 🟢 Future | Phase 9 | $500+ | Premium legal research |
| LexisNexis | ❌ Not integrated | 🟢 Future | Phase 9 | $500+ | Premium legal research |
| Dun & Bradstreet | ❌ Not integrated | 🟢 Future | Phase 6 | $200+ | Business entity intelligence |

**Free legal signal sources available immediately:**

| Source | Endpoint | Data | Latency |
|--------|---------|------|---------|
| CPSC | api.cpsc.gov | Product recalls | 6-hour poll |
| OSHA | data.osha.gov | Workplace violations | Weekly poll |
| CourtListener | courtlistener.com/api | Federal/state cases | Real-time alerts |
| PACER | pacer.gov | Federal dockets | Weekly poll ($0.10/page) |
| Florida courts | myflcourtaccess.com | FL state cases | Varies by county |

---

## Property Intelligence

| Provider | Status | Tier | Phase | Cost/Month | Data Type |
|----------|--------|------|-------|-----------|---------|
| **PropertyRadar** | ✅ Live | 🟡 Recommended | Foundation | $49–149 | Distress signals, pre-foreclosure |
| **RentCast** | ✅ Live | 🟠 Optional | Foundation | $29–119 | Rental market data |
| **ATTOM Data** | ❌ Not integrated | 🟠 Optional | Phase 5 | $75–450 | AVM, liens, tax records |
| CoreLogic | ❌ Not integrated | 🟢 Future | Phase 6 | $500+ | Full property data suite |
| Regrid | ❌ Not integrated | 🟢 Future | Phase 6 | $25–150 | Parcel boundaries, GIS |
| First American | ❌ Not integrated | 🟢 Future | Phase 7 | $500+ | Title + deed records |

**Property data comparison:**

| Provider | AVM | Liens | Owner | Foreclosure | Parcel | Cost |
|----------|-----|-------|-------|------------|-------|------|
| **PropertyRadar** | ✅ | Limited | ✅ | ✅ | ❌ | $49–149 |
| ATTOM | ✅ | ✅ | ✅ | ✅ | ✅ | $75–450 |
| CoreLogic | ✅ | ✅ | ✅ | ✅ | ✅ | $500+ |
| RentCast | ❌ | ❌ | ❌ | ❌ | ❌ | $29–119 |
| **Recommendation** | PropertyRadar sufficient for Phase 5; add ATTOM when lien data needed for PI quality scoring |

---

## Business Intelligence

| Provider | Status | Tier | Phase | Cost/Month | Capability |
|----------|--------|------|-------|-----------|-----------|
| **Google Places** | ✅ Live | 🔴 Critical | Phase 6 | ~$0 (free credit) | Business listings, ratings |
| **Florida DBPR** | 🔄 Activate | 🟡 Recommended | Phase 6 | $0 | License issuance/suspension |
| **NWS/NOAA** | ❌ Not integrated | 🟡 Recommended | Phase 6 | $0 | Storm events |
| Yelp Fusion | ❌ Not integrated | 🟠 Optional | Phase 6 | $0 | Business ratings (Yelp-specific) |
| SerpAPI | ❌ Not integrated | 🟠 Optional | Phase 6 | $50–150 | Google search intelligence |
| Florida SoS API | ❌ Not integrated | 🟠 Optional | Phase 6 | $0 | State business registrations |

**Google Places vs. Yelp:**

| Feature | Google Places | Yelp Fusion |
|---------|--------------|-------------|
| Coverage | Superior | Good |
| Review volume | Higher | Lower for trades |
| API access | Already configured | Requires new account |
| Real-time data | ✅ | ✅ |
| Cost | Already paying | Free tier limited |
| **Recommendation** | **Google Places first** — already integrated, superior coverage |

---

## Document Intelligence

| Provider | Status | Tier | Phase | Cost/Month | Capability |
|----------|--------|------|-------|-----------|-----------|
| **Google Document AI** | ❌ Not integrated | 🟡 Recommended | Phase 5 | ~$25–86 | OCR + form parsing |
| AWS Textract | ❌ Not integrated | 🟠 Optional | Phase 5 | ~$15–50 | OCR + table extraction |
| Azure Document Intelligence | ❌ Not integrated | 🟠 Optional | Phase 5 | ~$15–50 | OCR + layout analysis |
| Unstructured.io | ❌ Not integrated | 🟠 Optional | Phase 5 | $0–30 | Open-source doc parsing |
| Adobe PDF Services | ❌ Not integrated | 🟢 Future | Phase 7 | $0.05/page | PDF manipulation |

**Document AI comparison:**

| Provider | OCR Accuracy | Form Parsing | Tables | Handwriting | Cost/1K pages |
|----------|-------------|-------------|--------|------------|--------------|
| **Google Document AI** | 97% | ✅ Excellent | ✅ | ✅ | $1.50 |
| AWS Textract | 96% | ✅ Good | ✅ | Limited | $1.50 |
| Azure Doc Intelligence | 96% | ✅ Good | ✅ | ✅ | $1.50 |
| Unstructured.io | 89–93% | ✅ Good | ✅ | ❌ | $0 (self-hosted) |
| **Recommendation** | **Google Document AI** — best form parsing for crash reports; Google already billing relationship |

---

## Master Decision Table

| Provider | Category | Status | Tier | Phase | Monthly Cost | Decision |
|----------|----------|--------|------|-------|-------------|---------|
| Neon Postgres | Infrastructure | ✅ Live | 🔴 Critical | Foundation | $19 | Keep |
| Railway | Infrastructure | ✅ Live | 🔴 Critical | Foundation | $20–50 | Keep |
| Cloudflare | Infrastructure | ✅ Live | 🔴 Critical | Foundation | ~$0 | Expand to R2 |
| **Upstash Redis** | Infrastructure | ❌ Missing | 🔴 Critical | Immediate | $0–15 | **Add now** |
| **Sentry** | Observability | ❌ Missing | 🔴 Critical | Immediate | $0–26 | **Add now** |
| **Axiom** | Observability | ❌ Missing | 🔴 Critical | Immediate | $0 | **Add now (log drain)** |
| Twilio | Communications | ✅ Live | 🔴 Critical | Foundation | Pay-per-use | Keep |
| VAPI | Communications | ✅ Live | 🔴 Critical | Foundation | Pay-per-min | Keep |
| ElevenLabs | Communications | ✅ Live | 🟡 Recommended | Foundation | $5–22 | Keep |
| **Resend (consolidate)** | Communications | ✅ Live | 🔴 Critical | Phase 4A | $0–20 | **Consolidate to Resend; remove SendGrid + Mailgun** |
| Mailchimp | Communications | ✅ Live | 🟡 Recommended | Foundation | $13+ | Keep (marketing only) |
| SendGrid | Communications | ✅ Live | ⚠️ Redundant | — | $15+ | **Deactivate** |
| Mailgun | Communications | ✅ Live | ⚠️ Redundant | — | $15+ | **Deactivate** |
| **Twilio Verify** | Communications | ❌ Missing | 🟡 Recommended | Phase 4A | ~$14 | **Add Phase 4A** |
| Sentinel CAD | Signal Ingestion | ✅ Live | 🔴 Critical | Foundation | $50–200 | Keep |
| Apify | Signal Ingestion | ✅ Live | 🟡 Recommended | Foundation | Pay-per-compute | Keep (primary scraper) |
| ScrapingBee | Signal Ingestion | ✅ Live | 🟠 Optional | Foundation | Pay-per-credit | Keep (backup) |
| Nimble | Signal Ingestion | ✅ Live | 🟠 Optional | Foundation | Pay-per-call | Evaluate overlap |
| CourtListener | Signal Ingestion | ✅ Live | 🔴 Critical | Foundation | $0 | Keep |
| **CPSC API** | Signal Ingestion | ❌ Missing | 🟡 Recommended | Phase 5 | $0 | **Add Phase 5** |
| **OSHA API** | Signal Ingestion | ❌ Missing | 🟡 Recommended | Phase 5 | $0 | **Add Phase 5** |
| **NWS/NOAA** | Signal Ingestion | ❌ Missing | 🟡 Recommended | Phase 6 | $0 | **Add Phase 6** |
| **PACER** | Signal Ingestion | ❌ Missing | 🟠 Optional | Phase 5 | $10–30 | **Add Phase 5** |
| BatchData | Enrichment | ✅ Live | 🔴 Critical | Foundation | Pay-per-lookup | Keep |
| PropertyRadar | Enrichment | ✅ Live | 🟡 Recommended | Foundation | $49–149 | Keep |
| RentCast | Enrichment | ✅ Live | 🟠 Optional | Foundation | $29–119 | Evaluate ROI |
| **Melissa Data** | Enrichment | ❌ Missing | 🟡 Recommended | Phase 4A | $60–145 | **Add Phase 4A** |
| **Hunter.io** | Enrichment | ❌ Missing | 🟡 Recommended | Phase 4B | $34–104 | **Add Phase 4B** |
| **ATTOM Data** | Enrichment | ❌ Missing | 🟠 Optional | Phase 5 | $75–450 | **Add Phase 5** |
| Google Maps | Territory | ✅ Live | 🔴 Critical | Foundation | ~$0–50 | Keep |
| **Mapbox GL JS** | Territory | ❌ Missing | 🟡 Recommended | Phase 4A UI | $0–50 | **Add Phase 4A** |
| **Inngest** | Orchestration | ❌ Missing | 🔴 Critical | Phase 4A | $0–20 | **Add Phase 4A** |
| Anthropic Claude | AI | ✅ Live | 🔴 Critical | Foundation | Pay-per-token | Keep |
| OpenAI GPT-4o | AI | ✅ Live | 🔴 Critical | Foundation | Pay-per-token | Keep |
| **OpenAI Embeddings** | AI | 🔄 Activate | 🔴 Critical | Phase 7 | ~$0.30 | **Activate Phase 7** |
| Google Gemini | AI | ✅ Live | 🟠 Optional | Foundation | Pay-per-token | Keep (fallback) |
| **Cohere Rerank** | Semantic | ❌ Missing | 🟠 Optional | Phase 7 | ~$3 | **Add Phase 7** |
| pgvector | Semantic | ✅ Live | 🔴 Critical | Phase 7 | $0 | Keep |
| **Google Document AI** | Document | ❌ Missing | 🟡 Recommended | Phase 5 | $25–86 | **Add Phase 5** |
| Stripe | Billing | ✅ Live | 🔴 Critical | Foundation | % of revenue | Keep |
| Meta Ads | Marketing | ✅ Live | 🟡 Recommended | Foundation | Pay-per-ad | Keep |
| Google Calendar | Scheduling | ✅ Live | 🟠 Optional | Foundation | $0 | Keep |
| Calendly | Scheduling | ✅ Live | 🟠 Optional | Foundation | $0–12 | Keep |

---

## Estimated Monthly Cost Delta (Adding Recommended Connectors)

| Addition | Monthly Cost |
|----------|-------------|
| Upstash Redis | $0–15 |
| Sentry | $0–26 |
| Axiom | $0 |
| Inngest | $0–20 |
| Twilio Verify | ~$14 |
| Melissa Data | $60–145 |
| Hunter.io | $34–104 |
| Mapbox GL JS | $0–50 |
| **Total additions** | **$108–374/month** |
| **Savings (remove SendGrid + Mailgun)** | **-$30/month** |
| **Net addition** | **$78–344/month** |

Vendors to deactivate (cost savings):
- SendGrid: remove (Resend replaces)
- Mailgun: remove (Resend replaces)
- Evaluate Nimble ROI vs. Apify overlap
- Evaluate RentCast ROI vs. PropertyRadar overlap
