/**
 * server/ai/agents/signalAnalysisAgent.ts
 *
 * Signal Analysis Agent
 * Analyzes raw signal data (arrests, crashes, court filings, reviews)
 * and returns a structured opportunity assessment.
 */

import { runAgent } from "../agentCoordinator";
import type { AgentDefinition } from "../agentCoordinator";
import type { AgentRunOptions } from "../agentCoordinator";
import { isObject, requiresKeys } from "../aiStructuredOutput";

// ── Output schema ─────────────────────────────────────────────────────────────

export interface SignalAnalysisOutput {
  opportunityScore: number;     // 0–100
  urgencyScore: number;         // 0–100
  signalType: string;
  primaryCategory: string;
  keyFindings: string[];        // 2–5 bullet findings
  recommendedActions: string[]; // specific next steps
  confidence: number;           // 0–1
  reasoning: string;
}

// ── Agent definition ──────────────────────────────────────────────────────────

const SIGNAL_ANALYSIS_AGENT: AgentDefinition<SignalAnalysisOutput> = {
  name: "signal_analysis",
  taskType: "scoring",
  promptVersion: "v1.0",
  requestedActions: ["read_case", "update_case_score"],

  buildPrompt(input: unknown) {
    const data = JSON.stringify(input, null, 2);
    return {
      system: `You are a signal analysis AI for Apex Marketing Automations. Your job is to analyze
incoming signals (arrests, crashes, court filings, business reviews, license data) and
produce a structured opportunity assessment for the relevant service vertical.

Rules:
- Score objectively based on data quality and recency
- Do NOT fabricate contact details or case facts
- Flag low-confidence assessments clearly
- Output ONLY valid JSON matching the exact schema

Schema:
{
  "opportunityScore": <integer 0-100>,
  "urgencyScore": <integer 0-100>,
  "signalType": <string>,
  "primaryCategory": <string>,
  "keyFindings": [<string>, ...],
  "recommendedActions": [<string>, ...],
  "confidence": <float 0-1>,
  "reasoning": <string>
}`,
      user: `Analyze this signal data and return the JSON assessment:\n\n${data}`,
    };
  },

  outputValidator: (v): v is SignalAnalysisOutput =>
    isObject(v) &&
    requiresKeys(v, ["opportunityScore", "urgencyScore", "signalType", "primaryCategory",
      "keyFindings", "recommendedActions", "confidence", "reasoning"]),

  defaultConfidence: 0.82,
  maxParseAttempts: 2,
  timeoutMs: 25_000,
};

export async function analyzeSignal(
  signalData: unknown,
  opts?: AgentRunOptions,
): Promise<ReturnType<typeof runAgent<SignalAnalysisOutput>>> {
  return runAgent(SIGNAL_ANALYSIS_AGENT, signalData, opts);
}
