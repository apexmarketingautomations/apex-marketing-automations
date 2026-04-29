import type { Express } from "express";
import { asyncHandler } from "./helpers";
import * as schema from "@shared/schema";
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { emitUniversalEvent } from "../intelligence/eventEmitter";

const CACHE_HEADERS = { "Cache-Control": "public, max-age=300, s-maxage=300" };

interface RouteEntry { method: string; path: string; auth: boolean; description: string; requiredParams: Record<string, string[]> }
interface RouteGroup { group: string; prefix: string; endpoints: RouteEntry[] }
interface RouteCatalog { description: string; totalEndpoints: number; routeGroups: RouteGroup[] }

let cachedRoutes: RouteCatalog | null = null;
let cachedSchema: ReturnType<typeof introspectSchema> | null = null;

export function registerPublicPlatformRoutes(app: Express) {
  app.get("/api/public/platform", asyncHandler(async (req, res) => {
    if (!cachedRoutes) cachedRoutes = extractRoutes(req.app as Express);
    if (!cachedSchema) cachedSchema = introspectSchema();
    emitUniversalEvent({
      eventType: "platform_manifest_viewed",
      sourceModule: "public-platform",
      metadata: {
        path: "/api/public/platform",
        referrer: req.headers.referer || req.headers.referrer || null,
        userAgent: req.headers["user-agent"] || null,
      },
    });
    res.set(CACHE_HEADERS).json(getPlatformManifest(cachedRoutes, cachedSchema));
  }));

  app.get("/api/public/platform/schema", asyncHandler(async (req, res) => {
    if (!cachedSchema) cachedSchema = introspectSchema();
    emitUniversalEvent({
      eventType: "platform_schema_viewed",
      sourceModule: "public-platform",
      metadata: {
        path: "/api/public/platform/schema",
        userAgent: req.headers["user-agent"] || null,
      },
    });
    res.set(CACHE_HEADERS).json(cachedSchema);
  }));

  app.get("/api/public/platform/routes", asyncHandler(async (req, res) => {
    if (!cachedRoutes) cachedRoutes = extractRoutes(req.app as Express);
    emitUniversalEvent({
      eventType: "platform_routes_viewed",
      sourceModule: "public-platform",
      metadata: {
        path: "/api/public/platform/routes",
        userAgent: req.headers["user-agent"] || null,
      },
    });
    res.set(CACHE_HEADERS).json(cachedRoutes);
  }));
}

function getPlatformManifest(routes: RouteCatalog, schemaData: ReturnType<typeof introspectSchema>) {
  return {
    platform: {
      name: "Apex Marketing Automations",
      version: "1.0.0",
      description: "All-in-one SaaS platform for marketing automation, CRM, AI-powered customer engagement, property wholesaling, incident monitoring, and multi-channel communication. Apex enables businesses to manage sub-accounts, automate workflows, deploy AI voice and chat agents, run Meta ad campaigns, send SMS/email/WhatsApp, and operate white-labeled instances.",
    },
    modules: [
      {
        name: "CRM",
        description: "Contact management, pipeline deals, appointments, and customer data tracking with geocoding support.",
        capabilities: ["contacts", "pipeline_stages", "deals", "appointments", "tags", "notes", "sms_opt_out", "email_opt_out"],
      },
      {
        name: "Messaging",
        description: "Multi-channel messaging hub supporting SMS (Twilio), Meta/Instagram DMs, WhatsApp, and email with retry queues and billing.",
        capabilities: ["sms", "meta_dm", "instagram_dm", "whatsapp", "email", "retry_queue", "message_billing", "dm_keyword_automations"],
      },
      {
        name: "AI Operator",
        description: "Autonomous AI agent that scans accounts, creates tasks, executes tools, builds plans, and learns from outcomes with episodic memory and trust scoring.",
        capabilities: ["agent_tasks", "agent_config", "agent_briefings", "agent_memories", "operator_goals", "operator_plans", "operator_plan_steps", "operator_nudges", "operator_memories", "tool_trust", "goal_progress", "goal_reviews"],
      },
      {
        name: "Voice Agents",
        description: "AI-powered voice calling via Vapi integration with call logging, transcripts, cost tracking, and analysis.",
        capabilities: ["vapi_calls", "call_logs", "transcripts", "recordings", "cost_tracking"],
      },
      {
        name: "Sentinel",
        description: "Real-time incident monitoring system with geofencing, CAD integration, SMS alerts, and dispatch subscriber notifications.",
        capabilities: ["incident_detection", "geofencing", "sms_alerts", "cad_integration", "dispatch_subscribers", "keyword_scanning", "feed_monitoring"],
      },
      {
        name: "Property Wholesaler",
        description: "Property lead generation and wholesaling pipeline with skip tracing, distress signal filtering, and automated outreach.",
        capabilities: ["property_leads", "skip_tracing", "wholesaler_config", "pipeline_management", "auto_sms", "auto_call", "auto_ads"],
      },
      {
        name: "Marketing & Ads",
        description: "Meta ad campaign management, email campaigns, Mailchimp integration, funnel builder, and native ad sponsorships.",
        capabilities: ["meta_ad_campaigns", "meta_leads", "email_campaigns", "funnels", "sponsorships", "mailchimp_sync", "ab_testing"],
      },
      {
        name: "Workflows & Automations",
        description: "Visual workflow builder with trigger-based automations, step metrics, optimization logging, and live automation deployment.",
        capabilities: ["workflow_builder", "trigger_engine", "step_metrics", "optimization_logs", "live_automations"],
      },
      {
        name: "Site Builder",
        description: "AI-assisted website generation with versioning, collaboration, custom domains, and Liquid template support.",
        capabilities: ["site_generation", "versioning", "collaborators", "custom_domains", "liquid_templates"],
      },
      {
        name: "Digital Cards",
        description: "Digital business card creator with public sharing, analytics tracking, lead capture, and SEO optimization.",
        capabilities: ["card_builder", "public_sharing", "analytics_events", "lead_capture", "vcard_download"],
      },
      {
        name: "Reviews",
        description: "Review management with AI-generated responses, Google and Trustpilot integration, and public review collection.",
        capabilities: ["review_collection", "ai_responses", "google_reviews", "trustpilot"],
      },
      {
        name: "Snapshots & Blueprints",
        description: "Account configuration snapshots for marketplace distribution and industry-specific blueprints for quick setup.",
        capabilities: ["snapshot_creation", "marketplace", "forking", "industry_blueprints"],
      },
      {
        name: "Affiliates",
        description: "Affiliate program with referral tracking, commission management, and tiered payout structures.",
        capabilities: ["affiliate_codes", "referral_tracking", "commissions", "tier_management"],
      },
      {
        name: "Webhooks & Events",
        description: "Outbound webhook system with delivery logging, event log, and unified event processing pipeline.",
        capabilities: ["webhook_management", "delivery_logs", "event_log", "retry_processing"],
      },
      {
        name: "Notifications",
        description: "Multi-channel notification system with web push, SMS alerts, quiet hours, and per-category preferences.",
        capabilities: ["push_notifications", "sms_alerts", "notification_preferences", "quiet_hours"],
      },
      {
        name: "Analytics & Observability",
        description: "Execution timeline tracing, usage logging, industry benchmarks, audit logs, and system log aggregation.",
        capabilities: ["timeline_events", "usage_logs", "industry_benchmarks", "audit_logs", "system_logs"],
      },
      {
        name: "Billing & Credits",
        description: "Credit wallet system with top-up, auto-replenishment, transaction history, message billing, and platform profit tracking.",
        capabilities: ["credit_wallets", "credit_transactions", "message_billing", "platform_profit_ledger", "stripe_subscriptions"],
      },
      {
        name: "White Label",
        description: "Full white-labeling support with custom branding, colors, logos, domains, and optional Apex branding removal.",
        capabilities: ["brand_customization", "custom_domains", "logo_upload", "hide_branding"],
      },
      {
        name: "Integrations Hub",
        description: "OAuth-based integration connections with provider asset management and event tracking across external services.",
        capabilities: ["oauth_connections", "provider_assets", "integration_events", "multi_provider"],
      },
    ],
    integrations: [
      { name: "Stripe", type: "payments", description: "Subscription billing, one-time charges, credit wallet top-ups, and webhook-driven payment events." },
      { name: "Twilio", type: "communications", description: "SMS/MMS messaging, WhatsApp, sub-account provisioning, phone number management, and retry queues." },
      { name: "Vapi", type: "voice_ai", description: "AI voice agent deployment, inbound/outbound calling, call transcripts, recordings, and cost analytics." },
      { name: "Meta (Facebook/Instagram)", type: "social", description: "Facebook page messaging, Instagram DMs, Meta ad campaigns, lead form ingestion, and deauthorization compliance." },
      { name: "Shopify", type: "ecommerce", description: "Shopify event ingestion (orders, abandoned carts) with CRM sync and automated follow-ups." },
      { name: "Mailchimp", type: "email_marketing", description: "Contact sync, email campaign management, transactional emails, and engagement tracking." },
      { name: "ElevenLabs", type: "voice_synthesis", description: "AI voice synthesis for voice agent personas and automated voice content generation." },
      { name: "Google Calendar", type: "scheduling", description: "Appointment sync with Google Calendar, event creation, and availability management." },
      { name: "Google Maps / Geocoding", type: "location", description: "Address geocoding for contacts, properties, incidents, and geofence calculations." },
      { name: "OpenAI", type: "ai", description: "LLM-powered chat, persona generation, content creation, review responses, and operator reasoning." },
      { name: "BatchData", type: "data", description: "Skip tracing provider for property owner lookup with phone, email, and mailing address resolution." },
    ],
    authentication: {
      model: "Replit OAuth + Session-based",
      description: "Users authenticate via Replit OAuth (Login with Replit). Sessions are managed server-side. Certain paths are open (public) and bypass authentication entirely.",
      publicPathPrefixes: [
        "/api/auth/",
        "/api/login",
        "/api/logout",
        "/api/callback",
        "/api/stripe/webhook",
        "/api/webhooks/",
        "/api/snapshots/marketplace",
        "/api/v1/serve-native-ad",
        "/api/v1/ad-click/",
        "/api/crash-reports/health",
        "/api/public/platform",
        "/api/public-card/",
        "/api/public/form/",
        "/api/portal/",
        "/api/v1/external/sentinel",
      ],
      publicExactPaths: [
        "/api/reviews (POST)",
        "/api/alert-owner (POST)",
        "/api/languages (GET/POST)",
        "/api/log-error",
        "/api/sms-webhook",
        "/api/twilio/inbound-sms",
        "/api/meta-webhook",
        "/api/sentinel/test-trigger",
        "/api/sentinel/live",
        "/api/sentinel/incoming-crash",
        "/api/sentinel/cad-ingest",
        "/api/sentinel-incoming",
        "/api/v1/sentinel-receiver",
        "/api/v1/sentinel-ingest",
        "/api/v1/dispatch",
        "/api/webhook/crashconnect",
        "/api/form-submit",
        "/api/card-checkout",
        "/api/sales-chat",
        "/api/generate-liquid-site",
        "/api/liquid/contact-lookup",
        "/api/system/health",
        "/api/data-deletion",
        "/api/auth/facebook/deauthorize",
      ],
    },
    subscriptionTiers: {
      starter: {
        name: "Starter",
        features: ["inbox", "contacts", "deals", "appointments", "reviews", "site_builder"],
        limits: { messages_per_month: 500, automations: 5, contacts: 1000, ai_requests: 100, voice_minutes: 30, integrations: 3 },
      },
      pro: {
        name: "Pro",
        features: ["inbox", "contacts", "deals", "appointments", "reviews", "site_builder", "workflows", "ai_bots", "sentinel", "voice_agents", "email_campaigns", "digital_card"],
        limits: { messages_per_month: 5000, automations: 50, contacts: 10000, ai_requests: 1000, voice_minutes: 300, integrations: 10 },
      },
      enterprise: {
        name: "Enterprise",
        features: ["inbox", "contacts", "deals", "appointments", "reviews", "site_builder", "workflows", "ai_bots", "sentinel", "voice_agents", "email_campaigns", "white_label", "webhooks", "multi_location", "priority_support", "digital_card"],
        limits: { messages_per_month: 50000, automations: 500, contacts: 100000, ai_requests: 10000, voice_minutes: 3000, integrations: 50 },
      },
    },
    eventSystem: {
      description: "Apex uses a unified event log for processing inbound events from webhooks, integrations, and internal triggers. Events follow a trace-based model for observability.",
      eventStatuses: ["pending", "processing", "completed", "failed", "dead_letter"],
      webhookEntryPoints: [
        "/api/stripe/webhook",
        "/api/webhooks/vapi",
        "/api/sms-webhook",
        "/api/twilio/inbound-sms",
        "/api/meta-webhook",
        "/api/sentinel/incoming-crash",
        "/api/sentinel/cad-ingest",
        "/api/v1/sentinel-receiver",
        "/api/v1/sentinel-ingest",
        "/api/v1/dispatch",
        "/api/webhook/crashconnect",
      ],
      outboundWebhooks: "User-configured webhooks with event filtering, secret signing, delivery logging, and automatic retry on failure.",
    },
    apiSurface: {
      totalEndpoints: routes.totalEndpoints,
      totalGroups: routes.routeGroups.length,
      groups: routes.routeGroups.map(g => ({ name: g.group, prefix: g.prefix, endpointCount: g.endpoints.length })),
    },
    dataModel: {
      totalTables: schemaData.tables.length,
      totalRelationships: schemaData.totalRelationships,
      tables: schemaData.tables.map(t => ({
        name: t.tableName,
        columnCount: t.columns.length,
        foreignKeys: t.foreignKeys.length > 0 ? t.foreignKeys : undefined,
      })),
    },
  };
}

function getTableName(tableObj: object): string {
  try {
    const sym = Object.getOwnPropertySymbols(tableObj).find(s => s.toString().includes("drizzle:Name"));
    if (sym) return String((tableObj as Record<symbol, string>)[sym]);
  } catch (err) { console.warn("[PUBLIC-PLATFORM] caught:", err instanceof Error ? err.message : err); /* fallback */; }
  return "unknown";
}

interface FKRef { column: string; foreignTable: string; foreignColumn: string }

function extractForeignKeys(tableObj: object): FKRef[] {
  const fks: FKRef[] = [];
  try {
    const fkSym = Object.getOwnPropertySymbols(tableObj).find(s => s.toString().includes("InlineForeignKeys"));
    if (!fkSym) return fks;
    const fkList = (tableObj as Record<symbol, Array<{ reference: () => { columns: Array<{ name: string }>; foreignTable: object; foreignColumns: Array<{ name: string }> } }>>)[fkSym];
    if (!Array.isArray(fkList)) return fks;
    for (const fk of fkList) {
      if (typeof fk.reference !== "function") continue;
      const ref = fk.reference();
      const col = ref.columns?.[0]?.name;
      const foreignCol = ref.foreignColumns?.[0]?.name;
      const foreignTable = ref.foreignTable ? getTableName(ref.foreignTable) : "unknown";
      if (col && foreignTable) {
        fks.push({ column: col, foreignTable, foreignColumn: foreignCol || "id" });
      }
    }
  } catch (err) { console.warn("[PUBLIC-PLATFORM] caught:", err instanceof Error ? err.message : err); /* skip FK extraction errors */; }
  return fks;
}

function introspectSchema() {
  const tables: Array<{
    tableName: string;
    exportName: string;
    columns: Array<{ name: string; type: string; nullable: boolean; primaryKey: boolean; hasDefault: boolean }>;
    foreignKeys: FKRef[];
  }> = [];

  for (const [exportName, value] of Object.entries(schema)) {
    if (typeof value !== "object" || value === null) continue;
    if (typeof value === "function") continue;
    try {
      const cols = getTableColumns(value as PgTable);
      const colEntries = Object.entries(cols);
      if (colEntries.length === 0) continue;
      const tableName = getTableName(value);
      const columnList = colEntries.map(([colName, col]) => {
        const c = col as Record<string, unknown>;
        return {
          name: colName,
          type: String(c.dataType || c.columnType || "unknown"),
          nullable: c.notNull !== true,
          primaryKey: c.primary === true,
          hasDefault: c.hasDefault === true,
        };
      });
      const foreignKeys = extractForeignKeys(value);
      tables.push({ tableName, exportName, columns: columnList, foreignKeys });
    } catch (err) {
      console.warn("[PUBLIC-PLATFORM] caught:", err instanceof Error ? err.message : err);
      /* not a table - skip */
    }
  }

  tables.sort((a, b) => a.tableName.localeCompare(b.tableName));

  return {
    description: "Complete data model dynamically introspected from Drizzle ORM schema definitions in shared/schema.ts. Includes foreign key relationships.",
    totalTables: tables.length,
    totalRelationships: tables.reduce((sum, t) => sum + t.foreignKeys.length, 0),
    tables,
  };
}

function generateDescription(method: string, path: string): string {
  const clean = path.replace("/api/", "").replace(/\/:/g, " by ").replace(/\//g, " ").replace(/-/g, " ");
  const parts = clean.split(" ").filter(Boolean);
  const resource = parts.filter(p => p !== "by" && !p.startsWith(":")).join(" ");
  switch (method) {
    case "GET": return `Retrieve ${resource}`;
    case "POST": return `Create or execute ${resource}`;
    case "PUT": return `Replace ${resource}`;
    case "PATCH": return `Update ${resource}`;
    case "DELETE": return `Delete ${resource}`;
    case "OPTIONS": return `CORS preflight for ${resource}`;
    default: return `${method} ${resource}`;
  }
}

function extractRoutes(app: Express): RouteCatalog {
  const openPrefixes = ["/api/auth/", "/api/login", "/api/logout", "/api/callback", "/api/stripe/webhook", "/api/webhooks/", "/api/snapshots/marketplace", "/api/v1/serve-native-ad", "/api/v1/ad-click/", "/api/crash-reports/health", "/api/public-card/", "/api/public/form/", "/api/public/admin/set-webhook-token", "/api/portal/", "/api/v1/external/sentinel"];
  const openExact = ["/api/reviews", "/api/alert-owner", "/api/languages", "/api/log-error", "/api/sms-webhook", "/api/twilio/inbound-sms", "/api/meta-webhook", "/api/sentinel/test-trigger", "/api/sentinel/live", "/api/sentinel/incoming-crash", "/api/sentinel/cad-ingest", "/api/sentinel-incoming", "/api/v1/sentinel-receiver", "/api/v1/sentinel-ingest", "/api/v1/dispatch", "/api/webhook/crashconnect", "/api/form-submit", "/api/card-checkout", "/api/sales-chat", "/api/generate-liquid-site", "/api/liquid/contact-lookup", "/api/system/health", "/api/data-deletion", "/api/auth/facebook/deauthorize"];

  function isPublic(path: string): boolean {
    if (openPrefixes.some(p => path.startsWith(p))) return true;
    if (openExact.includes(path)) return true;
    return false;
  }

  interface ExpressLayer { route?: { path: string; methods: Record<string, boolean> }; handle?: { stack?: ExpressLayer[] } }
  interface ExpressRouter { stack?: ExpressLayer[] }

  const routes: Array<{ method: string; path: string; auth: boolean }> = [];

  function walkStack(stack: ExpressLayer[]) {
    for (const layer of stack) {
      if (layer.route) {
        const routePath = layer.route.path;
        if (typeof routePath !== "string" || !routePath.startsWith("/api")) continue;
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled) {
            routes.push({ method: method.toUpperCase(), path: routePath, auth: !isPublic(routePath) });
          }
        }
      } else if (layer.handle && layer.handle.stack) {
        walkStack(layer.handle.stack);
      }
    }
  }

  const appWithRouter = app as Express & { router?: ExpressRouter };
  const router = appWithRouter.router;
  if (router && router.stack) {
    walkStack(router.stack);
  }

  routes.sort((a, b) => a.path.localeCompare(b.path));

  const groupMap = new Map<string, { prefix: string; routes: typeof routes }>();

  const GROUP_RULES: Array<{ name: string; prefix: string; test: (p: string) => boolean }> = [
    { name: "Auth & Config", prefix: "/api/auth, /api/config, /api/data-deletion", test: p => p.startsWith("/api/auth") || p.startsWith("/api/config/") || p === "/api/data-deletion" || p.startsWith("/api/login") || p.startsWith("/api/logout") || p.startsWith("/api/callback") },
    { name: "Accounts", prefix: "/api/accounts", test: p => p.startsWith("/api/accounts") && !p.includes("/dm-config") },
    { name: "Account DM Config", prefix: "/api/accounts/:id/dm-config", test: p => p.includes("/dm-config") },
    { name: "Plan Tiers", prefix: "/api/plan-tiers", test: p => p === "/api/plan-tiers" },
    { name: "Languages", prefix: "/api/languages", test: p => p === "/api/languages" },
    { name: "Messaging", prefix: "/api/messages, /api/conversations", test: p => p.startsWith("/api/messages") || p.startsWith("/api/conversations") },
    { name: "WhatsApp", prefix: "/api/whatsapp-templates, /api/whatsapp-status", test: p => p.startsWith("/api/whatsapp") },
    { name: "AI Bot / Chat", prefix: "/api/bot, /api/bots, /api/chat, /api/sales-chat", test: p => p.startsWith("/api/bot") || p.startsWith("/api/chat") || p === "/api/sales-chat" },
    { name: "AI Agent (Operator)", prefix: "/api/bot/chat/agent-*", test: p => p.includes("/agent-") && p.startsWith("/api/bot/chat") },
    { name: "Workflows", prefix: "/api/workflows", test: p => p.startsWith("/api/workflows") },
    { name: "Voice Agents", prefix: "/api/voice-agents, /api/vapi, /api/elevenlabs", test: p => p.startsWith("/api/voice-agents") || p.startsWith("/api/vapi") || p.startsWith("/api/elevenlabs") },
    { name: "Sentinel", prefix: "/api/sentinel", test: p => p.startsWith("/api/sentinel") },
    { name: "Property & Skip Trace", prefix: "/api/property-radar, /api/skip-trace", test: p => p.startsWith("/api/property-radar") || p.startsWith("/api/skip-trace") },
    { name: "Crash Reports", prefix: "/api/crash-reports", test: p => p.startsWith("/api/crash-reports") },
    { name: "Meta & Instagram", prefix: "/api/meta", test: p => p.startsWith("/api/meta") || p.startsWith("/api/instagram") },
    { name: "Reviews", prefix: "/api/reviews, /api/review-config", test: p => p.startsWith("/api/review") || p === "/api/alert-owner" },
    { name: "Usage & Billing", prefix: "/api/usage, /api/wallet", test: p => p.startsWith("/api/usage") || p.startsWith("/api/wallet") },
    { name: "Sponsorships & Ads", prefix: "/api/sponsorships, /api/v1/serve-native-ad, /api/v1/ad-click", test: p => p.startsWith("/api/sponsorships") || p.startsWith("/api/v1/serve-native-ad") || p.startsWith("/api/v1/ad-click") },
    { name: "Sites", prefix: "/api/sites, /api/generate-liquid-site, /api/generate-site, /api/liquid", test: p => p.startsWith("/api/sites") || p.startsWith("/api/generate-liquid-site") || p === "/api/generate-site" || p.startsWith("/api/liquid") },
    { name: "Digital Cards", prefix: "/api/digital-cards, /api/digital-card, /api/public-card, /api/card-checkout", test: p => p.startsWith("/api/digital-card") || p.startsWith("/api/public-card") || p === "/api/card-checkout" },
    { name: "Domains", prefix: "/api/domains", test: p => p.startsWith("/api/domains") },
    { name: "Subscriptions & Stripe", prefix: "/api/subscriptions, /api/stripe", test: p => p.startsWith("/api/subscriptions") || p.startsWith("/api/stripe") },
    { name: "Webhooks", prefix: "/api/webhooks", test: p => p.startsWith("/api/webhooks") && !p.startsWith("/api/webhooks/vapi") },
    { name: "Vapi Webhook", prefix: "/api/webhooks/vapi", test: p => p === "/api/webhooks/vapi" },
    { name: "Snapshots", prefix: "/api/snapshots", test: p => p.startsWith("/api/snapshots") },
    { name: "Affiliates", prefix: "/api/affiliates, /api/affiliate", test: p => p.startsWith("/api/affiliate") },
    { name: "Blueprints", prefix: "/api/blueprints", test: p => p.startsWith("/api/blueprints") },
    { name: "Integrations", prefix: "/api/integrations, /api/oauth", test: p => p.startsWith("/api/integrations") || p.startsWith("/api/oauth") },
    { name: "Notifications", prefix: "/api/notifications", test: p => p.startsWith("/api/notifications") },
    { name: "Dashboard", prefix: "/api/dashboard", test: p => p.startsWith("/api/dashboard") },
    { name: "Analytics", prefix: "/api/analytics", test: p => p.startsWith("/api/analytics") },
    { name: "A/B Testing", prefix: "/api/ab-experiments", test: p => p.startsWith("/api/ab-experiments") },
    { name: "Timeline", prefix: "/api/timeline", test: p => p.startsWith("/api/timeline") },
    { name: "Event Log", prefix: "/api/event-log", test: p => p.startsWith("/api/event-log") },
    { name: "Mailchimp", prefix: "/api/mailchimp", test: p => p.startsWith("/api/mailchimp") },
    { name: "Funnels", prefix: "/api/funnel, /api/form-submit, /api/public/form", test: p => p.startsWith("/api/funnel") || p === "/api/form-submit" || p.startsWith("/api/public/form/") },
    { name: "Admin", prefix: "/api/admin", test: p => p.startsWith("/api/admin") },
    { name: "V1 Compiler & Tools", prefix: "/api/v1/compiler, /api/v1/tools, /api/v1/orchestrate", test: p => p.startsWith("/api/v1/compiler") || p.startsWith("/api/v1/tools") || p.startsWith("/api/v1/orchestrate") },
    { name: "V1 Sentinel & Dispatch", prefix: "/api/v1/sentinel, /api/v1/dispatch", test: p => p.startsWith("/api/v1/sentinel") || p === "/api/v1/dispatch" },
    { name: "V1 External", prefix: "/api/v1", test: p => p.startsWith("/api/v1/") },
    { name: "AI Operator", prefix: "/api/operator", test: p => p.startsWith("/api/operator") },
    { name: "AI Agent", prefix: "/api/agent", test: p => p.startsWith("/api/agent") },
    { name: "CRM - Contacts", prefix: "/api/contacts", test: p => p.startsWith("/api/contacts") },
    { name: "CRM - Deals", prefix: "/api/deals", test: p => p.startsWith("/api/deals") },
    { name: "CRM - Pipeline", prefix: "/api/pipeline", test: p => p.startsWith("/api/pipeline") },
    { name: "CRM - Appointments", prefix: "/api/appointments, /api/calendar", test: p => p.startsWith("/api/appointments") || p.startsWith("/api/calendar") },
    { name: "Email Campaigns", prefix: "/api/email-campaigns", test: p => p.startsWith("/api/email-campaigns") },
    { name: "Client Websites", prefix: "/api/client-websites, /api/versions", test: p => p.startsWith("/api/client-websites") || p.startsWith("/api/versions") },
    { name: "Shopify", prefix: "/api/shopify", test: p => p.startsWith("/api/shopify") },
    { name: "Phone Numbers", prefix: "/api/phone-numbers", test: p => p.startsWith("/api/phone-numbers") },
    { name: "DM Keywords", prefix: "/api/dm-keywords", test: p => p.startsWith("/api/dm-keywords") },
    { name: "Events", prefix: "/api/events", test: p => p.startsWith("/api/events") },
    { name: "Forms", prefix: "/api/forms", test: p => p.startsWith("/api/forms") },
    { name: "Billing", prefix: "/api/billing, /api/subscription", test: p => p.startsWith("/api/billing") || p.startsWith("/api/subscription") },
    { name: "Benchmarks", prefix: "/api/benchmarks", test: p => p.startsWith("/api/benchmarks") },
    { name: "White Label", prefix: "/api/white-label", test: p => p.startsWith("/api/white-label") },
    { name: "Push Notifications", prefix: "/api/push-subscriptions, /api/push-config, /api/notification-preferences", test: p => p.startsWith("/api/push-") || p.startsWith("/api/notification-preferences") },
    { name: "God Mode (Admin)", prefix: "/api/god-mode, /api/command-center", test: p => p.startsWith("/api/god-mode") || p.startsWith("/api/command-center") },
    { name: "Geocoding", prefix: "/api/geocode, /api/location-search", test: p => p.startsWith("/api/geocode") || p === "/api/location-search" },
    { name: "Collaborators", prefix: "/api/collaborators", test: p => p.startsWith("/api/collaborators") },
    { name: "Onboarding", prefix: "/api/onboarding", test: p => p.startsWith("/api/onboarding") },
    { name: "Reports", prefix: "/api/reports", test: p => p.startsWith("/api/reports") },
    { name: "Jobs", prefix: "/api/jobs", test: p => p.startsWith("/api/jobs") },
    { name: "Ad Generation", prefix: "/api/generate-ad-campaign", test: p => p === "/api/generate-ad-campaign" },
    { name: "Tracking & SEO", prefix: "/api/tracking-config, /api/check-slug, /api/validate-email, /api/service-status", test: p => p === "/api/tracking-config" || p.startsWith("/api/check-slug") || p === "/api/validate-email" || p === "/api/service-status" },
    { name: "Webhook Events", prefix: "/api/webhook-events, /api/webhook", test: p => p.startsWith("/api/webhook-events") || (p.startsWith("/api/webhook") && !p.startsWith("/api/webhooks")) },
    { name: "Widget", prefix: "/api/widget.js", test: p => p.startsWith("/api/widget") },
    { name: "System", prefix: "/api/system, /api/log-error", test: p => p.startsWith("/api/system") || p === "/api/log-error" },
    { name: "Client Portal", prefix: "/api/portal", test: p => p.startsWith("/api/portal") },
    { name: "Public Platform Discovery", prefix: "/api/public/platform", test: p => p.startsWith("/api/public/platform") },
    { name: "File Upload", prefix: "/api/upload-ad-image", test: p => p === "/api/upload-ad-image" },
    { name: "Download", prefix: "/api/download-project", test: p => p === "/api/download-project" },
    { name: "Webhook (CrashConnect)", prefix: "/api/webhook/crashconnect", test: p => p.startsWith("/api/webhook/crashconnect") },
    { name: "Twilio SMS", prefix: "/api/sms-webhook, /api/twilio", test: p => p === "/api/sms-webhook" || p.startsWith("/api/twilio") },
  ];

  for (const route of routes) {
    let assigned = false;
    for (const rule of GROUP_RULES) {
      if (rule.test(route.path)) {
        if (!groupMap.has(rule.name)) {
          groupMap.set(rule.name, { prefix: rule.prefix, routes: [] });
        }
        groupMap.get(rule.name)!.routes.push(route);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      if (!groupMap.has("Other")) {
        groupMap.set("Other", { prefix: "", routes: [] });
      }
      groupMap.get("Other")!.routes.push(route);
    }
  }

  const routeGroups = Array.from(groupMap.entries()).map(([group, data]) => ({
    group,
    prefix: data.prefix,
    endpoints: data.routes.map(r => {
      const pathParams = (r.path.match(/:([a-zA-Z]+)/g) || []).map(p => p.slice(1));
      const requiredParams: Record<string, string[]> = {};
      if (pathParams.length > 0) requiredParams.path = pathParams;
      return { method: r.method, path: r.path, description: generateDescription(r.method, r.path), auth: r.auth, requiredParams };
    }),
  }));

  return {
    description: "Complete API route catalog dynamically extracted from the running Express application. All routes are prefixed with /api. Authenticated routes require a valid session via Replit OAuth. Note: requiredParams currently reflects path parameters only; query/body requirements are endpoint-specific.",
    totalEndpoints: routes.length,
    routeGroups,
  };
}

