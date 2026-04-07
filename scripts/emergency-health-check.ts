/**
 * Emergency health check script — invokable via agent_commands.json webhook.
 * Writes output to logs/emergency-health-check.json and prints summary.
 */

import pg from "pg";
import * as fs from "fs";
import * as path from "path";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("[HEALTH-CHECK] DATABASE_URL not set");
  process.exit(1);
}

const LOG_DIR = path.resolve(process.cwd(), "logs");
const OUTPUT_PATH = path.join(LOG_DIR, "emergency-health-check.json");

interface HealthReport {
  timestamp: string;
  database: { connected: boolean; error?: string };
  tables: Record<string, number>;
  stuckJobs: Record<string, number | string>;
  envVars: Record<string, boolean>;
}

async function run(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL!, max: 3 });

  const report: HealthReport = {
    timestamp: new Date().toISOString(),
    database: { connected: false },
    tables: {},
    stuckJobs: {},
    envVars: {},
  };

  try {
    await pool.query("SELECT 1");
    report.database.connected = true;

    const tableRes = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
    );
    for (const row of tableRes.rows) {
      try {
        const cr = await pool.query<{ c: string }>(`SELECT COUNT(*) as c FROM "${row.tablename}"`);
        report.tables[row.tablename] = parseInt(cr.rows[0].c, 10);
      } catch {
        report.tables[row.tablename] = -1;
      }
    }

    try {
      const aj = await pool.query<{ c: string }>(`SELECT COUNT(*) as c FROM agent_worker_jobs WHERE status IN ('running','pending')`);
      const ajf = await pool.query<{ c: string }>(`SELECT COUNT(*) as c FROM agent_worker_jobs WHERE status='failed' AND created_at > NOW()-INTERVAL '24 hours'`);
      const cpj = await pool.query<{ c: string }>(`SELECT COUNT(*) as c FROM content_publishing_jobs WHERE status IN ('queued','running')`);
      const cpjf = await pool.query<{ c: string }>(`SELECT COUNT(*) as c FROM content_publishing_jobs WHERE status='failed' AND created_at > NOW()-INTERVAL '24 hours'`);
      const crs = await pool.query<{ c: string }>(`SELECT COUNT(*) as c FROM crash_reports WHERE status='PENDING' AND locked_at IS NOT NULL AND locked_at < NOW()-INTERVAL '15 minutes'`);
      report.stuckJobs = {
        agentWorkerActive: parseInt(aj.rows[0].c, 10),
        agentWorkerFailed24h: parseInt(ajf.rows[0].c, 10),
        contentPublishingActive: parseInt(cpj.rows[0].c, 10),
        contentPublishingFailed24h: parseInt(cpjf.rows[0].c, 10),
        crashReportsStuck: parseInt(crs.rows[0].c, 10),
      };
    } catch {
      report.stuckJobs = { error: "Job tables not found or query failed" };
    }
  } catch (err: unknown) {
    report.database.error = err instanceof Error ? err.message : String(err);
  }

  const envChecks: Record<string, string[]> = {
    openai: ["OPENAI_APEX_INT_KEY"],
    twilio: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
    vapi: ["VAPI_PRIVATE_KEY_APEX", "VAPI_PRIVATE_KEY", "apex_private_vapi"],
    stripe: ["STRIPE_API_SECRET", "STRIPE_SECRET_KEY"],
    meta: ["META_APP_ID", "META_APP_SECRET"],
    gemini: ["Gemini_API_Key_saas"],
    agentSecret: ["AGENT_SECRET"],
  };
  for (const [label, vars] of Object.entries(envChecks)) {
    report.envVars[label] = vars.some((v) => !!process.env[v]);
  }

  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));

  console.log("[HEALTH-CHECK] Report written to", OUTPUT_PATH);
  console.log("[HEALTH-CHECK] DB connected:", report.database.connected);
  console.log("[HEALTH-CHECK] Tables:", Object.keys(report.tables).length);
  console.log("[HEALTH-CHECK] Stuck jobs:", JSON.stringify(report.stuckJobs));
  console.log("[HEALTH-CHECK] Env vars:", JSON.stringify(report.envVars));

  await pool.end();
  process.exit(0);
}

run().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[HEALTH-CHECK] Fatal:", msg);
  process.exit(1);
});
