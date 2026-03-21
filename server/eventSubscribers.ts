import { eventBus, EVENT_TYPES, type ApexEvent } from "./eventBus";
import { dispatchAlert, generateDeepLink } from "./pushAlertService";
import { logSystemEvent } from "./systemLogger";
import {
  handleLeadCreated,
  handleContactUpdated,
  handleCallRequested,
  handleAppointmentBooked,
  handleDealStageChanged,
  handleNoResponse,
} from "./mailchimp";

// ============================================================================
// STRICT CHANNEL ROUTING RULE
// ============================================================================
// SMS events  → Twilio ONLY (enforced at runtime by smsGatewayGuard.ts)
//   Any attempt to send SMS via a non-Twilio provider will throw
//   SmsProviderViolationError and log an SMS_PROVIDER_VIOLATION audit entry.
// Email events → Mailchimp (by convention; Mailchimp handlers below)
// No cross-routing: SMS must never be sent through Mailchimp, and email
// campaigns should not be routed through Twilio.
// ============================================================================

let storageRef: any = null;

export function initEventSubscribers(storage: any, _systemLogger?: any) {
  storageRef = storage;
  const systemLoggerRef = logSystemEvent;

  eventBus.subscribe(EVENT_TYPES.CONTACT_CREATED, "analytics", async (event) => {
    console.log(`[EVENT-SUB:analytics] Contact created: ${event.payload.contactId || event.payload.name}`);
  });

  eventBus.subscribe(EVENT_TYPES.FORM_SUBMITTED, "crm", async (event) => {
    console.log(`[EVENT-SUB:crm] Form submitted: ${event.payload.formId || "unknown"} from ${event.payload.source || "unknown"}`);
  });

  eventBus.subscribe(EVENT_TYPES.MESSAGE_RECEIVED, "analytics", async (event) => {
    console.log(`[EVENT-SUB:analytics] Message received from ${event.payload.from || "unknown"}`);
  });

  eventBus.subscribe(EVENT_TYPES.MESSAGE_SENT, "analytics", async (event) => {
    console.log(`[EVENT-SUB:analytics] Message sent to ${event.payload.to || "unknown"} via ${event.payload.channel || "sms"}`);
  });

  eventBus.subscribe(EVENT_TYPES.CRASH_DETECTED, "sentinel", async (event) => {
    console.log(`[EVENT-SUB:sentinel] Crash detected: ${event.payload.crashId || "unknown"} — ${event.payload.type || "crash"} in ${event.payload.county || "unknown"}`);
  });

  eventBus.subscribe(EVENT_TYPES.WORKFLOW_FAILED, "system", async (event) => {
    console.error(`[EVENT-SUB:system] Workflow failed: ${event.payload.workflowId} — ${event.payload.error || "unknown error"}`);
    try {
      await systemLoggerRef("error", "event-bus", `Workflow ${event.payload.workflowId} failed: ${event.payload.error || "unknown"}`, {
        ...event.payload,
        trace_id: event.traceId,
      });
    } catch (err: any) {
      console.error("[EVENT-SUB] Workflow failure log failed:", err.message);
    }
  });

  eventBus.subscribe(EVENT_TYPES.INTEGRATION_CONNECTED, "system", async (event) => {
    console.log(`[EVENT-SUB:system] Integration connected: ${event.payload.provider} for account ${event.payload.subAccountId}`);
  });

  eventBus.subscribe(EVENT_TYPES.INTEGRATION_DISCONNECTED, "system", async (event) => {
    console.log(`[EVENT-SUB:system] Integration disconnected: ${event.payload.provider} for account ${event.payload.subAccountId}`);
  });

  eventBus.subscribe(EVENT_TYPES.INTEGRATION_ERROR, "ai-operator-hook", async (event) => {
    console.warn(`[EVENT-SUB:ai-operator] Integration error: ${event.payload.provider} — ${event.payload.error}`);
  });

  eventBus.subscribe(EVENT_TYPES.PAYMENT_COMPLETED, "analytics", async (event) => {
    console.log(`[EVENT-SUB:analytics] Payment completed: $${event.payload.amount || 0} from account ${event.payload.subAccountId}`);
  });

  eventBus.subscribe(EVENT_TYPES.DEAL_CREATED, "analytics", async (event) => {
    console.log(`[EVENT-SUB:analytics] Deal created: ${event.payload.title || "untitled"} worth $${event.payload.value || 0}`);
  });

  eventBus.subscribe(EVENT_TYPES.DEAL_STAGE_CHANGED, "analytics", async (event) => {
    console.log(`[EVENT-SUB:analytics] Deal ${event.payload.dealId} moved to stage: ${event.payload.newStage}`);
  });

  eventBus.subscribe(EVENT_TYPES.AD_CAMPAIGN_LAUNCHED, "analytics", async (event) => {
    console.log(`[EVENT-SUB:analytics] Ad campaign launched: ${event.payload.campaignId || "unknown"} targeting ${event.payload.platform || "meta"}`);
    if (event.payload.subAccountId) {
      dispatchAlert(event.payload.subAccountId, "campaign_alert", {
        title: "Campaign Launched",
        body: `Your ${event.payload.platform || "ad"} campaign has been launched.`,
        link: generateDeepLink("/meta-ads"),
        tag: `campaign-${event.payload.campaignId || Date.now()}`,
      }).catch(e => console.error("[PUSH-ALERT] campaign launch dispatch error:", e instanceof Error ? e.message : e));
    }
  });

  eventBus.subscribe(EVENT_TYPES.SENTINEL_ALERT, "analytics", async (event) => {
    console.log(`[EVENT-SUB:analytics] Sentinel alert: ${event.payload.alertType} — ${event.payload.message || ""}`);
  });

  const WEBHOOK_EVENT_MAP: Record<string, string> = {
    [EVENT_TYPES.CONTACT_CREATED]: "contact.created",
    [EVENT_TYPES.CONTACT_UPDATED]: "contact.updated",
    [EVENT_TYPES.DEAL_CREATED]: "deal.created",
    [EVENT_TYPES.DEAL_STAGE_CHANGED]: "deal.moved",
    [EVENT_TYPES.DEAL_WON]: "deal.closed",
    [EVENT_TYPES.APPOINTMENT_BOOKED]: "appointment.created",
    [EVENT_TYPES.APPOINTMENT_CANCELLED]: "appointment.cancelled",
    [EVENT_TYPES.MESSAGE_RECEIVED]: "message.received",
    [EVENT_TYPES.MESSAGE_SENT]: "message.sent",
  };

  eventBus.subscribe("*", "webhook-dispatcher", async (event) => {
    const webhookEventType = WEBHOOK_EVENT_MAP[event.event_type];
    if (!webhookEventType) return;
    const subAccountId = event.payload?.subAccountId;
    if (!subAccountId || typeof subAccountId !== "number") return;
    try {
      const { dispatchToAllWebhooks } = await import("./webhookDispatcher");
      await dispatchToAllWebhooks(subAccountId, webhookEventType, event.payload);
    } catch (err: any) {
      console.error(`[WEBHOOK-DISPATCH] Failed to dispatch ${webhookEventType} for account ${subAccountId}:`, err.message);
    }
  }, -50);

  eventBus.subscribe("*", "event-logger", async (event) => {
    if (systemLoggerRef) {
      try {
        await systemLoggerRef("info", "event-bus", `Event: ${event.event_type} from ${event.source_module}`, {
          event_id: event.event_id,
          trace_id: event.traceId,
          payload_keys: Object.keys(event.payload),
        });
      } catch (err: any) {
        console.error("[EVENT-SUB] Event log failed:", err.message);
      }
    } else if (storageRef?.createSystemLog) {
      try {
        await storageRef.createSystemLog({
          level: "info",
          source: "event-bus",
          message: `Event: ${event.event_type} from ${event.source_module}`,
          details: { event_id: event.event_id, trace_id: event.traceId, payload_keys: Object.keys(event.payload) },
        });
      } catch (err: any) {
        console.error("[EVENT-SUB] Event log fallback failed:", err.message);
      }
    }
  }, -100);

  async function resolveContact(payload: Record<string, any>) {
    const { subAccountId, contactId, email, firstName, lastName, phone, source, tags } = payload;
    if (email) return { email, firstName, lastName, phone, source, tags };
    if (contactId && storageRef) {
      try {
        const c = await storageRef.getContactById(contactId);
        if (c && c.subAccountId === subAccountId) {
          return {
            email: c.email,
            firstName: c.firstName,
            lastName: c.lastName,
            phone: c.phone,
            source: c.source,
            tags: c.tags,
          };
        }
      } catch (err: any) {
        console.warn("[EVENT-SUB:mailchimp] Contact lookup failed for contactId", contactId, ":", err.message);
      }
    }
    return { email, firstName, lastName, phone, source, tags };
  }

  eventBus.subscribe(EVENT_TYPES.LEAD_CREATED, "mailchimp", async (event) => {
    const { subAccountId, contactId } = event.payload;
    if (!subAccountId) return;
    try {
      const data = await resolveContact(event.payload);
      if (!data.email) return;
      await handleLeadCreated(subAccountId, contactId || 0, data);
    } catch (err: any) {
      console.error("[EVENT-SUB:mailchimp] lead_created handler error:", err.message);
    }
  });

  eventBus.subscribe(EVENT_TYPES.CONTACT_CREATED, "mailchimp", async (event) => {
    const { subAccountId, contactId } = event.payload;
    if (!subAccountId) return;
    try {
      const data = await resolveContact(event.payload);
      if (!data.email) return;
      await handleLeadCreated(subAccountId, contactId || 0, data);
    } catch (err: any) {
      console.error("[EVENT-SUB:mailchimp] contact_created handler error:", err.message);
    }
  });

  eventBus.subscribe(EVENT_TYPES.CONTACT_UPDATED, "mailchimp", async (event) => {
    const { subAccountId, contactId } = event.payload;
    if (!subAccountId) return;
    try {
      const data = await resolveContact(event.payload);
      if (!data.email) return;
      await handleContactUpdated(subAccountId, contactId || 0, data);
    } catch (err: any) {
      console.error("[EVENT-SUB:mailchimp] contact_updated handler error:", err.message);
    }
  });

  eventBus.subscribe(EVENT_TYPES.APPOINTMENT_BOOKED, "mailchimp", async (event) => {
    const { subAccountId, contactId } = event.payload;
    if (!subAccountId) return;
    try {
      const data = await resolveContact(event.payload);
      if (!data.email) return;
      await handleAppointmentBooked(subAccountId, contactId || 0, { email: data.email, firstName: data.firstName, phone: data.phone });
    } catch (err: any) {
      console.error("[EVENT-SUB:mailchimp] appointment_booked handler error:", err.message);
    }
  });

  eventBus.subscribe(EVENT_TYPES.DEAL_STAGE_CHANGED, "mailchimp", async (event) => {
    const { subAccountId, contactId, newStage } = event.payload;
    if (!subAccountId) return;
    try {
      const data = await resolveContact(event.payload);
      if (!data.email) return;
      await handleDealStageChanged(subAccountId, contactId || null, { email: data.email, firstName: data.firstName }, newStage || "unknown");
    } catch (err: any) {
      console.error("[EVENT-SUB:mailchimp] deal_stage_changed handler error:", err.message);
    }
  });

  console.log("[EVENT-BUS] All subscribers initialized (including Mailchimp)");
}
