// @ts-nocheck
/**
 * courtListenerPipeline.ts
 *
 * Polls CourtListener REST API for FL bankruptcy filings.
 * Three courts, every 6 hours:
 *   flmb — U.S. Bankruptcy Court, M.D. Florida (Tampa / Orlando / Fort Myers area)
 *   flsb — U.S. Bankruptcy Court, S.D. Florida (Miami / Fort Lauderdale / West Palm)
 *   flnb — U.S. Bankruptcy Court, N.D. Florida (Tallahassee / Pensacola / Gainesville)
 *
 * Data flow:
 *   CourtListener REST API
 *     → legalSignals (signalType = "bankruptcy_filing")
 *     → legalLeads
 *     → CRM contacts tagged: bankruptcy-lead, chapter-7 / chapter-13, sentinel-auto
 *
 * Env vars:
 *   COURTLISTENER_API_TOKEN  (optional — increases rate limit from ~50/day to thousands)
 *
 * Dedup: permanent by docket_number (one CRM contact per bankruptcy case, never re-inserted)
 * Skip trace: BatchData (BATCHDATA_API_KEY / BATCH_DATA) — fires on individual debtors
 *
 * Rate-limit safety: 3 courts × 1 page each = 3 API calls per cycle at free tier.
 * With token: no meaningful limit for this volume.
 */

import * as crypto from "crypto";
import { db } from "./db";
import { legalSignals, legalLeads, subAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { resolveBatchDataKey, resolveCourtListenerToken } from "./vendorConfig";

// ── Constants ─────────────────────────────────────────────────────────────────

const PIPELINE_TAG    = "COURTLISTENER";
const POLL_INTERVAL   = 6 * 60 * 60 * 1000; // 6 hours
const PAGE_SIZE       = 100;
const API_BASE        = "https://www.courtlistener.com/api/rest/v4";

/** Bankruptcy courts in Florida — all three districts */
const FL_BANKRUPTCY_COURTS = [
  { id: "flmb", label: "M.D. Florida", district: "MIDDLE DISTRICT" },
  { id: "flsb", label: "S.D. Florida", district: "SOUTHERN DISTRICT" },
  { id: "flnb", label: "N.D. Florida", district: "NORTHERN DISTRICT" },
] as const;

/** Words that indicate a business filing — skip these */
const BUSINESS_INDICATORS = [
  "LLC", "L.L.C", "Inc.", "Inc,", "Corp.", "Corp,", "Ltd.", "Ltd,",
  "LLP", "L.L.P", "PLLC", "P.L.L.C", "P.A.", "PA,", "Company",
  "Trust", "Estate of", "Revocable", "Partnership", "Associates",
  "Group", "Holdings", "Enterprises", "Services", "Solutions",
  "Management", "Properties", "Realty",
];

// ── Env & auth ────────────────────────────────────────────────────────────────

// BatchData + CourtListener keys resolved via vendorConfig — single source of truth.

function buildAuthHeaders(): Record<string, string> {
  const token = resolveCourtListenerToken();
  const base: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "ApexMarketingAutomations/1.0 (bankruptcy-lead-pipeline)",
  };
  if (token) base["Authorization"] = `Token ${token}`;
  return base;
}

// ── API client ────────────────────────────────────────────────────────────────

interface CourtListenerDocket {
  caseName:      string;
  docketNumber:  string;
  dateFiled:     string;
  chapter?:      string;
  court_id?:     string;
  pacer_case_id?: string;
  party?:        string[];
}

interface CourtListenerSearchResponse {
  count:   number;
  next:    string | null;
  results: CourtListenerDocket[];
}

async function fetchBankruptcyFilings(
  courtId: string,
  filedAfter: string,
): Promise<CourtListenerDocket[]> {
  const params = new URLSearchParams({
    type:        "d",
    court:       courtId,
    filed_after: filedAfter,
    order_by:    "dateFiled desc",
    page_size:   String(PAGE_SIZE),
    fields:      "caseName,docketNumber,dateFiled,chapter,court_id,pacer_case_id,party",
  });

  const url = `${API_BASE}/search/?${params}`;

  try {
    const res = await fetch(url, {
      headers: buildAuthHeaders(),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      // allow-silent-catch: non-critical body read for error logging
      const body = await res.text().catch(() => "");
      console.error(`[${PIPELINE_TAG}] API ${res.status} for court=${courtId}: ${body.slice(0, 200)}`);
      return [];
    }

    const data = (await res.json()) as CourtListenerSearchResponse;
    return Array.isArray(data.results) ? data.results : [];
  } catch (err: any) {
    console.error(`[${PIPELINE_TAG}] Fetch error court=${courtId}: ${err.message}`);
    return [];
  }
}

// ── Name parsing ──────────────────────────────────────────────────────────────

function isBusinessFiling(caseName: string): boolean {
  const upper = caseName.toUpperCase();
  return BUSINESS_INDICATORS.some(word => upper.includes(word.toUpperCase()));
}

/** Returns the primary individual debtor name (first person listed). */
function extractDebtorName(caseName: string): string | null {
  if (isBusinessFiling(caseName)) return null;

  // "John Smith and Jane Smith" → take first person
  const andIdx = caseName.toLowerCase().indexOf(" and ");
  const primaryName = andIdx > 0 ? caseName.slice(0, andIdx).trim() : caseName.trim();

  // Require at least first + last name
  const parts = primaryName.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;

  return primaryName;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const lastName  = parts[parts.length - 1];
  const firstName = parts.slice(0, -1).join(" ");
  return { firstName, lastName };
}

// ── Dedup ─────────────────────────────────────────────────────────────────────

function buildDocketHash(docketNumber: string): string {
  return crypto
    .createHash("sha256")
    .update(`bankruptcy|${docketNumber}`)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
}

async function isDuplicate(hash: string): Promise<boolean> {
  const [row] = await db.select({ id: legalSignals.id })
    .from(legalSignals)
    .where(eq(legalSignals.sourceHash, hash))
    .limit(1);
  return !!row;
}

// ── Skip trace ────────────────────────────────────────────────────────────────

async function skipTraceDebtor(firstName: string, lastName: string): Promise<string | null> {
  const key = resolveBatchDataKey();
  if (!key) return null;

  try {
    const res = await fetch("https://api.batchdata.com/api/v1/property/skip-trace/name", {
      method:  "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ firstName, lastName, state: "FL" }),
      signal:  AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // BatchData returns phones under results[].phones[] or similar
    const phone =
      data?.results?.[0]?.phones?.[0]?.number ||
      data?.results?.[0]?.phone ||
      data?.phone ||
      null;
    return phone || null;
  // allow-silent-catch: skip trace failure is non-fatal — returns null
  } catch {
    return null;
  }
}

// ── Lead delivery ─────────────────────────────────────────────────────────────

async function getAllEnabledAccountIds(): Promise<number[]> {
  try {
    const { pool } = await import("./db");
    const r = await pool.query(
      "SELECT sub_account_id FROM sentinel_config WHERE enabled = true LIMIT 200"
    );
    return r.rows.map((row: { sub_account_id: number }) => row.sub_account_id);
  // allow-silent-catch: fallback to parent account on DB error
  } catch {
    // Fallback to parent account
    return [parseInt(process.env.APEX_PARENT_ACCOUNT_ID || "3")];
  }
}

async function deliverToAccounts(lead: any, subjectPhone: string | null): Promise<void> {
  const accountIds = await getAllEnabledAccountIds();
  const { storage } = await import("./storage");

  const chapter    = lead.chapter ? `chapter-${lead.chapter}` : "bankruptcy";
  const tags       = ["bankruptcy-lead", chapter, "sentinel-auto"].filter(Boolean);
  const { firstName, lastName } = splitName(lead.subjectName);

  for (const subAccountId of accountIds) {
    try {
      await storage.createContact({
        subAccountId,
        firstName,
        lastName,
        phone:   subjectPhone || undefined,
        source:  "sentinel_bankruptcy",
        channel: "automated",
        tags,
        notes: `Bankruptcy filing — ${lead.chapter ? `Chapter ${lead.chapter}` : "Unknown chapter"} | Docket: ${lead.caseNumber} | Court: ${lead.courtName} | Filed: ${lead.filingDate}`,
      });

      // Report to Apex Intelligence brain
      import("./operator/apexIntelligence").then(({ reportOutcome }) =>
        reportOutcome({
          agentName:    "courtlistener-pipeline",
          action:       "contact_created",
          subject:      `${firstName} ${lastName}`.trim(),
          result:       `Bankruptcy Ch.${lead.chapter || "?"} lead routed — ${lead.courtName} (${lead.caseNumber})`,
          confidence:   0.65,
          subAccountId,
          niche:        "bankruptcy",
          metadata: {
            caseNumber:  lead.caseNumber,
            chapter:     lead.chapter,
            court:       lead.courtName,
            hasPhone:    !!subjectPhone,
          },
        })
      ).catch((e: any) => console.warn("[APEX-OUTCOME] courtlistener-pipeline reportOutcome error:", e?.message));
    } catch (err: any) {
      console.warn(`[${PIPELINE_TAG}] createContact failed for account ${subAccountId}: ${err.message}`);
    }
  }
}

// ── Main cycle ────────────────────────────────────────────────────────────────

let _lastRunAt: Date | null     = null;
let _lastCycleInserted: number  = 0;
let _lastCycleSkipped: number   = 0;
let _totalInsertedEver: number  = 0;

export function getCourtListenerPipelineStats() {
  return {
    lastRunAt:          _lastRunAt?.toISOString() ?? null,
    lastCycleInserted:  _lastCycleInserted,
    lastCycleSkipped:   _lastCycleSkipped,
    totalInsertedEver:  _totalInsertedEver,
    tokenConfigured:    !!resolveCourtListenerToken(),
    batchDataAvailable: !!resolveBatchDataKey(),
  };
}

async function runBankruptcyCycle(): Promise<void> {
  _lastRunAt = new Date();
  _lastCycleInserted = 0;
  _lastCycleSkipped  = 0;

  // Poll from yesterday at minimum (catches any filings missed since last run)
  const lookbackMs   = POLL_INTERVAL + 60 * 60 * 1000; // interval + 1h buffer
  const filedAfter   = new Date(Date.now() - lookbackMs).toISOString().slice(0, 10);

  console.log(`[${PIPELINE_TAG}] Cycle started — polling 3 FL bankruptcy courts since ${filedAfter}`);

  for (const court of FL_BANKRUPTCY_COURTS) {
    const filings = await fetchBankruptcyFilings(court.id, filedAfter);
    console.log(`[${PIPELINE_TAG}] ${court.label}: ${filings.length} filings fetched`);

    for (const filing of filings) {
      try {
        const debtorName = extractDebtorName(filing.caseName || "");
        if (!debtorName) {
          _lastCycleSkipped++;
          continue; // business filing or unparseable
        }

        const hash = buildDocketHash(filing.docketNumber);
        if (await isDuplicate(hash)) {
          _lastCycleSkipped++;
          continue;
        }

        const chapter      = filing.chapter || null;
        const filingDate   = filing.dateFiled || new Date().toISOString().slice(0, 10);
        const { firstName, lastName } = splitName(debtorName);

        // Skip trace the debtor
        const phone = await skipTraceDebtor(firstName, lastName);

        // Insert legalSignal
        const [signal] = await db.insert(legalSignals).values({
          sourceHash:        hash,
          signalType:        "bankruptcy_filing",
          legalVertical:     "bankruptcy",
          county:            court.district,
          subjectName:       debtorName,
          subjectPhone:      phone || undefined,
          caseNumber:        filing.docketNumber,
          courtName:         `U.S. Bankruptcy Court, ${court.label}`,
          filingDate,
          urgency:           "high",   // bankruptcy = time-sensitive for attorneys
          status:            "raw",
          rawData: {
            caseName:     filing.caseName,
            docketNumber: filing.docketNumber,
            chapter,
            courtId:      court.id,
            pacerCaseId:  filing.pacer_case_id,
            dateFiled:    filingDate,
            parties:      filing.party,
            source:       "courtlistener",
          },
          detectedAt: new Date(),
        }).returning();

        // Insert legalLead
        const [lead] = await db.insert(legalLeads).values({
          signalId:          signal.id,
          legalVertical:     "bankruptcy",
          signalType:        "bankruptcy_filing",
          county:            court.district,
          subjectName:       debtorName,
          subjectPhone:      phone || undefined,
          caseNumber:        filing.docketNumber,
          chargeDescription: chapter ? `Chapter ${chapter} Bankruptcy Filing` : "Bankruptcy Filing",
          urgency:           "high",
          score:             70,   // baseline score — bankruptcy = high attorney need
          status:            "available",
          expiresAt:         new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          rawData: {
            caseName:  filing.caseName,
            chapter,
            courtId:   court.id,
            dateFiled: filingDate,
            source:    "courtlistener",
          },
          detectedAt: new Date(),
        }).returning();

        // Update signal → linked to lead
        await db.update(legalSignals)
          .set({ status: "qualified", score: 70, leadId: lead.id })
          .where(eq(legalSignals.id, signal.id));

        // Deliver to all Sentinel-enabled accounts
        await deliverToAccounts(
          { ...lead, subjectName: debtorName, chapter, caseNumber: filing.docketNumber, courtName: `U.S. Bankruptcy Court, ${court.label}`, filingDate },
          phone
        );

        _lastCycleInserted++;
        _totalInsertedEver++;

        console.log(`[${PIPELINE_TAG}] ✅ ${court.id} | ${debtorName} | Ch.${chapter || "?"} | ${filing.docketNumber}${phone ? " | phone ✓" : ""}`);

      } catch (err: any) {
        console.warn(`[${PIPELINE_TAG}] Processing error for ${filing.docketNumber}: ${err.message}`);
      }
    }
  }

  console.log(
    `[${PIPELINE_TAG}] Cycle complete — inserted=${_lastCycleInserted} skipped=${_lastCycleSkipped} total=${_totalInsertedEver}`
  );
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _schedulerStarted = false;

export function startCourtListenerScheduler(): void {
  if (_schedulerStarted) return;
  _schedulerStarted = true;

  const token = resolveCourtListenerToken();
  const bd    = resolveBatchDataKey();

  console.log(`[${PIPELINE_TAG}] Starting scheduler — token=${!!token} batchData=${!!bd} interval=6h`);
  if (!token) {
    console.warn(`[${PIPELINE_TAG}] No COURTLISTENER_API_TOKEN set — using free tier (rate-limited). Set this env var for production volume.`);
  }

  // First run after 30s delay (let DB settle at startup)
  setTimeout(() => {
    runBankruptcyCycle().catch(err =>
      console.error(`[${PIPELINE_TAG}] Initial cycle error:`, err.message)
    );
  }, 30_000);

  // Repeat every 6 hours
  setInterval(() => {
    runBankruptcyCycle().catch(err =>
      console.error(`[${PIPELINE_TAG}] Cycle error:`, err.message)
    );
  }, POLL_INTERVAL);
}
