/**
 * server/ai/agents/communicationDraftingAgent.ts
 *
 * Communication Drafting Agent
 * Drafts outbound SMS/email/voice scripts for operator review.
 * NEVER sends directly — always requires human approval.
 */

import { runAgent } from "../agentCoordinator";
import type { AgentDefinition, AgentRunOptions } from "../agentCoordinator";
import { isObject, requiresKeys } from "../aiStructuredOutput";

export type CommunicationChannel = "sms" | "email" | "voice_script";

export interface CommunicationDraftInput {
  channel: CommunicationChannel;
  recipientContext: Record<string, unknown>;
  campaignGoal: string;
  brandToneProfile?: string;
  timingConstraints?: string;
  requiredDisclosures?: string[];
}

export interface CommunicationDraftOutput {
  channel: CommunicationChannel;
  subject?: string;           // email only
  body: string;               // SMS body or email body or voice script
  characterCount: number;     // SMS compliance
  estimatedReadTimeSeconds?: number;
  toneProfile: string;        // e.g. "professional", "empathetic", "urgent"
  disclosuresIncluded: string[];
  complianceNotes: string[];  // TCPA/CAN-SPAM flags
  alternativeVersions?: string[];  // 1–2 variants for A/B
  approvalRequired: true;     // always true — never auto-send
  confidence: number;
}

const COMMUNICATION_DRAFTING_AGENT: AgentDefinition<CommunicationDraftOutput> = {
  name: "communication_drafting",
  taskType: "chat",
  promptVersion: "v1.0",
  requestedActions: ["write_message_draft"],  // draft only, never send_sms/send_email
  requiresApproval: true,

  buildPrompt(input: unknown) {
    const req = input as CommunicationDraftInput;
    const data = JSON.stringify(req, null, 2);
    return {
      system: `You are a compliant communications drafting AI for Apex Marketing Automations.
You draft outbound messages (SMS, email, voice scripts) for human review and approval.

Critical rules:
- SMS: max 160 characters per segment, opt-out disclosure required ("Reply STOP to opt out")
- Email: CAN-SPAM compliance required, unsubscribe link placeholder included
- Voice: natural spoken language, no jargon, max 30 seconds
- Never fabricate personal facts about the recipient
- Never use pressure tactics or false urgency
- Never claim to be a government agency
- Always include required disclosures
- approvalRequired is ALWAYS true

Schema:
{
  "channel": <"sms"|"email"|"voice_script">,
  "subject": <string or null>,
  "body": <string>,
  "characterCount": <integer>,
  "estimatedReadTimeSeconds": <integer or null>,
  "toneProfile": <string>,
  "disclosuresIncluded": [<string>, ...],
  "complianceNotes": [<string>, ...],
  "alternativeVersions": [<string>, ...] or null,
  "approvalRequired": true,
  "confidence": <float 0-1>
}`,
      user: `Draft a compliant ${req.channel} communication based on:\n\n${data}`,
    };
  },

  outputValidator: (v): v is CommunicationDraftOutput =>
    isObject(v) &&
    requiresKeys(v, ["channel", "body", "characterCount", "approvalRequired", "confidence"]) &&
    (v as any).approvalRequired === true,

  defaultConfidence: 0.85,
  maxParseAttempts: 2,
  timeoutMs: 30_000,
};

export async function draftCommunication(
  draftInput: CommunicationDraftInput,
  opts?: AgentRunOptions,
) {
  return runAgent(COMMUNICATION_DRAFTING_AGENT, draftInput, opts);
}
