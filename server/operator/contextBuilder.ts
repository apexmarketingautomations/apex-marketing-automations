import type { ContextPacket } from "./cognitiveTypes";
import { buildWorkspaceProfile, buildBehaviorProfile, buildPerformanceSnapshot, getPatterns } from "./memoryEngine";
import { recallRelevantMemories, buildPastExperiencePrompt } from "./episodicMemory";
import { getIndustryKnowledge } from "./industryKnowledge";
import { getBenchmarksForIndustry } from "./benchmarkAggregator";
import { eventBus } from "../eventBus";
import { runDiagnostics } from "./diagnostics";
import { db } from "../db";
import { operatorNudges, sharedInsights } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

export async function buildContext(subAccountId: number): Promise<ContextPacket> {
  const [workspace, behavior, performance, patterns, pastExperiences] = await Promise.all([
    buildWorkspaceProfile(subAccountId),
    buildBehaviorProfile(subAccountId),
    buildPerformanceSnapshot(subAccountId),
    getPatterns(subAccountId),
    recallRelevantMemories(subAccountId, { limit: 15, minRelevance: 0.1 }),
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
  } catch (err: any) {
    console.error("[CONTEXT] Nudge count query failed:", err.message);
  }

  let diagnosticsSummary = "healthy";
  try {
    const checks = await runDiagnostics(subAccountId);
    const critical = checks.filter(c => c.severity === "critical").length;
    const warnings = checks.filter(c => c.severity === "warning").length;
    if (critical > 0) diagnosticsSummary = `${critical} critical issues`;
    else if (warnings > 0) diagnosticsSummary = `${warnings} warnings`;
  } catch (err: any) {
    console.error("[CONTEXT] Diagnostics run failed:", err.message);
  }

  const industryKnowledge = getIndustryKnowledge(workspace.industry);

  let crossAccountBenchmarks: ContextPacket["crossAccountBenchmarks"];
  try {
    crossAccountBenchmarks = await getBenchmarksForIndustry(workspace.industry);
    if (Object.keys(crossAccountBenchmarks || {}).length === 0) crossAccountBenchmarks = undefined;
  } catch {
    crossAccountBenchmarks = undefined;
  }

  let sharedInsightRows: Array<{ category: string; content: string }> | undefined;
  try {
    const rows = await db
      .select({ category: sharedInsights.category, content: sharedInsights.content })
      .from(sharedInsights)
      .where(eq(sharedInsights.orgId, 1))
      .orderBy(sql`confidence * occurrence_count * EXP(-decay_rate * EXTRACT(EPOCH FROM (NOW() - last_seen_at)) / 86400) DESC`)
      .limit(10);
    if (rows.length > 0) sharedInsightRows = rows;
  } catch {}

  return {
    workspace,
    behavior,
    performance,
    patterns,
    recentEvents,
    activeNudges,
    diagnosticsSummary,
    industryKnowledge,
    pastExperiences,
    crossAccountBenchmarks,
    sharedInsights: sharedInsightRows,
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

  if (context.crossAccountBenchmarks && Object.keys(context.crossAccountBenchmarks).length > 0) {
    parts.push("--- Cross-Account Industry Benchmarks (anonymized) ---");
    for (const [key, bm] of Object.entries(context.crossAccountBenchmarks)) {
      const b = bm as any;
      parts.push(`  ${key}: avg=${b.avg}, median=${b.median}, p75=${b.p75} (${b.sampleSize} accounts)`);
    }
  }

  if (context.patterns.length > 0) {
    const topPattern = context.patterns.sort((a, b) => b.confidence - a.confidence)[0];
    parts.push(`Detected pattern: ${topPattern.pattern} (confidence: ${Math.round(topPattern.confidence * 100)}%)`);
  }

  if (context.behavior.preferredStyle !== "balanced") {
    parts.push(`User prefers ${context.behavior.preferredStyle} communication style`);
  }

  if (context.pastExperiences && context.pastExperiences.length > 0) {
    parts.push("");
    parts.push(buildPastExperiencePrompt(context.pastExperiences));
  }

  if (context.sharedInsights && context.sharedInsights.length > 0) {
    parts.push("");
    parts.push("--- Customer Intelligence (from DM conversations) ---");
    for (const ins of context.sharedInsights) {
      parts.push(`  ${ins.category}: ${ins.content}`);
    }
  }

  return parts.join("\n");
}
