import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { asyncHandler, parseIntParam } from "./helpers";
import { emitUniversalEvent, emitWithTimeline, EVENT_TYPES } from "../intelligence/eventEmitter";

export function registerAbTestingRoutes(app: Express) {
  async function getAbModule() {
    return await import("../ab-testing-engine");
  }

  app.get("/api/ab-experiments", asyncHandler(async (req, res) => {
    const { getExperimentStats } = await getAbModule();
    const subAccountId = req.query.subAccountId ? parseInt(req.query.subAccountId as string) : undefined;
    const experiments = await storage.getAbExperiments(subAccountId);
    const withStats = experiments.map(exp => ({
      ...exp,
      stats: getExperimentStats(exp),
    }));
    res.json(withStats);
  }));

  app.get("/api/ab-experiments/:id", asyncHandler(async (req, res) => {
    const { getExperimentStats } = await getAbModule();
    const id = parseIntParam(req.params.id, "id");
    const experiment = await storage.getAbExperiment(id);
    if (!experiment) return res.status(404).json({ error: "Experiment not found" });
    const events = await storage.getAbEvents(id);
    res.json({
      ...experiment,
      stats: getExperimentStats(experiment),
      recentEvents: events.slice(0, 50),
    });
  }));

  app.post("/api/ab-experiments", asyncHandler(async (req, res) => {
    const { name, description, contentType, contentId, variantA, variantB, trafficSplit, metric, autoPromote, minSampleSize, subAccountId } = req.body;
    if (!name || !contentType || !variantA || !variantB) {
      return res.status(400).json({ error: "name, contentType, variantA, and variantB are required" });
    }
    const experiment = await storage.createAbExperiment({
      name,
      description: description || null,
      contentType,
      contentId: contentId || null,
      variantA,
      variantB,
      trafficSplit: trafficSplit || 50,
      metric: metric || "conversion_rate",
      autoPromote: autoPromote !== false,
      minSampleSize: minSampleSize || 100,
      subAccountId: subAccountId || null,
      status: "running",
      impressionsA: 0,
      impressionsB: 0,
      conversionsA: 0,
      conversionsB: 0,
      winnerVariant: null,
      confidenceLevel: 0,
      completedAt: null,
    });
    emitWithTimeline(
      { eventType: EVENT_TYPES.CAMPAIGN_CREATED, sourceModule: "ab-testing", sourceTable: "ab_experiments", sourceRecordId: String(experiment.id), subAccountId: subAccountId || undefined, metadata: { experimentName: name, contentType, trafficSplit: trafficSplit || 50, metric: metric || "conversion_rate" } },
      "A/B Experiment Started",
      `Experiment "${name}" launched for ${contentType} content`,
      "info"
    );
    res.json(experiment);
  }));

  app.patch("/api/ab-experiments/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const experiment = await storage.getAbExperiment(id);
    if (!experiment) return res.status(404).json({ error: "Experiment not found" });
    const updated = await storage.updateAbExperiment(id, req.body);
    res.json(updated);
  }));

  app.delete("/api/ab-experiments/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const deleted = await storage.deleteAbExperiment(id);
    if (!deleted) return res.status(404).json({ error: "Experiment not found" });
    res.json({ success: true });
  }));

  app.post("/api/ab-experiments/:id/allocate", asyncHandler(async (req, res) => {
    const { allocateVariant, recordImpression } = await getAbModule();
    const id = parseIntParam(req.params.id, "id");
    const experiment = await storage.getAbExperiment(id);
    if (!experiment) return res.status(404).json({ error: "Experiment not found" });
    if (experiment.status !== "running") {
      const winnerVariant = experiment.winnerVariant || "A";
      return res.json({ variant: winnerVariant, experiment });
    }
    const visitorId = req.body.visitorId || req.query.visitorId as string;
    const variant = allocateVariant(experiment.trafficSplit || 50, visitorId);
    const updated = await recordImpression(id, variant, visitorId);
    res.json({ variant, experiment: updated });
  }));

  app.post("/api/ab-experiments/:id/convert", asyncHandler(async (req, res) => {
    const { recordConversion, getExperimentStats } = await getAbModule();
    const id = parseIntParam(req.params.id, "id");
    const { variant, visitorId, metadata } = req.body;
    if (!variant || (variant !== "A" && variant !== "B")) {
      return res.status(400).json({ error: "variant must be 'A' or 'B'" });
    }
    const updated = await recordConversion(id, variant, visitorId, metadata);
    if (!updated) return res.status(404).json({ error: "Experiment not found" });
    emitUniversalEvent({ eventType: EVENT_TYPES.CAMPAIGN_SENT, sourceModule: "ab-testing", sourceTable: "ab_experiments", sourceRecordId: String(id), subAccountId: updated.subAccountId || undefined, metadata: { experimentName: updated.name, variant, visitorId, contentType: updated.contentType, action: "conversion" } });
    res.json({ success: true, experiment: { ...updated, stats: getExperimentStats(updated) } });
  }));

  app.post("/api/ab-experiments/evaluate-all", asyncHandler(async (_req, res) => {
    const { evaluateAllExperiments } = await getAbModule();
    const promoted = await evaluateAllExperiments();
    res.json({ promoted, message: `${promoted} experiment(s) had winners promoted` });
  }));

  app.post("/api/ab-experiments/:id/stop", asyncHandler(async (req, res) => {
    const { getExperimentStats } = await getAbModule();
    const id = parseIntParam(req.params.id, "id");
    const experiment = await storage.getAbExperiment(id);
    if (!experiment) return res.status(404).json({ error: "Experiment not found" });
    const stats = getExperimentStats(experiment);
    const updated = await storage.updateAbExperiment(id, {
      status: "completed",
      completedAt: new Date(),
      winnerVariant: stats.winner,
      confidenceLevel: stats.confidence,
    });
    emitWithTimeline(
      { eventType: EVENT_TYPES.CAMPAIGN_SENT, sourceModule: "ab-testing", sourceTable: "ab_experiments", sourceRecordId: String(id), subAccountId: experiment.subAccountId || undefined, metadata: { experimentName: experiment.name, contentType: experiment.contentType, winnerVariant: stats.winner, confidenceLevel: stats.confidence, action: "stopped" } },
      "A/B Experiment Concluded",
      `Experiment "${experiment.name}" concluded — winner: Variant ${stats.winner || "undetermined"} (${Math.round(stats.confidence || 0)}% confidence)`,
      "info"
    );
    res.json({ ...updated, stats });
  }));
}
