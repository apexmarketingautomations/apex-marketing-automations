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

// ── BatchData ─────────────────────────────────────────────────────────────────
// Canonical env var: BATCHDATA_API_KEY
// Legacy alias:      BATCH_DATA   (kept for Railway envs set before the rename)

let _batchDataLogged = false;

/**
 * Returns the BatchData API key, or null if not configured.
 * Logs configuration status once per process (boolean only, never the value).
 */
export function resolveBatchDataKey(): string | null {
  const key = (
    process.env.BATCHDATA_API_KEY ||
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
