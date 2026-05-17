/**
 * server/newResident/newResidentWorkflowCoordinator.ts
 *
 * New Resident Workflow Coordinator (Phase 9A)
 *
 * Purpose:
 *   Coordinate approval-gated outreach workflow drafts for newly detected
 *   residents. Integrates with the Phase 10 communications safety layer.
 *
 * Absolute rules:
 *   - NO auto-send execution paths
 *   - ALL workflows require approval (named human approver, ≥2 chars)
 *   - Suppression check before every draft creation
 *   - Quiet hours enforced (8 PM–9 AM)
 *   - Max 1 workflow draft per household per 14 days
 *   - All drafts route through the Phase 10 approval engine
 *   - Audit trail written at every state change
 */

import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool } from "../hpl/sqlSafe";
import type { ResidentWorkflowDraft, ResidentWorkflowType } from "./types";
import { checkResidentSuppression, isInResidentQuietHours, validateApprovalActor, logComplianceDecision } from "./residentComplianceGuard";

// ── ID builder ─────────────────────────────────────────────────────────────────

function buildDraftId(householdId: string, workflowType: string, ts: string): string {
  const raw = `nr_workflow|${householdId}|${workflowType}|${ts}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── Message template library ──────────────────────────────────────────────────

const WORKFLOW_TEMPLATES: Record<ResidentWorkflowType, (vars: Record<string, string>) => string[]> = {
  homeowner_welcome: ({ businessName, zip }) => [
    `Welcome to the neighborhood! ${businessName} is right here in ${zip ?? "your area"} — we'd love to help you settle in. What can we do for you?`,
    `Hi neighbor! We noticed you recently moved in and wanted to say welcome. ${businessName} is your local go-to for home needs. Let us know how we can help!`,
    `Congrats on the new home! ${businessName} is nearby and ready to help with anything you need as you get settled.`,
  ],
  local_service_introduction: ({ businessName }) => [
    `Hi! We're ${businessName}, a local business in your neighborhood. We'd love to welcome you and introduce our services. Feel free to reach out!`,
    `Welcome to the area! ${businessName} is just around the corner. We'd love to be your go-to for [service]. Come say hello anytime.`,
    `Hey neighbor! ${businessName} here — we're local and love serving our community. Let us know if we can be of service!`,
  ],
  salon_barber_intro: ({ businessName }) => [
    `Welcome to the neighborhood! ${businessName} is a local salon/barbershop nearby and we'd love to be your new go-to. We're welcoming new clients!`,
    `Hi! Moving to a new area means finding a new stylist — ${businessName} is right here. We'd love to introduce ourselves and make you feel at home.`,
    `Congrats on the new address! ${businessName} is nearby and specializes in making locals look and feel great. We'd love to meet you!`,
  ],
  insurance_onboarding: ({ businessName }) => [
    `Hi! Moving means your insurance needs may have changed. ${businessName} specializes in homeowner and auto policies and we'd love to make sure you're fully covered.`,
    `Welcome to the neighborhood! ${businessName} is a local insurance agency ready to help you review your coverage in your new home. No pressure — just a quick check.`,
    `Congrats on the new home! Homeowner's insurance is one of the first things to sort out. ${businessName} is local and can walk you through your options.`,
  ],
  lawn_care_intro: ({ businessName }) => [
    `Welcome! ${businessName} provides local lawn care and landscaping. We'd love to give you a complimentary estimate as you get your new yard set up.`,
    `Hi neighbor! Getting a new home's outdoor space just right takes work. ${businessName} is local and ready to help — free estimates for new residents.`,
    `Congrats on the new place! ${businessName} offers lawn care, landscaping, and outdoor maintenance for homes in your area. Let's make your yard look great.`,
  ],
  hvac_inspection_offer: ({ businessName }) => [
    `Welcome home! ${businessName} offers HVAC inspections for new homeowners — it's smart to know the state of your system before the next season hits.`,
    `Hi! Moving into a new home? ${businessName} recommends a free HVAC check to make sure your system is running efficiently. We're local and available soon.`,
    `Congrats on the new home! ${businessName} is a trusted HVAC service in your area. New homeowners often find it valuable to schedule an inspection — no obligation.`,
  ],
  local_restaurant_offer: ({ businessName }) => [
    `Welcome to the neighborhood! ${businessName} is a local restaurant nearby — we'd love to be your new go-to for a great meal. Come check us out!`,
    `Hi new neighbor! Finding a great local restaurant is one of the best parts of moving. ${businessName} is right here and we'd love to welcome you.`,
    `Welcome! ${businessName} is a neighborhood favorite. Stop by and introduce yourself — we love meeting our new neighbors!`,
  ],
  neighborhood_welcome_package: ({ businessName }) => [
    `Welcome to the neighborhood from ${businessName}! We're putting together a local welcome guide — reach out and we'll share some great local recommendations.`,
    `Hi neighbor! ${businessName} would love to help you discover the best our community has to offer. We have a welcome package for new residents.`,
    `Congrats on the move! ${businessName} is a local business that loves our community. We'd love to help you get oriented with a neighborhood welcome guide.`,
  ],
  contractor_intro: ({ businessName }) => [
    `Welcome to your new home! ${businessName} is a licensed local contractor. If you're planning any renovations or repairs, we'd love to give you a free estimate.`,
    `Hi! New home, new projects? ${businessName} provides local contracting services and specializes in helping new homeowners make their space their own.`,
    `Congrats on the new place! ${businessName} is your neighborhood contractor for renovations, repairs, and improvements. No job too small — free estimates always.`,
  ],
  home_security_intro: ({ businessName }) => [
    `Welcome to the neighborhood! ${businessName} helps local homeowners protect their homes with modern security solutions. We offer free consultations for new residents.`,
    `Hi neighbor! Moving into a new home is a great time to evaluate your security setup. ${businessName} is local and offers straightforward home security solutions.`,
    `Congrats on the new home! ${businessName} specializes in home security for our local area. We'd love to give you a complimentary security review.`,
  ],
  cleaning_service_intro: ({ businessName }) => [
    `Welcome home! ${businessName} offers professional cleaning services in your area. Moving is stressful — let us handle the cleaning so you can focus on settling in.`,
    `Hi neighbor! ${businessName} is a trusted local cleaning service. We'd love to offer you a move-in cleaning special to get your new home sparkling.`,
    `Congrats on the move! ${businessName} provides reliable home cleaning services nearby. New clients receive a special welcome rate.`,
  ],
  insurance_bundle_offer: ({ businessName }) => [
    `Welcome to the neighborhood! ${businessName} specializes in bundling home and auto insurance — many new homeowners save significantly. We'd love to do a quick review.`,
    `Hi! Moving is a great time to review your insurance bundle. ${businessName} can compare home + auto options for your new address and often finds savings.`,
    `Congrats on the new home! ${businessName} helps homeowners bundle their coverage and save. It takes about 15 minutes and there's no obligation.`,
  ],
  custom_outreach: ({ businessName, contextSummary }) => [
    `Welcome to the neighborhood! ${businessName} is a local business and we'd love to connect. ${contextSummary ?? "Reach out anytime!"}`,
    `Hi neighbor! ${businessName} here — ${contextSummary ?? "we're local and love serving our community."}`,
    `Welcome! ${businessName} is nearby and we'd love to introduce ourselves. ${contextSummary ?? "How can we help?"}`,
  ],
};

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _nr_workflow_drafts (
        id                SERIAL PRIMARY KEY,
        draft_id          TEXT NOT NULL UNIQUE,
        resident_event_id TEXT NOT NULL,
        household_id      TEXT NOT NULL,
        tenant_id         TEXT NOT NULL,
        workflow_type     TEXT NOT NULL,
        channel           TEXT NOT NULL DEFAULT 'sms',
        message_options   JSONB NOT NULL DEFAULT '[]',
        scheduled_window  TEXT NOT NULL DEFAULT '9AM-5PM local',
        status            TEXT NOT NULL DEFAULT 'pending',
        approved_by       TEXT,
        approved_at       TIMESTAMPTZ,
        suppression_reason TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS nr_drafts_tenant_idx    ON _nr_workflow_drafts (tenant_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS nr_drafts_household_idx ON _nr_workflow_drafts (household_id, tenant_id);
      CREATE INDEX IF NOT EXISTS nr_drafts_pending_idx   ON _nr_workflow_drafts (status, created_at DESC) WHERE status='pending';
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[NR-WORKFLOW] Failed to ensure tables:", err?.message);
  }
}

// ── Create workflow draft ─────────────────────────────────────────────────────

export async function createResidentWorkflowDraft(opts: {
  residentEventId:  string;
  householdId:      string;
  tenantId:         string;
  workflowType:     ResidentWorkflowType;
  channel?:         ResidentWorkflowDraft["channel"];
  businessName:     string;
  zip?:             string;
  county?:          string;
  contextSummary?:  string;
}): Promise<{
  draftId:          string;
  messageOptions:   string[];
  suppressed:       boolean;
  suppressionReason?: string;
  quietHours:       boolean;
}> {
  await ensureTable();

  // 1. Suppression check
  const suppressed = await checkResidentSuppression({
    zip:      opts.zip,
    county:   opts.county,
    tenantId: opts.tenantId,
  });
  if (suppressed) {
    await logComplianceDecision({
      tenantId: opts.tenantId,
      eventType: "workflow_draft_blocked",
      decision: "suppressed",
      reason: "Address/ZIP/county is suppressed",
      context: { householdId: opts.householdId, workflowType: opts.workflowType },
    });
    return { draftId: "", messageOptions: [], suppressed: true, suppressionReason: "suppressed", quietHours: false };
  }

  // 2. Quiet hours check (still creates draft, but flags it)
  const quietHours = isInResidentQuietHours();

  // 3. Dedup: max 1 draft per household per 14 days
  const dedupResult = await db.execute(sql.raw(`
    SELECT 1 FROM _nr_workflow_drafts
    WHERE household_id = ${esc(opts.householdId)} AND tenant_id = ${esc(opts.tenantId)}
      AND created_at >= NOW() - INTERVAL '14 days'
    LIMIT 1
  `));
  const dedupRows = (dedupResult as any).rows ?? dedupResult;
  if (Array.isArray(dedupRows) && dedupRows.length > 0) {
    return { draftId: "", messageOptions: [], suppressed: false, quietHours, suppressionReason: "duplicate_14d" };
  }

  // 4. Generate message options
  const templateFn = WORKFLOW_TEMPLATES[opts.workflowType] ?? WORKFLOW_TEMPLATES.custom_outreach;
  const messageOptions = templateFn({
    businessName:   opts.businessName,
    zip:            opts.zip ?? "",
    county:         opts.county ?? "",
    contextSummary: opts.contextSummary ?? "",
  });

  const ts      = new Date().toISOString();
  const draftId = buildDraftId(opts.householdId, opts.workflowType, ts);

  await db.execute(sql.raw(`
    INSERT INTO _nr_workflow_drafts (
      draft_id, resident_event_id, household_id, tenant_id,
      workflow_type, channel, message_options, status
    ) VALUES (
      ${esc(draftId)}, ${esc(opts.residentEventId)}, ${esc(opts.householdId)}, ${esc(opts.tenantId)},
      ${esc(opts.workflowType)}, ${esc(opts.channel ?? "sms")},
      ${esc(JSON.stringify(messageOptions))}, 'pending'
    )
    ON CONFLICT (draft_id) DO NOTHING
  `));

  await logComplianceDecision({
    tenantId: opts.tenantId,
    eventType: "workflow_draft_created",
    decision: "allowed",
    context: { draftId, workflowType: opts.workflowType, quietHours },
  });

  console.log(`[NR-WORKFLOW] Draft created: ${draftId} type=${opts.workflowType} quietHours=${quietHours}`);
  return { draftId, messageOptions, suppressed: false, quietHours };
}

// ── Approve draft ─────────────────────────────────────────────────────────────

export async function approveResidentWorkflowDraft(opts: {
  draftId:    string;
  tenantId:   string;
  approvedBy: string;
}): Promise<void> {
  const { valid, reason } = validateApprovalActor(opts.approvedBy);
  if (!valid) throw new Error(`Approval actor invalid: ${reason}`);

  await ensureTable();
  await db.execute(sql.raw(`
    UPDATE _nr_workflow_drafts
    SET status = 'approved', approved_by = ${esc(opts.approvedBy)}, approved_at = NOW()
    WHERE draft_id = ${esc(opts.draftId)} AND tenant_id = ${esc(opts.tenantId)} AND status = 'pending'
  `));

  await logComplianceDecision({
    tenantId: opts.tenantId,
    eventType: "workflow_draft_approved",
    decision: "allowed",
    context: { draftId: opts.draftId, approvedBy: opts.approvedBy },
  });
}

// ── Reject draft ──────────────────────────────────────────────────────────────

export async function rejectResidentWorkflowDraft(opts: {
  draftId:   string;
  tenantId:  string;
  rejectedBy: string;
  reason?:   string;
}): Promise<void> {
  const { valid, reason: actorErr } = validateApprovalActor(opts.rejectedBy);
  if (!valid) throw new Error(`Rejection actor invalid: ${actorErr}`);

  await db.execute(sql.raw(`
    UPDATE _nr_workflow_drafts
    SET status = 'rejected', suppression_reason = ${esc(opts.reason ?? "rejected_by_reviewer")}
    WHERE draft_id = ${esc(opts.draftId)} AND tenant_id = ${esc(opts.tenantId)} AND status = 'pending'
  `));

  await logComplianceDecision({
    tenantId: opts.tenantId,
    eventType: "workflow_draft_rejected",
    decision: "blocked",
    reason: opts.reason,
    context: { draftId: opts.draftId, rejectedBy: opts.rejectedBy },
  });
}

// ── Query drafts ──────────────────────────────────────────────────────────────

export async function getPendingWorkflowDrafts(tenantId: string, limit = 50): Promise<ResidentWorkflowDraft[]> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _nr_workflow_drafts
      WHERE tenant_id = ${esc(tenantId)} AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT ${num(limit)}
    `));
    return ((result as any).rows ?? result ?? []).map(mapDraftRow);
  } catch { return []; }
}

export async function getWorkflowDraftStats(tenantId: string): Promise<{
  pending: number;
  approved: number;
  rejected: number;
  suppressed: number;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(CASE WHEN status='pending' THEN 1 END) AS pending,
        COUNT(CASE WHEN status='approved' THEN 1 END) AS approved,
        COUNT(CASE WHEN status='rejected' THEN 1 END) AS rejected,
        COUNT(CASE WHEN status='suppressed' THEN 1 END) AS suppressed
      FROM _nr_workflow_drafts
      WHERE tenant_id = ${esc(tenantId)} AND created_at >= NOW()-INTERVAL '30 days'
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : {};
    return {
      pending:   Number(r?.pending ?? 0),
      approved:  Number(r?.approved ?? 0),
      rejected:  Number(r?.rejected ?? 0),
      suppressed: Number(r?.suppressed ?? 0),
    };
  } catch { return { pending: 0, approved: 0, rejected: 0, suppressed: 0 }; }
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function mapDraftRow(r: any): ResidentWorkflowDraft {
  let options: string[] = [];
  try { options = typeof r.message_options === "string" ? JSON.parse(r.message_options) : r.message_options ?? []; } catch {}
  return {
    draftId:          r.draft_id,
    residentEventId:  r.resident_event_id,
    householdId:      r.household_id,
    tenantId:         r.tenant_id,
    workflowType:     r.workflow_type,
    channel:          r.channel ?? "sms",
    messageOptions:   options,
    scheduledWindow:  r.scheduled_window ?? "9AM-5PM local",
    status:           r.status,
    approvedBy:       r.approved_by || undefined,
    approvedAt:       r.approved_at?.toISOString?.() ?? undefined,
    suppressionReason: r.suppression_reason || undefined,
    createdAt:        r.created_at?.toISOString?.() ?? new Date().toISOString(),
  };
}
