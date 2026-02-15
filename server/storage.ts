import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "./db";
import {
  subAccounts, messages, workflows, trainingJobs, blueprints, savedSites, siteVersions, siteCollaborators, reviews, usageLogs, domains,
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
} from "@shared/schema";

export interface IStorage {
  getSubAccounts(): Promise<SubAccount[]>;
  getSubAccount(id: number): Promise<SubAccount | undefined>;
  createSubAccount(data: InsertSubAccount): Promise<SubAccount>;
  updateSubAccount(id: number, data: Partial<InsertSubAccount>): Promise<SubAccount | undefined>;

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
}

export const storage = new DatabaseStorage();
