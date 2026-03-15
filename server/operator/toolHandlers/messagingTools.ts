import type { OperatorTool, ValidationResult, ToolResult, OperatorContext } from "../types";
import { storage } from "../../storage";
import { publishEventAsync, EVENT_TYPES } from "../../eventBus";
import { verifyTenant } from "./tenantGuard";

function noopValidate(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

export const messagingTools: OperatorTool[] = [
  {
    name: "sendTestSMS",
    description: "Send a test SMS message to verify messaging is working",
    category: "messaging",
    autonomyRequired: "execute",
    requiresApproval: true,
    parameters: [
      { name: "to", type: "string", required: true, description: "Phone number to send test to" },
      { name: "body", type: "string", required: false, description: "Test message body" },
    ],
    validate: (params) => {
      const errors: string[] = [];
      if (!params.to || params.to.length < 10) errors.push("Invalid phone number");
      return { valid: errors.length === 0, errors, warnings: [] };
    },
    execute: async (params, ctx) => {
      const msg = await storage.createMessage({
        subAccountId: ctx.subAccountId,
        contactPhone: params.to,
        body: params.body || "Test message from Apex Operator",
        direction: "outbound",
        channel: "sms",
        status: "pending",
      });
      publishEventAsync(EVENT_TYPES.MESSAGE_SENT, { subAccountId: ctx.subAccountId, to: params.to, channel: "sms", messageId: msg.id }, "operator");
      return { success: true, data: { messageId: msg.id }, sideEffects: ["Sent test SMS"], eventsFired: ["message.sent"] };
    },
    summarizeForAudit: (params) => `Sent test SMS to ${params.to}.`,
  },
  {
    name: "sendLiveSMSDraft",
    description: "Create a draft SMS message for review before sending",
    category: "messaging",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "to", type: "string", required: true, description: "Phone number" },
      { name: "body", type: "string", required: true, description: "Message body" },
      { name: "contactId", type: "number", required: false, description: "Associated contact ID" },
    ],
    validate: (params) => {
      const errors: string[] = [];
      if (!params.to || params.to.length < 10) errors.push("Invalid phone number");
      if (!params.body) errors.push("Message body is required");
      return { valid: errors.length === 0, errors, warnings: [] };
    },
    execute: async (params, ctx) => {
      return {
        success: true,
        data: {
          status: "draft",
          to: params.to,
          body: params.body,
          channel: "sms",
          contactId: params.contactId || null,
          note: "SMS saved as draft. Sending requires approval.",
        },
        sideEffects: ["Created SMS draft (not sent)"],
      };
    },
    summarizeForAudit: (params) => `Drafted SMS to ${params.to}: "${params.body?.substring(0, 50)}..."`,
  },
  {
    name: "sendWhatsAppMessageDraft",
    description: "Create a draft WhatsApp message for review before sending",
    category: "messaging",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "to", type: "string", required: true, description: "Phone number" },
      { name: "body", type: "string", required: true, description: "Message body" },
      { name: "templateName", type: "string", required: false, description: "WhatsApp template name" },
    ],
    validate: (params) => {
      const errors: string[] = [];
      if (!params.to || params.to.length < 10) errors.push("Invalid phone number");
      return { valid: errors.length === 0, errors, warnings: [] };
    },
    execute: async (params, ctx) => {
      return {
        success: true,
        data: {
          status: "draft",
          to: params.to,
          body: params.body,
          channel: "whatsapp",
          templateName: params.templateName || null,
          note: "WhatsApp message saved as draft. Sending requires approval and WhatsApp Business API.",
        },
        sideEffects: ["Created WhatsApp message draft (not sent)"],
      };
    },
    summarizeForAudit: (params) => `Drafted WhatsApp message to ${params.to}.`,
  },
  {
    name: "sendEmailDraft",
    description: "Create a draft email for review before sending",
    category: "messaging",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "to", type: "string", required: true, description: "Email address" },
      { name: "subject", type: "string", required: true, description: "Email subject" },
      { name: "body", type: "string", required: true, description: "Email body" },
      { name: "contactId", type: "number", required: false, description: "Associated contact ID" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      return {
        success: true,
        data: {
          status: "draft",
          to: params.to,
          subject: params.subject,
          body: params.body,
          channel: "email",
          note: "Email saved as draft. Sending requires approval.",
        },
        sideEffects: ["Created email draft (not sent)"],
      };
    },
    summarizeForAudit: (params) => `Drafted email to ${params.to}: "${params.subject}".`,
  },
  {
    name: "createEmailCampaignDraft",
    description: "Create a draft email campaign targeting contacts by tags",
    category: "messaging",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "name", type: "string", required: true, description: "Campaign name" },
      { name: "subject", type: "string", required: true, description: "Email subject" },
      { name: "body", type: "string", required: true, description: "Email body" },
      { name: "targetTags", type: "array", required: false, description: "Target audience tags" },
      { name: "idempotencyKey", type: "string", required: false, description: "Idempotency key" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const campaign = await storage.createEmailCampaign({
        subAccountId: ctx.subAccountId,
        name: params.name,
        subject: params.subject,
        body: params.body,
        status: "draft",
        recipientCount: 0,
      });
      return {
        success: true,
        data: { campaignId: campaign.id, name: params.name, status: "draft" },
        sideEffects: ["Created email campaign draft"],
      };
    },
    summarizeForAudit: (params) => `Created email campaign draft "${params.name}".`,
    idempotencyKey: (params) => params.idempotencyKey || `email-campaign-${params.name}`,
  },
  {
    name: "replyToInstagramDMDraft",
    description: "Create a draft reply to an Instagram DM conversation",
    category: "messaging",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "conversationId", type: "number", required: true, description: "Instagram conversation ID" },
      { name: "body", type: "string", required: true, description: "Reply body" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      return {
        success: true,
        data: {
          status: "draft",
          conversationId: params.conversationId,
          body: params.body,
          channel: "instagram",
          note: "Instagram DM reply saved as draft. Sending requires approval and Instagram API.",
        },
        sideEffects: ["Created Instagram DM reply draft"],
      };
    },
    summarizeForAudit: (params) => `Drafted Instagram DM reply for conversation #${params.conversationId}.`,
  },
  {
    name: "sendReviewRequestDraft",
    description: "Create a draft review request to send to a contact",
    category: "messaging",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "contactId", type: "number", required: true, description: "Contact ID" },
      { name: "channel", type: "string", required: false, description: "Channel: sms or email" },
      { name: "message", type: "string", required: false, description: "Custom message" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const contact = await storage.getContactById(params.contactId);
      const guard = verifyTenant(contact, ctx.subAccountId, "Contact");
      if (guard) return guard;
      return {
        success: true,
        data: {
          status: "draft",
          contactId: params.contactId,
          contactName: `${contact!.firstName} ${contact!.lastName || ""}`.trim(),
          channel: params.channel || "sms",
          message: params.message || `Hi ${contact!.firstName}, we'd love your feedback! Please leave us a review.`,
          note: "Review request saved as draft. Sending requires approval.",
        },
        sideEffects: ["Created review request draft"],
      };
    },
    summarizeForAudit: (params) => `Drafted review request for contact #${params.contactId}.`,
  },
  {
    name: "createNurtureSequenceDraft",
    description: "Create a multi-step nurture sequence draft",
    category: "messaging",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "name", type: "string", required: true, description: "Sequence name" },
      { name: "steps", type: "array", required: true, description: "Sequence steps: [{delayDays, channel, body}]" },
      { name: "targetTags", type: "array", required: false, description: "Target audience tags" },
      { name: "idempotencyKey", type: "string", required: false, description: "Idempotency key" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      return {
        success: true,
        data: {
          status: "draft",
          name: params.name,
          stepCount: params.steps.length,
          steps: params.steps,
          targetTags: params.targetTags || [],
          note: "Nurture sequence saved as draft. Activation requires approval.",
        },
        sideEffects: [`Created nurture sequence draft "${params.name}" with ${params.steps.length} steps`],
      };
    },
    summarizeForAudit: (params) => `Created nurture sequence "${params.name}" (${params.steps?.length || 0} steps).`,
    idempotencyKey: (params) => params.idempotencyKey || `nurture-${params.name}`,
  },
];
