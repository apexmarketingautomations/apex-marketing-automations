import { Router } from "express";
import crypto from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { db } from "../db";
import { agentWorkerJobs, agentWorkerLogs, ownerUnlocks, subAccounts } from "@shared/schema";
import type { AgentWorkerJob } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { z } from "zod";
import type { Express } from "express";

const execAsync = promisify(exec);

const AGENT_POLL_SECS = Math.max(1, parseInt(process.env.AGENT_POLL_SECS || "60", 10));
const POLL_INTERVAL_MS = AGENT_POLL_SECS * 1000;
const AGENT_MAX_CONCURRENCY = Math.max(1, parseInt(process.env.AGENT_MAX_CONCURRENCY || "2", 10));
const AGENT_MAX_RUNTIME = Math.max(10, parseInt(process.env.AGENT_MAX_RUNTIME || "120", 10));

let activeJobs = 0;

interface CommandConfig {
  description: string;
  script: string;
  timeout_seconds: number;
  requires_unlock: boolean;
}

interface CommandRegistry {
  commands: Record<string, CommandConfig>;
}

const webhookBodySchema = z.object({
  job_type: z.string().min(1),
  payload: z.record(z.unknown()).optional().default({}),
  created_by: z.string().min(1),
  sub_account_id: z.number().int().positive().optional(),
});

type WebhookBody = z.infer<typeof webhookBodySchema>;

interface JobPayload {
  sub_account_id?: number;
  owner_unlock_token?: string;
  [key: string]: unknown;
}

function loadCommandRegistry(): CommandRegistry {
  const configPath = path.resolve(process.cwd(), "agent_commands.json");
  const raw = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as CommandRegistry;
}

function resolveSubAccountId(body: WebhookBody): number | null {
  const topLevel = body.sub_account_id;
  const payloadLevel = typeof body.payload?.sub_account_id === "number"
    ? body.payload.sub_account_id
    : undefined;
  if (topLevel != null && payloadLevel != null && topLevel !== payloadLevel) {
    return -1;
  }
  return topLevel ?? payloadLevel ?? null;
}

function getJobPayload(job: AgentWorkerJob): JobPayload {
  if (job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)) {
    return job.payload as JobPayload;
  }
  return {};
}

async function writeJobLog(jobId: number, level: string, message: string, metadata?: Record<string, unknown>) {
  try {
    await db.insert(agentWorkerLogs).values({ jobId, level, message, metadata: metadata || null });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[AGENT-WORKER] Failed to write job log: ${errMsg}`);
  }
}

async function isProtectedAccount(subAccountId: number): Promise<boolean> {
  const [account] = await db
    .select({ isProtected: subAccounts.isProtected })
    .from(subAccounts)
    .where(eq(subAccounts.id, subAccountId))
    .limit(1);
  return account?.isProtected === true;
}

async function validateUnlockExists(subAccountId: number, purpose: string, token?: string): Promise<{ valid: boolean; error?: string }> {
  if (!token) {
    return { valid: false, error: "owner_unlock_token is required for this operation" };
  }
  const [unlock] = await db
    .select()
    .from(ownerUnlocks)
    .where(
      and(
        eq(ownerUnlocks.subAccountId, subAccountId),
        eq(ownerUnlocks.used, false),
        eq(ownerUnlocks.purpose, purpose),
        eq(ownerUnlocks.token, token)
      )
    )
    .limit(1);
  if (!unlock) {
    return { valid: false, error: `No matching unused owner_unlock found for purpose=${purpose}` };
  }
  if (new Date(unlock.expiresAt) < new Date()) {
    return { valid: false, error: "owner_unlock has expired" };
  }
  return { valid: true };
}

async function executeJob(job: AgentWorkerJob) {
  activeJobs++;
  try {
    await executeJobInner(job);
  } finally {
    activeJobs--;
  }
}

async function executeJobInner(job: AgentWorkerJob) {
  const registry = loadCommandRegistry();
  const commandConfig = registry.commands[job.jobType];

  if (!commandConfig) {
    const errMsg = `Unknown job type: ${job.jobType}`;
    await db.update(agentWorkerJobs).set({ status: "failed", error: errMsg, completedAt: new Date() }).where(eq(agentWorkerJobs.id, job.id));
    await writeJobLog(job.id, "error", errMsg);
    return;
  }

  const payload = getJobPayload(job);
  const subAccountId = job.subAccountId ?? payload.sub_account_id ?? null;

  if (subAccountId) {
    const prot = await isProtectedAccount(subAccountId);
    if (prot) {
      if (commandConfig.requires_unlock) {
        const unlockToken = payload.owner_unlock_token;
        const unlockResult = await validateUnlockExists(subAccountId, job.jobType, unlockToken);
        if (!unlockResult.valid) {
          const errMsg = `Rejected: sub_account ${subAccountId} is protected and unlock failed: ${unlockResult.error}`;
          await db.update(agentWorkerJobs).set({ status: "failed", error: errMsg, completedAt: new Date() }).where(eq(agentWorkerJobs.id, job.id));
          await writeJobLog(job.id, "error", errMsg);
          return;
        }
      } else {
        const errMsg = `Rejected: sub_account ${subAccountId} is protected`;
        await db.update(agentWorkerJobs).set({ status: "failed", error: errMsg, completedAt: new Date() }).where(eq(agentWorkerJobs.id, job.id));
        await writeJobLog(job.id, "error", errMsg);
        return;
      }
    }
  }

  if (commandConfig.requires_unlock && subAccountId) {
    const unlockToken = payload.owner_unlock_token;
    const unlockResult = await validateUnlockExists(subAccountId, job.jobType, unlockToken);
    if (!unlockResult.valid) {
      const errMsg = `Rejected: ${unlockResult.error}`;
      await db.update(agentWorkerJobs).set({ status: "failed", error: errMsg, completedAt: new Date() }).where(eq(agentWorkerJobs.id, job.id));
      await writeJobLog(job.id, "error", errMsg);
      return;
    }
  }

  await writeJobLog(job.id, "info", `Starting execution: ${job.jobType}`, { payload: job.payload as Record<string, unknown> });

  const commandTimeout = commandConfig.timeout_seconds || AGENT_MAX_RUNTIME;
  const effectiveTimeout = Math.min(commandTimeout, AGENT_MAX_RUNTIME);
  const timeoutMs = effectiveTimeout * 1000;
  const env = {
    ...process.env,
    AGENT_JOB_ID: String(job.id),
    AGENT_JOB_PAYLOAD: JSON.stringify(job.payload),
    AGENT_SUB_ACCOUNT_ID: String(subAccountId || ""),
  };

  try {
    const { stdout, stderr } = await execAsync(commandConfig.script, {
      timeout: timeoutMs,
      cwd: process.cwd(),
      env,
      maxBuffer: 5 * 1024 * 1024,
    });
    const result = { stdout: stdout?.substring(0, 10000), stderr: stderr?.substring(0, 5000) };
    await db.update(agentWorkerJobs).set({ status: "completed", result, completedAt: new Date() }).where(eq(agentWorkerJobs.id, job.id));
    await writeJobLog(job.id, "info", `Job completed successfully`, result);
    console.log(`[AGENT-WORKER] Job #${job.id} (${job.jobType}) completed`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message.substring(0, 2000) : String(err);
    const currentAttempts = job.attempts;
    if (currentAttempts < job.maxAttempts) {
      await db.update(agentWorkerJobs).set({ status: "pending", error: errMsg }).where(eq(agentWorkerJobs.id, job.id));
      await writeJobLog(job.id, "warn", `Attempt ${currentAttempts}/${job.maxAttempts} failed, will retry`, { error: errMsg });
      console.log(`[AGENT-WORKER] Job #${job.id} failed attempt ${currentAttempts}/${job.maxAttempts}`);
    } else {
      await db.update(agentWorkerJobs).set({ status: "failed", error: errMsg, completedAt: new Date() }).where(eq(agentWorkerJobs.id, job.id));
      await writeJobLog(job.id, "error", `Job failed after ${currentAttempts} attempts`, { error: errMsg });
      console.error(`[AGENT-WORKER] Job #${job.id} (${job.jobType}) failed permanently`);
    }
  }
}

async function claimPendingJobs(batchLimit: number): Promise<AgentWorkerJob[]> {
  const result = await db.execute(
    sql`UPDATE agent_worker_jobs
        SET status = 'running', started_at = NOW(), attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM agent_worker_jobs
          WHERE status = 'pending'
          ORDER BY created_at ASC
          LIMIT ${batchLimit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *`
  );
  if (!result.rows || result.rows.length === 0) return [];
  return result.rows.map((row) => ({
    id: row.id as number,
    jobType: row.job_type as string,
    payload: row.payload,
    status: row.status as string,
    createdBy: row.created_by as string,
    subAccountId: row.sub_account_id as number | null,
    result: row.result,
    error: row.error as string | null,
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    startedAt: row.started_at as Date | null,
    completedAt: row.completed_at as Date | null,
    createdAt: row.created_at as Date,
  }));
}

async function pollForJobs() {
  if (activeJobs >= AGENT_MAX_CONCURRENCY) {
    return;
  }

  try {
    const slotsAvailable = AGENT_MAX_CONCURRENCY - activeJobs;
    const batchLimit = Math.min(slotsAvailable, 5);

    const jobs = await claimPendingJobs(batchLimit);

    if (jobs.length > 0) {
      const promises = jobs.map((job) => executeJob(job));
      await Promise.all(promises);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[AGENT-WORKER] Poll error: ${errMsg}`);
  }
}

export function registerAgentWorkerRoutes(app: Express) {
  const AGENT_SECRET = process.env.AGENT_SECRET;
  const DISABLE_BACKGROUND_WORKERS = process.env.DISABLE_BACKGROUND_WORKERS === "true";

  if (!AGENT_SECRET) {
    console.warn("[AGENT-WORKER] AGENT_SECRET not set — agent webhook will reject all requests");
  }

  const rawBodyStore = new WeakMap<Express["request"], Buffer>();

  app.post("/api/agent/tasks", (req, res, next) => {
    if (rawBodyStore.has(req)) return next();
    let chunks: Buffer[] = [];
    const origJson = req.body;
    const rawStr = JSON.stringify(origJson);
    rawBodyStore.set(req, Buffer.from(rawStr, "utf8"));
    next();
  }, async (req, res) => {
    const rawBody = rawBodyStore.get(req) || Buffer.from(JSON.stringify(req.body), "utf8");

    const signature = req.headers["x-agent-signature"] as string | undefined;
    if (!AGENT_SECRET || !signature) {
      return res.status(401).json({ error: "Invalid or missing HMAC signature" });
    }

    try {
      const expected = "sha256=" + crypto.createHmac("sha256", AGENT_SECRET).update(rawBody).digest("hex");
      const expectedBuf = Buffer.from(expected);
      const sigBuf = Buffer.from(signature);
      if (expectedBuf.length !== sigBuf.length || !crypto.timingSafeEqual(expectedBuf, sigBuf)) {
        return res.status(401).json({ error: "Invalid or missing HMAC signature" });
      }
    } catch (err) {
      console.warn("[AGENTWORKER] caught:", err instanceof Error ? err.message : err);
      return res.status(401).json({ error: "Invalid or missing HMAC signature" });
    }

    const parseResult = webhookBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid request body", details: parseResult.error.flatten().fieldErrors });
    }

    const body = parseResult.data;

    let registry: CommandRegistry;
    try {
      registry = loadCommandRegistry();
    } catch (err) {
      console.warn("[AGENTWORKER] caught:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "Failed to load command registry" });
    }

    if (!registry.commands[body.job_type]) {
      return res.status(400).json({ error: `Unknown job type: ${body.job_type}` });
    }

    const subAccountId = resolveSubAccountId(body);
    if (subAccountId === -1) {
      return res.status(400).json({ error: "sub_account_id mismatch between top-level and payload" });
    }

    if (subAccountId) {
      const prot = await isProtectedAccount(subAccountId);
      if (prot) {
        const cmd = registry.commands[body.job_type];
        const unlockToken = typeof body.payload?.owner_unlock_token === "string" ? body.payload.owner_unlock_token : undefined;
        if (cmd?.requires_unlock && unlockToken) {
          const unlockCheck = await validateUnlockExists(subAccountId, body.job_type, unlockToken);
          if (!unlockCheck.valid) {
            return res.status(403).json({ error: `Sub-account ${subAccountId} is protected and unlock failed: ${unlockCheck.error}` });
          }
        } else {
          return res.status(403).json({ error: `Sub-account ${subAccountId} is protected` });
        }
      }
    }

    try {
      const [job] = await db.insert(agentWorkerJobs).values({
        jobType: body.job_type,
        payload: body.payload || {},
        createdBy: body.created_by,
        subAccountId: subAccountId,
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
      }).returning();

      await writeJobLog(job.id, "info", `Job enqueued via webhook`, { job_type: body.job_type, created_by: body.created_by, sub_account_id: subAccountId ?? undefined });
      console.log(`[AGENT-WORKER] Job #${job.id} enqueued: ${body.job_type}`);

      return res.status(201).json({ ok: true, job_id: job.id, status: "pending" });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[AGENT-WORKER] Enqueue error: ${errMsg}`);
      return res.status(500).json({ error: "Failed to enqueue job" });
    }
  });

  app.get("/api/agent/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  if (DISABLE_BACKGROUND_WORKERS) {
    console.log(`[AGENT-WORKER] Routes mounted on main app, poll loop DISABLED (DISABLE_BACKGROUND_WORKERS=true)`);
    return;
  }

  console.log(`[AGENT-WORKER] Configuration:`);
  console.log(`[AGENT-WORKER]   AGENT_POLL_SECS=${AGENT_POLL_SECS} (interval: ${POLL_INTERVAL_MS}ms)`);
  console.log(`[AGENT-WORKER]   AGENT_MAX_CONCURRENCY=${AGENT_MAX_CONCURRENCY}`);
  console.log(`[AGENT-WORKER]   AGENT_MAX_RUNTIME=${AGENT_MAX_RUNTIME}s`);
  console.log(`[AGENT-WORKER] Routes mounted on main app, starting poll loop (${POLL_INTERVAL_MS}ms)`);
  setInterval(pollForJobs, POLL_INTERVAL_MS);
}
