/**
 * server/countyCrashFeeds.ts
 *
 * Layer 1 of the SWFL crash expansion — county-level CAD crash-signal feeds.
 *
 * WHY THIS EXISTS
 * ---------------
 * Until now every crash signal entered the platform through a single statewide
 * feed (trafficincidents.flhsmv.gov). When FLHSMV returned HTTP 503 on
 * 2026-05-19 the entire crash pipeline stalled. This module adds independent
 * county-level intake so crash_reports keeps filling during an FLHSMV outage.
 *
 * Scope: Lee, Collier, Charlotte — the SWFL personal-injury core market.
 *
 * Each feed returns SentinelIncidentRaw[] — the SAME shape the FHP feed
 * produces (see server/sentinel.ts). That is deliberate: crashIngestPipeline's
 * dedup (SHA256(id|type|received|location)) and insert path are reused
 * unchanged. This module only adds sources; it never forks the pipeline.
 *
 * SOURCE STATUS (probed 2026-05-19)
 * ---------------------------------
 *   LEE       sheriffleefl.org/public-api/traffic — clean public JSON API.
 *             LIVE. Same /public-api/ namespace as the bookings API already
 *             used by countyBookingScrapers.ts.
 *   COLLIER   colliersheriff.org sits behind an Akamai WAF (HTTP 403 to every
 *             datacenter request, including /public-api/*). Reachable only via
 *             a residential render. Implemented best-effort via Nimble; returns
 *             [] when Nimble is unconfigured or the page yields nothing.
 *   CHARLOTTE ccso.org publishes no public CAD / active-calls feed (verified —
 *             only an arrest database + warrants). Not implemented. Charlotte
 *             crash NAMES are still covered by Layer 2 (clerk-of-courts).
 *
 * Cross-source overlap: an FHP highway crash and an LCSO CAD crash for the same
 * wreck have different ids/type/location strings, so the SHA256 dedup will not
 * collide them. FHP (highways) and LCSO (county/city roads) are largely
 * complementary jurisdictions, so overlap is modest; generic LCSO "CRASH" rows
 * are emitted at "medium" severity and therefore do not auto-create duplicate
 * leads (isQualifyingCrash requires high/critical). A geo+time fuzzy
 * cross-source dedup is a documented fast-follow.
 */

import axios from "axios";
import type { SentinelIncidentRaw } from "./sentinel";

// Hard county allowlist — anything outside SWFL is dropped at intake.
export const COUNTY_CRASH_SCOPE = ["LEE", "COLLIER", "CHARLOTTE"] as const;

// Per-feed hard timeout so one slow county can never stall the ingest tick.
const FEED_TIMEOUT_MS = 15_000;

/**
 * CAD "nature" / type strings that indicate a vehicle crash. Used to filter a
 * county's full call feed down to crashes. Matched case-insensitively as a
 * substring so "TRAFFIC CRASH", "CRASH W/INJURIES", etc. all qualify.
 */
const CRASH_NATURE_PATTERNS = [
  "CRASH", "ACCIDENT", "HIT AND RUN", "HIT & RUN", "H&R",
  "VEHICLE COLLISION", "MVA", "OVERTURN", "ROLLOVER", "ENTRAPMENT",
  "PEDESTRIAN STRUCK", "VEHICLE VS",
];

/** Keywords that promote a crash to "high" severity (injury / lead-qualifying). */
const HIGH_SEVERITY_PATTERNS = [
  "INJUR", "FATAL", "ENTRAP", "EXTRICAT", "TRAUMA", "ROLLOVER", "OVERTURN",
  "PEDESTRIAN", "BICYCLE", "MOTORCYCLE", "SIGNAL 4", "EJECT",
];

function isCrashNature(nature: string | null | undefined): boolean {
  if (!nature) return false;
  const upper = nature.toUpperCase();
  return CRASH_NATURE_PATTERNS.some((kw) => upper.includes(kw));
}

function deriveSeverity(nature: string, remarks: string): "high" | "medium" {
  const blob = `${nature} ${remarks}`.toUpperCase();
  return HIGH_SEVERITY_PATTERNS.some((kw) => blob.includes(kw)) ? "high" : "medium";
}

// ── LEE COUNTY ────────────────────────────────────────────────────────────────
// sheriffleefl.org/public-api/traffic returns a live JSON snapshot of recent
// traffic CAD calls. Shape (verified 2026-05-19):
//   { id, nature, address, city, date, remarks, status }
// It is a snapshot feed (no pagination / date params) — exactly like the FHP
// feed — so the pipeline's dedup-not-time-filtering model applies directly.

const LEE_TRAFFIC_API = "https://www.sheriffleefl.org/public-api/traffic";

interface LeeTrafficRecord {
  id: string;
  nature: string;
  address: string;
  city: string;
  date: string;       // "YYYY-MM-DD HH:MM:SS"
  remarks: string;
  status: string;
}

export async function fetchLeeCrashFeed(): Promise<SentinelIncidentRaw[]> {
  try {
    const resp = await axios.get<LeeTrafficRecord[]>(LEE_TRAFFIC_API, {
      timeout: FEED_TIMEOUT_MS,
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
          "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
      },
    });

    const rows = Array.isArray(resp.data) ? resp.data : [];
    const incidents: SentinelIncidentRaw[] = [];

    for (const r of rows) {
      if (!r || !r.id || !isCrashNature(r.nature)) continue;

      const address = (r.address || "").trim();
      const city = (r.city || "").trim();
      if (!address) continue;

      // Match the FHP location convention: "<address> [<city>], LEE County, FL"
      const location = `${address}${city ? ` [${city}]` : ""}, LEE County, FL`;
      const severity = deriveSeverity(r.nature || "", r.remarks || "");

      incidents.push({
        id: r.id,
        type: r.nature || "CRASH",
        location,
        lat: null,
        lng: null,
        severity,
        actionRequired: severity === "high",
        source: "lcso_cad",
        state: "FL",
        county: "LEE",
        remarks: r.remarks || "",
        received: r.date || "",
      });
    }

    console.log(
      `[COUNTY-CRASH] LEE: ${rows.length} CAD call(s) → ${incidents.length} crash signal(s)`,
    );
    return incidents;
  } catch (err: any) {
    console.warn(`[COUNTY-CRASH] LEE feed failed (non-fatal): ${err.message}`);
    return [];
  }
}

// ── COLLIER COUNTY ────────────────────────────────────────────────────────────
// colliersheriff.org is behind an Akamai WAF — every datacenter request (page
// or /public-api/*) returns HTTP 403. The Traffic 24/7 page must be fetched
// through a residential render. Nimble is the tool countyBookingScrapers.ts
// already uses for exactly this. Until the live page's data XHR is confirmed
// from a browser, this returns [] — a deliberate honest no-op rather than a
// blind parser. Layer 2 (clerk-of-courts) still recovers Collier crash names.

export async function fetchCollierCrashFeed(): Promise<SentinelIncidentRaw[]> {
  const username = (process.env.NIMBLE_USERNAME || "").trim();
  const password = (process.env.NIMBLE_PASSWORD || "").trim();
  if (!username || !password) {
    console.log(
      "[COUNTY-CRASH] COLLIER: skipped — Nimble not configured " +
        "(set NIMBLE_USERNAME + NIMBLE_PASSWORD to enable the residential render path)",
    );
    return [];
  }

  // Endpoint intentionally unconfirmed — see module header. Returns [] until the
  // Collier Traffic 24/7 data XHR is captured from a live browser session.
  console.log(
    "[COUNTY-CRASH] COLLIER: feed endpoint unconfirmed — emitting 0 signals " +
      "(pending live-page XHR discovery; tracked as a fast-follow)",
  );
  return [];
}

// ── AGGREGATOR ────────────────────────────────────────────────────────────────
// Runs every county feed with Promise.allSettled + a per-feed timeout so one
// hanging or throwing feed can never stall or fail the crash ingest tick.

export async function fetchAllCountyCrashFeeds(): Promise<SentinelIncidentRaw[]> {
  const feeds: Array<{ county: string; run: () => Promise<SentinelIncidentRaw[]> }> = [
    { county: "LEE", run: fetchLeeCrashFeed },
    { county: "COLLIER", run: fetchCollierCrashFeed },
    // CHARLOTTE — no public CAD feed exists (see module header).
  ];

  const settled = await Promise.allSettled(
    feeds.map(({ county, run }) =>
      withTimeout(run(), FEED_TIMEOUT_MS + 5_000, county),
    ),
  );

  const incidents: SentinelIncidentRaw[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      incidents.push(...result.value);
    } else {
      console.warn(
        `[COUNTY-CRASH] ${feeds[i].county} feed rejected (non-fatal): ${result.reason}`,
      );
    }
  });

  // Scope guard — defence in depth against a feed emitting an out-of-scope row.
  const scoped = incidents.filter(
    (inc) => inc.county && (COUNTY_CRASH_SCOPE as readonly string[]).includes(inc.county.toUpperCase()),
  );

  console.log(
    `[COUNTY-CRASH] Aggregated ${scoped.length} county crash signal(s) from ${feeds.length} feed(s)`,
  );
  return scoped;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} feed timed out after ${ms}ms`)), ms),
    ),
  ]);
}
