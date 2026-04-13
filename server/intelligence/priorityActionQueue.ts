import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and, desc } from "drizzle-orm";
import { intelligenceRecommendations, intelligenceScores, subAccounts } from "@shared/schema";

export type ActionCategory = "alert" | "opportunity" | "maintenance" | "setup" | "optimization";
export type ActionStatus = "pending" | "dismissed" | "snoozed" | "completed";

export interface PriorityAction {
  id: string;
  category: ActionCategory;
  priority: "critical" | "high" | "medium" | "low";
  urgencyScore: number;
  impactScore: number;
  effortScore: number;
  compositeScore: number;
  title: string;
  description: string;
  whyThisMatters: string;
  suggestedAction?: string;
  navigateTo?: string;
  sourceType: "recommendation" | "fake_completion" | "score" | "system";
  sourceId?: string | number;
  entityType?: string;
  entityId?: string;
  status: ActionStatus;
  snoozedUntil?: string;
  createdAt: string;
  accountId: number;
}

interface PriorityActionState {
  dismissed: Set<string>;
  snoozed: Map<string, Date>;
}

const _stateCache = new Map<number, PriorityActionState>();

function getState(accountId: number): PriorityActionState {
  if (!_stateCache.has(accountId)) {
    _stateCache.set(accountId, { dismissed: new Set(), snoozed: new Map() });
  }
  return _stateCache.get(accountId)!;
}

export function dismissAction(accountId: number, actionId: string): void {
  getState(accountId).dismissed.add(actionId);
}

export function snoozeAction(accountId: number, actionId: string, untilDate: Date): void {
  getState(accountId).snoozed.set(actionId, untilDate);
}

export function getActionStatus(accountId: number, actionId: string): ActionStatus {
  const state = getState(accountId);
  if (state.dismissed.has(actionId)) return "dismissed";
  const snoozedUntil = state.snoozed.get(actionId);
  if (snoozedUntil && snoozedUntil > new Date()) return "snoozed";
  if (snoozedUntil && snoozedUntil <= new Date()) {
    state.snoozed.delete(actionId);
  }
  return "pending";
}

function priorityToUrgency(priority: string): number {
  const map: Record<string, number> = { critical: 95, high: 75, medium: 50, low: 25 };
  return map[priority] || 50;
}

function categoryToImpact(category: string, scoreType?: string): number {
  if (scoreType?.includes("pipeline") || scoreType?.includes("revenue")) return 90;
  if (scoreType?.includes("lead") || scoreType?.includes("contact")) return 80;
  if (scoreType?.includes("integration") || scoreType?.includes("domain")) return 85;
  if (scoreType?.includes("workflow") || scoreType?.includes("campaign")) return 70;
  if (scoreType?.includes("site") || scoreType?.includes("reputation")) return 65;
  return 55;
}

function estimateEffort(recommendationType: string): number {
  const lowEffort = ["review_request", "enable_auto_reply", "check_metrics"];
  const medEffort = ["fix_dns", "attach_site", "create_workflow", "add_ai_step"];
  const highEffort = ["setup_domain", "full_site_build", "rebuild_workflow"];

  if (lowEffort.some(k => recommendationType.includes(k))) return 20;
  if (highEffort.some(k => recommendationType.includes(k))) return 80;
  if (medEffort.some(k => recommendationType.includes(k))) return 50;
  return 40;
}

function computeCompositeScore(urgency: number, impact: number, effort: number): number {
  return Math.round((urgency * 0.4 + impact * 0.4 + (100 - effort) * 0.2));
}

export async function getPriorityActions(accountId: number, opts?: {
  limit?: number;
  includeCompleted?: boolean;
  minPriority?: string;
}): Promise<PriorityAction[]> {
  const limit = opts?.limit ?? 30;

  const recommendations = await storage.getRecommendations(accountId, { status: "pending", limit: 100 });

  const criticalScores = await db.select()
    .from(intelligenceScores)
    .where(and(
      eq(intelligenceScores.accountId, accountId),
      sql`score_band IN ('critical', 'low')`,
    ))
    .orderBy(intelligenceScores.scoreValue)
    .limit(20);

  const actions: PriorityAction[] = [];
  const state = getState(accountId);

  for (const rec of recommendations) {
    const actionId = `rec:${rec.id}`;
    const status = getActionStatus(accountId, actionId);
    if (!opts?.includeCompleted && (status === "dismissed")) continue;

    const snoozedUntil = state.snoozed.get(actionId);
    const urgency = priorityToUrgency(rec.priority);
    const impact = categoryToImpact(rec.recommendationType);
    const effort = estimateEffort(rec.recommendationType);
    const composite = computeCompositeScore(urgency, impact, effort);

    const recAction = rec.recommendedAction as Record<string, any> | null;

    actions.push({
      id: actionId,
      category: rec.priority === "critical" ? "alert" : "optimization",
      priority: rec.priority as "critical" | "high" | "medium" | "low",
      urgencyScore: urgency,
      impactScore: impact,
      effortScore: effort,
      compositeScore: composite,
      title: rec.title,
      description: rec.description || "",
      whyThisMatters: rec.whyThisExists || "This issue affects platform performance",
      suggestedAction: recAction?.step || undefined,
      navigateTo: recAction?.target || undefined,
      sourceType: "recommendation",
      sourceId: rec.id,
      entityType: rec.entityType,
      entityId: rec.entityId,
      status,
      snoozedUntil: snoozedUntil ? snoozedUntil.toISOString() : undefined,
      createdAt: new Date(rec.createdAt).toISOString(),
      accountId,
    });
  }

  for (const score of criticalScores) {
    const actionId = `score:${score.id}`;
    const status = getActionStatus(accountId, actionId);
    if (!opts?.includeCompleted && (status === "dismissed")) continue;

    const isDuplicate = actions.some(a => a.entityType === score.entityType && a.entityId === score.entityId);
    if (isDuplicate) continue;

    const scoreLabel = score.scoreType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const urgency = score.scoreBand === "critical" ? 90 : 65;
    const impact = categoryToImpact("", score.scoreType);
    const effort = 50;
    const composite = computeCompositeScore(urgency, impact, effort);

    const snoozedUntil = state.snoozed.get(actionId);

    actions.push({
      id: actionId,
      category: "maintenance",
      priority: score.scoreBand === "critical" ? "high" : "medium",
      urgencyScore: urgency,
      impactScore: impact,
      effortScore: effort,
      compositeScore: composite,
      title: `Low ${scoreLabel}: ${score.scoreValue}/100`,
      description: score.explanation || `${scoreLabel} is in the ${score.scoreBand} band at ${score.scoreValue}/100`,
      whyThisMatters: "Low scores indicate platform areas needing attention",
      entityType: score.entityType,
      entityId: score.entityId,
      sourceType: "score",
      sourceId: score.id,
      status,
      snoozedUntil: snoozedUntil ? snoozedUntil.toISOString() : undefined,
      createdAt: new Date(score.calculatedAt).toISOString(),
      accountId,
    });
  }

  actions.sort((a, b) => b.compositeScore - a.compositeScore);

  return actions.slice(0, limit);
}

export async function getOperatorActionSummary(accountId: number): Promise<{
  totalPending: number;
  criticalCount: number;
  highCount: number;
  topActions: PriorityAction[];
  lastUpdated: string;
}> {
  const actions = await getPriorityActions(accountId, { limit: 50 });
  const pending = actions.filter(a => a.status === "pending");

  return {
    totalPending: pending.length,
    criticalCount: pending.filter(a => a.priority === "critical").length,
    highCount: pending.filter(a => a.priority === "high").length,
    topActions: pending.slice(0, 5),
    lastUpdated: new Date().toISOString(),
  };
}
