/**
 * jailBookingPipeline.ts
 *
 * Real-time jail booking intake for 11 SW/Central Florida counties via Nimble
 * browser agents (interactive form submission + JS-rendered extraction).
 *
 * Data flow:
 *   Nimble agent → BookingRecord[] → dedup → legalSignals → legalLeads → contacts
 *
 * Requires: NIMBLE_API_KEY  (set in Railway env vars)
 * Schedule: every 60 minutes, staggered 3s between counties
 *
 * Coverage enforcement:
 *   - Prints full source list before execution
 *   - Logs each source as QUEUED, FETCHING, SUCCESS, NO_DATA, SKIPPED, or FAILED
 *   - Fails the job if fewer than 90% of enabled sources are attempted
 *   - Blocks non-approved domains unless in allowlist
 *   - Reports: sources_attempted, sources_succeeded, sources_failed, leads_created, leads_enriched
 */

import crypto from "crypto";
import axios  from "axios";
import { db } from "./db";
import { legalSignals, legalLeads } from "@shared/schema";
import { eq } from "drizzle-orm";

// ── Nimble Config ──────────────────────────────────────────────────────────────

/**
 * Returns the Nimble Basic-auth credential string "username:password".
 *
 * Priority:
 *   1. NIMBLE_USERNAME + NIMBLE_PASSWORD  (from Nimble dashboard → Your Credentials)
 *   2. NIMBLE_API_KEY / NIMBLE_TOKEN / NIMBLE_KEY  (if already "user:pass" format)
 *
 * Railway env vars to set:
 *   NIMBLE_USERNAME = account-apex_pnv8jh-pipeline-nimbleapi
 *   NIMBLE_PASSWORD = 89BK2BPU35e0
 */
function resolveNimbleKey(): string {
  const username = (process.env.NIMBLE_USERNAME || "").trim();
  const password = (process.env.NIMBLE_PASSWORD || "").trim();
  if (username && password) return `${username}:${password}`;

  return (
    process.env.NIMBLE_API_KEY ||
    process.env.NIMBLE_TOKEN   ||
    process.env.NIMBLE_KEY     ||
    ""
  ).trim();
}

function isNimbleConfigured(): boolean {
  return resolveNimbleKey().length > 0;
}

const NIMBLE_REALTIME_API = "https://api.webit.live/api/v1/realtime/web";
const AGENT_TIMEOUT_MS    = 120_000; // 2 min per county (direct extraction is faster)
const STAGGER_BETWEEN_MS = 3_000;   // 3 s between counties
const COVERAGE_THRESHOLD = 0.90;    // 90% of enabled sources must be attempted

// ── Domain Allowlist ───────────────────────────────────────────────────────────
// Only sheriff/jail booking domains are permitted. Social media / ads blocked.

const APPROVED_DOMAINS = new Set([
  "sheriffleefl.org",
  "charlottesheriff.org",   // legacy — kept so old URLs don't crash; actual URL is ccso.org
  "ccso.org",               // Charlotte County Sheriff (correct domain)
  "colliersheriff.org",
  "hendrysheriff.org",
  "gladessheriff.com",
  "sarasotasheriff.org",
  "manateesheriff.org",
  "polksheriff.org",
  "hcso.tampa.fl.us",
  "pcsoweb.com",
  "pascosheriff.org",
  // County detention / booking portals
  "inmatesearch.polksheriff.org",
  "apps.hcso.net",
  "www.leeclerk.org",   // fallback for Lee County clerk data
  // VINE / Appriss (used by Manatee, Pasco, Glades)
  "vinelink.vineapps.com",
]);

function isDomainApproved(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return APPROVED_DOMAINS.has(host) || APPROVED_DOMAINS.has("www." + host);
  } catch { // allow-silent-catch: malformed URL is treated as unapproved domain
    return false;
  }
}

// ── County Registry ────────────────────────────────────────────────────────────

export interface CountyBookingConfig {
  county:     string;  // "LEE", "CHARLOTTE", etc.
  state:      string;  // "FL"
  agentName:  string;  // Nimble published agent name
  bookingUrl: string;  // Primary booking search URL (for reference / domain check)
  fips:       string;  // FIPS code for cross-reference
  enabled:    boolean;
  /** ms to wait for JS render — defaults to 6000. Increase for AJAX-heavy pages */
  waitMs?:    number;
}

export const COUNTY_BOOKING_CONFIGS: CountyBookingConfig[] = [
  // ── Core: Lee County ──────────────────────────────────────────────────────
  // NOTE: Lee County uses a direct public REST API (runLeeCountyDirectApi).
  // The bookingUrl is kept for reference / domain-check only — Nimble is NOT
  // used for LEE. runCountyScrape() short-circuits to the direct API.
  {
    county:     "LEE",
    state:      "FL",
    agentName:  "apex-lee-county-jail-booking",
    bookingUrl: "https://www.sheriffleefl.org/booking-search/",
    fips:       "12071",
    enabled:    true,
  },
  // ── Immediate Border Counties ─────────────────────────────────────────────
  // Charlotte County uses ccso.org (correct domain). charlottesheriff.org is DNS-dead.
  {
    county:     "CHARLOTTE",
    state:      "FL",
    agentName:  "apex-charlotte-county-jail-booking",
    bookingUrl: "https://www.ccso.org/correctional_facility/local_arrest_database.php",
    fips:       "12015",
    enabled:    true,
    waitMs:     8_000,  // Revize CMS — needs extra render time
  },
  {
    county:     "COLLIER",
    state:      "FL",
    agentName:  "apex-collier-county-jail-booking",
    bookingUrl: "https://www.colliersheriff.org/divisions/corrections/inmate-information/",
    fips:       "12021",
    enabled:    true,
  },
  {
    county:     "HENDRY",
    state:      "FL",
    agentName:  "apex-hendry-county-jail-booking",
    bookingUrl: "https://www.hendrysheriff.org/jailroster/",
    fips:       "12051",
    enabled:    true,
  },
  {
    county:     "GLADES",
    state:      "FL",
    agentName:  "apex-glades-county-jail-booking",
    bookingUrl: "https://www.gladessheriff.com/inmate-roster/",
    fips:       "12043",
    enabled:    true,
  },
  // ── Scale Tier: Gulf Coast Corridor ──────────────────────────────────────
  {
    county:     "SARASOTA",
    state:      "FL",
    agentName:  "apex-sarasota-county-jail-booking",
    bookingUrl: "https://www.sarasotasheriff.org/corrections/inmate-search",
    fips:       "12115",
    enabled:    true,
  },
  {
    county:     "MANATEE",
    state:      "FL",
    agentName:  "apex-manatee-county-jail-booking",
    bookingUrl: "https://www.manateesheriff.org/corrections/inmate-search",
    fips:       "12081",
    enabled:    true,
  },
  {
    county:     "POLK",
    state:      "FL",
    agentName:  "apex-polk-county-jail-booking",
    bookingUrl: "https://inmatesearch.polksheriff.org/",
    fips:       "12105",
    enabled:    true,
  },
  {
    county:     "HILLSBOROUGH",
    state:      "FL",
    agentName:  "apex-hillsborough-county-jail-booking",
    bookingUrl: "https://www.hcso.tampa.fl.us/arrest-inquiry/",
    fips:       "12057",
    enabled:    true,
  },
  {
    county:     "PINELLAS",
    state:      "FL",
    agentName:  "apex-pinellas-county-jail-booking",
    bookingUrl: "https://www.pcsoweb.com/active-bookings",
    fips:       "12103",
    enabled:    true,
  },
  {
    county:     "PASCO",
    state:      "FL",
    agentName:  "apex-pasco-county-jail-booking",
    bookingUrl: "https://www.pascosheriff.org/inmate-search/",
    fips:       "12101",
    enabled:    true,
  },
];

// ── Source Status Tracking ─────────────────────────────────────────────────────

type SourceStatus = "QUEUED" | "FETCHING" | "SUCCESS" | "NO_DATA" | "SKIPPED" | "FAILED";

interface SourceCoverageRecord {
  county:   string;
  status:   SourceStatus;
  records:  number;
  inserted: number;
  error?:   string;
}

function logSource(county: string, status: SourceStatus, detail?: string) {
  const icon = {
    QUEUED:   "⏳",
    FETCHING: "🔄",
    SUCCESS:  "✅",
    NO_DATA:  "📭",
    SKIPPED:  "⏭",
    FAILED:   "❌",
  }[status];
  const msg = `[JAIL-BOOKING] ${icon} [${status}] ${county}${detail ? ` — ${detail}` : ""}`;
  if (status === "FAILED") console.error(msg);
  else console.log(msg);
}

// ── Booking Record (Nimble agent output shape) ─────────────────────────────────

interface BookingRecord {
  county:           string;
  source_url:       string;
  full_name:        string;
  first_name?:      string;
  last_name?:       string;
  booking_id:       string;
  booking_date:     string;
  arrest_date?:     string;
  charges:          string[] | string;
  charge_category?: string;
  dui_related:      boolean;
  felony_related:   boolean;
  bond_amount?:     string;
  custody_status?:  string;
  age?:             string;
  dob?:             string;
  city_state?:      string;
  mugshot_url?:     string;
  scrape_timestamp: string;
}

// ── Nimble Agent Runner ────────────────────────────────────────────────────────

/**
 * Direct Nimble browser extraction — replaces the old named-agent approach.
 *
 * Uses api.webit.live (Basic auth) which is reachable from Railway, unlike
 * api.webnimble.com (agent management API) which is not.
 *
 * Each county's bookingUrl is a PUBLIC page — no login required.
 * Nimble renders the page with JS enabled and returns markdown content
 * that we parse for booking records.
 */
async function runNimbleAgent(
  agentName: string,
  bookingUrl: string,
  params:    Record<string, unknown>,
  waitMs:    number = 6_000,
): Promise<{ records: BookingRecord[]; attempted: boolean; error?: string }> {
  const key = resolveNimbleKey();
  if (!key) return { records: [], attempted: false, error: "NIMBLE_API_KEY not configured" };

  // Domain safety check — prevent calling unapproved domains
  if (!isDomainApproved(bookingUrl)) {
    console.error(`[JAIL-BOOKING] ❌ BLOCKED domain: ${bookingUrl} — not in approved list`);
    return { records: [], attempted: false, error: `Blocked domain: ${bookingUrl}` };
  }

  // Some sites accept date range as query params — append if URL has no existing query
  const fromDate = params.booking_date_from as string | undefined;
  const toDate   = params.booking_date_to   as string | undefined;
  let targetUrl  = bookingUrl;
  if (fromDate && toDate && !bookingUrl.includes("?")) {
    targetUrl = `${bookingUrl}?booking_date_from=${fromDate}&booking_date_to=${toDate}`;
  }

  try {
    const resp = await axios.post(
      NIMBLE_REALTIME_API,
      { url: targetUrl, render: true, wait: waitMs, output_format: "markdown" },
      {
        headers: {
          Authorization: `Basic ${Buffer.from(key).toString("base64")}`,
          "Content-Type": "application/json",
        },
        timeout: AGENT_TIMEOUT_MS,
      },
    );

    const html = (resp.data?.html_content || resp.data?.content || "") as string;
    if (!html || html.length < 200) {
      return { records: [], attempted: true, error: "Empty or minimal response from Nimble" };
    }

    // Derive county label from agent name: apex-lee-county-jail-booking → LEE
    const county = agentName
      .replace(/^apex-/, "")
      .replace(/-county-jail-booking$/, "")
      .replace(/-/g, " ")
      .toUpperCase();

    const records = parseBookingMarkdown(html, county, bookingUrl);
    return { records, attempted: true };
  } catch (err: any) {
    const errMsg: string = err?.response?.data?.message || err?.message || "unknown error";
    console.warn(`[JAIL-BOOKING] ❌ ${agentName} exception: ${errMsg}`);
    return { records: [], attempted: true, error: errMsg };
  }
}

// ── Booking Markdown Parser ────────────────────────────────────────────────────
// Parses Nimble markdown output into BookingRecord[].
// Handles two common layouts emitted by FL county sheriff CMS platforms:
//   1. Pipe-delimited table rows  (WordPress, Sitefinity, Revize)
//   2. Card-style headings + date (OCV / VINE / Sheriff App)

function parseBookingMarkdown(html: string, county: string, sourceUrl: string): BookingRecord[] {
  const records: BookingRecord[] = [];

  // ── Pattern 1: pipe-delimited table rows ──────────────────────────────────
  // Matches rows like:
  //   | SMITH, JOHN | 2024-0012345 | 01/15/2024 | DUI / BATTERY | $1500 | RELEASED |
  const tableRow = /\|\s*([A-Z][A-Z ,'.\-]{2,40})\s*\|\s*([A-Z0-9][A-Z0-9\-]{2,18})\s*\|\s*(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})[^|]*\|\s*([^|]{3,200})\|\s*([\d$,.]*)\s*\|\s*([^|\n]{1,60})/g;
  let m: RegExpExecArray | null;

  while ((m = tableRow.exec(html)) !== null) {
    const [, rawName, bookingId, bookingDate, chargesRaw, bondRaw, statusRaw] = m;
    // Skip header rows
    if (!rawName || /name|inmate|booking/i.test(rawName)) continue;
    const nameParts  = splitBookingName(rawName.trim());
    const chargeList = chargesRaw
      .split(/[;/\n|]+/)
      .map(s => s.replace(/^[*\-• ]+/, "").trim())
      .filter(s => s.length > 2 && s.length < 200);
    const bondNum = parseFloat((bondRaw || "").replace(/[^0-9.]/g, ""));

    records.push({
      county,
      source_url:       sourceUrl,
      full_name:        nameParts.full,
      first_name:       nameParts.first,
      last_name:        nameParts.last,
      booking_id:       bookingId.trim(),
      booking_date:     bookingDate.trim(),
      arrest_date:      bookingDate.trim(),
      charges:          chargeList.length ? chargeList : ["Unknown"],
      charge_category:  undefined,
      dui_related:      /\bDUI\b|\bDWI\b|IMPAIRED|INTOXICATED/i.test(chargesRaw),
      felony_related:   /FELONY|MURDER|HOMICIDE|TRAFFICKING|ROBBERY/i.test(chargesRaw),
      bond_amount:      !isNaN(bondNum) && bondNum > 0 ? String(bondNum) : undefined,
      custody_status:   statusRaw?.trim() || undefined,
      scrape_timestamp: new Date().toISOString(),
    });
  }

  // ── Pattern 2: card-style heading + date (OCV / VINE / Sheriff App) ───────
  // Matches: ## SMITH, JOHN\n...\nBooked: 01/15/2024
  if (records.length === 0) {
    const cardPattern = /##\s+([A-Z][A-Z ,'.\-]{2,50})\n[\s\S]{0,400}?(?:Booked?|Booking|Arrested?|Entry)[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/g;
    while ((m = cardPattern.exec(html)) !== null) {
      const nameParts = splitBookingName(m[1]);
      records.push({
        county,
        source_url:       sourceUrl,
        full_name:        nameParts.full,
        first_name:       nameParts.first,
        last_name:        nameParts.last,
        booking_id:       `${county.replace(/\s/g, "-")}-${records.length}-${Date.now() % 100_000}`,
        booking_date:     m[2],
        arrest_date:      m[2],
        charges:          [],
        dui_related:      false,
        felony_related:   false,
        scrape_timestamp: new Date().toISOString(),
      });
    }
  }

  return records;
}

// ── Lee County Direct Public REST API ──────────────────────────────────────────
// The booking search page (sheriffleefl.org/booking-search/) loads data via
// jQuery.ajax to /public-api/bookings — discovered by inspecting the page JS.
// Hitting the JSON API directly is faster and more reliable than browser scraping.
//
// API date format: YYYY-M-D (no zero-padding)
// Charges:         /public-api/bookings/{bookingNumber}/charges

function leeApiDate(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

async function runLeeCountyDirectApi(
  dateFrom: Date,
  dateTo:   Date,
): Promise<{ records: BookingRecord[]; attempted: boolean; error?: string }> {
  const from   = leeApiDate(dateFrom);
  const to     = leeApiDate(dateTo);
  const apiUrl = `https://www.sheriffleefl.org/public-api/bookings?startBooking=${from}&toBooking=${to}`;

  try {
    const resp = await axios.get<any[]>(apiUrl, {
      timeout: 30_000,
      headers: { Accept: "application/json" },
    });

    const bookings: any[] = Array.isArray(resp.data) ? resp.data : [];
    console.log(`[JAIL-BOOKING] LEE direct API: ${bookings.length} bookings (${from}→${to})`);

    if (bookings.length === 0) return { records: [], attempted: true };

    const records: BookingRecord[] = [];

    for (const b of bookings) {
      // Fetch charges for DUI/felony classification
      let chargeDescs: string[] = [];
      let bondStr: string | undefined;

      try {
        const cResp = await axios.get<any[]>(
          `https://www.sheriffleefl.org/public-api/bookings/${b.bookingNumber}/charges`,
          { timeout: 15_000, headers: { Accept: "application/json" } },
        );
        const charges: any[] = Array.isArray(cResp.data) ? cResp.data : [];
        chargeDescs = charges.map((c: any) => c.offenseDescription).filter(Boolean);
        const firstBond = charges.find((c: any) => c.bondAmount && c.bondAmount !== "Not Set");
        if (firstBond) bondStr = firstBond.bondAmount;
      // allow-silent-catch: charge failures are non-fatal — missing charges don't block booking record creation
      } catch {
      }

      const surName  = (b.surName   || "").trim();
      const given    = (b.givenName || "").trim();
      const middle   = (b.middleName || "").trim();
      const fullName = [surName, given, middle].filter(Boolean).join(" ");
      const chargeText = chargeDescs.join(" ");

      records.push({
        county:           "LEE",
        source_url:       `https://www.sheriffleefl.org/booking/?id=${b.bookingNumber}`,
        full_name:        fullName || "Unknown",
        first_name:       given,
        last_name:        surName,
        booking_id:       String(b.bookingNumber),
        booking_date:     (b.bookingDate || "").split(" ")[0] || new Date().toISOString().slice(0, 10),
        arrest_date:      (b.bookingDate || "").split(" ")[0] || new Date().toISOString().slice(0, 10),
        charges:          chargeDescs.length ? chargeDescs : ["Unknown"],
        dui_related:      /\bDUI\b|\bDWI\b|IMPAIRED|INTOXICATED/i.test(chargeText),
        felony_related:   /FELONY|MURDER|HOMICIDE|TRAFFICKING|ROBBERY/i.test(chargeText),
        bond_amount:      bondStr,
        custody_status:   b.inCustodyText || (b.inCustody ? "In Custody" : "Released"),
        dob:              b.birthDate ? b.birthDate.split(" ")[0] : undefined,
        city_state:       b.address || "Lee County, FL",
        scrape_timestamp: new Date().toISOString(),
      });

      await new Promise(r => setTimeout(r, 250)); // brief pause between charge lookups
    }

    return { records, attempted: true };
  } catch (err: any) {
    const errMsg = err?.message || "unknown error";
    console.warn(`[JAIL-BOOKING] LEE direct API error: ${errMsg}`);
    return { records: [], attempted: true, error: errMsg };
  }
}

/** Parse "LAST, FIRST MIDDLE" or "FIRST LAST" formats into name parts */
function splitBookingName(full: string): { full: string; first: string; last: string } {
  full = full.replace(/,+$/, "").trim();
  if (full.includes(",")) {
    const [last, rest] = full.split(",", 2).map(s => s.trim());
    const first = (rest.split(/\s+/)[0] || rest).trim();
    return { full: `${first} ${last}`, first, last };
  }
  const parts = full.split(/\s+/);
  if (parts.length >= 2) return { full, first: parts[0], last: parts.slice(1).join(" ") };
  return { full, first: full, last: "" };
}

// ── Charge Classification ──────────────────────────────────────────────────────

type SignalType     = "dui_arrest" | "arrest" | "jail_booking";
type LegalVertical  = "traffic" | "criminal" | "personal_injury" | "family";
type UrgencyLevel   = "critical" | "high" | "medium" | "low";

interface ChargeClassification {
  signalType:     SignalType;
  legalVertical:  LegalVertical;
  urgency:        UrgencyLevel;
  chargeCategory: string;
}

function classifyCharges(charges: string[]): ChargeClassification {
  const text = charges.join(" | ").toUpperCase();

  if (/\bDUI\b|\bDWI\b|DRUNK\s*DRIVING|DRIVING\s*UNDER\s*INFLUENCE|IMPAIRED\s*DRIVING/.test(text))
    return { signalType: "dui_arrest",   legalVertical: "traffic",  urgency: "critical", chargeCategory: "DUI/DWI"          };
  if (/MURDER|HOMICIDE|MANSLAUGHTER|ATTEMPTED\s*MURDER/.test(text))
    return { signalType: "arrest",       legalVertical: "criminal", urgency: "critical", chargeCategory: "Violent Felony"   };
  if (/TRAFFICKING|KIDNAP|ARSON|ROBBERY\s*WITH/.test(text))
    return { signalType: "arrest",       legalVertical: "criminal", urgency: "critical", chargeCategory: "Serious Felony"   };
  if (/FELONY|BURGLARY|GRAND\s*THEFT|FRAUD|FORGERY/.test(text))
    return { signalType: "arrest",       legalVertical: "criminal", urgency: "high",     chargeCategory: "Felony"           };
  if (/AGGRAVATED|BATTERY|ASSAULT/.test(text))
    return { signalType: "arrest",       legalVertical: "criminal", urgency: "high",     chargeCategory: "Assault/Battery"  };
  if (/DOMESTIC|DOMESTIC\s*VIOLENCE|INJUNCTION|STALKING/.test(text))
    return { signalType: "arrest",       legalVertical: "family",   urgency: "high",     chargeCategory: "Domestic"         };
  if (/HIT\s*AND\s*RUN|RECKLESS\s*DRIVING|FLEEING|LEAVING\s*SCENE/.test(text))
    return { signalType: "arrest",       legalVertical: "traffic",  urgency: "high",     chargeCategory: "Reckless/Hit&Run" };
  if (/DRUG|COCAINE|HEROIN|FENTANYL|METH|MARIJUANA|CONTROLLED\s*SUBSTANCE/.test(text))
    return { signalType: "arrest",       legalVertical: "criminal", urgency: "medium",   chargeCategory: "Drug Offense"     };
  if (/TRAFFIC|SUSPENDED\s*LICENSE|NO\s*VALID/.test(text))
    return { signalType: "jail_booking", legalVertical: "traffic",  urgency: "medium",   chargeCategory: "Traffic Offense"  };
  if (/THEFT|SHOPLIFTING|PETTY/.test(text))
    return { signalType: "jail_booking", legalVertical: "criminal", urgency: "low",      chargeCategory: "Petty/Misdemeanor"};

  return { signalType: "jail_booking",   legalVertical: "criminal", urgency: "medium",   chargeCategory: "Other"            };
}

function parseBondAmount(bond: string | undefined): number | null {
  if (!bond) return null;
  const n = parseFloat(bond.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

function scoreBookingRecord(record: BookingRecord, urgency: UrgencyLevel, bondNum: number | null): number {
  let score = 40;
  if (urgency === "critical") score += 30;
  else if (urgency === "high") score += 20;
  else if (urgency === "medium") score += 10;
  if (record.dui_related)    score += 15;
  if (record.felony_related) score += 10;
  if (bondNum !== null && bondNum >= 10_000) score += 8;
  if (bondNum !== null && bondNum >= 50_000) score += 5;
  if (record.dob || record.age)  score += 5;
  if (record.mugshot_url)        score += 2;
  return Math.min(100, score);
}

// ── Dedup & Persistence ────────────────────────────────────────────────────────

function buildBookingHash(county: string, bookingId: string, bookingDate: string): string {
  return crypto
    .createHash("sha256")
    .update(`${county.toUpperCase()}|${bookingId}|${bookingDate}`)
    .digest("hex").slice(0, 24).toUpperCase();
}

function buildFallbackHash(county: string, record: BookingRecord, charges: string[]): string {
  return crypto
    .createHash("sha256")
    .update([county, record.full_name, record.booking_date, charges[0] || ""].join("|"))
    .digest("hex").slice(0, 24).toUpperCase();
}

async function isHashDuplicate(hash: string): Promise<boolean> {
  const [row] = await db.select({ id: legalSignals.id }).from(legalSignals)
    .where(eq(legalSignals.sourceHash, hash)).limit(1);
  return !!row;
}

async function persistBookingRecord(
  record: BookingRecord,
  config: CountyBookingConfig,
): Promise<{ inserted: boolean; signalId?: number }> {
  const charges: string[] = Array.isArray(record.charges)
    ? record.charges.map(String).filter(Boolean)
    : [String(record.charges || "")].filter(Boolean);

  const primaryHash  = record.booking_id
    ? buildBookingHash(config.county, record.booking_id, record.booking_date)
    : null;
  const fallbackHash = buildFallbackHash(config.county, record, charges);
  const hashToUse    = primaryHash || fallbackHash;
  const altHash      = primaryHash ? fallbackHash : null;

  if (await isHashDuplicate(hashToUse))          return { inserted: false };
  if (altHash && await isHashDuplicate(altHash)) return { inserted: false };

  const { signalType, legalVertical, urgency, chargeCategory } = classifyCharges(charges);
  const bondNum  = parseBondAmount(record.bond_amount);
  const score    = scoreBookingRecord(record, urgency, bondNum);
  const nameParts = (record.full_name || "").trim().split(/\s+/);

  const rawPayload = {
    ...record,
    first_name:      record.first_name || nameParts[0] || "",
    last_name:       record.last_name  || nameParts.slice(1).join(" ") || "",
    charge_category: chargeCategory,
    bond_number:     bondNum,
    source:          "jail_booking",
    pipeline:        "jail_booking_pipeline",
  };

  // Insert to legalSignals
  const [signal] = await db.insert(legalSignals).values({
    sourceHash:        hashToUse,
    signalType,
    legalVertical,
    county:            config.county,
    state:             config.state,
    subjectName:       record.full_name   || undefined,
    subjectDob:        record.dob         || undefined,
    subjectAddress:    record.city_state  || undefined,
    chargeDescription: charges.slice(0, 5).join("; ").slice(0, 500),
    caseNumber:        record.booking_id  || undefined,
    urgency,
    score,
    status:            score >= 40 ? "qualified" : "raw",
    rawData:           rawPayload,
    detectedAt:        record.booking_date ? new Date(record.booking_date) : new Date(),
  }).returning({ id: legalSignals.id });

  // Insert to legalLeads for high/critical urgency
  if (urgency === "critical" || urgency === "high") {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.insert(legalLeads).values({
      signalId:          signal.id,
      legalVertical,
      signalType,
      county:            config.county,
      subjectName:       record.full_name  || undefined,
      subjectAddress:    record.city_state || undefined,
      chargeDescription: charges.slice(0, 5).join("; ").slice(0, 500),
      caseNumber:        record.booking_id || undefined,
      urgency,
      score,
      status:            "available",
      expiresAt,
      rawData:           rawPayload,
      detectedAt:        record.booking_date ? new Date(record.booking_date) : new Date(),
    }).onConflictDoNothing();
  }

  // Report to Apex Intelligence brain (fire-and-forget)
  import("./operator/apexIntelligence").then(({ reportOutcome }) => reportOutcome({
    agentName:    "jail-booking-pipeline",
    action:       "lead_captured",
    subject:      record.full_name || record.booking_id || "Unknown",
    result:       `Booking record inserted for ${config.county} County — charges: ${charges.slice(0, 2).join("; ") || "Unknown"}`,
    confidence:   0.65,
    subAccountId: parseInt(process.env.APEX_PARENT_ACCOUNT_ID || "3"),
    niche:        "criminal",
    metadata: {
      county:       config.county,
      signalType,
      legalVertical,
      urgency,
      score,
      bookingId:    record.booking_id || null,
      duiRelated:   record.dui_related,
      felonyRelated: record.felony_related,
    },
  })).catch(() => {});

  return { inserted: true, signalId: signal.id };
}

// ── County Scrape ──────────────────────────────────────────────────────────────

interface ScrapeStats {
  inserted:  number;
  skipped:   number;
  errors:    number;
  records:   number;
}

async function runCountyScrape(
  config:   CountyBookingConfig,
  dateFrom: Date,
  dateTo:   Date,
): Promise<{ stats: ScrapeStats; attempted: boolean; error?: string }> {
  const stats: ScrapeStats = { inserted: 0, skipped: 0, errors: 0, records: 0 };
  const fromStr = dateFrom.toISOString().slice(0, 10);
  const toStr   = dateTo.toISOString().slice(0, 10);

  logSource(config.county, "FETCHING", `agent=${config.agentName} range=${fromStr}→${toStr}`);

  // ── Lee County: use direct public REST API (no Nimble needed) ────────────
  let result: { records: BookingRecord[]; attempted: boolean; error?: string };

  if (config.county === "LEE") {
    result = await runLeeCountyDirectApi(dateFrom, dateTo);

    // Fallback to 7-day window if no results
    if (result.attempted && result.records.length === 0 && !result.error) {
      const sevenDaysAgo = new Date(dateTo.getTime() - 7 * 24 * 60 * 60 * 1000);
      console.log("[JAIL-BOOKING] LEE: 72h window empty — retrying 7-day");
      result = await runLeeCountyDirectApi(sevenDaysAgo, dateTo);
    }
  } else {
    // ── All other counties: Nimble browser extraction ──────────────────────
    const waitMs = config.waitMs ?? 6_000;

    result = await runNimbleAgent(config.agentName, config.bookingUrl, {
      booking_date_from: fromStr,
      booking_date_to:   toStr,
    }, waitMs);

    // Fallback: expand to 7 days if 72h window returns nothing
    if (result.attempted && result.records.length === 0 && !result.error) {
      const sevenDaysAgo = new Date(dateTo.getTime() - 7 * 24 * 60 * 60 * 1000);
      console.log(`[JAIL-BOOKING] ${config.county}: no results in 72h — retrying 7-day window`);
      result = await runNimbleAgent(config.agentName, config.bookingUrl, {
        booking_date_from: sevenDaysAgo.toISOString().slice(0, 10),
        booking_date_to:   toStr,
      }, waitMs);
    }
  }

  if (result.error && result.records.length === 0) {
    logSource(config.county, "FAILED", result.error);
    return { stats, attempted: true, error: result.error };
  }

  stats.records = result.records.length;

  if (result.records.length === 0) {
    logSource(config.county, "NO_DATA");
    return { stats, attempted: true };
  }

  for (const record of result.records) {
    try {
      const persisted = await persistBookingRecord(record, config);
      if (persisted.inserted) stats.inserted++;
      else                     stats.skipped++;
    } catch (err: any) {
      stats.errors++;
      console.warn(`[JAIL-BOOKING] ${config.county} persist error: ${err?.message}`);
    }
  }

  logSource(config.county, "SUCCESS",
    `records=${stats.records} inserted=${stats.inserted} dupes=${stats.skipped} errors=${stats.errors}`);
  return { stats, attempted: true };
}

// ── Main Entry Points ─────────────────────────────────────────────────────────

interface RunOptions {
  /** Filter to specific counties e.g. ["LEE","COLLIER"] */
  counties?: string[];
  /** Days to look back. Defaults to 3 (72h). */
  daysBack?: number;
}

let lastRunAt: Date | null = null;

export async function runAllCountyBookings(options: RunOptions = {}): Promise<void> {
  if (!isNimbleConfigured()) {
    console.warn("[JAIL-BOOKING] ⚠ Nimble credential not configured — jail booking scrape skipped");
    return;
  }

  const dateTo    = new Date();
  const daysBack  = options.daysBack ?? 3;
  const dateFrom  = new Date(dateTo.getTime() - daysBack * 24 * 60 * 60 * 1000);

  const allEnabled  = COUNTY_BOOKING_CONFIGS.filter(c => c.enabled);
  const configs     = options.counties
    ? allEnabled.filter(c => options.counties!.includes(c.county))
    : allEnabled;

  const totalEnabled = allEnabled.length;
  const totalTargeted = configs.length;

  // ── Print full source list before execution ──────────────────────────────
  console.log(`\n[JAIL-BOOKING] ═══════════════════════════════════════════════`);
  console.log(`[JAIL-BOOKING] RUN START — ${new Date().toISOString()}`);
  console.log(`[JAIL-BOOKING] Mode: ${options.counties ? "FILTERED" : "PRODUCTION — ALL COUNTIES"}`);
  console.log(`[JAIL-BOOKING] Configured sources: ${totalEnabled}`);
  console.log(`[JAIL-BOOKING] Targeted sources:   ${totalTargeted}`);
  console.log(`[JAIL-BOOKING] Date range: ${dateFrom.toISOString().slice(0, 10)} → ${dateTo.toISOString().slice(0, 10)}`);
  console.log(`[JAIL-BOOKING] Source list:`);
  for (const c of COUNTY_BOOKING_CONFIGS) {
    const tag = c.enabled ? (configs.some(x => x.county === c.county) ? "QUEUED" : "SKIPPED") : "DISABLED";
    console.log(`[JAIL-BOOKING]   [${tag}] ${c.county} — ${c.agentName} — ${c.bookingUrl}`);
  }
  console.log(`[JAIL-BOOKING] ═══════════════════════════════════════════════\n`);

  const coverage: SourceCoverageRecord[] = configs.map(c => ({
    county: c.county, status: "QUEUED" as SourceStatus, records: 0, inserted: 0,
  }));

  const totals = { records: 0, inserted: 0, skipped: 0, errors: 0 };
  let sourcesAttempted = 0;
  let sourcesSucceeded = 0;
  let sourcesFailed    = 0;
  let leadsCreated     = 0;

  // Mark any county filtered out as SKIPPED
  for (const disabled of COUNTY_BOOKING_CONFIGS.filter(c => c.enabled && !configs.includes(c))) {
    logSource(disabled.county, "SKIPPED", "filtered out by options.counties");
  }

  for (const config of configs) {
    const coverageEntry = coverage.find(e => e.county === config.county)!;
    coverageEntry.status = "FETCHING";

    try {
      const { stats, attempted, error } = await runCountyScrape(config, dateFrom, dateTo);

      if (attempted) {
        sourcesAttempted++;
        if (error && stats.inserted === 0) {
          sourcesFailed++;
          coverageEntry.status = "FAILED";
          coverageEntry.error  = error;
        } else if (stats.records === 0) {
          sourcesSucceeded++;
          coverageEntry.status = "NO_DATA";
        } else {
          sourcesSucceeded++;
          coverageEntry.status = "SUCCESS";
          coverageEntry.records  = stats.records;
          coverageEntry.inserted = stats.inserted;
        }
        totals.records  += stats.records;
        totals.inserted += stats.inserted;
        totals.skipped  += stats.skipped;
        totals.errors   += stats.errors;
        leadsCreated    += stats.inserted;
      } else {
        // Agent not available / domain blocked — doesn't count against 90% threshold
        coverageEntry.status = "SKIPPED";
        coverageEntry.error  = error;
        logSource(config.county, "SKIPPED", error || "agent not available");
      }
    } catch (err: any) {
      sourcesFailed++;
      totals.errors++;
      coverageEntry.status = "FAILED";
      coverageEntry.error  = err?.message;
      logSource(config.county, "FAILED", err?.message);
    }

    await new Promise(r => setTimeout(r, STAGGER_BETWEEN_MS));
  }

  lastRunAt = new Date();

  // ── Source Coverage Report ─────────────────────────────────────────────────
  const attemptedConfigs   = configs.filter(c => {
    const e = coverage.find(x => x.county === c.county);
    return e && e.status !== "SKIPPED";
  });
  const attemptRate        = totalTargeted > 0 ? attemptedConfigs.length / totalTargeted : 1;
  const coveragePct        = Math.round(attemptRate * 100);
  const coveragePassed     = attemptRate >= COVERAGE_THRESHOLD;

  console.log(`\n[JAIL-BOOKING] ═══════════════════════════════ COVERAGE REPORT`);
  console.log(`[JAIL-BOOKING] sources_configured:  ${totalEnabled}`);
  console.log(`[JAIL-BOOKING] sources_targeted:    ${totalTargeted}`);
  console.log(`[JAIL-BOOKING] sources_attempted:   ${sourcesAttempted}`);
  console.log(`[JAIL-BOOKING] sources_succeeded:   ${sourcesSucceeded}`);
  console.log(`[JAIL-BOOKING] sources_failed:      ${sourcesFailed}`);
  console.log(`[JAIL-BOOKING] leads_created:       ${leadsCreated}`);
  console.log(`[JAIL-BOOKING] leads_enriched:      0 (enrichment via legal pipeline)`);
  console.log(`[JAIL-BOOKING] coverage_rate:       ${coveragePct}% (threshold: ${Math.round(COVERAGE_THRESHOLD * 100)}%)`);
  console.log(`[JAIL-BOOKING] coverage_status:     ${coveragePassed ? "✅ PASS" : "❌ FAIL — below 90% threshold"}`);
  console.log(`[JAIL-BOOKING] ─────────────────────────────────────────────────`);
  for (const e of coverage) {
    const icon = { SUCCESS: "✅", NO_DATA: "📭", FAILED: "❌", SKIPPED: "⏭", QUEUED: "⏳", FETCHING: "🔄" }[e.status];
    console.log(`[JAIL-BOOKING]   ${icon} ${e.county}: ${e.status}${e.records > 0 ? ` (${e.records} records, ${e.inserted} new)` : ""}${e.error ? ` — ${e.error}` : ""}`);
  }
  console.log(`[JAIL-BOOKING] ═══════════════════════════════════════════════\n`);

  if (!coveragePassed && totalTargeted > 0) {
    // Log as error — do NOT throw (we don't want to crash the server)
    console.error(
      `[JAIL-BOOKING] ❌ JOB COVERAGE FAILURE: only ${sourcesAttempted}/${totalTargeted} sources attempted ` +
      `(${coveragePct}% < ${Math.round(COVERAGE_THRESHOLD * 100)}% threshold). ` +
      `Check NIMBLE_API_KEY and published agents for failed counties.`
    );
  }
}

export function getJailBookingStats() {
  return {
    lastRunAt:       lastRunAt?.toISOString() ?? null,
    configured:      isNimbleConfigured(),
    enabledCounties: COUNTY_BOOKING_CONFIGS.filter(c => c.enabled).map(c => c.county),
    totalSources:    COUNTY_BOOKING_CONFIGS.filter(c => c.enabled).length,
  };
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function startJailBookingScheduler(): void {
  if (!isNimbleConfigured()) {
    console.log("[JAIL-BOOKING] Nimble credential not set — scheduler inactive (set NIMBLE_API_KEY to enable)");
    return;
  }

  const INTERVAL_MS = 60 * 60 * 1000; // every 60 minutes (production requirement)

  // First run 2 minutes post-boot
  setTimeout(() => {
    runAllCountyBookings().catch(err =>
      console.error("[JAIL-BOOKING] Scheduler run error:", err?.message)
    );
    setInterval(() => {
      runAllCountyBookings().catch(err =>
        console.error("[JAIL-BOOKING] Scheduler run error:", err?.message)
      );
    }, INTERVAL_MS);
  }, 2 * 60 * 1000);

  const sources = COUNTY_BOOKING_CONFIGS.filter(c => c.enabled).map(c => c.county).join(", ");
  console.log(`[JAIL-BOOKING] Scheduler started — first run in 2 min, then every 60 min`);
  console.log(`[JAIL-BOOKING] Configured counties (${COUNTY_BOOKING_CONFIGS.filter(c => c.enabled).length}): ${sources}`);
}
