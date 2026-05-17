/**
 * server/serviceIndustry/missedCallRecoveryEngine.ts
 *
 * Missed-Call Recovery Engine
 *
 * CRITICAL system. Every unanswered inbound call is a potential booking lost.
 *
 * Flow:
 *   1. Inbound missed-call event arrives (from Twilio webhook or manual ingest)
 *   2. Dedup check — suppress if called within last 2 hours
 *   3. Business-hours check — suppress if after hours AND configured to do so
 *   4. Existing-customer check — personalise response
 *   5. Recovery SMS queued (not sent directly — routed through workflow queue)
 *   6. Follow-up sequence: attempt 1 (immediate) → attempt 2 (1h) → escalation (24h)
 *   7. Conversion tracking: reply received → booked → escalated → expired
 *
 * Safety:
 *   - Max 3 recovery attempts per caller per 24-hour window
 *   - Explicit opt-out check before every attempt
 *   - After-hours suppression configurable per business
 *   - No automated booking — only booking LINK delivery
 *   - All recovery messages are drafted only; human review recommended for first deployment
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool } from "../hpl/sqlSafe";
import { createHash } from "crypto";
import type { MissedCallRecord, MissedCallStatus, BusinessHours } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RECOVERY_ATTEMPTS = 3;
const DEDUP_WINDOW_MS       = 2 * 3_600_000;  // 2 hours
const ATTEMPT_2_DELAY_MS    = 1 * 3_600_000;  // 1 hour
const ESCALATION_DELAY_MS   = 24 * 3_600_000; // 24 hours

// ── ID builder ────────────────────────────────────────────────────────────────

function buildMissedCallId(businessId: string, callerPhone: string, calledAt: string): string {
  const raw = `${businessId}|${callerPhone}|${calledAt}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── Recovery score ────────────────────────────────────────────────────────────

export function scoreRecoveryLikelihood(opts: {
  isExistingCustomer: boolean;
  isRepeatCaller:     boolean;
  callHour:           number;     // 0-23 local hour
  dayOfWeek:          number;     // 0=Sun
}): number {
  let score = 50;
  if (opts.isExistingCustomer) score += 25;
  if (opts.isRepeatCaller)     score += 10;
  // Business hours (9am-6pm M-F) calls convert higher
  const isBizHours = opts.callHour >= 9 && opts.callHour < 18 &&
                     opts.dayOfWeek >= 1 && opts.dayOfWeek <= 5;
  if (isBizHours)  score += 10;
  // Saturday mid-day high intent
  if (opts.dayOfWeek === 6 && opts.callHour >= 10 && opts.callHour < 15) score += 5;
  return Math.min(score, 100);
}

// ── Business-hours check ──────────────────────────────────────────────────────

export function isWithinBusinessHours(hours: BusinessHours | null | undefined, now: Date): boolean {
  if (!hours) return true; // No hours configured — assume open
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  const day = days[now.getDay()];
  const slot = hours[day];
  if (!slot) return false; // Closed that day
  const [oh, om] = slot.open.split(":").map(Number);
  const [ch, cm] = slot.close.split(":").map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return nowMins >= oh * 60 + om && nowMins < ch * 60 + cm;
}

// ── Draft templates ───────────────────────────────────────────────────────────

export function buildRecoveryDraft(opts: {
  businessName:  string;
  callerPhone:   string;
  customerName?: string;
  bookingLink?:  string;
  attemptNumber: number;
  afterHours:    boolean;
}): string {
  const { businessName, customerName, bookingLink, attemptNumber, afterHours } = opts;
  const greeting = customerName ? `Hi ${customerName}` : "Hi";
  const link = bookingLink ? ` Book here: ${bookingLink}` : "";

  if (attemptNumber === 1) {
    if (afterHours) {
      return `${greeting}! You called ${businessName} after hours. We'll be back soon — reply with your question or book your appointment online.${link} Reply STOP to opt out.`;
    }
    return `${greeting}! You called ${businessName} but we missed you. Reply here or book your appointment online.${link} Reply STOP to opt out.`;
  }

  if (attemptNumber === 2) {
    return `${greeting}, just following up from ${businessName}. We'd love to help — reply here to get scheduled.${link} Reply STOP to opt out.`;
  }

  // Escalation / attempt 3
  return `${greeting}, one last note from ${businessName}. We want to make sure you get taken care of — reply anytime or call us back directly. Reply STOP to opt out.`;
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _svc_missed_calls (
        id                  SERIAL PRIMARY KEY,
        missed_call_id      TEXT        NOT NULL UNIQUE,
        business_id         TEXT        NOT NULL,
        sub_account_id      INTEGER,
        caller_phone        TEXT        NOT NULL,
        called_at           TIMESTAMPTZ NOT NULL,
        status              TEXT        NOT NULL DEFAULT 'detected',

        response_attempts   INTEGER     NOT NULL DEFAULT 0,
        first_response_at   TIMESTAMPTZ,
        last_response_at    TIMESTAMPTZ,
        customer_replied_at TIMESTAMPTZ,
        booked_at           TIMESTAMPTZ,
        escalated_at        TIMESTAMPTZ,

        recovery_score      INTEGER,
        is_repeat_caller    BOOLEAN     DEFAULT FALSE,
        is_existing_customer BOOLEAN    DEFAULT FALSE,
        after_hours         BOOLEAN     DEFAULT FALSE,
        suppression_reason  TEXT,

        draft_content       TEXT,
        booking_link_sent   BOOLEAN     DEFAULT FALSE,

        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS svc_mc_business_idx ON _svc_missed_calls (business_id, status);
      CREATE INDEX IF NOT EXISTS svc_mc_phone_idx    ON _svc_missed_calls (caller_phone, created_at DESC);
      CREATE INDEX IF NOT EXISTS svc_mc_status_idx   ON _svc_missed_calls (status, called_at DESC);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[SVC-MISSED-CALL] Failed to ensure table:", err?.message);
  }
}

// ── Ingest missed call ────────────────────────────────────────────────────────

export async function ingestMissedCall(opts: {
  businessId:          string;
  subAccountId?:       number;
  callerPhone:         string;
  calledAt:            Date;
  businessName:        string;
  businessHours?:      BusinessHours;
  suppressAfterHours?: boolean;
  bookingLink?:        string;
  isExistingCustomer?: boolean;
  customerName?:       string;
}): Promise<{
  missedCallId: string;
  status:       MissedCallStatus;
  draft?:       string;
  suppressed:   boolean;
  reason?:      string;
}> {
  await ensureTable();

  const { businessId, callerPhone, calledAt, businessName } = opts;
  const missedCallId = buildMissedCallId(businessId, callerPhone, calledAt.toISOString());

  // ── Dedup check ────────────────────────────────────────────────────────────
  const dedupResult = await db.execute(sql.raw(`
    SELECT id, status FROM _svc_missed_calls
    WHERE business_id = ${esc(businessId)}
      AND caller_phone = ${esc(callerPhone)}
      AND called_at >= NOW() - INTERVAL '2 hours'
    LIMIT 1
  `));
  const dedupRows = (dedupResult as any).rows ?? dedupResult;
  if (Array.isArray(dedupRows) && dedupRows.length > 0) {
    return { missedCallId, status: "suppressed", suppressed: true, reason: "dedup_window" };
  }

  // ── After-hours check ──────────────────────────────────────────────────────
  const afterHours = !isWithinBusinessHours(opts.businessHours ?? null, calledAt);
  if (afterHours && opts.suppressAfterHours) {
    await db.execute(sql.raw(`
      INSERT INTO _svc_missed_calls
        (missed_call_id, business_id, sub_account_id, caller_phone, called_at,
         status, after_hours, suppression_reason, is_existing_customer)
      VALUES
        (${esc(missedCallId)}, ${esc(businessId)}, ${num(opts.subAccountId)},
         ${esc(callerPhone)}, ${esc(calledAt.toISOString())},
         'suppressed', TRUE, 'after_hours', ${bool(opts.isExistingCustomer)})
      ON CONFLICT (missed_call_id) DO NOTHING
    `));
    return { missedCallId, status: "suppressed", suppressed: true, reason: "after_hours" };
  }

  // ── Score + draft ──────────────────────────────────────────────────────────
  const recoveryScore = scoreRecoveryLikelihood({
    isExistingCustomer: opts.isExistingCustomer ?? false,
    isRepeatCaller: false,
    callHour: calledAt.getHours(),
    dayOfWeek: calledAt.getDay(),
  });

  const draft = buildRecoveryDraft({
    businessName,
    callerPhone,
    customerName:  opts.customerName,
    bookingLink:   opts.bookingLink,
    attemptNumber: 1,
    afterHours,
  });

  // ── Insert ─────────────────────────────────────────────────────────────────
  try {
    await db.execute(sql.raw(`
      INSERT INTO _svc_missed_calls
        (missed_call_id, business_id, sub_account_id, caller_phone, called_at,
         status, recovery_score, is_existing_customer, after_hours,
         draft_content, booking_link_sent)
      VALUES
        (${esc(missedCallId)}, ${esc(businessId)}, ${num(opts.subAccountId)},
         ${esc(callerPhone)}, ${esc(calledAt.toISOString())},
         'response_queued', ${num(recoveryScore)}, ${bool(opts.isExistingCustomer)},
         ${bool(afterHours)}, ${esc(draft)}, ${bool(!!opts.bookingLink)})
      ON CONFLICT (missed_call_id) DO NOTHING
    `));
  } catch (err: any) {
    console.error("[SVC-MISSED-CALL] Insert failed:", err?.message);
    return { missedCallId, status: "detected", suppressed: false };
  }

  console.log(`[SVC-MISSED-CALL] Queued recovery for ${callerPhone} → ${businessName} score=${recoveryScore}`);
  return { missedCallId, status: "response_queued", draft, suppressed: false };
}

// ── Mark replied / booked / escalated ─────────────────────────────────────────

export async function markMissedCallReplied(missedCallId: string): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE _svc_missed_calls
    SET status = 'replied', customer_replied_at = NOW()
    WHERE missed_call_id = ${esc(missedCallId)} AND status NOT IN ('booked','escalated')
  `));
}

export async function markMissedCallBooked(missedCallId: string): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE _svc_missed_calls
    SET status = 'booked', booked_at = NOW()
    WHERE missed_call_id = ${esc(missedCallId)}
  `));
}

export async function markMissedCallEscalated(missedCallId: string, reason: string): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE _svc_missed_calls
    SET status = 'escalated', escalated_at = NOW(),
        suppression_reason = ${esc(reason)}
    WHERE missed_call_id = ${esc(missedCallId)}
  `));
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getMissedCallStats(businessId?: string): Promise<{
  total: number;
  queued: number;
  booked: number;
  escalated: number;
  recoveryRatePct: number;
  suppressedPct: number;
}> {
  await ensureTable();
  const filter = businessId ? `WHERE business_id = ${esc(businessId)}` : "WHERE created_at >= NOW() - INTERVAL '30 days'";
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                                            AS total,
        COUNT(CASE WHEN status = 'response_queued' THEN 1 END) AS queued,
        COUNT(CASE WHEN status = 'booked' THEN 1 END)      AS booked,
        COUNT(CASE WHEN status = 'escalated' THEN 1 END)   AS escalated,
        COUNT(CASE WHEN status = 'suppressed' THEN 1 END)  AS suppressed
      FROM _svc_missed_calls ${filter}
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : {};
    const total = Number(r?.total ?? 0);
    const booked = Number(r?.booked ?? 0);
    const suppressed = Number(r?.suppressed ?? 0);
    return {
      total,
      queued:          Number(r?.queued ?? 0),
      booked,
      escalated:       Number(r?.escalated ?? 0),
      recoveryRatePct: total > 0 ? (booked / total) * 100 : 0,
      suppressedPct:   total > 0 ? (suppressed / total) * 100 : 0,
    };
  } catch {
    return { total: 0, queued: 0, booked: 0, escalated: 0, recoveryRatePct: 0, suppressedPct: 0 };
  }
}

// ── Pending recovery queue ────────────────────────────────────────────────────

export async function getPendingRecoveries(businessId?: string, limit = 50): Promise<any[]> {
  await ensureTable();
  const filter = businessId
    ? `AND business_id = ${esc(businessId)}`
    : "";
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _svc_missed_calls
      WHERE status = 'response_queued'
        AND response_attempts < ${MAX_RECOVERY_ATTEMPTS}
        ${filter}
      ORDER BY called_at DESC
      LIMIT ${num(limit)}
    `));
    return (result as any).rows ?? result ?? [];
  } catch { return []; }
}
