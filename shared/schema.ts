import { pgTable, text, serial, integer, json, timestamp, boolean, real } from "drizzle-orm/pg-core";
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
});

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

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
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSentinelConfigSchema = createInsertSchema(sentinelConfig).omit({ id: true, updatedAt: true });
export type InsertSentinelConfig = z.infer<typeof insertSentinelConfigSchema>;
export type SentinelConfig = typeof sentinelConfig.$inferSelect;

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
});

export const insertSentinelIncidentSchema = createInsertSchema(sentinelIncidents).omit({ id: true, detectedAt: true });
export type InsertSentinelIncident = z.infer<typeof insertSentinelIncidentSchema>;
export type SentinelIncident = typeof sentinelIncidents.$inferSelect;

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
  status: text("status").notNull().default("connected"),
  scrapedAt: timestamp("scraped_at"),
  trainingJobId: integer("training_job_id").references(() => trainingJobs.id),
  widgetEnabled: boolean("widget_enabled").default(false),
  widgetColor: text("widget_color").default("#6366f1"),
  widgetGreeting: text("widget_greeting").default("Hi there! How can I help you today?"),
  widgetPosition: text("widget_position").default("bottom-right"),
  botPersona: text("bot_persona"),
  pagesCrawled: integer("pages_crawled").default(0),
  lastCrawlStatus: text("last_crawl_status"),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertContactSchema = createInsertSchema(contacts).omit({ id: true, createdAt: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;

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
  subAccountId: integer("sub_account_id").references(() => subAccounts.id).notNull(),
  name: text("name").default(""),
  title: text("title").default(""),
  company: text("company").default(""),
  phone: text("phone").default(""),
  email: text("email").default(""),
  website: text("website").default(""),
  bio: text("bio").default(""),
  photoUrl: text("photo_url").default(""),
  googleReviewLink: text("google_review_link").default(""),
  slug: text("slug").unique(),
  links: json("links").default([]),
  theme: text("theme").default("midnight"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDigitalCardSchema = createInsertSchema(digitalCards).omit({ id: true, createdAt: true, updatedAt: true });
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
