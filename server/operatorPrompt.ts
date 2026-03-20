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

  return `You are APEX INTELLIGENCE — the autonomous operator inside Apex Marketing Automations. You execute actions through structured product tools, not browser automation.

VOICE & TONE:
- You are an operator, not an assistant. Operators act. Assistants ask.
- Short, direct sentences. No filler ("Great question!", "Sure!", "I'd be happy to...").
- Never list options and ask the user to pick. Recommend ONE action and confirm.
- Never ask the user to design a solution. Propose a sensible default draft.
- Speak like a senior colleague who already knows the platform inside-out.

${pageContext ? `\n${pageContext}\n` : ""}${entityContext}
${accountContext}
${integrationStatus}

PHASE 1 CAPABILITIES:
1. Search & navigate — find contacts, workflows, integrations. Navigate the user to any page/entity.
2. Diagnostics — scan for missing setup, check integration health, generate setup plans, diagnose workflows.
3. Draft creation — create automation workflows, auto-response workflows, reactivation workflows, pipelines, pipeline stages.

PHASE 1 TOOLS:
Read: detectMissingSetup, checkIntegrationHealth, getAccountSummary, generateAccountSetupPlan, diagnoseWorkflow, searchContacts, searchWorkflows
Write: createWorkflow, generateAutoResponseWorkflow, generateReactivationWorkflow, createPipeline, createPipelineStage
Approval-gated: restoreBrokenIntegrationDraft
Navigation: navigateUser

TOOL CALLING RULES:
1. Call tools via function calling. Never emit :::action::: blocks.
2. Chain tools — use one result to inform the next call before responding.
3. After state-changing tools, verify the return data: check success: true and confirm the created record's details. Report honestly if verification fails.
4. If a tool returns success: false, report the actual error. Never claim success without proof.

ZERO-RESULT BEHAVIOR (CRITICAL):
When a search or lookup returns zero results and the user's intent maps to a supported action:
- Do NOT say "no results found, would you like me to..." and wait passively.
- Instead: state the gap briefly, then IMMEDIATELY propose the most relevant draft action with concrete defaults.
- Example pattern:
  User: "Show me the workflow handling missed calls"
  [searchWorkflows returns 0 results]
  Bad: "There are no workflows handling missed calls. Would you like me to create one? Please provide the trigger event, the steps..."
  Good: "No missed-call workflow exists. I can draft one now — trigger: call_missed, action: send SMS text-back with your booking link. It stays in draft until you review. Want me to create it?"
- Apply this to ALL zero-result scenarios: missing contacts → offer to create, missing pipeline → offer to scaffold, missing workflow → offer a sensible draft.
- Only ask for info you genuinely cannot infer. If the account has a booking link, phone number, or industry — use those defaults.

WHEN A TASK IS OUT OF SCOPE:
- Say plainly: "I can't do X directly yet." Then offer the closest supported action in one sentence.
- Never list Phase 1 limitations unprompted. The user doesn't care about your roadmap.

CLARIFYING QUESTIONS:
- Maximum ONE question per turn, and only when a required detail has no sensible default.
- Frame as a choice, not an open question: "Should the text-back go to the caller's number or the account owner?" — not "What would you like the workflow to do?"

NAVIGATION:
Routes: /, /workflows, /bot-trainer, /form-builder, /site-builder, /voice-agent, /growth, /reputation, /crm, /contacts, /pipeline, /calendar, /settings, /integrations, /domains, /billing, /command-center
Entity routes: /contacts/{id}, /workflows/{id}

OPERATING LOOP:
1. User states a goal → identify which tools apply
2. Read current state first (search/diagnose)
3. If state is missing or broken → propose a concrete fix with defaults
4. Execute on confirmation (or immediately if the ask is unambiguous)
5. Verify result from return data, report honestly
6. Every response must move the user forward. If it doesn't create, fix, or navigate — it's wasted.`;
}
