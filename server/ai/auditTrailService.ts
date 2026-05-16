/**
 * server/ai/auditTrailService.ts
 *
 * Persistent AI Audit Trail
 *
 * Every AI execution is written to the _ai_audit_log table so that:
 *   - No AI action is hidden
 *   - Cost, latency, provider, and output confidence are queryable
 *   - Failed generations are traceable to specific models and tasks
 *   - Tenant boundaries can be audited after the fact
 *
 * The table is created lazily on first write. Reads via getAuditLog()
 * are used by the AI command center dashboard and admin endpoints.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import type { AITaskType, ProviderName } from "./types";

// ── Schema ────────────────────────────────────────────────────────────────────

export interface AIAuditEntry {
  id?: number;
  traceId: string;
  requestId: string;
  provider: ProviderName;
  model: string;
  taskType: AITaskType | string;
  agentName?: string;
  subAccountId?: number | string | null;
  promptVersion?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  latencyMs?: number;
  outputConfidence?: number;
  outputValid: boolean;
  parseAttempts?: number;
  fallbackTriggered: boolean;
  fallbackChain?: string[];
  workflowId?: string;
  approvalRequired?: boolean;
  approvalState?: "pending" | "approved" | "rejected" | "auto";
  success: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface AuditQueryOptions {
  subAccountId?: number;
  taskType?: string;
  provider?: ProviderName;
  success?: boolean;
  since?: Date;
  limit?: number;
}

export interface AuditSummary {
  totalCalls: number;
  successRate: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  fallbackRate: number;
  byProvider: Record<string, { calls: number; failures: number; costUsd: number }>;
  byTaskType: Record<string, { calls: number; avgConfidence: number }>;
  recentFailures: AIAuditEntry[];
  generatedAt: string;
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _ai_audit_log (
        id                  SERIAL PRIMARY KEY,
        trace_id            TEXT        NOT NULL,
        request_id          TEXT        NOT NULL,
        provider            TEXT        NOT NULL,
        model               TEXT        NOT NULL,
        task_type           TEXT        NOT NULL,
        agent_name          TEXT,
        sub_account_id      INTEGER,
        prompt_version      TEXT,
        prompt_tokens       INTEGER,
        completion_tokens   INTEGER,
        total_tokens        INTEGER,
        estimated_cost_usd  NUMERIC(10,6),
        latency_ms          INTEGER,
        output_confidence   NUMERIC(4,3),
        output_valid        BOOLEAN     NOT NULL DEFAULT TRUE,
        parse_attempts      SMALLINT,
        fallback_triggered  BOOLEAN     NOT NULL DEFAULT FALSE,
        fallback_chain      TEXT[],
        workflow_id         TEXT,
        approval_required   BOOLEAN,
        approval_state      TEXT,
        success             BOOLEAN     NOT NULL,
        error_message       TEXT,
        metadata            JSONB,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ai_audit_trace_idx  ON _ai_audit_log (trace_id);
      CREATE INDEX IF NOT EXISTS ai_audit_account_idx ON _ai_audit_log (sub_account_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS ai_audit_task_idx   ON _ai_audit_log (task_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS ai_audit_success_idx ON _ai_audit_log (success, created_at DESC);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[AI-AUDIT] Failed to ensure audit table:", err?.message);
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function writeAuditEntry(entry: AIAuditEntry): Promise<void> {
  await ensureTable();
  try {
    const meta = entry.metadata ? JSON.stringify(entry.metadata).replace(/'/g, "''") : null;
    const chain = entry.fallbackChain?.length
      ? `ARRAY[${entry.fallbackChain.map(p => `'${p}'`).join(",")}]`
      : "NULL";

    await db.execute(sql.raw(`
      INSERT INTO _ai_audit_log (
        trace_id, request_id, provider, model, task_type,
        agent_name, sub_account_id, prompt_version,
        prompt_tokens, completion_tokens, total_tokens,
        estimated_cost_usd, latency_ms, output_confidence,
        output_valid, parse_attempts, fallback_triggered, fallback_chain,
        workflow_id, approval_required, approval_state,
        success, error_message, metadata
      ) VALUES (
        '${entry.traceId}',
        '${entry.requestId}',
        '${entry.provider}',
        '${entry.model}',
        '${entry.taskType}',
        ${entry.agentName ? `'${entry.agentName}'` : "NULL"},
        ${entry.subAccountId ?? "NULL"},
        ${entry.promptVersion ? `'${entry.promptVersion}'` : "NULL"},
        ${entry.promptTokens ?? "NULL"},
        ${entry.completionTokens ?? "NULL"},
        ${entry.totalTokens ?? "NULL"},
        ${entry.estimatedCostUsd ?? "NULL"},
        ${entry.latencyMs ?? "NULL"},
        ${entry.outputConfidence ?? "NULL"},
        ${entry.outputValid},
        ${entry.parseAttempts ?? "NULL"},
        ${entry.fallbackTriggered},
        ${chain},
        ${entry.workflowId ? `'${entry.workflowId}'` : "NULL"},
        ${entry.approvalRequired ?? "NULL"},
        ${entry.approvalState ? `'${entry.approvalState}'` : "NULL"},
        ${entry.success},
        ${entry.errorMessage ? `'${entry.errorMessage.replace(/'/g, "''").substring(0, 500)}'` : "NULL"},
        ${meta ? `'${meta}'::jsonb` : "NULL"}
      )
    `));
  } catch (err: any) {
    // Audit failures are non-fatal — log and continue
    console.error("[AI-AUDIT] Write failed:", err?.message);
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getAuditLog(opts: AuditQueryOptions = {}): Promise<AIAuditEntry[]> {
  await ensureTable();
  const { subAccountId, taskType, provider, success, since, limit = 100 } = opts;
  const conditions: string[] = [];
  if (subAccountId != null)  conditions.push(`sub_account_id = ${subAccountId}`);
  if (taskType)              conditions.push(`task_type = '${taskType}'`);
  if (provider)              conditions.push(`provider = '${provider}'`);
  if (success != null)       conditions.push(`success = ${success}`);
  if (since)                 conditions.push(`created_at >= '${since.toISOString()}'`);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _ai_audit_log ${where}
      ORDER BY created_at DESC LIMIT ${limit}
    `));
    const rows = (result as any).rows ?? result;
    return Array.isArray(rows) ? rows.map(mapRow) : [];
  } catch {
    return [];
  }
}

export async function getAuditSummary(sinceHours = 24): Promise<AuditSummary> {
  await ensureTable();
  const since = new Date(Date.now() - sinceHours * 3_600_000).toISOString();
  const generatedAt = new Date().toISOString();

  try {
    const [totals, byProv, byTask, failures] = await Promise.all([
      db.execute(sql.raw(`
        SELECT COUNT(*) AS calls,
               SUM(CASE WHEN success THEN 1 ELSE 0 END) AS successes,
               AVG(latency_ms) AS avg_latency,
               SUM(estimated_cost_usd) AS total_cost,
               SUM(CASE WHEN fallback_triggered THEN 1 ELSE 0 END) AS fallbacks
        FROM _ai_audit_log WHERE created_at >= '${since}'
      `)),
      db.execute(sql.raw(`
        SELECT provider,
               COUNT(*) AS calls,
               SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) AS failures,
               SUM(estimated_cost_usd) AS cost_usd
        FROM _ai_audit_log WHERE created_at >= '${since}'
        GROUP BY provider
      `)),
      db.execute(sql.raw(`
        SELECT task_type,
               COUNT(*) AS calls,
               AVG(output_confidence) AS avg_confidence
        FROM _ai_audit_log WHERE created_at >= '${since}'
        GROUP BY task_type
      `)),
      db.execute(sql.raw(`
        SELECT * FROM _ai_audit_log
        WHERE created_at >= '${since}' AND success = FALSE
        ORDER BY created_at DESC LIMIT 10
      `)),
    ]);

    const t = ((totals as any).rows ?? totals)[0] ?? {};
    const totalCalls = Number(t.calls ?? 0);
    const successes  = Number(t.successes ?? 0);

    const byProvider: AuditSummary["byProvider"] = {};
    for (const r of (byProv as any).rows ?? byProv) {
      byProvider[r.provider] = {
        calls:   Number(r.calls),
        failures: Number(r.failures),
        costUsd: Number(r.cost_usd ?? 0),
      };
    }

    const byTaskType: AuditSummary["byTaskType"] = {};
    for (const r of (byTask as any).rows ?? byTask) {
      byTaskType[r.task_type] = {
        calls: Number(r.calls),
        avgConfidence: r.avg_confidence != null ? parseFloat(r.avg_confidence) : 0,
      };
    }

    const failRows = (failures as any).rows ?? failures;
    const recentFailures: AIAuditEntry[] = Array.isArray(failRows) ? failRows.map(mapRow) : [];

    return {
      totalCalls,
      successRate: totalCalls > 0 ? successes / totalCalls : 1,
      avgLatencyMs: Number(t.avg_latency ?? 0),
      totalCostUsd: Number(t.total_cost ?? 0),
      fallbackRate: totalCalls > 0 ? Number(t.fallbacks ?? 0) / totalCalls : 0,
      byProvider,
      byTaskType,
      recentFailures,
      generatedAt,
    };
  } catch (err: any) {
    console.error("[AI-AUDIT] Summary query failed:", err?.message);
    return {
      totalCalls: 0, successRate: 1, avgLatencyMs: 0, totalCostUsd: 0,
      fallbackRate: 0, byProvider: {}, byTaskType: {}, recentFailures: [], generatedAt,
    };
  }
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function mapRow(r: any): AIAuditEntry {
  return {
    id:               Number(r.id),
    traceId:          r.trace_id,
    requestId:        r.request_id,
    provider:         r.provider as ProviderName,
    model:            r.model,
    taskType:         r.task_type as AITaskType,
    agentName:        r.agent_name ?? undefined,
    subAccountId:     r.sub_account_id ?? undefined,
    promptVersion:    r.prompt_version ?? undefined,
    promptTokens:     r.prompt_tokens ?? undefined,
    completionTokens: r.completion_tokens ?? undefined,
    totalTokens:      r.total_tokens ?? undefined,
    estimatedCostUsd: r.estimated_cost_usd != null ? parseFloat(r.estimated_cost_usd) : undefined,
    latencyMs:        r.latency_ms ?? undefined,
    outputConfidence: r.output_confidence != null ? parseFloat(r.output_confidence) : undefined,
    outputValid:      Boolean(r.output_valid),
    parseAttempts:    r.parse_attempts ?? undefined,
    fallbackTriggered: Boolean(r.fallback_triggered),
    fallbackChain:    r.fallback_chain ?? undefined,
    workflowId:       r.workflow_id ?? undefined,
    approvalRequired: r.approval_required ?? undefined,
    approvalState:    r.approval_state ?? undefined,
    success:          Boolean(r.success),
    errorMessage:     r.error_message ?? undefined,
    metadata:         typeof r.metadata === "object" ? r.metadata : undefined,
    createdAt:        r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}
