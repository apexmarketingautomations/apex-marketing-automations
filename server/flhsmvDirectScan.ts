/**
 * FLHSMV Direct Scan
 *
 * Polls the FLHSMV CRR SearchReport API by county + date to discover crash
 * reports from ALL FL agencies — FHP, LCSO, Cape Coral PD, Fort Myers PD,
 * Naples PD, Charlotte County SO, etc. — without requiring a prior CAD signal.
 *
 * WHY THIS EXISTS
 * ---------------
 * The sentinel pipeline's primary detection path (FHP live incidents feed +
 * LCSO CAD) misses crashes handled by city police departments that have no
 * public CAD feed. These crashes (Cape Coral PD, Fort Myers PD, Naples PD, etc.)
 * ARE submitted to FLHSMV within 24–48 hours of the incident. This scanner
 * polls FLHSMV directly and creates PENDING crash_reports for every new
 * official report number found, so:
 *
 *   1. The crashReportWorker picks them up immediately (short-circuits search)
 *   2. Full FLHSMV detail is fetched (driver name, address, vehicle, narrative)
 *   3. Contacts are created with real data — no placeholder stage needed
 *   4. Police report PDF is available on demand via /api/crash-reports/:id/pdf
 *
 * DEDUP STRATEGY
 * --------------
 * Checks crash_reports.official_report_number before inserting. If a sentinel_auto
 * or sentinel_followup job already discovered the same FLHSMV report, the direct
 * scan silently skips it. No duplicate crash_reports are created.
 *
 * CREDIT COST
 * -----------
 * Each county+date call goes through ScrapingBee (FLHSMV blocks datacenter IPs).
 * Scheduled runs scan the last 3 days × 5 counties = 15 ScrapingBee calls per tick.
 * The initial scan covers 14 days × 5 counties = 70 calls (one-time cost).
 */

import crypto from "crypto";
import { db } from "./db";
import { crashReports } from "@shared/schema";
import { eq } from "drizzle-orm";
import { proxiedFetch } from "./scrapingBeeClient";

const FLHSMV_BASE = "https://services.flhsmv.gov";
const FLHSMV_SEARCH_URL = `${FLHSMV_BASE}/CRRService/api/CrashReport/SearchReport`;

// SWFL personal-injury target counties — all FL agencies in these counties file with FLHSMV
const SCAN_COUNTIES = ["LEE", "COLLIER", "CHARLOTTE", "SARASOTA", "MANATEE"];

// Scan the last 14 days on startup to catch any backlogged reports
const SCAN_DAYS_BACK_INITIAL = 14;

// Scheduled runs only scan the last 3 days (local agencies file within 48h; this gives buffer)
const SCAN_DAYS_BACK_SCHEDULED = 3;

// Run every 2 hours — catches local agency reports shortly after filing
const SCAN_INTERVAL_MS = 2 * 60 * 60 * 1000;

const flhsmvFetch = (targetUrl: string, init: RequestInit = {}) =>
  proxiedFetch(targetUrl, init, { renderJs: false, countryCode: "us" });

function buildDirectScanKey(officialReportNumber: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`flhsmv_direct:${officialReportNumber}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `FLHSMV-DIRECT-${hash}`;
}

async function officialNumberAlreadyExists(officialReportNumber: string): Promise<boolean> {
  const rows = await db
    .select({ id: crashReports.id })
    .from(crashReports)
    .where(eq(crashReports.officialReportNumber, officialReportNumber))
    .limit(1);
  return rows.length > 0;
}

export interface DirectScanStats {
  county: string;
  date: string;
  fetched: number;
  created: number;
  alreadyExists: number;
  failed: number;
}

/**
 * Scan FLHSMV for all crash reports in a given county on a given date.
 * Creates a PENDING crash_report for each new report number found.
 */
export async function scanCountyDate(
  county: string,
  crashDate: string,
  subAccountId: number,
  dryRun = false,
): Promise<DirectScanStats> {
  const stats: DirectScanStats = { county, date: crashDate, fetched: 0, created: 0, alreadyExists: 0, failed: 0 };

  let searchData: any[];
  try {
    const resp = await flhsmvFetch(FLHSMV_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
        "Origin": FLHSMV_BASE,
        "Referer": `${FLHSMV_BASE}/crashreportrequest/`,
      },
      body: JSON.stringify({ County: county.toUpperCase(), CrashDate: crashDate }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      console.warn(`[DIRECT-SCAN] FLHSMV returned HTTP ${resp.status} for ${county}/${crashDate}`);
      stats.failed++;
      return stats;
    }

    const json = await resp.json();
    searchData = Array.isArray(json) ? json : (json?.ReportNumber ? [json] : []);
  } catch (err: any) {
    console.warn(`[DIRECT-SCAN] Network error for ${county}/${crashDate}: ${err.message}`);
    stats.failed++;
    return stats;
  }

  stats.fetched = searchData.length;

  for (const result of searchData) {
    const officialReportNumber: string | undefined = result?.ReportNumber;
    if (!officialReportNumber) {
      stats.failed++;
      continue;
    }

    try {
      const exists = await officialNumberAlreadyExists(officialReportNumber);
      if (exists) {
        stats.alreadyExists++;
        continue;
      }

      if (!dryRun) {
        const reportNumber = buildDirectScanKey(officialReportNumber);

        // Belt-and-suspenders: also check synthetic key
        const existsBySynth = await db
          .select({ id: crashReports.id })
          .from(crashReports)
          .where(eq(crashReports.reportNumber, reportNumber))
          .limit(1);
        if (existsBySynth.length > 0) {
          stats.alreadyExists++;
          continue;
        }

        await db.insert(crashReports).values({
          reportNumber,
          officialReportNumber,
          source: "flhsmv_direct_scan",
          status: "PENDING",
          subAccountId,
          retryCount: 0,
          serviceFailureCount: 0,
          processedToLead: false,
          data: {
            county,
            crashDate,
            officialReportNumber,
            searchResult: result,
            discoveredBy: "flhsmv_direct_scan",
            scannedAt: new Date().toISOString(),
          },
        });
      }

      stats.created++;
    } catch (err: any) {
      console.warn(`[DIRECT-SCAN] DB error for ${officialReportNumber}: ${err.message}`);
      stats.failed++;
    }
  }

  console.log(
    `[DIRECT-SCAN] ${county}/${crashDate}: fetched=${stats.fetched} ` +
    `created=${stats.created} exists=${stats.alreadyExists} failed=${stats.failed}${dryRun ? " [DRY RUN]" : ""}`,
  );
  return stats;
}

export interface DirectScanRunResult {
  counties: string[];
  daysBack: number;
  dryRun: boolean;
  totalFetched: number;
  totalCreated: number;
  totalAlreadyExists: number;
  totalFailed: number;
  byCountyDate: DirectScanStats[];
}

/**
 * Run a full direct scan across the given counties and date range.
 * Called at startup (daysBack=14) and on the 2h schedule (daysBack=3).
 */
export async function runDirectScan(options: {
  counties?: string[];
  daysBack?: number;
  subAccountId?: number;
  dryRun?: boolean;
} = {}): Promise<DirectScanRunResult> {
  const counties = options.counties ?? SCAN_COUNTIES;
  const daysBack = options.daysBack ?? SCAN_DAYS_BACK_SCHEDULED;
  const dryRun   = options.dryRun ?? false;

  let subAccountId = options.subAccountId;
  if (!subAccountId) {
    try {
      const { getActiveAccountIds } = await import("./crashIngestPipeline");
      const accounts = await getActiveAccountIds();
      subAccountId = accounts.length > 0 ? [...accounts].sort((a, b) => a - b)[0] : 3;
    } catch {
      subAccountId = 3;
    }
  }

  const byCountyDate: DirectScanStats[] = [];
  let totalFetched = 0;
  let totalCreated = 0;
  let totalAlreadyExists = 0;
  let totalFailed = 0;

  for (const county of counties) {
    for (let d = 0; d < daysBack; d++) {
      const date = new Date(Date.now() - d * 86_400_000);
      const crashDate = date.toISOString().split("T")[0]; // YYYY-MM-DD

      const s = await scanCountyDate(county, crashDate, subAccountId, dryRun);
      byCountyDate.push(s);
      totalFetched      += s.fetched;
      totalCreated      += s.created;
      totalAlreadyExists += s.alreadyExists;
      totalFailed       += s.failed;

      // Polite pause between requests — don't hammer FLHSMV
      await new Promise(r => setTimeout(r, 400));
    }
  }

  console.log(
    `[DIRECT-SCAN] Run complete — counties=${counties.join(",")} daysBack=${daysBack} ` +
    `fetched=${totalFetched} created=${totalCreated} exists=${totalAlreadyExists} failed=${totalFailed}${dryRun ? " [DRY RUN]" : ""}`,
  );

  return { counties, daysBack, dryRun, totalFetched, totalCreated, totalAlreadyExists, totalFailed, byCountyDate };
}

let directScanInterval: ReturnType<typeof setInterval> | null = null;

export function startFLHSMVDirectScanScheduler(): void {
  if (directScanInterval) {
    console.log("[DIRECT-SCAN] Scheduler already running");
    return;
  }

  console.log(
    `[DIRECT-SCAN] Scheduler started — scanning ${SCAN_COUNTIES.join(",")} ` +
    `every ${SCAN_INTERVAL_MS / 3_600_000}h (last ${SCAN_DAYS_BACK_SCHEDULED} days per tick)`,
  );

  const tick = async () => {
    try {
      await runDirectScan({ daysBack: SCAN_DAYS_BACK_SCHEDULED });
    } catch (err: any) {
      console.error("[DIRECT-SCAN] Scheduler tick error:", err.message);
    }
  };

  // Initial backfill: scan last 14 days to catch any reports we missed
  runDirectScan({ daysBack: SCAN_DAYS_BACK_INITIAL }).catch((err: any) =>
    console.error("[DIRECT-SCAN] Initial backfill error:", err.message),
  );

  directScanInterval = setInterval(tick, SCAN_INTERVAL_MS);
}

export function stopFLHSMVDirectScanScheduler(): void {
  if (directScanInterval) {
    clearInterval(directScanInterval);
    directScanInterval = null;
  }
  console.log("[DIRECT-SCAN] Scheduler stopped");
}
