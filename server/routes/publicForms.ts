import type { Express } from "express";
import express from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { subAccounts } from "@shared/schema";
import { asyncHandler } from "./helpers";
import { publishEventAsync, EVENT_TYPES as BUS_EVENT_TYPES } from "../eventBus";
import { emitWithTimeline, EVENT_TYPES } from "../intelligence/eventEmitter";

const NEW_LEAD_STAGE_NAME = "New Lead";

function pickField(body: Record<string, any>, ...keys: string[]): string {
  for (const k of keys) {
    const v = body?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function splitName(full: string): { firstName: string; lastName: string | null } {
  const trimmed = (full || "").trim();
  if (!trimmed) return { firstName: "Lead", lastName: null };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

const corsHeaders = (_req: any, res: any, next: any) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") return res.status(204).send();
  next();
};

export function registerPublicFormsRoutes(app: Express): void {
  app.options("/api/public/form/:token", corsHeaders);

  app.post(
    "/api/public/form/:token",
    corsHeaders,
    express.json(),
    asyncHandler(async (req, res) => {
      const token = String(req.params.token || "").trim();
      if (!token) {
        return res.status(400).json({ error: "Missing form token" });
      }

      const matches = await db
        .select()
        .from(subAccounts)
        .where(eq(subAccounts.webhookToken, token))
        .limit(2);

      if (matches.length === 0) {
        return res.status(404).json({ error: "Unknown form token" });
      }
      if (matches.length > 1) {
        console.error(
          `[PUBLIC-FORM] token collision: ${matches.length}+ sub_accounts share webhook_token; refusing submission to avoid cross-tenant lead injection`,
        );
        return res.status(500).json({ error: "Form token is ambiguous; contact support" });
      }
      const account = matches[0];

      const body = (req.body && typeof req.body === "object") ? req.body : {};
      const formName = pickField(body, "formName", "form_name", "form");

      const fullName = pickField(body, "name", "Name", "full_name", "fullName");
      const firstNameRaw = pickField(body, "firstName", "first_name", "FirstName");
      const lastNameRaw = pickField(body, "lastName", "last_name", "LastName");
      const email = pickField(body, "email", "Email", "emailAddress") || null;
      const phone = pickField(body, "phone", "Phone", "tel", "phoneNumber") || null;
      const company = pickField(body, "company", "Company", "business") || null;
      const notes = pickField(body, "message", "notes", "comments", "Message") || null;

      let firstName = firstNameRaw;
      let lastName: string | null = lastNameRaw || null;
      if (!firstName) {
        const split = splitName(fullName);
        firstName = split.firstName;
        if (!lastName) lastName = split.lastName;
      }

      if (!email && !phone && !fullName && !firstNameRaw) {
        return res.status(400).json({ error: "Submission requires at least name, email, or phone" });
      }

      const contact = await storage.createContact({
        subAccountId: account.id,
        firstName: firstName || "Lead",
        lastName: lastName || null,
        email,
        phone,
        company,
        notes,
        source: "public_form",
        tags: formName ? [formName] : ["public-form"],
      });

      const stages = await storage.getPipelineStages(account.id);
      let newLeadStage = stages.find((s) => s.name === NEW_LEAD_STAGE_NAME);
      if (!newLeadStage) {
        newLeadStage = stages.find((s) => s.name.toLowerCase() === NEW_LEAD_STAGE_NAME.toLowerCase());
      }
      if (!newLeadStage) {
        newLeadStage = [...stages].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
      }
      if (!newLeadStage) {
        newLeadStage = await storage.createPipelineStage({
          subAccountId: account.id,
          name: NEW_LEAD_STAGE_NAME,
          position: 0,
        });
      }

      const dealTitle = [firstName, lastName].filter(Boolean).join(" ").trim()
        || email
        || phone
        || formName
        || "New Lead";

      const deal = await storage.createDeal({
        subAccountId: account.id,
        contactId: contact.id,
        stageId: newLeadStage.id,
        title: dealTitle,
        value: 0,
        status: "open",
        notes: formName ? `From form: ${formName}` : "Public form submission",
      });

      const ctx = {
        leadName: dealTitle,
        leadPhone: phone || "",
        leadEmail: email || "",
        source: "public_form",
        contactId: contact.id,
        dealId: deal.id,
        formName,
      };
      import("./v1")
        .then(({ fireAutomationTriggerGlobal }) => {
          fireAutomationTriggerGlobal("new_lead", account.id, ctx).catch((err) =>
            console.warn("[PUBLIC-FORM] new_lead trigger failed:", err instanceof Error ? err.message : err),
          );
          fireAutomationTriggerGlobal("OnNewLead", account.id, ctx).catch((err) =>
            console.warn("[PUBLIC-FORM] OnNewLead trigger failed:", err instanceof Error ? err.message : err),
          );
        })
        .catch((e) =>
          console.error("[PUBLIC-FORM] automation import failed:", e instanceof Error ? e.message : e),
        );

      publishEventAsync(BUS_EVENT_TYPES.FORM_SUBMITTED, "public-form", {
        subAccountId: account.id,
        formName,
        contactId: contact.id,
        dealId: deal.id,
        source: "public_form",
      });
      publishEventAsync(BUS_EVENT_TYPES.CONTACT_CREATED, "public-form", {
        subAccountId: account.id,
        contactId: contact.id,
        name: dealTitle,
        phone,
        email,
        source: "public_form",
      });

      emitWithTimeline(
        {
          eventType: EVENT_TYPES.FORM_SUBMIT,
          sourceModule: "publicForms",
          subAccountId: account.id,
          metadata: { formName, contactId: contact.id, dealId: deal.id, email, phone },
        },
        `Public form submitted: ${formName || "Lead Form"}`,
        `New lead from ${formName || "public form"}: ${dealTitle}`,
        "info",
      );

      return res.json({
        success: true,
        message: "Thank you! Your submission has been received.",
        contactId: contact.id,
        dealId: deal.id,
      });
    }),
  );

}
