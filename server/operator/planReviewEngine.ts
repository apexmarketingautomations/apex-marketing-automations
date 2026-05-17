// @ts-nocheck
import { db } from "../db";
import { operatorGoals, operatorPlans, operatorPlanSteps, operatorGoalReviews } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { aiChat, isAIConfigured } from "../aiGateway";
import { REVIEW_SYSTEM_PROMPT, REVIEW_USER_TEMPLATE } from "./goalPrompts";
import { measureGoalProgress } from "./goalTracker";
import { generateReplan } from "./goalPlanner";
import { isPlanComplete } from "./planExecutor";
import { recordEpisodicMemory as recordMemory } from "./episodicMemory";
import type { ReviewDecision } from "./goalTypes";

interface ReviewResult {
  decision: ReviewDecision;
  summary: string;
  confidence: number;
  reasoning: string;
}

export async function runScheduledReview(goalId: number): Promise<ReviewResult | null> {
  const goal = await db.select().from(operatorGoals).where(eq(operatorGoals.id, goalId)).then(r => r[0]);
  if (!goal || !["active", "blocked"].includes(goal.status)) return null;

  const activePlan = await db.select().from(operatorPlans)
    .where(and(eq(operatorPlans.goalId, goalId), eq(operatorPlans.status, "active")))
    .orderBy(desc(operatorPlans.planVersion))
    .then(r => r[0]);

  if (!activePlan) return null;

  const progress = await measureGoalProgress(goalId);
  const planStatus = await isPlanComplete(activePlan.id);
  const steps = await db.select().from(operatorPlanSteps).where(eq(operatorPlanSteps.planId, activePlan.id));

  const daysElapsed = Math.floor((Date.now() - (goal.startedAt?.getTime() || goal.createdAt?.getTime() || Date.now())) / 86400000);

  let review: ReviewResult;

  if (isAIConfigured()) {
    const recentOutcomes = steps
      .filter(s => s.status === "completed" || s.status === "failed")
      .map(s => `- ${s.title}: ${s.status}${s.failureReason ? ` (${s.failureReason})` : ""}`)
      .join("\n") || "None yet";

    const prompt = REVIEW_USER_TEMPLATE
      .replace("{goalTitle}", goal.title)
      .replace("{goalType}", goal.goalType)
      .replace("{targetMetric}", goal.targetMetric)
      .replace("{targetValue}", String(goal.targetValue))
      .replace("{baselineValue}", String(progress.baselineValue))
      .replace("{currentValue}", String(progress.currentValue))
      .replace("{progressPct}", String(progress.progressPct))
      .replace("{daysElapsed}", String(daysElapsed))
      .replace("{timeHorizonDays}", String(goal.timeHorizonDays))
      .replace("{goalStatus}", goal.status)
      .replace("{planVersion}", String(activePlan.planVersion))
      .replace("{stepsCompleted}", String(planStatus.completed))
      .replace("{totalSteps}", String(planStatus.allSteps))
      .replace("{stepsFailed}", String(planStatus.failed))
      .replace("{recentOutcomes}", recentOutcomes)
      .replace("{progressTrend}", progress.trend);

    try {
      const reviewAiResult = await aiChat(
        [{ role: "user", content: REVIEW_SYSTEM_PROMPT + "\n\n" + prompt }],
        { temperature: 0.2, maxTokens: 1024, jsonMode: true, route: "plan-review-engine" }
      );

      if (reviewAiResult.text) {
        const cleaned = reviewAiResult.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        review = JSON.parse(cleaned);
      } else {
        review = fallbackReview(progress, planStatus, daysElapsed, goal.timeHorizonDays);
      }
    } catch (err) {
      console.warn("[PLANREVIEWENGINE] caught:", err instanceof Error ? err.message : err);
      review = fallbackReview(progress, planStatus, daysElapsed, goal.timeHorizonDays);
    }
  } else {
    review = fallbackReview(progress, planStatus, daysElapsed, goal.timeHorizonDays);
  }

  await db.insert(operatorGoalReviews).values({
    goalId,
    planId: activePlan.id,
    reviewType: "scheduled",
    summary: review.summary,
    decision: review.decision,
    metadata: { confidence: review.confidence, reasoning: review.reasoning },
  });

  await applyReviewDecision(goal, activePlan.id, review);

  const nextReview = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.update(operatorGoals).set({ nextReviewAt: nextReview, updatedAt: new Date() }).where(eq(operatorGoals.id, goalId));

  console.log(`[PLAN-REVIEW] Goal #${goalId} reviewed: ${review.decision} — ${review.summary}`);
  return review;
}

function fallbackReview(
  progress: { progressPct: number; trend: string },
  planStatus: { complete: boolean; failed: number; completed: number; allSteps: number },
  daysElapsed: number,
  timeHorizonDays: number
): ReviewResult {
  if (progress.progressPct >= 100) {
    return { decision: "complete", summary: "Target metric reached", confidence: 0.95, reasoning: "Progress is at or above 100%" };
  }

  if (planStatus.complete && planStatus.failed > planStatus.completed) {
    return { decision: "replan", summary: "Majority of steps failed", confidence: 0.8, reasoning: `${planStatus.failed}/${planStatus.allSteps} steps failed` };
  }

  if (planStatus.complete && planStatus.failed === 0) {
    return { decision: "complete", summary: "All steps completed successfully", confidence: 0.85, reasoning: "Plan fully executed" };
  }

  if (daysElapsed > timeHorizonDays && progress.progressPct < 50) {
    return { decision: "replan", summary: "Time expired with insufficient progress", confidence: 0.75, reasoning: `Only ${progress.progressPct}% progress after ${daysElapsed} days` };
  }

  if (progress.trend === "regressing") {
    return { decision: "replan", summary: "Progress is regressing", confidence: 0.7, reasoning: "Metrics trending downward" };
  }

  return { decision: "continue", summary: "On track, continuing current plan", confidence: 0.6, reasoning: `${progress.progressPct}% progress, ${progress.trend} trend` };
}

async function applyReviewDecision(goal: any, planId: number, review: ReviewResult): Promise<void> {
  switch (review.decision) {
    case "complete":
      await db.update(operatorGoals).set({
        status: "completed",
        completedAt: new Date(),
        successScore: review.confidence * 100,
        updatedAt: new Date(),
      }).where(eq(operatorGoals.id, goal.id));
      await db.update(operatorPlans).set({ status: "completed", updatedAt: new Date() }).where(eq(operatorPlans.id, planId));
      await recordMemory(goal.accountId, {
        memoryType: "outcome",
        content: `Goal completed: "${goal.title}" — ${review.summary}`,
        relevanceScore: 90,
        tags: ["goal", "completed", goal.goalType],
        sourceEvent: "goal_completed",
        outcome: "success",
        context: { goalId: goal.id },
      }).catch(e => console.error("[PLAN-REVIEW] Goal completion memory failed:", e instanceof Error ? e.message : e));
      break;

    case "replan":
      await generateReplan(goal, planId);
      await recordMemory(goal.accountId, {
        memoryType: "decision",
        content: `Goal replanned: "${goal.title}" — ${review.summary}`,
        relevanceScore: 80,
        tags: ["goal", "replan", goal.goalType],
        sourceEvent: "goal_replanned",
        context: { goalId: goal.id, reason: review.reasoning },
      }).catch(e => console.error("[PLAN-REVIEW] Goal replan memory failed:", e instanceof Error ? e.message : e));
      break;

    case "pause":
      await db.update(operatorGoals).set({ status: "paused", updatedAt: new Date() }).where(eq(operatorGoals.id, goal.id));
      await recordMemory(goal.accountId, {
        memoryType: "decision",
        content: `Goal paused: "${goal.title}" — ${review.summary}`,
        relevanceScore: 70,
        tags: ["goal", "paused", goal.goalType],
        sourceEvent: "goal_paused",
        context: { goalId: goal.id },
      }).catch(e => console.error("[PLAN-REVIEW] Goal pause memory failed:", e instanceof Error ? e.message : e));
      break;

    case "escalate":
      await db.update(operatorGoals).set({ status: "blocked", updatedAt: new Date() }).where(eq(operatorGoals.id, goal.id));
      break;

    case "continue":
    default:
      break;
  }
}

export async function triggerFailureReview(goalId: number, planId: number): Promise<void> {
  const goal = await db.select().from(operatorGoals).where(eq(operatorGoals.id, goalId)).then(r => r[0]);
  if (!goal) return;

  const result = await runScheduledReview(goalId);
  if (result) {
    console.log(`[PLAN-REVIEW] Failure-triggered review for goal #${goalId}: ${result.decision}`);
  }
}
