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
//   13 = Apex Main   (APEX_MAIN_ACCOUNT_ID  in crashIngestPipeline)
//   14 = Giovanni    (GIOVANNI_ACCOUNT_ID    in crashIngestPipeline)
export const CRASH_LEAD_ACCOUNT_IDS = new Set<number>([3, 13, 14]);

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
// Canonical env var: APIFY_API_KEY
// Legacy aliases:    APIFY_API_TOKEN, APIFY_TOKEN

let _apifyLogged = false;

/**
 * Returns the Apify API token, or null if not configured.
 * Logs configuration status once per process (boolean only, never the value).
 */
export function resolveApifyToken(): string | null {
  const key = (
    process.env.APIFY_API_KEY   ||
    process.env.APIFY_API_TOKEN ||
    process.env.APIFY_TOKEN     ||
    ""
  ).trim() || null;

  if (!_apifyLogged) {
    _apifyLogged = true;
    if (key) {
      console.log("[VENDOR] Apify configured: true (APIFY_API_KEY / APIFY_API_TOKEN / APIFY_TOKEN)");
    } else {
      console.error(
        "[VENDOR] Apify configured: false — " +
        "set APIFY_API_KEY in Railway env vars. Attorney + transport scrapers will not run."
      );
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
