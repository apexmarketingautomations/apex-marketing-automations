import { db } from "../db";
import { sql, eq, and, gte, desc } from "drizzle-orm";
import {
  subAccounts,
  integrationConnections,
  timelineEvents,
  workflows,
  emailCampaigns,
  integrationHealthState,
} from "@shared/schema";

export interface SystemComponent {
  name: string;
  status: "healthy" | "degraded" | "critical" | "unknown";
  latencyMs?: number;
  errorRate?: number;
  lastCheckedAt: string;
  detail?: string;
}

export interface ServiceHealth {
  component: string;
  status: "healthy" | "degraded" | "critical" | "unknown";
  uptime?: number;
  errorCount?: number;
  successCount?: number;
  avgLatencyMs?: number;
  lastActivityAt?: string;
  detail?: string;
}

export interface ExecutionTimingInsight {
  step: string;
  avgLatencyMs: number;
  p95LatencyMs: number;
  errorRate: number;
  count: number;
  status: "fast" | "normal" | "slow" | "failing";
}

export interface SystemHealthReport {
  overallStatus: "healthy" | "degraded" | "critical";
  overallScore: number;
  businessHealth: {
    activeAccounts: number;
    accountsWithIssues: number;
    totalWorkflows: number;
    activeWorkflows: number;
    campaignsSent: number;
  };
  serviceHealth: ServiceHealth[];
  executionInsights: ExecutionTimingInsight[];
  recommendations: string[];
  generatedAt: string;
}

async function getDatabaseHealth(): Promise<SystemComponent> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    const latencyMs = Date.now() - start;
    return {
      name: "Database",
      status: latencyMs < 100 ? "healthy" : latencyMs < 500 ? "degraded" : "critical",
      latencyMs,
      lastCheckedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      name: "Database",
      status: "critical",
      lastCheckedAt: new Date().toISOString(),
      detail: err.message,
    };
  }
}

async function getAIGatewayHealth(): Promise<SystemComponent> {
  const isConfigured = !!process.env.OPENAI_API_KEY;
  return {
    name: "AI Gateway",
    status: isConfigured ? "healthy" : "degraded",
    lastCheckedAt: new Date().toISOString(),
    detail: isConfigured ? "OpenAI configured" : "AI API key not configured",
  };
}

async function getIntegrationHealth(): Promise<SystemComponent> {
  try {
    const integrations = await db.select({
      count: sql<number>`count(*)::int`,
      connectedCount: sql<number>`count(*) filter (where status = 'connected')::int`,
    }).from(integrationConnections);

    const total = integrations[0]?.count || 0;
    const connected = integrations[0]?.connectedCount || 0;
    const ratio = total > 0 ? connected / total : 1;

    return {
      name: "Integration Layer",
      status: ratio >= 0.8 ? "healthy" : ratio >= 0.5 ? "degraded" : "critical",
      lastCheckedAt: new Date().toISOString(),
      detail: `${connected}/${total} integrations connected`,
    };
  } catch {
    return {
      name: "Integration Layer",
      status: "unknown",
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

async function getWorkflowEngineHealth(): Promise<SystemComponent> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    const recent = await db.select({
      count: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where status = 'error')::int`,
    }).from(timelineEvents)
      .where(gte(timelineEvents.createdAt, oneDayAgo));

    const total = recent[0]?.count || 0;
    const errors = recent[0]?.errors || 0;
    const errorRate = total > 0 ? errors / total : 0;

    return {
      name: "Workflow Engine",
      status: errorRate < 0.05 ? "healthy" : errorRate < 0.15 ? "degraded" : "critical",
      errorRate,
      lastCheckedAt: new Date().toISOString(),
      detail: `${total} executions, ${(errorRate * 100).toFixed(1)}% error rate (24h)`,
    };
  } catch {
    return {
      name: "Workflow Engine",
      status: "unknown",
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

async function getExecutionTimingInsights(): Promise<ExecutionTimingInsight[]> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    const stepData = await db.select({
      step: timelineEvents.step,
      count: sql<number>`count(*)::int`,
      avgLatency: sql<number>`avg(latency_ms)::real`,
      p95Latency: sql<number>`percentile_cont(0.95) within group (order by latency_ms)::real`,
      errorCount: sql<number>`count(*) filter (where status = 'error')::int`,
    })
      .from(timelineEvents)
      .where(and(
        gte(timelineEvents.createdAt, oneDayAgo),
        sql`latency_ms IS NOT NULL`,
      ))
      .groupBy(timelineEvents.step)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    return stepData.map(row => {
      const avgMs = row.avgLatency || 0;
      const errorRate = row.count > 0 ? row.errorCount / row.count : 0;

      let status: "fast" | "normal" | "slow" | "failing" = "normal";
      if (errorRate > 0.2) status = "failing";
      else if (avgMs > 5000) status = "slow";
      else if (avgMs < 200) status = "fast";

      return {
        step: row.step,
        avgLatencyMs: Math.round(avgMs),
        p95LatencyMs: Math.round(row.p95Latency || avgMs),
        errorRate,
        count: row.count,
        status,
      };
    });
  } catch {
    return [];
  }
}

async function getBusinessHealthMetrics() {
  try {
    const [accountStats, workflowStats, campaignStats] = await Promise.all([
      db.select({
        total: sql<number>`count(*)::int`,
        withMeta: sql<number>`count(*) filter (where meta_page_id IS NOT NULL)::int`,
      }).from(subAccounts),

      db.select({
        total: sql<number>`count(*)::int`,
        withSteps: sql<number>`count(*) filter (where jsonb_array_length(steps::jsonb) > 0)::int`,
      }).from(workflows),

      db.select({
        sent: sql<number>`count(*) filter (where status = 'sent')::int`,
      }).from(emailCampaigns),
    ]);

    return {
      activeAccounts: accountStats[0]?.total || 0,
      accountsWithIssues: (accountStats[0]?.total || 0) - (accountStats[0]?.withMeta || 0),
      totalWorkflows: workflowStats[0]?.total || 0,
      activeWorkflows: workflowStats[0]?.withSteps || 0,
      campaignsSent: campaignStats[0]?.sent || 0,
    };
  } catch {
    return {
      activeAccounts: 0,
      accountsWithIssues: 0,
      totalWorkflows: 0,
      activeWorkflows: 0,
      campaignsSent: 0,
    };
  }
}

export async function getSystemHealthReport(): Promise<SystemHealthReport> {
  const [dbHealth, aiHealth, integHealth, wfEngineHealth, executionInsights, businessMetrics] = await Promise.all([
    getDatabaseHealth(),
    getAIGatewayHealth(),
    getIntegrationHealth(),
    getWorkflowEngineHealth(),
    getExecutionTimingInsights(),
    getBusinessHealthMetrics(),
  ]);

  const components = [dbHealth, aiHealth, integHealth, wfEngineHealth];

  const serviceHealth: ServiceHealth[] = components.map(c => ({
    component: c.name,
    status: c.status,
    avgLatencyMs: c.latencyMs,
    errorCount: undefined,
    detail: c.detail,
    lastActivityAt: c.lastCheckedAt,
  }));

  const criticalCount = components.filter(c => c.status === "critical").length;
  const degradedCount = components.filter(c => c.status === "degraded").length;

  let overallStatus: "healthy" | "degraded" | "critical" = "healthy";
  if (criticalCount > 0) overallStatus = "critical";
  else if (degradedCount > 0) overallStatus = "degraded";

  const healthyCount = components.filter(c => c.status === "healthy").length;
  const overallScore = Math.round((healthyCount / components.length) * 100);

  const recommendations: string[] = [];
  if (dbHealth.status !== "healthy") recommendations.push("Database performance is degraded — check connection pool and query optimization");
  if (aiHealth.status !== "healthy") recommendations.push("AI Gateway is not configured — add OpenAI API key to enable AI features");
  if (integHealth.status === "degraded") recommendations.push("Multiple integrations are disconnected — reconnect for full functionality");
  if (executionInsights.some(i => i.status === "failing")) recommendations.push("Some workflow steps have high error rates — review execution logs");
  if (executionInsights.some(i => i.status === "slow")) recommendations.push("Some execution steps are slow — consider optimization");

  return {
    overallStatus,
    overallScore,
    businessHealth: businessMetrics,
    serviceHealth,
    executionInsights,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}
