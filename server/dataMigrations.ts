/**
 * Server-side data migrations that run on every boot.
 *
 * These are idempotent SQL fixes that must be applied BEFORE drizzle-kit
 * synchronizes the schema (e.g. when a new uniqueness constraint requires
 * existing duplicate rows to be cleaned up first).
 *
 * Each migration is wrapped in its own transaction with an advisory lock,
 * so concurrent server instances will not race. Already-applied migrations
 * are skipped via the `_data_migrations` tracking table.
 *
 * The same SQL is also available as files in `scripts/migrations/` for the
 * standalone runner (`scripts/run-data-migrations.ts`); the embedded copy
 * here is what runs in production where the bundled server cannot read
 * those files from disk.
 */

import { sql } from "drizzle-orm";
import { db } from "./db";

interface DataMigration {
  name: string;
  sql: string;
}

const ADVISORY_LOCK_KEY = 7421430021;

const MIGRATIONS: DataMigration[] = [
  {
    name: "2026-04-25-dedupe-apex-module-coverage",
    sql: `
      LOCK TABLE apex_module_coverage IN SHARE ROW EXCLUSIVE MODE;

      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY account_id, module_group
                 ORDER BY updated_at DESC NULLS LAST, id DESC
               ) AS rn
        FROM apex_module_coverage
      )
      DELETE FROM apex_module_coverage
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

      CREATE UNIQUE INDEX IF NOT EXISTS amc_lookup
        ON apex_module_coverage (account_id, module_group);
    `,
  },
  {
    name: "2026-05-13-standalone-card-leads",
    sql: `
      CREATE TABLE IF NOT EXISTS standalone_card_leads (
        id          SERIAL PRIMARY KEY,
        card_id     INTEGER NOT NULL REFERENCES standalone_cards(id) ON DELETE CASCADE,
        name        TEXT    NOT NULL,
        phone       TEXT,
        email       TEXT,
        message     TEXT,
        owner_notes TEXT,
        created_at  TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scl_card_id    ON standalone_card_leads (card_id);
      CREATE INDEX IF NOT EXISTS idx_scl_created_at ON standalone_card_leads (created_at DESC);
    `,
  },
  {
    name: "2026-05-13-standalone-card-leads-owner-notes",
    sql: `
      ALTER TABLE standalone_card_leads
        ADD COLUMN IF NOT EXISTS owner_notes TEXT;
    `,
  },
];

export async function runDataMigrations(): Promise<void> {
  if (MIGRATIONS.length === 0) {
    console.log("[DATA-MIGRATIONS] no migrations registered");
    return;
  }

  // Only auto-apply in production. In dev, the schema is the source of
  // truth and these out-of-band fixes are not needed (run them manually
  // via scripts/run-data-migrations.ts if you really want them on dev).
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[DATA-MIGRATIONS] skipping in NODE_ENV=${process.env.NODE_ENV ?? "<unset>"} — runs only in production`,
    );
    return;
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _data_migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
  } catch (err) {
    console.error(
      "[DATA-MIGRATIONS] failed to ensure tracking table:",
      err instanceof Error ? err.message : err,
    );
    throw err;
  }

  for (const migration of MIGRATIONS) {
    try {
      const existing = await db.execute<{ name: string }>(
        sql`SELECT name FROM _data_migrations WHERE name = ${migration.name}`,
      );
      const rows = (existing as unknown as { rows?: Array<{ name: string }> }).rows
        ?? (existing as unknown as Array<{ name: string }>);
      if (Array.isArray(rows) && rows.length > 0) {
        console.log(`[DATA-MIGRATIONS] skip  ${migration.name} (already applied)`);
        continue;
      }

      console.log(`[DATA-MIGRATIONS] apply ${migration.name}`);

      await db.transaction(async (tx) => {
        const lockResult = await tx.execute<{ ok: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS ok`,
        );
        const lockRows = (lockResult as unknown as { rows?: Array<{ ok: boolean }> }).rows
          ?? (lockResult as unknown as Array<{ ok: boolean }>);
        const acquired = Array.isArray(lockRows) && lockRows[0]?.ok === true;
        if (!acquired) {
          throw new Error(
            "another server instance is currently applying this migration — will retry on next boot",
          );
        }

        const recheck = await tx.execute<{ name: string }>(
          sql`SELECT name FROM _data_migrations WHERE name = ${migration.name}`,
        );
        const recheckRows = (recheck as unknown as { rows?: Array<{ name: string }> }).rows
          ?? (recheck as unknown as Array<{ name: string }>);
        if (Array.isArray(recheckRows) && recheckRows.length > 0) {
          return;
        }

        await tx.execute(sql.raw(migration.sql));
        await tx.execute(
          sql`INSERT INTO _data_migrations (name) VALUES (${migration.name})
              ON CONFLICT DO NOTHING`,
        );
      });

      console.log(`[DATA-MIGRATIONS] ok    ${migration.name}`);
    } catch (err) {
      console.error(
        `[DATA-MIGRATIONS] FAIL ${migration.name}:`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }

  console.log("[DATA-MIGRATIONS] complete");
}
