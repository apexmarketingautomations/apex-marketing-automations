# Nexus - AI-Powered Business Communication Platform

## Overview

Nexus is a multi-tenant SaaS platform for managing business communications, AI bot training, and workflow automation. It serves as a white-label CRM-like tool where "sub-accounts" (client businesses) can manage SMS/Instagram messaging, build automated workflows, train AI chatbots on their website content, and onboard new accounts with industry-specific blueprints.

The app includes:
- **Unified Inbox**: Multi-channel messaging dashboard (SMS, Instagram, email) per sub-account
- **Workflow Builder**: Visual automation builder with triggers, delays, conditions, and actions
- **Bot Trainer**: AI chatbot training pipeline that scrapes websites, builds RAG knowledge bases, and supports tool-calling (calendar booking)
- **Onboarding**: Industry-specific setup wizard that provisions accounts with pre-built pipeline stages, fields, and templates
- **Landing Pages**: Demo landing pages for gym and luxury service verticals
- **Stripe Subscriptions**: 3-tier pricing (Starter $97/mo, Agency Pro $297/mo, God Mode $497/mo) with 60-day trials
- **Snapshot Marketplace**: Publish, browse, and fork account configurations as reusable templates
- **Snapshot Versioning**: Checkpoint/rollback system with bulk rollback for agencies
- **Affiliate Dashboard**: Referral links, tiered commissions (30-50%), payout tracking
- **Command Center**: Agency "War Room" with fleet health monitoring, production pipeline visualization
- **Account Switcher**: Multi-account context switching with persistent selection
- **Website Integration**: Connect client websites, scrape/train AI chatbots, generate embeddable chat widgets, and preview sites from within the platform
- **Interactive Tutorials**: 18 step-by-step guided tutorials covering every tool on the platform with spotlight highlighting, auto-launch on first visit, and localStorage completion tracking
- **Analytics Dashboard**: Real-time charts showing message volumes, AI usage trends, conversion rates, and pipeline performance with Recharts
- **CRM Pipeline**: Kanban-style deal pipeline with drag-and-drop between stages, contact management, and deal tracking
- **Calendar & Appointments**: Monthly calendar view with appointment scheduling, contact linking, and status management
- **Email Campaigns**: Campaign builder with templates (Welcome, Newsletter, Promotion), scheduling, open/click tracking, and send management
- **Webhooks**: Webhook management for external tool integration (Zapier, Make.com) with event selection, secret generation, and testing
- **White-Label**: Agency branding customization with logo, colors, custom domain, favicon, footer text, and branding toggle with live preview
- **Reports & Export**: CSV export for contacts, deals, and messages with aggregated analytics summary

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight alternative to React Router)
- **State Management**: TanStack React Query for server state; local React state for UI
- **Styling**: Tailwind CSS v4 with CSS variables for theming, shadcn/ui component library (New York style)
- **Animations**: Framer Motion for page transitions and UI animations
- **Forms**: React Hook Form with Zod validation via @hookform/resolvers
- **Build Tool**: Vite with path aliases (`@/` → `client/src/`, `@shared/` → `shared/`)

The frontend lives in `client/src/`. Pages are in `client/src/pages/`, reusable UI primitives in `client/src/components/ui/`, and the app layout (sidebar navigation) in `client/src/components/layout.tsx`.

### Backend
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript, executed via tsx
- **Architecture**: Monolithic Express server that serves both the API and the built frontend
- **API Pattern**: RESTful JSON API under `/api/*` prefix
- **Development**: Vite dev server is integrated as middleware for HMR during development; in production, static files are served from `dist/public/`

Key server files:
- `server/index.ts` - Express app setup, middleware, logging
- `server/routes.ts` - All API route definitions (accounts, messages, workflows, training jobs, blueprints, onboarding, AI generation, Twilio SMS, usage billing)
- `server/storage.ts` - Data access layer with `IStorage` interface and `DatabaseStorage` implementation
- `server/db.ts` - Database connection pool setup
- `server/seed.ts` - Seeds initial demo data on first run
- `server/vite.ts` - Vite dev server integration
- `server/static.ts` - Production static file serving

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database**: PostgreSQL (connected via `DATABASE_URL` environment variable)
- **Schema**: Defined in `shared/schema.ts` using Drizzle's `pgTable` helpers
- **Validation**: Zod schemas auto-generated from Drizzle schemas via `drizzle-zod`
- **Migrations**: Managed via `drizzle-kit push` (schema push strategy, not migration files)

### Database Tables
1. **sub_accounts** - Tenant accounts (name, Twilio number)
2. **messages** - Multi-channel messages (SMS/Instagram/email) with direction, status, contact info
3. **workflows** - Automation workflows with trigger type and JSON steps array
4. **training_jobs** - AI bot training job tracking (URL, persona, state, progress, logs)
5. **blueprints** - Industry-specific templates (stages, fields, templates) for onboarding
6. **sentinel_config** - Per-account Sentinel scanner config (feed URL, keywords, intervals, toggles)
7. **sentinel_incidents** - Detected accident/incident records with severity, location, action status
8. **client_websites** - Connected client websites with AI training status, widget config, and embed settings
9. **contacts** - CRM contacts with name, email, phone, company, source, tags
10. **pipeline_stages** - Configurable deal pipeline stages with color and position
11. **deals** - Deal/opportunity tracking with stage, value, contact link, status
12. **appointments** - Calendar appointments with start/end times, status, contact link
13. **email_campaigns** - Email campaign management with subject, body, scheduling, open/click tracking
14. **webhooks** - Webhook endpoints for external integrations with event filtering and secrets
15. **white_label_settings** - Per-agency branding customization (logo, colors, domain, branding toggle)

### Shared Code
The `shared/` directory contains code used by both frontend and backend:
- `shared/schema.ts` - Database schema definitions, Zod validation schemas, and TypeScript types

### Build Process
- Custom build script in `script/build.ts`
- Client: Built with Vite → `dist/public/`
- Server: Bundled with esbuild → `dist/index.cjs`
- Certain dependencies are bundled (allowlisted) to reduce cold start times; others are kept external

### API Routes
- `GET/POST /api/accounts` - Sub-account CRUD
- `GET /api/messages/:subAccountId` | `POST /api/messages` | `POST /api/messages/send` - Messaging (send endpoint uses real Twilio SMS + auto-logs usage)
- `GET/POST /api/workflows` | `GET/PATCH /api/workflows/:id` | `POST /api/workflows/generate` - Workflow management (generate uses real OpenAI GPT-4o)
- `POST /api/bot/chat` - Real OpenAI chat with custom persona + conversation history (auto-logs usage)
- `POST /api/bots/train` | `GET /api/jobs/:id` - Bot training jobs
- `GET /api/blueprints/:industryId` - Industry blueprints
- `POST /api/onboard` - Full onboarding flow (creates account + returns blueprint)
- `POST /api/voice-agents/create` - Deploy voice agent to Vapi (with objection handling rules)
- `GET /api/voice-agents` - List deployed voice agents
- `POST /api/voice-agents/call` - Outbound call via Vapi
- `POST /api/voice-agents/power-dial` | `GET /api/voice-agents/power-dial/:jobId` - Power Dialer batch calling
- `POST /api/voice-agents/generate-persona` - AI persona generation
- `GET /api/phone-numbers/config` - Check Twilio/Vapi key availability
- `GET /api/phone-numbers/search?areaCode=` - Search available Twilio numbers
- `POST /api/phone-numbers/purchase` - Buy Twilio number + auto-link to Vapi agent
- `GET /api/phone-numbers` - List owned Twilio numbers
- `POST /api/sms-webhook` - Unified Twilio webhook with AI auto-reply (SMS/WhatsApp/Messenger channel detection)
- `POST /api/vapi/start-web-call` - Backend proxy: creates browser web call via Vapi private key, returns webCallUrl
- `GET /api/voice-agents/calls?assistantId=&limit=` - Fetch call logs with recordings and transcripts from Vapi
- `POST /api/god-mode` - One-click empire builder: orchestrates account creation, Twilio phone provisioning, Vapi voice agent, bot training, AI site generation, and missed-call workflow
- `GET /api/reviews/:subAccountId` - List reviews for a sub-account
- `POST /api/reviews` - Create a review (public submission)
- `PATCH /api/reviews/:id` - Update review (toggle public, add AI response)
- `POST /api/alert-owner` - Negative review alert notification
- `GET/PATCH /api/review-config/:subAccountId` - Get/update Google Review link config
- `POST /api/usage/log` - Log usage event with markup (SMS, Voice, AI) + optional Stripe meter
- `GET /api/usage/:subAccountId` - Usage logs and summary for billing dashboard
- `POST /api/webhooks/vapi` - Vapi webhook: logs VOICE_MINUTE usage on call.ended
- `PATCH /api/accounts/:id` - Update sub-account fields (ownerPhone, etc.)
- `POST /api/domains/check` - Check domain availability with TLD pricing
- `POST /api/domains/search` - Search all TLD options for a domain query
- `POST /api/domains/purchase` - Purchase domain (simulated registrar) with usage logging
- `GET /api/domains/:subAccountId` - List domains for a sub-account
- `PATCH /api/domains/:id` - Configure domain (link site, DNS/SSL)
- `GET/PUT /api/sentinel/config/:subAccountId` - Sentinel scanner config CRUD
- `GET /api/sentinel/incidents/:subAccountId` - List detected incidents
- `POST /api/sentinel/scan` - Trigger manual scan (live feed or simulated data)
- `POST /api/sentinel/incidents/:id/deploy-geofence` - Deploy geofence ads around incident
- `POST /api/sentinel/incidents/:id/send-sms` - SMS alert to account owner via Twilio
- `POST /api/sentinel/incidents/:id/acknowledge` - Mark incident as handled
- `GET /api/login` - Replit OIDC login flow (redirects to Replit auth)
- `GET /api/logout` - Logout flow
- `GET /api/callback` - OIDC callback handler
- `GET /api/auth/user` - Get current authenticated user

## External Dependencies

### Database
- **PostgreSQL** - Primary data store, connected via `DATABASE_URL` environment variable using `pg` (node-postgres) connection pool

### AI/ML
- **Google Gemini API** - Gemini 2.5 Flash used for: site generation, ad campaign generation, bot chat, workflow AI generation, voice persona generation, chat widget, form builder. All calls auto-log usage to billing dashboard. Uses `@google/genai` SDK via `server/gemini.ts` helper module. Requires `Gemini_API_Key_saas` secret.
  - **Retry Logic** - Exponential backoff (3 attempts, 1s/2s/4s delays) for transient errors (429, 500, 503, network issues)
  - **Streaming** - `geminiChatStream` async generator for real-time SSE responses (bot chat + chat widget)
  - **Image Generation** - `geminiGenerateImage` using gemini-2.0-flash-exp with IMAGE response modality for ad campaign creatives
  - **JSON Mode** - `responseMimeType: "application/json"` for reliable structured output from all JSON-returning endpoints
  - **Industry Prompt Tuning** - 8 industry verticals (personal-injury, dental, medspa, gym, real-estate, roofing, hvac, plumbing) with tone/vocabulary/focus configs
  - **Multi-Language** - 12 languages supported (en, es, pt, fr, de, it, zh, ja, ko, ar, hi, ru) with per-account language preference
  - **Gemini Pricing** - AI_CHAT: $0.03/call, AI_STREAM: $0.03/call, AI_IMAGE_GEN: $0.25/image (updated from OpenAI rates)
- **RAG Pipeline** - Architecture references pgvector for similarity search on knowledge base chunks

### Communication Services
- **Twilio** - Phone number provisioning (search, purchase), SMS webhook with AI auto-reply. Requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN secrets (not using Replit integration — user dismissed it; credentials stored as manual secrets)
- **Vapi** - Voice AI agent deployment, outbound calling, browser demo calls. Uses strict Backend Proxy pattern: VAPI_API_KEY (private key) is used server-side only. Frontend never touches the key — all Vapi API calls go through Express endpoints. Optional VAPI_PHONE_NUMBER_ID for default outbound caller ID injection.

### Frontend Libraries
- **shadcn/ui** - Full component library (40+ Radix-based components)
- **Framer Motion** - Animation library
- **Recharts** - Charting (chart component exists)
- **Embla Carousel** - Carousel component
- **date-fns** - Date formatting

### Dev Tools
- **Vite** - Dev server and bundler with React plugin, Tailwind CSS plugin
- **Drizzle Kit** - Database schema management
- **esbuild** - Server bundling for production
- **Replit plugins** - Runtime error overlay, cartographer, dev banner (dev only)