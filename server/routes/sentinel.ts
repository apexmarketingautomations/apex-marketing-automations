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
import { emitWithTimeline, EVENT_TYPES } from "../intelligence/eventEmitter";

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

    // SECURITY: verify the caller owns this subAccountId before mutating config
    if (!(await verifyAccountOwnership(req, res, parsed.data.subAccountId))) return;

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

    const since    = req.query.since
      ? new Date(req.query.since as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const page     = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(Math.max(1, parseInt(req.query.pageSize as string) || 100), 500);
    const offset   = (page - 1) * pageSize;

    const all      = await storage.getSentinelIncidentsFiltered(subAccountId, { since, limit: 10000 });
    const total    = all.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const incidents  = all.slice(offset, offset + pageSize);

    res.json({
      incidents,
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    });
  }));

  app.post("/api/sentinel/scan", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      subAccountId: z.number().int().positive(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    // SECURITY: verify the caller owns this subAccountId before triggering a scan
    if (!(await verifyAccountOwnership(req, res, parsed.data.subAccountId))) return;

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
      let scrapeError: string | null = null;
      try {
        signals = await fetchHomeSvcSignals(targetStates);
      } catch (err: any) {
        console.error('[SENTINEL HOME SVC] fetchHomeSvcSignals threw unexpectedly:', err?.message);
        signals = [];
        scrapeError = err?.message || 'Unknown scrape error';
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

        if (delivery.actionStatus === "auto_queued") autoQueuedCount++;

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

        emitWithTimeline(
          { eventType: EVENT_TYPES.SENTINEL_ALERT, sourceModule: "sentinel", sourceTable: "sentinel_incidents", sourceRecordId: String(record.id), subAccountId: parsed.data.subAccountId, metadata: { title: sig.event, severity: sig.severity, location: sig.areaDesc, niche: "home_services", signalType: sig.signalType, opportunityScore: scoring.opportunityScore } },
          "Home Services Signal Detected",
          `${sig.severity?.toUpperCase()} ${sig.signalType ?? sig.event} at ${sig.areaDesc}`,
          sig.severity === "critical" ? "critical" : sig.severity === "high" ? "high" : "info"
        );

        import("../operator/apexIntelligence").then(({ reportOutcome }) =>
          reportOutcome({
            agentName:    "sentinel",
            action:       "incident_detected",
            subject:      sig.signalType ?? sig.event ?? "signal",
            result:       `${sig.severity} incident detected: ${sig.event}`,
            confidence:   sig.severity === "critical" ? 0.95 : sig.severity === "high" ? 0.8 : 0.65,
            subAccountId: parsed.data.subAccountId,
            niche:        "home_services",
            metadata:     { incidentId: record.id, severity: sig.severity, location: sig.areaDesc },
          })
        ).catch((err) => console.warn("[SENTINEL] promise rejected:", err instanceof Error ? err.message : err));
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
        signalsScanned: signals.length,
        scrapeError,
        scrapeStatus: scrapeError ? "error" : (signals.length === 0 ? "no_signals" : "ok"),
        message: scrapeError
          ? `Scrape failed: ${scrapeError}. No new incidents — this is NOT the same as "all clear".`
          : signals.length === 0
            ? `Scrape ran successfully but found 0 weather signals in the configured states.`
            : `Scrape found ${signals.length} signal(s); ${created.length} new incident(s) created.`,
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
          // Propagate territory classification so it isn't lost in the DB insert below
          _operatorPriority: inc.operatorPriority,
          _priorityScore:    inc.priorityScore,
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

        import("../operator/apexIntelligence").then(({ reportOutcome }) =>
          reportOutcome({
            agentName:    "sentinel",
            action:       "incident_detected",
            subject:      "vehicle_crash",
            result:       `${inc.severity || "medium"} incident detected: ${inc.title}`,
            confidence:   inc.severity === "critical" ? 0.95 : inc.severity === "high" ? 0.8 : 0.65,
            subAccountId: parsed.data.subAccountId,
            niche:        "accident",
            metadata:     { incidentId: record.id, severity: inc.severity, location: inc.location },
          })
        ).catch((err) => console.warn("[SENTINEL] promise rejected:", err instanceof Error ? err.message : err));

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

    for (const record of created) {
      emitWithTimeline(
        { eventType: EVENT_TYPES.SENTINEL_ALERT, sourceModule: "sentinel", sourceTable: "sentinel_incidents", sourceRecordId: String(record.id), subAccountId: parsed.data.subAccountId, metadata: { title: record.title, severity: record.severity, location: record.location, source } },
        "Sentinel Incident Detected",
        `${record.severity?.toUpperCase()} incident detected at ${record.location}`,
        record.severity === "critical" ? "critical" : record.severity === "high" ? "high" : "info"
      );
    }

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

    import("../operator/apexIntelligence").then(({ reportOutcome }) =>
      reportOutcome({
        agentName:    "sentinel",
        action:       "incident_created",
        subject:      "manual_entry",
        result:       `Manual incident created: ${incident.title}`,
        confidence:   0.7,
        subAccountId: parsed.data.subAccountId,
        metadata:     { incidentId: incident.id },
      })
    ).catch((err) => console.warn("[SENTINEL] promise rejected:", err instanceof Error ? err.message : err));

    emitWithTimeline({ eventType: EVENT_TYPES.SENTINEL_ALERT, sourceModule: "sentinel", sourceTable: "sentinel_incidents", sourceRecordId: String(incident.id), subAccountId: parsed.data.subAccountId, metadata: { title: incident.title, severity: incident.severity } });

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

    emitWithTimeline(
      { eventType: EVENT_TYPES.SENTINEL_DISPATCHED, sourceModule: "sentinel", sourceTable: "sentinel_incidents", sourceRecordId: String(id), subAccountId: incident.subAccountId, metadata: { incidentId: id, location: incident.location, radiusMiles: radius, adSetId: geoResult.adSetId || null, targetType: geoTarget.type } },
      "Geofence Ads Deployed",
      `Geofence deployed to ${radius}-mile radius of ${incident.location}`,
      "high"
    );

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

    {
      const { sendSms: sendSmsIncident } = await import("../messaging/sendSms");
      const incidentResult = await sendSmsIncident({
        subAccountId: incident.subAccountId,
        to: account.ownerPhone,
        body: alertMsg,
        from: account.twilioNumber,
        source: "sentinel-incident-sms",
        path: "hot-lead",
        metadata: { incidentId: id, severity: incident.severity, isHomeSvc: isHomeSvcIncident },
      });
      if (!incidentResult.ok) {
        const httpStatus = incidentResult.reason === "no_client" || incidentResult.reason === "no_from_number" ? 503 : 502;
        return res.status(httpStatus).json({
          error: "SMS delivery failed",
          reason: incidentResult.reason,
          detail: incidentResult.errorMessage,
          twilio_status: incidentResult.errorStatus ?? null,
          twilio_code: incidentResult.errorCode ?? null,
        });
      }
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

    emitWithTimeline(
      { eventType: EVENT_TYPES.SENTINEL_ALERT, sourceModule: "sentinel", sourceTable: "sentinel_incidents", sourceRecordId: String(id), subAccountId: incident.subAccountId, metadata: { incidentId: id, smsSentTo: account.ownerPhone, title: incident.title, severity: incident.severity, isHomeSvc: isHomeSvcIncident } },
      "Sentinel SMS Alert Sent",
      `SMS alert dispatched for ${incident.severity?.toUpperCase()} incident at ${incident.location}`,
      "high"
    );

    res.json({ success: true, message: `SMS alert sent to ${account.ownerPhone}` });
  }));

  app.post("/api/sentinel/incidents/:id/acknowledge", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = parseIntParam(req.params.id, "id");
    const incident = await storage.getSentinelIncident(id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    // SECURITY: verify the caller owns the account this incident belongs to
    if (!(await verifyAccountOwnership(req, res, incident.subAccountId))) return;

    await storage.updateSentinelIncident(id, { actionStatus: "acknowledged" });
    res.json({ success: true });
  }));

  app.post("/api/sentinel/incidents/:id/flag-lead", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = parseIntParam(req.params.id, "id");
    const incident = await storage.getSentinelIncident(id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    // SECURITY: verify the caller owns the account this incident belongs to
    if (!(await verifyAccountOwnership(req, res, incident.subAccountId))) return;

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

    import("../operator/apexIntelligence").then(({ reportOutcome }) =>
      reportOutcome({
        agentName:    "sentinel",
        action:       "incident_detected",
        subject:      "cad_dispatch",
        result:       `CAD incident created: ${newIncident.title}`,
        confidence:   0.85,
        subAccountId: payload.subAccountId,
        niche:        "accident",
        metadata:     { incidentId: newIncident.id, cadSource: normalizedSource, location: payload.location?.address },
      })
    ).catch((err) => console.warn("[SENTINEL] promise rejected:", err instanceof Error ? err.message : err));

    emitWithTimeline(
      { eventType: EVENT_TYPES.SENTINEL_ALERT, sourceModule: "sentinel", sourceTable: "sentinel_incidents", sourceRecordId: String(newIncident.id), subAccountId: payload.subAccountId, metadata: { incidentId: newIncident.id, cadSource: normalizedSource, externalId: normalizedExternalId, location: payload.location?.address, severity: newIncident.severity, action: "cad_created" } },
      "CAD Incident Ingested",
      `CAD dispatch from ${normalizedSource}: ${newIncident.title} at ${payload.location?.address || "unknown location"}`,
      "high"
    );

    return res.status(201).json({ action: "created", incidentId: newIncident.id, incident: newIncident });
  }));

  // ── Attorney Leads API ──────────────────────────────────────────────────────

  app.get("/api/legal/attorneys", asyncHandler(async (req, res) => {
    const { db } = await import("../db");
    const { legalAttorneys } = await import("@shared/schema");
    const { desc, sql, ilike } = await import("drizzle-orm");

    const vertical = req.query.vertical as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

    let attorneys;
    if (vertical && vertical !== "all") {
      attorneys = await db.select().from(legalAttorneys)
        .where(sql`${legalAttorneys.legalVerticals}::jsonb @> ${JSON.stringify([vertical])}::jsonb`)
        .orderBy(desc(legalAttorneys.score))
        .limit(limit);
    } else {
      attorneys = await db.select().from(legalAttorneys)
        .orderBy(desc(legalAttorneys.score))
        .limit(limit);
    }

    res.json({ attorneys, total: attorneys.length });
  }));

  app.post("/api/legal/attorneys/scrape", asyncHandler(async (req, res) => {
    const { runFullAttorneyScrape } = await import("../apifyAttorneyScraper");
    // Fire and forget — scrape runs in background
    runFullAttorneyScrape().catch(err =>
      console.error("[APIFY] Manual scrape failed:", err.message)
    );
    res.json({ success: true, message: "Attorney scrape started in background — check logs for progress" });
  }));

  // ── Admin: Backfill misclassified leads ──────────────────────────────────────

  app.post("/api/admin/backfill-lead-classification", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user || (user.isAdmin !== "true" && user.role !== "admin")) {
      return res.status(403).json({ error: "Admin only" });
    }

    const { db } = await import("../db");
    const { contacts } = await import("@shared/schema");
    const { sql, eq } = await import("drizzle-orm");

    let scanned = 0, corrected = 0, skipped = 0;
    const corrections: Record<string, number> = {};

    // Fetch contacts with source=legal_pipeline that have home_service or local_service tags
    const misclassified = await db.select().from(contacts)
      .where(eq(contacts.source, "legal_pipeline"))
      .limit(5000);

    for (const contact of misclassified) {
      scanned++;
      const tags = contact.tags || [];

      let newSource: string | null = null;
      let newChannel: string | null = null;
      let newTags: string[] | null = null;

      if (tags.includes("home_service")) {
        newSource = "home_service_pipeline";
        newChannel = "home_service";
        newTags = tags.filter(t => t !== "legal-lead");
        corrections["home_service"] = (corrections["home_service"] || 0) + 1;
      } else if (tags.includes("local_service") || tags.includes("business_growth_signal")) {
        newSource = "local_service_pipeline";
        newChannel = "local_service";
        newTags = tags.filter(t => t !== "legal-lead");
        corrections["local_service"] = (corrections["local_service"] || 0) + 1;
      }

      if (newSource) {
        await db.update(contacts)
          .set({ source: newSource, channel: newChannel, tags: newTags })
          .where(eq(contacts.id, contact.id));
        corrected++;
      } else {
        skipped++;
      }
    }

    console.log(`[LEAD-CLASSIFIER] Backfill: scanned=${scanned} corrected=${corrected} skipped=${skipped}`, corrections);
    res.json({ scanned, corrected, skipped, corrections });
  }));

}

export function determineSeverity(description: string, keywords: string[]): string {
  const upper = description.toUpperCase();
  if (upper.includes("FATALITY") || upper.includes("ENTRAPMENT") || upper.includes("EXTRICATION")) return "critical";
  if (upper.includes("ROLLOVER") || upper.includes("INJURIES")) return "high";
  if (upper.includes("MVA") || upper.includes("SIGNAL 4")) return "medium";
  return "low";
}

// Retroactive skip trace — enriches existing crash leads with real names + phones
export function registerRetroSkipTraceRoute(app: any) {
  // POST /api/admin/manual-skip-trace — single-subject skip trace from admin console
  app.post("/api/admin/manual-skip-trace", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const userId: string | undefined = user?.claims?.sub || user?.id;
    let adminOk = false;
    if (userId) {
      const adminId = (process.env.ADMIN_USER_ID || "").trim();
      if (adminId && userId === adminId) {
        adminOk = true;
      } else {
        const { authStorage } = await import("../replit_integrations/auth/storage");
        const dbUser = await authStorage.getUser(userId);
        adminOk = dbUser?.isAdmin === "true";
      }
    }
    if (!adminOk) return res.status(403).json({ error: "admin only" });

    const { address, city, state, zip, ownerName } = req.body ?? {};
    if (!address) return res.status(400).json({ error: "address is required" });

    const { resolveBatchDataKey } = await import("../vendorConfig");
    const apiKey = resolveBatchDataKey();
    if (!apiKey) return res.status(503).json({ error: "BATCHDATA_API_KEY not configured in Railway env vars" });

    const { skipTraceLookup } = await import("../skip-trace");
    const result = await skipTraceLookup({ address, city, state, zip, ownerName }, apiKey);

    res.json({
      ok: true,
      ownerName:          result.ownerName,
      ownerPhone:         result.ownerPhone,
      ownerEmail:         result.ownerEmail,
      mailingAddress:     result.mailingAddress,
      additionalPhones:   result.additionalPhones,
      additionalEmails:   result.additionalEmails,
      totalPersonsFound:  result.totalPersonsFound,
      allPersons:         result.allPersons,
    });
  }));

  app.post("/api/sentinel/retro-skip-trace", async (req: any, res: any) => {
    try {
      // Admin-only: check session user OR legacy x-admin-secret header
      const user = req.user as any;
      const headerOk = req.headers["x-admin-secret"] === (process.env.STANDALONE_ADMIN_SECRET || "201120062017");
      let sessionAdmin = false;
      if (user) {
        const userId: string = user.claims?.sub || user.id;
        const adminId = (process.env.ADMIN_USER_ID || "").trim();
        if (adminId && userId === adminId) {
          sessionAdmin = true;
        } else {
          const { authStorage } = await import("../replit_integrations/auth/storage");
          const dbUser = await authStorage.getUser(userId);
          sessionAdmin = dbUser?.isAdmin === "true";
        }
      }
      if (!sessionAdmin && !headerOk) return res.status(401).json({ error: "Admin access required" });

      const { subAccountId } = req.body;
      const { runRetroSkipTrace, runRetroSkipTraceAllAccounts } = await import("../retroSkipTrace");

      // Run async — don't block the response
      if (subAccountId) {
        runRetroSkipTrace(Number(subAccountId)).catch(console.error);
        res.json({ ok: true, message: `Retroactive skip trace started for account ${subAccountId}. Check server logs for progress.` });
      } else {
        runRetroSkipTraceAllAccounts().catch(console.error);
        res.json({ ok: true, message: "Retroactive skip trace started for all accounts. Check server logs for progress." });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Retro FLHSMV Enrichment ──────────────────────────────────────────────────
  // POST /api/internal/retro-flhsmv-enrich
  // Fire-and-forget: triggers retroactive FLHSMV enrichment for contacts that
  // still have placeholder names. Skips already-enriched contacts (credit-safe).

  app.post("/api/internal/retro-flhsmv-enrich", async (req: any, res: any) => {
    try {
      const adminSecret = (process.env.STANDALONE_ADMIN_SECRET || "201120062017").trim();
      const headerVal   = ((req.headers["x-admin-secret"] as string) || "").trim();
      if (headerVal !== adminSecret) return res.status(401).json({ error: "Unauthorized" });

      const limit  = Math.min(Number(req.body?.limit ?? 500), 2000);
      const dryRun = req.body?.dryRun === true;

      const { runRetroFLHSMVEnrich } = await import("../retroFLHSMVEnrich");
      // Fire-and-forget — the job can run for minutes; caller polls logs
      runRetroFLHSMVEnrich({ limit, dryRun }).catch((err: any) =>
        console.error("[RETRO-FLHSMV] Unhandled error in background job:", err?.message)
      );

      res.json({ ok: true, message: `Retro FLHSMV enrichment started (limit=${limit} dryRun=${dryRun}). Check server logs for progress.` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Pipeline Health ───────────────────────────────────────────────────────────
  // GET /api/internal/pipeline-health
  // Admin-secret gated. Returns current status of all pipeline subsystems.

  app.get("/api/internal/pipeline-health", async (req: any, res: any) => {
    try {
      const adminSecret = (process.env.STANDALONE_ADMIN_SECRET || "201120062017").trim();
      const headerVal   = ((req.headers["x-admin-secret"] as string) || "").trim();
      if (headerVal !== adminSecret) return res.status(401).json({ error: "Unauthorized" });

      const { db }           = await import("../db");
      const { crashReports, contacts } = await import("@shared/schema");
      const { count, eq, and, isNotNull, lt } = await import("drizzle-orm");
      const { getFLHSMVHealth } = await import("../crashReportWorker");
      const { getVendorRunState, resolveBatchDataKey, resolveScrapingBeeKey, resolveNimbleCredentials } = await import("../vendorConfig");

      // Crash report queue depth by status
      const [pending, processing, complete, notFound, failed] = await Promise.all([
        db.select({ n: count() }).from(crashReports).where(eq(crashReports.status, "PENDING")),
        db.select({ n: count() }).from(crashReports).where(eq(crashReports.status, "PROCESSING")),
        db.select({ n: count() }).from(crashReports).where(eq(crashReports.status, "COMPLETE")),
        db.select({ n: count() }).from(crashReports).where(eq(crashReports.status, "NOT_FOUND")),
        db.select({ n: count() }).from(crashReports).where(eq(crashReports.status, "FAILED")),
      ]);

      // FLHSMV enrichment counts
      const [completeWithOfficial, alreadyEnriched] = await Promise.all([
        db.select({ n: count() }).from(crashReports).where(
          and(eq(crashReports.status, "COMPLETE"), isNotNull(crashReports.officialReportNumber))
        ),
        // Contacts tagged flhsmv-enriched (approximate count via SQL array contains)
        db.execute(
          (await import("drizzle-orm")).sql`SELECT COUNT(*) AS n FROM contacts WHERE 'flhsmv-enriched' = ANY(tags)`
        ),
      ]);

      // Stuck reports: PROCESSING > 2h
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const [stuckProcessing] = await db.select({ n: count() }).from(crashReports).where(
        and(eq(crashReports.status, "PROCESSING"), lt(crashReports.updatedAt, twoHoursAgo))
      );

      const flhsmvHealth = getFLHSMVHealth();
      const vendorState  = getVendorRunState();

      res.json({
        timestamp: new Date().toISOString(),
        vendors: {
          batchData:   { configured: !!resolveBatchDataKey(), lastRun: vendorState.batchData },
          scrapingBee: { configured: !!resolveScrapingBeeKey() },
          nimble:      { configured: !!resolveNimbleCredentials() },
        },
        flhsmv: {
          ...flhsmvHealth,
        },
        crashQueue: {
          pending:     pending[0]?.n ?? 0,
          processing:  processing[0]?.n ?? 0,
          complete:    complete[0]?.n ?? 0,
          notFound:    notFound[0]?.n ?? 0,
          failed:      failed[0]?.n ?? 0,
          stuckProcessing: stuckProcessing?.n ?? 0,
        },
        enrichment: {
          completeWithOfficialReport: completeWithOfficial[0]?.n ?? 0,
          contactsTaggedFlhsmvEnriched: Number((alreadyEnriched.rows?.[0] as any)?.n ?? 0),
        },
      });
    } catch (err: any) {
      console.error("[PIPELINE-HEALTH] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Legal Signals API ────────────────────────────────────────────────────────

  app.get("/api/sentinel/legal-signals", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.query.subAccountId as string, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const category  = (req.query.category as string) || "all";
    const page      = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize  = Math.min(Math.max(1, parseInt(req.query.pageSize as string) || 50), 200);
    const offset    = (page - 1) * pageSize;

    const { db } = await import("../db");
    const { legalSignals } = await import("@shared/schema");
    const { desc, inArray, count, eq, and } = await import("drizzle-orm");

    const CATEGORY_SIGNALS: Record<string, string[]> = {
      criminal:        ["dui_arrest", "arrest", "jail_booking"],
      family:          ["divorce_filing", "domestic_violence_injunction", "custody_modification", "probate_filing"],
      traffic:         ["license_suspension", "traffic_violation"],
      personal_injury: ["osha_incident", "fda_recall", "cpsc_recall"],
      workers_comp:    ["osha_incident"],
      all:             [],
    };

    const ALL_LEGAL_TYPES = [
      "dui_arrest", "arrest", "jail_booking",
      "divorce_filing", "domestic_violence_injunction", "custody_modification", "probate_filing",
      "osha_incident", "fda_recall", "cpsc_recall",
      "license_suspension", "traffic_violation",
    ];

    const filterTypes = (CATEGORY_SIGNALS[category] || []).length > 0
      ? CATEGORY_SIGNALS[category]
      : ALL_LEGAL_TYPES;

    // SECURITY: always scope legal signals to the verified subAccountId
    const [{ total }] = await db.select({ total: count() }).from(legalSignals)
      .where(and(
        eq(legalSignals.subAccountId, subAccountId),
        inArray(legalSignals.signalType, filterTypes as any)
      ));

    const signals = await db.select().from(legalSignals)
      .where(and(
        eq(legalSignals.subAccountId, subAccountId),
        inArray(legalSignals.signalType, filterTypes as any)
      ))
      .orderBy(desc(legalSignals.detectedAt))
      .limit(pageSize)
      .offset(offset);

    const totalPages = Math.max(1, Math.ceil(Number(total) / pageSize));
    console.log(`[LEGAL-SIGNALS] category=${category} page=${page}/${totalPages} returned=${signals.length} total=${total}`);
    return res.json({
      signals,
      page,
      pageSize,
      total: Number(total),
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    });
  }));

  // ── Distribution Rules API ────────────────────────────────────────────────────

  app.get("/api/sentinel/distribution-rules", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.query.subAccountId as string, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { db } = await import("../db");
    const { homeServiceContractors, homeServiceLeads } = await import("@shared/schema");
    const { eq, count } = await import("drizzle-orm");

    // Return contractors as distribution rules
    const contractors = await db.select().from(homeServiceContractors)
      .where(eq(homeServiceContractors.subAccountId, subAccountId));

    const rules = contractors.map(c => ({
      id: c.id,
      name: c.businessName + " — " + c.ownerName,
      signalTypes: c.serviceCategories || [],
      targetAccountId: subAccountId,
      targetAccountName: c.businessName,
      targetPhone: c.phone,
      active: c.active,
      leadsDelivered: 0,
    }));

    res.json({ rules });
  }));

  app.post("/api/sentinel/distribution-rules", asyncHandler(async (req, res) => {
    const { subAccountId, name, signalTypes, targetPhone, targetAccountName } = req.body;
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { db } = await import("../db");
    const { homeServiceContractors } = await import("@shared/schema");

    const [created] = await db.insert(homeServiceContractors).values({
      subAccountId,
      businessName: targetAccountName || name,
      ownerName: name,
      phone: targetPhone,
      email: null,
      serviceCategories: signalTypes,
      counties: ["LEE", "COLLIER", "CHARLOTTE", "SARASOTA", "MANATEE"],
      tier: "pay_per_lead",
      active: true,
      score: 50,
    }).returning();

    res.json({ success: true, rule: created });
  }));

  app.patch("/api/sentinel/distribution-rules/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const { active } = req.body;

    const { db } = await import("../db");
    const { homeServiceContractors } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    // SECURITY: fetch the record first to get its subAccountId, then verify ownership
    const [existing] = await db.select().from(homeServiceContractors)
      .where(eq(homeServiceContractors.id, id))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Distribution rule not found" });
    if (!(await verifyAccountOwnership(req, res, existing.subAccountId))) return;

    const [updated] = await db.update(homeServiceContractors)
      .set({ active })
      .where(eq(homeServiceContractors.id, id))
      .returning();

    res.json({ success: true, rule: updated });
  }));

  // POST /api/sentinel/enrich-legal-signals — retroactively enrich legal signals missing phones
  app.post("/api/sentinel/enrich-legal-signals", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user || (user.isAdmin !== "true" && user.role !== "DEV_ADMIN")) {
      return res.status(403).json({ error: "admin only" });
    }

    const { db } = await import("../db");
    const { legalSignals } = await import("@shared/schema");
    const { isNull, not, eq, inArray } = await import("drizzle-orm");

    // Find qualified signals without phones (company-based signals only)
    const missing = await db.select().from(legalSignals)
      .where(
        isNull(legalSignals.subjectPhone)
      )
      .limit(200);

    const company_types = ["osha_incident", "fda_recall", "cpsc_recall", "business_growth_signal"];
    const toEnrich = missing.filter(s =>
      company_types.includes(s.signalType) && s.subjectName && s.county
    );

    let enriched = 0;
    let { findBusinessPhone } = {} as any;
    try {
      ({ findBusinessPhone } = await import("../legalSignalPipeline"));
    } catch { // allow-silent-catch: dynamic import may fail if module isn't exported yet
    }

    if (typeof findBusinessPhone === "function") {
      for (const sig of toEnrich) {
        try {
          const phone = await findBusinessPhone(sig.subjectName!, sig.county!);
          if (phone) {
            await db.update(legalSignals)
              .set({ subjectPhone: phone })
              .where(eq(legalSignals.id, sig.id));
            enriched++;
          }
        } catch { /* allow-silent-catch: per-signal errors must not abort the batch */ }
      }
    }

    res.json({ ok: true, checked: toEnrich.length, enriched });
  }));

  // ── GET /api/sentinel/pipeline-status ────────────────────────────────────────
  // Returns live status of all FL lead pipelines — useful for the Sentinel UI
  // status panel and for debugging why leads aren't appearing.

  app.get("/api/sentinel/pipeline-status", asyncHandler(async (_req, res) => {
    const nimbleConfigured         = !!(process.env.NIMBLE_API_KEY || process.env.NIMBLE_TOKEN);
    const apifyConfigured          = !!(process.env.APIFY_API_KEY || process.env.APIFY_TOKEN || process.env.APIFY_KEY);
    const batchDataConfigured      = !!(process.env.BATCHDATA_API_KEY || process.env.BATCH_DATA || process.env.BATCHDATA_KEY);
    const googleMapsConfigured     = !!process.env.GOOGLE_MAPS_API_KEY;
    const courtListenerConfigured  = !!process.env.COURTLISTENER_API_TOKEN; // optional — free tier works without it

    let arrestStats: any = null;
    try {
      const { getArrestIngestStats, isArrestIngestConfigured } = await import("../arrestIngestPipeline");
      arrestStats = {
        configured: isArrestIngestConfigured(),
        lastRun:    getArrestIngestStats(),
      };
    // allow-silent-catch: arrest ingest stats are optional — missing module is non-fatal
    } catch { /* non-fatal */ }

    let courtListenerStats: any = null;
    try {
      const { getCourtListenerPipelineStats } = await import("../courtListenerPipeline");
      courtListenerStats = getCourtListenerPipelineStats();
    // allow-silent-catch: optional pipeline stats — missing module is non-fatal
    } catch { /* non-fatal */ }

    let hillsboroughStats: any = null;
    try {
      const { getHillsboroughRecordsPipelineStats } = await import("../hillsboroughRecordsPipeline");
      hillsboroughStats = getHillsboroughRecordsPipelineStats();
    // allow-silent-catch: optional pipeline stats — missing module is non-fatal
    } catch { /* non-fatal */ }

    let hillsboroughFilingsStats: any = null;
    try {
      const { getHillsboroughFilingsPipelineStats } = await import("../hillsboroughCourtFilingsPipeline");
      hillsboroughFilingsStats = getHillsboroughFilingsPipelineStats();
    // allow-silent-catch: optional pipeline stats — missing module is non-fatal
    } catch { /* non-fatal */ }

    const { pool } = await import("../db");

    // Recent signal counts (last 24h) per pipeline source
    const { rows: signalCounts } = await pool.query<{ signal_type: string; cnt: string }>(
      `SELECT signal_type, COUNT(*) as cnt
         FROM legal_signals
        WHERE detected_at > NOW() - INTERVAL '24 hours'
        GROUP BY signal_type
        ORDER BY cnt DESC`,
    );

    const { rows: courtFilingCounts } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM legal_signals
        WHERE signal_type IN ('divorce_filing','custody_modification','domestic_violence_injunction','probate_filing')
          AND detected_at > NOW() - INTERVAL '24 hours'`,
    );

    const { rows: unenrichedRows } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM legal_signals
        WHERE subject_phone IS NULL
          AND signal_type IN ('arrest','dui_arrest','jail_booking','license_suspension')
          AND detected_at > NOW() - INTERVAL '7 days'`,
    );

    const { rows: bankruptcyCounts } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM legal_signals
        WHERE signal_type = 'bankruptcy_filing'
          AND detected_at > NOW() - INTERVAL '24 hours'`,
    );

    const { rows: hillsboroughCounts } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM legal_signals
        WHERE signal_type IN ('lis_pendens','civil_judgment')
          AND county = 'HILLSBOROUGH'
          AND detected_at > NOW() - INTERVAL '24 hours'`,
    );

    const { rows: familyLawCounts } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM legal_signals
        WHERE signal_type IN ('divorce_filing','custody_modification','domestic_violence_injunction')
          AND detected_at > NOW() - INTERVAL '24 hours'`,
    );

    const { rows: probateCounts } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM legal_signals
        WHERE signal_type = 'probate_filing'
          AND detected_at > NOW() - INTERVAL '24 hours'`,
    );

    res.json({
      credentials: {
        nimble:        nimbleConfigured,
        apify:         apifyConfigured,
        batchData:     batchDataConfigured,
        googleMaps:    googleMapsConfigured,
        courtListener: courtListenerConfigured, // optional — free tier works without
      },
      pipelines: {
        jailBooking: {
          active:      nimbleConfigured,
          description: "11 FL county jail booking scrapers (Nimble browser agents)",
          intervalMin: 60,
        },
        arrestIngest: {
          active:      arrestStats?.configured ?? false,
          description: "Direct Nimble REST + Apify fallback, dedup + CRM routing",
          intervalMin: 360,
          lastRun:     arrestStats?.lastRun?.completedAt ?? null,
          lastRunStats: arrestStats?.lastRun ?? null,
        },
        courtFiling: {
          active:      nimbleConfigured,
          description: "FL county clerk portals — divorce/DV/custody/probate",
          intervalMin: 360,
        },
        bankruptcy: {
          active:            true, // always active — free tier requires no token
          description:       "CourtListener REST API — FL bankruptcy filings (flmb/flsb/flnb)",
          intervalMin:       360,
          tokenConfigured:   courtListenerConfigured,
          lastRunAt:         courtListenerStats?.lastRunAt ?? null,
          lastCycleInserted: courtListenerStats?.lastCycleInserted ?? null,
          lastCycleSkipped:  courtListenerStats?.lastCycleSkipped ?? null,
          totalInserted:     courtListenerStats?.totalInsertedEver ?? null,
        },
        hillsboroughRecords: {
          active:            true, // no credentials needed — free public bulk files
          description:       "Hillsborough County official records — lis pendens + judgments (daily CSV)",
          scheduleDesc:      "Daily at 06:00 ET",
          batchDataAvailable: hillsboroughStats?.batchDataAvailable ?? false,
          lastRunAt:         hillsboroughStats?.lastRunAt ?? null,
          lastCycleInserted: hillsboroughStats?.lastCycleInserted ?? null,
          lastCycleSkipped:  hillsboroughStats?.lastCycleSkipped ?? null,
          totalInserted:     hillsboroughStats?.totalInsertedEver ?? null,
        },
        hillsboroughCourtFilings: {
          active:            true, // no credentials needed — free public daily CSVs
          description:       "Hillsborough County daily court filings — divorce/custody/probate/foreclosure",
          scheduleDesc:      "Daily at 07:00 ET",
          batchDataAvailable: hillsboroughFilingsStats?.batchDataAvailable ?? false,
          lastRunAt:         hillsboroughFilingsStats?.lastRunAt ?? null,
          lastCycleInserted: hillsboroughFilingsStats?.lastCycleInserted ?? null,
          lastCycleSkipped:  hillsboroughFilingsStats?.lastCycleSkipped ?? null,
          totalInserted:     hillsboroughFilingsStats?.totalInsertedEver ?? null,
        },
        legalSignals: {
          active:      true,
          description: "OSHA incidents, FDA/CPSC recalls, enrichment pass",
          intervalMin: 15,
        },
        crashIngest: {
          active:      true,
          description: "FHP HSMV CAD crash scraper → PI attorney leads",
          intervalMin: 5,
        },
      },
      last24h: {
        signals:          signalCounts.reduce((a, r) => a + parseInt(r.cnt, 10), 0),
        byType:           Object.fromEntries(signalCounts.map(r => [r.signal_type, parseInt(r.cnt, 10)])),
        courtFilings:       parseInt(courtFilingCounts[0]?.cnt ?? "0", 10),
        bankruptcyLeads:    parseInt(bankruptcyCounts[0]?.cnt ?? "0", 10),
        hillsboroughLeads:  parseInt(hillsboroughCounts[0]?.cnt ?? "0", 10),
        familyLawLeads:     parseInt(familyLawCounts[0]?.cnt ?? "0", 10),
        probateLeads:       parseInt(probateCounts[0]?.cnt ?? "0", 10),
        unenrichedArrests:  parseInt(unenrichedRows[0]?.cnt ?? "0", 10),
      },
    });
  }));

  // ── GET /api/internal/ai-health ─────────────────────────────────────────────
  // Stage 5 AI Orchestration Layer health endpoint
  app.get("/api/internal/ai-health", asyncHandler(async (req: any, res: any) => {
    const adminSecret = (process.env.STANDALONE_ADMIN_SECRET || "201120062017").trim();
    const headerVal   = (req.headers["x-admin-secret"] as string | undefined ?? "").trim();
    if (headerVal !== adminSecret) return res.status(401).json({ error: "Unauthorized" });

    const { getAllProviderHealth, getBudgetReport, getProcessMetrics } = await import("../ai/index");
    const providerHealth = getAllProviderHealth();
    const budgetReport   = getBudgetReport();
    const processMetrics = getProcessMetrics();

    return res.json({
      timestamp:   new Date().toISOString(),
      providers:   providerHealth,
      budget:      budgetReport,
      metrics:     processMetrics,
    });
  }));
}
