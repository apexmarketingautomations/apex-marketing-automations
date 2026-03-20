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

export function registerBotRoutes(app: Express) {
  // ---- Bot Chat (Real OpenAI) ----
  const botChatSchema = z.object({
    message: z.string().min(1).max(2000),
    persona: z.string().max(5000).optional(),
    industry: z.string().max(100).optional(),
    language: z.string().max(10).optional(),
    trainingJobId: z.number().optional(),
    conversationHistory: z.array(z.object({
      role: z.string(),
      content: z.string(),
    })).max(20).optional(),
    currentPath: z.string().max(200).optional(),
  });

  const agentChatSchema = botChatSchema.extend({
    subAccountId: z.number().int().positive(),
  });

  app.post("/api/bot/chat", asyncHandler(async (req, res) => {
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
        if (job) {
          if (job.generatedPersona) {
            basePrompt = job.generatedPersona;
          }
          if (job.scrapedContent && job.scrapedContent.length > 50) {
            knowledgeContext = `\n\nYou have the following knowledge base from the business website (${job.url}). Use this information to answer questions accurately:\n\n${job.scrapedContent.substring(0, 12000)}`;
          }
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
    const reply = botChatResult.text || "I'm here to help! Could you tell me more?";

    await logUsageInternal(null, "AI_CHAT", 1, "Bot trainer chat");

    res.json({ reply });
  }));

  app.post("/api/bot/chat/stream", asyncHandler(async (req, res) => {
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

  app.post("/api/bot/chat/advisor-stream", asyncHandler(async (req, res) => {
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
      searchWorkflows: { description: "Search workflows by name or trigger type. Returns matching workflows with IDs.", parameters: { type: "object", properties: { query: { type: "string", description: "Workflow name or trigger type to search for" } }, required: ["query"] } },
      createWorkflow: { description: "Create a new automation workflow from a manifest (status: compiled/draft)", parameters: { type: "object", properties: { name: { type: "string", description: "Workflow name" }, trigger: { type: "string", description: "Trigger event" }, steps: { type: "array", items: { type: "object", properties: { action: { type: "string" }, message: { type: "string" }, duration: { type: "number" }, condition: { type: "string" } }, required: ["action"] }, description: "Workflow steps" } }, required: ["name", "trigger", "steps"] } },
      generateAutoResponseWorkflow: { description: "Generate an auto-response workflow template (status: compiled/draft)", parameters: { type: "object", properties: { trigger: { type: "string", description: "Trigger event" }, responseMessage: { type: "string", description: "Auto-response message body" }, channel: { type: "string", enum: ["sms", "email", "whatsapp"], description: "Communication channel" } }, required: ["trigger", "responseMessage"] } },
      generateReactivationWorkflow: { description: "Generate a reactivation workflow for inactive contacts (status: compiled/draft)", parameters: { type: "object", properties: { inactiveDays: { type: "number", description: "Days of inactivity before triggering" }, message: { type: "string", description: "Reactivation message" }, channel: { type: "string", enum: ["sms", "email"], description: "Communication channel" } }, required: [] } },
      createPipeline: { description: "Create a sales pipeline with stages", parameters: { type: "object", properties: { stages: { type: "array", items: { type: "object", properties: { name: { type: "string" }, color: { type: "string" } }, required: ["name"] }, description: "Pipeline stages" } }, required: ["stages"] } },
      createPipelineStage: { description: "Add an individual pipeline stage", parameters: { type: "object", properties: { name: { type: "string", description: "Stage name" }, color: { type: "string", description: "Stage color" }, position: { type: "number", description: "Stage position" } }, required: ["name"] } },
      restoreBrokenIntegrationDraft: { description: "Generate a recovery plan for a broken integration (requires user approval before execution)", parameters: { type: "object", properties: { provider: { type: "string", description: "Integration provider name (e.g. twilio, google, meta)" } }, required: ["provider"] } },
      navigateUser: { description: "Navigate the user to a specific page or entity view in the platform", parameters: { type: "object", properties: { route: { type: "string", description: "Route path to navigate to (e.g. /contacts, /workflows, /contacts/123)" }, entityId: { type: "number", description: "Optional entity ID to view" } }, required: ["route"] } },
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
  const MAX_TOOL_ROUNDS = 10;

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
            const history: Array<{ role: string; content?: string | null; tool_calls?: any; tool_call_id?: string; name?: string }> = [];
            for (const m of dbMessages.reverse()) {
              if (m.role === "tool" && m.toolResults) {
                history.push({ role: "tool", content: typeof m.content === "string" ? m.content : JSON.stringify(m.toolResults), tool_call_id: (m.toolResults as any)?.tool_call_id || "", name: (m.toolResults as any)?.name || "" });
              } else if (m.role === "assistant" && m.toolCalls) {
                history.push({ role: "assistant", content: m.content || null, tool_calls: m.toolCalls });
              } else {
                history.push({ role: m.role, content: m.content || "" });
              }
            }
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
      if (!isAIConfigured()) {
        return res.status(503).json({ error: "AI service is not configured" });
      }

      const parsed = agentStreamSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const subAccountId = parsed.data.subAccountId;
      const { sessionId, history } = await resolveSession(parsed.data.sessionId, subAccountId);

      const systemPrompt = await buildOperatorSystemPrompt(subAccountId, parsed.data.currentPath, parsed.data.frontendContext);

      const chatMessages: Array<{ role: string; content?: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string }> = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: parsed.data.message },
      ];

      try {
        await storage.createAgentMessage({ sessionId, role: "user", content: parsed.data.message });
      } catch {}

      initSSE(res);
      sendSSEData(res, { type: "session", sessionId });

      const keepalive = setInterval(() => {
        try { res.write(`:keepalive\n\n`); } catch {}
      }, 15000);

      let closed = false;
      res.on("close", () => {
        closed = true;
        clearInterval(keepalive);
      });

      let fullAssistantText = "";
      const operatorContext: OperatorContext = {
        subAccountId,
        autonomyLevel: "draft",
        sessionId: `agent-${sessionId}`,
        correlationId: `agent-${Date.now()}`,
      };

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (closed) break;

        const aiResponse = await aiChatWithToolCalls(chatMessages, OPENAI_TOOL_SCHEMAS, {
          temperature: 0.7,
          maxTokens: 16384,
          route: "bot-agent-stream",
          timeoutMs: 30000,
        });

        if (aiResponse.text && !closed) {
          fullAssistantText += aiResponse.text;
          sendSSEData(res, { content: aiResponse.text });
        }

        if (!aiResponse.toolCalls || aiResponse.toolCalls.length === 0) {
          chatMessages.push({ role: "assistant", content: aiResponse.text || "" });
          try {
            await storage.createAgentMessage({ sessionId, role: "assistant", content: aiResponse.text || "" });
          } catch {}
          break;
        }

        chatMessages.push({
          role: "assistant",
          content: aiResponse.text || null,
          tool_calls: aiResponse.toolCalls.map(tc => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });

        for (const toolCall of aiResponse.toolCalls) {
          if (closed) break;

          let params: Record<string, any>;
          try {
            params = JSON.parse(toolCall.arguments);
          } catch {
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
            } catch {}
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

          sendSSEData(res, { type: "step", stepId: toolCall.name, status: "running", label: `Executing ${tool.name}...` });

          const execContext = tool.requiresApproval
            ? { ...operatorContext, autonomyLevel: "execute" as const }
            : operatorContext;

          let result: any;
          try {
            result = await executeTool(toolCall.name, params, execContext);
          } catch (toolError: any) {
            result = { success: false, error: toolError.message || "Tool execution failed" };
          }

          sendSSEData(res, { type: "step", stepId: toolCall.name, status: "complete", label: `${tool.name} complete` });
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
          } catch {}
        }

        try {
          await storage.createAgentMessage({
            sessionId,
            role: "assistant",
            content: aiResponse.text || null,
            toolCalls: aiResponse.toolCalls.map(tc => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: tc.arguments },
            })),
          });
        } catch {}
      }

      if (!closed) {
        sendSSEData(res, { done: true, fullText: fullAssistantText, sessionId });
        res.end();
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

  app.post("/api/bots/train", asyncHandler(async (req, res) => {
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

    let scrapedText = "";
    try {
      const cheerio = await import("cheerio");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(job.url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ApexBot/1.0)",
          "Accept": "text/html,application/xhtml+xml",
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      await updateJob(`Fetched page (${html.length.toLocaleString()} bytes)`, 25);

      const $ = cheerio.load(html);
      $("script, style, noscript, iframe, nav, footer, header").remove();

      const textParts: string[] = [];
      const title = $("title").text().trim();
      if (title) textParts.push(`Page Title: ${title}`);

      const metaDesc = $('meta[name="description"]').attr("content")?.trim();
      if (metaDesc) textParts.push(`Description: ${metaDesc}`);

      $("h1, h2, h3, h4, p, li, td, th, blockquote, span, div, a").each((_: any, el: any) => {
        const t = $(el).clone().children().remove().end().text().trim();
        if (t && t.length > 10 && t.length < 5000) {
          textParts.push(t);
        }
      });

      scrapedText = Array.from(new Set(textParts)).join("\n").substring(0, 50000);

      await updateJob(`Extracted ${scrapedText.length.toLocaleString()} characters of text content`, 40);
    } catch (scrapeErr: any) {
      await updateJob(`Scrape warning: ${scrapeErr.message}. Continuing with persona only.`, 35);
      scrapedText = `[Could not scrape ${job.url}: ${scrapeErr.message}]`;
    }

    const chunkSize = 1000;
    const overlap = 200;
    const chunks: string[] = [];
    for (let i = 0; i < scrapedText.length; i += chunkSize - overlap) {
      chunks.push(scrapedText.substring(i, i + chunkSize));
    }
    await updateJob(`Split into ${chunks.length} knowledge chunks (${chunkSize} chars, ${overlap} overlap)`, 55);

    let generatedPersona: string | null = null;
    if (isAIConfigured() && scrapedText.length > 50) {
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
