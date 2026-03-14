# Apex Marketing Automations - AI-Powered Business Communication Platform

## Overview

Apex Marketing Automations is a multi-tenant SaaS platform designed to centralize and automate business communications, AI bot training, and workflow management. It functions as a white-label CRM, enabling client businesses to manage multi-channel messaging (SMS, Instagram), build automated workflows, train AI chatbots using their website content, and rapidly onboard new accounts with industry-specific blueprints. The platform aims to provide a comprehensive suite for enhancing client engagement, streamlining operations, and leveraging AI for competitive advantage across various industries. Key capabilities include a public sales funnel, command dashboard, unified inbox, visual workflow builder, AI bot trainer with RAG and tool-calling, industry-specific onboarding, Stripe subscriptions, a snapshot marketplace, affiliate program, agency command center, and white-label branding options.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS v4, shadcn/ui (New York style)
- **Animations**: Framer Motion
- **Forms**: React Hook Form with Zod validation

### Backend
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript
- **Architecture**: Monolithic Express server serving both API (RESTful JSON) and built frontend

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database**: PostgreSQL
- **Schema**: Defined in `shared/schema.ts` with `drizzle-zod` for validation

### Key Features and Implementations
- **Monetization Engine**: Credit wallet system, usage-based markup billing, Stripe credit top-ups.
- **Integrations Hub**: Credential-based and OAuth service connections. OAuth providers: Google Suite, Meta (Facebook/Instagram), YouTube, LinkedIn, TikTok for Business, Microsoft 365 (Outlook/OneDrive/Teams), Calendly. Legacy credential providers: Slack, Zapier, QuickBooks, Twilio, Stripe, HubSpot, Mailchimp, ElevenLabs, WhatsApp Business, Shopify, Skip Trace. Includes platform-managed OAuth with token refresh, asset listing, and health checks.
- **ElevenLabs Voice AI**: Text-to-speech synthesis integration for voice agents and workflow steps.
- **WhatsApp Business API**: Dedicated integration via Twilio for template messages, interactive messages, delivery tracking, and WhatsApp-specific workflow triggers.
- **Client Portal**: Public page for end-clients with token-based access to metrics and messages.
- **Dashboard Analytics**: ROI charts for various metrics.
- **Mobile Responsive**: Adaptive design with hamburger menu.
- **Onboarding Wizard**: Guided 5-step setup process.
- **Liquid Website Protocol**: AI landing page builder with template variables and form submissions creating CRM contacts.
- **Sentinel Geofence Ingest**: MAID-to-CRM bridge for geofence data, contact enrichment, and lead push to external APIs.
- **Sales Chatbot (Aria)**: AI-powered sales assistant with niche-aware context.
- **Google Places Address Autocomplete**: Reusable component for address input.
- **Crash Connect Webhook**: HMAC-SHA256 authenticated webhook for crash events, creating CRM contacts and triggering automations.
- **Multi-Page Site Builder**: Upgraded site builder supporting multiple pages and navigation.
- **Location-Based Search**: Geocoded records with search capabilities and map visualization.

### Access Control & Multi-Tenancy
- **Authentication**: Replit OIDC, native email/password, Google OAuth 2.0, Firebase Auth.
- **Session Idle Timeout**: 30-minute inactivity timeout with client-side warning and auto-logout.
- **Plan-based Feature Gating**: Features restricted by Starter/Pro/Enterprise tiers.
- **Account Ownership Enforcement**: Strict data isolation via `verifyAccountOwnership()` helper.
- **Admin-Only Routes**: Restricted access for project download, god-mode, and global reports.

### Platform Infrastructure
- **Rate Limiting**: `express-rate-limit` for all API routes, authentication, webhooks, and messaging.
- **System Logging**: Centralized `system_logs` table with severity levels and admin viewer.
- **Feature Flags**: `feature_flags` table for dynamic feature control.
- **Plan Limits**: Server-side enforcement of usage limits for messages, automations, contacts, and AI.
- **Automation Safety**: Loop prevention and duplicate trigger detection for workflows.
- **Startup Health Checks**: Validation of critical services on boot.
- **Health Endpoint**: Public endpoint for real-time service status.
- **Subscription Lifecycle**: Full Stripe webhook-driven billing with handling of various subscription events (e.g., `checkout.session.completed`, `customer.subscription.updated`, `invoice.payment_succeeded`).
- **SMS Opt-Out Guard**: STOP/START keyword detection with phone normalization (E.164 variants), enforced on `/api/messages/send` and workflow dispatch; confirmation replies sent automatically.
- **Audit Trail**: Typed audit actions logged to `audit_trail` table with admin query API (`/api/admin/audit-logs`).
- **Database Backup**: JSON snapshot manifests with table counts; health check endpoint for DB connectivity and record stats.
- **Launch Readiness Dashboard**: Admin-only page (`/launch-readiness`) with 22-check scored readiness report, DB health/snapshots, system logs viewer, audit trail viewer, and feature flag toggle UI.
- **Support Debug Tools**: Admin endpoints to inspect any account or user with subscription, integrations, automations, and contact/message stats.
- **Event Bus**: In-memory pub/sub system (`server/eventBus.ts`) with priority queuing, dedup, retry with backoff, and 5000-entry log. Subscribers in `server/eventSubscribers.ts`. Events published from form submissions, Sentinel ingest, and messaging. Admin API: `/api/admin/event-bus/stats`, `/api/admin/event-bus/log`.
- **Job Queue**: Background async task processor (`server/jobQueue.ts`) with retry, concurrency control (5 workers), and history tracking. Admin API: `/api/admin/job-queue/stats`, `/api/admin/job-queue/history`.

### Apex Operator (AI-Native Business OS Layer)
The Apex Operator (`server/operator/`) is an AI-native command layer that interprets natural language business tasks, plans multi-step execution, validates safety, and executes using internal tools. It sits on top of the event bus architecture.

- **Tool Registry** (`server/operator/toolRegistry.ts`): 11 registered tools — `createPipeline`, `createContact`, `createWorkflow`, `generateLandingPage`, `checkIntegrationHealth`, `detectMissingSetup`, `sendTestSMS`, `diagnoseWorkflow`, `getAccountSummary`, `connectIntegration`, `launchCampaignDraft`. Each tool declares required autonomy level, approval requirements, parameters, and validation.
- **Planner/Executor** (`server/operator/planner.ts`): Pattern-matching intent interpreter that builds multi-step plans from natural language. Supports plan creation, execution, approval gates, and step-by-step validation.
- **Approval System** (`server/operator/approvals.ts`): Pending approval queue with 24h expiry. High-risk actions (workflow creation, landing pages, campaigns, SMS) require explicit user approval before execution.
- **Diagnostics Engine** (`server/operator/diagnostics.ts`): Real-time health scanning for event bus, job queue, integrations, workflows, messaging, and account configuration. Fires `system.diagnostic.critical` events.
- **Telemetry** (`server/operator/telemetry.ts`): Counters, gauges, and timing metrics. Collects system-wide metrics including event throughput, queue depth, memory usage, and module error rates.
- **Memory/State** (`server/operator/memory.ts`): Per-tenant key-value memory with TTL support for operator session context, action history, and failure tracking.
- **Event Hooks** (`server/operator/eventHooks.ts`): Reactive subscriptions to workflow failures, integration disconnections, message failures, and all CRM/form/payment events for telemetry.
- **Autonomy Levels**: Level 1 (Observe) — inspect only; Level 2 (Draft) — create drafts with approval; Level 3 (Execute) — auto-fix safe issues.
- **API Routes**: `POST /api/operator/command`, `POST /api/operator/approve`, `GET /api/operator/plans`, `GET /api/operator/tools`, `GET /api/operator/approvals`, `GET /api/operator/diagnostics`, `GET /api/operator/telemetry`, `GET /api/operator/memory/:subAccountId`.

### Cognitive Intelligence Layer
The Cognitive Intelligence Layer (`server/operator/cognitive*.ts`, `memoryEngine.ts`, `advisoryEngine.ts`, `trendDetection.ts`, `nudgeSystem.ts`, `industryKnowledge.ts`) adds persistent memory, proactive advisory, and behavior-aware intelligence on top of the Operator.

- **Memory Engine** (`server/operator/memoryEngine.ts`): Persistent DB-backed memory (replaces in-memory KV). Stores workspace profiles, behavior signals, performance snapshots, and pattern insights with versioning and TTL. Tables: `operator_memories`.
- **Context Builder** (`server/operator/contextBuilder.ts`): Assembles a full `ContextPacket` for any sub-account — workspace profile, behavior profile, performance snapshot, detected patterns, recent events, diagnostics summary, and industry knowledge.
- **Advisory Engine** (`server/operator/advisoryEngine.ts`): Generates prioritized, data-backed insights (opportunities, warnings, optimizations, milestones). Adapts message tone to user behavior profile. Filters low-priority insights when user has high dismiss rate.
- **Industry Knowledge** (`server/operator/industryKnowledge.ts`): Built-in knowledge base for 7 industries (Personal Injury, Real Estate, Roofing, Med Spa, Home Services, Legal, General). Includes lead strategies, conversion benchmarks, best channels, seasonal trends, common workflows, and response time benchmarks.
- **Trend Detection** (`server/operator/trendDetection.ts`): Analyzes performance snapshots over time to detect contact growth/decline, high failure rates, response gaps, inactive automations, and volume shifts.
- **Nudge System** (`server/operator/nudgeSystem.ts`): Rate-limited proactive notifications (max 3/day, 4h interval). Respects dismissal patterns. Persisted to `operator_nudges` table with dismiss/act tracking.
- **Cognitive Orchestrator** (`server/operator/cognitiveLayer.ts`): Unified facade for all cognitive modules. Used by API routes.
- **DB Tables**: `operator_memories` (versioned KV with TTL), `operator_nudges` (persistent nudge queue with status tracking).
- **Cognitive API Routes**: `GET /api/operator/cognitive/context/:id`, `/insights/:id`, `/trends/:id`, `/nudges/:id`, `/nudges/:id/pending`, `POST /nudges/:nudgeId/dismiss`, `POST /nudges/:nudgeId/act`, `GET /nudges/:id/history`, `GET /industry/:industry`, `GET /industries`, `POST /cognitive/track`.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.

### AI/ML
- **Google Gemini API**: Used for site generation, ad campaigns, bot chat, workflow AI, voice persona generation, and RAG.

### Communication Services
- **Twilio**: Phone number provisioning, SMS webhook, and WhatsApp Business API messaging.
- **Vapi**: Voice AI agent deployment and outbound calling.
- **Mailchimp**: Email campaign sending via Marketing API.

### Firebase
- **Firebase SDK**: For Analytics, Push Notifications (FCM), and Google Auth.

### Automation Engine
- **Shopify Integration**: E-commerce automation via Shopify Admin API, webhooks for events like `checkouts/create`, `orders/create`.
- **Facebook/Instagram DM Bot**: Meta webhook for per-account DM routing, keyword automations, and AI bot replies.
- **FLHSMV API**: For polling and retrieving crash reports.