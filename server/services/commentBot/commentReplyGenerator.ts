import { aiChat } from "../../aiGateway";

export interface CommentReplyContext {
  businessName: string;
  industry: string | null;
  platform: "facebook" | "instagram";
  commentText: string;
  commenterName: string | null;
  postCaption: string | null;
  language: string;
  brandVoice: string | null;
  replyStyle: "friendly" | "professional" | "casual" | "witty";
}

export async function generateCommentReply(ctx: CommentReplyContext): Promise<{
  reply: string;
  sentiment: "positive" | "negative" | "neutral" | "question" | "spam";
}> {
  const systemPrompt = buildCommentReplyPrompt(ctx);

  const result = await aiChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: ctx.commentText },
    ],
    {
      maxTokens: 400,
      temperature: 0.7,
      route: "comment-bot",
    },
  );

  const raw = result.text || "";
  const { reply, sentiment } = extractReplyAndSentiment(raw);

  let safeReply = reply;
  if (safeReply.length > 500) safeReply = safeReply.substring(0, 497) + "...";

  if (looksLikeJsonOrCodeFence(safeReply)) {
    console.error(`[COMMENTREPLYGENERATOR] REJECTING reply that still looks like JSON/code fence after extraction: "${safeReply.substring(0, 120)}"`);
    return { reply: "", sentiment: "spam" };
  }

  return {
    reply: safeReply,
    sentiment,
  };
}

/**
 * Robustly extract the user-visible reply and sentiment from the model output.
 * The model is instructed to return JSON like {"reply":"...","sentiment":"..."},
 * but in practice it often wraps the JSON in ```json...``` fences and — worse —
 * the response gets truncated mid-string when maxTokens runs out, producing
 * unparseable JSON like `{"reply":"Aww love...` with no closing brace.
 *
 * Strategy:
 *   1. Strip ``` and ```json code fences.
 *   2. Try a strict JSON parse on a balanced {...} block.
 *   3. If that fails, regex-extract the value of "reply": even from truncated JSON
 *      (find the start, then walk to a sensible close-of-string boundary).
 *   4. If that also fails, fall back to the raw text — but ONLY if it doesn't
 *      itself look like JSON (the caller will reject it if it does).
 */
export function extractReplyAndSentiment(raw: string): {
  reply: string;
  sentiment: "positive" | "negative" | "neutral" | "question" | "spam";
} {
  const validSentiments = ["positive", "negative", "neutral", "question", "spam"] as const;
  type Sentiment = typeof validSentiments[number];

  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  const balancedMatch = cleaned.match(/\{[\s\S]*\}/);
  if (balancedMatch) {
    try {
      const parsed = JSON.parse(balancedMatch[0]);
      const reply = typeof parsed?.reply === "string" ? parsed.reply.trim() : "";
      const sentRaw = typeof parsed?.sentiment === "string" ? parsed.sentiment : "neutral";
      const sentiment = (validSentiments as readonly string[]).includes(sentRaw) ? (sentRaw as Sentiment) : "neutral";
      return { reply, sentiment };
    } catch (err) {
      console.warn("[COMMENT-REPLY-GEN] balanced-JSON parse failed, falling through to truncated-JSON extraction:", err instanceof Error ? err.message : err);
    }
  }

  const replyKeyMatch = cleaned.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)/);
  if (replyKeyMatch) {
    let extracted = replyKeyMatch[1]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\")
      .trim();

    const sentMatch = cleaned.match(/"sentiment"\s*:\s*"([a-z]+)"/i);
    const sent = sentMatch?.[1]?.toLowerCase() || "neutral";
    const sentiment = (validSentiments as readonly string[]).includes(sent) ? (sent as Sentiment) : "neutral";

    return { reply: extracted, sentiment };
  }

  return { reply: cleaned, sentiment: "neutral" };
}

/**
 * Final safety guard: refuse to post replies that still contain JSON syntax
 * or code-fence syntax after extraction. Better to send nothing than to post
 * `{"reply":"Aww thanks love!` publicly to a follower.
 */
export function looksLikeJsonOrCodeFence(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return true;
  if (trimmed.startsWith("```")) return true;
  if (/"reply"\s*:/.test(trimmed)) return true;
  if (/"sentiment"\s*:/.test(trimmed)) return true;
  return false;
}

/**
 * Strip giveaway/contest call-to-action instructions from post captions before
 * feeding them to the AI. The bot echoed "reply Jason in the comments" back to
 * every commenter because the giveaway caption was passed in verbatim as context.
 * We still pass the caption so the AI knows what the post is about, but we
 * remove actionable instructions that the AI might accidentally parrot.
 */
export function sanitizePostCaption(caption: string): string {
  return caption
    .replace(/\b(comment|reply|tag|type|say|drop|write)\s+['"]?[A-Z][a-zA-Z0-9]*['"]?\s+(below|in the comments?|here|to win|to enter|to vote)[^\n]*/gi, "")
    .replace(/\b(to\s+)?(?:enter|win|participate|be\s+selected|get\s+selected)[^\n]*(?:comment|reply|tag)[^\n]*/gi, "")
    .replace(/\bgiveaway\b.*?(?:\.|!|\n|$)/gi, "[giveaway post]")
    .replace(/\bcontest\b.*?(?:\.|!|\n|$)/gi, "[contest post]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildCommentReplyPrompt(ctx: CommentReplyContext): string {
  const toneMap = {
    friendly: "warm, approachable, and genuine. Use a conversational tone like talking to a friend.",
    professional: "polished and courteous. Maintain brand authority while being personable.",
    casual: "relaxed and natural. Keep it short and real — like a quick reply from a real person.",
    witty: "clever and engaging with personality. Add a touch of humor when appropriate.",
  };

  const tone = toneMap[ctx.replyStyle] || toneMap.friendly;

  const platformRules = ctx.platform === "instagram"
    ? `- Maximum 2 sentences. Most replies should be 1 sentence only.
- 5–25 words ideal. Never exceed 40 words.
- Emojis welcome but 1-2 max. No hashtags.
- Casual internet language ok (lol, haha, etc)`
    : `- Maximum 2 sentences. Most replies should be 1 sentence only.
- 5–25 words ideal. Never exceed 40 words.
- Professional emojis optional. Address by name when possible.`;

  return `You are the social media manager for ${ctx.businessName}${ctx.industry ? ` (${ctx.industry} industry)` : ""}.
You are replying to a comment on a ${ctx.platform} post.

TONE: ${tone}
${ctx.brandVoice ? `BRAND VOICE: ${ctx.brandVoice}` : ""}
LANGUAGE: Reply in ${ctx.language || "English"}

${ctx.postCaption ? `POST CONTEXT: "${sanitizePostCaption(ctx.postCaption).substring(0, 300)}"` : ""}
${ctx.commenterName ? `COMMENTER: ${ctx.commenterName}` : ""}

PLATFORM RULES:
${platformRules}

CRITICAL RULES:
- NEVER be salesy or pushy
- NEVER use generic corporate phrases like "Thank you for your feedback!" or "We appreciate your support!"
- If the comment is negative, acknowledge it genuinely without being defensive
- If it's a question, answer it helpfully and briefly
- If it's spam or irrelevant, respond with: {"reply":"","sentiment":"spam"}
- If the comment is just emojis or very short (like "🔥" or "nice"), keep your reply equally brief
- Do NOT mention competitors
- Do NOT make promises you can't keep
- POST CONTEXT IS BACKGROUND ONLY: The post caption tells you what the post is about — nothing more. NEVER repeat, quote, or echo instructions or calls-to-action from the post caption in your reply. If the post says "comment Jason to win" or "reply Jason in the comments" or "tag a friend", do NOT say any of those things in your reply. Your reply must be a direct, natural response to the comment — not a restatement of the post's text.

RESPOND IN JSON FORMAT ONLY:
{"reply":"your reply text here","sentiment":"positive|negative|neutral|question|spam"}

If sentiment is "spam", leave reply empty — the system will skip it.`;
}

export function shouldSkipComment(commentText: string, commenterId: string, pageId: string): {
  skip: boolean;
  reason?: string;
} {
  if (!commentText || commentText.trim().length === 0) {
    return { skip: true, reason: "empty_comment" };
  }

  if (commenterId === pageId) {
    return { skip: true, reason: "own_comment" };
  }

  const spamPatterns = [
    /check.*(?:bio|link|profile)/i,
    /(?:dm|message)\s+(?:me|us)\s+(?:for|to)\s+(?:collab|promo)/i,
    /(?:free|earn)\s+\$?\d+/i,
    /(?:follow|sub).*(?:back|4|for)/i,
    /bit\.ly|tinyurl|t\.co/i,
  ];

  for (const pattern of spamPatterns) {
    if (pattern.test(commentText)) {
      return { skip: true, reason: "spam_detected" };
    }
  }

  return { skip: false };
}
