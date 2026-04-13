import { db } from "../db";
import { sql, eq, and, gte, desc } from "drizzle-orm";
import {
  integrationConnections,
  workflows,
  domains,
  emailCampaigns,
  timelineEvents,
} from "@shared/schema";

export type FakeCompletionSeverity = "critical" | "warning" | "info";

export interface FakeCompletionAlert {
  id: string;
  category: "integration" | "site" | "workflow" | "domain" | "campaign";
  entityId: string | number;
  entityName: string;
  issue: string;
  detail: string;
  severity: FakeCompletionSeverity;
  claimedState: string;
  actualState: string;
  suggestedFix?: string;
  detectedAt: string;
}

export interface FakeCompletionReport {
  accountId: number;
  alerts: FakeCompletionAlert[];
  totalAlerts: number;
  criticalCount: number;
  warningCount: number;
  checkedAt: string;
}

async function checkIntegrations(accountId: number): Promise<FakeCompletionAlert[]> {
  const alerts: FakeCompletionAlert[] = [];

  const connections = await db.select()
    .from(integrationConnections)
    .where(and(
      eq(integrationConnections.subAccountId, accountId),
      eq(integrationConnections.status, "connected"),
    ));

  for (const conn of connections) {
    let isHealthy = false;
    let errorDetail = "Health check not available";

    try {
      const config = conn.config as Record<string, any> || {};

      if (conn.provider === "twilio") {
        if (config.accountSid && config.authToken) {
          const r = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}.json`,
            {
              headers: { Authorization: "Basic " + Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64") },
              signal: AbortSignal.timeout(5000),
            }
          );
          isHealthy = r.ok;
          if (!r.ok) errorDetail = `HTTP ${r.status} from Twilio API`;
        } else {
          errorDetail = "Missing credentials in stored config";
        }
      } else if (conn.provider === "mailchimp") {
        if (config.apiKey) {
          const dc = config.serverPrefix || config.apiKey.split("-").pop();
          const r = await fetch(`https://${dc}.api.mailchimp.com/3.0/ping`, {
            headers: { Authorization: "Basic " + Buffer.from(`anystring:${config.apiKey}`).toString("base64") },
            signal: AbortSignal.timeout(5000),
          });
          isHealthy = r.ok;
          if (!r.ok) errorDetail = `HTTP ${r.status} from Mailchimp API`;
        } else {
          isHealthy = true;
        }
      } else if (conn.provider === "shopify") {
        if (config.storeDomain && config.accessToken) {
          const domain = config.storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
          const r = await fetch(`https://${domain}/admin/api/2024-01/shop.json`, {
            headers: { "X-Shopify-Access-Token": config.accessToken },
            signal: AbortSignal.timeout(5000),
          });
          isHealthy = r.ok;
          if (!r.ok) errorDetail = `HTTP ${r.status} from Shopify API`;
        } else {
          isHealthy = true;
        }
      } else if (conn.provider === "elevenlabs") {
        if (config.apiKey) {
          const r = await fetch("https://api.elevenlabs.io/v1/user", {
            headers: { "xi-api-key": config.apiKey },
            signal: AbortSignal.timeout(5000),
          });
          isHealthy = r.ok;
          if (!r.ok) errorDetail = `HTTP ${r.status} from ElevenLabs API`;
        } else {
          isHealthy = true;
        }
      } else {
        isHealthy = true;
      }
    } catch (err: any) {
      errorDetail = err.message || "Connection failed";
    }

    if (!isHealthy) {
      alerts.push({
        id: `integration:${accountId}:${conn.provider}`,
        category: "integration",
        entityId: conn.id,
        entityName: conn.provider,
        issue: "Integration marked connected but health check failed",
        detail: errorDetail,
        severity: "critical",
        claimedState: "connected",
        actualState: "unreachable",
        suggestedFix: `Re-authenticate or update credentials for ${conn.provider}`,
        detectedAt: new Date().toISOString(),
      });
    }
  }

  return alerts;
}

async function checkActiveWorkflows(accountId: number): Promise<FakeCompletionAlert[]> {
  const alerts: FakeCompletionAlert[] = [];

  const wfs = await db.select()
    .from(workflows)
    .where(eq(workflows.subAccountId, accountId));

  for (const wf of wfs) {
    const steps = Array.isArray(wf.steps) ? wf.steps : [];
    if (steps.length === 0) {
      alerts.push({
        id: `workflow:${wf.id}:empty`,
        category: "workflow",
        entityId: wf.id,
        entityName: wf.name,
        issue: "Workflow has no steps configured",
        detail: `Workflow "${wf.name}" exists but has no action steps`,
        severity: "warning",
        claimedState: "active",
        actualState: "empty_workflow",
        suggestedFix: "Add at least one action step to the workflow",
        detectedAt: new Date().toISOString(),
      });
    }
  }

  return alerts;
}

async function checkVerifiedDomains(accountId: number): Promise<FakeCompletionAlert[]> {
  const alerts: FakeCompletionAlert[] = [];

  const domainRows = await db.select()
    .from(domains)
    .where(and(
      eq(domains.subAccountId, accountId),
      sql`${domains.verifiedAt} IS NOT NULL`,
    ));

  for (const dom of domainRows) {
    if (!dom.domainName) continue;

    if (!dom.dnsConfigured) {
      alerts.push({
        id: `domain:${dom.id}:dns_not_configured`,
        category: "domain",
        entityId: dom.id,
        entityName: dom.domainName,
        issue: "Verified domain has DNS not configured",
        detail: `Domain "${dom.domainName}" is marked verified but DNS is not configured`,
        severity: "warning",
        claimedState: "verified",
        actualState: "dns_not_configured",
        suggestedFix: "Configure DNS records for this domain in the domain settings",
        detectedAt: new Date().toISOString(),
      });
    }

    if (!dom.sslActive && dom.dnsConfigured) {
      alerts.push({
        id: `domain:${dom.id}:ssl_inactive`,
        category: "domain",
        entityId: dom.id,
        entityName: dom.domainName,
        issue: "Domain DNS is configured but SSL certificate is inactive",
        detail: `Domain "${dom.domainName}" has DNS configured but SSL is not active`,
        severity: "warning",
        claimedState: "dns_configured",
        actualState: "ssl_inactive",
        suggestedFix: "Wait for SSL certificate to provision, or check for DNS propagation issues",
        detectedAt: new Date().toISOString(),
      });
    }
  }

  return alerts;
}

async function checkActiveCampaigns(accountId: number): Promise<FakeCompletionAlert[]> {
  const alerts: FakeCompletionAlert[] = [];

  const campaigns = await db.select()
    .from(emailCampaigns)
    .where(eq(emailCampaigns.subAccountId, accountId));

  for (const campaign of campaigns) {
    if (campaign.status === "sent" && campaign.sentAt) {
      const sentAt = new Date(campaign.sentAt);
      const daysSinceSent = (Date.now() - sentAt.getTime()) / (1000 * 60 * 60 * 24);

      if ((campaign.recipientCount ?? 0) > 0 && (campaign.sentCount ?? 0) === 0 && daysSinceSent > 1) {
        alerts.push({
          id: `campaign:${campaign.id}:no_delivery`,
          category: "campaign",
          entityId: campaign.id,
          entityName: campaign.name,
          issue: "Campaign marked sent but no delivery records",
          detail: `Campaign "${campaign.name}" is marked as sent with ${campaign.recipientCount} recipients but 0 delivered`,
          severity: "critical",
          claimedState: "sent",
          actualState: "no_delivery_signal",
          suggestedFix: "Check email provider integration and sending configuration",
          detectedAt: new Date().toISOString(),
        });
      }
    }

    if (campaign.status === "sending" && campaign.sentAt) {
      const sentAt = new Date(campaign.sentAt);
      const hoursSinceSending = (Date.now() - sentAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceSending > 2) {
        alerts.push({
          id: `campaign:${campaign.id}:stuck_sending`,
          category: "campaign",
          entityId: campaign.id,
          entityName: campaign.name,
          issue: "Campaign stuck in 'sending' state",
          detail: `Campaign "${campaign.name}" has been in sending state for ${Math.round(hoursSinceSending)} hours`,
          severity: "warning",
          claimedState: "sending",
          actualState: "stuck",
          suggestedFix: "Check email provider for errors or retry the campaign",
          detectedAt: new Date().toISOString(),
        });
      }
    }

    if (campaign.status === "draft" && campaign.scheduledAt) {
      const scheduledAt = new Date(campaign.scheduledAt);
      if (scheduledAt < new Date()) {
        alerts.push({
          id: `campaign:${campaign.id}:missed_schedule`,
          category: "campaign",
          entityId: campaign.id,
          entityName: campaign.name,
          issue: "Campaign scheduled time has passed but it's still in draft",
          detail: `Campaign "${campaign.name}" was scheduled for ${scheduledAt.toLocaleDateString()} but was never sent`,
          severity: "warning",
          claimedState: "scheduled",
          actualState: "missed_schedule",
          suggestedFix: "Review campaign and reschedule or send manually",
          detectedAt: new Date().toISOString(),
        });
      }
    }
  }

  return alerts;
}

export async function runFakeCompletionDetection(accountId: number): Promise<FakeCompletionReport> {
  const [integrationAlerts, workflowAlerts, domainAlerts, campaignAlerts] = await Promise.allSettled([
    checkIntegrations(accountId),
    checkActiveWorkflows(accountId),
    checkVerifiedDomains(accountId),
    checkActiveCampaigns(accountId),
  ]);

  const allAlerts: FakeCompletionAlert[] = [];
  for (const result of [integrationAlerts, workflowAlerts, domainAlerts, campaignAlerts]) {
    if (result.status === "fulfilled") {
      allAlerts.push(...result.value);
    }
  }

  allAlerts.sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
  });

  return {
    accountId,
    alerts: allAlerts,
    totalAlerts: allAlerts.length,
    criticalCount: allAlerts.filter(a => a.severity === "critical").length,
    warningCount: allAlerts.filter(a => a.severity === "warning").length,
    checkedAt: new Date().toISOString(),
  };
}
