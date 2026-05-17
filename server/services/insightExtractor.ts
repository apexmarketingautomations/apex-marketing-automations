// @ts-nocheck
import { db } from "../db";
import { messages, sharedInsights } from "@shared/schema";
import { eq, and, desc, sql, ilike } from "drizzle-orm";
import { aiChat } from "../aiGateway";
import { maskPiiForLogs } from "./personas/laylaPostProcessor";

const IDENTITY_REJECT = /\b(Layla|Officer Layla|Apex Marketing|Apex By Donte|760762100447000|736112766259045)\b/i;

const VALID_CATEGORIES = new Set(["faq", "objection", "reply_pattern", "conversion_signal", "trend"]);

const EXTRACTION_PROMPT = `You are a business intelligence analyst. Analyze the conversation below and extract 0-3 generalizable business insights.

Each insight must fit one of these categories:
- faq: A question customers commonly ask (e.g., "Customers frequently ask about payment plans")
- objection: A reason customers hesitate (e.g., "Common objection: needing to check with a partner first")
- reply_pattern: A response approach that worked well (e.g., "Asking one clarifying question before offering solutions increases engagement")
- conversion_signal: A behavior indicating readiness to buy (e.g., "Asking about availability is a strong buying signal")
- trend: A topic gaining traction (e.g., "Increased interest in social media advertising")

Rules:
- Every insight must be GENERALIZED — applicable to any business, any customer
- NEVER include: names, phone numbers, emails, page names, business names, brand names, booking URLs, offer URLs, persona details, tone instructions, or any text that identifies a specific account or person
- If the conversation has no extractable patterns, return an empty array []
- Output ONLY a valid JSON array, nothing else

Example output:
[{"category":"faq","content":"Customers frequently ask about pricing before they are ready to commit"},{"category":"conversion_signal","content":"Asking about next available appointment slot is a strong buying signal"}]`;

export async function extractAndStoreInsights(
  subAccountId: number,
  senderId: string,
  channel: string,
): Promise<void> {
  const recentMsgs = await db
    .select({ direction: messages.direction, body: messages.body })
    .from(messages)
    .where(and(eq(messages.subAccountId, subAccountId), eq(messages.contactPhone, senderId)))
    .orderBy(desc(messages.id))
    .limit(6);

  if (recentMsgs.length < 3) return;

  const formatted = [...recentMsgs]
    .reverse()
    .map((m) => `${m.direction === "inbound" ? "USER" : "AGENT"}: ${(m.body || "").substring(0, 400)}`)
    .join("\n");

  const result = await aiChat(
    [
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: formatted },
    ],
    { temperature: 0.3, maxTokens: 512, jsonMode: true, route: "insight-extraction" },
  );

  let parsed: Array<{ category: string; content: string }>;
  try {
    // Handle both string and pre-parsed object responses
    const raw = typeof result === "string"
      ? JSON.parse(result.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim())
      : result;
    parsed = Array.isArray(raw) ? raw : (raw?.insights || raw?.data || []);
  } catch (err: any) {
    console.warn("[INSIGHT] Failed to parse LLM response as JSON:", err instanceof Error ? err.message : err);
    return;
  }

  for (const insight of parsed.slice(0, 3)) {
    if (!insight.category || !insight.content) continue;
    if (!VALID_CATEGORIES.has(insight.category)) continue;
    if (typeof insight.content !== "string" || insight.content.length < 10) continue;

    if (IDENTITY_REJECT.test(insight.content)) {
      console.log(`[INSIGHT] Rejected — contains identity term: ${insight.content.substring(0, 60)}`);
      continue;
    }

    const cleaned = maskPiiForLogs(insight.content).substring(0, 500);

    if (IDENTITY_REJECT.test(cleaned)) {
      console.log(`[INSIGHT] Rejected post-PII-clean — identity term survived`);
      continue;
    }

    const corePhrase = cleaned.substring(0, Math.min(40, cleaned.length));
    const coreHash = cleaned.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 64);
    const existing = await db
      .select({ id: sharedInsights.id, occurrenceCount: sharedInsights.occurrenceCount, confidenceScore: sharedInsights.confidenceScore })
      .from(sharedInsights)
      .where(and(eq(sharedInsights.isArchived, false), eq(sharedInsights.category, insight.category), ilike(sharedInsights.content, `%${corePhrase}%`)))
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0];
      await db
        .update(sharedInsights)
        .set({
          occurrenceCount: row.occurrenceCount + 1,
          lastSeenAt: new Date(),
          confidenceScore: Math.min(1.0, row.confidenceScore + 0.05),
        })
        .where(eq(sharedInsights.id, row.id));
      console.log(`[INSIGHT] Merged into existing #${row.id}: ${cleaned.substring(0, 60)}`);
    } else {
      await db.insert(sharedInsights).values({
        category: insight.category,
        content: cleaned,
        contentHash: coreHash,
        sourceAccountId: subAccountId,
        occurrenceCount: 1,
        confidenceScore: 0.5,
        lastSeenAt: new Date(),
      });
      console.log(`[INSIGHT] Stored new [${insight.category}]: ${cleaned.substring(0, 60)}`);
    }
  }
}
