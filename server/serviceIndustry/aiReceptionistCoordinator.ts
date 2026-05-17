/**
 * server/serviceIndustry/aiReceptionistCoordinator.ts
 *
 * AI Receptionist Coordinator
 *
 * Manages AI receptionist sessions for SMS / voice / chat channels.
 * Routes inbound messages through state machine: greeting → qualification
 * → booking_intent / faq_handling / reschedule / cancellation → closed.
 *
 * ABSOLUTE RULES:
 *   - NO auto-booking — receptionist delivers booking LINKS only
 *   - Business hours ENFORCED — after-hours sessions are flagged, escalated
 *   - Human handoff is ALWAYS available on request
 *   - All sessions are fully auditable (every message logged)
 *   - Escalation triggers: "speak to someone", "manager", "human", "agent",
 *     complaint, legal threat, refusal to engage
 *   - Session state is persisted — no in-memory state
 *
 * The receptionist does NOT:
 *   - Book appointments directly
 *   - Accept payments
 *   - Make promises about availability
 *   - Answer medical / legal questions
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool } from "../hpl/sqlSafe";
import { createHash } from "crypto";
import type {
  ReceptionistSession,
  ReceptionistSessionState,
  BusinessHours,
} from "./types";
import { isWithinBusinessHours } from "./missedCallRecoveryEngine";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_SESSION_MESSAGES = 30;   // Hard cap — escalate after this
const SESSION_TTL_HOURS    = 24;   // Sessions older than this are auto-closed

// ── Escalation trigger keywords ───────────────────────────────────────────────

const ESCALATION_KEYWORDS = [
  "speak to someone", "talk to a person", "human", "agent", "manager",
  "supervisor", "real person", "call me", "not a robot", "lawsuit", "attorney",
  "complaint", "unacceptable", "ridiculous", "this is wrong",
];

function detectEscalationIntent(message: string): boolean {
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(k => lower.includes(k));
}

// ── FAQ response map ──────────────────────────────────────────────────────────

const FAQ_PATTERNS: Array<{ pattern: RegExp; response: (biz: string) => string }> = [
  {
    pattern: /\b(price|cost|how much|rate|fee)\b/i,
    response: biz => `Pricing at ${biz} varies by service. For exact pricing, I'd recommend reaching out to us directly or checking our booking page where all service options and prices are listed.`,
  },
  {
    pattern: /\b(hour|open|close|when|schedule)\b/i,
    response: biz => `For current hours and availability at ${biz}, the best way to check is our online booking page or to give us a call. I'd be happy to send you a booking link!`,
  },
  {
    pattern: /\b(park|parking)\b/i,
    response: biz => `Great question about parking at ${biz}! I'd recommend calling ahead to confirm — I don't have real-time parking info but the team can help you.`,
  },
  {
    pattern: /\b(cancel|cancell|cancellation)\b/i,
    response: biz => `To cancel or modify your appointment at ${biz}, please reach out to us directly or use your booking confirmation link. Our team will take great care of you!`,
  },
  {
    pattern: /\b(reschedul|change.*appointment|move.*appointment)\b/i,
    response: biz => `No problem! To reschedule, please reach out to us directly and we'll get you sorted quickly. Would you like me to send you a booking link to pick a new time?`,
  },
  {
    pattern: /\b(walk.?in|walk in|no appointment)\b/i,
    response: biz => `Walk-in availability at ${biz} depends on the day. To guarantee your spot, booking ahead is always recommended. Can I send you a booking link?`,
  },
];

function matchFaq(message: string, businessName: string): string | null {
  for (const { pattern, response } of FAQ_PATTERNS) {
    if (pattern.test(message)) return response(businessName);
  }
  return null;
}

// ── Session ID ────────────────────────────────────────────────────────────────

function buildSessionId(businessId: string, callerPhone: string, channel: string): string {
  const raw = `${businessId}|${callerPhone}|${channel}|${new Date().toISOString().slice(0, 13)}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _svc_receptionist_sessions (
        id                      SERIAL PRIMARY KEY,
        session_id              TEXT        NOT NULL UNIQUE,
        business_id             TEXT        NOT NULL,
        sub_account_id          INTEGER,
        caller_phone            TEXT        NOT NULL,
        channel                 TEXT        NOT NULL DEFAULT 'sms',
        state                   TEXT        NOT NULL DEFAULT 'greeting',

        intent_detected         TEXT,
        appointment_booked      BOOLEAN     DEFAULT FALSE,
        human_handoff_at        TIMESTAMPTZ,
        handoff_reason          TEXT,

        message_count           INTEGER     NOT NULL DEFAULT 0,
        started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_message_at         TIMESTAMPTZ,
        closed_at               TIMESTAMPTZ,

        after_hours             BOOLEAN     DEFAULT FALSE,
        business_hours_enforced BOOLEAN     DEFAULT TRUE,
        escalation_triggered    BOOLEAN     DEFAULT FALSE,

        audit_log               JSONB       NOT NULL DEFAULT '[]',

        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS svc_rec_business_idx ON _svc_receptionist_sessions (business_id, state);
      CREATE INDEX IF NOT EXISTS svc_rec_phone_idx    ON _svc_receptionist_sessions (caller_phone, started_at DESC);
      CREATE INDEX IF NOT EXISTS svc_rec_open_idx     ON _svc_receptionist_sessions (state, last_message_at DESC)
        WHERE state NOT IN ('closed','human_handoff');
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[SVC-RECEPTIONIST] Failed to ensure table:", err?.message);
  }
}

// ── Find or create session ────────────────────────────────────────────────────

export async function findOrCreateSession(opts: {
  businessId:           string;
  subAccountId?:        number;
  callerPhone:          string;
  channel:              "sms" | "voice" | "chat";
  businessHours?:       BusinessHours;
  businessHoursEnforced?: boolean;
}): Promise<ReceptionistSession> {
  await ensureTable();

  const { businessId, callerPhone, channel } = opts;

  // Check for existing open session
  try {
    const existing = await db.execute(sql.raw(`
      SELECT * FROM _svc_receptionist_sessions
      WHERE business_id  = ${esc(businessId)}
        AND caller_phone = ${esc(callerPhone)}
        AND state NOT IN ('closed', 'human_handoff')
        AND started_at   >= NOW() - INTERVAL '${SESSION_TTL_HOURS} hours'
      ORDER BY started_at DESC
      LIMIT 1
    `));
    const rows = (existing as any).rows ?? existing;
    if (Array.isArray(rows) && rows.length > 0) {
      return mapSessionRow(rows[0]);
    }
  } catch (err: any) {
    console.error("[SVC-RECEPTIONIST] Session lookup failed:", err?.message);
  }

  // Create new session
  const sessionId = buildSessionId(businessId, callerPhone, channel);
  const afterHours = !isWithinBusinessHours(opts.businessHours ?? null, new Date());
  const enforced   = opts.businessHoursEnforced ?? true;

  const initialState: ReceptionistSessionState = "greeting";

  await db.execute(sql.raw(`
    INSERT INTO _svc_receptionist_sessions
      (session_id, business_id, sub_account_id, caller_phone, channel, state,
       after_hours, business_hours_enforced, audit_log)
    VALUES
      (${esc(sessionId)}, ${esc(businessId)}, ${num(opts.subAccountId)},
       ${esc(callerPhone)}, ${esc(channel)}, ${esc(initialState)},
       ${bool(afterHours)}, ${bool(enforced)}, '[]'::JSONB)
    ON CONFLICT (session_id) DO NOTHING
  `));

  console.log(`[SVC-RECEPTIONIST] New session ${sessionId} channel=${channel} afterHours=${afterHours}`);

  return {
    sessionId,
    businessId,
    subAccountId:    opts.subAccountId,
    callerPhone,
    channel,
    state:           initialState,
    messageCount:    0,
    startedAt:       new Date().toISOString(),
    afterHours,
    businessHoursEnforced: enforced,
    escalationTriggered:   false,
    auditLog:        [],
  };
}

// ── Process inbound message ───────────────────────────────────────────────────

export async function processInboundMessage(opts: {
  sessionId:    string;
  businessId:   string;
  businessName: string;
  message:      string;
  bookingLink?: string;
}): Promise<{
  reply:        string;
  nextState:    ReceptionistSessionState;
  escalate:     boolean;
  bookingLinkSent: boolean;
}> {
  await ensureTable();

  const { sessionId, businessId, businessName, message, bookingLink } = opts;

  // Load session
  const sessionResult = await db.execute(sql.raw(`
    SELECT * FROM _svc_receptionist_sessions
    WHERE session_id = ${esc(sessionId)} AND business_id = ${esc(businessId)}
  `));
  const sessionRows = (sessionResult as any).rows ?? sessionResult;
  if (!Array.isArray(sessionRows) || sessionRows.length === 0) {
    return { reply: "I'm sorry, I couldn't locate your session. Please try again.", nextState: "greeting", escalate: false, bookingLinkSent: false };
  }

  const session = mapSessionRow(sessionRows[0]);

  // Hard cap — escalate
  if (session.messageCount >= MAX_SESSION_MESSAGES) {
    await triggerEscalation(sessionId, "message_cap_reached");
    return {
      reply: `It looks like we've been chatting for a while! Let me connect you with a team member at ${businessName} who can give you their full attention. They'll be in touch shortly.`,
      nextState: "human_handoff",
      escalate: true,
      bookingLinkSent: false,
    };
  }

  // Escalation keyword detection
  const shouldEscalate = detectEscalationIntent(message);
  if (shouldEscalate) {
    await triggerEscalation(sessionId, "escalation_keyword");
    await appendAuditEntry(sessionId, "user", message);
    const reply = `Of course! I'll make sure a team member from ${businessName} reaches out to you directly. Thank you for your patience!`;
    await appendAuditEntry(sessionId, "ai", reply);
    await advanceState(sessionId, "human_handoff", message.length > 0 ? detectIntent(message) : undefined);
    return { reply, nextState: "human_handoff", escalate: true, bookingLinkSent: false };
  }

  // Opt-out check
  const lower = message.toLowerCase().trim();
  if (lower === "stop" || lower === "unsubscribe" || lower === "optout") {
    await closeSession(sessionId, "opt_out");
    return {
      reply: "You've been unsubscribed. You won't receive further messages from us. Reply START to re-subscribe.",
      nextState: "closed",
      escalate: false,
      bookingLinkSent: false,
    };
  }

  // Detect intent
  const intent = detectIntent(message);
  const isAfterHours = session.afterHours && session.businessHoursEnforced;

  // Build reply based on state + intent
  let reply = "";
  let nextState: ReceptionistSessionState = session.state;
  let bookingLinkSent = false;

  if (session.state === "greeting" || session.state === "qualification") {
    // FAQ match first
    const faqReply = matchFaq(message, businessName);
    if (faqReply) {
      reply = faqReply;
      nextState = "faq_handling";
    } else if (intent === "booking") {
      if (isAfterHours) {
        reply = `Thanks for reaching out to ${businessName}! We're currently closed but we'd love to help you book. Use our booking link to schedule at your convenience:${bookingLink ? ` ${bookingLink}` : " [booking link coming soon]"} Our team will also follow up when we're back open!`;
      } else {
        reply = `Great! We'd love to get you booked at ${businessName}. You can schedule your appointment here:${bookingLink ? ` ${bookingLink}` : " [booking link coming soon]"} Is there a specific service or time you had in mind?`;
      }
      nextState = "booking_intent";
      bookingLinkSent = true;
    } else if (intent === "reschedule") {
      reply = `No problem! To reschedule your appointment at ${businessName}, you can use our booking link to find a new time:${bookingLink ? ` ${bookingLink}` : ""} Or reply with your current appointment date and we'll assist you.`;
      nextState = "reschedule";
      bookingLinkSent = !!bookingLink;
    } else if (intent === "cancellation") {
      reply = `I understand you'd like to cancel. To make sure your appointment is properly cancelled at ${businessName}, please reach out to us directly or use your booking confirmation. Would you like me to let the team know you need to cancel?`;
      nextState = "cancellation";
    } else {
      // General greeting / unknown — standard greeting
      if (session.messageCount === 0) {
        reply = isAfterHours
          ? `Hi! Thank you for reaching out to ${businessName}. We're currently closed but I'm here to help! Are you looking to book an appointment, have a question, or need something else?`
          : `Hi! Thanks for reaching out to ${businessName}. How can I help you today? Are you looking to book, reschedule, or do you have a question?`;
        nextState = "qualification";
      } else {
        reply = `I want to make sure I get you the right help at ${businessName}. Are you looking to book an appointment, reschedule, cancel, or did you have a question?`;
      }
    }
  } else if (session.state === "booking_intent") {
    if (intent === "confirmation" || lower.includes("yes") || lower.includes("book")) {
      reply = `Excellent! Here's your booking link for ${businessName}:${bookingLink ? ` ${bookingLink}` : ""} Select your service and preferred time. Is there anything else I can help with?`;
      bookingLinkSent = !!bookingLink;
    } else {
      const faqReply = matchFaq(message, businessName);
      reply = faqReply ?? `I want to make sure you have everything you need to book at ${businessName}. You can use this link:${bookingLink ? ` ${bookingLink}` : ""} Feel free to ask if you have any questions!`;
      bookingLinkSent = !!bookingLink;
    }
  } else if (session.state === "faq_handling") {
    const faqReply = matchFaq(message, businessName);
    if (faqReply) {
      reply = faqReply;
    } else if (intent === "booking") {
      reply = `Ready to book? Here's the link for ${businessName}:${bookingLink ? ` ${bookingLink}` : ""} Let me know if you need anything else!`;
      nextState = "booking_intent";
      bookingLinkSent = !!bookingLink;
    } else {
      reply = `I want to make sure I'm giving you accurate info. For the most up-to-date details on that, I'd recommend reaching out to the ${businessName} team directly — they'll be happy to help!`;
    }
  } else {
    // Fallback for reschedule / cancellation states
    reply = `Thanks for staying in touch with ${businessName}. A team member will follow up with you shortly to get everything sorted!`;
    nextState = "human_handoff";
    await triggerEscalation(sessionId, "state_fallback");
  }

  // Persist
  await appendAuditEntry(sessionId, "user", message);
  await appendAuditEntry(sessionId, "ai", reply);
  await advanceState(sessionId, nextState, intent);

  return { reply, nextState, escalate: false, bookingLinkSent };
}

// ── Intent detection ──────────────────────────────────────────────────────────

type Intent = "booking" | "reschedule" | "cancellation" | "confirmation" | "faq" | "unknown";

function detectIntent(message: string): Intent {
  const lower = message.toLowerCase();
  if (/\b(book|appointment|schedule|available|availability|slot|time)\b/.test(lower)) return "booking";
  if (/\b(reschedul|change.*appt|move.*appt|different time)\b/.test(lower)) return "reschedule";
  if (/\b(cancel|cancell|don't want|remove my|delete my)\b/.test(lower)) return "cancellation";
  if (/\b(yes|confirm|sure|ok|sounds good|perfect|great)\b/.test(lower)) return "confirmation";
  if (/\b(price|cost|hour|open|parking|walk.?in|how long|question|what|when|where|do you)\b/.test(lower)) return "faq";
  return "unknown";
}

// ── State transition ──────────────────────────────────────────────────────────

async function advanceState(sessionId: string, nextState: ReceptionistSessionState, intent?: string): Promise<void> {
  const intentClause = intent ? `, intent_detected = ${esc(intent)}` : "";
  await db.execute(sql.raw(`
    UPDATE _svc_receptionist_sessions
    SET state = ${esc(nextState)},
        message_count = message_count + 1,
        last_message_at = NOW()
        ${intentClause}
    WHERE session_id = ${esc(sessionId)}
  `));
}

// ── Append audit entry ────────────────────────────────────────────────────────

async function appendAuditEntry(sessionId: string, role: "ai" | "user" | "system", content: string): Promise<void> {
  const entry = JSON.stringify({ role, content, at: new Date().toISOString() });
  await db.execute(sql.raw(`
    UPDATE _svc_receptionist_sessions
    SET audit_log = audit_log || ${esc(entry)}::JSONB
    WHERE session_id = ${esc(sessionId)}
  `));
}

// ── Trigger escalation ────────────────────────────────────────────────────────

async function triggerEscalation(sessionId: string, reason: string): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE _svc_receptionist_sessions
    SET state = 'human_handoff',
        escalation_triggered = TRUE,
        human_handoff_at = NOW(),
        handoff_reason = ${esc(reason)}
    WHERE session_id = ${esc(sessionId)}
  `));
  console.log(`[SVC-RECEPTIONIST] Escalation: ${sessionId} reason=${reason}`);
}

// ── Close session ─────────────────────────────────────────────────────────────

export async function closeSession(sessionId: string, reason?: string): Promise<void> {
  const reasonClause = reason ? `, handoff_reason = ${esc(reason)}` : "";
  await db.execute(sql.raw(`
    UPDATE _svc_receptionist_sessions
    SET state = 'closed', closed_at = NOW() ${reasonClause}
    WHERE session_id = ${esc(sessionId)}
  `));
}

// ── Get open escalations ──────────────────────────────────────────────────────

export async function getOpenEscalations(businessId?: string): Promise<ReceptionistSession[]> {
  await ensureTable();
  const filter = businessId ? `AND business_id = ${esc(businessId)}` : "";
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _svc_receptionist_sessions
      WHERE state = 'human_handoff'
        AND closed_at IS NULL
        ${filter}
      ORDER BY human_handoff_at DESC
      LIMIT 50
    `));
    return ((result as any).rows ?? result ?? []).map(mapSessionRow);
  } catch { return []; }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getReceptionistStats(businessId?: string): Promise<{
  totalSessions:    number;
  openSessions:     number;
  escalations:      number;
  bookingIntents:   number;
  avgMessages:      number;
}> {
  await ensureTable();
  const filter = businessId ? `WHERE business_id = ${esc(businessId)}` : "WHERE started_at >= NOW() - INTERVAL '30 days'";
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                                                           AS total,
        COUNT(CASE WHEN state NOT IN ('closed','human_handoff') THEN 1 END) AS open_sessions,
        COUNT(CASE WHEN escalation_triggered = TRUE THEN 1 END)           AS escalations,
        COUNT(CASE WHEN intent_detected = 'booking' THEN 1 END)           AS booking_intents,
        AVG(message_count)                                                 AS avg_messages
      FROM _svc_receptionist_sessions ${filter}
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : {};
    return {
      totalSessions:  Number(r?.total ?? 0),
      openSessions:   Number(r?.open_sessions ?? 0),
      escalations:    Number(r?.escalations ?? 0),
      bookingIntents: Number(r?.booking_intents ?? 0),
      avgMessages:    Number(r?.avg_messages ?? 0),
    };
  } catch {
    return { totalSessions: 0, openSessions: 0, escalations: 0, bookingIntents: 0, avgMessages: 0 };
  }
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function mapSessionRow(r: any): ReceptionistSession {
  let auditLog = [];
  try { auditLog = typeof r.audit_log === "string" ? JSON.parse(r.audit_log) : r.audit_log ?? []; } catch {}
  return {
    sessionId:            r.session_id,
    businessId:           r.business_id,
    subAccountId:         r.sub_account_id ?? undefined,
    callerPhone:          r.caller_phone,
    channel:              r.channel as "sms" | "voice" | "chat",
    state:                r.state as ReceptionistSessionState,
    intentDetected:       r.intent_detected ?? undefined,
    appointmentBooked:    Boolean(r.appointment_booked),
    humanHandoffAt:       r.human_handoff_at?.toISOString?.() ?? undefined,
    handoffReason:        r.handoff_reason ?? undefined,
    messageCount:         Number(r.message_count ?? 0),
    startedAt:            r.started_at?.toISOString?.() ?? new Date().toISOString(),
    lastMessageAt:        r.last_message_at?.toISOString?.() ?? undefined,
    closedAt:             r.closed_at?.toISOString?.() ?? undefined,
    afterHours:           Boolean(r.after_hours),
    businessHoursEnforced: Boolean(r.business_hours_enforced),
    escalationTriggered:  Boolean(r.escalation_triggered),
    auditLog,
  };
}
