// @ts-nocheck
import type { Express } from "express";
import { storage } from "../storage";
import { asyncHandler, requireAdmin } from "./helpers";
import { processFailedEvents } from "../eventRetryProcessor";

export function registerEventLogRoutes(app: Express) {
  app.get("/api/events", requireAdmin, asyncHandler(async (req, res) => {
    const { type, source, status, traceId, since, until, limit } = req.query;

    const filters: Parameters<typeof storage.queryEventLogs>[0] = {};
    if (type) filters.type = String(type);
    if (source) filters.source = String(source);
    if (status) filters.status = String(status);
    if (traceId) filters.traceId = String(traceId);
    if (since) filters.since = new Date(String(since));
    if (until) filters.until = new Date(String(until));
    if (limit) filters.limit = Math.min(parseInt(String(limit), 10) || 100, 1000);

    const events = await storage.queryEventLogs(filters);
    res.json({ events, count: events.length });
  }));

  app.get("/api/events/dead-letter", requireAdmin, asyncHandler(async (_req, res) => {
    const events = await storage.getDeadLetterEventLogs();
    res.json({ events, count: events.length });
  }));

  app.post("/api/events/dead-letter/:id/retry", requireAdmin, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid event ID" });

    const event = await storage.getEventLog(id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (event.status !== "dead_letter" && event.status !== "failed") {
      return res.status(400).json({ error: "Event is not in dead_letter or failed state" });
    }

    await storage.updateEventLogStatus(id, "failed", {
      retryCount: 0,
      errorMessage: "Manually retried from dead_letter",
    });

    setImmediate(() => {
      processFailedEvents().catch(err => console.error("[DEAD-LETTER-RETRY] Error:", err?.message));
    });

    res.json({ success: true, message: "Event queued for retry" });
  }));

  app.get("/api/events/:id", requireAdmin, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid event ID" });

    const event = await storage.getEventLog(id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json({ event });
  }));
}
