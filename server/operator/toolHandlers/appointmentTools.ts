import type { OperatorTool, ValidationResult, ToolResult, OperatorContext } from "../types";
import { storage } from "../../storage";
import { publishEventAsync, EVENT_TYPES } from "../../eventBus";
import { verifyTenant } from "./tenantGuard";

function noopValidate(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

export const appointmentTools: OperatorTool[] = [
  {
    name: "createAppointmentDraft",
    description: "Create a draft appointment for a contact",
    category: "appointment",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "contactId", type: "number", required: true, description: "Contact ID" },
      { name: "title", type: "string", required: true, description: "Appointment title" },
      { name: "startTime", type: "string", required: true, description: "Start time (ISO string)" },
      { name: "endTime", type: "string", required: false, description: "End time (ISO string)" },
      { name: "notes", type: "string", required: false, description: "Notes" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const contact = await storage.getContactById(params.contactId);
      const contactGuard = verifyTenant(contact, ctx.subAccountId, "Contact");
      if (contactGuard) return contactGuard;

      const appointment = await storage.createAppointment({
        subAccountId: ctx.subAccountId,
        contactId: params.contactId,
        title: params.title,
        startTime: new Date(params.startTime),
        endTime: params.endTime ? new Date(params.endTime) : new Date(new Date(params.startTime).getTime() + 3600000),
        status: "draft",
        description: params.notes || null,
      });
      publishEventAsync(EVENT_TYPES.APPOINTMENT_BOOKED, { subAccountId: ctx.subAccountId, appointmentId: appointment.id }, "operator");
      return {
        success: true,
        data: appointment,
        sideEffects: [`Created draft appointment "${params.title}" for ${contact.firstName}`],
        eventsFired: ["appointment.booked"],
      };
    },
    summarizeForAudit: (params) => `Created appointment draft "${params.title}".`,
  },
  {
    name: "rescheduleAppointmentDraft",
    description: "Create a draft reschedule for an existing appointment",
    category: "appointment",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "appointmentId", type: "number", required: true, description: "Appointment ID" },
      { name: "newStartTime", type: "string", required: true, description: "New start time (ISO)" },
      { name: "newEndTime", type: "string", required: false, description: "New end time (ISO)" },
      { name: "reason", type: "string", required: false, description: "Reason for reschedule" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const appt = await storage.getAppointmentById(params.appointmentId);
      const guard = verifyTenant(appt, ctx.subAccountId, "Appointment");
      if (guard) return guard;

      return {
        success: true,
        data: {
          status: "draft_reschedule",
          appointmentId: params.appointmentId,
          originalStart: appt.startTime,
          newStartTime: params.newStartTime,
          newEndTime: params.newEndTime || null,
          reason: params.reason || null,
          note: "Reschedule saved as draft. Application requires approval. Calendar sync is stubbed.",
        },
        sideEffects: ["Created reschedule draft"],
      };
    },
    summarizeForAudit: (params) => `Drafted reschedule for appointment #${params.appointmentId}.`,
  },
  {
    name: "cancelAppointmentDraft",
    description: "Create a draft cancellation for an appointment",
    category: "appointment",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "appointmentId", type: "number", required: true, description: "Appointment ID" },
      { name: "reason", type: "string", required: false, description: "Cancellation reason" },
      { name: "notifyContact", type: "boolean", required: false, description: "Whether to notify contact" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const appt = await storage.getAppointmentById(params.appointmentId);
      const guard = verifyTenant(appt, ctx.subAccountId, "Appointment");
      if (guard) return guard;

      return {
        success: true,
        data: {
          status: "draft_cancellation",
          appointmentId: params.appointmentId,
          title: appt.title,
          reason: params.reason || null,
          notifyContact: params.notifyContact ?? true,
          note: "Cancellation saved as draft. Requires approval.",
        },
        sideEffects: ["Created cancellation draft"],
      };
    },
    summarizeForAudit: (params) => `Drafted cancellation for appointment #${params.appointmentId}.`,
  },
  {
    name: "sendAppointmentReminderDraft",
    description: "Create a draft reminder for an upcoming appointment",
    category: "appointment",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "appointmentId", type: "number", required: true, description: "Appointment ID" },
      { name: "channel", type: "string", required: false, description: "Channel: sms or email" },
      { name: "message", type: "string", required: false, description: "Custom reminder message" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const appt = await storage.getAppointmentById(params.appointmentId);
      const guard1 = verifyTenant(appt, ctx.subAccountId, "Appointment");
      if (guard1) return guard1;

      const channel = params.channel || "sms";
      const message = params.message || `Reminder: You have "${appt.title}" scheduled. We look forward to seeing you!`;

      return {
        success: true,
        data: {
          status: "draft",
          appointmentId: params.appointmentId,
          channel,
          message,
          note: "Reminder saved as draft. Sending requires approval.",
        },
        sideEffects: ["Created appointment reminder draft"],
      };
    },
    summarizeForAudit: (params) => `Drafted reminder for appointment #${params.appointmentId}.`,
  },
  {
    name: "confirmAppointmentDraft",
    description: "Create a draft confirmation message for an appointment",
    category: "appointment",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "appointmentId", type: "number", required: true, description: "Appointment ID" },
      { name: "confirmationMessage", type: "string", required: false, description: "Custom confirmation message" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const appt = await storage.getAppointmentById(params.appointmentId);
      const guard2 = verifyTenant(appt, ctx.subAccountId, "Appointment");
      if (guard2) return guard2;

      const message = params.confirmationMessage || `Your appointment "${appt.title}" has been confirmed. See you soon!`;

      return {
        success: true,
        data: {
          status: "draft_confirmation",
          appointmentId: params.appointmentId,
          message,
          note: "Confirmation saved as draft. Sending requires approval.",
        },
        sideEffects: ["Created appointment confirmation draft"],
      };
    },
    summarizeForAudit: (params) => `Drafted confirmation for appointment #${params.appointmentId}.`,
  },
];
