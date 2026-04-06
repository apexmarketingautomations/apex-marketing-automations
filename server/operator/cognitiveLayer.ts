import { buildContext, buildPromptContext } from "./contextBuilder";
import { generateInsights } from "./advisoryEngine";
import { detectTrends } from "./trendDetection";
import { generateNudges, getActiveNudges, dismissNudge, actOnNudge, getNudgeHistory } from "./nudgeSystem";
import { recordBehaviorSignal, buildPerformanceSnapshot, storeMemory, recallMemory } from "./memoryEngine";
import { getAllMemories, deleteMemory, updateMemoryContent, recordEpisodicMemory, recallRelevantMemories, extractPreferencesFromChat } from "./episodicMemory";
import { getIndustryKnowledge, getAvailableIndustries } from "./industryKnowledge";
import { calculateHealthScore, generateGrowthReport, generateStrategicInsights, detectMissedOpportunities } from "./strategicAdvisor";
import type { ContextPacket, AdvisoryInsight, EpisodicMemory, EpisodicMemoryType } from "./cognitiveTypes";
import type { HealthScore, GrowthReport, StrategicInsight } from "./strategicAdvisor";

export async function getCognitiveContext(subAccountId: number): Promise<ContextPacket> {
  return buildContext(subAccountId);
}

export async function getCognitivePromptContext(subAccountId: number): Promise<string> {
  const context = await buildContext(subAccountId);
  return buildPromptContext(context);
}

export async function getCognitiveInsights(subAccountId: number): Promise<AdvisoryInsight[]> {
  const context = await buildContext(subAccountId);
  let readiness;
  try {
    const { checkAccountReadiness } = await import("./accountReadiness");
    readiness = await checkAccountReadiness(subAccountId);
  } catch {}
  return generateInsights(context, readiness);
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

export async function getHealthScore(subAccountId: number): Promise<HealthScore> {
  const context = await buildContext(subAccountId);
  return calculateHealthScore(context);
}

export async function getGrowthReport(subAccountId: number): Promise<GrowthReport> {
  const context = await buildContext(subAccountId);
  return generateGrowthReport(context);
}

export async function getStrategicInsights(subAccountId: number): Promise<StrategicInsight[]> {
  const context = await buildContext(subAccountId);
  return generateStrategicInsights(context);
}

export async function getMissedOpportunities(subAccountId: number): Promise<StrategicInsight[]> {
  const context = await buildContext(subAccountId);
  return detectMissedOpportunities(context);
}

export async function updateUserProfile(subAccountId: number, profileData: Record<string, any>): Promise<void> {
  for (const [key, value] of Object.entries(profileData)) {
    await storeMemory({
      subAccountId,
      memoryType: "workspace",
      key,
      value,
      confidence: 0.9,
      source: "user-input",
      version: 1,
    });
  }
}

export async function getUserProfile(subAccountId: number): Promise<Record<string, any>> {
  const memories = await recallMemory(subAccountId, "workspace");
  const profile: Record<string, any> = {};
  for (const m of memories) {
    profile[m.key] = m.value;
  }
  return profile;
}

export async function getAgentMemories(
  subAccountId: number,
  options: { limit?: number; offset?: number; memoryType?: string } = {}
): Promise<{ memories: EpisodicMemory[]; total: number }> {
  return getAllMemories(subAccountId, options);
}

export async function deleteAgentMemory(memoryId: number, subAccountId: number): Promise<boolean> {
  return deleteMemory(memoryId, subAccountId);
}

export async function updateAgentMemory(
  memoryId: number,
  subAccountId: number,
  updates: { content?: string; relevanceScore?: number; outcome?: string }
): Promise<boolean> {
  return updateMemoryContent(memoryId, subAccountId, updates);
}

export async function createAgentMemory(
  subAccountId: number,
  data: { memoryType: EpisodicMemoryType; content: string; category?: string; tags?: string[] }
): Promise<number | null> {
  return recordEpisodicMemory({
    subAccountId,
    memoryType: data.memoryType,
    content: data.content,
    category: data.category,
    relevanceScore: 0.8,
    decayRate: 0.005,
    sourceEvent: "user-created",
    tags: data.tags || [],
  });
}

export async function extractChatPreferences(subAccountId: number, message: string): Promise<number | null> {
  return extractPreferencesFromChat(subAccountId, message);
}

export function initCognitiveLayer(): void {
  console.log("[COGNITIVE] Cognitive Intelligence Layer v3 initialized");
  console.log("[COGNITIVE] Modules: memoryEngine, episodicMemory, contextBuilder, advisoryEngine, strategicAdvisor, trendDetection, nudgeSystem, industryKnowledge");
}
