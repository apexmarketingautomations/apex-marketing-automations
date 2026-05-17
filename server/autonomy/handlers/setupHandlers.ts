// @ts-nocheck
import type { ActionHandler, ActionResult, EntityChange } from "../types";
import { storage } from "../../storage";
import { db } from "../../db";
import { digitalCards, pipelineStages } from "@shared/schema";
import { eq } from "drizzle-orm";

function makeResult(
  actionType: string,
  accountId: number,
  overrides: Partial<ActionResult>,
  startTime: number
): ActionResult {
  return {
    success: true,
    actionType,
    category: "setup",
    accountId,
    status: "completed",
    entitiesAffected: [],
    changesSummary: "",
    rollbackCapable: false,
    durationMs: Date.now() - startTime,
    executedAt: new Date().toISOString(),
    ...overrides,
  };
}

const createDefaultPipeline: ActionHandler = {
  actionType: "create_default_pipeline",
  category: "setup",
  description: "Create a default sales pipeline with standard stages when none exists",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const existing = await storage.getPipelineStages(accountId);
    if (existing.length > 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "Pipeline stages already exist — skipped",
      }, start);
    }

    const defaultStages = [
      { name: "New Lead", order: 1 },
      { name: "Contacted", order: 2 },
      { name: "Qualified", order: 3 },
      { name: "Proposal Sent", order: 4 },
      { name: "Closed Won", order: 5 },
      { name: "Closed Lost", order: 6 },
    ];

    const rows = await db.transaction(async (tx) => {
      const created = [];
      for (const stage of defaultStages) {
        const [row] = await tx.insert(pipelineStages).values({
          subAccountId: accountId,
          name: stage.name,
          order: stage.order,
        }).returning();
        created.push(row);
      }
      return created;
    });

    const entities: EntityChange[] = rows.map(row => ({
      entityType: "pipeline_stage",
      entityId: String(row.id),
      operation: "created" as const,
      after: { name: row.name, order: row.order },
    }));

    return makeResult(this.actionType, accountId, {
      entitiesAffected: entities,
      changesSummary: `Created ${entities.length} default pipeline stages`,
      rollbackCapable: true,
      rollbackPayload: { stageIds: entities.map(c => c.entityId) },
    }, start);
  },
  async rollback(accountId, payload) {
    const start = Date.now();
    const ids = (payload.stageIds as string[]) || [];
    await db.transaction(async (tx) => {
      for (const id of ids) {
        await tx.delete(pipelineStages).where(eq(pipelineStages.id, Number(id)));
      }
    });
    return makeResult("create_default_pipeline", accountId, {
      status: "rolled_back",
      changesSummary: `Rolled back ${ids.length} pipeline stages`,
      entitiesAffected: ids.map(id => ({ entityType: "pipeline_stage", entityId: id, operation: "deleted" as const })),
    }, start);
  },
};

const createMissingPipelineStages: ActionHandler = {
  actionType: "create_missing_pipeline_stages",
  category: "setup",
  description: "Add missing standard stages to an incomplete pipeline",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const existing = await storage.getPipelineStages(accountId);
    const existingNames = new Set(existing.map(s => s.name.toLowerCase()));
    const requiredStages = ["new lead", "contacted", "qualified", "proposal sent", "closed won", "closed lost"];
    const missing = requiredStages.filter(s => !existingNames.has(s));

    if (missing.length === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "All standard pipeline stages already present",
      }, start);
    }

    const maxOrder = existing.reduce((m, s) => Math.max(m, s.order ?? 0), 0);

    const rows = await db.transaction(async (tx) => {
      const created = [];
      for (let i = 0; i < missing.length; i++) {
        const [row] = await tx.insert(pipelineStages).values({
          subAccountId: accountId,
          name: missing[i].split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" "),
          order: maxOrder + i + 1,
        }).returning();
        created.push(row);
      }
      return created;
    });

    const entities: EntityChange[] = rows.map(row => ({
      entityType: "pipeline_stage",
      entityId: String(row.id),
      operation: "created" as const,
      after: { name: row.name, order: row.order },
    }));

    return makeResult(this.actionType, accountId, {
      entitiesAffected: entities,
      changesSummary: `Added ${entities.length} missing pipeline stages: ${missing.join(", ")}`,
      rollbackCapable: true,
      rollbackPayload: { stageIds: entities.map(c => c.entityId) },
    }, start);
  },
  async rollback(accountId, payload) {
    const start = Date.now();
    const ids = (payload.stageIds as string[]) || [];
    await db.transaction(async (tx) => {
      for (const id of ids) {
        await tx.delete(pipelineStages).where(eq(pipelineStages.id, Number(id)));
      }
    });
    return makeResult("create_missing_pipeline_stages", accountId, {
      status: "rolled_back",
      changesSummary: `Rolled back ${ids.length} pipeline stages`,
      entitiesAffected: ids.map(id => ({ entityType: "pipeline_stage", entityId: id, operation: "deleted" as const })),
    }, start);
  },
};

const createDefaultWorkflow: ActionHandler = {
  actionType: "create_default_workflow",
  category: "setup",
  description: "Create a standard lead follow-up workflow when no workflows exist",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const existingWorkflows = await storage.getWorkflows();
    const accountWorkflows = existingWorkflows.filter(w => w.subAccountId === accountId);
    if (accountWorkflows.length > 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "Workflows already exist — skipped",
      }, start);
    }

    const workflow = await storage.createWorkflow({
      subAccountId: accountId,
      name: "New Lead Auto-Follow-Up",
      trigger: "new_contact",
      steps: [
        { type: "WAIT", duration: 5, unit: "minutes" },
        { type: "SMS", message: "Hi {{firstName}}, thanks for reaching out! How can we help you today?" },
      ],
      active: false,
    });

    return makeResult(this.actionType, accountId, {
      entitiesAffected: [{
        entityType: "workflow",
        entityId: String(workflow.id),
        operation: "created",
        after: { name: workflow.name, trigger: workflow.trigger },
      }],
      changesSummary: `Created default workflow "${workflow.name}" (inactive — ready for review)`,
      rollbackCapable: true,
      rollbackPayload: { workflowId: workflow.id },
    }, start);
  },
  async rollback(accountId, payload) {
    const start = Date.now();
    const id = payload.workflowId as number;
    await storage.deleteWorkflow(id);
    return makeResult("create_default_workflow", accountId, {
      status: "rolled_back",
      changesSummary: `Deleted workflow #${id}`,
      entitiesAffected: [{ entityType: "workflow", entityId: String(id), operation: "deleted" }],
    }, start);
  },
};

const createAlertRule: ActionHandler = {
  actionType: "create_alert_rule",
  category: "setup",
  description: "Create a sentinel alert rule for monitoring specific conditions",
  safetyClassification: "safe",
  async execute(accountId, params) {
    const start = Date.now();
    const ruleType = (params.ruleType as string) || "missed_call";
    const existingConfig = await storage.getSentinelConfig(accountId);

    if (!existingConfig) {
      const config = await storage.upsertSentinelConfig({
        subAccountId: accountId,
        enabled: true,
        monitoredChannels: ["sms", "voice", "email"],
        alertThresholds: { [ruleType]: { enabled: true, threshold: 1 } },
        checkIntervalMinutes: 15,
        alertCooldownMinutes: 60,
      });

      return makeResult(this.actionType, accountId, {
        entitiesAffected: [{
          entityType: "sentinel_config",
          entityId: String(config.id),
          operation: "created",
          after: { ruleType, enabled: true },
        }],
        changesSummary: `Created sentinel config with ${ruleType} alert rule`,
      }, start);
    }

    const thresholds = (existingConfig.alertThresholds as Record<string, unknown>) || {};
    if (thresholds[ruleType]) {
      return makeResult(this.actionType, accountId, {
        changesSummary: `Alert rule "${ruleType}" already exists`,
      }, start);
    }

    thresholds[ruleType] = { enabled: true, threshold: 1 };
    const updated = await storage.upsertSentinelConfig({
      ...existingConfig,
      alertThresholds: thresholds,
    });

    return makeResult(this.actionType, accountId, {
      entitiesAffected: [{
        entityType: "sentinel_config",
        entityId: String(updated.id),
        operation: "updated",
        after: { ruleType, enabled: true },
      }],
      changesSummary: `Added alert rule "${ruleType}" to sentinel config`,
    }, start);
  },
};

const createDigitalCardRecord: ActionHandler = {
  actionType: "create_digital_card_record",
  category: "setup",
  description: "Create a basic digital business card record for an account that has none",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const account = await storage.getSubAccount(accountId);
    if (!account) {
      return makeResult(this.actionType, accountId, {
        success: false,
        status: "failed",
        error: "Account not found",
        changesSummary: "Account not found",
      }, start);
    }

    const existingCards = await db.select().from(digitalCards).where(eq(digitalCards.subAccountId, accountId));
    if (existingCards.length > 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "Digital card already exists — skipped",
      }, start);
    }

    const [card] = await db.insert(digitalCards).values({
      subAccountId: accountId,
      name: account.name || "My Business Card",
      title: account.industry ? `${account.industry} Professional` : "Business Professional",
      phone: account.ownerPhone || "",
      email: "",
      theme: "executive-dark",
      status: "draft",
      isPublic: false,
      slug: `card-${accountId}-${Date.now()}`,
    }).returning();

    return makeResult(this.actionType, accountId, {
      entitiesAffected: [{
        entityType: "digital_card",
        entityId: String(card.id),
        operation: "created",
        after: { name: card.name, status: "draft" },
      }],
      changesSummary: `Created digital card "${card.name}" (draft — ready for customization)`,
      rollbackCapable: true,
      rollbackPayload: { cardId: card.id },
    }, start);
  },
  async rollback(accountId, payload) {
    const start = Date.now();
    const id = payload.cardId as number;
    await db.delete(digitalCards).where(eq(digitalCards.id, id));
    return makeResult("create_digital_card_record", accountId, {
      status: "rolled_back",
      changesSummary: `Deleted digital card #${id}`,
      entitiesAffected: [{ entityType: "digital_card", entityId: String(id), operation: "deleted" }],
    }, start);
  },
};

const createLiveAutomation: ActionHandler = {
  actionType: "create_live_automation",
  category: "setup",
  description: "Create a live automation rule for automated actions",
  safetyClassification: "safe",
  async execute(accountId, params) {
    const start = Date.now();
    const automationType = (params.automationType as string) || "lead_follow_up";
    const name = (params.name as string) || `Auto: ${automationType.replace(/_/g, " ")}`;

    const automation = await storage.createLiveAutomation({
      subAccountId: accountId,
      name,
      triggerType: (params.triggerType as string) || "event",
      triggerConfig: (params.triggerConfig as Record<string, unknown>) || { event: "contact.created" },
      manifest: (params.manifest as Record<string, unknown>) || {
        trigger: { type: "event", event: "contact.created" },
        steps: [{ action: "TAG", tags: ["auto-captured"] }],
      },
      active: false,
      status: "draft",
    });

    return makeResult(this.actionType, accountId, {
      entitiesAffected: [{
        entityType: "live_automation",
        entityId: String(automation.id),
        operation: "created",
        after: { name: automation.name, active: false },
      }],
      changesSummary: `Created live automation "${automation.name}" (inactive — needs activation)`,
      rollbackCapable: true,
      rollbackPayload: { automationId: automation.id },
    }, start);
  },
  async rollback(accountId, payload) {
    const start = Date.now();
    const id = payload.automationId as number;
    await storage.deleteLiveAutomation(id);
    return makeResult("create_live_automation", accountId, {
      status: "rolled_back",
      changesSummary: `Deleted live automation #${id}`,
      entitiesAffected: [{ entityType: "live_automation", entityId: String(id), operation: "deleted" }],
    }, start);
  },
};

const createNotificationPreferences: ActionHandler = {
  actionType: "create_notification_preferences",
  category: "setup",
  description: "Create default notification preferences when none are configured",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const existing = await storage.getNotificationPreferences(accountId);
    if (existing) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "Notification preferences already configured",
      }, start);
    }

    const prefs = await storage.upsertNotificationPreferences({
      subAccountId: accountId,
      newLeadPush: true,
      newLeadSms: false,
      missedCallPush: true,
      missedCallSms: true,
      paymentFailedPush: true,
      paymentFailedSms: true,
      incidentPush: true,
      incidentSms: true,
      nudgeHighPush: true,
      nudgeHighSms: false,
      agentUrgentPush: true,
      agentUrgentSms: true,
      campaignAlertPush: true,
      campaignAlertSms: false,
      systemAlertPush: true,
      systemAlertSms: false,
      quietHoursEnabled: false,
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
    });

    return makeResult(this.actionType, accountId, {
      entitiesAffected: [{
        entityType: "notification_preferences",
        entityId: String(prefs.id),
        operation: "created",
        after: { configured: true },
      }],
      changesSummary: "Created default notification preferences",
    }, start);
  },
};

const createReadinessBaseline: ActionHandler = {
  actionType: "create_readiness_baseline",
  category: "setup",
  description: "Initialize a launch readiness baseline score for an account",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const existing = await storage.getIntelligenceScores(accountId, "account", String(accountId));
    const hasReadiness = existing.some(s => s.scoreType === "launch_readiness_score");
    if (hasReadiness) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "Launch readiness score already exists",
      }, start);
    }

    const score = await storage.upsertIntelligenceScore({
      accountId,
      entityType: "account",
      entityId: String(accountId),
      scoreType: "launch_readiness_score",
      scoreValue: 0,
      scoreBand: "critical",
      explanation: "Baseline readiness — no setup steps completed yet",
      inputs: { baseline: true, createdByAutonomy: true },
    });

    return makeResult(this.actionType, accountId, {
      entitiesAffected: [{
        entityType: "intelligence_score",
        entityId: String(score.id),
        operation: "created",
        after: { scoreType: "launch_readiness_score", scoreValue: 0 },
      }],
      changesSummary: "Created baseline launch readiness score (0/100)",
    }, start);
  },
};

const createCreditWallet: ActionHandler = {
  actionType: "create_credit_wallet",
  category: "setup",
  description: "Initialize a credit wallet for an account that lacks one",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const existing = await storage.getCreditWallet(accountId);
    if (existing) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "Credit wallet already exists",
      }, start);
    }

    const wallet = await storage.upsertCreditWallet({
      subAccountId: accountId,
      balance: 0,
      lifetimeCredits: 0,
      lifetimeDebits: 0,
    });

    return makeResult(this.actionType, accountId, {
      entitiesAffected: [{
        entityType: "credit_wallet",
        entityId: String(wallet.id),
        operation: "created",
        after: { balance: 0 },
      }],
      changesSummary: "Created credit wallet with zero balance",
    }, start);
  },
};

const initializeIntegrationHealth: ActionHandler = {
  actionType: "initialize_integration_health",
  category: "setup",
  description: "Create initial integration health tracking entries for connected integrations",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const connections = await storage.getIntegrationConnections(accountId);
    const existingHealth = await storage.getIntegrationHealth(accountId);
    const trackedKeys = new Set(existingHealth.map(h => `${h.integrationType}:${h.integrationKey}`));

    const toCreate = connections.filter(conn => !trackedKeys.has(`${conn.provider}:${conn.provider}`));
    if (toCreate.length === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "All integrations already have health tracking",
      }, start);
    }

    const created: EntityChange[] = [];
    for (const conn of toCreate) {
      const health = await storage.upsertIntegrationHealth({
        accountId,
        integrationType: conn.provider,
        integrationKey: conn.provider,
        status: conn.status === "connected" ? "healthy" : "unknown",
        healthScore: conn.status === "connected" ? 100 : 50,
      });

      created.push({
        entityType: "integration_health",
        entityId: String(health.id),
        operation: "created",
        after: { integrationType: conn.provider, status: health.status },
      });
    }

    return makeResult(this.actionType, accountId, {
      entitiesAffected: created,
      changesSummary: `Initialized health tracking for ${created.length} integration(s)`,
    }, start);
  },
};

export const setupHandlers: ActionHandler[] = [
  createDefaultPipeline,
  createMissingPipelineStages,
  createDefaultWorkflow,
  createAlertRule,
  createDigitalCardRecord,
  createLiveAutomation,
  createNotificationPreferences,
  createReadinessBaseline,
  createCreditWallet,
  initializeIntegrationHealth,
];
