import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertMessageSchema, insertWorkflowSchema, insertSubAccountSchema } from "@shared/schema";
import OpenAI from "openai";
import Twilio from "twilio";

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

  app.post("/api/generate-ad-campaign", async (req, res) => {
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
          { role: "system", content: AD_CAMPAIGN_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1500,
      });

      const raw = completion.choices[0]?.message?.content ?? "";
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const campaign = JSON.parse(cleaned);

      if (!campaign.campaign_name || !campaign.targeting || !campaign.ad_copy) {
        return res.status(500).json({ error: "AI returned incomplete campaign data" });
      }

      res.json(campaign);
    } catch (err: any) {
      console.error("Ad campaign generation error:", err);
      if (err instanceof SyntaxError) {
        return res.status(500).json({ error: "AI returned invalid JSON" });
      }
      res.status(500).json({ error: err.message || "Failed to generate campaign" });
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

  // ---- Voice Agent (Vapi Integration) ----
  app.post("/api/voice-agents/create", async (req, res) => {
    try {
      const vapiKey = process.env.VAPI_API_KEY;
      if (!vapiKey) {
        return res.status(503).json({ error: "Vapi API key is not configured. Add your VAPI_API_KEY in Secrets." });
      }

      const { persona, firstMessage, voiceId, voiceProvider, objectionRules } = req.body;
      if (!persona || !firstMessage) {
        return res.status(400).json({ error: "persona and firstMessage are required" });
      }

      let objectionBlock = "";
      if (Array.isArray(objectionRules) && objectionRules.length > 0) {
        const rulesText = objectionRules
          .filter((r: any) => r.trigger && r.response)
          .map((r: any, i: number) => {
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
        firstMessage: firstMessage,
        name: `Nexus Agent - ${new Date().toLocaleDateString()}`,
      };

      const response = await fetch("https://api.vapi.ai/assistant", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${vapiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.text();
        console.error("Vapi error:", errData);
        return res.status(response.status).json({ error: "Failed to create voice agent on Vapi" });
      }

      const agent = await response.json();
      res.json({
        id: agent.id,
        name: agent.name,
        status: "created",
        phoneNumber: agent.phoneNumber || null,
      });
    } catch (err: any) {
      console.error("Voice agent creation error:", err);
      res.status(500).json({ error: err.message || "Failed to create voice agent" });
    }
  });

  app.get("/api/voice-agents", async (_req, res) => {
    try {
      const vapiKey = process.env.VAPI_API_KEY;
      if (!vapiKey) {
        return res.json([]);
      }

      const response = await fetch("https://api.vapi.ai/assistant", {
        headers: {
          Authorization: `Bearer ${vapiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
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
    } catch {
      res.json([]);
    }
  });

  app.post("/api/voice-agents/call", async (req, res) => {
    try {
      const vapiKey = process.env.VAPI_API_KEY;
      if (!vapiKey) {
        return res.status(503).json({ error: "Vapi API key is not configured. Add your VAPI_API_KEY in Secrets." });
      }

      const { assistantId, customerPhone, phoneNumberId } = req.body;
      if (!assistantId || !customerPhone) {
        return res.status(400).json({ error: "assistantId and customerPhone are required" });
      }

      const payload: any = {
        assistantId,
        customer: { number: customerPhone },
      };

      if (phoneNumberId) {
        payload.phoneNumberId = phoneNumberId;
      }

      const response = await fetch("https://api.vapi.ai/call/phone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${vapiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.text();
        console.error("Vapi outbound call error:", errData);
        return res.status(response.status).json({ error: "Failed to initiate outbound call" });
      }

      const call = await response.json();
      res.json({
        callId: call.id,
        status: call.status || "queued",
        createdAt: call.createdAt,
      });
    } catch (err: any) {
      console.error("Outbound call error:", err);
      res.status(500).json({ error: err.message || "Failed to initiate call" });
    }
  });

  const dialerJobs = new Map<string, { leads: any[]; current: number; status: string; results: any[] }>();

  app.post("/api/voice-agents/power-dial", async (req, res) => {
    try {
      const vapiKey = process.env.VAPI_API_KEY;
      if (!vapiKey) {
        return res.status(503).json({ error: "Vapi API key is not configured. Add your VAPI_API_KEY in Secrets." });
      }

      const { assistantId, phoneNumberId, leads } = req.body;
      if (!assistantId || !Array.isArray(leads) || leads.length === 0) {
        return res.status(400).json({ error: "assistantId and a non-empty leads array are required" });
      }

      if (leads.length > 50) {
        return res.status(400).json({ error: "Maximum 50 leads per batch" });
      }

      const jobId = `dial_${Date.now()}`;
      const jobData = {
        leads: leads.map((l: any) => ({ name: l.name || "Unknown", phone: l.phone })),
        current: 0,
        status: "running",
        results: [] as any[],
      };
      dialerJobs.set(jobId, jobData);

      res.json({ jobId, total: leads.length, status: "running" });

      (async () => {
        for (let i = 0; i < jobData.leads.length; i++) {
          const lead = jobData.leads[i];
          jobData.current = i;

          try {
            const payload: any = {
              assistantId,
              customer: { number: lead.phone },
            };

            if (phoneNumberId) {
              payload.phoneNumberId = phoneNumberId;
            }

            payload.assistantOverrides = {
              variableValues: { lead_name: lead.name },
            };

            const response = await fetch("https://api.vapi.ai/call/phone", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${vapiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
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
    } catch (err: any) {
      console.error("Power dialer error:", err);
      res.status(500).json({ error: err.message || "Failed to start power dialer" });
    }
  });

  app.get("/api/voice-agents/power-dial/:jobId", (req, res) => {
    const job = dialerJobs.get(req.params.jobId);
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

  app.get("/api/voice-agents/public-key", (_req, res) => {
    const publicKey = process.env.VAPI_PUBLIC_KEY;
    if (!publicKey) {
      return res.json({ publicKey: null });
    }
    res.json({ publicKey });
  });

  app.post("/api/voice-agents/generate-persona", async (req, res) => {
    try {
      if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        return res.status(503).json({ error: "AI service is not configured" });
      }

      const { businessDescription } = req.body;
      if (!businessDescription) {
        return res.status(400).json({ error: "businessDescription is required" });
      }

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
          { role: "user", content: businessDescription },
        ],
        temperature: 0.7,
        max_tokens: 300,
      });

      const raw = completion.choices[0]?.message?.content ?? "";
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const data = JSON.parse(cleaned);
      res.json(data);
    } catch (err: any) {
      console.error("Persona generation error:", err);
      res.status(500).json({ error: "Failed to generate persona" });
    }
  });

  // ---- Phone Number Provisioning (Twilio + Vapi) ----

  function getTwilioClient() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return null;
    return Twilio(sid, token);
  }

  app.get("/api/phone-numbers/search", async (req, res) => {
    try {
      const twilioClient = getTwilioClient();
      if (!twilioClient) {
        return res.status(503).json({ error: "Twilio credentials are not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Secrets." });
      }

      const areaCode = parseInt((req.query.areaCode as string) || "305") || 305;
      const country = (req.query.country as string) || "US";
      const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);

      const numbers = await twilioClient.availablePhoneNumbers(country).local.list({
        areaCode,
        limit,
      });

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
    } catch (err: any) {
      console.error("Twilio search error:", err);
      res.status(500).json({ error: err.message || "Failed to search numbers" });
    }
  });

  app.post("/api/phone-numbers/purchase", async (req, res) => {
    try {
      const twilioClient = getTwilioClient();
      if (!twilioClient) {
        return res.status(503).json({ error: "Twilio credentials are not configured." });
      }

      const { phoneNumber, assistantId } = req.body;
      if (!phoneNumber) {
        return res.status(400).json({ error: "phoneNumber is required" });
      }

      const domain = process.env.REPLIT_DOMAINS?.split(",")[0] || process.env.REPLIT_DEV_DOMAIN || "";
      const smsWebhookUrl = domain ? `https://${domain}/api/sms-webhook` : "";

      const purchased = await twilioClient.incomingPhoneNumbers.create({ phoneNumber });

      let vapiPhoneId = null;
      const vapiKey = process.env.VAPI_API_KEY;
      if (vapiKey && assistantId) {
        try {
          const vapiRes = await fetch("https://api.vapi.ai/phone-number", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${vapiKey}`,
              "Content-Type": "application/json",
            },
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

      const updateOpts: any = {};
      if (smsWebhookUrl) {
        updateOpts.smsUrl = smsWebhookUrl;
        updateOpts.smsMethod = "POST";
      }
      updateOpts.voiceUrl = "https://api.vapi.ai/twilio/voice/handler";
      updateOpts.voiceMethod = "POST";

      try {
        await twilioClient.incomingPhoneNumbers(purchased.sid).update(updateOpts);
        console.log(`Full-duplex configured: Voice → Vapi, SMS → ${smsWebhookUrl}`);
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
    } catch (err: any) {
      console.error("Twilio purchase error:", err);
      res.status(500).json({ error: err.message || "Failed to purchase number" });
    }
  });

  app.get("/api/phone-numbers", async (_req, res) => {
    try {
      const twilioClient = getTwilioClient();
      if (!twilioClient) {
        return res.json([]);
      }

      const numbers = await twilioClient.incomingPhoneNumbers.list({ limit: 20 });
      res.json(
        numbers.map((n) => ({
          sid: n.sid,
          phoneNumber: n.phoneNumber,
          friendlyName: n.friendlyName,
          smsUrl: n.smsUrl,
          voiceUrl: n.voiceUrl,
          dateCreated: n.dateCreated,
        }))
      );
    } catch (err: any) {
      console.error("Twilio list error:", err);
      res.json([]);
    }
  });

  // ---- SMS Webhook (Twilio inbound → AI auto-reply) ----

  app.post("/api/sms-webhook", async (req, res) => {
    try {
      const incomingMsg = req.body.Body;
      const senderNumber = req.body.From;
      const toNumber = req.body.To;

      if (!incomingMsg || !senderNumber) {
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      console.log(`SMS from ${senderNumber}: ${incomingMsg}`);

      let aiReply = "Thanks for your message! We'll get back to you shortly.";

      if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              {
                role: "system",
                content: "You are a helpful business receptionist. Keep text replies under 160 characters. Be warm, professional, and concise. If someone wants to book an appointment, suggest they call the office number.",
              },
              { role: "user", content: incomingMsg },
            ],
            max_tokens: 100,
            temperature: 0.7,
          });
          aiReply = completion.choices[0]?.message?.content || aiReply;
        } catch (aiErr: any) {
          console.error("AI reply error:", aiErr.message);
        }
      }

      const twilioClient = getTwilioClient();
      if (twilioClient && toNumber) {
        await twilioClient.messages.create({
          body: aiReply,
          from: toNumber,
          to: senderNumber,
        });
      }

      res.type("text/xml").send("<Response></Response>");
    } catch (err: any) {
      console.error("SMS webhook error:", err);
      res.type("text/xml").send("<Response></Response>");
    }
  });

  app.get("/api/phone-numbers/config", (_req, res) => {
    const hasTwilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    const hasVapi = !!process.env.VAPI_API_KEY;
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
