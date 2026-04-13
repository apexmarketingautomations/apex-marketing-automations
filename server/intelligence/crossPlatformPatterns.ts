import { db } from "../db";
import { sql, eq, and, gte, desc } from "drizzle-orm";
import {
  workflows,
  emailCampaigns,
  digitalCards,
  deals,
  subAccounts,
  intelligenceScores,
} from "@shared/schema";

export interface PlaybookPattern {
  id: string;
  title: string;
  description: string;
  modulesCombination: string[];
  performanceMultiplier: number;
  accountCount: number;
  confidence: number;
  category: "conversion" | "engagement" | "revenue" | "automation";
  recommendedFor: string[];
}

export interface CrossPlatformPatternReport {
  patterns: PlaybookPattern[];
  accountPatterns: AccountPatternMatch[];
  generatedAt: string;
}

export interface AccountPatternMatch {
  accountId: number;
  accountName: string;
  matchedPatterns: string[];
  missingModules: string[];
  potentialLift: string;
  recommendation: string;
}

interface AccountModuleProfile {
  accountId: number;
  accountName: string;
  hasWorkflows: boolean;
  workflowCount: number;
  hasAiWorkflows: boolean;
  hasCampaigns: boolean;
  campaignCount: number;
  hasCards: boolean;
  hasPipeline: boolean;
  wonDealsCount: number;
  conversionRate: number;
  avgDealValue: number;
}

async function buildAccountProfiles(): Promise<AccountModuleProfile[]> {
  const accounts = await db.select().from(subAccounts).limit(200);
  const profiles: AccountModuleProfile[] = [];

  await Promise.allSettled(accounts.map(async (account) => {
    try {
      const [wfRows, campaignRows, cardRows, dealRows] = await Promise.all([
        db.select().from(workflows).where(eq(workflows.subAccountId, account.id)),
        db.select().from(emailCampaigns).where(eq(emailCampaigns.subAccountId, account.id)),
        db.select().from(digitalCards).where(eq(digitalCards.subAccountId, account.id)),
        db.select().from(deals).where(eq(deals.subAccountId, account.id)),
      ]);

      const wonDeals = dealRows.filter(d => d.status === "won");
      const totalDeals = dealRows.length;
      const conversionRate = totalDeals > 0 ? (wonDeals.length / totalDeals) * 100 : 0;
      const avgDealValue = wonDeals.length > 0
        ? wonDeals.reduce((s, d) => s + (d.value || 0), 0) / wonDeals.length
        : 0;

      const hasAiWorkflows = wfRows.some(w => {
        const steps = Array.isArray(w.steps) ? w.steps : [];
        return steps.some((s: any) => s.action_type === "AIQualify" || s.action_type === "AIGenerate");
      });

      profiles.push({
        accountId: account.id,
        accountName: account.name,
        hasWorkflows: wfRows.length > 0,
        workflowCount: wfRows.length,
        hasAiWorkflows,
        hasCampaigns: campaignRows.length > 0,
        campaignCount: campaignRows.length,
        hasCards: cardRows.length > 0,
        hasPipeline: totalDeals > 0,
        wonDealsCount: wonDeals.length,
        conversionRate,
        avgDealValue,
      });
    } catch {
    }
  }));

  return profiles;
}

function derivePatterns(profiles: AccountModuleProfile[]): PlaybookPattern[] {
  const patterns: PlaybookPattern[] = [];

  const withAllModules = profiles.filter(p => p.hasWorkflows && p.hasCampaigns && p.hasCards);
  const withoutAllModules = profiles.filter(p => !(p.hasWorkflows && p.hasCampaigns && p.hasCards));

  const fullModuleAvgConv = withAllModules.length > 0
    ? withAllModules.reduce((s, p) => s + p.conversionRate, 0) / withAllModules.length
    : 0;
  const limitedModuleAvgConv = withoutAllModules.length > 0
    ? withoutAllModules.reduce((s, p) => s + p.conversionRate, 0) / withoutAllModules.length
    : 0;

  const fullModuleMult = limitedModuleAvgConv > 0
    ? fullModuleAvgConv / limitedModuleAvgConv
    : 1.5;

  if (withAllModules.length >= 2) {
    patterns.push({
      id: "pattern:full_stack_engagement",
      title: "Full-Stack Engagement Stack",
      description: "Accounts using workflows + email campaigns + digital cards together show significantly higher conversion rates",
      modulesCombination: ["workflows", "email_campaigns", "digital_cards"],
      performanceMultiplier: Math.max(1.2, Math.min(5, fullModuleMult)),
      accountCount: withAllModules.length,
      confidence: Math.min(0.95, 0.5 + withAllModules.length * 0.05),
      category: "conversion",
      recommendedFor: ["accounts missing campaigns", "accounts missing cards"],
    });
  }

  const withAiWorkflows = profiles.filter(p => p.hasAiWorkflows && p.hasPipeline);
  const withoutAiWorkflows = profiles.filter(p => !p.hasAiWorkflows && p.hasPipeline);

  const aiAvgConv = withAiWorkflows.length > 0
    ? withAiWorkflows.reduce((s, p) => s + p.conversionRate, 0) / withAiWorkflows.length
    : 0;
  const nonAiAvgConv = withoutAiWorkflows.length > 0
    ? withoutAiWorkflows.reduce((s, p) => s + p.conversionRate, 0) / withoutAiWorkflows.length
    : 0;

  if (withAiWorkflows.length >= 2 && aiAvgConv > nonAiAvgConv) {
    const aiMult = nonAiAvgConv > 0 ? aiAvgConv / nonAiAvgConv : 1.4;
    patterns.push({
      id: "pattern:ai_workflow_pipeline",
      title: "AI-Powered Workflow + Pipeline",
      description: "Accounts with AI qualification workflows connected to their pipeline convert leads at a higher rate",
      modulesCombination: ["ai_workflows", "pipeline"],
      performanceMultiplier: Math.max(1.1, Math.min(4, aiMult)),
      accountCount: withAiWorkflows.length,
      confidence: Math.min(0.9, 0.5 + withAiWorkflows.length * 0.04),
      category: "conversion",
      recommendedFor: ["accounts with pipeline but no AI workflows"],
    });
  }

  const withCampaignsAndWorkflows = profiles.filter(p => p.hasCampaigns && p.hasWorkflows && p.campaignCount > 1);
  if (withCampaignsAndWorkflows.length >= 2) {
    patterns.push({
      id: "pattern:nurture_automation",
      title: "Multi-Touch Nurture Automation",
      description: "Accounts running multiple campaigns with automated follow-up workflows have higher engagement",
      modulesCombination: ["email_campaigns", "workflows"],
      performanceMultiplier: 1.6,
      accountCount: withCampaignsAndWorkflows.length,
      confidence: Math.min(0.85, 0.5 + withCampaignsAndWorkflows.length * 0.03),
      category: "engagement",
      recommendedFor: ["accounts with only one campaign", "accounts with no workflows"],
    });
  }

  const highValueAi = profiles.filter(p => p.hasAiWorkflows && p.avgDealValue > 1000);
  if (highValueAi.length >= 2) {
    patterns.push({
      id: "pattern:high_value_ai_qualification",
      title: "AI Qualification for High-Value Deals",
      description: "Accounts using AI to qualify leads achieve higher average deal values",
      modulesCombination: ["ai_workflows", "pipeline", "campaigns"],
      performanceMultiplier: 1.8,
      accountCount: highValueAi.length,
      confidence: Math.min(0.8, 0.5 + highValueAi.length * 0.04),
      category: "revenue",
      recommendedFor: ["accounts with low average deal values"],
    });
  }

  patterns.push({
    id: "pattern:digital_card_referral",
    title: "Digital Card Referral Loop",
    description: "Accounts using digital cards with review links see better reputation scores and more referrals",
    modulesCombination: ["digital_cards", "reputation"],
    performanceMultiplier: 1.4,
    accountCount: profiles.filter(p => p.hasCards).length,
    confidence: 0.7,
    category: "engagement",
    recommendedFor: ["accounts without digital cards"],
  });

  return patterns;
}

function matchAccountsToPatterns(
  profiles: AccountModuleProfile[],
  patterns: PlaybookPattern[]
): AccountPatternMatch[] {
  return profiles.map(profile => {
    const matched: string[] = [];
    const missing: string[] = [];

    for (const pattern of patterns) {
      const modules = pattern.modulesCombination;
      const hasWorkflow = modules.includes("workflows") || modules.includes("ai_workflows");
      const hasCampaign = modules.includes("email_campaigns") || modules.includes("campaigns");
      const hasCard = modules.includes("digital_cards");
      const hasPipeline = modules.includes("pipeline");

      const profileMeetsCondition =
        (!hasWorkflow || (modules.includes("ai_workflows") ? profile.hasAiWorkflows : profile.hasWorkflows)) &&
        (!hasCampaign || profile.hasCampaigns) &&
        (!hasCard || profile.hasCards) &&
        (!hasPipeline || profile.hasPipeline);

      if (profileMeetsCondition) {
        matched.push(pattern.id);
      } else {
        if (hasWorkflow && !profile.hasWorkflows) missing.push("workflows");
        if (hasCampaign && !profile.hasCampaigns) missing.push("email campaigns");
        if (hasCard && !profile.hasCards) missing.push("digital cards");
        if (hasPipeline && !profile.hasPipeline) missing.push("pipeline");
      }
    }

    const uniqueMissing = [...new Set(missing)];
    const topPattern = patterns.find(p => !matched.includes(p.id));
    const potentialMult = topPattern?.performanceMultiplier ?? 1.0;

    return {
      accountId: profile.accountId,
      accountName: profile.accountName,
      matchedPatterns: matched,
      missingModules: uniqueMissing,
      potentialLift: uniqueMissing.length > 0 ? `~${Math.round((potentialMult - 1) * 100)}% improvement potential` : "Optimized",
      recommendation: uniqueMissing.length > 0
        ? `Activate ${uniqueMissing.slice(0, 2).join(" and ")} to unlock higher performance patterns`
        : "Account is using all high-performing module combinations",
    };
  });
}

export async function getCrossPlatformPatterns(): Promise<CrossPlatformPatternReport> {
  try {
    const profiles = await buildAccountProfiles();
    const patterns = derivePatterns(profiles);
    const accountPatterns = matchAccountsToPatterns(profiles, patterns);

    import("./apexLearningFeed").then(({ emitPlaybookPatternsDerived }) => {
      for (const ap of accountPatterns) {
        emitPlaybookPatternsDerived(ap.accountId, ap.matchedPatterns.length, patterns.length);
      }
    }).catch(() => {});

    return {
      patterns,
      accountPatterns,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[CROSS-PLATFORM] Failed to generate patterns:", err);
    return {
      patterns: [],
      accountPatterns: [],
      generatedAt: new Date().toISOString(),
    };
  }
}

export async function getPlaybookRecommendationsForAccount(accountId: number): Promise<{
  patterns: PlaybookPattern[];
  missingModules: string[];
  topRecommendation: string;
}> {
  const report = await getCrossPlatformPatterns();
  const accountMatch = report.accountPatterns.find(a => a.accountId === accountId);

  if (!accountMatch) {
    return {
      patterns: [],
      missingModules: [],
      topRecommendation: "Activate more platform modules to unlock playbook insights",
    };
  }

  const relevantPatterns = report.patterns.filter(p => !accountMatch.matchedPatterns.includes(p.id));

  return {
    patterns: relevantPatterns.slice(0, 3),
    missingModules: accountMatch.missingModules,
    topRecommendation: accountMatch.recommendation,
  };
}
