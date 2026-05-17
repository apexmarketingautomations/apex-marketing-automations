/**
 * server/routes/hplAdmin.ts
 *
 * HPL Intelligence Admin Routes
 *
 * Provides the API surface for the Contractor Intelligence Dashboard:
 *   GET  /api/hpl/property-stats           — property intelligence summary
 *   GET  /api/hpl/storm-events             — active storm events with scoring
 *   GET  /api/hpl/routing-stats            — lead routing performance
 *   GET  /api/hpl/workflow-queue           — pending automation workflows
 *   GET  /api/hpl/neighborhood-insights    — county/zip market analysis
 *   GET  /api/hpl/county-clusters          — geographic opportunity clusters
 *   GET  /api/hpl/lead-pipeline            — lead funnel stats
 *   POST /api/hpl/ingest-storm             — manual storm event ingest (admin)
 *   POST /api/hpl/enrich-signal            — manual property enrichment trigger
 *   POST /api/hpl/route-lead/:leadId       — trigger routing for a specific lead
 *
 * All routes require admin auth.
 */

import type { Express, Request, Response } from "express";
import { isUserAdmin } from "../auth";
import { getWorkflowStats, getPendingWorkflows } from "../hpl/hplWorkflowCoordinator";
import { getActiveStormEvents, getStormOpportunityStats, ingestStormEvent, normalizeNWSSignal } from "../hpl/stormOpportunityEngine";
import { getRoutingStats, buildRoutingPlan, executeRouting, getContractorTerritoryMap } from "../hpl/contractorRoutingEngine";
import { buildCountyClusters, getNeighborhoodInsights, linkLeadsToProperties } from "../hpl/propertyRelationshipGraph";
import { runEnrichmentPass } from "../hpl/propertyEnrichmentService";
import { db } from "../db";
import { homeServiceLeads, homeServiceSignals } from "@shared/schema";
import { sql, desc, and, gte } from "drizzle-orm";

// ── Route registration ────────────────────────────────────────────────────────

export function registerHplAdminRoutes(app: Express): void {

  // ── Property intelligence stats ──────────────────────────────────────────

  app.get("/api/hpl/property-stats", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    try {
      const result = await db.execute(sql.raw(`
        SELECT
          COUNT(*)                                                          AS total_properties,
          AVG(contractor_opportunity_score)                                 AS avg_opportunity_score,
          COUNT(CASE WHEN contractor_opportunity_score >= 70 THEN 1 END)   AS high_value_count,
          COUNT(CASE WHEN contractor_opportunity_score >= 50 THEN 1 END)   AS medium_value_count,
          COUNT(CASE WHEN array_length(active_signals, 1) > 0 THEN 1 END)  AS with_active_signals,
          COUNT(CASE WHEN storm_exposure_score >= 60 THEN 1 END)           AS high_storm_exposure,
          COUNT(CASE WHEN enrichment_sources @> ARRAY['skip_trace']::TEXT[] THEN 1 END) AS skip_traced,
          AVG(estimated_value)                                              AS avg_property_value,
          AVG(roof_age_estimate)                                            AS avg_roof_age,
          MAX(last_enriched_at)                                             AS last_enriched_at
        FROM _hpl_properties
      `));
      const rows = (result as any).rows ?? result;
      const r = rows[0] ?? {};

      return res.json({
        totalProperties:    Number(r.total_properties ?? 0),
        avgOpportunityScore: parseFloat(r.avg_opportunity_score ?? "0"),
        highValueCount:     Number(r.high_value_count ?? 0),
        mediumValueCount:   Number(r.medium_value_count ?? 0),
        withActiveSignals:  Number(r.with_active_signals ?? 0),
        highStormExposure:  Number(r.high_storm_exposure ?? 0),
        skipTracedCount:    Number(r.skip_traced ?? 0),
        avgPropertyValue:   parseFloat(r.avg_property_value ?? "0"),
        avgRoofAge:         parseFloat(r.avg_roof_age ?? "0"),
        lastEnrichedAt:     r.last_enriched_at ?? null,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "query_failed" });
    }
  });

  // ── Top opportunity properties ────────────────────────────────────────────

  app.get("/api/hpl/top-properties", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10), 100);
    const county = req.query.county as string | undefined;
    const minScore = parseInt(String(req.query.minScore ?? "60"), 10);

    try {
      const countyClause = county ? `AND county = '${county.replace(/'/g, "''")}'` : "";
      const result = await db.execute(sql.raw(`
        SELECT
          apex_property_id, property_address, county, state,
          owner_name, owner_phone,
          contractor_opportunity_score, estimated_value,
          roof_age_estimate, storm_exposure_score,
          active_signals, enrichment_sources, last_enriched_at
        FROM _hpl_properties
        WHERE contractor_opportunity_score >= ${minScore} ${countyClause}
        ORDER BY contractor_opportunity_score DESC
        LIMIT ${limit}
      `));
      const rows = (result as any).rows ?? result;
      return res.json({ properties: Array.isArray(rows) ? rows : [], total: rows?.length ?? 0 });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "query_failed" });
    }
  });

  // ── Active storm events ───────────────────────────────────────────────────

  app.get("/api/hpl/storm-events", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const county = req.query.county as string | undefined;
    const minScore = parseInt(String(req.query.minScore ?? "20"), 10);
    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);

    try {
      const [events, stats] = await Promise.all([
        getActiveStormEvents({ county, minScore, limit }),
        getStormOpportunityStats(),
      ]);
      return res.json({ events, stats });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "storm_query_failed" });
    }
  });

  // ── Manual storm ingest ───────────────────────────────────────────────────

  app.post("/api/hpl/ingest-storm", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const { eventId, eventType, severity, county, state, startedAt, expiresAt, lat, lng, hailSizeInches, windSpeedMph } = req.body;
    if (!eventId || !eventType || !severity || !county || !state || !startedAt) {
      return res.status(400).json({ error: "missing_required_fields" });
    }
    try {
      const event = await ingestStormEvent({
        eventId, eventType, severity, county, state,
        startedAt, expiresAt, lat, lng, hailSizeInches, windSpeedMph,
        source: "manual_admin",
      });
      return res.json({ event });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "ingest_failed" });
    }
  });

  // ── Lead routing stats ────────────────────────────────────────────────────

  app.get("/api/hpl/routing-stats", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const sinceHours = parseInt(String(req.query.sinceHours ?? "24"), 10);
    try {
      const [routingStats, territoryMap] = await Promise.all([
        getRoutingStats(sinceHours),
        getContractorTerritoryMap(),
      ]);
      return res.json({ routing: routingStats, territory: territoryMap });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "routing_stats_failed" });
    }
  });

  // ── Trigger routing for a lead ────────────────────────────────────────────

  app.post("/api/hpl/route-lead/:leadId", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const leadId = parseInt(req.params.leadId, 10);
    if (isNaN(leadId)) return res.status(400).json({ error: "invalid_lead_id" });

    try {
      // Fetch lead details
      const leads = await db.execute(sql.raw(`
        SELECT id, county, signal_type, score FROM home_service_leads WHERE id = ${leadId} LIMIT 1
      `));
      const lrows = (leads as any).rows ?? leads;
      const lead = Array.isArray(lrows) && lrows[0];
      if (!lead) return res.status(404).json({ error: "lead_not_found" });

      const trades = lead.signal_type ? [lead.signal_type] : ["roofing"];
      const plan = await buildRoutingPlan(leadId, trades as any, lead.county ?? "UNKNOWN", "standard", false, lead.score);
      const result = await executeRouting(plan);

      return res.json({ plan, result });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "routing_failed" });
    }
  });

  // ── Workflow queue ────────────────────────────────────────────────────────

  app.get("/api/hpl/workflow-queue", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const contractorId = req.query.contractorId ? parseInt(String(req.query.contractorId), 10) : undefined;
    const type = req.query.type as string | undefined;
    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);

    try {
      const [pending, stats] = await Promise.all([
        getPendingWorkflows({ contractorId, type: type as any, limit }),
        getWorkflowStats(),
      ]);
      return res.json({ pending, stats });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "workflow_query_failed" });
    }
  });

  // ── Neighborhood insights ─────────────────────────────────────────────────

  app.get("/api/hpl/neighborhood-insights", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const county = String(req.query.county ?? "");
    const zip = req.query.zip as string | undefined;
    if (!county) return res.status(400).json({ error: "county_required" });
    try {
      const insights = await getNeighborhoodInsights(county, zip);
      return res.json({ county, zip, ...insights });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "insights_failed" });
    }
  });

  // ── County opportunity clusters ───────────────────────────────────────────

  app.get("/api/hpl/county-clusters", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    try {
      const clusters = await buildCountyClusters();
      return res.json({ clusters });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "cluster_failed" });
    }
  });

  // ── Lead pipeline stats ───────────────────────────────────────────────────

  app.get("/api/hpl/lead-pipeline", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const sinceHours = parseInt(String(req.query.sinceHours ?? "168"), 10); // 7 days default

    try {
      const since = new Date(Date.now() - sinceHours * 3_600_000).toISOString();
      const result = await db.execute(sql.raw(`
        SELECT
          COUNT(*)                                                                 AS total_leads,
          COUNT(CASE WHEN status = 'pending' THEN 1 END)                         AS pending,
          COUNT(CASE WHEN status = 'claimed' THEN 1 END)                          AS claimed,
          COUNT(CASE WHEN status = 'expired' THEN 1 END)                          AS expired,
          COUNT(CASE WHEN status = 'converted' THEN 1 END)                        AS converted,
          AVG(score)                                                               AS avg_score,
          signal_type,
          COUNT(*) FILTER (WHERE score >= 70)                                      AS high_score_count
        FROM home_service_leads
        WHERE created_at >= '${since}'
        GROUP BY signal_type
        ORDER BY COUNT(*) DESC
      `));
      const rows = (result as any).rows ?? result;

      const totals = { total: 0, pending: 0, claimed: 0, expired: 0, converted: 0 };
      const byType: Record<string, { count: number; avgScore: number; highScore: number }> = {};
      for (const r of (Array.isArray(rows) ? rows : [])) {
        const n = Number(r.total_leads ?? 0);
        totals.total += n;
        totals.pending += Number(r.pending ?? 0);
        totals.claimed += Number(r.claimed ?? 0);
        totals.expired += Number(r.expired ?? 0);
        totals.converted += Number(r.converted ?? 0);
        if (r.signal_type) {
          byType[r.signal_type] = {
            count: n,
            avgScore: parseFloat(r.avg_score ?? "0"),
            highScore: Number(r.high_score_count ?? 0),
          };
        }
      }

      const claimRate = totals.total > 0 ? (totals.claimed / totals.total) * 100 : 0;
      const conversionRate = totals.claimed > 0 ? (totals.converted / totals.claimed) * 100 : 0;

      return res.json({ ...totals, claimRatePct: claimRate, conversionRatePct: conversionRate, byType, sinceHours });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "pipeline_query_failed" });
    }
  });

  // ── Recent signals ────────────────────────────────────────────────────────

  app.get("/api/hpl/signals", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
    const signalType = req.query.signalType as string | undefined;
    const county = req.query.county as string | undefined;

    try {
      const typeClause   = signalType ? `AND signal_type = '${signalType.replace(/'/g, "''")}'` : "";
      const countyClause = county     ? `AND county = '${county.replace(/'/g, "''")}'`       : "";
      const result = await db.execute(sql.raw(`
        SELECT id, signal_type, severity, county, address, score, status, source, created_at
        FROM home_service_signals
        WHERE 1=1 ${typeClause} ${countyClause}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `));
      const rows = (result as any).rows ?? result;
      return res.json({ signals: Array.isArray(rows) ? rows : [] });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "signals_query_failed" });
    }
  });

  // ── Manual enrichment trigger ─────────────────────────────────────────────

  app.post("/api/hpl/enrich-signal", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const { signals } = req.body;
    if (!Array.isArray(signals) || signals.length === 0) {
      return res.status(400).json({ error: "signals array required" });
    }
    if (signals.length > 50) {
      return res.status(400).json({ error: "max 50 signals per batch" });
    }
    try {
      const result = await runEnrichmentPass(signals);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "enrichment_failed" });
    }
  });

  // ── Link leads to properties ──────────────────────────────────────────────

  app.post("/api/hpl/link-leads", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    try {
      const result = await linkLeadsToProperties();
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "link_failed" });
    }
  });
}
