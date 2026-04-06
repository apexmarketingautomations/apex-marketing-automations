import { db } from "../db";
import { subAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";

let _cachedLaylaId: number | null = null;
let _cachedProtectedIds: number[] | null = null;

export async function getLaylaAccountId(): Promise<number> {
  if (_cachedLaylaId !== null) return _cachedLaylaId;
  try {
    const [layla] = await db.select({ id: subAccounts.id })
      .from(subAccounts)
      .where(eq(subAccounts.name, "Officer Layla"))
      .limit(1);
    if (layla) {
      _cachedLaylaId = layla.id;
      return layla.id;
    }
  } catch {}
  return _cachedLaylaId ?? 22;
}

export async function getProtectedAccountIds(): Promise<number[]> {
  if (_cachedProtectedIds !== null) return _cachedProtectedIds;
  try {
    const rows = await db.select({ id: subAccounts.id })
      .from(subAccounts)
      .where(eq(subAccounts.isProtected, true));
    _cachedProtectedIds = rows.map(r => r.id);
    if (_cachedProtectedIds.length === 0) {
      _cachedProtectedIds = [13];
    }
    return _cachedProtectedIds;
  } catch {}
  return [13];
}

export function clearLaylaCache() {
  _cachedLaylaId = null;
  _cachedProtectedIds = null;
}
