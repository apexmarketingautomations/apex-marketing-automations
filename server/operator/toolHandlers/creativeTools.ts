import type { OperatorTool, ValidationResult, ToolResult, OperatorContext } from "../types";
import { storage } from "../../storage";
import { publishEventAsync, EVENT_TYPES } from "../../eventBus";

function noopValidate(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

export const creativeTools: OperatorTool[] = [
  {
    name: "generateLandingPage",
    description: "Generate an AI-powered landing page for a business",
    category: "creative",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "prompt", type: "string", required: true, description: "Description of the landing page to generate" },
      { name: "businessName", type: "string", required: false, description: "Business name to use" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const { geminiChat, isGeminiConfigured } = await import("../../gemini");
      if (!isGeminiConfigured()) return { success: false, error: "AI is not configured (missing Gemini API key)" };

      const account = await storage.getSubAccount(ctx.subAccountId);
      const businessName = params.businessName || account?.name || "My Business";

      const sitePrompt = `Generate a professional landing page for "${businessName}". ${params.prompt}. Return valid JSON with theme (primaryColor, secondaryColor, fontFamily) and sections array.`;
      const result = await geminiChat([
        { role: "user", content: "You are a landing page designer. Return JSON only with theme and sections array.\n\n" + sitePrompt },
      ], { jsonMode: true, temperature: 0.7 });

      let siteData;
      try {
        siteData = JSON.parse(result);
      } catch {
        return { success: false, error: "AI returned invalid JSON for site generation" };
      }

      const site = await storage.createSavedSite({
        name: `${businessName} Landing Page`,
        prompt: params.prompt,
        siteData,
      });

      publishEventAsync(EVENT_TYPES.SITE_GENERATED, { subAccountId: ctx.subAccountId, siteId: site.id }, "operator");
      return { success: true, data: { siteId: site.id, name: site.name }, sideEffects: ["Generated landing page (saved as draft)"], eventsFired: ["site.generated"] };
    },
    summarizeForAudit: (params) => `Generated landing page for "${params.businessName || "business"}".`,
  },
  {
    name: "generateOfferAngles",
    description: "Generate marketing offer angles for a product or service",
    category: "creative",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "product", type: "string", required: true, description: "Product or service" },
      { name: "targetAudience", type: "string", required: false, description: "Target audience" },
      { name: "count", type: "number", required: false, description: "Number of angles to generate" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const { geminiChat, isGeminiConfigured } = await import("../../gemini");
      if (!isGeminiConfigured()) return { success: false, error: "AI is not configured" };

      const count = params.count || 5;
      const prompt = `Generate ${count} marketing offer angles for "${params.product}"${params.targetAudience ? ` targeting ${params.targetAudience}` : ""}. Return JSON array of objects with: angle (string), headline (string), hook (string), urgency (string).`;

      const result = await geminiChat([
        { role: "user", content: "You are a marketing strategist. Return JSON array only.\n\n" + prompt },
      ], { jsonMode: true, temperature: 0.8 });

      let angles;
      try {
        angles = JSON.parse(result);
      } catch {
        return { success: false, error: "AI returned invalid JSON" };
      }

      return { success: true, data: { angles, count: Array.isArray(angles) ? angles.length : 0 } };
    },
    summarizeForAudit: (params) => `Generated offer angles for "${params.product}".`,
  },
  {
    name: "generateAdCopyVariants",
    description: "Generate ad copy variants for a product or campaign",
    category: "creative",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "product", type: "string", required: true, description: "Product or service" },
      { name: "platform", type: "string", required: false, description: "Platform: meta, google, tiktok" },
      { name: "tone", type: "string", required: false, description: "Tone: professional, casual, urgent" },
      { name: "count", type: "number", required: false, description: "Number of variants" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const { geminiChat, isGeminiConfigured } = await import("../../gemini");
      if (!isGeminiConfigured()) return { success: false, error: "AI is not configured" };

      const count = params.count || 3;
      const platform = params.platform || "meta";
      const tone = params.tone || "professional";

      const prompt = `Generate ${count} ad copy variants for "${params.product}" on ${platform}. Tone: ${tone}. Return JSON array with: headline (string), primaryText (string), callToAction (string), description (string).`;

      const result = await geminiChat([
        { role: "user", content: "You are an ad copywriter. Return JSON array only.\n\n" + prompt },
      ], { jsonMode: true, temperature: 0.8 });

      let variants;
      try {
        variants = JSON.parse(result);
      } catch {
        return { success: false, error: "AI returned invalid JSON" };
      }

      return { success: true, data: { variants, platform, tone, count: Array.isArray(variants) ? variants.length : 0 } };
    },
    summarizeForAudit: (params) => `Generated ${params.count || 3} ad copy variants for "${params.product}" (${params.platform || "meta"}).`,
  },
  {
    name: "generateSMSCopyVariants",
    description: "Generate SMS copy variants for a campaign",
    category: "creative",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "purpose", type: "string", required: true, description: "Purpose of the SMS" },
      { name: "businessName", type: "string", required: false, description: "Business name" },
      { name: "count", type: "number", required: false, description: "Number of variants" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const { geminiChat, isGeminiConfigured } = await import("../../gemini");
      if (!isGeminiConfigured()) return { success: false, error: "AI is not configured" };

      const count = params.count || 3;
      const account = await storage.getSubAccount(ctx.subAccountId);
      const businessName = params.businessName || account?.name || "Our business";

      const prompt = `Generate ${count} SMS message variants for "${params.purpose}" for business "${businessName}". Max 160 characters each. Return JSON array of objects with: message (string), characterCount (number).`;

      const result = await geminiChat([
        { role: "user", content: "You are an SMS copywriter. Return JSON array only.\n\n" + prompt },
      ], { jsonMode: true, temperature: 0.7 });

      let variants;
      try {
        variants = JSON.parse(result);
      } catch {
        return { success: false, error: "AI returned invalid JSON" };
      }

      return { success: true, data: { variants, count: Array.isArray(variants) ? variants.length : 0 } };
    },
    summarizeForAudit: (params) => `Generated SMS copy variants for "${params.purpose}".`,
  },
  {
    name: "generateEmailCopyVariants",
    description: "Generate email copy variants for campaigns",
    category: "creative",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "purpose", type: "string", required: true, description: "Purpose of the email" },
      { name: "businessName", type: "string", required: false, description: "Business name" },
      { name: "count", type: "number", required: false, description: "Number of variants" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const { geminiChat, isGeminiConfigured } = await import("../../gemini");
      if (!isGeminiConfigured()) return { success: false, error: "AI is not configured" };

      const count = params.count || 3;
      const account = await storage.getSubAccount(ctx.subAccountId);
      const businessName = params.businessName || account?.name || "Our business";

      const prompt = `Generate ${count} email variants for "${params.purpose}" for "${businessName}". Return JSON array with: subject (string), preheader (string), bodyHtml (string), callToAction (string).`;

      const result = await geminiChat([
        { role: "user", content: "You are an email marketing copywriter. Return JSON array only.\n\n" + prompt },
      ], { jsonMode: true, temperature: 0.7 });

      let variants;
      try {
        variants = JSON.parse(result);
      } catch {
        return { success: false, error: "AI returned invalid JSON" };
      }

      return { success: true, data: { variants, count: Array.isArray(variants) ? variants.length : 0 } };
    },
    summarizeForAudit: (params) => `Generated email copy variants for "${params.purpose}".`,
  },
  {
    name: "generateSocialPostDrafts",
    description: "Generate social media post drafts",
    category: "creative",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "topic", type: "string", required: true, description: "Post topic" },
      { name: "platform", type: "string", required: false, description: "Platform: instagram, facebook, linkedin, twitter" },
      { name: "count", type: "number", required: false, description: "Number of posts" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const { geminiChat, isGeminiConfigured } = await import("../../gemini");
      if (!isGeminiConfigured()) return { success: false, error: "AI is not configured" };

      const count = params.count || 3;
      const platform = params.platform || "instagram";

      const prompt = `Generate ${count} ${platform} post drafts about "${params.topic}". Return JSON array with: caption (string), hashtags (string[]), suggestedImageDescription (string), bestPostingTime (string).`;

      const result = await geminiChat([
        { role: "user", content: "You are a social media manager. Return JSON array only.\n\n" + prompt },
      ], { jsonMode: true, temperature: 0.8 });

      let posts;
      try {
        posts = JSON.parse(result);
      } catch {
        return { success: false, error: "AI returned invalid JSON" };
      }

      return { success: true, data: { posts, platform, count: Array.isArray(posts) ? posts.length : 0 } };
    },
    summarizeForAudit: (params) => `Generated ${params.count || 3} social post drafts about "${params.topic}" for ${params.platform || "instagram"}.`,
  },
  {
    name: "generateReviewResponseDraft",
    description: "Generate an AI response draft for a customer review",
    category: "creative",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "reviewText", type: "string", required: true, description: "The review text" },
      { name: "rating", type: "number", required: true, description: "Star rating (1-5)" },
      { name: "customerName", type: "string", required: false, description: "Customer name" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const { geminiChat, isGeminiConfigured } = await import("../../gemini");
      if (!isGeminiConfigured()) return { success: false, error: "AI is not configured" };

      const account = await storage.getSubAccount(ctx.subAccountId);
      const businessName = account?.name || "our business";

      const prompt = `Write a professional response to this ${params.rating}-star review${params.customerName ? ` from ${params.customerName}` : ""} for "${businessName}": "${params.reviewText}". Be empathetic, professional, and concise. Return JSON with: response (string), tone (string), suggestedActions (string[]).`;

      const result = await geminiChat([
        { role: "user", content: "You are a reputation management specialist. Return JSON only.\n\n" + prompt },
      ], { jsonMode: true, temperature: 0.6 });

      let responseData;
      try {
        responseData = JSON.parse(result);
      } catch {
        return { success: false, error: "AI returned invalid JSON" };
      }

      return {
        success: true,
        data: {
          ...responseData,
          rating: params.rating,
          customerName: params.customerName || "Customer",
          note: "Response saved as draft. Posting requires approval.",
        },
      };
    },
    summarizeForAudit: (params) => `Generated review response draft for ${params.rating}-star review.`,
  },
];
