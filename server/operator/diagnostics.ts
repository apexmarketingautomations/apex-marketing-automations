// @ts-nocheck
import type { DiagnosticCheck } from "./types";
import { storage } from "../storage";
import { db } from "../db";
import { messages as messagesTable } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { eventBus, EVENT_TYPES } from "../eventBus";
import { jobQueue } from "../jobQueue";

const diagnosticHistory: DiagnosticCheck[] = [];
const MAX_HISTORY = 500;
let lastRunTimestamp = "";

function addCheck(check: DiagnosticCheck) {
  diagnosticHistory.push(check);
  if (diagnosticHistory.length > MAX_HISTORY) {
    diagnosticHistory.splice(0, diagnosticHistory.length - MAX_HISTORY);
  }
}

export async function runDiagnostics(subAccountId?: number): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];
  const now = new Date().toISOString();
  lastRunTimestamp = now;

  try {
    const eventStats = eventBus.getStats();
    checks.push({
      name: "event_bus_health",
      category: "system",
      severity: eventStats.queueDepth > 100 ? "critical" : eventStats.queueDepth > 20 ? "warning" : "info",
      status: eventStats.queueDepth > 100 ? "failing" : eventStats.queueDepth > 20 ? "degraded" : "healthy",
      message: `Event bus: ${eventStats.totalEvents} processed, ${eventStats.queueDepth} queued, ${eventStats.subscriberCount} subscribers`,
      details: { totalEvents: eventStats.totalEvents, queueDepth: eventStats.queueDepth, subscribers: eventStats.subscriberCount },
      autoFixable: false,
      timestamp: now,
    });

    const recentErrors = eventStats.recentErrors;
    if (recentErrors.length > 0) {
      checks.push({
        name: "event_bus_errors",
        category: "system",
        severity: recentErrors.length > 10 ? "critical" : "warning",
        status: recentErrors.length > 10 ? "failing" : "degraded",
        message: `${recentErrors.length} recent event processing errors`,
        details: { errors: recentErrors.slice(-5).map(e => ({ type: e.event_type, module: e.subscriber_module, error: e.error })) },
        suggestedFix: "Check subscriber handlers for errors",
        autoFixable: false,
        timestamp: now,
      });
    }
  } catch (e) {
    checks.push({
      name: "event_bus_health",
      category: "system",
      severity: "critical",
      status: "failing",
      message: `Event bus check failed: ${(e as any).message}`,
      autoFixable: false,
      timestamp: now,
    });
  }

  try {
    const queueStats = jobQueue.getStats();
    checks.push({
      name: "job_queue_health",
      category: "queue",
      severity: queueStats.queued > 50 ? "critical" : queueStats.queued > 10 ? "warning" : "info",
      status: queueStats.queued > 50 ? "failing" : queueStats.queued > 10 ? "degraded" : "healthy",
      message: `Job queue: ${queueStats.queued} queued, ${queueStats.running} running, ${queueStats.failed} failed`,
      details: queueStats,
      suggestedFix: queueStats.queued > 50 ? "Queue backlog detected — check for stuck jobs" : undefined,
      autoFixable: false,
      timestamp: now,
    });
  } catch (err: any) {
    console.error("[DIAGNOSTICS] Job queue check failed:", err.message);
  }

  if (subAccountId) {
    try {
      const connections = await storage.getIntegrationConnections(subAccountId);
      const disconnected = connections.filter((c: any) => c.status === "disconnected" || c.status === "error");
      const connected = connections.filter((c: any) => c.status === "connected");

      checks.push({
        name: "integration_health",
        category: "integration",
        severity: disconnected.length > 0 ? "warning" : "info",
        status: disconnected.length > 0 ? "degraded" : "healthy",
        message: `${connected.length} connected, ${disconnected.length} disconnected integrations`,
        details: {
          connected: connected.map((c: any) => c.provider),
          disconnected: disconnected.map((c: any) => ({ provider: c.provider, status: c.status })),
        },
        suggestedFix: disconnected.length > 0 ? `Reconnect: ${disconnected.map((c: any) => c.provider).join(", ")}` : undefined,
        autoFixable: false,
        timestamp: now,
      });
    } catch (err: any) {
      console.error("[DIAGNOSTICS] Integration health check failed:", err.message);
    }

    try {
      const automations = await storage.getLiveAutomations(subAccountId);
      if (automations) {
        let failedCount = 0;
        for (const a of automations) {
          const logs = (a as any).runLogs || [];
          const recentFails = logs.filter((l: any) => l.status === "error" && new Date(l.timestamp) > new Date(Date.now() - 86400000));
          if (recentFails.length > 0) failedCount++;
        }

        checks.push({
          name: "workflow_health",
          category: "workflow",
          severity: failedCount > 0 ? "warning" : "info",
          status: failedCount > 0 ? "degraded" : "healthy",
          message: `${automations.length} automations, ${failedCount} with recent failures`,
          details: { total: automations.length, failedRecently: failedCount },
          suggestedFix: failedCount > 0 ? "Review failed automations and check trigger conditions" : undefined,
          autoFixable: false,
          timestamp: now,
        });
      }
    } catch (err: any) {
      console.error("[DIAGNOSTICS] Workflow health check failed:", err.message);
    }

    try {
      const messages = await db.select({ status: messagesTable.status, createdAt: messagesTable.createdAt })
        .from(messagesTable).where(eq(messagesTable.subAccountId, subAccountId))
        .orderBy(desc(messagesTable.createdAt)).limit(500);
      if (messages) {
        const failed = messages.filter((m: any) => m.status === "failed");
        const recentFailed = failed.filter((m: any) => new Date(m.createdAt) > new Date(Date.now() - 86400000));

        checks.push({
          name: "messaging_health",
          category: "messaging",
          severity: recentFailed.length > 5 ? "warning" : "info",
          status: recentFailed.length > 5 ? "degraded" : "healthy",
          message: `${messages.length} recent messages (last 500), ${recentFailed.length} failed in last 24h`,
          details: { total: messages.length, failedRecent: recentFailed.length },
          suggestedFix: recentFailed.length > 5 ? "Check Twilio configuration and phone number status" : undefined,
          autoFixable: false,
          timestamp: now,
        });
      }
    } catch (err: any) {
      console.error("[DIAGNOSTICS] Messaging health check failed:", err.message);
    }

    try {
      const account = await storage.getSubAccount(subAccountId);
      if (account) {
        const missingConfig: string[] = [];
        if (!account.twilioNumber) missingConfig.push("phone_number");
        if (!account.businessName) missingConfig.push("business_name");

        checks.push({
          name: "account_config",
          category: "system",
          severity: missingConfig.length > 0 ? "warning" : "info",
          status: missingConfig.length > 0 ? "degraded" : "healthy",
          message: missingConfig.length > 0 ? `Missing config: ${missingConfig.join(", ")}` : "Account fully configured",
          details: { missing: missingConfig },
          autoFixable: false,
          timestamp: now,
        });
      }
    } catch (err: any) {
      console.error("[DIAGNOSTICS] Account config check failed:", err.message);
    }
  }

  for (const check of checks) {
    addCheck(check);
  }

  if (checks.some(c => c.severity === "critical")) {
    eventBus.publishAsync("system.diagnostic.critical", { checks: checks.filter(c => c.severity === "critical"), subAccountId }, "diagnostics");
  }

  return checks;
}

export function getDiagnosticHistory(limit = 100, category?: string): DiagnosticCheck[] {
  let history = diagnosticHistory;
  if (category) history = history.filter(h => h.category === category);
  return history.slice(-limit);
}

export function getLastRunTimestamp(): string {
  return lastRunTimestamp;
}
