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
  {
    name: "2026-05-13-standalone-card-services",
    sql: `
      ALTER TABLE standalone_cards
        ADD COLUMN IF NOT EXISTS services JSONB DEFAULT '[]'::jsonb;
    `,
  },
  {
    name: "2026-05-14-contact-lifecycle-fields",
    sql: `
      -- Phase 5: Contact lifecycle + skip-trace structured status columns
      -- All additive-only — safe to run on live tables

      ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS identity_status       TEXT NOT NULL DEFAULT 'unidentified',
        ADD COLUMN IF NOT EXISTS skip_trace_status     TEXT NOT NULL DEFAULT 'not_attempted',
        ADD COLUMN IF NOT EXISTS enrichment_provider   TEXT,
        ADD COLUMN IF NOT EXISTS enrichment_attempted_at   TIMESTAMP,
        ADD COLUMN IF NOT EXISTS enrichment_completed_at   TIMESTAMP,
        ADD COLUMN IF NOT EXISTS enrichment_confidence REAL,
        ADD COLUMN IF NOT EXISTS source_external_id    TEXT,
        ADD COLUMN IF NOT EXISTS raw_source_type       TEXT,
        ADD COLUMN IF NOT EXISTS lead_vertical         TEXT,
        ADD COLUMN IF NOT EXISTS lead_subtype          TEXT,
        ADD COLUMN IF NOT EXISTS normalized_phone      TEXT,
        ADD COLUMN IF NOT EXISTS normalized_email      TEXT,
        ADD COLUMN IF NOT EXISTS county                TEXT,
        ADD COLUMN IF NOT EXISTS contact_quality_score REAL;

      -- Indexes for efficient filtering on the new status fields
      CREATE INDEX IF NOT EXISTS idx_contacts_sub_skip_status
        ON contacts (sub_account_id, skip_trace_status);

      CREATE INDEX IF NOT EXISTS idx_contacts_sub_identity_status
        ON contacts (sub_account_id, identity_status);

      CREATE INDEX IF NOT EXISTS idx_contacts_source_external_id
        ON contacts (sub_account_id, source_external_id)
        WHERE source_external_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_contacts_normalized_phone
        ON contacts (sub_account_id, normalized_phone)
        WHERE normalized_phone IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_contacts_lead_vertical
        ON contacts (sub_account_id, lead_vertical)
        WHERE lead_vertical IS NOT NULL;

      -- Backfill: any contact that already has the "skip-traced" tag gets
      -- its skip_trace_status set to 'attempted' so existing data is valid.
      -- Contacts with "has-phone" after skip-trace become 'matched';
      -- contacts with "no-phone" after skip-trace become 'no_match'.
      UPDATE contacts
      SET skip_trace_status = CASE
            WHEN 'skip-traced' = ANY(tags) AND 'has-phone' = ANY(tags) THEN 'matched'
            WHEN 'skip-traced' = ANY(tags) AND 'no-phone'  = ANY(tags) THEN 'no_match'
            WHEN 'skip-traced' = ANY(tags) THEN 'attempted'
            ELSE 'not_attempted'
          END
      WHERE skip_trace_status = 'not_attempted';

      -- Backfill identity_status: contacts with a real phone or real email
      -- (and not a placeholder first_name) are marked 'verified'.
      UPDATE contacts
      SET identity_status = 'verified'
      WHERE (phone IS NOT NULL AND phone != '')
         OR (email IS NOT NULL AND email != '')
      AND first_name NOT LIKE 'Crash Lead%'
      AND first_name NOT LIKE 'Unidentified%'
      AND identity_status = 'unidentified';

      -- Backfill normalized_phone from existing phone values (digits only)
      UPDATE contacts
      SET normalized_phone = regexp_replace(phone, '[^0-9]', '', 'g')
      WHERE phone IS NOT NULL
        AND phone != ''
        AND normalized_phone IS NULL;
    `,
  },
  {
    name: "2026-05-14-users-role-column",
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'member';
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
