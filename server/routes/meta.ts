import type { Express, Request, Response } from "express";
import { insertMetaAdCampaignSchema, insertMetaLeadSchema, messages, dmKeywordAutomations } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import crypto from "crypto";
import { dispatchAlert, generateDeepLink } from "../pushAlertService";
import { asyncHandler, verifyAccountOwnership } from "./helpers";

export function registerMetaRoutes(app: Express) {
  // ---- Meta Ad Campaigns ----

  app.get("/api/meta/campaigns/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const campaigns = await storage.getMetaAdCampaigns(Number(req.params.subAccountId));
    res.json(campaigns);
  }));

  app.post("/api/meta/campaigns", asyncHandler(async (req: Request, res: Response) => {
    const data = insertMetaAdCampaignSchema.parse(req.body);
    const campaign = await storage.createMetaAdCampaign(data);
    res.json(campaign);
  }));

  app.patch("/api/meta/campaigns/:id", asyncHandler(async (req: Request, res: Response) => {
    const campaign = await storage.updateMetaAdCampaign(Number(req.params.id), req.body);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    res.json(campaign);
  }));

  app.delete("/api/meta/campaigns/:id", asyncHandler(async (req: Request, res: Response) => {
    const ok = await storage.deleteMetaAdCampaign(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "Campaign not found" });
    res.json({ success: true });
  }));

  app.post("/api/meta/campaigns/:id/sync", asyncHandler(async (req: Request, res: Response) => {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const campaign = await storage.getMetaAdCampaign(Number(req.params.id));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    if (!accessToken || !campaign.metaCampaignId) {
      return res.status(503).json({ error: "Meta API not configured or no campaign ID linked. Add META_ACCESS_TOKEN and publish the campaign to Meta first." });
    }

    try {
      const fbRes = await fetch(`https://graph.facebook.com/v19.0/${campaign.metaCampaignId}/insights?fields=impressions,clicks,spend,cpc,ctr,actions&access_token=${accessToken}`);
      const fbData = await fbRes.json() as any;
      if (fbData.data && fbData.data[0]) {
        const insights = fbData.data[0];
        const leads = insights.actions?.find((a: any) => a.action_type === "lead")?.value || 0;
        await storage.updateMetaAdCampaign(campaign.id, {
          impressions: parseInt(insights.impressions || "0"),
          clicks: parseInt(insights.clicks || "0"),
          totalSpend: parseFloat(insights.spend || "0"),
          cpc: parseFloat(insights.cpc || "0"),
          ctr: parseFloat(insights.ctr || "0"),
          leads: parseInt(leads),
        });
      }
      const updated = await storage.getMetaAdCampaign(campaign.id);
      res.json({ synced: true, campaign: updated });
    } catch (err: any) {
      res.status(500).json({ error: `Meta sync failed: ${err.message}` });
    }
  }));

  app.post("/api/meta/campaigns/:id/publish", asyncHandler(async (req: Request, res: Response) => {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const adAccountId = process.env.META_AD_ACCOUNT_ID;
    const campaign = await storage.getMetaAdCampaign(Number(req.params.id));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    if (!accessToken || !adAccountId) {
      return res.status(503).json({ error: "Meta API not configured. Add META_ACCESS_TOKEN and META_AD_ACCOUNT_ID environment variables to publish campaigns to Facebook/Instagram." });
    }

    try {
      const fbRes = await fetch(`https://graph.facebook.com/v19.0/act_${adAccountId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaign.name,
          objective: campaign.objective,
          status: "ACTIVE",
          special_ad_categories: [],
          access_token: accessToken,
        }),
      });
      const fbData = await fbRes.json() as any;
      if (!fbRes.ok || !fbData.id) {
        const errorMsg = fbData?.error?.message || JSON.stringify(fbData).substring(0, 300);
        console.error(`[META] Campaign publish failed: ${errorMsg}`);
        return res.status(502).json({ error: `Meta API rejected the campaign: ${errorMsg}` });
      }
      await storage.updateMetaAdCampaign(campaign.id, { metaCampaignId: fbData.id, status: "active" });
      const updated = await storage.getMetaAdCampaign(campaign.id);
      res.json({ published: true, campaign: updated });
    } catch (err: any) {
      res.status(500).json({ error: `Campaign publish failed: ${err.message}` });
    }
  }));

  // ---- Meta Lead Forms ----

  app.get("/api/meta/leads/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const leads = await storage.getMetaLeads(Number(req.params.subAccountId));
    res.json(leads);
  }));

  app.post("/api/meta/leads", asyncHandler(async (req: Request, res: Response) => {
    const data = insertMetaLeadSchema.parse(req.body);
    const lead = await storage.createMetaLead(data);
    res.json(lead);
  }));

  app.post("/api/meta/leads/sync/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const pageId = process.env.META_PAGE_ID;
    const subAccountId = Number(req.params.subAccountId);

    if (!accessToken || !pageId) {
      return res.status(503).json({ error: "Meta API not configured. Add META_ACCESS_TOKEN and META_PAGE_ID to sync leads from Facebook." });
    }

    try {
      const formsRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/leadgen_forms?access_token=${accessToken}`);
      const formsData = await formsRes.json() as any;
      let totalSynced = 0;

      if (formsData.data) {
        for (const form of formsData.data) {
          const leadsRes = await fetch(`https://graph.facebook.com/v19.0/${form.id}/leads?access_token=${accessToken}`);
          const leadsData = await leadsRes.json() as any;
          if (leadsData.data) {
            const existingLeads = await storage.getMetaLeads(subAccountId);
            const existingFormLeadKeys = new Set(existingLeads.map(l => `${l.metaFormId}:${l.name}:${l.email}`));
            for (const lead of leadsData.data) {
              const fields = lead.field_data || [];
              const getName = (key: string) => fields.find((f: any) => f.name === key)?.values?.[0] || "";
              const name = getName("full_name") || getName("first_name") || "Unknown";
              const email = getName("email") || "";
              const dedupeKey = `${form.id}:${name}:${email}`;
              if (existingFormLeadKeys.has(dedupeKey)) continue;
              await storage.createMetaLead({
                subAccountId,
                metaFormId: form.id,
                formName: form.name,
                name,
                email,
                phone: getName("phone_number"),
                customFields: fields,
              });
              existingFormLeadKeys.add(dedupeKey);
              totalSynced++;

              storage.createNotification({
                subAccountId,
                type: "new_lead",
                title: "New Facebook Lead",
                body: `${name}${email ? ` (${email})` : ""} submitted a lead form`,
                link: "/meta-leads",
              }).catch(() => {});
              dispatchAlert(subAccountId, "new_lead", {
                title: "New Facebook Lead",
                body: `${name}${email ? ` (${email})` : ""} submitted a lead form`,
                link: generateDeepLink("/meta-leads"),
                tag: `fb-lead-${Date.now()}`,
              }).catch(e => console.error("[PUSH-ALERT] fb lead dispatch failed:", e instanceof Error ? e.message : e));

              const account = await storage.getSubAccount(subAccountId);
              if (account?.twilioNumber && getName("phone_number")) {
                try {
                  const twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
                  await twilioClient.messages.create({
                    body: `Hi ${name.split(" ")[0] || "there"}! Thanks for your interest. We received your inquiry and will follow up shortly. - ${account.name}`,
                    from: account.twilioNumber,
                    to: getName("phone_number"),
                  });
                  await storage.createMessage({
                    subAccountId,
                    direction: "outbound",
                    body: `[Auto-reply] Hi ${name.split(" ")[0] || "there"}! Thanks for your interest. We received your inquiry and will follow up shortly.`,
                    status: "sent",
                    contactPhone: getName("phone_number"),
                    channel: "sms",
                  });
                } catch (smsErr: any) {
                  console.log("Auto-reply SMS failed (non-blocking):", smsErr.message);
                }
              }
            }
          }
        }
      }
      res.json({ synced: true, count: totalSynced });
    } catch (err: any) {
      res.status(500).json({ error: `Lead sync failed: ${err.message}` });
    }
  }));

  app.post("/api/meta/leads/:id/to-crm", asyncHandler(async (req: Request, res: Response) => {
    const lead = await storage.getMetaLead(Number(req.params.id));
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.syncedToCrm && lead.contactId) {
      return res.json({ success: true, alreadySynced: true, contactId: lead.contactId });
    }

    const existingContacts = await storage.getContacts(lead.subAccountId);
    const existingContact = lead.email
      ? existingContacts.find(c => c.email === lead.email)
      : lead.phone
        ? existingContacts.find(c => c.phone === lead.phone)
        : null;

    const contact = existingContact || await storage.createContact({
      subAccountId: lead.subAccountId,
      firstName: (lead.name || "").split(" ")[0] || "Unknown",
      lastName: (lead.name || "").split(" ").slice(1).join(" ") || "",
      email: lead.email || "",
      phone: lead.phone || "",
      source: "facebook_lead_form",
      tags: ["meta-lead"],
    });

    await storage.updateMetaLead(lead.id, { syncedToCrm: true, contactId: contact.id });
    res.json({ success: true, contact });
  }));

  // ---- DM Keyword Automations CRUD ----
  app.get("/api/dm-keywords/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const keywords = await storage.getDmKeywordAutomations(subAccountId);
    res.json(keywords);
  }));

  app.post("/api/dm-keywords", asyncHandler(async (req, res) => {
    const { subAccountId, keyword, matchType, channel, responseText, responseType, actionPayload, enabled } = req.body;
    if (!subAccountId || !keyword) {
      return res.status(400).json({ error: "subAccountId and keyword are required" });
    }
    if (!(await verifyAccountOwnership(req, res, Number(subAccountId)))) return;
    const created = await storage.createDmKeywordAutomation({
      subAccountId: Number(subAccountId),
      keyword: keyword.trim(),
      matchType: matchType || "exact",
      channel: channel || "all",
      responseText: responseText || null,
      responseType: responseType || "text",
      actionPayload: actionPayload || null,
      enabled: enabled !== false,
    });
    console.log(`[DM-KEYWORDS] Created keyword "${keyword}" for account ${subAccountId}`);
    res.status(201).json(created);
  }));

  app.put("/api/dm-keywords/:id", asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.select().from(dmKeywordAutomations).where(eq(dmKeywordAutomations.id, id)).limit(1);
    if (!existing.length) return res.status(404).json({ error: "Keyword automation not found" });
    if (!(await verifyAccountOwnership(req, res, existing[0].subAccountId))) return;
    const updated = await storage.updateDmKeywordAutomation(id, req.body);
    res.json(updated);
  }));

  app.delete("/api/dm-keywords/:id", asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.select().from(dmKeywordAutomations).where(eq(dmKeywordAutomations.id, id)).limit(1);
    if (!existing.length) return res.status(404).json({ error: "Keyword automation not found" });
    if (!(await verifyAccountOwnership(req, res, existing[0].subAccountId))) return;
    await storage.deleteDmKeywordAutomation(id);
    res.json({ success: true });
  }));

  // ---- Instagram DM Inbox ----

  app.get("/api/meta/instagram/conversations/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const conversations = await storage.getInstagramConversations(Number(req.params.subAccountId));
    res.json(conversations);
  }));

  app.get("/api/meta/instagram/messages/:conversationId", asyncHandler(async (req: Request, res: Response) => {
    const msgs = await storage.getInstagramMessages(Number(req.params.conversationId));
    res.json(msgs);
  }));

  app.post("/api/meta/instagram/send", asyncHandler(async (req: Request, res: Response) => {
    const { conversationId, body } = req.body;
    const conversation = await storage.getInstagramConversation(conversationId);
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    const accessToken = process.env.META_ACCESS_TOKEN;
    const pageId = process.env.META_PAGE_ID;

    const msg = await storage.createInstagramMessage({
      conversationId,
      direction: "outbound",
      body,
    });

    if (accessToken && pageId && conversation.igUserId) {
      try {
        const appSecret = process.env.META_APP_SECRET;
        let proof = "";
        if (appSecret) {
          const crypto = await import("crypto");
          proof = crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
        }
        const sendUrl = `https://graph.facebook.com/v19.0/${pageId}/messages` + (proof ? `?appsecret_proof=${proof}` : "");
        await fetch(sendUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: conversation.igUserId },
            message: { text: body },
            access_token: accessToken,
          }),
        });
      } catch (err: any) {
        console.log("Meta IG send error (non-blocking):", err.message);
      }
    }

    await storage.updateInstagramConversation(conversationId, {
      lastMessage: body,
      lastMessageAt: new Date(),
    });

    res.json(msg);
  }));

  app.post("/api/meta/instagram/sync/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const pageId = process.env.META_PAGE_ID;
    const subAccountId = Number(req.params.subAccountId);

    if (!accessToken || !pageId) {
      const missing = [];
      if (!accessToken) missing.push("META_ACCESS_TOKEN");
      if (!pageId) missing.push("META_PAGE_ID");
      return res.status(503).json({
        error: `Instagram sync requires ${missing.join(" and ")} to be configured. Go to the Integrations page for a step-by-step setup guide to connect your Meta/Facebook account.`
      });
    }

    try {
      const appSecret = process.env.META_APP_SECRET;
      let proof = "";
      if (appSecret) {
        const crypto = await import("crypto");
        proof = crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
      }
      const convRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/conversations?platform=instagram&fields=participants,messages{message,from,created_time}&access_token=${accessToken}` + (proof ? `&appsecret_proof=${proof}` : ""));
      const convData = await convRes.json() as any;

      if (convData.error) {
        const errMsg = convData.error.message || JSON.stringify(convData.error).substring(0, 300);
        console.error(`[META INSTAGRAM] API error during sync: ${errMsg}`);
        return res.status(502).json({ error: `Meta API error: ${errMsg}. Check that your access token has the required permissions and hasn't expired.` });
      }

      let count = 0;

      if (convData.data) {
        for (const conv of convData.data) {
          const participant = conv.participants?.data?.find((p: any) => p.id !== pageId);
          if (!participant) continue;

          const existing = await storage.getInstagramConversations(subAccountId);
          let conversation = existing.find(c => c.igUserId === participant.id);

          if (!conversation) {
            conversation = await storage.createInstagramConversation({
              subAccountId,
              igUserId: participant.id,
              igUsername: participant.name || participant.id,
            });
          }

          if (conv.messages?.data) {
            const existingMsgs = await storage.getInstagramMessages(conversation.id);
            const existingMsgIds = new Set(existingMsgs.map(m => m.igMessageId).filter(Boolean));
            for (const m of conv.messages.data) {
              if (m.id && existingMsgIds.has(m.id)) continue;
              await storage.createInstagramMessage({
                conversationId: conversation.id,
                direction: m.from?.id === pageId ? "outbound" : "inbound",
                body: m.message || "",
                igMessageId: m.id,
              });
            }
            const lastMsg = conv.messages.data[0];
            if (lastMsg) {
              await storage.updateInstagramConversation(conversation.id, {
                lastMessage: lastMsg.message,
                lastMessageAt: new Date(lastMsg.created_time),
              });
            }
          }
          count++;
        }
      }
      res.json({ synced: true, conversations: count });
    } catch (err: any) {
      res.status(500).json({ error: `Instagram sync failed: ${err.message}` });
    }
  }));

  // ---- Meta Config Check ----
  app.get("/api/meta/config", asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      hasAccessToken: !!process.env.META_ACCESS_TOKEN,
      hasAdAccountId: !!process.env.META_AD_ACCOUNT_ID,
      hasPageId: !!process.env.META_PAGE_ID,
      hasAppId: !!process.env.META_APP_ID,
    });
  }));

  // ---- Meta DM Diagnostics ----
  app.get("/api/meta/dm-diagnostics", asyncHandler(async (_req: Request, res: Response) => {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const pageId = process.env.META_PAGE_ID;
    const appSecret = process.env.META_APP_SECRET;
    const verifyToken = process.env.META_VERIFY_TOKEN || "apex_verify_2026";

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    const webhookUrl = domain ? `https://${domain}/api/meta-webhook` : null;

    const result: any = {
      credentials: {
        accessToken: { set: !!accessToken, valid: false, detail: "" },
        pageId: { set: !!pageId, value: pageId || null },
        appSecret: { set: !!appSecret },
      },
      webhook: {
        url: webhookUrl,
        verifyToken,
      },
    };

    if (accessToken) {
      try {
        const debugRes = await fetch(`https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${accessToken}`);
        const debugData = await debugRes.json() as any;
        if (debugData.data) {
          const d = debugData.data;
          result.credentials.accessToken.valid = d.is_valid === true;
          result.credentials.accessToken.detail = d.is_valid
            ? `Valid. App ID: ${d.app_id || "unknown"}, expires: ${d.expires_at ? (d.expires_at === 0 ? "never" : new Date(d.expires_at * 1000).toISOString()) : "unknown"}`
            : `Invalid or expired: ${d.error?.message || "unknown error"}`;
          result.credentials.accessToken.appId = d.app_id;
          result.credentials.accessToken.expiresAt = d.expires_at;
          result.credentials.accessToken.scopes = d.scopes;
        } else {
          result.credentials.accessToken.detail = debugData.error?.message || "Could not validate token";
        }
      } catch (err: any) {
        result.credentials.accessToken.detail = `Validation request failed: ${err.message}`;
      }
    } else {
      result.credentials.accessToken.detail = "Not configured";
    }

    if (accessToken && pageId) {
      try {
        let proof = "";
        if (appSecret) {
          const crypto = await import("crypto");
          proof = crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
        }
        const pageRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=name,id&access_token=${accessToken}${proof ? `&appsecret_proof=${proof}` : ""}`);
        const pageData = await pageRes.json() as any;
        if (pageData.name) {
          result.credentials.pageId.valid = true;
          result.credentials.pageId.pageName = pageData.name;
        } else {
          result.credentials.pageId.valid = false;
          result.credentials.pageId.error = pageData.error?.message || "Could not fetch page info";
        }
      } catch (err: any) {
        result.credentials.pageId.valid = false;
        result.credentials.pageId.error = `Page check failed: ${err.message}`;
      }
    }

    res.json(result);
  }));

  app.post("/api/meta/dm-diagnostics/test-webhook", asyncHandler(async (req: Request, res: Response) => {
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    if (!domain) {
      return res.status(400).json({ success: false, error: "No public domain available to test webhook" });
    }

    const verifyToken = process.env.META_VERIFY_TOKEN || "apex_verify_2026";
    const testChallenge = "apex_test_" + Date.now();
    const webhookUrl = `https://${domain}/api/meta-webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=${testChallenge}`;

    try {
      const testRes = await fetch(webhookUrl);
      const body = await testRes.text();
      if (testRes.ok && body === testChallenge) {
        res.json({ success: true, message: "Webhook verification endpoint is reachable and responding correctly" });
      } else {
        res.json({ success: false, error: `Webhook returned status ${testRes.status}, body: ${body.substring(0, 200)}` });
      }
    } catch (err: any) {
      res.json({ success: false, error: `Could not reach webhook: ${err.message}` });
    }
  }));
}
