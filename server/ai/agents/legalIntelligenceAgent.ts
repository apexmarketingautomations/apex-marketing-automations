/**
 * server/ai/agents/legalIntelligenceAgent.ts
 *
 * Legal Intelligence Agent — DUI / Criminal / Court Filing Analysis
 * Classifies legal signals and assesses attorney referral opportunity.
 */

import { runAgent } from "../agentCoordinator";
import type { AgentDefinition, AgentRunOptions } from "../agentCoordinator";
import { isObject, requiresKeys } from "../aiStructuredOutput";

export interface LegalIntelligenceOutput {
  caseClassification: "dui" | "felony" | "misdemeanor" | "civil" | "traffic" | "unknown";
  chargesSummary: string;
  arrestJurisdiction: string;
  estimatedCaseSeverity: "low" | "medium" | "high" | "critical";
  referralRecommended: boolean;
  referralUrgencyDays: number;      // days before referral opportunity expires
  practiceAreaMatch: string[];      // e.g. ["DUI Defense", "Criminal Defense"]
  potentialAttorneyFit: string;     // description of ideal attorney profile
  redFlags: string[];               // anything that reduces opportunity
  opportunityScore: number;         // 0–100
  confidence: number;               // 0–1
}

const LEGAL_INTELLIGENCE_AGENT: AgentDefinition<LegalIntelligenceOutput> = {
  name: "legal_intelligence",
  taskType: "reasoning",
  promptVersion: "v1.0",
  requestedActions: ["read_case", "create_case"],

  buildPrompt(input: unknown) {
    const data = JSON.stringify(input, null, 2);
    return {
      system: `You are a legal intelligence analyst for Apex Marketing Automations.
You analyze arrest records, court filings, and booking data to identify attorney referral opportunities.

Rules:
- Classify charges accurately from available text
- Do NOT identify individuals by name in your reasoning output
- Do NOT provide legal advice
- Flag if data is too sparse for confident classification
- Output severity honestly — low quality signals = low score

Schema:
{
  "caseClassification": "dui"|"felony"|"misdemeanor"|"civil"|"traffic"|"unknown",
  "chargesSummary": <string max 200 chars>,
  "arrestJurisdiction": <string>,
  "estimatedCaseSeverity": "low"|"medium"|"high"|"critical",
  "referralRecommended": <boolean>,
  "referralUrgencyDays": <integer>,
  "practiceAreaMatch": [<string>, ...],
  "potentialAttorneyFit": <string>,
  "redFlags": [<string>, ...],
  "opportunityScore": <integer 0-100>,
  "confidence": <float 0-1>
}`,
      user: `Analyze this legal signal and return the JSON classification:\n\n${data}`,
    };
  },

  outputValidator: (v): v is LegalIntelligenceOutput =>
    isObject(v) &&
    requiresKeys(["caseClassification", "estimatedCaseSeverity", "referralRecommended",
      "opportunityScore", "confidence"])(v),

  defaultConfidence: 0.78,
  maxParseAttempts: 2,
  timeoutMs: 30_000,
};

export async function analyzeLegalSignal(
  signalData: unknown,
  opts?: AgentRunOptions,
) {
  return runAgent(LEGAL_INTELLIGENCE_AGENT, signalData, opts);
}
