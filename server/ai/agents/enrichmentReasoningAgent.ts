/**
 * server/ai/agents/enrichmentReasoningAgent.ts
 *
 * Enrichment Reasoning Agent
 * Synthesizes raw skip-trace and enrichment data into a structured contact profile.
 */

import { runAgent } from "../agentCoordinator";
import type { AgentDefinition, AgentRunOptions } from "../agentCoordinator";
import { isObject, requiresKeys } from "../aiStructuredOutput";

export interface EnrichmentReasoningOutput {
  contactabilityScore: number;       // 0–100
  phoneQualityScore: number;         // 0–100, based on line type + recency
  emailQualityScore: number;         // 0–100
  estimatedAgeRange: string;         // e.g. "35-45"
  likelyDecisionMaker: boolean;
  preferredOutreachChannel: "sms" | "email" | "phone" | "mail";
  enrichmentGaps: string[];          // fields that are missing or low-quality
  conflictingDataPoints: string[];   // fields with contradictory values across sources
  recommendedFollowUpSources: string[];  // suggested enrichment sources
  overallProfileStrength: "weak" | "moderate" | "strong";
  confidence: number;
}

const ENRICHMENT_REASONING_AGENT: AgentDefinition<EnrichmentReasoningOutput> = {
  name: "enrichment_reasoning",
  taskType: "extraction",
  promptVersion: "v1.0",
  requestedActions: ["read_contact"],

  buildPrompt(input: unknown) {
    const data = JSON.stringify(input, null, 2);
    return {
      system: `You are an enrichment data quality analyst for Apex Marketing Automations.
You evaluate skip-trace results and contact enrichment data to assess profile quality
and determine the best outreach strategy.

Rules:
- Mobile phones score higher than landlines for SMS outreach
- Email domains: gmail/yahoo = personal (medium score), work domains = high score
- Conflicting addresses or multiple last names = data conflict flag
- Missing phone = "weak" profile regardless of other data
- Do NOT invent or fill in missing data points

Schema:
{
  "contactabilityScore": <integer 0-100>,
  "phoneQualityScore": <integer 0-100>,
  "emailQualityScore": <integer 0-100>,
  "estimatedAgeRange": <string>,
  "likelyDecisionMaker": <boolean>,
  "preferredOutreachChannel": "sms"|"email"|"phone"|"mail",
  "enrichmentGaps": [<string>, ...],
  "conflictingDataPoints": [<string>, ...],
  "recommendedFollowUpSources": [<string>, ...],
  "overallProfileStrength": "weak"|"moderate"|"strong",
  "confidence": <float 0-1>
}`,
      user: `Analyze this enrichment data and return the profile quality assessment:\n\n${data}`,
    };
  },

  outputValidator: (v): v is EnrichmentReasoningOutput =>
    isObject(v) &&
    requiresKeys(v, ["contactabilityScore", "overallProfileStrength", "confidence"]),

  defaultConfidence: 0.83,
  maxParseAttempts: 2,
  timeoutMs: 20_000,
};

export async function reasonEnrichmentData(
  enrichmentData: unknown,
  opts?: AgentRunOptions,
) {
  return runAgent(ENRICHMENT_REASONING_AGENT, enrichmentData, opts);
}
