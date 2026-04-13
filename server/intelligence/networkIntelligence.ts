import { db } from "../db";
import { sql, eq, desc, and } from "drizzle-orm";
import { intelligenceScores, intelligenceRecommendations } from "@shared/schema";

export interface NetworkBenchmark {
  scoreType: string;
  platformAvg: number;
  platformMedian: number;
  topQuartile: number;
  sampleSize: number;
}

export interface NetworkPattern {
  patternType: string;
  title: string;
  description: string;
  frequency: number;
  affectedAccounts: number;
  severity: "info" | "warning" | "critical";
}

export interface NetworkIntelligence {
  benchmarks: NetworkBenchmark[];
  patterns: NetworkPattern[];
  generatedAt: string;
}

export async function getNetworkBenchmarks(): Promise<NetworkBenchmark[]> {
  try {
    const scoreTypes = [
      "account_maturity_score",
      "launch_readiness_score",
      "workflow_effectiveness_score",
      "campaign_effectiveness_score",
      "pipeline_health_score",
      "messaging_performance_score",
      "reputation_health_score",
      "module_adoption_score",
    ];

    const benchmarks: NetworkBenchmark[] = [];

    for (const scoreType of scoreTypes) {
      const rows = await db.select({
        scoreValue: intelligenceScores.scoreValue,
      })
        .from(intelligenceScores)
        .where(and(
          eq(intelligenceScores.scoreType, scoreType),
          eq(intelligenceScores.entityType, "account"),
        ))
        .orderBy(intelligenceScores.scoreValue);

      if (rows.length < 2) continue;

      const values = rows.map(r => r.scoreValue).sort((a, b) => a - b);
      const avg = values.reduce((s, v) => s + v, 0) / values.length;
      const median = values[Math.floor(values.length / 2)];
      const topQuartile = values[Math.floor(values.length * 0.75)];

      benchmarks.push({
        scoreType,
        platformAvg: Math.round(avg),
        platformMedian: Math.round(median),
        topQuartile: Math.round(topQuartile),
        sampleSize: rows.length,
      });
    }

    import("./apexLearningFeed").then(({ emitNetworkBenchmarksComputed }) =>
      emitNetworkBenchmarksComputed(benchmarks.length, 0)
    ).catch(() => {});

    return benchmarks;
  } catch {
    return [];
  }
}

export async function getNetworkPatterns(): Promise<NetworkPattern[]> {
  try {
    const patterns: NetworkPattern[] = [];

    const criticalRecs = await db.select({
      recommendationType: intelligenceRecommendations.recommendationType,
      count: sql<number>`count(*)::int`,
      accountCount: sql<number>`count(distinct account_id)::int`,
    })
      .from(intelligenceRecommendations)
      .where(and(
        eq(intelligenceRecommendations.status, "pending"),
        eq(intelligenceRecommendations.priority, "critical"),
      ))
      .groupBy(intelligenceRecommendations.recommendationType)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    for (const rec of criticalRecs) {
      if ((rec.accountCount ?? 0) >= 2) {
        patterns.push({
          patternType: `critical_rec_${rec.recommendationType}`,
          title: formatRecommendationType(rec.recommendationType),
          description: `${rec.accountCount} accounts have this critical issue pending`,
          frequency: rec.count ?? 0,
          affectedAccounts: rec.accountCount ?? 0,
          severity: "critical",
        });
      }
    }

    const lowScores = await db.select({
      scoreType: intelligenceScores.scoreType,
      count: sql<number>`count(*)::int`,
    })
      .from(intelligenceScores)
      .where(and(
        eq(intelligenceScores.entityType, "account"),
        sql`${intelligenceScores.scoreValue} < 30`,
      ))
      .groupBy(intelligenceScores.scoreType)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    for (const row of lowScores) {
      if ((row.count ?? 0) >= 2) {
        patterns.push({
          patternType: `low_score_${row.scoreType}`,
          title: `Low ${formatScoreType(row.scoreType)}`,
          description: `${row.count} accounts have critically low ${formatScoreType(row.scoreType)} scores`,
          frequency: row.count ?? 0,
          affectedAccounts: row.count ?? 0,
          severity: "warning",
        });
      }
    }

    return patterns;
  } catch {
    return [];
  }
}

export async function getNetworkIntelligence(): Promise<NetworkIntelligence> {
  const [benchmarks, patterns] = await Promise.all([
    getNetworkBenchmarks(),
    getNetworkPatterns(),
  ]);

  return {
    benchmarks,
    patterns,
    generatedAt: new Date().toISOString(),
  };
}

export async function getAccountIntelligenceSummary(accountId: number): Promise<{
  overallHealth: number;
  healthBand: string;
  topOpportunities: Array<{ title: string; priority: string; category: string }>;
  topBlockers: Array<{ title: string; severity: string; category: string }>;
  scoreBreakdown: Array<{ scoreType: string; value: number; band: string }>;
  moduleAdoption: number;
  benchmarkComparison: Array<{ scoreType: string; accountScore: number; platformAvg: number; percentile: string }>;
}> {
  const [accountScores, pendingRecs, benchmarks] = await Promise.all([
    db.select()
      .from(intelligenceScores)
      .where(and(
        eq(intelligenceScores.accountId, accountId),
        eq(intelligenceScores.entityType, "account"),
      )),
    db.select()
      .from(intelligenceRecommendations)
      .where(and(
        eq(intelligenceRecommendations.accountId, accountId),
        eq(intelligenceRecommendations.status, "pending"),
      ))
      .orderBy(desc(sql`CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END`))
      .limit(20),
    getNetworkBenchmarks(),
  ]);

  const coreScores = accountScores.filter(s =>
    ["account_maturity_score", "launch_readiness_score", "workflow_effectiveness_score",
     "campaign_effectiveness_score", "pipeline_health_score", "messaging_performance_score",
     "reputation_health_score", "module_adoption_score"].includes(s.scoreType)
  );

  const overallHealth = coreScores.length > 0
    ? Math.round(coreScores.reduce((s, sc) => s + sc.scoreValue, 0) / coreScores.length)
    : 0;

  const healthBand = overallHealth >= 80 ? "excellent" : overallHealth >= 60 ? "high" : overallHealth >= 40 ? "medium" : overallHealth >= 20 ? "low" : "critical";

  const moduleScore = accountScores.find(s => s.scoreType === "module_adoption_score");
  const moduleAdoption = moduleScore ? Math.round(moduleScore.scoreValue) : 0;

  const topOpportunities = pendingRecs
    .filter(r => r.priority === "high" || r.priority === "medium")
    .slice(0, 5)
    .map(r => ({
      title: r.title,
      priority: r.priority,
      category: r.recommendationType,
    }));

  const topBlockers = pendingRecs
    .filter(r => r.priority === "critical" || r.priority === "high")
    .slice(0, 5)
    .map(r => ({
      title: r.title,
      severity: r.priority,
      category: r.entityType,
    }));

  const scoreBreakdown = coreScores.map(s => ({
    scoreType: s.scoreType,
    value: Math.round(s.scoreValue),
    band: s.scoreBand,
  }));

  const benchmarkComparison = coreScores.map(s => {
    const bench = benchmarks.find(b => b.scoreType === s.scoreType);
    let percentile = "N/A";
    if (bench) {
      if (s.scoreValue >= bench.topQuartile) percentile = "top 25%";
      else if (s.scoreValue >= bench.platformMedian) percentile = "above average";
      else if (s.scoreValue >= bench.platformAvg * 0.75) percentile = "below average";
      else percentile = "bottom 25%";
    }
    return {
      scoreType: s.scoreType,
      accountScore: Math.round(s.scoreValue),
      platformAvg: bench?.platformAvg || 0,
      percentile,
    };
  });

  return {
    overallHealth,
    healthBand,
    topOpportunities,
    topBlockers,
    scoreBreakdown,
    moduleAdoption,
    benchmarkComparison,
  };
}

function formatScoreType(scoreType: string): string {
  return scoreType
    .replace(/_score$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, l => l.toUpperCase());
}

function formatRecommendationType(recType: string): string {
  return recType
    .replace(/_/g, " ")
    .replace(/\b\w/g, l => l.toUpperCase());
}
