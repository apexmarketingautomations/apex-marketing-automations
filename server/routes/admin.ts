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

  // ── Pipeline Metrics endpoint ────────────────────────────────────────────────

  /**
   * GET /api/admin/pipeline-metrics
   * Returns a unified snapshot of all BullMQ queue depths, DLQ status,
   * and Redis availability. Admin-only.
   *
   * Response shape:
   * {
   *   timestamp: string,
   *   redisAvailable: boolean,
   *   queues: QueueHealthSnapshot[],
   *   dlq: { waiting: number; failed: number; jobs: DeadLetterJob[] },
   *   totals: { waiting: number; active: number; failed: number; delayed: number }
   * }
   */
  app.get("/api/admin/pipeline-metrics", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const {
      getQueueHealthSnapshot,
      getDeadLetterJobs,
      isRedisAvailable,
      QUEUE_NAMES,
    } = await import("../queues/queueFactory");

    const redisAvailable = isRedisAvailable();

    if (!redisAvailable) {
      return res.json({
        timestamp: new Date().toISOString(),
        redisAvailable: false,
        queues: [],
        dlq: { waiting: 0, failed: 0, jobs: [] },
        totals: { waiting: 0, active: 0, failed: 0, delayed: 0 },
      });
    }

    const [allQueues, dlqResult] = await Promise.all([
      getQueueHealthSnapshot(),
      getDeadLetterJobs({ start: 0, end: 49 }),
    ]);

    // Separate DLQ from operational queues
    const operationalQueues = allQueues.filter(q => q.name !== QUEUE_NAMES.DEAD_LETTER);
    const dlqSnapshot       = allQueues.find(q => q.name === QUEUE_NAMES.DEAD_LETTER);

    // Aggregate totals across all operational queues
    const totals = operationalQueues.reduce(
      (acc, q) => ({
        waiting: acc.waiting + q.waiting,
        active:  acc.active  + q.active,
        failed:  acc.failed  + q.failed,
        delayed: acc.delayed + q.delayed,
      }),
      { waiting: 0, active: 0, failed: 0, delayed: 0 }
    );

    res.json({
      timestamp: new Date().toISOString(),
      redisAvailable: true,
      queues: operationalQueues,
      dlq: {
        waiting: dlqSnapshot?.waiting ?? 0,
        failed:  dlqSnapshot?.failed  ?? 0,
        jobs:    dlqResult.jobs,
        total:   dlqResult.total,
      },
      totals,
    });
  }));

  // ── DB Integrity Command Center ──────────────────────────────────────────────

  /**
   * GET /api/admin/db-health
   * Returns the last boot validation result + a live migration check.
   * Fast: uses the cached boot result, does not re-run full scans.
   */
  app.get("/api/admin/db-health", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const { getLastBootResult } = await import("../db/bootValidator");
    const bootResult = getLastBootResult();

    res.json({
      bootValidation: bootResult ?? { status: "not_run", note: "Server restarted without boot validation — restart to trigger" },
      timestamp: new Date().toISOString(),
    });
  }));

  /**
   * GET /api/admin/schema-audit
   * Runs migration verification + schema drift detection.
   */
  app.get("/api/admin/schema-audit", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const { verifyMigrations, detectSchemaDrift } = await import("../db/migrationVerifier");
    const [migrations, schemaDrift] = await Promise.all([
      verifyMigrations(),
      detectSchemaDrift(),
    ]);

    res.json({ migrations, schemaDrift, generatedAt: new Date().toISOString() });
  }));

  /**
   * GET /api/admin/orphan-scan
   * Scans for orphaned records across all FK relationships.
   * Expensive on large datasets — runs in ~5s on typical sizes.
   */
  app.get("/api/admin/orphan-scan", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const { detectOrphans } = await import("../db/orphanDetector");
    const report = await detectOrphans();
    res.json(report);
  }));

  /**
   * GET /api/admin/tenant-integrity
   * Scans all tenant-linked tables for null/invalid subAccountId values.
   */
  app.get("/api/admin/tenant-integrity", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const { auditTenantIntegrity } = await import("../db/tenantIntegrity");
    const report = await auditTenantIntegrity();
    res.json(report);
  }));

  /**
   * GET /api/admin/reconciliation-report
   * Detects duplicate contacts, stale enrichment states, stuck crash reports,
   * orphaned signals, and other data consistency issues.
   */
  app.get("/api/admin/reconciliation-report", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const { runReconciliationScan } = await import("../db/reconciliationEngine");
    const report = await runReconciliationScan();
    res.json(report);
  }));

  /**
   * GET /api/admin/quarantine-status
   * Returns current quarantine log — all pending quarantined records.
   */
  app.get("/api/admin/quarantine-status", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const { getQuarantineStatus } = await import("../db/quarantineCoordinator");
    const report = await getQuarantineStatus();
    res.json(report);
  }));

  /**
   * POST /api/admin/run-integrity-repair
   * Non-destructive repair actions. All actions are logged to audit_logs.
   *
   * Supported actions:
   * - quarantine_record: { action, sourceTable, sourceId, reason }
   * - restore_quarantine: { action, quarantineId }
   * - reset_stale_enrichment: { action } — resets skip_trace_status='pending' > 24h → null
   * - reset_stuck_crash_reports: { action } — resets crash_reports PROCESSING > 2h → PENDING
   */
  app.post("/api/admin/run-integrity-repair", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const schema = z.discriminatedUnion("action", [
      z.object({
        action:      z.literal("quarantine_record"),
        sourceTable: z.string().min(1),
        sourceId:    z.number().int().positive(),
        reason:      z.string().min(1),
      }),
      z.object({
        action:        z.literal("restore_quarantine"),
        quarantineId:  z.number().int().positive(),
      }),
      z.object({ action: z.literal("reset_stale_enrichment") }),
      z.object({ action: z.literal("reset_stuck_crash_reports") }),
    ]);

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const operatorId = (user?.claims?.sub ?? user?.id ?? "unknown");

    switch (parsed.data.action) {
      case "quarantine_record": {
        const { quarantineRecord } = await import("../db/quarantineCoordinator");
        const result = await quarantineRecord({
          sourceTable:   parsed.data.sourceTable,
          sourceId:      parsed.data.sourceId,
          reason:        parsed.data.reason,
          quarantinedBy: operatorId,
        });
        await import("../storage").then(({ storage }) =>
          storage.createAuditLog({
            action:      "INTEGRITY_REPAIR_QUARANTINE",
            performedBy: operatorId,
            details:     { ...parsed.data, quarantineId: result.quarantineId },
          }).catch(() => {})
        );
        return res.json({ ok: result.ok, quarantineId: result.quarantineId, error: result.error });
      }

      case "restore_quarantine": {
        const { restoreRecord } = await import("../db/quarantineCoordinator");
        const result = await restoreRecord(parsed.data.quarantineId, operatorId);
        await import("../storage").then(({ storage }) =>
          storage.createAuditLog({
            action:      "INTEGRITY_REPAIR_RESTORE",
            performedBy: operatorId,
            details:     { quarantineId: parsed.data.quarantineId },
          }).catch(() => {})
        );
        return res.json({ ok: result.ok, error: result.error });
      }

      case "reset_stale_enrichment": {
        const { sql } = await import("drizzle-orm");
        const { db }  = await import("../db");
        const cutoff  = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const result  = await db.execute(sql.raw(`
          UPDATE contacts
          SET skip_trace_status = NULL
          WHERE skip_trace_status = 'pending'
            AND enrichment_attempted_at < '${cutoff}'
        `));
        const affected = (result as any).rowCount ?? 0;
        await import("../storage").then(({ storage }) =>
          storage.createAuditLog({
            action:      "INTEGRITY_REPAIR_RESET_ENRICHMENT",
            performedBy: operatorId,
            details:     { affected, cutoff },
          }).catch(() => {})
        );
        console.log(`[INTEGRITY-REPAIR] reset_stale_enrichment: ${affected} contacts reset`);
        return res.json({ ok: true, affected });
      }

      case "reset_stuck_crash_reports": {
        const { sql } = await import("drizzle-orm");
        const { db }  = await import("../db");
        const cutoff  = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const result  = await db.execute(sql.raw(`
          UPDATE crash_reports
          SET status = 'PENDING', updated_at = NOW()
          WHERE status = 'PROCESSING'
            AND updated_at < '${cutoff}'
        `));
        const affected = (result as any).rowCount ?? 0;
        await import("../storage").then(({ storage }) =>
          storage.createAuditLog({
            action:      "INTEGRITY_REPAIR_RESET_CRASH_REPORTS",
            performedBy: operatorId,
            details:     { affected, cutoff },
          }).catch(() => {})
        );
        console.log(`[INTEGRITY-REPAIR] reset_stuck_crash_reports: ${affected} reports reset to PENDING`);
        return res.json({ ok: true, affected });
      }
    }
  }));
}
