# Apex Marketing Automations - AI-Powered Business Communication Platform

## Overview

Apex Marketing Automations is a multi-tenant SaaS platform designed to centralize and automate business communications, AI bot training, and workflow management. It functions as a white-label CRM, enabling businesses to manage multi-channel messaging (SMS, Instagram), build automated workflows, train AI chatbots using their website content, and rapidly onboard new accounts with industry-specific blueprints. The platform offers a public sales funnel, command dashboard, unified inbox, visual workflow builder, AI bot trainer with RAG and tool-calling, industry-specific onboarding, Stripe subscriptions, a snapshot marketplace, affiliate program, agency command center, and white-label branding. The project aims to enhance client engagement, streamline operations, and leverage AI for competitive advantage across various industries, empowering businesses with automated growth.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **State Management**: TanStack React Query
- **Styling**: Tailwind CSS v4, shadcn/ui (New York style)
- **Animations**: Framer Motion
- **Forms**: React Hook Form with Zod validation
- **UI/UX**: Mobile-responsive design, 4-tier breakpoint system, bottom navigation on mobile, guided 5-step onboarding wizard, Apex Intelligence premium panel.
- **Specific Pages**: WhatsApp Templates (CRUD, AI body generator), Content Planner (kanban/calendar, AI caption generator), Intelligence Dashboard (admin-only, cross-account insights, actionable buttons).

### Backend
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript
- **Architecture**: Modular Express server with domain-based route modules and a thin orchestrator.
- **Core Systems**: Monetization engine (credit wallet, Stripe), Integrations Hub (credential/OAuth), AI-Native Business OS (Apex Operator for natural language task interpretation, multi-step execution), Cognitive Intelligence Layer (persistent memory, proactive advisory), Proactive Push Alert System, Cross-Account Industry Benchmarks, Autonomous Task Agent (24/7 AI worker), Access Control & Multi-Tenancy (OIDC, email/password, Google OAuth, Firebase Auth), Platform Infrastructure (rate limiting, logging, feature flags, plan limits, safety mechanisms, health checks, Stripe webhooks), System Pulse, Process Safety (global error handlers).
- **Messaging Infrastructure**: SMS Opt-Out Guard, Unified Inbox with SSE real-time updates, contact name resolution, Telegram Integration (webhook, setup endpoint).
- **Automation**: Audit Trail, Database Backup (JSON snapshot manifests), Automation Trigger System, In-memory Event Bus (pub/sub, priority queueing, retry), Job Queue (background async tasks).
- **Advanced Features**: Self-Optimizing Workflows (per-step metrics, visual funnel analytics, AI optimization), Digital Business Card System (themes, data adapters, tier-based features, referral system), Account Readiness System (3-phase checker, guards benchmarks/intelligence), Command Engine (backend execution for 7 commands), Dashboard Smart Alerts & Benchmarks, Real-time Streaming (SSE for AI text/progress), Per-Account AI Persona System, Content Planner (social media scheduling, approval, media upload, background publisher worker with atomic job claiming via SKIP LOCKED, retry with exponential backoff, job admin panel with retry/cancel), Protected Account System (middleware, agent/operator guard).

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database**: PostgreSQL
- **Schema**: Defined in `shared/schema.ts` with `drizzle-zod` for validation

## External Dependencies

- **PostgreSQL**: Primary data storage.
- **Google Gemini API**: AI functionalities.
- **AI Gateway**: Centralized AI routing (OpenAI primary / Gemini fallback).
- **Twilio**: Phone number provisioning, SMS, WhatsApp Business API.
- **Vapi**: Voice AI agent deployment and outbound calling.
- **Mailchimp Full Automation**: Event-driven email engine.
- **Firebase SDK**: Analytics, Push Notifications (FCM), Google Auth.
- **Shopify Integration**: E-commerce automation (Admin API, webhooks).
- **Shared Intelligence Layer**: Cross-account organizational learning.
- **Meta Webhooks**: Multi-tenant Facebook/Instagram DM bot, Comment Auto-Reply Bot (Graph API v21.0, 24-hour messaging window enforcement, `messaging_type: "RESPONSE"`).
- **Comment Auto-Reply Bot with RAG Style Learning**: pgvector + OpenAI `text-embedding-3-small` for context-aware replies, persona spec auto-generation, spam detection, rate limiting.
- **Google Calendar Auto-Sync**: Background service.
- **Meta Campaign Background Sync**: Job-queue-based interval sync.
- **FLHSMV API**: For polling crash reports.