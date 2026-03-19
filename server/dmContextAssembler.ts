import { db } from "./db";
import { storage } from "./storage";
import { messages, contacts, deals, pipelineStages } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import type { ChatMessage } from "./aiGateway";

export interface DmContext {
  businessName: string;
  industry: string | null;
  language: string;
  bookingLink: string | null;
  customAiPrompt: string | null;
  serviceOfferings: string[] | null;
  contactName: string | null;
  contactTags: string[] | null;
  contactNotes: string | null;
  contactSource: string | null;
  dealStage: string | null;
  smsOptOut: boolean;
  threadHistory: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface DmContextOptions {
  subAccountId: number;
  contactPhone: string;
  channel: string;
  historyLimit?: number;
}

export async function assembleDmContext(opts: DmContextOptions): Promise<DmContext> {
  const { subAccountId, contactPhone, channel, historyLimit = 10 } = opts;

  const [account, threadMessages, contactRecord] = await Promise.all([
    storage.getSubAccount(subAccountId).catch(() => null),
    db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.subAccountId, subAccountId),
          eq(messages.contactPhone, contactPhone)
        )
      )
      .orderBy(desc(messages.id))
      .limit(historyLimit)
      .catch(() => []),
    db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.subAccountId, subAccountId),
          eq(contacts.phone, contactPhone)
        )
      )
      .limit(1)
      .catch(() => []),
  ]);

  const contactRow = contactRecord.length > 0 ? contactRecord[0] : null;

  let dealStage: string | null = null;
  if (contactRow) {
    try {
      const dealRows = await db
        .select({ stageId: deals.stageId })
        .from(deals)
        .where(
          and(
            eq(deals.subAccountId, subAccountId),
            eq(deals.contactId, contactRow.id)
          )
        )
        .orderBy(desc(deals.id))
        .limit(1);
      if (dealRows.length > 0) {
        const [stageRow] = await db
          .select({ name: pipelineStages.name })
          .from(pipelineStages)
          .where(eq(pipelineStages.id, dealRows[0].stageId))
          .limit(1);
        if (stageRow) dealStage = stageRow.name;
      }
    } catch {
    }
  }

  const config = (account?.config as any) || {};
  const aiPromptConfig = (account?.aiPromptConfig as any) || {};

  const bookingLink: string | null =
    aiPromptConfig.bookingLink ||
    config.bookingLink ||
    null;

  const customAiPrompt: string | null =
    aiPromptConfig.systemPrompt ||
    aiPromptConfig.customPrompt ||
    config.customAiPrompt ||
    null;

  const serviceOfferings: string[] | null =
    aiPromptConfig.serviceOfferings ||
    config.serviceOfferings ||
    null;

  const threadHistory = [...threadMessages]
    .reverse()
    .map((msg) => ({
      role: (msg.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
      content: msg.body || "",
    }));

  return {
    businessName: (account as any)?.businessName || account?.name || "Our Business",
    industry: account?.industry || null,
    language: account?.language || "en",
    bookingLink,
    customAiPrompt,
    serviceOfferings,
    contactName: contactRow
      ? [contactRow.firstName, contactRow.lastName].filter(Boolean).join(" ") || null
      : null,
    contactTags: contactRow?.tags?.length ? contactRow.tags : null,
    contactNotes: contactRow?.notes || null,
    contactSource: contactRow?.source || null,
    dealStage,
    smsOptOut: contactRow?.smsOptOut ?? false,
    threadHistory,
  };
}

export interface BuildPromptOptions {
  context: DmContext;
  channel: string;
  currentMessage: string;
  fallbackContactLabel?: string;
}

export function buildDmSystemPrompt(context: DmContext, channel: string): string {
  const isSmsBased = channel === "sms" || channel === "whatsapp";
  const charLimit = isSmsBased ? 160 : 280;

  if (context.customAiPrompt) {
    let prompt = context.customAiPrompt;

    if (context.contactName) {
      prompt += `\n\nYou are currently speaking with ${context.contactName}.`;
    }

    if (context.contactTags && context.contactTags.length > 0) {
      prompt += `\nContact tags: ${context.contactTags.join(", ")}.`;
    }

    if (context.contactNotes) {
      prompt += `\nNotes about this contact: ${context.contactNotes}`;
    }

    if (context.dealStage) {
      prompt += `\nThis contact is currently in the "${context.dealStage}" deal stage.`;
    }

    if (context.bookingLink) {
      prompt += `\nBooking link: ${context.bookingLink}`;
    }

    prompt += `\n\nKeep replies under ${charLimit} characters when possible. Respond via ${channel}.`;
    return prompt;
  }

  const businessDesc = context.businessName;
  const industryNote = context.industry ? ` — a ${context.industry} business` : "";

  let services = "";
  if (context.serviceOfferings && context.serviceOfferings.length > 0) {
    services = `\n\nSERVICES:\n${context.serviceOfferings.map((s) => `- ${s}`).join("\n")}`;
  }

  let bookingSection = "";
  if (context.bookingLink) {
    bookingSection = `\n\nBOOKING:\nWhen the customer is interested or asks about scheduling — share the booking link: ${context.bookingLink}\nPhrase it naturally like "Here's a link to book a quick call" or "Grab a time here".`;
  }

  let contactSection = "";
  if (context.contactName) {
    contactSection = `\n\nYou are responding to ${context.contactName}`;
    if (context.contactSource) contactSection += ` (source: ${context.contactSource})`;
    if (context.dealStage) contactSection += `. They are in the "${context.dealStage}" stage`;
    contactSection += ".";
    if (context.contactTags && context.contactTags.length > 0) {
      contactSection += `\nContact tags: ${context.contactTags.join(", ")}.`;
    }
    if (context.contactNotes) {
      contactSection += `\nContact notes: ${context.contactNotes}`;
    }
  }

  const rules = `\n\nRULES:
- Be warm, professional, and concise
- Keep replies under ${charLimit} characters when possible
- Use the contact's name naturally if you know it
- Give specific, helpful answers
- Never say you're an AI${context.bookingLink ? "\n- Share the booking link when they show interest or ask about scheduling" : ""}
- End with a clear next step or question`;

  return `You are a representative of ${businessDesc}${industryNote}.${services}${bookingSection}${contactSection}${rules}`;
}

export function buildDmMessages(
  context: DmContext,
  channel: string,
  currentMessage: string
): ChatMessage[] {
  const systemPrompt = buildDmSystemPrompt(context, channel);

  const msgs: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  for (const h of context.threadHistory) {
    msgs.push({ role: h.role, content: h.content.substring(0, 800) });
  }

  msgs.push({ role: "user", content: currentMessage.substring(0, 1000) });

  return msgs;
}
