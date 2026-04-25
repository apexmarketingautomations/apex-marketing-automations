import { storage } from "../storage";
import type { InsertUniversalEvent } from "@shared/schema";
import { getModuleGroupForEvent } from "./moduleRegistry";

export type UniversalEventInput = {
  eventType: string;
  sourceModule: string;
  moduleSource?: string;
  entityType?: string;
  entityId?: string;
  sourceTable?: string;
  sourceRecordId?: string;
  accountId?: number;
  subAccountId?: number;
  userId?: string;
  contactId?: number;
  anonymousSessionId?: string;
  siteId?: number;
  domainId?: number;
  cardId?: number;
  campaignId?: number;
  workflowId?: number;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
};

let eventQueue: UniversalEventInput[] = [];
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_INTERVAL = 2000;
const MAX_BATCH = 50;

async function trackModuleCoverage(input: UniversalEventInput): Promise<void> {
  const accountId = input.subAccountId ?? input.accountId;
  if (!accountId) return;
  const moduleGroup = getModuleGroupForEvent(input.eventType) ?? input.moduleSource ?? input.sourceModule;
  if (!moduleGroup) return;
  try {
    await storage.incrementModuleCoverageCount(accountId, moduleGroup, input.eventType);
  } catch (err) {
    console.warn("[EVENTEMITTER] caught:", err instanceof Error ? err.message : err);
  }
}

async function flushQueue() {
  if (eventQueue.length === 0) return;
  const batch = eventQueue.splice(0, MAX_BATCH);
  for (const evt of batch) {
    try {
      await storage.createUniversalEvent(evt as InsertUniversalEvent);
      trackModuleCoverage(evt).catch((err) => console.warn("[EVENTEMITTER] promise rejected:", err instanceof Error ? err.message : err));
    } catch (err) {
      console.error(`[APEX-INTEL] Failed to persist event ${evt.eventType}:`, (err as Error).message);
    }
  }
  if (eventQueue.length > 0) {
    setImmediate(flushQueue);
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushQueue();
  }, FLUSH_INTERVAL);
}

export function emitUniversalEvent(input: UniversalEventInput): void {
  const event: UniversalEventInput = {
    ...input,
    occurredAt: input.occurredAt || new Date(),
  };
  eventQueue.push(event);
  if (eventQueue.length >= MAX_BATCH) {
    flushQueue();
  } else {
    scheduleFlush();
  }
}

export async function emitUniversalEventSync(input: UniversalEventInput) {
  try {
    const result = await storage.createUniversalEvent({
      ...input,
      occurredAt: input.occurredAt || new Date(),
    } as InsertUniversalEvent);
    trackModuleCoverage(input).catch((err) => console.warn("[EVENTEMITTER] promise rejected:", err instanceof Error ? err.message : err));
    return result;
  } catch (err) {
    console.error(`[APEX-INTEL] Failed to persist event ${input.eventType}:`, (err as Error).message);
    return null;
  }
}

export function emitWithEntityLinkage(
  input: UniversalEventInput & {
    accountId: number;
    contactId?: number;
    entityType: string;
    moduleSource: string;
  }
): void {
  emitUniversalEvent({
    ...input,
    sourceModule: input.moduleSource ?? input.sourceModule,
  });
}

export function emitWithTimeline(
  input: UniversalEventInput,
  timelineTitle: string,
  timelineDescription?: string,
  severity: string = "info"
): void {
  emitUniversalEvent(input);
  if (input.subAccountId || input.accountId) {
    storage.createExecutionTimelineEntry({
      accountId: (input.subAccountId || input.accountId)!,
      relatedEntityType: input.entityType ?? input.sourceTable ?? input.sourceModule,
      relatedEntityId: input.entityId ?? input.sourceRecordId ?? undefined,
      title: timelineTitle,
      description: timelineDescription || `${input.eventType} from ${input.sourceModule}`,
      sourceModule: input.moduleSource ?? input.sourceModule,
      severity,
    }).catch(err => {
      console.error(`[APEX-INTEL] Timeline write failed:`, (err as Error).message);
    });
  }
}

export const EVENT_TYPES = {
  // ---- HTTP API (universal hook) ----
  API_REQUEST_COMPLETED: "api_request_completed",
  API_REQUEST_FAILED: "api_request_failed",

  // ---- Forms ----
  PAGE_VIEW: "page_view",
  BUTTON_CLICK: "button_click",
  CTA_CLICK: "cta_click",
  FORM_START: "form_start",
  FORM_SUBMIT: "form_submit",
  FORM_ABANDON: "form_abandon",

  // ---- Workflows ----
  WORKFLOW_TRIGGERED: "workflow_triggered",
  WORKFLOW_COMPLETED: "workflow_completed",
  WORKFLOW_FAILED: "workflow_failed",
  WORKFLOW_STEP_EXECUTED: "workflow_step_executed",
  AUTOMATION_TRIGGERED: "automation_triggered",
  AUTOMATION_COMPLETED: "automation_completed",

  // ---- CRM ----
  PIPELINE_MOVED: "pipeline_moved",
  CONTACT_CREATED: "contact_created",
  CONTACT_UPDATED: "contact_updated",
  CONTACT_DELETED: "contact_deleted",
  DEAL_CREATED: "deal_created",
  DEAL_STAGE_CHANGED: "deal_stage_changed",
  DEAL_WON: "deal_won",
  DEAL_LOST: "deal_lost",
  LEAD_CREATED: "lead_created",

  // ---- Messaging ----
  MESSAGE_SENT: "message_sent",
  MESSAGE_RECEIVED: "message_received",
  MESSAGE_FAILED: "message_failed",
  MESSAGE_READ: "message_read",
  CALL_COMPLETED: "call_completed",
  CALL_MISSED: "call_missed",
  CALL_STARTED: "call_started",
  CALL_FAILED: "call_failed",
  DM_KEYWORD_TRIGGERED: "dm_keyword_triggered",
  INSTAGRAM_MESSAGE_RECEIVED: "instagram_message_received",
  INSTAGRAM_COMMENT_RECEIVED: "instagram_comment_received",
  META_LEAD_RECEIVED: "meta_lead_received",
  INBOX_THREAD_CREATED: "inbox_thread_created",
  INBOX_MESSAGE_SENT: "inbox_message_sent",
  INBOX_MESSAGE_RECEIVED: "inbox_message_received",

  // ---- Voice Agents ----
  VOICE_AGENT_CREATED: "voice_agent_created",
  VOICE_AGENT_UPDATED: "voice_agent_updated",

  // ---- Calendar ----
  CALENDAR_BOOKED: "calendar_booked",
  CALENDAR_CANCELLED: "calendar_cancelled",
  CALENDAR_RESCHEDULED: "calendar_rescheduled",
  CALENDAR_REMINDER_SENT: "calendar_reminder_sent",
  CALENDAR_SYNCED: "calendar_synced",
  CALENDAR_COMPLETED: "calendar_completed",

  // ---- Cards ----
  CARD_SCANNED: "card_scanned",
  CARD_OPENED: "card_opened",
  CARD_CREATED: "card_created",
  CARD_UPDATED: "card_updated",
  CARD_SHARED: "card_shared",
  CARD_CONTACT_SAVED: "card_contact_saved",

  // ---- Domains ----
  DOMAIN_SEARCHED: "domain_searched",
  DOMAIN_CLAIMED: "domain_claimed",
  DOMAIN_ATTACHED: "domain_attached",
  DOMAIN_VERIFIED: "domain_verified",
  DOMAIN_DNS_CONFIGURED: "domain_dns_configured",
  DOMAIN_SSL_ACTIVATED: "domain_ssl_activated",

  // ---- Sites ----
  SITE_PUBLISHED: "site_published",
  SITE_CREATED: "site_created",
  SITE_UPDATED: "site_updated",
  SITE_VERSION_CREATED: "site_version_created",
  SITE_COLLABORATOR_ADDED: "site_collaborator_added",

  // ---- Campaigns ----
  CAMPAIGN_SENT: "campaign_sent",
  CAMPAIGN_CREATED: "campaign_created",
  CAMPAIGN_COMPLETED: "campaign_completed",
  CAMPAIGN_FAILED: "campaign_failed",
  CAMPAIGN_OPENED: "campaign_opened",
  CAMPAIGN_CLICKED: "campaign_clicked",
  CAMPAIGN_UNSUBSCRIBED: "campaign_unsubscribed",
  AD_CAMPAIGN_LAUNCHED: "ad_campaign_launched",
  AD_CAMPAIGN_UPDATED: "ad_campaign_updated",
  AD_LEAD_CAPTURED: "ad_lead_captured",

  // ---- Reputation ----
  REVIEW_RECEIVED: "review_received",
  REVIEW_REPLIED: "review_replied",
  REVIEW_FLAGGED: "review_flagged",
  REPUTATION_SCORE_UPDATED: "reputation_score_updated",
  REPUTATION_ALERT: "reputation_alert",

  // ---- Sentinel ----
  CRASH_DETECTED: "crash_detected",
  SENTINEL_ALERT: "sentinel_alert",
  SENTINEL_INCIDENT_CREATED: "sentinel_incident_created",
  SENTINEL_INCIDENT_RESOLVED: "sentinel_incident_resolved",
  SENTINEL_DISPATCHED: "sentinel_dispatched",

  // ---- Integrations ----
  INTEGRATION_CONNECTED: "integration_connected",
  INTEGRATION_DISCONNECTED: "integration_disconnected",
  INTEGRATION_ERROR: "integration_error",
  INTEGRATION_HEALTH_UPDATED: "integration_health_updated",
  WEBHOOK_RECEIVED: "webhook_received",
  WEBHOOK_SENT: "webhook_sent",
  WEBHOOK_FAILED: "webhook_failed",
  OAUTH_TOKEN_REFRESHED: "oauth_token_refreshed",
  SHOPIFY_EVENT_RECEIVED: "shopify_event_received",

  // ---- Snapshots ----
  SNAPSHOT_DEPLOYED: "snapshot_deployed",
  SNAPSHOT_CREATED: "snapshot_created",

  // ---- Content ----
  CONTENT_SCHEDULED: "content_scheduled",
  CONTENT_PUBLISHED: "content_published",
  CONTENT_FAILED: "content_failed",

  // ---- Analytics ----
  AB_EXPERIMENT_STARTED: "ab_experiment_started",
  AB_EXPERIMENT_CONVERTED: "ab_experiment_converted",
  ROLLUP_COMPUTED: "rollup_computed",
  SCORE_UPDATED: "score_updated",
  RECOMMENDATION_GENERATED: "recommendation_generated",

  // ---- Billing ----
  BILLING_CHARGE: "billing_charge",
  SUBSCRIPTION_CHANGED: "subscription_changed",
  SUBSCRIPTION_CREATED: "subscription_created",
  CREDIT_PURCHASED: "credit_purchased",
  CREDIT_CONSUMED: "credit_consumed",
  MESSAGE_BILLED: "message_billed",

  // ---- Accounts ----
  ACCOUNT_CREATED: "account_created",
  ACCOUNT_UPDATED: "account_updated",

  // ---- AI ----
  AI_RESPONSE: "ai_response",
  AI_TRAINING_COMPLETED: "ai_training_completed",
  AI_TOOL_EXECUTED: "ai_tool_executed",

  // ---- Operator / System ----
  OPERATOR_COMMAND: "operator_command",
  OPERATOR_CONVERSATION: "operator_conversation",
  OPERATOR_TOOL_EXECUTED: "operator_tool_executed",
  OPERATOR_ACTION_APPROVED: "operator_action_approved",
  OPERATOR_ACTION_REJECTED: "operator_action_rejected",

  // ---- Agent Brain ----
  AGENT_TASK_COMPLETED: "agent_task_completed",
  AGENT_TASK_FAILED: "agent_task_failed",
  AGENT_TASK_CREATED: "agent_task_created",
  AGENT_TASK_RUNNING: "agent_task_running",
  AGENT_TASK_RETRY: "agent_task_retry",
  AGENT_BRIEFING_GENERATED: "agent_briefing_generated",
  AGENT_BRAIN_CYCLE: "agent_brain_cycle",

  // ---- Agent Worker ----
  WORKER_JOB_COMPLETED: "worker_job_completed",
  WORKER_JOB_FAILED: "worker_job_failed",
  WORKER_JOB_RETRY: "worker_job_retry",

  // ---- Call Intelligence ----
  CALL_ANALYZED: "call_analyzed",
  CALL_PATTERNS_INJECTED: "call_patterns_injected",

  // ---- Autonomy ----
  AUTONOMY_GAP_DETECTED: "autonomy_gap_detected",
  AUTONOMY_ACTION_COMPLETED: "autonomy_action_completed",
  AUTONOMY_ACTION_FAILED: "autonomy_action_failed",

  // ---- Crash / Sentinel Ingest ----
  CRASH_INGESTED: "crash_ingested",
  CRASH_LEAD_CREATED: "crash_lead_created",
  CRASH_LEAD_RECOVERED: "crash_lead_recovered",

  // ---- Billing ----
  BILLING_RECORD_CREATED: "billing_record_created",
  WALLET_DEDUCTED: "wallet_deducted",
  PLATFORM_PROFIT_RECORDED: "platform_profit_recorded",

  // ---- Property / Skip Trace ----
  PROPERTY_LEAD_CREATED: "property_lead_created",
  PROPERTY_LEAD_UPDATED: "property_lead_updated",
  SKIP_TRACE_COMPLETED: "skip_trace_completed",

  // ---- Standalone Cards ----
  STANDALONE_ORDER_CREATED: "standalone_order_created",
  STANDALONE_REFERRAL_CREATED: "standalone_referral_created",
  STANDALONE_PAGE_VIEW: "standalone_page_view",

  // ---- Cognitive Loop (Level 3) ----
  EPISODIC_MEMORY_CREATED: "episodic_memory_created",
  COGNITIVE_MEMORY_STORED: "cognitive_memory_stored",
  RECOMMENDATION_CREATED: "recommendation_created",
  RECOMMENDATIONS_BATCH_GENERATED: "recommendations_batch_generated",
  STRATEGIC_INSIGHT_GENERATED: "strategic_insight_generated",
  NETWORK_BENCHMARKS_COMPUTED: "network_benchmarks_computed",
  PLAYBOOK_PATTERNS_DERIVED: "playbook_patterns_derived",
} as const;

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];
