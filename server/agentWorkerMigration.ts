import pg from "pg";

const AGENT_WORKER_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS agent_worker_jobs (
  id SERIAL PRIMARY KEY,
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT NOT NULL,
  sub_account_id INTEGER REFERENCES sub_accounts(id),
  result JSONB,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_worker_logs (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES agent_worker_jobs(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS owner_unlocks (
  id SERIAL PRIMARY KEY,
  sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  purpose TEXT NOT NULL,
  created_by TEXT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  used_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_worker_jobs_status_created ON agent_worker_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_worker_jobs_sub ON agent_worker_jobs(sub_account_id);
`;

export async function ensureAgentWorkerTables(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("[AGENT-WORKER-MIGRATION] DATABASE_URL not set, skipping");
    return;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await pool.query(AGENT_WORKER_MIGRATION_SQL);
    console.log("[AGENT-WORKER-MIGRATION] Tables ensured: agent_worker_jobs, agent_worker_logs, owner_unlocks");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[AGENT-WORKER-MIGRATION] Failed to ensure tables: ${message}`);
  } finally {
    await pool.end();
  }
}
