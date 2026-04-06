import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { workflows, messages, pipelineStages } from "@shared/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { asyncHandler, verifyAccountOwnership } from "./helpers";

export type AccountPhase = "not_setup" | "setup_inactive" | "active_measurable";

export interface ReadinessCondition {
  id: string;
  label: string;
  met: boolean;
  detail: string;
  fixCommand?: string;
  fixLabel?: string;
}

export interface AccountReadiness {
  phase: AccountPhase;
  phaseLabel: string;
  phaseDetail: string;
  conditions: ReadinessCondition[];
  benchmarkReady: boolean;
  intelligenceReady: boolean;
  metConditions: number;
  totalConditions: number;
}

const MIN_MESSAGE_THRESHOLD = 10;
const MIN_OUTBOUND_REPLIES = 3;
const MIN_TIME_WINDOW_DAYS = 3;

export async function computeAccountReadiness(subAccountId: number): Promise<AccountReadiness> {
  const [account, accountWorkflows, accountMessages, stages] = await Promise.all([
    storage.getSubAccount(subAccountId),
    db.select().from(workflows).where(eq(workflows.subAccountId, subAccountId)),
    storage.getMessages(subAccountId),
    db.select().from(pipelineStages).where(eq(pipelineStages.subAccountId, subAccountId)),
  ]);

  const config = (account?.aiPromptConfig as any) || {};
  const now = Date.now();
  const dayMs = 86400000;
  const windowStart = now - (MIN_TIME_WINDOW_DAYS * dayMs);

  const hasMetaPage = !!(account?.metaPageId);
  const hasMetaToken = !!(account?.metaAccessToken);
  const channelConnected = hasMetaPage && hasMetaToken;

  const autoReplyEnabled = !!config.autoReplyEnabled;

  const hasActiveWorkflow = accountWorkflows.some(w => {
    const steps = Array.isArray(w.steps) ? w.steps : [];
    return steps.some((s: any) => s.type === "AI_REPLY" || s.type === "SEND_MESSAGE" || s.type === "reply");
  });

  const outboundReplies = accountMessages.filter(
    m => m.direction === "outbound" && m.status === "sent" && new Date(m.createdAt).getTime() > windowStart
  );
  const outboundSuccessful = outboundReplies.length >= MIN_OUTBOUND_REPLIES;

  const totalMessages = accountMessages.filter(
    m => new Date(m.createdAt).getTime() > windowStart
  );
  const messageThresholdMet = totalMessages.length >= MIN_MESSAGE_THRESHOLD;

  const messageDates = accountMessages.map(m => new Date(m.createdAt).getTime()).sort();
  const oldestMessage = messageDates.length > 0 ? messageDates[0] : now;
  const newestMessage = messageDates.length > 0 ? messageDates[messageDates.length - 1] : now;
  const messageSpread = newestMessage - oldestMessage;
  const timeWindowMet = messageDates.length >= 2 && messageSpread >= (MIN_TIME_WINDOW_DAYS * dayMs);

  const conditions: ReadinessCondition[] = [
    {
      id: "channel_connected",
      label: "Channel connected",
      met: channelConnected,
      detail: channelConnected
        ? `Meta page ${account?.metaPageId} connected`
        : "No Meta page or access token configured",
      fixCommand: undefined,
      fixLabel: channelConnected ? undefined : "Connect Meta Page",
    },
    {
      id: "auto_reply_enabled",
      label: "Auto-reply enabled",
      met: autoReplyEnabled,
      detail: autoReplyEnabled
        ? "AI auto-reply is active"
        : "Auto-reply is not enabled",
      fixCommand: "fix-response-rate",
      fixLabel: autoReplyEnabled ? undefined : "Enable Auto-Reply",
    },
    {
      id: "workflow_active",
      label: "Reply workflow active",
      met: hasActiveWorkflow,
      detail: hasActiveWorkflow
        ? `${accountWorkflows.length} workflow(s) configured`
        : "No workflows configured",
      fixCommand: "fix-response-rate",
      fixLabel: hasActiveWorkflow ? undefined : "Activate Workflow",
    },
    {
      id: "outbound_replies",
      label: `${MIN_OUTBOUND_REPLIES}+ outbound replies sent`,
      met: outboundSuccessful,
      detail: outboundSuccessful
        ? `${outboundReplies.length} successful replies in last ${MIN_TIME_WINDOW_DAYS} days`
        : `Only ${outboundReplies.length} outbound replies in last ${MIN_TIME_WINDOW_DAYS} days (need ${MIN_OUTBOUND_REPLIES})`,
    },
    {
      id: "message_threshold",
      label: `${MIN_MESSAGE_THRESHOLD}+ messages in window`,
      met: messageThresholdMet,
      detail: messageThresholdMet
        ? `${totalMessages.length} messages in last ${MIN_TIME_WINDOW_DAYS} days`
        : `Only ${totalMessages.length} messages (need ${MIN_MESSAGE_THRESHOLD} in ${MIN_TIME_WINDOW_DAYS} days)`,
    },
    {
      id: "time_window",
      label: `${MIN_TIME_WINDOW_DAYS}-day minimum history`,
      met: timeWindowMet,
      detail: timeWindowMet
        ? `${Math.floor(messageSpread / dayMs)} days of message spread`
        : messageDates.length < 2
          ? "Need at least 2 messages spread over time"
          : `Only ${Math.floor(messageSpread / dayMs)} day(s) of spread (need ${MIN_TIME_WINDOW_DAYS})`,
    },
  ];

  const metCount = conditions.filter(c => c.met).length;
  const setupConditions = conditions.slice(0, 3);
  const activityConditions = conditions.slice(3);
  const setupMet = setupConditions.every(c => c.met);
  const activityMet = activityConditions.every(c => c.met);

  let phase: AccountPhase;
  let phaseLabel: string;
  let phaseDetail: string;

  if (!setupConditions.some(c => c.met)) {
    phase = "not_setup";
    phaseLabel = "Setup Required";
    phaseDetail = "Connect your channel and enable auto-reply to start tracking performance";
  } else if (!setupMet) {
    phase = "not_setup";
    phaseLabel = "Setup In Progress";
    phaseDetail = "Complete the remaining setup steps to activate benchmarking";
  } else if (!activityMet) {
    phase = "setup_inactive";
    phaseLabel = "Waiting for Data";
    phaseDetail = `System is configured but needs real message activity. ${MIN_MESSAGE_THRESHOLD}+ messages and ${MIN_OUTBOUND_REPLIES}+ replies required over ${MIN_TIME_WINDOW_DAYS} days.`;
  } else {
    phase = "active_measurable";
    phaseLabel = "Active & Measurable";
    phaseDetail = "All systems operational — benchmarks and intelligence are live";
  }

  return {
    phase,
    phaseLabel,
    phaseDetail,
    conditions,
    benchmarkReady: phase === "active_measurable",
    intelligenceReady: phase === "active_measurable",
    metConditions: metCount,
    totalConditions: conditions.length,
  };
}

export function registerReadinessRoutes(app: Express) {
  app.get("/api/readiness/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const readiness = await computeAccountReadiness(subAccountId);
    res.json(readiness);
  }));
}
