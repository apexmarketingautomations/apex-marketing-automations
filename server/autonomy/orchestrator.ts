// @ts-nocheck
import { storage } from "../storage";
import { detectGapsForAccount, type DetectedGap } from "./gapDetector";
import { stageIntegration } from "./preAuthStaging";
import { checkAndContinueAuth } from "./postAuthContinuation";
import { executeAction } from "./safeActionsEngine";
import { evaluatePolicy } from "./decisionEngine";
import { emitUniversalEvent } from "../intelligence/eventEmitter";
import { emitAutonomyGapDetected, emitAutonomyActionResult } from "../intelligence/apexLearningFeed";
import type { ActionCategory } from "./types";

const ORCHESTRATOR_INTERVAL_MS = 3 * 60 * 1000; // Apex reacts every 3 minutes
const MAX_ACTIONS_PER_ACCOUNT = 20; // Apex runs all needed actions per account
const MAX_ACCOUNTS_PER_CYCLE = 200;

let orchestratorTimer: NodeJS.Timeout | null = null;
let isRunning = false;

export interface OrchestrationCycleResult {
  cycleId: string;
  startedAt: string;
  completedAt: string;
  accountsProcessed: number;
  gapsDetected: number;
  actionsDispatched: number;
  actionsCompleted: number;
  actionsFailed: number;
  continuationsCompleted: number;
  errors: string[];
}

const DEPENDENCY_GRAPH: Record<string, string[]> = {
  create_default_workflow: ["fix_incomplete_setup_state"],
  create_live_automation: ["fix_incomplete_setup_state"],
  create_digital_card_record: ["fix_incomplete_setup_state"],
  create_readiness_baseline: ["fix_incomplete_setup_state"],
  optimize_workflow_steps: ["create_default_workflow"],
  promote_high_intent_leads: ["create_default_pipeline"],
  activate_draft_automations: ["create_live_automation"],
  fix_incomplete_setup_state: [],
  create_default_pipeline: [],
  create_missing_pipeline_stages: ["create_default_pipeline"],
  restore_required_defaults: [],
  fix_stale_integration_health: [],
  initialize_integration_health: [],
  activate_recommended_defaults: [],
  create_alert_rule: [],
  create_notification_preferences: [],
  create_credit_wallet: [],
  fix_orphaned_deals: [],
  fix_broken_contact_references: [],
  retry_failed_event_logs: [],
  regenerate_missing_rollups: [],
  reconnect_orphaned_automations: [],
};

function resolveDependencies(gaps: DetectedGap[], completedActions: Set<string>): DetectedGap[] {
  return gaps.filter(gap => {
    const deps = DEPENDENCY_GRAPH[gap.actionType] || gap.dependencies;
    if (!deps || deps.length === 0) return true;
    return deps.every(dep => completedActions.has(dep));
  });
}

export async function runOrchestrationCycle(): Promise<OrchestrationCycleResult> {
  const cycleId = `cycle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  let gapsDetected = 0;
  let actionsDispatched = 0;
  let actionsCompleted = 0;
  let actionsFailed = 0;
  let continuationsCompleted = 0;

  console.log(`[AUTONOMY-ORCH] Starting orchestration cycle ${cycleId}`);

  let accounts;
  try {
    accounts = await storage.getSubAccounts();
  } catch (err) {
    const msg = `Failed to fetch accounts: ${(err as Error).message}`;
    console.error(`[AUTONOMY-ORCH] ${msg}`);
    return {
      cycleId, startedAt, completedAt: new Date().toISOString(),
      accountsProcessed: 0, gapsDetected: 0, actionsDispatched: 0,
      actionsCompleted: 0, actionsFailed: 0, continuationsCompleted: 0,
      errors: [msg],
    };
  }

  const activeAccounts = accounts.slice(0, MAX_ACCOUNTS_PER_CYCLE);

  for (const account of activeAccounts) {
    try {
      const authResults = await checkAndContinueAuth(account.id);
      continuationsCompleted += authResults.filter(r => r.success).length;
      for (const r of authResults) {
        if (!r.success && r.error) {
          errors.push(`[${account.id}] Post-auth continuation failed for ${r.provider}: ${r.error}`);
        }
      }
    } catch (err) {
      errors.push(`[${account.id}] Post-auth check failed: ${(err as Error).message}`);
    }

    try {
      const gaps = await detectGapsForAccount(account.id);
      gapsDetected += gaps.length;

      if (gaps.length > 0) {
        const gapTypeCounts = new Map<string, number>();
        for (const g of gaps) gapTypeCounts.set(g.actionType, (gapTypeCounts.get(g.actionType) || 0) + 1);
        for (const [gapType, count] of gapTypeCounts) {
          emitAutonomyGapDetected(account.id, gapType, count);
        }
      }

      if (gaps.length === 0) continue;

      const recentActions = await storage.getAutonomyActions(account.id, { limit: 50 });
      const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
      const completedActionTypes = new Set(
        recentActions
          .filter(a => a.status === "completed" && (a.resolvedAt || a.executedAt) && new Date((a.resolvedAt || a.executedAt)!).getTime() > recentCutoff)
          .map(a => a.actionType)
      );
      // Only block truly in-flight actions — NOT "proposed" which just means evaluated
      // "proposed" actions deadlock the system by blocking re-evaluation forever
      const pendingActionTypes = new Set(
        recentActions
          .filter(a => ["approved", "executing", "pending_auth"].includes(a.status))
          .map(a => a.actionType)
      );
      const pendingActionKeys = new Set(
        recentActions
          .filter(a => ["approved", "executing", "pending_auth"].includes(a.status))
          .map(a => `${a.actionType}:${a.targetEntityId || ""}`)
      );

      const eligibleGaps = resolveDependencies(gaps, completedActionTypes);
      const recentCompleted = recentActions.filter(a => 
        a.status === "completed" && (a.resolvedAt || a.executedAt) && 
        new Date((a.resolvedAt || a.executedAt)!).getTime() > recentCutoff
      );
      const completedActionKeys = new Set(
        recentCompleted.map(a => `${a.actionType}:${a.targetEntityId || ""}`)
      );
      const newGaps = eligibleGaps.filter(g => {
        if (pendingActionTypes.has(g.actionType)) return false;
        if (completedActionTypes.has(g.actionType)) return false;
        const gapKey = `${g.actionType}:${g.context.provider || g.context.entityId || ""}`;
        if (pendingActionKeys.has(gapKey)) return false;
        if (completedActionKeys.has(gapKey)) return false;
        return true;
      });

      const dispatchedThisCycle = new Set<string>();
      let dispatched = 0;
      for (const gap of newGaps) {
        if (dispatched >= MAX_ACTIONS_PER_ACCOUNT) break;
        if (dispatchedThisCycle.has(gap.actionType)) continue;

        try {
          const result = await dispatchGap(account.id, gap, cycleId);
          actionsDispatched++;
          dispatched++;
          dispatchedThisCycle.add(gap.actionType);

          if (result.completed) actionsCompleted++;
          if (result.failed) actionsFailed++;
        } catch (err) {
          errors.push(`[${account.id}] Dispatch failed for ${gap.actionType}: ${(err as Error).message}`);
          actionsFailed++;
        }
      }
    } catch (err) {
      errors.push(`[${account.id}] Gap detection failed: ${(err as Error).message}`);
    }
  }

  try {
    await resumeBlockedActions();
  } catch (err) {
    errors.push(`Resume blocked actions failed: ${(err as Error).message}`);
  }

  const completedAt = new Date().toISOString();
  const result: OrchestrationCycleResult = {
    cycleId, startedAt, completedAt,
    accountsProcessed: activeAccounts.length,
    gapsDetected, actionsDispatched, actionsCompleted,
    actionsFailed, continuationsCompleted, errors,
  };

  emitUniversalEvent({
    eventType: "autonomy_cycle_completed",
    sourceModule: "autonomy_orchestrator",
    metadata: {
      cycleId,
      accountsProcessed: result.accountsProcessed,
      gapsDetected: result.gapsDetected,
      actionsDispatched: result.actionsDispatched,
      actionsCompleted: result.actionsCompleted,
      actionsFailed: result.actionsFailed,
      continuationsCompleted: result.continuationsCompleted,
      errorCount: result.errors.length,
    },
  });

  console.log(
    `[AUTONOMY-ORCH] Cycle ${cycleId} complete: ` +
    `${result.accountsProcessed} accounts, ${result.gapsDetected} gaps, ` +
    `${result.actionsDispatched} dispatched, ${result.actionsCompleted} completed, ` +
    `${result.actionsFailed} failed, ${result.continuationsCompleted} continuations, ` +
    `${result.errors.length} errors`
  );

  return result;
}

interface DispatchResult {
  actionId?: number;
  completed: boolean;
  failed: boolean;
  status: string;
}

async function dispatchGap(
  accountId: number,
  gap: DetectedGap,
  correlationId: string,
): Promise<DispatchResult> {
  const requiresAuth = gap.requiresAuth === true;

  if (requiresAuth) {
    const provider = gap.context.provider as string;
    if (provider) {
      const staged = await stageIntegration(accountId, provider);
      if (staged) {
        const policyResult = await evaluatePolicy({
          accountId,
          actionType: gap.actionType,
          actionCategory: gap.category,
          confidenceScore: gap.confidenceScore,
          targetModule: "integrations",
          targetEntityType: "integration",
          targetEntityId: provider,
          reason: gap.description,
          explanation: `Pre-auth staging for ${provider} — awaiting human authorization`,
          status: "pending_auth",
          safetyClass: "require_review",
        });

        emitUniversalEvent({
          eventType: "autonomy_action_dispatched",
          sourceModule: "autonomy_orchestrator",
          subAccountId: accountId,
          metadata: {
            actionType: gap.actionType,
            correlationId,
            decision: "pending_auth",
            safetyClass: policyResult.safetyClass,
            requiresAuth: true,
            provider,
          },
        });

        return {
          actionId: policyResult.action.id,
          completed: false,
          failed: false,
          status: "pending_auth",
        };
      }
    }
  }

  const hasExternalAuth = !!gap.context.integrationType;
  const connection = hasExternalAuth
    ? await storage.getIntegrationConnection(accountId, gap.context.integrationKey as string || "")
    : null;
  const hasExternalAuthSatisfied = connection?.status === "connected";

  const policyResult = await evaluatePolicy({
    accountId,
    actionType: gap.actionType,
    actionCategory: gap.category,
    confidenceScore: gap.confidenceScore,
    targetModule: gap.context.targetModule as string | undefined,
    targetEntityType: gap.context.entityType as string | undefined,
    targetEntityId: gap.context.entityId as string | undefined,
    reason: gap.description,
    explanation: `Orchestrator detected gap: ${gap.gapType}`,
  });

  emitUniversalEvent({
    eventType: "autonomy_action_dispatched",
    sourceModule: "autonomy_orchestrator",
    subAccountId: accountId,
    metadata: {
      actionType: gap.actionType,
      correlationId,
      decision: policyResult.decision,
      safetyClass: policyResult.safetyClass,
      gapType: gap.gapType,
      priority: gap.priority,
    },
  });

  if (policyResult.decision === "approve") {
    return await executeAndRecordAction(
      accountId, gap.actionType, gap.category, gap.context,
      correlationId, policyResult.action.id,
    );
  }

  return {
    actionId: policyResult.action.id,
    completed: false,
    failed: false,
    status: policyResult.decision,
  };
}

async function executeAndRecordAction(
  accountId: number,
  actionType: string,
  category: ActionCategory,
  context: Record<string, unknown>,
  correlationId: string,
  autonomyActionId: number,
): Promise<DispatchResult> {
  const actionResult = await executeAction({
    accountId,
    actionType,
    category,
    params: context,
    triggeredBy: "autonomy_orchestrator",
    correlationId,
  });

  const completed = actionResult.success;
  const failed = !actionResult.success;

  if (completed) {
    await storage.updateAutonomyAction(autonomyActionId, {
      status: "completed",
      executedAt: new Date(),
      resolvedAt: new Date(),
      executionResult: actionResult as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    });
  } else {
    await storage.updateAutonomyAction(autonomyActionId, {
      status: "failed",
      executedAt: new Date(),
      resolvedAt: new Date(),
      executionResult: { error: actionResult.error } as Record<string, unknown>,
      updatedAt: new Date(),
    });
  }

  emitAutonomyActionResult(accountId, actionType, completed, {
    correlationId,
    error: failed ? actionResult.error : undefined,
  });

  // Report to Apex Intelligence brain (fire-and-forget)
  import("../operator/apexIntelligence").then(({ reportOutcome }) => reportOutcome({
    agentName:    "operator",
    action:       completed ? "action_completed" : "action_failed",
    subject:      actionType,
    result:       completed
      ? `Autonomy action ${actionType} completed successfully`
      : `Autonomy action ${actionType} failed: ${actionResult.error || "unknown error"}`,
    confidence:   completed ? 0.9 : 0.3,
    subAccountId: accountId,
    metadata: {
      actionType,
      category:         String(category),
      correlationId,
      autonomyActionId,
    },
  // allow-silent-catch: fire-and-forget telemetry
  })).catch(() => {});

  return {
    actionId: autonomyActionId,
    completed,
    failed,
    status: completed ? "completed" : "failed",
  };
}

async function resumeBlockedActions(): Promise<void> {
  const pendingAuthActions = await storage.getAutonomyActionsByStatus("pending_auth", 100);

  for (const action of pendingAuthActions) {
    try {
      const provider = action.targetEntityId || "";
      const connection = await storage.getIntegrationConnection(action.accountId, provider);

      if (connection?.status === "connected") {
        await storage.updateAutonomyAction(action.id, {
          status: "executing",
          executedAt: new Date(),
          updatedAt: new Date(),
        });

        emitUniversalEvent({
          eventType: "autonomy_action_resumed",
          sourceModule: "autonomy_orchestrator",
          subAccountId: action.accountId,
          metadata: {
            actionId: action.id,
            actionType: action.actionType,
            reason: "auth_completed",
            provider,
          },
        });

        console.log(`[AUTONOMY-ORCH] Resuming action ${action.id} (${action.actionType}) — auth completed for ${provider}`);

        try {
          const category = (action.targetModule === "integrations" ? "setup" : "repair") as ActionCategory;
          const result = await executeAction({
            accountId: action.accountId,
            actionType: action.actionType,
            category,
            params: { provider, authCompleted: true },
            triggeredBy: "autonomy_orchestrator",
            correlationId: `resume_${action.id}`,
          });

          if (result.success) {
            await storage.updateAutonomyAction(action.id, {
              status: "completed",
              resolvedAt: new Date(),
              executionResult: result as unknown as Record<string, unknown>,
              updatedAt: new Date(),
            });
            console.log(`[AUTONOMY-ORCH] Resumed action ${action.id} completed successfully`);
          } else {
            await storage.updateAutonomyAction(action.id, {
              status: "failed",
              resolvedAt: new Date(),
              executionResult: { error: result.error } as Record<string, unknown>,
              updatedAt: new Date(),
            });
            console.warn(`[AUTONOMY-ORCH] Resumed action ${action.id} failed: ${result.error}`);
          }
        } catch (execErr) {
          await storage.updateAutonomyAction(action.id, {
            status: "failed",
            resolvedAt: new Date(),
            executionResult: { error: (execErr as Error).message } as Record<string, unknown>,
            updatedAt: new Date(),
          });
          console.error(`[AUTONOMY-ORCH] Resumed action ${action.id} execution error:`, (execErr as Error).message);
        }
      }
    } catch (err) {
      console.error(`[AUTONOMY-ORCH] Failed to check/resume action ${action.id}:`, (err as Error).message);
    }
  }

  const resumedActions = await storage.getAutonomyActionsByStatus("resumed", 100);
  for (const action of resumedActions) {
    try {
      const category = (action.targetModule === "integrations" ? "setup" : "repair") as ActionCategory;
      const result = await executeAction({
        accountId: action.accountId,
        actionType: action.actionType,
        category,
        params: { authCompleted: true },
        triggeredBy: "autonomy_orchestrator",
        correlationId: `resume_${action.id}`,
      });

      if (result.success) {
        await storage.updateAutonomyAction(action.id, {
          status: "completed",
          resolvedAt: new Date(),
          executionResult: result as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        });
      } else {
        await storage.updateAutonomyAction(action.id, {
          status: "failed",
          resolvedAt: new Date(),
          executionResult: { error: result.error } as Record<string, unknown>,
          updatedAt: new Date(),
        });
      }
    } catch (err) {
      console.error(`[AUTONOMY-ORCH] Failed to execute resumed action ${action.id}:`, (err as Error).message);
    }
  }
}

export function startOrchestrator(intervalMs: number = ORCHESTRATOR_INTERVAL_MS): void {
  if (orchestratorTimer) {
    console.warn("[AUTONOMY-ORCH] Orchestrator already running");
    return;
  }

  console.log(`[AUTONOMY-ORCH] Starting autonomy orchestrator (interval: ${intervalMs / 1000}s)`);

  setTimeout(() => {
    if (!isRunning) {
      isRunning = true;
      runOrchestrationCycle()
        .catch(err => {
          console.error("[AUTONOMY-ORCH] Initial cycle failed:", (err as Error).message);
        })
        .finally(() => { isRunning = false; });
    }
  }, 30_000);

  orchestratorTimer = setInterval(async () => {
    if (isRunning) {
      console.log("[AUTONOMY-ORCH] Skipping cycle — previous cycle still running");
      return;
    }

    isRunning = true;
    try {
      await runOrchestrationCycle();
    } catch (err) {
      console.error("[AUTONOMY-ORCH] Cycle failed:", (err as Error).message);
    } finally {
      isRunning = false;
    }
  }, intervalMs);
}

export function stopOrchestrator(): void {
  if (orchestratorTimer) {
    clearInterval(orchestratorTimer);
    orchestratorTimer = null;
    console.log("[AUTONOMY-ORCH] Orchestrator stopped");
  }
}
