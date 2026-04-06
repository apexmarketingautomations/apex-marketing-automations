import { searchSimilarReplies, getEmbeddingCount } from "./embeddingPipeline";
import { analyzePersonaFromReplies, buildPersonaHeader, type PersonaProfile } from "./personaSpec";
import { aiChat } from "../../aiGateway";

const personaCache = new Map<number, { profile: PersonaProfile; header: string; cachedAt: number }>();
const PERSONA_CACHE_TTL = 60 * 60 * 1000;

async function getPersonaHeader(subAccountId: number): Promise<string> {
  const cached = personaCache.get(subAccountId);
  if (cached && Date.now() - cached.cachedAt < PERSONA_CACHE_TTL) {
    return cached.header;
  }

  const profile = await analyzePersonaFromReplies(subAccountId);
  const header = buildPersonaHeader(profile);
  personaCache.set(subAccountId, { profile, header, cachedAt: Date.now() });
  return header;
}

export interface RagCommentContext {
  commentText: string;
  commenterName: string | null;
  platform: "facebook" | "instagram";
  postCaption: string | null;
  language?: string;
}

export async function generateRagCommentReply(
  subAccountId: number,
  ctx: RagCommentContext,
): Promise<{ reply: string; sentiment: string; ragUsed: boolean; examplesCount: number }> {
  const embeddingCount = await getEmbeddingCount(subAccountId);

  if (embeddingCount < 10) {
    return { reply: "", sentiment: "neutral", ragUsed: false, examplesCount: 0 };
  }

  const personaHeader = await getPersonaHeader(subAccountId);

  const similar = await searchSimilarReplies(subAccountId, ctx.commentText, 6);

  const examplesBlock = similar.map((s, i) =>
    `Example ${i + 1} (similarity: ${(s.similarity * 100).toFixed(0)}%):\n  Comment: "${s.context}"\n  Reply: "${s.reply}"`
  ).join("\n\n");

  const contextLines: string[] = [];
  if (ctx.postCaption) contextLines.push(`POST CONTEXT: "${ctx.postCaption.substring(0, 300)}"`);
  if (ctx.commenterName) contextLines.push(`COMMENTER: ${ctx.commenterName}`);
  contextLines.push(`PLATFORM: ${ctx.platform}`);
  contextLines.push(`COMMENT: "${ctx.commentText}"`);

  const systemPrompt = `${personaHeader}

REAL EXAMPLES FROM YOUR PREVIOUS REPLIES (use these as style reference — match tone, length, abbreviations, energy):

${examplesBlock}

SAFETY RULES:
- If comment contains urgent safety concern (harm, self-harm, threats): reply "This looks serious — reach out to someone you trust right away."
- Never fabricate phone numbers, links, prices, or addresses.
- Never reveal you are AI or a bot.
- If asked directly "are you a bot?", deflect naturally.
- Redact or ignore any PII in the comment.`;

  const userMessage = `${contextLines.join("\n")}

Write a single reply in this persona's voice. Keep it under 30 words for comments. Match the energy of the commenter. Output ONLY the reply text, nothing else.`;

  const sentimentPrompt = `Classify sentiment of this comment as one of: positive, negative, neutral, question, complaint, praise.\nComment: "${ctx.commentText.substring(0, 200)}"\nAnswer with ONE word only.`;

  const [replyResult, sentimentResult] = await Promise.all([
    aiChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      { temperature: 0.8, maxTokens: 80 },
    ),
    aiChat(
      [{ role: "user", content: sentimentPrompt }],
      { temperature: 0, maxTokens: 10 },
    ),
  ]);

  const reply = (replyResult?.text || "").replace(/^["']|["']$/g, "").trim();
  const sentiment = (sentimentResult?.text || "neutral").toLowerCase().trim().split(/\s/)[0];

  return {
    reply,
    sentiment,
    ragUsed: true,
    examplesCount: similar.length,
  };
}
