/**
 * Enterprise Admin Routes — Phase 11
 *
 * All routes require super_admin or platform_admin role (enforced via isUserAdmin).
 * Account-scoped routes accept subAccountId param and validate access.
 *
 * GET  /api/enterprise/dashboard              → executive platform snapshot
 * GET  /api/enterprise/dashboard/:id          → single account dashboard
 * GET  /api/enterprise/hierarchy              → full hierarchy tree
 * POST /api/enterprise/hierarchy/node         → upsert hierarchy node
 * GET  /api/enterprise/tenants                → all tenant quota summaries
 * GET  /api/enterprise/tenants/:id/usage      → usage summary for one account
 * POST /api/enterprise/tenants/:id/plan       → change plan tier
 * POST /api/enterprise/tenants/:id/suspend    → suspend / unsuspend account
 * POST /api/enterprise/tenants/:id/flag       → set feature flag
 * GET  /api/enterprise/billing/report         → platform billing report
 * GET  /api/enterprise/billing/:id/estimate   → monthly cost estimate for account
 * GET  /api/enterprise/roi/:id                → ROI snapshot for account
 * POST /api/enterprise/roi/:id/compute        → recompute ROI for account
 * GET  /api/enterprise/audit                  → platform audit feed
 * GET  /api/enterprise/audit/:id              → audit events for account
 * GET  /api/enterprise/roles                  → list RBAC roles
 * POST /api/enterprise/roles/assign           → assign role to user
 * GET  /api/enterprise/white-label            → list white-label configs
 * POST /api/enterprise/white-label            → upsert white-label config
 * GET  /api/enterprise/white-label/validate-domain → DNS domain check
 */

import type { Express, Request, Response } from "express";
import { isUserAdmin } from "./helpers";
import { getExecutiveDashboard, getAccountDashboard } from "../enterprise/executiveDashboardService";
import { getFullHierarchyTree, upsertNode } from "../enterprise/enterpriseHierarchyEngine";
import {
  getUsageSummary,
  setTenantPlan,
  setTenantSuspension,
  setFeatureFlag,
  ensureTenantQuota,
} from "../enterprise/tenantGovernanceService";
import {
  getUsageReport,
  getPlatformUsageReport,
  estimateMonthlyCost,
} from "../enterprise/billingMeteringEngine";
import {
  getLatestRoiSnapshot,
  computeCurrentMonthRoi,
} from "../enterprise/roiAnalyticsEngine";
import {
  queryAuditEvents,
  getPlatformAuditFeed,
} from "../enterprise/operationalAuditService";
import {
  listRoles,
  assignRole,
} from "../enterprise/rbacPermissionSystem";
import {
  listWhiteLabelConfigs,
  upsertWhiteLabelConfig,
  validateCustomDomain,
} from "../enterprise/whiteLabelCoordinator";
import { db } from "../db";
import { enterpriseTenantQuotas } from "@shared/schema";

export function registerEnterpriseAdminRoutes(app: Express): void {

  // ── Platform executive dashboard ──────────────────────────────────────────

  app.get("/api/enterprise/dashboard", isUserAdmin, async (_req: Request, res: Response) => {
    try {
      const snap = await getExecutiveDashboard();
      res.json(snap);
    } catch (err: any) {
      console.error("[ENTERPRISE] Dashboard error:", err?.message);
      res.status(500).json({ error: "Dashboard unavailable" });
    }
  });

  app.get("/api/enterprise/dashboard/:id", isUserAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    try {
      const data = await getAccountDashboard(id);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Hierarchy ─────────────────────────────────────────────────────────────

  app.get("/api/enterprise/hierarchy", isUserAdmin, async (_req: Request, res: Response) => {
    try {
      const tree = await getFullHierarchyTree();
      res.json(tree);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/enterprise/hierarchy/node", isUserAdmin, async (req: Request, res: Response) => {
    const { id, nodeType, name, parentId, subAccountId, ownerId, metadata } = req.body;
    if (!nodeType || !name) return res.status(400).json({ error: "nodeType and name required" });
    try {
      const node = await upsertNode({ id, nodeType, name, parentId, subAccountId, ownerId, metadata });
      res.json(node);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Tenant governance ─────────────────────────────────────────────────────

  app.get("/api/enterprise/tenants", isUserAdmin, async (_req: Request, res: Response) => {
    try {
      const rows = await db.select().from(enterpriseTenantQuotas);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.get("/api/enterprise/tenants/:id/usage", isUserAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    try {
      const summary = await getUsageSummary(id);
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/enterprise/tenants/:id/plan", isUserAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const { planTier } = req.body;
    if (!id || !planTier) return res.status(400).json({ error: "id and planTier required" });
    try {
      await setTenantPlan(id, planTier, (req as any).user?.id || "admin");
      res.json({ ok: true, subAccountId: id, planTier });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/enterprise/tenants/:id/suspend", isUserAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const { suspended, reason } = req.body;
    if (!id) return res.status(400).json({ error: "Invalid id" });
    try {
      await setTenantSuspension(id, !!suspended, reason || "", (req as any).user?.id || "admin");
      res.json({ ok: true, subAccountId: id, suspended });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/enterprise/tenants/:id/flag", isUserAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const { flag, value } = req.body;
    if (!id || !flag) return res.status(400).json({ error: "id and flag required" });
    try {
      await setFeatureFlag(id, flag, !!value, (req as any).user?.id || "admin");
      res.json({ ok: true, subAccountId: id, flag, value });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/enterprise/tenants/:id/provision", isUserAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const { planTier } = req.body;
    if (!id) return res.status(400).json({ error: "Invalid id" });
    try {
      const quota = await ensureTenantQuota(id, planTier || "starter");
      res.json(quota);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Billing ───────────────────────────────────────────────────────────────

  app.get("/api/enterprise/billing/report", isUserAdmin, async (req: Request, res: Response) => {
    try {
      const now   = new Date();
      const since = req.query.since ? new Date(String(req.query.since)) : new Date(now.getFullYear(), now.getMonth(), 1);
      const until = req.query.until ? new Date(String(req.query.until)) : now;
      const report = await getPlatformUsageReport(since, until);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.get("/api/enterprise/billing/:id/estimate", isUserAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    try {
      const estimate = await estimateMonthlyCost(id);
      res.json(estimate);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── ROI Analytics ─────────────────────────────────────────────────────────

  app.get("/api/enterprise/roi/:id", isUserAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    try {
      const snap = await getLatestRoiSnapshot(id);
      res.json(snap || { subAccountId: id, message: "No snapshot yet — POST to /compute" });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/enterprise/roi/:id/compute", isUserAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const { platformCost } = req.body;
    if (!id) return res.status(400).json({ error: "Invalid id" });
    try {
      const result = await computeCurrentMonthRoi(id, platformCost || 0);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Audit Log ─────────────────────────────────────────────────────────────

  app.get("/api/enterprise/audit", isUserAdmin, async (req: Request, res: Response) => {
    try {
      const { eventType, actor, since, until, limit, offset } = req.query;
      const result = await queryAuditEvents({
        eventType: eventType as string,
        actor:     actor as string,
        since:     since ? new Date(String(since)) : undefined,
        until:     until ? new Date(String(until)) : undefined,
        limit:     parseInt(String(limit || "50")),
        offset:    parseInt(String(offset || "0")),
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.get("/api/enterprise/audit/:id", isUserAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    try {
      const result = await queryAuditEvents({
        subAccountId: id,
        limit:  parseInt(String(req.query.limit  || "50")),
        offset: parseInt(String(req.query.offset || "0")),
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── RBAC ──────────────────────────────────────────────────────────────────

  app.get("/api/enterprise/roles", isUserAdmin, async (_req: Request, res: Response) => {
    try {
      const roles = await listRoles();
      res.json(roles);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/enterprise/roles/assign", isUserAdmin, async (req: Request, res: Response) => {
    const { userId, roleName, scopeNodeId, subAccountId, expiresAt } = req.body;
    if (!userId || !roleName) return res.status(400).json({ error: "userId and roleName required" });
    try {
      await assignRole({
        userId,
        roleName,
        scopeNodeId,
        subAccountId,
        grantedBy: (req as any).user?.id || "admin",
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── White-label ───────────────────────────────────────────────────────────

  app.get("/api/enterprise/white-label", isUserAdmin, async (_req: Request, res: Response) => {
    try {
      const configs = await listWhiteLabelConfigs();
      res.json(configs);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/enterprise/white-label", isUserAdmin, async (req: Request, res: Response) => {
    try {
      const config = await upsertWhiteLabelConfig(req.body, (req as any).user?.id || "admin");
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.get("/api/enterprise/white-label/validate-domain", isUserAdmin, async (req: Request, res: Response) => {
    const { domain, subAccountId } = req.query;
    if (!domain || !subAccountId) return res.status(400).json({ error: "domain and subAccountId required" });
    try {
      const result = await validateCustomDomain(String(domain), parseInt(String(subAccountId)));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  console.log("[ENTERPRISE] Admin routes registered (11 groups)");
}
