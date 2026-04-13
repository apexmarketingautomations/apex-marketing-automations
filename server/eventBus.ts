import crypto from "crypto";
import { storage } from "./storage";
import { EVENT_LOG_STATUS } from "@shared/schema";
import { emitUniversalEvent } from "./intelligence/eventEmitter";
import { MODULE_GROUP_EVENT_MAP, getModuleGroupForEvent } from "./intelligence/moduleRegistry";

export interface ApexEvent {
  event_id: string;
  event_type: string;
  source_module: string;
  timestamp: string;
  payload: Record<string, any>;
  metadata: Record<string, any>;
  traceId?: string;
}

export type EventHandler = (event: ApexEvent) => Promise<void> | void;

interface Subscription {
  id: string;
  module: string;
  handler: EventHandler;
  priority: number;
}

interface EventLogEntry {
  event_id: string;
  event_type: string;
  source_module: string;
  subscriber_module: string;
  status: "success" | "error" | "skipped";
  duration_ms: number;
  error?: string;
  timestamp: string;
}

const MAX_LOG_SIZE = 5000;
const DEDUP_WINDOW_MS = 5000;
const MAX_RETRY = 2;

class EventBus {
  private subscribers = new Map<string, Subscription[]>();
  private wildcardSubscribers: Subscription[] = [];
  private eventLog: EventLogEntry[] = [];
  private recentEventKeys = new Map<string, number>();
  private processing = false;
  private queue: ApexEvent[] = [];
  private paused = false;

  subscribe(eventType: string, module: string, handler: EventHandler, priority = 0): string {
    const id = crypto.randomUUID();
    const sub: Subscription = { id, module, handler, priority };

    if (eventType === "*") {
      this.wildcardSubscribers.push(sub);
      this.wildcardSubscribers.sort((a, b) => b.priority - a.priority);
    } else {
      if (!this.subscribers.has(eventType)) {
        this.subscribers.set(eventType, []);
      }
      const subs = this.subscribers.get(eventType)!;
      subs.push(sub);
      subs.sort((a, b) => b.priority - a.priority);
    }

    console.log(`[EVENT-BUS] ${module} subscribed to "${eventType}" (id: ${id.slice(0, 8)})`);
    return id;
  }

  unsubscribe(subscriptionId: string): boolean {
    for (const [key, subs] of this.subscribers) {
      const idx = subs.findIndex(s => s.id === subscriptionId);
      if (idx !== -1) {
        subs.splice(idx, 1);
        return true;
      }
    }
    const wIdx = this.wildcardSubscribers.findIndex(s => s.id === subscriptionId);
    if (wIdx !== -1) {
      this.wildcardSubscribers.splice(wIdx, 1);
      return true;
    }
    return false;
  }

  async publish(eventType: string, payload: Record<string, any>, sourceModule: string, metadata: Record<string, any> = {}): Promise<string> {
    const traceId = metadata.traceId || crypto.randomUUID();
    const event: ApexEvent = {
      event_id: crypto.randomUUID(),
      event_type: eventType,
      source_module: sourceModule,
      timestamp: new Date().toISOString(),
      payload,
      metadata: { ...metadata, traceId },
      traceId,
    };

    const dedupKey = `${eventType}:${sourceModule}:${JSON.stringify(payload)}`;
    const now = Date.now();
    const lastSeen = this.recentEventKeys.get(dedupKey);
    if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) {
      console.log(`[EVENT-BUS] Deduplicated ${eventType} from ${sourceModule}`);
      return event.event_id;
    }
    this.recentEventKeys.set(dedupKey, now);

    if (this.recentEventKeys.size > 10000) {
      const cutoff = now - DEDUP_WINDOW_MS * 2;
      for (const [k, v] of this.recentEventKeys) {
        if (v < cutoff) this.recentEventKeys.delete(k);
      }
    }

    this.persistEvent(event, payload).catch(err =>
      console.error(`[EVENT-BUS] Failed to persist event ${eventType}:`, err?.message)
    );

    const eventTypeMapped = eventType.replace(/\./g, "_");
    emitUniversalEvent({
      eventType: eventTypeMapped,
      sourceModule: sourceModule,
      subAccountId: payload.subAccountId || payload.sub_account_id || payload.accountId,
      accountId: payload.accountId || payload.sub_account_id || payload.subAccountId,
      contactId: payload.contactId || payload.contact_id,
      siteId: payload.siteId || payload.site_id,
      domainId: payload.domainId || payload.domain_id,
      cardId: payload.cardId || payload.card_id,
      campaignId: payload.campaignId || payload.campaign_id,
      workflowId: payload.workflowId || payload.workflow_id,
      userId: payload.userId || payload.user_id,
      metadata: { ...payload, traceId: event.traceId, eventBusEventId: event.event_id },
    });

    this.queue.push(event);
    if (!this.processing) {
      await this.processQueue();
    }

    return event.event_id;
  }

  private async persistEvent(event: ApexEvent, payload: Record<string, any>): Promise<void> {
    try {
      await storage.createEventLog({
        traceId: event.traceId!,
        type: event.event_type,
        source: `eventbus:${event.source_module}`,
        externalId: null,
        payload: payload as any,
        status: EVENT_LOG_STATUS.COMPLETED,
        maxRetries: 0,
        processedAt: new Date(),
      });
    } catch (err: any) {
      if (!err?.message?.includes("unique") && !err?.message?.includes("duplicate")) {
        console.error(`[EVENT-BUS] persist error for ${event.event_type}:`, err?.message);
      }
    }
  }

  private async processQueue(): Promise<void> {
    if (this.paused) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      await this.dispatch(event);
    }

    this.processing = false;
  }

  private async dispatch(event: ApexEvent): Promise<void> {
    const subs = [
      ...(this.subscribers.get(event.event_type) || []),
      ...this.wildcardSubscribers,
    ];

    if (subs.length === 0) {
      return;
    }

    for (const sub of subs) {
      const start = Date.now();
      let status: "success" | "error" = "success";
      let errorMsg: string | undefined;

      for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
        try {
          await sub.handler(event);
          status = "success";
          errorMsg = undefined;
          break;
        } catch (err: any) {
          status = "error";
          errorMsg = err?.message || String(err);
          if (attempt < MAX_RETRY) {
            console.warn(`[EVENT-BUS] Retry ${attempt + 1}/${MAX_RETRY} for ${sub.module} on ${event.event_type}: ${errorMsg}`);
            await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
          } else {
            console.error(`[EVENT-BUS] Failed after ${MAX_RETRY + 1} attempts: ${sub.module} on ${event.event_type}: ${errorMsg}`);
          }
        }
      }

      const entry: EventLogEntry = {
        event_id: event.event_id,
        event_type: event.event_type,
        source_module: event.source_module,
        subscriber_module: sub.module,
        status,
        duration_ms: Date.now() - start,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      };
      this.eventLog.push(entry);

      if (this.eventLog.length > MAX_LOG_SIZE) {
        this.eventLog = this.eventLog.slice(-MAX_LOG_SIZE);
      }
    }
  }

  publishAsync(eventType: string, payload: Record<string, any>, sourceModule: string, metadata: Record<string, any> = {}): void {
    this.publish(eventType, payload, sourceModule, metadata).catch(err => {
      console.error(`[EVENT-BUS] Async publish error for ${eventType}:`, err);
    });
  }

  getLog(limit = 100, eventType?: string): EventLogEntry[] {
    let log = this.eventLog;
    if (eventType) {
      log = log.filter(e => e.event_type === eventType);
    }
    return log.slice(-limit);
  }

  getStats(): {
    totalEvents: number;
    subscriberCount: number;
    eventTypes: string[];
    recentErrors: EventLogEntry[];
    queueDepth: number;
  } {
    const allSubs = new Set<string>();
    for (const subs of this.subscribers.values()) {
      for (const s of subs) allSubs.add(s.module);
    }
    for (const s of this.wildcardSubscribers) allSubs.add(s.module);

    return {
      totalEvents: this.eventLog.length,
      subscriberCount: allSubs.size,
      eventTypes: [...this.subscribers.keys()],
      recentErrors: this.eventLog.filter(e => e.status === "error").slice(-20),
      queueDepth: this.queue.length,
    };
  }

  getSubscribers(): Array<{ eventType: string; module: string; id: string }> {
    const result: Array<{ eventType: string; module: string; id: string }> = [];
    for (const [eventType, subs] of this.subscribers) {
      for (const sub of subs) {
        result.push({ eventType, module: sub.module, id: sub.id });
      }
    }
    for (const sub of this.wildcardSubscribers) {
      result.push({ eventType: "*", module: sub.module, id: sub.id });
    }
    return result;
  }

  pause(): void {
    this.paused = true;
    console.log("[EVENT-BUS] Paused");
  }

  resume(): void {
    this.paused = false;
    console.log("[EVENT-BUS] Resumed");
    if (this.queue.length > 0) {
      this.processQueue().catch(console.error);
    }
  }

  clear(): void {
    this.eventLog = [];
    this.recentEventKeys.clear();
    this.queue = [];
  }
}

export const eventBus = new EventBus();

export function publishEvent(eventType: string, payload: Record<string, any>, sourceModule: string, metadata: Record<string, any> = {}): Promise<string> {
  return eventBus.publish(eventType, payload, sourceModule, metadata);
}

export function publishEventAsync(eventType: string, payload: Record<string, any>, sourceModule: string, metadata: Record<string, any> = {}): void {
  eventBus.publishAsync(eventType, payload, sourceModule, metadata);
}

export const EVENT_TYPES = {
  // ---- CRM ----
  LEAD_CREATED: "lead.created",
  LEAD_UPDATED: "lead.updated",
  CONTACT_CREATED: "contact.created",
  CONTACT_UPDATED: "contact.updated",
  CONTACT_DELETED: "contact.deleted",
  DEAL_CREATED: "deal.created",
  DEAL_STAGE_CHANGED: "deal.stage.changed",
  DEAL_WON: "deal.won",
  DEAL_LOST: "deal.lost",
  DEAL_UPDATED: "deal.updated",
  PIPELINE_STAGE_CREATED: "pipeline.stage.created",
  PIPELINE_STAGE_UPDATED: "pipeline.stage.updated",

  // ---- Forms ----
  FORM_SUBMITTED: "form.submitted",
  FORM_STARTED: "form.started",
  FORM_ABANDONED: "form.abandoned",
  FORM_CREATED: "form.created",
  FORM_UPDATED: "form.updated",
  FUNNEL_LEAD_CAPTURED: "funnel.lead.captured",
  FUNNEL_LEAD_CONVERTED: "funnel.lead.converted",

  // ---- Messaging ----
  MESSAGE_RECEIVED: "message.received",
  MESSAGE_SENT: "message.sent",
  MESSAGE_FAILED: "message.failed",
  MESSAGE_READ: "message.read",
  CALL_COMPLETED: "call.completed",
  CALL_MISSED: "call.missed",
  CALL_STARTED: "call.started",
  DM_KEYWORD_TRIGGERED: "dm.keyword.triggered",
  INSTAGRAM_MESSAGE_RECEIVED: "instagram.message.received",
  INSTAGRAM_COMMENT_RECEIVED: "instagram.comment.received",
  META_LEAD_RECEIVED: "meta.lead.received",

  // ---- Calendar ----
  APPOINTMENT_BOOKED: "appointment.booked",
  APPOINTMENT_CANCELLED: "appointment.cancelled",
  APPOINTMENT_RESCHEDULED: "appointment.rescheduled",
  APPOINTMENT_REMINDER_SENT: "appointment.reminder.sent",
  CALENDAR_SYNCED: "calendar.synced",

  // ---- Sites ----
  SITE_GENERATED: "site.generated",
  SITE_PUBLISHED: "site.published",
  SITE_UPDATED: "site.updated",
  SITE_CREATED: "site.created",
  SITE_VERSION_CREATED: "site.version.created",
  SITE_COLLABORATOR_ADDED: "site.collaborator.added",

  // ---- Domains ----
  DOMAIN_REGISTERED: "domain.registered",
  DOMAIN_VERIFIED: "domain.verified",
  DOMAIN_ATTACHED: "domain.attached",
  DOMAIN_DNS_CONFIGURED: "domain.dns.configured",
  DOMAIN_SSL_ACTIVATED: "domain.ssl.activated",
  DOMAIN_SEARCHED: "domain.searched",

  // ---- Cards ----
  CARD_CREATED: "card.created",
  CARD_UPDATED: "card.updated",
  CARD_SCANNED: "card.scanned",
  CARD_OPENED: "card.opened",
  CARD_SHARED: "card.shared",
  CARD_CONTACT_SAVED: "card.contact.saved",

  // ---- Campaigns ----
  CAMPAIGN_CREATED: "campaign.created",
  CAMPAIGN_SENT: "campaign.sent",
  CAMPAIGN_COMPLETED: "campaign.completed",
  CAMPAIGN_FAILED: "campaign.failed",
  CAMPAIGN_OPENED: "campaign.opened",
  CAMPAIGN_CLICKED: "campaign.clicked",
  CAMPAIGN_UNSUBSCRIBED: "campaign.unsubscribed",
  AD_CAMPAIGN_LAUNCHED: "ad.campaign.launched",
  AD_CAMPAIGN_COMPLETED: "ad.campaign.completed",
  AD_CAMPAIGN_UPDATED: "ad.campaign.updated",

  // ---- Workflows ----
  WORKFLOW_STARTED: "workflow.started",
  WORKFLOW_COMPLETED: "workflow.completed",
  WORKFLOW_FAILED: "workflow.failed",
  WORKFLOW_STEP_EXECUTED: "workflow.step.executed",
  WORKFLOW_OPTIMIZED: "workflow.optimized",
  AUTOMATION_TRIGGERED: "automation.triggered",
  AUTOMATION_COMPLETED: "automation.completed",

  // ---- Integrations ----
  INTEGRATION_CONNECTED: "integration.connected",
  INTEGRATION_DISCONNECTED: "integration.disconnected",
  INTEGRATION_ERROR: "integration.error",
  INTEGRATION_HEALTH_UPDATED: "integration.health.updated",
  WEBHOOK_RECEIVED: "webhook.received",
  WEBHOOK_SENT: "webhook.sent",
  OAUTH_TOKEN_REFRESHED: "oauth.token.refreshed",
  SHOPIFY_EVENT_RECEIVED: "shopify.event.received",

  // ---- Reputation ----
  REVIEW_RECEIVED: "review.received",
  REVIEW_REPLIED: "review.replied",
  REVIEW_FLAGGED: "review.flagged",
  REPUTATION_SCORE_UPDATED: "reputation.score.updated",

  // ---- Sentinel ----
  CRASH_DETECTED: "crash.detected",
  SENTINEL_ALERT: "sentinel.alert",
  SENTINEL_INCIDENT_CREATED: "sentinel.incident.created",
  SENTINEL_INCIDENT_RESOLVED: "sentinel.incident.resolved",
  SENTINEL_HEALTH_CHECK: "sentinel.health.check",

  // ---- Analytics ----
  PAGE_VIEW: "page.view",
  CTA_CLICKED: "cta.clicked",
  BUTTON_CLICKED: "button.clicked",
  AB_EXPERIMENT_STARTED: "ab.experiment.started",
  AB_EXPERIMENT_CONVERTED: "ab.experiment.converted",
  ROLLUP_COMPUTED: "rollup.computed",
  SCORE_UPDATED: "score.updated",
  RECOMMENDATION_GENERATED: "recommendation.generated",

  // ---- Billing ----
  PAYMENT_COMPLETED: "payment.completed",
  PAYMENT_FAILED: "payment.failed",
  SUBSCRIPTION_CHANGED: "subscription.changed",
  CREDIT_PURCHASED: "credit.purchased",
  CREDIT_CONSUMED: "credit.consumed",
  MESSAGE_BILLED: "message.billed",

  // ---- AI ----
  AI_CHAT_COMPLETED: "ai.chat.completed",
  AI_TRAINING_COMPLETED: "ai.training.completed",
  AI_RESPONSE_GENERATED: "ai.response.generated",
  AI_TOOL_EXECUTED: "ai.tool.executed",

  // ---- Users ----
  USER_LOGIN: "user.login",
  USER_SIGNUP: "user.signup",
  ACCOUNT_CREATED: "account.created",
  ACCOUNT_UPDATED: "account.updated",

  // ---- System ----
  SYSTEM_ERROR: "system.error",
  SYSTEM_HEALTH_CHECK: "system.health_check",
} as const;

export type ApexEventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];

export { MODULE_GROUP_EVENT_MAP, getModuleGroupForEvent };
