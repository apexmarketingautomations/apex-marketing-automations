/**
 * server/sentinel-accident-v2.ts
 *
 * Improvements to the Accident / Crash side of Sentinel.
 * This file documents and implements five improvement areas:
 *
 *   1. Resilient FHP HSMV scraper with header detection + structural validation
 *   2. Crash severity reclassification — separates severity from location priority
 *   3. Merge/dedup path — updates existing incidents instead of silently skipping
 *   4. Smart polling — peak-hour aware scheduling
 *   5. Priority scoring — basis for operator action queue
 *
 * INTEGRATION NOTES FOR BUILDER:
 *   - Functions here REPLACE specific functions in server/sentinel.ts
 *   - The scheduler replacement goes in the existing startSentinelScheduler()
 *   - The merge logic goes in the existing scan route handler
 *   - Do NOT merge Home Services logic into this file
 *   - Do NOT change the SentinelIncidentRaw interface shape — downstream code depends on it
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { getDistance } from 'geolib';

// ---------------------------------------------------------------------------
// IMPROVEMENT 1: Resilient scraper with header detection
//
// PROBLEM: Current parser uses hardcoded column indices (cols[0], cols[4], etc.)
// Any column addition, removal, or reorder silently breaks data ingestion.
//
// SOLUTION: Detect column positions from the header row at runtime.
// Fall back to known-good indices only if headers cannot be read.
// Log a structured warning whenever fallback is used so ops knows the
// page structure may have changed.
// ---------------------------------------------------------------------------

const FHP_HSMV_URL = "https://trafficincidents.flhsmv.gov/SmartWebClient/CADView.aspx";

// Known-good column indices as of last verified page structure.
// These are ONLY used when header detection fails.
// If you see "USING FALLBACK COLUMN INDICES" in logs, verify the page structure.
const FALLBACK_COLS = {
  TYPE:     0,
  RECEIVED: 1,
  COUNTY:   4,
  LOCATION: 5,
  REMARKS:  6,
  LAT:      7,
  LON:      8,
} as const;

// Header text patterns we expect to find in the FHP HSMV grid header row.
// Multiple variants handle minor label changes without breaking.
const HEADER_PATTERNS: Record<keyof typeof FALLBACK_COLS, string[]> = {
  TYPE:     ['TYPE', 'INCIDENT TYPE', 'CALL TYPE'],
  RECEIVED: ['RECEIVED', 'TIME', 'DATE/TIME'],
  COUNTY:   ['COUNTY'],
  LOCATION: ['LOCATION', 'ADDRESS', 'INCIDENT LOCATION'],
  REMARKS:  ['REMARKS', 'NOTES', 'COMMENT'],
  LAT:      ['LAT', 'LATITUDE'],
  LON:      ['LON', 'LNG', 'LONG', 'LONGITUDE'],
};

interface ColumnMap {
  TYPE: number;
  RECEIVED: number;
  COUNTY: number;
  LOCATION: number;
  REMARKS: number;
  LAT: number;
  LON: number;
  usingFallback: boolean;
  detectedHeaders: string[];
}

/**
 * Detects column positions from the grid header row.
 * Returns fallback indices with a warning flag if headers cannot be read.
 */
function detectColumnMap($: cheerio.CheerioAPI): ColumnMap {
  const detected: Partial<Record<keyof typeof FALLBACK_COLS, number>> = {};
  const detectedHeaders: string[] = [];

  // DevExpress grid headers: try multiple selector patterns
  // The grid may use dxgvHeader, dxgvHeaderCell, or a plain th inside the grid table
  const headerSelectors = [
    'tr.dxgvHeader td',
    'tr.dxgvHeader_MyGridView td',
    '.dxgvHeaderCell',
    'td.dxgvHeaderCell',
    '.dxgvHeader td',
  ];

  let headerCells: cheerio.Cheerio<any> | null = null;
  for (const sel of headerSelectors) {
    const found = $(sel);
    if (found.length > 0) {
      headerCells = found;
      break;
    }
  }

  // Inspect the first data row to know how many <td> the parser will see at runtime.
  // The DevExpress header row often contains extra empty <td> separators (sort icons,
  // resize handles, etc.) that do NOT exist in data rows. If we map column indices
  // off the raw header row, the data-row indices will be wrong and every row gets
  // skipped silently. Build the index map against the data row's column count.
  const firstDataRow = $('.dxgvDataRow').first();
  const dataRowTdCount = firstDataRow.length > 0 ? firstDataRow.find('td').length : 0;

  if (headerCells && headerCells.length > 0) {
    // Capture raw header text for diagnostics (preserves original layout/empties)
    const rawHeaders: string[] = [];
    headerCells.each((_i, el) => {
      rawHeaders.push($(el).text().trim().toUpperCase());
    });

    // Decide which indexing strategy to use:
    //   - If header td count matches data row td count → headers and data are aligned 1:1
    //   - If counts differ → header has separator cells; build a "dense" view that only
    //     keeps headers that have actual text and use that index instead.
    const headerCount = headerCells.length;
    const useDenseMapping =
      dataRowTdCount > 0 && headerCount !== dataRowTdCount;

    if (useDenseMapping) {
      const denseHeaders = rawHeaders
        .map((text, origIdx) => ({ text, origIdx }))
        .filter(h => h.text.length > 0);

      denseHeaders.forEach((h, denseIdx) => {
        detectedHeaders.push(h.text);
        for (const [col, patterns] of Object.entries(HEADER_PATTERNS)) {
          if (patterns.some(p => h.text.includes(p))) {
            detected[col as keyof typeof FALLBACK_COLS] = denseIdx;
          }
        }
      });

      // Sanity check: the dense header count should match the data row td count.
      // If it doesn't, log it so ops sees the page structure has drifted.
      if (denseHeaders.length !== dataRowTdCount) {
        console.warn(
          `[SENTINEL SCRAPER] Header alignment mismatch: ` +
          `${headerCount} raw header cells, ${denseHeaders.length} non-empty headers, ` +
          `${dataRowTdCount} data row cells. Mapping may be off — verify FHP page structure.`
        );
      }
    } else {
      // Header and data cell counts already match — use raw indices.
      rawHeaders.forEach((text, i) => {
        detectedHeaders.push(text);
        for (const [col, patterns] of Object.entries(HEADER_PATTERNS)) {
          if (patterns.some(p => text.includes(p))) {
            detected[col as keyof typeof FALLBACK_COLS] = i;
          }
        }
      });
    }
  }

  const allDetected = Object.keys(FALLBACK_COLS).every(
    k => detected[k as keyof typeof FALLBACK_COLS] !== undefined
  );

  if (!allDetected) {
    const missing = Object.keys(FALLBACK_COLS).filter(
      k => detected[k as keyof typeof FALLBACK_COLS] === undefined
    );
    console.warn(
      `[SENTINEL SCRAPER] Header detection incomplete — missing: ${missing.join(', ')}. ` +
      `USING FALLBACK COLUMN INDICES. Page structure may have changed. ` +
      `Detected headers: [${detectedHeaders.join(' | ')}]`
    );
  }

  return {
    TYPE:     detected.TYPE     ?? FALLBACK_COLS.TYPE,
    RECEIVED: detected.RECEIVED ?? FALLBACK_COLS.RECEIVED,
    COUNTY:   detected.COUNTY   ?? FALLBACK_COLS.COUNTY,
    LOCATION: detected.LOCATION ?? FALLBACK_COLS.LOCATION,
    REMARKS:  detected.REMARKS  ?? FALLBACK_COLS.REMARKS,
    LAT:      detected.LAT      ?? FALLBACK_COLS.LAT,
    LON:      detected.LON      ?? FALLBACK_COLS.LON,
    usingFallback: !allDetected,
    detectedHeaders,
  };
}

/**
 * Validates that the parsed HTML looks like the FHP HSMV incident page.
 * Returns a structured health report so callers can log or alert on degraded state.
 */
interface ScraperHealthReport {
  ok: boolean;
  dataRowCount: number;
  usingFallbackColumns: boolean;
  detectedHeaders: string[];
  warnings: string[];
}

function validatePageStructure(
  $: cheerio.CheerioAPI,
  colMap: ColumnMap,
  dataRowCount: number
): ScraperHealthReport {
  const warnings: string[] = [];

  if (dataRowCount === 0) {
    warnings.push('No data rows found — page may be empty or structure changed');
  }
  if (colMap.usingFallback) {
    warnings.push(`Column header detection failed — using hardcoded fallback indices`);
  }

  // Sanity check: does the page have a table at all?
  const tableCount = $('table').length;
  if (tableCount === 0) {
    warnings.push('No tables found on page — may be an error page or login redirect');
  }

  return {
    ok: warnings.length === 0,
    dataRowCount,
    usingFallbackColumns: colMap.usingFallback,
    detectedHeaders: colMap.detectedHeaders,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// IMPROVEMENT 2: Crash severity reclassification
//
// PROBLEM: Current code conflates crash severity with operator relevance.
// A fender bender in Lee County gets 'critical' severity because the county
// matches, not because the crash is actually critical. This makes severity
// meaningless for triage.
//
// SOLUTION: Two separate concepts:
//   - crashSeverity: how bad is the actual crash (outcome-based)
//   - operatorPriority: how relevant is this to the operator's territory
//
// Operators see severity for medical/legal urgency signal.
// Priority drives sort order and alert thresholds.
// ---------------------------------------------------------------------------

/**
 * Classifies crash severity based on crash outcome indicators only.
 * Does NOT consider geography. Geography is operatorPriority's job.
 */
export function classifyCrashSeverity(
  type: string,
  remarks: string,
): 'critical' | 'high' | 'medium' | 'low' {
  const t = type.toUpperCase();
  const r = remarks.toUpperCase();
  const combined = `${t} ${r}`;

  // Fatal — highest severity regardless of other factors
  if (
    combined.includes('FATAL') ||
    combined.includes('FATALITY') ||
    combined.includes('DEATH') ||
    combined.includes('DOA')
  ) return 'critical';

  // Entrapment or extrication — life-threatening, requires heavy rescue
  if (
    combined.includes('ENTRAP') ||
    combined.includes('EXTRICAT') ||
    combined.includes('PINNED') ||
    combined.includes('TRAPPED')
  ) return 'critical';

  // Serious injury indicators
  if (
    combined.includes('SERIOUS INJUR') ||
    combined.includes('CRITICAL INJUR') ||
    combined.includes('TRAUMA') ||
    combined.includes('UNCONSCIOUS') ||
    combined.includes('UNRESPONSIVE') ||
    combined.includes('EMS REQUESTED') ||
    combined.includes('RESCUE') ||
    combined.includes('FIRE RESCUE')
  ) return 'high';

  // Rollover — high mechanical energy, elevated injury risk
  if (combined.includes('ROLLOVER') || combined.includes('ROLL OVER')) return 'high';

  // General injury — reported but not specified as serious
  if (
    combined.includes('INJUR') ||
    combined.includes('INJURIES') ||
    combined.includes('INJURED')
  ) return 'high';

  // Hit and run — property/injury unknown, elevated priority for legal reasons
  if (
    combined.includes('HIT AND RUN') ||
    combined.includes('H&R') ||
    combined.includes('HIT-AND-RUN')
  ) return 'medium';

  // Property damage / standard crash
  if (
    combined.includes('MVA') ||
    combined.includes('CRASH') ||
    combined.includes('COLLISION') ||
    combined.includes('ACCIDENT') ||
    combined.includes('SIGNAL 4') ||
    combined.includes('PDO') ||  // Property Damage Only
    combined.includes('PROPERTY DAMAGE')
  ) return 'medium';

  return 'low';
}

/**
 * Classifies operator-specific priority based on territory relevance.
 * This is SEPARATE from crash severity.
 * Returns 'urgent', 'standard', or 'monitor'.
 *
 * urgent   = in territory AND high/critical severity
 * standard = in territory, any severity
 * monitor  = outside territory (statewide awareness only)
 */
export function classifyOperatorPriority(params: {
  county: string;
  location: string;
  severity: string;
  distanceMiles: string | number;
  targetCounties: string[];
  targetCities: string[];
  maxRadiusMiles?: number;
}): 'urgent' | 'standard' | 'monitor' {
  const countyUpper = params.county.toUpperCase();
  const locationUpper = params.location.toUpperCase();

  const countyMatch = params.targetCounties.some(
    c => countyUpper.includes(c.toUpperCase())
  );
  const cityMatch = params.targetCities.some(
    c => locationUpper.includes(c.toUpperCase())
  );

  let withinRadius = false;
  if (params.maxRadiusMiles !== undefined) {
    const dist = parseFloat(String(params.distanceMiles));
    if (!isNaN(dist)) withinRadius = dist <= params.maxRadiusMiles;
  }

  const isInTerritory = countyMatch || cityMatch || withinRadius;
  if (!isInTerritory) return 'monitor';

  const highSeverity = params.severity === 'critical' || params.severity === 'high';
  return highSeverity ? 'urgent' : 'standard';
}

// ---------------------------------------------------------------------------
// IMPROVEMENT 3: Priority score for operator action queue
//
// Combines severity, operator priority, and recency into a single number.
// Higher score = should appear higher in the action queue.
// Used by the frontend to sort incidents without requiring a DB change.
// Stored in rawPayload.priorityScore so it survives page refreshes.
// ---------------------------------------------------------------------------

export function computePriorityScore(params: {
  severity: string;
  operatorPriority: string;
  receivedAt: string | null;
}): number {
  const severityScore: Record<string, number> = {
    critical: 1000,
    high:     500,
    medium:   200,
    low:      50,
  };
  const priorityScore: Record<string, number> = {
    urgent:   300,
    standard: 100,
    monitor:  0,
  };

  const base =
    (severityScore[params.severity] ?? 50) +
    (priorityScore[params.operatorPriority] ?? 0);

  // Recency bonus: decays over time. Full bonus for first 30 min, zero after 4 hours.
  let recencyBonus = 0;
  if (params.receivedAt) {
    const ageMs = Date.now() - new Date(params.receivedAt).getTime();
    const ageMinutes = ageMs / 60_000;
    if (ageMinutes < 30)  recencyBonus = 200;
    else if (ageMinutes < 60)  recencyBonus = 150;
    else if (ageMinutes < 120) recencyBonus = 80;
    else if (ageMinutes < 240) recencyBonus = 20;
  }

  return base + recencyBonus;
}

// ---------------------------------------------------------------------------
// IMPROVEMENT 4: Smart polling — peak-hour aware scheduling
//
// PROBLEM: Fixed 15-minute interval runs at 3am the same as 5pm Friday.
// Peak accident hours are predictable. Polling more frequently during them
// reduces time-to-alert without changing infrastructure.
//
// Peak accident windows (US data):
//   - Morning rush:  06:00 – 09:00
//   - Evening rush:  16:00 – 19:00
//   - Late night:    22:00 – 02:00 (DUI risk window)
//   - Friday/Saturday evenings get elevated weight
//
// SOLUTION: Dynamic interval that compresses during peak windows.
// ---------------------------------------------------------------------------

export interface PollSchedule {
  intervalMs: number;
  reason: string;
  isPeak: boolean;
}

export function getPollSchedule(
  baseIntervalMs: number,
  now: Date = new Date(),
): PollSchedule {
  const hour = now.getHours();
  const day  = now.getDay(); // 0=Sunday, 5=Friday, 6=Saturday

  const isMorningRush  = hour >= 6  && hour <= 9;
  const isEveningRush  = hour >= 16 && hour <= 19;
  const isLateNight    = hour >= 22 || hour <= 2;
  const isWeekendNight = (day === 5 || day === 6) && (hour >= 21 || hour <= 3);

  if (isWeekendNight) {
    return {
      intervalMs: Math.min(baseIntervalMs, 3 * 60_000),  // max 3 min
      reason:     'weekend-night-elevated',
      isPeak:     true,
    };
  }
  if (isEveningRush) {
    return {
      intervalMs: Math.min(baseIntervalMs, 4 * 60_000),  // max 4 min
      reason:     'evening-rush',
      isPeak:     true,
    };
  }
  if (isMorningRush) {
    return {
      intervalMs: Math.min(baseIntervalMs, 5 * 60_000),  // max 5 min
      reason:     'morning-rush',
      isPeak:     true,
    };
  }
  if (isLateNight) {
    return {
      intervalMs: Math.min(baseIntervalMs, 6 * 60_000),  // max 6 min
      reason:     'late-night',
      isPeak:     true,
    };
  }

  // Off-peak: use full configured interval, no compression
  return {
    intervalMs: baseIntervalMs,
    reason:     'off-peak',
    isPeak:     false,
  };
}

// ---------------------------------------------------------------------------
// IMPROVEMENT 5: Merge path for existing incidents
//
// PROBLEM: Current scan handler calls getSentinelIncidentByHash and does:
//   if (existing) continue;  ← silently skips, even if severity upgraded
//
// This means an incident that started as a property damage crash and was
// upgraded by dispatch to a fatality will never get updated in the system.
//
// SOLUTION: When an existing incident is found, check if:
//   a) Severity has increased → update severity, log the change
//   b) Crash is still active (not cleared) → update description/remarks
//   c) Severity jumped to critical and incident was acknowledged → re-pend it
//
// The merge function returns an action so the caller knows what happened.
// ---------------------------------------------------------------------------

export type MergeAction =
  | 'created'           // New incident — did not exist
  | 'severity_upgraded' // Existed, severity increased
  | 'severity_downgraded_skip' // Existed, severity decreased — no change (don't downgrade)
  | 're_pended'         // Existed, was acked, severity jumped to critical — re-pended
  | 'skipped'           // Existed, no meaningful change

export interface MergeResult {
  action: MergeAction;
  incidentId: number;
}

const SEVERITY_RANK: Record<string, number> = {
  low: 0, medium: 1, high: 2, critical: 3,
};

/**
 * Builds a partial update object for an existing incident based on new scan data.
 * Returns null if no update is warranted.
 */
export function buildCrashMergeUpdate(params: {
  existingSeverity: string;
  existingActionStatus: string;
  newSeverity: string;
  newDescription: string | null;
  newRawPayload: Record<string, any>;
}): {
  updates: Record<string, any>;
  action: MergeAction;
} | null {
  const existingRank = SEVERITY_RANK[params.existingSeverity] ?? 0;
  const newRank      = SEVERITY_RANK[params.newSeverity]      ?? 0;

  // Severity decreased or stayed same — do not downgrade, do not update
  if (newRank <= existingRank) {
    return { updates: {}, action: 'severity_downgraded_skip' };
  }

  // Severity increased
  const updates: Record<string, any> = {
    severity:    params.newSeverity,
    description: params.newDescription,
    rawPayload:  params.newRawPayload,
  };

  // If the incident was acknowledged and now became critical, re-pend it
  // so the operator sees it again. Do not re-pend for high — that would be noisy.
  const repend =
    newRank >= SEVERITY_RANK['critical'] &&
    params.existingActionStatus === 'acknowledged';

  if (repend) {
    updates.actionStatus = 'pending';
    return { updates, action: 're_pended' };
  }

  return { updates, action: 'severity_upgraded' };
}

// ---------------------------------------------------------------------------
// IMPROVEMENT 6: Geofence coordinate validation
//
// PROBLEM: deployGeofenceAd() is called with lat/lng from the FHP feed.
// Some incidents have null coords. Some have coordinates that are (0, 0)
// or otherwise outside Florida's geographic bounds.
// Deploying a geofence to coordinates in the Gulf of Guinea is wasteful.
//
// SOLUTION: Validate coordinates before geofence deployment.
// Florida bounding box: lat 24.4–31.1, lng -87.6 to -80.0
// If coords are invalid, fall back to address-string targeting.
// ---------------------------------------------------------------------------

const FLORIDA_BOUNDS = {
  minLat: 24.4,
  maxLat: 31.1,
  minLng: -87.6,
  maxLng: -80.0,
};

export function validateFloridaCoordinates(
  lat: number | null | undefined,
  lng: number | null | undefined,
): { valid: boolean; reason?: string } {
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return { valid: false, reason: 'coordinates_null' };
  }
  if (lat === 0 && lng === 0) {
    return { valid: false, reason: 'zero_coordinates' };
  }
  if (
    lat < FLORIDA_BOUNDS.minLat || lat > FLORIDA_BOUNDS.maxLat ||
    lng < FLORIDA_BOUNDS.minLng || lng > FLORIDA_BOUNDS.maxLng
  ) {
    return { valid: false, reason: `out_of_bounds: ${lat.toFixed(4)}, ${lng.toFixed(4)}` };
  }
  return { valid: true };
}

/**
 * Returns the best available targeting input for a geofence deployment.
 * Prefers validated lat/lng. Falls back to address string.
 * Returns null if neither is available — caller should not deploy.
 */
export function resolveGeofenceTarget(params: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  location: string | null | undefined;
}): { type: 'coordinates'; lat: number; lng: number } |
   { type: 'address'; address: string } |
   null {
  const coordCheck = validateFloridaCoordinates(params.lat, params.lng);
  if (coordCheck.valid && params.lat !== null && params.lng !== null) {
    return { type: 'coordinates', lat: params.lat!, lng: params.lng! };
  }

  if (coordCheck.reason && coordCheck.reason !== 'coordinates_null') {
    console.warn(`[SENTINEL GEOFENCE] Invalid coordinates (${coordCheck.reason}) — falling back to address targeting`);
  }

  if (params.location && params.location.trim().length > 5) {
    return { type: 'address', address: params.location.trim() };
  }

  console.warn('[SENTINEL GEOFENCE] No valid coordinates or address — cannot deploy geofence');
  return null;
}

// ---------------------------------------------------------------------------
// IMPROVED FHP HSMV FEED FUNCTION
//
// Drop-in replacement for processFHPHSMVFeed() in sentinel.ts.
// Key improvements over the original:
//   - Header detection (not hardcoded column indices)
//   - Structural health reporting
//   - classifyCrashSeverity() instead of location-conflated severity
//   - operatorPriority computed separately from severity
//   - priorityScore computed for action queue sorting
//   - Coordinate validation before storing lat/lng
// ---------------------------------------------------------------------------

// Re-export the interface shape from sentinel.ts for local use
// (Builder: import SentinelIncidentRaw from sentinel.ts, not from here)
export interface CrashIncidentRaw {
  id: string;
  type: string;
  location: string;
  lat: number | null;
  lng: number | null;
  severity: 'critical' | 'high' | 'medium' | 'low';
  operatorPriority: 'urgent' | 'standard' | 'monitor';
  priorityScore: number;
  actionRequired: boolean;
  source: string;
  state: string;
  county: string;
  remarks: string;
  received: string;
  distanceMiles: string;
  googleMaps?: string;
  scraperHealth?: ScraperHealthReport;
}

const SWFL_TARGET_COUNTIES = ['LEE', 'COLLIER', 'CHARLOTTE', 'HENDRY', 'GLADES'];
const SWFL_TARGET_CITIES = [
  'CAPE CORAL', 'FORT MYERS', 'FT MYERS', 'FT. MYERS',
  'NORTH FORT MYERS', 'N FORT MYERS', 'NAPLES', 'BONITA SPRINGS',
  'BONITA', 'LEHIGH ACRES', 'LEHIGH', 'ESTERO', 'MARCO ISLAND',
  'IMMOKALEE', 'LABELLE', 'PUNTA GORDA', 'PORT CHARLOTTE', 'SANIBEL',
];

function stableHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export async function processFHPHSMVFeedV2(overrideConfig?: {
  targetCounties?: string[];
  targetCities?: string[];
  maxRadiusMiles?: number;
  clientLat?: number;
  clientLon?: number;
}): Promise<{ incidents: CrashIncidentRaw[]; health: ScraperHealthReport }> {
  const targetCounties = overrideConfig?.targetCounties ?? SWFL_TARGET_COUNTIES;
  const targetCities   = overrideConfig?.targetCities   ?? SWFL_TARGET_CITIES;
  const maxRadius      = overrideConfig?.maxRadiusMiles;
  const clientLat      = overrideConfig?.clientLat ?? parseFloat(process.env.CLIENT_LAT || '');
  const clientLon      = overrideConfig?.clientLon ?? parseFloat(process.env.CLIENT_LON || '');
  const hasClientLoc   = !isNaN(clientLat) && !isNaN(clientLon);

  console.log(`[SENTINEL SCRAPER] Fetching FHP HSMV live feed...`);

  let response: any;
  try {
    response = await axios.get(FHP_HSMV_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 15_000,
      validateStatus: () => true,
    });
  } catch (err: any) {
    const msg = err?.code === 'ECONNABORTED'
      ? 'FHP HSMV request timeout after 15s'
      : `FHP HSMV network error: ${err?.message}`;
    console.error(`[SENTINEL SCRAPER] ${msg}`);
    return {
      incidents: [],
      health: { ok: false, dataRowCount: 0, usingFallbackColumns: false, detectedHeaders: [], warnings: [msg] },
    };
  }

  if (response.status !== 200) {
    const msg = `FHP HSMV HTTP ${response.status}`;
    console.error(`[SENTINEL SCRAPER] ${msg}`);
    return {
      incidents: [],
      health: { ok: false, dataRowCount: 0, usingFallbackColumns: false, detectedHeaders: [], warnings: [msg] },
    };
  }

  const html: string = response.data;
  if (!html || html.length < 500) {
    const msg = 'FHP HSMV response too short — may be empty or error page';
    console.warn(`[SENTINEL SCRAPER] ${msg}`);
    return {
      incidents: [],
      health: { ok: false, dataRowCount: 0, usingFallbackColumns: false, detectedHeaders: [], warnings: [msg] },
    };
  }

  const $ = cheerio.load(html);

  // Detect column positions from header row
  const colMap = detectColumnMap($);

  const dataRows = $('.dxgvDataRow');
  const health = validatePageStructure($, colMap, dataRows.length);

  if (dataRows.length === 0) {
    console.log(`[SENTINEL SCRAPER] No data rows found. Health: ${JSON.stringify(health.warnings)}`);
    return { incidents: [], health };
  }

  const incidents: CrashIncidentRaw[] = [];
  const seenHashes = new Set<string>();

  dataRows.each((_i, el) => {
    const cols = $(el).find('td');

    // Use detected column positions — not hardcoded indices
    const type     = $(cols[colMap.TYPE]).text().trim();
    const received = $(cols[colMap.RECEIVED]).text().trim();
    const county   = $(cols[colMap.COUNTY]).text().trim();
    const location = $(cols[colMap.LOCATION]).text().trim();
    const remarks  = $(cols[colMap.REMARKS]).text().trim();
    const latRaw   = $(cols[colMap.LAT]).text().trim();
    const lonRaw   = $(cols[colMap.LON]).text().trim();

    if (!type || !location) return; // Skip empty rows

    // Filter: crash events only
    const typeUpper = type.toUpperCase();
    const isCrash =
      typeUpper.includes('CRASH')    ||
      typeUpper.includes('FATALITY') ||
      typeUpper.includes('HIT AND RUN') ||
      typeUpper.includes('H&R')      ||
      typeUpper.includes('ACCIDENT') ||
      typeUpper.includes('COLLISION') ||
      typeUpper.includes('ROLLOVER') ||
      typeUpper.includes('MVA');

    if (!isCrash) return;

    // Validate and store coordinates
    const latParsed = parseFloat(latRaw);
    const lonParsed = parseFloat(lonRaw);
    const coordCheck = validateFloridaCoordinates(latParsed, lonParsed);
    const lat = coordCheck.valid ? latParsed : null;
    const lng = coordCheck.valid ? lonParsed : null;

    // Distance from operator HQ
    let distanceMiles = 'unknown';
    if (lat !== null && lng !== null && hasClientLoc) {
      const distMeters = getDistance(
        { latitude: lat, longitude: lng },
        { latitude: clientLat, longitude: clientLon },
      );
      distanceMiles = (distMeters / 1609.34).toFixed(2);
    }

    // Dedup
    const contentHash = stableHash(`${type}|${received}|${location}|${latRaw}`);
    if (seenHashes.has(contentHash)) return;
    seenHashes.add(contentHash);

    // Classify severity based on crash outcome — not geography
    const severity = classifyCrashSeverity(type, remarks);

    // Classify operator priority based on territory match
    const operatorPriority = classifyOperatorPriority({
      county,
      location,
      severity,
      distanceMiles,
      targetCounties,
      targetCities,
      maxRadiusMiles: maxRadius,
    });

    // Compute priority score for action queue sorting
    const priorityScore = computePriorityScore({
      severity,
      operatorPriority,
      receivedAt: received || null,
    });

    const stableId = `FHP-${county}-${stableHash(received + location)}`;
    const googleMaps = lat !== null && lng !== null
      ? `https://www.google.com/maps?q=${lat},${lng}`
      : undefined;

    incidents.push({
      id:               stableId,
      type,
      location:         `${location}, ${county} County, FL`,
      lat,
      lng,
      severity,
      operatorPriority,
      priorityScore,
      actionRequired:   operatorPriority === 'urgent',
      source:           'fhp_hsmv',
      state:            'FL',
      county,
      remarks,
      received,
      distanceMiles,
      googleMaps,
    });
  });

  const urgentCount   = incidents.filter(i => i.operatorPriority === 'urgent').length;
  const standardCount = incidents.filter(i => i.operatorPriority === 'standard').length;
  console.log(
    `[SENTINEL SCRAPER] ${incidents.length} crashes parsed — ` +
    `${urgentCount} urgent, ${standardCount} standard, ` +
    `${incidents.length - urgentCount - standardCount} monitor-only. ` +
    `Scraper health: ${health.ok ? 'OK' : 'DEGRADED'}`
  );

  return { incidents, health };
}
