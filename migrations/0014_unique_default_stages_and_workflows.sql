-- Task #143: Make default-seeding race-safe at the database layer.
--
-- Two parallel onboarding callers can both observe the same gap and insert
-- the same default pipeline_stage / workflow row, producing duplicates.
-- Adding a unique index on (sub_account_id, lower(name)) lets us rely on
-- ON CONFLICT DO NOTHING in the application layer instead of read-then-write.
--
-- Step 1: dedupe existing rows (only pipeline_stages currently has dupes
-- in this environment; workflows is clean but we apply the constraint
-- defensively). We keep the lowest id per group as the canonical row.
--
-- Step 1a: before deleting duplicate stages, repoint any deals.stage_id
-- that currently references a duplicate to the canonical (lowest-id)
-- stage in the same (sub_account_id, lower(name)) group. This makes the
-- migration safe in environments that DO have deals — not just clean
-- ones where deals is empty.

WITH ranked AS (
  SELECT
    id,
    sub_account_id,
    lower(name) AS lname,
    min(id) OVER (PARTITION BY sub_account_id, lower(name)) AS canonical_id
  FROM pipeline_stages
)
UPDATE deals
SET stage_id = ranked.canonical_id
FROM ranked
WHERE deals.stage_id = ranked.id
  AND ranked.id <> ranked.canonical_id;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY sub_account_id, lower(name)
      ORDER BY id
    ) AS rn
  FROM pipeline_stages
)
DELETE FROM pipeline_stages
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY sub_account_id, lower(name)
      ORDER BY id
    ) AS rn
  FROM workflows
)
DELETE FROM workflows
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Step 2: add the unique indexes. Case-insensitive on name to match the
-- application's `name.toLowerCase()` deduplication semantics.

CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_sub_account_name_uniq
  ON pipeline_stages (sub_account_id, lower(name));

CREATE UNIQUE INDEX IF NOT EXISTS workflows_sub_account_name_uniq
  ON workflows (sub_account_id, lower(name));
