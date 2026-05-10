import { db } from "./db";
import { sql } from "drizzle-orm";
import { subAccounts } from "@shared/schema";
import { eq, or } from "drizzle-orm";

export async function repairAgentTasksSequence() {
  try {
    await db.execute(
      sql`SELECT setval('agent_tasks_id_seq', GREATEST((SELECT COALESCE(MAX(id),0) FROM agent_tasks), 1))`
    );
    console.log("[STARTUP-PATCH] agent_tasks_id_seq repaired to MAX(id)");
  } catch (err: any) {
    console.warn("[STARTUP-PATCH] agent_tasks sequence repair failed (non-fatal):", err?.message);
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
