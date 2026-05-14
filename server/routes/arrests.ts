/**
 * Arrest Pipeline Routes
 *
 * Admin + dashboard API for the criminal-defense / DUI lead intelligence pipeline.
 *
 * Endpoints:
 *   POST /api/arrests/ingest          — Manually trigger a full ingest run
 *   POST /api/arrests/ingest/:county  — Trigger ingest for a single county
 *   GET  /api/arrests/stats           — Last run stats + scheduler status
 *   GET  /api/arrests/leads           — List qualified arrest leads (legalLeads)
 *   GET  /api/arrests/signals         — List raw signals (legalSignals, type=arrest)
 *   GET  /api/arrests/blockers        — Active county blockers from last run
 *   GET  /api/arrests/counties        — County config + enabled status
 *
 * Authentication: all routes require a logged-in session (req.user) except where
 * noted.  Admin-only routes additionally check req.user.role === "admin".
 */

import type { Express } from "express";
import { asyncHandler }  from "./helpers";

// ── County list (mirrors COUNTY_BOOKING_CONFIGS) ──────────────────────────────
const ALL_COUNTIES = [
  "LEE", "CHARLOTTE", "COLLIER", "HENDRY", "GLADES",
  "SARASOTA", "MANATEE", "POLK", "HILLSBOROUGH", "PINELLAS", "PASCO",
];

// ── Simple admin guard ────────────────────────────────────────────────────────
function requireAdmin(req: any, res: any): boolean {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  if (req.user.role !== "admin" && req.user.id !== 1) {
    res.status(403).json({ error: "Admin only" });
    return false;
  }
  return true;
}

export function registerArrestRoutes(app: Express) {
  // ── POST /api/arrests/ingest ─────────────────────────────────────────────
  // Trigger a full county ingest run (admin only, async — returns job status).
  app.post("/api/arrests/ingest", asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const daysBack  = req.body?.daysBack  ? Number(req.body.daysBack)  : 3;
    const counties  = Array.isArray(req.body?.counties) ? req.body.counties as string[] : undefined;

    // Kick off async — respond immediately with 202 so the HTTP connection
    // doesn't hold open for the full scrape (can take several minutes).
    res.status(202).json({
      status:   "accepted",
      message:  "Arrest ingest started",
      counties: counties ?? "ALL",
      daysBack,
    });

    // Run in background after responding
    setImmediate(async () => {
      try {
        const { runArrestIngest } = await import("../arrestIngestPipeline");
        const stats = await runArrestIngest({ counties, daysBack });
        console.log(
          `[ARREST-ROUTES] Manual ingest complete: ` +
          `inserted=${stats.totalInserted} leads=${stats.leadsCreated} ` +
          `contacts=${stats.contactsRouted} errors=${stats.totalErrors}`
        );
      } catch (err: any) {
        console.error("[ARREST-ROUTES] Manual ingest error:", err?.message);
      }
    });
  }));

  // ── POST /api/arrests/ingest/:county ────────────────────────────────────
  // Single-county manual trigger (admin only).
  app.post("/api/arrests/ingest/:county", asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const county = String(req.params.county ?? "").toUpperCase();
    if (!ALL_COUNTIES.includes(county)) {
      return res.status(400).json({
        error:     `Unknown county: ${county}`,
        available: ALL_COUNTIES,
      });
    }

    const daysBack = req.body?.daysBack ? Number(req.body.daysBack) : 3;
    res.status(202).json({ status: "accepted", county, daysBack });

    setImmediate(async () => {
      try {
        const { runArrestIngest } = await import("../arrestIngestPipeline");
        await runArrestIngest({ counties: [county], daysBack });
      } catch (err: any) {
        console.error(`[ARREST-ROUTES] Single-county ingest error (${county}):`, err?.message);
      }
    });
  }));

  // ── GET /api/arrests/stats ───────────────────────────────────────────────
  // Returns last run stats + scheduler/config status.
  app.get("/api/arrests/stats", asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { getArrestIngestStats, isArrestIngestConfigured } = await import("../arrestIngestPipeline");
    const { getJailBookingStats } = await import("../jailBookingPipeline");

    const lastRun  = getArrestIngestStats();
    const configured = isArrestIngestConfigured();
    const agentStats = getJailBookingStats();

    res.json({
      configured,
      nimbleConfigured:  !!(process.env.NIMBLE_API_KEY || process.env.NIMBLE_TOKEN),
      apifyConfigured:   !!(process.env.APIFY_API_KEY || process.env.APIFY_TOKEN || process.env.APIFY_KEY),
      lastRun:           lastRun ?? null,
      // Jail booking pipeline (Nimble agents path) status
      nimbleAgentPipeline: agentStats,
      counties:          ALL_COUNTIES,
    });
  }));

  // ── GET /api/arrests/leads ───────────────────────────────────────────────
  // Paginated list of arrest-sourced legalLeads.
  app.get("/api/arrests/leads", asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { db }         = await import("../db");
    const { legalLeads } = await import("@shared/schema");
    const { desc, eq, and, gte, inArray } = await import("drizzle-orm");

    const limit    = Math.min(Number(req.query.limit  ?? 50), 200);
    const offset   = Number(req.query.offset ?? 0);
    const county   = typeof req.query.county  === "string" ? req.query.county  : undefined;
    const urgency  = typeof req.query.urgency === "string" ? req.query.urgency : undefined;
    const status   = typeof req.query.status  === "string" ? req.query.status  : "available";
    const minScore = Number(req.query.minScore ?? 0);

    const conds: any[] = [
      // Only arrest-type signals
      inArray(legalLeads.signalType, ["arrest", "dui_arrest", "jail_booking"]),
    ];
    if (status !== "all")  conds.push(eq(legalLeads.status,  status));
    if (county)            conds.push(eq(legalLeads.county,  county.toUpperCase()));
    if (urgency)           conds.push(eq(legalLeads.urgency, urgency));
    if (minScore > 0)      conds.push(gte(legalLeads.score,  minScore));

    const rows = await db
      .select()
      .from(legalLeads)
      .where(and(...conds))
      .orderBy(desc(legalLeads.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ leads: rows, count: rows.length, offset, limit });
  }));

  // ── GET /api/arrests/signals ─────────────────────────────────────────────
  // Raw legalSignals with signalType in ['arrest', 'dui_arrest', 'jail_booking'].
  app.get("/api/arrests/signals", asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { db }            = await import("../db");
    const { legalSignals }  = await import("@shared/schema");
    const { desc, eq, and, gte, inArray } = await import("drizzle-orm");

    const limit    = Math.min(Number(req.query.limit  ?? 100), 500);
    const offset   = Number(req.query.offset ?? 0);
    const county   = typeof req.query.county === "string" ? req.query.county : undefined;
    const status   = typeof req.query.status === "string" ? req.query.status : undefined;
    const minScore = Number(req.query.minScore ?? 0);

    const conds: any[] = [
      inArray(legalSignals.signalType, ["arrest", "dui_arrest", "jail_booking"]),
    ];
    if (status)       conds.push(eq(legalSignals.status,  status));
    if (county)       conds.push(eq(legalSignals.county,  county.toUpperCase()));
    if (minScore > 0) conds.push(gte(legalSignals.score,  minScore));

    const rows = await db
      .select()
      .from(legalSignals)
      .where(and(...conds))
      .orderBy(desc(legalSignals.detectedAt))
      .limit(limit)
      .offset(offset);

    res.json({ signals: rows, count: rows.length, offset, limit });
  }));

  // ── GET /api/arrests/blockers ────────────────────────────────────────────
  // Returns county blockers from the most recent ingest run.
  app.get("/api/arrests/blockers", asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { getArrestIngestStats } = await import("../arrestIngestPipeline");
    const stats = getArrestIngestStats();

    if (!stats) {
      return res.json({
        blockers:    {},
        lastRunAt:   null,
        message:     "No ingest run recorded yet",
      });
    }

    // Build per-county detail from last run
    const detail = stats.counties.map(c => ({
      county:   c.county,
      strategy: c.strategy,
      blocker:  c.blocker ?? null,
      scraped:  c.scraped,
      inserted: c.inserted,
    }));

    res.json({
      blockers:  stats.blockers,
      counties:  detail,
      lastRunAt: stats.completedAt,
    });
  }));

  // ── GET /api/arrests/counties ────────────────────────────────────────────
  // County config list with last-run stats overlaid.
  app.get("/api/arrests/counties", asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { getArrestIngestStats } = await import("../arrestIngestPipeline");
    const stats = getArrestIngestStats();

    const countyMap = new Map(
      (stats?.counties ?? []).map(c => [c.county, c]),
    );

    const countyList = ALL_COUNTIES.map(county => {
      const run = countyMap.get(county);
      return {
        county,
        state:    "FL",
        lastRun:  run ? {
          scraped:   run.scraped,
          inserted:  run.inserted,
          dupes:     run.dupes,
          errors:    run.errors,
          strategy:  run.strategy,
          blocked:   !!run.blocker,
          blocker:   run.blocker ?? null,
        } : null,
      };
    });

    res.json({ counties: countyList, total: countyList.length });
  }));
}
