/**
 * Emergency worker status script — invokable via agent_commands.json webhook.
 * Reports background worker activity across all workers for the last 1 hour.
 * Output written to logs/emergency-worker-status.json.
 */

import pg from "pg";
import * as fs from "fs";
import * as path from "path";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("[WORKER-STATUS] DATABASE_URL not set");
  process.exit(1);
}

const LOG_DIR = path.resolve(process.cwd(), "logs");

interface WorkerReport {
  timestamp: string;
  agentWorker: Record<string, unknown>;
  contentPublisher: Record<string, unknown>;
  crashReportWorker: Record<string, unknown>;
  smsRetryProcessor: Record<string, unknown>;
}

async function run(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL!, max: 3 });

  const report: WorkerReport = {
    timestamp: new Date().toISOString(),
    agentWorker: {},
    contentPublisher: {},
    crashReportWorker: {},
    smsRetryProcessor: {},
  };

  try {
    const aj = await pool.query<{ status: string; c: string }>(
      `SELECT status, COUNT(*) as c FROM agent_worker_jobs WHERE created_at > NOW() - INTERVAL '1 hour' GROUP BY status`
    );
    const ajLast = await pool.query<{ completed_at: Date }>(
      `SELECT completed_at FROM agent_worker_jobs WHERE status='completed' ORDER BY completed_at DESC LIMIT 1`
    );
    report.agentWorker = { byStatus: Object.fromEntries(aj.rows.map((r) => [r.status, parseInt(r.c, 10)])), lastCompleted: ajLast.rows[0]?.completed_at ?? null };
  } catch (err: unknown) {
    report.agentWorker = { error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const cpj = await pool.query<{ status: string; c: string }>(
      `SELECT status, COUNT(*) as c FROM content_publishing_jobs WHERE created_at > NOW() - INTERVAL '1 hour' GROUP BY status`
    );
    const cpjLast = await pool.query<{ completed_at: Date }>(
      `SELECT completed_at FROM content_publishing_jobs WHERE status='published' ORDER BY completed_at DESC LIMIT 1`
    );
    report.contentPublisher = { byStatus: Object.fromEntries(cpj.rows.map((r) => [r.status, parseInt(r.c, 10)])), lastPublished: cpjLast.rows[0]?.completed_at ?? null };
  } catch (err: unknown) {
    report.contentPublisher = { error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const cr = await pool.query<{ status: string; c: string }>(
      `SELECT status, COUNT(*) as c FROM crash_reports WHERE created_at > NOW() - INTERVAL '1 hour' GROUP BY status`
    );
    const crLast = await pool.query<{ updated_at: Date }>(
      `SELECT updated_at FROM crash_reports WHERE status != 'PENDING' ORDER BY updated_at DESC LIMIT 1`
    );
    report.crashReportWorker = { byStatus: Object.fromEntries(cr.rows.map((r) => [r.status, parseInt(r.c, 10)])), lastProcessed: crLast.rows[0]?.updated_at ?? null };
  } catch (err: unknown) {
    report.crashReportWorker = { error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const sms = await pool.query<{ status: string; c: string }>(
      `SELECT status, COUNT(*) as c FROM sms_retry_queue WHERE created_at > NOW() - INTERVAL '1 hour' GROUP BY status`
    );
    report.smsRetryProcessor = { byStatus: Object.fromEntries(sms.rows.map((r) => [r.status, parseInt(r.c, 10)])) };
  } catch (err: unknown) {
    report.smsRetryProcessor = { error: err instanceof Error ? err.message : String(err) };
  }

  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const outputPath = path.join(LOG_DIR, "emergency-worker-status.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log("[WORKER-STATUS] Report written to", outputPath);
  console.log("[WORKER-STATUS] Agent worker:", JSON.stringify(report.agentWorker));
  console.log("[WORKER-STATUS] Content publisher:", JSON.stringify(report.contentPublisher));
  console.log("[WORKER-STATUS] Crash report worker:", JSON.stringify(report.crashReportWorker));
  console.log("[WORKER-STATUS] SMS retry:", JSON.stringify(report.smsRetryProcessor));

  await pool.end();
  process.exit(0);
}

run().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[WORKER-STATUS] Fatal:", msg);
  process.exit(1);
});
