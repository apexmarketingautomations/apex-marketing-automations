/**
 * server/insurance/insuranceWorkflowCoordinator.ts
 *
 * Insurance Workflow Coordinator
 *
 * Approval-gated communication scaffolding for insurance workflows.
 * All workflows produce DRAFTS only — no auto-send path exists.
 *
 * Workflow types:
 *   - new_opportunity_alert       — immediate alert to agency on new opportunity
 *   - storm_claim_outreach        — post-storm outreach draft (delay 2-24h by type)
 *   - quote_followup              — 48h after quote sent, no response
 *   - policy_renewal_reminder     — 30 days before renewal
 *   - bundle_recommendation       — triggered on bundling opportunity detection
 *   - commercial_outreach         — new commercial risk detected
 *   - high_risk_placement         — crash/DUI placement opportunity
 *   - lapse_reactivation          — policy lapse indicator detected
 *   - roof_replacement_timing     — roof 15+ years + storm exposure
 *   - homeowner_welcome           — new property purchase detected
 *
 * SAFETY: approval_required = TRUE hardcoded at INSERT level.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, isoDate, bool } from "../hpl/sqlSafe";
import type { InsuranceWorkflowType, InsuranceLine } from "./types";

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _ins_workflow_queue (
        id                  SERIAL PRIMARY KEY,
        workflow_type       TEXT        NOT NULL,
        agency_id           INTEGER,
        sub_account_id      INTEGER,
        household_id        TEXT,
        opportunity_id      TEXT,
        insurance_line      TEXT,
        trigger_data        JSONB       DEFAULT '{}',
        status              TEXT        NOT NULL DEFAULT 'pending',
        scheduled_at        TIMESTAMPTZ NOT NULL,
        executed_at         TIMESTAMPTZ,
        draft_content       TEXT,
        approval_required   BOOLEAN     NOT NULL DEFAULT TRUE,
        approved_at         TIMESTAMPTZ,
        approved_by         TEXT,
        error_message       TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ins_wf_agency_idx    ON _ins_workflow_queue (agency_id, status);
      CREATE INDEX IF NOT EXISTS ins_wf_scheduled_idx ON _ins_workflow_queue (scheduled_at, status);
      CREATE INDEX IF NOT EXISTS ins_wf_type_idx      ON _ins_workflow_queue (workflow_type, status);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[INS-WORKFLOW] Failed to ensure table:", err?.message);
  }
}

// ── Workflow configs ──────────────────────────────────────────────────────────

interface InsuranceWorkflowConfig {
  type: InsuranceWorkflowType;
  delayMs: number;
  approvalRequired: true;
  draftTemplate: string;
  description: string;
}

const WORKFLOW_CONFIGS: Record<InsuranceWorkflowType, InsuranceWorkflowConfig> = {
  new_opportunity_alert: {
    type: "new_opportunity_alert",
    delayMs: 0,
    approvalRequired: true,
    draftTemplate: "New {{insuranceLine}} opportunity: {{opportunityType}} in {{county}}. Score: {{score}}/100. Household: {{primaryName}} — {{phone}}. Review and contact in your dashboard.",
    description: "Immediate alert to agency on new scored opportunity",
  },
  storm_claim_outreach: {
    type: "storm_claim_outreach",
    delayMs: 4 * 3_600_000,
    approvalRequired: true,
    draftTemplate: "Hi {{primaryName}}, we noticed a {{stormType}} recently impacted {{county}}. As a homeowner, you may have coverage for damage. Would you like a free policy review? Reply STOP to opt out.",
    description: "Post-storm outreach to homeowners in affected area",
  },
  quote_followup: {
    type: "quote_followup",
    delayMs: 48 * 3_600_000,
    approvalRequired: true,
    draftTemplate: "Hi {{primaryName}}, just following up on the {{insuranceLine}} quote we prepared for you. Any questions? We can adjust coverage or schedule a call. Reply STOP to opt out.",
    description: "48h follow-up after quote with no response",
  },
  policy_renewal_reminder: {
    type: "policy_renewal_reminder",
    delayMs: 0,
    approvalRequired: true,
    draftTemplate: "Hi {{primaryName}}, your {{insuranceLine}} policy renews on {{renewalDate}}. Let's review your coverage to make sure you're still getting the best rate. Reply STOP to opt out.",
    description: "30-day renewal reminder",
  },
  bundle_recommendation: {
    type: "bundle_recommendation",
    delayMs: 0,
    approvalRequired: true,
    draftTemplate: "Hi {{primaryName}}, did you know bundling your home and auto insurance can save you up to 15%? We'd love to show you the savings. Reply STOP to opt out.",
    description: "Bundle home+auto recommendation on detection",
  },
  commercial_outreach: {
    type: "commercial_outreach",
    delayMs: 2 * 3_600_000,
    approvalRequired: true,
    draftTemplate: "Hi {{ownerName}}, congratulations on your business! As a {{businessType}} owner in {{county}}, you may need General Liability, Workers Comp, or a Business Owner Policy. We can help. Reply STOP to opt out.",
    description: "Commercial risk opportunity outreach",
  },
  high_risk_placement: {
    type: "high_risk_placement",
    delayMs: 60 * 60 * 1000,
    approvalRequired: true,
    draftTemplate: "Hi {{primaryName}}, we specialize in high-risk {{insuranceLine}} coverage and can often find better rates than standard carriers. Give us a call — we're here to help. Reply STOP to opt out.",
    description: "High-risk auto / SR-22 placement opportunity",
  },
  lapse_reactivation: {
    type: "lapse_reactivation",
    delayMs: 0,
    approvalRequired: true,
    draftTemplate: "Hi {{primaryName}}, we noticed you may have a gap in your {{insuranceLine}} coverage. We can help get you covered quickly — often same day. Reply STOP to opt out.",
    description: "Policy lapse reactivation opportunity",
  },
  roof_replacement_timing: {
    type: "roof_replacement_timing",
    delayMs: 24 * 3_600_000,
    approvalRequired: true,
    draftTemplate: "Hi {{primaryName}}, your home's roof may be approaching the age where insurance carriers require updates or increase premiums. A free inspection could protect your coverage. Reply STOP to opt out.",
    description: "Roof age 15y+ with storm exposure — coverage timing alert",
  },
  homeowner_welcome: {
    type: "homeowner_welcome",
    delayMs: 6 * 3_600_000,
    approvalRequired: true,
    draftTemplate: "Welcome to your new home at {{address}}, {{primaryName}}! As a new homeowner in {{county}}, make sure you have the right coverage — we can help compare rates. Reply STOP to opt out.",
    description: "New property purchase welcome and coverage check",
  },
};

// ── Enqueue ───────────────────────────────────────────────────────────────────

export interface EnqueueInsuranceWorkflowOptions {
  workflowType: InsuranceWorkflowType;
  agencyId?: number;
  subAccountId?: number;
  householdId?: string;
  opportunityId?: string;
  insuranceLine?: InsuranceLine;
  triggerData?: Record<string, unknown>;
  scheduledAt?: Date;
}

export async function enqueueInsuranceWorkflow(opts: EnqueueInsuranceWorkflowOptions): Promise<number | undefined> {
  await ensureTable();
  const config = WORKFLOW_CONFIGS[opts.workflowType];
  if (!config) return undefined;

  const scheduledAt = opts.scheduledAt ?? new Date(Date.now() + Math.max(0, config.delayMs));
  const triggerJson = JSON.stringify(opts.triggerData ?? {}).replace(/'/g, "''");

  try {
    const result = await db.execute(sql.raw(`
      INSERT INTO _ins_workflow_queue
        (workflow_type, agency_id, sub_account_id, household_id, opportunity_id,
         insurance_line, trigger_data, scheduled_at, approval_required)
      VALUES
        (${esc(opts.workflowType)},
         ${num(opts.agencyId)},
         ${num(opts.subAccountId)},
         ${esc(opts.householdId)},
         ${esc(opts.opportunityId)},
         ${esc(opts.insuranceLine)},
         '${triggerJson}'::jsonb,
         ${isoDate(scheduledAt.toISOString())},
         TRUE)
      RETURNING id
    `));
    const rows = (result as any).rows ?? result;
    const id = Array.isArray(rows) && rows[0]?.id ? Number(rows[0].id) : undefined;
    console.log(`[INS-WORKFLOW] Enqueued ${opts.workflowType} — id=${id}`);
    return id;
  } catch (err: any) {
    console.error("[INS-WORKFLOW] Enqueue failed:", err?.message);
    return undefined;
  }
}

// ── Pending query ─────────────────────────────────────────────────────────────

export async function getPendingInsuranceWorkflows(opts: {
  agencyId?: number;
  type?: InsuranceWorkflowType;
  limit?: number;
} = {}): Promise<any[]> {
  await ensureTable();
  const conditions = [`status = 'pending'`, `scheduled_at <= NOW() + INTERVAL '5 minutes'`];
  if (opts.agencyId) conditions.push(`agency_id = ${opts.agencyId}`);
  if (opts.type)     conditions.push(`workflow_type = ${esc(opts.type)}`);
  const where = `WHERE ${conditions.join(" AND ")}`;
  const limit = opts.limit ?? 50;
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _ins_workflow_queue ${where}
      ORDER BY scheduled_at ASC LIMIT ${limit}
    `));
    return (result as any).rows ?? result ?? [];
  } catch { return []; }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getInsuranceWorkflowStats(): Promise<{
  pending: number;
  executed: number;
  byType: Record<string, number>;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT workflow_type, status, COUNT(*) AS n
      FROM _ins_workflow_queue
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY workflow_type, status
    `));
    const rows = (result as any).rows ?? result;
    let pending = 0, executed = 0;
    const byType: Record<string, number> = {};
    for (const r of (Array.isArray(rows) ? rows : [])) {
      const n = Number(r.n);
      if (r.status === "pending")  pending  += n;
      if (r.status === "executed") executed += n;
      byType[r.workflow_type] = (byType[r.workflow_type] ?? 0) + n;
    }
    return { pending, executed, byType };
  } catch { return { pending: 0, executed: 0, byType: {} }; }
}
