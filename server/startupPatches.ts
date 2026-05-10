import { db } from "./db";
import { subAccounts } from "@shared/schema";
import { eq, or } from "drizzle-orm";

// Sequence audit/repair is now handled by server/startup/sequenceAudit.ts
// which auto-discovers ALL serial sequences — no hardcoded table list needed.

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
