/**
 * server/ai/agents/insuranceOpportunityAgent.ts
 *
 * Insurance Opportunity Agent
 * Evaluates crash/injury signals for PIP, BI, and homeowner insurance referrals.
 */

import { runAgent } from "../agentCoordinator";
import type { AgentDefinition, AgentRunOptions } from "../agentCoordinator";
import { isObject, requiresKeys } from "../aiStructuredOutput";

export interface InsuranceOpportunityOutput {
  opportunityType: "pip" | "bi" | "homeowner" | "sr22" | "none";
  estimatedCoverageLimit: number;        // USD
  claimUrgencyDays: number;
  injurySeverityEstimate: "minor" | "moderate" | "severe" | "fatal" | "unknown";
  liabilityPartyCount: number;
  recommendedCarrierTypes: string[];     // e.g. ["PIP carrier", "BI carrier"]
  contactabilityScore: number;           // 0–100: how reachable is the party
  opportunityScore: number;              // 0–100
  blockingFactors: string[];             // reasons opportunity may not convert
  confidence: number;
}

const INSURANCE_OPPORTUNITY_AGENT: AgentDefinition<InsuranceOpportunityOutput> = {
  name: "insurance_opportunity",
  taskType: "scoring",
  promptVersion: "v1.0",
  requestedActions: ["read_case", "update_case_score"],

  buildPrompt(input: unknown) {
    const data = JSON.stringify(input, null, 2);
    return {
      system: `You are an insurance opportunity analyst for Apex Marketing Automations.
You evaluate crash reports, incident data, and injury signals to identify insurance referral opportunities.

Coverage types:
- PIP (Personal Injury Protection): injury + contact + within statute window
- BI (Bodily Injury): fault party + injuries + multi-vehicle
- Homeowner: property damage + owner contact available
- SR-22: DUI/license suspension + driver contact

Rules:
- Score based on actual data fields, not assumptions
- A missing phone number reduces contactabilityScore significantly
- Age of incident beyond 30 days reduces urgency
- Do NOT speculate on fault without explicit data

Schema:
{
  "opportunityType": "pip"|"bi"|"homeowner"|"sr22"|"none",
  "estimatedCoverageLimit": <integer USD>,
  "claimUrgencyDays": <integer>,
  "injurySeverityEstimate": "minor"|"moderate"|"severe"|"fatal"|"unknown",
  "liabilityPartyCount": <integer>,
  "recommendedCarrierTypes": [<string>, ...],
  "contactabilityScore": <integer 0-100>,
  "opportunityScore": <integer 0-100>,
  "blockingFactors": [<string>, ...],
  "confidence": <float 0-1>
}`,
      user: `Evaluate this incident for insurance opportunity:\n\n${data}`,
    };
  },

  outputValidator: (v): v is InsuranceOpportunityOutput =>
    isObject(v) &&
    requiresKeys(["opportunityType", "opportunityScore", "confidence"])(v),

  defaultConfidence: 0.80,
  maxParseAttempts: 2,
  timeoutMs: 25_000,
};

export async function analyzeInsuranceOpportunity(
  incidentData: unknown,
  opts?: AgentRunOptions,
) {
  return runAgent(INSURANCE_OPPORTUNITY_AGENT, incidentData, opts);
}
