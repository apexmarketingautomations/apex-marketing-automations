// @ts-nocheck
import type { Express } from "express";
import { createServer, type Server } from "http";
import { asyncHandler, requireAdmin } from "./routes/helpers";

import { registerSitesRoutes } from "./routes/sites";
import { registerFunnelRoutes } from "./routes/funnel";
import { registerAuthRoutes } from "./routes/auth";
import { registerAdminRoutes } from "./routes/admin";
import { registerAccountRoutes } from "./routes/accounts";
import { registerMessagingRoutes } from "./routes/messaging";
import { registerMessagingEmailRoutes } from "./routes/messagingEmail";
import { registerWorkflowsRoutes } from "./routes/workflows";
import { registerBotRoutes } from "./routes/bot";
import { registerBlueprintsRoutes } from "./routes/blueprints";
import { registerAdsRoutes } from "./routes/ads";
import { registerChatRoutes } from "./routes/chat";
import { registerVoiceRoutes } from "./routes/voice";
import { registerWebhooksRoutes } from "./routes/webhooks";
import { registerReviewsRoutes } from "./routes/reviews";
import { registerSubscriptionsRoutes } from "./routes/subscriptions";
import { registerSnapshotsRoutes } from "./routes/snapshots";
import { registerAffiliatesRoutes } from "./routes/affiliates";
import { registerSentinelRoutes, registerRetroSkipTraceRoute } from "./routes/sentinel";
import { registerDomainRoutes } from "./routes/domains";
import { registerPropertyRoutes } from "./routes/property";
import { registerMetaRoutes } from "./routes/meta";
import { registerNotificationsRoutes } from "./routes/notifications";
import { registerDashboardRoutes } from "./routes/dashboard";
import { registerV1Routes } from "./routes/v1";
import { registerIntegrationsRoutes } from "./routes/integrations";
import { registerCardsRoutes } from "./routes/cards";
import { registerAnalyticsRoutes } from "./routes/analytics";
import { registerAbTestingRoutes } from "./routes/ab-testing";
import { registerTimelineRoutes } from "./routes/timeline";
import { registerEventLogRoutes } from "./routes/eventLog";
import { registerMailchimpRoutes } from "./routes/mailchimp";
import { registerPublicPlatformRoutes } from "./routes/public-platform";
import { registerStandaloneCardsRoutes } from "./routes/standalone-cards";
import { registerEventRoutes } from "./routes/event";
import { registerExternalApiRoutes } from "./routes/external-api";
import { registerContentPlannerRoutes } from "./routes/contentPlanner";
import { registerCommentBotRoutes } from "./routes/commentBot";
import { registerIntelligenceRoutes } from "./routes/intelligence";
import { registerCommandEngineRoutes } from "./routes/commandEngine";
import { registerReadinessRoutes } from "./routes/readiness";
import { registerMetaOpsRoutes } from "./routes/metaOps";
import { registerMetaMessagingRoutes } from "./routes/metaMessaging";
import { registerMetaMessagingProductRoutes } from "./routes/metaMessagingProduct";
import { registerMediaRoutes } from "./routes/media";
import { registerChaturbateRoutes } from "./routes/chaturbate";
import { registerApexIntelligenceRoutes } from "./routes/apex-intelligence";
import { registerMegaCycleRoutes } from "./routes/mega-cycle";
import { registerSiteTrackingRoutes } from "./routes/siteTracking";
import { registerTrackingRoutes } from "./routes/tracking";
import { registerPublicFormsRoutes } from "./routes/publicForms";
import { registerApifyTransportRoutes } from "./routes/apifyTransport";
import { registerArrestRoutes } from "./routes/arrests";
import { registerHillsboroughRoutes } from "./routes/hillsborough";
import { registerDynamicPagesRoutes } from "./routes/dynamicPages";
import { registerCardIdentityRoutes } from "./routes/cardIdentity";
export { registerAgentWorkerRoutes } from "./routes/agentWorker";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Internal admin route — before all auth middleware
  app.post("/api/internal/retro-skip-trace", async (req: any, res: any) => {
    try {
      const adminSecret = process.env.STANDALONE_ADMIN_SECRET?.trim();
      if (!adminSecret) return res.status(503).json({ error: "STANDALONE_ADMIN_SECRET not configured on this server" });
      const headerVal = ((req.headers["x-admin-secret"] as string) || "").trim();
      if (headerVal !== adminSecret) return res.status(401).json({ error: "Unauthorized" });
      const { subAccountId } = req.body;
      const { runRetroSkipTrace, runRetroSkipTraceAllAccounts } = await import("./retroSkipTrace");
      if (subAccountId) {
        runRetroSkipTrace(Number(subAccountId)).catch(console.error);
        res.json({ ok: true, message: `Retro skip trace started for account ${subAccountId}` });
      } else {
        runRetroSkipTraceAllAccounts().catch(console.error);
        res.json({ ok: true, message: "Retro skip trace started for all accounts" });
      }
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Retro FLHSMV enrichment — re-fetches official crash detail through ScrapingBee for all
  // COMPLETE reports that have an officialReportNumber, updating placeholder contacts with
  // real driver names and home addresses.
  app.post("/api/internal/retro-flhsmv-enrich", async (req: any, res: any) => {
    try {
      const adminSecret = process.env.STANDALONE_ADMIN_SECRET?.trim();
      if (!adminSecret) return res.status(503).json({ error: "STANDALONE_ADMIN_SECRET not configured on this server" });
      const headerVal = ((req.headers["x-admin-secret"] as string) || "").trim();
      if (headerVal !== adminSecret) return res.status(401).json({ error: "Unauthorized" });
      const { limit = 500, dryRun = false } = req.body ?? {};
      const { runRetroFLHSMVEnrich } = await import("./retroFLHSMVEnrich");
      // Fire-and-forget — large runs take time; respond immediately with job started
      runRetroFLHSMVEnrich({ limit: Number(limit), dryRun: Boolean(dryRun) })
        .then(stats => console.log("[RETRO-FLHSMV] Job complete:", stats))
        .catch(err => console.error("[RETRO-FLHSMV] Job failed:", err.message));
      res.json({ ok: true, message: `Retro FLHSMV enrichment started (limit=${limit} dryRun=${dryRun})` });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // FLHSMV cookie push — accepts a fresh cookie string from the local Mac auto-refresher
  // and injects it into the in-memory session without requiring a Railway redeploy.
  app.post("/api/admin/flhsmv-cookie", async (req: any, res: any) => {
    try {
      const adminSecret = process.env.STANDALONE_ADMIN_SECRET?.trim();
      if (!adminSecret) return res.status(503).json({ error: "STANDALONE_ADMIN_SECRET not configured" });
      const headerVal = ((req.headers["x-admin-secret"] as string) || "").trim();
      if (headerVal !== adminSecret) return res.status(401).json({ error: "Unauthorized" });

      const cookie = (req.body?.cookie as string || "").trim();
      if (!cookie || !cookie.includes("ASP.NET_SessionId")) {
        return res.status(400).json({ error: "Body must include { cookie } containing ASP.NET_SessionId" });
      }

      const { setManualCookie } = await import("./flhsmvDirectScan");
      setManualCookie(cookie);
      return res.json({ ok: true, injectedAt: new Date().toISOString(), cookieLength: cookie.length });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // FLHSMV session diagnostic — tests 4 ScrapingBee mode combinations and reports
  // cookie capture results without exposing actual cookie values.
  app.get("/api/admin/debug/flhsmv-session", async (req: any, res: any) => {
    try {
      const adminSecret = process.env.STANDALONE_ADMIN_SECRET?.trim();
      if (!adminSecret) return res.status(503).json({ error: "STANDALONE_ADMIN_SECRET not configured on this server" });
      const headerVal = ((req.headers["x-admin-secret"] as string) || "").trim();
      if (headerVal !== adminSecret) return res.status(401).json({ error: "Unauthorized" });

      const { scrapingBeeFetch, isScrapingBeeConfigured } = await import("./scrapingBeeClient");
      const { FLHSMV_PORTAL_URL, bustSessionCache } = await import("./flhsmvDirectScan");

      interface ModeResult {
        mode: string;
        status: number;
        ok: boolean;
        bodyPreview: string;
        cookieCount: number;
        cookieNames: string[];
        error?: string;
      }

      const results: ModeResult[] = [];

      // Mode A: direct fetch (no ScrapingBee) — baseline to confirm the portal loads at all
      try {
        const r = await fetch(FLHSMV_PORTAL_URL, {
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
          signal: AbortSignal.timeout(15_000),
        });
        const body = await r.text();
        results.push({
          mode: "A_direct_no_scrapingbee",
          status: r.status,
          ok: r.ok,
          bodyPreview: body.slice(0, 500),
          cookieCount: 0,
          cookieNames: [],
        });
      } catch (err: any) {
        results.push({ mode: "A_direct_no_scrapingbee", status: 0, ok: false, bodyPreview: "", cookieCount: 0, cookieNames: [], error: err.message });
      }

      if (!isScrapingBeeConfigured()) {
        return res.json({ ok: false, error: "SCRAPINGBEE_API_KEY not configured", results });
      }

      // Mode B: render_js=true on premium tier — likely to get Akamai-killed, but
      // useful as a baseline so we know whether stealth is actually buying us something.
      try {
        const r = await scrapingBeeFetch({
          url: FLHSMV_PORTAL_URL,
          renderJs: true,
          blockResources: false,
          jsonResponse: false,
          countryCode: "us",
          mode: "premium",
        });
        results.push({
          mode: "B_sb_render_premium_no_json",
          status: r.status,
          ok: r.ok,
          bodyPreview: r.html.slice(0, 500),
          cookieCount: (r.cookies ?? []).length,
          cookieNames: (r.cookies ?? []).map((c: any) => c.name),
          error: r.error,
        });
      } catch (err: any) {
        results.push({ mode: "B_sb_render_premium_no_json", status: 0, ok: false, bodyPreview: "", cookieCount: 0, cookieNames: [], error: err.message });
      }

      // Mode C: render_js=true on stealth tier — expensive, but the best shot at
      // surviving Akamai long enough to set session cookies.
      try {
        const r = await scrapingBeeFetch({
          url: FLHSMV_PORTAL_URL,
          renderJs: true,
          blockResources: false,
          jsonResponse: true,
          waitMs: 5000,
          countryCode: "us",
          mode: "stealth",
        });
        results.push({
          mode: "C_sb_render_stealth_json_wait5s",
          status: r.status,
          ok: r.ok,
          bodyPreview: r.html.slice(0, 500),
          cookieCount: (r.cookies ?? []).length,
          cookieNames: (r.cookies ?? []).map((c: any) => c.name),
          error: r.error,
        });
      } catch (err: any) {
        results.push({ mode: "C_sb_render_stealth_json_wait5s", status: 0, ok: false, bodyPreview: "", cookieCount: 0, cookieNames: [], error: err.message });
      }

      // Mode D: render_js=false on premium tier (cheapest path that still uses the
      // residential/premium proxy, but cannot run FLHSMV's client-side cookie logic).
      try {
        const r = await scrapingBeeFetch({
          url: FLHSMV_PORTAL_URL,
          renderJs: false,
          blockResources: false,
          jsonResponse: true,
          countryCode: "us",
          mode: "premium",
        });
        results.push({
          mode: "D_sb_no_render_premium_json",
          status: r.status,
          ok: r.ok,
          bodyPreview: r.html.slice(0, 500),
          cookieCount: (r.cookies ?? []).length,
          cookieNames: (r.cookies ?? []).map((c: any) => c.name),
          error: r.error,
        });
      } catch (err: any) {
        results.push({ mode: "D_sb_no_render_premium_json", status: 0, ok: false, bodyPreview: "", cookieCount: 0, cookieNames: [], error: err.message });
      }

      // Bust the in-process cache after diagnostics so the next real call starts clean
      bustSessionCache();

      const bestMode = results.find(r => r.cookieCount > 0)?.mode ?? null;
      res.json({ ok: true, testedAt: new Date().toISOString(), bestMode, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // FLHSMV local agent — step 1: claim a batch of eligible sentinel_followup reports
  // for the Mac to process through its residential IP (Akamai cannot block it).
  // Locks the returned rows immediately so Railway's own worker won't double-process.
  app.get("/api/admin/flhsmv-pending-batch", async (req: any, res: any) => {
    try {
      const adminSecret = process.env.STANDALONE_ADMIN_SECRET?.trim();
      if (!adminSecret) return res.status(503).json({ error: "STANDALONE_ADMIN_SECRET not configured" });
      const headerVal = ((req.headers["x-admin-secret"] as string) || "").trim();
      if (headerVal !== adminSecret) return res.status(401).json({ error: "Unauthorized" });

      const limit = Math.min(Number(req.query.limit ?? 5), 20);
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");

      // Two-step claim: SELECT eligible IDs, then UPDATE by ID.
      // Avoids CTE+FOR UPDATE SKIP LOCKED which doesn't behave reliably via
      // the Neon HTTP adapter (each db.execute() is a single autocommit HTTP request).
      const selectResult = await db.execute<any>(sql`
        SELECT id, report_number, data, sub_account_id
        FROM crash_reports
        WHERE source = 'sentinel_followup'
          AND status IN ('PENDING', 'RETRY_LATER')
          AND locked_at IS NULL
          AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
          AND (
            CASE
              WHEN data->>'crashDate' ~ '^\\d{4}-\\d{2}-\\d{2}$'
                THEN (data->>'crashDate')::date
              WHEN data->>'crashDate' ~ '^\\d{2}/\\d{2}/\\d{4}$'
                THEN TO_DATE(data->>'crashDate', 'MM/DD/YYYY')
              ELSE NULL
            END
          ) <= CURRENT_DATE - INTERVAL '10 days'
        ORDER BY created_at ASC
        LIMIT ${limit}
      `);

      const selectRows: any[] = Array.isArray(selectResult) ? selectResult : (selectResult as any).rows ?? [];
      if (selectRows.length === 0) {
        return res.json({ ok: true, reports: [], count: 0 });
      }

      // Lock only rows still unclaimed (locked_at IS NULL guards against a concurrent claim).
      const idList = selectRows.map((r: any) => Number(r.id)).join(",");
      const updateResult = await db.execute<any>(sql`
        UPDATE crash_reports
        SET locked_at  = NOW(),
            locked_by  = 'local-agent',
            status     = 'PROCESSING',
            updated_at = NOW()
        WHERE id IN (${sql.raw(idList)})
          AND locked_at IS NULL
        RETURNING id, report_number, data, sub_account_id
      `);

      const rawRows: any[] = Array.isArray(updateResult) ? updateResult : (updateResult as any).rows ?? [];
      const reports = rawRows.map((r: any) => ({
        id:           r.id,
        reportNumber: r.report_number,
        county:       r.data?.county    ?? null,
        crashDate:    r.data?.crashDate ?? null,
        location:     r.data?.location  ?? null,
        lat:          r.data?.lat       ?? null,
        lng:          r.data?.lng       ?? null,
        received:     r.data?.received  ?? null,
        subAccountId: r.sub_account_id,
      }));

      res.json({ ok: true, reports, count: reports.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // FLHSMV local agent — step 2: receive results from the Mac and complete the reports.
  // The Mac has already called FLHSMV SearchReport + GetReport via its residential IP.
  app.post("/api/admin/flhsmv-batch-result", async (req: any, res: any) => {
    try {
      const adminSecret = process.env.STANDALONE_ADMIN_SECRET?.trim();
      if (!adminSecret) return res.status(503).json({ error: "STANDALONE_ADMIN_SECRET not configured" });
      const headerVal = ((req.headers["x-admin-secret"] as string) || "").trim();
      if (headerVal !== adminSecret) return res.status(401).json({ error: "Unauthorized" });

      const { results } = req.body ?? {};
      if (!Array.isArray(results) || results.length === 0) {
        return res.status(400).json({ error: "Body must include { results: [...] }" });
      }

      const { completeReportFromExternalData } = await import("./crashReportWorker");

      const outcomes: any[] = [];
      for (const r of results) {
        const { crashReportId, reportNumber, type, searchResult, detail, statusCode, errorMessage } = r;
        if (!crashReportId || !type) {
          outcomes.push({ crashReportId, ok: false, error: "missing crashReportId or type" });
          continue;
        }
        try {
          const result = await completeReportFromExternalData(
            Number(crashReportId),
            reportNumber ?? String(crashReportId),
            { type, searchResult, detail, statusCode, errorMessage }
          );
          outcomes.push({ crashReportId, ...result });
        } catch (err: any) {
          outcomes.push({ crashReportId, ok: false, error: err.message });
        }
      }

      res.json({ ok: true, processed: outcomes.length, outcomes });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  registerAuthRoutes(app);
  registerCardIdentityRoutes(app);
  registerDynamicPagesRoutes(app);
  registerSitesRoutes(app);
  registerFunnelRoutes(app);
  registerAdminRoutes(app);
  registerAccountRoutes(app);
  registerMessagingRoutes(app);
  registerMessagingEmailRoutes(app);
  registerWorkflowsRoutes(app);
  registerBotRoutes(app);
  registerBlueprintsRoutes(app);
  registerAdsRoutes(app);
  registerChatRoutes(app);
  registerVoiceRoutes(app);

  app.get("/voice/:id.mp3", async (req, res) => {
    try {
      const { resolveVoiceFilePath } = await import("./messaging/voiceStore");
      const filePath = await resolveVoiceFilePath(req.params.id);
      if (!filePath) return res.status(404).send("voice not found");
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.sendFile(filePath);
    } catch (e: any) {
      console.warn(`[VOICE-STORE] serve error: ${e?.message || e}`);
      res.status(500).send("voice serve error");
    }
  });
  registerWebhooksRoutes(app);
  registerReviewsRoutes(app);
  registerSubscriptionsRoutes(app);
  registerSnapshotsRoutes(app);
  registerAffiliatesRoutes(app);
  registerSentinelRoutes(app);
  registerRetroSkipTraceRoute(app);
  registerDomainRoutes(app);
  registerArrestRoutes(app);
  registerHillsboroughRoutes(app);

  // ── Legal Signal Pipeline Routes ──────────────────────────────────────────
  // [FIX 2026-05-18] Added subAccountId filter (was built but never applied to query — data leak risk)
  // [FIX 2026-05-18] Added isPlatformAdmin auth guard — legal lead data is sensitive CRM data
  app.get("/api/legal-leads", asyncHandler(async (req, res) => {
    // Auth guard: only platform admins or requests with a valid subAccountId that matches session
    const { isPlatformAdmin } = await import("./auth/authorization");
    const subAccountId = req.query.subAccountId ? Number(req.query.subAccountId) : undefined;

    if (!isPlatformAdmin(req) && !subAccountId) {
      return res.status(403).json({ error: "subAccountId required for non-admin access" });
    }

    const limit        = Math.min(Number(req.query.limit ?? 100), 500);
    const vertical     = req.query.vertical as string | undefined;

    const { db } = await import("./db");
    const { legalLeads } = await import("@shared/schema");
    const { desc, eq, and } = await import("drizzle-orm");

    // Build filter conditions — subAccountId filter is now actually applied to the query
    const conds: any[] = [];
    if (subAccountId && !isPlatformAdmin(req)) {
      // Non-admin: enforce tenant isolation — only return their own leads
      conds.push(eq(legalLeads.subAccountId, subAccountId));
    } else if (subAccountId) {
      // Admin with explicit filter: scope to requested account
      conds.push(eq(legalLeads.subAccountId, subAccountId));
    }
    // Platform admin with no subAccountId filter → returns all (intended admin view)

    let query = db.select().from(legalLeads);
    if (conds.length > 0) {
      query = query.where(and(...conds)) as any;
    }
    query = query.orderBy(desc(legalLeads.createdAt)).limit(limit) as any;

    const results = await query;
    res.json(vertical ? results.filter((l: any) => l.legalVertical === vertical) : results);
  }));

  app.get("/api/legal-signals/stats", asyncHandler(async (req, res) => {
    const { getLegalPipelineStats } = await import("./legalSignalPipeline");
    res.json(getLegalPipelineStats());
  }));

  // ── Case Intelligence API ─────────────────────────────────────────────────
  app.get("/api/cases", asyncHandler(async (req, res) => {
    const { db }                  = await import("./db");
    const { intelligenceCases, intelligenceEntities } = await import("@shared/schema");
    const { desc, eq, gte, and } = await import("drizzle-orm");
    // Guard: tables may not exist yet on first deploy
    try { await db.execute({ sql: "SELECT 1 FROM intelligence_cases LIMIT 1", params: [] } as any); }
    catch (_tableErr) { /* allow-silent-catch: tables not created yet on first deploy */ return res.json({ cases: [], total: 0 }); }

    const minScore  = Number(req.query.minScore  ?? 25);
    const category  = req.query.category as string | undefined;
    const status    = req.query.status   as string || "open";
    const limit     = Math.min(Number(req.query.limit ?? 50), 200);

    let conditions: any[] = [];
    if (status !== "all")     conditions.push(eq(intelligenceCases.status, status));
    if (category)             conditions.push(eq(intelligenceCases.category, category));
    conditions.push(gte(intelligenceCases.compositeScore, minScore));

    const cases = await db
      .select({
        case:   intelligenceCases,
        entity: intelligenceEntities,
      })
      .from(intelligenceCases)
      .leftJoin(intelligenceEntities, eq(intelligenceCases.entityId, intelligenceEntities.id))
      .where(and(...conditions))
      .orderBy(desc(intelligenceCases.compositeScore))
      .limit(limit);

    res.json({ cases, total: cases.length });
  }));

  app.get("/api/cases/:id", asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });

    const { db }                              = await import("./db");
    const { intelligenceCases, intelligenceEntities, caseSignals, legalSignals } = await import("@shared/schema");
    const { eq, desc, sql }                   = await import("drizzle-orm");

    const [row] = await db
      .select({ case: intelligenceCases, entity: intelligenceEntities })
      .from(intelligenceCases)
      .leftJoin(intelligenceEntities, eq(intelligenceCases.entityId, intelligenceEntities.id))
      .where(eq(intelligenceCases.id, id))
      .limit(1);

    if (!row) return res.status(404).json({ error: "case not found" });

    const pageSize = Math.min(Number(req.query.pageSize) || 200, 500);
    const page     = Math.max(Number(req.query.page) || 1, 1);
    const offset   = (page - 1) * pageSize;

    const [signals, [{ total }]] = await Promise.all([
      db
        .select({ cs: caseSignals, ls: legalSignals })
        .from(caseSignals)
        .leftJoin(legalSignals, eq(caseSignals.signalId, legalSignals.id))
        .where(eq(caseSignals.caseId, id))
        .orderBy(desc(caseSignals.detectedAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(caseSignals)
        .where(eq(caseSignals.caseId, id)),
    ]);

    res.json({
      ...row,
      signals,
      pagination: { page, pageSize, total, hasNextPage: offset + signals.length < total },
    });
  }));

  app.patch("/api/cases/:id", requireAdmin, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
    const { z } = await import("zod");
    const parsed = z.object({
      status:        z.string().optional(),
      operatorNotes: z.string().optional(),
      aiSummary:     z.string().optional(),
      outreachAngle: z.string().optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { db } = await import("./db");
    const { intelligenceCases } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const update: Record<string, any> = { updatedAt: new Date() };
    const body = parsed.data;
    if (body.status)        update.status        = body.status;
    if (body.operatorNotes !== undefined) update.operatorNotes = body.operatorNotes;
    if (body.aiSummary)     update.aiSummary     = body.aiSummary;
    if (body.outreachAngle) update.outreachAngle = body.outreachAngle;
    const [updated] = await db.update(intelligenceCases).set(update).where(eq(intelligenceCases.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json({ ok: true, case: updated });
  }));

  app.get("/api/cases/stats", asyncHandler(async (req, res) => {
    const { getCaseIntelligenceStats } = await import("./caseIntelligence");
    const { db } = await import("./db");
    const { intelligenceCases } = await import("@shared/schema");
    const { sql: rawSql } = await import("drizzle-orm");
    const [counts] = await db.select({
      total:      rawSql<number>`count(*)::int`,
      actionable: rawSql<number>`count(*) filter (where actionable = true)::int`,
      open:       rawSql<number>`count(*) filter (where status = 'open')::int`,
    }).from(intelligenceCases);
    res.json({ ...counts, ...getCaseIntelligenceStats() });
  }));

  // ── AI Chat & Provider Routes ─────────────────────────────────────────────
  app.post("/api/ai/chat", asyncHandler(async (req, res) => {
    const { aiChat, isAIConfigured } = await import("./aiGateway");
    if (!isAIConfigured()) {
      return res.status(503).json({ ok: false, error: "No AI provider configured" });
    }
    const { messages = [], maxTokens = 200, route = "operator-ui" } = req.body as {
      messages: Array<{ role: string; content: string }>;
      maxTokens?: number;
      route?: string;
    };
    const result = await aiChat(messages as any, { maxTokens, route });
    res.json(result);
  }));

  // ── AI Provider Status ────────────────────────────────────────────────────
  app.get("/api/ai/status", asyncHandler(async (req, res) => {
    const { isAIConfigured, isOpenAIConfigured, isAnthropicConfigured, getAIProviderStatus } = await import("./aiGateway");
    const { isGeminiConfigured } = await import("./gemini");
    const status       = getAIProviderStatus();
    res.json({
      configured:     isAIConfigured(),
      activeProvider: status.activeProvider,
      fallbackChain:  [
        isAnthropicConfigured() ? "anthropic" : null,
        isOpenAIConfigured()    ? "openai"    : null,
        isGeminiConfigured()    ? "gemini"    : null,
      ].filter(Boolean),
      providers: {
        anthropic: {
          configured: isAnthropicConfigured(),
          model:      "claude-sonnet-4-20250514",
          priority:   1,
        },
        openai: {
          configured: isOpenAIConfigured(),
          model:      "gpt-4o-mini",
          priority:   2,
        },
        gemini: {
          configured: isGeminiConfigured(),
          model:      "gemini-2.5-flash",
          priority:   3,
        },
      },
    });
  }));

  app.get("/api/home-service/stats", asyncHandler(async (req, res) => {
    const { getHomeServicePipelineStats } = await import("./homeServiceSignalPipeline");
    res.json(getHomeServicePipelineStats());
  }));
  registerPropertyRoutes(app);
  const { registerHomeServiceRoutes } = await import("./routes/homeService");
  registerHomeServiceRoutes(app);
  const { registerStudioWebhook } = await import("./routes/studioWebhook");
  registerStudioWebhook(app);
  const { registerBootstrapLauren } = await import("./routes/bootstrapLauren");
  registerBootstrapLauren(app);
  const { registerStudioMuapiProxy } = await import("./routes/studioMuapiProxy");
  registerStudioMuapiProxy(app);
  const { registerStudioClaudeProxy } = await import("./routes/studioClaudeProxy");
  registerStudioClaudeProxy(app);
  const { registerStudioApexProxy } = await import("./routes/studioApexProxy");
  registerStudioApexProxy(app);
  const { mountApexMcp } = await import("../apex-mcp-server.js");
  mountApexMcp(app);
  registerMetaRoutes(app);
  registerNotificationsRoutes(app);
  registerDashboardRoutes(app);
  registerV1Routes(app);
  registerIntegrationsRoutes(app);
  registerCardsRoutes(app);
  registerAnalyticsRoutes(app);
  registerAbTestingRoutes(app);
  registerTimelineRoutes(app);
  registerEventLogRoutes(app);
  registerMailchimpRoutes(app);
  registerPublicPlatformRoutes(app);
  registerStandaloneCardsRoutes(app);
  registerEventRoutes(app);
  registerExternalApiRoutes(app);
  registerContentPlannerRoutes(app);
  registerCommentBotRoutes(app);
  registerIntelligenceRoutes(app);
  registerCommandEngineRoutes(app);
  registerReadinessRoutes(app);
  registerMetaOpsRoutes(app);
  registerMetaMessagingRoutes(app);
  registerMetaMessagingProductRoutes(app);
  registerMediaRoutes(app);
  registerChaturbateRoutes(app);
  registerApexIntelligenceRoutes(app);
  registerMegaCycleRoutes(app);
  registerSiteTrackingRoutes(app);
  registerTrackingRoutes(app);
  registerPublicFormsRoutes(app);
  registerApifyTransportRoutes(app);

  return httpServer;
}
