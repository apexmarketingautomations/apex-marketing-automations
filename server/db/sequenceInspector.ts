/**
 * server/db/sequenceInspector.ts
 *
 * Read-only sequence drift inspector.
 *
 * Unlike sequenceAudit.ts (which auto-repairs), this module only REPORTS
 * drift so the /api/admin/sequence-audit endpoint can surface it without
 * side effects. Operators trigger repair manually via the existing
 * auditAndRepairSequences() in startup/sequenceAudit.ts.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

export interface SequenceDriftEntry {
  table:        string;
  column:       string;
  sequence:     string;
  maxId:        number;
  lastValue:    number;
  drift:        number;
  status:       "ok" | "drifted" | "empty" | "error";
  error?:       string;
}

export interface SequenceAuditReport {
  sequences:      SequenceDriftEntry[];
  totalChecked:   number;
  driftedCount:   number;
  okCount:        number;
  errorCount:     number;
  status:         "healthy" | "degraded" | "critical";
  generatedAt:    string;
}

export async function inspectSequences(): Promise<SequenceAuditReport> {
  const generatedAt = new Date().toISOString();
  const entries: SequenceDriftEntry[] = [];

  try {
    // Discover all sequences owned by table columns
    const discoveryResult = await db.execute(sql`
      SELECT
        c.relname   AS table_name,
        a.attname   AS column_name,
        s.relname   AS sequence_name
      FROM pg_class      s
      JOIN pg_depend     d  ON d.objid       = s.oid
      JOIN pg_class      c  ON d.refobjid   = c.oid
      JOIN pg_attribute  a  ON a.attrelid   = c.oid
                            AND a.attnum    = d.refobjsubid
      WHERE s.relkind = 'S'
      ORDER BY c.relname, a.attname
    `);

    const sequences = (discoveryResult as any).rows ?? discoveryResult;
    if (!Array.isArray(sequences)) {
      return { sequences: [], totalChecked: 0, driftedCount: 0, okCount: 0, errorCount: 0, status: "healthy", generatedAt };
    }

    for (const seq of sequences) {
      const table    = seq.table_name as string;
      const column   = seq.column_name as string;
      const sequence = seq.sequence_name as string;

      try {
        // Get max id from table
        const maxResult = await db.execute(
          sql.raw(`SELECT COALESCE(MAX(${column}), 0) AS max_id FROM "${table}"`)
        );
        const maxRows = (maxResult as any).rows ?? maxResult;
        const maxId = Number(Array.isArray(maxRows) ? maxRows[0]?.max_id ?? 0 : 0);

        if (maxId === 0) {
          entries.push({ table, column, sequence, maxId: 0, lastValue: 0, drift: 0, status: "empty" });
          continue;
        }

        // Get sequence last_value
        const seqResult = await db.execute(
          sql.raw(`SELECT last_value FROM "${sequence}"`)
        );
        const seqRows = (seqResult as any).rows ?? seqResult;
        const lastValue = Number(Array.isArray(seqRows) ? seqRows[0]?.last_value ?? 0 : 0);

        const drift = maxId - lastValue;

        if (lastValue > maxId) {
          entries.push({ table, column, sequence, maxId, lastValue, drift: 0, status: "ok" });
        } else {
          entries.push({ table, column, sequence, maxId, lastValue, drift, status: "drifted" });
        }
      } catch (err: any) {
        const msg = err?.message ?? "";
        if (msg.includes("does not exist") || msg.includes("relation")) continue; // skip internal tables
        entries.push({ table, column, sequence, maxId: 0, lastValue: 0, drift: 0, status: "error", error: msg });
      }
    }
  } catch (err: any) {
    return {
      sequences: [{ table: "_discovery", column: "_", sequence: "_", maxId: 0, lastValue: 0, drift: 0, status: "error", error: err?.message }],
      totalChecked: 0, driftedCount: 0, okCount: 0, errorCount: 1,
      status: "degraded",
      generatedAt,
    };
  }

  const driftedCount = entries.filter(e => e.status === "drifted").length;
  const okCount      = entries.filter(e => e.status === "ok" || e.status === "empty").length;
  const errorCount   = entries.filter(e => e.status === "error").length;

  const status: SequenceAuditReport["status"] =
    driftedCount > 0 ? "critical" :
    errorCount   > 0 ? "degraded" :
    "healthy";

  return {
    sequences: entries,
    totalChecked: entries.length,
    driftedCount,
    okCount,
    errorCount,
    status,
    generatedAt,
  };
}
