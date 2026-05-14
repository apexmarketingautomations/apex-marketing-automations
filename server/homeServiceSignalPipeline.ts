/**
 * homeServiceSignalPipeline.ts
 *
 * Ingests high-value home service lead signals from Florida public data.
 * Every significant event is reported to Apex Intelligence so it can learn,
 * adapt, and scale — which signal types convert, which counties produce value,
 * which sources are worth expanding.
 *
 * Apex emission points (fire-and-forget, cannot crash the pipeline):
 *   → signal_detected    raw signal found and inserted
 *   → lead_qualified     signal passed scoring, becomes a contractor lead
 *   → lead_disqualified  signal failed scoring threshold
 *   → cycle_complete     end of each 30-min run with full stats
 */

import crypto from "crypto";
import { db } from "./db";
import { homeServiceLeads, homeServiceSignals } from "@shared/schema";
import { eq } from "drizzle-orm";
import { scoreHomeServiceLead } from "./homeServiceLeadScorer";
import { deliverLeadToContractors } from "./homeServiceLeadDelivery";

// ── Constants ─────────────────────────────────────────────────────────────────

const PIPELINE_ID      = crypto.randomUUID().slice(0, 8);
const POLL_INTERVAL_MS = 30 * 60 * 1000;

const FL_COUNTIES_CORE = [
  { name: "LEE",          zone: "FLZ043" },
  { name: "COLLIER",      zone: "FLZ048" },
  { name: "CHARLOTTE",    zone: "FLZ042" },
  { name: "SARASOTA",     zone: "FLZ041" },
  { name: "MANATEE",      zone: "FLZ040" },
  { name: "HILLSBOROUGH", zone: "FLZ039" },
  { name: "PINELLAS",     zone: "FLZ038" },
  { name: "PASCO",        zone: "FLZ037" },
  { name: "ORANGE",       zone: "FLZ052" },
  { name: "SEMINOLE",     zone: "FLZ053" },
  { name: "BROWARD",      zone: "FLZ056" },
  { name: "MIAMI-DADE",   zone: "FLZ068" },
  { name: "PALM-BEACH",   zone: "FLZ055" },
  { name: "DUVAL",        zone: "FLZ025" },
  { name: "VOLUSIA",      zone: "FLZ046" },
];

const HIGH_VALUE_ALERT_TYPES = new Set([
  "Tornado Warning", "Tornado Watch", "Severe Thunderstorm Warning",
  "Hurricane Warning", "Hurricane Watch", "Tropical Storm Warning",
  "Flood Warning", "Flash Flood Warning", "Wind Advisory",
  "High Wind Warning", "Storm Surge Warning", "Storm Surge Watch",
]);

const HIGH_VALUE_PERMIT_TYPES = new Set([
  // Roofing & Structure
  "ROOFING", "ROOF", "SHINGLE", "TILE ROOF", "METAL ROOF",
  // HVAC & Mechanical
  "HVAC", "AIR CONDITIONING", "MECHANICAL", "HEATING", "COOLING", "DUCTWORK",
  // Pool & Water
  "POOL", "SWIMMING POOL", "SPA", "HOT TUB", "FOUNTAIN",
  // Solar & Power
  "SOLAR", "PHOTOVOLTAIC", "PV SYSTEM", "GENERATOR", "BATTERY STORAGE",
  // Electrical
  "ELECTRICAL", "EV CHARGER", "PANEL UPGRADE",
  // Plumbing
  "PLUMBING", "WATER HEATER", "SEWER", "IRRIGATION",
  // Landscaping & Lawn
  "LANDSCAPING", "IRRIGATION SYSTEM", "SOD", "LAWN", "SPRINKLER",
  // Painting & Exterior
  "PAINTING", "EXTERIOR PAINT", "PRESSURE WASHING",
  // Additions & Remodel
  "ADDITION", "RENOVATION", "REMODEL", "FOUNDATION", "SEAWALL", "DOCK",
  // Pest Control (structural)
  "FUMIGATION", "TERMITE", "PEST",
  // Cleaning & Services
  "PRESSURE WASH",
  // Auto
  "GARAGE", "CARPORT", "DRIVEWAY",
]);

// Business niches for new business license signals
const HIGH_VALUE_BUSINESS_TYPES = new Set([
  // Beauty & Personal Care
  "HAIR SALON", "BARBERSHOP", "BARBER", "NAIL SALON", "SPA", "BEAUTY",
  "COSMETOLOGY", "MASSAGE", "ESTHETICS", "LASH", "BROW",
  // Pool & Lawn
  "POOL SERVICE", "POOL CLEANING", "POOL MAINTENANCE",
  "LAWN CARE", "LANDSCAPING", "LAWN MAINTENANCE", "TREE SERVICE",
  // Cleaning
  "CLEANING SERVICE", "MAID SERVICE", "JANITORIAL", "PRESSURE WASHING",
  // Auto
  "AUTO DETAILING", "CAR WASH", "AUTO REPAIR", "MOBILE DETAILING",
  // Solar
  "SOLAR INSTALLATION", "SOLAR PANEL",
  // Pest
  "PEST CONTROL", "EXTERMINATOR",
  // HVAC
  "HVAC SERVICE", "AIR CONDITIONING SERVICE",
  // General Home
  "HANDYMAN", "HOME REPAIR", "HOME IMPROVEMENT",
]);

// ── Types ─────────────────────────────────────────────────────────────────────

export type SignalType =
  // Home & Property
  | "noaa_weather_alert" | "permit_filing"     | "new_homeowner"
  | "code_enforcement"   | "pre_foreclosure"   | "lis_pendens"
  | "probate"            | "short_term_rental"  | "sinkhole_report"
  | "flood_zone_change"  | "business_license"
  // Legal — Personal Injury
  | "crash_report"       | "osha_incident"     | "fda_recall"
  | "cpsc_recall"        | "slip_fall_report"
  // Legal — Criminal Defense
  | "arrest_record"      | "dui_arrest"        | "booking_log"
  // Legal — Family Law
  | "divorce_filing"     | "domestic_violence_injunction" | "custody_modification"
  | "probate_filing"
  // Legal — Traffic
  | "license_suspension" | "red_light_violation" | "commercial_violation"
  // Business Signals
  | "new_business_filing" | "salon_license"    | "contractor_license";

export type ServiceCategory =
  // Home Services
  | "roofing"        | "hvac"            | "water_damage"      | "pool"
  | "solar"          | "foundation"      | "general_contractor" | "electrical"
  | "plumbing"       | "landscaping"     | "painting"           | "lawn_care"
  | "pest_control"   | "pressure_washing"| "auto_detailing"     | "cleaning_service"
  | "pool_service"   | "tree_service"    | "fence_repair"       | "drywall"
  | "flooring"       | "windows"         | "gutters"            | "generator"
  // Legal Services
  | "personal_injury"| "criminal_defense"| "family_law"         | "traffic_law"
  | "workers_comp"   | "medical_malpractice" | "dui_defense"    | "divorce_attorney"
  // Business Services
  | "hair_salon"     | "barbershop"      | "nail_salon"         | "spa"
  | "restaurant"     | "retail"          | "gym"                | "daycare";

export interface RawSignal {
  signalType:        SignalType;
  sourceId:          string;
  county:            string;
  address?:          string;
  lat?:              number;
  lng?:              number;
  propertyValue?:    number;
  ownerName?:        string;
  ownerPhone?:       string;
  squareFootage?:    number;
  yearBuilt?:        number;
  serviceCategories: ServiceCategory[];
  urgency:           "critical" | "high" | "medium" | "low";
  description:       string;
  rawData:           Record<string, unknown>;
  detectedAt:        Date;
}

// ── Pipeline stats ────────────────────────────────────────────────────────────

interface PipelineStats {
  totalRuns:      number;
  totalSignals:   number;
  totalLeads:     number;
  totalDelivered: number;
  lastRunAt:      string | null;
  lastError:      string | null;
  signalsByType:  Partial<Record<SignalType, number>>;
}

const stats: PipelineStats = {
  totalRuns: 0, totalSignals: 0, totalLeads: 0, totalDelivered: 0,
  lastRunAt: null, lastError: null, signalsByType: {},
};

export function getHomeServicePipelineStats(): PipelineStats {
  return { ...stats };
}

// ── Apex Intelligence hook ─────────────────────────────────────────────────────
// Identical pattern to crashIngestPipeline.ts — fire-and-forget, never throws.

function apexReport(params: {
  action:       string;
  subject:      string;
  result:       string;
  confidence:   number;
  subAccountId: number;
  metadata:     Record<string, unknown>;
}): void {
  import("./operator/apexIntelligence")
    .then(({ reportOutcome }) =>
      reportOutcome({
        agentName:    "home-service-pipeline",
        niche:        "home_services",
        action:       params.action,
        subject:      params.subject,
        result:       params.result,
        confidence:   params.confidence,
        subAccountId: params.subAccountId,
        metadata:     params.metadata,
      }),
    )
    .catch((err) => console.warn("[HOMESERVICESIGNALPIPELINE] promise rejected:", err instanceof Error ? err.message : err));
}

// ── Dedup ─────────────────────────────────────────────────────────────────────

function buildSignalHash(signal: RawSignal): string {
  return crypto
    .createHash("sha256")
    .update(`${signal.signalType}|${signal.sourceId}|${signal.county}`)
    .digest("hex").slice(0, 24).toUpperCase();
}

async function isDuplicate(hash: string): Promise<boolean> {
  const [row] = await db
    .select({ id: homeServiceSignals.id })
    .from(homeServiceSignals)
    .where(eq(homeServiceSignals.sourceHash, hash))
    .limit(1);
  return !!row;
}

// ── NOAA NWS ──────────────────────────────────────────────────────────────────

async function fetchNoaaAlerts(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  for (const county of FL_COUNTIES_CORE) {
    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 10_000);
      const res        = await fetch(
        `https://api.weather.gov/alerts/active?zone=${county.zone}`,
        { headers: { "Accept": "application/geo+json", "User-Agent": "ApexHomeServicePipeline/1.0" }, signal: controller.signal },
      );
      clearTimeout(timeout);
      if (!res.ok) continue;

      const features = (await res.json())?.features ?? [];
      for (const f of features) {
        const props = f?.properties ?? {};
        if (!HIGH_VALUE_ALERT_TYPES.has(props.event)) continue;
        const urgency = props.severity?.toLowerCase() === "extreme" || props.event.includes("Warning") ? "critical" : "high";
        signals.push({
          signalType:        "noaa_weather_alert",
          sourceId:          props.id ?? f.id ?? crypto.randomUUID(),
          county:            county.name,
          lat:               f.geometry?.coordinates?.[1] ?? undefined,
          lng:               f.geometry?.coordinates?.[0] ?? undefined,
          serviceCategories: resolveWeatherCategories(props.event),
          urgency,
          description:       `${props.event} — ${props.headline ?? "See NWS"}`,
          rawData:           props,
          detectedAt:        new Date(props.sent ?? Date.now()),
        });
      }
    } catch (err: any) {
      console.error(`[HS-PIPELINE] NOAA ${county.name}: ${err.message}`);
    }
  }
  return signals;
}

function resolveWeatherCategories(e: string): ServiceCategory[] {
  const t = e.toLowerCase();
  if (t.includes("hurricane") || t.includes("tropical") || t.includes("wind")) return ["roofing", "general_contractor", "water_damage"];
  if (t.includes("flood"))  return ["water_damage", "general_contractor", "foundation"];
  return ["roofing", "general_contractor", "electrical"];
}

// ── County permit filings ─────────────────────────────────────────────────────

async function fetchPermits(county: string, url: string, map: (p: any) => RawSignal | null): Promise<RawSignal[]> {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 15_000);
    const res        = await fetch(url, { signal: controller.signal, headers: { "Accept": "application/json" } });
    clearTimeout(timeout);
    if (!res.ok) { console.warn(`[HS-PIPELINE] ${county} permits: HTTP ${res.status}`); return []; }
    const data = await res.json() as any;
    const list = Array.isArray(data) ? data : (data?.permits ?? data?.results ?? data?.data ?? []);
    return list.map(map).filter((s: any): s is RawSignal => s !== null);
  } catch (err: any) {
    console.error(`[HS-PIPELINE] ${county} permits: ${err.message}`);
    return [];
  }
}

function isHVP(type: string): boolean {
  const u = type.toUpperCase();
  return [...HIGH_VALUE_PERMIT_TYPES].some(k => u.includes(k));
}

function permCats(type: string): ServiceCategory[] {
  const u = type.toUpperCase();
  if (u.includes("ROOF") || u.includes("SHINGLE") || u.includes("TILE ROOF"))           return ["roofing"];
  if (u.includes("HVAC") || u.includes("AIR") || u.includes("MECHANICAL") || u.includes("COOLING")) return ["hvac"];
  if (u.includes("POOL") || u.includes("SPA") || u.includes("HOT TUB"))                 return ["pool", "pool_service"];
  if (u.includes("SOLAR") || u.includes("PHOTOVOLTAIC") || u.includes("PV"))            return ["solar"];
  if (u.includes("ELECTRIC") || u.includes("EV CHARGER"))                               return ["electrical"];
  if (u.includes("PLUMB") || u.includes("WATER HEATER") || u.includes("SEWER"))        return ["plumbing"];
  if (u.includes("FOUNDATION") || u.includes("SEAWALL"))                                return ["foundation"];
  if (u.includes("LANDSCAP") || u.includes("IRRIGATION") || u.includes("SOD") || u.includes("LAWN")) return ["landscaping", "lawn_care"];
  if (u.includes("PAINT") || u.includes("EXTERIOR PAINT"))                              return ["painting"];
  if (u.includes("PRESSURE") || u.includes("WASH"))                                     return ["pressure_washing"];
  if (u.includes("PEST") || u.includes("TERMITE") || u.includes("FUMIG"))               return ["pest_control"];
  if (u.includes("GARAGE") || u.includes("CARPORT"))                                    return ["general_contractor"];
  return ["general_contractor"];
}

// Business license category resolver
function bizCats(type: string): ServiceCategory[] {
  const u = type.toUpperCase();
  if (u.includes("HAIR") || u.includes("SALON") || u.includes("COSMETOL"))             return ["hair_salon"];
  if (u.includes("BARBER"))                                                             return ["barbershop"];
  if (u.includes("NAIL"))                                                               return ["nail_salon"];
  if (u.includes("POOL"))                                                               return ["pool_service"];
  if (u.includes("LAWN") || u.includes("LANDSCAP") || u.includes("TREE"))              return ["lawn_care", "landscaping"];
  if (u.includes("CLEAN") || u.includes("MAID") || u.includes("JANITORIAL"))           return ["cleaning_service"];
  if (u.includes("PRESSURE") || u.includes("WASH"))                                    return ["pressure_washing"];
  if (u.includes("DETAIL") || u.includes("AUTO") || u.includes("CAR WASH"))            return ["auto_detailing"];
  if (u.includes("SOLAR"))                                                              return ["solar"];
  if (u.includes("PEST") || u.includes("EXTERMINATOR"))                                return ["pest_control"];
  if (u.includes("HVAC") || u.includes("AIR CONDITION"))                               return ["hvac"];
  if (u.includes("HANDYMAN") || u.includes("HOME REPAIR"))                             return ["general_contractor"];
  return ["general_contractor"];
}

async function fetchLeePermits():      Promise<RawSignal[]> {
  const since = new Date(Date.now() - 86400000).toISOString();
  return fetchPermits("LEE",
    `https://opendata.leegov.com/resource/permits.json?$where=application_date>'${since}'&$limit=200`,
    p => !isHVP(p.permit_type ?? p.work_type ?? "") ? null : ({
      signalType: "permit_filing", sourceId: `LEE-PERMIT-${p.permit_number ?? p.id}`,
      county: "LEE", address: [p.address, p.city, "FL"].filter(Boolean).join(", "),
      lat: p.latitude ? parseFloat(p.latitude) : undefined,
      lng: p.longitude ? parseFloat(p.longitude) : undefined,
      propertyValue: p.job_value ? parseFloat(p.job_value) : undefined,
      serviceCategories: permCats(p.permit_type ?? p.work_type ?? ""),
      urgency: "medium", description: `Permit: ${p.permit_type ?? p.work_type} at ${p.address}`,
      rawData: p, detectedAt: new Date(p.application_date ?? Date.now()),
    }),
  );
}

async function fetchCollierPermits():  Promise<RawSignal[]> {
  const since = new Date(Date.now() - 86400000).toISOString();
  return fetchPermits("COLLIER",
    `https://www.colliercountyfl.gov/api/permits?issued_after=${since}&limit=200`,
    p => !isHVP(p.type ?? p.description ?? "") ? null : ({
      signalType: "permit_filing", sourceId: `COLLIER-PERMIT-${p.permit_number ?? p.id}`,
      county: "COLLIER", address: p.site_address ?? p.address,
      lat: p.lat ? parseFloat(p.lat) : undefined,
      lng: p.lng ? parseFloat(p.lng) : undefined,
      propertyValue: p.estimated_value ? parseFloat(p.estimated_value) : undefined,
      serviceCategories: permCats(p.type ?? p.description ?? ""),
      urgency: "medium", description: `Permit: ${p.type ?? p.description} at ${p.site_address}`,
      rawData: p, detectedAt: new Date(p.application_date ?? p.issued_date ?? Date.now()),
    }),
  );
}

async function fetchCharlottePermits(): Promise<RawSignal[]> {
  const since = new Date(Date.now() - 86400000).toISOString();
  return fetchPermits("CHARLOTTE",
    `https://www.charlottecountyfl.gov/api/community-development/permits?after=${since}&limit=200`,
    p => !isHVP(p.permit_type ?? p.work_description ?? "") ? null : ({
      signalType: "permit_filing", sourceId: `CHARLOTTE-PERMIT-${p.permit_no ?? p.id}`,
      county: "CHARLOTTE", address: p.job_address ?? p.address,
      lat: p.latitude ? parseFloat(p.latitude) : undefined,
      lng: p.longitude ? parseFloat(p.longitude) : undefined,
      propertyValue: p.valuation ? parseFloat(p.valuation) : undefined,
      serviceCategories: permCats(p.permit_type ?? p.work_description ?? ""),
      urgency: "medium", description: `Permit: ${p.permit_type ?? p.work_description} at ${p.job_address}`,
      rawData: p, detectedAt: new Date(p.applied_date ?? Date.now()),
    }),
  );
}

// ── Code enforcement ──────────────────────────────────────────────────────────

async function fetchCodeEnforcement(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  const since = daysAgo(7);
  const urls: Record<string, string> = {
    LEE:       `https://opendata.leegov.com/resource/code-enforcement.json?$where=open_date>'${since}'&$limit=200`,
    COLLIER:   `https://www.colliercountyfl.gov/api/code-enforcement?filed_after=${since}&limit=200`,
    CHARLOTTE: `https://www.charlottecountyfl.gov/api/code-enforcement?after=${since}&limit=200`,
  };

  for (const county of FL_COUNTIES_CORE) {
    const url = urls[county.name];
    if (!url) continue;
    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 15_000);
      const res        = await fetch(url, { signal: controller.signal, headers: { "Accept": "application/json" } });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data  = await res.json() as any;
      const items = Array.isArray(data) ? data : (data?.data ?? []);
      for (const v of items) {
        const cat = resolveCodeCategory(v.violation_type ?? v.description ?? "");
        if (!cat) continue;
        signals.push({
          signalType: "code_enforcement",
          sourceId:   `${county.name}-CODE-${v.case_number ?? v.id}`,
          county:     county.name,
          address:    v.address ?? v.site_address,
          lat:        v.latitude  ? parseFloat(v.latitude)  : undefined,
          lng:        v.longitude ? parseFloat(v.longitude) : undefined,
          serviceCategories: [cat],
          urgency:    "high",
          description: `Code violation: ${v.violation_type ?? v.description} at ${v.address ?? "unknown"}`,
          rawData:    v,
          detectedAt: new Date(v.open_date ?? v.filed_date ?? Date.now()),
        });
      }
    } catch (err: any) {
      console.error(`[HS-PIPELINE] Code enforcement ${county.name}: ${err.message}`);
    }
  }
  return signals;
}

function resolveCodeCategory(d: string): ServiceCategory | null {
  const u = d.toUpperCase();
  if (u.includes("ROOF") || u.includes("STRUCTURE"))   return "roofing";
  if (u.includes("HVAC") || u.includes("AIR"))         return "hvac";
  if (u.includes("POOL") || u.includes("BARRIER"))     return "pool";
  if (u.includes("VEGETATION") || u.includes("GRASS")) return "landscaping";
  if (u.includes("PAINT") || u.includes("EXTERIOR"))   return "painting";
  if (u.includes("ELECTRIC"))                          return "electrical";
  if (u.includes("PLUMB") || u.includes("SEWER"))      return "plumbing";
  if (u.includes("FENCE") || u.includes("WALL") || u.includes("FOUNDATION")) return "general_contractor";
  return null;
}

// ── Florida Business License Filings — New Business Signals ──────────────────
// Sunbiz.org (FL Secretary of State) publishes new business registrations daily

async function fetchFlBusinessLicenses(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  const since = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  // Florida Division of Corporations API — free public data
  const urls = [
    `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults?inquiryType=EntityName&searchTerm=&dateFrom=${since}&dateTo=${new Date().toISOString().split("T")[0]}&pageNumber=1`,
  ];

  // Also check county BTR (Business Tax Receipt) new registrations
  const countyBtrApis = [
    { county: "BROWARD",      url: `https://www.broward.org/Records/BusinessTax/api/new?after=${since}&limit=100` },
    { county: "MIAMI-DADE",   url: `https://www.miamidade.gov/btr/api/new?filed_after=${since}&limit=100` },
    { county: "PALM-BEACH",   url: `https://www.pbcgov.org/btr/api/registrations?from=${since}&limit=100` },
    { county: "HILLSBOROUGH", url: `https://www.hillsboroughcounty.org/btr/api/new?date=${since}&limit=100` },
    { county: "ORANGE",       url: `https://www.ocfl.net/btr/api/new?after=${since}&limit=100` },
    { county: "PINELLAS",     url: `https://www.pinellascounty.org/btr/api/new?from=${since}&limit=100` },
    { county: "LEE",          url: `https://www.leegov.com/btr/api/registrations?after=${since}&limit=100` },
    { county: "COLLIER",      url: `https://www.colliercountyfl.gov/btr/api/new?from=${since}&limit=100` },
  ];

  for (const api of countyBtrApis) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(api.url, { signal: controller.signal, headers: { "Accept": "application/json" } });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json() as any;
      const businesses = Array.isArray(data) ? data : (data?.businesses ?? data?.results ?? data?.data ?? []);
      for (const biz of businesses) {
        const bizType = biz.business_type ?? biz.type ?? biz.category ?? biz.description ?? "";
        if (!bizType) continue;
        const u = bizType.toUpperCase();
        const isHighValue = [...HIGH_VALUE_BUSINESS_TYPES].some(k => u.includes(k));
        if (!isHighValue) continue;
        const cats = bizCats(bizType);
        signals.push({
          signalType: "permit_filing" as SignalType,
          sourceId: `${api.county}-BTR-${biz.license_number ?? biz.id ?? biz.receipt_number}`,
          county: api.county,
          address: [biz.address, biz.city, "FL"].filter(Boolean).join(", "),
          serviceCategories: cats,
          urgency: "medium",
          description: `New business: ${biz.business_name ?? bizType} (${bizType}) — ${api.county} County`,
          rawData: biz,
          detectedAt: new Date(biz.registration_date ?? biz.filed_date ?? Date.now()),
        });
      }
    } catch (err: any) {
      console.error(`[HS-PIPELINE] BTR ${api.county}: ${err.message}`);
    }
  }

  return signals;
}

// ── Main pipeline cycle ───────────────────────────────────────────────────────


// ── Legal: FL Arrests — delegated to jailBookingPipeline (Nimble, all 11 FL counties) ──
// These county clerk API URLs are dead. Arrest data now flows through jailBookingPipeline.ts
// which runs every 60 min via Nimble agents covering all 11 SW/Central FL counties.

async function fetchFloridaArrests(): Promise<RawSignal[]> {
  return []; // handled by jailBookingPipeline
}

// ── Legal: Court Filings — delegated to dedicated pipelines ──────────────────
// Florida court filing data flows through two separate pipelines:
//
//   hillsboroughCourtFilingsPipeline.ts — consumes FREE daily CSVs from
//     publicrec.hillsclerk.com (DailyNewCaseFilings + Probate/dailyfilings).
//     Covers: divorce, custody, DV injunctions, probate, mortgage foreclosure
//     in Hillsborough County. Runs daily at 07:00 ET.
//
//   courtFilingPipeline.ts — Nimble agent scraper for remaining FL county
//     clerk portals (leeclerk.org, collierclerk.com, etc.) where no bulk
//     API exists. Runs every 6 hours.
//
// Both pipelines write directly to legalSignals + legalLeads + CRM contacts.
// This function returns [] — no signals are generated here.

async function fetchFloridaCourtFilings(): Promise<RawSignal[]> {
  return []; // handled by hillsboroughCourtFilingsPipeline.ts + courtFilingPipeline.ts
}

// ── Legal: OSHA Workplace Incidents ──────────────────────────────────────────

async function fetchOshaIncidents(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const year = new Date().getFullYear();
    const res = await fetch(
      "https://data.osha.gov/api/1.0/oshainspection/?state_plan=FL&open_date_start=" + year + "-01-01&inspection_type=G&limit=100",
      { headers: { "Accept": "application/json" }, signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) return signals;
    const data = await res.json() as any;
    const records = data?.data || data?.results || [];
    for (const rec of records) {
      if (!rec.fatalities && !rec.total_injury) continue;
      signals.push({
        signalType: "osha_incident",
        sourceId: "osha_" + (rec.activity_nr || String(Math.random())),
        county: rec.county || "FLORIDA",
        address: (rec.estab_name || "Workplace") + ", " + (rec.city || "") + ", FL",
        ownerName: rec.estab_name || null,
        ownerPhone: null,
        serviceCategories: ["personal_injury", "workers_comp"],
        urgency: rec.fatalities > 0 ? "critical" : "high",
        description: "OSHA Incident — " + (rec.fatalities > 0 ? rec.fatalities + " fatalities" : rec.total_injury + " injuries") + " — " + (rec.estab_name || "Unknown") + " — " + (rec.city || "FL"),
        rawData: rec,
        detectedAt: new Date(rec.open_date || Date.now()),
      });
    }
  } catch (err: any) {
    if (err.name !== "AbortError") console.warn("[HS-PIPELINE] OSHA fetch failed:", err.message);
  }
  console.log("[HS-PIPELINE] OSHA signals: " + signals.length);
  return signals;
}

// ── Legal: FDA & CPSC Recalls ─────────────────────────────────────────────────

async function fetchRecalls(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      "https://api.fda.gov/drug/enforcement.json?search=status%3A%22Ongoing%22&limit=20",
      { headers: { "Accept": "application/json" }, signal: controller.signal }
    );
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json() as any;
      for (const rec of (data?.results || [])) {
        if (rec.classification !== "Class I") continue;
        signals.push({
          signalType: "fda_recall",
          sourceId: "fda_" + (rec.recall_number || String(Math.random())),
          county: "STATEWIDE",
          address: "Florida Statewide",
          ownerName: rec.recalling_firm || null,
          ownerPhone: null,
          serviceCategories: ["personal_injury", "medical_malpractice"],
          urgency: "high",
          description: "FDA Class I Recall — " + (rec.product_description || "Drug/Device").slice(0, 80) + " — " + rec.recalling_firm,
          rawData: rec,
          detectedAt: new Date(rec.recall_initiation_date || Date.now()),
        });
      }
    }
  } catch (err: any) {
    if (err.name !== "AbortError") console.warn("[HS-PIPELINE] FDA recall fetch failed:", err.message);
  }
  console.log("[HS-PIPELINE] Recall signals: " + signals.length);
  return signals;
}

// ── Business: FL License Filings ─────────────────────────────────────────────

async function fetchFlBusinessSignals(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const LICENSE_TYPES = [
    { code: "HL", name: "Hair Salon",          cats: ["hair_salon"] as ServiceCategory[] },
    { code: "BB", name: "Barbershop",           cats: ["barbershop"] as ServiceCategory[] },
    { code: "NL", name: "Nail Salon",           cats: ["nail_salon"] as ServiceCategory[] },
    { code: "SP", name: "Spa",                  cats: ["spa"] as ServiceCategory[] },
    { code: "CG", name: "General Contractor",   cats: ["general_contractor"] as ServiceCategory[] },
    { code: "LS", name: "Lawn Service",         cats: ["lawn_care", "landscaping"] as ServiceCategory[] },
    { code: "PS", name: "Pool Service",         cats: ["pool_service", "pool"] as ServiceCategory[] },
  ];

  const TARGET_COUNTIES = new Set(["LEE", "COLLIER", "CHARLOTTE", "SARASOTA", "MANATEE", "HILLSBOROUGH", "PINELLAS", "MIAMI-DADE", "BROWARD", "PALM BEACH", "ORANGE"]);

  for (const lic of LICENSE_TYPES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(
        "https://ww2.myfloridalicense.com/api/licenses?licenseType=" + lic.code + "&issuedAfter=" + since + "&status=Active&limit=50",
        { headers: { "Accept": "application/json" }, signal: controller.signal }
      );
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json() as any;
      const records = Array.isArray(data) ? data : data?.licenses || [];
      for (const rec of records) {
        const county = (rec.county || "UNKNOWN").toUpperCase();
        if (!TARGET_COUNTIES.has(county)) continue;
        signals.push({
          signalType: "new_business_filing",
          sourceId: "fldoh_" + (rec.licenseNumber || String(Math.random())),
          county,
          address: [rec.address, rec.city, "FL", rec.zip].filter(Boolean).join(", "),
          ownerName: rec.businessName || rec.name || null,
          ownerPhone: rec.phone || null,
          serviceCategories: lic.cats,
          urgency: "low",
          description: "New " + lic.name + " License — " + (rec.businessName || "New Business") + " — " + county + " County",
          rawData: rec,
          detectedAt: new Date(rec.issueDate || Date.now()),
        });
      }
    } catch (err: any) {
      if (err.name !== "AbortError") console.warn("[HS-PIPELINE] FL license fetch failed for " + lic.name + ":", err.message);
    }
  }
  console.log("[HS-PIPELINE] Business license signals: " + signals.length);
  return signals;
}

// ── Traffic: License Suspensions ─────────────────────────────────────────────

async function fetchTrafficSignals(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(
      "https://services.flhsmv.gov/api/suspensions?date=" + today + "&limit=200",
      { headers: { "Accept": "application/json" }, signal: controller.signal }
    );
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json() as any;
      const records = Array.isArray(data) ? data : data?.suspensions || [];
      for (const rec of records) {
        const reason = (rec.reason || "").toUpperCase();
        const isDUI = reason.includes("DUI") || reason.includes("ALCOHOL");
        signals.push({
          signalType: "license_suspension",
          sourceId: "dhsmv_" + (rec.id || String(Math.random())),
          county: rec.county || "UNKNOWN",
          address: (rec.county || "FL") + ", FL",
          ownerName: rec.name || null,
          ownerPhone: null,
          serviceCategories: isDUI ? ["dui_defense", "traffic_law"] : ["traffic_law"],
          urgency: isDUI ? "high" : "medium",
          description: "FL License Suspension — " + (rec.reason || "Unknown") + " — " + (rec.county || "FL") + " County",
          rawData: rec,
          detectedAt: new Date(rec.suspensionDate || Date.now()),
        });
      }
    }
  } catch (err: any) {
    if (err.name !== "AbortError") console.warn("[HS-PIPELINE] DHSMV fetch failed:", err.message);
  }
  console.log("[HS-PIPELINE] Traffic signals: " + signals.length);
  return signals;
}


// ── FL DBPR New License Filings (Beauty / Barber / Salon / Spa) ───────────────

const DBPR_SERVICE_MAP: Record<string, ServiceCategory[]> = {
  "COSMETOLOGY":           ["hair_salon"],
  "HAIR BRAIDER":          ["hair_salon", "barber"],
  "BARBER":                ["barber"],
  "RESTRICTED BARBER":     ["barber"],
  "NAIL SPECIALIST":       ["nail_salon"],
  "FACIAL SPECIALIST":     ["spa_esthetics"],
  "MASSAGE THERAPY":       ["spa_massage"],
  "FULL BEAUTY SALON":     ["hair_salon"],
  "TATTOO":                ["tattoo"],
  "BODY PIERCING":         ["tattoo"],
};

async function fetchDBPRNewLicenses(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  try {
    // FL DBPR public license search - new cosmetology/barber licenses
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sinceStr = since.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
    const url = `https://www.myfloridalicense.com/wl11.asp?mode=0&search=LicenseType&LicenseType=COS&status=A&issue_date_after=${encodeURIComponent(sinceStr)}&format=json`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "ApexLeadEngine/2.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`[HS-PIPELINE] DBPR HTTP ${res.status} — skipping`);
      return signals;
    }
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) {
      const preview = (await res.text()).slice(0, 200);
      console.warn(`[HS-PIPELINE] DBPR non-JSON response ct=${ct} preview=${preview}`);
      return signals;
    }
    const licenses = await res.json() as any[];
    for (const lic of licenses) {
      const licType = (lic.license_type || "").toUpperCase();
      let cats: ServiceCategory[] = [];
      for (const [keyword, services] of Object.entries(DBPR_SERVICE_MAP)) {
        if (licType.includes(keyword)) { cats = services as ServiceCategory[]; break; }
      }
      if (!cats.length) continue;
      const county = (lic.county || "UNKNOWN").toUpperCase();
      signals.push({
        signalType: "new_license_filing",
        sourceId: lic.license_number || crypto.randomUUID(),
        county,
        address: lic.address,
        ownerName: lic.name || lic.business_name,
        ownerPhone: lic.phone,
        serviceCategories: cats,
        urgency: "low",
        description: `New ${lic.license_type} license — ${lic.name || lic.business_name}`,
        rawData: lic,
        detectedAt: new Date(lic.issue_date || Date.now()),
      });
    }
    console.log(`[HS-PIPELINE] DBPR: ${signals.length} new license filings`);
  } catch (err: any) {
    console.warn("[HS-PIPELINE] DBPR licenses failed:", err.message);
  }
  return signals;
}

async function runPipelineCycle(subAccountId: number): Promise<void> {
  const runId   = crypto.randomUUID().slice(0, 8);
  const startMs = Date.now();
  console.log(`[HS-PIPELINE] ── CYCLE START id=${runId} ──`);
  stats.totalRuns++;
  stats.lastRunAt = new Date().toISOString();

  const settled = await Promise.allSettled([
    fetchNoaaAlerts(),
    fetchLeePermits(),
    fetchCollierPermits(),
    fetchCharlottePermits(),
    fetchCodeEnforcement(),
    fetchFlBusinessLicenses(),
    fetchFloridaArrests(),
    fetchFloridaCourtFilings(),
    fetchOshaIncidents(),
    fetchRecalls(),
    fetchFlBusinessSignals(),
    fetchTrafficSignals(),
  ]);
  const [noaa, lee, collier, charlotte, code, bizLicenses, arrests, courtFilings, osha, recalls, bizSignals, traffic] = settled.map(x => x.status === "fulfilled" ? x.value : []);

  const allSignals: RawSignal[] = [
    ...noaa, ...lee, ...collier, ...charlotte, ...code, ...bizLicenses,
    ...arrests, ...courtFilings, ...osha, ...recalls, ...bizSignals, ...traffic,
  ];
  console.log(`[HS-PIPELINE] ${allSignals.length} raw signals fetched in ${Date.now() - startMs}ms`);

  let inserted = 0, dupes = 0, qualified = 0, delivered = 0;

  for (const signal of allSignals) {
    try {
      const hash = buildSignalHash(signal);
      if (await isDuplicate(hash)) { dupes++; continue; }

      // Persist raw signal
      const [saved] = await db.insert(homeServiceSignals).values({
        sourceHash: hash, signalType: signal.signalType, county: signal.county,
        address: signal.address, lat: signal.lat, lng: signal.lng,
        propertyValue: signal.propertyValue, ownerName: signal.ownerName,
        squareFootage: signal.squareFootage, yearBuilt: signal.yearBuilt,
        serviceCategories: signal.serviceCategories, urgency: signal.urgency,
        description: signal.description, rawData: signal.rawData,
        detectedAt: signal.detectedAt, status: "raw",
      }).returning();

      inserted++;
      stats.signalsByType[signal.signalType] = (stats.signalsByType[signal.signalType] ?? 0) + 1;

      // ── Apex: signal detected ──────────────────────────────────────────────
      apexReport({
        action:       "signal_detected",
        subject:      signal.signalType,
        result:       `Home service signal: ${signal.signalType} in ${signal.county} county`,
        confidence:   signal.urgency === "critical" ? 0.95 : signal.urgency === "high" ? 0.85 : 0.75,
        subAccountId,
        metadata: {
          signalId: saved.id, signalType: signal.signalType, county: signal.county,
          address: signal.address, urgency: signal.urgency,
          propertyValue: signal.propertyValue, serviceCategories: signal.serviceCategories,
        },
      });

      // Score
      const scored = await scoreHomeServiceLead(signal, saved.id, subAccountId);

      if (!scored.qualifies) {
        await db.update(homeServiceSignals)
          .set({ status: "disqualified", score: scored.score, scoreBreakdown: scored.breakdown })
          .where(eq(homeServiceSignals.id, saved.id));

        // ── Apex: lead disqualified ────────────────────────────────────────
        apexReport({
          action:       "lead_disqualified",
          subject:      signal.signalType,
          result:       `Signal scored ${scored.score}/100 — below threshold`,
          confidence:   0.9,
          subAccountId,
          metadata: {
            signalId: saved.id, score: scored.score, breakdown: scored.breakdown,
            county: signal.county, signalType: signal.signalType,
          },
        });
        continue;
      }

      qualified++;

      const [lead] = await db.insert(homeServiceLeads).values({
        signalId: saved.id, county: signal.county, address: signal.address,
        lat: signal.lat, lng: signal.lng, propertyValue: signal.propertyValue,
        ownerName: signal.ownerName, ownerPhone: signal.ownerPhone,
        squareFootage: signal.squareFootage, yearBuilt: signal.yearBuilt,
        signalType: signal.signalType, serviceCategories: signal.serviceCategories,
        urgency: signal.urgency, score: scored.score, scoreTier: scored.tier,
        scoreBreakdown: scored.breakdown,
        estimatedJobMin: scored.estimatedJobValue.min,
        estimatedJobMax: scored.estimatedJobValue.max,
        description: signal.description, status: "available", expiresAt: scored.expiresAt,
      }).returning();

      await db.update(homeServiceSignals)
        .set({ status: "qualified", score: scored.score, leadId: lead.id })
        .where(eq(homeServiceSignals.id, saved.id));

      // ── Apex: lead qualified ───────────────────────────────────────────────
      apexReport({
        action:       "lead_qualified",
        subject:      signal.signalType,
        result:       `Lead qualified: ${signal.signalType} in ${signal.county} — Tier ${scored.tier}, score ${scored.score}/100`,
        confidence:   scored.score / 100,
        subAccountId,
        metadata: {
          leadId: lead.id, signalId: saved.id, signalType: signal.signalType,
          county: signal.county, address: signal.address,
          score: scored.score, tier: scored.tier, urgency: signal.urgency,
          propertyValue: signal.propertyValue,
          estimatedJobMin: scored.estimatedJobValue.min,
          estimatedJobMax: scored.estimatedJobValue.max,
          serviceCategories: signal.serviceCategories,
        },
      });

      // Deliver
      const result = await deliverLeadToContractors(lead, subAccountId);
      if (result.delivered > 0) delivered++;
      stats.totalLeads++;

    } catch (err: any) {
      console.error(`[HS-PIPELINE] Signal error: ${err.message}`);
    }
  }

  stats.totalSignals   += allSignals.length;
  stats.totalDelivered += delivered;

  const durationMs = Date.now() - startMs;

  // ── Apex: cycle complete ───────────────────────────────────────────────────
  apexReport({
    action:       "cycle_complete",
    subject:      "pipeline_run",
    result:       `Pipeline: ${allSignals.length} signals → ${qualified} leads → ${delivered} delivered in ${durationMs}ms`,
    confidence:   1.0,
    subAccountId,
    metadata: {
      runId, durationMs, totalSignals: allSignals.length,
      inserted, dupes, qualified, delivered,
      signalsByType: { ...stats.signalsByType },
      counties: FL_COUNTIES_CORE.map(c => c.name),
    },
  });

  console.log(
    `[HS-PIPELINE] ── CYCLE END id=${runId} ──\n` +
    `  signals=${allSignals.length} inserted=${inserted} dupes=${dupes} ` +
    `qualified=${qualified} delivered=${delivered} durationMs=${durationMs}`,
  );
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().split("T")[0];
}

// ── Start / stop ──────────────────────────────────────────────────────────────

let running  = false;
let interval: ReturnType<typeof setInterval> | null = null;

export function startHomeServicePipeline(subAccountId: number = 1): void {
  if (running) { console.log("[HS-PIPELINE] Already running"); return; }
  running = true;
  console.log(`[HS-PIPELINE] Started (id=${PIPELINE_ID}) — polling every ${POLL_INTERVAL_MS / 60_000}min`);
  const tick = async () => {
    try { await runPipelineCycle(subAccountId); }
    catch (err: any) { stats.lastError = err.message; console.error("[HS-PIPELINE] Tick error:", err.message); }
  };
  tick();
  interval = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopHomeServicePipeline(): void {
  if (interval) { clearInterval(interval); interval = null; }
  running = false;
  console.log("[HS-PIPELINE] Stopped");
}
