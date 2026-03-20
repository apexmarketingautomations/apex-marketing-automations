import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import express from "express";
import { publishEventAsync, EVENT_TYPES } from "../eventBus";
import { asyncHandler } from "./helpers";

export function registerFunnelRoutes(app: Express) {
  // ---- Public Form Submission Endpoint (no auth required) ----
  app.post("/api/form-submit", express.json(), asyncHandler(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    const { subAccountId, formName, ...formData } = req.body;
    const accountId = parseInt(subAccountId);
    if (!accountId) return res.status(400).json({ error: "Missing subAccountId" });

    const contactPhone = formData.phone || formData.Phone || formData.tel || "";
    const contactName = formData.name || formData.Name || formData.full_name || "";
    const contactEmail = formData.email || formData.Email || "";

    if (contactPhone || contactEmail) {
      try {
        await storage.createContact({
          subAccountId: accountId,
          firstName: contactName || "Lead",
          phone: contactPhone || null,
          email: contactEmail || null,
          source: "form",
          tags: formName ? [formName] : ["form-submission"],
        });
        import("./v1").then(({ fireAutomationTriggerGlobal }) => {
          const ctx = {
            leadName: contactName || "Lead",
            leadPhone: contactPhone,
            leadEmail: contactEmail,
            source: "form_submit",
          };
          fireAutomationTriggerGlobal("new_lead", accountId, ctx).catch(() => {});
          fireAutomationTriggerGlobal("OnNewLead", accountId, ctx).catch(() => {});
          fireAutomationTriggerGlobal("facebook_form_submit", accountId, ctx).catch(() => {});
        }).catch(e => console.error("[FUNNEL] trigger failed:", e instanceof Error ? e.message : e));
      } catch (e) {
        console.log("[FORM] Contact creation skipped (may already exist):", (e as any).message);
      }
    }

    await storage.createMessage({
      subAccountId: accountId,
      contactPhone: contactPhone || contactEmail || "form-submission",
      body: `Form submission (${formName || 'Lead Form'}): ${JSON.stringify(formData, null, 2)}`,
      direction: "inbound",
      channel: "form",
      status: "received",
    });

    publishEventAsync(EVENT_TYPES.FORM_SUBMITTED, "form-endpoint", {
      subAccountId: accountId, formName, contactName, contactPhone, contactEmail, source: "public_form",
    });
    publishEventAsync(EVENT_TYPES.CONTACT_CREATED, "form-endpoint", {
      subAccountId: accountId, name: contactName, phone: contactPhone, email: contactEmail, source: "form",
    });

    res.json({ success: true, message: "Thank you! Your submission has been received." });
  }));

  app.options("/api/form-submit", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send();
  });


  // ---- Funnel Lead API (public, no auth required) ----
  const funnelCors = (_req: any, res: any, next: any) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (_req.method === "OPTIONS") return res.status(204).send();
    next();
  };

  app.options("/api/funnel/start", funnelCors);
  app.options("/api/funnel/update", funnelCors);
  app.options("/api/funnel/heartbeat", funnelCors);
  app.options("/api/funnel/submit", funnelCors);

  app.post("/api/funnel/start", funnelCors, express.json(), asyncHandler(async (req, res) => {
    const { sessionId, slug, niche, subAccountId } = req.body;
    if (!sessionId || !slug || !niche) return res.status(400).json({ error: "sessionId, slug, and niche are required" });

    const existing = await storage.getFunnelLeadBySession(sessionId);
    if (existing) {
      await storage.updateFunnelLead(existing.id, { lastSeenAt: new Date() } as any);
      return res.json(existing);
    }

    const lead = await storage.createFunnelLead({
      sessionId,
      slug,
      niche,
      step: 0,
      status: "in_progress",
      formData: {},
      subAccountId: subAccountId ? parseInt(subAccountId) : null,
    });
    res.status(201).json(lead);
  }));

  app.patch("/api/funnel/update", funnelCors, express.json(), asyncHandler(async (req, res) => {
    const { sessionId, step, formData } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    const lead = await storage.getFunnelLeadBySession(sessionId);
    if (!lead) return res.status(404).json({ error: "Funnel session not found" });

    const merged = { ...(lead.formData as object || {}), ...(formData || {}) };
    const updated = await storage.updateFunnelLead(lead.id, {
      step: step ?? lead.step,
      formData: merged,
      lastSeenAt: new Date(),
    } as any);
    res.json(updated);
  }));

  app.post("/api/funnel/heartbeat", funnelCors, express.json(), asyncHandler(async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    const lead = await storage.getFunnelLeadBySession(sessionId);
    if (!lead) return res.status(404).json({ error: "Session not found" });

    await storage.updateFunnelLead(lead.id, { lastSeenAt: new Date() } as any);
    res.json({ ok: true });
  }));

  app.post("/api/funnel/submit", funnelCors, express.json(), asyncHandler(async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    const lead = await storage.getFunnelLeadBySession(sessionId);
    if (!lead) return res.status(404).json({ error: "Session not found" });
    if (lead.status === "completed") return res.json({ success: true, message: "Already submitted" });

    const fd = lead.formData as any || {};
    const accountId = lead.subAccountId || 1;

    let contactId: number | null = null;
    try {
      const contact = await storage.createContact({
        subAccountId: accountId,
        firstName: fd.firstName || fd.name || "Funnel Lead",
        lastName: fd.lastName || null,
        phone: fd.phone || null,
        email: fd.email || null,
        source: "funnel",
        tags: [lead.slug, lead.niche],
      });
      contactId = contact.id;
      import("./v1").then(({ fireAutomationTriggerGlobal }) =>
        fireAutomationTriggerGlobal("new_lead", accountId, {
          leadName: fd.firstName || fd.name || "Funnel Lead",
          leadPhone: fd.phone,
          leadEmail: fd.email,
          source: "funnel",
        })
      ).catch(e => console.error("[FUNNEL] trigger failed:", e instanceof Error ? e.message : e));
    } catch (e) {
      console.log("[FUNNEL] Contact creation skipped:", (e as any).message);
    }

    let appointmentId: number | null = null;
    const hasSchedule = fd.preferredDay || fd.preferredTime || fd.preferredDate || fd.appointmentDate || fd.date;
    if (hasSchedule) {
      let dateTime: string;
      if (fd.preferredDay && fd.preferredTime) {
        const dayMap: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
        const today = new Date();
        const targetDay = dayMap[fd.preferredDay] ?? 1;
        const diff = (targetDay - today.getDay() + 7) % 7 || 7;
        const nextDate = new Date(today);
        nextDate.setDate(today.getDate() + diff);
        const timeMatch = (fd.preferredTime || "9:00 AM").match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (timeMatch) {
          let hours = parseInt(timeMatch[1]);
          const mins = parseInt(timeMatch[2]);
          if (timeMatch[3].toUpperCase() === "PM" && hours < 12) hours += 12;
          if (timeMatch[3].toUpperCase() === "AM" && hours === 12) hours = 0;
          nextDate.setHours(hours, mins, 0, 0);
        }
        dateTime = nextDate.toISOString();
      } else {
        dateTime = fd.preferredDate || fd.appointmentDate || fd.date || new Date().toISOString();
      }

      try {
        const startDate = new Date(dateTime);
        const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
        const apt = await storage.createAppointment({
          subAccountId: accountId,
          contactId: contactId || undefined,
          title: `${lead.niche} Consultation — ${fd.firstName || "Lead"}`,
          startTime: startDate,
          endTime: endDate,
          status: "scheduled",
          description: `From ${lead.slug} funnel. ${fd.notes || fd.message || ""}`.trim(),
        });
        appointmentId = apt.id;
      } catch (e) {
        console.log("[FUNNEL] Appointment creation skipped:", (e as any).message);
      }
    }

    await storage.createMessage({
      subAccountId: accountId,
      contactPhone: fd.phone || fd.email || "funnel-lead",
      body: `Funnel submission (${lead.slug}): ${JSON.stringify(fd, null, 2)}`,
      direction: "inbound",
      channel: "funnel",
      status: "received",
    });

    const updated = await storage.updateFunnelLead(lead.id, {
      status: "completed",
      contactId,
      appointmentId,
      subAccountId: accountId,
      completedAt: new Date(),
    } as any);

    const triggerWorkflows = async (triggerType: string) => {
      try {
        const allWorkflows = await storage.getWorkflows();
        const matching = allWorkflows.filter((w: any) => {
          const trigger = w.trigger || (w.config as any)?.trigger;
          return trigger === triggerType && (!w.subAccountId || w.subAccountId === accountId);
        });
        for (const wf of matching) {
          console.log(`[FUNNEL] Triggering workflow "${wf.name}" (${triggerType})`);
        }
      } catch (e) {
        console.log("[FUNNEL] Workflow trigger error:", (e as any).message);
      }
    };

    triggerWorkflows("funnel_submitted");

    res.json({ success: true, contactId, appointmentId, lead: updated });
  }));

  // ---- Funnel Abandonment Detection ----
  const ABANDONMENT_CHECK_INTERVAL = 5 * 60 * 1000;
  const ABANDONMENT_STALE_MINUTES = 15;

  setInterval(async () => {
    try {
      const stale = await storage.getAbandonedFunnelLeads(ABANDONMENT_STALE_MINUTES);
      for (const lead of stale) {
        await storage.updateFunnelLead(lead.id, { status: "abandoned" } as any);
        console.log(`[FUNNEL] Marked session ${lead.sessionId} as abandoned (slug: ${lead.slug})`);

        const accountId = lead.subAccountId || 1;
        try {
          const allWorkflows = await storage.getWorkflows();
          const matching = allWorkflows.filter((w: any) => {
            const trigger = w.trigger || (w.config as any)?.trigger;
            return trigger === "funnel_abandoned" && (!w.subAccountId || w.subAccountId === accountId);
          });
          for (const wf of matching) {
            console.log(`[FUNNEL] Triggering abandoned workflow "${wf.name}" for session ${lead.sessionId}`);
          }
        } catch (e) {
          console.log("[FUNNEL] Abandoned workflow trigger error:", (e as any).message);
        }
      }
    } catch (e) {
      console.error("[FUNNEL] Abandonment check error:", (e as any).message);
    }
  }, ABANDONMENT_CHECK_INTERVAL);
}
