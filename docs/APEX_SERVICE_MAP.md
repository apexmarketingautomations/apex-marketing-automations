# APEX Service Integration Map
**Last Updated:** 2026-05-18

---

## AI Providers

| Provider | Purpose | Priority | Free? | Config Key | Status |
|---|---|---|---|---|---|
| Anthropic (Claude Sonnet 4.6) | Primary LLM — complex reasoning, operator brain | 1st | No | `ANTHROPIC_API_KEY` | LIVE |
| OpenAI (gpt-4o-mini) | Fallback LLM | 2nd | No | `OPENAI_APEX_INT_KEY` | LIVE |
| Groq (llama-3.1-8b / 70b) | Free-tier fallback; forceProvider support | 3rd | Yes | `GROQ_API_KEY` | LIVE |
| Gemini 2.5 Flash | Final fallback; image generation | Last | Low-cost | `GEMINI_API_KEY_` | LIVE |
| OpenAI DALL-E 3 | Image generation (primary) | 1st for images | No | Same as OpenAI key | LIVE |

### AI Routing Chain (aiGateway.ts)
```
selectProvider() → Anthropic → (quota fail → Gemini)
                               → (success → done)
                 → OpenAI → (fail → Groq → Gemini)
                 → Gemini (always available if key set)

forceProvider: "groq" → Groq → fallback to normal chain
```

### Cost Control Gaps
- No per-account daily quota enforcement
- No task-complexity-based routing (all tasks hit Anthropic first when key is set)
- Simple patches like "make it darker" call full Anthropic — should use local patch engine or Groq
- `applyLocalPromptPatch()` exists in client but server doesn't have equivalent pre-filter

---

## Communication Providers

| Provider | Purpose | Config Key | Status |
|---|---|---|---|
| Twilio | SMS outbound/inbound, number provisioning | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | LIVE |
| Vapi | Voice AI agents, call recording | `VAPI_PRIVATE_KEY_APEX` | LIVE |
| SendGrid | Transactional email, sender verification | `SENDGRID_API_KEY` | LIVE |
| Meta / Facebook | WhatsApp, Instagram DMs, lead forms | `metaAccessToken` (per account) | LIVE |
| Telegram | Bot messaging | `telegramBotToken` (per account) | PARTIAL |

---

## Data / Enrichment Providers

| Provider | Purpose | Config Key | Status |
|---|---|---|---|
| FLHSMV | Florida driver license lookup | Nimble proxy (no direct key) | LIVE |
| DHSMV | Florida vehicle registration | Nimble proxy (no direct key) | LIVE |
| Nimble | Residential proxy for govt lookups | `NIMBLE_API_KEY` | LIVE |
| BatchData | Skip-trace / phone lookup | `BATCHDATA_API_KEY` | LIVE |
| Apify | Attorney scraping, web scraping | `APIFY_API_TOKEN` | LIVE |
| ScrapingBee | Web scraping fallback | `SCRAPINGBEE_API_KEY` | LIVE |
| RDAP.org | Domain availability checking | None (public API) | LIVE |
| Google Geocoding | Address verification, residential confirmation | `GOOGLE_MAPS_API_KEY` | LIVE |
| Google Places | Business phone lookup | Same key | LIVE |

---

## Infrastructure

| Service | Purpose | Config | Status |
|---|---|---|---|
| Neon (PostgreSQL) | Primary database + pgvector | `DATABASE_URL` | LIVE |
| Railway | Deployment platform | Railway dashboard | LIVE |
| Firebase | Authentication | `FIREBASE_*` keys | LIVE |
| Stripe | Billing, subscriptions, credit wallets | `STRIPE_SECRET_KEY` | LIVE |
| BullMQ | Job queue (in-memory, no Redis) | None | LIVE |

---

## Third-Party Integrations (UI-facing)

| Integration | Status | Notes |
|---|---|---|
| Mailchimp | PARTIAL | routes/mailchimp.ts — webhook sync |
| Google Calendar | PARTIAL | googleCalendarSync.ts |
| Chaturbate | PARTIAL | routes/chaturbate.ts — token-based |
| Court Listener | LIVE | courtListenerPipeline.ts |
| Hillsborough County | LIVE | hillsboroughRecordsPipeline.ts |
| DOL Safety | LIVE | dolSafetyPipeline.ts |

---

## Internal Services

| Service | File | Purpose |
|---|---|---|
| Crash Ingest Pipeline | server/crashIngestPipeline.ts | FHP signal → crash_reports |
| Crash Report Worker | server/crashReportWorker.ts | crash_reports → FLHSMV → contacts |
| Retro FLHSMV Enrich | server/retroFLHSMVEnrich.ts | Batch recover names on placeholders |
| Retro Skip-Trace | server/retroSkipTrace.ts | Batch recover phones |
| Contact Upsert Service | server/services/contactUpsertService.ts | All contact writes (dedup entry point) |
| Operator Brain | server/operator/agentBrain.ts | Persistent AI agent |
| Goal Engine | server/operator/goalEngine.ts | Goal tracking |
| Routing Resolver | server/routing/resolver.ts | Attorney opportunity routing |
| Event Emitter | server/intelligence/eventEmitter.ts | Universal event bus |
| AI Gateway | server/aiGateway.ts | Multi-provider AI orchestration |
| Data Migrations | server/dataMigrations.ts | Boot-time idempotent schema migrations |
| Vendor Config | server/vendorConfig.ts | Key resolution + CRASH_LEAD_ACCOUNT_IDS |
