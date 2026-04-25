/**
 * Run idempotent SQL data migrations from scripts/migrations/.
 *
 * Each .sql file is executed in lexical order, inside a single transaction,
 * and recorded in the `_data_migrations` tracking table so it never re-runs.
 *
 * Use this for one-off data fixes that must run BEFORE drizzle-kit pushes a
 * schema change (e.g. dedupe rows before creating a unique index).
 *
 * Usage:
 *   # local (runs against DATABASE_URL from env)
 *   npx tsx scripts/run-data-migrations.ts
 *
 *   # production (one-shot, point at the prod connection string)
 *   DATABASE_URL=postgres://... npx tsx scripts/run-data-migrations.ts
 *
 * Wired into scripts/post-merge.sh so dev catches up automatically after
 * task merges. Production runs are a deliberate operator step before
 * `npm run db:push` or deployment.
 */

import { Pool } from "pg";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "scripts/migrations");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[data-migrations] DATABASE_URL is required");
    process.exit(1);
  }

  let files: string[] = [];
  try {
    files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => {
        try {
          return statSync(join(MIGRATIONS_DIR, f)).isFile();
        } catch (err) {
          console.warn(
            "[data-migrations] skip stat error:",
            f,
            err instanceof Error ? err.message : err,
          );
          return false;
        }
      })
      .sort();
  } catch (err) {
    console.warn(
      "[data-migrations] no migrations dir or unreadable:",
      err instanceof Error ? err.message : err,
    );
    return;
  }

  if (files.length === 0) {
    console.log("[data-migrations] nothing to do (no .sql files)");
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Acquire a session-scoped advisory lock so two runner processes (e.g. one
  // dev post-merge + one operator-triggered prod run) cannot race on the
  // same migration. The lock key is an arbitrary stable hash of the runner
  // identity. Released automatically when the connection closes.
  const lockClient = await pool.connect();
  let lockAcquired = false;
  try {
    const { rows: lockRows } = await lockClient.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock(7421430021) AS ok",
    );
    if (!lockRows[0]?.ok) {
      console.error(
        "[data-migrations] another runner is already executing — exiting",
      );
      process.exit(2);
    }
    lockAcquired = true;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS _data_migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const { rows } = await pool.query<{ name: string }>(
        "SELECT name FROM _data_migrations WHERE name = $1",
        [file],
      );
      if (rows.length > 0) {
        console.log(`[data-migrations] skip  ${file} (already applied)`);
        continue;
      }

      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`[data-migrations] apply ${file}`);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO _data_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING",
          [file],
        );
        await client.query("COMMIT");
        console.log(`[data-migrations] ok    ${file}`);
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackErr) {
          console.warn(
            "[data-migrations] rollback failed:",
            rollbackErr instanceof Error ? rollbackErr.message : rollbackErr,
          );
        }
        console.error(
          `[data-migrations] FAIL ${file}:`,
          err instanceof Error ? err.message : err,
        );
        throw err;
      } finally {
        client.release();
      }
    }

    console.log("[data-migrations] all migrations applied");
  } finally {
    if (lockAcquired) {
      try {
        await lockClient.query("SELECT pg_advisory_unlock(7421430021)");
      } catch (err) {
        console.warn(
          "[data-migrations] advisory unlock failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }
    lockClient.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(
    "[data-migrations] aborted:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
