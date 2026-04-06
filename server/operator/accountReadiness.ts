import { db } from "../db";
import { subAccounts, agentConfig, liveAutomations, messages } from "@shared/schema";
import { eq, and, inArray, gte, count, sql } from "drizzle-orm";

export interface AccountReadiness {
  phase: "not_setup" | "setup_inactive" | "active_measurable";
  ready: boolean;
  reasons: string[];
  cta?: { label: string; link: string };
}

const MIN_OUTBOUND_MESSAGES = 5;
const MIN_HOURS_SINCE_FIRST_OUTBOUND = 72;

export async function checkAccountReadiness(subAccountId: number): Promise<AccountReadiness> {
  const reasons: string[] = [];

  const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId)).execute();
  if (!account) {
    return { phase: "not_setup", ready: false, reasons: ["Account not found"], cta: { label: "Connect Channel", link: "/integrations" } };
  }

  const hasChannel =
    (!!account.twilioNumber && account.twilioNumber.trim().length > 0) ||
    (!!account.metaPageId && account.metaPageId.trim().length > 0 && !!account.metaAccessToken && account.metaAccessToken.trim().length > 0);

  if (!hasChannel) {
    reasons.push("No channel connected (no Twilio number, no Meta page)");
  }

  const agentRows = await db.select().from(agentConfig).where(and(eq(agentConfig.subAccountId, subAccountId), eq(agentConfig.enabled, true))).execute();
  const hasAgentEnabled = agentRows.length > 0;

  const automationRows = await db.select().from(liveAutomations).where(eq(liveAutomations.subAccountId, subAccountId)).execute();
  const hasCompiledWorkflow = automationRows.some(a => a.status === "compiled");
  const hasAgentOrAutomation = hasAgentEnabled || automationRows.length > 0;

  if (!hasAgentOrAutomation) {
    reasons.push("No agent or automation configured for this account");
  }

  if (!hasChannel || !hasAgentOrAutomation) {
    return {
      phase: "not_setup",
      ready: false,
      reasons,
      cta: { label: "Connect Channel", link: "/integrations" },
    };
  }

  if (!hasAgentEnabled && !hasCompiledWorkflow) {
    reasons.push("Agent is not enabled and no compiled automation workflow is active");
    return {
      phase: "setup_inactive",
      ready: false,
      reasons,
      cta: { label: "View Automations", link: "/workflows" },
    };
  }

  const successStatuses = ["sent", "delivered"];
  const [outboundCountResult] = await db
    .select({ count: count() })
    .from(messages)
    .where(
      and(
        eq(messages.subAccountId, subAccountId),
        eq(messages.direction, "outbound"),
        inArray(messages.status, successStatuses)
      )
    )
    .execute();

  const outboundCount = outboundCountResult?.count ?? 0;

  if (outboundCount === 0) {
    reasons.push("No outbound replies have been successfully sent");
    return {
      phase: "setup_inactive",
      ready: false,
      reasons,
      cta: { label: "View Automations", link: "/workflows" },
    };
  }

  if (outboundCount < MIN_OUTBOUND_MESSAGES) {
    reasons.push(`Only ${outboundCount} outbound messages sent (minimum ${MIN_OUTBOUND_MESSAGES} required)`);
    return {
      phase: "setup_inactive",
      ready: false,
      reasons,
      cta: { label: "View Automations", link: "/workflows" },
    };
  }

  const [earliestResult] = await db
    .select({ earliest: sql<Date>`MIN(${messages.createdAt})` })
    .from(messages)
    .where(
      and(
        eq(messages.subAccountId, subAccountId),
        eq(messages.direction, "outbound"),
        inArray(messages.status, successStatuses)
      )
    )
    .execute();

  const earliestDate = earliestResult?.earliest;
  if (!earliestDate) {
    reasons.push("Cannot determine earliest outbound message timestamp");
    return {
      phase: "setup_inactive",
      ready: false,
      reasons,
      cta: { label: "View Automations", link: "/workflows" },
    };
  }

  const hoursElapsed = (Date.now() - new Date(earliestDate).getTime()) / (1000 * 60 * 60);
  if (hoursElapsed < MIN_HOURS_SINCE_FIRST_OUTBOUND) {
    reasons.push(`Earliest outbound message is only ${Math.round(hoursElapsed)} hours old (minimum ${MIN_HOURS_SINCE_FIRST_OUTBOUND} hours required)`);
    return {
      phase: "setup_inactive",
      ready: false,
      reasons,
      cta: { label: "View Automations", link: "/workflows" },
    };
  }

  return { phase: "active_measurable", ready: true, reasons: [] };
}
