import { emitUniversalEvent } from "../intelligence/eventEmitter";
import { db } from "../db";
import { subAccounts } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { getLaylaAccountId } from "../services/laylaAccountResolver";
import { createHash } from "crypto";

function redactId(value?: string): string {
  if (!value) return "-";
  const h = createHash("sha256").update(value).digest("hex").substring(0, 8);
  return `id_${h}`;
}

const PHONE_RE = /\+?\d[\d\s\-().]{8,}\d/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const LONG_QUOTED_RE = /(["'`])([^"'`]{15,})\1/g;
const AT_HANDLE_RE = /(^|\s)@[A-Za-z0-9_.]{2,}/g;

/**
 * Strip likely PII from an error/reason string before it reaches the [OBS]
 * log line or the universal_events row. Keeps shape, removes content.
 * Order matters: emails before phones (emails contain digits).
 */
export function sanitizeError(input: string | undefined, maxLen = 200): string | undefined {
  if (!input) return input;
  const truncated = input.length > maxLen ? input.substring(0, maxLen) : input;
  return truncated
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_RE, "[phone]")
    .replace(LONG_QUOTED_RE, (_, q) => `${q}[redacted]${q}`)
    .replace(AT_HANDLE_RE, (_, lead) => `${lead}[handle]`);
}

/**
 * Sentinel attached to an Error after we've already emitted an obs event for
 * it, so an outer catch doesn't double-emit. Use markErrorEmitted(err) before
 * rethrowing, and isErrorEmitted(err) before emitting in an outer catch.
 */
const OBS_EMITTED = Symbol.for("observability.emitted");
export function markErrorEmitted(err: unknown): void {
  if (err && typeof err === "object") {
    try { (err as any)[OBS_EMITTED] = true; } catch {}
  }
}
export function isErrorEmitted(err: unknown): boolean {
  return !!(err && typeof err === "object" && (err as any)[OBS_EMITTED] === true);
}

const APEX_PARENT_ACCOUNT_ID = 13;
let _laylaIds: Set<number> | null = null;

async function getLaylaIds(): Promise<Set<number>> {
  if (_laylaIds) return _laylaIds;
  try {
    const rows = await db
      .select({ id: subAccounts.id })
      .from(subAccounts)
      .where(and(
        eq(subAccounts.name, "Officer Layla"),
        eq(subAccounts.parentAccountId, APEX_PARENT_ACCOUNT_ID),
      ));
    _laylaIds = new Set(rows.map(r => r.id));
    if (_laylaIds.size === 0) {
      try { _laylaIds.add(await getLaylaAccountId()); } catch {}
    }
  } catch {
    try { _laylaIds = new Set([await getLaylaAccountId()]); } catch { _laylaIds = new Set(); }
  }
  return _laylaIds;
}

async function resolvePersona(subAccountId: number, override?: string): Promise<string> {
  if (override) return override;
  try {
    const ids = await getLaylaIds();
    return ids.has(subAccountId) ? "layla" : "business";
  } catch {
    return "unknown";
  }
}

export type MessagingPath =
  | "auto-reply"
  | "auto-reply-voice"
  | "catchup"
  | "reengage"
  | "inbound"
  | "hot-lead"
  | "keyword"
  | "sms"
  | "telegram"
  | "scoped-sms"
  | "twilio-fallback";

export type MessagingChannel =
  | "facebook"
  | "instagram"
  | "sms"
  | "telegram"
  | string;

export interface MessagingEventOpts {
  subAccountId: number;
  channel: MessagingChannel;
  path: MessagingPath;
  threadId?: string;
  userId?: string;
  persona?: string;
  reason: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

function logLine(eventType: string, p: MessagingEventOpts, persona: string, sanitizedErr?: string): void {
  const errSuffix = sanitizedErr ? ` err="${sanitizedErr}"` : "";
  // PII protection: never log raw thread/user IDs — they embed sender IDs/PSIDs.
  // Errors are sanitized of phone numbers, emails, @handles, and long quoted
  // strings before logging or persisting. IDs are sha256-hashed in logs.
  // Full opaque IDs (Meta PSIDs are non-PII internal identifiers) are still
  // persisted to universal_events.metadata for ops correlation.
  console.log(
    `[OBS] ${eventType} subAccount=${p.subAccountId} persona=${persona} ` +
    `channel=${p.channel} path=${p.path} thread=${redactId(p.threadId)} ` +
    `user=${redactId(p.userId)} reason=${p.reason}${errSuffix}`,
  );
}

function sanitizeValue(v: unknown): unknown {
  if (typeof v === "string") return sanitizeError(v, 500);
  if (Array.isArray(v)) return v.map(sanitizeValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
      out[k] = sanitizeValue(vv);
    }
    return out;
  }
  return v;
}
function sanitizeMetadata(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return meta;
  return sanitizeValue(meta) as Record<string, unknown>;
}

async function emit(eventType: string, p: MessagingEventOpts): Promise<void> {
  const persona = await resolvePersona(p.subAccountId, p.persona);
  const sanitizedErr = sanitizeError(p.errorMessage);
  logLine(eventType, p, persona, sanitizedErr);
  try {
    emitUniversalEvent({
      eventType,
      sourceModule: "messaging",
      subAccountId: p.subAccountId,
      metadata: {
        persona,
        channel: p.channel,
        path: p.path,
        threadId: p.threadId,
        userId: p.userId,
        reason: p.reason,
        errorMessage: sanitizedErr,
        ts: new Date().toISOString(),
        ...(sanitizeMetadata(p.metadata) ?? {}),
      },
    });
  } catch (err) {
    console.error(`[OBS] Failed to emitUniversalEvent for ${eventType}:`, (err as Error).message);
  }
}

export function emitAiFailed(p: MessagingEventOpts): void {
  void emit("ai.failed", p);
}

export function emitMessageFailed(p: MessagingEventOpts): void {
  void emit("message.failed", p);
}

export function emitMessageSuppressedJustReplied(p: MessagingEventOpts): void {
  void emit("message.suppressed_just_replied", p);
}
