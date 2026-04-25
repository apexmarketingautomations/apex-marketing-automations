import type { Express, Request, Response } from "express";
import { messages } from "@shared/schema";
import { storage } from "../storage";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { aiChat, aiChatStream, isAIConfigured, aiChatWithToolCalls } from "../aiGateway";
import type { ToolDefinition, ToolCallResult } from "../aiGateway";
import { streamAIResponse, sendSSEData, initSSE } from "../streaming";
import { asyncHandler, parseIntParam, logUsageInternal, getIndustryContext, getLanguageInstruction } from "./helpers";
import { executeTool, getTool } from "../operator/toolRegistry";
import type { OperatorContext } from "../operator/types";
import { buildOperatorSystemPrompt } from "../operatorPrompt";
import { requireActiveSubscription, checkPlanLimitMiddleware } from "../subscriptionGuard";
import {
  emitOperatorConversation,
  emitOperatorToolExecution,
  emitOperatorActionApproval,
} from "../intelligence/apexLearningFeed";

const subscriptionGuard = requireActiveSubscription();
const aiRequestsGuard = checkPlanLimitMiddleware("ai_requests");

const CONFIRM_PATTERNS = /^(yes|ok|okay|confirm|do it|go ahead|proceed|sounds good|yep|yea|yeah|sure|go for it|approved|let's do it|make it|create it|build it|draft it|y|bet|aight|absolutely|definitely|for sure|that works|perfect|please|lets go|let's go|send it|ship it|run it|execute|do that|yeah do it|yes do it|yes please|go|good|cool|alright|right|fine|yup|ight)$/i;
const REJECT_PATTERNS = /^(no|cancel|don't|dont|stop|never mind|nvm|nah|nope|reject|skip|forget it|don't do that|cancel that|no thanks|not now|hold on|wait|hold off|not yet|later|pass|no way|scratch that|undo|back up|nevermind|no no|naw)$/i;
const PENDING_ACTION_TTL_MS = 15 * 60 * 1000;

export function registerBotRoutes(app: Express) {
  // ---- Bot Chat (Real OpenAI) ----
  const botChatSchema = z.object({
    message: z.string().min(1).max(2000),
    persona: z.string().max(50000).optional(),
    industry: z.string().max(100).optional(),
    language: z.string().max(10).optional(),
    trainingJobId: z.number().optional(),
    conversationHistory: z.array(z.object({
      role: z.string(),
      content: z.string(),
    })).max(200).optional().transform((arr) => (arr ? arr.slice(-40) : arr)),
    currentPath: z.string().max(200).optional(),
  });

  const agentChatSchema = botChatSchema.extend({
    subAccountId: z.number().int().positive(),
  });

  app.post("/api/bot/chat", subscriptionGuard, asyncHandler(async (req, res) => {
    if (!isAIConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = botChatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    let basePrompt = parsed.data.persona || `You are a helpful AI assistant for a business. Keep responses concise and helpful (1-3 sentences). Help with bookings, answer questions, and provide a warm experience.`;

    let knowledgeContext = "";
    if (parsed.data.trainingJobId) {
      try {
        const job = await storage.getTrainingJob(parsed.data.trainingJobId);
        if (job && job.state === "completed") {
          if (job.generatedPersona && job.generatedPersona.length > 40) {
            basePrompt = job.generatedPersona;
          }
          if (job.scrapedContent && job.scrapedContent.length >= 200) {
            knowledgeContext = `\n\nYou have the following knowledge base from the business website (${job.url}). Use this information to answer questions accurately. If the user asks something not covered here, say you don't have that information rather than guessing:\n\n${job.scrapedContent.substring(0, 12000)}`;
          }
        } else if (job && job.state !== "completed") {
          knowledgeContext = `\n\nNOTE: A training job exists for ${job.url} but it is in state "${job.state}" and has no usable knowledge base. Do NOT pretend to know specifics about the business — say the bot hasn't been successfully trained yet.`;
        }
      } catch (e) {
        console.log("[BOT_CHAT] Could not load training job:", (e as any).message);
      }
    }

    const systemPrompt = basePrompt + knowledgeContext + getIndustryContext(parsed.data.industry) + getLanguageInstruction(parsed.data.language);

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];

    if (parsed.data.conversationHistory) {
      for (const msg of parsed.data.conversationHistory.slice(-10)) {
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    messages.push({ role: "user", content: parsed.data.message });

    const botChatResult = await aiChat(messages, { temperature: 0.7, maxTokens: 1024, route: "bot-chat" });
    let reply = botChatResult.text;
    if (!reply) {
      const { pickRecoveryLine, classifyAiFailure } = await import("../messaging/aiRecovery");
      const reason = botChatResult.ok ? "ai_failed" : classifyAiFailure(botChatResult.errorMessage);
      const rec = pickRecoveryLine({ reason, threadKey: `bot:${(req.ip || "anon")}`, channel: "web" });
      reply = rec.text;
      console.warn(`[BOT-CHAT][AI-RECOVERY] reason=${rec.reason} variant=${rec.variantIndex} aiOk=${botChatResult.ok} aiErr=${botChatResult.errorMessage}`);
    }

    await logUsageInternal(null, "AI_CHAT", 1, "Bot trainer chat");

    res.json({ reply });
  }));

  app.post("/api/bot/chat/stream", subscriptionGuard, asyncHandler(async (req, res) => {
    try {
      if (!isAIConfigured()) {
        return res.status(503).json({ error: "AI service is not configured" });
      }

      const parsed = botChatSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const basePrompt = parsed.data.persona || `You are a helpful AI assistant for a business. Keep responses concise and helpful (1-3 sentences). Help with bookings, answer questions, and provide a warm experience.`;
      const systemPrompt = basePrompt + getIndustryContext(parsed.data.industry) + getLanguageInstruction(parsed.data.language);

      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: systemPrompt },
      ];

      if (parsed.data.conversationHistory) {
        for (const msg of parsed.data.conversationHistory.slice(-10)) {
          messages.push({
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.content,
          });
        }
      }

      messages.push({ role: "user", content: parsed.data.message });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const stream = aiChatStream(messages, { temperature: 0.7, maxTokens: 1024, route: "bot-chat-stream" });
      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();

      await logUsageInternal(null, "AI_CHAT", 1, "Bot trainer chat (stream)");
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Streaming failed" });
      } else {
        res.write(`data: ${JSON.stringify({ error: error.message || "Streaming failed" })}\n\n`);
        res.end();
      }
    }
  }));

  app.post("/api/bot/chat/advisor-stream", subscriptionGuard, asyncHandler(async (req, res) => {
    try {
      if (!isAIConfigured()) {
        return res.status(503).json({ error: "AI service is not configured" });
      }

      const parsed = botChatSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const basePrompt = parsed.data.persona || "You are a helpful AI assistant.";
      const systemPrompt = basePrompt + getIndustryContext(parsed.data.industry) + getLanguageInstruction(parsed.data.language);

      const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: systemPrompt },
      ];

      if (parsed.data.conversationHistory) {
        for (const msg of parsed.data.conversationHistory.slice(-10)) {
          chatMessages.push({
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.content,
          });
        }
      }

      chatMessages.push({ role: "user", content: parsed.data.message });

      await streamAIResponse(res, chatMessages, { temperature: 0.7, maxTokens: 16384 });
      await logUsageInternal(null, "AI_CHAT", 1, "Strategic advisor chat (stream)");
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Streaming failed" });
      } else {
        sendSSEData(res, { error: error.message || "Streaming failed" });
        res.end();
      }
    }
  }));

  const PHASE1_TOOLS = new Set([
    "detectMissingSetup",
    "checkIntegrationHealth",
    "getAccountSummary",
    "generateAccountSetupPlan",
    "diagnoseWorkflow",
    "searchContacts",
    "searchWorkflows",
    "createWorkflow",
    "generateAutoResponseWorkflow",
    "generateReactivationWorkflow",
    "createPipeline",
    "createPipelineStage",
    "restoreBrokenIntegrationDraft",
    "proposeAction",
    "apexApi",
    "apexApiDirectory",
  ]);

  function buildOpenAIFunctionSchemas(): ToolDefinition[] {
    const toolDefs: ToolDefinition[] = [];

    const schemaMap: Record<string, { description: string; parameters: Record<string, unknown> }> = {
      detectMissingSetup: { description: "Scan account configuration and detect missing setup pieces", parameters: { type: "object", properties: {}, required: [] } },
      checkIntegrationHealth: { description: "Check the health status of all connected integrations", parameters: { type: "object", properties: {}, required: [] } },
      getAccountSummary: { description: "Get a comprehensive summary of account state and metrics", parameters: { type: "object", properties: {}, required: [] } },
      generateAccountSetupPlan: { description: "Generate a step-by-step account setup plan", parameters: { type: "object", properties: { industry: { type: "string", description: "Industry vertical" } }, required: [] } },
      diagnoseWorkflow: { description: "Analyze a specific workflow for issues and suggest improvements", parameters: { type: "object", properties: { workflowId: { type: "number", description: "ID of the workflow to diagnose" } }, required: ["workflowId"] } },
      searchContacts: { description: "Search contacts by name, email, phone, or tags. Returns matching contacts with IDs.", parameters: { type: "object", properties: { query: { type: "string", description: "Search term — name, email, phone, or tag" } }, required: ["query"] } },
      searchWorkflows: { description: "List or search workflows. Omit query (or pass empty string) to list ALL workflows. Pass a name fragment or trigger type to filter.", parameters: { type: "object", properties: { query: { type: "string", description: "Optional workflow name or trigger type. Empty/omitted = list all." } }, required: [] } },
      createWorkflow: { description: "Create a new automation workflow from a manifest (status: compiled/draft)", parameters: { type: "object", properties: { name: { type: "string", description: "Workflow name" }, trigger: { type: "string", description: "Trigger event" }, steps: { type: "array", items: { type: "object", properties: { action: { type: "string" }, message: { type: "string" }, duration: { type: "number" }, condition: { type: "string" } }, required: ["action"] }, description: "Workflow steps" } }, required: ["name", "trigger", "steps"] } },
      generateAutoResponseWorkflow: { description: "Generate an auto-response workflow template (status: compiled/draft)", parameters: { type: "object", properties: { trigger: { type: "string", description: "Trigger event" }, responseMessage: { type: "string", description: "Auto-response message body" }, channel: { type: "string", enum: ["sms", "email", "whatsapp"], description: "Communication channel" } }, required: ["trigger", "responseMessage"] } },
      generateReactivationWorkflow: { description: "Generate a reactivation workflow for inactive contacts (status: compiled/draft)", parameters: { type: "object", properties: { inactiveDays: { type: "number", description: "Days of inactivity before triggering" }, message: { type: "string", description: "Reactivation message" }, channel: { type: "string", enum: ["sms", "email"], description: "Communication channel" } }, required: [] } },
      createPipeline: { description: "Create a sales pipeline with stages", parameters: { type: "object", properties: { stages: { type: "array", items: { type: "object", properties: { name: { type: "string" }, color: { type: "string" } }, required: ["name"] }, description: "Pipeline stages" } }, required: ["stages"] } },
      createPipelineStage: { description: "Add an individual pipeline stage", parameters: { type: "object", properties: { name: { type: "string", description: "Stage name" }, color: { type: "string", description: "Stage color" }, position: { type: "number", description: "Stage position" } }, required: ["name"] } },
      restoreBrokenIntegrationDraft: { description: "Generate a recovery plan for a broken integration (requires user approval before execution)", parameters: { type: "object", properties: { provider: { type: "string", description: "Integration provider name (e.g. twilio, google, meta)" } }, required: ["provider"] } },
      navigateUser: { description: "Navigate the user to a specific page or entity view in the platform", parameters: { type: "object", properties: { route: { type: "string", description: "Route path to navigate to (e.g. /contacts, /workflows, /contacts/123)" }, entityId: { type: "number", description: "Optional entity ID to view" } }, required: ["route"] } },
      proposeAction: { description: "ONLY use for irreversible bulk operations (mass-messaging 50+ contacts, deleting accounts/large data, ad spend > $500, anything destructive). For normal create/edit/schedule/publish actions, just do them directly — don't propose first.", parameters: { type: "object", properties: { toolName: { type: "string", description: "The tool to execute when confirmed" }, toolArgs: { type: "object", description: "The exact arguments to pass to the tool when confirmed" }, summary: { type: "string", description: "Short human-readable summary of what this action will do" } }, required: ["toolName", "toolArgs", "summary"] } },
      apexApiDirectory: { description: "List every Apex platform endpoint you can call. Returns a catalog of API paths grouped by feature area (content planner, cards, sites, sentinel, inbox, reviews, billing, domains, integrations, account, workflows, crm). Call this FIRST whenever you need to do something not covered by the dedicated tools.", parameters: { type: "object", properties: {}, required: [] } },
      apexApi: { description: "Call ANY internal Apex API endpoint on behalf of the current user. Use for anything not covered by other tools — publishing posts, editing cards, managing sites, sentinel config, inbox queries, review settings, billing info, domain management, contact CRUD, etc. Tenant scoping is automatic. Call apexApiDirectory first if you don't know the path.", parameters: { type: "object", properties: { method: { type: "string", enum: ["GET", "POST", "PATCH", "PUT", "DELETE"], description: "HTTP method" }, path: { type: "string", description: "API path starting with /api/" }, body: { type: "object", description: "JSON body for POST/PATCH/PUT" }, query: { type: "object", description: "Query string parameters as key/value object" } }, required: ["method", "path"] } },
    };

    for (const [name, schema] of Object.entries(schemaMap)) {
      toolDefs.push({
        type: "function",
        function: { name, description: schema.description, parameters: schema.parameters },
      });
    }
    return toolDefs;
  }

  const OPENAI_TOOL_SCHEMAS = buildOpenAIFunctionSchemas();
  const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;
  const MAX_TOOL_ROUNDS = 25;

  const pendingApprovals = new Map<string, { resolve: (approved: boolean) => void }>();
  const pendingNavAcks = new Map<string, { resolve: (acked: boolean) => void }>();

  function approvalKey(sessionId: string, toolCallId: string) {
    return `${sessionId}::${toolCallId}`;
  }

  async function resolveSession(requestedSessionId: string | undefined, subAccountId: number): Promise<{ sessionId: string; history: Array<{ role: string; content?: string | null; tool_calls?: any; tool_call_id?: string; name?: string }> }> {
    if (requestedSessionId) {
      try {
        const session = await storage.getAgentConversation(requestedSessionId);
        if (session && session.subAccountId === subAccountId) {
          const lastActivity = new Date(session.lastActivityAt).getTime();
          if (Date.now() - lastActivity < SESSION_EXPIRY_MS) {
            await storage.updateAgentConversationActivity(requestedSessionId);
            const dbMessages = await storage.getAgentMessages(requestedSessionId, 20);
            const rawHistory: Array<{ role: string; content?: string | null; tool_calls?: any; tool_call_id?: string; name?: string }> = [];
            for (const m of dbMessages.reverse()) {
              if (m.role === "tool" && m.toolResults) {
                rawHistory.push({ role: "tool", content: typeof m.content === "string" ? m.content : JSON.stringify(m.toolResults), tool_call_id: (m.toolResults as any)?.tool_call_id || "", name: (m.toolResults as any)?.name || "" });
              } else if (m.role === "assistant" && m.toolCalls) {
                rawHistory.push({ role: "assistant", content: m.content || null, tool_calls: m.toolCalls });
              } else {
                rawHistory.push({ role: m.role, content: m.content || "" });
              }
            }

            const toolResponseIds = new Set<string>();
            for (const msg of rawHistory) {
              if (msg.role === "tool" && msg.tool_call_id) {
                toolResponseIds.add(msg.tool_call_id);
              }
            }
            // Determine which assistant tool_call ids are FULLY satisfied
            // (every declared tool_call has a matching tool response).
            const validAssistantToolCallIds = new Set<string>();
            for (const msg of rawHistory) {
              if (msg.role === "assistant" && msg.tool_calls) {
                const tcs = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
                if (tcs.length === 0) continue;
                const allResolved = tcs.every((tc: any) => {
                  const tcId = tc.id || tc.tool_call_id;
                  return tcId && toolResponseIds.has(tcId);
                });
                if (allResolved) {
                  for (const tc of tcs) {
                    const tcId = tc.id || tc.tool_call_id;
                    if (tcId) validAssistantToolCallIds.add(tcId);
                  }
                }
              }
            }
            const history = rawHistory.filter(msg => {
              // Drop orphan tool messages whose assistant call wasn't fully resolved.
              if (msg.role === "tool") {
                return !!(msg.tool_call_id && validAssistantToolCallIds.has(msg.tool_call_id));
              }
              if (msg.role === "assistant" && msg.tool_calls) {
                const tcs = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
                const allResolved = tcs.length > 0 && tcs.every((tc: any) => {
                  const tcId = tc.id || tc.tool_call_id;
                  return tcId && validAssistantToolCallIds.has(tcId);
                });
                if (!allResolved) {
                  // Strip the unresolved tool_calls. Keep the message only if it has text.
                  if (msg.content && typeof msg.content === "string" && msg.content.trim()) {
                    delete (msg as any).tool_calls;
                    return true;
                  }
                  return false;
                }
              }
              return true;
            });

            return { sessionId: requestedSessionId, history };
          }
        }
      } catch (e) {
        console.error("[AGENT] Session lookup failed:", e);
      }
    }
    const newSessionId = uuidv4();
    try {
      await storage.createAgentConversation({ sessionId: newSessionId, subAccountId });
    } catch (e) {
      console.error("[AGENT] Failed to create session:", e);
    }
    return { sessionId: newSessionId, history: [] };
  }

  const agentStreamSchema = agentChatSchema.extend({
    sessionId: z.string().uuid().optional(),
    frontendContext: z.object({
      entityId: z.number().optional(),
      module: z.string().optional(),
      tab: z.string().optional(),
    }).optional(),
  });

  app.get("/api/bot/chat/agent-session/:sessionId", asyncHandler(async (req, res) => {
    const sessionId = req.params.sessionId;
    const subAccountIdParam = req.query.subAccountId;
    if (!sessionId || !z.string().uuid().safeParse(sessionId).success) {
      return res.status(400).json({ error: "Invalid session ID" });
    }
    const subAccountId = subAccountIdParam ? parseInt(String(subAccountIdParam), 10) : null;
    if (!subAccountId || isNaN(subAccountId)) {
      return res.status(400).json({ error: "subAccountId query parameter is required" });
    }

    try {
      const session = await storage.getAgentConversation(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      if (session.subAccountId !== subAccountId) {
        return res.status(403).json({ error: "Session does not belong to this account" });
      }

      const lastActivity = new Date(session.lastActivityAt).getTime();
      if (Date.now() - lastActivity >= SESSION_EXPIRY_MS) {
        return res.status(410).json({ error: "Session expired" });
      }

      const dbMessages = await storage.getAgentMessages(sessionId, 20);
      const transcript: Array<{ role: string; content: string | null }> = [];
      for (const m of dbMessages.reverse()) {
        if (m.role === "user" || m.role === "assistant") {
          if (m.content) {
            transcript.push({ role: m.role, content: m.content });
          }
        }
      }
      res.json({ sessionId, transcript });
    } catch (e) {
      console.error("[AGENT] Session resume failed:", e);
      res.status(500).json({ error: "Failed to load session" });
    }
  }));

  app.post("/api/bot/chat/agent-stream", asyncHandler(async (req, res) => {
    try {
      const adminSecret = process.env.STANDALONE_ADMIN_SECRET;
      const headerSecret = req.headers["x-admin-secret"] as string | undefined;
      const isAdminBypass = !!(adminSecret && headerSecret && headerSecret.trim() === adminSecret.trim());
      if (!isAdminBypass) {
        const user = (req as any).user;
        if (!user) return res.status(401).json({ error: "Not authenticated" });
      }

      if (!isAIConfigured()) {
        return res.status(503).json({ error: "AI service is not configured" });
      }

      const parsed = agentStreamSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const subAccountId = parsed.data.subAccountId;
      const { sessionId, history } = await resolveSession(parsed.data.sessionId, subAccountId);
      const userMsg = parsed.data.message.trim();

      const pendingAction = await storage.getActivePendingAction(sessionId);

      if (pendingAction) {
        const expired = new Date(pendingAction.expiresAt).getTime() < Date.now();

        if (expired) {
          await storage.resolvePendingAction(pendingAction.id, "expired");
        } else if (CONFIRM_PATTERNS.test(userMsg)) {
          await storage.resolvePendingAction(pendingAction.id, "approved");
          emitOperatorActionApproval(subAccountId, pendingAction.toolName, pendingAction.summary, true);

          try {
            await storage.createAgentMessage({ sessionId, role: "user", content: userMsg });
          } catch (err) {
            console.error("[BOT] failed to persist approval user message:", err);
          }

          initSSE(res);
          sendSSEData(res, { type: "session", sessionId });

          sendSSEData(res, { type: "step", stepId: pendingAction.toolName, status: "running", label: `On it — ${pendingAction.summary}...` });

          const operatorContext: OperatorContext = {
            subAccountId,
            autonomyLevel: "execute",
            sessionId: `agent-${sessionId}`,
            correlationId: `agent-confirm-${Date.now()}`,
          };

          let result: any;
          try {
            result = await executeTool(pendingAction.toolName, pendingAction.toolArgs as Record<string, any>, operatorContext);
          } catch (toolError: any) {
            result = { success: false, error: toolError.message || "Tool execution failed" };
          }

          await storage.resolvePendingAction(pendingAction.id, result?.success ? "executed" : "failed");

          sendSSEData(res, { type: "step", stepId: pendingAction.toolName, status: "complete", label: `${pendingAction.toolName} complete` });
          sendSSEData(res, { type: "result", toolName: pendingAction.toolName, result });

          const successMsg = result?.success
            ? `Done — ${pendingAction.summary}.${result.data?.name ? ` "${result.data.name}" is ready to go.` : " All set."}`
            : `That didn't go through — ${result?.error || "something went wrong"}. Let me know if you want to try again or take a different approach.`;

          sendSSEData(res, { content: successMsg });

          try {
            await storage.createAgentMessage({ sessionId, role: "assistant", content: successMsg });
          } catch (err) {
            console.error("[BOT] failed to persist post-approval assistant message:", err);
          }

          sendSSEData(res, { done: true, fullText: successMsg, sessionId });
          res.end();
          return;
        } else if (REJECT_PATTERNS.test(userMsg)) {
          await storage.resolvePendingAction(pendingAction.id, "rejected");
          emitOperatorActionApproval(subAccountId, pendingAction.toolName, pendingAction.summary, false);

          try {
            await storage.createAgentMessage({ sessionId, role: "user", content: userMsg });
          } catch (err) {
            console.error("[BOT] failed to persist rejection user message:", err);
          }

          initSSE(res);
          sendSSEData(res, { type: "session", sessionId });

          const cancelMsg = `No problem, skipping that. What would you like to do instead?`;
          sendSSEData(res, { content: cancelMsg });

          try {
            await storage.createAgentMessage({ sessionId, role: "assistant", content: cancelMsg });
          } catch (err) {
            console.error("[BOT] failed to persist cancellation assistant message:", err);
          }

          sendSSEData(res, { done: true, fullText: cancelMsg, sessionId });
          res.end();
          return;
        }
      }

      const systemPrompt = await buildOperatorSystemPrompt(subAccountId, parsed.data.currentPath, parsed.data.frontendContext);

      const chatMessages: Array<{ role: string; content?: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string }> = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userMsg },
      ];

      emitOperatorConversation(subAccountId, "inbound", userMsg, { sessionId });

      try {
        await storage.createAgentMessage({ sessionId, role: "user", content: userMsg });
      } catch (err) {
        console.error("[BOT] failed to persist inbound user message:", err);
      }

      initSSE(res);
      sendSSEData(res, { type: "session", sessionId });

      const keepalive = setInterval(() => {
        // Best-effort SSE keepalive; if the stream is closed the write will throw and we deliberately ignore
        try { res.write(`:keepalive\n\n`); } catch (err) { console.warn("[BOT] caught:", err instanceof Error ? err.message : err); }
      }, 15000);

      let closed = false;
      res.on("close", () => {
        closed = true;
        clearInterval(keepalive);
      });

      let fullAssistantText = "";
      const operatorContext: OperatorContext = {
        subAccountId,
        // Full execute authority — the user IS the account owner using their own dashboard.
        // When they ask the chatbot to do something, that IS the confirmation.
        // Tools that need a deliberate second-step (bulk messaging, ad spend, deletions) still
        // route through proposeAction explicitly per the system prompt.
        autonomyLevel: "execute",
        sessionId: `agent-${sessionId}`,
        correlationId: `agent-${Date.now()}`,
      };

      const toolCallSignatures: string[] = [];
      const toolCallNames: string[] = [];
      const REPEAT_THRESHOLD = 3;
      const NAME_REPEAT_THRESHOLD = 4;
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (closed) break;

        let aiResponse = await aiChatWithToolCalls(chatMessages, OPENAI_TOOL_SCHEMAS, {
          temperature: 0.7,
          maxTokens: 16384,
          route: "bot-agent-stream",
          timeoutMs: 30000,
        });
        console.log(`[AGENT] round=${round} text_len=${(aiResponse.text || "").length} toolCalls=${aiResponse.toolCalls?.length || 0}${aiResponse.toolCalls?.length ? " names=" + aiResponse.toolCalls.map(tc => tc.name).join(",") : ""}`);

        // Auto-repair: if OpenAI rejects history due to dangling assistant tool_calls,
        // strip every prior assistant tool_calls + tool messages from chatMessages and retry once.
        if (
          !aiResponse.ok &&
          typeof aiResponse.errorMessage === "string" &&
          /tool_calls.*must be followed by tool messages/i.test(aiResponse.errorMessage)
        ) {
          console.warn("[AGENT] Detected dangling tool_calls in history — repairing and retrying");
          for (let i = chatMessages.length - 1; i >= 0; i--) {
            const m = chatMessages[i] as any;
            if (m.role === "tool") {
              chatMessages.splice(i, 1);
            } else if (m.role === "assistant" && m.tool_calls) {
              if (m.content && typeof m.content === "string" && m.content.trim()) {
                delete m.tool_calls;
              } else {
                chatMessages.splice(i, 1);
              }
            }
          }
          aiResponse = await aiChatWithToolCalls(chatMessages, OPENAI_TOOL_SCHEMAS, {
            temperature: 0.7,
            maxTokens: 16384,
            route: "bot-agent-stream-repair",
            timeoutMs: 30000,
          });
        }

        // If the AI gateway returned an error (ok=false), surface a friendly message
        // instead of leaking the raw error and DO NOT persist it to history.
        if (!aiResponse.ok) {
          console.error(`[AGENT] AI gateway returned error: ${aiResponse.errorMessage}`);
          const friendly = "Sorry — I had trouble responding just now. Please try sending that again.";
          if (!closed) sendSSEData(res, { content: friendly });
          fullAssistantText += friendly;
          break;
        }

        if (aiResponse.text && !closed) {
          fullAssistantText += aiResponse.text;
          sendSSEData(res, { content: aiResponse.text });
        }

        if (!aiResponse.toolCalls || aiResponse.toolCalls.length === 0) {
          chatMessages.push({ role: "assistant", content: aiResponse.text || "" });
          try {
            await storage.createAgentMessage({ sessionId, role: "assistant", content: aiResponse.text || "" });
          } catch (err) {
            console.error("[BOT] failed to persist assistant chat message:", err);
          }
          break;
        }

        // Detect tool-call loops: break if the same (name+args) repeats
        // REPEAT_THRESHOLD times in a row, OR the same tool NAME repeats
        // NAME_REPEAT_THRESHOLD times in a row (catches the "model keeps
        // calling createWorkflow with slightly different args" failure mode).
        for (const tc of aiResponse.toolCalls) {
          toolCallSignatures.push(`${tc.name}:${tc.arguments}`);
          toolCallNames.push(tc.name);
        }
        const sigTail = toolCallSignatures.slice(-REPEAT_THRESHOLD);
        const exactLoop = sigTail.length === REPEAT_THRESHOLD && sigTail.every(s => s === sigTail[0]);
        const nameTail = toolCallNames.slice(-NAME_REPEAT_THRESHOLD);
        const nameLoop = nameTail.length === NAME_REPEAT_THRESHOLD && nameTail.every(n => n === nameTail[0]);
        if (exactLoop || nameLoop) {
          const offender = exactLoop ? sigTail[0].slice(0, 80) : `${nameTail[0]} (×${NAME_REPEAT_THRESHOLD})`;
          console.warn(`[AGENT] Tool-call loop detected — ${offender} — breaking out`);
          const stuck = "I went in circles trying to handle that. Could you rephrase what you'd like me to do, or give me one more detail so I can take a different approach?";
          if (!closed) sendSSEData(res, { content: stuck });
          fullAssistantText += stuck;
          try {
            await storage.createAgentMessage({ sessionId, role: "assistant", content: stuck });
          } catch (err) {
            console.error("[BOT] failed to persist tool-loop break message:", err);
          }
          break;
        }

        const toolCallsPayload = aiResponse.toolCalls.map(tc => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        }));

        chatMessages.push({
          role: "assistant",
          content: aiResponse.text || null,
          tool_calls: toolCallsPayload,
        });

        try {
          await storage.createAgentMessage({
            sessionId,
            role: "assistant",
            content: aiResponse.text || null,
            toolCalls: toolCallsPayload,
          });
        } catch (err) {
          console.error("[BOT] failed to persist assistant tool-call message:", err);
        }

        for (const toolCall of aiResponse.toolCalls) {
          if (closed) break;

          let params: Record<string, any>;
          try {
            params = JSON.parse(toolCall.arguments);
          } catch (err) {
            console.warn("[BOT] caught:", err instanceof Error ? err.message : err);
            // Intentional: model returned malformed JSON args; we surface the failure as a tool result so the model can self-correct
            const errorResult = JSON.stringify({ success: false, error: "Invalid tool call arguments" });
            chatMessages.push({ role: "tool", content: errorResult, tool_call_id: toolCall.id, name: toolCall.name });
            continue;
          }

          if (toolCall.name === "navigateUser") {
            const navNonce = `nav-${toolCall.id}`;
            sendSSEData(res, { type: "step", stepId: "navigateUser", status: "running", label: `Navigating to ${params.route}...` });
            sendSSEData(res, { type: "navigation", route: params.route, entityId: params.entityId, nonce: navNonce, sessionId });

            const navAcked = await new Promise<boolean>((resolve) => {
              pendingNavAcks.set(navNonce, { resolve });
              setTimeout(() => {
                if (pendingNavAcks.has(navNonce)) {
                  pendingNavAcks.delete(navNonce);
                  resolve(false);
                }
              }, 3000);
            });
            pendingNavAcks.delete(navNonce);

            const navResult = JSON.stringify({
              success: true,
              verified: navAcked,
              data: {
                route: params.route,
                entityId: params.entityId,
                note: navAcked
                  ? "Navigation confirmed by the frontend. The user is now viewing the requested page."
                  : "Navigation event was sent but could not be confirmed. The user may not have navigated successfully.",
              },
            });
            chatMessages.push({ role: "tool", content: navResult, tool_call_id: toolCall.id, name: toolCall.name });
            sendSSEData(res, { type: "step", stepId: "navigateUser", status: "complete", label: navAcked ? "Navigation confirmed" : "Navigation sent (unverified)" });

            try {
              await storage.createAgentMessage({ sessionId, role: "tool", content: navResult, toolResults: { tool_call_id: toolCall.id, name: toolCall.name } });
            } catch (err) {
              console.error("[BOT] failed to persist navigation tool result:", err);
            }
            continue;
          }

          if (toolCall.name === "proposeAction") {
            try {
              const expiresAt = new Date(Date.now() + PENDING_ACTION_TTL_MS);
              await storage.createPendingAction({
                sessionId,
                subAccountId,
                toolName: params.toolName,
                toolArgs: params.toolArgs,
                summary: params.summary,
                status: "awaiting_confirmation",
                expiresAt,
              });
              const proposeResult = JSON.stringify({ success: true, message: `Pending action registered: "${params.summary}". User can confirm with "ok"/"confirm" or reject with "cancel"/"no".` });
              chatMessages.push({ role: "tool", content: proposeResult, tool_call_id: toolCall.id, name: toolCall.name });
            } catch (propErr: any) {
              const proposeResult = JSON.stringify({ success: false, error: propErr.message || "Failed to register pending action" });
              chatMessages.push({ role: "tool", content: proposeResult, tool_call_id: toolCall.id, name: toolCall.name });
            }
            continue;
          }

          if (!PHASE1_TOOLS.has(toolCall.name)) {
            const errorResult = JSON.stringify({ success: false, error: `Tool "${toolCall.name}" is not available in Phase 1. Available tools: ${Array.from(PHASE1_TOOLS).join(", ")}` });
            chatMessages.push({ role: "tool", content: errorResult, tool_call_id: toolCall.id, name: toolCall.name });
            continue;
          }

          const tool = getTool(toolCall.name);
          if (!tool) {
            const errorResult = JSON.stringify({ success: false, error: `Unknown tool: ${toolCall.name}` });
            chatMessages.push({ role: "tool", content: errorResult, tool_call_id: toolCall.id, name: toolCall.name });
            continue;
          }

          if (tool.requiresApproval) {
            const aKey = approvalKey(sessionId, toolCall.id);
            sendSSEData(res, {
              type: "approval_required",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              params,
              description: `Approve action: ${tool.description}. Parameters: ${JSON.stringify(params)}`,
              sessionId,
            });

            const approvalResult = await new Promise<boolean>((resolve) => {
              pendingApprovals.set(aKey, { resolve });
              setTimeout(() => {
                if (pendingApprovals.has(aKey)) {
                  pendingApprovals.delete(aKey);
                  resolve(false);
                }
              }, 120000);
            });

            pendingApprovals.delete(aKey);

            if (!approvalResult) {
              const rejectionResult = JSON.stringify({ success: false, error: "User rejected this action. Adapt your response — suggest an alternative or explain what you would have done." });
              chatMessages.push({ role: "tool", content: rejectionResult, tool_call_id: toolCall.id, name: toolCall.name });
              sendSSEData(res, { type: "step", stepId: toolCall.name, status: "complete", label: `${toolCall.name} — rejected by user` });
              continue;
            }
          }

          const friendlyLabels: Record<string, string> = {
            detectMissingSetup: "Scanning your account...",
            checkIntegrationHealth: "Checking your connections...",
            getAccountSummary: "Pulling up your account...",
            generateAccountSetupPlan: "Building your setup plan...",
            diagnoseWorkflow: "Diagnosing workflow...",
            searchContacts: "Searching contacts...",
            searchWorkflows: "Searching workflows...",
            createWorkflow: "Creating workflow...",
            generateAutoResponseWorkflow: "Setting up auto-responses...",
            generateReactivationWorkflow: "Building reactivation campaign...",
            createPipeline: "Setting up your sales funnel...",
            createPipelineStage: "Adding funnel stage...",
            restoreBrokenIntegrationDraft: "Fixing integration...",
            navigateUser: "Taking you there...",
          };
          sendSSEData(res, { type: "step", stepId: toolCall.name, status: "running", label: friendlyLabels[toolCall.name] || `Working on it...` });

          const execContext = tool.requiresApproval
            ? { ...operatorContext, autonomyLevel: "execute" as const }
            : operatorContext;

          let result: any;
          const toolStartMs = Date.now();
          try {
            result = await executeTool(toolCall.name, params, execContext);
          } catch (toolError: any) {
            result = { success: false, error: toolError.message || "Tool execution failed" };
          }
          emitOperatorToolExecution(subAccountId, toolCall.name, !!result?.success, Date.now() - toolStartMs, {
            sessionId,
            hasData: !!result?.data,
          });

          const doneLabels: Record<string, string> = {
            detectMissingSetup: "Scan complete",
            checkIntegrationHealth: "Health check done",
            getAccountSummary: "Summary ready",
            generateAccountSetupPlan: "Plan ready",
            createWorkflow: "Workflow created",
            generateAutoResponseWorkflow: "Auto-responses ready",
            generateReactivationWorkflow: "Reactivation campaign ready",
            createPipeline: "Sales funnel created",
            createPipelineStage: "Stage added",
          };
          sendSSEData(res, { type: "step", stepId: toolCall.name, status: "complete", label: doneLabels[toolCall.name] || "Done" });
          sendSSEData(res, { type: "result", toolName: toolCall.name, result });

          const resultJson = JSON.stringify(result);
          chatMessages.push({ role: "tool", content: resultJson, tool_call_id: toolCall.id, name: toolCall.name });

          try {
            await storage.createAgentMessage({
              sessionId,
              role: "tool",
              content: resultJson,
              toolResults: { tool_call_id: toolCall.id, name: toolCall.name },
            });
          } catch (err) {
            console.error("[BOT] failed to persist tool result message:", err);
          }
        }
      }

      if (!closed) {
        sendSSEData(res, { done: true, fullText: fullAssistantText, sessionId });
        res.end();
      }

      if (fullAssistantText) {
        emitOperatorConversation(subAccountId, "outbound", fullAssistantText, { sessionId });
      }

      clearInterval(keepalive);
      await logUsageInternal(null, "AI_CHAT", 1, "Agent agentic loop (Phase 1)");
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Streaming failed" });
      } else {
        sendSSEData(res, { error: error.message || "Streaming failed" });
        res.end();
      }
    }
  }));

  const approvalBodySchema = z.object({
    sessionId: z.string().uuid(),
    toolCallId: z.string().min(1),
    approved: z.boolean(),
  });

  app.post("/api/bot/chat/agent-stream/approve", asyncHandler(async (req, res) => {
    const parsed = approvalBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const aKey = approvalKey(parsed.data.sessionId, parsed.data.toolCallId);
    const pending = pendingApprovals.get(aKey);
    if (pending) {
      pending.resolve(parsed.data.approved);
      pendingApprovals.delete(aKey);
      res.json({ acknowledged: true, approved: parsed.data.approved });
    } else {
      res.status(404).json({ error: "No pending approval found for this tool call" });
    }
  }));

  const navAckBodySchema = z.object({
    nonce: z.string().min(1),
  });

  app.post("/api/bot/chat/agent-stream/nav-ack", asyncHandler(async (req, res) => {
    const parsed = navAckBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const pending = pendingNavAcks.get(parsed.data.nonce);
    if (pending) {
      pending.resolve(true);
      pendingNavAcks.delete(parsed.data.nonce);
      res.json({ acknowledged: true });
    } else {
      res.status(404).json({ error: "No pending navigation ack found" });
    }
  }));

  // ---- Bot Training Jobs ----
  const trainBodySchema = z.object({
    url: z.string().url("A valid URL is required"),
    persona: z.string().min(1, "persona is required"),
  });

  app.post("/api/bots/train", subscriptionGuard, asyncHandler(async (req, res) => {
    const parsed = trainBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const job = await storage.createTrainingJob(parsed.data);

    runRealTraining(job.id);

    res.status(201).json({ jobId: job.id });
  }));

  app.get("/api/jobs/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const job = await storage.getTrainingJob(id);
    if (!job) return res.status(404).json({ error: "Not found" });
    res.json({
      state: job.state,
      progress: job.progress,
      logs: job.logs,
      generatedPersona: job.generatedPersona || null,
      jobId: job.id,
    });
  }));
}

export async function runRealTraining(jobId: number) {
  const allLogs: string[] = [];

  async function updateJob(log: string, progress: number, extras: Record<string, any> = {}) {
    allLogs.push(log);
    await storage.updateTrainingJob(jobId, {
      logs: [...allLogs],
      progress,
      state: progress >= 100 ? "completed" : "processing",
      ...extras,
    });
  }

  try {
    const job = await storage.getTrainingJob(jobId);
    if (!job) return;

    await updateJob("Starting web scraper...", 10);

    const cheerio = await import("cheerio");

    const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

    const fetchPage = async (pageUrl: string, timeoutMs = 15000): Promise<string | null> => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        const r = await fetch(pageUrl, {
          signal: ctrl.signal,
          headers: { "User-Agent": BROWSER_UA, "Accept": "text/html,application/xhtml+xml,*/*" },
          redirect: "follow",
        });
        clearTimeout(t);
        if (!r.ok) return null;
        return await r.text();
      } catch (err) {
        console.warn("[BOT] caught:", err instanceof Error ? err.message : err);
        // Best-effort fetch for the web scraper; timeouts/network errors return null so the crawl can continue
        return null;
      }
    };

    const extractFromHtml = (html: string): { text: string; links: string[] } => {
      const $ = cheerio.load(html);
      $("script:not([type='application/ld+json']), style, noscript, iframe, svg").remove();

      const parts: string[] = [];
      const title = $("title").first().text().trim();
      if (title) parts.push(`PAGE TITLE: ${title}`);

      const metaDesc = $('meta[name="description"]').attr("content")?.trim()
        || $('meta[property="og:description"]').attr("content")?.trim();
      if (metaDesc) parts.push(`DESCRIPTION: ${metaDesc}`);

      const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
      if (ogTitle && ogTitle !== title) parts.push(`OG TITLE: ${ogTitle}`);

      $('script[type="application/ld+json"]').each((_: any, el: any) => {
        try {
          const data = JSON.parse($(el).text());
          const flat = JSON.stringify(data).replace(/[{}\[\]"]/g, " ").replace(/\s+/g, " ").trim();
          if (flat.length > 20 && flat.length < 8000) parts.push(`STRUCTURED DATA: ${flat}`);
        } catch (err) { console.warn("[BOT] caught:", err instanceof Error ? err.message : err); /* ignore */; }
      });

      $("h1, h2, h3, h4, h5, p, li, td, th, blockquote, dt, dd, figcaption").each((_: any, el: any) => {
        const t = $(el).clone().children().remove().end().text().trim().replace(/\s+/g, " ");
        if (t && t.length > 8 && t.length < 4000) parts.push(t);
      });

      $("img[alt]").each((_: any, el: any) => {
        const alt = ($(el).attr("alt") || "").trim();
        if (alt.length > 8 && alt.length < 300) parts.push(`IMAGE: ${alt}`);
      });

      const text = Array.from(new Set(parts)).join("\n");

      const links: string[] = [];
      $("a[href]").each((_: any, el: any) => {
        const href = $(el).attr("href");
        if (href) links.push(href);
      });

      return { text, links };
    };

    const baseUrl = (() => { try { return new URL(job.url); } catch (err) { console.warn("[BOT] caught:", err instanceof Error ? err.message : err); return null; } })();
    if (!baseUrl) {
      await storage.updateTrainingJob(jobId, { logs: [...allLogs, `Invalid URL: ${job.url}`], state: "failed", progress: 0 });
      return;
    }

    let scrapedText = "";
    const visited = new Set<string>();
    const homepageHtml = await fetchPage(job.url);
    if (!homepageHtml) {
      await storage.updateTrainingJob(jobId, {
        logs: [...allLogs, `Could not fetch ${job.url}. The site may be down, blocking bots, or behind authentication.`],
        state: "failed",
        progress: 0,
      });
      return;
    }
    await updateJob(`Fetched homepage (${homepageHtml.length.toLocaleString()} bytes)`, 20);
    visited.add(job.url);

    const home = extractFromHtml(homepageHtml);
    scrapedText = home.text;
    await updateJob(`Homepage extracted: ${home.text.length.toLocaleString()} chars`, 30);

    const sameOriginCandidates = new Set<string>();
    for (const href of home.links) {
      try {
        const u = new URL(href, baseUrl);
        if (u.origin !== baseUrl.origin) continue;
        if (u.pathname === "/" || u.pathname === baseUrl.pathname) continue;
        if (/\.(png|jpe?g|gif|webp|svg|pdf|zip|mp4|mp3|css|js|ico|woff2?)(\?|$)/i.test(u.pathname)) continue;
        u.hash = "";
        sameOriginCandidates.add(u.toString());
      } catch (err) { console.warn("[BOT] caught:", err instanceof Error ? err.message : err); /* ignore */; }
    }

    const sitemapHtml = await fetchPage(new URL("/sitemap.xml", baseUrl).toString(), 8000);
    if (sitemapHtml) {
      const matches = sitemapHtml.match(/<loc>([^<]+)<\/loc>/g) || [];
      for (const m of matches.slice(0, 30)) {
        const u = m.replace(/<\/?loc>/g, "").trim();
        if (u.startsWith(baseUrl.origin)) sameOriginCandidates.add(u);
      }
    }

    const PRIORITY = /\/(about|services|pricing|menu|products|contact|faq|book|booking|membership|plans|team|locations?)\b/i;
    const ranked = Array.from(sameOriginCandidates)
      .sort((a, b) => (PRIORITY.test(b) ? 1 : 0) - (PRIORITY.test(a) ? 1 : 0))
      .slice(0, 6);

    let pageProgress = 35;
    const progressStep = 25 / Math.max(1, ranked.length);
    for (const link of ranked) {
      if (visited.has(link)) continue;
      visited.add(link);
      const html = await fetchPage(link, 10000);
      if (!html) continue;
      const { text } = extractFromHtml(html);
      if (text.length > 50) {
        scrapedText += `\n\n=== PAGE: ${link} ===\n${text}`;
        pageProgress += progressStep;
        await updateJob(`Crawled ${link} (+${text.length.toLocaleString()} chars)`, Math.round(pageProgress));
      }
    }

    if (scrapedText.length < 200) {
      await updateJob(`Static scrape thin (${scrapedText.length} chars). Trying headless browser...`, 50);
      try {
        const puppeteer = (await import("puppeteer")).default;
        const browser = await puppeteer.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
        try {
          const page = await browser.newPage();
          await page.setUserAgent(BROWSER_UA);
          await page.goto(job.url, { waitUntil: "networkidle2", timeout: 25000 });
          const renderedHtml = await page.content();
          const { text } = extractFromHtml(renderedHtml);
          if (text.length > scrapedText.length) {
            scrapedText = text;
            await updateJob(`Headless render extracted ${text.length.toLocaleString()} chars`, 60);
          }
        } finally {
          await browser.close().catch(() => {});
        }
      } catch (puppErr: any) {
        await updateJob(`Headless browser unavailable (${puppErr.message?.slice(0, 80) || "unknown"}). Continuing with static content only.`, 55);
      }
    }

    scrapedText = scrapedText.substring(0, 50000);
    await updateJob(`Final knowledge base: ${scrapedText.length.toLocaleString()} characters from ${visited.size} page(s)`, 65);

    if (scrapedText.length < 100) {
      await storage.updateTrainingJob(jobId, {
        logs: [
          ...allLogs,
          `TRAINING FAILED: Only ${scrapedText.length} characters of readable content found across ${visited.size} page(s).`,
          `This usually means: (a) the site renders entirely with JavaScript and the headless browser couldn't be used here, (b) the site blocks bots, or (c) the homepage has no real text content.`,
          `Suggestion: Try a deeper URL like ${baseUrl.origin}/about or paste your knowledge directly into the persona below.`,
        ],
        state: "failed",
        progress: 0,
        scrapedContent: scrapedText,
      });
      return;
    }

    const chunkSize = 1000;
    const overlap = 200;
    const chunks: string[] = [];
    for (let i = 0; i < scrapedText.length; i += chunkSize - overlap) {
      chunks.push(scrapedText.substring(i, i + chunkSize));
    }
    await updateJob(`Split into ${chunks.length} knowledge chunks (${chunkSize} chars, ${overlap} overlap)`, 70);

    let generatedPersona: string | null = null;
    if (isAIConfigured() && scrapedText.length > 100) {
      try {
        await updateJob("Generating AI persona from scraped content...", 70);
        const personaPrompt = `Based on the following website content, generate a concise AI assistant persona/system prompt. The persona should:
1. Identify the business name, industry, and key services
2. Define a friendly, knowledgeable tone appropriate for the business
3. List specific topics the assistant can help with based on the content
4. Include instructions to guide conversations toward booking/contact

Website content (first 8000 chars):
${scrapedText.substring(0, 8000)}

Original persona template:
${job.persona}

Generate ONLY the system prompt text, no explanations:`;

        const personaAiResult = await aiChat(
          [{ role: "user", content: personaPrompt }],
          { temperature: 0.5, maxTokens: 1024, route: "bot-train-persona" }
        );

        if (personaAiResult.text && personaAiResult.text.length > 20) {
          generatedPersona = personaAiResult.text;
          await updateJob("AI persona generated successfully", 85);
        }
      } catch (aiErr: any) {
        await updateJob(`Persona generation note: ${aiErr.message}. Using original persona.`, 80);
      }
    } else {
      await updateJob("Skipping AI persona generation (no AI configured or insufficient content)", 85);
    }

    await updateJob("Saving knowledge base to database...", 90);
    await storage.updateTrainingJob(jobId, {
      scrapedContent: scrapedText,
      generatedPersona: generatedPersona,
    });

    await updateJob("Training Complete. Bot is ready.", 100, {
      scrapedContent: scrapedText,
      generatedPersona: generatedPersona,
    });
  } catch (err: any) {
    allLogs.push(`Training failed: ${err.message}`);
    await storage.updateTrainingJob(jobId, {
      logs: [...allLogs],
      state: "failed",
      progress: 0,
    });
  }
}
