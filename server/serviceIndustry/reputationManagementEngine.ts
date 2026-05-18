/**
 * server/serviceIndustry/reputationManagementEngine.ts
 *
 * Review & Reputation Engine
 *
 * Tracks reviews across Google, Yelp, Facebook, and booking platforms.
 * Computes reputation health score, review velocity, sentiment analysis.
 * Generates draft AI response suggestions (no auto-posting).
 * Triggers negative review alerts and post-appointment review request drafts.
 *
 * Safety:
 *   - NO automated review posting
 *   - All response drafts require human review before sending
 *   - Negative review alerts dispatched within 24h (configurable)
 *   - Sentiment scoring is advisory only
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool } from "../hpl/sqlSafe";
import { createHash } from "crypto";
import type { ReviewRecord, ReviewPlatform, ReviewSentiment } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const NEGATIVE_ALERT_THRESHOLD = 3;     // Stars ≤ 3 triggers alert
const REPUTATION_WINDOW_DAYS   = 90;    // Rolling window for velocity/score

// ── Review ID ─────────────────────────────────────────────────────────────────

function buildReviewId(businessId: string, platform: ReviewPlatform, reviewText: string, publishedAt: string): string {
  const raw = `${businessId}|${platform}|${publishedAt}|${reviewText.slice(0, 80)}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── Sentiment scoring ─────────────────────────────────────────────────────────

export function scoreSentiment(rating: number, reviewText?: string): ReviewSentiment {
  if (rating >= 4) {
    if (!reviewText) return "positive";
    const negKeywords = ["but", "however", "disappointed", "rude", "slow", "dirty", "overpriced"];
    const hasNeg = negKeywords.some(k => reviewText.toLowerCase().includes(k));
    return hasNeg ? "neutral" : "positive";
  }
  if (rating === 3) return "neutral";
  return "negative";
}

// ── Reputation health score (0-100) ──────────────────────────────────────────

export function computeReputationScore(opts: {
  avgRating:        number;  // 1-5
  reviewCount:      number;
  recentCount:      number;  // reviews in last 90d
  negativeCount:    number;  // in last 90d
  respondedCount:   number;  // responded to
}): number {
  const { avgRating, reviewCount, recentCount, negativeCount, respondedCount } = opts;

  // Rating component (0-50): 5★ = 50, 4★ = 40, 3★ = 25, 2★ = 10, 1★ = 0
  const ratingScore = Math.max(0, (avgRating - 1) / 4 * 50);

  // Volume component (0-15): ≥20 reviews = full 15
  const volumeScore = Math.min(15, (reviewCount / 20) * 15);

  // Velocity component (0-15): ≥4 recent reviews = full 15
  const velocityScore = Math.min(15, (recentCount / 4) * 15);

  // Response rate component (0-10): % of reviews responded to
  const responseRate = reviewCount > 0 ? respondedCount / reviewCount : 0;
  const responseScore = responseRate * 10;

  // Negative penalty (0 to -15): each negative in last 90d = -5, cap at -15
  const negativePenalty = Math.min(15, negativeCount * 5);

  return Math.round(Math.min(100, Math.max(0,
    ratingScore + volumeScore + velocityScore + responseScore - negativePenalty
  )));
}

// ── Response draft builder ────────────────────────────────────────────────────

export function buildResponseDraft(opts: {
  businessName:  string;
  ownerName?:    string;
  reviewerName?: string;
  rating:        number;
  reviewText?:   string;
  sentiment:     ReviewSentiment;
}): string {
  const { businessName, ownerName, reviewerName, rating, reviewText, sentiment } = opts;
  const greeting = reviewerName ? `Hi ${reviewerName}` : "Hi there";
  const signer = ownerName ?? `The ${businessName} Team`;

  if (sentiment === "positive") {
    return `${greeting}, thank you so much for the kind words and for taking the time to leave us a review! It means the world to our team at ${businessName}. We look forward to seeing you again soon! — ${signer}`;
  }

  if (sentiment === "neutral") {
    return `${greeting}, thank you for sharing your feedback. We're glad you visited ${businessName} and we appreciate your honest review. We're always looking to improve — if you'd like to share more details, please reach out to us directly. We'd love the chance to make your next visit even better. — ${signer}`;
  }

  // Negative: service recovery tone
  return `${greeting}, thank you for letting us know about your experience. We're truly sorry to hear that your visit to ${businessName} did not meet expectations — this is not the standard we hold ourselves to. We would love the opportunity to make this right. Please reach out to us directly at your earliest convenience so we can address this personally. — ${signer}`;
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _svc_reviews (
        id                  SERIAL PRIMARY KEY,
        review_id           TEXT        NOT NULL UNIQUE,
        business_id         TEXT        NOT NULL,
        platform            TEXT        NOT NULL,
        rating              INTEGER     NOT NULL CHECK (rating BETWEEN 1 AND 5),
        sentiment           TEXT        NOT NULL DEFAULT 'neutral',
        review_text         TEXT,
        reviewer_name       TEXT,
        published_at        TIMESTAMPTZ,

        response_generated  BOOLEAN     DEFAULT FALSE,
        response_draft      TEXT,
        responded_at        TIMESTAMPTZ,

        flagged_negative    BOOLEAN     DEFAULT FALSE,
        alert_sent_at       TIMESTAMPTZ,

        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS svc_rev_business_idx ON _svc_reviews (business_id, platform);
      CREATE INDEX IF NOT EXISTS svc_rev_rating_idx   ON _svc_reviews (business_id, rating, published_at DESC);
      CREATE INDEX IF NOT EXISTS svc_rev_neg_idx      ON _svc_reviews (flagged_negative, alert_sent_at) WHERE flagged_negative = TRUE;

      CREATE TABLE IF NOT EXISTS _svc_reputation_snapshots (
        id                  SERIAL PRIMARY KEY,
        business_id         TEXT        NOT NULL,
        snapshot_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
        avg_rating          NUMERIC(3,2),
        review_count        INTEGER     DEFAULT 0,
        recent_count        INTEGER     DEFAULT 0,
        negative_count      INTEGER     DEFAULT 0,
        responded_count     INTEGER     DEFAULT 0,
        reputation_score    INTEGER     DEFAULT 0,
        UNIQUE (business_id, snapshot_date)
      );
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[SVC-REPUTATION] Failed to ensure table:", err?.message);
  }
}

// ── Ingest review ─────────────────────────────────────────────────────────────

export async function ingestReview(opts: {
  businessId:    string;
  businessName:  string;
  ownerName?:    string;
  platform:      ReviewPlatform;
  rating:        number;
  reviewText?:   string;
  reviewerName?: string;
  publishedAt?:  Date;
}): Promise<{
  reviewId:   string;
  sentiment:  ReviewSentiment;
  flagged:    boolean;
  draft?:     string;
}> {
  await ensureTable();

  const { businessId, businessName, ownerName, platform, rating, reviewText, reviewerName } = opts;
  const publishedAt = opts.publishedAt ?? new Date();
  const reviewId    = buildReviewId(businessId, platform, reviewText ?? "", publishedAt.toISOString());
  const sentiment   = scoreSentiment(rating, reviewText);
  const flagged     = rating <= NEGATIVE_ALERT_THRESHOLD;

  const draft = buildResponseDraft({ businessName, ownerName, reviewerName, rating, reviewText, sentiment });

  try {
    await db.execute(sql.raw(`
      INSERT INTO _svc_reviews
        (review_id, business_id, platform, rating, sentiment, review_text,
         reviewer_name, published_at, response_generated, response_draft, flagged_negative)
      VALUES
        (${esc(reviewId)}, ${esc(businessId)}, ${esc(platform)}, ${num(rating)},
         ${esc(sentiment)}, ${esc(reviewText ?? "")},
         ${esc(reviewerName ?? "")}, ${esc(publishedAt.toISOString())},
         TRUE, ${esc(draft)}, ${bool(flagged)})
      ON CONFLICT (review_id) DO UPDATE SET
        sentiment          = EXCLUDED.sentiment,
        response_draft     = EXCLUDED.response_draft,
        flagged_negative   = EXCLUDED.flagged_negative
    `));
  } catch (err: any) {
    console.error("[SVC-REPUTATION] Insert failed:", err?.message);
  }

  console.log(`[SVC-REPUTATION] Ingested review ${platform} rating=${rating} sentiment=${sentiment} flagged=${flagged}`);
  return { reviewId, sentiment, flagged, draft };
}

// ── Mark response sent ────────────────────────────────────────────────────────

export async function markReviewResponded(reviewId: string): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE _svc_reviews
    SET responded_at = NOW()
    WHERE review_id = ${esc(reviewId)} AND responded_at IS NULL
  `));
}

// ── Mark alert dispatched ─────────────────────────────────────────────────────

export async function markAlertSent(reviewId: string): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE _svc_reviews
    SET alert_sent_at = NOW()
    WHERE review_id = ${esc(reviewId)}
  `));
}

// ── Get pending negative alerts ───────────────────────────────────────────────

export async function getPendingNegativeAlerts(businessId?: string): Promise<ReviewRecord[]> {
  await ensureTable();
  const filter = businessId ? `AND business_id = ${esc(businessId)}` : "";
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _svc_reviews
      WHERE flagged_negative = TRUE
        AND alert_sent_at IS NULL
        ${filter}
      ORDER BY published_at DESC
      LIMIT 50
    `));
    const rows = (result as any).rows ?? result ?? [];
    return rows.map(mapReviewRow);
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}

// ── Compute + snapshot reputation score ──────────────────────────────────────

export async function snapshotReputationScore(businessId: string): Promise<{
  reputationScore: number;
  avgRating:       number;
  reviewCount:     number;
  recentCount:     number;
  negativeCount:   number;
  respondedCount:  number;
}> {
  await ensureTable();

  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COALESCE(AVG(rating)::NUMERIC(3,2), 0)                                       AS avg_rating,
        COUNT(*)                                                                      AS review_count,
        COUNT(CASE WHEN published_at >= NOW() - INTERVAL '${REPUTATION_WINDOW_DAYS} days' THEN 1 END) AS recent_count,
        COUNT(CASE WHEN rating <= ${NEGATIVE_ALERT_THRESHOLD}
                        AND published_at >= NOW() - INTERVAL '${REPUTATION_WINDOW_DAYS} days' THEN 1 END) AS negative_count,
        COUNT(CASE WHEN responded_at IS NOT NULL THEN 1 END)                          AS responded_count
      FROM _svc_reviews
      WHERE business_id = ${esc(businessId)}
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : {};

    const avgRating      = Number(r?.avg_rating ?? 0);
    const reviewCount    = Number(r?.review_count ?? 0);
    const recentCount    = Number(r?.recent_count ?? 0);
    const negativeCount  = Number(r?.negative_count ?? 0);
    const respondedCount = Number(r?.responded_count ?? 0);

    const reputationScore = computeReputationScore({
      avgRating, reviewCount, recentCount, negativeCount, respondedCount,
    });

    // Upsert daily snapshot
    await db.execute(sql.raw(`
      INSERT INTO _svc_reputation_snapshots
        (business_id, avg_rating, review_count, recent_count, negative_count, responded_count, reputation_score)
      VALUES
        (${esc(businessId)}, ${num(avgRating)}, ${num(reviewCount)}, ${num(recentCount)},
         ${num(negativeCount)}, ${num(respondedCount)}, ${num(reputationScore)})
      ON CONFLICT (business_id, snapshot_date) DO UPDATE SET
        avg_rating      = EXCLUDED.avg_rating,
        review_count    = EXCLUDED.review_count,
        recent_count    = EXCLUDED.recent_count,
        negative_count  = EXCLUDED.negative_count,
        responded_count = EXCLUDED.responded_count,
        reputation_score = EXCLUDED.reputation_score
    `));

    return { reputationScore, avgRating, reviewCount, recentCount, negativeCount, respondedCount };
  } catch (err: any) {
    console.error("[SVC-REPUTATION] Snapshot failed:", err?.message);
    return { reputationScore: 0, avgRating: 0, reviewCount: 0, recentCount: 0, negativeCount: 0, respondedCount: 0 };
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getReputationStats(businessId?: string): Promise<{
  totalReviews:     number;
  avgRating:        number;
  reputationScore:  number;
  pendingAlerts:    number;
  responseRate:     number;
}> {
  await ensureTable();
  const filter = businessId ? `WHERE business_id = ${esc(businessId)}` : "WHERE created_at >= NOW() - INTERVAL '30 days'";
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                                                       AS total,
        COALESCE(AVG(rating)::NUMERIC(3,2), 0)                        AS avg_rating,
        COUNT(CASE WHEN flagged_negative = TRUE AND alert_sent_at IS NULL THEN 1 END) AS pending_alerts,
        COUNT(CASE WHEN responded_at IS NOT NULL THEN 1 END)           AS responded
      FROM _svc_reviews ${filter}
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : {};
    const total      = Number(r?.total ?? 0);
    const responded  = Number(r?.responded ?? 0);
    const avgRating  = Number(r?.avg_rating ?? 0);
    const recentSnap = businessId ? await snapshotReputationScore(businessId) : null;

    return {
      totalReviews:    total,
      avgRating,
      reputationScore: recentSnap?.reputationScore ?? 0,
      pendingAlerts:   Number(r?.pending_alerts ?? 0),
      responseRate:    total > 0 ? (responded / total) * 100 : 0,
    };
  } catch {  // allow-silent-catch: non-fatal, returns safe default
    return { totalReviews: 0, avgRating: 0, reputationScore: 0, pendingAlerts: 0, responseRate: 0 };
  }
}

// ── Recent reviews ────────────────────────────────────────────────────────────

export async function getRecentReviews(businessId?: string, limit = 20): Promise<ReviewRecord[]> {
  await ensureTable();
  const filter = businessId ? `AND business_id = ${esc(businessId)}` : "";
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _svc_reviews
      WHERE 1=1 ${filter}
      ORDER BY published_at DESC
      LIMIT ${num(limit)}
    `));
    return ((result as any).rows ?? result ?? []).map(mapReviewRow);
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function mapReviewRow(r: any): ReviewRecord {
  return {
    reviewId:           r.review_id,
    businessId:         r.business_id,
    platform:           r.platform as ReviewPlatform,
    rating:             Number(r.rating ?? 0),
    sentiment:          (r.sentiment ?? "neutral") as ReviewSentiment,
    reviewText:         r.review_text || undefined,
    reviewerName:       r.reviewer_name || undefined,
    publishedAt:        r.published_at?.toISOString?.() ?? undefined,
    responseGenerated:  Boolean(r.response_generated),
    responseDraft:      r.response_draft || undefined,
    respondedAt:        r.responded_at?.toISOString?.() ?? undefined,
    flaggedNegative:    Boolean(r.flagged_negative),
    alertSentAt:        r.alert_sent_at?.toISOString?.() ?? undefined,
    createdAt:          r.created_at?.toISOString?.() ?? undefined,
  };
}
