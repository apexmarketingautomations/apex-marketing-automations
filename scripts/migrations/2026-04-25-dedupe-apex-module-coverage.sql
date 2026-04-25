-- Deduplicate apex_module_coverage and create the unique index
-- (account_id, module_group). This must run BEFORE drizzle-kit push,
-- otherwise the index creation fails on environments that accumulated
-- duplicates before storage.upsertModuleCoverage / incrementModuleCoverageCount
-- were updated to use ON CONFLICT.
--
-- Strategy: keep the freshest row in each (account_id, module_group) group,
-- delete the rest. Tiebreaker: newest updated_at, then highest id.
--
-- Idempotent: re-running on a clean table is a no-op (ROW_NUMBER produces
-- only rn=1 rows). CREATE UNIQUE INDEX uses IF NOT EXISTS.
--
-- The runner (scripts/run-data-migrations.ts) wraps each file in a single
-- transaction, so do NOT add explicit BEGIN/COMMIT here.

-- Block concurrent writers for the duration of the transaction so a new
-- duplicate cannot be inserted in the window between the DELETE and the
-- CREATE INDEX. SHARE ROW EXCLUSIVE blocks INSERT/UPDATE/DELETE but still
-- allows SELECT, so reads continue normally during the migration.
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
