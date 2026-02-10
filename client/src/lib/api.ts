import { apiRequest } from "./queryClient";

export const api = {
  getAccounts: async () => {
    const res = await apiRequest("GET", "/api/accounts");
    return res.json();
  },

  getMessages: async (subAccountId: number) => {
    const res = await apiRequest("GET", `/api/messages/${subAccountId}`);
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
    const res = await apiRequest("POST", "/api/messages", data);
    return res.json();
  },

  getWorkflows: async () => {
    const res = await apiRequest("GET", "/api/workflows");
    return res.json();
  },

  createWorkflow: async (data: { name: string; trigger: string; steps: any; subAccountId?: number | null }) => {
    const res = await apiRequest("POST", "/api/workflows", data);
    return res.json();
  },

  updateWorkflow: async (id: number, data: Partial<{ name: string; trigger: string; steps: any }>) => {
    const res = await apiRequest("PATCH", `/api/workflows/${id}`, data);
    return res.json();
  },

  startTraining: async (url: string, persona: string) => {
    const res = await apiRequest("POST", "/api/bots/train", { url, persona });
    return res.json();
  },

  getTrainingJob: async (jobId: number) => {
    const res = await apiRequest("GET", `/api/jobs/${jobId}`);
    return res.json();
  },

  getBlueprint: async (industryId: string) => {
    const res = await apiRequest("GET", `/api/blueprints/${industryId}`);
    return res.json();
  },

  onboard: async (industryId: string) => {
    const res = await apiRequest("POST", `/api/onboarding/${industryId}`);
    return res.json();
  },
};
