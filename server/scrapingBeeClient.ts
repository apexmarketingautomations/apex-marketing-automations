/**
 * server/scrapingBeeClient.ts
 *
 * Shared ScrapingBee client for the Apex platform.
 *
 * ScrapingBee routes requests through residential / premium proxy pools,
 * handles JS rendering, and bypasses Akamai / Cloudflare blocks — essential
 * for FLHSMV, DHSMV, county booking, and other government sites that reject
 * datacenter IPs.
 *
 * Credentials: SCRAPINGBEE_API_KEY set in Railway env vars (never hardcoded).
 *
 * Proxy modes (SCRAPINGBEE_MODE env var):
 *   "standard" — no proxy upgrade, cheapest (~1 credit). Plain residential rotation.
 *   "premium"  — premium_proxy=true, ~10 credits. Beats most Akamai blocks. DEFAULT.
 *   "stealth"  — stealth_proxy=true, 75 credits. Full Akamai + Cloudflare bypass.
 */

const SCRAPINGBEE_BASE = "https://app.scrapingbee.com/api/v1/";
const SCRAPINGBEE_MODE = (process.env.SCRAPINGBEE_MODE ?? "premium").toLowerCase();

function getKey(): string | null {
  return (process.env.SCRAPINGBEE_API_KEY ?? "").trim() || null;
}

export function isScrapingBeeConfigured(): boolean {
  return !!getKey();
}

// ── Option / Result types ─────────────────────────────────────────────────────

export interface ScrapingBeeOptions {
  url: string;
  /** Render JavaScript before returning HTML. Costs more credits. Default: false */
  renderJs?: boolean;
  /** 2-letter country code to geo-target the exit node. Default: "us" */
  countryCode?: string;
  /**
   * Proxy tier. Overrides the global SCRAPINGBEE_MODE for this individual request.
   * "standard" | "premium" | "stealth"
   */
  mode?: "standard" | "premium" | "stealth";
  /**
   * When true, original request headers are forwarded to the target.
   * ScrapingBee strips the "Spb-" prefix it adds internally.
   */
  forwardHeaders?: boolean;
  /** Extra headers to pass to the target (forwarded with "Spb-" prefix if forwardHeaders=true) */
  headers?: Record<string, string>;
  /** POST body (sets method to POST automatically) */
  body?: string;
  /** Content-Type for POST requests. Default: "application/x-www-form-urlencoded" */
  contentType?: string;
  /** Block ads / trackers to speed up JS renders. Default: false */
  blockAds?: boolean;
  /** Block images to reduce data usage on JS renders. Default: false */
  blockResources?: boolean;
  /** Base64-encoded JavaScript snippet to execute after page load (requires renderJs=true) */
  jsSnippet?: string;
  /** Milliseconds to wait after the JS snippet executes before capturing the DOM */
  waitMs?: number;
  /** Return full JSON envelope (body, cookies, headers, xhr intercepts) instead of raw HTML */
  jsonResponse?: boolean;
}

export interface ScrapingBeeXhr {
  url: string;
  method: string;
  status: number;
  /** Response body as a string */
  response: string;
  headers?: Record<string, string>;
}

export interface ScrapingBeeResult {
  ok: boolean;
  /** HTTP status returned by the TARGET site (not ScrapingBee's wrapper status) */
  status: number;
  html: string;
  /** Cookies set during the page load (only present when jsonResponse=true) */
  cookies?: Array<{ name: string; value: string; domain?: string; path?: string }>;
  /** XHR/AJAX requests captured during JS rendering (only present when jsonResponse=true) */
  xhr?: ScrapingBeeXhr[];
  /** Set when the fetch failed entirely (network error or ScrapingBee API error) */
  error?: string;
}

// ── URL builder ───────────────────────────────────────────────────────────────

export function buildScrapingBeeUrl(opts: Pick<ScrapingBeeOptions, "url" | "renderJs" | "countryCode" | "mode" | "forwardHeaders" | "blockAds" | "blockResources" | "jsSnippet" | "waitMs" | "jsonResponse">): string {
  const key = getKey();
  if (!key) throw new Error("SCRAPINGBEE_API_KEY not set");

  const mode = opts.mode ?? SCRAPINGBEE_MODE;

  const params = new URLSearchParams({
    api_key:      key,
    url:          opts.url,
    render_js:    String(opts.renderJs ?? false),
    country_code: opts.countryCode ?? "us",
  });

  if (opts.forwardHeaders)              params.set("forward_headers", "true");
  if (opts.blockAds)                   params.set("block_ads", "true");
  if (opts.blockResources !== undefined) params.set("block_resources", String(opts.blockResources));
  if (opts.jsSnippet)      params.set("js_snippet", opts.jsSnippet);
  if (opts.waitMs)         params.set("wait", String(opts.waitMs));
  if (opts.jsonResponse)   params.set("json_response", "true");

  if (mode === "stealth") {
    params.set("stealth_proxy", "true");
  } else if (mode === "premium") {
    params.set("premium_proxy", "true");
  }
  // "standard" → no extra flag; default ScrapingBee rotation

  return `${SCRAPINGBEE_BASE}?${params.toString()}`;
}

// ── Main fetch function ───────────────────────────────────────────────────────

/**
 * Fetch a URL through ScrapingBee.
 *
 * Returns the raw HTML from the target page.
 * Falls back gracefully with ok=false when the API key is absent.
 */
export async function scrapingBeeFetch(opts: ScrapingBeeOptions): Promise<ScrapingBeeResult> {
  const key = getKey();
  if (!key) {
    return {
      ok:    false,
      status: 0,
      html:  "",
      error: "SCRAPINGBEE_API_KEY not configured",
    };
  }

  let proxyUrl: string;
  try {
    proxyUrl = buildScrapingBeeUrl(opts);
  } catch (err: any) {
    return { ok: false, status: 0, html: "", error: err.message };
  }

  // When forwardHeaders=true, ScrapingBee expects original headers prefixed with "Spb-"
  const reqHeaders: Record<string, string> = {};
  if (opts.headers && opts.forwardHeaders) {
    for (const [k, v] of Object.entries(opts.headers)) {
      reqHeaders[`Spb-${k}`] = v;
    }
  } else if (opts.headers) {
    Object.assign(reqHeaders, opts.headers);
  }

  const init: RequestInit = {
    method:  opts.body ? "POST" : "GET",
    headers: reqHeaders,
  };
  if (opts.body) {
    init.body = opts.body;
    if (!reqHeaders["Content-Type"]) {
      reqHeaders["Content-Type"] = opts.contentType ?? "application/x-www-form-urlencoded";
    }
  }

  try {
    const res = await fetch(proxyUrl, init);
    const body = await res.text();

    if (!res.ok) {
      console.warn(`[SCRAPINGBEE] HTTP ${res.status} fetching ${opts.url}: ${body.slice(0, 200)}`);
      const targetStatus = res.headers.get("Spb-Status");
      const status = targetStatus ? parseInt(targetStatus, 10) : res.status;
      return { ok: false, status, html: body, error: `HTTP ${res.status}` };
    }

    // json_response=true → ScrapingBee wraps everything in a JSON envelope
    if (opts.jsonResponse) {
      try {
        const envelope = JSON.parse(body) as {
          body?: string;
          status_code?: number;
          cookies?: ScrapingBeeXhr[];
          xhr?: ScrapingBeeXhr[];
          [k: string]: unknown;
        };
        const html   = envelope.body ?? "";
        const status = envelope.status_code ?? 200;
        return {
          ok:      status < 400,
          status,
          html,
          cookies: (envelope.cookies as any) ?? [],
          xhr:     envelope.xhr ?? [],
        };
      // allow-silent-catch: malformed JSON from ScrapingBee — return error result, nothing useful to log
      } catch {
        return { ok: false, status: 0, html: body, error: "json_response parse failed" };
      }
    }

    // ScrapingBee passes the target's status via the "Spb-Status" response header
    // when forward_headers=true; otherwise we use ScrapingBee's own status code.
    const targetStatus = res.headers.get("Spb-Status");
    const status = targetStatus ? parseInt(targetStatus, 10) : res.status;
    return { ok: status < 400, status, html: body };
  } catch (err: any) {
    console.error(`[SCRAPINGBEE] Fetch failed for ${opts.url}: ${err.message}`);
    return { ok: false, status: 0, html: "", error: err.message };
  }
}

// ── Convenience: drop-in replacement for flhsmvFetch ─────────────────────────

let _modeLogged = false;

/**
 * Fetch a URL, routing through ScrapingBee when the API key is present.
 * Falls back to a direct fetch when the key is absent (with a one-time warning).
 *
 * Drop-in for the inline `flhsmvFetch()` that used to live in crashReportWorker.ts.
 */
export async function proxiedFetch(
  targetUrl: string,
  init: RequestInit = {},
  sbOpts: Partial<ScrapingBeeOptions> = {},
): Promise<Response> {
  if (!isScrapingBeeConfigured()) {
    if (!_modeLogged) {
      console.warn(
        "[SCRAPINGBEE] ⚠️  SCRAPINGBEE_API_KEY not set — falling back to direct fetch. " +
        "Government sites may block datacenter IPs."
      );
      _modeLogged = true;
    }
    return fetch(targetUrl, init);
  }

  if (!_modeLogged) {
    console.log(`[SCRAPINGBEE] ✅ Proxying requests through ScrapingBee (mode=${sbOpts.mode ?? SCRAPINGBEE_MODE})`);
    _modeLogged = true;
  }

  const proxyUrl = buildScrapingBeeUrl({ url: targetUrl, forwardHeaders: true, ...sbOpts });

  // Prefix original headers with "Spb-" so they're forwarded to the target
  const originalHeaders = (init.headers as Record<string, string> | undefined) ?? {};
  const spbHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(originalHeaders)) {
    spbHeaders[`Spb-${k}`] = v;
  }

  return fetch(proxyUrl, { ...init, headers: spbHeaders });
}
