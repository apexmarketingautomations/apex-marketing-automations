/**
 * server/ai/agents/routingRecommendationAgent.ts
 *
 * Routing Recommendation Agent
 * Determines the best service/attorney/contractor match for a given lead.
 */

import { runAgent } from "../agentCoordinator";
import type { AgentDefinition, AgentRunOptions } from "../agentCoordinator";
import { isObject, requiresKeys } from "../aiStructuredOutput";

export interface RoutingRecommendationOutput {
  recommendedServiceType: string;
  primaryMatchScore: number;          // 0–100
  routingConfidence: number;          // 0–1
  matchRationale: string;
  alternativeRoutingOptions: Array<{
    serviceType: string;
    matchScore: number;
    rationale: string;
  }>;
  routingBlockers: string[];          // reasons routing may fail
  estimatedConversionProbability: number;  // 0–1
  priorityTier: "tier1" | "tier2" | "tier3";
  recommendedSLA: string;             // e.g. "contact within 2 hours"
}

const ROUTING_RECOMMENDATION_AGENT: AgentDefinition<RoutingRecommendationOutput> = {
  name: "routing_recommendation",
  taskType: "classification",
  promptVersion: "v1.0",
  requestedActions: ["read_case", "enqueue_job"],

  buildPrompt(input: unknown) {
    const data = JSON.stringify(input, null, 2);
    return {
      system: `You are a lead routing intelligence system for Apex Marketing Automations.
You analyze lead profiles and signal data to recommend the optimal service routing.

Service types: Attorney Referral, Insurance Referral, Home Service Contractor,
Reputation Management, Business Compliance, AI Receptionist, Skip Trace Enrichment.

Priority tiers:
- tier1: High value, high urgency, contact within 2 hours
- tier2: Medium value or urgency, contact within 24 hours
- tier3: Lower priority, contact within 72 hours

Rules:
- Score based on signal quality, contact availability, and urgency
- Provide 1–3 alternative routing options
- Flag any data gaps that reduce conversion probability

Schema:
{
  "recommendedServiceType": <string>,
  "primaryMatchScore": <integer 0-100>,
  "routingConfidence": <float 0-1>,
  "matchRationale": <string>,
  "alternativeRoutingOptions": [{"serviceType": <string>, "matchScore": <integer>, "rationale": <string>}],
  "routingBlockers": [<string>, ...],
  "estimatedConversionProbability": <float 0-1>,
  "priorityTier": "tier1"|"tier2"|"tier3",
  "recommendedSLA": <string>
}`,
      user: `Recommend routing for this lead:\n\n${data}`,
    };
  },

  outputValidator: (v): v is RoutingRecommendationOutput =>
    isObject(v) &&
    requiresKeys(["recommendedServiceType", "primaryMatchScore", "priorityTier"])(v),

  defaultConfidence: 0.80,
  maxParseAttempts: 2,
  timeoutMs: 20_000,
};

export async function recommendRouting(
  leadData: unknown,
  opts?: AgentRunOptions,
) {
  return runAgent(ROUTING_RECOMMENDATION_AGENT, leadData, opts);
}
