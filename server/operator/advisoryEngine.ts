import crypto from "crypto";
import type { AdvisoryInsight, ContextPacket } from "./cognitiveTypes";
import { getResponseTimeBenchmark } from "./industryKnowledge";

export function generateInsights(context: ContextPacket): AdvisoryInsight[] {
  const insights: AdvisoryInsight[] = [];
  const { workspace, performance, behavior, patterns, industryKnowledge } = context;

  if (!workspace.phoneConfigured) {
    insights.push({
      id: crypto.randomUUID(),
      subAccountId: performance.subAccountId,
      category: "warning",
      title: "No phone number connected",
      message: "Your account doesn't have a phone number yet. SMS and voice calls won't work until one is connected. Would you like me to help set that up?",
      dataBacking: { phoneConfigured: false },
      confidence: 1.0,
      priority: 90,
      actionable: true,
      suggestedTool: "connectIntegration",
      suggestedParams: { provider: "twilio" },
    });
  }

  if (workspace.automationCount === 0) {
    insights.push({
      id: crypto.randomUUID(),
      subAccountId: performance.subAccountId,
      category: "opportunity",
      title: "No automations running",
      message: "You don't have any automations yet. New leads won't receive automatic follow-up. I can create a lead auto-response workflow for you.",
      dataBacking: { automationCount: 0 },
      confidence: 1.0,
      priority: 85,
      actionable: true,
      suggestedTool: "createWorkflow",
      suggestedParams: {
        name: "Lead Auto-Response",
        trigger: "new_lead",
        steps: [
          { action: "WAIT", duration: 5, unit: "seconds" },
          { action: "SMS", message: "Hi {{leadName}}, thanks for reaching out! We'll be in touch shortly." },
        ],
      },
    });
  }

  if (workspace.siteCount === 0) {
    insights.push({
      id: crypto.randomUUID(),
      subAccountId: performance.subAccountId,
      category: "opportunity",
      title: "No landing page",
      message: "You don't have a landing page yet. A well-designed page can capture leads 24/7. I can generate one based on your business type.",
      dataBacking: { siteCount: 0, industry: workspace.industry },
      confidence: 0.9,
      priority: 70,
      actionable: true,
      suggestedTool: "generateLandingPage",
      suggestedParams: { prompt: `Professional landing page for ${workspace.businessName} in ${workspace.industry}` },
    });
  }

  if (workspace.contactCount === 0 && workspace.integrationCount > 0) {
    insights.push({
      id: crypto.randomUUID(),
      subAccountId: performance.subAccountId,
      category: "opportunity",
      title: "Integrations connected but no contacts",
      message: "Your integrations are set up but the CRM is empty. Consider importing existing contacts or setting up a lead capture form to start building your pipeline.",
      dataBacking: { contactCount: 0, integrationCount: workspace.integrationCount },
      confidence: 0.85,
      priority: 75,
      actionable: false,
    });
  }

  if (performance.failedMessages > 0) {
    const failRate = performance.messageCount > 0 ? performance.failedMessages / performance.messageCount : 0;
    if (failRate > 0.1) {
      insights.push({
        id: crypto.randomUUID(),
        subAccountId: performance.subAccountId,
        category: "warning",
        title: "High message failure rate",
        message: `${Math.round(failRate * 100)}% of your messages are failing. This could mean your phone number has issues or recipients are unreachable. Let me run a diagnostic check.`,
        dataBacking: { failedMessages: performance.failedMessages, total: performance.messageCount, failRate: Math.round(failRate * 100) },
        confidence: 0.9,
        priority: 88,
        actionable: true,
        suggestedTool: "checkIntegrationHealth",
      });
    }
  }

  if (performance.inboundMessages > 5 && performance.outboundMessages === 0) {
    insights.push({
      id: crypto.randomUUID(),
      subAccountId: performance.subAccountId,
      category: "opportunity",
      title: "Leads reaching out but no responses",
      message: "You're receiving messages but haven't sent any replies. Responding quickly is crucial for conversion. Want me to set up automatic responses?",
      dataBacking: { inbound: performance.inboundMessages, outbound: performance.outboundMessages },
      confidence: 0.95,
      priority: 92,
      actionable: true,
      suggestedTool: "createWorkflow",
    });
  }

  if (industryKnowledge && workspace.contactCount > 10) {
    const benchmark = getResponseTimeBenchmark(workspace.industry);
    if (performance.avgResponseTimeSec && performance.avgResponseTimeSec > benchmark * 2) {
      insights.push({
        id: crypto.randomUUID(),
        subAccountId: performance.subAccountId,
        category: "optimization",
        title: "Response time above industry benchmark",
        message: `Your average response time is ${Math.round(performance.avgResponseTimeSec)}s, but ${industryKnowledge.industry} businesses convert best when responding within ${benchmark}s. An auto-response workflow could close this gap.`,
        dataBacking: { yourTime: performance.avgResponseTimeSec, benchmark, industry: workspace.industry },
        confidence: 0.8,
        priority: 80,
        actionable: true,
        suggestedTool: "createWorkflow",
      });
    }
  }

  if (workspace.integrationCount === 0) {
    insights.push({
      id: crypto.randomUUID(),
      subAccountId: performance.subAccountId,
      category: "warning",
      title: "No integrations connected",
      message: "You haven't connected any integrations yet. Connecting Twilio enables SMS, connecting Google enables calendar sync. I can walk you through it.",
      dataBacking: { integrationCount: 0 },
      confidence: 1.0,
      priority: 80,
      actionable: true,
      suggestedTool: "connectIntegration",
      suggestedParams: { provider: "twilio" },
    });
  }

  if (workspace.contactCount > 50 && !workspace.leadSources?.length) {
    insights.push({
      id: crypto.randomUUID(),
      subAccountId: performance.subAccountId,
      category: "optimization",
      title: "Track your lead sources",
      message: `You have ${workspace.contactCount} contacts but no lead source tracking. Knowing where your best leads come from helps focus your marketing budget.`,
      dataBacking: { contactCount: workspace.contactCount },
      confidence: 0.7,
      priority: 50,
      actionable: false,
    });
  }

  for (const pattern of patterns) {
    if (pattern.confidence > 0.7 && pattern.category === "conversion") {
      insights.push({
        id: crypto.randomUUID(),
        subAccountId: performance.subAccountId,
        category: "optimization",
        title: `Pattern detected: ${pattern.pattern}`,
        message: `I've noticed that ${pattern.pattern}. This insight is based on ${pattern.dataPoints} data points with ${Math.round(pattern.confidence * 100)}% confidence.`,
        dataBacking: { pattern: pattern.pattern, confidence: pattern.confidence, dataPoints: pattern.dataPoints },
        confidence: pattern.confidence,
        priority: 60,
        actionable: false,
      });
    }
  }

  if (behavior.ignoreCount > 5 && behavior.recommendationAcceptRate < 0.2) {
    return insights
      .filter(i => i.priority >= 85)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 2);
  }

  return insights
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5);
}

export function adaptMessage(message: string, behavior: { preferredStyle: string; complexityTolerance: string }): string {
  if (behavior.preferredStyle === "analytical") {
    return message;
  }

  if (behavior.preferredStyle === "action") {
    const sentences = message.split(". ");
    if (sentences.length > 2) {
      return sentences.slice(0, 2).join(". ") + ".";
    }
  }

  if (behavior.preferredStyle === "skeptical") {
    if (!message.includes("data") && !message.includes("%") && !message.includes("based on")) {
      return message + " This is based on your account data.";
    }
  }

  return message;
}
