/**
 * server/serviceIndustry/appointmentIntelligenceEngine.ts
 *
 * Appointment Intelligence Engine
 *
 * Tracks and scores every appointment interaction for a service business.
 * Detects: churn risk, VIP signals, upsell opportunities, reactivation windows.
 *
 * Customer lifecycle transitions (automated):
 *   new → active (after 2nd visit)
 *   active → at_risk (60d no visit)
 *   at_risk → lapsed (120d no visit)
 *   lapsed → lost (365d no visit)
 *   Any lifecycle → vip (visit frequency + spend thresholds)
 *
 * Churn risk scoring (0-100):
 *   - Days since last visit (primary driver)
 *   - No-show / cancellation history
 *   - Visit frequency drop-off
 *   - Membership lapse signal
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool } from "../hpl/sqlSafe";
import { createHash } from "crypto";
import type {
  ServiceAppointment, ServiceCustomer, AppointmentStatus, CustomerLifecycle,
} from "./types";

// ── ID builders ───────────────────────────────────────────────────────────────

export function buildCustomerId(businessId: string, phone: string): string {
  return createHash("sha256")
    .update(`${businessId}|${phone.replace(/\D/g, "")}`)
    .digest("hex").slice(0, 24);
}

export function buildAppointmentId(businessId: string, customerId: string, scheduledAt: string): string {
  return createHash("sha256")
    .update(`${businessId}|${customerId}|${scheduledAt}`)
    .digest("hex").slice(0, 24);
}

// ── Churn risk scoring ────────────────────────────────────────────────────────

export function scoreChurnRisk(customer: Partial<ServiceCustomer>): number {
  let score = 0;
  const now = Date.now();

  // Days since last visit (primary)
  if (customer.lastVisitAt) {
    const daysSince = (now - new Date(customer.lastVisitAt).getTime()) / 86_400_000;
    if (daysSince > 365)      score += 60;
    else if (daysSince > 120) score += 40;
    else if (daysSince > 60)  score += 20;
    else if (daysSince > 30)  score += 8;
  } else {
    score += 30; // No visit recorded
  }

  // No-show history
  const noShows = customer.noShowCount ?? 0;
  if (noShows >= 3) score += 20;
  else if (noShows >= 1) score += 8;

  // Cancellation pattern
  const cancels = customer.cancellationCount ?? 0;
  if (cancels >= 3) score += 10;
  else if (cancels >= 1) score += 4;

  // Membership lapsed
  if (customer.isMember && customer.membershipExpires) {
    const expired = new Date(customer.membershipExpires).getTime() < now;
    if (expired) score += 15;
  }

  return Math.min(score, 100);
}

// ── Upsell scoring ────────────────────────────────────────────────────────────

export function scoreUpsell(customer: Partial<ServiceCustomer>): number {
  let score = 0;
  if ((customer.visitCount ?? 0) >= 5) score += 25;
  if ((customer.totalSpend ?? 0) >= 500) score += 20;
  if (!customer.isMember) score += 20;   // membership upsell opportunity
  if ((customer.packageBalance ?? 1) === 0) score += 15;  // package renewal
  if (customer.lifecycle === "vip") score += 10;
  if ((customer.visitCount ?? 0) >= 10) score += 10;
  return Math.min(score, 100);
}

// ── Lifecycle resolution ──────────────────────────────────────────────────────

export function resolveLifecycle(customer: Partial<ServiceCustomer>): CustomerLifecycle {
  if (customer.isMember) return "member";

  const visits = customer.visitCount ?? 0;
  const spend  = customer.totalSpend ?? 0;
  // VIP: 10+ visits OR $1000+ spend
  if (visits >= 10 || spend >= 1_000) return "vip";

  if (!customer.lastVisitAt) return visits === 0 ? "new" : "at_risk";

  const daysSince = (Date.now() - new Date(customer.lastVisitAt).getTime()) / 86_400_000;
  if (visits <= 1)      return "new";
  if (daysSince <= 60)  return "active";
  if (daysSince <= 120) return "at_risk";
  if (daysSince <= 365) return "lapsed";
  return "lost";
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _svc_appointments (
        id                  SERIAL PRIMARY KEY,
        appointment_id      TEXT        NOT NULL UNIQUE,
        business_id         TEXT        NOT NULL,
        customer_id         TEXT,
        phone               TEXT,
        staff_id            TEXT,
        staff_name          TEXT,
        service             TEXT        NOT NULL,
        duration_minutes    INTEGER,
        value               NUMERIC(10,2),
        status              TEXT        NOT NULL DEFAULT 'scheduled',
        scheduled_at        TIMESTAMPTZ NOT NULL,
        completed_at        TIMESTAMPTZ,
        cancelled_at        TIMESTAMPTZ,
        no_show_at          TIMESTAMPTZ,
        reschedule_count    INTEGER     DEFAULT 0,
        booking_source      TEXT,
        review_requested    BOOLEAN     DEFAULT FALSE,
        review_received_at  TIMESTAMPTZ,
        notes               TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS svc_appt_business_idx ON _svc_appointments (business_id, scheduled_at DESC);
      CREATE INDEX IF NOT EXISTS svc_appt_customer_idx ON _svc_appointments (customer_id, scheduled_at DESC);
      CREATE INDEX IF NOT EXISTS svc_appt_status_idx   ON _svc_appointments (status, scheduled_at);

      CREATE TABLE IF NOT EXISTS _svc_customers (
        id                  SERIAL PRIMARY KEY,
        customer_id         TEXT        NOT NULL UNIQUE,
        business_id         TEXT        NOT NULL,
        phone               TEXT,
        email               TEXT,
        first_name          TEXT,
        last_name           TEXT,
        birth_month         INTEGER,
        birth_day           INTEGER,
        lifecycle           TEXT        NOT NULL DEFAULT 'new',
        visit_count         INTEGER     NOT NULL DEFAULT 0,
        total_spend         NUMERIC(10,2) NOT NULL DEFAULT 0,
        avg_visit_value     NUMERIC(10,2),
        last_visit_at       TIMESTAMPTZ,
        first_visit_at      TIMESTAMPTZ,
        next_appointment_at TIMESTAMPTZ,
        preferred_service   TEXT,
        preferred_staff     TEXT,
        preferred_day_of_week INTEGER,
        is_member           BOOLEAN     NOT NULL DEFAULT FALSE,
        membership_type     TEXT,
        membership_expires  TIMESTAMPTZ,
        package_balance     INTEGER,
        loyalty_points      INTEGER     DEFAULT 0,
        no_show_count       INTEGER     DEFAULT 0,
        cancellation_count  INTEGER     DEFAULT 0,
        review_left         BOOLEAN     DEFAULT FALSE,
        communication_preference TEXT   DEFAULT 'sms',
        opted_out           BOOLEAN     NOT NULL DEFAULT FALSE,
        churn_risk_score    INTEGER,
        upsell_score        INTEGER,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS svc_cust_business_idx ON _svc_customers (business_id, lifecycle);
      CREATE INDEX IF NOT EXISTS svc_cust_churn_idx    ON _svc_customers (business_id, churn_risk_score DESC);
      CREATE INDEX IF NOT EXISTS svc_cust_phone_idx    ON _svc_customers (business_id, phone);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[SVC-APPT] Failed to ensure table:", err?.message);
  }
}

// ── Upsert appointment ────────────────────────────────────────────────────────

export async function upsertAppointment(
  appt: Omit<ServiceAppointment, "appointmentId"> & { appointmentId?: string },
): Promise<{ appointmentId: string; isNew: boolean }> {
  await ensureTable();

  const customerId  = appt.customerId ?? (appt.phone ? buildCustomerId(appt.businessId, appt.phone) : undefined);
  const appointmentId = appt.appointmentId ?? buildAppointmentId(
    appt.businessId, customerId ?? "anon", appt.scheduledAt,
  );

  try {
    const result = await db.execute(sql.raw(`
      INSERT INTO _svc_appointments (
        appointment_id, business_id, customer_id, phone, staff_id, staff_name,
        service, duration_minutes, value, status, scheduled_at,
        completed_at, cancelled_at, no_show_at, reschedule_count,
        booking_source, review_requested, notes
      ) VALUES (
        ${esc(appointmentId)}, ${esc(appt.businessId)}, ${esc(customerId)},
        ${esc(appt.phone)}, ${esc(appt.staffId)}, ${esc(appt.staffName)},
        ${esc(appt.service)}, ${num(appt.durationMinutes)}, ${num(appt.value)},
        ${esc(appt.status)}, ${esc(appt.scheduledAt)},
        ${esc(appt.completedAt)}, ${esc(appt.cancelledAt)}, ${esc(appt.noShowAt)},
        ${num(appt.rescheduleCount ?? 0)},
        ${esc(appt.bookingSource)}, ${bool(appt.reviewRequested ?? false)}, ${esc(appt.notes)}
      )
      ON CONFLICT (appointment_id) DO UPDATE SET
        status          = EXCLUDED.status,
        completed_at    = COALESCE(EXCLUDED.completed_at, _svc_appointments.completed_at),
        cancelled_at    = COALESCE(EXCLUDED.cancelled_at, _svc_appointments.cancelled_at),
        no_show_at      = COALESCE(EXCLUDED.no_show_at, _svc_appointments.no_show_at),
        reschedule_count = GREATEST(_svc_appointments.reschedule_count, EXCLUDED.reschedule_count),
        review_requested = _svc_appointments.review_requested OR EXCLUDED.review_requested
      RETURNING (xmax = 0) AS is_new
    `));
    const rows = (result as any).rows ?? result;
    const isNew = Array.isArray(rows) && rows[0]?.is_new === true;

    // Update customer stats if appointment completed or is no-show
    if (customerId && (appt.status === "completed" || appt.status === "no_show")) {
      await syncCustomerFromAppointment(appt.businessId, customerId, appt);
    }

    return { appointmentId, isNew };
  } catch (err: any) {
    console.error("[SVC-APPT] Upsert failed:", err?.message);
    return { appointmentId, isNew: false };
  }
}

// ── Sync customer record from appointment ─────────────────────────────────────

async function syncCustomerFromAppointment(
  businessId: string,
  customerId: string,
  appt: Partial<ServiceAppointment>,
): Promise<void> {
  try {
    // Aggregate from all appointments for this customer
    const aggResult = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                                              AS visit_count,
        SUM(CASE WHEN value IS NOT NULL THEN value ELSE 0 END) AS total_spend,
        AVG(CASE WHEN value IS NOT NULL THEN value END)       AS avg_value,
        MAX(completed_at)                                     AS last_visit,
        MIN(scheduled_at)                                     AS first_visit,
        COUNT(CASE WHEN status = 'no_show' THEN 1 END)       AS no_shows,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END)     AS cancels
      FROM _svc_appointments
      WHERE business_id = ${esc(businessId)}
        AND customer_id = ${esc(customerId)}
        AND status IN ('completed','no_show','cancelled')
    `));
    const aggRows = (aggResult as any).rows ?? aggResult;
    const agg = Array.isArray(aggRows) ? aggRows[0] : {};

    const visitCount  = Number(agg?.visit_count ?? 0);
    const totalSpend  = parseFloat(agg?.total_spend ?? "0");
    const avgValue    = agg?.avg_value ? parseFloat(agg.avg_value) : null;
    const lastVisit   = agg?.last_visit;
    const firstVisit  = agg?.first_visit;
    const noShows     = Number(agg?.no_shows ?? 0);
    const cancels     = Number(agg?.cancels ?? 0);

    // Compute lifecycle + scores from partial customer
    const partialCustomer: Partial<ServiceCustomer> = {
      visitCount, totalSpend, lastVisitAt: lastVisit, noShowCount: noShows,
      cancellationCount: cancels,
    };
    const lifecycle    = resolveLifecycle(partialCustomer);
    const churnRisk    = scoreChurnRisk(partialCustomer);
    const upsellScore  = scoreUpsell(partialCustomer);

    await db.execute(sql.raw(`
      INSERT INTO _svc_customers
        (customer_id, business_id, phone, visit_count, total_spend, avg_visit_value,
         last_visit_at, first_visit_at, lifecycle, no_show_count, cancellation_count,
         churn_risk_score, upsell_score, updated_at)
      VALUES
        (${esc(customerId)}, ${esc(businessId)}, ${esc(appt.phone)},
         ${num(visitCount)}, ${num(totalSpend)}, ${num(avgValue)},
         ${lastVisit ? esc(new Date(lastVisit).toISOString()) : "NULL"},
         ${firstVisit ? esc(new Date(firstVisit).toISOString()) : "NULL"},
         ${esc(lifecycle)}, ${num(noShows)}, ${num(cancels)},
         ${num(churnRisk)}, ${num(upsellScore)}, NOW())
      ON CONFLICT (customer_id) DO UPDATE SET
        visit_count          = GREATEST(_svc_customers.visit_count, EXCLUDED.visit_count),
        total_spend          = GREATEST(_svc_customers.total_spend, EXCLUDED.total_spend),
        avg_visit_value      = COALESCE(EXCLUDED.avg_visit_value, _svc_customers.avg_visit_value),
        last_visit_at        = GREATEST(
          COALESCE(_svc_customers.last_visit_at, '1970-01-01'),
          COALESCE(EXCLUDED.last_visit_at, '1970-01-01')
        ),
        first_visit_at       = LEAST(
          COALESCE(_svc_customers.first_visit_at, NOW()),
          COALESCE(EXCLUDED.first_visit_at, NOW())
        ),
        lifecycle            = EXCLUDED.lifecycle,
        no_show_count        = GREATEST(_svc_customers.no_show_count, EXCLUDED.no_show_count),
        cancellation_count   = GREATEST(_svc_customers.cancellation_count, EXCLUDED.cancellation_count),
        churn_risk_score     = EXCLUDED.churn_risk_score,
        upsell_score         = EXCLUDED.upsell_score,
        updated_at           = NOW()
    `));
  } catch (err: any) {
    console.error("[SVC-APPT] Customer sync failed:", err?.message);
  }
}

// ── Query: at-risk customers ──────────────────────────────────────────────────

export async function getAtRiskCustomers(businessId: string, limit = 50): Promise<ServiceCustomer[]> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _svc_customers
      WHERE business_id = ${esc(businessId)}
        AND lifecycle IN ('at_risk', 'lapsed')
        AND opted_out = FALSE
      ORDER BY churn_risk_score DESC, last_visit_at ASC
      LIMIT ${num(limit)}
    `));
    const rows = (result as any).rows ?? result;
    return Array.isArray(rows) ? rows.map(mapCustomerRow) : [];
  } catch { return []; }
}

// ── Query: VIP customers ──────────────────────────────────────────────────────

export async function getVipCustomers(businessId: string, limit = 25): Promise<ServiceCustomer[]> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _svc_customers
      WHERE business_id = ${esc(businessId)}
        AND lifecycle = 'vip'
        AND opted_out = FALSE
      ORDER BY total_spend DESC, visit_count DESC
      LIMIT ${num(limit)}
    `));
    const rows = (result as any).rows ?? result;
    return Array.isArray(rows) ? rows.map(mapCustomerRow) : [];
  } catch { return []; }
}

// ── Appointment KPIs ──────────────────────────────────────────────────────────

export async function getAppointmentStats(businessId: string): Promise<{
  totalAppointments:  number;
  completedCount:     number;
  noShowCount:        number;
  cancellationCount:  number;
  noShowRatePct:      number;
  cancelRatePct:      number;
  totalRevenue:       number;
  avgValue:           number;
  activeCustomers:    number;
  atRiskCustomers:    number;
  lapsedCustomers:    number;
  vipCustomers:       number;
}> {
  await ensureTable();
  try {
    const [apptResult, custResult] = await Promise.all([
      db.execute(sql.raw(`
        SELECT
          COUNT(*)                                          AS total,
          COUNT(CASE WHEN status='completed' THEN 1 END)   AS completed,
          COUNT(CASE WHEN status='no_show' THEN 1 END)     AS no_show,
          COUNT(CASE WHEN status='cancelled' THEN 1 END)   AS cancelled,
          SUM(CASE WHEN status='completed' AND value IS NOT NULL THEN value ELSE 0 END) AS revenue,
          AVG(CASE WHEN status='completed' AND value IS NOT NULL THEN value END) AS avg_val
        FROM _svc_appointments
        WHERE business_id = ${esc(businessId)}
          AND scheduled_at >= NOW() - INTERVAL '90 days'
      `)),
      db.execute(sql.raw(`
        SELECT lifecycle, COUNT(*) AS n
        FROM _svc_customers
        WHERE business_id = ${esc(businessId)}
        GROUP BY lifecycle
      `)),
    ]);
    const ar = ((apptResult as any).rows ?? apptResult)?.[0] ?? {};
    const cr = (custResult as any).rows ?? custResult ?? [];

    const total     = Number(ar.total ?? 0);
    const completed = Number(ar.completed ?? 0);
    const noShow    = Number(ar.no_show ?? 0);
    const cancelled = Number(ar.cancelled ?? 0);

    const custByLifecycle: Record<string, number> = {};
    for (const r of (Array.isArray(cr) ? cr : [])) {
      custByLifecycle[r.lifecycle] = Number(r.n ?? 0);
    }

    return {
      totalAppointments:  total,
      completedCount:     completed,
      noShowCount:        noShow,
      cancellationCount:  cancelled,
      noShowRatePct:      total > 0 ? (noShow / total) * 100 : 0,
      cancelRatePct:      total > 0 ? (cancelled / total) * 100 : 0,
      totalRevenue:       parseFloat(ar.revenue ?? "0"),
      avgValue:           parseFloat(ar.avg_val ?? "0"),
      activeCustomers:    custByLifecycle["active"] ?? 0,
      atRiskCustomers:    custByLifecycle["at_risk"] ?? 0,
      lapsedCustomers:    custByLifecycle["lapsed"] ?? 0,
      vipCustomers:       custByLifecycle["vip"] ?? 0,
    };
  } catch {
    return {
      totalAppointments: 0, completedCount: 0, noShowCount: 0, cancellationCount: 0,
      noShowRatePct: 0, cancelRatePct: 0, totalRevenue: 0, avgValue: 0,
      activeCustomers: 0, atRiskCustomers: 0, lapsedCustomers: 0, vipCustomers: 0,
    };
  }
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function mapCustomerRow(r: any): ServiceCustomer {
  return {
    customerId:          r.customer_id,
    businessId:          r.business_id,
    phone:               r.phone ?? undefined,
    email:               r.email ?? undefined,
    firstName:           r.first_name ?? undefined,
    lastName:            r.last_name ?? undefined,
    lifecycle:           r.lifecycle,
    visitCount:          Number(r.visit_count ?? 0),
    totalSpend:          parseFloat(r.total_spend ?? "0"),
    avgVisitValue:       r.avg_visit_value ? parseFloat(r.avg_visit_value) : undefined,
    lastVisitAt:         r.last_visit_at?.toISOString?.() ?? undefined,
    firstVisitAt:        r.first_visit_at?.toISOString?.() ?? undefined,
    nextAppointmentAt:   r.next_appointment_at?.toISOString?.() ?? undefined,
    preferredService:    r.preferred_service ?? undefined,
    preferredStaff:      r.preferred_staff ?? undefined,
    isMember:            Boolean(r.is_member),
    membershipType:      r.membership_type ?? undefined,
    membershipExpires:   r.membership_expires?.toISOString?.() ?? undefined,
    packageBalance:      r.package_balance ?? undefined,
    loyaltyPoints:       r.loyalty_points ?? 0,
    noShowCount:         r.no_show_count ?? 0,
    cancellationCount:   r.cancellation_count ?? 0,
    reviewLeft:          Boolean(r.review_left),
    communicationPreference: r.communication_preference ?? "sms",
    optedOut:            Boolean(r.opted_out),
    churnRiskScore:      r.churn_risk_score ?? undefined,
    upsellScore:         r.upsell_score ?? undefined,
    createdAt:           r.created_at?.toISOString?.() ?? undefined,
    updatedAt:           r.updated_at?.toISOString?.() ?? undefined,
  };
}
