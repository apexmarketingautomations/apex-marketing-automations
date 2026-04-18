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
  | "catchup"
  | "reengage"
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

function logLine(eventType: string, p: MessagingEventOpts, persona: string): void {
  const errSuffix = p.errorMessage ? ` err="${p.errorMessage.substring(0, 200)}"` : "";
  // PII protection: never log raw thread/user IDs — they embed sender IDs.
  // Hashed prefix is enough to correlate events while keeping logs PII-clean.
  // Full IDs are still persisted to universal_events.metadata for ops queries.
  console.log(
    `[OBS] ${eventType} subAccount=${p.subAccountId} persona=${persona} ` +
    `channel=${p.channel} path=${p.path} thread=${redactId(p.threadId)} ` +
    `user=${redactId(p.userId)} reason=${p.reason}${errSuffix}`,
  );
}

async function emit(eventType: string, p: MessagingEventOpts): Promise<void> {
  const persona = await resolvePersona(p.subAccountId, p.persona);
  logLine(eventType, p, persona);
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
        errorMessage: p.errorMessage,
        ts: new Date().toISOString(),
        ...(p.metadata ?? {}),
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
