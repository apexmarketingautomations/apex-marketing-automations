import type { Request, Response, NextFunction } from "express";
import { isPlatformAdmin, hasAdminSecret, logAuthBypass } from "../auth/authorization";

/**
 * Middleware for routes that are only callable by internal services
 * (Railway workers, cron jobs, operator tooling, internal API chaining).
 *
 * Auth mechanism: x-admin-secret header must match STANDALONE_ADMIN_SECRET env var.
 * This is the same secret already used by all internal callers in this system.
 *
 * Usage:
 *   app.post("/api/internal/some-route", internalOnly, handler);
 *
 * Internal callers must include:
 *   headers: { "x-admin-secret": process.env.STANDALONE_ADMIN_SECRET }
 */
export function internalOnly(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.STANDALONE_ADMIN_SECRET?.trim();
  if (!secret) {
    console.error("[AUTH] [INTERNAL-ONLY] STANDALONE_ADMIN_SECRET not set; blocking request", {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    res.status(503).json({ error: "Internal route not configured" });
    return;
  }

  if (!hasAdminSecret(req)) {
    console.warn("[AUTH] [INTERNAL-ONLY] Denied — missing or invalid x-admin-secret", {
      path: req.path,
      method: req.method,
      ip: req.ip,
      traceId: req.headers["x-trace-id"] ?? null,
    });
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  logAuthBypass(req, "internalOnly");
  next();
}

/**
 * Express-compatible middleware that also allows an authenticated admin session
 * (isAdmin === "true" on the session user) in addition to the x-admin-secret header.
 * Use this for routes reachable by both UI admin users and internal services.
 */
export function internalOrAdmin(req: Request, res: Response, next: NextFunction): void {
  if (isPlatformAdmin(req)) {
    logAuthBypass(req, "internalOrAdmin");
    next();
    return;
  }

  console.warn("[AUTH] [INTERNAL-ONLY] internalOrAdmin denied", {
    path: req.path,
    method: req.method,
    ip: req.ip,
  });
  res.status(403).json({ error: "Admin or internal access required" });
}
