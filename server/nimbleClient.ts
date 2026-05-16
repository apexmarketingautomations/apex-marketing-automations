/**
 * Nimble API Client
 *
 * Wraps Nimble's Pipeline API (web scraping) and Residential Proxy pool.
 * Credentials live in Railway env vars — never hardcoded.
 *
 * Pipeline API: routes requests through Nimble's cloud infrastructure,
 * handles JS rendering, CAPTCHA bypass, and geo-targeting.
 *
 * Residential Proxy: standard HTTP proxy that routes through real residential
 * IPs — useful when the target site allows JS but blocks datacenter IPs.
 */

const NIMBLE_API_USERNAME = process.env.NIMBLE_API_USERNAME;
const NIMBLE_API_PASSWORD = process.env.NIMBLE_API_PASSWORD;
const NIMBLE_PROXY_USERNAME = process.env.NIMBLE_PROXY_USERNAME;
const NIMBLE_PROXY_PASSWORD = process.env.NIMBLE_PROXY_PASSWORD;

const NIMBLE_PIPELINE_URL = "https://api.nimbleway.com/v1/pipeline";
const NIMBLE_PROXY_HOST   = "gw.nimbleway.com";
const NIMBLE_PROXY_PORT   = 7000;

export function isNimbleConfigured(): boolean {
  return !!(NIMBLE_API_USERNAME && NIMBLE_API_PASSWORD);
}

export function isNimbleProxyConfigured(): boolean {
  return !!(NIMBLE_PROXY_USERNAME && NIMBLE_PROXY_PASSWORD);
}

function basicAuthHeader(): string {
  const token = Buffer.from(`${NIMBLE_API_USERNAME}:${NIMBLE_API_PASSWORD}`).toString("base64");
  return `Basic ${token}`;
}

export interface NimblePipelineOptions {
  url: string;
  method?: "GET" | "POST";
  /** POST body if method=POST */
  body?: Record<string, string>;
  /** Render JavaScript before extracting (costs more credits) */
  render?: boolean;
  /** 2-letter country code for geo-targeting (default: US) */
  country?: string;
  /** Parse type hint — "html" (default) or "markdown" */
  parse?: "html" | "markdown";
  /** Wait ms after page load before extracting (JS render only) */
  waitMs?: number;
}

export interface NimblePipelineResult {
  ok: boolean;
  status: number;
  html: string;
  error?: string;
}

/**
 * Fetch a URL through Nimble's Pipeline API.
 * Use this for government sites behind Akamai / CAPTCHA gates.
 */
export async function nimblePipelineFetch(opts: NimblePipelineOptions): Promise<NimblePipelineResult> {
  if (!isNimbleConfigured()) {
    return { ok: false, status: 0, html: "", error: "NIMBLE_API_USERNAME / NIMBLE_API_PASSWORD not set" };
  }

  const payload: Record<string, unknown> = {
    url:     opts.url,
    method:  opts.method ?? "GET",
    render:  opts.render ?? false,
    country: opts.country ?? "US",
  };
  if (opts.body)   payload["data"] = opts.body;
  if (opts.waitMs) payload["wait"] = opts.waitMs;

  try {
    const res = await fetch(NIMBLE_PIPELINE_URL, {
      method:  "POST",
      headers: {
        "Authorization": basicAuthHeader(),
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();

    if (!res.ok) {
      console.warn(`[NIMBLE] Pipeline HTTP ${res.status} for ${opts.url}: ${text.slice(0, 200)}`);
      return { ok: false, status: res.status, html: text, error: `HTTP ${res.status}` };
    }

    // Nimble returns { html: "...", status_code: 200, ... }
    let html = text;
    let statusCode = res.status;
    try {
      const json = JSON.parse(text);
      html       = json.html ?? json.body ?? json.content ?? text;
      statusCode = json.status_code ?? res.status;
    } catch { // allow-silent-catch: JSON.parse fails when Nimble returns raw HTML — fall back to raw text which is already assigned
    }

    return { ok: statusCode < 400, status: statusCode, html };
  } catch (err: any) {
    console.error(`[NIMBLE] Pipeline fetch failed for ${opts.url}: ${err.message}`);
    return { ok: false, status: 0, html: "", error: err.message };
  }
}

/**
 * Returns the Nimble residential proxy URL for use with an HTTP proxy agent.
 * Useful when you want raw proxy access rather than the pipeline API.
 */
export function nimbleProxyUrl(): string | null {
  if (!isNimbleProxyConfigured()) return null;
  return `http://${NIMBLE_PROXY_USERNAME}:${NIMBLE_PROXY_PASSWORD}@${NIMBLE_PROXY_HOST}:${NIMBLE_PROXY_PORT}`;
}
