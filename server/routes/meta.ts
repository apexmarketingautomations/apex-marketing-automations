import type { Express, Request, Response } from "express";
import { insertMetaAdCampaignSchema, insertMetaLeadSchema, messages, dmKeywordAutomations, subAccounts } from "@shared/schema";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import crypto from "crypto";
import { dispatchAlert, generateDeepLink } from "../pushAlertService";
import { asyncHandler, verifyAccountOwnership, getUserId } from "./helpers";
import { enforceSmsProvider } from "../smsGatewayGuard";
import { getMetaConfig, validateMetaConfigForAccount } from "../metaConfig";
import { requireActiveSubscription } from "../subscriptionGuard";
import { emitUniversalEvent, emitWithTimeline, EVENT_TYPES } from "../intelligence/eventEmitter";

const subscriptionGuard = requireActiveSubscription();

export function registerMetaRoutes(app: Express) {
  // ---- Meta Ad Campaigns ----

  app.get("/api/meta/campaigns/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const campaigns = await storage.getMetaAdCampaigns(subAccountId);
    res.json(campaigns);
  }));

  app.post("/api/meta/campaigns", asyncHandler(async (req: Request, res: Response) => {
    const data = insertMetaAdCampaignSchema.parse(req.body);
    if (!(await verifyAccountOwnership(req, res, data.subAccountId))) return;
    const campaign = await storage.createMetaAdCampaign(data);
    emitWithTimeline(
      { eventType: EVENT_TYPES.AD_CAMPAIGN_LAUNCHED, sourceModule: "meta", sourceTable: "meta_ad_campaigns", sourceRecordId: String(campaign.id), subAccountId: campaign.subAccountId, campaignId: campaign.id, metadata: { campaignName: campaign.name, objective: campaign.objective, status: campaign.status } },
      "Meta Ad Campaign Created",
      `Campaign "${campaign.name}" created for ${campaign.objective}`,
      "info"
    );
    res.json(campaign);
  }));

  app.patch("/api/meta/campaigns/:id", asyncHandler(async (req: Request, res: Response) => {
    const campaign = await storage.getMetaAdCampaign(Number(req.params.id));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (!(await verifyAccountOwnership(req, res, campaign.subAccountId))) return;
    const updated = await storage.updateMetaAdCampaign(campaign.id, req.body);
    res.json(updated);
  }));

  app.delete("/api/meta/campaigns/:id", asyncHandler(async (req: Request, res: Response) => {
    const campaign = await storage.getMetaAdCampaign(Number(req.params.id));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (!(await verifyAccountOwnership(req, res, campaign.subAccountId))) return;
    const ok = await storage.deleteMetaAdCampaign(campaign.id);
    if (!ok) return res.status(404).json({ error: "Campaign not found" });
    res.json({ success: true });
  }));

  app.post("/api/meta/campaigns/:id/sync", asyncHandler(async (req: Request, res: Response) => {
    const campaign = await storage.getMetaAdCampaign(Number(req.params.id));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (!(await verifyAccountOwnership(req, res, campaign.subAccountId))) return;

    let metaCfg;
    try {
      metaCfg = await getMetaConfig(campaign.subAccountId);
    } catch (err: any) {
      return res.status(503).json({ error: err.message });
    }

    if (!campaign.metaCampaignId) {
      return res.status(400).json({ error: "No campaign ID linked. Publish the campaign to Meta first." });
    }

    try {
      const fbRes = await fetch(`https://graph.facebook.com/v21.0/${campaign.metaCampaignId}/insights?fields=impressions,clicks,spend,cpc,ctr,actions&access_token=${metaCfg.accessToken}`);
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
          lastSyncedAt: new Date(),
        });
      } else {
        await storage.updateMetaAdCampaign(campaign.id, { lastSyncedAt: new Date() });
      }
      const updated = await storage.getMetaAdCampaign(campaign.id);
      emitUniversalEvent({ eventType: EVENT_TYPES.AD_CAMPAIGN_UPDATED, sourceModule: "meta", sourceTable: "meta_ad_campaigns", sourceRecordId: String(campaign.id), subAccountId: campaign.subAccountId, campaignId: campaign.id, metadata: { campaignName: campaign.name, action: "synced", impressions: updated?.impressions, clicks: updated?.clicks, spend: updated?.totalSpend, leads: updated?.leads } });
      res.json({ synced: true, campaign: updated });
    } catch (err: any) {
      res.status(500).json({ error: `Meta sync failed: ${err.message}` });
    }
  }));

  app.post("/api/meta/campaigns/:id/publish", subscriptionGuard, asyncHandler(async (req: Request, res: Response) => {
    const adAccountId = process.env.META_AD_ACCOUNT_ID;
    const campaign = await storage.getMetaAdCampaign(Number(req.params.id));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (!(await verifyAccountOwnership(req, res, campaign.subAccountId))) return;

    let metaCfg;
    try {
      metaCfg = await getMetaConfig(campaign.subAccountId);
    } catch (err: any) {
      return res.status(503).json({ error: err.message });
    }

    if (!adAccountId) {
      return res.status(503).json({ error: "META_AD_ACCOUNT_ID not configured. Required to publish campaigns." });
    }

    try {
      const fbRes = await fetch(`https://graph.facebook.com/v21.0/act_${adAccountId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaign.name,
          objective: campaign.objective,
          status: "ACTIVE",
          special_ad_categories: [],
          access_token: metaCfg.accessToken,
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
      emitWithTimeline(
        { eventType: EVENT_TYPES.AD_CAMPAIGN_LAUNCHED, sourceModule: "meta", sourceTable: "meta_ad_campaigns", sourceRecordId: String(campaign.id), subAccountId: campaign.subAccountId, campaignId: campaign.id, metadata: { campaignName: campaign.name, metaCampaignId: fbData.id, objective: campaign.objective, action: "published" } },
        "Meta Campaign Published",
        `Campaign "${campaign.name}" published to Meta Ads (ID: ${fbData.id})`,
        "info"
      );
      res.json({ published: true, campaign: updated });
    } catch (err: any) {
      res.status(500).json({ error: `Campaign publish failed: ${err.message}` });
    }
  }));

  // ---- Meta Lead Forms ----

  app.get("/api/meta/leads/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const leads = await storage.getMetaLeads(subAccountId);
    res.json(leads);
  }));

  app.post("/api/meta/leads", asyncHandler(async (req: Request, res: Response) => {
    const data = insertMetaLeadSchema.parse(req.body);
    if (!(await verifyAccountOwnership(req, res, data.subAccountId))) return;
    const lead = await storage.createMetaLead(data);
    res.json(lead);
  }));

  app.post("/api/meta/leads/sync/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    let metaCfg;
    try {
      metaCfg = await getMetaConfig(subAccountId);
    } catch (err: any) {
      return res.status(503).json({ error: err.message });
    }

    try {
      const formsRes = await fetch(`https://graph.facebook.com/v21.0/${metaCfg.pageId}/leadgen_forms?access_token=${metaCfg.accessToken}`);
      const formsData = await formsRes.json() as any;
      let totalSynced = 0;

      if (formsData.data) {
        for (const form of formsData.data) {
          const leadsRes = await fetch(`https://graph.facebook.com/v21.0/${form.id}/leads?access_token=${metaCfg.accessToken}`);
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

              emitUniversalEvent({ eventType: EVENT_TYPES.AD_LEAD_CAPTURED, sourceModule: "meta", sourceTable: "meta_leads", subAccountId, metadata: { name, email, phone: getName("phone_number"), formId: form.id, formName: form.name, action: "lead_synced" } });

              storage.createNotification({
                subAccountId,
                type: "new_lead",
                title: "New Facebook Lead",
                body: `${name}${email ? ` (${email})` : ""} submitted a lead form`,
                link: "/meta-leads",
              }).catch(e => console.error("[META] Notification creation failed:", e instanceof Error ? e.message : e));
              dispatchAlert(subAccountId, "new_lead", {
                title: "New Facebook Lead",
                body: `${name}${email ? ` (${email})` : ""} submitted a lead form`,
                link: generateDeepLink("/meta-leads"),
                tag: `fb-lead-${Date.now()}`,
              }).catch(e => console.error("[PUSH-ALERT] fb lead dispatch failed:", e instanceof Error ? e.message : e));

              const account = await storage.getSubAccount(subAccountId);
              if (account?.twilioNumber && getName("phone_number")) {
                try {
                  const { getTwilioClientForAccount: getTwilioClientMeta } = await import("../twilioClientFactory");
                  const metaClientResult = await getTwilioClientMeta(subAccountId);
                  if (!metaClientResult) throw new Error("Twilio not configured for account");
                  await enforceSmsProvider("sms", "twilio", { subAccountId, phone: getName("phone_number"), source: "meta-lead-auto-reply" });
                  await metaClientResult.client.messages.create({
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
    if (!(await verifyAccountOwnership(req, res, lead.subAccountId))) return;
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
    emitWithTimeline(
      { eventType: EVENT_TYPES.LEAD_CREATED, sourceModule: "meta", sourceTable: "meta_leads", sourceRecordId: String(lead.id), subAccountId: lead.subAccountId, contactId: contact.id, metadata: { leadName: lead.name, leadEmail: lead.email, leadPhone: lead.phone, contactId: contact.id, alreadyExisted: !!existingContact } },
      "Meta Lead Synced to CRM",
      `Facebook lead "${lead.name}" converted to CRM contact`,
      "info"
    );
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

  const dmKeywordUpdateSchema = z.object({
    keyword: z.string().min(1).max(200).optional(),
    matchType: z.enum(["exact", "contains", "starts_with"]).optional(),
    channel: z.string().max(50).optional(),
    responseText: z.string().max(2000).nullable().optional(),
    responseType: z.enum(["text", "template", "action"]).optional(),
    actionPayload: z.any().nullable().optional(),
    enabled: z.boolean().optional(),
  });

  app.put("/api/dm-keywords/:id", asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.select().from(dmKeywordAutomations).where(eq(dmKeywordAutomations.id, id)).limit(1);
    if (!existing.length) return res.status(404).json({ error: "Keyword automation not found" });
    if (!(await verifyAccountOwnership(req, res, existing[0].subAccountId))) return;
    const parsed = dmKeywordUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const updated = await storage.updateDmKeywordAutomation(id, parsed.data);
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
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const conversations = await storage.getInstagramConversations(subAccountId);
    res.json(conversations);
  }));

  app.get("/api/meta/instagram/messages/:conversationId", asyncHandler(async (req: Request, res: Response) => {
    const conversationId = Number(req.params.conversationId);
    const conversation = await storage.getInstagramConversation(conversationId);
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });
    if (!(await verifyAccountOwnership(req, res, conversation.subAccountId))) return;
    const msgs = await storage.getInstagramMessages(conversationId);
    res.json(msgs);
  }));

  app.post("/api/meta/instagram/send", asyncHandler(async (req: Request, res: Response) => {
    const { conversationId, body } = req.body;
    const conversation = await storage.getInstagramConversation(conversationId);
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });
    if (!(await verifyAccountOwnership(req, res, conversation.subAccountId))) return;

    const msg = await storage.createInstagramMessage({
      conversationId,
      direction: "outbound",
      body,
    });

    if (conversation.igUserId) {
      try {
        const metaCfg = await getMetaConfig(conversation.subAccountId);
        const sendUrl = `https://graph.facebook.com/v21.0/${metaCfg.pageId}/messages` + (metaCfg.appsecretProof ? `?appsecret_proof=${metaCfg.appsecretProof}` : "");
        await fetch(sendUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: conversation.igUserId },
            message: { text: body },
            access_token: metaCfg.accessToken,
          }),
        });
      } catch (err: any) {
        console.error("[META IG] Send error:", err.message);
      }
    }

    await storage.updateInstagramConversation(conversationId, {
      lastMessage: body,
      lastMessageAt: new Date(),
    });

    res.json(msg);
  }));

  app.post("/api/meta/instagram/sync/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    console.log(`[META INSTAGRAM SYNC] Manual sync triggered for subAccountId=${subAccountId}`);

    let metaCfg;
    try {
      metaCfg = await getMetaConfig(subAccountId);
      console.log(`[META INSTAGRAM SYNC] Credentials resolved for subAccountId=${subAccountId}: pageId=${metaCfg.pageId}, hasToken=${!!metaCfg.accessToken}, hasAppSecret=${!!metaCfg.appSecret}`);
    } catch (err: any) {
      console.error(`[META INSTAGRAM SYNC] Credential resolution failed for subAccountId=${subAccountId}: ${err.message}`);
      return res.status(503).json({ error: err.message });
    }

    try {
      const convRes = await fetch(`https://graph.facebook.com/v21.0/${metaCfg.pageId}/conversations?platform=instagram&fields=participants,messages{message,from,created_time}&access_token=${metaCfg.accessToken}` + (metaCfg.appsecretProof ? `&appsecret_proof=${metaCfg.appsecretProof}` : ""));
      const convData = await convRes.json() as any;

      if (convData.error) {
        const errMsg = convData.error.message || JSON.stringify(convData.error).substring(0, 300);
        console.error(`[META INSTAGRAM] API error during sync: ${errMsg}`);
        return res.status(502).json({ error: `Meta API error: ${errMsg}. Check that your access token has the required permissions and hasn't expired.` });
      }

      let count = 0;

      if (convData.data) {
        for (const conv of convData.data) {
          const participant = conv.participants?.data?.find((p: any) => p.id !== metaCfg.pageId);
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
                direction: m.from?.id === metaCfg.pageId ? "outbound" : "inbound",
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

  // ---- Meta Config Check (per-account) ----
  app.get("/api/meta/config", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = req.query.subAccountId ? Number(req.query.subAccountId) : null;
    if (subAccountId) {
      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
      try {
        const account = await storage.getSubAccount(subAccountId);
        res.json({
          hasAccessToken: !!account?.metaAccessToken,
          hasAdAccountId: !!process.env.META_AD_ACCOUNT_ID,
          hasPageId: !!account?.metaPageId,
          hasAppId: !!process.env.META_APP_ID,
          metaPageId: account?.metaPageId || null,
        });
      } catch {
        res.json({ hasAccessToken: false, hasAdAccountId: false, hasPageId: false, hasAppId: false });
      }
    } else {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const userId = getUserId(user);
      const allAccounts = await storage.getSubAccounts();
      const userAccounts = allAccounts.filter(a => a.ownerUserId === userId);
      const anyConfigured = userAccounts.some(a => a.metaAccessToken && a.metaPageId);
      res.json({
        hasAccessToken: anyConfigured,
        hasAdAccountId: !!process.env.META_AD_ACCOUNT_ID,
        hasPageId: anyConfigured,
        hasAppId: !!process.env.META_APP_ID,
      });
    }
  }));

  // ---- Meta DM Diagnostics (per-account) ----
  app.get("/api/meta/dm-diagnostics", asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const subAccountId = req.query.subAccountId ? Number(req.query.subAccountId) : null;
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    const webhookUrl = domain ? `https://${domain}/api/meta-webhook` : null;

    if (!subAccountId) {
      const userId = getUserId(user);
      const allAccounts = await storage.getSubAccounts();
      const userAccounts = allAccounts.filter(a => a.ownerUserId === userId);
      const accountDiags = await Promise.all(userAccounts.map(async (acc) => {
        const validation = acc.metaAccessToken && acc.metaPageId
          ? await validateMetaConfigForAccount(acc.id)
          : { valid: false, error: "Not configured" };
        return {
          subAccountId: acc.id,
          name: acc.name,
          metaPageId: acc.metaPageId || null,
          hasAccessToken: !!acc.metaAccessToken,
          hasAppSecret: !!acc.metaAppSecret,
          ...validation,
        };
      }));
      return res.json({ accounts: accountDiags, webhook: { url: webhookUrl, verifyTokenConfigured: !!process.env.META_VERIFY_TOKEN } });
    }

    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const account = await storage.getSubAccount(subAccountId);
    if (!account) return res.status(404).json({ error: "Sub-account not found" });

    const accessToken = account.metaAccessToken;
    const pageId = account.metaPageId;
    const appSecret = account.metaAppSecret;

    const result: any = {
      subAccountId,
      accountName: account.name,
      credentials: {
        accessToken: { set: !!accessToken, valid: false, detail: "" },
        pageId: { set: !!pageId, value: pageId || null },
        appSecret: { set: !!appSecret },
      },
      webhook: { url: webhookUrl, verifyTokenConfigured: !!process.env.META_VERIFY_TOKEN },
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
      const validation = await validateMetaConfigForAccount(subAccountId);
      result.credentials.pageId.valid = validation.valid;
      if (validation.pageName) result.credentials.pageId.pageName = validation.pageName;
      if (validation.error) result.credentials.pageId.error = validation.error;
    }

    res.json(result);
  }));

  app.post("/api/meta/dm-diagnostics/test-webhook", asyncHandler(async (req: Request, res: Response) => {
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    if (!domain) {
      return res.status(400).json({ success: false, error: "No public domain available to test webhook" });
    }

    const verifyToken = process.env.META_VERIFY_TOKEN;
    if (!verifyToken) {
      return res.status(400).json({ success: false, error: "META_VERIFY_TOKEN not configured" });
    }
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

  // ---- Save Meta credentials for a sub-account ----
  app.put("/api/meta/config/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { metaPageId, metaAccessToken, metaAppSecret } = req.body;

    if (!metaPageId || !metaAccessToken) {
      return res.status(400).json({ error: "metaPageId and metaAccessToken are required" });
    }

    const { eq } = await import("drizzle-orm");
    await db.update(subAccounts).set({
      metaPageId: metaPageId.trim(),
      metaAccessToken: metaAccessToken.trim(),
      metaAppSecret: metaAppSecret?.trim() || null,
    }).where(eq(subAccounts.id, subAccountId));

    const validation = await validateMetaConfigForAccount(subAccountId);

    res.json({
      saved: true,
      validation,
    });
  }));

  app.post("/api/meta/dm-sequence/deploy/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const account = await storage.getSubAccount(subAccountId);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const { formUrl, bookingLink, sequenceName } = req.body;

    const calLink = bookingLink || "https://calendar.app.google/Fwdtvy7Sy3P8Z1CV6";
    const form = formUrl || `${req.protocol}://${req.get("host")}/form/${subAccountId}`;

    const manifest = {
      name: sequenceName || "DM Lead Sequence",
      description: "Auto-engages Facebook/Instagram DM leads with form capture, booking link, and phone follow-up",
      trigger: "OnFacebookDM",
      steps: [
        {
          action: "SendFacebookDM",
          payload: {
            body: `Hey {{leadName}}! Thanks for reaching out to ${account.name || "us"}. We'd love to learn more about what you're looking for so we can serve you best.`,
          },
        },
        {
          action: "Wait",
          payload: { seconds: 3 },
        },
        {
          action: "SendFormLink",
          payload: {
            formUrl: form,
            body: `To get started, could you fill out this quick form? It helps us understand your needs better: ${form}`,
            channel: "facebook",
          },
        },
        {
          action: "Wait",
          payload: { seconds: 5 },
        },
        {
          action: "SendBookingLink",
          payload: {
            body: `Also, if you'd like to hop on a quick call to discuss your goals, feel free to pick a time that works: ${calLink}`,
          },
        },
        {
          action: "Wait",
          payload: { seconds: 10 },
        },
        {
          action: "VapiCall",
          payload: {
            assistantId: "e30434f7-e7e0-4be7-8b89-40c384a52b4a",
            first_message: `Hi {{leadName}}, this is the team from ${account.name || "Apex Marketing"}. You reached out to us on Facebook and I wanted to follow up personally to see how we can help you.`,
          },
        },
      ],
    };

    const automation = await storage.createLiveAutomation({
      name: manifest.name,
      description: manifest.description,
      manifest,
      status: "compiled",
      subAccountId,
      lastRunAt: null,
      runCount: 0,
      runLogs: [],
    });

    console.log(`[DM-SEQUENCE] Deployed "${manifest.name}" (id=${automation.id}) for account ${subAccountId}`);

    res.json({
      status: "deployed",
      automationId: automation.id,
      name: manifest.name,
      trigger: manifest.trigger,
      steps: manifest.steps.length,
      manifest,
    });
  }));

  app.get("/api/meta/dm-sequence/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const automations = await storage.getLiveAutomations(subAccountId);
    const dmSequences = automations.filter((a: any) =>
      a.manifest?.trigger === "OnFacebookDM" || a.manifest?.trigger === "OnInstagramDM"
    );
    res.json(dmSequences);
  }));
}
