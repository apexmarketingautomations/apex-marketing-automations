export type ResponseType = "text" | "voice" | "none";
export type ResponseTiming = "immediate" | "delayed";
export type ResponseTone = "neutral" | "playful" | "direct";

export interface StrategyInput {
  channel: "sms" | "whatsapp" | "messenger" | "instagram" | "web" | string;
  incomingMessage: string;
  threadHistory: Array<{ role: "user" | "assistant"; content: string }>;
  replyText?: string | null;
  voiceMemoEligible?: boolean;
}

export interface ResponseStrategy {
  type: ResponseType;
  timing: ResponseTiming;
  delayMs: number;
  tone: ResponseTone;
  voiceMemo: {
    consider: boolean;
    reason: string;
  };
  reasons: string[];
}

const ACK_TOKENS = new Set([
  "ok","okay","okk","kk","k","thx","thanks","thank","ty","tysm","tyvm","got","it",
  "cool","nice","sure","yep","yes","nope","no","sounds","good","great","awesome",
  "perfect","alright","right","gotcha","copy","roger","fine","word","bet",
]);
const ACK_EMOJI = /^[👍🙏❤️🔥😂🤣👌🙌💯✨😊]+$/u;
function isPureAckMessage(raw: string): boolean {
  const stripped = raw.replace(/[.!?,'"`~\-]+/g, " ").trim();
  if (!stripped) return false;
  if (ACK_EMOJI.test(stripped)) return true;
  const tokens = stripped.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) return false;
  return tokens.every(t => ACK_TOKENS.has(t) || ACK_EMOJI.test(t));
}
const PLAYFUL_HINTS = /\b(lol|lmao|haha+|hehe+|hey+|yo|sup)\b|[😂🤣😅😆😊😍🥰😘🔥💯✨🙌👍❤️]/i;
const DIRECT_HINTS = /\b(asap|urgent|immediately|right now|today|need(ed)? now|emergency)\b/i;
const QUESTION = /\?|^(who|what|when|where|why|how|can|could|do|does|did|is|are|will|would|should|may)\b/i;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function decideResponseStrategy(input: StrategyInput): ResponseStrategy {
  const reasons: string[] = [];
  const msg = (input.incomingMessage || "").trim();
  const len = msg.length;
  const threadCount = input.threadHistory?.length || 0;
  const userMsgs = (input.threadHistory || []).filter(m => m.role === "user").length;
  const lastAssistant = [...(input.threadHistory || [])].reverse().find(m => m.role === "assistant")?.content || "";
  const lastAssistantLen = lastAssistant.length;
  const hasQuestion = QUESTION.test(msg);
  const isPureAck = isPureAckMessage(msg);
  const playful = PLAYFUL_HINTS.test(msg);
  const direct = DIRECT_HINTS.test(msg);

  let type: ResponseType = "text";
  if (isPureAck && lastAssistantLen > 0 && !hasQuestion && userMsgs >= 2) {
    type = "none";
    reasons.push("pure_ack_after_prior_reply");
  }

  let tone: ResponseTone = "neutral";
  if (direct || (hasQuestion && len < 40)) {
    tone = "direct";
    reasons.push(direct ? "direct_keyword" : "short_question");
  } else if (playful || (len > 0 && len <= 12 && !hasQuestion)) {
    tone = "playful";
    reasons.push(playful ? "playful_signal" : "very_short_casual");
  }

  let timing: ResponseTiming = "immediate";
  let delayMs = 0;
  if (type === "text" && !hasQuestion && !direct) {
    if (len <= 25) {
      timing = "delayed";
      delayMs = 1500 + Math.floor(Math.random() * 1500);
      reasons.push("short_casual_jitter");
    } else if (threadCount >= 4) {
      timing = "delayed";
      delayMs = 800 + Math.floor(Math.random() * 1200);
      reasons.push("midthread_natural_pause");
    }
  }
  if (direct || hasQuestion) {
    delayMs = 0;
    timing = "immediate";
  }
  delayMs = clamp(delayMs, 0, 4000);

  let voiceConsider = false;
  let voiceReason = "not_eligible";
  if (input.voiceMemoEligible && type !== "none") {
    const replyLen = (input.replyText || "").length;
    if (threadCount >= 3 && replyLen > 0 && replyLen <= 280 && !direct) {
      voiceConsider = true;
      voiceReason = "midthread_short_reply";
    } else if (replyLen > 280) {
      voiceReason = "reply_too_long";
    } else if (threadCount < 3) {
      voiceReason = "thread_too_early";
    } else if (direct) {
      voiceReason = "direct_request_text_only";
    }
  }

  return {
    type,
    timing,
    delayMs,
    tone,
    voiceMemo: { consider: voiceConsider, reason: voiceReason },
    reasons,
  };
}

export function summarizeStrategy(s: ResponseStrategy): string {
  return `type=${s.type} timing=${s.timing} delay=${s.delayMs}ms tone=${s.tone} voice=${s.voiceMemo.consider}(${s.voiceMemo.reason}) reasons=[${s.reasons.join(",")}]`;
}
