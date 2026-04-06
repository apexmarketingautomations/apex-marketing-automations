import crypto from "crypto";
import type { ContextPacket, WorkspaceProfile, PerformanceSnapshot, IndustryKnowledge } from "./cognitiveTypes";
import { getBenchmarksForIndustry } from "./benchmarkAggregator";
import { checkAccountReadiness, type AccountReadiness } from "./accountReadiness";

export interface HealthScore {
  overall: number;
  categories: {
    leadCapture: { score: number; label: string; detail: string };
    communication: { score: number; label: string; detail: string };
    automation: { score: number; label: string; detail: string };
    integration: { score: number; label: string; detail: string };
    funnelCoverage: { score: number; label: string; detail: string };
    retention: { score: number; label: string; detail: string };
  };
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  summary: string;
}

export interface StrategicInsight {
  id: string;
  category: "growth" | "automation" | "funnel" | "retention" | "marketing" | "system";
  observation: string;
  insight: string;
  suggestion: string;
  action?: { label: string; tool?: string; params?: Record<string, any>; link?: string };
  priority: number;
  confidence: number;
  impact: "high" | "medium" | "low";
  effort: "quick-win" | "moderate" | "strategic";
}

export interface GrowthReport {
  generatedAt: string;
  healthScore: HealthScore;
  growthStage: string;
  strategicInsights: StrategicInsight[];
  missedOpportunities: StrategicInsight[];
  quickWins: StrategicInsight[];
  industryBenchmarks: Record<string, { yours: number | string; benchmark: number | string; status: "above" | "at" | "below" }>;
}

function calcLeadCaptureScore(w: WorkspaceProfile, p: PerformanceSnapshot): { score: number; detail: string } {
  let score = 0;
  const reasons: string[] = [];

  if (w.siteCount > 0) { score += 25; reasons.push("landing page active"); }
  else reasons.push("no landing page");

  if (w.contactCount > 0) { score += 25; } else reasons.push("no contacts in CRM");
  if (w.contactCount > 50) score += 15;
  if (w.contactCount > 200) score += 10;

  if (p.inboundMessages > 0) { score += 15; reasons.push("receiving inbound leads"); }
  else reasons.push("no inbound lead activity");

  if (w.integrationCount >= 2) score += 10;

  return { score: Math.min(100, score), detail: reasons.join("; ") };
}

function calcCommunicationScore(w: WorkspaceProfile, p: PerformanceSnapshot, readiness?: AccountReadiness): { score: number; detail: string } {
  let score = 0;
  const reasons: string[] = [];

  if (w.phoneConfigured) { score += 30; reasons.push("phone connected"); }
  else reasons.push("no phone number");

  if (p.outboundMessages > 0) { score += 20; reasons.push("sending messages"); }
  else reasons.push("no outbound messages");

  if (p.messageCount > 0 && p.failedMessages / p.messageCount < 0.05) {
    score += 20;
  } else if (p.failedMessages > 0) {
    reasons.push(`${Math.round((p.failedMessages / Math.max(1, p.messageCount)) * 100)}% failure rate`);
  }

  if (p.inboundMessages > 0 && p.outboundMessages > 0) {
    const ratio = p.outboundMessages / p.inboundMessages;
    if (ratio >= 0.8) { score += 20; } else if (ratio >= 0.4) { score += 10; reasons.push("slow response rate"); }
    else {
      const isAccountReady = !readiness || readiness.ready;
      reasons.push(isAccountReady ? "many unanswered messages" : "response data pending — agent warming up");
    }
  }

  if (p.avgResponseTimeSec && p.avgResponseTimeSec < 300) score += 10;

  return { score: Math.min(100, score), detail: reasons.join("; ") };
}

function calcAutomationScore(w: WorkspaceProfile, p: PerformanceSnapshot): { score: number; detail: string } {
  let score = 0;
  const reasons: string[] = [];

  if (w.automationCount > 0) { score += 30; reasons.push(`${w.automationCount} workflows created`); }
  else { reasons.push("no automations"); return { score: 0, detail: reasons.join("; ") }; }

  if (p.activeAutomations > 0) { score += 30; reasons.push(`${p.activeAutomations} active`); }
  else reasons.push("none are active");

  if (w.automationCount >= 3) score += 20;
  if (w.automationCount >= 5) score += 20;

  return { score: Math.min(100, score), detail: reasons.join("; ") };
}

function calcIntegrationScore(w: WorkspaceProfile): { score: number; detail: string } {
  let score = 0;
  const reasons: string[] = [];

  if (w.integrationCount === 0) { reasons.push("no integrations"); return { score: 0, detail: reasons.join("; ") }; }

  score += Math.min(40, w.integrationCount * 15);
  reasons.push(`${w.integrationCount} connected`);

  if (w.phoneConfigured) score += 20;
  if (w.integrationCount >= 3) score += 20;
  if (w.integrationCount >= 5) score += 20;

  return { score: Math.min(100, score), detail: reasons.join("; ") };
}

function calcFunnelScore(w: WorkspaceProfile, p: PerformanceSnapshot): { score: number; detail: string } {
  let score = 0;
  const reasons: string[] = [];

  if (w.siteCount > 0) { score += 25; reasons.push("landing page"); } else reasons.push("no capture page");
  if (w.contactCount > 0) { score += 20; } else reasons.push("empty pipeline");
  if (w.automationCount > 0) { score += 20; reasons.push("follow-up automation"); } else reasons.push("no follow-up");
  if (p.outboundMessages > 0) { score += 20; reasons.push("active outreach"); } else reasons.push("no outreach");
  if (w.integrationCount > 0) score += 15;

  return { score: Math.min(100, score), detail: reasons.join("; ") };
}

function calcRetentionScore(w: WorkspaceProfile, p: PerformanceSnapshot): { score: number; detail: string } {
  let score = 30;
  const reasons: string[] = [];

  if (w.automationCount > 0) { score += 20; reasons.push("has automations for follow-up"); }
  if (p.outboundMessages > 10) { score += 20; reasons.push("active messaging"); }
  if (w.siteCount > 0) { score += 15; }
  if (w.contactCount > 100) { score += 15; reasons.push("growing contact base"); }

  return { score: Math.min(100, score), detail: reasons.length > 0 ? reasons.join("; ") : "baseline score" };
}

function getGrade(score: number): "A+" | "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 45) return "C";
  if (score >= 25) return "D";
  return "F";
}

function getLabelForScore(score: number): string {
  if (score >= 80) return "Strong";
  if (score >= 60) return "Good";
  if (score >= 40) return "Needs Work";
  if (score >= 20) return "Weak";
  return "Not Started";
}

function getGrowthStage(context: ContextPacket): string {
  const { workspace, performance } = context;
  if (workspace.contactCount === 0 && workspace.automationCount === 0) return "Setup";
  if (workspace.contactCount < 20 && workspace.automationCount <= 1) return "Foundation";
  if (workspace.contactCount < 100 && performance.messageCount < 50) return "Early Growth";
  if (workspace.contactCount < 500) return "Growth";
  if (workspace.contactCount < 2000) return "Scaling";
  return "Mature";
}

export async function calculateHealthScore(context: ContextPacket): Promise<HealthScore> {
  const { workspace, performance } = context;

  const leadCapture = calcLeadCaptureScore(workspace, performance);
  let healthReadiness: AccountReadiness | undefined;
  try {
    healthReadiness = await checkAccountReadiness(performance.subAccountId);
  } catch {}
  const communication = calcCommunicationScore(workspace, performance, healthReadiness);
  const automation = calcAutomationScore(workspace, performance);
  const integration = calcIntegrationScore(workspace);
  const funnelCoverage = calcFunnelScore(workspace, performance);
  const retention = calcRetentionScore(workspace, performance);

  const weights = { leadCapture: 0.2, communication: 0.2, automation: 0.2, integration: 0.1, funnelCoverage: 0.2, retention: 0.1 };
  const overall = Math.round(
    leadCapture.score * weights.leadCapture +
    communication.score * weights.communication +
    automation.score * weights.automation +
    integration.score * weights.integration +
    funnelCoverage.score * weights.funnelCoverage +
    retention.score * weights.retention
  );

  const grade = getGrade(overall);

  const weakest = [
    { name: "lead capture", score: leadCapture.score },
    { name: "communication", score: communication.score },
    { name: "automation", score: automation.score },
    { name: "integrations", score: integration.score },
    { name: "funnel", score: funnelCoverage.score },
    { name: "retention", score: retention.score },
  ].sort((a, b) => a.score - b.score);

  let summary: string;
  if (overall >= 80) summary = "Your business systems are well-optimized. Focus on scaling what's working.";
  else if (overall >= 60) summary = `Good foundation. Strengthening your ${weakest[0].name} would have the biggest impact on growth.`;
  else if (overall >= 40) summary = `Several areas need attention. Start with ${weakest[0].name} and ${weakest[1].name} for the fastest improvement.`;
  else summary = `Your systems are in early setup. Focus on ${weakest[0].name} first — it's the foundation everything else builds on.`;

  return {
    overall,
    categories: {
      leadCapture: { score: leadCapture.score, label: getLabelForScore(leadCapture.score), detail: leadCapture.detail },
      communication: { score: communication.score, label: getLabelForScore(communication.score), detail: communication.detail },
      automation: { score: automation.score, label: getLabelForScore(automation.score), detail: automation.detail },
      integration: { score: integration.score, label: getLabelForScore(integration.score), detail: integration.detail },
      funnelCoverage: { score: funnelCoverage.score, label: getLabelForScore(funnelCoverage.score), detail: funnelCoverage.detail },
      retention: { score: retention.score, label: getLabelForScore(retention.score), detail: retention.detail },
    },
    grade,
    summary,
  };
}

export function generateStrategicInsights(context: ContextPacket): StrategicInsight[] {
  const insights: StrategicInsight[] = [];
  const { workspace, performance, industryKnowledge, pastExperiences } = context;

  if (workspace.automationCount === 0) {
    insights.push({
      id: crypto.randomUUID(), category: "automation", priority: 95, confidence: 1, impact: "high", effort: "quick-win",
      observation: "Zero automations are running in your account.",
      insight: "Every inbound lead is going unanswered automatically. Studies show that businesses responding within 5 minutes are 21x more likely to qualify a lead. Without automation, you're relying entirely on manual follow-up.",
      suggestion: "Set up a basic lead auto-response workflow. When a new contact comes in, send an immediate SMS acknowledgment and schedule a follow-up for 24 hours later.",
      action: { label: "Create Auto-Response", tool: "createWorkflow", link: "/workflows" },
    });
  }

  if (!workspace.phoneConfigured) {
    insights.push({
      id: crypto.randomUUID(), category: "system", priority: 93, confidence: 1, impact: "high", effort: "quick-win",
      observation: "No phone number is connected to your account.",
      insight: "SMS and voice are your two highest-converting channels. Without a connected number, you can't send texts, receive calls, or deploy voice AI agents. This blocks your entire outbound strategy.",
      suggestion: "Connect a Twilio phone number. This unlocks SMS messaging, voice AI agents, and text-back automations — the core of most lead conversion systems.",
      action: { label: "Connect Phone", tool: "connectIntegration", link: "/integrations" },
    });
  }

  if (workspace.siteCount === 0) {
    insights.push({
      id: crypto.randomUUID(), category: "funnel", priority: 82, confidence: 0.95, impact: "high", effort: "quick-win",
      observation: "No landing page or website is set up.",
      insight: "You have no 24/7 lead capture mechanism. Every potential customer who looks for you online has nowhere to go. A single optimized landing page can generate leads while you sleep.",
      suggestion: "Use the AI Site Builder to generate a professional landing page with a lead capture form. It takes 2 minutes and immediately starts working for you.",
      action: { label: "Build Landing Page", tool: "generateLandingPage", link: "/site-builder" },
    });
  }

  if (performance.inboundMessages > 5 && performance.outboundMessages === 0) {
    insights.push({
      id: crypto.randomUUID(), category: "growth", priority: 96, confidence: 0.98, impact: "high", effort: "quick-win",
      observation: `${performance.inboundMessages} inbound messages received, but zero outbound replies sent.`,
      insight: "People are reaching out to your business and getting silence in return. Every unanswered message is a lost opportunity. In most industries, 78% of customers buy from the first business that responds.",
      suggestion: "Set up missed-message auto-reply so no lead goes unanswered. Even a simple 'We got your message, someone will be right with you' dramatically improves conversion.",
      action: { label: "Fix This Now", tool: "createWorkflow", link: "/workflows" },
    });
  }

  if (performance.failedMessages > 0 && performance.messageCount > 0) {
    const failRate = performance.failedMessages / performance.messageCount;
    if (failRate > 0.1) {
      insights.push({
        id: crypto.randomUUID(), category: "system", priority: 90, confidence: 0.92, impact: "high", effort: "moderate",
        observation: `${Math.round(failRate * 100)}% of your messages are failing to deliver.`,
        insight: "A high failure rate means your messages aren't reaching your leads. This could be due to invalid phone numbers, carrier issues, or opt-out compliance problems. Every failed message is a missed touchpoint.",
        suggestion: "Run a diagnostic check on your messaging setup. Clean your contact list of invalid numbers and ensure your sender number has proper compliance configured.",
        action: { label: "Run Diagnostics", tool: "checkIntegrationHealth" },
      });
    }
  }

  if (workspace.contactCount > 20 && workspace.automationCount > 0 && performance.activeAutomations === 0) {
    insights.push({
      id: crypto.randomUUID(), category: "automation", priority: 88, confidence: 0.95, impact: "high", effort: "quick-win",
      observation: `${workspace.automationCount} workflows exist but none are active.`,
      insight: "You built automations but they're all turned off. This means every new lead requires manual handling. Your workflows are ready — they just need to be activated.",
      suggestion: "Review your existing workflows and activate the ones that handle initial lead response and follow-up sequences.",
      action: { label: "Activate Workflows", link: "/workflows" },
    });
  }

  if (workspace.integrationCount === 0) {
    insights.push({
      id: crypto.randomUUID(), category: "system", priority: 85, confidence: 1, impact: "high", effort: "moderate",
      observation: "No external services are connected.",
      insight: "Without integrations, your CRM operates in isolation. Connecting your tools creates a data flywheel — leads flow in automatically, messages go out automatically, and everything syncs.",
      suggestion: "Start with the essentials: connect Twilio for messaging, and Google for calendar and review management. These two integrations unlock 80% of the platform's power.",
      action: { label: "Connect Services", tool: "connectIntegration", link: "/integrations" },
    });
  }

  if (workspace.contactCount > 50 && workspace.siteCount === 0 && workspace.automationCount === 0) {
    insights.push({
      id: crypto.randomUUID(), category: "growth", priority: 84, confidence: 0.85, impact: "high", effort: "moderate",
      observation: `${workspace.contactCount} contacts but no landing page and no automations.`,
      insight: "You have an audience but no system to engage them. Without a landing page capturing new leads and automations nurturing existing ones, your contact list is a static asset instead of a revenue engine.",
      suggestion: "Build a landing page for new lead capture, then set up a drip campaign to re-engage your existing contacts with a special offer or valuable content.",
      action: { label: "Start Building", link: "/site-builder" },
    });
  }

  if (industryKnowledge) {
    const responseBenchmark = industryKnowledge.avgResponseTimeBenchmark;
    if (performance.avgResponseTimeSec && performance.avgResponseTimeSec > responseBenchmark * 3) {
      insights.push({
        id: crypto.randomUUID(), category: "growth", priority: 83, confidence: 0.82, impact: "medium", effort: "quick-win",
        observation: `Your response time is ${Math.round(performance.avgResponseTimeSec)}s. The ${industryKnowledge.industry} benchmark is ${responseBenchmark}s.`,
        insight: `In ${industryKnowledge.industry}, speed wins deals. You're responding ${Math.round(performance.avgResponseTimeSec / responseBenchmark)}x slower than top performers. Each minute of delay reduces your conversion probability.`,
        suggestion: `Deploy an instant auto-responder to bridge the gap. Even a templated acknowledgment message keeps leads warm while you prepare a personal follow-up.`,
        action: { label: "Speed Up Response", tool: "createWorkflow", link: "/workflows" },
      });
    }

    if (workspace.contactCount > 10 && workspace.siteCount > 0 && workspace.automationCount > 0 && performance.activeAutomations > 0) {
      const tip = industryKnowledge.tips[Math.floor(Math.random() * industryKnowledge.tips.length)];
      insights.push({
        id: crypto.randomUUID(), category: "marketing", priority: 55, confidence: 0.75, impact: "medium", effort: "strategic",
        observation: "Your system is running and generating activity.",
        insight: tip,
        suggestion: `Consider expanding your strategy with ${industryKnowledge.bestChannels.slice(0, 2).join(" and ")} — these are the highest-performing channels in ${industryKnowledge.industry}.`,
      });
    }
  }

  if (context.crossAccountBenchmarks) {
    const cab = context.crossAccountBenchmarks;

    if (cab.response_rate && performance.inboundMessages > 5) {
      const responseRate = Math.round((performance.outboundMessages / performance.inboundMessages) * 100);
      if (responseRate < cab.response_rate.median) {
        insights.push({
          id: crypto.randomUUID(), category: "growth", priority: 86, confidence: 0.88, impact: "high", effort: "quick-win",
          observation: `Your response rate is ${responseRate}%. The ${industryKnowledge?.industry || "industry"} average on Apex is ${Math.round(cab.response_rate.avg)}%.`,
          insight: `Businesses in your industry on Apex that respond to ${Math.round(cab.response_rate.p75)}%+ of messages convert significantly more leads. You're below the median — closing this gap is one of the fastest ways to grow.`,
          suggestion: "Set up auto-response workflows and assign team members to handle inbound messages within 5 minutes.",
          action: { label: "Improve Response Rate", tool: "createWorkflow", link: "/workflows" },
        });
      }
    }

    if (cab.automation_count && workspace.automationCount < (cab.automation_count.median || 1)) {
      insights.push({
        id: crypto.randomUUID(), category: "automation", priority: 75, confidence: 0.82, impact: "medium", effort: "moderate",
        observation: `You have ${workspace.automationCount} automations. Similar businesses on Apex average ${Math.round(cab.automation_count.avg)}.`,
        insight: `Top performers in your industry run ${Math.round(cab.automation_count.p75)}+ automations. More automations means more consistent follow-up and less manual work.`,
        suggestion: "Add automated follow-up sequences for new leads and post-service review requests.",
        action: { label: "Add Automations", link: "/workflows" },
      });
    }

    if (cab.integration_count && workspace.integrationCount < (cab.integration_count.median || 1)) {
      insights.push({
        id: crypto.randomUUID(), category: "system", priority: 60, confidence: 0.75, impact: "medium", effort: "moderate",
        observation: `You have ${workspace.integrationCount} integrations connected. The industry average is ${Math.round(cab.integration_count.avg)}.`,
        insight: "More integrations mean more automated data flow and fewer manual tasks. Top accounts connect ${Math.round(cab.integration_count.p75)}+ services.",
        suggestion: "Review available integrations and connect your most-used business tools.",
        action: { label: "Connect More Tools", link: "/integrations" },
      });
    }
  }

  if (workspace.contactCount > 100 && performance.outboundMessages < workspace.contactCount * 0.1) {
    insights.push({
      id: crypto.randomUUID(), category: "retention", priority: 72, confidence: 0.78, impact: "medium", effort: "moderate",
      observation: `${workspace.contactCount} contacts in CRM but very low outbound messaging volume.`,
      insight: "Most of your contact list is going cold. Dormant contacts lose interest after 30 days without touchpoints. A reactivation campaign could recover warm leads you've already paid to acquire.",
      suggestion: "Create a re-engagement SMS campaign targeting contacts who haven't been messaged in 30+ days. A simple 'Still interested?' with a clear CTA typically recovers 8-15% of dormant leads.",
      action: { label: "Build Reactivation Campaign", link: "/workflows" },
    });
  }

  if (pastExperiences && pastExperiences.length > 0) {
    const failedOutcomes = pastExperiences.filter(m => m.memoryType === "outcome" && m.outcome && /fail|error|low|poor|decline/i.test(m.outcome));
    if (failedOutcomes.length >= 2) {
      insights.push({
        id: crypto.randomUUID(), category: "system", priority: 78, confidence: 0.85, impact: "medium", effort: "moderate",
        observation: `${failedOutcomes.length} past actions resulted in suboptimal outcomes.`,
        insight: `Review previous approaches that didn't work well: ${failedOutcomes.slice(0, 2).map(m => m.content).join("; ")}. Avoiding repeated patterns is key to improving results.`,
        suggestion: "Consider alternative strategies for areas that have shown poor results previously. The system will remember what works better.",
      });
    }

    const preferences = pastExperiences.filter(m => m.memoryType === "preference");
    if (preferences.length > 0) {
      const topPref = preferences[0];
      insights.push({
        id: crypto.randomUUID(), category: "growth", priority: 60, confidence: 0.7, impact: "medium", effort: "quick-win",
        observation: `User preference detected: "${topPref.content}".`,
        insight: "Aligning strategies with stated preferences improves adoption and satisfaction. Tailor recommendations to match the user's working style.",
        suggestion: `Ensure upcoming actions respect the preference: ${topPref.content}`,
      });
    }
  }

  return insights.sort((a, b) => b.priority - a.priority).slice(0, 8);
}

export function detectMissedOpportunities(context: ContextPacket): StrategicInsight[] {
  const missed: StrategicInsight[] = [];
  const { workspace, performance, industryKnowledge, pastExperiences } = context;

  if (workspace.automationCount === 0) {
    missed.push({
      id: crypto.randomUUID(), category: "automation", priority: 90, confidence: 1, impact: "high", effort: "quick-win",
      observation: "No follow-up automation exists.",
      insight: "Every lead requires manual follow-up. Without automation, response delays cause leads to go to competitors.",
      suggestion: "Create a new-lead auto-response workflow.",
      action: { label: "Create Workflow", link: "/workflows" },
    });
  }

  if (workspace.contactCount > 0 && workspace.siteCount === 0) {
    missed.push({
      id: crypto.randomUUID(), category: "funnel", priority: 80, confidence: 0.9, impact: "high", effort: "quick-win",
      observation: "No lead capture page.",
      insight: "You're generating contacts manually. A landing page would capture leads around the clock.",
      suggestion: "Build a conversion-focused landing page.",
      action: { label: "Build Page", link: "/site-builder" },
    });
  }

  if (performance.outboundMessages > 20 && workspace.automationCount > 0) {
    missed.push({
      id: crypto.randomUUID(), category: "marketing", priority: 65, confidence: 0.7, impact: "medium", effort: "moderate",
      observation: "No remarketing or re-engagement campaigns detected.",
      insight: "Your existing contacts are a goldmine. Past leads who didn't convert can be re-engaged with targeted campaigns.",
      suggestion: "Set up a 30-day reactivation drip campaign.",
      action: { label: "Create Campaign", link: "/workflows" },
    });
  }

  if (industryKnowledge && !workspace.services?.length) {
    missed.push({
      id: crypto.randomUUID(), category: "growth", priority: 50, confidence: 0.6, impact: "medium", effort: "strategic",
      observation: "No review management automation detected.",
      insight: "Automated review requests after service completion can increase your Google review count by 3-5x. Reviews are the #1 factor in local search ranking.",
      suggestion: "Set up post-service review request automation.",
      action: { label: "Set Up Reviews", link: "/reputation" },
    });
  }

  if (pastExperiences && pastExperiences.length > 0) {
    const successfulOutcomes = pastExperiences.filter(m => m.memoryType === "outcome" && m.outcome && /success|complet|improv|good/i.test(m.outcome));
    if (successfulOutcomes.length > 0 && workspace.automationCount > 0) {
      missed.push({
        id: crypto.randomUUID(), category: "growth", priority: 55, confidence: 0.7, impact: "medium", effort: "moderate",
        observation: `${successfulOutcomes.length} past actions yielded positive outcomes.`,
        insight: `Successful approaches: ${successfulOutcomes.slice(0, 2).map(m => m.content).join("; ")}. Building on what worked accelerates growth.`,
        suggestion: "Replicate and expand on proven strategies that have yielded positive results.",
      });
    }
  }

  return missed.sort((a, b) => b.priority - a.priority);
}

export async function generateGrowthReport(context: ContextPacket): Promise<GrowthReport & { readiness?: AccountReadiness }> {
  const healthScore = await calculateHealthScore(context);
  const strategicInsights = generateStrategicInsights(context);
  const missedOpportunities = detectMissedOpportunities(context);
  const quickWins = strategicInsights.filter(i => i.effort === "quick-win");
  const growthStage = getGrowthStage(context);

  let readiness: AccountReadiness | undefined;
  try {
    readiness = await checkAccountReadiness(context.performance.subAccountId);
  } catch (err: any) {
    console.error("[ADVISOR] Readiness check failed:", err.message);
  }
  const isReadyForResponseMetrics = !readiness || readiness.ready;

  const benchmarks: GrowthReport["industryBenchmarks"] = {};

  let crossAccountBenchmarks: Record<string, any> = {};
  try {
    crossAccountBenchmarks = await getBenchmarksForIndustry(context.workspace.industry);
  } catch (err: any) {
    console.error("[ADVISOR] Cross-account benchmark fetch failed:", err.message);
  }

  if (Object.keys(crossAccountBenchmarks).length > 0) {
    const cab = crossAccountBenchmarks;

    if (cab.response_rate && isReadyForResponseMetrics) {
      const responseRate = context.performance.inboundMessages > 0
        ? Math.round((context.performance.outboundMessages / context.performance.inboundMessages) * 100)
        : 0;
      benchmarks["response_rate"] = {
        yours: `${responseRate}%`,
        benchmark: `${Math.round(cab.response_rate.avg)}%`,
        status: responseRate >= cab.response_rate.median ? "above" : responseRate >= cab.response_rate.p25 ? "at" : "below",
      };
    }

    if (cab.contact_count) {
      benchmarks["contact_count"] = {
        yours: `${context.workspace.contactCount}`,
        benchmark: `${Math.round(cab.contact_count.avg)}`,
        status: context.workspace.contactCount >= cab.contact_count.median ? "above" : context.workspace.contactCount >= cab.contact_count.p25 ? "at" : "below",
      };
    }

    if (cab.automation_count) {
      benchmarks["automation_count"] = {
        yours: `${context.workspace.automationCount}`,
        benchmark: `${Math.round(cab.automation_count.avg)}`,
        status: context.workspace.automationCount >= cab.automation_count.median ? "above" : context.workspace.automationCount >= cab.automation_count.p25 ? "at" : "below",
      };
    }

    if (cab.review_count) {
      benchmarks["review_count"] = {
        yours: "N/A",
        benchmark: `${Math.round(cab.review_count.avg)}`,
        status: "below",
      };
    }

    if (cab.monthly_message_volume) {
      benchmarks["monthly_messages"] = {
        yours: `${context.performance.messageCount}`,
        benchmark: `${Math.round(cab.monthly_message_volume.avg)}`,
        status: context.performance.messageCount >= cab.monthly_message_volume.median ? "above" : context.performance.messageCount >= cab.monthly_message_volume.p25 ? "at" : "below",
      };
    }

    if (cab.integration_count) {
      benchmarks["integrations"] = {
        yours: `${context.workspace.integrationCount}`,
        benchmark: `${Math.round(cab.integration_count.avg)}`,
        status: context.workspace.integrationCount >= cab.integration_count.median ? "above" : context.workspace.integrationCount >= cab.integration_count.p25 ? "at" : "below",
      };
    }
  }

  if (context.industryKnowledge) {
    const ik = context.industryKnowledge;
    if (!benchmarks["response_time"] && isReadyForResponseMetrics) {
      benchmarks["response_time"] = {
        yours: context.performance.avgResponseTimeSec ? `${Math.round(context.performance.avgResponseTimeSec)}s` : "N/A",
        benchmark: `${ik.avgResponseTimeBenchmark}s`,
        status: !context.performance.avgResponseTimeSec ? "below" : context.performance.avgResponseTimeSec <= ik.avgResponseTimeBenchmark ? "above" : "below",
      };
    }
    for (const [key, val] of Object.entries(ik.conversionBenchmarks)) {
      if (key !== "target_response_time_sec" && !benchmarks[key]) {
        benchmarks[key] = { yours: "N/A", benchmark: `${Math.round(val * 100)}%`, status: "below" };
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    healthScore,
    growthStage,
    strategicInsights,
    missedOpportunities,
    quickWins,
    industryBenchmarks: benchmarks,
    readiness,
  };
}
