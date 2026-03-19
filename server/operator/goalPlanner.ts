import { db } from "../db";
import { operatorGoals, operatorPlans, operatorPlanSteps, operatorStepDependencies } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { aiChat, isAIConfigured, isAIAvailable } from "../ai";
import { PLAN_GENERATION_SYSTEM_PROMPT, PLAN_GENERATION_USER_TEMPLATE, REPLAN_SYSTEM_PROMPT, REPLAN_USER_TEMPLATE } from "./goalPrompts";
import { GOAL_TYPES } from "./goalTypes";
import { storage } from "../storage";
import type { OperatorGoal } from "@shared/schema";

interface PlanStepRaw {
  idempotency_key: string;
  title: string;
  description: string;
  step_type: string;
  owner_type: string;
  tool_name: string | null;
  tool_payload: any;
  depends_on: string[];
  requires_approval: boolean;
  success_criteria: string;
}

interface PlanOutput {
  goal_summary: string;
  rationale: string;
  success_metric: { name: string; baseline: number; target: number };
  steps: PlanStepRaw[];
}

export async function generatePlan(goal: OperatorGoal, pastExperiences: string = ""): Promise<number | null> {
  if (!isAIAvailable()) {
    console.log("[GOAL-PLANNER] AI unavailable (not configured or rate-limited), cannot generate plan");
    return null;
  }

  const account = await storage.getSubAccount(goal.accountId);
  const contacts = await storage.getContacts(goal.accountId);
  const workflows = await storage.getWorkflows(goal.accountId);
  const integrations = await storage.getIntegrationConnections(goal.accountId);

  const goalDef = GOAL_TYPES[goal.goalType];
  const toolNames = goalDef?.suggestedTools?.join(", ") || "getAccountSummary, detectMissingSetup, createWorkflow, diagnoseWorkflow, checkIntegrationHealth, generateLandingPage, createPipeline, createContact, connectIntegration, launchCampaignDraft, sendTestSMS";

  const prompt = PLAN_GENERATION_USER_TEMPLATE
    .replace("{goalTitle}", goal.title)
    .replace("{goalType}", goal.goalType)
    .replace("{targetMetric}", goal.targetMetric)
    .replace("{baselineValue}", String(goal.baselineValue ?? 0))
    .replace("{targetValue}", String(goal.targetValue))
    .replace("{timeHorizonDays}", String(goal.timeHorizonDays))
    .replace("{goalDescription}", goal.description || "")
    .replace("{contactCount}", String(contacts?.length ?? 0))
    .replace("{messagesSent}", "0")
    .replace("{activeWorkflows}", String(workflows?.filter((w: any) => w.isActive)?.length ?? 0))
    .replace("{integrationsConnected}", String(integrations?.filter((i: any) => i.status === "connected")?.length ?? 0))
    .replace("{industry}", account?.industry || "unknown")
    .replace("{hasPhone}", account?.twilioNumber ? "yes" : "no")
    .replace("{hasLandingPage}", "unknown")
    .replace("{availableTools}", toolNames)
    .replace("{pastExperiences}", pastExperiences || "None recorded yet.");

  let planOutput = await callGeminiForPlan(PLAN_GENERATION_SYSTEM_PROMPT, prompt);

  if (!planOutput) {
    console.log("[GOAL-PLANNER] First attempt failed, retrying with repair prompt");
    planOutput = await callGeminiForPlan(
      PLAN_GENERATION_SYSTEM_PROMPT + "\n\nPREVIOUS ATTEMPT FAILED VALIDATION. Output strictly valid JSON only. No markdown.",
      prompt
    );
  }

  if (!planOutput) {
    console.log("[GOAL-PLANNER] Plan generation failed after retry");
    return null;
  }

  return await persistPlan(goal, planOutput, false);
}

export async function generateReplan(goal: OperatorGoal, currentPlanId: number, pastExperiences: string = ""): Promise<number | null> {
  if (!isAIAvailable()) return null;

  const currentPlan = await db.select().from(operatorPlans).where(eq(operatorPlans.id, currentPlanId)).then(r => r[0]);
  if (!currentPlan) return null;

  const steps = await db.select().from(operatorPlanSteps).where(eq(operatorPlanSteps.planId, currentPlanId));
  const completedSteps = steps.filter(s => s.status === "completed").map(s => `- ${s.title}: COMPLETED`).join("\n") || "None";
  const failedSteps = steps.filter(s => s.status === "failed").map(s => `- ${s.title}: FAILED (${s.failureReason || "unknown"})`).join("\n") || "None";
  const failureReasons = steps.filter(s => s.failureReason).map(s => `- ${s.title}: ${s.failureReason}`).join("\n") || "None";

  const daysElapsed = Math.floor((Date.now() - (goal.startedAt?.getTime() || goal.createdAt?.getTime() || Date.now())) / 86400000);
  const daysRemaining = Math.max(0, goal.timeHorizonDays - daysElapsed);

  const prompt = REPLAN_USER_TEMPLATE
    .replace("{goalTitle}", goal.title)
    .replace("{targetMetric}", goal.targetMetric)
    .replace("{baselineValue}", String(goal.baselineValue ?? 0))
    .replace("{targetValue}", String(goal.targetValue))
    .replace("{currentValue}", String(goal.currentValue ?? 0))
    .replace("{daysRemaining}", String(daysRemaining))
    .replace("{planSummary}", currentPlan.summary || "")
    .replace("{completedSteps}", completedSteps)
    .replace("{failedSteps}", failedSteps)
    .replace("{failureReasons}", failureReasons)
    .replace("{accountState}", "See goal context")
    .replace("{pastExperiences}", pastExperiences || "None");

  const planOutput = await callGeminiForPlan(REPLAN_SYSTEM_PROMPT, prompt);
  if (!planOutput) return null;

  await db.update(operatorPlans).set({ status: "superseded", updatedAt: new Date() }).where(eq(operatorPlans.id, currentPlanId));

  const newPlanId = await persistPlan(goal, planOutput, true);

  if (newPlanId) {
    await db.update(operatorPlans).set({ supersededByPlanId: newPlanId }).where(eq(operatorPlans.id, currentPlanId));
  }

  return newPlanId;
}

async function callGeminiForPlan(systemPrompt: string, userPrompt: string): Promise<PlanOutput | null> {
  try {
    const result = await aiChat(
      [
        { role: "user", content: systemPrompt + "\n\n" + userPrompt },
      ],
      { temperature: 0.3, maxTokens: 4096, jsonMode: true }
    );

    if (!result) return null;

    const cleaned = result.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned) as PlanOutput;

    if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      console.log("[GOAL-PLANNER] Invalid plan: no steps");
      return null;
    }

    for (const step of parsed.steps) {
      if (!step.idempotency_key || !step.title || !step.step_type) {
        console.log("[GOAL-PLANNER] Invalid step missing required fields:", step);
        return null;
      }
    }

    return parsed;
  } catch (e) {
    console.log("[GOAL-PLANNER] AI parse error:", (e as any).message);
    return null;
  }
}

async function persistPlan(goal: OperatorGoal, planOutput: PlanOutput, isReplan: boolean): Promise<number> {
  const existingPlans = await db.select()
    .from(operatorPlans)
    .where(eq(operatorPlans.goalId, goal.id))
    .orderBy(desc(operatorPlans.planVersion));

  const newVersion = existingPlans.length > 0 ? (existingPlans[0].planVersion + 1) : 1;

  const [plan] = await db.insert(operatorPlans).values({
    goalId: goal.id,
    accountId: goal.accountId,
    planVersion: newVersion,
    status: "active",
    summary: planOutput.goal_summary,
    rationale: planOutput.rationale,
    aiModel: "gemini",
  }).returning();

  const stepIdMap: Record<string, number> = {};

  for (let i = 0; i < planOutput.steps.length; i++) {
    const step = planOutput.steps[i];
    const [inserted] = await db.insert(operatorPlanSteps).values({
      planId: plan.id,
      goalId: goal.id,
      accountId: goal.accountId,
      stepOrder: i + 1,
      title: step.title,
      description: step.description,
      stepType: step.step_type,
      status: "pending",
      ownerType: step.owner_type || "agent",
      toolName: step.tool_name || null,
      toolPayload: step.tool_payload || null,
      idempotencyKey: step.idempotency_key,
      requiresApproval: step.requires_approval ?? false,
      successCriteria: step.success_criteria || null,
    }).returning();

    stepIdMap[step.idempotency_key] = inserted.id;
  }

  for (const step of planOutput.steps) {
    if (step.depends_on && step.depends_on.length > 0) {
      const stepId = stepIdMap[step.idempotency_key];
      for (const depKey of step.depends_on) {
        const depId = stepIdMap[depKey];
        if (depId) {
          await db.insert(operatorStepDependencies).values({
            stepId,
            dependsOnStepId: depId,
          });
        }
      }
    }
  }

  await resolveReadySteps(plan.id);

  console.log(`[GOAL-PLANNER] Plan v${newVersion} created for goal #${goal.id} with ${planOutput.steps.length} steps`);
  return plan.id;
}

export async function resolveReadySteps(planId: number): Promise<void> {
  const steps = await db.select().from(operatorPlanSteps).where(eq(operatorPlanSteps.planId, planId));
  const deps = await db.select().from(operatorStepDependencies);

  for (const step of steps) {
    if (step.status !== "pending") continue;

    const stepDeps = deps.filter(d => d.stepId === step.id);
    if (stepDeps.length === 0) {
      await db.update(operatorPlanSteps).set({ status: "ready", updatedAt: new Date() }).where(eq(operatorPlanSteps.id, step.id));
      continue;
    }

    const depSteps = steps.filter(s => stepDeps.some(d => d.dependsOnStepId === s.id));
    const mode = step.dependencyMode || "all";

    if (mode === "all") {
      if (depSteps.every(d => d.status === "completed")) {
        await db.update(operatorPlanSteps).set({ status: "ready", updatedAt: new Date() }).where(eq(operatorPlanSteps.id, step.id));
      }
    } else {
      if (depSteps.some(d => d.status === "completed")) {
        await db.update(operatorPlanSteps).set({ status: "ready", updatedAt: new Date() }).where(eq(operatorPlanSteps.id, step.id));
      }
    }
  }
}
