import { aiChat, isAIConfigured } from "../aiGateway";
import { db } from "../db";
import { agentTasks, agentBriefings } from "@shared/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { buildContext } from "./contextBuilder";
import { buildPromptContext } from "./contextBuilder";
import { calculateHealthScore, generateGrowthReport } from "./strategicAdvisor";
import { getToolManifest } from "./toolRegistry";
import { recordDecisionMemory, recordOutcomeMemory } from "./episodicMemory";
import type { ContextPacket } from "./cognitiveTypes";

const AI_TASK_SYSTEM_PROMPT = `You are the Apex Autonomous Agent Brain — an elite AI system that monitors business accounts 24/7 and makes intelligent decisions about what actions to take.

You also monitor workflow performance metrics and can suggest optimizations:
- Identify workflows with high drop-off rates and suggest timing adjustments
- Flag steps with low response rates and recommend messaging changes
- Recommend auto-optimization for workflows that have sufficient execution data

You analyze account data, identify problems and opportunities, and decide which tasks to execute using the available tools. You think like a business operations expert combined with a growth hacker.

DECISION FRAMEWORK:
1. CRITICAL (Priority 90-100): Account is broken or losing money RIGHT NOW
   - Messaging failures above 15%
   - Unanswered inbound leads going cold
   - Integrations disconnected
   - All automations stopped

2. HIGH (Priority 70-89): Major growth opportunity being missed
   - Zero automations with existing contacts
   - No landing page exists
   - No follow-up sequences active

3. MEDIUM (Priority 40-69): Optimization opportunities
   - Could add more automation steps
   - Landing page needs refresh
   - Pipeline stages need tuning

4. LOW (Priority 20-39): Routine maintenance
   - Health check scan
   - Nudge generation
   - Performance snapshot

OUTCOME LEARNING:
You will be given the history of past tasks and their outcomes (success/failure). Use this to:
- Avoid repeating tasks that failed recently (wait at least 24h before retrying similar tasks)
- Prioritize task types that have historically succeeded
- Adapt your approach based on what worked

EPISODIC MEMORY:
You have access to a persistent memory system that stores past decisions, outcomes, user preferences, and observations.
When "Past Experiences" are provided in the account state, you MUST:
- Reference relevant past experiences when making new recommendations (e.g., "Based on your last campaign, I suggest...")
- Avoid strategies that led to poor outcomes in the past
- Leverage learned user preferences for timing, channels, and communication style
- Weight decisions that previously succeeded higher in your reasoning
- Explicitly cite which past experience informed each task suggestion in your reasoning field

RESPONSE FORMAT (JSON array):
[
  {
    "taskType": "unique_snake_case_type",
    "title": "Short human-readable title",
    "description": "2-3 sentence explanation of WHY this task matters and what it will do",
    "priority": 85,
    "urgent": false,
    "toolName": "toolRegistryName or null",
    "toolParams": { ... } or {},
    "reasoning": "1 sentence on why you chose this task and priority level"
  }
]

URGENCY FLAG:
- Set "urgent": true ONLY for time-sensitive situations requiring immediate human attention
- Examples: messaging system down, payment processing failing, integrations suddenly disconnected, active campaign burning budget with zero conversions
- Urgent tasks trigger immediate push notifications and SMS alerts to the business owner
- Do NOT mark routine maintenance or optimization tasks as urgent

INDUSTRY BENCHMARKS:
When cross-account benchmark data is provided, use it to make industry-aware suggestions:
- Compare the account's metrics against industry averages and top performers (p75/p90)
- Reference specific benchmark numbers in your recommendations (e.g., "Dental practices on Apex average a 35% response rate — yours is at 12%")
- Suggest best practices from top-performing accounts in the same industry
- Use benchmark data to prioritize which areas need the most improvement
- Never reveal specific account data — only reference anonymized aggregate statistics

RULES:
- Return 1-5 tasks maximum per scan
- Never suggest tasks that duplicate recent successful tasks (within 24h)
- Never suggest tasks that failed within the last 6 hours
- Always include your reasoning for each task
- If the account is healthy and well-configured, return an empty array [] — don't create busywork
- Priority must reflect genuine urgency, not just "something to do"
- Be SPECIFIC in descriptions — use real numbers from the account data`;

interface AITaskSuggestion {
  taskType: string;
  title: string;
  description: string;
  priority: number;
  urgent?: boolean;
  toolName?: string;
  toolParams?: Record<string, any>;
  reasoning: string;
}

export async function generateAITaskPlan(
  subAccountId: number,
  context: ContextPacket
): Promise<AITaskSuggestion[]> {
  if (!isAIConfigured()) {
    console.log(`[AGENT-BRAIN] Skipping AI task plan for account #${subAccountId} — AI not configured`);
    return [];
  }

  try {
    const recentTasks = await db.select().from(agentTasks)
      .where(and(
        eq(agentTasks.subAccountId, subAccountId),
        gte(agentTasks.createdAt, new Date(Date.now() - 48 * 60 * 60 * 1000))
      ))
      .orderBy(desc(agentTasks.createdAt))
      .limit(30)
      .execute();

    const outcomeHistory = recentTasks.map(t => ({
      type: t.taskType,
      title: t.title,
      status: t.status,
      priority: t.priority,
      tool: t.toolUsed,
      error: t.error?.substring(0, 100),
      hoursAgo: Math.round((Date.now() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60)),
    }));

    const successRate = recentTasks.length > 0
      ? Math.round((recentTasks.filter(t => t.status === "completed").length / recentTasks.length) * 100)
      : 0;

    const healthScore = await calculateHealthScore(context);
    const promptContext = buildPromptContext(context);
    const tools = getToolManifest();
    const toolNames = tools.map(t => `${t.name}: ${t.description}`).join("\n");

    const userPrompt = `ACCOUNT STATE:
${promptContext}

HEALTH SCORE: ${healthScore.overall}/100 (Grade: ${healthScore.grade})
${Object.entries(healthScore.categories).map(([k, v]) => `  ${v.label}: ${v.score}/100 — ${v.detail}`).join("\n")}

RECENT TASK HISTORY (last 48h):
${outcomeHistory.length === 0 ? "No recent tasks" : outcomeHistory.map(t =>
  `  [${t.status.toUpperCase()}] ${t.title} (P${t.priority}) ${t.hoursAgo}h ago${t.error ? ` — Error: ${t.error}` : ""}`
).join("\n")}
Success rate: ${successRate}%

AVAILABLE TOOLS:
${toolNames}

Based on this data, what tasks should the autonomous agent execute? Return a JSON array of task suggestions. If the account is in good shape, return [].`;

    const taskPlanAiResult = await aiChat([
      { role: "system", content: AI_TASK_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ], {
      temperature: 0.3,
      maxTokens: 2048,
      jsonMode: true,
      route: "agent-brain-task-plan",
      timeoutMs: 30_000,
    });

    let suggestions: AITaskSuggestion[] = [];
    try {
      const normalized = (taskPlanAiResult.text || "").trim();
      if (!normalized) {
        console.error("[AGENT-BRAIN] Empty AI response");
        return [];
      }

      const cleaned = normalized
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```$/i, "")
        .trim();

      let parsed: any;
      try {
        parsed = JSON.parse(cleaned || "[]");
      } catch {
        const lastBrace = cleaned.lastIndexOf("}");
        if (lastBrace > 0) {
          const truncated = cleaned.slice(0, lastBrace + 1) + "]";
          try {
            parsed = JSON.parse(truncated);
            console.warn("[AGENT-BRAIN] Recovered truncated JSON response");
          } catch {
            console.error("[AGENT-BRAIN] Failed to parse AI response (truncated recovery failed)", {
              responseSnippet: cleaned.slice(0, 300),
            });
            return [];
          }
        } else {
          console.error("[AGENT-BRAIN] Failed to parse AI response", {
            responseSnippet: cleaned.slice(0, 300),
          });
          return [];
        }
      }

      suggestions = Array.isArray(parsed)
        ? parsed
        : parsed.tasks || parsed.suggestions || [];
    } catch (err) {
      console.error("[AGENT-BRAIN] Failed to parse AI response", {
        err,
        responseSnippet: (taskPlanAiResult?.text || "").slice(0, 500),
      });
      return [];
    }

    const validated = suggestions
      .filter(s => s.taskType && s.title && typeof s.priority === "number")
      .map(s => ({
        ...s,
        priority: Math.max(1, Math.min(100, s.priority)),
        toolParams: s.toolParams || {},
      }))
      .slice(0, 5);

    for (const task of validated) {
      recordDecisionMemory(
        subAccountId,
        `AI decided to execute "${task.title}" (${task.taskType}) at priority ${task.priority}. Reasoning: ${task.reasoning}`,
        { taskType: task.taskType, priority: task.priority, tool: task.toolName, healthScore: healthScore.overall },
        "agent-brain-scan"
      ).catch(e => console.error("[AGENT-BRAIN] Decision memory recording failed:", e instanceof Error ? e.message : e));
    }

    return validated;

  } catch (err: any) {
    console.error(`[AGENT-BRAIN] AI reasoning error: ${err.message}`);
    return [];
  }
}

export async function generateBriefing(subAccountId: number): Promise<{
  summary: string;
  tasksCompleted: number;
  tasksFailed: number;
  highlights: any[];
} | null> {
  const lastBriefing = await db.select().from(agentBriefings)
    .where(eq(agentBriefings.subAccountId, subAccountId))
    .orderBy(desc(agentBriefings.createdAt))
    .limit(1)
    .execute();

  const periodStart = lastBriefing.length > 0
    ? new Date(lastBriefing[0].periodEnd)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const periodEnd = new Date();

  const tasksSinceLast = await db.select().from(agentTasks)
    .where(and(
      eq(agentTasks.subAccountId, subAccountId),
      gte(agentTasks.createdAt, periodStart),
    ))
    .orderBy(desc(agentTasks.priority))
    .execute();

  if (tasksSinceLast.length === 0) return null;

  const completed = tasksSinceLast.filter(t => t.status === "completed");
  const failed = tasksSinceLast.filter(t => t.status === "failed");

  const highlights = [
    ...completed.slice(0, 5).map(t => ({
      type: "completed" as const,
      title: t.title,
      description: t.description,
      priority: t.priority,
      tool: t.toolUsed,
    })),
    ...failed.slice(0, 3).map(t => ({
      type: "failed" as const,
      title: t.title,
      error: t.error,
      priority: t.priority,
    })),
  ];

  let summary: string;

  if (isAIConfigured() && tasksSinceLast.length > 0) {
    try {
      const context = await buildContext(subAccountId);
      const promptContext = buildPromptContext(context);

      const briefingPrompt = `You are generating a "While You Were Away" briefing for a business owner.

ACCOUNT: ${promptContext}

TASKS COMPLETED BY YOUR AGENT (${completed.length} total):
${completed.map(t => `- ${t.title}: ${t.description || ""}`).join("\n") || "None"}

TASKS FAILED (${failed.length} total):
${failed.map(t => `- ${t.title}: ${t.error || "Unknown error"}`).join("\n") || "None"}

TIME PERIOD: ${periodStart.toLocaleDateString()} to ${periodEnd.toLocaleDateString()}

Write a 3-5 sentence executive briefing. Be direct and specific:
- What your agent accomplished while they were away
- Any issues that need their attention
- One key recommendation

Use confident, professional language. Address them as "your" (your account, your leads, etc).
Do NOT use bullet points or markdown. Write flowing prose.`;

      const briefingAiResult = await aiChat([
        { role: "system", content: "You write concise, impactful executive briefings. No fluff, no filler." },
        { role: "user", content: briefingPrompt },
      ], { temperature: 0.4, maxTokens: 500, route: "agent-brain-briefing" });
      summary = briefingAiResult.text;
    } catch {
      summary = `Your agent completed ${completed.length} task${completed.length !== 1 ? "s" : ""} and encountered ${failed.length} issue${failed.length !== 1 ? "s" : ""} while you were away.`;
    }
  } else {
    summary = `Your agent completed ${completed.length} task${completed.length !== 1 ? "s" : ""} and encountered ${failed.length} issue${failed.length !== 1 ? "s" : ""} while you were away.`;
  }

  const [briefing] = await db.insert(agentBriefings).values({
    subAccountId,
    summary,
    tasksCompleted: completed.length,
    tasksFailed: failed.length,
    highlights,
    periodStart,
    periodEnd,
    seen: false,
  }).returning().execute();

  return {
    summary: briefing.summary,
    tasksCompleted: briefing.tasksCompleted || 0,
    tasksFailed: briefing.tasksFailed || 0,
    highlights,
  };
}

export async function getUnseenBriefings(subAccountId: number): Promise<any[]> {
  return db.select().from(agentBriefings)
    .where(and(
      eq(agentBriefings.subAccountId, subAccountId),
      eq(agentBriefings.seen, false),
    ))
    .orderBy(desc(agentBriefings.createdAt))
    .limit(5)
    .execute();
}

export async function markBriefingSeen(briefingId: number): Promise<void> {
  await db.update(agentBriefings)
    .set({ seen: true })
    .where(eq(agentBriefings.id, briefingId))
    .execute();
}

export async function recordTaskOutcomeAsMemory(
  subAccountId: number,
  task: { taskType: string; title: string; status: string; error?: string | null; toolUsed?: string | null; priority?: number | null }
): Promise<void> {
  try {
    const isSuccess = task.status === "completed";
    await recordOutcomeMemory(
      subAccountId,
      `Task "${task.title}" (${task.taskType})${task.toolUsed ? ` using ${task.toolUsed}` : ""} — ${isSuccess ? "succeeded" : "failed"}${task.error ? `: ${task.error.substring(0, 200)}` : ""}`,
      isSuccess ? "success" : "failed",
      { taskType: task.taskType, tool: task.toolUsed, priority: task.priority },
      "task-completion"
    );
  } catch (err: any) {
    console.error("[AGENT-BRAIN] Outcome memory recording failed:", err.message);
  }
}

export async function getOutcomeStats(subAccountId: number): Promise<{
  totalTasks: number;
  successRate: number;
  avgPriority: number;
  topSuccessTypes: Array<{ type: string; count: number }>;
  topFailureTypes: Array<{ type: string; count: number; lastError: string }>;
  streaks: { currentSuccess: number; longestSuccess: number };
}> {
  const allTasks = await db.select().from(agentTasks)
    .where(eq(agentTasks.subAccountId, subAccountId))
    .orderBy(desc(agentTasks.createdAt))
    .limit(200)
    .execute();

  const completed = allTasks.filter(t => t.status === "completed");
  const failed = allTasks.filter(t => t.status === "failed");

  const typeSuccess = new Map<string, number>();
  const typeFail = new Map<string, { count: number; lastError: string }>();

  for (const t of completed) {
    typeSuccess.set(t.taskType, (typeSuccess.get(t.taskType) || 0) + 1);
  }
  for (const t of failed) {
    const existing = typeFail.get(t.taskType) || { count: 0, lastError: "" };
    typeFail.set(t.taskType, { count: existing.count + 1, lastError: t.error || "" });
  }

  let currentSuccess = 0;
  let longestSuccess = 0;
  let streak = 0;
  for (const t of allTasks) {
    if (t.status === "completed") {
      streak++;
      longestSuccess = Math.max(longestSuccess, streak);
      if (currentSuccess === 0 || currentSuccess === streak - 1) currentSuccess = streak;
    } else if (t.status === "failed") {
      streak = 0;
    }
  }

  return {
    totalTasks: allTasks.length,
    successRate: allTasks.length > 0
      ? Math.round((completed.length / allTasks.length) * 100)
      : 0,
    avgPriority: allTasks.length > 0
      ? Math.round(allTasks.reduce((s, t) => s + (t.priority || 50), 0) / allTasks.length)
      : 0,
    topSuccessTypes: Array.from(typeSuccess.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count })),
    topFailureTypes: Array.from(typeFail.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([type, data]) => ({ type, count: data.count, lastError: data.lastError })),
    streaks: { currentSuccess, longestSuccess },
  };
}
