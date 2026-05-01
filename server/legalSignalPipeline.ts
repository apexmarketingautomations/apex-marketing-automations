/**
 * legalSignalPipeline.ts
 *
 * Ingests high-value legal lead signals from Florida & federal public data.
 * Covers: Personal Injury, Criminal Defense, Family Law, Traffic, Workers Comp.
 *
 * All sources are 100% free public data:
 *   - Florida county arrest/booking APIs (Sunshine Law)
 *   - Florida Courts e-Portal (public case search)
 *   - OSHA workplace incidents (federal open data)
 *   - DHSMV license suspensions (FL public records)
 *   - FDA/CPSC product recalls (federal APIs)
 *   - FL courts divorce/family filings (public dockets)
 */

import crypto from "crypto";
import { db } from "./db";
import { legalSignals, legalLeads, legalAttorneys, legalLeadClaims } from "@shared/schema";
import { eq, and, lt } from "drizzle-orm";

// ── Constants ─────────────────────────────────────────────────────────────────

const PIPELINE_ID      = crypto.randomUUID().slice(0, 8);
const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes — legal leads are time sensitive
const CLAIM_WINDOW_MS  = 20 * 60 * 1000; // 20 minutes to claim

// Florida counties with open arrest/court APIs
const FL_COUNTIES = [
  { name: "BROWARD",      fips: "12011", arrestApi: "https://www.browardsheriff.org/api/inmates/recent" },
  { name: "MIAMI-DADE",   fips: "12086", arrestApi: "https://www.miamidade.gov/corrections/api/inmates" },
  { name: "HILLSBOROUGH", fips: "12057", arrestApi: "https://www.hcso.tampa.fl.us/api/arrests/recent" },
  { name: "ORANGE",       fips: "12095", arrestApi: "https://www.ocso.com/api/arrests" },
  { name: "PALM-BEACH",   fips: "12099", arrestApi: "https://www.pbso.org/api/arrests" },
  { name: "PINELLAS",     fips: "12103", arrestApi: "https://www.pcsoweb.com/api/arrests" },
  { name: "LEE",          fips: "12071", arrestApi: "https://www.leesheriff.org/api/arrests" },
  { name: "COLLIER",      fips: "12021", arrestApi: "https://www.colliersheriff.org/api/arrests" },
  { name: "SARASOTA",     fips: "12115", arrestApi: "https://www.sarasotasheriff.org/api/arrests" },
  { name: "MANATEE",      fips: "12081", arrestApi: "https://www.manateesheriff.com/api/arrests" },
  { name: "VOLUSIA",      fips: "12127", arrestApi: "https://vcso.us/api/arrests" },
  { name: "SEMINOLE",     fips: "12117", arrestApi: "https://www.seminolesheriff.org/api/arrests" },
];

// Charge types that signal PI attorney need
const PI_CHARGE_KEYWORDS = [
  "VEHICLE", "AUTO", "ACCIDENT", "DUI", "DWI", "RECKLESS", "NEGLIGENT",
  "SLIP", "FALL", "PREMISES", "ASSAULT", "BATTERY", "PRODUCT", "DEFECT",
  "MEDICAL", "MALPRACTICE", "WRONGFUL", "DEATH", "INJURY",
];

// Charge types that signal criminal defense need
const CRIMINAL_CHARGE_KEYWORDS = [
  "FELONY", "MISDEMEANOR", "BATTERY", "THEFT", "BURGLARY", "ROBBERY",
  "DRUG", "COCAINE", "MARIJUANA", "POSSESSION", "TRAFFICKING", "FRAUD",
  "FORGERY", "WEAPON", "FIREARM", "MURDER", "MANSLAUGHTER", "STALKING",
  "HARASSMENT", "TRESPASS", "VIOLATION", "PROBATION",
];

// DUI/Traffic specific
const TRAFFIC_CHARGE_KEYWORDS = [
  "DUI", "DWI", "DRUNK DRIVING", "TRAFFIC", "RECKLESS DRIVING",
  "LICENSE", "SUSPENDED", "REVOKED", "HIT AND RUN", "LEAVING SCENE",
  "SPEEDING", "RED LIGHT", "SIGNAL", "REGISTRATION",
];

// ── Types ─────────────────────────────────────────────────────────────────────

export type LegalVertical = "personal_injury" | "criminal" | "family" | "traffic" | "workers_comp";

export type LegalSignalType =
  | "arrest" | "dui_arrest" | "court_filing" | "divorce_filing"
  | "custody_filing" | "domestic_violence" | "probate_filing"
  | "osha_incident" | "dhsmv_suspension" | "fda_recall" | "cpsc_recall"
  | "civil_filing" | "injunction";

interface RawLegalSignal {
  signalType:       LegalSignalType;
  legalVertical:    LegalVertical;
  county:           string;
  subjectName?:     string;
  subjectAddress?:  string;
  subjectDob?:      string;
  chargeDescription?: string;
  caseNumber?:      string;
  courtName?:       string;
  filingDate?:      Date;
  urgency:          "critical" | "high" | "medium" | "low";
  sourceId:         string;
  rawData:          Record<string, unknown>;
  detectedAt:       Date;
}

interface PipelineStats {
  totalRuns:      number;
  totalSignals:   number;
  totalLeads:     number;
  totalDelivered: number;
  lastRunAt:      string | null;
  lastError:      string | null;
  byVertical:     Partial<Record<LegalVertical, number>>;
}

const stats: PipelineStats = {
  totalRuns: 0, totalSignals: 0, totalLeads: 0, totalDelivered: 0,
  lastRunAt: null, lastError: null, byVertical: {},
};

export function getLegalPipelineStats(): PipelineStats {
  return { ...stats };
}

// ── Dedup ─────────────────────────────────────────────────────────────────────

function buildSignalHash(s: RawLegalSignal): string {
  return crypto
    .createHash("sha256")
    .update(`${s.signalType}|${s.sourceId}|${s.county}`)
    .digest("hex").slice(0, 24).toUpperCase();
}

async function isDuplicate(hash: string): Promise<boolean> {
  const [row] = await db
    .select({ id: legalSignals.id })
    .from(legalSignals)
    .where(eq(legalSignals.sourceHash, hash))
    .limit(1);
  return !!row;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function safeFetch(url: string, timeoutMs = 12000): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "Accept": "application/json", "User-Agent": "ApexLegalPipeline/1.0" },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch (fetchErr: any) { // allow-silent-catch: network timeout returns null safely
    clearTimeout(t);
    return null;
  }
}

// ── Charge classification ─────────────────────────────────────────────────────

function classifyCharge(charge: string): { vertical: LegalVertical; urgency: "critical" | "high" | "medium" | "low" } {
  const u = (charge || "").toUpperCase();

  if (TRAFFIC_CHARGE_KEYWORDS.some(k => u.includes(k))) {
    const isDUI = u.includes("DUI") || u.includes("DWI") || u.includes("DRUNK");
    return { vertical: "traffic", urgency: isDUI ? "high" : "medium" };
  }

  if (PI_CHARGE_KEYWORDS.some(k => u.includes(k))) {
    const isSerious = u.includes("DEATH") || u.includes("MALPRACTICE") || u.includes("WRONGFUL");
    return { vertical: "personal_injury", urgency: isSerious ? "critical" : "high" };
  }

  if (CRIMINAL_CHARGE_KEYWORDS.some(k => u.includes(k))) {
    const isFelony = u.includes("FELONY") || u.includes("MURDER") || u.includes("TRAFFICKING");
    return { vertical: "criminal", urgency: isFelony ? "high" : "medium" };
  }

  if (u.includes("OSHA") || u.includes("WORKPLACE") || u.includes("WORKERS")) {
    return { vertical: "workers_comp", urgency: "high" };
  }

  return { vertical: "criminal", urgency: "low" };
}

// ── ARREST RECORDS — Florida County Booking APIs ──────────────────────────────
// Florida Sunshine Law makes all booking records public within 24h

async function fetchCountyArrests(county: typeof FL_COUNTIES[0]): Promise<RawLegalSignal[]> {
  const signals: RawLegalSignal[] = [];
  const since = new Date(Date.now() - 6 * 3600000).toISOString(); // last 6 hours

  // Try multiple endpoint patterns — counties vary
  const urls = [
    `${county.arrestApi}?since=${since}&limit=100`,
    `${county.arrestApi}?booked_after=${since}&limit=100`,
    `${county.arrestApi}?date_from=${since}`,
  ];

  for (const url of urls) {
    const data = await safeFetch(url);
    if (!data) continue;

    const arrests = Array.isArray(data) ? data : (data?.arrests ?? data?.inmates ?? data?.results ?? data?.data ?? []);
    if (!Array.isArray(arrests) || arrests.length === 0) continue;

    for (const a of arrests) {
      const charges = a.charges ?? a.charge_description ?? a.arrest_charge ?? a.offense ?? "";
      const chargeStr = Array.isArray(charges)
        ? charges.map((c: any) => c.description ?? c.charge ?? c).join(", ")
        : String(charges);

      if (!chargeStr || chargeStr.length < 3) continue;

      const { vertical, urgency } = classifyCharge(chargeStr);
      const signalType: LegalSignalType = chargeStr.toUpperCase().includes("DUI") ? "dui_arrest" : "arrest";

      signals.push({
        signalType,
        legalVertical: vertical,
        county: county.name,
        subjectName: [a.first_name ?? a.firstName, a.last_name ?? a.lastName].filter(Boolean).join(" ") || a.name || a.full_name,
        subjectAddress: a.address ?? a.home_address ?? a.street,
        subjectDob: a.dob ?? a.date_of_birth ?? a.birthdate,
        chargeDescription: chargeStr,
        caseNumber: a.case_number ?? a.arrest_number ?? a.booking_number ?? a.id,
        urgency,
        sourceId: `${county.name}-ARREST-${a.booking_number ?? a.id ?? a.arrest_id ?? crypto.randomUUID().slice(0, 8)}`,
        rawData: a,
        detectedAt: new Date(a.booking_date ?? a.arrest_date ?? a.booked_at ?? Date.now()),
      });
    }
    break; // stop after first successful URL
  }

  return signals;
}

// ── FLORIDA COURTS e-PORTAL — Divorce, Custody, Criminal Filings ──────────────
// myflcourtaccess.com is publicly accessible for civil/family court records

async function fetchFlCourtFilings(): Promise<RawLegalSignal[]> {
  const signals: RawLegalSignal[] = [];

  // Florida Courts public docket search API
  const endpoints = [
    {
      url: `https://myflcourtaccess.com/api/cases/recent?type=DR&days=1`, // DR = Domestic Relations
      signalType: "divorce_filing" as LegalSignalType,
      vertical: "family" as LegalVertical,
      urgency: "medium" as const,
      desc: (c: any) => `Divorce filing: ${c.case_number ?? c.case_id} — ${c.county ?? "FL"}`,
    },
    {
      url: `https://myflcourtaccess.com/api/cases/recent?type=JV&days=1`, // JV = Juvenile/Custody
      signalType: "custody_filing" as LegalSignalType,
      vertical: "family" as LegalVertical,
      urgency: "medium" as const,
      desc: (c: any) => `Custody filing: ${c.case_number ?? c.case_id}`,
    },
    {
      url: `https://myflcourtaccess.com/api/cases/recent?type=IJ&days=1`, // IJ = Injunction
      signalType: "injunction" as LegalSignalType,
      vertical: "family" as LegalVertical,
      urgency: "high" as const,
      desc: (c: any) => `Injunction/Restraining order: ${c.case_number ?? c.case_id}`,
    },
    {
      url: `https://myflcourtaccess.com/api/cases/recent?type=PR&days=2`, // PR = Probate
      signalType: "probate_filing" as LegalSignalType,
      vertical: "family" as LegalVertical,
      urgency: "medium" as const,
      desc: (c: any) => `Probate filing: ${c.case_number ?? c.case_id} — Est. value: ${c.estate_value ?? "Unknown"}`,
    },
  ];

  for (const ep of endpoints) {
    const data = await safeFetch(ep.url);
    if (!data) continue;
    const cases = Array.isArray(data) ? data : (data?.cases ?? data?.results ?? []);
    for (const c of cases.slice(0, 50)) {
      signals.push({
        signalType: ep.signalType,
        legalVertical: ep.vertical,
        county: c.county ?? "FL",
        subjectName: c.petitioner ?? c.plaintiff ?? c.party_name,
        caseNumber: c.case_number ?? c.case_id,
        courtName: c.court_name ?? c.division,
        filingDate: c.filing_date ? new Date(c.filing_date) : undefined,
        urgency: ep.urgency,
        sourceId: `FL-COURT-${ep.signalType.toUpperCase()}-${c.case_number ?? c.case_id ?? crypto.randomUUID().slice(0, 8)}`,
        rawData: c,
        detectedAt: new Date(c.filing_date ?? Date.now()),
        chargeDescription: ep.desc(c),
      });
    }
  }

  return signals;
}

// ── OSHA WORKPLACE INCIDENTS — Federal Free API ───────────────────────────────

async function fetchOshaIncidents(): Promise<RawLegalSignal[]> {
  const signals: RawLegalSignal[] = [];
  const year = new Date().getFullYear();

  // OSHA public inspection/incident API — completely free
  const data = await safeFetch(
    `https://data.dol.gov/get/osha_inspection/rows/100/startingAt/0?state=FL&year_started=${year}`,
    15000
  );

  if (!data) return signals;
  const incidents = Array.isArray(data) ? data : (data?.data ?? data?.results ?? []);

  for (const inc of incidents.slice(0, 50)) {
    if (!inc.estab_name && !inc.site_address) continue;
    signals.push({
      signalType: "osha_incident",
      legalVertical: "workers_comp",
      county: inc.county ?? "FL",
      subjectName: inc.estab_name,
      subjectAddress: [inc.site_address, inc.city, "FL"].filter(Boolean).join(", "),
      chargeDescription: `OSHA inspection: ${inc.nature_of_inj ?? inc.inspection_type ?? "Workplace incident"} at ${inc.estab_name}`,
      caseNumber: inc.activity_nr ?? inc.case_number,
      urgency: inc.fatalities > 0 ? "critical" : inc.hosp_cnt > 0 ? "high" : "medium",
      sourceId: `OSHA-FL-${inc.activity_nr ?? inc.id}`,
      rawData: inc,
      detectedAt: new Date(inc.close_conf_date ?? inc.open_date ?? Date.now()),
    });
  }

  return signals;
}

// ── FDA RECALLS — Federal Free API ───────────────────────────────────────────

async function fetchFdaRecalls(): Promise<RawLegalSignal[]> {
  const signals: RawLegalSignal[] = [];

  const data = await safeFetch(
    "https://api.fda.gov/food/enforcement.json?search=distribution_pattern:Florida&limit=20&sort=recall_initiation_date:desc",
    12000
  );

  if (!data?.results) return signals;

  for (const r of data.results.slice(0, 20)) {
    signals.push({
      signalType: "fda_recall",
      legalVertical: "personal_injury",
      county: "STATEWIDE",
      chargeDescription: `FDA Recall: ${r.product_description} — ${r.reason_for_recall}`,
      caseNumber: r.recall_number,
      urgency: r.classification === "Class I" ? "high" : "medium",
      sourceId: `FDA-RECALL-${r.recall_number}`,
      rawData: r,
      detectedAt: new Date(r.recall_initiation_date ?? Date.now()),
    });
  }

  return signals;
}

// ── CPSC RECALLS — Federal Free API ──────────────────────────────────────────

async function fetchCpscRecalls(): Promise<RawLegalSignal[]> {
  const signals: RawLegalSignal[] = [];

  const data = await safeFetch(
    "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=" +
    new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0],
    12000
  );

  if (!Array.isArray(data)) return signals;

  for (const r of data.slice(0, 20)) {
    signals.push({
      signalType: "cpsc_recall",
      legalVertical: "personal_injury",
      county: "STATEWIDE",
      chargeDescription: `CPSC Recall: ${r.Name ?? r.ProductName} — ${r.Hazard ?? r.Description}`,
      caseNumber: `CPSC-${r.RecallID ?? r.RecallNumber}`,
      urgency: r.Injuries > 0 ? "high" : "medium",
      sourceId: `CPSC-${r.RecallID ?? r.RecallNumber}`,
      rawData: r,
      detectedAt: new Date(r.RecallDate ?? Date.now()),
    });
  }

  return signals;
}

// ── DOMESTIC VIOLENCE INJUNCTIONS — FL Courts ─────────────────────────────────

async function fetchDomesticViolenceInjunctions(): Promise<RawLegalSignal[]> {
  const signals: RawLegalSignal[] = [];
  const since = new Date(Date.now() - 24 * 3600000).toISOString().split("T")[0];

  // Multiple FL county clerk APIs for DV injunctions
  const countyApis = [
    { county: "BROWARD",      url: `https://www.browardclerk.org/api/injunctions?filed_after=${since}&limit=50` },
    { county: "MIAMI-DADE",   url: `https://www.miamidadeclerk.gov/api/injunctions?date=${since}&limit=50` },
    { county: "HILLSBOROUGH", url: `https://www.hillsclerk.com/api/injunctions?after=${since}&limit=50` },
    { county: "PALM-BEACH",   url: `https://www.mypalmbeachclerk.com/api/injunctions?from=${since}&limit=50` },
    { county: "ORANGE",       url: `https://www.myorangeclerk.com/api/injunctions?date=${since}&limit=50` },
  ];

  for (const api of countyApis) {
    const data = await safeFetch(api.url);
    if (!data) continue;
    const items = Array.isArray(data) ? data : (data?.injunctions ?? data?.cases ?? data?.results ?? []);
    for (const item of items.slice(0, 20)) {
      signals.push({
        signalType: "domestic_violence",
        legalVertical: "family",
        county: api.county,
        subjectName: item.petitioner ?? item.respondent ?? item.plaintiff,
        caseNumber: item.case_number ?? item.case_id,
        courtName: item.court ?? `${api.county} County Court`,
        chargeDescription: `DV Injunction filed — ${api.county} County. Case: ${item.case_number ?? "pending"}`,
        urgency: "high",
        sourceId: `${api.county}-DV-${item.case_number ?? item.id ?? crypto.randomUUID().slice(0, 8)}`,
        rawData: item,
        detectedAt: new Date(item.filing_date ?? item.filed_date ?? Date.now()),
      });
    }
  }

  return signals;
}

// ── SCORING ───────────────────────────────────────────────────────────────────

function scoreLegalLead(signal: RawLegalSignal): { score: number; qualifies: boolean; expiresAt: Date } {
  let score = 40;

  if (signal.urgency === "critical") score += 30;
  else if (signal.urgency === "high") score += 20;
  else if (signal.urgency === "medium") score += 10;

  if (signal.subjectName && signal.subjectName.length > 3) score += 15;
  if (signal.subjectAddress) score += 10;
  if (signal.caseNumber) score += 5;

  if (signal.legalVertical === "criminal") score += 5;
  if (signal.legalVertical === "personal_injury") score += 10;
  if (signal.signalType === "dui_arrest") score += 15;
  if (signal.signalType === "domestic_violence") score += 10;

  const claimHours =
    signal.urgency === "critical" ? 2 :
    signal.urgency === "high" ? 4 : 12;

  return {
    score: Math.min(score, 100),
    qualifies: score >= 50,
    expiresAt: new Date(Date.now() + claimHours * 3600000),
  };
}

// ── DELIVERY — SMS to registered attorneys ────────────────────────────────────

async function deliverToAttorneys(lead: any, subAccountId: number): Promise<number> {
  try {
    const attorneys = await db
      .select()
      .from(legalAttorneys)
      .where(and(eq(legalAttorneys.active, true)));

    const eligible = attorneys.filter((a: any) => {
      const verticals = a.legalVerticals as string[] ?? [];
      const counties  = a.counties as string[] ?? [];
      const verticalMatch = verticals.length === 0 || verticals.includes(lead.legalVertical);
      const countyMatch = counties.length === 0 || counties.includes(lead.county) || lead.county === "STATEWIDE";
      return verticalMatch && countyMatch;
    });

    if (eligible.length === 0) return 0;

    const { sendSms } = await import("./twilioClient");
    let delivered = 0;

    for (const attorney of eligible.slice(0, 3)) {
      try {
        const verticalLabel: Record<string, string> = {
          criminal: "Criminal Defense",
          family: "Family Law",
          traffic: "Traffic/DUI",
          personal_injury: "Personal Injury",
          workers_comp: "Workers Comp",
        };

        const body = [
          `⚖️ APEX LEGAL LEAD — ${verticalLabel[lead.legalVertical] ?? lead.legalVertical.toUpperCase()}`,
          `Type: ${lead.signalType.replace(/_/g, " ").toUpperCase()}`,
          lead.subjectName ? `Subject: ${lead.subjectName}` : null,
          lead.county !== "STATEWIDE" ? `County: ${lead.county}` : "Statewide FL",
          lead.chargeDescription ? `Details: ${lead.chargeDescription.slice(0, 100)}` : null,
          lead.caseNumber ? `Case: ${lead.caseNumber}` : null,
          `Score: ${lead.score}/100 | Urgency: ${lead.urgency.toUpperCase()}`,
          `View in Apex: https://apexmarketingautomations.com/sentinel`,
        ].filter(Boolean).join("\n");

        await sendSms({ to: attorney.phone, body });

        await db.insert(legalLeadClaims).values({
          leadId: lead.id,
          attorneyId: attorney.id,
          status: "notified",
        });

        delivered++;
      } catch (err: any) {
        console.error(`[LEGAL-PIPELINE] SMS to attorney ${attorney.id} failed:`, err.message);
      }
    }

    return delivered;
  } catch (err: any) {
    console.error("[LEGAL-PIPELINE] Delivery error:", err.message);
    return 0;
  }
}

// ── MAIN PIPELINE CYCLE ───────────────────────────────────────────────────────

async function runLegalCycle(subAccountId: number): Promise<void> {
  const runId   = crypto.randomUUID().slice(0, 8);
  const startMs = Date.now();
  console.log(`[LEGAL-PIPELINE] ── CYCLE START id=${runId} ──`);
  stats.totalRuns++;
  stats.lastRunAt = new Date().toISOString();

  // Run all fetchers in parallel, never fail the whole cycle
  const results = await Promise.allSettled([
    ...FL_COUNTIES.map(c => fetchCountyArrests(c)),
    fetchFlCourtFilings(),
    fetchOshaIncidents(),
    fetchFdaRecalls(),
    fetchCpscRecalls(),
    fetchDomesticViolenceInjunctions(),
  ]);

  const allSignals: RawLegalSignal[] = results
    .flatMap(r => r.status === "fulfilled" ? r.value : []);

  console.log(`[LEGAL-PIPELINE] ${allSignals.length} raw signals in ${Date.now() - startMs}ms`);

  let inserted = 0, dupes = 0, qualified = 0, delivered = 0;

  for (const signal of allSignals) {
    try {
      const hash = buildSignalHash(signal);
      if (await isDuplicate(hash)) { dupes++; continue; }

      const [saved] = await db.insert(legalSignals).values({
        sourceHash:        hash,
        signalType:        signal.signalType,
        legalVertical:     signal.legalVertical,
        county:            signal.county,
        subjectName:       signal.subjectName,
        subjectAddress:    signal.subjectAddress,
        subjectDob:        signal.subjectDob,
        chargeDescription: signal.chargeDescription,
        caseNumber:        signal.caseNumber,
        courtName:         signal.courtName,
        filingDate:        signal.filingDate,
        urgency:           signal.urgency,
        status:            "raw",
        rawData:           signal.rawData,
        detectedAt:        signal.detectedAt,
      }).returning();

      inserted++;
      stats.byVertical[signal.legalVertical] = (stats.byVertical[signal.legalVertical] ?? 0) + 1;

      const { score, qualifies, expiresAt } = scoreLegalLead(signal);

      if (!qualifies) {
        await db.update(legalSignals).set({ status: "disqualified", score }).where(eq(legalSignals.id, saved.id));
        continue;
      }

      qualified++;

      const [lead] = await db.insert(legalLeads).values({
        signalId:          saved.id,
        legalVertical:     signal.legalVertical,
        signalType:        signal.signalType,
        county:            signal.county,
        subjectName:       signal.subjectName,
        subjectAddress:    signal.subjectAddress,
        chargeDescription: signal.chargeDescription,
        caseNumber:        signal.caseNumber,
        urgency:           signal.urgency,
        score,
        status:            "available",
        expiresAt,
        rawData:           signal.rawData,
        detectedAt:        signal.detectedAt,
      }).returning();

      await db.update(legalSignals)
        .set({ status: "qualified", score, leadId: lead.id })
        .where(eq(legalSignals.id, saved.id));

      const cnt = await deliverToAttorneys(lead, subAccountId);
      if (cnt > 0) delivered++;
      stats.totalLeads++;

    } catch (err: any) {
      console.error(`[LEGAL-PIPELINE] Signal error:`, err.message);
    }
  }

  stats.totalSignals   += allSignals.length;
  stats.totalDelivered += delivered;

  console.log(
    `[LEGAL-PIPELINE] ── CYCLE END id=${runId} ──\n` +
    `  signals=${allSignals.length} inserted=${inserted} dupes=${dupes} ` +
    `qualified=${qualified} delivered=${delivered} ms=${Date.now() - startMs}`
  );
}

// ── START / STOP ──────────────────────────────────────────────────────────────

let running  = false;
let interval: ReturnType<typeof setInterval> | null = null;

export function startLegalPipeline(subAccountId = 1): void {
  if (running) { console.log("[LEGAL-PIPELINE] Already running"); return; }
  running = true;
  console.log(`[LEGAL-PIPELINE] Started (id=${PIPELINE_ID}) — polling every ${POLL_INTERVAL_MS / 60000}min`);
  const tick = async () => {
    try { await runLegalCycle(subAccountId); }
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
