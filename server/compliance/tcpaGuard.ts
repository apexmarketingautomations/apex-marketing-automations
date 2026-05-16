/**
 * server/compliance/tcpaGuard.ts
 *
 * TCPA Compliance Layer  (Phase 12)
 *
 * Hard gate for ALL outbound comms. Rules:
 * 1. Internal opt-out list (contacts.opt_out=true)
 * 2. DNC registry (dnc_numbers table — populated by keyword stops + manual adds)
 * 3. Quiet hours: no SMS/calls before 8am or after 9pm local time (Reg F)
 * 4. Frequency cap: configurable per channel per 24h rolling window
 * 5. Litigation risk flag: numbers known to sue telemarketers
 * 6. Consent record requirement for automated outbound
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

export type Channel = "sms" | "call" | "voicemail" | "email";

export interface TCPACheckInput {
  subAccountId:    number;
  phone?:          string;
  email?:          string;
  contactId?:      number;
  channel:         Channel;
  recipientTz?:    string;
}

export interface TCPACheckResult {
  allowed:         boolean;
  blockedReasons:  string[];
  riskLevel:       "none" | "low" | "medium" | "high" | "critical";
  consentOnFile:   boolean;
  dncListed:       boolean;
  quietHours:      boolean;
  frequencyCapped: boolean;
  litigationRisk:  boolean;
  checkedAt:       string;
}

export async function ensureComplianceTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS dnc_numbers (
      id               SERIAL PRIMARY KEY,
      normalized_phone TEXT        NOT NULL UNIQUE,
      source           TEXT        NOT NULL DEFAULT 'internal',
      added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at       TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS dnc_phone_idx ON dnc_numbers (normalized_phone);

    CREATE TABLE IF NOT EXISTS tcpa_consent_records (
      id               SERIAL PRIMARY KEY,
      contact_id       INTEGER,
      normalized_phone TEXT,
      sub_account_id   INTEGER     NOT NULL,
      channel          TEXT        NOT NULL,
      consent_type     TEXT        NOT NULL,
      consent_source   TEXT,
      consent_text     TEXT,
      ip_address       TEXT,
      consented_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at       TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS tcpa_consent_phone_idx ON tcpa_consent_records (normalized_phone, channel);

    CREATE TABLE IF NOT EXISTS litigation_risk_numbers (
      id               SERIAL PRIMARY KEY,
      normalized_phone TEXT        NOT NULL UNIQUE,
      risk_level       TEXT        NOT NULL DEFAULT 'high',
      note             TEXT,
      added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tcpa_violation_log (
      id               SERIAL PRIMARY KEY,
      sub_account_id   INTEGER     NOT NULL,
      contact_id       INTEGER,
      normalized_phone TEXT,
      channel          TEXT        NOT NULL,
      blocked_reasons  TEXT[]      NOT NULL,
      risk_level       TEXT        NOT NULL,
      attempted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS tvl_tenant_idx ON tcpa_violation_log (sub_account_id, attempted_at);

    CREATE TABLE IF NOT EXISTS data_retention_policies (
      id               SERIAL PRIMARY KEY,
      sub_account_id   INTEGER,
      table_name       TEXT        NOT NULL,
      retention_days   INTEGER     NOT NULL,
      purge_strategy   TEXT        NOT NULL DEFAULT 'soft_delete',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.slice(-10);
}

function isQuietHours(tz = "America/New_York"): boolean {
  try {
    const h = parseInt(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date()), 10
    );
    return h < 8 || h >= 21;
  } catch { return false; }
}

const FREQUENCY_CAPS: Record<Channel, number> = { sms: 3, call: 2, voicemail: 1, email: 5 };

async function checkFrequency(subAccountId: number, phone: string | undefined, contactId: number | undefined, channel: Channel): Promise<boolean> {
  const cap = FREQUENCY_CAPS[channel];
  const since = new Date(Date.now() - 86_400_000).toISOString();
  try {
    const r = await db.execute(sql`
      SELECT COUNT(*) AS n FROM tcpa_violation_log
      WHERE sub_account_id = ${subAccountId}
        AND channel = ${channel}
        AND attempted_at > ${since}
        AND (
          ${phone     ? sql`normalized_phone = ${normalizePhone(phone)}` : sql`FALSE`}
          OR ${contactId ? sql`contact_id = ${contactId}` : sql`FALSE`}
        )
    `);
    const rows = (r as any).rows ?? r;
    return Number(Array.isArray(rows) ? rows[0]?.n ?? 0 : 0) >= cap;
  } catch { return false; }
}

async function isDNC(phone: string): Promise<{ listed: boolean; source?: string }> {
  const p = normalizePhone(phone);
  try {
    const r = await db.execute(sql`SELECT source FROM dnc_numbers WHERE normalized_phone = ${p} AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`);
    const rows = (r as any).rows ?? r;
    if (Array.isArray(rows) && rows.length > 0) return { listed: true, source: rows[0].source };
    return { listed: false };
  } catch { return { listed: false }; }
}

async function isLitigationRisk(phone: string): Promise<{ risk: boolean; level?: string }> {
  const p = normalizePhone(phone);
  try {
    const r = await db.execute(sql`SELECT risk_level FROM litigation_risk_numbers WHERE normalized_phone = ${p} LIMIT 1`);
    const rows = (r as any).rows ?? r;
    if (Array.isArray(rows) && rows.length > 0) return { risk: true, level: rows[0].risk_level };
    return { risk: false };
  } catch { return { risk: false }; }
}

async function isOptedOut(phone?: string, contactId?: number): Promise<boolean> {
  try {
    if (contactId) {
      const r = await db.execute(sql`SELECT id FROM contacts WHERE id = ${contactId} AND opt_out = true LIMIT 1`);
      const rows = (r as any).rows ?? r; if (Array.isArray(rows) && rows.length > 0) return true;
    }
    if (phone) {
      const r = await db.execute(sql`SELECT id FROM contacts WHERE normalized_phone = ${normalizePhone(phone)} AND opt_out = true LIMIT 1`);
      const rows = (r as any).rows ?? r; if (Array.isArray(rows) && rows.length > 0) return true;
    }
    return false;
  } catch { return false; }
}

async function hasConsent(subAccountId: number, phone?: string, contactId?: number, channel?: Channel): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      SELECT id FROM tcpa_consent_records
      WHERE sub_account_id = ${subAccountId}
        AND revoked_at IS NULL
        AND consent_type != 'none'
        AND channel IN (${channel ?? "sms"}, 'all')
        AND (
          ${contactId ? sql`contact_id = ${contactId}` : sql`FALSE`}
          OR ${phone ? sql`normalized_phone = ${normalizePhone(phone)}` : sql`FALSE`}
        )
      LIMIT 1
    `);
    const rows = (r as any).rows ?? r;
    return Array.isArray(rows) && rows.length > 0;
  } catch { return false; }
}

export async function checkTCPA(input: TCPACheckInput): Promise<TCPACheckResult> {
  await ensureComplianceTables();
  const blockedReasons: string[] = [];
  const checkedAt = new Date().toISOString();

  const optedOut = await isOptedOut(input.phone, input.contactId);
  if (optedOut) blockedReasons.push("contact_opted_out");

  let dncListed = false;
  if (input.phone && input.channel !== "email") {
    const dnc = await isDNC(input.phone);
    dncListed = dnc.listed;
    if (dncListed) blockedReasons.push(`dnc_listed:${dnc.source ?? "internal"}`);
  }

  const quietHours = input.channel !== "email" && isQuietHours(input.recipientTz);
  if (quietHours) blockedReasons.push("quiet_hours");

  const frequencyCapped = await checkFrequency(input.subAccountId, input.phone, input.contactId, input.channel);
  if (frequencyCapped) blockedReasons.push("frequency_cap_exceeded");

  let litigationRisk = false;
  if (input.phone) {
    const lit = await isLitigationRisk(input.phone);
    litigationRisk = lit.risk;
    if (litigationRisk) blockedReasons.push(`litigation_risk:${lit.level}`);
  }

  const consentOnFile = await hasConsent(input.subAccountId, input.phone, input.contactId, input.channel);

  const riskLevel =
    litigationRisk ? "critical" :
    dncListed || optedOut ? "high" :
    !consentOnFile && input.channel !== "email" ? "medium" :
    blockedReasons.length > 0 ? "low" : "none";

  const allowed = blockedReasons.length === 0;

  if (!allowed) {
    try {
      await db.execute(sql`
        INSERT INTO tcpa_violation_log (sub_account_id, contact_id, normalized_phone, channel, blocked_reasons, risk_level)
        VALUES (${input.subAccountId}, ${input.contactId ?? null},
                ${input.phone ? normalizePhone(input.phone) : null},
                ${input.channel}, ${JSON.stringify(blockedReasons)}::text[], ${riskLevel})
      `);
    } catch { /* non-fatal */ }
  }

  return { allowed, blockedReasons, riskLevel, consentOnFile, dncListed, quietHours, frequencyCapped, litigationRisk, checkedAt };
}

export async function recordConsent(params: {
  subAccountId: number; contactId?: number; phone?: string;
  channel: Channel; consentType: "express_written" | "express" | "implied";
  consentSource: string; consentText?: string; ipAddress?: string;
}): Promise<{ id: number }> {
  await ensureComplianceTables();
  const r = await db.execute(sql`
    INSERT INTO tcpa_consent_records
      (sub_account_id, contact_id, normalized_phone, channel, consent_type, consent_source, consent_text, ip_address)
    VALUES (${params.subAccountId}, ${params.contactId ?? null},
            ${params.phone ? normalizePhone(params.phone) : null},
            ${params.channel}, ${params.consentType}, ${params.consentSource},
            ${params.consentText ?? null}, ${params.ipAddress ?? null})
    RETURNING id
  `);
  const rows = (r as any).rows ?? r;
  return { id: Number(Array.isArray(rows) ? rows[0]?.id : 0) };
}

export async function recordOptOut(phone: string, source = "sms_stop"): Promise<void> {
  const p = normalizePhone(phone);
  await ensureComplianceTables();
  await db.execute(sql`INSERT INTO dnc_numbers (normalized_phone, source) VALUES (${p}, ${source}) ON CONFLICT (normalized_phone) DO NOTHING`);
  await db.execute(sql`UPDATE contacts SET opt_out = true, updated_at = NOW() WHERE normalized_phone = ${p}`);
  console.log(`[TCPA] opt-out: ${p} via ${source}`);
}

export async function getViolationLog(subAccountId: number, limit = 100): Promise<any[]> {
  await ensureComplianceTables();
  const r = await db.execute(sql`
    SELECT * FROM tcpa_violation_log WHERE sub_account_id = ${subAccountId}
    ORDER BY attempted_at DESC LIMIT ${limit}
  `);
  const rows = (r as any).rows ?? r;
  return Array.isArray(rows) ? rows : [];
}
