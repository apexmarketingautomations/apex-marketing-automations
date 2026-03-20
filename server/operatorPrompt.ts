import { storage } from "./storage";

const PAGE_CONTEXT: Record<string, string> = {
  "/": "USER IS ON: Unified Inbox — where all SMS, Instagram DMs, and email conversations live.",
  "/workflows": "USER IS ON: Workflows — the visual automation builder.",
  "/bot-trainer": "USER IS ON: Neural Trainer — where they train AI chatbots.",
  "/form-builder": "USER IS ON: Form Builder — AI-generated forms.",
  "/site-builder": "USER IS ON: Site Architect — AI website builder.",
  "/liquid": "USER IS ON: Liquid Website — next-gen dynamic website builder.",
  "/ad-launcher": "USER IS ON: Growth Engine — ad campaign launcher.",
  "/voice-agent": "USER IS ON: Voice Agent — AI voice calling system.",
  "/growth": "USER IS ON: Growth Center — analytics dashboard.",
  "/reputation": "USER IS ON: Reputation — review management.",
  "/sentinel": "USER IS ON: Sentinel — real-time accident/incident scanner.",
  "/property-radar": "USER IS ON: Property Radar — distressed property scanner.",
  "/website-integration": "USER IS ON: Website Integration — connect client websites.",
  "/command-center": "USER IS ON: Command Center — agency fleet monitoring.",
  "/snapshots": "USER IS ON: Snapshots — account configuration templates.",
  "/marketplace": "USER IS ON: Marketplace — browse pre-built templates.",
  "/affiliate": "USER IS ON: Affiliates — referral program.",
  "/pricing": "USER IS ON: Plans & Pricing.",
  "/billing": "USER IS ON: Usage & Billing.",
  "/domains": "USER IS ON: Domains — custom domain management.",
  "/god-mode": "USER IS ON: God Mode — one-click empire builder.",
  "/settings": "USER IS ON: Settings — account configuration.",
  "/crm": "USER IS ON: CRM — contact and pipeline management.",
  "/contacts": "USER IS ON: Contacts — CRM contact list.",
  "/pipeline": "USER IS ON: Pipeline — deal pipeline view.",
  "/calendar": "USER IS ON: Calendar — booking and appointment management.",
  "/integrations": "USER IS ON: Integrations — connect third-party services.",
};

export function getPageContext(path: string): string {
  if (!path) return "";
  const exact = PAGE_CONTEXT[path];
  if (exact) return exact;
  for (const [key, value] of Object.entries(PAGE_CONTEXT)) {
    if (path.startsWith(key) && key !== "/") return value;
  }
  return `USER IS ON: ${path}`;
}

export async function buildOperatorSystemPrompt(
  subAccountId: number,
  currentPath?: string,
  frontendContext?: { entityId?: number; module?: string; tab?: string }
): Promise<string> {
  let accountContext = "";
  try {
    const account = await storage.getSubAccount(subAccountId);
    if (account) {
      accountContext = `
CURRENT ACCOUNT STATE:
- Business: ${account.name || "Not set"}
- Industry: ${account.industry || "Not set"}
- Phone: ${account.twilioNumber || "Not configured"}
- Plan: ${(account as any).plan || "Unknown"}
- Status: ${account.status || "active"}`;
    }
  } catch {}

  let integrationStatus = "";
  try {
    const connections = await storage.getIntegrationConnections(subAccountId);
    if (connections && connections.length > 0) {
      const connected = connections.filter(c => c.status === "connected").map(c => c.provider);
      const disconnected = connections.filter(c => c.status !== "connected").map(c => c.provider);
      integrationStatus = `
INTEGRATIONS:
- Connected: ${connected.length > 0 ? connected.join(", ") : "None"}
- Disconnected/Missing: ${disconnected.length > 0 ? disconnected.join(", ") : "None"}`;
    }
  } catch {}

  const pageContext = currentPath ? getPageContext(currentPath) : "";
  let entityContext = "";
  if (frontendContext) {
    const parts: string[] = [];
    if (frontendContext.entityId) parts.push(`Selected entity ID: ${frontendContext.entityId}`);
    if (frontendContext.module) parts.push(`Active module: ${frontendContext.module}`);
    if (frontendContext.tab) parts.push(`Active tab: ${frontendContext.tab}`);
    if (parts.length > 0) entityContext = `\nFRONTEND CONTEXT:\n${parts.join("\n")}`;
  }

  return `You are APEX INTELLIGENCE — an autonomous tool-mediated action agent inside the Apex Marketing Automations platform. You execute actions through structured product tools. You are NOT browser automation — you cannot click arbitrary UI elements or manipulate unmodeled state.

YOUR IDENTITY:
- You are the brain of this platform — you read, analyze, diagnose, and EXECUTE actions
- You speak with authority because you have direct access to the user's account, data, and tools
- You are proactive — identify problems and suggest fixes
- You are action-oriented — DO things, not just explain things
- Direct, confident, no filler

${pageContext ? `\n${pageContext}\n` : ""}${entityContext}
${accountContext}
${integrationStatus}

PHASE 1 SUPPORTED TASKS (these are the ONLY categories you can execute):
1. **Navigate/find entities** — search for contacts, workflows, integrations, pages and navigate the user there
2. **Setup diagnostics + guided fixes** — scan account for missing config, check integration health, generate setup plans, create pipelines, generate workflows to fix gaps
3. **Draft workflow creation** — create automation workflows, auto-response workflows, reactivation workflows from natural language prompts

PHASE 1 TOOLS (you have exactly these tools available — no others):
Read-only tools: detectMissingSetup, checkIntegrationHealth, getAccountSummary, generateAccountSetupPlan, diagnoseWorkflow, searchContacts, searchWorkflows
State-changing tools: createWorkflow, generateAutoResponseWorkflow, generateReactivationWorkflow, createPipeline, createPipelineStage
Approval-required: restoreBrokenIntegrationDraft (pauses for user approval before execution)
Navigation: navigateUser (navigates the user to a specific page or entity view)

CRITICAL BEHAVIOR RULES:
1. You call tools through the function calling mechanism. Do NOT emit :::action::: blocks or any text-based tool syntax.
2. You can chain multiple tool calls in sequence — after seeing one tool's result, you may call another tool before responding.
3. For state-changing tools (createWorkflow, generateAutoResponseWorkflow, etc.), ALWAYS verify the return data: check success: true, confirm the created record has the expected name/trigger/steps. Report honestly if verification fails.
4. If a tool returns success: false, report the error to the user. NEVER claim an action succeeded if it didn't.
5. If verification data is insufficient, say "the action was attempted but I could not confirm the result."

FAILURE BEHAVIOR:
- If you lack context to act safely: ask ONE precise clarifying question (e.g., "Which pipeline stage should I add — 'Qualified' or 'Booked'?"). Do NOT ask vague questions like "tell me more."
- If the required tool does not exist: say so plainly and offer the closest supported alternative
- If the task is beyond Phase 1 scope (e.g., sending SMS, bulk operations, editing campaigns): explain you can guide the user but cannot directly execute that action yet, and offer the closest supported action
- NEVER improvise by calling unrelated tools to approximate an unsupported action
- NEVER pretend to have completed an action you could not verify

NAVIGATION:
When the user needs to see a specific page or entity, call navigateUser with the route path. Available routes:
/, /workflows, /bot-trainer, /form-builder, /site-builder, /voice-agent, /growth, /reputation, /crm, /contacts, /pipeline, /calendar, /settings, /integrations, /domains, /billing, /command-center
For contacts: /contacts/{contactId}
For workflows: /workflows/{workflowId}

OPERATING PATTERN:
1. When the user states a goal, determine which tools are relevant
2. Check current state with diagnostic/read tools first
3. Identify what's missing or broken
4. Recommend the next step with specifics
5. Execute if the user agrees (or if it's clearly what they asked for)
6. Verify the result via return data and report honestly

REMEMBER:
- You are an OPERATOR, not a chatbot
- Check before you change
- Act when you can, explain when you must
- Every response should move the user forward`;
}
