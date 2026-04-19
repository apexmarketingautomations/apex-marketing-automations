import { and, eq, gte, sql, desc, ne } from "drizzle-orm";
import { db } from "../db";
import { trackingVisits, trackingEvents, contacts } from "@shared/schema";
import { emitUniversalEvent } from "../intelligence/eventEmitter";

// ---------------------------------------------------------------------------
// Live intent detection.
//
// Triggered from the event ingestion path (after recordEvent) for the small
// set of "intent-bearing" event types. Detection is cheap: we look at the
// last 24h of activity for any visit in the same identity cluster as the
// current visit (sessionId / contactId / emailHash / phoneHash).
//
// HIGH INTENT when ANY of:
//   (a) repeat visit within 24h AND current event is cta_click or form_start
//   (b) the identity cluster spans more than one session_id (multi-session)
//
// On trigger we (1) emit a `tracking.high_intent` universal event, (2) set
// the flag on the visit row, and (3) attach the signal to the contact if
// one is linked. Test traffic is always excluded.
// ---------------------------------------------------------------------------

export const INTENT_BEARING_EVENT_TYPES = new Set([
  "cta_click",
  "form_start",
  "page_view",
  "qr_scan",
  "tap",
]);

const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface DetectIntentInput {
  visitId: string;
  eventType: string;
  // Optional event id — included in the alert payload for traceability.
  eventId?: string;
}

export interface IntentResult {
  triggered: boolean;
  reason?: string;
  visitId: string;
  contactId?: number | null;
  subAccountId?: number | null;
  cardId?: number | null;
  alreadyFlagged?: boolean;
}

export async function detectIntent(input: DetectIntentInput): Promise<IntentResult> {
  const [visit] = await db
    .select()
    .from(trackingVisits)
    .where(eq(trackingVisits.visitId, input.visitId))
    .limit(1);

  if (!visit) return { triggered: false, visitId: input.visitId };
  if (visit.isTest) return { triggered: false, visitId: input.visitId, reason: "test_traffic" };

  // Intent only fires for the small "engagement" event set.
  if (!INTENT_BEARING_EVENT_TYPES.has(input.eventType)) {
    return { triggered: false, visitId: input.visitId, reason: "non_intent_event" };
  }

  const since = new Date(Date.now() - REPEAT_WINDOW_MS);

  // Identity-cluster lookup: find prior visits (excluding this one) within
  // 24h that share session/contact/emailHash/phoneHash with the current
  // visit. Tenant-scoped so cross-customer activity never leaks into intent.
  const clusterRows = await db.execute<{
    other_session_count: number;
    visit_count: number;
  }>(sql`
    SELECT
      COUNT(DISTINCT session_id) FILTER (
        WHERE session_id IS NOT NULL
          AND (${visit.sessionId ?? null}::text IS NULL OR session_id != ${visit.sessionId ?? null})
      )::int AS other_session_count,
      COUNT(*)::int AS visit_count
    FROM tracking_visits
    WHERE is_test = false
      AND created_at >= ${since}
      AND visit_id != ${visit.visitId}
      AND (
        ${visit.subAccountId == null
          ? sql`sub_account_id IS NULL`
          : sql`sub_account_id = ${visit.subAccountId}`}
      )
      AND (
        (${visit.sessionId ?? null}::text IS NOT NULL AND session_id = ${visit.sessionId ?? null})
        OR (${visit.contactId ?? null}::int IS NOT NULL AND contact_id = ${visit.contactId ?? null})
        OR (${visit.emailHash ?? null}::text IS NOT NULL AND email_hash = ${visit.emailHash ?? null})
        OR (${visit.phoneHash ?? null}::text IS NOT NULL AND phone_hash = ${visit.phoneHash ?? null})
      )
  `);

  const row = (clusterRows as any).rows?.[0] ?? { other_session_count: 0, visit_count: 0 };
  // Distinct *other* session ids in the cluster — only counts sessions that
  // differ from the current visit's session. This is the correct semantic
  // for "multi-session": a returning visitor on a fresh device/browser.
  const otherSessionCount = Number(row.other_session_count ?? 0);
  const visitCount = Number(row.visit_count ?? 0);

  let triggered = false;
  let reason: string | undefined;

  // (a) repeat visit within 24h AND engagement-grade event
  if (visitCount >= 1 && (input.eventType === "cta_click" || input.eventType === "form_start")) {
    triggered = true;
    reason = "repeat_visit_with_engagement";
  }

  // (b) multi-session identity cluster (the visitor has come back via
  // a *different* session — even without a new CTA click that's a strong
  // signal). Same-session repeat taps don't count here; they're handled by
  // condition (a) when paired with engagement.
  if (!triggered && otherSessionCount >= 1) {
    triggered = true;
    reason = "multi_session_identity";
  }

  if (!triggered) {
    return { triggered: false, visitId: input.visitId, reason: "no_signal_match" };
  }

  return sendIntentAlert({
    visitId: visit.visitId,
    contactId: visit.contactId ?? null,
    subAccountId: visit.subAccountId ?? null,
    cardId: visit.cardId ?? null,
    eventId: input.eventId ?? null,
    eventType: input.eventType,
    reason,
  });
}

// ---------------------------------------------------------------------------
// sendIntentAlert
//
// Logs the signal, flags the visit (idempotent), attaches a marker to the
// contact's metadata if one is linked, and emits a universal event so the
// rest of the Apex pipeline can react. SMS / push / CRM hooks land here in
// a future phase — for now this is the single source of truth.
// ---------------------------------------------------------------------------
interface SendIntentAlertInput {
  visitId: string;
  contactId: number | null;
  subAccountId: number | null;
  cardId: number | null;
  eventId: string | null;
  eventType: string;
  reason: string;
}

export async function sendIntentAlert(input: SendIntentAlertInput): Promise<IntentResult> {
  const now = new Date();

  // Atomically flip the flag from false → true. Only the connection that
  // wins the race sees a row in `returning`; concurrent qualifying events
  // observe an empty result and correctly skip the universal-event emit.
  // This is the single guarantee that we emit `tracking.high_intent` at
  // most once per visit, regardless of concurrency.
  const flipped = await db
    .update(trackingVisits)
    .set({
      isHighIntent: true,
      highIntentAt: now,
      highIntentReason: input.reason,
    })
    .where(and(eq(trackingVisits.visitId, input.visitId), eq(trackingVisits.isHighIntent, false)))
    .returning({ visitId: trackingVisits.visitId });

  const isFirstTrigger = flipped.length > 0;

  // Attach to contact metadata if known. Best-effort — failure here must
  // never block the event ingestion path. We only annotate on the first
  // trigger so we don't churn metadata on every subsequent event.
  if (isFirstTrigger && input.contactId != null) {
    try {
      await db.execute(sql`
        UPDATE contacts
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'lastHighIntentAt', ${now.toISOString()},
          'lastHighIntentReason', ${input.reason},
          'lastHighIntentVisitId', ${input.visitId}
        )
        WHERE id = ${input.contactId}
      `);
    } catch (e) {
      console.warn("[trackingIntent] failed to annotate contact", input.contactId, e);
    }
  }

  // Emit into the universal event pipeline only on the winning flip. This
  // is the atomic guarantee that we never emit duplicate high_intent events.
  if (isFirstTrigger) {
    emitUniversalEvent({
      eventType: "tracking.high_intent",
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
        triggerEventId: input.eventId,
        triggerEventType: input.eventType,
        reason: input.reason,
        detectedAt: now.toISOString(),
      },
    });

    console.log(
      `[trackingIntent] HIGH INTENT visit=${input.visitId} contact=${input.contactId ?? "-"} card=${input.cardId ?? "-"} reason=${input.reason}`,
    );
  }

  return {
    triggered: true,
    reason: input.reason,
    visitId: input.visitId,
    contactId: input.contactId,
    subAccountId: input.subAccountId,
    cardId: input.cardId,
    alreadyFlagged: !isFirstTrigger,
  };
}
