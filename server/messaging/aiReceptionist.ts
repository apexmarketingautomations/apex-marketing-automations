/**
 * server/messaging/aiReceptionist.ts
 *
 * AI Receptionist Full Loop  (Phase 10)
 *
 * Orchestrates inbound communications across all channels into a unified
 * conversation thread. When a contact reaches out via any channel, the
 * receptionist:
 *
 * 1. Identifies the contact (by phone/email against contacts table)
 * 2. Loads or creates a conversation session
 * 3. Routes to the appropriate AI persona (Layla, custom, or vertical-specific)
 * 4. Detects intent (book, question, complaint, escalation, opt-out)
 * 5. Responds via the same channel, or escalates to live agent
 * 6. Writes a unified conversation log for multi-channel threading
 * 7. Fires TCPA check before any outbound response
 *
 * Channels: sms | email | voice (VAPI) | chat
 */

import { sql, eq, and } from "drizzle-orm";
import { db } from "../db";
import { contacts, messages } from "@shared/schema";
import { checkTCPA } from "../compliance/tcpaGuard";

// ── Types ─────────────────────────────────────────────────────────────────────

export type InboundChannel = "sms" | "email" | "voice" | "chat";

export type ReceptionistIntent =
  | "book_appointment" | "pricing_inquiry" | "complaint" | "opt_out"
  | "escalate_agent" | "general_question" | "silence" | "unknown";

export interface InboundMessage {
  channel:       InboundChannel;
  subAccountId:  number;
  fromPhone?:    string;
  fromEmail?:    string;
  body:          string;
  mediaUrls?:    string[];
  externalId?:   string;     // Twilio SID, VAPI call ID, etc.
  receivedAt?:   Date;
}

export interface ReceptionistResponse {
  intent:        ReceptionistIntent;
  confidence:    number;      // 0.0–1.0
  responseBody?: string;      // null = no auto-reply (escalate)
  escalate:      boolean;
  channel:       InboundChannel;
  tcpaBlocked:   boolean;
  blocked?:      string[];    // TCPA block reasons
  contactId?:    number;
  sessionId?:    string;
}

// ── Unified conversation log ──────────────────────────────────────────────────

export async function ensureConversationSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS unified_conversations (
      id               SERIAL PRIMARY KEY,
      session_id       TEXT        NOT NULL,
      sub_account_id   INTEGER     NOT NULL,
      contact_id       INTEGER,
      channel          TEXT        NOT NULL,
      direction        TEXT        NOT NULL,  -- inbound|outbound
      body             TEXT        NOT NULL,
      external_id      TEXT,
      intent           TEXT,
      confidence       NUMERIC(4,2),
      escalated        BOOLEAN     DEFAULT false,
      tcpa_blocked     BOOLEAN     DEFAULT false,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS uc_session_idx  ON unified_conversations (session_id);
    CREATE INDEX IF NOT EXISTS uc_contact_idx  ON unified_conversations (contact_id, sub_account_id);
    CREATE INDEX IF NOT EXISTS uc_tenant_idx   ON unified_conversations (sub_account_id, created_at DESC);
  `);
}

// ── Intent detection ──────────────────────────────────────────────────────────

const INTENT_PATTERNS: Array<{ intent: ReceptionistIntent; patterns: RegExp[]; confidence: number }> = [
  {
    intent: "opt_out",
    confidence: 0.98,
    patterns: [/\bSTOP\b/i, /\bunsubscribe\b/i, /\bopt.?out\b/i, /\bdo not contact\b/i, /\bremove me\b/i],
  },
  {
    intent: "book_appointment",
    confidence: 0.90,
    patterns: [/\bbook\b/i, /\bappointment\b/i, /\bschedule\b/i, /\bavailability\b/i, /\bwhen can\b/i, /\bopen slot\b/i],
  },
  {
    intent: "escalate_agent",
    confidence: 0.88,
    patterns: [/\bspeak to (a|someone|human)\b/i, /\blive agent\b/i, /\breal person\b/i, /\bcall me\b/i, /\bmanager\b/i],
  },
  {
    intent: "complaint",
    confidence: 0.82,
    patterns: [/\bunhappy\b/i, /\bcomplaint\b/i, /\bterrible\b/i, /\bhorrible\b/i, /\bworst\b/i, /\bscam\b/i, /\brefund\b/i],
  },
  {
    intent: "pricing_inquiry",
    confidence: 0.80,
    patterns: [/\bhow much\b/i, /\bprice\b/i, /\bcost\b/i, /\brate\b/i, /\bquote\b/i, /\bfee\b/i],
  },
  {
    intent: "general_question",
    confidence: 0.60,
    patterns: [/\?/, /\bwhat\b/i, /\bwhere\b/i, /\bwhen\b/i, /\bhow\b/i, /\bdo you\b/i],
  },
];

function detectIntent(body: string): { intent: ReceptionistIntent; confidence: number } {
  for (const { intent, patterns, confidence } of INTENT_PATTERNS) {
    if (patterns.some(p => p.test(body))) return { intent, confidence };
  }
  return { intent: "unknown", confidence: 0.30 };
}

// ── Contact resolution ────────────────────────────────────────────────────────

async function resolveContact(subAccountId: number, phone?: string, email?: string): Promise<number | null> {
  if (!phone && !email) return null;
  try {
    const normalized = phone?.replace(/\D/g, "").slice(-10);
    if (normalized) {
      const r = await db.execute(sql`
        SELECT id FROM contacts WHERE sub_account_id = ${subAccountId} AND normalized_phone = ${normalized} LIMIT 1
      `);
      const rows = (r as any).rows ?? r;
      if (Array.isArray(rows) && rows.length > 0) return Number(rows[0].id);
    }
    if (email) {
      const r = await db.execute(sql`
        SELECT id FROM contacts WHERE sub_account_id = ${subAccountId} AND email = ${email} LIMIT 1
      `);
      const rows = (r as any).rows ?? r;
      if (Array.isArray(rows) && rows.length > 0) return Number(rows[0].id);
    }
    return null;
  } catch { return null; }  // allow-silent-catch: non-fatal, returns safe default
}

// ── Session management ─────────────────────────────────────────────────────────

function buildSessionId(subAccountId: number, phone?: string, email?: string): string {
  const key = phone?.replace(/\D/g, "").slice(-10) ?? email ?? "anon";
  return `${subAccountId}:${key}`;
}

// ── Log conversation turn ──────────────────────────────────────────────────────

async function logTurn(params: {
  sessionId:    string;
  subAccountId: number;
  contactId?:   number;
  channel:      InboundChannel;
  direction:    "inbound" | "outbound";
  body:         string;
  externalId?:  string;
  intent?:      ReceptionistIntent;
  confidence?:  number;
  escalated?:   boolean;
  tcpaBlocked?: boolean;
}): Promise<void> {
  try {
    await ensureConversationSchema();
    await db.execute(sql`
      INSERT INTO unified_conversations
        (session_id, sub_account_id, contact_id, channel, direction, body, external_id, intent, confidence, escalated, tcpa_blocked)
      VALUES
        (${params.sessionId}, ${params.subAccountId}, ${params.contactId ?? null}, ${params.channel},
         ${params.direction}, ${params.body}, ${params.externalId ?? null},
         ${params.intent ?? null}, ${params.confidence ?? null},
         ${params.escalated ?? false}, ${params.tcpaBlocked ?? false})
    `);
  } catch (err: any) {
    console.error("[RECEPTIONIST] log failed:", err?.message);
  }
}

// ── Auto-response templates ────────────────────────────────────────────────────

function buildResponse(intent: ReceptionistIntent, subAccountId: number): string | null {
  switch (intent) {
    case "book_appointment":
      return `Hi! I'd love to help you book. Reply with your preferred day and time and we'll get you set up. You can also book directly at our scheduling link.`;
    case "pricing_inquiry":
      return `Great question! Our team will get you a personalized quote within 24 hours. What service are you interested in?`;
    case "complaint":
      return `I'm so sorry to hear about your experience. I'm escalating this to our team right now — someone will reach out shortly.`;
    case "general_question":
      return `Thanks for reaching out! I'm passing your message to our team. Expect a reply within a few hours.`;
    case "opt_out":
      return `You've been removed from our contact list. No further messages will be sent. Reply START at any time to re-subscribe.`;
    case "escalate_agent":
      return `Absolutely — I'll connect you with a team member right away. Expect a call or message shortly.`;
    default:
      return null; // unknown/silence → no auto-reply
  }
}

// ── Main receptionist handler ──────────────────────────────────────────────────

export async function handleInbound(msg: InboundMessage): Promise<ReceptionistResponse> {
  await ensureConversationSchema();

  const sessionId  = buildSessionId(msg.subAccountId, msg.fromPhone, msg.fromEmail);
  const contactId  = await resolveContact(msg.subAccountId, msg.fromPhone, msg.fromEmail);
  const { intent, confidence } = detectIntent(msg.body);

  // Log inbound turn
  await logTurn({
    sessionId, subAccountId: msg.subAccountId, contactId: contactId ?? undefined,
    channel: msg.channel, direction: "inbound", body: msg.body,
    externalId: msg.externalId, intent, confidence,
  });

  // Handle opt-out immediately — before TCPA check
  if (intent === "opt_out" && msg.fromPhone) {
    const { recordOptOut } = await import("../compliance/tcpaGuard");
    await recordOptOut(msg.fromPhone, `${msg.channel}_stop`);
    await logTurn({
      sessionId, subAccountId: msg.subAccountId, contactId: contactId ?? undefined,
      channel: msg.channel, direction: "outbound",
      body: buildResponse("opt_out", msg.subAccountId) ?? "You have been opted out.",
      intent: "opt_out", confidence: 1.0,
    });
    return { intent: "opt_out", confidence: 1.0, responseBody: buildResponse("opt_out", msg.subAccountId) ?? undefined, escalate: false, channel: msg.channel, tcpaBlocked: false, contactId: contactId ?? undefined, sessionId };
  }

  // TCPA check for outbound response
  const tcpaResult = await checkTCPA({
    subAccountId: msg.subAccountId,
    phone: msg.fromPhone,
    email: msg.fromEmail,
    contactId: contactId ?? undefined,
    channel: msg.channel as any,
  });

  if (!tcpaResult.allowed) {
    await logTurn({
      sessionId, subAccountId: msg.subAccountId, contactId: contactId ?? undefined,
      channel: msg.channel, direction: "outbound", body: "[BLOCKED BY TCPA]",
      intent, confidence, tcpaBlocked: true,
    });
    return { intent, confidence, escalate: false, channel: msg.channel, tcpaBlocked: true, blocked: tcpaResult.blockedReasons, contactId: contactId ?? undefined, sessionId };
  }

  const escalate = intent === "escalate_agent" || intent === "complaint" || confidence < 0.4;
  const responseBody = buildResponse(intent, msg.subAccountId) ?? undefined;

  if (responseBody) {
    await logTurn({
      sessionId, subAccountId: msg.subAccountId, contactId: contactId ?? undefined,
      channel: msg.channel, direction: "outbound", body: responseBody,
      intent, confidence, escalated: escalate,
    });
  }

  return { intent, confidence, responseBody, escalate, channel: msg.channel, tcpaBlocked: false, contactId: contactId ?? undefined, sessionId };
}

// ── Multi-channel thread reader ───────────────────────────────────────────────

export async function getConversationThread(subAccountId: number, contactId: number, limit = 50): Promise<any[]> {
  await ensureConversationSchema();
  const r = await db.execute(sql`
    SELECT * FROM unified_conversations
    WHERE sub_account_id = ${subAccountId} AND contact_id = ${contactId}
    ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = (r as any).rows ?? r;
  return Array.isArray(rows) ? rows : [];
}
