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
  { name: "LEE",       zone: "FLZ043" },
  { name: "COLLIER",   zone: "FLZ048" },
  { name: "CHARLOTTE", zone: "FLZ042" },
];

const HIGH_VALUE_ALERT_TYPES = new Set([
  "Tornado Warning", "Tornado Watch", "Severe Thunderstorm Warning",
  "Hurricane Warning", "Hurricane Watch", "Tropical Storm Warning",
  "Flood Warning", "Flash Flood Warning", "Wind Advisory",
  "High Wind Warning", "Storm Surge Warning", "Storm Surge Watch",
]);

const HIGH_VALUE_PERMIT_TYPES = new Set([
  "ROOFING", "ROOF", "HVAC", "AIR CONDITIONING", "MECHANICAL",
  "POOL", "SWIMMING POOL", "SOLAR", "ELECTRICAL", "ADDITION",
  "RENOVATION", "REMODEL", "FOUNDATION", "SEAWALL", "DOCK", "GENERATOR",
]);

// ── Types ─────────────────────────────────────────────────────────────────────

export type SignalType =
  | "noaa_weather_alert" | "permit_filing"    | "new_homeowner"
  | "code_enforcement"   | "pre_foreclosure"  | "lis_pendens"
  | "probate"            | "short_term_rental" | "sinkhole_report"
  | "flood_zone_change";

export type ServiceCategory =
  | "roofing" | "hvac"               | "water_damage" | "pool"
  | "solar"   | "foundation"         | "general_contractor"
  | "electrical" | "plumbing"        | "landscaping"  | "painting";

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
    .catch(() => {});
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
  if (u.includes("ROOF"))                                        return ["roofing"];
  if (u.includes("HVAC") || u.includes("AIR") || u.includes("MECHANICAL")) return ["hvac"];
  if (u.includes("POOL"))                                        return ["pool"];
  if (u.includes("SOLAR"))                                       return ["solar"];
  if (u.includes("ELECTRIC"))                                    return ["electrical"];
  if (u.includes("PLUMB"))                                       return ["plumbing"];
  if (u.includes("FOUNDATION"))                                  return ["foundation"];
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

// ── Main pipeline cycle ───────────────────────────────────────────────────────

async function runPipelineCycle(subAccountId: number): Promise<void> {
  const runId   = crypto.randomUUID().slice(0, 8);
  const startMs = Date.now();
  console.log(`[HS-PIPELINE] ── CYCLE START id=${runId} ──`);
  stats.totalRuns++;
  stats.lastRunAt = new Date().toISOString();

  const [noaa, lee, collier, charlotte, code] = await Promise.allSettled([
    fetchNoaaAlerts(),
    fetchLeePermits(),
    fetchCollierPermits(),
    fetchCharlottePermits(),
    fetchCodeEnforcement(),
  ]).then(r => r.map(x => x.status === "fulfilled" ? x.value : []));

  const allSignals: RawSignal[] = [...noaa, ...lee, ...collier, ...charlotte, ...code];
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
