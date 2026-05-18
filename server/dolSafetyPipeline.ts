/**
 * server/dolSafetyPipeline.ts
 *
 * DOL Industrial Safety Intelligence Pipeline
 *
 * Pulls OSHA accident/inspection records and MSHA mine violation data
 * from the U.S. Department of Labor Open Data Portal, scores employer
 * risk 0–100, and routes high-risk signals into Apex as:
 *
 *   • Legal leads    — fatality/injury cases → workers comp attorneys
 *   • Insurance leads — high-risk employers  → commercial insurance agents
 *
 * Requires: DOL_API_KEY set in Railway env vars.
 *
 * Polling: every 6 hours (DOL data updates daily — no need to poll faster).
 *
 * FL-only by default (configurable via DOL_SAFETY_STATES).
 */

import crypto from "crypto";
import { db } from "./db";
import { contacts, subAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { upsertContact, CONTACT_SOURCES } from "./services/contactUpsertService";

// ── Config ────────────────────────────────────────────────────────────────────

const DOL_API_KEY   = process.env.DOL_API_KEY?.trim() || "";
const DOL_BASE      = "https://dataportal.dol.gov/v1/dataset";
const POLL_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const MAX_RESULTS   = 200;

// States to monitor — defaults to FL, expand via DOL_SAFETY_STATES="FL,TX,GA"
const TARGET_STATES = (process.env.DOL_SAFETY_STATES ?? "FL")
  .split(",")
  .map(s => s.trim().toUpperCase())
  .filter(Boolean);

// Risk thresholds for lead routing
const RISK_LEGAL_THRESHOLD     = 40; // OSHA injury/fatality → legal lead
const RISK_INSURANCE_THRESHOLD = 30; // Any elevated risk → commercial insurance lead

// ── DOL API client ────────────────────────────────────────────────────────────

interface DolResponse<T> {
  status: number;
  data: T[];
  metadata?: { rows: number };
}

async function dolFetch<T>(
  dataset: string,
  params: Record<string, string | number>,
  retries = 3,
): Promise<T[]> {
  if (!DOL_API_KEY) return [];

  const url = new URL(`${DOL_BASE}/${dataset}`);
  url.searchParams.set("X-API-KEY", DOL_API_KEY);
  url.searchParams.set("limit", String(params.limit ?? MAX_RESULTS));
  for (const [k, v] of Object.entries(params)) {
    if (k !== "limit") url.searchParams.set(k, String(v));
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 429) {
        const wait = Math.pow(2, attempt) * 2000;
        console.warn(`[DOL] Rate limited — retrying in ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        console.warn(`[DOL] ${dataset} HTTP ${res.status}`);
        return [];
      }

      const json = await res.json() as DolResponse<T>;
      return json.data ?? [];
    } catch (err: any) {
      if (attempt === retries - 1) {
        console.error(`[DOL] ${dataset} fetch failed: ${err.message}`);
      }
    }
  }
  return [];
}

// ── Risk scoring ──────────────────────────────────────────────────────────────

interface RiskScore {
  total: number;
  level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  factors: string[];
}

function scoreRisk(opts: {
  fatalities: number;
  hospitalizations: number;
  injuries: number;
  accidentCount: number;
  inspectionCount: number;
  mshaViolations: number;
}): RiskScore {
  let score = 0;
  const factors: string[] = [];

  if (opts.fatalities > 0)        { score += Math.min(opts.fatalities * 30, 90); factors.push(`${opts.fatalities} fatal`); }
  if (opts.hospitalizations > 0)  { score += Math.min(opts.hospitalizations * 10, 40); factors.push(`${opts.hospitalizations} hosp.`); }
  if (opts.injuries > 0)          { score += Math.min(opts.injuries * 2, 20); factors.push(`${opts.injuries} injuries`); }
  if (opts.accidentCount > 5)     { score += Math.min(opts.accidentCount, 15); factors.push(`${opts.accidentCount} OSHA accidents`); }
  if (opts.inspectionCount > 3)   { score += Math.min(opts.inspectionCount, 15); factors.push(`${opts.inspectionCount} inspections`); }
  if (opts.mshaViolations > 0)    { score += Math.min(opts.mshaViolations * 5, 25); factors.push(`${opts.mshaViolations} MSHA violations`); }

  score = Math.min(score, 100);
  const level = score >= 70 ? "CRITICAL" : score >= 50 ? "HIGH" : score >= 30 ? "MODERATE" : "LOW";

  return { total: score, level, factors };
}

// ── Data types ────────────────────────────────────────────────────────────────

interface OshaAccident {
  id?: string;
  activity_nr?: string;
  estab_name?: string;
  site_address?: string;
  site_city?: string;
  site_state?: string;
  site_zip?: string;
  event_date?: string;
  event_desc?: string;
  degree_of_inj?: string;
  nature_of_inj?: string;
  part_of_body?: string;
  fat_cnt?: string | number;
  hosp_cnt?: string | number;
  amp_cnt?: string | number;
  naics_code?: string;
}

interface OshaInspection {
  activity_nr?: string;
  estab_name?: string;
  site_address?: string;
  site_city?: string;
  site_state?: string;
  site_zip?: string;
  open_date?: string;
  close_conf_date?: string;
  insp_type?: string;
  naics_code?: string;
}

interface MshaViolation {
  mine_id?: string;
  mine_name?: string;
  operator_name?: string;
  state_abbr?: string;
  violation_no?: string;
  violation_issue_dt?: string;
  section_of_act?: string;
  gravity?: string;
}

// ── Per-employer aggregation ──────────────────────────────────────────────────

interface EmployerProfile {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  naicsCode: string;
  fatalities: number;
  hospitalizations: number;
  injuries: number;
  accidents: OshaAccident[];
  inspections: OshaInspection[];
  mshaViolations: number;
  latestEvent: string;
  sourceId: string;
}

function groupByEmployer(
  accidents: OshaAccident[],
  inspections: OshaInspection[],
): Map<string, EmployerProfile> {
  const map = new Map<string, EmployerProfile>();

  const key = (name: string, city: string) =>
    `${(name ?? "").toLowerCase().trim()}|${(city ?? "").toLowerCase().trim()}`;

  for (const a of accidents) {
    const k = key(a.estab_name ?? "", a.site_city ?? "");
    if (!k.startsWith("|")) {
      const existing = map.get(k);
      const fat  = Number(a.fat_cnt  ?? 0);
      const hosp = Number(a.hosp_cnt ?? 0);
      const inj  = 1; // each record = 1 incident
      if (existing) {
        existing.fatalities      += fat;
        existing.hospitalizations += hosp;
        existing.injuries         += inj;
        existing.accidents.push(a);
        if ((a.event_date ?? "") > existing.latestEvent) existing.latestEvent = a.event_date ?? "";
      } else {
        map.set(k, {
          name:             a.estab_name ?? "Unknown Employer",
          address:          a.site_address ?? "",
          city:             a.site_city ?? "",
          state:            a.site_state ?? "",
          zip:              a.site_zip ?? "",
          naicsCode:        a.naics_code ?? "",
          fatalities:       fat,
          hospitalizations: hosp,
          injuries:         inj,
          accidents:        [a],
          inspections:      [],
          mshaViolations:   0,
          latestEvent:      a.event_date ?? "",
          sourceId:         `DOL-OSHA-${a.activity_nr ?? a.id ?? crypto.randomUUID().slice(0, 8)}`,
        });
      }
    }
  }

  for (const i of inspections) {
    const k = key(i.estab_name ?? "", i.site_city ?? "");
    const existing = map.get(k);
    if (existing) {
      existing.inspections.push(i);
    } else if (i.estab_name) {
      map.set(k, {
        name:             i.estab_name,
        address:          i.site_address ?? "",
        city:             i.site_city ?? "",
        state:            i.site_state ?? "",
        zip:              i.site_zip ?? "",
        naicsCode:        i.naics_code ?? "",
        fatalities:       0,
        hospitalizations: 0,
        injuries:         0,
        accidents:        [],
        inspections:      [i],
        mshaViolations:   0,
        latestEvent:      i.open_date ?? "",
        sourceId:         `DOL-INSP-${i.activity_nr ?? crypto.randomUUID().slice(0, 8)}`,
      });
    }
  }

  return map;
}

// ── Contact upsert ────────────────────────────────────────────────────────────

async function upsertEmployerContact(
  employer: EmployerProfile,
  risk: RiskScore,
  subAccountId: number,
  vertical: "legal" | "insurance",
): Promise<void> {
  const sourceExternalId = `${employer.sourceId}:acct${subAccountId}`;
  const description = vertical === "legal"
    ? `OSHA ${risk.level} risk employer — ${risk.factors.join(", ")}`
    : `Commercial insurance prospect — OSHA risk score ${risk.total}/100 (${risk.level})`;

  await upsertContact({
    subAccountId,
    firstName:      employer.name,
    lastName:       "",
    company:        employer.name,
    address:        employer.address,
    city:           employer.city,
    state:          employer.state,
    zip:            employer.zip,
    source:         vertical === "legal" ? CONTACT_SOURCES.LEGAL : CONTACT_SOURCES.MANUAL,
    sourceExternalId,
    leadVertical:   vertical === "legal" ? "workers_comp" : "commercial_insurance",
    leadSubtype:    vertical === "legal" ? "osha_incident" : "osha_risk",
    tags:           [`osha-${risk.level.toLowerCase()}`, `risk-${risk.total}`, vertical],
    notes:          description,
    county:         employer.city,
  });
}

// ── Main poll ─────────────────────────────────────────────────────────────────

async function runDolSafetyPoll(): Promise<void> {
  if (!DOL_API_KEY) {
    console.warn("[DOL] DOL_API_KEY not set — skipping safety intelligence poll");
    return;
  }

  console.log(`[DOL] Starting safety intelligence poll — states: ${TARGET_STATES.join(", ")}`);

  // Fetch all sub-accounts to fan out signals
  const accounts = await db.select({ id: subAccounts.id, name: subAccounts.name }).from(subAccounts);
  if (!accounts.length) {
    console.warn("[DOL] No sub-accounts found — skipping");
    return;
  }

  let totalLegal     = 0;
  let totalInsurance = 0;

  for (const state of TARGET_STATES) {
    // Fetch OSHA accidents for state
    const accidents = await dolFetch<OshaAccident>("OSHA/accident", {
      site_state: state,
      limit: MAX_RESULTS,
    });

    // Fetch OSHA inspections for state
    const inspections = await dolFetch<OshaInspection>("OSHA/inspection", {
      site_state: state,
      limit: MAX_RESULTS,
    });

    // Fetch MSHA violations for state
    const mshaViolations = await dolFetch<MshaViolation>("MSHA/violations", {
      state_abbr: state,
      limit: MAX_RESULTS,
    });

    console.log(`[DOL] ${state}: ${accidents.length} OSHA accidents, ${inspections.length} inspections, ${mshaViolations.length} MSHA violations`);

    // Group into per-employer profiles
    const employers = groupByEmployer(accidents, inspections);

    // Add MSHA violation counts to matching employers
    for (const v of mshaViolations) {
      const k = `${(v.operator_name ?? "").toLowerCase().trim()}|${(v.state_abbr ?? "").toLowerCase().trim()}`;
      // Increment any matching employer in map
      for (const [key, emp] of employers.entries()) {
        if (v.operator_name && emp.name.toLowerCase().includes((v.operator_name ?? "").toLowerCase().split(" ")[0])) {
          emp.mshaViolations++;
        }
      }
    }

    // Score and route each employer
    for (const employer of employers.values()) {
      if (!employer.name || employer.name === "Unknown Employer") continue;

      const risk = scoreRisk({
        fatalities:       employer.fatalities,
        hospitalizations: employer.hospitalizations,
        injuries:         employer.injuries,
        accidentCount:    employer.accidents.length,
        inspectionCount:  employer.inspections.length,
        mshaViolations:   employer.mshaViolations,
      });

      // Route to all sub-accounts
      for (const account of accounts) {
        // Legal lead: fatalities or serious injuries
        if (risk.total >= RISK_LEGAL_THRESHOLD && (employer.fatalities > 0 || employer.hospitalizations > 0 || employer.injuries >= 2)) {
          await upsertEmployerContact(employer, risk, account.id, "legal");
          totalLegal++;
        }

        // Insurance lead: any elevated risk
        if (risk.total >= RISK_INSURANCE_THRESHOLD) {
          await upsertEmployerContact(employer, risk, account.id, "insurance");
          totalInsurance++;
        }
      }
    }
  }

  console.log(`[DOL] ✅ Poll complete — ${totalLegal} legal leads, ${totalInsurance} insurance leads created/updated`);
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function startDolSafetyPipeline(): void {
  if (!DOL_API_KEY) {
    console.warn("[DOL] DOL_API_KEY not configured — DOL Safety Intelligence pipeline disabled");
    return;
  }

  console.log(`[DOL] Safety Intelligence pipeline starting (${TARGET_STATES.join(", ")} | polling every 6h)`);

  // Initial run after 30s delay (let other services start first)
  setTimeout(() => {
    runDolSafetyPoll().catch(err =>
      console.error("[DOL] Initial poll failed:", err.message)
    );
  }, 30_000);

  // Recurring poll
  setInterval(() => {
    runDolSafetyPoll().catch(err =>
      console.error("[DOL] Poll failed:", err.message)
    );
  }, POLL_INTERVAL);
}
