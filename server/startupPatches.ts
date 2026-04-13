import { db } from "./db";
import { subAccounts } from "@shared/schema";
import { eq, or } from "drizzle-orm";

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
