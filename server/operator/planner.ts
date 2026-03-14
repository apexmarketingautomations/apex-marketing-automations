import crypto from "crypto";
import type { OperatorPlan, PlanStep, OperatorContext, AutonomyLevel } from "./types";
import { getToolManifest, getTool, executeTool } from "./toolRegistry";
import { createApproval, getApproval } from "./approvals";
import { recordOperatorAction, setMemory, getMemory } from "./memory";
import { publishEventAsync } from "../eventBus";
import { incrementCounter, recordTiming } from "./telemetry";

const activePlans = new Map<string, OperatorPlan>();
const planHistory: OperatorPlan[] = [];
const MAX_HISTORY = 200;

const INTENT_PATTERNS: Array<{
  pattern: RegExp;
  tools: Array<{ name: string; paramBuilder: (match: RegExpMatchArray, intent: string) => Record<string, any> }>;
  description: string;
}> = [
  {
    pattern: /(?:onboard|set\s*up|configure|initialize)\s+(?:a\s+)?(?:new\s+)?(?:user|account|business)/i,
    tools: [
      { name: "detectMissingSetup", paramBuilder: () => ({}) },
      { name: "getAccountSummary", paramBuilder: () => ({}) },
    ],
    description: "Onboard new user — detect missing setup and provide summary",
  },
  {
    pattern: /(?:connect|set\s*up|configure|enable)\s+(\w+)\s+(?:integration|connection)/i,
    tools: [
      { name: "connectIntegration", paramBuilder: (match) => ({ provider: match[1].toLowerCase() }) },
    ],
    description: "Connect integration",
  },
  {
    pattern: /(?:connect|set\s*up)\s+(?:all\s+)?(?:required\s+)?integrations/i,
    tools: [
      { name: "checkIntegrationHealth", paramBuilder: () => ({}) },
      { name: "detectMissingSetup", paramBuilder: () => ({}) },
    ],
    description: "Check and connect required integrations",
  },
  {
    pattern: /(?:build|create|make|set\s*up)\s+(?:a\s+)?(?:first\s+)?(?:workflow|automation)/i,
    tools: [
      { name: "createWorkflow", paramBuilder: (_m, intent) => ({
        name: "Lead Auto-Response",
        trigger: "new_lead",
        steps: [
          { action: "WAIT", duration: 5, unit: "seconds" },
          { action: "SMS", message: "Hi {{leadName}}, thanks for reaching out! We'll be in touch shortly." },
        ],
      })},
    ],
    description: "Build a first automation workflow",
  },
  {
    pattern: /(?:generate|create|build|make)\s+(?:a\s+)?(?:basic\s+)?(?:landing\s*page|site|webpage|form)/i,
    tools: [
      { name: "generateLandingPage", paramBuilder: (_m, intent) => ({ prompt: intent }) },
    ],
    description: "Generate a landing page",
  },
  {
    pattern: /(?:create|set\s*up|build|make)\s+(?:a\s+)?(?:crm\s+)?pipeline/i,
    tools: [
      { name: "createPipeline", paramBuilder: () => ({
        stages: [
          { name: "New Lead", color: "#6366f1" },
          { name: "Contacted", color: "#f59e0b" },
          { name: "Qualified", color: "#3b82f6" },
          { name: "Proposal", color: "#8b5cf6" },
          { name: "Won", color: "#22c55e" },
          { name: "Lost", color: "#ef4444" },
        ],
      })},
    ],
    description: "Create a CRM pipeline with default stages",
  },
  {
    pattern: /(?:detect|find|check|scan)\s+(?:for\s+)?(?:missing|incomplete)\s+(?:setup|config|pieces)/i,
    tools: [
      { name: "detectMissingSetup", paramBuilder: () => ({}) },
    ],
    description: "Detect missing setup pieces",
  },
  {
    pattern: /(?:diagnose|debug|check|analyze)\s+workflow\s+#?(\d+)/i,
    tools: [
      { name: "diagnoseWorkflow", paramBuilder: (match) => ({ workflowId: parseInt(match[1]) }) },
    ],
    description: "Diagnose a specific workflow",
  },
  {
    pattern: /(?:send|fire)\s+(?:a\s+)?test\s+(?:sms|message|text)\s+(?:to\s+)?([+\d\-\s]+)/i,
    tools: [
      { name: "sendTestSMS", paramBuilder: (match) => ({ to: match[1].trim() }) },
    ],
    description: "Send a test SMS",
  },
  {
    pattern: /(?:what(?:'s| is)\s+(?:the\s+)?(?:status|state|summary|health)|show\s+(?:me\s+)?(?:account|dashboard|overview))/i,
    tools: [
      { name: "getAccountSummary", paramBuilder: () => ({}) },
      { name: "checkIntegrationHealth", paramBuilder: () => ({}) },
    ],
    description: "Get account status overview",
  },
  {
    pattern: /(?:fix|repair|recommend|suggest)\s+(?:safe\s+)?(?:fixes|improvements|actions)/i,
    tools: [
      { name: "detectMissingSetup", paramBuilder: () => ({}) },
      { name: "checkIntegrationHealth", paramBuilder: () => ({}) },
    ],
    description: "Detect issues and recommend fixes",
  },
];

export async function interpretIntent(userIntent: string, context: OperatorContext): Promise<OperatorPlan> {
  const startTime = Date.now();
  const plan: OperatorPlan = {
    id: crypto.randomUUID(),
    sessionId: context.sessionId,
    subAccountId: context.subAccountId,
    userIntent,
    steps: [],
    status: "planning",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let matched = false;
  for (const pattern of INTENT_PATTERNS) {
    const match = userIntent.match(pattern.pattern);
    if (match) {
      matched = true;
      for (let i = 0; i < pattern.tools.length; i++) {
        const toolDef = pattern.tools[i];
        const tool = getTool(toolDef.name);
        if (!tool) continue;

        const params = toolDef.paramBuilder(match, userIntent);
        const needsApproval = tool.requiresApproval && context.autonomyLevel !== "execute";

        plan.steps.push({
          id: crypto.randomUUID(),
          order: i,
          toolName: toolDef.name,
          parameters: params,
          description: `${tool.description}`,
          status: needsApproval ? "awaiting_approval" : "pending",
          requiresApproval: needsApproval,
        });
      }
      break;
    }
  }

  if (!matched) {
    plan.steps.push({
      id: crypto.randomUUID(),
      order: 0,
      toolName: "detectMissingSetup",
      parameters: {},
      description: "Scanning account for context before AI planning",
      status: "pending",
      requiresApproval: false,
    });
    plan.steps.push({
      id: crypto.randomUUID(),
      order: 1,
      toolName: "getAccountSummary",
      parameters: {},
      description: "Getting account summary for AI context",
      status: "pending",
      requiresApproval: false,
    });
  }

  plan.status = plan.steps.some(s => s.requiresApproval) ? "awaiting_approval" : "ready";
  activePlans.set(plan.id, plan);

  recordTiming("operator.plan.creation", Date.now() - startTime);
  incrementCounter("operator.plans.created");

  return plan;
}

export async function executePlan(planId: string, context: OperatorContext): Promise<OperatorPlan> {
  const plan = activePlans.get(planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);

  if (plan.status === "awaiting_approval") {
    const pendingApproval = plan.steps.find(s => s.status === "awaiting_approval");
    if (pendingApproval) {
      throw new Error(`Plan requires approval for step: ${pendingApproval.description}`);
    }
  }

  plan.status = "executing";
  plan.updatedAt = new Date().toISOString();
  const planStart = Date.now();

  for (const step of plan.steps.sort((a, b) => a.order - b.order)) {
    if (step.status === "completed" || step.status === "skipped") continue;

    if (step.requiresApproval && step.status === "awaiting_approval") {
      plan.status = "awaiting_approval";
      plan.updatedAt = new Date().toISOString();

      const approval = createApproval({
        planId: plan.id,
        stepId: step.id,
        subAccountId: context.subAccountId,
        toolName: step.toolName,
        description: step.description,
        parameters: step.parameters,
      });

      publishEventAsync("operator.approval.requested", {
        approvalId: approval.id, planId: plan.id, toolName: step.toolName,
        description: step.description, subAccountId: context.subAccountId,
      }, "operator");

      return plan;
    }

    step.status = "executing";
    const stepStart = Date.now();

    try {
      const result = await executeTool(step.toolName, step.parameters, context);
      step.result = result;
      step.status = result.success ? "completed" : "failed";
      if (!result.success) step.error = result.error;

      recordTiming("operator.step.execution", Date.now() - stepStart, { tool: step.toolName });
      incrementCounter(`operator.tool.${step.toolName}`, 1, { status: result.success ? "success" : "failure" });

      recordOperatorAction(context.subAccountId, step.toolName, {
        params: step.parameters,
        success: result.success,
        error: result.error,
      });

      if (!result.success) {
        plan.status = "failed";
        plan.error = `Step "${step.description}" failed: ${result.error}`;
        plan.updatedAt = new Date().toISOString();
        break;
      }
    } catch (err: any) {
      step.status = "failed";
      step.error = err.message || String(err);
      plan.status = "failed";
      plan.error = `Step "${step.description}" threw error: ${step.error}`;
      plan.updatedAt = new Date().toISOString();
      break;
    }
  }

  if (plan.status === "executing") {
    plan.status = "completed";
    plan.result = plan.steps.map(s => ({ tool: s.toolName, result: s.result }));
  }
  plan.updatedAt = new Date().toISOString();

  recordTiming("operator.plan.execution", Date.now() - planStart);
  incrementCounter("operator.plans.completed", 1, { status: plan.status });

  addToHistory(plan);

  publishEventAsync("operator.plan.completed", {
    planId: plan.id, status: plan.status, subAccountId: context.subAccountId,
    stepCount: plan.steps.length, intent: plan.userIntent,
  }, "operator");

  return plan;
}

export async function approveAndContinue(planId: string, stepId: string, context: OperatorContext): Promise<OperatorPlan> {
  const plan = activePlans.get(planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);

  const step = plan.steps.find(s => s.id === stepId);
  if (!step) throw new Error(`Step not found: ${stepId}`);

  step.status = "pending";
  step.requiresApproval = false;

  const remaining = plan.steps.filter(s => s.status === "awaiting_approval");
  if (remaining.length === 0) {
    plan.status = "ready";
  }

  return executePlan(planId, context);
}

export async function rejectStep(planId: string, stepId: string): Promise<OperatorPlan> {
  const plan = activePlans.get(planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);

  const step = plan.steps.find(s => s.id === stepId);
  if (!step) throw new Error(`Step not found: ${stepId}`);

  step.status = "skipped";

  const remaining = plan.steps.filter(s => s.status === "awaiting_approval");
  if (remaining.length === 0) {
    plan.status = "ready";
  }

  return plan;
}

export function getPlan(planId: string): OperatorPlan | null {
  return activePlans.get(planId) || planHistory.find(p => p.id === planId) || null;
}

export function getActivePlans(subAccountId?: number): OperatorPlan[] {
  let plans = [...activePlans.values()];
  if (subAccountId) plans = plans.filter(p => p.subAccountId === subAccountId);
  return plans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getPlanHistory(limit = 50, subAccountId?: number): OperatorPlan[] {
  let history = planHistory;
  if (subAccountId) history = history.filter(p => p.subAccountId === subAccountId);
  return history.slice(-limit);
}

function addToHistory(plan: OperatorPlan): void {
  activePlans.delete(plan.id);
  planHistory.push(plan);
  if (planHistory.length > MAX_HISTORY) {
    planHistory.splice(0, planHistory.length - MAX_HISTORY);
  }
}
