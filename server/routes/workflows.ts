import type { Express, Request, Response } from "express";
import { insertWorkflowSchema } from "@shared/schema";
import { storage } from "../storage";
import { z } from "zod";
import { aiChat, isAIConfigured } from "../aiGateway";
import { asyncHandler, parseIntParam, getUserId, verifyAccountOwnership, logUsageInternal } from "./helpers";
import { requireActiveSubscription } from "../subscriptionGuard";
import { emitWithTimeline, EVENT_TYPES } from "../intelligence/eventEmitter";

const subscriptionGuard = requireActiveSubscription();

export function registerWorkflowsRoutes(app: Express) {
  // ---- Workflows ----
  app.get("/api/workflows", subscriptionGuard, asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const userId = getUserId(user);
    const adminUserId = process.env.ADMIN_USER_ID;
    const isAdmin = adminUserId && userId === adminUserId;
    const allAccounts = await storage.getSubAccounts();
    const userAccountIds = isAdmin
      ? allAccounts.map((a: any) => a.id)
      : allAccounts.filter((a: any) => a.ownerUserId === userId).map((a: any) => a.id);
    const wfs = await storage.getWorkflows();
    const filtered = isAdmin ? wfs : wfs.filter((w: any) => w.subAccountId && userAccountIds.includes(w.subAccountId));
    res.json(filtered);
  }));

  app.get("/api/workflows/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const wf = await storage.getWorkflow(id);
    if (!wf) return res.status(404).json({ error: "Not found" });
    if (wf.subAccountId && !(await verifyAccountOwnership(req, res, wf.subAccountId))) return;
    res.json(wf);
  }));

  app.post("/api/workflows", asyncHandler(async (req, res) => {
    const parsed = insertWorkflowSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if (parsed.data.subAccountId && !(await verifyAccountOwnership(req, res, parsed.data.subAccountId))) return;
    const wf = await storage.createWorkflow(parsed.data);
    if (wf.subAccountId) {
      emitWithTimeline({ eventType: EVENT_TYPES.WORKFLOW_TRIGGERED, sourceModule: "workflows", sourceTable: "workflows", sourceRecordId: String(wf.id), subAccountId: wf.subAccountId, metadata: { name: wf.name, trigger: wf.trigger } });
    }
    res.status(201).json(wf);
  }));

  const workflowPatchSchema = z.object({
    name: z.string().min(1).optional(),
    trigger: z.string().min(1).optional(),
    steps: z.any().optional(),
  });

  app.patch("/api/workflows/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const existing = await storage.getWorkflow(id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.subAccountId && !(await verifyAccountOwnership(req, res, existing.subAccountId))) return;
    const parsed = workflowPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const wf = await storage.updateWorkflow(id, parsed.data);
    if (!wf) return res.status(404).json({ error: "Not found" });
    res.json(wf);
  }));

  app.delete("/api/workflows/:id", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    const existing = await storage.getWorkflow(id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.subAccountId && !(await verifyAccountOwnership(req, res, existing.subAccountId))) return;
    await storage.deleteWorkflow(id);
    res.json({ deleted: true, id });
  }));

  // ---- Workflow Analytics & Self-Optimization ----

  app.get("/api/workflows/:id/analytics", asyncHandler(async (req: Request, res: Response) => {
    const id = parseIntParam(req.params.id, "id");
    const wf = await storage.getWorkflow(id);
    if (!wf) return res.status(404).json({ error: "Not found" });
    if (wf.subAccountId && !(await verifyAccountOwnership(req, res, wf.subAccountId))) return;

    const { getWorkflowFunnelAnalytics, generateAISuggestions } = await import("../operator/workflowAnalytics");
    const analytics = await getWorkflowFunnelAnalytics(id);
    if (!analytics) return res.status(404).json({ error: "Analytics not available" });

    let aiSuggestions: any[] = [];
    if (req.query.includeAi === "true") {
      aiSuggestions = await generateAISuggestions(id);
    }

    res.json({ ...analytics, aiSuggestions });
  }));

  app.post("/api/workflows/:id/step-metrics", asyncHandler(async (req: Request, res: Response) => {
    const id = parseIntParam(req.params.id, "id");
    const wf = await storage.getWorkflow(id);
    if (!wf) return res.status(404).json({ error: "Not found" });
    if (wf.subAccountId && !(await verifyAccountOwnership(req, res, wf.subAccountId))) return;

    const parsed = z.object({
      stepIndex: z.number().min(0),
      stepType: z.string().min(1),
      success: z.boolean(),
      durationMs: z.number().min(0).optional().default(0),
      responseReceived: z.boolean().optional().default(false),
    }).safeParse(req.body);

    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { recordStepExecution } = await import("../operator/workflowAnalytics");
    await recordStepExecution(id, parsed.data.stepIndex, parsed.data.stepType, parsed.data.success, parsed.data.durationMs, parsed.data.responseReceived);

    res.json({ recorded: true });
  }));

  app.get("/api/workflows/:id/optimization-log", asyncHandler(async (req: Request, res: Response) => {
    const id = parseIntParam(req.params.id, "id");
    const wf = await storage.getWorkflow(id);
    if (!wf) return res.status(404).json({ error: "Not found" });
    if (wf.subAccountId && !(await verifyAccountOwnership(req, res, wf.subAccountId))) return;

    const logs = await storage.getWorkflowOptimizationLogs(id);
    res.json(logs);
  }));

  app.post("/api/workflows/:id/auto-optimize", asyncHandler(async (req: Request, res: Response) => {
    const id = parseIntParam(req.params.id, "id");
    const wf = await storage.getWorkflow(id);
    if (!wf) return res.status(404).json({ error: "Not found" });
    if (wf.subAccountId && !(await verifyAccountOwnership(req, res, wf.subAccountId))) return;

    const { applyAutoOptimization } = await import("../operator/workflowAnalytics");
    const changes = await applyAutoOptimization(id);

    res.json({
      optimized: changes.length > 0,
      changesApplied: changes.length,
      changes,
    });
  }));

  app.post("/api/workflows/:id/optimization-log/:logId/revert", asyncHandler(async (req: Request, res: Response) => {
    const workflowId = parseIntParam(req.params.id, "id");
    const logId = parseIntParam(req.params.logId, "logId");
    const wf = await storage.getWorkflow(workflowId);
    if (!wf) return res.status(404).json({ error: "Not found" });
    if (wf.subAccountId && !(await verifyAccountOwnership(req, res, wf.subAccountId))) return;

    const logs = await storage.getWorkflowOptimizationLogs(workflowId);
    const targetLog = logs.find(l => l.id === logId);
    if (!targetLog) return res.status(404).json({ error: "Optimization log not found" });
    if (targetLog.reverted) return res.status(400).json({ error: "Already reverted" });

    if (targetLog.changeType === 'timing_adjustment' && targetLog.previousValue && targetLog.stepIndex !== null) {
      const steps = Array.isArray(wf.steps) ? [...(wf.steps as any[])] : [];
      if (steps[targetLog.stepIndex]) {
        steps[targetLog.stepIndex].params = { ...steps[targetLog.stepIndex].params, ...(targetLog.previousValue as any) };
        await storage.updateWorkflow(workflowId, { steps });
      }
    }

    const reverted = await storage.revertOptimization(logId);
    res.json({ reverted: true, log: reverted });
  }));

  // ---- Workflow AI Generation ----
  const WORKFLOW_AI_SYSTEM_PROMPT = `You are a workflow automation architect for Apex Marketing Automations. You are TEMPLATE-AWARE — you know proven workflow templates and should prefer adapting them over building from scratch.

## TEMPLATE CATALOG
You have access to these proven, high-converting workflow templates. When a user's request matches one, START from that template and adapt it:

### Facebook / DM Automations
1. "FB Lead Form → DM + SMS Nurture" — trigger: facebook_form_submit — DM greeting → Wait → AIQualify → Condition → SendBookingLink / SMS
2. "Instagram DM Keyword Auto-Reply" — trigger: new_lead — DM qualifying Q → Wait → AIQualify → Condition → SendBookingLink or ALERT
3. "Meta Ad Click → Multi-Channel Nurture" — trigger: facebook_form_submit — DM → SMS → Email → WhatsApp over 24hr
4. "Messenger Lead Qualification Flow" — trigger: facebook_form_submit — DM → AIQualify → Condition → VapiCall / SendBookingLink
5. "DM Ghosted Lead Recovery" — trigger: new_lead — Wait 24hr → Condition → DM re-engage → SMS → ALERT
6. "DM to Booking Pipeline Handoff" — trigger: facebook_form_submit — DM → AIQualify → Condition → SendBookingLink → SMS backup

### Speed-to-Lead
7. "Speed-to-Lead Instant Follow-Up" — trigger: new_lead — SMS instant → VapiCall 1min → Condition → SendBookingLink
8. "Missed Call Text-Back + AI Callback" — trigger: missed_call — SMS sorry → VapiCall 3min → Condition → SendBookingLink
9. "Hot Lead AI Qualification + Booking" — trigger: new_lead — AIQualify → Condition → VapiCall / SMS+SendBookingLink
10. "New Lead Multi-Touch Follow-Up" — trigger: new_lead — SMS → Email → SMS → WhatsApp → Condition → ALERT (72hr)
11. "No-Response Escalation Sequence" — trigger: new_lead — SMS → Email → VapiCall → WhatsApp → ALERT

### Sales / Pipeline
12. "Quote Follow-Up Sequence" — trigger: new_lead — SMS thanks → Email detail → SMS urgency → VapiCall
13. "Estimate Follow-Up Reminder Ladder" — trigger: new_lead — SMS → Email → SMS final → Condition → VapiCall/ALERT
14. "Pipeline Stage Nurture" — trigger: manual_trigger — AIQualify → Condition → stage-specific SMS → Email → SendBookingLink

### Appointments
15. "Appointment Confirmation + Reminder Sequence" — trigger: appointment_booked — SMS confirm → reminders at 24hr, 2hr, 15min
16. "No-Show Recovery" — trigger: appointment_booked — Wait 30min → SMS → VapiCall → Email rebooking
17. "Post-Appointment Follow-Up" — trigger: appointment_booked — SMS thanks → Email recap → SMS review ask
18. "Reschedule Recovery Flow" — trigger: appointment_booked — Condition cancelled → SMS rebook → Email → VapiCall

### Reviews & Reputation
19. "Post-Service Review Request" — trigger: appointment_booked — SMS review ask → Condition → WhatsApp → Email
20. "Negative Review Save-the-Customer" — trigger: review_received — Condition rating<3 → ALERT → SMS apology → VapiCall
21. "Happy Customer → Review + Referral" — trigger: review_received — Condition rating 4+ → SMS thanks+referral → Email referral details
22. "Review Reminder Multi-Touch" — trigger: appointment_booked — SMS review → Condition → Email → WhatsApp

### Reactivation
23. "30-Day Inactive Reactivation" — trigger: manual_trigger — SMS offer → Condition → Email → WhatsApp → ALERT
24. "90-Day Win-Back Campaign" — trigger: manual_trigger — Email miss you + discount → SMS → Condition → VapiCall
25. "Still Interested? Nurture" — trigger: manual_trigger — SMS check-in → Condition → Email → SendBookingLink → ALERT
26. "Dormant Pipeline Revival" — trigger: manual_trigger — AIQualify re-score → Condition → SMS → VapiCall → Email → ALERT

### Multi-Channel
27. "SMS + Email + WhatsApp Triple Nurture" — trigger: new_lead — SMS → Email → WhatsApp → Condition → VapiCall
28. "DM + SMS + Booking Hybrid Follow-Up" — trigger: facebook_form_submit — DM → SMS → SendBookingLink → Email
29. "AI Voice Escalation Flow" — trigger: new_lead — AIQualify → Condition(score) → High: VapiCall, Med: SMS→VapiCall, Low: Email
30. "Lead Qualification + Human Handoff" — trigger: new_lead — AIQualify → Condition → ALERT + SMS / Email drip

### Ecommerce (Shopify)
31. "Abandoned Cart Recovery" — trigger: shopify_abandoned_cart — SMS cart → Email contents → WhatsApp discount → SMS urgency
32. "Post-Purchase Upsell + Review" — trigger: shopify_order_fulfilled — SMS thanks → Email upsell → SMS review ask
33. "Repeat Customer Reactivation" — trigger: manual_trigger — SMS new drop → Email featured → WhatsApp exclusive

## MATCHING BEHAVIOR
When a user describes a workflow need:
1. FIRST determine: does this closely match an existing template? Match on: business objective keywords, trigger type, channel preference, lifecycle stage.
2. If YES → Name the template, explain why it fits, adapt it to their specific needs.
3. If PARTIALLY → Combine or modify an existing template.
4. If NO strong fit → Build from scratch honestly.

### Keyword → Template Matching
- "follow up with Facebook leads" / "Facebook" / "DM" → FB Lead Form → DM + SMS Nurture
- "missed calls" / "text back" → Missed Call Text-Back + AI Callback
- "get more reviews" / "review request" → Post-Service Review Request
- "wake up old leads" / "reactivate" / "inactive" → 30-Day Inactive Reactivation
- "recover abandoned carts" / "cart" / "shopify" → Abandoned Cart Recovery
- "remind about appointments" / "no shows" / "confirm" → Appointment Confirmation + Reminder
- "speed to lead" / "fast follow up" / "instant" → Speed-to-Lead Instant Follow-Up
- "quote follow up" / "estimate" → Quote Follow-Up Sequence
- "negative review" / "bad review" → Negative Review Save-the-Customer
- "upsell" / "post purchase" → Post-Purchase Upsell + Review

## OUTPUT FORMAT
Return a JSON object:
{
  "name": "<short workflow name>",
  "trigger": "<one of: manual_trigger, facebook_form_submit, new_lead, missed_call, appointment_booked, review_received, sms_reply, shopify_abandoned_cart, shopify_order_fulfilled>",
  "templateUsed": "<template name if based on a template, or null>",
  "steps": [
    { "action_type": "<type>", "params": { ... } }
  ]
}

## SUPPORTED STEP TYPES
- WAIT: { "duration_minutes": <number> }
- SMS: { "body": "<message>" }
- CONDITION: { "check": "<condition>" }
- ALERT: { "user_id": "admin" }
- CODE: { "language": "javascript", "code": "<code>", "description": "<desc>" }
- DeployMetaAd: { "campaign_name": "", "radius_miles": 1, "budget_daily": 25, "use_incident_coords": true }
- SendEmail: { "subject": "<subject>", "body": "<body>" }
- WebhookCall: { "url": "", "method": "POST" }
- AIGenerate: { "prompt": "", "output_field": "" }
- ElevenLabsTTS: { "text": "", "voice_id": "" }
- VapiCall: { "first_message": "<opener>", "assistantId": "" }
- SendBookingLink: { "body": "<message with {{bookingLink}}>" }
- AIQualify: { "check": "interest_level", "pass_action": "continue", "fail_action": "skip" }
- SendWhatsApp: { "body": "<message>", "message_type": "text" }
- SendFacebookDM: { "body": "<message>" }
- SendFormLink: { "body": "<message>", "form_url": "" }
- UpdateDeal: { "stage": "qualified", "value": 0, "notes": "" }
- AlertTeam: { "message": "", "channel": "sms" }
- CreateContact: { "first_name": "", "source": "automation" }

## COPY RULES
- All SMS copy is short, punchy, and conversational
- DM copy feels personal and casual
- Email can be detailed but should still feel human
- WhatsApp feels personal, not corporate
- Always use {{leadName}}, {{businessName}}, {{bookingLink}}, {{reviewLink}} variables
- Never write generic filler like "Hi, thanks for your interest" or "We wanted to follow up"
- Every CTA must be clear and specific

## GENERAL RULES
- Speed is EVERYTHING for Facebook/new leads — 0-1 minute WAIT for initial response
- Include AI qualification (AIQualify or VapiCall) for sales workflows
- Include SendBookingLink for any lead capture workflow
- Generate 3-8 steps based on complexity
- WAIT durations: 0-1 min hot leads, 5-30 min follow-ups, hours/days nurture
- Return ONLY valid JSON, no markdown, no code fences`;

  interface TemplateMatch {
    id: string;
    name: string;
    score: number;
    trigger: string;
    category: string;
  }

  const TEMPLATE_KEYWORD_MAP: Record<string, { keywords: string[]; trigger?: string }> = {
    "FB Lead Form → DM + SMS Nurture": { keywords: ["facebook", "fb", "meta", "lead form", "dm nurture", "facebook lead"], trigger: "facebook_form_submit" },
    "Instagram DM Keyword Auto-Reply": { keywords: ["instagram", "ig", "dm keyword", "auto reply", "dm automation"] },
    "Meta Ad Click → Multi-Channel Nurture": { keywords: ["meta ad", "ad click", "ad lead", "facebook ad"], trigger: "facebook_form_submit" },
    "Messenger Lead Qualification Flow": { keywords: ["messenger", "qualify", "qualification", "dm qualify"], trigger: "facebook_form_submit" },
    "DM Ghosted Lead Recovery": { keywords: ["ghosted", "dm ghost", "no reply dm", "dm follow up"] },
    "DM to Booking Pipeline Handoff": { keywords: ["dm to booking", "dm pipeline", "dm handoff"], trigger: "facebook_form_submit" },
    "Speed-to-Lead Instant Follow-Up": { keywords: ["speed to lead", "instant", "fast follow", "quick response", "immediate"], trigger: "new_lead" },
    "Missed Call Text-Back + AI Callback": { keywords: ["missed call", "text back", "call back", "missed phone"], trigger: "missed_call" },
    "Hot Lead AI Qualification + Booking": { keywords: ["hot lead", "ai qualify", "qualification", "score lead"], trigger: "new_lead" },
    "New Lead Multi-Touch Follow-Up": { keywords: ["multi touch", "follow up sequence", "nurture sequence", "drip"], trigger: "new_lead" },
    "No-Response Escalation Sequence": { keywords: ["no response", "escalation", "not responding", "escalate"], trigger: "new_lead" },
    "Quote Follow-Up Sequence": { keywords: ["quote", "proposal", "bid", "estimate follow"], trigger: "new_lead" },
    "Estimate Follow-Up Reminder Ladder": { keywords: ["estimate", "follow up ladder", "reminder ladder"], trigger: "new_lead" },
    "Pipeline Stage Nurture": { keywords: ["pipeline", "stage", "deal stage", "crm", "sales pipeline"], trigger: "manual_trigger" },
    "Appointment Confirmation + Reminder Sequence": { keywords: ["appointment", "confirm", "reminder", "remind"], trigger: "appointment_booked" },
    "No-Show Recovery": { keywords: ["no show", "no-show", "didn't show", "missed appointment"], trigger: "appointment_booked" },
    "Post-Appointment Follow-Up": { keywords: ["post appointment", "after appointment", "visit follow"], trigger: "appointment_booked" },
    "Reschedule Recovery Flow": { keywords: ["reschedule", "cancel", "cancelled appointment"], trigger: "appointment_booked" },
    "Post-Service Review Request": { keywords: ["review request", "get review", "ask review", "review ask"], trigger: "appointment_booked" },
    "Negative Review Save-the-Customer": { keywords: ["negative review", "bad review", "low rating", "1 star", "2 star"], trigger: "review_received" },
    "Happy Customer → Review + Referral": { keywords: ["happy customer", "referral", "good review", "5 star", "positive review"], trigger: "review_received" },
    "Review Reminder Multi-Touch": { keywords: ["review reminder", "review follow", "review nudge"], trigger: "appointment_booked" },
    "30-Day Inactive Reactivation": { keywords: ["inactive", "reactivate", "30 day", "dormant", "cold lead"], trigger: "manual_trigger" },
    "90-Day Win-Back Campaign": { keywords: ["win back", "winback", "90 day", "lost customer", "come back"], trigger: "manual_trigger" },
    "Still Interested? Nurture": { keywords: ["still interested", "check in", "re-engage", "old lead"], trigger: "manual_trigger" },
    "Dormant Pipeline Revival": { keywords: ["dormant pipeline", "revival", "stale deal", "dead deal"], trigger: "manual_trigger" },
    "SMS + Email + WhatsApp Triple Nurture": { keywords: ["triple", "three channel", "multi channel", "sms email whatsapp"], trigger: "new_lead" },
    "DM + SMS + Booking Hybrid Follow-Up": { keywords: ["hybrid", "dm sms booking", "cross channel"], trigger: "facebook_form_submit" },
    "AI Voice Escalation Flow": { keywords: ["voice escalation", "ai call", "vapi", "phone call", "call escalation"], trigger: "new_lead" },
    "Lead Qualification + Human Handoff": { keywords: ["human handoff", "handoff", "hand off", "qualify handoff"], trigger: "new_lead" },
    "Abandoned Cart Recovery": { keywords: ["abandoned cart", "cart recovery", "shopify cart", "checkout"], trigger: "shopify_abandoned_cart" },
    "Post-Purchase Upsell + Review": { keywords: ["post purchase", "upsell", "cross sell", "after purchase"], trigger: "shopify_order_fulfilled" },
    "Repeat Customer Reactivation": { keywords: ["repeat customer", "repeat purchase", "customer retention", "loyalty"], trigger: "manual_trigger" },
  };

  function scoreTemplateMatch(prompt: string): TemplateMatch[] {
    const q = prompt.toLowerCase();
    const scores: TemplateMatch[] = [];

    for (const [name, config] of Object.entries(TEMPLATE_KEYWORD_MAP)) {
      let score = 0;
      for (const kw of config.keywords) {
        if (q.includes(kw)) score += kw.split(" ").length * 2;
      }
      if (config.trigger) {
        const triggerWords = config.trigger.replace(/_/g, " ");
        if (q.includes(triggerWords)) score += 3;
      }
      if (score > 0) {
        scores.push({ id: name, name, score, trigger: config.trigger || "", category: "" });
      }
    }

    return scores.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  app.post("/api/workflows/generate", asyncHandler(async (req, res) => {
    if (!isAIConfigured()) {
      return res.status(503).json({ error: "AI service is not configured" });
    }

    const parsed = z.object({ prompt: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const templateMatches = scoreTemplateMatch(parsed.data.prompt);
    let matchContext = "";
    if (templateMatches.length > 0) {
      matchContext = `\n\n## PRE-MATCHED TEMPLATES (deterministic scoring)\nBased on keyword analysis of the user's prompt, these templates are the best fits (in order of relevance):\n`;
      templateMatches.forEach((m, i) => {
        matchContext += `${i + 1}. "${m.name}" (score: ${m.score}${m.trigger ? `, trigger: ${m.trigger}` : ""})\n`;
      });
      matchContext += `\nConsider starting from the top match if it fits the request well. Adapt the template copy and steps to their specific needs. Set "templateUsed" in your response to the template name you based it on. If none fit well, build from scratch and set "templateUsed" to null.`;
    } else {
      matchContext += `\n\n## NO TEMPLATE MATCH\nNo existing template closely matches this request. Build from scratch using the supported step types and copy rules.`;
    }

    function extractJson(text: string): any {
      const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      try { return JSON.parse(cleaned); } catch {}
      const braceMatch = text.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        try { return JSON.parse(braceMatch[0]); } catch {}
      }
      return null;
    }

    let workflowData: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const wfAiResult = await aiChat([
        { role: "system", content: WORKFLOW_AI_SYSTEM_PROMPT + matchContext },
        { role: "user", content: attempt === 0
          ? parsed.data.prompt
          : `${parsed.data.prompt}\n\nIMPORTANT: Return ONLY a raw JSON object. No markdown, no explanation, no code fences. Start with { and end with }.`
        },
      ], { temperature: 0.7, maxTokens: 4096, jsonMode: true, route: "workflow-generate" });

      workflowData = extractJson(wfAiResult.text);
      if (workflowData && workflowData.steps && Array.isArray(workflowData.steps)) break;
      workflowData = null;
    }

    if (!workflowData) {
      return res.status(500).json({ error: "AI could not generate a valid workflow. Please try rephrasing your prompt." });
    }

    if (!workflowData.steps || !Array.isArray(workflowData.steps)) {
      return res.status(500).json({ error: "AI returned invalid workflow structure" });
    }

    const reqSubAccountId = req.body.subAccountId ? parseInt(req.body.subAccountId) : null;
    if (reqSubAccountId && !(await verifyAccountOwnership(req, res, reqSubAccountId))) return;
    const wf = await storage.createWorkflow({
      name: workflowData.name || "AI Generated Workflow",
      trigger: workflowData.trigger || "manual_trigger",
      steps: workflowData.steps,
      subAccountId: reqSubAccountId,
    });

    await logUsageInternal(null, "AI_CHAT", 1, "Workflow AI generation");

    res.status(201).json(wf);
  }));
}
