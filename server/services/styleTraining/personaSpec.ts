import { db } from "../../db";
import { sql } from "drizzle-orm";

export interface PersonaProfile {
  abbreviations: Record<string, string>;
  avgReplyLength: number;
  medianReplyLength: number;
  emojiFrequency: number;
  questionEndingRatio: number;
  commonOpeners: string[];
  forbiddenPhrases: string[];
  signaturePatterns: string[];
  rules: string[];
}

export async function analyzePersonaFromReplies(subAccountId: number): Promise<PersonaProfile> {
  const result = await db.execute(sql`
    SELECT body FROM messages
    WHERE sub_account_id = ${subAccountId}
      AND direction = 'outbound'
      AND status = 'delivered'
      AND channel IN ('facebook', 'instagram')
      AND body NOT LIKE 'https://%'
      AND body NOT LIKE '[voice memo]%'
      AND LENGTH(body) > 3
    ORDER BY created_at DESC
    LIMIT 1000
  `) as any;

  const replies: string[] = (result.rows || result).map((r: any) => r.body as string);

  const abbreviationCounts: Record<string, number> = {};
  const knownAbbreviations: Record<string, string> = {
    "u": "you", "ur": "your/you're", "tht": "that", "hru": "how are you",
    "rn": "right now", "bc": "because", "imo": "in my opinion", "tbh": "to be honest",
    "ngl": "not gonna lie", "lmk": "let me know", "hmu": "hit me up",
    "omg": "oh my god", "smh": "shaking my head", "ik": "I know",
    "idk": "I don't know", "wyd": "what you doing", "lol": "laugh out loud",
    "brb": "be right back", "pls": "please", "thx": "thanks",
    "gonna": "going to", "wanna": "want to", "gotta": "got to",
    "tryna": "trying to", "dm": "direct message",
  };

  let emojiCount = 0;
  let questionCount = 0;
  const lengths: number[] = [];
  const openerCounts: Record<string, number> = {};
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

  for (const reply of replies) {
    const words = reply.toLowerCase().split(/\s+/);
    lengths.push(words.length);

    for (const word of words) {
      const clean = word.replace(/[^a-z]/g, "");
      if (knownAbbreviations[clean]) {
        abbreviationCounts[clean] = (abbreviationCounts[clean] || 0) + 1;
      }
    }

    const emojis = reply.match(emojiRegex);
    if (emojis) emojiCount += emojis.length;

    if (reply.trim().endsWith("?")) questionCount++;

    const firstThreeWords = words.slice(0, 3).join(" ").replace(/[^a-z\s]/g, "").trim();
    if (firstThreeWords.length > 1) {
      openerCounts[firstThreeWords] = (openerCounts[firstThreeWords] || 0) + 1;
    }
  }

  const totalReplies = replies.length || 1;

  const usedAbbreviations: Record<string, string> = {};
  for (const [abbr, count] of Object.entries(abbreviationCounts)) {
    if (count >= 3) {
      usedAbbreviations[abbr] = knownAbbreviations[abbr];
    }
  }

  const sortedOpeners = Object.entries(openerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .filter(([, count]) => count >= 3)
    .map(([opener]) => opener);

  lengths.sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)] || 15;
  const avg = lengths.reduce((a, b) => a + b, 0) / totalReplies;

  return {
    abbreviations: usedAbbreviations,
    avgReplyLength: Math.round(avg),
    medianReplyLength: median,
    emojiFrequency: Math.round((emojiCount / totalReplies) * 100) / 100,
    questionEndingRatio: Math.round((questionCount / totalReplies) * 100) / 100,
    commonOpeners: sortedOpeners,
    forbiddenPhrases: [
      "I'm just an AI", "As an AI assistant", "I don't have feelings",
      "liability", "waiver", "attorney", "legal advice",
      "I cannot", "I'm unable to", "Unfortunately, I",
      "Here's what I found", "Based on my training data",
      "As a language model", "I apologize for any inconvenience",
    ],
    signaturePatterns: [
      "Short sentences preferred (8-25 words for DMs, up to 40 for complex topics)",
      "Contractions encouraged (I'm, gonna, wanna)",
      "Conversational tone, not corporate",
    ],
    rules: buildPersonaRules(usedAbbreviations, sortedOpeners, avg, median, emojiCount / totalReplies, questionCount / totalReplies),
  };
}

function buildPersonaRules(
  abbreviations: Record<string, string>,
  openers: string[],
  avgLen: number,
  medianLen: number,
  emojiRate: number,
  questionRate: number,
): string[] {
  const rules: string[] = [];

  rules.push(`Keep replies around ${Math.round(medianLen)} words (median) to ${Math.round(avgLen)} words (average). Never exceed 40 words for comments.`);

  if (Object.keys(abbreviations).length > 0) {
    const top = Object.entries(abbreviations).slice(0, 8).map(([k, v]) => `${k}→${v}`).join(", ");
    rules.push(`Use casual abbreviations naturally: ${top}`);
  }

  if (openers.length > 0) {
    rules.push(`Frequently opens with: "${openers.slice(0, 5).join('", "')}". Use these ~20-30% of time.`);
  }

  if (emojiRate < 0.3) {
    rules.push("Rarely uses emojis. Only mirror the commenter's emoji usage.");
  } else if (emojiRate < 1) {
    rules.push("Occasionally uses emojis (about one per reply). Match commenter energy.");
  }

  if (questionRate > 0.2) {
    rules.push("Often asks follow-up questions to continue conversation.");
  }

  rules.push("Confident, empathetic, slightly street-wise tone. Never clinical or robotic.");
  rules.push("Never use legal/advice terms (liability, waiver, attorney). Never reveal being AI.");
  rules.push("Never fabricate phone numbers, links, or addresses. Ask a clarifying question instead.");

  return rules;
}

export function buildPersonaHeader(profile: PersonaProfile): string {
  const lines: string[] = [
    "PERSONA RULES (follow strictly):",
    "",
  ];

  for (let i = 0; i < profile.rules.length; i++) {
    lines.push(`${i + 1}. ${profile.rules[i]}`);
  }

  if (profile.forbiddenPhrases.length > 0) {
    lines.push("");
    lines.push(`FORBIDDEN PHRASES (never use): ${profile.forbiddenPhrases.slice(0, 10).join(", ")}`);
  }

  return lines.join("\n");
}
