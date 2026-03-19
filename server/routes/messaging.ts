import type { Express, Request, Response } from "express";
import { insertMessageSchema, insertWhatsappTemplateSchema, messages, whatsappTemplates, integrationConnections } from "@shared/schema";
import { sql, eq, and } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { messagingLimiter } from "../rateLimiter";
import { publishEventAsync, EVENT_TYPES } from "../eventBus";
import { asyncHandler, parseIntParam, verifyAccountOwnership, logUsageInternal, getTwilioClient } from "./helpers";
import { validateRouting } from "../routing/gate";
import { recordSuccess } from "../pulse";
import { startTrace, recordStepValue } from "../traceRecorder";
import { getMetaConfig, buildMetaUrl } from "../metaConfig";

export function registerMessagingRoutes(app: Express) {
  // ---- Messages ----
  app.get("/api/messages/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const msgs = await storage.getMessages(subAccountId);
    if (msgs.length === 0) {
      console.log(`[MESSAGES API] GET /api/messages/${subAccountId} — returned 0 rows. DB: ${process.env.DATABASE_URL ? "connected" : "missing"}, NODE_ENV=${process.env.NODE_ENV}`);
    }
    res.json(msgs);
  }));

  // ---- Conversation Threads API ----
  // Returns grouped conversations (subAccountId + contactPhone + channel) sorted by recency
  app.get("/api/conversations/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const threads = await storage.getConversationThreads(subAccountId);
    res.json(threads);
  }));

  // ---- Thread Messages (single conversation) ----
  app.get("/api/conversations/:subAccountId/messages", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { contactPhone, channel } = req.query as { contactPhone?: string; channel?: string };
    if (!contactPhone || !channel) {
      return res.status(400).json({ error: "contactPhone and channel query params are required" });
    }
    const msgs = await storage.getMessages(subAccountId);
    const filtered = msgs.filter(m => m.contactPhone === contactPhone && (m.channel || "sms") === channel);
    filtered.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    res.json(filtered);
  }));

  app.post("/api/messages", messagingLimiter, asyncHandler(async (req, res) => {
    const parsed = insertMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const traceId = (req as any).eventTraceId as string | undefined;
    const trace = traceId
      ? { traceId, subAccountId: parsed.data.subAccountId, contactPhone: parsed.data.contactPhone ?? undefined }
      : startTrace(parsed.data.subAccountId, { contactPhone: parsed.data.contactPhone ?? undefined });

    const crmStart = Date.now();
    try {
      const msg = await storage.createMessage({ ...parsed.data, traceId: trace.traceId });
      recordStepValue(trace, "crm_write", "success", Date.now() - crmStart, {
        metadata: { channel: parsed.data.channel || "sms", direction: parsed.data.direction || "outbound", messageId: msg.id },
        disambiguator: String(msg.id),
      });
      res.status(201).json(msg);
    } catch (err: any) {
      recordStepValue(trace, "crm_write", "error", Date.now() - crmStart, {
        error: err.message,
        metadata: { channel: parsed.data.channel || "sms" },
      });
      throw err;
    }
  }));


  // ---- SMS Sending via Twilio ----
  app.post("/api/messages/send", asyncHandler(async (req, res) => {
    const parsed = insertMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, contactPhone, body, channel } = parsed.data;

    const traceId = (req as any).eventTraceId as string | undefined;
    const trace = traceId
      ? { traceId, subAccountId, contactPhone: contactPhone ?? undefined }
      : startTrace(subAccountId, { contactPhone: contactPhone ?? undefined });

    const gateResult = await validateRouting({
      subAccountId,
      source: "messaging-api",
      channel: channel || "sms",
      phone: contactPhone,
    });
    if (!gateResult.allowed) {
      return res.status(403).json({ error: `Routing gate rejected outbound message: ${gateResult.reason}` });
    }

    const { checkPhoneOptOut } = await import("../optOutGuard");
    const smsOptedOut = await checkPhoneOptOut(contactPhone, subAccountId);
    if (smsOptedOut && (channel === "sms" || !channel)) {
      return res.status(403).json({ error: "Recipient has opted out of SMS communications" });
    }

    let twilioStatus = "pending";
    let twilioSid: string | null = null;
    let twilioError: string | null = null;

    if (channel === "whatsapp") {
      const twilioClient = await getTwilioClient();
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
            recordSuccess("twilio");

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
      const twilioClient = await getTwilioClient();
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
            recordSuccess("twilio");
          } catch (twilioErr: any) {
            console.error("[SMS] Twilio send error:", twilioErr.message);
            twilioStatus = "failed";
            twilioError = twilioErr.message || "Twilio send failed";
          }
        }
      }
    } else if (channel === "facebook") {
      const fbConnections = await db.select().from(integrationConnections)
        .where(and(
          eq(integrationConnections.subAccountId, subAccountId),
          eq(integrationConnections.provider, "meta"),
          eq(integrationConnections.status, "connected")
        ))
        .limit(1)
        .execute()
        .catch(() => []);

      const fbConfig = fbConnections.length > 0 ? fbConnections[0].config as any : null;
      const metaToken = fbConfig?.accessToken || fbConfig?.META_ACCESS_TOKEN || null;
      const metaPageId = fbConfig?.pageId || fbConfig?.page_id || fbConfig?.META_PAGE_ID || null;
      const metaAppSecret = fbConfig?.appSecret || fbConfig?.META_APP_SECRET || null;

      if (!metaToken || !metaPageId) {
        twilioStatus = "failed";
        twilioError = `No Facebook integration credentials found for subAccount ${subAccountId}. Connect Meta integration with a pageId and accessToken for this account.`;
      } else {
        try {
          let proofParam = "";
          if (metaAppSecret) {
            const crypto = await import("crypto");
            const proof = crypto.createHmac("sha256", metaAppSecret).update(metaToken).digest("hex");
            proofParam = `?appsecret_proof=${proof}`;
          }
          const fbUrl = `https://graph.facebook.com/v19.0/${metaPageId}/messages${proofParam}`;
          const fbRes = await fetch(fbUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipient: { id: contactPhone },
              message: { text: body },
              access_token: metaToken,
            }),
          });
          const fbData = await fbRes.json() as any;
          if (fbRes.ok) {
            twilioStatus = "sent";
            twilioSid = fbData.message_id || null;
          } else {
            twilioStatus = "failed";
            twilioError = fbData?.error?.message || "Facebook send failed";
          }
        } catch (fbErr: any) {
          twilioStatus = "failed";
          twilioError = fbErr.message || "Facebook send failed";
        }
      }
    } else {
      twilioStatus = "unsupported";
      twilioError = `Channel '${channel}' is not supported for outbound sending. Use 'sms', 'whatsapp', or 'facebook'.`;
    }

    const sendStartMs = Date.now();
    const msg = await storage.createMessage({
      ...parsed.data,
      status: twilioStatus,
      traceId: trace.traceId,
    });

    const sendStatus = (twilioStatus === "failed" || twilioStatus === "unsupported") ? "error" : "success";
    recordStepValue(trace, "outbound_send", sendStatus, Date.now() - sendStartMs, {
      provider: "twilio",
      metadata: { channel: channel || "sms", to: contactPhone, status: twilioStatus, messageId: msg.id },
      error: twilioError ?? undefined,
      disambiguator: twilioSid || String(msg.id),
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

      const deliveryStart = Date.now();
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

        const [matchedMsg] = await db.execute(
          sql`SELECT trace_id, sub_account_id FROM messages WHERE contact_phone = ${cleanPhone} AND channel = 'whatsapp' AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`
        ) as any;
        if (matchedMsg?.trace_id && matchedMsg?.sub_account_id) {
          const delivTrace = { traceId: matchedMsg.trace_id, subAccountId: matchedMsg.sub_account_id, contactPhone: cleanPhone };
          recordStepValue(delivTrace, "delivery_status", normalizedStatus === "failed" ? "error" : "success", Date.now() - deliveryStart, {
            provider: "twilio",
            metadata: { status: normalizedStatus, messageSid: MessageSid },
            disambiguator: `${MessageSid}:${normalizedStatus}`,
          });
        }
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
}
