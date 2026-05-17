/**
 * server/ai/agents/summarizationAgent.ts
 *
 * Summarization Agent
 * Produces structured summaries of cases, contacts, and signal clusters
 * for operator dashboards and attorney briefs.
 */

import { runAgent } from "../agentCoordinator";
import type { AgentDefinition, AgentRunOptions } from "../agentCoordinator";
import { isObject, requiresKeys } from "../aiStructuredOutput";

export type SummaryFormat = "case_brief" | "contact_profile" | "signal_cluster" | "weekly_digest";

export interface SummarizationInput {
  format: SummaryFormat;
  data: unknown;
  maxWords?: number;
  audienceRole?: "attorney" | "operator" | "admin" | "contractor";
}

export interface SummarizationOutput {
  format: SummaryFormat;
  headline: string;             // 1-line summary (max 100 chars)
  executiveSummary: string;     // 2–3 sentence summary
  keyPoints: string[];          // 3–7 structured bullet points
  actionItems: string[];        // specific recommended actions
  riskFlags: string[];          // anything requiring immediate attention
  dataQualityNote?: string;     // if source data was sparse or conflicting
  wordCount: number;
  confidence: number;
}

const SUMMARIZATION_AGENT: AgentDefinition<SummarizationOutput> = {
  name: "summarization",
  taskType: "summarization",
  promptVersion: "v1.0",
  requestedActions: ["read_case", "read_contact"],

  buildPrompt(input: unknown) {
    const req = input as SummarizationInput;
    const maxWords = req.maxWords ?? 300;
    const audience = req.audienceRole ?? "operator";
    const data = JSON.stringify(req.data, null, 2);

    return {
      system: `You are a case summarization AI for Apex Marketing Automations.
You produce clear, structured summaries of cases, contacts, and signals for ${audience} review.

Format type: ${req.format}
Max words: ${maxWords}

Rules:
- Headline must be under 100 characters
- Do NOT include personally identifiable information in the headline
- Flag any data gaps in dataQualityNote
- actionItems must be specific and actionable
- riskFlags only for genuinely urgent issues

Schema:
{
  "format": "${req.format}",
  "headline": <string max 100 chars>,
  "executiveSummary": <string>,
  "keyPoints": [<string>, ...],
  "actionItems": [<string>, ...],
  "riskFlags": [<string>, ...],
  "dataQualityNote": <string or null>,
  "wordCount": <integer>,
  "confidence": <float 0-1>
}`,
      user: `Summarize the following data:\n\n${data}`,
    };
  },

  outputValidator: (v): v is SummarizationOutput =>
    isObject(v) &&
    requiresKeys(["format", "headline", "executiveSummary", "keyPoints", "confidence"])(v),

  defaultConfidence: 0.88,
  maxParseAttempts: 2,
  timeoutMs: 25_000,
};

export async function summarize(
  input: SummarizationInput,
  opts?: AgentRunOptions,
) {
  return runAgent(SUMMARIZATION_AGENT, input, opts);
}
