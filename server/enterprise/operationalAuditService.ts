/**
 * Operational Audit Service — Phase 11
 *
 * Immutable, tenant-scoped, append-only audit log for all AI, workflow,
 * billing, RBAC, and enrichment actions across the platform.
 *
 * Rules:
 *  - NEVER update or delete enterprise_audit_events rows.
 *  - Writes are fire-and-forget by default; callers should not block on this.
 *  - Querying is paginated and filterable by eventType, actor, subAccountId, date range.
 */

import { db } from "../db";
import { enterpriseAuditEvents } from "@shared/schema";
import { desc, eq, and, gte, lte, like, or } from "drizzle-orm";
import type { EnterpriseAuditEvent } from "@shared/schema";

export interface AuditEventInput {
  eventType:    string;
  actor:        string;
  actorRole?:   string;
  subAccountId?: number;
  nodeId?:      number;
  resource?:    string;
  payload?:     Record<string, unknown>;
  ipAddress?:   string;
  userAgent?:   string;
}

/** Append an audit event. Never throws — failures are logged to stderr only. */
export async function logEnterpriseAudit(event: AuditEventInput): Promise<void> {
  try {
    await db.insert(enterpriseAuditEvents).values({
      eventType:    event.eventType,
      actor:        event.actor,
      actorRole:    event.actorRole || null,
      subAccountId: event.subAccountId || null,
      nodeId:       event.nodeId || null,
      resource:     event.resource || null,
      payload:      event.payload || null,
      ipAddress:    event.ipAddress || null,
      userAgent:    event.userAgent || null,
    });
  } catch (err: any) {
    console.error("[ENTERPRISE-AUDIT] Write failed:", event.eventType, err?.message);
  }
}

export interface AuditQueryOptions {
  subAccountId?: number;
  nodeId?:       number;
  eventType?:    string;
  actor?:        string;
  resource?:     string;
  since?:        Date;
  until?:        Date;
  search?:       string;
  limit?:        number;
  offset?:       number;
}

/** Query audit events with pagination. */
export async function queryAuditEvents(opts: AuditQueryOptions): Promise<{
  events: EnterpriseAuditEvent[];
  total:  number;
}> {
  const conditions: any[] = [];

  if (opts.subAccountId) conditions.push(eq(enterpriseAuditEvents.subAccountId, opts.subAccountId));
  if (opts.nodeId)       conditions.push(eq(enterpriseAuditEvents.nodeId, opts.nodeId));
  if (opts.eventType)    conditions.push(like(enterpriseAuditEvents.eventType, `%${opts.eventType}%`));
  if (opts.actor)        conditions.push(eq(enterpriseAuditEvents.actor, opts.actor));
  if (opts.resource)     conditions.push(like(enterpriseAuditEvents.resource, `%${opts.resource}%`));
  if (opts.since)        conditions.push(gte(enterpriseAuditEvents.createdAt, opts.since));
  if (opts.until)        conditions.push(lte(enterpriseAuditEvents.createdAt, opts.until));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit  = Math.min(opts.limit  || 100, 500);
  const offset = opts.offset || 0;

  const [events, countResult] = await Promise.all([
    db.select()
      .from(enterpriseAuditEvents)
      .where(where)
      .orderBy(desc(enterpriseAuditEvents.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: enterpriseAuditEvents.id })
      .from(enterpriseAuditEvents)
      .where(where),
  ]);

  return { events, total: countResult.length };
}

/** Get recent events across all accounts (platform admin view). */
export async function getPlatformAuditFeed(limit = 50): Promise<EnterpriseAuditEvent[]> {
  return db
    .select()
    .from(enterpriseAuditEvents)
    .orderBy(desc(enterpriseAuditEvents.createdAt))
    .limit(limit);
}

/** Convenience: log from an HTTP request with IP + UA extraction. */
export function logFromRequest(
  req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  event: Omit<AuditEventInput, "ipAddress" | "userAgent">,
): void {
  const ip = req.ip || (req.headers?.["x-forwarded-for"] as string)?.split(",")[0]?.trim();
  const ua = req.headers?.["user-agent"] as string | undefined;
  logEnterpriseAudit({ ...event, ipAddress: ip, userAgent: ua }).catch(() => {}); // allow-silent-catch: fire-and-forget
}
