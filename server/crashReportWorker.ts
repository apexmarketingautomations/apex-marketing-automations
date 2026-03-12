import { storage } from "./storage";

const FLHSMV_BASE = "https://services.flhsmv.gov";
const FLHSMV_HOME = `${FLHSMV_BASE}/crashreportrequest/`;
const FLHSMV_SEARCH_URL = `${FLHSMV_BASE}/CRRService/api/CrashReport/SearchReport`;
const FLHSMV_DETAIL_URL = `${FLHSMV_BASE}/CRRService/api/CrashReport/GetReport`;
const WORKER_INTERVAL_MS = 15_000;
const MAX_RETRIES = 3;
const MAX_CONCURRENT = 2;
const SESSION_TTL_MS = 5 * 60 * 1000;

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

let sessionCookies: string = "";
let sessionTimestamp: number = 0;

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
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Origin": FLHSMV_BASE,
    "Referer": FLHSMV_HOME,
    "Accept-Language": "en-US,en;q=0.5",
  };
  if (sessionCookies) h["Cookie"] = sessionCookies;
  return h;
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
          const retryOpts = { ...options, headers: { ...(options.headers as Record<string, string>), ...getHeaders() } };
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

async function searchReport(reportNumber: string): Promise<FLHSMVSearchResult | null> {
  try {
    await refreshSession();

    const response = await fetchWithRetry(FLHSMV_SEARCH_URL, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ ReportNumber: reportNumber.trim() }),
    });

    if (!response.ok) {
      console.log(`[CRASH-WORKER] FLHSMV search returned ${response.status} for ${reportNumber}`);
      return null;
    }

    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) return data[0];
    if (data?.ReportNumber) return data;
    return null;
  } catch (err: any) {
    console.error(`[CRASH-WORKER] FLHSMV search error for ${reportNumber}:`, err.message);
    return null;
  }
}

async function fetchReportDetail(reportNumber: string): Promise<FLHSMVReportData | null> {
  try {
    const headers = getHeaders();
    delete headers["Content-Type"];

    const response = await fetchWithRetry(`${FLHSMV_DETAIL_URL}/${encodeURIComponent(reportNumber.trim())}`, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      console.log(`[CRASH-WORKER] FLHSMV detail returned ${response.status} for ${reportNumber}`);
      return null;
    }

    const data = await response.json();
    return data as FLHSMVReportData;
  } catch (err: any) {
    console.error(`[CRASH-WORKER] FLHSMV detail error for ${reportNumber}:`, err.message);
    return null;
  }
}

const PII_FIELDS = ["Name", "Address", "TagNumber", "InsuranceCompany"];

function maskValue(val: string): string {
  if (!val || val.length <= 2) return "***";
  return val[0] + "*".repeat(val.length - 2) + val[val.length - 1];
}

function redactObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map(item => redactObject(item));
  if (typeof obj === "object") {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (PII_FIELDS.includes(key) && typeof value === "string") {
        result[key] = maskValue(value);
      } else if (typeof value === "object") {
        result[key] = redactObject(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return obj;
}

export function applyComplianceRedaction(data: any, requesterRole: string | null | undefined): any {
  const privilegedRoles = ["admin", "law_enforcement", "insurance_adjuster", "attorney", "owner"];
  if (requesterRole && privilegedRoles.includes(requesterRole)) {
    return data;
  }
  return redactObject(data);
}

async function processReport(reportId: number, reportNumber: string): Promise<void> {
  console.log(`[CRASH-WORKER] Processing report ${reportNumber} (id=${reportId})`);

  try {
    const searchResult = await searchReport(reportNumber);

    if (!searchResult) {
      const report = await storage.getCrashReport(reportId);
      const retries = report?.retryCount ?? 0;

      if (retries < MAX_RETRIES) {
        await storage.updateCrashReport(reportId, {
          status: "PENDING",
          retryCount: retries + 1,
          errorLog: `Attempt ${retries + 1}: Report not found in FLHSMV system. Will retry.`,
        });
        console.log(`[CRASH-WORKER] Report ${reportNumber} not found, retry ${retries + 1}/${MAX_RETRIES}`);
      } else {
        await storage.updateCrashReport(reportId, {
          status: "NOT_FOUND",
          errorLog: `Report not found after ${MAX_RETRIES} attempts. It may not be in the FLHSMV system yet (reports can take 10+ days to appear).`,
        });
        console.log(`[CRASH-WORKER] Report ${reportNumber} marked NOT_FOUND after ${MAX_RETRIES} retries`);
      }
      return;
    }

    const detail = await fetchReportDetail(reportNumber);

    const reportData: Record<string, any> = {
      searchResult,
      detail: detail || null,
      fetchedAt: new Date().toISOString(),
      source: "FLHSMV",
    };

    await storage.updateCrashReport(reportId, {
      status: "COMPLETED",
      data: reportData,
      errorLog: null,
    });

    console.log(`[CRASH-WORKER] Report ${reportNumber} completed successfully`);

  } catch (err: any) {
    const report = await storage.getCrashReport(reportId);
    const retries = report?.retryCount ?? 0;

    if (retries < MAX_RETRIES) {
      await storage.updateCrashReport(reportId, {
        status: "PENDING",
        retryCount: retries + 1,
        errorLog: `Attempt ${retries + 1} failed: ${err.message}`,
      });
    } else {
      await storage.updateCrashReport(reportId, {
        status: "FAILED",
        errorLog: `Failed after ${MAX_RETRIES} attempts. Last error: ${err.message}`,
      });
    }
    console.error(`[CRASH-WORKER] Error processing ${reportNumber}:`, err.message);
  }
}

async function processBatch(): Promise<number> {
  const locked = await storage.getAndLockPendingReports(MAX_CONCURRENT);
  if (locked.length === 0) return 0;

  console.log(`[CRASH-WORKER] Locked & processing batch of ${locked.length} report(s)`);

  const results = await Promise.allSettled(
    locked.map(report => processReport(report.id, report.reportNumber))
  );

  const failed = results.filter(r => r.status === "rejected").length;
  if (failed > 0) console.warn(`[CRASH-WORKER] ${failed}/${locked.length} report(s) had unhandled errors`);

  return locked.length;
}

let workerRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;

export function startCrashReportWorker(): void {
  if (workerRunning) {
    console.log("[CRASH-WORKER] Already running");
    return;
  }
  workerRunning = true;
  console.log(`[CRASH-WORKER] Started — polling every ${WORKER_INTERVAL_MS / 1000}s, max ${MAX_CONCURRENT} concurrent, session-aware`);

  const tick = async () => {
    try {
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
