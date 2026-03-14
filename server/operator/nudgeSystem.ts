import { db } from "../db";
import { operatorNudges } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import type { AdvisoryInsight, NudgeConfig, ContextPacket } from "./cognitiveTypes";
import { generateInsights, adaptMessage } from "./advisoryEngine";
import { recordNudgeResponse } from "./memoryEngine";
import { publishEventAsync } from "../eventBus";
import { dispatchAlert, generateDeepLink } from "../pushAlertService";

const DEFAULT_CONFIG: NudgeConfig = {
  maxPerDay: 3,
  minIntervalMs: 4 * 60 * 60 * 1000,
  respectDismissals: true,
  maxConsecutiveIgnores: 3,
};

export async function generateNudges(subAccountId: number, context: ContextPacket): Promise<Array<{
  id: number;
  type: string;
  title: string;
  message: string;
  priority: number;
  actionable: boolean;
  suggestedTool?: string;
  suggestedParams?: Record<string, any>;
}>> {
  const todayNudges = await getTodayNudgeCount(subAccountId);
  if (todayNudges >= DEFAULT_CONFIG.maxPerDay) return [];

  if (DEFAULT_CONFIG.respectDismissals && context.behavior.nudgesDismissed > DEFAULT_CONFIG.maxConsecutiveIgnores) {
    const recentAccept = context.behavior.acceptCount > 0;
    if (!recentAccept) return [];
  }

  const lastNudge = await getLastNudgeTime(subAccountId);
  if (lastNudge && (Date.now() - lastNudge.getTime()) < DEFAULT_CONFIG.minIntervalMs) {
    return [];
  }

  const insights = generateInsights(context);
  const existing = await getActiveNudges(subAccountId);
  const existingTypes = new Set(existing.map(n => n.nudgeType));

  const newInsights = insights.filter(i => !existingTypes.has(i.title.replace(/\s+/g, "_").toLowerCase()));
  const remaining = DEFAULT_CONFIG.maxPerDay - todayNudges;
  const toCreate = newInsights.slice(0, remaining);

  const created: Array<any> = [];
  for (const insight of toCreate) {
    const message = adaptMessage(insight.message, context.behavior);
    try {
      const [nudge] = await db.insert(operatorNudges).values({
        subAccountId,
        nudgeType: insight.title.replace(/\s+/g, "_").toLowerCase(),
        title: insight.title,
        message,
        priority: insight.priority,
        status: "pending",
        metadata: {
          category: insight.category,
          confidence: insight.confidence,
          suggestedTool: insight.suggestedTool,
          suggestedParams: insight.suggestedParams,
          dataBacking: insight.dataBacking,
        },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }).returning().execute();

      created.push({
        id: nudge.id,
        type: nudge.nudgeType,
        title: nudge.title,
        message: nudge.message,
        priority: nudge.priority,
        actionable: !!insight.suggestedTool,
        suggestedTool: insight.suggestedTool,
        suggestedParams: insight.suggestedParams,
      });
    } catch (e) {
      console.error("[NUDGE] Failed to create nudge:", (e as any).message);
    }
  }

  if (created.length > 0) {
    publishEventAsync("operator.nudges.generated", {
      subAccountId, count: created.length, types: created.map(c => c.type),
    }, "nudge-system");

    for (const nudge of created) {
      if (nudge.priority >= 70) {
        dispatchAlert(subAccountId, "nudge_high", {
          title: nudge.title,
          body: nudge.message.substring(0, 200),
          link: generateDeepLink("/dashboard"),
          tag: `nudge-${nudge.id}`,
          urgency: nudge.priority >= 90 ? "high" : "normal",
        }).catch(err => console.error("[NUDGE] Push alert failed:", err.message));
      }
    }
  }

  return created;
}

export async function getActiveNudges(subAccountId: number): Promise<any[]> {
  try {
    return await db.select().from(operatorNudges)
      .where(and(
        eq(operatorNudges.subAccountId, subAccountId),
        eq(operatorNudges.status, "pending"),
      ))
      .orderBy(desc(operatorNudges.priority))
      .limit(10)
      .execute();
  } catch {
    return [];
  }
}

export async function dismissNudge(nudgeId: number, subAccountId: number): Promise<boolean> {
  try {
    await db.update(operatorNudges)
      .set({ status: "dismissed", dismissedAt: new Date() })
      .where(and(
        eq(operatorNudges.id, nudgeId),
        eq(operatorNudges.subAccountId, subAccountId),
      ))
      .execute();
    await recordNudgeResponse(subAccountId, false);
    return true;
  } catch {
    return false;
  }
}

export async function actOnNudge(nudgeId: number, subAccountId: number): Promise<boolean> {
  try {
    await db.update(operatorNudges)
      .set({ status: "acted_on", actedOnAt: new Date() })
      .where(and(
        eq(operatorNudges.id, nudgeId),
        eq(operatorNudges.subAccountId, subAccountId),
      ))
      .execute();
    await recordNudgeResponse(subAccountId, true);
    return true;
  } catch {
    return false;
  }
}

export async function getNudgeHistory(subAccountId: number, limit = 20): Promise<any[]> {
  try {
    return await db.select().from(operatorNudges)
      .where(eq(operatorNudges.subAccountId, subAccountId))
      .orderBy(desc(operatorNudges.createdAt))
      .limit(limit)
      .execute();
  } catch {
    return [];
  }
}

async function getTodayNudgeCount(subAccountId: number): Promise<number> {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const result = await db.select({ count: sql<number>`count(*)` }).from(operatorNudges)
      .where(and(
        eq(operatorNudges.subAccountId, subAccountId),
        sql`${operatorNudges.createdAt} >= ${startOfDay}`,
      ))
      .execute();
    return Number(result[0]?.count || 0);
  } catch {
    return 0;
  }
}

async function getLastNudgeTime(subAccountId: number): Promise<Date | null> {
  try {
    const result = await db.select({ createdAt: operatorNudges.createdAt }).from(operatorNudges)
      .where(eq(operatorNudges.subAccountId, subAccountId))
      .orderBy(desc(operatorNudges.createdAt))
      .limit(1)
      .execute();
    return result[0]?.createdAt || null;
  } catch {
    return null;
  }
}
