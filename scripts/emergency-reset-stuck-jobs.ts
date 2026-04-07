/**
 * Emergency stuck-job reset script — invokable via agent_commands.json webhook.
 * Usage: npx tsx scripts/emergency-reset-stuck-jobs.ts <job_type>
 *   job_type: agent_worker | content_publishing | crash_reports
 *
 * Requires owner unlock (enforced by agent worker framework).
 */

import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const jobType = process.argv[2] || process.env.RESET_JOB_TYPE;

if (!DATABASE_URL) {
  console.error("[RESET-STUCK-JOBS] DATABASE_URL not set");
  process.exit(1);
}

if (!jobType || !["agent_worker", "content_publishing", "crash_reports"].includes(jobType)) {
  console.error("[RESET-STUCK-JOBS] Invalid or missing job_type argument. Use: agent_worker | content_publishing | crash_reports");
  process.exit(1);
}

interface ResetRow {
  id: number;
}

async function run(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL!, max: 3 });

  try {
    if (jobType === "agent_worker") {
      const res = await pool.query<ResetRow>(`
        UPDATE agent_worker_jobs
        SET status = 'pending', started_at = NULL, error = 'Reset by emergency script'
        WHERE status = 'running' AND started_at < NOW() - INTERVAL '10 minutes'
        RETURNING id
      `);
      const ids = res.rows.map((r) => r.id);
      console.log(`[RESET-STUCK-JOBS] Reset ${ids.length} stuck agent_worker_jobs: ${ids.join(", ") || "none"}`);
    } else if (jobType === "content_publishing") {
      const res = await pool.query<ResetRow>(`
        UPDATE content_publishing_jobs
        SET status = 'queued', lock_owner = NULL, lock_expires_at = NULL,
            started_at = NULL, error_message = 'Reset by emergency script'
        WHERE (status = 'running' AND started_at < NOW() - INTERVAL '15 minutes')
           OR (status = 'queued' AND lock_expires_at IS NOT NULL AND lock_expires_at < NOW())
        RETURNING id
      `);
      const ids = res.rows.map((r) => r.id);
      console.log(`[RESET-STUCK-JOBS] Reset ${ids.length} stuck content_publishing_jobs: ${ids.join(", ") || "none"}`);
    } else if (jobType === "crash_reports") {
      const res = await pool.query<ResetRow>(`
        UPDATE crash_reports
        SET locked_at = NULL, locked_by = NULL
        WHERE status = 'PENDING' AND locked_at IS NOT NULL AND locked_at < NOW() - INTERVAL '15 minutes'
        RETURNING id
      `);
      const ids = res.rows.map((r) => r.id);
      console.log(`[RESET-STUCK-JOBS] Unlocked ${ids.length} stuck crash_reports: ${ids.join(", ") || "none"}`);
    }
  } finally {
    await pool.end();
  }

  process.exit(0);
}

run().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[RESET-STUCK-JOBS] Fatal:", msg);
  process.exit(1);
});
