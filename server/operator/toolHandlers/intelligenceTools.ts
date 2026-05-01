import type { OperatorTool, ValidationResult, ToolResult, OperatorContext } from "../types";
import { storage } from "../../storage";
import { db } from "../../db";
import { contacts as contactsTable, messages as messagesTable } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

async function getContactsCapped(subAccountId: number, limit = 5000) {
  return db.select({ id: contactsTable.id }).from(contactsTable).where(eq(contactsTable.subAccountId, subAccountId)).limit(limit).catch(() => []);
}

async function getMessagesCapped(subAccountId: number, limit = 500) {
  return db.select({ direction: messagesTable.direction, status: messagesTable.status, createdAt: messagesTable.createdAt })
    .from(messagesTable).where(eq(messagesTable.subAccountId, subAccountId)).orderBy(desc(messagesTable.createdAt)).limit(limit)
    .catch(() => [] as { direction: string; status: string; createdAt: Date }[]);
}

function noopValidate(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

export const intelligenceTools: OperatorTool[] = [
  {
    name: "detectMissingSetup",
    description: "Scan account configuration and detect missing setup pieces",
    category: "intelligence",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [],
    validate: noopValidate,
    execute: async (_params, ctx) => {
      const account = await storage.getSubAccount(ctx.subAccountId);
      if (!account) return { success: false, error: "Account not found" };

      const config = (account as any)?.config || {};
      const aiPromptConfig = (account as any)?.aiPromptConfig || {};
      const missing: string[] = [];
      const configured: string[] = [];
      const recommendations: string[] = [];
      let totalChecks = 0;

      totalChecks++;
      if (!account.twilioNumber) {
        missing.push("No phone number — SMS and voice calls disabled");
        recommendations.push("Connect a Twilio phone number in Settings > Integrations");
      } else {
        configured.push(`Phone: ${account.twilioNumber}`);
      }

      const connections = await storage.getIntegrationConnections(ctx.subAccountId);
      const connectedProviders = new Set(connections.filter(c => c.status === "connected").map(c => c.provider));
      const disconnected = connections.filter(c => c.status !== "connected");

      totalChecks++;
      if (!connectedProviders.has("twilio")) {
        missing.push("Twilio not connected — no SMS capability");
        recommendations.push("Add Twilio credentials in Integrations");
      } else {
        configured.push("Twilio: connected");
      }

      totalChecks++;
      const hasMetaPage = !!(account as any).metaPageId;
      const hasMetaToken = !!(account as any).metaAccessToken;
      if (!hasMetaPage || !hasMetaToken) {
        missing.push("Meta/Instagram not connected — no DM automation");
        recommendations.push("Connect your Meta page in Settings to enable Instagram/Facebook DMs");
      } else {
        configured.push(`Meta: Page connected (ID: ${(account as any).metaPageId})`);
      }

      totalChecks++;
      const hasAiPrompt = !!(aiPromptConfig.systemPrompt || aiPromptConfig.customPrompt || config.customAiPrompt);
      const autoReplyEnabled = !!(aiPromptConfig.autoReplyEnabled || config.autoReplyEnabled);
      if (!hasAiPrompt) {
        missing.push("No AI prompt configured — DM auto-replies have no persona/instructions");
        recommendations.push("Set up an AI prompt in Settings > AI Configuration");
      } else {
        configured.push("AI Prompt: configured");
      }
      if (!autoReplyEnabled) {
        missing.push("Auto-reply disabled — incoming DMs won't get automatic responses");
        recommendations.push("Enable auto-reply in Settings > AI Configuration");
      } else {
        configured.push("Auto-reply: enabled");
      }

      totalChecks++;
      const bookingLink = aiPromptConfig.bookingLink || config.bookingLink;
      if (!bookingLink) {
        missing.push("No booking link — AI can't direct leads to schedule appointments");
        recommendations.push("Add a booking/calendar link in Settings");
      } else {
        configured.push(`Booking link: ${bookingLink}`);
      }

      const automations = await storage.getLiveAutomations(ctx.subAccountId);
      totalChecks++;
      if (!automations || automations.length === 0) {
        missing.push("No active automations — leads won't receive auto-responses");
        recommendations.push("Create a lead auto-response workflow");
      } else {
        configured.push(`Automations: ${automations.length} active`);
      }

      const contacts = await getContactsCapped(ctx.subAccountId);
      totalChecks++;
      if (!contacts || contacts.length === 0) {
        missing.push("No contacts in CRM — no lead database");
        recommendations.push("Import contacts or set up a lead capture form");
      } else {
        configured.push(`Contacts: ${contacts.length} in CRM`);
      }

      const stages = await storage.getPipelineStages(ctx.subAccountId);
      totalChecks++;
      if (!stages || stages.length === 0) {
        missing.push("No pipeline stages — deal tracking disabled");
        recommendations.push("Create a sales pipeline with stages");
      } else {
        configured.push(`Pipeline: ${stages.length} stages configured`);
      }

      const sites = await storage.getSavedSites();
      totalChecks++;
      if (!sites || sites.length === 0) {
        missing.push("No landing pages — no web presence");
        recommendations.push("Generate a landing page in Site Architect");
      } else {
        configured.push(`Sites: ${sites.length} landing pages`);
      }

      totalChecks++;
      if (!account.industry) {
        missing.push("No industry set — AI can't tailor recommendations");
        recommendations.push("Set your industry in Settings");
      } else {
        configured.push(`Industry: ${account.industry}`);
      }

      if (disconnected.length > 0) {
        for (const dc of disconnected) {
          missing.push(`Integration "${dc.provider}" is ${dc.status}`);
          recommendations.push(`Reconnect ${dc.provider} in Integrations`);
        }
      }

      const completionScore = Math.round(((totalChecks - missing.length) / totalChecks) * 100);

      return {
        success: true,
        data: {
          accountName: account.name,
          industry: account.industry,
          configured,
          missing,
          recommendations,
          completionScore: Math.max(0, Math.min(100, completionScore)),
          totalChecks,
          passedChecks: totalChecks - missing.length,
          hasPhone: !!account.twilioNumber,
          hasMeta: hasMetaPage && hasMetaToken,
          hasAiPrompt,
          autoReplyEnabled,
          hasBookingLink: !!bookingLink,
          integrationCount: connectedProviders.size,
          disconnectedIntegrations: disconnected.map(d => d.provider),
          automationCount: automations?.length || 0,
          contactCount: contacts?.length || 0,
          pipelineConfigured: (stages?.length || 0) > 0,
          hasSite: (sites?.length || 0) > 0,
        },
      };
    },
    summarizeForAudit: (_params, result) => `Setup scan: ${result.data?.passedChecks || 0}/${result.data?.totalChecks || 0} passed (${result.data?.completionScore || 0}%), ${result.data?.missing?.length || 0} items missing.`,
  },
  {
    name: "checkIntegrationHealth",
    description: "Check the health status of all connected integrations for an account",
    category: "intelligence",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [],
    validate: noopValidate,
    execute: async (_params, ctx) => {
      const connections = await storage.getIntegrationConnections(ctx.subAccountId);
      const report = connections.map(c => ({
        provider: c.provider,
        status: c.status,
        type: c.connectionType,
        lastChecked: c.createdAt,
      }));
      return { success: true, data: { connections: report, total: report.length, healthy: report.filter(r => r.status === "connected").length } };
    },
    summarizeForAudit: (_params, result) => `Integration health: ${result.data?.healthy || 0}/${result.data?.total || 0} healthy.`,
  },
  {
    name: "getAccountSummary",
    description: "Get a comprehensive summary of account state and metrics",
    category: "intelligence",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [],
    validate: noopValidate,
    execute: async (_params, ctx) => {
      const account = await storage.getSubAccount(ctx.subAccountId);
      if (!account) return { success: false, error: "Account not found" };

      const contacts = await getContactsCapped(ctx.subAccountId);
      const messages = await getMessagesCapped(ctx.subAccountId);
      const automations = await storage.getLiveAutomations(ctx.subAccountId);
      const connections = await storage.getIntegrationConnections(ctx.subAccountId);
      const stages = await storage.getPipelineStages(ctx.subAccountId);
      const sites = await storage.getSavedSites();

      return {
        success: true,
        data: {
          business: { name: account.name, industry: account.industry, phone: account.twilioNumber },
          metrics: {
            contacts: contacts?.length || 0,
            messages: messages?.length || 0,
            automations: automations?.length || 0,
            integrations: connections?.filter(c => c.status === "connected").length || 0,
            pipelineStages: stages?.length || 0,
            sites: sites?.length || 0,
          },
        },
      };
    },
    summarizeForAudit: (_params, result) => `Account summary: ${result.data?.metrics?.contacts || 0} contacts, ${result.data?.metrics?.automations || 0} automations.`,
  },
  {
    name: "auditConversionLeaks",
    description: "Audit the sales funnel for conversion leaks and drop-off points",
    category: "intelligence",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [],
    validate: noopValidate,
    execute: async (_params, ctx) => {
      const contacts = await getContactsCapped(ctx.subAccountId);
      const deals = await storage.getDeals(ctx.subAccountId);
      const appointments = await storage.getAppointments(ctx.subAccountId);
      const messages = await getMessagesCapped(ctx.subAccountId);

      const leaks: string[] = [];
      const recommendations: string[] = [];

      const contactCount = contacts?.length || 0;
      const dealCount = deals?.length || 0;
      const appointmentCount = appointments?.length || 0;

      if (contactCount > 0 && dealCount === 0) {
        leaks.push("No deals created — contacts are not being converted into opportunities");
        recommendations.push("Create deals for qualified leads and assign pipeline stages");
      }

      if (contactCount > 10 && appointmentCount === 0) {
        leaks.push("No appointments scheduled — missing personal engagement step");
        recommendations.push("Add appointment booking to your lead follow-up workflow");
      }

      const outboundMessages = messages?.filter(m => m.direction === "outbound") || [];
      if (contactCount > 5 && outboundMessages.length === 0) {
        leaks.push("No outbound messages — leads are not being followed up");
        recommendations.push("Create an automated follow-up sequence for new leads");
      }

      const contactToDealRate = contactCount > 0 ? Math.round((dealCount / contactCount) * 100) : 0;

      return {
        success: true,
        data: {
          funnel: {
            contacts: contactCount,
            deals: dealCount,
            appointments: appointmentCount,
            messages: messages?.length || 0,
          },
          conversionRate: contactToDealRate,
          leaks,
          recommendations,
          severity: leaks.length >= 3 ? "critical" : leaks.length >= 1 ? "warning" : "healthy",
        },
      };
    },
    summarizeForAudit: (_params, result) => `Conversion audit: ${result.data?.leaks?.length || 0} leaks found, ${result.data?.conversionRate || 0}% conversion.`,
  },
  {
    name: "auditResponseSpeed",
    description: "Audit how quickly the business responds to incoming messages",
    category: "intelligence",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [],
    validate: noopValidate,
    execute: async (_params, ctx) => {
      const messages = await getMessagesCapped(ctx.subAccountId);
      if (!messages || messages.length === 0) {
        return {
          success: true,
          data: {
            messageCount: 0,
            averageResponseMinutes: null,
            grade: "N/A",
            note: "No messages to analyze",
          },
        };
      }

      const inbound = messages.filter(m => m.direction === "inbound");
      const outbound = messages.filter(m => m.direction === "outbound");

      let totalResponseTime = 0;
      let responsePairs = 0;

      for (const inMsg of inbound) {
        const response = outbound.find(o =>
          o.contactPhone === inMsg.contactPhone &&
          new Date(o.createdAt) > new Date(inMsg.createdAt)
        );
        if (response) {
          const diff = new Date(response.createdAt).getTime() - new Date(inMsg.createdAt).getTime();
          totalResponseTime += diff;
          responsePairs++;
        }
      }

      const avgMs = responsePairs > 0 ? totalResponseTime / responsePairs : null;
      const avgMinutes = avgMs ? Math.round(avgMs / 60000) : null;

      let grade = "N/A";
      if (avgMinutes !== null) {
        if (avgMinutes <= 5) grade = "A+";
        else if (avgMinutes <= 15) grade = "A";
        else if (avgMinutes <= 30) grade = "B";
        else if (avgMinutes <= 60) grade = "C";
        else grade = "D";
      }

      const responseRate = inbound.length > 0 ? Math.round((responsePairs / inbound.length) * 100) : 0;

      return {
        success: true,
        data: {
          messageCount: messages.length,
          inboundCount: inbound.length,
          responsePairs,
          responseRate,
          averageResponseMinutes: avgMinutes,
          grade,
          benchmark: "Industry average: 15-30 minutes",
        },
      };
    },
    summarizeForAudit: (_params, result) => `Response speed audit: grade ${result.data?.grade}, avg ${result.data?.averageResponseMinutes || "N/A"} min.`,
  },
  {
    name: "recommendNextBestAction",
    description: "Recommend the single most impactful next action for the account",
    category: "intelligence",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [],
    validate: noopValidate,
    execute: async (_params, ctx) => {
      const account = await storage.getSubAccount(ctx.subAccountId);
      if (!account) return { success: false, error: "Account not found" };

      const contacts = await getContactsCapped(ctx.subAccountId);
      const automations = await storage.getLiveAutomations(ctx.subAccountId);
      const connections = await storage.getIntegrationConnections(ctx.subAccountId);
      const stages = await storage.getPipelineStages(ctx.subAccountId);
      const reviews = await storage.getReviews(ctx.subAccountId);

      const connectedCount = connections?.filter(c => c.status === "connected").length || 0;

      let action: string;
      let reason: string;
      let toolSuggestion: string;
      let priority: "high" | "medium" | "low";

      if (connectedCount === 0) {
        action = "Connect your first integration (Twilio for SMS)";
        reason = "No integrations connected — the platform can't communicate with customers";
        toolSuggestion = "connectIntegration";
        priority = "high";
      } else if (!contacts || contacts.length === 0) {
        action = "Add your first contacts to the CRM";
        reason = "Empty CRM means no leads to nurture";
        toolSuggestion = "createContact";
        priority = "high";
      } else if (!stages || stages.length === 0) {
        action = "Create a sales pipeline";
        reason = "No pipeline means deals can't be tracked";
        toolSuggestion = "createPipeline";
        priority = "high";
      } else if (!automations || automations.length === 0) {
        action = "Create an auto-response workflow for new leads";
        reason = "No automations — leads are not being followed up automatically";
        toolSuggestion = "generateAutoResponseWorkflow";
        priority = "high";
      } else if (reviews && reviews.filter(r => r.rating <= 2 && !(r as Record<string, unknown>).aiResponse).length > 0) {
        action = "Respond to unanswered negative reviews";
        reason = "Negative reviews without responses hurt reputation";
        toolSuggestion = "respondToReviewDraft";
        priority = "high";
      } else {
        action = "Optimize your existing workflows for better timing";
        reason = "All basics are covered — now it's time to optimize";
        toolSuggestion = "optimizeWorkflowTiming";
        priority = "medium";
      }

      return {
        success: true,
        data: { action, reason, toolSuggestion, priority },
      };
    },
    summarizeForAudit: (_params, result) => `Recommended: "${result.data?.action}" (${result.data?.priority}).`,
  },
  {
    name: "diagnoseMessaging",
    description: "Diagnose messaging channel health and delivery issues",
    category: "intelligence",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [],
    validate: noopValidate,
    execute: async (_params, ctx) => {
      const messages = await getMessagesCapped(ctx.subAccountId);
      const connections = await storage.getIntegrationConnections(ctx.subAccountId);

      const channels: Record<string, { total: number; sent: number; failed: number; pending: number }> = {};
      for (const msg of (messages || [])) {
        const ch = msg.channel || "sms";
        if (!channels[ch]) channels[ch] = { total: 0, sent: 0, failed: 0, pending: 0 };
        channels[ch].total++;
        if (msg.status === "sent" || msg.status === "delivered") channels[ch].sent++;
        else if (msg.status === "failed") channels[ch].failed++;
        else channels[ch].pending++;
      }

      const issues: string[] = [];
      for (const [ch, stats] of Object.entries(channels)) {
        if (stats.failed > 0 && stats.failed / stats.total > 0.1) {
          issues.push(`${ch}: ${Math.round((stats.failed / stats.total) * 100)}% failure rate (${stats.failed}/${stats.total})`);
        }
      }

      const twilioConnected = connections?.some(c => c.provider === "twilio" && c.status === "connected");
      if (!twilioConnected) issues.push("Twilio not connected — SMS sending will fail");

      return {
        success: true,
        data: {
          channels,
          issues,
          twilioConnected,
          totalMessages: messages?.length || 0,
          healthy: issues.length === 0,
        },
      };
    },
    summarizeForAudit: (_params, result) => `Messaging diagnosis: ${result.data?.issues?.length || 0} issues, ${result.data?.totalMessages || 0} messages.`,
  },
  {
    name: "restoreBrokenIntegrationDraft",
    description: "Create a draft plan to restore a broken integration connection",
    category: "intelligence",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "provider", type: "string", required: true, description: "Integration provider name" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const connection = await storage.getIntegrationConnection(ctx.subAccountId, params.provider);

      const steps: string[] = [];
      if (!connection) {
        steps.push(`No ${params.provider} connection found — needs initial setup`);
        steps.push(`Go to Integrations and add ${params.provider} credentials`);
      } else if (connection.status !== "connected") {
        steps.push(`${params.provider} status: ${connection.status}`);
        steps.push("Verify API credentials are still valid");
        steps.push("Check if the provider account is active and in good standing");
        steps.push("Re-authenticate or update credentials");
        steps.push("Test connection after update");
      } else {
        steps.push(`${params.provider} appears to be connected and healthy`);
      }

      return {
        success: true,
        data: {
          provider: params.provider,
          currentStatus: connection?.status || "not_found",
          recoverySteps: steps,
          note: "Recovery plan saved as draft. Manual action may be required.",
        },
        sideEffects: [`Generated recovery plan for ${params.provider}`],
      };
    },
    summarizeForAudit: (params) => `Generated recovery plan for ${params.provider} integration.`,
  },
  {
    name: "generateAccountSetupPlan",
    description: "Generate a step-by-step account setup plan based on industry",
    category: "intelligence",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [
      { name: "industry", type: "string", required: false, description: "Industry vertical" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const account = await storage.getSubAccount(ctx.subAccountId);
      const industry = params.industry || account?.industry || "general";

      const plan = [
        { step: 1, action: "Connect Twilio for SMS", tool: "connectIntegration", completed: !!account?.twilioNumber },
        { step: 2, action: "Import or create contacts", tool: "createContact", completed: false },
        { step: 3, action: "Create sales pipeline stages", tool: "createPipeline", completed: false },
        { step: 4, action: "Set up auto-response workflow", tool: "generateAutoResponseWorkflow", completed: false },
        { step: 5, action: "Generate a landing page", tool: "generateLandingPage", completed: false },
        { step: 6, action: "Configure review collection", tool: "sendReviewRequestDraft", completed: false },
      ];

      const contacts = await getContactsCapped(ctx.subAccountId);
      if (contacts && contacts.length > 0) plan[1].completed = true;

      const stages = await storage.getPipelineStages(ctx.subAccountId);
      if (stages && stages.length > 0) plan[2].completed = true;

      const automations = await storage.getLiveAutomations(ctx.subAccountId);
      if (automations && automations.length > 0) plan[3].completed = true;

      const sites = await storage.getSavedSites();
      if (sites && sites.length > 0) plan[4].completed = true;

      const completedCount = plan.filter(s => s.completed).length;

      return {
        success: true,
        data: {
          industry,
          plan,
          completedCount,
          totalSteps: plan.length,
          progressPct: Math.round((completedCount / plan.length) * 100),
        },
      };
    },
    summarizeForAudit: (params, result) => `Generated setup plan: ${result.data?.completedCount}/${result.data?.totalSteps} complete.`,
  },
  {
    name: "compareToIndustryBenchmark",
    description: "Compare account metrics to industry benchmarks",
    category: "intelligence",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [
      { name: "industry", type: "string", required: false, description: "Industry to compare against" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const account = await storage.getSubAccount(ctx.subAccountId);
      const industry = params.industry || account?.industry || "general";

      const benchmarks: Record<string, { responseTimeMin: number; automationCount: number; reviewRating: number; contactGrowthMonthly: number }> = {
        dental: { responseTimeMin: 10, automationCount: 5, reviewRating: 4.5, contactGrowthMonthly: 20 },
        legal: { responseTimeMin: 15, automationCount: 3, reviewRating: 4.3, contactGrowthMonthly: 10 },
        hvac: { responseTimeMin: 8, automationCount: 4, reviewRating: 4.4, contactGrowthMonthly: 15 },
        real_estate: { responseTimeMin: 5, automationCount: 6, reviewRating: 4.6, contactGrowthMonthly: 25 },
        general: { responseTimeMin: 15, automationCount: 3, reviewRating: 4.0, contactGrowthMonthly: 10 },
      };

      const benchmark = benchmarks[industry] || benchmarks.general;
      const contacts = await getContactsCapped(ctx.subAccountId);
      const automations = await storage.getLiveAutomations(ctx.subAccountId);
      const reviews = await storage.getReviews(ctx.subAccountId);
      const avgRating = reviews && reviews.length > 0
        ? Math.round((reviews.reduce((sum: number, r) => sum + r.rating, 0) / reviews.length) * 10) / 10
        : 0;

      const comparison = {
        automations: {
          yours: automations?.length || 0,
          benchmark: benchmark.automationCount,
          status: (automations?.length || 0) >= benchmark.automationCount ? "above" as const : "below" as const,
        },
        reviewRating: {
          yours: avgRating,
          benchmark: benchmark.reviewRating,
          status: avgRating >= benchmark.reviewRating ? "above" as const : "below" as const,
        },
        contactCount: {
          yours: contacts?.length || 0,
          benchmark: benchmark.contactGrowthMonthly,
          note: `Industry average adds ~${benchmark.contactGrowthMonthly} contacts/month`,
        },
      };

      const aboveCount = [comparison.automations, comparison.reviewRating].filter(c => c.status === "above").length;
      return {
        success: true,
        data: {
          industry,
          benchmark,
          comparison,
          overallGrade: aboveCount >= 2 ? "Above Average" : "Below Average",
        },
      };
    },
    summarizeForAudit: (params, result) => `Industry benchmark comparison (${result.data?.industry}): ${result.data?.overallGrade}.`,
  },
  {
    name: "searchContacts",
    description: "Search contacts by name, email, phone, or tags. Returns matching contacts with IDs.",
    category: "intelligence",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [
      { name: "query", type: "string", required: true, description: "Search term — name, email, phone, or tag" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const results = await storage.searchContacts(ctx.subAccountId, params.query);
      return {
        success: true,
        data: {
          contacts: results.map(c => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            phone: c.phone,
            tags: c.tags,
            source: c.source,
          })),
          count: results.length,
          query: params.query,
        },
      };
    },
    summarizeForAudit: (params, result) => `Searched contacts for "${params.query}": ${result.data?.count || 0} found.`,
  },
  {
    name: "searchWorkflows",
    description: "List or search workflows. Pass an empty string \"\" or \"*\" to list ALL workflows for this account. Pass a name fragment or trigger type to filter.",
    category: "intelligence",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [
      { name: "query", type: "string", required: true, description: "Search term — workflow name or trigger type. Use \"\" or \"*\" to list all." },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const q = String(params.query || "").trim();
      let results: any[];
      if (q === "" || q === "*") {
        const allWorkflows = await storage.getWorkflows();
        const liveAutos = await storage.searchWorkflows(ctx.subAccountId, "");
        const wfForSub = allWorkflows.filter((w: any) => w.subAccountId === ctx.subAccountId);
        results = [...wfForSub, ...liveAutos];
      } else {
        const liveResults = await storage.searchWorkflows(ctx.subAccountId, q);
        const allWorkflows = await storage.getWorkflows();
        const lowerQ = q.toLowerCase();
        const wfMatches = allWorkflows.filter((w: any) =>
          w.subAccountId === ctx.subAccountId &&
          (w.name?.toLowerCase().includes(lowerQ) || w.trigger?.toLowerCase().includes(lowerQ))
        );
        results = [...wfMatches, ...liveResults];
      }
      return {
        success: true,
        data: {
          workflows: results.map(w => ({
            id: w.id,
            name: w.name,
            status: w.status,
            description: w.description,
            runCount: w.runCount,
            lastRunAt: w.lastRunAt,
          })),
          count: results.length,
          query: params.query,
        },
      };
    },
    summarizeForAudit: (params, result) => `Searched workflows for "${params.query}": ${result.data?.count || 0} found.`,
  },
];
