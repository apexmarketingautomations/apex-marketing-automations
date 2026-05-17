/**
 * apexLeadEngine.ts
 *
 * Unified Apex Lead Intelligence Engine
 * Runs all lead verticals in parallel every 30 minutes:
 *
 * LEGAL:
 *   - Personal Injury    → FHP crash feed + OSHA incidents + FDA/CPSC recalls
 *   - Criminal Defense   → FL county arrest/booking records
 *   - Family Law         → FL court divorce/injunction/custody filings
 *   - Traffic            → DUI arrests + DHSMV suspensions
 *
 * HOME & PROPERTY:
 *   - Roofing/HVAC/Pool  → NOAA alerts + county permits
 *   - Solar/Electrical   → county permits
 *   - Lawn/Landscaping   → new home sales + HOA violations
 *   - Pest Control       → code enforcement
 *   - Painting/Cleaning  → new business filings
 *   - Pressure Washing   → commercial property permits
 *
 * BEAUTY & PERSONAL:
 *   - Hair Salons/Barbers → FL DBPR new license filings
 *   - Nail Salons         → FL DBPR license filings
 *   - Spas/Massage        → FL DBPR license filings
 *
 * AUTO:
 *   - Auto Detailing      → new business + car dealership openings
 *
 * All data is FREE public sources — no subscriptions needed.
 * Skip trace (BatchData) is optional and only fires on qualified leads.
 */

import crypto from 'crypto';
import { db } from './db';
import { homeServiceSignals, homeServiceLeads, legalLeads } from '@shared/schema';
import { eq, and, gte } from 'drizzle-orm';

// ── Constants ──────────────────────────────────────────────────────────────

const ENGINE_ID = crypto.randomUUID().slice(0, 8);
const POLL_INTERVAL_MS = 30 * 60 * 1000;
const APEX_PARENT_ACCOUNT_ID = Number(process.env.APEX_PARENT_ACCOUNT_ID || 13);

// Florida counties covered
// Safe fetch: checks content-type, logs failures, never throws
async function safeJsonFetch(url: string, label: string, timeoutMs = 10000): Promise<any[] | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "ApexLeadEngine/2.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) {
      console.warn(`[APEX-ENGINE] ${label} HTTP ${res.status} — skipping`);
      return null;
    }
    if (!ct.includes("json")) {
      const preview = (await res.text()).slice(0, 200);
      console.warn(`[APEX-ENGINE] ${label} non-JSON ct="${ct}" preview="${preview.replace(/\s+/g,' ')}"`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    // Classify network failures precisely so logs are actionable
    let reason = err.message || "unknown error";
    try { const host = new URL(url).hostname; reason = `host=${host} ${reason}`; } catch (_e) { /* allow-silent-catch: URL parse failure is non-fatal */ }
    if (err.name === "TimeoutError" || err.message?.includes("timeout") || err.message?.includes("AbortError")) {
      console.warn(`[APEX-ENGINE] ${label} TIMEOUT after ${timeoutMs}ms ${reason}`);
    } else if (err.cause?.code === "ENOTFOUND" || err.message?.includes("ENOTFOUND")) {
      console.warn(`[APEX-ENGINE] ${label} DNS_FAILURE ${reason}`);
    } else if (err.cause?.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED")) {
      console.warn(`[APEX-ENGINE] ${label} CONNECTION_REFUSED ${reason}`);
    } else if (err.cause?.code === "ECONNRESET" || err.message?.includes("ECONNRESET")) {
      console.warn(`[APEX-ENGINE] ${label} CONNECTION_RESET ${reason}`);
    } else {
      console.warn(`[APEX-ENGINE] ${label} NETWORK_ERROR code=${err.cause?.code || err.code || "?"} ${reason}`);
    }
    return null;
  }
}

const FL_COUNTIES = [
  { name: 'LEE',        zone: 'FLZ043', fips: '12071' },
  { name: 'COLLIER',    zone: 'FLZ048', fips: '12021' },
  { name: 'CHARLOTTE',  zone: 'FLZ042', fips: '12015' },
  { name: 'SARASOTA',   zone: 'FLZ041', fips: '12115' },
  { name: 'MANATEE',    zone: 'FLZ040', fips: '12081' },
  { name: 'HILLSBOROUGH', zone: 'FLZ049', fips: '12057' },
  { name: 'PINELLAS',   zone: 'FLZ050', fips: '12103' },
  { name: 'BROWARD',    zone: 'FLZ056', fips: '12011' },
  { name: 'MIAMI-DADE', zone: 'FLZ068', fips: '12086' },
  { name: 'ORANGE',     zone: 'FLZ052', fips: '12095' },
  { name: 'SEMINOLE',   zone: 'FLZ053', fips: '12117' },
  { name: 'PALM BEACH', zone: 'FLZ060', fips: '12099' },
];

// NOAA alert types → lead categories
const WEATHER_TO_SERVICE: Record<string, string[]> = {
  'Tornado Warning':              ['roofing', 'general_contractor', 'water_damage'],
  'Tornado Watch':                ['roofing', 'general_contractor'],
  'Severe Thunderstorm Warning':  ['roofing', 'gutters', 'tree_service'],
  'Hurricane Warning':            ['roofing', 'general_contractor', 'water_damage', 'generator'],
  'Hurricane Watch':              ['roofing', 'general_contractor', 'generator'],
  'Tropical Storm Warning':       ['roofing', 'water_damage', 'tree_service'],
  'Flood Warning':                ['water_damage', 'foundation', 'plumbing'],
  'Flash Flood Warning':          ['water_damage', 'foundation'],
  'Wind Advisory':                ['roofing', 'tree_service'],
  'High Wind Warning':            ['roofing', 'tree_service', 'fence'],
  'Storm Surge Warning':          ['water_damage', 'foundation', 'seawall'],
  'Hail Advisory':                ['roofing', 'gutters', 'auto_detailing'],
};

// Permit keywords → service categories
const PERMIT_KEYWORDS: Record<string, string[]> = {
  'ROOF':         ['roofing'],
  'ROOFING':      ['roofing'],
  'HVAC':         ['hvac'],
  'AIR CONDITION': ['hvac'],
  'MECHANICAL':   ['hvac'],
  'POOL':         ['pool'],
  'SWIMMING POOL': ['pool'],
  'SOLAR':        ['solar'],
  'ELECTRICAL':   ['electrical'],
  'PLUMBING':     ['plumbing'],
  'ADDITION':     ['general_contractor'],
  'RENOVATION':   ['general_contractor', 'painting'],
  'REMODEL':      ['general_contractor', 'painting'],
  'FOUNDATION':   ['foundation'],
  'FENCE':        ['fence'],
  'GENERATOR':    ['generator'],
  'LANDSCAPE':    ['lawn_landscaping'],
  'IRRIGATION':   ['lawn_landscaping'],
  'PAINTING':     ['painting'],
  'PRESSURE':     ['pressure_washing'],
  'DRYWALL':      ['general_contractor'],
  'INSULATION':   ['general_contractor'],
  'WINDOW':       ['windows_doors'],
  'DOOR':         ['windows_doors'],
};

// DBPR license types → service categories  
const DBPR_LICENSE_TYPES: Record<string, string[]> = {
  'COSMETOLOGY':        ['hair_salon'],
  'HAIR BRAIDER':       ['hair_salon', 'barber'],
  'BARBER':             ['barber'],
  'NAIL SPECIALIST':    ['nail_salon'],
  'FACIAL SPECIALIST':  ['spa_esthetics'],
  'MASSAGE THERAPY':    ['spa_massage'],
  'FULL BEAUTY SALON':  ['hair_salon'],
  'RESTRICTED BARBER':  ['barber'],
};

// ── Types ──────────────────────────────────────────────────────────────────

export interface LeadSignal {
  id: string;
  vertical: 'home_property' | 'legal' | 'beauty' | 'auto';
  subVertical: string;
  signalType: string;
  county: string;
  state: string;
  subjectName?: string;
  address?: string;
  phone?: string;
  email?: string;
  description: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  serviceCategories: string[];
  rawData: Record<string, unknown>;
  detectedAt: Date;
  sourceUrl?: string;
  caseNumber?: string;
  chargeDescription?: string;
  legalVertical?: string;
}

// ── Dedup ──────────────────────────────────────────────────────────────────

function hashSignal(s: LeadSignal): string {
  return crypto.createHash('sha256')
    .update(`${s.signalType}:${s.subjectName || ''}:${s.county}:${s.caseNumber || s.address || ''}`)
    .digest('hex').slice(0, 32);
}

async function isDupe(hash: string): Promise<boolean> {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const rows = await db.select({ id: homeServiceSignals.id })
    .from(homeServiceSignals)
    .where(and(eq(homeServiceSignals.sourceHash, hash), gte(homeServiceSignals.detectedAt, since)))
    .limit(1);
  return rows.length > 0;
}

// ── NOAA Weather Alerts ────────────────────────────────────────────────────

async function fetchNoaaAlerts(): Promise<LeadSignal[]> {
  const signals: LeadSignal[] = [];
  for (const county of FL_COUNTIES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(
        `https://api.weather.gov/alerts/active?zone=${county.zone}`,
        { headers: { 'Accept': 'application/geo+json', 'User-Agent': 'ApexLeadEngine/2.0' }, signal: ctrl.signal }
      );
      clearTimeout(timer);
      if (!res.ok) { console.warn(`[APEX-ENGINE] NOAA ${county.name} HTTP ${res.status}`); continue; }
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('json') && !ct.includes('geo+json')) {
        console.warn(`[APEX-ENGINE] NOAA ${county.name} non-JSON ct="${ct}"`); continue;
      }
      const data = await res.json() as any;
      for (const f of (data.features ?? [])) {
        const props = f?.properties ?? {};
        const services = WEATHER_TO_SERVICE[props.event];
        if (!services) continue;
        const urgency = props.severity === 'Extreme' || props.event.includes('Warning') ? 'critical' : 'high';
        signals.push({
          id: props.id || crypto.randomUUID(),
          vertical: 'home_property',
          subVertical: 'storm_damage',
          signalType: 'noaa_weather_alert',
          county: county.name,
          state: 'FL',
          description: `${props.event} — ${props.headline || county.name}`,
          urgency,
          serviceCategories: services,
          rawData: props,
          detectedAt: new Date(),
          sourceUrl: 'https://api.weather.gov',
        });
      }
    } catch (err: any) {
      console.warn(`[APEX-ENGINE] NOAA ${county.name} failed:`, err.message);
    }
  }
  return signals;
}

// ── County Permit Filings ──────────────────────────────────────────────────

function parsePermitCategories(permitType: string): string[] {
  const upper = permitType.toUpperCase();
  const cats: string[] = [];
  for (const [keyword, services] of Object.entries(PERMIT_KEYWORDS)) {
    if (upper.includes(keyword)) cats.push(...services);
  }
  return Array.from(new Set(cats));
}

async function fetchLeePermits(): Promise<LeadSignal[]> {
  // opendata.leegov.com consistently fails DNS from Railway — disabled until verified working
  // TODO: replace with Lee County iGovServices or confirmed Socrata resource ID
  return [];
  try { // unreachable — kept for reference
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const permits = await safeJsonFetch(
      `https://opendata.leegov.com/resource/permits.json?$where=application_date>'${since}'&$limit=200&$order=application_date DESC`,
      "Lee permits"
    );
    if (!permits) return [];
    return permits!.flatMap(p => {
      const cats = parsePermitCategories(p.permit_type || p.work_description || '');
      if (!cats.length) return [];
      return [{
        id: p.permit_number || crypto.randomUUID(),
        vertical: 'home_property' as const,
        subVertical: 'permit_filing',
        signalType: 'permit_filing',
        county: 'LEE',
        state: 'FL',
        address: p.site_address || p.address,
        subjectName: p.owner_name,
        description: `${p.permit_type || 'Permit'} — ${p.site_address || 'Lee County'}`,
        urgency: 'medium' as const,
        serviceCategories: cats,
        rawData: p,
        detectedAt: new Date(p.application_date || Date.now()),
      }];
    });
  } catch (err: any) {
    console.warn('[APEX-ENGINE] Lee permits failed:', err.message);
    return [];
  }
}

async function fetchCollierPermits(): Promise<LeadSignal[]> {
  // colliercountyfl.gov/api/permits returns HTTP 404 — no public JSON API at this path
  // TODO: find Collier County's actual permit data endpoint (Tyler Technologies iGovServices)
  return [];
  try { // unreachable — kept for reference
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const permits = await safeJsonFetch(
      `https://www.colliercountyfl.gov/api/permits?issued_after=${since}&limit=200`,
      "Collier permits"
    );
    if (!permits) return [];
    return permits!.flatMap(p => {
      const cats = parsePermitCategories(p.permit_type || p.description || '');
      if (!cats.length) return [];
      return [{
        id: p.permit_number || crypto.randomUUID(),
        vertical: 'home_property' as const,
        subVertical: 'permit_filing',
        signalType: 'permit_filing',
        county: 'COLLIER',
        state: 'FL',
        address: p.address,
        subjectName: p.owner_name,
        description: `${p.permit_type || 'Permit'} — ${p.address || 'Collier County'}`,
        urgency: 'medium' as const,
        serviceCategories: cats,
        rawData: p,
        detectedAt: new Date(p.issued_date || Date.now()),
      }];
    });
  } catch (err: any) {
    console.warn('[APEX-ENGINE] Collier permits failed:', err.message);
    return [];
  }
}

// ── FL DBPR License Filings (Beauty/Barber/Salon) ─────────────────────────

async function fetchDBPRLicenses(): Promise<LeadSignal[]> {
  // myfloridalicense.com/wl11.asp returns HTML — no public JSON API
  // The FL DBPR licensing portal is browser-only; would need Nimble extraction
  // TODO: wire to a Nimble agent for DBPR new license scraping
  return [];
  try { // unreachable — kept for reference
    // FL DBPR public license search — new licenses issued in last 30 days
    const _dbprFetch = await safeJsonFetch(
      'https://www.myfloridalicense.com/wl11.asp?mode=0&search=LicenseType&LicenseType=COS&County=&status=A&issue_date_after=' +
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US'),
      'DBPR licenses'
    );
    if (!_dbprFetch) return [];
    const data = _dbprFetch as any[];
    return (data || []).flatMap((lic: any) => {
      const licType = (lic.license_type || '').toUpperCase();
      let cats: string[] = [];
      for (const [keyword, services] of Object.entries(DBPR_LICENSE_TYPES)) {
        if (licType.includes(keyword)) { cats = services; break; }
      }
      if (!cats.length) return [];
      return [{
        id: lic.license_number || crypto.randomUUID(),
        vertical: 'beauty' as const,
        subVertical: cats[0],
        signalType: 'new_license_filing',
        county: (lic.county || 'UNKNOWN').toUpperCase(),
        state: 'FL',
        subjectName: lic.name || lic.business_name,
        address: lic.address,
        phone: lic.phone,
        description: `New ${lic.license_type} license — ${lic.name || lic.business_name}`,
        urgency: 'medium' as const,
        serviceCategories: cats,
        rawData: lic,
        detectedAt: new Date(lic.issue_date || Date.now()),
      }];
    });
  } catch (err: any) {
    console.warn('[APEX-ENGINE] DBPR licenses failed:', err.message);
    return [];
  }
}

// ── FL Arrest Records — delegated to jailBookingPipeline (Nimble, all 11 FL counties) ──
// Direct county-specific scraping removed. jailBookingPipeline runs every 60 min
// and covers all 11 SW/Central FL counties via Nimble agents.

async function fetchArrestRecords(): Promise<LeadSignal[]> {
  return []; // handled by jailBookingPipeline
}

// ── FL Court Filings (Family Law leads) ───────────────────────────────────

async function fetchCourtFilings(): Promise<LeadSignal[]> {
  // myeclerk.myfloridacounty.com is not a real domain — DNS always fails
  // Court filings are handled by courtFilingPipeline.ts (Nimble extraction, every 6h)
  return [];
  const signals: LeadSignal[] = [];

  // Florida Courts e-filing portal — public case search
  const familyTypes = ['Dissolution of Marriage', 'Domestic Violence', 'Child Custody', 'Paternity', 'Probate'];

  for (const county of FL_COUNTIES.slice(0, 6)) { // Top 6 counties
    try {
      const cases = await safeJsonFetch(
        `https://myeclerk.myfloridacounty.com/api/cases?county=${county.fips}&case_type=family&filed_after=${
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        }&limit=50`,
        `Court filings ${county.name}`,
        8000
      );
      if (!cases) continue;
      for (const c of cases!) {
        const caseType = c.case_type || c.description || '';
        const isDivorce = caseType.toLowerCase().includes('dissolution') || caseType.toLowerCase().includes('divorce');
        const isDV = caseType.toLowerCase().includes('domestic') || caseType.toLowerCase().includes('injunction');
        const isCustody = caseType.toLowerCase().includes('custody') || caseType.toLowerCase().includes('paternity');
        if (!isDivorce && !isDV && !isCustody) continue;

        signals.push({
          id: c.case_number || crypto.randomUUID(),
          vertical: 'legal',
          subVertical: isDivorce ? 'family_divorce' : isDV ? 'family_dv' : 'family_custody',
          signalType: 'court_filing',
          county: county.name,
          state: 'FL',
          subjectName: c.plaintiff || c.petitioner || c.party_name,
          caseNumber: c.case_number,
          chargeDescription: caseType,
          description: `${caseType} filing — ${county.name} County`,
          urgency: isDV ? 'critical' : 'high',
          serviceCategories: isDV ? ['family_law_attorney', 'domestic_violence_attorney'] : 
            isDivorce ? ['family_law_attorney', 'divorce_attorney'] : ['family_law_attorney'],
          legalVertical: 'family',
          rawData: c,
          detectedAt: new Date(c.filed_date || Date.now()),
        });
      }
    } catch (err: any) {
      console.warn(`[APEX-ENGINE] Court filings ${county.name} failed:`, err.message);
    }
  }
  return signals;
}

// ── OSHA Workplace Incidents (Personal Injury leads) ──────────────────────

async function fetchOSHAIncidents(): Promise<LeadSignal[]> {
  // data.osha.gov (Socrata/CKAN) is decommissioned — DNS fails
  // OSHA incidents are handled by legalSignalPipeline.ts (separate cycle, every 15m)
  // New OSHA data endpoint requires a DOL API key (api.dol.gov/V1/Compliance/OSHA)
  return [];
  try { // unreachable — kept for reference
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const _oshaRes = await safeJsonFetch(
      `https://data.osha.gov/api/action/datastore_search?resource_id=b62ed87f-e733-4c8f-b2e0-d30c39b22b83&filters={"state_flag":"FL"}&limit=100&sort=event_date desc`,
      'OSHA incidents'
    );
    const res = { ok: !!_oshaRes, json: async () => _oshaRes };
    if (!res.ok) return [];
    const data = await res.json() as any;
    const records = data?.result?.records || [];
    return records.map((r: any) => ({
      id: r.activity_nr || crypto.randomUUID(),
      vertical: 'legal' as const,
      subVertical: 'personal_injury_workplace',
      signalType: 'osha_incident',
      county: (r.county_name || 'UNKNOWN').toUpperCase(),
      state: 'FL',
      subjectName: r.estab_name,
      address: `${r.site_address || ''} ${r.site_city || ''}`.trim(),
      description: `Workplace incident — ${r.nature_of_inj || 'Injury'} at ${r.estab_name || 'Florida employer'}`,
      urgency: r.fatality === 'Y' ? 'critical' : 'high' as any,
      serviceCategories: ['personal_injury_attorney', 'workers_comp_attorney'],
      legalVertical: 'personal_injury',
      rawData: r,
      detectedAt: new Date(r.event_date || Date.now()),
    }));
  } catch (err: any) {
    console.warn('[APEX-ENGINE] OSHA incidents failed:', err.message);
    return [];
  }
}

// ── FDA/CPSC Product Recalls (Product Liability leads) ────────────────────

async function fetchProductRecalls(): Promise<LeadSignal[]> {
  try {
    const data = await safeJsonFetch(
      'https://api.fda.gov/food/enforcement.json?search=state:FL&limit=50&sort=report_date:desc',
      'FDA recalls'
    );
    if (!data) return [];
    return ((data as any)?.results || []).map((r: any) => ({
      id: r.recall_number || crypto.randomUUID(),
      vertical: 'legal' as const,
      subVertical: 'product_liability',
      signalType: 'fda_recall',
      county: 'STATEWIDE',
      state: 'FL',
      subjectName: r.recalling_firm,
      description: `FDA Recall — ${r.product_description?.slice(0, 100) || 'Product recall'} by ${r.recalling_firm}`,
      urgency: r.classification === 'Class I' ? 'critical' : 'high' as any,
      serviceCategories: ['product_liability_attorney', 'personal_injury_attorney'],
      legalVertical: 'personal_injury',
      rawData: r,
      detectedAt: new Date(r.report_date || Date.now()),
    }));
  } catch (err: any) {
    console.warn('[APEX-ENGINE] FDA recalls failed:', err.message);
    return [];
  }
}

// ── Code Enforcement (Home service leads) ─────────────────────────────────

async function fetchCodeEnforcement(): Promise<LeadSignal[]> {
  // opendata.leegov.com DNS fails from Railway — same domain as Lee permits (disabled)
  // TODO: replace with verified Lee County Socrata resource ID once confirmed working
  return [];
  const signals: LeadSignal[] = [];
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const _ceRes = await safeJsonFetch(
      `https://opendata.leegov.com/resource/code-enforcement.json?$where=open_date>'${since}'&$limit=100`,
      'Lee code enforcement',
      8000
    );
    const res = { ok: !!_ceRes, json: async () => _ceRes };
    if (res.ok) {
      const items = await res.json() as any[];
      for (const item of items) {
        const desc = (item.violation_description || item.description || '').toLowerCase();
        const cats: string[] = [];
        if (desc.includes('roof') || desc.includes('structure')) cats.push('roofing', 'general_contractor');
        if (desc.includes('lawn') || desc.includes('grass') || desc.includes('vegetation')) cats.push('lawn_landscaping');
        if (desc.includes('paint') || desc.includes('exterior')) cats.push('painting');
        if (desc.includes('fence')) cats.push('fence');
        if (desc.includes('pool')) cats.push('pool');
        if (!cats.length) continue;
        signals.push({
          id: item.case_number || crypto.randomUUID(),
          vertical: 'home_property',
          subVertical: 'code_enforcement',
          signalType: 'code_enforcement',
          county: 'LEE',
          state: 'FL',
          address: item.address,
          caseNumber: item.case_number,
          description: `Code violation — ${item.violation_description || 'Property violation'} at ${item.address}`,
          urgency: 'medium',
          serviceCategories: cats,
          rawData: item,
          detectedAt: new Date(item.open_date || Date.now()),
        });
      }
    }
  } catch (err: any) {
    console.warn('[APEX-ENGINE] Code enforcement failed:', err.message);
  }
  return signals;
}

// ── Main Engine Cycle ──────────────────────────────────────────────────────

export async function runApexLeadEngine(): Promise<void> {
  const runId = crypto.randomUUID().slice(0, 8);
  const startMs = Date.now();
  console.log(`[APEX-ENGINE] ── CYCLE START id=${runId} ──`);

  const sourceLabels = ["NOAA","LeePerm","CollierPerm","DBPR","Arrests","Courts","OSHA","Recalls","CodeEnf"];
  const settled = await Promise.allSettled([
    fetchNoaaAlerts(),
    fetchLeePermits(),
    fetchCollierPermits(),
    fetchDBPRLicenses(),
    fetchArrestRecords(),
    fetchCourtFilings(),
    fetchOSHAIncidents(),
    fetchProductRecalls(),
    fetchCodeEnforcement(),
  ]);
  const [noaa, leePerm, collierPerm, dbpr, arrests, courts, osha, recalls, code] =
    settled.map(x => x.status === 'fulfilled' ? x.value : []);

  settled.forEach((r, i) => {
    const n = r.status === 'fulfilled' ? r.value.length : 0;
    const e = r.status === 'rejected' ? ` ERR=${r.reason?.message}` : '';
    if (n > 0 || r.status === 'rejected') console.log(`[APEX-ENGINE] source=${sourceLabels[i]} fetched=${n}${e}`);
  });

  const allSignals: LeadSignal[] = [
    ...noaa, ...leePerm, ...collierPerm, ...dbpr,
    ...arrests, ...courts, ...osha, ...recalls, ...code,
  ];

  console.log(`[APEX-ENGINE] ${allSignals.length} raw signals fetched in ${Date.now() - startMs}ms`);

  let inserted = 0, dupes = 0, legal = 0, homeProperty = 0, beauty = 0;

  for (const signal of allSignals) {
    try {
      const hash = hashSignal(signal);
      if (await isDupe(hash)) { dupes++; continue; }

      if (signal.vertical === 'legal') {
        // Insert into legalLeads table
        await db.insert(legalLeads).values({
          legalVertical: signal.legalVertical || signal.subVertical,
          signalType: signal.signalType,
          county: signal.county,
          subjectName: signal.subjectName,
          subjectAddress: signal.address,
          chargeDescription: signal.chargeDescription || signal.description,
          caseNumber: signal.caseNumber,
          urgency: signal.urgency,
          score: signal.urgency === 'critical' ? 95 : signal.urgency === 'high' ? 80 : 60,
          status: 'available',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        } as any);
        legal++;
        import("./operator/apexIntelligence").then(({ reportOutcome }) =>
          reportOutcome({
            agentName:    "apex-engine",
            action:       "lead_created",
            subject:      signal.subjectName || signal.signalType,
            result:       `${signal.signalType} legal lead — ${signal.county}`,
            confidence:   signal.urgency === "critical" ? 0.95 : signal.urgency === "high" ? 0.8 : 0.6,
            subAccountId: APEX_PARENT_ACCOUNT_ID,
            niche:        "legal",
            metadata:     { signalType: signal.signalType, county: signal.county, vertical: signal.subVertical, urgency: signal.urgency },
          })
        ).catch((e: any) => console.warn("[APEX-OUTCOME] reportOutcome fire-and-forget error:", e?.message));
      } else {
        // Insert into homeServiceSignals table (covers home_property + beauty + auto)
        await db.insert(homeServiceSignals).values({
          sourceHash: hash,
          signalType: signal.signalType,
          county: signal.county,
          address: signal.address,
          ownerName: signal.subjectName,
          serviceCategories: signal.serviceCategories,
          urgency: signal.urgency,
          description: signal.description,
          rawData: signal.rawData,
          detectedAt: signal.detectedAt,
          status: 'raw',
        } as any);
        if (signal.vertical === 'beauty') beauty++;
        else homeProperty++;
        import("./operator/apexIntelligence").then(({ reportOutcome }) =>
          reportOutcome({
            agentName:    "apex-engine",
            action:       "signal_created",
            subject:      signal.subjectName || signal.signalType,
            result:       `${signal.signalType} signal — ${signal.county} (${signal.vertical})`,
            confidence:   0.7,
            subAccountId: APEX_PARENT_ACCOUNT_ID,
            niche:        "home_service",
            metadata:     { signalType: signal.signalType, county: signal.county, vertical: signal.vertical, categories: signal.serviceCategories },
          })
        ).catch((e: any) => console.warn("[APEX-OUTCOME] reportOutcome fire-and-forget error:", e?.message));
      }

      inserted++;
    } catch (err: any) {
      // skip dupes/constraint errors silently
      if (!err.message?.includes('unique') && !err.message?.includes('duplicate')) {
        console.warn(`[APEX-ENGINE] Insert failed for ${signal.signalType}:`, err.message);
      }
    }
  }

  console.log(`[APEX-ENGINE] CYCLE END id=${runId} | fetched=${allSignals.length} inserted=${inserted} dupes=${dupes} | legal=${legal} home=${homeProperty} beauty=${beauty} | ${Date.now() - startMs}ms`);
}

// ── Scheduler ─────────────────────────────────────────────────────────────

let engineTimer: NodeJS.Timeout | null = null;

export function startApexLeadEngine(): void {
  if (engineTimer) return;
  console.log('[APEX-ENGINE] Starting — all verticals active');
  runApexLeadEngine().catch(err => console.error('[APEX-ENGINE] Initial cycle error:', err.message));
  engineTimer = setInterval(() => {
    runApexLeadEngine().catch(err => console.error('[APEX-ENGINE] Cycle error:', err.message));
  }, POLL_INTERVAL_MS);
}

export function stopApexLeadEngine(): void {
  if (engineTimer) { clearInterval(engineTimer); engineTimer = null; }
}
