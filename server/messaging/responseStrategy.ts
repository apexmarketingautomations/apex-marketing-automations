export type ResponseType = "text" | "voice" | "none";
export type ResponseTiming = "immediate" | "delayed";
export type ResponseTone = "neutral" | "playful" | "direct";

export interface StrategyInput {
  channel: "sms" | "whatsapp" | "messenger" | "instagram" | "web" | string;
  incomingMessage: string;
  threadHistory: Array<{ role: "user" | "assistant"; content: string }>;
  replyText?: string | null;
  voiceMemoEligible?: boolean;
  priorVoiceCount?: number;
}

export type VoiceRecommendation = "send" | "hold" | "skip";
export type ConversationStage = "cold_open" | "warming" | "engaged" | "deep" | "stalled";

export interface ResponseStrategy {
  type: ResponseType;
  timing: ResponseTiming;
  delayMs: number;
  tone: ResponseTone;
  stage: ConversationStage;
  voiceMemo: {
    consider: boolean;
    recommendation: VoiceRecommendation;
    score: number;
    reason: string;
    factors: string[];
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

function detectStage(threadCount: number, userMsgs: number, assistantMsgs: number): ConversationStage {
  if (threadCount === 0 || userMsgs <= 1) return "cold_open";
  if (assistantMsgs >= 1 && userMsgs <= 2) return "warming";
  if (userMsgs >= 5 && assistantMsgs >= 4) return "deep";
  if (userMsgs >= 3) return "engaged";
  return "warming";
}

function recentlyVoiced(history: Array<{ role: "user" | "assistant"; content: string }>, lookback: number): boolean {
  const tail = history.slice(-lookback);
  return tail.some(h => h.role === "assistant" && /^\s*\[voice memo\]/i.test(h.content || ""));
}

export function decideResponseStrategy(input: StrategyInput): ResponseStrategy {
  const reasons: string[] = [];
  const msg = (input.incomingMessage || "").trim();
  const len = msg.length;
  const history = input.threadHistory || [];
  const threadCount = history.length;
  const userMsgs = history.filter(m => m.role === "user").length;
  const assistantMsgs = history.filter(m => m.role === "assistant").length;
  const lastAssistant = [...history].reverse().find(m => m.role === "assistant")?.content || "";
  const lastAssistantLen = lastAssistant.length;
  const hasQuestion = QUESTION.test(msg);
  const isPureAck = isPureAckMessage(msg);
  const playful = PLAYFUL_HINTS.test(msg);
  const direct = DIRECT_HINTS.test(msg);
  const priorVoiceCount = input.priorVoiceCount ?? history.filter(h => h.role === "assistant" && /^\s*\[voice memo\]/i.test(h.content || "")).length;
  const stage = detectStage(threadCount, userMsgs, assistantMsgs);
  const replyLen = (input.replyText || "").length;
  const replyHasUrl = /https?:\/\//i.test(input.replyText || "");

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

  // ---- Voice decision (additive layer; never relaxes existing probability gating) ----
  const factors: string[] = [];
  let score = 0;
  let voiceReason = "not_eligible";
  let recommendation: VoiceRecommendation = "skip";

  const hardBlockers: string[] = [];
  if (!input.voiceMemoEligible) hardBlockers.push("channel_not_eligible");
  if (type === "none") hardBlockers.push("reply_suppressed");
  if (replyLen === 0) hardBlockers.push("empty_reply");
  if (replyLen > 280) hardBlockers.push("reply_too_long");
  if (replyHasUrl) hardBlockers.push("reply_contains_url");
  if (direct) hardBlockers.push("direct_request_text_only");
  if (priorVoiceCount >= 2) hardBlockers.push("voice_cap_reached");

  if (hardBlockers.length === 0) {
    // Stage scoring — voice fits mid-conversation, not openers
    if (stage === "cold_open") { score -= 3; factors.push("stage:cold_open(-3)"); }
    else if (stage === "warming") { score -= 1; factors.push("stage:warming(-1)"); }
    else if (stage === "engaged") { score += 2; factors.push("stage:engaged(+2)"); }
    else if (stage === "deep") { score += 3; factors.push("stage:deep(+3)"); }
    else if (stage === "stalled") { score += 1; factors.push("stage:stalled(+1)"); }

    // Engagement signal — playful tone & casual incoming → voice fits
    if (playful) { score += 2; factors.push("playful(+2)"); }
    if (len > 0 && len <= 40) { score += 1; factors.push("short_incoming(+1)"); }
    if (len > 200) { score -= 1; factors.push("long_incoming(-1)"); }

    // Reply shape — short condensable replies favor voice
    if (replyLen > 0 && replyLen <= 120) { score += 2; factors.push("short_reply(+2)"); }
    else if (replyLen > 120 && replyLen <= 280) { score += 1; factors.push("medium_reply(+1)"); }

    // Question handling — let users with real questions get text they can re-read
    if (hasQuestion) { score -= 1; factors.push("user_question(-1)"); }

    // Repetition guard — if last 3 assistant turns already had voice, prefer text now
    if (recentlyVoiced(history, 3)) { score -= 2; factors.push("recent_voice(-2)"); }
    if (priorVoiceCount === 1) { score -= 1; factors.push("one_prior_voice(-1)"); }

    // Engagement depth — sustained back-and-forth is prime voice territory
    if (userMsgs >= 4 && assistantMsgs >= 3) { score += 1; factors.push("sustained_engagement(+1)"); }

    if (score >= 4) { recommendation = "send"; voiceReason = `score=${score}_send_threshold`; }
    else if (score >= 2) { recommendation = "hold"; voiceReason = `score=${score}_borderline`; }
    else { recommendation = "skip"; voiceReason = `score=${score}_below_threshold`; }
  } else {
    voiceReason = hardBlockers[0];
    factors.push(...hardBlockers.map(b => `block:${b}`));
  }

  const voiceConsider = recommendation !== "skip";

  return {
    type,
    timing,
    delayMs,
    tone,
    stage,
    voiceMemo: { consider: voiceConsider, recommendation, score, reason: voiceReason, factors },
    reasons,
  };
}

export function summarizeStrategy(s: ResponseStrategy): string {
  return `type=${s.type} timing=${s.timing} delay=${s.delayMs}ms tone=${s.tone} stage=${s.stage} voice=${s.voiceMemo.recommendation}(score=${s.voiceMemo.score},${s.voiceMemo.reason}) reasons=[${s.reasons.join(",")}]`;
}
