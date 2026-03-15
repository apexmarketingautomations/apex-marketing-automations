import type { OperatorTool, ValidationResult, ToolResult, OperatorContext } from "./types";
import { storage } from "../storage";
import { publishEventAsync, EVENT_TYPES } from "../eventBus";

const tools = new Map<string, OperatorTool>();

export function registerTool(tool: OperatorTool): void {
  tools.set(tool.name, tool);
}

export function getTool(name: string): OperatorTool | undefined {
  return tools.get(name);
}

export function listTools(category?: string): OperatorTool[] {
  const all = [...tools.values()];
  if (category) return all.filter(t => t.category === category);
  return all;
}

export function getToolRegistry(): Map<string, OperatorTool> {
  return tools;
}

export function getToolManifest(): Array<{ name: string; description: string; category: string; requiresApproval: boolean; autonomyRequired: string; parameters: any[] }> {
  return [...tools.values()].map(t => ({
    name: t.name,
    description: t.description,
    category: t.category,
    requiresApproval: t.requiresApproval,
    autonomyRequired: t.autonomyRequired,
    parameters: t.parameters,
  }));
}

function validateParams(tool: OperatorTool, params: Record<string, any>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const p of tool.parameters) {
    if (p.required && (params[p.name] === undefined || params[p.name] === null)) {
      errors.push(`Missing required parameter: ${p.name}`);
    }
    if (params[p.name] !== undefined) {
      const actualType = Array.isArray(params[p.name]) ? "array" : typeof params[p.name];
      if (p.type === "array" && actualType !== "array") {
        errors.push(`${p.name} must be an array`);
      } else if (p.type !== "array" && p.type !== "object" && actualType !== p.type) {
        warnings.push(`${p.name} expected ${p.type}, got ${actualType}`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export async function executeTool(toolName: string, params: Record<string, any>, context: OperatorContext): Promise<ToolResult> {
  const tool = tools.get(toolName);
  if (!tool) {
    return { success: false, error: `Unknown tool: ${toolName}` };
  }

  const paramValidation = validateParams(tool, params);
  if (!paramValidation.valid) {
    return { success: false, error: `Parameter validation failed: ${paramValidation.errors.join(", ")}` };
  }

  const toolValidation = tool.validate(params, context);
  if (!toolValidation.valid) {
    return { success: false, error: `Validation failed: ${toolValidation.errors.join(", ")}` };
  }

  if (context.autonomyLevel === "observe") {
    return { success: false, error: "Operator is in observe-only mode. Cannot execute actions." };
  }

  try {
    const result = await tool.execute(params, context);
    return result;
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

function noopValidate(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

registerTool({
  name: "createPipeline",
  description: "Create a CRM pipeline with stages for a sub-account",
  category: "crm",
  autonomyRequired: "draft",
  requiresApproval: false,
  parameters: [
    { name: "stages", type: "array", required: true, description: "Array of {name, color} stage definitions" },
  ],
  validate: noopValidate,
  execute: async (params, ctx) => {
    const created: any[] = [];
    for (let i = 0; i < params.stages.length; i++) {
      const s = params.stages[i];
      const stage = await storage.createPipelineStage({
        subAccountId: ctx.subAccountId,
        name: s.name,
        color: s.color || "#6366f1",
        position: i,
      });
      created.push(stage);
    }
    publishEventAsync(EVENT_TYPES.DEAL_CREATED, { subAccountId: ctx.subAccountId, stageCount: created.length }, "operator");
    return { success: true, data: { stages: created }, sideEffects: [`Created ${created.length} pipeline stages`] };
  },
});

registerTool({
  name: "createContact",
  description: "Create a new CRM contact",
  category: "crm",
  autonomyRequired: "draft",
  requiresApproval: false,
  parameters: [
    { name: "firstName", type: "string", required: true, description: "Contact first name" },
    { name: "lastName", type: "string", required: false, description: "Contact last name" },
    { name: "phone", type: "string", required: false, description: "Phone number" },
    { name: "email", type: "string", required: false, description: "Email address" },
    { name: "source", type: "string", required: false, description: "Lead source" },
    { name: "tags", type: "array", required: false, description: "Contact tags" },
  ],
  validate: noopValidate,
  execute: async (params, ctx) => {
    const contact = await storage.createContact({
      subAccountId: ctx.subAccountId,
      firstName: params.firstName,
      lastName: params.lastName || null,
      phone: params.phone || null,
      email: params.email || null,
      source: params.source || "operator",
      tags: params.tags || [],
    });
    publishEventAsync(EVENT_TYPES.CONTACT_CREATED, { subAccountId: ctx.subAccountId, contactId: contact.id }, "operator");
    return { success: true, data: contact, eventsFired: ["contact.created"] };
  },
});

registerTool({
  name: "createWorkflow",
  description: "Create a new automation workflow from a manifest",
  category: "workflow",
  autonomyRequired: "draft",
  requiresApproval: true,
  parameters: [
    { name: "name", type: "string", required: true, description: "Workflow name" },
    { name: "trigger", type: "string", required: true, description: "Trigger event (e.g. new_lead, appointment_booked)" },
    { name: "steps", type: "array", required: true, description: "Array of workflow step objects" },
  ],
  validate: (params) => {
    const errors: string[] = [];
    if (!params.steps || params.steps.length === 0) errors.push("Workflow must have at least one step");
    if (!params.trigger) errors.push("Workflow must have a trigger");
    return { valid: errors.length === 0, errors, warnings: [] };
  },
  execute: async (params, ctx) => {
    const automation = await storage.createLiveAutomation({
      subAccountId: ctx.subAccountId,
      name: params.name,
      manifest: { trigger: params.trigger, steps: params.steps },
      status: "compiled",
    });
    publishEventAsync(EVENT_TYPES.WORKFLOW_STARTED, { subAccountId: ctx.subAccountId, workflowId: automation.id, name: params.name }, "operator");
    return { success: true, data: automation, sideEffects: [`Created workflow "${params.name}" (status: compiled/draft)`], eventsFired: ["workflow.started"] };
  },
});

registerTool({
  name: "generateLandingPage",
  description: "Generate an AI-powered landing page for a business",
  category: "site",
  autonomyRequired: "draft",
  requiresApproval: true,
  parameters: [
    { name: "prompt", type: "string", required: true, description: "Description of the landing page to generate" },
    { name: "businessName", type: "string", required: false, description: "Business name to use" },
  ],
  validate: noopValidate,
  execute: async (params, ctx) => {
    const { geminiChat, isGeminiConfigured } = await import("../gemini");
    if (!isGeminiConfigured()) return { success: false, error: "AI is not configured (missing Gemini API key)" };

    const account = await storage.getSubAccount(ctx.subAccountId);
    const businessName = params.businessName || account?.businessName || "My Business";

    const sitePrompt = `Generate a professional landing page for "${businessName}". ${params.prompt}. Return valid JSON with theme (primaryColor, secondaryColor, fontFamily) and sections array.`;
    const result = await geminiChat([
      { role: "system", content: "You are a landing page designer. Return JSON only with theme and sections array." },
      { role: "user", content: sitePrompt },
    ], { jsonMode: true, temperature: 0.7 });

    let siteData;
    try {
      siteData = JSON.parse(result);
    } catch {
      return { success: false, error: "AI returned invalid JSON for site generation" };
    }

    const site = await storage.createSavedSite({
      subAccountId: ctx.subAccountId,
      name: `${businessName} Landing Page`,
      prompt: params.prompt,
      siteData,
    });

    publishEventAsync(EVENT_TYPES.SITE_GENERATED, { subAccountId: ctx.subAccountId, siteId: site.id }, "operator");
    return { success: true, data: { siteId: site.id, name: site.name }, sideEffects: ["Generated landing page (saved as draft)"], eventsFired: ["site.generated"] };
  },
});

registerTool({
  name: "checkIntegrationHealth",
  description: "Check the health status of all connected integrations for an account",
  category: "integration",
  autonomyRequired: "observe",
  requiresApproval: false,
  parameters: [],
  validate: noopValidate,
  execute: async (_params, ctx) => {
    const connections = await storage.getIntegrationConnections(ctx.subAccountId);
    const report = connections.map((c: any) => ({
      provider: c.provider,
      status: c.status,
      type: c.connectionType,
      lastChecked: c.lastHealthCheck || c.updatedAt,
    }));
    return { success: true, data: { connections: report, total: report.length, healthy: report.filter((r: any) => r.status === "connected").length } };
  },
});

registerTool({
  name: "detectMissingSetup",
  description: "Scan account configuration and detect missing setup pieces",
  category: "system",
  autonomyRequired: "observe",
  requiresApproval: false,
  parameters: [],
  validate: noopValidate,
  execute: async (_params, ctx) => {
    const account = await storage.getSubAccount(ctx.subAccountId);
    if (!account) return { success: false, error: "Account not found" };

    const missing: string[] = [];
    const recommendations: string[] = [];

    if (!account.twilioNumber) {
      missing.push("No phone number assigned — SMS and voice calls won't work");
      recommendations.push("Connect a Twilio phone number in Integrations");
    }

    const connections = await storage.getIntegrationConnections(ctx.subAccountId);
    const connectedProviders = new Set(connections.filter((c: any) => c.status === "connected").map((c: any) => c.provider));

    if (!connectedProviders.has("twilio")) {
      missing.push("Twilio not connected — no SMS capability");
      recommendations.push("Add Twilio credentials in Integrations");
    }

    const automations = await storage.getLiveAutomations(ctx.subAccountId);
    if (!automations || automations.length === 0) {
      missing.push("No active automations — leads won't receive auto-responses");
      recommendations.push("Create a lead auto-response workflow");
    }

    const contacts = await storage.getContacts(ctx.subAccountId);
    if (!contacts || contacts.length === 0) {
      missing.push("No contacts in CRM");
      recommendations.push("Import contacts or set up a lead capture form");
    }

    const stages = await storage.getPipelineStages(ctx.subAccountId);
    if (!stages || stages.length === 0) {
      missing.push("No pipeline stages — deal tracking disabled");
      recommendations.push("Create a sales pipeline with stages");
    }

    const sites = await storage.getSavedSites(ctx.subAccountId);
    if (!sites || sites.length === 0) {
      missing.push("No landing pages — no online presence");
      recommendations.push("Generate a landing page for your business");
    }

    return {
      success: true,
      data: {
        accountName: account.businessName,
        industry: account.industry,
        missing,
        recommendations,
        completionScore: Math.round(((6 - missing.length) / 6) * 100),
        hasPhone: !!account.twilioNumber,
        integrationCount: connectedProviders.size,
        automationCount: automations?.length || 0,
        contactCount: contacts?.length || 0,
        pipelineConfigured: (stages?.length || 0) > 0,
        hasSite: (sites?.length || 0) > 0,
      },
    };
  },
});

registerTool({
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
});

registerTool({
  name: "diagnoseWorkflow",
  description: "Analyze a workflow for issues and suggest improvements",
  category: "diagnostics",
  autonomyRequired: "observe",
  requiresApproval: false,
  parameters: [
    { name: "workflowId", type: "number", required: true, description: "ID of the workflow to diagnose" },
  ],
  validate: noopValidate,
  execute: async (params, ctx) => {
    const automations = await storage.getLiveAutomations(ctx.subAccountId);
    const automation = automations?.find((a: any) => a.id === params.workflowId);
    if (!automation) return { success: false, error: "Workflow not found" };

    const issues: string[] = [];
    const suggestions: string[] = [];
    const manifest = automation.manifest as any;

    if (!manifest?.trigger) issues.push("No trigger defined — workflow will never fire");
    if (!manifest?.steps || manifest.steps.length === 0) issues.push("No steps defined — workflow does nothing");

    if (manifest?.steps) {
      for (const step of manifest.steps) {
        if (step.action === "SMS" && !step.message) issues.push(`SMS step missing message body`);
        if (step.action === "WAIT" && step.duration > 30) suggestions.push(`Wait step exceeds 30s sync limit — consider background scheduling`);
        if (step.action === "CONDITION" && !step.condition) issues.push(`Condition step missing condition logic`);
      }
    }

    const runLogs = (automation as any).runLogs || [];
    const recentFailures = runLogs.filter((l: any) => l.status === "error").slice(-5);
    if (recentFailures.length > 0) {
      issues.push(`${recentFailures.length} recent execution failures detected`);
    }

    return {
      success: true,
      data: {
        workflowId: automation.id,
        name: automation.name,
        status: automation.status,
        issues,
        suggestions,
        healthy: issues.length === 0,
        recentFailures: recentFailures.length,
      },
    };
  },
});

registerTool({
  name: "getAccountSummary",
  description: "Get a comprehensive summary of account state and metrics",
  category: "system",
  autonomyRequired: "observe",
  requiresApproval: false,
  parameters: [],
  validate: noopValidate,
  execute: async (_params, ctx) => {
    const account = await storage.getSubAccount(ctx.subAccountId);
    if (!account) return { success: false, error: "Account not found" };

    const contacts = await storage.getContacts(ctx.subAccountId);
    const messages = await storage.getMessages(ctx.subAccountId);
    const automations = await storage.getLiveAutomations(ctx.subAccountId);
    const connections = await storage.getIntegrationConnections(ctx.subAccountId);
    const stages = await storage.getPipelineStages(ctx.subAccountId);
    const sites = await storage.getSavedSites(ctx.subAccountId);

    return {
      success: true,
      data: {
        business: { name: account.businessName, industry: account.industry, phone: account.twilioNumber },
        metrics: {
          contacts: contacts?.length || 0,
          messages: messages?.length || 0,
          automations: automations?.length || 0,
          integrations: connections?.filter((c: any) => c.status === "connected").length || 0,
          pipelineStages: stages?.length || 0,
          sites: sites?.length || 0,
        },
      },
    };
  },
});

registerTool({
  name: "connectIntegration",
  description: "Initiate integration connection setup — returns instructions for OAuth or credential entry",
  category: "integration",
  autonomyRequired: "observe",
  requiresApproval: false,
  parameters: [
    { name: "provider", type: "string", required: true, description: "Integration provider name (e.g. twilio, google, meta)" },
  ],
  validate: noopValidate,
  execute: async (params, ctx) => {
    const oauthProviders = ["google", "meta", "youtube", "linkedin", "tiktok", "microsoft", "calendly"];
    const credentialProviders = ["twilio", "stripe", "mailchimp", "elevenlabs", "slack", "zapier", "hubspot", "whatsapp-business"];

    const provider = params.provider.toLowerCase();

    if (oauthProviders.includes(provider)) {
      return {
        success: true,
        data: {
          type: "oauth",
          provider,
          action: "redirect_to_oauth",
          url: `/api/oauth/${provider}/authorize/${ctx.subAccountId}`,
          instructions: `User must complete OAuth flow for ${provider}. Redirect them to the authorization URL.`,
        },
      };
    }

    if (credentialProviders.includes(provider)) {
      return {
        success: true,
        data: {
          type: "credential",
          provider,
          action: "collect_credentials",
          instructions: `User must provide API credentials for ${provider}. Guide them to the Integrations page.`,
        },
      };
    }

    return { success: false, error: `Unknown provider: ${provider}. Available: ${[...oauthProviders, ...credentialProviders].join(", ")}` };
  },
});

registerTool({
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
});

console.log(`[OPERATOR] Tool registry initialized: ${tools.size} tools registered`);
