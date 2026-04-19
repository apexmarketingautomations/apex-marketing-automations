import type { Express, Request, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  digitalCards,
  trackingEvents,
  trackingVisits,
} from "@shared/schema";
import { asyncHandler, verifyAccountOwnership } from "./helpers";
import { getCardSnapshot } from "../services/trackingSnapshots";
import { generateInsights } from "../services/trackingInsights";
import { computeCardAdaptation } from "../services/cardAdaptation";
import { computeCardActionDirectives, readFollowUpFlagged } from "../services/cardActions";

// ---------------------------------------------------------------------------
// Apex Intelligence — client-facing dashboard API.
//
// /api/intelligence/cards/:id returns a single composite payload tuned for
// the CardIntelligencePanel UI: snapshot metrics + behavioral aggregates +
// recent activity + generated insights. Snapshot is reused from the storage
// layer (5-minute TTL); behavior aggregates are computed live but indexed
// queries keep them cheap. Tenant ownership is enforced via the
// digital_cards row before any tracking data is exposed.
// ---------------------------------------------------------------------------

interface RecentActivityItem {
  type: string;
  timestamp: Date;
  label: string | null;
}

interface BehaviorBlock {
  avgTimeToConvert: number | null; // seconds; null if no conversions yet
  peakHours: number[]; // 0-23, top 1-2
  topCTA: string | null;
  sessionDepth: number; // avg events per visit
}

interface AttributionBlock {
  confidenceScore: number; // 0..1
  stitchedJourneys: number; // visits with contactId
  repeatClusters: number; // == repeatVisitors
}

interface IntelligencePayload {
  cardId: number;
  metrics: {
    taps: number;
    qrScans: number;
    uniqueVisitors: number;
    repeatVisitors: number;
    identifiedVisitors: number;
    leads: number;
    bookedCalls: number;
    qualifiedLeads: number;
    conversionRate: number;
    repeatRate: number;
  };
  behavior: BehaviorBlock;
  attribution: AttributionBlock;
  recentActivity: RecentActivityItem[];
  insights: ReturnType<typeof generateInsights>;
  state: "ok" | "empty" | "low_data";
  computedAt: string;
  // Future hooks — declared so the frontend can light up surfaces as they
  // ship without a follow-up schema change.
  futureHooks: {
    aiRecommendations: null;
    crossClientBenchmarks: null;
    adaptiveRouting: null;
    ctaOptimization: null;
    campaignComparison: null;
  };
}

const LOW_DATA_VISIT_THRESHOLD = 5;

async function loadBehavior(cardId: number): Promise<BehaviorBlock> {
  // ---- avg time to convert (visit createdAt -> first lead_submit / booked_call) ----
  const ttcRows = await db.execute<{ avg_seconds: number | null }>(sql`
    WITH first_conv AS (
      SELECT visit_id, MIN(occurred_at) AS converted_at
      FROM tracking_events
      WHERE card_id = ${cardId}
        AND is_test = false
        AND event_type IN ('lead_submit', 'booked_call')
        AND visit_id IS NOT NULL
      GROUP BY visit_id
    )
    SELECT AVG(EXTRACT(EPOCH FROM (fc.converted_at - tv.created_at)))::float AS avg_seconds
    FROM first_conv fc
    JOIN tracking_visits tv ON tv.visit_id = fc.visit_id
    WHERE tv.is_test = false
      AND fc.converted_at >= tv.created_at
  `);
  const avgTimeToConvert =
    (ttcRows as any).rows?.[0]?.avg_seconds != null
      ? Number((ttcRows as any).rows[0].avg_seconds)
      : null;

  // ---- peak hours ----
  const hourRows = await db.execute<{ hour: number; n: number }>(sql`
    SELECT EXTRACT(HOUR FROM occurred_at)::int AS hour, COUNT(*)::int AS n
    FROM tracking_events
    WHERE card_id = ${cardId} AND is_test = false
    GROUP BY hour ORDER BY n DESC LIMIT 2
  `);
  const peakHours = ((hourRows as any).rows ?? [])
    .filter((r: any) => Number(r.n) >= 2) // ignore single-event hours
    .map((r: any) => Number(r.hour));

  // ---- top CTA ----
  const ctaRows = await db.execute<{ cta_id: string; n: number }>(sql`
    SELECT cta_id, COUNT(*)::int AS n
    FROM tracking_events
    WHERE card_id = ${cardId} AND is_test = false
      AND event_type = 'cta_click' AND cta_id IS NOT NULL
    GROUP BY cta_id ORDER BY n DESC LIMIT 1
  `);
  const topCTA = (ctaRows as any).rows?.[0]?.cta_id ?? null;

  // ---- session depth (avg events per visit) ----
  const depthRows = await db.execute<{ depth: number | null }>(sql`
    WITH per_visit AS (
      SELECT visit_id, COUNT(*)::int AS n
      FROM tracking_events
      WHERE card_id = ${cardId} AND is_test = false AND visit_id IS NOT NULL
      GROUP BY visit_id
    )
    SELECT AVG(n)::float AS depth FROM per_visit
  `);
  const sessionDepth = Number((depthRows as any).rows?.[0]?.depth ?? 0);

  return {
    avgTimeToConvert: avgTimeToConvert != null ? Math.round(avgTimeToConvert) : null,
    peakHours,
    topCTA,
    sessionDepth: Number(sessionDepth.toFixed(2)),
  };
}

async function loadRecentActivity(cardId: number): Promise<RecentActivityItem[]> {
  // We surface the most-meaningful events first (conversions > engagement >
  // entry) but cap the response at 5 so the UI stays scannable. Test traffic
  // is excluded.
  const meaningful = [
    "closed_sale",
    "qualified_lead",
    "booked_call",
    "lead_submit",
    "form_start",
    "cta_click",
    "qr_scan",
    "tap",
  ];

  const rows = await db
    .select({
      eventType: trackingEvents.eventType,
      occurredAt: trackingEvents.occurredAt,
      ctaId: trackingEvents.ctaId,
      formId: trackingEvents.formId,
      pageUrl: trackingEvents.pageUrl,
    })
    .from(trackingEvents)
    .where(
      and(
        eq(trackingEvents.cardId, cardId),
        eq(trackingEvents.isTest, false),
      ),
    )
    .orderBy(desc(trackingEvents.occurredAt))
    .limit(50);

  const filtered = rows.filter((r) => meaningful.includes(r.eventType));
  return filtered.slice(0, 5).map((r) => ({
    type: r.eventType,
    timestamp: r.occurredAt,
    label: r.ctaId || r.formId || r.pageUrl || null,
  }));
}

async function loadAttribution(cardId: number): Promise<AttributionBlock> {
  // confidenceScore comes from the snapshot blend; stitchedJourneys is the
  // count of visits with a contactId attached (post identity stitching).
  const [row] = await db
    .select({
      stitched: sql<number>`count(*) filter (where ${trackingVisits.contactId} is not null)::int`,
    })
    .from(trackingVisits)
    .where(and(eq(trackingVisits.cardId, cardId), eq(trackingVisits.isTest, false)));

  return {
    confidenceScore: 0, // filled in by caller from snapshot
    stitchedJourneys: Number(row?.stitched ?? 0),
    repeatClusters: 0, // filled in by caller from snapshot
  };
}

export function registerIntelligenceRoutes(app: Express): void {
  app.get(
    "/api/intelligence/cards/:id",
    asyncHandler(async (req: Request, res: Response) => {
      const cardId = Number(req.params.id);
      if (!Number.isFinite(cardId) || cardId <= 0) {
        return res.status(400).json({ error: "invalid card id" });
      }

      // ---- tenant ownership: resolve card -> subAccount, verify ----
      const [card] = await db
        .select({ id: digitalCards.id, subAccountId: digitalCards.subAccountId })
        .from(digitalCards)
        .where(eq(digitalCards.id, cardId))
        .limit(1);
      if (!card) return res.status(404).json({ error: "card not found" });
      if (card.subAccountId == null) {
        // Cards without a subAccount can only be inspected by the global
        // admin (verifyAccountOwnership requires a numeric account id).
        return res.status(403).json({ error: "card has no tenant scope" });
      }
      if (!(await verifyAccountOwnership(req, res, card.subAccountId))) return;

      const forceRefresh = req.query.refresh === "1";
      const snapshot = await getCardSnapshot(cardId, { forceRefresh });

      const [behavior, recentActivity, attributionRaw] = await Promise.all([
        loadBehavior(cardId),
        loadRecentActivity(cardId),
        loadAttribution(cardId),
      ]);

      const attribution: AttributionBlock = {
        confidenceScore: snapshot.avgAttributionConfidence,
        stitchedJourneys: attributionRaw.stitchedJourneys,
        repeatClusters: snapshot.repeatVisitors,
      };

      const repeatRate =
        snapshot.uniqueVisitors > 0 ? snapshot.repeatVisitors / snapshot.uniqueVisitors : 0;

      const insights = generateInsights({
        taps: snapshot.taps,
        qrScans: snapshot.qrScans,
        uniqueVisitors: snapshot.uniqueVisitors,
        repeatVisitors: snapshot.repeatVisitors,
        identifiedVisitors: snapshot.identifiedVisitors,
        leads: snapshot.leadSubmits,
        bookedCalls: snapshot.bookedCalls,
        conversionRate: snapshot.tapToLeadRate,
        repeatRate: Number(repeatRate.toFixed(4)),
        peakHours: behavior.peakHours,
        sessionDepth: behavior.sessionDepth,
      });

      // UI state hint — keeps the empty / low-data branches simple on the
      // client. "empty" wins over "low_data" so we never claim "low data" on
      // a card that has literally never been tapped.
      let state: IntelligencePayload["state"] = "ok";
      if (snapshot.uniqueVisitors === 0 && snapshot.taps === 0 && snapshot.qrScans === 0) {
        state = "empty";
      } else if (snapshot.uniqueVisitors < LOW_DATA_VISIT_THRESHOLD) {
        state = "low_data";
      }

      const payload: IntelligencePayload = {
        cardId,
        metrics: {
          taps: snapshot.taps,
          qrScans: snapshot.qrScans,
          uniqueVisitors: snapshot.uniqueVisitors,
          repeatVisitors: snapshot.repeatVisitors,
          identifiedVisitors: snapshot.identifiedVisitors,
          leads: snapshot.leadSubmits,
          bookedCalls: snapshot.bookedCalls,
          qualifiedLeads: snapshot.qualifiedLeads,
          conversionRate: snapshot.tapToLeadRate,
          repeatRate: Number(repeatRate.toFixed(4)),
        },
        behavior,
        attribution,
        recentActivity,
        insights,
        state,
        computedAt: snapshot.computedAt.toISOString(),
        futureHooks: {
          aiRecommendations: null,
          crossClientBenchmarks: null,
          adaptiveRouting: null,
          ctaOptimization: null,
          campaignComparison: null,
        },
      };

      return res.json(payload);
    }),
  );

  // -------------------------------------------------------------------------
  // Public adaptation endpoint.
  //
  // The card page itself is public, so this endpoint must be too — but it
  // returns ONLY render directives (booleans + the chosen CTA name). No
  // metrics, no PII, no benchmark data ever leaves through here.
  //
  // ?visit=<uuid> is optional. If supplied AND the visit belongs to this
  // card AND the visit is flagged is_high_intent, we let the directive set
  // include the high-intent adaptations. Worst case of spoofing: a visitor
  // forces *their own* card to surface its strongest CTA — there is no
  // cross-tenant or PII leak path, so a soft check is sufficient.
  //
  // ?hour=<0-23> lets the client pass its local hour for peak-hour matching
  // so we don't need to store TZ per visitor.
  // -------------------------------------------------------------------------
  app.get(
    "/api/intelligence/cards/by-slug/:slug/adaptation",
    asyncHandler(async (req: Request, res: Response) => {
      const slug = String(req.params.slug || "").toLowerCase();
      if (!slug) return res.status(400).json({ error: "invalid slug" });

      const [card] = await db
        .select({
          id: digitalCards.id,
          phone: digitalCards.phone,
          email: digitalCards.email,
          website: digitalCards.website,
          bookingUrl: digitalCards.bookingUrl,
          subAccountId: digitalCards.subAccountId,
          purchaseId: digitalCards.purchaseId,
          isActive: digitalCards.isActive,
          isPublic: digitalCards.isPublic,
          status: digitalCards.status,
          paymentStatus: digitalCards.paymentStatus,
          calendarUrl: digitalCards.calendarUrl,
        })
        .from(digitalCards)
        .where(eq(digitalCards.slug, slug))
        .limit(1);
      if (!card) return res.status(404).json({ error: "card not found" });

      // Mirror the public card route's accessibility gate so adaptation
      // directives never leak for unpublished/disabled/unpaid cards. Same
      // contract as /api/public-card/:slug.
      const accessible = card.subAccountId
        ? !!(card.isActive && card.isPublic && card.status === "published")
        : card.purchaseId
          ? card.paymentStatus === "paid"
          : false;
      if (!accessible) return res.status(403).json({ error: "card not available" });

      // Visit-scoped intent check (best effort, optional). We resolve the
      // visit row once here and reuse it below so we never trust a visit
      // param that points at a *different* card's visit.
      let visitIsHighIntent = false;
      let visitOwnsThisCard = false;
      const visitParam = typeof req.query.visit === "string" ? req.query.visit : null;
      if (visitParam) {
        const [visit] = await db
          .select({
            isHighIntent: trackingVisits.isHighIntent,
            cardId: trackingVisits.cardId,
          })
          .from(trackingVisits)
          .where(eq(trackingVisits.visitId, visitParam))
          .limit(1);
        if (visit && visit.cardId === card.id) {
          visitOwnsThisCard = true;
          if (visit.isHighIntent) visitIsHighIntent = true;
        }
      }

      // Reuse the snapshot + behavior aggregates the dashboard already
      // computes — same cache, no extra DB cost on warm hits.
      const snapshot = await getCardSnapshot(card.id);
      const behavior = await loadBehavior(card.id);

      const repeatRate =
        snapshot.uniqueVisitors > 0
          ? snapshot.repeatVisitors / snapshot.uniqueVisitors
          : 0;

      const insights = generateInsights({
        taps: snapshot.taps,
        qrScans: snapshot.qrScans,
        uniqueVisitors: snapshot.uniqueVisitors,
        repeatVisitors: snapshot.repeatVisitors,
        identifiedVisitors: snapshot.identifiedVisitors,
        leads: snapshot.leadSubmits,
        bookedCalls: snapshot.bookedCalls,
        conversionRate: snapshot.tapToLeadRate,
        repeatRate: Number(repeatRate.toFixed(4)),
        peakHours: behavior.peakHours,
        sessionDepth: behavior.sessionDepth,
      });
      const insightCodes = new Set(insights.map((i) => i.code));

      const hourParam = Number(req.query.hour);
      const currentHour =
        Number.isFinite(hourParam) && hourParam >= 0 && hourParam <= 23
          ? Math.floor(hourParam)
          : new Date().getUTCHours();

      const adaptation = computeCardAdaptation({
        taps: snapshot.taps,
        uniqueVisitors: snapshot.uniqueVisitors,
        repeatVisitors: snapshot.repeatVisitors,
        bookingUrl: card.bookingUrl,
        phone: card.phone,
        email: card.email,
        website: card.website,
        visitIsHighIntent,
        peakHours: behavior.peakHours,
        currentHour,
        insightCodes,
      });

      // Phase-5 action directives. These describe what the card SHOULD DO
      // (auto-expand booking, amplify CTA, reduce capture friction, prefer
      // realtime channels). The followUpFlagged flag is read separately
      // from the contact's metadata so the UI can confirm "we'll follow up"
      // honestly — it only reads true when the high-intent path actually
      // ran flagForFollowUp().
      let followUpAlreadyFlagged = false;
      const repeatEngagementSignal =
        insightCodes.has("repeat_engagement") || repeatRate > 0.25;

      // Only read follow-up status when the visit param actually points at
      // this card — same guard as visitIsHighIntent — so unrelated visit
      // UUIDs can't be used to probe the followup_queued event log.
      if (visitParam && visitOwnsThisCard) {
        followUpAlreadyFlagged = await readFollowUpFlagged(visitParam);
      }

      const actions = computeCardActionDirectives({
        visitIsHighIntent,
        hasBookingUrl: Boolean(card.bookingUrl || card.calendarUrl),
        hasPhone: Boolean(card.phone),
        hasEmail: Boolean(card.email),
        repeatEngagementSignal,
        inPeakHour: behavior.peakHours.includes(currentHour),
        followUpAlreadyFlagged,
      });

      // Cache directives briefly at the edge — they don't need to be
      // millisecond-fresh and we want to absorb refresh storms on viral
      // cards. Same cache TTL as the snapshot under the hood.
      res.set("Cache-Control", "private, max-age=30");
      return res.json({ ...adaptation, actions });
    }),
  );
}
