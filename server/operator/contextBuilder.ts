import type { ContextPacket } from "./cognitiveTypes";
import { buildWorkspaceProfile, buildBehaviorProfile, buildPerformanceSnapshot, getPatterns } from "./memoryEngine";
import { getIndustryKnowledge } from "./industryKnowledge";
import { eventBus } from "../eventBus";
import { runDiagnostics } from "./diagnostics";
import { db } from "../db";
import { operatorNudges } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export async function buildContext(subAccountId: number): Promise<ContextPacket> {
  const [workspace, behavior, performance, patterns] = await Promise.all([
    buildWorkspaceProfile(subAccountId),
    buildBehaviorProfile(subAccountId),
    buildPerformanceSnapshot(subAccountId),
    getPatterns(subAccountId),
  ]);

  const recentLog = eventBus.getLog(20);
  const recentEvents = recentLog
    .filter(e => e.event_type !== "*")
    .slice(-10)
    .map(e => ({
      type: e.event_type,
      at: e.timestamp,
      payload: { source: e.source_module, status: e.status },
    }));

  let activeNudges = 0;
  try {
    const nudges = await db.select().from(operatorNudges)
      .where(and(
        eq(operatorNudges.subAccountId, subAccountId),
        eq(operatorNudges.status, "pending"),
      ))
      .execute();
    activeNudges = nudges.length;
  } catch {}

  let diagnosticsSummary = "healthy";
  try {
    const checks = await runDiagnostics(subAccountId);
    const critical = checks.filter(c => c.severity === "critical").length;
    const warnings = checks.filter(c => c.severity === "warning").length;
    if (critical > 0) diagnosticsSummary = `${critical} critical issues`;
    else if (warnings > 0) diagnosticsSummary = `${warnings} warnings`;
  } catch {}

  const industryKnowledge = getIndustryKnowledge(workspace.industry);

  return {
    workspace,
    behavior,
    performance,
    patterns,
    recentEvents,
    activeNudges,
    diagnosticsSummary,
    industryKnowledge,
  };
}

export function buildPromptContext(context: ContextPacket): string {
  const parts: string[] = [];

  parts.push(`Business: ${context.workspace.businessName} (${context.workspace.industry})`);
  parts.push(`Contacts: ${context.workspace.contactCount} | Messages: ${context.performance.messageCount} | Automations: ${context.workspace.automationCount}`);
  parts.push(`Integrations: ${context.workspace.integrationCount} | Phone: ${context.workspace.phoneConfigured ? "Yes" : "No"} | Sites: ${context.workspace.siteCount}`);

  if (context.performance.failedMessages > 0) {
    parts.push(`Warning: ${context.performance.failedMessages} failed messages detected`);
  }

  if (context.diagnosticsSummary !== "healthy") {
    parts.push(`System health: ${context.diagnosticsSummary}`);
  }

  if (context.industryKnowledge) {
    const ik = context.industryKnowledge;
    parts.push(`Industry: ${ik.industry}`);
    parts.push(`Response time benchmark: ${ik.avgResponseTimeBenchmark}s`);
    if (ik.tips.length > 0) parts.push(`Key insight: ${ik.tips[0]}`);
  }

  if (context.patterns.length > 0) {
    const topPattern = context.patterns.sort((a, b) => b.confidence - a.confidence)[0];
    parts.push(`Detected pattern: ${topPattern.pattern} (confidence: ${Math.round(topPattern.confidence * 100)}%)`);
  }

  if (context.behavior.preferredStyle !== "balanced") {
    parts.push(`User prefers ${context.behavior.preferredStyle} communication style`);
  }

  return parts.join("\n");
}
