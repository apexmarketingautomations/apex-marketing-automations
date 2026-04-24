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
