import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "./db";
import {
  subAccounts, messages, workflows, trainingJobs, blueprints, savedSites, siteVersions, siteCollaborators, reviews, usageLogs, domains, owners,
  subscriptions, snapshots, snapshotVersions, affiliates, referrals, commissions, sentinelConfig, sentinelIncidents, propertyLeads, wholesalerConfig, clientWebsites, auditLogs,
  contacts, pipelineStages, deals, appointments, emailCampaigns, webhooks, whiteLabelSettings,
  metaAdCampaigns, metaLeads, instagramConversations, instagramMessages,
  type SubAccount, type InsertSubAccount,
  type Message, type InsertMessage,
  type Workflow, type InsertWorkflow,
  type TrainingJob, type InsertTrainingJob,
  type Blueprint, type InsertBlueprint,
  type SavedSite, type InsertSavedSite,
  type SiteVersion, type InsertSiteVersion,
  type SiteCollaborator, type InsertSiteCollaborator,
  type Review, type InsertReview,
  type UsageLog, type InsertUsageLog,
  type Domain, type InsertDomain,
  type Owner, type InsertOwner,
  type Subscription, type InsertSubscription,
  type Snapshot, type InsertSnapshot,
  type SnapshotVersion, type InsertSnapshotVersion,
  type Affiliate, type InsertAffiliate,
  type Referral, type InsertReferral,
  type Commission, type InsertCommission,
  type SentinelConfig, type InsertSentinelConfig,
  type SentinelIncident, type InsertSentinelIncident,
  type PropertyLead, type InsertPropertyLead,
  type WholesalerConfig, type InsertWholesalerConfig,
  type ClientWebsite, type InsertClientWebsite,
  type AuditLog, type InsertAuditLog,
  type Contact, type InsertContact,
  type PipelineStage, type InsertPipelineStage,
  type Deal, type InsertDeal,
  type Appointment, type InsertAppointment,
  type EmailCampaign, type InsertEmailCampaign,
  type Webhook, type InsertWebhook,
  type WhiteLabelSettings, type InsertWhiteLabelSettings,
  type MetaAdCampaign, type InsertMetaAdCampaign,
  type MetaLead, type InsertMetaLead,
  type InstagramConversation, type InsertInstagramConversation,
  type InstagramMessage, type InsertInstagramMessage,
} from "@shared/schema";

export interface IStorage {
  getSubAccounts(): Promise<SubAccount[]>;
  getSubAccount(id: number): Promise<SubAccount | undefined>;
  createSubAccount(data: InsertSubAccount): Promise<SubAccount>;
  updateSubAccount(id: number, data: Partial<InsertSubAccount>): Promise<SubAccount | undefined>;
  getSubAccountsByUser(userId: string): Promise<SubAccount[]>;

  getMessages(subAccountId: number): Promise<Message[]>;
  getMessage(id: number): Promise<Message | undefined>;
  createMessage(data: InsertMessage): Promise<Message>;

  getWorkflows(): Promise<Workflow[]>;
  getWorkflow(id: number): Promise<Workflow | undefined>;
  createWorkflow(data: InsertWorkflow): Promise<Workflow>;
  updateWorkflow(id: number, data: Partial<InsertWorkflow>): Promise<Workflow | undefined>;

  getTrainingJobs(): Promise<TrainingJob[]>;
  getTrainingJob(id: number): Promise<TrainingJob | undefined>;
  createTrainingJob(data: InsertTrainingJob): Promise<TrainingJob>;
  updateTrainingJob(id: number, data: Partial<TrainingJob>): Promise<TrainingJob | undefined>;

  getBlueprints(): Promise<Blueprint[]>;
  getBlueprint(id: number): Promise<Blueprint | undefined>;
  getBlueprintByIndustryId(industryId: string): Promise<Blueprint | undefined>;
  createBlueprint(data: InsertBlueprint): Promise<Blueprint>;

  getSavedSites(): Promise<SavedSite[]>;
  getSavedSite(id: number): Promise<SavedSite | undefined>;
  createSavedSite(data: InsertSavedSite): Promise<SavedSite>;
  updateSavedSite(id: number, data: Partial<InsertSavedSite>): Promise<SavedSite | undefined>;
  deleteSavedSite(id: number): Promise<boolean>;

  getSiteVersions(siteId: number): Promise<SiteVersion[]>;
  createSiteVersion(data: InsertSiteVersion): Promise<SiteVersion>;

  getSiteCollaborators(siteId: number): Promise<SiteCollaborator[]>;
  createSiteCollaborator(data: InsertSiteCollaborator): Promise<SiteCollaborator>;
  deleteSiteCollaborator(id: number): Promise<boolean>;
  findCollaboratorByInviteCode(code: string): Promise<SiteCollaborator | undefined>;

  getReviews(subAccountId: number): Promise<Review[]>;
  getReview(id: number): Promise<Review | undefined>;
  createReview(data: InsertReview): Promise<Review>;
  updateReview(id: number, data: Partial<InsertReview>): Promise<Review | undefined>;

  getUsageLogs(subAccountId: number): Promise<UsageLog[]>;
  createUsageLog(data: InsertUsageLog): Promise<UsageLog>;
  getUsageLogsSummary(subAccountId: number): Promise<{type: string, totalAmount: number, totalCost: number, count: number}[]>;

  getDomains(subAccountId: number): Promise<Domain[]>;
  getDomain(id: number): Promise<Domain | undefined>;
  getDomainByName(name: string): Promise<Domain | undefined>;
  createDomain(data: InsertDomain): Promise<Domain>;
  updateDomain(id: number, data: Partial<InsertDomain>): Promise<Domain | undefined>;

  getOwnerByEmail(email: string): Promise<Owner | undefined>;
  createOwner(data: InsertOwner): Promise<Owner>;

  getSubscription(userId: string): Promise<Subscription | undefined>;
  createSubscription(data: InsertSubscription): Promise<Subscription>;
  updateSubscription(id: number, data: Partial<InsertSubscription>): Promise<Subscription | undefined>;
  getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<Subscription | undefined>;

  getSnapshots(): Promise<Snapshot[]>;
  getPublicSnapshots(): Promise<Snapshot[]>;
  getSnapshot(id: number): Promise<Snapshot | undefined>;
  getSnapshotsByCreator(creatorId: string): Promise<Snapshot[]>;
  createSnapshot(data: InsertSnapshot): Promise<Snapshot>;
  updateSnapshot(id: number, data: Partial<InsertSnapshot>): Promise<Snapshot | undefined>;

  getSnapshotVersions(subAccountId: number): Promise<SnapshotVersion[]>;
  getSnapshotVersion(id: number): Promise<SnapshotVersion | undefined>;
  createSnapshotVersion(data: InsertSnapshotVersion): Promise<SnapshotVersion>;

  getAffiliate(userId: string): Promise<Affiliate | undefined>;
  getAffiliateByCode(code: string): Promise<Affiliate | undefined>;
  createAffiliate(data: InsertAffiliate): Promise<Affiliate>;
  updateAffiliate(id: number, data: Partial<InsertAffiliate>): Promise<Affiliate | undefined>;

  getReferrals(affiliateId: number): Promise<Referral[]>;
  createReferral(data: InsertReferral): Promise<Referral>;

  getCommissions(affiliateId: number): Promise<Commission[]>;
  createCommission(data: InsertCommission): Promise<Commission>;

  getSentinelConfig(subAccountId: number): Promise<SentinelConfig | undefined>;
  upsertSentinelConfig(data: InsertSentinelConfig): Promise<SentinelConfig>;

  getSentinelIncidents(subAccountId: number): Promise<SentinelIncident[]>;
  getSentinelIncident(id: number): Promise<SentinelIncident | undefined>;
  createSentinelIncident(data: InsertSentinelIncident): Promise<SentinelIncident>;
  updateSentinelIncident(id: number, data: Partial<InsertSentinelIncident>): Promise<SentinelIncident | undefined>;
  getSentinelIncidentByHash(subAccountId: number, hash: string): Promise<SentinelIncident | undefined>;

  getPropertyLeads(subAccountId: number): Promise<PropertyLead[]>;
  getPropertyLead(id: number): Promise<PropertyLead | undefined>;
  createPropertyLead(data: InsertPropertyLead): Promise<PropertyLead>;
  updatePropertyLead(id: number, data: Partial<InsertPropertyLead>): Promise<PropertyLead | undefined>;
  getPropertyLeadByHash(subAccountId: number, hash: string): Promise<PropertyLead | undefined>;

  getWholesalerConfig(subAccountId: number): Promise<WholesalerConfig | undefined>;
  upsertWholesalerConfig(data: InsertWholesalerConfig): Promise<WholesalerConfig>;

  getClientWebsites(subAccountId: number): Promise<ClientWebsite[]>;
  getClientWebsite(id: number): Promise<ClientWebsite | undefined>;
  createClientWebsite(data: InsertClientWebsite): Promise<ClientWebsite>;
  updateClientWebsite(id: number, data: Partial<InsertClientWebsite>): Promise<ClientWebsite | undefined>;
  deleteClientWebsite(id: number): Promise<boolean>;

  createAuditLog(data: InsertAuditLog): Promise<AuditLog>;

  getContacts(subAccountId: number): Promise<Contact[]>;
  getContactById(id: number): Promise<Contact | undefined>;
  createContact(data: InsertContact): Promise<Contact>;
  updateContact(id: number, data: Partial<InsertContact>): Promise<Contact | undefined>;
  deleteContact(id: number): Promise<boolean>;

  getPipelineStages(subAccountId: number): Promise<PipelineStage[]>;
  createPipelineStage(data: InsertPipelineStage): Promise<PipelineStage>;
  updatePipelineStage(id: number, data: Partial<InsertPipelineStage>): Promise<PipelineStage | undefined>;
  deletePipelineStage(id: number): Promise<boolean>;

  getDeals(subAccountId: number): Promise<Deal[]>;
  getDealById(id: number): Promise<Deal | undefined>;
  createDeal(data: InsertDeal): Promise<Deal>;
  updateDeal(id: number, data: Partial<InsertDeal>): Promise<Deal | undefined>;
  deleteDeal(id: number): Promise<boolean>;

  getAppointments(subAccountId: number): Promise<Appointment[]>;
  getAppointmentById(id: number): Promise<Appointment | undefined>;
  createAppointment(data: InsertAppointment): Promise<Appointment>;
  updateAppointment(id: number, data: Partial<InsertAppointment>): Promise<Appointment | undefined>;
  deleteAppointment(id: number): Promise<boolean>;

  getEmailCampaigns(subAccountId: number): Promise<EmailCampaign[]>;
  getEmailCampaignById(id: number): Promise<EmailCampaign | undefined>;
  createEmailCampaign(data: InsertEmailCampaign): Promise<EmailCampaign>;
  updateEmailCampaign(id: number, data: Partial<InsertEmailCampaign>): Promise<EmailCampaign | undefined>;
  deleteEmailCampaign(id: number): Promise<boolean>;

  getWebhooks(subAccountId: number): Promise<Webhook[]>;
  getWebhookById(id: number): Promise<Webhook | undefined>;
  createWebhook(data: InsertWebhook): Promise<Webhook>;
  updateWebhook(id: number, data: Partial<InsertWebhook>): Promise<Webhook | undefined>;
  deleteWebhook(id: number): Promise<boolean>;

  getWhiteLabelSettings(userId: string): Promise<WhiteLabelSettings | undefined>;
  upsertWhiteLabelSettings(data: InsertWhiteLabelSettings): Promise<WhiteLabelSettings>;

  getMetaAdCampaigns(subAccountId: number): Promise<MetaAdCampaign[]>;
  getMetaAdCampaign(id: number): Promise<MetaAdCampaign | undefined>;
  createMetaAdCampaign(data: InsertMetaAdCampaign): Promise<MetaAdCampaign>;
  updateMetaAdCampaign(id: number, data: Partial<InsertMetaAdCampaign>): Promise<MetaAdCampaign | undefined>;
  deleteMetaAdCampaign(id: number): Promise<boolean>;

  getMetaLeads(subAccountId: number): Promise<MetaLead[]>;
  getMetaLead(id: number): Promise<MetaLead | undefined>;
  createMetaLead(data: InsertMetaLead): Promise<MetaLead>;
  updateMetaLead(id: number, data: Partial<InsertMetaLead>): Promise<MetaLead | undefined>;

  getInstagramConversations(subAccountId: number): Promise<InstagramConversation[]>;
  getInstagramConversation(id: number): Promise<InstagramConversation | undefined>;
  createInstagramConversation(data: InsertInstagramConversation): Promise<InstagramConversation>;
  updateInstagramConversation(id: number, data: Partial<InsertInstagramConversation>): Promise<InstagramConversation | undefined>;

  getInstagramMessages(conversationId: number): Promise<InstagramMessage[]>;
  createInstagramMessage(data: InsertInstagramMessage): Promise<InstagramMessage>;
}

export class DatabaseStorage implements IStorage {
  async getSubAccounts() {
    return db.select().from(subAccounts);
  }

  async getSubAccount(id: number) {
    const [row] = await db.select().from(subAccounts).where(eq(subAccounts.id, id));
    return row;
  }

  async createSubAccount(data: InsertSubAccount) {
    const [row] = await db.insert(subAccounts).values(data).returning();
    return row;
  }

  async updateSubAccount(id: number, data: Partial<InsertSubAccount>) {
    const [row] = await db.update(subAccounts).set(data).where(eq(subAccounts.id, id)).returning();
    return row;
  }

  async getSubAccountsByUser(userId: string) {
    return db.select().from(subAccounts).where(eq(subAccounts.ownerUserId, userId));
  }

  async getMessages(subAccountId: number) {
    return db.select().from(messages).where(eq(messages.subAccountId, subAccountId));
  }

  async getMessage(id: number) {
    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    return row;
  }

  async createMessage(data: InsertMessage) {
    const [row] = await db.insert(messages).values(data).returning();
    return row;
  }

  async getWorkflows() {
    return db.select().from(workflows);
  }

  async getWorkflow(id: number) {
    const [row] = await db.select().from(workflows).where(eq(workflows.id, id));
    return row;
  }

  async createWorkflow(data: InsertWorkflow) {
    const [row] = await db.insert(workflows).values(data).returning();
    return row;
  }

  async updateWorkflow(id: number, data: Partial<InsertWorkflow>) {
    const [row] = await db.update(workflows).set(data).where(eq(workflows.id, id)).returning();
    return row;
  }

  async getTrainingJobs() {
    return db.select().from(trainingJobs);
  }

  async getTrainingJob(id: number) {
    const [row] = await db.select().from(trainingJobs).where(eq(trainingJobs.id, id));
    return row;
  }

  async createTrainingJob(data: InsertTrainingJob) {
    const [row] = await db.insert(trainingJobs).values(data).returning();
    return row;
  }

  async updateTrainingJob(id: number, data: Partial<TrainingJob>) {
    const [row] = await db.update(trainingJobs).set(data).where(eq(trainingJobs.id, id)).returning();
    return row;
  }

  async getBlueprints() {
    return db.select().from(blueprints);
  }

  async getBlueprint(id: number) {
    const [row] = await db.select().from(blueprints).where(eq(blueprints.id, id));
    return row;
  }

  async getBlueprintByIndustryId(industryId: string) {
    const [row] = await db.select().from(blueprints).where(eq(blueprints.industryId, industryId));
    return row;
  }

  async createBlueprint(data: InsertBlueprint) {
    const [row] = await db.insert(blueprints).values(data).returning();
    return row;
  }

  async getSavedSites() {
    return db.select().from(savedSites).orderBy(desc(savedSites.createdAt));
  }

  async getSavedSite(id: number) {
    const [row] = await db.select().from(savedSites).where(eq(savedSites.id, id));
    return row;
  }

  async createSavedSite(data: InsertSavedSite) {
    const [row] = await db.insert(savedSites).values(data).returning();
    return row;
  }

  async updateSavedSite(id: number, data: Partial<InsertSavedSite>) {
    const [row] = await db.update(savedSites).set(data).where(eq(savedSites.id, id)).returning();
    return row;
  }

  async deleteSavedSite(id: number) {
    await db.delete(siteVersions).where(eq(siteVersions.siteId, id));
    await db.delete(siteCollaborators).where(eq(siteCollaborators.siteId, id));
    const rows = await db.delete(savedSites).where(eq(savedSites.id, id)).returning();
    return rows.length > 0;
  }

  async getSiteVersions(siteId: number) {
    return db.select().from(siteVersions).where(eq(siteVersions.siteId, siteId)).orderBy(desc(siteVersions.createdAt));
  }

  async createSiteVersion(data: InsertSiteVersion) {
    const [row] = await db.insert(siteVersions).values(data).returning();
    return row;
  }

  async getSiteCollaborators(siteId: number) {
    return db.select().from(siteCollaborators).where(eq(siteCollaborators.siteId, siteId));
  }

  async createSiteCollaborator(data: InsertSiteCollaborator) {
    const [row] = await db.insert(siteCollaborators).values(data).returning();
    return row;
  }

  async deleteSiteCollaborator(id: number) {
    const rows = await db.delete(siteCollaborators).where(eq(siteCollaborators.id, id)).returning();
    return rows.length > 0;
  }

  async findCollaboratorByInviteCode(code: string) {
    const [row] = await db.select().from(siteCollaborators).where(eq(siteCollaborators.inviteCode, code));
    return row;
  }

  async getReviews(subAccountId: number) {
    return db.select().from(reviews).where(eq(reviews.subAccountId, subAccountId)).orderBy(desc(reviews.createdAt));
  }

  async getReview(id: number) {
    const [row] = await db.select().from(reviews).where(eq(reviews.id, id));
    return row;
  }

  async createReview(data: InsertReview) {
    const [row] = await db.insert(reviews).values(data).returning();
    return row;
  }

  async updateReview(id: number, data: Partial<InsertReview>) {
    const [row] = await db.update(reviews).set(data).where(eq(reviews.id, id)).returning();
    return row;
  }

  async getUsageLogs(subAccountId: number) {
    return db.select().from(usageLogs).where(eq(usageLogs.subAccountId, subAccountId)).orderBy(desc(usageLogs.createdAt));
  }

  async createUsageLog(data: InsertUsageLog) {
    const [row] = await db.insert(usageLogs).values(data).returning();
    return row;
  }

  async getUsageLogsSummary(subAccountId: number) {
    const result = await db.select({
      type: usageLogs.type,
      totalAmount: sql<number>`sum(${usageLogs.amount})`.as('total_amount'),
      totalCost: sql<number>`sum(${usageLogs.cost})`.as('total_cost'),
      count: sql<number>`count(*)::int`.as('count'),
    }).from(usageLogs).where(eq(usageLogs.subAccountId, subAccountId)).groupBy(usageLogs.type);
    return result;
  }

  async getDomains(subAccountId: number) {
    return db.select().from(domains).where(eq(domains.subAccountId, subAccountId)).orderBy(desc(domains.createdAt));
  }

  async getDomain(id: number) {
    const [row] = await db.select().from(domains).where(eq(domains.id, id));
    return row;
  }

  async getDomainByName(name: string) {
    const [row] = await db.select().from(domains).where(eq(domains.domainName, name));
    return row;
  }

  async createDomain(data: InsertDomain) {
    const [row] = await db.insert(domains).values(data).returning();
    return row;
  }

  async updateDomain(id: number, data: Partial<InsertDomain>) {
    const [row] = await db.update(domains).set(data).where(eq(domains.id, id)).returning();
    return row;
  }

  async getOwnerByEmail(email: string) {
    const [row] = await db.select().from(owners).where(eq(owners.email, email));
    return row;
  }

  async createOwner(data: InsertOwner) {
    const [row] = await db.insert(owners).values(data).returning();
    return row;
  }

  async getSubscription(userId: string) {
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    return row;
  }

  async createSubscription(data: InsertSubscription) {
    const [row] = await db.insert(subscriptions).values(data).returning();
    return row;
  }

  async updateSubscription(id: number, data: Partial<InsertSubscription>) {
    const [row] = await db.update(subscriptions).set(data).where(eq(subscriptions.id, id)).returning();
    return row;
  }

  async getSubscriptionByStripeId(stripeSubscriptionId: string) {
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId));
    return row;
  }

  async getSnapshots() {
    return db.select().from(snapshots).orderBy(desc(snapshots.createdAt));
  }

  async getPublicSnapshots() {
    return db.select().from(snapshots).where(eq(snapshots.isPublic, true)).orderBy(desc(snapshots.downloads));
  }

  async getSnapshot(id: number) {
    const [row] = await db.select().from(snapshots).where(eq(snapshots.id, id));
    return row;
  }

  async getSnapshotsByCreator(creatorId: string) {
    return db.select().from(snapshots).where(eq(snapshots.creatorId, creatorId)).orderBy(desc(snapshots.createdAt));
  }

  async createSnapshot(data: InsertSnapshot) {
    const [row] = await db.insert(snapshots).values(data).returning();
    return row;
  }

  async updateSnapshot(id: number, data: Partial<InsertSnapshot>) {
    const [row] = await db.update(snapshots).set(data).where(eq(snapshots.id, id)).returning();
    return row;
  }

  async getSnapshotVersions(subAccountId: number) {
    return db.select().from(snapshotVersions).where(eq(snapshotVersions.subAccountId, subAccountId)).orderBy(desc(snapshotVersions.createdAt));
  }

  async getSnapshotVersion(id: number) {
    const [row] = await db.select().from(snapshotVersions).where(eq(snapshotVersions.id, id));
    return row;
  }

  async createSnapshotVersion(data: InsertSnapshotVersion) {
    const [row] = await db.insert(snapshotVersions).values(data).returning();
    return row;
  }

  async getAffiliate(userId: string) {
    const [row] = await db.select().from(affiliates).where(eq(affiliates.userId, userId));
    return row;
  }

  async getAffiliateByCode(code: string) {
    const [row] = await db.select().from(affiliates).where(eq(affiliates.affiliateCode, code));
    return row;
  }

  async createAffiliate(data: InsertAffiliate) {
    const [row] = await db.insert(affiliates).values(data).returning();
    return row;
  }

  async updateAffiliate(id: number, data: Partial<InsertAffiliate>) {
    const [row] = await db.update(affiliates).set(data).where(eq(affiliates.id, id)).returning();
    return row;
  }

  async getReferrals(affiliateId: number) {
    return db.select().from(referrals).where(eq(referrals.affiliateId, affiliateId)).orderBy(desc(referrals.createdAt));
  }

  async createReferral(data: InsertReferral) {
    const [row] = await db.insert(referrals).values(data).returning();
    return row;
  }

  async getCommissions(affiliateId: number) {
    return db.select().from(commissions).where(eq(commissions.affiliateId, affiliateId)).orderBy(desc(commissions.createdAt));
  }

  async createCommission(data: InsertCommission) {
    const [row] = await db.insert(commissions).values(data).returning();
    return row;
  }

  async getSentinelConfig(subAccountId: number) {
    const [row] = await db.select().from(sentinelConfig).where(eq(sentinelConfig.subAccountId, subAccountId));
    return row;
  }

  async upsertSentinelConfig(data: InsertSentinelConfig) {
    const existing = await this.getSentinelConfig(data.subAccountId);
    if (existing) {
      const [row] = await db.update(sentinelConfig).set({ ...data, updatedAt: new Date() }).where(eq(sentinelConfig.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(sentinelConfig).values(data).returning();
    return row;
  }

  async getSentinelIncidents(subAccountId: number) {
    return db.select().from(sentinelIncidents).where(eq(sentinelIncidents.subAccountId, subAccountId)).orderBy(desc(sentinelIncidents.detectedAt));
  }

  async getSentinelIncident(id: number) {
    const [row] = await db.select().from(sentinelIncidents).where(eq(sentinelIncidents.id, id));
    return row;
  }

  async createSentinelIncident(data: InsertSentinelIncident) {
    const [row] = await db.insert(sentinelIncidents).values(data).returning();
    return row;
  }

  async updateSentinelIncident(id: number, data: Partial<InsertSentinelIncident>) {
    const [row] = await db.update(sentinelIncidents).set(data).where(eq(sentinelIncidents.id, id)).returning();
    return row;
  }

  async getSentinelIncidentByHash(subAccountId: number, hash: string) {
    const [row] = await db.select().from(sentinelIncidents).where(and(eq(sentinelIncidents.subAccountId, subAccountId), eq(sentinelIncidents.sourceHash, hash)));
    return row;
  }

  async getPropertyLeads(subAccountId: number) {
    return db.select().from(propertyLeads).where(eq(propertyLeads.subAccountId, subAccountId)).orderBy(desc(propertyLeads.createdAt));
  }

  async getPropertyLead(id: number) {
    const [row] = await db.select().from(propertyLeads).where(eq(propertyLeads.id, id));
    return row;
  }

  async createPropertyLead(data: InsertPropertyLead) {
    const [row] = await db.insert(propertyLeads).values(data).returning();
    return row;
  }

  async updatePropertyLead(id: number, data: Partial<InsertPropertyLead>) {
    const [row] = await db.update(propertyLeads).set(data).where(eq(propertyLeads.id, id)).returning();
    return row;
  }

  async getPropertyLeadByHash(subAccountId: number, hash: string) {
    const [row] = await db.select().from(propertyLeads).where(and(eq(propertyLeads.subAccountId, subAccountId), eq(propertyLeads.sourceHash, hash)));
    return row;
  }

  async getWholesalerConfig(subAccountId: number) {
    const [row] = await db.select().from(wholesalerConfig).where(eq(wholesalerConfig.subAccountId, subAccountId));
    return row;
  }

  async upsertWholesalerConfig(data: InsertWholesalerConfig) {
    const existing = await this.getWholesalerConfig(data.subAccountId);
    if (existing) {
      const [row] = await db.update(wholesalerConfig).set(data).where(eq(wholesalerConfig.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(wholesalerConfig).values(data).returning();
    return row;
  }

  async getClientWebsites(subAccountId: number) {
    return db.select().from(clientWebsites).where(eq(clientWebsites.subAccountId, subAccountId)).orderBy(desc(clientWebsites.createdAt));
  }

  async getClientWebsite(id: number) {
    const [row] = await db.select().from(clientWebsites).where(eq(clientWebsites.id, id));
    return row;
  }

  async createClientWebsite(data: InsertClientWebsite) {
    const [row] = await db.insert(clientWebsites).values(data).returning();
    return row;
  }

  async updateClientWebsite(id: number, data: Partial<InsertClientWebsite>) {
    const [row] = await db.update(clientWebsites).set(data).where(eq(clientWebsites.id, id)).returning();
    return row;
  }

  async deleteClientWebsite(id: number) {
    const result = await db.delete(clientWebsites).where(eq(clientWebsites.id, id));
    return true;
  }

  async createAuditLog(data: InsertAuditLog) {
    const [row] = await db.insert(auditLogs).values(data).returning();
    return row;
  }

  async getContacts(subAccountId: number) {
    return db.select().from(contacts).where(eq(contacts.subAccountId, subAccountId)).orderBy(desc(contacts.createdAt));
  }

  async getContactById(id: number) {
    const [row] = await db.select().from(contacts).where(eq(contacts.id, id));
    return row;
  }

  async createContact(data: InsertContact) {
    const [row] = await db.insert(contacts).values(data).returning();
    return row;
  }

  async updateContact(id: number, data: Partial<InsertContact>) {
    const [row] = await db.update(contacts).set(data).where(eq(contacts.id, id)).returning();
    return row;
  }

  async deleteContact(id: number) {
    const rows = await db.delete(contacts).where(eq(contacts.id, id)).returning();
    return rows.length > 0;
  }

  async getPipelineStages(subAccountId: number) {
    return db.select().from(pipelineStages).where(eq(pipelineStages.subAccountId, subAccountId));
  }

  async createPipelineStage(data: InsertPipelineStage) {
    const [row] = await db.insert(pipelineStages).values(data).returning();
    return row;
  }

  async updatePipelineStage(id: number, data: Partial<InsertPipelineStage>) {
    const [row] = await db.update(pipelineStages).set(data).where(eq(pipelineStages.id, id)).returning();
    return row;
  }

  async deletePipelineStage(id: number) {
    const rows = await db.delete(pipelineStages).where(eq(pipelineStages.id, id)).returning();
    return rows.length > 0;
  }

  async getDeals(subAccountId: number) {
    return db.select().from(deals).where(eq(deals.subAccountId, subAccountId)).orderBy(desc(deals.createdAt));
  }

  async getDealById(id: number) {
    const [row] = await db.select().from(deals).where(eq(deals.id, id));
    return row;
  }

  async createDeal(data: InsertDeal) {
    const [row] = await db.insert(deals).values(data).returning();
    return row;
  }

  async updateDeal(id: number, data: Partial<InsertDeal>) {
    const [row] = await db.update(deals).set(data).where(eq(deals.id, id)).returning();
    return row;
  }

  async deleteDeal(id: number) {
    const rows = await db.delete(deals).where(eq(deals.id, id)).returning();
    return rows.length > 0;
  }

  async getAppointments(subAccountId: number) {
    return db.select().from(appointments).where(eq(appointments.subAccountId, subAccountId)).orderBy(desc(appointments.createdAt));
  }

  async getAppointmentById(id: number) {
    const [row] = await db.select().from(appointments).where(eq(appointments.id, id));
    return row;
  }

  async createAppointment(data: InsertAppointment) {
    const [row] = await db.insert(appointments).values(data).returning();
    return row;
  }

  async updateAppointment(id: number, data: Partial<InsertAppointment>) {
    const [row] = await db.update(appointments).set(data).where(eq(appointments.id, id)).returning();
    return row;
  }

  async deleteAppointment(id: number) {
    const rows = await db.delete(appointments).where(eq(appointments.id, id)).returning();
    return rows.length > 0;
  }

  async getEmailCampaigns(subAccountId: number) {
    return db.select().from(emailCampaigns).where(eq(emailCampaigns.subAccountId, subAccountId)).orderBy(desc(emailCampaigns.createdAt));
  }

  async getEmailCampaignById(id: number) {
    const [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id));
    return row;
  }

  async createEmailCampaign(data: InsertEmailCampaign) {
    const [row] = await db.insert(emailCampaigns).values(data).returning();
    return row;
  }

  async updateEmailCampaign(id: number, data: Partial<InsertEmailCampaign>) {
    const [row] = await db.update(emailCampaigns).set(data).where(eq(emailCampaigns.id, id)).returning();
    return row;
  }

  async deleteEmailCampaign(id: number) {
    const rows = await db.delete(emailCampaigns).where(eq(emailCampaigns.id, id)).returning();
    return rows.length > 0;
  }

  async getWebhooks(subAccountId: number) {
    return db.select().from(webhooks).where(eq(webhooks.subAccountId, subAccountId)).orderBy(desc(webhooks.createdAt));
  }

  async getWebhookById(id: number) {
    const [row] = await db.select().from(webhooks).where(eq(webhooks.id, id));
    return row;
  }

  async createWebhook(data: InsertWebhook) {
    const [row] = await db.insert(webhooks).values(data).returning();
    return row;
  }

  async updateWebhook(id: number, data: Partial<InsertWebhook>) {
    const [row] = await db.update(webhooks).set(data).where(eq(webhooks.id, id)).returning();
    return row;
  }

  async deleteWebhook(id: number) {
    const rows = await db.delete(webhooks).where(eq(webhooks.id, id)).returning();
    return rows.length > 0;
  }

  async getWhiteLabelSettings(userId: string) {
    const [row] = await db.select().from(whiteLabelSettings).where(eq(whiteLabelSettings.userId, userId));
    return row;
  }

  async upsertWhiteLabelSettings(data: InsertWhiteLabelSettings) {
    const existing = await this.getWhiteLabelSettings(data.userId);
    if (existing) {
      const [row] = await db.update(whiteLabelSettings).set({ ...data, updatedAt: new Date() }).where(eq(whiteLabelSettings.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(whiteLabelSettings).values(data).returning();
    return row;
  }

  async getMetaAdCampaigns(subAccountId: number) {
    return db.select().from(metaAdCampaigns).where(eq(metaAdCampaigns.subAccountId, subAccountId)).orderBy(desc(metaAdCampaigns.createdAt));
  }

  async getMetaAdCampaign(id: number) {
    const [row] = await db.select().from(metaAdCampaigns).where(eq(metaAdCampaigns.id, id));
    return row;
  }

  async createMetaAdCampaign(data: InsertMetaAdCampaign) {
    const [row] = await db.insert(metaAdCampaigns).values(data).returning();
    return row;
  }

  async updateMetaAdCampaign(id: number, data: Partial<InsertMetaAdCampaign>) {
    const [row] = await db.update(metaAdCampaigns).set(data).where(eq(metaAdCampaigns.id, id)).returning();
    return row;
  }

  async deleteMetaAdCampaign(id: number) {
    const rows = await db.delete(metaAdCampaigns).where(eq(metaAdCampaigns.id, id)).returning();
    return rows.length > 0;
  }

  async getMetaLeads(subAccountId: number) {
    return db.select().from(metaLeads).where(eq(metaLeads.subAccountId, subAccountId)).orderBy(desc(metaLeads.createdAt));
  }

  async getMetaLead(id: number) {
    const [row] = await db.select().from(metaLeads).where(eq(metaLeads.id, id));
    return row;
  }

  async createMetaLead(data: InsertMetaLead) {
    const [row] = await db.insert(metaLeads).values(data).returning();
    return row;
  }

  async updateMetaLead(id: number, data: Partial<InsertMetaLead>) {
    const [row] = await db.update(metaLeads).set(data).where(eq(metaLeads.id, id)).returning();
    return row;
  }

  async getInstagramConversations(subAccountId: number) {
    return db.select().from(instagramConversations).where(eq(instagramConversations.subAccountId, subAccountId)).orderBy(desc(instagramConversations.lastMessageAt));
  }

  async getInstagramConversation(id: number) {
    const [row] = await db.select().from(instagramConversations).where(eq(instagramConversations.id, id));
    return row;
  }

  async createInstagramConversation(data: InsertInstagramConversation) {
    const [row] = await db.insert(instagramConversations).values(data).returning();
    return row;
  }

  async updateInstagramConversation(id: number, data: Partial<InsertInstagramConversation>) {
    const [row] = await db.update(instagramConversations).set(data).where(eq(instagramConversations.id, id)).returning();
    return row;
  }

  async getInstagramMessages(conversationId: number) {
    return db.select().from(instagramMessages).where(eq(instagramMessages.conversationId, conversationId)).orderBy(instagramMessages.createdAt);
  }

  async createInstagramMessage(data: InsertInstagramMessage) {
    const [row] = await db.insert(instagramMessages).values(data).returning();
    return row;
  }
}

export const storage = new DatabaseStorage();
