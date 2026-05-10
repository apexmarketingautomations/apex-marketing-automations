import { pool } from "./db";
import { db } from "./db";
import { subAccounts } from "@shared/schema";
import { eq, or } from "drizzle-orm";

const SEQUENCE_TABLES: Array<{ table: string; col: string }> = [
  { table: "agent_tasks",     col: "id" },
  { table: "system_logs",     col: "id" },
  { table: "agent_memories",  col: "id" },
  { table: "agent_briefings", col: "id" },
];

export async function repairDriftedSequences() {
  console.log("[STARTUP-PATCH] repairDriftedSequences: acquiring DB client");
  let client: any;
  try {
    client = await pool.connect();
  } catch (connErr: any) {
    console.error("[STARTUP-PATCH] repairDriftedSequences: pool.connect() failed:", connErr?.message);
    return;
  }
  console.log("[STARTUP-PATCH] repairDriftedSequences: DB client acquired, checking", SEQUENCE_TABLES.length, "sequences");

  try {
    for (const { table, col } of SEQUENCE_TABLES) {
      try {
        // 1. Resolve sequence name via pg_get_serial_sequence
        const seqRes = await client.query(
          `SELECT pg_get_serial_sequence($1, $2) AS seq`,
          [table, col]
        );
        const seqName: string | null = seqRes.rows[0]?.seq ?? null;
        if (!seqName) {
          console.warn(`[STARTUP-PATCH] ${table}: no serial sequence found — skipping`);
          continue;
        }

        // 2. Get MAX(id) and sequence last_value together
        const infoRes = await client.query(
          `SELECT COALESCE(MAX(id), 0) AS max_id, last_value AS seq_val FROM "${table}", ${seqName}`
        );
        const maxId  = Number(infoRes.rows[0]?.max_id  ?? 0);
        const seqVal = Number(infoRes.rows[0]?.seq_val ?? 1);
        const target = maxId + 1;

        if (seqVal >= target) {
          console.log(`[STARTUP-PATCH] ${table}: seq OK (seq=${seqVal} max_id=${maxId})`);
          continue;
        }

        // 3. setval(seq, target, false) — next nextval() returns exactly target
        await client.query(`SELECT setval($1, $2, false)`, [seqName, target]);
        console.log(`[STARTUP-PATCH] ${table}: REPAIRED ${seqVal} → ${target} (max_id=${maxId})`);
      } catch (err: any) {
        console.warn(`[STARTUP-PATCH] ${table}: repair failed: ${err?.message}`);
      }
    }
  } finally {
    client.release();
  }
}

export async function ensureAccountsUnprotected() {
  try {
    const apexId = 13;
    const [layla] = await db.select({ id: subAccounts.id })
      .from(subAccounts)
      .where(eq(subAccounts.name, "Officer Layla"))
      .limit(1);
    const laylaId = layla?.id;
    const ids = [apexId, ...(laylaId ? [laylaId] : [])];
    await db.update(subAccounts)
      .set({ isProtected: false, protectedReason: null })
      .where(or(...ids.map(id => eq(subAccounts.id, id))));
    console.log(`[STARTUP-PATCH] accounts ${ids.join(" & ")} unprotected`);
  } catch (err: any) {
    console.warn("[STARTUP-PATCH] ensureAccountsUnprotected failed:", err?.message);
  }
}
