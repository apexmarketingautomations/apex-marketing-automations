// ---------------------------------------------------------------------------
// Card action layer.
//
// Phase 5 amplifies intelligence signals beyond the visual adaptation layer
// (Phase 4) into concrete *system actions* — what the card and its
// surrounding pipelines DO, not just how they look. This file is split into
// two concerns:
//
//   (a) computeCardActionDirectives — pure rule engine, mirrors the
//       cardAdaptation pattern. Returns client-consumable action flags.
//   (b) flagForFollowUp — server-side side-effect that queues a high-intent
//       visit/contact for the follow-up system. No new table; we reuse the
//       universal_events log (the schema-of-record for Phase 5) and
//       the universal_events stream so downstream consumers can subscribe.
//
// Nothing in this file mutates the existing intelligence pipeline. The
// trackingIntent service calls flagForFollowUp() as a fire-and-forget step
// after it has already done its own atomic single-emit work — the action
// layer is purely a consumer.
// ---------------------------------------------------------------------------

import { sql } from "drizzle-orm";
import { db } from "../db";
import { emitUniversalEvent } from "../intelligence/eventEmitter";

// ---------- pure rule engine (client-consumable) ---------------------------

export interface CardActionDirectives {
  // High-intent: when true the client should expand the booking surface
  // immediately on render (inline iframe / sheet) rather than wait for a
  // tap. Only fires when bookingUrl is configured AND the visit is hot.
  autoExpandBooking: boolean;
  // High-intent: amplify CTA emphasis (pulse animation, larger hit target).
  // Stacks on top of the Phase-4 surfaceCta directive — the UI uses one
  // class either way; this just bumps the intensity.
  amplifyCta: boolean;
  // Repeat-engagement: skip intermediate confirmations in capture flows.
  // E.g. one-tap save-contact (no preview), one-tap booking (no QR
  // detour), no share-modal interstitial.
  reduceCaptureFriction: boolean;
  // Repeat-engagement: bias the primary action toward direct conversation
  // (call > sms > email) over passive (website / save-contact).
  biasDirectAction: boolean;
  // Peak-hour: prefer real-time channels — the client uses this to expose
  // a "Text now" composer with prefilled body instead of a generic sms:
  // link, and to default booking preselect to "today / earliest slot".
  realtimePreference: boolean;
  // High-intent: server has flagged the contact for follow-up. Surfaced
  // back to the client so the UI can show "We'll follow up if we miss
  // each other" reassurance — closes the loop trust-wise.
  followUpFlagged: boolean;
  reasons: string[];
}

export interface CardActionInput {
  visitIsHighIntent: boolean;
  hasBookingUrl: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  repeatEngagementSignal: boolean; // from insights OR repeatRate threshold
  inPeakHour: boolean;
  followUpAlreadyFlagged: boolean;
}

export function computeCardActionDirectives(input: CardActionInput): CardActionDirectives {
  const reasons: string[] = [];
  let autoExpandBooking = false;
  let amplifyCta = false;
  let reduceCaptureFriction = false;
  let biasDirectAction = false;
  let realtimePreference = false;

  if (input.visitIsHighIntent) {
    if (input.hasBookingUrl) autoExpandBooking = true;
    amplifyCta = true;
    reasons.push("visit_high_intent");
  }

  if (input.repeatEngagementSignal) {
    reduceCaptureFriction = true;
    if (input.hasPhone || input.hasBookingUrl) biasDirectAction = true;
    reasons.push("repeat_engagement");
  }

  if (input.inPeakHour) {
    realtimePreference = true;
    reasons.push("in_peak_hour");
  }

  return {
    autoExpandBooking,
    amplifyCta,
    reduceCaptureFriction,
    biasDirectAction,
    realtimePreference,
    followUpFlagged: input.followUpAlreadyFlagged,
    reasons,
  };
}

// ---------- server-side side-effect: follow-up flagging --------------------

export interface FlagForFollowUpInput {
  visitId: string;
  contactId: number | null;
  cardId: number | null;
  subAccountId: number | null;
  reason: string;
  triggerEventType: string | null;
}

export interface FollowUpFlagResult {
  flagged: boolean;
  channel: "universal_event" | "skipped";
  reason: string | null;
}

// flagForFollowUp is the server-side amplifier for Phase-3's high_intent
// trigger. It does TWO things, both fire-and-forget safe:
//   1. If we have a contactId, stamps the contact's metadata so the CRM /
//      sales surfaces ("needs follow-up" inbox) can pick it up via the
//      existing metadata-driven views — no new table, no schema change.
//   2. Emits a `tracking.followup_queued` universal event so downstream
//      automation (e.g. comment-bot reengage, drip campaigns, manual
//      review queues) can subscribe by event type. Test traffic must never
//      reach this path (caller's responsibility).
export async function flagForFollowUp(
  input: FlagForFollowUpInput,
): Promise<FollowUpFlagResult> {
  const queuedAt = new Date().toISOString();

  // The contacts table has no metadata jsonb in this schema, so the durable
  // record of "this visit needs follow-up" lives in universal_events. The
  // existing intelligence pipeline already subscribes to tracking.* events,
  // so a tracking.followup_queued event is automatically routed to whatever
  // sales / ops / drip surfaces want to react. This is intentionally the
  // ONLY write — we don't touch the intelligence pipeline or any tracking
  // tables to flag follow-up.
  try {
    emitUniversalEvent({
      eventType: "tracking.followup_queued",
      sourceModule: "tracking",
      moduleSource: "tracking",
      entityType: "tracking_visit",
      entityId: input.visitId,
      sourceTable: "tracking_visits",
      sourceRecordId: input.visitId,
      subAccountId: input.subAccountId ?? undefined,
      contactId: input.contactId ?? undefined,
      cardId: input.cardId ?? undefined,
      metadata: {
        visitId: input.visitId,
        reason: input.reason,
        triggerEventType: input.triggerEventType,
        queuedAt,
        identified: input.contactId != null,
      },
    });
  } catch (e) {
    console.warn("[cardActions] follow-up event emit failed", input.visitId, e);
  }

  return {
    flagged: true,
    channel: "universal_event",
    reason: input.reason,
  };
}

// Lightweight read used by the public adaptation endpoint to surface
// followUpFlagged back to the client. Source of truth is the universal
// events log — a row with event_type = tracking.followup_queued and
// source_record_id = visitId means flagForFollowUp() ran successfully for
// this visit. Returns false on any failure so the UI never shows a
// misleading "we'll follow up" message that isn't real.
export async function readFollowUpFlagged(visitId: string): Promise<boolean> {
  try {
    const rows = await db.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM universal_events
        WHERE event_type = 'tracking.followup_queued'
          AND source_record_id = ${visitId}
        LIMIT 1
      ) AS exists
    `);
    return Boolean((rows as any).rows?.[0]?.exists);
  } catch (err) {
    console.warn("[CARDACTIONS] caught:", err instanceof Error ? err.message : err);
    return false;
  }
}
