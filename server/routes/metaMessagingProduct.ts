import type { Express, Request, Response } from "express";
import { asyncHandler, parseIntParam, verifyAccountOwnership } from "./helpers";
import { ensureNotProtectedAccount } from "../middleware/protectedAccount";
import { requireFeatureFlag } from "../middleware/featureGate";

const META_MESSAGING_FLAG = "meta_messaging_2027";

function extractSubAccountIdFromParams(req: Request): number | null {
  const raw = req.params.subAccountId;
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? null : parsed;
}

function extractSubAccountIdFromBody(req: Request): number | null {
  const raw = req.body?.subAccountId;
  if (!raw) return null;
  const parsed = typeof raw === "number" ? raw : parseInt(raw, 10);
  return isNaN(parsed) ? null : parsed;
}

const featureGate = requireFeatureFlag(META_MESSAGING_FLAG);
const protectedGuardParams = ensureNotProtectedAccount(extractSubAccountIdFromParams);
const protectedGuardBody = ensureNotProtectedAccount(extractSubAccountIdFromBody);

export function registerMetaMessagingProductRoutes(app: Express) {
  app.post("/api/meta-messaging/product/create-subaccount",
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = extractSubAccountIdFromBody(req);
      if (subAccountId !== null) {
        if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
      } else {
        const user = (req as any).user;
        if (!user) return res.status(401).json({ error: "Not authenticated" });
      }
      return protectedGuardBody(req, res, () => {
        res.json({ ok: true, message: "create-subaccount skeleton", data: null });
      });
    })
  );

  app.post("/api/meta-messaging/product/meta/oauth/start",
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = extractSubAccountIdFromBody(req);
      if (subAccountId !== null) {
        if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
      } else {
        const user = (req as any).user;
        if (!user) return res.status(401).json({ error: "Not authenticated" });
      }
      return protectedGuardBody(req, res, () => {
        res.json({ ok: true, message: "meta/oauth/start skeleton", data: null });
      });
    })
  );

  app.post("/api/meta-messaging/product/meta/oauth/callback",
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = extractSubAccountIdFromBody(req);
      if (subAccountId !== null) {
        if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
      } else {
        const user = (req as any).user;
        if (!user) return res.status(401).json({ error: "Not authenticated" });
      }
      return protectedGuardBody(req, res, () => {
        res.json({ ok: true, message: "meta/oauth/callback skeleton", data: null });
      });
    })
  );

  app.post("/api/meta-messaging/product/test-webhook/:subAccountId",
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
      return protectedGuardParams(req, res, () => {
        res.json({ ok: true, message: "test-webhook skeleton", subAccountId, data: null });
      });
    })
  );

  app.get("/api/meta-messaging/product/inbox/:subAccountId",
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
      return protectedGuardParams(req, res, () => {
        res.json({ ok: true, message: "inbox skeleton", subAccountId, data: null });
      });
    })
  );

  app.post("/api/meta-messaging/product/approve-send/:subAccountId",
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
      return protectedGuardParams(req, res, () => {
        res.json({ ok: true, message: "approve-send skeleton", subAccountId, data: null });
      });
    })
  );

  app.post("/api/meta-messaging/product/seed-demo/:subAccountId",
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
      return protectedGuardParams(req, res, () => {
        res.json({ ok: true, message: "seed-demo skeleton", subAccountId, data: null });
      });
    })
  );

  app.get("/api/meta-messaging/product/safety-queue/:subAccountId",
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
      return protectedGuardParams(req, res, () => {
        res.json({ ok: true, message: "safety-queue skeleton", subAccountId, data: null });
      });
    })
  );

  app.get("/api/meta-messaging/product/analytics/:subAccountId",
    featureGate,
    asyncHandler(async (req: Request, res: Response) => {
      const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
      return protectedGuardParams(req, res, () => {
        res.json({ ok: true, message: "analytics skeleton", subAccountId, data: null });
      });
    })
  );
}
