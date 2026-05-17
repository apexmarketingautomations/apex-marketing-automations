/**
 * server/insurance/insuranceTransportAdapters.ts
 *
 * Insurance Transport Adapters
 *
 * Three channel adapters — SMS, Email, Voice — that wire the Insurance
 * Workflow Coordinator to the existing Apex messaging infrastructure.
 *
 * INVARIANT: every adapter calls assertApproved() as its ABSOLUTE FIRST LINE.
 *   If assertApproved() throws (ApprovalGateError), the adapter re-throws and
 *   nothing is sent. There is NO path to send without passing the gate.
 *
 * Post-send:
 *   - Workflow row marked status='executed', executed_at=NOW()
 *   - Global auditTrail entry written (INSURANCE_WORKFLOW_EXECUTED)
 *   - Delivery receipt stored on workflow row
 *
 * Channel routing by workflow type:
 *   SMS   — storm outreach, high-risk placement, lapse reactivation,
 *            bundle recommendation, homeowner welcome, new opportunity alert
 *   Email — commercial outreach, policy renewal reminder, quote followup
 *   Voice — reserved / falls back to SMS if no voice number provisioned
 *
 * Template hydration:
 *   Draft content stored on the workflow row (edited by approver) is used
 *   verbatim. If draft_content is empty the config template is hydrated with
 *   trigger_data values. Tokens are {{key}} style.
 */

import { assertApproved, ApprovalGateError } from "./insuranceApprovalGate";
import { audit } from "../auditTrail";
import { sendSms } from "../messaging/sendSms";
import { sendEmail } from "../messaging/sendEmail";
import { getTwilioClientForAccount } from "../twilioClientFactory";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { esc, num } from "../hpl/sqlSafe";
import { randomUUID } from "crypto";

// ── Channel type ──────────────────────────────────────────────────────────────

export type InsuranceChannel = "sms" | "email" | "voice";

// ── Channel routing map ───────────────────────────────────────────────────────

const WORKFLOW_CHANNEL: Record<string, InsuranceChannel> = {
  new_opportunity_alert:    "sms",
  storm_claim_outreach:     "sms",
  high_risk_placement:      "sms",
  lapse_reactivation:       "sms",
  bundle_recommendation:    "sms",
  homeowner_welcome:        "sms",
  roof_replacement_timing:  "sms",
  commercial_outreach:      "email",
  policy_renewal_reminder:  "email",
  quote_followup:           "email",
};

export function channelForWorkflowType(workflowType: string): InsuranceChannel {
  return WORKFLOW_CHANNEL[workflowType] ?? "sms";
}

// ── Template hydration ────────────────────────────────────────────────────────

/**
 * Replace {{key}} tokens with values from triggerData.
 * Missing tokens are left as-is (visible to approver during review).
 */
export function hydrateDraft(
  template: string,
  triggerData: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = triggerData[key];
    return val != null ? String(val) : `{{${key}}}`;
  });
}

// ── Execution result ──────────────────────────────────────────────────────────

export interface TransportResult {
  ok:          boolean;
  channel:     InsuranceChannel;
  workflowId:  number;
  messageSid?: string;
  error?:      string;
  gateCode?:   string;
}

// ── Mark workflow executed ────────────────────────────────────────────────────

async function markExecuted(
  workflowId: number,
  deliveryRef: string | undefined,
  channel: InsuranceChannel,
): Promise<void> {
  try {
    await db.execute(sql.raw(`
      UPDATE _ins_workflow_queue
      SET
        status       = 'executed',
        executed_at  = NOW(),
        error_message = NULL,
        trigger_data  = trigger_data || ${esc(JSON.stringify({ deliveryRef, channel, executedAt: new Date().toISOString() }))}::jsonb
      WHERE id = ${num(workflowId)}
    `));
  } catch (err: any) {
    console.error(`[INS-TRANSPORT] markExecuted failed for wf#${workflowId}:`, err?.message);
  }
}

async function markFailed(workflowId: number, reason: string): Promise<void> {
  try {
    await db.execute(sql.raw(`
      UPDATE _ins_workflow_queue
      SET error_message = ${esc(reason.slice(0, 500))}
      WHERE id = ${num(workflowId)}
    `));
  } catch { /* best effort */ }
}

// ── Contact resolution ────────────────────────────────────────────────────────

/**
 * Pull the recipient's phone / email from the workflow's trigger_data first,
 * then fall back to the household record if available.
 */
async function resolveContact(wf: Record<string, unknown>): Promise<{
  phone?: string;
  email?: string;
  name?: string;
}> {
  const td = (wf.trigger_data ?? {}) as Record<string, unknown>;
  const phone = (td.primaryPhone ?? td.phone ?? td.ownerPhone) as string | undefined;
  const email = (td.primaryEmail ?? td.email ?? td.ownerEmail) as string | undefined;
  const name  = (td.primaryName  ?? td.ownerName ?? td.name)   as string | undefined;

  // If still missing, try household record
  if ((!phone && !email) && wf.household_id) {
    try {
      const result = await db.execute(sql.raw(`
        SELECT primary_phone, primary_email, primary_name
        FROM _ins_households
        WHERE household_id = ${esc(wf.household_id as string)}
        LIMIT 1
      `));
      const rows = (result as any).rows ?? result;
      const r = Array.isArray(rows) ? rows[0] : undefined;
      if (r) {
        return {
          phone: phone ?? (r.primary_phone || undefined),
          email: email ?? (r.primary_email || undefined),
          name:  name  ?? (r.primary_name  || undefined),
        };
      }
    } catch { /* table may not exist */ }
  }

  return { phone, email, name };
}

// ── SMS adapter ───────────────────────────────────────────────────────────────

export async function sendInsuranceSms(opts: {
  workflowId:    number;
  callerAgencyId: number;
  subAccountId:  number;
  minScore?:     number;
}): Promise<TransportResult> {
  // ── GATE: assertApproved is the absolute first call ───────────────────────
  let wf: Record<string, unknown>;
  try {
    wf = await assertApproved({
      workflowId:      opts.workflowId,
      callerAgencyId:  opts.callerAgencyId,
      minScore:        opts.minScore,
    });
  } catch (err: any) {
    const code = err instanceof ApprovalGateError ? err.code : "UNKNOWN";
    await markFailed(opts.workflowId, `gate_blocked:${code}:${err.message}`);
    return { ok: false, channel: "sms", workflowId: opts.workflowId, error: err.message, gateCode: code };
  }

  // ── Resolve contact ───────────────────────────────────────────────────────
  const contact = await resolveContact(wf);
  if (!contact.phone) {
    const reason = "no_phone: no phone number available for this household";
    await markFailed(opts.workflowId, reason);
    return { ok: false, channel: "sms", workflowId: opts.workflowId, error: reason };
  }

  // ── Hydrate draft ─────────────────────────────────────────────────────────
  const td = (wf.trigger_data ?? {}) as Record<string, unknown>;
  const rawDraft = (wf.draft_content as string | undefined) ?? "";
  const body = rawDraft.trim()
    ? hydrateDraft(rawDraft, { ...td, primaryName: contact.name, phone: contact.phone })
    : `[Insurance opportunity — draft missing. Contact ${contact.phone}]`;

  const traceId = randomUUID();

  // ── Send via existing SMS infrastructure ──────────────────────────────────
  const result = await sendSms({
    subAccountId: opts.subAccountId,
    to:           contact.phone,
    body,
    source:       `insurance_workflow:${wf.workflow_type}:wf#${opts.workflowId}`,
    path:         "scoped-sms",   // closest MessagingPath to insurance outreach
    traceId,
    channel:      "insurance-sms",
    metadata:     {
      workflowId:   opts.workflowId,
      workflowType: wf.workflow_type,
      approvedBy:   wf.approved_by,
      householdId:  wf.household_id,
    },
  });

  if (!result.ok) {
    const reason = result.errorMessage ?? result.reason ?? "twilio_error";
    await markFailed(opts.workflowId, reason);
    await audit("INSURANCE_SMS_FAILED", `wf#${opts.workflowId}`, {
      workflowId: opts.workflowId, to: contact.phone, reason, traceId,
    });
    return { ok: false, channel: "sms", workflowId: opts.workflowId, error: reason };
  }

  await markExecuted(opts.workflowId, result.twilioSid, "sms");
  await audit("INSURANCE_WORKFLOW_EXECUTED", wf.approved_by as string ?? "system", {
    workflowId:   opts.workflowId,
    workflowType: wf.workflow_type,
    channel:      "sms",
    to:           contact.phone,
    twilioSid:    result.twilioSid,
    traceId,
  });

  console.log(`[INS-TRANSPORT] SMS sent wf#${opts.workflowId} → ${contact.phone} sid=${result.twilioSid}`);
  return { ok: true, channel: "sms", workflowId: opts.workflowId, messageSid: result.twilioSid };
}

// ── Email adapter ─────────────────────────────────────────────────────────────

export async function sendInsuranceEmail(opts: {
  workflowId:    number;
  callerAgencyId: number;
  subAccountId:  number;
  minScore?:     number;
}): Promise<TransportResult> {
  // ── GATE ──────────────────────────────────────────────────────────────────
  let wf: Record<string, unknown>;
  try {
    wf = await assertApproved({
      workflowId:      opts.workflowId,
      callerAgencyId:  opts.callerAgencyId,
      minScore:        opts.minScore,
    });
  } catch (err: any) {
    const code = err instanceof ApprovalGateError ? err.code : "UNKNOWN";
    await markFailed(opts.workflowId, `gate_blocked:${code}:${err.message}`);
    return { ok: false, channel: "email", workflowId: opts.workflowId, error: err.message, gateCode: code };
  }

  // ── Contact ───────────────────────────────────────────────────────────────
  const contact = await resolveContact(wf);
  if (!contact.email) {
    const reason = "no_email: no email address available for this household";
    await markFailed(opts.workflowId, reason);
    return { ok: false, channel: "email", workflowId: opts.workflowId, error: reason };
  }

  // ── Draft ─────────────────────────────────────────────────────────────────
  const td = (wf.trigger_data ?? {}) as Record<string, unknown>;
  const rawDraft = (wf.draft_content as string | undefined) ?? "";
  const body = rawDraft.trim()
    ? hydrateDraft(rawDraft, { ...td, primaryName: contact.name, email: contact.email })
    : `[Insurance opportunity draft — contact ${contact.email}]`;

  const workflowLabel = String(wf.workflow_type ?? "insurance").replace(/_/g, " ");
  const subject = (td.emailSubject as string | undefined)
    ?? `Insurance coverage update — ${workflowLabel}`;

  const traceId = randomUUID();

  // ── Send via existing email infrastructure ────────────────────────────────
  const result = await sendEmail({
    subAccountId: opts.subAccountId,
    to:           contact.email,
    subject,
    body,
    traceId,
  });

  if (!result.ok) {
    const reason = result.errorMessage ?? result.reason ?? "email_error";
    await markFailed(opts.workflowId, reason);
    await audit("INSURANCE_EMAIL_FAILED", `wf#${opts.workflowId}`, {
      workflowId: opts.workflowId, to: contact.email, reason, traceId,
    });
    return { ok: false, channel: "email", workflowId: opts.workflowId, error: reason };
  }

  await markExecuted(opts.workflowId, `email:${result.messageRowId}`, "email");
  await audit("INSURANCE_WORKFLOW_EXECUTED", wf.approved_by as string ?? "system", {
    workflowId:   opts.workflowId,
    workflowType: wf.workflow_type,
    channel:      "email",
    to:           contact.email,
    messageRowId: result.messageRowId,
    traceId,
  });

  console.log(`[INS-TRANSPORT] Email sent wf#${opts.workflowId} → ${contact.email}`);
  return { ok: true, channel: "email", workflowId: opts.workflowId };
}

// ── Voice adapter ─────────────────────────────────────────────────────────────
//
// Initiates a Twilio outbound call that reads the draft via TwiML <Say>.
// If the sub-account has no provisioned phone number, falls back to SMS
// rather than silently failing — and records the fallback in the audit log.

export async function sendInsuranceVoice(opts: {
  workflowId:    number;
  callerAgencyId: number;
  subAccountId:  number;
  baseUrl?:      string;
  minScore?:     number;
}): Promise<TransportResult> {
  // ── GATE ──────────────────────────────────────────────────────────────────
  let wf: Record<string, unknown>;
  try {
    wf = await assertApproved({
      workflowId:      opts.workflowId,
      callerAgencyId:  opts.callerAgencyId,
      minScore:        opts.minScore,
    });
  } catch (err: any) {
    const code = err instanceof ApprovalGateError ? err.code : "UNKNOWN";
    await markFailed(opts.workflowId, `gate_blocked:${code}:${err.message}`);
    return { ok: false, channel: "voice", workflowId: opts.workflowId, error: err.message, gateCode: code };
  }

  // ── Contact ───────────────────────────────────────────────────────────────
  const contact = await resolveContact(wf);
  if (!contact.phone) {
    const reason = "no_phone: no phone number available for voice call";
    await markFailed(opts.workflowId, reason);
    return { ok: false, channel: "voice", workflowId: opts.workflowId, error: reason };
  }

  // ── Twilio client ─────────────────────────────────────────────────────────
  const twilio = await getTwilioClientForAccount(opts.subAccountId);
  if (!twilio || !twilio.phoneNumber) {
    // Graceful fallback to SMS — still gate-approved
    console.warn(`[INS-TRANSPORT] No Twilio voice number for subAccount#${opts.subAccountId}, falling back to SMS`);
    await audit("INSURANCE_VOICE_FALLBACK_SMS", `wf#${opts.workflowId}`, {
      workflowId: opts.workflowId, subAccountId: opts.subAccountId, reason: "no_voice_number",
    });
    return sendInsuranceSms({ ...opts });
  }

  // ── Draft → TwiML ─────────────────────────────────────────────────────────
  const td = (wf.trigger_data ?? {}) as Record<string, unknown>;
  const rawDraft = (wf.draft_content as string | undefined) ?? "";
  const spokenText = rawDraft.trim()
    ? hydrateDraft(rawDraft, { ...td, primaryName: contact.name })
    : `Hello, this is a message regarding your insurance coverage. Please call us back at your convenience.`;

  // Escape XML special chars for TwiML
  const safeText = spokenText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${safeText}</Say><Pause length="1"/></Response>`;

  // ── Initiate call ─────────────────────────────────────────────────────────
  try {
    const call = await twilio.client.calls.create({
      to:   contact.phone,
      from: twilio.phoneNumber,
      twiml,
      statusCallback:       opts.baseUrl ? `${opts.baseUrl}/api/webhook/voice-status` : undefined,
      statusCallbackMethod: "POST",
    });

    await markExecuted(opts.workflowId, call.sid, "voice");
    await audit("INSURANCE_WORKFLOW_EXECUTED", wf.approved_by as string ?? "system", {
      workflowId:   opts.workflowId,
      workflowType: wf.workflow_type,
      channel:      "voice",
      to:           contact.phone,
      callSid:      call.sid,
    });

    console.log(`[INS-TRANSPORT] Voice call initiated wf#${opts.workflowId} → ${contact.phone} sid=${call.sid}`);
    return { ok: true, channel: "voice", workflowId: opts.workflowId, messageSid: call.sid };
  } catch (err: any) {
    const reason = err?.message ?? "twilio_voice_error";
    await markFailed(opts.workflowId, reason);
    await audit("INSURANCE_VOICE_FAILED", `wf#${opts.workflowId}`, {
      workflowId: opts.workflowId, to: contact.phone, reason,
    });
    return { ok: false, channel: "voice", workflowId: opts.workflowId, error: reason };
  }
}
