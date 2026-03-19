import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { aiChat, isAIConfigured } from "../aiGateway";
import { asyncHandler } from "./helpers";

export function registerBlueprintsRoutes(app: Express) {
  // ---- Blueprints / Onboarding ----
  app.get("/api/blueprints", asyncHandler(async (_req, res) => {
    const bps = await storage.getBlueprints();
    res.json(bps);
  }));

  app.get("/api/blueprints/:industryId", asyncHandler(async (req, res) => {
    const industryId = Array.isArray(req.params.industryId) ? req.params.industryId[0] : req.params.industryId;
    const bp = await storage.getBlueprintByIndustryId(industryId);
    if (!bp) return res.status(404).json({ error: "Blueprint not found" });
    res.json(bp);
  }));

  app.post("/api/onboarding/:industryId", asyncHandler(async (req, res) => {
    const industryId = Array.isArray(req.params.industryId) ? req.params.industryId[0] : req.params.industryId;
    let bp = await storage.getBlueprintByIndustryId(industryId);

    if (!bp) {
      if (!isAIConfigured()) {
        return res.status(404).json({ error: "Blueprint not found and AI service is not configured to generate one" });
      }

      const industryLabel = industryId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

      const aiResult = await aiChat([
        {
          role: "system",
          content: `You are a CRM configuration expert. Generate a complete CRM blueprint for a specific industry. Return ONLY valid JSON with no markdown or code fences.

  The JSON must have this exact structure:
  {
  "title": "Human-readable industry name",
  "stages": ["Stage 1", "Stage 2", ...],
  "fields": ["Custom Field 1", "Custom Field 2", ...],
  "templates": ["SMS/Email Template Name 1", "Template Name 2", ...]
  }

  Guidelines:
  - stages: 5-7 pipeline stages representing the customer journey from first contact to completion/retention
  - fields: 4-6 custom contact fields relevant to this industry (things you'd track about each customer)
  - templates: 3-5 SMS/email template names for key touchpoints (appointment reminders, follow-ups, promotions)
  - Make it practical and industry-specific, not generic`
        },
        {
          role: "user",
          content: `Generate a CRM blueprint for: ${industryLabel}`
        }
      ], { temperature: 0.7, jsonMode: true, route: "blueprint-gen" });
      const cleaned = aiResult.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

      try {
        const parsed = JSON.parse(cleaned);
        const newBp = await storage.createBlueprint({
          industryId,
          title: parsed.title || industryLabel,
          stages: parsed.stages || ["Lead", "Contacted", "Qualified", "Closed"],
          fields: parsed.fields || ["Name", "Email", "Phone"],
          templates: parsed.templates || ["Welcome SMS", "Follow-up Email"],
        });
        bp = newBp;
        console.log(`[ONBOARDING] AI-generated blueprint for "${industryLabel}" and saved to DB`);
      } catch (parseErr) {
        console.error("[ONBOARDING] Failed to parse AI blueprint:", parseErr);
        const fallbackBp = await storage.createBlueprint({
          industryId,
          title: industryLabel,
          stages: ["New Lead", "Contacted", "Qualified", "Proposal Sent", "Won", "Lost"],
          fields: ["Contact Name", "Email", "Phone", "Notes"],
          templates: ["Welcome SMS", "Follow-up Email", "Thank You Message"],
        });
        bp = fallbackBp;
        console.log(`[ONBOARDING] Used fallback blueprint for "${industryLabel}"`);
      }
    }

    const user = (req as any).user;
    const account = await storage.createSubAccount({
      name: `${bp.title} Account`,
      twilioNumber: null,
      ownerUserId: user?.id || null,
    });

    res.status(201).json({ account, blueprint: bp, notice: "Account created. Purchase a Twilio phone number to enable SMS." });
  }));
}
