/**
 * server/routes/insuranceAdmin.ts
 *
 * Insurance Intelligence Admin Routes
 *
 *   GET  /api/insurance/household-stats          — household intelligence KPIs
 *   GET  /api/insurance/top-households           — top-scored households
 *   GET  /api/insurance/storm-claim-stats        — storm claim opportunity stats
 *   GET  /api/insurance/storm-opportunities      — ready-to-outreach storm opps
 *   GET  /api/insurance/commercial-stats         — commercial risk KPIs
 *   GET  /api/insurance/commercial-opportunities — top commercial opps
 *   GET  /api/insurance/workflow-queue           — pending insurance workflows
 *   GET  /api/insurance/routing-stats            — agency routing performance
 *   GET  /api/insurance/pending-approvals        — workflows awaiting human review
 *   GET  /api/insurance/workflow-audit/:id       — approval audit timeline
 *   POST /api/insurance/ingest-household         — manual household enrichment
 *   POST /api/insurance/ingest-commercial        — manual DBPR/business ingest
 *   POST /api/insurance/process-storm/:eventId   — trigger storm opportunity processing
 *   POST /api/insurance/score-household/:id      — re-score a household
 *   POST /api/insurance/approve-workflow/:id     — approve a workflow draft (named actor)
 *   POST /api/insurance/reject-workflow/:id      — reject / cancel a workflow
 *   POST /api/insurance/pre-exec-validation      — score sweep: cancel stale/low-score
 *   POST /api/insurance/execute-workflow/:id     — execute single approved workflow
 *   POST /api/insurance/execute-batch            — batch-execute all approved due workflows
 *
 * All routes require admin auth.
 */

import type { Express, Request, Response } from "express";
import { isUserAdmin } from "./helpers";
import { getHouseholdStats, getTopHouseholds, upsertHousehold, correlateFromHPLProperty } from "../insurance/householdRiskEngine";
import { scorePolicy, detectOpportunityTypes, estimateHouseholdPremium, crossSellLikelihood } from "../insurance/policyScoringService";
import { getStormClaimStats, getReadyStormOpportunities, processStormOpportunities } from "../insurance/stormClaimIntelligence";
import { getCommercialStats, getTopCommercialOpportunities, ingestDbprLicense } from "../insurance/commercialRiskEngine";
import { getPendingInsuranceWorkflows, getInsuranceWorkflowStats, runPreExecutionValidation } from "../insurance/insuranceWorkflowCoordinator";
import { getInsuranceRoutingStats } from "../insurance/insuranceRoutingEngine";
import { approveWorkflow, rejectWorkflow, getPendingApprovals, getWorkflowAuditTimeline } from "../insurance/insuranceApprovalGate";
import { executeInsuranceWorkflow, executeApprovedBatch } from "../insurance/insuranceExecutionCoordinator";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { esc } from "../hpl/sqlSafe";

// ── Route registration ────────────────────────────────────────────────────────

export function registerInsuranceAdminRoutes(app: Express): void {

  // ── Household KPIs ──────────────────────────────────────────────────────

  app.get("/api/insurance/household-stats", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    try {
      const stats = await getHouseholdStats();
      return res.json(stats);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // ── Top households ──────────────────────────────────────────────────────

  app.get("/api/insurance/top-households", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const county  = req.query.county as string | undefined;
    const zip     = req.query.zip as string | undefined;
    const minScore = parseInt(String(req.query.minScore ?? "50"), 10);
    const limit   = Math.min(parseInt(String(req.query.limit ?? "25"), 10), 100);
    const hasPhone = req.query.hasPhone === "true";

    try {
      const households = await getTopHouseholds({ county, zip, minScore, limit, hasPhone });
      // Attach score breakdown to each
      const enriched = households.map(h => ({
        ...h,
        scoreBreakdown:       scorePolicy(h),
        opportunityTypes:     detectOpportunityTypes(h).map(o => o.opportunityType),
        estimatedPremium:     estimateHouseholdPremium(h),
        crossSellLikelihood:  crossSellLikelihood(h),
      }));
      return res.json({ households: enriched, total: enriched.length });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // ── Storm claim stats ───────────────────────────────────────────────────

  app.get("/api/insurance/storm-claim-stats", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    try {
      const stats = await getStormClaimStats();
      return res.json(stats);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // ── Storm opportunities ─────────────────────────────────────────────────

  app.get("/api/insurance/storm-opportunities", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const county              = req.query.county as string | undefined;
    const minScore            = parseInt(String(req.query.minScore ?? "40"), 10);
    const limit               = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
    const insuranceCrossoverOnly = req.query.insuranceCrossoverOnly === "true";
    try {
      const opportunities = await getReadyStormOpportunities({ county, minScore, limit, insuranceCrossoverOnly });
      return res.json({ opportunities });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // ── Trigger storm opportunity processing ────────────────────────────────

  app.post("/api/insurance/process-storm/:eventId", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const eventId = String(req.params.eventId);
    try {
      // Fetch storm event from HPL table — use esc() to prevent injection
      const result = await db.execute(sql.raw(`
        SELECT * FROM _hpl_storm_events WHERE event_id = ${esc(eventId)} LIMIT 1
      `));
      const rows = (result as any).rows ?? result;
      if (!Array.isArray(rows) || !rows[0]) return res.status(404).json({ error: "storm_event_not_found" });
      const r = rows[0];
      const event = {
        eventId:          r.event_id,
        eventType:        r.event_type,
        severity:         r.severity,
        county:           r.county,
        state:            r.state,
        startedAt:        r.started_at?.toISOString?.() ?? String(r.started_at),
        expiresAt:        r.expires_at?.toISOString?.() ?? undefined,
        hailSizeInches:   r.hail_size_inches ?? undefined,
        windSpeedMph:     r.wind_speed_mph ?? undefined,
        primaryTrades:    r.primary_trades ?? [],
        insuranceCrossFit: Boolean(r.insurance_cross_fit),
        opportunityScore: Number(r.opportunity_score ?? 0),
        source:           r.source ?? "unknown",
      } as any;
      const processResult = await processStormOpportunities(event);
      return res.json(processResult);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // ── Commercial stats ────────────────────────────────────────────────────

  app.get("/api/insurance/commercial-stats", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    try {
      const stats = await getCommercialStats();
      return res.json(stats);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // ── Commercial opportunities ────────────────────────────────────────────

  app.get("/api/insurance/commercial-opportunities", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const county      = req.query.county as string | undefined;
    const businessType = req.query.businessType as string | undefined;
    const minScore    = parseInt(String(req.query.minScore ?? "40"), 10);
    const limit       = Math.min(parseInt(String(req.query.limit ?? "25"), 10), 100);
    try {
      const opportunities = await getTopCommercialOpportunities({ county, businessType, minScore, limit });
      return res.json({ opportunities });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // ── Insurance workflow queue ────────────────────────────────────────────

  app.get("/api/insurance/workflow-queue", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const agencyId = req.query.agencyId ? parseInt(String(req.query.agencyId), 10) : undefined;
    const limit    = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
    try {
      const [pending, stats] = await Promise.all([
        getPendingInsuranceWorkflows({ agencyId, limit }),
        getInsuranceWorkflowStats(),
      ]);
      return res.json({ pending, stats });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // ── Agency routing stats ────────────────────────────────────────────────

  app.get("/api/insurance/routing-stats", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const sinceHours = parseInt(String(req.query.sinceHours ?? "24"), 10);
    try {
      const stats = await getInsuranceRoutingStats(sinceHours);
      return res.json(stats);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // ── Manual household ingest ─────────────────────────────────────────────

  app.post("/api/insurance/ingest-household", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const { primaryAddress, county, state } = req.body;
    if (!primaryAddress || !county || !state) {
      return res.status(400).json({ error: "primaryAddress, county, state required" });
    }
    try {
      const result = await upsertHousehold({ ...req.body, primaryAddress, county, state });
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // ── Correlate HPL property to household ────────────────────────────────

  app.post("/api/insurance/correlate-property/:apexPropertyId", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    try {
      const householdId = await correlateFromHPLProperty(String(req.params.apexPropertyId));
      if (!householdId) return res.status(404).json({ error: "property_not_found" });
      return res.json({ householdId });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // ── Manual DBPR license ingest ──────────────────────────────────────────

  app.post("/api/insurance/ingest-commercial", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const { licenseNumber, licenseType, businessName, address, county, state } = req.body;
    if (!licenseNumber || !licenseType || !businessName || !address || !county || !state) {
      return res.status(400).json({ error: "licenseNumber, licenseType, businessName, address, county, state required" });
    }
    try {
      const result = await ingestDbprLicense(req.body);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // ── Approval executor routes ────────────────────────────────────────────────

  // GET /api/insurance/pending-approvals  — list workflows awaiting human review
  app.get("/api/insurance/pending-approvals", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const agencyId = req.query.agencyId ? parseInt(String(req.query.agencyId), 10) : undefined;
    const limit    = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
    try {
      const pending = await getPendingApprovals({ agencyId, limit });
      return res.json({ pending, total: pending.length });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // POST /api/insurance/approve-workflow/:id  — approve a workflow draft
  app.post("/api/insurance/approve-workflow/:id", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const workflowId = parseInt(String(req.params.id), 10);
    const { approvedBy, draftContent } = req.body;
    if (!approvedBy || typeof approvedBy !== "string") {
      return res.status(400).json({ error: "approvedBy (string) required" });
    }
    try {
      const result = await approveWorkflow({ workflowId, approvedBy, draftContent });
      if (!result.success) return res.status(400).json({ error: result.error });
      return res.json({ success: true, workflowId });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // POST /api/insurance/reject-workflow/:id  — reject / cancel a workflow
  app.post("/api/insurance/reject-workflow/:id", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const workflowId = parseInt(String(req.params.id), 10);
    const { rejectedBy, reason } = req.body;
    if (!rejectedBy || typeof rejectedBy !== "string") {
      return res.status(400).json({ error: "rejectedBy (string) required" });
    }
    try {
      const result = await rejectWorkflow({ workflowId, rejectedBy, reason });
      if (!result.success) return res.status(400).json({ error: result.error });
      return res.json({ success: true, workflowId });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // GET /api/insurance/workflow-audit/:id  — approval audit timeline
  app.get("/api/insurance/workflow-audit/:id", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const workflowId = parseInt(String(req.params.id), 10);
    try {
      const timeline = await getWorkflowAuditTimeline(workflowId);
      return res.json({ timeline });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // POST /api/insurance/pre-exec-validation  — admin-triggered score sweep
  app.post("/api/insurance/pre-exec-validation", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const minScore      = parseInt(String(req.body.minScore ?? "30"), 10);
    const staleAfterDays = parseInt(String(req.body.staleAfterDays ?? "7"), 10);
    const agencyId      = req.body.agencyId ? parseInt(String(req.body.agencyId), 10) : undefined;
    try {
      const result = await runPreExecutionValidation({ minScore, staleAfterDays, agencyId });
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // ── Execution routes ────────────────────────────────────────────────────────
  //
  // These are the ONLY paths that trigger outbound communication.
  // Both call assertApproved() inside the adapter — approval gate re-validates
  // at send time, not just at approval time.

  // POST /api/insurance/execute-workflow/:id
  // Execute a single approved workflow. Requires subAccountId in body.
  app.post("/api/insurance/execute-workflow/:id", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const workflowId    = parseInt(String(req.params.id), 10);
    const subAccountId  = parseInt(String(req.body.subAccountId ?? "0"), 10);
    const callerAgencyId = parseInt(String(req.body.agencyId ?? "0"), 10);
    const channelOverride = req.body.channel as "sms" | "email" | "voice" | undefined;
    const baseUrl       = req.body.baseUrl as string | undefined;

    if (!subAccountId || !callerAgencyId) {
      return res.status(400).json({ error: "subAccountId and agencyId required" });
    }

    try {
      const result = await executeInsuranceWorkflow({
        workflowId,
        callerAgencyId,
        subAccountId,
        baseUrl,
        channelOverride,
      });
      return res.status(result.ok ? 200 : 422).json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  // POST /api/insurance/execute-batch
  // Execute all approved-and-due workflows for an agency in one sweep.
  app.post("/api/insurance/execute-batch", async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "admin_required" });
    const subAccountId   = parseInt(String(req.body.subAccountId ?? "0"), 10);
    const callerAgencyId = parseInt(String(req.body.agencyId ?? "0"), 10);
    const maxPerRun      = Math.min(parseInt(String(req.body.maxPerRun ?? "20"), 10), 50);
    const baseUrl        = req.body.baseUrl as string | undefined;
    const runPreExecSweep = req.body.runPreExecSweep !== false;

    if (!subAccountId || !callerAgencyId) {
      return res.status(400).json({ error: "subAccountId and agencyId required" });
    }

    try {
      const result = await executeApprovedBatch({
        callerAgencyId,
        subAccountId,
        baseUrl,
        maxPerRun,
        runPreExecSweep,
      });
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "failed" });
    }
  });
}
