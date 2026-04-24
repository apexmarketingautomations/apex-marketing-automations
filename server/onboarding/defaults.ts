export const DEFAULT_PIPELINE_STAGES: { name: string; position: number }[] = [
  { name: "New Lead", position: 0 },
  { name: "Contacted", position: 1 },
  { name: "Qualified", position: 2 },
  { name: "Proposal Sent", position: 3 },
  { name: "Won", position: 4 },
  { name: "Lost", position: 5 },
];

export const DEFAULT_BRAND_VOICE_SYSTEM_PROMPT =
  "You are a friendly, professional assistant representing this business. " +
  "Keep replies concise, helpful, and on-brand. Be warm but never pushy. " +
  "If a request falls outside what you can help with, offer to connect the customer with a human teammate.";

export const DEFAULT_AI_PROMPT_CONFIG = {
  systemPrompt: DEFAULT_BRAND_VOICE_SYSTEM_PROMPT,
  brandVoice: "Friendly, professional, and concise.",
  autoReplyEnabled: false,
  temperature: 0.7,
  maxTokens: 400,
};

export interface DefaultWorkflow {
  name: string;
  trigger: string;
  enabled: boolean;
  steps: Array<{ action_type: string; params: Record<string, any> }>;
}

export const DEFAULT_WORKFLOWS: DefaultWorkflow[] = [
  {
    name: "Missed Call Text Back",
    trigger: "missed_call",
    enabled: true,
    steps: [
      {
        action_type: "SMS",
        params: {
          body: "Hey {{leadName}}, sorry we missed your call! Someone from {{businessName}} will get back to you shortly. Anything urgent we should know?",
        },
      },
    ],
  },
  {
    name: "Speed-to-Lead",
    trigger: "new_lead",
    enabled: true,
    steps: [
      {
        action_type: "SMS",
        params: {
          body: "Hi {{leadName}}, thanks for reaching out to {{businessName}}! We just got your info and someone will follow up shortly. Reply here anytime.",
        },
      },
    ],
  },
];

export const DEFAULT_WELCOME_SMS_BODY =
  "Welcome to your new account! Your pipeline, default workflows, and AI assistant are ready to go. Reply HELP anytime or sign in to start customizing.";

export interface EffectiveOnboardingDefaults {
  pipelineStages: { name: string; position: number }[];
  workflows: DefaultWorkflow[];
  brandVoiceSystemPrompt: string;
  welcomeSmsBody: string;
}

export function getInCodeDefaults(): EffectiveOnboardingDefaults {
  return {
    pipelineStages: DEFAULT_PIPELINE_STAGES,
    workflows: DEFAULT_WORKFLOWS,
    brandVoiceSystemPrompt: DEFAULT_BRAND_VOICE_SYSTEM_PROMPT,
    welcomeSmsBody: DEFAULT_WELCOME_SMS_BODY,
  };
}

// Reads the operator-editable overrides from the DB and merges with in-code defaults.
// Any missing field in the DB row falls back to the in-code value.
export async function getEffectiveOnboardingDefaults(): Promise<EffectiveOnboardingDefaults> {
  const fallback = getInCodeDefaults();
  try {
    const { db } = await import("../db");
    const {
      onboardingDefaults,
      onboardingDefaultsStageSchema,
      onboardingDefaultsWorkflowSchema,
    } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { z } = await import("zod");

    const [row] = await db
      .select()
      .from(onboardingDefaults)
      .where(eq(onboardingDefaults.id, 1));
    if (!row) return fallback;

    const stagesParsed = z
      .array(onboardingDefaultsStageSchema)
      .safeParse(row.pipelineStages);
    const stages = stagesParsed.success && stagesParsed.data.length > 0
      ? stagesParsed.data
      : fallback.pipelineStages;

    const workflowsParsed = z
      .array(onboardingDefaultsWorkflowSchema)
      .safeParse(row.workflows);
    const workflows: DefaultWorkflow[] = workflowsParsed.success && workflowsParsed.data.length > 0
      ? workflowsParsed.data.map((w) => ({
          name: w.name,
          trigger: w.trigger,
          enabled: w.enabled,
          steps: [{ action_type: "SMS", params: { body: w.smsBody } }],
        }))
      : fallback.workflows;

    return {
      pipelineStages: stages,
      workflows,
      brandVoiceSystemPrompt: row.brandVoiceSystemPrompt?.trim() || fallback.brandVoiceSystemPrompt,
      welcomeSmsBody: row.welcomeSmsBody?.trim() || fallback.welcomeSmsBody,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({
      event: "onboarding_defaults_load_failed",
      timestamp: new Date().toISOString(),
      error: message,
    }));
    return fallback;
  }
}
