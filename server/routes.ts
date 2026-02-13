import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertMessageSchema, insertWorkflowSchema, insertSubAccountSchema, insertSavedSiteSchema } from "@shared/schema";
import { z } from "zod";
import OpenAI from "openai";
import Twilio from "twilio";

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

  const SITE_SYSTEM_PROMPT = `You are a landing-page architect for a SaaS site-builder.

When the user describes a business, return a JSON object with this exact structure:

{
  "theme": {
    "primary": "<hex color>",
    "bg": "<hex background color>",
    "text": "<hex text color>",
    "font": "<font family name>"
  },
  "sections": [
    {
      "type": "HERO",
      "props": {
        "title": "<headline>",
        "subtitle": "<subheadline>",
        "cta": "<button text>",
        "image": "<unsplash URL for a relevant background image>"
      }
    },
    {
      "type": "FEATURES",
      "props": {
        "title": "<section heading>",
        "features": [
          { "icon": "<icon name>", "title": "<feature title>", "desc": "<short description>" },
          { "icon": "<icon name>", "title": "<feature title>", "desc": "<short description>" },
          { "icon": "<icon name>", "title": "<feature title>", "desc": "<short description>" }
        ]
      }
    },
    {
      "type": "BOOKING",
      "props": {
        "title": "<form heading>",
        "formId": "<unique form id>"
      }
    }
  ]
}

Rules:
- Always return exactly 3 sections: HERO, FEATURES, BOOKING in that order.
- icon must be one of: ShieldCheck, Clock, Sparkles, Star, Dumbbell, Heart, Zap, Trophy, CheckCircle2
- Use real Unsplash image URLs that are relevant to the business type. Format: https://images.unsplash.com/photo-XXXXX?q=80&w=2070&auto=format&fit=crop
- Choose theme colors that match the business vibe (luxury = gold/black, fitness = red/black, medical = blue/white, etc.)
- font should be either "Playfair Display" for luxury/elegant or "Inter" for modern/clean
- Write compelling, concise marketing copy
- Return ONLY the JSON object, no markdown, no explanation, no code fences.`;

  const promptSchema = z.object({
    prompt: z.string().min(1, "prompt is required").max(2000),
  });

  app.post("/api/generate-site", asyncHandler(async (req, res) => {
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = promptSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SITE_SYSTEM_PROMPT },
        { role: "user", content: parsed.data.prompt },
      ],
      temperature: 0.7,
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

  function getTwilioClient() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return null;
    return Twilio(sid, token);
  }

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

  return httpServer;
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
