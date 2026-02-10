import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertMessageSchema, insertWorkflowSchema, insertSubAccountSchema } from "@shared/schema";
import OpenAI from "openai";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ---- Sub-Accounts ----
  app.get("/api/accounts", async (_req, res) => {
    const accounts = await storage.getSubAccounts();
    res.json(accounts);
  });

  app.post("/api/accounts", async (req, res) => {
    const parsed = insertSubAccountSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const account = await storage.createSubAccount(parsed.data);
    res.status(201).json(account);
  });

  // ---- Messages ----
  app.get("/api/messages/:subAccountId", async (req, res) => {
    const subAccountId = parseInt(req.params.subAccountId);
    if (isNaN(subAccountId)) return res.status(400).json({ error: "Invalid subAccountId" });
    const msgs = await storage.getMessages(subAccountId);
    res.json(msgs);
  });

  app.post("/api/messages", async (req, res) => {
    const parsed = insertMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const msg = await storage.createMessage(parsed.data);
    res.status(201).json(msg);
  });

  // ---- Workflows ----
  app.get("/api/workflows", async (_req, res) => {
    const wfs = await storage.getWorkflows();
    res.json(wfs);
  });

  app.get("/api/workflows/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const wf = await storage.getWorkflow(id);
    if (!wf) return res.status(404).json({ error: "Not found" });
    res.json(wf);
  });

  app.post("/api/workflows", async (req, res) => {
    const parsed = insertWorkflowSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const wf = await storage.createWorkflow(parsed.data);
    res.status(201).json(wf);
  });

  app.patch("/api/workflows/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const wf = await storage.updateWorkflow(id, req.body);
    if (!wf) return res.status(404).json({ error: "Not found" });
    res.json(wf);
  });

  // ---- Bot Training Jobs ----
  app.post("/api/bots/train", async (req, res) => {
    const { url, persona } = req.body;
    if (!url || !persona) return res.status(400).json({ error: "url and persona are required" });

    const job = await storage.createTrainingJob({ url, persona });

    simulateTraining(job.id);

    res.status(201).json({ jobId: job.id });
  });

  app.get("/api/jobs/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const job = await storage.getTrainingJob(id);
    if (!job) return res.status(404).json({ error: "Not found" });
    res.json({
      state: job.state,
      progress: job.progress,
      logs: job.logs,
    });
  });

  // ---- Blueprints / Onboarding ----
  app.get("/api/blueprints", async (_req, res) => {
    const bps = await storage.getBlueprints();
    res.json(bps);
  });

  app.get("/api/blueprints/:industryId", async (req, res) => {
    const bp = await storage.getBlueprintByIndustryId(req.params.industryId);
    if (!bp) return res.status(404).json({ error: "Blueprint not found" });
    res.json(bp);
  });

  app.post("/api/onboarding/:industryId", async (req, res) => {
    const bp = await storage.getBlueprintByIndustryId(req.params.industryId);
    if (!bp) return res.status(404).json({ error: "Blueprint not found for this industry" });

    const account = await storage.createSubAccount({
      name: `${bp.title} Account`,
      twilioNumber: `+1555${Math.floor(1000 + Math.random() * 9000)}`,
    });

    res.status(201).json({ account, blueprint: bp });
  });

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

  app.post("/api/generate-site", async (req, res) => {
    try {
      if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        return res.status(503).json({ error: "AI service is not configured" });
      }

      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "prompt is required" });
      }

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: SITE_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1500,
      });

      const raw = completion.choices[0]?.message?.content ?? "";
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

      const siteData = JSON.parse(cleaned);

      if (!siteData.theme || !Array.isArray(siteData.sections)) {
        return res.status(500).json({ error: "AI returned invalid site structure" });
      }

      res.json(siteData);
    } catch (err: any) {
      console.error("Site generation error:", err);
      if (err instanceof SyntaxError) {
        return res.status(500).json({ error: "AI returned invalid JSON" });
      }
      res.status(500).json({ error: err.message || "Failed to generate site" });
    }
  });

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

  app.post("/api/generate-liquid-site", async (req, res) => {
    try {
      if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        return res.status(503).json({ error: "AI service is not configured" });
      }

      const { device, referrer, timeOfDay, hour, language } = req.body;

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
      const siteData = JSON.parse(cleaned);

      if (!siteData.theme || !Array.isArray(siteData.sections)) {
        return res.status(500).json({ error: "AI returned invalid site structure" });
      }

      res.json(siteData);
    } catch (err: any) {
      console.error("Liquid site generation error:", err);
      if (err instanceof SyntaxError) {
        return res.status(500).json({ error: "AI returned invalid JSON" });
      }
      res.status(500).json({ error: err.message || "Failed to generate personalized site" });
    }
  });

  // ---- Chat Widget (AI Assistant) ----
  const CHAT_SYSTEM_PROMPT = `You are a friendly, professional booking assistant for a premium business. Your goal is to help visitors book appointments, answer questions about services, and provide a warm, helpful experience.

Rules:
- Keep responses short (1-3 sentences max)
- Be conversational and warm, use a friendly tone
- If someone wants to book, ask for their preferred date and time
- If you don't know something specific about the business, say you'll connect them with the team
- Never make up specific pricing or availability — offer to check or connect them with staff
- End messages with a helpful next step or question when appropriate`;

  app.post("/api/chat", async (req, res) => {
    try {
      if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        return res.status(503).json({ reply: "Chat service is currently offline. Please try again later." });
      }

      const { message, conversationHistory } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "message is required" });
      }

      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: CHAT_SYSTEM_PROMPT },
      ];

      if (Array.isArray(conversationHistory)) {
        for (const msg of conversationHistory.slice(-10)) {
          messages.push({
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.text,
          });
        }
      }

      messages.push({ role: "user", content: message });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        temperature: 0.7,
        max_tokens: 200,
      });

      const reply = completion.choices[0]?.message?.content ?? "I'm here to help! Could you tell me more about what you're looking for?";

      res.json({ reply });
    } catch (err: any) {
      console.error("Chat error:", err);
      res.json({ reply: "I'm having a moment — could you try again?" });
    }
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
