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
- **Cross-Account Industry Benchmarks**: Anonymized aggregate metrics for industry comparison and strategic recommendations.
- **Autonomous Task Agent (AI-Enhanced)**: A 24/7 background AI worker using Gemini AI for reasoning, task plan generation, execution, learning, and executive briefings.
- **Access Control & Multi-Tenancy**: Authentication via Replit OIDC, native email/password, Google OAuth 2.0, Firebase Auth, with plan-based feature gating and strict account ownership.
- **Platform Infrastructure**: Includes rate limiting, centralized system logging, feature flags, server-side enforcement of plan limits, automation safety mechanisms, startup health checks, and Stripe webhook-managed subscription lifecycle.
- **System Pulse**: Service health monitoring with core vs. optional service categorization.
- **Process Safety**: Global error handlers for `unhandledRejection` and `uncaughtException`.
- **Messaging Infrastructure**: SMS Opt-Out Guard with phone normalization. Unified Inbox with SSE real-time updates across all channels.
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
- **Meta Webhooks**: For multi-tenant Facebook/Instagram DM bot functionality and Comment Auto-Reply Bot.
- **Content Planner**: Social media content management system with scheduling, approval workflows, and platform adapters (Facebook, Instagram, X, TikTok).
- **Google Calendar Auto-Sync**: Background service for syncing Google Calendar events.
- **Meta Campaign Background Sync**: Job-queue-based interval sync for Meta ad campaigns.
- **FLHSMV API**: For polling and retrieving crash reports.