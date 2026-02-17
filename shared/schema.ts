import { pgTable, text, serial, integer, json, timestamp, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";

export const subAccounts = pgTable("sub_accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  twilioNumber: text("twilio_number").notNull(),
  googleReviewLink: text("google_review_link"),
  ownerPhone: text("owner_phone"),
  industry: text("industry"),
  config: json("config"),
  vibeTheme: text("vibe_theme").default("cyber-glass"),
  ownerUserId: text("owner_user_id"),
  parentSnapshotId: integer("parent_snapshot_id"),
  isFork: boolean("is_fork").default(false),
  language: text("language").default("en"),
  aiPromptConfig: json("ai_prompt_config"),
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
