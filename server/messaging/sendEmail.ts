import { randomUUID } from "crypto";
import sgMail from "@sendgrid/mail";
import { storage } from "../storage";

export type SendEmailFailureReason =
  | "not_configured"
  | "no_from_address"
  | "sendgrid_error"
  | "resend_error"
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

// ── Resend provider ───────────────────────────────────────────────────────────

function resolveResendApiKey(): string | undefined {
  return (
    process.env.RESEND_API_KEY ||
    process.env.RESEND_KEY ||
    process.env.EMAIL_RESEND_API_KEY ||
    undefined
  );
}

let _resendClient: any = null;
let resendInitialized = false;

async function getResendClient(): Promise<any> {
  if (_resendClient) return _resendClient;
  const { Resend } = await import("resend");
  const key = resolveResendApiKey()!;
  _resendClient = new Resend(key);
  resendInitialized = true;
  return _resendClient;
}

export function isResendConfigured(): boolean {
  return !!resolveResendApiKey();
}

// ── SendGrid provider ─────────────────────────────────────────────────────────

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
      error: "SendGrid API key is not set.",
    };
  }
  if (!sgInitialized) {
    sgMail.setApiKey(apiKey);
    sgInitialized = true;
    console.log("[EMAIL] SendGrid initialized");
  }
  return { ok: true };
}

// ── Boot log (call once at server startup) ────────────────────────────────────

export function logEmailProviderStartup(): void {
  const resendKey     = resolveResendApiKey();
  const sendgridKey   = resolveSendgridApiKey();

  console.log(`[EMAIL] RESEND_API_KEY present: ${!!resendKey}`);
  console.log(`[EMAIL] SENDGRID_API_KEY present: ${!!sendgridKey}`);

  if (resendKey) {
    const activeVar =
      process.env.RESEND_API_KEY       ? "RESEND_API_KEY" :
      process.env.RESEND_KEY           ? "RESEND_KEY" :
      "EMAIL_RESEND_API_KEY";
    console.log(`[EMAIL] Resend provider initialized (key: ${activeVar})`);
    console.log("[EMAIL] Active email provider: resend");
  } else {
    console.log("[EMAIL] Resend skipped because RESEND_API_KEY is missing");
    if (sendgridKey) {
      console.log("[EMAIL] Active email provider: sendgrid (fallback)");
    } else {
      console.warn("[EMAIL] ⚠️  No email provider configured — outbound email disabled");
      console.warn("[EMAIL]    Set RESEND_API_KEY, RESEND_KEY, or SENDGRID_API_KEY to enable email");
    }
  }
}

// ── Persist message row ───────────────────────────────────────────────────────

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

// ── From-address resolver ─────────────────────────────────────────────────────

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
  return (
    process.env.RESEND_FROM_EMAIL ||
    process.env.SENDGRID_FROM_EMAIL ||
    null
  );
}

// ── SendGrid sender verification (unchanged) ──────────────────────────────────

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

export async function getSenderVerificationStatus(email: string): Promise<SenderVerificationStatus> {
  const apiKey = resolveSendgridApiKey();
  if (!apiKey) return { state: "unknown", reason: "SendGrid is not configured on this server." };
  const target = email.trim().toLowerCase();
  if (!target) return { state: "not_found" };
  try {
    const PAGE_SIZE = 200;
    const MAX_PAGES = 5;
    let lastSeenId: number | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL("https://api.sendgrid.com/v3/verified_senders");
      url.searchParams.set("limit", String(PAGE_SIZE));
      if (lastSeenId !== undefined) url.searchParams.set("last_seen_id", String(lastSeenId));
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!res.ok) {
        const body = await res.text().catch((err) => { console.warn("[SENDEMAIL] verifiedSender body fetch failed:", err instanceof Error ? err.message : err); return ""; });
        return { state: "unknown", reason: `SendGrid returned ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}` };
      }
      const data = await res.json() as { results?: VerifiedSenderRow[] };
      const results = data.results || [];
      const match = results.find(r => (r.from_email || "").trim().toLowerCase() === target);
      if (match) {
        return match.verified
          ? { state: "verified", senderId: match.id }
          : { state: "pending", senderId: match.id };
      }
      if (results.length < PAGE_SIZE) return { state: "not_found" };
      lastSeenId = results[results.length - 1].id;
    }
    return { state: "unknown", reason: "SendGrid sender list exceeds 1000 entries; could not exhaustively search." };
  } catch (err) {
    return { state: "unknown", reason: err instanceof Error ? err.message : String(err) };
  }
}

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
    const body = await res.json().catch((err) => { console.warn("[SENDEMAIL] promise rejected:", err instanceof Error ? err.message : err); return null; }) as { id?: number; errors?: Array<{ message?: string }> } | null;
    if (!res.ok) {
      const message = body?.errors?.[0]?.message || `SendGrid returned ${res.status}`;
      return { ok: false, error: message };
    }
    return { ok: true, senderId: body?.id ?? 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Main send function — Resend primary, SendGrid fallback ────────────────────

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const { subAccountId, to, subject, body } = args;
  const traceId = args.traceId || randomUUID();

  const from = await resolveFromAddress(subAccountId, args.from);
  if (!from) {
    const errorMessage = "No sender email address configured. Set RESEND_FROM_EMAIL, SENDGRID_FROM_EMAIL, or configure fromEmail in account settings.";
    const rowId = await persistRow({ subAccountId, to, subject, body, status: "failed", traceId, errorMessage });
    return { ok: false, reason: "no_from_address", errorMessage, messageRowId: rowId };
  }

  // ── Try Resend first ────────────────────────────────────────────────────────
  if (isResendConfigured()) {
    try {
      const resend = await getResendClient();
      const result = await resend.emails.send({ from, to, subject, text: body });
      if (result.error) throw new Error(result.error.message || JSON.stringify(result.error));
      const rowId = await persistRow({ subAccountId, to, subject, body, status: "sent", messageSid: result.data?.id ?? null, traceId });
      return { ok: true, messageRowId: rowId };
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      console.warn(`[SEND-EMAIL] Resend failed (${errorMessage}), trying SendGrid fallback`);
      // Fall through to SendGrid
    }
  }

  // ── SendGrid fallback ───────────────────────────────────────────────────────
  const init = ensureSendgrid();
  if (!init.ok) {
    const rowId = await persistRow({ subAccountId, to, subject, body, status: "failed", traceId, errorMessage: init.error });
    return { ok: false, reason: init.reason, errorMessage: init.error, messageRowId: rowId };
  }

  try {
    const [response] = await sgMail.send({ to, from, subject, text: body });
    const messageSid = (response?.headers?.["x-message-id"] as string | undefined) || null;
    const rowId = await persistRow({ subAccountId, to, subject, body, status: "sent", messageSid, traceId });
    return { ok: true, messageRowId: rowId };
  } catch (err: any) {
    const errorMessage: string =
      err?.response?.body?.errors?.[0]?.message ||
      err?.message ||
      String(err);
    const rowId = await persistRow({ subAccountId, to, subject, body, status: "failed", traceId, errorMessage: `sendgrid: ${errorMessage}` });
    console.error("[SEND-EMAIL] sendgrid error:", errorMessage);
    return { ok: false, reason: "sendgrid_error", errorMessage, messageRowId: rowId };
  }
}
