import { randomUUID } from "crypto";
import { storage } from "../storage";
import { getTwilioClientForAccount } from "../twilioClientFactory";
import { enforceSmsProvider } from "../smsGatewayGuard";
import { emitMessageFailed, type MessagingPath } from "../observability/messagingEvents";

export type SendSmsFailureReason =
  | "guard_violation"
  | "no_client"
  | "no_from_number"
  | "twilio_error"
  | "row_write_failed";

export interface SendSmsArgs {
  subAccountId: number;
  to: string;
  body: string;
  source: string;
  path: MessagingPath;
  from?: string;
  threadId?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export interface SendSmsResult {
  ok: boolean;
  messageRowId?: number;
  twilioSid?: string;
  errorMessage?: string;
  errorCode?: string | number;
  errorStatus?: number;
  reason?: SendSmsFailureReason;
}

function structuredLog(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...data }));
}

async function persistRow(opts: {
  subAccountId: number;
  to: string;
  body: string;
  status: "sent" | "failed";
  messageSid?: string | null;
  threadId?: string | null;
  traceId: string;
  errorMessage?: string | null;
}): Promise<number | undefined> {
  try {
    const row = await storage.createMessage({
      subAccountId: opts.subAccountId,
      contactPhone: opts.to,
      body: opts.body,
      direction: "outbound",
      channel: "sms",
      status: opts.status,
      messageSid: opts.messageSid ?? null,
      threadId: opts.threadId ?? null,
      traceId: opts.traceId,
      errorMessage: opts.errorMessage ?? null,
    });
    return row.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    structuredLog("send_sms_row_persist_failed", {
      sub_account_id: opts.subAccountId,
      status: opts.status,
      error: msg,
    });
    return undefined;
  }
}

/**
 * Centralized outbound SMS wrapper. Every outbound SMS in the system MUST
 * route through here so that:
 *   1. Provider guard is enforced (Twilio-only).
 *   2. A messages row is written for BOTH success and failure.
 *   3. messages.error_message is populated on failure.
 *   4. message.failed is emitted to universal_events on failure.
 *   5. Callers receive a typed SendSmsResult instead of a thrown Error,
 *      eliminating silent console.error-only catch blocks.
 *
 * No retry is performed — that is the responsibility of an upstream queue
 * (sms_retry_queue exists for that purpose; not used here yet).
 */
export async function sendSms(args: SendSmsArgs): Promise<SendSmsResult> {
  const { subAccountId, to, body, source, path, threadId } = args;
  const traceId = args.traceId || randomUUID();

  // 1. Provider guard — throws SmsProviderViolationError if non-Twilio.
  try {
    await enforceSmsProvider("sms", "twilio", { subAccountId, phone: to, source });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const rowId = await persistRow({
      subAccountId, to, body, status: "failed", threadId, traceId,
      errorMessage: `guard_violation: ${msg}`,
    });
    emitMessageFailed({
      subAccountId, channel: "sms", path, threadId,
      reason: "sms_guard_violation",
      errorMessage: msg,
      metadata: { source, ...(args.metadata || {}) },
    });
    return { ok: false, reason: "guard_violation", errorMessage: msg, messageRowId: rowId };
  }

  // 2. Resolve Twilio client for this sub-account (scoped or master fallback).
  const clientResult = await getTwilioClientForAccount(subAccountId);
  if (!clientResult) {
    const reason = "twilio_not_configured";
    const rowId = await persistRow({
      subAccountId, to, body, status: "failed", threadId, traceId,
      errorMessage: reason,
    });
    emitMessageFailed({
      subAccountId, channel: "sms", path, threadId,
      reason,
      metadata: { source, ...(args.metadata || {}) },
    });
    return { ok: false, reason: "no_client", errorMessage: reason, messageRowId: rowId };
  }

  const fromNumber = args.from || clientResult.phoneNumber;
  if (!fromNumber) {
    const reason = "no_from_number";
    const rowId = await persistRow({
      subAccountId, to, body, status: "failed", threadId, traceId,
      errorMessage: reason,
    });
    emitMessageFailed({
      subAccountId, channel: "sms", path, threadId,
      reason,
      metadata: { source, ...(args.metadata || {}) },
    });
    return { ok: false, reason: "no_from_number", errorMessage: reason, messageRowId: rowId };
  }

  // 3. Send via Twilio.
  try {
    const msg = await clientResult.client.messages.create({ to, from: fromNumber, body });
    const rowId = await persistRow({
      subAccountId, to, body, status: "sent",
      messageSid: msg.sid, threadId, traceId,
    });
    return { ok: true, messageRowId: rowId, twilioSid: msg.sid };
  } catch (err: any) {
    const errorMessage: string = err?.message || String(err);
    const errorCode = err?.code;
    const errorStatus: number | undefined = typeof err?.status === "number" ? err.status : undefined;
    const persistedErr = `twilio:${errorStatus ?? "?"}:${errorCode ?? "?"}: ${errorMessage}`;
    const rowId = await persistRow({
      subAccountId, to, body, status: "failed", threadId, traceId,
      errorMessage: persistedErr,
    });
    emitMessageFailed({
      subAccountId, channel: "sms", path, threadId,
      reason: errorStatus ? `twilio_${errorStatus}` : "twilio_error",
      errorMessage,
      metadata: {
        source,
        twilio_code: errorCode ?? null,
        twilio_status: errorStatus ?? null,
        ...(args.metadata || {}),
      },
    });
    structuredLog("send_sms_failed", {
      sub_account_id: subAccountId,
      source,
      to_last4: to.slice(-4),
      twilio_status: errorStatus ?? null,
      twilio_code: errorCode ?? null,
      error: errorMessage,
      message_row_id: rowId ?? null,
    });
    return {
      ok: false,
      reason: "twilio_error",
      errorMessage,
      errorCode,
      errorStatus,
      messageRowId: rowId,
    };
  }
}
