import type { Express, Request, Response } from "express";
import { messages } from "@shared/schema";
import { storage } from "../storage";
import { z } from "zod";
import { geminiChat, isGeminiConfigured } from "../gemini";
import { asyncHandler, getIndustryContext, getTwilioClient, vapiConfig } from "./helpers";

export function registerVoiceRoutes(app: Express) {
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
      } catch (err: any) {
        console.error(`[VOICE] Failed to resolve ElevenLabs key for account ${subAccountId}:`, err.message);
      }
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
}
