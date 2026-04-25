// outcomeTracker.ts — Phase 6
//
// Closes the feedback loop: when an engagement / conversion event is
// recorded, we look back at which intelligence signals were active for the
// visit at that moment and emit one of two new universal events:
//
//   tracking.conversion         — for conversion-grade event types
//                                 (lead_submit, booked_call, qualified_lead,
//                                  closed_sale, save_contact)
//   tracking.engagement_result  — for non-conversion engagement
//                                 (cta_click, click_phone, click_email,
//                                  click_link, form_start, form_submit)
//
// The payload always carries `signalsActive: string[]` so any downstream
// analytics surface can attribute outcomes back to the signals that
// preceded them. We do NOT modify the intelligence pipeline, the snapshot
// builder, the tracking events table, or the schema. universal_events is
// the only write target — it is already the source of truth for the rest
// of Phases 3–5.
//
// Strict guarantees:
//  - Fire-and-forget at the call site. A failure here can never block or
//    poison the underlying tracking event.
//  - Test traffic is filtered out (caller's responsibility — recordEvent
//    already does this for the universal_events mirror, and we mirror that
//    contract).
//  - Idempotent per source event: sourceRecordId is set to the originating
//    tracking event's id with a stable suffix, so universal_events
//    consumers can dedupe naturally if the outcome ever fires twice for
//    the same trigger.

import { sql } from "drizzle-orm";
import { db } from "../db";
import { emitUniversalEvent } from "../intelligence/eventEmitter";
import { getCardSnapshot } from "./trackingSnapshots";

// Event types that count as a "conversion outcome". These match the
// trusted-only CONVERSION_EVENT_TYPES in routes/tracking.ts — a successful
// outcome must come through a trusted/server channel or via attribution
// token, so this set is the same.
const CONVERSION_OUTCOME_TYPES = new Set<string>([
  "lead_submit",
  "booked_call",
  "qualified_lead",
  "closed_sale",
]);

// Event types that count as engagement (positive signal but not a
// conversion). page_view / tap / qr_scan are intentionally excluded —
// those are the *input* to the intelligence pipeline, not an outcome.
// The set is intentionally a strict subset of TRACKING_EVENT_TYPES.
const ENGAGEMENT_OUTCOME_TYPES = new Set<string>([
  "cta_click",
  "form_start",
  "form_submit",
]);

export interface RecordOutcomeInput {
  eventId: string;             // originating tracking_events.event_id
  eventType: string;           // raw event type, no "tracking." prefix
  visitId: string | null;
  contactId: number | null;
  cardId: number | null;
  subAccountId: number | null;
  sessionId: string | null;
  // Visit-level intent flag, if the caller already has it loaded. Saves
  // an extra SELECT.
  visitIsHighIntent?: boolean | null;
}

export interface OutcomeResult {
  emitted: boolean;
  outcomeType: "conversion" | "engagement_result" | null;
  signalsActive: string[];
}

// Decides which outcome (if any) the given event should produce.
function classifyOutcome(eventType: string):
  | "conversion"
  | "engagement_result"
  | null {
  if (CONVERSION_OUTCOME_TYPES.has(eventType)) return "conversion";
  if (ENGAGEMENT_OUTCOME_TYPES.has(eventType)) return "engagement_result";
  return null;
}

export async function recordOutcome(
  input: RecordOutcomeInput,
): Promise<OutcomeResult> {
  const outcomeType = classifyOutcome(input.eventType);
  if (!outcomeType) {
    return { emitted: false, outcomeType: null, signalsActive: [] };
  }

  // We only attribute when we have a visit anchor. Without it, there's
  // nothing to link signals back to.
  if (!input.visitId) {
    return { emitted: false, outcomeType, signalsActive: [] };
  }

  const signalsActive: string[] = [];
  let highIntentAt: string | null = null;

  // (1) high_intent — prefer the in-memory flag, fall back to a single
  // SELECT EXISTS on universal_events for the timestamp linkage.
  if (input.visitIsHighIntent === true) {
    signalsActive.push("high_intent");
  }

  // (2) followup_queued — Phase 5 emits this exactly once per visit.
  // (3) high_intent timestamp — also from universal_events so we can
  // compute msSinceHighIntent for the conversion payload. Both are read
  // in one round-trip.
  try {
    const rows = await db.execute<{
      had_high_intent: boolean;
      high_intent_at: string | null;
      had_followup: boolean;
    }>(sql`
      SELECT
        EXISTS (
          SELECT 1 FROM universal_events
          WHERE event_type = 'tracking.high_intent'
            AND metadata->>'visitId' = ${input.visitId}
        ) AS had_high_intent,
        (
          SELECT MIN(occurred_at)::text FROM universal_events
          WHERE event_type = 'tracking.high_intent'
            AND metadata->>'visitId' = ${input.visitId}
        ) AS high_intent_at,
        EXISTS (
          SELECT 1 FROM universal_events
          WHERE event_type = 'tracking.followup_queued'
            AND source_record_id = ${input.visitId}
        ) AS had_followup
    `);
    const r = (rows as any).rows?.[0];
    if (r) {
      if (r.had_high_intent && !signalsActive.includes("high_intent")) {
        signalsActive.push("high_intent");
      }
      if (r.had_followup) signalsActive.push("followup_queued");
      highIntentAt = r.high_intent_at ?? null;
    }
  } catch (e) {
    console.warn("[outcomeTracker] signal lookup failed", input.visitId, e);
  }

  // (4) repeat_engagement + peak_hours — derived from the same sources
  // the dashboard uses, but computed cheaply here. The snapshot row gives
  // us repeat ratio directly (matches dashboard rule:
  // insightCodes.has('repeat_engagement') || repeatRate > 0.25).
  // peak_hours uses a small TTL-cached SQL query for the card's top hours
  // so this stays cheap when called per-event.
  if (input.cardId) {
    try {
      const snapshot = await getCardSnapshot(input.cardId);
      if (snapshot && snapshot.uniqueVisitors > 0) {
        const repeatRate = snapshot.repeatVisitors / snapshot.uniqueVisitors;
        if (repeatRate > 0.25) signalsActive.push("repeat_engagement");
      }
    } catch (err) {
      console.warn("[OUTCOMETRACKER] caught:", err instanceof Error ? err.message : err);
      /* snapshot miss is non-fatal */
    }

    const peakHours = await getPeakHours(input.cardId);
    if (peakHours.length > 0) {
      const currentHour = new Date().getUTCHours();
      if (peakHours.includes(currentHour)) signalsActive.push("peak_hours");
    }
  }

  // Compute time-to-outcome from the high_intent moment if we have one.
  // Useful to measure: "of high-intent visits, how fast did they convert?"
  let msSinceHighIntent: number | null = null;
  if (highIntentAt) {
    const t = Date.parse(highIntentAt);
    if (!Number.isNaN(t)) msSinceHighIntent = Date.now() - t;
  }

  const universalEventType =
    outcomeType === "conversion"
      ? "tracking.conversion"
      : "tracking.engagement_result";

  // Stable per-trigger id so re-fires would dedupe naturally on the
  // consumer side if anyone keys off source_record_id.
  const outcomeRecordId = `${input.eventId}:${outcomeType}`;

  try {
    emitUniversalEvent({
      eventType: universalEventType,
      sourceModule: "tracking",
      moduleSource: "tracking",
      entityType: "tracking_event",
      entityId: input.eventId,
      sourceTable: "tracking_events",
      sourceRecordId: outcomeRecordId,
      subAccountId: input.subAccountId ?? undefined,
      contactId: input.contactId ?? undefined,
      cardId: input.cardId ?? undefined,
      anonymousSessionId: input.sessionId ?? undefined,
      metadata: {
        visitId: input.visitId,
        triggerEventId: input.eventId,
        triggerEventType: input.eventType,
        outcomeType,
        outcomeKind:
          outcomeType === "conversion" ? input.eventType : "engagement",
        signalsActive,
        signalCount: signalsActive.length,
        attributedToIntelligence: signalsActive.length > 0,
        msSinceHighIntent,
        highIntentAt,
      },
    });
  } catch (e) {
    console.warn("[outcomeTracker] emit failed", outcomeRecordId, e);
    return { emitted: false, outcomeType, signalsActive };
  }

  return { emitted: true, outcomeType, signalsActive };
}

// Exposed for tests / dashboards that want to ask "is this an outcome
// event?" without re-importing the constants.
export function isOutcomeEvent(eventType: string): boolean {
  return classifyOutcome(eventType) !== null;
}

// --- peak-hour cache ---------------------------------------------------
// Per-card top hours for a card, computed by the same rule as the
// dashboard's loadBehavior(): hours with >= 2 events. Cached for 5 min so
// per-event recordOutcome calls don't run a fresh aggregate every time.
const PEAK_TTL_MS = 5 * 60_000;
const peakCache = new Map<number, { peakHours: number[]; expiresAt: number }>();

async function getPeakHours(cardId: number): Promise<number[]> {
  const now = Date.now();
  const hit = peakCache.get(cardId);
  if (hit && hit.expiresAt > now) return hit.peakHours;
  try {
    // Mirrors loadBehavior() in routes/intelligence.ts exactly so the
    // peak_hours signal we attribute matches the dashboard's peak_hours
    // surface — same column (occurred_at), same LIMIT (2), same >=2
    // event filter applied below.
    const rows = await db.execute<{ hour: number; n: number }>(sql`
      SELECT EXTRACT(HOUR FROM occurred_at)::int AS hour, COUNT(*)::int AS n
      FROM tracking_events
      WHERE card_id = ${cardId} AND is_test = false
      GROUP BY hour ORDER BY n DESC LIMIT 2
    `);
    const peakHours = ((rows as any).rows ?? [])
      .filter((r: any) => Number(r.n) >= 2)
      .map((r: any) => Number(r.hour));
    peakCache.set(cardId, { peakHours, expiresAt: now + PEAK_TTL_MS });
    return peakHours;
  } catch (err) {
    console.warn("[OUTCOMETRACKER] caught:", err instanceof Error ? err.message : err);
    return [];
  }
}
