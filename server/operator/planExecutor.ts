import { db } from "../db";
import { operatorPlanSteps, operatorStepDependencies, operatorPlans, operatorGoals, operatorToolTrust } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getToolRegistry } from "./toolRegistry";
import { resolveReadySteps } from "./goalPlanner";
import { recordEpisodicMemory as recordMemory } from "./episodicMemory";

const IN_FLIGHT = new Set<number>();

export async function executeReadySteps(planId: number, accountId: number): Promise<{ executed: number; waiting: number; blocked: number }> {
  const plan = await db.select().from(operatorPlans).where(eq(operatorPlans.id, planId)).then(r => r[0]);
  if (!plan || plan.status !== "active") return { executed: 0, waiting: 0, blocked: 0 };

  await resolveReadySteps(planId);

  const steps = await db.select().from(operatorPlanSteps).where(
    and(eq(operatorPlanSteps.planId, planId), eq(operatorPlanSteps.status, "ready"))
  );

  let executed = 0;
  let waiting = 0;
  let blocked = 0;

  for (const step of steps) {
    if (IN_FLIGHT.has(step.id)) {
      blocked++;
      continue;
    }

    if (step.requiresApproval && step.ownerType !== "system") {
      await db.update(operatorPlanSteps).set({
        status: "waiting_approval",
        updatedAt: new Date(),
      }).where(eq(operatorPlanSteps.id, step.id));
      waiting++;
      console.log(`[PLAN-EXEC] Step #${step.id} "${step.title}" waiting for approval`);
      continue;
    }

    if (!step.toolName) {
      if (step.ownerType === "human") {
        await db.update(operatorPlanSteps).set({
          status: "waiting_approval",
          updatedAt: new Date(),
        }).where(eq(operatorPlanSteps.id, step.id));
        waiting++;
      } else {
        await db.update(operatorPlanSteps).set({
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
          result: { note: "Analysis step auto-completed" },
        }).where(eq(operatorPlanSteps.id, step.id));
        executed++;
      }
      continue;
    }

    IN_FLIGHT.add(step.id);
    try {
      await db.update(operatorPlanSteps).set({
        status: "running",
        updatedAt: new Date(),
      }).where(eq(operatorPlanSteps.id, step.id));

      const registry = getToolRegistry();
      const tool = registry.get(step.toolName);

      if (!tool) {
        await markStepFailed(step.id, `Tool "${step.toolName}" not found in registry`, planId, accountId);
        continue;
      }

      const result = await tool.execute(accountId, step.toolPayload || {});
      const success = result?.success !== false;

      if (success) {
        await db.update(operatorPlanSteps).set({
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
          result: result,
        }).where(eq(operatorPlanSteps.id, step.id));

        await updateToolTrust(accountId, step.toolName, true);

        await recordMemory(accountId, {
          memoryType: "outcome",
          content: `Goal plan step completed: "${step.title}" using ${step.toolName}`,
          relevanceScore: 70,
          tags: ["goal_step", "success", step.toolName],
          sourceEvent: "goal_step_complete",
          outcome: "success",
          context: { goalId: step.goalId, planId, stepId: step.id },
        }).catch(() => {});

        executed++;
        console.log(`[PLAN-EXEC] Step #${step.id} "${step.title}" completed successfully`);
      } else {
        await markStepFailed(step.id, result?.error || "Tool returned failure", planId, accountId);
        await updateToolTrust(accountId, step.toolName, false);
      }
    } catch (err: any) {
      await markStepFailed(step.id, err.message, planId, accountId);
    } finally {
      IN_FLIGHT.delete(step.id);
    }
  }

  await resolveReadySteps(planId);
  return { executed, waiting, blocked };
}

async function markStepFailed(stepId: number, reason: string, planId: number, accountId: number): Promise<void> {
  const step = await db.select().from(operatorPlanSteps).where(eq(operatorPlanSteps.id, stepId)).then(r => r[0]);
  if (!step) return;

  const newRetryCount = (step.retryCount || 0) + 1;
  const maxRetries = step.maxRetries || 3;

  if (newRetryCount < maxRetries) {
    await db.update(operatorPlanSteps).set({
      status: "ready",
      retryCount: newRetryCount,
      failureReason: reason,
      updatedAt: new Date(),
    }).where(eq(operatorPlanSteps.id, stepId));
    console.log(`[PLAN-EXEC] Step #${stepId} failed (attempt ${newRetryCount}/${maxRetries}): ${reason}`);
  } else {
    await db.update(operatorPlanSteps).set({
      status: "failed",
      retryCount: newRetryCount,
      failureReason: reason,
      updatedAt: new Date(),
    }).where(eq(operatorPlanSteps.id, stepId));
    console.log(`[PLAN-EXEC] Step #${stepId} permanently failed after ${maxRetries} attempts: ${reason}`);

    await recordMemory(accountId, {
      memoryType: "outcome",
      content: `Goal plan step FAILED: "${step.title}" - ${reason}`,
      relevanceScore: 85,
      tags: ["goal_step", "failure", step.toolName || "unknown"],
      sourceEvent: "goal_step_failed",
      outcome: "failure",
      context: { goalId: step.goalId, planId, stepId, reason },
    }).catch(() => {});
  }
}

export async function approveStep(stepId: number): Promise<boolean> {
  const step = await db.select().from(operatorPlanSteps).where(eq(operatorPlanSteps.id, stepId)).then(r => r[0]);
  if (!step || step.status !== "waiting_approval") return false;

  await db.update(operatorPlanSteps).set({
    status: "ready",
    updatedAt: new Date(),
  }).where(eq(operatorPlanSteps.id, stepId));

  console.log(`[PLAN-EXEC] Step #${stepId} "${step.title}" approved, now ready`);
  return true;
}

export async function isPlanComplete(planId: number): Promise<{ complete: boolean; allSteps: number; completed: number; failed: number }> {
  const steps = await db.select().from(operatorPlanSteps).where(eq(operatorPlanSteps.planId, planId));
  const completed = steps.filter(s => s.status === "completed" || s.status === "skipped").length;
  const failed = steps.filter(s => s.status === "failed").length;
  const total = steps.length;

  return {
    complete: completed + failed === total,
    allSteps: total,
    completed,
    failed,
  };
}

async function updateToolTrust(accountId: number, toolName: string, success: boolean): Promise<void> {
  try {
    const existing = await db.select().from(operatorToolTrust).where(
      and(eq(operatorToolTrust.accountId, accountId), eq(operatorToolTrust.toolName, toolName))
    ).then(r => r[0]);

    if (existing) {
      const updates: any = { updatedAt: new Date() };
      if (success) {
        updates.successfulDrafts = (existing.successfulDrafts || 0) + 1;
      } else {
        updates.failures = (existing.failures || 0) + 1;
      }
      const totalSuccess = (updates.successfulDrafts ?? existing.successfulDrafts ?? 0);
      const totalFail = (updates.failures ?? existing.failures ?? 0);
      const total = totalSuccess + totalFail;
      if (total >= 10 && totalFail === 0) updates.trustLevel = "high";
      else if (total >= 5 && totalFail <= 1) updates.trustLevel = "medium";
      else updates.trustLevel = "low";

      await db.update(operatorToolTrust).set(updates).where(eq(operatorToolTrust.id, existing.id));
    } else {
      await db.insert(operatorToolTrust).values({
        accountId,
        toolName,
        successfulDrafts: success ? 1 : 0,
        failures: success ? 0 : 1,
        trustLevel: "low",
      });
    }
  } catch (e) {
    console.log("[PLAN-EXEC] Trust update failed:", (e as any).message);
  }
}
