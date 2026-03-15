import type { OperatorTool, ValidationResult, ToolResult, OperatorContext } from "../types";
import { storage } from "../../storage";
import { publishEventAsync, EVENT_TYPES } from "../../eventBus";

function noopValidate(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

export const campaignTools: OperatorTool[] = [
  {
    name: "launchCampaignDraft",
    description: "Create a draft ad campaign (does NOT launch — requires approval)",
    category: "campaign",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "name", type: "string", required: true, description: "Campaign name" },
      { name: "platform", type: "string", required: false, description: "Ad platform (meta, google)" },
      { name: "budget", type: "number", required: false, description: "Daily budget in dollars" },
      { name: "targetAudience", type: "string", required: false, description: "Target audience description" },
      { name: "idempotencyKey", type: "string", required: false, description: "Idempotency key" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      return {
        success: true,
        data: {
          status: "draft",
          name: params.name,
          platform: params.platform || "meta",
          budget: params.budget || 10,
          targetAudience: params.targetAudience || "local area",
          note: "Campaign saved as draft. Launch requires separate approval.",
        },
        sideEffects: ["Created campaign draft (not launched)"],
      };
    },
    summarizeForAudit: (params) => `Created campaign draft "${params.name}" ($${params.budget || 10}/day on ${params.platform || "meta"}).`,
    idempotencyKey: (params) => params.idempotencyKey || `campaign-${params.name}`,
  },
  {
    name: "pauseCampaignDraft",
    description: "Create a draft request to pause an active campaign",
    category: "campaign",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "campaignId", type: "number", required: true, description: "Campaign ID" },
      { name: "reason", type: "string", required: false, description: "Reason for pausing" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const campaigns = await storage.getMetaAdCampaigns(ctx.subAccountId);
      const campaign = campaigns.find(c => c.id === params.campaignId);
      if (!campaign) return { success: false, error: "Campaign not found" };
      return {
        success: true,
        data: {
          status: "draft_pause",
          campaignId: params.campaignId,
          campaignName: campaign.name,
          reason: params.reason || null,
          note: "Pause request saved as draft. Requires approval. Live Meta Ads API not connected.",
        },
        sideEffects: ["Created campaign pause draft"],
      };
    },
    summarizeForAudit: (params) => `Drafted pause for campaign #${params.campaignId}.`,
  },
  {
    name: "duplicateCampaignDraft",
    description: "Create a draft to duplicate an existing campaign",
    category: "campaign",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "campaignId", type: "number", required: true, description: "Campaign ID to duplicate" },
      { name: "newName", type: "string", required: false, description: "New campaign name" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const campaigns = await storage.getMetaAdCampaigns(ctx.subAccountId);
      const campaign = campaigns.find(c => c.id === params.campaignId);
      if (!campaign) return { success: false, error: "Campaign not found" };
      return {
        success: true,
        data: {
          status: "draft_duplicate",
          sourceCampaignId: params.campaignId,
          sourceName: campaign.name,
          newName: params.newName || `${campaign.name} (Copy)`,
          note: "Duplication saved as draft. Requires approval. Live Meta Ads API not connected.",
        },
        sideEffects: ["Created campaign duplication draft"],
      };
    },
    summarizeForAudit: (params) => `Drafted duplication of campaign #${params.campaignId}.`,
  },
  {
    name: "adjustAdBudgetDraft",
    description: "Create a draft to adjust an ad campaign's budget",
    category: "campaign",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "campaignId", type: "number", required: true, description: "Campaign ID" },
      { name: "newBudget", type: "number", required: true, description: "New daily budget" },
      { name: "reason", type: "string", required: false, description: "Reason for adjustment" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const campaigns = await storage.getMetaAdCampaigns(ctx.subAccountId);
      const campaign = campaigns.find(c => c.id === params.campaignId);
      if (!campaign) return { success: false, error: "Campaign not found" };
      return {
        success: true,
        data: {
          status: "draft_budget_change",
          campaignId: params.campaignId,
          campaignName: campaign.name,
          currentBudget: (campaign as Record<string, unknown>)?.dailyBudget || "unknown",
          newBudget: params.newBudget,
          reason: params.reason || null,
          note: "Budget adjustment saved as draft. Requires approval. Live Meta Ads API not connected.",
        },
        sideEffects: [`Drafted budget change for campaign #${params.campaignId} to $${params.newBudget}/day`],
      };
    },
    summarizeForAudit: (params) => `Drafted budget adjustment for campaign #${params.campaignId} to $${params.newBudget}/day.`,
  },
  {
    name: "rotateAdCreativeDraft",
    description: "Create a draft to rotate ad creative for a campaign",
    category: "campaign",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "campaignId", type: "number", required: true, description: "Campaign ID" },
      { name: "newCreativeDescription", type: "string", required: false, description: "Description of new creative" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      return {
        success: true,
        data: {
          status: "draft_creative_rotation",
          campaignId: params.campaignId,
          newCreativeDescription: params.newCreativeDescription || "Auto-generated creative rotation",
          note: "Creative rotation saved as draft. Requires approval. Live ad platform API not connected.",
        },
        sideEffects: ["Created creative rotation draft"],
      };
    },
    summarizeForAudit: (params) => `Drafted creative rotation for campaign #${params.campaignId}.`,
  },
  {
    name: "createRetargetingCampaignDraft",
    description: "Create a draft retargeting campaign",
    category: "campaign",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "name", type: "string", required: true, description: "Campaign name" },
      { name: "audienceSource", type: "string", required: false, description: "Audience source (website visitors, email list, etc.)" },
      { name: "budget", type: "number", required: false, description: "Daily budget" },
      { name: "platform", type: "string", required: false, description: "Ad platform" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      return {
        success: true,
        data: {
          status: "draft",
          name: params.name,
          audienceSource: params.audienceSource || "website_visitors",
          budget: params.budget || 15,
          platform: params.platform || "meta",
          note: "Retargeting campaign saved as draft. Requires approval and ad platform connection.",
        },
        sideEffects: [`Created retargeting campaign draft "${params.name}"`],
      };
    },
    summarizeForAudit: (params) => `Created retargeting campaign draft "${params.name}".`,
  },
  {
    name: "createLeadFormDraft",
    description: "Create a draft lead capture form",
    category: "campaign",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "name", type: "string", required: true, description: "Form name" },
      { name: "fields", type: "array", required: false, description: "Form fields" },
      { name: "redirectUrl", type: "string", required: false, description: "Post-submit redirect URL" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      return {
        success: true,
        data: {
          status: "draft",
          name: params.name,
          fields: params.fields || ["name", "email", "phone"],
          redirectUrl: params.redirectUrl || null,
          note: "Lead form saved as draft. Publishing requires approval.",
        },
        sideEffects: [`Created lead form draft "${params.name}"`],
      };
    },
    summarizeForAudit: (params) => `Created lead form draft "${params.name}".`,
  },
];
