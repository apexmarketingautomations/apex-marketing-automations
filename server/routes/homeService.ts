import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  homeServiceLeads,
  homeServiceContractors,
  homeServiceLeadClaims,
  insertHomeServiceContractorSchema,
} from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { claimLead } from "../homeServiceLeadDelivery";
import {
  startHomeServicePipeline,
  stopHomeServicePipeline,
  getHomeServicePipelineStats,
} from "../homeServiceSignalPipeline";

export function registerHomeServiceRoutes(app: Express): void {
  // GET /api/home-service/leads/:subAccountId
  app.get("/api/home-service/leads/:subAccountId", async (req: Request, res: Response) => {
    try {
      const subAccountId = Number(req.params.subAccountId);
      if (!Number.isFinite(subAccountId)) return res.status(400).json({ error: "invalid subAccountId" });

      const counties = await db
        .select({ counties: homeServiceContractors.counties, categories: homeServiceContractors.serviceCategories })
        .from(homeServiceContractors)
        .where(and(eq(homeServiceContractors.subAccountId, subAccountId), eq(homeServiceContractors.active, true)));

      if (counties.length === 0) {
        const allLeads = await db.select().from(homeServiceLeads)
          .orderBy(desc(homeServiceLeads.createdAt))
          .limit(100);
        return res.json({ leads: allLeads, scope: "all", contractorCount: 0 });
      }

      const countySet = new Set<string>();
      for (const c of counties) for (const co of (c.counties as string[]) ?? []) countySet.add(co);

      const leads = await db.select().from(homeServiceLeads)
        .where(sql`${homeServiceLeads.county} = ANY(${Array.from(countySet)})`)
        .orderBy(desc(homeServiceLeads.createdAt))
        .limit(200);

      res.json({ leads, scope: "matched", contractorCount: counties.length });
    } catch (err: any) {
      console.error(`[HOME-SERVICE] leads error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/home-service/stats
  app.get("/api/home-service/stats", async (_req: Request, res: Response) => {
    try {
      const [{ totalLeads }] = await db
        .select({ totalLeads: sql<number>`count(*)::int` })
        .from(homeServiceLeads);
      const [{ availableLeads }] = await db
        .select({ availableLeads: sql<number>`count(*)::int` })
        .from(homeServiceLeads).where(eq(homeServiceLeads.status, "available"));
      const [{ deliveredLeads }] = await db
        .select({ deliveredLeads: sql<number>`count(*)::int` })
        .from(homeServiceLeads).where(eq(homeServiceLeads.status, "delivered"));
      const [{ soldLeads }] = await db
        .select({ soldLeads: sql<number>`count(*)::int` })
        .from(homeServiceLeads).where(eq(homeServiceLeads.status, "sold"));
      const [{ claims }] = await db
        .select({ claims: sql<number>`count(*)::int` })
        .from(homeServiceLeadClaims).where(eq(homeServiceLeadClaims.status, "claimed"));
      const [{ contractors }] = await db
        .select({ contractors: sql<number>`count(*)::int` })
        .from(homeServiceContractors).where(eq(homeServiceContractors.active, true));

      res.json({
        totalLeads: Number(totalLeads),
        availableLeads: Number(availableLeads),
        deliveredLeads: Number(deliveredLeads),
        soldLeads: Number(soldLeads),
        claims: Number(claims),
        activeContractors: Number(contractors),
        pipeline: getHomeServicePipelineStats(),
      });
    } catch (err: any) {
      console.error(`[HOME-SERVICE] stats error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/home-service/claim/:token
  app.post("/api/home-service/claim/:token", async (req: Request, res: Response) => {
    try {
      const token = req.params.token;
      const contractorId = Number(req.body?.contractorId);
      const subAccountId = Number(req.body?.subAccountId ?? 13);
      if (!token || !Number.isFinite(contractorId)) {
        return res.status(400).json({ success: false, message: "token and contractorId required" });
      }
      const result = await claimLead(token, contractorId, subAccountId);
      res.status(result.success ? 200 : 400).json(result);
    } catch (err: any) {
      console.error(`[HOME-SERVICE] claim error: ${err.message}`);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // GET /api/home-service/contractors/:subAccountId
  app.get("/api/home-service/contractors/:subAccountId", async (req: Request, res: Response) => {
    try {
      const subAccountId = Number(req.params.subAccountId);
      if (!Number.isFinite(subAccountId)) return res.status(400).json({ error: "invalid subAccountId" });
      const rows = await db.select().from(homeServiceContractors)
        .where(eq(homeServiceContractors.subAccountId, subAccountId))
        .orderBy(desc(homeServiceContractors.createdAt));
      res.json({ contractors: rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/home-service/contractors
  app.post("/api/home-service/contractors", async (req: Request, res: Response) => {
    try {
      const parsed = insertHomeServiceContractorSchema.parse(req.body);
      const [row] = await db.insert(homeServiceContractors).values(parsed).returning();
      res.status(201).json({ contractor: row });
    } catch (err: any) {
      console.error(`[HOME-SERVICE] create contractor error: ${err.message}`);
      res.status(400).json({ error: err.message });
    }
  });

  // POST /api/home-service/pipeline/start
  app.post("/api/home-service/pipeline/start", async (req: Request, res: Response) => {
    try {
      const subAccountId = Number(req.body?.subAccountId ?? 13);
      startHomeServicePipeline(subAccountId);
      res.json({ ok: true, subAccountId, stats: getHomeServicePipelineStats() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/home-service/pipeline/stop
  app.post("/api/home-service/pipeline/stop", async (_req: Request, res: Response) => {
    try {
      stopHomeServicePipeline();
      res.json({ ok: true, stats: getHomeServicePipelineStats() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log("[HOME-SERVICE] Routes registered");
}
