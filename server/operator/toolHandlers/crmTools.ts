import type { OperatorTool, ValidationResult, ToolResult, OperatorContext } from "../types";
import { storage } from "../../storage";
import { publishEventAsync, EVENT_TYPES } from "../../eventBus";
import { verifyTenant } from "./tenantGuard";
import { validateRouting } from "../../routing/gate";

function noopValidate(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

export const crmTools: OperatorTool[] = [
  {
    name: "createContact",
    description: "Create a new CRM contact",
    category: "crm",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "firstName", type: "string", required: true, description: "Contact first name" },
      { name: "lastName", type: "string", required: false, description: "Contact last name" },
      { name: "phone", type: "string", required: false, description: "Phone number" },
      { name: "email", type: "string", required: false, description: "Email address" },
      { name: "source", type: "string", required: false, description: "Lead source" },
      { name: "tags", type: "array", required: false, description: "Contact tags" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const gateResult = await validateRouting({
        subAccountId: ctx.subAccountId,
        source: params.source || "operator",
        channel: "crm",
        phone: params.phone || undefined,
      });
      if (!gateResult.allowed) {
        return { success: false, error: `Routing gate blocked contact creation: ${gateResult.reason}` };
      }
      const contact = await storage.createContact({
        subAccountId: ctx.subAccountId,
        firstName: params.firstName,
        lastName: params.lastName || null,
        phone: params.phone || null,
        email: params.email || null,
        source: params.source || "operator",
        channel: "crm",
        tags: params.tags || [],
      });
      publishEventAsync(EVENT_TYPES.CONTACT_CREATED, { subAccountId: ctx.subAccountId, contactId: contact.id }, "operator");
      return { success: true, data: { id: contact.id, name: `${contact.firstName} ${contact.lastName || ""}`.trim(), phone: contact.phone, email: contact.email }, eventsFired: ["contact.created"] };
    },
    summarizeForAudit: (params, result) => `Created contact "${params.firstName} ${params.lastName || ""}".`,
  },
  {
    name: "updateContact",
    description: "Update an existing CRM contact's details",
    category: "crm",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "contactId", type: "number", required: true, description: "Contact ID" },
      { name: "firstName", type: "string", required: false, description: "First name" },
      { name: "lastName", type: "string", required: false, description: "Last name" },
      { name: "phone", type: "string", required: false, description: "Phone" },
      { name: "email", type: "string", required: false, description: "Email" },
      { name: "tags", type: "array", required: false, description: "Tags" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const { contactId, ...updates } = params;
      const existing = await storage.getContactById(contactId);
      const guard = verifyTenant(existing, ctx.subAccountId, "Contact");
      if (guard) return guard;
      const contact = await storage.updateContact(contactId, updates);
      if (!contact) return { success: false, error: "Contact not found" };
      publishEventAsync(EVENT_TYPES.CONTACT_UPDATED, { subAccountId: ctx.subAccountId, contactId }, "operator");
      return { success: true, data: { id: contact.id, name: `${contact.firstName} ${contact.lastName || ""}`.trim(), phone: contact.phone, email: contact.email }, eventsFired: ["contact.updated"] };
    },
    summarizeForAudit: (params) => `Updated contact #${params.contactId}.`,
  },
  {
    name: "tagContact",
    description: "Add tags to a CRM contact",
    category: "crm",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "contactId", type: "number", required: true, description: "Contact ID" },
      { name: "tags", type: "array", required: true, description: "Tags to add" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const existing = await storage.getContactById(params.contactId);
      const guard = verifyTenant(existing, ctx.subAccountId, "Contact");
      if (guard) return guard;
      const currentTags: string[] = (existing!.tags as string[]) || [];
      const merged = Array.from(new Set([...currentTags, ...params.tags]));
      const updated = await storage.updateContact(params.contactId, { tags: merged });
      return { success: true, data: updated, sideEffects: [`Added ${params.tags.length} tag(s)`] };
    },
    summarizeForAudit: (params) => `Tagged contact #${params.contactId} with [${params.tags.join(", ")}].`,
  },
  {
    name: "untagContact",
    description: "Remove tags from a CRM contact",
    category: "crm",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "contactId", type: "number", required: true, description: "Contact ID" },
      { name: "tags", type: "array", required: true, description: "Tags to remove" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const existing = await storage.getContactById(params.contactId);
      const guard = verifyTenant(existing, ctx.subAccountId, "Contact");
      if (guard) return guard;
      const currentTags: string[] = (existing!.tags as string[]) || [];
      const filtered = currentTags.filter(t => !params.tags.includes(t));
      const updated = await storage.updateContact(params.contactId, { tags: filtered });
      return { success: true, data: updated, sideEffects: [`Removed ${params.tags.length} tag(s)`] };
    },
    summarizeForAudit: (params) => `Untagged contact #${params.contactId}: [${params.tags.join(", ")}].`,
  },
  {
    name: "createTask",
    description: "Create a draft task for follow-up",
    category: "crm",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "title", type: "string", required: true, description: "Task title" },
      { name: "description", type: "string", required: false, description: "Task description" },
      { name: "assignedTo", type: "string", required: false, description: "Assignee" },
      { name: "dueDate", type: "string", required: false, description: "Due date (ISO string)" },
      { name: "priority", type: "string", required: false, description: "Priority: low, medium, high" },
      { name: "idempotencyKey", type: "string", required: false, description: "Idempotency key" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const task = {
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        subAccountId: ctx.subAccountId,
        title: params.title,
        description: params.description || "",
        assignedTo: params.assignedTo || "unassigned",
        dueDate: params.dueDate || null,
        priority: params.priority || "medium",
        status: "draft",
        createdAt: new Date().toISOString(),
      };
      return { success: true, data: task, sideEffects: ["Created task draft (in-memory)"] };
    },
    summarizeForAudit: (params) => `Created task: "${params.title}".`,
    idempotencyKey: (params) => params.idempotencyKey || `task-${params.title}`,
  },
  {
    name: "assignTask",
    description: "Assign a task to a team member",
    category: "crm",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "taskId", type: "string", required: true, description: "Task ID" },
      { name: "assignedTo", type: "string", required: true, description: "Assignee" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      return {
        success: true,
        data: { taskId: params.taskId, assignedTo: params.assignedTo, status: "assigned" },
        sideEffects: [`Assigned task ${params.taskId} to ${params.assignedTo}`],
      };
    },
    summarizeForAudit: (params) => `Assigned task ${params.taskId} to ${params.assignedTo}.`,
  },
  {
    name: "createPipeline",
    description: "Create a CRM pipeline with stages for a sub-account",
    category: "crm",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "stages", type: "array", required: true, description: "Array of {name, color} stage definitions" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const created: Array<{ id: number; name: string; color: string | null; position: number }> = [];
      for (let i = 0; i < params.stages.length; i++) {
        const s = params.stages[i];
        const stage = await storage.createPipelineStage({
          subAccountId: ctx.subAccountId,
          name: s.name,
          color: s.color || "#6366f1",
          position: i,
        });
        created.push(stage);
      }
      publishEventAsync(EVENT_TYPES.DEAL_CREATED, { subAccountId: ctx.subAccountId, stageCount: created.length }, "operator");
      return { success: true, data: { stageCount: created.length, stageNames: created.map(s => s.name) }, sideEffects: [`Created ${created.length} pipeline stages: ${created.map(s => s.name).join(", ")}`] };
    },
    summarizeForAudit: (params) => `Created pipeline with ${params.stages?.length || 0} stages.`,
  },
  {
    name: "createPipelineStage",
    description: "Add a single stage to the pipeline",
    category: "crm",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "name", type: "string", required: true, description: "Stage name" },
      { name: "color", type: "string", required: false, description: "Stage color" },
      { name: "position", type: "number", required: false, description: "Position/order" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const stages = await storage.getPipelineStages(ctx.subAccountId);
      const stage = await storage.createPipelineStage({
        subAccountId: ctx.subAccountId,
        name: params.name,
        color: params.color || "#6366f1",
        position: params.position ?? stages.length,
      });
      return { success: true, data: { name: stage.name, position: stage.position, color: stage.color }, sideEffects: [`Created pipeline stage "${params.name}"`] };
    },
    summarizeForAudit: (params) => `Created pipeline stage "${params.name}".`,
  },
  {
    name: "advanceDealStage",
    description: "Move a deal to a new pipeline stage",
    category: "crm",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "dealId", type: "number", required: true, description: "Deal ID" },
      { name: "newStageId", type: "number", required: true, description: "New stage ID" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const existing = await storage.getDealById(params.dealId);
      const guard = verifyTenant(existing, ctx.subAccountId, "Deal");
      if (guard) return guard;
      const deal = await storage.updateDeal(params.dealId, { stageId: params.newStageId });
      if (!deal) return { success: false, error: "Deal not found" };
      publishEventAsync(EVENT_TYPES.DEAL_STAGE_CHANGED, { subAccountId: ctx.subAccountId, dealId: params.dealId, newStageId: params.newStageId }, "operator");
      return { success: true, data: { id: deal.id, title: deal.title, stageId: deal.stageId }, eventsFired: ["deal.stage.changed"], sideEffects: [`Advanced deal #${params.dealId} to stage #${params.newStageId}`] };
    },
    summarizeForAudit: (params) => `Advanced deal #${params.dealId} to stage #${params.newStageId}.`,
  },
  {
    name: "createDeal",
    description: "Create a new deal in the pipeline",
    category: "crm",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "title", type: "string", required: true, description: "Deal title" },
      { name: "value", type: "number", required: false, description: "Deal value" },
      { name: "contactId", type: "number", required: false, description: "Associated contact" },
      { name: "stageId", type: "number", required: true, description: "Pipeline stage ID" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const gateResult = await validateRouting({
        subAccountId: ctx.subAccountId,
        source: "operator",
        channel: "crm",
      });
      if (!gateResult.allowed) {
        return { success: false, error: `Routing gate blocked deal creation: ${gateResult.reason}` };
      }
      const deal = await storage.createDeal({
        subAccountId: ctx.subAccountId,
        title: params.title,
        value: params.value || 0,
        contactId: params.contactId || null,
        stageId: params.stageId,
        status: "open",
      });
      publishEventAsync(EVENT_TYPES.DEAL_CREATED, { subAccountId: ctx.subAccountId, dealId: deal.id }, "operator");
      return { success: true, data: { id: deal.id, title: deal.title, value: deal.value, status: deal.status }, eventsFired: ["deal.created"] };
    },
    summarizeForAudit: (params, result) => `Created deal "${params.title}" ($${params.value || 0}).`,
  },
  {
    name: "updateDealValue",
    description: "Update the value of a deal",
    category: "crm",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "dealId", type: "number", required: true, description: "Deal ID" },
      { name: "value", type: "number", required: true, description: "New value" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const existing = await storage.getDealById(params.dealId);
      const guard = verifyTenant(existing, ctx.subAccountId, "Deal");
      if (guard) return guard;
      const deal = await storage.updateDeal(params.dealId, { value: params.value });
      if (!deal) return { success: false, error: "Deal not found" };
      return { success: true, data: { id: deal.id, title: deal.title, value: deal.value }, sideEffects: [`Updated deal #${params.dealId} value to $${params.value}`] };
    },
    summarizeForAudit: (params) => `Updated deal #${params.dealId} value to $${params.value}.`,
  },
  {
    name: "assignLeadOwner",
    description: "Assign an owner to a lead/contact",
    category: "crm",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "contactId", type: "number", required: true, description: "Contact ID" },
      { name: "owner", type: "string", required: true, description: "Owner name or ID" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const existing = await storage.getContactById(params.contactId);
      const guard = verifyTenant(existing, ctx.subAccountId, "Contact");
      if (guard) return guard;
      const currentTags: string[] = (existing!.tags as string[]) || [];
      const ownerTag = `owner:${params.owner}`;
      const filtered = currentTags.filter(t => !t.startsWith("owner:"));
      const updated = await storage.updateContact(params.contactId, { tags: [...filtered, ownerTag] });
      return { success: true, data: { contactId: params.contactId, owner: params.owner }, sideEffects: [`Assigned owner "${params.owner}" to contact #${params.contactId}`] };
    },
    summarizeForAudit: (params) => `Assigned lead #${params.contactId} to owner "${params.owner}".`,
  },
  {
    name: "scoreLead",
    description: "Score a lead using rule-based criteria (tags, source, activity)",
    category: "crm",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [
      { name: "contactId", type: "number", required: true, description: "Contact ID to score" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const contact = await storage.getContactById(params.contactId);
      const guard = verifyTenant(contact, ctx.subAccountId, "Contact");
      if (guard) return guard;

      let score = 10;
      const factors: string[] = [];
      const tags = (contact!.tags as string[]) || [];

      if (contact!.email) { score += 15; factors.push("+15 has email"); }
      if (contact!.phone) { score += 15; factors.push("+15 has phone"); }
      if (tags.includes("hot")) { score += 20; factors.push("+20 tagged hot"); }
      if (tags.includes("qualified")) { score += 15; factors.push("+15 tagged qualified"); }
      if (contact!.source === "referral") { score += 20; factors.push("+20 referral source"); }
      else if (contact!.source === "website") { score += 10; factors.push("+10 website source"); }
      if (tags.length > 3) { score += 5; factors.push("+5 multiple tags"); }

      score = Math.min(100, score);

      return {
        success: true,
        data: {
          contactId: params.contactId,
          score,
          grade: score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : "D",
          factors,
        },
      };
    },
    summarizeForAudit: (params, result) => `Scored lead #${params.contactId}: ${result.data?.score || 0}.`,
  },
  {
    name: "segmentContacts",
    description: "Segment contacts by criteria (tags, source, score)",
    category: "crm",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [
      { name: "criteria", type: "object", required: true, description: "Filter criteria: {tags, source, minScore}" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const contacts = await storage.getContacts(ctx.subAccountId);
      let filtered = contacts || [];

      if (params.criteria.tags && params.criteria.tags.length > 0) {
        filtered = filtered.filter(c => {
          const cTags = (c.tags as string[]) || [];
          return params.criteria.tags.some((t: string) => cTags.includes(t));
        });
      }
      if (params.criteria.source) {
        filtered = filtered.filter(c => c.source === params.criteria.source);
      }

      return {
        success: true,
        data: {
          total: filtered.length,
          contacts: filtered.map(c => ({ id: c.id, firstName: c.firstName, lastName: c.lastName, tags: c.tags })),
          criteria: params.criteria,
        },
      };
    },
    summarizeForAudit: (params, result) => `Segmented contacts: ${result.data?.total || 0} matched.`,
  },
];
