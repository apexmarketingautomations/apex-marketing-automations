/**
 * server/communications/communicationTimelineService.ts
 *
 * Immutable Communication Timeline
 *
 * Every state change in the communications engine writes here.
 * Timeline events are append-only — never updated or deleted.
 * All queries are tenant-scoped.
 *
 * Safety:
 *   - INSERT only, no UPDATE/DELETE on timeline rows
 *   - Tenant isolation enforced on every read
 *   - Searchable by communicationId, tenantId, eventType, date range
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num } from "../hpl/sqlSafe";
import { createHash } from "crypto";
import type { TimelineEvent, TimelineEventType } from "./types";

// ── Event ID ──────────────────────────────────────────────────────────────────

function buildEventId(communicationId: string, eventType: string): string {
  const raw = `${communicationId}|${eventType}|${Date.now()}|${Math.random()}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _comm_timeline (
        id               SERIAL PRIMARY KEY,
        event_id         TEXT        NOT NULL UNIQUE,
        communication_id TEXT        NOT NULL,
        tenant_id        TEXT        NOT NULL,
        event_type       TEXT        NOT NULL,
        actor            TEXT        NOT NULL DEFAULT 'system',
        actor_id         TEXT,
        description      TEXT        NOT NULL DEFAULT '',
        metadata         JSONB,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS comm_tl_comm_idx   ON _comm_timeline (communication_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS comm_tl_tenant_idx ON _comm_timeline (tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS comm_tl_type_idx   ON _comm_timeline (tenant_id, event_type, created_at DESC);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[COMM-TIMELINE] Failed to ensure table:", err?.message);
  }
}

// ── Append event (primary API) ────────────────────────────────────────────────

export async function appendTimelineEvent(opts: {
  communicationId: string;
  tenantId:        string;
  eventType:       TimelineEventType;
  actor?:          "system" | "ai" | "human" | "provider";
  actorId?:        string;
  description:     string;
  metadata?:       Record<string, unknown>;
}): Promise<string> {
  await ensureTable();

  const eventId = buildEventId(opts.communicationId, opts.eventType);
  try {
    await db.execute(sql.raw(`
      INSERT INTO _comm_timeline
        (event_id, communication_id, tenant_id, event_type,
         actor, actor_id, description, metadata)
      VALUES
        (${esc(eventId)}, ${esc(opts.communicationId)}, ${esc(opts.tenantId)},
         ${esc(opts.eventType)}, ${esc(opts.actor ?? "system")},
         ${esc(opts.actorId ?? "")}, ${esc(opts.description)},
         ${esc(JSON.stringify(opts.metadata ?? {}))})
    `));
  } catch (err: any) {
    console.error("[COMM-TIMELINE] Append failed:", err?.message);
  }

  return eventId;
}

// ── Get timeline for one communication ───────────────────────────────────────

export async function getCommunicationTimeline(
  communicationId: string,
  tenantId: string,
): Promise<TimelineEvent[]> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _comm_timeline
      WHERE communication_id = ${esc(communicationId)}
        AND tenant_id = ${esc(tenantId)}
      ORDER BY created_at ASC
    `));
    return ((result as any).rows ?? result ?? []).map(mapRow);
  } catch { return []; }
}

// ── Get recent timeline for tenant (command center feed) ──────────────────────

export async function getTenantTimeline(opts: {
  tenantId:   string;
  eventType?: TimelineEventType;
  limit?:     number;
  offset?:    number;
}): Promise<TimelineEvent[]> {
  await ensureTable();
  const { tenantId, eventType, limit = 50, offset = 0 } = opts;
  const typeFilter = eventType ? `AND event_type = ${esc(eventType)}` : "";
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _comm_timeline
      WHERE tenant_id = ${esc(tenantId)}
        ${typeFilter}
      ORDER BY created_at DESC
      LIMIT ${num(limit)} OFFSET ${num(offset)}
    `));
    return ((result as any).rows ?? result ?? []).map(mapRow);
  } catch { return []; }
}

// ── Search timeline ───────────────────────────────────────────────────────────

export async function searchTimeline(opts: {
  tenantId:    string;
  query:       string;
  limit?:      number;
}): Promise<TimelineEvent[]> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _comm_timeline
      WHERE tenant_id = ${esc(opts.tenantId)}
        AND (
          description ILIKE ${esc(`%${opts.query}%`)}
          OR communication_id ILIKE ${esc(`%${opts.query}%`)}
          OR actor_id ILIKE ${esc(`%${opts.query}%`)}
        )
      ORDER BY created_at DESC
      LIMIT ${num(opts.limit ?? 20)}
    `));
    return ((result as any).rows ?? result ?? []).map(mapRow);
  } catch { return []; }
}

// ── Timeline stats for dashboard ─────────────────────────────────────────────

export async function getTimelineStats(tenantId: string): Promise<{
  total:           number;
  lastHour:        number;
  escalations:     number;
  aiGenerated:     number;
  appointmentsBooked: number;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                                                           AS total,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '1 hour' THEN 1 END) AS last_hour,
        COUNT(CASE WHEN event_type = 'escalation_triggered' THEN 1 END)   AS escalations,
        COUNT(CASE WHEN event_type = 'ai_reply_drafted' THEN 1 END)       AS ai_generated,
        COUNT(CASE WHEN event_type = 'appointment_booked' THEN 1 END)     AS appointments
      FROM _comm_timeline
      WHERE tenant_id = ${esc(tenantId)}
        AND created_at >= NOW() - INTERVAL '24 hours'
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : {};
    return {
      total:              Number(r?.total ?? 0),
      lastHour:           Number(r?.last_hour ?? 0),
      escalations:        Number(r?.escalations ?? 0),
      aiGenerated:        Number(r?.ai_generated ?? 0),
      appointmentsBooked: Number(r?.appointments ?? 0),
    };
  } catch {
    return { total: 0, lastHour: 0, escalations: 0, aiGenerated: 0, appointmentsBooked: 0 };
  }
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function mapRow(r: any): TimelineEvent {
  let metadata: Record<string, unknown> = {};
  try { metadata = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata ?? {}; } catch {}
  return {
    eventId:         r.event_id,
    communicationId: r.communication_id,
    tenantId:        r.tenant_id,
    eventType:       r.event_type as TimelineEventType,
    actor:           r.actor as "system" | "ai" | "human" | "provider",
    actorId:         r.actor_id || undefined,
    description:     r.description ?? "",
    metadata,
    createdAt:       r.created_at?.toISOString?.() ?? new Date().toISOString(),
  };
}
