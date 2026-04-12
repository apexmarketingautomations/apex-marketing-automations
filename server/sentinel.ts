import axios from 'axios';
import * as cheerio from 'cheerio';
import { getDistance } from 'geolib';

const META_VERSION = 'v18.0';
const FHP_HSMV_URL = "https://trafficincidents.flhsmv.gov/SmartWebClient/CADView.aspx";

const DEFAULT_TARGET_COUNTIES = ['LEE', 'COLLIER', 'CHARLOTTE', 'HENDRY', 'GLADES'];
const DEFAULT_RADIUS_METERS = 80467; // 50 miles

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
  try {
    console.log("📡 SENTINEL: Scraping FHP HSMV live feed — ALL Florida crashes...");
    const response = await axios.get(FHP_HSMV_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 15000,
    });

    const html: string = response.data;
    if (!html || html.length < 500) {
      console.log("📡 SENTINEL: FHP HSMV returned empty response");
      return [];
    }

    const $ = cheerio.load(html);
    const incidents: SentinelIncidentRaw[] = [];
    const seenHashes = new Set<string>();

    const clientLat = parseFloat(process.env.CLIENT_LAT || '');
    const clientLon = parseFloat(process.env.CLIENT_LON || '');
    const hasClientLocation = !isNaN(clientLat) && !isNaN(clientLon);

    if (hasClientLocation) {
      console.log(`📡 SENTINEL: Client HQ at ${clientLat}, ${clientLon} — scanning ALL FL crashes`);
    }

    $('.dxgvDataRow').each((_i, el) => {
      const cols = $(el).find('td');

      const type = $(cols[0]).text().trim();
      const received = $(cols[1]).text().trim();
      const county = $(cols[4]).text().trim();
      const location = $(cols[5]).text().trim();
      const remarks = $(cols[6]).text().trim();
      const latRaw = $(cols[7]).text().trim();
      const lonRaw = $(cols[8]).text().trim();

      const locationUpper = location.toUpperCase();
      const countyUpper = county.toUpperCase();
      const isSWFLCounty = ['LEE', 'COLLIER', 'CHARLOTTE', 'HENDRY', 'GLADES'].some(c => countyUpper.includes(c));
      const isTargetCity = SWFL_TARGET_CITIES.some(city => locationUpper.includes(city));

      const typeUpper = type.toUpperCase();
      const isCrash = typeUpper.includes('CRASH') ||
                      typeUpper.includes('FATALITY') ||
                      typeUpper.includes('HIT AND RUN') ||
                      typeUpper.includes('H&R') ||
                      typeUpper.includes('ACCIDENT') ||
                      typeUpper.includes('COLLISION') ||
                      typeUpper.includes('ROLLOVER');

      if (!isCrash) return;

      const lat = parseFloat(latRaw);
      const lon = parseFloat(lonRaw);
      const hasCoords = !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0;

      let distanceMiles = "unknown";

      if (hasCoords && hasClientLocation) {
        const crashLoc = { latitude: lat, longitude: lon };
        const clientLoc = { latitude: clientLat, longitude: clientLon };
        const distanceMeters = getDistance(crashLoc, clientLoc);
        distanceMiles = (distanceMeters / 1609.34).toFixed(2);
      }

      const contentHash = stableHash(`${type}|${received}|${location}|${latRaw}`);
      if (seenHashes.has(contentHash)) return;
      seenHashes.add(contentHash);

      const hasInjury = typeUpper.includes('INJUR') ||
                        typeUpper.includes('FATAL') ||
                        typeUpper.includes('ENTRAP') ||
                        typeUpper.includes('EXTRICAT') ||
                        typeUpper.includes('TRAUMA') ||
                        typeUpper.includes('ROADBLOCK');

      const stableId = `FHP-${county}-${stableHash(received + location)}`;
      const googleMaps = hasCoords ? `https://www.google.com/maps?q=${lat},${lon}` : undefined;
      const matchedCity = SWFL_TARGET_CITIES.find(city => locationUpper.includes(city)) || null;

      incidents.push({
        id: stableId,
        type,
        location: `${location}, ${county} County, FL`,
        lat: hasCoords ? lat : null,
        lng: hasCoords ? lon : null,
        severity: typeUpper.includes('FATAL') ? 'critical' : hasInjury ? 'critical' : (isSWFLCounty || isTargetCity) ? 'critical' : 'high',
        actionRequired: hasInjury || isSWFLCounty || isTargetCity,
        source: "fhp_hsmv",
        state: "FL",
        county,
        remarks,
        received,
        distanceMiles,
        googleMaps,
      });
    });

    const swflCount = incidents.filter(i => i.actionRequired).length;
    console.log(`📡 SENTINEL: FHP HSMV returned ${incidents.length} crashes statewide (${swflCount} in SWFL priority zone)`);
    return incidents;
  } catch (error: any) {
    console.error("📡 SENTINEL FHP HSMV ERROR:", error?.message || error);
    return [];
  }
}

export interface FHPFeedResult {
  status: "ok" | "empty" | "error";
  incidents: SentinelIncidentRaw[];
  error?: string;
  httpStatus?: number;
}

export async function fetchFHPHSMVFeedSafe(): Promise<FHPFeedResult> {
  console.log("📡 SENTINEL: Scraping FHP HSMV live feed — ALL Florida crashes...");
  let response: any;
  try {
    response = await axios.get(FHP_HSMV_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 15000,
      validateStatus: () => true,
    });
  } catch (err: any) {
    const msg = err?.code === "ECONNABORTED"
      ? `FHP HSMV request timeout after 15s`
      : `FHP HSMV network error: ${err?.message || String(err)}`;
    console.error(`📡 SENTINEL: ${msg}`);
    return { status: "error", incidents: [], error: msg };
  }

  if (response.status !== 200) {
    const msg = `FHP HSMV HTTP ${response.status}`;
    console.error(`📡 SENTINEL: ${msg}`);
    return { status: "error", incidents: [], error: msg, httpStatus: response.status };
  }

  const html: string = response.data;
  if (!html || html.length < 500) {
    console.log("📡 SENTINEL: FHP HSMV returned empty/short response");
    return { status: "empty", incidents: [] };
  }

  try {
    const $ = cheerio.load(html);
    const incidents: SentinelIncidentRaw[] = [];
    const seenHashes = new Set<string>();

    const clientLat = parseFloat(process.env.CLIENT_LAT || '');
    const clientLon = parseFloat(process.env.CLIENT_LON || '');
    const hasClientLocation = !isNaN(clientLat) && !isNaN(clientLon);

    $('.dxgvDataRow').each((_i, el) => {
      const cols = $(el).find('td');

      const type = $(cols[0]).text().trim();
      const received = $(cols[1]).text().trim();
      const county = $(cols[4]).text().trim();
      const location = $(cols[5]).text().trim();
      const remarks = $(cols[6]).text().trim();
      const latRaw = $(cols[7]).text().trim();
      const lonRaw = $(cols[8]).text().trim();

      if (!type || !location) return;

      const locationUpper = location.toUpperCase();
      const countyUpper = county.toUpperCase();
      const isSWFLCounty = ['LEE', 'COLLIER', 'CHARLOTTE', 'HENDRY', 'GLADES'].some(c => countyUpper.includes(c));
      const isTargetCity = SWFL_TARGET_CITIES.some(city => locationUpper.includes(city));

      const typeUpper = type.toUpperCase();
      const isCrash = typeUpper.includes('CRASH') ||
                      typeUpper.includes('FATALITY') ||
                      typeUpper.includes('HIT AND RUN') ||
                      typeUpper.includes('H&R') ||
                      typeUpper.includes('ACCIDENT') ||
                      typeUpper.includes('COLLISION') ||
                      typeUpper.includes('ROLLOVER');

      if (!isCrash) return;

      const lat = parseFloat(latRaw);
      const lon = parseFloat(lonRaw);
      const hasCoords = !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0;

      let distanceMiles = "unknown";
      if (hasCoords && hasClientLocation) {
        const crashLoc = { latitude: lat, longitude: lon };
        const clientLoc = { latitude: clientLat, longitude: clientLon };
        const distanceMeters = getDistance(crashLoc, clientLoc);
        distanceMiles = (distanceMeters / 1609.34).toFixed(2);
      }

      const contentHash = stableHash(`${type}|${received}|${location}|${latRaw}`);
      if (seenHashes.has(contentHash)) return;
      seenHashes.add(contentHash);

      const hasInjury = typeUpper.includes('INJUR') ||
                        typeUpper.includes('FATAL') ||
                        typeUpper.includes('ENTRAP') ||
                        typeUpper.includes('EXTRICAT') ||
                        typeUpper.includes('TRAUMA') ||
                        typeUpper.includes('ROADBLOCK');

      const stableId = `FHP-${county}-${stableHash(received + location)}`;
      const googleMaps = hasCoords ? `https://www.google.com/maps?q=${lat},${lon}` : undefined;

      incidents.push({
        id: stableId,
        type,
        location: `${location}, ${county} County, FL`,
        lat: hasCoords ? lat : null,
        lng: hasCoords ? lon : null,
        severity: typeUpper.includes('FATAL') ? 'critical' : hasInjury ? 'critical' : (isSWFLCounty || isTargetCity) ? 'critical' : 'high',
        actionRequired: hasInjury || isSWFLCounty || isTargetCity,
        source: "fhp_hsmv",
        state: "FL",
        county,
        remarks,
        received,
        distanceMiles,
        googleMaps,
      });
    });

    if (incidents.length === 0) {
      console.log("📡 SENTINEL: Parsed HTML — no crash rows found (page may have changed structure)");
      return { status: "empty", incidents: [] };
    }

    const swflCount = incidents.filter(i => i.actionRequired).length;
    console.log(`📡 SENTINEL: FHP HSMV returned ${incidents.length} crashes statewide (${swflCount} in SWFL priority zone)`);
    return { status: "ok", incidents };
  } catch (parseErr: any) {
    const msg = `FHP HSMV HTML parse error: ${parseErr?.message || String(parseErr)}`;
    console.error(`📡 SENTINEL: ${msg}`);
    return { status: "error", incidents: [], error: msg };
  }
}

export async function processLiveSentinelFeed(): Promise<SentinelIncidentRaw[]> {
  const results = await processFHPHSMVFeed();
  console.log(`📡 SENTINEL: Live scan complete — ${results.length} FL crashes found`);

  const webhookUrl = process.env.APEX_WEBHOOK_URL;
  if (webhookUrl && results.length > 0) {
    for (const crash of results) {
      try {
        await axios.post(webhookUrl, {
          type: crash.type,
          county: crash.county,
          distance_miles: crash.distanceMiles,
          google_maps: crash.googleMaps,
          timestamp: crash.received,
          lat: crash.lat,
          lng: crash.lng,
          severity: crash.severity,
          location: crash.location,
          remarks: crash.remarks,
        });
        console.log(`🚀 SENTINEL: Lead sent to Apex webhook — ${crash.type} in ${crash.county} (${crash.distanceMiles} mi)`);
      } catch (e: any) {
        console.error(`📡 SENTINEL: Webhook fire failed:`, e.message);
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

const SENTINEL_SCAN_INTERVAL_MS = 15 * 60 * 1000;
let sentinelScanTimer: ReturnType<typeof setInterval> | null = null;

export function startSentinelScheduler(): void {
  if (sentinelScanTimer) {
    console.log("[SENTINEL] Scheduler already running");
    return;
  }

  console.log(`[SENTINEL] Background scan scheduler started (interval: ${SENTINEL_SCAN_INTERVAL_MS / 60000}m)`);

  const runScan = () => {
    processLiveSentinelFeed()
      .then(results => console.log(`[SENTINEL] Scheduled scan complete: ${results.length} incident(s) found`))
      .catch(err => console.error(`[SENTINEL] Scheduled scan error: ${err.message}`));
  };

  setTimeout(runScan, 30_000);

  sentinelScanTimer = setInterval(runScan, SENTINEL_SCAN_INTERVAL_MS);
}

export function stopSentinelScheduler(): void {
  if (sentinelScanTimer) {
    clearInterval(sentinelScanTimer);
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
