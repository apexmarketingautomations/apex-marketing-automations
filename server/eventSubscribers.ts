import { eventBus, EVENT_TYPES, type ApexEvent } from "./eventBus";
import { dispatchAlert, generateDeepLink } from "./pushAlertService";

let storageRef: any = null;
let systemLoggerRef: any = null;

export function initEventSubscribers(storage: any, systemLogger?: any) {
  storageRef = storage;
  systemLoggerRef = systemLogger;

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
    if (storageRef) {
      try {
        await storageRef.createSystemLog({
          level: "error",
          source: "event-bus",
          message: `Workflow ${event.payload.workflowId} failed: ${event.payload.error || "unknown"}`,
          details: event.payload,
        });
      } catch {}
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

  eventBus.subscribe("*", "event-logger", async (event) => {
    if (storageRef) {
      try {
        await storageRef.createSystemLog({
          level: "info",
          source: "event-bus",
          message: `Event: ${event.event_type} from ${event.source_module}`,
          details: { event_id: event.event_id, payload_keys: Object.keys(event.payload) },
        });
      } catch {}
    }
  }, -100);

  console.log("[EVENT-BUS] All subscribers initialized");
}
