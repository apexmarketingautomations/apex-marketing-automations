import { storage } from "./storage";
import crypto from "crypto";

const FLHSMV_BASE = "https://services.flhsmv.gov";
const FLHSMV_HOME = `${FLHSMV_BASE}/crashreportrequest/`;
const FLHSMV_SEARCH_URL = `${FLHSMV_BASE}/CRRService/api/CrashReport/SearchReport`;
const FLHSMV_DETAIL_URL = `${FLHSMV_BASE}/CRRService/api/CrashReport/GetReport`;
const WORKER_INTERVAL_MS = 3_600_000;
const MAX_RETRIES = 5;
const MAX_SERVICE_FAILURES = 20;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_DURATION_MS = 2 * 60 * 1000;
const MAX_CONCURRENT = 2;
const SESSION_TTL_MS = 5 * 60 * 1000;
const STUCK_JOB_TIMEOUT_MINUTES = 15;
const WORKER_ID = crypto.randomUUID().slice(0, 8);

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
];

let uaIndex = 0;
function getNextUserAgent(): string {
  const ua = USER_AGENTS[uaIndex % USER_AGENTS.length];
  uaIndex++;
  return ua;
}

interface FLHSMVSearchResult {
  ReportNumber: string;
  CrashDate: string;
  CrashCity: string;
  CrashCounty: string;
  ReportStatus: string;
}

interface FLHSMVReportData {
  ReportNumber: string;
  CrashDate: string;
  CrashTime: string;
  CrashCity: string;
  CrashCounty: string;
  CrashStreet: string;
  IntersectingStreet: string;
  Latitude: number;
  Longitude: number;
  TotalVehicles: number;
  TotalInjuries: number;
  TotalFatalities: number;
  WeatherCondition: string;
  LightCondition: string;
  RoadSurfaceCondition: string;
  Vehicles: Array<{
    VehicleNumber: number;
    Year: string;
    Make: string;
    Model: string;
    Color: string;
    TagNumber: string;
    TagState: string;
    InsuranceCompany: string;
    Driver: {
      Name: string;
      Address: string;
      InjuryType: string;
    };
  }>;
  Passengers: Array<{
    Name: string;
    VehicleNumber: number;
    InjuryType: string;
  }>;
  Narrative: string;
  DiagramUrl: string | null;
}

type SearchResultSuccess = { type: "success"; data: FLHSMVSearchResult };
type SearchResultNotFound = { type: "not_found" };
type SearchResultUpstreamError = { type: "upstream_error"; statusCode: number; message: string };
type SearchResultNetworkError = { type: "network_error"; message: string };
type SearchResult = SearchResultSuccess | SearchResultNotFound | SearchResultUpstreamError | SearchResultNetworkError;

type DetailResultSuccess = { type: "success"; data: FLHSMVReportData };
type DetailResultUpstreamError = { type: "upstream_error"; statusCode: number; message: string };
type DetailResultNetworkError = { type: "network_error"; message: string };
type DetailResult = DetailResultSuccess | DetailResultUpstreamError | DetailResultNetworkError;

let sessionCookies: string = "";
let sessionTimestamp: number = 0;

interface FLHSMVHealthStatus {
  status: "ok" | "degraded" | "blocked" | "down";
  lastSuccessfulFetch: string | null;
  lastError: string | null;
  lastErrorCode: number | null;
  lastErrorTime: string | null;
  consecutiveFailures: number;
  totalRequests: number;
  totalSuccesses: number;
  blockedCount: number;
}

const healthStatus: FLHSMVHealthStatus = {
  status: "ok",
  lastSuccessfulFetch: null,
  lastError: null,
  lastErrorCode: null,
  lastErrorTime: null,
  consecutiveFailures: 0,
  totalRequests: 0,
  totalSuccesses: 0,
  blockedCount: 0,
};

let cooldownUntil: number = 0;
let previousHealthStatus: FLHSMVHealthStatus["status"] = "ok";
let recoverySweptThisTransition = false;

function recordSuccess() {
  healthStatus.totalRequests++;
  healthStatus.totalSuccesses++;
  healthStatus.consecutiveFailures = 0;
  healthStatus.lastSuccessfulFetch = new Date().toISOString();
  healthStatus.status = "ok";
}

function recordFailure(statusCode: number, message: string) {
  healthStatus.totalRequests++;
  healthStatus.consecutiveFailures++;
  healthStatus.lastError = message;
  healthStatus.lastErrorCode = statusCode;
  healthStatus.lastErrorTime = new Date().toISOString();

  if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
    healthStatus.blockedCount++;
    healthStatus.status = "blocked";
    console.error(`[CRASH-WORKER] ⚠️ FLAGGED — FLHSMV returned ${statusCode}. Blocked count: ${healthStatus.blockedCount}`);
  } else if (statusCode === 503 || statusCode === 502) {
    healthStatus.status = "down";
  } else if (healthStatus.consecutiveFailures >= 3) {
    healthStatus.status = "degraded";
  }
}

export function getFLHSMVHealth(): FLHSMVHealthStatus {
  return { ...healthStatus };
}

function parseCookies(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  if (raw.length === 0) {
    const single = response.headers.get("set-cookie");
    if (single) return single.split(";")[0];
    return "";
  }
  return raw.map(c => c.split(";")[0]).join("; ");
}

async function refreshSession(): Promise<void> {
  const now = Date.now();
  if (sessionCookies && (now - sessionTimestamp) < SESSION_TTL_MS) return;

  try {
    console.log("[CRASH-WORKER] Refreshing FLHSMV session cookies...");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(FLHSMV_HOME, {
      method: "GET",
      headers: {
        "User-Agent": getNextUserAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    const cookies = parseCookies(response);
    if (cookies) {
      sessionCookies = cookies;
      sessionTimestamp = now;
      console.log("[CRASH-WORKER] Session cookies acquired");
    } else {
      sessionTimestamp = now;
      console.log("[CRASH-WORKER] No cookies returned, proceeding without");
    }
  } catch (err: any) {
    console.warn("[CRASH-WORKER] Session refresh failed:", err.message);
    sessionTimestamp = Date.now();
  }
}

function getHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": getNextUserAgent(),
    "Origin": FLHSMV_BASE,
    "Referer": FLHSMV_HOME,
    "Accept-Language": "en-US,en;q=0.5",
  };
  if (sessionCookies) h["Cookie"] = sessionCookies;
  return h;
}

function isUpstreamErrorCode(status: number): boolean {
  return [500, 502, 503, 429, 401, 403].includes(status);
}

function isNetworkError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || "").toLowerCase();
  return msg.includes("abort") || msg.includes("timeout") || msg.includes("econnrefused") ||
    msg.includes("enotfound") || msg.includes("econnreset") || msg.includes("network") ||
    msg.includes("dns") || err.name === "AbortError";
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);

      if (response.status === 401 || response.status === 403) {
        console.warn(`[CRASH-WORKER] Got ${response.status}, forcing session refresh`);
        sessionCookies = "";
        sessionTimestamp = 0;
        await refreshSession();
        if (attempt < retries) {
          continue;
        }
      }

      if (response.ok || response.status === 404) return response;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      return response;
    } catch (err: any) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error("fetchWithRetry exhausted");
}

async function searchReport(reportNumber: string): Promise<SearchResult> {
  try {
    await refreshSession();

    const response = await fetchWithRetry(FLHSMV_SEARCH_URL, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ ReportNumber: reportNumber.trim() }),
    });

    if (!response.ok) {
      const statusCode = response.status;
      const msg = `FLHSMV returned HTTP ${statusCode} — ${statusCode === 503 ? "service unavailable" : statusCode === 502 ? "bad gateway" : statusCode === 429 ? "rate limited" : statusCode === 401 || statusCode === 403 ? "access denied" : `server error`}`;
      recordFailure(statusCode, msg);
      console.log(`[CRASH-WORKER] ${msg} for ${reportNumber}`);
      return { type: "upstream_error", statusCode, message: msg };
    }

    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) { recordSuccess(); return { type: "success", data: data[0] }; }
    if (data?.ReportNumber) { recordSuccess(); return { type: "success", data }; }
    recordSuccess();
    return { type: "not_found" };
  } catch (err: any) {
    const msg = isNetworkError(err)
      ? `Network timeout contacting FLHSMV`
      : `FLHSMV search error: ${err.message}`;
    recordFailure(0, msg);
    console.error(`[CRASH-WORKER] ${msg} for ${reportNumber}`);
    return { type: "network_error", message: msg };
  }
}

async function fetchReportDetail(reportNumber: string): Promise<DetailResult> {
  try {
    const headers = getHeaders();
    delete headers["Content-Type"];

    const response = await fetchWithRetry(`${FLHSMV_DETAIL_URL}/${encodeURIComponent(reportNumber.trim())}`, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      const statusCode = response.status;
      const msg = `FLHSMV detail returned HTTP ${statusCode}`;
      console.log(`[CRASH-WORKER] ${msg} for ${reportNumber}`);
      return { type: "upstream_error", statusCode, message: msg };
    }

    const data = await response.json();
    return { type: "success", data: data as FLHSMVReportData };
  } catch (err: any) {
    const msg = isNetworkError(err)
      ? `Network timeout fetching FLHSMV report detail`
      : `FLHSMV detail error: ${err.message}`;
    console.error(`[CRASH-WORKER] ${msg} for ${reportNumber}`);
    return { type: "network_error", message: msg };
  }
}

async function processReport(reportId: number, reportNumber: string): Promise<void> {
  console.log(`[CRASH-WORKER] Processing report ${reportNumber} (id=${reportId})`);

  try {
    const report = await storage.getCrashReport(reportId);
    if (!report) {
      console.error(`[CRASH-WORKER] Report ${reportId} not found in DB, skipping`);
      return;
    }

    const ageMs = Date.now() - new Date(report.createdAt).getTime();
    if (ageMs > MAX_AGE_MS) {
      await storage.updateCrashReport(reportId, {
        status: "AWAITING",
        errorLog: `Automatic checking paused — FLHSMV reports typically take 10+ days to appear in the state system. You can retry manually anytime.`,
      });
      console.log(`[CRASH-WORKER] Report ${reportNumber} exceeded 24h auto-check window, marked AWAITING`);
      return;
    }

    const searchResult = await searchReport(reportNumber);

    if (searchResult.type === "not_found") {
      const attemptNumber = (report.retryCount ?? 0) + 1;
      if (attemptNumber < MAX_RETRIES) {
        await storage.updateCrashReport(reportId, {
          status: "PENDING",
          retryCount: attemptNumber,
          errorLog: `Attempt ${attemptNumber}/${MAX_RETRIES}: Report not found in FLHSMV system. Will retry.`,
        });
        console.log(`[CRASH-WORKER] Report ${reportNumber} not found, attempt ${attemptNumber}/${MAX_RETRIES}`);
      } else {
        await storage.updateCrashReport(reportId, {
          status: "NOT_FOUND",
          retryCount: attemptNumber,
          errorLog: `Report not found after ${MAX_RETRIES} attempts. It may not be in the FLHSMV system yet (reports can take 10+ days to appear).`,
        });
        console.log(`[CRASH-WORKER] Report ${reportNumber} marked NOT_FOUND after ${MAX_RETRIES} attempts`);
      }
      return;
    }

    if (searchResult.type === "upstream_error" || searchResult.type === "network_error") {
      const failCount = (report.serviceFailureCount ?? 0) + 1;
      const errorMsg = searchResult.type === "upstream_error"
        ? `FLHSMV returned HTTP ${searchResult.statusCode} — ${searchResult.message}`
        : searchResult.message;

      if (failCount >= MAX_SERVICE_FAILURES) {
        await storage.updateCrashReport(reportId, {
          status: "FAILED",
          serviceFailureCount: failCount,
          errorLog: `Service unreachable after ${failCount} attempts: ${errorMsg}`,
        });
        console.log(`[CRASH-WORKER] Report ${reportNumber} marked FAILED after ${failCount} service failures`);
      } else {
        await storage.updateCrashReport(reportId, {
          status: "PENDING",
          serviceFailureCount: failCount,
          errorLog: `Service failure ${failCount}/${MAX_SERVICE_FAILURES}: ${errorMsg}`,
        });
        console.log(`[CRASH-WORKER] Report ${reportNumber} service failure ${failCount}/${MAX_SERVICE_FAILURES}`);
      }
      return;
    }

    const detail = await fetchReportDetail(reportNumber);

    if (detail.type === "upstream_error" || detail.type === "network_error") {
      const failCount = (report.serviceFailureCount ?? 0) + 1;
      const errorMsg = detail.type === "upstream_error"
        ? `FLHSMV detail returned HTTP ${detail.statusCode} — ${detail.message}`
        : detail.message;

      if (failCount >= MAX_SERVICE_FAILURES) {
        await storage.updateCrashReport(reportId, {
          status: "FAILED",
          serviceFailureCount: failCount,
          errorLog: `Service unreachable after ${failCount} attempts (detail fetch): ${errorMsg}`,
        });
        console.log(`[CRASH-WORKER] Report ${reportNumber} marked FAILED after ${failCount} service failures (detail)`);
      } else {
        await storage.updateCrashReport(reportId, {
          status: "PENDING",
          serviceFailureCount: failCount,
          errorLog: `Service failure ${failCount}/${MAX_SERVICE_FAILURES} (detail fetch): ${errorMsg}`,
        });
        console.log(`[CRASH-WORKER] Report ${reportNumber} detail service failure ${failCount}/${MAX_SERVICE_FAILURES}`);
      }
      return;
    }

    const reportData: Record<string, any> = {
      searchResult: searchResult.data,
      detail: detail.data,
      fetchedAt: new Date().toISOString(),
      source: "FLHSMV",
    };

    await storage.updateCrashReport(reportId, {
      status: "COMPLETED",
      data: reportData,
      errorLog: null,
      serviceFailureCount: 0,
    });

    console.log(`[CRASH-WORKER] Report ${reportNumber} completed successfully`);

  } catch (err: any) {
    console.error(`[CRASH-WORKER] Unexpected error processing ${reportNumber}:`, err.message);
    try {
      await storage.updateCrashReport(reportId, {
        status: "PENDING",
        errorLog: `Unexpected error: ${err.message}`,
      });
    } catch (updateErr: any) {
      console.error(`[CRASH-WORKER] Failed to update report ${reportId} after error:`, updateErr.message);
    }
  }
}

async function processBatch(): Promise<number> {
  const locked = await storage.getAndLockPendingReports(MAX_CONCURRENT, WORKER_ID);
  if (locked.length === 0) return 0;

  console.log(`[CRASH-WORKER] Locked & processing batch of ${locked.length} report(s)`);

  const results = await Promise.allSettled(
    locked.map(report => processReport(report.id, report.reportNumber))
  );

  const failed = results.filter(r => r.status === "rejected").length;
  if (failed > 0) console.warn(`[CRASH-WORKER] ${failed}/${locked.length} report(s) had unhandled errors`);

  return locked.length;
}

async function runRecoverySweep(): Promise<void> {
  try {
    const recovered = await storage.recoverFailedCrashReports(MAX_RETRIES);
    if (recovered > 0) {
      console.log(`[CRASH-WORKER] Recovery sweep: reset ${recovered} FAILED report(s) back to PENDING`);
    }
  } catch (err: any) {
    console.error("[CRASH-WORKER] Recovery sweep error:", err.message);
  }
}

let workerRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;

export function startCrashReportWorker(): void {
  if (workerRunning) {
    console.log("[CRASH-WORKER] Already running");
    return;
  }
  workerRunning = true;
  console.log(`[CRASH-WORKER] Started (id=${WORKER_ID}) — polling every ${WORKER_INTERVAL_MS / 1000}s, max ${MAX_CONCURRENT} concurrent, max retries ${MAX_RETRIES}, max service failures ${MAX_SERVICE_FAILURES}`);

  const tick = async () => {
    try {
      const currentStatus = healthStatus.status;
      const wasUnhealthy = previousHealthStatus !== "ok";
      const isNowOk = currentStatus === "ok";

      if (wasUnhealthy && isNowOk && !recoverySweptThisTransition) {
        recoverySweptThisTransition = true;
        await runRecoverySweep();
      }

      if (currentStatus !== "ok") {
        recoverySweptThisTransition = false;
      }

      if (currentStatus === "down" || currentStatus === "blocked") {
        cooldownUntil = Date.now() + COOLDOWN_DURATION_MS;
        console.log(`[CRASH-WORKER] FLHSMV is ${currentStatus}, cooldown until ${new Date(cooldownUntil).toISOString()}`);
        previousHealthStatus = currentStatus;
        return;
      }

      if (Date.now() < cooldownUntil) {
        console.log(`[CRASH-WORKER] In cooldown until ${new Date(cooldownUntil).toISOString()}, skipping processBatch`);
        previousHealthStatus = currentStatus;
        return;
      }

      if (currentStatus === "ok" || currentStatus === "degraded") {
        cooldownUntil = 0;
      }

      previousHealthStatus = currentStatus;

      const reset = await storage.resetStuckJobs(STUCK_JOB_TIMEOUT_MINUTES);
      if (reset > 0) {
        console.log(`[CRASH-WORKER] Reset ${reset} stuck job(s) older than ${STUCK_JOB_TIMEOUT_MINUTES}m`);
      }
      await processBatch();
    } catch (err: any) {
      console.error("[CRASH-WORKER] Tick error:", err.message);
    }
  };

  tick();
  workerInterval = setInterval(tick, WORKER_INTERVAL_MS);
}

export function stopCrashReportWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  workerRunning = false;
  console.log("[CRASH-WORKER] Stopped");
}
