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
