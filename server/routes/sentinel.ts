import type { Express, Request, Response } from "express";
import { insertSentinelIncidentSchema, messages } from "@shared/schema";
import type { CadUnitAssigned, CadTimelineEvent, SentinelIncident } from "@shared/schema";
import { storage } from "../storage";
import { z } from "zod";
import { processLiveSentinelFeed, deployGeofenceAd } from "../sentinel";
import { buildCrashMergeUpdate, resolveGeofenceTarget } from "../sentinel-accident-v2";
import {
  fetchHomeSvcSignals,
  scoreHomeSvcOpportunity,
  resolveTerritory,
  findClusterMetadata,
  evaluateDeliveryRules,
  isAlertExpired,
  alertExpiryStatus,
} from "../sentinel-home-svc";
import type { HomeSvcSignal, HomeSvcConfigShape } from "../sentinel-home-svc";
import { asyncHandler, parseIntParam, verifyAccountOwnership, requirePlanFeature } from "./helpers";
import { enforceSmsProvider } from "../smsGatewayGuard";

// --- Zod schema for CAD ingestion payload ---
const cadUnitSchema = z.object({
  unitId: z.string(),
  unitType: z.string().optional(),
  dispatchedAt: z.string().optional(),
  arrivedAt: z.string().optional(),
  clearedAt: z.string().optional(),
});

const cadTimelineEventSchema = z.object({
  timestamp: z.string(),
  event: z.string(),
  unit: z.string().optional(),
  details: z.string().optional(),
});

const cadIngestPayloadSchema = z.object({
  source: z.string().min(1),
  externalIncidentId: z.string().min(1),
  subAccountId: z.number().int().positive(),
  dispatchedAs: z.string().optional(),
  callNotes: z.string().optional(),
  unitsAssigned: z.array(cadUnitSchema).optional(),
  responseTimeline: z.array(cadTimelineEventSchema).optional(),
  location: z.object({
    address: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
  }).optional(),
  severity: z.string().optional(),
  status: z.string().optional(),
  timestamps: z.object({
    received: z.string().optional(),
    dispatched: z.string().optional(),
    firstUnitArrived: z.string().optional(),
    cleared: z.string().optional(),
  }).optional(),
});

/**
 * Merge CAD units by unitId: update existing units with newer data, append new ones.
 * Never removes existing units.
 */
function mergeUnitsAssigned(
  existing: CadUnitAssigned[] | null | undefined,
  incoming: CadUnitAssigned[] | undefined
): CadUnitAssigned[] | null {
  if (!incoming || incoming.length === 0) return (existing as CadUnitAssigned[]) || null;
  const merged = new Map<string, CadUnitAssigned>();
  if (Array.isArray(existing)) {
    for (const u of existing) merged.set(u.unitId, { ...u });
  }
  for (const u of incoming) {
    const prev = merged.get(u.unitId);
    if (prev) {
      merged.set(u.unitId, {
        ...prev,
        ...(u.unitType !== undefined ? { unitType: u.unitType } : {}),
        ...(u.dispatchedAt !== undefined ? { dispatchedAt: u.dispatchedAt } : {}),
        ...(u.arrivedAt !== undefined ? { arrivedAt: u.arrivedAt } : {}),
        ...(u.clearedAt !== undefined ? { clearedAt: u.clearedAt } : {}),
      });
    } else {
      merged.set(u.unitId, { ...u });
    }
  }
  return Array.from(merged.values());
}

/**
 * Merge timeline events: deduplicate by (timestamp, event, unit) tuple, append new, sort by timestamp.
 */
function mergeResponseTimeline(
  existing: CadTimelineEvent[] | null | undefined,
  incoming: CadTimelineEvent[] | undefined
): CadTimelineEvent[] | null {
  if (!incoming || incoming.length === 0) return (existing as CadTimelineEvent[]) || null;
  const key = (e: CadTimelineEvent) => `${e.timestamp}|${e.event}|${e.unit || ""}`;
  const seen = new Set<string>();
  const result: CadTimelineEvent[] = [];
  if (Array.isArray(existing)) {
    for (const e of existing) {
      seen.add(key(e));
      result.push(e);
    }
  }
  for (const e of incoming) {
    if (!seen.has(key(e))) {
      seen.add(key(e));
      result.push(e);
    }
  }
  result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return result;
}

/**
 * Build a safe partial update object from CAD payload for an existing incident.
 * Rules:
 * - Never overwrite a populated field with null/undefined
 * - Scalar fields (dispatchedAs, callNotes): overwrite only if incoming is non-empty string
 * - unitsAssigned: merge by unitId
 * - responseTimeline: merge by (timestamp, event, unit)
 * - Always sets cadLastUpdatedAt = now()
 */
function buildCadMergeUpdate(
  existing: SentinelIncident,
  payload: z.infer<typeof cadIngestPayloadSchema>
): Record<string, any> {
  const update: Record<string, any> = {
    cadLastUpdatedAt: new Date(),
    cadSource: payload.source.trim().toLowerCase(),
    cadExternalId: payload.externalIncidentId.trim(),
  };

  if (payload.dispatchedAs && payload.dispatchedAs.trim().length > 0) {
    update.dispatchedAs = payload.dispatchedAs;
  }
  if (payload.callNotes && payload.callNotes.trim().length > 0) {
    update.callNotes = payload.callNotes;
  }
  if (payload.severity && payload.severity.trim().length > 0 && !existing.severity) {
    update.severity = payload.severity;
  } else if (payload.severity && payload.severity.trim().length > 0) {
    update.severity = payload.severity;
  }
  if (payload.status && payload.status.trim().length > 0) {
    update.actionStatus = payload.status;
  }
  if (payload.location) {
    if (payload.location.address && !existing.location) {
      update.location = payload.location.address;
    } else if (payload.location.address) {
      update.location = payload.location.address;
    }
    if (payload.location.lat !== undefined) update.lat = payload.location.lat;
    if (payload.location.lng !== undefined) update.lng = payload.location.lng;
  }

  update.unitsAssigned = mergeUnitsAssigned(
    existing.unitsAssigned as CadUnitAssigned[] | null,
    payload.unitsAssigned
  );
  update.responseTimeline = mergeResponseTimeline(
    existing.responseTimeline as CadTimelineEvent[] | null,
    payload.responseTimeline
  );

  return update;
}

export function registerSentinelRoutes(app: Express) {
  // ---- Sentinel Module ----
  app.get("/api/sentinel/config/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { allowed, plan } = await requirePlanFeature(subAccountId, 'sentinel');
    if (!allowed) return res.status(403).json({ error: "upgrade_required", feature: "sentinel", currentPlan: plan, requiredPlan: "pro", message: "Sentinel is a Pro feature. Upgrade to access real-time crash detection." });
    const config = await storage.getSentinelConfig(subAccountId);
    res.json(config || {
      subAccountId,
      keywords: ['MVA', 'EXTRICATION', 'ROLLOVER', 'INJURIES', 'SIGNAL 4', 'ENTRAPMENT', 'FATALITY'],
      scanInterval: 60,
      enabled: false,
      smsAlertEnabled: true,
      geofenceEnabled: true,
      geofenceRadiusMiles: 1,
      niche: 'accident',
    });
  }));

  app.put("/api/sentinel/config", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      subAccountId: z.number().int().positive(),
      keywords: z.array(z.string()).optional(),
      scanInterval: z.number().int().min(10).max(3600).optional(),
      enabled: z.boolean().optional(),
      smsAlertEnabled: z.boolean().optional(),
      geofenceEnabled: z.boolean().optional(),
      geofenceRadiusMiles: z.number().min(0.1).max(50).optional(),
      niche: z.enum(['accident', 'home_services']).optional(),
      homeSvcConfig: z.object({
        territories: z.array(
          z.object({
            name:       z.string().min(1),
            stateCodes: z.array(z.string().length(2)).min(1),
            counties:   z.array(z.string()).optional(),
            cities:     z.array(z.string()).optional(),
          })
        ).optional(),
        deliveryRules: z.array(
          z.object({
            id:           z.string().min(1),
            name:         z.string().min(1),
            action:       z.literal('auto_queue'),
            serviceTypes: z.array(z.string()).optional(),
            signalTypes:  z.array(z.string()).optional(),
            territory:    z.string().optional(),
            minScore:     z.number().min(0).max(100).optional(),
          })
        ).optional(),
      }).optional().nullable(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { allowed, plan } = await requirePlanFeature(parsed.data.subAccountId, 'sentinel');
    if (!allowed) return res.status(403).json({ error: "upgrade_required", feature: "sentinel", currentPlan: plan, requiredPlan: "pro" });

    const config = await storage.upsertSentinelConfig(parsed.data as any);
    res.json(config);
  }));

  app.get("/api/sentinel/incidents/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { allowed, plan } = await requirePlanFeature(subAccountId, 'sentinel');
    if (!allowed) return res.status(403).json({ error: "upgrade_required", feature: "sentinel", currentPlan: plan, requiredPlan: "pro" });
    const incidents = await storage.getSentinelIncidents(subAccountId);
    res.json(incidents);
  }));

  app.post("/api/sentinel/scan", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      subAccountId: z.number().int().positive(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { allowed, plan } = await requirePlanFeature(parsed.data.subAccountId, 'sentinel');
    if (!allowed) return res.status(403).json({ error: "upgrade_required", feature: "sentinel", currentPlan: plan, requiredPlan: "pro" });

    const config = await storage.getSentinelConfig(parsed.data.subAccountId);
    const keywords = config?.keywords?.length ? config.keywords : ['MVA', 'EXTRICATION', 'ROLLOVER', 'INJURIES', 'SIGNAL 4', 'ENTRAPMENT', 'FATALITY'];

    const niche = config?.niche || 'accident';

    if (niche === 'home_services') {
      const targetStates: string[] =
        Array.isArray(config?.targetStates) ? (config!.targetStates as string[]) : [];

      const homeSvcConfig: HomeSvcConfigShape = (config as any)?.homeSvcConfig ?? {};
      const territories   = homeSvcConfig.territories   ?? [];
      const deliveryRules = homeSvcConfig.deliveryRules  ?? [];

      let signals: HomeSvcSignal[] = [];
      try {
        signals = await fetchHomeSvcSignals(targetStates);
      } catch (err: any) {
        console.error('[SENTINEL HOME SVC] fetchHomeSvcSignals threw unexpectedly:', err?.message);
        signals = [];
      }

      let recentIncidents: any[] = [];
      try {
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const all = await storage.getSentinelIncidentsFiltered(parsed.data.subAccountId, {
          since: since24h,
          limit: 100,
        });
        recentIncidents = all.filter(
          i => (i.rawPayload as any)?.source === 'sentinel_home_svc'
        );
      } catch (err: any) {
        console.warn('[SENTINEL HOME SVC] Cluster pre-query failed — clustering disabled this scan:', err?.message);
        recentIncidents = [];
      }

      const created: any[] = [];
      let autoQueuedCount = 0;

      let expiredSkipped = 0;

      for (const sig of signals) {
        const expired = isAlertExpired(sig.expires);
        if (expired) {
          expiredSkipped++;
          continue;
        }

        const hash = Buffer.from(sig.id).toString("base64").substring(0, 64);

        const existing = await storage.getSentinelIncidentByHash(
          parsed.data.subAccountId,
          hash,
        );
        if (existing) continue;

        const territory = resolveTerritory(sig, territories);
        const cluster   = findClusterMetadata(sig, recentIncidents);
        const scoring   = scoreHomeSvcOpportunity(sig, {
          territory,
          clusterSize: cluster.clusterSize,
          sentAtIso:   sig.sent,
        });
        const expiryStatus = alertExpiryStatus(sig.expires);
        const delivery  = evaluateDeliveryRules(
          sig,
          scoring.opportunityScore,
          territory,
          deliveryRules,
        );

        if (delivery.actionStatus === 'auto_queued') autoQueuedCount++;

        const record = await storage.createSentinelIncident({
          subAccountId:     parsed.data.subAccountId,
          sourceHash:       hash,
          title:            sig.event,
          description:      sig.headline || null,
          location:         sig.areaDesc || null,
          severity:         sig.severity,
          actionStatus:     delivery.actionStatus,
          smsSent:          false,
          geofenceDeployed: false,
          lat:              sig.lat ?? null,
          lng:              sig.lng ?? null,
          rawPayload: {
            source:          'sentinel_home_svc',
            noaaId:          sig.id,
            noaaEvent:       sig.event,
            signalType:      sig.signalType,
            serviceTypes:    sig.serviceTypes,
            noaaSeverity:    sig.noaaSeverity,
            noaaUrgency:     sig.noaaUrgency,
            noaaCertainty:   sig.noaaCertainty,
            expires:         sig.expires,
            expiryStatus,
            onset:           sig.effective,
            state:           sig.state,
            county:          sig.areaDesc,
            received:        sig.sent,
            googleMaps:      sig.googleMaps,
            actionRequired:  sig.actionRequired,
            opportunityScore:          scoring.opportunityScore,
            scoreBreakdown:            scoring.scoreBreakdown,
            scoreTier:                 scoring.scoreTier,
            scoreTierLabel:            scoring.scoreTierLabel,
            leadReadiness:             scoring.leadReadiness,
            serviceValueTier:          scoring.serviceValueTier,
            territory,
            clusterId:                 cluster.clusterId,
            clusterSize:               cluster.clusterSize,
            clusterDominantSignalType: cluster.clusterDominantSignalType,
            clusterOpportunityScore:   cluster.clusterOpportunityScore,
          },
        });

        created.push(record);
      }

      await storage.createAuditLog({
        action:      "SENTINEL_SCAN",
        performedBy: user?.claims?.sub || user?.id || "system",
        details: {
          subAccountId:  parsed.data.subAccountId,
          niche:         "home_services",
          source:        "noaa_nws",
          targetStates,
          signalsFound:  signals.length,
          newIncidents:  created.length,
          autoQueued:    autoQueuedCount,
          expiredSkipped,
        },
      });

      return res.json({
        source:    "noaa_nws",
        found:     created.length,
        incidents: created,
        niche:     "home_services",
      });
    }

    let incidents: any[] = [];
    const sources: string[] = [];

    // Live Feed: FHP HSMV (Florida Highway Patrol — ALL Florida crashes)
    try {
      console.log(`📡 SENTINEL: Pulling FHP HSMV live feed — ALL Florida crashes...`);
      const liveIncidents = await processLiveSentinelFeed();

      if (liveIncidents.length > 0) {
        incidents = liveIncidents.map(inc => ({
          title: inc.type,
          description: `${inc.type} at ${inc.location}. ${inc.distanceMiles !== 'unknown' ? inc.distanceMiles + ' mi from HQ.' : ''} ${inc.actionRequired ? 'HIGH VALUE — Injuries/Fatality.' : 'Crash detected.'} County: ${inc.county || 'FL'}. ${inc.remarks || ''} [${inc.source.toUpperCase()}]`,
          location: inc.location,
          severity: inc.severity,
          rawPayload: { id: inc.id, lat: inc.lat, lng: inc.lng, type: inc.type, source: inc.source, state: inc.state, county: inc.county, remarks: inc.remarks, received: inc.received, distanceMiles: inc.distanceMiles, googleMaps: inc.googleMaps },
        }));

        sources.push("fhp_hsmv");
        console.log(`📡 SENTINEL: ${liveIncidents.length} live crashes found`);
      } else {
        console.log("📡 SENTINEL: No crashes currently active statewide");
      }
    } catch (e) {
      console.log("📡 SENTINEL: FHP HSMV feed scrape failed:", (e as any).message);
    }

    const source = sources.length > 0 ? sources.join("+") : "no_data";

    const created = [];
    for (const inc of incidents) {
      const hashInput = inc.rawPayload?.id
        ? `${inc.rawPayload.id}`
        : `${inc.title}-${inc.location}`;
      const hash = Buffer.from(hashInput).toString("base64").substring(0, 64);

      const existing = await storage.getSentinelIncidentByHash(parsed.data.subAccountId, hash);

      if (!existing) {
        const record = await storage.createSentinelIncident({
          subAccountId:     parsed.data.subAccountId,
          sourceHash:       hash,
          title:            inc.title,
          description:      `${inc.title} at ${inc.location}. ${inc.distanceMiles !== 'unknown' ? inc.distanceMiles + ' mi from HQ.' : ''} County: ${inc.county || 'FL'}. ${inc.remarks || ''} [${inc.source?.toUpperCase() || 'UNKNOWN'}]`,
          location:         inc.location,
          severity:         inc.severity || "medium",
          rawPayload: {
            ...(inc.rawPayload || {}),
            operatorPriority: (inc as any)._operatorPriority ?? 'monitor',
            priorityScore:    (inc as any)._priorityScore    ?? 0,
          },
          actionStatus:     "pending",
          smsSent:          false,
          geofenceDeployed: false,
        });
        created.push(record);

      } else {
        const mergeResult = buildCrashMergeUpdate({
          existingSeverity:     existing.severity || 'low',
          existingActionStatus: existing.actionStatus || 'pending',
          newSeverity:          inc.severity || 'low',
          newDescription:       inc.remarks || null,
          newRawPayload: {
            ...(existing.rawPayload as object || {}),
            remarks:   inc.remarks,
            received:  inc.received,
            priorityScore: (inc as any)._priorityScore ?? 0,
          },
        });

        if (
          mergeResult &&
          (mergeResult.action === 'severity_upgraded' || mergeResult.action === 're_pended') &&
          Object.keys(mergeResult.updates).length > 0
        ) {
          const updated = await storage.updateSentinelIncident(existing.id, mergeResult.updates);
          console.log(
            `[SENTINEL MERGE] Incident ${existing.id} — ${mergeResult.action}: ` +
            `${existing.severity} → ${inc.severity}`
          );
          if (mergeResult.action === 're_pended' && updated) {
            created.push(updated);
          }
        }
      }
    }

    await storage.createAuditLog({
      action: "SENTINEL_SCAN",
      performedBy: user?.claims?.sub || user?.id || "system",
      details: { subAccountId: parsed.data.subAccountId, source, found: created.length, niche: config?.niche ?? "accident" },
    });

    res.json({ source, found: created.length, incidents: created });
  }));

  app.post("/api/sentinel/incidents", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const parsed = insertSentinelIncidentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const userAccounts = await storage.getSubAccounts(user.id);
    if (!userAccounts.some(a => a.id === parsed.data.subAccountId)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const incident = await storage.createSentinelIncident(parsed.data);
    res.status(201).json(incident);
  }));

  app.post("/api/sentinel/incidents/:id/deploy-geofence", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = parseIntParam(req.params.id, "id");
    const incident = await storage.getSentinelIncident(id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    const incidentRaw = incident.rawPayload as any;
    if (incidentRaw?.source === 'sentinel_home_svc') {
      return res.status(400).json({
        error: "Geofence deployment is not available for Home Services incidents.",
        code:  "home_svc_geofence_unavailable",
      });
    }

    const config = await storage.getSentinelConfig(incident.subAccountId);
    if (config && config.geofenceEnabled === false) {
      return res.status(400).json({ error: "Geofence ads are disabled in Sentinel config." });
    }
    const radius = config?.geofenceRadiusMiles || 1;

    console.log(`📡 APEX SENTINEL: Deploying Geofence to ${incident.location}...`);
    console.log(`📡 Target radius: ${radius} mile(s) — Severity: ${incident.severity?.toUpperCase()}`);

    const rawPayload = incident.rawPayload as any;

    const geoTarget = resolveGeofenceTarget({
      lat:      rawPayload?.lat,
      lng:      rawPayload?.lng,
      location: incident.location,
    });

    if (!geoTarget) {
      return res.status(400).json({
        error:  "Cannot deploy geofence — no valid coordinates or address available for this incident.",
        code:   "geofence_no_target",
      });
    }

    const metaConnection = await storage.getIntegrationConnection(incident.subAccountId, "meta-ads");
    const metaCreds = metaConnection?.status === "connected" && metaConnection.config
      ? { accessToken: (metaConnection.config as any).accessToken, adAccountId: (metaConnection.config as any).adAccountId }
      : undefined;

    const geoResult = await deployGeofenceAd({
      id:       incident.id,
      location: incident.location || "",
      lat:      geoTarget.type === 'coordinates' ? geoTarget.lat : null,
      lng:      geoTarget.type === 'coordinates' ? geoTarget.lng : null,
      title:    incident.title || undefined,
    }, radius, metaCreds);

    console.log(
      `[SENTINEL GEOFENCE] Deployed via ${geoTarget.type} targeting to ${incident.location}`
    );

    await storage.updateSentinelIncident(id, {
      geofenceDeployed: true,
      actionStatus: "geofence_deployed",
    });

    await storage.createAuditLog({
      action: "SENTINEL_GEOFENCE_DEPLOYED",
      performedBy: user?.claims?.sub || user?.id || "system",
      details: { incidentId: id, location: incident.location, radiusMiles: radius, metaResult: geoResult },
    });

    res.json({
      success: true,
      message: `Geofence ads deployed to ${radius}-mile radius of ${incident.location}`,
      metaAdsStatus: geoResult.status,
      adSetId: geoResult.adSetId || null,
      targeting: { center: incident.location, radiusMiles: radius, severity: incident.severity, lat: rawPayload?.lat, lng: rawPayload?.lng },
    });
  }));

  app.post("/api/sentinel/incidents/:id/send-sms", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = parseIntParam(req.params.id, "id");
    const incident = await storage.getSentinelIncident(id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    const sentinelConf = await storage.getSentinelConfig(incident.subAccountId);
    if (sentinelConf && sentinelConf.smsAlertEnabled === false) {
      return res.status(400).json({ error: "SMS alerts are disabled in Sentinel config." });
    }

    const account = await storage.getSubAccount(incident.subAccountId);
    if (!account?.ownerPhone) {
      return res.status(400).json({ error: "No owner phone number configured for this account." });
    }

    const smsRaw = incident.rawPayload as any;
    const isHomeSvcIncident = smsRaw?.source === 'sentinel_home_svc';

    let alertMsg: string;

    if (isHomeSvcIncident) {
      const svcList = Array.isArray(smsRaw?.serviceTypes) && smsRaw.serviceTypes.length > 0
        ? (smsRaw.serviceTypes as string[])
            .map((s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()))
            .join(', ')
        : 'Home Services';

      const expiresLine = smsRaw?.expires
        ? `Expires: ${new Date(smsRaw.expires).toLocaleString()}`
        : '';

      alertMsg = [
        `🏠 APEX SENTINEL — HOME SERVICES ALERT`,
        ``,
        `${incident.severity?.toUpperCase()} PRIORITY: ${incident.title}`,
        `📍 ${incident.location || 'Area not specified'}`,
        ``,
        `Services: ${svcList}`,
        expiresLine,
        ``,
        `Review this signal in your Sentinel dashboard and flag leads.`,
      ].filter(Boolean).join('\n');

    } else {
      alertMsg = `🚨 APEX SENTINEL ALERT\n\n${incident.severity?.toUpperCase()} PRIORITY: ${incident.title}\n📍 ${incident.location}\n\n${incident.description}\n\nDeploy geofence ads now from your Sentinel dashboard.`;
    }

    if (!account.twilioNumber) {
      return res.status(400).json({ error: "No Twilio phone number assigned to this account. Add one in account settings." });
    }

    try {
      const { getTwilioClientForAccount } = await import("../twilioClientFactory");
      const clientResult = await getTwilioClientForAccount(incident.subAccountId);
      if (!clientResult) {
        return res.status(503).json({ error: "Twilio is not configured for this account." });
      }
      await enforceSmsProvider("sms", "twilio", { subAccountId: incident.subAccountId, phone: account.ownerPhone, source: "sentinel-incident-sms" });
      await clientResult.client.messages.create({
        body: alertMsg,
        from: account.twilioNumber,
        to: account.ownerPhone,
      });
    } catch (e) {
      const errMsg = (e as any).message || "Unknown Twilio error";
      console.error("[SENTINEL] SMS send failed:", errMsg);
      return res.status(502).json({ error: `SMS delivery failed: ${errMsg}` });
    }

    await storage.updateSentinelIncident(id, {
      smsSent: true,
      actionStatus: incident.geofenceDeployed ? "fully_actioned" : "sms_sent",
    });

    await storage.createAuditLog({
      action: "SENTINEL_SMS_ALERT",
      performedBy: user?.claims?.sub || user?.id || "system",
      details: { incidentId: id, sentTo: account.ownerPhone },
    });

    res.json({ success: true, message: `SMS alert sent to ${account.ownerPhone}` });
  }));

  app.post("/api/sentinel/incidents/:id/acknowledge", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = parseIntParam(req.params.id, "id");
    const incident = await storage.getSentinelIncident(id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    await storage.updateSentinelIncident(id, { actionStatus: "acknowledged" });
    res.json({ success: true });
  }));

  app.post("/api/sentinel/incidents/:id/flag-lead", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = parseIntParam(req.params.id, "id");
    const incident = await storage.getSentinelIncident(id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    const raw = incident.rawPayload as any;
    if (raw?.source !== 'sentinel_home_svc') {
      return res.status(400).json({
        error: "flag-lead is only available for Home Services incidents.",
        code:  "wrong_niche_for_action",
      });
    }

    if (incident.actionStatus === 'lead_flagged') {
      return res.json({ success: true, incidentId: id, actionStatus: 'lead_flagged', alreadyFlagged: true });
    }

    await storage.updateSentinelIncident(id, { actionStatus: 'lead_flagged' });

    await storage.createAuditLog({
      action:      "SENTINEL_HOME_SVC_LEAD_FLAGGED",
      performedBy: user?.claims?.sub || user?.id || "system",
      details: {
        incidentId:   id,
        signalType:   raw?.signalType,
        serviceTypes: raw?.serviceTypes,
        location:     incident.location,
      },
    });

    res.json({ success: true, incidentId: id, actionStatus: 'lead_flagged' });
  }));

  app.get("/api/sentinel/live", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const subAccountId = parseInt(req.query.subAccountId as string) || 1;
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const incidents = await storage.getSentinelIncidents(subAccountId);
    const liveFormat = incidents.slice(0, 20).map(inc => ({
      id: inc.id,
      type: inc.title,
      location: inc.location || "Unknown",
      time: inc.detectedAt ? new Date(inc.detectedAt).toLocaleTimeString() : "Unknown",
      value: (inc.severity || "medium").toUpperCase(),
      dispatchedAs: inc.dispatchedAs,
      callNotes: inc.callNotes,
      unitsAssigned: inc.unitsAssigned,
      responseTimeline: inc.responseTimeline,
      cadSource: inc.cadSource,
      cadExternalId: inc.cadExternalId,
      cadLastUpdatedAt: inc.cadLastUpdatedAt,
    }));
    res.json(liveFormat);
  }));

  // --- CAD Ingestion Endpoint ---
  // Auth: Bypasses session auth (added to auth middleware bypass list).
  // Requires x-sentinel-api-key header matching SENTINEL_CAD_API_KEY env var.
  // If SENTINEL_CAD_API_KEY is not set in env, rejects all requests with 503.
  app.post("/api/sentinel/cad-ingest", asyncHandler(async (req, res) => {
    const configuredKey = process.env.SENTINEL_CAD_API_KEY;
    if (!configuredKey) {
      return res.status(503).json({ error: "CAD ingestion not configured" });
    }

    const providedKey = req.headers["x-sentinel-api-key"];
    if (!providedKey || providedKey !== configuredKey) {
      return res.status(401).json({ error: "Invalid or missing API key" });
    }

    const parsed = cadIngestPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid CAD payload", details: parsed.error.flatten() });
    }

    const payload = parsed.data;
    const normalizedSource = payload.source.trim().toLowerCase();
    const normalizedExternalId = payload.externalIncidentId.trim();

    // --- Correlation: Two-tier strategy ---
    // Primary match: cadExternalId + subAccountId + cadSource (normalized)
    let existing = await storage.getSentinelIncidentByCadId(
      payload.subAccountId,
      normalizedExternalId,
      normalizedSource
    );

    if (existing) {
      // Update existing incident with merge semantics
      const mergeData = buildCadMergeUpdate(existing, payload);
      const updated = await storage.updateSentinelIncident(existing.id, mergeData);
      return res.json({ action: "updated", incidentId: existing.id, incident: updated });
    }

    // Secondary match (safety fallback): subAccountId + cadSource + detectedAt within ±5 min + lat/lng ~0.01 degree
    // Only used when no primary match found. Should rarely trigger given externalIncidentId is required.
    if (payload.location?.lat !== undefined && payload.location?.lng !== undefined && payload.timestamps?.received) {
      const receivedTime = new Date(payload.timestamps.received);
      const fiveMinMs = 5 * 60 * 1000;
      const candidates = await storage.getSentinelIncidentsFiltered(payload.subAccountId, {
        since: new Date(receivedTime.getTime() - fiveMinMs),
      });
      const matches = candidates.filter(inc => {
        if (inc.cadSource !== normalizedSource) return false;
        const incTime = inc.detectedAt ? new Date(inc.detectedAt).getTime() : 0;
        if (Math.abs(incTime - receivedTime.getTime()) > fiveMinMs) return false;
        if (inc.lat === null || inc.lng === null) return false;
        if (Math.abs(inc.lat - payload.location!.lat!) > 0.01) return false;
        if (Math.abs(inc.lng - payload.location!.lng!) > 0.01) return false;
        return true;
      });

      if (matches.length === 1) {
        const mergeData = buildCadMergeUpdate(matches[0], payload);
        const updated = await storage.updateSentinelIncident(matches[0].id, mergeData);
        return res.json({ action: "updated", incidentId: matches[0].id, incident: updated });
      }
      // If ambiguous (multiple matches), fall through to create new
    }

    // No match found — create new incident
    const newIncident = await storage.createSentinelIncident({
      subAccountId: payload.subAccountId,
      title: payload.dispatchedAs || `CAD Incident ${payload.externalIncidentId}`,
      description: payload.callNotes || null,
      location: payload.location?.address || null,
      severity: payload.severity || "medium",
      rawPayload: null,
      actionStatus: payload.status || "pending",
      smsSent: false,
      geofenceDeployed: false,
      lat: payload.location?.lat ?? null,
      lng: payload.location?.lng ?? null,
      dispatchedAs: payload.dispatchedAs || null,
      callNotes: payload.callNotes || null,
      unitsAssigned: payload.unitsAssigned || null,
      responseTimeline: payload.responseTimeline || null,
      cadSource: normalizedSource,
      cadExternalId: normalizedExternalId,
      cadLastUpdatedAt: new Date(),
    });

    return res.status(201).json({ action: "created", incidentId: newIncident.id, incident: newIncident });
  }));
}

export function determineSeverity(description: string, keywords: string[]): string {
  const upper = description.toUpperCase();
  if (upper.includes("FATALITY") || upper.includes("ENTRAPMENT") || upper.includes("EXTRICATION")) return "critical";
  if (upper.includes("ROLLOVER") || upper.includes("INJURIES")) return "high";
  if (upper.includes("MVA") || upper.includes("SIGNAL 4")) return "medium";
  return "low";
}
