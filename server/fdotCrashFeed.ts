/**
 * FDOT SSOGis Crash Feed
 *
 * Fetches Florida crash records from FDOT's free public ArcGIS FeatureService:
 *   https://gis.fdot.gov/arcgis/rest/services/sso/ssogis/FeatureServer/2000/query
 *
 * Key facts:
 *  - No API key or auth required
 *  - No ScrapingBee/proxy needed (FDOT has no WAF)
 *  - Returns crashes from ALL agencies: FHP, LCSO, Cape Coral PD, Fort Myers PD, etc.
 *  - CRASH_NUMBER field maps to the FLHSMV official report number (usable for PDF fetch)
 *  - Data published annually; currently complete through 2022
 *
 * Use case: discover crashes in Lee/Collier/Charlotte that the FHP CAD feed missed
 * (especially local agency crashes), then create sentinel_followup jobs so the
 * FLHSMV worker picks them up and fetches the full report + PDF.
 */

import { db } from "./db";
import { crashReports } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";

const FDOT_BASE = "https://gis.fdot.gov/arcgis/rest/services/sso/ssogis/FeatureServer";
const PAGE_SIZE = 2000;

// FDOT county name → display name mapping (used in where clause)
export const FDOT_COUNTIES: Record<string, string> = {
  lee:       "LEE",
  collier:   "COLLIER",
  charlotte:  "CHARLOTTE",
  sarasota:  "SARASOTA",
  manatee:   "MANATEE",
  hendry:    "HENDRY",
  glades:    "GLADES",
};

// Years with confirmed data (FDOT publishes annually, typically ~2yr lag)
const CONFIRMED_YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022];

export interface FDOTCrashRecord {
  XID: string;
  CRASH_NUMBER: string;       // Maps to FLHSMV official report number
  CASE_NUMBER: string;        // Reporting agency's own case number
  AGENCY_TYPE_TXT: string;    // "FLORIDA HIGHWAY PATROL" | "CITY POLICE DEPARTMENT" | "COUNTY SHERIFF OFFICE" | ...
  CALENDAR_YEAR: number;
  CRASH_DATE: number;         // Epoch ms
  CRASH_TIME: string | null;
  COUNTY_TXT: string;
  ON_ROADWAY_NAME: string | null;
  INT_ROADWAY_NAME: string | null;
  SAFETYLAT: number | null;
  SAFETYLON: number | null;
  NUMBER_OF_INJURED: number;
  NUMBER_OF_KILLED: number;
}

export interface FDOTFetchStats {
  county: string;
  year: number;
  fetched: number;
  newJobs: number;
  alreadyExists: number;
  failed: number;
  dryRun: boolean;
}

export interface FDOTIngestStats {
  totalFetched: number;
  totalNewJobs: number;
  totalAlreadyExists: number;
  totalFailed: number;
  byYear: FDOTFetchStats[];
}

async function fetchFDOTPage(
  county: string,
  year: number,
  offset: number,
): Promise<{ records: FDOTCrashRecord[]; exceededLimit: boolean }> {
  const where = `COUNTY_TXT='${county}' AND CALENDAR_YEAR=${year}`;
  const params = new URLSearchParams({
    where,
    outFields: "XID,CRASH_NUMBER,CASE_NUMBER,AGENCY_TYPE_TXT,CALENDAR_YEAR,CRASH_DATE,CRASH_TIME,COUNTY_TXT,ON_ROADWAY_NAME,INT_ROADWAY_NAME,SAFETYLAT,SAFETYLON,NUMBER_OF_INJURED,NUMBER_OF_KILLED",
    orderByFields: "CRASH_DATE ASC,XID ASC",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    f: "json",
  });

  const url = `${FDOT_BASE}/${year}/query?${params.toString()}`;
  // Fall back to the "All" layer (2000) if the year-specific layer has no data
  const urlAll = `${FDOT_BASE}/2000/query?${params.toString()}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as any;
      if (json.error) {
        // Year-specific layer missing — try the All layer
        const res2 = await fetch(urlAll, { signal: AbortSignal.timeout(20_000) });
        if (!res2.ok) throw new Error(`HTTP ${res2.status} (all-layer fallback)`);
        const json2 = await res2.json() as any;
        if (json2.error) throw new Error(json2.error.message);
        return {
          records: (json2.features ?? []).map((f: any) => f.attributes as FDOTCrashRecord),
          exceededLimit: !!json2.exceededTransferLimit,
        };
      }
      return {
        records: (json.features ?? []).map((f: any) => f.attributes as FDOTCrashRecord),
        exceededLimit: !!json.exceededTransferLimit,
      };
    } catch (err: any) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error("FDOT fetch exhausted");
}

function buildSentinelReportNumber(xid: string, county: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`fdot:${county.toLowerCase()}:${xid}`)
    .digest("hex")
    .slice(0, 16);
  return `FDOT-${hash}`;
}

async function jobAlreadyExists(reportNumber: string): Promise<boolean> {
  const rows = await db
    .select({ id: crashReports.id })
    .from(crashReports)
    .where(eq(crashReports.reportNumber, reportNumber))
    .limit(1);
  return rows.length > 0;
}

export async function ingestFDOTCountyCrashes(options: {
  county: string;
  years?: number[];
  subAccountId: number;
  dryRun?: boolean;
  limitPerYear?: number;
}): Promise<FDOTIngestStats> {
  const {
    county,
    years = CONFIRMED_YEARS,
    subAccountId,
    dryRun = false,
    limitPerYear = 50000,
  } = options;

  const fdotCounty = FDOT_COUNTIES[county.toLowerCase()] ?? county.toUpperCase();
  const stats: FDOTIngestStats = {
    totalFetched: 0,
    totalNewJobs: 0,
    totalAlreadyExists: 0,
    totalFailed: 0,
    byYear: [],
  };

  for (const year of years) {
    const yearStats: FDOTFetchStats = {
      county: fdotCounty,
      year,
      fetched: 0,
      newJobs: 0,
      alreadyExists: 0,
      failed: 0,
      dryRun,
    };

    console.log(`[FDOT-FEED] Fetching ${fdotCounty} / ${year}...`);

    let offset = 0;
    let hasMore = true;

    while (hasMore && yearStats.fetched < limitPerYear) {
      let records: FDOTCrashRecord[];
      let exceededLimit: boolean;
      try {
        ({ records, exceededLimit } = await fetchFDOTPage(fdotCounty, year, offset));
      } catch (err: any) {
        console.warn(`[FDOT-FEED] Fetch error ${fdotCounty}/${year} offset=${offset}: ${err.message}`);
        yearStats.failed++;
        break;
      }

      if (records.length === 0) break;

      yearStats.fetched += records.length;

      for (const rec of records) {
        if (!rec.XID || !rec.CRASH_NUMBER) {
          yearStats.failed++;
          continue;
        }

        const reportNumber = buildSentinelReportNumber(rec.XID, county);

        try {
          const exists = await jobAlreadyExists(reportNumber);
          if (exists) {
            yearStats.alreadyExists++;
            continue;
          }

          if (!dryRun) {
            const crashDate = rec.CRASH_DATE
              ? new Date(rec.CRASH_DATE).toISOString().split("T")[0]
              : null;

            const location = [rec.ON_ROADWAY_NAME, rec.INT_ROADWAY_NAME]
              .filter(Boolean).join(" & ") || null;

            await db.insert(crashReports).values({
              reportNumber,
              officialReportNumber: rec.CRASH_NUMBER, // FDOT crash number = FLHSMV report number
              source: "fdot_ssogis",
              status: "PENDING",
              subAccountId,
              data: {
                xid: rec.XID,
                fdotCrashNumber: rec.CRASH_NUMBER,
                agencyCaseNumber: rec.CASE_NUMBER,
                agencyType: rec.AGENCY_TYPE_TXT,
                county: fdotCounty,
                crashDate,
                crashTime: rec.CRASH_TIME ?? null,
                location,
                lat: rec.SAFETYLAT ?? null,
                lng: rec.SAFETYLON ?? null,
                injuries: rec.NUMBER_OF_INJURED,
                fatalities: rec.NUMBER_OF_KILLED,
                spawnedBy: "fdot-ssogis-ingest",
              },
            });
          }

          yearStats.newJobs++;
        } catch (err: any) {
          console.warn(`[FDOT-FEED] DB error for XID=${rec.XID}: ${err.message}`);
          yearStats.failed++;
        }
      }

      console.log(
        `[FDOT-FEED] ${fdotCounty}/${year} offset=${offset}: ` +
        `+${records.length} fetched, newJobs=${yearStats.newJobs} exists=${yearStats.alreadyExists}`
      );

      hasMore = exceededLimit && records.length === PAGE_SIZE;
      offset += records.length;

      // Brief pause between pages to be a good citizen
      if (hasMore) await new Promise(r => setTimeout(r, 300));
    }

    stats.byYear.push(yearStats);
    stats.totalFetched += yearStats.fetched;
    stats.totalNewJobs += yearStats.newJobs;
    stats.totalAlreadyExists += yearStats.alreadyExists;
    stats.totalFailed += yearStats.failed;

    console.log(
      `[FDOT-FEED] ${fdotCounty}/${year} complete — ` +
      `fetched=${yearStats.fetched} newJobs=${yearStats.newJobs} ` +
      `exists=${yearStats.alreadyExists} failed=${yearStats.failed}`
    );
  }

  return stats;
}
