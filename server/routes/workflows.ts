import type { Express, Request, Response } from "express";
import { insertWorkflowSchema } from "@shared/schema";
import { storage } from "../storage";
import { z } from "zod";
import { aiChat, isAIConfigured } from "../aiGateway";
import { asyncHandler, parseIntParam, getUserId, verifyAccountOwnership, logUsageInternal } from "./helpers";

export function registerWorkflowsRoutes(app: Express) {
  // ---- Workflows ----
  app.get("/api/workflows", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const userId = getUserId(user);
    const adminUserId = process.env.ADMIN_USER_ID;
    const isAdmin = adminUserId && userId === adminUserId;
    const allAccounts = await storage.getSubAccounts();
    const userAccountIds = isAdmin
      ? allAccounts.map((a: any) => a.id)
      : allAccounts.filter((a: any) => a.ownerUserId === userId).map((a: any) => a.id);
    const wfs = await storage.getWorkflows();
    const filtered = isAdmin ? wfs : wfs.filter((w: any) => w.subAccountId && userAccountIds.includes(w.subAccountId));
    res.json(filtered);
  }));

  app.get("/api/workflows/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const wf = await storage.getWorkflow(id);
    if (!wf) return res.status(404).json({ error: "Not found" });
    if (wf.subAccountId && !(await verifyAccountOwnership(req, res, wf.subAccountId))) return;
    res.json(wf);
  }));

  app.post("/api/workflows", asyncHandler(async (req, res) => {
    const parsed = insertWorkflowSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if (parsed.data.subAccountId && !(await verifyAccountOwnership(req, res, parsed.data.subAccountId))) return;
    const wf = await storage.createWorkflow(parsed.data);
    res.status(201).json(wf);
  }));

  const workflowPatchSchema = z.object({
    name: z.string().min(1).optional(),
    trigger: z.string().min(1).optional(),
    steps: z.any().optional(),
  });

  app.patch("/api/workflows/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const existing = await storage.getWorkflow(id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.subAccountId && !(await verifyAccountOwnership(req, res, existing.subAccountId))) return;
    const parsed = workflowPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const wf = await storage.updateWorkflow(id, parsed.data);
    if (!wf) return res.status(404).json({ error: "Not found" });
    res.json(wf);
  }));

  // ---- Workflow Analytics & Self-Optimization ----

  app.get("/api/workflows/:id/analytics", asyncHandler(async (req: Request, res: Response) => {
    const id = parseIntParam(req.params.id, "id");
    const wf = await storage.getWorkflow(id);
    if (!wf) return res.status(404).json({ error: "Not found" });
    if (wf.subAccountId && !(await verifyAccountOwnership(req, res, wf.subAccountId))) return;

    const { getWorkflowFunnelAnalytics, generateAISuggestions } = await import("../operator/workflowAnalytics");
    const analytics = await getWorkflowFunnelAnalytics(id);
    if (!analytics) return res.status(404).json({ error: "Analytics not available" });

    let aiSuggestions: any[] = [];
    if (req.query.includeAi === "true") {
      aiSuggestions = await generateAISuggestions(id);
    }

    res.json({ ...analytics, aiSuggestions });
  }));

  app.post("/api/workflows/:id/step-metrics", asyncHandler(async (req: Request, res: Response) => {
    const id = parseIntParam(req.params.id, "id");
    const wf = await storage.getWorkflow(id);
    if (!wf) return res.status(404).json({ error: "Not found" });
    if (wf.subAccountId && !(await verifyAccountOwnership(req, res, wf.subAccountId))) return;

    const parsed = z.object({
      stepIndex: z.number().min(0),
      stepType: z.string().min(1),
      success: z.boolean(),
      durationMs: z.number().min(0).optional().default(0),
      responseReceived: z.boolean().optional().default(false),
    }).safeParse(req.body);

    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { recordStepExecution } = await import("../operator/workflowAnalytics");
    await recordStepExecution(id, parsed.data.stepIndex, parsed.data.stepType, parsed.data.success, parsed.data.durationMs, parsed.data.responseReceived);

    res.json({ recorded: true });
  }));

  app.get("/api/workflows/:id/optimization-log", asyncHandler(async (req: Request, res: Response) => {
    const id = parseIntParam(req.params.id, "id");
    const wf = await storage.getWorkflow(id);
    if (!wf) return res.status(404).json({ error: "Not found" });
    if (wf.subAccountId && !(await verifyAccountOwnership(req, res, wf.subAccountId))) return;

    const logs = await storage.getWorkflowOptimizationLogs(id);
    res.json(logs);
  }));

  app.post("/api/workflows/:id/auto-optimize", asyncHandler(async (req: Request, res: Response) => {
    const id = parseIntParam(req.params.id, "id");
    const wf = await storage.getWorkflow(id);
    if (!wf) return res.status(404).json({ error: "Not found" });
    if (wf.subAccountId && !(await verifyAccountOwnership(req, res, wf.subAccountId))) return;

    const { applyAutoOptimization } = await import("../operator/workflowAnalytics");
    const changes = await applyAutoOptimization(id);

    res.json({
      optimized: changes.length > 0,
      changesApplied: changes.length,
      changes,
    });
  }));

  app.post("/api/workflows/:id/optimization-log/:logId/revert", asyncHandler(async (req: Request, res: Response) => {
    const workflowId = parseIntParam(req.params.id, "id");
    const logId = parseIntParam(req.params.logId, "logId");
    const wf = await storage.getWorkflow(workflowId);
    if (!wf) return res.status(404).json({ error: "Not found" });
    if (wf.subAccountId && !(await verifyAccountOwnership(req, res, wf.subAccountId))) return;

    const logs = await storage.getWorkflowOptimizationLogs(workflowId);
    const targetLog = logs.find(l => l.id === logId);
    if (!targetLog) return res.status(404).json({ error: "Optimization log not found" });
    if (targetLog.reverted) return res.status(400).json({ error: "Already reverted" });

    if (targetLog.changeType === 'timing_adjustment' && targetLog.previousValue && targetLog.stepIndex !== null) {
      const steps = Array.isArray(wf.steps) ? [...(wf.steps as any[])] : [];
      if (steps[targetLog.stepIndex]) {
        steps[targetLog.stepIndex].params = { ...steps[targetLog.stepIndex].params, ...(targetLog.previousValue as any) };
        await storage.updateWorkflow(workflowId, { steps });
      }
    }

    const reverted = await storage.revertOptimization(logId);
    res.json({ reverted: true, log: reverted });
  }));

  // ---- Workflow AI Generation ----
  const WORKFLOW_AI_SYSTEM_PROMPT = `You are a workflow automation architect. Given a plain-English description, generate a structured workflow.

  Return a JSON object with this structure:
  {
  "name": "<short workflow name>",
  "trigger": "<one of: manual_trigger, facebook_form_submit, new_lead, missed_call, appointment_booked, review_received, sms_reply>",
  "steps": [
    { "action_type": "WAIT", "params": { "duration_minutes": <number> } },
    { "action_type": "SMS", "params": { "body": "<message text>" } },
    { "action_type": "CONDITION", "params": { "check": "<condition like has_replied, is_new_lead, rating_above_3>" } },
    { "action_type": "ALERT", "params": { "user_id": "admin" } },
    { "action_type": "CODE", "params": { "language": "javascript", "code": "<code>", "description": "<what the code does>" } }
  ]
  }

  Rules:
  - Generate 3-8 steps based on the complexity of the request
  - Use realistic SMS message copy (personalized, professional)
  - WAIT durations should be practical (1-60 minutes for urgency, hours/days for nurture)
  - CODE steps should contain realistic JavaScript (checking CRM, scoring leads, calling APIs)
  - Conditions should be meaningful business logic
  - Return ONLY valid JSON, no markdown, no code fences`;

  app.post("/api/workflows/generate", asyncHandler(async (req, res) => {
    if (!isAIConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = z.object({ prompt: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    function extractJson(text: string): any {
      const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      try { return JSON.parse(cleaned); } catch {}
      const braceMatch = text.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        try { return JSON.parse(braceMatch[0]); } catch {}
      }
      return null;
    }

    let workflowData: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const wfAiResult = await aiChat([
        { role: "system", content: WORKFLOW_AI_SYSTEM_PROMPT },
        { role: "user", content: attempt === 0
          ? parsed.data.prompt
          : `${parsed.data.prompt}\n\nIMPORTANT: Return ONLY a raw JSON object. No markdown, no explanation, no code fences. Start with { and end with }.`
        },
      ], { temperature: 0.7, maxTokens: 4096, jsonMode: true, route: "workflow-generate" });

      workflowData = extractJson(wfAiResult.text);
      if (workflowData && workflowData.steps && Array.isArray(workflowData.steps)) break;
      workflowData = null;
    }

    if (!workflowData) {
      return res.status(500).json({ error: "AI could not generate a valid workflow. Please try rephrasing your prompt." });
    }

    if (!workflowData.steps || !Array.isArray(workflowData.steps)) {
      return res.status(500).json({ error: "AI returned invalid workflow structure" });
    }

    const reqSubAccountId = req.body.subAccountId ? parseInt(req.body.subAccountId) : null;
    if (reqSubAccountId && !(await verifyAccountOwnership(req, res, reqSubAccountId))) return;
    const wf = await storage.createWorkflow({
      name: workflowData.name || "AI Generated Workflow",
      trigger: workflowData.trigger || "manual_trigger",
      steps: workflowData.steps,
      subAccountId: reqSubAccountId,
    });

    await logUsageInternal(null, "AI_CHAT", 1, "Workflow AI generation");

    res.status(201).json(wf);
  }));
}
