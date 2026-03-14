import { buildContext, buildPromptContext } from "./contextBuilder";
import { generateInsights } from "./advisoryEngine";
import { detectTrends } from "./trendDetection";
import { generateNudges, getActiveNudges, dismissNudge, actOnNudge, getNudgeHistory } from "./nudgeSystem";
import { recordBehaviorSignal, buildPerformanceSnapshot } from "./memoryEngine";
import { getIndustryKnowledge, getAvailableIndustries } from "./industryKnowledge";
import type { ContextPacket, AdvisoryInsight } from "./cognitiveTypes";

export async function getCognitiveContext(subAccountId: number): Promise<ContextPacket> {
  return buildContext(subAccountId);
}

export async function getCognitivePromptContext(subAccountId: number): Promise<string> {
  const context = await buildContext(subAccountId);
  return buildPromptContext(context);
}

export async function getCognitiveInsights(subAccountId: number): Promise<AdvisoryInsight[]> {
  const context = await buildContext(subAccountId);
  return generateInsights(context);
}

export async function runTrendDetection(subAccountId: number): Promise<any[]> {
  const snapshot = await buildPerformanceSnapshot(subAccountId);
  return detectTrends(subAccountId, snapshot);
}

export async function getCognitiveNudges(subAccountId: number): Promise<any[]> {
  const context = await buildContext(subAccountId);
  return generateNudges(subAccountId, context);
}

export async function getPendingNudges(subAccountId: number): Promise<any[]> {
  return getActiveNudges(subAccountId);
}

export async function handleNudgeDismiss(nudgeId: number, subAccountId: number): Promise<boolean> {
  return dismissNudge(nudgeId, subAccountId);
}

export async function handleNudgeAction(nudgeId: number, subAccountId: number): Promise<boolean> {
  return actOnNudge(nudgeId, subAccountId);
}

export async function getCognitiveNudgeHistory(subAccountId: number): Promise<any[]> {
  return getNudgeHistory(subAccountId);
}

export async function getIndustryInfo(industry: string): Promise<any> {
  return getIndustryKnowledge(industry);
}

export async function listIndustries(): Promise<string[]> {
  return getAvailableIndustries();
}

export async function trackUserAction(subAccountId: number, action: string, value: any): Promise<void> {
  await recordBehaviorSignal(subAccountId, action, value);
}

export function initCognitiveLayer(): void {
  console.log("[COGNITIVE] Cognitive Intelligence Layer initialized");
  console.log("[COGNITIVE] Modules: memoryEngine, contextBuilder, advisoryEngine, trendDetection, nudgeSystem, industryKnowledge");
}
