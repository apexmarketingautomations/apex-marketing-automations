# Nexus - AI-Powered Business Communication Platform

## Overview

Nexus is a multi-tenant SaaS platform for managing business communications, AI bot training, and workflow automation. It serves as a white-label CRM-like tool where "sub-accounts" (client businesses) can manage SMS/Instagram messaging, build automated workflows, train AI chatbots on their website content, and onboard new accounts with industry-specific blueprints.

The app includes:
- **Unified Inbox**: Multi-channel messaging dashboard (SMS, Instagram, email) per sub-account
- **Workflow Builder**: Visual automation builder with triggers, delays, conditions, and actions
- **Bot Trainer**: AI chatbot training pipeline that scrapes websites, builds RAG knowledge bases, and supports tool-calling (calendar booking)
- **Onboarding**: Industry-specific setup wizard that provisions accounts with pre-built pipeline stages, fields, and templates
- **Landing Pages**: Demo landing pages for gym and luxury service verticals

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
- `server/routes.ts` - All API route definitions (accounts, messages, workflows, training jobs, blueprints, onboarding)
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
- `GET /api/messages/:subAccountId` | `POST /api/messages` - Messaging
- `GET/POST /api/workflows` | `GET/PATCH /api/workflows/:id` - Workflow management
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
- `GET /api/voice-agents/calls?assistantId=&limit=` - Fetch call logs with recordings and transcripts from Vapi

## External Dependencies

### Database
- **PostgreSQL** - Primary data store, connected via `DATABASE_URL` environment variable using `pg` (node-postgres) connection pool

### AI/ML (Referenced but may need implementation)
- **OpenAI API** - Referenced in attached assets for GPT-4o chat completions with function calling (calendar booking tools)
- **RAG Pipeline** - Architecture references pgvector for similarity search on knowledge base chunks

### Communication Services
- **Twilio** - Phone number provisioning (search, purchase), SMS webhook with AI auto-reply. Requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN secrets (not using Replit integration — user dismissed it; credentials stored as manual secrets)
- **Vapi** - Voice AI agent deployment, outbound calling, browser demo calls. Requires VAPI_API_KEY and VAPI_PUBLIC_KEY secrets

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