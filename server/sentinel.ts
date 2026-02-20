import axios from 'axios';
import * as cheerio from 'cheerio';

const META_VERSION = 'v18.0';
const FHP_HSMV_URL = "https://trafficincidents.flhsmv.gov/SmartWebClient/CadView.aspx";

const SWFL_COUNTIES = ['LEE', 'COLLIER', 'CHARLOTTE', 'HENDRY', 'GLADES'];

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

export async function processFHPHSMVFeed(targetCounties?: string[]): Promise<SentinelIncidentRaw[]> {
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

    $('#gvCAD_DXMainTable tr').each((_i, tr) => {
      const cells: string[] = [];
      $(tr).find('td').each((_j, td) => {
        cells.push($(td).text().trim());
      });

      if (cells.length !== 9) return;
      if (cells[0] === 'Incident Type' || cells[0].length < 3) return;

      const [type, received, _dispatched, _arrived, county, location, remarks, latStr, lngStr] = cells;

      const typeUpper = type.toUpperCase();
      const isCrash = typeUpper.includes('CRASH') ||
                      typeUpper.includes('FATALITY') ||
                      typeUpper.includes('HIT AND RUN') ||
                      typeUpper.includes('ACCIDENT') ||
                      typeUpper.includes('COLLISION') ||
                      typeUpper.includes('ROLLOVER');

      if (!isCrash) return;

      if (targetCounties && targetCounties.length > 0) {
        const countyUpper = county.toUpperCase();
        if (!targetCounties.some(tc => countyUpper.includes(tc.toUpperCase()))) return;
      }

      const contentHash = stableHash(`${type}|${received}|${location}|${latStr}`);
      if (seenHashes.has(contentHash)) return;
      seenHashes.add(contentHash);

      const lat = parseFloat(latStr);
      const lng = parseFloat(lngStr);
      const hasCoords = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;

      const hasInjury = typeUpper.includes('INJUR') ||
                        typeUpper.includes('FATAL') ||
                        typeUpper.includes('ENTRAP') ||
                        typeUpper.includes('EXTRICAT') ||
                        typeUpper.includes('TRAUMA') ||
                        typeUpper.includes('ROADBLOCK');

      const stableId = `FHP-${county}-${stableHash(received + location)}`;

      incidents.push({
        id: stableId,
        type,
        location: `${location}, ${county} County, FL`,
        lat: hasCoords ? lat : null,
        lng: hasCoords ? lng : null,
        severity: typeUpper.includes('FATAL') ? 'critical' : hasInjury ? 'critical' : 'high',
        actionRequired: hasInjury,
        source: "fhp_hsmv",
        state: "FL",
        county,
        remarks,
        received,
      });
    });

    console.log(`📡 SENTINEL: FHP HSMV returned ${incidents.length} crash incidents${targetCounties ? ` (filtered: ${targetCounties.join(', ')})` : ' (all FL)'}`);
    return incidents;
  } catch (error: any) {
    console.error("📡 SENTINEL FHP HSMV ERROR:", error?.message || error);
    return [];
  }
}

export async function processLiveSentinelFeed(targetCounties?: string[]): Promise<SentinelIncidentRaw[]> {
  const counties = targetCounties || SWFL_COUNTIES;
  const results = await processFHPHSMVFeed(counties);
  console.log(`📡 SENTINEL: Live scan complete — ${results.length} crashes found in ${counties.join(', ')}`);
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
