/**
 * server/sentinel-home-svc.ts
 *
 * Sentinel Home Services — Level 2 signal ingestion module.
 *
 * ISOLATION CONTRACT — enforced:
 *   - Does NOT import from server/sentinel.ts
 *   - Does NOT call processLiveSentinelFeed()
 *   - Does NOT call processFHPHSMVFeed()
 *   - Does NOT use determineSeverity()
 *   - Does NOT use deployGeofenceAd()
 *   - Is NOT invoked by the accident scheduler
 *   - Is ONLY called from the Home Services scan branch in routes/sentinel.ts
 *
 * If any of the above ever needs to change, stop and flag it as a production risk.
 */

import axios from 'axios';

// ---------------------------------------------------------------------------
// Local types — no coupling to sentinel.ts
// ---------------------------------------------------------------------------

export interface HomeSvcSignal {
  id: string;             // Stable NOAA alert ID — used as dedup key
  event: string;          // Raw NOAA event string
  signalType: string;     // Classified: 'hail' | 'high_wind' | 'flood' | etc.
  serviceTypes: string[]; // Inferred: ['roofing', 'gutters', ...]
  severity: 'critical' | 'high' | 'medium' | 'low';
  noaaSeverity: string;   // Raw NOAA value: Extreme | Severe | Moderate | Minor
  noaaUrgency: string;    // Raw NOAA value: Immediate | Expected | Future | Past
  noaaCertainty: string;  // Raw NOAA value: Observed | Likely | Possible | Unlikely
  areaDesc: string;       // Human-readable area affected
  state: string;          // Queried state code(s) — scan context, not inferred from alert geometry
  headline: string;       // NOAA headline string
  sent: string;           // ISO timestamp when alert was issued
  expires: string | null; // ISO timestamp when alert expires
  effective: string | null; // ISO timestamp when alert becomes effective
  lat: number | null;     // Polygon centroid — MAP DISPLAY ONLY. Never use for geofence targeting.
  lng: number | null;     // Polygon centroid — MAP DISPLAY ONLY. Never use for geofence targeting.
  googleMaps: string | undefined;
  actionRequired: boolean; // True when Immediate urgency or Extreme/Severe severity
}

// ---------------------------------------------------------------------------
// Signal type → service category mapping
// Pure data. Update this map when coverage needs to expand.
// ---------------------------------------------------------------------------

const SIGNAL_SERVICE_MAP: Record<string, string[]> = {
  hail:         ['roofing', 'gutters', 'siding'],
  high_wind:    ['roofing', 'fencing', 'tree_removal', 'gutters'],
  severe_storm: ['storm_cleanup', 'tree_removal', 'roofing', 'gutters', 'water_restoration'],
  flood:        ['water_restoration', 'plumbing', 'mold_remediation'],
  flash_flood:  ['water_restoration', 'plumbing', 'mold_remediation'],
  freeze:       ['plumbing', 'hvac'],
  heat:         ['hvac'],
  tornado:      ['roofing', 'storm_cleanup', 'tree_removal', 'water_restoration'],
  thunderstorm: ['roofing', 'gutters', 'tree_removal'],
  winter_storm: ['hvac', 'roofing', 'plumbing'],
  storm:        ['storm_cleanup', 'roofing', 'gutters'],
};

// NOAA event strings that qualify as Home Services relevant.
// All other alert types are skipped — do not create incidents for
// fog advisories, air quality alerts, marine warnings, rip currents, etc.
const RELEVANT_NOAA_EVENTS: string[] = [
  'SEVERE THUNDERSTORM',
  'TORNADO',
  'FLASH FLOOD',
  'FLOOD WARNING',
  'FLOOD WATCH',
  'FLOOD ADVISORY',
  'HIGH WIND',
  'WIND ADVISORY',
  'WIND WARNING',
  'FREEZE WARNING',
  'FREEZE WATCH',
  'FROST ADVISORY',
  'WINTER STORM',
  'WINTER WEATHER',
  'ICE STORM',
  'BLIZZARD',
  'EXCESSIVE HEAT',
  'HEAT ADVISORY',
  'HURRICANE',
  'TROPICAL STORM',
];

// ---------------------------------------------------------------------------
// Signal classification
// Order matters: more specific matches must come before broader ones.
// ---------------------------------------------------------------------------

export function classifySignalType(noaaEvent: string): string {
  const e = noaaEvent.toUpperCase();
  if (e.includes('TORNADO'))                                          return 'tornado';
  if (e.includes('HURRICANE') || e.includes('TROPICAL'))             return 'severe_storm';
  if (e.includes('FLASH FLOOD'))                                     return 'flash_flood';
  if (e.includes('FLOOD'))                                           return 'flood';
  if (e.includes('SEVERE THUNDERSTORM'))                             return 'severe_storm';
  if (e.includes('WIND'))                                            return 'high_wind';
  if (e.includes('FREEZE') || e.includes('FROST'))                   return 'freeze';
  if (e.includes('EXCESSIVE HEAT') || e.includes('HEAT ADVISORY'))   return 'heat';
  if (
    e.includes('WINTER') ||
    e.includes('ICE STORM') ||
    e.includes('BLIZZARD')
  )                                                                   return 'winter_storm';
  if (e.includes('THUNDERSTORM'))                                    return 'thunderstorm';
  return 'storm';
}

// ---------------------------------------------------------------------------
// Service category inference
// ---------------------------------------------------------------------------

export function inferServiceCategories(signalType: string): string[] {
  return SIGNAL_SERVICE_MAP[signalType] ?? ['storm_cleanup'];
}

// ---------------------------------------------------------------------------
// Severity scoring
// Separate from accident determineSeverity(). Never import that function here.
// ---------------------------------------------------------------------------

export function classifyHomeSvcSeverity(
  noaaSeverity: string,
  noaaUrgency: string,
): 'critical' | 'high' | 'medium' | 'low' {
  if (noaaSeverity === 'Extreme')                                     return 'critical';
  if (noaaSeverity === 'Severe' && noaaUrgency === 'Immediate')       return 'critical';
  if (noaaSeverity === 'Severe')                                      return 'high';
  if (noaaSeverity === 'Moderate' && noaaUrgency === 'Immediate')     return 'high';
  if (noaaSeverity === 'Moderate')                                    return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Alert relevance filter
// ---------------------------------------------------------------------------

function isRelevantAlert(event: string): boolean {
  const e = event.toUpperCase();
  return RELEVANT_NOAA_EVENTS.some(keyword => e.includes(keyword));
}

// ---------------------------------------------------------------------------
// Geometry: polygon centroid approximation
//
// NOAA alerts cover polygon areas, not points. We use a ring centroid
// for map display and rough lat/lng only. This is NOT suitable for
// precise geofence targeting — that is a Level 3 concern.
// ---------------------------------------------------------------------------

function polygonRingCentroid(
  ring: number[][],
): { lat: number; lng: number } | null {
  if (!ring || ring.length === 0) return null;
  const sumLng = ring.reduce((s, c) => s + c[0], 0);
  const sumLat = ring.reduce((s, c) => s + c[1], 0);
  return { lat: sumLat / ring.length, lng: sumLng / ring.length };
}

function extractCentroid(geometry: any): { lat: number; lng: number } | null {
  if (!geometry || !geometry.type) return null;

  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    const [lng, lat] = geometry.coordinates;
    return { lat, lng };
  }

  if (geometry.type === 'Polygon') {
    return polygonRingCentroid(geometry.coordinates?.[0]);
  }

  if (geometry.type === 'MultiPolygon') {
    // Use the first polygon's outer ring
    return polygonRingCentroid(geometry.coordinates?.[0]?.[0]);
  }

  return null;
}

// ---------------------------------------------------------------------------
// NOAA NWS active alerts fetch
//
// API: https://api.weather.gov/alerts/active
// No API key required. Requires a User-Agent header per NOAA policy.
// Update NOAA_USER_AGENT before production use.
// ---------------------------------------------------------------------------

const NOAA_BASE_URL = 'https://api.weather.gov/alerts/active';
const NOAA_USER_AGENT = 'ApexSentinelHomeSvc/2.0 (support@apexmarketingautomations.com)';
const NOAA_TIMEOUT_MS = 15_000;

export async function fetchHomeSvcSignals(
  targetStates: string[],
): Promise<HomeSvcSignal[]> {
  // Validate and normalize state codes — 2-letter uppercase only.
  const states = targetStates
    .map(s => s.trim().toUpperCase())
    .filter(s => /^[A-Z]{2}$/.test(s));

  if (states.length === 0) {
    console.warn(
      '[SENTINEL HOME SVC] No valid targetStates configured — skipping NOAA fetch. ' +
      'Configure 2-letter US state codes (e.g. FL, TX) in Sentinel config > Target States.',
    );
    return [];
  }

  const areaParam = states.join(',');
  const url =
    `${NOAA_BASE_URL}?area=${areaParam}&status=actual&message_type=alert`;

  console.log(`[SENTINEL HOME SVC] Fetching NOAA alerts for: ${areaParam}`);

  let response: any;
  try {
    response = await axios.get(url, {
      headers: {
        'User-Agent': NOAA_USER_AGENT,
        'Accept': 'application/geo+json',
      },
      timeout: NOAA_TIMEOUT_MS,
      validateStatus: () => true, // Handle all HTTP statuses manually
    });
  } catch (err: any) {
    if (err?.code === 'ECONNABORTED') {
      console.error(`[SENTINEL HOME SVC] NOAA request timed out after ${NOAA_TIMEOUT_MS}ms`);
    } else {
      console.error('[SENTINEL HOME SVC] NOAA network error:', err?.code, err?.message);
    }
    return [];
  }

  if (response.status !== 200) {
    console.error(
      `[SENTINEL HOME SVC] NOAA returned HTTP ${response.status} for area: ${areaParam}`,
    );
    return [];
  }

  const features = response.data?.features;
  if (!Array.isArray(features)) {
    console.error(
      '[SENTINEL HOME SVC] NOAA response missing features array — unexpected response shape',
    );
    return [];
  }

  if (features.length === 0) {
    console.log(`[SENTINEL HOME SVC] No active alerts from NOAA for: ${areaParam}`);
    return [];
  }

  const signals: HomeSvcSignal[] = [];
  const seenIds = new Set<string>();

  for (const feature of features) {
    const props = feature?.properties;
    if (!props) continue;

    const event: string = props.event || '';
    if (!event || !isRelevantAlert(event)) continue;

    // Stable dedup key.
    // GeoJSON features carry their ID at the feature level (feature.id), not
    // only inside properties. NOAA uses this correctly. Check feature.id first,
    // then fall back to properties.id, then properties['@id'] (full URN form).
    // All three are stable across repeated fetches of the same active alert.
    const alertId: string = feature?.id || props.id || props['@id'] || '';
    if (!alertId) {
      console.warn('[SENTINEL HOME SVC] Alert has no ID, skipping:', event);
      continue;
    }
    if (seenIds.has(alertId)) continue;
    seenIds.add(alertId);

    const noaaSeverity: string = props.severity || 'Unknown';
    const noaaUrgency: string  = props.urgency   || 'Unknown';
    const noaaCertainty: string = props.certainty || 'Unknown';

    const signalType   = classifySignalType(event);
    const serviceTypes = inferServiceCategories(signalType);
    const severity     = classifyHomeSvcSeverity(noaaSeverity, noaaUrgency);

    const centroid = extractCentroid(feature.geometry);
    const lat = centroid?.lat ?? null;
    const lng = centroid?.lng ?? null;
    const googleMaps =
      lat !== null && lng !== null
        ? `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`
        : undefined;

    // Do not attempt to infer which specific state an alert covers from areaDesc.
    // areaDesc is a human-readable string (e.g. "Lee County") that does not
    // reliably contain 2-letter state abbreviations. Attempting to match against
    // it silently mislabels alerts. Store the queried state context instead:
    // single-state scans use that state code; multi-state scans store all codes.
    const areaDesc: string = props.areaDesc || areaParam;
    const requestedStates = states.length === 1 ? states[0] : states.join(', ');

    const actionRequired =
      noaaUrgency === 'Immediate' ||
      noaaSeverity === 'Extreme'  ||
      noaaSeverity === 'Severe';

    signals.push({
      id:            alertId,
      event,
      signalType,
      serviceTypes,
      severity,
      noaaSeverity,
      noaaUrgency,
      noaaCertainty,
      areaDesc,
      state:         requestedStates,
      headline:      props.headline || event,
      sent:          props.sent      || new Date().toISOString(),
      expires:       props.expires   || null,
      effective:     props.effective || null,
      // lat/lng are polygon centroids — display and map link only.
      // Must NOT be used for geofence radius targeting (Level 3 concern).
      lat,
      lng,
      googleMaps,
      actionRequired,
    });
  }

  const actionCount = signals.filter(s => s.actionRequired).length;
  console.log(
    `[SENTINEL HOME SVC] ${signals.length} relevant alerts` +
    ` (${actionCount} action required) for: ${areaParam}`,
  );
  return signals;
}
