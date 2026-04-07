# Apex Marketing Automations — AI-Powered Multi-Tenant Business OS

## Overview

Apex Marketing Automations is a multi-tenant SaaS platform that centralizes business communications, AI-powered messaging, social media publishing, CRM, workflow automation, and lead generation. It operates as a white-label agency CRM enabling businesses to manage multi-channel messaging (SMS, Facebook DMs, Instagram DMs), train AI chatbots, build automated workflows, and onboard accounts with industry-specific blueprints.

**Core Feature:** "Officer Layla Woods" — an AI persona that handles Facebook and Instagram DMs 24/7 for the "Apex By Donte" brand (sub_account ID 22, Page ID 736112766259045).

**Production URL:** `https://apexmarketingautomations.com` (also `https://apex-marketing-automations.replit.app`)

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
- **UI/UX**: Mobile-responsive, 4-tier breakpoints, bottom nav on mobile, guided onboarding wizard

### Backend
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript (compiled via tsx in dev, esbuild for production)
- **Architecture**: Modular Express server with domain-based route modules
- **Build**: `npm run build` (Vite frontend + esbuild server → `dist/`)
- **Start**: `npm run dev` (development), `npm run start` (production)

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database**: PostgreSQL 16
- **Schema**: `shared/schema.ts` with `drizzle-zod` for validation
- **Migrations**: `npm run db:push` for schema sync; manual migrations in `migrations/`

## Key Files & Directories

### Server
| File/Directory | Purpose |
|---|---|
| `server/index.ts` | App entry point, Stripe webhooks, middleware, startup sequence |
| `server/routes.ts` | Central route registration |
| `server/routes/` | All API route modules (auth, messaging, content planner, webhooks, etc.) |
| `server/routes/webhooks.ts` | Meta webhook handler (Facebook/Instagram DMs) |
| `server/routes/contentPlanner.ts` | Content Planner CRUD, scheduling, publishing API |
| `server/dmContextAssembler.ts` | Assembles AI context for Layla DM responses |
| `server/services/contentPlanner/` | Publisher, scheduler worker, platform adapters |
| `server/services/contentPlanner/schedulerWorker.ts` | Background worker polling every 30s for scheduled posts |
| `server/services/contentPlanner/publisher.ts` | Publishes to Facebook/Instagram via Graph API |
| `server/services/personas/` | Layla AI persona (system prompts, voice, post-processing) |
| `server/services/commentBot/` | Comment auto-reply bot with RAG-style learning |
| `server/services/styleTraining/` | AI style training via embeddings + pgvector |
| `server/operator/` | Apex Operator (AI brain, memory, strategic advisor) |
| `server/crashIngestPipeline.ts` | FLHSMV crash report ingestion (polls every 5min) |
| `server/crashReportWorker.ts` | Crash report processing worker |
| `server/agentWorker.ts` | Autonomous task agent (background AI worker) |
| `server/middleware/protectedAccount.ts` | Account protection middleware |
| `server/services/laylaAccountResolver.ts` | Resolves Layla account ID and protected accounts |
| `server/startupPatches.ts` | Idempotent DB patches on every startup |
| `server/seed.ts` | Database seeding |

### Frontend
| File/Directory | Purpose |
|---|---|
| `client/src/App.tsx` | Router and page registration |
| `client/src/pages/` | All page components |
| `client/src/pages/content-planner.tsx` | Content Planner UI (kanban, calendar, post editor) |
| `client/src/pages/dashboard.tsx` | Main dashboard |
| `client/src/pages/meta-messaging.tsx` | Facebook/Instagram messaging UI |
| `client/src/pages/workflow-builder.tsx` | Visual workflow builder |
| `client/src/pages/site-builder.tsx` | Website builder |
| `client/src/pages/sentinel.tsx` | Crash monitoring dashboard |
| `client/src/pages/voice-agent.tsx` | Voice AI agent interface |
| `client/index.html` | Entry HTML with meta tags |

### Shared
| File | Purpose |
|---|---|
| `shared/schema.ts` | Drizzle schema (all tables, types, insert schemas) |

## Major Features & Modules

### AI & Messaging
- **Officer Layla AI Persona**: Handles Facebook/Instagram DMs via Meta webhooks. System prompt loaded from `ai_prompt_config` DB table. Pet name: always "love" (never baby/babe/hun/etc). Uses OpenAI (gpt-4o-mini) primary, Gemini fallback with 120s circuit breaker.
- **AI Gateway**: Centralized routing — OpenAI primary (`OPENAI_APEX_INT_KEY`), Gemini fallback (`Gemini_API_Key_saas`). 12s timeout, 3-failure circuit breaker.
- **Unified Inbox**: Real-time SSE updates, multi-channel (SMS, Facebook, Instagram), contact name resolution.
- **Comment Auto-Reply Bot**: pgvector + OpenAI embeddings for context-aware replies, spam detection, rate limiting.
- **Apex Operator**: Natural language task interpretation, multi-step execution, cognitive intelligence layer (memory, advisory, trend detection, nudge system).

### Content Planner & Social Publishing
- **Content Planner**: Create/schedule/publish posts to Facebook and Instagram. Kanban board + calendar view. AI caption generator.
- **Scheduler Worker**: Background worker (`CP-WORKER`) polls every 30s for posts with status "scheduled" whose `scheduled_at` time has passed. Uses UTC internally.
- **Publisher**: Publishes via Meta Graph API v21.0. Resolves credentials from `social_accounts` table first, falls back to `sub_accounts.meta_access_token`.
- **Social Accounts**: Auto-created from sub-account Meta credentials when Content Planner is first accessed. Stored in `social_accounts` table.
- **Timezone**: Schedule input uses browser local time. Frontend shows timezone indicator. Converted to UTC for storage/comparison.
- **Auto-scheduling**: When a post is created/updated with a future `scheduledAt`, status is automatically set to "scheduled".

### CRM & Lead Management
- **Multi-tenant accounts**: Each business is a `sub_account` with isolated data.
- **Pipeline/Deals**: Visual deal pipeline with drag-and-drop.
- **Contacts**: Multi-channel contact management with tagging.
- **Forms**: Form builder with submission handling.

### Crash Reports (Sentinel)
- **FLHSMV Crash Ingest**: Polls Florida Highway Patrol feed every 5 minutes. Deduplicates via SHA-256 hash. Auto-converts qualifying crashes to leads.
- **Crash Worker**: Processes crash reports for downstream actions (hourly).
- **Sentinel Dashboard**: Monitoring UI for crash incidents.

### Integrations
- **Meta/Facebook**: Webhooks for DMs (production URL: `https://apex-marketing-automations.replit.app/api/meta-webhook`), Graph API for publishing, ad campaigns.
- **Twilio**: SMS, phone provisioning, WhatsApp Business API.
- **Stripe**: Subscriptions, billing, webhook handling, credit wallet.
- **Mailchimp**: Event-driven email automation (lead.created, contact.created, etc.).
- **Google Calendar**: Background auto-sync.
- **Vapi**: Voice AI agent deployment.
- **Firebase**: Push notifications (FCM), Google Auth.

### Other Features
- **Workflow Builder**: Visual automation builder with per-step metrics.
- **Site Builder / Liquid Website**: Website generation tool.
- **Digital Business Cards**: Themed cards with referral system.
- **Ad Launcher**: Meta ad campaign management.
- **Niche Funnels**: Industry-specific landing pages (auto dealers, chiropractors, dentists, gyms, real estate, lawyers, etc.).
- **A/B Testing**: Split testing framework.
- **God Mode**: Admin-only advanced controls.
- **Marketplace**: Snapshot/template marketplace.
- **Industry Benchmarks**: Cross-account metrics aggregation (hourly).

## External Services & API Keys

| Service | Env Variable | Purpose |
|---|---|---|
| OpenAI | `OPENAI_APEX_INT_KEY` | Primary AI (gpt-4o-mini) |
| Gemini | `Gemini_API_Key_saas` | Fallback AI |
| Meta | `META_APP_ID`, `META_APP_SECRET` | Facebook/Instagram integration |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | SMS & voice |
| Google | `GOOGLE_API_KEY` | Maps, Places |
| Stripe | Via Replit integration | Payments |
| Mailchimp | Via integration | Email automation |
| Firebase | Via config | Push notifications, auth |
| Vapi | `VAPI_PUBLIC_KEY`, `VAPI_ORG_ID` | Voice agent |

## Critical Configuration Notes

- **Meta Webhook URL**: Production is `https://apex-marketing-automations.replit.app/api/meta-webhook` — DO NOT change to dev URL.
- **Layla Account**: sub_account ID 22, Page ID 736112766259045, IG Account ID 17841476646118014.
- **AI Prompt Source**: Layla's system prompt is loaded from `ai_prompt_config.systemPrompt` in DB (via `dmContextAssembler.ts`), NOT from `laylaSystemPrompt.ts`.
- **Account Protection**: Accounts 13 and 22 are unprotected (`is_protected=false`). Protection middleware infrastructure remains for future use.
- **Post-Merge Script**: `scripts/post-merge.sh` runs `npm install` + `npm run db:push --force` on every task merge. This can cause data loss if schema changes drop columns/tables.
- **Scheduler Timezone**: All scheduling uses UTC. The `datetime-local` browser input sends local time which gets converted to UTC via `new Date().toISOString()`.
- **Per-Account Meta Credentials**: Each sub-account stores its own `meta_page_id` and `meta_access_token`. No global Meta token.

## Background Workers

| Worker | Interval | Purpose |
|---|---|---|
| CP-WORKER (Content Publisher) | 30s | Polls for scheduled posts to publish |
| CRASH-INGEST | 5min | Polls FLHSMV for new crash reports |
| CRASH-WORKER | 1hr | Processes crash reports |
| META-SYNC | 45min | Syncs Meta ad campaigns |
| GCAL-SYNC | 1hr | Syncs Google Calendar events |
| RETRY-PROCESSOR | 1hr | Retries failed operations |
| FOLLOWUP-WORKER | 1hr | Processes follow-up tasks |
| AGENT-WORKER | 60s | Autonomous AI task execution |
| TASK-AGENT | 60min | Scans for autonomous tasks |
| BENCHMARKS | 60min | Aggregates industry benchmarks |
| CALL-INTEL | Daily | Auto-learning from call data |

## Deployment

- **Target**: Replit Autoscale
- **Build**: `npm run build` (Vite + esbuild)
- **Run**: `npm run start` (production)
- **Database**: Shared between dev and production (same `DATABASE_URL`)
- **Domain**: `apexmarketingautomations.com` (custom) + `apex-marketing-automations.replit.app`
