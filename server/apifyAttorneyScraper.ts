/**
 * Apify Attorney Scraper
 * Scrapes PI, criminal, DUI, traffic, family law attorneys from Martindale
 * Stores results in legal_attorneys table
 * Runs on startup + every 24 hours
 */

import { db } from "./db";
import { legalAttorneys } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

const MARTINDALE_ACTOR = "jungle_synthesizer~martindale-scraper";

function getApifyToken(): string {
  return (process.env.APIFY_API_KEY || process.env.getApifyToken() || "").trim();
}

// Legal verticals to scrape with their Martindale practice area keys
const SCRAPE_TARGETS = [
  { vertical: "personal_injury", practiceArea: "personal-injury",  label: "Personal Injury" },
  { vertical: "criminal",        practiceArea: "criminal-law",     label: "Criminal Law"    },
  { vertical: "dui",             practiceArea: "dui-dwi",          label: "DUI/DWI"         },
  { vertical: "traffic",         practiceArea: "traffic-violations", label: "Traffic"       },
  { vertical: "family",          practiceArea: "family-law",       label: "Family Law"      },
  { vertical: "accident",        practiceArea: "car-accidents",    label: "Car Accidents"   },
];

const TARGET_STATES = ["FL", "TX", "CA", "GA", "NC", "OH"];

interface MartindaleAttorney {
  name?: string;
  firmName?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  practiceAreas?: string[];
  county?: string;
}

async function runApifyActor(input: Record<string, unknown>): Promise<string> {
  const res = await fetch(`https://api.apify.com/v2/acts/${MARTINDALE_ACTOR}/runs`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getApifyToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Apify run failed: ${res.status} ${err.slice(0, 200)}`);
  }
  const data = await res.json() as { data: { id: string } };
  return data.data.id;
}

async function waitForRun(runId: string, maxWaitMs = 300000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 10000)); // poll every 10s
    const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
      headers: { "Authorization": `Bearer ${getApifyToken()}` },
    });
    const data = await res.json() as { data: { status: string; defaultDatasetId: string } };
    if (data.data.status === "SUCCEEDED") return data.data.defaultDatasetId;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(data.data.status)) {
      throw new Error(`Apify run ${runId} ended with status: ${data.data.status}`);
    }
  }
  throw new Error(`Apify run ${runId} timed out after ${maxWaitMs}ms`);
}

async function fetchDataset(datasetId: string): Promise<MartindaleAttorney[]> {
  const res = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?limit=1000&format=json`,
    { headers: { "Authorization": `Bearer ${getApifyToken()}` } }
  );
  if (!res.ok) throw new Error(`Dataset fetch failed: ${res.status}`);
  return res.json() as Promise<MartindaleAttorney[]>;
}

async function upsertAttorneys(attorneys: MartindaleAttorney[], vertical: string): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const atty of attorneys) {
    const phone = (atty.phone || "").replace(/\D/g, "");
    if (!phone || phone.length < 10) { skipped++; continue; }
    const firmName = atty.firmName || atty.name || "Unknown Firm";
    if (!firmName || firmName === "Unknown Firm") { skipped++; continue; }

    // Check if already exists by phone
    const [existing] = await db
      .select({ id: legalAttorneys.id, legalVerticals: legalAttorneys.legalVerticals })
      .from(legalAttorneys)
      .where(eq(legalAttorneys.phone, phone))
      .limit(1);

    if (existing) {
      // Add vertical if not already there
      const verticals = (existing.legalVerticals as string[]) || [];
      if (!verticals.includes(vertical)) {
        await db.update(legalAttorneys)
          .set({ legalVerticals: [...verticals, vertical] as any })
          .where(eq(legalAttorneys.id, existing.id));
      }
      skipped++;
      continue;
    }

    await db.insert(legalAttorneys).values({
      firmName,
      attorneyName: atty.name || null,
      phone,
      email: atty.email || null,
      legalVerticals: [vertical] as any,
      counties: atty.county ? [atty.county.toUpperCase()] as any : [] as any,
      tier: "pay_per_lead",
      active: true,
      score: 50,
    });
    inserted++;
  }

  return { inserted, skipped };
}

export async function scrapeAttorneysForVertical(vertical: string, practiceArea: string, label: string): Promise<void> {
  console.log(`[APIFY] Starting scrape: ${label} attorneys in ${TARGET_STATES.join(", ")}`);
  try {
    const runId = await runApifyActor({
      states: TARGET_STATES,
      practiceAreas: [practiceArea],
      maxItems: 200,
    });
    console.log(`[APIFY] Run started: ${runId} for ${label}`);

    const datasetId = await waitForRun(runId);
    console.log(`[APIFY] Run complete: dataset=${datasetId} for ${label}`);

    const attorneys = await fetchDataset(datasetId);
    console.log(`[APIFY] Fetched ${attorneys.length} ${label} attorneys from dataset`);

    const { inserted, skipped } = await upsertAttorneys(attorneys, vertical);
    console.log(`[APIFY] ${label}: inserted=${inserted} skipped/updated=${skipped}`);
  } catch (err: any) {
    console.error(`[APIFY] Failed to scrape ${label}:`, err.message);
  }
}

export async function runFullAttorneyScrape(): Promise<void> {
  const token = getApifyToken();
  if (!token) {
    console.warn("[APIFY] No Apify credential configured — attorney scrape skipped");
    return;
  }
  console.log("[APIFY] Credential confirmed — starting attorney scrape");
  console.log("[APIFY] Starting full attorney scrape for all legal verticals");
  for (const target of SCRAPE_TARGETS) {
    await scrapeAttorneysForVertical(target.vertical, target.practiceArea, target.label);
    await new Promise(r => setTimeout(r, 5000)); // be nice to the API
  }
  console.log("[APIFY] Full attorney scrape complete");
}

export function startApifyScheduler(): void {
  const INTERVAL_MS = 24 * 60 * 60 * 1000; // every 24 hours
  // Run 5 minutes after boot, then every 24h
  setTimeout(() => {
    runFullAttorneyScrape().catch(err =>
      console.error("[APIFY] Scheduler run failed:", err.message)
    );
    setInterval(() => {
      runFullAttorneyScrape().catch(err =>
        console.error("[APIFY] Scheduler run failed:", err.message)
      );
    }, INTERVAL_MS);
  }, 5 * 60 * 1000);
  console.log("[APIFY] Attorney scrape scheduler started — first run in 5 minutes");
}
