/**
 * server/routes/communicationsAdmin.ts
 *
 * Apex Communications Engine — Admin API Routes (Phase 10)
 *
 * Route groups:
 *   Orchestrator:
 *     POST /api/comm/send                     — orchestrate outbound communication
 *     GET  /api/comm/list                     — list communications (filtered)
 *     GET  /api/comm/metrics                  — 30-day delivery metrics by channel
 *     GET  /api/comm/:id/timeline             — timeline for a single communication
 *
 *   Safety Engine:
 *     POST /api/comm/safety/check             — dry-run safety check (no send)
 *     POST /api/comm/opt-out                  — record opt-out
 *     POST /api/comm/opt-out/check            — check opt-out status
 *     GET  /api/comm/policy/:tenantId         — fetch tenant comm policy
 *
 *   Approval Workflow:
 *     POST /api/comm/approval/request         — request approval for a communication
 *     POST /api/comm/approval/:id/approve     — approve a pending request
 *     POST /api/comm/approval/:id/reject      — reject a pending request
 *     GET  /api/comm/approvals/pending        — pending approvals for tenant
 *     GET  /api/comm/approvals/stats          — approval stats
 *     POST /api/comm/approvals/expire         — expire stale approvals (cron)
 *
 *   SMS Workflow:
 *     POST /api/comm/sms/schedule             — schedule SMS (safety-gated)
 *     POST /api/comm/sms/batch                — execute approved SMS batch
 *
 *   Voice AI:
 *     POST /api/comm/voice/initiate           — initiate outbound voice/voicemail
 *     POST /api/comm/voice/inbound            — handle inbound call (TwiML)
 *     POST /api/comm/voice/:sessionId/complete — complete voice session
 *     POST /api/comm/voice/:sessionId/transfer — transfer to human
 *     GET  /api/comm/voice/sessions/active    — active voice sessions
 *     GET  /api/comm/voice/stats              — voice stats
 *
 *   iMessage Drafts:
 *     POST /api/comm/imessage/draft           — create iMessage draft
 *     GET  /api/comm/imessage/pending         — pending drafts
 *     POST /api/comm/imessage/:id/confirm-sent — confirm human sent
 *     POST /api/comm/imessage/:id/dismiss     — dismiss draft
 *     GET  /api/comm/imessage/stats           — iMessage stats
 *
 *   Conversation Intelligence:
 *     POST /api/comm/intelligence/analyze     — analyze conversation text
 *     GET  /api/comm/intelligence/:commId     — get analysis for communication
 *
 *   Timeline:
 *     GET  /api/comm/timeline                 — tenant timeline feed
 *     GET  /api/comm/timeline/search          — search timeline
 *     GET  /api/comm/timeline/stats           — 24h timeline stats
 *
 * All routes require `tenantId` either in the request body or as `?tenantId=`
 * query param. No cross-tenant data is ever returned.
 */

import type { Express, Request, Response } from "express";

// ── safe query-string coercion ─────────────────────────────────────────────────

function qs(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

function qsNum(val: unknown, fallback: number): number {
  const n = Number(qs(val));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ── lazy imports (avoids circular deps at module load) ────────────────────────

async function getOrchestrator() {
  return import("../communications/communicationOrchestrator");
}
async function getSafety() {
  return import("../communications/communicationSafetyEngine");
}
async function getApproval() {
  return import("../communications/approvalWorkflowEngine");
}
async function getSms() {
  return import("../communications/smsWorkflowCoordinator");
}
async function getVoice() {
  return import("../communications/voiceAIExecutionEngine");
}
async function getImessage() {
  return import("../communications/iMessageWorkflowService");
}
async function getIntelligence() {
  return import("../communications/conversationIntelligenceService");
}
async function getTimeline() {
  return import("../communications/communicationTimelineService");
}

// ── route registration ─────────────────────────────────────────────────────────

export function registerCommunicationsAdminRoutes(app: Express): void {

  // ── Orchestrator ─────────────────────────────────────────────────────────────

  /**
   * POST /api/comm/send
   * Orchestrate a new outbound communication through the full safety+approval pipeline.
   * Body: { tenantId, contactPhone?, contactEmail?, channel, workflowType, messageBody?,
   *          contactName?, businessName?, priority?, routingOwnerId?, routingDepartment?,
   *          territory?, escalationOwnerId? }
   */
  app.post("/api/comm/send", async (req: Request, res: Response) => {
    try {
      const { tenantId, channel, workflowType, ...rest } = req.body ?? {};
      if (!tenantId || !channel || !workflowType) {
        return res.status(400).json({ error: "tenantId, channel, workflowType required" });
      }
      const { orchestrateCommunication } = await getOrchestrator();
      const result = await orchestrateCommunication({ tenantId, channel, workflowType, ...rest });
      res.json(result);
    } catch (err: any) {
      console.error("[COMM-ROUTES] /send error:", err?.message);
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/comm/list
   * List communications for a tenant with optional filters.
   * Query: tenantId, channel?, status?, ownerId?, limit?
   */
  app.get("/api/comm/list", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getCommunications } = await getOrchestrator();
      const records = await getCommunications({
        tenantId,
        channel:  qs(req.query.channel)  as any,
        status:   qs(req.query.status)   as any,
        ownerId:  qs(req.query.ownerId),
        limit:    qsNum(req.query.limit, 50),
      });
      res.json(records);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/comm/metrics
   * 30-day delivery metrics broken down by channel.
   * Query: tenantId
   */
  app.get("/api/comm/metrics", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getCommunicationMetrics } = await getOrchestrator();
      res.json(await getCommunicationMetrics(tenantId));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/comm/:id/timeline
   * Immutable timeline for a single communication record.
   * Query: tenantId
   */
  app.get("/api/comm/:id/timeline", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getCommunicationTimeline } = await getTimeline();
      res.json(await getCommunicationTimeline(req.params.id as string, tenantId));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  // ── Safety Engine ────────────────────────────────────────────────────────────

  /**
   * POST /api/comm/safety/check
   * Dry-run the safety gate without creating any records.
   * Body: { tenantId, contactPhone, channel, workflowType }
   */
  app.post("/api/comm/safety/check", async (req: Request, res: Response) => {
    try {
      const { tenantId, contactPhone, channel, workflowType } = req.body ?? {};
      if (!tenantId || !channel || !workflowType) {
        return res.status(400).json({ error: "tenantId, channel, workflowType required" });
      }
      const { runSafetyCheck } = await getSafety();
      const result = await runSafetyCheck({ tenantId, contactPhone, channel, workflowType });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * POST /api/comm/opt-out
   * Record a contact's opt-out globally (or for a specific tenant).
   * Body: { contactPhone, tenantId? }
   */
  app.post("/api/comm/opt-out", async (req: Request, res: Response) => {
    try {
      const { contactPhone, tenantId } = req.body ?? {};
      if (!contactPhone) return res.status(400).json({ error: "contactPhone required" });
      const { recordOptOut } = await getSafety();
      await recordOptOut({ contactPhone, tenantId, source: "admin_api" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * POST /api/comm/opt-out/check
   * Check whether a contact is opted-out.
   * Body: { contactPhone, tenantId? }
   */
  app.post("/api/comm/opt-out/check", async (req: Request, res: Response) => {
    try {
      const { contactPhone, tenantId } = req.body ?? {};
      if (!contactPhone) return res.status(400).json({ error: "contactPhone required" });
      const { checkOptOut } = await getSafety();
      const optedOut = await checkOptOut({ contactPhone, tenantId: tenantId ?? "global", channel: "sms" });
      res.json({ optedOut });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/comm/policy/:tenantId
   * Fetch the communication policy for a tenant.
   */
  app.get("/api/comm/policy/:tenantId", async (req: Request, res: Response) => {
    try {
      const { getTenantPolicy } = await getSafety();
      const policy = await getTenantPolicy(req.params.tenantId as string);
      res.json(policy);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  // ── Approval Workflow ────────────────────────────────────────────────────────

  /**
   * POST /api/comm/approval/request
   * Create an approval request for a communication.
   * Body: { communicationId, tenantId, requestedBy, workflowType, channel,
   *          contactPhone?, messagePreview? }
   */
  app.post("/api/comm/approval/request", async (req: Request, res: Response) => {
    try {
      const { communicationId, tenantId, requestedBy, workflowType, channel, ...rest } = req.body ?? {};
      if (!communicationId || !tenantId || !requestedBy || !workflowType || !channel) {
        return res.status(400).json({ error: "communicationId, tenantId, requestedBy, workflowType, channel required" });
      }
      const { requestApproval } = await getApproval();
      const record = await requestApproval({ communicationId, tenantId, requestedBy, workflowType, channel, ...rest });
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * POST /api/comm/approval/:id/approve
   * Approve a pending approval request. Approver name must be a real human name.
   * Body: { tenantId, approvedBy, notes? }
   */
  app.post("/api/comm/approval/:id/approve", async (req: Request, res: Response) => {
    try {
      const { tenantId, approvedBy, notes } = req.body ?? {};
      if (!tenantId || !approvedBy) {
        return res.status(400).json({ error: "tenantId, approvedBy required" });
      }
      const { approveRequest } = await getApproval();
      await approveRequest({ approvalId: req.params.id as string, tenantId, approvedBy, notes });
      res.json({ ok: true });
    } catch (err: any) {
      const status = err?.code === "NOT_FOUND" ? 404
        : err?.code === "ALREADY_PROCESSED" ? 409
        : err?.code === "EXPIRED" ? 410
        : err?.code === "APPROVER_INVALID" ? 422
        : 500;
      res.status(status).json({ error: err?.message ?? "Internal error", code: err?.code });
    }
  });

  /**
   * POST /api/comm/approval/:id/reject
   * Reject a pending approval request.
   * Body: { tenantId, rejectedBy, reason? }
   */
  app.post("/api/comm/approval/:id/reject", async (req: Request, res: Response) => {
    try {
      const { tenantId, rejectedBy, reason } = req.body ?? {};
      if (!tenantId || !rejectedBy) {
        return res.status(400).json({ error: "tenantId, rejectedBy required" });
      }
      const { rejectRequest } = await getApproval();
      await rejectRequest({ approvalId: req.params.id as string, tenantId, rejectedBy, rejectionReason: reason });
      res.json({ ok: true });
    } catch (err: any) {
      const status = err?.code === "NOT_FOUND" ? 404
        : err?.code === "ALREADY_PROCESSED" ? 409
        : 500;
      res.status(status).json({ error: err?.message ?? "Internal error", code: err?.code });
    }
  });

  /**
   * GET /api/comm/approvals/pending
   * Pending approvals for a tenant.
   * Query: tenantId, limit?
   */
  app.get("/api/comm/approvals/pending", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getPendingApprovals } = await getApproval();
      res.json(await getPendingApprovals(tenantId, qsNum(req.query.limit, 50)));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/comm/approvals/stats
   * Approval stats (pending/approved/rejected/expired) for a tenant.
   * Query: tenantId
   */
  app.get("/api/comm/approvals/stats", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getApprovalStats } = await getApproval();
      res.json(await getApprovalStats(tenantId));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * POST /api/comm/approvals/expire
   * Expire stale approvals past their TTL. Designed for cron/scheduler invocation.
   * Body: {} (no auth needed — idempotent housekeeping)
   */
  app.post("/api/comm/approvals/expire", async (req: Request, res: Response) => {
    try {
      const { expireStaleApprovals } = await getApproval();
      const expired = await expireStaleApprovals();
      res.json({ expired });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  // ── SMS Workflow ─────────────────────────────────────────────────────────────

  /**
   * POST /api/comm/sms/schedule
   * Schedule an SMS through the safety+approval pipeline.
   * Body: { tenantId, contactPhone, workflowType, templateVars?, scheduledAt? }
   */
  app.post("/api/comm/sms/schedule", async (req: Request, res: Response) => {
    try {
      const { tenantId, contactPhone, workflowType, ...rest } = req.body ?? {};
      if (!tenantId || !contactPhone || !workflowType) {
        return res.status(400).json({ error: "tenantId, contactPhone, workflowType required" });
      }
      const { scheduleSms } = await getSms();
      const result = await scheduleSms({ tenantId, contactPhone, workflowType, ...rest });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * POST /api/comm/sms/batch
   * Execute the approved SMS send queue for a tenant.
   * Body: { tenantId }
   */
  app.post("/api/comm/sms/batch", async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.body ?? {};
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { executeApprovedSmsBatch } = await getSms();
      const result = await executeApprovedSmsBatch(tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  // ── Voice AI ─────────────────────────────────────────────────────────────────

  /**
   * POST /api/comm/voice/initiate
   * Initiate an outbound voice call or voicemail drop.
   * Body: { tenantId, contactPhone, workflowType, persona?, businessName?,
   *          contactName?, bookingLink?, voiceDropScript? }
   */
  app.post("/api/comm/voice/initiate", async (req: Request, res: Response) => {
    try {
      const { tenantId, contactPhone, workflowType, ...rest } = req.body ?? {};
      if (!tenantId || !contactPhone || !workflowType) {
        return res.status(400).json({ error: "tenantId, contactPhone, workflowType required" });
      }
      const { initiateVoiceCall } = await getVoice();
      const result = await initiateVoiceCall({ tenantId, contactPhone, workflowType, ...rest });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * POST /api/comm/voice/inbound
   * Handle inbound Twilio call webhook. Returns TwiML.
   * Body: Twilio webhook payload (From, To, CallSid, etc.)
   */
  app.post("/api/comm/voice/inbound", async (req: Request, res: Response) => {
    try {
      const { handleInboundCall } = await getVoice();
      const twiml = await handleInboundCall(req.body ?? {});
      res.set("Content-Type", "text/xml").send(twiml);
    } catch (err: any) {
      console.error("[COMM-ROUTES] /voice/inbound error:", err?.message);
      // Return minimal TwiML on error — never drop the call silently
      res.set("Content-Type", "text/xml").send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say>We're sorry, something went wrong. Please call back.</Say></Response>`
      );
    }
  });

  /**
   * POST /api/comm/voice/:sessionId/complete
   * Complete a voice session (record outcome, disposition).
   * Body: { tenantId, disposition?, durationSeconds?, transcript? }
   */
  app.post("/api/comm/voice/:sessionId/complete", async (req: Request, res: Response) => {
    try {
      const { tenantId, ...rest } = req.body ?? {};
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { completeVoiceSession } = await getVoice();
      await completeVoiceSession({ sessionId: req.params.sessionId, tenantId, ...rest });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * POST /api/comm/voice/:sessionId/transfer
   * Transfer an active voice session to a human agent.
   * Body: { tenantId, transferTo? }
   */
  app.post("/api/comm/voice/:sessionId/transfer", async (req: Request, res: Response) => {
    try {
      const { tenantId, transferTo } = req.body ?? {};
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { transferToHuman } = await getVoice();
      await transferToHuman({
        sessionId:       req.params.sessionId as string,
        tenantId,
        communicationId: transferTo ?? (req.params.sessionId as string),
        reason:          "admin_transfer",
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/comm/voice/sessions/active
   * Active voice sessions for a tenant.
   * Query: tenantId
   */
  app.get("/api/comm/voice/sessions/active", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getActiveVoiceSessions } = await getVoice();
      res.json(await getActiveVoiceSessions(tenantId));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/comm/voice/stats
   * Voice channel stats for a tenant.
   * Query: tenantId
   */
  app.get("/api/comm/voice/stats", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getVoiceStats } = await getVoice();
      res.json(await getVoiceStats(tenantId));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  // ── iMessage Drafts ──────────────────────────────────────────────────────────

  /**
   * POST /api/comm/imessage/draft
   * Create an AI-drafted iMessage reply for human review.
   * Body: { tenantId, contactPhone?, contactName?, workflowType, businessName,
   *          contextSummary?, lastMessage?, bookingLink? }
   *
   * NOTE: iMessage drafts ALWAYS require human approval.
   *       The system generates the draft; the human sends from their own device.
   */
  app.post("/api/comm/imessage/draft", async (req: Request, res: Response) => {
    try {
      const { tenantId, workflowType, businessName, ...rest } = req.body ?? {};
      if (!tenantId || !workflowType || !businessName) {
        return res.status(400).json({ error: "tenantId, workflowType, businessName required" });
      }
      const { createIMessageDraft } = await getImessage();
      const result = await createIMessageDraft({ tenantId, workflowType, businessName, ...rest });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/comm/imessage/pending
   * Pending iMessage drafts awaiting human review.
   * Query: tenantId, limit?
   */
  app.get("/api/comm/imessage/pending", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getPendingIMessageDrafts } = await getImessage();
      res.json(await getPendingIMessageDrafts(tenantId, qsNum(req.query.limit, 20)));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * POST /api/comm/imessage/:id/confirm-sent
   * Confirm that the human sent the iMessage from their device.
   * Body: { tenantId, sentBy, optionSent? }
   */
  app.post("/api/comm/imessage/:id/confirm-sent", async (req: Request, res: Response) => {
    try {
      const { tenantId, sentBy, optionSent } = req.body ?? {};
      if (!tenantId || !sentBy) {
        return res.status(400).json({ error: "tenantId, sentBy required" });
      }
      const { confirmIMessageSent } = await getImessage();
      await confirmIMessageSent({ draftId: req.params.id as string, tenantId, sentBy, optionSent });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * POST /api/comm/imessage/:id/dismiss
   * Dismiss an iMessage draft (will not be sent).
   * Body: { tenantId }
   */
  app.post("/api/comm/imessage/:id/dismiss", async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.body ?? {};
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { dismissIMessageDraft } = await getImessage();
      await dismissIMessageDraft(req.params.id as string, tenantId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/comm/imessage/stats
   * iMessage draft stats (pending/sent/dismissed) — 30-day window.
   * Query: tenantId
   */
  app.get("/api/comm/imessage/stats", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getIMessageStats } = await getImessage();
      res.json(await getIMessageStats(tenantId));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  // ── Conversation Intelligence ─────────────────────────────────────────────────

  /**
   * POST /api/comm/intelligence/analyze
   * Analyze a conversation for sentiment, urgency, conversion likelihood, etc.
   * Body: { tenantId, communicationId, contactPhone?, messages: [{role, content}],
   *          workflowType? }
   */
  app.post("/api/comm/intelligence/analyze", async (req: Request, res: Response) => {
    try {
      const { tenantId, communicationId, messages, ...rest } = req.body ?? {};
      if (!tenantId || !communicationId || !Array.isArray(messages)) {
        return res.status(400).json({ error: "tenantId, communicationId, messages[] required" });
      }
      const { analyzeConversation } = await getIntelligence();
      const result = await analyzeConversation({ tenantId, communicationId, messages, ...rest });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/comm/intelligence/:commId
   * Fetch the latest intelligence analysis for a communication.
   * Query: tenantId
   */
  app.get("/api/comm/intelligence/:commId", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getConversationIntelligence } = await getIntelligence();
      const result = await getConversationIntelligence(req.params.commId as string, tenantId);
      if (!result) return res.status(404).json({ error: "Not found" });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  // ── Timeline ─────────────────────────────────────────────────────────────────

  /**
   * GET /api/comm/timeline
   * Recent timeline events for a tenant (command center feed).
   * Query: tenantId, limit?, channel?, eventType?
   */
  app.get("/api/comm/timeline", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getTenantTimeline } = await getTimeline();
      const events = await getTenantTimeline({
        tenantId,
        limit:     qsNum(req.query.limit, 100),
        eventType: qs(req.query.eventType)  as any,
      });
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/comm/timeline/search
   * Full-text search across the timeline.
   * Query: tenantId, q, limit?
   */
  app.get("/api/comm/timeline/search", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      const q        = qs(req.query.q);
      if (!tenantId || !q) return res.status(400).json({ error: "tenantId, q required" });
      const { searchTimeline } = await getTimeline();
      res.json(await searchTimeline({ tenantId, query: q, limit: qsNum(req.query.limit, 50) }));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  /**
   * GET /api/comm/timeline/stats
   * 24-hour timeline stats (events by type, channel, actor category).
   * Query: tenantId
   */
  app.get("/api/comm/timeline/stats", async (req: Request, res: Response) => {
    try {
      const tenantId = qs(req.query.tenantId);
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });
      const { getTimelineStats } = await getTimeline();
      res.json(await getTimelineStats(tenantId));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  });

  console.log("[COMM-ROUTES] Communications admin routes registered");
}
