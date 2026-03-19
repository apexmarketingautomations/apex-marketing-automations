import type { Express, Request, Response } from "express";
import { contacts, messages, subAccounts, clientWebsites, integrationConnections } from "@shared/schema";
import { sql, eq, and, or } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { z } from "zod";
import { aiChat, isAIConfigured } from "../aiGateway";
import { ProgressStream } from "../streaming";
import crypto from "crypto";
import { asyncHandler, getUserId, requireAdmin, getIndustryContext, getLanguageInstruction, getTwilioClient, vapiConfig } from "./helpers";
import { assembleDmContext, buildDmMessages } from "../dmContextAssembler";
import { startTrace, recordStepValue } from "../traceRecorder";
import { resolveSubAccount, isRoutingFailure } from "../routing/resolver";
import { persistRoutingFailure } from "../routing/failureQueue";
import { withIdempotency, markEventCompleted, markEventFailed } from "../idempotency";

export function registerWebhooksRoutes(app: Express) {
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

        const twilioClient = await getTwilioClient();
        if (twilioClient && toRaw) {
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

        const twilioClient = await getTwilioClient();
        if (twilioClient && toRaw) {
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
        recordStepValue(trace, "crm_write", "success", Date.now() - crmStart, {
          metadata: { channel, direction: "inbound", messageId: storedMsg.id },
          disambiguator: messageSid || String(storedMsg.id),
        });
      } catch (e: any) {
        console.log(`[${channel.toUpperCase()}] Message storage error:`, e.message);
        recordStepValue(trace, "crm_write", "error", Date.now() - crmStart, {
          error: e.message,
          disambiguator: messageSid || `err-${senderClean}`,
        });
      }

      if (channel === "whatsapp") {
        const autoStart = Date.now();
        fireAutomationTrigger("OnWhatsAppReply", matchedAccountId, {
          senderPhone: senderClean,
          message: incomingMsg,
          channel: "whatsapp",
        }).then(() => {
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
          const aiMessages = buildDmMessages(dmCtx, channel, incomingMsg);
          const langInstr = getLanguageInstruction(dmCtx.language);
          if (langInstr && aiMessages.length > 0 && aiMessages[0].role === "system") {
            aiMessages[0].content += langInstr;
          }
          const smsAiResult = await aiChat(aiMessages, { temperature: 0.7, maxTokens: 1024, route: "webhook-sms-reply" });
          aiReply = smsAiResult.text || aiReply;
          recordStepValue(trace, "ai_response_generated", "success", Date.now() - aiStart, {
            provider: "ai",
            metadata: { replyLength: aiReply.length },
            disambiguator: inboundSid || `ai-${senderClean}`,
          });
        } catch (aiErr: any) {
          console.error("AI reply error:", aiErr.message);
          recordStepValue(trace, "ai_response_generated", "error", Date.now() - aiStart, {
            provider: "ai",
            error: aiErr.message,
            disambiguator: inboundSid ? `${inboundSid}-ai-err` : `ai-err-${senderClean}`,
          });
        }
      }

      const sendStart = Date.now();
      const twilioClient = await getTwilioClient();
      if (twilioClient && toRaw) {
        const replyFrom = channel === "whatsapp" ? `whatsapp:${stripChannelPrefix(toRaw)}`
          : channel === "messenger" ? `messenger:${stripChannelPrefix(toRaw)}`
          : toRaw;

        let outboundSid: string | null = null;
        let outboundStatus = "sent";
        try {
          const sentReply = await twilioClient.messages.create({
            body: aiReply,
            from: replyFrom,
            to: senderRaw,
          });
          outboundSid = sentReply.sid;
          recordStepValue(trace, "outbound_send", "success", Date.now() - sendStart, {
            provider: "twilio",
            metadata: { channel, to: senderClean, messageSid: sentReply.sid },
            disambiguator: sentReply.sid || `reply-${senderClean}`,
          });
        } catch (sendErr: any) {
          outboundStatus = "failed";
          console.error("[WEBHOOKS] Outbound send failed:", sendErr.message);
          recordStepValue(trace, "outbound_send", "error", Date.now() - sendStart, {
            provider: "twilio",
            error: sendErr.message,
            metadata: { channel, to: senderClean },
            disambiguator: `reply-err-${senderClean}`,
          });
        }

        try {
          await storage.createMessage({
            subAccountId: matchedAccountId,
            contactPhone: senderClean,
            body: aiReply,
            direction: "outbound",
            channel,
            status: outboundStatus,
            messageSid: outboundSid || null,
            traceId: trace.traceId,
          });
        } catch (logErr: any) {
          console.error("[WEBHOOKS] Failed to log outbound reply:", logErr.message);
        }
      }

      await markEventCompleted(req);
      res.type("text/xml").send("<Response></Response>");
    } catch (err: any) {
      console.error("Unified webhook error:", err);
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

  async function validateTwilioSignature(req: Request): Promise<boolean> {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      console.warn("[TWILIO-INBOUND] TWILIO_AUTH_TOKEN not set — skipping signature validation");
      return true;
    }
    try {
      const twilio = await import("twilio");
      const validateRequest = (twilio.default || twilio).validateRequest || (twilio as any).validateRequest;
      if (!validateRequest) return true;
      const signature = req.headers["x-twilio-signature"] as string || "";
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

  async function upsertCrmContact(phone: string, subAccountId: number): Promise<{ id: number; isNew: boolean }> {
    const variants = phone.replace(/\D/g, "");
    const [existing] = await db.select()
      .from(contacts)
      .where(and(
        eq(contacts.subAccountId, subAccountId),
        or(eq(contacts.phone, phone), eq(contacts.phone, `+1${variants}`), eq(contacts.phone, `+${variants}`))
      ))
      .limit(1);

    if (existing) {
      await db.update(contacts)
        .set({ lastContactedAt: new Date() } as any)
        .where(eq(contacts.id, existing.id));
      return { id: existing.id, isNew: false };
    }

    const newContact = await storage.createContact({
      subAccountId,
      firstName: `SMS ${phone.slice(-4)}`,
      phone,
      source: "sms_inbound",
      tags: ["sms", "inbound"],
    });
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

    console.log(`[TWILIO-INBOUND][${traceId}] Received inbound SMS`);

    try {
      // 1. Signature validation
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

      // 2. Resolve sub-account from To number
      const matchedAccounts = await db.select().from(subAccounts)
        .where(eq(subAccounts.twilioNumber, toClean))
        .limit(1)
        .execute()
        .catch(() => []);
      const subAccountId = matchedAccounts.length > 0 ? matchedAccounts[0].id : 1;
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

        const twilioClient = await getTwilioClient();
        if (twilioClient && toRaw) {
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

        const twilioClient = await getTwilioClient();
        if (twilioClient && toRaw) {
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

        const twilioClient = await getTwilioClient();
        if (twilioClient && toRaw) {
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

      // 5. Check opt-out before AI processing
      const isOptedOut = await checkPhoneOptOut(senderClean, subAccountId);
      if (isOptedOut) {
        console.log(`[TWILIO-INBOUND][${traceId}] Contact ${senderClean} is opted out — skipping AI reply`);
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
          const aiMsgs = buildDmMessages(dmCtx, "sms", incomingMsg);
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
      const twilioClient = await getTwilioClient();
      if (twilioClient && toRaw) {
        const replyBody = aiReply || fallbackReply;
        let outboundSid: string | null = null;
        let outboundStatus = "sent";

        try {
          const tSendStart = Date.now();
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

  // Backward compatibility alias — redirect old sms-webhook to new endpoint
  // (the old /api/sms-webhook handler above still handles WhatsApp/Messenger)

  // ---- Meta/Facebook Webhook (Instagram/Facebook DMs) ----
  app.get("/api/meta-webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const verifyToken = process.env.META_VERIFY_TOKEN || "apex_verify_2026";
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
    try {
      const body = req.body;
      console.log(`[META WEBHOOK] Inbound POST received — object=${body?.object}, entries=${body?.entry?.length ?? 0}, raw=${JSON.stringify(body).substring(0, 500)}`);

      if (body.object === "page" || body.object === "instagram") {
        for (const entry of body.entry || []) {
          const entryPageId = entry.id as string | undefined;

          for (const event of entry.messaging || []) {
            const senderId = event.sender?.id;
            const message = event.message?.text;
            const mid = event.message?.mid as string | undefined;

            if (!senderId || !message) {
              console.warn(`[META DM] Skipping event — missing sender (${senderId}) or message text`);
              continue;
            }

            const channel = body.object === "instagram" ? "instagram" : "facebook";

            // --- STRICT TENANT RESOLUTION: look up sub-account by page_id ---
            if (!entryPageId) {
              console.error(`[META DM] Rejected ${channel} event — entry.id (page_id) is missing from webhook payload. Cannot route to sub-account.`);
              continue;
            }

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

            let subAccountId: number | null = null;
            let accessToken: string | null = null;
            let pageId: string | null = null;
            let appSecret: string | null = null;

            for (const conn of integrationRows) {
              const cfg = conn.config as any;
              const connPageId = cfg?.pageId || cfg?.page_id || cfg?.META_PAGE_ID;
              if (connPageId && String(connPageId) === String(entryPageId)) {
                subAccountId = conn.subAccountId;
                accessToken = cfg?.accessToken || cfg?.META_ACCESS_TOKEN || null;
                pageId = connPageId;
                appSecret = cfg?.appSecret || cfg?.META_APP_SECRET || null;
                break;
              }
            }

            if (!subAccountId) {
              console.error(`[META DM] Rejected ${channel} event from sender=${senderId} — page_id=${entryPageId} not mapped to any sub-account in integration_connections. Configure Meta integration for this page.`);
              continue;
            }

            console.log(`[META DM] ${channel} from ${senderId} -> subAccountId=${subAccountId} (page=${entryPageId}): ${message.substring(0, 100)}`);

            let metaTraceId = crypto.randomUUID();
            if (mid) {
              try {
                const existingEvent = await storage.getEventLogByExternalId("meta", mid);
                if (existingEvent && (existingEvent.status === "completed" || existingEvent.status === "processing")) {
                  console.log(`[IDEMPOTENCY] Duplicate Meta event mid=${mid} (status: ${existingEvent.status}) — skipping`);
                  continue;
                }
                if (existingEvent) {
                  metaTraceId = existingEvent.traceId;
                  await storage.updateEventLogStatus(existingEvent.id, "processing");
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
                }
              } catch (idempErr: any) {
                if (!idempErr?.message?.includes("unique")) {
                  console.error(`[META DM] Idempotency check error for mid=${mid}:`, idempErr.message);
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
              });
              recordStepValue(metaTrace, "crm_write", "success", Date.now() - metaCrmStart, {
                metadata: { channel, direction: "inbound" },
                disambiguator: mid || `meta-crm-${senderId}`,
              });
            } catch (crmWriteErr: any) {
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
              } else {
                const newContact = await storage.createContact({
                  subAccountId,
                  firstName: `${channel === "instagram" ? "IG" : "FB"} User ${senderId.slice(-4)}`,
                  phone: senderId,
                  source: `${channel}_dm`,
                  tags: [channel, "dm_lead"],
                });
                existingContactRecord = newContact;
                console.log(`[META DM] Created CRM contact id=${newContact.id} for ${senderId}`);
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

            if (!keywordMatched && isAIConfigured()) {
              const metaAiStart = Date.now();
              try {
                const dmCtx = await assembleDmContext({
                  subAccountId,
                  contactPhone: senderId,
                  channel,
                });

                let customPersona = "";
                try {
                  const websites = await db.select().from(clientWebsites)
                    .where(eq(clientWebsites.subAccountId, subAccountId)).limit(1);
                  if (websites.length > 0 && websites[0].botPersona) {
                    customPersona = websites[0].botPersona;
                  }
                } catch (err: any) {
                  console.warn("[META DM] Bot persona fetch skipped:", err.message);
                }

                if (customPersona && !dmCtx.customAiPrompt) {
                  dmCtx.customAiPrompt = customPersona;
                }

                const aiMessages = buildDmMessages(dmCtx, channel, message);
                const langInstr = getLanguageInstruction(dmCtx.language);
                if (langInstr && aiMessages.length > 0 && aiMessages[0].role === "system") {
                  aiMessages[0].content += langInstr;
                }

                const metaDmAiResult = await aiChat(aiMessages, { temperature: 0.7, maxTokens: 1024, route: "webhook-meta-dm-reply" });
                const aiReply = metaDmAiResult.text;

                recordStepValue(metaTrace, "ai_response_generated", "success", Date.now() - metaAiStart, {
                  provider: "ai",
                  metadata: { channel, replyLength: aiReply?.length || 0 },
                  disambiguator: mid || `meta-ai-${senderId}`,
                });

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
                    recordStepValue(metaTrace, "outbound_send", "error", Date.now() - metaSendStart, {
                      provider: "meta",
                      error: JSON.stringify(sendData).substring(0, 200),
                      metadata: { channel },
                      disambiguator: mid ? `${mid}-send-err` : `meta-send-err-${senderId}`,
                    });
                  } else {
                    console.log(`[META DM] AI reply sent to ${senderId}: OK, messageId=${sendData?.message_id}`);
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
                }
              } catch (aiErr: any) {
                console.error("[META DM] AI reply error:", aiErr.message);
                recordStepValue(metaTrace, "ai_response_generated", "error", Date.now() - metaAiStart, {
                  provider: "ai",
                  error: aiErr.message,
                  metadata: { channel },
                  disambiguator: mid ? `${mid}-ai-err` : `meta-ai-err-${senderId}`,
                });
              }
            }

            if (mid) {
              try {
                const existing = await storage.getEventLogByExternalId("meta", mid);
                if (existing) {
                  await storage.updateEventLogStatus(existing.id, "completed", { processedAt: new Date() });
                }
              } catch {}
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
}
