# Apex Marketing Automations - AI-Powered Business Communication Platform

## Overview

Apex Marketing Automations is a multi-tenant SaaS platform designed to centralize and automate business communications, AI bot training, and workflow management. It functions as a white-label CRM, enabling client businesses to manage multi-channel messaging (SMS, Instagram), build automated workflows, train AI chatbots using their website content, and rapidly onboard new accounts with industry-specific blueprints. The platform aims to provide a comprehensive suite for enhancing client engagement, streamlining operations, and leveraging AI for competitive advantage across various industries. Key capabilities include a public sales funnel, command dashboard, unified inbox, visual workflow builder, AI bot trainer with RAG and tool-calling, industry-specific onboarding, Stripe subscriptions, a snapshot marketplace, affiliate program, agency command center, and white-label branding options.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **State Management**: TanStack React Query for server state, local React state for UI
- **Styling**: Tailwind CSS v4, shadcn/ui (New York style)
- **Animations**: Framer Motion
- **Forms**: React Hook Form with Zod validation
- **Build Tool**: Vite

### Backend
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript
- **Architecture**: Monolithic Express server serving both API (RESTful JSON) and built frontend
- **Development**: Vite dev server as middleware; static files served from `dist/public/` in production.

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database**: PostgreSQL
- **Schema**: Defined in `shared/schema.ts` with `drizzle-zod` for validation
- **Migrations**: `drizzle-kit push`

### Shared Code
The `shared/` directory centralizes database schema definitions, Zod validation schemas, and TypeScript types for both frontend and backend.

### Build Process
- Custom build script (`script/build.ts`)
- Client: Vite to `dist/public/`
- Server: esbuild to `dist/index.cjs`.

### API Routes
Comprehensive API for accounts, messages, workflows, AI bots, blueprints, onboarding, voice agents, phone numbers, reviews, usage logging, domains, Sentinel scanning, and authentication (Replit OIDC, Email/Password, Google OAuth). Includes `god-mode` operations, webhooks, white-label configurations, Universal Dispatcher, AI Orchestrator, webhook event log, integration connections, portal tokens, and dashboard analytics.

### Key Features and Implementations
- **Monetization Engine**: Credit wallet system, usage-based markup billing (3x for SMS/Vapi), Stripe credit top-ups, profit logging.
- **Sponsorship Engine**: Geo-targeted native ads, bid-per-click model, admin approval.
- **Revenue Command**: Admin-only profit dashboard.
- **Apex Wallet**: Redesigned billing with live credit balance, top-up options, transaction history.
- **Integrations Hub**: Credential-based service connections for 17 providers (Google Suite, Slack, Zapier, QuickBooks, Twilio, Stripe, HubSpot, Mailchimp, Facebook, ElevenLabs), config stored in `integration_connections.config`.
- **ElevenLabs Voice AI**: Text-to-speech synthesis integration with voice selection, TTS API endpoints (`/api/elevenlabs/config`, `/api/elevenlabs/voices`, `/api/elevenlabs/tts`), available as a voice provider option in Voice Agent Studio and as an `ElevenLabsTTS` workflow step in the Workflow Builder.
- **Webhook Event Log**: Timeline of webhook deliveries.
- **Client Portal**: Public page for end-clients with token-based access to metrics, messages, appointments.
- **Dashboard Analytics**: ROI charts (Recharts) for leads, messages, pipeline, ad performance.
- **Live Demo**: Cinematic 5-scene walkthrough for prospects.
- **Mobile Responsive**: Hamburger menu and responsive layouts.
- **Onboarding Wizard**: 5-step guided setup.
- **TapCard Funnel**: Standalone digital card sales page with Stripe checkout, upsell to full platform.
- **Liquid Website Protocol**: AI landing page builder generating 5 sections based on user input, supporting template variables and URL parameter injection. Form submissions create CRM contacts.
- **Sentinel Geofence Ingest**: MAID-to-CRM bridge accepting geofence data, enriching contacts via People Data Labs, creating CRM contacts, logging incidents, and optionally pushing to LeadConnector V2 API.
- **Draggable UI**: Draggable tutorial overlays and chat widgets with `use-draggable.ts` hook.
- **Sales Chatbot (Aria)**: AI-powered sales assistant on public pages, niche-aware context for 17 industries.
- **Google Places Address Autocomplete**: Reusable `AddressAutocomplete` component (`client/src/components/address-autocomplete.tsx`) wrapping Google Places API, restricted to US addresses. Used in pipeline contact forms, sentinel location filtering/config, property radar lead details/config, and form builder. Google Maps script loaded dynamically via `/api/config/maps-key` with `libraries=places`. Contacts schema includes address/city/state/zip fields.
- **Crash Connect Webhook**: HMAC-SHA256 authenticated webhook for Crash Connect events, handles `crash.detected`, `lead.created`, `lead.enriched` to create CRM contacts, log sentinel incidents, and trigger async automations (SMS alerts, AI-generated follow-ups).
- **External Sentinel Portal**: Standalone, public Sentinel page for external partners with token-based authentication.
- **Multi-Page Site Builder**: Upgraded site builder supporting multiple pages with navigation, presets, and backward compatibility for old `siteData` format.
- **Location-Based Search**: Geocoded records (contacts, leads, crashes, businesses) with `lat`, `lng`, `formattedAddress`, `city`, `state`, `zip`, `geocodeStatus`, `geocodedAt` fields. `GET /api/location-search` supports filtering by type, city, zip, state, address, radius (Haversine), and text query. `POST /api/geocode` returns structured geo data. Auto-geocoding on contact create/update. Map view with color-coded pins (contacts=blue, leads=green, crashes=red, businesses=purple) via Google Maps JS API.

### Access Control & Multi-Tenancy
- **Authentication**: Replit OIDC (admin), native email/password, Google OAuth 2.0, Firebase Auth (Google popup). `isAuthenticated` middleware handles all session types including `firebase` provider.
- **Session Idle Timeout**: 30-minute inactivity timeout. Server middleware tracks `lastActivity` on each session and destroys idle sessions. Client-side `useIdleTimeout` hook monitors mouse/keyboard/scroll/touch activity, shows a 2-minute warning dialog before auto-logout. Login page shows "logged out due to inactivity" message via `?reason=idle` query param. `GET /api/auth/session-info` returns remaining session time.
- **Plan-based Feature Gating**: Features gated by Starter/Pro/Enterprise tiers using `PlanGate` component.
- **Account Ownership Enforcement**: `verifyAccountOwnership()` helper and strict account filtering ensure data isolation. Admin users bypass checks.
- **Active Account Context**: `useActiveSubAccountId()` hook for current sub-account ID.
- **Sidebar Gating**: Nav items show lock icons or are hidden based on plan and admin status.
- **Stripe Trial**: 60-day free trial with upfront card capture.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.

### AI/ML
- **Google Gemini API**: Used for site generation, ad campaigns, bot chat, workflow AI, voice persona generation, chat widgets, and form builders. Features include retry, streaming, image generation, JSON mode, industry-specific tuning, and multi-language support. References pgvector for RAG.

### Communication Services
- **Twilio**: Phone number provisioning, SMS webhook with AI auto-reply.
- **Vapi**: Voice AI agent deployment, outbound calling, browser demo calls (backend proxy for API key security).
- **Mailchimp**: Email campaign sending via Marketing API (audience management, contact batching, campaign creation/sending).

### Firebase
- **Firebase SDK**: `firebase` (client) + `firebase-admin` (server) for Analytics, Push Notifications, and Auth.
- **Firebase Analytics**: Auto-initialized, tracks page views on route changes (`client/src/lib/firebase.ts`, `client/src/hooks/use-firebase.ts`).
- **Firebase Cloud Messaging (FCM)**: Push notification support with service worker (`client/public/firebase-messaging-sw.js`), foreground message toasts, FCM token registration via `POST /api/auth/fcm-token`.
- **Firebase Auth**: Google popup sign-in via Firebase, token verified server-side with `firebase-admin`, creates/links user accounts with `authProvider: "firebase"`. Login button on `/login` page.
- **Config**: projectId=`apex-ma`, Firebase API key from `GOOGLE_API_KEY_FIREBASE` env secret, passed to client via Vite `define` in `vite.config.ts`.

### Automation Engine
- **`fireAutomationTrigger`**: Reusable function to execute step sequences from `liveAutomations` table.
- **Supported Triggers**: `new_lead`, `crash_detected`, `review_received`, `appointment_booked`, `shopify_abandoned_cart`, `shopify_order_created`, `shopify_order_fulfilled`, custom workflow triggers.
- **Step Execution**: `send_sms`, `deploy_geofence_ad`, `start_vapi_call`, `create_contact`, `wait`, Universal Dispatcher actions.
- **Template Variables**: SMS body text supports dynamic substitutions including `{{orderNumber}}`, `{{orderTotal}}`, `{{cartTotal}}`, `{{cartUrl}}`, `{{storeName}}` for Shopify events.
- **Integration Points**: Form submissions, CRM contact creation, funnel lead submission, sentinel geofence ingest, review creation, appointment creation, Crash Connect webhook, Meta DM keyword automations, Shopify webhooks.
- **Shopify Integration**: E-commerce automation via Shopify Admin API. Connects via store domain + Admin API access token. Webhook endpoints receive `checkouts/create`, `checkouts/update`, `orders/create`, `orders/fulfilled` events. HMAC-SHA256 verification with timing-safe comparison on raw body bytes. Syncs Shopify customers into CRM contacts. Schema: `shopify_events` table. Routes: `POST /api/shopify/webhooks/:subAccountId` (public webhook receiver), `GET /api/shopify/events/:subAccountId`, `POST /api/shopify/register-webhooks/:subAccountId`, `GET /api/shopify/status/:subAccountId`.
- **Facebook/Instagram DM Bot**: Meta webhook handles per-account DM routing, auto-creates CRM contacts, matches keyword triggers (`dm_keyword_automations` table with exact/contains match, per-channel filtering), fires automation triggers, AI bot persona replies via Gemini. All Meta Graph API calls include `appsecret_proof` HMAC-SHA256. CRUD API: `GET/POST/PUT/DELETE /api/dm-keywords` with ownership verification.
- **Crash Report Retrieval**: Background worker (`server/crashReportWorker.ts`) polls FLHSMV API for pending crash reports. Supports `POST /api/crash-reports/request` to queue, `GET /api/crash-reports/status/:reportNumber` to check, `GET /api/crash-reports` to list all. Auto-retries up to 3 times, processes 2 concurrent reports every 15s. Schema in `crash_reports` table.
- **Bot Trainer**: Real web scraping with `cheerio`, content chunking, AI persona generation via Gemini, stored content for RAG.
- **Onboarding Wizard**: Fully wired, creating sub-accounts, saving phone numbers, initiating bot training, deploying live workflows via Universal Dispatcher.

### Frontend Libraries
- **shadcn/ui**: Component library.
- **Framer Motion**: Animation library.
- **Recharts**: Charting library.
- **Embla Carousel**: Carousel component.
- **date-fns**: Date formatting utilities.