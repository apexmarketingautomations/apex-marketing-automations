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

Key database tables manage sub-accounts, messages, workflows, AI training jobs, blueprints, Sentinel configurations, incidents, client websites, CRM contacts, pipeline stages, deals, appointments, email campaigns, webhooks, white-label settings, Meta ad campaigns, leads, and Instagram conversations/messages.

### Shared Code
The `shared/` directory centralizes database schema definitions, Zod validation schemas, and TypeScript types used by both frontend and backend.

### Build Process
- Custom build script (`script/build.ts`)
- Client: Built with Vite to `dist/public/`
- Server: Bundled with esbuild to `dist/index.cjs`.

### API Routes
The API provides comprehensive endpoints for managing accounts, messages, workflows, AI bots (chat, training, generation), blueprints, onboarding, voice agents (Vapi integration), phone numbers (Twilio integration), reviews, usage logging, domains, Sentinel scanning, and authentication (Replit OIDC). Specific routes exist for `god-mode` operations, webhooks, and white-label configurations.

### Access Control & Multi-Tenancy
- **Plan-based feature gating**: Features are gated by plan tier (Starter/Pro/Enterprise) using `PLAN_TIERS` in `shared/schema.ts`. The `PlanGate` component (`client/src/components/plan-gate.tsx`) wraps protected pages and shows an upgrade overlay for locked features.
- **Account ownership**: Sub-accounts have `ownerUserId` linking them to the creating user. `GET /api/accounts` filters by ownership. All account creation routes set `ownerUserId`.
- **Active account context**: `useActiveSubAccountId()` hook (`client/src/components/account-required.tsx`) provides the current active sub-account ID with null safety. All pages guard queries with `enabled: !!subAccountId`.
- **Sidebar gating**: Nav items with `requiredFeature` show lock icons and reduced opacity. Items with `adminOnly: true` are hidden from the sidebar entirely.
- **Plan-gated pages**: workflow-builder, voice-agent, email-campaigns, white-label, webhooks, bot-trainer all use PlanGate wrapper with Inner function pattern.

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