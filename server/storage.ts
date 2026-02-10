import {
  type SubAccount, type InsertSubAccount,
  type Message, type InsertMessage,
  type Workflow, type InsertWorkflow,
  type TrainingJob, type InsertTrainingJob,
  type Blueprint, type InsertBlueprint,
} from "@shared/schema";

export interface IStorage {
  getSubAccounts(): Promise<SubAccount[]>;
  getSubAccount(id: number): Promise<SubAccount | undefined>;
  createSubAccount(data: InsertSubAccount): Promise<SubAccount>;

  getMessages(subAccountId: number): Promise<Message[]>;
  getMessage(id: number): Promise<Message | undefined>;
  createMessage(data: InsertMessage): Promise<Message>;

  getWorkflows(): Promise<Workflow[]>;
  getWorkflow(id: number): Promise<Workflow | undefined>;
  createWorkflow(data: InsertWorkflow): Promise<Workflow>;

  getTrainingJobs(): Promise<TrainingJob[]>;
  getTrainingJob(id: number): Promise<TrainingJob | undefined>;
  createTrainingJob(data: InsertTrainingJob): Promise<TrainingJob>;
  updateTrainingJob(id: number, data: Partial<TrainingJob>): Promise<TrainingJob | undefined>;

  getBlueprints(): Promise<Blueprint[]>;
  getBlueprint(id: number): Promise<Blueprint | undefined>;
  getBlueprintByIndustryId(industryId: string): Promise<Blueprint | undefined>;
  createBlueprint(data: InsertBlueprint): Promise<Blueprint>;
}

export class MemStorage implements IStorage {
  private subAccounts: Map<number, SubAccount> = new Map();
  private messages: Map<number, Message> = new Map();
  private workflows: Map<number, Workflow> = new Map();
  private trainingJobs: Map<number, TrainingJob> = new Map();
  private blueprints: Map<number, Blueprint> = new Map();
  private nextId = { subAccounts: 1, messages: 1, workflows: 1, trainingJobs: 1, blueprints: 1 };

  async getSubAccounts() { return Array.from(this.subAccounts.values()); }
  async getSubAccount(id: number) { return this.subAccounts.get(id); }
  async createSubAccount(data: InsertSubAccount): Promise<SubAccount> {
    const id = this.nextId.subAccounts++;
    const record = { ...data, id } as SubAccount;
    this.subAccounts.set(id, record);
    return record;
  }

  async getMessages(subAccountId: number) {
    return Array.from(this.messages.values()).filter(m => m.subAccountId === subAccountId);
  }
  async getMessage(id: number) { return this.messages.get(id); }
  async createMessage(data: InsertMessage): Promise<Message> {
    const id = this.nextId.messages++;
    const record = { ...data, id, createdAt: new Date() } as Message;
    this.messages.set(id, record);
    return record;
  }

  async getWorkflows() { return Array.from(this.workflows.values()); }
  async getWorkflow(id: number) { return this.workflows.get(id); }
  async createWorkflow(data: InsertWorkflow): Promise<Workflow> {
    const id = this.nextId.workflows++;
    const record = { ...data, id } as Workflow;
    this.workflows.set(id, record);
    return record;
  }

  async getTrainingJobs() { return Array.from(this.trainingJobs.values()); }
  async getTrainingJob(id: number) { return this.trainingJobs.get(id); }
  async createTrainingJob(data: InsertTrainingJob): Promise<TrainingJob> {
    const id = this.nextId.trainingJobs++;
    const record = { ...data, id, state: data.state ?? "pending", progress: data.progress ?? 0, logs: data.logs ?? [], createdAt: new Date() } as TrainingJob;
    this.trainingJobs.set(id, record);
    return record;
  }
  async updateTrainingJob(id: number, data: Partial<TrainingJob>): Promise<TrainingJob | undefined> {
    const existing = this.trainingJobs.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data } as TrainingJob;
    this.trainingJobs.set(id, updated);
    return updated;
  }

  async getBlueprints() { return Array.from(this.blueprints.values()); }
  async getBlueprint(id: number) { return this.blueprints.get(id); }
  async getBlueprintByIndustryId(industryId: string) {
    return Array.from(this.blueprints.values()).find(b => b.industryId === industryId);
  }
  async createBlueprint(data: InsertBlueprint): Promise<Blueprint> {
    const id = this.nextId.blueprints++;
    const record = { ...data, id } as Blueprint;
    this.blueprints.set(id, record);
    return record;
  }
}

export const storage = new MemStorage();
