/**
 * server/sentinel-home-svc.ts
 *
 * Sentinel Home Services — Level 3 signal ingestion module.
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

// =============================================================================
// LEVEL 3 — OPERATOR GRADE ADDITIONS
// All functions below are Home Services only.
// They do NOT interact with accident feed logic, the accident scheduler,
// or any accident incident. They are called exclusively from the
// Home Services scan branch in routes/sentinel.ts.
// =============================================================================

// ---------------------------------------------------------------------------
// Level 3 types
// ---------------------------------------------------------------------------

export interface Territory {
  name: string;
  stateCodes: string[];   // 2-letter US state codes: ['FL', 'TX']
  counties?: string[];    // Optional county filter: ['LEE', 'COLLIER']
  cities?: string[];      // Optional city filter: ['Cape Coral', 'Fort Myers']
}

export interface DeliveryRule {
  id: string;
  name: string;
  serviceTypes?: string[];  // Match any of these service types
  minScore?: number;        // Minimum opportunityScore to trigger
  territory?: string;       // Exact territory name, or omit for any
  signalTypes?: string[];   // Match any of these signal types
  action: 'auto_queue';     // Only supported Level 3 action
}

export interface HomeSvcConfigShape {
  territories?: Territory[];
  deliveryRules?: DeliveryRule[];
}

export interface ScoringResult {
  opportunityScore: number;  // 0–100
  scoreBreakdown: {
    severityPoints: number;
    urgencyPoints: number;
    signalTypePoints: number;
    serviceValuePoints: number;
    territoryPoints: number;
    freshnessPoints: number;
    clusterBonus: number;
  };
  scoreTier: 'immediate' | 'strong' | 'standard' | 'monitor';
  scoreTierLabel: string;
  leadReadiness: 'ready' | 'warm' | 'developing' | 'monitoring';
  serviceValueTier: 'premium' | 'standard' | 'basic';
}

export interface ClusterMetadata {
  clusterId: string;
  clusterSize: number;
  clusterDominantSignalType: string;
  clusterOpportunityScore: number;
  isNewCluster: boolean;
}

// ---------------------------------------------------------------------------
// Signal family map — used for clustering and market heat
// Exported so the routes file can use it for market heat aggregation
// without duplicating the mapping.
// ---------------------------------------------------------------------------

export const SIGNAL_FAMILY_MAP: Record<string, string> = {
  tornado:      'severe_weather',
  severe_storm: 'severe_weather',
  hail:         'severe_weather',
  thunderstorm: 'severe_weather',
  storm:        'severe_weather',
  flash_flood:  'flooding',
  flood:        'flooding',
  high_wind:    'wind',
  freeze:       'cold',
  winter_storm: 'cold',
  heat:         'heat',
};

function getSignalFamily(signalType: string): string {
  return SIGNAL_FAMILY_MAP[signalType] ?? 'other';
}

// ---------------------------------------------------------------------------
// Level 3 utility: expired alert detection
//
// NOAA alerts carry an `expires` ISO timestamp. Signals past expiry are
// stale and should be demoted or marked expired by the operator queue.
// This is a pure function — no DB or side-effects.
// ---------------------------------------------------------------------------

export function isAlertExpired(expiresIso: string | null | undefined): boolean {
  if (!expiresIso) return false;
  try {
    return new Date(expiresIso).getTime() < Date.now();
  } catch (err) {
    console.warn("[SENTINEL-HOME-SVC] caught:", err instanceof Error ? err.message : err);
    return false;
  }
}

export function alertExpiryStatus(expiresIso: string | null | undefined): 'active' | 'expiring_soon' | 'expired' {
  if (!expiresIso) return 'active';
  try {
    const expiresAt = new Date(expiresIso).getTime();
    const now = Date.now();
    if (expiresAt < now) return 'expired';
    if (expiresAt - now < 60 * 60 * 1000) return 'expiring_soon';
    return 'active';
  } catch (err) {
    console.warn("[SENTINEL-HOME-SVC] caught:", err instanceof Error ? err.message : err);
    return 'active';
  }
}

// ---------------------------------------------------------------------------
// Level 3 utility: opportunity scoring
//
// Deterministic. Explainable. Runs at scan/persist time — not on render.
// All weights are intentionally visible so they can be tuned.
// Do NOT call this from accident code paths.
// ---------------------------------------------------------------------------

// Service tiers by category — higher tier = higher-value job typically
const PREMIUM_SERVICE_TYPES  = new Set(['roofing', 'water_restoration', 'mold_remediation', 'foundation_repair']);
const STANDARD_SERVICE_TYPES = new Set(['hvac', 'plumbing', 'electrical', 'tree_removal']);
// Anything else is 'basic'

export function scoreHomeSvcOpportunity(
  signal: HomeSvcSignal,
  context: {
    territory: string;
    clusterSize: number;
    sentAtIso?: string | null;
  },
): ScoringResult {
  // ── Severity component (0–30) ────────────────────────────────────────────
  const SEVERITY_POINTS: Record<string, number> = {
    Extreme: 30, Severe: 22, Moderate: 12, Minor: 4, Unknown: 4,
  };
  const severityPoints = SEVERITY_POINTS[signal.noaaSeverity] ?? 4;

  // ── Urgency component (0–20) ─────────────────────────────────────────────
  const URGENCY_POINTS: Record<string, number> = {
    Immediate: 20, Expected: 12, Future: 6, Past: 0, Unknown: 2,
  };
  const urgencyPoints = URGENCY_POINTS[signal.noaaUrgency] ?? 2;

  // ── Signal type hierarchy (0–20) ─────────────────────────────────────────
  // tornado/hurricane = most service demand; generic storm = least
  const SIGNAL_TYPE_POINTS: Record<string, number> = {
    tornado:      20,
    severe_storm: 16,
    hail:         16,  // hail → roofing demand is high and direct
    flash_flood:  15,
    flood:        13,
    high_wind:    12,
    winter_storm: 10,
    freeze:       10,
    heat:         8,
    thunderstorm: 8,
    storm:        6,
  };
  const signalTypePoints = SIGNAL_TYPE_POINTS[signal.signalType] ?? 6;

  // ── Service value potential (0–15) ───────────────────────────────────────
  const hasPremium  = signal.serviceTypes.some(s => PREMIUM_SERVICE_TYPES.has(s));
  const hasStandard = signal.serviceTypes.some(s => STANDARD_SERVICE_TYPES.has(s));
  const serviceValuePoints = hasPremium ? 15 : hasStandard ? 10 : 5;
  const serviceValueTier: ScoringResult['serviceValueTier'] =
    hasPremium ? 'premium' : hasStandard ? 'standard' : 'basic';

  // ── Territory match bonus (0–10) ─────────────────────────────────────────
  const territoryPoints = context.territory !== 'unassigned' ? 10 : 0;

  // ── Freshness decay (0–5) ────────────────────────────────────────────────
  let freshnessPoints = 0;
  if (context.sentAtIso) {
    const ageMinutes = (Date.now() - new Date(context.sentAtIso).getTime()) / 60_000;
    if      (ageMinutes < 30)  freshnessPoints = 5;
    else if (ageMinutes < 60)  freshnessPoints = 4;
    else if (ageMinutes < 120) freshnessPoints = 3;
    else if (ageMinutes < 240) freshnessPoints = 2;
    else if (ageMinutes < 480) freshnessPoints = 1;
  }

  // ── Cluster intensity bonus (0–5) ────────────────────────────────────────
  // Being part of a growing cluster signals increasing area demand
  const clusterBonus =
    context.clusterSize > 5 ? 5 :
    context.clusterSize > 3 ? 4 :
    context.clusterSize > 1 ? 2 : 0;

  // ── Final score ──────────────────────────────────────────────────────────
  const raw = severityPoints + urgencyPoints + signalTypePoints +
              serviceValuePoints + territoryPoints + freshnessPoints + clusterBonus;
  const opportunityScore = Math.min(100, Math.max(0, Math.round(raw)));

  const scoreTier: ScoringResult['scoreTier'] =
    opportunityScore >= 80 ? 'immediate' :
    opportunityScore >= 60 ? 'strong'    :
    opportunityScore >= 40 ? 'standard'  : 'monitor';

  const TIER_LABELS: Record<string, string> = {
    immediate: 'Immediate Opportunity',
    strong:    'Strong Opportunity',
    standard:  'Standard Signal',
    monitor:   'Monitor',
  };

  const leadReadiness: ScoringResult['leadReadiness'] =
    opportunityScore >= 75 ? 'ready'      :
    opportunityScore >= 50 ? 'warm'        :
    opportunityScore >= 25 ? 'developing'  : 'monitoring';

  return {
    opportunityScore,
    scoreBreakdown: {
      severityPoints,
      urgencyPoints,
      signalTypePoints,
      serviceValuePoints,
      territoryPoints,
      freshnessPoints,
      clusterBonus,
    },
    scoreTier,
    scoreTierLabel: TIER_LABELS[scoreTier],
    leadReadiness,
    serviceValueTier,
  };
}

// ---------------------------------------------------------------------------
// Level 3 utility: territory resolution
//
// Returns the name of the first matching territory, or 'unassigned'.
// Does not affect access control. Purely for display and delivery rule eval.
// Safe no-op when territories array is empty.
// ---------------------------------------------------------------------------

export function resolveTerritory(
  signal: HomeSvcSignal,
  territories: Territory[],
): string {
  if (!territories || territories.length === 0) return 'unassigned';

  for (const territory of territories) {
    // State must match — it's the outer gate
    const stateMatch = territory.stateCodes.some(
      s => signal.state.toUpperCase().includes(s.toUpperCase())
    );
    if (!stateMatch) continue;

    // County-level match takes priority when configured
    if (territory.counties && territory.counties.length > 0) {
      const areaUpper = signal.areaDesc.toUpperCase();
      if (territory.counties.some(c => areaUpper.includes(c.toUpperCase()))) {
        return territory.name;
      }
    }

    // City-level match
    if (territory.cities && territory.cities.length > 0) {
      const areaUpper = signal.areaDesc.toUpperCase();
      if (territory.cities.some(c => areaUpper.includes(c.toUpperCase()))) {
        return territory.name;
      }
    }

    // State-only territory (no county/city filters) — state match is sufficient
    if (!territory.counties?.length && !territory.cities?.length) {
      return territory.name;
    }
  }

  return 'unassigned';
}

// ---------------------------------------------------------------------------
// Level 3 utility: neighborhood / event clustering
//
// Groups nearby Home Services incidents from the same signal family
// within a 24-hour window and 15-mile radius.
//
// SAFETY RULES enforced in this function:
//   - Only operates on Home Services incidents (rawPayload.source check)
//   - Never clusters accident incidents
//   - Never reads cross-account data (caller provides scoped list)
//   - Does not change dedup behavior
//   - No DB calls — caller provides the pre-fetched, capped list
// ---------------------------------------------------------------------------

const CLUSTER_RADIUS_MILES = 15;

function haversineDistanceMiles(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function freshClusterId(): string {
  return `cls-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

// Shape expected from the caller's pre-fetched incident list
interface RecentIncidentSlim {
  id: number;
  sourceHash: string | null;
  lat: number | null;
  lng: number | null;
  rawPayload: Record<string, any> | null;
  detectedAt: Date | string;
}

export function findClusterMetadata(
  signal: HomeSvcSignal,
  recentIncidents: RecentIncidentSlim[],
): ClusterMetadata {
  // Only consider Home Services incidents — guard at the source level
  const homeSvcOnly = recentIncidents.filter(
    inc => inc.rawPayload?.source === 'sentinel_home_svc'
  );

  const newFamily = getSignalFamily(signal.signalType);

  // ── Coordinate-based clustering ──────────────────────────────────────────
  if (signal.lat !== null && signal.lng !== null) {
    const nearby = homeSvcOnly.filter(inc => {
      if (!inc.lat || !inc.lng) return false;
      const incFamily = getSignalFamily(inc.rawPayload?.signalType ?? '');
      if (incFamily !== newFamily) return false;
      return haversineDistanceMiles(signal.lat!, signal.lng!, inc.lat, inc.lng) <= CLUSTER_RADIUS_MILES;
    });

    if (nearby.length > 0) {
      // Use the oldest incident in the group as the cluster anchor
      nearby.sort((a, b) =>
        new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime()
      );
      const anchor = nearby[0];
      const clusterId = anchor.rawPayload?.clusterId ?? anchor.sourceHash ?? `cls-${anchor.id}`;

      // Count all existing members of this cluster
      const members = homeSvcOnly.filter(
        inc => inc.rawPayload?.clusterId === clusterId || inc.id === anchor.id
      );
      const maxExistingScore = Math.max(0, ...members.map(inc => inc.rawPayload?.opportunityScore ?? 0));

      return {
        clusterId,
        clusterSize:                members.length + 1, // +1 for the new incident
        clusterDominantSignalType:  signal.signalType,
        clusterOpportunityScore:    maxExistingScore,
        isNewCluster:               false,
      };
    }
  }

  // ── Area-description fallback (no coordinates available) ────────────────
  const areaMatch = homeSvcOnly.find(inc => {
    if (getSignalFamily(inc.rawPayload?.signalType ?? '') !== newFamily) return false;
    return inc.rawPayload?.county === signal.areaDesc ||
           inc.rawPayload?.areaDesc === signal.areaDesc;
  });

  if (areaMatch) {
    const clusterId = areaMatch.rawPayload?.clusterId ?? areaMatch.sourceHash ?? `cls-${areaMatch.id}`;
    const members = homeSvcOnly.filter(
      inc => inc.rawPayload?.clusterId === clusterId || inc.id === areaMatch.id
    );
    return {
      clusterId,
      clusterSize:               members.length + 1,
      clusterDominantSignalType: signal.signalType,
      clusterOpportunityScore:   Math.max(0, ...members.map(inc => inc.rawPayload?.opportunityScore ?? 0)),
      isNewCluster:              false,
    };
  }

  // ── No match — new single-element cluster ────────────────────────────────
  return {
    clusterId:                  freshClusterId(),
    clusterSize:                1,
    clusterDominantSignalType:  signal.signalType,
    clusterOpportunityScore:    0,
    isNewCluster:               true,
  };
}

// ---------------------------------------------------------------------------
// Level 3 utility: delivery rule evaluation
//
// Evaluates a signal against configured delivery rules.
// May return 'auto_queued' to mark the incident for priority operator attention.
//
// LEVEL 3 ONLY — this does NOT:
//   - auto-send SMS
//   - create CRM records
//   - dispatch contractors
//   - fire external webhooks
//
// It ONLY controls the incident's initial actionStatus.
// ---------------------------------------------------------------------------

export function evaluateDeliveryRules(
  signal: HomeSvcSignal,
  score: number,
  territory: string,
  rules: DeliveryRule[],
): { actionStatus: 'auto_queued' | 'pending' } {
  if (!rules || rules.length === 0) return { actionStatus: 'pending' };

  for (const rule of rules) {
    // Each condition is an AND gate — all specified conditions must match

    if (rule.serviceTypes && rule.serviceTypes.length > 0) {
      const hasServiceMatch = signal.serviceTypes.some(s => rule.serviceTypes!.includes(s));
      if (!hasServiceMatch) continue;
    }

    if (rule.minScore !== undefined && score < rule.minScore) continue;

    if (rule.territory && rule.territory !== territory) continue;

    if (rule.signalTypes && rule.signalTypes.length > 0) {
      if (!rule.signalTypes.includes(signal.signalType)) continue;
    }

    // All conditions passed
    if (rule.action === 'auto_queue') {
      return { actionStatus: 'auto_queued' };
    }
  }

  return { actionStatus: 'pending' };
}

// ---------------------------------------------------------------------------
// Level 3 utility: market heat aggregation
//
// Called by the market heat endpoint — NOT a background job.
// Input: pre-fetched, account-scoped, time-limited Home Services incidents.
// Returns lightweight operator intelligence.
// ---------------------------------------------------------------------------

export interface MarketHeatOutput {
  subAccountId: number;
  windowHours: number;
  totalSignals: number;
  topServiceTypes: Array<{ name: string; totalScore: number; count: number; avgScore: number }>;
  topTerritories:  Array<{ name: string; count: number; totalScore: number; avgScore: number }>;
  activeClusters:  number;
  scoreDistribution: { immediate: number; strong: number; standard: number; monitor: number };
  topSignalFamilies: Array<{ family: string; count: number; avgScore: number }>;
  generatedAt: string;
}

export function aggregateMarketHeat(
  subAccountId: number,
  incidents: Array<{ rawPayload: Record<string, any> | null }>,
  windowHours: number = 72,
): MarketHeatOutput {
  const homeSvcIncidents = incidents.filter(
    i => i.rawPayload?.source === 'sentinel_home_svc'
  );

  if (homeSvcIncidents.length === 0) {
    return {
      subAccountId,
      windowHours,
      totalSignals: 0,
      topServiceTypes: [],
      topTerritories: [],
      activeClusters: 0,
      scoreDistribution: { immediate: 0, strong: 0, standard: 0, monitor: 0 },
      topSignalFamilies: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const svcMap:      Record<string, { score: number; count: number }> = {};
  const terrMap:     Record<string, { score: number; count: number }> = {};
  const familyMap:   Record<string, { score: number; count: number }> = {};
  const clusterIds   = new Set<string>();
  const scoreDist    = { immediate: 0, strong: 0, standard: 0, monitor: 0 };

  for (const inc of homeSvcIncidents) {
    const raw = inc.rawPayload!;
    const score:       number   = raw.opportunityScore ?? 0;
    const tier:        string   = raw.scoreTier ?? 'monitor';
    const territory:   string   = raw.territory ?? 'unassigned';
    const serviceTypes: string[] = Array.isArray(raw.serviceTypes) ? raw.serviceTypes : [];
    const signalType:  string   = raw.signalType ?? 'storm';
    const clusterId:   string   = raw.clusterId ?? '';

    // Score distribution
    if      (tier === 'immediate') scoreDist.immediate++;
    else if (tier === 'strong')    scoreDist.strong++;
    else if (tier === 'standard')  scoreDist.standard++;
    else                           scoreDist.monitor++;

    // Cluster tracking
    if (clusterId) clusterIds.add(clusterId);

    // Territory — exclude unassigned from ranked output
    if (territory !== 'unassigned') {
      if (!terrMap[territory]) terrMap[territory] = { score: 0, count: 0 };
      terrMap[territory].score += score;
      terrMap[territory].count++;
    }

    // Service types
    for (const svc of serviceTypes) {
      if (!svcMap[svc]) svcMap[svc] = { score: 0, count: 0 };
      svcMap[svc].score += score;
      svcMap[svc].count++;
    }

    // Signal family
    const family = getSignalFamily(signalType);
    if (!familyMap[family]) familyMap[family] = { score: 0, count: 0 };
    familyMap[family].score += score;
    familyMap[family].count++;
  }

  const topServiceTypes = Object.entries(svcMap)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 5)
    .map(([name, d]) => ({ name, totalScore: d.score, count: d.count, avgScore: Math.round(d.score / d.count) }));

  const topTerritories = Object.entries(terrMap)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([name, d]) => ({ name, count: d.count, totalScore: d.score, avgScore: Math.round(d.score / d.count) }));

  const topSignalFamilies = Object.entries(familyMap)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 4)
    .map(([family, d]) => ({ family, count: d.count, avgScore: Math.round(d.score / d.count) }));

  return {
    subAccountId,
    windowHours,
    totalSignals:  homeSvcIncidents.length,
    topServiceTypes,
    topTerritories,
    activeClusters: clusterIds.size,
    scoreDistribution: scoreDist,
    topSignalFamilies,
    generatedAt:   new Date().toISOString(),
  };
}
