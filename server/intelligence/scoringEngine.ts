import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and, gte } from "drizzle-orm";
import {
  universalEvents, contacts, savedSites, domains, workflows, liveAutomations,
  deals, emailCampaigns, digitalCards, appointments,
  reviews, metaAdCampaigns, messages
} from "@shared/schema";
import { emitScoreUpdated } from "./apexLearningFeed";

type ScoreBand = "critical" | "low" | "medium" | "high" | "excellent";

async function upsertAndEmitScore(params: {
  accountId: number;
  entityType: string;
  entityId: string;
  scoreType: string;
  scoreValue: number;
  scoreBand: ScoreBand;
  explanation: string;
  inputs: Record<string, unknown>;
}): Promise<void> {
  await storage.upsertIntelligenceScore(params);
  emitScoreUpdated(params.accountId, params.scoreType, params.entityType, params.entityId, params.scoreValue, params.scoreBand);
}

function getBand(value: number): ScoreBand {
  if (value <= 20) return "critical";
  if (value <= 40) return "low";
  if (value <= 60) return "medium";
  if (value <= 80) return "high";
  return "excellent";
}

export async function calculateLeadIntentScore(accountId: number, contactId: number): Promise<void> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [eventCounts] = await db.select({
    total: sql<number>`count(*)::int`,
    formSubmits: sql<number>`count(*) filter (where event_type = 'form_submit')::int`,
    pageViews: sql<number>`count(*) filter (where event_type = 'page_view')::int`,
    messagesSent: sql<number>`count(*) filter (where event_type = 'message_sent' or event_type = 'message_received')::int`,
    ctaClicks: sql<number>`count(*) filter (where event_type = 'cta_click' or event_type = 'button_click')::int`,
  }).from(universalEvents)
    .where(and(
      eq(universalEvents.subAccountId, accountId),
      eq(universalEvents.contactId, contactId),
      gte(universalEvents.occurredAt, thirtyDaysAgo)
    ));

  const e = eventCounts || { total: 0, formSubmits: 0, pageViews: 0, messagesSent: 0, ctaClicks: 0 };
  let score = 0;
  score += Math.min(e.formSubmits * 25, 30);
  score += Math.min(e.messagesSent * 10, 20);
  score += Math.min(e.ctaClicks * 8, 20);
  score += Math.min(e.pageViews * 2, 15);
  score += e.total > 10 ? 15 : e.total > 5 ? 10 : e.total > 0 ? 5 : 0;
  score = Math.min(score, 100);

  await upsertAndEmitScore({
    accountId,
    entityType: "contact",
    entityId: String(contactId),
    scoreType: "lead_intent_score",
    scoreValue: score,
    scoreBand: getBand(score),
    explanation: `Based on ${e.total} events in last 30d: ${e.formSubmits} form submits, ${e.messagesSent} messages, ${e.ctaClicks} CTA clicks, ${e.pageViews} page views`,
    inputs: e as Record<string, unknown>,
  });
}

export async function calculateSiteHealthScore(accountId: number, siteId: number): Promise<void> {
  const [site] = await db.select().from(savedSites).where(eq(savedSites.id, siteId)).limit(1);
  if (!site) return;

  let score = 0;
  const inputs: Record<string, unknown> = {};

  const siteDataStr = typeof site.siteData === "string" ? site.siteData : JSON.stringify(site.siteData ?? "");
  const hasContent = siteDataStr.length > 500;
  inputs.hasContent = hasContent;
  score += hasContent ? 25 : 0;

  const hasDomain = !!site.customDomain;
  inputs.hasDomain = hasDomain;
  score += hasDomain ? 20 : 0;

  const isPublished = !!site.publishedUrl;
  inputs.isPublished = isPublished;
  score += isPublished ? 20 : 0;

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [recentEvents] = await db.select({ count: sql<number>`count(*)::int` })
    .from(universalEvents)
    .where(and(
      eq(universalEvents.subAccountId, accountId),
      eq(universalEvents.siteId, siteId),
      gte(universalEvents.occurredAt, sevenDaysAgo)
    ));
  const recentActivity = recentEvents?.count ?? 0;
  inputs.recentActivity = recentActivity;
  score += recentActivity > 10 ? 20 : recentActivity > 3 ? 15 : recentActivity > 0 ? 10 : 0;

  inputs.hasCtaOrForm = hasContent;
  score += hasContent ? 15 : 0;
  score = Math.min(score, 100);

  await upsertAndEmitScore({
    accountId,
    entityType: "site",
    entityId: String(siteId),
    scoreType: "site_health_score",
    scoreValue: score,
    scoreBand: getBand(score),
    explanation: `Content: ${hasContent ? 'yes' : 'no'}, Domain: ${hasDomain ? 'yes' : 'no'}, Published: ${isPublished ? 'yes' : 'no'}, Activity(7d): ${recentActivity}`,
    inputs,
  });
}

export async function calculateDomainHealthScore(accountId: number, domainId: number): Promise<void> {
  const [domain] = await db.select().from(domains).where(eq(domains.id, domainId)).limit(1);
  if (!domain) return;

  let score = 0;
  const inputs: Record<string, unknown> = {};

  inputs.status = domain.status;
  score += domain.status === "verified" ? 30 : domain.status === "active" ? 25 : 5;

  inputs.dnsConfigured = domain.dnsConfigured;
  score += domain.dnsConfigured ? 25 : 0;

  inputs.sslActive = domain.sslActive;
  score += domain.sslActive ? 20 : 0;

  inputs.hasSite = !!domain.siteId;
  score += domain.siteId ? 25 : 0;

  score = Math.min(score, 100);

  await upsertAndEmitScore({
    accountId,
    entityType: "domain",
    entityId: String(domainId),
    scoreType: "domain_health_score",
    scoreValue: score,
    scoreBand: getBand(score),
    explanation: `Status: ${domain.status}, DNS: ${domain.dnsConfigured ? 'configured' : 'pending'}, SSL: ${domain.sslActive ? 'active' : 'inactive'}, Site linked: ${domain.siteId ? 'yes' : 'no'}`,
    inputs,
  });
}

export async function calculateAccountMaturityScore(accountId: number): Promise<void> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const inputs: Record<string, unknown> = {};
  let score = 0;

  const [contactCount] = await db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(eq(contacts.subAccountId, accountId));
  inputs.contacts = contactCount?.count ?? 0;
  score += Math.min((contactCount?.count ?? 0) * 2, 15);

  const [siteCount] = await db.select({ count: sql<number>`count(*)::int` }).from(savedSites);
  inputs.sites = siteCount?.count ?? 0;
  score += (siteCount?.count ?? 0) > 0 ? 10 : 0;

  const [domainCount] = await db.select({ count: sql<number>`count(*)::int` }).from(domains).where(eq(domains.subAccountId, accountId));
  inputs.domains = domainCount?.count ?? 0;
  score += (domainCount?.count ?? 0) > 0 ? 10 : 0;

  const [dealCount] = await db.select({ count: sql<number>`count(*)::int` }).from(deals).where(eq(deals.subAccountId, accountId));
  inputs.deals = dealCount?.count ?? 0;
  score += Math.min((dealCount?.count ?? 0) * 3, 15);

  const [automationCount] = await db.select({ count: sql<number>`count(*)::int` }).from(liveAutomations).where(eq(liveAutomations.subAccountId, accountId));
  inputs.automations = automationCount?.count ?? 0;
  score += (automationCount?.count ?? 0) > 0 ? 15 : 0;

  const [eventCount] = await db.select({ count: sql<number>`count(*)::int` }).from(universalEvents)
    .where(and(eq(universalEvents.subAccountId, accountId), gte(universalEvents.occurredAt, thirtyDaysAgo)));
  inputs.recentEvents = eventCount?.count ?? 0;
  score += Math.min((eventCount?.count ?? 0), 20);

  const healthRows = await storage.getIntegrationHealth(accountId);
  const healthyCount = healthRows.filter(h => h.status === "healthy").length;
  inputs.healthyIntegrations = healthyCount;
  score += Math.min(healthyCount * 5, 15);

  score = Math.min(score, 100);

  await upsertAndEmitScore({
    accountId,
    entityType: "account",
    entityId: String(accountId),
    scoreType: "account_maturity_score",
    scoreValue: score,
    scoreBand: getBand(score),
    explanation: `Contacts: ${inputs.contacts}, Sites: ${inputs.sites}, Domains: ${inputs.domains}, Deals: ${inputs.deals}, Automations: ${inputs.automations}, Events(30d): ${inputs.recentEvents}, Healthy integrations: ${healthyCount}`,
    inputs,
  });
}

export async function calculateLaunchReadinessScore(accountId: number): Promise<void> {
  const inputs: Record<string, unknown> = {};
  let score = 0;

  const [siteCount] = await db.select({ count: sql<number>`count(*)::int` }).from(savedSites)
    .where(sql`${savedSites.publishedUrl} IS NOT NULL`);
  inputs.publishedSites = siteCount?.count ?? 0;
  score += (siteCount?.count ?? 0) > 0 ? 20 : 0;

  const [verifiedDomains] = await db.select({ count: sql<number>`count(*)::int` }).from(domains)
    .where(and(eq(domains.subAccountId, accountId), eq(domains.status, "verified")));
  inputs.verifiedDomains = verifiedDomains?.count ?? 0;
  score += (verifiedDomains?.count ?? 0) > 0 ? 15 : 0;

  const [contactCount] = await db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(eq(contacts.subAccountId, accountId));
  inputs.contacts = contactCount?.count ?? 0;
  score += (contactCount?.count ?? 0) >= 5 ? 15 : (contactCount?.count ?? 0) > 0 ? 10 : 0;

  const [autoCount] = await db.select({ count: sql<number>`count(*)::int` }).from(liveAutomations)
    .where(and(eq(liveAutomations.subAccountId, accountId), eq(liveAutomations.status, "compiled")));
  inputs.activeAutomations = autoCount?.count ?? 0;
  score += (autoCount?.count ?? 0) > 0 ? 20 : 0;

  const healthRows = await storage.getIntegrationHealth(accountId);
  const totalIntegrations = healthRows.length;
  const healthyIntegrations = healthRows.filter(h => h.status === "healthy").length;
  inputs.totalIntegrations = totalIntegrations;
  inputs.healthyIntegrations = healthyIntegrations;
  score += totalIntegrations > 0 ? Math.round((healthyIntegrations / totalIntegrations) * 15) : 0;

  const [dealCount] = await db.select({ count: sql<number>`count(*)::int` }).from(deals).where(eq(deals.subAccountId, accountId));
  inputs.deals = dealCount?.count ?? 0;
  score += (dealCount?.count ?? 0) > 0 ? 15 : 0;

  score = Math.min(score, 100);

  await upsertAndEmitScore({
    accountId,
    entityType: "account",
    entityId: String(accountId),
    scoreType: "launch_readiness_score",
    scoreValue: score,
    scoreBand: getBand(score),
    explanation: `Published sites: ${inputs.publishedSites}, Verified domains: ${inputs.verifiedDomains}, Contacts: ${inputs.contacts}, Active automations: ${inputs.activeAutomations}, Healthy integrations: ${healthyIntegrations}/${totalIntegrations}, Deals: ${inputs.deals}`,
    inputs,
  });
}

export async function calculateWorkflowEffectivenessScore(accountId: number): Promise<void> {
  const inputs: Record<string, unknown> = {};
  let score = 0;

  const allWorkflows = await db.select().from(workflows).where(eq(workflows.subAccountId, accountId));
  inputs.totalWorkflows = allWorkflows.length;

  if (allWorkflows.length === 0) {
    await upsertAndEmitScore({
      accountId,
      entityType: "account",
      entityId: String(accountId),
      scoreType: "workflow_effectiveness_score",
      scoreValue: 0,
      scoreBand: "critical",
      explanation: "No workflows configured. Workflows automate follow-ups and save significant time.",
      inputs,
    });
    return;
  }

  score += Math.min(allWorkflows.length * 10, 30);

  const workflowsWithSteps = allWorkflows.filter(w => {
    const steps = Array.isArray(w.steps) ? w.steps as any[] : [];
    return steps.length >= 2;
  });
  inputs.workflowsWithMultipleSteps = workflowsWithSteps.length;
  score += workflowsWithSteps.length > 0 ? 20 : 0;

  const workflowsWithAI = allWorkflows.filter(w => {
    const steps = Array.isArray(w.steps) ? w.steps as any[] : [];
    return steps.some((s: any) => s.type === "AI_REPLY" || s.type === "ai_reply");
  });
  inputs.workflowsWithAI = workflowsWithAI.length;
  score += workflowsWithAI.length > 0 ? 25 : 0;

  const triggerTypes = new Set(allWorkflows.map(w => w.trigger));
  inputs.uniqueTriggerTypes = triggerTypes.size;
  score += Math.min(triggerTypes.size * 10, 25);

  score = Math.min(score, 100);

  await upsertAndEmitScore({
    accountId,
    entityType: "account",
    entityId: String(accountId),
    scoreType: "workflow_effectiveness_score",
    scoreValue: score,
    scoreBand: getBand(score),
    explanation: `Total workflows: ${allWorkflows.length}, Multi-step: ${workflowsWithSteps.length}, AI-powered: ${workflowsWithAI.length}, Trigger types: ${triggerTypes.size}`,
    inputs,
  });
}

export async function calculateCampaignEffectivenessScore(accountId: number): Promise<void> {
  const inputs: Record<string, unknown> = {};
  let score = 0;

  const campaigns = await db.select().from(emailCampaigns).where(eq(emailCampaigns.subAccountId, accountId));
  inputs.totalCampaigns = campaigns.length;

  if (campaigns.length === 0) {
    await upsertAndEmitScore({
      accountId,
      entityType: "account",
      entityId: String(accountId),
      scoreType: "campaign_effectiveness_score",
      scoreValue: 5,
      scoreBand: "critical",
      explanation: "No email campaigns created. Campaigns are essential for nurturing and converting leads.",
      inputs,
    });
    return;
  }

  const sentCampaigns = campaigns.filter(c => c.status === "sent" || c.status === "active");
  inputs.sentCampaigns = sentCampaigns.length;
  score += Math.min(sentCampaigns.length * 15, 30);

  const totalSent = sentCampaigns.reduce((s, c) => s + (c.sentCount || 0), 0);
  const totalOpened = sentCampaigns.reduce((s, c) => s + (c.openCount || 0), 0);
  const totalClicked = sentCampaigns.reduce((s, c) => s + (c.clickCount || 0), 0);
  const openRate = totalSent > 0 ? totalOpened / totalSent : 0;
  const clickRate = totalSent > 0 ? totalClicked / totalSent : 0;
  inputs.openRate = Math.round(openRate * 100);
  inputs.clickRate = Math.round(clickRate * 100);
  inputs.totalSent = totalSent;

  score += openRate > 0.25 ? 30 : openRate > 0.15 ? 20 : openRate > 0.05 ? 10 : 0;
  score += clickRate > 0.05 ? 25 : clickRate > 0.02 ? 15 : clickRate > 0 ? 5 : 0;
  score += Math.min(campaigns.length * 5, 15);

  score = Math.min(score, 100);

  await upsertAndEmitScore({
    accountId,
    entityType: "account",
    entityId: String(accountId),
    scoreType: "campaign_effectiveness_score",
    scoreValue: score,
    scoreBand: getBand(score),
    explanation: `Campaigns: ${campaigns.length} (${sentCampaigns.length} sent), Open rate: ${inputs.openRate}%, Click rate: ${inputs.clickRate}%, Total sent: ${totalSent}`,
    inputs,
  });
}

export async function calculatePipelineHealthScore(accountId: number): Promise<void> {
  const inputs: Record<string, unknown> = {};
  let score = 0;

  const allDeals = await db.select().from(deals).where(eq(deals.subAccountId, accountId));
  inputs.totalDeals = allDeals.length;

  if (allDeals.length === 0) {
    await upsertAndEmitScore({
      accountId,
      entityType: "account",
      entityId: String(accountId),
      scoreType: "pipeline_health_score",
      scoreValue: 5,
      scoreBand: "critical",
      explanation: "No deals in pipeline. Add deals to track revenue and conversion progress.",
      inputs,
    });
    return;
  }

  const openDeals = allDeals.filter(d => d.status === "open");
  const wonDeals = allDeals.filter(d => d.status === "won");
  const lostDeals = allDeals.filter(d => d.status === "lost");
  const convRate = allDeals.length > 0 ? wonDeals.length / allDeals.length : 0;
  const pipelineValue = openDeals.reduce((s, d) => s + (d.value || 0), 0);
  const wonRevenue = wonDeals.reduce((s, d) => s + (d.value || 0), 0);

  inputs.openDeals = openDeals.length;
  inputs.wonDeals = wonDeals.length;
  inputs.lostDeals = lostDeals.length;
  inputs.conversionRate = Math.round(convRate * 100);
  inputs.pipelineValue = pipelineValue;
  inputs.wonRevenue = wonRevenue;

  score += openDeals.length > 0 ? Math.min(openDeals.length * 5, 25) : 0;
  score += convRate > 0.3 ? 35 : convRate > 0.15 ? 25 : convRate > 0.05 ? 15 : convRate > 0 ? 5 : 0;
  score += wonRevenue > 10000 ? 25 : wonRevenue > 1000 ? 15 : wonRevenue > 0 ? 10 : 0;
  score += pipelineValue > 0 ? 15 : 0;

  score = Math.min(score, 100);

  await upsertAndEmitScore({
    accountId,
    entityType: "account",
    entityId: String(accountId),
    scoreType: "pipeline_health_score",
    scoreValue: score,
    scoreBand: getBand(score),
    explanation: `Open: ${openDeals.length}, Won: ${wonDeals.length}, Lost: ${lostDeals.length}, Conv rate: ${inputs.conversionRate}%, Pipeline value: $${pipelineValue.toFixed(0)}, Won revenue: $${wonRevenue.toFixed(0)}`,
    inputs,
  });
}

export async function calculateMessagingPerformanceScore(accountId: number): Promise<void> {
  const inputs: Record<string, unknown> = {};
  let score = 0;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const allMessages = await db.select().from(messages)
    .where(and(eq(messages.subAccountId, accountId), gte(messages.createdAt, thirtyDaysAgo)));

  const inbound = allMessages.filter(m => m.direction === "inbound");
  const outbound = allMessages.filter(m => m.direction === "outbound");
  const delivered = outbound.filter(m => m.status === "delivered" || m.status === "sent");

  inputs.totalMessages = allMessages.length;
  inputs.inbound = inbound.length;
  inputs.outbound = outbound.length;
  inputs.deliveryRate = outbound.length > 0 ? Math.round((delivered.length / outbound.length) * 100) : 0;

  const responseTimes: number[] = [];
  for (const msg of inbound.slice(0, 50)) {
    const inboundTime = new Date(msg.createdAt).getTime();
    const reply = allMessages.find(m =>
      m.direction === "outbound" &&
      m.contactPhone === msg.contactPhone &&
      new Date(m.createdAt).getTime() > inboundTime &&
      new Date(m.createdAt).getTime() < inboundTime + 3600000
    );
    if (reply) {
      responseTimes.push(new Date(reply.createdAt).getTime() - inboundTime);
    }
  }

  const avgResponseMs = responseTimes.length > 0
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : null;
  inputs.avgResponseMinutes = avgResponseMs ? Math.round(avgResponseMs / 60000) : null;
  inputs.responseRate = inbound.length > 0 ? Math.round((responseTimes.length / inbound.length) * 100) : 0;

  score += allMessages.length > 50 ? 20 : allMessages.length > 10 ? 15 : allMessages.length > 0 ? 10 : 0;
  score += (inputs.deliveryRate as number) > 90 ? 25 : (inputs.deliveryRate as number) > 70 ? 15 : (inputs.deliveryRate as number) > 0 ? 5 : 0;
  score += (inputs.responseRate as number) > 70 ? 25 : (inputs.responseRate as number) > 40 ? 15 : (inputs.responseRate as number) > 0 ? 5 : 0;
  score += avgResponseMs !== null ? (avgResponseMs < 300000 ? 30 : avgResponseMs < 1800000 ? 20 : avgResponseMs < 3600000 ? 10 : 5) : 0;

  score = Math.min(score, 100);

  await upsertAndEmitScore({
    accountId,
    entityType: "account",
    entityId: String(accountId),
    scoreType: "messaging_performance_score",
    scoreValue: score,
    scoreBand: getBand(score),
    explanation: `Messages(30d): ${allMessages.length}, Delivery rate: ${inputs.deliveryRate}%, Response rate: ${inputs.responseRate}%, Avg response: ${inputs.avgResponseMinutes !== null ? inputs.avgResponseMinutes + 'min' : 'N/A'}`,
    inputs,
  });
}

export async function calculateReputationHealthScore(accountId: number): Promise<void> {
  const inputs: Record<string, unknown> = {};
  let score = 0;

  const allReviews = await db.select().from(reviews).where(eq(reviews.subAccountId, accountId));
  inputs.totalReviews = allReviews.length;

  if (allReviews.length === 0) {
    await upsertAndEmitScore({
      accountId,
      entityType: "account",
      entityId: String(accountId),
      scoreType: "reputation_health_score",
      scoreValue: 10,
      scoreBand: "critical",
      explanation: "No reviews collected. Reputation is critical for trust and conversion — start gathering reviews.",
      inputs,
    });
    return;
  }

  const avgRating = allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length;
  const fiveStarCount = allReviews.filter(r => r.rating === 5).length;
  const oneStarCount = allReviews.filter(r => r.rating === 1).length;
  const respondedCount = allReviews.filter(r => r.aiResponse || r.isPublic).length;

  inputs.avgRating = Math.round(avgRating * 10) / 10;
  inputs.fiveStarCount = fiveStarCount;
  inputs.oneStarCount = oneStarCount;
  inputs.respondedCount = respondedCount;
  inputs.responseRate = Math.round((respondedCount / allReviews.length) * 100);

  score += avgRating >= 4.5 ? 40 : avgRating >= 4.0 ? 30 : avgRating >= 3.5 ? 20 : avgRating >= 3.0 ? 10 : 5;
  score += Math.min(allReviews.length * 3, 25);
  score += (inputs.responseRate as number) > 60 ? 20 : (inputs.responseRate as number) > 30 ? 10 : 0;
  score += oneStarCount === 0 ? 15 : oneStarCount <= 2 ? 10 : 0;

  score = Math.min(score, 100);

  await upsertAndEmitScore({
    accountId,
    entityType: "account",
    entityId: String(accountId),
    scoreType: "reputation_health_score",
    scoreValue: score,
    scoreBand: getBand(score),
    explanation: `Reviews: ${allReviews.length}, Avg rating: ${inputs.avgRating}/5, 5-star: ${fiveStarCount}, Response rate: ${inputs.responseRate}%`,
    inputs,
  });
}

export async function calculateCalendarConversionScore(accountId: number): Promise<void> {
  const inputs: Record<string, unknown> = {};
  let score = 0;

  const allAppts = await db.select().from(appointments).where(eq(appointments.subAccountId, accountId));
  inputs.totalAppointments = allAppts.length;

  if (allAppts.length === 0) {
    await upsertAndEmitScore({
      accountId,
      entityType: "account",
      entityId: String(accountId),
      scoreType: "calendar_conversion_score",
      scoreValue: 5,
      scoreBand: "critical",
      explanation: "No appointments scheduled. Calendar bookings are a key conversion metric.",
      inputs,
    });
    return;
  }

  const completed = allAppts.filter(a => a.status === "completed" || a.status === "done");
  const scheduled = allAppts.filter(a => a.status === "scheduled");
  const cancelled = allAppts.filter(a => a.status === "cancelled" || a.status === "no_show");
  const completionRate = allAppts.length > 0 ? completed.length / allAppts.length : 0;
  const cancellationRate = allAppts.length > 0 ? cancelled.length / allAppts.length : 0;
  const linkedToContact = allAppts.filter(a => a.contactId).length;

  inputs.completed = completed.length;
  inputs.scheduled = scheduled.length;
  inputs.cancelled = cancelled.length;
  inputs.completionRate = Math.round(completionRate * 100);
  inputs.cancellationRate = Math.round(cancellationRate * 100);
  inputs.linkedToContact = linkedToContact;

  score += allAppts.length > 20 ? 25 : allAppts.length > 5 ? 15 : allAppts.length > 0 ? 10 : 0;
  score += completionRate > 0.7 ? 35 : completionRate > 0.5 ? 25 : completionRate > 0.3 ? 15 : completionRate > 0 ? 5 : 0;
  score += cancellationRate < 0.1 ? 20 : cancellationRate < 0.2 ? 15 : cancellationRate < 0.3 ? 10 : 5;
  score += linkedToContact > 0 ? 20 : 0;

  score = Math.min(score, 100);

  await upsertAndEmitScore({
    accountId,
    entityType: "account",
    entityId: String(accountId),
    scoreType: "calendar_conversion_score",
    scoreValue: score,
    scoreBand: getBand(score),
    explanation: `Appointments: ${allAppts.length}, Completion rate: ${inputs.completionRate}%, Cancellation rate: ${inputs.cancellationRate}%, Linked to contacts: ${linkedToContact}`,
    inputs,
  });
}

export async function calculateDigitalCardEffectivenessScore(accountId: number): Promise<void> {
  const inputs: Record<string, unknown> = {};
  let score = 0;

  const cards = await db.select().from(digitalCards).where(eq(digitalCards.subAccountId, accountId));
  inputs.totalCards = cards.length;

  if (cards.length === 0) {
    await upsertAndEmitScore({
      accountId,
      entityType: "account",
      entityId: String(accountId),
      scoreType: "digital_card_effectiveness_score",
      scoreValue: 0,
      scoreBand: "critical",
      explanation: "No digital cards created. Digital cards drive lead capture and social sharing.",
      inputs,
    });
    return;
  }

  const activeCards = cards.filter(c => c.isActive && c.status === "published");
  const totalViews = cards.reduce((s, c) => s + (c.viewCount || 0), 0);
  const totalSaves = cards.reduce((s, c) => s + (c.saveContactCount || 0), 0);
  const totalShares = cards.reduce((s, c) => s + (c.shareCount || 0), 0);
  const cardsWithLeadCapture = cards.filter(c => c.leadCaptureEnabled).length;
  const saveRate = totalViews > 0 ? totalSaves / totalViews : 0;

  inputs.activeCards = activeCards.length;
  inputs.totalViews = totalViews;
  inputs.totalSaves = totalSaves;
  inputs.totalShares = totalShares;
  inputs.cardsWithLeadCapture = cardsWithLeadCapture;
  inputs.saveRate = Math.round(saveRate * 100);

  score += activeCards.length > 0 ? 20 : 0;
  score += totalViews > 100 ? 20 : totalViews > 10 ? 15 : totalViews > 0 ? 5 : 0;
  score += saveRate > 0.1 ? 25 : saveRate > 0.05 ? 15 : saveRate > 0 ? 5 : 0;
  score += totalShares > 10 ? 20 : totalShares > 0 ? 10 : 0;
  score += cardsWithLeadCapture > 0 ? 15 : 0;

  score = Math.min(score, 100);

  await upsertAndEmitScore({
    accountId,
    entityType: "account",
    entityId: String(accountId),
    scoreType: "digital_card_effectiveness_score",
    scoreValue: score,
    scoreBand: getBand(score),
    explanation: `Cards: ${cards.length} (${activeCards.length} active), Views: ${totalViews}, Saves: ${totalSaves}, Shares: ${totalShares}, Save rate: ${inputs.saveRate}%, Lead capture: ${cardsWithLeadCapture > 0 ? 'yes' : 'no'}`,
    inputs,
  });
}

export async function calculateAdToLeadQualityScore(accountId: number): Promise<void> {
  const inputs: Record<string, unknown> = {};
  let score = 0;

  const adCampaigns = await db.select().from(metaAdCampaigns).where(eq(metaAdCampaigns.subAccountId, accountId));
  inputs.totalAdCampaigns = adCampaigns.length;

  if (adCampaigns.length === 0) {
    await upsertAndEmitScore({
      accountId,
      entityType: "account",
      entityId: String(accountId),
      scoreType: "ad_to_lead_quality_score",
      scoreValue: 0,
      scoreBand: "critical",
      explanation: "No ad campaigns configured. Meta Ads can be a powerful lead acquisition channel.",
      inputs,
    });
    return;
  }

  const activeCampaigns = adCampaigns.filter(c => c.status === "active" || c.status === "ACTIVE");
  const totalSpend = adCampaigns.reduce((s, c) => s + (c.totalSpend || 0), 0);
  const totalLeads = adCampaigns.reduce((s, c) => s + (c.leads || 0), 0);
  const totalClicks = adCampaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const totalImpressions = adCampaigns.reduce((s, c) => s + (c.impressions || 0), 0);
  const costPerLead = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

  inputs.activeCampaigns = activeCampaigns.length;
  inputs.totalSpend = Math.round(totalSpend * 100) / 100;
  inputs.totalLeads = totalLeads;
  inputs.costPerLead = Math.round(costPerLead * 100) / 100;
  inputs.ctr = Math.round(ctr * 10000) / 100;

  score += activeCampaigns.length > 0 ? 20 : 5;
  score += totalLeads > 50 ? 25 : totalLeads > 10 ? 15 : totalLeads > 0 ? 5 : 0;
  score += ctr > 0.03 ? 25 : ctr > 0.01 ? 15 : ctr > 0 ? 5 : 0;
  score += costPerLead < 20 && totalLeads > 0 ? 30 : costPerLead < 50 && totalLeads > 0 ? 20 : costPerLead < 100 && totalLeads > 0 ? 10 : 0;

  score = Math.min(score, 100);

  await upsertAndEmitScore({
    accountId,
    entityType: "account",
    entityId: String(accountId),
    scoreType: "ad_to_lead_quality_score",
    scoreValue: score,
    scoreBand: getBand(score),
    explanation: `Ad campaigns: ${adCampaigns.length} (${activeCampaigns.length} active), Leads: ${totalLeads}, Spend: $${inputs.totalSpend}, CPL: $${inputs.costPerLead}, CTR: ${inputs.ctr}%`,
    inputs,
  });
}

export async function calculateModuleAdoptionScore(accountId: number): Promise<void> {
  const inputs: Record<string, unknown> = {};
  let score = 0;
  const modulesUsed: string[] = [];

  const [contactCount] = await db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(eq(contacts.subAccountId, accountId));
  if ((contactCount?.count ?? 0) > 0) { modulesUsed.push("contacts"); score += 10; }
  inputs.hasContacts = (contactCount?.count ?? 0) > 0;

  const [workflowCount] = await db.select({ count: sql<number>`count(*)::int` }).from(workflows).where(eq(workflows.subAccountId, accountId));
  if ((workflowCount?.count ?? 0) > 0) { modulesUsed.push("workflows"); score += 10; }
  inputs.hasWorkflows = (workflowCount?.count ?? 0) > 0;

  const [campaignCount] = await db.select({ count: sql<number>`count(*)::int` }).from(emailCampaigns).where(eq(emailCampaigns.subAccountId, accountId));
  if ((campaignCount?.count ?? 0) > 0) { modulesUsed.push("campaigns"); score += 10; }
  inputs.hasCampaigns = (campaignCount?.count ?? 0) > 0;

  const [dealCount] = await db.select({ count: sql<number>`count(*)::int` }).from(deals).where(eq(deals.subAccountId, accountId));
  if ((dealCount?.count ?? 0) > 0) { modulesUsed.push("pipeline"); score += 10; }
  inputs.hasPipeline = (dealCount?.count ?? 0) > 0;

  const [apptCount] = await db.select({ count: sql<number>`count(*)::int` }).from(appointments).where(eq(appointments.subAccountId, accountId));
  if ((apptCount?.count ?? 0) > 0) { modulesUsed.push("calendar"); score += 10; }
  inputs.hasCalendar = (apptCount?.count ?? 0) > 0;

  const [reviewCount] = await db.select({ count: sql<number>`count(*)::int` }).from(reviews).where(eq(reviews.subAccountId, accountId));
  if ((reviewCount?.count ?? 0) > 0) { modulesUsed.push("reviews"); score += 10; }
  inputs.hasReviews = (reviewCount?.count ?? 0) > 0;

  const [siteCount] = await db.select({ count: sql<number>`count(*)::int` }).from(savedSites);
  if ((siteCount?.count ?? 0) > 0) { modulesUsed.push("sites"); score += 10; }
  inputs.hasSites = (siteCount?.count ?? 0) > 0;

  const [cardCount] = await db.select({ count: sql<number>`count(*)::int` }).from(digitalCards).where(eq(digitalCards.subAccountId, accountId));
  if ((cardCount?.count ?? 0) > 0) { modulesUsed.push("digital_cards"); score += 10; }
  inputs.hasDigitalCards = (cardCount?.count ?? 0) > 0;

  const [adCount] = await db.select({ count: sql<number>`count(*)::int` }).from(metaAdCampaigns).where(eq(metaAdCampaigns.subAccountId, accountId));
  if ((adCount?.count ?? 0) > 0) { modulesUsed.push("ads"); score += 10; }
  inputs.hasAds = (adCount?.count ?? 0) > 0;

  const [msgCount] = await db.select({ count: sql<number>`count(*)::int` }).from(messages).where(eq(messages.subAccountId, accountId));
  if ((msgCount?.count ?? 0) > 0) { modulesUsed.push("inbox"); score += 10; }
  inputs.hasMessages = (msgCount?.count ?? 0) > 0;

  inputs.modulesUsed = modulesUsed;
  inputs.moduleCount = modulesUsed.length;

  await upsertAndEmitScore({
    accountId,
    entityType: "account",
    entityId: String(accountId),
    scoreType: "module_adoption_score",
    scoreValue: score,
    scoreBand: getBand(score),
    explanation: `Using ${modulesUsed.length}/10 modules: ${modulesUsed.join(", ") || "none"}`,
    inputs,
  });
}

export async function calculateIntegrationHealthScore(accountId: number): Promise<void> {
  const inputs: Record<string, unknown> = {};
  let score = 0;

  const healthRows = await storage.getIntegrationHealth(accountId);
  inputs.totalIntegrations = healthRows.length;

  if (healthRows.length === 0) {
    await upsertAndEmitScore({
      accountId,
      entityType: "account",
      entityId: String(accountId),
      scoreType: "integration_health_score",
      scoreValue: 5,
      scoreBand: "critical",
      explanation: "No integrations configured. Integrations connect your tools and automate data flow.",
      inputs,
    });
    return;
  }

  const healthy = healthRows.filter(h => h.status === "healthy");
  const degraded = healthRows.filter(h => h.status === "degraded");
  const errored = healthRows.filter(h => h.status === "error" || h.status === "disconnected");
  const healthRate = healthRows.length > 0 ? healthy.length / healthRows.length : 0;

  inputs.healthy = healthy.length;
  inputs.degraded = degraded.length;
  inputs.errored = errored.length;
  inputs.healthRate = Math.round(healthRate * 100);

  score += Math.min(healthRows.length * 10, 20);
  score += healthRate > 0.9 ? 50 : healthRate > 0.7 ? 35 : healthRate > 0.5 ? 20 : healthRate > 0 ? 10 : 0;
  score += errored.length === 0 ? 30 : errored.length <= 1 ? 15 : 0;

  score = Math.min(score, 100);

  await upsertAndEmitScore({
    accountId,
    entityType: "account",
    entityId: String(accountId),
    scoreType: "integration_health_score",
    scoreValue: score,
    scoreBand: getBand(score),
    explanation: `Integrations: ${healthRows.length} total, ${healthy.length} healthy, ${degraded.length} degraded, ${errored.length} errored`,
    inputs,
  });
}

export async function runAllScoresForAccount(accountId: number): Promise<void> {
  console.log(`[APEX-INTEL] Scoring account ${accountId}...`);
  try {
    await Promise.allSettled([
      calculateAccountMaturityScore(accountId),
      calculateLaunchReadinessScore(accountId),
      calculateWorkflowEffectivenessScore(accountId),
      calculateCampaignEffectivenessScore(accountId),
      calculatePipelineHealthScore(accountId),
      calculateMessagingPerformanceScore(accountId),
      calculateReputationHealthScore(accountId),
      calculateCalendarConversionScore(accountId),
      calculateDigitalCardEffectivenessScore(accountId),
      calculateAdToLeadQualityScore(accountId),
      calculateModuleAdoptionScore(accountId),
      calculateIntegrationHealthScore(accountId),
    ]);

    const siteRows = await db.select({ id: savedSites.id }).from(savedSites);
    for (const site of siteRows) {
      await calculateSiteHealthScore(accountId, site.id);
    }

    const domainRows = await db.select({ id: domains.id }).from(domains).where(eq(domains.subAccountId, accountId));
    for (const domain of domainRows) {
      await calculateDomainHealthScore(accountId, domain.id);
    }

    const contactRows = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.subAccountId, accountId)).limit(100);
    for (const contact of contactRows) {
      await calculateLeadIntentScore(accountId, contact.id);
    }

    console.log(`[APEX-INTEL] Scoring complete for account ${accountId}`);
  } catch (err) {
    console.error(`[APEX-INTEL] Scoring failed for account ${accountId}:`, (err as Error).message);
  }
}
