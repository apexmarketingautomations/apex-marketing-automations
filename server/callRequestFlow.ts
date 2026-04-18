import { storage } from "./storage";
import { db } from "./db";
import { deals, messages, vapiCallLogs, notifications } from "@shared/schema";
import { eq, and, desc, gt, sql } from "drizzle-orm";
import { dispatchAlert, generateDeepLink } from "./pushAlertService";
import { enforceSmsProvider } from "./smsGatewayGuard";
import Twilio from "twilio";

interface SubAccountConfig {
  bookingLink?: string;
  [key: string]: unknown;
}

interface AiPromptConfig {
  bookingLink?: string;
  [key: string]: unknown;
}

export interface IntentResult {
  isHotLead: boolean;
  intentType: "CALL_REQUEST" | "PRICING" | "GENERAL";
  confidence: number;
  hasPhone: boolean;
  extractedPhone: string | null;
}

const CALL_PATTERNS = [
  /\bcall me\b/i,
  /\bcan you call\b/i,
  /\bgive me a call\b/i,
  /\breach out\b/i,
  /\bhit me up\b/i,
  /\bring me\b/i,
  /\bphone me\b/i,
  /\bcall now\b/i,
  /\bcall asap\b/i,
  /\bwant a call\b/i,
  /\bneed a call\b/i,
  /\bschedule\b/i,
  /\bbook\b/i,
  /\bappointment\b/i,
  /\bdemo\b/i,
  /\bnumber\b/i,
  /\bmy number is\b/i,
  /\bhere'?s my number\b/i,
];

const PRICING_PATTERNS = [
  /\bpricing\b/i,
  /\bhow much\b/i,
  /\bwhat'?s the price\b/i,
  /\bquote\b/i,
  /\bcost\b/i,
  /\brates?\b/i,
  /\bestimate\b/i,
];

const INTEREST_PATTERNS = [
  /\binterested\b/i,
  /\bsign me up\b/i,
  /\blet'?s do it\b/i,
  /\bi'?m in\b/i,
  /\bi want\b/i,
  /\bi need\b/i,
  /\bhelp\b/i,
  /\bneed help\b/i,
  /\bget started\b/i,
  /\btell me more\b/i,
  /\bmore info\b/i,
];

const PHONE_REGEX = /(?<!\d)(\+?1?\s*[-.]?\s*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/;

const URGENCY_PATTERNS = [
  /\bnow\b/i,
  /\basap\b/i,
  /\bright now\b/i,
  /\bimmediately\b/i,
  /\btoday\b/i,
  /\burgent\b/i,
];

export function detectIntent(messageText: string): IntentResult {
  const text = messageText.trim();
  const phoneMatch = text.match(PHONE_REGEX);
  const hasPhone = !!phoneMatch;
  const extractedPhone = phoneMatch ? phoneMatch[1].replace(/[\s.()\-]/g, "").replace(/^1(\d{10})$/, "+1$1").replace(/^(\d{10})$/, "+1$1") : null;

  let matchCount = 0;

  for (const pat of CALL_PATTERNS) {
    if (pat.test(text)) matchCount++;
  }
  if (matchCount > 0) {
    const confidence = Math.min(1.0, 0.7 + matchCount * 0.1 + (hasPhone ? 0.15 : 0));
    return { isHotLead: true, intentType: "CALL_REQUEST", confidence, hasPhone, extractedPhone };
  }

  for (const pat of PRICING_PATTERNS) {
    if (pat.test(text)) matchCount++;
  }
  if (matchCount > 0) {
    const confidence = Math.min(1.0, 0.65 + matchCount * 0.1 + (hasPhone ? 0.15 : 0));
    return { isHotLead: true, intentType: "PRICING", confidence, hasPhone, extractedPhone };
  }

  for (const pat of INTEREST_PATTERNS) {
    if (pat.test(text)) matchCount++;
  }
  if (matchCount > 0) {
    const confidence = Math.min(1.0, 0.6 + matchCount * 0.1 + (hasPhone ? 0.15 : 0));
    return { isHotLead: true, intentType: "CALL_REQUEST", confidence, hasPhone, extractedPhone };
  }

  if (hasPhone) {
    return { isHotLead: true, intentType: "CALL_REQUEST", confidence: 0.75, hasPhone, extractedPhone };
  }

  return { isHotLead: false, intentType: "GENERAL", confidence: 0, hasPhone: false, extractedPhone: null };
}

export function detectUrgency(messageText: string): boolean {
  return URGENCY_PATTERNS.some(p => p.test(messageText));
}

async function getBookingLink(subAccountId: number): Promise<string | null> {
  try {
    const account = await storage.getSubAccount(subAccountId);
    if (!account) return null;
    const config = (account.config ?? {}) as SubAccountConfig;
    const aiPromptConfig = (account.aiPromptConfig ?? {}) as AiPromptConfig;
    return aiPromptConfig.bookingLink || config.bookingLink || null;
  } catch {
    return null;
  }
}

async function isExistingCustomer(contactId: number, subAccountId: number): Promise<boolean> {
  try {
    const stages = await storage.getPipelineStages(subAccountId);
    const closedWonStage = stages.find(s => s.name === "Closed Won");
    if (!closedWonStage) return false;

    const contactDeals = await db.select().from(deals)
      .where(and(
        eq(deals.subAccountId, subAccountId),
        eq(deals.contactId, contactId),
        eq(deals.stageId, closedWonStage.id)
      ))
      .limit(1);

    return contactDeals.length > 0;
  } catch {
    return false;
  }
}

export function buildAutoResponse(hasPhone: boolean, isUrgent: boolean, bookingLink: string | null, isCustomer: boolean): string {
  if (!hasPhone) {
    return isCustomer
      ? "Hey — good to hear from you again! What's the best number to reach you at?"
      : "Got you — what's the best number to reach you at?";
  }

  if (isUrgent) {
    return isCustomer
      ? "On it — calling you shortly 👌"
      : "Bet — calling you shortly 👌";
  }

  const base = isCustomer
    ? "Good to hear from you! Want me to call you now or send a quick link to book a time?"
    : "Perfect — want me to call you now or send a quick link to book a time?";

  if (bookingLink) {
    return `${base}\n\nBook here: ${bookingLink}`;
  }
  return base;
}

interface NormalizedLead {
  contactId: number;
  message: string;
  channel: "sms" | "facebook" | "instagram";
  phone: string | null;
  name: string;
  subAccountId: number;
  followUpPhone?: string;
}

const REQUIRED_STAGES = [
  { name: "New Lead", position: 0 },
  { name: "Contact Requested", position: 1 },
  { name: "Call Scheduled", position: 2 },
  { name: "Proposal Sent", position: 3 },
  { name: "Closed Won", position: 4 },
  { name: "Closed Lost", position: 5 },
];

async function ensurePipelineStages(subAccountId: number): Promise<Map<string, number>> {
  const existing = await storage.getPipelineStages(subAccountId);
  const nameToId = new Map<string, number>();
  for (const stage of existing) {
    nameToId.set(stage.name, stage.id);
  }

  for (const req of REQUIRED_STAGES) {
    if (!nameToId.has(req.name)) {
      const created = await storage.createPipelineStage({
        subAccountId,
        name: req.name,
        position: req.position,
      });
      nameToId.set(created.name, created.id);
      flowLog("pipeline_seeded", { contactId: 0, sub_account_id: subAccountId, channel: "system" });
    }
  }

  return nameToId;
}

async function getOpenDealForContact(contactId: number, subAccountId: number) {
  const allDeals = await db.select().from(deals)
    .where(and(
      eq(deals.subAccountId, subAccountId),
      eq(deals.contactId, contactId),
      eq(deals.status, "open")
    ))
    .orderBy(desc(deals.createdAt))
    .limit(1);
  return allDeals.length > 0 ? allDeals[0] : null;
}

async function hasOutboundActivityAfter(contactPhone: string, subAccountId: number, afterTimestamp: Date): Promise<boolean> {
  const outboundMsgs = await db.select({ id: messages.id }).from(messages)
    .where(and(
      eq(messages.subAccountId, subAccountId),
      eq(messages.contactPhone, contactPhone),
      eq(messages.direction, "outbound"),
      gt(messages.createdAt, afterTimestamp)
    ))
    .limit(1);

  if (outboundMsgs.length > 0) return true;

  const phoneDigits = contactPhone.replace(/\D/g, "").slice(-10);
  if (phoneDigits.length === 10) {
    const callRows = await db.select({ id: vapiCallLogs.id }).from(vapiCallLogs)
      .where(and(
        sql`${vapiCallLogs.customerNumber} LIKE ${"%" + phoneDigits}`,
        gt(vapiCallLogs.startedAt, afterTimestamp)
      ))
      .limit(1);
    if (callRows.length > 0) return true;
  }

  return false;
}

async function forceHotLeadSms(subAccountId: number, alertBody: string, deepLink: string): Promise<void> {
  const account = await storage.getSubAccount(subAccountId);
  const ownerPhone = account?.ownerPhone;
  if (!ownerPhone) {
    console.log(`[CALL-REQUEST-FLOW] Skipping hot-lead SMS: no ownerPhone for account ${subAccountId}`);
    return;
  }
  const { sendSms } = await import("./messaging/sendSms");
  const smsBody = `[Apex Alert] 🔥 HOT LEAD\n${alertBody}\nView: ${deepLink}`;
  const result = await sendSms({
    subAccountId,
    to: ownerPhone,
    body: smsBody.substring(0, 1600),
    source: "call-request-flow-alert",
    path: "hot-lead",
  });
  if (result.ok) {
    console.log(`[CALL-REQUEST-FLOW] Forced SMS alert to owner ${ownerPhone} for account ${subAccountId} sid=${result.twilioSid}`);
  } else {
    console.error(`[CALL-REQUEST-FLOW] Force SMS alert failed account=${subAccountId} reason=${result.reason} err=${result.errorMessage}`);
  }
}

function flowLog(event: string, data: { contactId: number; sub_account_id?: number; subAccountId?: number; channel: string; [key: string]: unknown }) {
  const normalized = {
    ...data,
    sub_account_id: data.sub_account_id || data.subAccountId,
    timestamp: new Date().toISOString(),
  };
  delete normalized.subAccountId;
  console.log(`[CALL-REQUEST-FLOW][${event}] ${JSON.stringify(normalized)}`);
}

interface ReplyContext {
  type: "sms" | "meta";
  fromNumber?: string;
  toNumber?: string;
  threadId?: string;
  traceId?: string;
  senderId?: string;
  metaChannel?: string;
}

export async function handleCallRequestFlow(
  lead: NormalizedLead,
  intent: IntentResult,
  sendReply: (body: string) => Promise<void>,
  replyContext?: ReplyContext
): Promise<boolean> {
  const { contactId, message, channel, phone, name, subAccountId } = lead;

  flowLog("intent_detected", {
    contactId, sub_account_id: subAccountId, channel,
    intentType: intent.intentType,
    confidence: intent.confidence,
    hasPhone: intent.hasPhone,
  });

  if (intent.extractedPhone && contactId > 0) {
    try {
      const contact = await storage.getContactById(contactId);
      if (contact && (!contact.phone || !contact.phone.startsWith("+"))) {
        await storage.updateContact(contactId, { phone: intent.extractedPhone });
      }
    } catch (err) {
      console.error(`[CALL-REQUEST-FLOW] Phone capture error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const contactHasPhone = !!(phone || intent.extractedPhone);
  const isUrgent = detectUrgency(message);
  const bookingLink = await getBookingLink(subAccountId);
  const isCustomer = contactId > 0 ? await isExistingCustomer(contactId, subAccountId) : false;
  const autoReply = buildAutoResponse(contactHasPhone, isUrgent, bookingLink, isCustomer);

  try {
    await sendReply(autoReply);
    flowLog("auto_response_sent", { contactId, sub_account_id: subAccountId, channel });
  } catch (err) {
    console.error(`[CALL-REQUEST-FLOW] Auto-response send failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const stageMap = await ensurePipelineStages(subAccountId);
    const contactRequestedId = stageMap.get("Contact Requested");
    const newLeadId = stageMap.get("New Lead");

    if (contactRequestedId && contactId > 0) {
      await db.transaction(async (tx) => {
        const existingDeals = await tx.select().from(deals)
          .where(and(
            eq(deals.subAccountId, subAccountId),
            eq(deals.contactId, contactId),
            eq(deals.status, "open")
          ))
          .orderBy(desc(deals.createdAt))
          .limit(1);

        const existingDeal = existingDeals.length > 0 ? existingDeals[0] : null;

        if (!existingDeal) {
          await tx.insert(deals).values({
            subAccountId,
            contactId,
            stageId: contactRequestedId,
            title: `${name || "Unknown"} — Call Request`,
            value: 0,
            status: "open",
          });
          flowLog("deal_created", { contactId, sub_account_id: subAccountId, channel, stage: "Contact Requested" });
        } else if (newLeadId && existingDeal.stageId === newLeadId) {
          await tx.update(deals).set({ stageId: contactRequestedId }).where(eq(deals.id, existingDeal.id));
          flowLog("deal_advanced", { contactId, sub_account_id: subAccountId, channel, dealId: existingDeal.id });
        }
      });
    }
  } catch (err) {
    console.error(`[CALL-REQUEST-FLOW] Deal creation/advancement error: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const contactPhone = phone || intent.extractedPhone || "unknown";
    const deepLink = generateDeepLink(`/crm/contacts/${contactId}`);
    const alertBody = [
      `Name: ${name || "Unknown"}`,
      `Phone: ${contactPhone}`,
      `Channel: ${channel}`,
      `Message: "${message.substring(0, 100)}"`,
      ``,
      `ACTION: Call now`,
      `Link: ${deepLink}`,
    ].join("\n");

    const alertResult = await dispatchAlert(subAccountId, "new_lead", {
      title: "🔥 HOT LEAD",
      body: alertBody,
      link: deepLink,
      urgency: "high",
      tag: `hot-lead-${contactId}`,
    });

    if (!alertResult.smsSent) {
      await forceHotLeadSms(subAccountId, alertBody, deepLink);
    }

    flowLog("alert_sent", { contactId, sub_account_id: subAccountId, channel });
  } catch (err) {
    console.error(`[CALL-REQUEST-FLOW] Alert dispatch error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (contactId > 0 && replyContext) {
    const followUpPhone = lead.followUpPhone || phone || intent.extractedPhone || "";
    const autoResponseTimestamp = new Date();
    const persisted = await persistFollowUp(lead, followUpPhone, replyContext, autoResponseTimestamp);
    if (persisted) {
      flowLog("followup_scheduled", { contactId, sub_account_id: subAccountId, channel });
    } else {
      flowLog("followup_schedule_failed", { contactId, sub_account_id: subAccountId, channel });
    }
  }

  return true;
}

const FOLLOW_UP_DELAY_MS = 10 * 60 * 1000;
const FOLLOWUP_TYPE = "scheduled_followup";

interface FollowupPayload {
  contactId: number;
  contactPhone: string;
  channel: string;
  followUpPhone: string | null;
  replyContext: ReplyContext;
  autoResponseAt: string;
  executeAt: string;
}

async function persistFollowUp(
  lead: NormalizedLead,
  contactPhone: string,
  replyContext: ReplyContext,
  autoResponseTimestamp: Date
): Promise<boolean> {
  const executeAt = new Date(autoResponseTimestamp.getTime() + FOLLOW_UP_DELAY_MS);
  const payload: FollowupPayload = {
    contactId: lead.contactId,
    contactPhone,
    channel: lead.channel,
    followUpPhone: lead.followUpPhone || null,
    replyContext,
    autoResponseAt: autoResponseTimestamp.toISOString(),
    executeAt: executeAt.toISOString(),
  };
  try {
    await db.insert(notifications).values({
      subAccountId: lead.subAccountId,
      type: FOLLOWUP_TYPE,
      title: `Follow-up: contact ${lead.contactId}`,
      body: JSON.stringify(payload),
      read: false,
    });
    return true;
  } catch (err) {
    console.error(`[CALL-REQUEST-FLOW] Failed to persist follow-up: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function resolveMetaCredentials(subAccountId: number): Promise<{ accessToken: string; pageId: string } | null> {
  try {
    const account = await storage.getSubAccount(subAccountId);
    if (!account) return null;
    const accessToken = account.metaAccessToken;
    const pageId = account.metaPageId;
    if (!accessToken || !pageId) return null;
    return { accessToken, pageId };
  } catch {
    return null;
  }
}

async function sendFollowUpMessage(
  ctx: ReplyContext,
  subAccountId: number,
  contactPhone: string,
  body: string
): Promise<boolean> {
  if (ctx.type === "sms") {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error("Twilio credentials not configured");
    if (!ctx.fromNumber || !ctx.toNumber) throw new Error("SMS follow-up missing fromNumber or toNumber");
    await enforceSmsProvider("sms", "twilio", { subAccountId, phone: ctx.toNumber, source: "call-request-flow-followup" });
    const client = Twilio(sid, token);
    await client.messages.create({ body, from: ctx.fromNumber, to: ctx.toNumber });
    await storage.createMessage({
      subAccountId,
      contactPhone,
      body,
      direction: "outbound",
      channel: "sms",
      status: "sent",
      threadId: ctx.threadId || null,
      traceId: ctx.traceId || null,
    });
    return true;
  } else if (ctx.type === "meta") {
    if (!ctx.senderId) throw new Error("Meta follow-up missing senderId");
    const metaCreds = await resolveMetaCredentials(subAccountId);
    if (!metaCreds) throw new Error(`No Meta credentials found for account ${subAccountId}`);
    const replyUrl = `https://graph.facebook.com/v21.0/${metaCreds.pageId}/messages`;
    const sendRes = await fetch(replyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: ctx.senderId },
        message: { text: body },
        access_token: metaCreds.accessToken,
      }),
    });
    if (!sendRes.ok) throw new Error(`Meta API returned ${sendRes.status}`);
    const metaChannel = ctx.metaChannel || "facebook";
    const metaDmThreadId = `${subAccountId}::${ctx.senderId}::${metaChannel}`;
    await db.insert(messages).values({
      subAccountId,
      channel: metaChannel,
      direction: "outbound",
      contactPhone: ctx.senderId,
      body,
      status: "sent",
      threadId: metaDmThreadId,
    });
    return true;
  }
  throw new Error(`Unknown reply context type: ${ctx.type}`);
}

async function hasDealProgressedOrClosed(contactId: number, subAccountId: number): Promise<boolean> {
  const stages = await ensurePipelineStages(subAccountId);
  const contactRequestedId = stages.get("Contact Requested");

  const allDeals = await db.select().from(deals)
    .where(and(
      eq(deals.subAccountId, subAccountId),
      eq(deals.contactId, contactId)
    ))
    .orderBy(desc(deals.createdAt))
    .limit(1);

  if (allDeals.length === 0) return false;
  const deal = allDeals[0];

  if (deal.status !== "open") return true;
  if (contactRequestedId && deal.stageId !== contactRequestedId) return true;

  return false;
}

async function executeFollowUp(
  notifId: number,
  subAccountId: number,
  payload: FollowupPayload
): Promise<"sent" | "skipped"> {
  const checkPhone = payload.followUpPhone || payload.contactPhone;
  const autoResponseAt = new Date(payload.autoResponseAt);
  const checkAfter = new Date(autoResponseAt.getTime() + 5000);

  const hasActivity = await hasOutboundActivityAfter(checkPhone, subAccountId, checkAfter);
  if (hasActivity) {
    flowLog("followup_skipped", { contactId: payload.contactId, sub_account_id: subAccountId, channel: payload.channel, reason: "outbound_activity_found" });
    return "skipped";
  }

  const dealProgressed = await hasDealProgressedOrClosed(payload.contactId, subAccountId);
  if (dealProgressed) {
    flowLog("followup_skipped", { contactId: payload.contactId, sub_account_id: subAccountId, channel: payload.channel, reason: "deal_progressed_or_closed" });
    return "skipped";
  }

  const followUpMsg = "Still good for a call? I can ring you now or send a time 👍";
  const sent = await sendFollowUpMessage(payload.replyContext, subAccountId, payload.contactPhone, followUpMsg);
  if (sent) {
    flowLog("followup_sent", { contactId: payload.contactId, sub_account_id: subAccountId, channel: payload.channel });
  }
  return "sent";
}

export async function processScheduledFollowups(): Promise<number> {
  const now = new Date();
  const pending = await db.select().from(notifications)
    .where(and(
      eq(notifications.type, FOLLOWUP_TYPE),
      eq(notifications.read, false)
    ))
    .limit(20);

  let processed = 0;
  for (const notif of pending) {
    try {
      const payload = JSON.parse(notif.body || "{}") as FollowupPayload;
      const executeAt = new Date(payload.executeAt);
      if (executeAt > now) continue;

      const result = await executeFollowUp(notif.id, notif.subAccountId, payload);
      await db.update(notifications)
        .set({ read: true, title: `${notif.title} [${result}]` })
        .where(eq(notifications.id, notif.id));
      processed++;
    } catch (err) {
      console.error(`[CALL-REQUEST-FLOW] Follow-up ${notif.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      await db.update(notifications)
        .set({ read: true, title: `${notif.title} [failed]` })
        .where(eq(notifications.id, notif.id));
    }
  }
  return processed;
}

const FOLLOWUP_POLL_INTERVAL = 3_600_000;
let followupWorkerRunning = false;

export function startFollowupWorker(): void {
  if (followupWorkerRunning) return;
  followupWorkerRunning = true;
  console.log(`[FOLLOWUP-WORKER] Started — polling every ${FOLLOWUP_POLL_INTERVAL / 1000}s`);

  setInterval(async () => {
    try {
      const count = await processScheduledFollowups();
      if (count > 0) {
        console.log(`[FOLLOWUP-WORKER] Processed ${count} follow-up(s)`);
      }
    } catch (err) {
      console.error(`[FOLLOWUP-WORKER] Poll error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, FOLLOWUP_POLL_INTERVAL);
}
