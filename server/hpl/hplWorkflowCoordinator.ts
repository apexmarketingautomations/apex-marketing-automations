/**
 * server/hpl/hplWorkflowCoordinator.ts
 *
 * HPL Workflow Coordinator — Contractor Automation Scaffolding
 *
 * Manages contractor-specific automation workflows:
 *   - Missed call text-back (fires when missed_call signal received)
 *   - Estimate follow-up (fires 24h after estimate sent, no response)
 *   - Appointment reminder (fires 2h before scheduled appointment)
 *   - Review request (fires 48h after job marked complete)
 *   - Abandoned estimate reactivation (fires 7 days after estimate abandoned)
 *   - Storm outreach campaign (fires on high-score storm event in service area)
 *   - New lead notification (fires immediately on lead routing)
 *   - Lead expiry warning (fires 4h before lead expires unclaimed)
 *
 * SAFETY: All communication workflows produce DRAFTS only.
 * Actual sending goes through sendSms (with TCPA gate) or email queue.
 * Workflows never send without explicit operator trigger.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, isoDate } from "./sqlSafe";
import type { ContractorWorkflowType, ServiceTrade, StormEvent } from "./types";

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _hpl_workflow_queue (
        id                  SERIAL PRIMARY KEY,
        workflow_type       TEXT        NOT NULL,
        contractor_id       INTEGER,
        sub_account_id      INTEGER,
        lead_id             INTEGER,
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
      CREATE INDEX IF NOT EXISTS hpl_wf_contractor_idx ON _hpl_workflow_queue (contractor_id, status);
      CREATE INDEX IF NOT EXISTS hpl_wf_scheduled_idx  ON _hpl_workflow_queue (scheduled_at, status);
      CREATE INDEX IF NOT EXISTS hpl_wf_type_idx       ON _hpl_workflow_queue (workflow_type, status);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[HPL-WORKFLOW] Failed to ensure table:", err?.message);
  }
}

// ── Workflow definitions ──────────────────────────────────────────────────────

interface WorkflowConfig {
  type: ContractorWorkflowType;
  delayMs: number;
  approvalRequired: true;
  draftTemplate: string;
  description: string;
}

const WORKFLOW_CONFIGS: Record<ContractorWorkflowType, WorkflowConfig> = {
  missed_call_textback: {
    type: "missed_call_textback",
    delayMs: 2 * 60 * 1000,
    approvalRequired: true,
    draftTemplate: "Hi {{ownerName}}, sorry we missed your call! We're {{businessName}} and would love to help with your {{trade}} needs. Can we call you back at a better time? Reply STOP to opt out.",
    description: "Text-back after a missed inbound call",
  },
  estimate_followup: {
    type: "estimate_followup",
    delayMs: 24 * 3_600_000,
    approvalRequired: true,
    draftTemplate: "Hi {{ownerName}}, this is {{businessName}}. Just following up on the estimate we sent for your {{trade}} project. Any questions? We're happy to adjust or schedule a walkthrough. Reply STOP to opt out.",
    description: "Follow up 24h after estimate with no response",
  },
  appointment_reminder: {
    type: "appointment_reminder",
    delayMs: -2 * 3_600_000,
    approvalRequired: true,
    draftTemplate: "Reminder: {{businessName}} is scheduled to arrive at {{appointmentTime}} today for your {{trade}} service. Reply STOP to opt out.",
    description: "Appointment reminder 2 hours before scheduled time",
  },
  review_request: {
    type: "review_request",
    delayMs: 48 * 3_600_000,
    approvalRequired: true,
    draftTemplate: "Hi {{ownerName}}, thank you for choosing {{businessName}}! We hope your {{trade}} project turned out great. Would you mind leaving us a quick review? {{reviewLink}} Reply STOP to opt out.",
    description: "Review request 48h after job marked complete",
  },
  abandoned_estimate: {
    type: "abandoned_estimate",
    delayMs: 7 * 24 * 3_600_000,
    approvalRequired: true,
    draftTemplate: "Hi {{ownerName}}, we wanted to check in about the {{trade}} estimate we sent last week. Are you still interested? We can match competitor pricing or answer any questions. Reply STOP to opt out.",
    description: "Reactivate abandoned estimate after 7 days",
  },
  storm_outreach: {
    type: "storm_outreach",
    delayMs: 4 * 3_600_000,
    approvalRequired: true,
    draftTemplate: "Hi {{ownerName}}, {{businessName}} here. We noticed a storm recently hit {{county}}. If your {{trade}} was affected, we offer free inspections. Call us or reply here to schedule. Reply STOP to opt out.",
    description: "Storm outreach to properties in affected area",
  },
  new_lead_notification: {
    type: "new_lead_notification",
    delayMs: 0,
    approvalRequired: true,
    draftTemplate: "New {{trade}} lead in {{county}}: {{address}}. Score: {{score}}/100. Expires: {{expiresAt}}. Claim now in your dashboard.",
    description: "Internal notification to contractor on new lead routing",
  },
  lead_expiry_warning: {
    type: "lead_expiry_warning",
    delayMs: 0,
    approvalRequired: true,
    draftTemplate: "Lead expiry warning: {{county}} {{trade}} lead expires in 4 hours. Claim it now in your dashboard before it goes to another contractor.",
    description: "Warning 4 hours before unclaimed lead expires",
  },
  seasonal_campaign: {
    type: "seasonal_campaign",
    delayMs: 0,
    approvalRequired: true,
    draftTemplate: "Hi {{ownerName}}, as we head into {{season}}, now is a great time to schedule your {{trade}} maintenance with {{businessName}}. Reply STOP to opt out.",
    description: "Seasonal outreach campaign",
  },
};

// ── Enqueue workflow ──────────────────────────────────────────────────────────

export interface EnqueueWorkflowOptions {
  workflowType: ContractorWorkflowType;
  contractorId?: number;
  subAccountId?: number;
  leadId?: number;
  triggerData?: Record<string, unknown>;
  scheduledAt?: Date;
}

export async function enqueueWorkflow(opts: EnqueueWorkflowOptions): Promise<number | undefined> {
  await ensureTable();

  const config = WORKFLOW_CONFIGS[opts.workflowType];
  if (!config) {
    console.warn(`[HPL-WORKFLOW] Unknown workflow type: ${opts.workflowType}`);
    return undefined;
  }

  const scheduledAt = opts.scheduledAt
    ?? new Date(Date.now() + Math.max(0, config.delayMs));

  const triggerJson = JSON.stringify(opts.triggerData ?? {}).replace(/'/g, "''");

  try {
    const result = await db.execute(sql.raw(`
      INSERT INTO _hpl_workflow_queue
        (workflow_type, contractor_id, sub_account_id, lead_id, trigger_data, scheduled_at, approval_required)
      VALUES
        (${esc(opts.workflowType)},
         ${num(opts.contractorId)},
         ${num(opts.subAccountId)},
         ${num(opts.leadId)},
         '${triggerJson}'::jsonb,
         ${isoDate(scheduledAt.toISOString())},
         TRUE)
      RETURNING id
    `));
    const rows = (result as any).rows ?? result;
    const id = Array.isArray(rows) && rows[0]?.id ? Number(rows[0].id) : undefined;
    console.log(`[HPL-WORKFLOW] Enqueued ${opts.workflowType} — id=${id} scheduledAt=${scheduledAt.toISOString()}`);
    return id;
  } catch (err: any) {
    console.error("[HPL-WORKFLOW] Enqueue failed:", err?.message);
    return undefined;
  }
}

// ── Storm workflow trigger ────────────────────────────────────────────────────

export async function triggerStormOutreachWorkflows(
  event: StormEvent,
  affectedContractorIds: number[],
): Promise<{ enqueued: number }> {
  let enqueued = 0;
  for (const contractorId of affectedContractorIds) {
    const id = await enqueueWorkflow({
      workflowType: "storm_outreach",
      contractorId,
      triggerData: {
        eventId:   event.eventId,
        eventType: event.eventType,
        county:    event.county,
        score:     event.opportunityScore,
        trades:    event.primaryTrades,
      },
    });
    if (id) enqueued++;
  }
  return { enqueued };
}

// ── Lead notification workflow ────────────────────────────────────────────────

export async function triggerLeadNotificationWorkflows(
  leadId: number,
  contractorIds: number[],
  leadData: { county: string; address?: string; score?: number; trade?: string; expiresAt?: string },
): Promise<{ enqueued: number }> {
  let enqueued = 0;
  for (const contractorId of contractorIds) {
    const id = await enqueueWorkflow({
      workflowType: "new_lead_notification",
      contractorId,
      leadId,
      triggerData: leadData,
    });
    if (id) enqueued++;
  }
  return { enqueued };
}

// ── Pending workflows query ───────────────────────────────────────────────────

export interface PendingWorkflow {
  id: number;
  workflowType: ContractorWorkflowType;
  contractorId?: number;
  subAccountId?: number;
  leadId?: number;
  triggerData: Record<string, unknown>;
  scheduledAt: string;
  approvalRequired: boolean;
}

export async function getPendingWorkflows(opts: {
  contractorId?: number;
  subAccountId?: number;
  type?: ContractorWorkflowType;
  limit?: number;
} = {}): Promise<PendingWorkflow[]> {
  await ensureTable();
  const conditions = [`status = 'pending'`, `scheduled_at <= NOW() + INTERVAL '5 minutes'`];
  if (opts.contractorId) conditions.push(`contractor_id = ${opts.contractorId}`);
  if (opts.subAccountId) conditions.push(`sub_account_id = ${opts.subAccountId}`);
  if (opts.type)         conditions.push(`workflow_type = '${opts.type}'`);
  const where = `WHERE ${conditions.join(" AND ")}`;
  const limit = opts.limit ?? 50;
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _hpl_workflow_queue ${where}
      ORDER BY scheduled_at ASC LIMIT ${limit}
    `));
    const rows = (result as any).rows ?? result;
    return Array.isArray(rows) ? rows.map((r: any) => ({
      id:               Number(r.id),
      workflowType:     r.workflow_type as ContractorWorkflowType,
      contractorId:     r.contractor_id ?? undefined,
      subAccountId:     r.sub_account_id ?? undefined,
      leadId:           r.lead_id ?? undefined,
      triggerData:      typeof r.trigger_data === "object" ? r.trigger_data : {},
      scheduledAt:      r.scheduled_at instanceof Date ? r.scheduled_at.toISOString() : String(r.scheduled_at),
      approvalRequired: Boolean(r.approval_required),
    })) : [];
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}

// ── Workflow stats ────────────────────────────────────────────────────────────

export async function getWorkflowStats(): Promise<{
  pending: number;
  executed: number;
  byType: Record<string, number>;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        workflow_type,
        status,
        COUNT(*) AS n
      FROM _hpl_workflow_queue
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY workflow_type, status
    `));
    const rows = (result as any).rows ?? result;
    if (!Array.isArray(rows)) return { pending: 0, executed: 0, byType: {} };

    let pending = 0;
    let executed = 0;
    const byType: Record<string, number> = {};

    for (const r of rows) {
      const n = Number(r.n);
      if (r.status === "pending")   pending   += n;
      if (r.status === "executed")  executed  += n;
      byType[r.workflow_type] = (byType[r.workflow_type] ?? 0) + n;
    }

    return { pending, executed, byType };
  } catch { return { pending: 0, executed: 0, byType: {} }; }  // allow-silent-catch: non-fatal, returns safe default
}
