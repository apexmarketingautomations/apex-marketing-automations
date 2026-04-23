import { randomUUID } from "crypto";
import sgMail from "@sendgrid/mail";
import { storage } from "../storage";

export type SendEmailFailureReason =
  | "not_configured"
  | "no_from_address"
  | "sendgrid_error"
  | "row_write_failed";

export interface SendEmailArgs {
  subAccountId: number;
  to: string;
  subject: string;
  body: string;
  from?: string;
  traceId?: string;
}

export interface SendEmailResult {
  ok: boolean;
  messageRowId?: number;
  errorMessage?: string;
  reason?: SendEmailFailureReason;
}

let sgInitialized = false;
function ensureSendgrid(): { ok: true } | { ok: false; reason: SendEmailFailureReason; error: string } {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      reason: "not_configured",
      error: "SENDGRID_API_KEY is not set. Add it as a Replit secret to enable the email channel.",
    };
  }
  if (!sgInitialized) {
    sgMail.setApiKey(apiKey);
    sgInitialized = true;
  }
  return { ok: true };
}

async function persistRow(opts: {
  subAccountId: number;
  to: string;
  subject: string;
  body: string;
  status: "sent" | "failed";
  messageSid?: string | null;
  traceId: string;
  errorMessage?: string | null;
}): Promise<number | undefined> {
  try {
    const row = await storage.createMessage({
      subAccountId: opts.subAccountId,
      contactPhone: opts.to,
      body: `${opts.subject}\n\n${opts.body}`,
      direction: "outbound",
      channel: "email",
      status: opts.status,
      messageSid: opts.messageSid ?? null,
      threadId: `${opts.subAccountId}::${opts.to}::email`,
      traceId: opts.traceId,
      errorMessage: opts.errorMessage ?? null,
    });
    return row.id;
  } catch (err) {
    console.error("[SEND-EMAIL] row persist failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

/**
 * Resolve the sender address. Currently uses the platform-level
 * SENDGRID_FROM_EMAIL env var. The sub_accounts table has no dedicated
 * email field, so per-account sender addresses are out of scope for
 * this task; document SENDGRID_FROM_EMAIL as the required platform sender.
 */
async function resolveFromAddress(subAccountId: number, override?: string): Promise<string | null> {
  if (override) return override;
  return process.env.SENDGRID_FROM_EMAIL || null;
}

/**
 * Centralized outbound email wrapper. Mirrors sendSms in behavior:
 *  - Writes a messages row for both success and failure.
 *  - Populates messages.error_message on failure.
 *  - Returns a typed result instead of throwing.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const { subAccountId, to, subject, body } = args;
  const traceId = args.traceId || randomUUID();

  const init = ensureSendgrid();
  if (!init.ok) {
    const rowId = await persistRow({
      subAccountId, to, subject, body, status: "failed", traceId,
      errorMessage: init.error,
    });
    return { ok: false, reason: init.reason, errorMessage: init.error, messageRowId: rowId };
  }

  const from = await resolveFromAddress(subAccountId, args.from);
  if (!from) {
    const errorMessage = "No sender email address configured. Set SENDGRID_FROM_EMAIL (a verified SendGrid sender) or pass `from` explicitly.";
    const rowId = await persistRow({
      subAccountId, to, subject, body, status: "failed", traceId, errorMessage,
    });
    return { ok: false, reason: "no_from_address", errorMessage, messageRowId: rowId };
  }

  try {
    const [response] = await sgMail.send({
      to,
      from,
      subject,
      text: body,
    });
    const messageSid = (response?.headers?.["x-message-id"] as string | undefined) || null;
    const rowId = await persistRow({
      subAccountId, to, subject, body, status: "sent", messageSid, traceId,
    });
    return { ok: true, messageRowId: rowId };
  } catch (err: any) {
    const errorMessage: string =
      err?.response?.body?.errors?.[0]?.message ||
      err?.message ||
      String(err);
    const persistedErr = `sendgrid: ${errorMessage}`;
    const rowId = await persistRow({
      subAccountId, to, subject, body, status: "failed", traceId, errorMessage: persistedErr,
    });
    console.error("[SEND-EMAIL] sendgrid error:", errorMessage);
    return { ok: false, reason: "sendgrid_error", errorMessage, messageRowId: rowId };
  }
}
