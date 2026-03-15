import type { Express, Request, Response } from "express";
import { contacts, messages, subAccounts } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { z } from "zod";
import { geminiChat, isGeminiConfigured } from "../gemini";
import { ProgressStream } from "../streaming";
import crypto from "crypto";
import { asyncHandler, getUserId, requireAdmin, getIndustryContext, getLanguageInstruction, getTwilioClient, vapiConfig } from "./helpers";

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

      const toClean = toRaw ? stripChannelPrefix(toRaw) : "";
      const matchedAccounts = await db.select().from(subAccounts).where(eq(subAccounts.twilioNumber, toClean)).execute().catch(() => []);
      const matchedAccountId = matchedAccounts.length > 0 ? matchedAccounts[0].id : 1;

      const { isOptOutMessage, isOptInMessage, handleSmsOptOut, handleSmsOptIn } = await import("../optOutGuard");
      if (isOptOutMessage(incomingMsg)) {
        await handleSmsOptOut(senderClean, matchedAccountId);
        console.log(`[OPT-OUT] ${senderClean} opted out of SMS`);

        const twilioClient = getTwilioClient();
        if (twilioClient && toRaw) {
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
        await handleSmsOptIn(senderClean, matchedAccountId);
        console.log(`[OPT-IN] ${senderClean} opted back in to SMS`);

        const twilioClient = getTwilioClient();
        if (twilioClient && toRaw) {
          await twilioClient.messages.create({
            body: "You have been re-subscribed and will receive messages from us again.",
            from: toRaw,
            to: senderRaw,
          });
        }

        res.type("text/xml").send("<Response></Response>");
        return;
      }

      try {
        await storage.createMessage({
          subAccountId: matchedAccountId,
          contactPhone: senderClean,
          body: incomingMsg,
          direction: "inbound",
          channel,
          status: "received",
        });
      } catch (e: any) {
        console.log(`[${channel.toUpperCase()}] Message storage error:`, e.message);
      }

      if (channel === "whatsapp") {
        fireAutomationTrigger("OnWhatsAppReply", matchedAccountId, {
          senderPhone: senderClean,
          message: incomingMsg,
          channel: "whatsapp",
        }).catch(() => {});
      }

      let aiReply = "Thanks for your message! We'll get back to you shortly.";

      if (isGeminiConfigured()) {
        try {
          const smsIndustry = req.body.industry as string | undefined;
          const smsLanguage = req.body.language as string | undefined;
          const baseSystemPrompt = channel === "sms"
            ? "You are a helpful business receptionist. Keep text replies under 160 characters. Be warm, professional, and concise. If someone wants to book an appointment, suggest they call the office number."
            : "You are a helpful business assistant responding via chat. Keep replies conversational and under 300 characters. Be warm, professional, and helpful. If someone wants to book an appointment, suggest they call the office number.";
          const systemPrompt = baseSystemPrompt + getIndustryContext(smsIndustry) + getLanguageInstruction(smsLanguage);

          const geminiReply = await geminiChat([
            { role: "system", content: systemPrompt },
            { role: "user", content: incomingMsg.substring(0, 1000) },
          ], { temperature: 0.7, maxTokens: 1024 });
          aiReply = geminiReply || aiReply;
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

  // ---- Meta/Facebook Webhook (Instagram/Facebook DMs) ----
  app.get("/api/meta-webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const verifyToken = process.env.META_VERIFY_TOKEN || "apex_verify_2026";
    if (mode === "subscribe" && token === verifyToken) {
      console.log("[META WEBHOOK] Verified");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  app.post("/api/meta-webhook", async (req, res) => {
    try {
      const body = req.body;
      console.log("[META WEBHOOK] Received:", JSON.stringify(body).substring(0, 500));

      if (body.object === "page" || body.object === "instagram") {
        for (const entry of body.entry || []) {
          for (const event of entry.messaging || []) {
            const senderId = event.sender?.id;
            const message = event.message?.text;

            if (!senderId || !message) {
              console.warn(`[META DM] Skipping event — missing sender (${senderId}) or message text`);
              continue;
            }

            const channel = body.object === "instagram" ? "instagram" : "facebook";
            console.log(`[META DM] ${channel} from ${senderId}: ${message.substring(0, 100)}`);

            const accessToken = process.env.META_ACCESS_TOKEN;
            const pageId = process.env.META_PAGE_ID;
            const appSecret = process.env.META_APP_SECRET;

            const allAccounts = await storage.getSubAccounts();
            const targetAccount = allAccounts.find(a => a.ownerUserId !== "_archived") || allAccounts[0];
            const subAccountId = targetAccount?.id || 13;

            if (!accessToken || !pageId) {
              const rawPayload = JSON.stringify(event).substring(0, 2000);
              console.error(`[META DM] Cannot process ${channel} message from ${senderId} — META_ACCESS_TOKEN or META_PAGE_ID not configured. Set these environment variables in your Replit project. Visit the Integrations page for a setup guide. Raw event: ${rawPayload}`);
              await db.insert(messages).values({
                subAccountId,
                channel,
                direction: "inbound",
                contactPhone: senderId,
                body: `[UNPROCESSED - Missing META credentials] Raw: ${rawPayload.substring(0, 500)}`,
                status: "failed",
              });
              continue;
            }

            let appsecretProof = "";
            if (accessToken && appSecret) {
              const crypto = await import("crypto");
              appsecretProof = crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
            }

            await db.insert(messages).values({
              subAccountId,
              channel,
              direction: "inbound",
              contactPhone: senderId,
              body: message,
              status: "received",
            });

            try {
              const existingContact = await db.select().from(contacts)
                .where(and(
                  eq(contacts.subAccountId, subAccountId),
                  eq(contacts.source, `${channel}_dm`),
                  eq(contacts.phone, senderId)
                )).limit(1);

              if (existingContact.length === 0) {
                const newContact = await storage.createContact({
                  subAccountId,
                  firstName: `${channel === "instagram" ? "IG" : "FB"} User ${senderId.slice(-4)}`,
                  phone: senderId,
                  source: `${channel}_dm`,
                  tags: [channel, "dm_lead"],
                });
                console.log(`[META DM] Created CRM contact id=${newContact.id} for ${senderId}`);

                fireAutomationTrigger("new_lead", subAccountId, {
                  leadName: newContact.firstName,
                  leadPhone: senderId,
                  source: `${channel}_dm`,
                });
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
                console.warn(`[META DM] Cannot send keyword reply to ${senderId}: META_ACCESS_TOKEN or META_PAGE_ID not configured. Message stored but not delivered.`);
                await db.insert(messages).values({
                  subAccountId,
                  channel,
                  direction: "outbound",
                  contactPhone: senderId,
                  body: kw.responseText,
                  status: "failed",
                });
              } else if (kw.responseText && accessToken && pageId) {
                const kwUrl = `https://graph.facebook.com/v19.0/${pageId}/messages` + (appsecretProof ? `?appsecret_proof=${appsecretProof}` : "");
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
                  console.error(`[META DM] Keyword reply FAILED to ${senderId}: ${JSON.stringify(kwSendData).substring(0, 300)}`);
                }

                await db.insert(messages).values({
                  subAccountId,
                  channel,
                  direction: "outbound",
                  contactPhone: senderId,
                  body: kw.responseText,
                  status: kwSendStatus,
                });
                if (kwSendRes.ok) console.log(`[META DM] Keyword reply sent to ${senderId}`);
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

            if (!keywordMatched && isGeminiConfigured()) {
              try {
                let systemPrompt = `You are a helpful business assistant responding via ${channel} DM. Keep replies conversational and under 300 characters. Be warm, professional, and helpful.`;

                try {
                  const websites = await db.select().from(clientWebsites)
                    .where(eq(clientWebsites.subAccountId, subAccountId)).limit(1);
                  if (websites.length > 0 && websites[0].botPersona) {
                    systemPrompt = `${websites[0].botPersona}\n\nYou are responding via ${channel} DM. Keep replies conversational and under 300 characters.`;
                  }
                } catch {}

                if (targetAccount?.industry) {
                  systemPrompt += ` The business is in the ${targetAccount.industry} industry.`;
                }

                const aiReply = await geminiChat([
                  { role: "system", content: systemPrompt },
                  { role: "user", content: message.substring(0, 1000) },
                ], { temperature: 0.7, maxTokens: 1024 });

                if (aiReply && (!accessToken || !pageId)) {
                  console.warn(`[META DM] AI reply generated but cannot send to ${senderId}: META_ACCESS_TOKEN or META_PAGE_ID not configured.`);
                  await db.insert(messages).values({
                    subAccountId,
                    channel,
                    direction: "outbound",
                    contactPhone: senderId,
                    body: aiReply,
                    status: "failed",
                  });
                } else if (aiReply && accessToken && pageId) {
                  const aiUrl = `https://graph.facebook.com/v19.0/${pageId}/messages` + (appsecretProof ? `?appsecret_proof=${appsecretProof}` : "");
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
                  const aiSendStatus = sendRes.ok ? "sent" : "failed";
                  if (!sendRes.ok) {
                    console.error(`[META DM] AI reply FAILED to ${senderId}: ${JSON.stringify(sendData).substring(0, 300)}`);
                  } else {
                    console.log(`[META DM] AI reply sent to ${senderId}: OK`);
                  }

                  await db.insert(messages).values({
                    subAccountId,
                    channel,
                    direction: "outbound",
                    contactPhone: senderId,
                    body: aiReply,
                    status: aiSendStatus,
                  });
                }
              } catch (aiErr: any) {
                console.error("[META DM] AI reply error:", aiErr.message);
              }
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
        runRealTraining(job.id);
      } catch (err: any) {
        console.error("God Mode bot training error:", err.message);
      }
    }
    results.jobId = jobId;
    results.steps[3].status = jobId ? "done" : "skipped";

    results.steps.push({ id: "site", status: "running", label: "Generating Landing Page" });
    let siteData = null;
    if (isGeminiConfigured()) {
      try {
        const godModePrompt = `Create a premium landing page for "${businessName}", a ${industry} business. Make it look high-end and professional with compelling copy.`;
        let parsed: any = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const raw = await geminiChat([
              { role: "system", content: SITE_SYSTEM_PROMPT },
              { role: "user", content: attempt === 0 ? godModePrompt : godModePrompt + "\n\nIMPORTANT: Return ONLY valid JSON." },
            ], { temperature: attempt === 0 ? 0.7 : 0.3, maxTokens: 4096, jsonMode: true });
            let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
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
      if (isGeminiConfigured()) {
        try {
          const godModePrompt = `Create a premium landing page for "${businessName}", a ${industry} business. Make it look high-end and professional with compelling copy.`;
          let siteParsed: any = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const raw = await geminiChat([
                { role: "system", content: SITE_SYSTEM_PROMPT },
                { role: "user", content: attempt === 0 ? godModePrompt : godModePrompt + "\n\nIMPORTANT: Return ONLY valid JSON." },
              ], { temperature: attempt === 0 ? 0.7 : 0.3, maxTokens: 4096, jsonMode: true });
              let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
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
