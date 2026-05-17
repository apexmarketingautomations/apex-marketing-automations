// @ts-nocheck
import { db } from "../db";
import { operatorGoals, operatorGoalProgress } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { storage } from "../storage";

export type ProgressTrend = "improving" | "stalled" | "regressing" | "complete" | "insufficient_data";

export async function measureGoalProgress(goalId: number): Promise<{
  currentValue: number;
  baselineValue: number;
  targetValue: number;
  progressPct: number;
  trend: ProgressTrend;
}> {
  const goal = await db.select().from(operatorGoals).where(eq(operatorGoals.id, goalId)).then(r => r[0]);
  if (!goal) throw new Error(`Goal ${goalId} not found`);

  const currentValue = await computeMetricValue(goal.accountId, goal.targetMetric, goal.goalType);

  await db.update(operatorGoals).set({ currentValue, updatedAt: new Date() }).where(eq(operatorGoals.id, goalId));

  await db.insert(operatorGoalProgress).values({
    goalId,
    accountId: goal.accountId,
    metricName: goal.targetMetric,
    metricValue: currentValue,
    source: "tracker",
  });

  const baseline = goal.baselineValue ?? 0;
  const target = goal.targetValue;
  const range = target - baseline;
  const progressPct = range !== 0 ? Math.round(((currentValue - baseline) / range) * 100) : (currentValue >= target ? 100 : 0);

  const history = await db.select()
    .from(operatorGoalProgress)
    .where(and(eq(operatorGoalProgress.goalId, goalId), eq(operatorGoalProgress.metricName, goal.targetMetric)))
    .orderBy(desc(operatorGoalProgress.recordedAt))
    .limit(5);

  let trend: ProgressTrend = "insufficient_data";
  if (history.length >= 3) {
    const values = history.map(h => h.metricValue).reverse();
    const isGoalDirectionUp = target > baseline;
    const recentChange = values[values.length - 1] - values[values.length - 3];

    if (progressPct >= 100) {
      trend = "complete";
    } else if (isGoalDirectionUp) {
      trend = recentChange > 0 ? "improving" : recentChange === 0 ? "stalled" : "regressing";
    } else {
      trend = recentChange < 0 ? "improving" : recentChange === 0 ? "stalled" : "regressing";
    }
  }

  return { currentValue, baselineValue: baseline, targetValue: target, progressPct: Math.min(progressPct, 100), trend };
}

async function computeMetricValue(accountId: number, metric: string, goalType: string): Promise<number> {
  try {
    switch (metric) {
      case "total_leads":
      case "reactivated_leads": {
        const contacts = await storage.getContacts(accountId);
        return contacts?.length ?? 0;
      }
      case "booked_appointments": {
        const appointments = await storage.getAppointments(accountId);
        return appointments?.length ?? 0;
      }
      case "setup_completion_pct": {
        return await computeSetupCompletion(accountId);
      }
      case "review_count": {
        const reviews = await storage.getReviews(accountId);
        return reviews?.length ?? 0;
      }
      case "active_workflows": {
        const workflows = await storage.getWorkflows(accountId);
        return workflows?.filter((w: any) => w.isActive)?.length ?? 0;
      }
      case "workflow_failure_rate": {
        return 0;
      }
      case "integrations_connected": {
        const integrations = await storage.getIntegrationConnections(accountId);
        return integrations?.filter((i: any) => i.status === "connected")?.length ?? 0;
      }
      case "avg_first_reply_minutes":
      case "conversion_rate_pct":
      case "cost_per_lead":
      case "landing_page_conversion_rate":
      case "form_submissions":
      case "booking_conversion_rate":
      case "no_show_rate":
      case "avg_rating":
      case "review_requests_sent":
      case "deal_close_rate":
      case "pipeline_velocity_days":
      default:
        return 0;
    }
  } catch (e) {
    console.log(`[GOAL-TRACKER] Failed to compute metric ${metric}:`, (e as any).message);
    return 0;
  }
}

async function computeSetupCompletion(accountId: number): Promise<number> {
  const account = await storage.getSubAccount(accountId);
  if (!account) return 0;

  let score = 0;
  let total = 5;

  if (account.twilioNumber && account.twilioNumber !== "pending") score++;
  const workflows = await storage.getWorkflows(accountId);
  if (workflows && workflows.length > 0) score++;
  const integrations = await storage.getIntegrationConnections(accountId);
  if (integrations && integrations.length > 0) score++;
  const contacts = await storage.getContacts(accountId);
  if (contacts && contacts.length > 0) score++;
  if (account.industry) score++;

  return Math.round((score / total) * 100);
}

export async function getProgressHistory(goalId: number, limit: number = 20) {
  return db.select()
    .from(operatorGoalProgress)
    .where(eq(operatorGoalProgress.goalId, goalId))
    .orderBy(desc(operatorGoalProgress.recordedAt))
    .limit(limit);
}
