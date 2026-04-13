import type { Express, Request, Response } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { z } from "zod";
import crypto from "crypto";
import { asyncHandler, requireAdmin } from "./helpers";
import {
  siteTrackingEvents,
  siteTrackingDeadLetter,
  trackingSettings,
  subAccounts,
  savedSites,
  contacts,
  SITE_EVENT_TYPES,
  type InsertSiteTrackingEvent,
} from "@shared/schema";
import { eq, desc, sql, and, gte, count } from "drizzle-orm";
import { eventBus } from "../eventBus";

const VALID_EVENT_TYPES = new Set(Object.values(SITE_EVENT_TYPES));
const MAX_BATCH_SIZE = 100;
const MAX_PAYLOAD_BYTES = 64 * 1024;

const siteEventSchema = z.object({
  eventType: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(128),
  visitorId: z.string().min(1).max(128),
  page: z.string().max(2048).optional(),
  referrer: z.string().max(2048).optional(),
  utmSource: z.string().max(256).optional(),
  utmMedium: z.string().max(256).optional(),
  utmCampaign: z.string().max(256).optional(),
  utmContent: z.string().max(256).optional(),
  utmTerm: z.string().max(256).optional(),
  device: z.string().max(64).optional(),
  browser: z.string().max(64).optional(),
  os: z.string().max(64).optional(),
  country: z.string().max(64).optional(),
  payload: z.record(z.any()).optional(),
  clientTimestamp: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
});

const batchSchema = z.object({
  siteId: z.number().int().positive().optional(),
  subAccountId: z.number().int().positive(),
  events: z.array(siteEventSchema).min(1).max(MAX_BATCH_SIZE),
});

function buildFingerprint(event: z.infer<typeof siteEventSchema>, subAccountId: number): string {
  const key = `${subAccountId}:${event.sessionId}:${event.eventType}:${event.page || ""}:${JSON.stringify(event.payload || {}).slice(0, 200)}`;
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}

async function resolveContactId(
  subAccountId: number,
  email?: string,
  phone?: string,
  visitorId?: string,
): Promise<number | null> {
  if (!email && !phone) return null;
  try {
    const rows = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.subAccountId, subAccountId),
          email
            ? eq(contacts.email, email)
            : sql`false`
        )
      )
      .limit(1);
    if (rows.length > 0) return rows[0].id;
    if (phone) {
      const phoneRows = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.subAccountId, subAccountId),
            eq(contacts.phone, phone)
          )
        )
        .limit(1);
      if (phoneRows.length > 0) return phoneRows[0].id;
    }
  } catch (err: any) {
    console.error("[SITE-TRACKING] Contact resolve failed:", err?.message);
  }
  return null;
}

async function sendToDeadLetter(rawPayload: any, errorMessage: string, subAccountId?: number, siteId?: number) {
  try {
    await db.insert(siteTrackingDeadLetter).values({
      rawPayload,
      errorMessage: errorMessage.slice(0, 500),
      subAccountId,
      siteId,
    });
  } catch (err: any) {
    console.error("[SITE-TRACKING] Dead-letter insert failed:", err?.message);
  }
}

export function registerSiteTrackingRoutes(app: Express) {

  app.post("/api/track/events", asyncHandler(async (req: Request, res: Response) => {
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return res.status(413).json({ error: "Payload too large" });
    }

    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) {
      await sendToDeadLetter(req.body, JSON.stringify(parsed.error.flatten()), req.body?.subAccountId, req.body?.siteId);
      return res.status(400).json({ error: "Invalid event payload", detail: parsed.error.flatten() });
    }

    const { siteId, subAccountId, events } = parsed.data;

    const [accountExists] = await db
      .select({ id: subAccounts.id })
      .from(subAccounts)
      .where(eq(subAccounts.id, subAccountId))
      .limit(1);

    if (!accountExists) {
      return res.status(404).json({ error: "Sub-account not found" });
    }

    const settings = await db
      .select()
      .from(trackingSettings)
      .where(eq(trackingSettings.subAccountId, subAccountId))
      .limit(1);

    const enabledFamilies = settings[0]?.enabledEventFamilies ?? null;

    const results = { accepted: 0, rejected: 0, deduplicated: 0, errors: 0 };

    for (const event of events) {
      if (!VALID_EVENT_TYPES.has(event.eventType as any)) {
        results.rejected++;
        continue;
      }

      if (enabledFamilies && !enabledFamilies.includes(event.eventType)) {
        results.rejected++;
        continue;
      }

      const fingerprint = buildFingerprint(event, subAccountId);

      try {
        const contactId = await resolveContactId(subAccountId, event.contactEmail, event.contactPhone, event.visitorId);

        const record: InsertSiteTrackingEvent = {
          siteId: siteId ?? null,
          subAccountId,
          eventType: event.eventType,
          sessionId: event.sessionId,
          visitorId: event.visitorId,
          contactId: contactId ?? null,
          fingerprint,
          page: event.page ?? null,
          referrer: event.referrer ?? null,
          utmSource: event.utmSource ?? null,
          utmMedium: event.utmMedium ?? null,
          utmCampaign: event.utmCampaign ?? null,
          utmContent: event.utmContent ?? null,
          utmTerm: event.utmTerm ?? null,
          device: event.device ?? null,
          browser: event.browser ?? null,
          os: event.os ?? null,
          country: event.country ?? null,
          payload: event.payload ?? {},
          processedAt: new Date(),
        };

        await db.insert(siteTrackingEvents).values(record).onConflictDoNothing();
        results.accepted++;

        if (event.eventType === SITE_EVENT_TYPES.FORM_SUBMIT && (event.contactEmail || event.contactPhone)) {
          eventBus.publishAsync("site.form_submit", {
            subAccountId,
            siteId,
            sessionId: event.sessionId,
            visitorId: event.visitorId,
            contactEmail: event.contactEmail,
            contactPhone: event.contactPhone,
            page: event.page,
            ...event.payload,
          }, "site-tracking");
        }

        if (event.eventType === SITE_EVENT_TYPES.IDENTITY_RESOLVED && contactId) {
          await db
            .update(siteTrackingEvents)
            .set({ contactId })
            .where(
              and(
                eq(siteTrackingEvents.subAccountId, subAccountId),
                eq(siteTrackingEvents.visitorId, event.visitorId),
                sql`contact_id IS NULL`
              )
            );
        }
      } catch (err: any) {
        if (err?.message?.includes("unique") || err?.message?.includes("duplicate")) {
          results.deduplicated++;
        } else {
          results.errors++;
          await sendToDeadLetter({ event, subAccountId, siteId }, err?.message || "Unknown error", subAccountId, siteId);
        }
      }
    }

    res.json({ success: true, ...results });
  }));

  app.get("/api/apex/capture-health", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const [recentCount, deadLetterCount, sites] = await Promise.all([
      db.select({ count: count() }).from(siteTrackingEvents).where(gte(siteTrackingEvents.createdAt, fiveMinAgo)),
      db.select({ count: count() }).from(siteTrackingDeadLetter),
      db.select({ count: count() }).from(savedSites),
    ]);

    const eventsLastHour = await db
      .select({ count: count() })
      .from(siteTrackingEvents)
      .where(gte(siteTrackingEvents.createdAt, oneHourAgo));

    const recentEventCount = Number(recentCount[0]?.count ?? 0);
    const status = recentEventCount > 0 ? "live" : eventsLastHour[0]?.count ? "degraded" : "offline";

    res.json({
      status,
      recentEvents5min: recentEventCount,
      eventsLastHour: Number(eventsLastHour[0]?.count ?? 0),
      deadLetterCount: Number(deadLetterCount[0]?.count ?? 0),
      totalSites: Number(sites[0]?.count ?? 0),
    });
  }));

  app.get("/api/apex/live-events", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string || "50", 10), 200);
    const eventType = req.query.eventType as string | undefined;
    const subAccountId = req.query.subAccountId ? parseInt(req.query.subAccountId as string, 10) : undefined;

    const conditions: any[] = [];
    if (eventType) conditions.push(eq(siteTrackingEvents.eventType, eventType));
    if (subAccountId) conditions.push(eq(siteTrackingEvents.subAccountId, subAccountId));

    const events = await db
      .select({
        id: siteTrackingEvents.id,
        eventType: siteTrackingEvents.eventType,
        sessionId: siteTrackingEvents.sessionId,
        visitorId: siteTrackingEvents.visitorId,
        page: siteTrackingEvents.page,
        subAccountId: siteTrackingEvents.subAccountId,
        siteId: siteTrackingEvents.siteId,
        device: siteTrackingEvents.device,
        utmSource: siteTrackingEvents.utmSource,
        payload: siteTrackingEvents.payload,
        createdAt: siteTrackingEvents.createdAt,
      })
      .from(siteTrackingEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(siteTrackingEvents.createdAt))
      .limit(limit);

    res.json({ events, count: events.length });
  }));

  app.get("/api/apex/dead-letter", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const events = await db
      .select()
      .from(siteTrackingDeadLetter)
      .orderBy(desc(siteTrackingDeadLetter.createdAt))
      .limit(100);

    res.json({ events, count: events.length });
  }));

  app.post("/api/apex/dead-letter/:id/retry", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const [dlEvent] = await db
      .select()
      .from(siteTrackingDeadLetter)
      .where(eq(siteTrackingDeadLetter.id, id))
      .limit(1);

    if (!dlEvent) return res.status(404).json({ error: "Event not found" });

    await db
      .update(siteTrackingDeadLetter)
      .set({ retryCount: (dlEvent.retryCount || 0) + 1, lastRetryAt: new Date() })
      .where(eq(siteTrackingDeadLetter.id, id));

    res.json({ success: true, message: "Retry recorded" });
  }));

  app.get("/api/apex/source-breakdown", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const since = req.query.since
      ? new Date(req.query.since as string)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        utmSource: siteTrackingEvents.utmSource,
        count: count(),
      })
      .from(siteTrackingEvents)
      .where(gte(siteTrackingEvents.createdAt, since))
      .groupBy(siteTrackingEvents.utmSource)
      .orderBy(desc(count()))
      .limit(20);

    res.json({ breakdown: rows });
  }));

  app.get("/api/apex/top-pages", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const since = req.query.since
      ? new Date(req.query.since as string)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const subAccountId = req.query.subAccountId ? parseInt(req.query.subAccountId as string, 10) : undefined;
    const conditions: any[] = [gte(siteTrackingEvents.createdAt, since)];
    if (subAccountId) conditions.push(eq(siteTrackingEvents.subAccountId, subAccountId));

    const rows = await db
      .select({
        page: siteTrackingEvents.page,
        count: count(),
      })
      .from(siteTrackingEvents)
      .where(and(...conditions))
      .groupBy(siteTrackingEvents.page)
      .orderBy(desc(count()))
      .limit(20);

    res.json({ pages: rows });
  }));

  app.get("/api/apex/event-volume", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const days = Math.min(parseInt(req.query.days as string || "7", 10), 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await db.execute(sql`
      SELECT
        DATE_TRUNC('day', created_at) as day,
        sub_account_id,
        event_type,
        COUNT(*) as event_count
      FROM site_tracking_events
      WHERE created_at >= ${since}
      GROUP BY day, sub_account_id, event_type
      ORDER BY day DESC
    `);

    res.json({ volume: Array.isArray(rows) ? rows : (rows as any)?.rows ?? [] });
  }));

  app.get("/api/apex/account-routing", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const rows = await db.execute(sql`
      SELECT
        ste.sub_account_id,
        sa.name as account_name,
        COUNT(*) as event_count,
        MAX(ste.created_at) as last_event_at,
        COUNT(DISTINCT ste.site_id) as site_count,
        COUNT(DISTINCT ste.visitor_id) as visitor_count
      FROM site_tracking_events ste
      LEFT JOIN sub_accounts sa ON ste.sub_account_id = sa.id
      WHERE ste.created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY ste.sub_account_id, sa.name
      ORDER BY event_count DESC
      LIMIT 50
    `);

    res.json({ accounts: Array.isArray(rows) ? rows : (rows as any)?.rows ?? [] });
  }));

  app.get("/api/apex/top-ctas", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const since = req.query.since
      ? new Date(req.query.since as string)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        page: siteTrackingEvents.page,
        count: count(),
      })
      .from(siteTrackingEvents)
      .where(
        and(
          gte(siteTrackingEvents.createdAt, since),
          eq(siteTrackingEvents.eventType, SITE_EVENT_TYPES.CTA_CLICK)
        )
      )
      .groupBy(siteTrackingEvents.page)
      .orderBy(desc(count()))
      .limit(20);

    res.json({ ctas: rows });
  }));

  app.get("/api/apex/top-forms", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const since = req.query.since
      ? new Date(req.query.since as string)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const formEvents = await db
      .select({
        page: siteTrackingEvents.page,
        eventType: siteTrackingEvents.eventType,
        count: count(),
      })
      .from(siteTrackingEvents)
      .where(
        and(
          gte(siteTrackingEvents.createdAt, since),
          sql`event_type IN ('form_submit', 'form_start', 'form_abandon')`
        )
      )
      .groupBy(siteTrackingEvents.page, siteTrackingEvents.eventType)
      .orderBy(desc(count()))
      .limit(60);

    res.json({ forms: formEvents });
  }));

  app.get("/api/apex/tracking-settings/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = parseInt(req.params.subAccountId, 10);
    if (isNaN(subAccountId)) return res.status(400).json({ error: "Invalid subAccountId" });

    const [settings] = await db
      .select()
      .from(trackingSettings)
      .where(eq(trackingSettings.subAccountId, subAccountId))
      .limit(1);

    res.json({ settings: settings ?? null });
  }));

  app.post("/api/apex/tracking-settings/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = parseInt(req.params.subAccountId, 10);
    if (isNaN(subAccountId)) return res.status(400).json({ error: "Invalid subAccountId" });

    const {
      enabledEventFamilies,
      consentRequired,
      dataRetentionDays,
      fieldMappingRules,
      captureConfig,
    } = req.body;

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (Array.isArray(enabledEventFamilies)) updateData.enabledEventFamilies = enabledEventFamilies;
    if (typeof consentRequired === "boolean") updateData.consentRequired = consentRequired;
    if (typeof dataRetentionDays === "number") updateData.dataRetentionDays = Math.max(1, Math.min(365, dataRetentionDays));
    if (fieldMappingRules && typeof fieldMappingRules === "object") updateData.fieldMappingRules = fieldMappingRules;
    if (captureConfig && typeof captureConfig === "object") updateData.captureConfig = captureConfig;

    const [existing] = await db
      .select({ id: trackingSettings.id })
      .from(trackingSettings)
      .where(eq(trackingSettings.subAccountId, subAccountId))
      .limit(1);

    let result;
    if (existing) {
      [result] = await db
        .update(trackingSettings)
        .set(updateData)
        .where(eq(trackingSettings.subAccountId, subAccountId))
        .returning();
    } else {
      [result] = await db
        .insert(trackingSettings)
        .values({ subAccountId, ...updateData })
        .returning();
    }

    res.json({ settings: result });
  }));
}
