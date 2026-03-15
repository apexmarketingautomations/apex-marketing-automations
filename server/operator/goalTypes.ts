export interface GoalTypeDefinition {
  type: string;
  label: string;
  description: string;
  metrics: string[];
  defaultMetric: string;
  defaultTimeHorizonDays: number;
  autoActivatable: boolean;
  suggestedTools: string[];
}

export const GOAL_TYPES: Record<string, GoalTypeDefinition> = {
  increase_leads: {
    type: "increase_leads",
    label: "Increase Leads",
    description: "Grow the number of new leads entering the pipeline",
    metrics: ["total_leads", "cost_per_lead", "landing_page_conversion_rate", "form_submissions"],
    defaultMetric: "total_leads",
    defaultTimeHorizonDays: 30,
    autoActivatable: false,
    suggestedTools: ["generateLandingPage", "createWorkflow", "launchCampaignDraft"],
  },
  increase_bookings: {
    type: "increase_bookings",
    label: "Increase Bookings",
    description: "Grow the number of booked appointments",
    metrics: ["booked_appointments", "no_show_rate", "response_speed_minutes", "booking_conversion_rate"],
    defaultMetric: "booked_appointments",
    defaultTimeHorizonDays: 30,
    autoActivatable: false,
    suggestedTools: ["createWorkflow", "getAccountSummary", "diagnoseWorkflow"],
  },
  improve_response_time: {
    type: "improve_response_time",
    label: "Improve Response Time",
    description: "Reduce average first reply time to inbound leads",
    metrics: ["avg_first_reply_minutes", "replies_within_5min_pct", "unanswered_leads"],
    defaultMetric: "avg_first_reply_minutes",
    defaultTimeHorizonDays: 14,
    autoActivatable: false,
    suggestedTools: ["createWorkflow", "diagnoseWorkflow", "getAccountSummary"],
  },
  improve_conversion_rate: {
    type: "improve_conversion_rate",
    label: "Improve Conversion Rate",
    description: "Improve lead-to-customer conversion rate",
    metrics: ["conversion_rate_pct", "deal_close_rate", "pipeline_velocity_days"],
    defaultMetric: "conversion_rate_pct",
    defaultTimeHorizonDays: 30,
    autoActivatable: false,
    suggestedTools: ["diagnoseWorkflow", "createWorkflow", "getAccountSummary"],
  },
  complete_account_setup: {
    type: "complete_account_setup",
    label: "Complete Account Setup",
    description: "Finish all required account configuration steps",
    metrics: ["setup_completion_pct", "integrations_connected", "workflows_active", "phone_configured"],
    defaultMetric: "setup_completion_pct",
    defaultTimeHorizonDays: 7,
    autoActivatable: true,
    suggestedTools: ["detectMissingSetup", "createPipeline", "checkIntegrationHealth", "connectIntegration"],
  },
  recover_stale_leads: {
    type: "recover_stale_leads",
    label: "Recover Stale Leads",
    description: "Re-engage leads that have gone cold",
    metrics: ["reactivated_leads", "stale_lead_response_rate", "recovered_conversations"],
    defaultMetric: "reactivated_leads",
    defaultTimeHorizonDays: 14,
    autoActivatable: false,
    suggestedTools: ["getAccountSummary", "createWorkflow", "createContact"],
  },
  improve_reputation: {
    type: "improve_reputation",
    label: "Improve Reputation",
    description: "Increase review count and average rating",
    metrics: ["review_count", "avg_rating", "review_requests_sent", "review_response_rate"],
    defaultMetric: "review_count",
    defaultTimeHorizonDays: 30,
    autoActivatable: false,
    suggestedTools: ["createWorkflow", "getAccountSummary"],
  },
  reduce_workflow_failures: {
    type: "reduce_workflow_failures",
    label: "Reduce Workflow Failures",
    description: "Diagnose and fix failing automations",
    metrics: ["workflow_failure_rate", "failed_steps_count", "active_workflows"],
    defaultMetric: "workflow_failure_rate",
    defaultTimeHorizonDays: 14,
    autoActivatable: true,
    suggestedTools: ["diagnoseWorkflow", "checkIntegrationHealth", "getAccountSummary"],
  },
};

export const VALID_GOAL_STATUSES = ["draft", "active", "blocked", "completed", "failed", "paused", "archived"] as const;
export type GoalStatus = typeof VALID_GOAL_STATUSES[number];

export const VALID_PLAN_STATUSES = ["draft", "active", "blocked", "completed", "failed", "superseded"] as const;
export type PlanStatus = typeof VALID_PLAN_STATUSES[number];

export const VALID_STEP_STATUSES = ["pending", "ready", "running", "waiting_approval", "blocked", "completed", "failed", "skipped"] as const;
export type StepStatus = typeof VALID_STEP_STATUSES[number];

export const VALID_REVIEW_DECISIONS = ["continue", "replan", "pause", "complete", "escalate"] as const;
export type ReviewDecision = typeof VALID_REVIEW_DECISIONS[number];

export const AUTO_ACTIVATABLE_GOAL_TYPES = Object.values(GOAL_TYPES)
  .filter(g => g.autoActivatable)
  .map(g => g.type);
