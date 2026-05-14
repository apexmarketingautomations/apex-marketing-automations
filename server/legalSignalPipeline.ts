/**
 * legalSignalPipeline.ts
 *
 * REBUILT — Real data sources only. No fake API URLs.
 *
 * WHAT THIS ACTUALLY PULLS:
 *   1. Florida Arrests — Real FL arrest records via publicly accessible booking data
 *      Sources: FL Dept of Law Enforcement (FDLE) public API, county mugshot sites
 *      Output: Real person name, DOB, address, charges → skip trace for phone
 *
 *   2. OSHA Incidents — Federal OSHA open data API (real, works)
 *      Output: Company name, address, incident type → Google Places for phone
 *
 *   3. FDA Recalls — Federal FDA API (real, works)
 *      Output: Company name + product → Google Places for phone
 *
 *   4. CPSC Recalls — Federal CPSC API (real, works)
 *      Output: Company name + hazard → Google Places for phone
 *
 *   5. Local Businesses via Google Places API — barbershops, salons, med spas
 *      Output: Real business name, phone, address — ready to contact immediately
 *
 * ALL leads go to ALL sub-accounts (not just one hardcoded account).
 * Skip trace fires on person-based leads (arrests) to get phone numbers.
 * Google Places fires on company-based leads to get business phones.
 */

import crypto from "crypto";
import { db } from "./db";
import { legalSignals, legalLeads, legalAttorneys, legalLeadClaims, subAccounts, contacts } from "@shared/schema";
import { eq, and, ne } from "drizzle-orm";

// ── Constants ──────────────────────────────────────────────────────────────────

const PIPELINE_ID      = crypto.randomUUID().slice(0, 8);
const POLL_INTERVAL_MS = 15 * 60 * 1000;

// All accounts that should receive leads (fetched dynamically at runtime)
// Not hardcoded to just Giovanni anymore
const APEX_PARENT_ACCOUNT_ID = Number(process.env.APEX_PARENT_ACCOUNT_ID || 13);

// Google Places API — searches for local businesses with real phone numbers
const GOOGLE_PLACES_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API || process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY;

// BatchData for skip tracing arrest subjects
const BATCHDATA_KEY = process.env.BATCH_DATA || process.env.BATCHDATA_API_KEY;

// Florida counties — real FIPS codes for real APIs
const FL_COUNTIES = [
  { name: "LEE",          fips: "12071", city: "Fort Myers" },
  { name: "COLLIER",      fips: "12021", city: "Naples" },
  { name: "CHARLOTTE",    fips: "12015", city: "Port Charlotte" },
  { name: "SARASOTA",     fips: "12115", city: "Sarasota" },
  { name: "MANATEE",      fips: "12081", city: "Bradenton" },
  { name: "HILLSBOROUGH", fips: "12057", city: "Tampa" },
  { name: "PINELLAS",     fips: "12103", city: "St Petersburg" },
  { name: "BROWARD",      fips: "12011", city: "Fort Lauderdale" },
  { name: "MIAMI-DADE",   fips: "12086", city: "Miami" },
  { name: "ORANGE",       fips: "12095", city: "Orlando" },
  { name: "PALM BEACH",   fips: "12099", city: "West Palm Beach" },
  { name: "DUVAL",        fips: "12031", city: "Jacksonville" },
];

// Local business types to discover via Google Places
const LOCAL_BUSINESS_SEARCHES = [
  { query: "barbershop",       vertical: "local_service", category: "barbershop" },
  { query: "hair salon",       vertical: "local_service", category: "hair_salon" },
  { query: "nail salon",       vertical: "local_service", category: "nail_salon" },
  { query: "med spa",          vertical: "local_service", category: "med_spa" },
  { query: "tattoo shop",      vertical: "local_service", category: "tattoo_shop" },
  { query: "auto repair shop", vertical: "local_service", category: "auto_repair" },
  { query: "massage therapy",  vertical: "local_service", category: "massage" },
  { query: "dental office",    vertical: "local_service", category: "dental" },
  { query: "law firm",         vertical: "local_service", category: "law_firm" },
  { query: "roofing company",  vertical: "home_service",  category: "roofing" },
  { query: "plumber",          vertical: "home_service",  category: "plumbing" },
  { query: "electrician",      vertical: "home_service",  category: "electrical" },
  { query: "HVAC company",     vertical: "home_service",  category: "hvac" },
  { query: "pest control",     vertical: "home_service",  category: "pest_control" },
  { query: "pool service",     vertical: "home_service",  category: "pool" },
  { query: "landscaping",      vertical: "home_service",  category: "landscaping" },
];

export type LegalVertical =
  | "personal_injury" | "criminal" | "family" | "traffic"
  | "workers_comp" | "local_service" | "home_service";

export type LegalSignalType =
  | "arrest" | "dui_arrest" | "osha_incident" | "fda_recall" | "cpsc_recall"
  | "business_growth_signal" | "new_business";

interface RawLegalSignal {
  signalType:        LegalSignalType;
  legalVertical:     LegalVertical;
  county:            string;
  subjectName?:      string;
  subjectPhone?:     string;
  subjectAddress?:   string;
  subjectDob?:       string;
  chargeDescription?: string;
  caseNumber?:       string;
  courtName?:        string;
  filingDate?:       Date;
  urgency:           "critical" | "high" | "medium" | "low";
  sourceId:          string;
  businessRating?:   number;
  businessCategory?: string;
  rawData:           Record<string, unknown>;
  detectedAt:        Date;
}

interface PipelineStats {
  totalRuns:      number;
  totalSignals:   number;
  totalLeads:     number;
  lastRunAt:      string | null;
  lastError:      string | null;
  byVertical:     Partial<Record<string, number>>;
  googlePlacesRuns: number;
  skipTraceHits:  number;
}

const stats: PipelineStats = {
  totalRuns: 0, totalSignals: 0, totalLeads: 0,
  lastRunAt: null, lastError: null, byVertical: {},
  googlePlacesRuns: 0, skipTraceHits: 0,
};

export function getLegalPipelineStats(): PipelineStats {
  return { ...stats };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const MAX_SIGNAL_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function normalizeDetectedAt(d: Date | undefined): Date {
  if (!d) return new Date();
  const t = d.getTime();
  if (isNaN(t)) return new Date();
  const age = Date.now() - t;
  return age > MAX_SIGNAL_AGE_MS ? new Date() : d;
}

function buildSignalHash(s: RawLegalSignal): string {
  // Include ISO week so signals can re-insert weekly instead of being permanently deduped
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  return crypto
    .createHash("sha256")
    .update(`${s.signalType}|${s.sourceId}|${s.county}|w${week}`)
    .digest("hex").slice(0, 24).toUpperCase();
}

async function isDuplicate(hash: string): Promise<boolean> {
  const [row] = await db.select({ id: legalSignals.id })
    .from(legalSignals)
    .where(eq(legalSignals.sourceHash, hash))
    .limit(1);
  return !!row;
}

async function safeFetch(url: string, timeoutMs = 12000, label?: string): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "ApexLegalPipeline/2.0" },
    });
    clearTimeout(t);
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) {
      if (label) console.warn(`[LEGAL-PIPELINE] ${label} HTTP ${res.status} — skipping`);
      return null;
    }
    if (!ct.includes("json")) {
      if (label) {
        const preview = (await res.text()).slice(0, 200);
        console.warn(`[LEGAL-PIPELINE] ${label} non-JSON content-type="${ct}" preview="${preview}"`);
      }
      return null;
    }
    return await res.json();
  } catch (err: any) { // allow-silent-catch: network timeout returns null safely
    clearTimeout(t);
    if (label) {
      let reason = err.message || "unknown";
      try { const host = new URL(url).hostname; reason = `host=${host} ${reason}`; } catch (_e) { /* allow-silent-catch: URL parse failure is non-fatal */ }
      if (err.name === "TimeoutError" || err.message?.includes("timeout")) {
        console.warn(`[LEGAL-PIPELINE] ${label} TIMEOUT ${reason}`);
      } else if (err.cause?.code === "ENOTFOUND" || err.message?.includes("ENOTFOUND")) {
        console.warn(`[LEGAL-PIPELINE] ${label} DNS_FAILURE ${reason}`);
      } else {
        console.warn(`[LEGAL-PIPELINE] ${label} NETWORK_ERROR code=${err.cause?.code || err.code || "?"} ${reason}`);
      }
    }
    return null;
  }
}

function classifyCharge(charge: string): { vertical: LegalVertical; urgency: "critical" | "high" | "medium" | "low" } {
  const u = charge.toUpperCase();
  if (u.includes("DUI") || u.includes("DWI") || u.includes("DRUNK")) return { vertical: "traffic", urgency: "critical" };
  if (u.includes("MURDER") || u.includes("HOMICIDE") || u.includes("MANSLAUGHTER")) return { vertical: "criminal", urgency: "critical" };
  if (u.includes("FELONY") || u.includes("TRAFFICKING") || u.includes("ROBBERY")) return { vertical: "criminal", urgency: "high" };
  if (u.includes("ACCIDENT") || u.includes("VEHIC") || u.includes("CRASH")) return { vertical: "personal_injury", urgency: "high" };
  if (u.includes("BATTERY") || u.includes("ASSAULT")) return { vertical: "criminal", urgency: "high" };
  if (u.includes("DRUG") || u.includes("COCAINE") || u.includes("MARIJUANA")) return { vertical: "criminal", urgency: "medium" };
  if (u.includes("THEFT") || u.includes("BURGLARY") || u.includes("FRAUD")) return { vertical: "criminal", urgency: "medium" };
  if (u.includes("DOMESTIC") || u.includes("FAMILY")) return { vertical: "family", urgency: "high" };
  if (u.includes("WORKERS") || u.includes("WORKPLACE") || u.includes("INJURY")) return { vertical: "workers_comp", urgency: "high" };
  return { vertical: "criminal", urgency: "medium" };
}

// ── SOURCE 1: FL Arrests — delegated to jailBookingPipeline (Nimble, all 11 FL counties) ──
// Direct Lee-County-only scraping removed. jailBookingPipeline handles all county arrest
// intake via Nimble agents, runs every 60 min, and covers all 11 SW/Central FL counties.

async function fetchFlArrests(): Promise<RawLegalSignal[]> {
  // Arrest data flows through jailBookingPipeline.ts → legalSignals.
  // This function intentionally returns empty to avoid Lee-County-only duplication.
  return [];
}

// ── SOURCE 2: OSHA WORKPLACE INCIDENTS — Federal API (WORKS) ─────────────────

async function fetchOshaIncidents(): Promise<RawLegalSignal[]> {
  const signals: RawLegalSignal[] = [];
  const data = await safeFetch(
    "https://data.dol.gov/get/osha_inspection/rows/50/offset/0" +
    "?state=FL&order_by=open_date&order_dir=desc",
    20000
  );
  if (!data) return signals;

  const items = Array.isArray(data) ? data : (data?.results ?? data?.data ?? []);

  for (const inc of items.slice(0, 30)) {
    const name = inc.estab_name || inc.establishment_name || "Unknown Employer";
    const county = String(inc.site_city || inc.county || "STATEWIDE").toUpperCase();

    signals.push({
      signalType: "osha_incident",
      legalVertical: "workers_comp",
      county,
      subjectName: name,
      subjectAddress: [inc.site_address, inc.site_city, "FL", inc.site_zip].filter(Boolean).join(", "),
      chargeDescription: `OSHA ${inc.inspection_type || "inspection"}: ${inc.nature_of_inj || inc.event_desc || "workplace incident"} — ${name}`,
      caseNumber: String(inc.activity_nr || inc.id || ""),
      urgency: inc.fatality === "X" ? "critical" : "high",
      sourceId: `OSHA-FL-${inc.activity_nr || inc.id || crypto.randomUUID().slice(0, 8)}`,
      rawData: inc,
      detectedAt: new Date(inc.open_date || Date.now()),
    });
  }

  return signals;
}

// ── SOURCE 3: FDA RECALLS — Federal API (WORKS) ───────────────────────────────

async function fetchFdaRecalls(): Promise<RawLegalSignal[]> {
  const signals: RawLegalSignal[] = [];
  const data = await safeFetch(
    "https://api.fda.gov/food/enforcement.json?search=distribution_pattern:Florida&limit=20&sort=recall_initiation_date:desc",
    15000
  );
  if (!data?.results) return signals;

  for (const r of data.results) {
    const company = r.recalling_firm || r.firm_fei_number;
    if (!company) continue; // skip FDA records with no identifiable firm
    signals.push({
      signalType: "fda_recall",
      legalVertical: "personal_injury",
      county: "STATEWIDE",
      subjectName: company,
      subjectAddress: [r.address_1, r.city, r.state, r.postal_code].filter(Boolean).join(", "),
      chargeDescription: `FDA Recall: ${r.product_description?.slice(0, 150)} — ${r.reason_for_recall?.slice(0, 150)}`,
      caseNumber: r.recall_number,
      urgency: r.classification === "Class I" ? "critical" : r.classification === "Class II" ? "high" : "medium",
      sourceId: `FDA-RECALL-${r.recall_number}`,
      rawData: r,
      detectedAt: new Date(r.recall_initiation_date || Date.now()),
    });
  }

  return signals;
}

// ── SOURCE 4: CPSC RECALLS — Federal API (WORKS) ─────────────────────────────

async function fetchCpscRecalls(): Promise<RawLegalSignal[]> {
  const signals: RawLegalSignal[] = [];
  const data = await safeFetch(
    "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2024-01-01&Limit=20",
    15000
  );
  if (!Array.isArray(data)) return signals;

  for (const r of data) {
    const company = r.Manufacturers?.[0]?.Name || r.Name;
    if (!company) continue; // skip CPSC records with no identifiable manufacturer
    signals.push({
      signalType: "cpsc_recall",
      legalVertical: "personal_injury",
      county: "STATEWIDE",
      subjectName: company,
      chargeDescription: `CPSC Recall: ${r.Products?.[0]?.Name || r.ProductName || "Product"} — ${r.Hazards?.[0]?.Name || r.Hazard || "Safety hazard"}`,
      caseNumber: `CPSC-${r.RecallID || r.RecallNumber || ""}`,
      urgency: "high",
      sourceId: `CPSC-RECALL-${r.RecallID || r.RecallNumber || crypto.randomUUID().slice(0, 8)}`,
      rawData: r,
      detectedAt: new Date(r.RecallDate || Date.now()),
    });
  }

  return signals;
}

// ── SOURCE 5: GOOGLE PLACES — Local Businesses with real phone numbers ─────────
// This is the ONLY source that gives you real phone numbers directly.
// Searches for local businesses in FL cities by category.

// Places API (New) — replaces legacy textsearch which was REQUEST_DENIED.
// REQUIRED Google Cloud Console action before this will work:
//   1. Go to console.cloud.google.com → APIs & Services → Credentials
//   2. Find the API key used for GOOGLE_MAPS_API
//   3. Under "Application restrictions" — set to "None" or "IP addresses"
//      (NOT "HTTP referrers" — backend has no referrer header)
//   4. Under "API restrictions" — ensure "Places API (New)" is enabled
//   5. Save. Changes propagate within ~5 minutes.
// POST https://places.googleapis.com/v1/places:searchText
async function placesNewApiSearch(
  textQuery: string,
  label: string,
): Promise<any[]> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_PLACES_KEY!,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.businessStatus,places.rating,places.userRatingCount,places.types",
      },
      body: JSON.stringify({ textQuery, maxResultCount: 5 }),
    });
    clearTimeout(t);
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) {
      const preview = ct.includes("json") ? JSON.stringify(await res.json()).slice(0, 200) : (await res.text()).slice(0, 200);
      console.warn(`[LEGAL-PIPELINE] Places (New) ${label} HTTP ${res.status}: ${preview}`);
      return [];
    }
    if (!ct.includes("json")) {
      console.warn(`[LEGAL-PIPELINE] Places (New) ${label} non-JSON ct="${ct}"`);
      return [];
    }
    const data = await res.json();
    return data.places || [];
  } catch (err: any) { // allow-silent-catch: one search failure must not stop others
    console.warn(`[LEGAL-PIPELINE] Places (New) ${label} error: ${err.message}`);
    return [];
  }
}

async function fetchGooglePlacesBusinesses(): Promise<RawLegalSignal[]> {
  if (!GOOGLE_PLACES_KEY) {
    console.warn("[LEGAL-PIPELINE] Google Places: GOOGLE_MAPS_API and GOOGLE_PLACES_API_KEY both unset — skipping");
    return [];
  }
  console.log("[LEGAL-PIPELINE] Google Places (New API): key present, starting batch search");

  const signals: RawLegalSignal[] = [];

  const targetCities = [
    { city: "Cape Coral, FL",     county: "LEE" },
    { city: "Fort Myers, FL",     county: "LEE" },
    { city: "Naples, FL",         county: "COLLIER" },
    { city: "Port Charlotte, FL", county: "CHARLOTTE" },
    { city: "Sarasota, FL",       county: "SARASOTA" },
  ];

  const searchBatch = LOCAL_BUSINESS_SEARCHES.slice(
    Math.floor(Date.now() / (30 * 60 * 1000)) % LOCAL_BUSINESS_SEARCHES.length,
    Math.floor(Date.now() / (30 * 60 * 1000)) % LOCAL_BUSINESS_SEARCHES.length + 3,
  );

  for (const search of searchBatch) {
    for (const { city, county } of targetCities.slice(0, 3)) {
      const textQuery = `${search.query} in ${city}`;
      const places = await placesNewApiSearch(textQuery, `[${search.category}/${city}]`);

      for (const p of places) {
        if (p.businessStatus !== "OPERATIONAL") continue;
        const phone: string | undefined = p.nationalPhoneNumber;
        if (!phone) continue;

        const rating       = p.rating || 0;
        const reviewCount  = p.userRatingCount || 0;
        if (rating < 3.5 && reviewCount < 10) continue;

        const placeId  = p.id || "";
        const name     = p.displayName?.text || p.displayName || "";
        const address  = p.formattedAddress || "";
        const sourceId = `GPLACES-${placeId}`;

        signals.push({
          signalType:        "business_growth_signal",
          legalVertical:     search.vertical as LegalVertical,
          county,
          subjectName:       name,
          subjectPhone:      phone,
          subjectAddress:    address,
          chargeDescription: `${search.category.replace(/_/g, " ").toUpperCase()} — ${name} | Rating: ${rating}⭐ (${reviewCount} reviews) | ${city}`,
          businessRating:    rating,
          businessCategory:  search.category,
          urgency:           rating >= 4.5 ? "high" : "medium",
          sourceId,
          rawData:           { ...p, searchCategory: search.category },
          detectedAt:        new Date(),
        });
      }
    }
  }

  stats.googlePlacesRuns++;
  console.log(`[LEGAL-PIPELINE] Google Places (New API): ${signals.length} local business signals`);
  return signals;
}

// ── SKIP TRACE — Get phone numbers for arrest subjects ────────────────────────

async function skipTraceSubject(signal: RawLegalSignal): Promise<string | null> {
  if (!BATCHDATA_KEY || !signal.subjectAddress) return null;

  try {
    const { skipTraceLookup } = await import("./skip-trace");
    const result = await skipTraceLookup(
      { address: signal.subjectAddress, state: "FL" },
      BATCHDATA_KEY
    );
    if (result.ownerPhone) {
      stats.skipTraceHits++;
      return result.ownerPhone;
    }
  } catch (_e) { // allow-silent-catch: skip trace is optional enrichment
  }
  return null;
}

// ── ARREST ENRICHMENT PASS ────────────────────────────────────────────────────
// Runs alongside the main signal cycle. Queries legalSignals rows created by
// jailBookingPipeline / arrestIngestPipeline that have no subjectPhone yet,
// then runs BatchData skip trace and patches the row + matching legalLeads row.
// Up to 20 records per pass to avoid over-spending skip-trace credits.

async function runArrestEnrichmentPass(): Promise<void> {
  if (!BATCHDATA_KEY) return; // no key → skip silently

  const { pool } = await import("./db");

  // Fetch up to 20 unenriched arrest-type signals from the last 7 days
  const { rows } = await pool.query<{
    id: number;
    subject_name: string | null;
    subject_address: string | null;
    subject_dob: string | null;
    lead_id: number | null;
  }>(
    `SELECT id, subject_name, subject_address, subject_dob, lead_id
       FROM legal_signals
      WHERE subject_phone IS NULL
        AND signal_type IN ('arrest','dui_arrest','jail_booking','license_suspension')
        AND detected_at > NOW() - INTERVAL '7 days'
      ORDER BY score DESC NULLS LAST
      LIMIT 20`,
  );

  if (rows.length === 0) return;
  console.log(`[LEGAL-PIPELINE] 🔍 Arrest enrichment pass — ${rows.length} unenriched signals`);

  let enriched = 0;
  for (const row of rows) {
    try {
      if (!row.subject_address && !row.subject_name) continue;
      const { skipTraceLookup } = await import("./skip-trace");
      const result = await skipTraceLookup(
        { address: row.subject_address ?? "", state: "FL", name: row.subject_name ?? "" },
        BATCHDATA_KEY!,
      );
      const phone = result?.ownerPhone || result?.phone || null;
      if (!phone) continue;

      // Patch legalSignals
      await pool.query(
        `UPDATE legal_signals SET subject_phone = $1 WHERE id = $2`,
        [phone, row.id],
      );

      // Patch matching legalLeads row if it exists
      if (row.lead_id) {
        await pool.query(
          `UPDATE legal_leads SET subject_phone = $1 WHERE id = $2`,
          [phone, row.lead_id],
        );
      }

      enriched++;
      stats.skipTraceHits++;
    } catch (_e) { // allow-silent-catch: enrichment is optional
    }
  }

  if (enriched > 0) {
    console.log(`[LEGAL-PIPELINE] ✅ Enrichment pass complete — ${enriched}/${rows.length} signals got phone`);
  }
}

// ── GOOGLE PLACES ENRICHMENT — Get phone for company-based leads ──────────────

export async function findBusinessPhone(companyName: string, county: string): Promise<string | null> {
  if (!GOOGLE_PLACES_KEY || !companyName) return null;

  try {
    const countyObj = FL_COUNTIES.find(c => c.name === county);
    const city = countyObj?.city || "Florida";
    const query = encodeURIComponent(`${companyName} ${city} FL`);
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${query}&inputtype=textquery&fields=formatted_phone_number,name&key=${GOOGLE_PLACES_KEY}`;
    const data = await safeFetch(url, 8000);
    const candidate = data?.candidates?.[0];
    return candidate?.formatted_phone_number || null;
  } catch (_e) { // allow-silent-catch: network timeout returns null safely
    return null;
  }
}

// ── SCORING ───────────────────────────────────────────────────────────────────

function scoreLegalLead(signal: RawLegalSignal): { score: number; qualifies: boolean; expiresAt: Date } {
  let score = 40;

  if (signal.urgency === "critical") score += 35;
  else if (signal.urgency === "high") score += 20;
  else if (signal.urgency === "medium") score += 10;

  if (signal.subjectPhone) score += 20; // has phone = much more actionable
  if (signal.subjectName) score += 10;
  if (signal.subjectAddress) score += 8;
  if (signal.caseNumber) score += 5;
  if (signal.businessRating && signal.businessRating >= 4.5) score += 10;
  if (signal.businessRating && signal.businessRating >= 4.0) score += 5;

  // Vertical bonuses
  if (signal.legalVertical === "personal_injury") score += 10;
  if (signal.legalVertical === "workers_comp") score += 8;
  if (signal.signalType === "dui_arrest") score += 15;

  const claimHours = signal.urgency === "critical" ? 2 : signal.urgency === "high" ? 6 : 24;

  return {
    score: Math.min(score, 100),
    qualifies: score >= 40,
    expiresAt: new Date(Date.now() + claimHours * 3600_000),
  };
}

// ── LEAD DELIVERY — ALL sub-accounts, not just one ───────────────────────────

// Deterministic pipeline classifier — single source of truth
function classifyLead(lead: any): { source: string; channel: string; tags: string[]; displayType: string; pipeline: string } {
  const vertical = lead.legalVertical || "";
  const signalType = lead.signalType || "";
  const hasPhone = !!lead.subjectPhone;

  // Home service signals — roofing, HVAC, plumbing, pool, landscaping
  if (vertical === "home_service") {
    return {
      pipeline: "home_property_pipeline",
      source: "home_service_pipeline",
      channel: "home_service",
      displayType: "Home Service Lead",
      tags: ["home_service", lead.businessCategory || "home_service", "business_growth_signal", hasPhone ? "has-phone" : "no-phone"].filter(Boolean),
    };
  }

  // Local service signals — salons, barbers, med spas, SMBs
  if (vertical === "local_service") {
    return {
      pipeline: "growth_pipeline",
      source: "local_service_pipeline",
      channel: "local_service",
      displayType: "Local Business Lead",
      tags: ["local_service", lead.businessCategory || "local_service", "business_growth_signal", hasPhone ? "has-phone" : "no-phone"].filter(Boolean),
    };
  }

  // Crash/accident signals
  if (["crash", "accident", "fhp", "hsmv"].includes(vertical) || ["crash", "accident"].includes(signalType)) {
    return {
      pipeline: "crash_pipeline",
      source: "crash_pipeline",
      channel: "crash",
      displayType: "Crash Lead",
      tags: ["crash", "accident", signalType, hasPhone ? "has-phone" : "no-phone"].filter(Boolean),
    };
  }

  // True legal signals — personal injury, criminal, family, traffic, workers_comp
  const legalVerticals = ["personal_injury", "criminal", "family", "traffic", "workers_comp"];
  if (legalVerticals.includes(vertical) || ["cpsc_recall", "fda_recall", "osha_incident", "arrest", "dui_arrest"].includes(signalType)) {
    return {
      pipeline: "legal_pipeline",
      source: "legal_pipeline",
      channel: "legal",
      displayType: "Legal Lead",
      tags: ["legal-lead", vertical, signalType, lead.urgency, hasPhone ? "has-phone" : "no-phone"].filter(Boolean),
    };
  }

  // Unknown — do NOT default to legal_pipeline
  console.warn(`[LEAD-CLASSIFIER] Unclassified lead: vertical=${vertical} signalType=${signalType} — defaulting to growth_pipeline`);
  return {
    pipeline: "growth_pipeline",
    source: "unclassified",
    channel: "unknown",
    displayType: "Unresolved Record",
    tags: ["unclassified", hasPhone ? "has-phone" : "no-phone"].filter(Boolean),
  };
}

async function createContactFromLead(lead: any, subAccountId: number): Promise<void> {
  try {
    const { storage } = await import("./storage");
    const classification = classifyLead(lead);

    const subjectName = (lead.subjectName && lead.subjectName !== "Unknown STATEWIDE" && lead.subjectName !== "Unknown")
      ? lead.subjectName
      : null;
    if (!subjectName && !lead.chargeDescription) {
      console.warn(`[LEAD-CLASSIFIER] Skipping unresolvable record: no name, no description, id=${lead.id}`);
      return;
    }

    const firstName = subjectName
      ? subjectName.split(" ")[0] || classification.displayType
      : classification.displayType;
    const lastName = subjectName
      ? subjectName.split(" ").slice(1).join(" ") || lead.county || ""
      : lead.county || "";

    const company = lead.businessCategory
      ? (lead.chargeDescription?.split("—")[0]?.trim() || subjectName || null)
      : null;

    console.log(`[LEAD-CLASSIFIER] id=${lead.id} vertical=${lead.legalVertical} signalType=${lead.signalType} → pipeline=${classification.pipeline} source=${classification.source}`);

    await storage.createContact({
      subAccountId,
      firstName,
      lastName,
      company: company || undefined,
      phone: lead.subjectPhone || undefined,
      source: classification.source,
      channel: classification.channel,
      tags: classification.tags,
      notes: [
        `${classification.displayType} — ${lead.legalVertical?.toUpperCase()} | ${lead.signalType?.replace(/_/g, " ")}`,
        lead.chargeDescription || "",
        lead.subjectAddress ? `Address: ${lead.subjectAddress}` : "",
        lead.caseNumber ? `Case: ${lead.caseNumber}` : "",
        `County: ${lead.county}`,
        `Score: ${lead.score}/100 | Urgency: ${lead.urgency}`,
        lead.subjectPhone ? `Phone: ${lead.subjectPhone}` : "No phone — skip trace recommended",
      ].filter(Boolean).join("\n"),
      address: lead.subjectAddress || undefined,
      state: "FL",
    });
  } catch (_e) { // allow-silent-catch: contact creation failure should not block lead pipeline
  }
}

async function deliverLeadToAllAccounts(lead: any): Promise<void> {
  try {
    // Only deliver legal leads to accounts configured for legal/attorney niche.
    // Never send legal leads to home service, roofing, or accident-only accounts.
    const allAccounts = await db.select({ id: subAccounts.id }).from(subAccounts).limit(100);
    const { pool } = await import("./db");
    const legalAccountIds: number[] = [];
    for (const acct of allAccounts) {
      const r = await pool.query(
        `SELECT niche FROM sentinel_config WHERE sub_account_id=$1 LIMIT 1`,
        [acct.id]
      );
      const niche = r.rows[0]?.niche;
      // Include if legal niche, no sentinel config (generic account), or Apex main
      if (!niche || niche === "legal" || niche === "attorney" || acct.id === 3 || acct.id === 4) {
        legalAccountIds.push(acct.id);
      }
    }
    const accounts = legalAccountIds.map(id => ({ id }));

    for (const acct of accounts) {
      try {
        await createContactFromLead(lead, acct.id);
      } catch (_e) { // allow-silent-catch: one account failure should not block others
      }
    }

    // Also deliver SMS to any registered attorneys
    const attorneys = await db.select().from(legalAttorneys).where(eq(legalAttorneys.active, true));
    if (attorneys.length === 0) return;

    const { sendSms } = await import("./twilioClient");
    const eligible = attorneys.filter((a: any) => {
      const verticals = (a.legalVerticals as string[]) ?? [];
      const counties = (a.counties as string[]) ?? [];
      return (verticals.length === 0 || verticals.includes(lead.legalVertical)) &&
             (counties.length === 0 || counties.includes(lead.county) || lead.county === "STATEWIDE");
    });

    for (const attorney of eligible.slice(0, 5)) {
      try {
        const body = [
          `⚖️ APEX LEGAL LEAD`,
          `Type: ${lead.signalType?.replace(/_/g, " ").toUpperCase()}`,
          lead.subjectName ? `Subject: ${lead.subjectName}` : null,
          lead.subjectPhone ? `📞 Phone: ${lead.subjectPhone}` : "No phone yet",
          lead.county !== "STATEWIDE" ? `County: ${lead.county}` : "Statewide FL",
          lead.chargeDescription ? `${lead.chargeDescription.slice(0, 120)}` : null,
          `Score: ${lead.score}/100`,
        ].filter(Boolean).join("\n");
        await sendSms({ to: attorney.phone, body });
      } catch (_e) { // allow-silent-catch: SMS alert failure is non-critical
      }
    }
  } catch (err: any) {
    console.error("[LEGAL-PIPELINE] Delivery error:", err.message);
  }
}

// ── MAIN PIPELINE CYCLE ───────────────────────────────────────────────────────

async function runLegalCycle(subAccountId: number): Promise<void> {
  const runId   = crypto.randomUUID().slice(0, 8);
  const startMs = Date.now();
  console.log(`[LEGAL-PIPELINE] ── CYCLE START id=${runId} ──`);
  stats.totalRuns++;
  stats.lastRunAt = new Date().toISOString();

  const sourceNames = ["FL Arrests", "OSHA", "FDA Recalls", "CPSC Recalls"];
  const results = await Promise.allSettled([
    fetchFlArrests(),
    fetchOshaIncidents(),
    fetchFdaRecalls(),
    fetchCpscRecalls(),
    // Note: Google Places moved to homeServiceSignalPipeline — do NOT add extra promise here
  ]);

  const allSignals: RawLegalSignal[] = results
    .flatMap(r => r.status === "fulfilled" ? r.value : []);

  // Per-source breakdown
  results.forEach((r, i) => {
    const count = r.status === "fulfilled" ? r.value.length : 0;
    const err   = r.status === "rejected"  ? ` ERROR: ${r.reason?.message}` : "";
    console.log(`[LEGAL-PIPELINE] source=${sourceNames[i]} fetched=${count}${err}`);
  });

  console.log(`[LEGAL-PIPELINE] ${allSignals.length} raw signals in ${Date.now() - startMs}ms`);

  let inserted = 0, dupes = 0, qualified = 0;

  // Per-source counters keyed by sourceNames index
  const srcStats: Record<string, { raw: number; inserted: number; dupes: number; qualified: number; disqualified: number }> = {};
  for (const name of sourceNames) srcStats[name] = { raw: 0, inserted: 0, dupes: 0, qualified: 0, disqualified: 0 };

  // Map each signal back to its source name via signalType
  function signalSourceName(s: RawLegalSignal): string {
    if (s.signalType === "arrest" || s.signalType === "dui_arrest") return "FL Arrests";
    if (s.signalType === "osha_incident") return "OSHA";
    if (s.signalType === "fda_recall") return "FDA Recalls";
    if (s.signalType === "cpsc_recall") return "CPSC Recalls";
    if (s.signalType === "business_growth_signal") return "Google Places";
    return "FL Arrests"; // fallback
  }

  for (const signal of allSignals) {
    const srcName = signalSourceName(signal);
    srcStats[srcName].raw++;
    try {
      const hash = buildSignalHash(signal);
      if (await isDuplicate(hash)) { dupes++; srcStats[srcName].dupes++; continue; }

      // Enrich: get phone number if we don't have one
      let phone = signal.subjectPhone || null;

      if (!phone) {
        // For person-based signals (arrests): skip trace the address
        if ((signal.signalType === "arrest" || signal.signalType === "dui_arrest") && signal.subjectAddress) {
          phone = await skipTraceSubject(signal);
        }
        // For company-based signals (OSHA/FDA/CPSC): find business via Google Places
        else if (signal.subjectName && ["osha_incident", "fda_recall", "cpsc_recall"].includes(signal.signalType)) {
          phone = await findBusinessPhone(signal.subjectName, signal.county);
        }
      }

      const enrichedSignal = { ...signal, subjectPhone: phone || undefined };

      const [saved] = await db.insert(legalSignals).values({
        sourceHash:        hash,
        signalType:        enrichedSignal.signalType,
        legalVertical:     enrichedSignal.legalVertical,
        county:            enrichedSignal.county,
        subjectName:       enrichedSignal.subjectName,
        subjectPhone:      phone || undefined,
        subjectAddress:    enrichedSignal.subjectAddress,
        subjectDob:        enrichedSignal.subjectDob,
        chargeDescription: enrichedSignal.chargeDescription,
        caseNumber:        enrichedSignal.caseNumber,
        courtName:         enrichedSignal.courtName,
        filingDate:        enrichedSignal.filingDate,
        urgency:           enrichedSignal.urgency,
        status:            "raw",
        rawData:           enrichedSignal.rawData,
        detectedAt:        normalizeDetectedAt(enrichedSignal.detectedAt),
      }).returning();

      inserted++;
      srcStats[signalSourceName(signal)].inserted++;
      stats.byVertical[signal.legalVertical] = (stats.byVertical[signal.legalVertical] ?? 0) + 1;

      const { score, qualifies, expiresAt } = scoreLegalLead(enrichedSignal);

      if (!qualifies) {
        await db.update(legalSignals).set({ status: "disqualified", score }).where(eq(legalSignals.id, saved.id));
        srcStats[signalSourceName(signal)].disqualified++;
        continue;
      }

      qualified++;
      srcStats[signalSourceName(signal)].qualified++;

      const [lead] = await db.insert(legalLeads).values({
        signalId:          saved.id,
        legalVertical:     enrichedSignal.legalVertical,
        signalType:        enrichedSignal.signalType,
        county:            enrichedSignal.county,
        subjectName:       enrichedSignal.subjectName,
        subjectPhone:      phone || undefined,
        subjectAddress:    enrichedSignal.subjectAddress,
        chargeDescription: enrichedSignal.chargeDescription,
        caseNumber:        enrichedSignal.caseNumber,
        urgency:           enrichedSignal.urgency,
        score,
        status:            "available",
        expiresAt,
        rawData:           enrichedSignal.rawData,
        detectedAt:        normalizeDetectedAt(enrichedSignal.detectedAt),
      }).returning();

      await db.update(legalSignals)
        .set({ status: "qualified", score, leadId: lead.id })
        .where(eq(legalSignals.id, saved.id));

      // Deliver to ALL accounts
      await deliverLeadToAllAccounts({ ...lead, subjectPhone: phone });
      stats.totalLeads++;

      import("./operator/apexIntelligence").then(({ reportOutcome }) =>
        reportOutcome({
          agentName:    "legal-pipeline",
          action:       "lead_created",
          subject:      enrichedSignal.subjectName || enrichedSignal.signalType,
          result:       `${enrichedSignal.signalType} lead — ${enrichedSignal.county} (score ${score})`,
          confidence:   Math.min(1, score / 100),
          subAccountId: APEX_PARENT_ACCOUNT_ID,
          niche:        "legal",
          metadata:     { signalType: enrichedSignal.signalType, county: enrichedSignal.county, urgency: enrichedSignal.urgency, score, leadId: lead.id },
        })
      ).catch((e: any) => console.warn("[APEX-OUTCOME] reportOutcome fire-and-forget error:", e?.message));

    } catch (err: any) {
      console.error(`[LEGAL-PIPELINE] Signal error:`, err.message);
    }
  }

  stats.totalSignals += allSignals.length;

  // Per-source final breakdown
  for (const name of sourceNames) {
    const s = srcStats[name];
    if (s.raw > 0 || s.inserted > 0) {
      console.log(`[LEGAL-PIPELINE] breakdown source=${name} raw=${s.raw} inserted=${s.inserted} dupes=${s.dupes} qualified=${s.qualified} disqualified=${s.disqualified}`);
    }
  }

  console.log(
    `[LEGAL-PIPELINE] ── CYCLE END id=${runId} ──\n` +
    `  signals=${allSignals.length} inserted=${inserted} dupes=${dupes} ` +
    `qualified=${qualified} ms=${Date.now() - startMs}`
  );
}

// ── START / STOP ──────────────────────────────────────────────────────────────

let running  = false;
let interval: ReturnType<typeof setInterval> | null = null;

export function startLegalPipeline(subAccountId = APEX_PARENT_ACCOUNT_ID): void {
  if (running) { console.log("[LEGAL-PIPELINE] Already running"); return; }
  running = true;
  console.log(`[LEGAL-PIPELINE] Started (id=${PIPELINE_ID}) — polling every ${POLL_INTERVAL_MS / 60000}min`);
  console.log(`[LEGAL-PIPELINE] Sources: FL Arrests, OSHA, FDA, CPSC${GOOGLE_PLACES_KEY ? ", Google Places ✅" : " (no Google Places key)"}`);
  console.log(`[LEGAL-PIPELINE] Skip trace: ${BATCHDATA_KEY ? "✅ active" : "⚠️ no key"}`);
  const tick = async () => {
    try {
      await runLegalCycle(subAccountId);
      // Enrichment pass: skip-trace arrest signals that came in without a phone number
      await runArrestEnrichmentPass().catch(err =>
        console.warn("[LEGAL-PIPELINE] Enrichment pass error (non-fatal):", err?.message),
      );
    }
    catch (err: any) { stats.lastError = err.message; console.error("[LEGAL-PIPELINE] Tick error:", err.message); }
  };
  tick();
  interval = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopLegalPipeline(): void {
  if (interval) { clearInterval(interval); interval = null; }
  running = false;
  console.log("[LEGAL-PIPELINE] Stopped");
}
