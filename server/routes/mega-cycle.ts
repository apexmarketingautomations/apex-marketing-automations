// @ts-nocheck
import { Express } from "express";
import { asyncHandler, parseIntParam, verifyAccountOwnership } from "./helpers";
import { enqueueMegaCycle, getMegaCycleStatus } from "../intelligence/megaCycle";

export function registerMegaCycleRoutes(app: Express) {
  // Trigger a single Mega Cycle tick.
  app.post("/api/intelligence/mega-cycle/run", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.body?.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const mode = req.body?.mode;
    const domains = Array.isArray(req.body?.domains) ? req.body.domains : undefined;

    const jobId = enqueueMegaCycle({
      subAccountId,
      mode,
      domains,
      triggeredBy: "api",
    });

    res.json({ ok: true, jobId });
  }));

  app.get("/api/intelligence/mega-cycle/status/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    res.json(getMegaCycleStatus(subAccountId));
  }));
}

