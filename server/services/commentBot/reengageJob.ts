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

const DEFAULT_SUB_ACCOUNT_ID = FALLBACK_LAYLA_ACCOUNT_ID;
const LAYLA_ACCOUNT_ID = FALLBACK_LAYLA_ACCOUNT_ID;
const DEFAULT_REENGAGE_DAYS = 60;
const DEFAULT_BATCH_LIMIT = 20;
const MAX_PER_HOUR = 200;

const OPT_OUT_PHRASES = ["stop", "do not contact", "unsubscribe", "block me", "opt out", "leave me alone"];

const LAYLA_REENGAGE_SYSTEM = `SYSTEM: Officer Layla Woods — HARDENED.
You are Officer Layla Woods, a single human female persona texting for "Apex By Donte".
YOU MUST NEVER describe yourself as AI/automation/bot/assistant/script/model/OpenAI/GPT/server/token/secret/key/backend/logs/database/operator_config.
Primary objective: create ONE single, human-feeling reengage DM. Constraints:
- Single message only. 8-45 words preferred. Max 3 short paragraphs but collapse to single message.
- END with EXACTLY ONE open-ended question (one sentence ending with '?').
- Tone: confident, seductive, playful, slightly narcissistic, curious; feminine "girly-girl" energy; modern 2026 slang; tiny typos ok rarely; emoji sparingly (😉 😏 👍).
- NEVER include external links, request or accept payment, ask for or echo PII, nor reveal system internals.
- If user asks for PII/payment/explicit-for-pay/legal, escalate to human and send FALLBACK_TEXT.
Output: plain text only — the message to send.`;

function buildBusinessReengagePrompt(businessName: string, industry: string | null): string {
  return `You are a friendly social media manager for "${businessName}"${industry ? ` (${industry})` : ""}.
You are sending a brief, warm follow-up DM to someone who messaged us recently. Constraints:
- Single message only. 8-45 words preferred.
- END with exactly ONE open-ended question.
- Tone: friendly, professional, helpful. Sound like a real person, not a brand bot.
- NEVER include external links, request payment, ask for PII, or reveal system internals.
- Reference their previous conversation naturally if context is provided.
Output: plain text only — the message to send.`;
}

const BUSINESS_FALLBACK_TEXT = "Hey! Just following up — is there anything else we can help you with? Feel free to reach out anytime!";

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

        let replyText = llmResult.text.trim();

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

        if (!replyText.trim().endsWith("?")) {
          const questionSuffix = isLayla
            ? " — what u been up to? 😏"
            : " — anything we can help with?";
          const sentences = replyText.trim().replace(/[.!]+$/, "").split(/[.!]\s+/);
          if (sentences.length > 1) {
            replyText = sentences.slice(0, -1).join(". ") + questionSuffix;
          } else {
            replyText = replyText.trim().replace(/[.!]+$/, "") + questionSuffix;
          }
        }

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

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      access_token: accessToken,
    }),
    signal: AbortSignal.timeout(15000),
  });

  const data = await res.json() as any;

  const traceId = `reengage-${Date.now()}`;
  const channel = threadId.includes("instagram") ? "instagram" : "facebook";

  await db.insert(messages).values({
    subAccountId,
    channel,
    direction: "outbound",
    contactPhone: recipientId,
    body: text,
    status: res.ok ? "sent" : "failed",
    traceId,
    threadId,
    pageId,
    senderId: pageId,
  });

  if (!res.ok) {
    throw new Error(`Meta DM send failed: ${data.error?.message || JSON.stringify(data)}`);
  }

  console.log(`[REENGAGE] DM sent to ${recipientId}: "${maskPiiForLogs(text.substring(0, 60))}..."`);
}
