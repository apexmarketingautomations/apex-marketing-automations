/**
 * server/db/orphanDetector.ts
 *
 * Global Orphan Record Detection Engine
 *
 * Scans all major entity tables for records that have broken parent references.
 * Classifies each orphan type and generates a non-destructive report.
 *
 * Safety rules:
 * - Read-only: no data is modified
 * - All counts are approximate (uses LIMIT to cap scan cost)
 * - Results feed the quarantine system, not auto-repair
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

export interface OrphanGroup {
  table: string;
  parentTable: string;
  foreignKey: string;
  orphanCount: number;
  sampleIds: number[];
  riskLevel: "low" | "medium" | "high" | "critical";
}

export interface OrphanDetectionReport {
  totalOrphanGroups: number;
  totalOrphanRecords: number;
  criticalGroups: OrphanGroup[];
  highGroups: OrphanGroup[];
  mediumGroups: OrphanGroup[];
  lowGroups: OrphanGroup[];
  allGroups: OrphanGroup[];
  status: "clean" | "degraded" | "critical";
  generatedAt: string;
}

interface OrphanCheck {
  childTable: string;
  parentTable: string;
  childFk: string;
  parentPk: string;
  riskLevel: OrphanGroup["riskLevel"];
}

// Tables with FK relationships to verify
const ORPHAN_CHECKS: OrphanCheck[] = [
  // Core tenant FKs
  { childTable: "contacts",             parentTable: "sub_accounts",       childFk: "sub_account_id",  parentPk: "id", riskLevel: "critical" },
  { childTable: "messages",             parentTable: "sub_accounts",       childFk: "sub_account_id",  parentPk: "id", riskLevel: "high"     },
  { childTable: "sentinel_incidents",   parentTable: "sub_accounts",       childFk: "sub_account_id",  parentPk: "id", riskLevel: "high"     },
  { childTable: "sentinel_config",      parentTable: "sub_accounts",       childFk: "sub_account_id",  parentPk: "id", riskLevel: "medium"   },
  { childTable: "workflows",            parentTable: "sub_accounts",       childFk: "sub_account_id",  parentPk: "id", riskLevel: "high"     },
  { childTable: "legal_signals",        parentTable: "sub_accounts",       childFk: "sub_account_id",  parentPk: "id", riskLevel: "high"     },
  { childTable: "crash_reports",        parentTable: "sub_accounts",       childFk: "sub_account_id",  parentPk: "id", riskLevel: "critical" },
  { childTable: "contact_scores",       parentTable: "contacts",           childFk: "contact_id",      parentPk: "id", riskLevel: "medium"   },
  { childTable: "case_signals",         parentTable: "intelligence_cases", childFk: "case_id",         parentPk: "id", riskLevel: "high"     },
  { childTable: "case_signals",         parentTable: "legal_signals",      childFk: "signal_id",       parentPk: "id", riskLevel: "medium"   },
  { childTable: "intelligence_cases",   parentTable: "intelligence_entities", childFk: "entity_id",   parentPk: "id", riskLevel: "high"     },
  { childTable: "legal_lead_claims",    parentTable: "legal_leads",        childFk: "legal_lead_id",   parentPk: "id", riskLevel: "medium"   },
  { childTable: "home_service_lead_claims", parentTable: "home_service_leads", childFk: "lead_id",   parentPk: "id", riskLevel: "medium"   },
  { childTable: "contact_routing_audit", parentTable: "contacts",          childFk: "contact_id",      parentPk: "id", riskLevel: "low"      },
  { childTable: "contact_enrichment_events", parentTable: "contacts",      childFk: "contact_id",      parentPk: "id", riskLevel: "low"      },
];

async function tableExists(tableName: string): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${tableName}
      ) AS exists
    `);
    const rows = (result as any).rows ?? result;
    return Array.isArray(rows) && rows[0]?.exists === true;
  } catch {
    return false;
  }
}

async function scanOrphanGroup(check: OrphanCheck): Promise<OrphanGroup | null> {
  const childExists = await tableExists(check.childTable);
  const parentExists = await tableExists(check.parentTable);
  if (!childExists || !parentExists) return null;

  try {
    // Count orphans where child FK has no matching parent PK
    const countResult = await db.execute(sql.raw(`
      SELECT COUNT(*) AS n
      FROM "${check.childTable}" c
      WHERE c."${check.childFk}" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "${check.parentTable}" p
          WHERE p."${check.parentPk}" = c."${check.childFk}"
        )
      LIMIT 1
    `));
    const countRows = (countResult as any).rows ?? countResult;
    const orphanCount = Number(Array.isArray(countRows) ? countRows[0]?.n ?? 0 : 0);

    if (orphanCount === 0) return null;

    // Sample up to 5 orphan IDs
    const sampleResult = await db.execute(sql.raw(`
      SELECT c.id
      FROM "${check.childTable}" c
      WHERE c."${check.childFk}" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "${check.parentTable}" p
          WHERE p."${check.parentPk}" = c."${check.childFk}"
        )
      LIMIT 5
    `));
    const sampleRows = (sampleResult as any).rows ?? sampleResult;
    const sampleIds: number[] = Array.isArray(sampleRows)
      ? sampleRows.map((r: any) => Number(r.id)).filter(n => !isNaN(n))
      : [];

    return {
      table:        check.childTable,
      parentTable:  check.parentTable,
      foreignKey:   check.childFk,
      orphanCount,
      sampleIds,
      riskLevel:    check.riskLevel,
    };
  } catch (err: any) {
    console.warn(`[ORPHAN-DETECTOR] scan error ${check.childTable}.${check.childFk}: ${err?.message}`);
    return null;
  }
}

export async function detectOrphans(): Promise<OrphanDetectionReport> {
  const generatedAt = new Date().toISOString();

  const results = await Promise.allSettled(
    ORPHAN_CHECKS.map(check => scanOrphanGroup(check))
  );

  const allGroups: OrphanGroup[] = results
    .filter((r): r is PromiseFulfilledResult<OrphanGroup | null> => r.status === "fulfilled")
    .map(r => r.value)
    .filter((g): g is OrphanGroup => g !== null);

  const totalOrphanRecords = allGroups.reduce((sum, g) => sum + g.orphanCount, 0);

  const criticalGroups = allGroups.filter(g => g.riskLevel === "critical");
  const highGroups     = allGroups.filter(g => g.riskLevel === "high");
  const mediumGroups   = allGroups.filter(g => g.riskLevel === "medium");
  const lowGroups      = allGroups.filter(g => g.riskLevel === "low");

  let status: OrphanDetectionReport["status"];
  if (criticalGroups.length > 0) {
    status = "critical";
  } else if (highGroups.length > 0 || totalOrphanRecords > 0) {
    status = "degraded";
  } else {
    status = "clean";
  }

  if (status !== "clean") {
    console.warn(
      `[ORPHAN-DETECTOR] status=${status} orphan_groups=${allGroups.length} total_records=${totalOrphanRecords}`
    );
    for (const g of criticalGroups) {
      console.error(
        `[ORPHAN-DETECTOR] CRITICAL: ${g.table}.${g.foreignKey} → ${g.parentTable} — ${g.orphanCount} orphans`
      );
    }
  } else {
    console.log("[ORPHAN-DETECTOR] ✓ no orphaned records detected");
  }

  return {
    totalOrphanGroups: allGroups.length,
    totalOrphanRecords,
    criticalGroups,
    highGroups,
    mediumGroups,
    lowGroups,
    allGroups,
    status,
    generatedAt,
  };
}
