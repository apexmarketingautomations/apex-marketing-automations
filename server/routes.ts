import type { Express } from "express";
import { createServer, type Server } from "http";

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
  registerDomainRoutes(app);

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

  return httpServer;
}