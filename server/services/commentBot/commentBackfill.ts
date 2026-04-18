import { db } from "../../db";
import { eq, and } from "drizzle-orm";
import { commentAutoReplies, subAccounts } from "@shared/schema";
import { getMetaConfig } from "../../metaConfig";
import { handleCommentEvent, CommentWebhookEvent } from "./commentHandler";

interface BackfillOptions {
  subAccountId: number;
  maxPosts?: number;
  maxCommentsPerPost?: number;
  dryRun?: boolean;
  maxAgeDays?: number;
  maxRepliesPerRun?: number;
}

interface BackfillResult {
  postsScanned: number;
  commentsFound: number;
  commentsQueued: number;
  commentsSkipped: number;
  errors: string[];
  capReached: boolean;
  details: Array<{
    postId: string;
    commentId: string;
    commenterName: string | null;
    text: string;
    action: "queued" | "skipped_already_processed" | "skipped_own_comment" | "skipped_empty" | "skipped_dry_run" | "skipped_too_old" | "skipped_cap_reached";
  }>;
}

export async function backfillComments(opts: BackfillOptions): Promise<BackfillResult> {
  const {
    subAccountId,
    maxPosts = 10,
    maxCommentsPerPost = 50,
    dryRun = false,
    maxAgeDays = 0,
    maxRepliesPerRun = 0,
  } = opts;
  const ageCutoff = maxAgeDays > 0 ? Date.now() - maxAgeDays * 24 * 60 * 60 * 1000 : 0;
  const replyCap = maxRepliesPerRun > 0 ? maxRepliesPerRun : Infinity;

  const result: BackfillResult = {
    postsScanned: 0,
    commentsFound: 0,
    commentsQueued: 0,
    commentsSkipped: 0,
    errors: [],
    capReached: false,
    details: [],
  };

  const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
  if (!account) {
    result.errors.push(`Sub-account ${subAccountId} not found`);
    return result;
  }

  const metaCfg = await getMetaConfig(subAccountId);
  const pageId = account.metaPageId;
  const token = metaCfg.accessToken;

  if (!pageId || !token) {
    result.errors.push("Missing pageId or accessToken");
    return result;
  }

  const existingComments = new Set<string>();
  const existing = await db.select({ commentId: commentAutoReplies.commentId })
    .from(commentAutoReplies)
    .where(eq(commentAutoReplies.subAccountId, subAccountId));
  for (const row of existing) {
    existingComments.add(row.commentId);
  }

  const fbPosts = await fetchFacebookPosts(pageId, token, maxPosts, maxCommentsPerPost);
  const igPosts = await fetchInstagramPosts(account, token, maxPosts, maxCommentsPerPost);
  const allPosts = [...fbPosts, ...igPosts];

  for (const post of allPosts) {
    result.postsScanned++;

    for (const comment of post.comments) {
      result.commentsFound++;

      if (!comment.text || comment.text.trim().length === 0) {
        result.commentsSkipped++;
        result.details.push({
          postId: post.postId,
          commentId: comment.commentId,
          commenterName: comment.commenterName,
          text: "",
          action: "skipped_empty",
        });
        continue;
      }

      if (comment.commenterId === pageId) {
        result.commentsSkipped++;
        result.details.push({
          postId: post.postId,
          commentId: comment.commentId,
          commenterName: comment.commenterName,
          text: comment.text.substring(0, 60),
          action: "skipped_own_comment",
        });
        continue;
      }

      if (existingComments.has(comment.commentId)) {
        result.commentsSkipped++;
        result.details.push({
          postId: post.postId,
          commentId: comment.commentId,
          commenterName: comment.commenterName,
          text: comment.text.substring(0, 60),
          action: "skipped_already_processed",
        });
        continue;
      }

      if (ageCutoff > 0 && comment.createdTime) {
        const ts = Date.parse(comment.createdTime);
        if (!isNaN(ts) && ts < ageCutoff) {
          result.commentsSkipped++;
          result.details.push({
            postId: post.postId,
            commentId: comment.commentId,
            commenterName: comment.commenterName,
            text: comment.text.substring(0, 60),
            action: "skipped_too_old",
          });
          continue;
        }
      }

      if (result.commentsQueued >= replyCap) {
        result.commentsSkipped++;
        result.capReached = true;
        result.details.push({
          postId: post.postId,
          commentId: comment.commentId,
          commenterName: comment.commenterName,
          text: comment.text.substring(0, 60),
          action: "skipped_cap_reached",
        });
        continue;
      }

      if (dryRun) {
        result.commentsQueued++;
        result.details.push({
          postId: post.postId,
          commentId: comment.commentId,
          commenterName: comment.commenterName,
          text: comment.text.substring(0, 60),
          action: "skipped_dry_run",
        });
        continue;
      }

      const event: CommentWebhookEvent = {
        platform: post.platform,
        subAccountId,
        pageId,
        postId: post.postId,
        commentId: comment.commentId,
        commentText: comment.text,
        commenterId: comment.commenterId || "unknown",
        commenterName: comment.commenterName,
      };

      try {
        await handleCommentEvent(event);
        result.commentsQueued++;
        result.details.push({
          postId: post.postId,
          commentId: comment.commentId,
          commenterName: comment.commenterName,
          text: comment.text.substring(0, 60),
          action: "queued",
        });
      } catch (err: any) {
        result.errors.push(`Comment ${comment.commentId}: ${err.message}`);
      }

      const jitter = 1000 + Math.random() * 2000;
      await new Promise(r => setTimeout(r, jitter));
    }
  }

  return result;
}

interface PostWithComments {
  platform: "facebook" | "instagram";
  postId: string;
  caption: string;
  comments: Array<{
    commentId: string;
    text: string;
    commenterId: string;
    commenterName: string | null;
    createdTime: string;
    isReply: boolean;
  }>;
}

async function fetchFacebookPosts(
  pageId: string,
  token: string,
  maxPosts: number,
  maxCommentsPerPost: number,
): Promise<PostWithComments[]> {
  const results: PostWithComments[] = [];

  try {
    const url = `https://graph.facebook.com/v21.0/${pageId}/posts?fields=id,message,created_time,comments.limit(${maxCommentsPerPost}){id,message,from,created_time,parent}&limit=${maxPosts}&access_token=${token}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`[COMMENT-BACKFILL] Failed to fetch FB posts: HTTP ${res.status}`);
      return results;
    }
    const data = await res.json() as any;

    for (const post of (data.data || [])) {
      const comments = (post.comments?.data || [])
        .filter((c: any) => !c.parent)
        .map((c: any) => ({
          commentId: c.id,
          text: c.message || "",
          commenterId: c.from?.id || "",
          commenterName: c.from?.name || null,
          createdTime: c.created_time || "",
          isReply: false,
        }));

      results.push({
        platform: "facebook",
        postId: post.id,
        caption: post.message || "",
        comments,
      });
    }
  } catch (err: any) {
    console.error(`[COMMENT-BACKFILL] FB fetch error: ${err.message}`);
  }

  return results;
}

async function fetchInstagramPosts(
  account: any,
  token: string,
  maxPosts: number,
  maxCommentsPerPost: number,
): Promise<PostWithComments[]> {
  const results: PostWithComments[] = [];

  const igAccountId = (account as any).metaInstagramAccountId;
  if (!igAccountId) return results;

  try {
    const url = `https://graph.facebook.com/v21.0/${igAccountId}/media?fields=id,caption,timestamp,comments.limit(${maxCommentsPerPost}){id,text,from,timestamp}&limit=${maxPosts}&access_token=${token}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`[COMMENT-BACKFILL] Failed to fetch IG media: HTTP ${res.status}`);
      return results;
    }
    const data = await res.json() as any;

    for (const media of (data.data || [])) {
      const comments = (media.comments?.data || []).map((c: any) => ({
        commentId: c.id,
        text: c.text || "",
        commenterId: c.from?.id || c.from?.username || "",
        commenterName: c.from?.username || null,
        createdTime: c.timestamp || "",
        isReply: false,
      }));

      results.push({
        platform: "instagram",
        postId: media.id,
        caption: media.caption || "",
        comments,
      });
    }
  } catch (err: any) {
    console.error(`[COMMENT-BACKFILL] IG fetch error: ${err.message}`);
  }

  return results;
}
