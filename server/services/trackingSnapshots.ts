import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import {
  trackingVisits,
  trackingEvents,
  cardIntelligenceSnapshots,
  type CardIntelligenceSnapshot,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Card-level intelligence snapshot.
//
// Pre-aggregates taps, scans, clicks, leads, and conversion rates per card so
// the analytics endpoint stays fast as the events table grows. Test traffic
// is excluded so benchmarks stay clean. The deferred intelligence layer will
// own the rollup scheduler — for now we recompute on-demand with a TTL.
// ---------------------------------------------------------------------------

const SNAPSHOT_TTL_MS = 5 * 60 * 1000; // 5 minutes

function safeRate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

export async function computeCardSnapshot(cardId: number): Promise<CardIntelligenceSnapshot> {
  // ---- per-event-type counts (production traffic only) ----
  const eventCountsRows = await db
    .select({
      eventType: trackingEvents.eventType,
      count: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${trackingEvents.eventValue}), 0)::float`,
      avgConfidence: sql<number>`coalesce(avg(${trackingEvents.attributionConfidence}), 0)::float`,
      firstAt: sql<Date | null>`min(${trackingEvents.occurredAt})`,
      lastAt: sql<Date | null>`max(${trackingEvents.occurredAt})`,
    })
    .from(trackingEvents)
    .where(and(eq(trackingEvents.cardId, cardId), eq(trackingEvents.isTest, false)))
    .groupBy(trackingEvents.eventType);

  const counts: Record<string, number> = {};
  let totalRevenue = 0;
  let weightedConfNum = 0;
  let weightedConfDen = 0;
  let firstEventAt: Date | null = null;
  let lastEventAt: Date | null = null;
  for (const r of eventCountsRows) {
    counts[r.eventType] = Number(r.count);
    totalRevenue += Number(r.revenue) || 0;
    weightedConfNum += Number(r.avgConfidence) * Number(r.count);
    weightedConfDen += Number(r.count);
    // raw aggregations come back as strings or Date depending on driver; coerce.
    const fa = r.firstAt ? new Date(r.firstAt as any) : null;
    const la = r.lastAt ? new Date(r.lastAt as any) : null;
    if (fa && (!firstEventAt || fa < firstEventAt)) firstEventAt = fa;
    if (la && (!lastEventAt || la > lastEventAt)) lastEventAt = la;
  }

  // ---- visitor counts (production traffic only) ----
  const visitorRow = await db
    .select({
      visitCount: sql<number>`count(*)::int`,
      uniqueVisitors: sql<number>`count(distinct ${trackingVisits.sessionId})::int`,
      identifiedVisitors: sql<number>`count(distinct ${trackingVisits.contactId}) filter (where ${trackingVisits.contactId} is not null)::int`,
      avgVisitConfidence: sql<number>`coalesce(avg(${trackingVisits.attributionConfidence}), 0)::float`,
      subAccountId: sql<number | null>`max(${trackingVisits.subAccountId})`,
    })
    .from(trackingVisits)
    .where(and(eq(trackingVisits.cardId, cardId), eq(trackingVisits.isTest, false)));

  // Repeat visitors: union of (a) sessions seen more than once AND
  // (b) identity clusters (contact_id / email_hash / phone_hash) seen on
  // more than one visit. This catches cross-session repeats stitched via
  // identity, which the session-only definition would miss.
  const repeatRow = await db.execute(sql`
    WITH same_session AS (
      SELECT session_id::text AS k FROM tracking_visits
      WHERE card_id = ${cardId} AND is_test = false AND session_id IS NOT NULL
      GROUP BY session_id HAVING COUNT(*) > 1
    ),
    same_contact AS (
      SELECT 'c:' || contact_id::text AS k FROM tracking_visits
      WHERE card_id = ${cardId} AND is_test = false AND contact_id IS NOT NULL
      GROUP BY contact_id HAVING COUNT(*) > 1
    ),
    same_email AS (
      SELECT 'e:' || email_hash AS k FROM tracking_visits
      WHERE card_id = ${cardId} AND is_test = false AND email_hash IS NOT NULL
      GROUP BY email_hash HAVING COUNT(*) > 1
    ),
    same_phone AS (
      SELECT 'p:' || phone_hash AS k FROM tracking_visits
      WHERE card_id = ${cardId} AND is_test = false AND phone_hash IS NOT NULL
      GROUP BY phone_hash HAVING COUNT(*) > 1
    )
    SELECT COUNT(*)::int AS repeat_count FROM (
      SELECT k FROM same_session
      UNION SELECT k FROM same_contact
      UNION SELECT k FROM same_email
      UNION SELECT k FROM same_phone
    ) u
  `);
  const repeatVisitors = Number((repeatRow as any).rows?.[0]?.repeat_count ?? 0);

  const taps = counts["tap"] ?? 0;
  const qrScans = counts["qr_scan"] ?? 0;
  const pageViews = counts["page_view"] ?? 0;
  const ctaClicks = counts["cta_click"] ?? 0;
  const formStarts = counts["form_start"] ?? 0;
  const leadSubmits = counts["lead_submit"] ?? 0;
  const bookedCalls = counts["booked_call"] ?? 0;
  const qualifiedLeads = counts["qualified_lead"] ?? 0;
  const closedSales = counts["closed_sale"] ?? 0;

  const visitCount = Number(visitorRow[0]?.visitCount ?? 0);
  const uniqueVisitors = Number(visitorRow[0]?.uniqueVisitors ?? 0);
  const identifiedVisitors = Number(visitorRow[0]?.identifiedVisitors ?? 0);
  const subAccountId = visitorRow[0]?.subAccountId ?? null;

  const totalEntryEvents = taps + qrScans;
  // If we never recorded a tap/scan (events sent via direct API only) fall
  // back to unique visitors as the denominator so the rate is meaningful.
  const tapDenominator = totalEntryEvents || uniqueVisitors;
  const visitConfidence = Number(visitorRow[0]?.avgVisitConfidence ?? 0);
  const eventConfidence = weightedConfDen > 0 ? weightedConfNum / weightedConfDen : 0;
  // Properly weight visit-avg by total visit count (NOT distinct sessions —
  // multi-visit sessions should still contribute proportionally) and
  // event-avg by event count, so a card with 1000 events and 2 visits doesn't
  // get its confidence dragged by an unweighted 50/50 blend.
  const visitWeight = visitCount;
  const eventWeight = weightedConfDen;
  const blendedConfidence = (visitWeight + eventWeight) > 0
    ? (visitConfidence * visitWeight + eventConfidence * eventWeight) / (visitWeight + eventWeight)
    : 0;

  const snapshot = {
    cardId,
    subAccountId,
    taps,
    qrScans,
    pageViews,
    ctaClicks,
    formStarts,
    leadSubmits,
    bookedCalls,
    qualifiedLeads,
    closedSales,
    uniqueVisitors,
    repeatVisitors,
    identifiedVisitors,
    tapToLeadRate: safeRate(leadSubmits, tapDenominator),
    clickToLeadRate: safeRate(leadSubmits, ctaClicks),
    leadToSaleRate: safeRate(closedSales, leadSubmits),
    totalRevenue,
    avgAttributionConfidence: Number(blendedConfidence.toFixed(4)),
    firstEventAt,
    lastEventAt,
  };

  // Upsert (one snapshot row per card).
  const [persisted] = await db
    .insert(cardIntelligenceSnapshots)
    .values(snapshot)
    .onConflictDoUpdate({
      target: cardIntelligenceSnapshots.cardId,
      set: {
        ...snapshot,
        computedAt: new Date(),
      },
    })
    .returning();

  return persisted;
}

export async function getCardSnapshot(
  cardId: number,
  opts: { forceRefresh?: boolean } = {},
): Promise<CardIntelligenceSnapshot> {
  if (!opts.forceRefresh) {
    const [existing] = await db
      .select()
      .from(cardIntelligenceSnapshots)
      .where(eq(cardIntelligenceSnapshots.cardId, cardId))
      .limit(1);
    if (existing && Date.now() - existing.computedAt.getTime() < SNAPSHOT_TTL_MS) {
      return existing;
    }
  }
  return computeCardSnapshot(cardId);
}
