import { eq, desc, and, sql, inArray, gte, lt, ilike, or } from "drizzle-orm";
import { db } from "./db";
import {
  subAccounts, messages, smsRetryQueue, workflows, trainingJobs, blueprints, savedSites, siteVersions, siteCollaborators, reviews, usageLogs, domains, owners,
  subscriptions, snapshots, snapshotVersions, affiliates, referrals, commissions, sentinelConfig, sentinelIncidents, propertyLeads, wholesalerConfig, clientWebsites, auditLogs,
  contacts, pipelineStages, deals, appointments, emailCampaigns, webhooks, whiteLabelSettings,
  metaAdCampaigns, metaLeads, instagramConversations, instagramMessages, notifications,
  liveAutomations, aiToolLogs, webhookEvents, integrationConnections, portalTokens,
  eventLog, type EventLogEntry, type InsertEventLog,
  type SubAccount, type InsertSubAccount,
  type Message, type InsertMessage,
  type SmsRetryQueue, type InsertSmsRetryQueue,
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
  type Notification, type InsertNotification,
  type LiveAutomation, type InsertLiveAutomation,
  type AiToolLog, type InsertAiToolLog,
  type WebhookEvent, type InsertWebhookEvent,
  type IntegrationConnection, type InsertIntegrationConnection,
  oauthTokens, type OAuthToken, type InsertOAuthToken,
  integrationEvents, type IntegrationEvent, type InsertIntegrationEvent,
  providerAssets, type ProviderAsset, type InsertProviderAsset,
  type PortalToken, type InsertPortalToken,
  dispatchSubscribers,
  type DispatchSubscriber, type InsertDispatchSubscriber,
  creditWallets, creditTransactions, sponsorships, sponsorshipClicks, platformProfitLedger,
  funnelLeads, crashReports, dmKeywordAutomations, shopifyEvents, skipTraceResults, skipTraceUsage,
  type CreditWallet, type InsertCreditWallet,
  type CreditTransaction, type InsertCreditTransaction,
  type Sponsorship, type InsertSponsorship,
  type SponsorshipClick, type InsertSponsorshipClick,
  type PlatformProfit, type InsertPlatformProfit,
  type FunnelLead, type InsertFunnelLead,
  type CrashReport, type InsertCrashReport,
  type DmKeywordAutomation, type InsertDmKeywordAutomation,
  type ShopifyEvent, type InsertShopifyEvent,
  type SkipTraceResult, type InsertSkipTraceResult,
  type SkipTraceUsage, type InsertSkipTraceUsage,
  pushSubscriptions, notificationPreferences,
  abExperiments, abEvents,
  workflowStepMetrics, workflowOptimizationLogs,
  type PushSubscription, type InsertPushSubscription,
  type NotificationPreference, type InsertNotificationPreference,
  type AbExperiment, type InsertAbExperiment,
  type AbEvent, type InsertAbEvent,
  type WorkflowStepMetric, type InsertWorkflowStepMetric,
  type WorkflowOptimizationLog, type InsertWorkflowOptimizationLog,
  timelineEvents,
  type TimelineEvent, type InsertTimelineEvent,
  agentConversations, agentMessages,
  type AgentConversation, type InsertAgentConversation,
  type AgentMessage, type InsertAgentMessage,
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
  getMessageByMessageSid(messageSid: string, subAccountId?: number): Promise<Message | undefined>;
  getConversationThreads(subAccountId: number): Promise<{ contactPhone: string; channel: string; lastMessage: string; lastTime: Date; unreadCount: number }[]>;
  createSmsRetryQueueItem(data: InsertSmsRetryQueue): Promise<SmsRetryQueue>;

  getWorkflows(): Promise<Workflow[]>;
  getWorkflow(id: number): Promise<Workflow | undefined>;
  createWorkflow(data: InsertWorkflow): Promise<Workflow>;
  updateWorkflow(id: number, data: Partial<InsertWorkflow>): Promise<Workflow | undefined>;
  deleteWorkflow(id: number): Promise<void>;

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
  getSubscriptionByStripeCustomer(stripeCustomerId: string): Promise<Subscription | undefined>;
  getSubscriptionByAccountId(subAccountId: number): Promise<Subscription | undefined>;

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
  getSentinelIncidentsFiltered(subAccountId: number, filters: { since?: Date; status?: string; limit?: number }): Promise<SentinelIncident[]>;
  purgeSentinelIncidents(subAccountId: number, olderThan: Date): Promise<number>;
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

  getNotifications(subAccountId: number): Promise<Notification[]>;
  createNotification(data: InsertNotification): Promise<Notification>;
  markNotificationRead(id: number): Promise<Notification | undefined>;
  markAllNotificationsRead(subAccountId: number): Promise<void>;
  getUnreadNotificationCount(subAccountId: number): Promise<number>;

  getLiveAutomations(subAccountId?: number): Promise<LiveAutomation[]>;
  getLiveAutomation(id: number): Promise<LiveAutomation | undefined>;
  createLiveAutomation(data: InsertLiveAutomation): Promise<LiveAutomation>;
  updateLiveAutomation(id: number, data: Partial<InsertLiveAutomation>): Promise<LiveAutomation | undefined>;
  deleteLiveAutomation(id: number): Promise<boolean>;

  createAiToolLog(data: InsertAiToolLog): Promise<AiToolLog>;
  getAiToolLogs(subAccountId: number): Promise<AiToolLog[]>;

  getWebhookEvents(subAccountId: number): Promise<WebhookEvent[]>;
  createWebhookEvent(data: InsertWebhookEvent): Promise<WebhookEvent>;
  updateWebhookEvent(id: number, data: Partial<InsertWebhookEvent>): Promise<WebhookEvent | undefined>;

  getIntegrationConnections(subAccountId: number): Promise<IntegrationConnection[]>;
  getIntegrationConnection(subAccountId: number, provider: string): Promise<IntegrationConnection | undefined>;
  upsertIntegrationConnection(data: InsertIntegrationConnection): Promise<IntegrationConnection>;

  getOAuthToken(subAccountId: number, provider: string): Promise<OAuthToken | undefined>;
  upsertOAuthToken(data: InsertOAuthToken): Promise<OAuthToken>;
  deleteOAuthToken(subAccountId: number, provider: string): Promise<boolean>;
  getOAuthTokensBySubAccount(subAccountId: number): Promise<OAuthToken[]>;

  createIntegrationEvent(data: InsertIntegrationEvent): Promise<IntegrationEvent>;
  getIntegrationEvents(subAccountId: number, limit?: number): Promise<IntegrationEvent[]>;

  getProviderAssets(subAccountId: number, provider: string): Promise<ProviderAsset[]>;
  upsertProviderAsset(data: InsertProviderAsset): Promise<ProviderAsset>;
  updateProviderAssetSelection(id: number, selected: boolean): Promise<ProviderAsset | undefined>;
  deleteProviderAssets(subAccountId: number, provider: string): Promise<boolean>;

  getPortalTokens(subAccountId: number): Promise<PortalToken[]>;
  getPortalTokenByToken(token: string): Promise<PortalToken | undefined>;
  createPortalToken(data: InsertPortalToken): Promise<PortalToken>;
  deletePortalToken(id: number): Promise<boolean>;

  createDispatchSubscriber(data: InsertDispatchSubscriber): Promise<DispatchSubscriber>;
  getDispatchSubscribers(): Promise<DispatchSubscriber[]>;
  getDispatchSubscriber(id: number): Promise<DispatchSubscriber | undefined>;
  deleteDispatchSubscriber(id: number): Promise<boolean>;
  findSubscribersNear(lat: number, lon: number): Promise<DispatchSubscriber[]>;

  getCreditWallet(subAccountId: number): Promise<CreditWallet | undefined>;
  upsertCreditWallet(data: InsertCreditWallet): Promise<CreditWallet>;
  updateCreditWalletBalance(subAccountId: number, delta: number): Promise<CreditWallet | undefined>;

  getCreditTransactions(subAccountId: number): Promise<CreditTransaction[]>;
  getCreditTransactionByStripeSession(sessionId: string): Promise<CreditTransaction | undefined>;
  createCreditTransaction(data: InsertCreditTransaction): Promise<CreditTransaction>;

  getSponsorships(): Promise<Sponsorship[]>;
  getSponsorship(id: number): Promise<Sponsorship | undefined>;
  createSponsorship(data: InsertSponsorship): Promise<Sponsorship>;
  updateSponsorship(id: number, data: Partial<InsertSponsorship>): Promise<Sponsorship | undefined>;
  getActiveSponsorshipsNear(lat: number, lon: number): Promise<Sponsorship[]>;

  createSponsorshipClick(data: InsertSponsorshipClick): Promise<SponsorshipClick>;
  getSponsorshipClicks(sponsorshipId: number): Promise<SponsorshipClick[]>;

  createPlatformProfit(data: InsertPlatformProfit): Promise<PlatformProfit>;
  getPlatformProfits(): Promise<PlatformProfit[]>;

  createFunnelLead(data: InsertFunnelLead): Promise<FunnelLead>;
  getFunnelLeadBySession(sessionId: string): Promise<FunnelLead | undefined>;
  updateFunnelLead(id: number, data: Partial<InsertFunnelLead>): Promise<FunnelLead | undefined>;
  getAbandonedFunnelLeads(staleMinutes: number): Promise<FunnelLead[]>;
  getFunnelLeads(slug?: string): Promise<FunnelLead[]>;

  getDmKeywordAutomations(subAccountId: number, enabledOnly?: boolean): Promise<DmKeywordAutomation[]>;
  createDmKeywordAutomation(data: InsertDmKeywordAutomation): Promise<DmKeywordAutomation>;
  updateDmKeywordAutomation(id: number, data: Partial<InsertDmKeywordAutomation>): Promise<DmKeywordAutomation | undefined>;
  deleteDmKeywordAutomation(id: number): Promise<void>;
  incrementKeywordHitCount(id: number): Promise<void>;

  createCrashReport(data: InsertCrashReport): Promise<CrashReport>;
  getCrashReport(id: number): Promise<CrashReport | undefined>;
  getCrashReportByNumber(reportNumber: string): Promise<CrashReport | undefined>;
  updateCrashReport(id: number, data: Partial<InsertCrashReport>): Promise<CrashReport | undefined>;
  getAndLockPendingReports(limit: number, workerId: string): Promise<CrashReport[]>;
  resetStuckJobs(timeoutMinutes: number): Promise<number>;
  getCrashReports(subAccountId?: number): Promise<CrashReport[]>;

  getShopifyEvents(subAccountId: number): Promise<ShopifyEvent[]>;
  createShopifyEvent(data: InsertShopifyEvent): Promise<ShopifyEvent>;
  updateShopifyEvent(id: number, data: Partial<InsertShopifyEvent>): Promise<ShopifyEvent | undefined>;

  getSkipTraceResults(subAccountId: number): Promise<SkipTraceResult[]>;
  getSkipTraceResultByLeadId(propertyLeadId: number): Promise<SkipTraceResult | undefined>;
  createSkipTraceResult(data: InsertSkipTraceResult): Promise<SkipTraceResult>;
  updateSkipTraceResult(id: number, data: Partial<InsertSkipTraceResult>): Promise<SkipTraceResult | undefined>;

  getSkipTraceUsage(subAccountId: number, monthYear: string): Promise<SkipTraceUsage | undefined>;
  incrementSkipTraceUsage(subAccountId: number, monthYear: string): Promise<SkipTraceUsage>;

  getPushSubscriptions(subAccountId: number): Promise<PushSubscription[]>;
  createPushSubscription(data: InsertPushSubscription): Promise<PushSubscription>;
  deletePushSubscription(endpoint: string, subAccountId: number): Promise<boolean>;

  getNotificationPreferences(subAccountId: number): Promise<NotificationPreference | undefined>;
  upsertNotificationPreferences(data: InsertNotificationPreference): Promise<NotificationPreference>;

  getAbExperiments(subAccountId?: number): Promise<AbExperiment[]>;
  getAbExperiment(id: number): Promise<AbExperiment | undefined>;
  getAbExperimentsByContent(contentType: string, contentId: number): Promise<AbExperiment[]>;
  getRunningAbExperiments(): Promise<AbExperiment[]>;
  createAbExperiment(data: InsertAbExperiment): Promise<AbExperiment>;
  updateAbExperiment(id: number, data: Partial<InsertAbExperiment>): Promise<AbExperiment | undefined>;
  deleteAbExperiment(id: number): Promise<boolean>;

  createAbEvent(data: InsertAbEvent): Promise<AbEvent>;
  getAbEvents(experimentId: number): Promise<AbEvent[]>;

  getWorkflowStepMetrics(workflowId: number): Promise<WorkflowStepMetric[]>;
  upsertWorkflowStepMetric(data: InsertWorkflowStepMetric): Promise<WorkflowStepMetric>;
  incrementStepMetric(workflowId: number, stepIndex: number, field: 'executionCount' | 'successCount' | 'failureCount' | 'responseCount', amount?: number): Promise<void>;

  getWorkflowOptimizationLogs(workflowId: number): Promise<WorkflowOptimizationLog[]>;
  createWorkflowOptimizationLog(data: InsertWorkflowOptimizationLog): Promise<WorkflowOptimizationLog>;
  revertOptimization(logId: number): Promise<WorkflowOptimizationLog | undefined>;

  createTimelineEvent(data: InsertTimelineEvent): Promise<TimelineEvent>;
  batchCreateTimelineEvents(data: InsertTimelineEvent[]): Promise<void>;
  getTimelineEventsByTrace(traceId: string): Promise<TimelineEvent[]>;
  listTraces(subAccountId: number, opts?: { limit?: number; offset?: number; status?: string; since?: Date }): Promise<{ traceId: string; contactPhone: string | null; conversationId: string | null; startedAt: Date; totalSteps: number; failedSteps: number; totalLatencyMs: number }[]>;
  getTraceSummary(traceId: string): Promise<{ totalDurationMs: number; aiLatencyMs: number; deliveryLatencyMs: number; stepCount: number; failedStepCount: number } | null>;

  getRoutingFailures(unresolvedOnly?: boolean): Promise<import("@shared/schema").RoutingFailure[]>;
  resolveRoutingFailure(id: number, subAccountId: number): Promise<import("@shared/schema").RoutingFailure | undefined>;

  createEventLog(data: InsertEventLog): Promise<EventLogEntry>;
  getEventLog(id: number): Promise<EventLogEntry | undefined>;
  getEventLogByExternalId(source: string, externalId: string): Promise<EventLogEntry | undefined>;
  updateEventLogStatus(id: number, status: string, extra?: { errorMessage?: string; processedAt?: Date; failedAt?: Date; retryCount?: number }): Promise<EventLogEntry | undefined>;
  getFailedEventLogs(maxRetries?: number): Promise<EventLogEntry[]>;
  getDeadLetterEventLogs(): Promise<EventLogEntry[]>;
  queryEventLogs(filters: { type?: string; source?: string; status?: string; traceId?: string; since?: Date; until?: Date; limit?: number }): Promise<EventLogEntry[]>;

  searchContacts(subAccountId: number, query: string): Promise<Contact[]>;
  searchWorkflows(subAccountId: number, query: string): Promise<LiveAutomation[]>;

  createAgentConversation(data: InsertAgentConversation): Promise<AgentConversation>;
  getAgentConversation(sessionId: string): Promise<AgentConversation | undefined>;
  updateAgentConversationActivity(sessionId: string): Promise<void>;
  createAgentMessage(data: InsertAgentMessage): Promise<AgentMessage>;
  getAgentMessages(sessionId: string, limit?: number): Promise<AgentMessage[]>;
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
    if (!data.subAccountId) {
      throw new Error("[TENANT GUARD] createMessage rejected: subAccountId is required and was not provided");
    }
    const [row] = await db.insert(messages).values(data).returning();
    return row;
  }

  async getMessageByMessageSid(messageSid: string, subAccountId?: number) {
    if (subAccountId) {
      const [row] = await db.select().from(messages)
        .where(and(eq(messages.messageSid, messageSid), eq(messages.subAccountId, subAccountId)))
        .limit(1);
      return row;
    }
    const [row] = await db.select().from(messages).where(eq(messages.messageSid, messageSid)).limit(1);
    return row;
  }

  async getConversationThreads(subAccountId: number): Promise<{ contactPhone: string; channel: string; lastMessage: string; lastTime: Date; unreadCount: number }[]> {
    const result = await db.execute(
      sql`SELECT
            contact_phone AS "contactPhone",
            channel,
            MAX(created_at) AS "lastTime",
            SUM(CASE WHEN direction='inbound' AND status != 'read' THEN 1 ELSE 0 END)::int AS "unreadCount",
            (ARRAY_AGG(body ORDER BY created_at DESC))[1] AS "lastMessage"
          FROM messages
          WHERE sub_account_id = ${subAccountId}
          GROUP BY contact_phone, channel
          ORDER BY "lastTime" DESC`
    ) as any;
    return (result.rows || result).map((r: any) => ({
      contactPhone: r.contactPhone,
      channel: r.channel,
      lastMessage: (r.lastMessage || "").slice(0, 80),
      lastTime: new Date(r.lastTime),
      unreadCount: Number(r.unreadCount) || 0,
    }));
  }

  async createSmsRetryQueueItem(data: InsertSmsRetryQueue) {
    const [row] = await db.insert(smsRetryQueue).values(data).returning();
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

  async deleteWorkflow(id: number) {
    await db.delete(workflows).where(eq(workflows.id, id));
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

  async getSubscriptionByStripeCustomer(stripeCustomerId: string) {
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, stripeCustomerId));
    return row;
  }

  async getSubscriptionByAccountId(_subAccountId: number) {
    return undefined;
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

  async getSentinelIncidentsFiltered(subAccountId: number, filters: { since?: Date; status?: string; limit?: number }) {
    const conditions = [eq(sentinelIncidents.subAccountId, subAccountId)];
    if (filters.since) {
      conditions.push(gte(sentinelIncidents.detectedAt, filters.since));
    }
    if (filters.status) {
      conditions.push(eq(sentinelIncidents.actionStatus, filters.status));
    }
    let query = db.select().from(sentinelIncidents)
      .where(and(...conditions))
      .orderBy(desc(sentinelIncidents.detectedAt));
    if (filters.limit && filters.limit > 0) {
      query = query.limit(filters.limit) as any;
    }
    return query;
  }

  async purgeSentinelIncidents(subAccountId: number, olderThan: Date): Promise<number> {
    const deleted = await db.delete(sentinelIncidents)
      .where(and(
        eq(sentinelIncidents.subAccountId, subAccountId),
        lt(sentinelIncidents.detectedAt, olderThan)
      ))
      .returning({ id: sentinelIncidents.id });
    return deleted.length;
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

  async getNotifications(subAccountId: number) {
    return db.select().from(notifications).where(eq(notifications.subAccountId, subAccountId)).orderBy(desc(notifications.createdAt)).limit(50);
  }

  async createNotification(data: InsertNotification) {
    const [row] = await db.insert(notifications).values(data).returning();
    return row;
  }

  async markNotificationRead(id: number) {
    const [row] = await db.update(notifications).set({ read: true }).where(eq(notifications.id, id)).returning();
    return row;
  }

  async markAllNotificationsRead(subAccountId: number) {
    await db.update(notifications).set({ read: true }).where(and(eq(notifications.subAccountId, subAccountId), eq(notifications.read, false)));
  }

  async getUnreadNotificationCount(subAccountId: number) {
    const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.subAccountId, subAccountId), eq(notifications.read, false)));
    return result?.count || 0;
  }

  async getLiveAutomations(subAccountId?: number) {
    if (subAccountId) {
      return db.select().from(liveAutomations).where(eq(liveAutomations.subAccountId, subAccountId)).orderBy(desc(liveAutomations.createdAt));
    }
    return db.select().from(liveAutomations).orderBy(desc(liveAutomations.createdAt));
  }

  async getLiveAutomation(id: number) {
    const [row] = await db.select().from(liveAutomations).where(eq(liveAutomations.id, id));
    return row;
  }

  async createLiveAutomation(data: InsertLiveAutomation) {
    const [row] = await db.insert(liveAutomations).values(data).returning();
    return row;
  }

  async updateLiveAutomation(id: number, data: Partial<InsertLiveAutomation>) {
    const [row] = await db.update(liveAutomations).set(data).where(eq(liveAutomations.id, id)).returning();
    return row;
  }

  async deleteLiveAutomation(id: number) {
    const rows = await db.delete(liveAutomations).where(eq(liveAutomations.id, id)).returning();
    return rows.length > 0;
  }

  async createAiToolLog(data: InsertAiToolLog) {
    const [row] = await db.insert(aiToolLogs).values(data).returning();
    return row;
  }

  async getAiToolLogs(subAccountId: number) {
    return db.select().from(aiToolLogs).where(eq(aiToolLogs.subAccountId, subAccountId)).orderBy(desc(aiToolLogs.createdAt)).limit(100);
  }

  async getWebhookEvents(subAccountId: number) {
    return db.select().from(webhookEvents).where(eq(webhookEvents.subAccountId, subAccountId)).orderBy(desc(webhookEvents.createdAt)).limit(200);
  }

  async createWebhookEvent(data: InsertWebhookEvent) {
    const [row] = await db.insert(webhookEvents).values(data).returning();
    return row;
  }

  async updateWebhookEvent(id: number, data: Partial<InsertWebhookEvent>) {
    const [row] = await db.update(webhookEvents).set(data).where(eq(webhookEvents.id, id)).returning();
    return row;
  }

  async getIntegrationConnections(subAccountId: number) {
    return db.select().from(integrationConnections).where(eq(integrationConnections.subAccountId, subAccountId));
  }

  async getIntegrationConnection(subAccountId: number, provider: string) {
    const [row] = await db.select().from(integrationConnections).where(and(eq(integrationConnections.subAccountId, subAccountId), eq(integrationConnections.provider, provider)));
    return row;
  }

  async upsertIntegrationConnection(data: InsertIntegrationConnection) {
    const existing = await this.getIntegrationConnection(data.subAccountId, data.provider);
    if (existing) {
      const [row] = await db.update(integrationConnections).set(data).where(eq(integrationConnections.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(integrationConnections).values(data).returning();
    return row;
  }

  async getOAuthToken(subAccountId: number, provider: string) {
    const [row] = await db.select().from(oauthTokens).where(and(eq(oauthTokens.subAccountId, subAccountId), eq(oauthTokens.provider, provider)));
    return row;
  }

  async upsertOAuthToken(data: InsertOAuthToken) {
    const existing = await this.getOAuthToken(data.subAccountId, data.provider);
    if (existing) {
      const [row] = await db.update(oauthTokens).set({ ...data, updatedAt: new Date() }).where(eq(oauthTokens.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(oauthTokens).values(data).returning();
    return row;
  }

  async deleteOAuthToken(subAccountId: number, provider: string) {
    const result = await db.delete(oauthTokens).where(and(eq(oauthTokens.subAccountId, subAccountId), eq(oauthTokens.provider, provider)));
    return (result.rowCount ?? 0) > 0;
  }

  async getOAuthTokensBySubAccount(subAccountId: number) {
    return db.select().from(oauthTokens).where(eq(oauthTokens.subAccountId, subAccountId));
  }

  async createIntegrationEvent(data: InsertIntegrationEvent) {
    const [row] = await db.insert(integrationEvents).values(data).returning();
    return row;
  }

  async getIntegrationEvents(subAccountId: number, limit = 50) {
    return db.select().from(integrationEvents).where(eq(integrationEvents.subAccountId, subAccountId)).orderBy(desc(integrationEvents.createdAt)).limit(limit);
  }

  async getProviderAssets(subAccountId: number, provider: string) {
    return db.select().from(providerAssets).where(and(eq(providerAssets.subAccountId, subAccountId), eq(providerAssets.provider, provider)));
  }

  async upsertProviderAsset(data: InsertProviderAsset) {
    const existing = await db.select().from(providerAssets).where(and(
      eq(providerAssets.subAccountId, data.subAccountId),
      eq(providerAssets.provider, data.provider),
      eq(providerAssets.assetId, data.assetId)
    ));
    if (existing.length > 0) {
      const [row] = await db.update(providerAssets).set(data).where(eq(providerAssets.id, existing[0].id)).returning();
      return row;
    }
    const [row] = await db.insert(providerAssets).values(data).returning();
    return row;
  }

  async updateProviderAssetSelection(id: number, selected: boolean) {
    const [row] = await db.update(providerAssets).set({ selected }).where(eq(providerAssets.id, id)).returning();
    return row;
  }

  async deleteProviderAssets(subAccountId: number, provider: string) {
    const result = await db.delete(providerAssets).where(and(eq(providerAssets.subAccountId, subAccountId), eq(providerAssets.provider, provider)));
    return (result.rowCount ?? 0) > 0;
  }

  async getPortalTokens(subAccountId: number) {
    return db.select().from(portalTokens).where(eq(portalTokens.subAccountId, subAccountId)).orderBy(desc(portalTokens.createdAt));
  }

  async getPortalTokenByToken(token: string) {
    const [row] = await db.select().from(portalTokens).where(and(eq(portalTokens.token, token), eq(portalTokens.active, true)));
    return row;
  }

  async createPortalToken(data: InsertPortalToken) {
    const [row] = await db.insert(portalTokens).values(data).returning();
    return row;
  }

  async deletePortalToken(id: number) {
    const rows = await db.delete(portalTokens).where(eq(portalTokens.id, id)).returning();
    return rows.length > 0;
  }

  async createDispatchSubscriber(data: InsertDispatchSubscriber) {
    const [row] = await db.insert(dispatchSubscribers).values(data).returning();
    return row;
  }

  async getDispatchSubscribers() {
    return db.select().from(dispatchSubscribers).where(eq(dispatchSubscribers.active, true));
  }

  async getDispatchSubscriber(id: number) {
    const [row] = await db.select().from(dispatchSubscribers).where(eq(dispatchSubscribers.id, id));
    return row;
  }

  async deleteDispatchSubscriber(id: number) {
    const rows = await db.delete(dispatchSubscribers).where(eq(dispatchSubscribers.id, id)).returning();
    return rows.length > 0;
  }

  async findSubscribersNear(lat: number, lon: number) {
    const results = await db.execute(sql`
      SELECT * FROM (
        SELECT *,
          (2 * 6371000 * asin(sqrt(
            power(sin(radians(lat - ${lat}) / 2), 2) +
            cos(radians(${lat})) * cos(radians(lat)) *
            power(sin(radians(lon - ${lon}) / 2), 2)
          ))) AS distance_meters
        FROM dispatch_subscribers
        WHERE active = true
      ) sub
      WHERE distance_meters <= target_radius_meters
      ORDER BY distance_meters ASC
    `);
    return results.rows as unknown as DispatchSubscriber[];
  }

  async getCreditWallet(subAccountId: number) {
    const [row] = await db.select().from(creditWallets).where(eq(creditWallets.subAccountId, subAccountId));
    return row;
  }

  async upsertCreditWallet(data: InsertCreditWallet) {
    const existing = await this.getCreditWallet(data.subAccountId);
    if (existing) {
      const [row] = await db.update(creditWallets).set(data).where(eq(creditWallets.subAccountId, data.subAccountId)).returning();
      return row;
    }
    const [row] = await db.insert(creditWallets).values(data).returning();
    return row;
  }

  async updateCreditWalletBalance(subAccountId: number, delta: number) {
    const wallet = await this.getCreditWallet(subAccountId);
    if (!wallet) return undefined;
    const newBalance = Math.max(0, wallet.balance + delta);
    const updates: any = { balance: newBalance, updatedAt: new Date() };
    if (delta > 0) updates.lifetimeTopUp = wallet.lifetimeTopUp + delta;
    if (delta < 0) updates.lifetimeSpend = wallet.lifetimeSpend + Math.abs(delta);
    const [row] = await db.update(creditWallets).set(updates).where(eq(creditWallets.subAccountId, subAccountId)).returning();
    return row;
  }

  async getCreditTransactions(subAccountId: number) {
    return db.select().from(creditTransactions).where(eq(creditTransactions.subAccountId, subAccountId)).orderBy(desc(creditTransactions.createdAt));
  }

  async getCreditTransactionByStripeSession(sessionId: string) {
    const [row] = await db.select().from(creditTransactions).where(eq(creditTransactions.stripeSessionId, sessionId));
    return row;
  }

  async createCreditTransaction(data: InsertCreditTransaction) {
    const [row] = await db.insert(creditTransactions).values(data).returning();
    return row;
  }

  async getSponsorships() {
    return db.select().from(sponsorships).orderBy(desc(sponsorships.createdAt));
  }

  async getSponsorship(id: number) {
    const [row] = await db.select().from(sponsorships).where(eq(sponsorships.id, id));
    return row;
  }

  async createSponsorship(data: InsertSponsorship) {
    const [row] = await db.insert(sponsorships).values(data).returning();
    return row;
  }

  async updateSponsorship(id: number, data: Partial<InsertSponsorship>) {
    const [row] = await db.update(sponsorships).set(data).where(eq(sponsorships.id, id)).returning();
    return row;
  }

  async getActiveSponsorshipsNear(lat: number, lon: number) {
    const results = await db.execute(sql`
      SELECT * FROM (
        SELECT *, (2 * 6371000 * asin(sqrt(
          power(sin(radians(target_lat - ${lat}) / 2), 2) +
          cos(radians(${lat})) * cos(radians(target_lat)) *
          power(sin(radians(target_lon - ${lon}) / 2), 2)
        ))) AS distance_meters
        FROM sponsorships
        WHERE status = 'approved' AND spent < total_budget
      ) sub
      WHERE distance_meters <= target_radius_meters
      ORDER BY bid_per_click DESC
    `);
    return results.rows as unknown as Sponsorship[];
  }

  async createSponsorshipClick(data: InsertSponsorshipClick) {
    const [row] = await db.insert(sponsorshipClicks).values(data).returning();
    return row;
  }

  async getSponsorshipClicks(sponsorshipId: number) {
    return db.select().from(sponsorshipClicks).where(eq(sponsorshipClicks.sponsorshipId, sponsorshipId));
  }

  async createPlatformProfit(data: InsertPlatformProfit) {
    const [row] = await db.insert(platformProfitLedger).values(data).returning();
    return row;
  }

  async getPlatformProfits() {
    return db.select().from(platformProfitLedger).orderBy(desc(platformProfitLedger.createdAt));
  }

  async createFunnelLead(data: InsertFunnelLead) {
    const [row] = await db.insert(funnelLeads).values(data).returning();
    return row;
  }

  async getFunnelLeadBySession(sessionId: string) {
    const [row] = await db.select().from(funnelLeads).where(eq(funnelLeads.sessionId, sessionId));
    return row;
  }

  async updateFunnelLead(id: number, data: Partial<InsertFunnelLead>) {
    const [row] = await db.update(funnelLeads).set(data).where(eq(funnelLeads.id, id)).returning();
    return row;
  }

  async getAbandonedFunnelLeads(staleMinutes: number) {
    const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
    return db.select().from(funnelLeads)
      .where(and(
        eq(funnelLeads.status, "in_progress"),
        sql`${funnelLeads.lastSeenAt} < ${cutoff}`
      ));
  }

  async getFunnelLeads(slug?: string) {
    if (slug) {
      return db.select().from(funnelLeads).where(eq(funnelLeads.slug, slug)).orderBy(desc(funnelLeads.createdAt));
    }
    return db.select().from(funnelLeads).orderBy(desc(funnelLeads.createdAt));
  }

  async getDmKeywordAutomations(subAccountId: number, enabledOnly = false) {
    const conditions = [eq(dmKeywordAutomations.subAccountId, subAccountId)];
    if (enabledOnly) conditions.push(eq(dmKeywordAutomations.enabled, true));
    return db.select().from(dmKeywordAutomations)
      .where(and(...conditions))
      .orderBy(dmKeywordAutomations.createdAt);
  }

  async createDmKeywordAutomation(data: InsertDmKeywordAutomation) {
    const [row] = await db.insert(dmKeywordAutomations).values(data).returning();
    return row;
  }

  async updateDmKeywordAutomation(id: number, data: Partial<InsertDmKeywordAutomation>) {
    const [row] = await db.update(dmKeywordAutomations).set(data).where(eq(dmKeywordAutomations.id, id)).returning();
    return row;
  }

  async deleteDmKeywordAutomation(id: number) {
    await db.delete(dmKeywordAutomations).where(eq(dmKeywordAutomations.id, id));
  }

  async incrementKeywordHitCount(id: number) {
    await db.update(dmKeywordAutomations)
      .set({ hitCount: sql`${dmKeywordAutomations.hitCount} + 1` })
      .where(eq(dmKeywordAutomations.id, id));
  }

  async createCrashReport(data: InsertCrashReport) {
    const [row] = await db.insert(crashReports).values(data).onConflictDoNothing({ target: crashReports.reportNumber }).returning();
    if (row) return row;
    const [existing] = await db.select().from(crashReports).where(eq(crashReports.reportNumber, data.reportNumber));
    return existing;
  }

  async getCrashReport(id: number) {
    const [row] = await db.select().from(crashReports).where(eq(crashReports.id, id));
    return row;
  }

  async getCrashReportByNumber(reportNumber: string) {
    const [row] = await db.select().from(crashReports).where(eq(crashReports.reportNumber, reportNumber));
    return row;
  }

  async updateCrashReport(id: number, data: Partial<InsertCrashReport>) {
    const clearLockStatuses = ["COMPLETED", "FAILED", "NOT_FOUND", "PENDING"];
    const shouldClearLock = data.status && clearLockStatuses.includes(data.status);
    const updatePayload: Partial<InsertCrashReport> & { updatedAt: Date; lockedAt?: null; lockedBy?: null } = {
      ...data,
      updatedAt: new Date(),
      ...(shouldClearLock ? { lockedAt: null, lockedBy: null } : {}),
    };
    const [row] = await db.update(crashReports).set(updatePayload).where(eq(crashReports.id, id)).returning();
    return row;
  }

  async getAndLockPendingReports(limit = 2, workerId = "default") {
    const now = new Date();
    return await db.transaction(async (tx) => {
      const pending = await tx.execute(sql`
        SELECT id FROM crash_reports
        WHERE status = 'PENDING' AND locked_at IS NULL
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `);
      const ids = (pending.rows || []).map((r: { id: number }) => r.id);
      if (ids.length === 0) return [];
      return tx.update(crashReports)
        .set({ status: "PROCESSING", lockedAt: now, lockedBy: workerId, updatedAt: now })
        .where(inArray(crashReports.id, ids))
        .returning();
    });
  }

  async resetStuckJobs(timeoutMinutes: number) {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    const result = await db.update(crashReports)
      .set({ status: "PENDING", lockedAt: null, lockedBy: null, updatedAt: new Date() })
      .where(and(
        eq(crashReports.status, "PROCESSING"),
        sql`(${crashReports.lockedAt} IS NULL OR ${crashReports.lockedAt} < ${cutoff})`
      ))
      .returning();
    return result.length;
  }

  async getCrashReports(subAccountId?: number) {
    if (subAccountId) {
      return db.select().from(crashReports)
        .where(eq(crashReports.subAccountId, subAccountId))
        .orderBy(desc(crashReports.createdAt));
    }
    return db.select().from(crashReports).orderBy(desc(crashReports.createdAt));
  }
  async getShopifyEvents(subAccountId: number) {
    return db.select().from(shopifyEvents)
      .where(eq(shopifyEvents.subAccountId, subAccountId))
      .orderBy(desc(shopifyEvents.createdAt));
  }

  async createShopifyEvent(data: InsertShopifyEvent) {
    const [row] = await db.insert(shopifyEvents).values(data).returning();
    return row;
  }

  async updateShopifyEvent(id: number, data: Partial<InsertShopifyEvent>) {
    const [row] = await db.update(shopifyEvents).set(data).where(eq(shopifyEvents.id, id)).returning();
    return row;
  }

  async getSkipTraceResults(subAccountId: number) {
    return db.select().from(skipTraceResults)
      .where(eq(skipTraceResults.subAccountId, subAccountId))
      .orderBy(desc(skipTraceResults.createdAt));
  }

  async getSkipTraceResultByLeadId(propertyLeadId: number) {
    const [row] = await db.select().from(skipTraceResults)
      .where(eq(skipTraceResults.propertyLeadId, propertyLeadId));
    return row;
  }

  async createSkipTraceResult(data: InsertSkipTraceResult) {
    const [row] = await db.insert(skipTraceResults).values(data).returning();
    return row;
  }

  async updateSkipTraceResult(id: number, data: Partial<InsertSkipTraceResult>) {
    const [row] = await db.update(skipTraceResults).set(data).where(eq(skipTraceResults.id, id)).returning();
    return row;
  }

  async getSkipTraceUsage(subAccountId: number, monthYear: string) {
    const [row] = await db.select().from(skipTraceUsage)
      .where(and(eq(skipTraceUsage.subAccountId, subAccountId), eq(skipTraceUsage.monthYear, monthYear)));
    return row;
  }

  async incrementSkipTraceUsage(subAccountId: number, monthYear: string) {
    const existing = await this.getSkipTraceUsage(subAccountId, monthYear);
    if (existing) {
      const [row] = await db.update(skipTraceUsage)
        .set({ lookupCount: (existing.lookupCount || 0) + 1 })
        .where(eq(skipTraceUsage.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db.insert(skipTraceUsage)
      .values({ subAccountId, monthYear, lookupCount: 1 })
      .returning();
    return row;
  }

  async getPushSubscriptions(subAccountId: number) {
    return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.subAccountId, subAccountId));
  }

  async createPushSubscription(data: InsertPushSubscription) {
    const existing = await db.select().from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.subAccountId, data.subAccountId), eq(pushSubscriptions.endpoint, data.endpoint)));
    if (existing.length > 0) return existing[0];
    const [row] = await db.insert(pushSubscriptions).values(data).returning();
    return row;
  }

  async deletePushSubscription(endpoint: string, subAccountId: number) {
    const rows = await db.delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.subAccountId, subAccountId)))
      .returning();
    return rows.length > 0;
  }

  async getNotificationPreferences(subAccountId: number) {
    const [row] = await db.select().from(notificationPreferences)
      .where(eq(notificationPreferences.subAccountId, subAccountId));
    return row;
  }

  async upsertNotificationPreferences(data: InsertNotificationPreference) {
    const existing = await this.getNotificationPreferences(data.subAccountId);
    if (existing) {
      const [row] = await db.update(notificationPreferences)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(notificationPreferences.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db.insert(notificationPreferences).values(data).returning();
    return row;
  }

  async getAbExperiments(subAccountId?: number) {
    if (subAccountId) {
      return db.select().from(abExperiments)
        .where(eq(abExperiments.subAccountId, subAccountId))
        .orderBy(desc(abExperiments.createdAt));
    }
    return db.select().from(abExperiments).orderBy(desc(abExperiments.createdAt));
  }

  async getAbExperiment(id: number) {
    const [row] = await db.select().from(abExperiments).where(eq(abExperiments.id, id));
    return row;
  }

  async getAbExperimentsByContent(contentType: string, contentId: number) {
    return db.select().from(abExperiments)
      .where(and(eq(abExperiments.contentType, contentType), eq(abExperiments.contentId, contentId)))
      .orderBy(desc(abExperiments.createdAt));
  }

  async getRunningAbExperiments() {
    return db.select().from(abExperiments)
      .where(eq(abExperiments.status, "running"))
      .orderBy(desc(abExperiments.createdAt));
  }

  async createAbExperiment(data: InsertAbExperiment) {
    const [row] = await db.insert(abExperiments).values(data).returning();
    return row;
  }

  async updateAbExperiment(id: number, data: Partial<InsertAbExperiment>) {
    const [row] = await db.update(abExperiments).set(data).where(eq(abExperiments.id, id)).returning();
    return row;
  }

  async deleteAbExperiment(id: number) {
    await db.delete(abEvents).where(eq(abEvents.experimentId, id));
    const rows = await db.delete(abExperiments).where(eq(abExperiments.id, id)).returning();
    return rows.length > 0;
  }

  async createAbEvent(data: InsertAbEvent) {
    const [row] = await db.insert(abEvents).values(data).returning();
    return row;
  }

  async getAbEvents(experimentId: number) {
    return db.select().from(abEvents)
      .where(eq(abEvents.experimentId, experimentId))
      .orderBy(desc(abEvents.createdAt));
  }

  async getWorkflowStepMetrics(workflowId: number) {
    return db.select().from(workflowStepMetrics)
      .where(eq(workflowStepMetrics.workflowId, workflowId))
      .orderBy(workflowStepMetrics.stepIndex);
  }

  async upsertWorkflowStepMetric(data: InsertWorkflowStepMetric) {
    const existing = await db.select().from(workflowStepMetrics)
      .where(and(
        eq(workflowStepMetrics.workflowId, data.workflowId),
        eq(workflowStepMetrics.stepIndex, data.stepIndex),
      ))
      .limit(1);

    if (existing.length > 0) {
      const [row] = await db.update(workflowStepMetrics)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(workflowStepMetrics.id, existing[0].id))
        .returning();
      return row;
    }
    const [row] = await db.insert(workflowStepMetrics).values(data).returning();
    return row;
  }

  async incrementStepMetric(workflowId: number, stepIndex: number, field: 'executionCount' | 'successCount' | 'failureCount' | 'responseCount', amount = 1) {
    const existing = await db.select().from(workflowStepMetrics)
      .where(and(
        eq(workflowStepMetrics.workflowId, workflowId),
        eq(workflowStepMetrics.stepIndex, stepIndex),
      ))
      .limit(1);

    if (existing.length > 0) {
      const col = workflowStepMetrics[field];
      await db.update(workflowStepMetrics)
        .set({
          [field]: sql`${col} + ${amount}`,
          lastExecutedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(workflowStepMetrics.id, existing[0].id));
    } else {
      await db.insert(workflowStepMetrics).values({
        workflowId,
        stepIndex,
        stepType: 'unknown',
        [field]: amount,
        executionCount: field === 'executionCount' ? amount : 0,
        successCount: field === 'successCount' ? amount : 0,
        failureCount: field === 'failureCount' ? amount : 0,
        responseCount: field === 'responseCount' ? amount : 0,
        totalDurationMs: 0,
        lastExecutedAt: new Date(),
      });
    }
  }

  async getWorkflowOptimizationLogs(workflowId: number) {
    return db.select().from(workflowOptimizationLogs)
      .where(eq(workflowOptimizationLogs.workflowId, workflowId))
      .orderBy(desc(workflowOptimizationLogs.createdAt));
  }

  async createWorkflowOptimizationLog(data: InsertWorkflowOptimizationLog) {
    const [row] = await db.insert(workflowOptimizationLogs).values(data).returning();
    return row;
  }

  async revertOptimization(logId: number) {
    const [row] = await db.update(workflowOptimizationLogs)
      .set({ reverted: true, revertedAt: new Date() })
      .where(eq(workflowOptimizationLogs.id, logId))
      .returning();
    return row;
  }

  async createTimelineEvent(data: InsertTimelineEvent) {
    const [row] = await db.insert(timelineEvents).values(data)
      .onConflictDoNothing()
      .returning();
    return row;
  }

  async batchCreateTimelineEvents(data: InsertTimelineEvent[]): Promise<void> {
    if (data.length === 0) return;
    await db.insert(timelineEvents).values(data)
      .onConflictDoNothing();
  }

  async getTimelineEventsByTrace(traceId: string) {
    return db.select().from(timelineEvents)
      .where(eq(timelineEvents.traceId, traceId))
      .orderBy(sql`coalesce(${timelineEvents.sequenceNum}, 999999)`, timelineEvents.createdAt);
  }

  async listTraces(subAccountId: number, opts: { limit?: number; offset?: number; status?: string; since?: Date } = {}) {
    const { limit = 50, offset = 0, status, since } = opts;

    const conditions = [eq(timelineEvents.subAccountId, subAccountId)];
    if (since) {
      conditions.push(gte(timelineEvents.createdAt, since));
    }

    const rows = await db.select({
      traceId: timelineEvents.traceId,
      contactPhone: timelineEvents.contactPhone,
      conversationId: timelineEvents.conversationId,
      startedAt: sql<Date>`min(${timelineEvents.createdAt})`,
      totalSteps: sql<number>`count(*)`,
      failedSteps: sql<number>`sum(case when ${timelineEvents.status} = 'error' then 1 else 0 end)`,
      totalLatencyMs: sql<number>`sum(coalesce(${timelineEvents.latencyMs}, 0))`,
    })
      .from(timelineEvents)
      .where(and(...conditions))
      .groupBy(timelineEvents.traceId, timelineEvents.contactPhone, timelineEvents.conversationId)
      .orderBy(sql`min(${timelineEvents.createdAt}) desc`)
      .limit(limit)
      .offset(offset);

    let result = rows.map(r => ({
      traceId: r.traceId,
      contactPhone: r.contactPhone,
      conversationId: r.conversationId,
      startedAt: r.startedAt,
      totalSteps: Number(r.totalSteps),
      failedSteps: Number(r.failedSteps),
      totalLatencyMs: Number(r.totalLatencyMs),
    }));

    if (status === "error") {
      result = result.filter(r => r.failedSteps > 0);
    } else if (status === "success") {
      result = result.filter(r => r.failedSteps === 0);
    }

    return result;
  }

  async getTraceSummary(traceId: string) {
    const events = await db.select().from(timelineEvents)
      .where(eq(timelineEvents.traceId, traceId))
      .orderBy(timelineEvents.createdAt);

    if (events.length === 0) return null;

    const first = events[0];
    const last = events[events.length - 1];
    const totalDurationMs = last.createdAt.getTime() - first.createdAt.getTime();

    const aiSteps = ["ai_decision", "ai_response_generated", "ai_chat"];
    const deliverySteps = ["outbound_send", "delivery_status"];

    const aiLatencyMs = events
      .filter(e => aiSteps.some(s => e.step.includes(s)))
      .reduce((sum, e) => sum + (e.latencyMs || 0), 0);

    const deliveryLatencyMs = events
      .filter(e => deliverySteps.some(s => e.step.includes(s)))
      .reduce((sum, e) => sum + (e.latencyMs || 0), 0);

    return {
      totalDurationMs,
      aiLatencyMs,
      deliveryLatencyMs,
      stepCount: events.length,
      failedStepCount: events.filter(e => e.status === "error").length,
    };
  }

  async getRoutingFailures(unresolvedOnly = true) {
    const { routingFailures } = await import("@shared/schema");
    const rows = await db.select().from(routingFailures)
      .orderBy(desc(routingFailures.createdAt));
    if (unresolvedOnly) {
      return rows.filter(r => r.resolvedAt === null);
    }
    return rows;
  }

  async resolveRoutingFailure(id: number, subAccountId: number) {
    const { routingFailures } = await import("@shared/schema");
    const [row] = await db.update(routingFailures)
      .set({ resolvedSubAccountId: subAccountId, resolvedAt: new Date() })
      .where(eq(routingFailures.id, id))
      .returning();
    return row;
  }

  async createEventLog(data: InsertEventLog) {
    const [row] = await db.insert(eventLog).values(data).returning();
    return row;
  }

  async getEventLog(id: number) {
    const [row] = await db.select().from(eventLog).where(eq(eventLog.id, id));
    return row;
  }

  async getEventLogByExternalId(source: string, externalId: string) {
    const [row] = await db.select().from(eventLog)
      .where(and(eq(eventLog.source, source), eq(eventLog.externalId, externalId)));
    return row;
  }

  async updateEventLogStatus(id: number, status: string, extra?: { errorMessage?: string; processedAt?: Date; failedAt?: Date; retryCount?: number }) {
    const [row] = await db.update(eventLog)
      .set({
        status,
        ...(extra?.errorMessage !== undefined ? { errorMessage: extra.errorMessage } : {}),
        ...(extra?.processedAt ? { processedAt: extra.processedAt } : {}),
        ...(extra?.failedAt ? { failedAt: extra.failedAt } : {}),
        ...(extra?.retryCount !== undefined ? { retryCount: extra.retryCount } : {}),
      })
      .where(eq(eventLog.id, id))
      .returning();
    return row;
  }

  async getFailedEventLogs(maxRetries = 3) {
    return db.select().from(eventLog)
      .where(and(eq(eventLog.status, "failed"), lt(eventLog.retryCount, eventLog.maxRetries)))
      .orderBy(eventLog.createdAt);
  }

  async getDeadLetterEventLogs() {
    return db.select().from(eventLog)
      .where(eq(eventLog.status, "dead_letter"))
      .orderBy(desc(eventLog.createdAt));
  }

  async queryEventLogs(filters: { type?: string; source?: string; status?: string; traceId?: string; since?: Date; until?: Date; limit?: number }) {
    const conditions = [];
    if (filters.type) conditions.push(eq(eventLog.type, filters.type));
    if (filters.source) conditions.push(eq(eventLog.source, filters.source));
    if (filters.status) conditions.push(eq(eventLog.status, filters.status));
    if (filters.traceId) conditions.push(eq(eventLog.traceId, filters.traceId));
    if (filters.since) conditions.push(gte(eventLog.createdAt, filters.since));
    if (filters.until) conditions.push(lt(eventLog.createdAt, filters.until));

    return db.select().from(eventLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(eventLog.createdAt))
      .limit(filters.limit || 100);
  }

  async searchContacts(subAccountId: number, query: string) {
    const pattern = `%${query}%`;
    const all = await db.select().from(contacts)
      .where(eq(contacts.subAccountId, subAccountId))
      .orderBy(desc(contacts.createdAt))
      .limit(200);
    const lowerQ = query.toLowerCase();
    return all.filter(c =>
      (c.firstName && c.firstName.toLowerCase().includes(lowerQ)) ||
      (c.lastName && c.lastName.toLowerCase().includes(lowerQ)) ||
      (c.email && c.email.toLowerCase().includes(lowerQ)) ||
      (c.phone && c.phone.toLowerCase().includes(lowerQ)) ||
      (c.tags && c.tags.some(t => t.toLowerCase().includes(lowerQ)))
    ).slice(0, 20);
  }

  async searchWorkflows(subAccountId: number, query: string) {
    const pattern = `%${query}%`;
    const all = await db.select().from(liveAutomations)
      .where(eq(liveAutomations.subAccountId, subAccountId))
      .orderBy(desc(liveAutomations.createdAt))
      .limit(200);
    const lowerQ = query.toLowerCase();
    return all.filter(w => {
      if (w.name.toLowerCase().includes(lowerQ)) return true;
      if (w.description && w.description.toLowerCase().includes(lowerQ)) return true;
      const manifest = w.manifest as any;
      if (manifest?.trigger && typeof manifest.trigger === "string" && manifest.trigger.toLowerCase().includes(lowerQ)) return true;
      return false;
    }).slice(0, 20);
  }

  async createAgentConversation(data: InsertAgentConversation) {
    const [row] = await db.insert(agentConversations).values(data).returning();
    return row;
  }

  async getAgentConversation(sessionId: string) {
    const [row] = await db.select().from(agentConversations).where(eq(agentConversations.sessionId, sessionId));
    return row;
  }

  async updateAgentConversationActivity(sessionId: string) {
    await db.update(agentConversations)
      .set({ lastActivityAt: new Date() })
      .where(eq(agentConversations.sessionId, sessionId));
  }

  async createAgentMessage(data: InsertAgentMessage) {
    const [row] = await db.insert(agentMessages).values(data).returning();
    await db.update(agentConversations)
      .set({ lastActivityAt: new Date() })
      .where(eq(agentConversations.sessionId, data.sessionId));
    return row;
  }

  async getAgentMessages(sessionId: string, limit = 20) {
    return db.select().from(agentMessages)
      .where(eq(agentMessages.sessionId, sessionId))
      .orderBy(desc(agentMessages.createdAt))
      .limit(limit);
  }
}

export const storage = new DatabaseStorage();
