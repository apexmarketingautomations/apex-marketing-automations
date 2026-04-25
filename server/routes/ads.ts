import type { Express, Request, Response } from "express";
import { aiChat, aiGenerateImage, isAIConfigured } from "../aiGateway";
import { asyncHandler, logUsageInternal } from "./helpers";
import { emitWithTimeline, EVENT_TYPES } from "../intelligence/eventEmitter";
import { requireActiveSubscription } from "../subscriptionGuard";

const subscriptionGuard = requireActiveSubscription();

export function registerAdsRoutes(app: Express) {
  // ---- AI Ad Campaign Generator ----
  const AD_CAMPAIGN_SYSTEM_PROMPT = `You are an expert Facebook Ads campaign strategist. When a user describes their business and promotion, generate a complete campaign plan as JSON.

  Return this exact structure:
  {
  "campaign_name": "<descriptive campaign name>",
  "objective": "OUTCOME_LEADS" | "OUTCOME_AWARENESS" | "OUTCOME_TRAFFIC" | "OUTCOME_SALES",
  "daily_budget": <number in cents, e.g. 5000 = $50/day>,
  "duration_days": <recommended campaign duration>,
  "targeting": {
    "age_min": <number>,
    "age_max": <number>,
    "genders": [1, 2] or [1] or [2],
    "geo_locations": {
      "cities": [{"key": "<city name>", "radius": <miles>}],
      "countries": ["US"]
    },
    "interests": [{"name": "<interest>"}],
    "behaviors": [{"name": "<behavior>"}]
  },
  "ad_copy": {
    "headline": "<max 40 chars>",
    "primary_text": "<compelling ad text, max 125 chars>",
    "description": "<max 30 chars>",
    "cta": "BOOK_NOW" | "LEARN_MORE" | "SIGN_UP" | "GET_OFFER" | "SHOP_NOW"
  },
  "image_prompt": "<detailed prompt for AI image generation matching the brand/offer>",
  "estimated_reach": "<estimated daily reach range, e.g. 5,000 - 15,000>",
  "estimated_cpl": "<estimated cost per lead, e.g. $8 - $15>",
  "strategy_notes": "<2-3 sentences explaining the targeting strategy>"
  }

  Rules:
  - Budget should be realistic for the business type (local business: $20-50/day, larger: $50-200/day)
  - Targeting should be specific and data-driven
  - Ad copy must be punchy, compliant with FB ad policies (no exaggerated claims)
  - interests and behaviors should be relevant to the business
  - Return ONLY valid JSON, no markdown, no code fences`;

  app.post("/api/generate-ad-campaign", subscriptionGuard, asyncHandler(async (req, res) => {
    if (!isAIConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = promptSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const aiResult = await aiChat([
      { role: "system", content: AD_CAMPAIGN_SYSTEM_PROMPT },
      { role: "user", content: parsed.data.prompt },
    ], { temperature: 0.7, maxTokens: 4096, jsonMode: true, route: "ad-campaign-gen" });
    const cleaned = aiResult.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let campaign: any;
    try {
      campaign = JSON.parse(cleaned);
    } catch (err) {
      console.warn("[ADS] caught:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "AI returned invalid JSON" });
    }

    if (!campaign.campaign_name || !campaign.targeting || !campaign.ad_copy) {
      return res.status(500).json({ error: "AI returned incomplete campaign data" });
    }

    if (campaign.image_prompt) {
      try {
        const imageUrl = await aiGenerateImage(
          `Professional marketing photo for Facebook ad: ${campaign.image_prompt}. High quality, clean composition, suitable for social media advertising, no text overlay.`
        );
        campaign.generated_image_url = imageUrl;
      } catch (imgErr: any) {
        console.error("Ad image generation failed:", imgErr.message);
        campaign.generated_image_url = null;
      }
    }

    await logUsageInternal(null, "AI_CHAT", 1, "Ad campaign AI generation");
    if (campaign.generated_image_url) {
      await logUsageInternal(null, "AI_IMAGE_GEN", 1, "Ad creative DALL-E generation");
    }

    const user = (req as any).user;
    const acctId = user?.currentAccountId || user?.accountId;
    if (acctId) {
      emitWithTimeline({ eventType: EVENT_TYPES.AD_CAMPAIGN_LAUNCHED, sourceModule: "ads", sourceTable: "ai_generated", sourceRecordId: campaign.campaign_name || "unknown", subAccountId: acctId, metadata: { objective: campaign.objective, dailyBudget: campaign.daily_budget } });
    }

    res.json(campaign);
  }));
}
