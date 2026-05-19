/**
 * server/clerkTrafficEnrich.ts
 *
 * Layer 2 of the SWFL crash expansion — clerk-of-courts name recovery.
 *
 * WHY THIS EXISTS
 * ---------------
 * FL Statute 316.066 makes crash REPORTS confidential for 60 days, so neither
 * FLHSMV nor sheriff crash-report portals can be bulk-read for victim names.
 * But a traffic CITATION that becomes a county court case is PUBLIC record from
 * day one (Fla. R. Jud. Admin. 2.420). When FHP or a city PD works a crash and
 * issues a citation, the defendant's name + mailing address land in the county
 * clerk's traffic division as a public case. That is the door this module uses
 * — it is NOT the crash report, and it does not touch FLHSMV at all.
 *
 * This gives the platform a second, FLHSMV-independent path to driver identity.
 *
 * Scope: Lee, Collier, Charlotte clerk-of-courts traffic portals.
 *
 * HOW
 * ---
 * The clerk portals (matrix.leeclerk.org etc.) are Akamai-protected ASP.NET
 * forms that require a CSRF-token form POST — direct fetch cannot drive them
 * (this is exactly why courtFilingPipeline.ts is blocked). The fix, per that
 * file's own remediation note, is an Apify Playwright actor: a real browser
 * that holds the session + cookies and submits the form.
 *
 * ── APIFY ACTOR CONTRACT ──────────────────────────────────────────────────────
 * This module is the ORCHESTRATION half. It expects an Apify actor whose id is
 * set in APIFY_CLERK_TRAFFIC_ACTOR_ID. Until that env var is set the module is
 * a clean no-op (logs and returns zero stats — never throws).
 *
 *   Actor INPUT:   { county: "LEE"|"COLLIER"|"CHARLOTTE", portalUrl: string,
 *                    daysBack: number }
 *   Actor OUTPUT:  dataset rows of ClerkCitationRow (see interface below).
 *
 * OUTPUT (a) — standalone leads (SAFE, primary): every crash-related citation
 *   becomes a real contact via upsertContact() — verified name + court mailing
 *   address — sourced "clerk_traffic", deduped on clerk:<county>:<caseNumber>.
 *
 * OUTPUT (b) — placeholder back-fill (GATED): citations are scored against
 *   existing "Unidentified Crash Incident" placeholder contacts; only a
 *   high-confidence match upgrades a placeholder. Wrong linkage is worse than
 *   no linkage, so this runs dry-run-by-default via /api/internal/retro-clerk-enrich.
 */

import crypto from "crypto";
import { db } from "./db";
import { contacts } from "@shared/schema";
import { sql } from "drizzle-orm";
import { resolveApifyToken, recordApifyRun, CRASH_LEAD_ACCOUNT_IDS } from "./vendorConfig";
import {
  upsertContact,
  CONTACT_SOURCES,
  PHONE_CONFIDENCE,
  ADDRESS_CONFIDENCE,
  looksLikeHighwayAddress,
} from "./services/contactUpsertService";

// ── Config ────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1_000; // every 6 hours
const STAGGER_BETWEEN_MS = 5_000;             // 5s between counties
const DEFAULT_DAYS_BACK = 7;

interface ClerkPortal {
  county: "LEE" | "COLLIER" | "CHARLOTTE";
  portalUrl: string;
}

// Public traffic case-search portals. The Apify actor navigates these.
const CLERK_PORTALS: ClerkPortal[] = [
  { county: "LEE",       portalUrl: "https://matrix.leeclerk.org/" },
  { county: "COLLIER",   portalUrl: "https://cocclerk.com/court-records/" },
  { county: "CHARLOTTE", portalUrl: "https://www.charlotteclerk.com/court-records" },
];

/** Charges that indicate the citation was issued at a vehicle crash. */
const CRASH_CHARGE_PATTERNS = [
  "CRASH", "ACCIDENT", "CARELESS", "RECKLESS", "FAIL TO YIELD",
  "FAILURE TO YIELD", "FOLLOWING TOO CLOSE", "FOLLOW TOO CLOSE",
  "IMPROPER LANE", "RAN RED", "RED LIGHT", "STOP SIGN", "DUI",
  "LEAVING THE SCENE", "LEAVE THE SCENE", "HIT AND RUN", "HIT & RUN",
  "DRIVING UNDER", "VEHICULAR", "DEATH", "SERIOUS BODILY",
];

/** A row the Apify clerk actor must emit into its default dataset. */
export interface ClerkCitationRow {
  caseNumber: string;
  defendantName: string;        // "LAST, FIRST M" or "FIRST LAST"
  defendantAddress?: string | null;
  defendantCity?: string | null;
  defendantState?: string | null;
  defendantZip?: string | null;
  citationDate?: string | null; // ISO-ish "YYYY-MM-DD"
  county: string;
  chargeText?: string | null;
  citingAgency?: string | null; // "FHP" | "Cape Coral PD" | ...
  offenseLocation?: string | null;
}

export interface ClerkEnrichStats {
  county: string;
  citationsReturned: number;
  crashRelated: number;
  leadsUpserted: number;
  skipped: number;
  errors: string[];
}

// ── Apify helpers (same pattern as apifyLeadScrapers.ts) ──────────────────────

async function startApifyRun(token: string, actorId: string, input: Record<string, unknown>): Promise<string> {
  const res = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Apify start failed (${actorId}): ${res.status} ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data: { id: string } };
  return data.data.id;
}

async function waitForRun(token: string, runId: string, maxWaitMs = 5 * 60_000): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000));
    const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as { data: { status: string; defaultDatasetId: string } };
    if (data.data.status === "SUCCEEDED") return data.data.defaultDatasetId;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(data.data.status)) {
      throw new Error(`Apify run ${runId} ended: ${data.data.status}`);
    }
  }
  throw new Error(`Apify run ${runId} timed out`);
}

async function fetchDataset<T>(token: string, datasetId: string, limit = 1000): Promise<T[]> {
  const res = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?limit=${limit}&format=json`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Dataset fetch failed: ${res.status}`);
  return (await res.json()) as T[];
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

function isCrashRelatedCharge(chargeText: string | null | undefined): boolean {
  if (!chargeText) return false;
  const upper = chargeText.toUpperCase();
  return CRASH_CHARGE_PATTERNS.some((kw) => upper.includes(kw));
}

/** Splits a clerk name ("LAST, FIRST M" or "FIRST LAST") into first/last. */
export function splitClerkName(raw: string): { firstName: string; lastName: string } {
  const name = (raw || "").trim().replace(/\s+/g, " ");
  if (!name) return { firstName: "", lastName: "" };
  if (name.includes(",")) {
    const [last, rest] = name.split(",", 2);
    const firstParts = (rest || "").trim().split(" ");
    return { firstName: (firstParts[0] || "").trim(), lastName: last.trim() };
  }
  const parts = name.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function buildClerkAddress(row: ClerkCitationRow): string | null {
  const parts = [row.defendantAddress, row.defendantCity, row.defendantState, row.defendantZip]
    .map((p) => (p || "").trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const joined = parts.join(", ");
  // A court mailing address must never be a roadway string.
  return looksLikeHighwayAddress(joined) ? null : joined;
}

// ── Output (a): standalone clerk_traffic leads ────────────────────────────────

async function upsertCitationLead(row: ClerkCitationRow, subAccountId: number): Promise<boolean> {
  const { firstName, lastName } = splitClerkName(row.defendantName);
  if (!firstName && !lastName) return false;

  const address = buildClerkAddress(row);
  const citingAgency = (row.citingAgency || "").trim();

  // The citation defendant is the AT-FAULT driver, not the (unknown) victim.
  // Tag honestly so downstream routing treats it correctly.
  const tags = ["clerk-enriched", "at_fault_driver", `clerk:${row.county.toUpperCase()}`];

  await upsertContact({
    subAccountId,
    firstName,
    lastName,
    source: CONTACT_SOURCES.CLERK_TRAFFIC,
    leadVertical: "personal_injury",
    leadSubtype: "crash",
    county: row.county.toUpperCase(),
    sourceExternalId: `clerk:${row.county.toUpperCase()}:${row.caseNumber}`,
    rawSourceType: "clerk_traffic_citation",
    tags,
    address: address ?? undefined,
    addressConfidence: address ? ADDRESS_CONFIDENCE.FLHSMV_LICENSE : ADDRESS_CONFIDENCE.UNKNOWN,
    addressType: address ? "court_filing" : undefined,
    addressSource: "clerk_traffic",
    incidentLocation: row.offenseLocation ?? undefined,
    identityStatus: "verified",
    isPlaceholder: false,
    viewClass: "opportunity_lead",
    workflowStage: "new",
    enrichmentProvider: "clerk_traffic",
    enrichmentCompletedAt: new Date(),
    notes:
      `Public traffic citation ${row.caseNumber} (${row.county} County). ` +
      `Charge: ${row.chargeText || "n/a"}. ` +
      `Citing agency: ${citingAgency || "n/a"}. Citation date: ${row.citationDate || "n/a"}.`,
  } as any);
  return true;
}

// ── Core: scrape one county's clerk portal ────────────────────────────────────

async function enrichCounty(
  portal: ClerkPortal,
  actorId: string,
  token: string,
  daysBack: number,
): Promise<ClerkEnrichStats> {
  const stats: ClerkEnrichStats = {
    county: portal.county,
    citationsReturned: 0,
    crashRelated: 0,
    leadsUpserted: 0,
    skipped: 0,
    errors: [],
  };

  // Route clerk leads to the SWFL PI account(s).
  const subAccountId = [...CRASH_LEAD_ACCOUNT_IDS][0] ?? 3;

  try {
    console.log(`[CLERK-ENRICH] ${portal.county}: starting Apify actor (daysBack=${daysBack})`);
    const runId = await startApifyRun(token, actorId, {
      county: portal.county,
      portalUrl: portal.portalUrl,
      daysBack,
    });
    const datasetId = await waitForRun(token, runId);
    const rows = await fetchDataset<ClerkCitationRow>(token, datasetId);
    stats.citationsReturned = rows.length;

    for (const row of rows) {
      if (!row || !row.caseNumber || !row.defendantName || !row.county) {
        stats.skipped++;
        continue;
      }
      if (!isCrashRelatedCharge(row.chargeText)) {
        stats.skipped++;
        continue;
      }
      stats.crashRelated++;
      try {
        const ok = await upsertCitationLead(row, subAccountId);
        if (ok) stats.leadsUpserted++;
        else stats.skipped++;
      } catch (err: any) {
        stats.errors.push(`${row.caseNumber}: ${err.message}`);
      }
    }

    console.log(
      `[CLERK-ENRICH] ${portal.county}: ${stats.citationsReturned} citation(s) → ` +
      `${stats.crashRelated} crash-related → ${stats.leadsUpserted} lead(s) upserted`,
    );
  } catch (err: any) {
    stats.errors.push(err.message);
    console.error(`[CLERK-ENRICH] ${portal.county} failed (non-fatal): ${err.message}`);
  }

  return stats;
}

// ── Public entrypoint ─────────────────────────────────────────────────────────

export interface RunClerkEnrichOptions {
  /** Restrict to specific counties (default: all three). */
  counties?: Array<"LEE" | "COLLIER" | "CHARLOTTE">;
  /** How many days of citations to pull (default 7). */
  daysBack?: number;
}

export async function runClerkTrafficEnrich(
  options: RunClerkEnrichOptions = {},
): Promise<ClerkEnrichStats[]> {
  const token = resolveApifyToken();
  const actorId = (process.env.APIFY_CLERK_TRAFFIC_ACTOR_ID || "").trim();

  if (!token) {
    console.warn("[CLERK-ENRICH] APIFY_API_KEY not set — clerk traffic enrichment disabled");
    return [];
  }
  if (!actorId) {
    console.warn(
      "[CLERK-ENRICH] APIFY_CLERK_TRAFFIC_ACTOR_ID not set — clerk traffic enrichment is a " +
      "no-op until the Apify Playwright actor is built and its id is configured in Railway",
    );
    return [];
  }

  const daysBack = options.daysBack ?? DEFAULT_DAYS_BACK;
  const portals = options.counties
    ? CLERK_PORTALS.filter((p) => options.counties!.includes(p.county))
    : CLERK_PORTALS;

  const allStats: ClerkEnrichStats[] = [];
  for (let i = 0; i < portals.length; i++) {
    const stats = await enrichCounty(portals[i], actorId, token, daysBack);
    allStats.push(stats);
    if (i < portals.length - 1) {
      await new Promise((r) => setTimeout(r, STAGGER_BETWEEN_MS));
    }
  }

  const totalLeads = allStats.reduce((s, x) => s + x.leadsUpserted, 0);
  const totalErrors = allStats.reduce((s, x) => s + x.errors.length, 0);
  recordApifyRun(totalLeads, "clerk-traffic-enrich", totalErrors > 0 ? `${totalErrors} errors` : null);
  return allStats;
}

// ── Output (b): scored placeholder back-fill (GATED — dry-run by default) ──────

export interface PlaceholderMatch {
  contactId: number;
  caseNumber: string;
  defendantName: string;
  score: number;
  breakdown: string;
}

/**
 * Scores a citation against a placeholder crash contact. Mirrors the
 * conservative philosophy of crashReportWorker.scoreCandidate(): a hard county
 * gate, then additive signals. Below MIN_MATCH_SCORE we never link — wrong
 * linkage is worse than no linkage.
 */
const MIN_CLERK_MATCH_SCORE = 45;

export function scoreClerkMatch(
  row: ClerkCitationRow,
  placeholder: { county: string | null; incidentLocation: string | null; createdAt: Date | string | null },
): { score: number; breakdown: string } {
  const signals: string[] = [];
  let score = 0;

  // Hard gate: county must match exactly.
  const rowCounty = (row.county || "").toUpperCase().replace(/\s+county$/i, "").trim();
  const phCounty = (placeholder.county || "").toUpperCase().replace(/\s+county$/i, "").trim();
  if (!rowCounty || !phCounty || rowCounty !== phCounty) {
    return { score: 0, breakdown: "county mismatch — gate failed" };
  }
  score += 20;
  signals.push("county+20");

  // Date proximity: citation date within ±2 days of the placeholder's ingest date.
  if (row.citationDate && placeholder.createdAt) {
    const cit = new Date(row.citationDate).getTime();
    const ing = new Date(placeholder.createdAt).getTime();
    if (!isNaN(cit) && !isNaN(ing)) {
      const days = Math.abs(cit - ing) / (24 * 60 * 60 * 1000);
      if (days <= 2) {
        score += 25;
        signals.push(`date(Δ${days.toFixed(1)}d)+25`);
      }
    }
  }

  // Location word overlap between the citation offense location and the
  // placeholder's incidentLocation (the crash scene).
  const STOP = new Set(["NORTH","SOUTH","EAST","WEST","COUNTY","FLORIDA","ROAD","STREET","AVE","BLVD","FL","THE","AND"]);
  const tokens = (s: string) =>
    s.toUpperCase().split(/[\s,/\[\]]+/).filter((w) => w.length > 3 && !STOP.has(w));
  if (row.offenseLocation && placeholder.incidentLocation) {
    const a = tokens(row.offenseLocation);
    const b = new Set(tokens(placeholder.incidentLocation));
    const overlap = a.filter((w) => b.has(w));
    if (overlap.length >= 2) {
      score += 25;
      signals.push(`location(${overlap.slice(0, 3).join(",")})+25`);
    } else if (overlap.length === 1) {
      score += 10;
      signals.push(`location(${overlap[0]})+10`);
    }
  }

  return { score, breakdown: signals.join(" | ") || "no signals" };
}

/**
 * Finds candidate placeholder back-fill matches for a batch of citations.
 * Pure read + scoring — performs NO writes. The retro endpoint decides whether
 * to apply them (dry-run by default).
 */
export async function matchCitationsToPlaceholders(
  rows: ClerkCitationRow[],
): Promise<PlaceholderMatch[]> {
  const crashRows = rows.filter((r) => r && r.caseNumber && r.defendantName && isCrashRelatedCharge(r.chargeText));
  if (crashRows.length === 0) return [];

  // Pull current placeholder crash contacts (county encoded in last_name '— X').
  const placeholders = await db
    .select({
      id: contacts.id,
      county: contacts.county,
      lastName: contacts.lastName,
      incidentLocation: contacts.incidentLocation,
      createdAt: contacts.createdAt,
    })
    .from(contacts)
    .where(sql`source = ${CONTACT_SOURCES.CRASH} AND is_placeholder = true`);

  const matches: PlaceholderMatch[] = [];
  for (const row of crashRows) {
    for (const ph of placeholders) {
      const county = ph.county || (ph.lastName || "").replace(/^—\s*/, "").trim() || null;
      const { score, breakdown } = scoreClerkMatch(row, {
        county,
        incidentLocation: ph.incidentLocation,
        createdAt: ph.createdAt,
      });
      if (score >= MIN_CLERK_MATCH_SCORE) {
        matches.push({
          contactId: ph.id,
          caseNumber: row.caseNumber,
          defendantName: row.defendantName,
          score,
          breakdown,
        });
      }
    }
  }
  return matches;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let schedulerStarted = false;

export function startClerkTrafficScheduler(): void {
  if (schedulerStarted) {
    console.log("[CLERK-ENRICH] Scheduler already running");
    return;
  }
  schedulerStarted = true;
  console.log(`[CLERK-ENRICH] Scheduler started — every ${POLL_INTERVAL_MS / 3_600_000}h (LEE/COLLIER/CHARLOTTE)`);

  // Fire once shortly after boot, then on the interval.
  setTimeout(() => {
    runClerkTrafficEnrich().catch((err) =>
      console.error("[CLERK-ENRICH] Initial run failed (non-fatal):", err.message),
    );
  }, 60_000);

  setInterval(() => {
    runClerkTrafficEnrich().catch((err) =>
      console.error("[CLERK-ENRICH] Scheduled run failed (non-fatal):", err.message),
    );
  }, POLL_INTERVAL_MS);
}

/** Stable hash helper — exported for the retro endpoint's audit logging. */
export function clerkRunId(): string {
  return crypto.randomUUID().slice(0, 8);
}
