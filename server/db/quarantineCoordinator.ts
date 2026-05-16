/**
 * server/db/quarantineCoordinator.ts
 *
 * Data Quarantine System
 *
 * Provides a safe, reversible mechanism for isolating suspicious records
 * without deleting them. Quarantined records:
 * - Are marked with quarantine metadata (reason, quarantine_id, operator)
 * - Are excluded from normal queries via application-level filters
 * - Can be reviewed, restored, or purged by an operator
 * - Generate an audit trail
 *
 * The quarantine table acts as a lightweight envelope — the original record
 * stays in its source table; only its ID and metadata are stored here.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

export interface QuarantineEntry {
  id: number;
  sourceTable: string;
  sourceId: number;
  reason: string;
  quarantinedBy: string;
  metadata: Record<string, any>;
  status: "quarantined" | "restored" | "purged";
  createdAt: string;
  resolvedAt?: string;
}

export interface QuarantineResult {
  ok: boolean;
  quarantineId?: number;
  error?: string;
}

export interface QuarantineStatusReport {
  totalQuarantined: number;
  byTable: Record<string, number>;
  byReason: Record<string, number>;
  pending: QuarantineEntry[];
  generatedAt: string;
}

// ── Ensure quarantine table exists ────────────────────────────────────────────

export async function ensureQuarantineTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _data_quarantine (
        id            SERIAL PRIMARY KEY,
        source_table  TEXT        NOT NULL,
        source_id     INTEGER     NOT NULL,
        reason        TEXT        NOT NULL,
        quarantined_by TEXT       NOT NULL DEFAULT 'system',
        metadata      JSONB       NOT NULL DEFAULT '{}',
        status        TEXT        NOT NULL DEFAULT 'quarantined',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at   TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS dq_source_lookup
        ON _data_quarantine (source_table, source_id);

      CREATE INDEX IF NOT EXISTS dq_status_idx
        ON _data_quarantine (status);
    `);
  } catch (err: any) {
    console.error("[QUARANTINE] Failed to ensure quarantine table:", err?.message);
    throw err;
  }
}

// ── Quarantine a single record ────────────────────────────────────────────────

export async function quarantineRecord(params: {
  sourceTable: string;
  sourceId: number;
  reason: string;
  quarantinedBy?: string;
  metadata?: Record<string, any>;
}): Promise<QuarantineResult> {
  try {
    await ensureQuarantineTable();

    const { sourceTable, sourceId, reason, quarantinedBy = "system", metadata = {} } = params;

    // Idempotent: don't re-quarantine if already active
    const existing = await db.execute(sql.raw(`
      SELECT id FROM _data_quarantine
      WHERE source_table = '${sourceTable}'
        AND source_id = ${sourceId}
        AND status = 'quarantined'
      LIMIT 1
    `));
    const existingRows = (existing as any).rows ?? existing;
    if (Array.isArray(existingRows) && existingRows.length > 0) {
      return { ok: true, quarantineId: Number(existingRows[0].id) };
    }

    const metaJson = JSON.stringify(metadata).replace(/'/g, "''");
    const result = await db.execute(sql.raw(`
      INSERT INTO _data_quarantine
        (source_table, source_id, reason, quarantined_by, metadata)
      VALUES
        ('${sourceTable}', ${sourceId}, '${reason.replace(/'/g, "''")}', '${quarantinedBy}', '${metaJson}'::jsonb)
      RETURNING id
    `));
    const rows = (result as any).rows ?? result;
    const quarantineId = Array.isArray(rows) && rows[0]?.id ? Number(rows[0].id) : undefined;

    console.log(`[QUARANTINE] ✎ ${sourceTable}#${sourceId} quarantined — reason=${reason} id=${quarantineId}`);
    return { ok: true, quarantineId };

  } catch (err: any) {
    console.error(`[QUARANTINE] Failed to quarantine ${params.sourceTable}#${params.sourceId}:`, err?.message);
    return { ok: false, error: err?.message };
  }
}

// ── Restore a quarantined record ──────────────────────────────────────────────

export async function restoreRecord(quarantineId: number, restoredBy: string = "operator"): Promise<QuarantineResult> {
  try {
    await db.execute(sql.raw(`
      UPDATE _data_quarantine
      SET status = 'restored', resolved_at = NOW(),
          metadata = metadata || '{"restored_by":"${restoredBy}"}'::jsonb
      WHERE id = ${quarantineId}
        AND status = 'quarantined'
    `));
    console.log(`[QUARANTINE] ✓ quarantine#${quarantineId} restored by ${restoredBy}`);
    return { ok: true, quarantineId };
  } catch (err: any) {
    return { ok: false, error: err?.message };
  }
}

// ── Get quarantine status report ──────────────────────────────────────────────

export async function getQuarantineStatus(): Promise<QuarantineStatusReport> {
  const generatedAt = new Date().toISOString();

  try {
    await ensureQuarantineTable();

    const [countResult, breakdownByTable, breakdownByReason, pendingResult] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*) AS n FROM _data_quarantine WHERE status = 'quarantined'
      `),
      db.execute(sql`
        SELECT source_table, COUNT(*) AS n
        FROM _data_quarantine WHERE status = 'quarantined'
        GROUP BY source_table
        ORDER BY n DESC
      `),
      db.execute(sql`
        SELECT reason, COUNT(*) AS n
        FROM _data_quarantine WHERE status = 'quarantined'
        GROUP BY reason
        ORDER BY n DESC
      `),
      db.execute(sql`
        SELECT id, source_table, source_id, reason, quarantined_by, metadata, status, created_at, resolved_at
        FROM _data_quarantine
        WHERE status = 'quarantined'
        ORDER BY created_at DESC
        LIMIT 50
      `),
    ]);

    const countRows = (countResult as any).rows ?? countResult;
    const totalQuarantined = Number(Array.isArray(countRows) ? countRows[0]?.n ?? 0 : 0);

    const tableRows = (breakdownByTable as any).rows ?? breakdownByTable;
    const byTable: Record<string, number> = {};
    if (Array.isArray(tableRows)) {
      tableRows.forEach((r: any) => { byTable[r.source_table] = Number(r.n); });
    }

    const reasonRows = (breakdownByReason as any).rows ?? breakdownByReason;
    const byReason: Record<string, number> = {};
    if (Array.isArray(reasonRows)) {
      reasonRows.forEach((r: any) => { byReason[r.reason] = Number(r.n); });
    }

    const pendingRows = (pendingResult as any).rows ?? pendingResult;
    const pending: QuarantineEntry[] = Array.isArray(pendingRows)
      ? pendingRows.map((r: any) => ({
          id:            Number(r.id),
          sourceTable:   r.source_table,
          sourceId:      Number(r.source_id),
          reason:        r.reason,
          quarantinedBy: r.quarantined_by,
          metadata:      typeof r.metadata === "object" ? r.metadata : {},
          status:        r.status,
          createdAt:     r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
          resolvedAt:    r.resolved_at ? (r.resolved_at instanceof Date ? r.resolved_at.toISOString() : String(r.resolved_at)) : undefined,
        }))
      : [];

    return { totalQuarantined, byTable, byReason, pending, generatedAt };

  } catch (err: any) {
    console.error("[QUARANTINE] Failed to read quarantine status:", err?.message);
    return { totalQuarantined: 0, byTable: {}, byReason: {}, pending: [], generatedAt };
  }
}

// ── Check if a record is quarantined ─────────────────────────────────────────

export async function isQuarantined(sourceTable: string, sourceId: number): Promise<boolean> {
  try {
    await ensureQuarantineTable();
    const result = await db.execute(sql.raw(`
      SELECT 1 FROM _data_quarantine
      WHERE source_table = '${sourceTable}'
        AND source_id = ${sourceId}
        AND status = 'quarantined'
      LIMIT 1
    `));
    const rows = (result as any).rows ?? result;
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}
