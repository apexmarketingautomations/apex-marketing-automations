import { storage } from "../storage";
import type { ActionCategory } from "./types";

export interface DetectedGap {
  accountId: number;
  gapType: string;
  category: ActionCategory;
  actionType: string;
  confidenceScore: number;
  priority: "critical" | "high" | "medium" | "low";
  description: string;
  context: Record<string, unknown>;
  dependencies: string[];
  requiresAuth?: boolean;
}

const GAP_DETECTORS: Array<(accountId: number) => Promise<DetectedGap[]>> = [
  detectIntegrationGaps,
  detectScoreBasedGaps,
  detectRecommendationGaps,
  detectSetupGaps,
];

export async function detectGapsForAccount(accountId: number): Promise<DetectedGap[]> {
  const allGaps: DetectedGap[] = [];
  for (const detector of GAP_DETECTORS) {
    try {
      const gaps = await detector(accountId);
      allGaps.push(...gaps);
    } catch (err) {
      console.error(`[AUTONOMY-GAP] Detector failed for account ${accountId}:`, (err as Error).message);
    }
  }
  return deduplicateAndSort(allGaps);
}

async function detectIntegrationGaps(accountId: number): Promise<DetectedGap[]> {
  const gaps: DetectedGap[] = [];
  const healthRows = await storage.getIntegrationHealth(accountId);

  for (const health of healthRows) {
    if (health.status === "error" || health.status === "disconnected") {
      gaps.push({
        accountId,
        gapType: "broken_integration",
        category: "repair",
        actionType: "fix_stale_integration_health",
        confidenceScore: 0.9,
        priority: "critical",
        description: `Integration ${health.integrationType}:${health.integrationKey} is ${health.status}`,
        context: {
          integrationType: health.integrationType,
          integrationKey: health.integrationKey,
          status: health.status,
          failureReason: health.failureReason,
          healthScore: health.healthScore,
        },
        dependencies: [],
      });
    } else if (health.status === "degraded") {
      gaps.push({
        accountId,
        gapType: "degraded_integration",
        category: "repair",
        actionType: "fix_stale_integration_health",
        confidenceScore: 0.7,
        priority: "high",
        description: `Integration ${health.integrationType}:${health.integrationKey} is degraded (health: ${health.healthScore})`,
        context: {
          integrationType: health.integrationType,
          integrationKey: health.integrationKey,
          status: health.status,
          healthScore: health.healthScore,
        },
        dependencies: [],
      });
    }
  }

  return gaps;
}

async function detectScoreBasedGaps(accountId: number): Promise<DetectedGap[]> {
  const gaps: DetectedGap[] = [];
  const scores = await storage.getIntelligenceScores(accountId, "account", String(accountId));

  for (const score of scores) {
    const inputs = score.inputs as Record<string, unknown> | null;

    if (score.scoreType === "launch_readiness_score" && score.scoreValue < 30) {
      gaps.push({
        accountId,
        gapType: "low_launch_readiness",
        category: "setup",
        actionType: "create_readiness_baseline",
        confidenceScore: 0.85,
        priority: "high",
        description: `Launch readiness score is critically low (${score.scoreValue}/100)`,
        context: { scoreValue: score.scoreValue, inputs },
        dependencies: [],
      });
    }

    if (score.scoreType === "account_maturity_score" && score.scoreValue < 20) {
      gaps.push({
        accountId,
        gapType: "immature_account",
        category: "repair",
        actionType: "fix_incomplete_setup_state",
        confidenceScore: 0.9,
        priority: "high",
        description: `Account maturity is very low (${score.scoreValue}/100)`,
        context: { scoreValue: score.scoreValue, inputs },
        dependencies: [],
      });
    }

    if (score.scoreType === "workflow_effectiveness_score" && score.scoreValue === 0) {
      gaps.push({
        accountId,
        gapType: "no_workflows",
        category: "setup",
        actionType: "create_default_workflow",
        confidenceScore: 0.8,
        priority: "medium",
        description: "No workflows configured — automation is unavailable",
        context: { scoreValue: score.scoreValue, inputs },
        dependencies: [],
      });
    }

    if (score.scoreType === "pipeline_health_score" && score.scoreValue <= 5) {
      const existingStages = await storage.getPipelineStages(accountId);
      if (existingStages.length === 0) {
        gaps.push({
          accountId,
          gapType: "empty_pipeline",
          category: "setup",
          actionType: "create_default_pipeline",
          confidenceScore: 0.7,
          priority: "medium",
          description: "Pipeline is empty — no stages or deals configured",
          context: { scoreValue: score.scoreValue, inputs },
          dependencies: [],
        });
      }
    }

    if (score.scoreType === "domain_health_score" && score.scoreValue < 40 && inputs) {
      if (!inputs.dnsConfigured) {
        gaps.push({
          accountId,
          gapType: "dns_not_configured",
          category: "repair",
          actionType: "restore_required_defaults",
          confidenceScore: 0.85,
          priority: "high",
          description: `Domain ${score.entityId} DNS is not configured`,
          context: { entityId: score.entityId, scoreValue: score.scoreValue, inputs },
          dependencies: [],
        });
      }
    }
  }

  const siteScores = await storage.getScoresByType(accountId, "site_health_score");
  for (const score of siteScores) {
    const inputs = score.inputs as Record<string, unknown> | null;
    if (score.scoreValue < 40 && inputs && !inputs.isPublished) {
      gaps.push({
        accountId,
        gapType: "unpublished_site",
        category: "optimization",
        actionType: "activate_recommended_defaults",
        confidenceScore: 0.85,
        priority: "high",
        description: `Site ${score.entityId} exists but is not published`,
        context: { entityId: score.entityId, scoreValue: score.scoreValue, inputs },
        dependencies: [],
      });
    }
  }

  return gaps;
}

async function detectRecommendationGaps(accountId: number): Promise<DetectedGap[]> {
  const gaps: DetectedGap[] = [];
  const recs = await storage.getRecommendations(accountId, { status: "pending", limit: 50 });

  const recToAction: Record<string, { actionType: string; category: ActionCategory; confidence: number }> = {
    fix_dns: { actionType: "restore_required_defaults", category: "repair", confidence: 0.85 },
    fix_integration: { actionType: "fix_stale_integration_health", category: "repair", confidence: 0.9 },
    complete_setup: { actionType: "fix_incomplete_setup_state", category: "repair", confidence: 0.85 },
    create_first_workflow: { actionType: "create_default_workflow", category: "setup", confidence: 0.75 },
    create_first_deal: { actionType: "create_default_pipeline", category: "setup", confidence: 0.7 },
    create_digital_card: { actionType: "create_digital_card_record", category: "setup", confidence: 0.65 },
    create_automation: { actionType: "create_live_automation", category: "setup", confidence: 0.7 },
    activate_ad_campaigns: { actionType: "activate_recommended_defaults", category: "optimization", confidence: 0.65 },
    add_ai_to_workflow: { actionType: "optimize_workflow_steps", category: "optimization", confidence: 0.6 },
  };

  for (const rec of recs) {
    const mapping = recToAction[rec.recommendationType];
    if (mapping) {
      gaps.push({
        accountId,
        gapType: `recommendation:${rec.recommendationType}`,
        category: mapping.category,
        actionType: mapping.actionType,
        confidenceScore: mapping.confidence,
        priority: rec.priority as DetectedGap["priority"],
        description: rec.title,
        context: {
          recommendationId: rec.id,
          entityType: rec.entityType,
          entityId: rec.entityId,
          recommendedAction: rec.recommendedAction,
        },
        dependencies: [],
      });
    }
  }

  return gaps;
}

async function detectSetupGaps(accountId: number): Promise<DetectedGap[]> {
  const gaps: DetectedGap[] = [];
  const connections = await storage.getIntegrationConnections(accountId);
  const handledProviders = new Set(
    connections
      .filter(c => c.status === "connected" || c.status === "pending")
      .map(c => c.provider)
  );

  const essentialProviders = [
    { provider: "google", priority: "high" as const, description: "Google integration not connected — email, calendar, and maps unavailable" },
    { provider: "meta", priority: "medium" as const, description: "Meta integration not connected — Facebook/Instagram messaging unavailable" },
    { provider: "twilio", priority: "medium" as const, description: "Twilio not connected — SMS/voice unavailable" },
  ];

  for (const ep of essentialProviders) {
    if (!handledProviders.has(ep.provider) && !handledProviders.has(`${ep.provider}-ads`)) {
      gaps.push({
        accountId,
        gapType: `missing_integration:${ep.provider}`,
        category: "setup",
        actionType: "initialize_integration_health",
        confidenceScore: 0.75,
        priority: ep.priority,
        description: ep.description,
        context: { provider: ep.provider },
        dependencies: [],
        requiresAuth: true,
      });
    }
  }

  return gaps;
}

function deduplicateAndSort(gaps: DetectedGap[]): DetectedGap[] {
  const seen = new Set<string>();
  const unique: DetectedGap[] = [];
  for (const gap of gaps) {
    const key = `${gap.accountId}:${gap.actionType}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(gap);
    }
  }

  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  unique.sort((a, b) => {
    const pDiff = (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
    if (pDiff !== 0) return pDiff;
    return b.confidenceScore - a.confidenceScore;
  });

  return unique;
}
