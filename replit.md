# Apex Marketing Automations — AI-Powered Multi-Tenant Business OS

## Overview

Apex Marketing Automations is a multi-tenant SaaS platform designed to centralize business communications, leverage AI for messaging and automation, and streamline marketing efforts. It functions as a white-label agency CRM, offering multi-channel messaging (SMS, Facebook DMs, Instagram DMs), AI chatbot training, workflow automation, and industry-specific account onboarding. The platform's primary goal is to provide an AI-powered business operating system that automates marketing and communication tasks, enhancing efficiency and reducing manual overhead. A key feature includes the "Officer Layla Woods" AI persona for 24/7 social media DM management.

## User Preferences

- Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack React Query
- **Styling**: Tailwind CSS v4, shadcn/ui (New York style)
- **Animations**: Framer Motion
- **Forms**: React Hook Form with Zod validation
- **UI/UX**: Mobile-responsive design (4-tier breakpoints), mobile bottom navigation, and a guided onboarding wizard.

### Backend
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript
- **Architecture**: Modular Express server with domain-based route modules.
- **AI & Messaging**: Features an AI Gateway for routing (OpenAI primary, Gemini fallback), Officer Layla AI Persona for DMs, a Unified Inbox, and a Comment Auto-Reply Bot using pgvector and OpenAI embeddings. Apex Operator acts as a cognitive intelligence layer. DM context assembly manages persona overrides to prevent contamination. Meta webhook handler includes echo detection and sender batching.
- **Content Planner & Social Publishing**: Supports creation, scheduling, and publishing of posts to Facebook and Instagram with AI caption generation. A background worker handles scheduled posts using the Meta Graph API.
- **CRM & Lead Management**: Provides multi-tenant accounts, a visual deal pipeline, multi-channel contact management, and a form builder.
- **Intelligence Layers**:
    - **Scoring Engine**: Calculates 12 dimensions of account health and performance.
    - **Recommendation Engine**: Generates prioritized, data-backed recommendations.
    - **Network Intelligence**: Detects anonymized cross-account patterns and benchmarks.
    - **Autonomy Layer (Safe Actions Engine)**: Dispatches and validates actions (Setup, Repair, Optimization) with safety classifications, rollback, and audit logging.
    - **Apex Learning Feed**: Central pipeline for all system signals into a `universal_events` table for AI learning.
- **Crash Reports & Environmental Services**: Integrates with FLHSMV for crash report processing and lead conversion. Sentinel Home Services processes NOAA NWS weather alerts for opportunity scoring.
- **NFC/QR Tracking & Attribution**: Provides a capture and attribution layer for NFC business cards and QR codes, including schema for `tracking_links`, `tracking_visits`, and `tracking_events`. Features robust capture routes, public and server-to-server ingestion, and integration with Apex Intelligence. Includes identity stitching for linking anonymous visits to identified contacts and per-card intelligence snapshots for pre-aggregated analytics.
- **Digital Card Lead Intelligence**: Implements per-visitor session tracking and intent scoring for digital cards, surfaced in a Lead Table within the card builder. Tracks sessions and events, computes intent scores, and provides admin views of sessions. Includes SEO meta injection for public card pages and enhanced builder UI with analytics summaries and a LeadTable.

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database**: PostgreSQL 16
- **Schema**: `shared/schema.ts` with `drizzle-zod` for validation
- **Migrations**: Schema-first approach using `npm run db:push` for changes.

## Code Quality Guardrails

- **Silent error-swallowing checker** (`scripts/check-silent-catches.mjs`):
  Scans `server/` for `} catch {}`, `} catch (_) {}`, and `.catch(() => …)`
  patterns that hide real failures. Each catch must either bind & log the
  error, or carry an inline `// allow-silent-catch: <reason>` justification.
  Runs automatically as the first step of `script/build.ts` (production
  builds fail if violations exist). For local pre-commit enforcement,
  enable the bundled hook: `git config core.hooksPath .githooks`.

## Data Migrations

For one-off SQL fixes that must run BEFORE drizzle's schema sync (e.g. a
new uniqueness constraint on a table that already has duplicates), drop a
date-prefixed `.sql` file into `scripts/migrations/`.

- The runner (`scripts/run-data-migrations.ts`) executes each file in
  lexical order, inside its own transaction, and records it in the
  `_data_migrations` table so it never re-runs.
- A pg advisory lock prevents two runners from racing on the same migration.
- Dev: runs automatically inside `scripts/post-merge.sh` before `db:push`.
- Production: run as a one-shot operator step BEFORE deploy/`db:push`:
  ```
  DATABASE_URL=<prod-url> npx tsx scripts/run-data-migrations.ts
  ```
  Then verify with: `SELECT name, applied_at FROM _data_migrations;`

## External Dependencies

- **OpenAI**: Primary AI model (`gpt-4o-mini`) for general AI tasks.
- **Gemini**: Fallback AI model.
- **Meta/Facebook**: Webhooks for DMs, Graph API for publishing, ad campaign management.
- **Twilio**: SMS, voice, and WhatsApp Business API.
- **Stripe**: Payment processing, subscriptions, billing.
- **Mailchimp**: Event-driven email automation.
- **Google Calendar**: Background auto-synchronization.
- **Vapi**: Voice AI agent deployment.
- **Firebase**: Push notifications (FCM) and Google Authentication.
- **Google Maps/Places**: Location-based services.