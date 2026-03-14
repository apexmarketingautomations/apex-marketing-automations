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
- **Architecture**: Monolithic Express server serving both API (RESTful JSON) and built frontend

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database**: PostgreSQL
- **Schema**: Defined in `shared/schema.ts` with `drizzle-zod` for validation

### Core Architectural Decisions
- **Monetization Engine**: Credit wallet system with usage-based markup billing and Stripe integration for top-ups.
- **Integrations Hub**: Supports both credential-based and OAuth service connections (Google Suite, Meta, YouTube, LinkedIn, TikTok, Microsoft 365, Calendly, Slack, Zapier, QuickBooks, Twilio, Stripe, HubSpot, Mailchimp, ElevenLabs, WhatsApp Business, Shopify, Skip Trace). Includes platform-managed OAuth with token refresh.
- **AI-Native Business OS (Apex Operator)**: An AI-native command layer (`server/operator/`) that interprets natural language tasks, plans multi-step execution, and interacts with a tool registry. It incorporates planning, execution, an approval system for high-risk actions, diagnostics, telemetry, and per-tenant memory.
- **Cognitive Intelligence Layer**: Extends the Operator with persistent memory, proactive advisory, strategic business analysis, and behavior-aware intelligence. Includes a Memory Engine, Context Builder, Advisory Engine, Strategic Advisor, Industry Knowledge base, Trend Detection, and a Nudge System for proactive notifications.
- **Autonomous Task Agent (AI-Enhanced)**: A 24/7 background AI worker (`server/operator/taskAgent.ts`, `server/operator/agentBrain.ts`) that uses Gemini AI to reason about each account's state, generate intelligent task plans, execute corrective actions via the Operator tool registry, learn from outcomes (success rates, streaks, failure patterns), and generate "While You Were Away" executive briefings. Dual decision layer: AI reasoning + rule-based fallbacks. DB tables: `agent_tasks`, `agent_config`, `agent_briefings`. API routes: `/api/agent/tasks/:id`, `/api/agent/stats/:id`, `/api/agent/scan/:id`, `/api/agent/config/:id`, `/api/agent/briefings/:id`, `/api/agent/outcomes/:id`, `/api/agent/briefing/generate/:id`. 7th tab in Intelligence panel with pulsing AI status, briefing banner, learning stats, and task feed with AI reasoning tags.
- **Access Control & Multi-Tenancy**: Authentication via Replit OIDC, native email/password, Google OAuth 2.0, Firebase Auth. Features include session idle timeout, plan-based feature gating, strict account ownership enforcement, and admin-only routes.
- **Platform Infrastructure**: Includes comprehensive rate limiting, centralized system logging, feature flags for dynamic control, server-side enforcement of plan limits, automation safety mechanisms (loop prevention), startup health checks, and a robust subscription lifecycle managed by Stripe webhooks.
- **Messaging Infrastructure**: SMS Opt-Out Guard with phone normalization and automatic confirmation replies.
- **Audit Trail**: Detailed logging of typed audit actions for compliance and monitoring.
- **Database Backup**: JSON snapshot manifests for data integrity.
- **Event Bus**: An in-memory pub/sub system with priority queuing, dedup, retry logic, and a comprehensive log.
- **Job Queue**: A background async task processor with retry mechanisms, concurrency control, and history tracking.
- **UI/UX**: Mobile-responsive design, guided 5-step onboarding wizard, Apex Intelligence premium panel with advanced analytics and AI interaction features.

## External Dependencies

- **PostgreSQL**: Primary data storage.
- **Google Gemini API**: Used for AI functionalities across various modules including site generation, ad campaigns, bot chat, workflow AI, voice persona generation, and RAG.
- **Twilio**: Phone number provisioning, SMS webhook handling, and WhatsApp Business API messaging.
- **Vapi**: Voice AI agent deployment and outbound calling.
- **Mailchimp**: Email campaign sending via Marketing API.
- **Firebase SDK**: Analytics, Push Notifications (FCM), and Google Auth.
- **Shopify Integration**: E-commerce automation via Shopify Admin API and webhooks.
- **Meta Webhooks**: For Facebook/Instagram DM bot functionality.
- **FLHSMV API**: For polling and retrieving crash reports.