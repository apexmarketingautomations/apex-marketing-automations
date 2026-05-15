# APEX MODULE MAP
**Date:** 2026-05-14  
**Source:** Live codebase + live Neon DB  
**Rule:** Only real modules documented. No invented modules.

---

## MODULE 1: CORE SAAS / ACCOUNT SYSTEM

### Status: PARTIALLY WORKING
**Root issue:** `APEX_PARENT_ACCOUNT_ID = 13` (doesn't exist; should be 3)

| Layer | Files / Tables |
|-------|---------------|
| UI | `account-settings.tsx`, `setup-account.tsx`, `onboarding.tsx`, `billing.tsx`, `white-label.tsx` |
| API | `server/routes/accounts.ts`, `server/routes/subscriptions.ts` |
| DB Tables | `sub_accounts` (5 rows), `users` (2 rows), `owners` (1 row), `sessions` (12), `subscriptions` (0), `credit_wallets` (5), `credit_transactions` (0) |
| Workers | `server/onboarding/` — account seeding |
| Providers | Stripe (billing), Firebase (auth) |
| Account Model | Single owner per sub-account; no membership system |
| Data Lifecycle | Create on sign-up → onboarding wizard → seed defaults → plan assignment |
| Broken | subscriptions empty, parent_account_id=13 broken, is_admin is string |
| Preserve | All sub-account config, twilio numbers, Meta tokens, sentinel config |
| Migrate | Need `account_memberships`, `account_permissions` tables |

---

## MODULE 2: AUTH / ADMIN SYSTEM

### Status: WORKING (with is_admin bug)

| Layer | Files / Tables |
|-------|---------------|
| UI | `login.tsx`, `admin-console.tsx`, `admin-event-mode.tsx`, `god-mode.tsx` |
| API | `server/routes/auth.ts`, `server/routes/admin.ts` |
| DB Tables | `users` (varchar is_admin), `sessions`, `owners`, `audit_logs` (67) |
| Middleware | `server/middleware/tenant.ts`, `server/middleware/protectedAccount.ts`, `server/middleware/featureGate.ts` |
| Providers | Firebase OAuth, Passport.js local, Google OAuth |
| Account Model | `is_admin = 'true'/'false'` string; ADMIN_USER_ID env var bypass; x-admin-secret header bypass |
| Broken | `is_admin` string comparison, APEX_PARENT_ACCOUNT_ID=13 |
| Preserve | All session logic, all auth flows |
| Migrate | Add boolean is_admin, add RBAC table |

---

## MODULE 3: CRM / CONTACTS

### Status: ACTIVE DATA, SCHEMA DRIFT

| Layer | Files / Tables |
|-------|---------------|
| UI | `pipeline.tsx`, `god-mode.tsx`, `dashboard.tsx` |
| API | `server/routes/v1.ts` (contacts CRUD), `server/routes/accounts.ts` |
| DB Tables | `contacts` (9,480 rows — 24 columns live, 38 in schema.ts), `deals` (0), `pipeline_stages` (34), `appointments` (0) |
| Workers | `server/services/contactUpsertService.ts` |
| Providers | BatchData (skip trace), Apify, Nimble |
| Account Model | `sub_account_id` on every contact |
| Data Sources | sentinel_crash, legal_pipeline, hillsborough_court_filings, arrest_booking |
| Broken | 14 lifecycle columns not deployed; cross-account duplicate contacts |
| Preserve | All 9,480 contact rows |
| Migrate | Run `db:push` to add new columns, add dedup key |

---

## MODULE 4: INBOX / MESSAGING

### Status: CONFIGURED, MINIMAL LIVE TRAFFIC

| Layer | Files / Tables |
|-------|---------------|
| UI | `sms-dashboard.tsx`, `instagram-inbox.tsx`, `meta-messaging.tsx`, `meta-messaging-2027.tsx` |
| API | `server/routes/messaging.ts`, `server/routes/messagingEmail.ts`, `server/routes/metaMessaging.ts`, `server/routes/metaMessagingProduct.ts` |
| DB Tables | `messages` (8), `sms_retry_queue` (0), `instagram_conversations` (0), `instagram_messages` (0), `whatsapp_templates` (0), `dm_keyword_automations` (0), `meta_messaging_billing_events` (0), `meta_messaging_analytics_aggregates` (0) |
| Workers | `server/messaging/sendSms.ts`, `server/messaging/sendEmail.ts`, `server/messaging/aiRecovery.ts` |
| Providers | Twilio (all accounts in legacy mode), Meta Graph API |
| Account Model | `sub_account_id` on messages |
| Broken | Twilio in legacy mode, no live DM traffic, Meta tokens may be stale |
| Preserve | 8 existing messages, all Twilio/Meta config |
| Migrate | Upgrade Twilio to subaccount mode per-client |

---

## MODULE 5: WORKFLOWS / AUTOMATIONS

### Status: SEEDED, NOT ACTIVELY RUNNING

| Layer | Files / Tables |
|-------|---------------|
| UI | `workflow-builder.tsx` |
| API | `server/routes/workflows.ts` |
| DB Tables | `workflows` (4 rows), `live_automations` (13), `workflow_step_metrics` (0), `workflow_optimization_logs` (0) |
| Workers | Event-driven via `server/eventBus.ts` |
| Providers | Twilio (SMS steps), OpenAI (AI steps) |
| Account Model | `sub_account_id` on workflows |
| Data Lifecycle | Trigger → steps execute → log outcomes |
| Broken | No live workflow executions recorded, step metrics empty |
| Preserve | 4 workflow definitions, 13 live automations |
| Migrate | Add `workflow_executions` table to track runs |

---

## MODULE 6: AI AGENTS / OPERATOR

### Status: ACTIVE — AI BRAIN IS RUNNING

| Layer | Files / Tables |
|-------|---------------|
| UI | `apex-intelligence.tsx`, `apex-command-center.tsx`, `command-center.tsx`, `voice-agent.tsx`, `bot-trainer.tsx` |
| API | `server/routes/apex-intelligence.ts`, `server/routes/chat.ts`, `server/routes/voice.ts`, `server/routes/commandEngine.ts` |
| DB Tables | `agent_tasks` (180), `agent_config` (5), `agent_briefings` (88), `agent_memories` (307), `agent_conversations` (5), `agent_messages` (13), `agent_worker_jobs` (0), `operator_memories` (17), `operator_nudges` (24), `operator_goals` (0), `operator_plans` (0), `autonomy_actions` (51), `autonomy_policy_rules` (76), `vapi_call_logs` (20), `ai_tool_logs` (2), `pending_actions` (0) |
| Workers | `server/intelligence/worker.ts`, `server/agentWorker.ts`, `server/intelligence/systemHealthOrchestrator.ts` |
| Providers | OpenAI (GPT-4), Google Gemini, Vapi (voice) |
| Account Model | `sub_account_id` on agent tables |
| Memory System | `agent_memories` (episodic), `operator_memories` (key-value), `shared_insights` (cross-account) |
| Operator | "Officer Layla" persona (`server/operator/`), per-account AI brain |
| Broken | autonomy_goals/plans empty (autonomy not fully activated), 57K autonomy_gap_detected events suggest gaps |
| Preserve | All memories, briefings, tasks, policy rules |
| Migrate | Wire autonomy goals, connect plans to actions |

---

## MODULE 7: WEBSITES / FUNNELS / FORMS

### Status: MINIMAL LIVE USAGE

| Layer | Files / Tables |
|-------|---------------|
| UI | `site-builder.tsx`, `liquid-website.tsx`, `form-builder.tsx`, `website-integration.tsx`, `roomos.tsx`, `roomos-dashboard.tsx`, + 29 niche landing/funnel pages |
| API | `server/routes/sites.ts`, `server/routes/funnel.ts`, `server/routes/publicForms.ts`, `server/routes/siteTracking.ts` |
| DB Tables | `saved_sites` (2), `site_versions` (1), `site_collaborators` (0), `funnel_leads` (0), `site_tracking_events` (0), `site_tracking_dead_letter` (0), `tracking_settings` (0), `client_websites` (0), `domains` (0) |
| Workers | None (on-demand) |
| Providers | Custom domain routing via `server/middleware/customDomain.ts` |
| Account Model | Sites don't directly link to sub_account_id (saved_sites has no sub_account_id) |
| Broken | No account link on saved_sites, no live funnels, no tracking active |
| Preserve | 2 saved sites |
| Migrate | Add sub_account_id to saved_sites, wire tracking |

---

## MODULE 8: ADS / CAMPAIGNS

### Status: CONFIGURED, NO LIVE CAMPAIGNS

| Layer | Files / Tables |
|-------|---------------|
| UI | `meta-ads.tsx`, `meta-leads.tsx`, `meta-ops.tsx`, `email-campaigns.tsx`, `ad-launcher.tsx` |
| API | `server/routes/ads.ts`, `server/routes/meta.ts`, `server/routes/metaOps.ts`, `server/routes/mailchimp.ts` |
| DB Tables | `meta_ad_campaigns` (0), `meta_leads` (0), `email_campaigns` (0), `metaCampaignSync.ts` |
| Workers | `server/metaCampaignSync.ts` |
| Providers | Meta Ads API, Mailchimp |
| Account Model | `sub_account_id` on all campaign tables |
| Broken | No live campaigns, Mailchimp unconfigured per-account |
| Preserve | All Meta/Mailchimp credentials in sub_accounts config |

---

## MODULE 9: APEX SENTINEL

### Status: ACTIVE — 7,092 INCIDENTS, LOOP NOT CLOSING

| Layer | Files / Tables |
|-------|---------------|
| UI | `sentinel.tsx`, `external-sentinel.tsx`, `crash-reports.tsx`, `accident-leads.tsx` |
| API | `server/routes/sentinel.ts` |
| DB Tables | `sentinel_incidents` (7,092), `sentinel_config` (3), `crash_reports` (2,975), `property_leads` (0), `wholesaler_config` (0) |
| Workers | `server/sentinel.ts`, `server/sentinel-accident-v2.ts`, `server/sentinel-home-svc.ts`, `server/crashIngestPipeline.ts`, `server/crashReportWorker.ts` |
| Providers | FL crash report APIs, FHWA, Apify |
| Account Model | `sub_account_id` on incidents |
| Data Lifecycle | Crash detected → incident created → geo → contact created → sms/call → delivery |
| Broken | 7,085 of 7,092 incidents stuck in 'pending' status, loop not closing |
| Preserve | All 7,092 incidents, all crash report data |
| Migrate | Add `delivery_outcomes` table, wire action_status transitions |

---

## MODULE 10: CASE INTELLIGENCE / LEGAL SIGNALS

### Status: ACTIVE INGEST, NO DELIVERY

| Layer | Files / Tables |
|-------|---------------|
| UI | `CasesTab.tsx`, `LegalLeadsTab.tsx`, `intelligence-dashboard.tsx` |
| API | `/api/cases/*`, `/api/legal-leads`, `/api/legal-signals/stats` in routes.ts |
| DB Tables | `legal_signals` (3,138), `legal_leads` (19,312), `legal_attorneys` (0), `legal_lead_claims` (0), `intelligence_cases` (1,237), `intelligence_entities` (940), `case_signals` (3,134), `intelligence_scores` (664), `intelligence_recommendations` (74) |
| Workers | `server/legalSignalPipeline.ts` (42KB), `server/caseIntelligence.ts`, `server/courtFilingPipeline.ts`, `server/courtListenerPipeline.ts`, `server/jailBookingPipeline.ts`, `server/arrestIngestPipeline.ts` |
| Providers | CourtListener, Hillsborough County, Apify (arrest data), CPSC, FDA |
| Account Model | Cases/signals have no sub_account_id — they are platform-level |
| Data Lifecycle | Signal detected → scored → case grouped → delivery attempt |
| Broken | `legal_attorneys` empty → 19K leads with nowhere to go; cases not linked to accounts |
| Preserve | All 3,138 legal_signals, 19,312 legal_leads, 1,237 cases, 940 entities |
| Migrate | Add sub_account_id to cases/signals, create attorney onboarding flow |

---

## MODULE 11: HOME SERVICE SIGNALS

### Status: BARELY STARTED

| Layer | Files / Tables |
|-------|---------------|
| UI | `property-radar.tsx` |
| API | `server/routes/homeService.ts`, `/api/home-service/stats` |
| DB Tables | `home_service_signals` (2), `home_service_leads` (0), `home_service_contractors` (2), `home_service_lead_claims` (0) |
| Workers | `server/homeServiceSignalPipeline.ts`, `server/homeServiceLeadDelivery.ts`, `server/homeServiceLeadScorer.ts` |
| Providers | PropertyRadar, BatchData |
| Broken | Minimal data, contractors not configured for delivery |
| Preserve | 2 signals, 2 contractors |

---

## MODULE 12: ENRICHMENT / SKIP TRACE

### Status: CONFIGURED, NOT ACTIVE

| Layer | Files / Tables |
|-------|---------------|
| UI | Part of contacts/pipeline pages |
| API | `server/routes/sentinel.ts` (retro skip trace), `/api/internal/retro-skip-trace` |
| DB Tables | `skip_trace_results` (0), `skip_trace_usage` (0), `property_leads` (0) |
| Workers | `server/skip-trace.ts`, `server/retroSkipTrace.ts`, `server/chargeNormalizer.ts` |
| Providers | BatchData |
| Broken | 0 skip trace results despite 9,480 contacts needing enrichment |
| Migrate | Wire retro skip trace to run on existing contacts |

---

## MODULE 13: DISTRIBUTION / ROUTING

### Status: ARCHITECTURE EXISTS, NOT ACTIVE

| Layer | Files / Tables |
|-------|---------------|
| UI | No dedicated UI |
| API | Internal only |
| DB Tables | `routing_failures` (0), `dispatch_subscribers` (1) |
| Workers | `server/routing/resolver.ts`, `server/routing/gate.ts`, `server/routing/failureQueue.ts` |
| Providers | Twilio (SMS delivery), Vapi (call delivery) |
| Broken | 0 routing failures recorded (suggests routing not active), 1 dispatch subscriber |
| Migrate | Wire sentinel/legal delivery through routing layer |

---

## MODULE 14: BILLING / PLANS

### Status: STRIPE SYNCED, NO ACTIVE SUBSCRIPTIONS

| Layer | Files / Tables |
|-------|---------------|
| UI | `billing.tsx`, `pricing.tsx` |
| API | `server/routes/subscriptions.ts` |
| DB Tables | `subscriptions` (0 public), `credit_wallets` (5), `credit_transactions` (0), `platform_profit_ledger` (0), `message_billing` (0) |
| DB Schema | `stripe.*` — full Stripe sync (customers, subscriptions, invoices, etc.) |
| Workers | `server/billing.ts`, `server/stripeClient.ts`, `server/subscriptionGuard.ts` |
| Providers | Stripe |
| Broken | 0 public subscriptions, billing not enforced (all enterprise + billing_exempt) |
| Preserve | All credit wallets, stripe schema data |
| Migrate | Wire Stripe subscriptions to sub_accounts |

---

## MODULE 15: DIGITAL CARDS

### Status: LIVE PRODUCT (STANDALONE + PLATFORM)

| Layer | Files / Tables |
|-------|---------------|
| UI | `digital-card-builder.tsx`, `digital-card.tsx`, `card-intelligence.tsx`, + 10 standalone pages |
| API | `server/routes/cards.ts`, `server/routes/standalone-cards.ts` |
| DB Tables | `digital_cards` (1), `card_analytics_events` (50), `card_analytics_sessions` (24), `card_intelligence_snapshots` (0), `tracking_links` (0), `tracking_visits` (0), `tracking_events` (0), `standalone_card_users` (1), `standalone_cards` (1), `standalone_orders` (0), `standalone_card_leads` (0), `standalone_page_views` (5) |
| Workers | `server/services/cardActions.ts`, `server/services/cardAdaptation.ts` |
| Providers | Stripe (card purchases) |
| Account Model | `digital_cards.sub_account_id` nullable; standalone cards have separate user system |
| Broken | card_intelligence_snapshots empty, tracking_events empty (tracking not firing) |
| Preserve | 1 digital card, 50 analytics events, 24 sessions |

---

## MODULE 16: CONTENT PLANNER / SOCIAL

### Status: BUILT, EMPTY

| Layer | Files / Tables |
|-------|---------------|
| UI | `content-planner.tsx`, `layla-studio.tsx` |
| API | `server/routes/contentPlanner.ts`, `server/routes/commentBot.ts` |
| DB Tables | `content_posts` (0), `content_post_platforms` (0), `content_media` (0), `content_approvals` (0), `content_calendar_labels` (0), `content_publishing_jobs` (0), `social_accounts` (0), `content_library` (0), `comment_auto_replies` (0) |
| Workers | `server/services/commentBot/`, `server/services/contentPlanner/` |
| Providers | Meta (Instagram, Facebook), social APIs |
| Broken | No social accounts connected, no content posted |

---

## MODULE 17: APEX INTELLIGENCE BRAIN

### Status: VERY ACTIVE (150K score events)

| Layer | Files / Tables |
|-------|---------------|
| UI | `apex-intelligence.tsx`, `intelligence-dashboard.tsx`, `execution-timeline.tsx` |
| API | `server/routes/apex-intelligence.ts`, `server/routes/intelligence.ts`, `server/routes/timeline.ts` |
| DB Tables | `universal_events` (223,691), `entity_activity_rollups` (457), `entity_identity_map` (0), `intelligence_scores` (664), `intelligence_recommendations` (74), `shared_insights` (0), `industry_benchmarks` (70), `apex_module_event_registry` (105), `apex_module_coverage` (150), `execution_timeline` (138), `timeline_events` (105), `event_log` (633) |
| Workers | `server/intelligence/scoringEngine.ts`, `server/intelligence/recommendationEngine.ts`, `server/intelligence/networkIntelligence.ts`, `server/intelligence/rollupWorker.ts`, `server/intelligence/worker.ts` |
| Providers | OpenAI, Gemini |
| Account Model | `account_id` (uses sub_account_id value) |
| Data Flow | events → universal_events → scoring → recommendations → agent briefings |
| Active | 150K score_updated, 57K autonomy_gap_detected, 4.8K agent outcomes |
| Broken | entity_identity_map empty (no identity stitching), shared_insights empty |
| Preserve | All 223,691 events, all scoring data |

---

## MODULE 18: TRACKING & ATTRIBUTION

### Status: SCHEMA READY, NOT FIRING

| Layer | Files / Tables |
|-------|---------------|
| UI | `apex-tracking-settings.tsx` |
| API | `server/routes/tracking.ts`, `server/routes/siteTracking.ts` |
| DB Tables | `tracking_links` (0), `tracking_visits` (0), `tracking_events` (0), `tracking_settings` (0), `site_tracking_events` (0), `site_tracking_dead_letter` (0) |
| Workers | `server/services/trackingIdentity.ts`, `server/services/trackingIntent.ts`, `server/services/trackingInsights.ts`, `server/services/trackingSnapshots.ts` |
| Broken | No tracking links created, no visits recorded, SDK not installed anywhere |

---

## MODULE 19: PLATFORM OPS / OBSERVABILITY

### Status: ACTIVE

| Layer | Files / Tables |
|-------|---------------|
| UI | `launch-readiness.tsx`, `webhook-events.tsx`, `webhooks.tsx` |
| API | `server/routes/readiness.ts`, `server/routes/eventLog.ts` |
| DB Tables | `system_logs` (712), `event_log` (633), `timeline_events` (105), `execution_timeline` (138), `audit_logs` (67), `ai_tool_logs` (2), `agent_worker_jobs` (0), `agent_worker_logs` (0), `feature_flags` (81) |
| Workers | `server/systemLogger.ts`, `server/eventBus.ts`, `server/eventRetryProcessor.ts`, `server/jobQueue.ts`, `server/traceRecorder.ts` |
| Broken | agent_worker_jobs empty (job queue not being used), no dead letter queue |
| Preserve | All system logs, event logs, audit logs |

---

## MODULE 20: EVENT CAMPAIGNS (NFC Card Distribution)

### Status: LIVE (1 campaign, 1 fulfillment)

| Layer | Files / Tables |
|-------|---------------|
| UI | `event-signup.tsx`, `admin-event-mode.tsx` |
| API | `server/routes/event.ts` |
| DB Tables | `event_campaigns` (1), `event_card_fulfillment` (1) |
| Providers | Stripe (payment method capture) |
| Status | 1 campaign active, 1 signup |

---

## MODULE PRIORITY ORDER FOR MIGRATION

1. **CRITICAL FIX:** Account 13 → Account 3 (tenant.ts)
2. **CRITICAL FIX:** Contacts DB migration (14 missing columns)
3. **HIGH:** Sentinel incident → delivery loop (7K stuck incidents)
4. **HIGH:** Legal lead delivery (19K leads, 0 attorneys)
5. **HIGH:** Billing / subscriptions wiring
6. **MEDIUM:** Cross-account contact dedup
7. **MEDIUM:** Tracking & attribution activation
8. **MEDIUM:** RBAC / account memberships
9. **LOW:** Content planner social publishing
10. **LOW:** A/B testing activation
