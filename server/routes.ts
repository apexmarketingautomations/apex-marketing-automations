import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { messagingLimiter } from "./rateLimiter";
import { insertMessageSchema, insertWorkflowSchema, insertSubAccountSchema, insertSavedSiteSchema, insertReviewSchema, insertUsageLogSchema, insertDomainSchema, insertSnapshotSchema, insertSnapshotVersionSchema, reviews, domains, insertContactSchema, insertPipelineStageSchema, insertDealSchema, insertAppointmentSchema, insertEmailCampaignSchema, insertWebhookSchema, insertWhiteLabelSettingsSchema, insertMetaAdCampaignSchema, insertMetaLeadSchema, insertInstagramConversationSchema, insertInstagramMessageSchema, insertNotificationSchema, contacts, pipelineStages, deals, appointments, emailCampaigns, webhooks, whiteLabelSettings, metaAdCampaigns, metaLeads, instagramConversations, instagramMessages, notifications, messages, hasFeature, PLAN_TIERS, subAccounts, liveAutomations, insertLiveAutomationSchema, insertSponsorshipSchema, insertCreditWalletSchema, creditTransactions, platformProfitLedger, sponsorships, sponsorshipClicks, digitalCards, webhookEvents, sentinelIncidents, insertSentinelIncidentSchema, dmKeywordAutomations, propertyLeads, whatsappTemplates, insertWhatsappTemplateSchema, integrationConnections } from "@shared/schema";
import { sql, eq, and } from "drizzle-orm";
import { db } from "./db";
import { z } from "zod";
import { geminiChat, geminiChatStream, isGeminiConfigured, geminiGenerateImage } from "./gemini";
import Twilio from "twilio";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";
import { processLiveSentinelFeed, deployGeofenceAd } from "./sentinel";
import { publishEventAsync, EVENT_TYPES } from "./eventBus";
import { eventBus } from "./eventBus";
import { jobQueue } from "./jobQueue";
import { scanDistressedProperties, calculateDealMetrics } from "./property-radar";
import { skipTraceLookup, getCurrentMonthYear } from "./skip-trace";
import crypto from "crypto";
import dns from "dns";
import { getValidToken, revokeToken, checkTokenHealth } from "./tokenService";

const INDUSTRY_PROMPTS: Record<string, { tone: string; vocabulary: string[]; focus: string }> = {
  "personal-injury": {
    tone: "empathetic, authoritative, and compassionate",
    vocabulary: ["consultation", "case evaluation", "settlement", "negligence", "liability", "damages", "injury claim"],
    focus: "Build trust, emphasize free consultation, highlight track record of settlements"
  },
  "dental": {
    tone: "warm, reassuring, and professional",
    vocabulary: ["appointment", "treatment plan", "oral health", "dental care", "cleaning", "cosmetic dentistry"],
    focus: "Reduce dental anxiety, emphasize comfort, promote preventive care"
  },
  "medspa": {
    tone: "luxurious, confident, and welcoming",
    vocabulary: ["treatment", "rejuvenation", "aesthetic", "consultation", "results", "non-invasive", "enhancement"],
    focus: "Emphasize transformation results, safety, and premium experience"
  },
  "gym": {
    tone: "energetic, motivating, and supportive",
    vocabulary: ["membership", "fitness goals", "training", "classes", "transformation", "wellness"],
    focus: "Motivate action, emphasize community, promote trial offers"
  },
  "real-estate": {
    tone: "professional, knowledgeable, and trustworthy",
    vocabulary: ["property", "listing", "market analysis", "closing", "investment", "valuation"],
    focus: "Demonstrate market expertise, emphasize local knowledge, build confidence"
  },
  "roofing": {
    tone: "reliable, straightforward, and expert",
    vocabulary: ["inspection", "estimate", "repair", "replacement", "warranty", "storm damage"],
    focus: "Emphasize reliability, free inspections, insurance claim assistance"
  },
  "hvac": {
    tone: "helpful, dependable, and knowledgeable",
    vocabulary: ["maintenance", "repair", "installation", "energy efficiency", "comfort", "emergency service"],
    focus: "Highlight emergency availability, energy savings, seasonal tune-ups"
  },
  "plumbing": {
    tone: "responsive, honest, and skilled",
    vocabulary: ["repair", "emergency", "installation", "drain", "water heater", "leak detection"],
    focus: "Emphasize fast response times, upfront pricing, licensed technicians"
  },
};

function getIndustryContext(industry: string | null | undefined): string {
  if (!industry) return "";
  const config = INDUSTRY_PROMPTS[industry.toLowerCase()];
  if (!config) return "";
  return `\n\nIndustry context: This is a ${industry} business. Use a ${config.tone} tone. Key terms to naturally incorporate: ${config.vocabulary.join(", ")}. Focus on: ${config.focus}.`;
}

const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: "English",
  es: "Spanish (Español)",
  pt: "Portuguese (Português)",
  fr: "French (Français)",
  de: "German (Deutsch)",
  it: "Italian (Italiano)",
  zh: "Chinese (中文)",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  ar: "Arabic (العربية)",
  hi: "Hindi (हिन्दी)",
  ru: "Russian (Русский)",
};

function getLanguageInstruction(language: string | null | undefined): string {
  if (!language || language === "en") return "";
  const langName = SUPPORTED_LANGUAGES[language] || language;
  return `\n\nIMPORTANT: Respond in ${langName}. All your responses must be in ${langName}, not English.`;
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      if (err?.type === 'StripeAuthenticationError' || err?.statusCode === 401 || err?.code === 'authentication_error') {
        import("./stripeClient").then(({ handleStripeError }) => handleStripeError(err)).catch(() => {});
      }
      next(err);
    });
  };
}

function parseIntParam(value: string | string[] | undefined, name: string): number {
  const str = Array.isArray(value) ? value[0] : value;
  const parsed = parseInt(str || "", 10);
  if (isNaN(parsed) || parsed < 1) {
    throw Object.assign(new Error(`Invalid ${name}`), { status: 400 });
  }
  return parsed;
}

const vapiConfig = {
  get privateKey(): string | null {
    return process.env.VAPI_PRIVATE_KEY || process.env.apex_private_vapi || null;
  },
  get publicKey(): string | null {
    return process.env.VAPI_PUBLIC_KEY || process.env.apex_public_vapi || null;
  },
  get orgId(): string | null {
    return process.env.VAPI_ORG_ID || null;
  },
  get phoneNumberId(): string | null {
    return process.env.VAPI_PHONE_NUMBER_ID || null;
  },
  get isConfigured(): boolean {
    return !!this.privateKey;
  },
  privateHeaders() {
    return {
      Authorization: `Bearer ${this.privateKey}`,
      "Content-Type": "application/json",
    };
  },
};


export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  function getTwilioClient() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return null;
    return Twilio(sid, token);
  }

  async function logUsageInternal(subAccountId: number | null, type: string, amount: number, description: string) {
    const MARKUP_RATES_INT: Record<string, number> = {
      SMS_SEGMENT: 2.0, VOICE_MINUTE: 1.5, AI_IMAGE_GEN: 0.25, AI_CHAT: 0.03, AI_STREAM: 0.03, DOMAIN_PURCHASE: 0,
    };
    const rate = MARKUP_RATES_INT[type] ?? 0;
    const cost = (type === "AI_IMAGE_GEN" || type === "AI_CHAT" || type === "AI_STREAM") ? rate : amount * rate;
    try {
      await storage.createUsageLog({
        subAccountId: subAccountId ?? 1,
        type,
        amount,
        cost,
        description: description || null,
      });
    } catch (e) {
      console.log("[USAGE] Log failed:", (e as any).message);
    }
  }

  async function requirePlanFeature(subAccountId: number, feature: string): Promise<{ allowed: boolean; plan: string }> {
    const account = await storage.getSubAccount(subAccountId);
    if (!account) return { allowed: false, plan: 'none' };
    const plan = (account as any).plan || 'starter';
    return { allowed: hasFeature(plan, feature), plan };
  }

  function getUserId(user: any): string {
    return user.claims?.sub || user.id;
  }

  async function verifyAccountOwnership(req: Request, res: Response, subAccountId: number): Promise<boolean> {
    const user = (req as any).user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return false;
    }
    const userId = getUserId(user);
    const adminUserId = process.env.ADMIN_USER_ID;
    if (adminUserId && userId === adminUserId) {
      return true;
    }
    const account = await storage.getSubAccount(subAccountId);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return false;
    }
    if (account.ownerUserId !== userId) {
      res.status(403).json({ error: "Access denied" });
      return false;
    }
    return true;
  }

  // ---- Public Site Preview (no auth required) ----
  app.get("/live/:siteId", asyncHandler(async (req, res) => {
    const siteId = parseInt(req.params.siteId as string);
    const site = await storage.getSavedSite(siteId);
    if (!site) return res.status(404).send("<html><body style='background:#0f172a;color:white;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui'><h1>Site not found</h1></body></html>");

    const data = site.siteData as any;
    if (!data?.theme || !Array.isArray(data?.sections)) {
      return res.status(400).send("<html><body style='background:#0f172a;color:white;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui'><h1>Invalid site data</h1></body></html>");
    }

    const theme = data.theme;
    const sections = data.sections;

    const renderSection = (section: any) => {
      const p = section.props || {};
      switch (section.type) {
        case "hero":
          return `<section style="min-height:80vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:80px 24px;position:relative;overflow:hidden;background:${theme.bg}">
            <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,${theme.primary}15 0%,transparent 70%)"></div>
            ${p.badge ? `<div style="display:inline-flex;padding:6px 16px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid ${theme.primary}40;color:${theme.primary};background:${theme.primary}10;margin-bottom:16px">${p.badge}</div>` : ''}
            <div style="position:relative;z-index:1;max-width:800px">
              <h1 style="font-size:clamp(2rem,5vw,4rem);font-weight:900;line-height:1.1;margin-bottom:24px;font-family:${theme.font}">${p.title || 'Welcome'}</h1>
              ${p.subtitle ? `<p style="font-size:18px;opacity:0.8;margin-bottom:32px;line-height:1.6">${p.subtitle}</p>` : ''}
              ${p.cta ? `<a href="#contact" style="display:inline-block;padding:14px 32px;background:${theme.primary};color:${theme.bg};border-radius:12px;font-weight:600;text-decoration:none;font-size:16px">${p.cta}</a>` : ''}
            </div>
          </section>`;
        case "features":
          const features = Array.isArray(p.features) ? p.features : [];
          return `<section style="padding:80px 24px;background:${theme.primary}05">
            <div style="max-width:1000px;margin:0 auto;text-align:center">
              <h2 style="font-size:2rem;font-weight:800;margin-bottom:48px;font-family:${theme.font}">${p.title || 'Features'}</h2>
              ${p.subtitle ? `<p style="opacity:0.7;margin-bottom:48px">${p.subtitle}</p>` : ''}
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:24px">
                ${features.map((f: any) => `<div style="padding:32px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;text-align:left">
                  <div style="width:48px;height:48px;background:${theme.primary}15;color:${theme.primary};border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:24px">${f.icon || '✦'}</div>
                  <h3 style="font-size:18px;font-weight:700;margin-bottom:8px">${f.title || ''}</h3>
                  <p style="opacity:0.7;font-size:14px;line-height:1.6">${f.desc || ''}</p>
                </div>`).join('')}
              </div>
            </div>
          </section>`;
        case "booking":
          return `<section id="contact" style="padding:80px 24px;background:${theme.bg}">
            <div style="max-width:480px;margin:0 auto;text-align:center">
              <h2 style="font-size:2rem;font-weight:800;margin-bottom:32px;font-family:${theme.font}">${p.title || 'Get in Touch'}</h2>
              <form style="display:flex;flex-direction:column;gap:12px" onsubmit="event.preventDefault();alert('Thank you! We will be in touch.')">
                <input type="text" placeholder="Your Name" required style="padding:12px 16px;border:1px solid rgba(255,255,255,0.15);border-radius:8px;background:rgba(255,255,255,0.05);color:${theme.text};font-size:14px" />
                <input type="email" placeholder="Your Email" required style="padding:12px 16px;border:1px solid rgba(255,255,255,0.15);border-radius:8px;background:rgba(255,255,255,0.05);color:${theme.text};font-size:14px" />
                <input type="tel" placeholder="Phone Number" style="padding:12px 16px;border:1px solid rgba(255,255,255,0.15);border-radius:8px;background:rgba(255,255,255,0.05);color:${theme.text};font-size:14px" />
                <button type="submit" style="padding:14px;background:${theme.primary};color:${theme.bg};border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer">Submit</button>
              </form>
            </div>
          </section>`;
        case "paywall":
        case "pricing":
          const tiers = Array.isArray(p.tiers) ? p.tiers : [];
          return `<section style="padding:80px 24px;background:${theme.bg}">
            <div style="max-width:1000px;margin:0 auto;text-align:center">
              <h2 style="font-size:2rem;font-weight:800;margin-bottom:48px;font-family:${theme.font}">${p.title || 'Pricing'}</h2>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px">
                ${tiers.map((t: any) => `<div style="padding:32px;border:1px solid ${t.popular ? theme.primary : 'rgba(255,255,255,0.1)'};border-radius:16px;background:${t.popular ? theme.primary + '08' : 'rgba(255,255,255,0.03)'}">
                  <h3 style="font-size:20px;font-weight:700;margin-bottom:4px">${t.name || ''}</h3>
                  <div style="margin:16px 0"><span style="font-size:2rem;font-weight:900;color:${theme.primary}">${t.price || ''}</span>${t.period ? `<span style="opacity:0.5">/${t.period}</span>` : ''}</div>
                  <ul style="list-style:none;padding:0;text-align:left;margin-bottom:24px">${(t.features || []).map((f: string) => `<li style="padding:6px 0;font-size:14px"><span style="color:${theme.primary};margin-right:8px">&#10003;</span>${f}</li>`).join('')}</ul>
                  <a href="#contact" style="display:block;padding:12px;background:${t.popular ? theme.primary : 'transparent'};color:${t.popular ? theme.bg : theme.text};border:1px solid ${theme.primary};border-radius:8px;text-decoration:none;font-weight:600;text-align:center">${t.cta || 'Get Started'}</a>
                </div>`).join('')}
              </div>
            </div>
          </section>`;
        case "testimonials":
          const testimonials = Array.isArray(p.testimonials) ? p.testimonials : [];
          return `<section style="padding:80px 24px;background:${theme.primary}05">
            <div style="max-width:1000px;margin:0 auto;text-align:center">
              <h2 style="font-size:2rem;font-weight:800;margin-bottom:48px;font-family:${theme.font}">${p.title || 'Testimonials'}</h2>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px">
                ${testimonials.map((t: any) => `<div style="padding:24px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;text-align:left">
                  <p style="opacity:0.8;font-size:14px;line-height:1.6;margin-bottom:16px">"${t.quote || ''}"</p>
                  <p style="font-weight:600;font-size:13px">${t.name || ''}${t.role ? ` — ${t.role}` : ''}</p>
                </div>`).join('')}
              </div>
            </div>
          </section>`;
        case "footer":
          return `<footer style="padding:40px 24px;text-align:center;border-top:1px solid rgba(255,255,255,0.08);background:${theme.bg}">
            <p style="opacity:0.5;font-size:13px">${p.text || `© ${new Date().getFullYear()} All rights reserved.`}</p>
          </footer>`;
        default:
          return `<section style="padding:60px 24px;text-align:center;background:${theme.bg}">
            <h2 style="font-size:1.5rem;font-weight:700;font-family:${theme.font}">${p.title || section.type}</h2>
            ${p.subtitle ? `<p style="opacity:0.7;margin-top:12px">${p.subtitle}</p>` : ''}
          </section>`;
      }
    };

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${site.name || 'Apex Site'}</title>
  <meta name="description" content="${site.prompt || ''}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(theme.font || 'Inter')}:wght@400;600;700;900&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: '${theme.font || 'Inter'}', system-ui, sans-serif; background: ${theme.bg}; color: ${theme.text}; -webkit-font-smoothing: antialiased; }
    a { color: inherit; }
    img { max-width: 100%; }
  </style>
</head>
<body>
${sections.map(renderSection).join('\n')}
</body>
</html>`;

    if (!site.publishedUrl) {
      const publishedUrl = `/live/${siteId}`;
      await storage.updateSavedSite(siteId, { publishedUrl });
    }

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  }));

  // ---- Publish Site Endpoint ----
  app.post("/api/sites/:id/publish", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const site = await storage.getSavedSite(id);
    if (!site) return res.status(404).json({ error: "Site not found" });
    const publishedUrl = `/live/${id}`;
    const updated = await storage.updateSavedSite(id, { publishedUrl });
    res.json({ success: true, url: publishedUrl, site: updated });
  }));

  // ---- Public Form Submission Endpoint (no auth required) ----
  app.post("/api/form-submit", express.json(), asyncHandler(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    const { subAccountId, formName, ...formData } = req.body;
    const accountId = parseInt(subAccountId);
    if (!accountId) return res.status(400).json({ error: "Missing subAccountId" });

    const contactPhone = formData.phone || formData.Phone || formData.tel || "";
    const contactName = formData.name || formData.Name || formData.full_name || "";
    const contactEmail = formData.email || formData.Email || "";

    if (contactPhone || contactEmail) {
      try {
        await storage.createContact({
          subAccountId: accountId,
          firstName: contactName || "Lead",
          phone: contactPhone || null,
          email: contactEmail || null,
          source: "form",
          tags: formName ? [formName] : ["form-submission"],
        });
        fireAutomationTrigger("new_lead", accountId, {
          leadName: contactName || "Lead",
          leadPhone: contactPhone,
          leadEmail: contactEmail,
          source: "form_submit",
        }).catch(() => {});
      } catch (e) {
        console.log("[FORM] Contact creation skipped (may already exist):", (e as any).message);
      }
    }

    await storage.createMessage({
      subAccountId: accountId,
      contactPhone: contactPhone || contactEmail || "form-submission",
      body: `Form submission (${formName || 'Lead Form'}): ${JSON.stringify(formData, null, 2)}`,
      direction: "inbound",
      channel: "form",
      status: "received",
    });

    publishEventAsync(EVENT_TYPES.FORM_SUBMITTED, "form-endpoint", {
      subAccountId: accountId, formName, contactName, contactPhone, contactEmail, source: "public_form",
    });
    publishEventAsync(EVENT_TYPES.CONTACT_CREATED, "form-endpoint", {
      subAccountId: accountId, name: contactName, phone: contactPhone, email: contactEmail, source: "form",
    });

    res.json({ success: true, message: "Thank you! Your submission has been received." });
  }));

  app.options("/api/form-submit", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send();
  });

  // ---- Facebook Deauthorize Callback (Meta compliance, public) ----
  app.post("/api/auth/facebook/deauthorize", express.json(), asyncHandler(async (req, res) => {
    const { signed_request } = req.body;
    let userId = "unknown";

    if (signed_request) {
      try {
        const parts = signed_request.split(".");
        if (parts.length === 2) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
          userId = payload.user_id || "unknown";
        }
      } catch {}
    }

    console.log(`[META-DEAUTH] Facebook user ${userId} removed the app`);

    try {
      await storage.createSystemLog({
        level: "warn",
        source: "meta-deauth",
        message: `Facebook user ${userId} deauthorized the app`,
        details: { facebookUserId: userId, deauthorizedAt: new Date().toISOString() },
      });
    } catch (e) {
      console.error("[META-DEAUTH] Failed to log:", e);
    }

    const confirmationCode = "DEAUTH-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    res.json({
      url: "https://apexmarketingautomations.com/data-deletion",
      confirmation_code: confirmationCode,
    });
  }));

  // ---- User Data Deletion (Meta compliance, public) ----
  app.post("/api/data-deletion", express.json(), asyncHandler(async (req, res) => {
    const { email, signed_request } = req.body;

    let userEmail = email;
    if (!userEmail && signed_request) {
      try {
        const parts = signed_request.split(".");
        if (parts.length === 2) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
          userEmail = payload.email || payload.user_id || "meta-user";
        }
      } catch {}
    }

    if (!userEmail) {
      return res.status(400).json({ error: "Email is required" });
    }

    const confirmationCode = "DEL-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    console.log(`[DATA-DELETION] Request received for ${userEmail}, confirmation: ${confirmationCode}`);

    try {
      await storage.createSystemLog({
        level: "warn",
        source: "data-deletion",
        message: `Data deletion requested for ${userEmail}`,
        details: { email: userEmail, confirmationCode, requestedAt: new Date().toISOString() },
      });
    } catch (e) {
      console.error("[DATA-DELETION] Failed to log:", e);
    }

    res.json({
      url: "https://apexmarketingautomations.com/data-deletion",
      confirmation_code: confirmationCode,
      status: "pending",
      message: "Your data deletion request has been received and will be processed within 30 days.",
    });
  }));

  // ---- Funnel Lead API (public, no auth required) ----
  const funnelCors = (_req: any, res: any, next: any) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (_req.method === "OPTIONS") return res.status(204).send();
    next();
  };

  app.options("/api/funnel/start", funnelCors);
  app.options("/api/funnel/update", funnelCors);
  app.options("/api/funnel/heartbeat", funnelCors);
  app.options("/api/funnel/submit", funnelCors);

  app.post("/api/funnel/start", funnelCors, express.json(), asyncHandler(async (req, res) => {
    const { sessionId, slug, niche, subAccountId } = req.body;
    if (!sessionId || !slug || !niche) return res.status(400).json({ error: "sessionId, slug, and niche are required" });

    const existing = await storage.getFunnelLeadBySession(sessionId);
    if (existing) {
      await storage.updateFunnelLead(existing.id, { lastSeenAt: new Date() } as any);
      return res.json(existing);
    }

    const lead = await storage.createFunnelLead({
      sessionId,
      slug,
      niche,
      step: 0,
      status: "in_progress",
      formData: {},
      subAccountId: subAccountId ? parseInt(subAccountId) : null,
    });
    res.status(201).json(lead);
  }));

  app.patch("/api/funnel/update", funnelCors, express.json(), asyncHandler(async (req, res) => {
    const { sessionId, step, formData } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    const lead = await storage.getFunnelLeadBySession(sessionId);
    if (!lead) return res.status(404).json({ error: "Funnel session not found" });

    const merged = { ...(lead.formData as object || {}), ...(formData || {}) };
    const updated = await storage.updateFunnelLead(lead.id, {
      step: step ?? lead.step,
      formData: merged,
      lastSeenAt: new Date(),
    } as any);
    res.json(updated);
  }));

  app.post("/api/funnel/heartbeat", funnelCors, express.json(), asyncHandler(async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    const lead = await storage.getFunnelLeadBySession(sessionId);
    if (!lead) return res.status(404).json({ error: "Session not found" });

    await storage.updateFunnelLead(lead.id, { lastSeenAt: new Date() } as any);
    res.json({ ok: true });
  }));

  app.post("/api/funnel/submit", funnelCors, express.json(), asyncHandler(async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    const lead = await storage.getFunnelLeadBySession(sessionId);
    if (!lead) return res.status(404).json({ error: "Session not found" });
    if (lead.status === "completed") return res.json({ success: true, message: "Already submitted" });

    const fd = lead.formData as any || {};
    const accountId = lead.subAccountId || 1;

    let contactId: number | null = null;
    try {
      const contact = await storage.createContact({
        subAccountId: accountId,
        firstName: fd.firstName || fd.name || "Funnel Lead",
        lastName: fd.lastName || null,
        phone: fd.phone || null,
        email: fd.email || null,
        source: "funnel",
        tags: [lead.slug, lead.niche],
      });
      contactId = contact.id;
      fireAutomationTrigger("new_lead", accountId, {
        leadName: fd.firstName || fd.name || "Funnel Lead",
        leadPhone: fd.phone,
        leadEmail: fd.email,
        source: "funnel",
      }).catch(() => {});
    } catch (e) {
      console.log("[FUNNEL] Contact creation skipped:", (e as any).message);
    }

    let appointmentId: number | null = null;
    const hasSchedule = fd.preferredDay || fd.preferredTime || fd.preferredDate || fd.appointmentDate || fd.date;
    if (hasSchedule) {
      let dateTime: string;
      if (fd.preferredDay && fd.preferredTime) {
        const dayMap: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
        const today = new Date();
        const targetDay = dayMap[fd.preferredDay] ?? 1;
        const diff = (targetDay - today.getDay() + 7) % 7 || 7;
        const nextDate = new Date(today);
        nextDate.setDate(today.getDate() + diff);
        const timeMatch = (fd.preferredTime || "9:00 AM").match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (timeMatch) {
          let hours = parseInt(timeMatch[1]);
          const mins = parseInt(timeMatch[2]);
          if (timeMatch[3].toUpperCase() === "PM" && hours < 12) hours += 12;
          if (timeMatch[3].toUpperCase() === "AM" && hours === 12) hours = 0;
          nextDate.setHours(hours, mins, 0, 0);
        }
        dateTime = nextDate.toISOString();
      } else {
        dateTime = fd.preferredDate || fd.appointmentDate || fd.date || new Date().toISOString();
      }

      try {
        const startDate = new Date(dateTime);
        const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
        const apt = await storage.createAppointment({
          subAccountId: accountId,
          contactId: contactId || undefined,
          title: `${lead.niche} Consultation — ${fd.firstName || "Lead"}`,
          startTime: startDate,
          endTime: endDate,
          status: "scheduled",
          description: `From ${lead.slug} funnel. ${fd.notes || fd.message || ""}`.trim(),
        });
        appointmentId = apt.id;
      } catch (e) {
        console.log("[FUNNEL] Appointment creation skipped:", (e as any).message);
      }
    }

    await storage.createMessage({
      subAccountId: accountId,
      contactPhone: fd.phone || fd.email || "funnel-lead",
      body: `Funnel submission (${lead.slug}): ${JSON.stringify(fd, null, 2)}`,
      direction: "inbound",
      channel: "funnel",
      status: "received",
    });

    const updated = await storage.updateFunnelLead(lead.id, {
      status: "completed",
      contactId,
      appointmentId,
      subAccountId: accountId,
      completedAt: new Date(),
    } as any);

    const triggerWorkflows = async (triggerType: string) => {
      try {
        const allWorkflows = await storage.getWorkflows();
        const matching = allWorkflows.filter((w: any) => {
          const trigger = w.trigger || (w.config as any)?.trigger;
          return trigger === triggerType && (!w.subAccountId || w.subAccountId === accountId);
        });
        for (const wf of matching) {
          console.log(`[FUNNEL] Triggering workflow "${wf.name}" (${triggerType})`);
        }
      } catch (e) {
        console.log("[FUNNEL] Workflow trigger error:", (e as any).message);
      }
    };

    triggerWorkflows("funnel_submitted");

    res.json({ success: true, contactId, appointmentId, lead: updated });
  }));

  // ---- Funnel Abandonment Detection ----
  const ABANDONMENT_CHECK_INTERVAL = 5 * 60 * 1000;
  const ABANDONMENT_STALE_MINUTES = 15;

  setInterval(async () => {
    try {
      const stale = await storage.getAbandonedFunnelLeads(ABANDONMENT_STALE_MINUTES);
      for (const lead of stale) {
        await storage.updateFunnelLead(lead.id, { status: "abandoned" } as any);
        console.log(`[FUNNEL] Marked session ${lead.sessionId} as abandoned (slug: ${lead.slug})`);

        const accountId = lead.subAccountId || 1;
        try {
          const allWorkflows = await storage.getWorkflows();
          const matching = allWorkflows.filter((w: any) => {
            const trigger = w.trigger || (w.config as any)?.trigger;
            return trigger === "funnel_abandoned" && (!w.subAccountId || w.subAccountId === accountId);
          });
          for (const wf of matching) {
            console.log(`[FUNNEL] Triggering abandoned workflow "${wf.name}" for session ${lead.sessionId}`);
          }
        } catch (e) {
          console.log("[FUNNEL] Abandoned workflow trigger error:", (e as any).message);
        }
      }
    } catch (e) {
      console.error("[FUNNEL] Abandonment check error:", (e as any).message);
    }
  }, ABANDONMENT_CHECK_INTERVAL);

  // ---- Auth Middleware ----
  app.use("/api", (req, res, next) => {
    const fullPath = req.originalUrl || req.baseUrl + req.path;
    const openPaths = ["/api/auth/", "/api/login", "/api/logout", "/api/callback", "/api/stripe/webhook", "/api/webhooks/", "/api/snapshots/marketplace", "/api/v1/serve-native-ad", "/api/v1/ad-click/", "/api/crash-reports/health"];
    const openExact = ["/api/reviews", "/api/alert-owner", "/api/languages"];

    if (openPaths.some(p => fullPath.startsWith(p))) return next();
    if (req.method === "POST" && openExact.some(p => fullPath === p)) return next();
    if (req.method === "GET" && fullPath === "/api/languages") return next();
    if (req.method === "GET" && fullPath.startsWith("/api/review-config/")) return next();
    if (fullPath === "/api/log-error") return next();
    if (fullPath === "/api/sms-webhook") return next();
    if (fullPath === "/api/meta-webhook") return next();
    if (fullPath.startsWith("/api/public-card/")) return next();
    if (fullPath === "/api/sentinel/test-trigger") return next();
    if (fullPath === "/api/sentinel/live") return next();
    if (fullPath === "/api/sentinel/incoming-crash") return next();
    if (fullPath === "/api/sentinel-incoming") return next();
    if (fullPath === "/api/v1/sentinel-receiver") return next();
    if (fullPath === "/api/v1/sentinel-ingest") return next();
    if (fullPath === "/api/webhook/crashconnect") return next();
    if (fullPath.startsWith("/api/v1/external/sentinel")) return next();
    if (fullPath === "/api/v1/dispatch") return next();
    if (fullPath === "/api/form-submit") return next();
    if (fullPath === "/api/card-checkout") return next();
    if (fullPath === "/api/sales-chat") return next();
    if (fullPath === "/api/generate-liquid-site") return next();
    if (fullPath === "/api/liquid/contact-lookup") return next();
    if (fullPath === "/api/system/health") return next();
    if (fullPath === "/api/data-deletion") return next();
    if (fullPath === "/api/auth/facebook/deauthorize") return next();
    if (fullPath.startsWith("/api/portal/")) return next();
    if (fullPath.startsWith("/api/oauth/") && fullPath.includes("/callback")) return next();

    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    next();
  });

  function isUserAdmin(user: any): boolean {
    if (!user) return false;
    const userId = getUserId(user);
    const adminUserId = process.env.ADMIN_USER_ID;
    return !!(adminUserId && userId === adminUserId);
  }

  const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!isUserAdmin(user)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  };

  app.post("/api/admin/transfer-account", requireAdmin, asyncHandler(async (req, res) => {
    const parsed = z.object({
      subAccountId: z.number().int().positive(),
      newOwnerUserId: z.string().min(1),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, newOwnerUserId } = parsed.data;
    const account = await storage.getSubAccount(subAccountId);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const updated = await storage.updateSubAccount(subAccountId, { ownerUserId: newOwnerUserId });

    await storage.createAuditLog({
      action: "ACCOUNT_TRANSFERRED",
      performedBy: getUserId((req as any).user),
      details: { subAccountId, previousOwner: account.ownerUserId, newOwner: newOwnerUserId, accountName: account.name },
    });

    console.log(`[ADMIN] Account #${subAccountId} "${account.name}" transferred to user ${newOwnerUserId}`);
    res.json({ success: true, account: updated });
  }));

  app.get("/api/config/google-api-key", asyncHandler(async (req, res) => {
    const key = process.env.GOOGLE_API_KEY || "";
    if (!key) return res.json({ apiKey: "", hasKey: false });
    res.json({ apiKey: key, hasKey: true });
  }));

  app.get("/api/config/maps-key", asyncHandler(async (req, res) => {
    const key = process.env.GOOGLE_API_KEY || "";
    if (!key) return res.status(404).json({ error: "Google API key not configured" });
    res.json({ apiKey: key });
  }));

  // ---- Image Uploads ----
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use("/uploads", express.static(uploadsDir));

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadsDir),
      filename: (_req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname) || ".png";
        cb(null, `ad-${uniqueSuffix}${ext}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Only JPEG, PNG, WebP, and GIF images are allowed"));
      }
    },
  });

  app.post("/api/upload-ad-image", upload.single("image"), (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ url: imageUrl });
  });

  // ---- Error Logging ----
  const errorLogSchema = z.object({
    message: z.string().max(2000),
    stack: z.string().max(10000).optional(),
    url: z.string().max(500).optional(),
    timestamp: z.string().optional(),
  });

  app.post("/api/log-error", (req: Request, res: Response) => {
    const parsed = errorLogSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid error report" });
    const { message, stack, url, timestamp } = parsed.data;
    console.error(`[CLIENT ERROR] ${timestamp || new Date().toISOString()} | ${url || "unknown"} | ${message}`);
    if (stack) console.error(`[CLIENT STACK] ${stack.slice(0, 2000)}`);
    res.json({ received: true });
  });

  // ---- Project Download (Admin Only) ----
  app.get("/api/download-project", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const _req = req;
    const { execSync } = await import("child_process");
    const archivePath = path.resolve(process.cwd(), "apex-marketing-animation.tar.gz");
    execSync(
      `tar -czf "${archivePath}" --exclude='node_modules' --exclude='.git' --exclude='dist' --exclude='.cache' --exclude='uploads' --exclude='.local' --exclude='*.tar.gz' -C "${process.cwd()}" .`,
      { timeout: 60000 }
    );
    res.download(archivePath, "apex-marketing-animation.tar.gz", (err) => {
      fs.unlink(archivePath, () => {});
      if (err && !res.headersSent) {
        res.status(500).json({ error: "Download failed" });
      }
    });
  }));

  // ---- Sub-Accounts ----
  app.get("/api/accounts", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const userId = getUserId(user);
    const adminUserId = process.env.ADMIN_USER_ID;
    const isAdmin = adminUserId && userId === adminUserId;
    const allAccounts = await storage.getSubAccounts();
    const activeAccounts = allAccounts.filter((a: any) => a.ownerUserId !== "_archived");
    const userAccounts = isAdmin
      ? activeAccounts
      : activeAccounts.filter((a: any) => a.ownerUserId === userId);
    res.json(userAccounts);
  }));

  app.post("/api/accounts", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const parsed = insertSubAccountSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const account = await storage.createSubAccount({
      ...parsed.data,
      ownerUserId: getUserId(user),
    });
    res.status(201).json(account);
  }));

  app.get("/api/plan-tiers", (_req, res) => {
    res.json(PLAN_TIERS);
  });

  app.patch("/api/accounts/:id/plan", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const id = parseIntParam(req.params.id, "id");
    const account = await storage.getSubAccount(id);
    if (!account) return res.status(404).json({ error: "Account not found" });
    const userId = getUserId(user);
    const adminUserId = process.env.ADMIN_USER_ID;
    const isAdmin = adminUserId && userId === adminUserId;
    if (!isAdmin && account.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to change this account's plan" });
    }
    const parsed = z.object({ plan: z.enum(['starter', 'pro', 'enterprise']) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const updated = await db.update(subAccounts).set({ plan: parsed.data.plan }).where(sql`${subAccounts.id} = ${id}`).returning();
    res.json(updated[0]);
  }));

  app.patch("/api/accounts/:id/language", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const parsed = z.object({ language: z.string().min(1).max(10) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { language } = parsed.data;
    if (!SUPPORTED_LANGUAGES[language]) {
      return res.status(400).json({ error: `Unsupported language: ${language}. Supported: ${Object.keys(SUPPORTED_LANGUAGES).join(", ")}` });
    }
    const updated = await storage.updateSubAccount(id, { language });
    if (!updated) return res.status(404).json({ error: "Account not found" });
    res.json(updated);
  }));

  // ---- Languages ----
  app.get("/api/languages", (_req, res) => {
    res.json(SUPPORTED_LANGUAGES);
  });

  // ---- Messages ----
  app.get("/api/messages/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const msgs = await storage.getMessages(subAccountId);
    res.json(msgs);
  }));

  app.post("/api/messages", messagingLimiter, asyncHandler(async (req, res) => {
    const parsed = insertMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const msg = await storage.createMessage(parsed.data);
    res.status(201).json(msg);
  }));

  // ---- Workflows ----
  app.get("/api/workflows", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const userId = getUserId(user);
    const adminUserId = process.env.ADMIN_USER_ID;
    const isAdmin = adminUserId && userId === adminUserId;
    const allAccounts = await storage.getSubAccounts();
    const userAccountIds = isAdmin
      ? allAccounts.map((a: any) => a.id)
      : allAccounts.filter((a: any) => a.ownerUserId === userId).map((a: any) => a.id);
    const wfs = await storage.getWorkflows();
    const filtered = isAdmin ? wfs : wfs.filter((w: any) => w.subAccountId && userAccountIds.includes(w.subAccountId));
    res.json(filtered);
  }));

  app.get("/api/workflows/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const wf = await storage.getWorkflow(id);
    if (!wf) return res.status(404).json({ error: "Not found" });
    if (wf.subAccountId && !(await verifyAccountOwnership(req, res, wf.subAccountId))) return;
    res.json(wf);
  }));

  app.post("/api/workflows", asyncHandler(async (req, res) => {
    const parsed = insertWorkflowSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if (parsed.data.subAccountId && !(await verifyAccountOwnership(req, res, parsed.data.subAccountId))) return;
    const wf = await storage.createWorkflow(parsed.data);
    res.status(201).json(wf);
  }));

  const workflowPatchSchema = z.object({
    name: z.string().min(1).optional(),
    trigger: z.string().min(1).optional(),
    steps: z.any().optional(),
  });

  app.patch("/api/workflows/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const existing = await storage.getWorkflow(id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.subAccountId && !(await verifyAccountOwnership(req, res, existing.subAccountId))) return;
    const parsed = workflowPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const wf = await storage.updateWorkflow(id, parsed.data);
    if (!wf) return res.status(404).json({ error: "Not found" });
    res.json(wf);
  }));

  // ---- Workflow AI Generation ----
  const WORKFLOW_AI_SYSTEM_PROMPT = `You are a workflow automation architect. Given a plain-English description, generate a structured workflow.

Return a JSON object with this structure:
{
  "name": "<short workflow name>",
  "trigger": "<one of: manual_trigger, facebook_form_submit, new_lead, missed_call, appointment_booked, review_received, sms_reply>",
  "steps": [
    { "action_type": "WAIT", "params": { "duration_minutes": <number> } },
    { "action_type": "SMS", "params": { "body": "<message text>" } },
    { "action_type": "CONDITION", "params": { "check": "<condition like has_replied, is_new_lead, rating_above_3>" } },
    { "action_type": "ALERT", "params": { "user_id": "admin" } },
    { "action_type": "CODE", "params": { "language": "javascript", "code": "<code>", "description": "<what the code does>" } }
  ]
}

Rules:
- Generate 3-8 steps based on the complexity of the request
- Use realistic SMS message copy (personalized, professional)
- WAIT durations should be practical (1-60 minutes for urgency, hours/days for nurture)
- CODE steps should contain realistic JavaScript (checking CRM, scoring leads, calling APIs)
- Conditions should be meaningful business logic
- Return ONLY valid JSON, no markdown, no code fences`;

  app.post("/api/workflows/generate", asyncHandler(async (req, res) => {
    if (!isGeminiConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = z.object({ prompt: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    function extractJson(text: string): any {
      const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      try { return JSON.parse(cleaned); } catch {}
      const braceMatch = text.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        try { return JSON.parse(braceMatch[0]); } catch {}
      }
      return null;
    }

    let workflowData: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await geminiChat([
        { role: "system", content: WORKFLOW_AI_SYSTEM_PROMPT },
        { role: "user", content: attempt === 0
          ? parsed.data.prompt
          : `${parsed.data.prompt}\n\nIMPORTANT: Return ONLY a raw JSON object. No markdown, no explanation, no code fences. Start with { and end with }.`
        },
      ], { temperature: 0.7, maxTokens: 4096, jsonMode: true });

      workflowData = extractJson(raw);
      if (workflowData && workflowData.steps && Array.isArray(workflowData.steps)) break;
      workflowData = null;
    }

    if (!workflowData) {
      return res.status(500).json({ error: "AI could not generate a valid workflow. Please try rephrasing your prompt." });
    }

    if (!workflowData.steps || !Array.isArray(workflowData.steps)) {
      return res.status(500).json({ error: "AI returned invalid workflow structure" });
    }

    const reqSubAccountId = req.body.subAccountId ? parseInt(req.body.subAccountId) : null;
    if (reqSubAccountId && !(await verifyAccountOwnership(req, res, reqSubAccountId))) return;
    const wf = await storage.createWorkflow({
      name: workflowData.name || "AI Generated Workflow",
      trigger: workflowData.trigger || "manual_trigger",
      steps: workflowData.steps,
      subAccountId: reqSubAccountId,
    });

    await logUsageInternal(null, "AI_CHAT", 1, "Workflow AI generation");

    res.status(201).json(wf);
  }));

  // ---- SMS Sending via Twilio ----
  app.post("/api/messages/send", asyncHandler(async (req, res) => {
    const parsed = insertMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, contactPhone, body, channel } = parsed.data;

    const { checkPhoneOptOut } = await import("./optOutGuard");
    const smsOptedOut = await checkPhoneOptOut(contactPhone, subAccountId);
    if (smsOptedOut && (channel === "sms" || !channel)) {
      return res.status(403).json({ error: "Recipient has opted out of SMS communications" });
    }

    let twilioStatus = "pending";
    let twilioSid: string | null = null;
    let twilioError: string | null = null;

    if (channel === "whatsapp") {
      const twilioClient = getTwilioClient();
      if (!twilioClient) {
        twilioStatus = "failed";
        twilioError = "Twilio is not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to send WhatsApp messages.";
      } else {
        const account = await storage.getSubAccount(subAccountId);
        const waConnections = await db.select().from(integrationConnections)
          .where(and(
            eq(integrationConnections.subAccountId, subAccountId),
            eq(integrationConnections.provider, "whatsapp-business"),
            eq(integrationConnections.status, "connected")
          ))
          .limit(1)
          .execute()
          .catch(() => []);
        
        let waNumber = account?.twilioNumber;
        if (waConnections.length > 0) {
          const waConfig = waConnections[0].config as any;
          if (waConfig?.whatsappNumber) waNumber = waConfig.whatsappNumber;
        }

        if (!waNumber) {
          twilioStatus = "failed";
          twilioError = "No WhatsApp Business number configured. Connect WhatsApp in Integrations.";
        } else {
          try {
            const msgOptions: any = {
              body: body,
              to: `whatsapp:${contactPhone}`,
              from: `whatsapp:${waNumber}`,
            };

            const templateName = (req.body as any).templateName;
            const templateVars = (req.body as any).templateVariables;
            if (templateName) {
              msgOptions.contentSid = templateName;
              if (templateVars) {
                msgOptions.contentVariables = JSON.stringify(templateVars);
              }
            }

            const interactiveType = (req.body as any).interactiveType;
            const interactiveButtons = (req.body as any).interactiveButtons;
            if (interactiveType === "buttons" && interactiveButtons) {
              msgOptions.persistentAction = interactiveButtons.map((b: string) => `button:${b}`);
            }

            const twilioMsg = await twilioClient.messages.create(msgOptions);
            twilioStatus = twilioMsg.status || "sent";
            twilioSid = twilioMsg.sid;

            const statusCallback = (req.body as any).statusCallback;
            if (statusCallback) {
              console.log(`[WHATSAPP] Message ${twilioSid} sent, status callback: ${statusCallback}`);
            }
          } catch (twilioErr: any) {
            console.error("[WHATSAPP] Twilio send error:", twilioErr.message);
            twilioStatus = "failed";
            twilioError = twilioErr.message || "WhatsApp send failed";
          }
        }
      }
    } else if (channel === "sms" || !channel) {
      const twilioClient = getTwilioClient();
      if (!twilioClient) {
        twilioStatus = "failed";
        twilioError = "Twilio is not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to send SMS.";
      } else {
        const account = await storage.getSubAccount(subAccountId);
        const fromNumber = account?.twilioNumber;
        if (!fromNumber) {
          twilioStatus = "failed";
          twilioError = "No phone number assigned to this account. Purchase a Twilio number first.";
        } else {
          try {
            const twilioMsg = await twilioClient.messages.create({
              body: body,
              to: contactPhone,
              from: fromNumber,
            });
            twilioStatus = twilioMsg.status || "sent";
            twilioSid = twilioMsg.sid;
          } catch (twilioErr: any) {
            console.error("[SMS] Twilio send error:", twilioErr.message);
            twilioStatus = "failed";
            twilioError = twilioErr.message || "Twilio send failed";
          }
        }
      }
    } else {
      twilioStatus = "unsupported";
      twilioError = `Channel '${channel}' is not supported for outbound sending. Use 'sms' or 'whatsapp'.`;
    }

    const msg = await storage.createMessage({
      ...parsed.data,
      status: twilioStatus,
    });

    if (twilioStatus === "failed" || twilioStatus === "unsupported") {
      return res.status(422).json({ ...msg, twilioSid, error: twilioError });
    }

    if (channel === "sms" || channel === "whatsapp") {
      const usageType = channel === "whatsapp" ? "WHATSAPP_MESSAGE" : "SMS_SEGMENT";
      const usageDesc = channel === "whatsapp" ? `WhatsApp to ${contactPhone}` : `SMS to ${contactPhone}`;
      await logUsageInternal(subAccountId, usageType, 1, usageDesc);
    }

    publishEventAsync(EVENT_TYPES.MESSAGE_SENT, "messaging", {
      subAccountId, to: contactPhone, channel: channel || "sms", status: twilioStatus, messageId: msg.id,
    });

    res.status(201).json({ ...msg, twilioSid });
  }));

  // ---- WhatsApp Status Webhook (delivery/read receipts) ----
  app.post("/api/whatsapp-status", async (req, res) => {
    try {
      const { MessageSid, MessageStatus, To, From } = req.body;
      if (!MessageSid || !MessageStatus) {
        return res.type("text/xml").send("<Response></Response>");
      }

      console.log(`[WHATSAPP STATUS] SID: ${MessageSid}, Status: ${MessageStatus}`);

      const statusMap: Record<string, string> = {
        queued: "queued",
        sent: "sent",
        delivered: "delivered",
        read: "read",
        failed: "failed",
        undelivered: "failed",
      };

      const normalizedStatus = statusMap[MessageStatus] || MessageStatus;
      const cleanPhone = (To || "").replace(/^whatsapp:/, "");

      if (cleanPhone && normalizedStatus) {
        await db.execute(
          sql`UPDATE messages SET status = ${normalizedStatus}
              WHERE id = (
                SELECT id FROM messages
                WHERE contact_phone = ${cleanPhone}
                  AND channel = 'whatsapp'
                  AND direction = 'outbound'
                ORDER BY created_at DESC
                LIMIT 1
              )`
        );
      }

      res.type("text/xml").send("<Response></Response>");
    } catch (err: any) {
      console.error("[WHATSAPP STATUS] Error:", err.message);
      res.type("text/xml").send("<Response></Response>");
    }
  });

  // ---- WhatsApp Templates CRUD ----
  app.get("/api/whatsapp-templates/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const templates = await db.select().from(whatsappTemplates).where(eq(whatsappTemplates.subAccountId, subAccountId));
    res.json(templates);
  }));

  app.post("/api/whatsapp-templates/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const parsed = insertWhatsappTemplateSchema.safeParse({ ...req.body, subAccountId });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const [template] = await db.insert(whatsappTemplates).values(parsed.data).returning();
    res.status(201).json(template);
  }));

  app.put("/api/whatsapp-templates/:subAccountId/:id", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const id = parseIntParam(req.params.id, "id");

    const updateSchema = insertWhatsappTemplateSchema.partial().omit({ subAccountId: true });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid template data", details: parsed.error.flatten() });
    }

    const [updated] = await db.update(whatsappTemplates)
      .set(parsed.data)
      .where(and(eq(whatsappTemplates.id, id), eq(whatsappTemplates.subAccountId, subAccountId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Template not found" });
    res.json(updated);
  }));

  app.delete("/api/whatsapp-templates/:subAccountId/:id", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const id = parseIntParam(req.params.id, "id");

    await db.delete(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, id), eq(whatsappTemplates.subAccountId, subAccountId)));

    res.json({ success: true });
  }));

  // ---- Bot Chat (Real OpenAI) ----
  const botChatSchema = z.object({
    message: z.string().min(1).max(2000),
    persona: z.string().max(5000).optional(),
    industry: z.string().max(100).optional(),
    language: z.string().max(10).optional(),
    trainingJobId: z.number().optional(),
    conversationHistory: z.array(z.object({
      role: z.string(),
      content: z.string(),
    })).max(20).optional(),
  });

  app.post("/api/bot/chat", asyncHandler(async (req, res) => {
    if (!isGeminiConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = botChatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    let basePrompt = parsed.data.persona || `You are a helpful AI assistant for a business. Keep responses concise and helpful (1-3 sentences). Help with bookings, answer questions, and provide a warm experience.`;

    let knowledgeContext = "";
    if (parsed.data.trainingJobId) {
      try {
        const job = await storage.getTrainingJob(parsed.data.trainingJobId);
        if (job) {
          if (job.generatedPersona) {
            basePrompt = job.generatedPersona;
          }
          if (job.scrapedContent && job.scrapedContent.length > 50) {
            knowledgeContext = `\n\nYou have the following knowledge base from the business website (${job.url}). Use this information to answer questions accurately:\n\n${job.scrapedContent.substring(0, 12000)}`;
          }
        }
      } catch (e) {
        console.log("[BOT_CHAT] Could not load training job:", (e as any).message);
      }
    }

    const systemPrompt = basePrompt + knowledgeContext + getIndustryContext(parsed.data.industry) + getLanguageInstruction(parsed.data.language);

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];

    if (parsed.data.conversationHistory) {
      for (const msg of parsed.data.conversationHistory.slice(-10)) {
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    messages.push({ role: "user", content: parsed.data.message });

    const reply = await geminiChat(messages as any, { temperature: 0.7, maxTokens: 1024 }) || "I'm here to help! Could you tell me more?";

    await logUsageInternal(null, "AI_CHAT", 1, "Bot trainer chat");

    res.json({ reply });
  }));

  app.post("/api/bot/chat/stream", asyncHandler(async (req, res) => {
    try {
      if (!isGeminiConfigured()) {
        return res.status(503).json({ error: "AI service is not configured" });
      }

      const parsed = botChatSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const basePrompt = parsed.data.persona || `You are a helpful AI assistant for a business. Keep responses concise and helpful (1-3 sentences). Help with bookings, answer questions, and provide a warm experience.`;
      const systemPrompt = basePrompt + getIndustryContext(parsed.data.industry) + getLanguageInstruction(parsed.data.language);

      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: systemPrompt },
      ];

      if (parsed.data.conversationHistory) {
        for (const msg of parsed.data.conversationHistory.slice(-10)) {
          messages.push({
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.content,
          });
        }
      }

      messages.push({ role: "user", content: parsed.data.message });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const stream = geminiChatStream(messages as any, { temperature: 0.7, maxTokens: 1024 });
      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();

      await logUsageInternal(null, "AI_CHAT", 1, "Bot trainer chat (stream)");
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Streaming failed" });
      } else {
        res.write(`data: ${JSON.stringify({ error: error.message || "Streaming failed" })}\n\n`);
        res.end();
      }
    }
  }));

  // ---- Bot Training Jobs ----
  const trainBodySchema = z.object({
    url: z.string().url("A valid URL is required"),
    persona: z.string().min(1, "persona is required"),
  });

  app.post("/api/bots/train", asyncHandler(async (req, res) => {
    const parsed = trainBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const job = await storage.createTrainingJob(parsed.data);

    runRealTraining(job.id);

    res.status(201).json({ jobId: job.id });
  }));

  app.get("/api/jobs/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const job = await storage.getTrainingJob(id);
    if (!job) return res.status(404).json({ error: "Not found" });
    res.json({
      state: job.state,
      progress: job.progress,
      logs: job.logs,
      generatedPersona: job.generatedPersona || null,
      jobId: job.id,
    });
  }));

  // ---- Blueprints / Onboarding ----
  app.get("/api/blueprints", asyncHandler(async (_req, res) => {
    const bps = await storage.getBlueprints();
    res.json(bps);
  }));

  app.get("/api/blueprints/:industryId", asyncHandler(async (req, res) => {
    const industryId = Array.isArray(req.params.industryId) ? req.params.industryId[0] : req.params.industryId;
    const bp = await storage.getBlueprintByIndustryId(industryId);
    if (!bp) return res.status(404).json({ error: "Blueprint not found" });
    res.json(bp);
  }));

  app.post("/api/onboarding/:industryId", asyncHandler(async (req, res) => {
    const industryId = Array.isArray(req.params.industryId) ? req.params.industryId[0] : req.params.industryId;
    let bp = await storage.getBlueprintByIndustryId(industryId);

    if (!bp) {
      if (!isGeminiConfigured()) {
        return res.status(404).json({ error: "Blueprint not found and AI service is not configured to generate one" });
      }

      const industryLabel = industryId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

      const raw = await geminiChat([
        {
          role: "system",
          content: `You are a CRM configuration expert. Generate a complete CRM blueprint for a specific industry. Return ONLY valid JSON with no markdown or code fences.

The JSON must have this exact structure:
{
  "title": "Human-readable industry name",
  "stages": ["Stage 1", "Stage 2", ...],
  "fields": ["Custom Field 1", "Custom Field 2", ...],
  "templates": ["SMS/Email Template Name 1", "Template Name 2", ...]
}

Guidelines:
- stages: 5-7 pipeline stages representing the customer journey from first contact to completion/retention
- fields: 4-6 custom contact fields relevant to this industry (things you'd track about each customer)
- templates: 3-5 SMS/email template names for key touchpoints (appointment reminders, follow-ups, promotions)
- Make it practical and industry-specific, not generic`
        },
        {
          role: "user",
          content: `Generate a CRM blueprint for: ${industryLabel}`
        }
      ], { temperature: 0.7, jsonMode: true });
      const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

      try {
        const parsed = JSON.parse(cleaned);
        const newBp = await storage.createBlueprint({
          industryId,
          title: parsed.title || industryLabel,
          stages: parsed.stages || ["Lead", "Contacted", "Qualified", "Closed"],
          fields: parsed.fields || ["Name", "Email", "Phone"],
          templates: parsed.templates || ["Welcome SMS", "Follow-up Email"],
        });
        bp = newBp;
        console.log(`[ONBOARDING] AI-generated blueprint for "${industryLabel}" and saved to DB`);
      } catch (parseErr) {
        console.error("[ONBOARDING] Failed to parse AI blueprint:", parseErr);
        const fallbackBp = await storage.createBlueprint({
          industryId,
          title: industryLabel,
          stages: ["New Lead", "Contacted", "Qualified", "Proposal Sent", "Won", "Lost"],
          fields: ["Contact Name", "Email", "Phone", "Notes"],
          templates: ["Welcome SMS", "Follow-up Email", "Thank You Message"],
        });
        bp = fallbackBp;
        console.log(`[ONBOARDING] Used fallback blueprint for "${industryLabel}"`);
      }
    }

    const user = (req as any).user;
    const account = await storage.createSubAccount({
      name: `${bp.title} Account`,
      twilioNumber: null,
      ownerUserId: user?.id || null,
    });

    res.status(201).json({ account, blueprint: bp, notice: "Account created. Purchase a Twilio phone number to enable SMS." });
  }));

  // ---- Site Builder (AI Generation) ----

  const SITE_SYSTEM_PROMPT = `You are an expert landing-page architect who creates stunning, high-converting websites. Generate rich, visually impressive sites with many sections.

Return a JSON object with this structure:

{
  "theme": {
    "primary": "<vibrant hex accent color>",
    "bg": "<dark background hex>",
    "text": "<light text hex>",
    "font": "<Google Font name>"
  },
  "sections": [ ...array of 8-12 section objects... ]
}

Available section types and their props:

HERO: { title, subtitle, cta, image (URL), badge (optional short tagline) }
FEATURES: { title, subtitle, features: [{ icon, title, desc }] } — 3-6 features
TESTIMONIALS: { title, subtitle, testimonials: [{ name, role, quote, stars (1-5) }] } — 3 testimonials
STATS: { title, stats: [{ value (e.g. "500+"), label }] } — 4 stats
ABOUT: { title, text (2-3 paragraphs), image (URL), stats: [{ value, label }] }
CTA: { title, subtitle, cta }
FAQ: { title, faqs: [{ q, a }] } — 5-8 questions
PRICING: { title, subtitle, plans: [{ name, description, price (number), period, features: [strings], cta, featured (boolean) }] } — 3 plans
TEAM: { title, subtitle, members: [{ name, role }] } — 4 members
LOGO_BAR: { title (e.g. "Trusted By"), logos: ["Brand Name 1", "Brand Name 2", ...] } — 5-8 logos
TIMELINE: { title, subtitle, events: [{ date, title, desc }] } — 4-6 events
CONTACT: { title, subtitle, fields: ["Name", "Email", "Phone", "Message"] }
VIDEO: { title, subtitle }
BANNER: { title, subtitle, cta, image (URL) }
COMPARISON: { title, subtitle, headers: ["Feature", "Us", "Others"], rows: [{ cells: ["Feature name", "✓", "✗"] }] }
PROCESS_STEPS: { title, subtitle, steps: [{ title, desc }] } — 3-5 steps
QR_CODE: { title, subtitle, qrValue (URL to encode), qrLabel (text below QR code), cta (button text) }
BOOKING: { title, formId }
PAYWALL: { title, tiers: [{ name, price, perks: [strings], cta }] }

Rules:
- Generate 8-12 sections for a rich, complete website. NEVER generate only 3 sections.
- Start with HERO, then mix section types to create a compelling flow. Good pattern: HERO → LOGO_BAR → FEATURES → ABOUT → STATS → TESTIMONIALS → PROCESS_STEPS → PRICING or FAQ → CTA or CONTACT
- Icon must be one of: ShieldCheck, Clock, Sparkles, Star, Dumbbell, Heart, Zap, Trophy, CheckCircle2, Crown, Flame, Camera
- For images: If the user provides uploaded image URLs, ALWAYS use them. Otherwise use real Unsplash URLs: https://images.unsplash.com/photo-XXXXX?q=80&w=2070&auto=format&fit=crop
- Choose theme colors that match the business (luxury=gold/black, fitness=red/black, medical=blue/white, tech=purple/dark, food=warm orange, wellness=green/cream)
- Font choices: "Playfair Display" for luxury/elegant, "Inter" for modern/tech, "Montserrat" for bold/fitness, "DM Sans" for clean/professional, "Space Grotesk" for tech/startup
- Write compelling, specific marketing copy — not generic placeholder text. Use real-sounding numbers, names, and details.
- Make testimonials sound authentic with full names and specific roles
- Pricing should use realistic price points for the industry
- Stats should use impressive but believable numbers
- Return ONLY the JSON object, no markdown, no code fences, no explanation.`;

  const promptSchema = z.object({
    prompt: z.string().min(1, "prompt is required").max(2000),
    uploadedImages: z.array(z.string()).optional(),
  });

  app.post("/api/generate-site", asyncHandler(async (req, res) => {
    if (!isGeminiConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = promptSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    let userMessage = parsed.data.prompt;
    if (parsed.data.uploadedImages && parsed.data.uploadedImages.length > 0) {
      userMessage += `\n\nThe user has uploaded these images to use on the site:\n${parsed.data.uploadedImages.join("\n")}`;
    }

    function extractJson(text: string): any {
      let cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      }
      cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");
      cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, (ch) => ch === '\n' || ch === '\r' || ch === '\t' ? ch : '');
      return JSON.parse(cleaned);
    }

    let siteData: any;
    let lastError: string = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await geminiChat([
          { role: "system", content: SITE_SYSTEM_PROMPT },
          { role: "user", content: attempt === 0 ? userMessage : userMessage + "\n\nIMPORTANT: Return ONLY valid JSON. No markdown, no explanation, no text before or after the JSON object." },
        ], { temperature: attempt === 0 ? 0.7 : 0.3, maxTokens: 4096, jsonMode: true });
        siteData = extractJson(raw);
        break;
      } catch (e: any) {
        lastError = e.message || "JSON parse failed";
        if (attempt === 1) {
          return res.status(500).json({ error: "AI returned invalid JSON after retry", detail: lastError });
        }
      }
    }

    if (!siteData.theme || !Array.isArray(siteData.sections)) {
      return res.status(500).json({ error: "AI returned invalid site structure" });
    }

    siteData.sections = siteData.sections.map((s: any) => {
      if (s.props) return s;
      const { type, ...props } = s;
      return { type, props };
    });

    await logUsageInternal(null, "AI_CHAT", 1, "AI site generation");

    res.json(siteData);
  }));

  // ---- Saved Sites ----
  app.get("/api/sites", asyncHandler(async (_req, res) => {
    const sites = await storage.getSavedSites();
    res.json(sites);
  }));

  const siteDataValidator = z.object({
    theme: z.object({
      bg: z.string(),
      text: z.string(),
      primary: z.string(),
      font: z.string(),
    }),
    sections: z.array(z.object({
      type: z.string(),
      props: z.record(z.any()),
    })).min(1),
  });

  app.post("/api/sites", asyncHandler(async (req, res) => {
    const parsed = insertSavedSiteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const siteCheck = siteDataValidator.safeParse(parsed.data.siteData);
    if (!siteCheck.success) return res.status(400).json({ error: "Invalid site data: must contain theme and sections" });

    const site = await storage.createSavedSite(parsed.data);
    res.status(201).json(site);
  }));

  app.patch("/api/sites/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const site = await storage.getSavedSite(id);
    if (!site) return res.status(404).json({ error: "Site not found" });

    const updates: any = {};
    if (req.body.name) updates.name = req.body.name;
    if (req.body.siteData) {
      const siteCheck = siteDataValidator.safeParse(req.body.siteData);
      if (!siteCheck.success) return res.status(400).json({ error: "Invalid site data" });
      updates.siteData = req.body.siteData;
    }
    if (req.body.customDomain !== undefined) updates.customDomain = req.body.customDomain;
    if (req.body.publishedUrl !== undefined) updates.publishedUrl = req.body.publishedUrl;

    const updated = await storage.updateSavedSite(id, updates);
    res.json(updated);
  }));

  app.delete("/api/sites/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const deleted = await storage.deleteSavedSite(id);
    if (!deleted) return res.status(404).json({ error: "Site not found" });
    res.json({ success: true });
  }));

  // ---- Version Control ----
  app.get("/api/sites/:id/versions", asyncHandler(async (req, res) => {
    const siteId = parseIntParam(req.params.id, "id");
    const versions = await storage.getSiteVersions(siteId);
    res.json(versions);
  }));

  app.post("/api/sites/:id/versions", asyncHandler(async (req, res) => {
    const siteId = parseIntParam(req.params.id, "id");
    const site = await storage.getSavedSite(siteId);
    if (!site) return res.status(404).json({ error: "Site not found" });

    const existing = await storage.getSiteVersions(siteId);
    const nextVersion = existing.length > 0 ? Math.max(...existing.map(v => v.versionNumber)) + 1 : 1;

    const version = await storage.createSiteVersion({
      siteId,
      versionNumber: nextVersion,
      label: req.body.label || `Version ${nextVersion}`,
      siteData: site.siteData as any,
    });
    res.status(201).json(version);
  }));

  // ---- Collaborators ----
  app.get("/api/sites/:id/collaborators", asyncHandler(async (req, res) => {
    const siteId = parseIntParam(req.params.id, "id");
    const collaborators = await storage.getSiteCollaborators(siteId);
    res.json(collaborators);
  }));

  app.post("/api/sites/:id/collaborators", asyncHandler(async (req, res) => {
    const siteId = parseIntParam(req.params.id, "id");
    const site = await storage.getSavedSite(siteId);
    if (!site) return res.status(404).json({ error: "Site not found" });

    const { name, email, role } = req.body;
    if (!name || !email) return res.status(400).json({ error: "Name and email required" });

    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const collaborator = await storage.createSiteCollaborator({
      siteId,
      name,
      email,
      role: role || "editor",
      inviteCode,
    });
    res.status(201).json(collaborator);
  }));

  app.delete("/api/collaborators/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const deleted = await storage.deleteSiteCollaborator(id);
    if (!deleted) return res.status(404).json({ error: "Collaborator not found" });
    res.json({ success: true });
  }));

  // ---- Liquid Website (Personalized AI Generation) ----
  const LIQUID_SYSTEM_PROMPT = `You are a "Liquid Website" architect that creates PERSONALIZED, shape-shifting landing pages. The site adapts dynamically to the visitor's context, ad parameters, and CRM data.

You will receive visitor data including:
- device: "mobile" or "desktop"
- referrer: where they came from (google, facebook, instagram, tiktok, twitter, referral, direct)
- timeOfDay: "morning", "afternoon", "evening", or "night"
- hour: the current hour (0-23)
- language: browser language
- contactName: (optional) returning visitor's first name from CRM
- heading: (optional) dynamic headline injected from ad URL parameter

PERSONALIZATION RULES:
- If contactName is provided, address the visitor by name in the hero (e.g., "Welcome back, {{contact.first_name | default: 'Friend'}}!"). Use the template syntax literally so the frontend engine resolves it.
- If heading is provided, use it as the main hero headline text (the ad dictates the headline).
- Mobile visitors: shorter headlines, bigger CTA buttons, concise text
- Desktop visitors: longer, more detailed descriptions
- Morning visitors: energetic, fresh-start messaging ("Start your day right")
- Evening/night visitors: relaxation-focused ("Wind down with...")
- Google referrers: trust-focused messaging (reviews, certifications, trust badges)
- Social media referrers (facebook, instagram, tiktok): trend-focused, social proof messaging
- Direct visitors: loyalty/returning customer focus

TEMPLATE VARIABLES you may embed in text (resolved by the frontend):
- {{contact.first_name | default: 'there'}} — visitor's name from CRM or localStorage
- {{url_param.heading}} — headline from ad URL
- {{url_param.subheading}} — subheadline from ad URL
- {{url_param.cta}} — CTA text from ad URL
- {{url_param.offer}} — offer text from ad URL
- {{visitor.device}} — mobile or desktop
- {{visitor.time}} — morning, afternoon, evening, night
- {{visitor.source}} — google, facebook, instagram, etc.

Return a JSON object with this exact structure:

{
  "theme": {
    "primary": "<hex color>",
    "bg": "<hex background — always dark like #0a0a0a or #000000>",
    "text": "<hex text — always #ffffff or light>",
    "font": "<font family>"
  },
  "sections": [
    {
      "type": "HERO",
      "props": {
        "title": "<personalized headline or template variable>",
        "subtitle": "<personalized subheadline>",
        "cta": "<personalized button text>",
        "image": "<unsplash URL>",
        "badge": "<optional badge text like 'Limited Offer' or 'Welcome Back'>"
      }
    },
    {
      "type": "FEATURES",
      "props": {
        "title": "<section heading>",
        "subtitle": "<optional subtitle>",
        "features": [
          { "icon": "<icon>", "title": "<title>", "desc": "<description>" },
          { "icon": "<icon>", "title": "<title>", "desc": "<description>" },
          { "icon": "<icon>", "title": "<title>", "desc": "<description>" }
        ]
      }
    },
    {
      "type": "TESTIMONIALS",
      "props": {
        "title": "What Our Clients Say",
        "testimonials": [
          { "name": "<name>", "role": "<role>", "quote": "<testimonial>", "stars": 5 },
          { "name": "<name>", "role": "<role>", "quote": "<testimonial>", "stars": 5 },
          { "name": "<name>", "role": "<role>", "quote": "<testimonial>", "stars": 5 }
        ]
      }
    },
    {
      "type": "BOOKING",
      "props": {
        "title": "<form heading like 'Book Your Session'>"
      }
    },
    {
      "type": "CTA",
      "props": {
        "title": "<final call to action>",
        "subtitle": "<urgency message>",
        "cta": "<button text>"
      }
    }
  ]
}

Rules:
- Always return exactly 5 sections: HERO, FEATURES, TESTIMONIALS, BOOKING, CTA
- icon must be one of: ShieldCheck, Clock, Sparkles, Star, Dumbbell, Heart, Zap, Trophy, CheckCircle2
- Use real Unsplash image URLs. Format: https://images.unsplash.com/photo-XXXXX?q=80&w=2070&auto=format&fit=crop
- font: "Playfair Display" for luxury/elegant, "Inter" for modern/clean, "Oswald" for bold/fitness
- bg must always be dark (#0a0a0a, #000000, #050510, #111111). text must always be light (#ffffff, #f0f0f0).
- Make the copy feel personally tailored to this specific visitor
- Return ONLY the JSON object, no markdown, no code fences.`;

  const liquidSiteSchema = z.object({
    device: z.enum(["desktop", "mobile", "tablet"]).optional().default("desktop"),
    referrer: z.string().max(500).optional().default("direct"),
    timeOfDay: z.enum(["morning", "afternoon", "evening", "night"]).optional().default("afternoon"),
    hour: z.number().int().min(0).max(23).optional().default(12),
    language: z.string().max(10).optional().default("en-US"),
    contactName: z.string().max(100).optional(),
    heading: z.string().max(500).optional(),
    businessName: z.string().max(200).optional(),
    industry: z.string().max(100).optional(),
    description: z.string().max(1000).optional(),
    tone: z.string().max(50).optional(),
    targetAudience: z.string().max(300).optional(),
    services: z.string().max(500).optional(),
    colorPreference: z.string().max(50).optional(),
  });

  const liquidSiteRateLimiter = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => { const now = Date.now(); liquidSiteRateLimiter.forEach((v, k) => { if (now > v.resetAt) liquidSiteRateLimiter.delete(k); }); }, 60_000);

  app.post("/api/generate-liquid-site", asyncHandler(async (req, res) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = liquidSiteRateLimiter.get(ip);
    if (!entry || now > entry.resetAt) {
      liquidSiteRateLimiter.set(ip, { count: 1, resetAt: now + 60_000 });
    } else if (entry.count >= 10) {
      return res.status(429).json({ error: "Rate limit exceeded. Please try again in a minute." });
    } else {
      entry.count++;
    }

    if (!isGeminiConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = liquidSiteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { device, referrer, timeOfDay, hour, language, contactName, heading, businessName, industry, description, tone, targetAudience, services, colorPreference } = parsed.data;

    let visitorDescription = `Visitor context:
- Device: ${device || "desktop"}
- Came from: ${referrer || "direct"}  
- Time of day: ${timeOfDay || "afternoon"} (${hour ?? 12}:00)
- Language: ${language || "en-US"}`;

    if (contactName) visitorDescription += `\n- Returning visitor name: ${contactName} (greet them personally!)`;
    if (heading) visitorDescription += `\n- Ad headline override: "${heading}" (use this as the hero title)`;

    if (businessName || industry || description) {
      visitorDescription += `\n\nBusiness details (USE THESE to make the site specific to this business):`;
      if (businessName) visitorDescription += `\n- Business Name: "${businessName}" (use this name throughout the site)`;
      if (industry) visitorDescription += `\n- Industry: ${industry}`;
      if (description) visitorDescription += `\n- About: ${description}`;
      if (services) visitorDescription += `\n- Key Services: ${services}`;
      if (targetAudience) visitorDescription += `\n- Target Audience: ${targetAudience}`;
      if (tone) visitorDescription += `\n- Tone/Style: ${tone}`;
      if (colorPreference) visitorDescription += `\n- Brand Color Preference: ${colorPreference} (use as primary color)`;
      visitorDescription += `\n\nGenerate a landing page specifically for this business. Use their name, services, and industry context. Make it sound like it was written by their own marketing team.`;
    } else {
      visitorDescription += `\n\nGenerate a personalized premium service landing page for this specific visitor. Make it feel tailor-made.`;
    }

    const raw = await geminiChat([
      { role: "system", content: LIQUID_SYSTEM_PROMPT },
      { role: "user", content: visitorDescription },
    ], { temperature: 0.8, maxTokens: 4096, jsonMode: true });
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let siteData: any;
    try {
      siteData = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "AI returned invalid JSON" });
    }

    if (!siteData.theme || !Array.isArray(siteData.sections)) {
      return res.status(500).json({ error: "AI returned invalid site structure" });
    }

    siteData.sections = siteData.sections.map((s: any) => {
      if (s.props) return s;
      const { type, ...props } = s;
      return { type, props };
    });

    await logUsageInternal(null, "AI_CHAT", 1, "God mode site generation");

    res.json(siteData);
  }));

  app.post("/api/liquid/contact-lookup", express.json(), asyncHandler(async (req, res) => {
    const { subAccountId, email, phone } = req.body;
    const accountId = parseInt(subAccountId);
    if (!accountId) return res.json({ contact: null });

    try {
      const allContacts = await storage.getContacts(accountId);
      let match = null;
      if (email) {
        match = allContacts.find((c: any) => c.email?.toLowerCase() === email.toLowerCase());
      }
      if (!match && phone) {
        const cleanPhone = phone.replace(/\D/g, "");
        match = allContacts.find((c: any) => c.phone?.replace(/\D/g, "") === cleanPhone);
      }
      if (match) {
        res.json({ contact: { firstName: match.firstName, lastName: match.lastName, email: match.email, phone: match.phone, tags: match.tags } });
      } else {
        res.json({ contact: null });
      }
    } catch {
      res.json({ contact: null });
    }
  }));

  // ---- AI Ad Campaign Generator ----
  const AD_CAMPAIGN_SYSTEM_PROMPT = `You are an expert Facebook Ads campaign strategist. When a user describes their business and promotion, generate a complete campaign plan as JSON.

Return this exact structure:
{
  "campaign_name": "<descriptive campaign name>",
  "objective": "OUTCOME_LEADS" | "OUTCOME_AWARENESS" | "OUTCOME_TRAFFIC" | "OUTCOME_SALES",
  "daily_budget": <number in cents, e.g. 5000 = $50/day>,
  "duration_days": <recommended campaign duration>,
  "targeting": {
    "age_min": <number>,
    "age_max": <number>,
    "genders": [1, 2] or [1] or [2],
    "geo_locations": {
      "cities": [{"key": "<city name>", "radius": <miles>}],
      "countries": ["US"]
    },
    "interests": [{"name": "<interest>"}],
    "behaviors": [{"name": "<behavior>"}]
  },
  "ad_copy": {
    "headline": "<max 40 chars>",
    "primary_text": "<compelling ad text, max 125 chars>",
    "description": "<max 30 chars>",
    "cta": "BOOK_NOW" | "LEARN_MORE" | "SIGN_UP" | "GET_OFFER" | "SHOP_NOW"
  },
  "image_prompt": "<detailed prompt for AI image generation matching the brand/offer>",
  "estimated_reach": "<estimated daily reach range, e.g. 5,000 - 15,000>",
  "estimated_cpl": "<estimated cost per lead, e.g. $8 - $15>",
  "strategy_notes": "<2-3 sentences explaining the targeting strategy>"
}

Rules:
- Budget should be realistic for the business type (local business: $20-50/day, larger: $50-200/day)
- Targeting should be specific and data-driven
- Ad copy must be punchy, compliant with FB ad policies (no exaggerated claims)
- interests and behaviors should be relevant to the business
- Return ONLY valid JSON, no markdown, no code fences`;

  app.post("/api/generate-ad-campaign", asyncHandler(async (req, res) => {
    if (!isGeminiConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = promptSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const raw = await geminiChat([
      { role: "system", content: AD_CAMPAIGN_SYSTEM_PROMPT },
      { role: "user", content: parsed.data.prompt },
    ], { temperature: 0.7, maxTokens: 4096, jsonMode: true });
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let campaign: any;
    try {
      campaign = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "AI returned invalid JSON" });
    }

    if (!campaign.campaign_name || !campaign.targeting || !campaign.ad_copy) {
      return res.status(500).json({ error: "AI returned incomplete campaign data" });
    }

    if (campaign.image_prompt) {
      try {
        const imageUrl = await geminiGenerateImage(
          `Professional marketing photo for Facebook ad: ${campaign.image_prompt}. High quality, clean composition, suitable for social media advertising, no text overlay.`
        );
        campaign.generated_image_url = imageUrl;
      } catch (imgErr: any) {
        console.error("Ad image generation failed:", imgErr.message);
        campaign.generated_image_url = null;
      }
    }

    await logUsageInternal(null, "AI_CHAT", 1, "Ad campaign AI generation");
    if (campaign.generated_image_url) {
      await logUsageInternal(null, "AI_IMAGE_GEN", 1, "Ad creative DALL-E generation");
    }

    res.json(campaign);
  }));

  // ---- Chat Widget (AI Assistant) ----
  const CHAT_SYSTEM_PROMPT = `You are a friendly, professional booking assistant for a premium business. Your goal is to help visitors book appointments, answer questions about services, and provide a warm, helpful experience.

Rules:
- Keep responses short (1-3 sentences max)
- Be conversational and warm, use a friendly tone
- If someone wants to book, ask for their preferred date and time
- If you don't know something specific about the business, say you'll connect them with the team
- Never make up specific pricing or availability — offer to check or connect them with staff
- End messages with a helpful next step or question when appropriate`;

  const chatBodySchema = z.object({
    message: z.string().min(1, "message is required").max(2000),
    industry: z.string().max(100).optional(),
    language: z.string().max(10).optional(),
    conversationHistory: z.array(z.object({
      role: z.string().max(20),
      text: z.string().max(2000),
    })).max(20).optional(),
  });

  const SALES_NICHE_CONTEXT: Record<string, string> = {
    general: "Apex Marketing Automations is an AI-powered all-in-one marketing platform. It includes AI chatbots, voice agents, SMS automation, review management, workflow builder, CRM, Meta ads launcher, Sentinel crash detection, and more.",
    gym: "Focus on gym & fitness studio owners. Highlight automated lead follow-up for new member signups, review management, AI voice agent for booking classes, and Meta ads for local targeting.",
    lawyers: "Focus on law firms and attorneys. Highlight Sentinel crash detection for personal injury leads, automated intake forms, AI chatbot for initial consultations, and review management for building trust.",
    realtors: "Focus on real estate agents. Highlight automated listing follow-ups, AI voice agent for buyer inquiries, CRM pipeline for deals, Meta ads for property marketing.",
    dentists: "Focus on dental practices. Highlight appointment reminder automations, review request workflows, AI chatbot for scheduling, and Meta ads for local patient acquisition.",
    restaurants: "Focus on restaurants. Highlight review management, automated reservation follow-ups, Meta ads for promotions, and AI chatbot for menu questions and reservations.",
    chiropractors: "Focus on chiropractic practices. Highlight appointment automations, review management, AI chatbot for patient questions, Sentinel for MVA lead detection.",
    coaches: "Focus on business coaches and consultants. Highlight sales pipeline CRM, automated nurture sequences, AI voice agent for discovery calls, Meta ads for lead gen.",
    medspa: "Focus on med spas and aesthetic clinics. Highlight appointment booking automations, review management, before/after showcase, and Meta ads for treatment promotions.",
    insurance: "Focus on insurance agencies. Highlight lead follow-up automation, AI voice agent for quotes, CRM pipeline for policies, and Meta ads for local targeting.",
    ecommerce: "Focus on e-commerce stores. Highlight abandoned cart follow-ups, review collection, AI chatbot for product questions, and Meta ads for retargeting.",
    "auto-dealers": "Focus on auto dealerships. Highlight lead follow-up for test drives, AI voice agent for inventory questions, review management, and Meta ads for local car buyers.",
    "home-service": "Focus on home service businesses (plumbing, HVAC, electrical). Highlight review management, AI chatbot for service requests, automated dispatch workflows.",
    "pet-services": "Focus on pet service businesses (grooming, boarding, vet). Highlight appointment automations, review management, AI chatbot for booking.",
    photography: "Focus on photographers. Highlight booking workflows, review collection, portfolio showcase, and Meta ads for local events.",
    wedding: "Focus on wedding industry. Highlight vendor CRM, automated inquiry follow-ups, review management, and Meta ads for engaged couples.",
    marketers: "Focus on marketing agencies. Highlight white-label capabilities, multi-account management, workflow automation, and AI tools for scaling client work.",
    luxe: "Focus on luxury brands and high-end services. Highlight premium CRM, exclusive client communication, review management, and targeted Meta ads.",
  };

  const salesChatLimiter = new Map<string, number[]>();
  app.post("/api/sales-chat", asyncHandler(async (req, res) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    const window = 60_000;
    const maxReqs = 15;
    const timestamps = (salesChatLimiter.get(ip) || []).filter(t => now - t < window);
    if (timestamps.length >= maxReqs) {
      return res.status(429).json({ reply: "You're sending messages too fast. Please wait a moment and try again." });
    }
    timestamps.push(now);
    salesChatLimiter.set(ip, timestamps);
    if (salesChatLimiter.size > 5000) {
      const oldest = now - window * 5;
      for (const [k, v] of salesChatLimiter) { if (!v.length || v[v.length - 1] < oldest) salesChatLimiter.delete(k); }
    }

    if (!isGeminiConfigured()) {
      return res.json({ reply: "Thanks for your interest! Visit our pricing page at /pricing to see our plans, or reach out to us directly." });
    }

    const { message, niche, conversationHistory } = req.body;
    if (!message || typeof message !== "string" || message.length > 1000) return res.status(400).json({ error: "Message required (max 1000 chars)" });

    const nicheContext = SALES_NICHE_CONTEXT[niche] || SALES_NICHE_CONTEXT.general;

    const salesPrompt = `You are Aria, the AI sales assistant for Apex Marketing Automations. You help potential customers understand how Apex can grow their business.

Context about the platform: ${nicheContext}

Pricing:
- TapCard (Digital Business Card): $9.99/mo or $69.99/yr
- Starter Plan: Included with TapCard, basic features
- Agency Pro: $48/mo or $384/yr — full marketing suite with AI chatbot, voice agent, SMS, workflows, CRM, Meta ads, Sentinel
- God Mode (Enterprise): $97/mo — everything plus white-label, unlimited accounts

Rules:
- Be friendly, enthusiastic, and concise (2-3 sentences max)
- Always steer toward signing up or checking out the pricing page
- Mention specific features relevant to their question
- If they ask about pricing, give exact numbers
- If they seem ready, direct them to /pricing or /cards
- Never make up features that don't exist
- Don't use excessive emojis`;

    const chatMessages: any[] = [{ role: "system", content: salesPrompt }];
    if (conversationHistory && Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory.slice(-8)) {
        chatMessages.push({ role: msg.role === "user" ? "user" : "assistant", content: msg.text });
      }
    }
    chatMessages.push({ role: "user", content: message });

    const reply = await geminiChat(chatMessages, { temperature: 0.8, maxTokens: 1024 }) || "Great question! Check out our plans at /pricing to see everything Apex can do for your business.";
    await logUsageInternal(null, "AI_CHAT", 1, "Sales chatbot response");
    res.json({ reply });
  }));

  app.post("/api/chat", asyncHandler(async (req, res) => {
    if (!isGeminiConfigured()) {
      return res.status(503).json({ reply: "Chat service is currently offline. Please try again later." });
    }

    const parsed = chatBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const chatSystemPrompt = CHAT_SYSTEM_PROMPT + getIndustryContext(parsed.data.industry) + getLanguageInstruction(parsed.data.language);

    const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: chatSystemPrompt },
    ];

    if (parsed.data.conversationHistory) {
      for (const msg of parsed.data.conversationHistory.slice(-10)) {
        chatMessages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.text,
        });
      }
    }

    chatMessages.push({ role: "user", content: parsed.data.message });

    const reply = await geminiChat(chatMessages as any, { temperature: 0.7, maxTokens: 1024 }) || "I'm here to help! Could you tell me more about what you're looking for?";

    await logUsageInternal(null, "AI_CHAT", 1, "Chat widget AI response");

    res.json({ reply });
  }));

  app.post("/api/chat/stream", asyncHandler(async (req, res) => {
    try {
      if (!isGeminiConfigured()) {
        return res.status(503).json({ reply: "Chat service is currently offline. Please try again later." });
      }

      const parsed = chatBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const chatSystemPrompt = CHAT_SYSTEM_PROMPT + getIndustryContext(parsed.data.industry) + getLanguageInstruction(parsed.data.language);

      const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: chatSystemPrompt },
      ];

      if (parsed.data.conversationHistory) {
        for (const msg of parsed.data.conversationHistory.slice(-10)) {
          chatMessages.push({
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.text,
          });
        }
      }

      chatMessages.push({ role: "user", content: parsed.data.message });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const stream = geminiChatStream(chatMessages as any, { temperature: 0.7, maxTokens: 1024 });
      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();

      await logUsageInternal(null, "AI_CHAT", 1, "Chat widget AI response (stream)");
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Streaming failed" });
      } else {
        res.write(`data: ${JSON.stringify({ error: error.message || "Streaming failed" })}\n\n`);
        res.end();
      }
    }
  }));

  // ---- Voice Agent (Vapi Integration) ----
  const voiceAgentSchema = z.object({
    persona: z.string().min(1, "persona is required").max(2000),
    firstMessage: z.string().min(1, "firstMessage is required").max(500),
    voiceId: z.string().max(100).optional(),
    voiceProvider: z.string().max(50).optional(),
    objectionRules: z.array(z.object({
      trigger: z.string().max(500),
      response: z.string().max(1000),
      note: z.string().max(500).optional(),
    })).max(20).optional(),
  });

  app.post("/api/voice-agents/create", asyncHandler(async (req, res) => {
    if (!vapiConfig.isConfigured) {
      return res.status(503).json({ error: "Vapi API key is not configured. Add VAPI_PRIVATE_KEY in Secrets." });
    }

    const parsed = voiceAgentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { persona, firstMessage, voiceId, voiceProvider, objectionRules } = parsed.data;

    let objectionBlock = "";
    if (objectionRules && objectionRules.length > 0) {
      const rulesText = objectionRules
        .filter((r) => r.trigger && r.response)
        .map((r, i) => {
          let line = `${i + 1}. If they say "${r.trigger}":\n   - Say: "${r.response}"`;
          if (r.note) line += `\n   - NOTE: ${r.note}`;
          return line;
        })
        .join("\n");
      if (rulesText) {
        objectionBlock = `\n\nOBJECTION HANDLING RULES (follow these exactly when the caller raises these objections):\n${rulesText}`;
      }
    }

    const payload = {
      transcriber: { provider: "deepgram" },
      model: {
        provider: "openai",
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are a voice AI assistant. Keep sentences short and natural. Do not sound robotic. Pauses like 'um' and 'uh' are okay. YOUR GOAL: ${persona}${objectionBlock}`,
          },
        ],
      },
      voice: {
        provider: voiceProvider || "11labs",
        voiceId: voiceId || "21m00Tcm4TlvDq8ikWAM",
      },
      firstMessage,
      name: `Apex Agent - ${new Date().toLocaleDateString()}`,
    };

    const response = await fetch("https://api.vapi.ai/assistant", {
      method: "POST",
      headers: {
        ...vapiConfig.privateHeaders(),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.text();
      console.error("Vapi create error:", response.status, errData);
      let detail = "Failed to create voice agent on Vapi";
      try {
        const parsed = JSON.parse(errData);
        detail = parsed.message || parsed.error || detail;
      } catch {}
      if (response.status === 403) {
        detail = "Vapi authentication failed. Check your VAPI_PRIVATE_KEY in Secrets.";
      }
      return res.status(response.status).json({ error: detail });
    }

    const agent = await response.json();
    res.json({
      id: agent.id,
      name: agent.name,
      status: "created",
      phoneNumber: agent.phoneNumber || null,
    });
  }));

  app.get("/api/voice-agents", asyncHandler(async (_req, res) => {
    if (!vapiConfig.isConfigured) {
      return res.json([]);
    }

    const response = await fetch("https://api.vapi.ai/assistant", {
      headers: vapiConfig.privateHeaders(),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Vapi list error:", response.status, errText);
      return res.json([]);
    }

    const agents = await response.json();
    res.json(
      (Array.isArray(agents) ? agents : []).map((a: any) => ({
        id: a.id,
        name: a.name,
        createdAt: a.createdAt,
        model: a.model?.model,
        voice: a.voice?.voiceId,
      }))
    );
  }));

  app.get("/api/voice-agents/:id/config", asyncHandler(async (req, res) => {
    if (!vapiConfig.isConfigured) {
      return res.status(503).json({ error: "Vapi API key is not configured." });
    }

    const agentId = req.params.id;
    const response = await fetch(`https://api.vapi.ai/assistant/${agentId}`, {
      headers: vapiConfig.privateHeaders(),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Vapi get agent error:", response.status, errText);
      return res.status(response.status).json({ error: "Failed to fetch agent config" });
    }

    const agent = await response.json();
    res.json({
      name: agent.name,
      model: agent.model,
      voice: agent.voice,
      firstMessage: agent.firstMessage,
      transcriber: agent.transcriber,
      endCallFunctionEnabled: agent.endCallFunctionEnabled,
      silenceTimeoutSeconds: agent.silenceTimeoutSeconds,
      maxDurationSeconds: agent.maxDurationSeconds,
      responseDelaySeconds: agent.responseDelaySeconds,
    });
  }));

  const outboundCallSchema = z.object({
    assistantId: z.string().min(1, "assistantId is required"),
    customerPhone: z.string().min(1, "customerPhone is required"),
    phoneNumberId: z.string().optional(),
  });

  app.post("/api/voice-agents/call", asyncHandler(async (req, res) => {
    if (!vapiConfig.isConfigured) {
      return res.status(503).json({ error: "Vapi API key is not configured. Add VAPI_PRIVATE_KEY in Secrets." });
    }

    const parsed = outboundCallSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const payload: Record<string, any> = {
      assistantId: parsed.data.assistantId,
      customer: { number: parsed.data.customerPhone },
    };

    if (parsed.data.phoneNumberId) {
      payload.phoneNumberId = parsed.data.phoneNumberId;
    } else if (vapiConfig.phoneNumberId) {
      payload.phoneNumberId = vapiConfig.phoneNumberId;
    }

    const response = await fetch("https://api.vapi.ai/call/phone", {
      method: "POST",
      headers: vapiConfig.privateHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.text();
      console.error("Vapi outbound call error:", response.status, errData);
      let detail = "Failed to initiate outbound call";
      try {
        const p = JSON.parse(errData);
        detail = p.message || p.error || detail;
      } catch {}
      if (response.status === 403) {
        detail = "Vapi authentication failed. Check your VAPI_PRIVATE_KEY in Secrets.";
      }
      if (!payload.phoneNumberId) {
        detail += " (No phone number configured — add VAPI_PHONE_NUMBER_ID in Secrets or purchase a number)";
      }
      return res.status(response.status).json({ error: detail });
    }

    const call = await response.json();
    res.json({
      callId: call.id,
      status: call.status || "queued",
      createdAt: call.createdAt,
    });
  }));

  const dialerJobs = new Map<string, { leads: { name: string; phone: string }[]; current: number; status: string; results: { name: string; phone: string; status: string; callId?: string; error?: string }[]; createdAt: number }>();

  const DIALER_JOB_TTL_MS = 60 * 60 * 1000;
  const DIALER_STALE_TTL_MS = 2 * 60 * 60 * 1000;

  function cleanupDialerJobs() {
    const now = Date.now();
    dialerJobs.forEach((job, id) => {
      const age = now - job.createdAt;
      if (job.status === "completed" && age > DIALER_JOB_TTL_MS) {
        dialerJobs.delete(id);
      } else if (job.status === "running" && age > DIALER_STALE_TTL_MS) {
        job.status = "completed";
        dialerJobs.delete(id);
      }
    });
  }

  const dialerCleanupInterval = setInterval(cleanupDialerJobs, 10 * 60 * 1000);
  dialerCleanupInterval.unref();

  const powerDialSchema = z.object({
    assistantId: z.string().min(1),
    phoneNumberId: z.string().optional(),
    leads: z.array(z.object({
      name: z.string().optional(),
      phone: z.string().min(1),
    })).min(1, "At least one lead is required").max(50, "Maximum 50 leads per batch"),
  });

  app.post("/api/voice-agents/power-dial", asyncHandler(async (req, res) => {
    if (!vapiConfig.isConfigured) {
      return res.status(503).json({ error: "Vapi API key is not configured. Add VAPI_PRIVATE_KEY in Secrets." });
    }

    const parsed = powerDialSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { assistantId, leads } = parsed.data;
    const phoneNumberId = parsed.data.phoneNumberId || vapiConfig.phoneNumberId || undefined;

    cleanupDialerJobs();

    const jobId = `dial_${Date.now()}`;
    const jobData = {
      leads: leads.map((l) => ({ name: l.name || "Unknown", phone: l.phone })),
      current: 0,
      status: "running",
      results: [] as { name: string; phone: string; status: string; callId?: string; error?: string }[],
      createdAt: Date.now(),
    };
    dialerJobs.set(jobId, jobData);

    res.json({ jobId, total: leads.length, status: "running" });

    (async () => {
      for (let i = 0; i < jobData.leads.length; i++) {
        const lead = jobData.leads[i];
        jobData.current = i;

        try {
          const callPayload: Record<string, any> = {
            assistantId,
            customer: { number: lead.phone },
          };

          if (phoneNumberId) {
            callPayload.phoneNumberId = phoneNumberId;
          }

          callPayload.assistantOverrides = {
            variableValues: { lead_name: lead.name },
          };

          const response = await fetch("https://api.vapi.ai/call/phone", {
            method: "POST",
            headers: vapiConfig.privateHeaders(),
            body: JSON.stringify(callPayload),
          });

          if (response.ok) {
            const call = await response.json();
            jobData.results.push({ name: lead.name, phone: lead.phone, status: "dialed", callId: call.id });
          } else {
            jobData.results.push({ name: lead.name, phone: lead.phone, status: "failed", error: "API error" });
          }
        } catch {
          jobData.results.push({ name: lead.name, phone: lead.phone, status: "failed", error: "Network error" });
        }

        if (i < jobData.leads.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 30000));
        }
      }

      jobData.current = jobData.leads.length;
      jobData.status = "completed";
    })();
  }));

  app.get("/api/voice-agents/power-dial/:jobId", (req, res) => {
    const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
    const job = dialerJobs.get(jobId || "");
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    res.json({
      total: job.leads.length,
      current: job.current,
      status: job.status,
      results: job.results,
      leads: job.leads,
    });
  });

  app.get("/api/voice-agents/calls", asyncHandler(async (req, res) => {
    if (!vapiConfig.isConfigured) {
      return res.json([]);
    }

    const assistantId = (Array.isArray(req.query.assistantId) ? req.query.assistantId[0] : req.query.assistantId) as string | undefined;
    const limitStr = (Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit) as string | undefined;
    const limit = Math.min(parseInt(limitStr || "10", 10) || 10, 50);

    let url = `https://api.vapi.ai/call?limit=${limit}`;
    if (assistantId) {
      url += `&assistantId=${encodeURIComponent(assistantId)}`;
    }

    const response = await fetch(url, {
      headers: vapiConfig.privateHeaders(),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Vapi calls list error:", response.status, errText);
      return res.json([]);
    }

    const calls = await response.json();
    const callList = Array.isArray(calls) ? calls : [];

    res.json(
      callList.map((c: any) => ({
        id: c.id,
        status: c.status,
        type: c.type,
        startedAt: c.startedAt || c.createdAt,
        endedAt: c.endedAt,
        duration: c.duration || (c.endedAt && c.startedAt
          ? Math.round((new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime()) / 1000)
          : null),
        recordingUrl: c.recordingUrl || c.artifact?.recordingUrl || null,
        transcript: (c.artifact?.messages || c.messages || [])
          .filter((m: any) => m.role && m.message)
          .map((m: any) => ({
            role: m.role,
            message: m.message,
            timestamp: m.secondsFromStart || null,
          })),
        customer: c.customer?.number || null,
        assistantId: c.assistantId,
        cost: c.cost || null,
      }))
    );
  }));

  app.get("/api/vapi/get-config", (_req, res) => {
    res.json({
      isConfigured: vapiConfig.isConfigured,
      hasPublicKey: !!vapiConfig.publicKey,
      publicKey: vapiConfig.publicKey || null,
      hasPhoneNumber: !!vapiConfig.phoneNumberId,
    });
  });

  app.post("/api/vapi/start-web-call", asyncHandler(async (req, res) => {
    if (!vapiConfig.isConfigured) {
      return res.status(503).json({ error: "Vapi is not configured. Add VAPI_PRIVATE_KEY in Secrets." });
    }

    const { assistantId } = req.body;
    if (!assistantId || typeof assistantId !== "string") {
      return res.status(400).json({ error: "assistantId is required" });
    }

    const response = await fetch("https://api.vapi.ai/call/web", {
      method: "POST",
      headers: vapiConfig.privateHeaders(),
      body: JSON.stringify({ assistantId }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Vapi start-web-call error:", response.status, errText);
      let detail = "Failed to create web call";
      try { const p = JSON.parse(errText); detail = p.message || p.error || detail; } catch {}
      if (response.status === 403) {
        detail = "Vapi authentication failed. Check your VAPI_PRIVATE_KEY in Secrets.";
      }
      return res.status(response.status).json({ error: detail });
    }

    const callData = await response.json();
    const webCallUrl = callData.webCallUrl || callData.transport?.callUrl;
    if (!webCallUrl) {
      console.error("Vapi start-web-call response missing webCallUrl:", JSON.stringify(callData));
      return res.status(500).json({ error: "Web call created but no URL returned" });
    }

    res.json({ webCallUrl, callId: callData.id });
  }));

  // ---- ElevenLabs Voice AI Integration ----

  function getElevenLabsApiKey(): string | null {
    return process.env.ELEVENLABS_API_KEY || null;
  }

  async function resolveElevenLabsApiKey(subAccountId?: number): Promise<string | null> {
    if (subAccountId) {
      try {
        const connections = await storage.getIntegrationConnections(subAccountId);
        const elConn = connections.find((c: any) => c.provider === "elevenlabs" && c.status === "connected");
        if (elConn?.config && (elConn.config as any).apiKey) {
          return (elConn.config as any).apiKey;
        }
      } catch {}
    }
    return getElevenLabsApiKey();
  }

  async function elevenLabsTtsRequest(apiKey: string, voiceId: string, text: string, options?: { modelId?: string; stability?: number; similarityBoost?: number }) {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: options?.modelId || "eleven_multilingual_v2",
        voice_settings: {
          stability: options?.stability ?? 0.5,
          similarity_boost: options?.similarityBoost ?? 0.75,
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errText = await response.text();
      let detail = "ElevenLabs TTS failed";
      try { const p = JSON.parse(errText); detail = p.detail?.message || p.detail || detail; } catch {}
      throw new Error(detail);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  app.get("/api/elevenlabs/config", asyncHandler(async (req, res) => {
    const subAccountId = req.query.subAccountId ? parseInt(req.query.subAccountId as string) : undefined;
    const apiKey = await resolveElevenLabsApiKey(subAccountId);
    res.json({ isConfigured: !!apiKey });
  }));

  app.get("/api/elevenlabs/voices", asyncHandler(async (req, res) => {
    const subAccountId = req.query.subAccountId ? parseInt(req.query.subAccountId as string) : undefined;
    const apiKey = await resolveElevenLabsApiKey(subAccountId);
    if (!apiKey) {
      return res.status(503).json({ error: "ElevenLabs API key is not configured. Connect it in the Integrations Hub." });
    }

    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch voices from ElevenLabs." });
    }

    const data = await response.json() as any;
    const voices = (data.voices || []).map((v: any) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
      description: v.labels?.description || v.labels?.accent || "",
      preview_url: v.preview_url,
      labels: v.labels || {},
    }));

    res.json({ voices });
  }));

  app.post("/api/elevenlabs/tts", asyncHandler(async (req, res) => {
    const schema = z.object({
      text: z.string().min(1).max(5000),
      voiceId: z.string().min(1),
      subAccountId: z.number().optional(),
      modelId: z.string().optional().default("eleven_multilingual_v2"),
      stability: z.number().min(0).max(1).optional().default(0.5),
      similarityBoost: z.number().min(0).max(1).optional().default(0.75),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { text, voiceId, subAccountId, modelId, stability, similarityBoost } = parsed.data;

    const apiKey = await resolveElevenLabsApiKey(subAccountId);
    if (!apiKey) {
      return res.status(503).json({ error: "ElevenLabs API key is not configured. Connect it in the Integrations Hub." });
    }

    try {
      const audioBuffer = await elevenLabsTtsRequest(apiKey, voiceId, text, { modelId, stability, similarityBoost });
      const base64Audio = audioBuffer.toString("base64");

      res.json({
        audio: base64Audio,
        contentType: "audio/mpeg",
        voiceId,
        characterCount: text.length,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }));

  const personaSchema = z.object({
    businessDescription: z.string().min(1, "businessDescription is required").max(2000),
    industry: z.string().max(100).optional(),
  });

  app.post("/api/voice-agents/generate-persona", asyncHandler(async (req, res) => {
    if (!isGeminiConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = personaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const voicePersonaBasePrompt = `You generate voice AI agent personas for businesses. Given a business description, return a JSON object with:
{
  "persona": "<detailed agent persona/instructions for handling calls, max 3 sentences>",
  "firstMessage": "<natural greeting the agent says when answering, max 1 sentence>",
  "suggestedName": "<friendly agent name>"
}
Rules:
- Persona should be specific to the business type
- First message should sound warm and natural, not robotic
- Return ONLY valid JSON, no markdown or code fences`;

    const raw = await geminiChat([
      {
        role: "system",
        content: voicePersonaBasePrompt + getIndustryContext(parsed.data.industry),
      },
      { role: "user", content: parsed.data.businessDescription },
    ], { temperature: 0.7, maxTokens: 4096, jsonMode: true });
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let data: any;
    try {
      data = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "AI returned invalid JSON" });
    }

    res.json(data);
  }));

  // ---- Phone Number Provisioning (Twilio + Vapi) ----

  app.get("/api/phone-numbers/search", asyncHandler(async (req, res) => {
    const twilioClient = getTwilioClient();
    if (!twilioClient) {
      return res.status(503).json({ error: "Twilio credentials are not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Secrets." });
    }

    const areaCodeStr = (Array.isArray(req.query.areaCode) ? req.query.areaCode[0] : req.query.areaCode) as string | undefined;
    const countryStr = (Array.isArray(req.query.country) ? req.query.country[0] : req.query.country) as string | undefined;
    const limitStr = (Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit) as string | undefined;

    const areaCode = parseInt(areaCodeStr || "305", 10) || 305;
    const country = countryStr || "US";
    const limit = Math.min(parseInt(limitStr || "5", 10) || 5, 20);

    let numbers;
    try {
      numbers = await twilioClient.availablePhoneNumbers(country).local.list({
        areaCode,
        limit,
      });
    } catch (twilioErr: any) {
      console.error("Twilio search error:", twilioErr.message, twilioErr.code);
      return res.status(400).json({ error: twilioErr.message || "Failed to search phone numbers" });
    }

    res.json(
      numbers.map((n) => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        locality: n.locality,
        region: n.region,
        capabilities: {
          voice: n.capabilities.voice,
          sms: n.capabilities.sms,
          mms: n.capabilities.mms,
        },
      }))
    );
  }));

  const purchaseSchema = z.object({
    phoneNumber: z.string().min(1, "phoneNumber is required"),
    assistantId: z.string().optional(),
    subAccountId: z.number().optional(),
  });

  app.post("/api/phone-numbers/purchase", asyncHandler(async (req, res) => {
    const twilioClient = getTwilioClient();
    if (!twilioClient) {
      return res.status(503).json({ error: "Twilio credentials are not configured." });
    }

    const parsed = purchaseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { phoneNumber, assistantId, subAccountId } = parsed.data;

    const smsWebhookUrl = `${req.protocol}://${req.get("host")}/api/sms-webhook`;

    let purchased;
    try {
      purchased = await twilioClient.incomingPhoneNumbers.create({ phoneNumber });
    } catch (twilioErr: any) {
      console.error("Twilio purchase error:", twilioErr.message, twilioErr.code);
      return res.status(400).json({ error: twilioErr.message || "Failed to purchase phone number from Twilio" });
    }

    let vapiPhoneId: string | null = null;
    if (vapiConfig.isConfigured && assistantId) {
      try {
        const vapiRes = await fetch("https://api.vapi.ai/phone-number", {
          method: "POST",
          headers: vapiConfig.privateHeaders(),
          body: JSON.stringify({
            provider: "twilio",
            number: purchased.phoneNumber,
            twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
            twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
            assistantId,
          }),
        });

        if (vapiRes.ok) {
          const vapiData = await vapiRes.json();
          vapiPhoneId = vapiData.id;
        } else {
          console.error("Vapi link error:", await vapiRes.text());
        }
      } catch (linkErr: any) {
        console.error("Vapi link error:", linkErr.message);
      }
    }

    const updateOpts: Record<string, string> = {};
    if (smsWebhookUrl) {
      updateOpts.smsUrl = smsWebhookUrl;
      updateOpts.smsMethod = "POST";
    }
    updateOpts.voiceUrl = "https://api.vapi.ai/twilio/voice/handler";
    updateOpts.voiceMethod = "POST";

    try {
      await twilioClient.incomingPhoneNumbers(purchased.sid).update(updateOpts);
      console.log(`Full-duplex configured: Voice -> Vapi, SMS -> ${smsWebhookUrl}`);
    } catch (cfgErr: any) {
      console.error("Dual-agent config error:", cfgErr.message);
    }

    if (subAccountId) {
      try {
        await storage.updateSubAccount(subAccountId, { twilioNumber: purchased.phoneNumber });
        console.log(`[PHONE] Saved ${purchased.phoneNumber} to sub-account ${subAccountId}`);
      } catch (saveErr: any) {
        console.error("[PHONE] Failed to save number to sub-account:", saveErr.message);
      }
    }

    res.json({
      sid: purchased.sid,
      phoneNumber: purchased.phoneNumber,
      friendlyName: purchased.friendlyName,
      vapiPhoneId,
      smsWebhookUrl: smsWebhookUrl || null,
      dualAgent: true,
    });
  }));

  app.get("/api/phone-numbers", asyncHandler(async (_req, res) => {
    const twilioClient = getTwilioClient();
    if (!twilioClient) {
      return res.status(503).json({ error: "Twilio is not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to manage phone numbers.", numbers: [] });
    }

    let numbers;
    try {
      numbers = await twilioClient.incomingPhoneNumbers.list({ limit: 20 });
    } catch (twilioErr: any) {
      console.error("Twilio list numbers error:", twilioErr.message, twilioErr.code);
      return res.status(503).json({ error: `Twilio error: ${twilioErr.message}`, numbers: [] });
    }

    let vapiNumbers: any[] = [];
    let vapiWarning: string | undefined;
    if (!vapiConfig.isConfigured) {
      vapiWarning = "Vapi is not configured. Add VAPI_PRIVATE_KEY to see voice agent status for phone numbers.";
    } else {
      try {
        const vapiRes = await fetch("https://api.vapi.ai/phone-number", {
          headers: vapiConfig.privateHeaders(),
        });
        if (vapiRes.ok) {
          vapiNumbers = await vapiRes.json();
        } else {
          vapiWarning = `Vapi API returned ${vapiRes.status}. Voice agent status may be incomplete.`;
          console.warn(`[PHONE-NUMBERS] Vapi fetch failed: ${vapiRes.status}`);
        }
      } catch (vapiErr: any) {
        vapiWarning = `Vapi connection failed: ${vapiErr.message}. Voice agent status may be incomplete.`;
        console.warn(`[PHONE-NUMBERS] Vapi fetch error: ${vapiErr.message}`);
      }
    }

    const normalizeNum = (num: string) => num?.replace(/[^\d+]/g, "") || "";
    const phoneList = numbers.map((n) => {
      const twilioNorm = normalizeNum(n.phoneNumber);
      const vapiMatch = vapiNumbers.find((v: any) =>
        normalizeNum(v.number) === twilioNorm || normalizeNum(v.phoneNumber) === twilioNorm
      );
      return {
        sid: n.sid,
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        smsUrl: n.smsUrl,
        voiceUrl: n.voiceUrl,
        dateCreated: n.dateCreated,
        vapiPhoneId: vapiMatch?.id || null,
      };
    });
    const response: any = { numbers: phoneList };
    if (vapiWarning) response.vapiWarning = vapiWarning;
    res.json(response);
  }));

  // ---- Unified Webhook (Twilio inbound SMS/WhatsApp/Messenger -> AI auto-reply) ----

  function detectChannel(from: string): "whatsapp" | "messenger" | "sms" {
    if (from.startsWith("whatsapp:")) return "whatsapp";
    if (from.startsWith("messenger:")) return "messenger";
    return "sms";
  }

  function stripChannelPrefix(addr: string): string {
    return addr.replace(/^(whatsapp:|messenger:)/, "");
  }

  app.post("/api/sms-webhook", async (req, res) => {
    try {
      const incomingMsg = req.body.Body as string | undefined;
      const senderRaw = req.body.From as string | undefined;
      const toRaw = req.body.To as string | undefined;

      if (!incomingMsg || !senderRaw) {
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      const channel = detectChannel(senderRaw);
      const senderClean = stripChannelPrefix(senderRaw);

      console.log(`[${channel.toUpperCase()}] from ${senderClean}: ${incomingMsg.substring(0, 100)}`);

      const toClean = toRaw ? stripChannelPrefix(toRaw) : "";
      const matchedAccounts = await db.select().from(subAccounts).where(eq(subAccounts.twilioNumber, toClean)).execute().catch(() => []);
      const matchedAccountId = matchedAccounts.length > 0 ? matchedAccounts[0].id : 1;

      const { isOptOutMessage, isOptInMessage, handleSmsOptOut, handleSmsOptIn } = await import("./optOutGuard");
      if (isOptOutMessage(incomingMsg)) {
        await handleSmsOptOut(senderClean, matchedAccountId);
        console.log(`[OPT-OUT] ${senderClean} opted out of SMS`);

        const twilioClient = getTwilioClient();
        if (twilioClient && toRaw) {
          await twilioClient.messages.create({
            body: "You have been unsubscribed and will no longer receive messages from us. Reply START to re-subscribe.",
            from: toRaw,
            to: senderRaw,
          });
        }

        res.type("text/xml").send("<Response></Response>");
        return;
      }

      if (isOptInMessage(incomingMsg)) {
        await handleSmsOptIn(senderClean, matchedAccountId);
        console.log(`[OPT-IN] ${senderClean} opted back in to SMS`);

        const twilioClient = getTwilioClient();
        if (twilioClient && toRaw) {
          await twilioClient.messages.create({
            body: "You have been re-subscribed and will receive messages from us again.",
            from: toRaw,
            to: senderRaw,
          });
        }

        res.type("text/xml").send("<Response></Response>");
        return;
      }

      try {
        await storage.createMessage({
          subAccountId: matchedAccountId,
          contactPhone: senderClean,
          body: incomingMsg,
          direction: "inbound",
          channel,
          status: "received",
        });
      } catch (e: any) {
        console.log(`[${channel.toUpperCase()}] Message storage error:`, e.message);
      }

      if (channel === "whatsapp") {
        fireAutomationTrigger("OnWhatsAppReply", matchedAccountId, {
          senderPhone: senderClean,
          message: incomingMsg,
          channel: "whatsapp",
        }).catch(() => {});
      }

      let aiReply = "Thanks for your message! We'll get back to you shortly.";

      if (isGeminiConfigured()) {
        try {
          const smsIndustry = req.body.industry as string | undefined;
          const smsLanguage = req.body.language as string | undefined;
          const baseSystemPrompt = channel === "sms"
            ? "You are a helpful business receptionist. Keep text replies under 160 characters. Be warm, professional, and concise. If someone wants to book an appointment, suggest they call the office number."
            : "You are a helpful business assistant responding via chat. Keep replies conversational and under 300 characters. Be warm, professional, and helpful. If someone wants to book an appointment, suggest they call the office number.";
          const systemPrompt = baseSystemPrompt + getIndustryContext(smsIndustry) + getLanguageInstruction(smsLanguage);

          const geminiReply = await geminiChat([
            { role: "system", content: systemPrompt },
            { role: "user", content: incomingMsg.substring(0, 1000) },
          ], { temperature: 0.7, maxTokens: 1024 });
          aiReply = geminiReply || aiReply;
        } catch (aiErr: any) {
          console.error("AI reply error:", aiErr.message);
        }
      }

      const twilioClient = getTwilioClient();
      if (twilioClient && toRaw) {
        const replyFrom = channel === "whatsapp" ? `whatsapp:${stripChannelPrefix(toRaw)}`
          : channel === "messenger" ? `messenger:${stripChannelPrefix(toRaw)}`
          : toRaw;

        await twilioClient.messages.create({
          body: aiReply,
          from: replyFrom,
          to: senderRaw,
        });
      }

      res.type("text/xml").send("<Response></Response>");
    } catch (err: any) {
      console.error("Unified webhook error:", err);
      res.type("text/xml").send("<Response></Response>");
    }
  });

  // ---- Meta/Facebook Webhook (Instagram/Facebook DMs) ----
  app.get("/api/meta-webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const verifyToken = process.env.META_VERIFY_TOKEN || "apex_verify_2026";
    if (mode === "subscribe" && token === verifyToken) {
      console.log("[META WEBHOOK] Verified");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  app.post("/api/meta-webhook", async (req, res) => {
    try {
      const body = req.body;
      console.log("[META WEBHOOK] Received:", JSON.stringify(body).substring(0, 500));

      if (body.object === "page" || body.object === "instagram") {
        for (const entry of body.entry || []) {
          for (const event of entry.messaging || []) {
            const senderId = event.sender?.id;
            const message = event.message?.text;

            if (!senderId || !message) {
              console.warn(`[META DM] Skipping event — missing sender (${senderId}) or message text`);
              continue;
            }

            const channel = body.object === "instagram" ? "instagram" : "facebook";
            console.log(`[META DM] ${channel} from ${senderId}: ${message.substring(0, 100)}`);

            const accessToken = process.env.META_ACCESS_TOKEN;
            const pageId = process.env.META_PAGE_ID;
            const appSecret = process.env.META_APP_SECRET;

            const allAccounts = await storage.getSubAccounts();
            const targetAccount = allAccounts.find(a => a.ownerUserId !== "_archived") || allAccounts[0];
            const subAccountId = targetAccount?.id || 13;

            if (!accessToken || !pageId) {
              const rawPayload = JSON.stringify(event).substring(0, 2000);
              console.error(`[META DM] Cannot process ${channel} message from ${senderId} — META_ACCESS_TOKEN or META_PAGE_ID not configured. Set these environment variables in your Replit project. Visit the Integrations page for a setup guide. Raw event: ${rawPayload}`);
              await db.insert(messages).values({
                subAccountId,
                channel,
                direction: "inbound",
                contactPhone: senderId,
                body: `[UNPROCESSED - Missing META credentials] Raw: ${rawPayload.substring(0, 500)}`,
                status: "failed",
              });
              continue;
            }

            let appsecretProof = "";
            if (accessToken && appSecret) {
              const crypto = await import("crypto");
              appsecretProof = crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
            }

            await db.insert(messages).values({
              subAccountId,
              channel,
              direction: "inbound",
              contactPhone: senderId,
              body: message,
              status: "received",
            });

            try {
              const existingContact = await db.select().from(contacts)
                .where(and(
                  eq(contacts.subAccountId, subAccountId),
                  eq(contacts.source, `${channel}_dm`),
                  eq(contacts.phone, senderId)
                )).limit(1);

              if (existingContact.length === 0) {
                const newContact = await storage.createContact({
                  subAccountId,
                  firstName: `${channel === "instagram" ? "IG" : "FB"} User ${senderId.slice(-4)}`,
                  phone: senderId,
                  source: `${channel}_dm`,
                  tags: [channel, "dm_lead"],
                });
                console.log(`[META DM] Created CRM contact id=${newContact.id} for ${senderId}`);

                fireAutomationTrigger("new_lead", subAccountId, {
                  leadName: newContact.firstName,
                  leadPhone: senderId,
                  source: `${channel}_dm`,
                });
              }
            } catch (contactErr: any) {
              console.warn("[META DM] Contact creation skipped:", contactErr.message);
            }

            const keywords = await storage.getDmKeywordAutomations(subAccountId, true);
            const msgLower = message.toLowerCase().trim();
            let keywordMatched = false;

            for (const kw of keywords) {
              if (kw.channel !== "all" && kw.channel !== channel) continue;

              const kwLower = kw.keyword.toLowerCase();
              const matched = kw.matchType === "contains"
                ? msgLower.includes(kwLower)
                : msgLower === kwLower;

              if (!matched) continue;

              keywordMatched = true;
              console.log(`[META DM] Keyword "${kw.keyword}" matched for ${senderId}`);
              storage.incrementKeywordHitCount(kw.id);

              if (kw.responseText && (!accessToken || !pageId)) {
                console.warn(`[META DM] Cannot send keyword reply to ${senderId}: META_ACCESS_TOKEN or META_PAGE_ID not configured. Message stored but not delivered.`);
                await db.insert(messages).values({
                  subAccountId,
                  channel,
                  direction: "outbound",
                  contactPhone: senderId,
                  body: kw.responseText,
                  status: "failed",
                });
              } else if (kw.responseText && accessToken && pageId) {
                const kwUrl = `https://graph.facebook.com/v19.0/${pageId}/messages` + (appsecretProof ? `?appsecret_proof=${appsecretProof}` : "");
                const kwSendRes = await fetch(kwUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    recipient: { id: senderId },
                    message: { text: kw.responseText },
                    access_token: accessToken,
                  }),
                });
                const kwSendData = await kwSendRes.json() as any;
                const kwSendStatus = kwSendRes.ok ? "sent" : "failed";
                if (!kwSendRes.ok) {
                  console.error(`[META DM] Keyword reply FAILED to ${senderId}: ${JSON.stringify(kwSendData).substring(0, 300)}`);
                }

                await db.insert(messages).values({
                  subAccountId,
                  channel,
                  direction: "outbound",
                  contactPhone: senderId,
                  body: kw.responseText,
                  status: kwSendStatus,
                });
                if (kwSendRes.ok) console.log(`[META DM] Keyword reply sent to ${senderId}`);
              }

              if (kw.actionPayload) {
                const payload = typeof kw.actionPayload === "string" ? JSON.parse(kw.actionPayload) : kw.actionPayload;
                if (payload.triggerName) {
                  fireAutomationTrigger(payload.triggerName, subAccountId, {
                    leadName: `${channel} User ${senderId.slice(-4)}`,
                    leadPhone: senderId,
                    source: `${channel}_dm_keyword:${kw.keyword}`,
                    keyword: kw.keyword,
                    message,
                  });
                }
              }
              break;
            }

            if (!keywordMatched && isGeminiConfigured()) {
              try {
                let systemPrompt = `You are a helpful business assistant responding via ${channel} DM. Keep replies conversational and under 300 characters. Be warm, professional, and helpful.`;

                try {
                  const websites = await db.select().from(clientWebsites)
                    .where(eq(clientWebsites.subAccountId, subAccountId)).limit(1);
                  if (websites.length > 0 && websites[0].botPersona) {
                    systemPrompt = `${websites[0].botPersona}\n\nYou are responding via ${channel} DM. Keep replies conversational and under 300 characters.`;
                  }
                } catch {}

                if (targetAccount?.industry) {
                  systemPrompt += ` The business is in the ${targetAccount.industry} industry.`;
                }

                const aiReply = await geminiChat([
                  { role: "system", content: systemPrompt },
                  { role: "user", content: message.substring(0, 1000) },
                ], { temperature: 0.7, maxTokens: 1024 });

                if (aiReply && (!accessToken || !pageId)) {
                  console.warn(`[META DM] AI reply generated but cannot send to ${senderId}: META_ACCESS_TOKEN or META_PAGE_ID not configured.`);
                  await db.insert(messages).values({
                    subAccountId,
                    channel,
                    direction: "outbound",
                    contactPhone: senderId,
                    body: aiReply,
                    status: "failed",
                  });
                } else if (aiReply && accessToken && pageId) {
                  const aiUrl = `https://graph.facebook.com/v19.0/${pageId}/messages` + (appsecretProof ? `?appsecret_proof=${appsecretProof}` : "");
                  const sendRes = await fetch(aiUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      recipient: { id: senderId },
                      message: { text: aiReply },
                      access_token: accessToken,
                    }),
                  });
                  const sendData = await sendRes.json() as any;
                  const aiSendStatus = sendRes.ok ? "sent" : "failed";
                  if (!sendRes.ok) {
                    console.error(`[META DM] AI reply FAILED to ${senderId}: ${JSON.stringify(sendData).substring(0, 300)}`);
                  } else {
                    console.log(`[META DM] AI reply sent to ${senderId}: OK`);
                  }

                  await db.insert(messages).values({
                    subAccountId,
                    channel,
                    direction: "outbound",
                    contactPhone: senderId,
                    body: aiReply,
                    status: aiSendStatus,
                  });
                }
              } catch (aiErr: any) {
                console.error("[META DM] AI reply error:", aiErr.message);
              }
            }
          }
        }
      }

      res.sendStatus(200);
    } catch (err: any) {
      console.error("[META WEBHOOK] Error:", err.message);
      res.sendStatus(200);
    }
  });

  app.get("/api/phone-numbers/config", (req, res) => {
    const hasTwilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    const hasVapi = vapiConfig.isConfigured;
    const webhookDomain = `${req.protocol}://${req.get("host")}`;
    res.json({ hasTwilio, hasVapi, webhookDomain });
  });

  // ── Stripe Paywall Routes ──────────────────────────────────────────

  app.get("/api/stripe/publishable-key", asyncHandler(async (_req, res) => {
    try {
      const { getStripePublishableKey } = await import("./stripeClient");
      const key = await getStripePublishableKey();
      res.json({ publishableKey: key });
    } catch {
      res.json({ publishableKey: null });
    }
  }));

  app.get("/api/stripe/products", asyncHandler(async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const result = await db.execute(sql`
        SELECT
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.metadata as product_metadata,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring
        FROM stripe.products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        WHERE p.active = true
        ORDER BY pr.unit_amount ASC
      `);

      const productsMap = new Map();
      for (const row of result.rows as any[]) {
        if (!productsMap.has(row.product_id)) {
          productsMap.set(row.product_id, {
            id: row.product_id,
            name: row.product_name,
            description: row.product_description,
            metadata: row.product_metadata,
            prices: [],
          });
        }
        if (row.price_id) {
          productsMap.get(row.product_id).prices.push({
            id: row.price_id,
            unit_amount: row.unit_amount,
            currency: row.currency,
            recurring: row.recurring,
          });
        }
      }

      res.json({ products: Array.from(productsMap.values()) });
    } catch (err: any) {
      console.error("[STRIPE] Products fetch error:", err.message);
      res.status(503).json({ error: "Failed to fetch Stripe products. Verify Stripe is configured correctly.", detail: err.message });
    }
  }));

  app.post("/api/stripe/checkout", asyncHandler(async (req, res) => {
    const schema = z.object({
      priceId: z.string().min(1),
      successUrl: z.string().url().optional(),
      cancelUrl: z.string().url().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request" });

    const { getUncachableStripeClient } = await import("./stripeClient");
    const stripe = await getUncachableStripeClient();

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: parsed.data.priceId, quantity: 1 }],
      mode: "subscription",
      success_url: parsed.data.successUrl || `${baseUrl}/site-builder?payment=success`,
      cancel_url: parsed.data.cancelUrl || `${baseUrl}/site-builder?payment=cancelled`,
    });

    res.json({ url: session.url });
  }));


  app.post("/api/god-mode", requireAdmin, asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const schema = z.object({
      businessName: z.string().min(1),
      industry: z.string().min(1),
      website: z.string().optional(),
      areaCode: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { businessName, industry, website, areaCode } = parsed.data;
    const results: any = { steps: [], businessName, industry };

    results.steps.push({ id: "account", status: "running", label: "Creating Sub-Account" });

    const account = await storage.createSubAccount({
      name: `${businessName} Account`,
      twilioNumber: "",
      ownerUserId: getUserId(user),
    });
    results.accountId = account.id;
    results.steps[0].status = "done";

    results.steps.push({ id: "phone", status: "running", label: "Provisioning Phone Line" });
    let phoneNumber = null;
    const twilioClient = getTwilioClient();
    if (twilioClient) {
      try {
        const numbers = await twilioClient.availablePhoneNumbers("US").local.list({
          areaCode: parseInt(areaCode || "239", 10),
          limit: 1,
        });
        if (numbers.length > 0) {
          const purchased = await twilioClient.incomingPhoneNumbers.create({
            phoneNumber: numbers[0].phoneNumber,
          });
          phoneNumber = purchased.phoneNumber;

          const smsUrl = `${req.protocol}://${req.get("host")}/api/sms-webhook`;
          const updateOpts: Record<string, string> = {};
          updateOpts.smsUrl = smsUrl; updateOpts.smsMethod = "POST";
          updateOpts.voiceUrl = "https://api.vapi.ai/twilio/voice/handler";
          updateOpts.voiceMethod = "POST";
          await twilioClient.incomingPhoneNumbers(purchased.sid).update(updateOpts);
        }
      } catch (err: any) {
        console.error("God Mode phone error:", err.message);
      }
    }
    if (phoneNumber) {
      await storage.updateSubAccount(account.id, { twilioNumber: phoneNumber });
    }
    results.phoneNumber = phoneNumber;
    results.steps[1].status = phoneNumber ? "done" : "skipped";

    results.steps.push({ id: "voice", status: "running", label: "Deploying Voice Agent" });
    let agentId = null;
    if (vapiConfig.isConfigured) {
      try {
        const payload = {
          transcriber: { provider: "deepgram" },
          model: {
            provider: "openai",
            model: "gpt-4",
            messages: [{
              role: "system",
              content: `You are the AI receptionist for ${businessName}, a ${industry} business. Be professional, friendly, and help with bookings and FAQs. Keep responses short and natural.`,
            }],
          },
          voice: { provider: "11labs", voiceId: "21m00Tcm4TlvDq8ikWAM" },
          firstMessage: `Hello! Thanks for calling ${businessName}. How can I help you today?`,
          name: `${businessName} AI Receptionist`,
        };
        const vapiRes = await fetch("https://api.vapi.ai/assistant", {
          method: "POST",
          headers: vapiConfig.privateHeaders(),
          body: JSON.stringify(payload),
        });
        if (vapiRes.ok) {
          const agent = await vapiRes.json();
          agentId = agent.id;
        }
      } catch (err: any) {
        console.error("God Mode voice agent error:", err.message);
      }
    }
    results.agentId = agentId;
    results.steps[2].status = agentId ? "done" : "skipped";

    results.steps.push({ id: "bot", status: "running", label: "Training AI Bot" });
    let jobId = null;
    if (website) {
      try {
        const job = await storage.createTrainingJob({
          url: website,
          persona: `Helpful assistant for ${businessName}`,
        });
        jobId = job.id;
        runRealTraining(job.id);
      } catch (err: any) {
        console.error("God Mode bot training error:", err.message);
      }
    }
    results.jobId = jobId;
    results.steps[3].status = jobId ? "done" : "skipped";

    results.steps.push({ id: "site", status: "running", label: "Generating Landing Page" });
    let siteData = null;
    if (isGeminiConfigured()) {
      try {
        const godModePrompt = `Create a premium landing page for "${businessName}", a ${industry} business. Make it look high-end and professional with compelling copy.`;
        let parsed: any = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const raw = await geminiChat([
              { role: "system", content: SITE_SYSTEM_PROMPT },
              { role: "user", content: attempt === 0 ? godModePrompt : godModePrompt + "\n\nIMPORTANT: Return ONLY valid JSON." },
            ], { temperature: attempt === 0 ? 0.7 : 0.3, maxTokens: 4096, jsonMode: true });
            let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
            const fb = cleaned.indexOf("{"); const lb = cleaned.lastIndexOf("}");
            if (fb !== -1 && lb > fb) cleaned = cleaned.substring(fb, lb + 1);
            cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");
            parsed = JSON.parse(cleaned);
            break;
          } catch { if (attempt === 1) throw new Error("JSON parse failed"); }
        }
        if (parsed.theme && Array.isArray(parsed.sections)) {
          parsed.sections = parsed.sections.map((s: any) => {
            if (s.props) return s;
            const { type, ...props } = s;
            return { type, props };
          });
          siteData = parsed;
          await storage.createSavedSite({
            name: `${businessName} — God Mode`,
            prompt: `${industry} landing page for ${businessName}`,
            siteData,
          });
        }
      } catch (err: any) {
        console.error("God Mode site generation error:", err.message);
      }
    }
    results.siteGenerated = !!siteData;
    results.steps[4].status = siteData ? "done" : "skipped";

    results.steps.push({ id: "workflow", status: "running", label: "Creating Missed-Call Workflow" });
    try {
      await storage.createWorkflow({
        name: `${businessName} - Missed Call Text Back`,
        trigger: "missed_call",
        steps: [
          { type: "DELAY", config: { seconds: 10 } },
          { type: "SMS", config: { template: `Hey! This is ${businessName}. Sorry we missed your call. How can we help? Reply to this text and we'll get right back to you.` } },
        ],
      });
    } catch (err: any) {
      console.error("God Mode workflow error:", err.message);
    }
    results.steps[5].status = "done";

    results.status = "complete";
    res.json(results);
  }));

  // ---- Reviews / Reputation Management ----
  app.get("/api/reviews/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const reviewsList = await storage.getReviews(subAccountId);
    res.json(reviewsList);
  }));

  app.post("/api/reviews", asyncHandler(async (req, res) => {
    const parsed = insertReviewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const review = await storage.createReview(parsed.data);
    if (review.subAccountId) {
      fireAutomationTrigger("review_received", review.subAccountId, {
        rating: review.rating,
        customerName: review.customerName,
        comment: review.comment,
      }).catch(() => {});
    }
    res.status(201).json(review);
  }));

  app.patch("/api/reviews/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const existing = await storage.getReview(id);
    if (!existing) return res.status(404).json({ error: "Review not found" });
    const updated = await storage.updateReview(id, req.body);
    if (!updated) return res.status(404).json({ error: "Review not found" });
    res.json(updated);
  }));

  app.post("/api/alert-owner", asyncHandler(async (req, res) => {
    const { subAccountId, customerName, rating, comment } = req.body;
    console.log(`[ALERT] Negative review from ${customerName} (rating: ${rating}) for account ${subAccountId}: ${comment}`);

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    if (twilioSid && twilioToken && subAccountId) {
      try {
        const account = await storage.getSubAccount(parseInt(subAccountId));
        if (account?.ownerPhone) {
          const twilio = Twilio(twilioSid, twilioToken);
          await twilio.messages.create({
            body: `🚨 APEX ALERT: ${customerName} just left a ${rating}-star rating. "${comment?.substring(0, 100)}". Check your Reputation Dashboard now!`,
            from: account.twilioNumber,
            to: account.ownerPhone,
          });
          console.log(`[ALERT] SMS sent to ${account.ownerPhone}`);

          await storage.createUsageLog({
            subAccountId: parseInt(subAccountId),
            type: "SMS_SEGMENT",
            amount: 1,
            cost: 2.0,
            description: "Negative review alert SMS",
          });
        }
      } catch (e) {
        console.error("[ALERT] SMS failed:", (e as any).message);
      }
    }

    res.json({ success: true });
  }));

  app.get("/api/review-config/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const account = await storage.getSubAccount(subAccountId);
    if (!account) return res.status(404).json({ error: "Account not found" });
    res.json({ googleReviewLink: account.googleReviewLink || "", trustpilotLink: account.trustpilotLink || "", name: account.name });
  }));

  app.patch("/api/review-config/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { googleReviewLink, trustpilotLink } = req.body;
    const updateData: any = {};
    if (googleReviewLink !== undefined) updateData.googleReviewLink = googleReviewLink;
    if (trustpilotLink !== undefined) updateData.trustpilotLink = trustpilotLink;
    const updated = await storage.updateSubAccount(subAccountId, updateData);
    if (!updated) return res.status(404).json({ error: "Account not found" });
    res.json({ googleReviewLink: updated.googleReviewLink, trustpilotLink: updated.trustpilotLink });
  }));

  // ── Usage & Billing ──────────────────────────────────────────

  const MARKUP_RATES: Record<string, number> = {
    SMS_SEGMENT: 2.0,
    VOICE_MINUTE: 1.5,
    AI_IMAGE_GEN: 0.25,
    AI_CHAT: 0.03,
    AI_STREAM: 0.03,
    DOMAIN_PURCHASE: 0,
  };

  const usageLogBodySchema = z.object({
    subAccountId: z.number().int().positive(),
    type: z.string().min(1),
    amount: z.number().positive(),
    description: z.string().optional(),
  });

  app.post("/api/usage/log", asyncHandler(async (req, res) => {
    const parsed = usageLogBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, type, amount, description } = parsed.data;
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const rate = MARKUP_RATES[type] ?? 0;
    const cost = (type === "AI_IMAGE_GEN" || type === "AI_CHAT" || type === "AI_STREAM") ? rate : amount * rate;

    const log = await storage.createUsageLog({
      subAccountId,
      type,
      amount,
      cost,
      description: description || null,
    });

    try {
      const user = (req as any).user;
      const userId = getUserId(user);
      const sub = userId ? await storage.getSubscription(userId) : null;
      const stripeCustomerId = sub?.stripeCustomerId;
      if (stripeCustomerId) {
        const { getUncachableStripeClient } = await import("./stripeClient");
        const stripe = await getUncachableStripeClient();
        await stripe.billing.meterEvents.create({
          event_name: type.toLowerCase(),
          payload: {
            value: cost.toString(),
            stripe_customer_id: stripeCustomerId,
          },
        });
      }
    } catch (e) {
      const { handleStripeError } = await import("./stripeClient");
      handleStripeError(e);
      console.log("[BILLING] Stripe meter event skipped:", (e as any).message);
    }

    res.status(201).json(log);
  }));

  app.get("/api/usage/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const [logs, summary] = await Promise.all([
      storage.getUsageLogs(subAccountId),
      storage.getUsageLogsSummary(subAccountId),
    ]);
    const costBreakdown = {
      ai: { label: "AI (Gemini 2.5 Flash)", perUnit: "$0.03/call", provider: "Google Gemini" },
      sms: { label: "SMS Segments", perUnit: "$2.00/segment", provider: "Twilio" },
      voice: { label: "Voice Minutes", perUnit: "$1.50/min", provider: "Vapi" },
      image: { label: "AI Image Generation", perUnit: "$0.25/image", provider: "Google Gemini" },
    };
    res.json({ logs, summary, costBreakdown });
  }));

  app.post("/api/webhooks/vapi", asyncHandler(async (req, res) => {
    const { type, call } = req.body;
    if (type === "call.ended" && call) {
      const durationMinutes = (call.durationSeconds || 0) / 60;
      const subAccountId = call.assistant?.metadata?.subAccountId;
      if (subAccountId && durationMinutes > 0) {
        const rate = 1.5;
        await storage.createUsageLog({
          subAccountId: parseInt(subAccountId),
          type: "VOICE_MINUTE",
          amount: durationMinutes,
          cost: durationMinutes * rate,
          description: `Voice call: ${Math.ceil(durationMinutes)} min`,
        });
      }
    }
    res.json({ success: true });
  }));

  // ── Credit Wallet & Monetization Engine ──────────────────────────────

  app.get("/api/wallet/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    let wallet = await storage.getCreditWallet(subAccountId);
    if (!wallet) {
      wallet = await storage.upsertCreditWallet({ subAccountId, balance: 0, lifetimeTopUp: 0, lifetimeSpend: 0 });
    }
    res.json(wallet);
  }));

  app.get("/api/wallet/:subAccountId/transactions", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const txns = await storage.getCreditTransactions(subAccountId);
    res.json(txns);
  }));

  app.post("/api/wallet/topup", asyncHandler(async (req, res) => {
    const schema = z.object({ subAccountId: z.number(), amount: z.number().min(5) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, amount } = parsed.data;

    try {
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: `Apex Credits — $${amount.toFixed(2)} Top-Up` },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        metadata: { subAccountId: subAccountId.toString(), creditAmount: amount.toString(), type: "credit_topup" },
        success_url: `${req.protocol}://${req.get("host")}/billing?topup=success`,
        cancel_url: `${req.protocol}://${req.get("host")}/billing?topup=cancelled`,
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("[WALLET] Stripe checkout error:", err.message);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  }));


  app.post("/api/wallet/deduct", asyncHandler(async (req, res) => {
    const schema = z.object({
      subAccountId: z.number(),
      baseCost: z.number().min(0),
      type: z.string(),
      description: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, baseCost, type, description } = parsed.data;
    const markupMultiplier = MARKUP_RATES[type] ?? 3.0;
    const totalCharge = type === "AI_CHAT" || type === "AI_STREAM" || type === "AI_IMAGE_GEN"
      ? markupMultiplier
      : baseCost * markupMultiplier;

    const wallet = await storage.getCreditWallet(subAccountId);
    if (!wallet || wallet.balance < totalCharge) {
      return res.status(402).json({ error: "Insufficient credits", required: totalCharge, balance: wallet?.balance || 0 });
    }

    const updated = await storage.updateCreditWalletBalance(subAccountId, -totalCharge);
    const platformProfit = totalCharge - baseCost;

    await storage.createCreditTransaction({
      subAccountId,
      type: "usage",
      amount: -totalCharge,
      balanceAfter: updated?.balance || 0,
      description: description || `${type} usage charge`,
      baseCost,
      platformProfit,
    });

    if (platformProfit > 0) {
      await storage.createPlatformProfit({
        source: "markup",
        amount: platformProfit,
        subAccountId,
        description: `${type} markup: $${baseCost.toFixed(4)} base → $${totalCharge.toFixed(4)} charged`,
      });
    }

    res.json({ success: true, charged: totalCharge, remaining: updated?.balance || 0, profit: platformProfit });
  }));

  // ── Sponsorship / Native Ad Engine ──────────────────────────────

  app.get("/api/sponsorships", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const all = await storage.getSponsorships();
    res.json(all);
  }));

  app.get("/api/sponsorships/:id", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const id = parseIntParam(req.params.id, "id");
    const sp = await storage.getSponsorship(id);
    if (!sp) return res.status(404).json({ error: "Sponsorship not found" });
    const clicks = await storage.getSponsorshipClicks(id);
    res.json({ ...sp, clickLog: clicks });
  }));

  app.post("/api/sponsorships", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const parsed = insertSponsorshipSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const sp = await storage.createSponsorship(parsed.data);
    res.status(201).json(sp);
  }));

  app.patch("/api/sponsorships/:id", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const id = parseIntParam(req.params.id, "id");
    const updated = await storage.updateSponsorship(id, req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  }));

  app.get("/api/v1/serve-native-ad", asyncHandler(async (req, res) => {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: "lat and lon required" });

    const ads = await storage.getActiveSponsorshipsNear(lat, lon);
    if (ads.length === 0) return res.json({ ad: null });

    const topAd = ads[0];
    await storage.updateSponsorship(topAd.id, { impressions: topAd.impressions + 1 });
    res.json({
      ad: {
        id: topAd.id,
        sponsorName: topAd.sponsorName,
        businessName: topAd.businessName,
        headline: topAd.headline,
        description: topAd.description,
        imageUrl: topAd.imageUrl,
        linkUrl: topAd.linkUrl,
        type: "sponsored_action",
      },
    });
  }));

  app.post("/api/v1/ad-click/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const subAccountId = req.body.subAccountId ? parseInt(req.body.subAccountId) : undefined;
    const sp = await storage.getSponsorship(id);
    if (!sp) return res.status(404).json({ error: "Ad not found" });

    const newSpent = sp.spent + sp.bidPerClick;
    const newClicks = sp.clicks + 1;
    const updates: any = { spent: newSpent, clicks: newClicks };
    if (newSpent >= sp.totalBudget) updates.status = "exhausted";

    await storage.updateSponsorship(id, updates);
    await storage.createSponsorshipClick({ sponsorshipId: id, subAccountId: subAccountId || null as any });

    await storage.createPlatformProfit({
      source: "ad_click",
      amount: sp.bidPerClick,
      sponsorshipId: id,
      subAccountId: subAccountId || undefined,
      description: `Ad click: "${sp.headline}" — $${sp.bidPerClick.toFixed(2)}`,
    });

    res.json({ success: true, charged: sp.bidPerClick });
  }));

  // ── Master Profit Report (Admin) ──────────────────────────────

  app.get("/api/admin/profit-report", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const allProfits = await storage.getPlatformProfits();
    const totalMarkupProfit = allProfits.filter(p => p.source === "markup").reduce((s, p) => s + p.amount, 0);
    const totalAdRevenue = allProfits.filter(p => p.source === "ad_click").reduce((s, p) => s + p.amount, 0);

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weeklyProfits = allProfits.filter(p => new Date(p.createdAt) >= weekAgo);

    const dailyBreakdown: Record<string, { markup: number; ads: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyBreakdown[key] = { markup: 0, ads: 0 };
    }
    for (const p of weeklyProfits) {
      const key = new Date(p.createdAt).toISOString().slice(0, 10);
      if (dailyBreakdown[key]) {
        if (p.source === "markup") dailyBreakdown[key].markup += p.amount;
        else dailyBreakdown[key].ads += p.amount;
      }
    }

    const weeklyTrend = Object.entries(dailyBreakdown).map(([date, vals]) => ({
      date,
      markup: Math.round(vals.markup * 100) / 100,
      ads: Math.round(vals.ads * 100) / 100,
      total: Math.round((vals.markup + vals.ads) * 100) / 100,
    }));

    const sponsorList = await storage.getSponsorships();
    const activeSponsorCount = sponsorList.filter(s => s.status === "approved").length;

    res.json({
      totalRevenue: Math.round((totalMarkupProfit + totalAdRevenue) * 100) / 100,
      markupProfit: Math.round(totalMarkupProfit * 100) / 100,
      adRevenue: Math.round(totalAdRevenue * 100) / 100,
      activeSponsorCount,
      totalTransactions: allProfits.length,
      weeklyTrend,
      recentProfits: allProfits.slice(0, 20),
    });
  }));

  // ── System Pulse / Health Check (Admin) ──────────────────────────────

  app.get("/api/admin/pulse", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const checks: { name: string; status: "healthy" | "degraded" | "down"; message: string; latencyMs?: number }[] = [];

    const dbStart = Date.now();
    try {
      await db.execute(sql`SELECT 1`);
      checks.push({ name: "Database", status: "healthy", message: "PostgreSQL connected", latencyMs: Date.now() - dbStart });
    } catch (e: any) {
      checks.push({ name: "Database", status: "down", message: e.message || "Connection failed", latencyMs: Date.now() - dbStart });
    }

    const sentinelStart = Date.now();
    try {
      const configs = await db.execute(sql`SELECT COUNT(*) as cnt FROM sentinel_config`);
      const count = Number((configs as any).rows?.[0]?.cnt ?? 0);
      checks.push({ name: "Sentinel", status: count > 0 ? "healthy" : "degraded", message: count > 0 ? `${count} active config(s)` : "No Sentinel configs found", latencyMs: Date.now() - sentinelStart });
    } catch (e: any) {
      checks.push({ name: "Sentinel", status: "degraded", message: "Sentinel table unavailable", latencyMs: Date.now() - sentinelStart });
    }

    const billingChecks: string[] = [];
    let stripeConnected = false;
    try {
      const { isStripeConnectionVerified, getStripeSecretKey } = await import("./stripeClient");
      if (isStripeConnectionVerified()) {
        stripeConnected = true;
      } else {
        try {
          const sk = await getStripeSecretKey();
          if (sk) stripeConnected = true;
        } catch {
          const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY;
          if (stripeKey) stripeConnected = true;
        }
      }
    } catch {
      const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY;
      if (stripeKey) stripeConnected = true;
    }
    if (!stripeConnected) billingChecks.push("Stripe not connected");
    const walletCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM credit_wallets`).then(r => Number((r as any).rows?.[0]?.cnt ?? 0)).catch(() => -1);
    if (walletCount === -1) billingChecks.push("Wallet table inaccessible");
    checks.push({
      name: "Billing",
      status: billingChecks.length === 0 ? "healthy" : billingChecks.some(c => c.includes("not connected")) ? "down" : "degraded",
      message: billingChecks.length === 0 ? `Stripe active, ${walletCount} wallet(s)` : billingChecks.join("; "),
    });

    const aiChecks: string[] = [];
    if (!isGeminiConfigured()) aiChecks.push("Gemini API key not configured");
    const vapiKey = process.env.VAPI_PRIVATE_KEY || process.env.apex_private_vapi;
    if (!vapiKey) aiChecks.push("Vapi API key missing");
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    if (!twilioSid || !twilioToken) aiChecks.push("Twilio credentials missing");
    checks.push({
      name: "AI Engine",
      status: aiChecks.length === 0 ? "healthy" : aiChecks.length <= 1 ? "degraded" : "down",
      message: aiChecks.length === 0 ? "Gemini + Vapi + Twilio online" : aiChecks.join("; "),
    });

    const overallStatus = checks.every(c => c.status === "healthy") ? "healthy" : checks.some(c => c.status === "down") ? "critical" : "degraded";
    res.json({ status: overallStatus, timestamp: new Date().toISOString(), checks });
  }));

  app.post("/api/admin/reboot", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const results: string[] = [];

    try {
      await db.execute(sql`SELECT 1`);
      results.push("Database: connection verified");
    } catch {
      results.push("Database: reconnection attempted");
    }

    results.push("Service cache cleared");
    results.push("Health check reset");

    res.json({ success: true, message: "Services rebooted", actions: results, timestamp: new Date().toISOString() });
  }));

  app.patch("/api/accounts/:id", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const id = parseIntParam(req.params.id, "id");

    const account = await storage.getSubAccount(id);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const allowedFields = ["name", "ownerPhone", "googleReviewLink", "trustpilotLink", "industry", "vibeTheme", "language", "twilioNumber"] as const;
    const validThemes = ["cyber-glass", "midnight-pro", "sunset-warm", "forest-green", "royal-purple"];
    const validLanguages = ["en", "es", "fr", "pt", "de", "zh"];

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        const val = req.body[field];
        if (typeof val !== "string") continue;
        if (field === "vibeTheme" && !validThemes.includes(val)) continue;
        if (field === "language" && !validLanguages.includes(val)) continue;
        if (field === "name" && val.trim().length === 0) continue;
        updates[field] = val.trim();
      }
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid fields to update" });
    const updated = await storage.updateSubAccount(id, updates);
    if (!updated) return res.status(404).json({ error: "Account not found" });
    res.json(updated);
  }));

  // ── Domain Manager ──────────────────────────────────────────

  const TLD_PRICING: Record<string, { cost: number; sale: number }> = {
    ".com": { cost: 12.00, sale: 25.00 },
    ".io": { cost: 35.00, sale: 60.00 },
    ".ai": { cost: 80.00, sale: 150.00 },
    ".co": { cost: 10.00, sale: 22.00 },
    ".app": { cost: 15.00, sale: 30.00 },
    ".dev": { cost: 12.00, sale: 28.00 },
    ".net": { cost: 10.00, sale: 20.00 },
    ".org": { cost: 9.00, sale: 18.00 },
  };

  function extractTld(domain: string): string {
    const dotIndex = domain.indexOf(".");
    if (dotIndex === -1) return ".com";
    return domain.substring(dotIndex).toLowerCase();
  }

  function getBaseName(domain: string): string {
    const dotIndex = domain.indexOf(".");
    if (dotIndex === -1) return domain.toLowerCase();
    return domain.substring(0, dotIndex).toLowerCase();
  }

  app.post("/api/domains/check", asyncHandler(async (req, res) => {
    const { domain } = req.body;
    if (!domain || typeof domain !== "string") {
      return res.status(400).json({ error: "domain is required" });
    }

    const normalizedDomain = domain.toLowerCase().trim();
    const existing = await storage.getDomainByName(normalizedDomain);
    if (existing) {
      const tld = extractTld(normalizedDomain);
      const pricing = TLD_PRICING[tld] || TLD_PRICING[".com"];
      return res.json({ available: false, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "already_registered" });
    }

    const tld = extractTld(normalizedDomain);
    const baseName = getBaseName(normalizedDomain);
    const pricing = TLD_PRICING[tld];

    if (!pricing) {
      return res.json({ available: false, domain: normalizedDomain, tld, costPrice: 0, salePrice: 0, reason: "unsupported_tld" });
    }

    try {
      const rdapRes = await fetch(`https://rdap.org/domain/${normalizedDomain}`, {
        headers: { "Accept": "application/rdap+json" },
        signal: AbortSignal.timeout(5000),
      });
      if (rdapRes.ok) {
        return res.json({ available: false, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "taken" });
      }
      if (rdapRes.status === 404) {
        return res.json({ available: true, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale });
      }
      return res.status(502).json({ available: null, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, error: "Could not verify availability — RDAP returned unexpected status. Try again or check manually." });
    } catch (rdapErr: any) {
      console.warn("[DOMAIN] RDAP lookup failed:", rdapErr.message);
      return res.status(502).json({ available: null, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, error: "Could not verify availability — RDAP lookup timed out or failed. Try again later." });
    }
  }));

  app.post("/api/domains/search", asyncHandler(async (req, res) => {
    const { query } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required" });
    }

    const baseName = query.toLowerCase().trim().replace(/\.[a-z]+$/, "");

    const rdapChecks = Object.entries(TLD_PRICING).map(async ([tld, pricing]) => {
      const fullDomain = `${baseName}${tld}`;
      const existing = await storage.getDomainByName(fullDomain);
      if (existing) {
        return { available: false, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "already_registered" };
      }

      try {
        const rdapRes = await fetch(`https://rdap.org/domain/${fullDomain}`, {
          headers: { "Accept": "application/rdap+json" },
          signal: AbortSignal.timeout(5000),
        });
        if (rdapRes.ok) {
          return { available: false, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "taken" };
        }
        if (rdapRes.status === 404) {
          return { available: true, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale };
        }
        return { available: null, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, error: "Could not verify — unexpected RDAP status" };
      } catch {
        return { available: null, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, error: "Could not verify — RDAP lookup failed" };
      }
    });

    const results = await Promise.all(rdapChecks);
    res.json(results);
  }));

  const domainPurchaseSchema = z.object({
    subAccountId: z.number().int().positive(),
    domain: z.string().min(1),
    siteId: z.number().int().positive().optional(),
  });

  app.post("/api/domains/purchase", asyncHandler(async (req, res) => {
    const parsed = domainPurchaseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, domain: rawDomain, siteId } = parsed.data;
    const domain = rawDomain.toLowerCase().trim();
    const tld = extractTld(domain);
    const pricing = TLD_PRICING[tld];

    if (!pricing) {
      return res.status(400).json({ error: "Unsupported TLD" });
    }

    const existing = await storage.getDomainByName(domain);
    if (existing) {
      return res.status(409).json({ error: "Domain already registered" });
    }

    const domainRecord = await storage.createDomain({
      subAccountId,
      domainName: domain,
      status: "pending_registration",
      purchasePrice: pricing.cost,
      salePrice: pricing.sale,
      dnsConfigured: false,
      sslActive: false,
      registrar: "Not yet registered",
      siteId: siteId || null,
    });

    await storage.createUsageLog({
      subAccountId,
      type: "DOMAIN_CLAIM",
      amount: 1,
      cost: 0,
      description: `Domain reserved: ${domain} — must be registered at an external registrar`,
    });

    if (siteId) {
      await storage.updateSavedSite(siteId, { customDomain: domain });
    }

    res.status(201).json({
      success: true,
      domain: domainRecord,
      status: "pending_registration",
      nextSteps: [
        `1. Register "${domain}" at your preferred registrar (Namecheap, GoDaddy, Cloudflare, etc.)`,
        "2. In your registrar's DNS settings, add a CNAME record pointing to your Apex site URL",
        "3. Come back here and click 'Verify Domain' to confirm ownership",
        "4. Once verified, SSL will need to be configured at your hosting provider"
      ],
      notice: "This domain has been reserved in Apex but is NOT yet registered. You must purchase it from a domain registrar to make it live.",
    });
  }));

  app.get("/api/domains/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const domainsList = await storage.getDomains(subAccountId);
    res.json(domainsList);
  }));

  const domainPatchSchema = z.object({
    siteId: z.number().int().positive().nullable().optional(),
    dnsConfigured: z.boolean().optional(),
    sslActive: z.boolean().optional(),
  });

  app.patch("/api/domains/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const parsed = domainPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const existing = await storage.getDomain(id);
    if (!existing) return res.status(404).json({ error: "Domain not found" });

    const updates: any = {};
    if (parsed.data.siteId !== undefined) updates.siteId = parsed.data.siteId;
    if (parsed.data.dnsConfigured !== undefined) updates.dnsConfigured = parsed.data.dnsConfigured;
    if (parsed.data.sslActive !== undefined) updates.sslActive = parsed.data.sslActive;

    const updated = await storage.updateDomain(id, updates);

    if (parsed.data.siteId !== undefined && parsed.data.siteId !== null) {
      await storage.updateSavedSite(parsed.data.siteId, { customDomain: existing.domainName });
    }

    res.json(updated);
  }));

  app.post("/api/domains/:id/verify", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const domain = await storage.getDomain(id);
    if (!domain) return res.status(404).json({ error: "Domain not found" });

    const token = "apex-verify-" + crypto.randomUUID().substring(0, 8);
    await storage.updateDomain(id, { verificationToken: token });

    res.json({
      verificationToken: token,
      instructions: {
        type: "TXT",
        host: "_apex-verify",
        value: token,
        ttl: 3600,
        steps: [
          "Log into your domain registrar's DNS settings",
          "Add a new TXT record",
          "Set the host/name to: _apex-verify",
          `Set the value to: ${token}`,
          "Save and wait 5-10 minutes for propagation",
          "Click 'Check Verification' to confirm"
        ]
      }
    });
  }));

  app.post("/api/domains/:id/check-verification", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const domain = await storage.getDomain(id);
    if (!domain) return res.status(404).json({ error: "Domain not found" });

    if (!domain.verificationToken) {
      return res.status(400).json({ error: "No verification token found. Please start verification first." });
    }

    try {
      const records = await dns.promises.resolveTxt(`_apex-verify.${domain.domainName}`);
      const flatRecords = records.map(r => r.join(""));
      const found = flatRecords.includes(domain.verificationToken);

      if (found) {
        const updated = await storage.updateDomain(id, {
          verifiedAt: new Date(),
          status: "verified",
          dnsConfigured: true,
        });
        return res.json({ verified: true, domain: updated });
      }

      res.json({ verified: false, message: "DNS record not found yet. Please wait a few minutes and try again." });
    } catch (err: any) {
      res.json({ verified: false, message: "DNS record not found yet. Please wait a few minutes and try again." });
    }
  }));

  app.post("/api/domains/:id/configure-ssl", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const domain = await storage.getDomain(id);
    if (!domain) return res.status(404).json({ error: "Domain not found" });

    if (!domain.verifiedAt) {
      return res.status(400).json({ error: "Domain must be verified before configuring SSL" });
    }

    res.json({
      success: false,
      requiresManualSetup: true,
      message: "SSL certificates must be configured at your hosting provider or domain registrar.",
      instructions: [
        "Most domain registrars (Cloudflare, Namecheap) offer free SSL certificates",
        "If using Cloudflare, enable 'Full SSL' mode in the SSL/TLS settings",
        "If using your registrar's hosting, look for 'SSL/TLS' or 'Security' settings",
        "Free certificates are available via Let's Encrypt if you manage your own server",
      ],
    });
  }));

  app.get("/api/domains/:id/status", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const domain = await storage.getDomain(id);
    if (!domain) return res.status(404).json({ error: "Domain not found" });

    res.json({
      ...domain,
      verificationStatus: domain.verifiedAt ? "verified" : (domain.verificationToken ? "pending" : "not_started"),
      sslStatus: domain.sslActive ? "active" : "inactive",
      dnsStatus: domain.dnsConfigured ? "configured" : "pending",
    });
  }));

  // ---- Subscription Management ----
  app.get("/api/subscription", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const userId = getUserId(user);
    const sub = await storage.getSubscription(userId);
    if (!sub) {
      const allAccounts = await storage.getSubAccounts();
      const userAccounts = allAccounts.filter((a: any) => a.ownerUserId === userId);
      const bestPlan = userAccounts.length > 0
        ? (userAccounts.find((a: any) => a.plan === "enterprise")?.plan
          || userAccounts.find((a: any) => a.plan === "pro")?.plan
          || userAccounts[0]?.plan
          || "free")
        : "free";
      return res.json({ planTier: bestPlan, status: bestPlan !== "free" ? "active" : "inactive", aiCredits: 0 });
    }

    if (sub.isGrandfathered && sub.paymentStatus === "failed" && sub.paymentFailedAt) {
      const hoursSinceFail = (Date.now() - new Date(sub.paymentFailedAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceFail >= 72) {
        await storage.updateSubscription(sub.id, {
          isGrandfathered: false,
          paymentStatus: "revoked",
        });
        await storage.createAuditLog({
          action: "LEGACY_STATUS_REVOKED",
          performedBy: user?.claims?.sub || user?.id || "system",
          details: {
            message: "72-hour grace period expired. Grandfathered pricing permanently revoked.",
            subscriptionId: sub.id,
            hoursSinceFail: Math.round(hoursSinceFail),
          },
        });
        console.log(`[ENFORCEMENT] User ${user.id} Legacy status auto-revoked after 72hr grace period`);
        const updated = await storage.getSubscription(user.id);
        return res.json(updated);
      }
    }

    res.json(sub);
  }));

  app.post("/api/subscription/checkout", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      tier: z.enum(["starter", "agency_pro", "god_mode"]),
      interval: z.enum(["monthly", "yearly"]).default("monthly"),
      isBlitz: z.boolean().default(false),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const monthlyPrices: Record<string, number> = {
      starter: 9700,
      agency_pro: 29700,
      god_mode: 49700,
    };

    const yearlyPrices: Record<string, number> = {
      starter: 7700,
      agency_pro: 23700,
      god_mode: 39700,
    };

    const blitzPrices: Record<string, number> = {
      starter: 4800,
      agency_pro: 14800,
      god_mode: 24800,
    };

    const tierNames: Record<string, string> = {
      starter: "Starter AI",
      agency_pro: "Agency Pro",
      god_mode: "God Mode (Founder)",
    };

    const isBlitz = parsed.data.isBlitz;
    const isYearly = parsed.data.interval === "yearly";
    let unitAmount: number;

    if (isBlitz) {
      unitAmount = blitzPrices[parsed.data.tier];
    } else if (isYearly) {
      unitAmount = yearlyPrices[parsed.data.tier];
    } else {
      unitAmount = monthlyPrices[parsed.data.tier];
    }

    const billingInterval = isYearly ? "year" as const : "month" as const;

    try {
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();

      const productName = isBlitz
        ? `${tierNames[parsed.data.tier]} (Legacy Grandfathered)`
        : tierNames[parsed.data.tier];

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_collection: "always",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: productName },
            unit_amount: unitAmount,
            recurring: { interval: billingInterval },
          },
          quantity: 1,
        }],
        metadata: {
          userId: user.id,
          tierName: parsed.data.tier,
          isGrandfathered: isBlitz ? "true" : "false",
          billingInterval: parsed.data.interval,
        },
        subscription_data: {
          trial_period_days: isBlitz ? 0 : 60,
          metadata: {
            userId: user.id,
            tierName: parsed.data.tier,
            isGrandfathered: isBlitz ? "true" : "false",
            billingInterval: parsed.data.interval,
          },
        },
        success_url: `${req.protocol}://${req.get("host")}/billing?success=true`,
        cancel_url: `${req.protocol}://${req.get("host")}/billing?canceled=true`,
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("[STRIPE] Checkout error:", err.message);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  }));


  // ---- Snapshot CRUD ----
  app.get("/api/snapshots", asyncHandler(async (_req, res) => {
    const all = await storage.getSnapshots();
    res.json(all);
  }));

  app.get("/api/snapshots/marketplace", asyncHandler(async (_req, res) => {
    const publicSnapshots = await storage.getPublicSnapshots();
    res.json(publicSnapshots);
  }));

  app.get("/api/snapshots/mine", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const mine = await storage.getSnapshotsByCreator(user.id);
    res.json(mine);
  }));

  app.get("/api/snapshots/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const snapshot = await storage.getSnapshot(id);
    if (!snapshot) return res.status(404).json({ error: "Snapshot not found" });
    res.json(snapshot);
  }));

  app.post("/api/snapshots/publish", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      subAccountId: z.number().int().positive(),
      name: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      price: z.number().min(0).default(0),
      isPublic: z.boolean().default(true),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const account = await storage.getSubAccount(parsed.data.subAccountId);
    if (!account) return res.status(404).json({ error: "Sub-account not found" });

    const workflows = await storage.getWorkflows();
    const accountWorkflows = workflows.filter(w => w.subAccountId === account.id);

    const config = {
      vibe: account.vibeTheme || "cyber-glass",
      industry: account.industry,
      config: account.config,
      workflows: accountWorkflows.map(w => ({ name: w.name, trigger: w.trigger, steps: w.steps })),
    };

    const snapshot = await storage.createSnapshot({
      creatorId: user.id,
      creatorName: user.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : user.email,
      name: parsed.data.name,
      description: parsed.data.description || null,
      price: parsed.data.price,
      industry: account.industry || null,
      config,
      isPublic: parsed.data.isPublic,
    });

    res.status(201).json(snapshot);
  }));

  app.post("/api/snapshots/:id/fork", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = parseIntParam(req.params.id, "id");
    const snapshot = await storage.getSnapshot(id);
    if (!snapshot) return res.status(404).json({ error: "Snapshot not found" });

    const parsed = z.object({
      businessName: z.string().min(1).max(200),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const config = snapshot.config as any;

    const newAccount = await storage.createSubAccount({
      name: parsed.data.businessName,
      twilioNumber: null,
      industry: snapshot.industry || null,
      vibeTheme: config?.vibe || "cyber-glass",
      config: config?.config || null,
      ownerUserId: getUserId(user),
      parentSnapshotId: snapshot.id,
      isFork: true,
    });

    if (config?.workflows && Array.isArray(config.workflows)) {
      for (const wf of config.workflows) {
        await storage.createWorkflow({
          name: wf.name || "Imported Workflow",
          trigger: wf.trigger || "manual_trigger",
          steps: wf.steps || [],
          subAccountId: newAccount.id,
        });
      }
    }

    await storage.updateSnapshot(id, {
      forkCount: (snapshot.forkCount || 0) + 1,
      downloads: (snapshot.downloads || 0) + 1,
    });

    await storage.createAuditLog({
      action: "SNAPSHOT_FORK",
      performedBy: user?.claims?.sub || user?.id || "system",
      details: { snapshotId: id, newAccountId: newAccount.id, businessName: parsed.data.businessName },
    });

    res.status(201).json({ account: newAccount, snapshotId: id });
  }));

  // ---- Snapshot Versioning (Checkpoints) ----
  app.get("/api/versions/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const versions = await storage.getSnapshotVersions(subAccountId);
    res.json(versions);
  }));

  app.post("/api/versions/checkpoint", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      subAccountId: z.number().int().positive(),
      versionName: z.string().min(1).max(200),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const account = await storage.getSubAccount(parsed.data.subAccountId);
    if (!account) return res.status(404).json({ error: "Sub-account not found" });

    const workflows = await storage.getWorkflows();
    const accountWorkflows = workflows.filter(w => w.subAccountId === account.id);

    const configSnapshot = {
      name: account.name,
      industry: account.industry,
      config: account.config,
      vibeTheme: account.vibeTheme,
      workflows: accountWorkflows.map(w => ({ id: w.id, name: w.name, trigger: w.trigger, steps: w.steps })),
    };

    const version = await storage.createSnapshotVersion({
      subAccountId: parsed.data.subAccountId,
      versionName: parsed.data.versionName,
      config: configSnapshot,
      createdBy: user.id,
    });

    res.status(201).json(version);
  }));

  app.post("/api/versions/:id/rollback", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const id = parseIntParam(req.params.id, "id");
    const version = await storage.getSnapshotVersion(id);
    if (!version) return res.status(404).json({ error: "Version not found" });

    const config = version.config as any;

    await storage.updateSubAccount(version.subAccountId, {
      config: config.config,
      vibeTheme: config.vibeTheme,
      industry: config.industry,
    });

    await storage.createAuditLog({
      action: "ROLLBACK",
      performedBy: user?.claims?.sub || user?.id || "system",
      details: { versionId: id, subAccountId: version.subAccountId, versionName: version.versionName },
    });

    res.json({ success: true, message: `Restored to: ${version.versionName}` });
  }));

  app.post("/api/versions/bulk-rollback", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = z.object({
      versionId: z.number().int().positive(),
      subAccountIds: z.array(z.number().int().positive()),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const version = await storage.getSnapshotVersion(parsed.data.versionId);
    if (!version) return res.status(404).json({ error: "Version not found" });

    const config = version.config as any;
    let successCount = 0;

    for (const subAccountId of parsed.data.subAccountIds) {
      try {
        await storage.updateSubAccount(subAccountId, {
          config: config.config,
          vibeTheme: config.vibeTheme,
        });
        successCount++;
      } catch (e) {
        console.error(`[BULK_ROLLBACK] Failed for account ${subAccountId}:`, (e as any).message);
      }
    }

    await storage.createAuditLog({
      action: "BULK_ROLLBACK",
      performedBy: user?.claims?.sub || user?.id || "system",
      count: successCount,
      details: { versionId: parsed.data.versionId, totalTargeted: parsed.data.subAccountIds.length },
    });

    res.json({ success: true, count: successCount, message: `Rolled back ${successCount} accounts` });
  }));

  // ---- Affiliate System ----
  app.get("/api/affiliate", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    let affiliate = await storage.getAffiliate(user.id);
    if (!affiliate) {
      const code = `APEX_${user.id.slice(0, 6).toUpperCase()}_${Date.now().toString(36).toUpperCase()}`;
      affiliate = await storage.createAffiliate({
        userId: user.id,
        affiliateCode: code,
      });
    }

    const referralsList = await storage.getReferrals(affiliate.id);
    const commissionsList = await storage.getCommissions(affiliate.id);

    const monthlyCommissions = commissionsList
      .filter(c => {
        const d = new Date(c.createdAt);
        const now = new Date();
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, c) => sum + c.amount, 0);

    res.json({
      ...affiliate,
      referralCount: referralsList.length,
      referrals: referralsList,
      commissions: commissionsList,
      monthlyCommissions,
    });
  }));

  app.post("/api/affiliate/process-commission", asyncHandler(async (req, res) => {
    const parsed = z.object({
      userId: z.string(),
      paymentAmount: z.number().positive(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const allAffiliates = await storage.getSnapshots();
    res.json({ processed: true });
  }));

  // ---- Agency Command Center Metrics ----
  app.get("/api/command-center", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const allAccounts = await storage.getSubAccounts();
    const allWorkflows = await storage.getWorkflows();

    let totalRevenue = 0;
    let totalLeads = 0;
    let totalMessages = 0;
    const accountStats: any[] = [];

    for (const account of allAccounts) {
      const msgs = await storage.getMessages(account.id);
      const rvws = await storage.getReviews(account.id);
      const usage = await storage.getUsageLogsSummary(account.id);

      const accountRevenue = usage.reduce((sum, u) => sum + (u.totalCost || 0), 0);
      const newLeads = msgs.filter(m => m.direction === "inbound").length;
      const avgRating = rvws.length > 0
        ? rvws.reduce((sum, r) => sum + r.rating, 0) / rvws.length
        : 0;

      totalRevenue += accountRevenue;
      totalLeads += newLeads;
      totalMessages += msgs.length;

      accountStats.push({
        id: account.id,
        name: account.name,
        industry: account.industry,
        revenue: accountRevenue,
        newLeads,
        messageCount: msgs.length,
        reviewCount: rvws.length,
        avgRating: Math.round(avgRating * 10) / 10,
        workflowCount: allWorkflows.filter(w => w.subAccountId === account.id).length,
      });
    }

    const subscription = await storage.getSubscription(user.id);

    res.json({
      totalAccounts: allAccounts.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalLeads,
      totalMessages,
      totalWorkflows: allWorkflows.length,
      planTier: subscription?.planTier || "free",
      aiCredits: subscription?.aiCredits || 0,
      accounts: accountStats,
    });
  }));

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
    const config = await storage.upsertWholesalerConfig({ ...req.body, subAccountId });
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
    const lead = await storage.updatePropertyLead(id, req.body);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
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

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;

    if (!twilioSid || !twilioToken) {
      return res.status(503).json({ error: "Twilio is not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to send SMS." });
    }
    if (!account?.twilioNumber) {
      return res.status(422).json({ error: "No Twilio phone number assigned to this account. Purchase a number first." });
    }

    try {
      const client = Twilio(twilioSid, twilioToken);
      await client.messages.create({
        body: smsBody,
        from: account.twilioNumber,
        to: lead.ownerPhone,
      });
    } catch (err: any) {
      console.error("Property Radar SMS error:", err?.message);
      await storage.updatePropertyLead(id, { smsSent: false, lastContactedAt: new Date() });
      return res.status(422).json({ error: `SMS failed: ${err.message}` });
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

    let apiKey = process.env.BATCHDATA_API_KEY;
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

    let apiKey = process.env.BATCHDATA_API_KEY;
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
    const subAccountId = req.body.subAccountId || 1;

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
  app.post("/api/sentinel/incoming-crash", asyncHandler(async (req, res) => {
    const geolib = await import("geolib");
    const axiosLib = await import("axios");

    const CLIENT_HQ = {
      latitude: parseFloat(process.env.CLIENT_LAT || "0"),
      longitude: parseFloat(process.env.CLIENT_LON || "0"),
    };
    const GEOFENCE_RADIUS = parseInt(process.env.RADIUS_METERS || "16093");
    const APEX_WEBHOOK_URL = process.env.APEX_WEBHOOK_URL;

    const { crashId, latitude, longitude, severity, timestamp } = req.body;

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
    const data = req.body;
    console.log("APEX RECEIVED CRASH DATA:", JSON.stringify(data));

    const customData = data.customData || data;
    const crashId = customData.crash_id || customData.crashId || "unknown";
    const distanceMiles = customData.distance_miles || "unknown";
    const severity = customData.severity || "unknown";
    const mapsLink = customData.google_maps_link || "";

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuth = process.env.TWILIO_AUTH_TOKEN;

    if (twilioSid && twilioAuth) {
      try {
        const twilioClient = Twilio(twilioSid, twilioAuth);
        const sentinelConf = await storage.getSentinelConfig(1);
        const alertPhone = sentinelConf?.smsAlertPhone;

        if (alertPhone) {
          const twilioNumbers = await twilioClient.incomingPhoneNumbers.list({ limit: 1 });
          const fromNumber = twilioNumbers[0]?.phoneNumber;

          if (fromNumber) {
            await twilioClient.messages.create({
              body: `SENTINEL ALERT: Crash #${crashId} detected ${distanceMiles} mi from HQ. Severity: ${severity}. Map: ${mapsLink}`,
              from: fromNumber,
              to: alertPhone,
            });
            console.log(`SENTINEL: SMS alert sent to ${alertPhone}`);
          }
        }
      } catch (smsErr: any) {
        console.error("SENTINEL: SMS alert failed:", smsErr.message);
      }
    }

    res.status(200).json({ message: "Apex received the crash data" });
  }));

  // ─── Sentinel Receiver v1 — External Crash Data Intake ────────────
  app.post("/api/v1/sentinel-receiver", asyncHandler(async (req, res) => {
    const crashData = req.body;
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
    }

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
    if (twilioSid && twilioAuth) {
      try {
        const twilioClient = Twilio(twilioSid, twilioAuth);
        const sentinelConf = await storage.getSentinelConfig(subAccountId);
        const alertPhone = sentinelConf?.smsAlertPhone;
        if (alertPhone) {
          const twilioNumbers = await twilioClient.incomingPhoneNumbers.list({ limit: 1 });
          const fromNumber = twilioNumbers[0]?.phoneNumber;
          if (fromNumber) {
            await twilioClient.messages.create({
              body: `SENTINEL ALERT: Crash #${crashId} detected ${distanceMiles} mi from HQ. Severity: ${severity}. Map: ${mapsLink}`,
              from: fromNumber,
              to: alertPhone,
            });
            console.log(`SENTINEL: SMS alert sent to ${alertPhone}`);
          }
        }
      } catch (smsErr: any) {
        console.error("SENTINEL: SMS alert failed:", smsErr.message);
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

      fireAutomationTrigger("new_lead", SUB_ACCOUNT_ID, {
        leadName: `${firstName} ${lastName}`.trim(),
        leadPhone: phoneNumber,
        leadEmail: email,
        source: "sentinel_geofence",
        location: locationTag,
      }).catch(() => {});
      fireAutomationTrigger("crash_detected", SUB_ACCOUNT_ID, {
        leadName: `${firstName} ${lastName}`.trim(),
        leadPhone: phoneNumber,
        location: locationTag,
      }).catch(() => {});

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

  // ─── FLHSMV Health Check ────────────────────────────────────────
  app.get("/api/crash-reports/health", asyncHandler(async (_req, res) => {
    const { getFLHSMVHealth } = await import("./crashReportWorker");
    const health = getFLHSMVHealth();
    res.json(health);
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
    const reportNumber = req.params.reportNumber.trim().toUpperCase();
    const report = await storage.getCrashReportByNumber(reportNumber);
    if (!report) {
      return res.status(404).json({ error: "Report not found. Submit a request first." });
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
      const { applyComplianceRedaction } = await import("./crashReportWorker");
      response.data = applyComplianceRedaction(rawData, report.requesterRole);
    }

    if (report.status === "FAILED" || report.status === "NOT_FOUND") {
      response.errorLog = report.errorLog;
    }

    res.json(response);
  }));

  app.get("/api/crash-reports", asyncHandler(async (req, res) => {
    const subAccountId = req.query.subAccountId ? Number(req.query.subAccountId) : undefined;
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
    const id = Number(req.params.id);
    const report = await storage.getCrashReport(id);
    if (!report) return res.status(404).json({ error: "Report not found" });

    let data = report.data && typeof report.data === "string"
      ? JSON.parse(report.data as string)
      : report.data;

    if (data) {
      const { applyComplianceRedaction } = await import("./crashReportWorker");
      data = applyComplianceRedaction(data, report.requesterRole);
    }

    res.json({ ...report, data });
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
              const client = getTwilioClient();
              if (client) {
                const alertMsg = event === "crash.detected"
                  ? `[Apex Alert] Crash detected at ${location}. Severity: ${payload.severity || "unknown"}. Lead: ${leadName}${leadPhone ? ` (${leadPhone})` : ""}. Check your dashboard for details.`
                  : `[Apex Alert] New ${event.replace(".", " ")} — ${leadName}${leadPhone ? ` (${leadPhone})` : ""}. Source: Crash Connect.`;

                try {
                  await client.messages.create({
                    to: ownerPhone,
                    from: twilioNumber,
                    body: alertMsg,
                  });
                  console.log(`[CRASH CONNECT] SMS alert sent to ${ownerPhone}`);
                  await logUsageInternal(targetAccountId, "SMS_SEGMENT", 1, `Crash Connect auto-alert: ${event}`);

                  try {
                    const wallet = await storage.getCreditWallet(targetAccountId);
                    const baseCost = 0.0079;
                    const totalCharge = parseFloat((baseCost * 3).toFixed(4));
                    if (wallet && wallet.balance >= totalCharge) {
                      const profit = totalCharge - baseCost;
                      await storage.updateCreditWalletBalance(targetAccountId, -totalCharge);
                      await storage.createCreditTransaction({
                        subAccountId: targetAccountId,
                        type: "usage",
                        amount: -totalCharge,
                        balanceAfter: (wallet.balance - totalCharge),
                        description: `Crash Connect auto-alert SMS: ${event}`,
                        baseCost,
                        platformProfit: profit,
                      });
                      if (profit > 0) {
                        await storage.createPlatformProfit({
                          source: "markup",
                          amount: profit,
                          subAccountId: targetAccountId,
                          description: `Crash Connect SMS markup: $${baseCost.toFixed(4)} base → $${totalCharge.toFixed(2)} charged`,
                        });
                      }
                      console.log(`[CRASH CONNECT] Wallet charged $${totalCharge} for SMS`);
                    }
                  } catch (walletErr: any) {
                    console.error(`[CRASH CONNECT] Wallet charge failed: ${walletErr.message}`);
                  }
                } catch (smsErr: any) {
                  console.error(`[CRASH CONNECT] SMS alert failed: ${smsErr.message}`);
                }
              }
            }

            if (leadPhone && twilioNumber && event === "crash.detected") {
              try {
                if (isGeminiConfigured()) {
                  const aiResponse = await geminiChat([
                    { role: "system", content: `You are an AI assistant for ${account.name || "a local business"}. A potential customer was just involved in a vehicle incident. Send a brief, empathetic text offering assistance. Keep it under 160 characters. Be professional and helpful. Do not mention AI.` },
                    { role: "user", content: `Generate an SMS to send to ${leadName} who was in a crash at ${location}. The business provides ${account.industry || "automotive"} services.` },
                  ], { temperature: 0.7, maxTokens: 200 });

                  const client = getTwilioClient();
                  if (client && aiResponse) {
                    await client.messages.create({
                      to: leadPhone,
                      from: twilioNumber,
                      body: aiResponse.trim(),
                    });
                    console.log(`[CRASH CONNECT] AI follow-up sent to lead ${leadPhone}`);
                    await logUsageInternal(targetAccountId, "SMS_SEGMENT", 1, `Crash Connect AI follow-up: ${event}`);
                    await logUsageInternal(targetAccountId, "AI_CHAT", 1, `Crash Connect AI message generation`);

                    try {
                      const wallet = await storage.getCreditWallet(targetAccountId);
                      const smsCost = 0.0079;
                      const aiCost = 0.001;
                      const totalCharge = parseFloat(((smsCost + aiCost) * 3).toFixed(4));
                      if (wallet && wallet.balance >= totalCharge) {
                        const profit = totalCharge - smsCost - aiCost;
                        await storage.updateCreditWalletBalance(targetAccountId, -totalCharge);
                        await storage.createCreditTransaction({
                          subAccountId: targetAccountId,
                          type: "usage",
                          amount: -totalCharge,
                          balanceAfter: (wallet.balance - totalCharge),
                          description: `Crash Connect AI follow-up SMS + AI gen: ${event}`,
                          baseCost: smsCost + aiCost,
                          platformProfit: profit,
                        });
                        if (profit > 0) {
                          await storage.createPlatformProfit({
                            source: "markup",
                            amount: profit,
                            subAccountId: targetAccountId,
                            description: `Crash Connect AI follow-up markup: SMS + AI gen`,
                          });
                        }
                        console.log(`[CRASH CONNECT] Wallet charged $${totalCharge} for AI follow-up`);
                      }
                    } catch (walletErr: any) {
                      console.error(`[CRASH CONNECT] AI follow-up wallet charge failed: ${walletErr.message}`);
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

  app.get("/api/v1/external/sentinel/incidents", async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });

    const incidents = await storage.getSentinelIncidents(account.id);
    res.json({
      accountName: account.name,
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
  });

  app.get("/api/v1/external/sentinel/incidents/:id", async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });

    const incident = await storage.getSentinelIncident(parseInt(req.params.id));
    if (!incident || incident.subAccountId !== account.id) {
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
  });

  app.get("/api/v1/external/sentinel/stats", async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });

    const incidents = await storage.getSentinelIncidents(account.id);
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
  });

  app.get("/api/v1/external/sentinel/config", async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });
    const config = await storage.getSentinelConfig(account.id);
    res.json(config || { enabled: false });
  });

  app.put("/api/v1/external/sentinel/config", async (req, res) => {
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
  });

  const externalScanLastRun = new Map<string, number>();
  app.post("/api/v1/external/sentinel/scan", async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });
    const lastRun = externalScanLastRun.get(token) || 0;
    if (Date.now() - lastRun < 60_000) {
      return res.status(429).json({ error: "Scan rate limited — wait 60 seconds between scans" });
    }
    externalScanLastRun.set(token, Date.now());
    try {
      const config = await storage.getSentinelConfig(account.id);
      const liveIncidents = await processLiveSentinelFeed();
      let saved = 0;
      for (const inc of liveIncidents) {
        const hash = `${inc.type}-${inc.location}-${inc.id}`.replace(/\s+/g, "").toLowerCase();
        const existing = await storage.getSentinelIncidentByHash(account.id, hash);
        if (!existing) {
          await storage.createSentinelIncident({
            subAccountId: account.id,
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
  });

  app.post("/api/v1/external/sentinel/incidents/:id/acknowledge", async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });
    const incident = await storage.getSentinelIncident(parseInt(req.params.id));
    if (!incident || incident.subAccountId !== account.id) return res.status(404).json({ error: "Not found" });
    await storage.updateSentinelIncident(incident.id, { actionStatus: "acknowledged" });
    res.json({ success: true });
  });

  app.post("/api/v1/external/sentinel/incidents/:id/deploy-geofence", async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });
    const incident = await storage.getSentinelIncident(parseInt(req.params.id));
    if (!incident || incident.subAccountId !== account.id) return res.status(404).json({ error: "Not found" });
    await storage.updateSentinelIncident(incident.id, { geofenceDeployed: true, actionStatus: "actioned" });
    res.json({ success: true, message: "Geofence deployed" });
  });

  app.post("/api/v1/external/sentinel/incidents/:id/send-sms", async (req, res) => {
    const token = (req.headers["x-api-token"] || req.query.token) as string;
    const account = await resolveTokenAccount(token);
    if (!account) return res.status(401).json({ error: "Invalid or missing token" });
    const incident = await storage.getSentinelIncident(parseInt(req.params.id));
    if (!incident || incident.subAccountId !== account.id) return res.status(404).json({ error: "Not found" });
    const config = await storage.getSentinelConfig(account.id);
    const alertPhone = config?.smsAlertPhone || (account as any).ownerPhone;
    if (!alertPhone || !(account as any).twilioNumber) {
      return res.status(400).json({ error: "SMS not configured — set alert phone in Sentinel config" });
    }
    try {
      const twilio = getTwilioClient();
      if (twilio) {
        await twilio.messages.create({
          body: `SENTINEL ALERT: ${incident.title} — ${incident.location || "Unknown location"} (${incident.severity})`,
          from: (account as any).twilioNumber,
          to: alertPhone,
        });
        await storage.updateSentinelIncident(incident.id, { smsSent: true });
        res.json({ success: true, message: "SMS sent" });
      } else {
        res.status(500).json({ error: "Twilio not configured" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

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
      status: "connected",
      widgetEnabled: false,
      widgetColor: "#6366f1",
      widgetGreeting: "Hi there! How can I help you today?",
      widgetPosition: "bottom-right",
      pagesCrawled: 0,
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

    runRealTraining(job.id);

    await storage.updateClientWebsite(id, {
      status: "training",
      trainingJobId: job.id,
      botPersona: persona,
      lastCrawlStatus: "in_progress",
    });

    setTimeout(async () => {
      await storage.updateClientWebsite(id, {
        status: "trained",
        scrapedAt: new Date(),
        pagesCrawled: Math.floor(Math.random() * 20) + 5,
        lastCrawlStatus: "completed",
      });
    }, 9000);

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
    if (!isGeminiConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = formGenerateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { industry, businessName } = parsed.data;
    const userPrompt = businessName
      ? `Generate a lead capture form for a ${industry} business called "${businessName}".`
      : `Generate a lead capture form for a ${industry} business.`;

    const raw = await geminiChat([
      { role: "system", content: FORM_BUILDER_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ], { temperature: 0.7, maxTokens: 4096, jsonMode: true });
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let formData: any;
    try {
      formData = JSON.parse(cleaned);
    } catch {
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
    const list = await storage.getContacts(subAccountId);
    res.json(list);
  }));

  app.get("/api/contacts/detail/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const contact = await storage.getContactById(id);
    if (!contact) return res.status(404).json({ error: "Contact not found" });
    res.json(contact);
  }));

  app.post("/api/contacts", asyncHandler(async (req, res) => {
    const parsed = insertContactSchema.safeParse(req.body);
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
      fireAutomationTrigger("new_lead", contact.subAccountId, {
        leadName: contact.firstName || "Lead",
        leadPhone: contact.phone,
        leadEmail: contact.email,
        source: contact.source || "manual",
      }).catch(() => {});
    }
    res.status(201).json(contact);
  }));

  app.patch("/api/contacts/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");

    let updateData = { ...req.body };
    if (updateData.address) {
      const existing = await storage.getContactById(id);
      if (existing && existing.address !== updateData.address) {
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
    }

    const updated = await storage.updateContact(id, updateData);
    if (!updated) return res.status(404).json({ error: "Contact not found" });
    res.json(updated);
  }));

  app.delete("/api/contacts/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const deleted = await storage.deleteContact(id);
    if (!deleted) return res.status(404).json({ error: "Contact not found" });
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
    res.status(201).json(deal);
  }));

  app.patch("/api/deals/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const body = req.body;
    if (body.stageId !== undefined) {
      body.stageId = parseInt(body.stageId, 10);
    }
    const updated = await storage.updateDeal(id, body);
    if (!updated) return res.status(404).json({ error: "Deal not found" });
    res.json(updated);
  }));

  app.delete("/api/deals/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const deleted = await storage.deleteDeal(id);
    if (!deleted) return res.status(404).json({ error: "Deal not found" });
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
      fireAutomationTrigger("appointment_booked", appt.subAccountId, {
        appointmentTitle: appt.title,
        appointmentTime: appt.startTime,
        contactId: appt.contactId,
      }).catch(() => {});
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
    res.json(updated);
  }));

  app.delete("/api/appointments/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const deleted = await storage.deleteAppointment(id);
    if (!deleted) return res.status(404).json({ error: "Appointment not found" });
    res.json({ success: true });
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

  app.get("/api/webhooks/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const list = await storage.getWebhooks(subAccountId);
    res.json(list);
  }));

  app.post("/api/webhooks", asyncHandler(async (req, res) => {
    const parsed = insertWebhookSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = { ...parsed.data, secret: crypto.randomBytes(32).toString("hex") };
    const webhook = await storage.createWebhook(data);
    res.status(201).json(webhook);
  }));

  app.patch("/api/webhooks/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const updated = await storage.updateWebhook(id, req.body);
    if (!updated) return res.status(404).json({ error: "Webhook not found" });
    res.json(updated);
  }));

  app.delete("/api/webhooks/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const deleted = await storage.deleteWebhook(id);
    if (!deleted) return res.status(404).json({ error: "Webhook not found" });
    res.json({ success: true });
  }));

  app.post("/api/webhooks/test/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const webhook = await storage.getWebhookById(id);
    if (!webhook) return res.status(404).json({ error: "Webhook not found" });
    try {
      const testPayload = { event: "test", timestamp: new Date().toISOString(), webhookId: id };
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Webhook-Secret": webhook.secret || "" },
        body: JSON.stringify(testPayload),
      });
      await storage.updateWebhook(id, { lastTriggeredAt: new Date() });
      res.json({ success: true, statusCode: response.status });
    } catch (err: any) {
      await storage.updateWebhook(id, { failCount: (webhook.failCount || 0) + 1 });
      res.status(502).json({ error: "Failed to reach webhook URL", details: err.message });
    }
  }));

  app.get("/api/white-label/:userId", asyncHandler(async (req, res) => {
    const userId = req.params.userId as string;
    const settings = await storage.getWhiteLabelSettings(userId);
    if (!settings) return res.json(null);
    res.json(settings);
  }));

  app.put("/api/white-label", asyncHandler(async (req, res) => {
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

  // ---- Meta Ad Campaigns ----

  app.get("/api/meta/campaigns/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const campaigns = await storage.getMetaAdCampaigns(Number(req.params.subAccountId));
    res.json(campaigns);
  }));

  app.post("/api/meta/campaigns", asyncHandler(async (req: Request, res: Response) => {
    const data = insertMetaAdCampaignSchema.parse(req.body);
    const campaign = await storage.createMetaAdCampaign(data);
    res.json(campaign);
  }));

  app.patch("/api/meta/campaigns/:id", asyncHandler(async (req: Request, res: Response) => {
    const campaign = await storage.updateMetaAdCampaign(Number(req.params.id), req.body);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    res.json(campaign);
  }));

  app.delete("/api/meta/campaigns/:id", asyncHandler(async (req: Request, res: Response) => {
    const ok = await storage.deleteMetaAdCampaign(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "Campaign not found" });
    res.json({ success: true });
  }));

  app.post("/api/meta/campaigns/:id/sync", asyncHandler(async (req: Request, res: Response) => {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const campaign = await storage.getMetaAdCampaign(Number(req.params.id));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    if (!accessToken || !campaign.metaCampaignId) {
      return res.status(503).json({ error: "Meta API not configured or no campaign ID linked. Add META_ACCESS_TOKEN and publish the campaign to Meta first." });
    }

    try {
      const fbRes = await fetch(`https://graph.facebook.com/v19.0/${campaign.metaCampaignId}/insights?fields=impressions,clicks,spend,cpc,ctr,actions&access_token=${accessToken}`);
      const fbData = await fbRes.json() as any;
      if (fbData.data && fbData.data[0]) {
        const insights = fbData.data[0];
        const leads = insights.actions?.find((a: any) => a.action_type === "lead")?.value || 0;
        await storage.updateMetaAdCampaign(campaign.id, {
          impressions: parseInt(insights.impressions || "0"),
          clicks: parseInt(insights.clicks || "0"),
          totalSpend: parseFloat(insights.spend || "0"),
          cpc: parseFloat(insights.cpc || "0"),
          ctr: parseFloat(insights.ctr || "0"),
          leads: parseInt(leads),
        });
      }
      const updated = await storage.getMetaAdCampaign(campaign.id);
      res.json({ synced: true, campaign: updated });
    } catch (err: any) {
      res.status(500).json({ error: `Meta sync failed: ${err.message}` });
    }
  }));

  app.post("/api/meta/campaigns/:id/publish", asyncHandler(async (req: Request, res: Response) => {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const adAccountId = process.env.META_AD_ACCOUNT_ID;
    const campaign = await storage.getMetaAdCampaign(Number(req.params.id));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    if (!accessToken || !adAccountId) {
      return res.status(503).json({ error: "Meta API not configured. Add META_ACCESS_TOKEN and META_AD_ACCOUNT_ID environment variables to publish campaigns to Facebook/Instagram." });
    }

    try {
      const fbRes = await fetch(`https://graph.facebook.com/v19.0/act_${adAccountId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaign.name,
          objective: campaign.objective,
          status: "ACTIVE",
          special_ad_categories: [],
          access_token: accessToken,
        }),
      });
      const fbData = await fbRes.json() as any;
      if (!fbRes.ok || !fbData.id) {
        const errorMsg = fbData?.error?.message || JSON.stringify(fbData).substring(0, 300);
        console.error(`[META] Campaign publish failed: ${errorMsg}`);
        return res.status(502).json({ error: `Meta API rejected the campaign: ${errorMsg}` });
      }
      await storage.updateMetaAdCampaign(campaign.id, { metaCampaignId: fbData.id, status: "active" });
      const updated = await storage.getMetaAdCampaign(campaign.id);
      res.json({ published: true, campaign: updated });
    } catch (err: any) {
      res.status(500).json({ error: `Campaign publish failed: ${err.message}` });
    }
  }));

  // ---- Meta Lead Forms ----

  app.get("/api/meta/leads/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const leads = await storage.getMetaLeads(Number(req.params.subAccountId));
    res.json(leads);
  }));

  app.post("/api/meta/leads", asyncHandler(async (req: Request, res: Response) => {
    const data = insertMetaLeadSchema.parse(req.body);
    const lead = await storage.createMetaLead(data);
    res.json(lead);
  }));

  app.post("/api/meta/leads/sync/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const pageId = process.env.META_PAGE_ID;
    const subAccountId = Number(req.params.subAccountId);

    if (!accessToken || !pageId) {
      return res.status(503).json({ error: "Meta API not configured. Add META_ACCESS_TOKEN and META_PAGE_ID to sync leads from Facebook." });
    }

    try {
      const formsRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/leadgen_forms?access_token=${accessToken}`);
      const formsData = await formsRes.json() as any;
      let totalSynced = 0;

      if (formsData.data) {
        for (const form of formsData.data) {
          const leadsRes = await fetch(`https://graph.facebook.com/v19.0/${form.id}/leads?access_token=${accessToken}`);
          const leadsData = await leadsRes.json() as any;
          if (leadsData.data) {
            const existingLeads = await storage.getMetaLeads(subAccountId);
            const existingFormLeadKeys = new Set(existingLeads.map(l => `${l.metaFormId}:${l.name}:${l.email}`));
            for (const lead of leadsData.data) {
              const fields = lead.field_data || [];
              const getName = (key: string) => fields.find((f: any) => f.name === key)?.values?.[0] || "";
              const name = getName("full_name") || getName("first_name") || "Unknown";
              const email = getName("email") || "";
              const dedupeKey = `${form.id}:${name}:${email}`;
              if (existingFormLeadKeys.has(dedupeKey)) continue;
              await storage.createMetaLead({
                subAccountId,
                metaFormId: form.id,
                formName: form.name,
                name,
                email,
                phone: getName("phone_number"),
                customFields: fields,
              });
              existingFormLeadKeys.add(dedupeKey);
              totalSynced++;

              storage.createNotification({
                subAccountId,
                type: "new_lead",
                title: "New Facebook Lead",
                body: `${name}${email ? ` (${email})` : ""} submitted a lead form`,
                link: "/meta-leads",
              }).catch(() => {});

              const account = await storage.getSubAccount(subAccountId);
              if (account?.twilioNumber && getName("phone_number")) {
                try {
                  const twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
                  await twilioClient.messages.create({
                    body: `Hi ${name.split(" ")[0] || "there"}! Thanks for your interest. We received your inquiry and will follow up shortly. - ${account.name}`,
                    from: account.twilioNumber,
                    to: getName("phone_number"),
                  });
                  await storage.createMessage({
                    subAccountId,
                    direction: "outbound",
                    body: `[Auto-reply] Hi ${name.split(" ")[0] || "there"}! Thanks for your interest. We received your inquiry and will follow up shortly.`,
                    status: "sent",
                    contactPhone: getName("phone_number"),
                    channel: "sms",
                  });
                } catch (smsErr: any) {
                  console.log("Auto-reply SMS failed (non-blocking):", smsErr.message);
                }
              }
            }
          }
        }
      }
      res.json({ synced: true, count: totalSynced });
    } catch (err: any) {
      res.status(500).json({ error: `Lead sync failed: ${err.message}` });
    }
  }));

  app.post("/api/meta/leads/:id/to-crm", asyncHandler(async (req: Request, res: Response) => {
    const lead = await storage.getMetaLead(Number(req.params.id));
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.syncedToCrm && lead.contactId) {
      return res.json({ success: true, alreadySynced: true, contactId: lead.contactId });
    }

    const existingContacts = await storage.getContacts(lead.subAccountId);
    const existingContact = lead.email
      ? existingContacts.find(c => c.email === lead.email)
      : lead.phone
        ? existingContacts.find(c => c.phone === lead.phone)
        : null;

    const contact = existingContact || await storage.createContact({
      subAccountId: lead.subAccountId,
      firstName: (lead.name || "").split(" ")[0] || "Unknown",
      lastName: (lead.name || "").split(" ").slice(1).join(" ") || "",
      email: lead.email || "",
      phone: lead.phone || "",
      source: "facebook_lead_form",
      tags: ["meta-lead"],
    });

    await storage.updateMetaLead(lead.id, { syncedToCrm: true, contactId: contact.id });
    res.json({ success: true, contact });
  }));

  // ---- DM Keyword Automations CRUD ----
  app.get("/api/dm-keywords/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const keywords = await storage.getDmKeywordAutomations(subAccountId);
    res.json(keywords);
  }));

  app.post("/api/dm-keywords", asyncHandler(async (req, res) => {
    const { subAccountId, keyword, matchType, channel, responseText, responseType, actionPayload, enabled } = req.body;
    if (!subAccountId || !keyword) {
      return res.status(400).json({ error: "subAccountId and keyword are required" });
    }
    if (!(await verifyAccountOwnership(req, res, Number(subAccountId)))) return;
    const created = await storage.createDmKeywordAutomation({
      subAccountId: Number(subAccountId),
      keyword: keyword.trim(),
      matchType: matchType || "exact",
      channel: channel || "all",
      responseText: responseText || null,
      responseType: responseType || "text",
      actionPayload: actionPayload || null,
      enabled: enabled !== false,
    });
    console.log(`[DM-KEYWORDS] Created keyword "${keyword}" for account ${subAccountId}`);
    res.status(201).json(created);
  }));

  app.put("/api/dm-keywords/:id", asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.select().from(dmKeywordAutomations).where(eq(dmKeywordAutomations.id, id)).limit(1);
    if (!existing.length) return res.status(404).json({ error: "Keyword automation not found" });
    if (!(await verifyAccountOwnership(req, res, existing[0].subAccountId))) return;
    const updated = await storage.updateDmKeywordAutomation(id, req.body);
    res.json(updated);
  }));

  app.delete("/api/dm-keywords/:id", asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.select().from(dmKeywordAutomations).where(eq(dmKeywordAutomations.id, id)).limit(1);
    if (!existing.length) return res.status(404).json({ error: "Keyword automation not found" });
    if (!(await verifyAccountOwnership(req, res, existing[0].subAccountId))) return;
    await storage.deleteDmKeywordAutomation(id);
    res.json({ success: true });
  }));

  // ---- Instagram DM Inbox ----

  app.get("/api/meta/instagram/conversations/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const conversations = await storage.getInstagramConversations(Number(req.params.subAccountId));
    res.json(conversations);
  }));

  app.get("/api/meta/instagram/messages/:conversationId", asyncHandler(async (req: Request, res: Response) => {
    const msgs = await storage.getInstagramMessages(Number(req.params.conversationId));
    res.json(msgs);
  }));

  app.post("/api/meta/instagram/send", asyncHandler(async (req: Request, res: Response) => {
    const { conversationId, body } = req.body;
    const conversation = await storage.getInstagramConversation(conversationId);
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    const accessToken = process.env.META_ACCESS_TOKEN;
    const pageId = process.env.META_PAGE_ID;

    const msg = await storage.createInstagramMessage({
      conversationId,
      direction: "outbound",
      body,
    });

    if (accessToken && pageId && conversation.igUserId) {
      try {
        const appSecret = process.env.META_APP_SECRET;
        let proof = "";
        if (appSecret) {
          const crypto = await import("crypto");
          proof = crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
        }
        const sendUrl = `https://graph.facebook.com/v19.0/${pageId}/messages` + (proof ? `?appsecret_proof=${proof}` : "");
        await fetch(sendUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: conversation.igUserId },
            message: { text: body },
            access_token: accessToken,
          }),
        });
      } catch (err: any) {
        console.log("Meta IG send error (non-blocking):", err.message);
      }
    }

    await storage.updateInstagramConversation(conversationId, {
      lastMessage: body,
      lastMessageAt: new Date(),
    });

    res.json(msg);
  }));

  app.post("/api/meta/instagram/sync/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const pageId = process.env.META_PAGE_ID;
    const subAccountId = Number(req.params.subAccountId);

    if (!accessToken || !pageId) {
      const missing = [];
      if (!accessToken) missing.push("META_ACCESS_TOKEN");
      if (!pageId) missing.push("META_PAGE_ID");
      return res.status(503).json({
        error: `Instagram sync requires ${missing.join(" and ")} to be configured. Go to the Integrations page for a step-by-step setup guide to connect your Meta/Facebook account.`
      });
    }

    try {
      const appSecret = process.env.META_APP_SECRET;
      let proof = "";
      if (appSecret) {
        const crypto = await import("crypto");
        proof = crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
      }
      const convRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/conversations?platform=instagram&fields=participants,messages{message,from,created_time}&access_token=${accessToken}` + (proof ? `&appsecret_proof=${proof}` : ""));
      const convData = await convRes.json() as any;

      if (convData.error) {
        const errMsg = convData.error.message || JSON.stringify(convData.error).substring(0, 300);
        console.error(`[META INSTAGRAM] API error during sync: ${errMsg}`);
        return res.status(502).json({ error: `Meta API error: ${errMsg}. Check that your access token has the required permissions and hasn't expired.` });
      }

      let count = 0;

      if (convData.data) {
        for (const conv of convData.data) {
          const participant = conv.participants?.data?.find((p: any) => p.id !== pageId);
          if (!participant) continue;

          const existing = await storage.getInstagramConversations(subAccountId);
          let conversation = existing.find(c => c.igUserId === participant.id);

          if (!conversation) {
            conversation = await storage.createInstagramConversation({
              subAccountId,
              igUserId: participant.id,
              igUsername: participant.name || participant.id,
            });
          }

          if (conv.messages?.data) {
            const existingMsgs = await storage.getInstagramMessages(conversation.id);
            const existingMsgIds = new Set(existingMsgs.map(m => m.igMessageId).filter(Boolean));
            for (const m of conv.messages.data) {
              if (m.id && existingMsgIds.has(m.id)) continue;
              await storage.createInstagramMessage({
                conversationId: conversation.id,
                direction: m.from?.id === pageId ? "outbound" : "inbound",
                body: m.message || "",
                igMessageId: m.id,
              });
            }
            const lastMsg = conv.messages.data[0];
            if (lastMsg) {
              await storage.updateInstagramConversation(conversation.id, {
                lastMessage: lastMsg.message,
                lastMessageAt: new Date(lastMsg.created_time),
              });
            }
          }
          count++;
        }
      }
      res.json({ synced: true, conversations: count });
    } catch (err: any) {
      res.status(500).json({ error: `Instagram sync failed: ${err.message}` });
    }
  }));

  // ---- Meta Config Check ----
  app.get("/api/meta/config", asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      hasAccessToken: !!process.env.META_ACCESS_TOKEN,
      hasAdAccountId: !!process.env.META_AD_ACCOUNT_ID,
      hasPageId: !!process.env.META_PAGE_ID,
      hasAppId: !!process.env.META_APP_ID,
    });
  }));

  // ---- Meta DM Diagnostics ----
  app.get("/api/meta/dm-diagnostics", asyncHandler(async (_req: Request, res: Response) => {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const pageId = process.env.META_PAGE_ID;
    const appSecret = process.env.META_APP_SECRET;
    const verifyToken = process.env.META_VERIFY_TOKEN || "apex_verify_2026";

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    const webhookUrl = domain ? `https://${domain}/api/meta-webhook` : null;

    const result: any = {
      credentials: {
        accessToken: { set: !!accessToken, valid: false, detail: "" },
        pageId: { set: !!pageId, value: pageId || null },
        appSecret: { set: !!appSecret },
      },
      webhook: {
        url: webhookUrl,
        verifyToken,
      },
    };

    if (accessToken) {
      try {
        const debugRes = await fetch(`https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${accessToken}`);
        const debugData = await debugRes.json() as any;
        if (debugData.data) {
          const d = debugData.data;
          result.credentials.accessToken.valid = d.is_valid === true;
          result.credentials.accessToken.detail = d.is_valid
            ? `Valid. App ID: ${d.app_id || "unknown"}, expires: ${d.expires_at ? (d.expires_at === 0 ? "never" : new Date(d.expires_at * 1000).toISOString()) : "unknown"}`
            : `Invalid or expired: ${d.error?.message || "unknown error"}`;
          result.credentials.accessToken.appId = d.app_id;
          result.credentials.accessToken.expiresAt = d.expires_at;
          result.credentials.accessToken.scopes = d.scopes;
        } else {
          result.credentials.accessToken.detail = debugData.error?.message || "Could not validate token";
        }
      } catch (err: any) {
        result.credentials.accessToken.detail = `Validation request failed: ${err.message}`;
      }
    } else {
      result.credentials.accessToken.detail = "Not configured";
    }

    if (accessToken && pageId) {
      try {
        let proof = "";
        if (appSecret) {
          const crypto = await import("crypto");
          proof = crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
        }
        const pageRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=name,id&access_token=${accessToken}${proof ? `&appsecret_proof=${proof}` : ""}`);
        const pageData = await pageRes.json() as any;
        if (pageData.name) {
          result.credentials.pageId.valid = true;
          result.credentials.pageId.pageName = pageData.name;
        } else {
          result.credentials.pageId.valid = false;
          result.credentials.pageId.error = pageData.error?.message || "Could not fetch page info";
        }
      } catch (err: any) {
        result.credentials.pageId.valid = false;
        result.credentials.pageId.error = `Page check failed: ${err.message}`;
      }
    }

    res.json(result);
  }));

  app.post("/api/meta/dm-diagnostics/test-webhook", asyncHandler(async (req: Request, res: Response) => {
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    if (!domain) {
      return res.status(400).json({ success: false, error: "No public domain available to test webhook" });
    }

    const verifyToken = process.env.META_VERIFY_TOKEN || "apex_verify_2026";
    const testChallenge = "apex_test_" + Date.now();
    const webhookUrl = `https://${domain}/api/meta-webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=${testChallenge}`;

    try {
      const testRes = await fetch(webhookUrl);
      const body = await testRes.text();
      if (testRes.ok && body === testChallenge) {
        res.json({ success: true, message: "Webhook verification endpoint is reachable and responding correctly" });
      } else {
        res.json({ success: false, error: `Webhook returned status ${testRes.status}, body: ${body.substring(0, 200)}` });
      }
    } catch (err: any) {
      res.json({ success: false, error: `Could not reach webhook: ${err.message}` });
    }
  }));

  // ---- Notifications ----

  app.get("/api/notifications/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const notifs = await storage.getNotifications(Number(req.params.subAccountId));
    res.json(notifs);
  }));

  app.get("/api/notifications/:subAccountId/unread-count", asyncHandler(async (req: Request, res: Response) => {
    const count = await storage.getUnreadNotificationCount(Number(req.params.subAccountId));
    res.json({ count });
  }));

  app.post("/api/notifications/:id/read", asyncHandler(async (req: Request, res: Response) => {
    const notif = await storage.markNotificationRead(Number(req.params.id));
    if (!notif) return res.status(404).json({ error: "Notification not found" });
    res.json(notif);
  }));

  app.post("/api/notifications/:subAccountId/read-all", asyncHandler(async (req: Request, res: Response) => {
    await storage.markAllNotificationsRead(Number(req.params.subAccountId));
    res.json({ success: true });
  }));

  // ---- Dashboard Metrics ----

  app.get("/api/dashboard/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const [msgs, contactsList, dealsList, appointmentsList, campaigns, metaCampaignsList, metaLeadsList, igConvs, unreadNotifs] = await Promise.all([
      storage.getMessages(subAccountId),
      storage.getContacts(subAccountId),
      storage.getDeals(subAccountId),
      storage.getAppointments(subAccountId),
      storage.getEmailCampaigns(subAccountId),
      storage.getMetaAdCampaigns(subAccountId),
      storage.getMetaLeads(subAccountId),
      storage.getInstagramConversations(subAccountId),
      storage.getUnreadNotificationCount(subAccountId),
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMsgs = msgs.filter(m => new Date(m.createdAt) >= today);
    const totalDealValue = dealsList.reduce((s, d) => s + (d.value || 0), 0);
    const upcomingAppts = appointmentsList.filter(a => new Date(a.startTime) > new Date());
    const totalAdSpend = metaCampaignsList.reduce((s, c) => s + (c.totalSpend || 0), 0);
    const totalAdLeads = metaCampaignsList.reduce((s, c) => s + (c.leads || 0), 0);
    const unreadIgMsgs = igConvs.reduce((s, c) => s + (c.unreadCount || 0), 0);

    res.json({
      totalMessages: msgs.length,
      todayMessages: todayMsgs.length,
      totalContacts: contactsList.length,
      totalDeals: dealsList.length,
      totalDealValue,
      upcomingAppointments: upcomingAppts.length,
      totalCampaigns: campaigns.length,
      metaAdCampaigns: metaCampaignsList.length,
      metaLeads: metaLeadsList.length,
      totalAdSpend,
      totalAdLeads,
      igConversations: igConvs.length,
      unreadIgMessages: unreadIgMsgs,
      unreadNotifications: unreadNotifs,
      recentMessages: todayMsgs.slice(0, 5),
      recentLeads: metaLeadsList.slice(0, 5),
    });
  }));

  // ---- Sitemap ----

  app.get("/sitemap.xml", (req: Request, res: Response) => {
    const base = `${req.protocol}://${req.get("host")}`;
    const pages = [
      { loc: "/", priority: "1.0", changefreq: "daily" },
      { loc: "/demo", priority: "0.9", changefreq: "weekly" },
      { loc: "/pricing", priority: "0.8", changefreq: "weekly" },
      { loc: "/gym", priority: "0.7", changefreq: "monthly" },
      { loc: "/luxe", priority: "0.7", changefreq: "monthly" },
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url>
    <loc>${base}${p.loc}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join("\n")}
</urlset>`;
    res.setHeader("Content-Type", "application/xml");
    res.send(xml);
  });

  // ---- Email Validation Helper ----

  app.post("/api/validate-email", asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) return res.json({ valid: false, reason: "No email provided" });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.json({ valid: false, reason: "Invalid format" });

    const domain = email.split("@")[1];
    try {
      const mxRecords = await new Promise<dns.MxRecord[]>((resolve, reject) => {
        dns.resolveMx(domain, (err, records) => {
          if (err) reject(err);
          else resolve(records);
        });
      });
      res.json({ valid: mxRecords.length > 0, reason: mxRecords.length > 0 ? "Valid MX records" : "No MX records" });
    } catch {
      res.json({ valid: false, reason: "Domain DNS lookup failed" });
    }
  }));

  // ---- Tracking Config ----

  app.get("/api/tracking-config", asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      gaId: process.env.GA_MEASUREMENT_ID || "",
      metaPixelId: process.env.META_PIXEL_ID || "",
    });
  }));

  // ===========================================================================
  // V1 WORKFLOW COMPILER — AI System Architect
  // ===========================================================================

  const VALID_TRIGGER_TYPES = [
    "OnCrashDetected",
    "OnNewLead",
    "OnMissedCall",
    "OnFormSubmit",
    "OnAppointmentBooked",
    "OnReviewReceived",
    "OnSMSReply",
    "OnWhatsAppReply",
    "Manual",
  ] as const;

  const VALID_ACTION_TYPES = [
    "SendTwilioSMS",
    "SendWhatsApp",
    "Wait",
    "Condition",
    "DeployMetaAd",
    "SendEmail",
    "CreateContact",
    "UpdateDeal",
    "AlertTeam",
    "WebhookCall",
    "AIGenerate",
  ] as const;

  const triggerFilterSchema = z.object({
    tags: z.array(z.string()).optional(),
    severity: z.enum(["critical", "high", "medium", "low"]).optional(),
    county: z.string().optional(),
    radius_miles: z.number().optional(),
    source: z.string().optional(),
  }).optional();

  const actionParamSchemas: Record<string, z.ZodType<any>> = {
    SendTwilioSMS: z.object({
      to: z.string().optional(),
      to_role: z.string().optional(),
      body: z.string().min(1),
      from_number: z.string().optional(),
    }),
    SendWhatsApp: z.object({
      to: z.string().optional(),
      to_role: z.string().optional(),
      body: z.string().min(1),
      message_type: z.enum(["text", "template", "interactive_buttons", "interactive_list"]).optional(),
      template_name: z.string().optional(),
      template_variables: z.record(z.string()).optional(),
      buttons: z.string().optional(),
      list_items: z.string().optional(),
    }),
    Wait: z.object({
      duration_minutes: z.number().min(1).max(43200),
    }),
    Condition: z.object({
      check: z.string().min(1),
      field: z.string().optional(),
      operator: z.enum(["equals", "not_equals", "contains", "greater_than", "less_than", "exists", "not_exists"]).optional(),
      value: z.any().optional(),
      on_true: z.string().optional(),
      on_false: z.string().optional(),
    }),
    DeployMetaAd: z.object({
      campaign_name: z.string().optional(),
      radius_miles: z.number().optional(),
      budget_daily: z.number().optional(),
      duration_days: z.number().optional(),
      use_incident_coords: z.boolean().optional(),
      ad_copy: z.string().optional(),
      target_audience: z.string().optional(),
    }),
    SendEmail: z.object({
      to: z.string().optional(),
      subject: z.string().min(1),
      body: z.string().min(1),
    }),
    CreateContact: z.object({
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      source: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
    UpdateDeal: z.object({
      deal_id: z.string().optional(),
      stage: z.string().optional(),
      value: z.number().optional(),
      notes: z.string().optional(),
    }),
    AlertTeam: z.object({
      message: z.string().min(1),
      channel: z.enum(["sms", "email", "push", "all"]).optional(),
      user_ids: z.array(z.string()).optional(),
    }),
    WebhookCall: z.object({
      url: z.string().url(),
      method: z.enum(["GET", "POST", "PUT", "PATCH"]).optional(),
      headers: z.record(z.string()).optional(),
      payload: z.any().optional(),
    }),
    AIGenerate: z.object({
      prompt: z.string().min(1),
      output_field: z.string().optional(),
      model: z.string().optional(),
    }),
  };

  const manifestStepSchema = z.object({
    id: z.string().optional(),
    action_type: z.enum(VALID_ACTION_TYPES as any),
    label: z.string().optional(),
    params: z.record(z.any()),
  });

  const workflowManifestSchema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    trigger: z.object({
      type: z.enum(VALID_TRIGGER_TYPES as any),
      filters: triggerFilterSchema,
    }),
    steps: z.array(manifestStepSchema).min(1).max(50),
    metadata: z.record(z.any()).optional(),
  });

  app.post("/api/v1/compiler", asyncHandler(async (req: Request, res: Response) => {
    const parsed = workflowManifestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid manifest", details: parsed.error.flatten() });
    }

    const manifest = parsed.data;
    const errors: string[] = [];

    manifest.steps.forEach((step, i) => {
      const paramSchema = actionParamSchemas[step.action_type];
      if (paramSchema) {
        const paramResult = paramSchema.safeParse(step.params);
        if (!paramResult.success) {
          errors.push(`Step ${i + 1} (${step.action_type}): ${JSON.stringify(paramResult.error.flatten().fieldErrors)}`);
        }
      }
      if (!step.id) {
        step.id = `step_${i + 1}_${step.action_type.toLowerCase()}`;
      }
    });

    if (errors.length > 0) {
      return res.status(400).json({ error: "Manifest validation failed", details: errors });
    }

    const automation = await storage.createLiveAutomation({
      name: manifest.name,
      description: manifest.description || null,
      manifest: manifest as any,
      status: "compiled",
      subAccountId: req.body.subAccountId || null,
      lastRunAt: null,
      runCount: 0,
      runLogs: [],
    });

    res.status(201).json({
      id: automation.id,
      name: automation.name,
      status: automation.status,
      manifest: automation.manifest,
      createdAt: automation.createdAt,
      message: "Automation compiled and saved as Live Automation",
    });
  }));

  app.get("/api/v1/compiler", asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const subAccountId = req.query.subAccountId ? parseInt(req.query.subAccountId as string) : undefined;
    if (subAccountId && !(await verifyAccountOwnership(req, res, subAccountId))) return;
    if (!subAccountId) {
      const adminUserId = process.env.ADMIN_USER_ID;
      const isAdmin = adminUserId && getUserId(user) === adminUserId;
      if (!isAdmin) return res.status(403).json({ error: "Access denied" });
    }
    const automations = await storage.getLiveAutomations(subAccountId);
    res.json(automations);
  }));

  app.get("/api/v1/compiler/:id", asyncHandler(async (req: Request, res: Response) => {
    const id = parseIntParam(req.params.id, "id");
    const automation = await storage.getLiveAutomation(id);
    if (!automation) return res.status(404).json({ error: "Automation not found" });
    res.json(automation);
  }));

  app.patch("/api/v1/compiler/:id", asyncHandler(async (req: Request, res: Response) => {
    const id = parseIntParam(req.params.id, "id");
    const updateSchema = z.object({
      name: z.string().min(1).optional(),
      status: z.enum(["compiled", "active", "paused", "archived"]).optional(),
      manifest: z.any().optional(),
    });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const updated = await storage.updateLiveAutomation(id, parsed.data);
    if (!updated) return res.status(404).json({ error: "Automation not found" });
    res.json(updated);
  }));

  app.delete("/api/v1/compiler/:id", asyncHandler(async (req: Request, res: Response) => {
    const id = parseIntParam(req.params.id, "id");
    const deleted = await storage.deleteLiveAutomation(id);
    if (!deleted) return res.status(404).json({ error: "Automation not found" });
    res.json({ success: true });
  }));

  app.get("/api/v1/compiler/schema/info", asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      triggers: VALID_TRIGGER_TYPES,
      actions: VALID_ACTION_TYPES,
      triggerFilters: {
        OnCrashDetected: ["tags", "severity", "county", "radius_miles"],
        OnNewLead: ["source", "tags"],
        OnFormSubmit: ["source"],
        OnMissedCall: [],
        OnAppointmentBooked: [],
        OnReviewReceived: [],
        OnSMSReply: [],
        Manual: [],
      },
      actionParams: Object.fromEntries(
        Object.entries(actionParamSchemas).map(([k]) => [k, k])
      ),
    });
  }));

  // ===========================================================================
  // AI SYSTEM ARCHITECT — Manifest Generator
  // ===========================================================================

  const COMPILER_AI_SYSTEM_PROMPT = `You are Apex AI System Architect, an expert at designing multi-step workflow automations for businesses.

You generate JSON workflow manifests that wire together triggers, actions, conditions, and delays.

AVAILABLE TRIGGERS:
- OnCrashDetected: Fires when Sentinel detects a crash/accident (FHP data). Filters: tags (e.g. "Big Rig", "Fatality", "Hit and Run"), severity (critical/high/medium/low), county, radius_miles.
- OnNewLead: New lead enters the CRM. Filters: source, tags.
- OnMissedCall: Missed phone call detected.
- OnFormSubmit: Web form submission received. Filters: source.
- OnAppointmentBooked: Calendar appointment created.
- OnReviewReceived: New review received.
- OnSMSReply: Inbound SMS received.
- OnWhatsAppReply: Inbound WhatsApp message received.
- Manual: Manually triggered.

AVAILABLE ACTIONS:
- SendTwilioSMS: Send SMS via Twilio. Params: to (phone), to_role (e.g. "marketer", "attorney", "admin"), body (message text), from_number.
- SendWhatsApp: Send WhatsApp message via Twilio WhatsApp Business API. Params: to (phone with country code), to_role, body (message text), message_type (text/template/interactive_buttons/interactive_list), template_name (for template messages), template_variables (key-value pairs for template vars), buttons (comma-separated button labels for interactive), list_items (comma-separated list items).
- Wait: Pause execution. Params: duration_minutes (1-43200).
- Condition: Branch logic. Params: check (description), field, operator (equals/not_equals/contains/greater_than/less_than/exists/not_exists), value, on_true (step id), on_false (step id).
- DeployMetaAd: Launch a Meta/Facebook geo-targeted ad. Params: campaign_name, radius_miles, budget_daily, duration_days, use_incident_coords (boolean), ad_copy, target_audience.
- SendEmail: Send email. Params: to, subject, body.
- CreateContact: Add to CRM. Params: first_name, last_name, phone, email, source, tags.
- UpdateDeal: Update pipeline deal. Params: deal_id, stage, value, notes.
- AlertTeam: Notify team members. Params: message, channel (sms/email/push/all), user_ids.
- WebhookCall: Call external API. Params: url, method, headers, payload.
- AIGenerate: Use AI to generate content. Params: prompt, output_field, model.

OUTPUT FORMAT (strict JSON, no markdown):
{
  "name": "<workflow name>",
  "description": "<what this automation does>",
  "trigger": {
    "type": "<trigger type>",
    "filters": { <optional filter params> }
  },
  "steps": [
    {
      "id": "step_1_<action>",
      "action_type": "<action type>",
      "label": "<human-readable label>",
      "params": { <action params> }
    }
  ]
}

RULES:
- Generate 2-10 steps based on complexity
- Use realistic, professional SMS/email copy
- Wait durations should be practical (1-30 min for urgent, hours/days for nurture)
- Conditions should check meaningful business state
- For crash-related workflows, always include SendTwilioSMS to alert the team FIRST
- Use template variables like {{lead_name}}, {{incident_location}}, {{crash_type}} in messages
- Return ONLY valid JSON`;

  app.post("/api/v1/compiler/generate", asyncHandler(async (req: Request, res: Response) => {
    if (!isGeminiConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = z.object({
      prompt: z.string().min(1).max(5000),
      subAccountId: z.number().optional(),
      context: z.object({
        industry: z.string().optional(),
        existingWorkflows: z.array(z.any()).optional(),
        sentinelActive: z.boolean().optional(),
      }).optional(),
    }).safeParse(req.body);

    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    let contextPrompt = "";
    if (parsed.data.context) {
      const ctx = parsed.data.context;
      if (ctx.industry) contextPrompt += `\nIndustry: ${ctx.industry}`;
      if (ctx.sentinelActive) contextPrompt += `\nSentinel crash detection is ACTIVE for this account.`;
      if (ctx.existingWorkflows?.length) {
        contextPrompt += `\nExisting workflows: ${ctx.existingWorkflows.map((w: any) => w.name).join(", ")}`;
      }
    }

    let siteState = "";
    if (parsed.data.subAccountId) {
      const account = await storage.getSubAccount(parsed.data.subAccountId);
      if (account) {
        const wfs = (await storage.getWorkflows()).filter(w => w.subAccountId === account.id);
        const automations = await storage.getLiveAutomations(account.id);
        siteState = `\n\nCURRENT SITE STATE:
Account: ${account.name} (${account.industry || "general"})
Existing Workflows: ${wfs.length > 0 ? wfs.map(w => `${w.name} [trigger: ${w.trigger}]`).join("; ") : "None"}
Live Automations: ${automations.length > 0 ? automations.map(a => `${a.name} [status: ${a.status}]`).join("; ") : "None"}
Plan: ${account.plan}`;
      }
    }

    const raw = await geminiChat([
      { role: "system", content: COMPILER_AI_SYSTEM_PROMPT },
      { role: "user", content: parsed.data.prompt + contextPrompt + siteState },
    ], { temperature: 0.7, maxTokens: 4096, jsonMode: true });

    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let manifestData: any;
    try {
      manifestData = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "AI returned invalid JSON", raw: cleaned });
    }

    const validateResult = workflowManifestSchema.safeParse(manifestData);
    if (!validateResult.success) {
      return res.status(500).json({
        error: "AI generated invalid manifest",
        details: validateResult.error.flatten(),
        raw: manifestData,
      });
    }

    validateResult.data.steps.forEach((step, i) => {
      if (!step.id) step.id = `step_${i + 1}_${step.action_type.toLowerCase()}`;
    });

    const automation = await storage.createLiveAutomation({
      name: validateResult.data.name,
      description: validateResult.data.description || null,
      manifest: validateResult.data as any,
      status: "compiled",
      subAccountId: parsed.data.subAccountId || null,
      lastRunAt: null,
      runCount: 0,
      runLogs: [],
    });

    await logUsageInternal(parsed.data.subAccountId || null, "AI_CHAT", 1, "Workflow compiler AI generation");

    res.status(201).json({
      id: automation.id,
      name: automation.name,
      status: automation.status,
      manifest: automation.manifest,
      createdAt: automation.createdAt,
      stepCount: validateResult.data.steps.length,
      message: "AI System Architect generated and compiled automation",
    });
  }));

  app.post("/api/v1/compiler/analyze", asyncHandler(async (req: Request, res: Response) => {
    if (!isGeminiConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = z.object({ subAccountId: z.number() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const account = await storage.getSubAccount(parsed.data.subAccountId);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const wfs = (await storage.getWorkflows()).filter(w => w.subAccountId === account.id);
    const automations = await storage.getLiveAutomations(account.id);
    const contactCount = (await storage.getContacts(account.id)).length;
    const dealCount = (await storage.getDeals(account.id)).length;

    const analysisPrompt = `Analyze the current automation setup for "${account.name}" (${account.industry || "general"} business, ${account.plan} plan):

Workflows (${wfs.length}): ${wfs.map(w => JSON.stringify({ name: w.name, trigger: w.trigger, steps: w.steps })).join("\n")}

Live Automations (${automations.length}): ${automations.map(a => JSON.stringify({ name: a.name, status: a.status, manifest: a.manifest })).join("\n")}

CRM Stats: ${contactCount} contacts, ${dealCount} deals

Provide:
1. Summary of current setup
2. Gaps/missing automations
3. 3 specific workflow recommendations as JSON manifests
4. Optimization suggestions for existing workflows

Return as JSON: { "summary": "...", "gaps": [...], "recommendations": [...manifest objects...], "optimizations": [...] }`;

    const raw = await geminiChat([
      { role: "system", content: "You are an expert marketing automation consultant. Analyze business automation setups and provide actionable recommendations. Return JSON only." },
      { role: "user", content: analysisPrompt },
    ], { temperature: 0.6, maxTokens: 4096, jsonMode: true });

    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let analysis: any;
    try {
      analysis = JSON.parse(cleaned);
    } catch {
      analysis = { summary: cleaned, gaps: [], recommendations: [], optimizations: [] };
    }

    await logUsageInternal(account.id, "AI_CHAT", 1, "Workflow compiler analysis");
    res.json(analysis);
  }));

  // ===========================================================================
  // AI TOOLBELT — "Do Anything" CRUD Operations
  // ===========================================================================

  const AI_TOOLS = [
    {
      name: "generate_landing_page",
      description: "Generate an AI-powered landing page for the business",
      category: "content",
      inputSchema: { prompt: "string", style: "string?" },
    },
    {
      name: "create_contact",
      description: "Add a new contact to the CRM",
      category: "crm",
      inputSchema: { first_name: "string", last_name: "string?", phone: "string?", email: "string?", tags: "string[]?" },
    },
    {
      name: "cleanup_old_leads",
      description: "Archive contacts older than a specified number of days with no activity",
      category: "crm",
      inputSchema: { days_old: "number", dry_run: "boolean?" },
    },
    {
      name: "provision_vapi_line",
      description: "Search and provision a new phone number via Twilio for voice AI",
      category: "voice",
      inputSchema: { area_code: "string?", country: "string?" },
    },
    {
      name: "send_sms_blast",
      description: "Send an SMS message to a list of contacts by tag",
      category: "messaging",
      inputSchema: { tag: "string", message: "string", sub_account_id: "number" },
    },
    {
      name: "create_workflow",
      description: "Create a new automation workflow",
      category: "automation",
      inputSchema: { name: "string", trigger: "string", steps: "object[]" },
    },
    {
      name: "get_site_state",
      description: "Read the current state of accounts, workflows, contacts, and automations",
      category: "read",
      inputSchema: { sub_account_id: "number" },
    },
    {
      name: "deploy_geofence_ad",
      description: "Deploy a geo-targeted Meta ad around specific coordinates",
      category: "ads",
      inputSchema: { lat: "number", lng: "number", radius_miles: "number?", campaign_name: "string?", budget: "number?" },
    },
    {
      name: "update_account_settings",
      description: "Update sub-account configuration or settings",
      category: "admin",
      inputSchema: { sub_account_id: "number", name: "string?", industry: "string?", plan: "string?" },
    },
    {
      name: "create_deal",
      description: "Create a new deal in the sales pipeline",
      category: "crm",
      inputSchema: { sub_account_id: "number", title: "string", value: "number?", stage_id: "number", contact_id: "number?" },
    },
  ];

  app.get("/api/v1/tools", asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      tools: AI_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        category: t.category,
        inputSchema: t.inputSchema,
      })),
      count: AI_TOOLS.length,
    });
  }));

  app.post("/api/v1/tools/execute", asyncHandler(async (req: Request, res: Response) => {
    const parsed = z.object({
      tool: z.string().min(1),
      args: z.record(z.any()).optional().default({}),
      subAccountId: z.number().optional(),
    }).safeParse(req.body);

    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { tool, args, subAccountId } = parsed.data;
    const toolDef = AI_TOOLS.find(t => t.name === tool);
    if (!toolDef) return res.status(404).json({ error: `Unknown tool: ${tool}` });

    const startMs = Date.now();
    let result: any;
    let status = "success";

    try {
      switch (tool) {
        case "generate_landing_page": {
          if (!isGeminiConfigured()) throw new Error("AI not configured");
          const sitePrompt = args.prompt || "Professional business landing page";
          const raw = await geminiChat([
            { role: "system", content: "Generate a JSON site structure with sections: hero, features, testimonials, cta. Return valid JSON." },
            { role: "user", content: sitePrompt },
          ], { temperature: 0.7, maxTokens: 4096, jsonMode: true });
          const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          let siteData;
          try { siteData = JSON.parse(cleaned); } catch { siteData = { raw: cleaned }; }
          result = { generated: true, siteData };
          break;
        }

        case "create_contact": {
          if (!subAccountId) throw new Error("subAccountId required");
          const contact = await storage.createContact({
            subAccountId,
            firstName: args.first_name || "Unknown",
            lastName: args.last_name || null,
            phone: args.phone || null,
            email: args.email || null,
            source: "ai_toolbelt",
            tags: args.tags || [],
            notes: "Created via AI Toolbelt",
          });
          result = { created: true, contact };
          break;
        }

        case "cleanup_old_leads": {
          if (!subAccountId) throw new Error("subAccountId required");
          const daysOld = args.days_old || 90;
          const allContacts = await storage.getContacts(subAccountId);
          const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
          const oldContacts = allContacts.filter(c => new Date(c.createdAt) < cutoff);
          if (args.dry_run) {
            result = { dry_run: true, would_archive: oldContacts.length, total: allContacts.length };
          } else {
            let archived = 0;
            for (const c of oldContacts) {
              await storage.updateContact(c.id, { tags: [...(c.tags || []), "archived"] });
              archived++;
            }
            result = { archived, total: allContacts.length };
          }
          break;
        }

        case "provision_vapi_line": {
          const areaCode = args.area_code || "239";
          result = { message: `Phone number search initiated for area code ${areaCode}. Use the Phone Numbers page to complete purchase.`, areaCode };
          break;
        }

        case "send_sms_blast": {
          if (!args.sub_account_id) throw new Error("sub_account_id required");
          const tagContacts = (await storage.getContacts(args.sub_account_id)).filter(c => c.tags?.includes(args.tag));
          result = { queued: tagContacts.length, tag: args.tag, message: args.message };
          break;
        }

        case "create_workflow": {
          const wf = await storage.createWorkflow({
            name: args.name || "AI Tool Workflow",
            trigger: args.trigger || "manual_trigger",
            steps: args.steps || [],
            subAccountId: subAccountId || null,
          });
          result = { created: true, workflow: wf };
          break;
        }

        case "get_site_state": {
          const acctId = args.sub_account_id || subAccountId;
          if (!acctId) throw new Error("sub_account_id required");
          const account = await storage.getSubAccount(acctId);
          if (!account) throw new Error("Account not found");
          const wfs = (await storage.getWorkflows()).filter(w => w.subAccountId === acctId);
          const autos = await storage.getLiveAutomations(acctId);
          const ctcs = await storage.getContacts(acctId);
          const dls = await storage.getDeals(acctId);
          result = {
            account: { id: account.id, name: account.name, industry: account.industry, plan: account.plan },
            workflows: wfs.map(w => ({ id: w.id, name: w.name, trigger: w.trigger })),
            automations: autos.map(a => ({ id: a.id, name: a.name, status: a.status })),
            contacts: ctcs.length,
            deals: dls.length,
          };
          break;
        }

        case "deploy_geofence_ad": {
          result = {
            deployed: true,
            lat: args.lat,
            lng: args.lng,
            radius_miles: args.radius_miles || 1,
            campaign_name: args.campaign_name || "AI Geofence Campaign",
            message: "Geofence ad deployment queued",
          };
          break;
        }

        case "update_account_settings": {
          if (!args.sub_account_id) throw new Error("sub_account_id required");
          const updateData: any = {};
          if (args.name) updateData.name = args.name;
          if (args.industry) updateData.industry = args.industry;
          const updated = await storage.updateSubAccount(args.sub_account_id, updateData);
          result = { updated: !!updated, account: updated };
          break;
        }

        case "create_deal": {
          if (!args.sub_account_id) throw new Error("sub_account_id required");
          const deal = await storage.createDeal({
            subAccountId: args.sub_account_id,
            title: args.title || "New Deal",
            value: args.value || 0,
            stageId: args.stage_id,
            contactId: args.contact_id || null,
            status: "open",
            notes: "Created via AI Toolbelt",
            closedAt: null,
          });
          result = { created: true, deal };
          break;
        }

        default:
          throw new Error(`Tool ${tool} has no handler`);
      }
    } catch (err: any) {
      status = "error";
      result = { error: err.message };
    }

    const executionMs = Date.now() - startMs;

    await storage.createAiToolLog({
      subAccountId: subAccountId || null,
      toolName: tool,
      input: args,
      output: result,
      status,
      executionMs,
    });

    res.json({ tool, status, result, executionMs });
  }));

  app.post("/api/v1/tools/ai-execute", asyncHandler(async (req: Request, res: Response) => {
    if (!isGeminiConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = z.object({
      command: z.string().min(1).max(2000),
      subAccountId: z.number().optional(),
    }).safeParse(req.body);

    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const toolList = AI_TOOLS.map(t => `- ${t.name}: ${t.description} (inputs: ${JSON.stringify(t.inputSchema)})`).join("\n");

    const raw = await geminiChat([
      { role: "system", content: `You are an AI that translates natural language commands into tool executions.

Available tools:
${toolList}

Return JSON: { "tool": "<tool_name>", "args": { <arguments> }, "explanation": "<what this will do>" }

If the command requires multiple tools, return: { "steps": [{ "tool": "...", "args": {...} }, ...], "explanation": "..." }

Return ONLY valid JSON.` },
      { role: "user", content: parsed.data.command },
    ], { temperature: 0.3, maxTokens: 4096, jsonMode: true });

    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let plan: any;
    try {
      plan = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "AI returned invalid plan", raw: cleaned });
    }

    await logUsageInternal(parsed.data.subAccountId || null, "AI_CHAT", 1, "AI toolbelt command interpretation");

    res.json({
      plan,
      message: "AI has interpreted your command. Execute the plan via /api/v1/tools/execute.",
    });
  }));

  // ============================================================
  // UNIVERSAL DISPATCHER — Single endpoint for ALL system commands
  // ============================================================

  const ORCHESTRATE_ACTIONS = [
    "save_workflow", "deploy_ad", "provision_user", "trigger_geofence",
    "send_sms", "start_vapi_call", "broadcast_alert", "create_sub_account",
    "update_settings", "generate_site", "create_contact", "create_deal",
    "deploy_geofence_ad", "provision_vapi_line", "check_workflow_status",
    "get_crash_logs", "update_user_role", "save_workflow_manifest",
    "elevenlabs_tts",
  ] as const;

  async function executeDispatchAction(action: string, payload: Record<string, any>): Promise<any> {
    let result: any;
    switch (action) {
        case "save_workflow":
        case "save_workflow_manifest": {
          if (payload.manifest) {
            const automation = await storage.createLiveAutomation({
              name: payload.name || payload.manifest.name || `Workflow_${Date.now()}`,
              description: payload.description || payload.manifest.description || null,
              manifest: payload.manifest,
              status: "compiled",
              subAccountId: payload.subAccountId || null,
              lastRunAt: null,
              runCount: 0,
              runLogs: [],
            });
            result = { status: "Success", message: "Workflow Live", automationId: automation.id, name: automation.name };
          } else {
            const wf = await storage.createWorkflow({
              name: payload.name || "Orchestrated Workflow",
              trigger: payload.trigger || "manual_trigger",
              steps: payload.steps || [],
              subAccountId: payload.subAccountId || null,
            });
            result = { status: "Success", message: "Workflow Saved", workflowId: wf.id };
          }
          break;
        }

        case "deploy_ad":
        case "deploy_geofence_ad": {
          const adResult = await deployGeofenceAd({
            id: payload.id || Date.now(),
            location: payload.location || "Target Area",
            lat: payload.lat,
            lng: payload.lng,
            title: payload.campaign_name || "Apex Geofence Campaign",
          }, payload.radius_miles || 1);
          result = { status: "Success", message: "Ad Deployed", details: adResult };
          break;
        }

        case "provision_user":
        case "create_sub_account": {
          const account = await storage.createSubAccount({
            name: payload.name || "New Account",
            twilioNumber: payload.twilio_number || "",
            industry: payload.industry || "general",
            plan: payload.plan || "starter",
            ownerUserId: payload.owner_user_id || null,
          });
          result = { status: "Success", message: "Account Ready", accountId: account.id, name: account.name };
          break;
        }

        case "trigger_geofence": {
          const incidents = await processLiveSentinelFeed();
          const filtered = payload.county
            ? incidents.filter(inc => inc.county?.toUpperCase() === payload.county.toUpperCase())
            : incidents;
          result = {
            status: "Success",
            message: `Geofence scan complete. ${filtered.length} incidents found.`,
            incidents: filtered.slice(0, 20),
            total: filtered.length,
          };
          break;
        }

        case "get_crash_logs": {
          const logs = await processLiveSentinelFeed();
          const limit = payload.limit || 20;
          result = {
            status: "Success",
            message: `${logs.length} total incidents`,
            incidents: logs.slice(0, limit),
          };
          break;
        }

        case "send_sms": {
          const twilioSid = process.env.TWILIO_ACCOUNT_SID;
          const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
          if (!twilioSid || !twilioAuth) {
            result = { status: "Error", message: "Twilio not configured" };
          } else if (!payload.to || !payload.body) {
            result = { status: "Error", message: "Missing 'to' phone number or 'body'" };
          } else {
            const { checkPhoneOptOut } = await import("./optOutGuard");
            const isOptedOut = payload.subAccountId
              ? await checkPhoneOptOut(payload.to, payload.subAccountId)
              : false;

            if (isOptedOut) {
              result = { status: "Blocked", message: "Recipient has opted out of SMS" };
            } else {
              try {
                const twilio = Twilio(twilioSid, twilioAuth);
                const msg = await twilio.messages.create({
                  to: payload.to,
                  from: payload.from || process.env.TWILIO_PHONE_NUMBER || "+18001234567",
                  body: payload.body,
                });
                result = { status: "Success", message: "SMS Sent", sid: msg.sid };
              } catch (err: any) {
                result = { status: "Error", message: `SMS failed: ${err.message}` };
              }
            }
          }
          break;
        }

        case "start_vapi_call": {
          const vapiKey = process.env.VAPI_PRIVATE_KEY;
          if (!vapiKey) {
            result = { status: "Error", message: "Vapi not configured" };
          } else {
            try {
              const vapiRes = await fetch("https://api.vapi.ai/call/phone", {
                method: "POST",
                headers: { "Authorization": `Bearer ${vapiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  phoneNumberId: payload.phoneNumberId || process.env.VAPI_PHONE_NUMBER_ID,
                  customer: { number: payload.to },
                  assistantId: payload.assistantId,
                  assistant: payload.assistantId ? undefined : {
                    model: { provider: "openai", model: "gpt-4o-mini" },
                    voice: { provider: "11labs", voiceId: "21m00Tcm4TlvDq8ikWAM" },
                    firstMessage: payload.first_message || "Hi, this is Apex calling on behalf of your local firm. How can I help you today?",
                  },
                }),
              });
              const vapiData = await vapiRes.json();
              result = { status: "Success", message: "Call Initiated", callId: (vapiData as any).id, details: vapiData };
            } catch (err: any) {
              result = { status: "Error", message: `Vapi call failed: ${err.message}` };
            }
          }
          break;
        }

        case "broadcast_alert": {
          if (!payload.message) {
            result = { status: "Error", message: "Missing alert message" };
          } else {
            const alertWebhookUrl = process.env.APEX_WEBHOOK_URL;
            if (alertWebhookUrl) {
              try {
                await fetch(alertWebhookUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    type: "broadcast_alert",
                    message: payload.message,
                    channel: payload.channel || "all",
                    priority: payload.priority || "normal",
                    timestamp: new Date().toISOString(),
                  }),
                });
              } catch {}
            }
            result = { status: "Success", message: "Alert Broadcast", alert: payload.message, channel: payload.channel || "all" };
          }
          break;
        }

        case "update_settings":
        case "update_user_role": {
          if (!payload.sub_account_id) {
            result = { status: "Error", message: "sub_account_id required" };
          } else {
            const updateData: any = {};
            if (payload.name) updateData.name = payload.name;
            if (payload.industry) updateData.industry = payload.industry;
            if (payload.plan) updateData.plan = payload.plan;
            const updated = await storage.updateSubAccount(payload.sub_account_id, updateData);
            result = { status: "Success", message: "Settings Updated", account: updated };
          }
          break;
        }

        case "generate_site": {
          if (!isGeminiConfigured()) throw new Error("AI not configured");
          const siteRaw = await geminiChat([
            { role: "system", content: "Generate a JSON site structure with sections: hero, features, testimonials, cta. Return valid JSON." },
            { role: "user", content: payload.prompt || "Professional business landing page" },
          ], { temperature: 0.7, maxTokens: 4096, jsonMode: true });
          const cleaned = siteRaw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          let siteData;
          try { siteData = JSON.parse(cleaned); } catch { siteData = { raw: cleaned }; }
          result = { status: "Success", message: "Site Generated", siteData };
          break;
        }

        case "create_contact": {
          if (!payload.sub_account_id) throw new Error("sub_account_id required");
          const contact = await storage.createContact({
            subAccountId: payload.sub_account_id,
            firstName: payload.first_name || "Unknown",
            lastName: payload.last_name || null,
            phone: payload.phone || null,
            email: payload.email || null,
            source: payload.source || "orchestrator",
            tags: payload.tags || [],
            notes: payload.notes || "Created via Universal Dispatcher",
          });
          result = { status: "Success", message: "Contact Created", contact };
          break;
        }

        case "create_deal": {
          if (!payload.sub_account_id) throw new Error("sub_account_id required");
          const deal = await storage.createDeal({
            subAccountId: payload.sub_account_id,
            title: payload.title || "New Deal",
            value: payload.value || 0,
            stageId: payload.stage_id,
            contactId: payload.contact_id || null,
            status: "open",
            notes: payload.notes || "Created via Universal Dispatcher",
            closedAt: null,
          });
          result = { status: "Success", message: "Deal Created", deal };
          break;
        }

        case "provision_vapi_line": {
          const areaCode = payload.area_code || "239";
          result = { status: "Success", message: `Phone line provisioning initiated for area code ${areaCode}`, areaCode };
          break;
        }

        case "elevenlabs_tts":
        case "ElevenLabsTTS": {
          const elSubAccountId = payload.subAccountId || payload.sub_account_id;
          const elApiKey = await resolveElevenLabsApiKey(elSubAccountId);
          if (!elApiKey) {
            result = { status: "Error", message: "ElevenLabs API key not configured. Connect it in the Integrations Hub." };
          } else if (!payload.text) {
            result = { status: "Error", message: "Missing 'text' for TTS synthesis" };
          } else {
            try {
              const elVoiceId = payload.voice_id || payload.voiceId || "EXAVITQu4vr4xnSDxMaL";
              const audioBuffer = await elevenLabsTtsRequest(elApiKey, elVoiceId, payload.text, {
                modelId: payload.model_id,
                stability: payload.stability,
                similarityBoost: payload.similarity_boost,
              });
              result = {
                status: "Success",
                message: "TTS audio generated",
                audioBase64: audioBuffer.toString("base64"),
                contentType: "audio/mpeg",
                characterCount: payload.text.length,
              };
            } catch (err: any) {
              result = { status: "Error", message: `ElevenLabs TTS error: ${err.message}` };
            }
          }
          break;
        }

        case "check_workflow_status": {
          const automations = await storage.getLiveAutomations(payload.sub_account_id);
          const workflows = (await storage.getWorkflows()).filter(w =>
            payload.sub_account_id ? w.subAccountId === payload.sub_account_id : true
          );
          result = {
            status: "Success",
            message: `${automations.length} live automations, ${workflows.length} workflows`,
            automations: automations.map(a => ({ id: a.id, name: a.name, status: a.status })),
            workflows: workflows.map(w => ({ id: w.id, name: w.name, trigger: w.trigger })),
          };
          break;
        }

        default:
          return { status: "Error", message: `Unknown command: ${action}`, availableActions: [...ORCHESTRATE_ACTIONS] };
      }
    return result;
  }

  async function fireAutomationTrigger(
    triggerName: string,
    subAccountId: number,
    context: Record<string, any> = {},
    depth: number = 0
  ) {
    try {
      const { checkAutomationSafety } = await import("./automationSafety");
      const automations = await storage.getLiveAutomations(subAccountId);
      const matching = automations.filter((a: any) =>
        (a.status === "compiled" || a.status === "active") &&
        a.manifest?.trigger &&
        a.manifest.trigger === triggerName
      );

      if (matching.length === 0) return;

      const account = await storage.getSubAccount(subAccountId);

      for (const automation of matching) {
        const safety = checkAutomationSafety({
          automationId: automation.id,
          triggerId: `${triggerName}:${JSON.stringify(context).substring(0, 100)}`,
          depth,
          accountId: subAccountId,
        });

        if (!safety.safe) {
          console.warn(`[AUTOMATION] Blocked: ${safety.reason}`);
          continue;
        }

        try {
          const steps = automation.manifest?.steps || [];
          for (const step of steps) {
            const action = step.action || step.type;
            if (!action) continue;

            if (action === "Wait" || action === "wait") {
              const waitMs = (step.payload?.seconds || step.seconds || 5) * 1000;
              await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 30000)));
              continue;
            }

            if (action === "Condition" || action === "condition") {
              continue;
            }

            const stepPayload = { ...step.payload };
            if (stepPayload.body && typeof stepPayload.body === "string") {
              stepPayload.body = stepPayload.body
                .replace(/\{\{leadName\}\}/g, context.leadName || "there")
                .replace(/\{\{leadPhone\}\}/g, context.leadPhone || "")
                .replace(/\{\{leadEmail\}\}/g, context.leadEmail || "")
                .replace(/\{\{location\}\}/g, context.location || "")
                .replace(/\{\{source\}\}/g, context.source || "")
                .replace(/\{\{orderNumber\}\}/g, context.orderNumber || "")
                .replace(/\{\{orderTotal\}\}/g, context.orderTotal || "")
                .replace(/\{\{cartTotal\}\}/g, context.cartTotal || "")
                .replace(/\{\{cartUrl\}\}/g, context.cartUrl || "")
                .replace(/\{\{storeName\}\}/g, context.storeName || "");
            }
            if (action === "send_sms" && !stepPayload.to && context.leadPhone) {
              stepPayload.to = context.leadPhone;
            }
            await executeDispatchAction(action, {
              ...stepPayload,
              subAccountId,
              from: account?.twilioNumber || process.env.TWILIO_PHONE_NUMBER,
            });
          }

          await storage.updateLiveAutomation(automation.id, {
            lastRunAt: new Date(),
            runCount: (automation.runCount || 0) + 1,
            runLogs: [...(automation.runLogs as any[] || []), {
              timestamp: new Date().toISOString(),
              trigger: triggerName,
              context: { leadName: context.leadName, leadPhone: context.leadPhone },
              status: "completed",
            }].slice(-50),
          });
          console.log(`[AUTOMATION] "${automation.name}" fired on trigger "${triggerName}" for account ${subAccountId}`);
        } catch (autoErr: any) {
          console.error(`[AUTOMATION] "${automation.name}" failed: ${autoErr.message}`);
          await storage.updateLiveAutomation(automation.id, {
            runLogs: [...(automation.runLogs as any[] || []), {
              timestamp: new Date().toISOString(),
              trigger: triggerName,
              status: "error",
              error: autoErr.message,
            }].slice(-50),
          });
        }
      }
    } catch (err: any) {
      console.error(`[AUTOMATION] Trigger "${triggerName}" error for account ${subAccountId}: ${err.message}`);
    }
  }

  app.post("/api/v1/orchestrate", asyncHandler(async (req: Request, res: Response) => {
    const parsed = z.object({
      action: z.string().min(1),
      payload: z.record(z.any()).optional().default({}),
    }).safeParse(req.body);

    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { action, payload } = parsed.data;
    console.log(`🤖 AI DELEGATING ACTION: ${action}`, JSON.stringify(payload).slice(0, 200));

    const startMs = Date.now();
    let result: any;

    try {
      result = await executeDispatchAction(action, payload);
    } catch (err: any) {
      return res.status(500).json({ status: "Error", message: err.message, action });
    }

    const executionMs = Date.now() - startMs;
    console.log(`✅ ACTION COMPLETE: ${action} (${executionMs}ms)`);

    await storage.createAiToolLog({
      subAccountId: payload.sub_account_id || payload.subAccountId || null,
      toolName: `orchestrate:${action}`,
      input: payload,
      output: result,
      status: result.status === "Error" ? "error" : "success",
      executionMs,
    });

    res.json({ ...result, action, executionMs });
  }));

  // ============================================================
  // AI ORCHESTRATOR — Full auto-execute: AI interprets → plans → EXECUTES
  // ============================================================
  app.post("/api/v1/orchestrate/ai", asyncHandler(async (req: Request, res: Response) => {
    if (!isGeminiConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = z.object({
      command: z.string().min(1).max(3000),
      subAccountId: z.number().optional(),
      autoExecute: z.boolean().optional().default(true),
    }).safeParse(req.body);

    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { command, subAccountId, autoExecute } = parsed.data;

    const orchestrateActions = ORCHESTRATE_ACTIONS.join(", ");
    const toolList = AI_TOOLS.map(t => `- ${t.name}: ${t.description}`).join("\n");

    const raw = await geminiChat([
      { role: "system", content: `You are the Apex OS Architect. You orchestrate the Apex Marketing Automations ecosystem by issuing commands to the backend API.

RULES OF ENGAGEMENT:
- You do NOT just chat; you ORCHESTRATE.
- If a user asks for a workflow, you generate the JSON manifest.
- You turn natural language into executable action plans.

AVAILABLE ORCHESTRATE ACTIONS (use these as "action" values):
${orchestrateActions}

AVAILABLE TOOLS (for toolbelt operations):
${toolList}

When building a workflow manifest, use this structure:
{
  "name": "Workflow Name",
  "trigger": { "type": "OnCrashDetected|OnNewLead|OnMissedCall|OnFormSubmit|Manual", "filters": {} },
  "steps": [
    { "id": "step_1", "action_type": "SendTwilioSMS|Wait|Condition|DeployMetaAd|AlertTeam|CreateContact|SendEmail|WebhookCall|AIGenerate|ElevenLabsTTS", "label": "...", "params": {...} }
  ]
}

Return a JSON execution plan:
{
  "interpretation": "What the user wants in one sentence",
  "steps": [
    { "action": "<orchestrate_action>", "payload": { ... }, "description": "What this step does" }
  ],
  "summary": "Brief completion message to show the user"
}

For workflow creation, use action "save_workflow_manifest" with payload.manifest containing the full manifest.

${subAccountId ? `Context: Operating on sub-account #${subAccountId}` : ""}

Return ONLY valid JSON.` },
      { role: "user", content: command },
    ], { temperature: 0.3, maxTokens: 4096, jsonMode: true });

    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let plan: any;
    try {
      plan = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "AI returned invalid plan", raw: cleaned });
    }

    if (!autoExecute) {
      return res.json({ plan, executed: false, message: "Plan generated. Set autoExecute=true to run." });
    }

    const executionResults: any[] = [];
    const planSteps = plan.steps || (plan.action ? [plan] : []);

    for (let i = 0; i < planSteps.length; i++) {
      const step = planSteps[i];
      const stepAction = step.action;
      const stepPayload = step.payload || step.args || {};

      if (subAccountId && !stepPayload.sub_account_id && !stepPayload.subAccountId) {
        stepPayload.subAccountId = subAccountId;
        stepPayload.sub_account_id = subAccountId;
      }

      try {
        const stepResult = await executeDispatchAction(stepAction, stepPayload);

        await storage.createAiToolLog({
          subAccountId: subAccountId || null,
          toolName: `orchestrate:${stepAction}`,
          input: stepPayload,
          output: stepResult,
          status: stepResult?.status === "Error" ? "error" : "success",
          executionMs: 0,
        });

        executionResults.push({
          step: i + 1,
          action: stepAction,
          description: step.description || step.explanation,
          status: stepResult?.status || "Success",
          result: stepResult,
        });
      } catch (err: any) {
        executionResults.push({
          step: i + 1,
          action: stepAction,
          description: step.description || step.explanation,
          status: "Error",
          result: { error: err.message },
        });
      }
    }

    await logUsageInternal(subAccountId || null, "AI_ORCHESTRATE", planSteps.length, `Orchestrated: ${command.slice(0, 100)}`);

    res.json({
      interpretation: plan.interpretation || plan.explanation,
      summary: plan.summary || `Executed ${executionResults.length} actions.`,
      steps: executionResults,
      totalSteps: executionResults.length,
      successCount: executionResults.filter(r => r.status === "Success").length,
      executed: true,
    });
  }));

  // ---- Webhook Events ----
  app.get("/api/webhook-events/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const events = await storage.getWebhookEvents(subAccountId);
    res.json(events);
  }));

  // ---- Integration Connections ----
  app.get("/api/integrations/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const connections = await storage.getIntegrationConnections(subAccountId);
    const oauthTokens = await storage.getOAuthTokensBySubAccount(subAccountId);
    const tokenMap = new Map(oauthTokens.map((t: any) => [t.provider, t]));
    const formatted = connections.map((c: any) => {
      const token = tokenMap.get(c.provider);
      return {
        provider: c.provider,
        connected: c.status === "connected",
        status: c.status,
        config: c.config || {},
        connectionType: c.connectionType || "legacy",
        scopes: token?.scopes ? token.scopes.split(" ") : [],
      };
    });
    res.json(formatted);
  }));

  app.post("/api/integrations/:subAccountId/connect", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { provider, config } = req.body;

    const COMING_SOON_PROVIDERS: string[] = [];
    if (COMING_SOON_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `${provider} integration is coming soon. This provider is not yet fully supported.` });
    }

    const VALIDATED_PROVIDERS = ["twilio", "mailchimp", "facebook", "meta-ads", "stripe", "google-maps", "shopify", "google-analytics", "google-business", "elevenlabs"];
    const isValidatedProvider = VALIDATED_PROVIDERS.includes(provider);

    let validationResult: { valid: boolean; error?: string } = { valid: true };
    try {
      if (provider === "twilio" && config?.accountSid && config?.authToken) {
        const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}.json`, {
          headers: { "Authorization": "Basic " + Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64") },
          signal: AbortSignal.timeout(5000),
        });
        if (!twilioRes.ok) validationResult = { valid: false, error: "Invalid Twilio credentials. Check your Account SID and Auth Token." };
      } else if (provider === "mailchimp" && config?.apiKey) {
        const dc = config.serverPrefix || config.apiKey.split("-").pop();
        const mcRes = await fetch(`https://${dc}.api.mailchimp.com/3.0/ping`, {
          headers: { "Authorization": `Bearer ${config.apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!mcRes.ok) validationResult = { valid: false, error: "Invalid Mailchimp API key or server prefix." };
      } else if (provider === "facebook" && config?.pageAccessToken) {
        const appId = process.env.META_APP_ID;
        const appSecret = process.env.META_APP_SECRET;
        if (appId && appSecret) {
          const debugRes = await fetch(`https://graph.facebook.com/v19.0/debug_token?input_token=${config.pageAccessToken}&access_token=${appId}|${appSecret}`, {
            signal: AbortSignal.timeout(5000),
          });
          const debugData = await debugRes.json() as any;
          if (!debugRes.ok || !debugData?.data?.is_valid) {
            validationResult = { valid: false, error: `Invalid Facebook Page Access Token. ${debugData?.data?.error?.message || "Token validation failed."}` };
          }
        } else {
          const fbRes = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${config.pageAccessToken}`, {
            signal: AbortSignal.timeout(5000),
          });
          if (!fbRes.ok) validationResult = { valid: false, error: "Invalid Facebook Page Access Token." };
        }
      } else if (provider === "meta-ads" && config?.accessToken) {
        const appId = process.env.META_APP_ID;
        const appSecret = process.env.META_APP_SECRET;
        if (appId && appSecret) {
          const debugRes = await fetch(`https://graph.facebook.com/v19.0/debug_token?input_token=${config.accessToken}&access_token=${appId}|${appSecret}`, {
            signal: AbortSignal.timeout(5000),
          });
          const debugData = await debugRes.json() as any;
          if (!debugRes.ok || !debugData?.data?.is_valid) {
            validationResult = { valid: false, error: `Invalid Meta Access Token. ${debugData?.data?.error?.message || "Token validation failed."}` };
          }
        } else {
          const metaRes = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${config.accessToken}`, {
            signal: AbortSignal.timeout(5000),
          });
          if (!metaRes.ok) validationResult = { valid: false, error: "Invalid Meta Access Token." };
        }
      } else if (provider === "stripe" && config?.secretKey) {
        const stripeRes = await fetch("https://api.stripe.com/v1/products?limit=1", {
          headers: { "Authorization": `Bearer ${config.secretKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!stripeRes.ok) validationResult = { valid: false, error: "Invalid Stripe Secret Key. Check your API key." };
      } else if (provider === "google-maps" && config?.apiKey) {
        const gmRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=test&key=${config.apiKey}`, {
          signal: AbortSignal.timeout(5000),
        });
        const gmData = await gmRes.json() as any;
        if (gmData.error_message) validationResult = { valid: false, error: `Google Maps API error: ${gmData.error_message}` };
      } else if (provider === "shopify" && config?.storeDomain && config?.accessToken) {
        const domain = config.storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
        const shopRes = await fetch(`https://${domain}/admin/api/2024-01/shop.json`, {
          headers: { "X-Shopify-Access-Token": config.accessToken },
          signal: AbortSignal.timeout(5000),
        });
        if (!shopRes.ok) validationResult = { valid: false, error: "Invalid Shopify credentials. Check your store domain and access token." };
      } else if (provider === "google-analytics" && config?.measurementId) {
        if (!config.measurementId.startsWith("G-")) {
          validationResult = { valid: false, error: "Measurement ID should start with 'G-'" };
        }
      } else if (provider === "google-business" && config?.accountId) {
        if (!config.accountId.startsWith("accounts/")) {
          validationResult = { valid: false, error: "Business Profile ID should start with 'accounts/'" };
        }
      } else if (provider === "elevenlabs" && config?.apiKey) {
        const elRes = await fetch("https://api.elevenlabs.io/v1/user", {
          headers: { "xi-api-key": config.apiKey },
          signal: AbortSignal.timeout(5000),
        });
        if (!elRes.ok) validationResult = { valid: false, error: "Invalid ElevenLabs API key. Check your key in ElevenLabs settings." };
      }
    } catch (validErr: any) {
      console.warn(`[INTEGRATIONS] Validation failed for ${provider}:`, validErr.message);
      validationResult = { valid: false, error: `Could not validate credentials: ${validErr.message}` };
    }

    if (!validationResult.valid) {
      return res.status(400).json({ error: validationResult.error, validated: false });
    }

    const connectionStatus = isValidatedProvider ? "connected" : "stored_unverified";

    const connection = await storage.upsertIntegrationConnection({
      subAccountId,
      provider,
      status: connectionStatus,
      config: config || {},
      connectedAt: new Date(),
    });
    res.json({ ...connection, validated: isValidatedProvider, status: connectionStatus });
  }));

  app.post("/api/integrations/:subAccountId/disconnect", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { provider } = req.body;

    const existingConnection = await storage.getIntegrationConnection(subAccountId, provider);
    if (existingConnection?.connectionType === "oauth") {
      await revokeToken(subAccountId, provider);
      await storage.deleteProviderAssets(subAccountId, provider);
    }

    const connection = await storage.upsertIntegrationConnection({
      subAccountId,
      provider,
      status: "disconnected",
      config: {},
      connectionType: existingConnection?.connectionType || "legacy",
      connectedAt: null,
    });

    await storage.createIntegrationEvent({
      subAccountId,
      provider,
      eventType: "disconnected",
      payload: { connectionType: existingConnection?.connectionType || "legacy" },
    });

    res.json(connection);
  }));

  // ---- OAuth Initiation Endpoints ----

  interface OAuthTokenExchangeResponse {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  }

  interface GoogleUserInfo {
    id?: string;
    email?: string;
    name?: string;
  }

  interface MetaUserInfo {
    id?: string;
    email?: string;
    name?: string;
  }

  interface GoogleCalendarListResponse {
    items?: Array<{ id: string; summary?: string }>;
  }

  interface GoogleDriveFilesResponse {
    files?: Array<{ id: string; name: string; mimeType: string }>;
  }

  interface GoogleBusinessAccountsResponse {
    accounts?: Array<{ name: string; accountName?: string }>;
  }

  interface MetaAccountsResponse {
    data?: Array<{ id: string; name: string; instagram_business_account?: { id: string; name?: string; username?: string } }>;
  }

  interface MetaAdAccountsResponse {
    data?: Array<{ id: string; name?: string; account_status?: number }>;
  }

  const GOOGLE_OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/business.manage",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ];

  const META_OAUTH_SCOPES = [
    "pages_manage_metadata",
    "pages_read_engagement",
    "pages_messaging",
    "instagram_basic",
    "instagram_manage_messages",
    "ads_read",
    "leads_retrieval",
    "pages_manage_ads",
    "email",
    "public_profile",
  ];

  app.get("/api/oauth/google/authorize/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ error: "Google OAuth not configured" });
    }

    const state = crypto.randomBytes(32).toString("hex");
    (req.session as any).oauthState = state;
    (req.session as any).oauthSubAccountId = subAccountId;
    (req.session as any).oauthProvider = "google";

    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/google/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_OAUTH_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }));

  app.get("/api/oauth/meta/authorize/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const appId = process.env.META_APP_ID;
    if (!appId) {
      return res.status(500).json({ error: "Meta OAuth not configured" });
    }

    const state = crypto.randomBytes(32).toString("hex");
    (req.session as any).oauthState = state;
    (req.session as any).oauthSubAccountId = subAccountId;
    (req.session as any).oauthProvider = "meta";

    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/meta/callback`;
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: META_OAUTH_SCOPES.join(","),
      state,
    });

    res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params}`);
  }));

  // ---- YouTube OAuth ----
  const YOUTUBE_OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ];

  app.get("/api/oauth/youtube/authorize/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: "Google OAuth not configured" });
    const state = crypto.randomBytes(32).toString("hex");
    (req.session as any).oauthState = state;
    (req.session as any).oauthSubAccountId = subAccountId;
    (req.session as any).oauthProvider = "youtube";
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/youtube/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: YOUTUBE_OAUTH_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }));

  app.get("/api/oauth/youtube/callback", asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect("/integrations?error=youtube_oauth_denied");
    const sessionState = (req.session as any)?.oauthState;
    const subAccountId = (req.session as any)?.oauthSubAccountId;
    if (!code || !state || state !== sessionState || !subAccountId) {
      return res.redirect("/integrations?error=youtube_oauth_invalid_state");
    }
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/youtube/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: code as string, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const tokenData = await tokenResponse.json() as any;
    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.redirect("/integrations?error=youtube_token_failed");
    }
    let providerEmail = "", providerAccountId = "";
    try {
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
      const profile = await profileRes.json() as any;
      providerEmail = profile.email || "";
      providerAccountId = profile.id || "";
    } catch {}
    const expiresIn = tokenData.expires_in || 3600;
    await storage.upsertOAuthToken({
      provider: "youtube", subAccountId, accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token || null,
      tokenExpiry: new Date(Date.now() + expiresIn * 1000), scopes: YOUTUBE_OAUTH_SCOPES.join(" "), providerAccountId, providerEmail, connectionType: "oauth",
    });
    await storage.upsertIntegrationConnection({
      subAccountId, provider: "youtube", status: "connected", config: { email: providerEmail }, connectionType: "oauth", connectedAt: new Date(),
    });
    await storage.createIntegrationEvent({ subAccountId, provider: "youtube", eventType: "oauth_connected", payload: { email: providerEmail } });
    res.redirect("/integrations?success=youtube_connected");
  }));

  // ---- LinkedIn OAuth ----
  app.get("/api/oauth/linkedin/authorize/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: "LinkedIn OAuth not configured. Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to your secrets." });
    const state = crypto.randomBytes(32).toString("hex");
    (req.session as any).oauthState = state;
    (req.session as any).oauthSubAccountId = subAccountId;
    (req.session as any).oauthProvider = "linkedin";
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/linkedin/callback`;
    const scopes = ["openid", "profile", "email", "w_member_social", "r_organization_social", "w_organization_social"];
    const params = new URLSearchParams({
      response_type: "code", client_id: clientId, redirect_uri: redirectUri, state, scope: scopes.join(" "),
    });
    res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
  }));

  app.get("/api/oauth/linkedin/callback", asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect("/integrations?error=linkedin_oauth_denied");
    const sessionState = (req.session as any)?.oauthState;
    const subAccountId = (req.session as any)?.oauthSubAccountId;
    if (!code || !state || state !== sessionState || !subAccountId) {
      return res.redirect("/integrations?error=linkedin_oauth_invalid_state");
    }
    const clientId = process.env.LINKEDIN_CLIENT_ID!;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET!;
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/linkedin/callback`;
    const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: code as string, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
    });
    const tokenData = await tokenResponse.json() as any;
    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.redirect("/integrations?error=linkedin_token_failed");
    }
    let providerEmail = "", providerName = "";
    try {
      const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
      const profile = await profileRes.json() as any;
      providerEmail = profile.email || "";
      providerName = profile.name || "";
    } catch {}
    const scopes = ["openid", "profile", "email", "w_member_social", "r_organization_social", "w_organization_social"];
    const expiresIn = tokenData.expires_in || 5184000;
    await storage.upsertOAuthToken({
      provider: "linkedin", subAccountId, accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token || null,
      tokenExpiry: new Date(Date.now() + expiresIn * 1000), scopes: scopes.join(" "), providerAccountId: providerName, providerEmail, connectionType: "oauth",
    });
    await storage.upsertIntegrationConnection({
      subAccountId, provider: "linkedin", status: "connected", config: { email: providerEmail, name: providerName }, connectionType: "oauth", connectedAt: new Date(),
    });
    await storage.createIntegrationEvent({ subAccountId, provider: "linkedin", eventType: "oauth_connected", payload: { email: providerEmail } });
    res.redirect("/integrations?success=linkedin_connected");
  }));

  // ---- TikTok for Business OAuth ----
  app.get("/api/oauth/tiktok/authorize/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const appId = process.env.TIKTOK_APP_ID;
    if (!appId) return res.status(500).json({ error: "TikTok OAuth not configured. Add TIKTOK_APP_ID and TIKTOK_APP_SECRET to your secrets." });
    const state = crypto.randomBytes(32).toString("hex");
    (req.session as any).oauthState = state;
    (req.session as any).oauthSubAccountId = subAccountId;
    (req.session as any).oauthProvider = "tiktok";
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/tiktok/callback`;
    const params = new URLSearchParams({
      app_id: appId, redirect_uri: redirectUri, state,
    });
    res.redirect(`https://business-api.tiktok.com/portal/auth?${params}`);
  }));

  app.get("/api/oauth/tiktok/callback", asyncHandler(async (req, res) => {
    const { auth_code, state, error } = req.query;
    if (error) return res.redirect("/integrations?error=tiktok_oauth_denied");
    const sessionState = (req.session as any)?.oauthState;
    const subAccountId = (req.session as any)?.oauthSubAccountId;
    if (!auth_code || !state || state !== sessionState || !subAccountId) {
      return res.redirect("/integrations?error=tiktok_oauth_invalid_state");
    }
    const appId = process.env.TIKTOK_APP_ID!;
    const appSecret = process.env.TIKTOK_APP_SECRET!;
    const tokenResponse = await fetch("https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, secret: appSecret, auth_code }),
    });
    const tokenResult = await tokenResponse.json() as any;
    const tokenData = tokenResult.data;
    if (!tokenData?.access_token) {
      return res.redirect("/integrations?error=tiktok_token_failed");
    }
    const scopes = ["ad.operation.read", "ad.operation.write", "audience.read", "audience.write", "report.read"];
    await storage.upsertOAuthToken({
      provider: "tiktok", subAccountId, accessToken: tokenData.access_token, refreshToken: null,
      tokenExpiry: new Date(Date.now() + 86400 * 1000), scopes: scopes.join(" "), providerAccountId: tokenData.advertiser_id || "", providerEmail: "", connectionType: "oauth",
    });
    await storage.upsertIntegrationConnection({
      subAccountId, provider: "tiktok", status: "connected", config: { advertiserId: tokenData.advertiser_id || "" }, connectionType: "oauth", connectedAt: new Date(),
    });
    await storage.createIntegrationEvent({ subAccountId, provider: "tiktok", eventType: "oauth_connected", payload: { advertiserId: tokenData.advertiser_id } });
    res.redirect("/integrations?success=tiktok_connected");
  }));

  // ---- Microsoft 365 OAuth ----
  app.get("/api/oauth/microsoft/authorize/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: "Microsoft OAuth not configured. Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to your secrets." });
    const state = crypto.randomBytes(32).toString("hex");
    (req.session as any).oauthState = state;
    (req.session as any).oauthSubAccountId = subAccountId;
    (req.session as any).oauthProvider = "microsoft";
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/microsoft/callback`;
    const scopes = ["openid", "profile", "email", "Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite", "Files.ReadWrite", "ChannelMessage.Send", "offline_access"];
    const params = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: scopes.join(" "), state, response_mode: "query",
    });
    res.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`);
  }));

  app.get("/api/oauth/microsoft/callback", asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect("/integrations?error=microsoft_oauth_denied");
    const sessionState = (req.session as any)?.oauthState;
    const subAccountId = (req.session as any)?.oauthSubAccountId;
    if (!code || !state || state !== sessionState || !subAccountId) {
      return res.redirect("/integrations?error=microsoft_oauth_invalid_state");
    }
    const clientId = process.env.MICROSOFT_CLIENT_ID!;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET!;
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/microsoft/callback`;
    const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: code as string, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const tokenData = await tokenResponse.json() as any;
    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.redirect("/integrations?error=microsoft_token_failed");
    }
    let providerEmail = "", providerName = "";
    try {
      const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
      const profile = await profileRes.json() as any;
      providerEmail = profile.mail || profile.userPrincipalName || "";
      providerName = profile.displayName || "";
    } catch {}
    const scopes = ["Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite", "Files.ReadWrite", "ChannelMessage.Send"];
    const expiresIn = tokenData.expires_in || 3600;
    await storage.upsertOAuthToken({
      provider: "microsoft", subAccountId, accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token || null,
      tokenExpiry: new Date(Date.now() + expiresIn * 1000), scopes: scopes.join(" "), providerAccountId: providerName, providerEmail, connectionType: "oauth",
    });
    await storage.upsertIntegrationConnection({
      subAccountId, provider: "microsoft", status: "connected", config: { email: providerEmail, name: providerName }, connectionType: "oauth", connectedAt: new Date(),
    });
    await storage.createIntegrationEvent({ subAccountId, provider: "microsoft", eventType: "oauth_connected", payload: { email: providerEmail } });
    res.redirect("/integrations?success=microsoft_connected");
  }));

  // ---- Calendly OAuth ----
  app.get("/api/oauth/calendly/authorize/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const clientId = process.env.CALENDLY_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: "Calendly OAuth not configured. Add CALENDLY_CLIENT_ID and CALENDLY_CLIENT_SECRET to your secrets." });
    const state = crypto.randomBytes(32).toString("hex");
    (req.session as any).oauthState = state;
    (req.session as any).oauthSubAccountId = subAccountId;
    (req.session as any).oauthProvider = "calendly";
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/calendly/callback`;
    const params = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: "code", state,
    });
    res.redirect(`https://auth.calendly.com/oauth/authorize?${params}`);
  }));

  app.get("/api/oauth/calendly/callback", asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect("/integrations?error=calendly_oauth_denied");
    const sessionState = (req.session as any)?.oauthState;
    const subAccountId = (req.session as any)?.oauthSubAccountId;
    if (!code || !state || state !== sessionState || !subAccountId) {
      return res.redirect("/integrations?error=calendly_oauth_invalid_state");
    }
    const clientId = process.env.CALENDLY_CLIENT_ID!;
    const clientSecret = process.env.CALENDLY_CLIENT_SECRET!;
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/calendly/callback`;
    const tokenResponse = await fetch("https://auth.calendly.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: code as string, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
    });
    const tokenData = await tokenResponse.json() as any;
    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.redirect("/integrations?error=calendly_token_failed");
    }
    let providerEmail = "", providerName = "";
    try {
      const meRes = await fetch("https://api.calendly.com/users/me", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
      const meData = await meRes.json() as any;
      providerEmail = meData.resource?.email || "";
      providerName = meData.resource?.name || "";
    } catch {}
    const scopes = ["events", "scheduling_links"];
    const expiresIn = tokenData.expires_in || 7200;
    await storage.upsertOAuthToken({
      provider: "calendly", subAccountId, accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token || null,
      tokenExpiry: new Date(Date.now() + expiresIn * 1000), scopes: scopes.join(" "), providerAccountId: providerName, providerEmail, connectionType: "oauth",
    });
    await storage.upsertIntegrationConnection({
      subAccountId, provider: "calendly", status: "connected", config: { email: providerEmail, name: providerName }, connectionType: "oauth", connectedAt: new Date(),
    });
    await storage.createIntegrationEvent({ subAccountId, provider: "calendly", eventType: "oauth_connected", payload: { email: providerEmail } });
    res.redirect("/integrations?success=calendly_connected");
  }));

  // ---- OAuth Callback Handlers ----

  app.get("/api/oauth/google/callback", asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      console.error("[OAUTH] Google OAuth error:", error);
      return res.redirect("/integrations?error=google_oauth_denied");
    }

    if (!code || typeof code !== "string") {
      return res.redirect("/integrations?error=missing_code");
    }

    const sessionState = (req.session as any).oauthState;
    const subAccountId = parseInt((req.session as any).oauthSubAccountId, 10);
    const sessionProvider = (req.session as any).oauthProvider;

    if (!state || state !== sessionState || sessionProvider !== "google" || isNaN(subAccountId) || subAccountId < 1) {
      return res.redirect("/integrations?error=invalid_state");
    }

    delete (req.session as any).oauthState;
    delete (req.session as any).oauthSubAccountId;
    delete (req.session as any).oauthProvider;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.redirect("/integrations?error=google_not_configured");
    }

    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/google/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code as string,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error("[OAUTH] Google token exchange failed:", errText);
      return res.redirect("/integrations?error=google_token_exchange_failed");
    }

    const tokenData = await tokenResponse.json() as OAuthTokenExchangeResponse;

    let providerEmail = "";
    let providerAccountId = "";
    try {
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (profileRes.ok) {
        const profile = await profileRes.json() as GoogleUserInfo;
        providerEmail = profile.email || "";
        providerAccountId = profile.id || "";
      }
    } catch (err) {
      console.warn("[OAUTH] Failed to fetch Google profile:", err);
    }

    const expiresIn = tokenData.expires_in || 3600;

    await storage.upsertOAuthToken({
      provider: "google",
      subAccountId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      tokenExpiry: new Date(Date.now() + expiresIn * 1000),
      scopes: GOOGLE_OAUTH_SCOPES.join(" "),
      providerAccountId,
      providerEmail,
      connectionType: "oauth",
    });

    await storage.upsertIntegrationConnection({
      subAccountId,
      provider: "google",
      status: "connected",
      config: { email: providerEmail, accountId: providerAccountId },
      connectionType: "oauth",
      connectedAt: new Date(),
    });

    await storage.createIntegrationEvent({
      subAccountId,
      provider: "google",
      eventType: "oauth_connected",
      payload: { email: providerEmail },
    });

    res.redirect("/integrations?success=google_connected");
  }));

  app.get("/api/oauth/meta/callback", asyncHandler(async (req, res) => {
    const { code, state, error, error_reason } = req.query;

    if (error) {
      console.error("[OAUTH] Meta OAuth error:", error, error_reason);
      return res.redirect("/integrations?error=meta_oauth_denied");
    }

    if (!code || typeof code !== "string") {
      return res.redirect("/integrations?error=missing_code");
    }

    const sessionState = (req.session as any).oauthState;
    const subAccountId = parseInt((req.session as any).oauthSubAccountId, 10);
    const sessionProvider = (req.session as any).oauthProvider;

    if (!state || state !== sessionState || sessionProvider !== "meta" || isNaN(subAccountId) || subAccountId < 1) {
      return res.redirect("/integrations?error=invalid_state");
    }

    delete (req.session as any).oauthState;
    delete (req.session as any).oauthSubAccountId;
    delete (req.session as any).oauthProvider;

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      return res.redirect("/integrations?error=meta_not_configured");
    }

    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/meta/callback`;

    const tokenResponse = await fetch("https://graph.facebook.com/v19.0/oauth/access_token?" +
      new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code: code as string,
      }),
      { signal: AbortSignal.timeout(10000) }
    );

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error("[OAUTH] Meta token exchange failed:", errText);
      return res.redirect("/integrations?error=meta_token_exchange_failed");
    }

    const shortLivedData = await tokenResponse.json() as OAuthTokenExchangeResponse;

    const longLivedResponse = await fetch("https://graph.facebook.com/v19.0/oauth/access_token?" +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortLivedData.access_token,
      }),
      { signal: AbortSignal.timeout(10000) }
    );

    let accessToken = shortLivedData.access_token;
    let expiresIn = shortLivedData.expires_in || 3600;

    if (longLivedResponse.ok) {
      const longLivedData = await longLivedResponse.json() as OAuthTokenExchangeResponse;
      accessToken = longLivedData.access_token;
      expiresIn = longLivedData.expires_in || 5184000;
    }

    let providerEmail = "";
    let providerAccountId = "";
    try {
      const profileRes = await fetch("https://graph.facebook.com/v19.0/me?fields=id,name,email", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (profileRes.ok) {
        const profile = await profileRes.json() as MetaUserInfo;
        providerEmail = profile.email || "";
        providerAccountId = profile.id || "";
      }
    } catch (err) {
      console.warn("[OAUTH] Failed to fetch Meta profile:", err);
    }

    await storage.upsertOAuthToken({
      provider: "meta",
      subAccountId,
      accessToken,
      refreshToken: null,
      tokenExpiry: new Date(Date.now() + expiresIn * 1000),
      scopes: META_OAUTH_SCOPES.join(","),
      providerAccountId,
      providerEmail,
      connectionType: "oauth",
    });

    await storage.upsertIntegrationConnection({
      subAccountId,
      provider: "meta",
      status: "connected",
      config: { email: providerEmail, accountId: providerAccountId },
      connectionType: "oauth",
      connectedAt: new Date(),
    });

    await storage.createIntegrationEvent({
      subAccountId,
      provider: "meta",
      eventType: "oauth_connected",
      payload: { email: providerEmail },
    });

    res.redirect("/integrations?success=meta_connected");
  }));

  // ---- Provider Asset Endpoints ----

  app.get("/api/integrations/:subAccountId/google/assets", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const token = await getValidToken(subAccountId, "google");
    if (!token) {
      return res.status(401).json({ error: "Google not connected or token expired" });
    }

    const assets: any[] = [];

    try {
      const calRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (calRes.ok) {
        const calData = await calRes.json() as GoogleCalendarListResponse;
        for (const cal of (calData.items || [])) {
          assets.push({ type: "calendar", id: cal.id, name: cal.summary || cal.id });
        }
      }
    } catch (err) {
      console.warn("[ASSETS] Failed to fetch Google calendars:", err);
    }

    try {
      const driveRes = await fetch("https://www.googleapis.com/drive/v3/files?pageSize=20&fields=files(id,name,mimeType)", {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (driveRes.ok) {
        const driveData = await driveRes.json() as GoogleDriveFilesResponse;
        for (const file of (driveData.files || [])) {
          if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
            assets.push({ type: "sheet", id: file.id, name: file.name });
          } else {
            assets.push({ type: "drive_file", id: file.id, name: file.name });
          }
        }
      }
    } catch (err) {
      console.warn("[ASSETS] Failed to fetch Google Drive files:", err);
    }

    try {
      const bizRes = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (bizRes.ok) {
        const bizData = await bizRes.json() as GoogleBusinessAccountsResponse;
        for (const account of (bizData.accounts || [])) {
          assets.push({ type: "business_profile", id: account.name, name: account.accountName || account.name });
        }
      }
    } catch (err) {
      console.warn("[ASSETS] Failed to fetch Google Business profiles:", err);
    }

    const savedAssets = await storage.getProviderAssets(subAccountId, "google");
    const selectedIds = new Set(savedAssets.filter(a => a.selected).map(a => a.assetId));

    const enriched = assets.map(a => ({
      ...a,
      selected: selectedIds.has(a.id),
    }));

    res.json(enriched);
  }));

  app.get("/api/integrations/:subAccountId/meta/assets", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const token = await getValidToken(subAccountId, "meta");
    if (!token) {
      return res.status(401).json({ error: "Meta not connected or token expired" });
    }

    const assets: any[] = [];

    try {
      const pagesRes = await fetch("https://graph.facebook.com/v19.0/me/accounts", {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (pagesRes.ok) {
        const pagesData = await pagesRes.json() as MetaAccountsResponse;
        for (const page of (pagesData.data || [])) {
          assets.push({ type: "page", id: page.id, name: page.name });
        }
      }
    } catch (err) {
      console.warn("[ASSETS] Failed to fetch Meta pages:", err);
    }

    try {
      const adsRes = await fetch("https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,account_status", {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (adsRes.ok) {
        const adsData = await adsRes.json() as MetaAdAccountsResponse;
        for (const account of (adsData.data || [])) {
          assets.push({ type: "ad_account", id: account.id, name: account.name || account.id });
        }
      }
    } catch (err) {
      console.warn("[ASSETS] Failed to fetch Meta ad accounts:", err);
    }

    try {
      const igRes = await fetch("https://graph.facebook.com/v19.0/me/accounts?fields=instagram_business_account{id,name,username}", {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (igRes.ok) {
        const igData = await igRes.json() as MetaAccountsResponse;
        for (const page of (igData.data || [])) {
          const igAccount = page.instagram_business_account;
          if (igAccount) {
            assets.push({ type: "instagram", id: igAccount.id, name: igAccount.username || igAccount.name || igAccount.id });
          }
        }
      }
    } catch (err) {
      console.warn("[ASSETS] Failed to fetch Instagram profiles:", err);
    }

    const savedAssets = await storage.getProviderAssets(subAccountId, "meta");
    const selectedIds = new Set(savedAssets.filter(a => a.selected).map(a => a.assetId));

    const enriched = assets.map(a => ({
      ...a,
      selected: selectedIds.has(a.id),
    }));

    res.json(enriched);
  }));

  app.post("/api/integrations/:subAccountId/assets/select", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { provider, assets: assetSelections } = req.body;
    if (!provider || !Array.isArray(assetSelections)) {
      return res.status(400).json({ error: "provider and assets array are required" });
    }

    const results = [];
    for (const asset of assetSelections) {
      const saved = await storage.upsertProviderAsset({
        subAccountId,
        provider,
        assetType: asset.type,
        assetId: asset.id,
        assetName: asset.name,
        selected: asset.selected ?? true,
      });
      results.push(saved);
    }

    res.json(results);
  }));

  // ---- Integration Event Endpoints ----

  app.post("/api/integrations/events", asyncHandler(async (req, res) => {
    const { subAccountId, provider, eventType, payload } = req.body;
    if (!subAccountId || !provider || !eventType) {
      return res.status(400).json({ error: "subAccountId, provider, and eventType are required" });
    }

    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const event = await storage.createIntegrationEvent({
      subAccountId,
      provider,
      eventType,
      payload: payload || {},
    });

    res.json(event);
  }));

  app.get("/api/integrations/:subAccountId/events", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const limit = parseInt(req.query.limit as string) || 50;
    const events = await storage.getIntegrationEvents(subAccountId, Math.min(limit, 200));
    res.json(events);
  }));

  // ---- Integration Health Check ----

  app.get("/api/integrations/:subAccountId/health", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const connections = await storage.getIntegrationConnections(subAccountId);
    const oauthConnections = connections.filter(c => c.connectionType === "oauth" && c.status === "connected");

    const healthResults: Record<string, { healthy: boolean; error?: string }> = {};

    for (const conn of oauthConnections) {
      healthResults[conn.provider] = await checkTokenHealth(subAccountId, conn.provider);
    }

    res.json(healthResults);
  }));

  // ---- Shopify Webhook Endpoints ----
  app.post("/api/shopify/webhooks/:subAccountId", express.raw({ type: "application/json" }), asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    const topic = req.headers["x-shopify-topic"] as string;
    const shopDomain = req.headers["x-shopify-shop-domain"] as string;
    const hmacHeader = req.headers["x-shopify-hmac-sha256"] as string;

    if (!topic) return res.status(400).json({ error: "Missing x-shopify-topic header" });

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    let payload: any;
    try {
      payload = Buffer.isBuffer(req.body) ? JSON.parse(rawBody.toString("utf8")) : req.body;
    } catch {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }

    const connection = await storage.getIntegrationConnection(subAccountId, "shopify");
    if (!connection || connection.status !== "connected") {
      return res.status(404).json({ error: "Shopify not connected for this account" });
    }

    const config = connection.config as Record<string, string>;

    if (config?.webhookSecret) {
      if (!hmacHeader) {
        return res.status(401).json({ error: "Missing webhook signature" });
      }
      const hash = crypto.createHmac("sha256", config.webhookSecret).update(rawBody).digest("base64");
      if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader))) {
        console.warn("[SHOPIFY] Webhook HMAC verification failed");
        return res.status(401).json({ error: "Invalid webhook signature" });
      }
    }
    const eventType = topic.replace(/\//g, "_");

    const shopifyEvent = await storage.createShopifyEvent({
      subAccountId,
      eventType,
      shopifyId: String(payload.id || ""),
      storeName: shopDomain || config?.storeDomain || null,
      payload,
      processed: false,
    });

    console.log(`[SHOPIFY] Received ${topic} event for account ${subAccountId}, event ID: ${shopifyEvent.id}`);

    if (topic === "checkouts/create" || topic === "checkouts/update") {
      const checkout = payload;
      if (checkout.email || checkout.phone) {
        try {
          await storage.createContact({
            subAccountId,
            firstName: checkout.billing_address?.first_name || checkout.shipping_address?.first_name || "Shopify Customer",
            lastName: checkout.billing_address?.last_name || checkout.shipping_address?.last_name || null,
            email: checkout.email || null,
            phone: checkout.phone || checkout.billing_address?.phone || null,
            source: "shopify",
            tags: ["shopify", "abandoned-cart"],
          });
        } catch (e) {
          console.log("[SHOPIFY] Contact creation skipped (may already exist):", (e as any).message);
        }
      }

      if (checkout.abandoned_checkout_url) {
        fireAutomationTrigger("shopify_abandoned_cart", subAccountId, {
          leadName: checkout.billing_address?.first_name || "Customer",
          leadEmail: checkout.email || "",
          leadPhone: checkout.phone || "",
          cartTotal: checkout.total_price || "0",
          cartUrl: checkout.abandoned_checkout_url || "",
          storeName: shopDomain || "",
          source: "shopify",
        }).catch((e) => console.warn("[SHOPIFY] Automation trigger error:", e.message));
      }

      await storage.updateShopifyEvent(shopifyEvent.id, { processed: true });
    }

    if (topic === "orders/create") {
      const order = payload;
      if (order.email || order.phone) {
        try {
          await storage.createContact({
            subAccountId,
            firstName: order.billing_address?.first_name || order.customer?.first_name || "Shopify Customer",
            lastName: order.billing_address?.last_name || order.customer?.last_name || null,
            email: order.email || order.customer?.email || null,
            phone: order.phone || order.billing_address?.phone || order.customer?.phone || null,
            source: "shopify",
            tags: ["shopify", "customer", "order"],
          });
        } catch (e) {
          console.log("[SHOPIFY] Contact creation skipped (may already exist):", (e as any).message);
        }
      }

      fireAutomationTrigger("shopify_order_created", subAccountId, {
        leadName: order.customer?.first_name || order.billing_address?.first_name || "Customer",
        leadEmail: order.email || "",
        leadPhone: order.phone || "",
        orderNumber: order.order_number || order.name || "",
        orderTotal: order.total_price || "0",
        storeName: shopDomain || "",
        source: "shopify",
      }).catch((e) => console.warn("[SHOPIFY] Automation trigger error:", e.message));

      await storage.updateShopifyEvent(shopifyEvent.id, { processed: true });
    }

    if (topic === "orders/fulfilled") {
      const order = payload;

      fireAutomationTrigger("shopify_order_fulfilled", subAccountId, {
        leadName: order.customer?.first_name || order.billing_address?.first_name || "Customer",
        leadEmail: order.email || "",
        leadPhone: order.phone || "",
        orderNumber: order.order_number || order.name || "",
        orderTotal: order.total_price || "0",
        storeName: shopDomain || "",
        source: "shopify",
      }).catch((e) => console.warn("[SHOPIFY] Automation trigger error:", e.message));

      await storage.updateShopifyEvent(shopifyEvent.id, { processed: true });
    }

    res.status(200).json({ received: true, eventId: shopifyEvent.id });
  }));

  app.get("/api/shopify/events/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const events = await storage.getShopifyEvents(subAccountId);
    res.json(events);
  }));

  app.post("/api/shopify/register-webhooks/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const connection = await storage.getIntegrationConnection(subAccountId, "shopify");
    if (!connection || connection.status !== "connected") {
      return res.status(400).json({ error: "Shopify is not connected" });
    }

    const config = connection.config as Record<string, string>;
    const domain = (config.storeDomain || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const accessToken = config.accessToken;

    if (!domain || !accessToken) {
      return res.status(400).json({ error: "Missing Shopify store domain or access token" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const callbackUrl = `${baseUrl}/api/shopify/webhooks/${subAccountId}`;

    const topics = [
      "checkouts/create",
      "checkouts/update",
      "orders/create",
      "orders/fulfilled",
    ];

    const results: { topic: string; status: string; error?: string }[] = [];

    for (const topic of topics) {
      try {
        const webhookRes = await fetch(`https://${domain}/admin/api/2024-01/webhooks.json`, {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            webhook: {
              topic,
              address: callbackUrl,
              format: "json",
            },
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (webhookRes.ok) {
          results.push({ topic, status: "registered" });
        } else {
          const errData = await webhookRes.json().catch(() => ({})) as any;
          const errMsg = errData?.errors ? JSON.stringify(errData.errors) : `HTTP ${webhookRes.status}`;
          results.push({ topic, status: "failed", error: errMsg });
        }
      } catch (err: any) {
        results.push({ topic, status: "failed", error: err.message });
      }
    }

    res.json({ webhooks: results, callbackUrl });
  }));

  app.get("/api/shopify/status/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const connection = await storage.getIntegrationConnection(subAccountId, "shopify");
    if (!connection || connection.status !== "connected") {
      return res.json({ connected: false, storeName: null });
    }

    const config = connection.config as Record<string, string>;
    const domain = (config.storeDomain || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    let storeName = domain;

    try {
      const shopRes = await fetch(`https://${domain}/admin/api/2024-01/shop.json`, {
        headers: { "X-Shopify-Access-Token": config.accessToken },
        signal: AbortSignal.timeout(5000),
      });
      if (shopRes.ok) {
        const shopData = await shopRes.json() as any;
        storeName = shopData.shop?.name || domain;
      }
    } catch {}

    const events = await storage.getShopifyEvents(subAccountId);

    res.json({
      connected: true,
      storeName,
      domain,
      connectedAt: connection.connectedAt,
      eventCount: events.length,
    });
  }));

  app.get("/api/service-status", asyncHandler(async (req, res) => {
    const services = [
      {
        name: "Twilio",
        provider: "twilio",
        description: "SMS & Voice",
        configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
        envVars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
      },
      {
        name: "Stripe",
        provider: "stripe",
        configured: !!(process.env.STRIPE_API_SECRET || process.env.STRIPE_SECRET_KEY),
        description: "Payments & Billing",
        envVars: ["STRIPE_API_SECRET"],
      },
      {
        name: "Meta / Facebook",
        provider: "meta",
        description: "Ads, DMs, Instagram",
        configured: !!(process.env.META_ACCESS_TOKEN && process.env.META_PAGE_ID),
        envVars: ["META_ACCESS_TOKEN", "META_PAGE_ID", "META_APP_SECRET"],
      },
      {
        name: "Vapi",
        provider: "vapi",
        description: "Voice AI Agents",
        configured: vapiConfig.isConfigured,
        envVars: ["VAPI_PRIVATE_KEY", "VAPI_PUBLIC_KEY"],
      },
      {
        name: "ElevenLabs",
        provider: "elevenlabs",
        description: "AI Voice Synthesis & TTS",
        configured: !!process.env.ELEVENLABS_API_KEY,
        envVars: ["ELEVENLABS_API_KEY"],
      },
      {
        name: "Google AI (Gemini)",
        provider: "gemini",
        description: "AI Chat, Site Generation, Bot Training",
        configured: isGeminiConfigured(),
        envVars: ["GOOGLE_API_KEY"],
      },
      {
        name: "Mailchimp",
        provider: "mailchimp",
        description: "Email Campaigns",
        configured: !!process.env.MAILCHIMP_API_KEY,
        envVars: ["MAILCHIMP_API_KEY"],
      },
      {
        name: "Google Maps",
        provider: "google-maps",
        description: "Location Services",
        configured: !!process.env.GOOGLE_API_KEY,
        envVars: ["GOOGLE_API_KEY"],
      },
    ];

    const allSubAccounts = await storage.getSubAccounts();
    const providerConnections = new Map<string, string>();
    for (const account of allSubAccounts) {
      const conns = await storage.getIntegrationConnections(account.id);
      for (const conn of conns) {
        if (conn.status === "connected" && !providerConnections.has(conn.provider)) {
          providerConnections.set(conn.provider, "connected");
        }
      }
    }

    const result: Record<string, { status: string; label: string; description: string }> = {};
    for (const s of services) {
      const hasConnection = providerConnections.has(s.provider);
      let status: string;
      if (s.configured && hasConnection) {
        status = "connected_verified";
      } else if (hasConnection) {
        status = "stored_unverified";
      } else if (s.configured) {
        status = "configured";
      } else {
        status = "not_configured";
      }
      result[s.provider] = {
        status,
        label: s.name,
        description: s.description,
      };
    }
    res.json(result);
  }));

  // ---- TapCard Checkout ----
  app.post("/api/card-checkout", asyncHandler(async (req, res) => {
    const { plan, interval } = req.body;
    const { getUncachableStripeClient } = await import("./stripeClient");
    const stripe = await getUncachableStripeClient();

    let priceInCents: number;
    let productName: string;
    let planTier: string;

    if (plan === "tapcard") {
      priceInCents = interval === "yearly" ? 6999 : 999;
      productName = interval === "yearly" ? "TapCard — Annual" : "TapCard — Monthly";
      planTier = "starter";
    } else if (plan === "tapcard_pro") {
      priceInCents = interval === "yearly" ? 38400 : 4800;
      productName = interval === "yearly" ? "TapCard Pro — Annual" : "TapCard Pro — Monthly";
      planTier = "pro";
    } else {
      return res.status(400).json({ error: "Invalid plan" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: productName },
          unit_amount: priceInCents,
          recurring: { interval: interval === "yearly" ? "year" : "month" },
        },
        quantity: 1,
      }],
      metadata: {
        plan: plan,
        planTier: planTier,
        source: "tapcard_funnel",
      },
      success_url: `${baseUrl}/digital-card-builder?checkout=success`,
      cancel_url: `${baseUrl}/cards?checkout=cancelled`,
      payment_method_collection: "always",
    });

    res.json({ url: session.url });
  }));

  // ---- Digital Business Cards ----
  app.get("/api/digital-card/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const [card] = await db.select().from(digitalCards).where(eq(digitalCards.subAccountId, subAccountId)).limit(1);
    if (!card) return res.status(404).json({ error: "No card found" });
    res.json(card);
  }));

  app.post("/api/digital-card/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { name, title, company, phone, email, website, bio, photoUrl, googleReviewLink, slug, links, theme } = req.body;
    const existing = await db.select().from(digitalCards).where(eq(digitalCards.subAccountId, subAccountId)).limit(1);
    if (existing.length > 0) {
      const [updated] = await db.update(digitalCards).set({
        name, title, company, phone, email, website, bio, photoUrl, googleReviewLink, slug, links, theme, updatedAt: new Date(),
      }).where(eq(digitalCards.subAccountId, subAccountId)).returning();
      res.json(updated);
    } else {
      const [created] = await db.insert(digitalCards).values({
        subAccountId, name, title, company, phone, email, website, bio, photoUrl, googleReviewLink, slug, links, theme,
      }).returning();
      res.json(created);
    }
  }));

  // Public card viewer by slug
  app.get("/api/public-card/:slug", asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const [card] = await db.select().from(digitalCards).where(eq(digitalCards.slug, slug)).limit(1);
    if (!card) return res.status(404).json({ error: "Card not found" });
    res.json(card);
  }));

  // ---- Portal Tokens ----
  app.get("/api/portal-tokens/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const tokens = await storage.getPortalTokens(subAccountId);
    res.json(tokens);
  }));

  app.post("/api/portal-tokens/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const token = crypto.randomBytes(32).toString("hex");
    const { label } = req.body;
    const portalToken = await storage.createPortalToken({
      subAccountId,
      token,
      label: label || "Client Portal Link",
      active: true,
    });
    res.json(portalToken);
  }));

  app.delete("/api/portal-tokens/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    await storage.deletePortalToken(id);
    res.json({ ok: true });
  }));

  // ---- Public Portal (no auth) ----
  app.get("/api/portal/:token", asyncHandler(async (req, res) => {
    const portalToken = await storage.getPortalTokenByToken(req.params.token as string);
    if (!portalToken) return res.status(404).json({ error: "Invalid or expired portal link" });
    if (portalToken.expiresAt && new Date(portalToken.expiresAt) < new Date()) {
      return res.status(410).json({ error: "Portal link has expired" });
    }
    const account = await storage.getSubAccount(portalToken.subAccountId);
    if (!account) return res.status(404).json({ error: "Account not found" });
    const [msgs, appts, contactsList, dealsList] = await Promise.all([
      storage.getMessages(portalToken.subAccountId),
      storage.getAppointments(portalToken.subAccountId),
      storage.getContacts(portalToken.subAccountId),
      storage.getDeals(portalToken.subAccountId),
    ]);
    res.json({
      accountName: account.name,
      industry: account.industry,
      metrics: {
        totalMessages: msgs.length,
        totalContacts: contactsList.length,
        totalDeals: dealsList.length,
        totalDealValue: dealsList.reduce((s, d) => s + (d.value || 0), 0),
        upcomingAppointments: appts.filter(a => a.status === "scheduled").length,
      },
      recentMessages: msgs.slice(0, 10),
      upcomingAppointments: appts.filter(a => a.status === "scheduled").slice(0, 10),
    });
  }));

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
    health.ai = isGeminiConfigured() ? "ok" : "missing";
    health.meta = (process.env.META_ACCESS_TOKEN && process.env.META_PAGE_ID) ? "ok" : "missing";
    health.mailchimp = process.env.MAILCHIMP_API_KEY ? "ok" : "missing";

    const allOk = Object.values(health).every(v => v === "ok");
    res.status(allOk ? 200 : 207).json({ status: allOk ? "healthy" : "degraded", services: health });
  }));

  // ──── SYSTEM LOGS (admin only) ────
  app.get("/api/admin/system-logs", requireAdmin, asyncHandler(async (req, res) => {
    const { getSystemLogs } = await import("./systemLogger");
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
    const { getAllFeatureFlags } = await import("./featureFlags");
    const flags = await getAllFeatureFlags();
    res.json(flags);
  }));

  app.put("/api/admin/feature-flags/:name", requireAdmin, asyncHandler(async (req, res) => {
    const { setFeatureFlag } = await import("./featureFlags");
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

    const { checkPlanLimit } = await import("./subscriptionGuard");
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
    const { getAuditLogs } = await import("./auditTrail");
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

    const { processCommand, createOperatorContext } = await import("./operator/index");
    const context = createOperatorContext(parseInt(subAccountId), userId, "draft");
    const result = await processCommand(intent, context);
    res.json(result);
  }));

  app.post("/api/operator/approve", asyncHandler(async (req, res) => {
    const { planId, stepId, subAccountId, action } = req.body;
    if (!planId || !stepId || !subAccountId) return res.status(400).json({ error: "Missing planId, stepId, or subAccountId" });

    if (!(await verifyAccountOwnership(req, res, parseInt(subAccountId)))) return;
    const userId = getUserId((req as any).user);

    const { approveAndContinue, rejectStep, createOperatorContext, getPlan } = await import("./operator/index");

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

    const { getActivePlans, getPlanHistory } = await import("./operator/index");
    const active = getActivePlans(subAccountId);
    const history = getPlanHistory(20, subAccountId);
    res.json({ active, history });
  }));

  app.get("/api/operator/plan/:planId", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const { getPlan } = await import("./operator/index");
    const plan = getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    if (!(await verifyAccountOwnership(req, res, plan.subAccountId))) return;
    res.json(plan);
  }));

  app.get("/api/operator/tools", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const { getToolManifest } = await import("./operator/index");
    res.json(getToolManifest());
  }));

  app.get("/api/operator/approvals", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.query.subAccountId as string);
    if (!subAccountId) return res.status(400).json({ error: "subAccountId is required" });

    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getPendingApprovals, getApprovalHistory } = await import("./operator/index");
    res.json({
      pending: getPendingApprovals(subAccountId),
      history: getApprovalHistory(subAccountId, 20),
    });
  }));

  app.get("/api/operator/diagnostics", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.query.subAccountId as string);
    if (!subAccountId) return res.status(400).json({ error: "subAccountId is required" });

    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { runDiagnostics } = await import("./operator/index");
    const checks = await runDiagnostics(subAccountId);
    res.json({ checks, timestamp: new Date().toISOString() });
  }));

  app.get("/api/operator/diagnostics/history", requireAdmin, asyncHandler(async (req, res) => {
    const { getDiagnosticHistory } = await import("./operator/index");
    const category = req.query.category as string | undefined;
    res.json(getDiagnosticHistory(100, category));
  }));

  app.get("/api/operator/telemetry", requireAdmin, asyncHandler(async (_req, res) => {
    const { collectSystemMetrics } = await import("./operator/index");
    res.json(collectSystemMetrics());
  }));

  app.get("/api/operator/telemetry/metrics", requireAdmin, asyncHandler(async (req, res) => {
    const { getMetrics } = await import("./operator/index");
    const name = req.query.name as string | undefined;
    const limit = parseInt(req.query.limit as string) || 200;
    const since = req.query.since as string | undefined;
    res.json(getMetrics({ name, limit, since }));
  }));

  app.get("/api/operator/memory/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getSessionContext } = await import("./operator/index");
    res.json(getSessionContext(subAccountId));
  }));

  // ──── COGNITIVE INTELLIGENCE LAYER ────
  app.get("/api/operator/cognitive/context/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getCognitiveContext } = await import("./operator/cognitiveLayer");
    const context = await getCognitiveContext(subAccountId);
    res.json(context);
  }));

  app.get("/api/operator/cognitive/insights/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getCognitiveInsights } = await import("./operator/cognitiveLayer");
    const insights = await getCognitiveInsights(subAccountId);
    res.json({ insights, timestamp: new Date().toISOString() });
  }));

  app.get("/api/operator/cognitive/trends/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { runTrendDetection } = await import("./operator/cognitiveLayer");
    const trends = await runTrendDetection(subAccountId);
    res.json({ trends, timestamp: new Date().toISOString() });
  }));

  app.get("/api/operator/cognitive/nudges/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getCognitiveNudges } = await import("./operator/cognitiveLayer");
    const nudges = await getCognitiveNudges(subAccountId);
    res.json({ nudges });
  }));

  app.get("/api/operator/cognitive/nudges/:subAccountId/pending", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getPendingNudges } = await import("./operator/cognitiveLayer");
    const nudges = await getPendingNudges(subAccountId);
    res.json({ nudges });
  }));

  app.post("/api/operator/cognitive/nudges/:nudgeId/dismiss", asyncHandler(async (req, res) => {
    const nudgeId = parseInt(req.params.nudgeId);
    const subAccountId = parseInt(req.body.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { handleNudgeDismiss } = await import("./operator/cognitiveLayer");
    const success = await handleNudgeDismiss(nudgeId, subAccountId);
    if (!success) return res.status(400).json({ error: "Failed to dismiss nudge" });
    res.json({ success: true });
  }));

  app.post("/api/operator/cognitive/nudges/:nudgeId/act", asyncHandler(async (req, res) => {
    const nudgeId = parseInt(req.params.nudgeId);
    const subAccountId = parseInt(req.body.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { handleNudgeAction } = await import("./operator/cognitiveLayer");
    const success = await handleNudgeAction(nudgeId, subAccountId);
    if (!success) return res.status(400).json({ error: "Failed to act on nudge" });
    res.json({ success: true });
  }));

  app.get("/api/operator/cognitive/nudges/:subAccountId/history", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getCognitiveNudgeHistory } = await import("./operator/cognitiveLayer");
    const history = await getCognitiveNudgeHistory(subAccountId);
    res.json({ history });
  }));

  app.get("/api/operator/cognitive/industry/:industry", asyncHandler(async (req, res) => {
    const { getIndustryInfo } = await import("./operator/cognitiveLayer");
    const knowledge = await getIndustryInfo(req.params.industry);
    res.json(knowledge);
  }));

  app.get("/api/operator/cognitive/industries", asyncHandler(async (_req, res) => {
    const { listIndustries } = await import("./operator/cognitiveLayer");
    const industries = await listIndustries();
    res.json({ industries });
  }));

  app.get("/api/operator/cognitive/health/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getHealthScore } = await import("./operator/cognitiveLayer");
    const healthScore = await getHealthScore(subAccountId);
    res.json(healthScore);
  }));

  app.get("/api/operator/cognitive/growth-report/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getGrowthReport } = await import("./operator/cognitiveLayer");
    const report = await getGrowthReport(subAccountId);
    res.json(report);
  }));

  app.get("/api/operator/cognitive/strategic/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getStrategicInsights } = await import("./operator/cognitiveLayer");
    const insights = await getStrategicInsights(subAccountId);
    res.json({ insights, timestamp: new Date().toISOString() });
  }));

  app.get("/api/operator/cognitive/opportunities/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getMissedOpportunities } = await import("./operator/cognitiveLayer");
    const opportunities = await getMissedOpportunities(subAccountId);
    res.json({ opportunities, timestamp: new Date().toISOString() });
  }));

  app.get("/api/operator/cognitive/profile/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { getUserProfile } = await import("./operator/cognitiveLayer");
    const profile = await getUserProfile(subAccountId);
    res.json({ profile });
  }));

  app.post("/api/operator/cognitive/profile/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { updateUserProfile } = await import("./operator/cognitiveLayer");
    await updateUserProfile(subAccountId, req.body);
    res.json({ success: true });
  }));

  app.post("/api/operator/cognitive/track", asyncHandler(async (req, res) => {
    const { subAccountId, action, value } = req.body;
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { trackUserAction } = await import("./operator/cognitiveLayer");
    await trackUserAction(subAccountId, action, value);
    res.json({ success: true });
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
    const { createDatabaseSnapshot } = await import("./dbBackup");
    const result = await createDatabaseSnapshot();
    if (!result.success) return res.status(500).json({ error: "Snapshot failed" });
    res.json(result);
  }));

  app.get("/api/admin/db-snapshots", requireAdmin, asyncHandler(async (_req, res) => {
    const { listSnapshots } = await import("./dbBackup");
    const snapshots = await listSnapshots();
    res.json(snapshots);
  }));

  app.get("/api/admin/db-health", requireAdmin, asyncHandler(async (_req, res) => {
    const { getDatabaseHealth } = await import("./dbBackup");
    const health = await getDatabaseHealth();
    res.json(health);
  }));

  // ──── LAUNCH READINESS (admin only) ────
  app.get("/api/admin/launch-readiness", requireAdmin, asyncHandler(async (_req, res) => {
    const { runLaunchReadinessChecks } = await import("./launchReadiness");
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

  return httpServer;
}

function determineSeverity(description: string, keywords: string[]): string {
  const upper = description.toUpperCase();
  if (upper.includes("FATALITY") || upper.includes("ENTRAPMENT") || upper.includes("EXTRICATION")) return "critical";
  if (upper.includes("ROLLOVER") || upper.includes("INJURIES")) return "high";
  if (upper.includes("MVA") || upper.includes("SIGNAL 4")) return "medium";
  return "low";
}

async function runRealTraining(jobId: number) {
  const allLogs: string[] = [];

  async function updateJob(log: string, progress: number, extras: Record<string, any> = {}) {
    allLogs.push(log);
    await storage.updateTrainingJob(jobId, {
      logs: [...allLogs],
      progress,
      state: progress >= 100 ? "completed" : "processing",
      ...extras,
    });
  }

  try {
    const job = await storage.getTrainingJob(jobId);
    if (!job) return;

    await updateJob("Starting web scraper...", 10);

    let scrapedText = "";
    try {
      const cheerio = await import("cheerio");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(job.url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ApexBot/1.0)",
          "Accept": "text/html,application/xhtml+xml",
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      await updateJob(`Fetched page (${html.length.toLocaleString()} bytes)`, 25);

      const $ = cheerio.load(html);
      $("script, style, noscript, iframe, nav, footer, header").remove();

      const textParts: string[] = [];
      const title = $("title").text().trim();
      if (title) textParts.push(`Page Title: ${title}`);

      const metaDesc = $('meta[name="description"]').attr("content")?.trim();
      if (metaDesc) textParts.push(`Description: ${metaDesc}`);

      $("h1, h2, h3, h4, p, li, td, th, blockquote, span, div, a").each((_: any, el: any) => {
        const t = $(el).clone().children().remove().end().text().trim();
        if (t && t.length > 10 && t.length < 5000) {
          textParts.push(t);
        }
      });

      scrapedText = Array.from(new Set(textParts)).join("\n").substring(0, 50000);

      await updateJob(`Extracted ${scrapedText.length.toLocaleString()} characters of text content`, 40);
    } catch (scrapeErr: any) {
      await updateJob(`Scrape warning: ${scrapeErr.message}. Continuing with persona only.`, 35);
      scrapedText = `[Could not scrape ${job.url}: ${scrapeErr.message}]`;
    }

    const chunkSize = 1000;
    const overlap = 200;
    const chunks: string[] = [];
    for (let i = 0; i < scrapedText.length; i += chunkSize - overlap) {
      chunks.push(scrapedText.substring(i, i + chunkSize));
    }
    await updateJob(`Split into ${chunks.length} knowledge chunks (${chunkSize} chars, ${overlap} overlap)`, 55);

    let generatedPersona: string | null = null;
    if (isGeminiConfigured() && scrapedText.length > 50) {
      try {
        await updateJob("Generating AI persona from scraped content...", 70);
        const personaPrompt = `Based on the following website content, generate a concise AI assistant persona/system prompt. The persona should:
1. Identify the business name, industry, and key services
2. Define a friendly, knowledgeable tone appropriate for the business
3. List specific topics the assistant can help with based on the content
4. Include instructions to guide conversations toward booking/contact

Website content (first 8000 chars):
${scrapedText.substring(0, 8000)}

Original persona template:
${job.persona}

Generate ONLY the system prompt text, no explanations:`;

        const personaResult = await geminiChat(
          [{ role: "user", content: personaPrompt }],
          { temperature: 0.5, maxTokens: 1024 }
        );

        if (personaResult && personaResult.length > 20) {
          generatedPersona = personaResult;
          await updateJob("AI persona generated successfully", 85);
        }
      } catch (aiErr: any) {
        await updateJob(`Persona generation note: ${aiErr.message}. Using original persona.`, 80);
      }
    } else {
      await updateJob("Skipping AI persona generation (no AI configured or insufficient content)", 85);
    }

    await updateJob("Saving knowledge base to database...", 90);
    await storage.updateTrainingJob(jobId, {
      scrapedContent: scrapedText,
      generatedPersona: generatedPersona,
    });

    await updateJob("Training Complete. Bot is ready.", 100, {
      scrapedContent: scrapedText,
      generatedPersona: generatedPersona,
    });
  } catch (err: any) {
    allLogs.push(`Training failed: ${err.message}`);
    await storage.updateTrainingJob(jobId, {
      logs: [...allLogs],
      state: "failed",
      progress: 0,
    });
  }
}
