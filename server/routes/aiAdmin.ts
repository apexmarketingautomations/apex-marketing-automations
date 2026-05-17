// @ts-nocheck
/**
 * server/routes/aiAdmin.ts
 *
 * AI Admin Endpoints
 *
 * All endpoints require admin role. These power the AI Command Center dashboard
 * and expose full observability over provider health, budget, audit trail, and policies.
 *
 * Endpoints:
 *   GET  /api/admin/ai/health         — provider health + circuit breaker states
 *   GET  /api/admin/ai/budget         — budget report (spend, caps, utilization)
 *   GET  /api/admin/ai/audit          — audit log (last N entries, filterable)
 *   GET  /api/admin/ai/audit/summary  — aggregated stats for command center
 *   GET  /api/admin/ai/policy         — current execution policy state
 *   POST /api/admin/ai/policy/shutdown — emergency policy shutdown toggle
 *   POST /api/admin/ai/budget/shutdown — emergency budget shutdown toggle
 *   GET  /api/admin/ai/metrics        — process-level AI metrics
 */

import type { Express, Request, Response } from "express";
import { asyncHandler, isUserAdmin } from "./helpers";
import { getAllProviderHealth, getBudgetReport, getProcessMetrics, isEmergencyShutdownActive, setEmergencyShutdown } from "../ai/index";
import { getAuditLog, getAuditSummary } from "../ai/auditTrailService";
import { getPolicyReport, setEmergencyPolicyShutdown } from "../ai/executionPolicyEngine";

export function registerAiAdminRoutes(app: Express): void {

  // ── Provider health ───────────────────────────────────────────────────────

  app.get("/api/admin/ai/health", asyncHandler(async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "Admin access required" });

    const health = getAllProviderHealth();
    const configured: Record<string, boolean> = {
      anthropic: !!(process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY),
      openai:    !!(process.env.OPENAI_API_KEY),
      gemini:    !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY),
    };

    const summary = {
      healthyProviders:     health.filter(h => h.status === "healthy").length,
      degradedProviders:    health.filter(h => h.status === "degraded").length,
      unavailableProviders: health.filter(h => h.status === "unavailable").length,
      circuitOpenProviders: health.filter(h => h.circuitTrippedAt != null).length,
    };

    res.json({
      providers: health,
      configured,
      summary,
      emergencyShutdown: isEmergencyShutdownActive(),
      generatedAt: new Date().toISOString(),
    });
  }));

  // ── Budget ────────────────────────────────────────────────────────────────

  app.get("/api/admin/ai/budget", asyncHandler(async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const report = getBudgetReport();
    res.json({ ...report, emergencyShutdown: isEmergencyShutdownActive() });
  }));

  // ── Audit log ─────────────────────────────────────────────────────────────

  app.get("/api/admin/ai/audit", asyncHandler(async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "Admin access required" });

    const limit       = Math.min(Number(req.query.limit  ?? 100), 500);
    const subAccountId = req.query.subAccountId ? Number(req.query.subAccountId) : undefined;
    const taskType    = req.query.taskType  as string | undefined;
    const provider    = req.query.provider  as any;
    const success     = req.query.success !== undefined ? req.query.success === "true" : undefined;
    const sinceHours  = Number(req.query.sinceHours ?? 24);
    const since       = new Date(Date.now() - sinceHours * 3_600_000);

    const entries = await getAuditLog({ subAccountId, taskType, provider, success, since, limit });
    res.json({ entries, count: entries.length, sinceHours });
  }));

  app.get("/api/admin/ai/audit/summary", asyncHandler(async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const sinceHours = Number(req.query.sinceHours ?? 24);
    const summary = await getAuditSummary(sinceHours);
    res.json(summary);
  }));

  // ── Policy ────────────────────────────────────────────────────────────────

  app.get("/api/admin/ai/policy", asyncHandler(async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    res.json(getPolicyReport());
  }));

  app.post("/api/admin/ai/policy/shutdown", asyncHandler(async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const { active } = req.body as { active?: boolean };
    if (typeof active !== "boolean") {
      return res.status(400).json({ error: "active (boolean) required" });
    }
    setEmergencyPolicyShutdown(active);
    console.warn(`[AI-ADMIN] Policy emergency shutdown set to ${active} by admin`);
    res.json({ ok: true, policyShutdown: active, at: new Date().toISOString() });
  }));

  // ── Budget emergency shutdown ─────────────────────────────────────────────

  app.post("/api/admin/ai/budget/shutdown", asyncHandler(async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const { active } = req.body as { active?: boolean };
    if (typeof active !== "boolean") {
      return res.status(400).json({ error: "active (boolean) required" });
    }
    setEmergencyShutdown(active);
    console.warn(`[AI-ADMIN] Budget emergency shutdown set to ${active} by admin`);
    res.json({ ok: true, budgetShutdown: active, at: new Date().toISOString() });
  }));

  // ── Process metrics ───────────────────────────────────────────────────────

  app.get("/api/admin/ai/metrics", asyncHandler(async (req: Request, res: Response) => {
    if (!isUserAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const metrics = getProcessMetrics();
    res.json({
      ...metrics,
      emergencyBudgetShutdown: isEmergencyShutdownActive(),
      generatedAt: new Date().toISOString(),
    });
  }));

  console.log("[AI-ADMIN] Routes registered (7 endpoints)");
}
