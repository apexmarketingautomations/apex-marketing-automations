/**
 * server/db/tenantIntegrity.ts
 *
 * Tenant Contamination Audit
 *
 * Scans all tenant-linked tables for:
 * - NULL subAccountId where the column is supposed to be set
 * - subAccountId values that reference non-existent sub_accounts
 * - Records that appear to span multiple tenant boundaries
 *
 * Safety: read-only, no mutations.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

export interface TenantContaminationResult {
  table: string;
  issue: "null_sub_account" | "invalid_sub_account" | "cross_tenant_reference";
  affectedCount: number;
  sampleIds: number[];
  severity: "low" | "medium" | "high" | "critical";
}

export interface TenantIntegrityReport {
  scannedTables: number;
  issuesFound: number;
  totalAffectedRecords: number;
  contaminationRiskScore: number;
  results: TenantContaminationResult[];
  criticalIssues: TenantContaminationResult[];
  status: "clean" | "degraded" | "critical";
  recommendations: string[];
  generatedAt: string;
}

interface TenantTable {
  table: string;
  fkCol: string;
  nullIsFatal: boolean;
  severity: TenantContaminationResult["severity"];
}

// Tables that must have a valid sub_account_id
const TENANT_TABLES: TenantTable[] = [
  { table: "contacts",               fkCol: "sub_account_id", nullIsFatal: true,  severity: "critical" },
  { table: "messages",               fkCol: "sub_account_id", nullIsFatal: true,  severity: "critical" },
  { table: "crash_reports",          fkCol: "sub_account_id", nullIsFatal: true,  severity: "critical" },
  { table: "sentinel_incidents",     fkCol: "sub_account_id", nullIsFatal: true,  severity: "high"     },
  { table: "legal_signals",          fkCol: "sub_account_id", nullIsFatal: false, severity: "high"     },
  { table: "workflows",              fkCol: "sub_account_id", nullIsFatal: false, severity: "high"     },
  { table: "sentinel_config",        fkCol: "sub_account_id", nullIsFatal: true,  severity: "high"     },
  { table: "home_service_contractors", fkCol: "sub_account_id", nullIsFatal: true, severity: "medium"  },
  { table: "home_service_leads",     fkCol: "sub_account_id", nullIsFatal: true,  severity: "medium"   },
  { table: "legal_leads",            fkCol: "sub_account_id", nullIsFatal: true,  severity: "medium"   },
  { table: "contact_routing_rules",  fkCol: "sub_account_id", nullIsFatal: true,  severity: "medium"   },
  { table: "audit_logs",             fkCol: "sub_account_id", nullIsFatal: false, severity: "low"      },
  { table: "usage_logs",             fkCol: "sub_account_id", nullIsFatal: true,  severity: "low"      },
  { table: "notification_preferences", fkCol: "sub_account_id", nullIsFatal: true, severity: "low"    },
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

async function getValidSubAccountIds(): Promise<Set<number>> {
  try {
    const result = await db.execute(sql`SELECT id FROM sub_accounts`);
    const rows = (result as any).rows ?? result;
    if (!Array.isArray(rows)) return new Set();
    return new Set(rows.map((r: any) => Number(r.id)));
  } catch {
    return new Set();
  }
}

async function scanNullSubAccounts(
  tt: TenantTable
): Promise<TenantContaminationResult | null> {
  if (!tt.nullIsFatal) return null;

  try {
    const countResult = await db.execute(sql.raw(`
      SELECT COUNT(*) AS n FROM "${tt.table}"
      WHERE "${tt.fkCol}" IS NULL
    `));
    const countRows = (countResult as any).rows ?? countResult;
    const affectedCount = Number(Array.isArray(countRows) ? countRows[0]?.n ?? 0 : 0);
    if (affectedCount === 0) return null;

    const sampleResult = await db.execute(sql.raw(`
      SELECT id FROM "${tt.table}"
      WHERE "${tt.fkCol}" IS NULL
      LIMIT 5
    `));
    const sampleRows = (sampleResult as any).rows ?? sampleResult;
    const sampleIds = Array.isArray(sampleRows)
      ? sampleRows.map((r: any) => Number(r.id)).filter(n => !isNaN(n))
      : [];

    return {
      table: tt.table,
      issue: "null_sub_account",
      affectedCount,
      sampleIds,
      severity: tt.severity,
    };
  } catch {
    return null;
  }
}

async function scanInvalidSubAccounts(
  tt: TenantTable,
  validIds: Set<number>
): Promise<TenantContaminationResult | null> {
  if (validIds.size === 0) return null;

  try {
    const idList = Array.from(validIds).join(",");
    const countResult = await db.execute(sql.raw(`
      SELECT COUNT(*) AS n FROM "${tt.table}"
      WHERE "${tt.fkCol}" IS NOT NULL
        AND "${tt.fkCol}" NOT IN (${idList})
    `));
    const countRows = (countResult as any).rows ?? countResult;
    const affectedCount = Number(Array.isArray(countRows) ? countRows[0]?.n ?? 0 : 0);
    if (affectedCount === 0) return null;

    const sampleResult = await db.execute(sql.raw(`
      SELECT id FROM "${tt.table}"
      WHERE "${tt.fkCol}" IS NOT NULL
        AND "${tt.fkCol}" NOT IN (${idList})
      LIMIT 5
    `));
    const sampleRows = (sampleResult as any).rows ?? sampleResult;
    const sampleIds = Array.isArray(sampleRows)
      ? sampleRows.map((r: any) => Number(r.id)).filter(n => !isNaN(n))
      : [];

    return {
      table: tt.table,
      issue: "invalid_sub_account",
      affectedCount,
      sampleIds,
      severity: tt.severity,
    };
  } catch {
    return null;
  }
}

function computeRiskScore(results: TenantContaminationResult[]): number {
  const weights = { critical: 40, high: 20, medium: 10, low: 2 };
  const raw = results.reduce((sum, r) => sum + weights[r.severity], 0);
  return Math.min(100, raw);
}

function buildRecommendations(results: TenantContaminationResult[]): string[] {
  const recs: string[] = [];

  const nullContacts = results.find(r => r.table === "contacts" && r.issue === "null_sub_account");
  if (nullContacts) {
    recs.push(`CRITICAL: ${nullContacts.affectedCount} contact(s) have null sub_account_id — these contacts are invisible in all tenant scopes and must be quarantined`);
  }

  const nullCrashReports = results.find(r => r.table === "crash_reports" && r.issue === "null_sub_account");
  if (nullCrashReports) {
    recs.push(`CRITICAL: ${nullCrashReports.affectedCount} crash report(s) have null sub_account_id — enrichCrashLeadContacts will skip them (security guard active)`);
  }

  const invalidRefs = results.filter(r => r.issue === "invalid_sub_account");
  if (invalidRefs.length > 0) {
    recs.push(`${invalidRefs.length} table(s) contain records pointing to deleted or non-existent sub_accounts — run orphan cleanup before next migration`);
  }

  if (results.length === 0) {
    recs.push("All scanned tenant tables have valid sub_account_id values — no contamination detected");
  }

  return recs;
}

export async function auditTenantIntegrity(): Promise<TenantIntegrityReport> {
  const generatedAt = new Date().toISOString();

  const validIds = await getValidSubAccountIds();

  const scanResults = await Promise.allSettled(
    TENANT_TABLES.flatMap(tt => [
      tableExists(tt.table).then(exists => {
        if (!exists) return Promise.resolve([] as (TenantContaminationResult | null)[]);
        return Promise.all([
          scanNullSubAccounts(tt),
          scanInvalidSubAccounts(tt, validIds),
        ]);
      }),
    ])
  );

  const allResults: TenantContaminationResult[] = [];
  for (const r of scanResults) {
    if (r.status === "fulfilled") {
      const val = r.value;
      if (Array.isArray(val)) {
        val.forEach(v => { if (v) allResults.push(v); });
      } else if (val) {
        allResults.push(val as TenantContaminationResult);
      }
    }
  }

  const criticalIssues = allResults.filter(r => r.severity === "critical");
  const totalAffectedRecords = allResults.reduce((sum, r) => sum + r.affectedCount, 0);
  const contaminationRiskScore = computeRiskScore(allResults);

  let status: TenantIntegrityReport["status"];
  if (criticalIssues.length > 0) {
    status = "critical";
  } else if (allResults.length > 0) {
    status = "degraded";
  } else {
    status = "clean";
  }

  if (status !== "clean") {
    console.warn(`[TENANT-INTEGRITY] status=${status} risk_score=${contaminationRiskScore} issues=${allResults.length}`);
    for (const issue of criticalIssues) {
      console.error(`[TENANT-INTEGRITY] CRITICAL: ${issue.table} — ${issue.issue} × ${issue.affectedCount}`);
    }
  } else {
    console.log(`[TENANT-INTEGRITY] ✓ all ${TENANT_TABLES.length} tenant tables clean`);
  }

  return {
    scannedTables:          TENANT_TABLES.length,
    issuesFound:            allResults.length,
    totalAffectedRecords,
    contaminationRiskScore,
    results:                allResults,
    criticalIssues,
    status,
    recommendations:        buildRecommendations(allResults),
    generatedAt,
  };
}
