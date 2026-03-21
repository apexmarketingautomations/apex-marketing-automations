import type { Express } from "express";
import { asyncHandler, parseIntParam, verifyAccountOwnership } from "./helpers";
import {
  syncContactToMailchimp,
  applyTagsToContact,
  removeTagsFromContact,
  getMailchimpTemplates,
  sendEmailViaCampaign,
  handleNoResponse,
  getEmailLogs,
  getSyncLogs,
  getMailchimpAudienceStats,
  bulkSyncContacts,
  TEMPLATE_KEYS,
} from "../mailchimp";
import { storage } from "../storage";

export function registerMailchimpRoutes(app: Express) {
  app.get("/api/mailchimp/:subAccountId/status", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const connection = await storage.getIntegrationConnection(subAccountId, "mailchimp");
    const connected = connection?.status === "connected";
    const config = connection?.config as Record<string, any> | null;

    let audienceStats = null;
    if (connected) {
      audienceStats = await getMailchimpAudienceStats(subAccountId);
    }

    res.json({
      connected,
      hasApiKey: !!config?.apiKey,
      hasAudienceId: !!config?.audienceId,
      audienceStats,
    });
  }));

  app.get("/api/mailchimp/:subAccountId/templates", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const templates = await getMailchimpTemplates(subAccountId);
    res.json({
      templates: templates.map((t: any) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        dateCreated: t.date_created,
      })),
      requiredTemplates: Object.values(TEMPLATE_KEYS),
    });
  }));

  app.get("/api/mailchimp/:subAccountId/email-logs", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const logs = await getEmailLogs(subAccountId, limit);
    res.json(logs);
  }));

  app.get("/api/mailchimp/:subAccountId/sync-logs", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const logs = await getSyncLogs(subAccountId, limit);
    res.json(logs);
  }));

  app.post("/api/mailchimp/:subAccountId/sync-contact", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ error: "contactId is required" });

    const contact = await storage.getContactById(contactId);
    if (!contact || contact.subAccountId !== subAccountId) {
      return res.status(404).json({ error: "Contact not found" });
    }

    const success = await syncContactToMailchimp(subAccountId, {
      email: contact.email || "",
      firstName: contact.firstName,
      lastName: contact.lastName || undefined,
      phone: contact.phone || undefined,
      source: contact.source || undefined,
      tags: (contact.tags as string[]) || [],
    }, contact.id);

    res.json({ success });
  }));

  app.post("/api/mailchimp/:subAccountId/bulk-sync", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const result = await bulkSyncContacts(subAccountId);
    res.json(result);
  }));

  app.post("/api/mailchimp/:subAccountId/apply-tags", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { email, tags } = req.body;
    if (!email || !tags || !Array.isArray(tags)) {
      return res.status(400).json({ error: "email and tags[] are required" });
    }

    const success = await applyTagsToContact(subAccountId, email, tags);
    res.json({ success });
  }));

  app.post("/api/mailchimp/:subAccountId/remove-tags", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { email, tags } = req.body;
    if (!email || !tags || !Array.isArray(tags)) {
      return res.status(400).json({ error: "email and tags[] are required" });
    }

    const success = await removeTagsFromContact(subAccountId, email, tags);
    res.json({ success });
  }));

  app.post("/api/mailchimp/:subAccountId/send-email", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { email, templateKey, contactId, mergeVars } = req.body;
    if (!email || !templateKey) {
      return res.status(400).json({ error: "email and templateKey are required" });
    }

    const validKeys = Object.values(TEMPLATE_KEYS);
    if (!validKeys.includes(templateKey)) {
      return res.status(400).json({ error: `Invalid templateKey. Valid: ${validKeys.join(", ")}` });
    }

    const result = await sendEmailViaCampaign(
      subAccountId,
      email,
      templateKey,
      "manual_send",
      contactId,
      mergeVars
    );

    res.json(result);
  }));

  app.post("/api/mailchimp/:subAccountId/nudge", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ error: "contactId is required" });

    const contact = await storage.getContactById(contactId);
    if (!contact || contact.subAccountId !== subAccountId) {
      return res.status(404).json({ error: "Contact not found" });
    }

    await handleNoResponse(subAccountId, contact.id, {
      email: contact.email || undefined,
      firstName: contact.firstName,
    });

    res.json({ success: true });
  }));

  console.log("[MAILCHIMP] Routes registered");
}
