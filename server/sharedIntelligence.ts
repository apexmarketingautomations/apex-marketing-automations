import { db } from "./db";
import { sharedInsights } from "@shared/schema";
import { eq, and, desc, sql, asc } from "drizzle-orm";
import { aiChat, isAIConfigured } from "./aiGateway";
import type { ChatMessage } from "./aiGateway";
import crypto from "crypto";

const VALID_CATEGORIES = ["objection", "interest", "question", "trend", "conversion_signal"] as const;
type InsightCategory = typeof VALID_CATEGORIES[number];

const DECAY_THRESHOLD_DAYS = 90;
const MAX_INSIGHTS = 500;
const SIMILARITY_HASH_PREFIX_LEN = 64;

import { getLaylaAccountId } from "./services/laylaAccountResolver";
let _apexIntelligenceIds: Set<number> | null = null;
async function getApexIntelligenceAccountIds(): Promise<Set<number>> {
  if (_apexIntelligenceIds) return _apexIntelligenceIds;
  const laylaId = await getLaylaAccountId();
  _apexIntelligenceIds = new Set([13, laylaId]);
  return _apexIntelligenceIds;
}

function hashContent(content: string): string {
  const normalized = content.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function shortHash(content: string): string {
  return hashContent(content).substring(0, SIMILARITY_HASH_PREFIX_LEN);
}

interface ExtractedInsight {
  category: InsightCategory;
  content: string;
  confidence: number;
}

const EXTRACTION_PROMPT = `You are an insight extraction engine for a marketing automation platform. Analyze the conversation below and extract actionable business intelligence.

For each insight, categorize it as one of:
- "objection" — common pushback, hesitation, or concern from the customer
- "interest" — topic/service/product the customer is interested in
- "question" — frequently asked question or information request
- "trend" — emerging pattern in customer behavior or market
- "conversion_signal" — indicator that a customer is ready to buy/book/commit

Return a JSON array of insights. Each insight has:
- "category": one of the categories above
- "content": a concise 1-2 sentence summary of the insight (generalized, not customer-specific)
- "confidence": 0.0 to 1.0 how confident you are this is a real insight

Rules:
- Extract 0-5 insights per conversation. Only extract genuinely useful patterns.
- Generalize: "Customer asked about pricing" not "John asked how much it costs"
- Skip greetings, small talk, and purely logistical messages
- If no actionable insights exist, return an empty array []

Return ONLY the JSON array, no other text.`;

export async function extractInsightsFromConversation(
  threadHistory: Array<{ role: string; content: string }>,
  sourceAccountId: number,
  currentMessage: string
): Promise<void> {
  const apexIds = await getApexIntelligenceAccountIds();
  if (!apexIds.has(sourceAccountId)) return;
  if (!isAIConfigured()) return;
  if (threadHistory.length < 2 && currentMessage.length < 20) return;

  try {
    const conversationText = [
      ...threadHistory.slice(-6).map(m => `${m.role === "user" ? "CUSTOMER" : "AGENT"}: ${m.content}`),
      `CUSTOMER: ${currentMessage}`,
    ].join("\n");

    const messages: ChatMessage[] = [
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: conversationText },
    ];

    const result = await aiChat(messages, {
      temperature: 0.3,
      maxTokens: 500,
      route: "insight-extraction",
      jsonMode: true,
    });

    let insights: ExtractedInsight[] = [];
    try {
      const parsed = JSON.parse(result.text);
      if (Array.isArray(parsed)) {
        insights = parsed;
      } else if (parsed.insights && Array.isArray(parsed.insights)) {
        insights = parsed.insights;
      }
    } catch (err) {
      console.warn("[SHAREDINTELLIGENCE] direct JSON parse failed, falling back to bracket extraction:", err instanceof Error ? err.message : err);
      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try { insights = JSON.parse(jsonMatch[0]); } catch (err2) { console.warn("[SHAREDINTELLIGENCE] bracket-extracted JSON parse also failed:", err2 instanceof Error ? err2.message : err2); }
      }
    }

    for (const insight of insights.slice(0, 5)) {
      if (!insight.content || insight.content.length < 10) continue;
      if (!VALID_CATEGORIES.includes(insight.category as InsightCategory)) continue;

      const confidence = Math.max(0, Math.min(1, insight.confidence || 0.7));
      await storeInsight({
        category: insight.category as InsightCategory,
        content: insight.content.substring(0, 500),
        sourceAccountId,
        confidenceScore: confidence,
      });
    }
  } catch (err) {
    console.error(`[SHARED-INTEL] Insight extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

interface StoreInsightOptions {
  category: InsightCategory;
  content: string;
  sourceAccountId: number;
  confidenceScore?: number;
  metadata?: Record<string, unknown>;
}

function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeForComparison(a).split(" "));
  const wordsB = new Set(normalizeForComparison(b).split(" "));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  return intersection / Math.max(wordsA.size, wordsB.size);
}

const NEAR_DUPLICATE_THRESHOLD = 0.7;

async function storeInsight(opts: StoreInsightOptions): Promise<number | null> {
  const { category, content, sourceAccountId, confidenceScore = 0.7, metadata } = opts;
  const hash = shortHash(content);

  try {
    const exactMatch = await db.select()
      .from(sharedInsights)
      .where(and(
        eq(sharedInsights.contentHash, hash),
        eq(sharedInsights.isArchived, false),
      ))
      .limit(1);

    if (exactMatch.length > 0) {
      const row = exactMatch[0];
      const newCount = row.occurrenceCount + 1;
      const boostedConfidence = Math.min(1, row.confidenceScore + 0.05);

      await db.update(sharedInsights)
        .set({
          occurrenceCount: newCount,
          confidenceScore: boostedConfidence,
          lastSeenAt: new Date(),
        })
        .where(eq(sharedInsights.id, row.id));

      console.log(`[SHARED-INTEL] Merged exact insight id=${row.id} count=${newCount} category=${category}`);
      return row.id;
    }

    const sameCategoryInsights = await db.select()
      .from(sharedInsights)
      .where(and(
        eq(sharedInsights.category, category),
        eq(sharedInsights.isArchived, false),
      ))
      .orderBy(desc(sharedInsights.occurrenceCount))
      .limit(50);

    for (const existing of sameCategoryInsights) {
      if (textSimilarity(content, existing.content) >= NEAR_DUPLICATE_THRESHOLD) {
        const newCount = existing.occurrenceCount + 1;
        const boostedConfidence = Math.min(1, existing.confidenceScore + 0.05);
        const mergedContent = content.length > existing.content.length ? content : existing.content;

        await db.update(sharedInsights)
          .set({
            occurrenceCount: newCount,
            confidenceScore: boostedConfidence,
            lastSeenAt: new Date(),
            content: mergedContent,
            contentHash: shortHash(mergedContent),
          })
          .where(eq(sharedInsights.id, existing.id));

        console.log(`[SHARED-INTEL] Merged near-duplicate insight id=${existing.id} count=${newCount}`);
        return existing.id;
      }
    }

    const [inserted] = await db.insert(sharedInsights).values({
      category,
      content,
      contentHash: hash,
      sourceAccountId,
      confidenceScore,
      decayRate: 0.005,
      occurrenceCount: 1,
      lastSeenAt: new Date(),
      isArchived: false,
      metadata: metadata || null,
    }).returning({ id: sharedInsights.id });

    console.log(`[SHARED-INTEL] Stored new insight id=${inserted?.id} category=${category}: ${content.substring(0, 60)}`);
    return inserted?.id || null;
  } catch (err) {
    console.error(`[SHARED-INTEL] Failed to store insight: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function computeTopicRelevance(content: string, topic: string): number {
  if (!topic || !content) return 1.0;
  const topicWords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (topicWords.length === 0) return 1.0;
  const contentLower = content.toLowerCase();
  let matches = 0;
  for (const word of topicWords) {
    if (contentLower.includes(word)) matches++;
  }
  const ratio = matches / topicWords.length;
  return 0.3 + 0.7 * ratio;
}

export async function getTopSharedInsights(options: {
  limit?: number;
  category?: string;
  minConfidence?: number;
  topic?: string;
} = {}): Promise<Array<{
  id: number;
  category: string;
  content: string;
  confidenceScore: number;
  occurrenceCount: number;
  effectiveScore: number;
  lastSeenAt: string;
  createdAt: string;
}>> {
  const { limit = 8, category, minConfidence = 0.1, topic } = options;

  try {
    const effectiveScoreExpr = sql`(confidence_score * occurrence_count * EXP(-decay_rate * EXTRACT(EPOCH FROM (NOW() - last_seen_at)) / 86400))`;

    const fetchLimit = topic ? limit * 3 : limit;

    const apexIds = await getApexIntelligenceAccountIds();
    const allowedIds = Array.from(apexIds);

    let query = sql`
      SELECT id, category, content, confidence_score, occurrence_count,
             last_seen_at, created_at,
             (${effectiveScoreExpr}) as effective_score
      FROM shared_insights
      WHERE is_archived = false
        AND (${effectiveScoreExpr}) >= ${minConfidence}
        AND source_account_id = ANY(ARRAY[${sql.join(allowedIds.map(id => sql`${id}`), sql`, `)}]::int[])
    `;

    if (category) {
      query = sql`${query} AND category = ${category}`;
    }

    query = sql`${query} ORDER BY effective_score DESC LIMIT ${fetchLimit}`;

    const result = await db.execute(query);
    let rows = extractRows(result);

    if (topic && rows.length > 0) {
      rows = rows.map((r: any) => {
        const topicBoost = computeTopicRelevance(r.content, topic);
        return {
          ...r,
          effective_score: (r.effective_score || 0) * topicBoost,
        };
      });
      rows.sort((a: any, b: any) => (b.effective_score || 0) - (a.effective_score || 0));
      rows = rows.slice(0, limit);
    }

    return rows.map((r: any) => ({
      id: r.id,
      category: r.category,
      content: r.content,
      confidenceScore: Math.round((r.confidence_score || 0) * 100) / 100,
      occurrenceCount: r.occurrence_count || 1,
      effectiveScore: Math.round((r.effective_score || 0) * 100) / 100,
      lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : new Date().toISOString(),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
    }));
  } catch (err) {
    console.error(`[SHARED-INTEL] Failed to get insights: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export function buildSharedInsightsPrompt(insights: Array<{
  category: string;
  content: string;
  occurrenceCount: number;
  effectiveScore: number;
}>): string {
  if (insights.length === 0) return "";

  const parts: string[] = ["\n=== ORGANIZATIONAL INTELLIGENCE (Shared Insights) ==="];
  parts.push("These are patterns observed across all customer conversations:\n");

  const grouped: Record<string, typeof insights> = {};
  for (const insight of insights) {
    if (!grouped[insight.category]) grouped[insight.category] = [];
    grouped[insight.category].push(insight);
  }

  const categoryLabels: Record<string, string> = {
    objection: "Common Objections",
    interest: "Customer Interests",
    question: "Frequently Asked Questions",
    trend: "Emerging Trends",
    conversion_signal: "Conversion Signals",
  };

  for (const [cat, items] of Object.entries(grouped)) {
    parts.push(`${categoryLabels[cat] || cat}:`);
    for (const item of items) {
      const frequency = item.occurrenceCount > 3 ? " (frequent)" : item.occurrenceCount > 1 ? " (recurring)" : "";
      parts.push(`  - ${item.content}${frequency}`);
    }
  }

  parts.push("\nUse these insights to inform your responses — address known objections proactively, align with trending interests, and recognize conversion signals.");

  return parts.join("\n");
}

export async function getInsightStats(): Promise<{
  totalActive: number;
  totalArchived: number;
  byCategory: Record<string, number>;
  bySourceAccount: Record<number, number>;
  topTrends: Array<{ content: string; occurrenceCount: number; category: string }>;
}> {
  try {
    const [activeResult] = await db.select({ count: sql<number>`count(*)` })
      .from(sharedInsights)
      .where(eq(sharedInsights.isArchived, false));

    const [archivedResult] = await db.select({ count: sql<number>`count(*)` })
      .from(sharedInsights)
      .where(eq(sharedInsights.isArchived, true));

    const categoryRows = await db.select({
      category: sharedInsights.category,
      count: sql<number>`count(*)`,
    })
      .from(sharedInsights)
      .where(eq(sharedInsights.isArchived, false))
      .groupBy(sharedInsights.category);

    const accountRows = await db.select({
      sourceAccountId: sharedInsights.sourceAccountId,
      count: sql<number>`count(*)`,
    })
      .from(sharedInsights)
      .where(eq(sharedInsights.isArchived, false))
      .groupBy(sharedInsights.sourceAccountId);

    const topTrends = await db.select({
      content: sharedInsights.content,
      occurrenceCount: sharedInsights.occurrenceCount,
      category: sharedInsights.category,
    })
      .from(sharedInsights)
      .where(eq(sharedInsights.isArchived, false))
      .orderBy(desc(sharedInsights.occurrenceCount))
      .limit(10);

    const byCategory: Record<string, number> = {};
    for (const row of categoryRows) {
      byCategory[row.category] = Number(row.count);
    }

    const bySourceAccount: Record<number, number> = {};
    for (const row of accountRows) {
      if (row.sourceAccountId) {
        bySourceAccount[row.sourceAccountId] = Number(row.count);
      }
    }

    return {
      totalActive: Number(activeResult?.count || 0),
      totalArchived: Number(archivedResult?.count || 0),
      byCategory,
      bySourceAccount,
      topTrends: topTrends.map(t => ({
        content: t.content,
        occurrenceCount: t.occurrenceCount,
        category: t.category,
      })),
    };
  } catch (err) {
    console.error(`[SHARED-INTEL] Failed to get stats: ${err instanceof Error ? err.message : String(err)}`);
    return { totalActive: 0, totalArchived: 0, byCategory: {}, bySourceAccount: {}, topTrends: [] };
  }
}

export async function archiveStaleInsights(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - DECAY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

    const result = await db.update(sharedInsights)
      .set({ isArchived: true })
      .where(and(
        eq(sharedInsights.isArchived, false),
        sql`${sharedInsights.lastSeenAt} < ${cutoff}`,
        sql`${sharedInsights.occurrenceCount} <= 2`,
      ))
      .returning({ id: sharedInsights.id });

    if (result.length > 0) {
      console.log(`[SHARED-INTEL] Archived ${result.length} stale insights`);
    }
    return result.length;
  } catch (err) {
    console.error(`[SHARED-INTEL] Archive failed: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

export async function refreshInsightsFromRecentConversations(
  subAccountId: number,
  limitConversations: number = 20
): Promise<number> {
  try {
    const { messages } = await import("@shared/schema");

    const recentThreads = await db.selectDistinct({ threadId: messages.threadId })
      .from(messages)
      .where(and(
        eq(messages.subAccountId, subAccountId),
        eq(messages.direction, "inbound"),
        sql`${messages.threadId} IS NOT NULL`,
        sql`${messages.createdAt} > NOW() - INTERVAL '7 days'`,
      ))
      .limit(limitConversations);

    let extractedCount = 0;

    for (const thread of recentThreads) {
      if (!thread.threadId) continue;

      const threadMsgs = await db.select({
        direction: messages.direction,
        body: messages.body,
      })
        .from(messages)
        .where(and(
          eq(messages.threadId, thread.threadId),
          eq(messages.subAccountId, subAccountId),
        ))
        .orderBy(desc(messages.id))
        .limit(8);

      threadMsgs.reverse();

      const history = threadMsgs.slice(0, -1).map(m => ({
        role: m.direction === "inbound" ? "user" : "assistant",
        content: m.body,
      }));

      const lastMsg = threadMsgs[threadMsgs.length - 1];
      if (lastMsg && lastMsg.direction === "inbound") {
        await extractInsightsFromConversation(history, subAccountId, lastMsg.body);
        extractedCount++;
      }
    }

    return extractedCount;
  } catch (err) {
    console.error(`[SHARED-INTEL] Refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

function extractRows(result: unknown): any[] {
  if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: unknown }).rows)) {
    return (result as { rows: any[] }).rows;
  }
  if (Array.isArray(result)) return result;
  return [];
}
