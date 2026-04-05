import { db } from "../../db";
import { eq, and, gte, sql } from "drizzle-orm";
import { commentAutoReplies, subAccounts } from "@shared/schema";
import { generateCommentReply, shouldSkipComment } from "./commentReplyGenerator";
import { getMetaConfig } from "../../metaConfig";
import { postProcessAndGuard, checkEscalationKeywords, maskPiiForLogs } from "../personas/laylaPostProcessor";
import {
  LAYLA_COMMENT_SYSTEM_PROMPT,
  ESCALATION_KEYWORDS,
  BOT_PROBE_PHRASES,
  HANDOVER_FALLBACK,
  BOT_DENIAL,
} from "./laylaCommentPrompt";
import { aiChat } from "../../aiGateway";

const LAYLA_ACCOUNT_IDS = new Set([22]);

export interface CommentWebhookEvent {
  platform: "facebook" | "instagram";
  subAccountId: number;
  pageId: string;
  postId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName: string | null;
  parentId?: string;
}

export async function handleCommentEvent(event: CommentWebhookEvent): Promise<void> {
  const {
    platform, subAccountId, pageId, postId,
    commentId, commentText, commenterId, commenterName, parentId,
  } = event;

  const maskedText = maskPiiForLogs(commentText.substring(0, 80));
  console.log(`[COMMENT-BOT] ${platform} comment on post=${postId} by ${commenterName || commenterId}: "${maskedText}"`);

  if (parentId) {
    console.log(`[COMMENT-BOT] Skipping — reply to another comment (parentId=${parentId})`);
    return;
  }

  const skipCheck = shouldSkipComment(commentText, commenterId, pageId);
  if (skipCheck.skip) {
    console.log(`[COMMENT-BOT] Skipping comment ${commentId}: ${skipCheck.reason}`);
    await db.insert(commentAutoReplies).values({
      subAccountId,
      platform,
      postId,
      commentId,
      commentText: maskPiiForLogs(commentText),
      commenterName,
      commenterId,
      status: "skipped",
      sentiment: skipCheck.reason === "spam_detected" ? "spam" : null,
    }).onConflictDoNothing();
    return;
  }

  const replyChance = 0.4 + Math.random() * 0.2;
  if (Math.random() > replyChance) {
    console.log(`[COMMENT-BOT] Randomly skipping comment ${commentId} (selective reply mode)`);
    await db.insert(commentAutoReplies).values({
      subAccountId,
      platform,
      postId,
      commentId,
      commentText,
      commenterName,
      commenterId,
      status: "skipped",
      sentiment: "neutral",
    }).onConflictDoNothing();
    return;
  }

  const inserted = await db.insert(commentAutoReplies).values({
    subAccountId,
    platform,
    postId,
    commentId,
    commentText,
    commenterName,
    commenterId,
    status: "processing",
  }).onConflictDoNothing().returning();

  if (inserted.length === 0) {
    console.log(`[COMMENT-BOT] Already processed comment ${commentId} — skipping (conflict)`);
    return;
  }
  const record = inserted[0];

  try {
    const [account] = await db.select().from(subAccounts)
      .where(eq(subAccounts.id, subAccountId));

    if (!account) {
      throw new Error(`Sub-account ${subAccountId} not found`);
    }

    const commentConfig = (account.config as any)?.commentBot || {};
    if (commentConfig.enabled === false) {
      console.log(`[COMMENT-BOT] Auto-reply disabled for subAccount ${subAccountId}`);
      await db.update(commentAutoReplies).set({ status: "disabled" })
        .where(eq(commentAutoReplies.id, record.id));
      return;
    }

    const maxPerHour = commentConfig.maxRepliesPerHour || 30;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [hourCount] = await db.select({ count: sql<number>`count(*)` })
      .from(commentAutoReplies)
      .where(and(
        eq(commentAutoReplies.subAccountId, subAccountId),
        eq(commentAutoReplies.status, "replied"),
        gte(commentAutoReplies.repliedAt, oneHourAgo),
      ));
    if ((hourCount?.count || 0) >= maxPerHour) {
      console.log(`[COMMENT-BOT] Rate limit reached (${maxPerHour}/hr) for subAccount ${subAccountId}`);
      await db.update(commentAutoReplies).set({ status: "rate_limited" })
        .where(eq(commentAutoReplies.id, record.id));
      return;
    }

    const isLayla = LAYLA_ACCOUNT_IDS.has(subAccountId);

    if (isLayla) {
      if (checkEscalationKeywords(commentText, ESCALATION_KEYWORDS)) {
        console.log(`[COMMENT-BOT] Escalation keyword detected in comment ${commentId}`);
        await sendAndRecord({
          record,
          subAccountId,
          platform,
          commentId,
          replyText: HANDOVER_FALLBACK,
          sentiment: "negative",
        });
        return;
      }

      const lower = commentText.toLowerCase();
      if (BOT_PROBE_PHRASES.some(p => lower.includes(p))) {
        console.log(`[COMMENT-BOT] Bot probe detected in comment ${commentId}`);
        await sendAndRecord({
          record,
          subAccountId,
          platform,
          commentId,
          replyText: BOT_DENIAL,
          sentiment: "neutral",
        });
        return;
      }
    }

    let postCaption: string | null = null;
    try {
      const metaCfg = await getMetaConfig(subAccountId);
      const postUrl = platform === "instagram"
        ? `https://graph.facebook.com/v19.0/${postId}?fields=caption&access_token=${metaCfg.accessToken}`
        : `https://graph.facebook.com/v19.0/${postId}?fields=message&access_token=${metaCfg.accessToken}`;
      const postRes = await fetch(postUrl, { signal: AbortSignal.timeout(5000) });
      if (postRes.ok) {
        const postData = await postRes.json() as any;
        postCaption = postData.caption || postData.message || null;
      }
    } catch (err: any) {
      console.warn(`[COMMENT-BOT] Could not fetch post context for ${postId}:`, err.message);
    }

    let replyText: string;
    let sentiment: string;

    if (isLayla) {
      const laylaResult = await generateLaylaCommentReply({
        platform,
        commentText,
        commenterName,
        postCaption,
      });
      replyText = laylaResult.reply;
      sentiment = laylaResult.sentiment;

      if (sentiment === "spam" || !replyText) {
        console.log(`[COMMENT-BOT] Layla AI classified comment ${commentId} as spam — skipping`);
        await db.update(commentAutoReplies).set({
          status: "skipped",
          sentiment: "spam",
        }).where(eq(commentAutoReplies.id, record.id));
        return;
      }

      const laylaOpConfig = {
        telegram: { link: "t.me/LaylasLifeee", allowed: true },
        handover: { fallback_message: HANDOVER_FALLBACK, escalate_keywords: ESCALATION_KEYWORDS },
      };
      const ppResult = postProcessAndGuard(replyText, laylaOpConfig);
      if (ppResult.action === "handover") {
        console.log(`[COMMENT-BOT] Post-processor triggered handover for comment ${commentId}: ${ppResult.reason}`);
        replyText = ppResult.reply;
        sentiment = "negative";
      } else {
        replyText = ppResult.reply;
      }
    } else {
      const aiResult = await generateCommentReply({
        businessName: account.name,
        industry: account.industry,
        platform,
        commentText,
        commenterName,
        postCaption,
        language: account.language || "en",
        brandVoice: (account.aiPromptConfig as any)?.brandVoice || null,
        replyStyle: commentConfig.replyStyle || "friendly",
      });
      replyText = aiResult.reply;
      sentiment = aiResult.sentiment;

      if (sentiment === "spam" || !replyText) {
        console.log(`[COMMENT-BOT] AI classified comment ${commentId} as spam — skipping reply`);
        await db.update(commentAutoReplies).set({
          status: "skipped",
          sentiment: "spam",
        }).where(eq(commentAutoReplies.id, record.id));
        return;
      }
    }

    await sendAndRecord({
      record,
      subAccountId,
      platform,
      commentId,
      replyText,
      sentiment,
    });

  } catch (err: any) {
    console.error(`[COMMENT-BOT] Failed to reply to comment ${commentId}:`, err.message);
    await db.update(commentAutoReplies).set({
      status: "failed",
      errorMessage: err.message,
    }).where(eq(commentAutoReplies.id, record.id));
  }
}

async function generateLaylaCommentReply(ctx: {
  platform: "facebook" | "instagram";
  commentText: string;
  commenterName: string | null;
  postCaption: string | null;
}): Promise<{ reply: string; sentiment: string }> {
  const contextLines: string[] = [];
  if (ctx.postCaption) contextLines.push(`POST CONTEXT: "${ctx.postCaption.substring(0, 300)}"`);
  if (ctx.commenterName) contextLines.push(`COMMENTER: ${ctx.commenterName}`);
  contextLines.push(`PLATFORM: ${ctx.platform}`);

  const systemWithContext = LAYLA_COMMENT_SYSTEM_PROMPT + "\n\n" + contextLines.join("\n");

  const result = await aiChat(
    [
      { role: "system", content: systemWithContext },
      { role: "user", content: ctx.commentText },
    ],
    {
      maxTokens: 400,
      temperature: 0.75,
      route: "layla-comment-bot",
    },
  );

  const raw = result.text || "";
  let parsed: { reply: string; sentiment: string };
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      parsed = { reply: raw.trim(), sentiment: "neutral" };
    }
  } catch {
    parsed = { reply: raw.trim(), sentiment: "neutral" };
  }

  const validSentiments = ["positive", "negative", "neutral", "question", "spam"];
  const sentiment = validSentiments.includes(parsed.sentiment) ? parsed.sentiment : "neutral";
  let reply = parsed.reply || "";
  if (reply.length > 500) reply = reply.substring(0, 497) + "...";

  return { reply, sentiment };
}

interface SendAndRecordOpts {
  record: { id: number };
  subAccountId: number;
  platform: "facebook" | "instagram";
  commentId: string;
  replyText: string;
  sentiment: string;
}

async function sendAndRecord(opts: SendAndRecordOpts): Promise<void> {
  const { record, subAccountId, platform, commentId, replyText, sentiment } = opts;

  const naturalDelay = 2000 + Math.random() * 4000;
  await new Promise(resolve => setTimeout(resolve, naturalDelay));

  const metaCfg = await getMetaConfig(subAccountId);
  const replyResult = await sendCommentReply({
    platform,
    commentId,
    replyText,
    accessToken: metaCfg.accessToken,
    appSecret: metaCfg.appSecret,
  });

  if (replyResult.success) {
    await db.update(commentAutoReplies).set({
      replyText,
      replyId: replyResult.replyId,
      status: "replied",
      sentiment,
      repliedAt: new Date(),
    }).where(eq(commentAutoReplies.id, record.id));

    console.log(`[COMMENT-BOT] Replied to ${platform} comment ${commentId}: "${replyText.substring(0, 60)}..."`);
  } else {
    throw new Error(replyResult.error || "Unknown reply error");
  }
}

interface SendCommentReplyOptions {
  platform: "facebook" | "instagram";
  commentId: string;
  replyText: string;
  accessToken: string;
  appSecret: string | null;
}

async function sendCommentReply(opts: SendCommentReplyOptions): Promise<{
  success: boolean;
  replyId?: string;
  error?: string;
}> {
  const { commentId, replyText, accessToken, appSecret } = opts;

  let appsecretProof = "";
  if (appSecret) {
    const crypto = await import("crypto");
    appsecretProof = crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
  }

  const url = `https://graph.facebook.com/v19.0/${commentId}/replies`;

  const params = new URLSearchParams({
    message: replyText,
    access_token: accessToken,
  });
  if (appsecretProof) params.append("appsecret_proof", appsecretProof);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json() as any;

    if (data.id) {
      return { success: true, replyId: data.id };
    }

    if (data.error) {
      return {
        success: false,
        error: `Meta API error ${data.error.code}: ${data.error.message}`,
      };
    }

    return { success: false, error: "Unknown Meta API response" };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
