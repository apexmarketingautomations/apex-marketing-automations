import axios from 'axios';

const META_VERSION = 'v18.0';
const LVMPD_DATA_URL = "https://services.arcgis.com/s9H9v64pX9S6X36r/arcgis/rest/services/LVMPD_Calls_For_Service/FeatureServer/0/query";

export interface SentinelIncidentRaw {
  id: string;
  type: string;
  location: string;
  lat: number | null;
  lng: number | null;
  severity: string;
  actionRequired: boolean;
}

export async function processLiveSentinelFeed(): Promise<SentinelIncidentRaw[]> {
  try {
    const params = {
      where: "Incident_Type_Description LIKE '%ACCIDENT%'",
      outFields: "*",
      f: "json",
      resultRecordCount: 5,
      orderByFields: "Incident_Date DESC",
    };

    const response = await axios.get(LVMPD_DATA_URL, { params, timeout: 10000 });
    const incidents = response.data?.features;

    if (!incidents || !Array.isArray(incidents) || incidents.length === 0) {
      console.log("📡 SENTINEL: LVMPD feed returned no incidents");
      return [];
    }

    return incidents.map((inc: any) => {
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
      };
    }).filter((x): x is SentinelIncidentRaw => x !== null);
  } catch (error: any) {
    console.error("📡 SENTINEL SCRAPER ERROR:", error?.message || error);
    return [];
  }
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
