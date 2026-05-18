// @ts-nocheck
import type { Express } from "express";
import { storage } from "../storage";
import { asyncHandler, parseIntParam, verifyAccountOwnership } from "./helpers";
import { z } from "zod";

export function registerTimelineRoutes(app: Express) {
  app.get("/api/timeline/traces/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const limitRaw = parseInt(req.query.limit as string) || 50;
    const offsetRaw = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string | undefined;
    const sinceRaw = req.query.since as string | undefined;

    const since = sinceRaw ? new Date(sinceRaw) : undefined;

    const traces = await storage.listTraces(subAccountId, {
      limit: Math.min(limitRaw, 200),
      offset: offsetRaw,
      status,
      since,
    });

    res.json(traces);
  }));

  app.get("/api/timeline/trace/:traceId", asyncHandler(async (req, res) => {
    const traceId = req.params.traceId;
    if (!traceId) return res.status(400).json({ error: "traceId required" });

    const events = await storage.getTimelineEventsByTrace(traceId);
    if (events.length === 0) return res.status(404).json({ error: "Trace not found" });

    // Verify the requesting user owns this trace's account
    const traceSubAccountId = events[0]?.subAccountId;
    if (traceSubAccountId != null && !(await verifyAccountOwnership(req, res, traceSubAccountId))) return;

    res.json(events);
  }));

  app.get("/api/timeline/trace/:traceId/summary", asyncHandler(async (req, res) => {
    const traceId = req.params.traceId;
    if (!traceId) return res.status(400).json({ error: "traceId required" });

    // Ownership check: verify the trace belongs to the user before returning summary
    const events = await storage.getTimelineEventsByTrace(traceId);
    if (events.length === 0) return res.status(404).json({ error: "Trace not found" });
    const traceSubAccountId = events[0]?.subAccountId;
    if (traceSubAccountId != null && !(await verifyAccountOwnership(req, res, traceSubAccountId))) return;

    const summary = await storage.getTraceSummary(traceId);
    if (!summary) return res.status(404).json({ error: "Trace not found" });

    res.json(summary);
  }));
}
