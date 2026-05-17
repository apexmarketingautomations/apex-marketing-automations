/**
 * server/routes/newResidentAdmin.ts
 *
 * New Resident Intelligence — Admin API Routes (Phase 9A)
 *
 * Route groups:
 *   Transition Engine:
 *     POST /api/nr/ingest                    — ingest move signal(s)
 *     GET  /api/nr/events                    — recent resident events
 *     GET  /api/nr/events/stats              — event stats (confidence breakdown)
 *     GET  /api/nr/households                — scored households
 *
 *   Opportunity Scoring:
 *     POST /api/nr/score                     — score a household opportunity
 *     GET  /api/nr/scores/top                — top scored households
 *
 *   Business Matching:
 *     POST /api/nr/business/register         — register business in catalog
 *     POST /api/nr/match                     — match event to businesses
 *     GET  /api/nr/matches                   — get business matches
 *     POST /api/nr/match/:id/status          — update match status
 *
 *   Workflow Drafts (approval-gated):
 *     POST /api/nr/workflow/draft            — create workflow draft
 *     GET  /api/nr/workflow/pending          — pending drafts
 *     POST /api/nr/workflow/:id/approve      — approve draft (named actor)
 *     POST /api/nr/workflow/:id/reject       — reject draft (named actor)
 *     GET  /api/nr/workflow/stats            — workflow draft stats
 *
 *   AI Agent Recommendations:
 *     POST /api/nr/analyze                   — full analysis pipeline
 *     GET  /api/nr/recommendations           — get agent recommendations
 *
 *   Insurance/Contractor Crossover:
 *     POST /api/nr/crossover/generate        — generate crossover opportunities
 *     GET  /api/nr/crossover                 — list crossover opportunities
 *     GET  /api/nr/crossover/stats           — crossover stats
 *
 *   Compliance:
 *     POST /api/nr/suppress                  — add suppression
 *     POST /api/nr/suppress/:id/lift         — lift suppression
 *     GET  /api/nr/suppressions              — list suppressions
 *     GET  /api/nr/compliance/log            — compliance audit log
 */

import type { Express, Request, Response } from "express";

// ── Safe query coercion ───────────────────────────────────────────────────────

function qs(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

function qsNum(val: unknown, fallback: number): number {
  const n = Number(qs(val));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ── Lazy imports ──────────────────────────────────────────────────────────────

const getEngine    = () => import("../newResident/residentTransitionEngine");
const getMatcher   = () => import("../newResident/residentBusinessMatcher");
const getWorkflow  = () => import("../newResident/newResidentWorkflowCoordinator");
const getScoring   = () => import("../newResident/residentOpportunityScoring");
const getAgent     = () => import("../newResident/residentOpportunityAgent");
const getCrossover = () => import("../newResident/residentInsuranceCrossover");
const getCompliance = () => import("../newResident/residentComplianceGuard");

// ── Registration ──────────────────────────────────────────────────────────────

export function registerNewResidentAdminRoutes(app: Express): void {

  // ── Transition Engine ────────────────────────────────────────────────────────

  /**
   * POST /api/nr/ingest
   * Ingest a new-resident move signal batch.
   * Body: { tenantId, propertyAddress, county, state, zip?, signals[],
   *          estimatedMoveDate?, estimatedHomeValue?, propertyType?,
   *          yearBuilt?, hasHomesteadFiling?, moveWindowDays? }
   */
  app.post("/api/nr/ingest", async (req: Request, res: Response) => {
    try {
      const { tenantId, propertyAddress, county, state, signals, ...rest } = req.body ?? {};
      if (!tenantId || !propertyAddress || !county || !state || !Array.isArray(signals)) {
        return res.status(400).json({ error: "tenantId, propertyAddress, county, state, signals[] required" });
      }
      const { ingestResidentSignal } = await getEngine();
      const result = await ingestResidentSignal({ tenantId, propertyAddress, county, state, signals, ...rest });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/nr/events
   * Recent resident events for a tenant.
   * Query: tenantId, county?, state?, zip?, tier?, limit?, offset?
   */
  app.get("/api/nr/events", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getRecentResidentEvents } = await getEngine();
      res.json(await getRecentResidentEvents({
        tenantId,
        county:  qs(req.query.county),
        state:   qs(req.query.state),
        zip:     qs(req.query.zip),
        tier:    qs(req.query.tier) as any,
        limit:   qsNum(req.query.limit, 50),
        offset:  qsNum(req.query.offset, 0),
      }));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/nr/events/stats
   * Confidence breakdown + county heatmap.
   * Query: tenantId
   */
  app.get("/api/nr/events/stats", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getResidentEventStats } = await getEngine();
      res.json(await getResidentEventStats(tenantId));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/nr/households
   * Scored households sorted by opportunity score.
   * Query: tenantId, county?, zip?, minScore?, limit?, offset?
   */
  app.get("/api/nr/households", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getResidentHouseholds } = await getEngine();
      res.json(await getResidentHouseholds({
        tenantId,
        county:   qs(req.query.county),
        zip:      qs(req.query.zip),
        minScore: qsNum(req.query.minScore, 0),
        limit:    qsNum(req.query.limit, 50),
        offset:   qsNum(req.query.offset, 0),
      }));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  // ── Opportunity Scoring ───────────────────────────────────────────────────────

  /**
   * POST /api/nr/score
   * Score a household opportunity (returns score + persists).
   * Body: { householdId, tenantId, moveConfidence, homeownerLikelihood,
   *          daysSinceMove, signalCount, estimatedHomeValue?, opportunityCategories[] }
   */
  app.post("/api/nr/score", async (req: Request, res: Response) => {
    try {
      const { householdId, tenantId, moveConfidence, homeownerLikelihood,
              daysSinceMove, signalCount, opportunityCategories, ...rest } = req.body ?? {};
      if (!householdId || !tenantId || moveConfidence === undefined) {
        return res.status(400).json({ error: "householdId, tenantId, moveConfidence required" });
      }
      const { scoreResidentOpportunity, persistOpportunityScore } = await getScoring();
      const score = scoreResidentOpportunity({
        householdId, tenantId, moveConfidence, homeownerLikelihood: homeownerLikelihood ?? 50,
        daysSinceMove: daysSinceMove ?? 0, signalCount: signalCount ?? 1,
        opportunityCategories: opportunityCategories ?? [],
        ...rest,
      });
      await persistOpportunityScore(score);
      res.json(score);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/nr/scores/top
   * Top scored households for a tenant.
   * Query: tenantId, minScore?, limit?
   */
  app.get("/api/nr/scores/top", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getTopScoredHouseholds } = await getScoring();
      res.json(await getTopScoredHouseholds({
        tenantId,
        minScore: qsNum(req.query.minScore, 0),
        limit:    qsNum(req.query.limit, 50),
      }));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  // ── Business Matching ────────────────────────────────────────────────────────

  /**
   * POST /api/nr/business/register
   * Register or update a business in the match catalog.
   * Body: { businessTenantId, businessName, serviceCategory, serviceZip?,
   *          serviceCounty?, serviceState?, serviceRadiusMiles?, exclusiveTerritory? }
   */
  app.post("/api/nr/business/register", async (req: Request, res: Response) => {
    try {
      const { businessTenantId, businessName, serviceCategory, ...rest } = req.body ?? {};
      if (!businessTenantId || !businessName || !serviceCategory) {
        return res.status(400).json({ error: "businessTenantId, businessName, serviceCategory required" });
      }
      const { registerBusinessInCatalog } = await getMatcher();
      await registerBusinessInCatalog({ businessTenantId, businessName, serviceCategory, ...rest });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * POST /api/nr/match
   * Match a resident event to local businesses.
   * Body: { residentEventId, householdId, tenantId, zip?, county?, state?,
   *          opportunityCategories[], homeownerLikelihood, opportunityScore,
   *          daysSinceMove, limit? }
   */
  app.post("/api/nr/match", async (req: Request, res: Response) => {
    try {
      const { residentEventId, householdId, tenantId, ...rest } = req.body ?? {};
      if (!residentEventId || !householdId || !tenantId) {
        return res.status(400).json({ error: "residentEventId, householdId, tenantId required" });
      }
      const { matchResidentToBusinesses } = await getMatcher();
      const matches = await matchResidentToBusinesses({ residentEventId, householdId, tenantId, ...rest });
      res.json(matches);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/nr/matches
   * Business match records for a tenant.
   * Query: tenantId, status?, minScore?, limit?, offset?
   */
  app.get("/api/nr/matches", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getBusinessMatches } = await getMatcher();
      res.json(await getBusinessMatches({
        tenantId,
        status:   qs(req.query.status),
        minScore: qsNum(req.query.minScore, 0),
        limit:    qsNum(req.query.limit, 50),
        offset:   qsNum(req.query.offset, 0),
      }));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * POST /api/nr/match/:id/status
   * Update a match's routing status.
   * Body: { tenantId, status }
   */
  app.post("/api/nr/match/:id/status", async (req: Request, res: Response) => {
    try {
      const { tenantId, status } = req.body ?? {};
      if (!tenantId || !status) return res.status(400).json({ error: "tenantId, status required" });
      const { updateMatchStatus } = await getMatcher();
      await updateMatchStatus(req.params.id as string, tenantId, status);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  // ── Workflow Drafts ───────────────────────────────────────────────────────────

  /**
   * POST /api/nr/workflow/draft
   * Create a workflow draft (approval-gated, no auto-send).
   * Body: { residentEventId, householdId, tenantId, workflowType,
   *          businessName, zip?, county?, channel?, contextSummary? }
   */
  app.post("/api/nr/workflow/draft", async (req: Request, res: Response) => {
    try {
      const { residentEventId, householdId, tenantId, workflowType, businessName, ...rest } = req.body ?? {};
      if (!residentEventId || !householdId || !tenantId || !workflowType || !businessName) {
        return res.status(400).json({ error: "residentEventId, householdId, tenantId, workflowType, businessName required" });
      }
      const { createResidentWorkflowDraft } = await getWorkflow();
      const result = await createResidentWorkflowDraft({ residentEventId, householdId, tenantId, workflowType, businessName, ...rest });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/nr/workflow/pending
   * Pending workflow drafts awaiting approval.
   * Query: tenantId, limit?
   */
  app.get("/api/nr/workflow/pending", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getPendingWorkflowDrafts } = await getWorkflow();
      res.json(await getPendingWorkflowDrafts(tenantId, qsNum(req.query.limit, 50)));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * POST /api/nr/workflow/:id/approve
   * Approve a workflow draft. Named human approver required.
   * Body: { tenantId, approvedBy }
   */
  app.post("/api/nr/workflow/:id/approve", async (req: Request, res: Response) => {
    try {
      const { tenantId, approvedBy } = req.body ?? {};
      if (!tenantId || !approvedBy) return res.status(400).json({ error: "tenantId, approvedBy required" });
      const { approveResidentWorkflowDraft } = await getWorkflow();
      await approveResidentWorkflowDraft({ draftId: req.params.id as string, tenantId, approvedBy });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * POST /api/nr/workflow/:id/reject
   * Reject a workflow draft.
   * Body: { tenantId, rejectedBy, reason? }
   */
  app.post("/api/nr/workflow/:id/reject", async (req: Request, res: Response) => {
    try {
      const { tenantId, rejectedBy, reason } = req.body ?? {};
      if (!tenantId || !rejectedBy) return res.status(400).json({ error: "tenantId, rejectedBy required" });
      const { rejectResidentWorkflowDraft } = await getWorkflow();
      await rejectResidentWorkflowDraft({ draftId: req.params.id as string, tenantId, rejectedBy, reason });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/nr/workflow/stats
   * Workflow draft stats (30-day).
   * Query: tenantId
   */
  app.get("/api/nr/workflow/stats", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getWorkflowDraftStats } = await getWorkflow();
      res.json(await getWorkflowDraftStats(tenantId));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  // ── AI Agent ──────────────────────────────────────────────────────────────────

  /**
   * POST /api/nr/analyze
   * Full analysis pipeline: scoring + recommendations + crossover.
   * Body: { householdId, tenantId, residentEventId, moveConfidence,
   *          homeownerLikelihood, daysSinceMove, signalCount,
   *          lifecycleStage, opportunityCategories[], estimatedHomeValue?,
   *          matchedBusinesses? }
   */
  app.post("/api/nr/analyze", async (req: Request, res: Response) => {
    try {
      const { householdId, tenantId, residentEventId, ...rest } = req.body ?? {};
      if (!householdId || !tenantId || !residentEventId) {
        return res.status(400).json({ error: "householdId, tenantId, residentEventId required" });
      }
      const { analyzeResidentOpportunity } = await getAgent();
      const result = await analyzeResidentOpportunity({ householdId, tenantId, residentEventId, ...rest });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/nr/recommendations
   * Agent recommendations for a tenant.
   * Query: tenantId, priority?, limit?
   */
  app.get("/api/nr/recommendations", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getAgentRecommendations } = await getAgent();
      res.json(await getAgentRecommendations({
        tenantId,
        priority: qs(req.query.priority),
        limit:    qsNum(req.query.limit, 50),
      }));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  // ── Insurance/Contractor Crossover ────────────────────────────────────────────

  /**
   * POST /api/nr/crossover/generate
   * Generate insurance + contractor crossover opportunities.
   * Body: { residentEventId, householdId, tenantId, homeownerLikelihood,
   *          estimatedHomeValue?, yearBuilt?, daysSinceMove, moveConfidence,
   *          zip?, county?, minScore? }
   */
  app.post("/api/nr/crossover/generate", async (req: Request, res: Response) => {
    try {
      const { residentEventId, householdId, tenantId, ...rest } = req.body ?? {};
      if (!residentEventId || !householdId || !tenantId) {
        return res.status(400).json({ error: "residentEventId, householdId, tenantId required" });
      }
      const { generateCrossoverOpportunities } = await getCrossover();
      const opps = await generateCrossoverOpportunities({ residentEventId, householdId, tenantId, ...rest });
      res.json(opps);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/nr/crossover
   * Crossover opportunities for a tenant.
   * Query: tenantId, opportunityType?, status?, minScore?, limit?, offset?
   */
  app.get("/api/nr/crossover", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getCrossoverOpportunities } = await getCrossover();
      res.json(await getCrossoverOpportunities({
        tenantId,
        opportunityType: qs(req.query.opportunityType),
        status:          qs(req.query.status),
        minScore:        qsNum(req.query.minScore, 0),
        limit:           qsNum(req.query.limit, 50),
        offset:          qsNum(req.query.offset, 0),
      }));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/nr/crossover/stats
   * Crossover opportunity stats.
   * Query: tenantId
   */
  app.get("/api/nr/crossover/stats", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getCrossoverStats } = await getCrossover();
      res.json(await getCrossoverStats(tenantId));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  // ── Compliance ────────────────────────────────────────────────────────────────

  /**
   * POST /api/nr/suppress
   * Add a suppression (address hash, ZIP, or county).
   * Body: { tenantId, suppressionType, source, reason, address?, zip?,
   *          county?, state?, expiresAt? }
   */
  app.post("/api/nr/suppress", async (req: Request, res: Response) => {
    try {
      const { tenantId, suppressionType, source, reason, ...rest } = req.body ?? {};
      if (!tenantId || !suppressionType || !source || !reason) {
        return res.status(400).json({ error: "tenantId, suppressionType, source, reason required" });
      }
      const { addResidentSuppression } = await getCompliance();
      const suppressionId = await addResidentSuppression({ tenantId, suppressionType, source, reason, ...rest });
      res.json({ suppressionId });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * POST /api/nr/suppress/:id/lift
   * Lift an existing suppression.
   * Body: { tenantId }
   */
  app.post("/api/nr/suppress/:id/lift", async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.body ?? {};
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { liftResidentSuppression } = await getCompliance();
      await liftResidentSuppression(req.params.id as string, tenantId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/nr/suppressions
   * List suppressions for a tenant.
   * Query: tenantId, limit?
   */
  app.get("/api/nr/suppressions", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getSuppressions } = await getCompliance();
      res.json(await getSuppressions(tenantId, qsNum(req.query.limit, 50)));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/nr/compliance/log
   * Compliance audit log for a tenant.
   * Query: tenantId, limit?
   */
  app.get("/api/nr/compliance/log", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getComplianceLog } = await getCompliance();
      res.json(await getComplianceLog(tenantId, qsNum(req.query.limit, 100)));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  console.log("[NR-ROUTES] New Resident admin routes registered");
}
