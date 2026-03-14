import { eventBus, EVENT_TYPES } from "../eventBus";
import { incrementCounter, setGauge } from "./telemetry";
import { setMemory } from "./memory";
import { logSystemEvent } from "../systemLogger";
import { dispatchAlert, generateDeepLink } from "../pushAlertService";

export function initOperatorEventHooks(): void {
  eventBus.subscribe(EVENT_TYPES.WORKFLOW_FAILED, "operator-monitor", async (event) => {
    incrementCounter("operator.events.workflow_failure");
    eventBus.publishAsync("system.workflow_failure", {
      workflowId: event.payload.workflowId,
      error: event.payload.error,
      subAccountId: event.payload.subAccountId,
    }, "operator-monitor");

    if (event.payload.subAccountId) {
      const failures = (await import("./memory")).getMemory(event.payload.subAccountId, "recent_workflow_failures") || [];
      failures.push({ workflowId: event.payload.workflowId, error: event.payload.error, at: new Date().toISOString() });
      if (failures.length > 20) failures.splice(0, failures.length - 20);
      setMemory(event.payload.subAccountId, "recent_workflow_failures", failures, 86400000);

      dispatchAlert(event.payload.subAccountId, "system_alert", {
        title: "Workflow Failed",
        body: `Workflow ${event.payload.workflowId || "unknown"} failed: ${(event.payload.error || "").substring(0, 150)}`,
        link: generateDeepLink("/workflows"),
        tag: `wf-fail-${event.payload.workflowId || Date.now()}`,
      }).catch(e => console.error("[PUSH-ALERT] workflow fail dispatch error:", e instanceof Error ? e.message : e));
    }
  }, 10);

  eventBus.subscribe(EVENT_TYPES.INTEGRATION_DISCONNECTED, "operator-monitor", async (event) => {
    incrementCounter("operator.events.integration_disconnected");
    eventBus.publishAsync("system.integration_disconnected", {
      provider: event.payload.provider,
      subAccountId: event.payload.subAccountId,
    }, "operator-monitor");

    if (event.payload.subAccountId) {
      dispatchAlert(event.payload.subAccountId, "system_alert", {
        title: "Integration Disconnected",
        body: `${event.payload.provider || "An integration"} has been disconnected.`,
        link: generateDeepLink("/integrations"),
        tag: `int-disc-${event.payload.provider || Date.now()}`,
        urgency: "high",
      }).catch(e => console.error("[PUSH-ALERT] integration disconnect dispatch error:", e instanceof Error ? e.message : e));
    }
  }, 10);

  eventBus.subscribe(EVENT_TYPES.INTEGRATION_ERROR, "operator-monitor", async (event) => {
    incrementCounter("operator.events.integration_error");
  }, 5);

  eventBus.subscribe(EVENT_TYPES.MESSAGE_FAILED, "operator-monitor", async (event) => {
    incrementCounter("operator.events.message_failure");
    if (event.payload.subAccountId) {
      const failures = (await import("./memory")).getMemory(event.payload.subAccountId, "recent_message_failures") || 0;
      setMemory(event.payload.subAccountId, "recent_message_failures", failures + 1, 3600000);
    }
  }, 5);

  eventBus.subscribe(EVENT_TYPES.CONTACT_CREATED, "operator-telemetry", async (event) => {
    incrementCounter("operator.events.contact_created");
  }, -10);

  eventBus.subscribe(EVENT_TYPES.MESSAGE_SENT, "operator-telemetry", async (event) => {
    incrementCounter("operator.events.message_sent");
  }, -10);

  eventBus.subscribe(EVENT_TYPES.FORM_SUBMITTED, "operator-telemetry", async (event) => {
    incrementCounter("operator.events.form_submitted");
  }, -10);

  eventBus.subscribe(EVENT_TYPES.PAYMENT_COMPLETED, "operator-telemetry", async (event) => {
    incrementCounter("operator.events.payment_completed");
  }, -10);

  eventBus.subscribe(EVENT_TYPES.CRASH_DETECTED, "operator-telemetry", async (event) => {
    incrementCounter("operator.events.crash_detected");
  }, -10);

  eventBus.subscribe(EVENT_TYPES.DEAL_CREATED, "operator-telemetry", async (event) => {
    incrementCounter("operator.events.deal_created");
  }, -10);

  eventBus.subscribe(EVENT_TYPES.SITE_GENERATED, "operator-telemetry", async (event) => {
    incrementCounter("operator.events.site_generated");
  }, -10);

  console.log("[OPERATOR] Event hooks initialized");
}
