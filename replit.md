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
- **Architecture**: Modular Express server with domain-based route modules and a thin orchestrator.

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database**: PostgreSQL
- **Schema**: Defined in `shared/schema.ts` with `drizzle-zod` for validation

### Core Architectural Decisions
- **Monetization Engine**: Credit wallet system with usage-based markup billing and Stripe integration for top-ups.
- **Integrations Hub**: Supports both credential-based and OAuth service connections for a wide range of platforms (Google Suite, Meta, YouTube, LinkedIn, TikTok, Microsoft 365, Calendly, Slack, Zapier, QuickBooks, Twilio, Stripe, HubSpot, Mailchimp, ElevenLabs, WhatsApp Business, Shopify, Skip Trace). Includes platform-managed OAuth with token refresh.
- **AI-Native Business OS (Apex Operator)**: An AI-native command layer that interprets natural language tasks, plans multi-step execution, and interacts with a tool registry. It incorporates planning, execution, an approval system for high-risk actions, diagnostics, telemetry, and per-tenant memory. A pending action system handles confirmation flows.
- **Cognitive Intelligence Layer**: Extends the Operator with persistent memory, proactive advisory, strategic business analysis, and behavior-aware intelligence, including an Episodic Memory system and a Nudge System for proactive notifications.
- **Proactive Push Alert System**: Multi-channel alert dispatching via browser push notifications (Web Push API) and SMS (Twilio), supporting various event types with quiet hours and per-account notification preferences.
- **Cross-Account Industry Benchmarks**: Anonymized aggregate metrics computed across all sub-accounts, grouped by industry, to provide comparison and feed into strategic recommendations.
- **Autonomous Task Agent (AI-Enhanced)**: A 24/7 background AI worker that uses Gemini AI to reason about account states, generate task plans, execute corrective actions, learn from outcomes, and generate executive briefings.
- **Access Control & Multi-Tenancy**: Authentication via Replit OIDC, native email/password, Google OAuth 2.0, Firebase Auth, with plan-based feature gating and strict account ownership enforcement.
- **Platform Infrastructure**: Includes rate limiting, centralized system logging, feature flags, server-side enforcement of plan limits, automation safety mechanisms, startup health checks, and a robust subscription lifecycle managed by Stripe webhooks.
- **Messaging Infrastructure**: SMS Opt-Out Guard with phone normalization.
- **Audit Trail**: Detailed logging of audit actions for compliance.
- **Database Backup**: JSON snapshot manifests for data integrity.
- **Automation Trigger System**: A global trigger bridge enables modules to fire automation triggers for various events, with corresponding workflow step handlers.
- **Event Bus**: An in-memory pub/sub system with priority queuing, dedup, retry logic, and comprehensive logging.
- **Job Queue**: A background async task processor with retry mechanisms, concurrency control, and history tracking.
- **UI/UX**: Mobile-responsive design, guided 5-step onboarding wizard, and an Apex Intelligence premium panel with advanced analytics and AI interaction features, including a dynamic Operator tab and site-assistant.
- **Real-time Streaming**: SSE-based streaming infrastructure for AI text streaming and step-by-step progress events, consumed by a frontend hook.
- **Self-Optimizing Workflows**: Per-step execution metrics tracking, visual funnel analytics, and AI-powered optimization, including auto-optimization of WAIT step timings.

## External Dependencies

- **PostgreSQL**: Primary data storage.
- **Google Gemini API**: Used for AI functionalities across various modules.
- **Twilio**: Phone number provisioning, SMS, and WhatsApp Business API messaging.
- **Vapi**: Voice AI agent deployment and outbound calling, with call-type routing and distinct prompt paths.
- **Mailchimp Full Automation**: Event-driven email engine for contact sync, tag management, and campaign-based email sending.
- **Firebase SDK**: Analytics, Push Notifications (FCM), and Google Auth.
- **Shopify Integration**: E-commerce automation via Shopify Admin API and webhooks.
- **Meta Webhooks**: For multi-tenant Facebook/Instagram DM bot functionality with rich context assembly.
- **Google Calendar Auto-Sync**: Background service for syncing Google Calendar events with appointments and triggers.
- **FLHSMV API**: For polling and retrieving crash reports.

## Digital Business Card System (Standalone Product — Hard-Isolated from Apex)
- **Product**: "Digital Business Card + Lead Funnel" — $29 one-time payment, no login required
- **Flow**: Landing → Stripe Checkout → Card Created (webhook) → Success Page (card URL + edit link) → Email with edit token
- **Schema**: `digitalCards` table with `ownerEmail` (replaces subAccountId dependency), `editToken` (UUID for no-auth editing), `customerId`, `purchaseId`, `paymentStatus` (gate for public access). `cardAnalyticsEvents` with `ipHash`, `deviceType`, `country`, `city` enrichment.
- **Backend** (`server/routes/cards.ts`): 
  - `POST /api/card-checkout` — Creates Stripe one-time payment session ($29), no auth required
  - `GET /api/card/edit/:token` — Returns full card data by edit token, no auth required
  - `PUT /api/card/edit/:token` — Updates card data by edit token, no auth required
  - `GET /api/card/session/:sessionId` — Polls checkout session status, triggers fallback fulfillment
  - `handleDigitalCardWebhook()` — Called from main Stripe webhook when `source=digital_card`, creates card + slug
  - Public card API (`/api/public-card/:slug`) enforces `paymentStatus === "paid"` gate
  - Analytics event tracking with device detection and IP hashing
- **Frontend Pages**:
  - `/card/:slug` — Public card view (6 themes, sticky action bar, share modal, QR, services, links, social)
  - `/card/success` — Post-checkout success page with card URL and edit link
  - `/card/edit/:token` — Full card editor (basic info, contact, images, appearance, social links, custom links, services, SEO)
- **Standalone Product** (separate referral system): `/standalone/*` routes with `standalone_cards`, `standalone_orders`, `standalone_referral_codes`, `standalone_referrals` tables. Promo pricing ($24.50 for first 20 orders), $10 referral commissions.
- **Routing**: `/card/:slug` is the canonical URL. `/card/success`, `/card/edit/:token` are public routes.