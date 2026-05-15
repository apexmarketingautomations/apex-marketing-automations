# APEX FULL STRUCTURE AUDIT
**Date:** 2026-05-14  
**Auditor:** Claude Sonnet 4.6  
**Neon Project:** patient-surf-58659251 (org: APEX, aws-us-east-1)  
**Repo:** apex-marketing-automations (main branch)

---

## 1. EXECUTIVE SUMMARY

Apex Marketing Automations is a **multi-tenant AI SaaS platform** running on:
- **Backend:** Node.js / Express 5 with TypeScript (tsx)
- **Frontend:** React 19 + Vite + Wouter routing
- **Database:** Neon Postgres (PG17) via Drizzle ORM
- **Deployment:** Railway
- **Auth:** Passport.js + Firebase OAuth + local session store (connect-pg-simple)
- **AI Gateway:** OpenAI + Google Gemini + Vapi (voice) + custom multi-provider
- **Messaging:** Twilio (SMS/WhatsApp) + Meta (Instagram DM/FB Messenger)
- **Enrichment:** BatchData (skip trace) + Apify (scraping) + Nimble
- **Intelligence:** Crash pipelines + Legal signal pipelines + Hillsborough court filings + Arrest booking + CPSC/FDA recalls

**5 live sub-accounts.** 223,691 universal events. 9,480 contacts. 7,092 sentinel incidents. 19,312 legal leads. Actively ingesting.

---

## 2. CRITICAL ISSUES (Fix Before Any Migration)

### CRITICAL-1: Hardcoded Account 13 Does Not Exist
**File:** `server/middleware/tenant.ts:4`
```
const APEX_PARENT_ACCOUNT_ID = 13;
const DEFAULT_ACCOUNT_ID = APEX_PARENT_ACCOUNT_ID;
```
**Reality:** Account 13 does not exist in production. The real admin account is **account 3** ("APEX MARKETING Account"). This means:
- All unauthenticated API requests resolve to account 13 → no data returned
- `isApexParent()` checks if account 13 exists → returns null → admin bypass is broken
- Accounts 1 (Officer Layla) and 2 (Roof 2 Roots) reference `parent_account_id = 13` (broken FK)

**Fix required:** Change `APEX_PARENT_ACCOUNT_ID = 13` to `APEX_PARENT_ACCOUNT_ID = 3`

### CRITICAL-2: Contacts Table Schema Drift (12 Columns Defined But Not Deployed)
`schema.ts` defines these columns on the `contacts` table that **do not exist in the live DB**:
- `identity_status`, `skip_trace_status`
- `enrichment_provider`, `enrichment_attempted_at`, `enrichment_completed_at`, `enrichment_confidence`
- `source_external_id`, `raw_source_type`
- `lead_vertical`, `lead_subtype`
- `normalized_phone`, `normalized_email`
- `county`, `contact_quality_score`

Any code that reads/writes these columns will fail at runtime. A `db:push` migration is needed.

### CRITICAL-3: Broken Parent Account FK (No Constraint)
`sub_accounts.parent_account_id` has no FK constraint. Accounts 1 and 2 reference account 13 (missing). This silently corrupts account hierarchy logic.

### CRITICAL-4: Subscriptions Table Is Empty
The `subscriptions` table has 0 rows. Billing is not active. 5 accounts have `plan = 'enterprise'` and `billing_exempt` or no subscription row. Revenue tracking is disconnected.

### CRITICAL-5: isAdmin Field Is varchar("false") Not Boolean
`users.is_admin` is stored as `varchar("false")` — a string, not a boolean. Any admin check doing `user.isAdmin === true` silently fails.

---

## 3. LIVE DATABASE INVENTORY

### 3.1 Neon Project Details
- **Project ID:** patient-surf-58659251
- **Region:** aws-us-east-1
- **PG Version:** 17
- **Schemas:** `public` (app tables), `stripe` (Stripe sync replica)
- **Storage:** 193 MB (193,278,032 bytes)
- **History retention:** 6 hours

### 3.2 Table Row Counts (Public Schema)

| Table | Row Count | Status |
|-------|-----------|--------|
| universal_events | 223,691 | VERY ACTIVE |
| legal_leads | 19,312 | ACTIVE |
| sentinel_incidents | 7,092 | ACTIVE |
| contacts | 9,480 | ACTIVE |
| legal_signals | 3,138 | ACTIVE |
| case_signals | 3,134 | ACTIVE |
| crash_reports | 2,975 | ACTIVE |
| intelligence_entities | 940 | ACTIVE |
| intelligence_cases | 1,237 | ACTIVE |
| intelligence_scores | 664 | ACTIVE |
| entity_activity_rollups | 457 | ACTIVE |
| agent_memories | 307 | ACTIVE |
| agent_tasks | 180 | ACTIVE |
| system_logs | 712 | ACTIVE |
| agent_briefings | 88 | ACTIVE |
| intelligence_recommendations | 74 | ACTIVE |
| industry_benchmarks | 70 | ACTIVE |
| autonomy_actions | 51 | ACTIVE |
| card_analytics_events | 50 | ACTIVE |
| apex_module_coverage | 150 | ACTIVE |
| apex_module_event_registry | 105 | ACTIVE |
| timeline_events | 105 | ACTIVE |
| execution_timeline | 138 | ACTIVE |
| event_log | 633 | ACTIVE |
| feature_flags | 81 | SEEDED |
| autonomy_policy_rules | 76 | SEEDED |
| blueprints | 19 | SEEDED |
| pipeline_stages | 34 | SEEDED |
| workflows | 4 | SEEDED |
| operator_nudges | 24 | ACTIVE |
| operator_memories | 17 | ACTIVE |
| integration_connections | 14 | ACTIVE |
| integration_health_state | 16 | ACTIVE |
| vapi_call_logs | 20 | ACTIVE |
| sub_accounts | 5 | SEEDED |
| users | 2 | SEEDED |
| messages | 8 | SPARSE |
| card_analytics_sessions | 24 | SPARSE |
| agent_conversations | 5 | SPARSE |
| agent_messages | 13 | SPARSE |
| ai_tool_logs | 2 | SPARSE |
| audit_logs | 67 | ACTIVE |
| home_service_signals | 2 | SPARSE |
| home_service_contractors | 2 | SPARSE |
| digital_cards | 1 | SPARSE |
| affiliates | 1 | SPARSE |
| saved_sites | 2 | SPARSE |
| sentinel_config | 3 | SEEDED |
| credit_wallets | 5 | SEEDED |
| sessions | 12 | ACTIVE |
| _data_migrations | 4 | TRACKED |
| **ALL OTHERS** | **0** | **EMPTY** |

### 3.3 Empty Tables (No Live Data)
These tables exist but have never been used:
`ab_events, ab_experiments, appointments, commissions, content_approvals, content_calendar_labels, content_library, content_media, content_post_platforms, content_posts, content_publishing_jobs, credit_transactions, deals, dm_keyword_automations, domains, email_campaigns, entity_identity_map, funnel_leads, home_service_lead_claims, home_service_leads, instagram_conversations, instagram_messages, mailchimp_email_logs, mailchimp_sync_logs, message_billing, meta_ad_campaigns, meta_leads, meta_messaging_analytics_aggregates, meta_messaging_billing_events, notifications, oauth_tokens, onboarding_defaults, operator_goal_progress, operator_goal_reviews, operator_goals, operator_plan_steps, operator_plans, operator_step_dependencies, operator_tool_trust, owner_unlocks, platform_profit_ledger, portal_tokens, property_leads, provider_assets, push_subscriptions, referrals, reviews, routing_failures, shopify_events, site_collaborators, site_tracking_dead_letter, site_tracking_events, skip_trace_results, skip_trace_usage, sms_retry_queue, snapshot_versions, snapshots, social_accounts, sponsorship_clicks, sponsorships, standalone_card_leads, standalone_orders, style_embeddings, subscriptions, tracking_events, tracking_links, tracking_settings, tracking_visits, training_jobs, usage_logs, webhook_delivery_logs, webhook_events, webhooks, whatsapp_templates, white_label_settings, wholesaler_config, workflow_optimization_logs, workflow_step_metrics, cb_commands_fired, cb_sessions`

### 3.4 Stripe Schema Tables (Synced via stripe-replit-sync)
`accounts, active_entitlements, charges, checkout_sessions, checkout_session_line_items, coupons, credit_notes, customers, disputes, early_fraud_warnings, events, features, invoices, payment_intents, payment_methods, payouts, plans, prices, products, refunds, reviews, setup_intents, subscription_items, subscription_schedules, subscriptions, tax_ids`

---

## 4. LIVE SUB-ACCOUNT MAP

| ID | Name | Plan | Internal | Billing Exempt | Owner User ID | Parent Account |
|----|------|------|----------|----------------|---------------|----------------|
| 1 | Officer Layla | enterprise | YES | YES | google_112536357448413794216 | 13 (BROKEN) |
| 2 | Roof 2 Roots | enterprise | NO | YES | apex_roof2roots_* | 13 (BROKEN) |
| **3** | **APEX MARKETING Account** | **enterprise** | **NO** | **NO** | **google_112536357448413794216** | **ROOT (ADMIN)** |
| 4 | Crash Connect — Giovanni | enterprise | NO | NO | apex_giovanni_* | ROOT |
| 146 | Apex | enterprise | NO | NO | _archived | ROOT |

**Account 3 is the real admin account.** Account 1 (Officer Layla) is the internal AI agent account. Account 2 (Roof 2 Roots) is the first client.

---

## 5. USERS TABLE

| Field | Type | Notes |
|-------|------|-------|
| id | varchar | Firebase UID or UUID |
| email | varchar | Unique |
| first_name | varchar | |
| last_name | varchar | |
| profile_image_url | varchar | |
| password_hash | varchar | For local auth |
| auth_provider | varchar | "replit", "google", "firebase" |
| is_admin | varchar | "true"/"false" STRING — not boolean |
| created_at | timestamp | |
| updated_at | timestamp | |

**2 live users.** No `role`, no `sub_account_id` FK, no `account_memberships` table. Multi-user per account is not implemented.

---

## 6. FRONTEND ROUTE MAP

### 6.1 Public / Auth Routes
- `/` → `landing.tsx`
- `/login` → `login.tsx`
- `/pricing` → `pricing.tsx`
- `/privacy` → `privacy.tsx`
- `/terms` → `terms.tsx`
- `/welcome` → `welcome.tsx`
- `/onboarding` → `onboarding.tsx`
- `/setup-account` → `setup-account.tsx`

### 6.2 Core SaaS Routes (Authenticated)
- `/dashboard` → `dashboard.tsx`
- `/pipeline` → `pipeline.tsx`
- `/sms-dashboard` → `sms-dashboard.tsx`
- `/instagram-inbox` → `instagram-inbox.tsx`
- `/meta-messaging` → `meta-messaging.tsx`
- `/meta-messaging-2027` → `meta-messaging-2027.tsx`
- `/workflow-builder` → `workflow-builder.tsx`
- `/calendar` → `calendar.tsx`
- `/analytics` → `analytics.tsx`
- `/reports` → `reports.tsx`
- `/reputation` → `reputation.tsx`
- `/integrations` → `integrations.tsx`
- `/webhooks` → `webhooks.tsx`
- `/webhook-events` → `webhook-events.tsx`

### 6.3 AI / Intelligence Routes
- `/apex-intelligence` → `apex-intelligence.tsx`
- `/apex-command-center` → `apex-command-center.tsx`
- `/apex-tracking-settings` → `apex-tracking-settings.tsx`
- `/command-center` → `command-center.tsx`
- `/intelligence-dashboard` → `intelligence-dashboard.tsx`
- `/voice-agent` → `voice-agent.tsx`
- `/bot-trainer` → `bot-trainer.tsx`
- `/execution-timeline` → `execution-timeline.tsx`
- `/snapshots` → `snapshots.tsx`

### 6.4 Signal / Sentinel Routes
- `/sentinel` → `sentinel.tsx`
- `/external-sentinel` → `external-sentinel.tsx`
- `/crash-reports` → `crash-reports.tsx`
- `/accident-leads` → `accident-leads.tsx`
- `/property-radar` → `property-radar.tsx`

### 6.5 CRM / Contacts Routes
- `/pipeline` → `pipeline.tsx`
- `/god-mode` → `god-mode.tsx`

### 6.6 Intelligence Routes (Tabs inside pages)
- `/CasesTab` → `CasesTab.tsx`
- `/CrashLeads` → `CrashLeads.tsx`
- `/LegalLeadsTab` → `LegalLeadsTab.tsx`

### 6.7 Site / Funnel / Forms Routes
- `/site-builder` → `site-builder.tsx`
- `/liquid-website` → `liquid-website.tsx`
- `/form-builder` → `form-builder.tsx`
- `/website-integration` → `website-integration.tsx`
- `/domains` → `domains.tsx`
- `/roomos` → `roomos.tsx`

### 6.8 Ads / Campaigns Routes
- `/meta-ads` → `meta-ads.tsx`
- `/meta-leads` → `meta-leads.tsx`
- `/meta-ops` → `meta-ops.tsx`
- `/email-campaigns` → `email-campaigns.tsx`
- `/ad-launcher` → `ad-launcher.tsx`
- `/growth-center` → `growth-center.tsx`

### 6.9 Digital Cards (Standalone Product)
- `/digital-card-builder` → `digital-card-builder.tsx`
- `/digital-card` → `digital-card.tsx`
- `/card-intelligence` → `card-intelligence.tsx`
- `/card-edit` → `card-edit.tsx`
- `/cards-landing` → `cards-landing.tsx`
- `/card-success` → `card-success.tsx`
- `/standalone-card-*` → 10 pages (full standalone product)

### 6.10 Admin Routes
- `/admin` → (admin subdirectory)
- `/admin-console` → `admin-console.tsx`
- `/admin-event-mode` → `admin-event-mode.tsx`
- `/launch-readiness` → `launch-readiness.tsx`
- `/billing` → `billing.tsx`
- `/white-label` → `white-label.tsx`
- `/account-settings` → `account-settings.tsx`
- `/notification-preferences` → `notification-preferences.tsx`

### 6.11 Niche Landing Pages (29 pairs)
Each niche has: `{niche}-landing.tsx` + `{niche}-funnel.tsx`
- auto-dealers, chiropractors, coaches, dentists, ecommerce, gym, home-service, insurance, lawyers, luxe, marketers, medspa, pet-services, photography, realtors, restaurants, wedding

### 6.12 Content / Social Routes
- `/content-planner` → `content-planner.tsx`
- `/layla-studio` → `layla-studio.tsx`
- `/whatsapp-templates` → `whatsapp-templates.tsx`

### 6.13 Misc Routes
- `/client-portal` → `client-portal.tsx`
- `/affiliate` → `affiliate.tsx`
- `/marketplace` → `marketplace.tsx`
- `/niche-directory` → `niche-directory.tsx`
- `/ab-testing` → `ab-testing.tsx`
- `/revenue-command` → `revenue-command.tsx`
- `/sponsorship-manager` → `sponsorship-manager.tsx`
- `/location-search` → `location-search.tsx`
- `/nexus-demo` → `nexus-demo.tsx`

---

## 7. BACKEND API MAP

### 7.1 Route Files (64 files in server/routes/)
| Route File | Prefix / Purpose |
|------------|-----------------|
| auth.ts | `/api/auth/*` — login, register, firebase, google, logout, session |
| accounts.ts | `/api/accounts/*` — CRUD sub-accounts |
| admin.ts | `/api/admin/*` — admin-only ops |
| messaging.ts | `/api/messaging/*` — SMS/Twilio conversations |
| messagingEmail.ts | `/api/messaging/email/*` |
| workflows.ts | `/api/workflows/*` — workflow CRUD + execution |
| bot.ts | `/api/bot/*` — AI chatbot training |
| blueprints.ts | `/api/blueprints/*` |
| ads.ts | `/api/ads/*` — Meta ad campaigns |
| chat.ts | `/api/chat/*` — AI chat |
| voice.ts | `/api/voice/*` — Vapi voice agents |
| webhooks.ts | `/api/webhooks/*` |
| reviews.ts | `/api/reviews/*` |
| subscriptions.ts | `/api/subscription/*` + `/api/billing/*` |
| snapshots.ts | `/api/snapshots/*` |
| affiliates.ts | `/api/affiliates/*` |
| sentinel.ts | `/api/sentinel/*` |
| domains.ts | `/api/domains/*` |
| property.ts | `/api/property/*` |
| meta.ts | `/api/meta/*` — Meta page/lead integration |
| notifications.ts | `/api/notifications/*` |
| dashboard.ts | `/api/dashboard/*` |
| v1.ts | `/api/v1/*` — versioned API |
| integrations.ts | `/api/integrations/*` |
| cards.ts | `/api/cards/*` — digital cards |
| analytics.ts | `/api/analytics/*` |
| ab-testing.ts | `/api/ab/*` |
| timeline.ts | `/api/timeline/*` |
| eventLog.ts | `/api/event-log/*` |
| mailchimp.ts | `/api/mailchimp/*` |
| public-platform.ts | `/api/public/*` |
| standalone-cards.ts | `/api/standalone-cards/*` |
| event.ts | `/api/event/*` — event campaigns |
| external-api.ts | `/api/external/*` |
| contentPlanner.ts | `/api/content-planner/*` |
| commentBot.ts | `/api/comment-bot/*` |
| intelligence.ts | `/api/intelligence/*` |
| commandEngine.ts | `/api/command-engine/*` |
| readiness.ts | `/api/readiness/*` |
| metaOps.ts | `/api/meta-ops/*` |
| metaMessaging.ts | `/api/meta-messaging/*` |
| metaMessagingProduct.ts | `/api/meta-messaging/product/*` |
| media.ts | `/api/media/*` |
| chaturbate.ts | `/api/chaturbate/*` |
| apex-intelligence.ts | `/api/apex-intelligence/*` |
| siteTracking.ts | `/api/site-tracking/*` |
| tracking.ts | `/api/tracking/*` |
| publicForms.ts | `/api/public/forms/*` |
| apifyTransport.ts | `/api/apify-transport/*` |
| arrests.ts | `/api/arrests/*` |
| hillsborough.ts | `/api/hillsborough/*` |
| sites.ts | `/api/sites/*` |
| funnel.ts | `/api/funnel/*` |

### 7.2 Direct Routes in routes.ts
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/internal/retro-skip-trace` | POST | Retro skip trace trigger |
| `/voice/:id.mp3` | GET | Voice file serving |
| `/api/legal-leads` | GET | Legal leads list |
| `/api/legal-signals/stats` | GET | Legal signal stats |
| `/api/cases` | GET | Intelligence cases list |
| `/api/cases/:id` | GET | Case detail |
| `/api/cases/:id` | PATCH | Case update |
| `/api/cases/stats` | GET | Case stats |
| `/api/ai/chat` | POST | AI chat endpoint |
| `/api/ai/status` | GET | AI provider status |
| `/api/home-service/stats` | GET | Home service stats |

---

## 8. SERVER FILE MAP

### 8.1 Core Server Files
| File | Purpose |
|------|---------|
| `server/index.ts` | Main Express app (96KB) — middleware, startup |
| `server/routes.ts` | Route registration orchestrator |
| `server/storage.ts` | Data access layer (2839 lines) |
| `server/db.ts` | Drizzle DB connection |

### 8.2 Pipeline / Ingest Workers
| File | Purpose | Data Volume |
|------|---------|-------------|
| `crashIngestPipeline.ts` | Crash report → contact pipeline (43KB) | 2,975 crash reports |
| `crashReportWorker.ts` | Crash report worker/processor (50KB) | Active |
| `legalSignalPipeline.ts` | Legal signals ingest (42KB) | 3,138 signals |
| `courtFilingPipeline.ts` | Court filings (35KB) | Active |
| `hillsboroughCourtFilingsPipeline.ts` | Hillsborough specific (36KB) | 395 contacts |
| `hillsboroughRecordsPipeline.ts` | Records pipeline (22KB) | Active |
| `jailBookingPipeline.ts` | Jail bookings (40KB) | Active |
| `arrestIngestPipeline.ts` | Arrest ingest (26KB) | 33 contacts |
| `homeServiceSignalPipeline.ts` | Home service signals (45KB) | 2 signals |
| `apexLeadEngine.ts` | Lead engine orchestrator (30KB) | Active |
| `countyBookingScrapers.ts` | County booking scraper (36KB) | Active |
| `courtListenerPipeline.ts` | CourtListener API (16KB) | Active |

### 8.3 AI / Intelligence Layer
| File | Purpose |
|------|---------|
| `server/operator/` | Operator AI (Layla persona) |
| `server/intelligence/` | 17 intelligence modules (apexLearningFeed, crossPlatformPatterns, identityEngine, integrationHealth, moduleRegistry, networkIntelligence, priorityActionQueue, recommendationEngine, rollupWorker, scoringEngine, systemHealthOrchestrator, worker) |
| `server/autonomy/` | Autonomy layer (decisionEngine, gapDetector, handlers, orchestrator, postAuthContinuation, preAuthStaging, safeActionsEngine, safetyPolicy, seedPolicyRules) |
| `aiGateway.ts` | Multi-provider AI routing (45KB) |
| `agentWorker.ts` | Agent task worker (14KB) |
| `sentinel.ts` | Sentinel intelligence (13KB) |
| `sentinel-accident-v2.ts` | Accident sentinel (30KB) |
| `sentinel-home-svc.ts` | Home service sentinel (35KB) |
| `caseIntelligence.ts` | Case intelligence engine (20KB) |
| `callIntelligence.ts` | Call intelligence (19KB) |
| `sharedIntelligence.ts` | Shared intelligence layer (17KB) |

### 8.4 Services Layer
| File | Purpose |
|------|---------|
| `server/services/cardActions.ts` | Digital card actions |
| `server/services/cardAdaptation.ts` | Card AI adaptation |
| `server/services/contactUpsertService.ts` | Contact dedup/upsert |
| `server/services/insightExtractor.ts` | Insight extraction |
| `server/services/laylaAccountResolver.ts` | Layla account resolver |
| `server/services/outcomeTracker.ts` | Outcome tracking |
| `server/services/trackingIdentity.ts` | Tracking identity |
| `server/services/trackingInsights.ts` | Tracking insights |
| `server/services/trackingIntent.ts` | Intent detection |
| `server/services/trackingSnapshots.ts` | Tracking snapshots |

### 8.5 Messaging Layer
| File | Purpose |
|------|---------|
| `server/messaging/sendSms.ts` | SMS send |
| `server/messaging/sendEmail.ts` | Email send |
| `server/messaging/aiRecovery.ts` | AI message recovery |
| `server/messaging/responseStrategy.ts` | Response strategy |
| `server/messaging/voiceStore.ts` | Voice storage |

### 8.6 Routing Layer
| File | Purpose |
|------|---------|
| `server/routing/failureQueue.ts` | Routing failure queue |
| `server/routing/gate.ts` | Routing gate |
| `server/routing/resolver.ts` | Account resolver |
| `server/routing/createCaseTables.ts` | Case table creation |
| `server/routing/sequenceAudit.ts` | Sequence audit |

### 8.7 Middleware
| File | Purpose |
|------|---------|
| `server/middleware/tenant.ts` | Multi-tenant account resolution |
| `server/middleware/featureGate.ts` | Feature flag gate |
| `server/middleware/protectedAccount.ts` | Protected account guard |
| `server/middleware/customDomain.ts` | Custom domain routing |
| `server/middleware/apexReporter.ts` | Apex telemetry reporter |

### 8.8 External Integrations
| File / Module | Provider |
|--------------|---------|
| `twilioClient.ts`, `twilioClientFactory.ts` | Twilio SMS/WhatsApp |
| `metaConfig.ts`, `metaCampaignSync.ts` | Meta (Facebook/Instagram) |
| `mailchimp.ts` | Mailchimp email |
| `property-radar.ts` | PropertyRadar |
| `skip-trace.ts` | BatchData skip trace |
| `apifyAttorneyScraper.ts`, `apifyTransportScraper.ts` | Apify |
| `nimbleAgentSetup.ts` | Nimble web scraping |
| `billing.ts`, `stripeClient.ts` | Stripe |
| `googleCalendarSync.ts` | Google Calendar |
| `gemini.ts` | Google Gemini AI |
| `vapiConfig.ts` | Vapi voice |
| `pulse.ts` | Push notifications |

---

## 9. PROVIDER INTEGRATION MAP

| Provider | Purpose | Status |
|----------|---------|--------|
| Twilio | SMS, WhatsApp, voice | ACTIVE (legacy mode on all accounts) |
| Meta / Facebook | Instagram DM, Facebook Messenger, Lead Ads | CONFIGURED (no live messages yet) |
| OpenAI | AI chat, intelligence summaries | ACTIVE |
| Google Gemini | AI alternative | CONFIGURED |
| Vapi | Voice agents | ACTIVE (20 call logs) |
| BatchData | Skip trace / property enrichment | CONFIGURED |
| Apify | Web scraping (attorneys, transport) | CONFIGURED |
| Nimble | Web agent / scraping | CONFIGURED |
| PropertyRadar | Property leads | CONFIGURED |
| Stripe | Billing / subscriptions | SYNCED (stripe schema active, 0 public subscriptions) |
| Mailchimp | Email campaigns | CONFIGURED |
| Google Calendar | Appointment sync | CONFIGURED |
| Firebase | Auth provider | ACTIVE |
| Neon | PostgreSQL database | ACTIVE |
| Railway | Deployment | ACTIVE |

---

## 10. ACCOUNT / SUBACCOUNT ACCESS MODEL

### 10.1 Current Implementation
- **Auth:** Passport.js sessions (connect-pg-simple) + Firebase JWT
- **Tenant resolution:** `server/middleware/tenant.ts`
  - Reads `x-sub-account-id` header
  - Falls back to user's first owned account
  - Falls back to `APEX_PARENT_ACCOUNT_ID` (currently **13** — BROKEN, should be **3**)
- **Admin bypass:** `x-admin-secret` header or `ADMIN_USER_ID` env var
- **Multi-user:** NOT IMPLEMENTED — no `account_memberships` table
- **Sub-account ownership:** `sub_accounts.owner_user_id` (single owner only)

### 10.2 Missing Access Features
- No role-based access control (RBAC)
- No account membership/invitation system
- No client portal access control tied to account
- No API key system for external access
- No granular permission table

---

## 11. UNIVERSAL EVENT TAXONOMY (live data)

Top event types by volume in `universal_events` (223,691 total):

| Event Type | Source Module | Count |
|-----------|--------------|-------|
| score_updated | intelligence-scoring | 150,215 |
| autonomy_gap_detected | autonomy | 57,532 |
| agent.outcome | apex-intelligence | 4,882 |
| crash_ingested | crash-ingest | 2,981 |
| autonomy_cycle_completed | autonomy_orchestrator | 2,116 |
| recommendations_batch_generated | recommendation-engine | 1,561 |
| cognitive_memory_stored | cognitive-memory | 1,198 |
| crash_lead_created | crash-ingest | 521 |
| strategic_insight_generated | strategic-advisor | 455 |
| episodic_memory_created | episodic-memory | 307 |
| message_sent | crash-ingest-pipeline | 292 |
| api_request_completed | http-api | 265 |
| agent_task_running | task-agent | 204 |
| contact_updated | arrest-ingest-pipeline | 104 |

---

## 12. CONTACTS SOURCE LINEAGE

| Sub-Account | Source | Count |
|-------------|--------|-------|
| 1 (Officer Layla) | legal_pipeline | 1,572 |
| 2 (Roof 2 Roots) | hillsborough_court_filings | 395 |
| 2 (Roof 2 Roots) | arrest_booking | 33 |
| 3 (APEX MARKETING) | sentinel_crash | 3,537 |
| 3 (APEX MARKETING) | hillsborough_court_filings | 395 |
| 3 (APEX MARKETING) | legal_pipeline | 261 |
| 3 (APEX MARKETING) | arrest_booking | 33 |
| 4 (Crash Connect) | legal_pipeline | 1,576 |
| 4 (Crash Connect) | hillsborough_court_filings | 395 |
| 4 (Crash Connect) | sentinel_crash | 234 |
| 4 (Crash Connect) | arrest_booking | 33 |
| 146 (Apex archived) | legal_pipeline | 1,016 |

**Key finding:** Contacts are being duplicated across accounts (same 395 hillsborough_court_filings contacts exist in accounts 2, 3, and 4). No cross-account deduplication.

---

## 13. SENTINEL INCIDENT STATUS

| Sub-Account | Status | Count |
|-------------|--------|-------|
| 2 (Roof 2 Roots) | pending | 2,797 |
| 2 (Roof 2 Roots) | acknowledged | 1 |
| 3 (APEX MARKETING) | pending | 2,807 |
| 3 (APEX MARKETING) | acknowledged | 9 |
| 3 (APEX MARKETING) | sms_sent | 3 |
| 4 (Crash Connect) | pending | 1,475 |

7,092 total incidents — **nearly all pending, no action taken.** The pipeline is ingesting but not closing the loop on lead delivery.

---

## 14. LEGAL SIGNALS BREAKDOWN

| Signal Type | Vertical | Status | Count |
|-------------|----------|--------|-------|
| cpsc_recall | personal_injury | qualified | 2,153 |
| arrest | criminal | raw | 421 |
| business_growth_signal | local_service | qualified | 219 |
| business_growth_signal | home_service | qualified | 161 |
| fda_recall | personal_injury | qualified | 40 |
| lis_pendens | real_estate | raw | 30 |
| arrest | criminal | qualified | 27 |
| arrest | criminal | delivered | 25 |
| jail_booking | criminal | qualified | 20 |
| divorce_filing | family | raw | 14 |

**19,312 legal_leads generated** but `legal_attorneys` table is empty — no attorneys to deliver to. Legal lead delivery is broken.

---

## 15. BROKEN / MISSING CONNECTIONS

### 15.1 Broken
1. `APEX_PARENT_ACCOUNT_ID = 13` — account doesn't exist (should be 3)
2. `parent_account_id = 13` on accounts 1 & 2 — dangling reference
3. Contacts lifecycle columns (14 fields) — in schema.ts, not in live DB
4. Legal attorneys table empty — legal lead delivery impossible
5. `users.is_admin` stored as varchar string not boolean

### 15.2 Missing Linkages
1. No `account_memberships` — single owner per account only
2. No `subscriptions` → `sub_accounts` FK — billing unlinked from accounts
3. No `agent_tasks` → `contacts` FK — agent tasks don't link to CRM
4. No cross-account contact dedup — same person appears in 3+ accounts
5. No `crash_reports` → `contacts` FK — crash pipeline contacts aren't linked back to crash report

### 15.3 Orphaned / Stale Tables
- `cb_sessions`, `cb_commands_fired` — Chaturbate integration (0 rows, niche)
- `shopify_events` — 0 rows, Shopify not connected
- `standalone_*` tables — separate product, minimal usage (1 card)
- `snapshot_versions`, `snapshots` — 0 rows, marketplace unused
- `wholesaler_config` — 0 rows, PropertyRadar workflow not configured

---

## 16. PLAN TIERS

Defined in schema: `starter`, `pro`, `enterprise`

**All 5 accounts are on enterprise plan.** No tiered enforcement active. `PLAN_LIMITS` defined but not enforced at API level.

Legacy aliases: `agency_pro` → `pro`, `god_mode` → `enterprise`

---

## 17. DATA MIGRATIONS TRACKER

4 migrations applied:
- `amc_lookup_unique_index` — dedup apex_module_coverage
- `apex_module_event_registry_seed` — seed event registry
- `autonomy_policy_rules_seed` — seed policy rules
- `intelligence_scoring_fix` — fix scoring

---

## 18. HIGHEST RISK AREAS BEFORE MIGRATION

1. **Account 13 constant** — fix before any migration or all defaults break
2. **Contacts schema drift** — `db:push` needed or all new contact lifecycle code fails
3. **Legal lead delivery** — 19K leads with no attorneys configured
4. **Sentinel incidents** — 7K pending, loop not closing
5. **Duplicate contacts** — same data in 3 accounts, no dedup key
6. **Subscriptions** — billing not wired to accounts, no revenue
7. **`is_admin` string bug** — admin checks silently fail
8. **No RBAC** — single owner per account, no team access
9. **TypeScript build status** — needs verification
10. **No pagination on most UI pages** — large datasets will OOM browser

---

## 19. SCHEMA NOT YET PUSHED TO LIVE DB

The following columns exist in `shared/schema.ts` but NOT in the live Neon database and must be added via migration:

**contacts table (14 missing columns):**
- `identity_status` text default 'unidentified'
- `skip_trace_status` text default 'not_attempted'
- `enrichment_provider` text
- `enrichment_attempted_at` timestamp
- `enrichment_completed_at` timestamp
- `enrichment_confidence` real
- `source_external_id` text
- `raw_source_type` text
- `lead_vertical` text
- `lead_subtype` text
- `normalized_phone` text
- `normalized_email` text
- `county` text
- `contact_quality_score` real

**Additional tables from schema.ts confirmed as existing in live DB but not listed above — all other new tables appear to be present.**
