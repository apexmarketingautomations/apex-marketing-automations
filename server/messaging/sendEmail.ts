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

function resolveSendgridApiKey(): string | undefined {
  return (
    process.env.SENDGRID_API_KEY ||
    process.env.sendgrid_api ||
    process.env.SENDGRID_API ||
    process.env.SendGrid_API_Key
  );
}

let sgInitialized = false;
function ensureSendgrid(): { ok: true } | { ok: false; reason: SendEmailFailureReason; error: string } {
  const apiKey = resolveSendgridApiKey();
  if (!apiKey) {
    return {
      ok: false,
      reason: "not_configured",
      error: "SendGrid API key is not set. Add SENDGRID_API_KEY (or sendgrid_api) as a Replit secret to enable the email channel.",
    };
  }
  if (!sgInitialized) {
    sgMail.setApiKey(apiKey);
    sgInitialized = true;
    console.log("[SENDGRID] Email channel initialized");
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
 * Resolve the sender address with this precedence:
 *   1. Explicit per-call override.
 *   2. The sub-account's own configured fromEmail (set in account settings).
 *      This MUST be a sender that has been verified inside SendGrid for the
 *      account, otherwise SendGrid will reject the send.
 *   3. The platform-level SENDGRID_FROM_EMAIL fallback.
 */
async function resolveFromAddress(subAccountId: number, override?: string): Promise<string | null> {
  if (override) return override;
  try {
    const account = await storage.getSubAccount(subAccountId);
    const accountFrom = account?.fromEmail?.trim();
    if (accountFrom) return accountFrom;
  } catch (err) {
    console.warn(
      "[SEND-EMAIL] failed to load sub-account for from-address resolution; falling back to platform sender:",
      err instanceof Error ? err.message : err,
    );
  }
  return process.env.SENDGRID_FROM_EMAIL || null;
}

export type SenderVerificationStatus =
  | { state: "verified"; senderId: number }
  | { state: "pending"; senderId: number }
  | { state: "not_found" }
  | { state: "unknown"; reason: string };

interface VerifiedSenderRow {
  id: number;
  from_email: string;
  verified: boolean;
}

/**
 * Look up an email in SendGrid's Single Sender list to tell the operator
 * whether it has actually been verified. Returns "unknown" when SendGrid
 * itself is unreachable or unconfigured so the UI can show a soft warning
 * instead of a confident green check.
 */
export async function getSenderVerificationStatus(email: string): Promise<SenderVerificationStatus> {
  const apiKey = resolveSendgridApiKey();
  if (!apiKey) return { state: "unknown", reason: "SendGrid is not configured on this server." };
  const target = email.trim().toLowerCase();
  if (!target) return { state: "not_found" };
  try {
    const res = await fetch("https://api.sendgrid.com/v3/verified_senders?limit=500", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { state: "unknown", reason: `SendGrid returned ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}` };
    }
    const data = await res.json() as { results?: VerifiedSenderRow[] };
    const match = (data.results || []).find(r => (r.from_email || "").trim().toLowerCase() === target);
    if (!match) return { state: "not_found" };
    return match.verified
      ? { state: "verified", senderId: match.id }
      : { state: "pending", senderId: match.id };
  } catch (err) {
    return { state: "unknown", reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Kick off SendGrid's Single Sender Verification flow for the given email.
 * SendGrid will email a confirmation link to from_email; the operator must
 * click it for the sender to flip to verified.
 *
 * SendGrid requires a postal address on the sender record. We don't store
 * one per sub-account, so we send the business name and reasonable
 * placeholders — the operator can refine the record later in the SendGrid
 * dashboard. SendGrid does not actually validate the postal address.
 */
export async function requestSenderVerification(opts: {
  email: string;
  fromName?: string;
  nickname?: string;
}): Promise<{ ok: true; senderId: number } | { ok: false; error: string }> {
  const apiKey = resolveSendgridApiKey();
  if (!apiKey) return { ok: false, error: "SendGrid is not configured on this server." };
  const email = opts.email.trim();
  if (!email) return { ok: false, error: "Email is required." };

  const fromName = (opts.fromName || email.split("@")[0] || "Sender").slice(0, 60);
  const nickname = (opts.nickname || `${fromName} (${email})`).slice(0, 100);

  try {
    const res = await fetch("https://api.sendgrid.com/v3/verified_senders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nickname,
        from_email: email,
        from_name: fromName,
        reply_to: email,
        reply_to_name: fromName,
        address: "1 Market Street",
        address_2: "",
        city: "San Francisco",
        state: "CA",
        zip: "94105",
        country: "United States",
      }),
    });
    const body = await res.json().catch(() => null) as { id?: number; errors?: Array<{ message?: string }> } | null;
    if (!res.ok) {
      const message = body?.errors?.[0]?.message || `SendGrid returned ${res.status}`;
      return { ok: false, error: message };
    }
    return { ok: true, senderId: body?.id ?? 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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
