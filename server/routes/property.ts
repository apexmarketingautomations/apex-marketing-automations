import type { Express, Request, Response } from "express";
import { insertContactSchema, insertPipelineStageSchema, insertDealSchema, insertAppointmentSchema, insertEmailCampaignSchema, insertWebhookSchema, insertWhiteLabelSettingsSchema, contacts, deals, appointments, webhooks, messages, subAccounts, sentinelIncidents, sentinelConfig, hasFeature } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { z } from "zod";
import { aiChat, isAIConfigured } from "../aiGateway";
import { processLiveSentinelFeed, deployGeofenceAd } from "../sentinel";
import { publishEventAsync, EVENT_TYPES } from "../eventBus";
import { emitUniversalEvent, EVENT_TYPES as INTEL_EVENT_TYPES } from "../intelligence/eventEmitter";
import {
  emitPropertyLeadCreated,
  emitPropertyLeadUpdated,
  emitSkipTraceCompleted,
} from "../intelligence/apexLearningFeed";
import { scanDistressedProperties, calculateDealMetrics } from "../property-radar";
import { skipTraceLookup, getCurrentMonthYear } from "../skip-trace";
import crypto from "crypto";
import { dispatchAlert, generateDeepLink } from "../pushAlertService";
import { asyncHandler, parseIntParam, getUserId, verifyAccountOwnership, logUsageInternal } from "./helpers";
import { recordOutboundBilling } from "../billing";
import { requireActiveSubscription } from "../subscriptionGuard";

const subscriptionGuard = requireActiveSubscription();

export function registerPropertyRoutes(app: Express) {
  // ---- Property Radar (Wholesaler) Routes ----

  app.get("/api/property-radar/status", asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      hasRentcastKey: !!process.env.RENTCAST_API_KEY,
      hasTwilioSid: !!process.env.TWILIO_ACCOUNT_SID,
      hasTwilioToken: !!process.env.TWILIO_AUTH_TOKEN,
      hasSkipTraceKey: !!process.env.BATCHDATA_API_KEY,
    });
  }));

  app.get("/api/property-radar/config/:subAccountId", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const config = await storage.getWholesalerConfig(subAccountId);
    res.json(config || { subAccountId, targetZips: [], targetCities: [], distressFilters: [], minEquity: 30000, autoSms: false, autoCall: false, autoAds: false, enabled: true });
  }));

  app.put("/api/property-radar/config/:subAccountId", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const configSchema = z.object({
      companyName: z.string().optional(),
      targetAreas: z.array(z.string()).optional(),
      skipTraceEnabled: z.boolean().optional(),
      autoSmsEnabled: z.boolean().optional(),
      smsTemplate: z.string().optional(),
    });
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid config data", details: parsed.error.flatten() });
    const config = await storage.upsertWholesalerConfig({ ...parsed.data, subAccountId });
    res.json(config);
  }));

  app.get("/api/property-radar/leads/:subAccountId", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const leads = await storage.getPropertyLeads(subAccountId);
    const leadsWithMetrics = leads.map(lead => ({
      ...lead,
      dealMetrics: calculateDealMetrics(lead.estimatedValue || 0, lead.estimatedEquity || 0),
    }));
    res.json(leadsWithMetrics);
  }));

  app.post("/api/property-radar/scan", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      subAccountId: z.number().int().positive(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const config = await storage.getWholesalerConfig(parsed.data.subAccountId);
    const { properties, source } = await scanDistressedProperties(
      config?.targetZips || [],
      config?.distressFilters || [],
      config?.minEquity || 30000,
    );

    console.log(`🏠 PROPERTY RADAR: Scanned ${properties.length} distressed properties (${source})`);

    const created = [];
    for (const prop of properties) {
      const hash = Buffer.from(`${prop.id}-${prop.address}`).toString("base64").substring(0, 64);
      const existing = await storage.getPropertyLeadByHash(parsed.data.subAccountId, hash);
      if (!existing) {
        let leadLat = prop.lat;
        let leadLng = prop.lng;
        if ((leadLat == null || leadLng == null) && prop.address) {
          const fullAddress = [prop.address, prop.city, prop.state, prop.zip].filter(Boolean).join(", ");
          const geo = await geocodeAddress(fullAddress);
          if (geo) {
            leadLat = geo.lat;
            leadLng = geo.lng;
          }
        }
        const record = await storage.createPropertyLead({
          subAccountId: parsed.data.subAccountId,
          address: prop.address,
          city: prop.city,
          state: prop.state,
          zip: prop.zip,
          ownerName: prop.ownerName,
          ownerPhone: prop.ownerPhone,
          propertyType: prop.propertyType,
          estimatedValue: prop.estimatedValue,
          estimatedEquity: prop.estimatedEquity,
          distressSignals: prop.distressSignals,
          sourceHash: hash,
          pipelineStage: "new",
          priority: prop.priority,
          lat: leadLat,
          lng: leadLng,
        });
        emitPropertyLeadCreated(parsed.data.subAccountId, record.id, record.address || "unknown");
        created.push({
          ...record,
          dealMetrics: calculateDealMetrics(record.estimatedValue || 0, record.estimatedEquity || 0),
        });
      }
    }

    await storage.createAuditLog({
      action: "PROPERTY_RADAR_SCAN",
      performedBy: user?.claims?.sub || user?.id || "system",
      details: { subAccountId: parsed.data.subAccountId, source, found: created.length },
    });

    res.json({ source, found: created.length, leads: created });
  }));

  app.patch("/api/property-radar/leads/:id", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const id = parseIntParam(req.params.id, "id");
    const leadUpdateSchema = z.object({
      status: z.string().optional(),
      notes: z.string().optional(),
      assignedTo: z.string().optional(),
      estimatedValue: z.number().optional(),
      estimatedEquity: z.number().optional(),
    });
    const parsed = leadUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid lead data", details: parsed.error.flatten() });
    const lead = await storage.updatePropertyLead(id, parsed.data);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    emitPropertyLeadUpdated(lead.subAccountId, id, Object.keys(parsed.data).join(","));
    res.json({ ...lead, dealMetrics: calculateDealMetrics(lead.estimatedValue || 0, lead.estimatedEquity || 0) });
  }));

  app.post("/api/property-radar/leads/:id/sms", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = parseIntParam(req.params.id, "id");
    const lead = await storage.getPropertyLead(id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!lead.ownerPhone) return res.status(400).json({ error: "No phone number available for this property owner." });

    const account = await storage.getSubAccount(lead.subAccountId);
    const smsBody = `Hi ${lead.ownerName}, I noticed your property at ${lead.address}. I'm a local investor and would love to make you a fair cash offer. Would you be open to a quick chat? Reply STOP to opt out.`;

    if (!account?.twilioNumber) {
      return res.status(422).json({ error: "No Twilio phone number assigned to this account. Purchase a number first." });
    }

    const { sendSms } = await import("../messaging/sendSms");
    const sendResult = await sendSms({
      subAccountId: lead.subAccountId,
      to: lead.ownerPhone,
      body: smsBody,
      from: account.twilioNumber,
      source: "property-radar-sms",
      path: "sms",
      metadata: { property_lead_id: id },
    });
    if (!sendResult.ok) {
      await storage.updatePropertyLead(id, { smsSent: false, lastContactedAt: new Date() });
      const httpStatus = sendResult.reason === "no_client" ? 503 : 422;
      return res.status(httpStatus).json({
        error: `SMS failed (${sendResult.reason}): ${sendResult.errorMessage}`,
        twilio_status: sendResult.errorStatus,
        twilio_code: sendResult.errorCode,
      });
    }

    await storage.updatePropertyLead(id, { smsSent: true, lastContactedAt: new Date() });
    console.log(`[PROPERTY RADAR] SMS sent to ${lead.ownerName} for ${lead.address}`);

    res.json({ success: true, message: `SMS sent to ${lead.ownerName}` });
  }));

  app.post("/api/property-radar/leads/:id/deploy-ads", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = parseIntParam(req.params.id, "id");
    const lead = await storage.getPropertyLead(id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const geoResult = await deployGeofenceAd({
      id: lead.id,
      location: lead.address || "",
      lat: lead.lat,
      lng: lead.lng,
      title: `Wholesaler - ${lead.address}`,
    }, 1);

    await storage.updatePropertyLead(id, { adDeployed: true });
    console.log(`🏠 PROPERTY RADAR: Geofence ads deployed around ${lead.address}`);

    res.json({
      success: true,
      message: `Geofence ads deployed around ${lead.address}`,
      metaAdsStatus: geoResult.status,
      targeting: { center: lead.address, lat: lead.lat, lng: lead.lng },
    });
  }));

  // ---- Skip Trace Routes ----

  app.get("/api/skip-trace/status", asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    res.json({ hasSkipTraceKey: !!process.env.BATCHDATA_API_KEY });
  }));

  app.get("/api/skip-trace/usage/:subAccountId", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const monthYear = getCurrentMonthYear();
    const usage = await storage.getSkipTraceUsage(subAccountId, monthYear);
    res.json({ monthYear, lookupCount: usage?.lookupCount || 0 });
  }));

  app.get("/api/skip-trace/results/:subAccountId", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const results = await storage.getSkipTraceResults(subAccountId);
    res.json(results);
  }));

  app.post("/api/skip-trace/lookup", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      subAccountId: z.number().int().positive(),
      propertyLeadId: z.number().int().positive(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, propertyLeadId } = parsed.data;
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const lead = await storage.getPropertyLead(propertyLeadId);
    if (!lead) return res.status(404).json({ error: "Property lead not found" });
    if (lead.subAccountId !== subAccountId) return res.status(403).json({ error: "Access denied" });

    const existing = await storage.getSkipTraceResultByLeadId(propertyLeadId);
    if (existing && existing.subAccountId === subAccountId) {
      return res.json({ result: existing, cached: true });
    }

    let apiKey = process.env.BATCHDATA_API_KEY || process.env.BATCH_DATA;
    if (!apiKey) {
      const conn = await storage.getIntegrationConnection(subAccountId, "skip-trace");
      apiKey = (conn?.config as any)?.apiKey;
    }
    if (!apiKey) {
      return res.status(422).json({ error: "No skip trace API key configured. Add your BatchData API key in Integrations Hub or set BATCHDATA_API_KEY." });
    }

    const result = await skipTraceLookup({
      address: lead.address,
      city: lead.city || undefined,
      state: lead.state || undefined,
      zip: lead.zip || undefined,
      ownerName: lead.ownerName || undefined,
    }, apiKey);

    const saved = await storage.createSkipTraceResult({
      subAccountId,
      propertyLeadId,
      address: lead.address,
      ownerName: result.ownerName,
      ownerPhone: result.ownerPhone,
      ownerEmail: result.ownerEmail,
      mailingAddress: result.mailingAddress,
      additionalPhones: result.additionalPhones,
      additionalEmails: result.additionalEmails,
      provider: "batchdata",
      rawResponse: result.raw,
    });

    if (result.ownerName || result.ownerPhone || result.ownerEmail) {
      await storage.updatePropertyLead(propertyLeadId, {
        ownerName: result.ownerName || lead.ownerName,
        ownerPhone: result.ownerPhone || lead.ownerPhone,
        ownerEmail: result.ownerEmail || lead.ownerEmail,
      });
    }

    const phonesFound = [result.ownerPhone, ...(result.additionalPhones || [])].filter(Boolean).length;
    emitSkipTraceCompleted(subAccountId, propertyLeadId, saved.id, phonesFound);

    await storage.incrementSkipTraceUsage(subAccountId, getCurrentMonthYear());

    await logUsageInternal(subAccountId, "SKIP_TRACE", 1, `Skip trace for ${lead.address}`);

    res.json({ result: saved, cached: false });
  }));

  app.post("/api/skip-trace/bulk", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      subAccountId: z.number().int().positive(),
      propertyLeadIds: z.array(z.number().int().positive()).min(1).max(50),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, propertyLeadIds } = parsed.data;
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    let apiKey = process.env.BATCHDATA_API_KEY || process.env.BATCH_DATA;
    if (!apiKey) {
      const conn = await storage.getIntegrationConnection(subAccountId, "skip-trace");
      apiKey = (conn?.config as any)?.apiKey;
    }
    if (!apiKey) {
      return res.status(422).json({ error: "No skip trace API key configured." });
    }

    const results: any[] = [];
    const errors: any[] = [];

    for (const leadId of propertyLeadIds) {
      try {
        const lead = await storage.getPropertyLead(leadId);
        if (!lead || lead.subAccountId !== subAccountId) { errors.push({ leadId, error: "Not found or access denied" }); continue; }

        const existing = await storage.getSkipTraceResultByLeadId(leadId);
        if (existing && existing.subAccountId === subAccountId) { results.push({ result: existing, cached: true, leadId }); continue; }

        const result = await skipTraceLookup({
          address: lead.address,
          city: lead.city || undefined,
          state: lead.state || undefined,
          zip: lead.zip || undefined,
          ownerName: lead.ownerName || undefined,
        }, apiKey);

        const saved = await storage.createSkipTraceResult({
          subAccountId,
          propertyLeadId: leadId,
          address: lead.address,
          ownerName: result.ownerName,
          ownerPhone: result.ownerPhone,
          ownerEmail: result.ownerEmail,
          mailingAddress: result.mailingAddress,
          additionalPhones: result.additionalPhones,
          additionalEmails: result.additionalEmails,
          provider: "batchdata",
          rawResponse: result.raw,
        });

        if (result.ownerName || result.ownerPhone || result.ownerEmail) {
          await storage.updatePropertyLead(leadId, {
            ownerName: result.ownerName || lead.ownerName,
            ownerPhone: result.ownerPhone || lead.ownerPhone,
            ownerEmail: result.ownerEmail || lead.ownerEmail,
          });
        }

        await storage.incrementSkipTraceUsage(subAccountId, getCurrentMonthYear());
        results.push({ result: saved, cached: false, leadId });
      } catch (err: any) {
        errors.push({ leadId, error: err.message });
      }
    }

    await logUsageInternal(subAccountId, "SKIP_TRACE", results.filter(r => !r.cached).length, `Bulk skip trace: ${results.length} lookups`);

    res.json({ results, errors, total: propertyLeadIds.length, completed: results.length, failed: errors.length });
  }));

  app.post("/api/skip-trace/save-contact", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      subAccountId: z.number().int().positive(),
      skipTraceResultId: z.number().int().positive(),
      triggerOutreach: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, skipTraceResultId, triggerOutreach } = parsed.data;
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const results = await storage.getSkipTraceResults(subAccountId);
    const skipResult = results.find(r => r.id === skipTraceResultId);
    if (!skipResult) return res.status(404).json({ error: "Skip trace result not found" });

    if (skipResult.savedAsContactId) {
      const existingContact = await storage.getContactById(skipResult.savedAsContactId);
      if (existingContact) {
        return res.json({ contact: existingContact, alreadySaved: true });
      }
    }

    const nameParts = (skipResult.ownerName || "Property Owner").split(" ");
    const firstName = nameParts[0] || "Property";
    const lastName = nameParts.slice(1).join(" ") || "Owner";

    const contact = await storage.createContact({
      subAccountId,
      firstName,
      lastName,
      phone: skipResult.ownerPhone || null,
      email: skipResult.ownerEmail || null,
      source: "skip_trace",
      tags: ["skip-trace", "property-lead"],
      address: skipResult.address || null,
      notes: skipResult.mailingAddress ? `Mailing: ${skipResult.mailingAddress}` : null,
    });

    await storage.updateSkipTraceResult(skipResult.id, { savedAsContactId: contact.id });

    if (skipResult.propertyLeadId) {
      await storage.updatePropertyLead(skipResult.propertyLeadId, {
        ownerName: skipResult.ownerName || undefined,
        ownerPhone: skipResult.ownerPhone || undefined,
        ownerEmail: skipResult.ownerEmail || undefined,
      });
    }

    res.json({ contact, alreadySaved: false });
  }));

  app.post("/api/sentinel/test-trigger", asyncHandler(async (req, res) => {
    // No auth required — demo endpoint for live meeting triggers
    const testSchema = z.object({ subAccountId: z.number().optional() }).passthrough();
    const parsed = testSchema.safeParse(req.body);
    const subAccountId = parsed.success ? (parsed.data.subAccountId || 1) : 1;

    const mockAccident = {
      title: "[DEMO] MVA — Entrapment (High Value)",
      description: "SIMULATED — Multi-vehicle accident with entrapment. Fire rescue and extrication units dispatched. Multiple injuries reported. High-value personal injury case detected.",
      location: "Intersection of Flamingo & Las Vegas Blvd",
      severity: "critical",
    };

    const hashInput = `demo-trigger-${mockAccident.title}-${mockAccident.location}`;
    const hash = Buffer.from(hashInput).toString("base64").substring(0, 64);

    const existing = await storage.getSentinelIncidentByHash(subAccountId, hash);
    if (existing) {
      await storage.updateSentinelIncident(existing.id, {
        actionStatus: "pending",
        geofenceDeployed: false,
        smsSent: false,
      });
      return res.json({
        ...existing,
        actionStatus: "pending",
        geofenceDeployed: false,
        smsSent: false,
        status: "Deploying Geofence Ads...",
        time: new Date().toLocaleTimeString(),
        demo: true,
        simulated: true,
      });
    }

    const record = await storage.createSentinelIncident({
      subAccountId,
      sourceHash: hash,
      title: mockAccident.title,
      description: mockAccident.description,
      location: mockAccident.location,
      severity: mockAccident.severity,
      rawPayload: null,
      actionStatus: "pending",
      smsSent: false,
      geofenceDeployed: false,
    });

    res.json({
      ...record,
      status: "Deploying Geofence Ads...",
      time: new Date().toLocaleTimeString(),
      demo: true,
      simulated: true,
    });
  }));

  // ─── Sentinel Geofence Engine — Incoming Crash Feed ────────────────
  const sentinelAlertDedup = new Map<string, number>();
  setInterval(() => { const cutoff = Date.now() - 300_000; sentinelAlertDedup.forEach((t, k) => { if (t < cutoff) sentinelAlertDedup.delete(k); }); }, 60_000);

  app.post("/api/sentinel/incoming-crash", asyncHandler(async (req, res) => {
    const geolib = await import("geolib");
    const axiosLib = await import("axios");

    const CLIENT_HQ = {
      latitude: parseFloat(process.env.CLIENT_LAT || "0"),
      longitude: parseFloat(process.env.CLIENT_LON || "0"),
    };
    const GEOFENCE_RADIUS = parseInt(process.env.RADIUS_METERS || "16093");
    const APEX_WEBHOOK_URL = process.env.APEX_WEBHOOK_URL;

    const crashSchema = z.object({
      crashId: z.string().optional(),
      latitude: z.union([z.string(), z.number()]),
      longitude: z.union([z.string(), z.number()]),
      severity: z.string().optional(),
      timestamp: z.string().optional(),
    }).passthrough();
    const parsed = crashSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid crash data", details: parsed.error.flatten() });
    const { crashId, latitude, longitude, severity, timestamp } = parsed.data;

    if (!latitude || !longitude) {
      console.error("SENTINEL: Incoming data missing coordinates.");
      return res.status(400).json({ error: "Missing coordinates" });
    }

    const crashLocation = {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
    };
    console.log(`SENTINEL: New Crash Detected [ID: ${crashId}]. Calculating trajectory...`);

    const isInsideZone = geolib.isPointWithinRadius(
      crashLocation,
      CLIENT_HQ,
      GEOFENCE_RADIUS
    );

    const distanceInMeters = geolib.getDistance(crashLocation, CLIENT_HQ);
    const distanceInMiles = (distanceInMeters / 1609.34).toFixed(2);

    if (!isInsideZone) {
      console.log(`SENTINEL: Crash is ${distanceInMiles} miles away. Outside client territory.`);
      return res.status(200).json({ status: "ignored", reason: "outside_geofence" });
    }

    console.log(`SENTINEL: Target acquired — crash is ${distanceInMiles} miles away. Inside geofence. Firing...`);

    const subAccountId = parseInt(req.body.subAccountId || "1");
    const hashInput = `crash-${crashId}-${latitude}-${longitude}`;
    const hash = Buffer.from(hashInput).toString("base64").substring(0, 64);

    const existing = await storage.getSentinelIncidentByHash(subAccountId, hash);
    if (existing) {
      return res.status(200).json({ status: "duplicate", incidentId: existing.id });
    }

    const record = await storage.createSentinelIncident({
      subAccountId,
      sourceHash: hash,
      title: `MVA — Crash ${crashId}`,
      description: `Vehicle crash detected ${distanceInMiles} miles from HQ. Severity: ${severity || "unknown"}.`,
      location: `${latitude}, ${longitude}`,
      severity: severity || "moderate",
      rawPayload: JSON.stringify(req.body),
      actionStatus: "pending",
      smsSent: false,
      geofenceDeployed: false,
    });

    await storage.createNotification({
      subAccountId,
      type: "incident",
      title: "Sentinel: Crash Detected Inside Geofence",
      body: `Crash ${crashId} detected ${distanceInMiles} mi away. Severity: ${severity || "unknown"}.`,
      link: "/sentinel",
      read: false,
    });
    const alertKey = `sentinel-${crashId}`;
    if (!sentinelAlertDedup.has(alertKey)) {
      sentinelAlertDedup.set(alertKey, Date.now());
      dispatchAlert(subAccountId, "incident", {
        title: "Sentinel: Crash Detected",
        body: `Crash ${crashId} detected ${distanceInMiles} mi away. Severity: ${severity || "unknown"}.`,
        link: generateDeepLink("/sentinel"),
        tag: `incident-${crashId}`,
        urgency: "high",
      }).catch(e => console.error("[PUSH-ALERT] sentinel crash dispatch failed:", e instanceof Error ? e.message : e));
    }

    if (APEX_WEBHOOK_URL) {
      try {
        const apexPayload = {
          contact: {
            first_name: "Sentinel",
            last_name: "Alert",
            email: `crash-${crashId}@sentinel.local`,
          },
          customData: {
            crash_id: crashId,
            distance_miles: distanceInMiles,
            severity: severity,
            google_maps_link: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
            timestamp: timestamp,
          },
        };
        await axiosLib.default.post(APEX_WEBHOOK_URL, apexPayload, {
          headers: { "Content-Type": "application/json" },
        });
        console.log("SENTINEL: Lead injected into Apex webhook. Workflow triggered.");
      } catch (webhookErr: any) {
        console.error("SENTINEL: Apex webhook failed:", webhookErr.message);
      }
    }

    res.status(200).json({
      status: "success",
      incidentId: record.id,
      distance_miles: distanceInMiles,
      message: "Crash logged and fired to Apex",
    });
  }));

  // ─── Sentinel Incoming — Apex Catch Endpoint ────────────────────────
  app.post("/api/sentinel-incoming", asyncHandler(async (req, res) => {
    const incomingSchema = z.object({
      customData: z.record(z.unknown()).optional(),
      crash_id: z.string().optional(),
      crashId: z.string().optional(),
      distance_miles: z.union([z.string(), z.number()]).optional(),
      severity: z.string().optional(),
      google_maps_link: z.string().optional(),
    }).passthrough();
    const parsed = incomingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid sentinel data", details: parsed.error.flatten() });
    const data = parsed.data;
    console.log("APEX RECEIVED CRASH DATA:", JSON.stringify(data));

    const customData = data.customData || data;
    const crashId = customData.crash_id || customData.crashId || "unknown";
    const distanceMiles = customData.distance_miles || "unknown";
    const severity = customData.severity || "unknown";
    const mapsLink = customData.google_maps_link || "";

    {
      const sentinelConf = await storage.getSentinelConfig(1);
      const alertPhone = sentinelConf?.smsAlertPhone;
      if (alertPhone) {
        const { sendSms: sendSmsSentinel } = await import("../messaging/sendSms");
        const account = await storage.getSubAccount(1);
        const sentinelResult = await sendSmsSentinel({
          subAccountId: 1,
          to: alertPhone,
          body: `SENTINEL ALERT: Crash #${crashId} detected ${distanceMiles} mi from HQ. Severity: ${severity}. Map: ${mapsLink}`,
          from: account?.twilioNumber || undefined,
          source: "sentinel-crash-alert",
          path: "hot-lead",
          metadata: { crashId, severity, distanceMiles },
        });
        if (sentinelResult.ok) {
          console.log(`SENTINEL: SMS alert sent to ${alertPhone} sid=${sentinelResult.twilioSid}`);
        } else {
          console.error(`SENTINEL: SMS alert failed reason=${sentinelResult.reason} err=${sentinelResult.errorMessage}`);
        }
      }
    }

    res.status(200).json({ message: "Apex received the crash data" });
  }));

  // ─── Sentinel Receiver v1 — External Crash Data Intake ────────────
  app.post("/api/v1/sentinel-receiver", asyncHandler(async (req, res) => {
    const receiverSchema = z.object({
      crash_id: z.string().optional(),
      crashId: z.string().optional(),
      latitude: z.union([z.string(), z.number()]).optional(),
      lat: z.union([z.string(), z.number()]).optional(),
      longitude: z.union([z.string(), z.number()]).optional(),
      lng: z.union([z.string(), z.number()]).optional(),
      lon: z.union([z.string(), z.number()]).optional(),
      severity: z.string().optional(),
      distance_miles: z.union([z.string(), z.number()]).optional(),
      subAccountId: z.number().optional(),
    }).passthrough();
    const parsed = receiverSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid crash data", details: parsed.error.flatten() });
    const crashData = parsed.data;
    console.log("APEX RECEIVED CRASH DATA:", JSON.stringify(crashData));

    const subAccountId = crashData.subAccountId || 13;
    const crashId = crashData.crash_id || crashData.crashId || `auto-${Date.now()}`;
    const lat = crashData.latitude || crashData.lat;
    const lng = crashData.longitude || crashData.lng || crashData.lon;
    const severity = crashData.severity || "unknown";
    const distanceMiles = crashData.distance_miles || "unknown";
    const mapsLink = crashData.google_maps_link || (lat && lng ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : "");

    const hashInput = `crash-${crashId}-${lat}-${lng}`;
    const hash = Buffer.from(hashInput).toString("base64").substring(0, 64);

    const existing = await storage.getSentinelIncidentByHash(subAccountId, hash);
    if (!existing) {
      await storage.createSentinelIncident({
        subAccountId,
        sourceHash: hash,
        title: `MVA — Crash ${crashId}`,
        description: `Vehicle crash detected. Distance: ${distanceMiles} mi. Severity: ${severity}.`,
        location: lat && lng ? `${lat}, ${lng}` : "Unknown",
        severity,
        rawPayload: JSON.stringify(crashData),
        actionStatus: "pending",
        smsSent: false,
        geofenceDeployed: false,
      });

      await storage.createNotification({
        subAccountId,
        type: "incident",
        title: "Sentinel: New Crash Received",
        body: `Crash ${crashId} — ${distanceMiles} mi away. Severity: ${severity}.`,
        link: "/sentinel",
        read: false,
      });
      const alertKey2 = `sentinel-recv-${crashId}`;
      if (!sentinelAlertDedup.has(alertKey2)) {
        sentinelAlertDedup.set(alertKey2, Date.now());
        dispatchAlert(subAccountId, "incident", {
          title: "Sentinel: Crash Received",
          body: `Crash ${crashId} — ${distanceMiles} mi away. Severity: ${severity}.`,
          link: generateDeepLink("/sentinel"),
          tag: `incident-${crashId}`,
          urgency: "high",
        }).catch(e => console.error("[PUSH-ALERT] sentinel recv dispatch failed:", e instanceof Error ? e.message : e));
      }
    }

    {
      const sentinelConf = await storage.getSentinelConfig(subAccountId);
      const alertPhone = sentinelConf?.smsAlertPhone;
      if (alertPhone) {
        const { sendSms: sendSmsSentinelV1 } = await import("../messaging/sendSms");
        const acctForPhone = await storage.getSubAccount(subAccountId);
        const sentinelV1Result = await sendSmsSentinelV1({
          subAccountId,
          to: alertPhone,
          body: `SENTINEL ALERT: Crash #${crashId} detected ${distanceMiles} mi from HQ. Severity: ${severity}. Map: ${mapsLink}`,
          from: acctForPhone?.twilioNumber || undefined,
          source: "sentinel-crash-alert",
          path: "hot-lead",
          metadata: { crashId, severity, distanceMiles },
        });
        if (sentinelV1Result.ok) {
          console.log(`SENTINEL: SMS alert sent to ${alertPhone} sid=${sentinelV1Result.twilioSid}`);
        } else {
          console.error(`SENTINEL: SMS alert failed reason=${sentinelV1Result.reason} err=${sentinelV1Result.errorMessage}`);
        }
      }
    }

    res.status(200).send("Message Received");
  }));

  // ─── Sentinel Geofence Ingest — MAID Identity Resolution & CRM Push ───
  app.post("/api/v1/sentinel-ingest", asyncHandler(async (req, res) => {
    const { maid, location_tag, timestamp, subAccountId: reqAccountId } = req.body;

    if (!maid) {
      return res.status(400).json({ error: "Missing required field: maid" });
    }

    const locationTag = location_tag || "Unknown Intersection";
    const eventTimestamp = timestamp || new Date().toISOString();
    const SUB_ACCOUNT_ID = reqAccountId ? parseInt(reqAccountId) : 13;

    console.log(`SENTINEL INGEST: MAID ${maid} detected at ${locationTag} (${eventTimestamp}) → account ${SUB_ACCOUNT_ID}`);

    res.status(200).json({ status: "Active", message: "Geofence payload secured. Resolving identity." });

    const identityApiKey = process.env.IDENTITY_API_KEY;
    const identityApiUrl = process.env.IDENTITY_API_URL;
    const apexCrmUrl = process.env.APEX_CRM_URL;
    const apexApiKey = process.env.APEX_API_KEY;

    let firstName = "Unknown";
    let lastName = "";
    let phoneNumber: string | null = null;
    let email: string | null = null;
    let resolved = false;

    const ingestPhone = typeof req.body.phone === "string" ? req.body.phone.trim() : null;
    const ingestEmail = typeof req.body.email === "string" ? req.body.email.trim() : null;
    const ingestName = typeof req.body.name === "string" ? req.body.name.trim() : null;

    if (identityApiUrl && identityApiKey) {
      try {
        console.log(`SENTINEL INGEST: Initiating AdTech Identity Strike for MAID ${maid}`);

        const brokerPayload = {
          device_id: maid,
          match_requirements: ["phone_number", "first_name"],
        };

        const brokerRes = await fetch(identityApiUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${identityApiKey}`,
            "Content-Type": "application/json",
            "X-Client-ID": "Apex_OS_God_Mode",
          },
          body: JSON.stringify(brokerPayload),
        });

        if (brokerRes.ok) {
          const identityData = await brokerRes.json() as any;
          const matchStatus = identityData?.status;

          if (matchStatus === "success") {
            const personData = identityData?.person || {};
            phoneNumber = personData.primary_phone || null;
            firstName = personData.first_name || "Driver";
            lastName = personData.last_name || "";
            email = personData.email || null;

            if (phoneNumber) {
              console.log(`SENTINEL INGEST: AdTech HIT — ${firstName} ${lastName}, phone: ${phoneNumber}, email: ${email || "none"}`);
              resolved = true;
            } else {
              console.log(`SENTINEL INGEST: AdTech match found but no phone number. Dropping to fallback.`);
            }
          } else {
            console.log(`SENTINEL INGEST: AdTech Graph returned no match for MAID ${maid}. Status: ${matchStatus}`);
          }
        } else {
          const errText = await brokerRes.text();
          console.warn(`SENTINEL INGEST: AdTech Broker returned ${brokerRes.status}: ${errText.substring(0, 300)}`);
        }
      } catch (err: any) {
        console.error(`SENTINEL INGEST: AdTech Broker API Strike Failed — ${err.message}`);
      }
    }

    if (!resolved && identityApiKey && (ingestPhone || ingestEmail || ingestName)) {
      try {
        const params = new URLSearchParams({ pretty: "true" });
        if (ingestPhone) params.append("phone", ingestPhone);
        if (ingestEmail) params.append("email", ingestEmail);
        if (ingestName) {
          const nameParts = ingestName.split(" ");
          params.append("first_name", nameParts[0]);
          if (nameParts.length > 1) params.append("last_name", nameParts.slice(1).join(" "));
        }

        console.log(`SENTINEL INGEST: Fallback — enriching via People Data Labs`);

        const pdlUrl = `https://api.peopledatalabs.com/v5/person/enrich?${params.toString()}`;
        const pdlRes = await fetch(pdlUrl, {
          method: "GET",
          headers: { "X-Api-Key": identityApiKey, "Accept": "application/json" },
        });

        if (pdlRes.ok) {
          const pdlData = await pdlRes.json() as any;
          if (pdlData?.status === 200 && pdlData?.data) {
            const person = pdlData.data;
            firstName = person.first_name || ingestName?.split(" ")[0] || "Unknown";
            lastName = person.last_name || "";
            phoneNumber = person.mobile_phone || (person.phone_numbers && person.phone_numbers[0]) || ingestPhone || null;
            email = person.work_email || (person.personal_emails && person.personal_emails[0]) || ingestEmail || null;
            console.log(`SENTINEL INGEST: PDL enriched — ${firstName} ${lastName}, phone: ${phoneNumber || "none"}, email: ${email || "none"}`);
            resolved = true;
          }
        }

        if (!resolved) {
          firstName = ingestName?.split(" ")[0] || "Unknown";
          lastName = ingestName?.split(" ").slice(1).join(" ") || "";
          phoneNumber = ingestPhone;
          email = ingestEmail;
          console.log(`SENTINEL INGEST: PDL no match — using raw data: ${firstName}, phone: ${phoneNumber || "none"}`);
        }
      } catch (err: any) {
        phoneNumber = ingestPhone;
        email = ingestEmail;
        console.error(`SENTINEL INGEST: PDL fallback failed — ${err.message} — using raw data`);
      }
    } else if (!resolved && (ingestPhone || ingestEmail || ingestName)) {
      firstName = ingestName?.split(" ")[0] || "Unknown";
      lastName = ingestName?.split(" ").slice(1).join(" ") || "";
      phoneNumber = ingestPhone;
      email = ingestEmail;
      console.log(`SENTINEL INGEST: No broker configured — using raw data: ${firstName}, phone: ${phoneNumber || "none"}`);
    } else if (!resolved) {
      console.log(`SENTINEL INGEST: MAID-only payload, no broker configured — stored as raw lead`);
    }

    try {
      const contact = await storage.createContact({
        subAccountId: SUB_ACCOUNT_ID,
        firstName: firstName,
        lastName: lastName || null,
        phone: phoneNumber || null,
        email: email || null,
        source: `Sentinel Intercept: ${locationTag}`,
        tags: ["Crash_Connect_Lead", "Sentinel_Geofence", locationTag],
        notes: `MAID: ${maid} | Location: ${locationTag} | Time: ${eventTimestamp}`,
      });
      console.log(`SENTINEL INGEST: Contact created in CRM — ID ${contact.id}, name: ${firstName} ${lastName}`);

      import("./v1").then(({ fireAutomationTriggerGlobal }) => {
        fireAutomationTriggerGlobal("new_lead", SUB_ACCOUNT_ID, {
          leadName: `${firstName} ${lastName}`.trim(),
          leadPhone: phoneNumber,
          leadEmail: email,
          source: "sentinel_geofence",
          location: locationTag,
        });
        fireAutomationTriggerGlobal("crash_detected", SUB_ACCOUNT_ID, {
          leadName: `${firstName} ${lastName}`.trim(),
          leadPhone: phoneNumber,
          location: locationTag,
        });
      }).catch(e => console.error("[SENTINEL-INGEST] trigger failed:", e instanceof Error ? e.message : e));

      publishEventAsync(EVENT_TYPES.CRASH_DETECTED, "sentinel-ingest", {
        subAccountId: SUB_ACCOUNT_ID, contactId: contact.id, maid,
        name: `${firstName} ${lastName}`.trim(), phone: phoneNumber, location: locationTag,
      });
      publishEventAsync(EVENT_TYPES.CONTACT_CREATED, "sentinel-ingest", {
        subAccountId: SUB_ACCOUNT_ID, contactId: contact.id, name: `${firstName} ${lastName}`.trim(),
        phone: phoneNumber, email, source: "sentinel_geofence",
      });

      await storage.createNotification({
        subAccountId: SUB_ACCOUNT_ID,
        type: "lead",
        title: "Sentinel: New Geofence Lead",
        body: `${firstName} ${lastName} intercepted at ${locationTag}. ${phoneNumber ? `Phone: ${phoneNumber}` : "MAID: " + maid}`,
        link: "/pipeline",
        read: false,
      });
      dispatchAlert(SUB_ACCOUNT_ID, "new_lead", {
        title: "Geofence Lead Captured",
        body: `${firstName} ${lastName} intercepted at ${locationTag}`,
        link: generateDeepLink("/pipeline"),
        tag: `lead-geofence-${maid}`,
      }).catch(e => console.error("[PUSH-ALERT] geofence lead dispatch failed:", e instanceof Error ? e.message : e));

      await storage.createSentinelIncident({
        subAccountId: SUB_ACCOUNT_ID,
        sourceHash: Buffer.from(`maid-${maid}-${locationTag}`).toString("base64").substring(0, 64),
        title: `Geofence Intercept — ${locationTag}`,
        description: `MAID ${maid} resolved to ${firstName} ${lastName}. ${phoneNumber ? `Phone: ${phoneNumber}` : "No phone found."}`,
        location: locationTag,
        severity: "medium",
        rawPayload: JSON.stringify({ maid, location_tag: locationTag, timestamp: eventTimestamp, resolved: { firstName, lastName, phoneNumber, email } }),
        actionStatus: "pending",
        smsSent: false,
        geofenceDeployed: true,
      });
    } catch (crmErr: any) {
      console.error(`SENTINEL INGEST: CRM push failed — ${crmErr.message}`);
    }

    if (apexCrmUrl && apexApiKey && phoneNumber) {
      try {
        console.log(`SENTINEL INGEST: Pushing to LeadConnector CRM...`);
        const apexPayload = {
          firstName,
          lastName,
          name: `${firstName} ${lastName}`.trim(),
          phone: phoneNumber,
          email: email || undefined,
          tags: ["Crash_Connect_Lead", "Sentinel_Geofence", locationTag],
          source: `Sentinel Intercept: ${locationTag}`,
        };
        const lcRes = await fetch(apexCrmUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apexApiKey}`,
            "Content-Type": "application/json",
            "Version": "2021-07-28",
          },
          body: JSON.stringify(apexPayload),
        });
        if (lcRes.ok) {
          const lcData = await lcRes.json() as any;
          console.log(`SENTINEL INGEST: LeadConnector contact created — ${lcData?.contact?.id || "OK"}`);
        } else {
          console.warn(`SENTINEL INGEST: LeadConnector returned ${lcRes.status}`);
        }
      } catch (lcErr: any) {
        console.error(`SENTINEL INGEST: LeadConnector push failed — ${lcErr.message}`);
      }
    }
  }));

  // ─── FLHSMV Health Check (extended with ingest pipeline stats) ─
  // Also returns delivery-health metrics so silent regressions in the
  // sentinel→FLHSMV→follow-up pipeline are visible the same day.
  app.get("/api/crash-reports/health", asyncHandler(async (req, res) => {
    const { getFLHSMVHealth } = await import("../crashReportWorker");
    const { getIngestStats } = await import("../crashIngestPipeline");
    const health = getFLHSMVHealth();
    const ingest = getIngestStats();

    // Optional sub-account scoping. If provided, the caller must own the
    // sub-account — the same rule the rest of the crash routes use.
    const rawScope = req.query.subAccountId;
    let scopedSubAccountId: number | undefined;
    if (typeof rawScope === "string" && rawScope.length > 0) {
      const id = Number(rawScope);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid subAccountId" });
      }
      if (!(await verifyAccountOwnership(req, res, id))) return;
      scopedSubAccountId = id;
    }

    const delivery = await storage.getCrashDeliveryStats(scopedSubAccountId);
    // Flag drops in delivery rate so the next regression is caught fast.
    const HEALTHY_RATIO_FLOOR = 0.5;
    const deliveryHealthy =
      delivery.totalIngested === 0
        ? true
        : delivery.deliveryRatio >= HEALTHY_RATIO_FLOOR;

    res.json({
      flhsmv: health,
      ingestPipeline: {
        latestPollTime: ingest.latestPollTime,
        lastSuccessfulIngest: ingest.lastSuccessfulIngest,
        lastFailureDetail: ingest.lastFailureDetail,
        lastFailureTime: ingest.lastFailureTime,
        totalCrashesDiscovered: ingest.totalCrashesDiscovered,
        totalInserted: ingest.totalInserted,
        totalLeadsCreated: ingest.totalLeadsCreated,
        consecutiveFailures: ingest.consecutiveFailures,
        totalPolls: ingest.totalPolls,
        recentCycles: ingest.recentCycles,
      },
      delivery: {
        ...delivery,
        healthy: deliveryHealthy,
        floor: HEALTHY_RATIO_FLOOR,
        scope: scopedSubAccountId ? "sub_account" : "global",
        scopedSubAccountId: scopedSubAccountId ?? null,
      },
    });
  }));

  // ─── Crash Ingest Test Harness ───────────────────────────────────
  // Auth: When AGENT_SECRET is configured, ONLY accepts x-harness-secret matching it.
  // Session auth is NOT a fallback — secret required to prevent unauthenticated DB writes.
  app.post("/api/crash-reports/test-harness", asyncHandler(async (req, res) => {
    const agentSecret = process.env.AGENT_SECRET;
    const providedSecret = req.headers["x-harness-secret"];

    if (!agentSecret) {
      return res.status(503).json({ error: "Test harness not configured: AGENT_SECRET not set" });
    }
    if (!providedSecret || providedSecret !== agentSecret) {
      return res.status(401).json({ error: "Requires x-harness-secret header matching AGENT_SECRET" });
    }

    const parsed = z.object({
      scenario: z.enum(["success", "empty", "malformed", "transient_failure", "duplicate"]).default("success"),
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { runTestHarness } = await import("../crashIngestPipeline");
    const result = await runTestHarness(parsed.data.scenario);
    res.json(result);
  }));

  // ─── Crash Report Retrieval API ─────────────────────────────────
  app.post("/api/crash-reports/request", asyncHandler(async (req, res) => {
    const { reportNumber, reason, subAccountId } = req.body;
    if (!reportNumber || typeof reportNumber !== "string") {
      return res.status(400).json({ error: "reportNumber is required" });
    }

    const user = (req as any).user;
    const userId = user ? getUserId(user) : null;
    const adminUserId = process.env.ADMIN_USER_ID;
    const derivedRole = (adminUserId && userId === adminUserId) ? "admin" : "user";

    const cleaned = reportNumber.trim().toUpperCase();
    const existing = await storage.getCrashReportByNumber(cleaned);
    if (existing) {
      if (existing.status === "NOT_FOUND" || existing.status === "FAILED") {
        await storage.updateCrashReport(existing.id, {
          status: "PENDING",
          retryCount: 0,
          serviceFailureCount: 0,
          errorLog: null,
        });
        console.log(`[CRASH-REPORT] Re-queued report ${cleaned} (id=${existing.id})`);
        return res.json({
          id: existing.id,
          reportNumber: existing.reportNumber,
          status: "PENDING",
          message: "Report re-queued for retrieval",
        });
      }
      return res.json({
        id: existing.id,
        reportNumber: existing.reportNumber,
        status: existing.status,
        message: existing.status === "COMPLETED"
          ? "Report already retrieved"
          : existing.status === "PENDING" || existing.status === "PROCESSING"
            ? "Report is being processed"
            : `Report status: ${existing.status}`,
      });
    }

    const report = await storage.createCrashReport({
      reportNumber: cleaned,
      requesterRole: derivedRole,
      reason: reason || null,
      subAccountId: subAccountId ? Number(subAccountId) : null,
      status: "PENDING",
      retryCount: 0,
    });

    console.log(`[CRASH-REPORT] Queued report ${cleaned} (id=${report.id})`);
    res.status(201).json({
      id: report.id,
      reportNumber: report.reportNumber,
      status: report.status,
      message: "Report queued for retrieval",
    });
  }));

  app.get("/api/crash-reports/status/:reportNumber", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const reportNumber = req.params.reportNumber.trim().toUpperCase();
    const report = await storage.getCrashReportByNumber(reportNumber);
    if (!report) {
      return res.status(404).json({ error: "Report not found. Submit a request first." });
    }

    if (report.subAccountId) {
      if (!(await verifyAccountOwnership(req, res, report.subAccountId))) return;
    }

    const response: Record<string, any> = {
      id: report.id,
      reportNumber: report.reportNumber,
      status: report.status,
      retryCount: report.retryCount,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };

    if (report.status === "COMPLETED" && report.data) {
      const rawData = typeof report.data === "string" ? JSON.parse(report.data as string) : report.data;
      response.data = rawData;
    }

    if (report.status === "FAILED" || report.status === "NOT_FOUND") {
      response.errorLog = report.errorLog;
    }

    res.json(response);
  }));

  app.get("/api/crash-reports", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const subAccountId = req.query.subAccountId ? Number(req.query.subAccountId) : undefined;
    if (!subAccountId) {
      return res.status(400).json({ error: "subAccountId is required" });
    }
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const reports = await storage.getCrashReports(subAccountId);
    res.json(reports.map(r => ({
      id: r.id,
      reportNumber: r.reportNumber,
      status: r.status,
      requesterRole: r.requesterRole,
      reason: r.reason,
      subAccountId: r.subAccountId,
      retryCount: r.retryCount,
      hasData: !!r.data,
      errorLog: r.errorLog,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })));
  }));

  app.get("/api/crash-reports/:id", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = Number(req.params.id);
    const report = await storage.getCrashReport(id);
    if (!report) return res.status(404).json({ error: "Report not found" });

    if (report.subAccountId) {
      if (!(await verifyAccountOwnership(req, res, report.subAccountId))) return;
    }

    const data = report.data && typeof report.data === "string"
      ? JSON.parse(report.data as string)
      : report.data;

    res.json({ ...report, data });
  }));

  // ─── Download full crash report JSON ─────────────────────────────
  // Returns the complete `data` payload (including diagram URL and any
  // field the report-detail UI does not render). Reuses the same access
  // controls as the report-detail GET — sub-account ownership + sentinel
  // plan-tier requirement. No admin bypass; no unscoped JSONB queries.
  app.get("/api/crash-reports/:id/download", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid report id" });
    }

    const report = await storage.getCrashReport(id);
    if (!report) return res.status(404).json({ error: "Report not found" });

    // Fail closed: rows without a sub-account are platform-internal (system
    // ingest, harness, legacy backfill) and must NOT be downloadable through
    // the tenant-facing endpoint. Without this, any authenticated user could
    // pull `rawPayload` from cross-tenant or system rows.
    if (!report.subAccountId) {
      return res.status(403).json({
        error: "This report is not downloadable through the tenant API",
      });
    }

    if (!(await verifyAccountOwnership(req, res, report.subAccountId))) return;

    // Plan-tier gate: crash-report data is the same feature class as
    // sentinel — only accounts on a plan that includes sentinel can
    // download the full payload.
    const account = await storage.getSubAccount(report.subAccountId);
    if (!account) return res.status(404).json({ error: "Sub-account not found" });
    if (!hasFeature(account.plan, "sentinel")) {
      return res.status(403).json({
        error: "Full report downloads require a plan with FLHSMV / Sentinel access",
      });
    }

    if (report.status !== "COMPLETED") {
      return res.status(409).json({
        error: `Report is ${report.status}; full download is only available for COMPLETED reports`,
      });
    }

    const data = report.data && typeof report.data === "string"
      ? JSON.parse(report.data as string)
      : report.data;

    const safeNumber = String(report.reportNumber ?? `report-${report.id}`)
      .replace(/[^A-Z0-9._-]/gi, "_");
    const filename = `crash-report-${safeNumber}.json`;

    const payload = {
      reportNumber: report.reportNumber,
      status: report.status,
      source: report.source,
      subAccountId: report.subAccountId,
      requesterRole: report.requesterRole,
      reason: report.reason,
      retryCount: report.retryCount,
      serviceFailureCount: report.serviceFailureCount,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      ingestTraceId: report.ingestTraceId,
      data,
      rawPayload: report.rawPayload ?? null,
    };

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(JSON.stringify(payload, null, 2));
  }));

  app.post("/api/crash-reports/:id/data", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = Number(req.params.id);
    const report = await storage.getCrashReport(id);
    if (!report) return res.status(404).json({ error: "Report not found" });

    if (report.subAccountId) {
      if (!(await verifyAccountOwnership(req, res, report.subAccountId))) return;
    }

    const rawData = req.body;
    if (!rawData || typeof rawData !== "object") {
      return res.status(400).json({ error: "Invalid data: expected JSON object" });
    }

    const normalizedData: Record<string, any> = {
      ReportNumber: rawData.ReportNumber || rawData.reportNumber || report.reportNumber,
      CrashDate: rawData.CrashDate || rawData.crashDate || rawData.date || "",
      CrashTime: rawData.CrashTime || rawData.crashTime || rawData.time || "",
      CrashCity: rawData.CrashCity || rawData.crashCity || rawData.city || "",
      CrashCounty: rawData.CrashCounty || rawData.crashCounty || rawData.county || "",
      CrashStreet: rawData.CrashStreet || rawData.crashStreet || rawData.street || "",
      IntersectingStreet: rawData.IntersectingStreet || rawData.intersectingStreet || rawData.intersection || "",
      Latitude: Number(rawData.Latitude || rawData.latitude || rawData.lat || 0),
      Longitude: Number(rawData.Longitude || rawData.longitude || rawData.lon || rawData.lng || 0),
      TotalVehicles: Number(rawData.TotalVehicles || rawData.totalVehicles || rawData.vehicles?.length || 0),
      TotalInjuries: Number(rawData.TotalInjuries || rawData.totalInjuries || rawData.injuries || 0),
      TotalFatalities: Number(rawData.TotalFatalities || rawData.totalFatalities || rawData.fatalities || 0),
      WeatherCondition: rawData.WeatherCondition || rawData.weatherCondition || rawData.weather || "",
      LightCondition: rawData.LightCondition || rawData.lightCondition || rawData.light || "",
      RoadSurfaceCondition: rawData.RoadSurfaceCondition || rawData.roadSurfaceCondition || rawData.roadSurface || "",
      Vehicles: Array.isArray(rawData.Vehicles || rawData.vehicles) 
        ? (rawData.Vehicles || rawData.vehicles).map((v: any) => ({
            VehicleNumber: Number(v.VehicleNumber || v.vehicleNumber || v.number || 0),
            Year: String(v.Year || v.year || ""),
            Make: String(v.Make || v.make || ""),
            Model: String(v.Model || v.model || ""),
            Color: String(v.Color || v.color || ""),
            TagNumber: String(v.TagNumber || v.tagNumber || v.tag || ""),
            TagState: String(v.TagState || v.tagState || v.state || ""),
            InsuranceCompany: String(v.InsuranceCompany || v.insuranceCompany || v.insurance || ""),
            Driver: {
              Name: String(v.Driver?.Name || v.driver?.name || v.Driver?.name || ""),
              Address: String(v.Driver?.Address || v.driver?.address || v.Driver?.address || ""),
              InjuryType: String(v.Driver?.InjuryType || v.driver?.injuryType || v.Driver?.injuryType || v.driver?.injury || ""),
            },
          }))
        : [],
      Passengers: Array.isArray(rawData.Passengers || rawData.passengers)
        ? (rawData.Passengers || rawData.passengers).map((p: any) => ({
            Name: String(p.Name || p.name || ""),
            VehicleNumber: Number(p.VehicleNumber || p.vehicleNumber || p.vehicle || 0),
            InjuryType: String(p.InjuryType || p.injuryType || p.injury || ""),
          }))
        : [],
      Narrative: String(rawData.Narrative || rawData.narrative || rawData.description || ""),
      DiagramUrl: rawData.DiagramUrl || rawData.diagramUrl || rawData.diagram || null,
    };

    const reportData = {
      detail: normalizedData,
      fetchedAt: new Date().toISOString(),
      source: "manual",
    };

    await storage.updateCrashReport(id, {
      status: "COMPLETED",
      data: reportData,
      errorLog: null,
    });

    console.log(`[CRASH-REPORT] Manual data submitted for report ${report.reportNumber} (id=${id})`);
    res.json({ success: true, message: "Crash report data saved successfully", data: reportData });
  }));

  app.post("/api/crash-reports/:id/retry", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = Number(req.params.id);
    const report = await storage.getCrashReport(id);
    if (!report) return res.status(404).json({ error: "Report not found" });

    if (report.subAccountId) {
      if (!(await verifyAccountOwnership(req, res, report.subAccountId))) return;
    }

    if (report.status !== "FAILED" && report.status !== "NOT_FOUND" && report.status !== "AWAITING") {
      return res.status(400).json({ error: "Only FAILED, NOT_FOUND, or AWAITING reports can be retried" });
    }

    await storage.updateCrashReport(id, {
      status: "PENDING",
      errorLog: null,
      lockedAt: null,
      lockedBy: null,
      retryCount: 0,
      serviceFailureCount: 0,
    });

    console.log(`[CRASH-REPORT] Report ${report.reportNumber} (id=${id}) re-queued for retry by user`);
    res.json({ success: true, message: `Report ${report.reportNumber} re-queued for lookup` });
  }));

  // ─── Crash Connect Webhook ───────────────────────────────────────
  app.post("/api/webhook/crashconnect", async (req, res) => {
    const startTime = Date.now();
    const WEBHOOK_SECRET = process.env.APEX_WEBHOOK_SECRET;
    const { event } = req.body || {};
    const payload = req.body?.payload || req.body;

    async function logWebhookFailure(reason: string, statusCode: number, accountId?: number | null) {
      try {
        const acctId = accountId || (payload?.subAccountId ? parseInt(String(payload.subAccountId)) : null) || (payload?.accountId ? parseInt(String(payload.accountId)) : null);
        if (acctId) {
          await storage.createWebhookEvent({
            subAccountId: acctId,
            eventType: `crashconnect.${event || "unknown"}`,
            url: "/api/webhook/crashconnect",
            method: "POST",
            requestBody: req.body,
            responseStatus: statusCode,
            responseBody: JSON.stringify({ error: reason }),
            status: "failed",
            error: reason,
            duration: Date.now() - startTime,
          });
        } else {
          console.warn(`[CRASH CONNECT] Webhook failure (no account ID to log): ${reason}`);
        }
      } catch (logErr: any) {
        console.error(`[CRASH CONNECT] Failed to log webhook failure event: ${logErr.message}`);
      }
    }

    if (!WEBHOOK_SECRET) {
      await logWebhookFailure("Webhook secret not configured", 500);
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    const sig = req.headers["x-webhook-signature"] as string;
    if (!sig) {
      await logWebhookFailure("Missing signature", 401);
      return res.status(401).json({ error: "Missing signature" });
    }

    const [timestamp, hash] = sig.split(".");
    if (!timestamp || !hash) {
      await logWebhookFailure("Invalid signature format", 401);
      return res.status(401).json({ error: "Invalid signature format" });
    }

    const expected = crypto.createHmac("sha256", WEBHOOK_SECRET)
      .update(timestamp + ":" + JSON.stringify(payload))
      .digest("hex");

    const hashBuf = Buffer.from(hash);
    const expectedBuf = Buffer.from(expected);
    if (hashBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(hashBuf, expectedBuf)) {
      await logWebhookFailure("Invalid signature — HMAC mismatch", 401);
      return res.status(401).json({ error: "Invalid signature" });
    }

    const age = Math.abs(Date.now() - parseInt(timestamp));
    if (age > 5 * 60 * 1000) {
      await logWebhookFailure(`Signature expired (age: ${Math.round(age / 1000)}s)`, 401);
      return res.status(401).json({ error: "Signature expired" });
    }

    console.log(`[CRASH CONNECT] Webhook received: ${event}`, JSON.stringify(payload).substring(0, 300));

    let webhookEventId: number | null = null;
    try {
      let targetAccountId: number | null = null;
      const token = payload.token || payload.webhookToken || null;
      if (token) {
        const [matchedAccount] = await db.select().from(subAccounts)
          .where(eq(subAccounts.webhookToken, token))
          .limit(1);
        if (matchedAccount) {
          targetAccountId = matchedAccount.id;
        } else {
          console.warn(`[CRASH CONNECT] No account found for token: ${token}`);
        }
      }
      if (!targetAccountId) {
        const rawAccountId = payload.subAccountId || payload.accountId || null;
        targetAccountId = rawAccountId ? parseInt(String(rawAccountId)) : null;
      }

      if (targetAccountId) {
        const webhookEvent = await storage.createWebhookEvent({
          subAccountId: targetAccountId,
          eventType: `crashconnect.${event}`,
          url: "/api/webhook/crashconnect",
          method: "POST",
          requestBody: req.body,
          status: "pending",
          duration: 0,
        });
        webhookEventId = webhookEvent.id;
      }

      if (event === "crash.detected" || event === "lead.created" || event === "lead.enriched") {
        const contactData: any = {
          firstName: payload.firstName || payload.name?.split(" ")[0] || "Crash Lead",
          lastName: payload.lastName || payload.name?.split(" ").slice(1).join(" ") || "",
          phone: payload.phone || null,
          email: payload.email || null,
          tags: ["Crash_Connect_Lead", event.replace(".", "_")],
          source: `Crash Connect: ${event}`,
        };

        if (payload.location) contactData.tags.push(`Location: ${payload.location}`);
        if (payload.severity) contactData.tags.push(`Severity: ${payload.severity}`);

        if (targetAccountId) {
          let existingContacts: any[] = [];
          if (payload.phone) {
            existingContacts = await db.select().from(contacts)
              .where(and(eq(contacts.subAccountId, targetAccountId), eq(contacts.phone, payload.phone)))
              .limit(1);
          } else if (payload.email) {
            existingContacts = await db.select().from(contacts)
              .where(and(eq(contacts.subAccountId, targetAccountId), eq(contacts.email, payload.email)))
              .limit(1);
          }

          if (existingContacts.length === 0) {
            await db.insert(contacts).values({
              subAccountId: targetAccountId,
              ...contactData,
            });
            console.log(`[CRASH CONNECT] CRM contact created: ${contactData.firstName} ${contactData.lastName}`);
          } else {
            console.log(`[CRASH CONNECT] Contact already exists, skipping duplicate`);
          }
        }
      }

      if (event === "crash.detected" && targetAccountId) {
        try {
          const account = await storage.getSubAccount(targetAccountId);
          if (account) {
            await db.insert(sentinelIncidents).values({
              subAccountId: targetAccountId,
              title: `Crash Detected: ${payload.location || "Unknown Location"}`,
              description: payload.description || `Crash event from Crash Connect at ${payload.location || "unknown location"}`,
              location: payload.location || `${payload.latitude || payload.lat || "0"},${payload.longitude || payload.lon || "0"}`,
              severity: payload.severity || "medium",
              rawPayload: payload,
            });
            console.log(`[CRASH CONNECT] Sentinel incident logged for account ${targetAccountId}`);
          }
        } catch (incErr: any) {
          console.error(`[CRASH CONNECT] Failed to log incident: ${incErr.message}`);
        }
      }

      if (targetAccountId && (event === "crash.detected" || event === "lead.created" || event === "lead.enriched")) {
        (async () => {
          try {
            const account = await storage.getSubAccount(targetAccountId);
            if (!account) return;

            const twilioNumber = (account as any).twilioNumber;
            const ownerPhone = payload.notifyPhone || (account as any).ownerPhone || null;
            const leadPhone = payload.phone || null;
            const leadName = payload.firstName || payload.name?.split(" ")[0] || "New Lead";
            const location = payload.location || "Unknown location";

            if (twilioNumber && ownerPhone) {
              const alertMsg = event === "crash.detected"
                ? `[Apex Alert] Crash detected at ${location}. Severity: ${payload.severity || "unknown"}. Lead: ${leadName}${leadPhone ? ` (${leadPhone})` : ""}. Check your dashboard for details.`
                : `[Apex Alert] New ${event.replace(".", " ")} — ${leadName}${leadPhone ? ` (${leadPhone})` : ""}. Source: Crash Connect.`;

              const { sendSms: sendSmsCrash } = await import("../messaging/sendSms");
              const crashSendResult = await sendSmsCrash({
                subAccountId: targetAccountId,
                to: ownerPhone,
                body: alertMsg,
                from: twilioNumber,
                source: "crash-connect-alert",
                path: "hot-lead",
                metadata: { event, severity: payload.severity ?? null },
              });

              if (crashSendResult.ok) {
                console.log(`[CRASH CONNECT] SMS alert sent to ${ownerPhone} sid=${crashSendResult.twilioSid}`);
                try {
                  await recordOutboundBilling({
                    subAccountId: targetAccountId,
                    channel: "sms",
                    provider: "twilio",
                    providerCost: 0.0079,
                    direction: "outbound",
                    messageType: "system",
                    metadata: { source: "crash_connect", event },
                  });
                } catch (billingErr: unknown) {
                  const errMsg = billingErr instanceof Error ? billingErr.message : String(billingErr);
                  console.error(`[BILLING CRITICAL] Crash Connect alert billing failed: ${errMsg}`);
                }
              } else {
                console.error(`[CRASH CONNECT] SMS alert failed account=${targetAccountId} reason=${crashSendResult.reason} err=${crashSendResult.errorMessage}`);
              }
            }

            if (leadPhone && twilioNumber && event === "crash.detected") {
              try {
                if (isAIConfigured()) {
                  const crashAiResult = await aiChat([
                    { role: "system", content: `You are an AI assistant for ${account.name || "a local business"}. A potential customer was just involved in a vehicle incident. Send a brief, empathetic text offering assistance. Keep it under 160 characters. Be professional and helpful. Do not mention AI.` },
                    { role: "user", content: `Generate an SMS to send to ${leadName} who was in a crash at ${location}. The business provides ${account.industry || "automotive"} services.` },
                  ], { temperature: 0.7, maxTokens: 200, route: "property-crash-sms" });

                  if (crashAiResult.text) {
                    const { sendSms: sendSmsAi } = await import("../messaging/sendSms");
                    const aiSendResult = await sendSmsAi({
                      subAccountId: targetAccountId,
                      to: leadPhone,
                      body: crashAiResult.text.trim(),
                      from: twilioNumber,
                      source: "crash-connect-ai-followup",
                      path: "auto-reply",
                      metadata: { event, ai_route: "property-crash-sms" },
                    });
                    if (!aiSendResult.ok) {
                      console.error(`[CRASH CONNECT] AI follow-up failed account=${targetAccountId} reason=${aiSendResult.reason} err=${aiSendResult.errorMessage}`);
                      throw new Error(`AI follow-up SMS failed: ${aiSendResult.reason}: ${aiSendResult.errorMessage}`);
                    }
                    console.log(`[CRASH CONNECT] AI follow-up sent to lead ${leadPhone} sid=${aiSendResult.twilioSid}`);
                    await logUsageInternal(targetAccountId, "AI_CHAT", 1, `Crash Connect AI message generation`);

                    try {
                      await recordOutboundBilling({
                        subAccountId: targetAccountId,
                        channel: "sms",
                        provider: "twilio",
                        providerCost: 0.0079,
                        direction: "outbound",
                        messageType: "system",
                        metadata: { source: "crash_connect_ai_followup", event },
                      });
                    } catch (billingErr: unknown) {
                      const errMsg = billingErr instanceof Error ? billingErr.message : String(billingErr);
                      console.error(`[BILLING CRITICAL] Crash Connect AI follow-up billing failed: ${errMsg}`);
                    }
                  }
                }
              } catch (aiErr: any) {
                console.error(`[CRASH CONNECT] AI follow-up failed: ${aiErr.message}`);
              }
            }

            const automations = await storage.getLiveAutomations(targetAccountId);
            const matchingAutomations = automations.filter((a: any) =>
              a.status === "compiled" &&
              a.manifest?.trigger &&
              (a.manifest.trigger === "new_lead" || a.manifest.trigger === "crash_detected" || a.manifest.trigger === event)
            );

            for (const automation of matchingAutomations) {
              try {
                const steps = automation.manifest?.steps || [];
                for (const step of steps) {
                  await executeDispatchAction(step.action, {
                    ...step.payload,
                    subAccountId: targetAccountId,
                    leadName,
                    leadPhone,
                    location,
                    severity: payload.severity,
                    event,
                  });
                }
                await storage.updateLiveAutomation(automation.id, {
                  lastRunAt: new Date(),
                  runCount: (automation.runCount || 0) + 1,
                  runLogs: [...(automation.runLogs as any[] || []), {
                    timestamp: new Date().toISOString(),
                    trigger: event,
                    source: "crashconnect_webhook",
                    status: "completed",
                  }],
                });
                console.log(`[CRASH CONNECT] Automation "${automation.name}" executed`);
              } catch (autoErr: any) {
                console.error(`[CRASH CONNECT] Automation "${automation.name}" failed: ${autoErr.message}`);
              }
            }
          } catch (automationErr: any) {
            console.error(`[CRASH CONNECT] Automation bridge error: ${automationErr.message}`);
          }
        })();
      }

      const responseBody = { success: true, event, processed: true };
      const duration = Date.now() - startTime;

      if (webhookEventId) {
        await storage.updateWebhookEvent(webhookEventId, {
          status: "delivered",
          responseStatus: 200,
          responseBody: JSON.stringify(responseBody),
          duration,
        });
      }

      res.json(responseBody);
    } catch (err: any) {
      console.error(`[CRASH CONNECT] Processing error: ${err.message}`);
      const errorBody = { error: "Processing failed", event, detail: err.message };
      const duration = Date.now() - startTime;

      if (webhookEventId) {
        try {
          await storage.updateWebhookEvent(webhookEventId, {
            status: "failed",
            responseStatus: 500,
            responseBody: JSON.stringify(errorBody),
            error: err.message,
            duration,
          });
        } catch (updateErr: any) {
          console.error(`[CRASH CONNECT] Failed to update webhook event: ${updateErr.message}`);
        }
      }

      res.status(500).json(errorBody);
    }
  });

  // ─── External Sentinel API (token-authenticated, for partner sites) ───
  async function resolveTokenAccount(token: string | undefined) {
    if (!token) return null;
    const [account] = await db.select().from(subAccounts)
      .where(eq(subAccounts.webhookToken, token))
      .limit(1);
    return account || null;
  }

  async function resolveSentinelSourceAccountId(tokenAccountId: number): Promise<number> {
    const ownConfig = await storage.getSentinelConfig(tokenAccountId);
    if (ownConfig && ownConfig.enabled) {
      return tokenAccountId;
    }
    const [activeConfig] = await db.select().from(sentinelConfig)
      .where(eq(sentinelConfig.enabled, true))
      .orderBy(desc(sentinelConfig.updatedAt))
      .limit(1);
    if (activeConfig) {
      return activeConfig.subAccountId;
    }
    return tokenAccountId;
  }

  app.get("/api/v1/external/sentinel/incidents", asyncHandler(async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });

    const sourceAccountId = await resolveSentinelSourceAccountId(account.id);

    const sinceParam = req.query.since as string | undefined;
    const limitParam = req.query.limit as string | undefined;
    const statusFilter = req.query.status as string | undefined;

    const validStatuses = ["pending", "contacted", "resolved", "dismissed", "acknowledged", "actioned"];

    let since: Date | undefined;
    if (sinceParam) {
      since = new Date(sinceParam);
      if (isNaN(since.getTime())) {
        return res.status(400).json({ error: "Invalid date format for 'since' parameter. Use ISO 8601 format." });
      }
    }

    let limit: number | undefined;
    if (limitParam) {
      limit = parseInt(limitParam);
      if (isNaN(limit) || limit < 1 || limit > 500) {
        return res.status(400).json({ error: "'limit' must be a number between 1 and 500." });
      }
    }

    if (statusFilter && !validStatuses.includes(statusFilter)) {
      return res.status(400).json({ error: `Invalid 'status'. Must be one of: ${validStatuses.join(", ")}` });
    }

    const incidents = await storage.getSentinelIncidentsFiltered(sourceAccountId, {
      since,
      status: statusFilter,
      limit: limit || 100,
    });

    res.json({
      accountName: account.name,
      sourceAccountId,
      total: incidents.length,
      query: { since: sinceParam || null, limit: limit || 100, status: statusFilter || null },
      incidents: incidents.map(i => ({
        id: i.id,
        title: i.title,
        description: i.description,
        location: i.location,
        severity: i.severity,
        actionStatus: i.actionStatus,
        smsSent: i.smsSent,
        geofenceDeployed: i.geofenceDeployed,
        detectedAt: i.detectedAt,
      })),
    });
  }));

  const purgeScanLastRun = new Map<string, number>();

  app.post("/api/v1/external/sentinel/purge", asyncHandler(async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });

    const lastRun = purgeScanLastRun.get(token) || 0;
    if (Date.now() - lastRun < 300_000) {
      return res.status(429).json({ error: "Purge rate limited — wait 5 minutes between purges" });
    }

    const olderThanParam = req.body?.olderThan as string | undefined;
    if (!olderThanParam) {
      return res.status(400).json({ error: "'olderThan' is required. Provide an ISO 8601 date string." });
    }

    const olderThan = new Date(olderThanParam);
    if (isNaN(olderThan.getTime())) {
      return res.status(400).json({ error: "Invalid date format for 'olderThan'. Use ISO 8601 format." });
    }

    const dryRun = req.body?.dryRun === true;

    const sourceAccountId = await resolveSentinelSourceAccountId(account.id);

    if (dryRun) {
      const allIncidents = await storage.getSentinelIncidents(sourceAccountId);
      const wouldDelete = allIncidents.filter(i => i.detectedAt && new Date(i.detectedAt) < olderThan).length;
      return res.json({ dryRun: true, wouldPurge: wouldDelete, olderThan: olderThan.toISOString() });
    }

    purgeScanLastRun.set(token, Date.now());
    const purgedCount = await storage.purgeSentinelIncidents(sourceAccountId, olderThan);

    console.log(`[SENTINEL] Purged ${purgedCount} incidents older than ${olderThan.toISOString()} for account ${account.id}`);

    res.json({
      success: true,
      purged: purgedCount,
      olderThan: olderThan.toISOString(),
    });
  }));

  app.get("/api/v1/external/sentinel/incidents/:id", asyncHandler(async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });

    const sourceAccountId = await resolveSentinelSourceAccountId(account.id);
    const incident = await storage.getSentinelIncident(parseInt(req.params.id));
    if (!incident || incident.subAccountId !== sourceAccountId) {
      return res.status(404).json({ error: "Incident not found" });
    }
    res.json({
      id: incident.id,
      title: incident.title,
      description: incident.description,
      location: incident.location,
      severity: incident.severity,
      actionStatus: incident.actionStatus,
      smsSent: incident.smsSent,
      geofenceDeployed: incident.geofenceDeployed,
      rawPayload: incident.rawPayload,
      detectedAt: incident.detectedAt,
    });
  }));

  app.get("/api/v1/external/sentinel/stats", asyncHandler(async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });

    const sourceAccountId = await resolveSentinelSourceAccountId(account.id);
    const incidents = await storage.getSentinelIncidents(sourceAccountId);
    const total = incidents.length;
    const bySeverity = { low: 0, medium: 0, high: 0, critical: 0 };
    const byStatus = { pending: 0, contacted: 0, resolved: 0, dismissed: 0 };
    for (const i of incidents) {
      if (i.severity in bySeverity) bySeverity[i.severity as keyof typeof bySeverity]++;
      if (i.actionStatus && i.actionStatus in byStatus) byStatus[i.actionStatus as keyof typeof byStatus]++;
    }
    const last24h = incidents.filter(i => {
      const dt = new Date(i.detectedAt).getTime();
      return Date.now() - dt < 24 * 60 * 60 * 1000;
    }).length;
    const last7d = incidents.filter(i => {
      const dt = new Date(i.detectedAt).getTime();
      return Date.now() - dt < 7 * 24 * 60 * 60 * 1000;
    }).length;

    res.json({
      accountName: account.name,
      total,
      last24h,
      last7d,
      bySeverity,
      byStatus,
    });
  }));

  app.get("/api/v1/external/sentinel/config", asyncHandler(async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });
    const sourceAccountId = await resolveSentinelSourceAccountId(account.id);
    const config = await storage.getSentinelConfig(sourceAccountId);
    res.json(config || { enabled: false });
  }));

  app.put("/api/v1/external/sentinel/config", asyncHandler(async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });
    const { keywords, scanInterval, enabled, smsAlertEnabled, smsAlertPhone, geofenceEnabled, geofenceRadiusMiles, targetCities, targetStates } = req.body;
    const config = await storage.upsertSentinelConfig({
      subAccountId: account.id,
      keywords: keywords || [],
      scanInterval: scanInterval || 60,
      enabled: enabled ?? false,
      smsAlertEnabled: smsAlertEnabled ?? true,
      smsAlertPhone: smsAlertPhone || null,
      geofenceEnabled: geofenceEnabled ?? true,
      geofenceRadiusMiles: geofenceRadiusMiles || 1,
      targetCities: targetCities || [],
      targetStates: targetStates || [],
    });
    res.json(config);
  }));

  const externalScanLastRun = new Map<string, number>();
  app.post("/api/v1/external/sentinel/scan", asyncHandler(async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });
    const lastRun = externalScanLastRun.get(token) || 0;
    if (Date.now() - lastRun < 60_000) {
      return res.status(429).json({ error: "Scan rate limited — wait 60 seconds between scans" });
    }
    externalScanLastRun.set(token, Date.now());
    const sourceAccountId = await resolveSentinelSourceAccountId(account.id);
    try {
      const config = await storage.getSentinelConfig(sourceAccountId);
      const liveIncidents = await processLiveSentinelFeed();
      let saved = 0;
      for (const inc of liveIncidents) {
        const hash = `${inc.type}-${inc.location}-${inc.id}`.replace(/\s+/g, "").toLowerCase();
        const existing = await storage.getSentinelIncidentByHash(sourceAccountId, hash);
        if (!existing) {
          await storage.createSentinelIncident({
            subAccountId: sourceAccountId,
            sourceHash: hash,
            title: inc.type,
            description: `${inc.type} at ${inc.location}. ${inc.distanceMiles !== 'unknown' ? inc.distanceMiles + ' mi away.' : ''} County: ${inc.county || 'FL'}. ${inc.remarks || ''}`,
            location: inc.location,
            severity: inc.severity,
            rawPayload: { id: inc.id, lat: inc.lat, lng: inc.lng, type: inc.type, source: inc.source, state: inc.state, county: inc.county },
          });
          saved++;
        }
      }
      res.json({ found: saved, total: liveIncidents.length, source: "fhp_live" });
    } catch (err: any) {
      console.error(`[EXTERNAL SENTINEL] Scan error: ${err.message}`);
      res.json({ found: 0, source: "external_trigger", error: err.message });
    }
  }));

  app.post("/api/v1/external/sentinel/incidents/:id/acknowledge", asyncHandler(async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });
    const sourceAccountId = await resolveSentinelSourceAccountId(account.id);
    const incident = await storage.getSentinelIncident(parseInt(req.params.id));
    if (!incident || incident.subAccountId !== sourceAccountId) return res.status(404).json({ error: "Not found" });
    await storage.updateSentinelIncident(incident.id, { actionStatus: "acknowledged" });
    res.json({ success: true });
  }));

  app.post("/api/v1/external/sentinel/incidents/:id/deploy-geofence", asyncHandler(async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });
    const sourceAccountId = await resolveSentinelSourceAccountId(account.id);
    const incident = await storage.getSentinelIncident(parseInt(req.params.id));
    if (!incident || incident.subAccountId !== sourceAccountId) return res.status(404).json({ error: "Not found" });
    await storage.updateSentinelIncident(incident.id, { geofenceDeployed: true, actionStatus: "actioned" });
    res.json({ success: true, message: "Geofence deployed" });
  }));

  app.post("/api/v1/external/sentinel/incidents/:id/send-sms", asyncHandler(async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });
    const sourceAccountId = await resolveSentinelSourceAccountId(account.id);
    const incident = await storage.getSentinelIncident(parseInt(req.params.id));
    if (!incident || incident.subAccountId !== sourceAccountId) return res.status(404).json({ error: "Not found" });
    const config = await storage.getSentinelConfig(sourceAccountId);
    const alertPhone = config?.smsAlertPhone || (account as any).ownerPhone;
    if (!alertPhone || !(account as any).twilioNumber) {
      return res.status(400).json({ error: "SMS not configured — set alert phone in Sentinel config" });
    }
    {
      const { sendSms: sendSmsRenotify } = await import("../messaging/sendSms");
      const renotifyResult = await sendSmsRenotify({
        subAccountId: incident.subAccountId,
        to: alertPhone,
        body: `SENTINEL ALERT: ${incident.title} — ${incident.location || "Unknown location"} (${incident.severity})`,
        from: (account as any).twilioNumber,
        source: "sentinel-renotify-sms",
        path: "hot-lead",
        metadata: { incidentId: incident.id, severity: incident.severity },
      });
      if (renotifyResult.ok) {
        await storage.updateSentinelIncident(incident.id, { smsSent: true });
        res.json({ success: true, message: "SMS sent", twilioSid: renotifyResult.twilioSid });
      } else {
        const httpStatus = renotifyResult.reason === "no_client" || renotifyResult.reason === "no_from_number" ? 503 : 502;
        res.status(httpStatus).json({
          error: "SMS send failed",
          reason: renotifyResult.reason,
          detail: renotifyResult.errorMessage,
          twilio_status: renotifyResult.errorStatus ?? null,
          twilio_code: renotifyResult.errorCode ?? null,
        });
      }
    }
  }));

  // ─── Client Website Integration ───────────────────────────────────
  app.get("/api/client-websites/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId as string);
    const sites = await storage.getClientWebsites(subAccountId);
    res.json(sites);
  }));

  app.post("/api/client-websites", asyncHandler(async (req, res) => {
    const schema = z.object({
      subAccountId: z.number(),
      url: z.string().url(),
      name: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const site = await storage.createClientWebsite({
      ...parsed.data,
      status: "draft",
      widgetEnabled: false,
      widgetColor: "#6366f1",
      widgetGreeting: "Hi there! How can I help you today?",
      widgetPosition: "bottom-right",
      pagesCrawled: 0,
      verificationAttempts: 0,
    });
    res.json(site);
  }));

  app.patch("/api/client-websites/:id", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id as string);
    const updateSchema = z.object({
      widgetEnabled: z.boolean().optional(),
      widgetColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      widgetGreeting: z.string().max(500).optional(),
      widgetPosition: z.enum(["bottom-right", "bottom-left"]).optional(),
      name: z.string().min(1).max(200).optional(),
      url: z.string().url().optional(),
    });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const site = await storage.updateClientWebsite(id, parsed.data);
    if (!site) return res.status(404).json({ error: "Site not found" });
    res.json(site);
  }));

  app.delete("/api/client-websites/:id", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id as string);
    await storage.deleteClientWebsite(id);
    res.json({ success: true });
  }));

  app.post("/api/client-websites/:id/scrape", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id as string);
    const site = await storage.getClientWebsite(id);
    if (!site) return res.status(404).json({ error: "Site not found" });

    const persona = req.body.persona || `You are a helpful assistant for ${site.name}. Answer questions about the business based on the website content at ${site.url}. Be friendly and professional.`;

    const job = await storage.createTrainingJob({
      url: site.url,
      persona,
      state: "pending",
      progress: 0,
      logs: [],
    });

    await storage.updateClientWebsite(id, {
      status: "training",
      trainingJobId: job.id,
      botPersona: persona,
      lastCrawlStatus: "in_progress",
      lastError: null,
    });

    (async () => {
      try {
        await runRealTraining(job.id);
        const completedJob = await storage.getTrainingJob(job.id);

        if (completedJob && completedJob.state === "failed") {
          const errorMsg = (completedJob.logs && completedJob.logs.length > 0)
            ? completedJob.logs[completedJob.logs.length - 1]
            : "Training failed for an unknown reason";
          console.error(`[WebsiteIntegration] Training failed for site ${id}: ${errorMsg}`);
          await storage.updateClientWebsite(id, {
            status: "error",
            lastCrawlStatus: "failed",
            lastError: errorMsg,
          });
          return;
        }

        let realPageCount = 0;
        if (completedJob?.scrapedContent) {
          const lines = completedJob.scrapedContent.split("\n").filter((l: string) => l.trim().length > 0);
          realPageCount = lines.length;
        }

        console.log(`[WebsiteIntegration] Training complete for site ${id}: ${realPageCount} content blocks extracted`);
        await storage.updateClientWebsite(id, {
          status: "trained",
          scrapedAt: new Date(),
          pagesCrawled: realPageCount,
          lastCrawlStatus: "completed",
          lastError: null,
        });
      } catch (err: any) {
        console.error(`[WebsiteIntegration] Scrape/training error for site ${id}:`, err.message);
        await storage.updateClientWebsite(id, {
          status: "error",
          lastCrawlStatus: "failed",
          lastError: err.message || "An unexpected error occurred during training",
        });
      }
    })();

    res.json({ jobId: job.id, status: "training" });
  }));

  app.get("/api/client-websites/:id/embed-code", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id as string);
    const site = await storage.getClientWebsite(id);
    if (!site) return res.status(404).json({ error: "Site not found" });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const embedScript = `<!-- Apex AI Chat Widget -->
  <script>
  (function() {
  var s = document.createElement('script');
  s.src = '${baseUrl}/api/widget.js?siteId=${site.id}';
  s.async = true;
  document.body.appendChild(s);
  })();
  </script>`;

    res.json({ embedCode: embedScript, siteId: site.id });
  }));

  app.post("/api/client-websites/:id/verify-install", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id as string);
    const site = await storage.getClientWebsite(id);
    if (!site) return res.status(404).json({ error: "Site not found" });

    await storage.updateClientWebsite(id, {
      verificationAttempts: (site.verificationAttempts || 0) + 1,
    });

    console.log(`[WebsiteIntegration] Verify install attempt #${(site.verificationAttempts || 0) + 1} for site ${id} (${site.url})`);

    if (!["trained", "install_pending", "verified", "error"].includes(site.status)) {
      console.warn(`[WebsiteIntegration] Verification rejected for site ${id}: status is "${site.status}", training required first`);
      return res.json({
        verified: false,
        reason: "training_required",
        message: "Train the AI on this website before verifying the widget installation.",
      });
    }

    let fetchedUrl: string;
    let html: string;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(site.url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ApexVerifier/1.0)",
          "Accept": "text/html,application/xhtml+xml",
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.error(`[WebsiteIntegration] Verification fetch failed for site ${id}: HTTP ${response.status}`);
        return res.json({
          verified: false,
          reason: "page_unreachable",
          message: `Could not load ${site.url} — the server returned HTTP ${response.status}. Make sure the URL is correct and the website is online.`,
        });
      }

      fetchedUrl = response.url;
      html = await response.text();
    } catch (fetchErr: any) {
      const errMsg = fetchErr.name === "AbortError" ? "Request timed out" : fetchErr.message;
      console.error(`[WebsiteIntegration] Verification fetch error for site ${id}:`, errMsg);
      return res.json({
        verified: false,
        reason: "request_blocked",
        message: `Could not reach ${site.url} — ${errMsg}. Ensure the website is publicly accessible and not blocking requests.`,
      });
    }

    const enteredDomain = new URL(site.url).hostname.replace(/^www\./, "");
    const fetchedDomain = new URL(fetchedUrl).hostname.replace(/^www\./, "");
    if (enteredDomain !== fetchedDomain) {
      console.warn(`[WebsiteIntegration] Domain mismatch for site ${id}: entered ${enteredDomain}, resolved to ${fetchedDomain}`);
      return res.json({
        verified: false,
        reason: "domain_mismatch",
        message: `The URL redirected to a different domain (${fetchedDomain}). Make sure the embed script is installed on ${enteredDomain}, not ${fetchedDomain}.`,
      });
    }

    const widgetPatterns = [
      /widget\.js\?siteId=/i,
      /api\/widget\.js\?siteId=/i,
      /ApexBot/i,
      /apex-chat-btn/i,
      /apex-chat-box/i,
    ];

    const scriptFound = widgetPatterns.some(pattern => pattern.test(html));

    if (scriptFound) {
      console.log(`[WebsiteIntegration] Verification SUCCESS for site ${id}: widget script detected on ${fetchedUrl}`);
      await storage.updateClientWebsite(id, {
        status: "verified",
        installVerifiedAt: new Date(),
        lastError: null,
      });
      return res.json({
        verified: true,
        reason: "script_found",
        message: "Widget script detected and verified. Your AI chatbot is live!",
      });
    }

    console.warn(`[WebsiteIntegration] Verification FAILED for site ${id}: widget script not found on ${fetchedUrl}`);
    await storage.updateClientWebsite(id, {
      status: "install_pending",
      lastError: "Widget script not detected on the website",
    });
    return res.json({
      verified: false,
      reason: "script_not_found",
      message: "Widget script not detected on the page. Ensure the embed code is placed before the closing </body> tag. If you just added it, wait a few minutes for CDN caches to clear and try again.",
    });
  }));

  app.get("/api/widget.js", async (_req, res) => {
    const siteIdParam = _req.query.siteId;
    if (!siteIdParam || isNaN(Number(siteIdParam))) {
      return res.status(400).type("application/javascript").send("/* Invalid siteId */");
    }
    const siteId = Number(siteIdParam);
    const site = await storage.getClientWebsite(siteId);
    if (!site) {
      return res.status(404).type("application/javascript").send("/* Site not found */");
    }
    const colorRaw = site.widgetColor || "#6366f1";
    const color = /^#[0-9a-fA-F]{6}$/.test(colorRaw) ? colorRaw : "#6366f1";
    const greeting = (site.widgetGreeting || "Hi! How can I help?").replace(/[<>"'&\\]/g, "");
    const position = site.widgetPosition === "bottom-left" ? "bottom-left" : "bottom-right";
    const baseUrl = `${_req.protocol}://${_req.get("host")}`;

    const js = `
  (function() {
  var style = document.createElement('style');
  style.textContent = \`
    #apex-chat-btn { position:fixed; ${position === 'bottom-left' ? 'left:24px' : 'right:24px'}; bottom:24px; width:60px; height:60px; border-radius:50%; background:${color}; border:none; cursor:pointer; box-shadow:0 4px 20px rgba(0,0,0,0.3); z-index:99999; display:flex; align-items:center; justify-content:center; transition:transform 0.2s; }
    #apex-chat-btn:hover { transform:scale(1.1); }
    #apex-chat-btn svg { width:28px; height:28px; fill:white; }
    #apex-chat-box { position:fixed; ${position === 'bottom-left' ? 'left:24px' : 'right:24px'}; bottom:96px; width:370px; max-height:500px; background:white; border-radius:16px; box-shadow:0 8px 40px rgba(0,0,0,0.2); z-index:99999; display:none; flex-direction:column; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,sans-serif; }
    #apex-chat-box.open { display:flex; }
    #apex-chat-header { padding:16px; background:${color}; color:white; font-weight:600; font-size:14px; display:flex; justify-content:space-between; align-items:center; }
    #apex-chat-header .dot { width:8px; height:8px; background:#4ade80; border-radius:50%; display:inline-block; margin-right:8px; }
    #apex-chat-messages { flex:1; overflow-y:auto; padding:16px; min-height:300px; background:#fafafa; }
    .apex-msg { margin-bottom:12px; max-width:80%; padding:10px 14px; border-radius:12px; font-size:13px; line-height:1.4; }
    .apex-msg.bot { background:white; border:1px solid #e5e7eb; border-bottom-left-radius:4px; }
    .apex-msg.user { background:${color}; color:white; margin-left:auto; border-bottom-right-radius:4px; }
    #apex-chat-input-wrap { padding:12px; border-top:1px solid #e5e7eb; display:flex; gap:8px; background:white; }
    #apex-chat-input { flex:1; border:1px solid #d1d5db; border-radius:8px; padding:8px 12px; font-size:13px; outline:none; }
    #apex-chat-input:focus { border-color:${color}; }
    #apex-chat-send { background:${color}; color:white; border:none; border-radius:8px; padding:8px 16px; cursor:pointer; font-size:13px; font-weight:500; }
  \`;
  document.head.appendChild(style);

  var btn = document.createElement('button');
  btn.id = 'apex-chat-btn';
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
  document.body.appendChild(btn);

  var box = document.createElement('div');
  box.id = 'apex-chat-box';
  box.innerHTML = '<div id="apex-chat-header"><div><span class="dot"></span>AI Assistant</div><button onclick="document.getElementById(\\'apex-chat-box\\').classList.remove(\\'open\\')" style="background:none;border:none;color:white;cursor:pointer;font-size:18px">&times;</button></div><div id="apex-chat-messages"><div class="apex-msg bot">${greeting.replace(/'/g, "\\'")}</div></div><div id="apex-chat-input-wrap"><input id="apex-chat-input" placeholder="Type a message..." /><button id="apex-chat-send" onclick="apexSend()">Send</button></div>';
  document.body.appendChild(box);

  btn.onclick = function() { box.classList.toggle('open'); };

  var input = document.getElementById('apex-chat-input');
  input.addEventListener('keydown', function(e) { if(e.key==='Enter') apexSend(); });

  var history = [];
  window.apexSend = function() {
    var msg = input.value.trim();
    if(!msg) return;
    input.value = '';
    var msgs = document.getElementById('apex-chat-messages');
    msgs.innerHTML += '<div class="apex-msg user">' + msg.replace(/</g,'&lt;') + '</div>';
    msgs.scrollTop = msgs.scrollHeight;
    history.push({role:'user',content:msg});

    fetch('${baseUrl}/api/bot/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:msg, conversationHistory:history, siteId:${siteId}})
    }).then(r=>r.json()).then(function(data){
      history.push({role:'assistant',content:data.reply});
      msgs.innerHTML += '<div class="apex-msg bot">' + data.reply.replace(/</g,'&lt;') + '</div>';
      msgs.scrollTop = msgs.scrollHeight;
    }).catch(function(){
      msgs.innerHTML += '<div class="apex-msg bot">Sorry, I\\'m having trouble right now. Please try again.</div>';
    });
  };
  })();`;

    res.type("application/javascript").send(js);
  });

  // ─── AI Form Builder ──────────────────────────────────────────────
  const FORM_BUILDER_SYSTEM_PROMPT = `You are an expert form builder for lead generation. Given an industry/niche, generate a custom form with fields appropriate for that business type.

  Return a JSON object with this exact structure:
  {
  "fields": [
    {
      "id": "<unique_id>",
      "label": "<field label>",
      "type": "<text|email|phone|textarea|select|checkbox|date>",
      "required": <true|false>,
      "placeholder": "<placeholder text>",
      "helpText": "<optional compliance/regulation note>",
      "options": ["option1", "option2"] // only for select type
    }
  ],
  "complianceNotes": [
    "<regulation note 1>",
    "<regulation note 2>"
  ]
  }

  Rules:
  - Generate 6-12 fields appropriate for the industry
  - Always include: Full Name, Email, Phone as the first three fields
  - Add industry-specific fields (e.g., "Case Type" for law, "Property Address" for real estate, "Insurance Provider" for medical)
  - Include compliance/regulation helpText where relevant:
  - Medical/dental/medspa: HIPAA privacy notice on health-related fields
  - Legal: Attorney-client privilege disclaimers
  - Any SMS/phone collection: TCPA consent notice
  - Financial: Disclaimer about not being financial advice
  - Real estate: Fair Housing Act compliance
  - complianceNotes should list 2-4 key regulations the business should be aware of
  - Field IDs should be snake_case
  - Return ONLY valid JSON, no markdown, no code fences`;

  const formGenerateSchema = z.object({
    industry: z.string().min(1).max(500),
    businessName: z.string().max(500).optional(),
  });

  app.post("/api/forms/generate", asyncHandler(async (req, res) => {
    if (!isAIConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = formGenerateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { industry, businessName } = parsed.data;
    const userPrompt = businessName
      ? `Generate a lead capture form for a ${industry} business called "${businessName}".`
      : `Generate a lead capture form for a ${industry} business.`;

    const formAiResult = await aiChat([
      { role: "system", content: FORM_BUILDER_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ], { temperature: 0.7, maxTokens: 4096, jsonMode: true, route: "forms-generate" });
    const cleaned = formAiResult.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let formData: any;
    try {
      formData = JSON.parse(cleaned);
    } catch (err) {
      console.warn("[PROPERTY] caught:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "AI returned invalid JSON" });
    }

    if (!formData.fields || !Array.isArray(formData.fields)) {
      return res.status(500).json({ error: "AI returned invalid form structure" });
    }

    await logUsageInternal(null, "AI_CHAT", 1, "Form builder AI generation");

    res.json({
      fields: formData.fields,
      complianceNotes: formData.complianceNotes || [],
    });
  }));

  const savedForms = new Map<string, any[]>();

  app.get("/api/forms/saved/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = req.params.subAccountId as string;
    const forms = savedForms.get(subAccountId) || [];
    res.json(forms);
  }));

  const formSaveSchema = z.object({
    subAccountId: z.string().or(z.number()).transform(String),
    name: z.string().min(1).max(200),
    industry: z.string().min(1).max(500),
    fields: z.array(z.any()),
    complianceNotes: z.array(z.string()).optional(),
  });

  app.post("/api/forms/save", asyncHandler(async (req, res) => {
    const parsed = formSaveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, name, industry, fields, complianceNotes } = parsed.data;
    const form = {
      id: `form_${Date.now()}`,
      name,
      industry,
      fields,
      complianceNotes: complianceNotes || [],
      createdAt: new Date().toISOString(),
    };

    const existing = savedForms.get(subAccountId) || [];
    existing.push(form);
    savedForms.set(subAccountId, existing);

    res.status(201).json(form);
  }));

  app.get("/api/contacts/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { db } = await import("../db");
    const { contacts } = await import("@shared/schema");
    const { eq, and, notInArray, isNotNull, ne, desc, sql } = await import("drizzle-orm");

    const page     = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset   = (page - 1) * pageSize;
    const source   = req.query.source as string | undefined;
    const search   = (req.query.search as string | undefined)?.toLowerCase().trim();
    const tag      = req.query.tag as string | undefined;
    const hasPhone = req.query.hasPhone === "true";

    // Default view excludes attorney-scraper rows.
    // Pass ?source=legal_pipeline to see those, or ?source=all for everything.
    const ATTORNEY_SOURCES = ["legal_pipeline"];
    const conditions: any[] = [eq(contacts.subAccountId, subAccountId)];

    if (source && source !== "all") {
      conditions.push(eq(contacts.source, source));
    } else if (!source) {
      conditions.push(notInArray(contacts.source, ATTORNEY_SOURCES));
    }

    if (search) {
      conditions.push(
        sql`(LOWER(${contacts.firstName}) LIKE ${"%" + search + "%"}
          OR LOWER(COALESCE(${contacts.lastName},'')) LIKE ${"%" + search + "%"}
          OR LOWER(COALESCE(${contacts.phone},''))    LIKE ${"%" + search + "%"}
          OR LOWER(COALESCE(${contacts.email},''))    LIKE ${"%" + search + "%"})`
      );
    }

    // Tag and hasPhone applied at DB level so COUNT(*) is accurate
    if (tag) {
      conditions.push(sql`${contacts.tags} @> ARRAY[${tag}]::text[]`);
    }
    if (hasPhone) {
      conditions.push(isNotNull(contacts.phone));
      conditions.push(ne(contacts.phone, ""));
    }

    const where = and(...conditions);

    // Real COUNT — never approximated from items.length
    const [countRow] = await db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(contacts)
      .where(where);
    const total = countRow?.total ?? 0;

    // Account-wide metrics (unfiltered — always reflect true totals)
    const [metricsRow] = await db
      .select({
        withPhone:  sql<number>`COUNT(*) FILTER (WHERE phone IS NOT NULL AND phone <> '')::int`,
        crashLeads: sql<number>`COUNT(*) FILTER (WHERE source = 'sentinel_crash' OR tags @> ARRAY['crash-lead']::text[])::int`,
        skipTraced: sql<number>`COUNT(*) FILTER (WHERE tags @> ARRAY['skip-traced']::text[])::int`,
      })
      .from(contacts)
      .where(eq(contacts.subAccountId, subAccountId));

    const items = await db
      .select()
      .from(contacts)
      .where(where)
      .orderBy(desc(contacts.createdAt))
      .limit(pageSize)
      .offset(offset);

    const totalPages = Math.ceil(total / pageSize);
    res.json({
      items,
      // Legacy alias so existing callers using `.data` don't break during rollout
      data: items,
      total,
      page,
      pageSize,
      totalPages,
      metrics: {
        totalWithPhone: metricsRow?.withPhone  ?? 0,
        crashLeads:     metricsRow?.crashLeads ?? 0,
        skipTraced:     metricsRow?.skipTraced ?? 0,
      },
    });
  }));

  app.get("/api/contacts/detail/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const contact = await storage.getContactById(id);
    if (!contact) return res.status(404).json({ error: "Contact not found" });
    res.json(contact);
  }));

  app.post("/api/contacts", asyncHandler(async (req, res) => {
    const rawBody: Record<string, unknown> =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const headerRaw = req.headers["x-sub-account-id"];
    const headerProvided = headerRaw !== undefined && String(headerRaw).trim() !== "";
    const bodyHasSubAccountId = Object.prototype.hasOwnProperty.call(rawBody, "subAccountId");

    if (!headerProvided && !bodyHasSubAccountId) {
      return res.status(400).json({
        error: "subAccountId is required: provide it via the 'x-sub-account-id' request header or the 'subAccountId' field in the request body.",
      });
    }

    const bodyForValidation: Record<string, unknown> = { ...rawBody };
    if (headerProvided && typeof req.tenant?.subAccountId === "number") {
      bodyForValidation.subAccountId = req.tenant.subAccountId;
    }

    const parsed = insertContactSchema.safeParse(bodyForValidation);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    let contactData = { ...parsed.data };
    if (contactData.address && !contactData.lat) {
      const geo = await geocodeAddress(contactData.address);
      if (geo) {
        contactData = {
          ...contactData,
          formattedAddress: geo.formattedAddress,
          city: contactData.city || geo.city,
          state: contactData.state || geo.state,
          zip: contactData.zip || geo.zip,
          lat: geo.lat,
          lng: geo.lng,
          geocodeStatus: "success",
          geocodedAt: new Date(),
        };
      } else {
        contactData.geocodeStatus = "failed";
      }
    }

    const contact = await storage.createContact(contactData);
    if (contact.subAccountId) {
      const triggerCtx = {
        leadName: contact.firstName || "Lead",
        leadPhone: contact.phone,
        leadEmail: contact.email,
        source: contact.source || "manual",
      };
      import("./v1").then(({ fireAutomationTriggerGlobal }) => {
        fireAutomationTriggerGlobal("new_lead", contact.subAccountId!, triggerCtx);
        fireAutomationTriggerGlobal("contact_created", contact.subAccountId!, { ...triggerCtx, contactId: contact.id });
      }).catch(e => console.error("[CONTACTS] trigger failed:", e instanceof Error ? e.message : e));
      emitUniversalEvent({ eventType: INTEL_EVENT_TYPES.CONTACT_CREATED, sourceModule: "crm", sourceTable: "contacts", sourceRecordId: String(contact.id), subAccountId: contact.subAccountId, contactId: contact.id, metadata: { firstName: contact.firstName, lastName: contact.lastName, source: contact.source, channel: contact.channel } });
    }
    res.status(201).json(contact);
  }));

  app.patch("/api/contacts/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");

    const existing = await storage.getContactById(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });

    const ownerOk = await verifyAccountOwnership(req, res, existing.subAccountId);
    if (!ownerOk) return;

    const allowedFields = ["firstName", "lastName", "email", "phone", "company", "source", "tags", "notes", "address", "city", "state", "zip", "smsOptOut", "emailOptOut"] as const;
    let updateData: Record<string, any> = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        updateData[key] = req.body[key];
      }
    }
    if (updateData.firstName !== undefined && (typeof updateData.firstName !== "string" || !updateData.firstName.trim())) {
      return res.status(400).json({ error: "firstName must be a non-empty string" });
    }
    if (updateData.email !== undefined && typeof updateData.email !== "string") {
      return res.status(400).json({ error: "email must be a string" });
    }
    if (updateData.phone !== undefined && typeof updateData.phone !== "string") {
      return res.status(400).json({ error: "phone must be a string" });
    }
    if (updateData.smsOptOut !== undefined && typeof updateData.smsOptOut !== "boolean") {
      return res.status(400).json({ error: "smsOptOut must be a boolean" });
    }
    if (updateData.emailOptOut !== undefined && typeof updateData.emailOptOut !== "boolean") {
      return res.status(400).json({ error: "emailOptOut must be a boolean" });
    }
    if (updateData.tags !== undefined && !Array.isArray(updateData.tags)) {
      return res.status(400).json({ error: "tags must be an array of strings" });
    }
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    if (updateData.address && existing.address !== updateData.address) {
      const geo = await geocodeAddress(updateData.address);
      if (geo) {
        updateData = {
          ...updateData,
          formattedAddress: geo.formattedAddress,
          city: updateData.city || geo.city,
          state: updateData.state || geo.state,
          zip: updateData.zip || geo.zip,
          lat: geo.lat,
          lng: geo.lng,
          geocodeStatus: "success",
          geocodedAt: new Date(),
        };
      } else {
        updateData.geocodeStatus = "failed";
      }
    }

    const updated = await storage.updateContact(id, updateData);
    if (!updated) return res.status(404).json({ error: "Contact not found" });
    emitUniversalEvent({ eventType: INTEL_EVENT_TYPES.CONTACT_UPDATED, sourceModule: "crm", sourceTable: "contacts", sourceRecordId: String(id), subAccountId: existing.subAccountId, contactId: id, metadata: { updatedFields: Object.keys(updateData) } });
    res.json(updated);
  }));

  app.delete("/api/contacts/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");

    const existing = await storage.getContactById(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });

    const ownerOk = await verifyAccountOwnership(req, res, existing.subAccountId);
    if (!ownerOk) return;

    const deleted = await storage.deleteContact(id);
    if (!deleted) return res.status(404).json({ error: "Contact not found" });
    emitUniversalEvent({ eventType: "contact_deleted", sourceModule: "crm", sourceTable: "contacts", sourceRecordId: String(id), subAccountId: existing.subAccountId, contactId: id, metadata: { firstName: existing.firstName, lastName: existing.lastName } });
    res.json({ success: true });
  }));

  app.get("/api/pipeline/stages/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const stages = await storage.getPipelineStages(subAccountId);
    res.json(stages);
  }));

  app.post("/api/pipeline/stages", asyncHandler(async (req, res) => {
    const parsed = insertPipelineStageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const stage = await storage.createPipelineStage(parsed.data);
    res.status(201).json(stage);
  }));

  app.patch("/api/pipeline/stages/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const updated = await storage.updatePipelineStage(id, req.body);
    if (!updated) return res.status(404).json({ error: "Stage not found" });
    res.json(updated);
  }));

  app.delete("/api/pipeline/stages/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const deleted = await storage.deletePipelineStage(id);
    if (!deleted) return res.status(404).json({ error: "Stage not found" });
    res.json({ success: true });
  }));

  app.get("/api/deals/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const list = await storage.getDeals(subAccountId);
    res.json(list);
  }));

  app.get("/api/deals/detail/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const deal = await storage.getDealById(id);
    if (!deal) return res.status(404).json({ error: "Deal not found" });
    res.json(deal);
  }));

  app.post("/api/deals", asyncHandler(async (req, res) => {
    const parsed = insertDealSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const deal = await storage.createDeal(parsed.data);
    if (deal.subAccountId) {
      try {
        const { fireAutomationTriggerGlobal } = await import("./v1");
        fireAutomationTriggerGlobal("deal_created", deal.subAccountId, {
          dealId: deal.id,
          dealTitle: deal.title,
          dealValue: deal.value,
          leadName: deal.contactName || "Unknown",
          source: "api",
        });
      } catch (err) { console.warn("[PROPERTY] caught:", err instanceof Error ? err.message : err); }
      emitUniversalEvent({ eventType: INTEL_EVENT_TYPES.DEAL_CREATED, sourceModule: "crm", sourceTable: "deals", sourceRecordId: String(deal.id), subAccountId: deal.subAccountId, contactId: deal.contactId || undefined, metadata: { title: deal.title, value: deal.value, stage: deal.stageId } });
    }
    res.status(201).json(deal);
  }));

  app.patch("/api/deals/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const body = req.body;
    if (body.stageId !== undefined) {
      body.stageId = parseInt(body.stageId, 10);
    }
    const existingDeal = await storage.getDealById(id);
    const updated = await storage.updateDeal(id, body);
    if (!updated) return res.status(404).json({ error: "Deal not found" });
    if (updated.subAccountId) {
      const stageChanged = existingDeal && body.stageId !== undefined && body.stageId !== existingDeal.stageId;
      emitUniversalEvent({ eventType: stageChanged ? INTEL_EVENT_TYPES.DEAL_STAGE_CHANGED : "deal_updated", sourceModule: "crm", sourceTable: "deals", sourceRecordId: String(id), subAccountId: updated.subAccountId, contactId: updated.contactId || undefined, metadata: { title: updated.title, value: updated.value, newStageId: body.stageId, previousStageId: existingDeal?.stageId } });
    }
    res.json(updated);
  }));

  app.delete("/api/deals/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const existingDeal2 = await storage.getDealById(id);
    const deleted = await storage.deleteDeal(id);
    if (!deleted) return res.status(404).json({ error: "Deal not found" });
    if (existingDeal2?.subAccountId) {
      emitUniversalEvent({ eventType: "deal_deleted", sourceModule: "crm", sourceTable: "deals", sourceRecordId: String(id), subAccountId: existingDeal2.subAccountId, contactId: existingDeal2.contactId || undefined, metadata: { title: existingDeal2.title } });
    }
    res.json({ success: true });
  }));

  app.get("/api/appointments/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const list = await storage.getAppointments(subAccountId);
    res.json(list);
  }));

  app.post("/api/appointments", asyncHandler(async (req, res) => {
    const parsed = insertAppointmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const appt = await storage.createAppointment(parsed.data);
    if (appt.subAccountId) {
      import("./v1").then(({ fireAutomationTriggerGlobal }) => {
        fireAutomationTriggerGlobal("appointment_booked", appt.subAccountId!, {
          appointmentTitle: appt.title,
          appointmentTime: appt.startTime,
          contactId: appt.contactId,
        });
      }).catch(e => console.error("[APPOINTMENTS] trigger failed:", e instanceof Error ? e.message : e));
      emitUniversalEvent({ eventType: INTEL_EVENT_TYPES.CALENDAR_BOOKED, sourceModule: "calendar", sourceTable: "appointments", sourceRecordId: String(appt.id), subAccountId: appt.subAccountId, contactId: appt.contactId || undefined, metadata: { title: appt.title, startTime: appt.startTime, endTime: appt.endTime, source: "manual" } });
    }
    res.status(201).json(appt);
  }));

  app.patch("/api/appointments/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const validStatuses = ["scheduled", "completed", "cancelled"];
    if (req.body.status && !validStatuses.includes(req.body.status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }
    const updated = await storage.updateAppointment(id, req.body);
    if (!updated) return res.status(404).json({ error: "Appointment not found" });
    if (updated.subAccountId && req.body.status) {
      const apptEventType = req.body.status === "cancelled" ? INTEL_EVENT_TYPES.CALENDAR_CANCELLED : req.body.status === "completed" ? INTEL_EVENT_TYPES.CALENDAR_COMPLETED : "appointment_updated";
      emitUniversalEvent({ eventType: apptEventType, sourceModule: "calendar", sourceTable: "appointments", sourceRecordId: String(id), subAccountId: updated.subAccountId, contactId: updated.contactId || undefined, metadata: { title: updated.title, status: updated.status, startTime: updated.startTime } });
    }
    res.json(updated);
  }));

  app.delete("/api/appointments/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const deleted = await storage.deleteAppointment(id);
    if (!deleted) return res.status(404).json({ error: "Appointment not found" });
    res.json({ success: true });
  }));

  app.post("/api/calendar/sync/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const calendarId = req.body.calendarId || "primary";
    try {
      const { syncGoogleCalendar } = await import("../googleCalendarSync");
      const result = await syncGoogleCalendar(subAccountId, calendarId);
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("[GCAL-SYNC] Sync failed:", err.message);
      res.status(500).json({ error: err.message || "Calendar sync failed" });
    }
  }));

  app.get("/api/calendar/calendars/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    try {
      const { listCalendars } = await import("../googleCalendarSync");
      const calendars = await listCalendars();
      res.json(calendars);
    } catch (err: any) {
      console.error("[GCAL-SYNC] List calendars failed:", err.message);
      res.status(500).json({ error: err.message || "Failed to list calendars" });
    }
  }));

  // HARDENED: Honest sync status — reflects actual config + last attempt outcome.
  app.get("/api/calendar/sync-status/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { getCalendarSyncStatus } = await import("../googleCalendarSync");
    const status = await getCalendarSyncStatus(subAccountId);
    res.json(status);
  }));

  app.post("/api/calendar/sync-config/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { enabled, calendarId } = req.body || {};
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "`enabled` (boolean) is required" });
    }
    const { setCalendarSyncEnabled } = await import("../googleCalendarSync");
    const status = await setCalendarSyncEnabled(subAccountId, enabled, typeof calendarId === "string" ? calendarId : undefined);
    res.json(status);
  }));

  app.get("/api/email-campaigns/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const list = await storage.getEmailCampaigns(subAccountId);
    res.json(list);
  }));

  app.post("/api/email-campaigns", asyncHandler(async (req, res) => {
    const parsed = insertEmailCampaignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const campaign = await storage.createEmailCampaign(parsed.data);
    res.status(201).json(campaign);
  }));

  app.patch("/api/email-campaigns/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const updated = await storage.updateEmailCampaign(id, req.body);
    if (!updated) return res.status(404).json({ error: "Campaign not found" });
    res.json(updated);
  }));

  app.post("/api/email-campaigns/:id/send", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const campaign = await storage.getEmailCampaignById(id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const mailchimpKey = process.env.MAILCHIMP_API_KEY;
    const hasEmailService = !!mailchimpKey || !!process.env.SENDGRID_API_KEY || !!process.env.MAILGUN_API_KEY || !!process.env.SMTP_HOST;
    if (!hasEmailService) {
      return res.status(503).json({
        error: "Email service not configured",
        message: "To send real emails, add MAILCHIMP_API_KEY, SENDGRID_API_KEY, MAILGUN_API_KEY, or SMTP_HOST to your environment.",
        needsConfig: true,
      });
    }

    const contacts = await storage.getContacts(campaign.subAccountId!);
    const recipientEmails = contacts.filter(c => c.email).map(c => ({ email: c.email!, name: c.firstName || "" }));

    if (recipientEmails.length === 0) {
      return res.status(400).json({ error: "No contacts with email addresses found for this account." });
    }

    let sentCount = 0;
    let sendError: string | null = null;

    if (mailchimpKey) {
      const dc = mailchimpKey.split("-").pop() || "us1";
      const mailchimpBase = `https://${dc}.api.mailchimp.com/3.0`;
      const authHeader = { "Authorization": `Bearer ${mailchimpKey}`, "Content-Type": "application/json" };

      try {
        const listsRes = await fetch(`${mailchimpBase}/lists?count=1`, { headers: authHeader });
        const listsData = await listsRes.json() as any;
        let listId = listsData.lists?.[0]?.id;

        if (!listId) {
          const createListRes = await fetch(`${mailchimpBase}/lists`, {
            method: "POST",
            headers: authHeader,
            body: JSON.stringify({
              name: "Apex Contacts",
              contact: { company: "Apex Marketing", address1: "123 Main St", city: "Orlando", state: "FL", zip: "32801", country: "US" },
              permission_reminder: "You signed up via our platform.",
              campaign_defaults: { from_name: "Apex Marketing", from_email: "noreply@apexmarketingautomations.com", subject: "", language: "en" },
              email_type_option: false,
            }),
          });
          const newList = await createListRes.json() as any;
          listId = newList.id;
        }

        if (listId) {
          const batchMembers = recipientEmails.map(r => ({
            email_address: r.email,
            status: "subscribed",
            merge_fields: { FNAME: r.name },
          }));
          await fetch(`${mailchimpBase}/lists/${listId}`, {
            method: "POST",
            headers: authHeader,
            body: JSON.stringify({ members: batchMembers, update_existing: true }),
          });

          const mcCampaignRes = await fetch(`${mailchimpBase}/campaigns`, {
            method: "POST",
            headers: authHeader,
            body: JSON.stringify({
              type: "regular",
              recipients: { list_id: listId },
              settings: {
                subject_line: campaign.subject || "Update from Apex",
                from_name: "Apex Marketing",
                reply_to: "noreply@apexmarketingautomations.com",
                title: campaign.name || "Campaign",
              },
            }),
          });
          const mcCampaign = await mcCampaignRes.json() as any;

          if (mcCampaign.id) {
            await fetch(`${mailchimpBase}/campaigns/${mcCampaign.id}/content`, {
              method: "PUT",
              headers: authHeader,
              body: JSON.stringify({ html: campaign.body || "<p>No content</p>" }),
            });

            const sendRes = await fetch(`${mailchimpBase}/campaigns/${mcCampaign.id}/actions/send`, {
              method: "POST",
              headers: authHeader,
            });

            if (sendRes.ok || sendRes.status === 204) {
              sentCount = recipientEmails.length;
            } else {
              const errBody = await sendRes.text();
              sendError = `Mailchimp send failed: ${errBody}`;
            }
          } else {
            sendError = `Mailchimp campaign creation failed: ${JSON.stringify(mcCampaign)}`;
          }
        }
      } catch (err: any) {
        sendError = `Mailchimp error: ${err.message}`;
      }
    }

    if (sendError) {
      console.error("[EMAIL]", sendError);
    }

    const updated = await storage.updateEmailCampaign(id, {
      status: sentCount > 0 ? "sent" : "failed",
      sentAt: new Date(),
      sentCount: sentCount,
      recipientCount: recipientEmails.length,
    });
    res.json({ ...updated, sentCount, recipientCount: recipientEmails.length, error: sendError });
  }));

  app.delete("/api/email-campaigns/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const deleted = await storage.deleteEmailCampaign(id);
    if (!deleted) return res.status(404).json({ error: "Campaign not found" });
    res.json({ success: true });
  }));

  function validateWebhookUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return "URL must use HTTPS protocol";
      if (!parsed.hostname || parsed.hostname === "localhost") return "URL must have a valid public hostname";
      const hostname = parsed.hostname;
      if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|169\.254\.)/.test(hostname)) return "Private/internal IP addresses are not allowed";
      if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return "Internal hostnames are not allowed";
      return null;
    } catch (err) {
      console.warn("[PROPERTY] caught:", err instanceof Error ? err.message : err);
      return "Invalid URL format";
    }
  }

  app.get("/api/webhooks/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const list = await storage.getWebhooks(subAccountId);
    res.json(list);
  }));

  app.get("/api/webhooks/:webhookId/deliveries", asyncHandler(async (req, res) => {
    const webhookId = parseIntParam(req.params.webhookId, "webhookId");
    const webhook = await storage.getWebhookById(webhookId);
    if (!webhook) return res.status(404).json({ error: "Webhook not found" });
    if (!(await verifyAccountOwnership(req, res, webhook.subAccountId))) return;
    const logs = await storage.getWebhookDeliveryLogs(webhookId, 20);
    res.json(logs);
  }));

  app.post("/api/webhooks", asyncHandler(async (req, res) => {
    const parsed = insertWebhookSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const urlError = validateWebhookUrl(parsed.data.url);
    if (urlError) return res.status(400).json({ error: urlError });
    if (!(await verifyAccountOwnership(req, res, parsed.data.subAccountId))) return;
    const data = { ...parsed.data, secret: crypto.randomBytes(32).toString("hex") };
    const webhook = await storage.createWebhook(data);
    res.status(201).json(webhook);
  }));

  app.patch("/api/webhooks/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const webhook = await storage.getWebhookById(id);
    if (!webhook) return res.status(404).json({ error: "Webhook not found" });
    if (!(await verifyAccountOwnership(req, res, webhook.subAccountId))) return;
    const { subAccountId, id: _id, createdAt, ...mutableFields } = req.body;
    if (mutableFields.url) {
      const urlError = validateWebhookUrl(mutableFields.url);
      if (urlError) return res.status(400).json({ error: urlError });
    }
    const updated = await storage.updateWebhook(id, mutableFields);
    if (!updated) return res.status(404).json({ error: "Webhook not found" });
    res.json(updated);
  }));

  app.delete("/api/webhooks/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const webhook = await storage.getWebhookById(id);
    if (!webhook) return res.status(404).json({ error: "Webhook not found" });
    if (!(await verifyAccountOwnership(req, res, webhook.subAccountId))) return;
    const deleted = await storage.deleteWebhook(id);
    if (!deleted) return res.status(404).json({ error: "Webhook not found" });
    res.json({ success: true });
  }));

  app.post("/api/webhooks/test/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const webhook = await storage.getWebhookById(id);
    if (!webhook) return res.status(404).json({ error: "Webhook not found" });
    if (!(await verifyAccountOwnership(req, res, webhook.subAccountId))) return;

    const { dispatchWebhook } = await import("../webhookDispatcher");
    const testPayload = { event: "test", timestamp: new Date().toISOString(), webhookId: id };
    const result = await dispatchWebhook(id, webhook.subAccountId, webhook.url, "test", testPayload, webhook.secret);

    res.json({
      success: result.success,
      statusCode: result.statusCode,
      latencyMs: result.latencyMs,
      responseBody: result.responseBody,
      error: result.errorMessage,
    });
  }));

  app.get("/api/white-label/:userId", asyncHandler(async (req, res) => {
    const userId = req.params.userId as string;
    const settings = await storage.getWhiteLabelSettings(userId);
    if (!settings) return res.json(null);
    res.json(settings);
  }));

  app.put("/api/white-label", subscriptionGuard, asyncHandler(async (req, res) => {
    const parsed = insertWhiteLabelSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const settings = await storage.upsertWhiteLabelSettings(parsed.data);
    res.json(settings);
  }));

  app.get("/api/analytics/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const messagesByDay = await db.execute(sql`
      SELECT DATE(created_at) as date, COUNT(*)::int as count
      FROM messages
      WHERE sub_account_id = ${subAccountId} AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at) ORDER BY date
    `);

    const messagesByChannel = await db.execute(sql`
      SELECT channel, COUNT(*)::int as count
      FROM messages
      WHERE sub_account_id = ${subAccountId}
      GROUP BY channel
    `);

    const dealsByStage = await db.execute(sql`
      SELECT ps.name as stage, COUNT(d.id)::int as count
      FROM pipeline_stages ps
      LEFT JOIN deals d ON d.stage_id = ps.id
      WHERE ps.sub_account_id = ${subAccountId}
      GROUP BY ps.name, ps.position ORDER BY ps.position
    `);

    const revenueByMonth = await db.execute(sql`
      SELECT TO_CHAR(created_at, 'YYYY-MM') as month, SUM(COALESCE(value, 0))::real as revenue
      FROM deals
      WHERE sub_account_id = ${subAccountId}
      GROUP BY TO_CHAR(created_at, 'YYYY-MM') ORDER BY month
    `);

    const totalContacts = await db.execute(sql`SELECT COUNT(*)::int as count FROM contacts WHERE sub_account_id = ${subAccountId}`);
    const totalDeals = await db.execute(sql`SELECT COUNT(*)::int as count FROM deals WHERE sub_account_id = ${subAccountId}`);
    const totalMessages = await db.execute(sql`SELECT COUNT(*)::int as count FROM messages WHERE sub_account_id = ${subAccountId}`);
    const totalAppointments = await db.execute(sql`SELECT COUNT(*)::int as count FROM appointments WHERE sub_account_id = ${subAccountId}`);

    res.json({
      messagesByDay: messagesByDay.rows,
      messagesByChannel: messagesByChannel.rows,
      dealsByStage: dealsByStage.rows,
      revenueByMonth: revenueByMonth.rows,
      totalContacts: totalContacts.rows[0]?.count || 0,
      totalDeals: totalDeals.rows[0]?.count || 0,
      totalMessages: totalMessages.rows[0]?.count || 0,
      totalAppointments: totalAppointments.rows[0]?.count || 0,
    });
  }));

  app.get("/api/reports/export/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const type = (req.query.type as string) || "contacts";

    let csvContent = "";

    if (type === "contacts") {
      const data = await storage.getContacts(subAccountId);
      csvContent = "ID,First Name,Last Name,Email,Phone,Company,Source,Created At\n";
      for (const r of data) {
        csvContent += `${r.id},"${r.firstName || ""}","${r.lastName || ""}","${r.email || ""}","${r.phone || ""}","${r.company || ""}","${r.source || ""}","${r.createdAt}"\n`;
      }
    } else if (type === "deals") {
      const data = await storage.getDeals(subAccountId);
      csvContent = "ID,Title,Value,Status,Stage ID,Created At\n";
      for (const r of data) {
        csvContent += `${r.id},"${r.title || ""}",${r.value || 0},"${r.status || ""}",${r.stageId},"${r.createdAt}"\n`;
      }
    } else if (type === "messages") {
      const data = await storage.getMessages(subAccountId);
      csvContent = "ID,Direction,Body,Status,Channel,Contact Phone,Created At\n";
      for (const r of data) {
        csvContent += `${r.id},"${r.direction}","${(r.body || "").replace(/"/g, '""')}","${r.status}","${r.channel}","${r.contactPhone}","${r.createdAt}"\n`;
      }
    } else {
      return res.status(400).json({ error: "Invalid type. Must be contacts, deals, or messages" });
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${type}-export-${subAccountId}.csv"`);
    res.send(csvContent);
  }));
}