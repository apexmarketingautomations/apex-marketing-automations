import { pgTable, text, serial, integer, json, jsonb, timestamp, boolean, real, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";

export const PLAN_TIERS = {
  starter: {
    name: 'Starter',
    features: ['inbox', 'contacts', 'deals', 'appointments', 'reviews', 'site_builder'],
  },
  pro: {
    name: 'Pro',
    features: ['inbox', 'contacts', 'deals', 'appointments', 'reviews', 'site_builder', 'workflows', 'ai_bots', 'sentinel', 'voice_agents', 'email_campaigns', 'digital_card'],
  },
  enterprise: {
    name: 'Enterprise',
    features: ['inbox', 'contacts', 'deals', 'appointments', 'reviews', 'site_builder', 'workflows', 'ai_bots', 'sentinel', 'voice_agents', 'email_campaigns', 'white_label', 'webhooks', 'multi_location', 'priority_support', 'digital_card'],
  },
  god_mode: {
    name: 'God Mode',
    features: ['inbox', 'contacts', 'deals', 'appointments', 'reviews', 'site_builder', 'workflows', 'ai_bots', 'sentinel', 'voice_agents', 'email_campaigns', 'white_label', 'webhooks', 'multi_location', 'priority_support', 'digital_card', 'api_access', 'custom_integrations', 'advanced_analytics'],
  },
} as const;

export type PlanTier = keyof typeof PLAN_TIERS;

export function hasFeature(plan: string, feature: string): boolean {
  const tier = PLAN_TIERS[plan as PlanTier];
  if (!tier) return false;
  return (tier.features as readonly string[]).includes(feature);
}

export const subAccounts = pgTable("sub_accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  twilioNumber: text("twilio_number").notNull(),
  googleReviewLink: text("google_review_link"),
  trustpilotLink: text("trustpilot_link"),
  ownerPhone: text("owner_phone"),
  industry: text("industry"),
  config: json("config"),
  vibeTheme: text("vibe_theme").default("cyber-glass"),
  ownerUserId: text("owner_user_id"),
  parentSnapshotId: integer("parent_snapshot_id"),
  isFork: boolean("is_fork").default(false),
  language: text("language").default("en"),
  aiPromptConfig: json("ai_prompt_config"),
  plan: text("plan").default("starter").notNull(),
  planFeatures: text("plan_features").array(),
  webhookToken: text("webhook_token"),
  address: text("address"),
  formattedAddress: text("formatted_address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  lat: real("lat"),
  lng: real("lng"),
  geocodeStatus: text("geocode_status"),
  geocodedAt: timestamp("geocoded_at"),
  metaPageId: text("meta_page_id"),
  metaInstagramAccountId: text("meta_instagram_account_id"),
  metaAccessToken: text("meta_access_token"),
  metaAppSecret: text("meta_app_secret"),
  twilioSubaccountSid: text("twilio_subaccount_sid"),
  twilioSubaccountAuthToken: text("twilio_subaccount_auth_token"),
  twilioStatus: text("twilio_status").default("legacy"),
  isInternal: boolean("is_internal").default(false),
  billingExempt: boolean("billing_exempt").default(false),
  isDeletable: boolean("is_deletable").default(true),
  role: text("role"),
  parentAccountId: integer("parent_account_id"),
  operatorConfig: json("operator_config"),
  telegramBotToken: text("telegram_bot_token"),
  telegramBotUsername: text("telegram_bot_username"),
  isProtected: boolean("is_protected").default(false),
  protectedReason: text("protected_reason"),
  cbUsername: text("cb_username"),
  cbGoalTokens: integer("cb_goal_tokens").default(500),
  cbProMode: boolean("cb_pro_mode").default(false),
  cbPersonaPrompt: text("cb_persona_prompt"),
  cbWebhookToken: text("cb_webhook_token"),
});

export const insertSubAccountSchema = createInsertSchema(subAccounts).omit({ id: true });
export type InsertSubAccount = z.infer<typeof insertSubAccountSchema>;
export type SubAccount = typeof subAccounts.$inferSelect;

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  direction: text("direction").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  contactPhone: text("contact_phone").notNull(),
  channel: text("channel").notNull(),
  messageSid: text("message_sid"),
  threadId: text("thread_id"),
  traceId: text("trace_id"),
  pageId: text("page_id"),
  senderId: text("sender_id"),
});

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

export const smsRetryQueue = pgTable("sms_retry_queue", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  contactPhone: text("contact_phone").notNull(),
  fromNumber: text("from_number").notNull(),
  traceId: text("trace_id").notNull(),
  threadId: text("thread_id"),
  originalMessageSid: text("original_message_sid"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").default(0).notNull(),
  status: text("status").default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  nextRetryAt: timestamp("next_retry_at"),
});

export const insertSmsRetryQueueSchema = createInsertSchema(smsRetryQueue).omit({ id: true, createdAt: true });
export type InsertSmsRetryQueue = z.infer<typeof insertSmsRetryQueueSchema>;
export type SmsRetryQueue = typeof smsRetryQueue.$inferSelect;

export const workflows = pgTable("workflows", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  trigger: text("trigger").notNull(),
  steps: json("steps").notNull(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id),
});

export const insertWorkflowSchema = createInsertSchema(workflows).omit({ id: true });
export type InsertWorkflow = z.infer<typeof insertWorkflowSchema>;
export type Workflow = typeof workflows.$inferSelect;

export const trainingJobs = pgTable("training_jobs", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  persona: text("persona").notNull(),
  state: text("state").notNull().default("pending"),
  progress: integer("progress").notNull().default(0),
  logs: json("logs").notNull().default([]),
  scrapedContent: text("scraped_content"),
  generatedPersona: text("generated_persona"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTrainingJobSchema = createInsertSchema(trainingJobs).omit({ id: true, createdAt: true });
export type InsertTrainingJob = z.infer<typeof insertTrainingJobSchema>;
export type TrainingJob = typeof trainingJobs.$inferSelect;

export const blueprints = pgTable("blueprints", {
  id: serial("id").primaryKey(),
  industryId: text("industry_id").notNull().unique(),
  title: text("title").notNull(),
  stages: json("stages").notNull(),
  fields: json("fields").notNull(),
  templates: json("templates").notNull(),
});

export const insertBlueprintSchema = createInsertSchema(blueprints).omit({ id: true });
export type InsertBlueprint = z.infer<typeof insertBlueprintSchema>;
export type Blueprint = typeof blueprints.$inferSelect;

export const savedSites = pgTable("saved_sites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  siteData: json("site_data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  customDomain: text("custom_domain"),
  publishedUrl: text("published_url"),
});

export const insertSavedSiteSchema = createInsertSchema(savedSites).omit({ id: true, createdAt: true });
export type InsertSavedSite = z.infer<typeof insertSavedSiteSchema>;
export type SavedSite = typeof savedSites.$inferSelect;

export const siteVersions = pgTable("site_versions", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => savedSites.id).notNull(),
  versionNumber: integer("version_number").notNull(),
  label: text("label").notNull(),
  siteData: json("site_data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSiteVersionSchema = createInsertSchema(siteVersions).omit({ id: true, createdAt: true });
export type InsertSiteVersion = z.infer<typeof insertSiteVersionSchema>;
export type SiteVersion = typeof siteVersions.$inferSelect;

export const siteCollaborators = pgTable("site_collaborators", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => savedSites.id).notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("editor"),
  inviteCode: text("invite_code").notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export const insertSiteCollaboratorSchema = createInsertSchema(siteCollaborators).omit({ id: true, joinedAt: true });
export type InsertSiteCollaborator = z.infer<typeof insertSiteCollaboratorSchema>;
export type SiteCollaborator = typeof siteCollaborators.$inferSelect;

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  isPublic: boolean("is_public").default(false),
  aiResponse: text("ai_response"),
  googleReviewLink: text("google_review_link"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertReviewSchema = createInsertSchema(reviews).omit({ id: true, createdAt: true });
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviews.$inferSelect;

export const usageLogs = pgTable("usage_logs", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  type: text("type").notNull(),
  amount: real("amount").notNull(),
  cost: real("cost").notNull(),
  description: text("description"),
  tokenCount: integer("token_count"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUsageLogSchema = createInsertSchema(usageLogs).omit({ id: true, createdAt: true });
export type InsertUsageLog = z.infer<typeof insertUsageLogSchema>;
export type UsageLog = typeof usageLogs.$inferSelect;

export const domains = pgTable("domains", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  domainName: text("domain_name").notNull().unique(),
  status: text("status").notNull().default("pending"),
  purchasePrice: real("purchase_price").notNull(),
  salePrice: real("sale_price").notNull(),
  dnsConfigured: boolean("dns_configured").default(false),
  sslActive: boolean("ssl_active").default(false),
  registrar: text("registrar"),
  siteId: integer("site_id").references(() => savedSites.id),
  verificationToken: text("verification_token"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDomainSchema = createInsertSchema(domains).omit({ id: true, createdAt: true });
export type InsertDomain = z.infer<typeof insertDomainSchema>;
export type Domain = typeof domains.$inferSelect;

export const owners = pgTable("owners", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertOwnerSchema = createInsertSchema(owners).omit({ id: true, createdAt: true });
export type InsertOwner = z.infer<typeof insertOwnerSchema>;
export type Owner = typeof owners.$inferSelect;

export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  planTier: text("plan_tier").notNull().default("free"),
  status: text("status").notNull().default("inactive"),
  currentPeriodEnd: timestamp("current_period_end"),
  trialEnd: timestamp("trial_end"),
  aiCredits: real("ai_credits").default(0),
  isGrandfathered: boolean("is_grandfathered").default(false),
  billingInterval: text("billing_interval").default("monthly"),
  blitzJoinedDate: timestamp("blitz_joined_date"),
  paymentStatus: text("payment_status").default("ok"),
  paymentFailedAt: timestamp("payment_failed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptions.$inferSelect;

export const snapshots = pgTable("snapshots", {
  id: serial("id").primaryKey(),
  creatorId: text("creator_id").notNull(),
  creatorName: text("creator_name"),
  name: text("name").notNull(),
  description: text("description"),
  price: real("price").default(0),
  industry: text("industry"),
  config: json("config").notNull(),
  isPublic: boolean("is_public").default(false),
  downloads: integer("downloads").default(0),
  forkCount: integer("fork_count").default(0),
  rating: real("rating").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSnapshotSchema = createInsertSchema(snapshots).omit({ id: true, createdAt: true });
export type InsertSnapshot = z.infer<typeof insertSnapshotSchema>;
export type Snapshot = typeof snapshots.$inferSelect;

export const snapshotVersions = pgTable("snapshot_versions", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  versionName: text("version_name").notNull(),
  config: json("config").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSnapshotVersionSchema = createInsertSchema(snapshotVersions).omit({ id: true, createdAt: true });
export type InsertSnapshotVersion = z.infer<typeof insertSnapshotVersionSchema>;
export type SnapshotVersion = typeof snapshotVersions.$inferSelect;

export const affiliates = pgTable("affiliates", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  affiliateCode: text("affiliate_code").notNull().unique(),
  commissionRate: real("commission_rate").default(0.40),
  totalEarned: real("total_earned").default(0),
  pendingPayout: real("pending_payout").default(0),
  tier: text("tier").default("standard"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAffiliateSchema = createInsertSchema(affiliates).omit({ id: true, createdAt: true });
export type InsertAffiliate = z.infer<typeof insertAffiliateSchema>;
export type Affiliate = typeof affiliates.$inferSelect;

export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  affiliateId: integer("affiliate_id").references(() => affiliates.id).notNull(),
  referredUserId: text("referred_user_id").notNull(),
  referredEmail: text("referred_email"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertReferralSchema = createInsertSchema(referrals).omit({ id: true, createdAt: true });
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Referral = typeof referrals.$inferSelect;

export const commissions = pgTable("commissions", {
  id: serial("id").primaryKey(),
  affiliateId: integer("affiliate_id").references(() => affiliates.id).notNull(),
  referralId: integer("referral_id").references(() => referrals.id).notNull(),
  amount: real("amount").notNull(),
  status: text("status").notNull().default("pending"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCommissionSchema = createInsertSchema(commissions).omit({ id: true, createdAt: true });
export type InsertCommission = z.infer<typeof insertCommissionSchema>;
export type Commission = typeof commissions.$inferSelect;

export const sentinelConfig = pgTable("sentinel_config", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  feedUrl: text("feed_url"),
  keywords: text("keywords").array().default([]),
  scanInterval: integer("scan_interval").default(60),
  enabled: boolean("enabled").default(false),
  smsAlertEnabled: boolean("sms_alert_enabled").default(true),
  geofenceEnabled: boolean("geofence_enabled").default(true),
  geofenceRadiusMiles: real("geofence_radius_miles").default(1),
  smsAlertPhone: text("sms_alert_phone"),
  targetCities: text("target_cities").array().default([]),
  targetStates: text("target_states").array().default([]),
  niche: text("niche").notNull().default("accident"),
  homeSvcConfig: jsonb("home_svc_config"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSentinelConfigSchema = createInsertSchema(sentinelConfig).omit({ id: true, updatedAt: true });
export type InsertSentinelConfig = z.infer<typeof insertSentinelConfigSchema>;
export type SentinelConfig = typeof sentinelConfig.$inferSelect;

export interface SentinelHomeSvcTerritory {
  name: string;
  stateCodes: string[];
  counties?: string[];
  cities?: string[];
}

export interface SentinelDeliveryRule {
  id: string;
  name: string;
  serviceTypes?: string[];
  minScore?: number;
  territory?: string;
  signalTypes?: string[];
  action: 'auto_queue';
}

export interface SentinelHomeSvcConfig {
  territories?: SentinelHomeSvcTerritory[];
  deliveryRules?: SentinelDeliveryRule[];
}

export const sentinelIncidents = pgTable("sentinel_incidents", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  sourceHash: text("source_hash"),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  severity: text("severity").notNull().default("medium"),
  rawPayload: json("raw_payload"),
  actionStatus: text("action_status").default("pending"),
  smsSent: boolean("sms_sent").default(false),
  geofenceDeployed: boolean("geofence_deployed").default(false),
  formattedAddress: text("formatted_address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  lat: real("lat"),
  lng: real("lng"),
  geocodeStatus: text("geocode_status"),
  geocodedAt: timestamp("geocoded_at"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  dispatchedAs: text("dispatched_as"),
  callNotes: text("call_notes"),
  unitsAssigned: jsonb("units_assigned"),
  responseTimeline: jsonb("response_timeline"),
  cadSource: text("cad_source"),
  cadExternalId: text("cad_external_id"),
  cadLastUpdatedAt: timestamp("cad_last_updated_at", { withTimezone: true }),
}, (table) => [
  index("idx_sentinel_cad_lookup").on(table.subAccountId, table.cadSource, table.cadExternalId),
]);

export const insertSentinelIncidentSchema = createInsertSchema(sentinelIncidents).omit({ id: true, detectedAt: true });
export type InsertSentinelIncident = z.infer<typeof insertSentinelIncidentSchema>;
export type SentinelIncident = typeof sentinelIncidents.$inferSelect;

export interface CadUnitAssigned {
  unitId: string;
  unitType?: string;
  dispatchedAt?: string;
  arrivedAt?: string;
  clearedAt?: string;
}

export interface CadTimelineEvent {
  timestamp: string;
  event: string;
  unit?: string;
  details?: string;
}

// ---- Property Wholesaler (Property Radar) ----

export const propertyLeads = pgTable("property_leads", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  address: text("address").notNull(),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  ownerName: text("owner_name"),
  ownerPhone: text("owner_phone"),
  ownerEmail: text("owner_email"),
  propertyType: text("property_type"),
  bedrooms: integer("bedrooms"),
  bathrooms: integer("bathrooms"),
  sqft: integer("sqft"),
  estimatedValue: integer("estimated_value"),
  estimatedEquity: integer("estimated_equity"),
  distressSignals: text("distress_signals").array().default([]),
  sourceHash: text("source_hash"),
  pipelineStage: text("pipeline_stage").default("new"),
  priority: text("priority").default("medium"),
  notes: text("notes"),
  lastContactedAt: timestamp("last_contacted_at"),
  smsSent: boolean("sms_sent").default(false),
  called: boolean("called").default(false),
  adDeployed: boolean("ad_deployed").default(false),
  lat: real("lat"),
  lng: real("lng"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPropertyLeadSchema = createInsertSchema(propertyLeads).omit({ id: true, createdAt: true });
export type InsertPropertyLead = z.infer<typeof insertPropertyLeadSchema>;
export type PropertyLead = typeof propertyLeads.$inferSelect;

export const wholesalerConfig = pgTable("wholesaler_config", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  targetZips: text("target_zips").array().default([]),
  targetCities: text("target_cities").array().default([]),
  distressFilters: text("distress_filters").array().default([]),
  minEquity: integer("min_equity").default(30000),
  maxArv: integer("max_arv"),
  autoSms: boolean("auto_sms").default(false),
  autoCall: boolean("auto_call").default(false),
  autoAds: boolean("auto_ads").default(false),
  smsTemplate: text("sms_template"),
  enabled: boolean("enabled").default(true),
});

export const insertWholesalerConfigSchema = createInsertSchema(wholesalerConfig).omit({ id: true });
export type InsertWholesalerConfig = z.infer<typeof insertWholesalerConfigSchema>;
export type WholesalerConfig = typeof wholesalerConfig.$inferSelect;

// ---- Skip Trace Results ----

export const skipTraceResults = pgTable("skip_trace_results", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  propertyLeadId: integer("property_lead_id").references(() => propertyLeads.id),
  address: text("address").notNull(),
  ownerName: text("owner_name"),
  ownerPhone: text("owner_phone"),
  ownerEmail: text("owner_email"),
  mailingAddress: text("mailing_address"),
  additionalPhones: text("additional_phones").array().default([]),
  additionalEmails: text("additional_emails").array().default([]),
  provider: text("provider").default("batchdata"),
  rawResponse: json("raw_response"),
  savedAsContactId: integer("saved_as_contact_id").references(() => contacts.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSkipTraceResultSchema = createInsertSchema(skipTraceResults).omit({ id: true, createdAt: true });
export type InsertSkipTraceResult = z.infer<typeof insertSkipTraceResultSchema>;
export type SkipTraceResult = typeof skipTraceResults.$inferSelect;

// ---- Skip Trace Usage Tracking ----

export const skipTraceUsage = pgTable("skip_trace_usage", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  lookupCount: integer("lookup_count").default(0),
  monthYear: text("month_year").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSkipTraceUsageSchema = createInsertSchema(skipTraceUsage).omit({ id: true, createdAt: true });
export type InsertSkipTraceUsage = z.infer<typeof insertSkipTraceUsageSchema>;
export type SkipTraceUsage = typeof skipTraceUsage.$inferSelect;

export const clientWebsites = pgTable("client_websites", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  url: text("url").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"),
  scrapedAt: timestamp("scraped_at"),
  trainingJobId: integer("training_job_id").references(() => trainingJobs.id),
  widgetEnabled: boolean("widget_enabled").default(false),
  widgetColor: text("widget_color").default("#6366f1"),
  widgetGreeting: text("widget_greeting").default("Hi there! How can I help you today?"),
  widgetPosition: text("widget_position").default("bottom-right"),
  botPersona: text("bot_persona"),
  pagesCrawled: integer("pages_crawled").default(0),
  lastCrawlStatus: text("last_crawl_status"),
  installVerifiedAt: timestamp("install_verified_at"),
  lastError: text("last_error"),
  verificationAttempts: integer("verification_attempts").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertClientWebsiteSchema = createInsertSchema(clientWebsites).omit({ id: true, createdAt: true });
export type InsertClientWebsite = z.infer<typeof insertClientWebsiteSchema>;
export type ClientWebsite = typeof clientWebsites.$inferSelect;

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  performedBy: text("performed_by").notNull(),
  details: json("details"),
  count: integer("count"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// ---- CRM Contacts ----

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  source: text("source").default("manual"),
  channel: text("channel"),
  tags: text("tags").array().default([]),
  notes: text("notes"),
  address: text("address"),
  formattedAddress: text("formatted_address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  lat: real("lat"),
  lng: real("lng"),
  geocodeStatus: text("geocode_status"),
  geocodedAt: timestamp("geocoded_at"),
  smsOptOut: boolean("sms_opt_out").default(false).notNull(),
  emailOptOut: boolean("email_opt_out").default(false).notNull(),
  optOutAt: timestamp("opt_out_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertContactSchema = createInsertSchema(contacts).omit({ id: true, createdAt: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;

// ---- Routing Failures ----

export const routingFailures = pgTable("routing_failures", {
  id: serial("id").primaryKey(),
  phone: text("phone"),
  channel: text("channel").notNull(),
  source: text("source"),
  rawPayload: json("raw_payload"),
  reason: text("reason").notNull(),
  resolvedSubAccountId: integer("resolved_sub_account_id"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRoutingFailureSchema = createInsertSchema(routingFailures).omit({ id: true, createdAt: true });
export type InsertRoutingFailure = z.infer<typeof insertRoutingFailureSchema>;
export type RoutingFailure = typeof routingFailures.$inferSelect;

// ---- Pipeline Deals ----

export const pipelineStages = pgTable("pipeline_stages", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  name: text("name").notNull(),
  color: text("color").default("#6366f1"),
  position: integer("position").notNull().default(0),
});

export const insertPipelineStageSchema = createInsertSchema(pipelineStages).omit({ id: true });
export type InsertPipelineStage = z.infer<typeof insertPipelineStageSchema>;
export type PipelineStage = typeof pipelineStages.$inferSelect;

export const deals = pgTable("deals", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  contactId: integer("contact_id").references(() => contacts.id),
  stageId: integer("stage_id").references(() => pipelineStages.id).notNull(),
  title: text("title").notNull(),
  value: real("value").default(0),
  status: text("status").default("open"),
  notes: text("notes"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDealSchema = createInsertSchema(deals).omit({ id: true, createdAt: true });
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Deal = typeof deals.$inferSelect;

// ---- Appointments ----

export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  contactId: integer("contact_id").references(() => contacts.id),
  title: text("title").notNull(),
  description: text("description"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  status: text("status").default("scheduled"),
  location: text("location"),
  googleCalendarEventId: text("google_calendar_event_id"),
  googleCalendarId: text("google_calendar_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAppointmentSchema = createInsertSchema(appointments).omit({ id: true, createdAt: true });
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointments.$inferSelect;

// ---- Email Campaigns ----

export const emailCampaigns = pgTable("email_campaigns", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").default("draft"),
  recipientCount: integer("recipient_count").default(0),
  sentCount: integer("sent_count").default(0),
  openCount: integer("open_count").default(0),
  clickCount: integer("click_count").default(0),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmailCampaignSchema = createInsertSchema(emailCampaigns).omit({ id: true, createdAt: true });
export type InsertEmailCampaign = z.infer<typeof insertEmailCampaignSchema>;
export type EmailCampaign = typeof emailCampaigns.$inferSelect;

// ---- Webhooks ----

export const webhooks = pgTable("webhooks", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  events: text("events").array().default([]),
  secret: text("secret"),
  active: boolean("active").default(true),
  lastTriggeredAt: timestamp("last_triggered_at"),
  failCount: integer("fail_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWebhookSchema = createInsertSchema(webhooks).omit({ id: true, createdAt: true });
export type InsertWebhook = z.infer<typeof insertWebhookSchema>;
export type Webhook = typeof webhooks.$inferSelect;

export const webhookDeliveryLogs = pgTable("webhook_delivery_logs", {
  id: serial("id").primaryKey(),
  webhookId: integer("webhook_id").references(() => webhooks.id, { onDelete: "cascade" }).notNull(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  targetUrl: text("target_url").notNull(),
  eventType: text("event_type").notNull(),
  statusCode: integer("status_code"),
  responseBody: text("response_body"),
  latencyMs: integer("latency_ms"),
  success: boolean("success").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWebhookDeliveryLogSchema = createInsertSchema(webhookDeliveryLogs).omit({ id: true, createdAt: true });
export type InsertWebhookDeliveryLog = z.infer<typeof insertWebhookDeliveryLogSchema>;
export type WebhookDeliveryLog = typeof webhookDeliveryLogs.$inferSelect;

// ---- White-Label Settings ----

export const whiteLabelSettings = pgTable("white_label_settings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  brandName: text("brand_name"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color").default("#6366f1"),
  accentColor: text("accent_color").default("#06b6d4"),
  customDomain: text("custom_domain"),
  favicon: text("favicon"),
  footerText: text("footer_text"),
  hideApexBranding: boolean("hide_apex_branding").default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertWhiteLabelSettingsSchema = createInsertSchema(whiteLabelSettings).omit({ id: true, updatedAt: true });
export type InsertWhiteLabelSettings = z.infer<typeof insertWhiteLabelSettingsSchema>;
export type WhiteLabelSettings = typeof whiteLabelSettings.$inferSelect;

// ---- Meta Ad Campaigns ----

export const metaAdCampaigns = pgTable("meta_ad_campaigns", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  metaCampaignId: text("meta_campaign_id"),
  name: text("name").notNull(),
  objective: text("objective").default("LEAD_GENERATION"),
  status: text("status").default("draft"),
  dailyBudget: real("daily_budget").default(0),
  totalSpend: real("total_spend").default(0),
  impressions: integer("impressions").default(0),
  clicks: integer("clicks").default(0),
  leads: integer("leads").default(0),
  cpc: real("cpc").default(0),
  ctr: real("ctr").default(0),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  targeting: json("targeting"),
  creativeUrl: text("creative_url"),
  adText: text("ad_text"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMetaAdCampaignSchema = createInsertSchema(metaAdCampaigns).omit({ id: true, createdAt: true });
export type InsertMetaAdCampaign = z.infer<typeof insertMetaAdCampaignSchema>;
export type MetaAdCampaign = typeof metaAdCampaigns.$inferSelect;

// ---- Meta Lead Forms ----

export const metaLeads = pgTable("meta_leads", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  metaFormId: text("meta_form_id"),
  formName: text("form_name"),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  customFields: json("custom_fields"),
  syncedToCrm: boolean("synced_to_crm").default(false),
  contactId: integer("contact_id"),
  campaignId: integer("campaign_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMetaLeadSchema = createInsertSchema(metaLeads).omit({ id: true, createdAt: true });
export type InsertMetaLead = z.infer<typeof insertMetaLeadSchema>;
export type MetaLead = typeof metaLeads.$inferSelect;

// ---- Instagram Conversations ----

export const instagramConversations = pgTable("instagram_conversations", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  igUserId: text("ig_user_id"),
  igUsername: text("ig_username"),
  lastMessage: text("last_message"),
  lastMessageAt: timestamp("last_message_at"),
  unreadCount: integer("unread_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertInstagramConversationSchema = createInsertSchema(instagramConversations).omit({ id: true, createdAt: true });
export type InsertInstagramConversation = z.infer<typeof insertInstagramConversationSchema>;
export type InstagramConversation = typeof instagramConversations.$inferSelect;

// ---- Instagram Messages ----

export const instagramMessages = pgTable("instagram_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => instagramConversations.id).notNull(),
  direction: text("direction").notNull(),
  body: text("body").notNull(),
  igMessageId: text("ig_message_id"),
  mediaUrl: text("media_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertInstagramMessageSchema = createInsertSchema(instagramMessages).omit({ id: true, createdAt: true });
export type InsertInstagramMessage = z.infer<typeof insertInstagramMessageSchema>;
export type InstagramMessage = typeof instagramMessages.$inferSelect;

// ---- Notifications ----

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  read: boolean("read").default(false),
  link: text("link"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// ---- Live Automations (Compiled Workflow Manifests) ----

export const liveAutomations = pgTable("live_automations", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id),
  name: text("name").notNull(),
  description: text("description"),
  manifest: json("manifest").notNull(),
  status: text("status").notNull().default("compiled"),
  lastRunAt: timestamp("last_run_at"),
  runCount: integer("run_count").default(0),
  runLogs: json("run_logs").default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertLiveAutomationSchema = createInsertSchema(liveAutomations).omit({ id: true, createdAt: true });
export type InsertLiveAutomation = z.infer<typeof insertLiveAutomationSchema>;
export type LiveAutomation = typeof liveAutomations.$inferSelect;

// ---- AI Tool Execution Logs ----

export const aiToolLogs = pgTable("ai_tool_logs", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id),
  toolName: text("tool_name").notNull(),
  input: json("input"),
  output: json("output"),
  status: text("status").notNull().default("success"),
  executionMs: integer("execution_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAiToolLogSchema = createInsertSchema(aiToolLogs).omit({ id: true, createdAt: true });
export type InsertAiToolLog = z.infer<typeof insertAiToolLogSchema>;
export type AiToolLog = typeof aiToolLogs.$inferSelect;

// ---- Webhook Event Log ----

export const webhookEvents = pgTable("webhook_events", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  webhookId: integer("webhook_id").references(() => webhooks.id),
  eventType: text("event_type").notNull(),
  url: text("url").notNull(),
  method: text("method").default("POST"),
  requestBody: json("request_body"),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  status: text("status").notNull().default("pending"),
  duration: integer("duration"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWebhookEventSchema = createInsertSchema(webhookEvents).omit({ id: true, createdAt: true });
export type InsertWebhookEvent = z.infer<typeof insertWebhookEventSchema>;
export type WebhookEvent = typeof webhookEvents.$inferSelect;

// ---- Integration Connections ----

export const integrationConnections = pgTable("integration_connections", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  provider: text("provider").notNull(),
  status: text("status").notNull().default("disconnected"),
  config: json("config"),
  connectionType: text("connection_type").notNull().default("legacy"),
  connectedAt: timestamp("connected_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertIntegrationConnectionSchema = createInsertSchema(integrationConnections).omit({ id: true, createdAt: true });
export type InsertIntegrationConnection = z.infer<typeof insertIntegrationConnectionSchema>;
export type IntegrationConnection = typeof integrationConnections.$inferSelect;

// ---- OAuth Tokens ----

export const oauthTokens = pgTable("oauth_tokens", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiry: timestamp("token_expiry"),
  scopes: text("scopes"),
  providerAccountId: text("provider_account_id"),
  providerEmail: text("provider_email"),
  connectionType: text("connection_type").notNull().default("oauth"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertOAuthTokenSchema = createInsertSchema(oauthTokens).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOAuthToken = z.infer<typeof insertOAuthTokenSchema>;
export type OAuthToken = typeof oauthTokens.$inferSelect;

// ---- Integration Events ----

export const integrationEvents = pgTable("integration_events", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  provider: text("provider").notNull(),
  eventType: text("event_type").notNull(),
  payload: json("payload"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertIntegrationEventSchema = createInsertSchema(integrationEvents).omit({ id: true, createdAt: true });
export type InsertIntegrationEvent = z.infer<typeof insertIntegrationEventSchema>;
export type IntegrationEvent = typeof integrationEvents.$inferSelect;

// ---- Provider Assets ----

export const providerAssets = pgTable("provider_assets", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  provider: text("provider").notNull(),
  assetType: text("asset_type").notNull(),
  assetId: text("asset_id").notNull(),
  assetName: text("asset_name").notNull(),
  selected: boolean("selected").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProviderAssetSchema = createInsertSchema(providerAssets).omit({ id: true, createdAt: true });
export type InsertProviderAsset = z.infer<typeof insertProviderAssetSchema>;
export type ProviderAsset = typeof providerAssets.$inferSelect;

// ---- Client Portal Tokens ----

export const portalTokens = pgTable("portal_tokens", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  token: text("token").notNull().unique(),
  label: text("label"),
  expiresAt: timestamp("expires_at"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPortalTokenSchema = createInsertSchema(portalTokens).omit({ id: true, createdAt: true });
export type InsertPortalToken = z.infer<typeof insertPortalTokenSchema>;
export type PortalToken = typeof portalTokens.$inferSelect;

// ---- Dispatch Subscribers ----

export const dispatchSubscribers = pgTable("dispatch_subscribers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  occupation: text("occupation"),
  targetZip: text("target_zip").notNull(),
  targetRadiusMeters: real("target_radius_meters").notNull().default(80467),
  webhookUrl: text("webhook_url").notNull(),
  webhookSecret: text("webhook_secret").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDispatchSubscriberSchema = createInsertSchema(dispatchSubscribers).omit({ id: true, createdAt: true });
export type InsertDispatchSubscriber = z.infer<typeof insertDispatchSubscriberSchema>;
export type DispatchSubscriber = typeof dispatchSubscribers.$inferSelect;

// ---- Credit Wallets (Monetization) ----

export const creditWallets = pgTable("credit_wallets", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  balance: real("balance").notNull().default(0),
  lifetimeTopUp: real("lifetime_top_up").notNull().default(0),
  lifetimeSpend: real("lifetime_spend").notNull().default(0),
  autoTopUp: boolean("auto_top_up").default(false),
  autoTopUpAmount: real("auto_top_up_amount").default(25),
  lowBalanceThreshold: real("low_balance_threshold").default(5),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCreditWalletSchema = createInsertSchema(creditWallets).omit({ id: true, updatedAt: true });
export type InsertCreditWallet = z.infer<typeof insertCreditWalletSchema>;
export type CreditWallet = typeof creditWallets.$inferSelect;

// ---- Credit Transactions ----

export const creditTransactions = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  type: text("type").notNull(),
  amount: real("amount").notNull(),
  balanceAfter: real("balance_after").notNull(),
  description: text("description"),
  baseCost: real("base_cost"),
  platformProfit: real("platform_profit"),
  stripeSessionId: text("stripe_session_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCreditTransactionSchema = createInsertSchema(creditTransactions).omit({ id: true, createdAt: true });
export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;
export type CreditTransaction = typeof creditTransactions.$inferSelect;

// ---- Sponsorships (Native Ads) ----

export const sponsorships = pgTable("sponsorships", {
  id: serial("id").primaryKey(),
  sponsorName: text("sponsor_name").notNull(),
  businessName: text("business_name"),
  imageUrl: text("image_url"),
  linkUrl: text("link_url"),
  headline: text("headline").notNull(),
  description: text("description"),
  bidPerClick: real("bid_per_click").notNull().default(0.50),
  totalBudget: real("total_budget").notNull().default(100),
  spent: real("spent").notNull().default(0),
  targetLat: real("target_lat").notNull(),
  targetLon: real("target_lon").notNull(),
  targetRadiusMeters: real("target_radius_meters").notNull().default(80467),
  status: text("status").notNull().default("pending"),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSponsorshipSchema = createInsertSchema(sponsorships).omit({ id: true, createdAt: true });
export type InsertSponsorship = z.infer<typeof insertSponsorshipSchema>;
export type Sponsorship = typeof sponsorships.$inferSelect;

// ---- Sponsorship Clicks ----

export const sponsorshipClicks = pgTable("sponsorship_clicks", {
  id: serial("id").primaryKey(),
  sponsorshipId: integer("sponsorship_id").references(() => sponsorships.id).notNull(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id),
  clickedAt: timestamp("clicked_at").defaultNow().notNull(),
});

export const insertSponsorshipClickSchema = createInsertSchema(sponsorshipClicks).omit({ id: true, clickedAt: true });
export type InsertSponsorshipClick = z.infer<typeof insertSponsorshipClickSchema>;
export type SponsorshipClick = typeof sponsorshipClicks.$inferSelect;

// ---- Platform Profit Ledger ----

export const platformProfitLedger = pgTable("platform_profit_ledger", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  amount: real("amount").notNull(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id),
  sponsorshipId: integer("sponsorship_id").references(() => sponsorships.id),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPlatformProfitSchema = createInsertSchema(platformProfitLedger).omit({ id: true, createdAt: true });
export type InsertPlatformProfit = z.infer<typeof insertPlatformProfitSchema>;
export type PlatformProfit = typeof platformProfitLedger.$inferSelect;

// ---- Message Billing ----

export const messageBilling = pgTable("message_billing", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  messageId: integer("message_id").references(() => messages.id),
  channel: text("channel").notNull(),
  provider: text("provider").notNull(),
  providerCost: real("provider_cost").notNull().default(0),
  billedAmount: real("billed_amount").notNull(),
  margin: real("margin").notNull(),
  externalMessageId: text("external_message_id"),
  direction: text("direction").notNull().default("outbound"),
  messageType: text("message_type").notNull().default("customer"),
  billingExempt: boolean("billing_exempt").notNull().default(false),
  exemptReason: text("exempt_reason"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMessageBillingSchema = createInsertSchema(messageBilling).omit({ id: true, createdAt: true });
export type InsertMessageBilling = z.infer<typeof insertMessageBillingSchema>;
export type MessageBilling = typeof messageBilling.$inferSelect;

// ---- Funnel Leads ----

export const funnelLeads = pgTable("funnel_leads", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  slug: text("slug").notNull(),
  niche: text("niche").notNull(),
  step: integer("step").notNull().default(0),
  status: text("status").notNull().default("in_progress"),
  formData: json("form_data").notNull().default({}),
  contactId: integer("contact_id").references(() => contacts.id),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertFunnelLeadSchema = createInsertSchema(funnelLeads).omit({ id: true, createdAt: true, lastSeenAt: true });
export type InsertFunnelLead = z.infer<typeof insertFunnelLeadSchema>;
export type FunnelLead = typeof funnelLeads.$inferSelect;

export const digitalCards = pgTable("digital_cards", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id),
  ownerEmail: text("owner_email"),
  name: text("name").default(""),
  preferredName: text("preferred_name").default(""),
  title: text("title").default(""),
  company: text("company").default(""),
  phone: text("phone").default(""),
  email: text("email").default(""),
  website: text("website").default(""),
  bio: text("bio").default(""),
  photoUrl: text("photo_url").default(""),
  coverImageUrl: text("cover_image_url").default(""),
  logoImageUrl: text("logo_image_url").default(""),
  googleReviewLink: text("google_review_link").default(""),
  slug: text("slug").unique(),
  brandColor: text("brand_color").default("#6366f1"),
  accentColor: text("accent_color").default("#8b5cf6"),
  theme: text("theme").default("executive-dark"),
  layoutVariant: text("layout_variant").default("standard"),
  bookingUrl: text("booking_url").default(""),
  calendarUrl: text("calendar_url").default(""),
  location: text("location").default(""),
  tagline: text("tagline").default(""),
  socialLinks: jsonb("social_links").$type<{ label: string; url: string; icon?: string }[]>().default([]),
  links: jsonb("links").$type<{ label: string; url: string; type?: string }[]>().default([]),
  services: jsonb("services").$type<{ label: string; description: string; icon?: string; color?: string }[]>().default([]),
  testimonial: jsonb("testimonial").$type<{ quote: string; author: string; role: string } | null>().default(null),
  leadCaptureEnabled: boolean("lead_capture_enabled").default(false),
  leadWebhookUrl: text("lead_webhook_url"),
  leadEmail: text("lead_email"),
  seoTitle: text("seo_title").default(""),
  seoDescription: text("seo_description").default(""),
  ogImageUrl: text("og_image_url").default(""),
  customerId: text("customer_id"),
  purchaseId: text("purchase_id"),
  editToken: text("edit_token"),
  createdByUserId: integer("created_by_user_id"),
  referralCode: text("referral_code"),
  paymentStatus: text("payment_status").default("pending"),
  status: text("status").default("published"),
  isActive: boolean("is_active").default(true),
  isPublic: boolean("is_public").default(true),
  viewCount: integer("view_count").default(0),
  saveContactCount: integer("save_contact_count").default(0),
  shareCount: integer("share_count").default(0),
  clickStats: jsonb("click_stats").$type<Record<string, number>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const cardAnalyticsEvents = pgTable("card_analytics_events", {
  id: serial("id").primaryKey(),
  cardId: integer("card_id").references(() => digitalCards.id).notNull(),
  eventType: text("event_type").notNull(),
  eventTarget: text("event_target"),
  visitorId: text("visitor_id"),
  userAgent: text("user_agent"),
  referrer: text("referrer"),
  ipHash: text("ip_hash"),
  country: text("country"),
  city: text("city"),
  deviceType: text("device_type"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDigitalCardSchema = createInsertSchema(digitalCards).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  socialLinks: z.array(z.object({
    label: z.string(),
    url: z.string().url(),
    icon: z.string().optional(),
  })).optional(),
  links: z.array(z.object({
    label: z.string(),
    url: z.string(),
    type: z.string().optional(),
  })).optional(),
  services: z.array(z.object({
    label: z.string(),
    description: z.string(),
    icon: z.string().optional(),
    color: z.string().optional(),
  })).optional(),
  testimonial: z.object({
    quote: z.string(),
    author: z.string(),
    role: z.string(),
  }).nullable().optional(),
});
export type InsertDigitalCard = z.infer<typeof insertDigitalCardSchema>;
export type DigitalCard = typeof digitalCards.$inferSelect;

export const crashReports = pgTable("crash_reports", {
  id: serial("id").primaryKey(),
  reportNumber: text("report_number").unique().notNull(),
  status: text("status").default("PENDING").notNull(),
  requesterRole: text("requester_role"),
  reason: text("reason"),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id),
  data: json("data"),
  errorLog: text("error_log"),
  retryCount: integer("retry_count").default(0).notNull(),
  serviceFailureCount: integer("service_failure_count").default(0).notNull(),
  lockedAt: timestamp("locked_at"),
  lockedBy: text("locked_by"),
  source: text("source").default("manual").notNull(),
  processedToLead: boolean("processed_to_lead").default(false).notNull(),
  ingestTraceId: text("ingest_trace_id"),
  rawPayload: json("raw_payload"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCrashReportSchema = createInsertSchema(crashReports).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrashReport = z.infer<typeof insertCrashReportSchema>;
export type CrashReport = typeof crashReports.$inferSelect;

// ---- Shopify Events ----

export const shopifyEvents = pgTable("shopify_events", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  eventType: text("event_type").notNull(),
  shopifyId: text("shopify_id"),
  storeName: text("store_name"),
  payload: json("payload"),
  processed: boolean("processed").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertShopifyEventSchema = createInsertSchema(shopifyEvents).omit({ id: true, createdAt: true });
export type InsertShopifyEvent = z.infer<typeof insertShopifyEventSchema>;
export type ShopifyEvent = typeof shopifyEvents.$inferSelect;

export const dmKeywordAutomations = pgTable("dm_keyword_automations", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  keyword: text("keyword").notNull(),
  matchType: text("match_type").default("exact").notNull(),
  channel: text("channel").default("all").notNull(),
  responseText: text("response_text"),
  responseType: text("response_type").default("text").notNull(),
  actionPayload: json("action_payload"),
  enabled: boolean("enabled").default(true).notNull(),
  hitCount: integer("hit_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDmKeywordAutomationSchema = createInsertSchema(dmKeywordAutomations).omit({ id: true, createdAt: true, hitCount: true });
export type InsertDmKeywordAutomation = z.infer<typeof insertDmKeywordAutomationSchema>;
export type DmKeywordAutomation = typeof dmKeywordAutomations.$inferSelect;

export const whatsappTemplates = pgTable("whatsapp_templates", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().default("marketing"),
  language: text("language").notNull().default("en"),
  headerType: text("header_type"),
  headerContent: text("header_content"),
  body: text("body").notNull(),
  footerText: text("footer_text"),
  buttons: json("buttons"),
  variables: text("variables").array().default([]),
  status: text("status").notNull().default("draft"),
  twilioTemplateSid: text("twilio_template_sid"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWhatsappTemplateSchema = createInsertSchema(whatsappTemplates).omit({ id: true, createdAt: true });
export type InsertWhatsappTemplate = z.infer<typeof insertWhatsappTemplateSchema>;
export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;

export const systemLogs = pgTable("system_logs", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  severity: text("severity").notNull().default("error"),
  module: text("module").notNull(),
  message: text("message").notNull(),
  metadata: json("metadata"),
});

export const insertSystemLogSchema = createInsertSchema(systemLogs).omit({ id: true, timestamp: true });
export type InsertSystemLog = z.infer<typeof insertSystemLogSchema>;
export type SystemLog = typeof systemLogs.$inferSelect;

export const featureFlags = pgTable("feature_flags", {
  id: serial("id").primaryKey(),
  featureName: text("feature_name").notNull().unique(),
  enabled: boolean("enabled").default(true).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertFeatureFlagSchema = createInsertSchema(featureFlags).omit({ id: true, createdAt: true });
export type InsertFeatureFlag = z.infer<typeof insertFeatureFlagSchema>;
export type FeatureFlag = typeof featureFlags.$inferSelect;

export const operatorMemories = pgTable("operator_memories", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  memoryType: text("memory_type").notNull(),
  key: text("key").notNull(),
  value: json("value").notNull(),
  confidence: real("confidence").default(0.5),
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  version: integer("version").default(1),
});

export const insertOperatorMemorySchema = createInsertSchema(operatorMemories).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOperatorMemory = z.infer<typeof insertOperatorMemorySchema>;
export type OperatorMemoryRecord = typeof operatorMemories.$inferSelect;

export const operatorNudges = pgTable("operator_nudges", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  nudgeType: text("nudge_type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  priority: integer("priority").default(0),
  status: text("status").default("pending").notNull(),
  metadata: json("metadata"),
  dismissedAt: timestamp("dismissed_at"),
  actedOnAt: timestamp("acted_on_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertOperatorNudgeSchema = createInsertSchema(operatorNudges).omit({ id: true, createdAt: true });
export type InsertOperatorNudge = z.infer<typeof insertOperatorNudgeSchema>;
export type OperatorNudge = typeof operatorNudges.$inferSelect;

export const agentTasks = pgTable("agent_tasks", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  taskType: text("task_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").default("queued").notNull(),
  priority: integer("priority").default(50),
  result: json("result"),
  error: text("error"),
  toolUsed: text("tool_used"),
  triggeredBy: text("triggered_by").default("system").notNull(),
  attempts: integer("attempts").default(0),
  maxAttempts: integer("max_attempts").default(3),
  urgent: boolean("urgent").default(false),
  scheduledAt: timestamp("scheduled_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAgentTaskSchema = createInsertSchema(agentTasks).omit({ id: true, createdAt: true });
export type InsertAgentTask = z.infer<typeof insertAgentTaskSchema>;
export type AgentTask = typeof agentTasks.$inferSelect;

export const agentConfig = pgTable("agent_config", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  enabled: boolean("enabled").default(true),
  autonomyLevel: text("autonomy_level").default("draft").notNull(),
  scanIntervalMinutes: integer("scan_interval_minutes").default(30),
  maxTasksPerDay: integer("max_tasks_per_day").default(10),
  tasksRunToday: integer("tasks_run_today").default(0),
  lastScanAt: timestamp("last_scan_at"),
  lastResetAt: timestamp("last_reset_at"),
  allowedTaskTypes: text("allowed_task_types").array().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAgentConfigSchema = createInsertSchema(agentConfig).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAgentConfig = z.infer<typeof insertAgentConfigSchema>;
export type AgentConfig = typeof agentConfig.$inferSelect;

export const agentBriefings = pgTable("agent_briefings", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  summary: text("summary").notNull(),
  tasksCompleted: integer("tasks_completed").default(0),
  tasksFailed: integer("tasks_failed").default(0),
  highlights: json("highlights"),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  seen: boolean("seen").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAgentBriefingSchema = createInsertSchema(agentBriefings).omit({ id: true, createdAt: true });
export type InsertAgentBriefing = z.infer<typeof insertAgentBriefingSchema>;
export type AgentBriefing = typeof agentBriefings.$inferSelect;

// ---- Push Subscriptions (Web Push API) ----

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("push_sub_account_endpoint_idx").on(table.subAccountId, table.endpoint),
]);

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true, createdAt: true });
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

// ---- Notification Preferences ----

export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull().unique(),
  newLeadPush: boolean("new_lead_push").default(true).notNull(),
  newLeadSms: boolean("new_lead_sms").default(false).notNull(),
  missedCallPush: boolean("missed_call_push").default(true).notNull(),
  missedCallSms: boolean("missed_call_sms").default(true).notNull(),
  paymentFailedPush: boolean("payment_failed_push").default(true).notNull(),
  paymentFailedSms: boolean("payment_failed_sms").default(true).notNull(),
  incidentPush: boolean("incident_push").default(true).notNull(),
  incidentSms: boolean("incident_sms").default(true).notNull(),
  nudgeHighPush: boolean("nudge_high_push").default(true).notNull(),
  nudgeHighSms: boolean("nudge_high_sms").default(false).notNull(),
  agentUrgentPush: boolean("agent_urgent_push").default(true).notNull(),
  agentUrgentSms: boolean("agent_urgent_sms").default(true).notNull(),
  campaignAlertPush: boolean("campaign_alert_push").default(true).notNull(),
  campaignAlertSms: boolean("campaign_alert_sms").default(false).notNull(),
  systemAlertPush: boolean("system_alert_push").default(true).notNull(),
  systemAlertSms: boolean("system_alert_sms").default(false).notNull(),
  smsAlertPhone: text("sms_alert_phone"),
  quietHoursEnabled: boolean("quiet_hours_enabled").default(false).notNull(),
  quietHoursStart: text("quiet_hours_start").default("22:00").notNull(),
  quietHoursEnd: text("quiet_hours_end").default("08:00").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferences).omit({ id: true, updatedAt: true });
export type InsertNotificationPreference = z.infer<typeof insertNotificationPreferenceSchema>;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;

// ---- Agent Episodic Memories ----

export const agentMemories = pgTable("agent_memories", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  memoryType: text("memory_type").notNull(),
  content: text("content").notNull(),
  category: text("category"),
  relevanceScore: real("relevance_score").default(1.0).notNull(),
  decayRate: real("decay_rate").default(0.01).notNull(),
  sourceEvent: text("source_event"),
  sourceContext: json("source_context"),
  outcome: text("outcome"),
  tags: text("tags").array().default([]),
  accessCount: integer("access_count").default(0),
  lastAccessedAt: timestamp("last_accessed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAgentMemorySchema = createInsertSchema(agentMemories).omit({ id: true, createdAt: true });
export type InsertAgentMemory = z.infer<typeof insertAgentMemorySchema>;
export type AgentMemory = typeof agentMemories.$inferSelect;

// ---- A/B Testing Engine ----

export const abExperiments = pgTable("ab_experiments", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id),
  name: text("name").notNull(),
  description: text("description"),
  contentType: text("content_type").notNull(),
  contentId: integer("content_id"),
  status: text("status").default("running").notNull(),
  variantA: json("variant_a").notNull(),
  variantB: json("variant_b").notNull(),
  trafficSplit: real("traffic_split").default(50).notNull(),
  metric: text("metric").default("conversion_rate").notNull(),
  impressionsA: integer("impressions_a").default(0).notNull(),
  impressionsB: integer("impressions_b").default(0).notNull(),
  conversionsA: integer("conversions_a").default(0).notNull(),
  conversionsB: integer("conversions_b").default(0).notNull(),
  winnerVariant: text("winner_variant"),
  confidenceLevel: real("confidence_level").default(0),
  autoPromote: boolean("auto_promote").default(true).notNull(),
  minSampleSize: integer("min_sample_size").default(100).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertAbExperimentSchema = createInsertSchema(abExperiments).omit({ id: true, createdAt: true });
export type InsertAbExperiment = z.infer<typeof insertAbExperimentSchema>;
export type AbExperiment = typeof abExperiments.$inferSelect;

export const abEvents = pgTable("ab_events", {
  id: serial("id").primaryKey(),
  experimentId: integer("experiment_id").references(() => abExperiments.id).notNull(),
  variant: text("variant").notNull(),
  eventType: text("event_type").notNull(),
  visitorId: text("visitor_id"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAbEventSchema = createInsertSchema(abEvents).omit({ id: true, createdAt: true });
export type InsertAbEvent = z.infer<typeof insertAbEventSchema>;
export type AbEvent = typeof abEvents.$inferSelect;

// ---- Industry Benchmarks (Cross-Account Intelligence) ----

export const industryBenchmarks = pgTable("industry_benchmarks", {
  id: serial("id").primaryKey(),
  industry: text("industry").notNull(),
  metricKey: text("metric_key").notNull(),
  avgValue: real("avg_value").notNull(),
  medianValue: real("median_value"),
  p25Value: real("p25_value"),
  p75Value: real("p75_value"),
  p90Value: real("p90_value"),
  minValue: real("min_value"),
  maxValue: real("max_value"),
  sampleSize: integer("sample_size").notNull().default(0),
  unit: text("unit").default("number"),
  computedAt: timestamp("computed_at").defaultNow().notNull(),
});

export const insertIndustryBenchmarkSchema = createInsertSchema(industryBenchmarks).omit({ id: true, computedAt: true });
export type InsertIndustryBenchmark = z.infer<typeof insertIndustryBenchmarkSchema>;
export type IndustryBenchmark = typeof industryBenchmarks.$inferSelect;

// ---- Workflow Step Metrics ----

export const workflowStepMetrics = pgTable("workflow_step_metrics", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").references(() => workflows.id).notNull(),
  stepIndex: integer("step_index").notNull(),
  stepType: text("step_type").notNull(),
  executionCount: integer("execution_count").default(0).notNull(),
  successCount: integer("success_count").default(0).notNull(),
  failureCount: integer("failure_count").default(0).notNull(),
  responseCount: integer("response_count").default(0).notNull(),
  totalDurationMs: integer("total_duration_ms").default(0).notNull(),
  avgTimeToNextMs: integer("avg_time_to_next_ms").default(0),
  lastExecutedAt: timestamp("last_executed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertWorkflowStepMetricSchema = createInsertSchema(workflowStepMetrics).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorkflowStepMetric = z.infer<typeof insertWorkflowStepMetricSchema>;
export type WorkflowStepMetric = typeof workflowStepMetrics.$inferSelect;

// ---- Workflow Optimization Logs ----

export const workflowOptimizationLogs = pgTable("workflow_optimization_logs", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").references(() => workflows.id).notNull(),
  stepIndex: integer("step_index"),
  changeType: text("change_type").notNull(),
  previousValue: json("previous_value"),
  newValue: json("new_value"),
  reason: text("reason").notNull(),
  appliedBy: text("applied_by").notNull().default("agent"),
  reverted: boolean("reverted").default(false),
  revertedAt: timestamp("reverted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWorkflowOptimizationLogSchema = createInsertSchema(workflowOptimizationLogs).omit({ id: true, createdAt: true });
export type InsertWorkflowOptimizationLog = z.infer<typeof insertWorkflowOptimizationLogSchema>;
export type WorkflowOptimizationLog = typeof workflowOptimizationLogs.$inferSelect;

export const operatorGoals = pgTable("operator_goals", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  goalType: text("goal_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  targetMetric: text("target_metric").notNull(),
  targetValue: real("target_value").notNull(),
  currentValue: real("current_value").default(0),
  baselineValue: real("baseline_value").default(0),
  timeHorizonDays: integer("time_horizon_days").notNull().default(30),
  status: text("status").notNull().default("draft"),
  priority: integer("priority").notNull().default(50),
  autonomyLevelRequired: text("autonomy_level_required").default("draft"),
  createdBy: text("created_by"),
  source: text("source").notNull().default("user"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  nextReviewAt: timestamp("next_review_at"),
  successScore: real("success_score"),
  failureReason: text("failure_reason"),
  metadata: json("metadata"),
});

export const insertOperatorGoalSchema = createInsertSchema(operatorGoals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOperatorGoal = z.infer<typeof insertOperatorGoalSchema>;
export type OperatorGoal = typeof operatorGoals.$inferSelect;

export const operatorPlans = pgTable("operator_plans", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull(),
  accountId: integer("account_id").notNull(),
  planVersion: integer("plan_version").notNull().default(1),
  status: text("status").notNull().default("draft"),
  summary: text("summary"),
  rationale: text("rationale"),
  aiModel: text("ai_model"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  supersededByPlanId: integer("superseded_by_plan_id"),
  metadata: json("metadata"),
});

export const insertOperatorPlanSchema = createInsertSchema(operatorPlans).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOperatorPlan = z.infer<typeof insertOperatorPlanSchema>;
export type OperatorPlan = typeof operatorPlans.$inferSelect;

export const operatorPlanSteps = pgTable("operator_plan_steps", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull(),
  goalId: integer("goal_id").notNull(),
  accountId: integer("account_id").notNull(),
  stepOrder: integer("step_order").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  stepType: text("step_type").notNull(),
  status: text("status").notNull().default("pending"),
  ownerType: text("owner_type").notNull().default("agent"),
  toolName: text("tool_name"),
  toolPayload: json("tool_payload"),
  idempotencyKey: text("idempotency_key").notNull(),
  dependencyMode: text("dependency_mode").default("all"),
  requiresApproval: boolean("requires_approval").default(false),
  dueAt: timestamp("due_at"),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(3),
  failureReason: text("failure_reason"),
  successCriteria: text("success_criteria"),
  result: json("result"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  metadata: json("metadata"),
});

export const insertOperatorPlanStepSchema = createInsertSchema(operatorPlanSteps).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOperatorPlanStep = z.infer<typeof insertOperatorPlanStepSchema>;
export type OperatorPlanStep = typeof operatorPlanSteps.$inferSelect;

export const operatorStepDependencies = pgTable("operator_step_dependencies", {
  id: serial("id").primaryKey(),
  stepId: integer("step_id").notNull(),
  dependsOnStepId: integer("depends_on_step_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOperatorStepDependencySchema = createInsertSchema(operatorStepDependencies).omit({ id: true, createdAt: true });
export type InsertOperatorStepDependency = z.infer<typeof insertOperatorStepDependencySchema>;

export const operatorGoalProgress = pgTable("operator_goal_progress", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull(),
  accountId: integer("account_id").notNull(),
  metricName: text("metric_name").notNull(),
  metricValue: real("metric_value").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow(),
  source: text("source"),
  notes: text("notes"),
});

export const insertOperatorGoalProgressSchema = createInsertSchema(operatorGoalProgress).omit({ id: true, recordedAt: true });
export type InsertOperatorGoalProgress = z.infer<typeof insertOperatorGoalProgressSchema>;

export const operatorGoalReviews = pgTable("operator_goal_reviews", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull(),
  planId: integer("plan_id"),
  reviewType: text("review_type").notNull(),
  summary: text("summary"),
  decision: text("decision").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  metadata: json("metadata"),
});

export const insertOperatorGoalReviewSchema = createInsertSchema(operatorGoalReviews).omit({ id: true, createdAt: true });
export type InsertOperatorGoalReview = z.infer<typeof insertOperatorGoalReviewSchema>;

export const operatorToolTrust = pgTable("operator_tool_trust", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  toolName: text("tool_name").notNull(),
  taskCategory: text("task_category"),
  successfulDrafts: integer("successful_drafts").default(0),
  successfulExecutions: integer("successful_executions").default(0),
  failures: integer("failures").default(0),
  humanRejections: integer("human_rejections").default(0),
  trustLevel: text("trust_level").default("low"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const vapiCallLogs = pgTable("vapi_call_logs", {
  id: serial("id").primaryKey(),
  vapiCallId: text("vapi_call_id").notNull(),
  assistantId: text("assistant_id"),
  assistantName: text("assistant_name"),
  customerNumber: text("customer_number"),
  type: text("type"),
  status: text("status"),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  duration: integer("duration"),
  cost: real("cost"),
  transcript: text("transcript"),
  summary: text("summary"),
  recordingUrl: text("recording_url"),
  endedReason: text("ended_reason"),
  analysis: json("analysis"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertVapiCallLogSchema = createInsertSchema(vapiCallLogs).omit({ id: true, createdAt: true });
export type InsertVapiCallLog = z.infer<typeof insertVapiCallLogSchema>;
export type VapiCallLog = typeof vapiCallLogs.$inferSelect;

// ---- Execution Timeline / Observability ----

export const timelineEvents = pgTable("timeline_events", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  traceId: text("trace_id").notNull(),
  conversationId: text("conversation_id"),
  contactPhone: text("contact_phone"),
  step: text("step").notNull(),
  status: text("status").notNull().default("success"),
  provider: text("provider"),
  latencyMs: integer("latency_ms"),
  metadata: json("metadata"),
  error: text("error"),
  eventKey: text("event_key"),
  sequenceNum: integer("sequence_num"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  eventKeyIdx: uniqueIndex("timeline_events_event_key_idx").on(t.eventKey),
  traceSeqIdx: index("timeline_events_trace_seq_idx").on(t.traceId, t.sequenceNum),
}));

export const insertTimelineEventSchema = createInsertSchema(timelineEvents).omit({ id: true, createdAt: true });
export type InsertTimelineEvent = z.infer<typeof insertTimelineEventSchema>;
export type TimelineEvent = typeof timelineEvents.$inferSelect;

// ---- Unified Event Log ----

export const EVENT_LOG_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  DEAD_LETTER: "dead_letter",
} as const;

export type EventLogStatus = typeof EVENT_LOG_STATUS[keyof typeof EVENT_LOG_STATUS];

export const eventLog = pgTable("event_log", {
  id: serial("id").primaryKey(),
  traceId: text("trace_id").notNull(),
  type: text("type").notNull(),
  source: text("source").notNull(),
  externalId: text("external_id"),
  payload: json("payload").notNull(),
  status: text("status").notNull().default("pending"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
  failedAt: timestamp("failed_at"),
  errorMessage: text("error_message"),
}, (table) => ({
  sourceExternalIdIdx: uniqueIndex("event_log_source_external_id_idx").on(table.source, table.externalId),
}));

export const insertEventLogSchema = createInsertSchema(eventLog).omit({ id: true, createdAt: true });
export type InsertEventLog = z.infer<typeof insertEventLogSchema>;
export type EventLogEntry = typeof eventLog.$inferSelect;

export const agentConversations = pgTable("agent_conversations", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").unique().notNull(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
});

export const insertAgentConversationSchema = createInsertSchema(agentConversations).omit({ id: true, createdAt: true, lastActivityAt: true });
export type InsertAgentConversation = z.infer<typeof insertAgentConversationSchema>;
export type AgentConversation = typeof agentConversations.$inferSelect;

export const agentMessages = pgTable("agent_messages", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").references(() => agentConversations.sessionId).notNull(),
  role: text("role").notNull(),
  content: text("content"),
  toolCalls: jsonb("tool_calls"),
  toolResults: jsonb("tool_results"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAgentMessageSchema = createInsertSchema(agentMessages).omit({ id: true, createdAt: true });
export type InsertAgentMessage = z.infer<typeof insertAgentMessageSchema>;
export type AgentMessage = typeof agentMessages.$inferSelect;

export const pendingActions = pgTable("pending_actions", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").references(() => agentConversations.sessionId).notNull(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  toolName: text("tool_name").notNull(),
  toolArgs: jsonb("tool_args").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("awaiting_confirmation"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export const insertPendingActionSchema = createInsertSchema(pendingActions).omit({ id: true, createdAt: true, resolvedAt: true });
export type InsertPendingAction = z.infer<typeof insertPendingActionSchema>;
export type PendingAction = typeof pendingActions.$inferSelect;

export const mailchimpEmailLogs = pgTable("mailchimp_email_logs", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  contactId: integer("contact_id").references(() => contacts.id),
  email: text("email").notNull(),
  templateKey: text("template_key").notNull(),
  campaignId: text("campaign_id"),
  status: text("status").notNull().default("sent"),
  eventType: text("event_type").notNull(),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMailchimpEmailLogSchema = createInsertSchema(mailchimpEmailLogs).omit({ id: true, createdAt: true });
export type InsertMailchimpEmailLog = z.infer<typeof insertMailchimpEmailLogSchema>;
export type MailchimpEmailLog = typeof mailchimpEmailLogs.$inferSelect;

export const mailchimpSyncLogs = pgTable("mailchimp_sync_logs", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  contactId: integer("contact_id").references(() => contacts.id),
  action: text("action").notNull(),
  status: text("status").notNull().default("success"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMailchimpSyncLogSchema = createInsertSchema(mailchimpSyncLogs).omit({ id: true, createdAt: true });
export type InsertMailchimpSyncLog = z.infer<typeof insertMailchimpSyncLogSchema>;
export type MailchimpSyncLog = typeof mailchimpSyncLogs.$inferSelect;

// ==========================================
// STANDALONE DIGITAL BUSINESS CARD PRODUCT
// ==========================================

export const standaloneCardUsers = pgTable("standalone_card_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const standaloneCards = pgTable("standalone_cards", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => standaloneCardUsers.id).notNull(),
  slug: text("slug").notNull(),
  fullName: text("full_name").notNull(),
  businessName: text("business_name"),
  title: text("title"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  address: text("address"),
  bio: text("bio"),
  profileImageUrl: text("profile_image_url"),
  logoUrl: text("logo_url"),
  reviewLink: text("review_link"),
  bookingLink: text("booking_link"),
  instagramUrl: text("instagram_url"),
  facebookUrl: text("facebook_url"),
  tiktokUrl: text("tiktok_url"),
  linkedinUrl: text("linkedin_url"),
  youtubeUrl: text("youtube_url"),
  customLinks: jsonb("custom_links"),
  themeColor: text("theme_color").default("#0ea5e9"),
  cardTheme: text("card_theme").default("executive-dark"),
  tier: text("tier").default("base").notNull(),
  cardLayout: text("card_layout").default("default"),
  removeApexBranding: boolean("remove_apex_branding").default(false),
  premiumSupportFlag: boolean("premium_support_flag").default(false),
  published: boolean("published").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const standaloneOrders = pgTable("standalone_orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => standaloneCardUsers.id).notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  amount: integer("amount").notNull(),
  paymentStatus: text("payment_status").default("pending").notNull(),
  referralCodeUsed: text("referral_code_used"),
  premiumBump: boolean("premium_bump").default(false),
  proBundlePurchased: boolean("pro_bundle_purchased").default(false),
  upsellSessionId: text("upsell_session_id"),
  upsellPaidAt: timestamp("upsell_paid_at"),
  fulfillmentStatus: text("fulfillment_status").default("fulfilled").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const standaloneReferralCodes = pgTable("standalone_referral_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => standaloneCardUsers.id).notNull(),
  code: text("code").notNull(),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const standaloneReferrals = pgTable("standalone_referrals", {
  id: serial("id").primaryKey(),
  referrerUserId: integer("referrer_user_id").references(() => standaloneCardUsers.id).notNull(),
  referredUserId: integer("referred_user_id").references(() => standaloneCardUsers.id).notNull(),
  referredOrderId: integer("referred_order_id").references(() => standaloneOrders.id).notNull(),
  commissionAmount: integer("commission_amount").notNull().default(1000),
  status: text("status").default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  paidAt: timestamp("paid_at"),
});

export const insertStandaloneCardUserSchema = createInsertSchema(standaloneCardUsers).omit({ id: true, createdAt: true });
export type InsertStandaloneCardUser = z.infer<typeof insertStandaloneCardUserSchema>;
export type StandaloneCardUser = typeof standaloneCardUsers.$inferSelect;

export const insertStandaloneCardSchema = createInsertSchema(standaloneCards).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStandaloneCard = z.infer<typeof insertStandaloneCardSchema>;
export type StandaloneCard = typeof standaloneCards.$inferSelect;

export const insertStandaloneOrderSchema = createInsertSchema(standaloneOrders).omit({ id: true, createdAt: true });
export type InsertStandaloneOrder = z.infer<typeof insertStandaloneOrderSchema>;
export type StandaloneOrder = typeof standaloneOrders.$inferSelect;

export const insertStandaloneReferralCodeSchema = createInsertSchema(standaloneReferralCodes).omit({ id: true, createdAt: true });
export type InsertStandaloneReferralCode = z.infer<typeof insertStandaloneReferralCodeSchema>;
export type StandaloneReferralCode = typeof standaloneReferralCodes.$inferSelect;

export const insertStandaloneReferralSchema = createInsertSchema(standaloneReferrals).omit({ id: true, createdAt: true, paidAt: true });
export type InsertStandaloneReferral = z.infer<typeof insertStandaloneReferralSchema>;
export type StandaloneReferral = typeof standaloneReferrals.$inferSelect;

export const standalonePageViews = pgTable("standalone_page_views", {
  id: serial("id").primaryKey(),
  page: text("page").notNull(),
  referralCode: text("referral_code"),
  userAgent: text("user_agent"),
  ipHash: text("ip_hash"),
  sessionId: text("session_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_spv_page_created").on(table.page, table.createdAt),
  index("idx_spv_session").on(table.sessionId),
]);

export const insertStandalonePageViewSchema = createInsertSchema(standalonePageViews).omit({ id: true, createdAt: true });
export type InsertStandalonePageView = z.infer<typeof insertStandalonePageViewSchema>;
export type StandalonePageView = typeof standalonePageViews.$inferSelect;

export const PLAN_LIMITS: Record<string, Record<string, number>> = {
  starter: {
    messages_per_month: 500,
    automations: 5,
    contacts: 1000,
    ai_requests: 100,
    voice_minutes: 30,
    integrations: 3,
  },
  pro: {
    messages_per_month: 5000,
    automations: 50,
    contacts: 10000,
    ai_requests: 1000,
    voice_minutes: 300,
    integrations: 10,
  },
  enterprise: {
    messages_per_month: 50000,
    automations: 500,
    contacts: 100000,
    ai_requests: 10000,
    voice_minutes: 3000,
    integrations: 50,
  },
};

export const socialAccounts = pgTable("social_accounts", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  platform: text("platform").notNull(),
  platformAccountId: text("platform_account_id").notNull(),
  username: text("username"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  tokenExpiresAt: timestamp("token_expires_at"),
  scopes: text("scopes"),
  meta: jsonb("meta"),
  status: text("status").default("active").notNull(),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type SocialAccount = typeof socialAccounts.$inferSelect;

export const contentPosts = pgTable("content_posts", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  title: text("title"),
  caption: text("caption"),
  hashtags: text("hashtags"),
  callToAction: text("call_to_action"),
  firstComment: text("first_comment"),
  contentType: text("content_type"),
  status: text("status").default("draft").notNull(),
  approvalStatus: text("approval_status").default("not_required").notNull(),
  scheduledAt: timestamp("scheduled_at"),
  publishedAt: timestamp("published_at"),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ContentPost = typeof contentPosts.$inferSelect;

export const contentPostPlatforms = pgTable("content_post_platforms", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").references(() => contentPosts.id, { onDelete: "cascade" }).notNull(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  platform: text("platform").notNull(),
  socialAccountId: integer("social_account_id").references(() => socialAccounts.id, { onDelete: "set null" }),
  platformStatus: text("platform_status").default("draft").notNull(),
  externalPostId: text("external_post_id"),
  publishedAt: timestamp("published_at"),
  errorMessage: text("error_message"),
});
export type ContentPostPlatform = typeof contentPostPlatforms.$inferSelect;

export const contentMedia = pgTable("content_media", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  postId: integer("post_id").references(() => contentPosts.id, { onDelete: "set null" }),
  fileUrl: text("file_url").notNull(),
  fileKey: text("file_key"),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  sortOrder: integer("sort_order").default(0).notNull(),
  altText: text("alt_text"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ContentMediaItem = typeof contentMedia.$inferSelect;

export const contentCalendarLabels = pgTable("content_calendar_labels", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  color: text("color").default("#6366f1"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ContentCalendarLabel = typeof contentCalendarLabels.$inferSelect;

export const contentApprovals = pgTable("content_approvals", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").references(() => contentPosts.id, { onDelete: "cascade" }).notNull(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  requestedBy: text("requested_by"),
  decision: text("decision"),
  notes: text("notes"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ContentApproval = typeof contentApprovals.$inferSelect;

export const contentPublishingJobs = pgTable("content_publishing_jobs", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  postId: integer("post_id").references(() => contentPosts.id, { onDelete: "cascade" }).notNull(),
  platform: text("platform").notNull(),
  socialAccountId: integer("social_account_id").references(() => socialAccounts.id, { onDelete: "set null" }),
  status: text("status").default("queued").notNull(),
  trigger: text("trigger").default("manual").notNull(),
  externalPostId: text("external_post_id"),
  result: jsonb("result"),
  errorMessage: text("error_message"),
  attemptCount: integer("attempt_count").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(5).notNull(),
  scheduledAtUtc: timestamp("scheduled_at_utc"),
  lockOwner: text("lock_owner"),
  lockExpiresAt: timestamp("lock_expires_at"),
  nextRetryAt: timestamp("next_retry_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ContentPublishingJob = typeof contentPublishingJobs.$inferSelect;

export const commentAutoReplies = pgTable("comment_auto_replies", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  platform: text("platform").notNull(),
  postId: text("post_id").notNull(),
  commentId: text("comment_id").notNull(),
  commentText: text("comment_text").notNull(),
  commenterName: text("commenter_name"),
  commenterId: text("commenter_id"),
  replyText: text("reply_text"),
  replyId: text("reply_id"),
  status: text("status").default("pending").notNull(),
  sentiment: text("sentiment"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  repliedAt: timestamp("replied_at"),
});
export type CommentAutoReply = typeof commentAutoReplies.$inferSelect;

// ---- Shared Intelligence Layer (Super Brain) ----

export const sharedInsights = pgTable("shared_insights", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  sourceAccountId: integer("source_account_id").references(() => subAccounts.id),
  confidenceScore: real("confidence_score").default(0.7).notNull(),
  decayRate: real("decay_rate").default(0.005).notNull(),
  occurrenceCount: integer("occurrence_count").default(1).notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  isArchived: boolean("is_archived").default(false).notNull(),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_shared_insights_category").on(table.category),
  index("idx_shared_insights_hash").on(table.contentHash),
  index("idx_shared_insights_active").on(table.isArchived, table.confidenceScore),
]);

export const insertSharedInsightSchema = createInsertSchema(sharedInsights).omit({ id: true, createdAt: true });
export type InsertSharedInsight = z.infer<typeof insertSharedInsightSchema>;
export type SharedInsight = typeof sharedInsights.$inferSelect;

export const contentLibrary = pgTable("content_library", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(),
  title: text("title"),
  body: text("body"),
  tags: text("tags").array(),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ContentLibraryItem = typeof contentLibrary.$inferSelect;

export const styleEmbeddings = pgTable("style_embeddings", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  messageId: integer("message_id"),
  contextText: text("context_text").notNull(),
  replyText: text("reply_text").notNull(),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_style_emb_unique").on(table.subAccountId, table.messageId),
]);
export type StyleEmbedding = typeof styleEmbeddings.$inferSelect;

export const metaMessagingBillingEvents = pgTable("meta_messaging_billing_events", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  eventType: text("event_type").notNull(),
  messageId: integer("message_id"),
  channel: text("channel").notNull(),
  messageCount: integer("message_count").default(1).notNull(),
  tokenCount: integer("token_count").default(0).notNull(),
  unitCostMessage: real("unit_cost_message").default(0).notNull(),
  unitCostToken: real("unit_cost_token").default(0).notNull(),
  totalCost: real("total_cost").default(0).notNull(),
  invoiceId: text("invoice_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMetaMessagingBillingEventSchema = createInsertSchema(metaMessagingBillingEvents).omit({ id: true, createdAt: true });
export type InsertMetaMessagingBillingEvent = z.infer<typeof insertMetaMessagingBillingEventSchema>;
export type MetaMessagingBillingEvent = typeof metaMessagingBillingEvents.$inferSelect;

export const metaMessagingAnalyticsAggregates = pgTable("meta_messaging_analytics_aggregates", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  periodDate: timestamp("period_date").notNull(),
  channel: text("channel").notNull(),
  inboundCount: integer("inbound_count").default(0).notNull(),
  outboundCount: integer("outbound_count").default(0).notNull(),
  failedCount: integer("failed_count").default(0).notNull(),
  avgResponseTimeMs: real("avg_response_time_ms"),
  commentCount: integer("comment_count").default(0).notNull(),
  commentReplyCount: integer("comment_reply_count").default(0).notNull(),
  tokenUsage: integer("token_usage").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMetaMessagingAnalyticsAggregateSchema = createInsertSchema(metaMessagingAnalyticsAggregates).omit({ id: true, createdAt: true });
export type InsertMetaMessagingAnalyticsAggregate = z.infer<typeof insertMetaMessagingAnalyticsAggregateSchema>;
export type MetaMessagingAnalyticsAggregate = typeof metaMessagingAnalyticsAggregates.$inferSelect;

// ---- Agent Worker Job Queue ----

export const agentWorkerJobs = pgTable("agent_worker_jobs", {
  id: serial("id").primaryKey(),
  jobType: text("job_type").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").default("pending").notNull(),
  createdBy: text("created_by").notNull(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id),
  result: jsonb("result"),
  error: text("error"),
  attempts: integer("attempts").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(3).notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAgentWorkerJobSchema = createInsertSchema(agentWorkerJobs).omit({ id: true, createdAt: true });
export type InsertAgentWorkerJob = z.infer<typeof insertAgentWorkerJobSchema>;
export type AgentWorkerJob = typeof agentWorkerJobs.$inferSelect;

export const agentWorkerLogs = pgTable("agent_worker_logs", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").references(() => agentWorkerJobs.id, { onDelete: "cascade" }).notNull(),
  level: text("level").default("info").notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAgentWorkerLogSchema = createInsertSchema(agentWorkerLogs).omit({ id: true, createdAt: true });
export type InsertAgentWorkerLog = z.infer<typeof insertAgentWorkerLogSchema>;
export type AgentWorkerLog = typeof agentWorkerLogs.$inferSelect;

export const ownerUnlocks = pgTable("owner_unlocks", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  token: text("token").notNull(),
  purpose: text("purpose").notNull(),
  createdBy: text("created_by").notNull(),
  used: boolean("used").default(false).notNull(),
  usedAt: timestamp("used_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertOwnerUnlockSchema = createInsertSchema(ownerUnlocks).omit({ id: true, createdAt: true });
export type InsertOwnerUnlock = z.infer<typeof insertOwnerUnlockSchema>;
export type OwnerUnlock = typeof ownerUnlocks.$inferSelect;

export const cbSessions = pgTable("cb_sessions", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  totalTokens: integer("total_tokens").default(0),
  goalCount: integer("goal_count").default(0),
  tipCount: integer("tip_count").default(0),
  topTipper: text("top_tipper"),
  topTipAmount: integer("top_tip_amount").default(0),
  durationMs: integer("duration_ms"),
  peakViewers: integer("peak_viewers"),
  commandsFired: integer("commands_fired").default(0),
  topCommand: text("top_command"),
  sessionDate: timestamp("session_date").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCbSessionSchema = createInsertSchema(cbSessions).omit({ id: true, createdAt: true });
export type InsertCbSession = z.infer<typeof insertCbSessionSchema>;
export type CbSession = typeof cbSessions.$inferSelect;

export const cbCommandsFired = pgTable("cb_commands_fired", {
  id: serial("id").primaryKey(),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  sessionId: integer("session_id").references(() => cbSessions.id, { onDelete: "set null" }),
  category: text("category").notNull(),
  messageText: text("message_text"),
  firedAt: timestamp("fired_at").defaultNow(),
  tokensAfter: integer("tokens_after"),
  wasEffective: boolean("was_effective"),
});

export const insertCbCommandFiredSchema = createInsertSchema(cbCommandsFired).omit({ id: true });
export type InsertCbCommandFired = z.infer<typeof insertCbCommandFiredSchema>;
export type CbCommandFired = typeof cbCommandsFired.$inferSelect;

export const universalEvents = pgTable("universal_events", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  sourceModule: text("source_module").notNull(),
  sourceTable: text("source_table"),
  sourceRecordId: text("source_record_id"),
  accountId: integer("account_id").references(() => subAccounts.id, { onDelete: "cascade" }),
  subAccountId: integer("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  contactId: integer("contact_id"),
  anonymousSessionId: text("anonymous_session_id"),
  siteId: integer("site_id"),
  domainId: integer("domain_id"),
  cardId: integer("card_id"),
  campaignId: integer("campaign_id"),
  workflowId: integer("workflow_id"),
  metadata: jsonb("metadata"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  eventTypeIdx: index("ue_event_type_idx").on(table.eventType),
  accountIdx: index("ue_account_idx").on(table.accountId),
  subAccountIdx: index("ue_sub_account_idx").on(table.subAccountId),
  contactIdx: index("ue_contact_idx").on(table.contactId),
  occurredIdx: index("ue_occurred_idx").on(table.occurredAt),
}));

export const insertUniversalEventSchema = createInsertSchema(universalEvents).omit({ id: true, createdAt: true });
export type InsertUniversalEvent = z.infer<typeof insertUniversalEventSchema>;
export type UniversalEvent = typeof universalEvents.$inferSelect;

export const entityIdentityMap = pgTable("entity_identity_map", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  linkedEntityType: text("linked_entity_type").notNull(),
  linkedEntityId: text("linked_entity_id").notNull(),
  confidenceScore: real("confidence_score").default(1.0),
  matchReason: text("match_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  entityLookup: index("eim_entity_lookup").on(table.accountId, table.entityType, table.entityId),
  linkedLookup: index("eim_linked_lookup").on(table.accountId, table.linkedEntityType, table.linkedEntityId),
}));

export const insertEntityIdentityMapSchema = createInsertSchema(entityIdentityMap).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEntityIdentityMap = z.infer<typeof insertEntityIdentityMapSchema>;
export type EntityIdentityMap = typeof entityIdentityMap.$inferSelect;

export const entityActivityRollups = pgTable("entity_activity_rollups", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  metricName: text("metric_name").notNull(),
  metricValue: real("metric_value").default(0).notNull(),
  periodType: text("period_type").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  rollupLookup: index("ear_lookup").on(table.accountId, table.entityType, table.entityId, table.metricName),
  periodIdx: index("ear_period_idx").on(table.periodType, table.periodStart),
}));

export const insertEntityActivityRollupSchema = createInsertSchema(entityActivityRollups).omit({ id: true, updatedAt: true });
export type InsertEntityActivityRollup = z.infer<typeof insertEntityActivityRollupSchema>;
export type EntityActivityRollup = typeof entityActivityRollups.$inferSelect;

export const intelligenceScores = pgTable("intelligence_scores", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  scoreType: text("score_type").notNull(),
  scoreValue: real("score_value").notNull(),
  scoreBand: text("score_band").notNull(),
  explanation: text("explanation"),
  inputs: jsonb("inputs"),
  calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  scoreLookup: index("is_lookup").on(table.accountId, table.entityType, table.entityId, table.scoreType),
  bandIdx: index("is_band_idx").on(table.scoreBand),
}));

export const insertIntelligenceScoreSchema = createInsertSchema(intelligenceScores).omit({ id: true, calculatedAt: true, updatedAt: true });
export type InsertIntelligenceScore = z.infer<typeof insertIntelligenceScoreSchema>;
export type IntelligenceScore = typeof intelligenceScores.$inferSelect;

export const intelligenceRecommendations = pgTable("intelligence_recommendations", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  recommendationType: text("recommendation_type").notNull(),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("pending"),
  title: text("title").notNull(),
  description: text("description"),
  whyThisExists: text("why_this_exists"),
  recommendedAction: jsonb("recommended_action"),
  sourceScoreId: integer("source_score_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => ({
  recLookup: index("ir_lookup").on(table.accountId, table.status, table.priority),
  entityIdx: index("ir_entity_idx").on(table.entityType, table.entityId),
}));

export const insertIntelligenceRecommendationSchema = createInsertSchema(intelligenceRecommendations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIntelligenceRecommendation = z.infer<typeof insertIntelligenceRecommendationSchema>;
export type IntelligenceRecommendation = typeof intelligenceRecommendations.$inferSelect;

export const integrationHealthState = pgTable("integration_health_state", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  integrationType: text("integration_type").notNull(),
  integrationKey: text("integration_key").notNull(),
  status: text("status").notNull().default("unknown"),
  lastSuccessAt: timestamp("last_success_at"),
  lastFailureAt: timestamp("last_failure_at"),
  failureReason: text("failure_reason"),
  healthScore: real("health_score").default(100),
  metadata: jsonb("metadata"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  healthLookup: index("ihs_lookup").on(table.accountId, table.integrationType, table.integrationKey),
}));

export const insertIntegrationHealthStateSchema = createInsertSchema(integrationHealthState).omit({ id: true, updatedAt: true });
export type InsertIntegrationHealthState = z.infer<typeof insertIntegrationHealthStateSchema>;
export type IntegrationHealthState = typeof integrationHealthState.$inferSelect;

export const executionTimeline = pgTable("execution_timeline", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").references(() => subAccounts.id, { onDelete: "cascade" }).notNull(),
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: text("related_entity_id"),
  title: text("title").notNull(),
  description: text("description"),
  sourceModule: text("source_module").notNull(),
  eventId: integer("event_id"),
  severity: text("severity").notNull().default("info"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  timelineLookup: index("et_lookup").on(table.accountId, table.createdAt),
  entityIdx: index("et_entity_idx").on(table.relatedEntityType, table.relatedEntityId),
}));

export const insertExecutionTimelineSchema = createInsertSchema(executionTimeline).omit({ id: true, createdAt: true });
export type InsertExecutionTimeline = z.infer<typeof insertExecutionTimelineSchema>;
export type ExecutionTimeline = typeof executionTimeline.$inferSelect;
