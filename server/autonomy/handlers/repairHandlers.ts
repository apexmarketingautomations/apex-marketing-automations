// @ts-nocheck
import type { ActionHandler, ActionResult, EntityChange } from "../types";
import { storage } from "../../storage";
import { db } from "../../db";
import { deals, pipelineStages, universalEvents, liveAutomations } from "@shared/schema";
import { eq, and, sql, gte } from "drizzle-orm";

function makeResult(
  actionType: string,
  accountId: number,
  overrides: Partial<ActionResult>,
  startTime: number
): ActionResult {
  return {
    success: true,
    actionType,
    category: "repair",
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

const fixOrphanedDeals: ActionHandler = {
  actionType: "fix_orphaned_deals",
  category: "repair",
  description: "Reassign deals that reference deleted pipeline stages to the first available stage",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const allDeals = await storage.getDeals(accountId);
    const stages = await storage.getPipelineStages(accountId);

    if (stages.length === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "No pipeline stages exist — cannot repair orphaned deals",
        success: false,
        status: "failed",
        error: "No pipeline stages available",
      }, start);
    }

    const stageIds = new Set(stages.map(s => s.id));
    const firstStage = stages.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
    const orphaned = allDeals.filter(d => d.stageId && !stageIds.has(d.stageId));

    if (orphaned.length === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "No orphaned deals found",
      }, start);
    }

    const affected: EntityChange[] = [];
    await db.transaction(async (tx) => {
      for (const deal of orphaned) {
        const before = { stageId: deal.stageId };
        await tx.update(deals).set({ stageId: firstStage.id }).where(eq(deals.id, deal.id));
        affected.push({
          entityType: "deal",
          entityId: String(deal.id),
          operation: "updated",
          before,
          after: { stageId: firstStage.id, stageName: firstStage.name },
        });
      }
    });

    return makeResult(this.actionType, accountId, {
      entitiesAffected: affected,
      changesSummary: `Reassigned ${affected.length} orphaned deal(s) to stage "${firstStage.name}"`,
      rollbackCapable: true,
      rollbackPayload: {
        changes: affected.map(a => ({
          dealId: a.entityId,
          previousStageId: (a.before as Record<string, unknown>)?.stageId,
        })),
      },
    }, start);
  },
  async rollback(accountId, payload) {
    const start = Date.now();
    const changes = (payload.changes as { dealId: string; previousStageId: number }[]) || [];
    await db.transaction(async (tx) => {
      for (const c of changes) {
        await tx.update(deals).set({ stageId: c.previousStageId }).where(eq(deals.id, Number(c.dealId)));
      }
    });
    return makeResult("fix_orphaned_deals", accountId, {
      status: "rolled_back",
      changesSummary: `Reverted ${changes.length} deal(s) to original stages`,
      entitiesAffected: changes.map(c => ({
        entityType: "deal",
        entityId: c.dealId,
        operation: "updated" as const,
      })),
    }, start);
  },
};

const fixBrokenContactReferences: ActionHandler = {
  actionType: "fix_broken_contact_references",
  category: "repair",
  description: "Clean up deals referencing deleted contacts by clearing the contact reference",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const allDeals = await storage.getDeals(accountId);
    const allContacts = await storage.getContacts(accountId);
    const contactIds = new Set(allContacts.map(c => c.id));

    const broken = allDeals.filter(d => d.contactId && !contactIds.has(d.contactId));
    if (broken.length === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "No broken contact references found in deals",
      }, start);
    }

    const affected: EntityChange[] = [];
    await db.transaction(async (tx) => {
      for (const deal of broken) {
        const before = { contactId: deal.contactId };
        await tx.update(deals).set({ contactId: null }).where(eq(deals.id, deal.id));
        affected.push({
          entityType: "deal",
          entityId: String(deal.id),
          operation: "updated",
          before,
          after: { contactId: null },
        });
      }
    });

    return makeResult(this.actionType, accountId, {
      entitiesAffected: affected,
      changesSummary: `Cleared ${affected.length} broken contact reference(s) from deals`,
      rollbackCapable: true,
      rollbackPayload: {
        changes: affected.map(a => ({
          dealId: a.entityId,
          previousContactId: (a.before as Record<string, unknown>)?.contactId,
        })),
      },
    }, start);
  },
  async rollback(accountId, payload) {
    const start = Date.now();
    const changes = (payload.changes as { dealId: string; previousContactId: number }[]) || [];
    await db.transaction(async (tx) => {
      for (const c of changes) {
        await tx.update(deals).set({ contactId: c.previousContactId }).where(eq(deals.id, Number(c.dealId)));
      }
    });
    return makeResult("fix_broken_contact_references", accountId, {
      status: "rolled_back",
      changesSummary: `Restored ${changes.length} contact reference(s)`,
      entitiesAffected: changes.map(c => ({
        entityType: "deal",
        entityId: c.dealId,
        operation: "updated" as const,
      })),
    }, start);
  },
};

const restoreRequiredDefaults: ActionHandler = {
  actionType: "restore_required_defaults",
  category: "repair",
  description: "Restore required default configuration when sentinel config is missing critical fields",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const config = await storage.getSentinelConfig(accountId);
    if (!config) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "No sentinel config exists — use create_alert_rule instead",
      }, start);
    }

    const fixes: string[] = [];
    const updates: Record<string, unknown> = {};

    if (!config.monitoredChannels || (config.monitoredChannels as string[]).length === 0) {
      updates.monitoredChannels = ["sms", "voice", "email"];
      fixes.push("restored default monitored channels");
    }
    if (!config.checkIntervalMinutes || config.checkIntervalMinutes < 1) {
      updates.checkIntervalMinutes = 15;
      fixes.push("restored check interval to 15 minutes");
    }
    if (!config.alertCooldownMinutes || config.alertCooldownMinutes < 1) {
      updates.alertCooldownMinutes = 60;
      fixes.push("restored alert cooldown to 60 minutes");
    }

    if (fixes.length === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "Sentinel config has all required defaults",
      }, start);
    }

    await storage.upsertSentinelConfig({ ...config, ...updates });

    return makeResult(this.actionType, accountId, {
      entitiesAffected: [{
        entityType: "sentinel_config",
        entityId: String(config.id),
        operation: "updated",
        after: updates,
      }],
      changesSummary: `Restored defaults: ${fixes.join(", ")}`,
    }, start);
  },
};

const fixIncompleteSetupState: ActionHandler = {
  actionType: "fix_incomplete_setup_state",
  category: "repair",
  description: "Detect and fix accounts with incomplete onboarding state by creating missing foundational records",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const fixes: string[] = [];
    const affected: EntityChange[] = [];

    const stages = await storage.getPipelineStages(accountId);
    if (stages.length === 0) {
      const defaultStages = [
        { name: "New Lead", order: 1 },
        { name: "Contacted", order: 2 },
        { name: "Qualified", order: 3 },
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
      for (const row of rows) {
        affected.push({ entityType: "pipeline_stage", entityId: String(row.id), operation: "created" });
      }
      fixes.push("created minimal pipeline stages");
    }

    const wallet = await storage.getCreditWallet(accountId);
    if (!wallet) {
      const w = await storage.upsertCreditWallet({
        subAccountId: accountId,
        balance: 0,
        lifetimeCredits: 0,
        lifetimeDebits: 0,
      });
      affected.push({ entityType: "credit_wallet", entityId: String(w.id), operation: "created" });
      fixes.push("created credit wallet");
    }

    const prefs = await storage.getNotificationPreferences(accountId);
    if (!prefs) {
      const p = await storage.upsertNotificationPreferences({
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
      affected.push({ entityType: "notification_preferences", entityId: String(p.id), operation: "created" });
      fixes.push("created notification preferences");
    }

    return makeResult(this.actionType, accountId, {
      entitiesAffected: affected,
      changesSummary: fixes.length > 0
        ? `Fixed incomplete setup: ${fixes.join(", ")}`
        : "Setup state is complete — no fixes needed",
    }, start);
  },
};

const retryFailedEventLogs: ActionHandler = {
  actionType: "retry_failed_event_logs",
  category: "repair",
  description: "Reset failed event log entries so they can be retried by the processing pipeline",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const failedLogs = await storage.getFailedEventLogs(3);
    const accountLogs = failedLogs.filter(l => {
      const payload = l.payload as Record<string, unknown> | null;
      return payload?.subAccountId === accountId || payload?.accountId === accountId;
    });

    if (accountLogs.length === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "No retriable failed event logs found for this account",
      }, start);
    }

    const affected: EntityChange[] = [];
    for (const log of accountLogs.slice(0, 10)) {
      await storage.updateEventLogStatus(log.id, "pending", { retryCount: (log.retryCount ?? 0) + 1 });
      affected.push({
        entityType: "event_log",
        entityId: String(log.id),
        operation: "updated",
        before: { status: log.status },
        after: { status: "pending" },
      });
    }

    return makeResult(this.actionType, accountId, {
      entitiesAffected: affected,
      changesSummary: `Reset ${affected.length} failed event log(s) for retry`,
    }, start);
  },
};

const regenerateMissingRollups: ActionHandler = {
  actionType: "regenerate_missing_rollups",
  category: "repair",
  description: "Regenerate activity rollups for entities that are missing period summaries",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [eventCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(universalEvents)
      .where(and(
        eq(universalEvents.subAccountId, accountId),
        gte(universalEvents.occurredAt, thirtyDaysAgo)
      ));

    const existingRollups = await storage.getActivityRollups(accountId, "account", String(accountId));
    const hasMonthlyRollup = existingRollups.some(r => r.periodType === "monthly");

    if (hasMonthlyRollup && (eventCount?.count ?? 0) === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "Rollups are current — no regeneration needed",
      }, start);
    }

    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const rollup = await storage.upsertActivityRollup({
      accountId,
      entityType: "account",
      entityId: String(accountId),
      metricName: "total_events_30d",
      metricValue: eventCount?.count ?? 0,
      periodType: "monthly",
      periodStart,
      periodEnd,
    });

    return makeResult(this.actionType, accountId, {
      entitiesAffected: [{
        entityType: "activity_rollup",
        entityId: String(rollup.id),
        operation: hasMonthlyRollup ? "updated" : "created",
        after: { metricName: "total_events_30d", metricValue: eventCount?.count ?? 0 },
      }],
      changesSummary: `Regenerated monthly rollup: ${eventCount?.count ?? 0} events in last 30 days`,
    }, start);
  },
};

const reconnectOrphanedAutomations: ActionHandler = {
  actionType: "reconnect_orphaned_automations",
  category: "repair",
  description: "Detect automations with broken trigger configs and disable them with a clear error status",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const automations = await storage.getLiveAutomations(accountId);
    const toDisable = automations.filter(auto => {
      const manifest = auto.manifest as Record<string, unknown> | null;
      return auto.active && (!manifest || !manifest.trigger || !manifest.steps);
    });

    if (toDisable.length === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "All automations have valid configurations",
      }, start);
    }

    const affected: EntityChange[] = [];
    await db.transaction(async (tx) => {
      for (const auto of toDisable) {
        await tx.update(liveAutomations)
          .set({ active: false, status: "error" })
          .where(eq(liveAutomations.id, auto.id));
        affected.push({
          entityType: "live_automation",
          entityId: String(auto.id),
          operation: "updated",
          before: { active: true, status: auto.status },
          after: { active: false, status: "error" },
        });
      }
    });

    return makeResult(this.actionType, accountId, {
      entitiesAffected: affected,
      changesSummary: `Disabled ${affected.length} broken automation(s) with invalid manifest`,
      rollbackCapable: true,
      rollbackPayload: {
        changes: affected.map(a => ({
          automationId: a.entityId,
          previousActive: (a.before as Record<string, unknown>)?.active,
          previousStatus: (a.before as Record<string, unknown>)?.status,
        })),
      },
    }, start);
  },
  async rollback(accountId, payload) {
    const start = Date.now();
    const changes = (payload.changes as { automationId: string; previousActive: boolean; previousStatus: string }[]) || [];
    await db.transaction(async (tx) => {
      for (const c of changes) {
        await tx.update(liveAutomations)
          .set({ active: c.previousActive, status: c.previousStatus })
          .where(eq(liveAutomations.id, Number(c.automationId)));
      }
    });
    return makeResult("reconnect_orphaned_automations", accountId, {
      status: "rolled_back",
      changesSummary: `Restored ${changes.length} automation(s) to previous state`,
      entitiesAffected: changes.map(c => ({
        entityType: "live_automation",
        entityId: c.automationId,
        operation: "updated" as const,
      })),
    }, start);
  },
};

const fixStaleIntegrationHealth: ActionHandler = {
  actionType: "fix_stale_integration_health",
  category: "repair",
  description: "Mark integrations with no recent activity as stale/unknown status",
  safetyClassification: "safe",
  async execute(accountId) {
    const start = Date.now();
    const healthRows = await storage.getIntegrationHealth(accountId);
    const now = new Date();
    const staleDays = 7;
    const staleThreshold = new Date(now.getTime() - staleDays * 24 * 60 * 60 * 1000);

    const stale = healthRows.filter(h =>
      h.status === "healthy" && h.lastSuccessAt && h.lastSuccessAt < staleThreshold
    );

    if (stale.length === 0) {
      return makeResult(this.actionType, accountId, {
        changesSummary: "All integrations have recent activity",
      }, start);
    }

    const affected: EntityChange[] = [];
    for (const h of stale) {
      await storage.upsertIntegrationHealth({
        ...h,
        status: "stale",
        healthScore: 50,
      });
      affected.push({
        entityType: "integration_health",
        entityId: String(h.id),
        operation: "updated",
        before: { status: "healthy", healthScore: h.healthScore },
        after: { status: "stale", healthScore: 50 },
      });
    }

    return makeResult(this.actionType, accountId, {
      entitiesAffected: affected,
      changesSummary: `Marked ${affected.length} stale integration(s) (no activity in ${staleDays} days)`,
    }, start);
  },
};

export const repairHandlers: ActionHandler[] = [
  fixOrphanedDeals,
  fixBrokenContactReferences,
  restoreRequiredDefaults,
  fixIncompleteSetupState,
  retryFailedEventLogs,
  regenerateMissingRollups,
  reconnectOrphanedAutomations,
  fixStaleIntegrationHealth,
];
