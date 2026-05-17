// @ts-nocheck
import type { Express, Request, Response } from "express";
import express from "express";
import { z } from "zod";
import { storage } from "../storage";
import { asyncHandler } from "./helpers";
import { publishEventAsync, EVENT_TYPES } from "../eventBus";
import { subAccounts } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const PREFIX = "/api/v1/external";

const corsHeaders = (_req: Request, res: Response, next: Function) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  if (_req.method === "OPTIONS") return res.status(204).send();
  next();
};

async function resolveApiKey(req: Request): Promise<{ id: number; name: string; twilioNumber: string } | null> {
  const key = (req.headers["x-api-key"] || req.query.apiKey) as string | undefined;
  if (!key || key.length < 10) return null;
  const [row] = await db.select({
    id: subAccounts.id,
    name: subAccounts.name,
    twilioNumber: subAccounts.twilioNumber,
  }).from(subAccounts).where(eq(subAccounts.webhookToken, key)).limit(1);
  return row || null;
}

export function generateApiKey(prefix = "apex"): string {
  return `${prefix}_${crypto.randomBytes(24).toString("hex")}`;
}

export function registerExternalApiRoutes(app: Express) {
  app.options(`${PREFIX}/leads`, corsHeaders);
  app.options(`${PREFIX}/consultations`, corsHeaders);
  app.options(`${PREFIX}/events`, corsHeaders);
  app.options(`${PREFIX}/status`, corsHeaders);

  app.get(`${PREFIX}/status`, corsHeaders, asyncHandler(async (req, res) => {
    const account = await resolveApiKey(req);
    if (!account) {
      return res.json({ status: "ok", authenticated: false, message: "Apex External API is reachable. Provide X-API-Key header to authenticate." });
    }
    res.json({ status: "ok", authenticated: true, accountId: account.id, accountName: account.name });
  }));

  const leadSchema = z.object({
    name: z.string().min(1).max(200),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().min(7).max(20).optional().or(z.literal("")),
    serviceInterest: z.string().max(500).optional(),
    message: z.string().max(2000).optional(),
    source: z.string().max(100).optional(),
    tags: z.array(z.string().max(50)).max(10).optional(),
  });

  app.post(`${PREFIX}/leads`, corsHeaders, express.json(), asyncHandler(async (req, res) => {
    const account = await resolveApiKey(req);
    if (!account) return res.status(401).json({ error: "Invalid or missing API key. Set X-API-Key header." });

    const parsed = leadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const { name, email, phone, serviceInterest, message, source, tags } = parsed.data;
    if (!email && !phone) return res.status(400).json({ error: "At least one of email or phone is required." });

    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0] || "Lead";
    const lastName = nameParts.slice(1).join(" ") || undefined;

    const allTags = [...(tags || [])];
    if (serviceInterest) allTags.push(`interest:${serviceInterest}`);
    if (source) allTags.push(`source:${source}`);
    if (!allTags.some(t => t.startsWith("source:"))) allTags.push("source:external-api");

    let contactId: number | undefined;
    try {
      const contact = await storage.createContact({
        subAccountId: account.id,
        firstName,
        lastName: lastName || null,
        phone: phone || null,
        email: email || null,
        source: source || "external-api",
        tags: allTags,
      });
      contactId = contact?.id;
    } catch (e: any) {
      console.log(`[EXTERNAL-API] Contact creation note: ${e.message}`);
    }

    await storage.createMessage({
      subAccountId: account.id,
      contactPhone: phone || email || "external-api",
      body: `New Lead (${source || "External API"}):\nName: ${name}\n${email ? `Email: ${email}\n` : ""}${phone ? `Phone: ${phone}\n` : ""}${serviceInterest ? `Service: ${serviceInterest}\n` : ""}${message ? `Message: ${message}` : ""}`,
      direction: "inbound",
      channel: "form",
      status: "received",
    });

    import("./v1").then(({ fireAutomationTriggerGlobal }) => {
      const ctx = {
        leadName: name,
        leadPhone: phone || "",
        leadEmail: email || "",
        serviceInterest: serviceInterest || "",
        source: source || "external-api",
        message: message || "",
      };
      fireAutomationTriggerGlobal("new_lead", account.id, ctx).catch((err) => console.warn("[EXTERNAL-API] promise rejected:", err instanceof Error ? err.message : err));
      fireAutomationTriggerGlobal("OnNewLead", account.id, ctx).catch((err) => console.warn("[EXTERNAL-API] promise rejected:", err instanceof Error ? err.message : err));
    }).catch(e => console.error("[EXTERNAL-API] trigger error:", e instanceof Error ? e.message : e));

    publishEventAsync(EVENT_TYPES.CONTACT_CREATED, "external-api", {
      subAccountId: account.id, name, phone, email, source: source || "external-api",
    });
    publishEventAsync(EVENT_TYPES.FORM_SUBMITTED, "external-api", {
      subAccountId: account.id, formName: source || "external-lead", contactName: name, contactPhone: phone, contactEmail: email,
    });

    console.log(`[EXTERNAL-API] Lead captured: ${name} (account=${account.id}, source=${source || "external-api"})`);
    res.status(201).json({ success: true, contactId, message: "Lead captured successfully." });
  }));

  const consultationSchema = z.object({
    name: z.string().min(1).max(200),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().min(7).max(20),
    service: z.string().min(1).max(500),
    preferredDate: z.string().max(100).optional(),
    preferredTime: z.string().max(100).optional(),
    notes: z.string().max(2000).optional(),
    source: z.string().max(100).optional(),
  });

  app.post(`${PREFIX}/consultations`, corsHeaders, express.json(), asyncHandler(async (req, res) => {
    const account = await resolveApiKey(req);
    if (!account) return res.status(401).json({ error: "Invalid or missing API key. Set X-API-Key header." });

    const parsed = consultationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const { name, email, phone, service, preferredDate, preferredTime, notes, source } = parsed.data;
    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0] || "Lead";
    const lastName = nameParts.slice(1).join(" ") || undefined;

    const consultTags = [`consultation:${service}`, "type:consultation", `source:${source || "external-api"}`];

    try {
      await storage.createContact({
        subAccountId: account.id,
        firstName,
        lastName: lastName || null,
        phone,
        email: email || null,
        source: source || "consultation",
        tags: consultTags,
      });
    } catch (e: any) {
      console.log(`[EXTERNAL-API] Contact creation note: ${e.message}`);
    }

    const body = [
      `Consultation Request`,
      `Name: ${name}`,
      email ? `Email: ${email}` : null,
      `Phone: ${phone}`,
      `Service: ${service}`,
      preferredDate ? `Preferred Date: ${preferredDate}` : null,
      preferredTime ? `Preferred Time: ${preferredTime}` : null,
      notes ? `Notes: ${notes}` : null,
    ].filter(Boolean).join("\n");

    await storage.createMessage({
      subAccountId: account.id,
      contactPhone: phone,
      body,
      direction: "inbound",
      channel: "form",
      status: "received",
    });

    import("./v1").then(({ fireAutomationTriggerGlobal }) => {
      const ctx = {
        leadName: name,
        leadPhone: phone,
        leadEmail: email || "",
        serviceInterest: service,
        source: source || "consultation",
        message: notes || "",
        preferredDate: preferredDate || "",
        preferredTime: preferredTime || "",
        type: "consultation",
      };
      fireAutomationTriggerGlobal("new_lead", account.id, ctx).catch((err) => console.warn("[EXTERNAL-API] promise rejected:", err instanceof Error ? err.message : err));
      fireAutomationTriggerGlobal("OnNewLead", account.id, ctx).catch((err) => console.warn("[EXTERNAL-API] promise rejected:", err instanceof Error ? err.message : err));
      fireAutomationTriggerGlobal("consultation_request", account.id, ctx).catch((err) => console.warn("[EXTERNAL-API] promise rejected:", err instanceof Error ? err.message : err));
    }).catch(e => console.error("[EXTERNAL-API] trigger error:", e instanceof Error ? e.message : e));

    publishEventAsync(EVENT_TYPES.CONTACT_CREATED, "external-api", {
      subAccountId: account.id, name, phone, email, source: "consultation",
    });

    console.log(`[EXTERNAL-API] Consultation request: ${name} → ${service} (account=${account.id})`);
    res.status(201).json({ success: true, message: "Consultation request received. Follow-up will be sent." });
  }));

  const eventSchema = z.object({
    event: z.string().min(1).max(200),
    metadata: z.record(z.string(), z.any()).optional(),
    sessionId: z.string().max(100).optional(),
    pageUrl: z.string().max(500).optional(),
    contactPhone: z.string().max(20).optional(),
    contactEmail: z.string().email().optional(),
  });

  app.post(`${PREFIX}/events`, corsHeaders, express.json(), asyncHandler(async (req, res) => {
    const account = await resolveApiKey(req);
    if (!account) return res.status(401).json({ error: "Invalid or missing API key. Set X-API-Key header." });

    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const { event, metadata, sessionId, pageUrl, contactPhone, contactEmail } = parsed.data;

    await storage.createMessage({
      subAccountId: account.id,
      contactPhone: contactPhone || contactEmail || sessionId || "event-tracking",
      body: `[Event] ${event}${pageUrl ? ` on ${pageUrl}` : ""}${metadata ? `\n${JSON.stringify(metadata)}` : ""}`,
      direction: "inbound",
      channel: "event",
      status: "received",
    });

    import("./v1").then(({ fireAutomationTriggerGlobal }) => {
      fireAutomationTriggerGlobal("external_event", account.id, {
        event,
        metadata: metadata || {},
        sessionId: sessionId || "",
        pageUrl: pageUrl || "",
        contactPhone: contactPhone || "",
        contactEmail: contactEmail || "",
      }).catch((err) => console.warn("[EXTERNAL-API] promise rejected:", err instanceof Error ? err.message : err));
    }).catch((err) => console.warn("[EXTERNAL-API] promise rejected:", err instanceof Error ? err.message : err));

    console.log(`[EXTERNAL-API] Event: ${event} (account=${account.id})`);
    res.json({ success: true, event });
  }));
}
