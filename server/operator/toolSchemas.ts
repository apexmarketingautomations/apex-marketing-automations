import { z } from "zod";

export const crmSchemas = {
  createContact: z.object({
    firstName: z.string().min(1),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    source: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  updateContact: z.object({
    contactId: z.number(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  tagContact: z.object({
    contactId: z.number(),
    tags: z.array(z.string()).min(1),
  }),
  untagContact: z.object({
    contactId: z.number(),
    tags: z.array(z.string()).min(1),
  }),
  createTask: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    assignedTo: z.string().optional(),
    dueDate: z.string().optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    idempotencyKey: z.string().optional(),
  }),
  assignTask: z.object({
    taskId: z.string(),
    assignedTo: z.string(),
  }),
  createPipeline: z.object({
    stages: z.array(z.object({ name: z.string(), color: z.string().optional() })).min(1),
  }),
  createPipelineStage: z.object({
    name: z.string().min(1),
    color: z.string().optional(),
    position: z.number().optional(),
  }),
  advanceDealStage: z.object({
    dealId: z.number(),
    newStageId: z.number(),
  }),
  createDeal: z.object({
    title: z.string().min(1),
    value: z.number().optional(),
    contactId: z.number().optional(),
    stageId: z.number(),
  }),
  updateDealValue: z.object({
    dealId: z.number(),
    value: z.number(),
  }),
  assignLeadOwner: z.object({
    contactId: z.number(),
    owner: z.string(),
  }),
  scoreLead: z.object({
    contactId: z.number(),
  }),
  segmentContacts: z.object({
    criteria: z.object({
      tags: z.array(z.string()).optional(),
      source: z.string().optional(),
      minScore: z.number().optional(),
    }),
  }),
};

export const messagingSchemas = {
  sendTestSMS: z.object({
    to: z.string().min(10),
    body: z.string().optional(),
  }),
  sendLiveSMSDraft: z.object({
    to: z.string().min(10),
    body: z.string().min(1),
    contactId: z.number().optional(),
  }),
  sendWhatsAppMessageDraft: z.object({
    to: z.string().min(10),
    body: z.string().min(1),
    templateName: z.string().optional(),
  }),
  sendEmailDraft: z.object({
    to: z.string().email(),
    subject: z.string().min(1),
    body: z.string().min(1),
    contactId: z.number().optional(),
  }),
  createEmailCampaignDraft: z.object({
    name: z.string().min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
    targetTags: z.array(z.string()).optional(),
    idempotencyKey: z.string().optional(),
  }),
  replyToInstagramDMDraft: z.object({
    conversationId: z.number(),
    body: z.string().min(1),
  }),
  sendReviewRequestDraft: z.object({
    contactId: z.number(),
    channel: z.enum(["sms", "email"]).optional(),
    message: z.string().optional(),
  }),
  createNurtureSequenceDraft: z.object({
    name: z.string().min(1),
    steps: z.array(z.object({
      delayDays: z.number(),
      channel: z.enum(["sms", "email"]),
      body: z.string(),
    })).min(1),
    targetTags: z.array(z.string()).optional(),
    idempotencyKey: z.string().optional(),
  }),
};

export const workflowSchemas = {
  diagnoseWorkflow: z.object({
    workflowId: z.number(),
  }),
  createWorkflow: z.object({
    name: z.string().min(1),
    trigger: z.string().min(1),
    steps: z.array(z.object({
      action: z.string(),
      message: z.string().optional(),
      duration: z.number().optional(),
      condition: z.string().optional(),
    })).min(1),
    idempotencyKey: z.string().optional(),
  }),
  duplicateWorkflow: z.object({
    workflowId: z.number(),
    newName: z.string().optional(),
  }),
  pauseWorkflow: z.object({
    workflowId: z.number(),
  }),
  resumeWorkflow: z.object({
    workflowId: z.number(),
  }),
  optimizeWorkflowTiming: z.object({
    workflowId: z.number(),
  }),
  generateAutoResponseWorkflow: z.object({
    trigger: z.string().min(1),
    responseMessage: z.string().min(1),
    channel: z.enum(["sms", "email", "whatsapp"]).optional(),
  }),
  generateReactivationWorkflow: z.object({
    inactiveDays: z.number().optional(),
    message: z.string().optional(),
    channel: z.enum(["sms", "email"]).optional(),
  }),
};

export const appointmentSchemas = {
  createAppointmentDraft: z.object({
    contactId: z.number(),
    title: z.string().min(1),
    startTime: z.string(),
    endTime: z.string().optional(),
    notes: z.string().optional(),
  }),
  rescheduleAppointmentDraft: z.object({
    appointmentId: z.number(),
    newStartTime: z.string(),
    newEndTime: z.string().optional(),
    reason: z.string().optional(),
  }),
  cancelAppointmentDraft: z.object({
    appointmentId: z.number(),
    reason: z.string().optional(),
    notifyContact: z.boolean().optional(),
  }),
  sendAppointmentReminderDraft: z.object({
    appointmentId: z.number(),
    channel: z.enum(["sms", "email"]).optional(),
    message: z.string().optional(),
  }),
  confirmAppointmentDraft: z.object({
    appointmentId: z.number(),
    confirmationMessage: z.string().optional(),
  }),
};

export const campaignSchemas = {
  launchCampaignDraft: z.object({
    name: z.string().min(1),
    platform: z.string().optional(),
    budget: z.number().optional(),
    targetAudience: z.string().optional(),
    idempotencyKey: z.string().optional(),
  }),
  pauseCampaignDraft: z.object({
    campaignId: z.number(),
    reason: z.string().optional(),
  }),
  duplicateCampaignDraft: z.object({
    campaignId: z.number(),
    newName: z.string().optional(),
  }),
  adjustAdBudgetDraft: z.object({
    campaignId: z.number(),
    newBudget: z.number().min(1),
    reason: z.string().optional(),
  }),
  rotateAdCreativeDraft: z.object({
    campaignId: z.number(),
    newCreativeDescription: z.string().optional(),
  }),
  createRetargetingCampaignDraft: z.object({
    name: z.string().min(1),
    audienceSource: z.string().optional(),
    budget: z.number().optional(),
    platform: z.string().optional(),
  }),
  createLeadFormDraft: z.object({
    name: z.string().min(1),
    fields: z.array(z.string()).optional(),
    redirectUrl: z.string().optional(),
  }),
};

export const creativeSchemas = {
  generateLandingPage: z.object({
    prompt: z.string().min(1),
    businessName: z.string().optional(),
  }),
  generateOfferAngles: z.object({
    product: z.string().min(1),
    targetAudience: z.string().optional(),
    count: z.number().optional(),
  }),
  generateAdCopyVariants: z.object({
    product: z.string().min(1),
    platform: z.enum(["meta", "google", "tiktok"]).optional(),
    tone: z.string().optional(),
    count: z.number().optional(),
  }),
  generateSMSCopyVariants: z.object({
    purpose: z.string().min(1),
    businessName: z.string().optional(),
    count: z.number().optional(),
  }),
  generateEmailCopyVariants: z.object({
    purpose: z.string().min(1),
    businessName: z.string().optional(),
    count: z.number().optional(),
  }),
  generateSocialPostDrafts: z.object({
    topic: z.string().min(1),
    platform: z.enum(["instagram", "facebook", "linkedin", "twitter"]).optional(),
    count: z.number().optional(),
  }),
  generateReviewResponseDraft: z.object({
    reviewText: z.string().min(1),
    rating: z.number().min(1).max(5),
    customerName: z.string().optional(),
  }),
};

export const reviewSchemas = {
  respondToReviewDraft: z.object({
    reviewId: z.number(),
    responseText: z.string().optional(),
  }),
  classifyReviewSentiment: z.object({
    reviewId: z.number(),
  }),
  escalateNegativeReview: z.object({
    reviewId: z.number(),
    reason: z.string().optional(),
  }),
  generateReviewRecoveryPlan: z.object({
    reviewId: z.number(),
  }),
};

export const intelligenceSchemas = {
  detectMissingSetup: z.object({}),
  checkIntegrationHealth: z.object({}),
  getAccountSummary: z.object({}),
  auditConversionLeaks: z.object({}),
  auditResponseSpeed: z.object({}),
  recommendNextBestAction: z.object({}),
  diagnoseMessaging: z.object({}),
  restoreBrokenIntegrationDraft: z.object({
    provider: z.string().min(1),
  }),
  generateAccountSetupPlan: z.object({
    industry: z.string().optional(),
  }),
  compareToIndustryBenchmark: z.object({
    industry: z.string().optional(),
  }),
  searchContacts: z.object({
    query: z.string().min(1).describe("Search term — name, email, phone, or tag to search for"),
  }),
  searchWorkflows: z.object({
    query: z.string().optional().default("").describe("Optional search term — workflow name or trigger type. Omit or pass empty string to list ALL workflows."),
  }),
};

export const integrationSchemas = {
  connectIntegration: z.object({
    provider: z.string().min(1),
  }),
};

export const allSchemas = {
  ...crmSchemas,
  ...messagingSchemas,
  ...workflowSchemas,
  ...appointmentSchemas,
  ...campaignSchemas,
  ...creativeSchemas,
  ...reviewSchemas,
  ...intelligenceSchemas,
  ...integrationSchemas,
};
