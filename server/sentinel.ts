import axios from 'axios';
import * as cheerio from 'cheerio';
import { getDistance } from 'geolib';

const META_VERSION = 'v18.0';
const FHP_HSMV_URL = "https://trafficincidents.flhsmv.gov/SmartWebClient/CADView.aspx";

const DEFAULT_TARGET_COUNTIES = ['LEE', 'COLLIER', 'CHARLOTTE'];
const DEFAULT_RADIUS_METERS = 80467; // 50 miles

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

export async function processFHPHSMVFeed(targetCounties?: string[], radiusMeters?: number): Promise<SentinelIncidentRaw[]> {
  try {
    console.log("📡 SENTINEL: Scraping FHP HSMV live feed (trafficincidents.flhsmv.gov)...");
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
    const counties = targetCounties || DEFAULT_TARGET_COUNTIES;
    const radius = radiusMeters || parseInt(process.env.RADIUS_METERS || '') || DEFAULT_RADIUS_METERS;

    const clientLat = parseFloat(process.env.CLIENT_LAT || '');
    const clientLon = parseFloat(process.env.CLIENT_LON || '');
    const hasClientLocation = !isNaN(clientLat) && !isNaN(clientLon);

    if (hasClientLocation) {
      console.log(`📡 SENTINEL: Client HQ at ${clientLat}, ${clientLon} — Radius: ${(radius / 1609.34).toFixed(1)} mi`);
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

      if (!counties.some(tc => county.toUpperCase().includes(tc.toUpperCase()))) return;

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
      let withinRadius = true;

      if (hasCoords && hasClientLocation) {
        const crashLoc = { latitude: lat, longitude: lon };
        const clientLoc = { latitude: clientLat, longitude: clientLon };
        const distanceMeters = getDistance(crashLoc, clientLoc);
        distanceMiles = (distanceMeters / 1609.34).toFixed(2);
        withinRadius = distanceMeters <= radius;
      }

      if (!withinRadius) return;

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
        severity: typeUpper.includes('FATAL') ? 'critical' : hasInjury ? 'critical' : 'high',
        actionRequired: hasInjury,
        source: "fhp_hsmv",
        state: "FL",
        county,
        remarks,
        received,
        distanceMiles,
        googleMaps,
      });
    });

    console.log(`📡 SENTINEL: FHP HSMV returned ${incidents.length} crashes in ${counties.join(', ')} within ${(radius / 1609.34).toFixed(0)}-mile radius`);
    return incidents;
  } catch (error: any) {
    console.error("📡 SENTINEL FHP HSMV ERROR:", error?.message || error);
    return [];
  }
}

export async function processLiveSentinelFeed(targetCounties?: string[]): Promise<SentinelIncidentRaw[]> {
  const counties = targetCounties || DEFAULT_TARGET_COUNTIES;
  const results = await processFHPHSMVFeed(counties);
  console.log(`📡 SENTINEL: Live scan complete — ${results.length} crashes found in ${counties.join(', ')}`);

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
}, radiusMiles: number = 1): Promise<GeofenceResult> {
  const metaAccessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  if (!metaAccessToken || !adAccountId) {
    console.log(`📡 META ADS: No credentials — SIMULATION MODE for ${incident.location}`);
    return { status: "SIMULATION_MODE", message: "Add Meta Credentials for Live Fire" };
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
