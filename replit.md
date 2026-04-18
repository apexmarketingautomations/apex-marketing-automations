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
- **Migrations**: `npm run db:push` for schema sync; manual migrations in `migrations/`

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