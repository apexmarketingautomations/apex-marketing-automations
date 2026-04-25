import type { Request, Response, NextFunction } from "express";
import { reportOutcome } from "../operator/apexIntelligence";
import { emitUniversalEvent, EVENT_TYPES } from "../intelligence/eventEmitter";

const SKIP_PATH_PREFIXES = [
  "/api/health",
  "/api/auth/user",
  "/api/intelligence/outcomes",
  "/api/intelligence/events",
  "/api/intelligence/timeline",
  "/api/_internal",
  "/api/diagnostics",
  "/api/jobs/",
  "/api/bot/chat",
  "/api/notifications/poll",
  "/api/pulse",
];

const NON_MUTATING = new Set(["GET", "HEAD", "OPTIONS"]);

function shouldSkip(req: Request): boolean {
  if (NON_MUTATING.has(req.method)) return true;
  const url = req.originalUrl || req.url || "";
  for (const p of SKIP_PATH_PREFIXES) if (url.startsWith(p)) return true;
  return false;
}

function extractSubAccountId(req: Request, body: any): number | null {
  const fromTenant = (req as any).tenant?.subAccountId;
  if (typeof fromTenant === "number" && fromTenant > 0) return fromTenant;

  const headerVal = req.headers["x-sub-account-id"];
  if (headerVal) {
    const n = parseInt(String(headerVal), 10);
    if (Number.isInteger(n) && n > 0) return n;
  }

  const bodyVal = body?.subAccountId ?? body?.sub_account_id ?? body?.accountId ?? body?.account_id;
  if (typeof bodyVal === "number" && bodyVal > 0) return bodyVal;

  const params = (req.params || {}) as Record<string, string>;
  for (const k of ["subAccountId", "sub_account_id", "accountId", "account_id", "id"]) {
    const v = params[k];
    if (v) {
      const n = parseInt(v, 10);
      if (Number.isInteger(n) && n > 0) return n;
    }
  }

  return null;
}

function shortPath(url: string): string {
  const noQuery = url.split("?")[0];
  return noQuery.length > 200 ? noQuery.slice(0, 200) : noQuery;
}

function summarizeBody(body: any): string {
  if (!body) return "";
  try {
    const s = typeof body === "string" ? body : JSON.stringify(body);
    return s.length > 220 ? s.slice(0, 220) + "…" : s;
  } catch (err) {
    console.warn("[APEXREPORTER] caught:", err instanceof Error ? err.message : err);
    return "";
  }
}

export function apexReporter(req: Request, res: Response, next: NextFunction): void {
  if (shouldSkip(req)) return next();

  const startedAt = Date.now();
  let capturedBody: any = null;

  const origJson = res.json.bind(res);
  (res as any).json = function (body: any) {
    capturedBody = body;
    return origJson(body);
  };

  res.on("finish", () => {
    try {
      const status = res.statusCode;
      const durationMs = Date.now() - startedAt;
      const ok = status >= 200 && status < 400;
      const path = shortPath(req.originalUrl || req.url || "");
      const subAccountId = extractSubAccountId(req, capturedBody) ?? extractSubAccountId(req, req.body);

      const isAdminBypass = !!(req as any)._apexAdminBypass || !!req.headers["x-admin-secret"];
      const actor = isAdminBypass ? "operator" : "http-api";

      const errPreview = !ok && capturedBody
        ? (capturedBody.error || capturedBody.message || summarizeBody(capturedBody)).toString().slice(0, 200)
        : "";

      if (subAccountId) {
        reportOutcome({
          agentName: actor,
          action: req.method,
          subject: path,
          result: ok ? "ok" : `error:${status}${errPreview ? " " + errPreview : ""}`,
          confidence: ok ? 1 : 0,
          subAccountId,
          metadata: {
            status,
            durationMs,
            method: req.method,
            via: isAdminBypass ? "admin-bypass" : "user",
          },
        });
      }

      emitUniversalEvent({
        eventType: ok ? EVENT_TYPES.API_REQUEST_COMPLETED : EVENT_TYPES.API_REQUEST_FAILED,
        sourceModule: "http-api",
        subAccountId: subAccountId ?? undefined,
        metadata: {
          method: req.method,
          path,
          status,
          durationMs,
          via: isAdminBypass ? "admin-bypass" : "user",
          errorPreview: errPreview || undefined,
        },
      });
    } catch (err) {
      console.error("[APEX-REPORTER] hook failed:", (err as Error).message);
    }
  });

  next();
}
