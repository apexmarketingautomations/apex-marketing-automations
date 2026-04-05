import { db } from "../../db";
import { eq, and, gte, sql } from "drizzle-orm";
import { commentAutoReplies, subAccounts } from "@shared/schema";
import { generateCommentReply, shouldSkipComment } from "./commentReplyGenerator";
import { getMetaConfig } from "../../metaConfig";

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

  console.log(`[COMMENT-BOT] ${platform} comment on post=${postId} by ${commenterName || commenterId}: "${commentText.substring(0, 80)}"`);

  if (parentId) {
    console.log(`[COMMENT-BOT] Skipping — this is a reply to another comment (parentId=${parentId})`);
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
      commentText,
      commenterName,
      commenterId,
      status: "skipped",
      sentiment: skipCheck.reason === "spam_detected" ? "spam" : null,
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

    if (aiResult.sentiment === "spam" || !aiResult.reply) {
      console.log(`[COMMENT-BOT] AI classified comment ${commentId} as spam — skipping reply`);
      await db.update(commentAutoReplies).set({
        status: "skipped",
        sentiment: "spam",
      }).where(eq(commentAutoReplies.id, record.id));
      return;
    }

    const naturalDelay = 2000 + Math.random() * 4000;
    await new Promise(resolve => setTimeout(resolve, naturalDelay));

    const metaCfg = await getMetaConfig(subAccountId);
    const replyResult = await sendCommentReply({
      platform,
      commentId,
      replyText: aiResult.reply,
      accessToken: metaCfg.accessToken,
      appSecret: metaCfg.appSecret,
    });

    if (replyResult.success) {
      await db.update(commentAutoReplies).set({
        replyText: aiResult.reply,
        replyId: replyResult.replyId,
        status: "replied",
        sentiment: aiResult.sentiment,
        repliedAt: new Date(),
      }).where(eq(commentAutoReplies.id, record.id));

      console.log(`[COMMENT-BOT] Replied to ${platform} comment ${commentId}: "${aiResult.reply.substring(0, 60)}..."`);
    } else {
      throw new Error(replyResult.error || "Unknown reply error");
    }
  } catch (err: any) {
    console.error(`[COMMENT-BOT] Failed to reply to comment ${commentId}:`, err.message);
    await db.update(commentAutoReplies).set({
      status: "failed",
      errorMessage: err.message,
    }).where(eq(commentAutoReplies.id, record.id));
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
