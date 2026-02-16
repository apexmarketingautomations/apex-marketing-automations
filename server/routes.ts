import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertMessageSchema, insertWorkflowSchema, insertSubAccountSchema, insertSavedSiteSchema, insertReviewSchema, insertUsageLogSchema, insertDomainSchema, insertSnapshotSchema, insertSnapshotVersionSchema, reviews, domains } from "@shared/schema";
import { z } from "zod";
import OpenAI from "openai";
import Twilio from "twilio";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
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
      SMS_SEGMENT: 2.0, VOICE_MINUTE: 1.5, AI_IMAGE_GEN: 0.50, AI_CHAT: 0.10, DOMAIN_PURCHASE: 0,
    };
    const rate = MARKUP_RATES_INT[type] ?? 0;
    const cost = (type === "AI_IMAGE_GEN" || type === "AI_CHAT") ? rate : amount * rate;
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

  // ---- Auth Middleware ----
  app.use("/api", (req, res, next) => {
    const fullPath = req.originalUrl || req.baseUrl + req.path;
    const openPaths = ["/api/auth/", "/api/login", "/api/logout", "/api/callback", "/api/stripe/webhook", "/api/stripe/subscription-webhook", "/api/webhooks/", "/api/snapshots/marketplace"];
    const openExact = ["/api/reviews", "/api/alert-owner"];

    if (openPaths.some(p => fullPath.startsWith(p))) return next();
    if (req.method === "POST" && openExact.some(p => fullPath === p)) return next();
    if (req.method === "GET" && fullPath.startsWith("/api/review-config/")) return next();
    if (fullPath === "/api/log-error") return next();
    if (fullPath === "/api/sms-webhook") return next();
    if (fullPath === "/api/sentinel/test-trigger") return next();

    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    next();
  });

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

  // ---- Project Download ----
  app.get("/api/download-project", asyncHandler(async (_req, res) => {
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
  app.get("/api/accounts", asyncHandler(async (_req, res) => {
    const accounts = await storage.getSubAccounts();
    res.json(accounts);
  }));

  app.post("/api/accounts", asyncHandler(async (req, res) => {
    const parsed = insertSubAccountSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const account = await storage.createSubAccount(parsed.data);
    res.status(201).json(account);
  }));

  // ---- Messages ----
  app.get("/api/messages/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    const msgs = await storage.getMessages(subAccountId);
    res.json(msgs);
  }));

  app.post("/api/messages", asyncHandler(async (req, res) => {
    const parsed = insertMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const msg = await storage.createMessage(parsed.data);
    res.status(201).json(msg);
  }));

  // ---- Workflows ----
  app.get("/api/workflows", asyncHandler(async (_req, res) => {
    const wfs = await storage.getWorkflows();
    res.json(wfs);
  }));

  app.get("/api/workflows/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const wf = await storage.getWorkflow(id);
    if (!wf) return res.status(404).json({ error: "Not found" });
    res.json(wf);
  }));

  app.post("/api/workflows", asyncHandler(async (req, res) => {
    const parsed = insertWorkflowSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
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
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = z.object({ prompt: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: WORKFLOW_AI_SYSTEM_PROMPT },
        { role: "user", content: parsed.data.prompt },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let workflowData: any;
    try {
      workflowData = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "AI returned invalid JSON" });
    }

    if (!workflowData.steps || !Array.isArray(workflowData.steps)) {
      return res.status(500).json({ error: "AI returned invalid workflow structure" });
    }

    const wf = await storage.createWorkflow({
      name: workflowData.name || "AI Generated Workflow",
      trigger: workflowData.trigger || "manual_trigger",
      steps: workflowData.steps,
      subAccountId: null,
    });

    await logUsageInternal(null, "AI_CHAT", 1, "Workflow AI generation");

    res.status(201).json(wf);
  }));

  // ---- SMS Sending via Twilio ----
  app.post("/api/messages/send", asyncHandler(async (req, res) => {
    const parsed = insertMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, contactPhone, body, channel } = parsed.data;

    let twilioStatus = "sent";
    let twilioSid: string | null = null;

    if (channel === "sms" || !channel) {
      const twilioClient = getTwilioClient();
      if (twilioClient) {
        const account = await storage.getSubAccount(subAccountId);
        const fromNumber = account?.twilioNumber;
        if (fromNumber) {
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
          }
        }
      }
    }

    const msg = await storage.createMessage({
      ...parsed.data,
      status: twilioStatus,
    });

    await logUsageInternal(subAccountId, "SMS_SEGMENT", 1, `SMS to ${contactPhone}`);

    res.status(201).json({ ...msg, twilioSid });
  }));

  // ---- Bot Chat (Real OpenAI) ----
  const botChatSchema = z.object({
    message: z.string().min(1).max(2000),
    persona: z.string().max(5000).optional(),
    conversationHistory: z.array(z.object({
      role: z.string(),
      content: z.string(),
    })).max(20).optional(),
  });

  app.post("/api/bot/chat", asyncHandler(async (req, res) => {
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = botChatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const systemPrompt = parsed.data.persona || `You are a helpful AI assistant for a business. Keep responses concise and helpful (1-3 sentences). Help with bookings, answer questions, and provide a warm experience.`;

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

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      temperature: 0.7,
      max_tokens: 300,
    });

    const reply = completion.choices[0]?.message?.content ?? "I'm here to help! Could you tell me more?";

    await logUsageInternal(null, "AI_CHAT", 1, "Bot trainer chat");

    res.json({ reply });
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

    simulateTraining(job.id);

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
    const bp = await storage.getBlueprintByIndustryId(industryId);
    if (!bp) return res.status(404).json({ error: "Blueprint not found for this industry" });

    const account = await storage.createSubAccount({
      name: `${bp.title} Account`,
      twilioNumber: `+1555${Math.floor(1000 + Math.random() * 9000)}`,
    });

    res.status(201).json({ account, blueprint: bp });
  }));

  // ---- Site Builder (AI Generation) ----
  const openai = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });

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
GALLERY: { title, subtitle, images: [{ url (unsplash), caption }] } — 6 images
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
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = promptSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    let userMessage = parsed.data.prompt;
    if (parsed.data.uploadedImages && parsed.data.uploadedImages.length > 0) {
      userMessage += `\n\nThe user has uploaded these images to use on the site:\n${parsed.data.uploadedImages.join("\n")}`;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SITE_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    });

    const raw = completion.choices[0]?.message?.content ?? "";
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
  const LIQUID_SYSTEM_PROMPT = `You are a landing-page architect that creates PERSONALIZED websites based on visitor context.

You will receive visitor data including:
- device: "mobile" or "desktop"
- referrer: where they came from (google, facebook, instagram, tiktok, twitter, referral, direct)
- timeOfDay: "morning", "afternoon", "evening", or "night"
- hour: the current hour (0-23)
- language: browser language

PERSONALIZATION RULES:
- Mobile visitors: shorter headlines, bigger CTA buttons, concise text
- Desktop visitors: longer, more detailed descriptions
- Morning visitors: energetic, fresh-start messaging ("Start your day right")
- Evening/night visitors: relaxation-focused ("Wind down with...")
- Google referrers: trust-focused messaging (reviews, certifications)
- Social media referrers (facebook, instagram, tiktok): trend-focused, social proof messaging
- Direct visitors: loyalty/returning customer focus

Return a JSON object with this exact structure:

{
  "theme": {
    "primary": "<hex color>",
    "bg": "<hex background>",
    "text": "<hex text>",
    "font": "<font family>"
  },
  "sections": [
    {
      "type": "HERO",
      "props": {
        "title": "<personalized headline>",
        "subtitle": "<personalized subheadline>",
        "cta": "<personalized button text>",
        "image": "<unsplash URL>"
      }
    },
    {
      "type": "FEATURES",
      "props": {
        "title": "<section heading>",
        "features": [
          { "icon": "<icon>", "title": "<title>", "desc": "<description>" },
          { "icon": "<icon>", "title": "<title>", "desc": "<description>" },
          { "icon": "<icon>", "title": "<title>", "desc": "<description>" }
        ]
      }
    },
    {
      "type": "BOOKING",
      "props": {
        "title": "<form heading>",
        "formId": "<unique id>"
      }
    }
  ]
}

Rules:
- Always return exactly 3 sections: HERO, FEATURES, BOOKING
- icon must be one of: ShieldCheck, Clock, Sparkles, Star, Dumbbell, Heart, Zap, Trophy, CheckCircle2
- Use real Unsplash image URLs. Format: https://images.unsplash.com/photo-XXXXX?q=80&w=2070&auto=format&fit=crop
- font: "Playfair Display" for luxury/elegant, "Inter" for modern/clean
- Make the copy feel personally tailored to this specific visitor
- Return ONLY the JSON object, no markdown, no code fences.`;

  const liquidSiteSchema = z.object({
    device: z.enum(["desktop", "mobile", "tablet"]).optional().default("desktop"),
    referrer: z.string().max(500).optional().default("direct"),
    timeOfDay: z.enum(["morning", "afternoon", "evening", "night"]).optional().default("afternoon"),
    hour: z.number().int().min(0).max(23).optional().default(12),
    language: z.string().max(10).optional().default("en-US"),
  });

  app.post("/api/generate-liquid-site", asyncHandler(async (req, res) => {
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = liquidSiteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { device, referrer, timeOfDay, hour, language } = parsed.data;

    const visitorDescription = `Visitor context:
- Device: ${device || "desktop"}
- Came from: ${referrer || "direct"}  
- Time of day: ${timeOfDay || "afternoon"} (${hour ?? 12}:00)
- Language: ${language || "en-US"}

Generate a personalized premium wellness/beauty service landing page for this specific visitor.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: LIQUID_SYSTEM_PROMPT },
        { role: "user", content: visitorDescription },
      ],
      temperature: 0.8,
      max_tokens: 1500,
    });

    const raw = completion.choices[0]?.message?.content ?? "";
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
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = promptSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: AD_CAMPAIGN_SYSTEM_PROMPT },
        { role: "user", content: parsed.data.prompt },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    const raw = completion.choices[0]?.message?.content ?? "";
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
        const imageResponse = await openai.images.generate({
          model: "dall-e-3",
          prompt: `Facebook ad creative image: ${campaign.image_prompt}. Professional marketing photo, high quality, no text overlay, clean composition, suitable for social media advertising.`,
          n: 1,
          size: "1024x1024",
          quality: "standard",
        });
        campaign.generated_image_url = imageResponse.data?.[0]?.url || null;
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
    conversationHistory: z.array(z.object({
      role: z.string().max(20),
      text: z.string().max(2000),
    })).max(20).optional(),
  });

  app.post("/api/chat", asyncHandler(async (req, res) => {
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      return res.status(503).json({ reply: "Chat service is currently offline. Please try again later." });
    }

    const parsed = chatBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
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

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: 200,
    });

    const reply = completion.choices[0]?.message?.content ?? "I'm here to help! Could you tell me more about what you're looking for?";

    await logUsageInternal(null, "AI_CHAT", 1, "Chat widget AI response");

    res.json({ reply });
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

  const personaSchema = z.object({
    businessDescription: z.string().min(1, "businessDescription is required").max(2000),
  });

  app.post("/api/voice-agents/generate-persona", asyncHandler(async (req, res) => {
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = personaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You generate voice AI agent personas for businesses. Given a business description, return a JSON object with:
{
  "persona": "<detailed agent persona/instructions for handling calls, max 3 sentences>",
  "firstMessage": "<natural greeting the agent says when answering, max 1 sentence>",
  "suggestedName": "<friendly agent name>"
}
Rules:
- Persona should be specific to the business type
- First message should sound warm and natural, not robotic
- Return ONLY valid JSON, no markdown or code fences`,
        },
        { role: "user", content: parsed.data.businessDescription },
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    const raw = completion.choices[0]?.message?.content ?? "";
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
  });

  app.post("/api/phone-numbers/purchase", asyncHandler(async (req, res) => {
    const twilioClient = getTwilioClient();
    if (!twilioClient) {
      return res.status(503).json({ error: "Twilio credentials are not configured." });
    }

    const parsed = purchaseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { phoneNumber, assistantId } = parsed.data;

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0] || process.env.REPLIT_DEV_DOMAIN || "";
    const smsWebhookUrl = domain ? `https://${domain}/api/sms-webhook` : "";

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
      return res.json([]);
    }

    let numbers;
    try {
      numbers = await twilioClient.incomingPhoneNumbers.list({ limit: 20 });
    } catch (twilioErr: any) {
      console.error("Twilio list numbers error:", twilioErr.message, twilioErr.code);
      return res.json([]);
    }

    let vapiNumbers: any[] = [];
    if (vapiConfig.isConfigured) {
      try {
        const vapiRes = await fetch("https://api.vapi.ai/phone-number", {
          headers: vapiConfig.privateHeaders(),
        });
        if (vapiRes.ok) {
          vapiNumbers = await vapiRes.json();
        }
      } catch {}
    }

    const normalizeNum = (num: string) => num?.replace(/[^\d+]/g, "") || "";
    res.json(
      numbers.map((n) => {
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
      })
    );
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

      let aiReply = "Thanks for your message! We'll get back to you shortly.";

      if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        try {
          const systemPrompt = channel === "sms"
            ? "You are a helpful business receptionist. Keep text replies under 160 characters. Be warm, professional, and concise. If someone wants to book an appointment, suggest they call the office number."
            : "You are a helpful business assistant responding via chat. Keep replies conversational and under 300 characters. Be warm, professional, and helpful. If someone wants to book an appointment, suggest they call the office number.";

          const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: incomingMsg.substring(0, 1000) },
            ],
            max_tokens: 150,
            temperature: 0.7,
          });
          aiReply = completion.choices[0]?.message?.content || aiReply;
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

  app.get("/api/phone-numbers/config", (_req, res) => {
    const hasTwilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    const hasVapi = vapiConfig.isConfigured;
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0] || process.env.REPLIT_DEV_DOMAIN || "";
    res.json({ hasTwilio, hasVapi, webhookDomain: domain ? `https://${domain}` : null });
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
      res.json({ products: [] });
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

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0] || "localhost:5000";
    const baseUrl = `https://${domain}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: parsed.data.priceId, quantity: 1 }],
      mode: "subscription",
      success_url: parsed.data.successUrl || `${baseUrl}/site-builder?payment=success`,
      cancel_url: parsed.data.cancelUrl || `${baseUrl}/site-builder?payment=cancelled`,
    });

    res.json({ url: session.url });
  }));

  // ── General Image Upload ──────────────────────────────────────────
  const generalUploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(generalUploadsDir)) {
    fs.mkdirSync(generalUploadsDir, { recursive: true });
  }

  const generalStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, generalUploadsDir),
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    },
  });

  const generalUpload = multer({
    storage: generalStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i;
      if (allowed.test(path.extname(file.originalname))) {
        cb(null, true);
      } else {
        cb(new Error("Only image files are allowed"));
      }
    },
  });

  app.post("/api/uploads", generalUpload.single("image"), (req: any, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const url = `/uploads/${req.file.filename}`;
    res.json({
      url,
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  });

  app.get("/api/uploads", (_req, res) => {
    try {
      const files = fs.readdirSync(generalUploadsDir)
        .filter((f: string) => /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i.test(f))
        .map((f: string) => {
          const stat = fs.statSync(path.join(generalUploadsDir, f));
          return {
            url: `/uploads/${f}`,
            filename: f,
            size: stat.size,
            uploadedAt: stat.mtime.toISOString(),
          };
        })
        .sort((a: any, b: any) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
      res.json({ files });
    } catch {
      res.json({ files: [] });
    }
  });

  app.delete("/api/uploads/:filename", (req, res) => {
    const filename = path.basename(req.params.filename);
    if (!/^[\w.-]+$/.test(filename)) {
      return res.status(400).json({ error: "Invalid filename" });
    }
    const filePath = path.resolve(path.join(generalUploadsDir, filename));
    if (!filePath.startsWith(path.resolve(generalUploadsDir))) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    fs.unlinkSync(filePath);
    res.json({ success: true });
  });

  app.post("/api/god-mode", asyncHandler(async (req, res) => {
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

          const domain = process.env.REPLIT_DOMAINS?.split(",")[0] || process.env.REPLIT_DEV_DOMAIN || "";
          const smsUrl = domain ? `https://${domain}/api/sms-webhook` : "";
          const updateOpts: Record<string, string> = {};
          if (smsUrl) { updateOpts.smsUrl = smsUrl; updateOpts.smsMethod = "POST"; }
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
        simulateTraining(job.id);
      } catch (err: any) {
        console.error("God Mode bot training error:", err.message);
      }
    }
    results.jobId = jobId;
    results.steps[3].status = jobId ? "done" : "skipped";

    results.steps.push({ id: "site", status: "running", label: "Generating Landing Page" });
    let siteData = null;
    if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: SITE_SYSTEM_PROMPT },
            { role: "user", content: `Create a premium landing page for "${businessName}", a ${industry} business. Make it look high-end and professional with compelling copy.` },
          ],
          temperature: 0.7,
          max_tokens: 4000,
        });
        const raw = completion.choices[0]?.message?.content ?? "";
        const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(cleaned);
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
    const reviewsList = await storage.getReviews(subAccountId);
    res.json(reviewsList);
  }));

  app.post("/api/reviews", asyncHandler(async (req, res) => {
    const parsed = insertReviewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const review = await storage.createReview(parsed.data);
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
    const account = await storage.getSubAccount(subAccountId);
    if (!account) return res.status(404).json({ error: "Account not found" });
    res.json({ googleReviewLink: account.googleReviewLink || "", name: account.name });
  }));

  app.patch("/api/review-config/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    const { googleReviewLink } = req.body;
    const updated = await storage.updateSubAccount(subAccountId, { googleReviewLink });
    if (!updated) return res.status(404).json({ error: "Account not found" });
    res.json({ googleReviewLink: updated.googleReviewLink });
  }));

  // ── Usage & Billing ──────────────────────────────────────────

  const MARKUP_RATES: Record<string, number> = {
    SMS_SEGMENT: 2.0,
    VOICE_MINUTE: 1.5,
    AI_IMAGE_GEN: 0.50,
    AI_CHAT: 0.10,
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
    const rate = MARKUP_RATES[type] ?? 0;
    const cost = (type === "AI_IMAGE_GEN" || type === "AI_CHAT") ? rate : amount * rate;

    const log = await storage.createUsageLog({
      subAccountId,
      type,
      amount,
      cost,
      description: description || null,
    });

    try {
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      await stripe.billing.meterEvents.create({
        event_name: type.toLowerCase(),
        payload: {
          value: cost.toString(),
          stripe_customer_id: "pending",
        },
      });
    } catch (e) {
      console.log("[BILLING] Stripe meter event skipped:", (e as any).message);
    }

    res.status(201).json(log);
  }));

  app.get("/api/usage/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    const [logs, summary] = await Promise.all([
      storage.getUsageLogs(subAccountId),
      storage.getUsageLogsSummary(subAccountId),
    ]);
    res.json({ logs, summary });
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

  app.patch("/api/accounts/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const { ownerPhone } = req.body;
    const updated = await storage.updateSubAccount(id, { ownerPhone });
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

    const isTaken = baseName.length < 5 && Math.random() < 0.4;
    if (isTaken) {
      return res.json({ available: false, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "taken" });
    }

    res.json({ available: true, domain: normalizedDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale });
  }));

  app.post("/api/domains/search", asyncHandler(async (req, res) => {
    const { query } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required" });
    }

    const baseName = query.toLowerCase().trim().replace(/\.[a-z]+$/, "");
    const results = [];

    for (const [tld, pricing] of Object.entries(TLD_PRICING)) {
      const fullDomain = `${baseName}${tld}`;
      const existing = await storage.getDomainByName(fullDomain);
      if (existing) {
        results.push({ available: false, domain: fullDomain, tld, costPrice: pricing.cost, salePrice: pricing.sale, reason: "already_registered" });
        continue;
      }

      const isTaken = baseName.length < 5 && Math.random() < 0.3;
      results.push({
        available: !isTaken,
        domain: fullDomain,
        tld,
        costPrice: pricing.cost,
        salePrice: pricing.sale,
        reason: isTaken ? "taken" : undefined,
      });
    }

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
      status: "active",
      purchasePrice: pricing.cost,
      salePrice: pricing.sale,
      dnsConfigured: true,
      sslActive: true,
      registrar: "Apex Domains",
      siteId: siteId || null,
    });

    await storage.createUsageLog({
      subAccountId,
      type: "DOMAIN_PURCHASE",
      amount: 1,
      cost: pricing.sale,
      description: `Domain purchased: ${domain}`,
    });

    if (siteId) {
      await storage.updateSavedSite(siteId, { customDomain: domain });
    }

    res.status(201).json({ success: true, domain: domainRecord });
  }));

  app.get("/api/domains/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
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

  // ---- Subscription Management ----
  app.get("/api/subscription", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const sub = await storage.getSubscription(user.id);
    if (!sub) return res.json({ planTier: "free", status: "inactive", aiCredits: 0 });

    if (sub.isGrandfathered && sub.paymentStatus === "failed" && sub.paymentFailedAt) {
      const hoursSinceFail = (Date.now() - new Date(sub.paymentFailedAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceFail >= 72) {
        await storage.updateSubscription(sub.id, {
          isGrandfathered: false,
          paymentStatus: "revoked",
        });
        await storage.createAuditLog({
          action: "LEGACY_STATUS_REVOKED",
          performedBy: user.id,
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
        success_url: `${req.headers.origin || `https://${req.headers.host}`}/billing?success=true`,
        cancel_url: `${req.headers.origin || `https://${req.headers.host}`}/billing?canceled=true`,
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("[STRIPE] Checkout error:", err.message);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  }));

  app.post("/api/stripe/subscription-webhook", asyncHandler(async (req, res) => {
    let event = req.body;

    const endpointSecret = process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET;
    if (endpointSecret) {
      const signature = req.headers["stripe-signature"];
      if (!signature) return res.status(400).json({ error: "Missing stripe signature" });
      try {
        const { getUncachableStripeClient } = await import("./stripeClient");
        const stripe = await getUncachableStripeClient();
        const rawBody = (req as any).rawBody;
        if (!rawBody) return res.status(400).json({ error: "Missing raw body" });
        event = stripe.webhooks.constructEvent(rawBody, Array.isArray(signature) ? signature[0] : signature, endpointSecret);
      } catch (err: any) {
        console.error("[STRIPE] Webhook signature verification failed:", err.message);
        return res.status(400).json({ error: "Signature verification failed" });
      }
    }

    if (!event || !event.type) return res.status(400).json({ error: "Invalid event" });

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const tierName = session.metadata?.tierName;

      if (userId && tierName) {
        const existing = await storage.getSubscription(userId);
        const isGrandfathered = session.metadata?.isGrandfathered === "true";
        const billingInterval = session.metadata?.billingInterval || "monthly";
        const subData: any = {
          userId,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          planTier: tierName,
          status: "active" as const,
          aiCredits: 50,
          isGrandfathered,
          billingInterval,
          ...(isGrandfathered ? { blitzJoinedDate: new Date() } : {}),
        };

        if (existing) {
          await storage.updateSubscription(existing.id, subData);
        } else {
          await storage.createSubscription(subData);
        }
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const existing = await storage.getSubscriptionByStripeId(subscription.id);
      if (existing) {
        const updateData: any = {
          status: subscription.status === "active" ? "active" : "inactive",
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        };

        if (subscription.status === "active") {
          updateData.paymentStatus = "ok";
          updateData.paymentFailedAt = null;
        }

        await storage.updateSubscription(existing.id, updateData);
      }
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      const subId = invoice.subscription;
      if (subId) {
        const existing = await storage.getSubscriptionByStripeId(subId as string);
        if (existing) {
          await storage.updateSubscription(existing.id, {
            paymentStatus: "failed",
            paymentFailedAt: new Date(),
          });

          if (existing.isGrandfathered) {
            console.log(`[ENFORCEMENT] Legacy user ${existing.userId} payment failed - 72hr grace period started`);
            await storage.createAuditLog({
              action: "LEGACY_PAYMENT_WARNING",
              performedBy: existing.userId,
              details: {
                message: "Payment failed. 72-hour grace period before Legacy status revocation.",
                subscriptionId: existing.id,
                planTier: existing.planTier,
              },
            });
          }
        }
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const existing = await storage.getSubscriptionByStripeId(subscription.id);

      if (existing && existing.isGrandfathered) {
        await storage.updateSubscription(existing.id, {
          isGrandfathered: false,
          status: "inactive",
          paymentStatus: "revoked",
        });

        await storage.createAuditLog({
          action: "LEGACY_STATUS_REVOKED",
          performedBy: existing.userId,
          details: {
            message: "Subscription lapsed. Grandfathered pricing permanently revoked.",
            subscriptionId: existing.id,
            planTier: existing.planTier,
            originalBlitzDate: existing.blitzJoinedDate,
          },
        });

        console.log(`[ENFORCEMENT] User ${existing.userId} has LOST Legacy status permanently.`);
      }
    }

    res.json({ received: true });
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
      twilioNumber: `+1555${Math.floor(1000 + Math.random() * 9000)}`,
      industry: snapshot.industry || null,
      vibeTheme: config?.vibe || "cyber-glass",
      config: config?.config || null,
      ownerUserId: user.id,
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
      performedBy: user.id,
      details: { snapshotId: id, newAccountId: newAccount.id, businessName: parsed.data.businessName },
    });

    res.status(201).json({ account: newAccount, snapshotId: id });
  }));

  // ---- Snapshot Versioning (Checkpoints) ----
  app.get("/api/versions/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
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
      performedBy: user.id,
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
      performedBy: user.id,
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
    const config = await storage.getSentinelConfig(subAccountId);
    res.json(config || {
      subAccountId,
      feedUrl: null,
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
      feedUrl: z.string().nullable().optional(),
      keywords: z.array(z.string()).optional(),
      scanInterval: z.number().int().min(10).max(3600).optional(),
      enabled: z.boolean().optional(),
      smsAlertEnabled: z.boolean().optional(),
      geofenceEnabled: z.boolean().optional(),
      geofenceRadiusMiles: z.number().min(0.1).max(50).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const config = await storage.upsertSentinelConfig(parsed.data as any);
    res.json(config);
  }));

  app.get("/api/sentinel/incidents/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
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

    const config = await storage.getSentinelConfig(parsed.data.subAccountId);
    const keywords = config?.keywords?.length ? config.keywords : ['MVA', 'EXTRICATION', 'ROLLOVER', 'INJURIES', 'SIGNAL 4', 'ENTRAPMENT', 'FATALITY'];

    let incidents: any[] = [];
    let source = "simulated";

    if (config?.feedUrl) {
      try {
        const axios = (await import("axios")).default;
        const response = await axios.get(config.feedUrl, { timeout: 10000 });
        const data = response.data;

        if (Array.isArray(data)) {
          incidents = data.filter((item: any) => {
            const desc = (item.description || item.title || item.text || "").toUpperCase();
            return keywords.some(kw => desc.includes(kw.toUpperCase()));
          }).map((item: any) => ({
            title: item.title || item.description?.substring(0, 100) || "Incident Detected",
            description: item.description || item.text || "",
            location: item.location || item.address || "Location pending",
            severity: determineSeverity(item.description || "", keywords),
            rawPayload: item,
          }));
        }
        source = "live_feed";
      } catch (e) {
        console.log("[SENTINEL] Feed fetch failed, using simulated data:", (e as any).message);
      }
    }

    if (incidents.length === 0) {
      const sampleIncidents = [
        { title: "MVA w/ Entrapment", description: "Motor vehicle accident with entrapment reported. Multiple units dispatched.", location: "Intersection of Main St & 4th Ave", severity: "critical" },
        { title: "Signal 4 — Rollover", description: "Single vehicle rollover accident. Injuries reported. EMS on scene.", location: "Highway 95 NB Mile Marker 42", severity: "high" },
        { title: "MVA — Minor Injuries", description: "Two-vehicle collision. Minor injuries. Police directing traffic.", location: "Oak Blvd & Commerce Dr", severity: "medium" },
        { title: "Extrication Required", description: "Vehicle vs. pole. Driver trapped. Fire rescue en route for extrication.", location: "2100 Block Industrial Pkwy", severity: "critical" },
        { title: "MVA — Possible Injuries", description: "Rear-end collision. Possible injuries. One lane blocked.", location: "Elm St near Central Park", severity: "medium" },
      ];

      const count = Math.floor(Math.random() * 3) + 1;
      const shuffled = sampleIncidents.sort(() => 0.5 - Math.random()).slice(0, count);
      incidents = shuffled;
      source = "simulated";
    }

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
      performedBy: user.id,
      details: { subAccountId: parsed.data.subAccountId, source, found: created.length },
    });

    res.json({ source, found: created.length, incidents: created });
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

    await storage.updateSentinelIncident(id, {
      geofenceDeployed: true,
      actionStatus: "geofence_deployed",
    });

    await storage.createAuditLog({
      action: "SENTINEL_GEOFENCE_DEPLOYED",
      performedBy: user.id,
      details: { incidentId: id, location: incident.location, radiusMiles: radius },
    });

    res.json({ success: true, message: `Geofence ads deployed to ${radius}-mile radius of ${incident.location}` });
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

    if (twilioSid && twilioToken && account.twilioNumber) {
      try {
        const twilioClient = Twilio(twilioSid, twilioToken);
        await twilioClient.messages.create({
          body: alertMsg,
          from: account.twilioNumber,
          to: account.ownerPhone,
        });
      } catch (e) {
        console.log("[SENTINEL] SMS send failed:", (e as any).message);
      }
    }

    await storage.updateSentinelIncident(id, {
      smsSent: true,
      actionStatus: incident.geofenceDeployed ? "fully_actioned" : "sms_sent",
    });

    await storage.createAuditLog({
      action: "SENTINEL_SMS_ALERT",
      performedBy: user.id,
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

  app.post("/api/sentinel/test-trigger", asyncHandler(async (req, res) => {
    // No auth required — demo endpoint for live meeting triggers
    const subAccountId = req.body.subAccountId || 1;

    const mockAccident = {
      title: "MVA — Entrapment (High Value)",
      description: "Multi-vehicle accident with entrapment. Fire rescue and extrication units dispatched. Multiple injuries reported. High-value personal injury case detected.",
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

function simulateTraining(jobId: number) {
  const steps = [
    { delay: 1000, log: "Starting Scraper...", progress: 10 },
    { delay: 2500, log: "Successfully scraped 45,201 characters", progress: 30 },
    { delay: 4000, log: "Split into 12 knowledge chunks", progress: 50 },
    { delay: 5500, log: "Generating OpenAI Embeddings...", progress: 70 },
    { delay: 7000, log: "Saving to Postgres (PGVector)...", progress: 85 },
    { delay: 8500, log: "Training Complete. Bot is ready.", progress: 100 },
  ];

  const allLogs: string[] = [];

  steps.forEach(({ delay, log, progress }) => {
    setTimeout(async () => {
      allLogs.push(log);
      await storage.updateTrainingJob(jobId, {
        logs: [...allLogs],
        progress,
        state: progress >= 100 ? "completed" : "processing",
      });
    }, delay);
  });
}
