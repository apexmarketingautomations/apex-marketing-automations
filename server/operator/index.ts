import crypto from "crypto";
import type { OperatorContext, AutonomyLevel, OperatorPlan } from "./types";
import { interpretIntent, executePlan, approveAndContinue, rejectStep, getPlan, getActivePlans, getPlanHistory } from "./planner";
import { getToolManifest, listTools } from "./toolRegistry";
import { runDiagnostics, getDiagnosticHistory } from "./diagnostics";
import { collectSystemMetrics, getMetrics, getTimingStats } from "./telemetry";
import { getPendingApprovals, getApprovalHistory, resolveApproval } from "./approvals";
import { getSessionContext, listMemory } from "./memory";
import { initOperatorEventHooks } from "./eventHooks";
import { publishEventAsync } from "../eventBus";

export function initOperator(): void {
  initOperatorEventHooks();
  import("./cognitiveLayer").then(m => m.initCognitiveLayer()).catch(() => {});
  console.log(`[OPERATOR] Apex Operator initialized — ${getToolManifest().length} tools available`);
}

export function createOperatorContext(subAccountId: number, userId?: string, autonomyLevel: AutonomyLevel = "draft"): OperatorContext {
  return {
    subAccountId,
    userId,
    autonomyLevel,
    sessionId: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
  };
}

export async function processCommand(userIntent: string, context: OperatorContext): Promise<{
  plan: OperatorPlan;
  interpretation: string;
  requiresApproval: boolean;
  approvalSteps: string[];
}> {
  publishEventAsync("operator.command.received", {
    intent: userIntent, subAccountId: context.subAccountId, autonomyLevel: context.autonomyLevel,
  }, "operator");

  const plan = await interpretIntent(userIntent, context);

  const approvalSteps = plan.steps.filter(s => s.requiresApproval).map(s => s.description);
  const requiresApproval = approvalSteps.length > 0;

  const executedPlan = requiresApproval ? plan : await executePlan(plan.id, context);

  const interpretation = buildInterpretation(executedPlan);

  return {
    plan: executedPlan,
    interpretation,
    requiresApproval,
    approvalSteps,
  };
}

function buildInterpretation(plan: OperatorPlan): string {
  const parts: string[] = [`Plan: ${plan.userIntent}`];

  for (const step of plan.steps) {
    const statusIcon = step.status === "completed" ? "✓" : step.status === "failed" ? "✗" : step.status === "awaiting_approval" ? "⏳" : "○";
    parts.push(`  ${statusIcon} ${step.description}`);
    if (step.result?.data) {
      if (step.result.data.missing) {
        parts.push(`    Missing: ${step.result.data.missing.join(", ")}`);
      }
      if (step.result.data.recommendations) {
        parts.push(`    Recommendations: ${step.result.data.recommendations.join("; ")}`);
      }
      if (step.result.data.completionScore !== undefined) {
        parts.push(`    Setup completion: ${step.result.data.completionScore}%`);
      }
    }
    if (step.error) parts.push(`    Error: ${step.error}`);
  }

  return parts.join("\n");
}

export {
  getToolManifest,
  listTools,
  runDiagnostics,
  getDiagnosticHistory,
  collectSystemMetrics,
  getMetrics,
  getTimingStats,
  getPendingApprovals,
  getApprovalHistory,
  resolveApproval,
  getSessionContext,
  listMemory,
  getPlan,
  getActivePlans,
  getPlanHistory,
  approveAndContinue,
  rejectStep,
};
