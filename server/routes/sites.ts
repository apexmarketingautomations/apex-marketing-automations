import type { Express, Request, Response } from "express";
import { insertSavedSiteSchema, reviews } from "@shared/schema";
import { storage } from "../storage";
import { z } from "zod";
import { aiChat, isAIConfigured } from "../aiGateway";
import express from "express";
import { asyncHandler, parseIntParam, logUsageInternal } from "./helpers";
import { emitUniversalEvent, emitWithTimeline, EVENT_TYPES } from "../intelligence/eventEmitter";

const MAX_CODE_BYTES_PER_SECTION = 200_000;
const MAX_CODE_BYTES_PER_SITE = 1_000_000;
const MALICIOUS_CODE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /coinhive|cryptonight|webminerpool|minexmr|deepminer|coin-hive|cryptoloot|jsecoin/i, label: "cryptocurrency mining script" },
  { pattern: /eval\s*\(\s*atob\s*\(/i, label: "obfuscated eval(atob(...)) payload" },
  { pattern: /eval\s*\(\s*String\.fromCharCode/i, label: "obfuscated eval(String.fromCharCode(...)) payload" },
  { pattern: /document\.write\s*\(\s*unescape/i, label: "document.write(unescape(...)) injection" },
  { pattern: /new\s+Function\s*\(\s*atob/i, label: "new Function(atob(...)) payload" },
  { pattern: /<script[^>]+src\s*=\s*["'][^"']*\.(ru|cn|tk|ml|ga|cf|gq)\/[^"']*\.js/i, label: "external script from a high-risk TLD" },
];

function scanCodeBlob(code: string): { ok: true } | { ok: false; reason: string } {
  if (typeof code !== "string") return { ok: true };
  if (code.length > MAX_CODE_BYTES_PER_SECTION) {
    return { ok: false, reason: `Custom code is too large (max ${Math.floor(MAX_CODE_BYTES_PER_SECTION / 1000)}KB per section).` };
  }
  for (const { pattern, label } of MALICIOUS_CODE_PATTERNS) {
    if (pattern.test(code)) {
      return { ok: false, reason: `Custom code blocked: detected ${label}. Remove it and try again.` };
    }
  }
  return { ok: true };
}

function scanSiteForMaliciousCode(siteData: any): { ok: true } | { ok: false; reason: string } {
  if (!siteData || typeof siteData !== "object") return { ok: true };
  const directSections: any[] = Array.isArray(siteData.sections) ? siteData.sections : [];
  const pageSections: any[] = Array.isArray(siteData.pages)
    ? siteData.pages.flatMap((p: any) => (Array.isArray(p?.sections) ? p.sections : []))
    : [];
  const sections = [...directSections, ...pageSections];
  let totalBytes = 0;
  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    if (section.type === "CODE" || section.type === "BOT_EMBED") {
      const code = section.props?.code || "";
      const result = scanCodeBlob(code);
      if (!result.ok) return result;
      totalBytes += typeof code === "string" ? code.length : 0;
    }
  }
  if (totalBytes > MAX_CODE_BYTES_PER_SITE) {
    return { ok: false, reason: `Total custom code across all sections exceeds the ${Math.floor(MAX_CODE_BYTES_PER_SITE / 1000)}KB site limit.` };
  }
  return { ok: true };
}

function renderSiteSection(section: any, theme: any): string {
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
    case "CODE":
    case "BOT_EMBED": {
      const userCode = String(p.code || "");
      const escapedSrcDoc = `<!DOCTYPE html><html><head><style>body{margin:0;font-family:system-ui,sans-serif;}</style></head><body>${userCode}</body></html>`
        .replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      return `<section style="padding:0;background:${theme.bg}">
        <iframe srcdoc="${escapedSrcDoc}" sandbox="allow-scripts" style="border:0;width:100%;min-height:80vh;display:block;background:white" loading="lazy"></iframe>
      </section>`;
    }
    default:
      return `<section style="padding:60px 24px;text-align:center;background:${theme.bg}">
        <h2 style="font-size:1.5rem;font-weight:700;font-family:${theme.font}">${p.title || section.type}</h2>
        ${p.subtitle ? `<p style="opacity:0.7;margin-top:12px">${p.subtitle}</p>` : ''}
      </section>`;
  }
}

export async function renderSiteHtml(siteId: number, res: Response): Promise<void> {
  const site = await storage.getSavedSite(siteId);
  if (!site) {
    res.status(404).send("<html><body style='background:#0f172a;color:white;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui'><h1>Site not found</h1></body></html>");
    return;
  }

  const data = site.siteData as any;

  // ── Vibe Site: serve raw AI-generated HTML directly ──
  if (data?.type === "vibe" && typeof data?.html === "string" && data.html.length > 0) {
    if (!site.publishedUrl) {
      await storage.updateSavedSite(siteId, { publishedUrl: `/live/${siteId}` });
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.send(data.html);
    return;
  }

  if (!data?.theme || !Array.isArray(data?.sections)) {
    res.status(400).send("<html><body style='background:#0f172a;color:white;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui'><h1>Invalid site data</h1></body></html>");
    return;
  }

  const theme = data.theme;
  const sections = data.sections;

  let subAccountId: number | null = null;
  try {
    const { db } = await import("../db");
    const { domains } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const domainRow = await db.select({ subAccountId: domains.subAccountId }).from(domains).where(eq(domains.siteId, siteId)).limit(1);
    if (domainRow.length > 0) {
      subAccountId = domainRow[0].subAccountId;
    }
  } catch (err) { console.warn("[SITES] caught:", err instanceof Error ? err.message : err); }

  const trackingSnippet = `
<script>
(function(){
  var VISITOR_KEY='apex_visitor_id',SESSION_KEY='apex_session_id',SESSION_EXP_KEY='apex_session_expiry',STICKY_KEY='apex_liquid_contact';
  var SESSION_EXP=30*60*1000,batchTimer=null,queue=[];
  var subAccountId=${subAccountId ?? "null"};
  var siteId=${siteId};
  if(!subAccountId){return;}
  function genId(){return(crypto&&crypto.randomUUID)?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36);}
  function store(k,v){try{localStorage.setItem(k,v);}catch(e){}}
  function load(k){try{return localStorage.getItem(k);}catch(e){return null;}}
  function getOrCreate(k){var v=load(k);if(!v){v=genId();store(k,v);}return v;}
  function getVisitorId(){return getOrCreate(VISITOR_KEY);}
  function getSessionId(){var exp=parseInt(load(SESSION_EXP_KEY)||'0',10);if(Date.now()<exp){var s=load(SESSION_KEY);if(s){store(SESSION_EXP_KEY,String(Date.now()+SESSION_EXP));return s;}}var s=genId();store(SESSION_KEY,s);store(SESSION_EXP_KEY,String(Date.now()+SESSION_EXP));return s;}
  function getUtm(){var p={},s=new URLSearchParams(location.search);[['utmSource','utm_source'],['utmMedium','utm_medium'],['utmCampaign','utm_campaign'],['utmContent','utm_content'],['utmTerm','utm_term']].forEach(function(x){var v=s.get(x[1]);if(v)p[x[0]]=v;});return p;}
  function getDevice(){var ua=navigator.userAgent;return{device:/Mobi|Android|iPhone|iPad/i.test(ua)?'mobile':'desktop',browser:/Chrome/.test(ua)?'chrome':/Firefox/.test(ua)?'firefox':/Safari/.test(ua)?'safari':'other',os:/Windows/.test(ua)?'windows':/Mac/.test(ua)?'macos':/Android/.test(ua)?'android':/iOS|iPhone|iPad/.test(ua)?'ios':'other'};}
  function getContact(){try{var r=load(STICKY_KEY);return r?JSON.parse(r):null;}catch(e){return null;}}
  function buildEvent(type,payload){var c=getContact();var d=getDevice();var e=Object.assign({eventType:type,sessionId:getSessionId(),visitorId:getVisitorId(),page:location.href.slice(0,1024),referrer:document.referrer.slice(0,1024)||undefined,device:d.device,browser:d.browser,os:d.os,payload:payload||{},clientTimestamp:new Date().toISOString()},getUtm());if(c&&c.email)e.contactEmail=c.email;if(c&&c.phone)e.contactPhone=c.phone;return e;}
  function flush(){if(!queue.length)return;var batch=queue.splice(0,50);var body=JSON.stringify({subAccountId:subAccountId,siteId:siteId,events:batch});try{fetch('/api/track/events',{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true});}catch(e){queue.unshift.apply(queue,batch);}if(queue.length)schedBatch();}
  function schedBatch(){if(batchTimer)return;batchTimer=setTimeout(function(){batchTimer=null;flush();},3000);}
  function track(type,payload){queue.push(buildEvent(type,payload));if(queue.length>500)queue=queue.slice(-500);schedBatch();}
  window.apexTrack=track;
  window.apexIdentify=function(data){try{store(STICKY_KEY,JSON.stringify(data));}catch(e){}track('identity_resolved',data);};
  track('page_view',{title:document.title,path:location.pathname});
  var scrollDone={};window.addEventListener('scroll',function(){var pct=Math.round((window.scrollY+window.innerHeight)/document.documentElement.scrollHeight*100);[25,50,75,90].forEach(function(d){if(pct>=d&&!scrollDone[d]){scrollDone[d]=1;track('scroll_depth',{depth_pct:d});}});},{passive:true});
  document.addEventListener('click',function(e){var el=e.target&&e.target.closest('a,button,[data-apex-cta]');if(!el)return;var isCta=el.hasAttribute('data-apex-cta')||/cta/i.test(el.className+' '+(el.getAttribute('data-testid')||''));track(isCta?'cta_click':'click',{element:el.tagName.toLowerCase(),text:(el.textContent||'').slice(0,100),href:el.href||undefined});});
  var fStarted=new WeakSet();document.addEventListener('focusin',function(e){var f=e.target&&e.target.closest('form');if(f&&!fStarted.has(f)){fStarted.add(f);track('form_start',{formId:f.id||undefined});}});
  document.addEventListener('submit',function(e){if(e.target)track('form_submit',{formId:e.target.id||undefined});});
  window.addEventListener('beforeunload',flush);
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush();});
})();
</script>`;

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
${trackingSnippet}
</head>
<body>
${sections.map((s: any) => renderSiteSection(s, theme)).join('\n')}
</body>
</html>`;

  if (!site.publishedUrl) {
    const publishedUrl = `/live/${siteId}`;
    await storage.updateSavedSite(siteId, { publishedUrl });
  }

  res.setHeader("Content-Type", "text/html");
  res.send(html);
}

export function registerSitesRoutes(app: Express) {
  app.get("/live/:siteId", asyncHandler(async (req, res) => {
    const siteId = parseInt(req.params.siteId as string);
    await renderSiteHtml(siteId, res);
  }));

  // ---- Publish Site Endpoint ----
  app.post("/api/sites/:id/publish", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const site = await storage.getSavedSite(id);
    if (!site) return res.status(404).json({ error: "Site not found" });
    const publishedUrl = `/live/${id}`;
    const updated = await storage.updateSavedSite(id, {
      publishedUrl,
      isPublished: true,
      status: "published",
    });
    // Emit event for dashboard notifications
    try {
      const { emitUniversalEvent } = await import("../intelligence/eventEmitter");
      emitUniversalEvent({
        eventType: "site.published",
        sourceModule: "site-builder",
        subAccountId: site.subAccountId,
        metadata: { siteId: id, publishedUrl, siteName: site.name },
      });
    } catch (_err) { // allow-silent-catch: fire-and-forget event emit, never blocks response
    }
    res.json({ success: true, url: publishedUrl, site: updated });
  }));


  // ---- Site Builder (AI Generation) ----

  const SITE_SYSTEM_PROMPT = `You are an expert web designer who builds complete, professional multi-page websites for local businesses. Generate stunning, high-converting full websites.

  Return a JSON object with this structure:

  {
  "name": "<Business Name> Website",
  "theme": {
    "primary": "<vibrant hex accent color>",
    "bg": "<dark background hex — usually dark like #0a0a0a or #0f172a>",
    "text": "<light text hex>",
    "font": "<Google Font name>"
  },
  "pages": [
    {
      "title": "Home",
      "slug": "home",
      "sections": [ ...8-12 sections... ]
    },
    {
      "title": "About",
      "slug": "about",
      "sections": [ ...4-6 sections... ]
    },
    {
      "title": "Services",
      "slug": "services",
      "sections": [ ...5-8 sections... ]
    },
    {
      "title": "Contact",
      "slug": "contact",
      "sections": [ ...3-4 sections... ]
    }
  ]
  }

  ALSO include a top-level "sections" array (copy of Home page sections) for backward compatibility.

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
    if (!isAIConfigured()) {
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
        const siteAiResult = await aiChat([
          { role: "system", content: SITE_SYSTEM_PROMPT },
          { role: "user", content: attempt === 0 ? userMessage : userMessage + "\n\nIMPORTANT: Return ONLY valid JSON. No markdown, no explanation, no text before or after the JSON object." },
        ], { temperature: attempt === 0 ? 0.7 : 0.3, maxTokens: 4096, jsonMode: true, route: "generate-site", timeoutMs: 60_000 });

        if (!siteAiResult.ok) {
          throw new Error(siteAiResult.errorMessage ?? "AI generation failed");
        }

        siteData = extractJson(siteAiResult.text);
        break;
      } catch (e: any) {
        lastError = e.message || "JSON parse failed";
        if (attempt === 1) {
          const isTimeout = lastError.includes("timed out") || lastError.includes("timeout");
          return res.status(isTimeout ? 504 : 500).json({
            error: isTimeout ? "AI generation timed out — please try again" : "AI returned invalid response after retry",
            detail: lastError,
          });
        }
      }
    }

    // Accept multi-page format (pages array) or single-page format (sections array)
    const hasPages = Array.isArray(siteData.pages) && siteData.pages.length > 0;
    const hasSections = Array.isArray(siteData.sections) && siteData.sections.length > 0;

    if (!siteData.theme || (!hasPages && !hasSections)) {
      return res.status(500).json({ error: "AI returned invalid site structure" });
    }

    // Normalize sections if present
    if (hasSections) {
      siteData.sections = siteData.sections.map((s: any) => {
        if (s.props) return s;
        const { type, ...props } = s;
        return { type, props };
      });
    }

    // Normalize pages if present
    if (hasPages) {
      siteData.pages = siteData.pages.map((page: any) => ({
        ...page,
        sections: (page.sections || []).map((s: any) => {
          if (s.props) return s;
          const { type, ...props } = s;
          return { type, props };
        }),
      }));
      // Always provide top-level sections from home page for backward compat
      if (!hasSections) {
        siteData.sections = siteData.pages[0]?.sections || [];
      }
    }

    await logUsageInternal(null, "AI_CHAT", 1, "AI site generation");

    res.json(siteData);
  }));

  // ---- Saved Sites ----
  app.get("/api/sites", asyncHandler(async (req, res) => {
    const subAccountId = req.query.subAccountId
      ? parseInt(req.query.subAccountId as string)
      : (req as any).user?.subAccountId || null;
    const sites = subAccountId
      ? await storage.getSavedSitesByAccount(subAccountId)
      : await storage.getSavedSites();
    res.json(sites);
  }));

  // GET single site by ID
  app.get("/api/sites/:id", asyncHandler(async (req, res) => {
    const siteId = parseIntParam(req.params.id, "id");
    const site = await storage.getSavedSite(siteId);
    if (!site) return res.status(404).json({ error: "Site not found" });
    res.json(site);
  }));

  // DELETE site
  
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

    const codeScan = scanSiteForMaliciousCode(parsed.data.siteData);
    if (!codeScan.ok) return res.status(400).json({ error: codeScan.reason });

    const site = await storage.createSavedSite(parsed.data);
    emitWithTimeline({
      eventType: EVENT_TYPES.SITE_CREATED,
      sourceModule: "sites",
      sourceTable: "saved_sites",
      sourceRecordId: String(site.id),
      subAccountId: site.subAccountId,
      siteId: site.id,
      metadata: { name: site.name },
    }, `Site created: ${site.name}`, undefined, "info");
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
      const codeScan = scanSiteForMaliciousCode(req.body.siteData);
      if (!codeScan.ok) return res.status(400).json({ error: codeScan.reason });
      updates.siteData = req.body.siteData;
    }
    if (req.body.customDomain !== undefined) updates.customDomain = req.body.customDomain;
    if (req.body.publishedUrl !== undefined) updates.publishedUrl = req.body.publishedUrl;

    const wasPublished = !site.isPublished && req.body.isPublished;
    const wasUnpublished = site.isPublished && req.body.isPublished === false;
    const domainAssigned = req.body.customDomain !== undefined && req.body.customDomain !== site.customDomain;
    if (req.body.isPublished !== undefined) updates.isPublished = req.body.isPublished;

    const updated = await storage.updateSavedSite(id, updates);

    if (wasPublished) {
      emitWithTimeline({
        eventType: EVENT_TYPES.SITE_PUBLISHED,
        sourceModule: "sites",
        sourceTable: "saved_sites",
        sourceRecordId: String(id),
        subAccountId: site.subAccountId,
        siteId: id,
        metadata: { name: site.name, customDomain: updates.customDomain || site.customDomain },
      }, `Site published: ${site.name}`, `Website "${site.name}" is now live`, "info");
    } else if (wasUnpublished) {
      emitWithTimeline({
        eventType: "site_unpublished",
        sourceModule: "sites",
        sourceTable: "saved_sites",
        sourceRecordId: String(id),
        subAccountId: site.subAccountId,
        siteId: id,
        metadata: { name: site.name },
      }, `Site unpublished: ${site.name}`, `Website "${site.name}" taken offline`, "warn");
    } else {
      emitUniversalEvent({
        eventType: EVENT_TYPES.SITE_UPDATED,
        sourceModule: "sites",
        sourceTable: "saved_sites",
        sourceRecordId: String(id),
        subAccountId: site.subAccountId,
        siteId: id,
        metadata: { updates: Object.keys(updates) },
      });
    }

    if (domainAssigned && req.body.customDomain) {
      emitUniversalEvent({
        eventType: EVENT_TYPES.DOMAIN_ATTACHED,
        sourceModule: "sites",
        sourceTable: "saved_sites",
        sourceRecordId: String(id),
        subAccountId: site.subAccountId,
        siteId: id,
        metadata: { customDomain: req.body.customDomain, siteName: site.name },
      });
    }
    res.json(updated);
  }));

  app.delete("/api/sites/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const site = await storage.getSavedSite(id);
    const deleted = await storage.deleteSavedSite(id);
    if (!deleted) return res.status(404).json({ error: "Site not found" });
    if (site) {
      emitWithTimeline({
        eventType: "site_deleted",
        sourceModule: "sites",
        sourceTable: "saved_sites",
        sourceRecordId: String(id),
        subAccountId: site.subAccountId,
        siteId: id,
        metadata: { name: site.name, customDomain: site.customDomain },
      }, `Site deleted: ${site.name}`, `Website "${site.name}" has been deleted`, "warn");
    }
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
    emitUniversalEvent({
      eventType: "site_versioned",
      sourceModule: "sites",
      sourceTable: "saved_sites",
      sourceRecordId: String(siteId),
      subAccountId: site.subAccountId,
      siteId,
      metadata: { versionNumber: nextVersion, label: version.label, siteName: site.name },
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

  // ---- Vibe Site Generator (3D animated, Three.js, GSAP) ----
  app.post("/api/generate-vibe-site", asyncHandler(async (req, res) => {
    if (!isAIConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const user = (req as any).user;
    const userId = user?.claims?.sub || user?.id;

    // Only Apex admin accounts get vibe sites (premium feature)
    const { isApexParentUser } = await import("./helpers");
    const isAdmin = await isApexParentUser(userId);
    if (!isAdmin) {
      return res.status(403).json({ error: "Vibe Sites are a premium feature. Contact Apex to upgrade." });
    }

    const { prompt, subAccountId, vibeTheme } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

    const THEME_PALETTES: Record<string, { bg: string; primary: string; text: string; font: string; desc: string }> = {
      "dark-luxury":  { bg: "#050404", primary: "#c9a84c", text: "#f5f0e8", font: "Playfair Display", desc: "ultra-dark charcoal background with gold accent glows, luxury glassmorphism cards with velvet dark shadows, ornate serif headings" },
      "neon-cyber":   { bg: "#0a0a1a", primary: "#00ff88", text: "#e0ffe8", font: "Space Grotesk",    desc: "deep navy void with electric green neon glows, cyberpunk scanline grid, holographic card effects, terminal-style elements" },
      "deep-purple":  { bg: "#0d0014", primary: "#a855f7", text: "#f0e6ff", font: "Inter",            desc: "void black-purple background with violet particle nebula fields, cosmic aurora gradients, floating orb animations" },
      "ocean-dark":   { bg: "#020b18", primary: "#0ea5e9", text: "#e0f4ff", font: "DM Sans",          desc: "abyssal ocean dark with cyan bioluminescence, wave particle systems, underwater caustic light effects, deep sea atmosphere" },
      "fire-red":     { bg: "#0a0000", primary: "#ef4444", text: "#fff0f0", font: "Montserrat",       desc: "void black with crimson fire particles, ember trail animations, molten lava flow effects, intense red energy" },
      "clean-white":  { bg: "#f8f8f8", primary: "#6366f1", text: "#1a1a2e", font: "DM Sans",          desc: "bright clean white minimal background with indigo accents, frosted glass cards, subtle floating geometric orbs, airy spacing" },
    };
    const palette = THEME_PALETTES[(vibeTheme as string) || "deep-purple"] || THEME_PALETTES["deep-purple"];

    const VIBE_SYSTEM_PROMPT = `You are an elite creative developer who builds jaw-dropping 3D animated websites that go viral on social media. You generate complete, self-contained HTML files with stunning visuals.

Your sites use Three.js for 3D particle effects, GSAP for smooth animations, glassmorphism cards, gradient meshes, custom cursor effects, parallax scrolling, neon glows.

MANDATORY THEME — enforce these EXACT colors throughout the entire site:
- Background: ${palette.bg}
- Primary Accent / Glow: ${palette.primary}
- Text: ${palette.text}
- Font: ${palette.font}
- Style: ${palette.desc}

Return a single JSON object:
{
  "name": "Business Name — Vibe Site",
  "html": "<complete self-contained HTML as string>",
  "theme": { "primary": "${palette.primary}", "bg": "${palette.bg}", "text": "${palette.text}", "font": "${palette.font}" }
}

The HTML must:
- Be completely self-contained with all CSS/JS inline or via CDN
- Load Three.js: https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
- Load GSAP: https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js
- Load ScrollTrigger: https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js
- STRICTLY USE the theme colors — bg:${palette.bg}, primary:${palette.primary}, font:${palette.font}
- Include: sticky nav with blur effect, hero with Three.js 3D animated background (particles/geometry), services/features section, social proof/testimonials, CTA, contact form with proper styling
- Be genuinely stunning — something people screenshot and post on Instagram. Use real animations, real depth.
- Write real business-specific copy tailored to the prompt — NO generic placeholders
- Be fully mobile responsive with proper viewport meta tag
- Return ONLY valid JSON — no markdown fences, no explanation`;

    try {
      const result = await aiChat([
        { role: "system", content: VIBE_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ], { temperature: 0.8, maxTokens: 8000, jsonMode: true, route: "generate-vibe-site", timeoutMs: 90_000 });

      if (!result.ok) throw new Error(result.errorMessage || "AI generation failed");

      let vibeData: any;
      try {
        const cleaned = result.text.replace(/\`\`\`json\n?/g, "").replace(/\`\`\`\n?/g, "").trim();
        vibeData = JSON.parse(cleaned);
      } catch (parseErr: any) {
        console.warn("[VIBE-GEN] JSON parse failed:", parseErr instanceof Error ? parseErr.message : parseErr);
        throw new Error("Failed to parse vibe site response");
      }

      if (!vibeData.html) return res.status(500).json({ error: "No HTML generated" });

      // Save as a site
      const saved = await storage.createSavedSite({
        subAccountId: subAccountId ?? 13,
        name: vibeData.name || "Vibe Site",
        siteData: { type: "vibe", html: vibeData.html, theme: vibeData.theme, sections: [] },
        publishedUrl: null,
        status: "draft",
      });

      emitUniversalEvent({
        eventType: "site.generated",
        sourceModule: "vibe-generator",
        subAccountId: subAccountId ?? 13,
        metadata: { siteId: saved.id, type: "vibe" },
      });

      res.json({ ...saved, html: vibeData.html, theme: vibeData.theme });
    } catch (err: any) {
      console.error("[VIBE-GEN] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }));

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

    if (!isAIConfigured()) {
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

    const liquidAiResult = await aiChat([
      { role: "system", content: LIQUID_SYSTEM_PROMPT },
      { role: "user", content: visitorDescription },
    ], { temperature: 0.8, maxTokens: 4096, jsonMode: true, route: "liquid-site-gen" });
    const cleaned = liquidAiResult.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let siteData: any;
    try {
      siteData = JSON.parse(cleaned);
    } catch (err) {
      console.warn("[SITES] caught:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "AI returned invalid JSON" });
    }

    // Accept multi-page format (pages array) or single-page format (sections array)
    const hasPages = Array.isArray(siteData.pages) && siteData.pages.length > 0;
    const hasSections = Array.isArray(siteData.sections) && siteData.sections.length > 0;

    if (!siteData.theme || (!hasPages && !hasSections)) {
      return res.status(500).json({ error: "AI returned invalid site structure" });
    }

    // Normalize sections if present
    if (hasSections) {
      siteData.sections = siteData.sections.map((s: any) => {
        if (s.props) return s;
        const { type, ...props } = s;
        return { type, props };
      });
    }

    // Normalize pages if present
    if (hasPages) {
      siteData.pages = siteData.pages.map((page: any) => ({
        ...page,
        sections: (page.sections || []).map((s: any) => {
          if (s.props) return s;
          const { type, ...props } = s;
          return { type, props };
        }),
      }));
      // Always provide top-level sections from home page for backward compat
      if (!hasSections) {
        siteData.sections = siteData.pages[0]?.sections || [];
      }
    }

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
    } catch (err) {
      console.warn("[SITES] caught:", err instanceof Error ? err.message : err);
      res.json({ contact: null });
    }
  }));
}

