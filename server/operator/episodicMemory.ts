import { db } from "../db";
import { agentMemories } from "@shared/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import type { EpisodicMemory, EpisodicMemoryType } from "./cognitiveTypes";

const MAX_MEMORIES_PER_ACCOUNT = 500;

interface MemoryRow {
  id: number;
  sub_account_id: number;
  memory_type: string;
  content: string;
  category: string | null;
  relevance_score: number;
  decay_rate: number;
  source_event: string | null;
  source_context: Record<string, unknown> | null;
  outcome: string | null;
  tags: string[] | null;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string | null;
  effective_relevance?: number;
}

export async function recordEpisodicMemory(
  entry: Omit<EpisodicMemory, "id" | "createdAt" | "accessCount" | "lastAccessedAt">
): Promise<number | null> {
  try {
    const [inserted] = await db.insert(agentMemories).values({
      subAccountId: entry.subAccountId,
      memoryType: entry.memoryType,
      content: entry.content,
      category: entry.category || null,
      relevanceScore: entry.relevanceScore,
      decayRate: entry.decayRate,
      sourceEvent: entry.sourceEvent || null,
      sourceContext: entry.sourceContext || null,
      outcome: entry.outcome || null,
      tags: entry.tags || [],
      accessCount: 0,
      lastAccessedAt: null,
    }).returning({ id: agentMemories.id }).execute();
    
    await pruneOldMemories(entry.subAccountId);
    return inserted?.id || null;
  } catch (err) {
    console.error(`[EPISODIC-MEMORY] Failed to record memory: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function recallRelevantMemories(
  subAccountId: number,
  options: {
    limit?: number;
    memoryTypes?: EpisodicMemoryType[];
    category?: string;
    minRelevance?: number;
  } = {}
): Promise<EpisodicMemory[]> {
  const { limit = 20, memoryTypes, category, minRelevance = 0.1 } = options;

  try {
    const effectiveRelevanceExpr = sql`relevance_score * EXP(-decay_rate * EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400)`;

    let queryStr = sql`
      SELECT *, (${effectiveRelevanceExpr}) as effective_relevance
      FROM agent_memories
      WHERE sub_account_id = ${subAccountId}
        AND (${effectiveRelevanceExpr}) >= ${minRelevance}
    `;

    if (memoryTypes && memoryTypes.length > 0) {
      queryStr = sql`${queryStr} AND memory_type = ANY(${memoryTypes})`;
    }
    if (category) {
      queryStr = sql`${queryStr} AND category = ${category}`;
    }

    queryStr = sql`${queryStr} ORDER BY effective_relevance DESC LIMIT ${limit}`;

    const result = await db.execute(queryStr);
    const rows = extractRows(result);

    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      await db.update(agentMemories)
        .set({
          accessCount: sql`${agentMemories.accessCount} + 1`,
          lastAccessedAt: new Date(),
        })
        .where(sql`${agentMemories.id} = ANY(${ids})`)
        .execute().catch(e => console.error("[EPISODIC-MEMORY] DB operation failed:", e instanceof Error ? e.message : e));
    }

    return rows.map(mapRowToMemory);
  } catch (err) {
    console.error(`[EPISODIC-MEMORY] Failed to recall memories: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export async function getAllMemories(
  subAccountId: number,
  options: { limit?: number; offset?: number; memoryType?: string } = {}
): Promise<{ memories: EpisodicMemory[]; total: number }> {
  const { limit = 50, offset = 0, memoryType } = options;

  try {
    const conditions = [eq(agentMemories.subAccountId, subAccountId)];
    if (memoryType) {
      conditions.push(eq(agentMemories.memoryType, memoryType));
    }

    const [countResult] = await db.select({ count: sql<number>`count(*)` })
      .from(agentMemories)
      .where(and(...conditions))
      .execute();

    const rows = await db.select().from(agentMemories)
      .where(and(...conditions))
      .orderBy(desc(agentMemories.createdAt))
      .limit(limit)
      .offset(offset)
      .execute();

    const now = Date.now();
    const memories: EpisodicMemory[] = rows.map(r => {
      const ageMs = now - new Date(r.createdAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const decayFactor = Math.exp(-r.decayRate * ageDays);
      const effectiveRelevance = r.relevanceScore * decayFactor;

      return {
        id: r.id,
        subAccountId: r.subAccountId,
        memoryType: r.memoryType as EpisodicMemoryType,
        content: r.content,
        category: r.category || undefined,
        relevanceScore: Math.round(effectiveRelevance * 100) / 100,
        decayRate: r.decayRate,
        sourceEvent: r.sourceEvent || undefined,
        sourceContext: (r.sourceContext as Record<string, unknown>) || undefined,
        outcome: r.outcome || undefined,
        tags: r.tags || [],
        accessCount: r.accessCount || 0,
        lastAccessedAt: r.lastAccessedAt?.toISOString(),
        createdAt: r.createdAt?.toISOString(),
      };
    });

    return { memories, total: Number(countResult?.count || 0) };
  } catch (err) {
    console.error(`[EPISODIC-MEMORY] Failed to get memories: ${err instanceof Error ? err.message : String(err)}`);
    return { memories: [], total: 0 };
  }
}

export async function deleteMemory(memoryId: number, subAccountId: number): Promise<boolean> {
  try {
    const result = await db.delete(agentMemories)
      .where(and(
        eq(agentMemories.id, memoryId),
        eq(agentMemories.subAccountId, subAccountId),
      ))
      .returning({ id: agentMemories.id })
      .execute();
    return result.length > 0;
  } catch (err) {
    console.error(`[EPISODIC-MEMORY] Failed to delete memory: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export async function updateMemoryContent(
  memoryId: number,
  subAccountId: number,
  updates: { content?: string; relevanceScore?: number; outcome?: string }
): Promise<boolean> {
  try {
    const setValues: Record<string, string | number> = {};
    if (updates.content !== undefined && typeof updates.content === "string" && updates.content.length <= 2000) {
      setValues.content = updates.content;
    }
    if (updates.relevanceScore !== undefined && typeof updates.relevanceScore === "number" && updates.relevanceScore >= 0 && updates.relevanceScore <= 1) {
      setValues.relevanceScore = updates.relevanceScore;
    }
    if (updates.outcome !== undefined && typeof updates.outcome === "string" && updates.outcome.length <= 200) {
      setValues.outcome = updates.outcome;
    }

    if (Object.keys(setValues).length === 0) return false;

    const result = await db.update(agentMemories)
      .set(setValues)
      .where(and(
        eq(agentMemories.id, memoryId),
        eq(agentMemories.subAccountId, subAccountId),
      ))
      .returning({ id: agentMemories.id })
      .execute();
    return result.length > 0;
  } catch (err) {
    console.error(`[EPISODIC-MEMORY] Failed to update memory: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export async function recordDecisionMemory(
  subAccountId: number,
  decision: string,
  context: Record<string, unknown>,
  sourceEvent?: string
): Promise<number | null> {
  return recordEpisodicMemory({
    subAccountId,
    memoryType: "decision",
    content: decision,
    category: "agent_decision",
    relevanceScore: 0.8,
    decayRate: 0.005,
    sourceEvent,
    sourceContext: context,
    tags: ["auto-captured"],
  });
}

export async function recordOutcomeMemory(
  subAccountId: number,
  description: string,
  outcome: string,
  context: Record<string, unknown>,
  sourceEvent?: string
): Promise<number | null> {
  return recordEpisodicMemory({
    subAccountId,
    memoryType: "outcome",
    content: description,
    category: (typeof context.category === "string" ? context.category : "task_outcome"),
    relevanceScore: outcome === "success" ? 0.9 : 0.85,
    decayRate: 0.003,
    sourceEvent,
    sourceContext: context,
    outcome,
    tags: ["auto-captured", outcome],
  });
}

export async function recordPreferenceMemory(
  subAccountId: number,
  preference: string,
  context: Record<string, unknown>,
  sourceEvent?: string
): Promise<number | null> {
  return recordEpisodicMemory({
    subAccountId,
    memoryType: "preference",
    content: preference,
    category: "user_preference",
    relevanceScore: 0.95,
    decayRate: 0.001,
    sourceEvent,
    sourceContext: context,
    tags: ["auto-captured", "preference"],
  });
}

export async function recordObservationMemory(
  subAccountId: number,
  observation: string,
  context: Record<string, unknown>,
  sourceEvent?: string
): Promise<number | null> {
  return recordEpisodicMemory({
    subAccountId,
    memoryType: "observation",
    content: observation,
    category: (typeof context.category === "string" ? context.category : "system_observation"),
    relevanceScore: 0.6,
    decayRate: 0.01,
    sourceEvent,
    sourceContext: context,
    tags: ["auto-captured"],
  });
}

async function pruneOldMemories(subAccountId: number): Promise<void> {
  try {
    const [countResult] = await db.select({ count: sql<number>`count(*)` })
      .from(agentMemories)
      .where(eq(agentMemories.subAccountId, subAccountId))
      .execute();

    const total = Number(countResult?.count || 0);
    if (total <= MAX_MEMORIES_PER_ACCOUNT) return;

    const toDelete = total - MAX_MEMORIES_PER_ACCOUNT;
    await db.execute(sql`
      DELETE FROM agent_memories 
      WHERE id IN (
        SELECT id FROM agent_memories 
        WHERE sub_account_id = ${subAccountId}
        ORDER BY relevance_score * EXP(-decay_rate * EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400) ASC
        LIMIT ${toDelete}
      )
    `);
  } catch (err: any) {
    console.error("[MEMORY] Memory cleanup failed:", err.message);
  }
}

export function buildPastExperiencePrompt(memories: EpisodicMemory[]): string {
  if (memories.length === 0) return "";

  const parts: string[] = ["=== PAST EXPERIENCES (Agent Memory) ==="];

  const decisions = memories.filter(m => m.memoryType === "decision");
  const outcomes = memories.filter(m => m.memoryType === "outcome");
  const preferences = memories.filter(m => m.memoryType === "preference");
  const observations = memories.filter(m => m.memoryType === "observation");

  if (decisions.length > 0) {
    parts.push("\nPast Decisions:");
    decisions.forEach(d => {
      parts.push(`  - ${d.content}${d.outcome ? ` → ${d.outcome}` : ""} (relevance: ${Math.round(d.relevanceScore * 100)}%)`);
    });
  }

  if (outcomes.length > 0) {
    parts.push("\nPast Outcomes:");
    outcomes.forEach(o => {
      parts.push(`  - ${o.content} → ${o.outcome || "unknown"} (relevance: ${Math.round(o.relevanceScore * 100)}%)`);
    });
  }

  if (preferences.length > 0) {
    parts.push("\nUser Preferences Learned:");
    preferences.forEach(p => {
      parts.push(`  - ${p.content} (relevance: ${Math.round(p.relevanceScore * 100)}%)`);
    });
  }

  if (observations.length > 0) {
    parts.push("\nKey Observations:");
    observations.forEach(o => {
      parts.push(`  - ${o.content} (relevance: ${Math.round(o.relevanceScore * 100)}%)`);
    });
  }

  return parts.join("\n");
}

function extractRows(result: unknown): MemoryRow[] {
  if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: unknown }).rows)) {
    return (result as { rows: MemoryRow[] }).rows;
  }
  if (Array.isArray(result)) return result as MemoryRow[];
  return [];
}

function mapRowToMemory(r: MemoryRow): EpisodicMemory {
  return {
    id: r.id,
    subAccountId: r.sub_account_id,
    memoryType: r.memory_type as EpisodicMemoryType,
    content: r.content,
    category: r.category || undefined,
    relevanceScore: Math.round((r.effective_relevance ?? r.relevance_score) * 100) / 100,
    decayRate: r.decay_rate,
    sourceEvent: r.source_event || undefined,
    sourceContext: (r.source_context as Record<string, unknown>) || undefined,
    outcome: r.outcome || undefined,
    tags: r.tags || [],
    accessCount: (r.access_count || 0) + 1,
    lastAccessedAt: new Date().toISOString(),
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : undefined,
  };
}

const PREFERENCE_PATTERNS: Array<{ pattern: RegExp; extract: (match: RegExpMatchArray, msg: string) => string }> = [
  { pattern: /\b(?:i prefer|i'd prefer|i like|i want|i'd like)\b\s+(.{5,80})/i, extract: (m) => `User prefers: ${m[1].replace(/[.!?]+$/, "")}` },
  { pattern: /\b(?:don't|do not|never)\s+(?:send|message|contact|email|call)\b\s*(.{0,60})/i, extract: (m, msg) => `User dislikes: ${msg.substring(0, 120)}` },
  { pattern: /\b(?:focus on|prioritize|concentrate on)\b\s+(.{5,80})/i, extract: (m) => `User wants focus on: ${m[1].replace(/[.!?]+$/, "")}` },
  { pattern: /\b(?:always|make sure to|ensure)\b\s+(.{5,80})/i, extract: (m) => `Standing instruction: ${m[1].replace(/[.!?]+$/, "")}` },
  { pattern: /\b(?:my (?:business|company|brand|target|audience|customers?))\b\s+(?:is|are|focuses? on|serves?|targets?)\s+(.{5,80})/i, extract: (m) => `Business context: ${m[1].replace(/[.!?]+$/, "")}` },
];

export async function extractPreferencesFromChat(
  subAccountId: number,
  userMessage: string
): Promise<number | null> {
  if (!userMessage || userMessage.length < 10) return null;

  for (const { pattern, extract } of PREFERENCE_PATTERNS) {
    const match = userMessage.match(pattern);
    if (match) {
      const content = extract(match, userMessage);
      const id = await recordPreferenceMemory(subAccountId, content, { source: "chat", messageSnippet: userMessage.substring(0, 120) }, "chat_preference");
      if (id) {
        console.log(`[EPISODIC-MEMORY] Extracted chat preference for account ${subAccountId}: ${content.substring(0, 60)}`);
      }
      return id;
    }
  }

  return null;
}
