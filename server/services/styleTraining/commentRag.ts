import { searchSimilarReplies, getEmbeddingCount } from "./embeddingPipeline";
import { analyzePersonaFromReplies, buildPersonaHeader, type PersonaProfile } from "./personaSpec";
import { aiChat } from "../../aiGateway";
import { isRepetitiveOpener, stripOpener } from "../validation/isRepetitiveOpener";

const personaCache = new Map<number, { profile: PersonaProfile; header: string; cachedAt: number }>();
const PERSONA_CACHE_TTL = 60 * 60 * 1000;
const MAX_RETRIES = 2;

async function getPersonaCached(subAccountId: number): Promise<{ profile: PersonaProfile; header: string }> {
  const cached = personaCache.get(subAccountId);
  if (cached && Date.now() - cached.cachedAt < PERSONA_CACHE_TTL) {
    return { profile: cached.profile, header: cached.header };
  }

  const profile = await analyzePersonaFromReplies(subAccountId);
  const header = buildPersonaHeader(profile);
  personaCache.set(subAccountId, { profile, header, cachedAt: Date.now() });
  return { profile, header };
}

function validateReply(reply: string, profile: PersonaProfile): { valid: boolean; reason: string } {
  const words = reply.split(/\s+/).length;

  if (words > 35) {
    return { valid: false, reason: "too_long" };
  }

  const formalPhrases = [
    "I appreciate", "Thank you for", "I understand your",
    "Please don't hesitate", "I'd be happy to", "Feel free to",
    "I hope this helps", "Best regards", "Kind regards",
    "Absolutely!", "Certainly!", "Of course!",
  ];
  const lower = reply.toLowerCase();
  for (const phrase of formalPhrases) {
    if (lower.includes(phrase.toLowerCase())) {
      return { valid: false, reason: "too_formal" };
    }
  }

  for (const forbidden of profile.forbiddenPhrases) {
    if (lower.includes(forbidden.toLowerCase())) {
      return { valid: false, reason: "forbidden_phrase" };
    }
  }

  return { valid: true, reason: "ok" };
}

function diversifyExamples(
  examples: Array<{ context: string; reply: string; similarity: number }>,
  maxCount: number,
): Array<{ context: string; reply: string; similarity: number }> {
  if (examples.length <= maxCount) return examples;

  const selected: typeof examples = [examples[0]];
  const used = new Set([0]);

  while (selected.length < maxCount && used.size < examples.length) {
    let bestIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < examples.length; i++) {
      if (used.has(i)) continue;

      const simScore = examples[i].similarity;
      const replyLen = examples[i].reply.split(/\s+/).length;
      const avgSelectedLen = selected.reduce((s, e) => s + e.reply.split(/\s+/).length, 0) / selected.length;
      const lenDiversity = Math.abs(replyLen - avgSelectedLen) / Math.max(avgSelectedLen, 1);

      const score = simScore * 0.7 + Math.min(lenDiversity * 0.3, 0.3);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;
    selected.push(examples[bestIdx]);
    used.add(bestIdx);
  }

  return selected;
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
): Promise<{ reply: string; sentiment: string; ragUsed: boolean; examplesCount: number; retries: number }> {
  const embeddingCount = await getEmbeddingCount(subAccountId);

  if (embeddingCount < 10) {
    return { reply: "", sentiment: "neutral", ragUsed: false, examplesCount: 0, retries: 0 };
  }

  let effectiveText = ctx.commentText;
  if (isRepetitiveOpener(ctx.commentText)) {
    console.log(`[RAG] Pure opener detected: "${ctx.commentText.substring(0, 40)}…" — using follow-up prompt`);
    const { profile, header: personaHeader } = await getPersonaCached(subAccountId);
    const openerReply = await aiChat(
      [
        { role: "system", content: `${personaHeader}\nSomeone just sent a short greeting or emoji. Reply casually in your style — invite them to say more. Max 15 words. No generic openers.` },
        { role: "user", content: `They said: "${ctx.commentText}"\nReply:` },
      ],
      { temperature: 0.9, maxTokens: 30 },
    );
    const reply = (openerReply?.text || "hey what's good 😊").replace(/^["']|["']$/g, "").trim();
    return { reply, sentiment: "neutral", ragUsed: true, examplesCount: 0, retries: 0 };
  }

  const { stripped, hadOpener } = stripOpener(effectiveText);
  if (hadOpener) {
    effectiveText = stripped;
    console.log(`[RAG] Stripped opener, using: "${effectiveText.substring(0, 50)}…"`);
  }

  const { profile, header: personaHeader } = await getPersonaCached(subAccountId);

  const rawSimilar = await searchSimilarReplies(subAccountId, effectiveText, 12);
  const similar = diversifyExamples(rawSimilar, 8);

  const examplesBlock = similar.map((s, i) =>
    `Example ${i + 1} (${(s.similarity * 100).toFixed(0)}% match):\n  Comment: "${s.context}"\n  Your reply: "${s.reply}"`
  ).join("\n\n");

  const wordBudget = Math.min(profile.medianReplyLength + 8, 35);

  const contextLines: string[] = [];
  if (ctx.postCaption) contextLines.push(`POST CONTEXT: "${ctx.postCaption.substring(0, 300)}"`);
  if (ctx.commenterName) contextLines.push(`COMMENTER: ${ctx.commenterName}`);
  contextLines.push(`PLATFORM: ${ctx.platform}`);
  contextLines.push(`COMMENT: "${effectiveText}"`);

  const buildSystemPrompt = (retryHint: string) => `${personaHeader}

YOUR REAL REPLIES (study these — your new reply must sound like these, not like a customer service bot):

${examplesBlock}

HARD CONSTRAINTS:
- Your reply MUST directly respond to what the person actually said. Read their message and reply to its content.
- Maximum ${wordBudget} words. Shorter is better. Your median is ${profile.medianReplyLength} words.
- Write EXACTLY like the examples above — same slang, same energy, same brevity.
- If the examples use "u" instead of "you", YOU must use "u".
- If the examples use lowercase, YOU must use lowercase.
- Mirror the commenter's energy: hype → hype, chill → chill, flirty → flirty.
- ONE reply only. No options, no alternatives.
${retryHint}
SAFETY:
- Urgent safety concern → "This looks serious — reach out to someone you trust right away."
- Never fabricate phone numbers, links, prices, or addresses.
- Never reveal you are AI. If asked, deflect naturally like: "lol what 😂"`;

  const userMessage = `${contextLines.join("\n")}

Reply in character. ${wordBudget} words max. Output ONLY the reply text.`;

  const sentimentPrompt = `Classify: positive, negative, neutral, question, complaint, praise.\nComment: "${ctx.commentText.substring(0, 200)}"\nONE word:`;

  let reply = "";
  let retries = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let retryHint = "";
    if (attempt === 1) retryHint = "\n⚠️ Your previous reply was too long or too formal. Be shorter and more casual this time.";
    if (attempt === 2) retryHint = "\n⚠️ STILL too formal. Copy the EXACT style from the examples. Use slang. Be brief. Under 20 words.";

    const replyResult = await aiChat(
      [
        { role: "system", content: buildSystemPrompt(retryHint) },
        { role: "user", content: userMessage },
      ],
      { temperature: 0.85 + attempt * 0.05, maxTokens: 60 },
    );

    reply = (replyResult?.text || "").replace(/^["']|["']$/g, "").trim();

    const validation = validateReply(reply, profile);
    if (validation.valid) break;

    console.log(`[RAG] Retry ${attempt + 1}: ${validation.reason} — "${reply.substring(0, 50)}..."`);
    retries++;
  }

  const sentimentResult = await aiChat(
    [{ role: "user", content: sentimentPrompt }],
    { temperature: 0, maxTokens: 10 },
  );
  const sentiment = (sentimentResult?.text || "neutral").toLowerCase().trim().split(/\s/)[0];

  return {
    reply,
    sentiment,
    ragUsed: true,
    examplesCount: similar.length,
    retries,
  };
}
