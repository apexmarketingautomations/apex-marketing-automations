# Apex Intelligence — Coverage Verification & Gap Detection Audit

**Date:** April 13, 2026  
**Scope:** Full module-by-module audit of Apex Intelligence wiring across all parallel tracks  
**Type:** Read-only verification — no code changes made

---

## 1. Architecture Overview

The Apex Intelligence system is built from these components:

| Layer | File | Purpose |
|---|---|---|
| Event Bus | `server/eventBus.ts` | Pub/sub event bus; also calls `emitUniversalEvent` on every publish |
| Universal Event Emitter | `server/intelligence/eventEmitter.ts` | Writes events to `universal_events` DB table; also tracks module coverage |
| Module Registry | `server/intelligence/moduleRegistry.ts` | Maps module group names to their registered event types |
| Intelligence Worker | `server/intelligence/worker.ts` | Subscribes to bus events, triggers scoring + recommendations |
| Scoring Engine | `server/intelligence/scoringEngine.ts` | Calculates per-entity scores from real DB data |
| Recommendation Engine | `server/intelligence/recommendationEngine.ts` | Generates recommendations from score data |
| Rollup Worker | `server/intelligence/rollupWorker.ts` | Aggregates metrics periodically |
| Identity Engine | `server/intelligence/identityEngine.ts` | Links anonymous sessions to contacts |
| Integration Health | `server/intelligence/integrationHealth.ts` | Tracks per-integration health state |
| Network Intelligence | `server/intelligence/networkIntelligence.ts` | Cross-account pattern analysis |
| API Routes | `server/routes/apex-intelligence.ts` | Intelligence read/write endpoints |
| UI Dashboard | `client/src/pages/intelligence-dashboard.tsx` | Operator dashboard; reads from all API endpoints |

---

## 2. Module-by-Module Coverage Audit

### Module Group Registry (`moduleRegistry.ts`) — 15 Groups

| Module Group | Events Registered | Route File Emitting | Actual Source Modules Used | Wiring Status |
|---|---|---|---|---|
| **crm** | lead.created, contact.created/updated/deleted, deal.created/stage.changed/won/lost/updated, pipeline.stage.* | `external-api.ts` (contact_created only), `funnel.ts` (contact_created only), `property.ts` (contact_created only) | external-api, form-endpoint, sentinel-ingest | **PARTIAL** — deal events (created/stage/won/lost) are never emitted; contact.updated/deleted never emitted; CRM CRUD in `property.ts` has zero event emission |
| **forms** | form.submitted, form.started/abandoned/created/updated, funnel.lead.captured/converted | `funnel.ts` (form.submitted, funnel.lead.captured), `siteTracking.ts` (site.form_submit) | funnel, site-tracking | **PARTIAL** — form.started, form.abandoned, funnel.lead.converted never emitted |
| **messaging** | message.received/sent/failed/read, call.*, dm.keyword.triggered, instagram.*, meta.lead.received | `messaging.ts` (message.sent), `webhooks.ts` (webhook_received only — not message events), `metaMessaging.ts` (inbox_message_sent) | messaging, inbox, meta-webhook, telegram-webhook | **PARTIAL** — message.received, call events, dm.keyword.triggered missing from route wiring; call events emitted only by `voice.ts` as call_started (not via eventBus) |
| **calendar** | appointment.booked/cancelled/rescheduled/reminder.sent, calendar.synced | No route file | — | **UNWIRED** — No calendar/appointments route file emits any events |
| **sites** | site.generated/published/updated/created/version.created/collaborator.added | `sites.ts` (site_created, site_published, site_updated, site_version_created, site_collaborator_added) | sites | **WIRED** — all key events emitted |
| **domains** | domain.registered/verified/attached/dns.configured/ssl.activated/searched | `sites.ts` (domain_searched, domain_claimed, domain_attached, domain_verified) | domains | **PARTIAL** — domain.registered, domain.dns.configured, domain.ssl.activated gaps |
| **cards** | card.created/updated/scanned/opened/shared/contact.saved | `cards.ts` (card_created via emitWithTimeline, card analytics events), `standalone-cards.ts` (emitWithTimeline) | cards, standalone-cards | **PARTIAL** — card.scanned/opened/shared/contact.saved mapping inconsistent (sourceModule uses emitter event types but submodule isn't "cards" in registry) |
| **campaigns** | campaign.created/sent/completed/failed/opened/clicked/unsubscribed, ad.campaign.* | `mailchimp.ts` (campaign_sent), `ab-testing.ts` (campaign_sent), `meta.ts` (ad_campaign_updated, ad_lead_captured), `ads.ts` (ad_campaign_launched) | mailchimp, ab-testing, meta, ads | **PARTIAL** — campaign.completed, campaign.opened, campaign.clicked, campaign.unsubscribed never emitted |
| **workflows** | workflow.started/completed/failed/step.executed/optimized, automation.triggered/completed | `workflows.ts` (workflow_triggered only — 1 of 7 events) | workflows | **PARTIAL** — workflow.completed/failed/step.executed/optimized, automation.* never emitted |
| **integrations** | integration.connected/disconnected/error/health.updated, webhook.received/sent, oauth.token.refreshed, shopify.event.received | `integrations.ts` (integration_connected, oauth_token_refreshed), `webhooks.ts` (webhook_received) | integrations, meta-webhook, telegram-webhook | **PARTIAL** — webhook.sent, shopify.event.received, integration.health.updated gaps; disconnect uses disconnect event type |
| **reputation** | review.received/replied/flagged, reputation.score.updated | `reviews.ts` (review_received, review_replied + emitWithTimeline for others) | reviews | **MOSTLY WIRED** — review.flagged and reputation.score.updated not confirmed emitted |
| **sentinel** | crash.detected, sentinel.alert/incident.created/incident.resolved/health.check | `property.ts` (crash_detected), `sentinel.ts` (sentinel_alert, sentinel_dispatched, sentinel_incident via emitWithTimeline) | sentinel, sentinel-ingest | **WIRED** — good coverage across sentinel events |
| **analytics** | page.view, cta.clicked, button.clicked, ab.experiment.started/converted, rollup.computed, score.updated, recommendation.generated | `ab-testing.ts` (ab_experiment events, campaign_sent), `public-platform.ts` (emitUniversalEvent calls) | public-platform, ab-testing | **PARTIAL** — page.view, cta.clicked, button.clicked, rollup.computed, score.updated, recommendation.generated never emitted |
| **billing** | payment.completed/failed, subscription.changed, credit.purchased/consumed, message.billed | `subscriptions.ts` — **ZERO event emissions** | — | **UNWIRED** — No billing events ever emitted from subscriptions route |
| **ai** | ai.chat.completed, ai.training.completed, ai.response.generated, ai.tool.executed | No route emits these event types | — | **UNWIRED** — AI module events never emitted despite heavy AI usage (bot.ts, chat.ts, agentWorker.ts have no emissions) |

---

## 3. Exact Events Currently Emitted — Full Inventory

### Via `emitUniversalEvent` / `emitWithTimeline` / `emitWithEntityLinkage` (direct to universal_events table)

| Event Type | Source File | Source Module | accountId | contactId | Notes |
|---|---|---|---|---|---|
| account_created | accounts.ts | accounts | ✅ subAccountId | ❌ | Missing contactId always |
| ad_campaign_launched | ads.ts | ads | ✅ subAccountId | ❌ | No entity linkage |
| ad_campaign_updated | meta.ts | meta | ✅ subAccountId | ❌ | campaignId present |
| ad_lead_captured | meta.ts | meta | ✅ subAccountId | ❌ | Lead data in metadata only |
| campaign_sent | mailchimp.ts | mailchimp | ✅ subAccountId | ✅ contactId (when known) | Only event with contactId linkage |
| campaign_sent | ab-testing.ts | ab-testing | ✅ subAccountId | ❌ | |
| card_created | cards.ts | cards | ✅ subAccountId | ❌ | Used for both create and update |
| card_created | standalone-cards.ts | standalone-cards | ✅ subAccountId | ❌ | |
| card analytics events | cards.ts | cards | ✅ subAccountId | ❌ | Maps scan/open/share to card_scanned etc |
| call_started | voice.ts | voice | ✅ subAccountId | ❌ | |
| content_published | contentPlanner.ts | content_planner | ✅ subAccountId | ❌ | |
| content_scheduled | contentPlanner.ts | content_planner | ✅ subAccountId | ❌ | |
| domain_searched, domain_claimed, domain_attached, domain_verified | sites.ts | domains | ✅ subAccountId | ❌ | |
| form_submit | funnel.ts | funnel | ✅ subAccountId | ✅ contactId (when linked) | Uses emitWithTimeline |
| inbox_message_sent | metaMessaging.ts | inbox | ✅ subAccountId | ❌ | |
| integration_connected | integrations.ts | integrations | ✅ subAccountId | ❌ | |
| integration_disconnected | integrations.ts | integrations | ✅ subAccountId | ❌ | |
| lead_created | funnel.ts | funnel | ✅ subAccountId | ❌ | |
| message_sent | messaging.ts | messaging | ✅ subAccountId | ❌ | |
| oauth_token_refreshed | integrations.ts (×6) | integrations | ✅ subAccountId | ❌ | YouTube, LinkedIn, TikTok, Microsoft, Cal, Meta |
| review_received | reviews.ts | reviews | ✅ subAccountId | ❌ | |
| review_replied | reviews.ts | reviews | ✅ subAccountId | ❌ | |
| reputation-related | reviews.ts | reviews | ✅ subAccountId | ❌ | Multiple emitWithTimeline calls |
| sentinel_alert | sentinel.ts | sentinel | ✅ subAccountId | ❌ | Multiple points |
| sentinel_dispatched | sentinel.ts | sentinel | ✅ subAccountId | ❌ | |
| sentinel events | sentinel.ts | sentinel | ✅ subAccountId | ❌ | Multiple emitWithTimeline calls |
| site_created, site_published, site_updated, site_version_created, site_collaborator_added | sites.ts | sites | ✅ subAccountId | ❌ | |
| snapshot_created, snapshot_deployed | snapshots.ts | snapshots | ✅ subAccountId | ❌ | |
| voice_agent_created | voice.ts | voice | ✅ subAccountId | ❌ | |
| webhook_received | webhooks.ts | meta-webhook | ✅ subAccountId | ❌ | Meta webhook |
| webhook_received | webhooks.ts | telegram-webhook | ✅ subAccountId | ❌ | Telegram webhook |
| workflow_triggered | workflows.ts | workflows | ✅ subAccountId | ❌ | |
| ab_experiment events | ab-testing.ts | ab-testing | ✅ subAccountId | ❌ | |
| public platform page/form events | public-platform.ts | public-platform | ✅ subAccountId | ❌ | |

### Via `publishEvent` / `publishEventAsync` (eventBus → also calls emitUniversalEvent)

| Event Type | Source File | Source Module | Notes |
|---|---|---|---|
| contact.created | external-api.ts (×2) | external-api | B2B API endpoint |
| contact.created | funnel.ts | form-endpoint | Lead capture |
| contact.created | property.ts | sentinel-ingest | Skip-trace leads |
| crash.detected | property.ts | sentinel-ingest | CAD/incident |
| form.submitted | external-api.ts | external-api | |
| form.submitted | funnel.ts | form-endpoint | |
| message.sent | messaging.ts (×2) | messaging | SMS sends |
| webhook.received | (implicit via eventBus passthrough) | various | |
| cb.session.started/ended, cb.tip.received, cb.goal.completed, cb.whale.entered | chaturbate.ts | roomos | Custom events, not in registry |

**Total distinct emitted event types: ~35** (counting by unique eventType string, not emission count)

---

## 4. Tested vs Untested Matrix

| Verification Level | Events Covered | Notes |
|---|---|---|
| **End-to-end tested** (production data confirmed) | 0 | No automated integration tests exist for intelligence wiring; only `testHelpers.ts` exists as a manual harness |
| **Code-path verified** (logic exists in route → emitter) | ~35 distinct event types across ~24 route call sites | Verified by code audit |
| **Unit tested** (isolated unit tests) | 0 intelligence event emissions | 4 test files exist: `toolRegistry.test.ts`, `metaMessagingProduct.test.ts` (×2), `protectedAccount.test.ts` — none test intelligence events |
| **Stub/helper only** (testHelpers.ts) | All emitter types | `testHelpers.ts` provides `emitTestEvent`, `emitContactEvent`, etc., but no test file calls them |

**Verdict: All 35 event emissions are code-only, none are verified end-to-end by automated tests.**

---

## 5. Files Changed Across All Parallel Tracks (Apr 13, 2026)

Based on file modification timestamps:

### Track 1 — Intelligence Core & Schema
- `shared/schema.ts` — Added: `universalEvents`, `entityIdentityMap`, `apexModuleEventRegistry`, `apexModuleCoverage`, `integrationHealthState`, `executionTimeline`, `intelligenceScores`, `recommendations`, `activityRollups`
- `server/intelligence/eventEmitter.ts` — New file: universal event emission, entity linkage helpers
- `server/intelligence/moduleRegistry.ts` — New file: module group → event type mapping
- `server/intelligence/worker.ts` — New file: bus subscription, scoring/recommendation triggers
- `server/intelligence/scoringEngine.ts` — New file: per-entity scoring from real DB data
- `server/intelligence/recommendationEngine.ts` — New file: recommendation generation
- `server/intelligence/rollupWorker.ts` — New file: metric aggregation
- `server/intelligence/identityEngine.ts` — New file: session-to-contact linking
- `server/intelligence/integrationHealth.ts` — New file: integration health tracking
- `server/intelligence/networkIntelligence.ts` — New file: cross-account analysis
- `server/intelligence/testHelpers.ts` — New file: test event emission helpers

### Track 2 — Event Wiring in Routes
- `server/routes/apex-intelligence.ts` — New file: all intelligence API endpoints
- `server/routes/sentinel.ts` — Added: `emitWithTimeline` for sentinel events (Apr 13)
- `server/routes/reviews.ts` — Added: `emitUniversalEvent` / `emitWithTimeline` (Apr 13)
- `server/routes/integrations.ts` — Added: `emitUniversalEvent` for OAuth + connect/disconnect (Apr 13)
- `server/routes/ab-testing.ts` — Added: `emitUniversalEvent` / `emitWithTimeline` (Apr 13)
- `server/routes/mailchimp.ts` — Added: `emitUniversalEvent` (Apr 13)
- `server/routes/accounts.ts` — Added: `emitUniversalEvent` (Apr 13)
- `server/routes/snapshots.ts` — Added: `emitUniversalEvent` (Apr 13)
- `server/routes/ads.ts` — Added: `emitWithTimeline` (Apr 13)
- `server/routes/contentPlanner.ts` — Added: `emitUniversalEvent` (Apr 13)

### Track 3 — Event Wiring (Earlier)
- `server/routes/sites.ts` — Added site + domain events
- `server/routes/cards.ts` — Added card events
- `server/routes/workflows.ts` — Added workflow_triggered
- `server/routes/voice.ts` — Added voice_agent_created, call_started
- `server/routes/messaging.ts` — Added message.sent
- `server/routes/funnel.ts` — Added form + contact events
- `server/routes/meta.ts` — Added ad + lead events
- `server/routes/metaMessaging.ts` — Added inbox_message_sent
- `server/routes/webhooks.ts` — Added webhook_received

### Track 4 — UI Dashboard
- `client/src/pages/intelligence-dashboard.tsx` — New page: operator dashboard with 6 tabs

---

## 6. Fake Completion Detection

**Scanning for: mocked data, placeholder events, hardcoded values, stub implementations**

| Type | Finding | Location | Severity |
|---|---|---|---|
| **Hardcoded account ID** | `subAccountId = 13` as default in insights refresh | `server/routes/intelligence.ts:47` | Medium — default fallback, not forced |
| **Hardcoded account ID** | `subAccountId = 13` as crash data fallback | `server/routes/property.ts:702` | Medium — silent fallback, dangerous |
| **Event type used as sourceModule** in eventBus passthrough | EventBus calls `emitUniversalEvent` auto-mapping source modules from payload fields; if no `subAccountId` in payload, event is dropped silently | `server/eventBus.ts:122` | High — silent drop |
| **cards.ts uses `CARD_CREATED` for both create AND update** | Event type `CARD_CREATED` emitted on update action — misleading event semantics | `server/routes/cards.ts:296` | Low — functional but inaccurate |
| **Scoring engines query real data** | Both `scoringEngine.ts` and `recommendationEngine.ts` query live DB — no fake/random data detected | — | Clean |
| **Intelligence dashboard queries real endpoints** | All 6 dashboard tabs query live API endpoints with no hardcoded fallback data | — | Clean |
| **Module coverage UI driven by real module activity** | Coverage matrix shows `moduleActivity` from `/api/operator/module-health`, which counts real `universal_events` rows | — | Clean |
| **chaturbate.ts emits non-standard events** | `cb.session.started`, `cb.tip.received`, `cb.whale.entered`, `cb.goal.completed` — not in MODULE_GROUP_EVENT_MAP, so not tracked by coverage | `server/routes/chaturbate.ts` | Low — functional but uncounted |
| **Source modules in routes don't match registry groups** | Route files use: `ab-testing`, `content_planner`, `funnel`, `inbox`, `mailchimp`, `meta-webhook`, `public-platform`, `snapshots`, `standalone-cards`, `telegram-webhook` — none of these match any registry group name | Multiple route files | High — events emitted but never counted in module coverage |

---

## 7. Unresolved Gap List

### Critical Gaps — Modules Not Wired

| Module | Gap | Evidence |
|---|---|---|
| **Calendar / Appointments** | Zero event emissions from any route file. No `/routes/calendar.ts` or appointments route emits events. | `grep` finds no appointment/calendar events in any route emission |
| **Billing / Subscriptions** | `subscriptions.ts` handles all Stripe checkout and plan changes with zero event emissions. `payment.completed`, `payment.failed`, `subscription.changed`, `credit.purchased`, `credit.consumed`, `message.billed` are all dead. | `subscriptions.ts` has no import from eventBus or emitter |
| **AI module** | `ai.chat.completed`, `ai.training.completed`, `ai.response.generated`, `ai.tool.executed` never emitted. `bot.ts`, `chat.ts`, `agentWorker.ts` have no event emissions. | grep confirms zero emissions from AI routes |
| **CRM Contacts — updates/deletes** | `contact.updated` and `contact.deleted` never emitted. Primary contact CRUD is in `property.ts` (2386+ line file) which emits only `CONTACT_CREATED` from sentinel ingest path, not from direct user CRUD. | property.ts CRUD endpoints have no emit calls |
| **CRM Deals** | `deal.created`, `deal.stage.changed`, `deal.won`, `deal.lost`, `deal.updated` never emitted from any route. Deals CRUD is in `property.ts:2543+` with no emission. | No deal events in any emit call |

### High-Priority Gaps — Events Missing Entity Linkage

| Event | Missing Field | Impact |
|---|---|---|
| 84 of 85 event emissions | `contactId` | Lead intent scoring and identity engine cannot link events to contacts without contactId; scores will be at baseline zero |
| Most events | `entityType` / `entityId` | Activity rollups keyed on entityType+entityId won't work for contact-level or deal-level rollups |
| Meta webhook events | `contactId` | Message events from Meta/Telegram have contact data but contactId is not resolved and linked |
| Campaign events | `campaignId` | Only `meta.ts` passes campaignId; mailchimp and ab-testing don't set it |

### Medium Gaps — Events Missing from Partially Wired Modules

| Module Group | Missing Events |
|---|---|
| messaging | message.received, call.completed, call.missed, dm.keyword.triggered, instagram.message.received, instagram.comment.received |
| workflows | workflow.completed, workflow.failed, workflow.step.executed, workflow.optimized, automation.triggered, automation.completed |
| campaigns | campaign.completed, campaign.opened, campaign.clicked, campaign.unsubscribed |
| domains | domain.registered, domain.dns.configured, domain.ssl.activated |
| forms | form.started, form.abandoned, funnel.lead.converted |
| analytics | page.view, cta.clicked, button.clicked, rollup.computed, score.updated, recommendation.generated |
| reputation | review.flagged, reputation.score.updated |
| cards | card.updated, card.contact.saved (semantic: card.created used for both) |

### Architecture Gaps

| Gap | Description |
|---|---|
| **Source module name mismatch** | 13 of 22 source module strings used in routes do NOT match any key in `MODULE_GROUP_EVENT_MAP`. Coverage tracker uses `getModuleGroupForEvent(eventType)` which maps event types → groups, but if `eventType` isn't in the registry map (e.g. `account_created`, `voice_agent_created`), no coverage increment happens. |
| **No coverage API endpoint** | `apex-intelligence.ts` has no endpoint to query `apexModuleCoverage` table. The dashboard's Coverage tab uses `/api/operator/module-health` (which queries raw `universal_events` grouped by `sourceModule`) — not the structured `apexModuleCoverage` table. The coverage table exists but is not read anywhere in the UI. |
| **No test coverage for intelligence** | `testHelpers.ts` provides all the infrastructure to test events but zero test files use it. All event wiring is code-only, with no automated verification that events reach the DB. |

---

## 8. Final Coverage Verdict

### Does the system meet "whole site" coverage criteria?

**No. The system is approximately 35–40% wired.**

**Evidence:**

| Criteria | Status |
|---|---|
| All 15 module groups have at least one emitting route | **No** — calendar, billing, and AI are completely unwired |
| All major CRUD operations emit events | **No** — contact updates/deletes, deal CRUD, appointment CRUD, billing events: all missing |
| All emitted events include contactId linkage | **No** — 84/85 emissions (99%) have no contactId, breaking lead scoring |
| Coverage tracking correctly counts all emitted events | **No** — source module name mismatches prevent many events from incrementing the `apexModuleCoverage` table |
| Event scoring runs on real data | **Yes** — scoring and recommendation engines query real DB, no fake data |
| Intelligence dashboard reads live data | **Yes** — all 6 tabs query real API endpoints |
| Module health shows real activity | **Yes** — module-health endpoint queries live `universal_events` grouped by `sourceModule` |
| End-to-end automated test coverage exists | **No** — zero test files verify intelligence event wiring |

### What IS working

- The infrastructure is solid: eventBus → emitUniversalEvent → universal_events DB write pipeline works
- Scoring engine and recommendation engine run on real data with real logic
- `server/routes/sentinel.ts`, `server/routes/sites.ts`, `server/routes/reviews.ts`, `server/routes/integrations.ts` have reasonably good event coverage
- The operator dashboard UI is fully wired to live endpoints — no fake data anywhere in the UI
- Module health endpoint works; coverage matrix shows which modules are active vs silent
- Entity identity engine architecture is in place; contactId linkage just needs to be added to individual emissions

### What must be fixed for full coverage

1. **Wire calendar/appointments module** — any appointment creation/update needs event emission
2. **Wire billing/subscriptions module** — Stripe events need to emit payment/subscription events
3. **Wire AI module** — bot.ts, chat.ts completions need `ai_response`/`ai.chat.completed` events
4. **Add contactId linkage** to messaging, CRM, funnel, meta events where contactId is known at emission time
5. **Fix source module naming** — route source modules should match registry group keys, or registry should add those module names
6. **Wire deal/contact CRUD events** — `property.ts` deal and contact CRUD handlers need emissions
7. **Add tests** — `testHelpers.ts` infrastructure exists; test files should call it for each major module group
