import axios from 'axios';
import * as cheerio from 'cheerio';
import { getDistance } from 'geolib';
import {
  processFHPHSMVFeedV2,
  buildCrashMergeUpdate,
  resolveGeofenceTarget,
  getPollSchedule,
  classifyCrashSeverity,
} from './sentinel-accident-v2';

const META_VERSION = 'v18.0';
const FHP_HSMV_URL = "https://trafficincidents.flhsmv.gov/SmartWebClient/CADView.aspx";

// All high-value Florida counties for personal injury lead generation
const DEFAULT_TARGET_COUNTIES = [
  // South Florida
  'MIAMI-DADE', 'BROWARD', 'PALM BEACH', 'MONROE',
  // Southwest FL
  'LEE', 'COLLIER', 'CHARLOTTE', 'HENDRY', 'GLADES', 'SARASOTA', 'MANATEE',
  // Central FL
  'ORANGE', 'OSCEOLA', 'SEMINOLE', 'POLK', 'HILLSBOROUGH', 'PINELLAS', 'PASCO',
  // Northeast FL
  'DUVAL', 'ST JOHNS', 'CLAY', 'NASSAU', 'BAKER',
  // North Central FL
  'ALACHUA', 'MARION', 'LAKE', 'VOLUSIA', 'BREVARD',
  // Northwest FL
  'ESCAMBIA', 'SANTA ROSA', 'OKALOOSA', 'BAY', 'LEON',
];
const DEFAULT_RADIUS_METERS = 160934; // 100 miles — statewide coverage

const SWFL_TARGET_CITIES = [
  'CAPE CORAL', 'FORT MYERS', 'FT MYERS', 'FT. MYERS',
  'NORTH FORT MYERS', 'N FORT MYERS', 'N FT MYERS',
  'NAPLES', 'BONITA SPRINGS', 'BONITA', 'LEHIGH ACRES', 'LEHIGH',
  'ESTERO', 'MARCO ISLAND', 'IMMOKALEE', 'LABELLE', 'PUNTA GORDA',
  'PORT CHARLOTTE', 'SANIBEL', 'PINE ISLAND', 'GOLDEN GATE',
];

export interface SentinelIncidentRaw {
  id: string;
  type: string;
  location: string;
  lat: number | null;
  lng: number | null;
  severity: string;
  actionRequired: boolean;
  source: string;
  state: string;
  county?: string;
  remarks?: string;
  received?: string;
  distanceMiles?: string;
  googleMaps?: string;
}

function stableHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export async function processFHPHSMVFeed(): Promise<SentinelIncidentRaw[]> {
  const { incidents, health } = await processFHPHSMVFeedV2();

  if (!health.ok) {
    console.warn('[SENTINEL] Scraper health degraded:', health.warnings);
  }

  return incidents.map(inc => ({
    id:             inc.id,
    type:           inc.type,
    location:       inc.location,
    lat:            inc.lat,
    lng:            inc.lng,
    severity:       inc.severity,
    actionRequired: inc.actionRequired,
    source:         inc.source,
    state:          inc.state,
    county:         inc.county,
    remarks:        inc.remarks,
    received:       inc.received,
    distanceMiles:  inc.distanceMiles,
    googleMaps:     inc.googleMaps,
    _operatorPriority: inc.operatorPriority,
    _priorityScore:    inc.priorityScore,
  })) as unknown as SentinelIncidentRaw[];
}

export interface FHPFeedResult {
  status: "ok" | "empty" | "error";
  incidents: SentinelIncidentRaw[];
  error?: string;
  httpStatus?: number;
}

export async function fetchFHPHSMVFeedSafe(): Promise<FHPFeedResult> {
  try {
    const { incidents: rawIncidents, health } = await processFHPHSMVFeedV2();

    if (!health.ok) {
      console.warn('[SENTINEL] fetchFHPHSMVFeedSafe: scraper health degraded:', health.warnings);
    }

    if (rawIncidents.length === 0) {
      return { status: health.ok ? "empty" : "error", incidents: [], error: health.ok ? undefined : health.warnings?.join('; ') };
    }

    const incidents: SentinelIncidentRaw[] = rawIncidents.map(inc => ({
      id:             inc.id,
      type:           inc.type,
      location:       inc.location,
      lat:            inc.lat,
      lng:            inc.lng,
      severity:       inc.severity,
      actionRequired: inc.actionRequired,
      source:         inc.source,
      state:          inc.state,
      county:         inc.county,
      remarks:        inc.remarks,
      received:       inc.received,
      distanceMiles:  inc.distanceMiles,
      googleMaps:     inc.googleMaps,
      _operatorPriority: inc.operatorPriority,
      _priorityScore:    inc.priorityScore,
    })) as unknown as SentinelIncidentRaw[];

    const swflCount = incidents.filter(i => i.actionRequired).length;
    console.log(`[SENTINEL] fetchFHPHSMVFeedSafe: ${incidents.length} crashes statewide (${swflCount} urgent)`);
    return { status: "ok", incidents };
  } catch (parseErr: any) {
    const msg = `FHP feed error: ${parseErr?.message || String(parseErr)}`;
    console.error(`[SENTINEL] ${msg}`);
    return { status: "error", incidents: [], error: msg };
  }
}

export async function processLiveSentinelFeed(): Promise<SentinelIncidentRaw[]> {
  const { incidents, health } = await processFHPHSMVFeedV2();

  if (!health.ok) {
    console.error('[SENTINEL LIVE FEED] Scraper health DEGRADED:', {
      warnings:           health.warnings,
      dataRowCount:       health.dataRowCount,
      usingFallback:      health.usingFallbackColumns,
      detectedHeaders:    health.detectedHeaders,
    });
  } else {
    console.log(`[SENTINEL LIVE FEED] Scraper OK — ${health.dataRowCount} rows parsed`);
  }

  const results = incidents.map(inc => ({
    ...inc,
    _operatorPriority: inc.operatorPriority,
    _priorityScore:    inc.priorityScore,
  })) as unknown as SentinelIncidentRaw[];

  console.log(`[SENTINEL] Live scan complete — ${results.length} FL crashes found`);

  const webhookUrl = process.env.APEX_WEBHOOK_URL;
  if (webhookUrl && results.length > 0) {
    for (const crash of results) {
      try {
        await axios.post(webhookUrl, {
          type:           crash.type,
          county:         crash.county,
          distance_miles: crash.distanceMiles,
          google_maps:    crash.googleMaps,
          timestamp:      crash.received,
          lat:            crash.lat,
          lng:            crash.lng,
          severity:       crash.severity,
          location:       crash.location,
          remarks:        crash.remarks,
        });
      } catch (e: any) {
        console.error('[SENTINEL] Webhook fire failed:', e.message);
      }
    }
  }

  return results;
}

export interface GeofenceResult {
  status: string;
  adSetId?: string;
  message?: string;
  error?: string;
}

export async function deployGeofenceAd(incident: {
  id: number | string;
  location: string;
  lat?: number | null;
  lng?: number | null;
  title?: string;
}, radiusMiles: number = 1, credentials?: { accessToken?: string; adAccountId?: string }): Promise<GeofenceResult> {
  const metaAccessToken = credentials?.accessToken || null;
  const adAccountId = credentials?.adAccountId || process.env.META_AD_ACCOUNT_ID;

  if (!metaAccessToken || !adAccountId) {
    console.log(`📡 META ADS: No credentials — SIMULATION MODE for ${incident.location}`);
    return { status: "SIMULATION_MODE", message: "Connect Meta Ads in Integrations Hub to go live" };
  }

  try {
    const targeting: any = {
      geo_locations: {
        custom_locations: [] as any[],
      },
    };

    if (incident.lat != null && incident.lng != null) {
      targeting.geo_locations.custom_locations.push({
        latitude: incident.lat,
        longitude: incident.lng,
        radius: radiusMiles,
        distance_unit: 'mile',
      });
    } else {
      targeting.geo_locations.custom_locations.push({
        address_string: incident.location,
        radius: radiusMiles,
        distance_unit: 'mile',
      });
    }

    const adSetPayload = {
      name: `Sentinel_Deploy_${incident.id}`,
      optimization_goal: 'REACH',
      billing_event: 'IMPRESSIONS',
      bid_amount: 1000,
      targeting,
      status: 'ACTIVE',
    };

    console.log(`📡 META ADS: LIVE FIRE deploying to ${incident.location}`, JSON.stringify(adSetPayload));

    const response = await axios.post(
      `https://graph.facebook.com/${META_VERSION}/act_${adAccountId}/adsets`,
      adSetPayload,
      { headers: { Authorization: `Bearer ${metaAccessToken}` }, timeout: 15000 }
    );

    console.log(`📡 META ADS: Ad Set created — ID: ${response.data.id}`);
    return { status: "LIVE_FIRE", adSetId: response.data.id };
  } catch (error: any) {
    const errMsg = error?.response?.data?.error?.message || error?.message || "Unknown error";
    console.error(`📡 META ADS ERROR: ${errMsg}`);
    return { status: "ERROR", error: errMsg };
  }
}

let sentinelScanTimer: ReturnType<typeof setTimeout> | null = null;

export function startSentinelScheduler(): void {
  if (sentinelScanTimer) {
    console.log("[SENTINEL] Scheduler already running");
    return;
  }

  const BASE_INTERVAL_MS = 15 * 60 * 1000;

  console.log("[SENTINEL] Background scheduler started with smart polling");

  const runScan = () => {
    processLiveSentinelFeed()
      .then(results => {
        const schedule = getPollSchedule(BASE_INTERVAL_MS);
        console.log(
          `[SENTINEL] Scheduled scan complete: ${results.length} incident(s). ` +
          `Next poll in ${Math.round(schedule.intervalMs / 60000)}m (${schedule.reason})`
        );
        sentinelScanTimer = setTimeout(runScan, schedule.intervalMs);
      })
      .catch(err => {
        console.error(`[SENTINEL] Scheduled scan error: ${err.message}`);
        sentinelScanTimer = setTimeout(runScan, 5 * 60_000);
      });
  };

  sentinelScanTimer = setTimeout(runScan, 30_000);
}

export function stopSentinelScheduler(): void {
  if (sentinelScanTimer) {
    clearTimeout(sentinelScanTimer);
    sentinelScanTimer = null;
  }
  console.log("[SENTINEL] Scheduler stopped");
}

export async function processLiveHomeSvcFeed(
  targetStates: string[] = [],
): Promise<import('./sentinel-home-svc').HomeSvcSignal[]> {
  const { fetchHomeSvcSignals } = await import('./sentinel-home-svc');
  return fetchHomeSvcSignals(targetStates);
}
