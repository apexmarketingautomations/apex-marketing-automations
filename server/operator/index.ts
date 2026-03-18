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
  import("./cognitiveLayer").then(m => m.initCognitiveLayer()).catch(e => console.error("[OPERATOR] Cognitive layer init failed:", e instanceof Error ? e.message : e));
  import("./benchmarkAggregator").then(m => m.startBenchmarkScheduler()).catch((e) => {
    console.error("[BENCHMARKS] Failed to start scheduler:", e?.message);
  });
  import("./taskAgent").then(m => m.startTaskAgent()).catch((e) => {
    console.error("[TASK-AGENT] Failed to start:", e?.message);
  });
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
  const parts: string[] = [];

  const completedSteps = plan.steps.filter(s => s.status === "completed");
  const failedSteps = plan.steps.filter(s => s.status === "failed");

  if (plan.status === "completed") {
    parts.push(`✅ Completed: ${plan.userIntent}`);
  } else if (plan.status === "failed") {
    parts.push(`⚠️ Partially completed: ${plan.userIntent}`);
  } else {
    parts.push(`Plan: ${plan.userIntent}`);
  }

  parts.push("");

  for (const step of plan.steps) {
    const statusIcon = step.status === "completed" ? "✓" : step.status === "failed" ? "✗" : step.status === "awaiting_approval" ? "⏳" : "○";
    parts.push(`${statusIcon} ${step.description}`);

    if (step.result?.data) {
      const d = step.result.data;

      if (d.missing && Array.isArray(d.missing) && d.missing.length > 0) {
        parts.push("");
        parts.push("📋 Missing Items:");
        for (const item of d.missing) {
          parts.push(`  • ${item}`);
        }
      }

      if (d.recommendations && Array.isArray(d.recommendations) && d.recommendations.length > 0) {
        parts.push("");
        parts.push("💡 Recommendations:");
        for (const rec of d.recommendations) {
          parts.push(`  • ${rec}`);
        }
      }

      if (d.completionScore !== undefined) {
        const score = Math.max(0, Math.min(100, Math.round(Number(d.completionScore) || 0)));
        const filled = Math.round(score / 10);
        const bar = "█".repeat(filled) + "░".repeat(10 - filled);
        parts.push("");
        parts.push(`📊 Setup Completion: ${bar} ${score}%`);
      }

      if (d.integrations && typeof d.integrations === "object") {
        const connected = Object.entries(d.integrations).filter(([_, v]: [string, any]) => v === "connected" || v?.status === "connected");
        const disconnected = Object.entries(d.integrations).filter(([_, v]: [string, any]) => v !== "connected" && v?.status !== "connected");
        if (connected.length > 0 || disconnected.length > 0) {
          parts.push("");
          parts.push("🔌 Integration Status:");
          for (const [name] of connected) parts.push(`  ✓ ${name}`);
          for (const [name] of disconnected) parts.push(`  ✗ ${name}`);
        }
      }

      if (d.contactCount !== undefined || d.workflowCount !== undefined || d.messageCount !== undefined) {
        parts.push("");
        parts.push("📈 Key Metrics:");
        if (d.contactCount !== undefined) parts.push(`  • Contacts: ${d.contactCount}`);
        if (d.workflowCount !== undefined) parts.push(`  • Workflows: ${d.workflowCount}`);
        if (d.messageCount !== undefined) parts.push(`  • Messages: ${d.messageCount}`);
        if (d.dealCount !== undefined) parts.push(`  • Deals: ${d.dealCount}`);
      }

      if (d.workflowId !== undefined) {
        parts.push(`  → Workflow created (ID: ${d.workflowId})`);
      }
      if (d.landingPageUrl) {
        parts.push(`  → Landing page: ${d.landingPageUrl}`);
      }
    }

    if (step.error) {
      parts.push(`  ⚠ Error: ${step.error}`);
    }
  }

  if (completedSteps.length > 0 && plan.status === "completed") {
    parts.push("");
    parts.push("---");
    parts.push("Want me to start working on these? Just say \"do it\".");
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
