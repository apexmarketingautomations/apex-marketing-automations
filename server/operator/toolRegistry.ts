import type { OperatorTool, ValidationResult, ToolResult, OperatorContext, ToolExecutionResult, PlannerToolMeta, ToolCategory } from "./types";
import { allSchemas } from "./toolSchemas";
import { crmTools, messagingTools, workflowTools, appointmentTools, campaignTools, creativeTools, reviewTools, intelligenceTools } from "./toolHandlers";
import { storage } from "../storage";
import { publishEventAsync, EVENT_TYPES } from "../eventBus";
import { startTrace, recordStepValue } from "../traceRecorder";

const tools = new Map<string, OperatorTool>();
const idempotencyCache = new Map<string, { result: ToolResult; timestamp: number }>();
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;

export function registerTool(tool: OperatorTool): void {
  tools.set(tool.name, tool);
}

export function getTool(name: string): OperatorTool | undefined {
  return tools.get(name);
}

export function listTools(category?: string): OperatorTool[] {
  const all = Array.from(tools.values());
  if (category) return all.filter(t => t.category === category);
  return all;
}

export function getToolRegistry(): Map<string, OperatorTool> {
  const wrapped = new Map<string, OperatorTool>();
  tools.forEach((tool, name) => {
    wrapped.set(name, {
      ...tool,
      execute: async (firstArg: any, secondArg: any) => {
        if (typeof firstArg === "number" && (typeof secondArg === "object" || secondArg === undefined)) {
          const ctx: OperatorContext = {
            subAccountId: firstArg,
            autonomyLevel: "execute",
            sessionId: "approved",
            correlationId: `plan-${Date.now()}`,
          };
          return executeTool(name, secondArg || {}, ctx);
        }
        return executeTool(name, firstArg, secondArg);
      },
    });
  });
  return wrapped;
}

export function getToolManifest(): Array<{ name: string; description: string; category: string; requiresApproval: boolean; autonomyRequired: string; parameters: any[] }> {
  return Array.from(tools.values()).map(t => ({
    name: t.name,
    description: t.description,
    category: t.category,
    requiresApproval: t.requiresApproval,
    autonomyRequired: t.autonomyRequired,
    parameters: t.parameters,
  }));
}

export function listToolsForPlanner(): PlannerToolMeta[] {
  return Array.from(tools.values()).map(t => ({
    name: t.name,
    description: t.description,
    category: t.category,
    autonomyLevel: t.autonomyRequired,
    requiresApproval: t.requiresApproval,
    parameterNames: t.parameters.map(p => p.name),
  }));
}

export function listToolsByCategory(category: ToolCategory): OperatorTool[] {
  return Array.from(tools.values()).filter(t => t.category === category);
}

export function listToolsByAutonomy(level: "observe" | "draft" | "execute"): OperatorTool[] {
  return Array.from(tools.values()).filter(t => t.autonomyRequired === level);
}

export function getToolCategories(): { category: ToolCategory; count: number; tools: string[] }[] {
  const categoryMap = new Map<ToolCategory, string[]>();
  tools.forEach(tool => {
    if (!categoryMap.has(tool.category)) categoryMap.set(tool.category, []);
    categoryMap.get(tool.category)!.push(tool.name);
  });
  const result: { category: ToolCategory; count: number; tools: string[] }[] = [];
  categoryMap.forEach((toolNames, category) => {
    result.push({ category, count: toolNames.length, tools: toolNames });
  });
  return result;
}

function validateParams(tool: OperatorTool, params: Record<string, any>): ValidationResult {
  const schemaKey = tool.name as keyof typeof allSchemas;
  const zodSchema = allSchemas[schemaKey];
  if (zodSchema) {
    const result = zodSchema.safeParse(params);
    if (!result.success) {
      const errors = result.error.errors.map(e => `${e.path.join(".")}: ${e.message}`);
      return { valid: false, errors, warnings: [] };
    }
    return { valid: true, errors: [], warnings: [] };
  }

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

  if (context.autonomyLevel === "observe" && tool.autonomyRequired !== "observe") {
    return { success: false, error: "Operator is in observe-only mode. Cannot execute actions." };
  }

  if (tool.requiresApproval && context.autonomyLevel !== "execute" && context.sessionId !== "approved") {
    return { success: false, error: `Tool "${toolName}" requires approval before execution. Create an approval request first.` };
  }

  if (tool.idempotencyKey) {
    const rawKey = tool.idempotencyKey(params);
    const scopedKey = `${context.subAccountId}:${toolName}:${rawKey}`;
    const cached = idempotencyCache.get(scopedKey);
    if (cached && Date.now() - cached.timestamp < IDEMPOTENCY_TTL_MS) {
      return { ...cached.result, sideEffects: [...(cached.result.sideEffects || []), "(idempotent: returned cached result)"] };
    }
  }

  const toolStart = Date.now();
  const traceId = context.traceId;
  const trace = traceId
    ? { traceId, subAccountId: context.subAccountId }
    : startTrace(context.subAccountId);

  try {
    const result = await tool.execute(params, context);

    if (tool.idempotencyKey && result.success) {
      const rawKey = tool.idempotencyKey(params);
      const scopedKey = `${context.subAccountId}:${toolName}:${rawKey}`;
      idempotencyCache.set(scopedKey, { result, timestamp: Date.now() });
    }

    const toolDisambiguator = context.correlationId || `${toolName}-${toolStart}`;
    recordStepValue(trace, `operator_tool:${toolName}`, result.success ? "success" : "error", Date.now() - toolStart, {
      metadata: { toolName, category: tool.category, paramKeys: Object.keys(params) },
      error: result.success ? undefined : result.error,
      disambiguator: toolDisambiguator,
    });

    return result;
  } catch (err: any) {
    const toolDisambiguator = context.correlationId || `${toolName}-${toolStart}`;
    recordStepValue(trace, `operator_tool:${toolName}`, "error", Date.now() - toolStart, {
      error: err.message || String(err),
      metadata: { toolName, category: tool.category },
      disambiguator: `${toolDisambiguator}-err`,
    });
    return { success: false, error: err.message || String(err) };
  }
}

export async function executeToolWithAudit(toolName: string, params: Record<string, any>, context: OperatorContext): Promise<ToolExecutionResult> {
  const start = Date.now();
  const tool = tools.get(toolName);

  if (!tool) {
    return {
      toolName,
      status: "failure",
      result: { success: false, error: `Unknown tool: ${toolName}` },
      auditLog: `Tool "${toolName}" not found in registry.`,
      error: `Unknown tool: ${toolName}`,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  }

  const result = await executeTool(toolName, params, context);
  const durationMs = Date.now() - start;

  let status: ToolExecutionResult["status"] = result.success ? "success" : "failure";
  if (result.error?.includes("Parameter validation failed")) status = "validation_error";
  if (result.error?.includes("observe-only mode")) status = "autonomy_blocked";
  if (result.error?.includes("requires approval")) status = "approval_required";

  const auditLog = tool.summarizeForAudit
    ? tool.summarizeForAudit(params, result)
    : `${toolName}(${Object.keys(params).join(", ")}): ${result.success ? "success" : result.error}`;

  return {
    toolName,
    status,
    result,
    auditLog,
    error: result.error,
    durationMs,
    timestamp: new Date().toISOString(),
  };
}

const connectIntegrationTool: OperatorTool = {
  name: "connectIntegration",
  description: "Initiate integration connection setup — returns instructions for OAuth or credential entry",
  category: "workflow",
  autonomyRequired: "observe",
  requiresApproval: false,
  parameters: [
    { name: "provider", type: "string", required: true, description: "Integration provider name (e.g. twilio, google, meta)" },
  ],
  validate: () => ({ valid: true, errors: [], warnings: [] }),
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
  summarizeForAudit: (params) => `Initiated ${params.provider} integration setup.`,
};

function registerAllTools(): void {
  for (const tool of crmTools) registerTool(tool);
  for (const tool of messagingTools) registerTool(tool);
  for (const tool of workflowTools) registerTool(tool);
  for (const tool of appointmentTools) registerTool(tool);
  for (const tool of campaignTools) registerTool(tool);
  for (const tool of creativeTools) registerTool(tool);
  for (const tool of reviewTools) registerTool(tool);
  for (const tool of intelligenceTools) registerTool(tool);
  registerTool(connectIntegrationTool);
}

registerAllTools();

console.log(`[OPERATOR] Tool registry initialized: ${tools.size} tools registered`);
