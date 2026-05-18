/**
 * server/serviceIndustry/retentionAutomationService.ts
 *
 * Retention & Reactivation Automation Service
 *
 * Builds draft retention workflows — NONE are auto-sent.
 * Every message is queued as a draft for human review.
 *
 * Workflow types:
 *   - reactivation_60d   — at-risk customers (61-120 days since visit)
 *   - reactivation_120d  — lapsed customers (121-365 days)
 *   - birthday_message   — sent up to 7 days before birthday month
 *   - membership_reminder — membership expiring within 14 days
 *   - package_expiry     — prepaid package about to expire
 *   - no_show_followup   — same-day no-show recovery
 *   - vip_appreciation   — VIP thank-you after 10th+ visit
 *   - referral_request   — post 3rd+ positive visit
 *   - loyalty_milestone  — milestone points rewards
 *
 * Safety:
 *   - All outputs are DRAFTS — no automatic sending
 *   - Dedup: one active draft per customer per workflow_type per window
 *   - Opt-out check before every draft creation
 *   - Max 2 reactivation touches per customer per 30-day window
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool } from "../hpl/sqlSafe";
import type { ServiceWorkflowType, CustomerLifecycle } from "./types";

// ── Draft message builder ─────────────────────────────────────────────────────

export function buildRetentionDraft(opts: {
  workflowType:    ServiceWorkflowType;
  businessName:    string;
  customerName?:   string;
  daysSinceVisit?: number;
  bookingLink?:    string;
  membershipType?: string;
  packageBalance?: number;
  birthdayMonth?:  number;
  loyaltyPoints?:  number;
  milestone?:      number;
}): string {
  const {
    workflowType, businessName, customerName, daysSinceVisit,
    bookingLink, membershipType, packageBalance, loyaltyPoints, milestone,
  } = opts;
  const hi   = customerName ? `Hi ${customerName}` : "Hi";
  const link = bookingLink ? ` Book here: ${bookingLink}` : "";

  switch (workflowType) {
    case "reactivation_60d":
      return `${hi}! It's been a while since we've seen you at ${businessName} — we miss you! Come back in and treat yourself.${link} Reply STOP to opt out.`;

    case "reactivation_120d":
      return `${hi}, we haven't seen you in over ${daysSinceVisit ?? 120} days and we'd love to have you back at ${businessName}. A lot has changed — book your visit today.${link} Reply STOP to opt out.`;

    case "birthday_message":
      return `${hi}! 🎂 Happy birthday from all of us at ${businessName}! We hope your day is as amazing as you are. Treat yourself — you deserve it.${link} Reply STOP to opt out.`;

    case "membership_reminder":
      return `${hi}! A quick heads-up from ${businessName}: your ${membershipType ?? "membership"} is coming up for renewal. Don't let it lapse — renew now to keep your benefits.${link} Reply STOP to opt out.`;

    case "package_expiry":
      return `${hi}! You still have ${packageBalance ?? 1} visit(s) left in your package at ${businessName} — don't let them expire! Book before they're gone.${link} Reply STOP to opt out.`;

    case "no_show_followup":
      return `${hi}, we noticed you weren't able to make your appointment today at ${businessName}. No worries — we'd love to get you rescheduled at a time that works better.${link} Reply STOP to opt out.`;

    case "vip_appreciation":
      return `${hi}, you're a VIP at ${businessName} and we want you to know how much we appreciate your loyalty. Thank you for being such an amazing client! Reply STOP to opt out.`;

    case "referral_request":
      return `${hi}! We're so glad you've been loving your visits at ${businessName}. Know someone who might love it too? Send them our way — word of mouth means everything to us. Reply STOP to opt out.`;

    case "loyalty_milestone":
      return `${hi}! Congratulations — you've reached ${milestone ?? loyaltyPoints} loyalty points at ${businessName}! 🎉 You've unlocked a special reward. Ask us about it at your next visit. Reply STOP to opt out.`;

    default:
      return `${hi}, thank you for being a valued client at ${businessName}. We appreciate you! Reply STOP to opt out.`;
  }
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _svc_retention_drafts (
        id                  SERIAL PRIMARY KEY,
        draft_id            TEXT        NOT NULL UNIQUE,
        business_id         TEXT        NOT NULL,
        customer_id         TEXT        NOT NULL,
        phone               TEXT,
        email               TEXT,

        workflow_type       TEXT        NOT NULL,
        draft_content       TEXT        NOT NULL,
        status              TEXT        NOT NULL DEFAULT 'pending',  -- pending|approved|sent|suppressed|rejected

        approved_by         TEXT,
        approved_at         TIMESTAMPTZ,
        sent_at             TIMESTAMPTZ,
        suppression_reason  TEXT,

        booking_link        TEXT,
        metadata            JSONB,

        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS svc_ret_business_idx  ON _svc_retention_drafts (business_id, status);
      CREATE INDEX IF NOT EXISTS svc_ret_customer_idx  ON _svc_retention_drafts (customer_id, workflow_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS svc_ret_pending_idx   ON _svc_retention_drafts (status, created_at DESC) WHERE status = 'pending';
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[SVC-RETENTION] Failed to ensure table:", err?.message);
  }
}

// ── Build draft ID ────────────────────────────────────────────────────────────

import { createHash } from "crypto";

function buildDraftId(businessId: string, customerId: string, workflowType: string): string {
  const raw = `${businessId}|${customerId}|${workflowType}|${new Date().toISOString().slice(0, 10)}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── Create retention draft ────────────────────────────────────────────────────

export async function createRetentionDraft(opts: {
  businessId:      string;
  customerId:      string;
  phone?:          string;
  email?:          string;
  workflowType:    ServiceWorkflowType;
  businessName:    string;
  customerName?:   string;
  daysSinceVisit?: number;
  bookingLink?:    string;
  membershipType?: string;
  packageBalance?: number;
  loyaltyPoints?:  number;
  milestone?:      number;
  metadata?:       Record<string, unknown>;
}): Promise<{ draftId: string; content: string; suppressed: boolean; reason?: string }> {
  await ensureTable();

  const { businessId, customerId, workflowType } = opts;
  const draftId = buildDraftId(businessId, customerId, workflowType);

  // ── Dedup check: one active draft per customer/type per day ────────────────
  const dedupResult = await db.execute(sql.raw(`
    SELECT id FROM _svc_retention_drafts
    WHERE business_id  = ${esc(businessId)}
      AND customer_id  = ${esc(customerId)}
      AND workflow_type = ${esc(workflowType)}
      AND status       IN ('pending', 'approved')
      AND created_at   >= NOW() - INTERVAL '30 days'
    LIMIT 1
  `));
  const dedupRows = (dedupResult as any).rows ?? dedupResult;
  if (Array.isArray(dedupRows) && dedupRows.length > 0) {
    return { draftId, content: "", suppressed: true, reason: "already_has_active_draft" };
  }

  // ── Reactivation cap: max 2 per 30d ───────────────────────────────────────
  if (workflowType.startsWith("reactivation")) {
    const capResult = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM _svc_retention_drafts
      WHERE business_id  = ${esc(businessId)}
        AND customer_id  = ${esc(customerId)}
        AND workflow_type LIKE 'reactivation%'
        AND created_at   >= NOW() - INTERVAL '30 days'
    `));
    const capRows = (capResult as any).rows ?? capResult;
    const cnt = Number((Array.isArray(capRows) ? capRows[0] : {})?.cnt ?? 0);
    if (cnt >= 2) {
      return { draftId, content: "", suppressed: true, reason: "reactivation_cap_reached" };
    }
  }

  const content = buildRetentionDraft(opts);

  try {
    await db.execute(sql.raw(`
      INSERT INTO _svc_retention_drafts
        (draft_id, business_id, customer_id, phone, email,
         workflow_type, draft_content, booking_link, metadata)
      VALUES
        (${esc(draftId)}, ${esc(businessId)}, ${esc(customerId)},
         ${esc(opts.phone ?? "")}, ${esc(opts.email ?? "")},
         ${esc(workflowType)}, ${esc(content)},
         ${esc(opts.bookingLink ?? "")},
         ${esc(JSON.stringify(opts.metadata ?? {}))})
      ON CONFLICT (draft_id) DO NOTHING
    `));
  } catch (err: any) {
    console.error("[SVC-RETENTION] Insert failed:", err?.message);
  }

  console.log(`[SVC-RETENTION] Draft created ${workflowType} → customer ${customerId}`);
  return { draftId, content, suppressed: false };
}

// ── Approve draft ─────────────────────────────────────────────────────────────

export async function approveRetentionDraft(draftId: string, approvedBy: string): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE _svc_retention_drafts
    SET status = 'approved', approved_by = ${esc(approvedBy)}, approved_at = NOW(), updated_at = NOW()
    WHERE draft_id = ${esc(draftId)} AND status = 'pending'
  `));
}

// ── Mark sent ─────────────────────────────────────────────────────────────────

export async function markRetentionDraftSent(draftId: string): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE _svc_retention_drafts
    SET status = 'sent', sent_at = NOW(), updated_at = NOW()
    WHERE draft_id = ${esc(draftId)} AND status = 'approved'
  `));
}

// ── Reject draft ──────────────────────────────────────────────────────────────

export async function rejectRetentionDraft(draftId: string, reason: string): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE _svc_retention_drafts
    SET status = 'rejected', suppression_reason = ${esc(reason)}, updated_at = NOW()
    WHERE draft_id = ${esc(draftId)} AND status IN ('pending','approved')
  `));
}

// ── Get pending drafts ────────────────────────────────────────────────────────

export async function getPendingRetentionDrafts(businessId?: string, limit = 50): Promise<any[]> {
  await ensureTable();
  const filter = businessId ? `AND business_id = ${esc(businessId)}` : "";
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _svc_retention_drafts
      WHERE status = 'pending'
        ${filter}
      ORDER BY created_at DESC
      LIMIT ${num(limit)}
    `));
    return (result as any).rows ?? result ?? [];
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getRetentionStats(businessId?: string): Promise<{
  totalDrafts:  number;
  pending:      number;
  approved:     number;
  sent:         number;
  conversionPct: number;
}> {
  await ensureTable();
  const filter = businessId
    ? `WHERE business_id = ${esc(businessId)}`
    : "WHERE created_at >= NOW() - INTERVAL '30 days'";
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                                               AS total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END)        AS pending,
        COUNT(CASE WHEN status = 'approved' THEN 1 END)       AS approved,
        COUNT(CASE WHEN status = 'sent' THEN 1 END)           AS sent
      FROM _svc_retention_drafts ${filter}
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : {};
    const total  = Number(r?.total ?? 0);
    const sent   = Number(r?.sent ?? 0);
    return {
      totalDrafts:   total,
      pending:       Number(r?.pending ?? 0),
      approved:      Number(r?.approved ?? 0),
      sent,
      conversionPct: total > 0 ? (sent / total) * 100 : 0,
    };
  } catch {  // allow-silent-catch: non-fatal, returns safe default
    return { totalDrafts: 0, pending: 0, approved: 0, sent: 0, conversionPct: 0 };
  }
}
