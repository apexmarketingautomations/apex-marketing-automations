import type { Express, Request, Response } from "express";
import { deals, appointments, messages } from "@shared/schema";
import { z } from "zod";
import { aiChat, aiChatStream, isAIConfigured } from "../aiGateway";
import { asyncHandler, logUsageInternal, getIndustryContext, getLanguageInstruction } from "./helpers";
import { startTrace, recordStepValue } from "../traceRecorder";

export function registerChatRoutes(app: Express) {
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

    if (!isAIConfigured()) {
      const { pickRecoveryLine } = await import("../messaging/aiRecovery");
      const rec = pickRecoveryLine({ reason: "ai_failed", threadKey: `sales:${ip}`, channel: "web" });
      return res.json({ reply: rec.text });
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

    const result = await aiChat(chatMessages, { temperature: 0.8, maxTokens: 1024, route: "sales-chat" });
    let reply = result.text;
    if (!reply) {
      const { pickRecoveryLine, classifyAiFailure } = await import("../messaging/aiRecovery");
      const reason = result.ok ? "ai_failed" : classifyAiFailure(result.errorMessage);
      const rec = pickRecoveryLine({ reason, threadKey: `sales:${ip}`, channel: "web" });
      reply = rec.text;
      console.warn(`[SALES-CHAT][AI-RECOVERY] reason=${rec.reason} variant=${rec.variantIndex} aiOk=${result.ok} aiErr=${result.errorMessage}`);
    }
    await logUsageInternal(null, "AI_CHAT", 1, "Sales chatbot response");
    res.json({ reply });
  }));

  app.post("/api/chat", asyncHandler(async (req, res) => {
    if (!isAIConfigured()) {
      const { pickRecoveryLine } = await import("../messaging/aiRecovery");
      const rec = pickRecoveryLine({ reason: "ai_failed", threadKey: `chat:${(req.ip || "anon")}`, channel: "web" });
      return res.status(503).json({ reply: rec.text });
    }

    const parsed = chatBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const subAccountId = (req as any).subAccountId as number | undefined;
    const traceId = (req as any).eventTraceId as string | undefined;
    const trace = (subAccountId && traceId)
      ? { traceId, subAccountId }
      : subAccountId ? startTrace(subAccountId) : null;

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

    const aiStart = Date.now();
    const { pickRecoveryLine: pickRecChat, classifyAiFailure: classifyChat } = await import("../messaging/aiRecovery");
    const chatThreadKey = `chat:${subAccountId || "anon"}:${(req.ip || "anon")}`;
    let reply: string;
    let chatRecoveryUsed: { reason: string; persona: string } | null = null;
    try {
      const result = await aiChat(chatMessages, { temperature: 0.7, maxTokens: 1024, route: "chat-widget" });
      if (result.ok && result.text) {
        reply = result.text;
      } else {
        const reason = classifyChat(result.errorMessage);
        const rec = pickRecChat({ reason, threadKey: chatThreadKey, channel: "web" });
        reply = rec.text;
        chatRecoveryUsed = { reason: rec.reason, persona: rec.persona };
        console.warn(`[CHAT-WIDGET][AI-RECOVERY] reason=${rec.reason} variant=${rec.variantIndex} aiOk=${result.ok} aiErr=${result.errorMessage}`);
      }
      if (trace) {
        recordStepValue(trace, "ai_chat", chatRecoveryUsed ? "error" : "success", Date.now() - aiStart, {
          provider: "ai",
          metadata: { route: "chat-widget", replyLength: reply.length, recovery: chatRecoveryUsed || undefined },
        });
      }
    } catch (aiErr: any) {
      const reason = classifyChat(aiErr?.message);
      const rec = pickRecChat({ reason, threadKey: chatThreadKey, channel: "web" });
      reply = rec.text;
      chatRecoveryUsed = { reason: rec.reason, persona: rec.persona };
      console.error(`[CHAT-WIDGET][AI-RECOVERY] thrown reason=${rec.reason} variant=${rec.variantIndex} err=${aiErr?.message}`);
      if (trace) {
        recordStepValue(trace, "ai_chat", "error", Date.now() - aiStart, {
          provider: "ai",
          error: aiErr.message,
          metadata: { route: "chat-widget", recovery: chatRecoveryUsed },
        });
      }
    }

    await logUsageInternal(null, "AI_CHAT", 1, "Chat widget AI response");

    res.json({ reply });
  }));

  app.post("/api/chat/stream", asyncHandler(async (req, res) => {
    try {
      if (!isAIConfigured()) {
        return res.status(503).json({ reply: "Chat service is currently offline. Please try again later." });
      }

      const parsed = chatBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const subAccountId = (req as any).subAccountId as number | undefined;
      const traceId = (req as any).eventTraceId as string | undefined;
      const trace = (subAccountId && traceId)
        ? { traceId, subAccountId }
        : subAccountId ? startTrace(subAccountId) : null;

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

      const streamStart = Date.now();
      let totalChars = 0;
      try {
        const stream = aiChatStream(chatMessages, { temperature: 0.7, maxTokens: 1024, route: "chat-widget-stream" });
        for await (const chunk of stream) {
          totalChars += chunk.length;
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }
        if (trace) {
          recordStepValue(trace, "ai_chat", "success", Date.now() - streamStart, {
            provider: "ai",
            metadata: { route: "chat-widget-stream", totalChars },
          });
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        await logUsageInternal(null, "AI_CHAT", 1, "Chat widget AI response (stream)");
      } catch (streamErr: any) {
        if (trace) {
          recordStepValue(trace, "ai_chat", "error", Date.now() - streamStart, {
            provider: "ai",
            error: streamErr.message,
            metadata: { route: "chat-widget-stream" },
          });
        }
        throw streamErr;
      }
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Streaming failed" });
      } else {
        res.write(`data: ${JSON.stringify({ error: error.message || "Streaming failed" })}\n\n`);
        res.end();
      }
    }
  }));
}
