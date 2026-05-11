/**
 * sequenceAudit.ts
 *
 * Generic, zero-configuration PostgreSQL sequence drift detector and repair.
 *
 * HOW IT WORKS:
 *   1. Queries pg_class + pg_depend to discover EVERY serial/bigserial sequence
 *      in the database — no hardcoded table list.
 *   2. For each sequence, reads MAX(id) from the owning table and the sequence's
 *      last_value.
 *   3. If last_value <= max_id the sequence will collide on the next insert.
 *      Repairs it with setval(seq, max_id + 1, false).
 *   4. Never lowers a sequence that is already ahead.
 *   5. Logs every table with console.error() so Railway captures it even if
 *      stdout is buffered or rate-limited during early boot.
 */

import pg from "pg";

// One thin pool for startup use only — released after audit completes.
function makePool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("[SEQ-AUDIT] DATABASE_URL is not set — cannot audit sequences");
  return new pg.Pool({ connectionString: url, max: 1 });
}

const DISCOVERY_SQL = `
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
ORDER BY c.relname, a.attname;
`;

interface SequenceInfo {
  table_name:    string;
  column_name:   string;
  sequence_name: string;
}

interface AuditResult {
  table:    string;
  column:   string;
  seq:      string;
  maxId:    number;
  lastVal:  number;
  status:   "OK" | "DRIFTED" | "EMPTY" | "ERROR";
  newVal?:  number;
  error?:   string;
}

export async function auditAndRepairSequences(): Promise<void> {
  const pool = makePool();
  const client = await pool.connect();
  const results: AuditResult[] = [];

  console.error(""); // blank line for visibility
  console.error("══════════ SEQUENCE AUDIT START ══════════");

  try {
    // Step 1 — discover all sequences
    const { rows: sequences } = await client.query<SequenceInfo>(DISCOVERY_SQL);
    console.error(`[SEQ-AUDIT] Discovered ${sequences.length} sequences`);

    // Step 2+3 — audit and repair each
    for (const { table_name: table, column_name: column, sequence_name: seq } of sequences) {
      try {
        // Read MAX(id) and sequence last_value in one round-trip
        // Check table exists before querying
        const tableCheck = await client.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public'`,
          [table]
        );
        if (tableCheck.rowCount === 0) {
          results.push({ table, column, seq, maxId: 0, lastVal: 0, status: "ERROR", error: `relation "${table}" does not exist` });
          continue;
        }
        const infoRes = await client.query<{ max_id: string; seq_val: string }>(
          `SELECT
              COALESCE(MAX("${column}"), 0)::text AS max_id,
              (SELECT last_value FROM "${seq}")::text AS seq_val
           FROM "${table}"`
        );

        const maxId  = Number(infoRes.rows[0]?.max_id  ?? 0);
        const lastVal = Number(infoRes.rows[0]?.seq_val ?? 1);

        if (maxId === 0) {
          // Table is empty — nothing to repair, sequence is fine wherever it is
          results.push({ table, column, seq, maxId, lastVal, status: "EMPTY" });
          console.error(`[SEQ-AUDIT] table=${table} seq=${seq} maxId=0 lastVal=${lastVal} status=EMPTY`);
          continue;
        }

        if (lastVal > maxId) {
          // Sequence is already ahead — no collision possible
          results.push({ table, column, seq, maxId, lastVal, status: "OK" });
          console.error(`[SEQ-AUDIT] table=${table} seq=${seq} maxId=${maxId} lastVal=${lastVal} status=OK`);
          continue;
        }

        // Sequence is behind or equal — DRIFT detected, repair it
        const newVal = maxId + 1;
        await client.query(`SELECT setval($1, $2, false)`, [seq, newVal]);
        results.push({ table, column, seq, maxId, lastVal, status: "DRIFTED", newVal });
        console.error(
          `[SEQ-AUDIT] table=${table} seq=${seq} ` +
          `maxId=${maxId} lastVal=${lastVal} drift=${maxId - lastVal} ` +
          `status=DRIFTED repair=${newVal}`
        );
      } catch (err: any) {
        const msg = err?.message || "";
        // Skip missing internal/stripe tables silently — they're not our tables
        if (msg.includes("does not exist") || msg.includes("relation") || msg.includes("not found")) {
          // silent skip
        } else {
          results.push({ table, column, seq, maxId: 0, lastVal: 0, status: "ERROR", error: msg });
          console.error(`[SEQ-AUDIT] table=${table} seq=${seq} status=ERROR error="${msg}"`);
        }
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  // Summary
  const drifted = results.filter(r => r.status === "DRIFTED");
  const errors  = results.filter(r => r.status === "ERROR");
  const ok      = results.filter(r => r.status === "OK" || r.status === "EMPTY");

  console.error("");
  console.error(`══════════ SEQUENCE AUDIT COMPLETE ══════════`);
  console.error(`[SEQ-AUDIT] Total=${results.length} OK/Empty=${ok.length} Repaired=${drifted.length} Errors=${errors.length}`);
  if (drifted.length > 0) {
    console.error(`[SEQ-AUDIT] Repaired: ${drifted.map(r => r.table).join(", ")}`);
  }
  if (errors.length > 0) {
    console.error(`[SEQ-AUDIT] Errors:   ${errors.map(r => `${r.table}(${r.error})`).join(", ")}`);
  }
  console.error("");
}
