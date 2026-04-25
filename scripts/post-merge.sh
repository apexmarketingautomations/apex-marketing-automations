#!/bin/bash
set -e

npm install --no-audit --no-fund

# Run idempotent SQL data migrations BEFORE drizzle-kit pushes the schema.
# This handles cases where new uniqueness constraints would fail on existing
# duplicate data (e.g. apex_module_coverage amc_lookup index).
npx tsx scripts/run-data-migrations.ts

npm run db:push -- --force
