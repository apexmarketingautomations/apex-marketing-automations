import type { Express, Request, Response } from "express";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler, isUserAdmin, parseIntParam } from "./helpers";
import { storage } from "../storage";
import { getBillingCoverage, runBillingAudit } from "../billing";

const errorLogLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many error reports." },
  validate: { xForwardedForHeader: false },
});

export function registerAdminRoutes(app: Express) {
  // ---- Image Uploads ----
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use("/uploads", express.static(uploadsDir));

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadsDir),
      filename: (_req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname) || ".png";
        cb(null, `ad-${uniqueSuffix}${ext}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Only JPEG, PNG, WebP, and GIF images are allowed"));
      }
    },
  });

  app.post("/api/upload-ad-image", (req: Request, res: Response, next) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    next();
  }, upload.single("image"), (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ url: imageUrl });
  });

  // ---- Error Logging ----
  const errorLogSchema = z.object({
    message: z.string().max(2000),
    stack: z.string().max(10000).optional(),
    url: z.string().max(500).optional(),
    timestamp: z.string().optional(),
  });

  app.post("/api/log-error", errorLogLimiter, (req: Request, res: Response) => {
    const parsed = errorLogSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid error report" });
    const { message, stack, url, timestamp } = parsed.data;
    console.error(`[CLIENT ERROR] ${timestamp || new Date().toISOString()} | ${url || "unknown"} | ${message}`);
    if (stack) console.error(`[CLIENT STACK] ${stack.slice(0, 2000)}`);
    res.json({ received: true });
  });

  // ---- Project Download (Admin Only) ----
  app.get("/api/download-project", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const _req = req;
    const { execSync } = await import("child_process");
    const archivePath = path.resolve(process.cwd(), "apex-marketing-animation.tar.gz");
    execSync(
      `tar -czf "${archivePath}" --exclude='node_modules' --exclude='.git' --exclude='dist' --exclude='.cache' --exclude='uploads' --exclude='.local' --exclude='*.tar.gz' -C "${process.cwd()}" .`,
      { timeout: 60000 }
    );
    res.download(archivePath, "apex-marketing-animation.tar.gz", (err) => {
      fs.unlink(archivePath, () => {});
      if (err && !res.headersSent) {
        res.status(500).json({ error: "Download failed" });
      }
    });
  }));

  // ---- Routing Failures (Admin Only) ----
  app.get("/api/admin/routing-failures", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const unresolvedOnly = req.query.all !== "true";
    const failures = await storage.getRoutingFailures(unresolvedOnly);
    res.json({ failures, total: failures.length });
  }));

  app.post("/api/admin/routing-failures/:id/resolve", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const id = parseIntParam(req.params.id, "id");
    const parsed = z.object({ subAccountId: z.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const resolved = await storage.resolveRoutingFailure(id, parsed.data.subAccountId);
    if (!resolved) return res.status(404).json({ error: "Routing failure not found" });
    res.json(resolved);
  }));

  app.get("/api/admin/billing-coverage", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const coverage = await getBillingCoverage();
    res.json(coverage);
  }));

  app.post("/api/admin/billing-audit", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const backfill = req.query.backfill === "true";
    const report = await runBillingAudit(backfill);
    res.json(report);
  }));

  app.post("/api/admin/comment-bot/backfill", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const subAccountId = parseIntParam(req.body.subAccountId);
    if (!subAccountId) return res.status(400).json({ error: "subAccountId required" });
    const dryRun = req.query.dryRun === "true" || req.body.dryRun === true;
    const maxPosts = parseInt(req.body.maxPosts) || 10;
    const { backfillComments } = await import("../services/commentBot/commentBackfill");
    const result = await backfillComments({ subAccountId, maxPosts, dryRun });
    res.json(result);
  }));

  app.get("/api/admin/comment-bot/stats/:subAccountId", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const subAccountId = parseIntParam(req.params.subAccountId);
    if (!subAccountId) return res.status(400).json({ error: "Invalid subAccountId" });
    const { db } = await import("../db");
    const { commentAutoReplies } = await import("@shared/schema");
    const { eq, sql, desc } = await import("drizzle-orm");
    const [stats] = await db.select({
      total: sql<number>`count(*)`,
      replied: sql<number>`count(*) filter (where status = 'replied')`,
      skipped: sql<number>`count(*) filter (where status = 'skipped')`,
      failed: sql<number>`count(*) filter (where status = 'failed')`,
      processing: sql<number>`count(*) filter (where status = 'processing')`,
      rateLimited: sql<number>`count(*) filter (where status = 'rate_limited')`,
    }).from(commentAutoReplies).where(eq(commentAutoReplies.subAccountId, subAccountId));
    const recent = await db.select().from(commentAutoReplies)
      .where(eq(commentAutoReplies.subAccountId, subAccountId))
      .orderBy(desc(commentAutoReplies.id)).limit(20);
    res.json({ stats, recent });
  }));

  // ── Dead Letter Queue endpoints ─────────────────────────────────────────────

  /**
   * GET /api/admin/dead-letters
   * List dead-lettered jobs with optional ?sourceQueue= filter.
   * Query: ?sourceQueue=apex-enrichment&start=0&end=49
   */
  app.get("/api/admin/dead-letters", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const { getDeadLetterJobs } = await import("../queues/queueFactory");
    const start       = parseInt(String(req.query.start || "0"), 10);
    const end         = parseInt(String(req.query.end   || "49"), 10);
    const sourceQueue = req.query.sourceQueue as string | undefined;

    const result = await getDeadLetterJobs({ start, end, sourceQueue });
    res.json(result);
  }));

  /**
   * POST /api/admin/dead-letters/:jobId/replay
   * Replay a single dead-lettered job back to its source queue.
   */
  app.post("/api/admin/dead-letters/:jobId/replay", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const jobId = String(req.params.jobId ?? "");
    if (!jobId) return res.status(400).json({ error: "jobId required" });

    const { replayDeadLetterJob } = await import("../queues/queueFactory");
    const result = await replayDeadLetterJob(jobId);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ ok: true, newJobId: result.newJobId, replayed: jobId });
  }));

  /**
   * POST /api/admin/dead-letters/replay-all
   * Replay all DLQ jobs, optionally filtered by ?sourceQueue=
   */
  app.post("/api/admin/dead-letters/replay-all", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const { getDeadLetterJobs, replayDeadLetterJob } = await import("../queues/queueFactory");
    const sourceQueue = req.body.sourceQueue as string | undefined;

    // Fetch up to 500 at a time
    const { jobs } = await getDeadLetterJobs({ start: 0, end: 499, sourceQueue });

    const results = await Promise.allSettled(
      jobs.map(j => replayDeadLetterJob(j.id))
    );

    const replayed = results.filter(r => r.status === "fulfilled" && (r as any).value?.ok).length;
    const failed   = results.length - replayed;

    res.json({ ok: true, replayed, failed, total: results.length });
  }));
}
