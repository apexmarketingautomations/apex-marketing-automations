import type { Express, Request, Response } from "express";
import { messages } from "@shared/schema";
import { storage } from "../storage";
import { z } from "zod";
import { geminiChat, geminiChatStream, geminiChatWithToolsStream, isGeminiConfigured, geminiGenerateImage } from "../gemini";
import { streamGeminiResponse, sendSSEData, initSSE } from "../streaming";
import { asyncHandler, parseIntParam, logUsageInternal, getIndustryContext, getLanguageInstruction } from "./helpers";
import { executeTool, getTool } from "../operator/toolRegistry";
import type { OperatorContext } from "../operator/types";

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
    if (!isGeminiConfigured()) {
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

    const reply = await geminiChat(messages as any, { temperature: 0.7, maxTokens: 1024 }) || "I'm here to help! Could you tell me more?";

    await logUsageInternal(null, "AI_CHAT", 1, "Bot trainer chat");

    res.json({ reply });
  }));

  app.post("/api/bot/chat/stream", asyncHandler(async (req, res) => {
    try {
      if (!isGeminiConfigured()) {
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

      const stream = geminiChatStream(messages as any, { temperature: 0.7, maxTokens: 1024 });
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
      if (!isGeminiConfigured()) {
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

      await streamGeminiResponse(res, chatMessages, { temperature: 0.7, maxTokens: 16384 });
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

  const AGENT_ALLOWED_TOOLS = new Set([
    "detectMissingSetup",
    "checkIntegrationHealth",
    "getAccountSummary",
    "auditConversionLeaks",
    "auditResponseSpeed",
    "recommendNextBestAction",
    "diagnoseMessaging",
    "compareToIndustryBenchmark",
    "generateAccountSetupPlan",
  ]);

  app.post("/api/bot/chat/agent-stream", asyncHandler(async (req, res) => {
    try {
      if (!isGeminiConfigured()) {
        return res.status(503).json({ error: "AI service is not configured" });
      }

      const parsed = agentChatSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const subAccountId = parsed.data.subAccountId;

      let basePrompt = parsed.data.persona || "You are a helpful AI assistant.";
      
      if (parsed.data.currentPath) {
        basePrompt += `\n\nCurrent user location: ${parsed.data.currentPath}`;
      }
      
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

      initSSE(res);

      const keepalive = setInterval(() => {
        try {
          res.write(`:keepalive\n\n`);
        } catch {}
      }, 15000);

      let fullText = "";
      let textBuffer = "";
      let closed = false;

      res.on("close", () => {
        closed = true;
        clearInterval(keepalive);
      });

      const stream = geminiChatWithToolsStream(chatMessages as any, { temperature: 0.7, maxTokens: 16384 });
      
      function extractBalancedJSON(text: string, startPos: number): { json: string; endPos: number } | null {
        let braceCount = 0;
        let inString = false;
        let escape = false;
        let start = -1;
        
        for (let i = startPos; i < text.length; i++) {
          const char = text[i];
          
          if (escape) {
            escape = false;
            continue;
          }
          
          if (char === '\\') {
            escape = true;
            continue;
          }
          
          if (char === '"') {
            inString = !inString;
            continue;
          }
          
          if (inString) continue;
          
          if (char === '{') {
            if (start === -1) start = i;
            braceCount++;
          } else if (char === '}') {
            braceCount--;
            if (braceCount === 0 && start !== -1) {
              return { json: text.slice(start, i + 1), endPos: i + 1 };
            }
          }
        }
        
        return null;
      }
      
      for await (const chunk of stream) {
        if (closed) break;
        
        if (chunk.type === "text" && chunk.text) {
          textBuffer += chunk.text;
          
          let searchPos = 0;
          while (true) {
            const actionStart = textBuffer.indexOf(":::action", searchPos);
            if (actionStart === -1) {
              if (searchPos > 0) {
                const cleanText = textBuffer.slice(searchPos);
                if (cleanText.length > 0 && !cleanText.includes(":::action")) {
                  fullText += cleanText;
                  sendSSEData(res, { content: cleanText });
                  textBuffer = "";
                } else {
                  textBuffer = cleanText;
                }
              } else {
                const keepTail = Math.min(textBuffer.length, 20);
                if (textBuffer.length > keepTail) {
                  const emitText = textBuffer.slice(0, textBuffer.length - keepTail);
                  fullText += emitText;
                  sendSSEData(res, { content: emitText });
                  textBuffer = textBuffer.slice(-keepTail);
                } else {
                  textBuffer = textBuffer.slice(-keepTail);
                }
              }
              break;
            }
            
            if (actionStart > searchPos) {
              const cleanText = textBuffer.slice(searchPos, actionStart);
              fullText += cleanText;
              sendSSEData(res, { content: cleanText });
            }
            
            const jsonStart = actionStart + ":::action".length;
            const extracted = extractBalancedJSON(textBuffer, jsonStart);
            
            if (!extracted) {
              textBuffer = textBuffer.slice(actionStart);
              break;
            }
            
            const actionEnd = textBuffer.indexOf(":::", extracted.endPos);
            if (actionEnd === -1) {
              textBuffer = textBuffer.slice(actionStart);
              break;
            }
            
            try {
              const action = JSON.parse(extracted.json);
              
              if (action.action === "execute_tool" && action.tool) {
                if (!AGENT_ALLOWED_TOOLS.has(action.tool)) {
                  sendSSEData(res, { type: "error", error: `Tool "${action.tool}" is not allowed for agent execution` });
                  searchPos = actionEnd + 3;
                  continue;
                }
                
                const context: OperatorContext = {
                  subAccountId,
                  autonomyLevel: "draft",
                  sessionId: `agent-${Date.now()}`,
                  correlationId: `agent-${Date.now()}`,
                };
                
                const tool = getTool(action.tool);
                if (tool) {
                  sendSSEData(res, { type: "step", stepId: action.tool, status: "running", label: `Executing ${tool.name}...` });
                  
                  const result = await executeTool(action.tool, action.params || {}, context);
                  
                  sendSSEData(res, { type: "step", stepId: action.tool, status: "complete", label: `${tool.name} complete` });
                  sendSSEData(res, { type: "result", toolName: action.tool, result });
                } else {
                  sendSSEData(res, { type: "error", error: `Unknown tool: ${action.tool}` });
                }
              } else {
                sendSSEData(res, { type: "action", ...action });
              }
            } catch (e) {
              console.error("Action parsing error:", e);
            }
            
            searchPos = actionEnd + 3;
          }
        } else if (chunk.type === "search_grounding" && chunk.grounding) {
          sendSSEData(res, { type: "grounding", grounding: chunk.grounding });
        }
      }
      
      if (textBuffer.length > 0 && !textBuffer.includes(":::action")) {
        fullText += textBuffer;
        sendSSEData(res, { content: textBuffer });
      }

      if (!closed) {
        sendSSEData(res, { done: true, fullText });
        res.end();
      }

      clearInterval(keepalive);
      await logUsageInternal(null, "AI_CHAT", 1, "Agent chat with tools (stream)");
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Streaming failed" });
      } else {
        sendSSEData(res, { error: error.message || "Streaming failed" });
        res.end();
      }
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
    if (isGeminiConfigured() && scrapedText.length > 50) {
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

        const personaResult = await geminiChat(
          [{ role: "user", content: personaPrompt }],
          { temperature: 0.5, maxTokens: 1024 }
        );

        if (personaResult && personaResult.length > 20) {
          generatedPersona = personaResult;
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
