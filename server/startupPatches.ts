import { db } from "./db";
import { subAccounts } from "@shared/schema";
import { inArray } from "drizzle-orm";

export async function ensureAccountsUnprotected() {
  try {
    await db.update(subAccounts)
      .set({ isProtected: false, protectedReason: null })
      .where(
        inArray(subAccounts.id, [13, 22])
      );
    console.log("[STARTUP-PATCH] Ensured accounts 13 & 22 are unprotected");
  } catch (err: any) {
    console.warn("[STARTUP-PATCH] Failed to ensure accounts unprotected:", err?.message);
  }
}
