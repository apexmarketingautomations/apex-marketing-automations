import type { Express, Request, Response } from "express";
import { insertSentinelIncidentSchema, messages } from "@shared/schema";
import { storage } from "../storage";
import { z } from "zod";
import { processLiveSentinelFeed, deployGeofenceAd } from "../sentinel";
import { asyncHandler, parseIntParam, verifyAccountOwnership, requirePlanFeature } from "./helpers";

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
          subAccountId: parsed.data.subAccountId,
          sourceHash: hash,
          title: inc.title,
          description: inc.description,
          location: inc.location,
          severity: inc.severity || "medium",
          rawPayload: inc.rawPayload || null,
          actionStatus: "pending",
          smsSent: false,
          geofenceDeployed: false,
        });
        created.push(record);
      }
    }

    await storage.createAuditLog({
      action: "SENTINEL_SCAN",
      performedBy: user?.claims?.sub || user?.id || "system",
      details: { subAccountId: parsed.data.subAccountId, source, found: created.length },
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

    const config = await storage.getSentinelConfig(incident.subAccountId);
    if (config && config.geofenceEnabled === false) {
      return res.status(400).json({ error: "Geofence ads are disabled in Sentinel config." });
    }
    const radius = config?.geofenceRadiusMiles || 1;

    console.log(`📡 APEX SENTINEL: Deploying Geofence to ${incident.location}...`);
    console.log(`📡 Target radius: ${radius} mile(s) — Severity: ${incident.severity?.toUpperCase()}`);

    const rawPayload = incident.rawPayload as any;

    const metaConnection = await storage.getIntegrationConnection(incident.subAccountId, "meta-ads");
    const metaCreds = metaConnection?.status === "connected" && metaConnection.config
      ? { accessToken: (metaConnection.config as any).accessToken, adAccountId: (metaConnection.config as any).adAccountId }
      : undefined;

    const geoResult = await deployGeofenceAd({
      id: incident.id,
      location: incident.location || "",
      lat: rawPayload?.lat || null,
      lng: rawPayload?.lng || null,
      title: incident.title || undefined,
    }, radius, metaCreds);

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

    const alertMsg = `🚨 APEX SENTINEL ALERT\n\n${incident.severity?.toUpperCase()} PRIORITY: ${incident.title}\n📍 ${incident.location}\n\n${incident.description}\n\nDeploy geofence ads now from your Sentinel dashboard.`;

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;

    if (!twilioSid || !twilioToken) {
      return res.status(503).json({ error: "Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to send SMS alerts." });
    }
    if (!account.twilioNumber) {
      return res.status(400).json({ error: "No Twilio phone number assigned to this account. Add one in account settings." });
    }

    try {
      const twilioClient = Twilio(twilioSid, twilioToken);
      await twilioClient.messages.create({
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
    }));
    res.json(liveFormat);
  }));
}

export function determineSeverity(description: string, keywords: string[]): string {
  const upper = description.toUpperCase();
  if (upper.includes("FATALITY") || upper.includes("ENTRAPMENT") || upper.includes("EXTRICATION")) return "critical";
  if (upper.includes("ROLLOVER") || upper.includes("INJURIES")) return "high";
  if (upper.includes("MVA") || upper.includes("SIGNAL 4")) return "medium";
  return "low";
}
