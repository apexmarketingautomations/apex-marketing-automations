/**
 * Emergency Shell Agent — OpenAI-powered interactive terminal for site-down recovery.
 *
 * Run with: npx tsx scripts/emergency-agent.ts
 *
 * Works independently of the Express server. Connects directly to PostgreSQL via
 * DATABASE_URL. All actions are logged locally to logs/emergency-agent-audit.log.
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import pg from "pg";
import OpenAI from "openai";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DbRow {
  [key: string]: unknown;
}

interface AuditDetails {
  [key: string]: unknown;
}

// ─── Config & env checks ─────────────────────────────────────────────────────

const OPENAI_KEY = process.env.OPENAI_APEX_INT_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const LOG_DIR = path.resolve(process.cwd(), "logs");
const AUDIT_LOG_PATH = path.join(LOG_DIR, "emergency-agent-audit.log");
const MODEL = "gpt-4o";

if (!OPENAI_KEY) {
  console.error("\n[EMERGENCY AGENT] FATAL: OPENAI_APEX_INT_KEY is not set.");
  console.error("  Set it in your environment secrets and re-run.\n");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("\n[EMERGENCY AGENT] FATAL: DATABASE_URL is not set.");
  console.error("  Cannot connect to the database without it.\n");
  process.exit(1);
}

// ─── Audit log ────────────────────────────────────────────────────────────────

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function auditLog(action: string, details: AuditDetails = {}): void {
  ensureLogDir();
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    action,
    ...details,
  });
  fs.appendFileSync(AUDIT_LOG_PATH, entry + "\n");
}

// ─── Direct DB connection (independent of Express) ────────────────────────────

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: DATABASE_URL!, max: 3 });
  }
  return pool;
}

async function queryDb(sql: string, params: unknown[] = []): Promise<pg.QueryResult<DbRow>> {
  return getPool().query(sql, params);
}

async function closePool(): Promise<void> {
  if (pool) {
    await pool.end().catch((_ignored: unknown) => undefined);
    pool = null;
  }
}

// ─── SQL safety guard ─────────────────────────────────────────────────────────

/**
 * Strictly enforces SELECT-only SQL for the diagnostics tool.
 * Rejects any statement that is not a SELECT (or CTEs that begin a SELECT).
 * Rejects multi-statement input (semicolons that could end a SELECT and begin a write).
 */
function enforceReadOnlySql(sql: string): { safe: true } | { safe: false; reason: string } {
  const stripped = sql.trim().replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "").trim();
  const upper = stripped.toUpperCase();

  // Block multi-statement queries entirely
  if (stripped.includes(";") && stripped.indexOf(";") < stripped.length - 1) {
    return { safe: false, reason: "Multi-statement SQL is not allowed. Only single SELECT queries are permitted." };
  }

  // Must start with SELECT or WITH (CTE), and the CTE must resolve to a SELECT
  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
    return {
      safe: false,
      reason: `Only SELECT queries are permitted in diagnostics. Detected: ${upper.split(/\s/)[0]}`,
    };
  }

  // Block write keywords anywhere in the query
  const writeKeywords = ["INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE", "ALTER", "CREATE", "REPLACE", "MERGE", "COPY", "EXECUTE", "CALL", "DO "];
  for (const kw of writeKeywords) {
    const pattern = new RegExp(`\\b${kw}\\b`);
    if (pattern.test(upper)) {
      return {
        safe: false,
        reason: `Write keyword "${kw}" detected in query. Only read-only SELECT queries are permitted in diagnostics.`,
      };
    }
  }

  return { safe: true };
}

// ─── Tool implementations ─────────────────────────────────────────────────────

async function toolSystemHealthCheck(): Promise<string> {
  auditLog("system_health_check");
  const lines: string[] = ["=== System Health Check ===\n"];

  // DB connectivity
  try {
    await queryDb("SELECT 1");
    lines.push("✓ Database: Connected");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`✗ Database: UNREACHABLE — ${msg}`);
  }

  // Table row counts (top 10)
  try {
    const res = await queryDb(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
    const tableNames: string[] = res.rows.map((r) => String(r.tablename));
    const counts: Record<string, number> = {};
    for (const t of tableNames) {
      try {
        const cr = await queryDb(`SELECT COUNT(*) as c FROM "${t}"`);
        counts[t] = parseInt(String(cr.rows[0].c), 10);
      } catch {
        counts[t] = -1;
      }
    }
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    lines.push(`\nTop 10 tables by row count:`);
    for (const [name, count] of sorted) {
      lines.push(`  ${name}: ${count >= 0 ? count : "error"}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`  (could not list tables: ${msg})`);
  }

  // Env var presence check
  const envVars: Array<[string, string[]]> = [
    ["OpenAI", ["OPENAI_APEX_INT_KEY"]],
    ["Twilio", ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]],
    ["VAPI", ["VAPI_PRIVATE_KEY_APEX", "VAPI_PRIVATE_KEY", "apex_private_vapi"]],
    ["Stripe", ["STRIPE_API_SECRET", "STRIPE_SECRET_KEY"]],
    ["Meta", ["META_APP_ID", "META_APP_SECRET"]],
    ["Gemini", ["Gemini_API_Key_saas"]],
    ["Agent Secret", ["AGENT_SECRET"]],
  ];

  lines.push("\nEnvironment secrets:");
  for (const [label, vars] of envVars) {
    const found = vars.find((v) => !!process.env[v]);
    if (found) {
      lines.push(`  ✓ ${label}: present (${found})`);
    } else {
      lines.push(`  ✗ ${label}: MISSING (expected: ${vars.join(" or ")})`);
    }
  }

  // Stuck/failed job counts
  const jobTables: Array<[string, string, string]> = [
    ["agent_worker_jobs", "status IN ('running','pending')", "status = 'failed' AND created_at > NOW() - INTERVAL '24 hours'"],
    ["content_publishing_jobs", "status IN ('queued','running')", "status = 'failed' AND created_at > NOW() - INTERVAL '24 hours'"],
  ];

  for (const [table, activeClause, failedClause] of jobTables) {
    try {
      const activeRes = await queryDb(`SELECT COUNT(*) as c FROM ${table} WHERE ${activeClause}`);
      const failedRes = await queryDb(`SELECT COUNT(*) as c FROM ${table} WHERE ${failedClause}`);
      lines.push(`\n${table} — active: ${activeRes.rows[0].c}, failed (24h): ${failedRes.rows[0].c}`);
    } catch {
      lines.push(`\n${table}: (table not found or query failed)`);
    }
  }

  try {
    const smsRetry = await queryDb(`SELECT COUNT(*) as c FROM sms_retry_queue WHERE status = 'pending'`);
    lines.push(`sms_retry_queue pending: ${smsRetry.rows[0].c}`);
  } catch {
    lines.push("sms_retry_queue: (table not found or query failed)");
  }

  try {
    const crashStuck = await queryDb(
      `SELECT COUNT(*) as c FROM crash_reports WHERE status = 'PENDING' AND locked_at IS NOT NULL AND locked_at < NOW() - INTERVAL '15 minutes'`
    );
    const crashPending = await queryDb(
      `SELECT COUNT(*) as c FROM crash_reports WHERE status = 'PENDING' AND created_at < NOW() - INTERVAL '30 minutes' AND locked_at IS NULL`
    );
    lines.push(`crash_reports — stuck (locked >15min): ${crashStuck.rows[0].c}, stale pending: ${crashPending.rows[0].c}`);
  } catch {
    lines.push("crash_reports: (table not found or query failed)");
  }

  return lines.join("\n");
}

async function toolDatabaseDiagnostics(args: { table?: string; query?: string; limit?: number }): Promise<string> {
  auditLog("database_diagnostics", { table: args.table, query: args.query });

  if (args.query) {
    const safetyCheck = enforceReadOnlySql(args.query);
    if (!safetyCheck.safe) {
      return `Query rejected: ${"reason" in safetyCheck ? safetyCheck.reason : "Unknown reason"}`;
    }
    try {
      const res = await queryDb(args.query);
      return `Query returned ${res.rows.length} rows:\n${JSON.stringify(res.rows.slice(0, 50), null, 2)}`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Query error: ${msg}`;
    }
  }

  if (args.table) {
    const safeName = args.table.replace(/[^a-z0-9_]/gi, "");
    if (safeName !== args.table) {
      return `Invalid table name: "${args.table}". Only alphanumeric characters and underscores are allowed.`;
    }
    try {
      const lim = Math.min(args.limit || 20, 100);
      const res = await queryDb(`SELECT * FROM "${safeName}" ORDER BY id DESC LIMIT $1`, [lim]);
      return `Latest ${lim} rows from ${safeName}:\n${JSON.stringify(res.rows, null, 2)}`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error reading table ${safeName}: ${msg}`;
    }
  }

  // Default: show recent system_logs errors
  try {
    const res = await queryDb(
      `SELECT id, timestamp, severity, module, message FROM system_logs ORDER BY timestamp DESC LIMIT 20`
    );
    return `Recent system_logs (last 20):\n${JSON.stringify(res.rows, null, 2)}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Could not read system_logs: ${msg}`;
  }
}

async function toolFindStuckJobs(): Promise<string> {
  auditLog("find_stuck_jobs");
  const lines: string[] = [];

  // Agent worker jobs stuck running > 10 min
  try {
    const res = await queryDb(`
      SELECT id, job_type, status, attempts, max_attempts, created_at, started_at, error
      FROM agent_worker_jobs
      WHERE (status = 'running' AND started_at < NOW() - INTERVAL '10 minutes')
         OR (status = 'pending' AND created_at < NOW() - INTERVAL '30 minutes')
      ORDER BY created_at ASC
      LIMIT 20
    `);
    lines.push(`Stuck/stale agent_worker_jobs (${res.rows.length}):`);
    for (const r of res.rows) {
      lines.push(`  #${r.id} ${r.job_type} [${r.status}] attempts=${r.attempts}/${r.max_attempts} started=${r.started_at} error=${r.error ?? "none"}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`agent_worker_jobs: error — ${msg}`);
  }

  // Content publishing jobs
  try {
    const res = await queryDb(`
      SELECT id, platform, status, attempt_count, max_attempts, started_at, error_message, lock_owner, lock_expires_at
      FROM content_publishing_jobs
      WHERE (status = 'running' AND started_at < NOW() - INTERVAL '15 minutes')
         OR (status = 'queued' AND created_at < NOW() - INTERVAL '60 minutes')
      ORDER BY created_at ASC
      LIMIT 20
    `);
    lines.push(`\nStuck/stale content_publishing_jobs (${res.rows.length}):`);
    for (const r of res.rows) {
      lines.push(`  #${r.id} [${r.platform}] ${r.status} attempts=${r.attempt_count}/${r.max_attempts} lock=${r.lock_owner ?? "none"} lockExpires=${r.lock_expires_at ?? "n/a"} error=${r.error_message ?? "none"}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`\ncontent_publishing_jobs: error — ${msg}`);
  }

  // Crash report jobs — locked but not progressing
  try {
    const res = await queryDb(`
      SELECT id, report_number, status, retry_count, service_failure_count, locked_at, locked_by, created_at
      FROM crash_reports
      WHERE (status = 'PENDING' AND locked_at IS NOT NULL AND locked_at < NOW() - INTERVAL '15 minutes')
         OR (status = 'PENDING' AND locked_at IS NULL AND created_at < NOW() - INTERVAL '2 hours')
      ORDER BY created_at ASC
      LIMIT 20
    `);
    lines.push(`\nStuck/stale crash_reports (${res.rows.length}):`);
    for (const r of res.rows) {
      lines.push(`  #${r.id} ${r.report_number} [${r.status}] retries=${r.retry_count} failures=${r.service_failure_count} locked_by=${r.locked_by ?? "none"} locked_at=${r.locked_at ?? "n/a"}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`\ncrash_reports: error — ${msg}`);
  }

  // SMS retry queue stale
  try {
    const res = await queryDb(`
      SELECT id, sub_account_id, contact_phone, retry_count, status, created_at
      FROM sms_retry_queue
      WHERE status = 'pending' AND created_at < NOW() - INTERVAL '2 hours'
      LIMIT 20
    `);
    lines.push(`\nStale sms_retry_queue entries (${res.rows.length}):`);
    for (const r of res.rows) {
      lines.push(`  #${r.id} sub=${r.sub_account_id} phone=${r.contact_phone} retries=${r.retry_count} created=${r.created_at}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`\nsms_retry_queue: error — ${msg}`);
  }

  return lines.join("\n") || "No stuck jobs found.";
}

async function toolResetStuckJobs(args: {
  job_type: "agent_worker" | "content_publishing" | "crash_reports" | "sms_retry";
  dry_run?: boolean;
}): Promise<string> {
  const isDry = args.dry_run !== false;
  auditLog("reset_stuck_jobs", { job_type: args.job_type, dry_run: isDry });

  if (args.job_type === "agent_worker") {
    const preview = await queryDb(`
      SELECT id FROM agent_worker_jobs
      WHERE status = 'running' AND started_at < NOW() - INTERVAL '10 minutes'
    `);
    const ids = preview.rows.map((r) => Number(r.id));
    if (ids.length === 0) return "No stuck agent_worker_jobs found.";
    if (isDry) return `DRY RUN: Would reset ${ids.length} stuck agent_worker_jobs to 'pending': ids=${ids.join(", ")}`;
    await queryDb(`
      UPDATE agent_worker_jobs
      SET status = 'pending', started_at = NULL, error = 'Reset by emergency agent'
      WHERE id = ANY($1::int[])
    `, [ids]);
    auditLog("reset_stuck_jobs_executed", { job_type: "agent_worker", ids });
    return `Reset ${ids.length} stuck agent_worker_jobs to pending: ${ids.join(", ")}`;
  }

  if (args.job_type === "content_publishing") {
    const preview = await queryDb(`
      SELECT id FROM content_publishing_jobs
      WHERE (status = 'running' AND started_at < NOW() - INTERVAL '15 minutes')
         OR (status = 'queued' AND lock_expires_at IS NOT NULL AND lock_expires_at < NOW())
    `);
    const ids = preview.rows.map((r) => Number(r.id));
    if (ids.length === 0) return "No stuck content_publishing_jobs found.";
    if (isDry) return `DRY RUN: Would reset ${ids.length} stuck content_publishing_jobs to 'queued': ids=${ids.join(", ")}`;
    await queryDb(`
      UPDATE content_publishing_jobs
      SET status = 'queued', lock_owner = NULL, lock_expires_at = NULL,
          started_at = NULL, error_message = 'Reset by emergency agent'
      WHERE id = ANY($1::int[])
    `, [ids]);
    auditLog("reset_stuck_jobs_executed", { job_type: "content_publishing", ids });
    return `Reset ${ids.length} stuck content_publishing_jobs to queued: ${ids.join(", ")}`;
  }

  if (args.job_type === "crash_reports") {
    const preview = await queryDb(`
      SELECT id FROM crash_reports
      WHERE status = 'PENDING' AND locked_at IS NOT NULL AND locked_at < NOW() - INTERVAL '15 minutes'
    `);
    const ids = preview.rows.map((r) => Number(r.id));
    if (ids.length === 0) return "No stuck crash_reports found.";
    if (isDry) return `DRY RUN: Would unlock ${ids.length} stuck crash_reports: ids=${ids.join(", ")}`;
    await queryDb(`
      UPDATE crash_reports
      SET locked_at = NULL, locked_by = NULL
      WHERE id = ANY($1::int[])
    `, [ids]);
    auditLog("reset_stuck_jobs_executed", { job_type: "crash_reports", ids });
    return `Unlocked ${ids.length} stuck crash_reports: ${ids.join(", ")}`;
  }

  if (args.job_type === "sms_retry") {
    const preview = await queryDb(`
      SELECT id FROM sms_retry_queue
      WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours'
    `);
    const ids = preview.rows.map((r) => Number(r.id));
    if (ids.length === 0) return "No stale sms_retry_queue entries found.";
    if (isDry) return `DRY RUN: Would mark ${ids.length} stale SMS retry entries as 'failed': ids=${ids.join(", ")}`;
    await queryDb(`UPDATE sms_retry_queue SET status = 'failed' WHERE id = ANY($1::int[])`, [ids]);
    auditLog("reset_stuck_jobs_executed", { job_type: "sms_retry", ids });
    return `Marked ${ids.length} stale sms_retry_queue entries as failed: ${ids.join(", ")}`;
  }

  return "Unknown job_type. Use: agent_worker, content_publishing, crash_reports, or sms_retry";
}

async function toolRecentActivity(): Promise<string> {
  auditLog("recent_activity");
  const lines: string[] = ["=== Recent Activity Summary ===\n"];

  // Recent messages
  try {
    const res = await queryDb(`
      SELECT id, sub_account_id, direction, channel, status, created_at, contact_phone
      FROM messages ORDER BY created_at DESC LIMIT 10
    `);
    lines.push(`Recent messages (last 10):`);
    for (const r of res.rows) {
      lines.push(`  #${r.id} [${r.channel}/${r.direction}] sub=${r.sub_account_id} phone=${r.contact_phone} status=${r.status} at=${r.created_at}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`Messages: error — ${msg}`);
  }

  // Recent system_logs (errors/warnings)
  try {
    const res = await queryDb(`
      SELECT id, timestamp, severity, module, message
      FROM system_logs
      WHERE severity IN ('error','critical','warn')
      ORDER BY timestamp DESC LIMIT 10
    `);
    lines.push(`\nRecent errors/warnings from system_logs (last 10):`);
    for (const r of res.rows) {
      lines.push(`  [${r.severity}] ${r.timestamp} ${r.module}: ${r.message}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`\nSystem logs: error — ${msg}`);
  }

  // Recent agent_worker_jobs
  try {
    const res = await queryDb(`
      SELECT id, job_type, status, created_by, created_at, error
      FROM agent_worker_jobs ORDER BY created_at DESC LIMIT 10
    `);
    lines.push(`\nRecent agent_worker_jobs (last 10):`);
    for (const r of res.rows) {
      const errSnippet = r.error ? ` err=${String(r.error).substring(0, 80)}` : "";
      lines.push(`  #${r.id} ${r.job_type} [${r.status}] by=${r.created_by} at=${r.created_at}${errSnippet}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`\nAgent worker jobs: error — ${msg}`);
  }

  // Recent content_publishing_jobs
  try {
    const res = await queryDb(`
      SELECT id, platform, status, attempt_count, created_at, error_message
      FROM content_publishing_jobs ORDER BY created_at DESC LIMIT 10
    `);
    lines.push(`\nRecent content_publishing_jobs (last 10):`);
    for (const r of res.rows) {
      const errSnippet = r.error_message ? ` err=${String(r.error_message).substring(0, 80)}` : "";
      lines.push(`  #${r.id} [${r.platform}] ${r.status} attempts=${r.attempt_count} at=${r.created_at}${errSnippet}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`\nContent publishing jobs: error — ${msg}`);
  }

  // Recent crash_reports
  try {
    const res = await queryDb(`
      SELECT id, report_number, status, retry_count, created_at
      FROM crash_reports ORDER BY created_at DESC LIMIT 10
    `);
    lines.push(`\nRecent crash_reports (last 10):`);
    for (const r of res.rows) {
      lines.push(`  #${r.id} ${r.report_number} [${r.status}] retries=${r.retry_count} at=${r.created_at}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`\nCrash reports: error — ${msg}`);
  }

  // Recent webhook events
  try {
    const res = await queryDb(`
      SELECT id, sub_account_id, event_type, url, status, response_status, error, created_at
      FROM webhook_events ORDER BY created_at DESC LIMIT 10
    `);
    lines.push(`\nRecent webhook events (last 10):`);
    for (const r of res.rows) {
      const errSnippet = r.error ? ` err=${String(r.error).substring(0, 60)}` : "";
      lines.push(`  #${r.id} [${r.event_type}] sub=${r.sub_account_id} status=${r.status} http=${r.response_status ?? "n/a"} at=${r.created_at}${errSnippet}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`\nWebhook events: error — ${msg}`);
  }

  return lines.join("\n");
}

async function toolDatabaseBackup(): Promise<string> {
  auditLog("database_backup");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.resolve(process.cwd(), "backups");

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  try {
    const tableRes = await queryDb(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
    const tables: Record<string, number> = {};
    for (const row of tableRes.rows) {
      const t = String(row.tablename);
      try {
        const cr = await queryDb(`SELECT COUNT(*) as c FROM "${t}"`);
        tables[t] = parseInt(String(cr.rows[0].c), 10);
      } catch {
        tables[t] = -1;
      }
    }
    const totalRecords = Object.values(tables).filter((v) => v >= 0).reduce((a, b) => a + b, 0);
    const manifest = {
      timestamp,
      createdAt: new Date().toISOString(),
      createdBy: "emergency-agent",
      databaseUrl: "***REDACTED***",
      tables,
      totalRecords,
    };
    const filePath = path.join(backupDir, `snapshot_${timestamp}.json`);
    fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2));
    auditLog("database_backup_created", { filePath, totalRecords, tableCount: Object.keys(tables).length });
    return `Database snapshot created: ${filePath}\nTables: ${Object.keys(tables).length}, Total records: ${totalRecords}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Backup failed: ${msg}`;
  }
}

async function toolWorkerStatus(): Promise<string> {
  auditLog("worker_status");
  const lines: string[] = ["=== Background Worker Status ===\n"];

  // Agent worker — job activity proxy
  try {
    const res = await queryDb(`
      SELECT status, COUNT(*) as c FROM agent_worker_jobs
      WHERE created_at > NOW() - INTERVAL '1 hour'
      GROUP BY status
    `);
    lines.push("Agent worker (last 1h):");
    if (res.rows.length === 0) {
      lines.push("  No jobs in last hour — worker may be stalled or idle");
    } else {
      for (const r of res.rows) {
        lines.push(`  ${r.status}: ${r.c}`);
      }
    }
    const last = await queryDb(`SELECT completed_at FROM agent_worker_jobs WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1`);
    if (last.rows[0]) lines.push(`  Last completed job: ${last.rows[0].completed_at}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`Agent worker: error — ${msg}`);
  }

  // Content publisher
  try {
    const res = await queryDb(`
      SELECT status, COUNT(*) as c FROM content_publishing_jobs
      WHERE created_at > NOW() - INTERVAL '1 hour'
      GROUP BY status
    `);
    lines.push("\nContent publisher (last 1h):");
    if (res.rows.length === 0) {
      lines.push("  No jobs in last hour — publisher may be stalled or idle");
    } else {
      for (const r of res.rows) lines.push(`  ${r.status}: ${r.c}`);
    }
    const last = await queryDb(`SELECT completed_at FROM content_publishing_jobs WHERE status = 'published' ORDER BY completed_at DESC LIMIT 1`);
    if (last.rows[0]) lines.push(`  Last published: ${last.rows[0].completed_at}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`Content publisher: error — ${msg}`);
  }

  // Crash report worker
  try {
    const res = await queryDb(`
      SELECT status, COUNT(*) as c FROM crash_reports
      WHERE created_at > NOW() - INTERVAL '1 hour'
      GROUP BY status
    `);
    lines.push("\nCrash report worker (last 1h):");
    if (res.rows.length === 0) {
      lines.push("  No crash reports in last hour.");
    } else {
      for (const r of res.rows) lines.push(`  ${r.status}: ${r.c}`);
    }
    const last = await queryDb(`SELECT updated_at FROM crash_reports WHERE status != 'PENDING' ORDER BY updated_at DESC LIMIT 1`);
    if (last.rows[0]) lines.push(`  Last processed: ${last.rows[0].updated_at}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`Crash report worker: error — ${msg}`);
  }

  // SMS retry processor
  try {
    const res = await queryDb(`
      SELECT status, COUNT(*) as c FROM sms_retry_queue
      WHERE created_at > NOW() - INTERVAL '1 hour'
      GROUP BY status
    `);
    lines.push("\nSMS retry processor (last 1h):");
    if (res.rows.length === 0) {
      lines.push("  No SMS retry entries in last hour.");
    } else {
      for (const r of res.rows) lines.push(`  ${r.status}: ${r.c}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`SMS retry processor: error — ${msg}`);
  }

  lines.push(`\nNote: All workers run within the Express server process.`);
  lines.push(`To restart all workers, restart the Express server (Start application workflow).`);

  return lines.join("\n");
}

function toolServiceRestartGuidance(): string {
  auditLog("service_restart_guidance");
  return `=== Service Restart Guidance ===

Main Express Server (all workers included):
  Replit: Click "Run" or restart the "Start application" workflow.
  CLI: npx tsx server/index.ts

Agent Worker (embedded in Express, poll loop):
  Restart Express server — the agent worker poll loop starts automatically.
  Tune: AGENT_POLL_SECS, AGENT_MAX_CONCURRENCY, AGENT_MAX_RUNTIME env vars.

Content Publisher (embedded in Express):
  Restart Express server. Ensure DISABLE_BACKGROUND_WORKERS != "true".

Crash Report Worker (embedded in Express):
  Restart Express server — crash report worker loop starts automatically.

SMS Retry Processor (embedded in Express):
  Restart Express server.

Stuck job recovery (while site is down):
  Agent worker:       "reset stuck agent_worker jobs"
  Content publishing: "reset stuck content_publishing jobs"
  Crash reports:      "reset stuck crash_reports"

Database snapshot:
  "take a database backup" (or run: npx tsx scripts/emergency-database-snapshot.ts)

View audit log:
  cat logs/emergency-agent-audit.log

Useful direct SQL (read-only diagnostic):
  "run SQL: SELECT id, status, job_type, created_at FROM agent_worker_jobs WHERE status='running' ORDER BY created_at LIMIT 10"
`;
}

interface TwilioClient {
  messages: {
    create(params: { body: string; from: string; to: string }): Promise<unknown>;
  };
}

async function toolEmergencyNotification(args: { message: string }): Promise<string> {
  auditLog("emergency_notification", { message: args.message });
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER;

  const logEntry = `[EMERGENCY ALERT ${new Date().toISOString()}] ${args.message}`;
  ensureLogDir();
  fs.appendFileSync(AUDIT_LOG_PATH, logEntry + "\n");

  if (!twilioSid || !twilioToken || !twilioFrom) {
    return `Alert logged to audit file. Twilio SMS not configured (missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER).\nLog entry: ${logEntry}`;
  }

  const ownerPhone = process.env.OWNER_PHONE || process.env.ALERT_PHONE;
  if (!ownerPhone) {
    return `Alert logged. Twilio configured but OWNER_PHONE / ALERT_PHONE not set — cannot send SMS.\nLog entry: ${logEntry}`;
  }

  try {
    const twilioModule = await import("twilio");
    const TwilioConstructor = (twilioModule as { default?: unknown }).default ?? twilioModule;
    const client = (TwilioConstructor as (sid: string, token: string) => TwilioClient)(twilioSid, twilioToken);
    await client.messages.create({
      body: `[APEX EMERGENCY] ${args.message}`,
      from: twilioFrom,
      to: ownerPhone,
    });
    auditLog("sms_sent", { to: ownerPhone, message: args.message });
    return `Emergency alert logged and SMS sent to ${ownerPhone}.\nLog entry: ${logEntry}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Alert logged but SMS failed: ${msg}\nLog entry: ${logEntry}`;
  }
}

// ─── OpenAI tool definitions ──────────────────────────────────────────────────

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "system_health_check",
      description: "Run a full system health check: DB connectivity, table row counts, env var presence for all services (Twilio, OpenAI, Vapi, Stripe, Meta), and stuck/failed job counts across all queues.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "database_diagnostics",
      description: "Query any database table or run a read-only SELECT query. Only SELECT statements are permitted. Shows recent system_log errors by default.",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", description: "Table name to inspect (shows last 20 rows by id desc)" },
          query: { type: "string", description: "Raw SQL SELECT query (read-only; only SELECT statements allowed)" },
          limit: { type: "number", description: "Max rows to return (default 20, max 100)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_stuck_jobs",
      description: "Find stuck or stale jobs across agent_worker_jobs, content_publishing_jobs, crash_reports, and sms_retry_queue.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "reset_stuck_jobs",
      description: "Reset stuck jobs back to a retryable state. Always runs dry_run=true first to show impact before any changes are made. Set dry_run=false only after the user explicitly confirms.",
      parameters: {
        type: "object",
        properties: {
          job_type: {
            type: "string",
            enum: ["agent_worker", "content_publishing", "crash_reports", "sms_retry"],
            description: "Which job queue to reset",
          },
          dry_run: {
            type: "boolean",
            description: "If true (default), shows what would be reset without making changes. Set false ONLY after explicit user confirmation.",
          },
        },
        required: ["job_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recent_activity",
      description: "Show recent messages, system log errors, agent worker jobs, content publishing activity, and crash reports.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "database_backup",
      description: "Create a database snapshot manifest (table row counts saved to /backups/ directory for audit purposes).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "worker_status",
      description: "Check status of all background workers: agent worker, content publisher, crash report worker, and SMS retry processor.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "service_restart_guidance",
      description: "Show exact commands and instructions to restart specific services.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "emergency_notification",
      description: "Log a critical alert to the audit file and optionally send an SMS via Twilio if configured.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "The alert message to log and/or send" },
        },
        required: ["message"],
      },
    },
  },
];

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

const DESTRUCTIVE_TOOLS = new Set(["reset_stuck_jobs", "emergency_notification"]);

function isDestructiveArgs(toolName: string, args: Record<string, unknown>): boolean {
  if (toolName === "reset_stuck_jobs") {
    return args.dry_run === false;
  }
  return toolName === "emergency_notification";
}

async function dispatchTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "system_health_check":
      return toolSystemHealthCheck();
    case "database_diagnostics":
      return toolDatabaseDiagnostics(args as { table?: string; query?: string; limit?: number });
    case "find_stuck_jobs":
      return toolFindStuckJobs();
    case "reset_stuck_jobs":
      return toolResetStuckJobs(args as { job_type: "agent_worker" | "content_publishing" | "crash_reports" | "sms_retry"; dry_run?: boolean });
    case "recent_activity":
      return toolRecentActivity();
    case "database_backup":
      return toolDatabaseBackup();
    case "worker_status":
      return toolWorkerStatus();
    case "service_restart_guidance":
      return toolServiceRestartGuidance();
    case "emergency_notification":
      return toolEmergencyNotification(args as { message: string });
    default:
      return `Unknown tool: ${name}`;
  }
}

// ─── Confirmation prompt for destructive operations ───────────────────────────

async function confirmDestructive(
  rl: readline.Interface,
  toolName: string,
  args: Record<string, unknown>
): Promise<boolean> {
  if (!isDestructiveArgs(toolName, args)) return true;

  return new Promise<boolean>((resolve) => {
    console.log(`\n⚠️  DESTRUCTIVE OPERATION: ${toolName}`);
    console.log(`   Args: ${JSON.stringify(args)}`);
    rl.question("   Type 'yes' to confirm, anything else to cancel: ", (answer) => {
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
}

// ─── Startup health banner ────────────────────────────────────────────────────

async function printStartupBanner(): Promise<void> {
  console.log("\n" + "═".repeat(60));
  console.log("  APEX Emergency Shell Agent");
  console.log("  Powered by OpenAI · Direct DB Access · Audit Logged");
  console.log("═".repeat(60));
  console.log("\nRunning startup health check...\n");

  try {
    await queryDb("SELECT 1");
    console.log("  ✓ Database: Connected");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ Database: UNREACHABLE — ${msg}`);
  }

  const checks: Array<[string, string[]]> = [
    ["OpenAI", ["OPENAI_APEX_INT_KEY"]],
    ["Twilio", ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]],
    ["VAPI", ["VAPI_PRIVATE_KEY_APEX", "VAPI_PRIVATE_KEY", "apex_private_vapi"]],
    ["Stripe", ["STRIPE_API_SECRET", "STRIPE_SECRET_KEY"]],
    ["Meta", ["META_APP_ID", "META_APP_SECRET"]],
  ];
  for (const [label, vars] of checks) {
    const found = vars.find((v) => !!process.env[v]);
    console.log(found ? `  ✓ ${label}: present` : `  ✗ ${label}: MISSING`);
  }

  try {
    const aj = await queryDb(`SELECT COUNT(*) as c FROM agent_worker_jobs WHERE status IN ('running','pending')`);
    const ajFailed = await queryDb(`SELECT COUNT(*) as c FROM agent_worker_jobs WHERE status='failed' AND created_at > NOW() - INTERVAL '24 hours'`);
    const cpj = await queryDb(`SELECT COUNT(*) as c FROM content_publishing_jobs WHERE status IN ('queued','running')`);
    const cpjFailed = await queryDb(`SELECT COUNT(*) as c FROM content_publishing_jobs WHERE status='failed' AND created_at > NOW() - INTERVAL '24 hours'`);
    const crStuck = await queryDb(`SELECT COUNT(*) as c FROM crash_reports WHERE status='PENDING' AND locked_at IS NOT NULL AND locked_at < NOW() - INTERVAL '15 minutes'`);
    console.log(`\n  Agent worker jobs — active: ${aj.rows[0].c}, failed (24h): ${ajFailed.rows[0].c}`);
    console.log(`  Content publishing jobs — active: ${cpj.rows[0].c}, failed (24h): ${cpjFailed.rows[0].c}`);
    console.log(`  Crash reports — stuck (locked >15min): ${crStuck.rows[0].c}`);
  } catch {
    console.log("  (Could not query job tables — may not exist yet)");
  }

  console.log(`\n  Audit log: ${AUDIT_LOG_PATH}`);
  console.log("\n" + "═".repeat(60));
  console.log("  Type instructions in plain English. Examples:");
  console.log('    "what\'s the database health?"');
  console.log('    "find stuck jobs"');
  console.log('    "reset stuck agent worker jobs"');
  console.log('    "restart guidance"');
  console.log('    "show recent errors"');
  console.log('  Type "exit" or "quit" to close the session.');
  console.log("═".repeat(60) + "\n");

  auditLog("session_start");
}

// ─── Main REPL loop ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await printStartupBanner();

  const openai = new OpenAI({ apiKey: OPENAI_KEY! });

  const systemPrompt = `You are an emergency operations agent for the Apex SaaS platform.
Your role is to help the owner diagnose problems, recover stuck systems, and verify health from the terminal when the web server may be down.

You connect directly to PostgreSQL and have a toolkit of emergency operations.

Critical rules:
1. For reset_stuck_jobs: ALWAYS call first with dry_run=true to show impact. Only call with dry_run=false after the user explicitly confirms the operation.
2. For emergency_notification: Always confirm the message content with the user before sending.
3. For database_diagnostics with a custom query: Only pass SELECT statements. Never construct queries that write data.
4. Be concise and factual. Format output clearly for a terminal.
5. When a worker appears stalled, check worker_status and find_stuck_jobs before recommending resets.

Supported workers: agent worker, content publisher, crash report worker, SMS retry processor.
All destructive operations require explicit user confirmation in the terminal.`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const prompt = (): Promise<string> =>
    new Promise<string>((resolve) => {
      rl.question("You: ", (line) => resolve(line.trim()));
    });

  while (true) {
    let userInput: string;
    try {
      userInput = await prompt();
    } catch {
      break;
    }

    if (!userInput) continue;
    if (["exit", "quit", "q", "bye"].includes(userInput.toLowerCase())) {
      console.log("\nClosing emergency session. Stay safe.\n");
      auditLog("session_end");
      break;
    }

    auditLog("user_message", { message: userInput });
    messages.push({ role: "user", content: userInput });

    try {
      let response = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
      });

      // Agentic loop: handle tool calls
      while (response.choices[0].finish_reason === "tool_calls") {
        const assistantMessage = response.choices[0].message;
        messages.push(assistantMessage);

        const toolResults: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = [];

        for (const rawCall of assistantMessage.tool_calls || []) {
          const callId: string = rawCall.id;
          const fnObj = (rawCall as { function: { name: string; arguments: string } }).function;
          const name: string = fnObj?.name ?? "";
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(fnObj?.arguments || "{}") as Record<string, unknown>;
          } catch {
            args = {};
          }

          console.log(`\n[Tool: ${name}]`);

          // Confirmation gate for destructive operations
          if (DESTRUCTIVE_TOOLS.has(name)) {
            const confirmed = await confirmDestructive(rl, name, args);
            if (!confirmed) {
              console.log("  Operation cancelled.\n");
              toolResults.push({
                role: "tool",
                tool_call_id: callId,
                content: "Operation cancelled by user.",
              });
              continue;
            }
          }

          auditLog("tool_call", { tool: name, args });
          let result: string;
          try {
            result = await dispatchTool(name, args);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            result = `Tool error: ${msg}`;
            auditLog("tool_error", { tool: name, error: msg });
          }

          console.log(result + "\n");
          toolResults.push({
            role: "tool",
            tool_call_id: callId,
            content: result,
          });
        }

        messages.push(...toolResults);

        response = await openai.chat.completions.create({
          model: MODEL,
          messages,
          tools,
          tool_choice: "auto",
        });
      }

      // Stream the final text reply to the terminal
      const finalMessages = messages.concat([]);
      // Re-run final turn as streaming for live output (tool loop must use non-streaming)
      process.stdout.write("\nAgent: ");
      let replyText = "";
      const stream = openai.chat.completions.stream({
        model: MODEL,
        messages: finalMessages,
        tools,
        tool_choice: "none",
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) {
          process.stdout.write(delta);
          replyText += delta;
        }
      }
      process.stdout.write("\n\n");

      if (!replyText) {
        replyText = response.choices[0].message.content ?? "(no response)";
      }
      messages.push({ role: "assistant", content: replyText });
      auditLog("assistant_message", { message: replyText.substring(0, 500) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n[ERROR] ${msg}\n`);
      auditLog("error", { error: msg });
      if (msg.includes("401") || msg.includes("authentication")) {
        console.error("OpenAI authentication failed. Check OPENAI_APEX_INT_KEY.\n");
      }
    }
  }

  rl.close();
  await closePool();
  process.exit(0);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[FATAL]", msg);
  process.exit(1);
});
