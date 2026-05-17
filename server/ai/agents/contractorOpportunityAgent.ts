/**
 * server/ai/agents/contractorOpportunityAgent.ts
 *
 * Contractor Opportunity Agent
 * Scores storm damage / permit / lead signals for home service contractor referrals.
 */

import { runAgent } from "../agentCoordinator";
import type { AgentDefinition, AgentRunOptions } from "../agentCoordinator";
import { isObject, requiresKeys } from "../aiStructuredOutput";

export interface ContractorOpportunityOutput {
  serviceCategory: string;           // e.g. "Roofing", "HVAC", "Plumbing"
  damageEstimateRange: string;       // e.g. "$2,000-$8,000"
  projectUrgency: "immediate" | "scheduled" | "planning";
  homeownerContactAvailable: boolean;
  permitRequired: boolean;
  competitorActivity: "high" | "medium" | "low" | "unknown";
  recommendedContractorTier: "premium" | "standard" | "economy";
  opportunityScore: number;          // 0–100
  bestOutreachWindow: string;        // e.g. "within 24 hours", "within 7 days"
  qualificationNotes: string[];
  confidence: number;
}

const CONTRACTOR_OPPORTUNITY_AGENT: AgentDefinition<ContractorOpportunityOutput> = {
  name: "contractor_opportunity",
  taskType: "scoring",
  promptVersion: "v1.0",
  requestedActions: ["read_case", "update_case_score"],

  buildPrompt(input: unknown) {
    const data = JSON.stringify(input, null, 2);
    return {
      system: `You are a contractor lead qualification analyst for Apex Marketing Automations.
You analyze storm damage reports, permit filings, and homeowner signals to identify contractor service opportunities.

Service categories: Roofing, HVAC, Plumbing, Electrical, Water Damage, General Contracting, Tree Service, Windows/Doors.

Rules:
- Storm damage within 72 hours = immediate urgency
- Permit filings suggest planned work = scheduled
- Score based on actual data, not guesses
- Missing homeowner contact reduces score significantly

Schema:
{
  "serviceCategory": <string>,
  "damageEstimateRange": <string>,
  "projectUrgency": "immediate"|"scheduled"|"planning",
  "homeownerContactAvailable": <boolean>,
  "permitRequired": <boolean>,
  "competitorActivity": "high"|"medium"|"low"|"unknown",
  "recommendedContractorTier": "premium"|"standard"|"economy",
  "opportunityScore": <integer 0-100>,
  "bestOutreachWindow": <string>,
  "qualificationNotes": [<string>, ...],
  "confidence": <float 0-1>
}`,
      user: `Score this contractor opportunity:\n\n${data}`,
    };
  },

  outputValidator: (v): v is ContractorOpportunityOutput =>
    isObject(v) && requiresKeys(["serviceCategory", "opportunityScore", "confidence"])(v),

  defaultConfidence: 0.78,
  maxParseAttempts: 2,
  timeoutMs: 20_000,
};

export async function analyzeContractorOpportunity(
  signalData: unknown,
  opts?: AgentRunOptions,
) {
  return runAgent(CONTRACTOR_OPPORTUNITY_AGENT, signalData, opts);
}
