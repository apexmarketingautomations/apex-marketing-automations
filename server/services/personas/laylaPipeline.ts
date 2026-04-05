import { postProcessAndGuard, checkEscalationKeywords, maskPiiForLogs } from "./laylaPostProcessor";

export interface ConversationMessage {
  role: "user" | "layla";
  text: string;
  timestamp: number;
}

export interface ConversationState {
  conversationId: string;
  userId: string;
  platform: "facebook" | "instagram";
  messages: ConversationMessage[];
  interestScore: number;
  telegramOffered: boolean;
  botDenialUsed: boolean;
}

export interface PipelineAction {
  type: "send" | "handover" | "delay_then_send";
  reply: string;
  delayMs: number;
  reason?: string;
  telegramOffered?: boolean;
  handoverPriority?: "highest" | "high" | "normal";
  auditLog?: TelegramAuditEntry;
}

export interface TelegramAuditEntry {
  conversationId: string;
  userId: string;
  interestScore: number;
  reason: "explicit_ask" | "threshold";
  timestamp: number;
}

interface OperatorConfig {
  telegram: {
    link: string;
    allowed: boolean;
    explicit_ask_phrases: string[];
    threshold_rules: {
      interest_score_needed: number;
      score_rules: Record<string, number>;
    };
    templates: {
      telegram_send: string;
      clarify_ambiguous: string;
    };
    safety: {
      block_on_payment_requests: boolean;
      block_on_explicit_for_pay: boolean;
      escalate_on_underage: boolean;
    };
  };
  handover: {
    escalate_keywords: string[];
    fallback_message: string;
    bot_denial: string;
    refuse_personal: string;
  };
}

const EXPLICIT_ASK_OVERRIDES = ["t.me/", "telegram"];

const INTEREST_PHRASES = [
  "more?", "more pics", "more of this", "more of that",
  "got more", "show more", "want more", "need more",
];

const POSITIVE_REPLIES = [
  "yes please", "i'd love that", "yes", "yeah", "yess",
  "absolutely", "for sure", "definitely", "hell yeah",
  "please", "i want that", "send it",
];

const ENTHUSIASM_EMOJIS = ["🔥", "😍", "❤️", "💕", "😘", "🥵", "💦", "👀", "😏"];

export function sampleDelay(): number {
  const roll = Math.random();
  if (roll < 0.05) {
    return randomBetween(180_000, 600_000);
  }
  if (roll < 0.25) {
    return randomBetween(20_000, 40_000);
  }
  return randomBetween(60_000, 120_000);
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function computeInterestScore(
  messages: ConversationMessage[],
  currentMessage: string
): number {
  let score = 0;
  const lower = currentMessage.toLowerCase();

  if (INTEREST_PHRASES.some((p) => lower.includes(p))) {
    score += 1;
  }

  if (ENTHUSIASM_EMOJIS.some((e) => currentMessage.includes(e))) {
    score += 1;
  }

  if (POSITIVE_REPLIES.some((r) => lower.includes(r))) {
    score += 1;
  }

  const userMessages = messages.filter((m) => m.role === "user");
  const priorInterest = userMessages.filter((m) =>
    INTEREST_PHRASES.some((p) => m.text.toLowerCase().includes(p))
  ).length;
  if (priorInterest >= 1) {
    score += 1;
  }

  return score;
}

export function isExplicitAsk(
  message: string,
  phrases: string[]
): boolean {
  const lower = message.toLowerCase();

  if (EXPLICIT_ASK_OVERRIDES.some((o) => lower.includes(o))) {
    return true;
  }

  return phrases.some((phrase) => lower.includes(phrase));
}

export function runLaylaPipeline(
  inboundMessage: string,
  state: ConversationState,
  operatorConfig: OperatorConfig
): PipelineAction {
  const { telegram, handover } = operatorConfig;

  if (checkEscalationKeywords(inboundMessage, handover.escalate_keywords)) {
    console.log(`[LAYLA-PIPELINE] Escalation keyword detected for conv=${state.conversationId}`);
    return {
      type: "handover",
      reply: handover.fallback_message,
      delayMs: sampleDelay(),
      reason: "escalation_keyword",
      handoverPriority: "highest",
    };
  }

  const lower = inboundMessage.toLowerCase();
  const isBotQuestion =
    lower.includes("are you a bot") ||
    lower.includes("what tool made you") ||
    lower.includes("how are you built") ||
    lower.includes("are you real") ||
    lower.includes("you're a bot") ||
    lower.includes("youre a bot");

  if (isBotQuestion) {
    if (state.botDenialUsed) {
      return {
        type: "handover",
        reply: handover.fallback_message,
        delayMs: sampleDelay(),
        reason: "repeated_bot_probe",
        handoverPriority: "highest",
      };
    }
    return {
      type: "delay_then_send",
      reply: handover.bot_denial,
      delayMs: sampleDelay(),
      reason: "bot_denial",
    };
  }

  if (state.telegramOffered) {
    return {
      type: "delay_then_send",
      reply: "__LLM__",
      delayMs: sampleDelay(),
      reason: "continue_conversation",
    };
  }

  if (isExplicitAsk(inboundMessage, telegram.explicit_ask_phrases)) {
    const postResult = postProcessAndGuard(telegram.templates.telegram_send, operatorConfig);
    if (postResult.action === "handover") {
      return {
        type: "handover",
        reply: postResult.reply,
        delayMs: sampleDelay(),
        reason: "post_processor_block",
        handoverPriority: "highest",
      };
    }

    return {
      type: "delay_then_send",
      reply: postResult.reply,
      delayMs: sampleDelay(),
      reason: "explicit_ask",
      telegramOffered: true,
      auditLog: {
        conversationId: state.conversationId,
        userId: state.userId,
        interestScore: state.interestScore,
        reason: "explicit_ask",
        timestamp: Date.now(),
      },
    };
  }

  const newScore = state.interestScore + computeInterestScore(state.messages, inboundMessage);

  if (newScore >= telegram.threshold_rules.interest_score_needed) {
    const postResult = postProcessAndGuard(telegram.templates.telegram_send, operatorConfig);
    if (postResult.action === "handover") {
      return {
        type: "handover",
        reply: postResult.reply,
        delayMs: sampleDelay(),
        reason: "post_processor_block",
        handoverPriority: "highest",
      };
    }

    return {
      type: "delay_then_send",
      reply: postResult.reply,
      delayMs: sampleDelay(),
      reason: "threshold",
      telegramOffered: true,
      auditLog: {
        conversationId: state.conversationId,
        userId: state.userId,
        interestScore: newScore,
        reason: "threshold",
        timestamp: Date.now(),
      },
    };
  }

  const ambiguousPhrases = ["send more", "more", "show me more stuff"];
  const isAmbiguous = ambiguousPhrases.some((p) => lower === p || lower.includes(p));
  if (isAmbiguous && newScore < telegram.threshold_rules.interest_score_needed) {
    return {
      type: "delay_then_send",
      reply: telegram.templates.clarify_ambiguous,
      delayMs: sampleDelay(),
      reason: "clarify_ambiguous",
    };
  }

  return {
    type: "delay_then_send",
    reply: "__LLM__",
    delayMs: sampleDelay(),
    reason: "normal_conversation",
  };
}

export function logTelegramAudit(entry: TelegramAuditEntry): void {
  const masked = maskPiiForLogs(
    `[LAYLA-TELEGRAM-AUDIT] conv=${entry.conversationId} user=${entry.userId} score=${entry.interestScore} reason=${entry.reason}`
  );
  console.log(masked);
}
