import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { subAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../storage";

const APEX_PARENT_ACCOUNT_ID = 13;
const DEFAULT_ACCOUNT_ID = APEX_PARENT_ACCOUNT_ID;

declare global {
  namespace Express {
    interface Request {
      tenant: {
        subAccountId: number;
      };
    }
  }
}

const ACCESS_CACHE_TTL_MS = 60_000;
const accessCache = new Map<string, { ok: boolean; ts: number }>();
const userFirstAccountCache = new Map<string, { id: number | null; ts: number }>();
const parentOwnerCache = new Map<string, { ok: boolean; ts: number }>();

function getCached<V>(map: Map<string, V & { ts: number }>, key: string): V | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > ACCESS_CACHE_TTL_MS) {
    map.delete(key);
    return null;
  }
  return hit;
}

function getUserId(user: any): string | null {
  if (!user) return null;
  return user.claims?.sub || user.id || null;
}

async function isApexParent(userId: string): Promise<boolean> {
  const cached = getCached(parentOwnerCache, userId);
  if (cached) return cached.ok;
  const parent = await storage.getSubAccount(APEX_PARENT_ACCOUNT_ID).catch((err) => { console.warn("[TENANT] promise rejected, using default null:", err instanceof Error ? err.message : err); return null; });
  const ok = !!(parent && parent.ownerUserId === userId);
  parentOwnerCache.set(userId, { ok, ts: Date.now() });
  return ok;
}

async function userHasAccessToAccount(userId: string, subAccountId: number): Promise<boolean> {
  const adminUserId = process.env.ADMIN_USER_ID;
  if (adminUserId && userId === adminUserId) return true;

  const cacheKey = `${userId}:${subAccountId}`;
  const cached = getCached(accessCache, cacheKey);
  if (cached) return cached.ok;

  let ok = false;
  try {
    const [account] = await db
      .select({ id: subAccounts.id, ownerUserId: subAccounts.ownerUserId })
      .from(subAccounts)
      .where(eq(subAccounts.id, subAccountId));
    if (account) {
      if (account.ownerUserId === userId) {
        ok = true;
      } else if (await isApexParent(userId)) {
        ok = true;
      }
    }
  } catch (err) {
    console.warn("[TENANT] caught:", err instanceof Error ? err.message : err);
    ok = false;
  }
  accessCache.set(cacheKey, { ok, ts: Date.now() });
  return ok;
}

async function getUserFirstAccountId(userId: string): Promise<number | null> {
  const cached = getCached(userFirstAccountCache, userId);
  if (cached) return cached.id;
  let id: number | null = null;
  try {
    const adminUserId = process.env.ADMIN_USER_ID;
    if (adminUserId && userId === adminUserId) {
      id = APEX_PARENT_ACCOUNT_ID;
    } else if (await isApexParent(userId)) {
      id = APEX_PARENT_ACCOUNT_ID;
    } else {
      const rows = await db
        .select({ id: subAccounts.id })
        .from(subAccounts)
        .where(eq(subAccounts.ownerUserId, userId))
        .limit(1);
      id = rows[0]?.id ?? null;
    }
  } catch (err) {
    console.warn("[TENANT] caught:", err instanceof Error ? err.message : err);
    id = null;
  }
  userFirstAccountCache.set(userId, { id, ts: Date.now() });
  return id;
}

export async function tenantMiddleware(req: Request, _res: Response, next: NextFunction) {
  let subAccountId: number = DEFAULT_ACCOUNT_ID;

  const headerVal = req.headers["x-sub-account-id"];
  const requestedId = headerVal ? parseInt(String(headerVal), 10) : NaN;
  const hasValidRequested = !isNaN(requestedId) && requestedId > 0;

  const adminUserIdEnv = process.env.ADMIN_USER_ID;
  const standaloneAdminSecret = process.env.STANDALONE_ADMIN_SECRET;
  const adminSecretHeader = (req.headers["x-admin-secret"] as string | undefined)?.trim();
  const isAdminBypass = !!(
    adminSecretHeader &&
    (
      (standaloneAdminSecret && adminSecretHeader === standaloneAdminSecret.trim()) ||
      (adminUserIdEnv && adminSecretHeader === adminUserIdEnv)
    )
  );

  if (isAdminBypass) {
    if (hasValidRequested) subAccountId = requestedId;
    req.tenant = { subAccountId };
    return next();
  }

  const isAuthed = typeof req.isAuthenticated === "function" && req.isAuthenticated();
  const userId = isAuthed ? getUserId((req as any).user) : null;

  if (userId) {
    if (hasValidRequested) {
      try {
        if (await userHasAccessToAccount(userId, requestedId)) {
          subAccountId = requestedId;
        } else {
          const fallback = await getUserFirstAccountId(userId);
          if (fallback) subAccountId = fallback;
        }
      } catch (err) {
        console.warn("[TENANT] caught:", err instanceof Error ? err.message : err);
        const fallback = await getUserFirstAccountId(userId).catch((err) => { console.warn("[TENANT] promise rejected, using default null:", err instanceof Error ? err.message : err); return null; });
        if (fallback) subAccountId = fallback;
      }
    } else {
      const fallback = await getUserFirstAccountId(userId);
      if (fallback) subAccountId = fallback;
    }
  }

  req.tenant = { subAccountId };
  next();
}

export function invalidateTenantAccessCache(userId?: string) {
  if (!userId) {
    accessCache.clear();
    userFirstAccountCache.clear();
    parentOwnerCache.clear();
    return;
  }
  for (const key of Array.from(accessCache.keys())) {
    if (key.startsWith(`${userId}:`)) accessCache.delete(key);
  }
  userFirstAccountCache.delete(userId);
  parentOwnerCache.delete(userId);
}
