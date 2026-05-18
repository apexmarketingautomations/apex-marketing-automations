/**
 * server/auth/authorization.ts
 *
 * Centralized authorization helpers for Apex.
 *
 * ALL admin/bypass decisions must flow through this module.
 * Do not replicate inline ADMIN_USER_ID checks across route files.
 *
 * Admin identity is established via ANY of these signals (in priority order):
 *   1. STANDALONE_ADMIN_SECRET header  — internal service-to-service calls
 *   2. ADMIN_USER_ID env var match     — platform owner session (env-configured)
 *   3. user.isAdmin === "true"         — DB-level admin flag (set at account creation)
 *   4. user.role === "DEV_ADMIN"       — role field set by /api/auth/user for admin sessions
 */

import type { Request, Response, NextFunction } from "express";

// ── Internal helpers ──────────────────────────────────────────────────────────

function extractUserId(user: any): string | null {
  return user?.claims?.sub ?? user?.id ?? null;
}

/**
 * Returns true if the request carries a valid x-admin-secret header.
 * Used for internal service-to-service calls (Railway workers, cron, operator).
 */
export function hasAdminSecret(req: Request): boolean {
  const envSecret = process.env.STANDALONE_ADMIN_SECRET?.trim();
  if (!envSecret) return false;
  const headerSecret = (req.headers["x-admin-secret"] as string | undefined)?.trim();
  return !!headerSecret && headerSecret === envSecret;
}

/**
 * Returns true if the session user matches the ADMIN_USER_ID env var.
 */
export function isAdminUserIdMatch(user: any): boolean {
  const adminUserId = process.env.ADMIN_USER_ID?.trim();
  if (!adminUserId) return false;
  const userId = extractUserId(user);
  return !!userId && userId === adminUserId;
}

/**
 * Returns true if the session user has DB-level or role-level admin flags.
 * These are set by /api/auth/user when the session is verified as admin.
 */
export function isSessionAdmin(user: any): boolean {
  if (!user) return false;
  return user.isAdmin === "true" || user.role === "DEV_ADMIN";
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * isPlatformAdmin — the single source of truth for "is this caller a platform admin?"
 *
 * Checks all four signals. Use this everywhere instead of inline checks.
 */
export function isPlatformAdmin(req: Request): boolean {
  if (hasAdminSecret(req)) return true;
  const user = (req as any).user;
  if (isAdminUserIdMatch(user)) return true;
  if (isSessionAdmin(user)) return true;
  return false;
}

/**
 * canBypassBilling — returns true if the caller should skip subscription checks.
 * Currently equivalent to isPlatformAdmin; extracted for clarity and future flexibility.
 */
export function canBypassBilling(req: Request): boolean {
  return isPlatformAdmin(req);
}

/**
 * canBypassPlanLimits — returns true if the caller should skip per-plan usage limits.
 */
export function canBypassPlanLimits(req: Request): boolean {
  return isPlatformAdmin(req);
}

/**
 * canAccessInternalRoutes — returns true if the caller may hit /api/internal/* routes.
 * Requires either the admin secret header OR an admin session.
 */
export function canAccessInternalRoutes(req: Request): boolean {
  return isPlatformAdmin(req);
}

/**
 * resolveEffectiveTenant — returns the sub-account ID the request should operate on.
 * Admin callers may spoof any sub-account via x-sub-account-id header.
 * Regular callers are limited to accounts they own.
 */
export function resolveEffectiveTenant(req: Request, ownedAccountId: number | null): number | null {
  if (isPlatformAdmin(req)) {
    const override = req.headers["x-sub-account-id"];
    if (override) {
      const parsed = parseInt(Array.isArray(override) ? override[0] : override, 10);
      if (!isNaN(parsed)) return parsed;
    }
  }
  return ownedAccountId;
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * requirePlatformAdmin — Express middleware. Passes if isPlatformAdmin, else 403.
 * Use for routes that only the platform owner should reach.
 */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (isPlatformAdmin(req)) {
    console.log("[AUTH] [ADMIN-BYPASS] requirePlatformAdmin passed", {
      path: req.path,
      method: req.method,
      signal: hasAdminSecret(req) ? "secret" : isAdminUserIdMatch((req as any).user) ? "env-uid" : "session-flag",
    });
    next();
    return;
  }
  console.warn("[AUTH] [ADMIN-BYPASS] requirePlatformAdmin denied", {
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: extractUserId((req as any).user) ?? "unauthenticated",
  });
  res.status(403).json({ error: "Platform admin access required" });
}

/**
 * logAuthBypass — attach to any middleware chain to log when a bypass fires.
 * Call this right before next() in custom guards.
 */
export function logAuthBypass(req: Request, context: string): void {
  const user = (req as any).user;
  const signal = hasAdminSecret(req)
    ? "secret"
    : isAdminUserIdMatch(user)
    ? "env-uid"
    : "session-flag";
  console.log(`[AUTH] [ADMIN-BYPASS] ${context}`, {
    path: req.path,
    method: req.method,
    signal,
    userId: extractUserId(user) ?? "service-call",
  });
}
