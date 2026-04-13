import { Express } from "express";
import { storage } from "../storage";
import { verifyAccountOwnership, isApexParentUser } from "./helpers";
import { db } from "../db";
import { sql, eq, and, gte, desc } from "drizzle-orm";
import { universalEvents, integrationHealthState, entityIdentityMap } from "@shared/schema";
import { runAllScoresForAccount } from "../intelligence/scoringEngine";
import { runAllRecommendationsForAccount } from "../intelligence/recommendationEngine";
import { getNetworkIntelligence, getAccountIntelligenceSummary } from "../intelligence/networkIntelligence";

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
}
