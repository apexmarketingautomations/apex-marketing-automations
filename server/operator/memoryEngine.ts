// @ts-nocheck
import { db } from "../db";
import { operatorMemories, contacts as contactsTable, messages as messagesTable } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import type { MemoryEntry, MemoryType, WorkspaceProfile, UserBehaviorProfile, PerformanceSnapshot, PatternInsight } from "./cognitiveTypes";
import { storage } from "../storage";
import { emitCognitiveMemoryStored } from "../intelligence/apexLearningFeed";

const DECAY_DAYS = 90;

export async function storeMemory(entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">): Promise<void> {
  const existing = await db.select().from(operatorMemories)
    .where(and(
      eq(operatorMemories.subAccountId, entry.subAccountId),
      eq(operatorMemories.memoryType, entry.memoryType),
      eq(operatorMemories.key, entry.key),
    ))
    .limit(1).execute().catch((err) => { console.warn("[MEMORYENGINE] promise rejected, using default []:", err instanceof Error ? err.message : err); return []; });

  const isUpdate = existing.length > 0;
  if (isUpdate) {
    await db.update(operatorMemories)
      .set({
        value: entry.value,
        confidence: entry.confidence,
        source: entry.source,
        version: (existing[0].version || 1) + 1,
        updatedAt: new Date(),
        expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null,
      })
      .where(eq(operatorMemories.id, existing[0].id))
      .execute().catch(e => console.error("[MEMORY-ENGINE] DB operation failed:", e instanceof Error ? e.message : e));
  } else {
    await db.insert(operatorMemories).values({
      subAccountId: entry.subAccountId,
      memoryType: entry.memoryType,
      key: entry.key,
      value: entry.value,
      confidence: entry.confidence,
      source: entry.source,
      version: entry.version || 1,
      expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null,
    }).execute().catch(e => console.error("[MEMORY-ENGINE] DB operation failed:", e instanceof Error ? e.message : e));
  }
  emitCognitiveMemoryStored(entry.subAccountId, entry.memoryType, entry.key, isUpdate);
}

export async function recallMemory(subAccountId: number, memoryType: MemoryType, key?: string): Promise<MemoryEntry[]> {
  let query = db.select().from(operatorMemories)
    .where(and(
      eq(operatorMemories.subAccountId, subAccountId),
      eq(operatorMemories.memoryType, memoryType),
      ...(key ? [eq(operatorMemories.key, key)] : []),
    ))
    .orderBy(desc(operatorMemories.updatedAt))
    .limit(100);

  const rows = await query.execute().catch((err) => { console.warn("[MEMORYENGINE] promise rejected, using default []:", err instanceof Error ? err.message : err); return []; });

  return rows.filter(r => {
    if (r.expiresAt && new Date(r.expiresAt) < new Date()) return false;
    return true;
  }).map(r => ({
    id: r.id,
    subAccountId: r.subAccountId,
    memoryType: r.memoryType as MemoryType,
    key: r.key,
    value: r.value,
    confidence: r.confidence || 0.5,
    source: r.source || "system",
    version: r.version || 1,
    createdAt: r.createdAt?.toISOString(),
    updatedAt: r.updatedAt?.toISOString(),
    expiresAt: r.expiresAt?.toISOString(),
  }));
}

export async function buildWorkspaceProfile(subAccountId: number): Promise<WorkspaceProfile> {
  const account = await storage.getSubAccount(subAccountId);
  // Use capped query for contacts — only need count, not full rows
  const contactRows = await db.select({ id: contactsTable.id })
    .from(contactsTable).where(eq(contactsTable.subAccountId, subAccountId)).limit(5000)
    .catch(() => [] as { id: number }[]); // allow-silent-catch: telemetry snapshot — empty count is acceptable if DB read fails
  const automations = await storage.getLiveAutomations(subAccountId);
  const connections = await storage.getIntegrationConnections(subAccountId);
  const stages = await storage.getPipelineStages(subAccountId);
  const sites = await storage.getSavedSites(subAccountId);

  const workspace: WorkspaceProfile = {
    industry: account?.industry || "unknown",
    businessName: (account as any)?.businessName || account?.name || "Unknown",
    phoneConfigured: !!account?.twilioNumber,
    integrationCount: connections?.filter((c: any) => c.status === "connected").length || 0,
    automationCount: automations?.length || 0,
    contactCount: contactRows.length,
    siteCount: sites?.length || 0,
  };

  const workspaceMemories = await recallMemory(subAccountId, "workspace");
  for (const m of workspaceMemories) {
    if (m.key === "target_market") workspace.targetMarket = m.value;
    if (m.key === "services") workspace.services = m.value;
    if (m.key === "lead_sources") workspace.leadSources = m.value;
    if (m.key === "pricing_model") workspace.pricingModel = m.value;
    if (m.key === "location") workspace.location = m.value;
  }

  await storeMemory({
    subAccountId, memoryType: "workspace", key: "profile_snapshot",
    value: workspace, confidence: 0.9, source: "system", version: 1,
  });

  return workspace;
}

export async function buildBehaviorProfile(subAccountId: number): Promise<UserBehaviorProfile> {
  const behaviors = await recallMemory(subAccountId, "behavior");

  const defaults: UserBehaviorProfile = {
    recommendationAcceptRate: 0.5,
    avgResponseTimeMs: 0,
    preferredStyle: "balanced",
    complexityTolerance: "medium",
    ignoreCount: 0,
    acceptCount: 0,
    lastInteraction: new Date().toISOString(),
    nudgesShown: 0,
    nudgesDismissed: 0,
  };

  for (const b of behaviors) {
    if (b.key === "accept_rate") defaults.recommendationAcceptRate = b.value;
    if (b.key === "preferred_style") defaults.preferredStyle = b.value;
    if (b.key === "complexity_tolerance") defaults.complexityTolerance = b.value;
    if (b.key === "ignore_count") defaults.ignoreCount = b.value;
    if (b.key === "accept_count") defaults.acceptCount = b.value;
    if (b.key === "nudges_shown") defaults.nudgesShown = b.value;
    if (b.key === "nudges_dismissed") defaults.nudgesDismissed = b.value;
    if (b.key === "last_interaction") defaults.lastInteraction = b.value;
  }

  const total = defaults.acceptCount + defaults.ignoreCount;
  if (total > 0) {
    defaults.recommendationAcceptRate = defaults.acceptCount / total;
  }

  return defaults;
}

export async function buildPerformanceSnapshot(subAccountId: number): Promise<PerformanceSnapshot> {
  // Use capped queries — never load full tables for metrics
  const contacts = await db.select({ id: contactsTable.id })
    .from(contactsTable).where(eq(contactsTable.subAccountId, subAccountId)).limit(5000)
    .catch(() => [] as { id: number }[]); // allow-silent-catch: performance snapshot — empty count is acceptable if DB read fails
  const messages = await db.select({ direction: messagesTable.direction, status: messagesTable.status, createdAt: messagesTable.createdAt })
    .from(messagesTable).where(eq(messagesTable.subAccountId, subAccountId)).orderBy(desc(messagesTable.createdAt)).limit(500)
    .catch(() => [] as { direction: string; status: string; createdAt: Date }[]); // allow-silent-catch: performance snapshot — empty list is acceptable if DB read fails
  const automations = await storage.getLiveAutomations(subAccountId);

  const inbound = messages?.filter((m: any) => m.direction === "inbound").length || 0;
  const outbound = messages?.filter((m: any) => m.direction === "outbound").length || 0;
  const failed = messages?.filter((m: any) => m.status === "failed").length || 0;
  const active = automations?.filter((a: any) => a.status === "active" || a.status === "compiled").length || 0;

  const snapshot: PerformanceSnapshot = {
    subAccountId,
    contactCount: contacts?.length || 0,
    messageCount: messages?.length || 0,
    inboundMessages: inbound,
    outboundMessages: outbound,
    failedMessages: failed,
    automationCount: automations?.length || 0,
    activeAutomations: active,
    timestamp: new Date().toISOString(),
  };

  await storeMemory({
    subAccountId, memoryType: "performance", key: "latest_snapshot",
    value: snapshot, confidence: 1.0, source: "system", version: 1,
  });

  return snapshot;
}

export async function recordPattern(subAccountId: number, insight: PatternInsight): Promise<void> {
  await storeMemory({
    subAccountId, memoryType: "pattern", key: insight.pattern,
    value: insight, confidence: insight.confidence, source: "trend-detection", version: 1,
  });
}

export async function getPatterns(subAccountId: number): Promise<PatternInsight[]> {
  const patterns = await recallMemory(subAccountId, "pattern");
  return patterns.map(p => p.value as PatternInsight);
}

export async function recordBehaviorSignal(subAccountId: number, signal: string, value: any): Promise<void> {
  await storeMemory({
    subAccountId, memoryType: "behavior", key: signal,
    value, confidence: 0.7, source: "behavior-tracker", version: 1,
  });
}

export async function recordNudgeResponse(subAccountId: number, accepted: boolean): Promise<void> {
  const key = accepted ? "accept_count" : "ignore_count";
  const current = (await recallMemory(subAccountId, "behavior", key))[0]?.value || 0;
  await storeMemory({
    subAccountId, memoryType: "behavior", key,
    value: current + 1, confidence: 0.9, source: "nudge-tracker", version: 1,
  });
}
