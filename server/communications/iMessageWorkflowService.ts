/**
 * server/communications/iMessageWorkflowService.ts
 *
 * iMessage Assisted Workflow Service
 *
 * HUMAN-SUPERVISED ONLY. This service prepares AI-assisted content
 * for human use in iMessage — it NEVER sends iMessages automatically.
 *
 * Use cases:
 *   - Founder inbox workflows (high-touch lead management)
 *   - VIP lead handling
 *   - Local business relationship communications
 *   - Appointment follow-ups for key clients
 *   - AI-drafted replies awaiting human approval
 *
 * Architecture:
 *   1. Conversation context is ingested (prior messages, CRM data)
 *   2. AI generates 2-3 reply options
 *   3. Draft is stored with status=pending
 *   4. Human reviews and either sends via their own iMessage app OR dismisses
 *   5. System records what was sent (for CRM sync)
 *
 * ABSOLUTE RULES:
 *   - NO mass iMessage automation
 *   - NO automated sends — human must always initiate from their device
 *   - Draft suggestions only — not commands
 *   - Approval required before draft is surfaced to user
 *   - CRM sync only after human confirms send
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num } from "../hpl/sqlSafe";
import { createHash } from "crypto";
import type { IMessageDraft, CommWorkflowType } from "./types";
import { requiresApproval } from "./communicationSafetyEngine";
import { appendTimelineEvent } from "./communicationTimelineService";
import { analyzeSentiment } from "./conversationIntelligenceService";

// ── ID builder ────────────────────────────────────────────────────────────────

function buildDraftId(tenantId: string, contactPhone: string, ts: string): string {
  const raw = `imessage|${tenantId}|${contactPhone}|${ts}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── AI draft generator (no external call — deterministic templates) ────────────

export function generateIMessageDraftOptions(opts: {
  contactName?:  string;
  businessName:  string;
  workflowType:  CommWorkflowType;
  contextSummary?: string;
  lastMessage?:  string;
  bookingLink?:  string;
}): string[] {
  const { contactName, businessName, workflowType, bookingLink, lastMessage } = opts;
  const hi   = contactName ? `Hey ${contactName}` : "Hey";
  const link = bookingLink ? ` ${bookingLink}` : "";

  const templates: Record<CommWorkflowType, string[]> = {
    lead_followup: [
      `${hi}! Just wanted to personally follow up — would love to see how we can help at ${businessName}. When's a good time to chat?`,
      `${hi}, circling back on your inquiry. Happy to answer any questions or get you set up — just say the word!`,
      `${hi}! If you're still exploring options, I'd love to connect and learn more about what you need. No pressure at all.`,
    ],
    vip_outreach: [
      `${hi}, just wanted to personally reach out and say how much we appreciate your trust in ${businessName}. Anything I can do for you?`,
      `${hi}! As one of our most valued clients, I wanted to check in personally. Everything going well?`,
      `${hi}, thinking of you! If there's ever anything we can do to make your experience even better, please don't hesitate to reach out.`,
    ],
    appointment_reminder: [
      `${hi}! Quick reminder about your upcoming appointment at ${businessName}.${link} Looking forward to seeing you!`,
      `${hi}, just a friendly heads-up about your appointment. Let me know if you need to make any changes!`,
      `${hi}! Excited to see you soon at ${businessName}. Reply here if anything comes up.`,
    ],
    missed_call_recovery: [
      `${hi}! I noticed I missed your call earlier. I'd love to connect — when's the best time to reach you?`,
      `${hi}, sorry I missed you! What can I help you with? Happy to chat whenever works for you.`,
      `${hi}! Give me a ring back when you get a chance, or just text me here — whatever's easiest for you!`,
    ],
    inbound_response: [
      `${hi}! Thanks for reaching out. ${lastMessage ? `Regarding "${lastMessage.slice(0, 60)}…" — ` : ""}happy to help!`,
      `${hi}, got your message! Let me look into that for you and get right back to you.`,
      `${hi}! Thanks for getting in touch with ${businessName}. How can I help?`,
    ],
    estimate_followup: [
      `${hi}! Just following up on your estimate — any questions I can answer? Happy to walk through everything with you.`,
      `${hi}, wanted to check in about the estimate we sent over. Does everything look good? Ready to move forward when you are!`,
      `${hi}! No pressure at all — just wanted to make sure you had what you need. I'm here if you have any questions.`,
    ],
    review_request: [
      `${hi}! It was so great working with you. If you have a moment, we'd love a quick review — it means the world to small businesses like ours.${link}`,
      `${hi}, hope everything went smoothly! If you're happy with the experience, a quick Google review would help us so much.${link}`,
      `${hi}! Thanks again for choosing ${businessName}. Would you mind leaving us a review? It takes just a minute and helps us a ton!${link}`,
    ],
    reactivation: [
      `${hi}! It's been a while and I wanted to personally reach out — we'd love to have you back at ${businessName}. What do you say?`,
      `${hi}, just thinking about you! It's been a bit since your last visit. Anything we can do to get you back in?`,
      `${hi}! Hope all is well. We have some new things at ${businessName} that I think you'd love. Miss seeing you!`,
    ],
    insurance_outreach: [
      `${hi}! I have some information about your coverage that I'd love to share personally. When is a good time to connect?`,
      `${hi}, I wanted to reach out directly because I think there's an opportunity here that could really benefit you. Quick call?`,
      `${hi}! This is ${opts.businessName} — I'd love to catch up and make sure you have the right coverage. Do you have 10 minutes?`,
    ],
    contractor_outreach: [
      `${hi}! I'd love to personally help you with your project. When's a good time for a quick conversation?`,
      `${hi}, thanks for your interest in ${businessName}. I'd love to learn more about your project and see how we can help.`,
      `${hi}! Happy to answer any questions or set up a free estimate. Just let me know what works for you.`,
    ],
    legal_intake: [
      `${hi}, thank you for reaching out. I want to make sure you're taken care of. Is there a good time to connect?`,
      `${hi}! I received your inquiry and wanted to personally follow up. We're here to help — when can we talk?`,
      `${hi}, I understand you may be going through a difficult time. Please know we're here for you. When works for a quick call?`,
    ],
    appointment_confirmation: [
      `${hi}! Your appointment at ${businessName} is all set. Looking forward to seeing you!`,
      `${hi}, just confirming everything is good to go for your appointment. See you soon!`,
      `${hi}! Confirmed — we're all set. Can't wait to see you at ${businessName}!`,
    ],
    retention_campaign: [
      `${hi}! Thinking about you — it's been a while since your last visit and we'd love to have you back.${link}`,
      `${hi}, hope everything is going well! We have some great things happening at ${businessName} and would love to see you.`,
      `${hi}! Miss seeing you at ${businessName}. Whenever you're ready, we're here.${link}`,
    ],
    loyalty_notification: [
      `${hi}! You've reached a loyalty milestone at ${businessName}! Ask about your reward next time you visit.`,
      `${hi}, exciting news — you've earned a loyalty reward! Can't wait to celebrate with you.`,
      `${hi}! Your loyalty means everything to us. You've unlocked something special — ask us about it!`,
    ],
    imessage_draft: [
      `${hi}! ${opts.contextSummary ?? "Just checking in — how are you doing?"}`,
      `${hi}, wanted to personally reach out. ${opts.contextSummary ?? "How can we help?"}`,
      `${hi}! Hope you're doing well. ${opts.contextSummary ?? "Let me know if there's anything I can do for you."}`,
    ],
    voicemail_followup: [
      `${hi}! I noticed you left a voicemail — so sorry I missed you. What can I help with?`,
      `${hi}, saw I had a voicemail from you. I want to make sure I get back to you properly. What's up?`,
      `${hi}! Returning your message — when's the best time to connect?`,
    ],
    escalation_alert: [
      `${hi}, I wanted to personally reach out about your recent experience. Can we talk?`,
      `${hi}! I heard there may have been an issue — I want to make sure it gets resolved right away. What happened?`,
      `${hi}, I'm so sorry to hear about your experience. This isn't the standard we hold ourselves to. Can I call you?`,
    ],
    custom: [
      `${hi}! ${opts.contextSummary ?? "Just wanted to personally reach out."}`,
      `${hi}, ${opts.contextSummary ?? "how are you doing?"}`,
      `${hi}! ${opts.contextSummary ?? "Let me know if there's anything I can do for you."}`,
    ],
  };

  return templates[opts.workflowType] ?? templates.custom;
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _comm_imessage_drafts (
        id                 SERIAL PRIMARY KEY,
        draft_id           TEXT        NOT NULL UNIQUE,
        tenant_id          TEXT        NOT NULL,
        contact_phone      TEXT,
        contact_name       TEXT,
        workflow_type      TEXT        NOT NULL,
        communication_id   TEXT,
        ai_generated_text  TEXT        NOT NULL,
        context_summary    TEXT,
        response_options   JSONB       NOT NULL DEFAULT '[]',
        status             TEXT        NOT NULL DEFAULT 'pending',
        approved_by        TEXT,
        approved_at        TIMESTAMPTZ,
        sent_confirmed_at  TIMESTAMPTZ,
        dismissed_at       TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS comm_imsg_tenant_idx  ON _comm_imessage_drafts (tenant_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS comm_imsg_pending_idx ON _comm_imessage_drafts (status, created_at DESC) WHERE status = 'pending';
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[COMM-IMSG] Failed to ensure table:", err?.message);
  }
}

// ── Create draft ──────────────────────────────────────────────────────────────

export async function createIMessageDraft(opts: {
  tenantId:        string;
  contactPhone?:   string;
  contactName?:    string;
  communicationId?: string;
  workflowType:    CommWorkflowType;
  businessName:    string;
  contextSummary?: string;
  lastMessage?:    string;
  bookingLink?:    string;
}): Promise<{ draftId: string; options: string[]; requiresApproval: boolean }> {
  await ensureTable();

  const ts      = new Date().toISOString();
  const draftId = buildDraftId(opts.tenantId, opts.contactPhone ?? "unknown", ts);

  const options = generateIMessageDraftOptions({
    contactName:    opts.contactName,
    businessName:   opts.businessName,
    workflowType:   opts.workflowType,
    contextSummary: opts.contextSummary,
    lastMessage:    opts.lastMessage,
    bookingLink:    opts.bookingLink,
  });

  // iMessage drafts ALWAYS require approval
  const needsApproval = true;

  await db.execute(sql.raw(`
    INSERT INTO _comm_imessage_drafts
      (draft_id, tenant_id, contact_phone, contact_name, workflow_type,
       communication_id, ai_generated_text, context_summary, response_options, status)
    VALUES
      (${esc(draftId)}, ${esc(opts.tenantId)}, ${esc(opts.contactPhone ?? "")},
       ${esc(opts.contactName ?? "")}, ${esc(opts.workflowType)},
       ${esc(opts.communicationId ?? "")},
       ${esc(options[0])},
       ${esc(opts.contextSummary ?? "")},
       ${esc(JSON.stringify(options))},
       'pending')
    ON CONFLICT (draft_id) DO NOTHING
  `));

  if (opts.communicationId) {
    await appendTimelineEvent({
      communicationId: opts.communicationId,
      tenantId:        opts.tenantId,
      eventType:       "ai_reply_drafted",
      actor:           "ai",
      description:     `iMessage draft prepared for ${opts.contactPhone ?? "contact"} (awaiting human approval)`,
      metadata:        { draftId, workflowType: opts.workflowType },
    });
  }

  console.log(`[COMM-IMSG] Draft created: ${draftId} workflow=${opts.workflowType}`);
  return { draftId, options, requiresApproval: needsApproval };
}

// ── Confirm human sent ────────────────────────────────────────────────────────

export async function confirmIMessageSent(opts: {
  draftId:    string;
  tenantId:   string;
  sentBy:     string;
  optionSent?: string;
}): Promise<void> {
  await ensureTable();
  await db.execute(sql.raw(`
    UPDATE _comm_imessage_drafts
    SET status = 'sent_by_human', approved_by = ${esc(opts.sentBy)},
        approved_at = NOW(), sent_confirmed_at = NOW()
    WHERE draft_id = ${esc(opts.draftId)} AND tenant_id = ${esc(opts.tenantId)}
      AND status = 'pending'
  `));
  console.log(`[COMM-IMSG] Confirmed sent by ${opts.sentBy}: ${opts.draftId}`);
}

// ── Dismiss draft ─────────────────────────────────────────────────────────────

export async function dismissIMessageDraft(draftId: string, tenantId: string): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE _comm_imessage_drafts
    SET status = 'dismissed', dismissed_at = NOW()
    WHERE draft_id = ${esc(draftId)} AND tenant_id = ${esc(tenantId)} AND status = 'pending'
  `));
}

// ── Get pending drafts ────────────────────────────────────────────────────────

export async function getPendingIMessageDrafts(tenantId: string, limit = 20): Promise<IMessageDraft[]> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _comm_imessage_drafts
      WHERE tenant_id = ${esc(tenantId)} AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT ${num(limit)}
    `));
    return ((result as any).rows ?? result ?? []).map(mapDraftRow);
  } catch { return []; }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getIMessageStats(tenantId: string): Promise<{
  pending: number;
  sent:    number;
  dismissed: number;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(CASE WHEN status='pending' THEN 1 END) AS pending,
        COUNT(CASE WHEN status='sent_by_human' THEN 1 END) AS sent,
        COUNT(CASE WHEN status='dismissed' THEN 1 END) AS dismissed
      FROM _comm_imessage_drafts
      WHERE tenant_id = ${esc(tenantId)}
        AND created_at >= NOW() - INTERVAL '30 days'
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : {};
    return {
      pending:   Number(r?.pending ?? 0),
      sent:      Number(r?.sent ?? 0),
      dismissed: Number(r?.dismissed ?? 0),
    };
  } catch { return { pending: 0, sent: 0, dismissed: 0 }; }
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function mapDraftRow(r: any): IMessageDraft {
  let options: string[] = [];
  try { options = typeof r.response_options === "string" ? JSON.parse(r.response_options) : r.response_options ?? []; } catch {}
  return {
    draftId:         r.draft_id,
    tenantId:        r.tenant_id,
    contactPhone:    r.contact_phone || undefined,
    contactName:     r.contact_name || undefined,
    aiGeneratedText: r.ai_generated_text ?? "",
    contextSummary:  r.context_summary || undefined,
    responseOptions: options,
    status:          r.status as "pending" | "sent_by_human" | "dismissed",
    approvedBy:      r.approved_by || undefined,
    createdAt:       r.created_at?.toISOString?.() ?? undefined,
  };
}
