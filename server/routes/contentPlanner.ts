import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  socialAccounts,
  contentPosts,
  contentPostPlatforms,
  contentMedia,
  contentCalendarLabels,
  contentApprovals,
  contentPublishingJobs,
  contentLibrary,
  subAccounts,
} from "@shared/schema";
import { eq, and, gte, lte, asc, desc, or, sql, inArray } from "drizzle-orm";
import { encryptToken, decryptToken } from "../services/contentEncryption";
import { z } from "zod";
import { publishPost } from "../services/contentPlanner/publisher";
import { processDueScheduledPosts } from "../services/contentPlanner/scheduler";
import { getPublisherStats, getQueueStats } from "../services/contentPlanner/schedulerWorker";

function getTenant(req: Request): number {
  const id = (req as any).tenant?.subAccountId;
  if (!id || typeof id !== "number") {
    throw new Error("Tenant context missing or invalid");
  }
  return id;
}

const VALID_PLATFORMS = ["instagram", "facebook", "x", "tiktok"] as const;

const createConnectionSchema = z.object({
  platform: z.enum(VALID_PLATFORMS),
  platformAccountId: z.string().min(1),
  username: z.string().optional(),
  displayName: z.string().optional(),
  avatarUrl: z.string().optional(),
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  tokenExpiresAt: z.string().optional(),
  scopes: z.string().optional(),
  meta: z.any().optional(),
});

const createPostSchema = z.object({
  title: z.string().optional(),
  caption: z.string().optional(),
  hashtags: z.string().optional(),
  callToAction: z.string().optional(),
  firstComment: z.string().optional(),
  contentType: z.string().optional(),
  scheduledAt: z.string().optional(),
  platforms: z
    .array(
      z.object({
        platform: z.enum(VALID_PLATFORMS),
        socialAccountId: z.number().optional(),
      })
    )
    .optional(),
});

const updatePostSchema = createPostSchema.partial().extend({
  status: z
    .enum(["draft", "scheduled", "published", "failed", "retrying", "cancelled"])
    .optional(),
  approvalStatus: z
    .enum(["not_required", "pending", "approved", "rejected"])
    .optional(),
});

export function registerContentPlannerRoutes(app: Express) {

  app.get("/api/content-planner/connections", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const connections = await db
        .select({
          id: socialAccounts.id,
          platform: socialAccounts.platform,
          platformAccountId: socialAccounts.platformAccountId,
          username: socialAccounts.username,
          displayName: socialAccounts.displayName,
          avatarUrl: socialAccounts.avatarUrl,
          status: socialAccounts.status,
          tokenExpiresAt: socialAccounts.tokenExpiresAt,
          scopes: socialAccounts.scopes,
          lastSyncAt: socialAccounts.lastSyncAt,
          createdAt: socialAccounts.createdAt,
        })
        .from(socialAccounts)
        .where(eq(socialAccounts.subAccountId, subAccountId))
        .orderBy(asc(socialAccounts.platform));
      res.json(connections);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/content-planner/connections", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const parsed = createConnectionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const data = parsed.data;
      const [connection] = await db
        .insert(socialAccounts)
        .values({
          subAccountId,
          platform: data.platform,
          platformAccountId: data.platformAccountId,
          username: data.username,
          displayName: data.displayName,
          avatarUrl: data.avatarUrl,
          accessTokenEncrypted: encryptToken(data.accessToken),
          refreshTokenEncrypted: data.refreshToken
            ? encryptToken(data.refreshToken)
            : null,
          tokenExpiresAt: data.tokenExpiresAt ? new Date(data.tokenExpiresAt) : null,
          scopes: data.scopes,
          meta: data.meta,
          status: "active",
          lastSyncAt: new Date(),
        })
        .returning({
          id: socialAccounts.id,
          platform: socialAccounts.platform,
          username: socialAccounts.username,
          status: socialAccounts.status,
        });
      res.status(201).json(connection);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/content-planner/connections/:id", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid connection id" });
      const { accessToken, refreshToken, tokenExpiresAt, status } = req.body;
      const updates: any = { updatedAt: new Date() };
      if (accessToken) updates.accessTokenEncrypted = encryptToken(accessToken);
      if (refreshToken) updates.refreshTokenEncrypted = encryptToken(refreshToken);
      if (tokenExpiresAt) updates.tokenExpiresAt = new Date(tokenExpiresAt);
      if (status) updates.status = status;
      const [updated] = await db
        .update(socialAccounts)
        .set(updates)
        .where(
          and(
            eq(socialAccounts.id, id),
            eq(socialAccounts.subAccountId, subAccountId)
          )
        )
        .returning({
          id: socialAccounts.id,
          status: socialAccounts.status,
          updatedAt: socialAccounts.updatedAt,
        });
      if (!updated) return res.status(404).json({ error: "Connection not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/content-planner/connections/:id", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid connection id" });
      await db
        .delete(socialAccounts)
        .where(
          and(
            eq(socialAccounts.id, id),
            eq(socialAccounts.subAccountId, subAccountId)
          )
        );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/content-planner/posts", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const { status, from, to } = req.query;
      const conditions: any[] = [eq(contentPosts.subAccountId, subAccountId)];
      if (status) conditions.push(eq(contentPosts.status, status as any));
      if (from) conditions.push(gte(contentPosts.scheduledAt, new Date(from as string)));
      if (to) conditions.push(lte(contentPosts.scheduledAt, new Date(to as string)));
      const posts = await db
        .select()
        .from(contentPosts)
        .where(and(...conditions))
        .orderBy(desc(contentPosts.createdAt));
      res.json(posts);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/content-planner/posts/:id", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid post id" });
      const [post] = await db
        .select()
        .from(contentPosts)
        .where(
          and(
            eq(contentPosts.id, id),
            eq(contentPosts.subAccountId, subAccountId)
          )
        )
        .limit(1);
      if (!post) return res.status(404).json({ error: "Post not found" });
      const platforms = await db
        .select()
        .from(contentPostPlatforms)
        .where(
          and(
            eq(contentPostPlatforms.postId, id),
            eq(contentPostPlatforms.subAccountId, subAccountId)
          )
        );
      const media = await db
        .select()
        .from(contentMedia)
        .where(
          and(
            eq(contentMedia.postId, id),
            eq(contentMedia.subAccountId, subAccountId)
          )
        )
        .orderBy(asc(contentMedia.sortOrder));
      res.json({ ...post, platforms, media });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/content-planner/posts", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const parsed = createPostSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const { platforms, ...postData } = parsed.data;
      const [post] = await db
        .insert(contentPosts)
        .values({
          subAccountId,
          ...postData,
          scheduledAt: postData.scheduledAt ? new Date(postData.scheduledAt) : null,
          createdByUserId: null,
        })
        .returning();
      if (platforms && platforms.length > 0) {
        await db.insert(contentPostPlatforms).values(
          platforms.map((p) => ({
            postId: post.id,
            subAccountId,
            platform: p.platform,
            socialAccountId: p.socialAccountId,
            platformStatus: "draft" as const,
          }))
        );
      }
      res.status(201).json(post);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/content-planner/posts/:id", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid post id" });
      const parsed = updatePostSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const { platforms: _platforms, ...postData } = parsed.data as any;
      const updates: any = { ...postData, updatedAt: new Date() };
      if (postData.scheduledAt) updates.scheduledAt = new Date(postData.scheduledAt);
      const [updated] = await db
        .update(contentPosts)
        .set(updates)
        .where(
          and(
            eq(contentPosts.id, id),
            eq(contentPosts.subAccountId, subAccountId)
          )
        )
        .returning();
      if (!updated) return res.status(404).json({ error: "Post not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/content-planner/posts/:id", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid post id" });
      await db
        .delete(contentPosts)
        .where(
          and(
            eq(contentPosts.id, id),
            eq(contentPosts.subAccountId, subAccountId)
          )
        );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/content-planner/calendar", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const { from, to } = req.query;
      const conditions: any[] = [eq(contentPosts.subAccountId, subAccountId)];
      if (from) conditions.push(gte(contentPosts.scheduledAt, new Date(from as string)));
      if (to) conditions.push(lte(contentPosts.scheduledAt, new Date(to as string)));
      const posts = await db
        .select({
          id: contentPosts.id,
          title: contentPosts.title,
          caption: contentPosts.caption,
          status: contentPosts.status,
          scheduledAt: contentPosts.scheduledAt,
          contentType: contentPosts.contentType,
          approvalStatus: contentPosts.approvalStatus,
        })
        .from(contentPosts)
        .where(and(...conditions))
        .orderBy(asc(contentPosts.scheduledAt));
      res.json(posts);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/content-planner/media", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const media = await db
        .select()
        .from(contentMedia)
        .where(eq(contentMedia.subAccountId, subAccountId))
        .orderBy(desc(contentMedia.createdAt));
      res.json(media);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/content-planner/media", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const { postId, fileUrl, fileKey, fileType, fileSize, sortOrder, altText } = req.body;
      if (!fileUrl) return res.status(400).json({ error: "fileUrl is required" });
      const [media] = await db
        .insert(contentMedia)
        .values({
          subAccountId,
          postId: postId ? parseInt(postId) : null,
          fileUrl,
          fileKey,
          fileType,
          fileSize,
          sortOrder: sortOrder ?? 0,
          altText,
        })
        .returning();
      res.status(201).json(media);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/content-planner/media/:id", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid media id" });
      await db
        .delete(contentMedia)
        .where(
          and(
            eq(contentMedia.id, id),
            eq(contentMedia.subAccountId, subAccountId)
          )
        );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/content-planner/approvals", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const approvals = await db
        .select()
        .from(contentApprovals)
        .where(eq(contentApprovals.subAccountId, subAccountId))
        .orderBy(desc(contentApprovals.createdAt));
      res.json(approvals);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/content-planner/approvals", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const { postId, requestedBy } = req.body;
      if (!postId || !requestedBy) {
        return res.status(400).json({ error: "postId and requestedBy are required" });
      }
      const [post] = await db
        .select({ id: contentPosts.id })
        .from(contentPosts)
        .where(
          and(
            eq(contentPosts.id, parseInt(postId)),
            eq(contentPosts.subAccountId, subAccountId)
          )
        )
        .limit(1);
      if (!post) return res.status(404).json({ error: "Post not found" });
      const [approval] = await db
        .insert(contentApprovals)
        .values({ postId: post.id, subAccountId, requestedBy })
        .returning();
      await db
        .update(contentPosts)
        .set({ approvalStatus: "pending", updatedAt: new Date() })
        .where(
          and(
            eq(contentPosts.id, post.id),
            eq(contentPosts.subAccountId, subAccountId)
          )
        );
      res.status(201).json(approval);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/content-planner/approvals/:id", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid approval id" });
      const { decision, notes, reviewedBy } = req.body;
      if (!decision || !["approved", "rejected"].includes(decision)) {
        return res.status(400).json({ error: "decision must be approved or rejected" });
      }
      const [approval] = await db
        .update(contentApprovals)
        .set({ decision, notes, reviewedBy, reviewedAt: new Date() })
        .where(
          and(
            eq(contentApprovals.id, id),
            eq(contentApprovals.subAccountId, subAccountId)
          )
        )
        .returning();
      if (!approval) return res.status(404).json({ error: "Approval not found" });
      await db
        .update(contentPosts)
        .set({ approvalStatus: decision as any, updatedAt: new Date() })
        .where(
          and(
            eq(contentPosts.id, approval.postId),
            eq(contentPosts.subAccountId, subAccountId)
          )
        );
      res.json(approval);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/content-planner/library", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const { type } = req.query;
      const conditions: any[] = [eq(contentLibrary.subAccountId, subAccountId)];
      if (type) conditions.push(eq(contentLibrary.type, type as string));
      const items = await db
        .select()
        .from(contentLibrary)
        .where(and(...conditions))
        .orderBy(desc(contentLibrary.createdAt));
      res.json(items);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/content-planner/library", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const { type, title, body, tags } = req.body;
      if (!type) return res.status(400).json({ error: "type is required" });
      const [item] = await db
        .insert(contentLibrary)
        .values({
          subAccountId,
          type,
          title,
          body,
          tags: tags || [],
          createdByUserId: null,
        })
        .returning();
      res.status(201).json(item);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/content-planner/library/:id", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid library item id" });
      const { title, body, tags } = req.body;
      const [item] = await db
        .update(contentLibrary)
        .set({ title, body, tags, updatedAt: new Date() })
        .where(
          and(
            eq(contentLibrary.id, id),
            eq(contentLibrary.subAccountId, subAccountId)
          )
        )
        .returning();
      if (!item) return res.status(404).json({ error: "Library item not found" });
      res.json(item);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/content-planner/library/:id", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid library item id" });
      await db
        .delete(contentLibrary)
        .where(
          and(
            eq(contentLibrary.id, id),
            eq(contentLibrary.subAccountId, subAccountId)
          )
        );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/content-planner/logs", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const logs = await db
        .select()
        .from(contentPublishingJobs)
        .where(eq(contentPublishingJobs.subAccountId, subAccountId))
        .orderBy(desc(contentPublishingJobs.createdAt))
        .limit(100);
      res.json(logs);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/content-planner/labels", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const labels = await db
        .select()
        .from(contentCalendarLabels)
        .where(eq(contentCalendarLabels.subAccountId, subAccountId))
        .orderBy(asc(contentCalendarLabels.name));
      res.json(labels);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/content-planner/labels", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const { name, color } = req.body;
      if (!name) return res.status(400).json({ error: "name is required" });
      const [label] = await db
        .insert(contentCalendarLabels)
        .values({ subAccountId, name, color })
        .returning();
      res.status(201).json(label);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/content-planner/labels/:id", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid label id" });
      await db
        .delete(contentCalendarLabels)
        .where(
          and(
            eq(contentCalendarLabels.id, id),
            eq(contentCalendarLabels.subAccountId, subAccountId)
          )
        );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/content-planner/posts/:id/publish", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const postId = parseInt(req.params.id);
      if (isNaN(postId)) return res.status(400).json({ error: "Invalid post id" });

      const platformsSchema = z.object({
        platforms: z.array(z.enum(VALID_PLATFORMS)).max(4).optional(),
      });
      const parsed = platformsSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const result = await publishPost({
        postId,
        subAccountId,
        trigger: "manual",
        platforms: parsed.data.platforms,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/content-planner/posts/:id/schedule", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const postId = parseInt(req.params.id);
      if (isNaN(postId)) return res.status(400).json({ error: "Invalid post id" });

      const schema = z.object({
        scheduledAt: z.string(),
        platforms: z.array(z.enum(VALID_PLATFORMS)).min(1).max(4),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const scheduledDate = new Date(parsed.data.scheduledAt);
      if (scheduledDate <= new Date()) {
        return res.status(400).json({ error: "Scheduled time must be in the future" });
      }

      const [post] = await db.select().from(contentPosts)
        .where(and(eq(contentPosts.id, postId), eq(contentPosts.subAccountId, subAccountId)));
      if (!post) return res.status(404).json({ error: "Post not found" });

      const [updated] = await db.update(contentPosts).set({
        status: "scheduled",
        scheduledAt: scheduledDate,
        updatedAt: new Date(),
      }).where(and(eq(contentPosts.id, postId), eq(contentPosts.subAccountId, subAccountId)))
        .returning();

      for (const platform of parsed.data.platforms) {
        const [existing] = await db.select().from(contentPostPlatforms)
          .where(and(
            eq(contentPostPlatforms.postId, postId),
            eq(contentPostPlatforms.platform, platform),
          ));
        if (!existing) {
          await db.insert(contentPostPlatforms).values({
            postId,
            subAccountId,
            platform,
            platformStatus: "scheduled",
          });
        }
      }

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/content-planner/scheduler/process", async (req: Request, res: Response) => {
    try {
      const result = await processDueScheduledPosts();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/content-planner/meta-diagnostics", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const [account] = await db.select().from(subAccounts)
        .where(eq(subAccounts.id, subAccountId));
      if (!account) return res.status(404).json({ error: "Sub-account not found" });

      const diag: Record<string, any> = {
        subAccountId,
        accountName: account.name,
        credentials: {
          metaPageId: account.metaPageId || null,
          metaAccessToken: account.metaAccessToken
            ? `${account.metaAccessToken.substring(0, 8)}...${account.metaAccessToken.substring(account.metaAccessToken.length - 4)}`
            : null,
          metaAppSecret: account.metaAppSecret ? "present" : "missing",
        },
        pageAccess: { status: "not_tested" },
        pagePermissions: { status: "not_tested" },
        instagramBusiness: { status: "not_tested" },
      };

      if (!account.metaAccessToken || !account.metaPageId) {
        diag.pageAccess = { status: "skipped", reason: "Missing metaAccessToken or metaPageId" };
        diag.pagePermissions = { status: "skipped", reason: "No token to check" };
        diag.instagramBusiness = { status: "skipped", reason: "No token to check" };
        return res.json(diag);
      }

      const token = account.metaAccessToken;
      const pageId = account.metaPageId;

      try {
        const pageRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=id,name,access_token&access_token=${token}`);
        const pageData = await pageRes.json() as any;
        if (pageData.error) {
          diag.pageAccess = { status: "failed", error: pageData.error.message, code: pageData.error.code, type: pageData.error.type };
        } else {
          diag.pageAccess = { status: "ok", pageId: pageData.id, pageName: pageData.name, hasPageToken: !!pageData.access_token };
        }
      } catch (err: any) {
        diag.pageAccess = { status: "error", message: err.message };
      }

      try {
        const permRes = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${token}`);
        const permData = await permRes.json() as any;
        if (permData.error) {
          diag.pagePermissions = { status: "failed", error: permData.error.message };
        } else {
          const perms = (permData.data || []) as Array<{ permission: string; status: string }>;
          const granted = perms.filter((p: any) => p.status === "granted").map((p: any) => p.permission);
          const declined = perms.filter((p: any) => p.status === "declined").map((p: any) => p.permission);
          const required = ["pages_read_engagement", "pages_manage_posts"];
          const missing = required.filter(r => !granted.includes(r));
          diag.pagePermissions = {
            status: missing.length === 0 ? "ok" : "incomplete",
            granted, declined, requiredForPublishing: required, missingForPublishing: missing,
          };
        }
      } catch (err: any) {
        diag.pagePermissions = { status: "error", message: err.message };
      }

      try {
        const igRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account&access_token=${token}`);
        const igData = await igRes.json() as any;
        if (igData.error) {
          diag.instagramBusiness = { status: "failed", error: igData.error.message };
        } else if (igData.instagram_business_account?.id) {
          diag.instagramBusiness = { status: "linked", igUserId: igData.instagram_business_account.id };
        } else {
          diag.instagramBusiness = { status: "not_linked", reason: "No Instagram Business account connected to this Facebook Page" };
        }
      } catch (err: any) {
        diag.instagramBusiness = { status: "error", message: err.message };
      }

      const pageOk = diag.pageAccess.status === "ok";
      const permsOk = diag.pagePermissions.status === "ok";
      const permsFailed = diag.pagePermissions.status === "failed";
      const igLinked = diag.instagramBusiness.status === "linked";

      diag.facebookReady = pageOk && (permsOk || (permsFailed && diag.pageAccess.hasPageToken));
      diag.instagramReady = diag.facebookReady && igLinked;

      const steps: string[] = [];
      if (!account.metaPageId) steps.push("Set metaPageId on your sub-account");
      if (!account.metaAccessToken) steps.push("Set metaAccessToken on your sub-account");
      if (!pageOk) steps.push("Fix page access — check that the token and Page ID are valid");
      if (!permsOk && !permsFailed) steps.push("Grant pages_read_engagement and pages_manage_posts permissions");
      if (permsFailed) steps.push("Token appears to be a Page token. Try a test publish — if it fails, regenerate with pages_manage_posts scope");
      if (!igLinked) steps.push("Link an Instagram Business account to this Facebook Page in Meta Business Suite");
      if (steps.length === 0) steps.push("All checks passed — ready to publish");
      diag.recommendedNextSteps = steps;

      res.json(diag);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/content-planner/meta-token", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const schema = z.object({ accessToken: z.string().min(10).max(1000) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "A valid accessToken string is required" });

      const { accessToken } = parsed.data;
      const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
      if (!account) return res.status(404).json({ error: "Sub-account not found" });

      await db.update(subAccounts).set({ metaAccessToken: accessToken }).where(eq(subAccounts.id, subAccountId));
      const masked = `${accessToken.substring(0, 8)}...${accessToken.substring(accessToken.length - 4)}`;
      console.log(`[CP-META-TOKEN] Updated Meta access token for subAccount ${subAccountId} (masked: ${masked})`);

      res.json({ success: true, subAccountId, maskedToken: masked });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/content-planner/publishing-jobs", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const { status, platform, postId, limit: limitStr } = req.query;
      const conditions: any[] = [eq(contentPublishingJobs.subAccountId, subAccountId)];
      if (status) {
        const statuses = (status as string).split(",");
        if (statuses.length === 1) {
          conditions.push(eq(contentPublishingJobs.status, statuses[0]));
        } else {
          conditions.push(inArray(contentPublishingJobs.status, statuses));
        }
      }
      if (platform) conditions.push(eq(contentPublishingJobs.platform, platform as string));
      if (postId) conditions.push(eq(contentPublishingJobs.postId, parseInt(postId as string)));
      const rows = await db.select().from(contentPublishingJobs)
        .where(and(...conditions))
        .orderBy(desc(contentPublishingJobs.createdAt))
        .limit(parseInt(limitStr as string) || 100);
      res.json(rows);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/content-planner/publishing-jobs/:jobId/retry", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const jobId = parseInt(req.params.jobId);
      if (isNaN(jobId)) return res.status(400).json({ error: "Invalid job id" });
      const [job] = await db.select().from(contentPublishingJobs)
        .where(and(eq(contentPublishingJobs.id, jobId), eq(contentPublishingJobs.subAccountId, subAccountId)));
      if (!job) return res.status(404).json({ error: "Job not found" });
      if (job.status !== "failed" && job.status !== "cancelled") {
        return res.status(400).json({ error: `Cannot retry job with status '${job.status}'. Only failed or cancelled jobs can be retried.` });
      }
      const [updated] = await db.update(contentPublishingJobs).set({
        status: "queued",
        attemptCount: 0,
        errorMessage: null,
        lockOwner: null,
        lockExpiresAt: null,
        nextRetryAt: null,
        completedAt: null,
        startedAt: null,
        updatedAt: new Date(),
      }).where(eq(contentPublishingJobs.id, jobId)).returning();
      console.log(`[CP-ADMIN] Job ${jobId} reset to queued for retry`);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/content-planner/publishing-jobs/:jobId/cancel", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const jobId = parseInt(req.params.jobId);
      if (isNaN(jobId)) return res.status(400).json({ error: "Invalid job id" });
      const [job] = await db.select().from(contentPublishingJobs)
        .where(and(eq(contentPublishingJobs.id, jobId), eq(contentPublishingJobs.subAccountId, subAccountId)));
      if (!job) return res.status(404).json({ error: "Job not found" });
      if (job.status === "published") {
        return res.status(400).json({ error: "Cannot cancel an already published job" });
      }
      const [updated] = await db.update(contentPublishingJobs).set({
        status: "cancelled",
        lockOwner: null,
        lockExpiresAt: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(contentPublishingJobs.id, jobId)).returning();
      console.log(`[CP-ADMIN] Job ${jobId} cancelled`);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/content-planner/posts/:id/cancel", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const postId = parseInt(req.params.id);
      if (isNaN(postId)) return res.status(400).json({ error: "Invalid post id" });
      const [post] = await db.select().from(contentPosts)
        .where(and(eq(contentPosts.id, postId), eq(contentPosts.subAccountId, subAccountId)));
      if (!post) return res.status(404).json({ error: "Post not found" });
      if (post.status === "published") {
        return res.status(400).json({ error: "Cannot cancel an already published post" });
      }
      await db.update(contentPublishingJobs).set({
        status: "cancelled",
        lockOwner: null,
        lockExpiresAt: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(contentPublishingJobs.postId, postId),
        eq(contentPublishingJobs.subAccountId, subAccountId),
        or(eq(contentPublishingJobs.status, "queued"), eq(contentPublishingJobs.status, "processing")),
      ));
      const [updated] = await db.update(contentPosts).set({
        status: "draft",
        updatedAt: new Date(),
      }).where(and(eq(contentPosts.id, postId), eq(contentPosts.subAccountId, subAccountId)))
        .returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/content-planner/health", async (req: Request, res: Response) => {
    try {
      const subAccountId = getTenant(req);
      const workerStats = getPublisherStats();
      const queueStats = await getQueueStats(subAccountId);
      res.json({
        status: workerStats.isRunning ? "healthy" : "degraded",
        worker: {
          isRunning: workerStats.isRunning,
          lastPollAt: workerStats.lastPollAt,
        },
        queue: queueStats,
      });
    } catch (err: any) {
      res.status(500).json({ status: "error", error: err.message });
    }
  });
}
