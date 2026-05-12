/**
 * Unified Apify Transport Scraper
 *
 * Routes queries to the correct Apify actor:
 *   • NHTSA Vehicle Safety Scraper  — passenger vehicle recalls/complaints
 *   • FMCSA Crash Scraper           — commercial trucks/buses
 *   • US Transportation Search      — broad / unknown queries
 *
 * All outputs are normalized to a single NormalizedTransportRecord schema.
 * A per-query repull lock prevents duplicate charges. Admin can force-repull.
 *
 * NEVER runs on module import.  NEVER crashes startup.  All calls have timeouts.
 */

import crypto from "crypto";

// ── Actor identifiers ─────────────────────────────────────────────────────────
const APIFY_BASE    = "https://api.apify.com/v2/acts";
const NHTSA_ACTOR   = "compute-edge~nhtsa-vehicle-safety-scraper";
const FMCSA_ACTOR   = "compute-edge~fmcsa-crash-scraper";
const TRANSPORT_ACTOR = "lentic_clockss~us-transportation-search";

const SCRAPER_TIMEOUT_MS   = 120_000;  // 2 min — sync actors can be slow
const REPULL_COOLDOWN_MS   = 6 * 60 * 60 * 1000; // 6h cooldown between auto-repulls

// ── Source safety allow/block lists ──────────────────────────────────────────
export const CRASH_ALLOWED_SOURCES = new Set([
  "sentinel_crash", "crash_pipeline", "fhp", "crash_report",
  "accident_lead", "sentinel_auto",
]);
export const CRASH_BLOCKED_SOURCES = new Set([
  "legal_pipeline", "fda_recall", "cpsc_recall", "osha",
  "attorney_directory", "home_service", "local_service", "growth_pipeline",
]);
export const CRASH_BLOCKED_TAGS = new Set([
  "legal-lead", "attorney", "fda-recall", "osha-violation",
  "home-service-lead", "growth-lead",
]);

// ── Types ─────────────────────────────────────────────────────────────────────
export type TransportQueryType = "passenger_vehicle" | "commercial_vehicle" | "general";

export interface TransportQuery {
  type?:        TransportQueryType;
  // Passenger vehicle (NHTSA)
  make?:        string;
  model?:       string;
  year?:        number;
  // Commercial vehicle (FMCSA)
  state?:       string;
  dotNumber?:   string;
  carrier?:     string;
  // General (US Transport Search)
  searchTerm?:  string;
  categories?:  string[];
  maxResults?:  number;
}

export interface NormalizedTransportRecord {
  type:     "recall" | "crash" | "search_result";
  state:    string;
  date:     string;
  location: string;
  vehicle:  { make?: string; model?: string; year?: number; vin?: string; type?: string };
  carrier:  { name?: string; dotNumber?: string; mcNumber?: string };
  severity: { fatalities?: number; injuries?: number; level?: string };
  source:   string;
  rawData?: Record<string, unknown>;
}

interface PullLogEntry {
  pulledAt:    Date;
  status:      "success" | "failed";
  resultCount: number;
  actor:       string;
  queryType:   TransportQueryType;
}

// ── In-memory repull lock (cleared on restart — acceptable for emergency use) ─
const pullLog = new Map<string, PullLogEntry>();

// ── Helpers ───────────────────────────────────────────────────────────────────

export function buildQueryHash(query: Record<string, unknown>): string {
  const stable = JSON.stringify(query, Object.keys(query).sort());
  return crypto.createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

export function checkRepullLock(
  queryHash:    string,
  forceRepull = false,
): { blocked: boolean; reason?: string; entry?: PullLogEntry } {
  if (forceRepull) return { blocked: false };
  const entry = pullLog.get(queryHash);
  if (!entry) return { blocked: false };
  const elapsed = Date.now() - entry.pulledAt.getTime();
  if (elapsed < REPULL_COOLDOWN_MS) {
    const minAgo = Math.round(elapsed / 60_000);
    return {
      blocked: true,
      reason: `Already pulled ${minAgo}m ago (cooldown ${REPULL_COOLDOWN_MS / 3_600_000}h). Pass forceRepull:true to override.`,
      entry,
    };
  }
  return { blocked: false, entry };
}

export function getPullLog(): Map<string, PullLogEntry> {
  return pullLog;
}

function detectQueryType(query: TransportQuery): TransportQueryType {
  if (query.type) return query.type;
  if (query.make || query.model || query.year) return "passenger_vehicle";
  if (query.dotNumber || query.carrier)         return "commercial_vehicle";
  const term = (query.searchTerm || "").toLowerCase();
  if (/truck|bus|commercial|carrier|dot\b|18.?wheel|semi/.test(term)) return "commercial_vehicle";
  return "general";
}

function buildActorInput(
  queryType: TransportQueryType,
  query:     TransportQuery,
): { actor: string; input: Record<string, unknown> } {
  switch (queryType) {
    case "passenger_vehicle":
      return {
        actor: NHTSA_ACTOR,
        input: {
          make:       query.make,
          model:      query.model,
          year:       query.year,
          ...(query.maxResults ? { maxResults: query.maxResults } : {}),
        },
      };
    case "commercial_vehicle":
      return {
        actor: FMCSA_ACTOR,
        input: {
          state:      query.state || "FL",
          maxResults: query.maxResults || 500,
          ...(query.dotNumber ? { dotNumber: query.dotNumber } : {}),
          ...(query.carrier   ? { carrier:   query.carrier   } : {}),
        },
      };
    default:
      return {
        actor: TRANSPORT_ACTOR,
        input: {
          searchTerm: query.searchTerm || query.state || "Florida",
          categories: query.categories || ["crashes", "inspections"],
          ...(query.maxResults ? { maxResults: query.maxResults } : {}),
        },
      };
  }
}

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizeNhtsa(raw: Record<string, unknown>): NormalizedTransportRecord {
  return {
    type:     "recall",
    state:    "",
    date:     (raw.reportReceivedDate || raw.investigationOpenedDate || "") as string,
    location: "",
    vehicle:  {
      make:  (raw.make || raw.manufacturer) as string | undefined,
      model: raw.model as string | undefined,
      year:  raw.modelYear ? Number(raw.modelYear) : undefined,
      type:  "passenger_vehicle",
    },
    carrier:  {},
    severity: { level: (raw.consequence || raw.defectSummary) ? "recall" : "investigation" },
    source:   "nhtsa",
    rawData:  raw,
  };
}

function normalizeFmcsa(raw: Record<string, unknown>): NormalizedTransportRecord {
  const fatalities = Number(raw.fatalities || raw.totalFatalities || 0);
  const injuries   = Number(raw.injuries   || raw.totalInjuries   || 0);
  return {
    type:     "crash",
    state:    (raw.reportState || raw.state || "") as string,
    date:     (raw.crashDate   || raw.reportDate || "") as string,
    location: raw.cityName
      ? `${raw.cityName}, ${raw.reportState || ""}`
      : (raw.location || "") as string,
    vehicle:  { type: "commercial_vehicle" },
    carrier:  {
      name:      (raw.legalName || raw.dbaName || raw.carrierName) as string | undefined,
      dotNumber: raw.dotNumber as string | undefined,
      mcNumber:  raw.mcNumber  as string | undefined,
    },
    severity: {
      fatalities,
      injuries,
      level: fatalities > 0 ? "fatal" : injuries > 0 ? "injury" : "property_damage",
    },
    source:   "fmcsa",
    rawData:  raw,
  };
}

function normalizeGeneric(raw: Record<string, unknown>): NormalizedTransportRecord {
  const rt = (raw.dataType || raw.type || "search_result") as string;
  const fatalities = Number(raw.fatalities || 0);
  const injuries   = Number(raw.injuries   || 0);
  return {
    type:     rt === "recall" ? "recall" : rt === "crash" ? "crash" : "search_result",
    state:    (raw.state || "") as string,
    date:     (raw.date  || raw.crashDate || raw.reportDate || "") as string,
    location: (raw.location || raw.city || "") as string,
    vehicle:  {
      make:  raw.make  as string | undefined,
      model: raw.model as string | undefined,
      year:  raw.year  ? Number(raw.year) : undefined,
      type:  raw.vehicleType as string | undefined,
    },
    carrier:  {
      name:      (raw.carrierName || raw.carrier) as string | undefined,
      dotNumber: raw.dotNumber as string | undefined,
    },
    severity: {
      fatalities,
      injuries,
      level: raw.severity as string | undefined,
    },
    source:   "us_transport_search",
    rawData:  raw,
  };
}

function normalizeResults(
  actor:      string,
  rawResults: Record<string, unknown>[],
): NormalizedTransportRecord[] {
  if (actor === NHTSA_ACTOR)   return rawResults.map(normalizeNhtsa);
  if (actor === FMCSA_ACTOR)   return rawResults.map(normalizeFmcsa);
  return rawResults.map(normalizeGeneric);
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface TransportScrapeResult {
  ok:          boolean;
  results:     NormalizedTransportRecord[];
  actor:       string;
  queryType:   TransportQueryType;
  queryHash:   string;
  resultCount: number;
  error?:      string;
}

export async function runTransportScraper(
  query:      TransportQuery,
  options:    { timeoutMs?: number; forceRepull?: boolean } = {},
): Promise<TransportScrapeResult> {
  const token = (process.env.APIFY_API_KEY || process.env.APIFY_TOKEN || "").trim();
  if (!token) {
    console.error("[APIFY-TRANSPORT] APIFY_API_KEY not configured — transport scrape skipped");
    return { ok: false, results: [], actor: "", queryType: "general", queryHash: "", resultCount: 0, error: "APIFY_API_KEY not configured" };
  }

  const queryType            = detectQueryType(query);
  const { actor, input }     = buildActorInput(queryType, query);
  const queryHash            = buildQueryHash({ actor, ...input });
  const timeoutMs            = options.timeoutMs || SCRAPER_TIMEOUT_MS;

  // Repull guard
  const lock = checkRepullLock(queryHash, options.forceRepull);
  if (lock.blocked) {
    console.log(`[APIFY-TRANSPORT] Repull blocked for hash ${queryHash}: ${lock.reason}`);
    return { ok: false, results: [], actor, queryType, queryHash, resultCount: 0, error: lock.reason };
  }

  const url        = `${APIFY_BASE}/${actor}/run-sync-get-dataset-items?token=${token}`;
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  try {
    console.log(`[APIFY-TRANSPORT] Calling actor=${actor} queryType=${queryType} hash=${queryHash} input=${JSON.stringify(input)}`);

    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(input),
      signal:  controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const preview = (await res.text()).slice(0, 300);
      const error   = `Apify HTTP ${res.status}: ${preview}`;
      console.error(`[APIFY-TRANSPORT] ${actor} failed — ${error}`);
      pullLog.set(queryHash, { pulledAt: new Date(), status: "failed", resultCount: 0, actor, queryType });
      return { ok: false, results: [], actor, queryType, queryHash, resultCount: 0, error };
    }

    const raw     = await res.json() as Record<string, unknown>[];
    const results = normalizeResults(actor, Array.isArray(raw) ? raw : []);
    console.log(`[APIFY-TRANSPORT] ${actor} returned ${results.length} records`);
    pullLog.set(queryHash, { pulledAt: new Date(), status: "success", resultCount: results.length, actor, queryType });
    return { ok: true, results, actor, queryType, queryHash, resultCount: results.length };

  } catch (err: any) {
    clearTimeout(timer);
    const error = err?.message || "unknown error";
    console.error(`[APIFY-TRANSPORT] ${actor} error: ${error}`);
    pullLog.set(queryHash, { pulledAt: new Date(), status: "failed", resultCount: 0, actor, queryType });
    return { ok: false, results: [], actor, queryType, queryHash, resultCount: 0, error };
  }
}
