/**
 * Vendor Configuration — canonical resolver module
 *
 * Single source of truth for every vendor credential lookup.
 * All runtime code imports from here; env var aliases are never
 * duplicated elsewhere.
 *
 * Rules:
 *  - Never log or return credential values — only booleans.
 *  - Fail visibly (console.error) if a vendor is required but missing.
 *  - Each resolver logs its status exactly once on the first call per
 *    process lifetime (lazy singleton via _logged flag).
 */

// ── Crash lead accounts (always receive crash leads via crashIngestPipeline) ──
//   3  = Apex Marketing Automations (platform owner)
//   3  = APEX MARKETING Account (APEX_MAIN_ACCOUNT_ID in crashIngestPipeline)
//   4  = Crash Connect — Giovanni (GIOVANNI_ACCOUNT_ID in crashIngestPipeline)
export const CRASH_LEAD_ACCOUNT_IDS = new Set<number>([3, 4]);

// ── Enrichment-allowed accounts ───────────────────────────────────────────────
// Only accounts in this set may trigger paid external API calls:
//   BatchData skip-trace, Nimble web scraping, Apify actors.
// All other accounts receive leads/signals but without paid enrichment.
//   3  = Apex Marketing Automations (platform owner — the only paying enrichment account)
export const ENRICHMENT_ACCOUNT_IDS = new Set<number>([3]);

/** Returns true only for accounts authorised to use paid enrichment APIs. */
export function isEnrichmentAllowed(subAccountId: number): boolean {
  return ENRICHMENT_ACCOUNT_IDS.has(subAccountId);
}

// ── BatchData ─────────────────────────────────────────────────────────────────
// Canonical env var: BATCHDATA_API_KEY
// Legacy alias:      BATCH_DATA   (kept for Railway envs set before the rename)

let _batchDataLogged = false;

/**
 * Returns the BatchData API key, or null if not configured.
 * Logs configuration status once per process (boolean only, never the value).
 * Canonical env var: BATCHDATA_API_KEY — also accepts BATCHDATA_KEY / BATCH_DATA for legacy envs.
 */
export function resolveBatchDataKey(): string | null {
  const key = (
    process.env.BATCHDATA_API_KEY ||
    process.env.BATCHDATA_KEY     ||
    process.env.BATCH_DATA        ||
    ""
  ).trim() || null;

  if (!_batchDataLogged) {
    _batchDataLogged = true;
    if (key) {
      console.log("[VENDOR] BatchData configured: true (BATCHDATA_API_KEY or BATCH_DATA)");
    } else {
      console.error(
        "[VENDOR] BatchData configured: false — " +
        "set BATCHDATA_API_KEY in Railway env vars. Skip-trace will not run."
      );
    }
  }
  return key;
}

/**
 * Alias kept for backwards-compat with skip-trace.ts callers.
 */
export const getBatchDataKey = resolveBatchDataKey;

// ── Apify ─────────────────────────────────────────────────────────────────────
// Source of truth: APIFY_API_KEY (Railway env var — no aliases, no fallbacks)

let _apifyLogged = false;

/**
 * Returns the Apify API token from APIFY_API_KEY, or null if missing/empty.
 * Logs status once per process — boolean + length only, never the value.
 */
export function resolveApifyToken(): string | null {
  const key = (
    process.env.APIFY_API_KEY ||
    process.env.APIFY_TOKEN   ||
    process.env.APIFY_KEY     ||
    ""
  ).trim() || null;

  if (!_apifyLogged) {
    _apifyLogged = true;
    if (key) {
      console.log(`[APIFY] token configured: true`);
      console.log(`[APIFY] token length: ${key.length}`);
    } else {
      console.error("[APIFY] token configured: false — APIFY_API_KEY is not set in Railway. Scrapers will not run.");
    }
  }
  return key;
}

// ── In-process vendor run records (reset on restart) ─────────────────────────

export interface VendorRunRecord {
  ranAt:    Date;
  error:    string | null;
  count:    number;
  source:   string;
}

const _runState = {
  batchData: null as VendorRunRecord | null,
  apify:     null as VendorRunRecord | null,
};

export function recordBatchDataRun(count: number, source: string, error: string | null = null): void {
  _runState.batchData = { ranAt: new Date(), error, count, source };
}

export function recordApifyRun(count: number, source: string, error: string | null = null): void {
  _runState.apify = { ranAt: new Date(), error, count, source };
}

export function getVendorRunState(): typeof _runState {
  return _runState;
}

// ── CourtListener ─────────────────────────────────────────────────────────────
// Source of truth: COURTLISTENER_API_TOKEN (Railway env var)
// Free tier works without a token but is rate-limited (~50 req/day).
// Register at courtlistener.com to get a free token (higher limits).

let _courtListenerLogged = false;

/**
 * Returns the CourtListener API token, or null if not configured.
 * Token is optional — free tier allows limited unauthenticated access.
 */
export function resolveCourtListenerToken(): string | null {
  const key = (process.env.COURTLISTENER_API_TOKEN || "").trim() || null;

  if (!_courtListenerLogged) {
    _courtListenerLogged = true;
    if (key) {
      console.log("[VENDOR] CourtListener configured: true (COURTLISTENER_API_TOKEN)");
    } else {
      console.log("[VENDOR] CourtListener configured: false — using free tier (rate-limited). Set COURTLISTENER_API_TOKEN for production volume.");
    }
  }
  return key;
}

// ── ScrapingBee ───────────────────────────────────────────────────────────────
// Required for FLHSMV crash detail lookups (Akamai bypass).
// Canonical env var: SCRAPINGBEE_API_KEY

let _scrapingBeeLogged = false;

/**
 * Returns the ScrapingBee API key, or null if not configured.
 * When null, FLHSMV crash detail fetching is unavailable.
 */
export function resolveScrapingBeeKey(): string | null {
  const key = (process.env.SCRAPINGBEE_API_KEY || "").trim() || null;

  if (!_scrapingBeeLogged) {
    _scrapingBeeLogged = true;
    if (key) {
      console.log("[VENDOR] ScrapingBee configured: true (SCRAPINGBEE_API_KEY)");
    } else {
      console.error(
        "[VENDOR] ScrapingBee configured: false — " +
        "set SCRAPINGBEE_API_KEY in Railway env vars. FLHSMV crash detail lookups will not run."
      );
    }
  }
  return key;
}

// ── Nimble ────────────────────────────────────────────────────────────────────
// Pipeline API + residential proxy.
// Canonical env vars: NIMBLE_API_USERNAME / NIMBLE_API_PASSWORD (Pipeline API)
//                     NIMBLE_PROXY_USERNAME / NIMBLE_PROXY_PASSWORD (proxy)

let _nimbleLogged = false;

export interface NimbleCredentials {
  apiUsername: string;
  apiPassword: string;
  proxyUsername: string | null;
  proxyPassword: string | null;
}

/**
 * Returns Nimble credentials from env vars, or null if Pipeline API is unconfigured.
 * Logs status once per process.
 */
export function resolveNimbleCredentials(): NimbleCredentials | null {
  const apiUsername = (process.env.NIMBLE_API_USERNAME || "").trim() || null;
  const apiPassword = (process.env.NIMBLE_API_PASSWORD || "").trim() || null;
  const proxyUsername = (process.env.NIMBLE_PROXY_USERNAME || "").trim() || null;
  const proxyPassword = (process.env.NIMBLE_PROXY_PASSWORD || "").trim() || null;

  if (!_nimbleLogged) {
    _nimbleLogged = true;
    const apiOk = !!(apiUsername && apiPassword);
    const proxyOk = !!(proxyUsername && proxyPassword);
    if (apiOk) {
      console.log(`[VENDOR] Nimble Pipeline API configured: true | proxy: ${proxyOk}`);
    } else {
      console.error(
        "[VENDOR] Nimble configured: false — " +
        "set NIMBLE_API_USERNAME + NIMBLE_API_PASSWORD in Railway. DHSMV plate lookups will not run."
      );
    }
  }

  if (!apiUsername || !apiPassword) return null;
  return { apiUsername, apiPassword, proxyUsername, proxyPassword };
}

// ── Startup warnings ──────────────────────────────────────────────────────────
// Call once at process startup to emit a consolidated configuration summary.
// Non-fatal — warns but never throws.

export function emitVendorStartupWarnings(): void {
  const missing: string[] = [];

  if (!resolveBatchDataKey()) missing.push("BATCHDATA_API_KEY (skip-trace disabled)");
  if (!resolveScrapingBeeKey()) missing.push("SCRAPINGBEE_API_KEY (FLHSMV detail lookups disabled)");
  if (!resolveNimbleCredentials()) missing.push("NIMBLE_API_USERNAME + NIMBLE_API_PASSWORD (DHSMV plate lookups disabled)");
  if (!resolveApifyToken()) missing.push("APIFY_API_KEY (Apify scrapers disabled)");

  if (missing.length > 0) {
    console.warn(
      `[VENDOR] ⚠️  ${missing.length} vendor integration(s) unconfigured:\n` +
      missing.map(m => `  · ${m}`).join("\n")
    );
  } else {
    console.log("[VENDOR] ✓ All vendor integrations configured");
  }
}
