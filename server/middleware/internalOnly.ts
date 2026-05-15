import type { Request, Response, NextFunction } from "express";

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
    // Misconfigured environment — fail closed
    console.error("[INTERNAL-ONLY] STANDALONE_ADMIN_SECRET not set; blocking request", {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    res.status(503).json({ error: "Internal route not configured" });
    return;
  }

  const provided = (req.headers["x-admin-secret"] as string | undefined)?.trim();
  if (!provided || provided !== secret) {
    console.warn("[INTERNAL-ONLY] Denied", {
      path: req.path,
      method: req.method,
      ip: req.ip,
      hasHeader: !!provided,
      traceId: req.headers["x-trace-id"] ?? null,
    });
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

/**
 * Express-compatible middleware that also allows an authenticated admin session
 * (isAdmin === "true" on the session user) in addition to the x-admin-secret header.
 * Use this for routes reachable by both UI admin users and internal services.
 */
export function internalOrAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user;
  const isSessionAdmin = user?.isAdmin === "true";
  if (isSessionAdmin) {
    next();
    return;
  }

  const adminUserId = process.env.ADMIN_USER_ID?.trim();
  const userId: string | undefined = user?.claims?.sub ?? user?.id;
  if (adminUserId && userId === adminUserId) {
    next();
    return;
  }

  // Fall through to secret-based check
  internalOnly(req, res, next);
}
