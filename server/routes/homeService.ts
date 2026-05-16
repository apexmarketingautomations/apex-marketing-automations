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
import { asyncHandler, parseIntParam, verifyAccountOwnership, isUserAdmin } from "./helpers";

export function registerHomeServiceRoutes(app: Express): void {
  // GET /api/home-service/leads/:subAccountId
  app.get("/api/home-service/leads/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (subAccountId === null) return res.status(400).json({ error: "invalid subAccountId" });
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    try {

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
  }));

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
  app.post("/api/home-service/claim/:token", asyncHandler(async (req: Request, res: Response) => {
    const token = req.params.token;
    const contractorId = Number(req.body?.contractorId);
    const subAccountId = Number(req.body?.subAccountId);
    if (!token || !Number.isFinite(contractorId)) {
      return res.status(400).json({ success: false, message: "token and contractorId required" });
    }
    if (!Number.isFinite(subAccountId)) {
      return res.status(400).json({ success: false, message: "subAccountId required" });
    }
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    try {
      const result = await claimLead(token, contractorId, subAccountId);
      res.status(result.success ? 200 : 400).json(result);
    } catch (err: any) {
      console.error(`[HOME-SERVICE] claim error: ${err.message}`);
      res.status(500).json({ success: false, message: err.message });
    }
  }));

  // PATCH /api/home-service/leads/:id — update stage, notes, status
  app.patch("/api/home-service/leads/:id", asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
    // Fetch lead first to verify ownership
    const [lead] = await db.select({ id: homeServiceLeads.id, subAccountId: homeServiceLeads.subAccountId })
      .from(homeServiceLeads).where(eq(homeServiceLeads.id, id)).limit(1);
    if (!lead) return res.status(404).json({ error: "lead not found" });
    if (lead.subAccountId != null && !(await verifyAccountOwnership(req, res, lead.subAccountId))) return;
    try {
      const { stage, notes, status } = req.body as { stage?: string; notes?: string; status?: string };
      const update: Record<string, any> = { updatedAt: new Date() };
      if (stage  !== undefined) update.status = stage;
      if (notes  !== undefined) update.scoreBreakdown = notes;
      if (status !== undefined) update.status = status;
      const [updated] = await db.update(homeServiceLeads)
        .set(update)
        .where(eq(homeServiceLeads.id, id))
        .returning();
      res.json({ ok: true, lead: updated });
    } catch (err: any) {
      console.error(`[HOME-SERVICE] patch lead error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  }));

  // GET /api/home-service/contractors/:subAccountId
  app.get("/api/home-service/contractors/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (subAccountId === null) return res.status(400).json({ error: "invalid subAccountId" });
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    try {
      const rows = await db.select().from(homeServiceContractors)
        .where(eq(homeServiceContractors.subAccountId, subAccountId))
        .orderBy(desc(homeServiceContractors.createdAt));
      res.json({ contractors: rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  // POST /api/home-service/contractors
  app.post("/api/home-service/contractors", asyncHandler(async (req: Request, res: Response) => {
    const parsed = insertHomeServiceContractorSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if (!(await verifyAccountOwnership(req, res, parsed.data.subAccountId))) return;
    try {
      const [row] = await db.insert(homeServiceContractors).values(parsed.data).returning();
      res.status(201).json({ contractor: row });
    } catch (err: any) {
      console.error(`[HOME-SERVICE] create contractor error: ${err.message}`);
      res.status(400).json({ error: err.message });
    }
  }));

  // POST /api/home-service/pipeline/start — admin only
  app.post("/api/home-service/pipeline/start", asyncHandler(async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    try {
      const subAccountId = Number(req.body?.subAccountId);
      if (!Number.isFinite(subAccountId)) return res.status(400).json({ error: "subAccountId required" });
      startHomeServicePipeline(subAccountId);
      res.json({ ok: true, subAccountId, stats: getHomeServicePipelineStats() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

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
