# Apex Marketing Automations — AI-Powered Multi-Tenant Business OS

## Overview

Apex Marketing Automations is a multi-tenant SaaS platform that centralizes business communications, AI-powered messaging, social media publishing, CRM, workflow automation, and lead generation. It acts as a white-label agency CRM, enabling businesses to manage multi-channel messaging (SMS, Facebook DMs, Instagram DMs), train AI chatbots, build automated workflows, and onboard accounts with industry-specific blueprints.

The project's core purpose is to provide an AI-powered business operating system that automates marketing and communication tasks, significantly reducing manual effort and improving efficiency for businesses. A key capability is the "Officer Layla Woods" AI persona, which handles Facebook and Instagram DMs 24/7 for the "Apex By Donte" brand.

## User Preferences

- Preferred communication style: Simple, everyday language.
- Owner account: `apexmarketingautomations@gmail.com` (user ID `53528927`)
- Primary accounts: APEX MARKETING (ID 13), Officer Layla (ID 22)

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack React Query
- **Styling**: Tailwind CSS v4, shadcn/ui (New York style)
- **Animations**: Framer Motion
- **Forms**: React Hook Form with Zod validation
- **UI/UX**: Mobile-responsive design with 4-tier breakpoints, bottom navigation on mobile, and a guided onboarding wizard.

### Backend
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript (compiled via tsx in dev, esbuild for production)
- **Architecture**: Modular Express server with domain-based route modules.
- **AI & Messaging**: Features an AI Gateway for centralized routing (OpenAI primary, Gemini fallback with circuit breaker), Officer Layla AI Persona for DMs, a Unified Inbox for multi-channel communication, and a Comment Auto-Reply Bot utilizing pgvector and OpenAI embeddings. Apex Operator acts as a cognitive intelligence layer for natural language task interpretation and multi-step execution. The DM context assembler (`server/dmContextAssembler.ts`) uses an `isExplicitPersonaOverride` flag (set when `aiPromptConfig.systemPrompt` exists and is >200 chars) — this path strips generic CRM blocks (brandVoice, serviceGuardrail, primaryGoal, anti-robot, escalation, links & actions, shared insights) to prevent persona contamination. Meta webhook handler includes echo detection (`is_echo` skip), `mid` dedup, and 6-second sender batching to prevent duplicate AI replies.
- **Content Planner & Social Publishing**: Enables creation, scheduling, and publishing of posts to Facebook and Instagram with AI caption generation. A background worker (`CP-WORKER`) handles scheduled posts, and a publisher uses the Meta Graph API.
- **CRM & Lead Management**: Supports multi-tenant accounts, a visual deal pipeline, multi-channel contact management, and a form builder.
- **Intelligence Layers (Apex Intelligence Level 2 & 3)**:
    - **Scoring Engine**: Computes 12 dimensions of account health and performance (e.g., `account_maturity_score`, `workflow_effectiveness_score`).
    - **Recommendation Engine**: Generates prioritized, data-backed recommendations with explanations across all platform areas.
    - **Network Intelligence**: Detects cross-account anonymized patterns and provides benchmarks.
    - **Autonomy Layer (Safe Actions Engine)**: A central dispatcher that validates and executes actions (Setup, Repair, Optimization) with safety classifications (`safe`, `needs_review`, `blocked`), rollback support, and audit logging.
    - **Apex Learning Feed**: A central intelligence pipeline ensuring all system signals flow into a `universal_events` table for the Apex brain to learn from.
- **Crash Reports (Sentinel)**: Integrates with FLHSMV to ingest and process crash reports, automatically converting qualifying incidents to leads. Also includes Sentinel Home Services for processing NOAA NWS weather alerts, classifying signal types, and scoring opportunities.

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database**: PostgreSQL 16
- **Schema**: `shared/schema.ts` with `drizzle-zod` for validation
- **Migrations**: Schema changes are applied with `npm run db:push` (Drizzle Kit, schema-first). The post-merge hook (`scripts/post-merge.sh`) runs `npm install` followed by `npm run db:push -- --force` so every merged change reaches the live database. There is **no** hand-written `migrations/` folder and no SQL-file migration runner — `shared/schema.ts` is the single source of truth. The `out: "./migrations"` value in `drizzle.config.ts` only matters if someone runs `drizzle-kit generate`, which we do not do; generated SQL files there should be deleted, not committed.

## External Dependencies

- **OpenAI**: Primary AI model (`gpt-4o-mini`) for general AI tasks.
- **Gemini**: Fallback AI model for redundancy.
- **Meta/Facebook**: Webhooks for DMs, Graph API for publishing, and ad campaign management.
- **Twilio**: SMS and voice communication, WhatsApp Business API.
- **Stripe**: Payment processing, subscriptions, billing, and webhooks.
- **Mailchimp**: Event-driven email automation.
- **Google Calendar**: Background auto-synchronization.
- **Vapi**: Voice AI agent deployment.
- **Firebase**: Push notifications (FCM) and Google Authentication.
- **Google Maps/Places**: For location-based services (via `GOOGLE_API_KEY`).

## Honesty & Hardening Pass (April 2026)

A four-phase hardening pass was completed to eliminate silent failures and dishonest reporting:

- **Phase A — Calendar honesty**: Removed hardcoded `[13, 14]` account IDs from `googleCalendarSync.ts`; auto-sync now reads `config.googleCalendarSync.enabled` per sub-account, with a one-time backfill that flags any account with prior `googleCalendarEventId` history. JSONB writes use atomic `jsonb_set` to avoid read-modify-write races between admin toggles and the background populator. Added `/api/calendar/sync-status/:id` and `/api/calendar/sync-config/:id` endpoints; the calendar UI badge now shows real status (active / off / error). Removed the unverified "round-robin" claim from the landing page.
- **Phase B — Integration health real populator**: New `server/intelligence/integrationHealthChecker.ts` runs every 30 min for all sub-accounts and performs cheap read-only API checks against Meta Graph (Authorization header, never query string), Twilio, OpenAI, Telegram, Google Calendar (via Replit connector), and Stripe (per `integration_connections` row). Results write to `integration_health_state` via the existing `trackIntegrationSuccess` / `trackIntegrationFailure` helpers. Adapter failures are isolated — one bad provider does not abort the cycle.
- **Phase C — Typed Layla policy**: New `shared/laylaPolicy.ts` defines a single Zod schema (`LaylaPolicy`) with `parseLaylaPolicy()` (safe parse with defaults) and `buildBusinessFallbackPolicy()` (for non-Layla business accounts). Replaced four ad-hoc inline interfaces in `laylaPostProcessor.ts`, `laylaPipeline.ts`, `commentHandler.ts`, and `reengageJob.ts`.
- **Phase D — Apex Intelligence outcome reporting**: `reportOutcome()` in `server/operator/apexIntelligence.ts` now logs every silent-discard path with a structured `[APEX-OUTCOME] discarded` warning (one per validation reason), and accepted outcomes are mirrored fire-and-forget into `universal_events` with `eventType="agent.outcome"` so they survive process restarts. The in-memory buffer remains as the fast-read cache.

## NFC/QR Tracking & Attribution Scaffold (April 2026)

Level 1 capture + attribution layer for NFC business cards, QR codes, and downstream funnel events. Lives inside the existing Drizzle app (no separate service). Full intelligence rollups (intent scoring, journey reconstruction, CTA ranking) are deferred to a follow-up task — the schema and event mirror are designed to support them without migration.

- **Schema** (`shared/schema.ts`): `tracking_links` (slug → destination, scoped to subAccount/card/campaign, with `is_test` flag), `tracking_visits` (durable `visit_id` UUID + signed attribution token, UTM/device/geo/IP-hash, `traffic_class` ∈ valid/test/internal/suspicious/bot), `tracking_events` (event_id UUID, FKs to link/subAccount/card/contact, `idempotency_key` UNIQUE, `payload` jsonb, `is_test`).
- **Capture route** `GET /t/:slug`: fast lookup, creates visit + signed HMAC-SHA256 attribution token (TTL 30d), sets `apex_sid` session cookie, fires tap/qr_scan event fire-and-forget, redirects 302 with `?_av=<token>` appended. Tap counter bumped async.
- **Public ingestion**: `POST /api/track/event` (generic) and per-type `/page-view`, `/click`, `/form-start`, `/lead-submit`, `/booked-call`, `/qualified-lead`, `/closed-sale`. **Tenant context (`subAccountId`, `cardId`, `campaignId`, `contactId`) is NEVER taken from public callers** — derived only from the resolved visit, preventing cross-tenant injection. Conversion events (lead_submit, booked_call, qualified_lead, closed_sale) require a valid attribution token or 403.
- **Trusted server-to-server**: `POST /api/track/webhook/apex-crm` requires `X-Admin-Secret` (env: `TRACKING_ADMIN_SECRET` or `STANDALONE_ADMIN_SECRET`) and may pass tenant context directly. Idempotency-key dedup confirmed.
- **Apex Intelligence integration**: every non-test event is mirrored fire-and-forget into `universal_events` with `eventType="tracking.<type>"` and `sourceModule="tracking"`, so the existing scoring/recommendation pipelines pick up tracking signals automatically. Test traffic is filtered out at this boundary to protect benchmarks.
- **Admin**: `POST/GET/PATCH /api/track/links` and `GET /api/track/visits/:visitId`. AdminGuard refuses to run open in `NODE_ENV=production` if no secret is configured (returns 503).
- **Identity stitching** (`server/services/trackingIdentity.ts`): `POST /api/track/identify` upgrades an anonymous visit to identified by hashing email/phone (SHA-256 + signing secret, no raw PII stored) and attaching `contactId`. Sibling visits sharing any of the new hashes are stitched to the same contact and marked `isRepeat=true`; their historical events are backfilled with `contactId`. Identification requires either a valid attribution token or `X-Admin-Secret` (no public PII writes against arbitrary visits). Each identification fires a `tracking.visit_identified` universal event (test traffic excluded).
- **Per-card intelligence snapshot** (`server/services/trackingSnapshots.ts`): pre-aggregates taps, scans, page views, CTA clicks, lead/booking/sale counts, unique/repeat/identified visitor counts, conversion rates, revenue, and weighted attribution confidence into `card_intelligence_snapshots`. Exposed via `GET /api/track/analytics/cards/:id` (`?refresh=1` forces recompute, otherwise 5-minute TTL). Test traffic is excluded so production benchmarks stay clean.

### Phase 3 — Apex Intelligence Dashboard (April 2026)

Client-facing dashboard surface on top of the tracking subsystem. Adds an insight engine, live intent detection, and a React panel — without touching any of the existing capture/attribution paths.

- **Insight engine** (`server/services/trackingInsights.ts`): pure, deterministic translator from snapshot+behavior aggregates to color-coded insights (`positive | warning | opportunity`). Each insight has a stable `code` for UI dedupe/animation. Rules: high-repeat engagement, low-conversion, traffic-without-conversion, peak-hours, identification-growth, deep-sessions, strong-booking-rate. All rules are guarded by sample-size thresholds so we never produce noise on cards with only a handful of visitors.
- **Live intent detection** (`server/services/trackingIntent.ts`): hooked into `recordEvent` for `INTENT_BEARING_EVENT_TYPES` (tap, qr_scan, page_view, cta_click, form_start). Triggers `tracking.high_intent` when (a) repeat visit within 24h paired with cta_click/form_start, or (b) the identity cluster (sessionId/contactId/emailHash/phoneHash) spans a *different* session than the current visit. Cluster lookup is tenant-scoped (no cross-customer leakage). Test traffic excluded.
- **Atomic single-emit** (`sendIntentAlert`): the `tracking.high_intent` universal event is emitted exactly once per visit using a conditional `UPDATE ... WHERE is_high_intent=false RETURNING ...` flip — only the connection that wins the race emits. Verified by firing 5 concurrent qualifying events on a fresh visit and observing exactly one event.
- **Visit flag columns**: `tracking_visits.is_high_intent`, `high_intent_at`, `high_intent_reason` (defined in `shared/schema.ts` and applied via `npm run db:push`). Partial index on the flag for fast "show me hot visits" queries.
- **Client API** `GET /api/intelligence/cards/:id`: composite payload (metrics + behavior + attribution + recentActivity + insights + state). Tenant ownership enforced via `verifyAccountOwnership(req, res, card.subAccountId)` — never trusts the requesting user against the tracking tables directly. Snapshot reused (5-min TTL); behavior aggregates (peak hours, avg time-to-convert, top CTA, session depth) computed live with indexed queries. `?refresh=1` forces snapshot recompute. UI state hint (`empty | low_data | ok`) lets the panel skip the "low conversion" warning for cards with too little data.
- **Frontend** `client/src/components/intelligence/CardIntelligencePanel.tsx` + page route `/intelligence/cards/:id`: handles loading/error/empty/low_data, color-codes insights, surfaces last 5 meaningful events, refetches every 60s. Future hooks (AI recommendations, cross-client benchmarks, adaptive routing, CTA optimization, campaign comparison) declared in the API response so UI surfaces can light up incrementally without a schema change.
- **Files**: `server/routes/tracking.ts` (capture + ingest + admin + identify + analytics routes), `server/routes/intelligence.ts` (client dashboard API), `server/services/trackingIdentity.ts`, `server/services/trackingSnapshots.ts`, `server/services/trackingInsights.ts`, `server/services/trackingIntent.ts`, `client/src/components/intelligence/CardIntelligencePanel.tsx`, `client/src/pages/card-intelligence.tsx`. Registered in `server/routes.ts` via `registerTrackingRoutes(app)` and `registerIntelligenceRoutes(app)`.
### Phase 4 — Digital Card Lead Intelligence (April 2026, Task #146)

Per-visitor session tracking and intent scoring for platform digital cards (`/card/:slug`), surfaced as a Lead Table inside the digital card builder.

- **Schema** (`shared/schema.ts`): new `cardAnalyticsSessions` table (sessionId-unique, cardId, visitorId, referrer, deviceType, browser, country/region, ipHash (16-char SHA-256), startedAt, lastSeenAt, totalTimeMs, maxScrollDepth, clickCount, returnVisit, intentScore 0–100, leadTier `cold|warm|hot`). Extended `cardAnalyticsEvents` with `sessionId`, `scrollDepth`, `timeOnPage`. Indexes on `(card_id)`, `(card_id, visitor_id)`, and `(session_id)`. Schema applied via psql ALTER/CREATE because `db:push --force` blocked on an unrelated `tracking_links_slug_unique` interactive prompt.
- **Tracking endpoints** (`server/routes/cards.ts`):
  - `POST /api/track/session` — upsert by sessionId, parses UA for device/browser, marks `returnVisit=true` if the same `visitorId` was previously seen for the card. Increments `digital_cards.viewCount` only on first insert (replacing the per-fetch increment in `/api/public-card/:slug` to avoid bot/preview inflation).
  - `POST /api/track/event` — records event, updates session aggregates, recomputes intent. Formula: `time/90s*40 + scroll/100*20 + min(clicks*6, 30) + (returnVisit?10:0)`. Tier: ≥71 hot, ≥31 warm, else cold. Hard caps on slug/sessionId/visitorId/eventType/eventTarget length. Click event types are an explicit allowlist (CLICKY_TYPES).
  - `GET /api/cards/:id/sessions` — admin sessions list for the builder Lead Table; ownership enforced via `verifyAccountOwnership(card.subAccountId)`. Standalone (purchase-based) cards get 403.
- **Public card page** (`client/src/pages/digital-card.tsx`): per-tab `sessionId` via `crypto.randomUUID`, persistent `visitorId` in `localStorage` key `card_visitor_id`. On mount: POST session + `view` event. RAF-throttled scroll handler emits one event per crossed milestone (25/50/75/100). All CTA clicks (phone, email, website, booking, social, save_contact, share, qr_scan) call `trackEvent`. `pagehide` and `visibilitychange→hidden` send a final `exit` event with `timeOnPage` + `scrollDepth` via `navigator.sendBeacon`.
- **SEO meta injection**: `applySeoMeta()` populates `<title>`, `description`, full Open Graph and Twitter Card tags from `card.seoTitle/seoDescription/ogImageUrl` with fallbacks to `name/title/bio/tagline/coverImageUrl/photoUrl`. `og:image` is preserved (never wiped) as required.
- **Builder UI** (`client/src/pages/digital-card-builder.tsx`): expanded `AnalyticsSummary` tiles (Views, Visitors, AvgTime, Clicks, Saves, Shares + Hot/Warm pills), new `LeadTable` panel sorted by intent score with tier badge, `ImagePicker` component on Profile/Cover/Logo fields that uploads to `/api/media/upload` and reads `uploaded[0].fileUrl`. Theme tab renders the 6 themes as a responsive grid with active highlight (already present, verified).
- **Files**: `shared/schema.ts`, `server/routes/cards.ts`, `client/src/pages/digital-card.tsx`, `client/src/pages/digital-card-builder.tsx`.

#### Stabilization pass (Task #146 follow-up)

- **Deterministic intent formula** (`computeIntent` in `server/routes/cards.ts`): exactly +40 if `totalTimeMs > 20s`, +30 if `maxScrollDepth > 75%`, +20 if any contact click, +10 if returnVisit. Capped at 100. Tier hot ≥ 71, warm 31–70, else cold. Verified end-to-end: passive 25s+80%=70/warm, contact-click +40+30+20=90/hot, share-only 25s+80%=70/warm (share is NOT a contact click).
- **Single source of truth for views**: only `/api/track/session` increments `digital_cards.viewCount` on first session insert. `/api/public-card/:slug` no longer increments. `/api/track/event` never modifies view counts. Frontend never increments locally.
- **Legacy alias**: `POST /api/public-card/:slug/event` is now a thin alias forwarding to `persistTrackEvent` (the unified pipeline). Accepts the new session-aware fields (`sessionId`, `scrollDepth`, `timeOnPage`).
- **CLICKY_TYPES narrowed** to true contact-intent clicks (`click_phone/email/website/booking/social/link/review/save_contact`). `share` and `qr_scan` are still recorded as events and `share` still bumps `digital_cards.shareCount`, but they no longer count toward `clickCount` or the +20 contact bonus.
- **Top Action**: `GET /api/cards/:id/sessions` enriches each session with `topAction` — the highest-priority click event observed in the session (priority order: save_contact, booking, phone, email, review, website, link, social, share, qr_scan, scroll, view).
- **LeadTable** is now mounted in the builder (`client/src/pages/digital-card-builder.tsx`) directly under the analytics summary tiles. Columns: Visitor, Status, Score, Top Action, Last Seen, Time, Scroll, Clicks, Device, Source. Sorted by intent score descending. Auto-refreshes every 30 s.
- **Removed leaked attached assets**: `attached_assets/LaylaStudio_*.jsx` (legacy prototype files containing a hardcoded `STUDIO_WEBHOOK_SECRET` value) deleted from the repo. The Studio webhook secret is also printed at server startup; rotating it is recommended.

#### Stabilization freeze (Task #146 follow-up — final)

The lead-intelligence pipeline is now frozen. Do **not** add new event
types, change the scoring formula, split the pipeline into more
abstractions, or duplicate analytics counters anywhere else.

- **Single source of truth**: `/api/track/session` is the *only* place
  that increments `digital_cards.viewCount`. `/api/track/event` is the
  *only* event ingestion path; `/api/public-card/:slug/event` remains
  as a thin backward-compat alias forwarding to `persistTrackEvent`.
  No frontend code is allowed to derive analytics locally.
- **Frozen intent formula** (`computeIntent` in `server/routes/cards.ts`):
  +40 if `totalTimeMs > 20s`, +30 if `maxScrollDepth > 75%`, +20 if any
  contact click occurred, +10 if `returnVisit`. Cap 100. Tier hot ≥ 71,
  warm 31–70, else cold.
- **Frozen contact-click set**: `CLICKY_TYPES = { click_phone,
  click_email, click_website }`. These are the only events that
  increment `click_count` and trigger the +20 bonus. `click_booking`,
  `click_social`, `click_link`, `click_review`, `save_contact`,
  `share`, `qr_scan` are still recorded as events and may surface as
  the session's `topAction`, but they never affect the intent score.
- **Frozen dashboard tiles**: Total Views, Unique Visitors,
  Avg Time on Page, Conversion Events.
- **Frozen Lead Table columns**: Visitor ID, Score, Status, Top Action,
  Time on Page (sorted by intent score descending).
- **Frozen image upload**: profile / cover / logo each use the
  `ImagePicker` dropzone, which posts to `/api/media/upload` and stores
  the returned `fileUrl`. No URL paste fallback (removed per spec).
