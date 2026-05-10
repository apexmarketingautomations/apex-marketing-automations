import { db } from "./db";
import { sql } from "drizzle-orm";
import { subAccounts } from "@shared/schema";
import { eq, or } from "drizzle-orm";

// Tables whose serial sequences drifted during the Replit→Neon migration.
// pg_get_serial_sequence resolves the actual sequence name, so this is safe
// even if the sequence was renamed.
const SEQUENCE_TABLES: Array<{ table: string; col: string }> = [
  { table: "agent_tasks",    col: "id" },
  { table: "system_logs",    col: "id" },
  { table: "agent_memories", col: "id" },
  { table: "agent_briefings",col: "id" },
];

export async function repairDriftedSequences() {
  for (const { table, col } of SEQUENCE_TABLES) {
    try {
      // 1. Resolve sequence name
      const seqRes = await db.execute(
        sql.raw(`SELECT pg_get_serial_sequence('${table}', '${col}') AS seq`)
      );
      const seqName: string | null = (seqRes as any)?.[0]?.seq ?? seqRes.rows?.[0]?.seq ?? null;
      if (!seqName) {
        console.warn(`[STARTUP-PATCH] ${table}: no serial sequence found — skipping`);
        continue;
      }

      // 2. Get MAX(id) and current sequence last_value in one query
      const infoRes = await db.execute(
        sql.raw(
          `SELECT COALESCE(MAX(id), 0) AS max_id, ` +
          `(SELECT last_value FROM ${seqName}) AS seq_val ` +
          `FROM "${table}"`
        )
      );
      const row = (infoRes as any)?.[0] ?? infoRes.rows?.[0];
      const maxId  = Number(row?.max_id  ?? 0);
      const seqVal = Number(row?.seq_val ?? 1);
      const target = maxId + 1;

      if (seqVal >= target) {
        console.log(`[STARTUP-PATCH] ${table}: seq OK (seq=${seqVal} max=${maxId})`);
        continue;
      }

      // 3. setval to MAX(id)+1 — false means next nextval() returns exactly target
      await db.execute(sql.raw(`SELECT setval('${seqName}', ${target}, false)`));
      console.log(`[STARTUP-PATCH] ${table}: seq REPAIRED seq=${seqVal}→${target} (max_id=${maxId})`);
    } catch (err: any) {
      console.warn(`[STARTUP-PATCH] ${table}: sequence repair failed (non-fatal): ${err?.message}`);
    }
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
      .where(
        or(...ids.map(id => eq(subAccounts.id, id)))
      );
    console.log(`[STARTUP-PATCH] Ensured accounts ${ids.join(" & ")} are unprotected`);
  } catch (err: any) {
    console.warn("[STARTUP-PATCH] Failed to ensure accounts unprotected:", err?.message);
  }
}
