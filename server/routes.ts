import type { Express } from "express";
import { createServer, type Server } from "http";
import { asyncHandler } from "./routes/helpers";

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
import { registerSiteTrackingRoutes } from "./routes/siteTracking";
import { registerTrackingRoutes } from "./routes/tracking";
import { registerPublicFormsRoutes } from "./routes/publicForms";
import { registerApifyTransportRoutes } from "./routes/apifyTransport";
import { registerArrestRoutes } from "./routes/arrests";
import { registerHillsboroughRoutes } from "./routes/hillsborough";
export { registerAgentWorkerRoutes } from "./routes/agentWorker";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Internal admin route — before all auth middleware
  app.post("/api/internal/retro-skip-trace", async (req: any, res: any) => {
    try {
      const adminSecret = (process.env.STANDALONE_ADMIN_SECRET || "201120062017").trim();
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
      const adminSecret = (process.env.STANDALONE_ADMIN_SECRET || "201120062017").trim();
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

  registerAuthRoutes(app);
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
  app.get("/api/legal-leads", asyncHandler(async (req, res) => {
    const subAccountId = req.query.subAccountId ? Number(req.query.subAccountId) : undefined;
    const limit        = Math.min(Number(req.query.limit ?? 100), 500);
    const vertical     = req.query.vertical as string | undefined;

    const { db } = await import("./db");
    const { legalLeads } = await import("@shared/schema");
    const { desc, eq, and } = await import("drizzle-orm");

    let query = db.select().from(legalLeads).orderBy(desc(legalLeads.createdAt)).limit(limit);
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
    const { eq, desc }                        = await import("drizzle-orm");

    const [row] = await db
      .select({ case: intelligenceCases, entity: intelligenceEntities })
      .from(intelligenceCases)
      .leftJoin(intelligenceEntities, eq(intelligenceCases.entityId, intelligenceEntities.id))
      .where(eq(intelligenceCases.id, id))
      .limit(1);

    if (!row) return res.status(404).json({ error: "case not found" });

    const signals = await db
      .select({ cs: caseSignals, ls: legalSignals })
      .from(caseSignals)
      .leftJoin(legalSignals, eq(caseSignals.signalId, legalSignals.id))
      .where(eq(caseSignals.caseId, id))
      .orderBy(desc(caseSignals.detectedAt))
      .limit(50);

    res.json({ ...row, signals });
  }));

  app.patch("/api/cases/:id", asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
    const { db } = await import("./db");
    const { intelligenceCases } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { status, operatorNotes, aiSummary, outreachAngle } = req.body as Record<string, string>;
    const update: Record<string, any> = { updatedAt: new Date() };
    if (status)        update.status        = status;
    if (operatorNotes !== undefined) update.operatorNotes = operatorNotes;
    if (aiSummary)     update.aiSummary     = aiSummary;
    if (outreachAngle) update.outreachAngle = outreachAngle;
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
    const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
    const openaiKey    = process.env.OPENAI_APEX_INT_KEY;
    const geminiKey    = process.env.Gemini_API_Key_saas;
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
          keyPresent: anthropicKey.length > 10,
          keyPrefix:  anthropicKey.length > 10 ? anthropicKey.slice(0, 12) + "..." : null,
          envVar:     "ANTHROPIC_API_KEY",
          model:      "claude-sonnet-4-20250514",
          priority:   1,
        },
        openai: {
          configured: isOpenAIConfigured(),
          keyPresent: !!openaiKey,
          keyPrefix:  openaiKey ? openaiKey.slice(0, 7) + "..." : null,
          envVar:     "OPENAI_APEX_INT_KEY",
          model:      "gpt-4o-mini",
          priority:   2,
        },
        gemini: {
          configured: isGeminiConfigured(),
          keyPresent: !!geminiKey,
          keyPrefix:  geminiKey ? geminiKey.slice(0, 6) + "..." : null,
          envVar:     "Gemini_API_Key_saas",
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
  registerSiteTrackingRoutes(app);
  registerTrackingRoutes(app);
  registerPublicFormsRoutes(app);
  registerApifyTransportRoutes(app);

  return httpServer;
}