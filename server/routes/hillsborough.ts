/**
 * Hillsborough County Official Records Routes
 *
 *   POST /api/hillsborough/ingest          — Manual trigger (admin)
 *   GET  /api/hillsborough/stats           — Pipeline status + last run stats
 *   GET  /api/hillsborough/leads           — Lis pendens + judgment leads
 */

import type { Express } from "express";
import { asyncHandler }  from "./helpers";

function requireAdmin(req: any, res: any): boolean {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return false; }
  if (req.user.role !== "admin" && req.user.id !== 1) {
    res.status(403).json({ error: "Admin only" }); return false;
  }
  return true;
}

export function registerHillsboroughRoutes(app: Express) {
  // ── POST /api/hillsborough/ingest ────────────────────────────────────────
  app.post("/api/hillsborough/ingest", asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const daysBack = req.body?.daysBack ? Number(req.body.daysBack) : 1;

    res.status(202).json({
      status:  "accepted",
      message: "Hillsborough records ingest started",
      daysBack,
    });

    setImmediate(async () => {
      try {
        const { runHillsboroughRecordsCycle } = await import("../hillsboroughRecordsPipeline");
        const results = await runHillsboroughRecordsCycle({ daysBack });
        const totals  = results.reduce((s, r) => ({
          inserted: s.inserted + r.inserted,
          skipped:  s.skipped  + r.skipped,
          errors:   s.errors   + r.errors,
          contacts: s.contacts + r.contacts,
        }), { inserted: 0, skipped: 0, errors: 0, contacts: 0 });
        console.log(
          `[HILLS-ROUTES] Manual ingest complete — ` +
          `inserted=${totals.inserted} skipped=${totals.skipped} ` +
          `errors=${totals.errors} contacts=${totals.contacts}`
        );
      } catch (err: any) {
        console.error("[HILLS-ROUTES] Manual ingest error:", err?.message);
      }
    });
  }));

  // ── GET /api/hillsborough/stats ──────────────────────────────────────────
  app.get("/api/hillsborough/stats", asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { getHillsboroughRecordsPipelineStats } = await import("../hillsboroughRecordsPipeline");
    const stats = getHillsboroughRecordsPipelineStats();

    res.json({
      pipeline: "hillsborough_official_records",
      source:   "publicrec.hillsclerk.com",
      county:   "HILLSBOROUGH",
      signalTypes: ["lis_pendens", "civil_judgment"],
      scheduleDescription: "Daily at 06:00 ET",
      ...stats,
    });
  }));

  // ── GET /api/hillsborough/leads ──────────────────────────────────────────
  app.get("/api/hillsborough/leads", asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { db }          = await import("../db");
    const { legalLeads }  = await import("@shared/schema");
    const { desc, eq, and, inArray } = await import("drizzle-orm");

    const limit     = Math.min(Number(req.query.limit  ?? 50), 200);
    const offset    = Number(req.query.offset ?? 0);
    const signalType = typeof req.query.signalType === "string" ? req.query.signalType : undefined;
    const status    = typeof req.query.status === "string" ? req.query.status : "available";

    const conds: any[] = [
      inArray(legalLeads.signalType, ["lis_pendens", "civil_judgment"]),
      eq(legalLeads.county, "HILLSBOROUGH"),
    ];
    if (status !== "all") conds.push(eq(legalLeads.status, status));
    if (signalType) conds.push(eq(legalLeads.signalType, signalType));

    const rows = await db
      .select()
      .from(legalLeads)
      .where(and(...conds))
      .orderBy(desc(legalLeads.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ leads: rows, count: rows.length, offset, limit });
  }));
}
