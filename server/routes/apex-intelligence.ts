import { Express } from "express";
import { storage } from "../storage";
import { verifyAccountOwnership, isApexParentUser } from "./helpers";
import { db } from "../db";
import { sql, eq, and, gte, desc } from "drizzle-orm";
import { universalEvents, integrationHealthState, entityIdentityMap } from "@shared/schema";
import { runAllScoresForAccount } from "../intelligence/scoringEngine";
import { runAllRecommendationsForAccount } from "../intelligence/recommendationEngine";
import { getNetworkIntelligence, getAccountIntelligenceSummary } from "../intelligence/networkIntelligence";
import { runFakeCompletionDetection } from "../intelligence/fakeCompletionDetector";
import { getPriorityActions, getOperatorActionSummary, dismissAction, snoozeAction } from "../intelligence/priorityActionQueue";
import { getCrossPlatformPatterns, getPlaybookRecommendationsForAccount } from "../intelligence/crossPlatformPatterns";
import { getSystemHealthReport } from "../intelligence/systemHealthOrchestrator";
import { approveAction, rollbackAction, markFailed, resumeAction, getActionAuditTrail } from "../autonomy/decisionEngine";
import { executeAction } from "../autonomy/safeActionsEngine";
import type { ActionCategory } from "../autonomy/types";
import { verifyIntelligenceTables, runProductionSeed, getLastSeedSnapshot, getLastVerification } from "../intelligence/productionSeed";

function asyncHandler(fn: (req: any, res: any, next: any) => Promise<any>) {
  return (req: any, res: any, next: any) => fn(req, res, next).catch(next);
}

export function registerApexIntelligenceRoutes(app: Express) {
  app.get("/api/intelligence/events/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { limit, offset, eventType, since } = req.query;
    const opts: any = {};
    if (limit) opts.limit = parseInt(limit as string);
    if (offset) opts.offset = parseInt(offset as string);
    if (eventType) opts.eventType = eventType;
    if (since) opts.since = new Date(since as string);

    const events = await storage.getUniversalEvents(subAccountId, opts);
    const total = await storage.getUniversalEventCount(subAccountId, opts);
    res.json({ events, total });
  }));

  app.get("/api/intelligence/events/:subAccountId/stream", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const events = await storage.getUniversalEvents(subAccountId, { limit: 50 });
    res.json(events);
  }));

  app.get("/api/intelligence/events/:subAccountId/top", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const topEvents = await db.select({
      eventType: universalEvents.eventType,
      count: sql<number>`count(*)::int`,
    })
      .from(universalEvents)
      .where(and(
        eq(universalEvents.subAccountId, subAccountId),
        gte(universalEvents.occurredAt, since)
      ))
      .groupBy(universalEvents.eventType)
      .orderBy(desc(sql`count(*)`))
      .limit(15);

    res.json(topEvents);
  }));

  app.get("/api/intelligence/scores/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { entityType, entityId, scoreType } = req.query;
    let scores;
    if (scoreType) {
      scores = await storage.getScoresByType(subAccountId, scoreType as string);
    } else {
      scores = await storage.getIntelligenceScores(
        subAccountId,
        entityType as string | undefined,
        entityId as string | undefined
      );
    }
    res.json(scores);
  }));

  app.get("/api/intelligence/recommendations/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { status, priority, limit } = req.query;
    const recommendations = await storage.getRecommendations(subAccountId, {
      status: status as string | undefined,
      priority: priority as string | undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json(recommendations);
  }));

  app.patch("/api/intelligence/recommendations/:id/status", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "status required" });

    const updated = await storage.updateRecommendationStatus(
      id,
      status,
      status === "resolved" ? new Date() : undefined
    );
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  }));

  app.get("/api/intelligence/health/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const health = await storage.getIntegrationHealth(subAccountId);
    res.json(health);
  }));

  app.get("/api/intelligence/timeline/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { limit, severity, since } = req.query;
    const timeline = await storage.getExecutionTimeline(subAccountId, {
      limit: limit ? parseInt(limit as string) : undefined,
      severity: severity as string | undefined,
      since: since ? new Date(since as string) : undefined,
    });
    res.json(timeline);
  }));

  app.get("/api/intelligence/rollups/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { entityType, entityId, metricName } = req.query;
    if (entityType && entityId) {
      const rollups = await storage.getActivityRollups(subAccountId, entityType as string, entityId as string);
      return res.json(rollups);
    }
    if (metricName) {
      const top = await storage.getTopMetrics(subAccountId, metricName as string);
      return res.json(top);
    }
    const rollups = await storage.getActivityRollups(subAccountId, "account", String(subAccountId));
    res.json(rollups);
  }));

  app.get("/api/intelligence/identity/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { entityType, entityId } = req.query;
    if (!entityType || !entityId) return res.status(400).json({ error: "entityType and entityId required" });

    const links = await storage.getEntityLinks(subAccountId, entityType as string, entityId as string);
    const reverseLinks = await storage.getLinkedEntities(subAccountId, entityType as string, entityId as string);
    res.json({ links, reverseLinks });
  }));

  app.get("/api/intelligence/summary/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [eventCount24h, eventCount7d, scores, recommendations, health, timeline] = await Promise.all([
      storage.getUniversalEventCount(subAccountId, { since: twentyFourHoursAgo }),
      storage.getUniversalEventCount(subAccountId, { since: sevenDaysAgo }),
      storage.getIntelligenceScores(subAccountId, "account", String(subAccountId)),
      storage.getRecommendations(subAccountId, { status: "pending", limit: 10 }),
      storage.getIntegrationHealth(subAccountId),
      storage.getExecutionTimeline(subAccountId, { limit: 10 }),
    ]);

    const healthySummary = {
      total: health.length,
      healthy: health.filter(h => h.status === "healthy").length,
      degraded: health.filter(h => h.status === "degraded").length,
      error: health.filter(h => h.status === "error").length,
      disconnected: health.filter(h => h.status === "disconnected").length,
    };

    res.json({
      events: { last24h: eventCount24h, last7d: eventCount7d },
      scores,
      recommendations,
      integrationHealth: healthySummary,
      recentTimeline: timeline,
    });
  }));

  app.get("/api/intelligence/ecosystem/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const ecosystemSummary = await getAccountIntelligenceSummary(subAccountId);
    res.json(ecosystemSummary);
  }));

  app.get("/api/intelligence/network-patterns", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const networkIntel = await getNetworkIntelligence();
    res.json(networkIntel);
  }));

  app.post("/api/intelligence/refresh/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    await runAllScoresForAccount(subAccountId);
    const recCount = await runAllRecommendationsForAccount(subAccountId);
    res.json({ success: true, message: `Scores recalculated, ${recCount} new recommendations generated` });
  }));

  // ---- Operator-Level Cross-Account APIs ----

  app.get("/api/operator/events-stream", asyncHandler(async (req, res) => {
    const opUser = (req as any).user;
    if (!opUser) return res.status(401).json({ error: "Not authenticated" });
    const opUserId = opUser?.claims?.sub || opUser?.id || opUser?.userId;
    const isAdmin = process.env.ADMIN_USER_ID && opUserId === process.env.ADMIN_USER_ID;
    if (!isAdmin && !(await isApexParentUser(opUserId))) return res.status(403).json({ error: "Operator access required" });

    const { module: sourceModule, eventType, limit, since } = req.query;
    const limitN = limit ? parseInt(limit as string) : 100;
    const sinceDate = since ? new Date(since as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const conditions: any[] = [gte(universalEvents.occurredAt, sinceDate)];
    if (sourceModule) conditions.push(eq(universalEvents.sourceModule, sourceModule as string));
    if (eventType) conditions.push(eq(universalEvents.eventType, eventType as string));

    const events = await db.select({
      id: universalEvents.id,
      eventType: universalEvents.eventType,
      sourceModule: universalEvents.sourceModule,
      subAccountId: universalEvents.subAccountId,
      occurredAt: universalEvents.occurredAt,
      metadata: universalEvents.metadata,
    })
      .from(universalEvents)
      .where(and(...conditions))
      .orderBy(desc(universalEvents.occurredAt))
      .limit(limitN);

    res.json(events);
  }));

  app.get("/api/operator/module-health", asyncHandler(async (req, res) => {
    const opUser = (req as any).user;
    if (!opUser) return res.status(401).json({ error: "Not authenticated" });
    const opUserId = opUser?.claims?.sub || opUser?.id || opUser?.userId;
    const isAdmin = process.env.ADMIN_USER_ID && opUserId === process.env.ADMIN_USER_ID;
    if (!isAdmin && !(await isApexParentUser(opUserId))) return res.status(403).json({ error: "Operator access required" });

    const [eventsByModule, healthRows] = await Promise.all([
      db.select({
        sourceModule: universalEvents.sourceModule,
        count: sql<number>`count(*)::int`,
        lastSeen: sql<string>`max(${universalEvents.occurredAt})`,
      })
        .from(universalEvents)
        .where(gte(universalEvents.occurredAt, new Date(Date.now() - 24 * 60 * 60 * 1000)))
        .groupBy(universalEvents.sourceModule),
      db.select({
        integrationType: integrationHealthState.integrationType,
        status: integrationHealthState.status,
        count: sql<number>`count(*)::int`,
      })
        .from(integrationHealthState)
        .groupBy(integrationHealthState.integrationType, integrationHealthState.status),
    ]);

    const moduleMap: Record<string, { events24h: number; lastSeen: string | null }> = {};
    for (const row of eventsByModule) {
      moduleMap[row.sourceModule] = { events24h: row.count, lastSeen: row.lastSeen };
    }

    const healthMap: Record<string, { healthy: number; degraded: number; error: number; disconnected: number }> = {};
    for (const row of healthRows) {
      if (!healthMap[row.integrationType]) healthMap[row.integrationType] = { healthy: 0, degraded: 0, error: 0, disconnected: 0 };
      const s = row.status as keyof typeof healthMap[string];
      if (s in healthMap[row.integrationType]) (healthMap[row.integrationType] as any)[s] = row.count;
    }

    res.json({ moduleActivity: moduleMap, integrationHealth: healthMap });
  }));

  app.get("/api/operator/failed-events", asyncHandler(async (req, res) => {
    const opUser = (req as any).user;
    if (!opUser) return res.status(401).json({ error: "Not authenticated" });
    const opUserId = opUser?.claims?.sub || opUser?.id || opUser?.userId;
    const isAdmin = process.env.ADMIN_USER_ID && opUserId === process.env.ADMIN_USER_ID;
    if (!isAdmin && !(await isApexParentUser(opUserId))) return res.status(403).json({ error: "Operator access required" });

    const FAILURE_TYPES = ["call_failed", "webhook_failed", "campaign_failed", "content_failed", "workflow_failed"];
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const failedEvents = await db.select({
      id: universalEvents.id,
      eventType: universalEvents.eventType,
      sourceModule: universalEvents.sourceModule,
      subAccountId: universalEvents.subAccountId,
      occurredAt: universalEvents.occurredAt,
      metadata: universalEvents.metadata,
    })
      .from(universalEvents)
      .where(and(
        gte(universalEvents.occurredAt, since),
        sql`${universalEvents.eventType} = ANY(ARRAY[${sql.join(FAILURE_TYPES.map(t => sql`${t}`), sql`, `)}]::text[])`
      ))
      .orderBy(desc(universalEvents.occurredAt))
      .limit(200);

    const byModule: Record<string, number> = {};
    for (const e of failedEvents) {
      byModule[e.sourceModule] = (byModule[e.sourceModule] || 0) + 1;
    }

    res.json({ failedEvents, summary: { total: failedEvents.length, byModule } });
  }));

  app.get("/api/operator/entity-linkage-health", asyncHandler(async (req, res) => {
    const opUser = (req as any).user;
    if (!opUser) return res.status(401).json({ error: "Not authenticated" });
    const opUserId = opUser?.claims?.sub || opUser?.id || opUser?.userId;
    const isAdmin = process.env.ADMIN_USER_ID && opUserId === process.env.ADMIN_USER_ID;
    if (!isAdmin && !(await isApexParentUser(opUserId))) return res.status(403).json({ error: "Operator access required" });

    const [totalLinks, byType, recentLinks] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(entityIdentityMap),
      db.select({
        entityType: entityIdentityMap.entityType,
        count: sql<number>`count(*)::int`,
      })
        .from(entityIdentityMap)
        .groupBy(entityIdentityMap.entityType),
      db.select({
        id: entityIdentityMap.id,
        entityType: entityIdentityMap.entityType,
        entityId: entityIdentityMap.entityId,
        canonicalId: entityIdentityMap.canonicalId,
        subAccountId: entityIdentityMap.subAccountId,
        createdAt: entityIdentityMap.createdAt,
      })
        .from(entityIdentityMap)
        .orderBy(desc(entityIdentityMap.createdAt))
        .limit(50),
    ]);

    res.json({
      totalLinks: totalLinks[0]?.count ?? 0,
      byEntityType: byType,
      recentLinks,
    });
  }));

  app.get("/api/operator/account-activity", asyncHandler(async (req, res) => {
    const opUser = (req as any).user;
    if (!opUser) return res.status(401).json({ error: "Not authenticated" });
    const opUserId = opUser?.claims?.sub || opUser?.id || opUser?.userId;
    const isAdmin = process.env.ADMIN_USER_ID && opUserId === process.env.ADMIN_USER_ID;
    if (!isAdmin && !(await isApexParentUser(opUserId))) return res.status(403).json({ error: "Operator access required" });

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [accountActivity, allAccounts] = await Promise.all([
      db.select({
        subAccountId: universalEvents.subAccountId,
        eventCount: sql<number>`count(*)::int`,
        lastEvent: sql<string>`max(${universalEvents.occurredAt})`,
        modules: sql<string[]>`array_agg(distinct ${universalEvents.sourceModule})`,
      })
        .from(universalEvents)
        .where(gte(universalEvents.occurredAt, since))
        .groupBy(universalEvents.subAccountId)
        .orderBy(desc(sql`count(*)`))
        .limit(50),
      storage.getSubAccounts(),
    ]);

    const accountMap = new Map(allAccounts.map((a: any) => [a.id, a]));

    const enriched = accountActivity.map(row => ({
      ...row,
      accountName: (accountMap.get(row.subAccountId) as any)?.name || `Account #${row.subAccountId}`,
      plan: (accountMap.get(row.subAccountId) as any)?.plan || "unknown",
    }));

    res.json(enriched);
  }));

  // ---- T001: Fake Completion Detection ----
  app.get("/api/apex/fake-completion/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const report = await runFakeCompletionDetection(subAccountId);
    res.json(report);
  }));

  app.get("/api/operator/fake-completion/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    const opUser = (req as any).user;
    if (!opUser) return res.status(401).json({ error: "Not authenticated" });
    const opUserId = opUser?.claims?.sub || opUser?.id || opUser?.userId;
    const isAdmin = process.env.ADMIN_USER_ID && opUserId === process.env.ADMIN_USER_ID;
    if (!isAdmin && !(await isApexParentUser(opUserId))) return res.status(403).json({ error: "Operator access required" });
    const report = await runFakeCompletionDetection(subAccountId);
    res.json(report);
  }));

  // ---- T002: Priority Action Queue ----
  app.get("/api/apex/priority-actions/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 30;
    const actions = await getPriorityActions(subAccountId, { limit });
    res.json(actions);
  }));

  app.get("/api/apex/priority-actions/:subAccountId/summary", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const summary = await getOperatorActionSummary(subAccountId);
    res.json(summary);
  }));

  app.post("/api/apex/priority-actions/:subAccountId/dismiss", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { actionId } = req.body;
    if (!actionId) return res.status(400).json({ error: "actionId required" });
    dismissAction(subAccountId, actionId);
    res.json({ success: true });
  }));

  app.post("/api/apex/priority-actions/:subAccountId/snooze", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { actionId, hours = 24 } = req.body;
    if (!actionId) return res.status(400).json({ error: "actionId required" });
    const snoozeUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
    snoozeAction(subAccountId, actionId, snoozeUntil);
    res.json({ success: true, snoozedUntil: snoozeUntil.toISOString() });
  }));

  // ---- T003: Publish/Deploy Validation ----
  app.post("/api/apex/validate-publish", asyncHandler(async (req, res) => {
    const { type, entityId, subAccountId } = req.body;
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    if (!type || !entityId) return res.status(400).json({ error: "type and entityId required" });

    const result = await validatePublishReadiness(type, entityId, subAccountId);
    res.json(result);
  }));

  // ---- T006: Cross-Platform Patterns / Playbooks ----
  app.get("/api/apex/playbooks/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const recs = await getPlaybookRecommendationsForAccount(subAccountId);
    res.json(recs);
  }));

  app.get("/api/operator/cross-platform-patterns", asyncHandler(async (req, res) => {
    const opUser = (req as any).user;
    if (!opUser) return res.status(401).json({ error: "Not authenticated" });
    const opUserId = opUser?.claims?.sub || opUser?.id || opUser?.userId;
    const isAdmin = process.env.ADMIN_USER_ID && opUserId === process.env.ADMIN_USER_ID;
    if (!isAdmin && !(await isApexParentUser(opUserId))) return res.status(403).json({ error: "Operator access required" });
    const patterns = await getCrossPlatformPatterns();
    res.json(patterns);
  }));

  // ---- T007: System Health Orchestration ----
  app.get("/api/operator/system-health", asyncHandler(async (req, res) => {
    const opUser = (req as any).user;
    if (!opUser) return res.status(401).json({ error: "Not authenticated" });
    const opUserId = opUser?.claims?.sub || opUser?.id || opUser?.userId;
    const isAdmin = process.env.ADMIN_USER_ID && opUserId === process.env.ADMIN_USER_ID;
    if (!isAdmin && !(await isApexParentUser(opUserId))) return res.status(403).json({ error: "Operator access required" });
    const health = await getSystemHealthReport();
    res.json(health);
  }));

  app.get("/api/apex/system-health", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const health = await getSystemHealthReport();
    res.json(health);
  }));

  // ---- T004: Inline Intelligence — Entity Scores by Type ----
  app.get("/api/apex/entity-score/:subAccountId/:entityType/:entityId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { entityType, entityId } = req.params;
    const scores = await storage.getIntelligenceScores(subAccountId, entityType, entityId);
    const recs = await storage.getRecommendations(subAccountId, { status: "pending", limit: 5 });
    const entityRecs = recs.filter((r: any) => r.entityType === entityType && r.entityId === entityId);
    res.json({ scores, recommendations: entityRecs });
  }));

  // ---- Autonomy Layer — Operator Autonomy UI Endpoints ----

  app.get("/api/autonomy/actions/:accountId", asyncHandler(async (req, res) => {
    const accountId = parseInt(req.params.accountId);
    if (!(await verifyAccountOwnership(req, res, accountId))) return;
    const { status, safetyClass, actionType, limit } = req.query;
    const actions = await storage.getAutonomyActions(accountId, {
      status: status as string | undefined,
      safetyClass: safetyClass as string | undefined,
      actionType: actionType as string | undefined,
      limit: limit ? parseInt(limit as string) : 100,
    });
    res.json(actions);
  }));

  app.get("/api/autonomy/actions/:id/detail", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const action = await storage.getAutonomyAction(id);
    if (!action) return res.status(404).json({ error: "Action not found" });
    if (!(await verifyAccountOwnership(req, res, action.accountId))) return;
    const dependsOn = action.dependsOnActionId
      ? await storage.getAutonomyAction(action.dependsOnActionId)
      : null;
    const policyRule = await storage.getAutonomyPolicyRule(action.actionType);
    res.json({ action, dependsOn, policyRule });
  }));

  app.post("/api/autonomy/actions/:id/approve", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const existing = await storage.getAutonomyAction(id);
    if (!existing) return res.status(404).json({ error: "Action not found" });
    if (!(await verifyAccountOwnership(req, res, existing.accountId))) return;

    const action = await approveAction(id);
    if (!action) return res.status(404).json({ error: "Action not found" });

    // Execute immediately after approval — do NOT leave it stuck as "approved"
    try {
      await storage.updateAutonomyAction(id, { status: "executing", executedAt: new Date(), updatedAt: new Date() });

      const category = (existing.actionCategory || "setup") as ActionCategory;
      const params: Record<string, any> = {};
      if (existing.targetEntityId) params.provider = existing.targetEntityId;
      if (existing.targetEntityType) params.entityType = existing.targetEntityType;
      if (existing.targetModule) params.targetModule = existing.targetModule;
      params.approvedByUser = true;

      const result = await executeAction({
        accountId: existing.accountId,
        actionType: existing.actionType,
        category,
        params,
        triggeredBy: "user_approval",
        correlationId: `approve_${id}_${Date.now()}`,
      });

      const finalStatus = result.success ? "completed" : "failed";
      const updated = await storage.updateAutonomyAction(id, {
        status: finalStatus,
        executionResult: result as unknown as Record<string, unknown>,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      });

      console.log(`[AUTONOMY] User-approved action ${id} (${existing.actionType}): ${finalStatus}`);
      res.json(updated ?? action);
    } catch (execErr: any) {
      console.error(`[AUTONOMY] Failed to execute user-approved action ${id}:`, execErr.message);
      const failed = await storage.updateAutonomyAction(id, {
        status: "failed",
        executionResult: { error: execErr.message } as Record<string, unknown>,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      });
      res.json(failed ?? action);
    }
  }));

  app.post("/api/autonomy/actions/:id/reject", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const existing = await storage.getAutonomyAction(id);
    if (!existing) return res.status(404).json({ error: "Action not found" });
    if (!(await verifyAccountOwnership(req, res, existing.accountId))) return;
    const action = await storage.updateAutonomyAction(id, {
      status: "blocked",
      updatedAt: new Date(),
      resolvedAt: new Date(),
    });
    if (!action) return res.status(404).json({ error: "Action not found" });
    res.json(action);
  }));

  app.post("/api/autonomy/actions/:id/snooze", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const existing = await storage.getAutonomyAction(id);
    if (!existing) return res.status(404).json({ error: "Action not found" });
    if (!(await verifyAccountOwnership(req, res, existing.accountId))) return;
    const action = await storage.updateAutonomyAction(id, {
      status: "proposed",
      updatedAt: new Date(),
    });
    if (!action) return res.status(404).json({ error: "Action not found" });
    res.json(action);
  }));

  app.post("/api/autonomy/actions/:id/retry", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const existing = await storage.getAutonomyAction(id);
    if (!existing) return res.status(404).json({ error: "Action not found" });
    if (!(await verifyAccountOwnership(req, res, existing.accountId))) return;
    const action = await storage.updateAutonomyAction(id, {
      status: "proposed",
      executionResult: null,
      resolvedAt: null,
      executedAt: null,
      updatedAt: new Date(),
    });
    res.json(action);
  }));

  app.post("/api/autonomy/actions/:id/rollback", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const existing = await storage.getAutonomyAction(id);
    if (!existing) return res.status(404).json({ error: "Action not found" });
    if (!(await verifyAccountOwnership(req, res, existing.accountId))) return;
    const action = await rollbackAction(id);
    if (!action) return res.status(404).json({ error: "Action not found or cannot be rolled back" });
    res.json(action);
  }));

  app.get("/api/intelligence/readiness", asyncHandler(async (req, res) => {
    const opUser = (req as any).user;
    if (!opUser) return res.status(401).json({ error: "Not authenticated" });
    const opUserId = opUser?.claims?.sub || opUser?.id || opUser?.userId;
    const isAdmin = process.env.ADMIN_USER_ID && opUserId === process.env.ADMIN_USER_ID;
    if (!isAdmin && !(await isApexParentUser(opUserId))) {
      return res.status(403).json({ error: "Apex parent access required" });
    }

    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    const cachedSnapshot = getLastSeedSnapshot();
    const cachedVerification = getLastVerification();

    if (!refresh && cachedSnapshot) {
      return res.json({
        source: "boot_seed",
        ranAt: cachedSnapshot.ranAt,
        verifiedAt: cachedVerification?.ranAt ?? cachedSnapshot.ranAt,
        ready: cachedSnapshot.ready,
        results: cachedSnapshot.results,
        ...cachedSnapshot.verification,
      });
    }

    if (!refresh && cachedVerification) {
      return res.json({
        source: "cached_verification",
        verifiedAt: cachedVerification.ranAt,
        ranAt: null,
        ready: cachedVerification.result.passed,
        results: [],
        ...cachedVerification.result,
      });
    }

    const verification = await verifyIntelligenceTables();
    const fresh = getLastVerification();
    const snapshot = getLastSeedSnapshot();
    res.json({
      source: snapshot ? "boot_seed_revalidated" : "fresh_verification",
      ranAt: snapshot?.ranAt ?? null,
      verifiedAt: fresh?.ranAt ?? new Date().toISOString(),
      ready: snapshot?.ready ?? verification.passed,
      results: snapshot?.results ?? [],
      ...verification,
    });
  }));

  app.post("/api/intelligence/production-seed", asyncHandler(async (req, res) => {
    const opUser = (req as any).user;
    if (!opUser) return res.status(401).json({ error: "Not authenticated" });
    const opUserId = opUser?.claims?.sub || opUser?.id || opUser?.userId;
    const isAdmin = process.env.ADMIN_USER_ID && opUserId === process.env.ADMIN_USER_ID;
    if (!isAdmin && !(await isApexParentUser(opUserId))) {
      return res.status(403).json({ error: "Apex parent access required" });
    }
    const result = await runProductionSeed();
    const snapshot = getLastSeedSnapshot();
    res.json({
      ...result,
      ranAt: snapshot?.ranAt ?? new Date().toISOString(),
      verifiedAt: snapshot?.ranAt ?? new Date().toISOString(),
    });
  }));
}

async function validatePublishReadiness(type: string, entityId: number, subAccountId: number): Promise<{
  ready: boolean;
  blockers: Array<{ field: string; issue: string; severity: "error" | "warning" }>;
  warnings: string[];
  score: number;
}> {
  const blockers: Array<{ field: string; issue: string; severity: "error" | "warning" }> = [];
  const warnings: string[] = [];

  if (type === "site") {
    const site = await storage.getSavedSite(entityId);
    if (!site) return { ready: false, blockers: [{ field: "site", issue: "Site not found", severity: "error" }], warnings: [], score: 0 };

    const sections = Array.isArray(site.siteData?.sections) ? site.siteData.sections : [];
    if (sections.length === 0) blockers.push({ field: "content", issue: "Site has no sections or content blocks", severity: "error" });

    const hasHero = sections.some((s: any) => s.type === "hero" || s.component?.includes("hero"));
    if (!hasHero) warnings.push("Consider adding a hero/banner section for better conversion");

    if (!site.name || site.name.length < 3) blockers.push({ field: "name", issue: "Site needs a meaningful name", severity: "error" });

    const seo = site.siteData?.seo || {};
    if (!seo.title) warnings.push("Missing SEO title — set a meta title for better search visibility");
    if (!seo.description) warnings.push("Missing SEO description — add a meta description");
  } else if (type === "workflow") {
    const wf = await storage.getWorkflow(entityId);
    if (!wf) return { ready: false, blockers: [{ field: "workflow", issue: "Workflow not found", severity: "error" }], warnings: [], score: 0 };

    const steps = Array.isArray(wf.steps) ? wf.steps : [];
    if (steps.length === 0) blockers.push({ field: "steps", issue: "Workflow has no action steps", severity: "error" });
    if (!wf.trigger || wf.trigger === "") blockers.push({ field: "trigger", issue: "Workflow has no trigger configured", severity: "error" });

    const hasContactAction = steps.some((s: any) => s.action_type?.includes("SMS") || s.action_type?.includes("Email") || s.action_type?.includes("Call"));
    if (!hasContactAction) warnings.push("Workflow has no outbound communication steps (SMS/Email/Call)");
  } else if (type === "campaign") {
    const campaign = await storage.getEmailCampaignById(entityId);
    if (!campaign) return { ready: false, blockers: [{ field: "campaign", issue: "Campaign not found", severity: "error" }], warnings: [], score: 0 };

    if (!campaign.subject || campaign.subject.length < 3) blockers.push({ field: "subject", issue: "Campaign needs a subject line", severity: "error" });
    if (!campaign.body || campaign.body.length < 50) blockers.push({ field: "content", issue: "Campaign body is too short or empty", severity: "error" });
    if ((campaign.recipientCount || 0) === 0) blockers.push({ field: "audience", issue: "No recipients configured for this campaign", severity: "error" });

    const subjectLen = campaign.subject?.length || 0;
    if (subjectLen > 60) warnings.push("Subject line is over 60 characters — shorter subjects have better open rates");
    if (subjectLen < 20) warnings.push("Subject line is very short — consider adding more context");
  }

  const score = Math.max(0, 100 - blockers.length * 30 - warnings.length * 5);
  const ready = blockers.filter(b => b.severity === "error").length === 0;

  return { ready, blockers, warnings, score };
}
