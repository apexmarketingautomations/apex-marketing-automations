import { db } from "../db";
import { agentTasks, agentConfig, subAccounts } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { buildContext } from "./contextBuilder";
import { generateStrategicInsights, calculateHealthScore } from "./strategicAdvisor";
import { executeTool } from "./toolRegistry";
import { generateNudges } from "./nudgeSystem";
import { publishEventAsync } from "../eventBus";
import { generateAITaskPlan, generateBriefing, recordTaskOutcomeAsMemory } from "./agentBrain";
import { dispatchAlert, generateDeepLink } from "../pushAlertService";
import { isGeminiConfigured, isGeminiAvailable } from "../gemini";
import { advanceGoalsForAccount } from "./goalEngine";
import type { ContextPacket } from "./cognitiveTypes";

const SCAN_INTERVAL_MS = 60_000;
const DEFAULT_MAX_TASKS_PER_DAY = 10;
const ALLOWED_CONFIG_FIELDS = new Set(["enabled", "autonomyLevel", "scanIntervalMinutes", "maxTasksPerDay"]);

let scanTimer: ReturnType<typeof setInterval> | null = null;
let isScanning = false;

interface TaskDefinition {
  taskType: string;
  title: string;
  description: string;
  priority: number;
  urgent?: boolean;
  toolName?: string;
  toolParams?: Record<string, any>;
  condition: (ctx: ContextPacket) => boolean;
}

function getAutoTaskDefinitions(ctx: ContextPacket): TaskDefinition[] {
  const defs: TaskDefinition[] = [];
  const { workspace, performance } = ctx;

  if (!workspace.phoneConfigured && workspace.integrationCount === 0) {
    defs.push({
      taskType: "setup_check",
      title: "Run setup diagnostic",
      description: "Detected that your account has no integrations or phone. Running a setup scan to identify what needs to be connected.",
      priority: 95,
      toolName: "detectMissingSetup",
      toolParams: {},
      condition: () => true,
    });
  }

  if (workspace.automationCount === 0 && workspace.contactCount > 0) {
    defs.push({
      taskType: "create_automation",
      title: "Draft lead auto-response workflow",
      description: `You have ${workspace.contactCount} contacts but no automations. Drafting a lead auto-response workflow so new leads get an immediate reply.`,
      priority: 90,
      toolName: "createWorkflow",
      toolParams: {
        name: "Lead Auto-Response",
        trigger: "new_lead",
        steps: [
          { action: "WAIT", duration: 5, unit: "seconds" },
          { action: "SMS", message: "Hi {{leadName}}, thanks for reaching out! We'll be in touch shortly." },
        ],
      },
      condition: () => true,
    });
  }

  if (workspace.siteCount === 0 && workspace.integrationCount > 0) {
    defs.push({
      taskType: "generate_landing_page",
      title: "Draft landing page",
      description: `No landing page exists yet. Generating a professional landing page for ${workspace.businessName || "your business"} in ${workspace.industry}.`,
      priority: 75,
      toolName: "generateLandingPage",
      toolParams: { prompt: `Professional landing page for ${workspace.businessName || "business"} in ${workspace.industry}` },
      condition: () => true,
    });
  }

  if (performance.failedMessages > 0 && performance.messageCount > 0) {
    const failRate = performance.failedMessages / performance.messageCount;
    if (failRate > 0.15) {
      defs.push({
        taskType: "diagnose_messaging",
        title: "Diagnose messaging failures",
        description: `${Math.round(failRate * 100)}% message failure rate detected. Running integration health check to find the issue.`,
        priority: 92,
        toolName: "checkIntegrationHealth",
        toolParams: {},
        condition: () => true,
      });
    }
  }

  if (performance.inboundMessages > 5 && performance.outboundMessages === 0) {
    defs.push({
      taskType: "alert_unanswered",
      title: "Alert: Unanswered inbound messages",
      description: `${performance.inboundMessages} inbound messages received but zero replies sent. Leads are going cold.`,
      priority: 94,
      condition: () => true,
    });
  }

  if (workspace.contactCount > 100 && workspace.automationCount > 0 && performance.activeAutomations === 0) {
    defs.push({
      taskType: "alert_inactive_automations",
      title: "Alert: All automations are inactive",
      description: `${workspace.automationCount} workflows exist but none are running. ${workspace.contactCount} contacts are not receiving automated follow-up.`,
      priority: 88,
      condition: () => true,
    });
  }

  defs.push({
    taskType: "health_scan",
    title: "Periodic health scan",
    description: "Running routine account health check and generating insights.",
    priority: 30,
    condition: () => true,
  });

  defs.push({
    taskType: "generate_nudges",
    title: "Generate proactive nudges",
    description: "Analyzing account patterns and generating behavioral nudges.",
    priority: 25,
    condition: () => true,
  });

  return defs;
}

async function getOrCreateConfig(subAccountId: number) {
  const existing = await db.select().from(agentConfig)
    .where(eq(agentConfig.subAccountId, subAccountId))
    .limit(1)
    .execute();

  if (existing.length > 0) return existing[0];

  const now = new Date();
  const [created] = await db.insert(agentConfig).values({
    subAccountId,
    enabled: true,
    autonomyLevel: "draft",
    scanIntervalMinutes: 30,
    maxTasksPerDay: DEFAULT_MAX_TASKS_PER_DAY,
    tasksRunToday: 0,
    lastResetAt: now,
    allowedTaskTypes: [],
  }).returning().execute();

  return created;
}

async function hasRecentTask(subAccountId: number, taskType: string, withinHours: number = 24): Promise<boolean> {
  const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000);
  const recent = await db.select().from(agentTasks)
    .where(and(
      eq(agentTasks.subAccountId, subAccountId),
      eq(agentTasks.taskType, taskType),
      sql`${agentTasks.createdAt} > ${cutoff}`,
    ))
    .limit(1)
    .execute();
  return recent.length > 0;
}

async function createTask(subAccountId: number, def: TaskDefinition): Promise<number | null> {
  const alreadyExists = await hasRecentTask(subAccountId, def.taskType, def.taskType === "health_scan" ? 4 : 24);
  if (alreadyExists) return null;

  const [task] = await db.insert(agentTasks).values({
    subAccountId,
    taskType: def.taskType,
    title: def.title,
    description: def.description,
    status: "queued",
    priority: def.priority,
    urgent: def.urgent || false,
    toolUsed: def.toolName || null,
    result: def.toolParams ? { _params: def.toolParams } : null,
    triggeredBy: "autonomous-agent",
    maxAttempts: 3,
  }).returning().execute();

  console.log(`[TASK-AGENT] Created task: ${def.title} (${def.taskType}) for account #${subAccountId}`);

  if (def.urgent) {
    dispatchAlert(subAccountId, "agent_urgent", {
      title: `Urgent: ${def.title}`,
      body: (def.description || "").substring(0, 200),
      link: generateDeepLink("/dashboard"),
      tag: `urgent-task-${task.id}`,
      urgency: "high",
    }).catch(err => console.error("[TASK-AGENT] Urgent push alert failed:", err.message));
  }

  return task.id;
}

async function executeTask(taskId: number): Promise<void> {
  const [task] = await db.select().from(agentTasks)
    .where(eq(agentTasks.id, taskId))
    .execute();

  if (!task || task.status !== "queued") return;

  await db.update(agentTasks)
    .set({ status: "running", startedAt: new Date(), attempts: (task.attempts || 0) + 1 })
    .where(eq(agentTasks.id, taskId))
    .execute();

  console.log(`[TASK-AGENT] Executing: ${task.title} (#${taskId})`);

  try {
    let result: any = {};

    if (task.taskType === "health_scan") {
      const context = await buildContext(task.subAccountId);
      const healthScore = calculateHealthScore(context);
      const insights = generateStrategicInsights(context);
      result = { healthScore, insightCount: insights.length, topInsight: insights[0]?.observation || "No insights" };
    } else if (task.taskType === "generate_nudges") {
      const context = await buildContext(task.subAccountId);
      const nudges = await generateNudges(task.subAccountId, context);
      result = { nudgesGenerated: nudges.length };
    } else if (task.taskType === "alert_unanswered" || task.taskType === "alert_inactive_automations") {
      result = { alert: task.description, acknowledged: true };
    } else if (task.toolUsed) {
      const storedParams = (task.result as any)?._params || {};
      const operatorContext = {
        subAccountId: task.subAccountId,
        userId: "system",
        sessionId: `agent-${taskId}`,
        correlationId: `task-${taskId}-${Date.now()}`,
        autonomyLevel: "draft" as const,
      };
      const toolResult = await executeTool(task.toolUsed, storedParams, operatorContext);
      if (!toolResult.success) {
        throw new Error(toolResult.error || `Tool ${task.toolUsed} returned failure`);
      }
      result = toolResult;
    } else {
      result = { status: "completed", note: "No tool execution needed" };
    }

    await db.update(agentTasks)
      .set({ status: "completed", completedAt: new Date(), result })
      .where(eq(agentTasks.id, taskId))
      .execute();

    console.log(`[TASK-AGENT] Completed: ${task.title} (#${taskId})`);

    try {
      await publishEventAsync("agent.task.completed", {
        taskId,
        taskType: task.taskType,
        subAccountId: task.subAccountId,
        result,
      }, "task-agent");
    } catch (err: any) {
      console.error("[TASK-AGENT] Event publish failed:", err.message);
    }

    recordTaskOutcomeAsMemory(task.subAccountId, {
      taskType: task.taskType,
      title: task.title,
      status: "completed",
      toolUsed: task.toolUsed,
      priority: task.priority,
    }).catch(e => console.error("[TASK-AGENT] Outcome memory failed:", e instanceof Error ? e.message : e));

  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    const shouldRetry = (task.attempts || 0) + 1 < (task.maxAttempts || 3);

    await db.update(agentTasks)
      .set({
        status: shouldRetry ? "queued" : "failed",
        error: errorMsg,
        ...(shouldRetry ? {} : { completedAt: new Date() }),
      })
      .where(eq(agentTasks.id, taskId))
      .execute();

    if (!shouldRetry) {
      recordTaskOutcomeAsMemory(task.subAccountId, {
        taskType: task.taskType,
        title: task.title,
        status: "failed",
        error: errorMsg,
        toolUsed: task.toolUsed,
        priority: task.priority,
      }).catch(e => console.error("[TASK-AGENT] Failure memory failed:", e instanceof Error ? e.message : e));
    }

    console.error(`[TASK-AGENT] ${shouldRetry ? "Retry scheduled" : "Failed"}: ${task.title} — ${errorMsg}`);
  }
}

function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

async function scanAccount(subAccountId: number): Promise<void> {
  const config = await getOrCreateConfig(subAccountId);

  if (!config.enabled) return;

  const now = new Date();

  const lastReset = config.lastResetAt ? new Date(config.lastResetAt) : new Date(0);
  if (!isSameDay(now, lastReset)) {
    await db.update(agentConfig)
      .set({ tasksRunToday: 0, lastResetAt: now })
      .where(eq(agentConfig.id, config.id))
      .execute();
    config.tasksRunToday = 0;
  }

  if ((config.tasksRunToday || 0) >= (config.maxTasksPerDay || DEFAULT_MAX_TASKS_PER_DAY)) {
    return;
  }

  const scanInterval = (config.scanIntervalMinutes || 30) * 60 * 1000;
  if (config.lastScanAt && now.getTime() - new Date(config.lastScanAt).getTime() < scanInterval) {
    return;
  }

  try {
    try {
      const goalResult = await advanceGoalsForAccount(subAccountId);
      if (goalResult.goalsProcessed > 0) {
        console.log(`[TASK-AGENT] Advanced ${goalResult.goalsProcessed} goals for account #${subAccountId} (${goalResult.stepsExecuted} steps executed)`);
      }
    } catch (goalErr: any) {
      console.error(`[TASK-AGENT] Goal advancement error for account #${subAccountId}: ${goalErr.message}`);
    }

    const context = await buildContext(subAccountId);
    let allDefs: TaskDefinition[] = [];

    const ruleDefs = getAutoTaskDefinitions(context);
    allDefs.push(...ruleDefs.filter(d => d.condition(context)));

    if (isGeminiAvailable()) {
      try {
        const aiSuggestions = await generateAITaskPlan(subAccountId, context);
        for (const s of aiSuggestions) {
          allDefs.push({
            taskType: s.taskType,
            title: s.title,
            description: `${s.description}\n\nAI Reasoning: ${s.reasoning}`,
            priority: s.priority,
            urgent: s.urgent || false,
            toolName: s.toolName || undefined,
            toolParams: s.toolParams || {},
            condition: () => true,
          });
        }
        if (aiSuggestions.length > 0) {
          console.log(`[AGENT-BRAIN] AI suggested ${aiSuggestions.length} tasks for account #${subAccountId}`);
        }
      } catch (aiErr: any) {
        console.error(`[AGENT-BRAIN] AI reasoning failed for account #${subAccountId}: ${aiErr.message}`);
      }
    }

    const deduped = new Map<string, TaskDefinition>();
    for (const def of allDefs.sort((a, b) => b.priority - a.priority)) {
      if (!deduped.has(def.taskType)) {
        deduped.set(def.taskType, def);
      }
    }

    let tasksCreated = 0;
    const remaining = (config.maxTasksPerDay || DEFAULT_MAX_TASKS_PER_DAY) - (config.tasksRunToday || 0);

    for (const def of Array.from(deduped.values()).sort((a, b) => b.priority - a.priority)) {
      if (tasksCreated >= remaining) break;

      if (config.allowedTaskTypes && config.allowedTaskTypes.length > 0) {
        if (!config.allowedTaskTypes.includes(def.taskType)) continue;
      }

      const taskId = await createTask(subAccountId, def);
      if (taskId !== null) {
        await executeTask(taskId);
        tasksCreated++;
      }
    }

    await db.update(agentConfig)
      .set({
        lastScanAt: now,
        tasksRunToday: sql`${agentConfig.tasksRunToday} + ${tasksCreated}`,
        updatedAt: now,
      })
      .where(eq(agentConfig.id, config.id))
      .execute();

    if (tasksCreated > 0) {
      console.log(`[TASK-AGENT] Account #${subAccountId}: ${tasksCreated} tasks executed (AI-enhanced)`);

      try {
        await generateBriefing(subAccountId);
      } catch (err: any) {
        console.error(`[TASK-AGENT] Briefing generation failed for account #${subAccountId}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error(`[TASK-AGENT] Scan error for account #${subAccountId}: ${err.message}`);
  }
}

async function runGlobalScan(): Promise<void> {
  if (isScanning) return;
  isScanning = true;

  try {
    const accounts = await db.select({ id: subAccounts.id })
      .from(subAccounts)
      .execute();

    for (const account of accounts) {
      await scanAccount(account.id);
    }
  } catch (err: any) {
    console.error(`[TASK-AGENT] Global scan error: ${err.message}`);
  } finally {
    isScanning = false;
  }
}

export function startTaskAgent(): void {
  console.log("[TASK-AGENT] Autonomous Task Agent started — scanning every 60s");

  setTimeout(() => runGlobalScan(), 10_000);

  scanTimer = setInterval(() => runGlobalScan(), SCAN_INTERVAL_MS);
}

export function stopTaskAgent(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  console.log("[TASK-AGENT] Stopped");
}

export async function manualScan(subAccountId: number): Promise<{ tasksCreated: number }> {
  const config = await getOrCreateConfig(subAccountId);

  const remaining = (config.maxTasksPerDay || DEFAULT_MAX_TASKS_PER_DAY) - (config.tasksRunToday || 0);
  if (remaining <= 0) {
    return { tasksCreated: 0 };
  }

  const context = await buildContext(subAccountId);
  const taskDefs = getAutoTaskDefinitions(context);
  let tasksCreated = 0;

  for (const def of taskDefs.sort((a, b) => b.priority - a.priority)) {
    if (tasksCreated >= remaining) break;
    if (!def.condition(context)) continue;
    const taskId = await createTask(subAccountId, def);
    if (taskId !== null) {
      await executeTask(taskId);
      tasksCreated++;
    }
  }

  await db.update(agentConfig)
    .set({
      lastScanAt: new Date(),
      tasksRunToday: sql`${agentConfig.tasksRunToday} + ${tasksCreated}`,
      updatedAt: new Date(),
    })
    .where(eq(agentConfig.id, config.id))
    .execute();

  return { tasksCreated };
}

export async function getTaskHistory(subAccountId: number, limit = 50): Promise<any[]> {
  return db.select().from(agentTasks)
    .where(eq(agentTasks.subAccountId, subAccountId))
    .orderBy(desc(agentTasks.createdAt))
    .limit(limit)
    .execute();
}

export async function getTaskStats(subAccountId: number): Promise<{
  totalTasks: number;
  completed: number;
  failed: number;
  queued: number;
  running: number;
  todayCount: number;
  config: any;
}> {
  const config = await getOrCreateConfig(subAccountId);
  const allTasks = await db.select().from(agentTasks)
    .where(eq(agentTasks.subAccountId, subAccountId))
    .execute();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTasks = allTasks.filter(t => new Date(t.createdAt) >= today);

  return {
    totalTasks: allTasks.length,
    completed: allTasks.filter(t => t.status === "completed").length,
    failed: allTasks.filter(t => t.status === "failed").length,
    queued: allTasks.filter(t => t.status === "queued").length,
    running: allTasks.filter(t => t.status === "running").length,
    todayCount: todayTasks.length,
    config: {
      enabled: config.enabled,
      autonomyLevel: config.autonomyLevel,
      scanIntervalMinutes: config.scanIntervalMinutes,
      maxTasksPerDay: config.maxTasksPerDay,
      tasksRunToday: config.tasksRunToday,
      lastScanAt: config.lastScanAt,
    },
  };
}

export async function updateAgentConfig(subAccountId: number, rawUpdates: Record<string, any>): Promise<any> {
  const config = await getOrCreateConfig(subAccountId);

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(rawUpdates)) {
    if (!ALLOWED_CONFIG_FIELDS.has(key)) continue;

    if (key === "enabled" && typeof value === "boolean") sanitized.enabled = value;
    if (key === "autonomyLevel" && ["observe", "draft", "execute"].includes(value)) sanitized.autonomyLevel = value;
    if (key === "scanIntervalMinutes" && typeof value === "number") sanitized.scanIntervalMinutes = Math.max(5, Math.min(1440, value));
    if (key === "maxTasksPerDay" && typeof value === "number") sanitized.maxTasksPerDay = Math.max(1, Math.min(100, value));
  }

  if (Object.keys(sanitized).length === 0) {
    return config;
  }

  const [updated] = await db.update(agentConfig)
    .set({ ...sanitized, updatedAt: new Date() })
    .where(eq(agentConfig.id, config.id))
    .returning()
    .execute();

  console.log(`[TASK-AGENT] Config updated for account #${subAccountId}:`, sanitized);
  return updated;
}
