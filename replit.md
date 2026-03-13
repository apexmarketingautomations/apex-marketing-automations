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
- **Integrations Hub**: Credential-based and OAuth service connections (Google Suite, Slack, Zapier, QuickBooks, Twilio, Stripe, HubSpot, Mailchimp, Facebook, ElevenLabs, WhatsApp Business). Includes platform-managed OAuth for Google and Meta with token refresh, asset listing, and health checks.
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