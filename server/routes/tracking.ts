import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import {
  trackingLinks,
  trackingVisits,
  trackingEvents,
  TRACKING_EVENT_TYPES,
  TRACKING_SOURCE_TYPES,
  TRACKING_TRAFFIC_CLASSES,
  type TrackingEventType,
  type TrackingTrafficClass,
} from "@shared/schema";
import { asyncHandler } from "./helpers";
import { emitUniversalEvent } from "../intelligence/eventEmitter";
import { detectIntent, INTENT_BEARING_EVENT_TYPES } from "../services/trackingIntent";
import { upgradeVisit } from "../services/trackingIdentity";
import { getCardSnapshot } from "../services/trackingSnapshots";

// ---------------------------------------------------------------------------
// Attribution token signing
// ---------------------------------------------------------------------------
// Tokens are HMAC-SHA256 over `${visitId}.${linkId ?? ""}.${issuedAt}` so that
// query params copied/pasted onto another machine can be validated for origin
// without a database round-trip on every event ingest.
// ---------------------------------------------------------------------------

const SIGNING_SECRET =
  process.env.TRACKING_SIGNING_SECRET ||
  process.env.SESSION_SECRET ||
  "apex-tracking-dev-secret-change-me";

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function signAttributionToken(visitId: string, linkId: number | null): string {
  const issuedAt = Date.now();
  const linkPart = linkId == null ? "" : String(linkId);
  const payload = `${visitId}.${linkPart}.${issuedAt}`;
  const sig = crypto.createHmac("sha256", SIGNING_SECRET).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export type DecodedAttribution = {
  visitId: string;
  linkId: number | null;
  issuedAt: number;
  valid: boolean;
};

export function verifyAttributionToken(token: string): DecodedAttribution | null {
  try {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return null;
    const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    const expected = crypto.createHmac("sha256", SIGNING_SECRET).update(payload).digest("base64url");
    const ok =
      sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    const [visitId, linkPart, issuedAtStr] = payload.split(".");
    const issuedAt = Number(issuedAtStr);
    if (!visitId || !Number.isFinite(issuedAt)) return null;
    const fresh = Date.now() - issuedAt < TOKEN_TTL_MS;
    return {
      visitId,
      linkId: linkPart ? Number(linkPart) : null,
      issuedAt,
      valid: ok && fresh,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip + SIGNING_SECRET).digest("hex").slice(0, 32);
}

function clientIp(req: Request): string {
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return fwd || req.socket.remoteAddress || "0.0.0.0";
}

function detectDevice(ua: string): { deviceType: string; browser: string; os: string } {
  const u = ua.toLowerCase();
  let deviceType = "desktop";
  if (/mobile|iphone|android.*mobile|ipod/.test(u)) deviceType = "mobile";
  else if (/ipad|tablet|android(?!.*mobile)/.test(u)) deviceType = "tablet";
  else if (/bot|crawl|spider|preview/.test(u)) deviceType = "bot";

  let browser = "unknown";
  if (/edg\//.test(u)) browser = "edge";
  else if (/chrome\//.test(u) && !/edg\//.test(u)) browser = "chrome";
  else if (/safari\//.test(u) && !/chrome\//.test(u)) browser = "safari";
  else if (/firefox\//.test(u)) browser = "firefox";

  let os = "unknown";
  if (/windows nt/.test(u)) os = "windows";
  else if (/mac os x/.test(u)) os = "macos";
  else if (/iphone|ipad|ipod/.test(u)) os = "ios";
  else if (/android/.test(u)) os = "android";
  else if (/linux/.test(u)) os = "linux";

  return { deviceType, browser, os };
}

function classifyTraffic(req: Request, ua: string): TrackingTrafficClass {
  if (req.query._test === "1" || req.headers["x-test-traffic"] === "1") return "test";
  if (/bot|crawl|spider|preview|fetch|monitoring/i.test(ua)) return "bot";
  return "valid";
}

function isTestRequest(req: Request): boolean {
  const cls = classifyTraffic(req, String(req.headers["user-agent"] || ""));
  return cls === "test" || cls === "internal";
}

function appendQueryParam(url: string, key: string, value: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

// ---------------------------------------------------------------------------
// Visit creation (shared between /t/:slug capture and direct event ingest)
// ---------------------------------------------------------------------------

type VisitCreateInput = {
  link?: typeof trackingLinks.$inferSelect | null;
  req: Request;
  sourceType?: string;
  landingUrl?: string | null;
  finalUrl?: string | null;
  sessionId?: string | null;
};

async function createVisit(input: VisitCreateInput) {
  const { link, req } = input;
  const ua = String(req.headers["user-agent"] || "");
  const { deviceType, browser, os } = detectDevice(ua);
  const trafficClass = classifyTraffic(req, ua);
  const isTest = trafficClass === "test" || trafficClass === "internal" || (link?.isTest ?? false);

  const visitId = crypto.randomUUID();
  const sessionId =
    input.sessionId ||
    (req.cookies?.apex_sid as string | undefined) ||
    crypto.randomUUID();

  const sourceType =
    input.sourceType || link?.sourceType || (req.query.src ? String(req.query.src) : "direct");

  const attributionToken = signAttributionToken(visitId, link?.id ?? null);

  const [visit] = await db
    .insert(trackingVisits)
    .values({
      visitId,
      linkId: link?.id ?? null,
      subAccountId: link?.subAccountId ?? null,
      cardId: link?.cardId ?? null,
      campaignId: link?.campaignId ?? null,
      sessionId,
      sourceType,
      landingUrl: input.landingUrl ?? null,
      finalUrl: input.finalUrl ?? link?.destinationUrl ?? null,
      referrer: (req.headers.referer as string | undefined) ?? null,
      userAgent: ua || null,
      deviceType,
      browser,
      os,
      ipHash: hashIp(clientIp(req)),
      utmSource: (req.query.utm_source as string | undefined) ?? null,
      utmMedium: (req.query.utm_medium as string | undefined) ?? null,
      utmCampaign: (req.query.utm_campaign as string | undefined) ?? null,
      utmContent: (req.query.utm_content as string | undefined) ?? null,
      utmTerm: (req.query.utm_term as string | undefined) ?? null,
      attributionToken,
      attributionConfidence: link ? 1.0 : 0.5,
      isTest,
      trafficClass,
      metadata: {},
    })
    .returning();

  return { visit, attributionToken, sessionId };
}

// ---------------------------------------------------------------------------
// Event recording
// ---------------------------------------------------------------------------

type RecordEventArgs = {
  eventType: TrackingEventType;
  visitId?: string | null;
  attributionToken?: string | null;
  // Tenant context (subAccountId/cardId/campaignId) is NEVER taken from
  // public callers — it is derived only from the resolved visit so a public
  // event ingest cannot inject events into another tenant. The "trusted"
  // flag (set by the apex-crm webhook / admin-authenticated callers) is the
  // only path that may supply these directly.
  trusted?: boolean;
  subAccountId?: number | null;
  cardId?: number | null;
  campaignId?: string | null;
  contactId?: number | null;
  pageUrl?: string | null;
  ctaId?: string | null;
  formId?: string | null;
  sourceChannel?: string | null;
  eventValue?: number | null;
  idempotencyKey?: string | null;
  payload?: Record<string, unknown>;
  isTestOverride?: boolean;
  req: Request;
};

const CONVERSION_EVENT_TYPES = new Set<TrackingEventType>([
  "lead_submit",
  "booked_call",
  "qualified_lead",
  "closed_sale",
]);

export class TrackingEventError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function recordEvent(args: RecordEventArgs) {
  // Resolve visit context. If both visitId and attributionToken are supplied
  // they MUST resolve to the same visit, otherwise we reject — that prevents
  // a caller from binding an attribution token to an unrelated visit.
  let visit:
    | typeof trackingVisits.$inferSelect
    | undefined;

  let tokenVisitId: string | null = null;
  if (args.attributionToken) {
    const decoded = verifyAttributionToken(args.attributionToken);
    if (!decoded?.valid) {
      throw new TrackingEventError(401, "invalid or expired attribution token");
    }
    tokenVisitId = decoded.visitId;
  }

  const lookupVisitId = args.visitId || tokenVisitId;
  if (lookupVisitId) {
    const rows = await db
      .select()
      .from(trackingVisits)
      .where(eq(trackingVisits.visitId, lookupVisitId))
      .limit(1);
    visit = rows[0];
  }

  if (args.visitId && tokenVisitId && args.visitId !== tokenVisitId) {
    throw new TrackingEventError(400, "visitId / attribution token mismatch");
  }

  // Conversion-grade events (lead_submit, booked_call, qualified_lead,
  // closed_sale) are only acceptable from a trusted server channel OR when
  // the caller proves chain-of-custody with a valid attribution token.
  if (CONVERSION_EVENT_TYPES.has(args.eventType) && !args.trusted && !tokenVisitId) {
    throw new TrackingEventError(
      403,
      "conversion events require a valid attributionToken or trusted channel"
    );
  }

  const ua = String(args.req.headers["user-agent"] || "");
  const trafficClass = visit?.trafficClass
    ? (visit.trafficClass as TrackingTrafficClass)
    : classifyTraffic(args.req, ua);
  const isTest =
    args.isTestOverride === true ||
    (visit?.isTest ?? false) ||
    trafficClass === "test" ||
    trafficClass === "internal";

  const eventId = crypto.randomUUID();
  // Public callers can NEVER set tenant context — only the resolved visit can.
  // Trusted callers (server-to-server webhook / admin-authenticated) may pass
  // their own values for cases like CRM-originated conversion events.
  const subAccountId = args.trusted
    ? (args.subAccountId ?? visit?.subAccountId ?? null)
    : (visit?.subAccountId ?? null);
  const cardId = args.trusted
    ? (args.cardId ?? visit?.cardId ?? null)
    : (visit?.cardId ?? null);
  const campaignId = args.trusted
    ? (args.campaignId ?? visit?.campaignId ?? null)
    : (visit?.campaignId ?? null);
  const contactId = args.trusted ? (args.contactId ?? null) : null;
  const linkId = visit?.linkId ?? null;
  const attributionConfidence = visit?.attributionConfidence ?? (args.trusted ? 0.7 : 0.3);

  // Idempotency: if we've already stored an event with this key, return it.
  if (args.idempotencyKey) {
    const existing = await db
      .select()
      .from(trackingEvents)
      .where(eq(trackingEvents.idempotencyKey, args.idempotencyKey))
      .limit(1);
    if (existing[0]) return { event: existing[0], visit, deduped: true };
  }

  const [event] = await db
    .insert(trackingEvents)
    .values({
      eventId,
      visitId: visit?.visitId ?? args.visitId ?? null,
      linkId,
      subAccountId,
      cardId,
      campaignId,
      contactId,
      eventType: args.eventType,
      eventValue: args.eventValue ?? null,
      pageUrl: args.pageUrl ?? null,
      ctaId: args.ctaId ?? null,
      formId: args.formId ?? null,
      sourceChannel: args.sourceChannel ?? null,
      idempotencyKey: args.idempotencyKey ?? null,
      payload: args.payload ?? {},
      isTest,
      trafficClass,
      attributionConfidence,
    })
    .returning();

  // Mirror into universal_events so the existing Apex Intelligence pipeline
  // can consume tracking signals without any extra wiring. Test traffic is
  // kept out of the Apex learning feed to protect benchmarks.
  if (!isTest) {
    emitUniversalEvent({
      eventType: `tracking.${args.eventType}`,
      sourceModule: "tracking",
      moduleSource: "tracking",
      entityType: "tracking_event",
      entityId: eventId,
      sourceTable: "tracking_events",
      sourceRecordId: eventId,
      subAccountId: subAccountId ?? undefined,
      contactId: args.contactId ?? undefined,
      cardId: cardId ?? undefined,
      anonymousSessionId: visit?.sessionId ?? undefined,
      metadata: {
        visitId: visit?.visitId ?? args.visitId ?? null,
        linkId,
        campaignId,
        ctaId: args.ctaId ?? null,
        formId: args.formId ?? null,
        sourceChannel: args.sourceChannel ?? null,
        eventValue: args.eventValue ?? null,
        attributionConfidence,
        sourceType: visit?.sourceType ?? null,
        utmSource: visit?.utmSource ?? null,
        utmMedium: visit?.utmMedium ?? null,
        utmCampaign: visit?.utmCampaign ?? null,
        ...args.payload,
      },
    });
  }

  // Live intent detection. Fires only for engagement-grade event types and
  // for production traffic. Awaited but isolated so a detection failure can
  // never poison the event-recording response.
  if (!isTest && visit?.visitId && INTENT_BEARING_EVENT_TYPES.has(args.eventType)) {
    try {
      await detectIntent({ visitId: visit.visitId, eventType: args.eventType, eventId });
    } catch (e) {
      console.warn("[tracking] intent detection failed for event", eventId, e);
    }
  }

  return { event, visit, deduped: false };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const eventBaseSchema = z.object({
  visitId: z.string().min(1).optional(),
  attributionToken: z.string().min(1).optional(),
  subAccountId: z.number().int().positive().optional(),
  cardId: z.number().int().positive().optional(),
  campaignId: z.string().min(1).max(128).optional(),
  contactId: z.number().int().positive().optional(),
  pageUrl: z.string().max(2048).optional(),
  ctaId: z.string().max(128).optional(),
  formId: z.string().max(128).optional(),
  sourceChannel: z.string().max(64).optional(),
  eventValue: z.number().finite().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
  payload: z.record(z.unknown()).optional(),
});

const genericEventSchema = eventBaseSchema.extend({
  eventType: z.enum(TRACKING_EVENT_TYPES),
});

const createLinkSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, "slug must be url-safe"),
  destinationUrl: z.string().url().max(2048),
  subAccountId: z.number().int().positive().optional(),
  cardId: z.number().int().positive().optional(),
  campaignId: z.string().max(128).optional(),
  sourceType: z.enum(TRACKING_SOURCE_TYPES).optional(),
  label: z.string().max(128).optional(),
  isActive: z.boolean().optional(),
  isTest: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerTrackingRoutes(app: Express): void {
  // -----------------------------------------------------------------------
  // CAPTURE: /t/:slug — fast resolve + redirect with signed attribution
  // -----------------------------------------------------------------------
  app.get("/t/:slug", asyncHandler(async (req: Request, res: Response) => {
    const slug = String(req.params.slug || "").slice(0, 64);
    if (!slug) return res.status(400).send("invalid slug");

    const [link] = await db
      .select()
      .from(trackingLinks)
      .where(eq(trackingLinks.slug, slug))
      .limit(1);

    if (!link || !link.isActive) {
      return res.status(404).send("tracking link not found or inactive");
    }

    const { visit, attributionToken, sessionId } = await createVisit({
      link,
      req,
      sourceType: link.sourceType,
      landingUrl: req.originalUrl,
      finalUrl: link.destinationUrl,
    });

    // Persistent visitor session cookie so repeat visits stitch.
    res.cookie("apex_sid", sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.secure,
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });

    // Record the tap/scan event. Fire-and-forget so the redirect is fast.
    recordEvent({
      eventType: link.sourceType === "qr" ? "qr_scan" : "tap",
      visitId: visit.visitId,
      subAccountId: link.subAccountId ?? null,
      cardId: link.cardId ?? null,
      campaignId: link.campaignId ?? null,
      pageUrl: link.destinationUrl,
      sourceChannel: link.sourceType,
      payload: { slug, label: link.label ?? null },
      req,
    }).catch((err) => {
      console.error(`[TRACKING] tap event failed for slug=${slug}:`, (err as Error).message);
    });

    // Async tap counter bump (best-effort, never blocks redirect).
    db.update(trackingLinks)
      .set({ tapCount: sql`${trackingLinks.tapCount} + 1`, lastTapAt: new Date() })
      .where(eq(trackingLinks.id, link.id))
      .catch(() => {});

    const finalUrl = appendQueryParam(link.destinationUrl, "_av", attributionToken);
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, finalUrl);
  }));

  // -----------------------------------------------------------------------
  // EVENT INGESTION
  // -----------------------------------------------------------------------
  function handleEventError(err: unknown, res: Response): boolean {
    if (err instanceof TrackingEventError) {
      res.status(err.status).json({ error: err.message });
      return true;
    }
    return false;
  }

  // Generic ingest — eventType in body. Useful for the frontend tracking
  // snippet so a single endpoint covers every signal type. PUBLIC: tenant
  // context is derived only from the resolved visit; conversion events
  // require a valid attribution token.
  app.post("/api/track/event", asyncHandler(async (req: Request, res: Response) => {
    const parsed = genericEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid payload", details: parsed.error.flatten() });
    }
    try {
      const { event, deduped } = await recordEvent({ ...parsed.data, trusted: false, req });
      return res.status(deduped ? 200 : 201).json({
        ok: true,
        eventId: event.eventId,
        visitId: event.visitId,
        deduped,
      });
    } catch (err) {
      if (handleEventError(err, res)) return;
      throw err;
    }
  }));

  // Per-type endpoints — thin wrappers that lock the eventType server-side
  // so callers cannot mislabel a signal. PUBLIC.
  function bindEventEndpoint(path: string, eventType: TrackingEventType) {
    app.post(path, asyncHandler(async (req: Request, res: Response) => {
      const parsed = eventBaseSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid payload", details: parsed.error.flatten() });
      }
      try {
        const { event, deduped } = await recordEvent({
          ...parsed.data,
          eventType,
          trusted: false,
          req,
        });
        return res.status(deduped ? 200 : 201).json({
          ok: true,
          eventId: event.eventId,
          visitId: event.visitId,
          deduped,
        });
      } catch (err) {
        if (handleEventError(err, res)) return;
        throw err;
      }
    }));
  }

  bindEventEndpoint("/api/track/page-view", "page_view");
  bindEventEndpoint("/api/track/click", "cta_click");
  bindEventEndpoint("/api/track/form-start", "form_start");
  bindEventEndpoint("/api/track/lead-submit", "lead_submit");
  bindEventEndpoint("/api/track/booked-call", "booked_call");
  bindEventEndpoint("/api/track/qualified-lead", "qualified_lead");
  bindEventEndpoint("/api/track/closed-sale", "closed_sale");

  // Server-to-server webhook from Apex CRM / workflow automations. TRUSTED:
  // requires admin secret and may pass tenant context (subAccountId, cardId,
  // contactId) directly because the caller is server-side.
  app.post("/api/track/webhook/apex-crm", asyncHandler(async (req: Request, res: Response) => {
    if (!adminGuard(req, res)) return;
    const parsed = genericEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid payload", details: parsed.error.flatten() });
    }
    try {
      const { event, deduped } = await recordEvent({
        ...parsed.data,
        sourceChannel: parsed.data.sourceChannel ?? "apex-crm",
        trusted: true,
        req,
      });
      return res.status(deduped ? 200 : 201).json({
        ok: true,
        eventId: event.eventId,
        visitId: event.visitId,
        deduped,
      });
    } catch (err) {
      if (handleEventError(err, res)) return;
      throw err;
    }
  }));

  // -----------------------------------------------------------------------
  // ADMIN: create / list / update tracking links
  // -----------------------------------------------------------------------
  // NOTE: full tenant authorization will hang off the existing admin
  // middleware in a follow-up task. For now, callers must provide a
  // subAccountId and (when the platform-wide admin secret is set) the
  // matching X-Admin-Secret header.
  function adminGuard(req: Request, res: Response): boolean {
    const required = process.env.TRACKING_ADMIN_SECRET || process.env.STANDALONE_ADMIN_SECRET || "";
    if (!required) {
      // Refuse to operate without a secret in any non-development environment
      // so a misconfigured deploy does not silently expose link creation.
      if (process.env.NODE_ENV === "production") {
        res.status(503).json({
          error: "tracking admin secret not configured",
        });
        return false;
      }
      return true; // open in dev when no secret configured
    }
    if (req.headers["x-admin-secret"] === required) return true;
    res.status(401).json({ error: "unauthorized" });
    return false;
  }

  app.post("/api/track/links", asyncHandler(async (req: Request, res: Response) => {
    if (!adminGuard(req, res)) return;
    const parsed = createLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid payload", details: parsed.error.flatten() });
    }
    try {
      const [link] = await db.insert(trackingLinks).values(parsed.data).returning();
      return res.status(201).json({ link });
    } catch (err: any) {
      if (String(err?.code) === "23505") {
        return res.status(409).json({ error: "slug already exists" });
      }
      throw err;
    }
  }));

  app.get("/api/track/links", asyncHandler(async (req: Request, res: Response) => {
    if (!adminGuard(req, res)) return;
    const subAccountId = req.query.subAccountId ? Number(req.query.subAccountId) : null;
    const rows = subAccountId
      ? await db.select().from(trackingLinks).where(eq(trackingLinks.subAccountId, subAccountId))
      : await db.select().from(trackingLinks).limit(200);
    return res.json({ links: rows });
  }));

  app.get("/api/track/links/:slug", asyncHandler(async (req: Request, res: Response) => {
    if (!adminGuard(req, res)) return;
    const [link] = await db
      .select()
      .from(trackingLinks)
      .where(eq(trackingLinks.slug, req.params.slug))
      .limit(1);
    if (!link) return res.status(404).json({ error: "not found" });
    return res.json({ link });
  }));

  app.patch("/api/track/links/:slug", asyncHandler(async (req: Request, res: Response) => {
    if (!adminGuard(req, res)) return;
    const updateSchema = createLinkSchema.partial().omit({ slug: true });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid payload", details: parsed.error.flatten() });
    }
    const [link] = await db
      .update(trackingLinks)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(trackingLinks.slug, req.params.slug))
      .returning();
    if (!link) return res.status(404).json({ error: "not found" });
    return res.json({ link });
  }));

  // Inspect a visit's full attribution chain for debugging / manual
  // reconciliation. Read-only.
  app.get("/api/track/visits/:visitId", asyncHandler(async (req: Request, res: Response) => {
    if (!adminGuard(req, res)) return;
    const [visit] = await db
      .select()
      .from(trackingVisits)
      .where(eq(trackingVisits.visitId, req.params.visitId))
      .limit(1);
    if (!visit) return res.status(404).json({ error: "not found" });
    const events = await db
      .select()
      .from(trackingEvents)
      .where(eq(trackingEvents.visitId, req.params.visitId));
    return res.json({ visit, events });
  }));

  // -----------------------------------------------------------------------
  // IDENTITY: visit upgrade (anonymous -> identified) + cross-visit stitching
  // -----------------------------------------------------------------------
  // Public callers (e.g. a form on the landing page) may call this with the
  // visitor's email/phone right after a successful lead capture. To prevent
  // abuse, EITHER a valid attribution token OR the trusted server channel
  // (apex-crm webhook style with admin secret) must accompany the request —
  // otherwise anyone could attach contact identities to arbitrary visits.
  const identifySchema = z.object({
    visitId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    attributionToken: z.string().min(1).optional(),
    email: z.string().trim().email().max(320).optional(),
    phone: z.string().min(7).max(40).optional(),
    contactId: z.number().int().positive().optional(),
  }).refine(
    (v) => Boolean(v.visitId || v.sessionId || v.attributionToken),
    { message: "visitId, sessionId, or attributionToken is required" },
  ).refine(
    (v) => Boolean(v.email || v.phone || v.contactId),
    { message: "at least one of email, phone, or contactId is required" },
  );

  app.post("/api/track/identify", asyncHandler(async (req: Request, res: Response) => {
    const parsed = identifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid payload", details: parsed.error.flatten() });
    }

    const adminSecret = process.env.TRACKING_ADMIN_SECRET || process.env.STANDALONE_ADMIN_SECRET || "";
    const trusted = Boolean(adminSecret) && req.headers["x-admin-secret"] === adminSecret;

    // Resolve target visitId. If a token was supplied, validate it and use it
    // as the source of truth so callers cannot identify someone else's visit.
    let resolvedVisitId = parsed.data.visitId;
    if (parsed.data.attributionToken) {
      const decoded = verifyAttributionToken(parsed.data.attributionToken);
      if (!decoded?.valid) {
        return res.status(401).json({ error: "invalid or expired attribution token" });
      }
      if (resolvedVisitId && resolvedVisitId !== decoded.visitId) {
        return res.status(400).json({ error: "visitId / attribution token mismatch" });
      }
      resolvedVisitId = decoded.visitId;
    }

    // No token AND not trusted? We cannot accept identity claims from the
    // public; bail out with an explicit error so callers know to attach
    // their attribution token.
    if (!resolvedVisitId && !parsed.data.sessionId) {
      return res.status(400).json({ error: "visitId required (sessionId fallback only allowed when no other identifier present)" });
    }
    if (!parsed.data.attributionToken && !trusted) {
      return res.status(403).json({ error: "identify requires a valid attributionToken or trusted channel" });
    }

    const result = await upgradeVisit({
      visitId: resolvedVisitId,
      sessionId: parsed.data.sessionId,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      contactId: parsed.data.contactId ?? null,
    });

    if (!result.upgraded) {
      return res.status(404).json({ error: "visit not found or no identifying fields supplied" });
    }

    return res.status(200).json({
      ok: true,
      visitId: result.visit?.visitId,
      contactId: result.visit?.contactId,
      isRepeat: result.isRepeat,
      stitchedVisitCount: result.stitchedVisitCount,
      attributionConfidence: result.visit?.attributionConfidence,
      identifiedAt: result.visit?.identifiedAt,
    });
  }));

  // -----------------------------------------------------------------------
  // ANALYTICS: card-level intelligence snapshot
  // -----------------------------------------------------------------------
  // Returns the pre-aggregated snapshot row for a card (taps, scans, clicks,
  // leads, repeat/identified visitor counts, conversion rates, revenue). The
  // snapshot is recomputed on-demand if it's stale (>5 min) or if
  // ?refresh=1 is supplied. Test traffic is excluded by the snapshot service
  // so production benchmarks remain clean.
  app.get("/api/track/analytics/cards/:id", asyncHandler(async (req: Request, res: Response) => {
    if (!adminGuard(req, res)) return;
    const cardId = Number(req.params.id);
    if (!Number.isFinite(cardId) || cardId <= 0) {
      return res.status(400).json({ error: "invalid card id" });
    }
    const forceRefresh = req.query.refresh === "1";
    const snapshot = await getCardSnapshot(cardId, { forceRefresh });
    return res.json({ snapshot });
  }));

  // Health probe for the tracking subsystem itself.
  app.get("/api/track/health", (_req, res) => {
    res.json({ ok: true, subsystem: "tracking", trafficClasses: TRACKING_TRAFFIC_CLASSES });
  });
}
