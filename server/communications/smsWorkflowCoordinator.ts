/**
 * server/communications/smsWorkflowCoordinator.ts
 *
 * SMS Workflow Coordinator
 *
 * Deterministic SMS scheduling and execution across all verticals.
 * All sends route through: safety → approval (if required) → send → timeline.
 *
 * Supported workflow types:
 *   lead_followup, missed_call_recovery, appointment_reminder,
 *   appointment_confirmation, estimate_followup, review_request,
 *   reactivation, insurance_outreach, contractor_outreach,
 *   legal_intake, retention_campaign, loyalty_notification,
 *   vip_outreach, inbound_response
 *
 * Safety:
 *   - runSafetyCheck() always first
 *   - requiresApproval() checked before queue entry
 *   - No direct Twilio calls — dispatches to existing HPL sendSms infrastructure
 *   - Max 400ms inter-send delay on batch operations
 *   - Quiet hours enforced by safety engine
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool } from "../hpl/sqlSafe";
import { createHash } from "crypto";
import type {
  CommWorkflowType,
  CommunicationStatus,
  CommunicationPriority,
  CommVertical,
} from "./types";
import { runSafetyCheck, requiresApproval, recordSend } from "./communicationSafetyEngine";
import { appendTimelineEvent } from "./communicationTimelineService";
import { requestApproval } from "./approvalWorkflowEngine";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_BATCH_SIZE   = 20;
const BATCH_DELAY_MS   = 400;
const MAX_RETRY_COUNT  = 3;

// ── Template engine ───────────────────────────────────────────────────────────

export function hydrateSmsTemplate(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`));
}

// ── Built-in templates ────────────────────────────────────────────────────────

export const SMS_TEMPLATES: Record<CommWorkflowType, string> = {
  lead_followup:            "Hi {{name}}! Thanks for your interest in {{businessName}}. We'd love to connect — reply here or book at {{bookingLink}}. Reply STOP to opt out.",
  missed_call_recovery:     "Hi {{name}}! You called {{businessName}} but we missed you. How can we help? Book at {{bookingLink}} or reply here. Reply STOP to opt out.",
  appointment_reminder:     "Hi {{name}}, reminder: your appointment at {{businessName}} is on {{date}} at {{time}}. Reply CONFIRM to confirm or CANCEL to cancel. Reply STOP to opt out.",
  appointment_confirmation: "Hi {{name}}, your appointment at {{businessName}} on {{date}} at {{time}} is confirmed! See you then. Reply STOP to opt out.",
  estimate_followup:        "Hi {{name}}, following up on your estimate from {{businessName}}. Any questions? Ready to get started? Reply here or call us. Reply STOP to opt out.",
  review_request:           "Hi {{name}}, thank you for choosing {{businessName}}! If you enjoyed your experience, we'd love a quick review: {{reviewLink}} Reply STOP to opt out.",
  reactivation:             "Hi {{name}}, we miss you at {{businessName}}! It's been a while — come back in and book your next visit: {{bookingLink}} Reply STOP to opt out.",
  insurance_outreach:       "Hi {{name}}, this is {{agentName}} from {{businessName}}. I have some important information about your coverage. When is a good time to connect? Reply STOP to opt out.",
  contractor_outreach:      "Hi {{name}}, {{businessName}} here. We'd love to help with your project — reply here or book a free estimate at {{bookingLink}}. Reply STOP to opt out.",
  legal_intake:             "Hi {{name}}, {{firmName}} here regarding your inquiry. An attorney will be in touch shortly. Reply STOP to opt out.",
  retention_campaign:       "Hi {{name}}! {{businessName}} here — we'd love to see you again. Book your next visit: {{bookingLink}} Reply STOP to opt out.",
  loyalty_notification:     "Hi {{name}}, great news from {{businessName}}! You've reached {{points}} loyalty points. Ask about your reward at your next visit! Reply STOP to opt out.",
  vip_outreach:             "Hi {{name}}, a personal note from {{businessName}} — we appreciate your loyalty and want to make sure you're taken care of. Reply anytime. Reply STOP to opt out.",
  inbound_response:         "Hi {{name}}, thanks for reaching out to {{businessName}}! {{responseText}} Reply STOP to opt out.",
  voicemail_followup:       "Hi {{name}}, we saw you left a voicemail for {{businessName}}. We'll call you back shortly — or reply here with your question! Reply STOP to opt out.",
  escalation_alert:         "{{escalationMessage}} Reply STOP to opt out.",
  custom:                   "{{messageBody}} Reply STOP to opt out.",
  imessage_draft:           "{{messageBody}}",
};

// ── ID builder ────────────────────────────────────────────────────────────────

export function buildCommunicationId(tenantId: string, contactPhone: string, workflowType: string): string {
  const raw = `${tenantId}|${contactPhone}|${workflowType}|${Date.now()}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _comm_sms_queue (
        id                 SERIAL PRIMARY KEY,
        communication_id   TEXT        NOT NULL UNIQUE,
        tenant_id          TEXT        NOT NULL,
        contact_phone      TEXT        NOT NULL,
        contact_name       TEXT,
        workflow_type      TEXT        NOT NULL,
        vertical           TEXT        NOT NULL DEFAULT 'generic',
        priority           TEXT        NOT NULL DEFAULT 'normal',
        status             TEXT        NOT NULL DEFAULT 'draft',
        content            TEXT        NOT NULL,
        ai_generated       BOOLEAN     NOT NULL DEFAULT FALSE,
        requires_approval  BOOLEAN     NOT NULL DEFAULT FALSE,
        approval_id        TEXT,
        scheduled_at       TIMESTAMPTZ,
        sent_at            TIMESTAMPTZ,
        delivered_at       TIMESTAMPTZ,
        failed_at          TIMESTAMPTZ,
        provider_message_id TEXT,
        retry_count        INTEGER     NOT NULL DEFAULT 0,
        max_retries        INTEGER     NOT NULL DEFAULT 3,
        metadata           JSONB,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS comm_sms_tenant_idx  ON _comm_sms_queue (tenant_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS comm_sms_status_idx  ON _comm_sms_queue (status, scheduled_at ASC)
        WHERE status IN ('draft','pending_approval','approved');
      CREATE INDEX IF NOT EXISTS comm_sms_phone_idx   ON _comm_sms_queue (contact_phone, tenant_id, created_at DESC);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[COMM-SMS] Failed to ensure table:", err?.message);
  }
}

// ── Schedule SMS ──────────────────────────────────────────────────────────────

export async function scheduleSms(opts: {
  tenantId:      string;
  contactPhone:  string;
  contactName?:  string;
  workflowType:  CommWorkflowType;
  vertical?:     CommVertical;
  priority?:     CommunicationPriority;
  templateVars?: Record<string, string | number | undefined>;
  customContent?: string;
  aiGenerated?:  boolean;
  scheduledAt?:  Date;
  metadata?:     Record<string, unknown>;
}): Promise<{
  communicationId: string;
  status:          CommunicationStatus;
  requiresApproval: boolean;
  approvalId?:     string;
  blocked?:        boolean;
  blockReason?:    string;
}> {
  await ensureTable();

  const {
    tenantId, contactPhone, contactName, workflowType,
    vertical = "generic", priority = "normal",
  } = opts;

  const communicationId = buildCommunicationId(tenantId, contactPhone, workflowType);

  // ── Safety check (always first) ───────────────────────────────────────────
  const safety = await runSafetyCheck({
    tenantId, contactPhone, channel: "sms", workflowType,
  });

  if (!safety.passed) {
    await appendTimelineEvent({
      communicationId, tenantId,
      eventType:   "safety_blocked",
      actor:       "system",
      description: `Safety blocked: ${safety.blockReason} — ${safety.detail}`,
      metadata:    { blockReason: safety.blockReason },
    });
    return {
      communicationId, status: safety.blockReason === "opt_out" ? "opted_out" : "failed",
      requiresApproval: false, blocked: true, blockReason: safety.detail,
    };
  }

  // ── Build content ─────────────────────────────────────────────────────────
  const template = SMS_TEMPLATES[workflowType] ?? SMS_TEMPLATES.custom;
  const content  = opts.customContent ?? hydrateSmsTemplate(template, opts.templateVars ?? {});

  // ── Check if approval required ────────────────────────────────────────────
  const needsApproval = await requiresApproval(tenantId, workflowType);
  const status: CommunicationStatus = needsApproval ? "pending_approval" : "approved";

  // ── Insert into queue ─────────────────────────────────────────────────────
  try {
    await db.execute(sql.raw(`
      INSERT INTO _comm_sms_queue
        (communication_id, tenant_id, contact_phone, contact_name, workflow_type,
         vertical, priority, status, content, ai_generated, requires_approval,
         scheduled_at, metadata)
      VALUES
        (${esc(communicationId)}, ${esc(tenantId)}, ${esc(contactPhone)},
         ${esc(contactName ?? "")}, ${esc(workflowType)}, ${esc(vertical)},
         ${esc(priority)}, ${esc(status)}, ${esc(content)}, ${bool(opts.aiGenerated ?? false)},
         ${bool(needsApproval)},
         ${opts.scheduledAt ? esc(opts.scheduledAt.toISOString()) : "NOW()"},
         ${esc(JSON.stringify(opts.metadata ?? {}))})
      ON CONFLICT (communication_id) DO NOTHING
    `));
  } catch (err: any) {
    console.error("[COMM-SMS] Insert failed:", err?.message);
    return { communicationId, status: "failed", requiresApproval: false };
  }

  // ── Timeline: created ────────────────────────────────────────────────────
  await appendTimelineEvent({
    communicationId, tenantId,
    eventType:   "created",
    actor:       "system",
    description: `SMS scheduled: ${workflowType} → ${contactPhone}`,
    metadata:    { workflowType, priority, needsApproval },
  });

  // ── Request approval if needed ────────────────────────────────────────────
  let approvalId: string | undefined;
  if (needsApproval) {
    const appr = await requestApproval({ communicationId, tenantId, workflowType });
    approvalId = appr.approvalId;
    await db.execute(sql.raw(`
      UPDATE _comm_sms_queue SET approval_id = ${esc(approvalId)} WHERE communication_id = ${esc(communicationId)}
    `));
  } else {
    await appendTimelineEvent({
      communicationId, tenantId,
      eventType:   "safety_passed",
      actor:       "system",
      description: "Safety checks passed — queued for sending",
    });
  }

  console.log(`[COMM-SMS] Scheduled ${communicationId} workflow=${workflowType} status=${status}`);
  return { communicationId, status, requiresApproval: needsApproval, approvalId };
}

// ── Execute single SMS from queue ─────────────────────────────────────────────

export async function executeSms(communicationId: string, tenantId: string): Promise<{
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}> {
  await ensureTable();

  // Load from queue
  const result = await db.execute(sql.raw(`
    SELECT * FROM _comm_sms_queue
    WHERE communication_id = ${esc(communicationId)} AND tenant_id = ${esc(tenantId)}
  `));
  const rows = (result as any).rows ?? result;
  const sms  = Array.isArray(rows) ? rows[0] : null;
  if (!sms) return { ok: false, error: "SMS record not found" };
  if (!["approved"].includes(sms.status)) return { ok: false, error: `Cannot execute: status=${sms.status}` };

  // Mark sending
  await db.execute(sql.raw(`
    UPDATE _comm_sms_queue SET status = 'sending', updated_at = NOW()
    WHERE communication_id = ${esc(communicationId)}
  `));
  await appendTimelineEvent({ communicationId, tenantId, eventType: "sending", actor: "system", description: "Sending SMS" });

  try {
    // Dispatch to HPL send infrastructure
    const { sendSms } = await import("../twilioClient");
    const sendResult = await sendSms({
      to:   sms.contact_phone,
      body: sms.content,
    });

    const providerMessageId = (sendResult as any)?.sid ?? (sendResult as any)?.messageId ?? "unknown";

    await db.execute(sql.raw(`
      UPDATE _comm_sms_queue
      SET status='sent', sent_at=NOW(), provider_message_id=${esc(providerMessageId)}, updated_at=NOW()
      WHERE communication_id=${esc(communicationId)}
    `));

    // Record for rate-limiting
    await recordSend({
      tenantId, contactPhone: sms.contact_phone,
      channel: "sms", workflowType: sms.workflow_type,
    });

    await appendTimelineEvent({
      communicationId, tenantId,
      eventType:   "sent",
      actor:       "system",
      description: `SMS sent to ${sms.contact_phone}`,
      metadata:    { providerMessageId },
    });

    console.log(`[COMM-SMS] Sent ${communicationId} sid=${providerMessageId}`);
    return { ok: true, providerMessageId };

  } catch (err: any) {
    const errorMsg = err?.message ?? "Unknown send error";
    const retryCount = Number(sms.retry_count ?? 0) + 1;
    const newStatus = retryCount >= MAX_RETRY_COUNT ? "failed" : "approved";

    await db.execute(sql.raw(`
      UPDATE _comm_sms_queue
      SET status=${esc(newStatus)}, retry_count=${num(retryCount)},
          failed_at=${newStatus === "failed" ? "NOW()" : "NULL"}, updated_at=NOW()
      WHERE communication_id=${esc(communicationId)}
    `));

    await appendTimelineEvent({
      communicationId, tenantId,
      eventType:   newStatus === "failed" ? "failed" : "retried",
      actor:       "system",
      description: `Send failed (attempt ${retryCount}): ${errorMsg}`,
      metadata:    { error: errorMsg, retryCount },
    });

    return { ok: false, error: errorMsg };
  }
}

// ── Execute batch of approved SMS ─────────────────────────────────────────────

export async function executeApprovedSmsBatch(tenantId: string, limit = MAX_BATCH_SIZE): Promise<{
  attempted: number;
  sent:      number;
  failed:    number;
}> {
  await ensureTable();

  const result = await db.execute(sql.raw(`
    SELECT communication_id FROM _comm_sms_queue
    WHERE tenant_id = ${esc(tenantId)}
      AND status = 'approved'
      AND (scheduled_at IS NULL OR scheduled_at <= NOW())
    ORDER BY priority DESC, scheduled_at ASC
    LIMIT ${num(limit)}
  `));
  const ids = ((result as any).rows ?? result ?? []).map((r: any) => r.communication_id as string);

  let sent = 0, failed = 0;
  for (const id of ids) {
    const r = await executeSms(id, tenantId);
    r.ok ? sent++ : failed++;
    if (ids.indexOf(id) < ids.length - 1) await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
  }

  return { attempted: ids.length, sent, failed };
}

// ── Get queue ─────────────────────────────────────────────────────────────────

export async function getSmsQueue(opts: {
  tenantId:  string;
  status?:   CommunicationStatus;
  limit?:    number;
}): Promise<any[]> {
  await ensureTable();
  const statusFilter = opts.status ? `AND status = ${esc(opts.status)}` : "";
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _comm_sms_queue
      WHERE tenant_id = ${esc(opts.tenantId)}
        ${statusFilter}
      ORDER BY created_at DESC
      LIMIT ${num(opts.limit ?? 50)}
    `));
    return (result as any).rows ?? result ?? [];
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}

// ── SMS stats ─────────────────────────────────────────────────────────────────

export async function getSmsStats(tenantId: string): Promise<{
  total:           number;
  sent:            number;
  pendingApproval: number;
  failed:          number;
  deliveryRate:    number;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status='sent' OR status='delivered' THEN 1 END) AS sent,
        COUNT(CASE WHEN status='pending_approval' THEN 1 END) AS pending,
        COUNT(CASE WHEN status='failed' THEN 1 END) AS failed
      FROM _comm_sms_queue
      WHERE tenant_id = ${esc(tenantId)}
        AND created_at >= NOW() - INTERVAL '30 days'
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : {};
    const total = Number(r?.total ?? 0);
    const sent  = Number(r?.sent ?? 0);
    return {
      total, sent,
      pendingApproval: Number(r?.pending ?? 0),
      failed:          Number(r?.failed ?? 0),
      deliveryRate:    total > 0 ? (sent / total) * 100 : 0,
    };
  } catch {  // allow-silent-catch: non-fatal, returns safe default
    return { total: 0, sent: 0, pendingApproval: 0, failed: 0, deliveryRate: 0 };
  }
}
