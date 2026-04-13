import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and, gte, count as drizzleCount } from "drizzle-orm";
import {
  universalEvents, contacts, savedSites, domains, workflows, liveAutomations,
  deals, emailCampaigns, digitalCards, integrationHealthState
} from "@shared/schema";

type ScoreBand = "critical" | "low" | "medium" | "high" | "excellent";

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

  await storage.upsertIntelligenceScore({
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

  const hasContent = site.htmlContent && (site.htmlContent as string).length > 500;
  inputs.hasContent = hasContent;
  score += hasContent ? 25 : 0;

  const hasDomain = !!site.customDomain;
  inputs.hasDomain = hasDomain;
  score += hasDomain ? 20 : 0;

  const isPublished = site.isPublished;
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

  await storage.upsertIntelligenceScore({
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

  await storage.upsertIntelligenceScore({
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

  const [siteCount] = await db.select({ count: sql<number>`count(*)::int` }).from(savedSites).where(eq(savedSites.subAccountId, accountId));
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

  await storage.upsertIntelligenceScore({
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
    .where(and(eq(savedSites.subAccountId, accountId), eq(savedSites.isPublished, true)));
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
    .where(and(eq(liveAutomations.subAccountId, accountId), eq(liveAutomations.active, true)));
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

  await storage.upsertIntelligenceScore({
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

export async function runAllScoresForAccount(accountId: number): Promise<void> {
  console.log(`[APEX-INTEL] Scoring account ${accountId}...`);
  try {
    await calculateAccountMaturityScore(accountId);
    await calculateLaunchReadinessScore(accountId);

    const siteRows = await db.select({ id: savedSites.id }).from(savedSites).where(eq(savedSites.subAccountId, accountId));
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

    console.log(`[APEX-INTEL] Scoring complete for account ${accountId}: ${siteRows.length} sites, ${domainRows.length} domains, ${contactRows.length} contacts`);
  } catch (err) {
    console.error(`[APEX-INTEL] Scoring failed for account ${accountId}:`, (err as Error).message);
  }
}
