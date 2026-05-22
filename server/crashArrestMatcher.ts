/**
 * Crash–Arrest Matcher
 *
 * Connects Lee County (and other FL county) DUI/criminal-traffic arrest bookings
 * in `legalSignals` to unidentified crash contacts in `contacts`.
 *
 * Match criteria:
 *   1. Same county
 *   2. Arrest/booking date within ±2 days of crash date
 *   3. Charge is crash-relevant: DUI, reckless, careless, DWLS, leaving scene,
 *      vehicular homicide, or aggravated assault with vehicle
 *
 * When a match clears the score threshold (≥ 40):
 *   - Fills contact name, DOB, and residential address from the booking record
 *   - Sets identityStatus = "verified", isPlaceholder = false
 *   - Sets skipTraceStatus = "source_matched" (blocks BatchData from overwriting)
 *   - Stores the Lee Clerk case number (if present) in notes + tags for auto-finder
 *
 * Scoring (0–100+):
 *   Same-day arrest          +40
 *   Next-day arrest          +25
 *   Within 2 days            +10
 *   DUI charge               +35
 *   Vehicular homicide       +35
 *   Leaving scene/hit&run    +30
 *   Reckless driving         +20
 *   Careless driving         +15
 *   DWLS / suspended         +10
 *   Location token overlap   +15 (one bonus, first match only)
 *
 * Minimum score to enrich: 40 (same-day + any charge, or next-day + DUI)
 */

import { db }            from "./db";
import { contacts, legalSignals, crashReports } from "@shared/schema";
import {
  eq, and, inArray, gte, lte, isNull, or, sql,
} from "drizzle-orm";
import { upsertContact } from "./services/contactUpsertService";

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_MATCH_SCORE   = 40;
const MATCH_WINDOW_DAYS = 2;

const CRASH_CHARGE_RE = [
  /DUI|DRIVING UNDER THE INFLUENCE/i,
  /RECKLESS DRIVING/i,
  /CARELESS DRIVING/i,
  /LEAVING.*SCENE|HIT.*AND.*RUN/i,
  /DRIVING WHILE.*LICEN|DWLS|LICENSE.*SUSPENDED|LICENSE.*REVOKED/i,
  /VEHICULAR HOMICIDE|VEHICULAR MANSLAUGHTER/i,
  /AGGRAVATED ASSAULT.*VEHICLE|AGGRAVATED BATTERY.*VEHICLE/i,
  /ALCOHOL|INTOXICAT/i,
];

// Counties for which we have sheriff booking data
const SUPPORTED_COUNTIES = [
  "LEE", "CHARLOTTE", "COLLIER", "HILLSBOROUGH", "PINELLAS", "PASCO",
  "SARASOTA", "MANATEE", "POLK", "HENDRY", "GLADES",
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface CrashContactRow {
  contactId:      number;
  subAccountId:   number;
  incidentLocation: string | null;
  county:         string | null;
  crashDate:      string | null;
  crashLat:       number | null;
  crashLng:       number | null;
  crashReportId:  number | null;
}

interface ArrestSignalRow {
  id:               number;
  subjectName:      string | null;
  subjectDob:       string | null;
  subjectAddress:   string | null;
  subjectPhone:     string | null;
  chargeDescription: string | null;
  caseNumber:       string | null;
  filingDate:       Date | null;
  county:           string | null;
  rawData:          any;
}

interface MatchResult {
  contactId:     number;
  signalId:      number;
  score:         number;
  reasons:       string[];
  subjectName:   string;
  caseNumber:    string | null;
  enriched:      boolean;
  skipReason:    string | null;
}

export interface MatchRunStats {
  crashContactsScanned: number;
  signalsConsidered:    number;
  matchesFound:         number;
  enriched:             number;
  skipped:              number;
  errors:               number;
  completedAt:          string;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreMatch(
  crash: CrashContactRow,
  signal: ArrestSignalRow,
): { score: number; reasons: string[] } {
  let score   = 0;
  const reasons: string[] = [];

  // ── Date proximity ──────────────────────────────────────────────────────
  const crashMs  = crash.crashDate ? new Date(crash.crashDate).getTime() : null;
  const sigMs    = signal.filingDate ? signal.filingDate.getTime() : null;

  if (crashMs && sigMs) {
    const daysDiff = Math.abs(crashMs - sigMs) / 86_400_000;
    if (daysDiff < 0.5)      { score += 40; reasons.push("same_day"); }
    else if (daysDiff <= 1)  { score += 25; reasons.push("next_day"); }
    else if (daysDiff <= 2)  { score += 10; reasons.push("within_2_days"); }
  }

  // ── Charge relevance ────────────────────────────────────────────────────
  const charge = (signal.chargeDescription || "").toUpperCase();

  if (/VEHICULAR HOMICIDE|VEHICULAR MANSLAUGHTER/.test(charge)) { score += 35; reasons.push("vehicular_homicide"); }
  else if (/DUI|DRIVING UNDER THE INFLUENCE/.test(charge))      { score += 35; reasons.push("dui"); }
  if (/LEAVING.*SCENE|HIT.*AND.*RUN/.test(charge))              { score += 30; reasons.push("hit_and_run"); }
  if (/RECKLESS DRIVING/.test(charge))                          { score += 20; reasons.push("reckless"); }
  if (/AGGRAVATED ASSAULT.*VEHICLE|AGGRAVATED BATTERY.*VEHICLE/.test(charge)) { score += 20; reasons.push("agg_assault_vehicle"); }
  if (/CARELESS DRIVING/.test(charge))                          { score += 15; reasons.push("careless"); }
  if (/DWLS|DRIVING WHILE.*LICEN|LICENSE.*SUSPENDED/.test(charge)) { score += 10; reasons.push("dwls"); }
  if (/ALCOHOL|INTOXICAT/.test(charge) && !reasons.includes("dui")) { score += 10; reasons.push("alcohol"); }

  // ── Location token overlap ──────────────────────────────────────────────
  const incidentLoc = (crash.incidentLocation || "").toUpperCase();
  if (incidentLoc.length > 5) {
    const rawStr = JSON.stringify(signal.rawData || {}).toUpperCase();
    const tokens = incidentLoc
      .split(/[\s,x\[\]/\-]+/)
      .filter((w) => w.length > 4 && !/^(NORTH|SOUTH|EAST|WEST|BOUND|COUNTY|FLORIDA|STATE|ROAD|STREET|AVENUE|BLVD|HIGHWAY|PARKWAY|LANE|DRIVE)$/.test(w));

    for (const tok of tokens.slice(0, 8)) {
      if (rawStr.includes(tok)) {
        score += 15;
        reasons.push(`loc(${tok})`);
        break;
      }
    }
  }

  return { score, reasons };
}

// ── Enrichment ────────────────────────────────────────────────────────────────

async function enrichContactFromBooking(
  crash: CrashContactRow,
  signal: ArrestSignalRow,
  score: number,
  reasons: string[],
): Promise<{ enriched: boolean; skipReason: string | null }> {
  if (!signal.subjectName?.trim()) {
    return { enriched: false, skipReason: "no_subject_name" };
  }

  const nameParts = signal.subjectName.trim().split(/\s+/);
  const firstName = nameParts[0] ?? "Unknown";
  const lastName  = nameParts.slice(1).join(" ") || "";

  const caseNote = signal.caseNumber
    ? `Lee Clerk Case: ${signal.caseNumber}`
    : "";

  const bookingNote = [
    `Matched from Lee County Sheriff booking (score=${score}, ${reasons.join(", ")})`,
    `Charges: ${signal.chargeDescription || "N/A"}`,
    signal.subjectDob  ? `DOB: ${signal.subjectDob}` : null,
    caseNote || null,
    `Arrest Signal ID: ${signal.id}`,
  ].filter(Boolean).join("\n");

  const newTags = [
    "arrest-match",
    "criminal-traffic",
    signal.caseNumber ? `lee-clerk:${signal.caseNumber}` : null,
    reasons.includes("dui") ? "dui-arrest" : null,
    reasons.includes("hit_and_run") ? "hit-and-run" : null,
  ].filter((t): t is string => !!t);

  try {
    // Update the existing contact by ID — don't use upsertContact with a new
    // sourceExternalId or it creates a duplicate instead of patching the crash contact.
    const updateFields: Record<string, any> = {
      first_name:        firstName,
      last_name:         lastName,
      identity_status:   "verified",
      is_placeholder:    false,
      skip_trace_status: "source_matched",
      view_class:        "incident_subject",
      workflow_stage:    "enriching",
      lead_vertical:     "criminal_dui",
      notes:             bookingNote,
      updated_at:        new Date(),
    };

    if (signal.subjectAddress?.trim()) {
      updateFields.address = signal.subjectAddress.trim();
    }
    if (signal.subjectPhone?.trim()) {
      updateFields.phone            = signal.subjectPhone.trim();
      updateFields.phone_source     = "sheriff_booking";
      updateFields.phone_confidence = 0.90;
    }

    await db
      .update(contacts)
      .set(updateFields)
      .where(eq(contacts.id, crash.contactId));

    // Append tags without overwriting existing ones
    await db.execute(sql`
      UPDATE contacts
      SET tags = (
        SELECT array_agg(DISTINCT t) FROM unnest(
          COALESCE(tags, ARRAY[]::text[]) || ${newTags}::text[]
        ) AS t
      )
      WHERE id = ${crash.contactId}
    `);

    console.log(`[CRASH-ARREST] Enriched contact ${crash.contactId} → ${firstName} ${lastName}`);
    return { enriched: true, skipReason: null };
  } catch (err: any) {
    console.error(`[CRASH-ARREST] Enrichment failed for contact ${crash.contactId}:`, err?.message);
    return { enriched: false, skipReason: `upsert_error: ${err?.message}` };
  }
}

// ── Main run ──────────────────────────────────────────────────────────────────

export async function runCrashArrestMatch(opts: {
  counties?:    string[];
  daysBack?:    number;
  dryRun?:      boolean;
  limit?:       number;
}): Promise<MatchRunStats> {
  const {
    counties  = SUPPORTED_COUNTIES,
    daysBack  = 90,
    dryRun    = false,
    limit     = 200,
  } = opts;

  const stats: MatchRunStats = {
    crashContactsScanned: 0,
    signalsConsidered:    0,
    matchesFound:         0,
    enriched:             0,
    skipped:              0,
    errors:               0,
    completedAt:          "",
  };

  const upperCounties = counties.map((c) => c.toUpperCase());
  const cutoff = new Date(Date.now() - daysBack * 86_400_000);

  console.log(`[CRASH-ARREST] Starting match run — counties=${upperCounties.join(",")} daysBack=${daysBack} dryRun=${dryRun}`);

  // ── Step 1: Load unidentified crash contacts ──────────────────────────────
  // Join contacts → crash_reports using the report number embedded in sourceExternalId.
  // sourceExternalId format: "crash:SENTINEL-{hash}:acct{id}" or "crash:{crashReportId}:..."
  //
  // We pull the data column from crash_reports to get crashDate, lat, lng.
  const rawRows = await db.execute<any>(sql`
    SELECT
      c.id                                  AS contact_id,
      c.sub_account_id                      AS sub_account_id,
      c.incident_location                   AS incident_location,
      c.county                              AS county,
      c.created_at                          AS contact_created_at,
      cr.id                                 AS crash_report_id,
      cr.data->>'crashDate'                 AS crash_date,
      cr.data->>'received'                  AS received_at,
      (cr.data->>'lat')::float              AS crash_lat,
      (cr.data->>'lng')::float              AS crash_lng
    FROM contacts c
    LEFT JOIN crash_reports cr
      ON cr.report_number = SPLIT_PART(
           SPLIT_PART(c.source_external_id, ':', 2),
           ':acct', 1
         )
    WHERE c.is_placeholder = true
      AND c.identity_status IN ('unidentified', 'placeholder')
      AND c.county = ANY(${upperCounties})
      AND c.created_at >= ${cutoff}
      AND (c.source LIKE '%crash%' OR c.source_external_id LIKE 'crash:%')
    ORDER BY c.created_at DESC
    LIMIT ${limit}
  `);

  const crashContacts: CrashContactRow[] = (rawRows.rows ?? rawRows).map((r: any) => ({
    contactId:       Number(r.contact_id),
    subAccountId:    Number(r.sub_account_id),
    incidentLocation: r.incident_location ?? null,
    county:          r.county ?? null,
    crashDate:       r.crash_date ?? r.received_at ?? null,
    crashLat:        r.crash_lat  ?? null,
    crashLng:        r.crash_lng  ?? null,
    crashReportId:   r.crash_report_id ? Number(r.crash_report_id) : null,
  }));

  stats.crashContactsScanned = crashContacts.length;
  console.log(`[CRASH-ARREST] Loaded ${crashContacts.length} unidentified crash contacts`);

  if (crashContacts.length === 0) return { ...stats, completedAt: new Date().toISOString() };

  // ── Step 2: Load arrest signals in the same date window ──────────────────
  const allSignals = await db
    .select()
    .from(legalSignals)
    .where(
      and(
        inArray(legalSignals.signalType, ["dui_arrest", "arrest", "jail_booking"] as any[]),
        sql`${legalSignals.county} = ANY(${upperCounties})`,
        gte(legalSignals.detectedAt, cutoff),
        // Only signals with crash-relevant charges
        sql`${legalSignals.chargeDescription} ~* ${CRASH_CHARGE_RE.map((r) => r.source).join("|")}`,
      )
    )
    .limit(2000) as ArrestSignalRow[];

  stats.signalsConsidered = allSignals.length;
  console.log(`[CRASH-ARREST] Found ${allSignals.length} arrest signals to match against`);

  if (allSignals.length === 0) return { ...stats, completedAt: new Date().toISOString() };

  // ── Step 3: Match ─────────────────────────────────────────────────────────
  const results: MatchResult[] = [];

  for (const crash of crashContacts) {
    if (!crash.crashDate && !crash.incidentLocation) continue;

    const crashMs = crash.crashDate ? new Date(crash.crashDate).getTime() : null;

    // Pre-filter signals by county + date window
    const candidateSignals = allSignals.filter((s) => {
      if (s.filingDate && crashMs) {
        const daysDiff = Math.abs(s.filingDate.getTime() - crashMs) / 86_400_000;
        if (daysDiff > MATCH_WINDOW_DAYS) return false;
      }
      return !crash.county || !s.id || // pass if no county to filter on
             (String(s.county ?? "").toUpperCase() === crash.county?.toUpperCase());
    });

    let bestScore  = -1;
    let bestSignal: ArrestSignalRow | null = null;
    let bestReasons: string[] = [];

    for (const signal of candidateSignals) {
      const { score, reasons } = scoreMatch(crash, signal);
      if (score > bestScore) {
        bestScore   = score;
        bestSignal  = signal;
        bestReasons = reasons;
      }
    }

    if (!bestSignal || bestScore < MIN_MATCH_SCORE) continue;

    stats.matchesFound++;
    console.log(
      `[CRASH-ARREST] MATCH contact=${crash.contactId} signal=${bestSignal.id} ` +
      `score=${bestScore} reasons=${bestReasons.join(",")} ` +
      `name="${bestSignal.subjectName}" charge="${bestSignal.chargeDescription?.slice(0, 60)}"`
    );

    if (dryRun) {
      results.push({
        contactId:   crash.contactId,
        signalId:    bestSignal.id,
        score:       bestScore,
        reasons:     bestReasons,
        subjectName: bestSignal.subjectName ?? "",
        caseNumber:  bestSignal.caseNumber ?? null,
        enriched:    false,
        skipReason:  "dry_run",
      });
      continue;
    }

    const { enriched, skipReason } = await enrichContactFromBooking(
      crash, bestSignal, bestScore, bestReasons,
    );

    if (enriched) stats.enriched++;
    else stats.skipped++;

    results.push({
      contactId:   crash.contactId,
      signalId:    bestSignal.id,
      score:       bestScore,
      reasons:     bestReasons,
      subjectName: bestSignal.subjectName ?? "",
      caseNumber:  bestSignal.caseNumber ?? null,
      enriched,
      skipReason,
    });
  }

  const completedAt = new Date().toISOString();
  console.log(
    `[CRASH-ARREST] Run complete — scanned=${stats.crashContactsScanned} ` +
    `signals=${stats.signalsConsidered} matches=${stats.matchesFound} ` +
    `enriched=${stats.enriched} skipped=${stats.skipped} errors=${stats.errors}`
  );

  return { ...stats, completedAt };
}
