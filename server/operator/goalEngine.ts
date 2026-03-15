import { db } from "../db";
import { operatorGoals, operatorPlans, operatorPlanSteps } from "@shared/schema";
import { eq, and, desc, lte, inArray } from "drizzle-orm";
import { generatePlan } from "./goalPlanner";
import { executeReadySteps, isPlanComplete } from "./planExecutor";
import { measureGoalProgress } from "./goalTracker";
import { runScheduledReview, triggerFailureReview } from "./planReviewEngine";
import { recordEpisodicMemory as recordMemory, recallRelevantMemories as getRelevantMemories } from "./episodicMemory";
import { GOAL_TYPES, AUTO_ACTIVATABLE_GOAL_TYPES } from "./goalTypes";
import type { OperatorGoal, InsertOperatorGoal } from "@shared/schema";

export async function advanceGoalsForAccount(accountId: number): Promise<{ goalsProcessed: number; stepsExecuted: number }> {
  const activeGoals = await db.select().from(operatorGoals).where(
    and(eq(operatorGoals.accountId, accountId), inArray(operatorGoals.status, ["active", "blocked"]))
  );

  let totalSteps = 0;

  for (const goal of activeGoals) {
    try {
      const result = await advanceSingleGoal(goal);
      totalSteps += result.stepsExecuted;
    } catch (e) {
      console.log(`[GOAL-ENGINE] Error advancing goal #${goal.id}:`, (e as any).message);
    }
  }

  return { goalsProcessed: activeGoals.length, stepsExecuted: totalSteps };
}

async function advanceSingleGoal(goal: OperatorGoal): Promise<{ stepsExecuted: number }> {
  const activePlan = await db.select().from(operatorPlans)
    .where(and(eq(operatorPlans.goalId, goal.id), eq(operatorPlans.status, "active")))
    .orderBy(desc(operatorPlans.planVersion))
    .then(r => r[0]);

  if (!activePlan) {
    const memories = await getRelevantMemories(goal.accountId, `goal: ${goal.goalType}`, 5).catch(() => []);
    const pastExp = memories.map((m: any) => `- ${m.content}`).join("\n");
    const planId = await generatePlan(goal, pastExp);
    if (planId) {
      console.log(`[GOAL-ENGINE] Generated plan for goal #${goal.id}`);
    }
    return { stepsExecuted: 0 };
  }

  if (goal.nextReviewAt && goal.nextReviewAt <= new Date()) {
    await runScheduledReview(goal.id);
    const refreshed = await db.select().from(operatorGoals).where(eq(operatorGoals.id, goal.id)).then(r => r[0]);
    if (refreshed && refreshed.status !== "active") {
      return { stepsExecuted: 0 };
    }
  }

  const planCompletion = await isPlanComplete(activePlan.id);

  if (planCompletion.complete) {
    if (planCompletion.failed > 0 && planCompletion.failed >= planCompletion.completed) {
      await triggerFailureReview(goal.id, activePlan.id);
      return { stepsExecuted: 0 };
    }

    const progress = await measureGoalProgress(goal.id);
    if (progress.progressPct >= 100) {
      await db.update(operatorGoals).set({
        status: "completed",
        completedAt: new Date(),
        successScore: progress.progressPct,
        updatedAt: new Date(),
      }).where(eq(operatorGoals.id, goal.id));
      await db.update(operatorPlans).set({ status: "completed", updatedAt: new Date() }).where(eq(operatorPlans.id, activePlan.id));

      await recordMemory(goal.accountId, {
        memoryType: "outcome",
        content: `Goal achieved: "${goal.title}" — ${goal.targetMetric} reached ${progress.currentValue}/${goal.targetValue}`,
        relevanceScore: 95,
        tags: ["goal", "achieved", goal.goalType],
        sourceEvent: "goal_achieved",
        outcome: "success",
        context: { goalId: goal.id },
      }).catch(() => {});

      console.log(`[GOAL-ENGINE] Goal #${goal.id} completed!`);
      return { stepsExecuted: 0 };
    }

    await runScheduledReview(goal.id);
    return { stepsExecuted: 0 };
  }

  const result = await executeReadySteps(activePlan.id, goal.accountId);

  const allSteps = await db.select().from(operatorPlanSteps).where(eq(operatorPlanSteps.planId, activePlan.id));
  const permanentlyFailed = allSteps.filter(s => s.status === "failed" && (s.retryCount || 0) >= (s.maxRetries || 3));
  if (permanentlyFailed.length > 0) {
    await triggerFailureReview(goal.id, activePlan.id);
  }

  return { stepsExecuted: result.executed };
}

export async function createGoal(data: InsertOperatorGoal): Promise<OperatorGoal> {
  const goalDef = GOAL_TYPES[data.goalType];
  if (!goalDef) throw new Error(`Unknown goal type: ${data.goalType}`);

  const progress = await import("./goalTracker").then(m => m.measureGoalProgress).catch(() => null);

  const [goal] = await db.insert(operatorGoals).values({
    ...data,
    targetMetric: data.targetMetric || goalDef.defaultMetric,
    timeHorizonDays: data.timeHorizonDays || goalDef.defaultTimeHorizonDays,
    nextReviewAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }).returning();

  await recordMemory(goal.accountId, {
    memoryType: "decision",
    content: `New goal created: "${goal.title}" (${goal.goalType}) — target: ${goal.targetMetric} = ${goal.targetValue}`,
    relevanceScore: 80,
    tags: ["goal", "created", goal.goalType],
    sourceEvent: "goal_created",
    context: { goalId: goal.id },
  }).catch(() => {});

  console.log(`[GOAL-ENGINE] Goal #${goal.id} created: "${goal.title}"`);
  return goal;
}

export async function activateGoal(goalId: number): Promise<void> {
  const goal = await db.select().from(operatorGoals).where(eq(operatorGoals.id, goalId)).then(r => r[0]);
  if (!goal || goal.status !== "draft") throw new Error("Goal must be in draft status to activate");

  await db.update(operatorGoals).set({
    status: "active",
    startedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(operatorGoals.id, goalId));

  const memories = await getRelevantMemories(goal.accountId, `goal: ${goal.goalType}`, 5).catch(() => []);
  const pastExp = memories.map((m: any) => `- ${m.content}`).join("\n");
  await generatePlan(goal, pastExp);

  console.log(`[GOAL-ENGINE] Goal #${goalId} activated`);
}

export async function pauseGoal(goalId: number): Promise<void> {
  await db.update(operatorGoals).set({ status: "paused", updatedAt: new Date() }).where(eq(operatorGoals.id, goalId));
  console.log(`[GOAL-ENGINE] Goal #${goalId} paused`);
}

export async function resumeGoal(goalId: number): Promise<void> {
  await db.update(operatorGoals).set({ status: "active", updatedAt: new Date() }).where(eq(operatorGoals.id, goalId));
  console.log(`[GOAL-ENGINE] Goal #${goalId} resumed`);
}

export async function archiveGoal(goalId: number): Promise<void> {
  await db.update(operatorGoals).set({ status: "archived", updatedAt: new Date() }).where(eq(operatorGoals.id, goalId));
  console.log(`[GOAL-ENGINE] Goal #${goalId} archived`);
}

export async function forceReplan(goalId: number): Promise<number | null> {
  const goal = await db.select().from(operatorGoals).where(eq(operatorGoals.id, goalId)).then(r => r[0]);
  if (!goal) return null;

  const activePlan = await db.select().from(operatorPlans)
    .where(and(eq(operatorPlans.goalId, goalId), eq(operatorPlans.status, "active")))
    .orderBy(desc(operatorPlans.planVersion))
    .then(r => r[0]);

  if (!activePlan) {
    const memories = await getRelevantMemories(goal.accountId, `goal: ${goal.goalType}`, 5).catch(() => []);
    const pastExp = memories.map((m: any) => `- ${m.content}`).join("\n");
    return generatePlan(goal, pastExp);
  }

  const { generateReplan } = await import("./goalPlanner");
  return generateReplan(goal, activePlan.id);
}

export async function getGoalDetails(goalId: number) {
  const goal = await db.select().from(operatorGoals).where(eq(operatorGoals.id, goalId)).then(r => r[0]);
  if (!goal) return null;

  const plans = await db.select().from(operatorPlans)
    .where(eq(operatorPlans.goalId, goalId))
    .orderBy(desc(operatorPlans.planVersion));

  const activePlan = plans.find(p => p.status === "active");
  let steps: any[] = [];
  if (activePlan) {
    steps = await db.select().from(operatorPlanSteps)
      .where(eq(operatorPlanSteps.planId, activePlan.id))
      .orderBy(operatorPlanSteps.stepOrder);
  }

  const { getProgressHistory } = await import("./goalTracker");
  const progress = await getProgressHistory(goalId, 30);

  const reviews = await db.select().from(await import("@shared/schema").then(m => m.operatorGoalReviews))
    .where(eq((await import("@shared/schema").then(m => m.operatorGoalReviews)).goalId, goalId))
    .orderBy(desc((await import("@shared/schema").then(m => m.operatorGoalReviews)).createdAt))
    .limit(10);

  return { goal, plans, activePlan, steps, progress, reviews };
}

export async function getAccountGoals(accountId: number) {
  return db.select().from(operatorGoals)
    .where(eq(operatorGoals.accountId, accountId))
    .orderBy(desc(operatorGoals.createdAt));
}

export function hasActiveGoals(goals: OperatorGoal[]): boolean {
  return goals.some(g => g.status === "active");
}
