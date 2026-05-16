import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import { contacts } from "@shared/schema";
import { upsertContact, CONTACT_SOURCES, isPlaceholderName } from "./services/contactUpsertService";

const FLHSMV_BASE = "https://services.flhsmv.gov";
const FLHSMV_HOME = `${FLHSMV_BASE}/crashreportrequest/`;
const FLHSMV_SEARCH_URL = `${FLHSMV_BASE}/CRRService/api/CrashReport/SearchReport`;
const FLHSMV_DETAIL_URL = `${FLHSMV_BASE}/CRRService/api/CrashReport/GetReport`;

// ScrapingBee proxy configuration. FLHSMV's Akamai edge has been returning a
// cached HTTP 503 to our server's egress IP range for months. When
// SCRAPINGBEE_API_KEY is set, all FLHSMV requests are routed through
// ScrapingBee's US residential proxy pool to bypass the IP block.
//
// Mode selection (configurable via SCRAPINGBEE_MODE):
//   "premium"  — premium_proxy=true,  ~10 credits per no-JS request. Default;
//                cheapest tier that beats most Akamai blocks.
//   "stealth"  — stealth_proxy=true,  75 credits per request. Use only if
//                premium starts failing (full Akamai + Cloudflare bypass).
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY;
const SCRAPINGBEE_BASE = "https://app.scrapingbee.com/api/v1/";
const SCRAPINGBEE_MODE = (process.env.SCRAPINGBEE_MODE ?? "premium").toLowerCase();

function buildScrapingBeeUrl(targetUrl: string): string {
  const params = new URLSearchParams({
    api_key: SCRAPINGBEE_API_KEY!,
    url: targetUrl,
    render_js: "false",
    country_code: "us",
    forward_headers: "true",
  });
  if (SCRAPINGBEE_MODE === "stealth") {
    params.set("stealth_proxy", "true");
  } else {
    params.set("premium_proxy", "true");
  }
  return `${SCRAPINGBEE_BASE}?${params.toString()}`;
}

let proxyModeLogged = false;
async function flhsmvFetch(targetUrl: string, init: RequestInit = {}): Promise<Response> {
  if (!SCRAPINGBEE_API_KEY) {
    if (!proxyModeLogged) {
      console.warn(
        "[CRASH-WORKER] ⚠️  SCRAPINGBEE_API_KEY not set — using direct fetch. " +
        "FLHSMV is currently blocking our IP range; expect HTTP 503 until the key is provided."
      );
      proxyModeLogged = true;
    }
    return fetch(targetUrl, init);
  }
  if (!proxyModeLogged) {
    console.log(`[CRASH-WORKER] ✅ Routing FLHSMV requests through ScrapingBee (mode=${SCRAPINGBEE_MODE})`);
    proxyModeLogged = true;
  }
  const proxyUrl = buildScrapingBeeUrl(targetUrl);
  // forward_headers=true makes ScrapingBee strip the "Spb-" prefix and pass the
  // remaining header through to the target. This lets us preserve our
  // User-Agent / Accept / Origin / Referer / Cookie / Content-Type setup.
  const originalHeaders = (init.headers as Record<string, string> | undefined) ?? {};
  const spbHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(originalHeaders)) {
    spbHeaders[`Spb-${k}`] = v;
  }
  return fetch(proxyUrl, {
    ...init,
    headers: spbHeaders,
  });
}
const WORKER_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RETRIES = 5;
const MAX_SERVICE_FAILURES = 20;
// FLHSMV official reports can take up to 10 days to appear after a crash
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const COOLDOWN_DURATION_MS = 2 * 60 * 1000;
const MAX_CONCURRENT = 5;
// Within a single tick, keep pulling fresh batches until either the queue is
// drained, FLHSMV health degrades, or we hit this cap (defence-in-depth so a
// runaway tick can't run forever and overlap with the next interval fire).
// 50 batches × MAX_CONCURRENT (5) = up to 250 jobs per tick.
const MAX_BATCHES_PER_TICK = 50;
// Small pause between batches so we are not hammering FLHSMV back-to-back.
const INTER_BATCH_DELAY_MS = 500;
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

export interface FLHSMVReportData {
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

    const response = await flhsmvFetch(FLHSMV_HOME, {
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
      const response = await flhsmvFetch(url, { ...options, signal: controller.signal });
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

// Minimum confidence score to accept a county/date match.
// Below this threshold we return not_found rather than risk linking
// the wrong driver's data to the wrong client's crash report.
const MIN_MATCH_SCORE = 20;

/**
 * Score a single FLHSMV search result against the sentinel CAD metadata.
 * Returns a 0–100 score and a human-readable breakdown for audit logging.
 *
 * Five independent signals — any subset may fire:
 *   1. Highway / road number match  (I-75, US-41, SR-776, CR-951)  → +40
 *   2. Mile marker match            (MM 131)                        → +25
 *   3. Meaningful street-word overlap (≥2 words >4 chars)          → +20
 *   4. GPS distance < 2 km          (when lat/lng available)        → +10
 *   5. Crash time within 30 min     (when time metadata available)  → +5
 */
function scoreCandidate(
  candidate: Record<string, any>,
  location: string,
  lat?: number | null,
  lng?: number | null,
  receivedTimestamp?: string | null,
): { score: number; breakdown: string } {
  const signals: string[] = [];
  let score = 0;

  const rStreet = ((candidate.CrashStreet || candidate.Location || "") as string).toUpperCase();
  const rCity   = ((candidate.CrashCity   || "") as string).toUpperCase();
  const rFull   = `${rStreet} ${rCity}`;
  const locUp   = location.toUpperCase();

  // Signal 1: highway / road number — high specificity, most reliable signal
  const hwMatches = locUp.match(/\b(I[-\s]?\d{2,3}|US[-\s]?\d{1,3}|SR[-\s]?\d{1,3}|CR[-\s]?\d{1,3}|FL[-\s]?\d{1,3})\b/g) ?? [];
  for (const hw of hwMatches) {
    const norm = hw.replace(/[-\s]/g, "");
    if (rFull.replace(/[-\s]/g, "").includes(norm)) {
      score += 40;
      signals.push(`highway(${hw.trim()})+40`);
      break;
    }
  }

  // Signal 2: mile marker — eliminates most ambiguity on long highway corridors
  const mmMatch = locUp.match(/\bMM\s*(\d+)/);
  if (mmMatch) {
    const mmNum = mmMatch[1];
    const rAll = JSON.stringify(candidate).toUpperCase();
    if (rAll.includes(`MM ${mmNum}`) || rAll.includes(`MM${mmNum}`)) {
      score += 25;
      signals.push(`mileMarker(${mmNum})+25`);
    }
  }

  // Signal 3: meaningful street-word overlap — directional/generic words excluded
  const STOPWORDS = new Set(["NORTH","SOUTH","EAST","WEST","BOUND","COUNTY","FLORIDA","STATE","ROAD","STREET","AVENUE","BLVD","HIGHWAY","PARKWAY"]);
  const locWords = locUp
    .split(/[\s,x\[\]/]+/)
    .filter(w => w.length > 4 && !STOPWORDS.has(w) && !/^(NB|SB|EB|WB|NW|SW|NE|SE)$/.test(w));
  const wordMatches = locWords.filter(w => rFull.includes(w));
  if (wordMatches.length >= 2) {
    score += 20;
    signals.push(`streetWords(${wordMatches.slice(0, 3).join(",")})+20`);
  } else if (wordMatches.length === 1 && score === 0) {
    score += 5;
    signals.push(`weakWord(${wordMatches[0]})+5`);
  }

  // Signal 4: GPS distance — definitive when coordinates are present
  const rLat = candidate.Latitude  ?? candidate.lat;
  const rLng = candidate.Longitude ?? candidate.lng;
  if (lat != null && lng != null && rLat != null && rLng != null) {
    const dLat = (lat - Number(rLat)) * 111_000;
    const dLng = (lng - Number(rLng)) * 111_000 * Math.cos((lat * Math.PI) / 180);
    const distM = Math.sqrt(dLat * dLat + dLng * dLng);
    if (distM < 2_000) {
      score += 10;
      signals.push(`gps(${Math.round(distM)}m)+10`);
    }
  }

  // Signal 5: crash time within 30 minutes
  const rTime: string | undefined = candidate.CrashTime;
  if (receivedTimestamp && rTime) {
    try {
      const timePart = receivedTimestamp.includes(" ") ? receivedTimestamp.split(" ")[1] : receivedTimestamp;
      const sentinelMin = parseTimeToMinutes(timePart ?? "");
      const flhsmvMin   = parseTimeToMinutes(rTime);
      if (sentinelMin !== null && flhsmvMin !== null && Math.abs(sentinelMin - flhsmvMin) <= 30) {
        score += 5;
        signals.push(`time(Δ${Math.abs(sentinelMin - flhsmvMin)}min)+5`);
      }
    } catch (err) { console.warn("[CRASHREPORTWORKER] caught:", err instanceof Error ? err.message : err); /* non-fatal — skip signal */; }
  }

  return { score, breakdown: signals.length > 0 ? signals.join(" | ") : "no signals matched" };
}

function parseTimeToMinutes(timeStr: string): number | null {
  const parts = timeStr.split(":");
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
}

// Discovery search: try to find the official FLHSMV report number using county + crash date.
// Used for sentinel_followup jobs where no report number is known yet.
async function searchReportByCountyDate(
  county: string,
  crashDate: string,
  location: string,
  lat?: number | null,
  lng?: number | null,
  receivedTimestamp?: string | null,
): Promise<SearchResult> {
  try {
    await refreshSession();

    const response = await fetchWithRetry(FLHSMV_SEARCH_URL, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ County: county.toUpperCase(), CrashDate: crashDate }),
    });

    if (!response.ok) {
      const statusCode = response.status;
      const msg = `FLHSMV county/date search returned HTTP ${statusCode}`;
      recordFailure(statusCode, msg);
      console.log(`[CRASH-WORKER] ${msg} for ${county}/${crashDate}`);
      return { type: "upstream_error", statusCode, message: msg };
    }

    const data = await response.json();
    const results: any[] = Array.isArray(data) ? data : (data?.ReportNumber ? [data] : []);

    if (results.length === 0) {
      recordSuccess();
      console.log(`[CRASH-WORKER] County/date discovery: 0 results for ${county}/${crashDate}`);
      return { type: "not_found" };
    }

    // Score every candidate against all available signals
    const scored = results
      .map(r => ({ r, ...scoreCandidate(r, location, lat, lng, receivedTimestamp) }))
      .sort((a, b) => b.score - a.score);

    // Log top candidates for full auditability — lawyers can see exactly why a report was chosen
    const topLog = scored.slice(0, 3)
      .map((s, i) => `  #${i + 1} score=${s.score} report=${s.r.ReportNumber} street="${s.r.CrashStreet ?? ""}" [${s.breakdown}]`)
      .join("\n");
    console.log(`[CRASH-WORKER] County/date discovery: ${results.length} result(s) for ${county}/${crashDate} location="${location}"\n${topLog}`);

    const best   = scored[0];
    const second = scored[1];

    // Refuse to link if confidence is too low — wrong data is worse than no data
    if (best.score < MIN_MATCH_SCORE) {
      console.warn(
        `[CRASH-WORKER] ⚠ Best candidate score ${best.score} < threshold ${MIN_MATCH_SCORE} for ${county}/${crashDate} ` +
        `location="${location}" — returning not_found to avoid false linkage`
      );
      recordSuccess();
      return { type: "not_found" };
    }

    // Ambiguity warning — two candidates are close; flag for manual review
    if (second && best.score - second.score <= 10 && second.score >= MIN_MATCH_SCORE) {
      console.warn(
        `[CRASH-WORKER] ⚠ AMBIGUOUS MATCH: top two candidates within 10pts ` +
        `(#1 ${best.r.ReportNumber} score=${best.score}, #2 ${second.r.ReportNumber} score=${second.score}) ` +
        `for ${county}/${crashDate} location="${location}". Linking best — manual verification recommended.`
      );
    }

    console.log(`[CRASH-WORKER] ✓ Selected ${best.r.ReportNumber} (score=${best.score}) for ${county}/${crashDate}`);
    recordSuccess();
    return { type: "success", data: best.r };

  } catch (err: any) {
    const msg = isNetworkError(err)
      ? `Network timeout on county/date discovery`
      : `FLHSMV county/date search error: ${err.message}`;
    recordFailure(0, msg);
    console.error(`[CRASH-WORKER] ${msg} for ${county}/${crashDate}`);
    return { type: "network_error", message: msg };
  }
}

export async function fetchReportDetail(reportNumber: string): Promise<DetailResult> {
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
        errorLog: `Automatic checking paused after 14 days — FLHSMV reports typically take 3–10 days to appear in the state system. You can retry manually anytime.`,
      });
      console.log(`[CRASH-WORKER] Report ${reportNumber} exceeded 14-day auto-check window, marked AWAITING`);
      return;
    }

    // For sentinel follow-up jobs, use county+date discovery instead of direct report number lookup
    const isFollowUp = report.source === "sentinel_followup";
    let searchResult: SearchResult;

    if (isFollowUp) {
      const meta = report.data as any;
      const county = meta?.county as string | undefined;
      const crashDate = meta?.crashDate as string | undefined;
      const location = meta?.location as string | undefined;

      if (!county || !crashDate) {
        await storage.updateCrashReport(reportId, {
          status: "FAILED",
          errorLog: "Follow-up job missing county or crashDate metadata — cannot search FLHSMV",
        });
        console.error(`[CRASH-WORKER] Follow-up ${reportNumber} missing metadata, marking FAILED`);
        return;
      }

      const lat      = meta?.lat      as number | null | undefined;
      const lng      = meta?.lng      as number | null | undefined;
      const received = meta?.received as string | null | undefined;

      console.log(`[CRASH-WORKER] Follow-up discovery search: county=${county} date=${crashDate} lat=${lat ?? "?"} lng=${lng ?? "?"}`);
      searchResult = await searchReportByCountyDate(county, crashDate, location || "", lat, lng, received);
    } else {
      searchResult = await searchReport(reportNumber);
    }

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

    // Preserve follow-up metadata so the linkage back to the sentinel parent isn't lost
    if (isFollowUp) {
      const meta = report.data as any;
      reportData.sentinelReportId = meta?.sentinelReportId ?? null;
      reportData.sentinelReportNumber = meta?.sentinelReportNumber ?? null;
      reportData.fhpIncidentId = meta?.fhpIncidentId ?? null;
      reportData.discoveredVia = "county_date_search";
      reportData.discoveredReportNumber = (searchResult.data as any)?.ReportNumber ?? null;
    }

    await storage.updateCrashReport(reportId, {
      status: "COMPLETED",
      data: reportData,
      errorLog: null,
      serviceFailureCount: 0,
    });

    console.log(`[CRASH-WORKER] Report ${reportNumber} completed successfully`);

    // Report to Apex Intelligence brain (fire-and-forget)
    const detail_data = detail.type === "success" ? detail.data : null;
    const personName = detail_data?.Vehicles?.[0]?.Driver?.Name || reportNumber;
    import("./operator/apexIntelligence").then(({ reportOutcome }) => reportOutcome({
      agentName:    "crash-report-worker",
      action:       "crash_report_enriched",
      subject:      personName,
      result:       `FLHSMV crash report ${reportNumber} enriched — ${detail_data?.TotalInjuries ?? "?"} injuries, ${detail_data?.TotalFatalities ?? "?"} fatalities`,
      confidence:   0.7,
      subAccountId: report.subAccountId ?? parseInt(process.env.APEX_PARENT_ACCOUNT_ID || "3"),
      niche:        "crash",
      metadata: {
        reportId:      reportId,
        reportNumber,
        county:        detail_data?.CrashCounty || null,
        totalInjuries: detail_data?.TotalInjuries ?? null,
        totalFatalities: detail_data?.TotalFatalities ?? null,
        source:        isFollowUp ? "sentinel_followup" : "direct",
      },
    // allow-silent-catch: fire-and-forget telemetry
    })).catch(() => {});

    // For follow-up jobs, also stamp the official FLHSMV data onto the original sentinel record
    // so the UI shows full driver/insurance/tag info on the parent crash row.
    // Hardened: validates parent identity, scopes to the same sub-account, and uses an atomic
    // JSONB merge so concurrent writes can't lose data.
    if (isFollowUp) {
      const meta = report.data as any;
      const sentinelReportId = meta?.sentinelReportId;
      const sentinelReportNumber = meta?.sentinelReportNumber;

      // Strict metadata validation — reject poisoned or malformed follow-up records
      if (typeof sentinelReportId !== "number" || sentinelReportId <= 0) {
        await storage.updateCrashReport(reportId, {
          errorLog: `[LINK-FAILED] Follow-up missing valid sentinelReportId in metadata`,
        });
        console.warn(`[CRASH-WORKER] Follow-up ${reportId} has invalid sentinelReportId — skipping linkback`);
      } else {
        try {
          // Verify the parent exists, has the expected source, matches the report number
          // we recorded at queue time, and lives in the same sub-account (defense-in-depth)
          const parent = await storage.getCrashReport(sentinelReportId);
          const subAccountMismatch = report.subAccountId != null
            && parent?.subAccountId != null
            && parent.subAccountId !== report.subAccountId;
          const numberMismatch = sentinelReportNumber
            && parent?.reportNumber
            && parent.reportNumber !== sentinelReportNumber;

          if (!parent) {
            await storage.updateCrashReport(reportId, {
              errorLog: `[LINK-FAILED] Sentinel parent ${sentinelReportId} not found — orphan follow-up`,
            });
            console.warn(`[CRASH-WORKER] Follow-up ${reportId} parent ${sentinelReportId} not found`);
          } else if (parent.source !== "sentinel_auto") {
            await storage.updateCrashReport(reportId, {
              errorLog: `[LINK-FAILED] Parent ${sentinelReportId} source=${parent.source} (expected sentinel_auto)`,
            });
            console.warn(`[CRASH-WORKER] Follow-up ${reportId} parent ${sentinelReportId} has wrong source ${parent.source} — refusing to link`);
          } else if (subAccountMismatch) {
            await storage.updateCrashReport(reportId, {
              errorLog: `[LINK-FAILED] Sub-account mismatch parent=${parent.subAccountId} followup=${report.subAccountId}`,
            });
            console.warn(`[CRASH-WORKER] Follow-up ${reportId} sub-account mismatch — refusing to link`);
          } else if (numberMismatch) {
            await storage.updateCrashReport(reportId, {
              errorLog: `[LINK-FAILED] Parent reportNumber drifted: expected=${sentinelReportNumber} actual=${parent.reportNumber}`,
            });
            console.warn(`[CRASH-WORKER] Follow-up ${reportId} parent reportNumber drift — refusing to link`);
          } else {
            const officialReportNumber = (searchResult.data as any)?.ReportNumber ?? null;
            // Atomic JSONB merge — server-side `data = data || patch::jsonb`, scoped by source
            // and (when known) sub-account so a poisoned reference still cannot mutate the wrong row
            const merged = await storage.mergeCrashReportData(
              sentinelReportId,
              {
                officialFlhsmv: {
                  reportNumber: officialReportNumber,
                  searchResult: searchResult.data,
                  detail: detail.data,
                  fetchedAt: new Date().toISOString(),
                  followUpReportId: reportId,
                },
              },
              {
                expectSource: "sentinel_auto",
                ...(report.subAccountId != null ? { expectSubAccountId: report.subAccountId } : {}),
                // Atomically promote the sentinel parent to COMPLETED in the same write
                // as the officialFlhsmv stamp. Sentinel parents are inserted as AWAITING
                // (raw CAD ping with no FLHSMV detail); they only become COMPLETED once
                // real FLHSMV data lands here.
                setStatus: "COMPLETED",
              }
            );
            if (!merged) {
              await storage.updateCrashReport(reportId, {
                errorLog: `[LINK-FAILED] Atomic merge returned no row — guards rejected update`,
              });
              console.warn(`[CRASH-WORKER] Follow-up ${reportId} atomic merge rejected by guards`);
            } else {
              console.log(`[CRASH-WORKER] Linked official FLHSMV report ${officialReportNumber} back to sentinel parent ${sentinelReportId} (atomic)`);

              // ── Sibling fan-out (Task #176) ────────────────────────────────
              // The sentinel ingest pipeline can record the SAME FHP incident
              // twice as two distinct sentinel_auto rows. The follow-up unique
              // key (`FLHSMV-FOLLOWUP-<FHP_ID>`) only attaches to one of those
              // "twin" parents (the winner). Loser twins are tracked here in
              // `meta.siblingSentinelReportIds[]` so the same officialFlhsmv
              // payload also lands on every twin parent — preventing data
              // dropouts in the lawyer-facing UI.
              const rawSiblings: unknown = meta?.siblingSentinelReportIds;
              const siblingIds: number[] = Array.isArray(rawSiblings)
                ? rawSiblings.filter((x): x is number => typeof x === "number" && x > 0 && x !== sentinelReportId)
                : [];
              if (siblingIds.length > 0) {
                let stampedSiblings = 0;
                let rejectedSiblings = 0;
                for (const sibId of siblingIds) {
                  try {
                    const sib = await storage.getCrashReport(sibId);
                    if (!sib) {
                      console.warn(`[CRASH-WORKER] Follow-up ${reportId} sibling ${sibId} not found — skipping`);
                      rejectedSiblings++;
                      continue;
                    }
                    if (sib.source !== "sentinel_auto") {
                      console.warn(`[CRASH-WORKER] Follow-up ${reportId} sibling ${sibId} has source=${sib.source} — refusing to fan out`);
                      rejectedSiblings++;
                      continue;
                    }
                    // Fail-closed sub-account guard: refuse the fan-out unless
                    // BOTH sides carry the same explicit sub-account id. A null
                    // on either side could allow cross-tenant data leakage via
                    // a poisoned siblingSentinelReportIds entry.
                    if (report.subAccountId == null
                        || sib.subAccountId == null
                        || sib.subAccountId !== report.subAccountId) {
                      console.warn(`[CRASH-WORKER] Follow-up ${reportId} sibling ${sibId} sub-account guard failed (followup=${report.subAccountId} sibling=${sib.subAccountId}) — refusing to fan out`);
                      rejectedSiblings++;
                      continue;
                    }
                    const sibMerged = await storage.mergeCrashReportData(
                      sibId,
                      {
                        officialFlhsmv: {
                          reportNumber: officialReportNumber,
                          searchResult: searchResult.data,
                          detail: detail.data,
                          fetchedAt: new Date().toISOString(),
                          followUpReportId: reportId,
                          fanOutFromSentinelReportId: sentinelReportId,
                        },
                      },
                      {
                        expectSource: "sentinel_auto",
                        ...(report.subAccountId != null ? { expectSubAccountId: report.subAccountId } : {}),
                        setStatus: "COMPLETED",
                      }
                    );
                    if (sibMerged) {
                      stampedSiblings++;
                      // Atomically replace the DUPLICATE_FHP_INCIDENT close-out
                      // errorLog with a positive confirmation. Single conditional
                      // UPDATE — only matches when the current log STILL starts
                      // with that marker, so concurrent diagnostics written
                      // between the merge and this update are not clobbered.
                      try {
                        const newErrLog = `FLHSMV data fanned out from sibling parent ${sentinelReportId} via follow-up ${reportId} at ${new Date().toISOString()}`;
                        await db.execute(sql`
                          UPDATE crash_reports
                          SET error_log = ${newErrLog}, updated_at = NOW()
                          WHERE id = ${sibId}
                            AND error_log LIKE 'DUPLICATE_FHP_INCIDENT:%'
                        `);
                      } catch (err) {
                        console.warn(`[CRASH-WORKER] Sibling ${sibId} stamped but errorLog refresh failed: ${err instanceof Error ? err.message : err}`);
                      }
                    } else {
                      rejectedSiblings++;
                      console.warn(`[CRASH-WORKER] Follow-up ${reportId} sibling ${sibId} atomic merge rejected by guards`);
                    }
                  } catch (sibErr: any) {
                    rejectedSiblings++;
                    console.warn(`[CRASH-WORKER] Follow-up ${reportId} sibling ${sibId} fan-out error: ${sibErr.message}`);
                  }
                }
                console.log(`[CRASH-WORKER] Sibling fan-out for follow-up ${reportId}: ${stampedSiblings}/${siblingIds.length} stamped, ${rejectedSiblings} rejected`);
              }
            }
          }
        } catch (linkErr: any) {
          // Persist the linkage failure on the follow-up record so a recovery pass can find it
          try {
            await storage.updateCrashReport(reportId, {
              errorLog: `[LINK-FAILED] ${linkErr.message}`,
            });
          } catch (err) { console.warn("[CRASHREPORTWORKER] caught:", err instanceof Error ? err.message : err); /* best-effort */; }
          console.warn(`[CRASH-WORKER] Failed to link follow-up ${reportId} back to sentinel ${sentinelReportId}: ${linkErr.message}`);
        }
      }
    }

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

/**
 * Pull batches back-to-back within a single tick until the queue is drained,
 * FLHSMV health degrades to "blocked"/"down", or we hit MAX_BATCHES_PER_TICK.
 *
 * This is what lets the worker chew through a multi-thousand-row PENDING
 * backlog in a reasonable time. Each batch is bounded by MAX_CONCURRENT,
 * health is re-checked between batches, and a partial batch (queue exhausted)
 * exits the loop early — so a healthy idle worker still does at most one
 * cheap DB lookup per tick.
 */
async function drainQueue(): Promise<{ processed: number; batches: number; stoppedReason: string }> {
  let processed = 0;
  let batches = 0;
  for (let i = 0; i < MAX_BATCHES_PER_TICK; i++) {
    const status = healthStatus.status;
    if (status === "blocked" || status === "down") {
      cooldownUntil = Date.now() + COOLDOWN_DURATION_MS;
      return { processed, batches, stoppedReason: `FLHSMV health degraded to ${status} mid-drain` };
    }

    const count = await processBatch();
    if (count === 0) {
      return { processed, batches, stoppedReason: "queue empty" };
    }
    processed += count;
    batches += 1;

    // A short batch means getAndLockPendingReports could not fill MAX_CONCURRENT
    // — the queue is exhausted, no point spinning the loop again.
    if (count < MAX_CONCURRENT) {
      return { processed, batches, stoppedReason: "queue exhausted" };
    }

    if (i < MAX_BATCHES_PER_TICK - 1) {
      await new Promise((resolve) => setTimeout(resolve, INTER_BATCH_DELAY_MS));
    }
  }
  return { processed, batches, stoppedReason: `max batches per tick reached (${MAX_BATCHES_PER_TICK})` };
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
let tickInProgress = false;

// Run the backlog diagnostic every Nth tick — the worker tick runs frequently
// and we don't want to spam the logs with the same histogram on every cycle.
const BACKLOG_LOG_EVERY_N_TICKS = 12;
let backlogLogTickCounter = 0;

async function probeFlhsmvConnectivity(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await flhsmvFetch(FLHSMV_HOME, {
      method: "HEAD",
      headers: { "User-Agent": getNextUserAgent() },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    console.log(`[CRASH-WORKER] FLHSMV connectivity probe: HTTP ${res.status} ${res.statusText} — ${res.ok ? "✅ REACHABLE" : "⚠️ UNEXPECTED STATUS"}`);
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.warn("[CRASH-WORKER] FLHSMV connectivity probe: ⏱️ TIMEOUT (10s) — service may be rate-limiting or temporarily down");
    } else {
      console.warn(`[CRASH-WORKER] FLHSMV connectivity probe: ❌ UNREACHABLE — ${err.message}`);
      console.warn("[CRASH-WORKER] Crash report retrieval will be degraded until FLHSMV is reachable. Jobs will retry automatically when service recovers.");
    }
  }
}

export function startCrashReportWorker(): void {
  if (workerRunning) {
    console.log("[CRASH-WORKER] Already running");
    return;
  }
  workerRunning = true;
  console.log(`[CRASH-WORKER] Started (id=${WORKER_ID}) — polling every ${WORKER_INTERVAL_MS / 1000}s, max ${MAX_CONCURRENT} concurrent, max retries ${MAX_RETRIES}, max service failures ${MAX_SERVICE_FAILURES}`);

  probeFlhsmvConnectivity().catch((err) => console.warn("[CRASHREPORTWORKER] promise rejected:", err instanceof Error ? err.message : err));

  const tick = async () => {
    // Re-entrance guard: with the shorter tick interval and per-tick drain
    // loop, a slow FLHSMV pass could otherwise overlap with the next interval
    // fire and double-process from a stale lock view.
    if (tickInProgress) {
      console.log("[CRASH-WORKER] Tick skipped — previous tick still running");
      return;
    }
    tickInProgress = true;
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
        // Liveness fix: only re-arm cooldown if it has already expired. Otherwise
        // a steady stream of "down" ticks would keep pushing cooldownUntil into
        // the future and the worker would never get a chance to probe again.
        if (Date.now() >= cooldownUntil) {
          cooldownUntil = Date.now() + COOLDOWN_DURATION_MS;
          // Demote to "degraded" so the *next* tick is allowed to actually run a
          // batch (the bail-out below only triggers on "down"/"blocked"). If FLHSMV
          // is still angry, the next failed call inside processReport() will call
          // recordFailure() and bump status back to "down"/"blocked" — and the
          // drain loop's mid-drain bailout will reset cooldownUntil again. That
          // gives us a self-healing one-probe-per-cooldown cycle instead of the
          // permanent stall we'd otherwise get after a single transient outage.
          healthStatus.status = "degraded";
          console.log(`[CRASH-WORKER] FLHSMV was ${currentStatus}, cooldown until ${new Date(cooldownUntil).toISOString()} — demoted to degraded so next tick can probe`);
        } else {
          console.log(`[CRASH-WORKER] FLHSMV is ${currentStatus}, cooldown until ${new Date(cooldownUntil).toISOString()}`);
        }
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
      const drainResult = await drainQueue();
      if (drainResult.processed > 0) {
        console.log(`[CRASH-WORKER] Tick drained ${drainResult.processed} report(s) across ${drainResult.batches} batch(es) — stopped: ${drainResult.stoppedReason}`);
      } else {
        // Quiet heartbeat so operators can confirm the worker is ticking even
        // when the queue is empty — useful for backlog observability.
        console.log(`[CRASH-WORKER] Tick idle — ${drainResult.stoppedReason}`);
      }

      // Periodic backlog diagnostic. Without this, operators stare at the
      // misleading `retry_count = 0` column and conclude the worker isn't
      // running — when in fact FLHSMV upstream errors increment
      // `service_failure_count` (NOT retry_count). Logging the failure
      // histogram makes that distinction obvious in the live logs.
      backlogLogTickCounter++;
      if (backlogLogTickCounter % BACKLOG_LOG_EVERY_N_TICKS === 0) {
        try {
          const histo = await db.execute(sql`
            SELECT
              COUNT(*) FILTER (WHERE source = 'sentinel_followup' AND status = 'PENDING')::int AS pending_followups,
              COUNT(*) FILTER (WHERE source = 'sentinel_followup' AND status = 'PENDING' AND retry_count = 0 AND COALESCE(service_failure_count, 0) > 0)::int AS pending_with_upstream_failures,
              COALESCE(MAX(service_failure_count), 0)::int AS max_service_failures,
              COALESCE(MAX(retry_count), 0)::int AS max_retries
            FROM crash_reports
            WHERE source = 'sentinel_followup' AND status = 'PENDING'
          `);
          const row = histo.rows?.[0] as
            | { pending_followups?: number; pending_with_upstream_failures?: number; max_service_failures?: number; max_retries?: number }
            | undefined;
          if (row && (row.pending_followups ?? 0) > 0) {
            console.log(
              `[CRASH-WORKER] Backlog diag: ${row.pending_followups ?? 0} pending follow-ups, ` +
              `${row.pending_with_upstream_failures ?? 0} blocked by FLHSMV 5xx (retry_count=0 is expected — upstream errors bump service_failure_count instead). ` +
              `max(service_failure_count)=${row.max_service_failures ?? 0}, max(retry_count)=${row.max_retries ?? 0}.`
            );
          }
        } catch (diagErr: any) {
          console.warn("[CRASH-WORKER] Backlog diag query failed:", diagErr?.message);
        }
      }
    } catch (err: any) {
      console.error("[CRASH-WORKER] Tick error:", err.message);
    } finally {
      tickInProgress = false;
    }
  };

  tick();
  workerInterval = setInterval(tick, WORKER_INTERVAL_MS);
}

// ── Retro FLHSMV Enrichment ───────────────────────────────────────────────────
//
// Called by retroFLHSMVEnrich.ts after fetchReportDetail() succeeds.
// Finds all contacts linked to the sentinel crash report (via sourceExternalId
// pattern `crash:<reportNumber>:acct<id>`), skips any already tagged
// `flhsmv-enriched`, and updates the rest with real name, home address, plate.

export interface EnrichCrashLeadContactsParams {
  sentinelReportNumber: string;
  subAccountId: number | null;
  detailData: FLHSMVReportData;
  officialReportNumber: string;
}

export interface EnrichCrashLeadContactsResult {
  enriched: number;
  skipped: number;
  noContacts: boolean;
}

export async function enrichCrashLeadContacts(
  params: EnrichCrashLeadContactsParams,
): Promise<EnrichCrashLeadContactsResult> {
  const { sentinelReportNumber, subAccountId, detailData, officialReportNumber } = params;

  const vehicle = detailData.Vehicles?.[0];
  const driver  = vehicle?.Driver;

  if (!driver?.Name) {
    return { enriched: 0, skipped: 0, noContacts: false };
  }

  // Parse "LASTNAME FIRSTNAME" or "FIRST LAST" — FLHSMV typically uses "LAST, FIRST" or "FIRST LAST"
  const rawName  = driver.Name.trim();
  let firstName: string;
  let lastName: string | null = null;
  if (rawName.includes(",")) {
    // "SMITH, JOHN" format
    const [last, ...rest] = rawName.split(",").map(s => s.trim());
    firstName = rest.join(" ") || last;
    lastName  = rest.length > 0 ? last : null;
  } else {
    const parts = rawName.split(/\s+/);
    firstName = parts[0] ?? rawName;
    lastName  = parts.slice(1).join(" ") || null;
  }

  // Build enrichment tags (additive — upsertContact never removes existing tags)
  const enrichmentTags: string[] = ["flhsmv-enriched"];
  if (vehicle?.TagNumber && vehicle?.TagState) {
    const plate = `${vehicle.TagState.toUpperCase()}-${vehicle.TagNumber.toUpperCase()}`;
    enrichmentTags.push(`plate:${plate}`);
  }

  // Address from FLHSMV driver record
  const homeAddress = driver.Address?.trim() || null;

  // Insurance note
  const insuranceNote = vehicle?.InsuranceCompany
    ? `Insurance: ${vehicle.InsuranceCompany}`
    : null;
  const vehicleNote = vehicle?.TagNumber
    ? `Vehicle: ${vehicle.Year ?? ""} ${vehicle.Make ?? ""} ${vehicle.Model ?? ""} | Plate: ${vehicle.TagState ?? "FL"}-${vehicle.TagNumber}`.trim()
    : null;
  const enrichmentNote = [
    `FLHSMV enriched at ${new Date().toISOString()}`,
    `Official report: ${officialReportNumber}`,
    homeAddress ? `Home address: ${homeAddress}` : null,
    vehicleNote,
    insuranceNote,
  ].filter(Boolean).join("\n");

  // Find all contacts linked to this sentinel crash report.
  // sourceExternalId format (set in crashIngestPipeline): crash:<reportNumber>:acct<accountId>
  const sourcePrefix = `crash:${sentinelReportNumber}:`;
  const rows = await db
    .select({
      id:               contacts.id,
      subAccountId:     contacts.subAccountId,
      tags:             contacts.tags,
      sourceExternalId: contacts.sourceExternalId,
      firstName:        contacts.firstName,
    })
    .from(contacts)
    .where(sql`source_external_id LIKE ${sourcePrefix + "%"}`);

  // Narrow to the specific sub-account when provided
  const targets = subAccountId != null
    ? rows.filter(c => c.subAccountId === subAccountId)
    : rows;

  if (targets.length === 0) {
    return { enriched: 0, skipped: 0, noContacts: true };
  }

  let enriched = 0;
  let skipped  = 0;

  for (const contact of targets) {
    const currentTags = contact.tags ?? [];
    if (currentTags.includes("flhsmv-enriched")) {
      skipped++;
      continue;
    }

    try {
      await upsertContact({
        subAccountId:     contact.subAccountId,
        firstName,
        lastName,
        address:          homeAddress,
        state:            "FL",
        tags:             enrichmentTags,
        notes:            enrichmentNote,
        source:           CONTACT_SOURCES.CRASH,
        sourceExternalId: contact.sourceExternalId ?? undefined,
        // Upgrade identity status only if the existing name is a placeholder
        identityStatus:   isPlaceholderName(contact.firstName) ? "verified" : undefined,
        enrichmentProvider:     "flhsmv",
        enrichmentCompletedAt:  new Date(),
      });
      enriched++;
    } catch (err: any) {
      console.warn(`[CRASH-WORKER] enrichCrashLeadContacts: upsert failed for contact ${contact.id}: ${err.message}`);
    }
  }

  return { enriched, skipped, noContacts: false };
}

export function stopCrashReportWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  workerRunning = false;
  console.log("[CRASH-WORKER] Stopped");
}
