import type { ActionHandler, ActionResult, EntityChange } from "../types";
import { storage } from "../../storage";
import { db } from "../../db";
import { digitalCards, liveAutomations, contacts } from "@shared/schema";
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
    category: "optimization",
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

const activateRecommendedDefaults: ActionHandler = {
  actionType: "activate_recommended_defaults",
  category: "optimization",
  description: "Enable recommended default features based on account maturity score",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const scores = await storage.getIntelligenceScores(accountId, "account", String(accountId));
    const maturity = scores.find(s => s.scoreType === "account_maturity_score");

    if (!maturity || maturity.scoreValue < 30) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "Account maturity too low for automated defaults — manual setup recommended",
      }, start);
    }

    const affected: EntityChange[] = [];
    const actions: string[] = [];

    const config = await storage.getSentinelConfig(accountId);
    if (config && !config.enabled) {
      const before = { enabled: false };
      await storage.upsertSentinelConfig({ ...config, enabled: true } as any);
      affected.push({
        entityType: "sentinel_config",
        entityId: String(config.id),
        operation: "updated",
        before,
        after: { enabled: true },
      });
      actions.push("enabled sentinel monitoring");
    }

    const prefs = await storage.getNotificationPreferences(accountId);
    if (prefs && !prefs.newLeadPush) {
      const before = { newLeadPush: prefs.newLeadPush, missedCallPush: prefs.missedCallPush };
      await storage.upsertNotificationPreferences({
        ...prefs,
        newLeadPush: true,
        missedCallPush: true,
      });
      affected.push({
        entityType: "notification_preferences",
        entityId: String(prefs.id),
        operation: "updated",
        before,
        after: { newLeadPush: true, missedCallPush: true },
      });
      actions.push("enabled lead + missed call push notifications");
    }

    return makeResult(this.actionType, accountId, {
      entitiesAffected: affected,
      changesSummary: actions.length > 0
        ? `Activated defaults: ${actions.join(", ")}`
        : "Recommended defaults already active",
      rollbackCapable: affected.length > 0,
      rollbackPayload: affected.length > 0 ? {
        changes: affected.map(a => ({
          entityType: a.entityType,
          entityId: a.entityId,
          before: a.before,
        })),
      } : undefined,
    }, start);
  },
  async rollback(accountId, payload) {
    const start = Date.now();
    const changes = (payload.changes as { entityType: string; entityId: string; before: Record<string, unknown> }[]) || [];
    for (const c of changes) {
      if (c.entityType === "sentinel_config") {
        const config = await storage.getSentinelConfig(accountId);
        if (config) {
          await storage.upsertSentinelConfig({ ...config, enabled: c.before.enabled as boolean } as any);
        }
      }
      if (c.entityType === "notification_preferences") {
        const prefs = await storage.getNotificationPreferences(accountId);
        if (prefs) {
          await storage.upsertNotificationPreferences({ ...prefs, ...c.before });
        }
      }
    }
    return makeResult("activate_recommended_defaults", accountId, {
      status: "rolled_back",
      changesSummary: `Reverted ${changes.length} default activation(s)`,
      entitiesAffected: changes.map(c => ({
        entityType: c.entityType,
        entityId: c.entityId,
        operation: "updated" as const,
      })),
    }, start);
  },
};

const enableLeadCaptureOnCards: ActionHandler = {
  actionType: "enable_lead_capture_on_cards",
  category: "optimization",
  description: "Enable lead capture on digital cards that don't have it active",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const cards = await db.select().from(digitalCards).where(eq(digitalCards.subAccountId, accountId));
    const uncaptured = cards.filter(c => !c.leadCaptureEnabled && c.isActive);

    if (uncaptured.length === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "All active cards already have lead capture enabled, or no cards exist",
      }, start);
    }

    const affected: EntityChange[] = [];
    await db.transaction(async (tx) => {
      for (const card of uncaptured) {
        await tx.update(digitalCards)
          .set({ leadCaptureEnabled: true })
          .where(eq(digitalCards.id, card.id));
        affected.push({
          entityType: "digital_card",
          entityId: String(card.id),
          operation: "updated",
          before: { leadCaptureEnabled: false },
          after: { leadCaptureEnabled: true },
        });
      }
    });

    return makeResult(this.actionType, accountId, {
      entitiesAffected: affected,
      changesSummary: `Enabled lead capture on ${affected.length} digital card(s)`,
      rollbackCapable: true,
      rollbackPayload: { cardIds: affected.map(a => a.entityId) },
    }, start);
  },
  async rollback(accountId, payload) {
    const start = Date.now();
    const ids = (payload.cardIds as string[]) || [];
    await db.transaction(async (tx) => {
      for (const id of ids) {
        await tx.update(digitalCards)
          .set({ leadCaptureEnabled: false })
          .where(eq(digitalCards.id, Number(id)));
      }
    });
    return makeResult("enable_lead_capture_on_cards", accountId, {
      status: "rolled_back",
      changesSummary: `Disabled lead capture on ${ids.length} card(s)`,
      entitiesAffected: ids.map(id => ({
        entityType: "digital_card",
        entityId: id,
        operation: "updated" as const,
      })),
    }, start);
  },
};

const adjustAlertThresholds: ActionHandler = {
  actionType: "adjust_alert_thresholds",
  category: "optimization",
  description: "Tune sentinel alert thresholds based on current activity levels to reduce noise",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const config = await storage.getSentinelConfig(accountId);
    if (!config) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "No sentinel config — cannot adjust thresholds",
      }, start);
    }

    const thresholds = ((config as any).alertThresholds as Record<string, { enabled: boolean; threshold: number }>) || {};
    const before = JSON.parse(JSON.stringify(thresholds));
    let adjusted = 0;

    for (const [key, rule] of Object.entries(thresholds)) {
      if (rule.threshold === 1 && rule.enabled) {
        thresholds[key] = { ...rule, threshold: 3 };
        adjusted++;
      }
    }

    if (adjusted === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "Alert thresholds are already tuned",
      }, start);
    }

    await storage.upsertSentinelConfig({ ...config, alertThresholds: thresholds } as any);

    return makeResult(this.actionType, accountId, {
      entitiesAffected: [{
        entityType: "sentinel_config",
        entityId: String(config.id),
        operation: "updated",
        before: { alertThresholds: before },
        after: { alertThresholds: thresholds },
      }],
      changesSummary: `Adjusted ${adjusted} alert threshold(s) from 1 → 3 to reduce noise`,
      rollbackCapable: true,
      rollbackPayload: { configId: config.id, previousThresholds: before },
    }, start);
  },
  async rollback(accountId, payload) {
    const start = Date.now();
    const config = await storage.getSentinelConfig(accountId);
    if (config) {
      await storage.upsertSentinelConfig({
        ...config,
        alertThresholds: payload.previousThresholds as Record<string, unknown>,
      } as any);
    }
    return makeResult("adjust_alert_thresholds", accountId, {
      status: "rolled_back",
      changesSummary: "Restored previous alert thresholds",
      entitiesAffected: [{
        entityType: "sentinel_config",
        entityId: String(payload.configId),
        operation: "updated",
      }],
    }, start);
  },
};

const queueBestNextAction: ActionHandler = {
  actionType: "queue_best_next_action",
  category: "optimization",
  description: "Analyze pending recommendations and promote the highest-priority one as the next suggested action",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const recs = await storage.getRecommendations(accountId, { status: "pending", limit: 20 });

    if (recs.length === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "No pending recommendations to prioritize",
      }, start);
    }

    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = [...recs].sort((a, b) =>
      (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 4) -
      (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 4)
    );

    const topRec = sorted[0];

    await storage.createExecutionTimelineEntry({
      accountId,
      relatedEntityType: topRec.entityType,
      relatedEntityId: topRec.entityId,
      title: `Best Next Action: ${topRec.title}`,
      description: topRec.description || "",
      sourceModule: "autonomy",
      severity: topRec.priority === "critical" ? "warning" : "info",
    });

    return makeResult(this.actionType, accountId, {
      entitiesAffected: [{
        entityType: "recommendation",
        entityId: String(topRec.id),
        operation: "updated",
        after: { promoted: true, title: topRec.title, priority: topRec.priority },
      }],
      changesSummary: `Queued best next action: "${topRec.title}" (${topRec.priority} priority)`,
    }, start);
  },
};

const activateDraftAutomations: ActionHandler = {
  actionType: "activate_draft_automations",
  category: "optimization",
  description: "Activate well-configured draft automations that have valid triggers and steps",
  safetyClassification: "needs_review",
  async execute(accountId) {
    const start = Date.now();
    const automations = await storage.getLiveAutomations(accountId);
    const readyToActivate = automations.filter(a => {
      if (a.status !== "draft" || (a as any).active) return false;
      const manifest = a.manifest as Record<string, unknown> | null;
      return manifest?.trigger && manifest?.steps && Array.isArray(manifest.steps) && manifest.steps.length > 0;
    });

    if (readyToActivate.length === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "No ready draft automations found to activate",
      }, start);
    }

    const affected: EntityChange[] = [];
    await db.transaction(async (tx) => {
      for (const auto of readyToActivate) {
        await tx.update(liveAutomations)
          .set({ active: true, status: "active" } as any)
          .where(eq(liveAutomations.id, auto.id));
        affected.push({
          entityType: "live_automation",
          entityId: String(auto.id),
          operation: "updated",
          before: { active: false, status: "draft" },
          after: { active: true, status: "active" },
        });
      }
    });

    return makeResult(this.actionType, accountId, {
      entitiesAffected: affected,
      changesSummary: `Activated ${affected.length} draft automation(s) with valid configuration`,
      rollbackCapable: true,
      rollbackPayload: { automationIds: affected.map(a => a.entityId) },
    }, start);
  },
  async rollback(accountId, payload) {
    const start = Date.now();
    const ids = (payload.automationIds as string[]) || [];
    await db.transaction(async (tx) => {
      for (const id of ids) {
        await tx.update(liveAutomations)
          .set({ active: false, status: "draft" } as any)
          .where(eq(liveAutomations.id, Number(id)));
      }
    });
    return makeResult("activate_draft_automations", accountId, {
      status: "rolled_back",
      changesSummary: `Deactivated ${ids.length} automation(s) back to draft`,
      entitiesAffected: ids.map(id => ({
        entityType: "live_automation",
        entityId: id,
        operation: "updated" as const,
      })),
    }, start);
  },
};

const optimizeWorkflowSteps: ActionHandler = {
  actionType: "optimize_workflow_steps",
  category: "optimization",
  description: "Analyze workflow step metrics and log optimization suggestions for underperforming steps",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const workflows = await storage.getWorkflows();
    const accountWorkflows = workflows.filter(w => w.subAccountId === accountId);

    if (accountWorkflows.length === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "No workflows to optimize",
      }, start);
    }

    const suggestions: string[] = [];
    const affected: EntityChange[] = [];

    for (const wf of accountWorkflows) {
      const metrics = await storage.getWorkflowStepMetrics(wf.id);
      for (const m of metrics) {
        const failRate = m.executionCount > 0 ? m.failureCount / m.executionCount : 0;
        if (failRate > 0.3 && m.executionCount >= 5) {
          const suggestion = `Workflow "${wf.name}" step ${m.stepIndex}: ${Math.round(failRate * 100)}% failure rate (${m.failureCount}/${m.executionCount})`;
          suggestions.push(suggestion);

          await storage.createWorkflowOptimizationLog({
            workflowId: wf.id,
            stepIndex: m.stepIndex,
            changeType: "suggestion",
            previousValue: { failRate: Math.round(failRate * 100) },
            newValue: { recommendation: "Review and fix this step" },
            reason: suggestion,
            appliedBy: "autonomy_engine",
          });

          affected.push({
            entityType: "workflow_optimization_log",
            entityId: String(wf.id),
            operation: "created",
            after: { suggestion },
          });
        }
      }
    }

    return makeResult(this.actionType, accountId, {
      entitiesAffected: affected,
      changesSummary: suggestions.length > 0
        ? `Found ${suggestions.length} optimization suggestion(s) for workflow steps`
        : "All workflow steps performing within acceptable range",
    }, start);
  },
};

const promoteHighIntentLeads: ActionHandler = {
  actionType: "promote_high_intent_leads",
  category: "optimization",
  description: "Tag high-intent contacts for priority follow-up based on lead intent scores",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const scores = await storage.getScoresByType(accountId, "lead_intent_score");
    const highIntent = scores.filter(s => s.scoreValue >= 70);

    if (highIntent.length === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "No high-intent leads found to promote",
      }, start);
    }

    const toTag: { contactId: number; currentTags: string[] }[] = [];
    for (const score of highIntent.slice(0, 20)) {
      const contactId = Number(score.entityId);
      const contact = await storage.getContactById(contactId);
      if (!contact) continue;
      const tags = (contact.tags as string[]) || [];
      if (tags.includes("high-intent")) continue;
      toTag.push({ contactId, currentTags: tags });
    }

    if (toTag.length === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "All high-intent contacts already tagged",
      }, start);
    }

    const affected: EntityChange[] = [];
    await db.transaction(async (tx) => {
      for (const item of toTag) {
        const updatedTags = [...item.currentTags, "high-intent"];
        await tx.update(contacts)
          .set({ tags: updatedTags })
          .where(eq(contacts.id, item.contactId));
        affected.push({
          entityType: "contact",
          entityId: String(item.contactId),
          operation: "updated",
          before: { tags: item.currentTags },
          after: { tags: updatedTags },
        });
      }
    });

    return makeResult(this.actionType, accountId, {
      entitiesAffected: affected,
      changesSummary: `Tagged ${affected.length} contact(s) as high-intent for priority follow-up`,
      rollbackCapable: true,
      rollbackPayload: {
        changes: affected.map(a => ({
          contactId: a.entityId,
          previousTags: (a.before as Record<string, unknown>)?.tags,
        })),
      },
    }, start);
  },
  async rollback(accountId, payload) {
    const start = Date.now();
    const changes = (payload.changes as { contactId: string; previousTags: string[] }[]) || [];
    await db.transaction(async (tx) => {
      for (const c of changes) {
        await tx.update(contacts)
          .set({ tags: c.previousTags })
          .where(eq(contacts.id, Number(c.contactId)));
      }
    });
    return makeResult("promote_high_intent_leads", accountId, {
      status: "rolled_back",
      changesSummary: `Restored tags on ${changes.length} contact(s)`,
      entitiesAffected: changes.map(c => ({
        entityType: "contact",
        entityId: c.contactId,
        operation: "updated" as const,
      })),
    }, start);
  },
};

export const optimizationHandlers: ActionHandler[] = [
  activateRecommendedDefaults,
  enableLeadCaptureOnCards,
  adjustAlertThresholds,
  queueBestNextAction,
  activateDraftAutomations,
  optimizeWorkflowSteps,
  promoteHighIntentLeads,
];
