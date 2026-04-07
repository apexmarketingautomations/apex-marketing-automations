/**
 * Emergency recent activity script — invokable via agent_commands.json webhook.
 * Shows recent messages, DMs, webhook events, pipeline activity, and errors.
 * Output written to logs/emergency-recent-activity.json.
 */

import pg from "pg";
import * as fs from "fs";
import * as path from "path";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("[RECENT-ACTIVITY] DATABASE_URL not set");
  process.exit(1);
}

const LOG_DIR = path.resolve(process.cwd(), "logs");

interface ActivityReport {
  timestamp: string;
  recentMessages: unknown[];
  recentSystemErrors: unknown[];
  recentWebhookEvents: unknown[];
  recentAgentJobs: unknown[];
  recentPublishingJobs: unknown[];
  recentCrashReports: unknown[];
}

async function run(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL!, max: 3 });

  const report: ActivityReport = {
    timestamp: new Date().toISOString(),
    recentMessages: [],
    recentSystemErrors: [],
    recentWebhookEvents: [],
    recentAgentJobs: [],
    recentPublishingJobs: [],
    recentCrashReports: [],
  };

  try {
    const res = await pool.query(
      `SELECT id, sub_account_id, direction, channel, status, created_at, contact_phone FROM messages ORDER BY created_at DESC LIMIT 10`
    );
    report.recentMessages = res.rows;
  } catch (err: unknown) {
    report.recentMessages = [{ error: err instanceof Error ? err.message : String(err) }];
  }

  try {
    const res = await pool.query(
      `SELECT id, timestamp, severity, module, message FROM system_logs WHERE severity IN ('error','critical','warn') ORDER BY timestamp DESC LIMIT 10`
    );
    report.recentSystemErrors = res.rows;
  } catch (err: unknown) {
    report.recentSystemErrors = [{ error: err instanceof Error ? err.message : String(err) }];
  }

  try {
    const res = await pool.query(
      `SELECT id, sub_account_id, event_type, url, status, response_status, error, created_at FROM webhook_events ORDER BY created_at DESC LIMIT 15`
    );
    report.recentWebhookEvents = res.rows;
  } catch (err: unknown) {
    report.recentWebhookEvents = [{ error: err instanceof Error ? err.message : String(err) }];
  }

  try {
    const res = await pool.query(
      `SELECT id, job_type, status, created_by, created_at, error FROM agent_worker_jobs ORDER BY created_at DESC LIMIT 10`
    );
    report.recentAgentJobs = res.rows;
  } catch (err: unknown) {
    report.recentAgentJobs = [{ error: err instanceof Error ? err.message : String(err) }];
  }

  try {
    const res = await pool.query(
      `SELECT id, platform, status, attempt_count, created_at, error_message FROM content_publishing_jobs ORDER BY created_at DESC LIMIT 10`
    );
    report.recentPublishingJobs = res.rows;
  } catch (err: unknown) {
    report.recentPublishingJobs = [{ error: err instanceof Error ? err.message : String(err) }];
  }

  try {
    const res = await pool.query(
      `SELECT id, report_number, status, retry_count, created_at FROM crash_reports ORDER BY created_at DESC LIMIT 10`
    );
    report.recentCrashReports = res.rows;
  } catch (err: unknown) {
    report.recentCrashReports = [{ error: err instanceof Error ? err.message : String(err) }];
  }

  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const outputPath = path.join(LOG_DIR, "emergency-recent-activity.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log("[RECENT-ACTIVITY] Report written to", outputPath);
  console.log("[RECENT-ACTIVITY] Messages:", report.recentMessages.length);
  console.log("[RECENT-ACTIVITY] System errors:", report.recentSystemErrors.length);
  console.log("[RECENT-ACTIVITY] Webhook events:", report.recentWebhookEvents.length);
  console.log("[RECENT-ACTIVITY] Agent jobs:", report.recentAgentJobs.length);
  console.log("[RECENT-ACTIVITY] Publishing jobs:", report.recentPublishingJobs.length);
  console.log("[RECENT-ACTIVITY] Crash reports:", report.recentCrashReports.length);

  await pool.end();
  process.exit(0);
}

run().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[RECENT-ACTIVITY] Fatal:", msg);
  process.exit(1);
});
