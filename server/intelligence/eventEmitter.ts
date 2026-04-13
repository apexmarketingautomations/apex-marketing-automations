import { storage } from "../storage";
import type { InsertUniversalEvent } from "@shared/schema";

export type UniversalEventInput = {
  eventType: string;
  sourceModule: string;
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

async function flushQueue() {
  if (eventQueue.length === 0) return;
  const batch = eventQueue.splice(0, MAX_BATCH);
  for (const evt of batch) {
    try {
      await storage.createUniversalEvent(evt as InsertUniversalEvent);
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
    return await storage.createUniversalEvent({
      ...input,
      occurredAt: input.occurredAt || new Date(),
    } as InsertUniversalEvent);
  } catch (err) {
    console.error(`[APEX-INTEL] Failed to persist event ${input.eventType}:`, (err as Error).message);
    return null;
  }
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
      relatedEntityType: input.sourceTable || input.sourceModule,
      relatedEntityId: input.sourceRecordId || undefined,
      title: timelineTitle,
      description: timelineDescription || `${input.eventType} from ${input.sourceModule}`,
      sourceModule: input.sourceModule,
      severity,
    }).catch(err => {
      console.error(`[APEX-INTEL] Timeline write failed:`, (err as Error).message);
    });
  }
}

export const EVENT_TYPES = {
  PAGE_VIEW: "page_view",
  BUTTON_CLICK: "button_click",
  CTA_CLICK: "cta_click",
  FORM_START: "form_start",
  FORM_SUBMIT: "form_submit",
  FORM_ABANDON: "form_abandon",
  WORKFLOW_TRIGGERED: "workflow_triggered",
  WORKFLOW_COMPLETED: "workflow_completed",
  WORKFLOW_FAILED: "workflow_failed",
  PIPELINE_MOVED: "pipeline_moved",
  MESSAGE_SENT: "message_sent",
  MESSAGE_RECEIVED: "message_received",
  CALL_COMPLETED: "call_completed",
  CALL_MISSED: "call_missed",
  CARD_SCANNED: "card_scanned",
  CARD_OPENED: "card_opened",
  CARD_CREATED: "card_created",
  DOMAIN_SEARCHED: "domain_searched",
  DOMAIN_CLAIMED: "domain_claimed",
  DOMAIN_ATTACHED: "domain_attached",
  DOMAIN_VERIFIED: "domain_verified",
  SITE_PUBLISHED: "site_published",
  SITE_CREATED: "site_created",
  SITE_UPDATED: "site_updated",
  CAMPAIGN_SENT: "campaign_sent",
  CAMPAIGN_CREATED: "campaign_created",
  CALENDAR_BOOKED: "calendar_booked",
  CALENDAR_CANCELLED: "calendar_cancelled",
  CONTACT_CREATED: "contact_created",
  CONTACT_UPDATED: "contact_updated",
  DEAL_CREATED: "deal_created",
  DEAL_STAGE_CHANGED: "deal_stage_changed",
  DEAL_WON: "deal_won",
  DEAL_LOST: "deal_lost",
  LEAD_CREATED: "lead_created",
  REVIEW_RECEIVED: "review_received",
  REVIEW_REPLIED: "review_replied",
  AD_CAMPAIGN_LAUNCHED: "ad_campaign_launched",
  AD_CAMPAIGN_UPDATED: "ad_campaign_updated",
  CRASH_DETECTED: "crash_detected",
  SENTINEL_ALERT: "sentinel_alert",
  INTEGRATION_CONNECTED: "integration_connected",
  INTEGRATION_DISCONNECTED: "integration_disconnected",
  INTEGRATION_ERROR: "integration_error",
  WEBHOOK_RECEIVED: "webhook_received",
  WEBHOOK_SENT: "webhook_sent",
  AI_RESPONSE: "ai_response",
  OPERATOR_COMMAND: "operator_command",
  BILLING_CHARGE: "billing_charge",
  SUBSCRIPTION_CHANGED: "subscription_changed",
} as const;

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];
