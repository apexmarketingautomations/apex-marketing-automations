import { db } from "./db";
import { storage } from "./storage";
import { messages, contacts, deals, pipelineStages, clientWebsites, trainingJobs } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import type { ChatMessage } from "./aiGateway";

export interface DmFormLink {
  label: string;
  url: string;
}

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
  knowledgeBase: string | null;
  formLinks: DmFormLink[] | null;
  offerUrls: DmFormLink[] | null;
  servicePageUrls: DmFormLink[] | null;
  generatedPersona: string | null;
  brandVoice: string | null;
  escalationInfo: string | null;
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

  const [account, threadMessages, contactRecord, websiteRows] = await Promise.all([
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
    db
      .select()
      .from(clientWebsites)
      .where(eq(clientWebsites.subAccountId, subAccountId))
      .limit(1)
      .catch(() => []),
  ]);

  const contactRow = contactRecord.length > 0 ? contactRecord[0] : null;
  const websiteRow = websiteRows.length > 0 ? websiteRows[0] : null;

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

  let knowledgeBase: string | null = null;
  let generatedPersona: string | null = null;
  let botPersona: string | null = websiteRow?.botPersona || null;

  if (websiteRow?.trainingJobId) {
    try {
      const [job] = await db
        .select()
        .from(trainingJobs)
        .where(eq(trainingJobs.id, websiteRow.trainingJobId))
        .limit(1);
      if (job) {
        if (job.scrapedContent && job.scrapedContent.length > 50) {
          knowledgeBase = job.scrapedContent.substring(0, 12000);
        }
        if (job.generatedPersona) {
          generatedPersona = job.generatedPersona;
        }
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

  const customPromptRaw: string | null =
    aiPromptConfig.systemPrompt ||
    aiPromptConfig.customPrompt ||
    config.customAiPrompt ||
    null;

  const resolvedPersona = generatedPersona || customPromptRaw || botPersona || null;

  const serviceOfferings: string[] | null =
    aiPromptConfig.serviceOfferings ||
    config.serviceOfferings ||
    null;

  const formLinks: DmFormLink[] | null =
    aiPromptConfig.formLinks && Array.isArray(aiPromptConfig.formLinks) && aiPromptConfig.formLinks.length > 0
      ? aiPromptConfig.formLinks : null;

  const offerUrls: DmFormLink[] | null =
    aiPromptConfig.offerUrls && Array.isArray(aiPromptConfig.offerUrls) && aiPromptConfig.offerUrls.length > 0
      ? aiPromptConfig.offerUrls : null;

  const servicePageUrls: DmFormLink[] | null =
    aiPromptConfig.servicePageUrls && Array.isArray(aiPromptConfig.servicePageUrls) && aiPromptConfig.servicePageUrls.length > 0
      ? aiPromptConfig.servicePageUrls : null;

  const brandVoice: string | null = aiPromptConfig.brandVoice || null;
  const escalationInfo: string | null = aiPromptConfig.escalationInfo || null;

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
    customAiPrompt: resolvedPersona,
    serviceOfferings,
    contactName: contactRow
      ? (() => {
          const raw = [contactRow.firstName, contactRow.lastName].filter(Boolean).join(" ").trim();
          return raw && !/^(SMS\s*\d+|Unknown|Vapi SMS\s*\d+|user\s*\d+)$/i.test(raw) ? raw : null;
        })()
      : null,
    contactTags: contactRow?.tags?.length ? contactRow.tags : null,
    contactNotes: contactRow?.notes || null,
    contactSource: contactRow?.source || null,
    dealStage,
    smsOptOut: contactRow?.smsOptOut ?? false,
    threadHistory,
    knowledgeBase,
    formLinks,
    offerUrls,
    servicePageUrls,
    generatedPersona,
    brandVoice,
    escalationInfo,
  };
}

export interface BuildPromptOptions {
  context: DmContext;
  channel: string;
  currentMessage: string;
  fallbackContactLabel?: string;
}

export type ConversationStage =
  | "new_lead"
  | "qualifying"
  | "warm"
  | "ready_to_book"
  | "existing_customer";

const BOOKING_INTENT_PATTERNS = /\b(book|schedule|sign up|sign me up|appointment|reserve|let's do it|i'm ready|ready to|i want to start|get started|lock me in|let's go|how do i (book|sign|schedule))\b/i;

export function determineConversationStage(context: DmContext, currentMessage?: string): ConversationStage {
  const { dealStage, contactTags, threadHistory } = context;
  const stageLower = (dealStage || "").toLowerCase();
  const tags = (contactTags || []).map((t) => t.toLowerCase());

  if (
    tags.includes("customer") ||
    tags.includes("existing customer") ||
    stageLower === "won" ||
    stageLower === "closed" ||
    stageLower === "closed won" ||
    stageLower === "customer"
  ) {
    return "existing_customer";
  }

  if (
    stageLower.includes("proposal") ||
    stageLower.includes("booked") ||
    stageLower.includes("ready") ||
    tags.includes("ready to book") ||
    tags.includes("hot")
  ) {
    return "ready_to_book";
  }

  if (currentMessage && BOOKING_INTENT_PATTERNS.test(currentMessage)) {
    return "ready_to_book";
  }

  const lastUserMessages = threadHistory.filter(m => m.role === "user").slice(-2);
  if (lastUserMessages.some(m => BOOKING_INTENT_PATTERNS.test(m.content))) {
    return "ready_to_book";
  }

  if (
    stageLower.includes("qualified") ||
    stageLower.includes("warm") ||
    stageLower.includes("nurture") ||
    tags.includes("warm") ||
    tags.includes("qualified")
  ) {
    return "warm";
  }

  if (threadHistory.length >= 2 && threadHistory.length <= 4) {
    return "qualifying";
  }

  if (threadHistory.length > 4) {
    return "warm";
  }

  return "new_lead";
}

function getStageInstructions(stage: ConversationStage): string {
  switch (stage) {
    case "new_lead":
      return `CONVERSATION STAGE: New Lead (first contact)
- Ask 1-2 simple qualifying questions
- Keep it light and conversational
- Example openings: "What are you looking to get done?" / "Have you worked with something like this before?"
- Don't overwhelm — just start the conversation naturally`;

    case "qualifying":
      return `CONVERSATION STAGE: Qualifying Lead
- Dig slightly deeper into their needs, timeline, and budget if relevant
- Position the service clearly based on what they've shared
- Keep building rapport while gathering useful info
- Ask one question at a time — don't interrogate`;

    case "warm":
      return `CONVERSATION STAGE: Warm Lead
- Move toward booking or a clear next step
- Reduce friction — don't re-ask things they've already told you
- Example: "Let's get you locked in — here's the booking link"
- Be confident and direct while staying friendly`;

    case "ready_to_book":
      return `CONVERSATION STAGE: Ready to Book
- Be direct and helpful — they want to take action
- Provide booking link or next step immediately
- Offer reassurance if needed
- Don't slow them down with unnecessary questions`;

    case "existing_customer":
      return `CONVERSATION STAGE: Existing Customer
- Be supportive, informed, and appreciative
- Don't re-qualify — they already know the business
- Help resolve their question or route them appropriately
- If they need something new, treat them as a warm lead for that service`;
  }
}

function getChannelToneInstructions(channel: string): string {
  if (channel === "instagram") {
    return `CHANNEL TONE (Instagram DM):
- Casual, friendly, slightly playful
- Emojis allowed (but not excessive)
- Shorter messages preferred
- Example tone: "Got you 🙌", "Yeah we can definitely help with that"`;
  }

  if (channel === "facebook") {
    return `CHANNEL TONE (Facebook DM):
- Slightly more structured and professional
- Still conversational (not corporate)
- Minimal emoji use
- Warm and helpful tone`;
  }

  if (channel === "sms" || channel === "whatsapp") {
    return `CHANNEL TONE (${channel.toUpperCase()}):
- Brief and to the point
- Keep messages under 160 characters when possible
- Conversational but efficient`;
  }

  return `CHANNEL TONE:
- Conversational and friendly
- Professional but not corporate`;
}

export function buildDmSystemPrompt(context: DmContext, channel: string, currentMessage?: string): string {
  const stage = determineConversationStage(context, currentMessage);
  const stageInstructions = getStageInstructions(stage);
  const channelTone = getChannelToneInstructions(channel);

  const businessDesc = context.businessName;
  const industryNote = context.industry ? ` in the ${context.industry} industry` : "";

  let prompt = `You are a trained front-desk team member for ${businessDesc}${industryNote}, powered by Apex Marketing Automations. You are NOT a generic chatbot. You speak like a real human who understands the business, services, and how to guide customers toward booking or taking action.

CORE IDENTITY:
- You represent the business directly (not "an AI")
- You are helpful, natural, and confident
- You understand the services, offers, and customer needs
- Your goal is to guide conversations toward conversion (booking, form, or next step)`;

  if (context.customAiPrompt) {
    prompt += `\n\nPERSONALITY & VOICE:\n${context.customAiPrompt}`;
  }

  if (context.brandVoice) {
    prompt += `\n\nBRAND VOICE:\n${context.brandVoice}`;
  }

  if (context.knowledgeBase) {
    prompt += `\n\nBUSINESS KNOWLEDGE BASE (use this as your primary source of truth):\n${context.knowledgeBase}`;
  }

  if (context.serviceOfferings && context.serviceOfferings.length > 0) {
    prompt += `\n\nSERVICES OFFERED:\n${context.serviceOfferings.map((s) => `- ${s}`).join("\n")}`;
  }

  prompt += `\n\nLINKS & ACTIONS:`;

  if (context.bookingLink) {
    prompt += `\nBooking link: ${context.bookingLink}`;
  }

  if (context.formLinks && context.formLinks.length > 0) {
    prompt += `\nForms:`;
    for (const f of context.formLinks) {
      prompt += `\n- ${f.label}: ${f.url}`;
    }
  }

  if (context.offerUrls && context.offerUrls.length > 0) {
    prompt += `\nOffers:`;
    for (const o of context.offerUrls) {
      prompt += `\n- ${o.label}: ${o.url}`;
    }
  }

  if (context.servicePageUrls && context.servicePageUrls.length > 0) {
    prompt += `\nService pages:`;
    for (const s of context.servicePageUrls) {
      prompt += `\n- ${s.label}: ${s.url}`;
    }
  }

  if (context.bookingLink || context.formLinks || context.offerUrls || context.servicePageUrls) {
    prompt += `\nLink sharing guidelines:
- Don't dump links immediately — introduce them naturally
- Match the link to the user's intent
- Example phrasing: "I can get you booked in here 👇" or "Here's a quick form so we can get some details from you:"`;
  }

  prompt += `\n\n${stageInstructions}`;

  prompt += `\n\n${channelTone}`;

  prompt += `\n\nANTI-ROBOT RULES (VERY IMPORTANT):
NEVER say these phrases:
- "Thank you for reaching out"
- "We appreciate your inquiry"
- "Our services include…"
- "I'd be happy to assist you"
- "How may I help you today?"

INSTEAD use natural phrasing like:
- "Yeah we can help with that"
- "What are you trying to get done exactly?"
- "Let me point you in the right direction"

RESPONSE STYLE:
- Keep responses concise but helpful
- Ask one question at a time
- Avoid overwhelming the user
- Use line breaks for readability
- Mirror the user's tone when appropriate

QUALIFICATION FLOW:
1. Acknowledge what they said
2. Clarify their need
3. Provide direction or value
4. Move toward action (link, booking, form)`;

  if (context.escalationInfo) {
    prompt += `\n\nESCALATION:
When to escalate to a human:
- The request is complex or sensitive
- The user is frustrated
- You lack enough info to confidently answer

Escalation details: ${context.escalationInfo}

When escalating:
- Let the user know naturally
- Provide a brief summary of what the customer needs so the human can pick up seamlessly
- Example: "Got it — I'm going to have someone from the team jump in on this so we can get you sorted properly 👍"`;
  } else {
    prompt += `\n\nESCALATION:
When to escalate to a human:
- The request is complex or sensitive
- The user is frustrated
- You lack enough info to confidently answer

When escalating:
- Let the user know naturally
- Provide a brief summary of what the customer needs so the human can pick up seamlessly
- Example: "Got it — I'm going to have someone from the team jump in on this so we can get you sorted properly 👍"`;
  }

  let contactBlock = "";
  if (context.contactName) {
    contactBlock += `\n\nCURRENT CONTACT: ${context.contactName}`;
    if (context.contactSource) contactBlock += ` (source: ${context.contactSource})`;
    if (context.dealStage) contactBlock += `\nDeal stage: "${context.dealStage}"`;
    if (context.contactTags && context.contactTags.length > 0) {
      contactBlock += `\nTags: ${context.contactTags.join(", ")}`;
    }
    if (context.contactNotes) {
      contactBlock += `\nNotes: ${context.contactNotes}`;
    }
  }

  if (contactBlock) {
    prompt += contactBlock;
  }

  prompt += `\n\nPRIMARY GOAL:
Every conversation should move toward one of: Booking, Form submission, or Qualified lead progression.
Be helpful first — but always guide toward action.

Reply with only the message that should be sent to the customer. Respond via ${channel}.`;

  return prompt;
}

export function buildDmMessages(
  context: DmContext,
  channel: string,
  currentMessage: string
): ChatMessage[] {
  const systemPrompt = buildDmSystemPrompt(context, channel, currentMessage);

  const msgs: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  for (const h of context.threadHistory) {
    msgs.push({ role: h.role, content: h.content.substring(0, 800) });
  }

  msgs.push({ role: "user", content: currentMessage.substring(0, 1000) });

  return msgs;
}
