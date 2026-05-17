/**
 * server/newResident/residentComplianceGuard.ts
 *
 * Resident Compliance & Privacy Guard (Phase 9A)
 *
 * Responsibilities:
 *   1. Suppression list management (address / ZIP / county / opt-out)
 *   2. Pre-event suppression check (called BEFORE any household creation)
 *   3. Quiet hours enforcement for workflow dispatch
 *   4. Tenant isolation enforcement
 *   5. Audit logging for compliance decisions
 *
 * Hard rules:
 *   - Suppression check runs BEFORE any record creation
 *   - Global (all-tenant) suppressions override per-tenant policy
 *   - Opt-outs are permanent until explicitly lifted by the contact
 *   - No protected-attribute inference is ever logged or used
 *   - All compliance decisions are immutably audited
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool } from "../hpl/sqlSafe";
import { createHash } from "crypto";
import type { ResidentSuppression } from "./types";

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _nr_suppressions (
        id                SERIAL PRIMARY KEY,
        suppression_id    TEXT NOT NULL UNIQUE,
        address_hash      TEXT,    -- SHA256 of normalized address (no raw PII stored)
        zip               TEXT,
        county            TEXT,
        state             TEXT,
        tenant_id         TEXT NOT NULL DEFAULT 'global',
        suppression_type  TEXT NOT NULL,
        source            TEXT NOT NULL,
        reason            TEXT NOT NULL,
        expires_at        TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS nr_supp_addr_idx    ON _nr_suppressions (address_hash) WHERE address_hash IS NOT NULL;
      CREATE INDEX IF NOT EXISTS nr_supp_zip_idx     ON _nr_suppressions (zip, tenant_id) WHERE zip IS NOT NULL;
      CREATE INDEX IF NOT EXISTS nr_supp_county_idx  ON _nr_suppressions (county, tenant_id) WHERE county IS NOT NULL;
      CREATE INDEX IF NOT EXISTS nr_supp_tenant_idx  ON _nr_suppressions (tenant_id, suppression_type, created_at DESC);

      CREATE TABLE IF NOT EXISTS _nr_compliance_log (
        id               SERIAL PRIMARY KEY,
        tenant_id        TEXT NOT NULL,
        event_type       TEXT NOT NULL,
        decision         TEXT NOT NULL,   -- 'allowed' | 'blocked' | 'suppressed'
        reason           TEXT,
        context_json     JSONB,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS nr_compliance_log_tenant_idx ON _nr_compliance_log (tenant_id, created_at DESC);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[NR-COMPLIANCE] Failed to ensure tables:", err?.message);
  }
}

// ── Address hashing (no raw address stored in suppression table) ──────────────

function hashAddress(normalizedAddress: string): string {
  return createHash("sha256").update(normalizedAddress.toLowerCase().trim()).digest("hex").slice(0, 32);
}

// ── Suppression ID builder ────────────────────────────────────────────────────

function buildSuppressionId(type: string, value: string, tenantId: string): string {
  return createHash("sha256")
    .update(`nr_supp|${type}|${value}|${tenantId}`)
    .digest("hex")
    .slice(0, 24);
}

// ── Primary suppression check ─────────────────────────────────────────────────

/**
 * Check whether an address/ZIP/county is suppressed.
 * Called BEFORE any household creation or workflow routing.
 * Returns true if suppressed (caller must block the action).
 */
export async function checkResidentSuppression(opts: {
  address?:   string;
  zip?:       string;
  county?:    string;
  tenantId:   string;
}): Promise<boolean> {
  await ensureTable();
  const { address, zip, county, tenantId } = opts;

  const conditions: string[] = [
    `(expires_at IS NULL OR expires_at > NOW())`,
    `(tenant_id = ${esc(tenantId)} OR tenant_id = 'global')`,
  ];

  const orClauses: string[] = [];
  if (address) {
    const h = hashAddress(address);
    orClauses.push(`address_hash = ${esc(h)}`);
  }
  if (zip)    orClauses.push(`zip = ${esc(zip)}`);
  if (county) orClauses.push(`county ILIKE ${esc(`%${county}%`)}`);

  if (orClauses.length === 0) return false;

  conditions.push(`(${orClauses.join(" OR ")})`);

  try {
    const result = await db.execute(sql.raw(`
      SELECT 1 FROM _nr_suppressions
      WHERE ${conditions.join(" AND ")}
      LIMIT 1
    `));
    const rows = (result as any).rows ?? result;
    return Array.isArray(rows) ? rows.length > 0 : false;
  } catch {
    return false; // fail open on DB error — do not block ingestion
  }
}

// ── Add suppression ───────────────────────────────────────────────────────────

export async function addResidentSuppression(opts: {
  tenantId:        string;
  suppressionType: ResidentSuppression["suppressionType"];
  source:          string;
  reason:          string;
  address?:        string;       // will be hashed — raw address not stored
  zip?:            string;
  county?:         string;
  state?:          string;
  expiresAt?:      string;       // ISO date — null = permanent
}): Promise<string> {
  await ensureTable();

  const key = opts.address
    ? `address:${hashAddress(opts.address)}`
    : opts.zip
    ? `zip:${opts.zip}`
    : `county:${opts.county ?? ""}`;

  const suppressionId = buildSuppressionId(opts.suppressionType, key, opts.tenantId);
  const addressHash   = opts.address ? hashAddress(opts.address) : null;

  await db.execute(sql.raw(`
    INSERT INTO _nr_suppressions (
      suppression_id, address_hash, zip, county, state,
      tenant_id, suppression_type, source, reason, expires_at
    ) VALUES (
      ${esc(suppressionId)},
      ${addressHash ? esc(addressHash) : "NULL"},
      ${esc(opts.zip ?? "")},
      ${esc(opts.county ?? "")},
      ${esc(opts.state ?? "")},
      ${esc(opts.tenantId)},
      ${esc(opts.suppressionType)},
      ${esc(opts.source)},
      ${esc(opts.reason)},
      ${opts.expiresAt ? esc(opts.expiresAt) : "NULL"}
    )
    ON CONFLICT (suppression_id) DO NOTHING
  `));

  await logComplianceDecision({
    tenantId: opts.tenantId,
    eventType: "suppression_added",
    decision: "blocked",
    reason: `${opts.suppressionType} suppression: ${opts.reason}`,
    context: { suppressionId, suppressionType: opts.suppressionType },
  });

  console.log(`[NR-COMPLIANCE] Suppression added: ${suppressionId} type=${opts.suppressionType} tenant=${opts.tenantId}`);
  return suppressionId;
}

// ── Remove suppression (lift) ─────────────────────────────────────────────────

export async function liftResidentSuppression(suppressionId: string, tenantId: string): Promise<void> {
  await db.execute(sql.raw(`
    DELETE FROM _nr_suppressions
    WHERE suppression_id = ${esc(suppressionId)} AND tenant_id = ${esc(tenantId)}
  `));
  console.log(`[NR-COMPLIANCE] Suppression lifted: ${suppressionId}`);
}

// ── Get suppressions ──────────────────────────────────────────────────────────

export async function getSuppressions(tenantId: string, limit = 50): Promise<ResidentSuppression[]> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _nr_suppressions
      WHERE tenant_id IN (${esc(tenantId)}, 'global')
      ORDER BY created_at DESC
      LIMIT ${num(limit)}
    `));
    return ((result as any).rows ?? result ?? []).map((r: any): ResidentSuppression => ({
      suppressionId:   r.suppression_id,
      address:         undefined, // raw address not stored
      zip:             r.zip || undefined,
      county:          r.county || undefined,
      tenantId:        r.tenant_id,
      suppressionType: r.suppression_type,
      source:          r.source,
      reason:          r.reason,
      expiresAt:       r.expires_at?.toISOString?.() ?? undefined,
      createdAt:       r.created_at?.toISOString?.() ?? new Date().toISOString(),
    }));
  } catch { return []; }
}

// ── Quiet hours check ─────────────────────────────────────────────────────────

const QUIET_START_HOUR = 20; // 8 PM
const QUIET_END_HOUR   = 9;  // 9 AM

export function isInResidentQuietHours(now: Date = new Date()): boolean {
  const hour = now.getHours();
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

// ── Compliance audit log ──────────────────────────────────────────────────────

export async function logComplianceDecision(opts: {
  tenantId:  string;
  eventType: string;
  decision:  "allowed" | "blocked" | "suppressed";
  reason?:   string;
  context?:  Record<string, unknown>;
}): Promise<void> {
  await ensureTable();
  try {
    await db.execute(sql.raw(`
      INSERT INTO _nr_compliance_log (tenant_id, event_type, decision, reason, context_json)
      VALUES (${esc(opts.tenantId)}, ${esc(opts.eventType)}, ${esc(opts.decision)},
              ${esc(opts.reason ?? "")}, ${esc(JSON.stringify(opts.context ?? {}))})
    `));
  } catch { /* non-critical */ }
}

export async function getComplianceLog(tenantId: string, limit = 100): Promise<any[]> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _nr_compliance_log
      WHERE tenant_id = ${esc(tenantId)}
      ORDER BY created_at DESC
      LIMIT ${num(limit)}
    `));
    return ((result as any).rows ?? result ?? []).map((r: any) => ({
      id:        r.id,
      tenantId:  r.tenant_id,
      eventType: r.event_type,
      decision:  r.decision,
      reason:    r.reason,
      context:   typeof r.context_json === "string" ? JSON.parse(r.context_json) : r.context_json ?? {},
      createdAt: r.created_at?.toISOString?.() ?? new Date().toISOString(),
    }));
  } catch { return []; }
}

// ── Validate approval actor ───────────────────────────────────────────────────

const SYSTEM_BLOCKLIST = ["auto", "bot", "ai", "system", "automated", "script", ""];

export function validateApprovalActor(actorName: string): { valid: boolean; reason?: string } {
  const trimmed = actorName.trim().toLowerCase();
  if (SYSTEM_BLOCKLIST.includes(trimmed)) {
    return { valid: false, reason: `'${actorName}' is a blocked system actor name. A real human name is required.` };
  }
  if (actorName.trim().length < 2) {
    return { valid: false, reason: "Actor name must be at least 2 characters." };
  }
  return { valid: true };
}
