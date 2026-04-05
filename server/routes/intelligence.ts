import type { Express, Request, Response } from "express";
import { getTopSharedInsights, getInsightStats, archiveStaleInsights, refreshInsightsFromRecentConversations } from "../sharedIntelligence";

function requireAdmin(req: Request, res: Response): boolean {
  const secret = process.env.ADMIN_API_SECRET || process.env.ADMIN_USER_ID;
  if (!secret) {
    res.status(503).json({ error: "Admin API not configured" });
    return false;
  }
  const auth = req.headers["x-admin-secret"];
  if (auth !== secret) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

export function registerIntelligenceRoutes(app: Express) {
  app.get("/api/intelligence/insights", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;

    try {
      const category = req.query.category as string | undefined;
      const limitParam = parseInt(req.query.limit as string) || 20;
      const limit = Math.min(limitParam, 100);

      const [insights, stats] = await Promise.all([
        getTopSharedInsights({ limit, category, minConfidence: 0.05 }),
        getInsightStats(),
      ]);

      res.json({
        insights,
        stats,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/intelligence/insights/refresh", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;

    try {
      const { subAccountId = 13, limitConversations = 20 } = req.body || {};

      const accountIds = Array.isArray(subAccountId) ? subAccountId : [subAccountId];
      let totalExtracted = 0;

      for (const acctId of accountIds) {
        const count = await refreshInsightsFromRecentConversations(acctId, limitConversations);
        totalExtracted += count;
      }

      const archived = await archiveStaleInsights();

      res.json({
        message: "Refresh complete",
        accountsProcessed: accountIds.length,
        conversationsAnalyzed: totalExtracted,
        staleInsightsArchived: archived,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/intelligence/insights/cleanup", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;

    try {
      const archived = await archiveStaleInsights();
      res.json({ archivedCount: archived });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
