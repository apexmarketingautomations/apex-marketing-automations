import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertMessageSchema, insertWorkflowSchema, insertSubAccountSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ---- Sub-Accounts ----
  app.get("/api/accounts", async (_req, res) => {
    const accounts = await storage.getSubAccounts();
    res.json(accounts);
  });

  app.post("/api/accounts", async (req, res) => {
    const parsed = insertSubAccountSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const account = await storage.createSubAccount(parsed.data);
    res.status(201).json(account);
  });

  // ---- Messages ----
  app.get("/api/messages/:subAccountId", async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (isNaN(subAccountId)) return res.status(400).json({ error: "Invalid subAccountId" });
    const msgs = await storage.getMessages(subAccountId);
    res.json(msgs);
  });

  app.post("/api/messages", async (req, res) => {
    const parsed = insertMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const msg = await storage.createMessage(parsed.data);
    res.status(201).json(msg);
  });

  // ---- Workflows ----
  app.get("/api/workflows", async (_req, res) => {
    const wfs = await storage.getWorkflows();
    res.json(wfs);
  });

  app.get("/api/workflows/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const wf = await storage.getWorkflow(id);
    if (!wf) return res.status(404).json({ error: "Not found" });
    res.json(wf);
  });

  app.post("/api/workflows", async (req, res) => {
    const parsed = insertWorkflowSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const wf = await storage.createWorkflow(parsed.data);
    res.status(201).json(wf);
  });

  app.patch("/api/workflows/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const wf = await storage.updateWorkflow(id, req.body);
    if (!wf) return res.status(404).json({ error: "Not found" });
    res.json(wf);
  });

  // ---- Bot Training Jobs ----
  app.post("/api/bots/train", async (req, res) => {
    const { url, persona } = req.body;
    if (!url || !persona) return res.status(400).json({ error: "url and persona are required" });

    const job = await storage.createTrainingJob({ url, persona });

    simulateTraining(job.id);

    res.status(201).json({ jobId: job.id });
  });

  app.get("/api/jobs/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const job = await storage.getTrainingJob(id);
    if (!job) return res.status(404).json({ error: "Not found" });
    res.json({
      state: job.state,
      progress: job.progress,
      logs: job.logs,
    });
  });

  // ---- Blueprints / Onboarding ----
  app.get("/api/blueprints", async (_req, res) => {
    const bps = await storage.getBlueprints();
    res.json(bps);
  });

  app.get("/api/blueprints/:industryId", async (req, res) => {
    const bp = await storage.getBlueprintByIndustryId(req.params.industryId);
    if (!bp) return res.status(404).json({ error: "Blueprint not found" });
    res.json(bp);
  });

  app.post("/api/onboarding/:industryId", async (req, res) => {
    const bp = await storage.getBlueprintByIndustryId(req.params.industryId);
    if (!bp) return res.status(404).json({ error: "Blueprint not found for this industry" });

    const account = await storage.createSubAccount({
      name: `${bp.title} Account`,
      twilioNumber: `+1555${Math.floor(1000 + Math.random() * 9000)}`,
    });

    res.status(201).json({ account, blueprint: bp });
  });

  return httpServer;
}

function simulateTraining(jobId: number) {
  const steps = [
    { delay: 1000, log: "Starting Scraper...", progress: 10 },
    { delay: 2500, log: "Successfully scraped 45,201 characters", progress: 30 },
    { delay: 4000, log: "Split into 12 knowledge chunks", progress: 50 },
    { delay: 5500, log: "Generating OpenAI Embeddings...", progress: 70 },
    { delay: 7000, log: "Saving to Postgres (PGVector)...", progress: 85 },
    { delay: 8500, log: "Training Complete. Bot is ready.", progress: 100 },
  ];

  const allLogs: string[] = [];

  steps.forEach(({ delay, log, progress }) => {
    setTimeout(async () => {
      allLogs.push(log);
      await storage.updateTrainingJob(jobId, {
        logs: [...allLogs],
        progress,
        state: progress >= 100 ? "completed" : "processing",
      });
    }, delay);
  });
}
