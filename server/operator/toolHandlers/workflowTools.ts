import type { OperatorTool, ValidationResult, ToolResult, OperatorContext } from "../types";
import { storage } from "../../storage";
import { publishEventAsync, EVENT_TYPES } from "../../eventBus";

function noopValidate(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

export const workflowTools: OperatorTool[] = [
  {
    name: "diagnoseWorkflow",
    description: "Analyze a workflow for issues and suggest improvements",
    category: "workflow",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [
      { name: "workflowId", type: "number", required: true, description: "ID of the workflow to diagnose" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const automations = await storage.getLiveAutomations(ctx.subAccountId);
      const automation = automations?.find(a => a.id === params.workflowId);
      if (!automation) return { success: false, error: "Workflow not found" };

      const issues: string[] = [];
      const suggestions: string[] = [];
      const manifest = automation.manifest as Record<string, unknown>;

      if (!manifest?.trigger) issues.push("No trigger defined — workflow will never fire");
      if (!manifest?.steps || !Array.isArray(manifest.steps) || manifest.steps.length === 0) issues.push("No steps defined — workflow does nothing");

      const steps = Array.isArray(manifest?.steps) ? manifest.steps as Array<Record<string, unknown>> : [];
      for (const step of steps) {
        if (step.action === "SMS" && !step.message) issues.push("SMS step missing message body");
        if (step.action === "WAIT" && (step.duration as number) > 30) suggestions.push("Wait step exceeds 30s sync limit — consider background scheduling");
        if (step.action === "CONDITION" && !step.condition) issues.push("Condition step missing condition logic");
      }

      const runLogs = Array.isArray((automation as Record<string, unknown>).runLogs) ? (automation as Record<string, unknown>).runLogs as Array<Record<string, unknown>> : [];
      const recentFailures = runLogs.filter(l => l.status === "error").slice(-5);
      if (recentFailures.length > 0) {
        issues.push(`${recentFailures.length} recent execution failures detected`);
      }

      return {
        success: true,
        data: {
          workflowId: automation.id,
          name: automation.name,
          status: automation.status,
          issues,
          suggestions,
          healthy: issues.length === 0,
          recentFailures: recentFailures.length,
        },
      };
    },
    summarizeForAudit: (params, result) => `Diagnosed workflow #${params.workflowId}: ${result.data?.issues?.length || 0} issues found.`,
  },
  {
    name: "createWorkflow",
    description: "Create a new automation workflow from a manifest",
    category: "workflow",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "name", type: "string", required: true, description: "Workflow name" },
      { name: "trigger", type: "string", required: true, description: "Trigger event" },
      { name: "steps", type: "array", required: true, description: "Array of workflow step objects" },
      { name: "idempotencyKey", type: "string", required: false, description: "Idempotency key" },
    ],
    validate: (params) => {
      const errors: string[] = [];
      if (!params.steps || params.steps.length === 0) errors.push("Workflow must have at least one step");
      if (!params.trigger) errors.push("Workflow must have a trigger");
      return { valid: errors.length === 0, errors, warnings: [] };
    },
    execute: async (params, ctx) => {
      const automation = await storage.createLiveAutomation({
        subAccountId: ctx.subAccountId,
        name: params.name,
        manifest: { trigger: params.trigger, steps: params.steps },
        status: "compiled",
      });
      publishEventAsync(EVENT_TYPES.WORKFLOW_STARTED, { subAccountId: ctx.subAccountId, workflowId: automation.id, name: params.name }, "operator");
      return { success: true, data: automation, sideEffects: [`Created workflow "${params.name}" (status: compiled/draft)`], eventsFired: ["workflow.started"] };
    },
    summarizeForAudit: (params) => `Created workflow "${params.name}".`,
    idempotencyKey: (params) => params.idempotencyKey || `workflow-${params.name}`,
  },
  {
    name: "duplicateWorkflow",
    description: "Duplicate an existing workflow with a new name",
    category: "workflow",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "workflowId", type: "number", required: true, description: "Workflow ID to duplicate" },
      { name: "newName", type: "string", required: false, description: "New workflow name" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const automations = await storage.getLiveAutomations(ctx.subAccountId);
      const original = automations?.find(a => a.id === params.workflowId);
      if (!original) return { success: false, error: "Workflow not found" };

      const copy = await storage.createLiveAutomation({
        subAccountId: ctx.subAccountId,
        name: params.newName || `${original.name} (Copy)`,
        manifest: original.manifest as Record<string, unknown>,
        status: "compiled",
      });
      return { success: true, data: copy, sideEffects: [`Duplicated workflow "${original.name}" as "${copy.name}"`] };
    },
    summarizeForAudit: (params) => `Duplicated workflow #${params.workflowId}.`,
  },
  {
    name: "pauseWorkflow",
    description: "Pause an active workflow",
    category: "workflow",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "workflowId", type: "number", required: true, description: "Workflow ID to pause" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const automations = await storage.getLiveAutomations(ctx.subAccountId);
      const owned = automations?.find(a => a.id === params.workflowId);
      if (!owned) return { success: false, error: "Workflow not found" };
      const updated = await storage.updateLiveAutomation(params.workflowId, { status: "paused" });
      if (!updated) return { success: false, error: "Workflow not found" };
      return { success: true, data: updated, sideEffects: [`Paused workflow #${params.workflowId}`] };
    },
    summarizeForAudit: (params) => `Paused workflow #${params.workflowId}.`,
  },
  {
    name: "resumeWorkflow",
    description: "Resume a paused workflow",
    category: "workflow",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "workflowId", type: "number", required: true, description: "Workflow ID to resume" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const automations = await storage.getLiveAutomations(ctx.subAccountId);
      const owned = automations?.find(a => a.id === params.workflowId);
      if (!owned) return { success: false, error: "Workflow not found" };
      const updated = await storage.updateLiveAutomation(params.workflowId, { status: "active" });
      if (!updated) return { success: false, error: "Workflow not found" };
      return { success: true, data: updated, sideEffects: [`Resumed workflow #${params.workflowId}`] };
    },
    summarizeForAudit: (params) => `Resumed workflow #${params.workflowId}.`,
  },
  {
    name: "optimizeWorkflowTiming",
    description: "Analyze and suggest timing optimizations for a workflow",
    category: "workflow",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [
      { name: "workflowId", type: "number", required: true, description: "Workflow ID" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const automations = await storage.getLiveAutomations(ctx.subAccountId);
      const automation = automations?.find(a => a.id === params.workflowId);
      if (!automation) return { success: false, error: "Workflow not found" };

      const manifest = automation.manifest as Record<string, unknown>;
      const suggestions: string[] = [];
      const mSteps = Array.isArray(manifest?.steps) ? manifest.steps as Array<Record<string, unknown>> : [];

      if (mSteps.length > 0) {
        const waitSteps = mSteps.filter(s => s.action === "WAIT");
        if (waitSteps.length > 2) suggestions.push("Consider consolidating multiple wait steps to reduce complexity");
        const smsSteps = mSteps.filter(s => s.action === "SMS");
        if (smsSteps.length > 0) suggestions.push("SMS messages are most effective between 9am-11am and 1pm-3pm local time");
        if (mSteps.length > 5) suggestions.push("Complex workflows (>5 steps) benefit from A/B testing individual paths");
      }

      if (suggestions.length === 0) suggestions.push("Workflow timing looks optimal — no changes recommended");

      return {
        success: true,
        data: { workflowId: params.workflowId, name: automation.name, suggestions, stepCount: mSteps.length },
      };
    },
    summarizeForAudit: (params, result) => `Analyzed timing for workflow #${params.workflowId}: ${result.data?.suggestions?.length || 0} suggestions.`,
  },
  {
    name: "generateAutoResponseWorkflow",
    description: "Generate an auto-response workflow template for a trigger",
    category: "workflow",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "trigger", type: "string", required: true, description: "Trigger event" },
      { name: "responseMessage", type: "string", required: true, description: "Response message" },
      { name: "channel", type: "string", required: false, description: "Channel: sms, email, whatsapp" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const channel = params.channel || "sms";
      const workflow = await storage.createLiveAutomation({
        subAccountId: ctx.subAccountId,
        name: `Auto-Response: ${params.trigger}`,
        manifest: {
          trigger: params.trigger,
          steps: [
            { action: "WAIT", duration: 2 },
            { action: channel.toUpperCase(), message: params.responseMessage },
          ],
        },
        status: "compiled",
      });
      return {
        success: true,
        data: workflow,
        sideEffects: [`Generated auto-response workflow for "${params.trigger}" via ${channel}`],
      };
    },
    summarizeForAudit: (params) => `Generated auto-response workflow for trigger "${params.trigger}".`,
  },
  {
    name: "generateReactivationWorkflow",
    description: "Generate a reactivation workflow for inactive contacts",
    category: "workflow",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "inactiveDays", type: "number", required: false, description: "Days of inactivity threshold" },
      { name: "message", type: "string", required: false, description: "Reactivation message" },
      { name: "channel", type: "string", required: false, description: "Channel: sms or email" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const days = params.inactiveDays || 30;
      const channel = params.channel || "sms";
      const message = params.message || `Hey! We haven't heard from you in a while. We'd love to reconnect — reply HELLO to chat!`;

      const workflow = await storage.createLiveAutomation({
        subAccountId: ctx.subAccountId,
        name: `Reactivation: ${days}-day inactive`,
        manifest: {
          trigger: "contact_inactive",
          conditions: { inactiveDays: days },
          steps: [
            { action: channel.toUpperCase(), message },
            { action: "WAIT", duration: 72 * 60 * 60 },
            { action: "TAG", tag: "reactivation-attempted" },
          ],
        },
        status: "compiled",
      });
      return {
        success: true,
        data: workflow,
        sideEffects: [`Generated reactivation workflow (${days}-day inactive contacts via ${channel})`],
      };
    },
    summarizeForAudit: (params) => `Generated reactivation workflow for ${params.inactiveDays || 30}-day inactive contacts.`,
  },
];
