/**
 * server/serviceIndustry/loyaltyWorkflowEngine.ts
 *
 * Loyalty & Referral Workflow Engine
 *
 * Manages loyalty points ledger, milestone rewards, referral tracking,
 * and VIP tier progression. All reward notifications are draft-only.
 *
 * Points model:
 *   - 1 point per $1 spent (configurable)
 *   - 10 bonus points for leaving a review
 *   - 25 bonus points for referring a new client
 *   - Milestone rewards at 100 / 250 / 500 / 1000 points
 *
 * Safety:
 *   - No automatic reward redemption
 *   - No monetary transactions
 *   - Reward notifications are DRAFTS — human must approve before sending
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool } from "../hpl/sqlSafe";
import { createHash } from "crypto";

// ── Constants ─────────────────────────────────────────────────────────────────

const POINTS_PER_DOLLAR  = 1;
const REVIEW_BONUS       = 10;
const REFERRAL_BONUS     = 25;
const MILESTONES         = [100, 250, 500, 1000] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type LoyaltyEventType =
  | "visit"
  | "review_bonus"
  | "referral_bonus"
  | "milestone_reward"
  | "manual_adjustment"
  | "redemption";

export interface LoyaltyEntry {
  entryId:       string;
  businessId:    string;
  customerId:    string;
  eventType:     LoyaltyEventType;
  points:        number;         // positive = earned, negative = redeemed
  description:   string;
  balanceBefore: number;
  balanceAfter:  number;
  createdAt?:    string;
}

export interface LoyaltySummary {
  customerId:       string;
  businessId:       string;
  totalPoints:      number;
  lifetimeEarned:   number;
  totalRedeemed:    number;
  nextMilestone:    number | null;
  pointsToNext:     number | null;
  milestonesHit:    number[];
}

// ── ID builders ───────────────────────────────────────────────────────────────

function buildEntryId(businessId: string, customerId: string, eventType: string, ts: string): string {
  const raw = `${businessId}|${customerId}|${eventType}|${ts}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _svc_loyalty_ledger (
        id             SERIAL PRIMARY KEY,
        entry_id       TEXT        NOT NULL UNIQUE,
        business_id    TEXT        NOT NULL,
        customer_id    TEXT        NOT NULL,
        event_type     TEXT        NOT NULL,
        points         INTEGER     NOT NULL,
        description    TEXT,
        balance_before INTEGER     NOT NULL DEFAULT 0,
        balance_after  INTEGER     NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS svc_loy_customer_idx ON _svc_loyalty_ledger (customer_id, business_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS svc_loy_business_idx ON _svc_loyalty_ledger (business_id, event_type);

      CREATE TABLE IF NOT EXISTS _svc_loyalty_balances (
        business_id       TEXT        NOT NULL,
        customer_id       TEXT        NOT NULL,
        current_balance   INTEGER     NOT NULL DEFAULT 0,
        lifetime_earned   INTEGER     NOT NULL DEFAULT 0,
        total_redeemed    INTEGER     NOT NULL DEFAULT 0,
        milestones_hit    INTEGER[]   NOT NULL DEFAULT '{}',
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (business_id, customer_id)
      );

      CREATE TABLE IF NOT EXISTS _svc_referrals (
        id              SERIAL PRIMARY KEY,
        referral_id     TEXT        NOT NULL UNIQUE,
        business_id     TEXT        NOT NULL,
        referrer_id     TEXT        NOT NULL,
        referred_phone  TEXT        NOT NULL,
        status          TEXT        NOT NULL DEFAULT 'pending',  -- pending|converted|expired
        bonus_granted   BOOLEAN     DEFAULT FALSE,
        converted_at    TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS svc_ref_referrer_idx ON _svc_referrals (referrer_id, business_id);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[SVC-LOYALTY] Failed to ensure table:", err?.message);
  }
}

// ── Get current balance ───────────────────────────────────────────────────────

async function getCurrentBalance(businessId: string, customerId: string): Promise<number> {
  try {
    const result = await db.execute(sql.raw(`
      SELECT current_balance FROM _svc_loyalty_balances
      WHERE business_id = ${esc(businessId)} AND customer_id = ${esc(customerId)}
    `));
    const rows = (result as any).rows ?? result;
    return Number((Array.isArray(rows) ? rows[0] : {})?.current_balance ?? 0);
  } catch { return 0; }
}

// ── Record points event ───────────────────────────────────────────────────────

export async function recordLoyaltyEvent(opts: {
  businessId:  string;
  customerId:  string;
  eventType:   LoyaltyEventType;
  points:      number;
  description: string;
}): Promise<{ entryId: string; balanceBefore: number; balanceAfter: number; newMilestones: number[] }> {
  await ensureTable();

  const { businessId, customerId, eventType, points, description } = opts;
  const ts = new Date().toISOString();
  const entryId = buildEntryId(businessId, customerId, eventType, ts);

  const balanceBefore = await getCurrentBalance(businessId, customerId);
  const balanceAfter  = Math.max(0, balanceBefore + points);

  // Determine newly crossed milestones
  const newMilestones = MILESTONES.filter(m => m > balanceBefore && m <= balanceAfter);

  try {
    // Insert ledger entry
    await db.execute(sql.raw(`
      INSERT INTO _svc_loyalty_ledger
        (entry_id, business_id, customer_id, event_type, points, description, balance_before, balance_after)
      VALUES
        (${esc(entryId)}, ${esc(businessId)}, ${esc(customerId)}, ${esc(eventType)},
         ${num(points)}, ${esc(description)}, ${num(balanceBefore)}, ${num(balanceAfter)})
      ON CONFLICT (entry_id) DO NOTHING
    `));

    // Upsert balance row
    const earnedDelta  = points > 0 ? points : 0;
    const redeemedDelta = points < 0 ? Math.abs(points) : 0;
    const milestonesClause = newMilestones.length > 0
      ? `milestones_hit = (SELECT ARRAY(SELECT DISTINCT unnest(milestones_hit || ARRAY[${newMilestones.join(",")}]::INTEGER[]) ORDER BY 1) FROM _svc_loyalty_balances WHERE business_id = ${esc(businessId)} AND customer_id = ${esc(customerId)}),`
      : "";

    await db.execute(sql.raw(`
      INSERT INTO _svc_loyalty_balances
        (business_id, customer_id, current_balance, lifetime_earned, total_redeemed,
         milestones_hit, updated_at)
      VALUES
        (${esc(businessId)}, ${esc(customerId)}, ${num(balanceAfter)},
         ${num(earnedDelta)}, ${num(redeemedDelta)},
         ARRAY[${newMilestones.length > 0 ? newMilestones.join(",") : ""}]::INTEGER[],
         NOW())
      ON CONFLICT (business_id, customer_id) DO UPDATE SET
        current_balance = ${num(balanceAfter)},
        lifetime_earned = _svc_loyalty_balances.lifetime_earned + ${num(earnedDelta)},
        total_redeemed  = _svc_loyalty_balances.total_redeemed  + ${num(redeemedDelta)},
        ${milestonesClause}
        updated_at      = NOW()
    `));
  } catch (err: any) {
    console.error("[SVC-LOYALTY] Record event failed:", err?.message);
  }

  console.log(`[SVC-LOYALTY] ${eventType} +${points}pts → balance=${balanceAfter} milestones=${newMilestones}`);
  return { entryId, balanceBefore, balanceAfter, newMilestones };
}

// ── Award visit points ────────────────────────────────────────────────────────

export async function awardVisitPoints(opts: {
  businessId:   string;
  customerId:   string;
  visitValue:   number;
  appointmentId?: string;
}): Promise<{ entryId: string; pointsAwarded: number; balanceAfter: number; newMilestones: number[] }> {
  const points = Math.round(opts.visitValue * POINTS_PER_DOLLAR);
  const result = await recordLoyaltyEvent({
    businessId:  opts.businessId,
    customerId:  opts.customerId,
    eventType:   "visit",
    points,
    description: `Visit points for appointment${opts.appointmentId ? ` ${opts.appointmentId}` : ""}`,
  });
  return { entryId: result.entryId, pointsAwarded: points, balanceAfter: result.balanceAfter, newMilestones: result.newMilestones };
}

// ── Award review bonus ────────────────────────────────────────────────────────

export async function awardReviewBonus(businessId: string, customerId: string): Promise<void> {
  await recordLoyaltyEvent({
    businessId,
    customerId,
    eventType:   "review_bonus",
    points:      REVIEW_BONUS,
    description: `Bonus for leaving a review`,
  });
}

// ── Record referral ───────────────────────────────────────────────────────────

export async function recordReferral(opts: {
  businessId:    string;
  referrerId:    string;
  referredPhone: string;
}): Promise<{ referralId: string }> {
  await ensureTable();
  const referralId = buildEntryId(opts.businessId, opts.referrerId, "referral", opts.referredPhone);
  try {
    await db.execute(sql.raw(`
      INSERT INTO _svc_referrals
        (referral_id, business_id, referrer_id, referred_phone)
      VALUES
        (${esc(referralId)}, ${esc(opts.businessId)}, ${esc(opts.referrerId)}, ${esc(opts.referredPhone)})
      ON CONFLICT (referral_id) DO NOTHING
    `));
  } catch (err: any) {
    console.error("[SVC-LOYALTY] Referral record failed:", err?.message);
  }
  return { referralId };
}

// ── Convert referral (new client booked) ─────────────────────────────────────

export async function convertReferral(referralId: string): Promise<void> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      UPDATE _svc_referrals
      SET status = 'converted', converted_at = NOW(), bonus_granted = TRUE
      WHERE referral_id = ${esc(referralId)} AND status = 'pending'
      RETURNING business_id, referrer_id
    `));
    const rows = (result as any).rows ?? result;
    if (Array.isArray(rows) && rows.length > 0) {
      const { business_id, referrer_id } = rows[0];
      await recordLoyaltyEvent({
        businessId:  business_id,
        customerId:  referrer_id,
        eventType:   "referral_bonus",
        points:      REFERRAL_BONUS,
        description: `Referral bonus — new client converted from referral ${referralId}`,
      });
    }
  } catch (err: any) {
    console.error("[SVC-LOYALTY] Referral convert failed:", err?.message);
  }
}

// ── Get loyalty summary ───────────────────────────────────────────────────────

export async function getLoyaltySummary(businessId: string, customerId: string): Promise<LoyaltySummary> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT current_balance, lifetime_earned, total_redeemed, milestones_hit
      FROM _svc_loyalty_balances
      WHERE business_id = ${esc(businessId)} AND customer_id = ${esc(customerId)}
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : null;
    const currentBalance = Number(r?.current_balance ?? 0);
    const milestonesHit  = (r?.milestones_hit ?? []).map(Number);
    const nextMilestone  = MILESTONES.find(m => m > currentBalance) ?? null;
    const pointsToNext   = nextMilestone ? nextMilestone - currentBalance : null;

    return {
      customerId,
      businessId,
      totalPoints:    currentBalance,
      lifetimeEarned: Number(r?.lifetime_earned ?? 0),
      totalRedeemed:  Number(r?.total_redeemed ?? 0),
      nextMilestone,
      pointsToNext,
      milestonesHit,
    };
  } catch {
    return {
      customerId, businessId, totalPoints: 0, lifetimeEarned: 0,
      totalRedeemed: 0, nextMilestone: MILESTONES[0], pointsToNext: MILESTONES[0], milestonesHit: [],
    };
  }
}

// ── Get loyalty ledger for customer ──────────────────────────────────────────

export async function getLoyaltyLedger(businessId: string, customerId: string, limit = 20): Promise<LoyaltyEntry[]> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _svc_loyalty_ledger
      WHERE business_id = ${esc(businessId)} AND customer_id = ${esc(customerId)}
      ORDER BY created_at DESC
      LIMIT ${num(limit)}
    `));
    return ((result as any).rows ?? result ?? []).map((r: any): LoyaltyEntry => ({
      entryId:       r.entry_id,
      businessId:    r.business_id,
      customerId:    r.customer_id,
      eventType:     r.event_type as LoyaltyEventType,
      points:        Number(r.points),
      description:   r.description ?? "",
      balanceBefore: Number(r.balance_before),
      balanceAfter:  Number(r.balance_after),
      createdAt:     r.created_at?.toISOString?.() ?? undefined,
    }));
  } catch { return []; }
}

// ── Business-level loyalty stats ──────────────────────────────────────────────

export async function getLoyaltyStats(businessId?: string): Promise<{
  totalMembers:     number;
  totalPointsIssued: number;
  totalRedeemed:    number;
  milestonesHit:    number;
}> {
  await ensureTable();
  const filter = businessId ? `WHERE business_id = ${esc(businessId)}` : "";
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                              AS members,
        SUM(lifetime_earned)                  AS issued,
        SUM(total_redeemed)                   AS redeemed,
        SUM(array_length(milestones_hit, 1))  AS milestones
      FROM _svc_loyalty_balances ${filter}
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : {};
    return {
      totalMembers:      Number(r?.members ?? 0),
      totalPointsIssued: Number(r?.issued ?? 0),
      totalRedeemed:     Number(r?.redeemed ?? 0),
      milestonesHit:     Number(r?.milestones ?? 0),
    };
  } catch {
    return { totalMembers: 0, totalPointsIssued: 0, totalRedeemed: 0, milestonesHit: 0 };
  }
}
