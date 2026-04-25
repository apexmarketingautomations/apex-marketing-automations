import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { whatsappTemplates, contentPosts, workflows, pipelineStages } from "@shared/schema";
import { eq } from "drizzle-orm";
import { asyncHandler, verifyAccountOwnership } from "./helpers";
import { aiChat } from "../aiGateway";
import { computeAccountReadiness } from "./readiness";

interface CommandResult {
  success: boolean;
  command: string;
  actions: { step: string; status: "done" | "failed" | "skipped"; detail?: string }[];
  summary: string;
}

export function registerCommandEngineRoutes(app: Express) {
  app.post("/api/command/execute", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = Number(req.headers["x-sub-account-id"] || req.body.subAccountId);
    if (!subAccountId || !(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { command, params } = req.body;
    if (!command) return res.status(400).json({ error: "Missing command" });

    let result: CommandResult;

    switch (command) {
      case "fix-response-rate":
        result = await fixResponseRate(subAccountId);
        break;
      case "boost-content":
        result = await boostContent(subAccountId, params);
        break;
      case "handle-objections":
        result = await handleObjections(subAccountId, params);
        break;
      case "optimize-pipeline":
        result = await optimizePipeline(subAccountId);
        break;
      case "launch-lead-gen":
        result = await launchLeadGen(subAccountId);
        break;
      case "activate-nurture":
        result = await activateNurture(subAccountId);
        break;
      case "system-optimize":
        result = await systemOptimize(subAccountId);
        break;
      default:
        return res.status(400).json({ error: `Unknown command: ${command}` });
    }

    res.json(result);
  }));

  app.get("/api/command/predictions/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const readiness = await computeAccountReadiness(subAccountId);
    if (!readiness.benchmarkReady) {
      return res.json({
        predictions: [],
        readiness,
        generatedAt: new Date().toISOString(),
      });
    }

    const predictions = await generatePredictions(subAccountId);
    res.json({ predictions, readiness, generatedAt: new Date().toISOString() });
  }));

  app.get("/api/command/directives/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const readiness = await computeAccountReadiness(subAccountId);
    if (!readiness.intelligenceReady) {
      return res.json({
        directives: [],
        readiness,
        generatedAt: new Date().toISOString(),
      });
    }

    const directives = await generateDirectives(subAccountId);
    res.json({ directives, readiness, generatedAt: new Date().toISOString() });
  }));
}

async function fixResponseRate(subAccountId: number): Promise<CommandResult> {
  const actions: CommandResult["actions"] = [];

  try {
    const account = await storage.getSubAccount(subAccountId);
    const existingConfig = (account?.aiPromptConfig as any) || {};
    const updatedConfig = {
      ...existingConfig,
      autoReplyEnabled: true,
      autoReplyDelay: 0,
      brandVoice: existingConfig.brandVoice || "Professional, friendly, and responsive. Always acknowledge the customer quickly and provide helpful information.",
    };
    await storage.updateSubAccount(subAccountId, { aiPromptConfig: updatedConfig });
    actions.push({ step: "Enable auto-reply", status: "done", detail: "Auto-reply activated with instant response" });
  } catch (err) {
    console.error("[CMD-ENGINE] Enable auto-reply failed:", err);
    actions.push({ step: "Enable auto-reply", status: "failed", detail: err instanceof Error ? err.message : String(err) });
  }

  try {
    const accountWorkflows = await db.select().from(workflows).where(eq(workflows.subAccountId, subAccountId));
    const hasFollowUp = accountWorkflows.some(w => w.name?.toLowerCase().includes("follow"));
    if (!hasFollowUp) {
      await db.insert(workflows).values({
        subAccountId,
        name: "Speed-to-Lead Auto Follow-up",
        trigger: "message_received",
        steps: [
          { type: "WAIT", config: { minutes: 5 }, order: 1 },
          { type: "AI_REPLY", config: { prompt: "Follow up warmly, ask how you can help further" }, order: 2 },
          { type: "WAIT", config: { minutes: 1440 }, order: 3 },
          { type: "AI_REPLY", config: { prompt: "Check in if no response, offer value" }, order: 4 },
        ],
      });
      actions.push({ step: "Create follow-up workflow", status: "done", detail: "Speed-to-Lead sequence activated" });
    } else {
      actions.push({ step: "Create follow-up workflow", status: "skipped", detail: "Follow-up workflow already active" });
    }
  } catch (err) {
    console.error("[CMD-ENGINE] Create follow-up workflow failed:", err);
    actions.push({ step: "Create follow-up workflow", status: "failed", detail: err instanceof Error ? err.message : String(err) });
  }

  return {
    success: actions.some(a => a.status === "done"),
    command: "fix-response-rate",
    actions,
    summary: `Response rate optimization: ${actions.filter(a => a.status === "done").length} actions completed`,
  };
}

async function boostContent(subAccountId: number, params?: any): Promise<CommandResult> {
  const actions: CommandResult["actions"] = [];
  const count = params?.count || 7;
  const platforms = ["instagram", "facebook"];

  try {
    const account = await storage.getSubAccount(subAccountId);
    const industry = (account as any)?.industry || "general business";

    const aiResponse = await aiChat([
      { role: "system", content: "You are a social media content strategist. Output ONLY valid JSON, no markdown." },
      { role: "user", content: `Generate ${count} social media post ideas for a ${industry} business. Return a JSON array where each item has: {"caption": "...", "platform": "instagram|facebook", "hashtags": "...", "scheduleDayOffset": N}. Schedule posts across the next 7 days. Keep captions under 200 chars, engaging and actionable.` }
    ], { temperature: 0.8, maxTokens: 2048, jsonMode: true, route: "command-boost-content" });
    const aiResult = aiResponse.text;

    let posts: any[] = [];
    try {
      const parsed = JSON.parse(aiResult);
      posts = Array.isArray(parsed) ? parsed : parsed.posts || [];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[CMD-ENGINE] boost-content: AI response parse error:", message, "| raw preview:", String(aiResult || "").slice(0, 300));
      actions.push({ step: "Generate content ideas", status: "failed", detail: `AI response parse error: ${message}` });
      return { success: false, command: "boost-content", actions, summary: "Content generation failed" };
    }

    actions.push({ step: "Generate content ideas", status: "done", detail: `${posts.length} posts generated by AI` });

    let scheduled = 0;
    for (const post of posts.slice(0, count)) {
      try {
        const scheduleDate = new Date();
        scheduleDate.setDate(scheduleDate.getDate() + (post.scheduleDayOffset || scheduled));
        scheduleDate.setHours(10 + (scheduled % 3) * 4, 0, 0, 0);

        await db.insert(contentPosts).values({
          subAccountId,
          title: post.caption?.substring(0, 60) || `Post ${scheduled + 1}`,
          caption: post.caption || "",
          hashtags: post.hashtags || "",
          status: "scheduled",
          scheduledAt: scheduleDate,
        });
        scheduled++;
      } catch (err) {
        // Best-effort per-post insertion; one failure should not abort the batch, but log it for visibility
        console.warn("[CMD-ENGINE] boost-content: failed to schedule one post:", err);
      }
    }

    actions.push({
      step: "Schedule posts",
      status: scheduled > 0 ? "done" : "failed",
      detail: `${scheduled} posts scheduled across next 7 days`
    });

  } catch (err: any) {
    actions.push({ step: "Generate content ideas", status: "failed", detail: err.message });
  }

  return {
    success: actions.some(a => a.status === "done"),
    command: "boost-content",
    actions,
    summary: `Content boost: ${actions.filter(a => a.status === "done").length} steps completed`,
  };
}

async function handleObjections(subAccountId: number, params?: any): Promise<CommandResult> {
  const actions: CommandResult["actions"] = [];
  const objection = params?.insightContent || "price too high";

  try {
    const aiResponse = await aiChat([
      { role: "system", content: "You are a sales communication expert. Output ONLY the message template text, no markdown." },
      { role: "user", content: `Write a WhatsApp response template for handling this customer objection: "${objection}". Use {{1}} for customer name. Keep under 300 chars. Be empathetic, provide value, redirect to benefits.` }
    ], { temperature: 0.7, maxTokens: 512, route: "command-objection-template" });

    if (aiResponse.text) {
      await db.insert(whatsappTemplates).values({
        subAccountId,
        name: `objection-handler-${Date.now()}`,
        category: "utility",
        language: "en",
        headerType: "",
        headerContent: "",
        body: aiResponse.text.trim(),
        footerText: "",
        buttons: [],
        variables: ["customer_name"],
        status: "draft",
      });
      actions.push({ step: "Create response template", status: "done", detail: `Template created for: "${objection.substring(0, 40)}..."` });
    }
  } catch (err) {
    console.error("[CMD-ENGINE] Create response template failed:", err);
    actions.push({ step: "Create response template", status: "failed", detail: err instanceof Error ? err.message : String(err) });
  }

  try {
    const accountWorkflows = await db.select().from(workflows).where(eq(workflows.subAccountId, subAccountId));
    const hasObjHandler = accountWorkflows.some(w => w.name?.toLowerCase().includes("objection"));
    if (!hasObjHandler) {
      await db.insert(workflows).values({
        subAccountId,
        name: `Objection Handler: ${objection.substring(0, 30)}`,
        trigger: "keyword_detected",
        steps: [
          { type: "AI_REPLY", config: { prompt: `Customer has a pricing objection. Respond empathetically, acknowledge their concern, then highlight unique value and ROI. Offer to discuss options.` }, order: 1 },
          { type: "WAIT", config: { hours: 24 }, order: 2 },
          { type: "AI_REPLY", config: { prompt: "Follow up with a special offer or case study showing ROI" }, order: 3 },
        ],
      });
      actions.push({ step: "Deploy objection workflow", status: "done", detail: "Auto-response workflow activated" });
    } else {
      actions.push({ step: "Deploy objection workflow", status: "skipped", detail: "Objection handler already exists" });
    }
  } catch (err) {
    console.error("[CMD-ENGINE] Deploy objection workflow failed:", err);
    actions.push({ step: "Deploy objection workflow", status: "failed", detail: err instanceof Error ? err.message : String(err) });
  }

  return {
    success: actions.some(a => a.status === "done"),
    command: "handle-objections",
    actions,
    summary: `Objection handling deployed: template + workflow`,
  };
}

async function optimizePipeline(subAccountId: number): Promise<CommandResult> {
  const actions: CommandResult["actions"] = [];

  try {
    const deals = await storage.getDeals(subAccountId);
    const zeroValueDeals = deals.filter(d => !d.value || d.value === 0);

    if (zeroValueDeals.length > 0) {
      const avgValue = deals.filter(d => d.value && d.value > 0).reduce((s, d) => s + (d.value || 0), 0) / Math.max(deals.filter(d => d.value && d.value > 0).length, 1);
      const estimatedValue = Math.max(avgValue, 500);

      let updated = 0;
      for (const deal of zeroValueDeals.slice(0, 20)) {
        try {
          await storage.updateDeal(deal.id, { value: Math.round(estimatedValue) });
          updated++;
        } catch (err) {
          // Best-effort per-deal update; one failure should not abort the batch, but log it for visibility
          console.warn(`[CMD-ENGINE] fix-pipeline: failed to update deal ${deal.id}:`, err);
        }
      }
      actions.push({
        step: "Fix zero-value deals",
        status: updated > 0 ? "done" : "failed",
        detail: `${updated} deals updated with estimated value $${Math.round(estimatedValue)}`
      });
    } else {
      actions.push({ step: "Fix zero-value deals", status: "skipped", detail: "All deals have values" });
    }
  } catch (err) {
    console.error("[CMD-ENGINE] Fix zero-value deals failed:", err);
    actions.push({ step: "Fix zero-value deals", status: "failed", detail: err instanceof Error ? err.message : String(err) });
  }

  try {
    const stages = await db.select().from(pipelineStages).where(eq(pipelineStages.subAccountId, subAccountId));
    if (stages.length === 0) {
      const defaultStages = ["Lead", "Qualified", "Proposal", "Negotiation", "Closed Won"];
      const colors = ["#60a5fa", "#34d399", "#fbbf24", "#f97316", "#22c55e"];
      for (let i = 0; i < defaultStages.length; i++) {
        await db.insert(pipelineStages).values({ subAccountId, name: defaultStages[i], position: i + 1, color: colors[i] });
      }
      actions.push({ step: "Create pipeline stages", status: "done", detail: `5-stage pipeline created` });
    } else {
      actions.push({ step: "Create pipeline stages", status: "skipped", detail: "Pipeline stages already exist" });
    }
  } catch (err) {
    console.error("[CMD-ENGINE] Create pipeline stages failed:", err);
    actions.push({ step: "Create pipeline stages", status: "failed", detail: err instanceof Error ? err.message : String(err) });
  }

  return {
    success: actions.some(a => a.status === "done"),
    command: "optimize-pipeline",
    actions,
    summary: `Pipeline optimized: ${actions.filter(a => a.status === "done").length} improvements applied`,
  };
}

async function launchLeadGen(subAccountId: number): Promise<CommandResult> {
  const actions: CommandResult["actions"] = [];

  try {
    const accountWorkflows = await db.select().from(workflows).where(eq(workflows.subAccountId, subAccountId));
    const hasLeadCapture = accountWorkflows.some(w => w.name?.toLowerCase().includes("lead"));

    if (!hasLeadCapture) {
      await db.insert(workflows).values({
        subAccountId,
        name: "Lead Capture & Nurture Sequence",
        trigger: "form_submitted",
        steps: [
          { type: "AI_REPLY", config: { prompt: "Welcome new lead warmly. Thank them for their interest. Ask about their specific needs." }, order: 1 },
          { type: "WAIT", config: { hours: 4 }, order: 2 },
          { type: "AI_REPLY", config: { prompt: "Follow up with helpful content related to their inquiry. Share a case study or testimonial." }, order: 3 },
          { type: "WAIT", config: { days: 2 }, order: 4 },
          { type: "AI_REPLY", config: { prompt: "Offer a free consultation or demo. Create urgency with limited-time value add." }, order: 5 },
        ],
      });
      actions.push({ step: "Create lead capture workflow", status: "done", detail: "5-step nurture sequence deployed" });
    } else {
      actions.push({ step: "Create lead capture workflow", status: "skipped", detail: "Lead capture already active" });
    }
  } catch (err) {
    console.error("[CMD-ENGINE] Create lead capture workflow failed:", err);
    actions.push({ step: "Create lead capture workflow", status: "failed", detail: err instanceof Error ? err.message : String(err) });
  }

  try {
    const account = await storage.getSubAccount(subAccountId);
    const existingConfig = (account?.aiPromptConfig as any) || {};
    if (!existingConfig.autoReplyEnabled) {
      await storage.updateSubAccount(subAccountId, {
        aiPromptConfig: { ...existingConfig, autoReplyEnabled: true },
      });
      actions.push({ step: "Enable auto-reply for leads", status: "done", detail: "Instant response activated" });
    } else {
      actions.push({ step: "Enable auto-reply for leads", status: "skipped", detail: "Already active" });
    }
  } catch (err) {
    console.error("[CMD-ENGINE] Enable auto-reply for leads failed:", err);
    actions.push({ step: "Enable auto-reply for leads", status: "failed", detail: err instanceof Error ? err.message : String(err) });
  }

  return {
    success: actions.some(a => a.status === "done"),
    command: "launch-lead-gen",
    actions,
    summary: `Lead generation system activated`,
  };
}

async function activateNurture(subAccountId: number): Promise<CommandResult> {
  const actions: CommandResult["actions"] = [];

  try {
    await db.insert(workflows).values({
      subAccountId,
      name: "Smart Nurture Sequence",
      trigger: "contact_idle",
      steps: [
        { type: "AI_REPLY", config: { prompt: "Re-engage this contact. Reference their last conversation. Provide new value or offer." }, order: 1 },
        { type: "WAIT", config: { days: 5 }, order: 2 },
        { type: "AI_REPLY", config: { prompt: "Share an industry tip, success story, or exclusive offer to rekindle interest." }, order: 3 },
        { type: "WAIT", config: { days: 7 }, order: 4 },
        { type: "AI_REPLY", config: { prompt: "Final touchpoint. Ask if they'd like to stay in touch or have questions." }, order: 5 },
      ],
    });
    actions.push({ step: "Deploy nurture sequence", status: "done", detail: "3-touch re-engagement sequence created" });
  } catch (err) {
    console.error("[CMD-ENGINE] Deploy nurture sequence failed:", err);
    actions.push({ step: "Deploy nurture sequence", status: "failed", detail: err instanceof Error ? err.message : String(err) });
  }

  return {
    success: actions.some(a => a.status === "done"),
    command: "activate-nurture",
    actions,
    summary: `Nurture sequence deployed`,
  };
}

async function systemOptimize(subAccountId: number): Promise<CommandResult> {
  const allActions: CommandResult["actions"] = [];

  const rr = await fixResponseRate(subAccountId);
  allActions.push(...rr.actions.map(a => ({ ...a, step: `[Response] ${a.step}` })));

  const pipeline = await optimizePipeline(subAccountId);
  allActions.push(...pipeline.actions.map(a => ({ ...a, step: `[Pipeline] ${a.step}` })));

  const nurture = await activateNurture(subAccountId);
  allActions.push(...nurture.actions.map(a => ({ ...a, step: `[Nurture] ${a.step}` })));

  const done = allActions.filter(a => a.status === "done").length;
  const total = allActions.length;

  return {
    success: done > 0,
    command: "system-optimize",
    actions: allActions,
    summary: `Full system optimization: ${done}/${total} actions completed across response, pipeline, and nurture systems`,
  };
}

async function generatePredictions(subAccountId: number) {
  const [msgs, contacts, deals] = await Promise.all([
    storage.getMessages(subAccountId),
    storage.getContacts(subAccountId),
    storage.getDeals(subAccountId),
  ]);

  const predictions: any[] = [];
  const now = Date.now();
  const dayMs = 86400000;

  const last7 = msgs.filter(m => now - new Date(m.createdAt).getTime() < 7 * dayMs);
  const prev7 = msgs.filter(m => {
    const age = now - new Date(m.createdAt).getTime();
    return age >= 7 * dayMs && age < 14 * dayMs;
  });

  if (last7.length < prev7.length * 0.7 && prev7.length > 5) {
    const dropPct = Math.round((1 - last7.length / prev7.length) * 100);
    predictions.push({
      type: "warning",
      metric: "message_volume",
      title: "Message volume declining",
      detail: `${dropPct}% fewer messages this week vs last week (${last7.length} vs ${prev7.length})`,
      impact: "Response rate and engagement will drop if this trend continues",
      command: "fix-response-rate",
      commandLabel: "Fix Now",
      urgency: dropPct > 50 ? "critical" : "warning",
      timeframe: "Next 48 hours",
    });
  }

  const recentContacts7 = contacts.filter(c => c.createdAt && now - new Date(c.createdAt).getTime() < 7 * dayMs);
  const prevContacts7 = contacts.filter(c => {
    if (!c.createdAt) return false;
    const age = now - new Date(c.createdAt).getTime();
    return age >= 7 * dayMs && age < 14 * dayMs;
  });

  if (recentContacts7.length < prevContacts7.length * 0.6 && prevContacts7.length > 3) {
    predictions.push({
      type: "warning",
      metric: "lead_velocity",
      title: "Lead flow slowing down",
      detail: `Only ${recentContacts7.length} new contacts this week vs ${prevContacts7.length} last week`,
      impact: "Pipeline will dry up within 2 weeks at this rate",
      command: "launch-lead-gen",
      commandLabel: "Activate Lead Gen",
      urgency: "warning",
      timeframe: "Next 2 weeks",
    });
  }

  const activeDealCount = deals.filter(d => d.status === "active" || !d.status).length;
  const zeroValueDeals = deals.filter(d => (!d.value || d.value === 0) && (d.status === "active" || !d.status));
  if (zeroValueDeals.length > activeDealCount * 0.5 && activeDealCount > 2) {
    predictions.push({
      type: "opportunity",
      metric: "pipeline_health",
      title: "Pipeline forecast unreliable",
      detail: `${zeroValueDeals.length} of ${activeDealCount} active deals have no value assigned`,
      impact: "Revenue forecasting is blind — impossible to predict cash flow",
      command: "optimize-pipeline",
      commandLabel: "Fix Pipeline",
      urgency: "warning",
      timeframe: "Immediate",
    });
  }

  const todayMsgs = msgs.filter(m => now - new Date(m.createdAt).getTime() < dayMs);
  const inbound = todayMsgs.filter(m => m.direction === "inbound");
  const outbound = todayMsgs.filter(m => m.direction === "outbound");
  if (inbound.length > 5 && outbound.length < inbound.length * 0.3) {
    predictions.push({
      type: "critical",
      metric: "response_gap",
      title: "Response gap detected",
      detail: `${inbound.length} inbound messages today but only ${outbound.length} responses`,
      impact: "Leads are going cold — potential revenue loss of ~${inbound.length * 50}$",
      command: "fix-response-rate",
      commandLabel: "Enable Auto-Reply",
      urgency: "critical",
      timeframe: "Today",
    });
  }

  const noRecentContact = contacts.filter(c => {
    if (!c.lastContactedAt) return true;
    return now - new Date(c.lastContactedAt).getTime() > 14 * dayMs;
  });
  if (noRecentContact.length > contacts.length * 0.6 && contacts.length > 10) {
    predictions.push({
      type: "opportunity",
      metric: "engagement_decay",
      title: "Contact engagement declining",
      detail: `${noRecentContact.length} of ${contacts.length} contacts haven't been contacted in 14+ days`,
      impact: "These contacts are at risk of churning",
      command: "activate-nurture",
      commandLabel: "Activate Nurture",
      urgency: "warning",
      timeframe: "This week",
    });
  }

  if (predictions.length === 0) {
    predictions.push({
      type: "positive",
      metric: "system_health",
      title: "Systems operating normally",
      detail: "No declining trends or critical gaps detected",
      impact: "Keep current momentum going",
      command: null,
      commandLabel: null,
      urgency: "info",
      timeframe: "Ongoing",
    });
  }

  return predictions;
}

async function generateDirectives(subAccountId: number) {
  const [msgs, contacts, deals, accountWorkflows] = await Promise.all([
    storage.getMessages(subAccountId),
    storage.getContacts(subAccountId),
    storage.getDeals(subAccountId),
    db.select().from(workflows).where(eq(workflows.subAccountId, subAccountId)),
  ]);

  const directives: any[] = [];
  const now = Date.now();
  const dayMs = 86400000;

  const todayMsgs = msgs.filter(m => now - new Date(m.createdAt).getTime() < dayMs);
  const inbound = todayMsgs.filter(m => m.direction === "inbound").length;
  const outbound = todayMsgs.filter(m => m.direction === "outbound").length;
  const responseRate = inbound > 0 ? Math.round((outbound / inbound) * 100) : 100;

  if (responseRate < 50 && inbound > 3) {
    directives.push({
      id: "low-response",
      severity: "critical",
      title: `Enable auto-reply now to increase response rate by ~${Math.min(95, responseRate + 35)}%`,
      reason: `Only ${responseRate}% of today's ${inbound} inbound messages got responses`,
      command: "fix-response-rate",
      commandLabel: "Fix Response Rate",
      impact: "+35% response rate",
    });
  }

  if (accountWorkflows.length === 0 && contacts.length > 5) {
    directives.push({
      id: "no-automation",
      severity: "warning",
      title: "Activate automation to handle messages while you sleep",
      reason: `${contacts.length} contacts but zero active workflows — everything requires manual effort`,
      command: "system-optimize",
      commandLabel: "Optimize All Systems",
      impact: "Automate 80% of responses",
    });
  }

  const last7Contacts = contacts.filter(c => c.createdAt && now - new Date(c.createdAt).getTime() < 7 * dayMs);
  if (last7Contacts.length === 0 && contacts.length > 0) {
    directives.push({
      id: "no-new-leads",
      severity: "warning",
      title: "Launch lead generation — zero new contacts this week",
      reason: "Pipeline is stagnant with no new leads entering the system",
      command: "launch-lead-gen",
      commandLabel: "Launch Lead Gen",
      impact: "Restart lead flow",
    });
  }

  const totalDealValue = deals.reduce((s, d) => s + (d.value || 0), 0);
  const zeroDeals = deals.filter(d => !d.value || d.value === 0);
  if (zeroDeals.length > 3) {
    directives.push({
      id: "pipeline-gap",
      severity: "warning",
      title: `Add deal values to unlock revenue forecasting (${zeroDeals.length} deals missing)`,
      reason: `$${totalDealValue.toLocaleString()} tracked but ${zeroDeals.length} deals have no value — forecasting is blind`,
      command: "optimize-pipeline",
      commandLabel: "Fix Pipeline",
      impact: "Unlock revenue predictions",
    });
  }

  const idleContacts = contacts.filter(c => {
    if (!c.lastContactedAt) return true;
    return now - new Date(c.lastContactedAt).getTime() > 14 * dayMs;
  });
  if (idleContacts.length > 10) {
    directives.push({
      id: "idle-contacts",
      severity: "opportunity",
      title: `Re-engage ${idleContacts.length} dormant contacts with a nurture sequence`,
      reason: "These contacts haven't heard from you in 14+ days and are at risk of churning",
      command: "activate-nurture",
      commandLabel: "Activate Nurture",
      impact: `Re-engage ${idleContacts.length} contacts`,
    });
  }

  return directives;
}
