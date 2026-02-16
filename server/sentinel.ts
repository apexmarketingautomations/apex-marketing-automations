import axios from 'axios';

const META_VERSION = 'v18.0';
const LVMPD_DATA_URL = "https://services.arcgis.com/s9H9v64pX9S6X36r/arcgis/rest/services/LVMPD_Calls_For_Service/FeatureServer/0/query";
const FHP_FEED_URL = "https://www.flhsmv.gov/fhp/traffic/live_traffic_feed.html";

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
}

export async function processLVMPDFeed(): Promise<SentinelIncidentRaw[]> {
  try {
    const params = {
      where: "Incident_Type_Description LIKE '%ACCIDENT%'",
      outFields: "*",
      f: "json",
      resultRecordCount: 10,
      orderByFields: "Incident_Date DESC",
    };

    console.log("📡 SENTINEL: Scraping LVMPD live feed...");
    const response = await axios.get(LVMPD_DATA_URL, { params, timeout: 10000 });
    const incidents = response.data?.features;

    if (!incidents || !Array.isArray(incidents) || incidents.length === 0) {
      console.log("📡 SENTINEL: LVMPD feed returned no incidents");
      return [];
    }

    const results = incidents.map((inc: any) => {
      const data = inc.attributes;
      const desc = (data.Incident_Type_Description || "").toUpperCase();
      const isHighValue = desc.includes('INJURIES') ||
                          desc.includes('ENTRAPMENT') ||
                          desc.includes('EXTRICATION') ||
                          desc.includes('FATALITY');

      const stableId = data.Incident_Number || data.OBJECTID;
      if (!stableId) return null;

      return {
        id: String(stableId),
        type: data.Incident_Type_Description || "UNKNOWN",
        location: data.Address || "Unknown Location",
        lat: data.Latitude != null ? data.Latitude : null,
        lng: data.Longitude != null ? data.Longitude : null,
        severity: isHighValue ? 'critical' : 'high',
        actionRequired: isHighValue,
        source: "lvmpd_live",
        state: "NV",
      };
    }).filter((x): x is SentinelIncidentRaw => x !== null);

    console.log(`📡 SENTINEL: LVMPD returned ${results.length} incidents`);
    return results;
  } catch (error: any) {
    console.error("📡 SENTINEL LVMPD ERROR:", error?.message || error);
    return [];
  }
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

export async function processFloridaFHPFeed(): Promise<SentinelIncidentRaw[]> {
  try {
    console.log("📡 SENTINEL: Scraping Florida FHP live feed...");
    const response = await axios.get(FHP_FEED_URL, { timeout: 15000 });
    const html: string = response.data;

    if (!html || typeof html !== 'string' || html.length < 100) {
      console.log("📡 SENTINEL: FHP feed returned empty or invalid response");
      return [];
    }

    const incidents: SentinelIncidentRaw[] = [];
    const seenHashes = new Set<string>();

    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const rowContent = rowMatch[1];
      if (rowContent.includes('<th')) continue;

      const cells: string[] = [];
      let cellMatch;
      cellRegex.lastIndex = 0;

      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]*>/g, '').trim());
      }

      if (cells.length < 3) continue;

      const rawDesc = cells.join(' ').toUpperCase();
      const isAccident = rawDesc.includes('CRASH') ||
                         rawDesc.includes('ACCIDENT') ||
                         rawDesc.includes('COLLISION') ||
                         rawDesc.includes('MVA') ||
                         rawDesc.includes('OVERTURN') ||
                         rawDesc.includes('ROLLOVER') ||
                         rawDesc.includes('HIT AND RUN');

      if (!isAccident) continue;

      const hasInjury = rawDesc.includes('INJUR') ||
                        rawDesc.includes('FATAL') ||
                        rawDesc.includes('ENTRAP') ||
                        rawDesc.includes('EXTRICAT') ||
                        rawDesc.includes('TRAUMA') ||
                        rawDesc.includes('RESCUE');

      const description = cells[2] || cells[1] || cells[0] || "Traffic Incident";
      const location = cells[1] || cells[0] || "Florida";

      const contentHash = stableHash(cells.join('|'));
      if (seenHashes.has(contentHash)) continue;
      seenHashes.add(contentHash);

      const stableId = cells[0]
        ? `FHP-${cells[0].replace(/[^a-zA-Z0-9]/g, '-').substring(0, 40)}`
        : `FHP-${contentHash}`;

      incidents.push({
        id: stableId,
        type: description.substring(0, 200),
        location: location.substring(0, 300),
        lat: null,
        lng: null,
        severity: hasInjury ? 'critical' : 'high',
        actionRequired: hasInjury,
        source: "fhp_live",
        state: "FL",
      });
    }

    console.log(`📡 SENTINEL: FHP returned ${incidents.length} incidents`);
    return incidents;
  } catch (error: any) {
    console.error("📡 SENTINEL FHP ERROR:", error?.message || error);
    return [];
  }
}

export async function processLiveSentinelFeed(): Promise<SentinelIncidentRaw[]> {
  const [lvmpd, fhp] = await Promise.allSettled([
    processLVMPDFeed(),
    processFloridaFHPFeed(),
  ]);

  const results: SentinelIncidentRaw[] = [];

  if (lvmpd.status === 'fulfilled') results.push(...lvmpd.value);
  if (fhp.status === 'fulfilled') results.push(...fhp.value);

  console.log(`📡 SENTINEL: Combined ${results.length} total live incidents (LVMPD: ${lvmpd.status === 'fulfilled' ? lvmpd.value.length : 'failed'}, FHP: ${fhp.status === 'fulfilled' ? fhp.value.length : 'failed'})`);
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
