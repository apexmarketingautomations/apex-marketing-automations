/**
 * County Booking Scrapers
 *
 * One scraper per Florida county.  Each scraper implements the shared
 * `CountyScraper` interface and returns an array of `RawBookingRecord`.
 *
 * Extraction strategy per county:
 *
 *  LEE        – WordPress site with internal BookingSearch JS widget.
 *               Primary: Nimble browser-rendered extract of the search results
 *               page (submit date-range form, parse table rows).
 *               Fallback: Apify Playwright actor.
 *
 *  CHARLOTTE  – ccso.org/correctional_facility/local_arrest_database.php
 *               Revize CMS with CAPTCHA. Requires Apify Playwright actor for
 *               form submission. Nimble used for parsing detail pages.
 *
 *  HENDRY     – OCV/Sheriff App platform (hendrysheriff.org/inmateSearch)
 *               REST-style URLs: /inmateSearch/{vine_id}
 *               Paginated list page → detail pages.
 *               Nimble extract handles both cleanly (no CAPTCHA).
 *
 *  SARASOTA   – sarasotasheriff.org/arrest-reports/index.php
 *               Revize CMS. Nimble browser extract with date filter.
 *
 *  POLK       – polksheriff.org/detention/jail-inquiry
 *               Sitefinity CMS. JS-rendered booking-date tab search.
 *               Nimble browser extract (wait=4000).
 *
 *  COLLIER    – colliersheriff.org (correct inmate search URL TBD).
 *               ASP.NET. Apify Playwright actor required.
 *
 *  MANATEE    – manateesheriff.com (no public search UI found).
 *               VINE/Appriss external — Apify actor required.
 *
 *  HILLSBOROUGH – hillsboroughsheriff.org inmate search
 *               Large county — Apify actor + proxy rotation required.
 *
 *  PINELLAS   – pinellassheriff.gov/who-is-in-jail (iframe-embedded)
 *               Apify Playwright required to handle embedded search widget.
 *
 *  PASCO      – pascosheriff.com (no direct inmate search URL found)
 *               Uses VINE. Apify actor required.
 *
 *  GLADES     – gladessheriff.org  (small county)
 *               To be investigated. Likely VINE-based.
 */

import axios from "axios";
import { resolveApifyToken } from "./vendorConfig";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface RawBookingRecord {
  county:           string;
  source_url:       string;
  full_name:        string;
  first_name:       string;
  last_name:        string;
  booking_id:       string;
  booking_date:     string | null;
  arrest_date:      string | null;
  charges:          string[];        // raw charge strings
  bond_amount:      number | null;
  custody_status:   string | null;
  age:              number | null;
  dob:              string | null;
  city_state:       string | null;
  mugshot_url:      string | null;
  arresting_agency: string | null;
  scrape_timestamp: string;
  /** Blocker description if extraction failed */
  blocker?:         string;
}

export interface ScrapeResult {
  county:     string;
  records:    RawBookingRecord[];
  pagesRead:  number;
  errors:     string[];
  blocker?:   string;
  strategy:   "nimble" | "apify" | "api" | "stub";
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().split("T")[0];
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── Nimble extract helper ──────────────────────────────────────────────────────

const NIMBLE_API = "https://api.webit.live/api/v1/realtime/web";

/**
 * Returns "username:password" for Nimble Basic auth.
 * Checks NIMBLE_USERNAME + NIMBLE_PASSWORD first (Nimble dashboard credentials),
 * then falls back to NIMBLE_API_KEY / NIMBLE_TOKEN / NIMBLE_KEY.
 */
function resolveNimbleCredential(): string {
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

async function nimbleExtract(url: string, waitMs = 3000): Promise<string> {
  const credential = resolveNimbleCredential();
  if (!credential) throw new Error("Nimble not configured — set NIMBLE_USERNAME + NIMBLE_PASSWORD in Railway");

  const resp = await axios.post(
    NIMBLE_API,
    { url, render: true, wait: waitMs, output_format: "markdown" },
    {
      headers: {
        Authorization: `Basic ${Buffer.from(credential).toString("base64")}`,
        "Content-Type": "application/json",
      },
      timeout: 60_000,
    }
  );
  return resp.data?.html_content || resp.data?.content || "";
}

// ── Apify actor trigger ────────────────────────────────────────────────────────

async function triggerApifyActor(
  actorId: string,
  input: Record<string, unknown>,
): Promise<{ runId: string; status: string }> {
  const token = resolveApifyToken();
  if (!token) throw new Error("APIFY_API_KEY not configured");

  const resp = await axios.post(
    `https://api.apify.com/v2/acts/${actorId}/runs`,
    input,
    {
      headers: { Authorization: `Bearer ${token}` },
      params:  { token },
      timeout: 15_000,
    }
  );
  return { runId: resp.data?.data?.id, status: resp.data?.data?.status };
}

// ── LEE COUNTY ───────────────────────────────────────────────────────────────
// Strategy: Direct public REST API at sheriffleefl.org/public-api/bookings
//           Returns JSON — no browser rendering or button clicks needed.
// API date format: YYYY-M-D  (no zero-padding)
// Charges:  /public-api/bookings/{bookingNumber}/charges
//
// Discovered from the page JS: the "Recent Bookings" button called this API
// via jQuery.ajax — it was never accessible via HTML scraping.

function leeApiDate(iso: string): string {
  // "2026-05-01" → "2026-5-1"  (API requires no zero-padding)
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}-${m}-${d}`;
}

export async function scrapeLeeCounty(
  fromDate = daysAgo(3),
  toDate   = daysAgo(0),
): Promise<ScrapeResult> {
  const county   = "Lee";
  const BASE_URL = "https://www.sheriffleefl.org";
  const records: RawBookingRecord[] = [];
  const errors: string[] = [];
  let   pagesRead = 0;

  try {
    const apiUrl = `${BASE_URL}/public-api/bookings?startBooking=${leeApiDate(fromDate)}&toBooking=${leeApiDate(toDate)}`;
    const resp   = await axios.get<any[]>(apiUrl, {
      timeout: 30_000,
      headers: { Accept: "application/json" },
    });
    pagesRead++;

    const bookings: any[] = Array.isArray(resp.data) ? resp.data : [];
    console.log(`[ARREST-SCRAPER] Lee County API: ${bookings.length} bookings (${fromDate}→${toDate})`);

    for (const b of bookings) {
      // Fetch charges for this booking
      let chargeDescs: string[] = [];
      let bondAmount: number | null = null;
      let caseNumber: string | undefined;
      let arrestingAgency = "Lee County Sheriff";

      try {
        const cResp = await axios.get<any[]>(
          `${BASE_URL}/public-api/bookings/${b.bookingNumber}/charges`,
          { timeout: 15_000, headers: { Accept: "application/json" } },
        );
        const charges: any[] = Array.isArray(cResp.data) ? cResp.data : [];
        chargeDescs = charges.map((c: any) => c.offenseDescription).filter(Boolean);

        for (const c of charges) {
          if (c.bondAmount && c.bondAmount !== "Not Set") {
            const n = parseFloat(String(c.bondAmount).replace(/[^0-9.]/g, ""));
            if (!isNaN(n) && n > 0) { bondAmount = n; break; }
          }
        }
        if (charges[0]?.caseNumber)          caseNumber      = charges[0].caseNumber;
        if (charges[0]?.arrestingAgencyName) arrestingAgency = charges[0].arrestingAgencyName;
      // allow-silent-catch: charge fetch failures are non-fatal — missing charges don't block booking record creation
      } catch {
      }

      const surName  = (b.surName   || "").trim();
      const givenName = (b.givenName || "").trim();
      const middle   = (b.middleName || "").trim();
      const rawFull  = [surName, givenName, middle].filter(Boolean).join(" ");
      const nameParts = splitName(rawFull);

      records.push({
        county,
        source_url:       `${BASE_URL}/booking/?id=${b.bookingNumber}`,
        full_name:        nameParts.full || rawFull || "Unknown",
        first_name:       nameParts.first || givenName,
        last_name:        nameParts.last  || surName,
        booking_id:       String(b.bookingNumber),
        booking_date:     (b.bookingDate || "").split(" ")[0] || null,
        arrest_date:      (b.bookingDate || "").split(" ")[0] || null,
        charges:          chargeDescs.length ? chargeDescs : ["Unknown"],
        bond_amount:      bondAmount,
        custody_status:   b.inCustodyText || (b.inCustody ? "In Custody" : "Released"),
        age:              null,
        dob:              b.birthDate ? b.birthDate.split(" ")[0] : null,
        city_state:       b.address  || "Lee County, FL",
        mugshot_url:      null,  // base64 image — omit to keep payload small
        arresting_agency: arrestingAgency,
        scrape_timestamp: nowIso(),
      });

      await sleep(250); // brief pause between charge-lookup calls
    }

    return { county, records, pagesRead, errors, strategy: "api" };

  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error(`[ARREST-SCRAPER] Lee County API failed: ${msg}`);
    errors.push(msg);
    return { county, records, pagesRead, errors, strategy: "api" };
  }
}

// parseLeeBookingHtml removed — Lee County now uses the public REST API directly.
// See scrapeLeeCounty() above.

// ── HENDRY COUNTY ────────────────────────────────────────────────────────────
// Platform: OCV / The Sheriff App  (hendrysheriff.org)
// Strategy: Nimble extract the paginated /inmateSearch list, then
//           extract detail pages for each inmate ID.
// URL pattern: /inmateSearch  (list, paginated)
//              /inmateSearch/{vine_id} (detail)

const HENDRY_BASE = "https://www.hendrysheriff.org";
const HENDRY_LIST = `${HENDRY_BASE}/inmateSearch`;

export async function scrapeHendryCounty(
  fromDate = daysAgo(3),
): Promise<ScrapeResult> {
  const county  = "Hendry";
  const records: RawBookingRecord[] = [];
  const errors: string[] = [];
  let   pagesRead = 0;

  try {
    // Page 1 of the list
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 10) {   // safety cap: 10 pages
      const url = page === 1 ? HENDRY_LIST : `${HENDRY_LIST}?page=${page}`;
      const html = await nimbleExtract(url, 3000);
      pagesRead++;

      const ids = parseHendryListIds(html);
      if (ids.length === 0) { hasMore = false; break; }

      // Fetch detail pages in batches of 5
      for (let i = 0; i < ids.length; i += 5) {
        const batch = ids.slice(i, i + 5);
        const details = await Promise.allSettled(
          batch.map(id => scrapeHendryDetail(id))
        );
        for (const d of details) {
          if (d.status === "fulfilled" && d.value) {
            records.push(d.value);
          }
        }
        await sleep(1000);
      }

      // Check if there's a next page link
      hasMore = html.includes(`page=${page + 1}`) || /\d+…?\d+/.test(html);
      page++;
    }

    console.log(`[ARREST-SCRAPER] Hendry County: ${records.length} records from ${pagesRead} pages`);
    return { county, records, pagesRead, errors, strategy: "nimble" };

  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error(`[ARREST-SCRAPER] Hendry County failed: ${msg}`);
    errors.push(msg);
    return { county, records, pagesRead, errors, strategy: "nimble" };
  }
}

function parseHendryListIds(html: string): string[] {
  // OCV platform renders links like /inmateSearch/55304550
  const ids: string[] = [];
  const pattern = /\/inmateSearch\/(\d{6,12})/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

async function scrapeHendryDetail(vineId: string): Promise<RawBookingRecord | null> {
  try {
    const url  = `${HENDRY_BASE}/inmateSearch/${vineId}`;
    const html = await nimbleExtract(url, 2000);

    // OCV detail page structure:
    // # LAST, FIRST MIDDLE
    // Inmate ID: HCSO13MNI000000
    // Main Address: ...
    // Booked Date: MM/DD/YYYY
    // Custody Status: IN/OUT
    // Charges listed below

    const nameMatch    = html.match(/^#\s+([A-Z][A-Z ,'-]+)/m);
    const idMatch      = html.match(/Inmate ID[:\s]+([A-Z0-9]+)/i);
    const addrMatch    = html.match(/Main Address[:\s]+(.+)/i);
    const bookedMatch  = html.match(/Booked Date[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const statusMatch  = html.match(/Custody Status[:\s]+(\w+)/i);
    const dobMatch     = html.match(/DOB[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const ageMatch     = html.match(/Age[:\s]+(\d+)/i);

    const fullName = nameMatch ? nameMatch[1].trim() : "UNKNOWN";
    const nameParts = splitName(fullName);

    // Extract charges: lines after "Charges" section
    const chargesSection = html.split(/charges?/i)[1] || "";
    const charges = chargesSection
      .split("\n")
      .map(l => l.replace(/^[*\-•#\s]+/, "").trim())
      .filter(l => l.length > 3 && l.length < 200)
      .slice(0, 20);

    // Mugshot from VINE image service
    const mugshotMatch = html.match(/(https:\/\/image\.vineserv\.appriss\.com\/[^\s"')]+)/i);

    if (!idMatch && !nameMatch) return null;

    return {
      county:           "Hendry",
      source_url:       `${HENDRY_BASE}/inmateSearch/${vineId}`,
      full_name:        nameParts.full,
      first_name:       nameParts.first,
      last_name:        nameParts.last,
      booking_id:       idMatch ? idMatch[1].trim() : `VINE-${vineId}`,
      booking_date:     bookedMatch ? bookedMatch[1].trim() : null,
      arrest_date:      bookedMatch ? bookedMatch[1].trim() : null,
      charges,
      bond_amount:      null,
      custody_status:   statusMatch ? statusMatch[1].trim() : null,
      age:              ageMatch ? parseInt(ageMatch[1], 10) : null,
      dob:              dobMatch ? dobMatch[1].trim() : null,
      city_state:       addrMatch ? addrMatch[1].trim() : "Hendry County, FL",
      mugshot_url:      mugshotMatch ? mugshotMatch[1] : null,
      arresting_agency: "Hendry County Sheriff",
      scrape_timestamp: nowIso(),
    };
  } catch (err: any) {
    console.warn(`[ARREST-SCRAPER] Hendry detail ${vineId} failed: ${err.message}`);
    return null;
  }
}

// ── SARASOTA COUNTY ───────────────────────────────────────────────────────────
// Platform: Revize CMS   sarasotasheriff.org/arrest-reports/index.php
// Strategy: Nimble browser extract with date param (the page has a date filter)

export async function scrapeSarasotaCounty(
  fromDate = daysAgo(3),
  toDate   = daysAgo(0),
): Promise<ScrapeResult> {
  const county   = "Sarasota";
  const BASE_URL = "https://www.sarasotasheriff.org";
  const records: RawBookingRecord[] = [];
  const errors: string[] = [];
  let   pagesRead = 0;

  try {
    const url  = `${BASE_URL}/arrest-reports/index.php?date_from=${fromDate}&date_to=${toDate}`;
    const html = await nimbleExtract(url, 5000);
    pagesRead++;

    const parsed = parseSarasotaArrestHtml(html, county, BASE_URL);
    records.push(...parsed);

    if (records.length === 0) {
      // Retry 7-day
      const url7 = `${BASE_URL}/arrest-reports/index.php?date_from=${daysAgo(7)}&date_to=${toDate}`;
      const html7 = await nimbleExtract(url7, 5000);
      pagesRead++;
      records.push(...parseSarasotaArrestHtml(html7, county, BASE_URL));
    }

    console.log(`[ARREST-SCRAPER] Sarasota County: ${records.length} records`);
    return { county, records, pagesRead, errors, strategy: "nimble" };
  } catch (err: any) {
    const msg = err?.message || String(err);
    const blocker = classifyBlocker(msg);
    console.error(`[ARREST-SCRAPER] Sarasota County failed: ${msg}`);
    return {
      county, records: [], pagesRead, errors: [msg],
      blocker: blocker
        ? `Sarasota blocked — ${blocker}. Endpoint: ${BASE_URL}/arrest-reports/index.php`
        : undefined,
      strategy: "nimble",
    };
  }
}

function parseSarasotaArrestHtml(html: string, county: string, base: string): RawBookingRecord[] {
  const records: RawBookingRecord[] = [];
  // Sarasota renders a table: Name | Booking# | Date | Charges | Bond | Agency
  const rowPattern = /\|\s*([A-Z][A-Z ,'-]+)\s*\|\s*([0-9]+)\s*\|\s*(\d{1,2}\/\d{1,2}\/\d{4}[^|]*)\s*\|\s*([^|]+)\|\s*([\d$,.]*)\s*\|\s*([^|]+)/g;
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(html)) !== null) {
    const [, fullName, bookingId, bookingDate, chargesRaw, bondRaw, agency] = match;
    const nameParts = splitName(fullName.trim());
    records.push({
      county,
      source_url:       `${base}/arrest-reports/${bookingId}`,
      full_name:        nameParts.full,
      first_name:       nameParts.first,
      last_name:        nameParts.last,
      booking_id:       bookingId.trim(),
      booking_date:     bookingDate.trim(),
      arrest_date:      bookingDate.trim(),
      charges:          splitCharges(chargesRaw),
      bond_amount:      parseBond(bondRaw),
      custody_status:   null,
      age:              null,
      dob:              null,
      city_state:       "Sarasota County, FL",
      mugshot_url:      null,
      arresting_agency: agency.trim() || "Sarasota County Sheriff",
      scrape_timestamp: nowIso(),
    });
  }
  return records;
}

// ── POLK COUNTY ───────────────────────────────────────────────────────────────
// Platform: Sitefinity CMS   polksheriff.org/detention/jail-inquiry
// Strategy: Nimble browser extract — submit booking-date tab search.
//           The page renders a JS table: Booking# | Name | RS | DOB | Entry Date | Release Date | Location

export async function scrapePolkCounty(
  fromDate = daysAgo(3),
  toDate   = daysAgo(0),
): Promise<ScrapeResult> {
  const county   = "Polk";
  const BASE_URL = "https://www.polksheriff.org";
  const records: RawBookingRecord[] = [];
  const errors: string[] = [];
  let   pagesRead = 0;

  try {
    // The Sitefinity search form uses a booking date range tab.
    // Nimble browser extract with 4 second wait lets the JS table render.
    const url = `${BASE_URL}/detention/jail-inquiry#booking-date-fields`;
    const html = await nimbleExtract(url, 6000);
    pagesRead++;

    const parsed = parsePolkJailHtml(html, county, BASE_URL);
    records.push(...parsed);

    console.log(`[ARREST-SCRAPER] Polk County: ${records.length} records`);
    return { county, records, pagesRead, errors, strategy: "nimble" };
  } catch (err: any) {
    const msg = err?.message || String(err);
    const blocker = classifyBlocker(msg);
    console.error(`[ARREST-SCRAPER] Polk County failed: ${msg}`);
    return {
      county, records: [], pagesRead, errors: [msg],
      blocker: blocker
        ? `Polk blocked — ${blocker}. Endpoint: ${BASE_URL}/detention/jail-inquiry. Workaround: Apify Playwright with form submit on Booking Date tab.`
        : undefined,
      strategy: "nimble",
    };
  }
}

function parsePolkJailHtml(html: string, county: string, base: string): RawBookingRecord[] {
  const records: RawBookingRecord[] = [];
  // Sitefinity table: Booking # | Name | RS | DOB | Entry Date | Release Date | Location
  const rowPattern = /\|\s*([0-9]+)\s*\|\s*([A-Z][A-Z ,'-]+)\s*\|\s*\w*\s*\|\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*\|\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*\|/g;
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(html)) !== null) {
    const [, bookingId, fullName, dob, entryDate] = match;
    const nameParts = splitName(fullName.trim());
    records.push({
      county,
      source_url:       `${base}/detention/jail-inquiry`,
      full_name:        nameParts.full,
      first_name:       nameParts.first,
      last_name:        nameParts.last,
      booking_id:       bookingId.trim(),
      booking_date:     entryDate.trim(),
      arrest_date:      entryDate.trim(),
      charges:          [],   // Polk table doesn't show charges inline — needs detail page
      bond_amount:      null,
      custody_status:   null,
      age:              null,
      dob:              dob.trim(),
      city_state:       "Polk County, FL",
      mugshot_url:      null,
      arresting_agency: "Polk County Sheriff",
      scrape_timestamp: nowIso(),
    });
  }
  return records;
}

// ── CHARLOTTE COUNTY ─────────────────────────────────────────────────────────
// Platform: Revize CMS + CAPTCHA   ccso.org/correctional_facility/local_arrest_database.php
// Strategy: Apify Playwright actor required (CAPTCHA blocks direct extraction)
// Stub returns blocker description for now.

export async function scrapeCharlotteCounty(): Promise<ScrapeResult> {
  const county = "Charlotte";

  try {
    const token = resolveApifyToken();
    if (token) {
      // Trigger Apify actor if available
      const run = await triggerApifyActor(
        "apex-charlotte-county-booking",
        {
          startUrls: [{ url: "https://www.ccso.org/correctional_facility/local_arrest_database.php" }],
          maxConcurrency: 1,
          proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
        }
      );
      console.log(`[ARREST-SCRAPER] Charlotte County: Apify run started — ${run.runId}`);
      return {
        county, records: [], pagesRead: 0, errors: [],
        blocker: `Charlotte County: Apify actor triggered (runId=${run.runId}). Results will be delivered via webhook or poll.`,
        strategy: "apify",
      };
    }
  } catch (err: any) {
    console.warn(`[ARREST-SCRAPER] Charlotte County Apify trigger failed: ${err.message}`);
  }

  return {
    county,
    records:   [],
    pagesRead: 0,
    errors:    [],
    blocker:   "Charlotte County: Revize CMS with CAPTCHA. " +
               "Required: Apify Playwright actor apex-charlotte-county-booking with residential proxy. " +
               "Endpoint: https://www.ccso.org/correctional_facility/local_arrest_database.php. " +
               "CAPTCHA type: form_captcha (Revize server). " +
               "Workaround: Playwright stealth mode + 2captcha solver.",
    strategy: "apify",
  };
}

// ── COLLIER COUNTY ────────────────────────────────────────────────────────────
// Platform: ASP.NET   colliersheriff.org
// Strategy: Apify Playwright actor (correct inmate search URL unknown — see TODO)
// TODO: Verify correct path at colliersheriff.org for inmate search

export async function scrapeCollierCounty(): Promise<ScrapeResult> {
  return {
    county:    "Collier",
    records:   [],
    pagesRead: 0,
    errors:    [],
    blocker:   "Collier County: ASP.NET site — inmate search URL requires manual verification. " +
               "Known paths return 404. Required: Apify Playwright actor + correct URL discovery. " +
               "TODO: check https://www.colliersheriff.org/services/ for inmate-search redirect.",
    strategy: "apify",
  };
}

// ── MANATEE COUNTY ───────────────────────────────────────────────────────────
// Platform: Revize CMS / VINE external   manateesheriff.com
// No public inmate search UI found on manateesheriff.com
// VINE-based: https://vinelink.vineapps.com/search/FL (agency ID 1004 = Manatee)

export async function scrapeManateeCounty(): Promise<ScrapeResult> {
  try {
    // VINE link: vineapps.com has searchable inmate data
    const url  = "https://vinelink.vineapps.com/search/FL/facility?agencyCode=FL0410000";
    const html = await nimbleExtract(url, 5000);

    const records = parseVineHtml(html, "Manatee", "https://vinelink.vineapps.com");
    if (records.length > 0) {
      console.log(`[ARREST-SCRAPER] Manatee County (VINE): ${records.length} records`);
      return { county: "Manatee", records, pagesRead: 1, errors: [], strategy: "nimble" };
    }
  } catch (err: any) {
    console.warn(`[ARREST-SCRAPER] Manatee VINE attempt failed: ${err.message}`);
  }

  return {
    county:    "Manatee",
    records:   [],
    pagesRead: 0,
    errors:    [],
    blocker:   "Manatee County: No public inmate search on manateesheriff.com. " +
               "VINE external: https://vinelink.vineapps.com/search/FL. " +
               "Required: Apify Playwright actor to navigate VINE with FL agency filter.",
    strategy: "apify",
  };
}

// ── HILLSBOROUGH COUNTY ───────────────────────────────────────────────────────
// Platform: HCSO — hillsboroughsheriff.org or apps.teamhcso.com
// Large county (Tampa); Apify actor with proxy rotation required

export async function scrapeHillsboroughCounty(): Promise<ScrapeResult> {
  try {
    const url  = "https://www.hillsboroughsheriff.org/apps/jailquery/";
    const html = await nimbleExtract(url, 5000);
    if (html && html.length > 1000) {
      const records = parseGenericBookingTable(html, "Hillsborough", "https://www.hillsboroughsheriff.org");
      if (records.length > 0) {
        return { county: "Hillsborough", records, pagesRead: 1, errors: [], strategy: "nimble" };
      }
    }
  } catch (err: any) {
    console.warn(`[ARREST-SCRAPER] Hillsborough Nimble failed: ${err.message}`);
  }

  return {
    county:    "Hillsborough",
    records:   [],
    pagesRead: 0,
    errors:    [],
    blocker:   "Hillsborough County: Large county with high-volume booking system. " +
               "Requires Apify Playwright actor apex-hillsborough-booking with residential proxy + pagination. " +
               "Primary URL: https://www.hillsboroughsheriff.org/apps/jailquery/",
    strategy: "apify",
  };
}

// ── PINELLAS COUNTY ───────────────────────────────────────────────────────────
// Platform: pinellassheriff.gov/who-is-in-jail (iframe-embedded external widget)
// Strategy: Apify Playwright needed to handle iframe

export async function scrapePinellasCounty(): Promise<ScrapeResult> {
  return {
    county:    "Pinellas",
    records:   [],
    pagesRead: 0,
    errors:    [],
    blocker:   "Pinellas County: 'Who's In Jail' page embeds an external widget via iframe. " +
               "Nimble cannot access iframe content cross-origin. " +
               "Required: Apify Playwright actor to navigate inside iframe. " +
               "Endpoint: https://www.pinellassheriff.gov/who-is-in-jail",
    strategy: "apify",
  };
}

// ── PASCO COUNTY ──────────────────────────────────────────────────────────────
// Platform: pascosheriff.com — no direct inmate search URL found
// Likely uses VINE for notifications

export async function scrapePascoCounty(): Promise<ScrapeResult> {
  try {
    const url  = "https://vinelink.vineapps.com/search/FL/facility?agencyCode=FL1010000";
    const html = await nimbleExtract(url, 5000);
    const records = parseVineHtml(html, "Pasco", "https://vinelink.vineapps.com");
    if (records.length > 0) {
      return { county: "Pasco", records, pagesRead: 1, errors: [], strategy: "nimble" };
    }
  } catch (err: any) {
    console.warn(`[ARREST-SCRAPER] Pasco VINE attempt failed: ${err.message}`);
  }

  return {
    county:    "Pasco",
    records:   [],
    pagesRead: 0,
    errors:    [],
    blocker:   "Pasco County: No direct inmate search at pascosheriff.com found. " +
               "VINE external: https://vinelink.vineapps.com. " +
               "Required: Apify Playwright actor with VINE FL agency filter.",
    strategy: "apify",
  };
}

// ── GLADES COUNTY ─────────────────────────────────────────────────────────────

export async function scrapeGladesCounty(): Promise<ScrapeResult> {
  try {
    const url  = "https://www.gladessheriff.org/inmate-search";
    const html = await nimbleExtract(url, 4000);
    const records = parseGenericBookingTable(html, "Glades", "https://www.gladessheriff.org");
    if (records.length > 0) {
      return { county: "Glades", records, pagesRead: 1, errors: [], strategy: "nimble" };
    }
  } catch (err: any) {
    console.warn(`[ARREST-SCRAPER] Glades Nimble attempt failed: ${err.message}`);
  }

  return {
    county:    "Glades",
    records:   [],
    pagesRead: 0,
    errors:    [],
    blocker:   "Glades County: Small county — inmate search URL not confirmed. " +
               "Requires manual verification of search endpoint. " +
               "Primary site: https://www.gladessheriff.org",
    strategy: "stub",
  };
}

// ── Generic VINE parser ───────────────────────────────────────────────────────

function parseVineHtml(html: string, county: string, base: string): RawBookingRecord[] {
  const records: RawBookingRecord[] = [];
  // VINE renders inmate cards with name, custody status, facility
  const pattern = /##\s+([A-Z][A-Z ,'-]+)\s*\n.*?(?:Booked|Booking)[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/gs;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    const nameParts = splitName(m[1]);
    records.push({
      county,
      source_url:       base,
      full_name:        nameParts.full,
      first_name:       nameParts.first,
      last_name:        nameParts.last,
      booking_id:       `VINE-${county.toUpperCase()}-${Date.now()}`,
      booking_date:     m[2],
      arrest_date:      m[2],
      charges:          [],
      bond_amount:      null,
      custody_status:   null,
      age:              null,
      dob:              null,
      city_state:       `${county} County, FL`,
      mugshot_url:      null,
      arresting_agency: `${county} County Sheriff`,
      scrape_timestamp: nowIso(),
    });
  }
  return records;
}

// ── Generic booking table parser (fallback) ───────────────────────────────────

function parseGenericBookingTable(html: string, county: string, base: string): RawBookingRecord[] {
  const records: RawBookingRecord[] = [];
  // Match any markdown table row with a name and date pattern
  const rowPattern = /\|\s*([A-Z][A-Z ,'-]{2,40})\s*\|[^|]*\|\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/g;
  let m: RegExpExecArray | null;
  while ((m = rowPattern.exec(html)) !== null) {
    const nameParts = splitName(m[1]);
    if (nameParts.first.length < 2) continue;
    records.push({
      county,
      source_url:       base,
      full_name:        nameParts.full,
      first_name:       nameParts.first,
      last_name:        nameParts.last,
      booking_id:       `${county.toUpperCase()}-${Date.now()}`,
      booking_date:     m[2],
      arrest_date:      m[2],
      charges:          [],
      bond_amount:      null,
      custody_status:   null,
      age:              null,
      dob:              null,
      city_state:       `${county} County, FL`,
      mugshot_url:      null,
      arresting_agency: `${county} County Sheriff`,
      scrape_timestamp: nowIso(),
    });
  }
  return records;
}

// ── Utility functions ─────────────────────────────────────────────────────────

function splitName(full: string): { full: string; first: string; last: string } {
  full = full.replace(/[,]+$/, "").trim();
  // "LAST, FIRST MIDDLE" format
  if (full.includes(",")) {
    const [last, rest] = full.split(",", 2).map(s => s.trim());
    const first = rest.split(/\s+/)[0] || rest;
    return { full: `${first} ${last}`, first, last };
  }
  // "FIRST LAST" format
  const parts = full.split(/\s+/);
  if (parts.length >= 2) {
    return { full, first: parts[0], last: parts.slice(1).join(" ") };
  }
  return { full, first: full, last: "" };
}

function splitCharges(raw: string): string[] {
  return raw
    .split(/[/\n;]+/)
    .map(s => s.replace(/[*•\-\s]+$/, "").trim())
    .filter(s => s.length > 3 && s.length < 200);
}

function parseBond(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function classifyBlocker(msg: string): string | null {
  if (/captcha|recaptcha|hcaptcha/i.test(msg)) return "CAPTCHA detected";
  if (/403|forbidden/i.test(msg)) return "HTTP 403 — anti-bot block";
  if (/401|unauthorized/i.test(msg)) return "Login required";
  if (/nx_domain|ENOTFOUND|getaddrinfo/i.test(msg)) return "DNS resolution failure";
  if (/timeout|ETIMEDOUT/i.test(msg)) return "Request timeout — possible anti-bot throttle";
  if (/429|too many/i.test(msg)) return "Rate limited (429)";
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Master runner ─────────────────────────────────────────────────────────────

/** Run all configured county scrapers and return combined results */
export async function scrapeAllCounties(
  fromDate = daysAgo(3),
  toDate   = daysAgo(0),
): Promise<ScrapeResult[]> {
  console.log(`[ARREST-SCRAPER] Starting all-county scrape (${fromDate} → ${toDate})`);

  const results = await Promise.allSettled([
    scrapeLeeCounty(fromDate, toDate),
    scrapeHendryCounty(fromDate),
    scrapeSarasotaCounty(fromDate, toDate),
    scrapePolkCounty(fromDate, toDate),
    scrapeCharlotteCounty(),
    scrapeCollierCounty(),
    scrapeManateeCounty(),
    scrapeHillsboroughCounty(),
    scrapePinellasCounty(),
    scrapePascoCounty(),
    scrapeGladesCounty(),
  ]);

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const names = ["Lee","Hendry","Sarasota","Polk","Charlotte","Collier","Manatee","Hillsborough","Pinellas","Pasco","Glades"];
    return {
      county:    names[i] || "Unknown",
      records:   [],
      pagesRead: 0,
      errors:    [r.reason?.message || String(r.reason)],
      strategy:  "nimble" as const,
    };
  });
}
