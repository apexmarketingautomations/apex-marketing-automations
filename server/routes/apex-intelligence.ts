import { Express } from "express";
import { storage } from "../storage";
import { verifyAccountOwnership } from "./helpers";
import { db } from "../db";
import { sql, eq, and, gte, desc } from "drizzle-orm";
import { universalEvents } from "@shared/schema";
import { runAllScoresForAccount } from "../intelligence/scoringEngine";
import { runAllRecommendationsForAccount } from "../intelligence/recommendationEngine";

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

  app.post("/api/intelligence/refresh/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    await runAllScoresForAccount(subAccountId);
    const recCount = await runAllRecommendationsForAccount(subAccountId);
    res.json({ success: true, message: `Scores recalculated, ${recCount} new recommendations generated` });
  }));
}
