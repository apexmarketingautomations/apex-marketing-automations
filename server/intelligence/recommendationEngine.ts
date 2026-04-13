import { storage } from "../storage";
import { db } from "../db";
import { eq, and, sql, gte, isNull } from "drizzle-orm";
import {
  intelligenceScores, domains, savedSites, contacts, universalEvents,
  integrationHealthState, liveAutomations
} from "@shared/schema";

type RecommendationInput = {
  accountId: number;
  entityType: string;
  entityId: string;
  recommendationType: string;
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  whyThisExists: string;
  recommendedAction?: Record<string, unknown>;
  sourceScoreId?: number;
};

async function createIfNotDuplicate(input: RecommendationInput): Promise<void> {
  const existing = await storage.getRecommendations(input.accountId, { status: "pending", limit: 200 });
  const isDupe = existing.some(
    r => r.entityType === input.entityType &&
      r.entityId === input.entityId &&
      r.recommendationType === input.recommendationType
  );
  if (isDupe) return;
  await storage.createRecommendation(input);
}

export async function generateDomainRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const domainScores = await storage.getScoresByType(accountId, "domain_health_score");

  for (const score of domainScores) {
    const inputs = score.inputs as Record<string, unknown> | null;
    if (!inputs) continue;

    if (score.scoreValue < 40) {
      if (!inputs.dnsConfigured) {
        await createIfNotDuplicate({
          accountId,
          entityType: "domain",
          entityId: score.entityId,
          recommendationType: "fix_dns",
          priority: "high",
          title: "Configure DNS for your domain",
          description: "Your domain DNS is not configured. Set up CNAME and TXT records to activate it.",
          whyThisExists: `Domain health score is ${score.scoreValue}/100 — DNS not configured`,
          recommendedAction: { action: "navigate", target: "/domains", step: "dns_setup" },
          sourceScoreId: score.id,
        });
        count++;
      }

      if (!inputs.hasSite) {
        await createIfNotDuplicate({
          accountId,
          entityType: "domain",
          entityId: score.entityId,
          recommendationType: "attach_site",
          priority: "medium",
          title: "Attach a website to your domain",
          description: "Your domain has no website linked. Build and attach a site to make it useful.",
          whyThisExists: `Domain health score is ${score.scoreValue}/100 — no site attached`,
          recommendedAction: { action: "navigate", target: "/site-builder" },
          sourceScoreId: score.id,
        });
        count++;
      }
    }
  }
  return count;
}

export async function generateSiteRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const siteScores = await storage.getScoresByType(accountId, "site_health_score");

  for (const score of siteScores) {
    const inputs = score.inputs as Record<string, unknown> | null;
    if (!inputs) continue;

    if (!inputs.isPublished) {
      await createIfNotDuplicate({
        accountId,
        entityType: "site",
        entityId: score.entityId,
        recommendationType: "publish_site",
        priority: "high",
        title: "Publish your website",
        description: "Your site is built but not published. Publish it to make it live and start receiving visitors.",
        whyThisExists: `Site health score is ${score.scoreValue}/100 — site not published`,
        recommendedAction: { action: "navigate", target: `/site-builder/${score.entityId}` },
        sourceScoreId: score.id,
      });
      count++;
    }

    if (!inputs.hasDomain) {
      await createIfNotDuplicate({
        accountId,
        entityType: "site",
        entityId: score.entityId,
        recommendationType: "add_domain",
        priority: "medium",
        title: "Add a custom domain to your site",
        description: "Your site doesn't have a custom domain. Adding one improves credibility and SEO.",
        whyThisExists: `Site health score is ${score.scoreValue}/100 — no custom domain`,
        recommendedAction: { action: "navigate", target: "/domains" },
        sourceScoreId: score.id,
      });
      count++;
    }
  }
  return count;
}

export async function generateLeadRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const leadScores = await storage.getScoresByType(accountId, "lead_intent_score");

  for (const score of leadScores) {
    if (score.scoreValue >= 60 && score.scoreBand !== "excellent") {
      await createIfNotDuplicate({
        accountId,
        entityType: "contact",
        entityId: score.entityId,
        recommendationType: "follow_up_high_intent",
        priority: "high",
        title: "Follow up with high-intent lead",
        description: `This contact has a lead intent score of ${score.scoreValue}. They've shown strong interest — follow up now before they go cold.`,
        whyThisExists: `Lead intent score ${score.scoreValue}/100 indicates active engagement`,
        recommendedAction: { action: "navigate", target: "/inbox", contactId: score.entityId },
        sourceScoreId: score.id,
      });
      count++;
    }
  }
  return count;
}

export async function generateIntegrationRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const healthRows = await storage.getIntegrationHealth(accountId);

  for (const health of healthRows) {
    if (health.status === "error" || health.status === "disconnected") {
      await createIfNotDuplicate({
        accountId,
        entityType: "integration",
        entityId: `${health.integrationType}:${health.integrationKey}`,
        recommendationType: "fix_integration",
        priority: "critical",
        title: `Reconnect ${health.integrationType} integration`,
        description: `Your ${health.integrationType} integration (${health.integrationKey}) is ${health.status}. ${health.failureReason || 'Check configuration and reconnect.'}`,
        whyThisExists: `Integration health: ${health.status}, last failure: ${health.lastFailureAt?.toISOString() || 'unknown'}`,
        recommendedAction: { action: "navigate", target: "/integrations" },
      });
      count++;
    }
  }
  return count;
}

export async function generateAccountRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const scores = await storage.getIntelligenceScores(accountId, "account", String(accountId));

  for (const score of scores) {
    if (score.scoreType === "launch_readiness_score" && score.scoreValue < 50) {
      const inputs = score.inputs as Record<string, unknown> | null;
      if (inputs && !inputs.activeAutomations) {
        await createIfNotDuplicate({
          accountId,
          entityType: "account",
          entityId: String(accountId),
          recommendationType: "create_automation",
          priority: "medium",
          title: "Set up your first automation",
          description: "Automations save you time by handling repetitive tasks. Create a workflow to auto-respond to leads or schedule follow-ups.",
          whyThisExists: `Launch readiness is ${score.scoreValue}/100 — no active automations found`,
          recommendedAction: { action: "navigate", target: "/workflow-builder" },
          sourceScoreId: score.id,
        });
        count++;
      }
    }

    if (score.scoreType === "account_maturity_score" && score.scoreValue < 30) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "complete_setup",
        priority: "high",
        title: "Complete your account setup",
        description: "Your account is still in early stages. Add contacts, build a site, and connect integrations to unlock the platform's full potential.",
        whyThisExists: `Account maturity score is ${score.scoreValue}/100`,
        recommendedAction: { action: "navigate", target: "/onboarding" },
        sourceScoreId: score.id,
      });
      count++;
    }
  }
  return count;
}

export async function runAllRecommendationsForAccount(accountId: number): Promise<number> {
  console.log(`[APEX-INTEL] Generating recommendations for account ${accountId}...`);
  let total = 0;
  try {
    total += await generateDomainRecommendations(accountId);
    total += await generateSiteRecommendations(accountId);
    total += await generateLeadRecommendations(accountId);
    total += await generateIntegrationRecommendations(accountId);
    total += await generateAccountRecommendations(accountId);
    console.log(`[APEX-INTEL] Generated ${total} new recommendations for account ${accountId}`);
  } catch (err) {
    console.error(`[APEX-INTEL] Recommendation generation failed for account ${accountId}:`, (err as Error).message);
  }
  return total;
}
