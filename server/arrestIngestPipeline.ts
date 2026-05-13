/**
 * Arrest Ingest Pipeline
 *
 * Orchestration layer for the criminal defense / DUI lead intelligence system.
 * Ties together countyBookingScrapers.ts (direct REST+Apify extraction) and
 * chargeNormalizer.ts (12-category classification + scoring) into a production
 * pipeline that deduplicates, stores, and CRM-routes arrest leads.
 *
 * Data flow:
 *   scrapeAllCounties()
 *     → RawBookingRecord[]
 *     → normalizeCharges() + scoreArrestLead()
 *     → sha256 dedup check against legalSignals.sourceHash
 *     → INSERT legalSignals (signalType = 'arrest' | 'dui_arrest')
 *     → INSERT legalLeads (status = 'available')  [score ≥ 60]
 *     → INSERT contacts   (source = 'arrest_booking') [score ≥ 40]
 *
 * Dedup strategy (two hashes per record, either is sufficient to skip):
 *   Primary:  sha256(COUNTY|booking_id|booking_date)         — exact booking match
 *   Fallback: sha256(COUNTY|normalized_name|booking_date|charge[0]) — fuzzy dupe
 *
 * Scheduling: every 6 hours, 5 s stagger between counties.
 * Works in parallel with jailBookingPipeline.ts (Nimble agent path).
 *
 * Requires env vars:
 *   NIMBLE_API_KEY  — for Nimble REST extraction
 *   APIFY_API_KEY   — for Apify actor fallback (Charlotte, Collier, Pinellas, …)
 */

import crypto            from "crypto";
import { db }            from "./db";
import {
  legalSignals,
  legalLeads,
  contacts,
  subAccounts,
  type InsertLegalSignal,
  type InsertLegalLead,
  type InsertContact,
}                        from "@shared/schema";
import { eq, or }        from "drizzle-orm";
import {
  scrapeAllCounties,
  type RawBookingRecord,
  type ScrapeResult,
}                        from "./countyBookingScrapers";
import {
  normalizeCharges,
  scoreArrestLead,
  chargeProfileToVertical,
  type ChargeProfile,
}                        from "./chargeNormalizer";
import { publishEventAsync, EVENT_TYPES } from "./eventBus";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum composite score to create a legalLead (available for attorney claim). */
const LEAD_SCORE_THRESHOLD    = 60;

/** Minimum composite score to create a CRM contact. */
const CONTACT_SCORE_THRESHOLD = 40;

/** Lead expires after 7 days if unclaimed. */
const LEAD_TTL_DAYS = 7;

// ── Type aliases ──────────────────────────────────────────────────────────────

type SignalType   = "dui_arrest" | "arrest" | "jail_booking";
type UrgencyLevel = "critical"  | "high"   | "medium" | "low";

// ── Hash helpers ──────────────────────────────────────────────────────────────

function buildPrimaryHash(county: string, bookingId: string, bookingDate: string): string {
  return crypto
    .createHash("sha256")
    .update(`${county.toUpperCase()}|${bookingId}|${bookingDate}`)
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
}

function buildFallbackHash(
  county: string,
  fullName: string,
  bookingDate: string,
  firstCharge: string,
): string {
  const name = fullName.trim().toUpperCase().replace(/\s+/g, " ");
  return crypto
    .createHash("sha256")
    .update(`${county.toUpperCase()}|${name}|${bookingDate}|${firstCharge.toUpperCase()}`)
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
}

async function isHashDuplicate(hash: string): Promise<boolean> {
  const [row] = await db
    .select({ id: legalSignals.id })
    .from(legalSignals)
    .where(eq(legalSignals.sourceHash, hash))
    .limit(1);
  return !!row;
}

// ── Urgency mapper ────────────────────────────────────────────────────────────

function scoreToUrgency(score: number): UrgencyLevel {
  if (score >= 85) return "critical";
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  return "low";
}

// ── Signal type resolver ──────────────────────────────────────────────────────

function resolveSignalType(profile: ChargeProfile): SignalType {
  if (profile.dui_related) return "dui_arrest";
  return "arrest";
}

// ── Bond parser (handles "$1,500.00" and bare numbers) ───────────────────────

function parseBond(raw: number | null): number | null {
  return raw && isFinite(raw) && raw > 0 ? raw : null;
}

// ── Account resolver (legal accounts get contacts) ───────────────────────────

async function resolveLegalAccountIds(): Promise<number[]> {
  const { pool } = await import("./db");
  const allAccounts = await db
    .select({ id: subAccounts.id })
    .from(subAccounts)
    .limit(200);

  const ids: number[] = [];
  for (const acct of allAccounts) {
    // Always include Apex main (3) and Crash Connect (4)
    if (acct.id === 3 || acct.id === 4) { ids.push(acct.id); continue; }
    const r = await pool.query(
      `SELECT niche FROM sentinel_config WHERE sub_account_id=$1 LIMIT 1`,
      [acct.id],
    );
    const niche = r.rows[0]?.niche as string | undefined;
    if (!niche || niche === "legal" || niche === "attorney") ids.push(acct.id);
  }
  return [...new Set(ids)];
}

// ── Contact creation ──────────────────────────────────────────────────────────

async function createContactFromSignal(
  record:      RawBookingRecord,
  profile:     ChargeProfile,
  score:       number,
  subAccountId: number,
): Promise<void> {
  try {
    const tags = [
      "arrest-lead",
      "criminal-defense",
      profile.primaryCategory,
      profile.dui_related    ? "dui-related"    : null,
      profile.felony_related ? "felony-related"  : null,
    ].filter((t): t is string => !!t);

    const notes = [
      `Arrest Booking — ${record.county} County, FL`,
      `Booking ID: ${record.booking_id || "N/A"}`,
      `Booking Date: ${record.booking_date || "Unknown"}`,
      record.arrest_date ? `Arrest Date: ${record.arrest_date}` : null,
      `Charges: ${profile.summary}`,
      record.bond_amount ? `Bond: $${record.bond_amount.toLocaleString()}` : "Bond: Unknown",
      `Custody: ${record.custody_status || "Unknown"}`,
      record.arresting_agency ? `Arresting Agency: ${record.arresting_agency}` : null,
      `Lead Score: ${score}/100`,
      record.source_url ? `Source: ${record.source_url}` : null,
    ].filter(Boolean).join("\n");

    const firstName = record.first_name || record.full_name.split(" ")[0] || "Arrested";
    const lastName  = record.last_name
      || record.full_name.split(" ").slice(1).join(" ")
      || "Subject";

    const contactData: InsertContact = {
      subAccountId,
      firstName,
      lastName,
      source:  "arrest_booking",
      channel: "criminal_defense",
      tags,
      notes,
      address: record.city_state || undefined,
      state:   "FL",
    };

    await db.insert(contacts).values(contactData);
  } catch (err: any) { // allow-silent-catch: contact failure must not block signal pipeline
    console.warn(`[ARREST-INGEST] Contact creation failed (account=${subAccountId}):`, err?.message);
  }
}

// ── Core persist logic ────────────────────────────────────────────────────────

interface PersistResult {
  inserted:  boolean;
  duplicate: boolean;
  signalId?: number;
  leadId?:   number;
  reason?:   string;
}

async function persistRecord(
  record:           RawBookingRecord,
  legalAccountIds:  number[],
): Promise<PersistResult> {
  // ── 1. Charge normalization ──────────────────────────────────────────────
  const chargeStrings = record.charges.filter(Boolean);
  if (chargeStrings.length === 0 && !record.blocker) {
    return { inserted: false, duplicate: false, reason: "no_charges" };
  }

  const profile   = normalizeCharges(chargeStrings.length > 0 ? chargeStrings : ["Unknown Charge"]);
  const bond      = parseBond(record.bond_amount);
  const hoursAgo  = record.booking_date
    ? (Date.now() - new Date(record.booking_date).getTime()) / 3_600_000
    : undefined;

  const score = scoreArrestLead({
    chargeProfile:  profile,
    bondAmount:     bond ?? undefined,
    hoursAgo,
  });

  const vertical  = chargeProfileToVertical(profile);
  const signalType: SignalType = resolveSignalType(profile);
  const urgency   = scoreToUrgency(score);

  // ── 2. Dedup ─────────────────────────────────────────────────────────────
  const bookingDateStr = record.booking_date || new Date().toISOString().slice(0, 10);
  const firstCharge    = chargeStrings[0] || "";

  const primaryHash = record.booking_id
    ? buildPrimaryHash(record.county, record.booking_id, bookingDateStr)
    : null;
  const fallbackHash = buildFallbackHash(
    record.county, record.full_name, bookingDateStr, firstCharge,
  );
  const hashToUse = primaryHash || fallbackHash;
  const altHash   = primaryHash ? fallbackHash : null;

  if (await isHashDuplicate(hashToUse))          return { inserted: false, duplicate: true };
  if (altHash && await isHashDuplicate(altHash)) return { inserted: false, duplicate: true };

  // ── 3. Build charge description ──────────────────────────────────────────
  const chargeDesc = chargeStrings.slice(0, 6).join("; ").slice(0, 500);

  // ── 4. Insert legalSignals ───────────────────────────────────────────────
  const signalPayload: InsertLegalSignal = {
    sourceHash:        hashToUse,
    signalType,
    legalVertical:     vertical,
    county:            record.county,
    state:             "FL",
    subjectName:       record.full_name   || undefined,
    subjectDob:        record.dob         || undefined,
    subjectAddress:    record.city_state  || undefined,
    chargeDescription: chargeDesc         || undefined,
    caseNumber:        record.booking_id  || undefined,
    urgency,
    score,
    status:            score >= LEAD_SCORE_THRESHOLD ? "qualified" : "raw",
    rawData: {
      ...record,
      charge_profile:  profile,
      lead_score:      score,
      source:          "arrest_ingest_pipeline",
      scraped_at:      record.scrape_timestamp,
    },
    detectedAt: record.booking_date ? new Date(record.booking_date) : new Date(),
  };

  let signalId: number | undefined;
  try {
    const [sig] = await db.insert(legalSignals).values(signalPayload).returning({ id: legalSignals.id });
    signalId = sig?.id;
  } catch (err: any) {
    // Unique constraint violation = late-arriving dupe; treat as duplicate
    if (err?.code === "23505" || err?.message?.includes("unique")) {
      return { inserted: false, duplicate: true };
    }
    throw err;
  }

  if (!signalId) return { inserted: false, duplicate: false, reason: "signal_insert_failed" };

  // ── 5. Insert legalLeads (if score qualifies) ────────────────────────────
  let leadId: number | undefined;
  if (score >= LEAD_SCORE_THRESHOLD) {
    const expiresAt = new Date(Date.now() + LEAD_TTL_DAYS * 24 * 60 * 60 * 1000);
    const leadPayload: InsertLegalLead = {
      signalId,
      legalVertical:     vertical,
      signalType,
      county:            record.county,
      subjectName:       record.full_name   || undefined,
      subjectAddress:    record.city_state  || undefined,
      chargeDescription: chargeDesc         || undefined,
      caseNumber:        record.booking_id  || undefined,
      urgency,
      score,
      status:            "available",
      expiresAt,
      rawData: {
        bond_amount:    record.bond_amount,
        mugshot_url:    record.mugshot_url,
        dui_related:    profile.dui_related,
        felony_related: profile.felony_related,
        primary_category: profile.primaryCategory,
      },
      detectedAt: record.booking_date ? new Date(record.booking_date) : new Date(),
    };
    try {
      const [lead] = await db.insert(legalLeads).values(leadPayload)
        .onConflictDoNothing()
        .returning({ id: legalLeads.id });
      leadId = lead?.id;

      // Back-link signal to lead
      if (leadId) {
        await db.update(legalSignals)
          .set({ leadId, status: "delivered" })
          .where(eq(legalSignals.id, signalId));
      }
    } catch (_e) { // allow-silent-catch: lead insert failure is non-fatal
    }
  }

  // ── 6. Create contacts for legal accounts ───────────────────────────────
  if (score >= CONTACT_SCORE_THRESHOLD && legalAccountIds.length > 0) {
    for (const accountId of legalAccountIds) {
      await createContactFromSignal(record, profile, score, accountId);
    }
  }

  // ── 7. Emit event ────────────────────────────────────────────────────────
  publishEventAsync(EVENT_TYPES.CONTACT_UPDATED ?? "contact:updated", {
    source:      "arrest_ingest",
    county:      record.county,
    signalId,
    leadId,
    score,
    signalType,
    legalVertical: vertical,
    dui_related:   profile.dui_related,
    felony_related: profile.felony_related,
  }, "arrest-ingest-pipeline");

  return { inserted: true, duplicate: false, signalId, leadId };
}

// ── Per-county ingestion stats ────────────────────────────────────────────────

interface CountyIngestStats {
  county:    string;
  scraped:   number;
  inserted:  number;
  dupes:     number;
  skipped:   number;
  errors:    number;
  blocker?:  string;
  strategy:  string;
}

// ── Run stats ─────────────────────────────────────────────────────────────────

export interface ArrestIngestStats {
  startedAt:      string;
  completedAt:    string;
  counties:       CountyIngestStats[];
  totalScraped:   number;
  totalInserted:  number;
  totalDupes:     number;
  totalErrors:    number;
  leadsCreated:   number;
  contactsRouted: number;
  blockers:       Record<string, string>;
}

// ── Main ingest run ───────────────────────────────────────────────────────────

let lastRunStats: ArrestIngestStats | null = null;

export async function runArrestIngest(opts: {
  counties?: string[];
  daysBack?:  number;
} = {}): Promise<ArrestIngestStats> {
  const startedAt = new Date().toISOString();

  console.log(`\n[ARREST-INGEST] ════════════════════════════════════════════════`);
  console.log(`[ARREST-INGEST] RUN START — ${startedAt}`);
  console.log(`[ARREST-INGEST] Options: counties=${opts.counties?.join(",") ?? "ALL"} daysBack=${opts.daysBack ?? 3}`);
  console.log(`[ARREST-INGEST] ════════════════════════════════════════════════\n`);

  // ── Resolve which legal accounts receive contacts ────────────────────────
  let legalAccountIds: number[] = [];
  try {
    legalAccountIds = await resolveLegalAccountIds();
    console.log(`[ARREST-INGEST] Legal account IDs: [${legalAccountIds.join(", ")}]`);
  } catch (err: any) {
    console.warn("[ARREST-INGEST] Could not resolve legal accounts:", err?.message);
  }

  // ── Run county scrapers ───────────────────────────────────────────────────
  const daysBack  = opts.daysBack ?? 3;
  const toDate    = new Date().toISOString().slice(0, 10);
  const fromDate  = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let scrapeResults: ScrapeResult[];
  try {
    scrapeResults = await scrapeAllCounties(fromDate, toDate);
    // Apply optional county filter post-scrape (scrapeAllCounties always runs all)
    if (opts.counties && opts.counties.length > 0) {
      const wantedUpper = new Set(opts.counties.map(c => c.toUpperCase()));
      scrapeResults = scrapeResults.filter(r => wantedUpper.has(r.county.toUpperCase()));
    }
  } catch (err: any) {
    console.error("[ARREST-INGEST] scrapeAllCounties() threw:", err?.message);
    scrapeResults = [];
  }

  // ── Process results ───────────────────────────────────────────────────────
  const countyStats:   CountyIngestStats[] = [];
  const blockers:      Record<string, string> = {};
  let totalInserted  = 0;
  let totalDupes     = 0;
  let totalErrors    = 0;
  let leadsCreated   = 0;
  let contactsRouted = 0;

  for (const result of scrapeResults) {
    const stats: CountyIngestStats = {
      county:   result.county,
      scraped:  result.records.length,
      inserted: 0,
      dupes:    0,
      skipped:  0,
      errors:   result.errors.length,
      blocker:  result.blocker,
      strategy: result.strategy,
    };

    if (result.blocker) {
      blockers[result.county] = result.blocker;
      console.warn(`[ARREST-INGEST] ⚠ ${result.county} BLOCKED: ${result.blocker}`);
    }

    for (const record of result.records) {
      try {
        const pr = await persistRecord(record, legalAccountIds);
        if (pr.duplicate)   { stats.dupes++;    totalDupes++;    }
        else if (pr.inserted) {
          stats.inserted++;
          totalInserted++;
          if (pr.leadId)    { leadsCreated++;   }
          // Each inserted signal creates contacts for all legal accounts
          if (legalAccountIds.length > 0) {
            const bond     = parseBond(record.bond_amount);
            const profile  = normalizeCharges(record.charges.length > 0 ? record.charges : ["Unknown Charge"]);
            const score    = scoreArrestLead({ chargeProfile: profile, bondAmount: bond ?? undefined });
            if (score >= CONTACT_SCORE_THRESHOLD) {
              contactsRouted += legalAccountIds.length;
            }
          }
        } else {
          stats.skipped++;
        }
      } catch (err: any) {
        stats.errors++;
        totalErrors++;
        console.warn(`[ARREST-INGEST] Error persisting ${result.county}/${record.booking_id}:`, err?.message);
      }
    }

    const icon = stats.blocker ? "⚠" : stats.inserted > 0 ? "✅" : stats.scraped === 0 ? "📭" : "⏭";
    console.log(
      `[ARREST-INGEST] ${icon} ${result.county}: ` +
      `scraped=${stats.scraped} inserted=${stats.inserted} dupes=${stats.dupes} ` +
      `errors=${stats.errors} strategy=${stats.strategy}` +
      (stats.blocker ? ` BLOCKER="${stats.blocker}"` : ""),
    );

    countyStats.push(stats);
  }

  const completedAt = new Date().toISOString();
  const runStats: ArrestIngestStats = {
    startedAt,
    completedAt,
    counties:       countyStats,
    totalScraped:   countyStats.reduce((a, c) => a + c.scraped,   0),
    totalInserted,
    totalDupes,
    totalErrors,
    leadsCreated,
    contactsRouted,
    blockers,
  };

  lastRunStats = runStats;

  // ── Summary log ───────────────────────────────────────────────────────────
  console.log(`\n[ARREST-INGEST] ════════════════════════ RUN SUMMARY`);
  console.log(`[ARREST-INGEST] completed_at:    ${completedAt}`);
  console.log(`[ARREST-INGEST] total_scraped:   ${runStats.totalScraped}`);
  console.log(`[ARREST-INGEST] total_inserted:  ${totalInserted}`);
  console.log(`[ARREST-INGEST] total_dupes:     ${totalDupes}`);
  console.log(`[ARREST-INGEST] total_errors:    ${totalErrors}`);
  console.log(`[ARREST-INGEST] leads_created:   ${leadsCreated}`);
  console.log(`[ARREST-INGEST] contacts_routed: ${contactsRouted}`);
  if (Object.keys(blockers).length > 0) {
    console.log(`[ARREST-INGEST] blockers (${Object.keys(blockers).length}):`);
    for (const [county, msg] of Object.entries(blockers)) {
      console.log(`[ARREST-INGEST]   ${county}: ${msg}`);
    }
  }
  console.log(`[ARREST-INGEST] ════════════════════════════════════════════════\n`);

  return runStats;
}

// ── Status query ──────────────────────────────────────────────────────────────

export function getArrestIngestStats(): ArrestIngestStats | null {
  return lastRunStats;
}

export function isArrestIngestConfigured(): boolean {
  return !!(
    process.env.NIMBLE_API_KEY  ||
    process.env.NIMBLE_TOKEN    ||
    process.env.APIFY_API_KEY
  );
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

const INTERVAL_MS     = 6 * 60 * 60 * 1000;  // every 6 hours
const INITIAL_DELAY   = 3 * 60 * 1000;        // 3 min after boot (offset from jailBookingPipeline's 2 min)

export function startArrestIngestScheduler(): void {
  if (!isArrestIngestConfigured()) {
    console.log(
      "[ARREST-INGEST] Neither NIMBLE_API_KEY nor APIFY_API_KEY is set — " +
      "arrest ingest scheduler inactive. Set at least one in Railway env vars to enable.",
    );
    return;
  }

  const runAndLog = () =>
    runArrestIngest().catch(err =>
      console.error("[ARREST-INGEST] Scheduled run error:", err?.message),
    );

  setTimeout(() => {
    runAndLog();
    setInterval(runAndLog, INTERVAL_MS);
  }, INITIAL_DELAY);

  console.log(
    `[ARREST-INGEST] Scheduler started — first run in ${INITIAL_DELAY / 60_000} min, ` +
    `then every ${INTERVAL_MS / 3_600_000}h`,
  );
}
