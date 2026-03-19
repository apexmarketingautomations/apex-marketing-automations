import type { Express, Request, Response } from "express";
import { contacts, deals, messages, subAccounts, sentinelIncidents, propertyLeads } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { z } from "zod";
import { isAIConfigured } from "../ai";
import { ProgressStream } from "../streaming";
import {  } from "../eventBus";
import { eventBus } from "../eventBus";
import { jobQueue } from "../jobQueue";
import crypto from "crypto";
import { asyncHandler, parseIntParam, getUserId, verifyAccountOwnership, isUserAdmin, requireAdmin } from "./helpers";

export function registerAnalyticsRoutes(app: Express) {
  // ---- Dashboard Analytics ----
  app.get("/api/analytics/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const [allMessages, allContacts, allDeals, allAppts, allCampaigns, allMetaAds, allMetaLeads, allIncidents, allWebhookEvts] = await Promise.all([
      storage.getMessages(subAccountId),
      storage.getContacts(subAccountId),
      storage.getDeals(subAccountId),
      storage.getAppointments(subAccountId),
      storage.getEmailCampaigns(subAccountId),
      storage.getMetaAdCampaigns(subAccountId),
      storage.getMetaLeads(subAccountId),
      storage.getSentinelIncidents(subAccountId),
      storage.getWebhookEvents(subAccountId),
    ]);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const dailyLeads: Record<string, number> = {};
    const dailyMessages: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyLeads[key] = 0;
      dailyMessages[key] = 0;
    }
    allContacts.forEach(c => {
      const key = new Date(c.createdAt).toISOString().slice(0, 10);
      if (dailyLeads[key] !== undefined) dailyLeads[key]++;
    });
    allMessages.forEach(m => {
      const key = new Date(m.createdAt).toISOString().slice(0, 10);
      if (dailyMessages[key] !== undefined) dailyMessages[key]++;
    });

    const wonDeals = allDeals.filter(d => d.status === "won");
    const totalRevenue = wonDeals.reduce((s, d) => s + (d.value || 0), 0);
    const conversionRate = allDeals.length > 0 ? (wonDeals.length / allDeals.length) * 100 : 0;

    const totalAdSpend = allMetaAds.reduce((s, a) => s + (a.totalSpend || 0), 0);
    const totalAdLeads = allMetaAds.reduce((s, a) => s + (a.leads || 0), 0);
    const costPerLead = totalAdLeads > 0 ? totalAdSpend / totalAdLeads : 0;
    const totalImpressions = allMetaAds.reduce((s, a) => s + (a.impressions || 0), 0);
    const totalClicks = allMetaAds.reduce((s, a) => s + (a.clicks || 0), 0);
    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

    res.json({
      overview: {
        totalLeads: allContacts.length,
        totalMessages: allMessages.length,
        totalDeals: allDeals.length,
        totalRevenue,
        conversionRate: Math.round(conversionRate * 10) / 10,
        avgResponseTime: "< 2 min",
        activeWorkflows: 0,
        sentinelIncidents: allIncidents.length,
      },
      charts: {
        dailyLeads: Object.entries(dailyLeads).map(([date, count]) => ({ date, count })),
        dailyMessages: Object.entries(dailyMessages).map(([date, count]) => ({ date, count })),
      },
      adPerformance: {
        totalSpend: totalAdSpend,
        totalLeads: totalAdLeads,
        costPerLead: Math.round(costPerLead * 100) / 100,
        impressions: totalImpressions,
        clicks: totalClicks,
        ctr: Math.round(avgCtr * 100) / 100,
      },
      pipeline: {
        openDeals: allDeals.filter(d => d.status === "open").length,
        wonDeals: wonDeals.length,
        lostDeals: allDeals.filter(d => d.status === "lost").length,
        totalPipelineValue: allDeals.filter(d => d.status === "open").reduce((s, d) => s + (d.value || 0), 0),
      },
    });
  }));

  // ─── ADMIN COMMAND CONSOLE API ──────────────────────────────────────

  app.get("/api/admin/global-stats", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const accountsResult = await db.execute(sql`SELECT COUNT(*) as count FROM sub_accounts`);
    const usersResult = await db.execute(sql`SELECT COUNT(*) as count FROM users`);
    const leadsResult = await db.execute(sql`SELECT COUNT(*) as count FROM meta_leads`);
    const contactsResult = await db.execute(sql`SELECT COUNT(*) as count FROM contacts`);
    const messagesResult = await db.execute(sql`SELECT COUNT(*) as count FROM messages`);
    const incidentsResult = await db.execute(sql`SELECT COUNT(*) as count FROM sentinel_incidents`);
    const dispatchSubsResult = await db.execute(sql`SELECT COUNT(*) as count FROM dispatch_subscribers WHERE active = true`);
    const dealsResult = await db.execute(sql`SELECT COUNT(*) as count, COALESCE(SUM(CAST(value AS real)), 0) as total_value FROM deals`);

    const row = (r: any) => (Array.isArray(r) ? r[0] : r?.rows?.[0] ?? {});

    res.json({
      totalAccounts: Number(row(accountsResult)?.count ?? 0),
      totalUsers: Number(row(usersResult)?.count ?? 0),
      totalLeads: Number(row(leadsResult)?.count ?? 0),
      totalContacts: Number(row(contactsResult)?.count ?? 0),
      totalMessages: Number(row(messagesResult)?.count ?? 0),
      totalIncidents: Number(row(incidentsResult)?.count ?? 0),
      activeDispatchSubscribers: Number(row(dispatchSubsResult)?.count ?? 0),
      totalDeals: Number(row(dealsResult)?.count ?? 0),
      totalDealValue: Number(row(dealsResult)?.total_value ?? 0),
      sentinelStatus: "RUNNING",
    });
  }));

  app.get("/api/admin/master-feed", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const rows = (r: any) => (Array.isArray(r) ? r : r?.rows ?? []);

    const leads = await db.execute(sql`
      SELECT ml.id, ml.name, ml.email, ml.phone, ml.created_at as timestamp,
             ml.sub_account_id, sa.name as account_name,
             'meta_lead' as category
      FROM meta_leads ml
      LEFT JOIN sub_accounts sa ON ml.sub_account_id = sa.id
      ORDER BY ml.created_at DESC
      LIMIT ${limit}
    `);

    const incidents = await db.execute(sql`
      SELECT si.id, si.title as name, si.location, si.severity, si.detected_at as timestamp,
             si.action_status, si.sub_account_id, sa.name as account_name,
             'sentinel_incident' as category
      FROM sentinel_incidents si
      LEFT JOIN sub_accounts sa ON si.sub_account_id = sa.id
      ORDER BY si.detected_at DESC
      LIMIT ${limit}
    `);

    const contacts = await db.execute(sql`
      SELECT c.id, c.name, c.email, c.phone, c.created_at as timestamp,
             c.sub_account_id, sa.name as account_name,
             'contact' as category
      FROM contacts c
      LEFT JOIN sub_accounts sa ON c.sub_account_id = sa.id
      ORDER BY c.created_at DESC
      LIMIT ${limit}
    `);

    const allItems = [
      ...rows(leads),
      ...rows(incidents),
      ...rows(contacts),
    ].sort((a: any, b: any) => {
      const dateA = new Date(a.timestamp || 0).getTime();
      const dateB = new Date(b.timestamp || 0).getTime();
      return dateB - dateA;
    }).slice(0, limit);

    res.json(allItems);
  }));

  app.get("/api/admin/accounts-overview", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const result = await db.execute(sql`
      SELECT sa.id, sa.name, sa.industry, sa.plan, sa.twilio_number, sa.owner_user_id,
        (SELECT COUNT(*) FROM contacts c WHERE c.sub_account_id = sa.id) as contact_count,
        (SELECT COUNT(*) FROM messages m WHERE m.sub_account_id = sa.id) as message_count,
        (SELECT COUNT(*) FROM meta_leads ml WHERE ml.sub_account_id = sa.id) as lead_count
      FROM sub_accounts sa
      ORDER BY sa.id DESC
    `);
    const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
    res.json(rows);
  }));

  // ─── GEO DISPATCH SYSTEM ────────────────────────────────────────────

  // Rate limiter: tracks request counts per IP
  const dispatchRateLimiter = new Map<string, { count: number; resetAt: number }>();
  const DISPATCH_RATE_LIMIT = 60; // max requests per window
  const DISPATCH_RATE_WINDOW_MS = 60 * 1000; // 1 minute window
  const DISPATCH_MAX_PAYLOAD_BYTES = 50 * 1024; // 50KB max payload

  function checkDispatchRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = dispatchRateLimiter.get(ip);
    if (!entry || now > entry.resetAt) {
      dispatchRateLimiter.set(ip, { count: 1, resetAt: now + DISPATCH_RATE_WINDOW_MS });
      return true;
    }
    if (entry.count >= DISPATCH_RATE_LIMIT) return false;
    entry.count++;
    return true;
  }

  // Clean up stale rate limit entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    dispatchRateLimiter.forEach((entry, ip) => {
      if (now > entry.resetAt) dispatchRateLimiter.delete(ip);
    });
  }, 5 * 60 * 1000);

  // Validate webhook URL: block private/internal IPs
  function isPrivateUrl(urlStr: string): boolean {
    try {
      const url = new URL(urlStr);
      const hostname = url.hostname;
      // Block localhost and common private ranges
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") return true;
      if (hostname === "::1" || hostname === "[::1]") return true;
      if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return true;
      // Block private IP ranges
      const parts = hostname.split(".").map(Number);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        if (parts[0] === 10) return true;
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        if (parts[0] === 192 && parts[1] === 168) return true;
        if (parts[0] === 169 && parts[1] === 254) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  // Generate HMAC signature for webhook delivery
  function signWebhookPayload(secret: string, payload: string): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
  }

  interface GeoResult {
    lat: number;
    lng: number;
    formattedAddress: string;
    city: string;
    state: string;
    zip: string;
    status: "success" | "failed";
  }

  async function geocodeAddress(address: string): Promise<GeoResult | null> {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return null;
    try {
      const gmRes = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address.trim())}&key=${apiKey}`
      );
      const data = await gmRes.json() as any;
      if (data.status !== "OK" || !data.results?.length) return null;
      const r = data.results[0];
      const comp = (type: string) => {
        const c = r.address_components?.find((ac: any) => ac.types?.includes(type));
        return c?.long_name || c?.short_name || "";
      };
      return {
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        formattedAddress: r.formatted_address,
        city: comp("locality") || comp("sublocality") || comp("administrative_area_level_2"),
        state: r.address_components?.find((ac: any) => ac.types?.includes("administrative_area_level_1"))?.short_name || "",
        zip: comp("postal_code"),
        status: "success",
      };
    } catch (err) {
      console.error("[GEOCODE] Error:", err);
      return null;
    }
  }

  function haversineDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3958.8;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  app.get("/api/geocode", asyncHandler(async (req: Request, res: Response) => {
    const address = req.query.address as string;
    if (!address || address.trim().length < 3) {
      return res.status(400).json({ error: "Address parameter is required (min 3 characters)" });
    }
    const result = await geocodeAddress(address);
    if (!result) return res.status(404).json({ error: "Could not geocode address" });
    res.json(result);
  }));

  app.post("/api/geocode", asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.body;
    if (!address || typeof address !== "string" || address.trim().length < 3) {
      return res.status(400).json({ error: "Address is required (min 3 characters)" });
    }
    const result = await geocodeAddress(address);
    if (!result) return res.status(404).json({ error: "Could not geocode address" });
    res.json(result);
  }));

  app.get("/api/location-search", asyncHandler(async (req: Request, res: Response) => {
    const {
      type,
      lat: latStr,
      lng: lngStr,
      radius: radiusStr,
      city,
      zip,
      state: stateFilter,
      status,
      address,
      q,
    } = req.query as Record<string, string | undefined>;

    const user = (req as any).user;
    const userId = getUserId(user);
    const isAdmin = isUserAdmin(user);

    let searchLat: number | null = latStr ? parseFloat(latStr) : null;
    let searchLng: number | null = lngStr ? parseFloat(lngStr) : null;
    const radiusMiles = radiusStr ? parseFloat(radiusStr) : 25;

    if (address && (!searchLat || !searchLng)) {
      const geo = await geocodeAddress(address);
      if (geo) {
        searchLat = geo.lat;
        searchLng = geo.lng;
      }
    }

    const accountIds: number[] = [];
    if (isAdmin) {
      const allAccounts = await db.select({ id: subAccounts.id }).from(subAccounts);
      accountIds.push(...allAccounts.map(a => a.id));
    } else {
      const userAccounts = await db.select({ id: subAccounts.id }).from(subAccounts)
        .where(eq(subAccounts.ownerUserId, userId));
      accountIds.push(...userAccounts.map(a => a.id));
    }

    if (accountIds.length === 0) {
      return res.json({ count: 0, results: [], center: searchLat && searchLng ? { lat: searchLat, lng: searchLng } : null });
    }

    const results: any[] = [];
    const searchTypes = type && type !== "all" ? [type] : ["contact", "lead", "crash", "business"];

    for (const t of searchTypes) {
      if (t === "contact") {
        const rows = await db.select().from(contacts)
          .where(sql`${contacts.subAccountId} = ANY(${accountIds})`);
        for (const r of rows) {
          if (city && r.city?.toLowerCase() !== city.toLowerCase()) continue;
          if (zip && r.zip !== zip) continue;
          if (stateFilter && r.state?.toLowerCase() !== stateFilter.toLowerCase()) continue;
          if (q && !`${r.firstName} ${r.lastName} ${r.company || ""}`.toLowerCase().includes(q.toLowerCase())) continue;

          let distance: number | null = null;
          if (searchLat != null && searchLng != null && r.lat != null && r.lng != null) {
            distance = haversineDistanceMiles(searchLat, searchLng, r.lat, r.lng);
            if (distance > radiusMiles) continue;
          } else if (searchLat != null && searchLng != null && r.lat == null) {
            continue;
          }

          results.push({
            id: r.id,
            type: "contact",
            name: `${r.firstName} ${r.lastName || ""}`.trim(),
            formattedAddress: r.formattedAddress || r.address || "",
            city: r.city,
            state: r.state,
            zip: r.zip,
            lat: r.lat,
            lng: r.lng,
            distance: distance != null ? Math.round(distance * 10) / 10 : null,
            status: r.source,
            subAccountId: r.subAccountId,
          });
        }
      }

      if (t === "lead") {
        const rows = await db.select().from(propertyLeads)
          .where(sql`${propertyLeads.subAccountId} = ANY(${accountIds})`);
        for (const r of rows) {
          if (city && r.city?.toLowerCase() !== city.toLowerCase()) continue;
          if (zip && r.zip !== zip) continue;
          if (stateFilter && r.state?.toLowerCase() !== stateFilter.toLowerCase()) continue;
          if (status && r.pipelineStage !== status) continue;
          if (q && !`${r.ownerName || ""} ${r.address}`.toLowerCase().includes(q.toLowerCase())) continue;

          let distance: number | null = null;
          if (searchLat != null && searchLng != null && r.lat != null && r.lng != null) {
            distance = haversineDistanceMiles(searchLat, searchLng, r.lat, r.lng);
            if (distance > radiusMiles) continue;
          } else if (searchLat != null && searchLng != null && r.lat == null) {
            continue;
          }

          results.push({
            id: r.id,
            type: "lead",
            name: r.ownerName || r.address,
            formattedAddress: r.address || "",
            city: r.city,
            state: r.state,
            zip: r.zip,
            lat: r.lat,
            lng: r.lng,
            distance: distance != null ? Math.round(distance * 10) / 10 : null,
            status: r.pipelineStage,
            subAccountId: r.subAccountId,
          });
        }
      }

      if (t === "crash") {
        const rows = await db.select().from(sentinelIncidents)
          .where(sql`${sentinelIncidents.subAccountId} = ANY(${accountIds})`);
        for (const r of rows) {
          if (city && r.city?.toLowerCase() !== city.toLowerCase()) continue;
          if (zip && r.zip !== zip) continue;
          if (stateFilter && r.state?.toLowerCase() !== stateFilter.toLowerCase()) continue;
          if (status && r.actionStatus !== status) continue;
          if (q && !`${r.title} ${r.location || ""}`.toLowerCase().includes(q.toLowerCase())) continue;

          let distance: number | null = null;
          if (searchLat != null && searchLng != null && r.lat != null && r.lng != null) {
            distance = haversineDistanceMiles(searchLat, searchLng, r.lat, r.lng);
            if (distance > radiusMiles) continue;
          } else if (searchLat != null && searchLng != null && r.lat == null) {
            continue;
          }

          results.push({
            id: r.id,
            type: "crash",
            name: r.title,
            formattedAddress: r.formattedAddress || r.location || "",
            city: r.city,
            state: r.state,
            zip: r.zip,
            lat: r.lat,
            lng: r.lng,
            distance: distance != null ? Math.round(distance * 10) / 10 : null,
            status: r.actionStatus,
            subAccountId: r.subAccountId,
          });
        }
      }

      if (t === "business") {
        const rows = await db.select().from(subAccounts)
          .where(sql`${subAccounts.id} = ANY(${accountIds})`);
        for (const r of rows) {
          if (city && r.city?.toLowerCase() !== city.toLowerCase()) continue;
          if (zip && r.zip !== zip) continue;
          if (stateFilter && r.state?.toLowerCase() !== stateFilter.toLowerCase()) continue;
          if (q && !r.name.toLowerCase().includes(q.toLowerCase())) continue;

          let distance: number | null = null;
          if (searchLat != null && searchLng != null && r.lat != null && r.lng != null) {
            distance = haversineDistanceMiles(searchLat, searchLng, r.lat, r.lng);
            if (distance > radiusMiles) continue;
          } else if (searchLat != null && searchLng != null && r.lat == null) {
            continue;
          }

          results.push({
            id: r.id,
            type: "business",
            name: r.name,
            formattedAddress: r.formattedAddress || r.address || "",
            city: r.city,
            state: r.state,
            zip: r.zip,
            lat: r.lat,
            lng: r.lng,
            distance: distance != null ? Math.round(distance * 10) / 10 : null,
            status: r.industry,
            subAccountId: r.id,
          });
        }
      }
    }

    results.sort((a, b) => {
      if (a.distance != null && b.distance != null) return a.distance - b.distance;
      if (a.distance != null) return -1;
      if (b.distance != null) return 1;
      return 0;
    });

    res.json({
      count: results.length,
      results,
      center: searchLat != null && searchLng != null ? { lat: searchLat, lng: searchLng } : null,
    });
  }));

  async function geocodeZip(zip: string): Promise<{ lat: number; lon: number } | null> {
    try {
      const resp = await fetch(`https://api.zippopotam.us/us/${zip}`);
      if (!resp.ok) return null;
      const data = await resp.json() as any;
      if (data.places && data.places.length > 0) {
        return {
          lat: parseFloat(data.places[0].latitude),
          lon: parseFloat(data.places[0].longitude),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  app.post("/api/v1/dispatch/subscribers", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({
      email: z.string().email(),
      occupation: z.string().optional(),
      target_zip: z.string().min(3),
      target_radius: z.number().positive().default(80467),
      webhook_url: z.string().url(),
      lat: z.number().optional(),
      lon: z.number().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    if (isPrivateUrl(parsed.data.webhook_url)) {
      return res.status(400).json({ error: "Webhook URL cannot point to private/internal addresses" });
    }

    let { lat, lon } = parsed.data;
    if (!lat || !lon) {
      const geo = await geocodeZip(parsed.data.target_zip);
      if (!geo) return res.status(400).json({ error: `Could not geocode ZIP: ${parsed.data.target_zip}` });
      lat = geo.lat;
      lon = geo.lon;
    }

    const webhookSecret = crypto.randomBytes(32).toString("hex");

    const subscriber = await storage.createDispatchSubscriber({
      email: parsed.data.email,
      occupation: parsed.data.occupation || null,
      targetZip: parsed.data.target_zip,
      targetRadiusMeters: parsed.data.target_radius,
      webhookUrl: parsed.data.webhook_url,
      webhookSecret,
      lat,
      lon,
      active: true,
    });

    res.status(201).json({
      id: subscriber.id,
      email: subscriber.email,
      target_zip: subscriber.targetZip,
      target_radius_meters: subscriber.targetRadiusMeters,
      lat: subscriber.lat,
      lon: subscriber.lon,
      webhook_secret: webhookSecret,
      status: "active",
    });
  }));

  app.get("/api/v1/dispatch/subscribers", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const subs = await storage.getDispatchSubscribers();
    res.json(subs);
  }));

  app.delete("/api/v1/dispatch/subscribers/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const deleted = await storage.deleteDispatchSubscriber(id);
    if (!deleted) return res.status(404).json({ error: "Subscriber not found" });
    res.json({ status: "deleted" });
  }));

  app.post("/api/v1/dispatch", asyncHandler(async (req: Request, res: Response) => {
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    if (!checkDispatchRateLimit(clientIp)) {
      return res.status(429).json({ error: "Rate limit exceeded. Max 60 requests per minute." });
    }

    const bodySize = JSON.stringify(req.body).length;
    if (bodySize > DISPATCH_MAX_PAYLOAD_BYTES) {
      return res.status(413).json({ error: `Payload too large. Max ${DISPATCH_MAX_PAYLOAD_BYTES / 1024}KB.` });
    }

    const schema = z.object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      type: z.string().max(100).optional(),
      payload: z.any().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { lat, lon } = parsed.data;
    const eventPayload = { ...req.body, dispatched_at: new Date().toISOString() };

    const subscribers = await storage.findSubscribersNear(lat, lon);
    console.log(`[DISPATCH] Event at ${lat},${lon} — ${subscribers.length} subscriber(s) in range`);

    const results: Array<{ subscriber_id: number; email: string; status: string; distance_meters?: number }> = [];

    for (const sub of subscribers) {
      const webhookUrl = sub.webhookUrl || (sub as any).webhook_url;
      const webhookSecret = sub.webhookSecret || (sub as any).webhook_secret;
      const bodyStr = JSON.stringify({
        event: eventPayload,
        subscriber: {
          id: sub.id,
          email: sub.email,
          occupation: sub.occupation || (sub as any).occupation,
        },
      });
      const signature = signWebhookPayload(webhookSecret, bodyStr);

      try {
        const resp = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Dispatch-Signature": `sha256=${signature}`,
            "X-Dispatch-Timestamp": new Date().toISOString(),
          },
          body: bodyStr,
        });
        results.push({
          subscriber_id: sub.id,
          email: sub.email,
          status: resp.ok ? "delivered" : `failed:${resp.status}`,
          distance_meters: (sub as any).distance_meters,
        });
      } catch (err: any) {
        results.push({
          subscriber_id: sub.id,
          email: sub.email,
          status: `error:${err.message}`,
        });
      }
    }

    res.json({
      dispatched: results.length,
      results,
    });
  }));

  // ──── SYSTEM HEALTH ENDPOINT ────
  app.get("/api/system/health", asyncHandler(async (_req, res) => {
    const health: Record<string, string> = {};

    try {
      await db.execute(sql`SELECT 1`);
      health.database = "ok";
    } catch {
      health.database = "error";
    }

    health.stripe = (process.env.STRIPE_API_SECRET || process.env.STRIPE_SECRET_KEY) ? "ok" : "missing";
    health.twilio = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) ? "ok" : "missing";
    health.ai = isAIConfigured() ? "ok" : "missing";
    health.meta = (process.env.META_ACCESS_TOKEN && process.env.META_PAGE_ID) ? "ok" : "missing";
    health.mailchimp = process.env.MAILCHIMP_API_KEY ? "ok" : "missing";

    const allOk = Object.values(health).every(v => v === "ok");
    res.status(allOk ? 200 : 207).json({ status: allOk ? "healthy" : "degraded", services: health });
  }));

  // ──── SYSTEM LOGS (admin only) ────
  app.get("/api/admin/system-logs", requireAdmin, asyncHandler(async (req, res) => {
    const { getSystemLogs } = await import("../systemLogger");
    const severity = req.query.severity as string | undefined;
    const module = req.query.module as string | undefined;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const since = req.query.since ? new Date(req.query.since as string) : undefined;
    const logs = await getSystemLogs({ severity, module, limit, offset, since });
    res.json(logs);
  }));

  // ──── FEATURE FLAGS (admin only) ────
  app.get("/api/admin/feature-flags", requireAdmin, asyncHandler(async (_req, res) => {
    const { getAllFeatureFlags } = await import("../featureFlags");
    const flags = await getAllFeatureFlags();
    res.json(flags);
  }));

  app.put("/api/admin/feature-flags/:name", requireAdmin, asyncHandler(async (req, res) => {
    const { setFeatureFlag } = await import("../featureFlags");
    const { enabled, description } = req.body;
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be a boolean" });
    await setFeatureFlag(req.params.name, enabled, description);
    res.json({ success: true, featureName: req.params.name, enabled });
  }));

  // ──── PLAN LIMITS & USAGE CHECK ────
  app.get("/api/accounts/:accountId/usage-limits", asyncHandler(async (req, res) => {
    const accountId = parseInt(req.params.accountId);
    const user = (req as any).user;
    const userId = getUserId(user);

    if (!isUserAdmin(user)) {
      const allowed = await verifyAccountOwnership(req, res, accountId);
      if (!allowed) return;
    }

    const { checkPlanLimit } = await import("../subscriptionGuard");
    const sub = await storage.getSubscription(userId);
    const plan = sub?.planTier || "starter";

    const { PLAN_LIMITS } = await import("@shared/schema");
    const limits = PLAN_LIMITS[plan.toLowerCase()] || PLAN_LIMITS.starter;

    const usage: Record<string, any> = {};
    for (const metric of Object.keys(limits)) {
      usage[metric] = await checkPlanLimit(accountId, metric, plan);
    }

    res.json({ plan, usage });
  }));

  // ──── STRIPE BILLING PORTAL ────
  app.post("/api/billing/portal", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const userId = getUserId(user);
    const sub = await storage.getSubscription(userId);
    if (!sub?.stripeCustomerId) {
      return res.status(404).json({ error: "No billing account found" });
    }

    const stripeKey = process.env.STRIPE_API_SECRET || process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(503).json({ error: "Stripe not configured" });

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" as any });

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: domain ? `https://${domain}/settings/billing` : undefined,
    });

    res.json({ url: session.url });
  }));

  // ──── SUBSCRIPTION STATUS ────
  app.get("/api/billing/status", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const userId = getUserId(user);
    const sub = await storage.getSubscription(userId);

    if (!sub) {
      return res.json({
        status: "none",
        plan: "free",
        message: "No active subscription",
      });
    }

    res.json({
      status: sub.status,
      plan: sub.planTier,
      paymentStatus: sub.paymentStatus,
      currentPeriodEnd: sub.currentPeriodEnd,
      trialEnd: sub.trialEnd,
      isGrandfathered: sub.isGrandfathered,
      billingInterval: sub.billingInterval,
    });
  }));

  // ──── UPGRADE / DOWNGRADE ────
  app.post("/api/billing/change-plan", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const userId = getUserId(user);
    const { priceId, planTier } = req.body;
    if (!priceId || !planTier) return res.status(400).json({ error: "priceId and planTier required" });

    const VALID_PLANS = ["starter", "pro", "enterprise"];
    const normalizedPlan = planTier.toLowerCase();
    if (!VALID_PLANS.includes(normalizedPlan)) {
      return res.status(400).json({ error: `Invalid plan. Must be one of: ${VALID_PLANS.join(", ")}` });
    }

    const sub = await storage.getSubscription(userId);
    if (!sub?.stripeSubscriptionId) {
      return res.status(404).json({ error: "No active subscription to change" });
    }

    const stripeKey = process.env.STRIPE_API_SECRET || process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(503).json({ error: "Stripe not configured" });

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" as any });

    const currentSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const currentItemId = currentSub.items.data[0]?.id;
    if (!currentItemId) return res.status(400).json({ error: "No subscription item found" });

    const currentPlan = (sub.planTier || "starter").toLowerCase();
    const planOrder = ["starter", "pro", "enterprise"];
    const isUpgrade = planOrder.indexOf(normalizedPlan) > planOrder.indexOf(currentPlan);

    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: currentItemId, price: priceId }],
      proration_behavior: isUpgrade ? "always_invoice" : "none",
      ...(isUpgrade ? {} : { billing_cycle_anchor: "unchanged" }),
    });

    if (isUpgrade) {
      await storage.updateSubscription(sub.id, { planTier: normalizedPlan });
    }

    res.json({
      success: true,
      type: isUpgrade ? "upgrade" : "downgrade",
      plan: normalizedPlan,
      message: isUpgrade
        ? `Upgraded to ${normalizedPlan}. Changes applied immediately.`
        : `Downgrade to ${normalizedPlan} will take effect at next billing cycle.`,
    });
  }));

  // ──── CANCEL SUBSCRIPTION ────
  app.post("/api/billing/cancel", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const userId = getUserId(user);
    const sub = await storage.getSubscription(userId);
    if (!sub?.stripeSubscriptionId) {
      return res.status(404).json({ error: "No active subscription to cancel" });
    }

    const stripeKey = process.env.STRIPE_API_SECRET || process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(503).json({ error: "Stripe not configured" });

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" as any });

    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    res.json({
      success: true,
      message: "Subscription will cancel at the end of the current billing period.",
      currentPeriodEnd: sub.currentPeriodEnd,
    });
  }));

  // ──── AUDIT TRAIL (admin only) ────
  app.get("/api/admin/audit-logs", requireAdmin, asyncHandler(async (req, res) => {
    const { getAuditLogs } = await import("../auditTrail");
    const action = req.query.action as string | undefined;
    const performedBy = req.query.performedBy as string | undefined;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const since = req.query.since ? new Date(req.query.since as string) : undefined;
    const logs = await getAuditLogs({ action, performedBy, limit, offset, since });
    res.json(logs);
  }));

  // ──── APEX OPERATOR ────
  app.post("/api/operator/command", asyncHandler(async (req, res) => {
    const { intent, subAccountId } = req.body;
    if (!intent || !subAccountId) return res.status(400).json({ error: "Missing intent or subAccountId" });

    if (!(await verifyAccountOwnership(req, res, parseInt(subAccountId)))) return;
    const userId = getUserId((req as any).user);

    const { processCommand, createOperatorContext } = await import("../operator/index");
    const context = createOperatorContext(parseInt(subAccountId), userId, "draft");
    const result = await processCommand(intent, context);
    res.json(result);
  }));

  app.post("/api/operator/approve", asyncHandler(async (req, res) => {
    const { planId, stepId, subAccountId, action } = req.body;
    if (!planId || !stepId || !subAccountId) return res.status(400).json({ error: "Missing planId, stepId, or subAccountId" });

    if (!(await verifyAccountOwnership(req, res, parseInt(subAccountId)))) return;
    const userId = getUserId((req as any).user);

    const { approveAndContinue, rejectStep, createOperatorContext, getPlan } = await import("../operator/index");

    const plan = getPlan(planId);
    if (!plan || plan.subAccountId !== parseInt(subAccountId)) return res.status(404).json({ error: "Plan not found" });

    if (action === "reject") {
      const updated = await rejectStep(planId, stepId);
      return res.json({ plan: updated, message: "Step rejected" });
    }

    const context = createOperatorContext(parseInt(subAccountId), userId, "execute");
    const updated = await approveAndContinue(planId, stepId, context);
    res.json({ plan: updated, message: "Step approved and executed" });
  }));

  app.get("/api/operator/plans", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.query.subAccountId as string);
    if (!subAccountId) return res.status(400).json({ error: "subAccountId is required" });

    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getActivePlans, getPlanHistory } = await import("../operator/index");
    const active = getActivePlans(subAccountId);
    const history = getPlanHistory(20, subAccountId);
    res.json({ active, history });
  }));

  app.get("/api/operator/plan/:planId", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const { getPlan } = await import("../operator/index");
    const plan = getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    if (!(await verifyAccountOwnership(req, res, plan.subAccountId))) return;
    res.json(plan);
  }));

  app.get("/api/operator/tools", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const { getToolManifest } = await import("../operator/index");
    res.json(getToolManifest());
  }));

  app.get("/api/operator/approvals", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.query.subAccountId as string);
    if (!subAccountId) return res.status(400).json({ error: "subAccountId is required" });

    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getPendingApprovals, getApprovalHistory } = await import("../operator/index");
    res.json({
      pending: getPendingApprovals(subAccountId),
      history: getApprovalHistory(subAccountId, 20),
    });
  }));

  app.get("/api/operator/diagnostics", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.query.subAccountId as string);
    if (!subAccountId) return res.status(400).json({ error: "subAccountId is required" });

    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { runDiagnostics } = await import("../operator/index");
    const checks = await runDiagnostics(subAccountId);
    res.json({ checks, timestamp: new Date().toISOString() });
  }));

  app.get("/api/operator/diagnostics/history", requireAdmin, asyncHandler(async (req, res) => {
    const { getDiagnosticHistory } = await import("../operator/index");
    const category = req.query.category as string | undefined;
    res.json(getDiagnosticHistory(100, category));
  }));

  app.get("/api/operator/telemetry", requireAdmin, asyncHandler(async (_req, res) => {
    const { collectSystemMetrics } = await import("../operator/index");
    res.json(collectSystemMetrics());
  }));

  app.get("/api/operator/telemetry/metrics", requireAdmin, asyncHandler(async (req, res) => {
    const { getMetrics } = await import("../operator/index");
    const name = req.query.name as string | undefined;
    const limit = parseInt(req.query.limit as string) || 200;
    const since = req.query.since as string | undefined;
    res.json(getMetrics({ name, limit, since }));
  }));

  app.get("/api/operator/memory/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getSessionContext } = await import("../operator/index");
    res.json(getSessionContext(subAccountId));
  }));

  // ──── COGNITIVE INTELLIGENCE LAYER ────
  app.get("/api/operator/cognitive/context/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getCognitiveContext } = await import("../operator/cognitiveLayer");
    const context = await getCognitiveContext(subAccountId);
    res.json(context);
  }));

  app.get("/api/operator/cognitive/insights/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getCognitiveInsights } = await import("../operator/cognitiveLayer");
    const insights = await getCognitiveInsights(subAccountId);
    res.json({ insights, timestamp: new Date().toISOString() });
  }));

  app.get("/api/operator/cognitive/trends/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { runTrendDetection } = await import("../operator/cognitiveLayer");
    const trends = await runTrendDetection(subAccountId);
    res.json({ trends, timestamp: new Date().toISOString() });
  }));

  app.get("/api/operator/cognitive/nudges/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getCognitiveNudges } = await import("../operator/cognitiveLayer");
    const nudges = await getCognitiveNudges(subAccountId);
    res.json({ nudges });
  }));

  app.get("/api/operator/cognitive/nudges/:subAccountId/pending", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getPendingNudges } = await import("../operator/cognitiveLayer");
    const nudges = await getPendingNudges(subAccountId);
    res.json({ nudges });
  }));

  app.post("/api/operator/cognitive/nudges/:nudgeId/dismiss", asyncHandler(async (req, res) => {
    const nudgeId = parseInt(req.params.nudgeId);
    const subAccountId = parseInt(req.body.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { handleNudgeDismiss } = await import("../operator/cognitiveLayer");
    const success = await handleNudgeDismiss(nudgeId, subAccountId);
    if (!success) return res.status(400).json({ error: "Failed to dismiss nudge" });
    res.json({ success: true });
  }));

  app.post("/api/operator/cognitive/nudges/:nudgeId/act", asyncHandler(async (req, res) => {
    const nudgeId = parseInt(req.params.nudgeId);
    const subAccountId = parseInt(req.body.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { handleNudgeAction } = await import("../operator/cognitiveLayer");
    const success = await handleNudgeAction(nudgeId, subAccountId);
    if (!success) return res.status(400).json({ error: "Failed to act on nudge" });
    res.json({ success: true });
  }));

  app.get("/api/operator/cognitive/nudges/:subAccountId/history", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getCognitiveNudgeHistory } = await import("../operator/cognitiveLayer");
    const history = await getCognitiveNudgeHistory(subAccountId);
    res.json({ history });
  }));

  app.get("/api/operator/cognitive/industry/:industry", asyncHandler(async (req, res) => {
    const { getIndustryInfo } = await import("../operator/cognitiveLayer");
    const knowledge = await getIndustryInfo(req.params.industry);
    res.json(knowledge);
  }));

  app.get("/api/operator/cognitive/industries", asyncHandler(async (_req, res) => {
    const { listIndustries } = await import("../operator/cognitiveLayer");
    const industries = await listIndustries();
    res.json({ industries });
  }));

  app.get("/api/operator/cognitive/health/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getHealthScore } = await import("../operator/cognitiveLayer");
    const healthScore = await getHealthScore(subAccountId);
    res.json(healthScore);
  }));

  app.get("/api/operator/cognitive/growth-report/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getGrowthReport } = await import("../operator/cognitiveLayer");
    const report = await getGrowthReport(subAccountId);
    res.json(report);
  }));

  app.get("/api/operator/cognitive/growth-report/:subAccountId/stream", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const stream = new ProgressStream(res);

    try {
      stream.sendProgress("Calculating health scores...", 10);

      const { buildContext } = await import("../operator/contextBuilder");
      const context = await buildContext(subAccountId);
      stream.sendProgress("Building context...", 25);

      const { calculateHealthScore, generateStrategicInsights, detectMissedOpportunities } = await import("../operator/strategicAdvisor");

      const healthScore = calculateHealthScore(context);
      stream.sendResult({ section: "healthScore", data: healthScore });
      stream.sendProgress("Health score calculated", 40);

      const strategicInsights = generateStrategicInsights(context);
      stream.sendResult({ section: "strategicInsights", data: strategicInsights });
      stream.sendProgress("Strategic insights generated", 60);

      const missedOpportunities = detectMissedOpportunities(context);
      stream.sendResult({ section: "missedOpportunities", data: missedOpportunities });
      stream.sendProgress("Missed opportunities identified", 75);

      const quickWins = strategicInsights.filter(i => i.effort === "quick-win");
      stream.sendResult({ section: "quickWins", data: quickWins });
      stream.sendProgress("Quick wins compiled", 85);

      const { workspace, performance } = context;
      let growthStage = "Setup";
      if (workspace.contactCount === 0 && workspace.automationCount === 0) growthStage = "Setup";
      else if (workspace.contactCount < 20 && workspace.automationCount <= 1) growthStage = "Foundation";
      else if (workspace.contactCount < 100 && performance.messageCount < 50) growthStage = "Early Growth";
      else if (workspace.contactCount < 500) growthStage = "Growth";
      else if (workspace.contactCount < 2000) growthStage = "Scaling";
      else growthStage = "Mature";

      const benchmarks: Record<string, any> = {};
      try {
        const { getBenchmarksForIndustry } = await import("../operator/benchmarkAggregator");
        const crossBenchmarks = await getBenchmarksForIndustry(context.workspace.industry);
        if (crossBenchmarks.response_rate) {
          const rr = context.performance.inboundMessages > 0 ? Math.round((context.performance.outboundMessages / context.performance.inboundMessages) * 100) : 0;
          benchmarks["response_rate"] = { yours: `${rr}%`, benchmark: `${Math.round(crossBenchmarks.response_rate.avg)}%`, status: rr >= crossBenchmarks.response_rate.median ? "above" : "below" };
        }
        if (crossBenchmarks.contact_count) {
          benchmarks["contact_count"] = { yours: `${workspace.contactCount}`, benchmark: `${Math.round(crossBenchmarks.contact_count.avg)}`, status: workspace.contactCount >= crossBenchmarks.contact_count.median ? "above" : "below" };
        }
        if (crossBenchmarks.automation_count) {
          benchmarks["automation_count"] = { yours: `${workspace.automationCount}`, benchmark: `${Math.round(crossBenchmarks.automation_count.avg)}`, status: workspace.automationCount >= crossBenchmarks.automation_count.median ? "above" : "below" };
        }
        if (crossBenchmarks.monthly_message_volume) {
          benchmarks["monthly_messages"] = { yours: `${performance.messageCount}`, benchmark: `${Math.round(crossBenchmarks.monthly_message_volume.avg)}`, status: performance.messageCount >= crossBenchmarks.monthly_message_volume.median ? "above" : "below" };
        }
      } catch (err: any) {
        console.error("[ANALYTICS] Cross-benchmark aggregation failed:", err.message);
      }

      if (context.industryKnowledge) {
        const ik = context.industryKnowledge;
        if (!benchmarks["response_time"]) {
          benchmarks["response_time"] = {
            yours: performance.avgResponseTimeSec ? `${Math.round(performance.avgResponseTimeSec)}s` : "N/A",
            benchmark: `${ik.avgResponseTimeBenchmark}s`,
            status: !performance.avgResponseTimeSec ? "below" : performance.avgResponseTimeSec <= ik.avgResponseTimeBenchmark ? "above" : "below",
          };
        }
        for (const [key, val] of Object.entries(ik.conversionBenchmarks)) {
          if (key !== "target_response_time_sec" && !benchmarks[key]) {
            benchmarks[key] = { yours: "N/A", benchmark: `${Math.round((val as number) * 100)}%`, status: "below" };
          }
        }
      }

      stream.sendProgress("Report complete", 100);

      stream.end({
        generatedAt: new Date().toISOString(),
        healthScore,
        growthStage,
        strategicInsights,
        missedOpportunities,
        quickWins,
        industryBenchmarks: benchmarks,
      });
    } catch (err: any) {
      stream.sendError(err.message || "Growth report generation failed");
      stream.end();
    }
  }));

  app.get("/api/operator/cognitive/strategic/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getStrategicInsights } = await import("../operator/cognitiveLayer");
    const insights = await getStrategicInsights(subAccountId);
    res.json({ insights, timestamp: new Date().toISOString() });
  }));

  app.get("/api/operator/cognitive/opportunities/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getMissedOpportunities } = await import("../operator/cognitiveLayer");
    const opportunities = await getMissedOpportunities(subAccountId);
    res.json({ opportunities, timestamp: new Date().toISOString() });
  }));

  app.get("/api/operator/cognitive/profile/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getUserProfile } = await import("../operator/cognitiveLayer");
    const profile = await getUserProfile(subAccountId);
    res.json({ profile });
  }));

  app.post("/api/operator/cognitive/profile/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { updateUserProfile } = await import("../operator/cognitiveLayer");
    await updateUserProfile(subAccountId, req.body);
    res.json({ success: true });
  }));

  app.post("/api/operator/cognitive/track", asyncHandler(async (req, res) => {
    const { subAccountId, action, value } = req.body;
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { trackUserAction } = await import("../operator/cognitiveLayer");
    await trackUserAction(subAccountId, action, value);
    res.json({ success: true });
  }));

  // ──── AGENT EPISODIC MEMORY ────
  app.get("/api/operator/cognitive/memories/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (isNaN(subAccountId)) return res.status(400).json({ error: "Invalid subAccountId" });
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getAgentMemories } = await import("../operator/cognitiveLayer");
    const validTypes = ["decision", "outcome", "preference", "observation"];
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const memoryType = req.query.memoryType as string || undefined;
    if (memoryType && !validTypes.includes(memoryType)) {
      return res.status(400).json({ error: "Invalid memoryType filter" });
    }
    const result = await getAgentMemories(subAccountId, { limit, offset, memoryType });
    res.json(result);
  }));

  app.post("/api/operator/cognitive/memories/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (isNaN(subAccountId)) return res.status(400).json({ error: "Invalid subAccountId" });
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { memoryType, content, category, tags } = req.body;
    const validTypes = ["decision", "outcome", "preference", "observation"];
    if (!memoryType || !validTypes.includes(memoryType)) {
      return res.status(400).json({ error: "Invalid memoryType. Must be one of: decision, outcome, preference, observation" });
    }
    if (!content || typeof content !== "string" || content.length > 2000) {
      return res.status(400).json({ error: "Content is required and must be a string (max 2000 chars)" });
    }
    if (category && (typeof category !== "string" || category.length > 100)) {
      return res.status(400).json({ error: "Category must be a string (max 100 chars)" });
    }
    if (tags && (!Array.isArray(tags) || tags.some((t: unknown) => typeof t !== "string"))) {
      return res.status(400).json({ error: "Tags must be an array of strings" });
    }

    const { createAgentMemory } = await import("../operator/cognitiveLayer");
    const id = await createAgentMemory(subAccountId, { memoryType, content, category, tags });
    if (!id) return res.status(500).json({ error: "Failed to create memory" });
    res.json({ success: true, id });
  }));

  app.post("/api/operator/cognitive/memories/:subAccountId/extract-preferences", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (isNaN(subAccountId)) return res.status(400).json({ error: "Invalid subAccountId" });
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { message } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    const { extractChatPreferences } = await import("../operator/cognitiveLayer");
    const id = await extractChatPreferences(subAccountId, message);
    res.json({ extracted: !!id, memoryId: id });
  }));

  app.put("/api/operator/cognitive/memories/:subAccountId/:memoryId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    const memoryId = parseInt(req.params.memoryId);
    if (isNaN(subAccountId) || isNaN(memoryId)) return res.status(400).json({ error: "Invalid ID parameter" });
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { content, relevanceScore, outcome } = req.body;
    if (content !== undefined && (typeof content !== "string" || content.length > 2000)) {
      return res.status(400).json({ error: "Content must be a string (max 2000 chars)" });
    }
    if (relevanceScore !== undefined && (typeof relevanceScore !== "number" || relevanceScore < 0 || relevanceScore > 1)) {
      return res.status(400).json({ error: "relevanceScore must be a number between 0 and 1" });
    }
    if (outcome !== undefined && (typeof outcome !== "string" || outcome.length > 200)) {
      return res.status(400).json({ error: "Outcome must be a string (max 200 chars)" });
    }

    const { updateAgentMemory } = await import("../operator/cognitiveLayer");
    const success = await updateAgentMemory(memoryId, subAccountId, { content, relevanceScore, outcome });
    if (!success) return res.status(404).json({ error: "Memory not found" });
    res.json({ success: true });
  }));

  app.delete("/api/operator/cognitive/memories/:subAccountId/:memoryId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    const memoryId = parseInt(req.params.memoryId);
    if (isNaN(subAccountId) || isNaN(memoryId)) return res.status(400).json({ error: "Invalid ID parameter" });
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { deleteAgentMemory } = await import("../operator/cognitiveLayer");
    const success = await deleteAgentMemory(memoryId, subAccountId);
    if (!success) return res.status(404).json({ error: "Memory not found" });
    res.json({ success: true });
  }));

  // ──── AUTONOMOUS TASK AGENT ────
  app.get("/api/agent/tasks/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getTaskHistory } = await import("../operator/taskAgent");
    const limit = parseInt(req.query.limit as string) || 50;
    const tasks = await getTaskHistory(subAccountId, limit);
    res.json({ tasks });
  }));

  app.get("/api/agent/stats/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getTaskStats } = await import("../operator/taskAgent");
    const stats = await getTaskStats(subAccountId);
    res.json(stats);
  }));

  app.post("/api/agent/scan/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { manualScan } = await import("../operator/taskAgent");
    const result = await manualScan(subAccountId);
    res.json(result);
  }));

  app.put("/api/agent/config/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { updateAgentConfig } = await import("../operator/taskAgent");
    const config = await updateAgentConfig(subAccountId, req.body);
    res.json(config);
  }));

  app.get("/api/agent/briefings/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getUnseenBriefings } = await import("../operator/agentBrain");
    const briefings = await getUnseenBriefings(subAccountId);
    res.json({ briefings });
  }));

  app.post("/api/agent/briefings/:briefingId/seen", asyncHandler(async (req, res) => {
    const briefingId = parseInt(req.params.briefingId);
    const { markBriefingSeen } = await import("../operator/agentBrain");
    await markBriefingSeen(briefingId);
    res.json({ success: true });
  }));

  app.get("/api/agent/outcomes/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getOutcomeStats } = await import("../operator/agentBrain");
    const stats = await getOutcomeStats(subAccountId);
    res.json(stats);
  }));

  app.post("/api/agent/briefing/generate/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { generateBriefing } = await import("../operator/agentBrain");
    const briefing = await generateBriefing(subAccountId);
    res.json(briefing || { summary: "No new activity to report.", tasksCompleted: 0, tasksFailed: 0, highlights: [] });
  }));

  app.get("/api/agent/tools", asyncHandler(async (_req, res) => {
    const { getToolCategories, getToolManifest } = await import("../operator/toolRegistry");
    res.json({
      categories: getToolCategories(),
      tools: getToolManifest(),
      totalTools: getToolManifest().length,
    });
  }));

  // ──── INDUSTRY BENCHMARKS (Cross-Account Intelligence) ────
  app.get("/api/benchmarks/industry/:industry", asyncHandler(async (req, res) => {
    const { getBenchmarksForIndustry } = await import("../operator/benchmarkAggregator");
    const benchmarks = await getBenchmarksForIndustry(req.params.industry);
    res.json(benchmarks);
  }));

  app.post("/api/benchmarks/refresh", requireAdmin, asyncHandler(async (_req, res) => {
    const { runBenchmarkAggregation } = await import("../operator/benchmarkAggregator");
    const result = await runBenchmarkAggregation();
    res.json({ success: true, ...result });
  }));

  app.get("/api/benchmarks/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getAccountBenchmarkComparison } = await import("../operator/benchmarkAggregator");
    const comparison = await getAccountBenchmarkComparison(subAccountId);
    res.json(comparison);
  }));

  // ──── EVENT BUS & JOB QUEUE (admin only) ────
  app.get("/api/admin/event-bus/stats", requireAdmin, asyncHandler(async (_req, res) => {
    res.json(eventBus.getStats());
  }));

  app.get("/api/admin/event-bus/log", requireAdmin, asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const eventType = req.query.eventType as string | undefined;
    res.json(eventBus.getLog(limit, eventType));
  }));

  app.get("/api/admin/job-queue/stats", requireAdmin, asyncHandler(async (_req, res) => {
    res.json(jobQueue.getStats());
  }));

  app.get("/api/admin/job-queue/history", requireAdmin, asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const jobType = req.query.jobType as string | undefined;
    res.json(jobQueue.getHistory(limit, jobType));
  }));

  // ──── DATABASE BACKUP (admin only) ────
  app.post("/api/admin/db-snapshot", requireAdmin, asyncHandler(async (_req, res) => {
    const { createDatabaseSnapshot } = await import("../dbBackup");
    const result = await createDatabaseSnapshot();
    if (!result.success) return res.status(500).json({ error: "Snapshot failed" });
    res.json(result);
  }));

  app.get("/api/admin/db-snapshots", requireAdmin, asyncHandler(async (_req, res) => {
    const { listSnapshots } = await import("../dbBackup");
    const snapshots = await listSnapshots();
    res.json(snapshots);
  }));

  app.get("/api/admin/db-health", requireAdmin, asyncHandler(async (_req, res) => {
    const { getDatabaseHealth } = await import("../dbBackup");
    const health = await getDatabaseHealth();
    res.json(health);
  }));

  // ──── LAUNCH READINESS (admin only) ────
  app.get("/api/admin/launch-readiness", requireAdmin, asyncHandler(async (_req, res) => {
    const { runLaunchReadinessChecks } = await import("../launchReadiness");
    const result = await runLaunchReadinessChecks();
    res.json(result);
  }));

  // ──── SUPPORT DEBUG TOOLS (admin only) ────
  app.get("/api/admin/debug/account/:accountId", requireAdmin, asyncHandler(async (req, res) => {
    const accountId = parseInt(req.params.accountId);
    const account = await storage.getSubAccount(accountId);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const conns = await storage.getIntegrationConnections(accountId);
    const automations = await storage.getLiveAutomations(accountId);
    const contactCount = (await storage.getContacts(accountId)).length;
    const msgCount = (await storage.getMessages(accountId)).length;

    let subscription = null;
    if (account.ownerUserId) {
      subscription = await storage.getSubscription(account.ownerUserId);
    }

    res.json({
      account,
      subscription: subscription ? {
        status: subscription.status,
        plan: subscription.planTier,
        paymentStatus: subscription.paymentStatus,
        currentPeriodEnd: subscription.currentPeriodEnd,
      } : null,
      integrations: conns.map(c => ({ provider: c.provider, status: c.status })),
      automations: automations.map(a => ({ id: a.id, name: a.name, status: a.status })),
      stats: { contacts: contactCount, messages: msgCount },
    });
  }));

  app.get("/api/admin/debug/user/:userId", requireAdmin, asyncHandler(async (req, res) => {
    const userId = req.params.userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const subscription = await storage.getSubscription(userId);
    const ownedAccounts = await storage.getSubAccountsByUser(userId);

    res.json({
      user: { id: user.id, email: (user as any).email, role: (user as any).role, createdAt: (user as any).createdAt },
      subscription: subscription || null,
      ownedAccounts: ownedAccounts.map(a => ({ id: a.id, name: a.name, plan: a.plan })),
    });
  }));
}
