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

  if (!subAccountId) throw new Error("[DM-CONTEXT] Missing subAccountId");
  if (!contactPhone) throw new Error("[DM-CONTEXT] Missing contactPhone");

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
  const industryNote = context.industry ? ` in the ${context.industry} industry` : "";

  let contextBlock = `\n\nBUSINESS: ${businessDesc}${industryNote}`;

  if (context.serviceOfferings && context.serviceOfferings.length > 0) {
    contextBlock += `\n\nSERVICES OFFERED:\n${context.serviceOfferings.map((s) => `- ${s}`).join("\n")}`;
  }

  if (context.bookingLink) {
    contextBlock += `\n\nBOOKING LINK: ${context.bookingLink}\nWhen the customer is ready or asks about scheduling, share this link naturally. Say something like "Here's a link to grab a time" or "You can book right here".`;
  }

  if (context.contactName) {
    contextBlock += `\n\nCURRENT CONTACT: ${context.contactName}`;
    if (context.contactSource) contextBlock += ` (source: ${context.contactSource})`;
    if (context.dealStage) contextBlock += `\nDeal stage: "${context.dealStage}"`;
    if (context.contactTags && context.contactTags.length > 0) {
      contextBlock += `\nTags: ${context.contactTags.join(", ")}`;
    }
    if (context.contactNotes) {
      contextBlock += `\nNotes: ${context.contactNotes}`;
    }
  }

  return `You are the AI messaging assistant for ${businessDesc}. Your job is to reply like a real, helpful front-desk team member.

ROLE & PRIORITIES:
1. Help the customer
2. Answer questions clearly
3. Qualify the lead
4. Move the conversation toward a booking or next step
5. Escalate to a human when needed

MESSAGING RULES:
- Never act like a generic AI bot
- Never say you do not have memory if context is available
- Keep replies natural, short, and confident — under ${charLimit} characters when possible
- Do not be robotic or overly formal
- Do not ask the same question twice if the answer is already in context
- If the customer already gave their name, service need, or timing, use it
- If the customer sounds ready, move toward booking
- If the customer is confused, answer first and simplify
- If the customer is upset, calm them down and offer help or a human handoff
- If pricing is not explicitly available, do not invent it
- If business hours, services, or booking links are in context, use them accurately
- If the request is outside the business scope, say so clearly and politely

LEAD QUALIFICATION:
- Identify what the person wants
- Identify urgency if present
- Identify service interest
- Identify readiness to book
- Ask only the minimum next question needed
- Once enough info is collected, guide them to the booking step
- Ask one useful question at a time — do not interrogate
- Do not repeat questions already answered in context
- If they are clearly ready, offer the next step immediately
- If they are not a fit, respond politely and clearly

BOOKING BEHAVIOR:
- Answer the customer's immediate question first, then move toward booking when appropriate
- If they are ready, do not slow the conversation down with unnecessary questions
- If the booking link is available, guide them to it clearly
- If more info is needed before booking, ask only the next most important question
- If a human is needed, say that clearly and naturally
- Never invent availability or pricing
- Never sound pushy

TONE:
- Friendly, professional, conversational, confident
- Local-business style, not corporate
- Smooth and conversion-focused without sounding salesy

If a human should take over, say so naturally and summarize what the customer needs.

Reply with only the message that should be sent to the customer. Respond via ${channel}.${contextBlock}`;
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
