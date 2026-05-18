/**
 * server/apifyLeadScrapers.ts
 *
 * Apify-powered lead scrapers for Apex:
 *
 *   1. Google Maps Scraper — discovers local businesses (salons, barbershops,
 *      HVAC, plumbers, etc.) with verified phone numbers, feeds service lead gen
 *      and commercial insurance pipeline.
 *
 *   2. Zillow Property Scraper — pulls estimated home values, listing status,
 *      owner info for FL properties. Feeds home service + insurance premium scoring.
 *
 * Both use the existing resolveApifyToken() / recordApifyRun() from vendorConfig.ts.
 * Contacts are upserted via the standard contactUpsertService dedup chain.
 *
 * Polling:
 *   Google Maps — every 12 hours
 *   Zillow       — every 24 hours
 */

import crypto from "crypto";
import { db } from "./db";
import { subAccounts } from "@shared/schema";
import { resolveApifyToken, recordApifyRun } from "./vendorConfig";
import { upsertContact, CONTACT_SOURCES } from "./services/contactUpsertService";

// ── Apify shared helpers ──────────────────────────────────────────────────────

async function startApifyRun(
  token: string,
  actorId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs`, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(input),
    signal:  AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Apify start failed (${actorId}): ${res.status} ${txt.slice(0, 200)}`);
  }
  const data = await res.json() as { data: { id: string } };
  return data.data.id;
}

async function waitForRun(
  token: string,
  runId: string,
  maxWaitMs = 5 * 60_000,
): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10_000));
    const res  = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const data = await res.json() as { data: { status: string; defaultDatasetId: string } };
    if (data.data.status === "SUCCEEDED") return data.data.defaultDatasetId;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(data.data.status)) {
      throw new Error(`Apify run ${runId} ended: ${data.data.status}`);
    }
  }
  throw new Error(`Apify run ${runId} timed out`);
}

async function fetchDataset<T>(token: string, datasetId: string, limit = 1000): Promise<T[]> {
  const res = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?limit=${limit}&format=json`,
    { headers: { "Authorization": `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Dataset fetch failed: ${res.status}`);
  return res.json() as Promise<T[]>;
}

// ── FL search targets ─────────────────────────────────────────────────────────

const FL_CITIES = [
  "Fort Myers, FL", "Naples, FL", "Port Charlotte, FL", "Sarasota, FL",
  "Bradenton, FL", "Tampa, FL", "St Petersburg, FL", "Fort Lauderdale, FL",
  "Miami, FL", "Orlando, FL", "West Palm Beach, FL", "Jacksonville, FL",
];

// ── 1. GOOGLE MAPS SCRAPER ────────────────────────────────────────────────────
// Actor: compass~google-maps-scraper (one of the highest-rated Maps actors)

const GMAPS_ACTOR = "compass~google-maps-scraper";

const GMAPS_SEARCH_TARGETS: Array<{ query: string; vertical: string; tags: string[] }> = [
  { query: "barbershop",          vertical: "service_industry", tags: ["barbershop",    "local-service"] },
  { query: "hair salon",          vertical: "service_industry", tags: ["hair-salon",    "local-service"] },
  { query: "nail salon",          vertical: "service_industry", tags: ["nail-salon",    "local-service"] },
  { query: "med spa",             vertical: "service_industry", tags: ["med-spa",       "local-service"] },
  { query: "HVAC contractor",     vertical: "home_services",    tags: ["hvac",          "home-service"]  },
  { query: "roofing contractor",  vertical: "home_services",    tags: ["roofing",       "home-service"]  },
  { query: "plumber",             vertical: "home_services",    tags: ["plumbing",      "home-service"]  },
  { query: "electrician",         vertical: "home_services",    tags: ["electrical",    "home-service"]  },
  { query: "landscaping company", vertical: "home_services",    tags: ["landscaping",   "home-service"]  },
  { query: "pest control",        vertical: "home_services",    tags: ["pest-control",  "home-service"]  },
  { query: "auto body shop",      vertical: "auto_services",    tags: ["auto-body",     "local-service"] },
  { query: "insurance agency",    vertical: "insurance",        tags: ["insurance",     "local-service"] },
];

interface GMapsResult {
  title?: string;
  name?: string;
  phone?: string;
  phoneUnformatted?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  zip?: string;
  website?: string;
  categoryName?: string;
  totalScore?: number;
  reviewsCount?: number;
  location?: { lat?: number; lng?: number };
}

async function runGoogleMapsScraper(token: string): Promise<void> {
  const accounts = await db.select({ id: subAccounts.id }).from(subAccounts);
  if (!accounts.length) return;

  let totalUpserted = 0;
  let totalErrors   = 0;

  for (const target of GMAPS_SEARCH_TARGETS) {
    // Run one actor per search type across all FL cities
    const searchStrings = FL_CITIES.map(city => `${target.query} in ${city}`);

    try {
      console.log(`[GMAPS] Starting scrape: "${target.query}" × ${FL_CITIES.length} cities`);

      const runId     = await startApifyRun(token, GMAPS_ACTOR, {
        searchStringsArray: searchStrings,
        maxCrawledPlacesPerSearch: 20,
        language: "en",
        maxImages: 0,
        exportPlaceUrls: false,
        additionalInfo: false,
        reviewsSort: "newest",
        maxReviews: 0,
      });

      const datasetId = await waitForRun(token, runId, 8 * 60_000);
      const results   = await fetchDataset<GMapsResult>(token, datasetId, 2000);

      for (const biz of results) {
        const name  = biz.title || biz.name;
        const phone = (biz.phone || biz.phoneUnformatted || "").replace(/\D/g, "");
        if (!name || phone.length < 10) continue;

        for (const account of accounts) {
          await upsertContact({
            subAccountId:     account.id,
            firstName:        name,
            lastName:         "",
            company:          name,
            phone:            phone,
            address:          biz.address ?? "",
            city:             biz.city ?? "",
            state:            biz.state ?? "FL",
            zip:              biz.postalCode ?? biz.zip ?? "",
            source:           CONTACT_SOURCES.APIFY,
            sourceExternalId: `GMAPS-${target.vertical}-${phone}:acct${account.id}`,
            leadVertical:     target.vertical,
            leadSubtype:      target.query.replace(/\s+/g, "_"),
            tags:             [...target.tags, "google-maps"],
            notes:            `Google Maps — ${biz.categoryName ?? target.query} | ⭐ ${biz.totalScore ?? "?"} (${biz.reviewsCount ?? 0} reviews)`,
          });
          totalUpserted++;
        }
      }

      console.log(`[GMAPS] ✅ "${target.query}" — ${results.length} results`);
    } catch (err: any) {
      console.error(`[GMAPS] "${target.query}" failed: ${err.message}`);
      totalErrors++;
    }

    // Brief pause between actor runs to avoid Apify rate limits
    await new Promise(r => setTimeout(r, 3_000));
  }

  recordApifyRun(totalUpserted, "google-maps-scraper", totalErrors > 0 ? `${totalErrors} search targets failed` : null);
  console.log(`[GMAPS] Done — ${totalUpserted} contacts upserted, ${totalErrors} errors`);
}

// ── 2. ZILLOW PROPERTY SCRAPER ────────────────────────────────────────────────
// Actor: maxcopell~zillow-scraper

const ZILLOW_ACTOR = "maxcopell~zillow-scraper";

// FL zip codes in target markets (high property-insurance opportunity)
const FL_ZIP_CODES = [
  "33901", "33907", "33912", // Fort Myers
  "34102", "34103", "34108", // Naples
  "34224", "34266",           // Port Charlotte
  "34230", "34231", "34237", // Sarasota
  "34205", "34208",           // Bradenton
  "33601", "33605", "33606", // Tampa
  "33701", "33705",           // St Pete
  "33301", "33309",           // Fort Lauderdale
  "33101", "33125", "33127", // Miami
  "32801", "32804",           // Orlando
  "33401", "33407",           // West Palm
];

interface ZillowResult {
  address?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  price?: number;
  zestimate?: number;
  homeType?: string;
  bedrooms?: number;
  bathrooms?: number;
  livingArea?: number;
  lotSize?: number;
  yearBuilt?: number;
  listingStatus?: string;
  daysOnZillow?: number;
  zpid?: string | number;
}

async function runZillowScraper(token: string): Promise<void> {
  const accounts = await db.select({ id: subAccounts.id }).from(subAccounts);
  if (!accounts.length) return;

  let totalUpserted = 0;
  let totalErrors   = 0;

  // Batch zips into groups of 10 to limit run size
  const ZIP_BATCH_SIZE = 10;
  for (let i = 0; i < FL_ZIP_CODES.length; i += ZIP_BATCH_SIZE) {
    const batch = FL_ZIP_CODES.slice(i, i + ZIP_BATCH_SIZE);

    try {
      console.log(`[ZILLOW] Scraping zip batch: ${batch.join(", ")}`);

      const runId = await startApifyRun(token, ZILLOW_ACTOR, {
        searchUrls: batch.map(zip => ({
          url: `https://www.zillow.com/homes/${zip}_rb/`,
        })),
        maxItems: 50,
        proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
      });

      const datasetId = await waitForRun(token, runId, 10 * 60_000);
      const results   = await fetchDataset<ZillowResult>(token, datasetId, 1000);

      for (const prop of results) {
        const address = prop.streetAddress ?? prop.address;
        if (!address) continue;

        const estValue = prop.zestimate ?? prop.price ?? 0;
        const isForSale = (prop.listingStatus ?? "").toLowerCase().includes("sale");

        for (const account of accounts) {
          await upsertContact({
            subAccountId:     account.id,
            firstName:        "Property Owner",
            lastName:         "",
            company:          "",
            address:          address,
            city:             prop.city ?? "",
            state:            prop.state ?? "FL",
            zip:              prop.zipcode ?? "",
            source:           CONTACT_SOURCES.APIFY,
            sourceExternalId: `ZILLOW-${prop.zpid ?? crypto.randomUUID().slice(0, 8)}:acct${account.id}`,
            leadVertical:     "home_services",
            leadSubtype:      isForSale ? "fsbo_listing" : "homeowner",
            tags:             [
              "zillow",
              isForSale ? "for-sale" : "homeowner",
              estValue > 500_000 ? "high-value-home" : estValue > 250_000 ? "mid-value-home" : "standard-home",
            ],
            notes: [
              `Zillow: ${prop.homeType ?? "residential"} | ${prop.bedrooms ?? "?"}bd/${prop.bathrooms ?? "?"}ba`,
              `Est. value: $${estValue.toLocaleString()}`,
              prop.yearBuilt ? `Built: ${prop.yearBuilt}` : null,
              prop.livingArea ? `${prop.livingArea.toLocaleString()} sqft` : null,
              isForSale ? `FOR SALE — ${prop.daysOnZillow ?? "?"} days on market` : null,
            ].filter(Boolean).join(" | "),
          });
          totalUpserted++;
        }
      }

      console.log(`[ZILLOW] ✅ Batch ${batch[0]}–${batch[batch.length - 1]}: ${results.length} properties`);
    } catch (err: any) {
      console.error(`[ZILLOW] Batch failed: ${err.message}`);
      totalErrors++;
    }

    await new Promise(r => setTimeout(r, 5_000));
  }

  recordApifyRun(totalUpserted, "zillow-scraper", totalErrors > 0 ? `${totalErrors} batches failed` : null);
  console.log(`[ZILLOW] Done — ${totalUpserted} property contacts upserted, ${totalErrors} errors`);
}

// ── Schedulers ────────────────────────────────────────────────────────────────

export function startApifyLeadScrapers(): void {
  const token = resolveApifyToken();
  if (!token) {
    console.warn("[APIFY-LEADS] APIFY_API_KEY not set — Google Maps + Zillow scrapers disabled");
    return;
  }

  console.log("[APIFY-LEADS] Starting Google Maps + Zillow lead scrapers");

  // Google Maps: initial run after 2 min, then every 12h
  setTimeout(() => {
    runGoogleMapsScraper(token).catch(err =>
      console.error("[GMAPS] Initial run failed:", err.message)
    );
  }, 2 * 60_000);

  setInterval(() => {
    runGoogleMapsScraper(token).catch(err =>
      console.error("[GMAPS] Scheduled run failed:", err.message)
    );
  }, 12 * 60 * 60_000);

  // Zillow: initial run after 5 min (stagger from Maps), then every 24h
  setTimeout(() => {
    runZillowScraper(token).catch(err =>
      console.error("[ZILLOW] Initial run failed:", err.message)
    );
  }, 5 * 60_000);

  setInterval(() => {
    runZillowScraper(token).catch(err =>
      console.error("[ZILLOW] Scheduled run failed:", err.message)
    );
  }, 24 * 60 * 60_000);
}
