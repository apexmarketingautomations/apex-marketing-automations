# Apex Marketing Automations - AI-Powered Business Communication Platform

## Overview

Apex Marketing Automations is a multi-tenant SaaS platform designed to centralize and automate business communications, AI bot training, and workflow management. It functions as a white-label CRM, enabling client businesses to manage multi-channel messaging (SMS, Instagram), build automated workflows, train AI chatbots using their website content, and rapidly onboard new accounts with industry-specific blueprints. The platform aims to provide a comprehensive suite for enhancing client engagement, streamlining operations, and leveraging AI for competitive advantage across various industries. Key capabilities include a public sales funnel, command dashboard, unified inbox, visual workflow builder, AI bot trainer with RAG and tool-calling, industry-specific onboarding, Stripe subscriptions, a snapshot marketplace, affiliate program, agency command center, and white-label branding options. The project envisions significant market potential by empowering businesses to achieve automated growth and superior client engagement.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **State Management**: TanStack React Query
- **Styling**: Tailwind CSS v4, shadcn/ui (New York style)
- **Animations**: Framer Motion
- **Forms**: React Hook Form with Zod validation

### Backend
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript
- **Architecture**: Modular Express server with domain-based route modules and a thin orchestrator.

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database**: PostgreSQL
- **Schema**: Defined in `shared/schema.ts` with `drizzle-zod` for validation

### Core Architectural Decisions
- **Monetization Engine**: Credit wallet system with usage-based markup billing and Stripe integration for top-ups.
- **Integrations Hub**: Supports both credential-based and OAuth service connections for a wide range of platforms (Google Suite, Meta, YouTube, LinkedIn, TikTok, Microsoft 365, Calendly, Slack, Zapier, QuickBooks, Twilio, Stripe, HubSpot, Mailchimp, ElevenLabs, WhatsApp Business, Shopify, Skip Trace). Includes platform-managed OAuth with token refresh.
- **AI-Native Business OS (Apex Operator)**: An AI-native command layer that interprets natural language tasks, plans multi-step execution, and interacts with a tool registry. It incorporates planning, execution, an approval system for high-risk actions, diagnostics, telemetry, and per-tenant memory. A pending action system handles confirmation flows.
- **Cognitive Intelligence Layer**: Extends the Operator with persistent memory, proactive advisory, strategic business analysis, and behavior-aware intelligence, including an Episodic Memory system and a Nudge System for proactive notifications.
- **Proactive Push Alert System**: Multi-channel alert dispatching via browser push notifications (Web Push API) and SMS (Twilio), supporting various event types with quiet hours and per-account notification preferences.
- **Cross-Account Industry Benchmarks**: Anonymized aggregate metrics computed across all sub-accounts, grouped by industry, to provide comparison and feed into strategic recommendations.
- **Autonomous Task Agent (AI-Enhanced)**: A 24/7 background AI worker that uses Gemini AI to reason about account states, generate task plans, execute corrective actions, learn from outcomes, and generate executive briefings.
- **Access Control & Multi-Tenancy**: Authentication via Replit OIDC, native email/password, Google OAuth 2.0, Firebase Auth, with plan-based feature gating and strict account ownership enforcement.
- **Platform Infrastructure**: Includes rate limiting, centralized system logging, feature flags, server-side enforcement of plan limits (with `requireActiveSubscription` and `checkPlanLimitMiddleware` guards on premium routes), automation safety mechanisms, startup health checks, and a robust subscription lifecycle managed by Stripe webhooks.
- **System Pulse**: Service health monitoring with core vs optional service categorization. Optional services (Vapi) report informational status when unconfigured rather than degraded. Includes message failure root-cause analysis endpoint (`/api/admin/message-failures`).
- **Process Safety**: Global `unhandledRejection` and `uncaughtException` handlers in `server/index.ts` prevent server crashes from async errors in unwrapped routes. All external sentinel API routes wrapped in `asyncHandler` for proper Express error forwarding.
- **Messaging Infrastructure**: SMS Opt-Out Guard with phone normalization.
- **Audit Trail**: Detailed logging of audit actions for compliance.
- **Database Backup**: JSON snapshot manifests for data integrity.
- **Automation Trigger System**: A global trigger bridge enables modules to fire automation triggers for various events, with corresponding workflow step handlers.
- **Event Bus**: An in-memory pub/sub system with priority queuing, dedup, retry logic, and comprehensive logging.
- **Job Queue**: A background async task processor with retry mechanisms, concurrency control, and history tracking.
- **UI/UX**: Mobile-responsive design with 4-tier breakpoint system: phone (<768px, bottom nav + hamburger drawer), tablet (768–1024px, icon-only collapsed sidebar w-16), laptop/desktop (1024+, full sidebar w-72). Bottom navigation bar on mobile with 5 destinations (Home, Inbox, CRM, Card, Settings). All core pages (dashboard, inbox, pipeline, digital card builder, crash reports, account settings) adapted for mobile with responsive grids, touch-friendly targets, and overflow prevention. Guided 5-step onboarding wizard, and an Apex Intelligence premium panel with advanced analytics and AI interaction features, including a dynamic Operator tab and site-assistant. The panel is draggable (entire header bar + toggle button), resizable (bottom-right corner handle), and position-agnostic (supports `inline`, `bottom-left`, `bottom-right`, `top-left`, `top-right`). Props: `position`, `defaultOpen`, `accountId`, `showToggle`, `panelWidth`, `panelHeight`.
- **Real-time Streaming**: SSE-based streaming infrastructure for AI text streaming and step-by-step progress events, consumed by a frontend hook. The ChatTab (Operator) tracks SSE session IDs to maintain conversation continuity for confirm/reject flows via `proposeAction`.
- **Self-Optimizing Workflows**: Per-step execution metrics tracking, visual funnel analytics, and AI-powered optimization, including auto-optimization of WAIT step timings.

## External Dependencies

- **PostgreSQL**: Primary data storage.
- **Google Gemini API**: Used for AI functionalities across various modules.
- **AI Gateway** (`server/aiGateway.ts`): Centralized AI routing with OpenAI primary / Gemini fallback, circuit breaker (3 failures / 120s), default 12s timeout. Site generation uses 60s timeout for complex JSON output.
- **Twilio**: Phone number provisioning, SMS, and WhatsApp Business API messaging.
- **Vapi**: Voice AI agent deployment and outbound calling, with call-type routing and distinct prompt paths.
- **Mailchimp Full Automation**: Event-driven email engine for contact sync, tag management, and campaign-based email sending.
- **Firebase SDK**: Analytics, Push Notifications (FCM), and Google Auth.
- **Shopify Integration**: E-commerce automation via Shopify Admin API and webhooks.
- **Meta Webhooks**: For multi-tenant Facebook/Instagram DM bot functionality with rich context assembly. Also powers the **Comment Auto-Reply Bot** (`server/services/commentBot/`) which processes FB feed and IG comment webhook events, generates AI-powered replies via the AI Gateway, and posts them via Graph API. Tracks all comment interactions in `comment_auto_replies` table. Config/stats/reply-log APIs at `/api/comment-bot/*`. Per-account enable/disable and reply style (friendly/professional/casual/witty) via `sub_accounts.config.commentBot`. For APEX/Layla accounts (ids 13, 22), comments route through Layla's persona pipeline with: escalation keyword detection, bot-probe denial, post-processor (forbidden word scan, PII redaction, token masking), and the full Officer Layla Woods persona prompt. Layla operator memories stored in `operator_memories` table (keys: `delays`, `telegram`, `handover_rules`, `templates`). System prompt at `server/services/commentBot/laylaCommentPrompt.ts`. **Reengage Job** (`server/services/commentBot/reengageJob.ts`): `POST /api/comment-bot/reengage` (admin-secret protected, auth+CSRF bypassed) — messages people who DMed in the last N days with a Layla-styled reengage DM. Supports dryRun, batchLimit, reengageDays, subAccountId. Full pipeline: fetch eligible threads → opt-out check → summarizer LLM → escalation keyword scan → Layla LLM generation → post-processor → delay simulation → send via Graph API. Tracks sent messages with `traceId=reengage-*` to prevent re-sending. Comment replies use selective mode (~40-60% reply rate).
- **Content Planner**: Full social media content management system with 8 tables (`social_accounts`, `content_posts`, `content_post_platforms`, `content_media`, `content_calendar_labels`, `content_approvals`, `content_publishing_jobs`, `content_library`). Routes at `server/routes/contentPlanner.ts`, publisher at `server/services/contentPlanner/publisher.ts`, scheduler at `server/services/contentPlanner/scheduler.ts`. Per-platform tracking via junction table `content_post_platforms`. Encryption via `server/services/contentEncryption.ts` (AES-256-GCM). Platform adapters for Facebook (working), Instagram, X, TikTok. Real Facebook publishing confirmed. Supports per-post platform status tracking, approval workflows, media management, content library, calendar labels, and scheduling.
- **Google Calendar Auto-Sync**: Background service for syncing Google Calendar events with appointments and triggers.
- **Meta Campaign Background Sync**: Job-queue-based 45-minute interval sync for Meta ad campaigns with `lastSyncedAt` tracking.
- **FLHSMV API**: For polling and retrieving crash reports.

## External API Integration (`/api/v1/external/`)
Public API endpoints for external website integrations, authenticated via `X-API-Key` header (maps to `webhookToken` on sub-accounts).
- **Status**: `GET /api/v1/external/status` — health check + auth verification
- **Leads**: `POST /api/v1/external/leads` — name, email, phone, serviceInterest, message, source, tags → creates contact + triggers automations
- **Consultations**: `POST /api/v1/external/consultations` — name, phone, email, service, preferredDate, preferredTime, notes → creates contact with consultation tags + triggers workflows
- **Events**: `POST /api/v1/external/events` — event name, metadata, sessionId, pageUrl → logged as messages + fires automation triggers
- All endpoints have CORS `*`, are in CSRF + auth bypass lists, and wrapped in `asyncHandler`.
- **Connected Accounts**: Belladonna House of Beauty (id=21, industry=beauty-salon, apiKey=apex_59b71...).
- **Internal Accounts**: Officer Layla (id=22, role=internal_ai_operator, parent=13). Permanent, billing-exempt, non-deletable AI persona operator. Shares Meta credentials with parent APEX MARKETING account.

## Digital Business Card System

### Shared Card Core Engine (`client/src/components/card-core/`)
Both platform and standalone card products share a unified rendering engine:
- **Types** (`types.ts`): `SharedCardData` interface, `CardRenderConfig` (source, tier, branding, tracking), `SocialLink`, `CustomLink`, `Service`, `Testimonial`.
- **Theme Engine** (`themes.ts`): 6 premium themes (`executive-dark`, `luxury-dark`, `clean-light`, `bold-agency`, `modern-gradient`, `minimal-neutral`). Tier-based gating: base=executive-dark only, premium/pro=all themes. `getCardTheme()`, `getAvailableThemes()`, `resolveThemeForTier()`.
- **Data Adapters** (`adapters.ts`): `adaptPlatformCard()` normalizes `digitalCards` schema (socialLinks JSON array, logoImageUrl, googleReviewLink). `adaptStandaloneCard()` normalizes `standaloneCards` schema (individual social columns → socialLinks array, profileImageUrl → photoUrl, etc.).
- **Shared Components** (`components.tsx`): HeroSection, PrimaryActions, SaveShareBar, QRPanel, AboutSection, ServicesSection, TestimonialSection, LinksSection, SocialLinksSection, ReviewBookingLinks, StickyActionBar, ShareModal, CardFooter, BackgroundGlow, CardLoading/NotFound/Unavailable/Error. Components accept `SharedCardData` + `CardTheme` + optional `CardRenderConfig`.
- **Product-Specific Logic**: Platform keeps analytics tracking (`useCardAnalytics` hook), standalone keeps referral CTA, branding toggle, tier gating, and vCard via server endpoint.

### Platform Card Product (Apex-Integrated)
- **Schema**: `digitalCards` table with `ownerEmail`, `editToken`, `paymentStatus` gate, `socialLinks` (JSON array), `services`, `testimonial`, `brandColor`/`accentColor`, `theme`.
- **Backend** (`server/routes/cards.ts`): Checkout, edit-by-token, public card API, analytics events.
- **Frontend**: `/card/:slug` (public view), `/card/success`, `/card/edit/:token`.

### Standalone Card Product (Hard-Isolated from Apex)
- **Product**: "Digital Business Card + Lead Funnel" — $29 one-time payment, no login required.
- **Schema**: `standaloneCards` with `fullName`, individual social URL columns, `themeColor`, `cardTheme` (tier-gated), `tier` (base/premium/pro), `cardLayout`, `removeApexBranding`.
- **Backend** (`server/routes/standalone-cards.ts`): Server-side validation of `cardTheme` against allowed theme keys and `cardLayout` against tier.
- **Tier System**: Base = default theme + Apex branding shown. Premium = all 6 themes + standard layouts + branding removal. Pro = all premium + executive/creative layouts.
- **Referral System**: `/standalone/*` routes, `standalone_orders`, `standalone_referral_codes`, `standalone_referrals`, `standalone_page_views`. Promo pricing ($24.50 for first 20 orders), $10 commissions.
- **Analytics**: `standalone_page_views` table with funnel tracking, IP hashing, session tracking, referral attribution. Admin analytics at `GET /api/standalone/admin/analytics`.
- **Landing Page**: 7-section conversion page with interactive demo card.
- **Routing**: `/standalone/card/:slug` and `/standalone/c/:slug` are canonical.