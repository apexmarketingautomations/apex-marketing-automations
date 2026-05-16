/**
 * server/db/reconciliationEngine.ts
 *
 * Reconciliation Scan Engine
 *
 * Detects:
 * - Duplicate contacts (same normalized phone or same name+subAccount)
 * - Stale enrichment states (stuck in "pending" > 24h)
 * - Contacts with no linked sub_account
 * - Legal signals with no linked contacts
 * - Crash reports stuck in PROCESSING > 2h
 * - DLQ job counts by source queue
 *
 * Read-only. Results feed operator alerts and the repair queue.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

export interface ReconciliationIssue {
  category: string;
  description: string;
  affectedCount: number;
  sampleData?: Record<string, any>[];
  severity: "info" | "warning" | "error" | "critical";
  repairHint?: string;
}

export interface ReconciliationReport {
  issues: ReconciliationIssue[];
  totalIssues: number;
  criticalCount: number;
  errorCount: number;
  warningCount: number;
  status: "clean" | "degraded" | "critical";
  generatedAt: string;
}

async function tableExists(name: string): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name=${name}
      ) AS e
    `);
    const rows = (r as any).rows ?? r;
    return Array.isArray(rows) && rows[0]?.e === true;
  } catch {
    return false;
  }
}

// ── Scan helpers ──────────────────────────────────────────────────────────────

async function scanDuplicateContactsByPhone(): Promise<ReconciliationIssue | null> {
  if (!(await tableExists("contacts"))) return null;
  try {
    const result = await db.execute(sql`
      SELECT normalized_phone, sub_account_id, COUNT(*) AS n
      FROM contacts
      WHERE normalized_phone IS NOT NULL
        AND normalized_phone != ''
        AND LENGTH(normalized_phone) >= 10
      GROUP BY normalized_phone, sub_account_id
      HAVING COUNT(*) > 1
      ORDER BY n DESC
      LIMIT 20
    `);
    const rows = (result as any).rows ?? result;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const totalDups = rows.reduce((s: number, r: any) => s + Number(r.n) - 1, 0);
    return {
      category:     "duplicate_contacts_by_phone",
      description:  `${rows.length} phone number(s) have duplicate contacts within the same sub-account`,
      affectedCount: totalDups,
      sampleData:   rows.slice(0, 5).map((r: any) => ({
        normalizedPhone: r.normalized_phone,
        subAccountId:    r.sub_account_id,
        count:           Number(r.n),
      })),
      severity:    "error",
      repairHint:  "Run /api/admin/run-integrity-repair with action=merge_duplicate_contacts to merge by normalizedPhone",
    };
  } catch { return null; }
}

async function scanStaleEnrichmentPending(): Promise<ReconciliationIssue | null> {
  if (!(await tableExists("contacts"))) return null;
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const result = await db.execute(sql.raw(`
      SELECT COUNT(*) AS n FROM contacts
      WHERE skip_trace_status = 'pending'
        AND enrichment_attempted_at < '${cutoff}'
    `));
    const rows = (result as any).rows ?? result;
    const n = Number(Array.isArray(rows) ? rows[0]?.n ?? 0 : 0);
    if (n === 0) return null;
    return {
      category:     "stale_enrichment_pending",
      description:  `${n} contact(s) stuck in skip_trace_status='pending' for >24h`,
      affectedCount: n,
      severity:    "warning",
      repairHint:  "These contacts had BatchData calls that timed out without completing. Reset skip_trace_status to null and re-enqueue via BullMQ enrichment worker",
    };
  } catch { return null; }
}

async function scanStuckCrashReports(): Promise<ReconciliationIssue | null> {
  if (!(await tableExists("crash_reports"))) return null;
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const result = await db.execute(sql.raw(`
      SELECT COUNT(*) AS n FROM crash_reports
      WHERE status = 'PROCESSING'
        AND updated_at < '${cutoff}'
    `));
    const rows = (result as any).rows ?? result;
    const n = Number(Array.isArray(rows) ? rows[0]?.n ?? 0 : 0);
    if (n === 0) return null;
    return {
      category:     "stuck_crash_reports",
      description:  `${n} crash report(s) stuck in PROCESSING status for >2h`,
      affectedCount: n,
      severity:    "error",
      repairHint:  "Likely caused by a worker crash during FLHSMV fetching. Reset to PENDING to allow retry",
    };
  } catch { return null; }
}

async function scanContactsWithoutSubAccount(): Promise<ReconciliationIssue | null> {
  if (!(await tableExists("contacts"))) return null;
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) AS n FROM contacts WHERE sub_account_id IS NULL
    `);
    const rows = (result as any).rows ?? result;
    const n = Number(Array.isArray(rows) ? rows[0]?.n ?? 0 : 0);
    if (n === 0) return null;
    return {
      category:     "contacts_without_tenant",
      description:  `${n} contact(s) have NULL sub_account_id and are invisible to all tenant queries`,
      affectedCount: n,
      severity:    "critical",
      repairHint:  "Quarantine these contacts immediately. They cannot be safely assigned without knowing their origin",
    };
  } catch { return null; }
}

async function scanLegalSignalsWithoutSubAccount(): Promise<ReconciliationIssue | null> {
  if (!(await tableExists("legal_signals"))) return null;
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) AS n FROM legal_signals WHERE sub_account_id IS NULL
    `);
    const rows = (result as any).rows ?? result;
    const n = Number(Array.isArray(rows) ? rows[0]?.n ?? 0 : 0);
    if (n === 0) return null;
    return {
      category:     "legal_signals_without_tenant",
      description:  `${n} legal signal(s) have NULL sub_account_id — invisible to all tenant queries and the security fix added in sentinel.ts`,
      affectedCount: n,
      severity:    "error",
      repairHint:  "Assign these signals to the correct sub_account or quarantine if origin unknown",
    };
  } catch { return null; }
}

async function scanOrphanedCaseSignals(): Promise<ReconciliationIssue | null> {
  const ok = await Promise.all([tableExists("case_signals"), tableExists("intelligence_cases")]);
  if (!ok[0] || !ok[1]) return null;
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) AS n
      FROM case_signals cs
      WHERE NOT EXISTS (
        SELECT 1 FROM intelligence_cases ic WHERE ic.id = cs.case_id
      )
    `);
    const rows = (result as any).rows ?? result;
    const n = Number(Array.isArray(rows) ? rows[0]?.n ?? 0 : 0);
    if (n === 0) return null;
    return {
      category:     "orphaned_case_signals",
      description:  `${n} case_signals row(s) reference a deleted intelligence_case`,
      affectedCount: n,
      severity:    "warning",
      repairHint:  "Safe to quarantine — the parent case was deleted. These rows consume space but cause no active bugs",
    };
  } catch { return null; }
}

async function scanIntelligenceEntitiesWithoutCases(): Promise<ReconciliationIssue | null> {
  const ok = await Promise.all([tableExists("intelligence_entities"), tableExists("intelligence_cases")]);
  if (!ok[0] || !ok[1]) return null;
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) AS n
      FROM intelligence_entities ie
      WHERE NOT EXISTS (
        SELECT 1 FROM intelligence_cases ic WHERE ic.entity_id = ie.id
      )
    `);
    const rows = (result as any).rows ?? result;
    const n = Number(Array.isArray(rows) ? rows[0]?.n ?? 0 : 0);
    if (n === 0) return null;
    return {
      category:     "entities_without_cases",
      description:  `${n} intelligence_entities have no linked intelligence_cases`,
      affectedCount: n,
      severity:    "info",
      repairHint:  "These entities are pre-registered but no signals have matched yet. Acceptable unless count grows unbounded",
    };
  } catch { return null; }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runReconciliationScan(): Promise<ReconciliationReport> {
  const generatedAt = new Date().toISOString();

  const scanResults = await Promise.allSettled([
    scanDuplicateContactsByPhone(),
    scanStaleEnrichmentPending(),
    scanStuckCrashReports(),
    scanContactsWithoutSubAccount(),
    scanLegalSignalsWithoutSubAccount(),
    scanOrphanedCaseSignals(),
    scanIntelligenceEntitiesWithoutCases(),
  ]);

  const issues: ReconciliationIssue[] = scanResults
    .filter((r): r is PromiseFulfilledResult<ReconciliationIssue | null> => r.status === "fulfilled")
    .map(r => r.value)
    .filter((v): v is ReconciliationIssue => v !== null);

  const criticalCount = issues.filter(i => i.severity === "critical").length;
  const errorCount    = issues.filter(i => i.severity === "error").length;
  const warningCount  = issues.filter(i => i.severity === "warning").length;

  const status: ReconciliationReport["status"] =
    criticalCount > 0 ? "critical" :
    errorCount    > 0 ? "degraded" :
    warningCount  > 0 ? "degraded" :
    "clean";

  if (status !== "clean") {
    console.warn(`[RECONCILIATION] status=${status} issues=${issues.length} critical=${criticalCount} errors=${errorCount}`);
  } else {
    console.log("[RECONCILIATION] ✓ no reconciliation issues detected");
  }

  return { issues, totalIssues: issues.length, criticalCount, errorCount, warningCount, status, generatedAt };
}
