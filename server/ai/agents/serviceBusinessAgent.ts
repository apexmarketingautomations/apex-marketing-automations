/**
 * server/ai/agents/serviceBusinessAgent.ts
 *
 * Service Business Automation Agent
 * Analyzes negative reviews, license violations, and health inspection data
 * for service business outreach opportunities.
 */

import { runAgent } from "../agentCoordinator";
import type { AgentDefinition, AgentRunOptions } from "../agentCoordinator";
import { isObject, requiresKeys } from "../aiStructuredOutput";

export interface ServiceBusinessOutput {
  businessCategory: string;
  painPointClassification: string[];    // e.g. ["staffing", "reputation", "compliance"]
  reputationScore: number;              // 0–100, lower = worse = higher opportunity
  complianceRiskLevel: "none" | "low" | "medium" | "high" | "critical";
  outreachRecommendation: string;
  solutionFitScore: number;             // 0–100: how well Apex services fit this business
  decisionMakerTitle: string;           // likely contact role
  urgencySignals: string[];
  opportunityScore: number;
  confidence: number;
}

const SERVICE_BUSINESS_AGENT: AgentDefinition<ServiceBusinessOutput> = {
  name: "service_business",
  taskType: "classification",
  promptVersion: "v1.0",
  requestedActions: ["read_case", "write_message_draft"],

  buildPrompt(input: unknown) {
    const data = JSON.stringify(input, null, 2);
    return {
      system: `You are a service business intelligence analyst for Apex Marketing Automations.
You analyze reviews, license data, and health inspection records to identify businesses
that need reputation management, compliance help, or customer re-engagement services.

Target verticals: Restaurants, Salons, Spas, Auto Shops, Medical Offices, Dental Practices,
Fitness Studios, Cleaning Services, Landscaping.

Rules:
- Low review ratings + recent violations = high urgency
- License expiry within 30 days = critical compliance risk
- Score based on data, not business size assumptions

Schema:
{
  "businessCategory": <string>,
  "painPointClassification": [<string>, ...],
  "reputationScore": <integer 0-100>,
  "complianceRiskLevel": "none"|"low"|"medium"|"high"|"critical",
  "outreachRecommendation": <string max 200 chars>,
  "solutionFitScore": <integer 0-100>,
  "decisionMakerTitle": <string>,
  "urgencySignals": [<string>, ...],
  "opportunityScore": <integer 0-100>,
  "confidence": <float 0-1>
}`,
      user: `Analyze this service business signal:\n\n${data}`,
    };
  },

  outputValidator: (v): v is ServiceBusinessOutput =>
    isObject(v) && requiresKeys(["businessCategory", "opportunityScore", "confidence"])(v),

  defaultConfidence: 0.76,
  maxParseAttempts: 2,
  timeoutMs: 20_000,
};

export async function analyzeServiceBusiness(
  signalData: unknown,
  opts?: AgentRunOptions,
) {
  return runAgent(SERVICE_BUSINESS_AGENT, signalData, opts);
}
