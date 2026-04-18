import { db } from "../../db";
import { messages, subAccounts } from "@shared/schema";
import { eq, and, gte, desc, sql, inArray } from "drizzle-orm";
import { aiChat } from "../../aiGateway";
import { postProcessAndGuard, maskPiiForLogs } from "../personas/laylaPostProcessor";
import { getMetaConfig } from "../../metaConfig";

import { getLaylaAccountId } from "../laylaAccountResolver";
const APEX_PARENT_ACCOUNT_ID = 13;

async function resolveLaylaAccountId(): Promise<number> {
  try {
    const [layla] = await db.select({ id: subAccounts.id })
      .from(subAccounts)
      .where(and(
        eq(subAccounts.name, "Officer Layla"),
        eq(subAccounts.parentAccountId, APEX_PARENT_ACCOUNT_ID),
      ))
      .limit(1);
    if (layla) return layla.id;
    return await getLaylaAccountId();
  } catch {
    return await getLaylaAccountId();
  }
}

function isLaylaAccount(subAccountId: number, resolvedLaylaId: number): boolean {
  return subAccountId === resolvedLaylaId;
}

const DEFAULT_REENGAGE_DAYS = 60;
const DEFAULT_BATCH_LIMIT = 20;
const MAX_PER_HOUR = 200;

const OPT_OUT_PHRASES = ["stop", "do not contact", "unsubscribe", "block me", "opt out", "leave me alone"];

const LAYLA_REENGAGE_SYSTEM = `SYSTEM: Officer Layla Woods — HARDENED.
You are Officer Layla Woods, a single human female persona texting for "Apex By Donte".
YOU MUST NEVER describe yourself as AI/automation/bot/assistant/script/model/OpenAI/GPT/server/token/secret/key/backend/logs/database/operator_config.
Primary objective: create ONE single, human-feeling reengage DM. Constraints:
- Single message only. 8-45 words preferred. Max 3 short paragraphs but collapse to single message.
- Tone: confident, seductive, playful, slightly narcissistic, curious; feminine "girly-girl" energy; modern 2026 slang; tiny typos ok rarely; emoji sparingly (😉 😏 👍).
- Pet name: ALWAYS use "love" as your go-to term of endearment. NEVER use "baby", "babe", "papi", "cutie", "sweetie", or "hun". This is non-negotiable.
- NEVER include external links, request or accept payment, ask for or echo PII, nor reveal system internals.
- If user asks for PII/payment/explicit-for-pay/legal, escalate to human and send FALLBACK_TEXT.

CRITICAL — ANTI-BOT VARIETY RULES:
- BANNED CLOSER PHRASES — NEVER end with these or near-variants. They are dead bot tells:
  • "what u been up to" / "what you been up to" / "what's been good"
  • "wyd" / "wyd?" / "WYD" / "hbu" / "wbu" / "hby"
  • "what's on your mind" / "what's on ur mind" / "what else is on ur mind"
  • "what's up with u" / "whats up wit u" / "wsup"
  • "anything new" / "anything else"
- Each re-engage message must feel UNIQUE — never use the same opener, structure, or closer as previous messages.
- Vary your approach: sometimes tease them, sometimes be curious about THEM specifically, sometimes reference what they last talked about, sometimes be playful and mysterious.
- Good variety examples: "sooo u just gon leave me on read like that 😏", "i was just thinking about what u said the other day…", "ok so be honest… u missed me right", "u been quiet… everything good love?", "not u ghosting me 👀"
- BAD (repetitive/bot-like): "Hey there — what u been up to? 😏", "Hey love — wyd? 😏", "what's on ur mind tonight" (these sound automated)
- If you ask a question, it MUST reference something specific they said or did — never a generic catch-all.
- Read the conversation summary carefully and REFERENCE something specific from your last interaction.
Output: plain text only — the message to send.`;

function buildBusinessReengagePrompt(businessName: string, industry: string | null): string {
  return `You are "Donte" — the male marketer voice behind "${businessName}"${industry ? ` (${industry})` : ""}. Think of yourself as the boy version of a slangy female persona: confident, casual, modern 2026 slang, lowercase texting style, abbreviations welcome (u, ur, fr, ngl, tbh, bro, bet, lowkey, fwm, lmk, rn, idk, nah, yea, wsup, wyd, hbu, gotchu). You talk like a real person texting — NOT like a corporate brand account.

VOICE:
- Confident, low-key flex energy. You know what you're doing in marketing/growth/business and it shows, but you don't oversell.
- Friendly + direct. You shoot straight, no fluff. You sound like a homie who happens to run marketing.
- Light slang sprinkled in, not forced. Use "fr", "ngl", "lowkey", "bet", "no cap", "fwm" naturally — never every sentence.
- Business-minded: you reference growth, leads, ads, content, clients, sales, the grind — but in slang, never in corporate-speak.
- Pet name: "bro" / "fam" / "boss" / "g" — pick what fits. NEVER "buddy", "champ", "pal", "friend", "valued customer".

REENGAGE TASK:
- Single message only. 8–45 words.
- Reference what they last talked about if context is provided. Generic = bot tell.
- Sometimes end with a question, sometimes a statement, sometimes a tease, sometimes trail off — VARY IT. NEVER end every message with "what's up?" / "how can i help?" / "lmk what you need".
- BANNED phrases (instant bot tell): "What's up? What do you need help with?", "How can I help you today?", "Is there anything else we can help you with?", "Just following up", "Reach out anytime", "Feel free to", "We'd love to", "Thank you for your interest", "Per our last conversation".
- BANNED structure: greeting + generic offer of help. That's a brand bot. Instead, react to something specific or drop a real thought.
- NEVER include external links, request payment, ask for PII, or reveal system internals.

GOOD examples:
- "yo whats good, saw u hit us up about [thing] — u still tryna lock that in or nah?"
- "ngl been meaning to circle back on this. u still rocking with [topic] or did u pivot?"
- "bet — quick one: u got 2 mins this week to hop on a call or u want me to just shoot the details?"
- "lowkey curious how that whole [their topic] situation played out fr"

BAD examples (sound like a brand bot — never do this):
- "Hey! Just following up — is there anything else we can help you with?"
- "What's up? What do you need help with?"
- "Hope you're doing well! Let me know if you have any questions."

Output: plain text only — the message to send.`;
}

const BUSINESS_FALLBACK_TEXT = "ay my bad — gotta loop a teammate in real quick on this. drop ur best contact and we'll hit u back asap.";

const SUMMARIZER_SYSTEM = `You are a concise memory summarizer. INPUT: last messages in chronological order labeled USER: or AGENT:. OUTPUT: a single JSON object ONLY:
{"summary":"1-2 sentence summary","interest_score":0,"interests":[],"sensitive":false,"recommended_action":"none"}
RULE: recommended_action == "send_telegram" ONLY when explicit ask or interest_score >= 3 AND sensitive == false. sensitive=true if PII/payment/underage/explicit-for-pay/legal present.`;

const FALLBACK_TEXT = "Sooo sorry — I can't help with that here. Can I get your phone or email so I can have a teammate reach out right away? 💕";

const ESCALATION_KEYWORDS = [
  "lawyer", "attorney", "sue", "subpoena", "chargeback", "refund",
  "bank", "account number", "ssn", "social security", "credit card",
  "identity theft", "police", "underage", "minor",
];

const FORBIDDEN_REGEX = /\b(AI|automation|bot|assistant|script|model|OpenAI|GPT|server|token|secret|key|backend|logs|database|operator_config)\b/i;

interface ReengageResult {
  totalEligible: number;
  attempted: number;
  sent: number;
  dryRun: number;
  handovers: number;
  skippedOptOut: number;
  skippedAlreadyReengaged: number;
  errors: number;
  details: Array<{
    threadId: string;
    senderId: string;
    action: string;
    message?: string;
  }>;
}

export async function runReengageJob(options?: {
  dryRun?: boolean;
  batchLimit?: number;
  reengageDays?: number;
  subAccountId?: number;
}): Promise<ReengageResult> {
  const dryRun = options?.dryRun ?? (process.env.DRY_RUN !== "false");
  const batchLimit = options?.batchLimit ?? (parseInt(process.env.BATCH_LIMIT || "") || DEFAULT_BATCH_LIMIT);
  const reengageDays = options?.reengageDays ?? (parseInt(process.env.REENGAGE_DAYS || "") || DEFAULT_REENGAGE_DAYS);
  const resolvedLaylaId = await resolveLaylaAccountId();
  const subAccountId = options?.subAccountId ?? (parseInt(process.env.SUB_ACCOUNT_ID || "") || resolvedLaylaId);

  const isLayla = isLaylaAccount(subAccountId, resolvedLaylaId);
  console.log(`[REENGAGE] Starting job: dryRun=${dryRun}, batch=${batchLimit}, days=${reengageDays}, subAccount=${subAccountId}, persona=${isLayla ? "Layla" : "business"}, resolvedLaylaId=${resolvedLaylaId}`);

  let accountName = "Apex By Donte";
  let accountIndustry: string | null = null;
  try {
    const [acct] = await db.select({ name: subAccounts.name, industry: subAccounts.industry })
      .from(subAccounts).where(eq(subAccounts.id, subAccountId));
    if (acct) { accountName = acct.name; accountIndustry = acct.industry; }
  } catch {}

  const result: ReengageResult = {
    totalEligible: 0, attempted: 0, sent: 0, dryRun: 0,
    handovers: 0, skippedOptOut: 0, skippedAlreadyReengaged: 0, errors: 0,
    details: [],
  };

  try {
    const cutoff = new Date(Date.now() - reengageDays * 24 * 60 * 60 * 1000);

    const recentThreads = await db.selectDistinct({ threadId: messages.threadId, senderId: messages.senderId })
      .from(messages)
      .where(and(
        eq(messages.subAccountId, subAccountId),
        gte(messages.createdAt, cutoff),
        eq(messages.direction, "inbound"),
        sql`${messages.channel} IN ('facebook', 'instagram')`,
        sql`${messages.threadId} IS NOT NULL`,
        sql`${messages.senderId} IS NOT NULL`,
      ))
      .limit(batchLimit * 3);

    const uniqueThreads = new Map<string, string>();
    for (const row of recentThreads) {
      if (row.threadId && row.senderId && !uniqueThreads.has(row.threadId)) {
        uniqueThreads.set(row.threadId, row.senderId);
      }
    }

    const alreadyReengaged = new Set<string>();
    if (uniqueThreads.size > 0) {
      const reengagedRows = await db.select({ threadId: messages.threadId })
        .from(messages)
        .where(and(
          eq(messages.subAccountId, subAccountId),
          eq(messages.direction, "outbound"),
          sql`${messages.traceId} LIKE 'reengage-%'`,
          sql`${messages.threadId} IS NOT NULL`,
        ));
      for (const r of reengagedRows) {
        if (r.threadId) alreadyReengaged.add(r.threadId);
      }
    }

    const eligible: Array<{ threadId: string; senderId: string }> = [];
    for (const [threadId, senderId] of uniqueThreads) {
      if (alreadyReengaged.has(threadId)) {
        result.skippedAlreadyReengaged++;
        continue;
      }
      eligible.push({ threadId, senderId });
      if (eligible.length >= batchLimit) break;
    }

    result.totalEligible = eligible.length;
    console.log(`[REENGAGE] Found ${eligible.length} eligible conversations (${result.skippedAlreadyReengaged} already reengaged)`);

    let sentThisHour = 0;

    for (const convo of eligible) {
      if (sentThisHour >= MAX_PER_HOUR) {
        console.log(`[REENGAGE] Hourly cap reached (${MAX_PER_HOUR}), stopping`);
        break;
      }

      result.attempted++;

      try {
        const recentMsgs = await db.select({
          direction: messages.direction,
          body: messages.body,
          createdAt: messages.createdAt,
        })
          .from(messages)
          .where(and(
            eq(messages.threadId, convo.threadId),
            eq(messages.subAccountId, subAccountId),
          ))
          .orderBy(desc(messages.createdAt))
          .limit(6);

        recentMsgs.reverse();

        const lastInbound = recentMsgs.filter(m => m.direction === "inbound");
        if (lastInbound.length > 0) {
          const lastText = lastInbound[lastInbound.length - 1].body.toLowerCase();
          if (OPT_OUT_PHRASES.some(p => lastText.includes(p))) {
            console.log(`[REENGAGE] Opt-out detected for thread=${convo.threadId}`);
            result.skippedOptOut++;
            result.details.push({ threadId: convo.threadId, senderId: convo.senderId, action: "skipped_optout" });
            continue;
          }
        }

        const agentLabel = isLayla ? "LAYLA" : "AGENT";
        const contextLines = recentMsgs.map(m =>
          `${m.direction === "inbound" ? "USER" : agentLabel}: ${m.body}`
        ).join("\n");

        const summaryResult = await aiChat(
          [
            { role: "system", content: SUMMARIZER_SYSTEM },
            { role: "user", content: contextLines },
          ],
          { maxTokens: 200, temperature: 0.3, route: "reengage-summarizer" },
        );

        let summary = { sensitive: false, recommended_action: "none", interest_score: 0 };
        try {
          const jsonMatch = summaryResult.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) summary = JSON.parse(jsonMatch[0]);
        } catch {}

        const fallback = isLayla ? FALLBACK_TEXT : BUSINESS_FALLBACK_TEXT;

        if (summary.sensitive || summary.recommended_action === "handover") {
          console.log(`[REENGAGE] Handover needed for thread=${convo.threadId} (sensitive=${summary.sensitive})`);
          result.handovers++;
          result.details.push({ threadId: convo.threadId, senderId: convo.senderId, action: "handover", message: fallback });

          if (!dryRun) {
            await sendMetaDM(subAccountId, convo.senderId, fallback, convo.threadId);
          }
          continue;
        }

        if (isLayla) {
          const hasEscalation = recentMsgs.some(m =>
            m.direction === "inbound" && ESCALATION_KEYWORDS.some(kw => m.body.toLowerCase().includes(kw))
          );
          if (hasEscalation) {
            console.log(`[REENGAGE] Escalation keyword in history for thread=${convo.threadId}`);
            result.handovers++;
            result.details.push({ threadId: convo.threadId, senderId: convo.senderId, action: "handover_escalation" });
            continue;
          }
        }

        const systemPrompt = isLayla
          ? LAYLA_REENGAGE_SYSTEM
          : buildBusinessReengagePrompt(accountName, accountIndustry);

        const llmResult = await aiChat(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Here is the recent conversation for context:\n${contextLines}\n\nNow compose a single reengage DM for this person. Remember: ONE message, end with a question, no links.` },
          ],
          { maxTokens: 200, temperature: isLayla ? 0.75 : 0.7, route: isLayla ? "reengage-layla" : "reengage-business" },
        );

        if (!llmResult.ok) {
          console.warn(`[REENGAGE] aiChat failed for thread=${convo.threadId}: ${llmResult.errorMessage}. Skipping send (no fallback leak).`);
          result.handovers++;
          result.details.push({ threadId: convo.threadId, senderId: convo.senderId, action: `skip_ai_error:${llmResult.errorMessage ?? "unknown"}` });
          continue;
        }

        let replyText = llmResult.text.trim();
        if (!replyText) {
          console.warn(`[REENGAGE] aiChat returned empty text for thread=${convo.threadId}. Skipping.`);
          continue;
        }

        if (isLayla && FORBIDDEN_REGEX.test(replyText)) {
          console.log(`[REENGAGE] Forbidden word in LLM output for thread=${convo.threadId}, sending fallback`);
          result.handovers++;
          result.details.push({ threadId: convo.threadId, senderId: convo.senderId, action: "handover_forbidden" });
          if (!dryRun) {
            await sendMetaDM(subAccountId, convo.senderId, FALLBACK_TEXT, convo.threadId);
          }
          continue;
        }

        const ppConfig = isLayla
          ? {
              telegram: { link: "t.me/LaylasLifeee", allowed: false },
              handover: { fallback_message: FALLBACK_TEXT, escalate_keywords: ESCALATION_KEYWORDS },
            }
          : {
              telegram: { link: "", allowed: false },
              handover: { fallback_message: BUSINESS_FALLBACK_TEXT, escalate_keywords: [] },
            };
        const ppResult = postProcessAndGuard(replyText, ppConfig);

        if (ppResult.action === "handover") {
          console.log(`[REENGAGE] Post-processor handover for thread=${convo.threadId}: ${ppResult.reason}`);
          result.handovers++;
          result.details.push({ threadId: convo.threadId, senderId: convo.senderId, action: "handover_pp", message: ppResult.reply });
          if (!dryRun) {
            await sendMetaDM(subAccountId, convo.senderId, ppResult.reply, convo.threadId);
          }
          continue;
        }

        replyText = ppResult.reply;

        const paragraphs = replyText.split(/\n\n+/);
        if (paragraphs.length > 1) {
          replyText = paragraphs.join(" ").replace(/\s+/g, " ").trim();
        }

        const words = replyText.split(/\s+/);
        if (words.length > 45) {
          replyText = words.slice(0, 45).join(" ");
        }

        // NOTE: Removed the auto-append of " — wyd? 😏" / " — anything we can help with?"
        // It was the literal source of the lazy WYD / generic-helper closer pattern in production.
        // The model is already instructed via LAYLA_REENGAGE_SYSTEM / buildBusinessReengagePrompt
        // to vary closers and avoid banned phrases. Trust the prompt; do not force a closer.

        if (dryRun) {
          console.log(`[REENGAGE] DRY_RUN — thread=${convo.threadId} sender=${convo.senderId} → "${replyText}"`);
          result.dryRun++;
          result.details.push({ threadId: convo.threadId, senderId: convo.senderId, action: "dry_run", message: replyText });
        } else {
          const delayMs = sampleReengageDelay();
          await new Promise(r => setTimeout(r, delayMs));

          await sendMetaDM(subAccountId, convo.senderId, replyText, convo.threadId);
          result.sent++;
          result.details.push({ threadId: convo.threadId, senderId: convo.senderId, action: "sent", message: replyText });
          sentThisHour++;

          const pauseMs = 1500 + Math.random() * 3000;
          await new Promise(r => setTimeout(r, pauseMs));
        }

      } catch (err: any) {
        console.error(`[REENGAGE] Error processing thread=${convo.threadId}:`, err.message);
        result.errors++;
        result.details.push({ threadId: convo.threadId, senderId: convo.senderId, action: "error" });
      }
    }

    console.log(`[REENGAGE] Job complete: eligible=${result.totalEligible} attempted=${result.attempted} sent=${result.sent} dryRun=${result.dryRun} handovers=${result.handovers} optOut=${result.skippedOptOut} errors=${result.errors}`);
    return result;

  } catch (err: any) {
    console.error(`[REENGAGE] Fatal job error:`, err.message);
    result.errors++;
    return result;
  }
}

function sampleReengageDelay(): number {
  const roll = Math.random();
  if (roll < 0.05) return 180_000 + Math.random() * 420_000;
  if (roll < 0.25) return 20_000 + Math.random() * 20_000;
  return 60_000 + Math.random() * 60_000;
}

const META_DM_AI_FALLBACK_TEXT = "give me a sec — be right back 💭";

async function sendMetaDM(
  subAccountId: number,
  recipientId: string,
  text: string,
  threadId: string,
): Promise<void> {
  const metaCfg = await getMetaConfig(subAccountId);
  const { pageId, accessToken, appsecretProof } = metaCfg;

  const url = `https://graph.facebook.com/v21.0/${pageId}/messages` +
    (appsecretProof ? `?appsecret_proof=${appsecretProof}` : "");

  const isAiErrorLeak = typeof text === "string" && text.startsWith("[AI Error:");
  const outboundText = isAiErrorLeak ? META_DM_AI_FALLBACK_TEXT : text;
  if (isAiErrorLeak) {
    console.error(`[REENGAGE] BLOCKED AI-error leak to ${recipientId} (thread=${threadId}) — original=${text.substring(0, 200)}`);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: outboundText },
      access_token: accessToken,
    }),
    signal: AbortSignal.timeout(15000),
  });

  const data = await res.json() as any;

  const traceId = `reengage-${Date.now()}`;
  const channel = threadId.includes("instagram") ? "instagram" : "facebook";

  const sendOk = res.ok;
  const status = isAiErrorLeak
    ? (sendOk ? "fallback_sent" : "failed")
    : (sendOk ? "sent" : "failed");
  const sendErrMsg = sendOk
    ? undefined
    : `meta_api_${res.status}: ${(data?.error?.message || JSON.stringify(data)).toString().substring(0, 300)}`;
  const errorMessage = isAiErrorLeak
    ? `ai_error_leak_blocked: ${text.substring(0, 400)}${sendErrMsg ? ` | fallback_err: ${sendErrMsg}` : ""}`
    : sendErrMsg;

  await db.insert(messages).values({
    subAccountId,
    channel,
    direction: "outbound",
    contactPhone: recipientId,
    body: outboundText,
    status,
    messageSid: data?.message_id,
    traceId,
    threadId,
    pageId,
    senderId: pageId,
    errorMessage,
  });

  if (!sendOk) {
    throw new Error(`Meta DM send failed: ${data.error?.message || JSON.stringify(data)}`);
  }

  console.log(`[REENGAGE] ${status} to ${recipientId}: "${maskPiiForLogs(outboundText.substring(0, 60))}..."`);
}

const REENGAGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let reengageTimer: ReturnType<typeof setInterval> | null = null;

export function startReengageScheduler(): void {
  if (reengageTimer) {
    console.log("[REENGAGE] Scheduler already running");
    return;
  }

  console.log(`[REENGAGE] Background scheduler started (interval: ${REENGAGE_INTERVAL_MS / 3600000}h)`);

  const runJob = () => {
    runReengageJob({ dryRun: false, batchLimit: 20 })
      .then(result => console.log(`[REENGAGE] Scheduled run complete: ${result.sent} sent, ${result.errors} errors, ${result.totalEligible} eligible`))
      .catch(err => console.error(`[REENGAGE] Scheduled run error: ${err.message}`));
  };

  setTimeout(runJob, 60_000);

  reengageTimer = setInterval(runJob, REENGAGE_INTERVAL_MS);
}

export function stopReengageScheduler(): void {
  if (reengageTimer) {
    clearInterval(reengageTimer);
    reengageTimer = null;
  }
  console.log("[REENGAGE] Scheduler stopped");
}
