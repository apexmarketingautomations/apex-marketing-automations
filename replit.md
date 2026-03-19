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
- **Architecture**: Modular Express server with domain-based route modules (`server/routes/`) and thin orchestrator (`server/routes.ts`, ~65 lines). Each domain exports `register{Domain}Routes(app)`. Shared helpers in `server/routes/helpers.ts`.

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database**: PostgreSQL
- **Schema**: Defined in `shared/schema.ts` with `drizzle-zod` for validation

### Core Architectural Decisions
- **Monetization Engine**: Credit wallet system with usage-based markup billing and Stripe integration for top-ups.
- **Integrations Hub**: Supports both credential-based and OAuth service connections (Google Suite, Meta, YouTube, LinkedIn, TikTok, Microsoft 365, Calendly, Slack, Zapier, QuickBooks, Twilio, Stripe, HubSpot, Mailchimp, ElevenLabs, WhatsApp Business, Shopify, Skip Trace). Includes platform-managed OAuth with token refresh.
- **AI-Native Business OS (Apex Operator)**: An AI-native command layer (`server/operator/`) that interprets natural language tasks, plans multi-step execution, and interacts with a tool registry of 64 structured tools across 8 categories (CRM, messaging, workflow, appointment, campaign, creative, review, intelligence). Handler files in `server/operator/toolHandlers/` with Zod-validated schemas in `server/operator/toolSchemas.ts`. Registry supports idempotency caching (5-min TTL), audit logging via `executeToolWithAudit()`, and planner-optimized tool discovery via `listToolsForPlanner()`. It incorporates planning, execution, an approval system for high-risk actions, diagnostics, telemetry, and per-tenant memory.
- **Cognitive Intelligence Layer**: Extends the Operator with persistent memory, proactive advisory, strategic business analysis, and behavior-aware intelligence. Includes a Memory Engine, Context Builder, Advisory Engine, Strategic Advisor, Industry Knowledge base, Trend Detection, and a Nudge System for proactive notifications. The Nudge System dispatches push alerts for high-priority nudges (priority ≥ 70). Features an Episodic Memory system (`server/operator/episodicMemory.ts`, `agent_memories` table) that persistently stores decisions, outcomes, preferences, and observations with relevance scoring and exponential time-decay. Memories are auto-captured from task outcomes, nudge interactions, and agent decisions, then injected into AI context as "Past Experience" entries. Memory management UI available in the Intelligence panel's "Memory" tab. API: `/api/operator/cognitive/memories/:subAccountId` (GET/POST/PUT/DELETE).
- **Proactive Push Alert System**: Multi-channel alert dispatching via browser push notifications (Web Push API with VAPID) and SMS (Twilio). Service in `server/pushAlertService.ts`. Supports 8 event types: `new_lead`, `missed_call`, `payment_failed`, `incident`, `nudge_high`, `agent_urgent`, `campaign_alert`, `system_alert`. Features quiet hours with urgent bypass, stale subscription cleanup, and per-account notification preferences. DB tables: `push_subscriptions`, `notification_preferences`. Push handlers merged into `client/public/sw.js`. Settings page: `/notification-preferences`. Env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (optional, gracefully degrades). Agent tasks support `urgent` flag for immediate push delivery.
- **Cross-Account Industry Benchmarks**: Anonymized aggregate metrics computed across all sub-accounts, grouped by industry. The benchmark aggregation service (`server/operator/benchmarkAggregator.ts`) runs hourly, computing response rates, contact counts, message volumes, automation counts, review counts, and integration counts with full statistical distributions (avg, median, p25, p75, p90). The dashboard shows a "How You Compare" widget with per-metric visual comparisons. Benchmarks feed into the strategic advisor, growth reports, and agent brain for industry-aware recommendations. DB table: `industry_benchmarks`. API routes: `/api/benchmarks/:subAccountId`, `/api/benchmarks/industry/:industry`, `/api/benchmarks/refresh`.
- **Autonomous Task Agent (AI-Enhanced)**: A 24/7 background AI worker (`server/operator/taskAgent.ts`, `server/operator/agentBrain.ts`) that uses Gemini AI to reason about each account's state, generate intelligent task plans, execute corrective actions via the Operator tool registry, learn from outcomes (success rates, streaks, failure patterns), and generate "While You Were Away" executive briefings. Dual decision layer: AI reasoning + rule-based fallbacks. DB tables: `agent_tasks`, `agent_config`, `agent_briefings`. API routes: `/api/agent/tasks/:id`, `/api/agent/stats/:id`, `/api/agent/scan/:id`, `/api/agent/config/:id`, `/api/agent/briefings/:id`, `/api/agent/outcomes/:id`, `/api/agent/briefing/generate/:id`. 7th tab in Intelligence panel with pulsing AI status, briefing banner, learning stats, and task feed with AI reasoning tags.
- **Access Control & Multi-Tenancy**: Authentication via Replit OIDC, native email/password, Google OAuth 2.0, Firebase Auth. Features include session idle timeout, plan-based feature gating, strict account ownership enforcement, and admin-only routes.
- **Platform Infrastructure**: Includes comprehensive rate limiting, centralized system logging, feature flags for dynamic control, server-side enforcement of plan limits, automation safety mechanisms (loop prevention), startup health checks, and a robust subscription lifecycle managed by Stripe webhooks.
- **Messaging Infrastructure**: SMS Opt-Out Guard with phone normalization and automatic confirmation replies.
- **Audit Trail**: Detailed logging of typed audit actions for compliance and monitoring.
- **Database Backup**: JSON snapshot manifests for data integrity.
- **Automation Trigger System**: The workflow automation engine uses a global trigger bridge (`fireAutomationTriggerGlobal` exported from `server/routes/v1.ts`) that enables any module to fire automation triggers. All callsites (webhooks, property, reviews, funnel, integrations, Vapi) use `import("./v1").then(({fireAutomationTriggerGlobal}) => ...)` pattern. Supported triggers: `new_lead`, `contact_created`, `deal_created`, `appointment_booked`, `review_received`, `call_completed`, `call_missed`, `OnFacebookDM`, `OnInstagramDM`, `OnWhatsAppReply`, `crash_detected`, `shopify_abandoned_cart`, `shopify_order_created`, `shopify_order_fulfilled`. Workflow step handlers: `SendFacebookDM`, `SendFormLink`, `SendWhatsApp`, `AIQualify`, `AIGenerate`, `ElevenLabsTTS`, `send_sms`, `VapiCall`. Bridge is initialized during route registration with startup log confirmation.
- **Event Bus**: An in-memory pub/sub system with priority queuing, dedup, retry logic, and a comprehensive log.
- **Job Queue**: A background async task processor with retry mechanisms, concurrency control, and history tracking.
- **UI/UX**: Mobile-responsive design, guided 5-step onboarding wizard, Apex Intelligence premium panel (`client/src/components/apex-intelligence.tsx` shell + 8 tab components in `client/src/components/intelligence/`) with advanced analytics and AI interaction features. The "Operator" tab (formerly "Advisor") is the primary autonomous operator interface — it uses a dynamic server-side system prompt (`server/operatorPrompt.ts`) that injects real account state, page context, integration status, and the full 64-tool manifest. All 64 operator tools are now executable from chat (expanded from 9). The site-assistant (`client/src/components/site-assistant.tsx`) mirrors this autonomous operator behavior with streaming tool execution, navigation actions, and page-aware context.
- **Real-time Streaming**: SSE-based streaming infrastructure (`server/streaming.ts`) with shared utilities (`streamGeminiResponse`, `ProgressStream`) for AI text streaming and step-by-step progress events. Frontend hook (`client/src/hooks/use-streaming.ts`) with `useStreamingResponse` for consuming SSE streams with progressive text rendering. Used by strategic advisor chat, God Mode deployment, and AI orchestrator.
- **Self-Optimizing Workflows**: Per-step execution metrics tracking, visual funnel analytics, and AI-powered optimization. Service in `server/operator/workflowAnalytics.ts`. DB tables: `workflow_step_metrics`, `workflow_optimization_logs`. Analytics tab in workflow builder shows step-by-step funnel with drop-off rates, bottleneck detection, rule-based and AI-generated optimization suggestions. Auto-optimize mode adjusts WAIT step timing (bounded 30% reduction on high drop-off steps) with full change log and one-click revert. API routes: `GET /api/workflows/:id/analytics`, `POST /api/workflows/:id/step-metrics`, `GET /api/workflows/:id/optimization-log`, `POST /api/workflows/:id/auto-optimize`, `POST /api/workflows/:id/revert-optimization/:logId`.

## External Dependencies

- **PostgreSQL**: Primary data storage.
- **Google Gemini API**: Used for AI functionalities across various modules including site generation, ad campaigns, bot chat, workflow AI, voice persona generation, and RAG. Features rate limit protection (60s cooldown on 429 errors) with `isGeminiAvailable()` gating for background services, and keyword-based intent fallback in the operator planner when AI is unavailable.
- **Twilio**: Phone number provisioning, SMS webhook handling, and WhatsApp Business API messaging.
- **Vapi**: Voice AI agent deployment and outbound calling.
- **Mailchimp**: Email campaign sending via Marketing API.
- **Firebase SDK**: Analytics, Push Notifications (FCM), and Google Auth.
- **Shopify Integration**: E-commerce automation via Shopify Admin API and webhooks.
- **Meta Webhooks**: For Facebook/Instagram DM bot functionality. **Multi-tenant**: Meta credentials (pageId, accessToken, appSecret) are stored per-account in `sub_accounts` table columns (`meta_page_id`, `meta_access_token`, `meta_app_secret`). Global env vars are auto-migrated on startup. Resolution via `server/metaConfig.ts`: `getMetaConfig(subAccountId)`, `resolveSubAccountByPageId(pageId)`, `buildMetaUrl()`. Webhook routing extracts `entry.id` (page ID) from inbound events to find the correct sub-account.
- **FLHSMV API**: For polling and retrieving crash reports.