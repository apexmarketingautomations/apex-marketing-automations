# Apex Marketing Automations - AI-Powered Business Communication Platform

## Overview

Apex Marketing Automations is a multi-tenant SaaS platform centralizing and automating business communications, AI bot training, and workflow management. It functions as a white-label CRM, enabling businesses to manage multi-channel messaging (SMS, Instagram), build automated workflows, train AI chatbots using their website content, and rapidly onboard new accounts with industry-specific blueprints. The platform offers a public sales funnel, command dashboard, unified inbox, visual workflow builder, AI bot trainer with RAG and tool-calling, industry-specific onboarding, Stripe subscriptions, a snapshot marketplace, affiliate program, agency command center, and white-label branding. The project aims to enhance client engagement, streamline operations, and leverage AI for competitive advantage across various industries, empowering businesses with automated growth.

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
- **Integrations Hub**: Supports credential-based and OAuth service connections (e.g., Google Suite, Meta, Twilio, Stripe, Mailchimp, Shopify).
- **AI-Native Business OS (Apex Operator)**: An AI-native command layer for natural language task interpretation, multi-step execution planning, and tool interaction, with approval systems and per-tenant memory.
- **Cognitive Intelligence Layer**: Extends the Operator with persistent memory, proactive advisory, strategic business analysis, and behavior-aware intelligence, including an Episodic Memory system and Nudge System.
- **Proactive Push Alert System**: Multi-channel alert dispatching via browser push notifications and SMS, supporting various event types with quiet hours and per-account notification preferences.
- **Cross-Account Industry Benchmarks**: Anonymized aggregate metrics for industry comparison and strategic recommendations, with readiness guards that prevent misleading response-rate/response-time benchmarks for accounts that are not fully set up or not yet active (see `server/operator/accountReadiness.ts`).
- **Autonomous Task Agent (AI-Enhanced)**: A 24/7 background AI worker using Gemini AI for reasoning, task plan generation, execution, learning, and executive briefings.
- **Access Control & Multi-Tenancy**: Authentication via Replit OIDC, native email/password, Google OAuth 2.0, Firebase Auth, with plan-based feature gating and strict account ownership.
- **Platform Infrastructure**: Includes rate limiting, centralized system logging, feature flags, server-side enforcement of plan limits, automation safety mechanisms, startup health checks, and Stripe webhook-managed subscription lifecycle.
- **System Pulse**: Service health monitoring with core vs. optional service categorization.
- **Process Safety**: Global error handlers for `unhandledRejection` and `uncaughtException`.
- **Messaging Infrastructure**: SMS Opt-Out Guard with phone normalization. Unified Inbox with SSE real-time updates across all channels. Contact name resolution in conversation threads uses flexible phone matching (with/without `+` prefix) to handle PSID format differences between messages and contacts tables.
- **Telegram Integration**: Bot API webhook at `/api/webhooks/telegram` with per-account `telegramBotToken`/`telegramBotUsername` in `sub_accounts`. Setup endpoint at `/api/telegram/setup/:subAccountId` auto-registers webhook with Telegram.
- **Audit Trail**: Detailed logging of actions for compliance.
- **Database Backup**: JSON snapshot manifests for data integrity.
- **Automation Trigger System**: Global trigger bridge for modules to fire automation events.
- **Event Bus**: In-memory pub/sub system with priority queuing, dedup, retry logic, and logging.
- **Job Queue**: Background async task processor with retry mechanisms, concurrency control, and history tracking.
- **UI/UX**: Mobile-responsive design with 4-tier breakpoint system, bottom navigation on mobile, guided 5-step onboarding wizard, and an Apex Intelligence premium panel for advanced analytics and AI interaction.
- **WhatsApp Templates Page** (`/whatsapp-templates`): Full CRUD management UI for WhatsApp Business message templates with phone preview, variable support, status filtering, card-based layout, and AI body generator (uses `/api/bot/chat` with `mode: "quick"`) with loading state and error feedback.
- **Content Planner Page** (`/content-planner`): Social content planning workspace with board (kanban) and calendar views, post composer, platform selection, approval status, media indicators, AI caption generator, and Publish Now button.
- **Intelligence Dashboard** (`/intelligence`): Admin-only cross-account intelligence dashboard showing shared insights by category, confidence scores, occurrence tracking, refresh/cleanup controls, and contextual action buttons per insight category (e.g., "Create Response Template", "Send Offer Now", "Build Follow-up Flow") linking to relevant pages.
- **Account Readiness System** (`server/routes/readiness.ts`): 3-phase readiness checker (not_setup → setup_inactive → active_measurable) with 6 explicit conditions: channel connected, auto-reply enabled, workflow active, 3+ outbound replies, 10+ messages in window, 3-day minimum history. Guards benchmarks, intelligence, predictions, and directives — prevents false insights until account is truly active and measurable. Frontend shows phase-appropriate fallback UI with progress bar and actionable fix buttons.
- **Command Engine** (`server/routes/commandEngine.ts`): Backend execution engine with 7 commands (fix-response-rate, boost-content, handle-objections, optimize-pipeline, launch-lead-gen, activate-nurture, system-optimize). Predictions and directives endpoints are readiness-gated.
- **Dashboard Smart Alerts & Benchmarks**: Dynamic alert section reading actual metrics with one-click action links. Benchmark comparison cards only shown when readiness phase is "active_measurable".
- **Real-time Streaming**: SSE-based streaming for AI text and step-by-step progress events.
- **Self-Optimizing Workflows**: Per-step execution metrics tracking, visual funnel analytics, and AI-powered optimization, including auto-optimization of WAIT step timings.
- **Digital Business Card System**: Shared core engine for platform-integrated and standalone digital business cards, featuring themes, data adapters, shared components, tier-based features, and a referral system.

## External Dependencies

- **PostgreSQL**: Primary data storage.
- **Google Gemini API**: Used for AI functionalities.
- **AI Gateway**: Centralized AI routing with OpenAI primary / Gemini fallback and circuit breaker.
- **Twilio**: Phone number provisioning, SMS, and WhatsApp Business API messaging.
- **Vapi**: Voice AI agent deployment and outbound calling.
- **Mailchimp Full Automation**: Event-driven email engine for contact sync and campaigns.
- **Firebase SDK**: Analytics, Push Notifications (FCM), and Google Auth.
- **Shopify Integration**: E-commerce automation via Shopify Admin API and webhooks.
- **Shared Intelligence Layer**: Cross-account organizational learning system extracting insights from DM conversations.
- **Meta Webhooks**: For multi-tenant Facebook/Instagram DM bot functionality and Comment Auto-Reply Bot. Webhook callback URL registered to Meta App 1241083361501051 for live event delivery. Instagram DMs use `me/messages` endpoint (not `{pageId}/messages`). IG account IDs stored in `sub_accounts.meta_instagram_account_id` for tenant resolution (IG webhooks send IG account ID as `entry.id`, not Facebook Page ID). App-level subscriptions: `page` object (messages, feed) and `instagram` object (comments, mentions). Comment replies use `/{comment-id}/comments` endpoint (not `/replies`). **Graph API version: v21.0** across all endpoints. **All DM send payloads include `messaging_type: "RESPONSE"`** per Meta Send API requirements. Meta enforces a **24-hour messaging window** — replies must be sent within 24 hours of the user's last message or Meta rejects with error code 10/subcode 2018278. Test-send diagnostic endpoint: `POST /api/meta-test-send` (requires `x-admin-secret: apex-admin-2024` header).
- **Comment Auto-Reply Bot with RAG Style Learning**: Handles real-time Facebook/Instagram comment replies via webhook `entry.changes` (field=feed/comments). **RAG Pipeline**: Uses pgvector + OpenAI `text-embedding-3-small` embeddings to retrieve top-6 most similar Layla reply examples for each incoming comment, assembling a dynamic persona-aware prompt. 720 context→reply training pairs indexed in `style_embeddings` table. Persona spec auto-generated from real reply analysis (abbreviation patterns, reply length distribution, opener frequency, emoji usage). Falls back to static Layla prompt when embeddings insufficient (<10). Webhook now does Graph API fallback lookup for commenter names when `value.from` is empty. 40-60% selective reply rate for natural engagement. Spam detection, bot-probe denial, escalation keyword handling. Rate-limited to 30 replies/hour per account. Admin endpoints: `POST /api/admin/style-training/index/:subAccountId` (seed embeddings), `GET /api/demo/layla-suggest` (RAG demo), `GET /api/admin/style-training/persona/:subAccountId` (view auto-generated persona spec), `GET /api/admin/style-training/stats/:subAccountId` (training data inventory), `POST /api/meta-ops/backfill-comment-names/:subAccountId` (Graph API name backfill for existing comment records). Style training infrastructure: `server/services/styleTraining/` (dataExporter, embeddingPipeline, personaSpec, commentRag).
- **Account Protection**: `sub_accounts.is_protected` + `protected_reason` columns. Accounts 22 (Officer Layla) and 13 (APEX) marked as protected. Protection status endpoint: `GET /api/meta-ops/account-protection/:subAccountId`.
- **Meta Messaging Product** (`/meta-messaging`): Client-facing Meta Messaging product with 7-tab UI: Dashboard (KPIs, bot status, 7-day trend), DM Inbox (FB+IG threaded conversations with approve/edit/send, channel filtering, search), Comment Bot (auto-approve toggle, tone presets, rate limits, comment feed with status tracking), Safety (flagged content scanner with severity breakdown for critical/high/medium), Analytics (channel breakdown, daily volume charts, period selection), Settings (Meta OAuth connect flow, AI config links, safety compliance toggles), Usage & Billing (plan-based limits, usage meters, plan comparison). Backend: `server/routes/metaMessaging.ts` with 11 product endpoints. Demo mode with realistic generated data. Safety flag detection (litigation, threats, PII, profanity, crisis). Audit logging on all mutations. Sanitized error responses.
- **Meta Messaging 2027 Product Layer** (`/api/meta-messaging/product/*`): Skeleton route endpoints gated behind `meta_messaging_2027` feature flag (default OFF, fail-safe to OFF). Routes: create-subaccount, meta/oauth/start, meta/oauth/callback, test-webhook, inbox, approve-send, seed-demo, safety-queue, analytics. All sub-account routes enforce auth → ownership → protected-account guard chain.
- **Protected Account System**: Accounts with `is_protected=true` in `sub_accounts` (or IDs in `PROTECTED_ACCOUNT_IDS` env var, default 22,13) are fully write-protected. Middleware (`server/middleware/protectedAccount.ts`) returns 403 with `error_code: "sub_account_protected"` and opaque `ticketId` on mutating requests. Security-level entries logged to `system_logs`. Agent/Operator tenant guard (`server/operator/toolHandlers/tenantGuard.ts`) also blocks tool calls targeting protected accounts with abort directive. UI shows "PROTECTED ACCOUNT — DO NOT TOUCH" banner with all mutating controls disabled.
- **Feature Flag Gate** (`server/middleware/featureGate.ts`): Reusable middleware that checks `feature_flags` table. Fails closed (flag OFF) on DB errors and logs incidents to `system_logs`.
- **Meta Ops Center** (`/meta-ops`): Full operations dashboard for all 4 Meta channels (FB DMs, IG DMs, FB Comments, IG Comments). Backend: `server/routes/metaOps.ts` with 11 API endpoints. Features: 4-channel health monitoring with status dots, 24h stats (inbound/outbound/failed), DM feed with channel/status filters and search, comment feed with status/platform filters and inline expand, DM thread view with conversation summary, failed events tab with per-item retry (both DMs and comments), permissions inspector (token debug, Graph API permissions, app subscriptions, IG business account), and controls tab (auto-reply toggle, comment backfill trigger with dry-run preview, account info). Auto-refreshing at 15-30s intervals.
- **Per-Account AI Persona System**: Full persona override via `ai_prompt_config.systemPrompt` (>200 chars bypasses generic front-desk framing). Per-account `autoReplyEnabled` flag gates AI replies. DM context assembler (`server/dmContextAssembler.ts`) supports two modes: generic business front-desk (default) and full character persona (when systemPrompt is substantial). Officer Layla (account 22) has a trained persona learned from 100+ manual DM replies covering fan mode (short, warm, Telegram redirect) and deep vetting mode (probing questions, psychological depth).
- **Content Planner**: Social media content management system with scheduling, approval workflows, platform adapters (Facebook, Instagram, X, TikTok), and **Media Upload** (drag-drop uploader in post composer, server route `POST /api/media/upload` with auth enforcement, protected-account blocking, file type validation, and audit logging to `system_logs`).
- **Google Calendar Auto-Sync**: Background service for syncing Google Calendar events.
- **Meta Campaign Background Sync**: Job-queue-based interval sync for Meta ad campaigns.
- **FLHSMV API**: For polling and retrieving crash reports.