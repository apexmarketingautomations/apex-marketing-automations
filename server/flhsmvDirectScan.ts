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
import { proxiedFetch, scrapingBeeFetch } from "./scrapingBeeClient";
import { nimblePipelineFetch, isNimbleConfigured } from "./nimbleClient";

const FLHSMV_BASE = "https://services.flhsmv.gov";
const FLHSMV_SEARCH_URL = `${FLHSMV_BASE}/CRRService/api/CrashReport/SearchReport`;
export const FLHSMV_PORTAL_URL = `${FLHSMV_BASE}/crashreportrequest/`;

// ── Session state ─────────────────────────────────────────────────────────────
// Single-flight: only one warm-up runs at a time; concurrent callers await it.
// Cooldown: on 500/429, block retries for 10 minutes to avoid hammering FLHSMV.

let _portalCookies = "";
let _portalCookiesFetchedAt = 0;
let _sessionFetchInFlight: Promise<string> | null = null;
let _sessionCooldownUntil = 0;

const PORTAL_COOKIE_TTL_MS  = 20 * 60 * 1000; // 20 min
const SESSION_COOLDOWN_MS   = 10 * 60 * 1000; // 10 min on 500/429

export function bustSessionCache(): void {
  _portalCookies = "";
  _portalCookiesFetchedAt = 0;
  _sessionCooldownUntil = 0;
}

export function isSessionOnCooldown(): { cooldown: boolean; remainingMs: number } {
  const remaining = Math.max(0, _sessionCooldownUntil - Date.now());
  return { cooldown: remaining > 0, remainingMs: remaining };
}

async function doFetchPortalCookies(): Promise<string> {
  // Strategy: Nimble first (it handles Akamai-protected FL government sites),
  // then ScrapingBee stealth as fallback.
  // ScrapingBee error 613 = Akamai kills standard/premium renderer on FLHSMV.

  // ── Nimble attempt ──────────────────────────────────────────────────────────
  if (isNimbleConfigured()) {
    console.log("[FLHSMV-SESSION] warm-up attempt 1 — provider=nimble render=true wait=8000ms");
    const nimbleResult = await nimblePipelineFetch({
      url:     FLHSMV_PORTAL_URL,
      render:  true,
      waitMs:  8000,
      country: "US",
    });
    console.log(
      `[FLHSMV-SESSION] nimble result — status=${nimbleResult.status} ok=${nimbleResult.ok} ` +
      `cookie_count=${(nimbleResult.cookies ?? []).length} ` +
      `cookie_names=[${(nimbleResult.cookies ?? []).map((c: any) => c.name).join(", ")}]`,
    );
    if (nimbleResult.ok || nimbleResult.status < 500) {
      const rawCookies = nimbleResult.cookies ?? [];
      if (rawCookies.length > 0) {
        const cookieHeader = rawCookies.map((c: any) => `${c.name}=${c.value}`).join("; ");
        _portalCookies = cookieHeader;
        _portalCookiesFetchedAt = Date.now();
        _sessionCooldownUntil = 0;
        return cookieHeader;
      }
    } else {
      console.warn(`[FLHSMV-SESSION] Nimble failed — status=${nimbleResult.status} error=${nimbleResult.error ?? "unknown"}`);
    }
  }

  // ── ScrapingBee fallback ─────────────────────────────────────────────────────
  const attempts = [
    { renderJs: true,  blockResources: false, waitMs: 8000  as number | undefined, mode: "stealth"  as const },
    { renderJs: true,  blockResources: false, waitMs: 12000 as number | undefined, mode: "stealth"  as const },
    { renderJs: false, blockResources: false, waitMs: undefined,                   mode: "premium"  as const },
  ];

  for (let i = 0; i < attempts.length; i++) {
    const opts = attempts[i];
    console.log(
      `[FLHSMV-SESSION] warm-up attempt sb${i + 1}/${attempts.length} — ` +
      `mode=${opts.mode} render_js=${opts.renderJs} wait=${opts.waitMs ?? 0}ms`,
    );

    const result = await scrapingBeeFetch({
      url: FLHSMV_PORTAL_URL,
      countryCode: "us",
      mode: opts.mode,
      jsonResponse: true,
      renderJs: opts.renderJs,
      blockResources: opts.blockResources,
      ...(opts.waitMs ? { waitMs: opts.waitMs } : {}),
    });

    console.log(
      `[FLHSMV-SESSION] sb${i + 1} result — mode=${opts.mode} status=${result.status} ` +
      `cookie_count=${(result.cookies ?? []).length} ` +
      `cookie_names=[${(result.cookies ?? []).map((c: any) => c.name).join(", ")}]`,
    );

    if (result.status >= 500) {
      console.warn(`[FLHSMV-SESSION] ScrapingBee sb${i + 1} failed (mode=${opts.mode}) — ${result.error ?? "unknown"}`);
      _sessionCooldownUntil = Date.now() + SESSION_COOLDOWN_MS;
      continue;
    }

    const rawCookies = result.cookies ?? [];
    if (rawCookies.length > 0) {
      const cookieHeader = rawCookies.map((c: any) => `${c.name}=${c.value}`).join("; ");
      _portalCookies = cookieHeader;
      _portalCookiesFetchedAt = Date.now();
      _sessionCooldownUntil = 0;
      return cookieHeader;
    }
  }

  console.warn("[FLHSMV-SESSION] ABORT — no FLHSMV cookies captured after all attempts — not attempting SearchReport");
  return "";
}

export async function getPortalCookies(): Promise<string> {
  const now = Date.now();

  if (_sessionCooldownUntil > now) {
    const remainSec = Math.ceil((_sessionCooldownUntil - now) / 1000);
    console.log(`[FLHSMV-SESSION] provider blocked/cooldown — ${remainSec}s remaining`);
    return "";
  }

  if (_portalCookies && (now - _portalCookiesFetchedAt) < PORTAL_COOKIE_TTL_MS) {
    console.log("[FLHSMV-SESSION] using cached cookies");
    return _portalCookies;
  }

  if (_sessionFetchInFlight) {
    console.log("[FLHSMV-SESSION] waiting for in-flight session fetch");
    return _sessionFetchInFlight;
  }

  console.log("[FLHSMV-SESSION] singleflight acquired");
  _sessionFetchInFlight = doFetchPortalCookies()
    .finally(() => { _sessionFetchInFlight = null; });
  return _sessionFetchInFlight;
}

// SWFL personal-injury target counties — all FL agencies in these counties file with FLHSMV
const SCAN_COUNTIES = ["LEE", "COLLIER", "CHARLOTTE"];

// Scan the last 14 days on startup to catch any backlogged reports
const SCAN_DAYS_BACK_INITIAL = 14;

// FL law gives agencies 10 days to file a crash report; reports won't appear in the CRR
// SearchReport API until after that window closes. Scan 14 days back so every run covers
// at least 4 days of reports that have cleared the filing deadline.
const SCAN_DAYS_BACK_SCHEDULED = 14;

// Run every 2 hours — catches local agency reports shortly after filing
const SCAN_INTERVAL_MS = 2 * 60 * 60 * 1000;

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
  toCrashDate?: string,
): Promise<DirectScanStats> {
  const dateLabel = toCrashDate ? `${crashDate}→${toCrashDate}` : crashDate;
  const stats: DirectScanStats = { county, date: dateLabel, fetched: 0, created: 0, alreadyExists: 0, failed: 0 };

  let searchData: any[];
  try {
    const payload = {
      County: county.toUpperCase(),
      CrashDate: crashDate,
      ToCrashDate: toCrashDate ?? null,
      City: null, CrashStreet: null, ReportNumber: null,
      ReportSection: null, AtFaultDriverLastName: null,
      AtFaultDriverFirstName: null, VehicleVIN: null,
    };
    // Step 1: warm the portal and opportunistically collect session cookies.
    const cookieHeader = await getPortalCookies();

    // Step 2: direct POST to SearchReport with session cookies
    console.log(`[DIRECT-SCAN] Attempting SearchReport POST for ${county}/${dateLabel}`);
    const resp = await proxiedFetch(FLHSMV_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "Origin": FLHSMV_BASE,
        "Referer": FLHSMV_PORTAL_URL,
        ...(cookieHeader ? { "Cookie": cookieHeader } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    }, { renderJs: false, countryCode: "us" });

    if (!resp.ok) {
      if (resp.status === 401) {
        // Cookies expired — bust cache so next call re-fetches
        _portalCookies = "";
        _portalCookiesFetchedAt = 0;
      }
      if (resp.status === 429 || resp.status >= 500) {
        _sessionCooldownUntil = Date.now() + SESSION_COOLDOWN_MS;
        console.log(`[FLHSMV-SESSION] retry_later not report_failed — HTTP ${resp.status} for ${county}/${dateLabel}`);
        return stats;
      }
      console.warn(`[DIRECT-SCAN] FLHSMV returned HTTP ${resp.status} for ${county}/${dateLabel}`);
      stats.failed++;
      return stats;
    }

    const json = await resp.json();
    searchData = Array.isArray(json) ? json : (json?.ReportNumber ? [json] : []);
  } catch (err: any) {
    console.warn(`[DIRECT-SCAN] Error for ${county}/${dateLabel}: ${err.message}`);
    stats.failed++;
    return stats;
  }

  stats.fetched = searchData.length;

  // FLHSMV caps results at 10 per query — if we hit exactly 10, there may be more we missed
  if (searchData.length === 10) {
    console.warn(`[DIRECT-SCAN] ⚠ ${county}/${dateLabel}: got exactly 10 results — FLHSMV may have truncated. Consider narrowing date range.`);
  }

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
    `[DIRECT-SCAN] ${county}/${dateLabel}: fetched=${stats.fetched} ` +
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
    // allow-silent-catch: if account resolution fails, fall back to default sub-account ID 3
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
    const toDate   = new Date(Date.now()).toISOString().split("T")[0];
    const fromDate = new Date(Date.now() - (daysBack - 1) * 86_400_000).toISOString().split("T")[0];

    // First: try one range call covering all days (saves ~13x ScrapingBee credits vs day-by-day)
    const rangeStats = await scanCountyDate(county, fromDate, subAccountId, dryRun, toDate);
    byCountyDate.push(rangeStats);
    totalFetched      += rangeStats.fetched;
    totalCreated      += rangeStats.created;
    totalAlreadyExists += rangeStats.alreadyExists;
    totalFailed       += rangeStats.failed;

    // If we got exactly 10 results, FLHSMV truncated — fall back to day-by-day to catch overflow
    if (rangeStats.fetched === 10) {
      console.warn(`[DIRECT-SCAN] ${county} range hit 10-result cap — falling back to day-by-day scan`);
      for (let d = 0; d < daysBack; d++) {
        const date = new Date(Date.now() - d * 86_400_000).toISOString().split("T")[0];
        const s = await scanCountyDate(county, date, subAccountId, dryRun);
        byCountyDate.push(s);
        totalFetched      += s.fetched;
        totalCreated      += s.created;
        totalAlreadyExists += s.alreadyExists;
        totalFailed       += s.failed;
        await new Promise(r => setTimeout(r, 400));
      }
    } else {
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
