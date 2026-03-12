import { storage } from "./storage";

const FLHSMV_SEARCH_URL = "https://services.flhsmv.gov/CRRService/api/CrashReport/SearchReport";
const FLHSMV_DETAIL_URL = "https://services.flhsmv.gov/CRRService/api/CrashReport/GetReport";
const WORKER_INTERVAL_MS = 15_000;
const MAX_RETRIES = 3;
const MAX_CONCURRENT = 2;

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

async function fetchWithRetry(url: string, options: RequestInit, retries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
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
    const response = await fetchWithRetry(FLHSMV_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://services.flhsmv.gov",
        "Referer": "https://services.flhsmv.gov/crashreportrequest/",
      },
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
    const response = await fetchWithRetry(`${FLHSMV_DETAIL_URL}/${encodeURIComponent(reportNumber.trim())}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://services.flhsmv.gov",
        "Referer": "https://services.flhsmv.gov/crashreportrequest/",
      },
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

async function processReport(reportId: number, reportNumber: string): Promise<void> {
  console.log(`[CRASH-WORKER] Processing report ${reportNumber} (id=${reportId})`);

  await storage.updateCrashReport(reportId, { status: "PROCESSING" });

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
  const pending = await storage.getPendingCrashReports(MAX_CONCURRENT);
  if (pending.length === 0) return 0;

  console.log(`[CRASH-WORKER] Processing batch of ${pending.length} report(s)`);

  const results = await Promise.allSettled(
    pending.map(report => processReport(report.id, report.reportNumber))
  );

  const failed = results.filter(r => r.status === "rejected").length;
  if (failed > 0) console.warn(`[CRASH-WORKER] ${failed}/${pending.length} report(s) had unhandled errors`);

  return pending.length;
}

let workerRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;

export function startCrashReportWorker(): void {
  if (workerRunning) {
    console.log("[CRASH-WORKER] Already running");
    return;
  }
  workerRunning = true;
  console.log(`[CRASH-WORKER] Started — polling every ${WORKER_INTERVAL_MS / 1000}s, max ${MAX_CONCURRENT} concurrent`);

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
