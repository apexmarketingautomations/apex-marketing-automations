import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { asyncHandler, parseIntParam, getUserId, verifyAccountOwnership } from "./helpers";

export function registerSnapshotsRoutes(app: Express) {
  // ---- Snapshot CRUD ----
  app.get("/api/snapshots", asyncHandler(async (_req, res) => {
    const all = await storage.getSnapshots();
    res.json(all);
  }));

  app.get("/api/snapshots/marketplace", asyncHandler(async (_req, res) => {
    const publicSnapshots = await storage.getPublicSnapshots();
    res.json(publicSnapshots);
  }));

  app.get("/api/snapshots/mine", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const mine = await storage.getSnapshotsByCreator(user.id);
    res.json(mine);
  }));

  app.get("/api/snapshots/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const snapshot = await storage.getSnapshot(id);
    if (!snapshot) return res.status(404).json({ error: "Snapshot not found" });
    res.json(snapshot);
  }));

  app.post("/api/snapshots/publish", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      subAccountId: z.number().int().positive(),
      name: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      price: z.number().min(0).default(0),
      isPublic: z.boolean().default(true),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const account = await storage.getSubAccount(parsed.data.subAccountId);
    if (!account) return res.status(404).json({ error: "Sub-account not found" });

    const workflows = await storage.getWorkflows();
    const accountWorkflows = workflows.filter(w => w.subAccountId === account.id);

    const config = {
      vibe: account.vibeTheme || "cyber-glass",
      industry: account.industry,
      config: account.config,
      workflows: accountWorkflows.map(w => ({ name: w.name, trigger: w.trigger, steps: w.steps })),
    };

    const snapshot = await storage.createSnapshot({
      creatorId: user.id,
      creatorName: user.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : user.email,
      name: parsed.data.name,
      description: parsed.data.description || null,
      price: parsed.data.price,
      industry: account.industry || null,
      config,
      isPublic: parsed.data.isPublic,
    });

    res.status(201).json(snapshot);
  }));

  app.post("/api/snapshots/:id/fork", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = parseIntParam(req.params.id, "id");
    const snapshot = await storage.getSnapshot(id);
    if (!snapshot) return res.status(404).json({ error: "Snapshot not found" });

    const parsed = z.object({
      businessName: z.string().min(1).max(200),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const config = snapshot.config as any;

    const newAccount = await storage.createSubAccount({
      name: parsed.data.businessName,
      twilioNumber: null,
      industry: snapshot.industry || null,
      vibeTheme: config?.vibe || "cyber-glass",
      config: config?.config || null,
      ownerUserId: getUserId(user),
      parentSnapshotId: snapshot.id,
      isFork: true,
    });

    if (config?.workflows && Array.isArray(config.workflows)) {
      for (const wf of config.workflows) {
        await storage.createWorkflow({
          name: wf.name || "Imported Workflow",
          trigger: wf.trigger || "manual_trigger",
          steps: wf.steps || [],
          subAccountId: newAccount.id,
        });
      }
    }

    await storage.updateSnapshot(id, {
      forkCount: (snapshot.forkCount || 0) + 1,
      downloads: (snapshot.downloads || 0) + 1,
    });

    await storage.createAuditLog({
      action: "SNAPSHOT_FORK",
      performedBy: user?.claims?.sub || user?.id || "system",
      details: { snapshotId: id, newAccountId: newAccount.id, businessName: parsed.data.businessName },
    });

    res.status(201).json({ account: newAccount, snapshotId: id });
  }));

  // ---- Snapshot Versioning (Checkpoints) ----
  app.get("/api/versions/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const versions = await storage.getSnapshotVersions(subAccountId);
    res.json(versions);
  }));

  app.post("/api/versions/checkpoint", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      subAccountId: z.number().int().positive(),
      versionName: z.string().min(1).max(200),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const account = await storage.getSubAccount(parsed.data.subAccountId);
    if (!account) return res.status(404).json({ error: "Sub-account not found" });

    const workflows = await storage.getWorkflows();
    const accountWorkflows = workflows.filter(w => w.subAccountId === account.id);

    const configSnapshot = {
      name: account.name,
      industry: account.industry,
      config: account.config,
      vibeTheme: account.vibeTheme,
      workflows: accountWorkflows.map(w => ({ id: w.id, name: w.name, trigger: w.trigger, steps: w.steps })),
    };

    const version = await storage.createSnapshotVersion({
      subAccountId: parsed.data.subAccountId,
      versionName: parsed.data.versionName,
      config: configSnapshot,
      createdBy: user.id,
    });

    res.status(201).json(version);
  }));

  app.post("/api/versions/:id/rollback", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = parseIntParam(req.params.id, "id");
    const version = await storage.getSnapshotVersion(id);
    if (!version) return res.status(404).json({ error: "Version not found" });

    const config = version.config as any;

    await storage.updateSubAccount(version.subAccountId, {
      config: config.config,
      vibeTheme: config.vibeTheme,
      industry: config.industry,
    });

    await storage.createAuditLog({
      action: "ROLLBACK",
      performedBy: user?.claims?.sub || user?.id || "system",
      details: { versionId: id, subAccountId: version.subAccountId, versionName: version.versionName },
    });

    res.json({ success: true, message: `Restored to: ${version.versionName}` });
  }));

  app.post("/api/versions/bulk-rollback", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      versionId: z.number().int().positive(),
      subAccountIds: z.array(z.number().int().positive()),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const version = await storage.getSnapshotVersion(parsed.data.versionId);
    if (!version) return res.status(404).json({ error: "Version not found" });

    const config = version.config as any;
    let successCount = 0;

    for (const subAccountId of parsed.data.subAccountIds) {
      try {
        await storage.updateSubAccount(subAccountId, {
          config: config.config,
          vibeTheme: config.vibeTheme,
        });
        successCount++;
      } catch (e) {
        console.error(`[BULK_ROLLBACK] Failed for account ${subAccountId}:`, (e as any).message);
      }
    }

    await storage.createAuditLog({
      action: "BULK_ROLLBACK",
      performedBy: user?.claims?.sub || user?.id || "system",
      count: successCount,
      details: { versionId: parsed.data.versionId, totalTargeted: parsed.data.subAccountIds.length },
    });

    res.json({ success: true, count: successCount, message: `Rolled back ${successCount} accounts` });
  }));
}
