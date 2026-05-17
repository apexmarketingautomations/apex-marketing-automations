/**
 * server/ai/agents/workflowOrchestrationAgent.ts
 *
 * Workflow Orchestration Agent
 * Parses workflow state and recommends the next deterministic step.
 * Does NOT execute steps — returns a structured next-action plan.
 */

import { runAgent } from "../agentCoordinator";
import type { AgentDefinition, AgentRunOptions } from "../agentCoordinator";
import { isObject, requiresKeys } from "../aiStructuredOutput";

export interface WorkflowNextAction {
  actionType: string;          // e.g. "send_followup_sms", "escalate_to_human", "wait"
  actionParams: Record<string, unknown>;
  rationale: string;
  expectedOutcome: string;
  fallbackAction: string;      // if primary action is blocked
  humanApprovalRequired: boolean;
  estimatedSuccessProbability: number;  // 0–1
  stepNumber: number;
  totalEstimatedSteps: number;
}

export interface WorkflowOrchestrationOutput {
  workflowId: string;
  currentStage: string;
  completionPercentage: number;     // 0–100
  nextActions: WorkflowNextAction[];
  workflowHealth: "healthy" | "stalled" | "blocked" | "completed";
  blockingReason?: string;
  recommendedHumanIntervention: boolean;
  interventionReason?: string;
  confidence: number;
}

const WORKFLOW_ORCHESTRATION_AGENT: AgentDefinition<WorkflowOrchestrationOutput> = {
  name: "workflow_orchestration",
  taskType: "workflow-analysis",
  promptVersion: "v1.0",
  requestedActions: ["read_case", "enqueue_job", "escalate_to_human"],

  buildPrompt(input: unknown) {
    const data = JSON.stringify(input, null, 2);
    return {
      system: `You are a workflow orchestration AI for Apex Marketing Automations.
You analyze workflow state and recommend the next deterministic step without executing it.

Rules:
- NEVER recommend recursive or looping steps
- If workflow is stalled >72 hours, always recommend human intervention
- humanApprovalRequired must be true for any communication steps
- Provide 1–3 nextActions in priority order
- Never recommend actions outside the approved action list: send_followup_sms,
  send_email_draft, escalate_to_human, enrich_contact, update_case_stage,
  wait, close_workflow, request_review

Schema:
{
  "workflowId": <string>,
  "currentStage": <string>,
  "completionPercentage": <integer 0-100>,
  "nextActions": [{
    "actionType": <string>,
    "actionParams": <object>,
    "rationale": <string>,
    "expectedOutcome": <string>,
    "fallbackAction": <string>,
    "humanApprovalRequired": <boolean>,
    "estimatedSuccessProbability": <float 0-1>,
    "stepNumber": <integer>,
    "totalEstimatedSteps": <integer>
  }],
  "workflowHealth": "healthy"|"stalled"|"blocked"|"completed",
  "blockingReason": <string or null>,
  "recommendedHumanIntervention": <boolean>,
  "interventionReason": <string or null>,
  "confidence": <float 0-1>
}`,
      user: `Analyze this workflow state and return the next-action plan:\n\n${data}`,
    };
  },

  outputValidator: (v): v is WorkflowOrchestrationOutput =>
    isObject(v) &&
    requiresKeys(["workflowId", "workflowHealth", "nextActions", "confidence"])(v),

  defaultConfidence: 0.84,
  maxParseAttempts: 2,
  timeoutMs: 30_000,
};

export async function orchestrateWorkflow(
  workflowState: unknown,
  opts?: AgentRunOptions,
) {
  return runAgent(WORKFLOW_ORCHESTRATION_AGENT, workflowState, opts);
}
