/**
 * server/db/migrationVerifier.ts
 *
 * Migration Verification Engine
 *
 * Validates the state of all data migrations tracked in _data_migrations,
 * detects gaps in execution order, and generates a deterministic integrity report.
 *
 * Rules:
 * - Never modifies data
 * - Never applies missing migrations
 * - Only reports — repair is done by runDataMigrations() on the next boot
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

export interface MigrationRecord {
  name: string;
  appliedAt: string;
}

export interface MigrationVerificationReport {
  totalDefined: number;
  totalApplied: number;
  totalMissing: number;
  missingMigrations: string[];
  appliedMigrations: MigrationRecord[];
  trackingTableExists: boolean;
  status: "healthy" | "degraded" | "critical";
  generatedAt: string;
}

const EXPECTED_MIGRATIONS = [
  "2026-04-25-dedupe-apex-module-coverage",
  "2026-05-13-standalone-card-leads",
  "2026-05-13-standalone-card-leads-owner-notes",
  "2026-05-13-standalone-card-services",
];

export async function verifyMigrations(): Promise<MigrationVerificationReport> {
  const generatedAt = new Date().toISOString();

  let trackingTableExists = false;
  let appliedMigrations: MigrationRecord[] = [];

  try {
    const tableCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name   = '_data_migrations'
      ) AS exists
    `);
    const rows = (tableCheck as any).rows ?? tableCheck;
    trackingTableExists = Array.isArray(rows) && rows[0]?.exists === true;
  } catch {
    trackingTableExists = false;
  }

  if (trackingTableExists) {
    try {
      const result = await db.execute(sql`
        SELECT name, applied_at FROM _data_migrations ORDER BY applied_at ASC
      `);
      const rows = (result as any).rows ?? result;
      if (Array.isArray(rows)) {
        appliedMigrations = rows.map((r: any) => ({
          name: r.name,
          appliedAt: r.applied_at instanceof Date
            ? r.applied_at.toISOString()
            : String(r.applied_at),
        }));
      }
    } catch {
      appliedMigrations = [];
    }
  }

  const appliedNames = new Set(appliedMigrations.map(m => m.name));
  const missingMigrations = EXPECTED_MIGRATIONS.filter(m => !appliedNames.has(m));

  const totalDefined = EXPECTED_MIGRATIONS.length;
  const totalApplied = appliedMigrations.length;
  const totalMissing = missingMigrations.length;

  let status: "healthy" | "degraded" | "critical";
  if (!trackingTableExists) {
    status = "critical";
  } else if (totalMissing > 0) {
    status = "degraded";
  } else {
    status = "healthy";
  }

  const report: MigrationVerificationReport = {
    totalDefined,
    totalApplied,
    totalMissing,
    missingMigrations,
    appliedMigrations,
    trackingTableExists,
    status,
    generatedAt,
  };

  if (status !== "healthy") {
    console.warn(`[MIGRATION-VERIFIER] status=${status} missing=${totalMissing} tracking_table=${trackingTableExists}`);
  } else {
    console.log(`[MIGRATION-VERIFIER] ✓ all ${totalApplied} migrations verified`);
  }

  return report;
}

export interface SchemaDriftReport {
  requiredIndexes: { name: string; table: string; exists: boolean }[];
  missingIndexes: string[];
  status: "healthy" | "degraded";
  generatedAt: string;
}

const REQUIRED_INDEXES = [
  { name: "contacts_sub_account_id_idx",    table: "contacts" },
  { name: "amc_lookup",                      table: "apex_module_coverage" },
  { name: "idx_scl_card_id",                 table: "standalone_card_leads" },
  { name: "idx_scl_created_at",              table: "standalone_card_leads" },
  { name: "intelligence_cases_entity_id_idx", table: "intelligence_cases" },
  { name: "sentinel_incidents_sub_account_id_idx", table: "sentinel_incidents" },
];

export async function detectSchemaDrift(): Promise<SchemaDriftReport> {
  const generatedAt = new Date().toISOString();

  let existingIndexes = new Set<string>();
  try {
    const result = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `);
    const rows = (result as any).rows ?? result;
    if (Array.isArray(rows)) {
      rows.forEach((r: any) => existingIndexes.add(r.indexname));
    }
  } catch {
    existingIndexes = new Set();
  }

  const requiredIndexes = REQUIRED_INDEXES.map(idx => ({
    name:   idx.name,
    table:  idx.table,
    exists: existingIndexes.has(idx.name),
  }));

  const missingIndexes = requiredIndexes
    .filter(i => !i.exists)
    .map(i => i.name);

  const status = missingIndexes.length === 0 ? "healthy" : "degraded";

  if (missingIndexes.length > 0) {
    console.warn(`[SCHEMA-DRIFT] missing indexes: ${missingIndexes.join(", ")}`);
  }

  return { requiredIndexes, missingIndexes, status, generatedAt };
}
