import type { Express, Request, Response } from "express";
import { contacts, deals, messages } from "@shared/schema";
import { storage } from "../storage";
import { z } from "zod";
import { aiChat, isAIConfigured } from "../aiGateway";
import { ProgressStream } from "../streaming";
import { processLiveSentinelFeed, deployGeofenceAd } from "../sentinel";
import { asyncHandler, parseIntParam, getUserId, verifyAccountOwnership, logUsageInternal } from "./helpers";

let _fireAutomationTrigger: ((triggerName: string, subAccountId: number, context?: Record<string, any>, depth?: number) => Promise<void>) | null = null;

export async function fireAutomationTriggerGlobal(triggerName: string, subAccountId: number, context: Record<string, any> = {}, depth: number = 0) {
  if (_fireAutomationTrigger) {
    return _fireAutomationTrigger(triggerName, subAccountId, context, depth);
  }
  console.warn(`[AUTOMATION] fireAutomationTriggerGlobal called before routes initialized — trigger "${triggerName}" dropped`);
}

export function registerV1Routes(app: Express) {
  // ===========================================================================
  // V1 WORKFLOW COMPILER — AI System Architect
  // ===========================================================================

  const VALID_TRIGGER_TYPES = [
    "OnCrashDetected",
    "OnNewLead",
    "OnMissedCall",
    "OnFormSubmit",
    "OnAppointmentBooked",
    "OnReviewReceived",
    "OnSMSReply",
    "OnWhatsAppReply",
    "Manual",
  ] as const;

  const VALID_ACTION_TYPES = [
    "SendTwilioSMS",
    "SendWhatsApp",
    "Wait",
    "Condition",
    "DeployMetaAd",
    "SendEmail",
    "CreateContact",
    "UpdateDeal",
    "AlertTeam",
    "WebhookCall",
    "AIGenerate",
  ] as const;

  const triggerFilterSchema = z.object({
    tags: z.array(z.string()).optional(),
    severity: z.enum(["critical", "high", "medium", "low"]).optional(),
    county: z.string().optional(),
    radius_miles: z.number().optional(),
    source: z.string().optional(),
  }).optional();

  const actionParamSchemas: Record<string, z.ZodType<any>> = {
    SendTwilioSMS: z.object({
      to: z.string().optional(),
      to_role: z.string().optional(),
      body: z.string().min(1),
      from_number: z.string().optional(),
    }),
    SendWhatsApp: z.object({
      to: z.string().optional(),
      to_role: z.string().optional(),
      body: z.string().min(1),
      message_type: z.enum(["text", "template", "interactive_buttons", "interactive_list"]).optional(),
      template_name: z.string().optional(),
      template_variables: z.record(z.string()).optional(),
      buttons: z.string().optional(),
      list_items: z.string().optional(),
    }),
    Wait: z.object({
      duration_minutes: z.number().min(1).max(43200),
    }),
    Condition: z.object({
      check: z.string().min(1),
      field: z.string().optional(),
      operator: z.enum(["equals", "not_equals", "contains", "greater_than", "less_than", "exists", "not_exists"]).optional(),
      value: z.any().optional(),
      on_true: z.string().optional(),
      on_false: z.string().optional(),
    }),
    DeployMetaAd: z.object({
      campaign_name: z.string().optional(),
      radius_miles: z.number().optional(),
      budget_daily: z.number().optional(),
      duration_days: z.number().optional(),
      use_incident_coords: z.boolean().optional(),
      ad_copy: z.string().optional(),
      target_audience: z.string().optional(),
    }),
    SendEmail: z.object({
      to: z.string().optional(),
      subject: z.string().min(1),
      body: z.string().min(1),
    }),
    CreateContact: z.object({
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      source: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
    UpdateDeal: z.object({
      deal_id: z.string().optional(),
      stage: z.string().optional(),
      value: z.number().optional(),
      notes: z.string().optional(),
    }),
    AlertTeam: z.object({
      message: z.string().min(1),
      channel: z.enum(["sms", "email", "push", "all"]).optional(),
      user_ids: z.array(z.string()).optional(),
    }),
    WebhookCall: z.object({
      url: z.string().url(),
      method: z.enum(["GET", "POST", "PUT", "PATCH"]).optional(),
      headers: z.record(z.string()).optional(),
      payload: z.any().optional(),
    }),
    AIGenerate: z.object({
      prompt: z.string().min(1),
      output_field: z.string().optional(),
      model: z.string().optional(),
    }),
  };

  const manifestStepSchema = z.object({
    id: z.string().optional(),
    action_type: z.enum(VALID_ACTION_TYPES as any),
    label: z.string().optional(),
    params: z.record(z.any()),
  });

  const workflowManifestSchema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    trigger: z.object({
      type: z.enum(VALID_TRIGGER_TYPES as any),
      filters: triggerFilterSchema,
    }),
    steps: z.array(manifestStepSchema).min(1).max(50),
    metadata: z.record(z.any()).optional(),
  });

  app.post("/api/v1/compiler", asyncHandler(async (req: Request, res: Response) => {
    const parsed = workflowManifestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid manifest", details: parsed.error.flatten() });
    }

    const manifest = parsed.data;
    const errors: string[] = [];

    manifest.steps.forEach((step, i) => {
      const paramSchema = actionParamSchemas[step.action_type];
      if (paramSchema) {
        const paramResult = paramSchema.safeParse(step.params);
        if (!paramResult.success) {
          errors.push(`Step ${i + 1} (${step.action_type}): ${JSON.stringify(paramResult.error.flatten().fieldErrors)}`);
        }
      }
      if (!step.id) {
        step.id = `step_${i + 1}_${step.action_type.toLowerCase()}`;
      }
    });

    if (errors.length > 0) {
      return res.status(400).json({ error: "Manifest validation failed", details: errors });
    }

    const automation = await storage.createLiveAutomation({
      name: manifest.name,
      description: manifest.description || null,
      manifest: manifest as any,
      status: "compiled",
      subAccountId: req.body.subAccountId || null,
      lastRunAt: null,
      runCount: 0,
      runLogs: [],
    });

    res.status(201).json({
      id: automation.id,
      name: automation.name,
      status: automation.status,
      manifest: automation.manifest,
      createdAt: automation.createdAt,
      message: "Automation compiled and saved as Live Automation",
    });
  }));

  app.get("/api/v1/compiler", asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const subAccountId = req.query.subAccountId ? parseInt(req.query.subAccountId as string) : undefined;
    if (subAccountId && !(await verifyAccountOwnership(req, res, subAccountId))) return;
    if (!subAccountId) {
      const adminUserId = process.env.ADMIN_USER_ID;
      const isAdmin = adminUserId && getUserId(user) === adminUserId;
      if (!isAdmin) return res.status(403).json({ error: "Access denied" });
    }
    const automations = await storage.getLiveAutomations(subAccountId);
    res.json(automations);
  }));

  app.get("/api/v1/compiler/:id", asyncHandler(async (req: Request, res: Response) => {
    const id = parseIntParam(req.params.id, "id");
    const automation = await storage.getLiveAutomation(id);
    if (!automation) return res.status(404).json({ error: "Automation not found" });
    res.json(automation);
  }));

  app.patch("/api/v1/compiler/:id", asyncHandler(async (req: Request, res: Response) => {
    const id = parseIntParam(req.params.id, "id");
    const updateSchema = z.object({
      name: z.string().min(1).optional(),
      status: z.enum(["compiled", "active", "paused", "archived"]).optional(),
      manifest: z.any().optional(),
    });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const updated = await storage.updateLiveAutomation(id, parsed.data);
    if (!updated) return res.status(404).json({ error: "Automation not found" });
    res.json(updated);
  }));

  app.delete("/api/v1/compiler/:id", asyncHandler(async (req: Request, res: Response) => {
    const id = parseIntParam(req.params.id, "id");
    const deleted = await storage.deleteLiveAutomation(id);
    if (!deleted) return res.status(404).json({ error: "Automation not found" });
    res.json({ success: true });
  }));

  app.get("/api/v1/compiler/schema/info", asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      triggers: VALID_TRIGGER_TYPES,
      actions: VALID_ACTION_TYPES,
      triggerFilters: {
        OnCrashDetected: ["tags", "severity", "county", "radius_miles"],
        OnNewLead: ["source", "tags"],
        OnFormSubmit: ["source"],
        OnMissedCall: [],
        OnAppointmentBooked: [],
        OnReviewReceived: [],
        OnSMSReply: [],
        Manual: [],
      },
      actionParams: Object.fromEntries(
        Object.entries(actionParamSchemas).map(([k]) => [k, k])
      ),
    });
  }));

  // ===========================================================================
  // AI SYSTEM ARCHITECT — Manifest Generator
  // ===========================================================================

  const COMPILER_AI_SYSTEM_PROMPT = `You are Apex AI System Architect, an expert at designing multi-step workflow automations for businesses.

  You generate JSON workflow manifests that wire together triggers, actions, conditions, and delays.

  AVAILABLE TRIGGERS:
  - OnCrashDetected: Fires when Sentinel detects a crash/accident (FHP data). Filters: tags (e.g. "Big Rig", "Fatality", "Hit and Run"), severity (critical/high/medium/low), county, radius_miles.
  - OnNewLead: New lead enters the CRM. Filters: source, tags.
  - OnMissedCall: Missed phone call detected.
  - OnFormSubmit: Web form submission received. Filters: source.
  - OnAppointmentBooked: Calendar appointment created.
  - OnReviewReceived: New review received.
  - OnSMSReply: Inbound SMS received.
  - OnWhatsAppReply: Inbound WhatsApp message received.
  - Manual: Manually triggered.

  AVAILABLE ACTIONS:
  - SendTwilioSMS: Send SMS via Twilio. Params: to (phone), to_role (e.g. "marketer", "attorney", "admin"), body (message text), from_number.
  - SendWhatsApp: Send WhatsApp message via Twilio WhatsApp Business API. Params: to (phone with country code), to_role, body (message text), message_type (text/template/interactive_buttons/interactive_list), template_name (for template messages), template_variables (key-value pairs for template vars), buttons (comma-separated button labels for interactive), list_items (comma-separated list items).
  - Wait: Pause execution. Params: duration_minutes (1-43200).
  - Condition: Branch logic. Params: check (description), field, operator (equals/not_equals/contains/greater_than/less_than/exists/not_exists), value, on_true (step id), on_false (step id).
  - DeployMetaAd: Launch a Meta/Facebook geo-targeted ad. Params: campaign_name, radius_miles, budget_daily, duration_days, use_incident_coords (boolean), ad_copy, target_audience.
  - SendEmail: Send email. Params: to, subject, body.
  - CreateContact: Add to CRM. Params: first_name, last_name, phone, email, source, tags.
  - UpdateDeal: Update pipeline deal. Params: deal_id, stage, value, notes.
  - AlertTeam: Notify team members. Params: message, channel (sms/email/push/all), user_ids.
  - WebhookCall: Call external API. Params: url, method, headers, payload.
  - AIGenerate: Use AI to generate content. Params: prompt, output_field, model.

  OUTPUT FORMAT (strict JSON, no markdown):
  {
  "name": "<workflow name>",
  "description": "<what this automation does>",
  "trigger": {
    "type": "<trigger type>",
    "filters": { <optional filter params> }
  },
  "steps": [
    {
      "id": "step_1_<action>",
      "action_type": "<action type>",
      "label": "<human-readable label>",
      "params": { <action params> }
    }
  ]
  }

  RULES:
  - Generate 2-10 steps based on complexity
  - Use realistic, professional SMS/email copy
  - Wait durations should be practical (1-30 min for urgent, hours/days for nurture)
  - Conditions should check meaningful business state
  - For crash-related workflows, always include SendTwilioSMS to alert the team FIRST
  - Use template variables like {{lead_name}}, {{incident_location}}, {{crash_type}} in messages
  - Return ONLY valid JSON`;

  app.post("/api/v1/compiler/generate", asyncHandler(async (req: Request, res: Response) => {
    if (!isAIConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = z.object({
      prompt: z.string().min(1).max(5000),
      subAccountId: z.number().optional(),
      context: z.object({
        industry: z.string().optional(),
        existingWorkflows: z.array(z.any()).optional(),
        sentinelActive: z.boolean().optional(),
      }).optional(),
    }).safeParse(req.body);

    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    let contextPrompt = "";
    if (parsed.data.context) {
      const ctx = parsed.data.context;
      if (ctx.industry) contextPrompt += `\nIndustry: ${ctx.industry}`;
      if (ctx.sentinelActive) contextPrompt += `\nSentinel crash detection is ACTIVE for this account.`;
      if (ctx.existingWorkflows?.length) {
        contextPrompt += `\nExisting workflows: ${ctx.existingWorkflows.map((w: any) => w.name).join(", ")}`;
      }
    }

    let siteState = "";
    if (parsed.data.subAccountId) {
      const account = await storage.getSubAccount(parsed.data.subAccountId);
      if (account) {
        const wfs = (await storage.getWorkflows()).filter(w => w.subAccountId === account.id);
        const automations = await storage.getLiveAutomations(account.id);
        siteState = `\n\nCURRENT SITE STATE:
  Account: ${account.name} (${account.industry || "general"})
  Existing Workflows: ${wfs.length > 0 ? wfs.map(w => `${w.name} [trigger: ${w.trigger}]`).join("; ") : "None"}
  Live Automations: ${automations.length > 0 ? automations.map(a => `${a.name} [status: ${a.status}]`).join("; ") : "None"}
  Plan: ${account.plan}`;
      }
    }

    const aiResult = await aiChat([
      { role: "system", content: COMPILER_AI_SYSTEM_PROMPT },
      { role: "user", content: parsed.data.prompt + contextPrompt + siteState },
    ], { temperature: 0.7, maxTokens: 4096, jsonMode: true, route: "v1-compiler-generate" });

    const cleaned = aiResult.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let manifestData: any;
    try {
      manifestData = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "AI returned invalid JSON", raw: cleaned });
    }

    const validateResult = workflowManifestSchema.safeParse(manifestData);
    if (!validateResult.success) {
      return res.status(500).json({
        error: "AI generated invalid manifest",
        details: validateResult.error.flatten(),
        raw: manifestData,
      });
    }

    validateResult.data.steps.forEach((step, i) => {
      if (!step.id) step.id = `step_${i + 1}_${step.action_type.toLowerCase()}`;
    });

    const automation = await storage.createLiveAutomation({
      name: validateResult.data.name,
      description: validateResult.data.description || null,
      manifest: validateResult.data as any,
      status: "compiled",
      subAccountId: parsed.data.subAccountId || null,
      lastRunAt: null,
      runCount: 0,
      runLogs: [],
    });

    await logUsageInternal(parsed.data.subAccountId || null, "AI_CHAT", 1, "Workflow compiler AI generation");

    res.status(201).json({
      id: automation.id,
      name: automation.name,
      status: automation.status,
      manifest: automation.manifest,
      createdAt: automation.createdAt,
      stepCount: validateResult.data.steps.length,
      message: "AI System Architect generated and compiled automation",
    });
  }));

  app.post("/api/v1/compiler/analyze", asyncHandler(async (req: Request, res: Response) => {
    if (!isAIConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = z.object({ subAccountId: z.number() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const account = await storage.getSubAccount(parsed.data.subAccountId);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const wfs = (await storage.getWorkflows()).filter(w => w.subAccountId === account.id);
    const automations = await storage.getLiveAutomations(account.id);
    const contactCount = (await storage.getContacts(account.id)).length;
    const dealCount = (await storage.getDeals(account.id)).length;

    const analysisPrompt = `Analyze the current automation setup for "${account.name}" (${account.industry || "general"} business, ${account.plan} plan):

  Workflows (${wfs.length}): ${wfs.map(w => JSON.stringify({ name: w.name, trigger: w.trigger, steps: w.steps })).join("\n")}

  Live Automations (${automations.length}): ${automations.map(a => JSON.stringify({ name: a.name, status: a.status, manifest: a.manifest })).join("\n")}

  CRM Stats: ${contactCount} contacts, ${dealCount} deals

  Provide:
  1. Summary of current setup
  2. Gaps/missing automations
  3. 3 specific workflow recommendations as JSON manifests
  4. Optimization suggestions for existing workflows

  Return as JSON: { "summary": "...", "gaps": [...], "recommendations": [...manifest objects...], "optimizations": [...] }`;

    const aiResult2 = await aiChat([
      { role: "system", content: "You are an expert marketing automation consultant. Analyze business automation setups and provide actionable recommendations. Return JSON only." },
      { role: "user", content: analysisPrompt },
    ], { temperature: 0.6, maxTokens: 4096, jsonMode: true, route: "v1-compiler-analyze" });

    const cleaned = aiResult2.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let analysis: any;
    try {
      analysis = JSON.parse(cleaned);
    } catch {
      analysis = { summary: cleaned, gaps: [], recommendations: [], optimizations: [] };
    }

    await logUsageInternal(account.id, "AI_CHAT", 1, "Workflow compiler analysis");
    res.json(analysis);
  }));

  // ===========================================================================
  // AI TOOLBELT — "Do Anything" CRUD Operations
  // ===========================================================================

  const AI_TOOLS = [
    {
      name: "generate_landing_page",
      description: "Generate an AI-powered landing page for the business",
      category: "content",
      inputSchema: { prompt: "string", style: "string?" },
    },
    {
      name: "create_contact",
      description: "Add a new contact to the CRM",
      category: "crm",
      inputSchema: { first_name: "string", last_name: "string?", phone: "string?", email: "string?", tags: "string[]?" },
    },
    {
      name: "cleanup_old_leads",
      description: "Archive contacts older than a specified number of days with no activity",
      category: "crm",
      inputSchema: { days_old: "number", dry_run: "boolean?" },
    },
    {
      name: "provision_vapi_line",
      description: "Search and provision a new phone number via Twilio for voice AI",
      category: "voice",
      inputSchema: { area_code: "string?", country: "string?" },
    },
    {
      name: "send_sms_blast",
      description: "Send an SMS message to a list of contacts by tag",
      category: "messaging",
      inputSchema: { tag: "string", message: "string", sub_account_id: "number" },
    },
    {
      name: "create_workflow",
      description: "Create a new automation workflow",
      category: "automation",
      inputSchema: { name: "string", trigger: "string", steps: "object[]" },
    },
    {
      name: "get_site_state",
      description: "Read the current state of accounts, workflows, contacts, and automations",
      category: "read",
      inputSchema: { sub_account_id: "number" },
    },
    {
      name: "deploy_geofence_ad",
      description: "Deploy a geo-targeted Meta ad around specific coordinates",
      category: "ads",
      inputSchema: { lat: "number", lng: "number", radius_miles: "number?", campaign_name: "string?", budget: "number?" },
    },
    {
      name: "update_account_settings",
      description: "Update sub-account configuration or settings",
      category: "admin",
      inputSchema: { sub_account_id: "number", name: "string?", industry: "string?", plan: "string?" },
    },
    {
      name: "create_deal",
      description: "Create a new deal in the sales pipeline",
      category: "crm",
      inputSchema: { sub_account_id: "number", title: "string", value: "number?", stage_id: "number", contact_id: "number?" },
    },
  ];

  app.get("/api/v1/tools", asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      tools: AI_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        category: t.category,
        inputSchema: t.inputSchema,
      })),
      count: AI_TOOLS.length,
    });
  }));

  app.post("/api/v1/tools/execute", asyncHandler(async (req: Request, res: Response) => {
    const parsed = z.object({
      tool: z.string().min(1),
      args: z.record(z.any()).optional().default({}),
      subAccountId: z.number().optional(),
    }).safeParse(req.body);

    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { tool, args, subAccountId } = parsed.data;
    const toolDef = AI_TOOLS.find(t => t.name === tool);
    if (!toolDef) return res.status(404).json({ error: `Unknown tool: ${tool}` });

    const startMs = Date.now();
    let result: any;
    let status = "success";

    try {
      switch (tool) {
        case "generate_landing_page": {
          if (!isAIConfigured()) throw new Error("AI not configured");
          const sitePrompt = args.prompt || "Professional business landing page";
          const lpResult = await aiChat([
            { role: "system", content: "Generate a JSON site structure with sections: hero, features, testimonials, cta. Return valid JSON." },
            { role: "user", content: sitePrompt },
          ], { temperature: 0.7, maxTokens: 4096, jsonMode: true, route: "v1-generate-landing-page" });
          const cleaned = lpResult.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          let siteData;
          try { siteData = JSON.parse(cleaned); } catch { siteData = { raw: cleaned }; }
          result = { generated: true, siteData };
          break;
        }

        case "create_contact": {
          if (!subAccountId) throw new Error("subAccountId required");
          const contact = await storage.createContact({
            subAccountId,
            firstName: args.first_name || "Unknown",
            lastName: args.last_name || null,
            phone: args.phone || null,
            email: args.email || null,
            source: "ai_toolbelt",
            tags: args.tags || [],
            notes: "Created via AI Toolbelt",
          });
          result = { created: true, contact };
          break;
        }

        case "cleanup_old_leads": {
          if (!subAccountId) throw new Error("subAccountId required");
          const daysOld = args.days_old || 90;
          const allContacts = await storage.getContacts(subAccountId);
          const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
          const oldContacts = allContacts.filter(c => new Date(c.createdAt) < cutoff);
          if (args.dry_run) {
            result = { dry_run: true, would_archive: oldContacts.length, total: allContacts.length };
          } else {
            let archived = 0;
            for (const c of oldContacts) {
              await storage.updateContact(c.id, { tags: [...(c.tags || []), "archived"] });
              archived++;
            }
            result = { archived, total: allContacts.length };
          }
          break;
        }

        case "provision_vapi_line": {
          const areaCode = args.area_code || "239";
          result = { message: `Phone number search initiated for area code ${areaCode}. Use the Phone Numbers page to complete purchase.`, areaCode };
          break;
        }

        case "send_sms_blast": {
          if (!args.sub_account_id) throw new Error("sub_account_id required");
          const tagContacts = (await storage.getContacts(args.sub_account_id)).filter(c => c.tags?.includes(args.tag));
          result = { queued: tagContacts.length, tag: args.tag, message: args.message };
          break;
        }

        case "create_workflow": {
          const wf = await storage.createWorkflow({
            name: args.name || "AI Tool Workflow",
            trigger: args.trigger || "manual_trigger",
            steps: args.steps || [],
            subAccountId: subAccountId || null,
          });
          result = { created: true, workflow: wf };
          break;
        }

        case "get_site_state": {
          const acctId = args.sub_account_id || subAccountId;
          if (!acctId) throw new Error("sub_account_id required");
          const account = await storage.getSubAccount(acctId);
          if (!account) throw new Error("Account not found");
          const wfs = (await storage.getWorkflows()).filter(w => w.subAccountId === acctId);
          const autos = await storage.getLiveAutomations(acctId);
          const ctcs = await storage.getContacts(acctId);
          const dls = await storage.getDeals(acctId);
          result = {
            account: { id: account.id, name: account.name, industry: account.industry, plan: account.plan },
            workflows: wfs.map(w => ({ id: w.id, name: w.name, trigger: w.trigger })),
            automations: autos.map(a => ({ id: a.id, name: a.name, status: a.status })),
            contacts: ctcs.length,
            deals: dls.length,
          };
          break;
        }

        case "deploy_geofence_ad": {
          result = {
            deployed: true,
            lat: args.lat,
            lng: args.lng,
            radius_miles: args.radius_miles || 1,
            campaign_name: args.campaign_name || "AI Geofence Campaign",
            message: "Geofence ad deployment queued",
          };
          break;
        }

        case "update_account_settings": {
          if (!args.sub_account_id) throw new Error("sub_account_id required");
          const updateData: any = {};
          if (args.name) updateData.name = args.name;
          if (args.industry) updateData.industry = args.industry;
          const updated = await storage.updateSubAccount(args.sub_account_id, updateData);
          result = { updated: !!updated, account: updated };
          break;
        }

        case "create_deal": {
          if (!args.sub_account_id) throw new Error("sub_account_id required");
          const deal = await storage.createDeal({
            subAccountId: args.sub_account_id,
            title: args.title || "New Deal",
            value: args.value || 0,
            stageId: args.stage_id,
            contactId: args.contact_id || null,
            status: "open",
            notes: "Created via AI Toolbelt",
            closedAt: null,
          });
          result = { created: true, deal };
          break;
        }

        default:
          throw new Error(`Tool ${tool} has no handler`);
      }
    } catch (err: any) {
      status = "error";
      result = { error: err.message };
    }

    const executionMs = Date.now() - startMs;

    await storage.createAiToolLog({
      subAccountId: subAccountId || null,
      toolName: tool,
      input: args,
      output: result,
      status,
      executionMs,
    });

    res.json({ tool, status, result, executionMs });
  }));

  app.post("/api/v1/tools/ai-execute", asyncHandler(async (req: Request, res: Response) => {
    if (!isAIConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = z.object({
      command: z.string().min(1).max(2000),
      subAccountId: z.number().optional(),
    }).safeParse(req.body);

    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const toolList = AI_TOOLS.map(t => `- ${t.name}: ${t.description} (inputs: ${JSON.stringify(t.inputSchema)})`).join("\n");

    const aiExecuteResult = await aiChat([
      { role: "system", content: `You are an AI that translates natural language commands into tool executions.

  Available tools:
  ${toolList}

  Return JSON: { "tool": "<tool_name>", "args": { <arguments> }, "explanation": "<what this will do>" }

  If the command requires multiple tools, return: { "steps": [{ "tool": "...", "args": {...} }, ...], "explanation": "..." }

  Return ONLY valid JSON.` },
      { role: "user", content: parsed.data.command },
    ], { temperature: 0.3, maxTokens: 4096, jsonMode: true, route: "v1-tools-ai-execute" });

    const cleaned = aiExecuteResult.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let plan: any;
    try {
      plan = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "AI returned invalid plan", raw: cleaned });
    }

    await logUsageInternal(parsed.data.subAccountId || null, "AI_CHAT", 1, "AI toolbelt command interpretation");

    res.json({
      plan,
      message: "AI has interpreted your command. Execute the plan via /api/v1/tools/execute.",
    });
  }));

  // ============================================================
  // UNIVERSAL DISPATCHER — Single endpoint for ALL system commands
  // ============================================================

  const ORCHESTRATE_ACTIONS = [
    "save_workflow", "deploy_ad", "provision_user", "trigger_geofence",
    "send_sms", "start_vapi_call", "broadcast_alert", "create_sub_account",
    "update_settings", "generate_site", "create_contact", "create_deal",
    "deploy_geofence_ad", "provision_vapi_line", "check_workflow_status",
    "get_crash_logs", "update_user_role", "save_workflow_manifest",
    "elevenlabs_tts",
  ] as const;

  async function executeDispatchAction(action: string, payload: Record<string, any>): Promise<any> {
    let result: any;
    switch (action) {
        case "save_workflow":
        case "save_workflow_manifest": {
          if (payload.manifest) {
            const automation = await storage.createLiveAutomation({
              name: payload.name || payload.manifest.name || `Workflow_${Date.now()}`,
              description: payload.description || payload.manifest.description || null,
              manifest: payload.manifest,
              status: "compiled",
              subAccountId: payload.subAccountId || null,
              lastRunAt: null,
              runCount: 0,
              runLogs: [],
            });
            result = { status: "Success", message: "Workflow Live", automationId: automation.id, name: automation.name };
          } else {
            const wf = await storage.createWorkflow({
              name: payload.name || "Orchestrated Workflow",
              trigger: payload.trigger || "manual_trigger",
              steps: payload.steps || [],
              subAccountId: payload.subAccountId || null,
            });
            result = { status: "Success", message: "Workflow Saved", workflowId: wf.id };
          }
          break;
        }

        case "deploy_ad":
        case "deploy_geofence_ad": {
          const adResult = await deployGeofenceAd({
            id: payload.id || Date.now(),
            location: payload.location || "Target Area",
            lat: payload.lat,
            lng: payload.lng,
            title: payload.campaign_name || "Apex Geofence Campaign",
          }, payload.radius_miles || 1);
          result = { status: "Success", message: "Ad Deployed", details: adResult };
          break;
        }

        case "provision_user":
        case "create_sub_account": {
          const account = await storage.createSubAccount({
            name: payload.name || "New Account",
            twilioNumber: payload.twilio_number || "",
            industry: payload.industry || "general",
            plan: payload.plan || "starter",
            ownerUserId: payload.owner_user_id || null,
          });
          result = { status: "Success", message: "Account Ready", accountId: account.id, name: account.name };
          break;
        }

        case "trigger_geofence": {
          const incidents = await processLiveSentinelFeed();
          const filtered = payload.county
            ? incidents.filter(inc => inc.county?.toUpperCase() === payload.county.toUpperCase())
            : incidents;
          result = {
            status: "Success",
            message: `Geofence scan complete. ${filtered.length} incidents found.`,
            incidents: filtered.slice(0, 20),
            total: filtered.length,
          };
          break;
        }

        case "get_crash_logs": {
          const logs = await processLiveSentinelFeed();
          const limit = payload.limit || 20;
          result = {
            status: "Success",
            message: `${logs.length} total incidents`,
            incidents: logs.slice(0, limit),
          };
          break;
        }

        case "send_sms": {
          const twilioSid = process.env.TWILIO_ACCOUNT_SID;
          const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
          if (!twilioSid || !twilioAuth) {
            result = { status: "Error", message: "Twilio not configured" };
          } else if (!payload.to || !payload.body) {
            result = { status: "Error", message: "Missing 'to' phone number or 'body'" };
          } else {
            const { checkPhoneOptOut } = await import("../optOutGuard");
            const isOptedOut = payload.subAccountId
              ? await checkPhoneOptOut(payload.to, payload.subAccountId)
              : false;

            if (isOptedOut) {
              result = { status: "Blocked", message: "Recipient has opted out of SMS" };
            } else {
              try {
                const twilio = Twilio(twilioSid, twilioAuth);
                const msg = await twilio.messages.create({
                  to: payload.to,
                  from: payload.from || process.env.TWILIO_PHONE_NUMBER || "+18001234567",
                  body: payload.body,
                });
                result = { status: "Success", message: "SMS Sent", sid: msg.sid };
              } catch (err: any) {
                result = { status: "Error", message: `SMS failed: ${err.message}` };
              }
            }
          }
          break;
        }

        case "start_vapi_call": {
          const vapiKey = process.env.VAPI_PRIVATE_KEY;
          if (!vapiKey) {
            result = { status: "Error", message: "Vapi not configured" };
          } else {
            try {
              const vapiRes = await fetch("https://api.vapi.ai/call/phone", {
                method: "POST",
                headers: { "Authorization": `Bearer ${vapiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  phoneNumberId: payload.phoneNumberId || process.env.VAPI_PHONE_NUMBER_ID,
                  customer: { number: payload.to },
                  assistantId: payload.assistantId,
                  assistant: payload.assistantId ? undefined : {
                    model: { provider: "openai", model: "gpt-4o-mini" },
                    voice: { provider: "11labs", voiceId: "21m00Tcm4TlvDq8ikWAM" },
                    firstMessage: payload.first_message || "Hi, this is Apex calling on behalf of your local firm. How can I help you today?",
                  },
                }),
              });
              const vapiData = await vapiRes.json();
              result = { status: "Success", message: "Call Initiated", callId: (vapiData as any).id, details: vapiData };
            } catch (err: any) {
              result = { status: "Error", message: `Vapi call failed: ${err.message}` };
            }
          }
          break;
        }

        case "send_facebook_dm":
        case "SendFacebookDM": {
          if (!payload.recipientId || !payload.body) {
            result = { status: "Error", message: "Missing recipientId or body" };
          } else {
            try {
              const { getMetaConfig } = await import("../metaConfig");
              const subId = payload.subAccountId || 13;
              const metaCfg = await getMetaConfig(subId);
              let proof = "";
              if (metaCfg.accessToken && metaCfg.appSecret) {
                const crypto = await import("crypto");
                proof = crypto.createHmac("sha256", metaCfg.appSecret).update(metaCfg.accessToken).digest("hex");
              }
              const dmUrl = `https://graph.facebook.com/v19.0/${metaCfg.pageId}/messages${proof ? `?appsecret_proof=${proof}` : ""}`;
              const dmRes = await fetch(dmUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  recipient: { id: payload.recipientId },
                  message: { text: payload.body },
                  access_token: metaCfg.accessToken,
                }),
              });
              const dmData = await dmRes.json() as any;
              if (dmRes.ok) {
                await db.insert(messages).values({
                  subAccountId: subId,
                  channel: "facebook",
                  direction: "outbound",
                  contactPhone: payload.recipientId,
                  body: payload.body,
                  status: "sent",
                  pageId: metaCfg.pageId,
                  senderId: payload.recipientId,
                });
                result = { status: "Success", message: "Facebook DM sent", messageId: dmData.message_id };
              } else {
                result = { status: "Error", message: `Facebook DM failed: ${JSON.stringify(dmData).substring(0, 200)}` };
              }
            } catch (fbErr: any) {
              result = { status: "Error", message: `Facebook DM error: ${fbErr.message}` };
            }
          }
          break;
        }

        case "send_form_link":
        case "SendFormLink": {
          const formUrl = payload.formUrl || payload.form_url;
          const recipient = payload.recipientId || payload.to;
          const channel = payload.channel || "facebook";
          const formBody = payload.body || `Hey {{leadName}}! Please fill out this quick form so we can serve you better: ${formUrl}`;
          if (!recipient || !formUrl) {
            result = { status: "Error", message: "Missing recipientId/to or formUrl" };
          } else if (channel === "facebook") {
            try {
              const sendFormResult = await executeDispatchAction("SendFacebookDM", {
                recipientId: recipient,
                body: formBody,
                subAccountId: payload.subAccountId,
              });
              result = { status: "Success", message: "Form link sent via Facebook DM", details: sendFormResult };
            } catch (fErr: any) {
              result = { status: "Error", message: `Form link send failed: ${fErr.message}` };
            }
          } else {
            const smsResult = await executeDispatchAction("send_sms", {
              to: recipient,
              body: formBody,
              from: payload.from,
              subAccountId: payload.subAccountId,
            });
            result = { status: "Success", message: "Form link sent via SMS", details: smsResult };
          }
          break;
        }

        case "broadcast_alert": {
          if (!payload.message) {
            result = { status: "Error", message: "Missing alert message" };
          } else {
            const alertWebhookUrl = process.env.APEX_WEBHOOK_URL;
            if (alertWebhookUrl) {
              try {
                await fetch(alertWebhookUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    type: "broadcast_alert",
                    message: payload.message,
                    channel: payload.channel || "all",
                    priority: payload.priority || "normal",
                    timestamp: new Date().toISOString(),
                  }),
                });
              } catch (err: any) {
                console.error("[V1] Broadcast alert push failed:", err.message);
              }
            }
            result = { status: "Success", message: "Alert Broadcast", alert: payload.message, channel: payload.channel || "all" };
          }
          break;
        }

        case "update_settings":
        case "update_user_role": {
          if (!payload.sub_account_id) {
            result = { status: "Error", message: "sub_account_id required" };
          } else {
            const updateData: any = {};
            if (payload.name) updateData.name = payload.name;
            if (payload.industry) updateData.industry = payload.industry;
            if (payload.plan) updateData.plan = payload.plan;
            const updated = await storage.updateSubAccount(payload.sub_account_id, updateData);
            result = { status: "Success", message: "Settings Updated", account: updated };
          }
          break;
        }

        case "generate_site": {
          if (!isAIConfigured()) throw new Error("AI not configured");
          const genSiteResult = await aiChat([
            { role: "system", content: "Generate a JSON site structure with sections: hero, features, testimonials, cta. Return valid JSON." },
            { role: "user", content: payload.prompt || "Professional business landing page" },
          ], { temperature: 0.7, maxTokens: 4096, jsonMode: true, route: "v1-orchestrate-generate-site" });
          const cleaned = genSiteResult.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          let siteData;
          try { siteData = JSON.parse(cleaned); } catch { siteData = { raw: cleaned }; }
          result = { status: "Success", message: "Site Generated", siteData };
          break;
        }

        case "create_contact": {
          if (!payload.sub_account_id) throw new Error("sub_account_id required");
          const contact = await storage.createContact({
            subAccountId: payload.sub_account_id,
            firstName: payload.first_name || "Unknown",
            lastName: payload.last_name || null,
            phone: payload.phone || null,
            email: payload.email || null,
            source: payload.source || "orchestrator",
            tags: payload.tags || [],
            notes: payload.notes || "Created via Universal Dispatcher",
          });
          result = { status: "Success", message: "Contact Created", contact };
          break;
        }

        case "create_deal": {
          if (!payload.sub_account_id) throw new Error("sub_account_id required");
          const deal = await storage.createDeal({
            subAccountId: payload.sub_account_id,
            title: payload.title || "New Deal",
            value: payload.value || 0,
            stageId: payload.stage_id,
            contactId: payload.contact_id || null,
            status: "open",
            notes: payload.notes || "Created via Universal Dispatcher",
            closedAt: null,
          });
          result = { status: "Success", message: "Deal Created", deal };
          break;
        }

        case "provision_vapi_line": {
          const areaCode = payload.area_code || "239";
          result = { status: "Success", message: `Phone line provisioning initiated for area code ${areaCode}`, areaCode };
          break;
        }

        case "elevenlabs_tts":
        case "ElevenLabsTTS": {
          const elSubAccountId = payload.subAccountId || payload.sub_account_id;
          const elApiKey = await resolveElevenLabsApiKey(elSubAccountId);
          if (!elApiKey) {
            result = { status: "Error", message: "ElevenLabs API key not configured. Connect it in the Integrations Hub." };
          } else if (!payload.text) {
            result = { status: "Error", message: "Missing 'text' for TTS synthesis" };
          } else {
            try {
              const elVoiceId = payload.voice_id || payload.voiceId || "EXAVITQu4vr4xnSDxMaL";
              const audioBuffer = await elevenLabsTtsRequest(elApiKey, elVoiceId, payload.text, {
                modelId: payload.model_id,
                stability: payload.stability,
                similarityBoost: payload.similarity_boost,
              });
              result = {
                status: "Success",
                message: "TTS audio generated",
                audioBase64: audioBuffer.toString("base64"),
                contentType: "audio/mpeg",
                characterCount: payload.text.length,
              };
            } catch (err: any) {
              result = { status: "Error", message: `ElevenLabs TTS error: ${err.message}` };
            }
          }
          break;
        }

        case "check_workflow_status": {
          const automations = await storage.getLiveAutomations(payload.sub_account_id);
          const workflows = (await storage.getWorkflows()).filter(w =>
            payload.sub_account_id ? w.subAccountId === payload.sub_account_id : true
          );
          result = {
            status: "Success",
            message: `${automations.length} live automations, ${workflows.length} workflows`,
            automations: automations.map(a => ({ id: a.id, name: a.name, status: a.status })),
            workflows: workflows.map(w => ({ id: w.id, name: w.name, trigger: w.trigger })),
          };
          break;
        }

        default:
          return { status: "Error", message: `Unknown command: ${action}`, availableActions: [...ORCHESTRATE_ACTIONS] };
      }
    return result;
  }

  async function fireAutomationTrigger(
    triggerName: string,
    subAccountId: number,
    context: Record<string, any> = {},
    depth: number = 0
  ) {
    try {
      const { checkAutomationSafety } = await import("../automationSafety");
      const automations = await storage.getLiveAutomations(subAccountId);
      const matching = automations.filter((a: any) =>
        (a.status === "compiled" || a.status === "active") &&
        a.manifest?.trigger &&
        a.manifest.trigger === triggerName
      );

      if (matching.length === 0) return;

      const account = await storage.getSubAccount(subAccountId);

      for (const automation of matching) {
        const safety = checkAutomationSafety({
          automationId: automation.id,
          triggerId: `${triggerName}:${JSON.stringify(context).substring(0, 100)}`,
          depth,
          accountId: subAccountId,
        });

        if (!safety.safe) {
          console.warn(`[AUTOMATION] Blocked: ${safety.reason}`);
          continue;
        }

        try {
          const steps = automation.manifest?.steps || [];
          for (const step of steps) {
            const action = step.action || step.type;
            if (!action) continue;

            if (action === "Wait" || action === "wait") {
              const waitMs = (step.payload?.seconds || step.seconds || 5) * 1000;
              await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 30000)));
              continue;
            }

            if (action === "Condition" || action === "condition") {
              continue;
            }

            const stepPayload = { ...step.payload, ...(step.params || {}) };

            const bookingLink = "https://calendar.app.google/Fwdtvy7Sy3P8Z1CV6";
            const templateReplace = (str: string) => str
              .replace(/\{\{leadName\}\}/g, context.leadName || context.first_name || "there")
              .replace(/\{\{contact\.first_name\}\}/g, context.first_name || context.leadName || "there")
              .replace(/\{\{first_name\}\}/g, context.first_name || context.leadName || "there")
              .replace(/\{\{leadPhone\}\}/g, context.leadPhone || "")
              .replace(/\{\{leadEmail\}\}/g, context.leadEmail || "")
              .replace(/\{\{location\}\}/g, context.location || "")
              .replace(/\{\{source\}\}/g, context.source || "")
              .replace(/\{\{bookingLink\}\}/g, bookingLink)
              .replace(/\{\{orderNumber\}\}/g, context.orderNumber || "")
              .replace(/\{\{orderTotal\}\}/g, context.orderTotal || "")
              .replace(/\{\{cartTotal\}\}/g, context.cartTotal || "")
              .replace(/\{\{cartUrl\}\}/g, context.cartUrl || "")
              .replace(/\{\{storeName\}\}/g, context.storeName || "");

            if (stepPayload.body && typeof stepPayload.body === "string") {
              stepPayload.body = templateReplace(stepPayload.body);
            }
            if (stepPayload.first_message && typeof stepPayload.first_message === "string") {
              stepPayload.first_message = templateReplace(stepPayload.first_message);
            }

            if (action === "SendFacebookDM" || action === "send_facebook_dm") {
              if (context.senderId || context.leadPhone) {
                await executeDispatchAction("SendFacebookDM", {
                  recipientId: context.senderId || context.leadPhone,
                  body: stepPayload.body || "Thanks for reaching out!",
                  subAccountId,
                });
                console.log(`[AUTOMATION] Facebook DM sent to ${context.senderId || context.leadPhone}`);
              }
              continue;
            }

            if (action === "SendFormLink" || action === "send_form_link") {
              const recipient = context.senderId || context.leadPhone;
              if (recipient) {
                await executeDispatchAction("SendFormLink", {
                  recipientId: recipient,
                  to: recipient,
                  formUrl: stepPayload.formUrl || stepPayload.form_url,
                  body: stepPayload.body,
                  channel: context.channel || "facebook",
                  subAccountId,
                });
                console.log(`[AUTOMATION] Form link sent to ${recipient}`);
              }
              continue;
            }

            if (action === "VapiCall") {
              const vapiKey = process.env.VAPI_PRIVATE_KEY_APEX || process.env.VAPI_PRIVATE_KEY;
              if (vapiKey && context.leadPhone) {
                try {
                  const assistantId = stepPayload.assistantId || "e30434f7-e7e0-4be7-8b89-40c384a52b4a";
                  const vapiRes = await fetch("https://api.vapi.ai/call/phone", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${vapiKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
                      customer: { number: context.leadPhone },
                      assistantId,
                      assistantOverrides: stepPayload.first_message ? {
                        firstMessage: stepPayload.first_message,
                      } : undefined,
                    }),
                  });
                  const vapiData = await vapiRes.json() as any;
                  console.log(`[AUTOMATION] VapiCall initiated to ${context.leadPhone}: ${vapiData.id || "no-id"}`);
                } catch (vapiErr: any) {
                  console.error(`[AUTOMATION] VapiCall failed: ${vapiErr.message}`);
                }
              } else {
                console.warn(`[AUTOMATION] VapiCall skipped — no Vapi key or no leadPhone`);
              }
              continue;
            }

            if (action === "SendBookingLink") {
              const smsBody = stepPayload.body || `Hey ${context.leadName || "there"}! Book a time with us: ${bookingLink}`;
              if (context.leadPhone) {
                await executeDispatchAction("send_sms", {
                  to: context.leadPhone,
                  body: smsBody,
                  subAccountId,
                  from: account?.twilioNumber || process.env.TWILIO_PHONE_NUMBER,
                });
                console.log(`[AUTOMATION] BookingLink SMS sent to ${context.leadPhone}`);
              }
              continue;
            }

            if (action === "AIQualify") {
              if (isAIConfigured() && context.message) {
                try {
                  const qualifyResult = await aiChat([
                    { role: "system", content: "You are a lead qualification assistant. Analyze the lead's message and context. Return a JSON object with: {score: 1-10, intent: string, qualified: boolean, reasoning: string}" },
                    { role: "user", content: `Lead: ${context.leadName || "Unknown"}\nMessage: ${context.message}\nSource: ${context.source || "unknown"}\nCheck: ${stepPayload.check || "interest_level"}` },
                  ], { temperature: 0.3, maxTokens: 256, route: "ai-qualify" });
                  console.log(`[AUTOMATION] AIQualify result for ${context.leadName || "unknown"}: ${qualifyResult.text?.substring(0, 200)}`);
                } catch (qErr: any) {
                  console.warn(`[AUTOMATION] AIQualify failed: ${qErr.message}`);
                }
              } else {
                console.log(`[AUTOMATION] AIQualify step — lead: ${context.leadName || "unknown"}, check: ${stepPayload.check || "interest_level"}`);
              }
              continue;
            }

            if (action === "SendWhatsApp" || action === "send_whatsapp") {
              if (context.leadPhone) {
                const whatsappBody = stepPayload.body || "Thanks for reaching out!";
                await executeDispatchAction("send_sms", {
                  to: context.leadPhone,
                  body: whatsappBody,
                  subAccountId,
                  from: account?.twilioNumber || process.env.TWILIO_PHONE_NUMBER,
                });
                console.log(`[AUTOMATION] WhatsApp/SMS sent to ${context.leadPhone}`);
              }
              continue;
            }

            if (action === "ElevenLabsTTS" || action === "elevenlabs_tts") {
              await executeDispatchAction("elevenlabs_tts", {
                ...stepPayload,
                subAccountId,
              });
              continue;
            }

            if (action === "AIGenerate" || action === "ai_generate") {
              if (isAIConfigured()) {
                try {
                  const prompt = stepPayload.prompt || stepPayload.body || "Generate a follow-up message for this lead.";
                  const aiResult = await aiChat([
                    { role: "system", content: "You are a marketing assistant. Generate the requested content." },
                    { role: "user", content: prompt },
                  ], { temperature: 0.7, maxTokens: 512, route: "ai-generate-step" });
                  console.log(`[AUTOMATION] AIGenerate output: ${aiResult.text?.substring(0, 200)}`);
                  if (stepPayload.sendAsDm && (context.senderId || context.leadPhone)) {
                    await executeDispatchAction("SendFacebookDM", {
                      recipientId: context.senderId || context.leadPhone,
                      body: aiResult.text,
                      subAccountId,
                    });
                  }
                } catch (genErr: any) {
                  console.warn(`[AUTOMATION] AIGenerate failed: ${genErr.message}`);
                }
              }
              continue;
            }

            if (action === "send_sms" || action === "SendTwilioSMS" || action === "SMS") {
              if (!stepPayload.to && context.leadPhone) stepPayload.to = context.leadPhone;
            }
            await executeDispatchAction(action, {
              ...stepPayload,
              subAccountId,
              from: account?.twilioNumber || process.env.TWILIO_PHONE_NUMBER,
            });
          }

          await storage.updateLiveAutomation(automation.id, {
            lastRunAt: new Date(),
            runCount: (automation.runCount || 0) + 1,
            runLogs: [...(automation.runLogs as any[] || []), {
              timestamp: new Date().toISOString(),
              trigger: triggerName,
              context: { leadName: context.leadName, leadPhone: context.leadPhone },
              status: "completed",
            }].slice(-50),
          });
          console.log(`[AUTOMATION] "${automation.name}" fired on trigger "${triggerName}" for account ${subAccountId}`);
        } catch (autoErr: any) {
          console.error(`[AUTOMATION] "${automation.name}" failed: ${autoErr.message}`);
          await storage.updateLiveAutomation(automation.id, {
            runLogs: [...(automation.runLogs as any[] || []), {
              timestamp: new Date().toISOString(),
              trigger: triggerName,
              status: "error",
              error: autoErr.message,
            }].slice(-50),
          });
        }
      }
    } catch (err: any) {
      console.error(`[AUTOMATION] Trigger "${triggerName}" error for account ${subAccountId}: ${err.message}`);
    }
  }

  _fireAutomationTrigger = fireAutomationTrigger;
  console.log("[AUTOMATION] fireAutomationTriggerGlobal bridge initialized");

  app.post("/api/v1/orchestrate", asyncHandler(async (req: Request, res: Response) => {
    const parsed = z.object({
      action: z.string().min(1),
      payload: z.record(z.any()).optional().default({}),
    }).safeParse(req.body);

    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { action, payload } = parsed.data;
    console.log(`🤖 AI DELEGATING ACTION: ${action}`, JSON.stringify(payload).slice(0, 200));

    const startMs = Date.now();
    let result: any;

    try {
      result = await executeDispatchAction(action, payload);
    } catch (err: any) {
      return res.status(500).json({ status: "Error", message: err.message, action });
    }

    const executionMs = Date.now() - startMs;
    console.log(`✅ ACTION COMPLETE: ${action} (${executionMs}ms)`);

    await storage.createAiToolLog({
      subAccountId: payload.sub_account_id || payload.subAccountId || null,
      toolName: `orchestrate:${action}`,
      input: payload,
      output: result,
      status: result.status === "Error" ? "error" : "success",
      executionMs,
    });

    res.json({ ...result, action, executionMs });
  }));

  // ============================================================
  // AI ORCHESTRATOR — Full auto-execute: AI interprets → plans → EXECUTES
  // ============================================================
  app.post("/api/v1/orchestrate/ai", asyncHandler(async (req: Request, res: Response) => {
    if (!isAIConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = z.object({
      command: z.string().min(1).max(3000),
      subAccountId: z.number().optional(),
      autoExecute: z.boolean().optional().default(true),
    }).safeParse(req.body);

    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { command, subAccountId, autoExecute } = parsed.data;

    const orchestrateActions = ORCHESTRATE_ACTIONS.join(", ");
    const toolList = AI_TOOLS.map(t => `- ${t.name}: ${t.description}`).join("\n");

    const orchestrateAiResult = await aiChat([
      { role: "system", content: `You are the Apex OS Architect. You orchestrate the Apex Marketing Automations ecosystem by issuing commands to the backend API.

  RULES OF ENGAGEMENT:
  - You do NOT just chat; you ORCHESTRATE.
  - If a user asks for a workflow, you generate the JSON manifest.
  - You turn natural language into executable action plans.

  AVAILABLE ORCHESTRATE ACTIONS (use these as "action" values):
  ${orchestrateActions}

  AVAILABLE TOOLS (for toolbelt operations):
  ${toolList}

  When building a workflow manifest, use this structure:
  {
  "name": "Workflow Name",
  "trigger": { "type": "OnCrashDetected|OnNewLead|OnMissedCall|OnFormSubmit|Manual", "filters": {} },
  "steps": [
    { "id": "step_1", "action_type": "SendTwilioSMS|Wait|Condition|DeployMetaAd|AlertTeam|CreateContact|SendEmail|WebhookCall|AIGenerate|ElevenLabsTTS", "label": "...", "params": {...} }
  ]
  }

  Return a JSON execution plan:
  {
  "interpretation": "What the user wants in one sentence",
  "steps": [
    { "action": "<orchestrate_action>", "payload": { ... }, "description": "What this step does" }
  ],
  "summary": "Brief completion message to show the user"
  }

  For workflow creation, use action "save_workflow_manifest" with payload.manifest containing the full manifest.

  ${subAccountId ? `Context: Operating on sub-account #${subAccountId}` : ""}

  Return ONLY valid JSON.` },
      { role: "user", content: command },
    ], { temperature: 0.3, maxTokens: 4096, jsonMode: true, route: "v1-orchestrate-ai" });

    const cleaned = orchestrateAiResult.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let plan: any;
    try {
      plan = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "AI returned invalid plan", raw: cleaned });
    }

    if (!autoExecute) {
      return res.json({ plan, executed: false, message: "Plan generated. Set autoExecute=true to run." });
    }

    const executionResults: any[] = [];
    const planSteps = plan.steps || (plan.action ? [plan] : []);

    for (let i = 0; i < planSteps.length; i++) {
      const step = planSteps[i];
      const stepAction = step.action;
      const stepPayload = step.payload || step.args || {};

      if (subAccountId && !stepPayload.sub_account_id && !stepPayload.subAccountId) {
        stepPayload.subAccountId = subAccountId;
        stepPayload.sub_account_id = subAccountId;
      }

      try {
        const stepResult = await executeDispatchAction(stepAction, stepPayload);

        await storage.createAiToolLog({
          subAccountId: subAccountId || null,
          toolName: `orchestrate:${stepAction}`,
          input: stepPayload,
          output: stepResult,
          status: stepResult?.status === "Error" ? "error" : "success",
          executionMs: 0,
        });

        executionResults.push({
          step: i + 1,
          action: stepAction,
          description: step.description || step.explanation,
          status: stepResult?.status || "Success",
          result: stepResult,
        });
      } catch (err: any) {
        executionResults.push({
          step: i + 1,
          action: stepAction,
          description: step.description || step.explanation,
          status: "Error",
          result: { error: err.message },
        });
      }
    }

    await logUsageInternal(subAccountId || null, "AI_ORCHESTRATE", planSteps.length, `Orchestrated: ${command.slice(0, 100)}`);

    res.json({
      interpretation: plan.interpretation || plan.explanation,
      summary: plan.summary || `Executed ${executionResults.length} actions.`,
      steps: executionResults,
      totalSteps: executionResults.length,
      successCount: executionResults.filter(r => r.status === "Success").length,
      executed: true,
    });
  }));

  app.post("/api/v1/orchestrate/ai/stream", asyncHandler(async (req: Request, res: Response) => {
    if (!isAIConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = z.object({
      command: z.string().min(1).max(3000),
      subAccountId: z.number().optional(),
      autoExecute: z.boolean().optional().default(true),
    }).safeParse(req.body);

    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { command, subAccountId, autoExecute } = parsed.data;
    const stream = new ProgressStream(res);

    try {
      stream.sendProgress("Planning execution strategy...");

      const orchestrateActions = ORCHESTRATE_ACTIONS.join(", ");
      const toolList = AI_TOOLS.map(t => `- ${t.name}: ${t.description}`).join("\n");

      const orchestrateStreamResult = await aiChat([
        { role: "system", content: `You are the Apex OS Architect. You orchestrate the Apex Marketing Automations ecosystem by issuing commands to the backend API.

  RULES OF ENGAGEMENT:
  - You do NOT just chat; you ORCHESTRATE.
  - If a user asks for a workflow, you generate the JSON manifest.
  - You turn natural language into executable action plans.

  AVAILABLE ORCHESTRATE ACTIONS (use these as "action" values):
  ${orchestrateActions}

  AVAILABLE TOOLS (for toolbelt operations):
  ${toolList}

  When building a workflow manifest, use this structure:
  {
  "name": "Workflow Name",
  "trigger": { "type": "OnCrashDetected|OnNewLead|OnMissedCall|OnFormSubmit|Manual", "filters": {} },
  "steps": [
    { "id": "step_1", "action_type": "SendTwilioSMS|Wait|Condition|DeployMetaAd|AlertTeam|CreateContact|SendEmail|WebhookCall|AIGenerate|ElevenLabsTTS", "label": "...", "params": {...} }
  ]
  }

  Return a JSON execution plan:
  {
  "interpretation": "What the user wants in one sentence",
  "steps": [
    { "action": "<orchestrate_action>", "payload": { ... }, "description": "What this step does" }
  ],
  "summary": "Brief completion message to show the user"
  }

  For workflow creation, use action "save_workflow_manifest" with payload.manifest containing the full manifest.

  ${subAccountId ? `Context: Operating on sub-account #${subAccountId}` : ""}

  Return ONLY valid JSON.` },
        { role: "user", content: command },
      ], { temperature: 0.3, maxTokens: 4096, jsonMode: true, route: "v1-orchestrate-ai-stream" });

      const cleaned = orchestrateStreamResult.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      let plan: any;
      try {
        plan = JSON.parse(cleaned);
      } catch {
        stream.sendError("AI returned invalid plan");
        stream.end();
        return;
      }

      stream.sendResult({ interpretation: plan.interpretation || plan.explanation });

      if (!autoExecute) {
        stream.end({ plan, executed: false, message: "Plan generated. Set autoExecute=true to run." });
        return;
      }

      const planSteps = plan.steps || (plan.action ? [plan] : []);
      const executionResults: any[] = [];

      for (let i = 0; i < planSteps.length; i++) {
        const step = planSteps[i];
        const stepAction = step.action;
        const stepPayload = step.payload || step.args || {};

        if (subAccountId && !stepPayload.sub_account_id && !stepPayload.subAccountId) {
          stepPayload.subAccountId = subAccountId;
          stepPayload.sub_account_id = subAccountId;
        }

        stream.sendStep(`step_${i}`, "running", step.description || stepAction, `Executing: ${stepAction}`);

        try {
          const stepResult = await executeDispatchAction(stepAction, stepPayload);

          await storage.createAiToolLog({
            subAccountId: subAccountId || null,
            toolName: `orchestrate:${stepAction}`,
            input: stepPayload,
            output: stepResult,
            status: stepResult?.status === "Error" ? "error" : "success",
            executionMs: 0,
          });

          executionResults.push({
            step: i + 1,
            action: stepAction,
            description: step.description || step.explanation,
            status: stepResult?.status || "Success",
            result: stepResult,
          });

          stream.sendStep(`step_${i}`, stepResult?.status === "Error" ? "error" : "done",
            step.description || stepAction,
            stepResult?.status === "Error" ? `Error: ${stepResult.message}` : "Completed");
        } catch (err: any) {
          executionResults.push({
            step: i + 1,
            action: stepAction,
            description: step.description || step.explanation,
            status: "Error",
            result: { error: err.message },
          });

          stream.sendStep(`step_${i}`, "error", step.description || stepAction, err.message);
        }
      }

      await logUsageInternal(subAccountId || null, "AI_ORCHESTRATE", planSteps.length, `Orchestrated: ${command.slice(0, 100)}`);

      stream.end({
        interpretation: plan.interpretation || plan.explanation,
        summary: plan.summary || `Executed ${executionResults.length} actions.`,
        steps: executionResults,
        totalSteps: executionResults.length,
        successCount: executionResults.filter(r => r.status === "Success").length,
        executed: true,
      });
    } catch (err: any) {
      stream.sendError(err.message || "Orchestration failed");
      stream.end();
    }
  }));
}
