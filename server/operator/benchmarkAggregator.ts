import { db } from "../db";
import { subAccounts, messages, contacts, liveAutomations, reviews, industryBenchmarks, clientWebsites, integrationConnections } from "@shared/schema";
import { eq, sql, and, gte, count } from "drizzle-orm";
import { checkAccountReadiness } from "./accountReadiness";

const MIN_ACCOUNTS_FOR_BENCHMARK = 1;

interface AccountMetrics {
  industry: string;
  responseTimeSec: number | null;
  contactCount: number;
  messageCount: number;
  inboundMessages: number;
  outboundMessages: number;
  failedMessages: number;
  automationCount: number;
  activeAutomations: number;
  reviewCount: number;
  avgReviewRating: number | null;
  siteCount: number;
  integrationCount: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function computeStats(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    avgValue: sum / sorted.length,
    medianValue: percentile(sorted, 50),
    p25Value: percentile(sorted, 25),
    p75Value: percentile(sorted, 75),
    p90Value: percentile(sorted, 90),
    minValue: sorted[0],
    maxValue: sorted[sorted.length - 1],
    sampleSize: sorted.length,
  };
}

async function gatherAccountMetrics(): Promise<AccountMetrics[]> {
  const accounts = await db.select().from(subAccounts).execute();
  const results: AccountMetrics[] = [];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  for (const account of accounts) {
    const industry = (account.industry || "default").toLowerCase().trim();

    const [contactResult] = await db.select({ count: count() })
      .from(contacts)
      .where(eq(contacts.subAccountId, account.id))
      .execute();

    const [messageResult] = await db.select({ count: count() })
      .from(messages)
      .where(and(eq(messages.subAccountId, account.id), gte(messages.createdAt, thirtyDaysAgo)))
      .execute();

    const [inboundResult] = await db.select({ count: count() })
      .from(messages)
      .where(and(eq(messages.subAccountId, account.id), eq(messages.direction, "inbound"), gte(messages.createdAt, thirtyDaysAgo)))
      .execute();

    const [outboundResult] = await db.select({ count: count() })
      .from(messages)
      .where(and(eq(messages.subAccountId, account.id), eq(messages.direction, "outbound"), gte(messages.createdAt, thirtyDaysAgo)))
      .execute();

    const [failedResult] = await db.select({ count: count() })
      .from(messages)
      .where(and(eq(messages.subAccountId, account.id), eq(messages.status, "failed"), gte(messages.createdAt, thirtyDaysAgo)))
      .execute();

    const allAutomations = await db.select().from(liveAutomations)
      .where(eq(liveAutomations.subAccountId, account.id))
      .execute();

    const activeAutos = allAutomations.filter(a => a.enabled);

    const accountReviews = await db.select().from(reviews)
      .where(eq(reviews.subAccountId, account.id))
      .execute();

    const avgRating = accountReviews.length > 0
      ? accountReviews.reduce((s, r) => s + r.rating, 0) / accountReviews.length
      : null;

    const [siteResult] = await db.select({ count: count() })
      .from(clientWebsites)
      .where(eq(clientWebsites.subAccountId, account.id))
      .execute();

    const integrations = await db.select().from(integrationConnections)
      .where(eq(integrationConnections.subAccountId, account.id))
      .execute();

    const inbound = inboundResult.count;
    const outbound = outboundResult.count;
    let responseTimeSec: number | null = null;
    if (inbound > 0 && outbound > 0) {
      const ratio = outbound / inbound;
      if (ratio >= 0.5) responseTimeSec = Math.round(300 / ratio);
      else responseTimeSec = 600;
    }

    results.push({
      industry,
      responseTimeSec,
      contactCount: contactResult.count,
      messageCount: messageResult.count,
      inboundMessages: inbound,
      outboundMessages: outbound,
      failedMessages: failedResult.count,
      automationCount: allAutomations.length,
      activeAutomations: activeAutos.length,
      reviewCount: accountReviews.length,
      avgReviewRating: avgRating,
      siteCount: siteResult.count,
      integrationCount: integrations.length,
    });
  }

  return results;
}

export async function runBenchmarkAggregation(): Promise<{ industries: number; metrics: number }> {
  console.log("[BENCHMARKS] Starting benchmark aggregation...");

  const allMetrics = await gatherAccountMetrics();

  const byIndustry = new Map<string, AccountMetrics[]>();
  for (const m of allMetrics) {
    const key = m.industry.replace(/\s+/g, "_");
    if (!byIndustry.has(key)) byIndustry.set(key, []);
    byIndustry.get(key)!.push(m);
  }

  if (allMetrics.length > 0) {
    byIndustry.set("all_industries", allMetrics);
  }

  let totalMetrics = 0;

  for (const [industry, accounts] of byIndustry) {
    if (accounts.length < MIN_ACCOUNTS_FOR_BENCHMARK && industry !== "all_industries") continue;

    const metricConfigs: { key: string; values: number[]; unit: string }[] = [
      { key: "response_time_sec", values: accounts.map(a => a.responseTimeSec).filter((v): v is number => v !== null), unit: "seconds" },
      { key: "contact_count", values: accounts.map(a => a.contactCount), unit: "number" },
      { key: "monthly_message_volume", values: accounts.map(a => a.messageCount), unit: "number" },
      { key: "response_rate", values: accounts.filter(a => a.inboundMessages > 0).map(a => Math.min(100, Math.round((a.outboundMessages / a.inboundMessages) * 100))), unit: "percent" },
      { key: "message_failure_rate", values: accounts.filter(a => a.messageCount > 0).map(a => Math.round((a.failedMessages / a.messageCount) * 100)), unit: "percent" },
      { key: "automation_count", values: accounts.map(a => a.automationCount), unit: "number" },
      { key: "active_automation_rate", values: accounts.filter(a => a.automationCount > 0).map(a => Math.round((a.activeAutomations / a.automationCount) * 100)), unit: "percent" },
      { key: "review_count", values: accounts.map(a => a.reviewCount), unit: "number" },
      { key: "avg_review_rating", values: accounts.map(a => a.avgReviewRating).filter((v): v is number => v !== null), unit: "rating" },
      { key: "integration_count", values: accounts.map(a => a.integrationCount), unit: "number" },
    ];

    for (const mc of metricConfigs) {
      if (mc.values.length === 0) continue;
      const stats = computeStats(mc.values);
      if (!stats) continue;

      await db.delete(industryBenchmarks)
        .where(and(
          eq(industryBenchmarks.industry, industry),
          eq(industryBenchmarks.metricKey, mc.key),
        ))
        .execute();

      await db.insert(industryBenchmarks).values({
        industry,
        metricKey: mc.key,
        avgValue: Math.round(stats.avgValue * 100) / 100,
        medianValue: Math.round(stats.medianValue * 100) / 100,
        p25Value: Math.round(stats.p25Value * 100) / 100,
        p75Value: Math.round(stats.p75Value * 100) / 100,
        p90Value: Math.round(stats.p90Value * 100) / 100,
        minValue: Math.round(stats.minValue * 100) / 100,
        maxValue: Math.round(stats.maxValue * 100) / 100,
        sampleSize: stats.sampleSize,
        unit: mc.unit,
      }).execute();

      totalMetrics++;
    }
  }

  console.log(`[BENCHMARKS] Aggregation complete: ${byIndustry.size} industries, ${totalMetrics} metrics stored`);
  return { industries: byIndustry.size, metrics: totalMetrics };
}

export async function getBenchmarksForIndustry(industry: string): Promise<Record<string, {
  avg: number;
  median: number;
  p25: number;
  p75: number;
  p90: number;
  sampleSize: number;
  unit: string;
}>> {
  const normalized = industry.toLowerCase().trim().replace(/\s+/g, "_");

  let rows = await db.select().from(industryBenchmarks)
    .where(eq(industryBenchmarks.industry, normalized))
    .execute();

  if (rows.length === 0) {
    rows = await db.select().from(industryBenchmarks)
      .where(eq(industryBenchmarks.industry, "all_industries"))
      .execute();
  }

  const result: Record<string, any> = {};
  for (const row of rows) {
    result[row.metricKey] = {
      avg: row.avgValue,
      median: row.medianValue ?? row.avgValue,
      p25: row.p25Value ?? 0,
      p75: row.p75Value ?? row.avgValue,
      p90: row.p90Value ?? row.avgValue,
      sampleSize: row.sampleSize,
      unit: row.unit ?? "number",
    };
  }
  return result;
}

export async function getAccountBenchmarkComparison(subAccountId: number): Promise<{
  industry: string;
  metrics: Array<{
    key: string;
    label: string;
    yours: number | string;
    industryAvg: number | string;
    industryMedian: number | string;
    industryP75: number | string;
    status: "above" | "at" | "below";
    percentile: string;
    unit: string;
  }>;
  readiness?: { phase: string; ready: boolean; reasons: string[]; cta?: { label: string; link: string } };
}> {
  const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId)).execute();
  if (!account) return { industry: "unknown", metrics: [] };

  const readiness = await checkAccountReadiness(subAccountId);

  const industry = (account.industry || "default").toLowerCase().trim();
  const benchmarks = await getBenchmarksForIndustry(industry);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [contactResult] = await db.select({ count: count() }).from(contacts).where(eq(contacts.subAccountId, subAccountId)).execute();
  const [messageResult] = await db.select({ count: count() }).from(messages).where(and(eq(messages.subAccountId, subAccountId), gte(messages.createdAt, thirtyDaysAgo))).execute();
  const [inboundResult] = await db.select({ count: count() }).from(messages).where(and(eq(messages.subAccountId, subAccountId), eq(messages.direction, "inbound"), gte(messages.createdAt, thirtyDaysAgo))).execute();
  const [outboundResult] = await db.select({ count: count() }).from(messages).where(and(eq(messages.subAccountId, subAccountId), eq(messages.direction, "outbound"), gte(messages.createdAt, thirtyDaysAgo))).execute();
  const [failedResult] = await db.select({ count: count() }).from(messages).where(and(eq(messages.subAccountId, subAccountId), eq(messages.status, "failed"), gte(messages.createdAt, thirtyDaysAgo))).execute();

  const automations = await db.select().from(liveAutomations).where(eq(liveAutomations.subAccountId, subAccountId)).execute();
  const activeAutos = automations.filter(a => a.enabled);
  const accountReviews = await db.select().from(reviews).where(eq(reviews.subAccountId, subAccountId)).execute();
  const avgRating = accountReviews.length > 0 ? accountReviews.reduce((s, r) => s + r.rating, 0) / accountReviews.length : null;
  const integrations = await db.select().from(integrationConnections).where(eq(integrationConnections.subAccountId, subAccountId)).execute();

  const responseRate = inboundResult.count > 0 ? Math.min(100, Math.round((outboundResult.count / inboundResult.count) * 100)) : null;
  const failureRate = messageResult.count > 0 ? Math.round((failedResult.count / messageResult.count) * 100) : null;
  const autoActiveRate = automations.length > 0 ? Math.round((activeAutos.length / automations.length) * 100) : null;

  const accountValues: Record<string, number | null> = {
    contact_count: contactResult.count,
    monthly_message_volume: messageResult.count,
    response_rate: responseRate,
    message_failure_rate: failureRate,
    automation_count: automations.length,
    active_automation_rate: autoActiveRate,
    review_count: accountReviews.length,
    avg_review_rating: avgRating,
    integration_count: integrations.length,
  };

  const labels: Record<string, string> = {
    response_time_sec: "Response Time",
    contact_count: "Contact Count",
    monthly_message_volume: "Monthly Messages",
    response_rate: "Response Rate",
    message_failure_rate: "Message Failure Rate",
    automation_count: "Automations",
    active_automation_rate: "Active Automation Rate",
    review_count: "Reviews",
    avg_review_rating: "Avg Review Rating",
    integration_count: "Integrations",
  };

  const lowerIsBetter = new Set(["response_time_sec", "message_failure_rate"]);

  const metrics: any[] = [];

  for (const [key, benchmark] of Object.entries(benchmarks)) {
    const yourValue = accountValues[key];
    if (yourValue === null || yourValue === undefined) continue;

    const isLowerBetter = lowerIsBetter.has(key);
    let status: "above" | "at" | "below";

    if (isLowerBetter) {
      if (yourValue <= benchmark.p25) status = "above";
      else if (yourValue <= benchmark.median) status = "at";
      else status = "below";
    } else {
      if (yourValue >= benchmark.p75) status = "above";
      else if (yourValue >= benchmark.median) status = "at";
      else status = "below";
    }

    let pctLabel = "Below Average";
    if (status === "above") pctLabel = "Top Quartile";
    else if (status === "at") pctLabel = "Average";

    const formatVal = (v: number, unit: string) => {
      if (unit === "percent") return `${v}%`;
      if (unit === "seconds") return `${v}s`;
      if (unit === "rating") return v.toFixed(1);
      return v.toLocaleString();
    };

    metrics.push({
      key,
      label: labels[key] || key,
      yours: formatVal(yourValue, benchmark.unit),
      industryAvg: formatVal(benchmark.avg, benchmark.unit),
      industryMedian: formatVal(benchmark.median, benchmark.unit),
      industryP75: formatVal(benchmark.p75, benchmark.unit),
      status,
      percentile: pctLabel,
      unit: benchmark.unit,
    });
  }

  const responseRateKeys = new Set(["response_rate", "response_time_sec"]);
  const filteredMetrics = readiness.ready
    ? metrics
    : metrics.filter(m => !responseRateKeys.has(m.key));

  return { industry, metrics: filteredMetrics, readiness };
}

let benchmarkInterval: NodeJS.Timeout | null = null;

export function startBenchmarkScheduler(intervalMs: number = 60 * 60 * 1000): void {
  console.log("[BENCHMARKS] Starting benchmark scheduler (interval: " + (intervalMs / 60000) + " min)");
  runBenchmarkAggregation().catch(err => console.error("[BENCHMARKS] Initial run failed:", err.message));

  benchmarkInterval = setInterval(() => {
    runBenchmarkAggregation().catch(err => console.error("[BENCHMARKS] Scheduled run failed:", err.message));
  }, intervalMs);
}

export function stopBenchmarkScheduler(): void {
  if (benchmarkInterval) {
    clearInterval(benchmarkInterval);
    benchmarkInterval = null;
  }
}
