import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import {
  cpSocialConnections, cpPosts, cpMedia, cpApprovals,
  cpContentLibrary, cpLabels, cpPublishLogs, cpPublishJobs,
} from "@shared/schema";
import { asyncHandler } from "./helpers";
import { encrypt, decrypt } from "../services/contentEncryption";
import { publishPost } from "../services/contentPlanner/publisher";
import { processDueScheduledPosts } from "../services/contentPlanner/scheduler";

const VALID_PLATFORMS = ["instagram", "facebook", "x", "tiktok"] as const;
const POST_STATUSES = ["draft", "scheduled", "published", "failed", "archived"] as const;
const APPROVAL_STATUSES = ["pending", "approved", "rejected", "revision_requested"] as const;

export function registerContentPlannerRoutes(app: Express) {

  // ─── Social Connections ──────────────────────────────────────────

  app.get("/api/content-planner/connections", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const rows = await db.select().from(cpSocialConnections)
      .where(eq(cpSocialConnections.subAccountId, subAccountId))
      .orderBy(desc(cpSocialConnections.createdAt));
    const safe = rows.map(({ accessTokenEnc, refreshTokenEnc, ...rest }) => ({
      ...rest,
      hasAccessToken: !!accessTokenEnc,
      hasRefreshToken: !!refreshTokenEnc,
    }));
    res.json(safe);
  }));

  app.post("/api/content-planner/connections", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const schema = z.object({
      platform: z.enum(VALID_PLATFORMS),
      accountName: z.string().max(200).optional(),
      accountId: z.string().max(200).optional(),
      accessToken: z.string().max(4000).optional(),
      refreshToken: z.string().max(4000).optional(),
      tokenExpiresAt: z.string().datetime().optional(),
      scopes: z.array(z.string().max(100)).max(20).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const { platform, accountName, accountId, accessToken, refreshToken, tokenExpiresAt, scopes } = parsed.data;
    const [row] = await db.insert(cpSocialConnections).values({
      subAccountId,
      platform,
      accountName: accountName || null,
      accountId: accountId || null,
      accessTokenEnc: accessToken ? encrypt(accessToken) : null,
      refreshTokenEnc: refreshToken ? encrypt(refreshToken) : null,
      tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt) : null,
      scopes: scopes || null,
    }).returning();
    const { accessTokenEnc, refreshTokenEnc, ...safe } = row;
    res.status(201).json({ ...safe, hasAccessToken: !!accessTokenEnc, hasRefreshToken: !!refreshTokenEnc });
  }));

  app.patch("/api/content-planner/connections/:id", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [existing] = await db.select().from(cpSocialConnections)
      .where(and(eq(cpSocialConnections.id, id), eq(cpSocialConnections.subAccountId, subAccountId)));
    if (!existing) return res.status(404).json({ error: "Connection not found" });

    const schema = z.object({
      accountName: z.string().max(200).optional(),
      accountId: z.string().max(200).optional(),
      accessToken: z.string().max(4000).optional(),
      refreshToken: z.string().max(4000).optional(),
      tokenExpiresAt: z.string().datetime().nullable().optional(),
      scopes: z.array(z.string().max(100)).max(20).optional(),
      isActive: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const { accessToken, refreshToken, tokenExpiresAt, ...rest } = parsed.data;
    const updates: Record<string, any> = { ...rest, updatedAt: new Date() };
    if (accessToken !== undefined) updates.accessTokenEnc = encrypt(accessToken);
    if (refreshToken !== undefined) updates.refreshTokenEnc = encrypt(refreshToken);
    if (tokenExpiresAt !== undefined) updates.tokenExpiresAt = tokenExpiresAt ? new Date(tokenExpiresAt) : null;

    const [row] = await db.update(cpSocialConnections).set(updates)
      .where(and(eq(cpSocialConnections.id, id), eq(cpSocialConnections.subAccountId, subAccountId)))
      .returning();
    const { accessTokenEnc, refreshTokenEnc, ...safe } = row;
    res.json({ ...safe, hasAccessToken: !!accessTokenEnc, hasRefreshToken: !!refreshTokenEnc });
  }));

  app.delete("/api/content-planner/connections/:id", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const deleted = await db.delete(cpSocialConnections)
      .where(and(eq(cpSocialConnections.id, id), eq(cpSocialConnections.subAccountId, subAccountId)))
      .returning();
    if (!deleted.length) return res.status(404).json({ error: "Connection not found" });
    res.json({ success: true });
  }));

  // ─── Labels ──────────────────────────────────────────────────────

  app.get("/api/content-planner/labels", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const rows = await db.select().from(cpLabels)
      .where(eq(cpLabels.subAccountId, subAccountId))
      .orderBy(cpLabels.name);
    res.json(rows);
  }));

  app.post("/api/content-planner/labels", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const schema = z.object({
      name: z.string().min(1).max(100),
      color: z.string().max(20).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const [row] = await db.insert(cpLabels).values({ subAccountId, ...parsed.data }).returning();
    res.status(201).json(row);
  }));

  app.patch("/api/content-planner/labels/:id", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const schema = z.object({
      name: z.string().min(1).max(100).optional(),
      color: z.string().max(20).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const [row] = await db.update(cpLabels).set(parsed.data)
      .where(and(eq(cpLabels.id, id), eq(cpLabels.subAccountId, subAccountId)))
      .returning();
    if (!row) return res.status(404).json({ error: "Label not found" });
    res.json(row);
  }));

  app.delete("/api/content-planner/labels/:id", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const deleted = await db.delete(cpLabels)
      .where(and(eq(cpLabels.id, id), eq(cpLabels.subAccountId, subAccountId)))
      .returning();
    if (!deleted.length) return res.status(404).json({ error: "Label not found" });
    res.json({ success: true });
  }));

  // ─── Media ───────────────────────────────────────────────────────

  app.get("/api/content-planner/media", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const rows = await db.select().from(cpMedia)
      .where(eq(cpMedia.subAccountId, subAccountId))
      .orderBy(desc(cpMedia.createdAt));
    res.json(rows);
  }));

  app.post("/api/content-planner/media", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const schema = z.object({
      filename: z.string().min(1).max(500),
      url: z.string().url().max(2000),
      mimeType: z.string().max(100).optional(),
      sizeBytes: z.number().int().nonnegative().optional(),
      altText: z.string().max(500).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const [row] = await db.insert(cpMedia).values({
      subAccountId,
      ...parsed.data,
      createdByUserId: null,
    }).returning();
    res.status(201).json(row);
  }));

  app.delete("/api/content-planner/media/:id", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const deleted = await db.delete(cpMedia)
      .where(and(eq(cpMedia.id, id), eq(cpMedia.subAccountId, subAccountId)))
      .returning();
    if (!deleted.length) return res.status(404).json({ error: "Media not found" });
    res.json({ success: true });
  }));

  // ─── Content Library ─────────────────────────────────────────────

  app.get("/api/content-planner/library", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const rows = await db.select().from(cpContentLibrary)
      .where(eq(cpContentLibrary.subAccountId, subAccountId))
      .orderBy(desc(cpContentLibrary.updatedAt));
    res.json(rows);
  }));

  app.post("/api/content-planner/library", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const schema = z.object({
      title: z.string().min(1).max(500),
      body: z.string().max(10000).optional(),
      category: z.string().max(100).optional(),
      tags: z.array(z.string().max(50)).max(20).optional(),
      mediaIds: z.array(z.number().int()).max(20).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const [row] = await db.insert(cpContentLibrary).values({
      subAccountId,
      ...parsed.data,
      createdByUserId: null,
    }).returning();
    res.status(201).json(row);
  }));

  app.patch("/api/content-planner/library/:id", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const schema = z.object({
      title: z.string().min(1).max(500).optional(),
      body: z.string().max(10000).optional(),
      category: z.string().max(100).optional(),
      tags: z.array(z.string().max(50)).max(20).optional(),
      mediaIds: z.array(z.number().int()).max(20).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const [row] = await db.update(cpContentLibrary).set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(cpContentLibrary.id, id), eq(cpContentLibrary.subAccountId, subAccountId)))
      .returning();
    if (!row) return res.status(404).json({ error: "Library item not found" });
    res.json(row);
  }));

  app.delete("/api/content-planner/library/:id", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const deleted = await db.delete(cpContentLibrary)
      .where(and(eq(cpContentLibrary.id, id), eq(cpContentLibrary.subAccountId, subAccountId)))
      .returning();
    if (!deleted.length) return res.status(404).json({ error: "Library item not found" });
    res.json({ success: true });
  }));

  // ─── Posts ───────────────────────────────────────────────────────

  app.get("/api/content-planner/posts", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const rows = await db.select().from(cpPosts)
      .where(eq(cpPosts.subAccountId, subAccountId))
      .orderBy(desc(cpPosts.updatedAt));
    res.json(rows);
  }));

  app.get("/api/content-planner/posts/:id", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [row] = await db.select().from(cpPosts)
      .where(and(eq(cpPosts.id, id), eq(cpPosts.subAccountId, subAccountId)));
    if (!row) return res.status(404).json({ error: "Post not found" });
    res.json(row);
  }));

  app.post("/api/content-planner/posts", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const schema = z.object({
      title: z.string().max(500).optional(),
      body: z.string().max(10000).optional(),
      platforms: z.array(z.enum(VALID_PLATFORMS)).max(4).optional(),
      mediaIds: z.array(z.number().int()).max(20).optional(),
      labelIds: z.array(z.number().int()).max(10).optional(),
      status: z.enum(POST_STATUSES).optional(),
      scheduledAt: z.string().datetime().optional(),
      connectionIds: z.array(z.number().int()).max(10).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const { scheduledAt, ...rest } = parsed.data;
    const [row] = await db.insert(cpPosts).values({
      subAccountId,
      ...rest,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      createdByUserId: null,
    }).returning();
    res.status(201).json(row);
  }));

  app.patch("/api/content-planner/posts/:id", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const schema = z.object({
      title: z.string().max(500).optional(),
      body: z.string().max(10000).optional(),
      platforms: z.array(z.enum(VALID_PLATFORMS)).max(4).optional(),
      mediaIds: z.array(z.number().int()).max(20).optional(),
      labelIds: z.array(z.number().int()).max(10).optional(),
      status: z.enum(POST_STATUSES).optional(),
      scheduledAt: z.string().datetime().nullable().optional(),
      connectionIds: z.array(z.number().int()).max(10).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const { scheduledAt, ...rest } = parsed.data;
    const updates: Record<string, any> = { ...rest, updatedAt: new Date() };
    if (scheduledAt !== undefined) updates.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;

    const [row] = await db.update(cpPosts).set(updates)
      .where(and(eq(cpPosts.id, id), eq(cpPosts.subAccountId, subAccountId)))
      .returning();
    if (!row) return res.status(404).json({ error: "Post not found" });
    res.json(row);
  }));

  app.delete("/api/content-planner/posts/:id", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const deleted = await db.delete(cpPosts)
      .where(and(eq(cpPosts.id, id), eq(cpPosts.subAccountId, subAccountId)))
      .returning();
    if (!deleted.length) return res.status(404).json({ error: "Post not found" });
    res.json({ success: true });
  }));

  // ─── Calendar Feed ───────────────────────────────────────────────

  app.get("/api/content-planner/calendar", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const startParam = req.query.start as string | undefined;
    const endParam = req.query.end as string | undefined;

    let query = db.select().from(cpPosts)
      .where(eq(cpPosts.subAccountId, subAccountId))
      .$dynamic();

    if (startParam) {
      const start = new Date(startParam);
      if (!isNaN(start.getTime())) {
        query = query.where(and(
          eq(cpPosts.subAccountId, subAccountId),
          gte(cpPosts.scheduledAt, start),
        ));
      }
    }
    if (endParam) {
      const end = new Date(endParam);
      if (!isNaN(end.getTime())) {
        query = query.where(and(
          eq(cpPosts.subAccountId, subAccountId),
          lte(cpPosts.scheduledAt, end),
        ));
      }
    }

    const rows = await query.orderBy(cpPosts.scheduledAt);
    const events = rows.map(p => ({
      id: p.id,
      title: p.title || "(Untitled)",
      start: p.scheduledAt || p.createdAt,
      end: p.scheduledAt || p.createdAt,
      status: p.status,
      platforms: p.platforms,
    }));
    res.json(events);
  }));

  // ─── Approvals ───────────────────────────────────────────────────

  app.get("/api/content-planner/approvals", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const rows = await db.select().from(cpApprovals)
      .where(eq(cpApprovals.subAccountId, subAccountId))
      .orderBy(desc(cpApprovals.createdAt));
    res.json(rows);
  }));

  app.post("/api/content-planner/approvals", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const schema = z.object({
      postId: z.number().int(),
      reviewerUserId: z.string().max(200).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const [post] = await db.select().from(cpPosts)
      .where(and(eq(cpPosts.id, parsed.data.postId), eq(cpPosts.subAccountId, subAccountId)));
    if (!post) return res.status(404).json({ error: "Post not found" });

    const [row] = await db.insert(cpApprovals).values({
      subAccountId,
      postId: parsed.data.postId,
      reviewerUserId: parsed.data.reviewerUserId || null,
    }).returning();
    res.status(201).json(row);
  }));

  app.patch("/api/content-planner/approvals/:id", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const schema = z.object({
      status: z.enum(APPROVAL_STATUSES),
      reviewNote: z.string().max(2000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const [row] = await db.update(cpApprovals).set({
      status: parsed.data.status,
      reviewNote: parsed.data.reviewNote || null,
      reviewedAt: new Date(),
    }).where(and(eq(cpApprovals.id, id), eq(cpApprovals.subAccountId, subAccountId)))
      .returning();
    if (!row) return res.status(404).json({ error: "Approval not found" });
    res.json(row);
  }));

  app.delete("/api/content-planner/approvals/:id", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const deleted = await db.delete(cpApprovals)
      .where(and(eq(cpApprovals.id, id), eq(cpApprovals.subAccountId, subAccountId)))
      .returning();
    if (!deleted.length) return res.status(404).json({ error: "Approval not found" });
    res.json({ success: true });
  }));

  // ─── Publish Logs (read-only) ────────────────────────────────────

  app.get("/api/content-planner/publish-logs", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const postIdParam = req.query.postId as string | undefined;

    let conditions = eq(cpPublishLogs.subAccountId, subAccountId);
    if (postIdParam) {
      const postId = parseInt(postIdParam);
      if (!isNaN(postId)) {
        conditions = and(conditions, eq(cpPublishLogs.postId, postId))!;
      }
    }

    const rows = await db.select().from(cpPublishLogs)
      .where(conditions)
      .orderBy(desc(cpPublishLogs.publishedAt));
    res.json(rows);
  }));

  // ─── Publish: Manual Trigger ─────────────────────────────────────

  app.post("/api/content-planner/posts/:id/publish", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const postId = parseInt(req.params.id);
    if (isNaN(postId)) return res.status(400).json({ error: "Invalid post id" });

    const schema = z.object({
      platforms: z.array(z.enum(VALID_PLATFORMS)).max(4).optional(),
      connectionIds: z.array(z.number().int()).max(10).optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    try {
      const result = await publishPost({
        postId,
        subAccountId,
        trigger: "manual",
        platforms: parsed.data.platforms,
        connectionIds: parsed.data.connectionIds,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }));

  // ─── Publish: Schedule a Post ────────────────────────────────────

  app.post("/api/content-planner/posts/:id/schedule", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const postId = parseInt(req.params.id);
    if (isNaN(postId)) return res.status(400).json({ error: "Invalid post id" });

    const schema = z.object({
      scheduledAt: z.string().datetime(),
      platforms: z.array(z.enum(VALID_PLATFORMS)).min(1).max(4),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const scheduledDate = new Date(parsed.data.scheduledAt);
    if (scheduledDate <= new Date()) {
      return res.status(400).json({ error: "Scheduled time must be in the future" });
    }

    const [post] = await db.select().from(cpPosts)
      .where(and(eq(cpPosts.id, postId), eq(cpPosts.subAccountId, subAccountId)));
    if (!post) return res.status(404).json({ error: "Post not found" });

    const [updated] = await db.update(cpPosts).set({
      status: "scheduled",
      scheduledAt: scheduledDate,
      platforms: parsed.data.platforms,
      updatedAt: new Date(),
    }).where(and(eq(cpPosts.id, postId), eq(cpPosts.subAccountId, subAccountId)))
      .returning();

    res.json(updated);
  }));

  // ─── Publish Jobs: List / Status ─────────────────────────────────

  app.get("/api/content-planner/publish-jobs", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const postIdParam = req.query.postId as string | undefined;

    let conditions = eq(cpPublishJobs.subAccountId, subAccountId);
    if (postIdParam) {
      const postId = parseInt(postIdParam);
      if (!isNaN(postId)) {
        conditions = and(conditions, eq(cpPublishJobs.postId, postId))!;
      }
    }

    const rows = await db.select().from(cpPublishJobs)
      .where(conditions)
      .orderBy(desc(cpPublishJobs.createdAt));
    res.json(rows);
  }));

  app.get("/api/content-planner/publish-jobs/:id", asyncHandler(async (req, res) => {
    const subAccountId = req.tenant.subAccountId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid job id" });

    const [job] = await db.select().from(cpPublishJobs)
      .where(and(eq(cpPublishJobs.id, id), eq(cpPublishJobs.subAccountId, subAccountId)));
    if (!job) return res.status(404).json({ error: "Publish job not found" });
    res.json(job);
  }));

  // ─── Scheduler: Process due posts (internal trigger) ─────────────

  app.post("/api/content-planner/scheduler/process", asyncHandler(async (req, res) => {
    const result = await processDueScheduledPosts();
    res.json(result);
  }));
}
