import { db } from "../db";
import { workflowStepMetrics, workflowOptimizationLogs, workflows } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { storage } from "../storage";
import { aiChat, isAIConfigured } from "../aiGateway";
import type { WorkflowStepMetric, WorkflowOptimizationLog } from "@shared/schema";

export interface StepAnalytics {
  stepIndex: number;
  stepType: string;
  executionCount: number;
  successCount: number;
  failureCount: number;
  responseCount: number;
  successRate: number;
  failureRate: number;
  responseRate: number;
  dropOffRate: number;
  avgDurationMs: number;
  avgTimeToNextMs: number | null;
  isBottleneck: boolean;
}

export interface FunnelAnalytics {
  workflowId: number;
  workflowName: string;
  totalExecutions: number;
  overallCompletionRate: number;
  steps: StepAnalytics[];
  bottleneckSteps: number[];
  suggestions: OptimizationSuggestion[];
}

export interface OptimizationSuggestion {
  stepIndex: number;
  stepType: string;
  issue: string;
  suggestion: string;
  priority: number;
  category: 'timing' | 'messaging' | 'channel' | 'general';
}

export async function getWorkflowFunnelAnalytics(workflowId: number): Promise<FunnelAnalytics | null> {
  const workflow = await storage.getWorkflow(workflowId);
  if (!workflow) return null;

  const metrics = await storage.getWorkflowStepMetrics(workflowId);
  const steps = Array.isArray(workflow.steps) ? workflow.steps as any[] : [];

  if (metrics.length === 0) {
    return {
      workflowId,
      workflowName: workflow.name,
      totalExecutions: 0,
      overallCompletionRate: 0,
      steps: steps.map((step, i) => ({
        stepIndex: i,
        stepType: step.action_type || 'unknown',
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        responseCount: 0,
        successRate: 0,
        failureRate: 0,
        responseRate: 0,
        dropOffRate: 0,
        avgDurationMs: 0,
        avgTimeToNextMs: null,
        isBottleneck: false,
      })),
      bottleneckSteps: [],
      suggestions: [],
    };
  }

  const metricsMap = new Map<number, WorkflowStepMetric>();
  for (const m of metrics) {
    metricsMap.set(m.stepIndex, m);
  }

  const totalExecutions = metricsMap.get(0)?.executionCount || 0;
  const stepAnalytics: StepAnalytics[] = [];
  const bottleneckSteps: number[] = [];

  for (let i = 0; i < steps.length; i++) {
    const m = metricsMap.get(i);
    const execCount = m?.executionCount || 0;
    const successCount = m?.successCount || 0;
    const failureCount = m?.failureCount || 0;
    const responseCount = m?.responseCount || 0;
    const nextExec = metricsMap.get(i + 1)?.executionCount || 0;

    const successRate = execCount > 0 ? Math.round((successCount / execCount) * 100) : 0;
    const failureRate = execCount > 0 ? Math.round((failureCount / execCount) * 100) : 0;
    const responseRate = execCount > 0 ? Math.round((responseCount / execCount) * 100) : 0;
    const dropOffRate = (i < steps.length - 1 && execCount > 0)
      ? Math.round(((execCount - nextExec) / execCount) * 100)
      : 0;

    const avgDurationMs = execCount > 0 ? Math.round((m?.totalDurationMs || 0) / execCount) : 0;
    const isBottleneck = dropOffRate > 30 || failureRate > 20 || (responseRate < 10 && ['SMS', 'SendTwilioSMS', 'SendEmail', 'SendWhatsApp'].includes(steps[i]?.action_type));

    if (isBottleneck) bottleneckSteps.push(i);

    stepAnalytics.push({
      stepIndex: i,
      stepType: steps[i]?.action_type || m?.stepType || 'unknown',
      executionCount: execCount,
      successCount,
      failureCount,
      responseCount,
      successRate,
      failureRate,
      responseRate,
      dropOffRate,
      avgDurationMs,
      avgTimeToNextMs: m?.avgTimeToNextMs || null,
      isBottleneck,
    });
  }

  const lastStepExec = metricsMap.get(steps.length - 1)?.successCount || 0;
  const overallCompletionRate = totalExecutions > 0
    ? Math.round((lastStepExec / totalExecutions) * 100)
    : 0;

  const suggestions = generateRuleBasedSuggestions(stepAnalytics, steps);

  return {
    workflowId,
    workflowName: workflow.name,
    totalExecutions,
    overallCompletionRate,
    steps: stepAnalytics,
    bottleneckSteps,
    suggestions,
  };
}

function generateRuleBasedSuggestions(analytics: StepAnalytics[], steps: any[]): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];

  for (const step of analytics) {
    const stepDef = steps[step.stepIndex];

    if (step.failureRate > 20) {
      suggestions.push({
        stepIndex: step.stepIndex,
        stepType: step.stepType,
        issue: `Step ${step.stepIndex + 1} (${step.stepType}) has a ${step.failureRate}% failure rate`,
        suggestion: step.stepType === 'SMS' || step.stepType === 'SendTwilioSMS'
          ? 'Check phone number formatting and carrier delivery. Consider adding a retry step.'
          : step.stepType === 'SendEmail'
            ? 'Review email deliverability. Check for spam triggers in subject/body.'
            : `Investigate why this ${step.stepType} step is failing frequently.`,
        priority: 90,
        category: 'general',
      });
    }

    if (['SMS', 'SendTwilioSMS', 'SendEmail', 'SendWhatsApp'].includes(step.stepType) && step.responseRate < 10 && step.executionCount >= 10) {
      suggestions.push({
        stepIndex: step.stepIndex,
        stepType: step.stepType,
        issue: `Step ${step.stepIndex + 1} (${step.stepType}) has only a ${step.responseRate}% response rate`,
        suggestion: step.stepType.includes('SMS') || step.stepType === 'SendWhatsApp'
          ? 'Try shorter, more personalized messages. Consider sending at 10am-12pm local time instead of off-hours.'
          : 'Test a different subject line. Keep emails concise with a clear call-to-action.',
        priority: 75,
        category: 'messaging',
      });
    }

    if (step.dropOffRate > 40 && step.stepType === 'WAIT' || step.stepType === 'Wait') {
      const duration = stepDef?.params?.duration_minutes;
      suggestions.push({
        stepIndex: step.stepIndex,
        stepType: step.stepType,
        issue: `Step ${step.stepIndex + 1} (Wait ${duration ? duration + ' min' : ''}) has a ${step.dropOffRate}% drop-off rate`,
        suggestion: duration && duration > 30
          ? `Reduce wait from ${duration} minutes to ${Math.round(duration * 0.6)} minutes to reduce drop-off.`
          : 'The wait duration may be causing contacts to lose interest. Try reducing it.',
        priority: 70,
        category: 'timing',
      });
    }

    if (step.dropOffRate > 50) {
      suggestions.push({
        stepIndex: step.stepIndex,
        stepType: step.stepType,
        issue: `Step ${step.stepIndex + 1} (${step.stepType}) loses ${step.dropOffRate}% of contacts`,
        suggestion: 'This step is a major bottleneck. Consider simplifying or removing it, or adding a fallback path.',
        priority: 85,
        category: 'general',
      });
    }
  }

  return suggestions.sort((a, b) => b.priority - a.priority);
}

export async function generateAISuggestions(workflowId: number): Promise<OptimizationSuggestion[]> {
  if (!isAIConfigured()) return [];

  const analytics = await getWorkflowFunnelAnalytics(workflowId);
  if (!analytics || analytics.totalExecutions < 5) return [];

  try {
    const prompt = `Analyze this workflow performance and suggest optimizations:

Workflow: "${analytics.workflowName}"
Total Executions: ${analytics.totalExecutions}
Completion Rate: ${analytics.overallCompletionRate}%

Step Performance:
${analytics.steps.map(s => `  Step ${s.stepIndex + 1} (${s.stepType}): ${s.executionCount} executions, ${s.successRate}% success, ${s.responseRate}% response, ${s.dropOffRate}% drop-off`).join('\n')}

Bottleneck Steps: ${analytics.bottleneckSteps.map(i => `Step ${i + 1}`).join(', ') || 'None'}

Provide 1-3 specific, actionable optimization suggestions. Return JSON array:
[{ "stepIndex": 0, "stepType": "SMS", "issue": "...", "suggestion": "...", "priority": 80, "category": "timing|messaging|channel|general" }]`;

    const wfOptimizeAiResult = await aiChat([
      { role: "system", content: "You are a workflow optimization expert. Analyze performance metrics and suggest specific improvements. Return JSON only." },
      { role: "user", content: prompt },
    ], { temperature: 0.3, maxTokens: 1024, jsonMode: true, route: "workflow-analytics-ai-suggestions" });

    const cleaned = wfOptimizeAiResult.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return (Array.isArray(parsed) ? parsed : parsed.suggestions || []).slice(0, 3);
  } catch (err) {
    console.warn("[WORKFLOWANALYTICS] caught:", err instanceof Error ? err.message : err);
    return [];
  }
}

export async function applyAutoOptimization(workflowId: number): Promise<WorkflowOptimizationLog[]> {
  const analytics = await getWorkflowFunnelAnalytics(workflowId);
  if (!analytics || analytics.totalExecutions < 10) return [];

  const workflow = await storage.getWorkflow(workflowId);
  if (!workflow) return [];

  const steps = Array.isArray(workflow.steps) ? [...(workflow.steps as any[])] : [];
  const appliedChanges: WorkflowOptimizationLog[] = [];
  let modified = false;

  for (const step of analytics.steps) {
    const stepDef = steps[step.stepIndex];
    if (!stepDef) continue;

    if ((stepDef.action_type === 'WAIT' || stepDef.action_type === 'Wait') && step.dropOffRate > 35) {
      const currentDuration = stepDef.params?.duration_minutes;
      if (currentDuration && currentDuration > 2) {
        const newDuration = Math.max(1, Math.round(currentDuration * 0.7));
        const previousValue = { duration_minutes: currentDuration };
        stepDef.params.duration_minutes = newDuration;

        const log = await storage.createWorkflowOptimizationLog({
          workflowId,
          stepIndex: step.stepIndex,
          changeType: 'timing_adjustment',
          previousValue,
          newValue: { duration_minutes: newDuration },
          reason: `Wait step had ${step.dropOffRate}% drop-off. Reduced from ${currentDuration}min to ${newDuration}min.`,
          appliedBy: 'auto-optimize',
        });
        appliedChanges.push(log);
        modified = true;
      }
    }

    if (['SMS', 'SendTwilioSMS'].includes(stepDef.action_type) && step.responseRate < 8 && step.executionCount >= 15) {
      const log = await storage.createWorkflowOptimizationLog({
        workflowId,
        stepIndex: step.stepIndex,
        changeType: 'suggestion_logged',
        previousValue: { responseRate: step.responseRate },
        newValue: null,
        reason: `SMS step response rate is only ${step.responseRate}%. Consider rewriting the message or changing send time.`,
        appliedBy: 'auto-optimize',
      });
      appliedChanges.push(log);
    }
  }

  if (modified) {
    await storage.updateWorkflow(workflowId, { steps });
  }

  return appliedChanges;
}

export async function recordStepExecution(
  workflowId: number,
  stepIndex: number,
  stepType: string,
  success: boolean,
  durationMs: number = 0,
  responseReceived: boolean = false,
): Promise<void> {
  const existing = await db.select().from(workflowStepMetrics)
    .where(eq(workflowStepMetrics.workflowId, workflowId))
    .orderBy(workflowStepMetrics.stepIndex);

  const stepMetric = existing.find(m => m.stepIndex === stepIndex);

  if (stepMetric) {
    await db.update(workflowStepMetrics)
      .set({
        executionCount: stepMetric.executionCount + 1,
        successCount: success ? stepMetric.successCount + 1 : stepMetric.successCount,
        failureCount: !success ? stepMetric.failureCount + 1 : stepMetric.failureCount,
        responseCount: responseReceived ? stepMetric.responseCount + 1 : stepMetric.responseCount,
        totalDurationMs: stepMetric.totalDurationMs + durationMs,
        lastExecutedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflowStepMetrics.id, stepMetric.id));
  } else {
    await db.insert(workflowStepMetrics).values({
      workflowId,
      stepIndex,
      stepType,
      executionCount: 1,
      successCount: success ? 1 : 0,
      failureCount: !success ? 1 : 0,
      responseCount: responseReceived ? 1 : 0,
      totalDurationMs: durationMs,
      lastExecutedAt: new Date(),
    });
  }
}
