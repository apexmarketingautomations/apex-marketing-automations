/**
 * server/routes/serviceIndustryAdmin.ts
 *
 * Service Industry Admin API Routes
 *
 * Routes:
 *   Business Intelligence:
 *     GET  /api/service/businesses           — top opportunity businesses
 *     GET  /api/service/business/:id         — single business details (future)
 *     GET  /api/service/intelligence/stats   — aggregate intelligence stats
 *
 *   Missed Call Recovery:
 *     POST /api/service/missed-call          — ingest missed call event
 *     GET  /api/service/missed-calls/pending — pending recovery queue
 *     GET  /api/service/missed-calls/stats   — recovery stats
 *     POST /api/service/missed-call/:id/replied   — mark replied
 *     POST /api/service/missed-call/:id/booked    — mark booked
 *     POST /api/service/missed-call/:id/escalated — mark escalated
 *
 *   Appointment Intelligence:
 *     POST /api/service/appointment          — upsert appointment
 *     GET  /api/service/customers/at-risk    — at-risk customer list
 *     GET  /api/service/customers/vip        — VIP customer list
 *     GET  /api/service/appointments/stats   — appointment stats
 *
 *   Reputation Management:
 *     POST /api/service/review               — ingest review
 *     GET  /api/service/reviews/recent       — recent reviews
 *     GET  /api/service/reviews/alerts       — pending negative alerts
 *     POST /api/service/review/:id/responded — mark responded
 *     POST /api/service/review/:id/alert-sent — mark alert sent
 *     GET  /api/service/reputation/stats     — reputation stats
 *
 *   Retention Automation:
 *     POST /api/service/retention/draft      — create retention draft
 *     GET  /api/service/retention/pending    — pending drafts
 *     POST /api/service/retention/:id/approve — approve draft
 *     POST /api/service/retention/:id/reject  — reject draft
 *     GET  /api/service/retention/stats      — retention stats
 *
 *   Loyalty:
 *     POST /api/service/loyalty/event        — record loyalty event
 *     GET  /api/service/loyalty/:customerId  — get loyalty summary
 *     GET  /api/service/loyalty/:customerId/ledger — get points ledger
 *     GET  /api/service/loyalty/stats        — aggregate loyalty stats
 *
 *   AI Receptionist:
 *     POST /api/service/receptionist/session — find or create session
 *     POST /api/service/receptionist/message — process inbound message
 *     GET  /api/service/receptionist/escalations — open escalations
 *     POST /api/service/receptionist/:id/close   — close session
 *     GET  /api/service/receptionist/stats        — receptionist stats
 */

import type { Express, Request, Response } from "express";

import {
  getTopOpportunityBusinesses,
  getBusinessIntelligenceStats,
} from "../serviceIndustry/localBusinessIntelligenceEngine";

import {
  ingestMissedCall,
  getPendingRecoveries,
  getMissedCallStats,
  markMissedCallReplied,
  markMissedCallBooked,
  markMissedCallEscalated,
} from "../serviceIndustry/missedCallRecoveryEngine";

import {
  upsertAppointment,
  getAtRiskCustomers,
  getVipCustomers,
  getAppointmentStats,
} from "../serviceIndustry/appointmentIntelligenceEngine";

import {
  ingestReview,
  getRecentReviews,
  getPendingNegativeAlerts,
  markReviewResponded,
  markAlertSent,
  getReputationStats,
} from "../serviceIndustry/reputationManagementEngine";

import {
  createRetentionDraft,
  getPendingRetentionDrafts,
  approveRetentionDraft,
  rejectRetentionDraft,
  getRetentionStats,
} from "../serviceIndustry/retentionAutomationService";

import {
  recordLoyaltyEvent,
  awardVisitPoints,
  getLoyaltySummary,
  getLoyaltyLedger,
  getLoyaltyStats,
} from "../serviceIndustry/loyaltyWorkflowEngine";

import {
  findOrCreateSession,
  processInboundMessage,
  getOpenEscalations,
  closeSession,
  getReceptionistStats,
} from "../serviceIndustry/aiReceptionistCoordinator";

// ── Route registration ────────────────────────────────────────────────────────

// Helper: safely coerce req.query value (can be string | string[] | ParsedQs) → string | undefined
function qs(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

export function registerServiceIndustryAdminRoutes(app: Express): void {

  // ── Business Intelligence ─────────────────────────────────────────────────

  app.get("/api/service/businesses", async (_req: Request, res: Response) => {
    try {
      const limit   = Number(_req.query.limit ?? 50);
      const county  = typeof _req.query.county   === "string" ? _req.query.county   : undefined;
      const vertical = typeof _req.query.vertical === "string" ? _req.query.vertical : undefined;
      const minScore = typeof _req.query.minScore === "string" ? Number(_req.query.minScore) : undefined;
      const data = await getTopOpportunityBusinesses({ limit, county, vertical: vertical as any, minScore });
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/intelligence/stats", async (_req: Request, res: Response) => {
    try {
      const data = await getBusinessIntelligenceStats();
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ── Missed Call Recovery ──────────────────────────────────────────────────

  app.post("/api/service/missed-call", async (req: Request, res: Response) => {
    try {
      const {
        businessId, subAccountId, callerPhone, calledAt, businessName,
        businessHours, suppressAfterHours, bookingLink, isExistingCustomer, customerName,
      } = req.body;
      if (!businessId || !callerPhone || !businessName) {
        return res.status(400).json({ ok: false, error: "businessId, callerPhone, businessName required" });
      }
      const result = await ingestMissedCall({
        businessId,
        subAccountId,
        callerPhone,
        calledAt:       calledAt ? new Date(calledAt) : new Date(),
        businessName,
        businessHours,
        suppressAfterHours,
        bookingLink,
        isExistingCustomer,
        customerName,
      });
      res.json({ ok: true, data: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/missed-calls/pending", async (req: Request, res: Response) => {
    try {
      const businessId = qs(req.query.businessId);
      const limit = Number(req.query.limit ?? 50);
      const data = await getPendingRecoveries(businessId, limit);
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/missed-calls/stats", async (req: Request, res: Response) => {
    try {
      const businessId = qs(req.query.businessId);
      const data = await getMissedCallStats(businessId);
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/service/missed-call/:id/replied", async (req: Request, res: Response) => {
    try {
      await markMissedCallReplied(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/service/missed-call/:id/booked", async (req: Request, res: Response) => {
    try {
      await markMissedCallBooked(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/service/missed-call/:id/escalated", async (req: Request, res: Response) => {
    try {
      const { reason } = req.body;
      await markMissedCallEscalated(req.params.id, reason ?? "manual_escalation");
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ── Appointment Intelligence ───────────────────────────────────────────────

  app.post("/api/service/appointment", async (req: Request, res: Response) => {
    try {
      const appt = req.body;
      if (!appt.appointmentId || !appt.businessId || !appt.service || !appt.scheduledAt || !appt.status) {
        return res.status(400).json({ ok: false, error: "appointmentId, businessId, service, scheduledAt, status required" });
      }
      const result = await upsertAppointment(appt);
      res.json({ ok: true, data: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/customers/at-risk", async (req: Request, res: Response) => {
    try {
      const businessId = qs(req.query.businessId);
      const limit = Number(req.query.limit ?? 50);
      const data = await getAtRiskCustomers(businessId, limit);
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/customers/vip", async (req: Request, res: Response) => {
    try {
      const businessId = qs(req.query.businessId);
      const limit = Number(req.query.limit ?? 50);
      const data = await getVipCustomers(businessId, limit);
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/appointments/stats", async (req: Request, res: Response) => {
    try {
      const businessId = qs(req.query.businessId);
      const data = await getAppointmentStats(businessId);
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ── Reputation Management ─────────────────────────────────────────────────

  app.post("/api/service/review", async (req: Request, res: Response) => {
    try {
      const { businessId, businessName, ownerName, platform, rating, reviewText, reviewerName, publishedAt } = req.body;
      if (!businessId || !businessName || !platform || rating === undefined) {
        return res.status(400).json({ ok: false, error: "businessId, businessName, platform, rating required" });
      }
      const result = await ingestReview({
        businessId, businessName, ownerName, platform, rating,
        reviewText, reviewerName,
        publishedAt: publishedAt ? new Date(publishedAt) : undefined,
      });
      res.json({ ok: true, data: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/reviews/recent", async (req: Request, res: Response) => {
    try {
      const businessId = qs(req.query.businessId);
      const limit = Number(req.query.limit ?? 20);
      const data = await getRecentReviews(businessId, limit);
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/reviews/alerts", async (req: Request, res: Response) => {
    try {
      const businessId = qs(req.query.businessId);
      const data = await getPendingNegativeAlerts(businessId);
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/service/review/:id/responded", async (req: Request, res: Response) => {
    try {
      await markReviewResponded(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/service/review/:id/alert-sent", async (req: Request, res: Response) => {
    try {
      await markAlertSent(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/reputation/stats", async (req: Request, res: Response) => {
    try {
      const businessId = qs(req.query.businessId);
      const data = await getReputationStats(businessId);
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ── Retention Automation ──────────────────────────────────────────────────

  app.post("/api/service/retention/draft", async (req: Request, res: Response) => {
    try {
      const opts = req.body;
      if (!opts.businessId || !opts.customerId || !opts.workflowType || !opts.businessName) {
        return res.status(400).json({ ok: false, error: "businessId, customerId, workflowType, businessName required" });
      }
      const result = await createRetentionDraft(opts);
      res.json({ ok: true, data: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/retention/pending", async (req: Request, res: Response) => {
    try {
      const businessId = qs(req.query.businessId);
      const limit = Number(req.query.limit ?? 50);
      const data = await getPendingRetentionDrafts(businessId, limit);
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/service/retention/:id/approve", async (req: Request, res: Response) => {
    try {
      const { approvedBy } = req.body;
      if (!approvedBy || approvedBy.trim().length < 2) {
        return res.status(400).json({ ok: false, error: "approvedBy (≥2 chars) required" });
      }
      await approveRetentionDraft(req.params.id, approvedBy);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/service/retention/:id/reject", async (req: Request, res: Response) => {
    try {
      const { reason } = req.body;
      await rejectRetentionDraft(req.params.id, reason ?? "manual_rejection");
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/retention/stats", async (req: Request, res: Response) => {
    try {
      const businessId = qs(req.query.businessId);
      const data = await getRetentionStats(businessId);
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ── Loyalty ───────────────────────────────────────────────────────────────

  app.post("/api/service/loyalty/event", async (req: Request, res: Response) => {
    try {
      const { businessId, customerId, eventType, points, description } = req.body;
      if (!businessId || !customerId || !eventType || points === undefined) {
        return res.status(400).json({ ok: false, error: "businessId, customerId, eventType, points required" });
      }
      const result = await recordLoyaltyEvent({ businessId, customerId, eventType, points, description });
      res.json({ ok: true, data: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/service/loyalty/visit-points", async (req: Request, res: Response) => {
    try {
      const { businessId, customerId, visitValue, appointmentId } = req.body;
      if (!businessId || !customerId || visitValue === undefined) {
        return res.status(400).json({ ok: false, error: "businessId, customerId, visitValue required" });
      }
      const result = await awardVisitPoints({ businessId, customerId, visitValue, appointmentId });
      res.json({ ok: true, data: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/loyalty/:customerId", async (req: Request, res: Response) => {
    try {
      const businessId = qs(req.query.businessId) ?? "";
      if (!businessId) return res.status(400).json({ ok: false, error: "businessId required" });
      const data = await getLoyaltySummary(businessId, req.params.customerId);
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/loyalty/:customerId/ledger", async (req: Request, res: Response) => {
    try {
      const businessId = qs(req.query.businessId) ?? "";
      if (!businessId) return res.status(400).json({ ok: false, error: "businessId required" });
      const limit = Number(req.query.limit ?? 20);
      const data = await getLoyaltyLedger(businessId, req.params.customerId, limit);
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/loyalty/stats", async (req: Request, res: Response) => {
    try {
      const businessId = qs(req.query.businessId);
      const data = await getLoyaltyStats(businessId);
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ── AI Receptionist ───────────────────────────────────────────────────────

  app.post("/api/service/receptionist/session", async (req: Request, res: Response) => {
    try {
      const { businessId, subAccountId, callerPhone, channel, businessHours, businessHoursEnforced } = req.body;
      if (!businessId || !callerPhone) {
        return res.status(400).json({ ok: false, error: "businessId, callerPhone required" });
      }
      const session = await findOrCreateSession({
        businessId, subAccountId, callerPhone,
        channel:              channel ?? "sms",
        businessHours,
        businessHoursEnforced,
      });
      res.json({ ok: true, data: session });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/service/receptionist/message", async (req: Request, res: Response) => {
    try {
      const { sessionId, businessId, businessName, message, bookingLink } = req.body;
      if (!sessionId || !businessId || !businessName || !message) {
        return res.status(400).json({ ok: false, error: "sessionId, businessId, businessName, message required" });
      }
      const result = await processInboundMessage({ sessionId, businessId, businessName, message, bookingLink });
      res.json({ ok: true, data: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/receptionist/escalations", async (req: Request, res: Response) => {
    try {
      const businessId = qs(req.query.businessId);
      const data = await getOpenEscalations(businessId);
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/service/receptionist/:id/close", async (req: Request, res: Response) => {
    try {
      const { reason } = req.body;
      await closeSession(req.params.id, reason);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/service/receptionist/stats", async (req: Request, res: Response) => {
    try {
      const businessId = qs(req.query.businessId);
      const data = await getReceptionistStats(businessId);
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  console.log("[SVC] Service Industry admin routes registered (35 routes)");
}
