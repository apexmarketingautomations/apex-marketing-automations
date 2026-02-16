import { apiRequest } from "./queryClient";

export const API = {
  AUTH: {
    USER: "/api/auth/user",
    LOGIN: "/api/login",
    LOGOUT: "/api/logout",
  },
  ACCOUNTS: "/api/accounts",
  MESSAGES: "/api/messages",
  WORKFLOWS: "/api/workflows",
  BOTS: {
    TRAIN: "/api/bots/train",
    JOB: "/api/jobs",
  },
  BLUEPRINTS: "/api/blueprints",
  ONBOARDING: "/api/onboarding",
  GENERATION: {
    AD_CAMPAIGN: "/api/generate-ad-campaign",
    IMAGE: "/api/generate/image",
    VIDEO: "/api/generate/video",
  },
  VOICE: {
    CREATE: "/api/voice-agents/create",
    LIST: "/api/voice-agents",
    CALL: "/api/voice-agents/call",
    POWER_DIAL: "/api/voice-agents/power-dial",
    GENERATE_PERSONA: "/api/voice-agents/generate-persona",
    CALLS: "/api/voice-agents/calls",
    WEB_CALL: "/api/vapi/start-web-call",
    CONFIG: "/api/vapi/get-config",
  },
  PHONE: {
    CONFIG: "/api/phone-numbers/config",
    SEARCH: "/api/phone-numbers/search",
    PURCHASE: "/api/phone-numbers/purchase",
    LIST: "/api/phone-numbers",
  },
  UPLOAD: {
    AD_IMAGE: "/api/upload-ad-image",
  },
  DOWNLOAD: "/api/download-project",
  PAYMENTS: {
    SUBSCRIPTION: "/api/billing/subscription",
  },
} as const;

export const api = {
  getAccounts: async () => {
    const res = await apiRequest("GET", API.ACCOUNTS);
    return res.json();
  },

  getMessages: async (subAccountId: number) => {
    const res = await apiRequest("GET", `${API.MESSAGES}/${subAccountId}`);
    return res.json();
  },

  sendMessage: async (data: {
    subAccountId: number;
    contactPhone: string;
    body: string;
    channel: string;
    direction: string;
    status: string;
  }) => {
    const res = await apiRequest("POST", API.MESSAGES, data);
    return res.json();
  },

  getWorkflows: async () => {
    const res = await apiRequest("GET", API.WORKFLOWS);
    return res.json();
  },

  createWorkflow: async (data: { name: string; trigger: string; steps: any; subAccountId?: number | null }) => {
    const res = await apiRequest("POST", API.WORKFLOWS, data);
    return res.json();
  },

  updateWorkflow: async (id: number, data: Partial<{ name: string; trigger: string; steps: any }>) => {
    const res = await apiRequest("PATCH", `${API.WORKFLOWS}/${id}`, data);
    return res.json();
  },

  startTraining: async (url: string, persona: string) => {
    const res = await apiRequest("POST", API.BOTS.TRAIN, { url, persona });
    return res.json();
  },

  getTrainingJob: async (jobId: number) => {
    const res = await apiRequest("GET", `${API.BOTS.JOB}/${jobId}`);
    return res.json();
  },

  getBlueprint: async (industryId: string) => {
    const res = await apiRequest("GET", `${API.BLUEPRINTS}/${industryId}`);
    return res.json();
  },

  onboard: async (industryId: string) => {
    const res = await apiRequest("POST", `${API.ONBOARDING}/${industryId}`);
    return res.json();
  },
};
