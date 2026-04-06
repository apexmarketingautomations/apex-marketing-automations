import type { Express, Request, Response } from "express";
import { contacts, messages, subAccounts, integrationConnections } from "@shared/schema";
import { sql, eq, and, or } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { z } from "zod";
import { aiChat, isAIConfigured } from "../aiGateway";
import { ProgressStream } from "../streaming";
import crypto from "crypto";
import { asyncHandler, getUserId, requireAdmin, getIndustryContext, getLanguageInstruction, getTwilioClient, vapiConfig, verifyAccountOwnership } from "./helpers";
import { broadcastNewMessage } from "../sse";
import { enforceSmsProvider } from "../smsGatewayGuard";
import { assembleDmContext, buildDmMessages } from "../dmContextAssembler";
import { extractInsightsFromConversation } from "../sharedIntelligence";
import { startTrace, recordStepValue } from "../traceRecorder";
import { resolveSubAccount, isRoutingFailure } from "../routing/resolver";
import { persistRoutingFailure } from "../routing/failureQueue";
import { withIdempotency, markEventCompleted, markEventFailed } from "../idempotency";
import { extractAndStoreInsights } from "../services/insightExtractor";

export function registerWebhooksRoutes(app: Express) {
  if (!process.env.TELEGRAM_WEBHOOK_SECRET_SALT && !process.env.SESSION_SECRET) {
    console.error("[STARTUP] WARNING: Neither TELEGRAM_WEBHOOK_SECRET_SALT nor SESSION_SECRET is set. Telegram webhook setup and verification will fail at runtime.");
  }

  // ---- Unified Webhook (Twilio inbound SMS/WhatsApp/Messenger -> AI auto-reply) ----

  function detectChannel(from: string): "whatsapp" | "messenger" | "sms" {
    if (from.startsWith("whatsapp:")) return "whatsapp";
    if (from.startsWith("messenger:")) return "messenger";
    return "sms";
  }

  function stripChannelPrefix(addr: string): string {
    return addr.replace(/^(whatsapp:|messenger:)/, "");
  }

  app.post(
    "/api/sms-webhook",
    withIdempotency({
      source: "twilio",
      extractExternalId: (req) => req.body?.MessageSid as string | undefined,
      eventType: "message.received",
      maxRetries: 3,
    }),
    async (req, res) => {
    try {
      const incomingMsg = req.body.Body as string | undefined;
      const senderRaw = req.body.From as string | undefined;
      const toRaw = req.body.To as string | undefined;
      const traceId = req.eventTraceId;

      if (!incomingMsg || !senderRaw) {
        await markEventCompleted(req);
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      const channel = detectChannel(senderRaw);

      // Pure SMS traffic is handled exclusively by /api/twilio/inbound-sms pipeline
      // to prevent duplicate processing. Forward internally by delegating to that handler.
      if (channel === "sms") {
        console.log(`[SMS-WEBHOOK] Delegating pure SMS from ${senderRaw} to /api/twilio/inbound-sms pipeline`);
        await markEventCompleted(req);
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      const senderClean = stripChannelPrefix(senderRaw);

      console.log(`[${channel.toUpperCase()}] from ${senderClean}: ${incomingMsg.substring(0, 100)}`);

      const toClean = toRaw ? stripChannelPrefix(toRaw) : "";

      const routingResult = await resolveSubAccount({
        phone: toClean || undefined,
        channel,
        source: channel,
      });

      if (isRoutingFailure(routingResult)) {
        console.error(`[${channel.toUpperCase()}] Routing failed for inbound from ${senderClean}: ${routingResult.reason}`);
        await persistRoutingFailure({
          phone: senderClean,
          channel,
          source: channel,
          reason: routingResult.reason,
          rawPayload: { From: senderRaw, To: toRaw, Body: incomingMsg.substring(0, 500) },
        });
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      const matchedAccountId = routingResult.subAccountId;
      console.log(`[${channel.toUpperCase()}][PIPELINE-START] channel=${channel}, sender=${senderClean}, to=${toClean}, subAccountId=${matchedAccountId}`);

      const trace = startTrace(matchedAccountId, { contactPhone: senderClean });

      const t0 = Date.now();
      const inboundSid = req.body.MessageSid as string | undefined;
      recordStepValue(trace, "message_received", "success", Date.now() - t0, {
        provider: "twilio",
        metadata: { channel, body: incomingMsg.substring(0, 200) },
        disambiguator: inboundSid || `recv-${senderClean}-${Date.now()}`,
      });

      const { isOptOutMessage, isOptInMessage, handleSmsOptOut, handleSmsOptIn } = await import("../optOutGuard");
      if (isOptOutMessage(incomingMsg)) {
        await handleSmsOptOut(senderClean, matchedAccountId);
        console.log(`[OPT-OUT] ${senderClean} opted out of SMS`);

        const twilioClient = await getTwilioClient(matchedAccountId);
        if (twilioClient && toRaw) {
          await enforceSmsProvider(channel, "twilio", { subAccountId: matchedAccountId, phone: senderRaw, source: "webhook-opt-out" });
          await twilioClient.messages.create({
            body: "You have been unsubscribed and will no longer receive messages from us. Reply START to re-subscribe.",
            from: toRaw,
            to: senderRaw,
          });
        }

        await markEventCompleted(req);
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      if (isOptInMessage(incomingMsg)) {
        await handleSmsOptIn(senderClean, matchedAccountId);
        console.log(`[OPT-IN] ${senderClean} opted back in to SMS`);

        const twilioClient = await getTwilioClient(matchedAccountId);
        if (twilioClient && toRaw) {
          await enforceSmsProvider(channel, "twilio", { subAccountId: matchedAccountId, phone: senderRaw, source: "webhook-opt-in" });
          await twilioClient.messages.create({
            body: "You have been re-subscribed and will receive messages from us again.",
            from: toRaw,
            to: senderRaw,
          });
        }

        await markEventCompleted(req);
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      const messageSid = req.body.MessageSid as string | undefined;
      const crmStart = Date.now();
      try {
        const storedMsg = await storage.createMessage({
          subAccountId: matchedAccountId,
          contactPhone: senderClean,
          body: incomingMsg,
          direction: "inbound",
          channel,
          status: "received",
          traceId: trace.traceId,
          messageSid: messageSid || null,
        });
        broadcastNewMessage(matchedAccountId, {
          id: storedMsg.id,
          subAccountId: matchedAccountId,
          contactPhone: senderClean,
          body: incomingMsg,
          direction: "inbound",
          channel,
          status: "received",
          createdAt: new Date().toISOString(),
        });
        console.log(`[${channel.toUpperCase()}][CRM-WRITE] Inbound message stored — messageId=${storedMsg.id}, sender=${senderClean}, subAccountId=${matchedAccountId}, messageSid=${messageSid || "none"}, elapsed=${Date.now() - crmStart}ms`);
        recordStepValue(trace, "crm_write", "success", Date.now() - crmStart, {
          metadata: { channel, direction: "inbound", messageId: storedMsg.id },
          disambiguator: messageSid || String(storedMsg.id),
        });
      } catch (e: any) {
        console.error(`[${channel.toUpperCase()}][CRM-WRITE] Message storage error — sender=${senderClean}, subAccountId=${matchedAccountId}, error=${e.message}`);
        recordStepValue(trace, "crm_write", "error", Date.now() - crmStart, {
          error: e.message,
          disambiguator: messageSid || `err-${senderClean}`,
        });
      }

      if (channel === "whatsapp") {
        const autoStart = Date.now();
        import("./v1").then(({ fireAutomationTriggerGlobal }) =>
          fireAutomationTriggerGlobal("OnWhatsAppReply", matchedAccountId, {
            senderPhone: senderClean,
            message: incomingMsg,
            channel: "whatsapp",
          })
        ).then(() => {
          recordStepValue(trace, "automation_triggered", "success", Date.now() - autoStart, {
            metadata: { trigger: "OnWhatsAppReply" },
          });
        }).catch(e => {
          console.error("[WEBHOOKS] WhatsApp automation trigger failed:", e instanceof Error ? e.message : e);
          recordStepValue(trace, "automation_triggered", "error", Date.now() - autoStart, {
            error: e instanceof Error ? e.message : String(e),
            metadata: { trigger: "OnWhatsAppReply" },
          });
        });
      }

      let aiReply = "Thanks for your message! We'll get back to you shortly.";

      if (isAIConfigured()) {
        const aiStart = Date.now();
        try {
          const dmCtx = await assembleDmContext({
            subAccountId: matchedAccountId,
            contactPhone: senderClean,
            channel,
          });
          const aiMessages = await buildDmMessages(dmCtx, channel, incomingMsg);
          const langInstr = getLanguageInstruction(dmCtx.language);
          if (langInstr && aiMessages.length > 0 && aiMessages[0].role === "system") {
            aiMessages[0].content += langInstr;
          }
          const smsAiResult = await aiChat(aiMessages, { temperature: 0.7, maxTokens: 1024, route: "webhook-sms-reply" });
          aiReply = smsAiResult.text || aiReply;
          console.log(`[${channel.toUpperCase()}][AI-REPLY] Generated — provider=${smsAiResult.provider}, replyLength=${aiReply.length}, elapsed=${Date.now() - aiStart}ms`);

          extractInsightsFromConversation(
            dmCtx.threadHistory.map(h => ({ role: h.role, content: h.content })),
            matchedAccountId,
            incomingMsg
          ).catch(err => console.error(`[SHARED-INTEL] Background extraction failed:`, err instanceof Error ? err.message : err));
          recordStepValue(trace, "ai_response_generated", "success", Date.now() - aiStart, {
            provider: "ai",
            metadata: { replyLength: aiReply.length },
            disambiguator: inboundSid || `ai-${senderClean}`,
          });
        } catch (aiErr: any) {
          console.error(`[${channel.toUpperCase()}][AI-REPLY] Error — sender=${senderClean}, subAccountId=${matchedAccountId}, error=${aiErr.message}`);
          recordStepValue(trace, "ai_response_generated", "error", Date.now() - aiStart, {
            provider: "ai",
            error: aiErr.message,
            disambiguator: inboundSid ? `${inboundSid}-ai-err` : `ai-err-${senderClean}`,
          });
        }
      }

      const sendStart = Date.now();
      const twilioClient = await getTwilioClient(matchedAccountId);
      if (twilioClient && toRaw) {
        const replyFrom = channel === "whatsapp" ? `whatsapp:${stripChannelPrefix(toRaw)}`
          : channel === "messenger" ? `messenger:${stripChannelPrefix(toRaw)}`
          : toRaw;

        if (channel === "whatsapp") {
          console.log(`[WHATSAPP] Sending AI reply via Twilio — from=${replyFrom} to=${senderRaw} account=${matchedAccountId}`);
        }

        let outboundSid: string | null = null;
        let outboundStatus = "sent";
        try {
          await enforceSmsProvider(channel, "twilio", { subAccountId: matchedAccountId, phone: senderRaw, source: "webhook-ai-reply" });
          const sentReply = await twilioClient.messages.create({
            body: aiReply,
            from: replyFrom,
            to: senderRaw,
          });
          outboundSid = sentReply.sid;
          if (channel === "whatsapp") {
            console.log(`[WHATSAPP] Reply sent successfully — sid=${sentReply.sid} to=${senderClean}`);
          }
          recordStepValue(trace, "outbound_send", "success", Date.now() - sendStart, {
            provider: "twilio",
            metadata: { channel, to: senderClean, messageSid: sentReply.sid },
            disambiguator: sentReply.sid || `reply-${senderClean}`,
          });
        } catch (sendErr: any) {
          outboundStatus = "failed";
          console.error(`[${channel.toUpperCase()}] Outbound send failed for account ${matchedAccountId}:`, sendErr.message);
          recordStepValue(trace, "outbound_send", "error", Date.now() - sendStart, {
            provider: "twilio",
            error: sendErr.message,
            metadata: { channel, to: senderClean },
            disambiguator: `reply-err-${senderClean}`,
          });
        }

        try {
          const outMsg = await storage.createMessage({
            subAccountId: matchedAccountId,
            contactPhone: senderClean,
            body: aiReply,
            direction: "outbound",
            channel,
            status: outboundStatus,
            messageSid: outboundSid || null,
            traceId: trace.traceId,
          });
          broadcastNewMessage(matchedAccountId, {
            id: outMsg.id,
            subAccountId: matchedAccountId,
            contactPhone: senderClean,
            body: aiReply,
            direction: "outbound",
            channel,
            status: outboundStatus,
            createdAt: new Date().toISOString(),
          });
        } catch (logErr: any) {
          console.error("[WEBHOOKS] Failed to log outbound reply:", logErr.message);
        }
      }

      console.log(`[${channel.toUpperCase()}][PIPELINE-COMPLETE] sender=${senderClean}, subAccountId=${matchedAccountId}, messageSid=${messageSid || "none"}, aiConfigured=${isAIConfigured()}, twilioAvailable=${!!(await getTwilioClient(matchedAccountId))}`);
      await markEventCompleted(req);
      res.type("text/xml").send("<Response></Response>");
    } catch (err: any) {
      console.error(`[UNIFIED-WEBHOOK][ERROR] Unhandled pipeline error — from=${req.body?.From}, to=${req.body?.To}, error=${err.message}`, err.stack?.substring(0, 500));
      await markEventFailed(req, err.message).catch(() => {});
      res.type("text/xml").send("<Response></Response>");
    }
  });

  // ---- Production Twilio Inbound SMS Pipeline ----
  // POST /api/twilio/inbound-sms
  // Validates Twilio signature, enforces idempotency, CRM upsert, compliance, Vapi AI, fallback/retry

  function generateThreadId(fromE164: string, toE164: string): string {
    return `${fromE164}::${toE164}`;
  }

  async function validateTwilioSignature(req: Request, overrideAuthToken?: string): Promise<boolean> {
    const authToken = overrideAuthToken || process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      console.error("[TWILIO-INBOUND] No auth token available — rejecting request (configure TWILIO_AUTH_TOKEN)");
      return false;
    }
    try {
      const twilio = await import("twilio");
      const validateRequest = (twilio.default || twilio).validateRequest || (twilio as any).validateRequest;
      if (!validateRequest) {
        console.error("[TWILIO-INBOUND] validateRequest function not found in twilio module — rejecting");
        return false;
      }
      const signature = req.headers["x-twilio-signature"] as string || "";
      if (!signature) {
        console.warn("[TWILIO-INBOUND] Missing x-twilio-signature header — rejecting");
        return false;
      }
      const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
      return validateRequest(authToken, signature, url, req.body);
    } catch (e: any) {
      console.error("[TWILIO-INBOUND] Signature validation error:", e.message);
      return false;
    }
  }

  async function callVapiChat(assistantId: string, sessionId: string, userMessage: string): Promise<string | null> {
    if (!vapiConfig.isConfigured) return null;
    try {
      const response = await fetch("https://api.vapi.ai/chat", {
        method: "POST",
        headers: vapiConfig.privateHeaders(),
        body: JSON.stringify({
          assistantId,
          sessionId,
          input: { text: userMessage },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Vapi /chat returned ${response.status}: ${errText.slice(0, 200)}`);
      }
      const data = await response.json() as any;
      const reply = data?.output?.text || data?.output || data?.message?.content || data?.content || null;
      return typeof reply === "string" ? reply : null;
    } catch (e: any) {
      throw new Error(`Vapi chat failed: ${e.message}`);
    }
  }

  function normalizeToE164(raw: string): string {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    if (digits.startsWith("+")) return raw.replace(/[^\d+]/g, "");
    return `+${digits}`;
  }

  async function upsertCrmContact(phone: string, subAccountId: number): Promise<{ id: number; isNew: boolean }> {
    const e164 = normalizeToE164(phone);
    const digits = phone.replace(/\D/g, "");
    const last10 = digits.slice(-10);

    const existing = await db.select()
      .from(contacts)
      .where(and(
        eq(contacts.subAccountId, subAccountId),
        or(
          eq(contacts.phone, e164),
          eq(contacts.phone, phone),
          eq(contacts.phone, `+1${last10}`),
          eq(contacts.phone, `+${digits}`),
          eq(contacts.phone, last10)
        )
      ))
      .orderBy(contacts.id)
      .limit(5);

    if (existing.length > 0) {
      const canonical = existing[0];
      if (canonical.phone !== e164) {
        try {
          await db.update(contacts).set({ phone: e164 }).where(eq(contacts.id, canonical.id));
          console.log(`[CRM-UPSERT] Normalized phone for contact ${canonical.id}: "${canonical.phone}" -> "${e164}"`);
        } catch (normErr: any) {
          console.warn(`[CRM-UPSERT] Phone normalization failed (non-fatal): ${normErr.message}`);
        }
      }
      if (existing.length > 1) {
        console.warn(`[CRM-UPSERT] Found ${existing.length} duplicate contacts for phone ${e164} in account ${subAccountId}. Using canonical id=${canonical.id}, duplicates: ${existing.slice(1).map(c => c.id).join(",")}`);
      }
      console.log(`[CRM-UPSERT] Resolved existing contact id=${canonical.id} name="${canonical.firstName}" phone="${e164}" subAccount=${subAccountId}`);
      return { id: canonical.id, isNew: false };
    }

    const newContact = await storage.createContact({
      subAccountId,
      firstName: "Unknown",
      phone: e164,
      source: "sms_inbound",
      tags: ["sms", "inbound"],
    });
    console.log(`[CRM-UPSERT] Created new contact id=${newContact.id} phone="${e164}" subAccount=${subAccountId} firstName="Unknown"`);
    return { id: newContact.id, isNew: true };
  }

  app.post(
    "/api/twilio/inbound-sms",
    withIdempotency({
      source: "twilio",
      extractExternalId: (req) => req.body?.MessageSid as string | undefined,
      eventType: "message.received",
      maxRetries: 3,
    }),
    async (req, res) => {
    const traceId = req.eventTraceId || crypto.randomUUID();
    const t0 = Date.now();

    if (!req.body._resolvedSubAccountId) {
      console.log(JSON.stringify({
        event: "legacy_inbound_webhook_used",
        timestamp: new Date().toISOString(),
        trace_id: traceId,
        to: req.body.To,
        from: req.body.From,
        deprecation: "Use scoped webhook /api/webhook/sms/:subAccountId instead",
      }));
    }

    console.log(`[TWILIO-INBOUND][${traceId}] Received inbound SMS`);

    try {
      // 1. Signature validation — uses master token for legacy route, scoped token via _resolvedSubAccountId
      const isValid = await validateTwilioSignature(req);
      if (!isValid) {
        console.warn(`[TWILIO-INBOUND][${traceId}] Invalid Twilio signature — rejected`);
        await markEventFailed(req, "Invalid Twilio signature").catch(() => {});
        res.status(403).type("text/xml").send("<Response></Response>");
        return;
      }

      const messageSid = req.body.MessageSid as string | undefined;
      const incomingMsg = req.body.Body as string | undefined;
      const senderRaw = req.body.From as string | undefined;
      const toRaw = req.body.To as string | undefined;

      if (!incomingMsg || !senderRaw) {
        console.warn(`[TWILIO-INBOUND][${traceId}] Missing Body or From`);
        await markEventCompleted(req);
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      const senderClean = senderRaw.replace(/^(whatsapp:|messenger:)/, "");
      const toClean = toRaw ? toRaw.replace(/^(whatsapp:|messenger:)/, "") : "";

      // 2. Resolve sub-account from URL param or To number
      let subAccountId: number;
      if (req.body._resolvedSubAccountId) {
        subAccountId = req.body._resolvedSubAccountId;
        console.log(`[TRACE-ACCT] Using pre-resolved subAccountId=${subAccountId} from scoped webhook`);
      } else {
        console.log(`[TRACE-ACCT] Resolving account for To="${toRaw}" toClean="${toClean}"`);
        const matchedAccounts = await db.select().from(subAccounts)
          .where(eq(subAccounts.twilioNumber, toClean))
          .limit(1)
          .execute()
          .catch((e) => { console.error(`[TRACE-ACCT] DB query failed:`, e.message); return []; });
        if (matchedAccounts.length === 0) {
          console.log(JSON.stringify({
            event: "inbound_sms_rejected",
            timestamp: new Date().toISOString(),
            reason: "no_account_matched",
            to_number: toClean,
            from: senderRaw,
            trace_id: traceId,
          }));
          console.warn(`[TWILIO-INBOUND][${traceId}] No account matched To=${toClean} — rejecting (use scoped webhook /api/webhook/sms/:subAccountId)`);
          res.type("text/xml").send("<Response></Response>");
          return;
        }
        subAccountId = matchedAccounts[0].id;
        console.log(`[TRACE-ACCT] matchedAccounts=${matchedAccounts.length}, resolved subAccountId=${subAccountId}`);
      }
      const threadId = generateThreadId(senderClean, toClean);

      console.log(`[TWILIO-INBOUND][${traceId}] From=${senderClean} To=${toClean} subAccountId=${subAccountId} threadId=${threadId.slice(0, 8)}`);

      const { isOptOutMessage, isOptInMessage, isHelpMessage, handleSmsOptOut, handleSmsOptIn, handleSmsHelp, checkPhoneOptOut } = await import("../optOutGuard");
      const { audit } = await import("../auditTrail");

      // 3. Compliance layer
      if (isOptOutMessage(incomingMsg)) {
        console.log(`[TWILIO-INBOUND][${traceId}] OPT-OUT from ${senderClean}`);
        await handleSmsOptOut(senderClean, subAccountId);
        await audit("SMS_OPT_OUT", "twilio_inbound", { phone: senderClean.slice(-4), subAccountId, traceId });

        await storage.createMessage({
          subAccountId,
          contactPhone: senderClean,
          body: incomingMsg,
          direction: "inbound",
          channel: "sms",
          status: "received",
          messageSid: messageSid || null,
          threadId,
          traceId,
        });

        const twilioClient = await getTwilioClient(subAccountId);
        if (twilioClient && toRaw) {
          await enforceSmsProvider("sms", "twilio", { subAccountId, phone: senderRaw, source: "twilio-inbound-opt-out" });
          await twilioClient.messages.create({
            body: "You have been unsubscribed and will no longer receive messages from us. Reply START to re-subscribe.",
            from: toRaw,
            to: senderRaw,
          });
        }
        await markEventCompleted(req);
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      if (isOptInMessage(incomingMsg)) {
        console.log(`[TWILIO-INBOUND][${traceId}] OPT-IN from ${senderClean}`);
        await handleSmsOptIn(senderClean, subAccountId);
        await audit("SMS_OPT_IN", "twilio_inbound", { phone: senderClean.slice(-4), subAccountId, traceId });

        await storage.createMessage({
          subAccountId,
          contactPhone: senderClean,
          body: incomingMsg,
          direction: "inbound",
          channel: "sms",
          status: "received",
          messageSid: messageSid || null,
          threadId,
          traceId,
        });

        const twilioClient = await getTwilioClient(subAccountId);
        if (twilioClient && toRaw) {
          await enforceSmsProvider("sms", "twilio", { subAccountId, phone: senderRaw, source: "twilio-inbound-opt-in" });
          await twilioClient.messages.create({
            body: "You have been re-subscribed and will receive messages from us again.",
            from: toRaw,
            to: senderRaw,
          });
        }
        await markEventCompleted(req);
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      if (isHelpMessage(incomingMsg)) {
        console.log(`[TWILIO-INBOUND][${traceId}] HELP request from ${senderClean}`);
        await handleSmsHelp(senderClean, subAccountId);
        await audit("SMS_HELP_REQUEST", "twilio_inbound", { phone: senderClean.slice(-4), subAccountId, traceId });

        await storage.createMessage({
          subAccountId,
          contactPhone: senderClean,
          body: incomingMsg,
          direction: "inbound",
          channel: "sms",
          status: "received",
          messageSid: messageSid || null,
          threadId,
          traceId,
        });

        const twilioClient = await getTwilioClient(subAccountId);
        if (twilioClient && toRaw) {
          await enforceSmsProvider("sms", "twilio", { subAccountId, phone: senderRaw, source: "twilio-inbound-help" });
          await twilioClient.messages.create({
            body: "For help, reply STOP to unsubscribe or START to re-subscribe. Message and data rates may apply.",
            from: toRaw,
            to: senderRaw,
          });
        }
        await markEventCompleted(req);
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      const tCrmStart = Date.now();

      // 5. CRM upsert — create or update contact
      let contactId: number;
      let isNewContact = false;
      try {
        const result = await upsertCrmContact(senderClean, subAccountId);
        contactId = result.id;
        isNewContact = result.isNew;
        console.log(`[TWILIO-INBOUND][${traceId}] CRM ${isNewContact ? "created" : "updated"} contact id=${contactId} (${Date.now() - tCrmStart}ms)`);
      } catch (crmErr: any) {
        console.error(`[TWILIO-INBOUND][${traceId}] CRM upsert failed:`, crmErr.message);
        contactId = 0;
      }

      // 6. Store inbound message
      const inboundMsg = await storage.createMessage({
        subAccountId,
        contactPhone: senderClean,
        body: incomingMsg,
        direction: "inbound",
        channel: "sms",
        status: "received",
        messageSid: messageSid || null,
        threadId,
        traceId,
      });

      console.log(`[TWILIO-INBOUND][${traceId}] Stored inbound message id=${inboundMsg.id}`);
      console.log(`[TRACE-TRIGGER][${traceId}] isNewContact=${isNewContact}, subAccountId=${subAccountId}, senderClean=${senderClean}`);

      if (isNewContact) {
        console.log(`[TRACE-TRIGGER][${traceId}] NEW contact — firing triggers: new_lead, OnNewLead for account ${subAccountId}`);
        try {
          import("./v1").then(({ fireAutomationTriggerGlobal }) => {
            fireAutomationTriggerGlobal("new_lead", subAccountId, {
              leadName: "New Lead",
              leadPhone: senderClean,
              message: incomingMsg,
              source: "sms_inbound",
              channel: "sms",
            }).catch((e) => console.error(`[TRACE-TRIGGER][${traceId}] new_lead fire ERROR:`, e.message));
            fireAutomationTriggerGlobal("OnNewLead", subAccountId, {
              leadName: "New Lead",
              leadPhone: senderClean,
              message: incomingMsg,
              source: "sms_inbound",
              channel: "sms",
            }).catch((e) => console.error(`[TRACE-TRIGGER][${traceId}] OnNewLead fire ERROR:`, e.message));
          }).catch((e) => console.error(`[TRACE-TRIGGER][${traceId}] import v1 ERROR:`, e.message));
        } catch (outerErr: any) {
          console.error(`[TRACE-TRIGGER][${traceId}] outer catch ERROR:`, outerErr.message);
        }
      } else {
        console.log(`[TRACE-TRIGGER][${traceId}] EXISTING contact — triggers NOT fired (isNewContact=false)`);
      }

      // 5. Check opt-out before AI processing
      const isOptedOut = await checkPhoneOptOut(senderClean, subAccountId);
      if (isOptedOut) {
        console.log(`[TWILIO-INBOUND][${traceId}] Contact ${senderClean} is opted out — skipping AI reply`);
        await markEventCompleted(req);
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      // 7.5 Call Request Flow — intent detection + AI bypass
      const { detectIntent, handleCallRequestFlow } = await import("../callRequestFlow");
      const smsIntent = detectIntent(incomingMsg);
      if (smsIntent.isHotLead) {
        console.log(`[TWILIO-INBOUND][${traceId}] HOT LEAD detected — intent=${smsIntent.intentType}, hasPhone=${smsIntent.hasPhone}`);

        const contactRecord = contactId > 0 ? await storage.getContactById(contactId) : null;
        const smsLeadData = {
          contactId,
          message: incomingMsg,
          channel: "sms" as const,
          phone: contactRecord?.phone || senderClean,
          name: contactRecord?.firstName || "Unknown",
          subAccountId,
        };

        const smsSendReply = async (body: string) => {
          const twilioClientForReply = await getTwilioClient();
          if (twilioClientForReply && toRaw) {
            await enforceSmsProvider("sms", "twilio", { subAccountId, phone: senderRaw, source: "twilio-inbound-sms-reply" });
            await twilioClientForReply.messages.create({ body, from: toRaw, to: senderRaw });
            await storage.createMessage({
              subAccountId,
              contactPhone: senderClean,
              body,
              direction: "outbound",
              channel: "sms",
              status: "sent",
              threadId,
              traceId,
            });
          }
        };

        const smsReplyContext = {
          type: "sms" as const,
          fromNumber: toRaw,
          toNumber: senderRaw,
          threadId,
          traceId,
        };
        await handleCallRequestFlow(smsLeadData, smsIntent, smsSendReply, smsReplyContext);
        if (contactId > 0) {
          const existingContact = await storage.getContactById(contactId);
          if (existingContact) {
            const updates: Record<string, unknown> = {};
            if (!existingContact.tags?.includes("hot_lead")) {
              updates.tags = [...(existingContact.tags || []), "hot_lead"];
            }
            if (!existingContact.source || existingContact.source === "manual") {
              updates.source = "sms_hot_lead";
            }
            if (Object.keys(updates).length > 0) {
              await storage.updateContact(contactId, updates);
            }
          }
        }
        await markEventCompleted(req);
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      // 8. Fire inbound SMS automation trigger
      const tAutoStart = Date.now();
      try {
        const { checkAutomationSafety } = await import("../automationSafety");
        const automations = await storage.getLiveAutomations(subAccountId);
        const matchingInbound = automations.filter((a: any) =>
          (a.status === "compiled" || a.status === "active") &&
          a.manifest?.trigger === "inbound_sms"
        );
        for (const automation of matchingInbound) {
          const safety = checkAutomationSafety({
            automationId: automation.id,
            triggerId: `inbound_sms:${messageSid || inboundMsg.id}`,
            accountId: subAccountId,
          });
          if (!safety.safe) {
            console.warn(`[TWILIO-INBOUND][${traceId}] Inbound automation ${automation.id} blocked: ${safety.reason}`);
          } else {
            console.log(`[TWILIO-INBOUND][${traceId}] Fired inbound_sms automation id=${automation.id}`);
          }
        }
      } catch (autoErr: any) {
        console.error(`[TWILIO-INBOUND][${traceId}] Automation trigger error:`, autoErr.message);
      }
      console.log(`[TWILIO-INBOUND][${traceId}] Automation step done (${Date.now() - tAutoStart}ms)`);

      // 9. Vapi AI orchestration + context-aware fallback
      const tAiStart = Date.now();
      let aiReply: string | null = null;
      let vapiError: string | null = null;

      const account = await storage.getSubAccount(subAccountId);
      const vapiAssistantId = (account?.config as any)?.vapiAssistantId || process.env.VAPI_DEFAULT_SMS_ASSISTANT_ID || null;

      if (vapiConfig.isConfigured && vapiAssistantId) {
        const sessionId = `sms:${senderClean}:${subAccountId}`;
        try {
          aiReply = await callVapiChat(vapiAssistantId, sessionId, incomingMsg);
          console.log(`[TWILIO-INBOUND][${traceId}] Vapi replied in ${Date.now() - tAiStart}ms: ${(aiReply || "").slice(0, 80)}`);
        } catch (e: any) {
          vapiError = e.message;
          console.error(`[TWILIO-INBOUND][${traceId}] Vapi error: ${vapiError}`);
        }
      } else if (!vapiConfig.isConfigured) {
        console.log(`[TWILIO-INBOUND][${traceId}] Vapi not configured — using context-aware AI fallback`);
      } else {
        console.log(`[TWILIO-INBOUND][${traceId}] No vapiAssistantId for subAccount ${subAccountId} — using context-aware AI fallback`);
      }

      if (!aiReply && isAIConfigured()) {
        try {
          const dmCtx = await assembleDmContext({
            subAccountId,
            contactPhone: senderClean,
            channel: "sms",
          });
          const langInstr = getLanguageInstruction(dmCtx.language);
          const aiMsgs = await buildDmMessages(dmCtx, "sms", incomingMsg);
          if (langInstr && aiMsgs.length > 0 && aiMsgs[0].role === "system") {
            aiMsgs[0].content += langInstr;
          }
          const fallbackAiResult = await aiChat(aiMsgs, { temperature: 0.7, maxTokens: 512, route: "twilio-inbound-fallback" });
          if (fallbackAiResult.text && !fallbackAiResult.text.startsWith("[AI Error")) {
            aiReply = fallbackAiResult.text;
            console.log(`[TWILIO-INBOUND][${traceId}] Context-aware AI reply (${Date.now() - tAiStart}ms): ${aiReply.slice(0, 80)}`);
          }
        } catch (aiErr: any) {
          console.error(`[TWILIO-INBOUND][${traceId}] Context-aware AI fallback error:`, aiErr.message);
        }
      }

      const fallbackReply = "Thanks for your message! We'll get back to you shortly.";

      // 10. Reply handling
      const twilioClient = await getTwilioClient(subAccountId);
      if (twilioClient && toRaw) {
        const replyBody = aiReply || fallbackReply;
        let outboundSid: string | null = null;
        let outboundStatus = "sent";

        try {
          const tSendStart = Date.now();
          await enforceSmsProvider("sms", "twilio", { subAccountId, phone: senderRaw, source: "twilio-inbound-ai-reply" });
          const sentMsg = await twilioClient.messages.create({
            body: replyBody,
            from: toRaw,
            to: senderRaw,
          });
          outboundSid = sentMsg.sid;
          console.log(`[TWILIO-INBOUND][${traceId}] Outbound reply sent sid=${outboundSid} (${Date.now() - tSendStart}ms)`);
        } catch (sendErr: any) {
          outboundStatus = "failed";
          console.error(`[TWILIO-INBOUND][${traceId}] Outbound SMS send failed:`, sendErr.message);
        }

        // Log outbound message
        try {
          await storage.createMessage({
            subAccountId,
            contactPhone: senderClean,
            body: replyBody,
            direction: "outbound",
            channel: "sms",
            status: outboundStatus,
            messageSid: outboundSid || null,
            threadId,
            traceId,
          });
        } catch (logErr: any) {
          console.error(`[TWILIO-INBOUND][${traceId}] Failed to log outbound message:`, logErr.message);
        }

        // Fire outbound automation trigger (non-blocking)
        try {
          const { checkAutomationSafety } = await import("../automationSafety");
          const automations = await storage.getLiveAutomations(subAccountId);
          const matching = automations.filter((a: any) =>
            (a.status === "compiled" || a.status === "active") &&
            a.manifest?.trigger === "outbound_sms"
          );
          for (const automation of matching) {
            const safety = checkAutomationSafety({
              automationId: automation.id,
              triggerId: `outbound_sms:${outboundSid || traceId}`,
              accountId: subAccountId,
            });
            if (!safety.safe) {
              console.warn(`[TWILIO-INBOUND][${traceId}] Outbound automation ${automation.id} blocked: ${safety.reason}`);
            }
          }
        } catch (e: any) {
          console.error(`[TWILIO-INBOUND][${traceId}] Outbound automation error:`, e.message);
        }
      }

      // 11. Fallback & retry queue — if Vapi failed, enqueue for retry
      if (vapiError) {
        try {
          await storage.createSmsRetryQueueItem({
            subAccountId,
            contactPhone: senderClean,
            fromNumber: toClean,
            traceId,
            threadId,
            originalMessageSid: messageSid || null,
            errorMessage: vapiError,
            retryCount: 0,
            status: "pending",
            nextRetryAt: new Date(Date.now() + 5 * 60 * 1000),
          });
          console.log(`[TWILIO-INBOUND][${traceId}] Enqueued for retry due to Vapi failure`);
        } catch (retryErr: any) {
          console.error(`[TWILIO-INBOUND][${traceId}] Failed to enqueue retry:`, retryErr.message);
        }
      }

      console.log(`[TWILIO-INBOUND][${traceId}] Pipeline complete in ${Date.now() - t0}ms | inbound=${inboundMsg.id} contact=${contactId} vapiOk=${!vapiError}`);
      await markEventCompleted(req);
      res.type("text/xml").send("<Response></Response>");
    } catch (err: any) {
      console.error(`[TWILIO-INBOUND][${traceId}] Unhandled pipeline error:`, err.message || err);
      await markEventFailed(req, err.message || "Unhandled pipeline error").catch(() => {});
      res.type("text/xml").send("<Response></Response>");
    }
  });

  // ---- Scoped Inbound SMS Webhook (per sub-account) ----
  // POST /api/webhook/sms/:subAccountId
  app.post("/api/webhook/sms/:subAccountId", async (req, res) => {
    const subAccountIdParam = parseInt(req.params.subAccountId, 10);
    if (isNaN(subAccountIdParam) || subAccountIdParam < 1) {
      console.error(`[WEBHOOK-SCOPED] Invalid subAccountId in URL: ${req.params.subAccountId}`);
      res.type("text/xml").send("<Response></Response>");
      return;
    }

    const traceId = crypto.randomUUID();
    console.log(JSON.stringify({
      event: "inbound_webhook_received",
      sub_account_id: subAccountIdParam,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    }));

    try {
      const account = await storage.getSubAccount(subAccountIdParam);
      if (!account) {
        console.error(`[WEBHOOK-SCOPED] Sub-account ${subAccountIdParam} not found`);
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      const { getAuthTokenForAccount } = await import("../twilioClientFactory");
      const authToken = getAuthTokenForAccount(account);
      const isValid = await validateTwilioSignature(req, authToken || undefined);

      console.log(JSON.stringify({
        event: "signature_validated",
        sub_account_id: subAccountIdParam,
        twilio_sid: account.twilioSubaccountSid || "master",
        valid: isValid,
        timestamp: new Date().toISOString(),
      }));

      if (!isValid) {
        console.warn(`[WEBHOOK-SCOPED][${traceId}] Invalid Twilio signature for account ${subAccountIdParam}`);
        res.status(403).type("text/xml").send("<Response></Response>");
        return;
      }

      req.body._resolvedSubAccountId = subAccountIdParam;

      const messageSid = req.body.MessageSid as string | undefined;
      const incomingMsg = req.body.Body as string | undefined;
      const senderRaw = req.body.From as string | undefined;
      const toRaw = req.body.To as string | undefined;

      if (!incomingMsg || !senderRaw) {
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      const senderClean = senderRaw.replace(/^(whatsapp:|messenger:)/, "");
      const toClean = toRaw ? toRaw.replace(/^(whatsapp:|messenger:)/, "") : "";
      const threadId = generateThreadId(senderClean, toClean);

      const { isOptOutMessage, isOptInMessage, checkPhoneOptOut, handleSmsOptOut, handleSmsOptIn } = await import("../optOutGuard");

      if (isOptOutMessage(incomingMsg)) {
        await handleSmsOptOut(senderClean, subAccountIdParam);
        const twilioClient = await getTwilioClient(subAccountIdParam);
        if (twilioClient && toRaw) {
          await enforceSmsProvider("sms", "twilio", { subAccountId: subAccountIdParam, phone: senderRaw, source: "twilio-fallback-opt-out" });
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
        await handleSmsOptIn(senderClean, subAccountIdParam);
        const twilioClient = await getTwilioClient(subAccountIdParam);
        if (twilioClient && toRaw) {
          await enforceSmsProvider("sms", "twilio", { subAccountId: subAccountIdParam, phone: senderRaw, source: "twilio-fallback-opt-in" });
          await twilioClient.messages.create({
            body: "You have been re-subscribed and will receive messages from us again.",
            from: toRaw,
            to: senderRaw,
          });
        }
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      await storage.createMessage({
        subAccountId: subAccountIdParam,
        contactPhone: senderClean,
        body: incomingMsg,
        direction: "inbound",
        channel: "sms",
        status: "received",
        messageSid: messageSid || null,
        threadId,
        traceId,
      });

      const isOptedOut = await checkPhoneOptOut(senderClean, subAccountIdParam);
      if (isOptedOut) {
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      let aiReply: string | null = null;
      if (isAIConfigured()) {
        try {
          const dmCtx = await assembleDmContext({ subAccountId: subAccountIdParam, contactPhone: senderClean, channel: "sms" });
          const langInstr = getLanguageInstruction(dmCtx.language);
          const aiMsgs = await buildDmMessages(dmCtx, "sms", incomingMsg);
          if (langInstr && aiMsgs.length > 0 && aiMsgs[0].role === "system") {
            aiMsgs[0].content += langInstr;
          }
          const aiResult = await aiChat(aiMsgs, { temperature: 0.7, maxTokens: 512, route: "webhook-scoped-sms" });
          if (aiResult.text) aiReply = aiResult.text;
        } catch (aiErr: any) {
          console.error(`[WEBHOOK-SCOPED][${traceId}] AI error:`, aiErr.message);
        }
      }

      const replyBody = aiReply || "Thanks for your message! We'll get back to you shortly.";
      const twilioClient = await getTwilioClient(subAccountIdParam);
      if (twilioClient && toRaw) {
        try {
          await enforceSmsProvider("sms", "twilio", { subAccountId: subAccountIdParam, phone: senderRaw, source: "twilio-fallback-reply" });
          const sentMsg = await twilioClient.messages.create({
            body: replyBody,
            from: toRaw,
            to: senderRaw,
          });
          console.log(JSON.stringify({
            event: "outbound_message_sent",
            sub_account_id: subAccountIdParam,
            phone_number: toClean,
            twilio_sid: account.twilioSubaccountSid || "master",
            message_sid: sentMsg.sid,
            timestamp: new Date().toISOString(),
          }));

          await storage.createMessage({
            subAccountId: subAccountIdParam,
            contactPhone: senderClean,
            body: replyBody,
            direction: "outbound",
            channel: "sms",
            status: "sent",
            messageSid: sentMsg.sid,
            threadId,
            traceId,
          });
        } catch (sendErr: any) {
          console.error(`[WEBHOOK-SCOPED][${traceId}] Outbound send failed:`, sendErr.message);
        }
      }

      res.type("text/xml").send("<Response></Response>");
    } catch (err: any) {
      console.error(`[WEBHOOK-SCOPED][${traceId}] Error:`, err.message);
      res.type("text/xml").send("<Response></Response>");
    }
  });

  // ---- Meta/Facebook Webhook (Instagram/Facebook DMs) ----
  app.get("/api/meta-webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const verifyToken = process.env.META_VERIFY_TOKEN;
    if (!verifyToken) {
      console.error("[META WEBHOOK] META_VERIFY_TOKEN not configured — rejecting verification");
      return res.sendStatus(403);
    }
    const tokenMatches = token === verifyToken;
    const sanitizedUrl = req.originalUrl.replace(/hub\.verify_token=[^&]*/g, "hub.verify_token=[redacted]");
    console.log(`[META WEBHOOK] Verification attempt — mode=${mode}, token_match=${tokenMatches}, challenge=${challenge}, url=${sanitizedUrl}`);
    if (mode === "subscribe" && tokenMatches) {
      console.log("[META WEBHOOK] Verification SUCCESS — returning challenge");
      res.status(200).send(challenge);
    } else {
      console.warn(`[META WEBHOOK] Verification FAILED — mode=${mode}, token_match=${tokenMatches}. Check META_VERIFY_TOKEN matches what is configured in the Meta developer portal.`);
      res.sendStatus(403);
    }
  });

  app.post("/api/meta-webhook", async (req, res) => {
    const xHubSignature = req.headers["x-hub-signature-256"] as string | undefined;
    const globalAppSecret = process.env.META_APP_SECRET;

    if (!xHubSignature) {
      console.warn("[META WEBHOOK] Missing X-Hub-Signature-256 header — rejecting");
      return res.sendStatus(403);
    }

    const rawBody = (req as any).rawBody;
    const bodyForHmac = rawBody ? (Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody))) : Buffer.from(JSON.stringify(req.body));

    const body = req.body;
    const entryPageIds: string[] = (body?.entry || []).map((e: any) => e.id).filter(Boolean);

    let tenantSecret: string | null = null;
    if (entryPageIds.length > 0) {
      try {
        const allAccounts = await storage.getSubAccounts();
        const matchedAccount = allAccounts.find(a => a.metaPageId && entryPageIds.includes(a.metaPageId));
        if (matchedAccount?.metaAppSecret) {
          tenantSecret = matchedAccount.metaAppSecret;
        }
      } catch (err) {
        console.warn("[META WEBHOOK] Failed to resolve tenant secret from payload");
      }
    }

    const secretToVerify = tenantSecret || globalAppSecret;
    if (!secretToVerify) {
      console.warn("[META WEBHOOK] No app secret available for verification (no tenant match, no global) — rejecting (fail-closed)");
      return res.sendStatus(500);
    }

    const expectedSig = "sha256=" + crypto.createHmac("sha256", secretToVerify).update(bodyForHmac).digest("hex");
    const sigBuf = Buffer.from(xHubSignature);
    const expectedBuf = Buffer.from(expectedSig);
    const verified = sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);

    if (!verified) {
      console.warn(`[META WEBHOOK] Invalid X-Hub-Signature-256 — rejecting (verified against ${tenantSecret ? "tenant" : "global"} secret)`);
      return res.sendStatus(403);
    }

    console.log(`[META WEBHOOK] Inbound POST received — object=${body?.object}, entries=${body?.entry?.length ?? 0}, verified_against=${tenantSecret ? "tenant_secret" : "global_secret"}`);
    res.sendStatus(200);

    try {
      if (body.object === "page" || body.object === "instagram") {
        for (const entry of body.entry || []) {
          const entryPageId = entry.id as string | undefined;
          const entryTime = entry.time ? new Date(entry.time * 1000).toISOString() : "unknown";
          console.log(`[META WEBHOOK] Processing entry — pageId=${entryPageId}, time=${entryTime}, messaging_events=${entry.messaging?.length ?? 0}, changes=${entry.changes?.length ?? 0}`);

          for (const event of entry.messaging || []) {
            const senderId = event.sender?.id;
            let message = event.message?.text;
            const mid = event.message?.mid as string | undefined;
            const pipelineStart = Date.now();

            if (!message && event.message?.attachments) {
              const audioAttachment = (event.message.attachments as any[]).find(
                (a: any) => a.type === "audio" && a.payload?.url
              );
              if (audioAttachment) {
                try {
                  console.log(`[META DM] Voice message detected from ${senderId}, mid=${mid} — downloading and transcribing`);
                  const audioUrl = audioAttachment.payload.url;
                  const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(15000) });
                  if (audioRes.ok) {
                    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
                    const { detectAudioFormat, convertToWav, speechToText } = await import("../replit_integrations/audio/client");
                    let format = detectAudioFormat(audioBuffer);
                    let processBuffer = audioBuffer;
                    if (format !== "wav" && format !== "mp3" && format !== "webm") {
                      processBuffer = await convertToWav(audioBuffer);
                      format = "wav";
                    }
                    const transcribed = await speechToText(processBuffer, format as "wav" | "mp3" | "webm");
                    if (transcribed && transcribed.trim().length > 0) {
                      message = transcribed.trim();
                      console.log(`[META DM] Voice transcribed (${audioBuffer.length} bytes → ${message.length} chars): "${message.substring(0, 100)}"`);
                    } else {
                      console.warn(`[META DM] Voice transcription returned empty for mid=${mid}`);
                    }
                  }
                } catch (voiceErr: any) {
                  console.error(`[META DM] Voice transcription failed for mid=${mid}: ${voiceErr.message}`);
                }
              }
            }

            if (!senderId || !message) {
              console.warn(`[META DM] Skipping event — missing sender (${senderId}) or message text, mid=${mid}, event_keys=${Object.keys(event).join(",")}`);
              continue;
            }

            const channel = body.object === "instagram" ? "instagram" : "facebook";
            console.log(`[META DM][PIPELINE-START] channel=${channel}, sender=${senderId}, mid=${mid || "none"}, bodyLength=${message.length}`);
            console.log(`[LAYLA-PIPELINE] Step 1: Inbound message received — channel=${channel}, sender=${senderId}, mid=${mid || "none"}, bodyLength=${message.length}`);

            // --- STRICT TENANT RESOLUTION: look up sub-account by page_id ---
            if (!entryPageId) {
              console.error(`[META DM] Rejected ${channel} event — entry.id (page_id) is missing from webhook payload. Cannot route to sub-account.`);
              continue;
            }

            let subAccountId: number | null = null;
            let accessToken: string | null = null;
            let pageId: string | null = null;
            let appSecret: string | null = null;

            try {
              const { resolveSubAccountByPageId, getMetaConfig } = await import("../metaConfig");
              subAccountId = await resolveSubAccountByPageId(String(entryPageId));
              const metaCfg = await getMetaConfig(subAccountId);
              accessToken = metaCfg.accessToken;
              pageId = metaCfg.pageId;
              appSecret = metaCfg.appSecret;
              console.log(`[META DM][TENANT-RESOLVED] channel=${channel}, sender=${senderId}, subAccountId=${subAccountId}, pageId=${pageId}, hasToken=${!!accessToken}, hasAppSecret=${!!appSecret}, source=subAccounts`);
            } catch (resolveErr: any) {
              console.warn(`[META DM][TENANT-RESOLVE] Primary resolution failed for pageId=${entryPageId}: ${resolveErr.message} — trying integrationConnections fallback`);
              const integrationRows = await db.select()
                .from(integrationConnections)
                .where(
                  and(
                    eq(integrationConnections.provider, "meta"),
                    eq(integrationConnections.status, "connected")
                  )
                )
                .execute()
                .catch(() => [] as typeof integrationConnections.$inferSelect[]);

              for (const conn of integrationRows) {
                const cfg = conn.config as any;
                const connPageId = cfg?.pageId || cfg?.page_id || cfg?.META_PAGE_ID;
                if (connPageId && String(connPageId) === String(entryPageId)) {
                  subAccountId = conn.subAccountId;
                  accessToken = cfg?.accessToken || cfg?.META_ACCESS_TOKEN || null;
                  pageId = connPageId;
                  appSecret = cfg?.appSecret || cfg?.META_APP_SECRET || null;
                  console.log(`[META DM][TENANT-RESOLVED] channel=${channel}, sender=${senderId}, subAccountId=${subAccountId}, pageId=${pageId}, hasToken=${!!accessToken}, hasAppSecret=${!!appSecret}, source=integrationConnections`);
                  break;
                }
              }
              if (!subAccountId) {
                console.warn(`[META DM][TENANT-RESOLVE] integrationConnections fallback also failed — checked ${integrationRows.length} rows, none matched pageId=${entryPageId}`);
              }
            }

            if (!subAccountId) {
              console.error(`[META DM] Rejected ${channel} event from sender=${senderId} — page_id=${entryPageId} not mapped to any sub-account.`);
              console.error(`[LAYLA-PIPELINE] Step 2 FAILED: Routing failed — pageId=${entryPageId} not mapped to any sub-account`);
              continue;
            }

            console.log(`[META DM] ${channel} from ${senderId} -> subAccountId=${subAccountId} (page=${entryPageId}): ${message.substring(0, 100)}`);
            console.log(`[LAYLA-PIPELINE] Step 2: Routed to correct handler — subAccountId=${subAccountId}, pageId=${entryPageId}`);

            let metaTraceId = crypto.randomUUID();
            if (mid) {
              try {
                const existingEvent = await storage.getEventLogByExternalId("meta", mid);
                if (existingEvent && (existingEvent.status === "completed" || existingEvent.status === "processing")) {
                  console.log(`[META DM][IDEMPOTENCY] Duplicate event mid=${mid} (status: ${existingEvent.status}) — skipping`);
                  continue;
                }
                if (existingEvent) {
                  metaTraceId = existingEvent.traceId;
                  await storage.updateEventLogStatus(existingEvent.id, "processing");
                  console.log(`[META DM][IDEMPOTENCY] Resuming previously failed event mid=${mid}, traceId=${metaTraceId}`);
                } else {
                  await storage.createEventLog({
                    traceId: metaTraceId,
                    type: "message.received",
                    source: "meta",
                    externalId: mid,
                    payload: event as any,
                    status: "processing",
                    maxRetries: 3,
                  });
                  console.log(`[META DM][IDEMPOTENCY] New event logged mid=${mid}, traceId=${metaTraceId}`);
                }
              } catch (idempErr: any) {
                if (idempErr?.message?.includes("unique")) {
                  console.log(`[META DM][IDEMPOTENCY] Race condition duplicate for mid=${mid} — skipping`);
                  continue;
                } else {
                  console.error(`[META DM][IDEMPOTENCY] Check error for mid=${mid}:`, idempErr.message);
                }
              }
            }

            const metaTrace = { traceId: metaTraceId, subAccountId, contactPhone: senderId };
            const metaRecvStart = Date.now();
            recordStepValue(metaTrace, "message_received", "success", Date.now() - metaRecvStart, {
              provider: "meta",
              metadata: { channel, mid: mid || null, bodyLength: message.length },
              disambiguator: mid || `meta-recv-${senderId}`,
            });

            if (!accessToken || !pageId) {
              const rawPayload = JSON.stringify(event).substring(0, 2000);
              console.error(`[META DM] Cannot process ${channel} message from ${senderId} (page=${entryPageId}, subAccount=${subAccountId}) — integration connection missing accessToken or pageId. Update the Meta integration config for this sub-account. Raw event: ${rawPayload}`);
              await db.insert(messages).values({
                subAccountId,
                channel,
                direction: "inbound",
                contactPhone: senderId,
                body: `[UNPROCESSED - Missing per-account META credentials] Raw: ${rawPayload.substring(0, 500)}`,
                status: "failed",
                pageId: entryPageId,
                senderId,
              });
              continue;
            }

            let appsecretProof = "";
            if (accessToken && appSecret) {
              const crypto = await import("crypto");
              appsecretProof = crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
            }


            const metaCrmStart = Date.now();
            const metaInboundThreadId = `${subAccountId}::${senderId}::${channel}`;
            const metaMessageSid = mid ? `meta_${mid}` : null;
            try {
              await db.insert(messages).values({
                subAccountId,
                channel,
                direction: "inbound",
                contactPhone: senderId,
                body: message,
                status: "received",
                traceId: metaTraceId,
                threadId: metaInboundThreadId,
                pageId: entryPageId,
                senderId,
                messageSid: metaMessageSid,
              });
              broadcastNewMessage(subAccountId, {
                subAccountId, channel, direction: "inbound", contactPhone: senderId,
                body: message, status: "received", threadId: metaInboundThreadId, createdAt: new Date().toISOString(),
              });
              console.log(`[META DM][CRM-WRITE] Inbound message stored — channel=${channel}, sender=${senderId}, subAccountId=${subAccountId}, threadId=${metaInboundThreadId}, mid=${mid || "none"}, elapsed=${Date.now() - metaCrmStart}ms`);
              recordStepValue(metaTrace, "crm_write", "success", Date.now() - metaCrmStart, {
                metadata: { channel, direction: "inbound" },
                disambiguator: mid || `meta-crm-${senderId}`,
              });
            } catch (crmWriteErr: any) {
              console.error(`[META DM][CRM-WRITE] Failed to store inbound message — channel=${channel}, sender=${senderId}, subAccountId=${subAccountId}, error=${crmWriteErr.message}`);
              recordStepValue(metaTrace, "crm_write", "error", Date.now() - metaCrmStart, {
                error: crmWriteErr.message,
                disambiguator: mid ? `${mid}-crm-err` : `meta-crm-err-${senderId}`,
              });
            }

            let existingContactRecord: any = null;
            try {
              const existingContact = await db.select().from(contacts)
                .where(and(
                  eq(contacts.subAccountId, subAccountId),
                  eq(contacts.source, `${channel}_dm`),
                  eq(contacts.phone, senderId)
                )).limit(1);

              if (existingContact.length > 0) {
                existingContactRecord = existingContact[0];
                // Backfill: if stored name is a placeholder, re-fetch real name from Graph API
                const fn = existingContactRecord.firstName || "";
                if (fn.startsWith("FB User") || fn.startsWith("IG User") || fn.startsWith("IG ")) {
                  try {
                    const profileUrl = `https://graph.facebook.com/v19.0/${senderId}?fields=first_name,last_name` +
                      (appsecretProof ? `&appsecret_proof=${appsecretProof}` : "") +
                      `&access_token=${accessToken}`;
                    const profileRes = await fetch(profileUrl, { signal: AbortSignal.timeout(5000) });
                    if (profileRes.ok) {
                      const profileData = await profileRes.json() as any;
                      if (profileData.first_name) {
                        await storage.updateContact(existingContactRecord.id, {
                          firstName: profileData.first_name,
                          ...(profileData.last_name ? { lastName: profileData.last_name } : {}),
                        });
                        existingContactRecord.firstName = profileData.first_name;
                        if (profileData.last_name) existingContactRecord.lastName = profileData.last_name;
                        console.log(`[META DM] Backfilled real name for contact id=${existingContactRecord.id}: ${profileData.first_name} ${profileData.last_name || ""}`);
                      }
                    }
                  } catch (backfillErr: any) {
                    console.warn(`[META DM] Name backfill failed for contact id=${existingContactRecord.id}:`, backfillErr.message);
                  }
                }
              } else {
                const byFirstName = await db.select().from(contacts)
                  .where(and(
                    eq(contacts.subAccountId, subAccountId),
                    eq(contacts.source, `${channel}_dm`),
                    sql`${contacts.firstName} LIKE ${"%" + senderId.slice(-4)}`
                  )).limit(1);
                if (byFirstName.length > 0) {
                  existingContactRecord = byFirstName[0];
                  // Backfill for byFirstName match too
                  const fn2 = existingContactRecord.firstName || "";
                  if (fn2.startsWith("FB User") || fn2.startsWith("IG User") || fn2.startsWith("IG ")) {
                    try {
                      const profileUrl = `https://graph.facebook.com/v19.0/${senderId}?fields=first_name,last_name` +
                        (appsecretProof ? `&appsecret_proof=${appsecretProof}` : "") +
                        `&access_token=${accessToken}`;
                      const profileRes = await fetch(profileUrl, { signal: AbortSignal.timeout(5000) });
                      if (profileRes.ok) {
                        const profileData = await profileRes.json() as any;
                        if (profileData.first_name) {
                          await storage.updateContact(existingContactRecord.id, {
                            firstName: profileData.first_name,
                            ...(profileData.last_name ? { lastName: profileData.last_name } : {}),
                          });
                          existingContactRecord.firstName = profileData.first_name;
                          if (profileData.last_name) existingContactRecord.lastName = profileData.last_name;
                          console.log(`[META DM] Backfilled real name for contact id=${existingContactRecord.id}: ${profileData.first_name} ${profileData.last_name || ""}`);
                        }
                      }
                    } catch (backfillErr: any) {
                      console.warn(`[META DM] Name backfill failed for contact id=${existingContactRecord.id}:`, backfillErr.message);
                    }
                  }
                } else {
                  const senderPhone = /^\d{10,11}$/.test(senderId)
                    ? `+1${senderId.slice(-10)}`
                    : senderId;

                  let realFirstName = `${channel === "instagram" ? "IG" : "FB"} User ${senderId.slice(-4)}`;
                  let realLastName: string | undefined;
                  try {
                    const profileUrl = `https://graph.facebook.com/v19.0/${senderId}?fields=first_name,last_name` +
                      (appsecretProof ? `&appsecret_proof=${appsecretProof}` : "") +
                      `&access_token=${accessToken}`;
                    const profileRes = await fetch(profileUrl, { signal: AbortSignal.timeout(5000) });
                    if (profileRes.ok) {
                      const profileData = await profileRes.json() as any;
                      if (profileData.first_name) {
                        realFirstName = profileData.first_name;
                        realLastName = profileData.last_name || undefined;
                        console.log(`[META DM] Fetched real name from Graph API: ${realFirstName} ${realLastName || ""} (sender=${senderId})`);
                      }
                    } else {
                      console.warn(`[META DM] Graph API profile fetch failed for ${senderId}: HTTP ${profileRes.status}`);
                    }
                  } catch (profileErr: any) {
                    console.warn(`[META DM] Graph API profile fetch error for ${senderId}:`, profileErr.message);
                  }

                  const newContact = await storage.createContact({
                    subAccountId,
                    firstName: realFirstName,
                    ...(realLastName ? { lastName: realLastName } : {}),
                    phone: senderPhone,
                    source: `${channel}_dm`,
                    tags: [channel, "dm_lead"],
                  });
                  existingContactRecord = newContact;
                  console.log(`[META DM] Created CRM contact id=${newContact.id} for ${senderId} (name=${realFirstName} ${realLastName || ""})`);
                }
              }
            } catch (contactErr: any) {
              console.warn("[META DM] Contact creation skipped:", contactErr.message);
            }

            const resolvedPhone = existingContactRecord?.phone && existingContactRecord.phone.startsWith("+")
              ? existingContactRecord.phone
              : null;

            try {
              const triggerContext = {
                leadName: existingContactRecord ? [existingContactRecord.firstName, existingContactRecord.lastName].filter(Boolean).join(" ").trim() || senderId : senderId,
                leadPhone: resolvedPhone || senderId,
                senderId,
                channel,
                message,
                source: `${channel}_dm`,
              };
              const dmTrigger = `On${channel === "instagram" ? "Instagram" : "Facebook"}DM`;
              console.log(`[TRACE-TRIGGER] META DM — firing triggers: ${dmTrigger}, new_lead, OnNewLead for account ${subAccountId}, senderId=${senderId}`);
              import("./v1").then(({ fireAutomationTriggerGlobal }) => {
                fireAutomationTriggerGlobal(dmTrigger, subAccountId, triggerContext).catch((e) => console.error(`[TRACE-TRIGGER] ${dmTrigger} fire ERROR:`, e.message));
                fireAutomationTriggerGlobal("new_lead", subAccountId, triggerContext).catch((e) => console.error(`[TRACE-TRIGGER] new_lead fire ERROR:`, e.message));
                fireAutomationTriggerGlobal("OnNewLead", subAccountId, triggerContext).catch((e) => console.error(`[TRACE-TRIGGER] OnNewLead fire ERROR:`, e.message));
              }).catch((e) => console.error(`[TRACE-TRIGGER] import v1 ERROR:`, e.message));
            } catch (outerErr: any) {
              console.error(`[TRACE-TRIGGER] META DM outer catch ERROR:`, outerErr.message);
            }

            // Call Request Flow — intent detection for Meta DMs (AI bypass)
            // Skip for accounts with full persona override — persona handles all engagement
            let skipCallRequestFlow = false;
            try {
              const acctCheck = await storage.getSubAccount(subAccountId);
              const promptCfg = (acctCheck?.aiPromptConfig as any) || {};
              if (promptCfg.systemPrompt && promptCfg.systemPrompt.length > 200) {
                skipCallRequestFlow = true;
                console.log(`[META DM] Full persona override active for subAccountId=${subAccountId} — skipping callRequestFlow`);
              }
            } catch {}

            const { detectIntent: detectMetaIntent, handleCallRequestFlow: handleMetaCallFlow } = await import("../callRequestFlow");
            const metaIntent = detectMetaIntent(message);
            if (!skipCallRequestFlow && metaIntent.isHotLead && existingContactRecord) {
              console.log(`[META DM] HOT LEAD detected — intent=${metaIntent.intentType}, channel=${channel}, sender=${senderId}`);

              const metaLeadData = {
                contactId: existingContactRecord.id,
                message,
                channel: channel as "facebook" | "instagram",
                phone: existingContactRecord.phone || null,
                name: [existingContactRecord.firstName, existingContactRecord.lastName].filter(Boolean).join(" ").trim() || senderId,
                subAccountId,
                followUpPhone: senderId,
              };

              const metaSendReply = async (body: string) => {
                if (!accessToken || !pageId) return;
                const replyUrl = `https://graph.facebook.com/v19.0/${pageId}/messages` + (appsecretProof ? `?appsecret_proof=${appsecretProof}` : "");
                const sendRes = await fetch(replyUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    recipient: { id: senderId },
                    message: { text: body },
                    access_token: accessToken,
                  }),
                });
                const metaDmThreadId = `${subAccountId}::${senderId}::${channel}`;
                await db.insert(messages).values({
                  subAccountId,
                  channel,
                  direction: "outbound",
                  contactPhone: senderId,
                  body,
                  status: sendRes.ok ? "sent" : "failed",
                  traceId: metaTraceId,
                  threadId: metaDmThreadId,
                  pageId: entryPageId,
                  senderId,
                });
              };

              const metaReplyContext = {
                type: "meta" as const,
                senderId,
                metaChannel: channel,
              };
              await handleMetaCallFlow(metaLeadData, metaIntent, metaSendReply, metaReplyContext);

              {
                const metaUpdates: Record<string, unknown> = {};
                if (!existingContactRecord.tags?.includes("hot_lead")) {
                  metaUpdates.tags = [...(existingContactRecord.tags || []), "hot_lead"];
                }
                const sourceLabel = channel === "instagram" ? "instagram_hot_lead" : "facebook_hot_lead";
                if (!existingContactRecord.source || existingContactRecord.source === "manual") {
                  metaUpdates.source = sourceLabel;
                }
                if (Object.keys(metaUpdates).length > 0) {
                  await storage.updateContact(existingContactRecord.id, metaUpdates);
                }
              }

              if (mid) {
                try {
                  const existing = await storage.getEventLogByExternalId("meta", mid);
                  if (existing) await storage.updateEventLogStatus(existing.id, "completed", { processedAt: new Date() });
                } catch (eventLogErr: any) {
                  console.warn(`[META DM][IDEMPOTENCY] Failed to mark hot-lead event completed for mid=${mid}: ${eventLogErr.message}`);
                }
              }
              console.log(`[META DM][PIPELINE-COMPLETE] channel=${channel}, sender=${senderId}, subAccountId=${subAccountId}, mid=${mid || "none"}, path=hot_lead, totalElapsed=${Date.now() - pipelineStart}ms`);
              continue;
            }

            const keywords = await storage.getDmKeywordAutomations(subAccountId, true);
            const msgLower = message.toLowerCase().trim();
            let keywordMatched = false;

            for (const kw of keywords) {
              if (kw.channel !== "all" && kw.channel !== channel) continue;

              const kwLower = kw.keyword.toLowerCase().trim();
              let matched = false;
              if (kw.matchType === "contains") {
                matched = msgLower.includes(kwLower);
              } else if (kw.matchType === "starts_with") {
                matched = msgLower.startsWith(kwLower);
              } else {
                matched = msgLower === kwLower;
              }

              if (!matched) continue;

              keywordMatched = true;
              console.log(`[META DM] Keyword "${kw.keyword}" matched for ${senderId}`);
              storage.incrementKeywordHitCount(kw.id);

              if (kw.responseText && (!accessToken || !pageId)) {
                console.warn(`[META DM] Cannot send keyword reply to ${senderId} (subAccount=${subAccountId}): per-account accessToken or pageId missing from integration config.`);
                await db.insert(messages).values({
                  subAccountId,
                  channel,
                  direction: "outbound",
                  contactPhone: senderId,
                  body: kw.responseText,
                  status: "failed",
                  traceId: metaTraceId,
                  pageId: entryPageId,
                  senderId,
                });
              } else if (kw.responseText && accessToken && pageId) {
                const kwDelayMs = Math.floor(1500 + Math.random() * 2500 * Math.min(message.length, 200) / 200);
                await new Promise(resolve => setTimeout(resolve, kwDelayMs));
                console.log(`[META DM] Natural delay applied: ${kwDelayMs}ms before keyword reply to ${senderId}`);

                const kwUrl = `https://graph.facebook.com/v19.0/${pageId}/messages` + (appsecretProof ? `?appsecret_proof=${appsecretProof}` : "");
                console.log(`[META DM] Sending keyword reply to ${senderId} via pageId=${pageId}, keyword="${kw.keyword}"`);
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
                  console.error(`[META DM] Keyword reply FAILED to ${senderId} — HTTP ${kwSendRes.status}, pageId=${pageId}, error=${JSON.stringify(kwSendData).substring(0, 500)}`);
                }

                await db.insert(messages).values({
                  subAccountId,
                  channel,
                  direction: "outbound",
                  contactPhone: senderId,
                  body: kw.responseText,
                  status: kwSendStatus,
                  traceId: metaTraceId,
                  pageId: entryPageId,
                  senderId,
                });
                if (kwSendRes.ok) console.log(`[META DM] Keyword reply sent to ${senderId}: OK, messageId=${kwSendData?.message_id}`);
              }

              if (kw.actionPayload) {
                const payload = typeof kw.actionPayload === "string" ? JSON.parse(kw.actionPayload) : kw.actionPayload;
                if (payload.triggerName) {
                  import("./v1").then(({ fireAutomationTriggerGlobal }) =>
                    fireAutomationTriggerGlobal(payload.triggerName, subAccountId, {
                      leadName: existingContactRecord ? [existingContactRecord.firstName, existingContactRecord.lastName].filter(Boolean).join(" ").trim() || senderId : senderId,
                      leadPhone: senderId,
                      source: `${channel}_dm_keyword:${kw.keyword}`,
                      keyword: kw.keyword,
                      message,
                    })
                  ).catch(() => {});
                }
              }
              break;
            }

            let accountAutoReplyEnabled = true;
            if (subAccountId) {
              try {
                const acctForAi = await storage.getSubAccount(subAccountId);
                const aiCfg = (acctForAi?.aiPromptConfig as any) || {};
                if (aiCfg.autoReplyEnabled === false) {
                  accountAutoReplyEnabled = false;
                  console.log(`[META DM] Auto-reply disabled for subAccountId=${subAccountId} — skipping AI`);
                }
              } catch (cfgErr: any) {
                accountAutoReplyEnabled = false;
                console.error(`[META DM] Failed to read auto-reply config for subAccountId=${subAccountId} — defaulting to OFF: ${cfgErr?.message}`);
              }
            }

            if (!keywordMatched && isAIConfigured() && accountAutoReplyEnabled) {
              const metaAiStart = Date.now();
              console.log(`[LAYLA-PIPELINE] Step 3: Agent triggered — channel=${channel}, sender=${senderId}, subAccountId=${subAccountId}`);
              try {
                const dmCtx = await assembleDmContext({
                    subAccountId,
                    contactPhone: senderId,
                    channel,
                  });
                const ctxMs = Date.now() - metaAiStart;

                const aiMessages = await buildDmMessages(dmCtx, channel, message);
                const langInstr = getLanguageInstruction(dmCtx.language);
                if (langInstr && aiMessages.length > 0 && aiMessages[0].role === "system") {
                  aiMessages[0].content += langInstr;
                }

                const aiCallStart = Date.now();
                const metaDmAiResult = await aiChat(aiMessages, { temperature: 0.7, maxTokens: 1024, route: "webhook-meta-dm-reply" });
                const aiReply = metaDmAiResult.text;
                const aiMs = Date.now() - aiCallStart;

                console.log(`[LAYLA-PIPELINE] Step 4: Response generated — channel=${channel}, sender=${senderId}, replyLength=${aiReply?.length || 0}, aiMs=${aiMs}ms`);
                console.log(`[META DM] Timing: context=${ctxMs}ms, ai=${aiMs}ms, total_so_far=${Date.now() - metaAiStart}ms`);

                extractInsightsFromConversation(
                  dmCtx.threadHistory.map(h => ({ role: h.role, content: h.content })),
                  subAccountId,
                  message
                ).catch(err => console.error(`[SHARED-INTEL] Background extraction failed:`, err instanceof Error ? err.message : err));

                recordStepValue(metaTrace, "ai_response_generated", "success", Date.now() - metaAiStart, {
                  provider: "ai",
                  metadata: { channel, replyLength: aiReply?.length || 0 },
                  disambiguator: mid || `meta-ai-${senderId}`,
                });

                const naturalDelayMs = Math.floor(1500 + Math.random() * 2500 * Math.min(message.length, 200) / 200);
                await new Promise(resolve => setTimeout(resolve, naturalDelayMs));
                console.log(`[META DM] Natural delay applied: ${naturalDelayMs}ms before sending AI reply to ${senderId}`);

                const metaSendStart = Date.now();
                const metaDmThreadId = `${subAccountId}::${senderId}::${channel}`;
                if (aiReply && (!accessToken || !pageId)) {
                  console.warn(`[META DM] AI reply generated but cannot send to ${senderId} (subAccount=${subAccountId}): per-account accessToken or pageId missing from integration config.`);
                  await db.insert(messages).values({
                    subAccountId,
                    channel,
                    direction: "outbound",
                    contactPhone: senderId,
                    body: aiReply,
                    status: "failed",
                    traceId: metaTraceId,
                    threadId: metaDmThreadId,
                    pageId: entryPageId,
                    senderId,
                  });
                  recordStepValue(metaTrace, "outbound_send", "error", Date.now() - metaSendStart, {
                    provider: "meta",
                    error: "META_ACCESS_TOKEN or META_PAGE_ID not configured",
                    metadata: { channel },
                    disambiguator: mid ? `${mid}-send-err` : `meta-send-err-${senderId}`,
                  });
                } else if (aiReply && accessToken && pageId) {
                  const aiUrl = `https://graph.facebook.com/v19.0/${pageId}/messages` + (appsecretProof ? `?appsecret_proof=${appsecretProof}` : "");
                  console.log(`[META DM] Sending AI reply to ${senderId} via pageId=${pageId}, token_set=${!!accessToken}, appsecret_proof=${!!appsecretProof}`);
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
                  const metaMsgId = sendData?.message_id as string | undefined;
                  const aiSendStatus = sendRes.ok ? "sent" : "failed";
                  if (!sendRes.ok) {
                    console.error(`[META DM] AI reply FAILED to ${senderId} — HTTP ${sendRes.status}, pageId=${pageId}, error=${JSON.stringify(sendData).substring(0, 500)}`);
                    console.error(`[LAYLA-PIPELINE] Step 5 FAILED: Response send failed — HTTP ${sendRes.status}, sender=${senderId}, subAccountId=${subAccountId}`);
                    recordStepValue(metaTrace, "outbound_send", "error", Date.now() - metaSendStart, {
                      provider: "meta",
                      error: JSON.stringify(sendData).substring(0, 200),
                      metadata: { channel },
                      disambiguator: mid ? `${mid}-send-err` : `meta-send-err-${senderId}`,
                    });
                  } else {
                    console.log(`[META DM] AI reply sent to ${senderId}: OK, messageId=${sendData?.message_id}`);
                    console.log(`[LAYLA-PIPELINE] Step 5: Response successfully sent — sender=${senderId}, messageId=${sendData?.message_id}`);
                    recordStepValue(metaTrace, "outbound_send", "success", Date.now() - metaSendStart, {
                      provider: "meta",
                      metadata: { channel, to: senderId, metaMsgId },
                      disambiguator: metaMsgId || mid || `meta-send-${senderId}`,
                    });
                  }

                  await db.insert(messages).values({
                    subAccountId,
                    channel,
                    direction: "outbound",
                    contactPhone: senderId,
                    body: aiReply,
                    status: aiSendStatus,
                    traceId: metaTraceId,
                    threadId: metaDmThreadId,
                    pageId: entryPageId,
                    senderId,
                  });
                  console.log(`[LAYLA-PIPELINE] Step 6: Response logged — direction=outbound, status=${aiSendStatus}, sender=${senderId}, subAccountId=${subAccountId}`);
                  broadcastNewMessage(subAccountId, {
                    subAccountId, channel, direction: "outbound", contactPhone: senderId,
                    body: aiReply, status: aiSendStatus, threadId: metaDmThreadId, createdAt: new Date().toISOString(),
                  });

                  extractAndStoreInsights(subAccountId!, senderId, channel).catch(() => {});
                }
              } catch (aiErr: any) {
                console.error("[META DM] AI reply error:", aiErr.message);
                console.error(`[LAYLA-PIPELINE] Step 3/4 FAILED: AI agent error — ${aiErr.message}, sender=${senderId}, subAccountId=${subAccountId}`);
                recordStepValue(metaTrace, "ai_response_generated", "error", Date.now() - metaAiStart, {
                  provider: "ai",
                  error: aiErr.message,
                  metadata: { channel },
                  disambiguator: mid ? `${mid}-ai-err` : `meta-ai-err-${senderId}`,
                });
              }
            }

            if (!keywordMatched && !isAIConfigured()) {
              console.warn(`[LAYLA-PIPELINE] Step 3 SKIPPED: AI not configured — no keyword match and AI gateway is not set up. sender=${senderId}, subAccountId=${subAccountId}`);
            }

            if (mid) {
              try {
                const existing = await storage.getEventLogByExternalId("meta", mid);
                if (existing) {
                  await storage.updateEventLogStatus(existing.id, "completed", { processedAt: new Date() });
                }
              } catch (eventLogErr: any) {
                console.warn(`[META DM][IDEMPOTENCY] Failed to mark event completed for mid=${mid}: ${eventLogErr.message}`);
              }
            }
            console.log(`[META DM][PIPELINE-COMPLETE] channel=${channel}, sender=${senderId}, subAccountId=${subAccountId}, mid=${mid || "none"}, totalElapsed=${Date.now() - pipelineStart}ms`);
          }

          // ─── COMMENT AUTO-REPLY: handle entry.changes (feed/comments) ───
          for (const change of entry.changes || []) {
            if (change.field !== "feed" && change.field !== "comments") continue;
            const value = change.value;
            if (!value) continue;

            const isComment = value.item === "comment" ||
              (value.verb === "add" && value.comment_id) ||
              (change.field === "comments" && value.id);

            if (!isComment) continue;

            const commentId = value.comment_id || value.id;
            const commentText = value.message || value.text || "";
            const commenterId = value.from?.id || value.sender_id || "";
            const commenterName = value.from?.name || null;
            const postId = value.post_id || value.media_id || value.media?.id || "";
            const parentId = value.parent_id || null;

            if (!commentId || !commentText || !entryPageId) continue;

            const channel = body.object === "instagram" ? "instagram" : "facebook";

            let commentSubAccountId: number | null = null;
            try {
              const { resolveSubAccountByPageId } = await import("../metaConfig");
              commentSubAccountId = await resolveSubAccountByPageId(String(entryPageId));
            } catch {
              console.warn(`[COMMENT-BOT] Could not resolve sub-account for page ${entryPageId}`);
              continue;
            }

            if (!commentSubAccountId) continue;

            try {
              const { handleCommentEvent } = await import("../services/commentBot/commentHandler");
              handleCommentEvent({
                platform: channel as "facebook" | "instagram",
                subAccountId: commentSubAccountId,
                pageId: entryPageId,
                postId,
                commentId,
                commentText,
                commenterId,
                commenterName,
                parentId,
              }).catch(err => {
                console.error(`[COMMENT-BOT] Async handler error for comment ${commentId}:`, err.message);
              });
            } catch (importErr: any) {
              console.error(`[COMMENT-BOT] Failed to import handler:`, importErr.message);
            }
          }
        }
      }

    } catch (err: any) {
      console.error("[META WEBHOOK] Error processing event:", err.message);
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
      const { getStripePublishableKey } = await import("../stripeClient");
      const key = await getStripePublishableKey();
      res.json({ publishableKey: key });
    } catch {
      res.json({ publishableKey: null });
    }
  }));

  app.get("/api/stripe/products", asyncHandler(async (_req, res) => {
    try {
      const { db } = await import("../db");
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

    const { getUncachableStripeClient } = await import("../stripeClient");
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
    try {
      const { provisionTwilioForSubAccount } = await import("../twilioClientFactory");
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const provResult = await provisionTwilioForSubAccount(account.id, `${businessName} Account`, baseUrl, {
        areaCode: areaCode || "239",
      });
      phoneNumber = provResult.phoneNumber;
    } catch (err: any) {
      console.error("God Mode phone provisioning error:", err.message);
      const twilioClient = await getTwilioClient();
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
            const smsUrl = `${req.protocol}://${req.get("host")}/api/webhook/sms/${account.id}`;
            const updateOpts: Record<string, string> = {};
            updateOpts.smsUrl = smsUrl; updateOpts.smsMethod = "POST";
            updateOpts.voiceUrl = "https://api.vapi.ai/twilio/voice/handler";
            updateOpts.voiceMethod = "POST";
            await twilioClient.incomingPhoneNumbers(purchased.sid).update(updateOpts);
          }
        } catch (fallbackErr: any) {
          console.error("God Mode phone fallback error:", fallbackErr.message);
        }
      }
      if (phoneNumber) {
        await storage.updateSubAccount(account.id, { twilioNumber: phoneNumber });
      }
    }
    results.phoneNumber = phoneNumber;
    results.steps[1].status = phoneNumber ? "done" : "skipped";

    results.steps.push({ id: "voice", status: "running", label: "Deploying Voice Agent" });
    let agentId = null;
    if (vapiConfig.isConfigured) {
      try {
        const godModeWebhookUrl = process.env.VAPI_WEBHOOK_URL || "https://apexmarketingautomations.com/api/vapi/webhook";
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
          serverUrl: godModeWebhookUrl,
          serverMessages: [
            "assistant.started", "conversation-update", "end-of-call-report", "function-call",
            "hang", "speech-update", "status-update", "tool-calls", "transcript",
            "transfer-destination-request", "user-interrupted",
          ],
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
    if (isAIConfigured()) {
      try {
        const godModePrompt = `Create a premium landing page for "${businessName}", a ${industry} business. Make it look high-end and professional with compelling copy.`;
        let parsed: any = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const godSiteAiResult = await aiChat([
              { role: "system", content: SITE_SYSTEM_PROMPT },
              { role: "user", content: attempt === 0 ? godModePrompt : godModePrompt + "\n\nIMPORTANT: Return ONLY valid JSON." },
            ], { temperature: attempt === 0 ? 0.7 : 0.3, maxTokens: 4096, jsonMode: true, route: "webhook-god-mode-site" });
            let cleaned = godSiteAiResult.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
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

  app.post("/api/god-mode/stream", requireAdmin, asyncHandler(async (req, res) => {
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
    const stream = new ProgressStream(res);

    try {
      const results: any = { businessName, industry };

      stream.sendStep("account", "running", "Creating Sub-Account");
      const account = await storage.createSubAccount({
        name: `${businessName} Account`,
        twilioNumber: "",
        ownerUserId: getUserId(user),
      });
      results.accountId = account.id;
      stream.sendStep("account", "done", "Creating Sub-Account", `Account #${account.id} created`);

      stream.sendStep("phone", "running", "Provisioning AI Phone Line");
      let phoneNumber = null;
      try {
        const { provisionTwilioForSubAccount } = await import("../twilioClientFactory");
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const provResult = await provisionTwilioForSubAccount(account.id, `${businessName} Account`, baseUrl, {
          areaCode: areaCode || "239",
        });
        phoneNumber = provResult.phoneNumber;
      } catch (provErr: any) {
        console.error("God Mode sub-account provisioning error:", provErr.message);
        const twilioClient = await getTwilioClient();
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
              const smsUrl = `${req.protocol}://${req.get("host")}/api/webhook/sms/${account.id}`;
              const updateOpts: Record<string, string> = {};
              updateOpts.smsUrl = smsUrl; updateOpts.smsMethod = "POST";
              updateOpts.voiceUrl = "https://api.vapi.ai/twilio/voice/handler";
              updateOpts.voiceMethod = "POST";
              await twilioClient.incomingPhoneNumbers(purchased.sid).update(updateOpts);
            }
          } catch (err: any) {
            console.error("God Mode phone fallback error:", err.message);
          }
        }
        if (phoneNumber) {
          await storage.updateSubAccount(account.id, { twilioNumber: phoneNumber });
        }
      }
      results.phoneNumber = phoneNumber;
      stream.sendStep("phone", phoneNumber ? "done" : "skipped", "Provisioning AI Phone Line",
        phoneNumber ? `Number: ${phoneNumber}` : "Twilio not configured");

      stream.sendStep("voice", "running", "Deploying Voice Agent");
      let agentId = null;
      if (vapiConfig.isConfigured) {
        try {
          const streamWebhookUrl = process.env.VAPI_WEBHOOK_URL || "https://apexmarketingautomations.com/api/vapi/webhook";
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
            serverUrl: streamWebhookUrl,
            serverMessages: [
              "assistant.started", "conversation-update", "end-of-call-report", "function-call",
              "hang", "speech-update", "status-update", "tool-calls", "transcript",
              "transfer-destination-request", "user-interrupted",
            ],
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
      stream.sendStep("voice", agentId ? "done" : "skipped", "Deploying Voice Agent",
        agentId ? `Agent: ${agentId.slice(0, 12)}...` : "Vapi not configured");

      stream.sendStep("bot", "running", "Training AI Knowledge Bot");
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
      stream.sendStep("bot", jobId ? "done" : "skipped", "Training AI Knowledge Bot",
        jobId ? `Training job #${jobId} started` : "No website provided");

      stream.sendStep("site", "running", "Generating Landing Page");
      let siteData = null;
      if (isAIConfigured()) {
        try {
          const godModePrompt = `Create a premium landing page for "${businessName}", a ${industry} business. Make it look high-end and professional with compelling copy.`;
          let siteParsed: any = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const godSiteStreamAiResult = await aiChat([
                { role: "system", content: SITE_SYSTEM_PROMPT },
                { role: "user", content: attempt === 0 ? godModePrompt : godModePrompt + "\n\nIMPORTANT: Return ONLY valid JSON." },
              ], { temperature: attempt === 0 ? 0.7 : 0.3, maxTokens: 4096, jsonMode: true, route: "webhook-god-mode-site-stream" });
              let cleaned = godSiteStreamAiResult.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
              const fb = cleaned.indexOf("{"); const lb = cleaned.lastIndexOf("}");
              if (fb !== -1 && lb > fb) cleaned = cleaned.substring(fb, lb + 1);
              cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");
              siteParsed = JSON.parse(cleaned);
              break;
            } catch { if (attempt === 1) throw new Error("JSON parse failed"); }
          }
          if (siteParsed.theme && Array.isArray(siteParsed.sections)) {
            siteParsed.sections = siteParsed.sections.map((s: any) => {
              if (s.props) return s;
              const { type, ...props } = s;
              return { type, props };
            });
            siteData = siteParsed;
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
      stream.sendStep("site", siteData ? "done" : "skipped", "Generating Landing Page",
        siteData ? "Landing page generated & saved" : "AI not configured");

      stream.sendStep("workflow", "running", "Creating Missed-Call Workflow");
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
      stream.sendStep("workflow", "done", "Creating Missed-Call Workflow", "Missed-Call Text Back active");

      stream.end({
        ...results,
        siteGenerated: !!siteData,
        status: "complete",
        steps: [
          { id: "account", status: "done", label: "Creating Sub-Account" },
          { id: "phone", status: phoneNumber ? "done" : "skipped", label: "Provisioning Phone Line" },
          { id: "voice", status: agentId ? "done" : "skipped", label: "Deploying Voice Agent" },
          { id: "bot", status: jobId ? "done" : "skipped", label: "Training AI Bot" },
          { id: "site", status: siteData ? "done" : "skipped", label: "Generating Landing Page" },
          { id: "workflow", status: "done", label: "Creating Missed-Call Workflow" },
        ],
      });
    } catch (err: any) {
      stream.sendError(err.message || "God Mode launch failed");
      stream.end();
    }
  }));

  // ---- Telegram Bot Webhook ----
  function getTelegramSecretSalt(): string {
    const salt = process.env.TELEGRAM_WEBHOOK_SECRET_SALT || process.env.SESSION_SECRET;
    if (!salt) {
      throw new Error("TELEGRAM_WEBHOOK_SECRET_SALT or SESSION_SECRET must be set for Telegram webhook security");
    }
    return salt;
  }

  function generateTelegramWebhookSecret(subAccountId: number): string {
    const salt = getTelegramSecretSalt();
    return crypto.createHash("sha256").update(`tg-webhook-${subAccountId}-${salt}`).digest("hex").substring(0, 32);
  }

  const telegramWebhookHandler = async (req: Request, res: Response) => {
    try {
      const update = req.body;
      const message = update?.message;
      if (!message || !message.text) {
        console.log("[TELEGRAM] Ignoring non-text update (type: " + (update?.message ? "non-text-message" : update?.edited_message ? "edited_message" : update?.callback_query ? "callback_query" : "unknown") + ")");
        return res.json({ ok: true });
      }

      const chatId = String(message.chat.id);
      const text = message.text;
      const username = message.from?.username || message.from?.first_name || "Unknown";
      const firstName = message.from?.first_name || username;
      const lastName = message.from?.last_name || "";

      console.log(`[TELEGRAM] Inbound from @${username} (chat_id=${chatId}): ${text.substring(0, 100)}`);

      let matchedAccount: typeof subAccounts.$inferSelect | undefined;

      const paramId = req.params.subAccountId ? Number(req.params.subAccountId) : null;

      if (paramId && paramId > 0) {
        const expectedSecret = generateTelegramWebhookSecret(paramId);
        const receivedSecret = req.headers["x-telegram-bot-api-secret-token"] as string | undefined;

        if (!receivedSecret || receivedSecret !== expectedSecret) {
          console.error(`[TELEGRAM] Webhook secret missing or invalid for account ${paramId} — rejecting request`);
          return res.status(403).json({ ok: false });
        }

        const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, paramId)).limit(1);
        if (account?.telegramBotToken) {
          matchedAccount = account;
          console.log(`[TELEGRAM] Matched account ${account.id} (${account.name}) via URL parameter (secret verified)`);
        } else if (account) {
          console.error(`[TELEGRAM] Account ${paramId} found but has no Telegram bot token configured — dropping message`);
          return res.json({ ok: true });
        } else {
          console.error(`[TELEGRAM] Account ${paramId} from URL parameter not found — dropping message`);
          return res.json({ ok: true });
        }
      } else {
        console.error("[TELEGRAM] No subAccountId in URL — this route requires /api/webhooks/telegram/:subAccountId");
        return res.status(400).json({ ok: false, error: "subAccountId required" });
      }

      if (!matchedAccount) {
        console.error("[TELEGRAM] No account with telegram_bot_token configured — dropping message");
        return res.json({ ok: true });
      }

      const subAccountId = matchedAccount.id;
      const contactPhone = chatId;

      const existingContact = await db.select({ id: contacts.id }).from(contacts)
        .where(and(eq(contacts.phone, contactPhone), eq(contacts.subAccountId, subAccountId)))
        .limit(1);

      if (existingContact.length === 0) {
        await db.insert(contacts).values({
          subAccountId,
          firstName,
          lastName,
          phone: contactPhone,
          channel: "telegram",
          source: "telegram-webhook",
        });
      }

      const inboundMsg = await storage.createMessage({
        subAccountId,
        contactPhone,
        body: text,
        direction: "inbound",
        channel: "telegram",
        status: "received",
        messageSid: `tg_${update.update_id}`,
        traceId: `tg-${Date.now()}`,
      });

      broadcastNewMessage(subAccountId, {
        id: inboundMsg.id,
        subAccountId,
        contactPhone,
        body: text,
        direction: "inbound",
        channel: "telegram",
        status: "received",
        createdAt: new Date().toISOString(),
      });

      let aiReply = "Thanks for your message! We'll get back to you shortly.";
      if (isAIConfigured()) {
        try {
          const dmCtx = await assembleDmContext({ subAccountId, contactPhone, channel: "telegram" });
          const aiMessages = await buildDmMessages(dmCtx, "telegram", text);
          const langInstr = getLanguageInstruction(dmCtx.language);
          if (langInstr && aiMessages.length > 0 && aiMessages[0].role === "system") {
            aiMessages[0].content += langInstr;
          }
          const aiResult = await aiChat(aiMessages, { temperature: 0.7, maxTokens: 1024, route: "webhook-telegram-reply" });
          aiReply = aiResult.text || aiReply;
        } catch (aiErr: any) {
          console.error("[TELEGRAM] AI reply error:", aiErr.message);
        }
      }

      const tgSendUrl = `https://api.telegram.org/bot${matchedAccount.telegramBotToken}/sendMessage`;
      const tgRes = await fetch(tgSendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: aiReply }),
      });
      const tgData = await tgRes.json() as any;

      const outStatus = tgData.ok ? "sent" : "failed";
      const outMsgSid = tgData.result?.message_id ? `tg_out_${tgData.result.message_id}` : `tg_out_${Date.now()}`;

      const outboundMsg = await storage.createMessage({
        subAccountId,
        contactPhone,
        body: aiReply,
        direction: "outbound",
        channel: "telegram",
        status: outStatus,
        messageSid: outMsgSid,
        traceId: `tg-reply-${Date.now()}`,
      });

      broadcastNewMessage(subAccountId, {
        id: outboundMsg.id,
        subAccountId,
        contactPhone,
        body: aiReply,
        direction: "outbound",
        channel: "telegram",
        status: outStatus,
        createdAt: new Date().toISOString(),
      });

      if (!tgData.ok) {
        console.error(`[TELEGRAM] Send failed for account ${subAccountId} to chat_id=${chatId}: ${tgData.description}`);
      } else {
        console.log(`[TELEGRAM] Reply sent successfully for account ${subAccountId} to chat_id=${chatId} (msg_id=${tgData.result?.message_id}): ${aiReply.substring(0, 80)}...`);
      }

      res.json({ ok: true });
    } catch (err: any) {
      console.error("[TELEGRAM] Webhook error:", err.message);
      res.json({ ok: true });
    }
  };
  app.post("/api/webhooks/telegram/:subAccountId", telegramWebhookHandler);

  app.post("/api/webhooks/telegram", (_req: Request, res: Response) => {
    console.warn("[TELEGRAM] Legacy fallback route /api/webhooks/telegram called without subAccountId — rejected. Use /api/webhooks/telegram/:subAccountId with secret_token.");
    res.status(400).json({ ok: false, error: "subAccountId required in URL path. Use /api/webhooks/telegram/:subAccountId" });
  });

  // ---- Telegram Bot Setup Endpoint ----
  app.post("/api/telegram/setup/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const subAccountId = Number(req.params.subAccountId);
    if (!subAccountId || isNaN(subAccountId) || subAccountId <= 0) {
      return res.status(400).json({ error: "Valid subAccountId is required" });
    }

    const ownershipValid = await verifyAccountOwnership(req, res, subAccountId);
    if (!ownershipValid) return;

    const { botToken } = req.body;
    if (!botToken || typeof botToken !== "string" || botToken.trim().length === 0) {
      return res.status(400).json({ error: "botToken is required and must be a non-empty string" });
    }

    const [existingAccount] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId)).limit(1);
    if (!existingAccount) {
      console.error(`[TELEGRAM-SETUP] Sub-account ${subAccountId} not found`);
      return res.status(404).json({ error: `Sub-account ${subAccountId} not found` });
    }

    console.log(`[TELEGRAM-SETUP] Starting setup for account ${subAccountId} (${existingAccount.name})`);

    let meData: any;
    try {
      const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      meData = await meRes.json() as any;
    } catch (fetchErr: any) {
      console.error(`[TELEGRAM-SETUP] Failed to reach Telegram API (getMe): ${fetchErr.message}`);
      return res.status(502).json({ error: `Could not reach Telegram API: ${fetchErr.message}` });
    }

    if (!meData.ok) {
      console.error(`[TELEGRAM-SETUP] Invalid bot token for account ${subAccountId}: ${meData.description}`);
      return res.status(400).json({ error: `Invalid bot token: ${meData.description}` });
    }

    const botUsername = meData.result.username;
    console.log(`[TELEGRAM-SETUP] Bot token validated: @${botUsername} (bot_id=${meData.result.id})`);

    const deployedDomain = process.env.REPLIT_DOMAINS?.split(",")[0] || process.env.REPL_SLUG + ".replit.app";
    const webhookUrl = `https://${deployedDomain}/api/webhooks/telegram/${subAccountId}`;
    const webhookSecret = generateTelegramWebhookSecret(subAccountId);

    let setData: any;
    try {
      const setRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, secret_token: webhookSecret }),
      });
      setData = await setRes.json() as any;
    } catch (webhookErr: any) {
      console.error(`[TELEGRAM-SETUP] Failed to register webhook with Telegram: ${webhookErr.message}`);
      return res.status(502).json({ error: `Could not register webhook with Telegram: ${webhookErr.message}` });
    }

    if (!setData.ok) {
      console.error(`[TELEGRAM-SETUP] Telegram rejected webhook registration: ${setData.description}`);
      return res.status(502).json({ error: `Telegram webhook registration failed: ${setData.description}` });
    }

    await db.update(subAccounts)
      .set({ telegramBotToken: botToken, telegramBotUsername: botUsername })
      .where(eq(subAccounts.id, subAccountId));

    console.log(`[TELEGRAM-SETUP] Complete — Bot @${botUsername} webhook set to ${webhookUrl} for account ${subAccountId} (${existingAccount.name})`);

    res.json({
      success: true,
      botUsername,
      webhookUrl,
      webhookSet: setData.ok,
      description: setData.description,
    });
  }));
}
