# Apex Marketing Automations - AI-Powered Business Communication Platform

## Overview

Apex Marketing Automations is a multi-tenant SaaS platform designed to centralize and automate business communications, AI bot training, and workflow management. It functions as a white-label CRM, enabling client businesses (sub-accounts) to manage multi-channel messaging (SMS, Instagram), build automated workflows, train AI chatbots using their website content, and rapidly onboard new accounts with industry-specific blueprints. The platform aims to provide a comprehensive suite for enhancing client engagement, streamlining operations, and leveraging AI for competitive advantage in various industries.

Key capabilities include a public sales funnel, command dashboard for real-time metrics, unified inbox, visual workflow builder, AI bot trainer with RAG and tool-calling, industry-specific onboarding, Stripe subscriptions, a snapshot marketplace for account configurations, affiliate program, agency command center, and white-label branding options.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack React Query for server state; local React state for UI
- **Styling**: Tailwind CSS v4 with CSS variables, shadcn/ui component library (New York style)
- **Animations**: Framer Motion
- **Forms**: React Hook Form with Zod validation
- **Build Tool**: Vite with path aliases

The frontend is structured with pages in `client/src/pages/`, UI components in `client/src/components/ui/`, and layout in `client/src/components/layout.tsx`.

### Backend
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript, executed via `tsx`
- **Architecture**: Monolithic Express server serving both API and built frontend
- **API Pattern**: RESTful JSON API under `/api/*`
- **Development**: Vite dev server integrated as middleware for HMR; static files served from `dist/public/` in production.

Core server files include `server/index.ts` (Express setup), `server/routes.ts` (API definitions), `server/storage.ts` (data access), and `server/db.ts` (DB connection).

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database**: PostgreSQL (via `DATABASE_URL`)
- **Schema**: Defined in `shared/schema.ts` using Drizzle's `pgTable` helpers
- **Validation**: Zod schemas generated from Drizzle schemas via `drizzle-zod`
- **Migrations**: Managed via `drizzle-kit push` (schema push strategy).

Key database tables manage sub-accounts, messages, workflows, AI training jobs, blueprints, Sentinel configurations, incidents, client websites, CRM contacts, pipeline stages, deals, appointments, email campaigns, webhooks, white-label settings, Meta ad campaigns, leads, Instagram conversations/messages, webhook events, integration connections, portal tokens, notifications, live automations, and AI tool logs.

### Shared Code
The `shared/` directory centralizes database schema definitions, Zod validation schemas, and TypeScript types used by both frontend and backend.

### Build Process
- Custom build script (`script/build.ts`)
- Client: Built with Vite to `dist/public/`
- Server: Bundled with esbuild to `dist/index.cjs`.

### API Routes
The API provides comprehensive endpoints for managing accounts, messages, workflows, AI bots (chat, training, generation), blueprints, onboarding, voice agents (Vapi integration), phone numbers (Twilio integration), reviews, usage logging, domains, Sentinel scanning, and authentication (Replit OIDC). Specific routes exist for `god-mode` operations, webhooks, white-label configurations, Universal Dispatcher (`/api/v1/orchestrate`), AI Orchestrator (`/api/v1/orchestrate/ai`), webhook event log, integration connections, portal tokens, and dashboard analytics.

### Recent Additions
- **Monetization Engine**: Full credit wallet system (`credit_wallets`, `credit_transactions`), usage-based markup billing (3x multiplier on SMS/Vapi costs), Stripe checkout for credit top-ups, and automatic profit logging (`platform_profit_ledger`)
- **Sponsorship Engine** (`/sponsorship-manager`): Geo-targeted native ads served as JSON via `GET /api/v1/serve-native-ad?lat=&lon=`, bid-per-click model with `POST /api/v1/ad-click/:id`, admin approval workflow
- **Revenue Command** (`/revenue-command`): Admin-only profit dashboard showing total platform revenue, markup spread, ad click revenue, 7-day trend chart, and recent profit events
- **Apex Wallet** (`/billing`): Redesigned billing page with live credit balance, quick top-up buttons ($10-$500), transaction history, usage breakdown tabs
- **Integrations Hub** (`/integrations`): Full credential-based service connections with modal dialogs for entering API keys/tokens. Supports 16 providers (Google Maps, Calendar, Gmail, Sheets, Drive, Docs, Analytics, Business Profile, Slack, Zapier, QuickBooks, Twilio, Stripe, HubSpot, Mailchimp, Facebook). Config stored in `integration_connections.config` JSON field. Includes help links to credential pages.
- **Webhook Event Log** (`/webhook-events`): Timeline of all webhook deliveries with status, duration, and request/response details
- **Client Portal** (`/portal/:token`): Public page for end-clients to view their metrics, messages, and appointments via token-based access
- **Dashboard Analytics**: ROI charts with Recharts showing daily leads/messages, pipeline overview, ad performance, conversion rates
- **Live Demo** (`/demo`): Cinematic 5-scene walkthrough for prospects showing Sentinel detection, AI orchestrator, workflow execution, and results
- **Mobile Responsive**: Hamburger menu sidebar on mobile with slide-out drawer, responsive layouts throughout
- **Onboarding Wizard**: 5-step guided wizard (business info → connect phone → train AI → deploy workflow → completion)
- **TapCard Funnel** (`/cards`): Standalone digital card sales page with $9.99/mo or $69.99/yr pricing, Stripe checkout via `POST /api/card-checkout` (public, no auth), TapCard Pro upsell to full platform ($48/mo). Every public card links back to `/cards` as growth loop.
- **Liquid Website Protocol** (`/liquid`): Prompt-first AI landing page builder. User enters business name, industry, description, services, target audience, tone, and brand color. AI generates 5 sections (HERO, FEATURES, TESTIMONIALS, BOOKING, CTA) specifically for their business. Regenerate button returns to the prompt form. Template variable engine resolves `{{contact.first_name | default: 'Welcome'}}` and `{{url_param.heading}}` syntax. URL parameter injection from ad URLs. Sticky Contact via localStorage + CRM lookup (`POST /api/liquid/contact-lookup`, public). Form submissions wired to `/api/form-submit` creating CRM contacts with "Liquid Site Lead" tag. Rate-limited to 10 req/min/IP.
- **Sentinel Geofence Ingest** (`POST /api/v1/sentinel-ingest`): MAID-to-CRM bridge. Accepts `{maid, location_tag, timestamp, phone?, email?, name?}` from geofence hardware. Two-step enrichment: (1) If phone/email/name provided alongside MAID, enriches via People Data Labs Enrich API (`IDENTITY_API_KEY` env var) to get full contact profile (name, phone, email, location, company). (2) Creates CRM contact tagged `Crash_Connect_Lead` + `Sentinel_Geofence`. Logs sentinel incident. Optionally pushes to LeadConnector V2 API using `APEX_CRM_URL` and `APEX_API_KEY` env vars. Returns 200 immediately; processing runs async. Falls back to storing raw MAID + any provided data if no PDL key configured or enrichment fails.
- **Draggable UI**: Tutorial overlays and chat widgets are draggable via grab handles (`client/src/hooks/use-draggable.ts`). Bounds-clamped to prevent off-screen dragging.
- **Sales Chatbot (Aria)**: AI-powered sales assistant (`client/src/components/sales-chatbot.tsx`) on all public landing/funnel pages. Uses `POST /api/sales-chat` (public, rate-limited 15 req/min/IP). Niche-aware context for 17 industries. Draggable, dark-themed floating widget.

### Access Control & Multi-Tenancy
- **Dual authentication**: Supports both Replit OIDC (admin) and native email/password login (clients). `users` table has `passwordHash` and `authProvider` fields. `isAuthenticated` middleware handles both session types — skips OIDC token refresh for `authProvider: "email"` users. Login page (`client/src/pages/login.tsx`) shows email/password form with register/login toggle, plus "Continue with Replit" fallback.
- **Auth routes**: `POST /api/auth/register` (bcryptjs hash, auto-login), `POST /api/auth/email-login` (email+password verify), `POST /api/auth/apex-logout` (session destroy without OIDC redirect), `GET /api/auth/user` (handles both OIDC claims.sub and local user.id).
- **Plan-based feature gating**: Features are gated by plan tier (Starter/Pro/Enterprise) using `PLAN_TIERS` in `shared/schema.ts`. The `PlanGate` component (`client/src/components/plan-gate.tsx`) wraps protected pages and shows an upgrade overlay for locked features.
- **Account ownership enforcement**: `verifyAccountOwnership()` helper in `server/routes.ts` validates that the logged-in user owns the requested sub-account before returning any data. Applied to all 30+ routes that accept `subAccountId`. Admin users (matched by `ADMIN_USER_ID` env var) bypass ownership checks.
- **Strict account filtering**: `GET /api/accounts` returns only accounts where `ownerUserId === user.id`. Admin sees all. Non-owners get empty results (no leaked data from orphaned accounts).
- **Active account context**: `useActiveSubAccountId()` hook (`client/src/components/account-required.tsx`) provides the current active sub-account ID with null safety. All pages guard queries with `enabled: !!subAccountId`.
- **Sidebar gating**: Nav items with `requiredFeature` show lock icons and reduced opacity. Items with `adminOnly: true` are hidden from the sidebar entirely.
- **Plan-gated pages**: workflow-builder, voice-agent, email-campaigns, white-label, webhooks, bot-trainer all use PlanGate wrapper with Inner function pattern.
- **Stripe trial with card capture**: Subscription checkout uses `payment_method_collection: "always"` to require credit card info upfront even during the 60-day free trial period.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.

### AI/ML
- **Google Gemini API**: Used for site generation, ad campaign generation, bot chat, workflow AI generation, voice persona generation, chat widgets, and form builders. All calls log usage. Features include retry logic, streaming, image generation, JSON mode for structured output, industry-specific prompt tuning, and multi-language support. Architecture references pgvector for RAG.

### Communication Services
- **Twilio**: Phone number provisioning (search, purchase), SMS webhook with AI auto-reply.
- **Vapi**: Voice AI agent deployment, outbound calling, and browser demo calls. Utilizes a backend proxy pattern for API key security.

### Frontend Libraries
- **shadcn/ui**: Component library.
- **Framer Motion**: Animation library.
- **Recharts**: Charting library.
- **Embla Carousel**: Carousel component.
- **date-fns**: Date formatting utilities.

### Dev Tools
- **Vite**: Dev server and bundler.
- **Drizzle Kit**: Database schema management.
- **esbuild**: Server bundling for production.