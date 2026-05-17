// @ts-nocheck
import { db } from "../../db";
import { eq, and } from "drizzle-orm";
import {
  contentPosts, contentPostPlatforms, contentPublishingJobs,
  socialAccounts, subAccounts, contentMedia,
} from "@shared/schema";
import { asc } from "drizzle-orm";
import { getAdapter } from "./adapters";
import type { PublishInput, PublishResult, PlatformCredentials } from "./adapters";
import { decryptToken } from "../contentEncryption";

interface PublishPostOptions {
  postId: number;
  subAccountId: number;
  trigger: "manual" | "scheduled";
  platforms?: string[];
  recordJob?: boolean;
}

async function resolveCredentials(
  subAccountId: number,
  platform: string,
  socialAccountId: number | null,
): Promise<PlatformCredentials | null> {
  if (socialAccountId) {
    const [conn] = await db.select().from(socialAccounts)
      .where(and(
        eq(socialAccounts.id, socialAccountId),
        eq(socialAccounts.subAccountId, subAccountId),
      ));
    if (conn && conn.accessTokenEncrypted) {
      try {
        const accessToken = decryptToken(conn.accessTokenEncrypted);
        return {
          accessToken,
          pageId: conn.platformAccountId || undefined,
          igUserId: undefined,
        };
      } catch (e: any) {
        console.error(`[CP-PUBLISHER] Failed to decrypt token for socialAccount ${socialAccountId}:`, e.message);
      }
    }
  }

  const connections = await db.select().from(socialAccounts)
    .where(and(
      eq(socialAccounts.subAccountId, subAccountId),
      eq(socialAccounts.platform, platform),
      eq(socialAccounts.status, "active"),
    ));

  if (connections.length > 0 && connections[0].accessTokenEncrypted) {
    try {
      const accessToken = decryptToken(connections[0].accessTokenEncrypted);
      return {
        accessToken,
        pageId: connections[0].platformAccountId || undefined,
        igUserId: undefined,
      };
    } catch (e: any) {
      console.error(`[CP-PUBLISHER] Failed to decrypt token for socialAccount ${connections[0].id}:`, e.message);
    }
  }

  if (platform === "facebook" || platform === "instagram") {
    const [account] = await db.select().from(subAccounts)
      .where(eq(subAccounts.id, subAccountId));
    if (account && account.metaAccessToken && account.metaPageId) {
      const creds: PlatformCredentials = {
        accessToken: account.metaAccessToken,
        pageId: account.metaPageId,
        appSecret: account.metaAppSecret || undefined,
      };

      if (platform === "instagram") {
        try {
          const igUserId = await resolveInstagramBusinessId(account.metaPageId, account.metaAccessToken);
          creds.igUserId = igUserId || undefined;
        } catch (e: any) {
          console.error(`[CP-PUBLISHER] Failed to resolve IG business ID:`, e.message);
        }
      }

      return creds;
    }
  }

  return null;
}

async function resolveInstagramBusinessId(pageId: string, accessToken: string): Promise<string | null> {
  try {
    const url = `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account&access_token=${accessToken}`;
    const response = await fetch(url);
    const data = await response.json() as any;
    if (data.instagram_business_account?.id) {
      return data.instagram_business_account.id;
    }
    return null;
  } catch (err) {
    console.warn("[PUBLISHER] caught:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function publishPost(opts: PublishPostOptions): Promise<{
  jobIds: number[];
  results: PublishResult[];
}> {
  const { postId, subAccountId, trigger } = opts;
  const recordJob = opts.recordJob !== false;

  const [post] = await db.select().from(contentPosts)
    .where(and(eq(contentPosts.id, postId), eq(contentPosts.subAccountId, subAccountId)));
  if (!post) throw new Error(`Post ${postId} not found for subAccount ${subAccountId}`);

  const postPlatforms = await db.select().from(contentPostPlatforms)
    .where(and(
      eq(contentPostPlatforms.postId, postId),
      eq(contentPostPlatforms.subAccountId, subAccountId),
    ));

  let platformsToPublish: Array<{ platform: string; socialAccountId: number | null }> = [];

  if (postPlatforms.length > 0) {
    platformsToPublish = postPlatforms.map(pp => ({
      platform: pp.platform,
      socialAccountId: pp.socialAccountId,
    }));
  } else if (opts.platforms && opts.platforms.length > 0) {
    platformsToPublish = opts.platforms.map(p => ({ platform: p, socialAccountId: null }));
  }

  if (platformsToPublish.length === 0) throw new Error("No platforms specified for publishing");

  const results: PublishResult[] = [];
  const jobIds: number[] = [];
  let allSucceeded = true;

  for (const { platform, socialAccountId } of platformsToPublish) {
    const adapter = getAdapter(platform);
    if (!adapter) {
      const failResult: PublishResult = {
        success: false,
        platform,
        externalPostId: null,
        errorMessage: `Unsupported platform: ${platform}`,
      };
      results.push(failResult);
      allSucceeded = false;

      if (recordJob) {
        const [job] = await db.insert(contentPublishingJobs).values({
          subAccountId,
          postId,
          platform,
          socialAccountId,
          trigger,
          status: "failed",
          errorMessage: failResult.errorMessage,
          startedAt: new Date(),
          completedAt: new Date(),
        }).returning();
        jobIds.push(job.id);
      }
      continue;
    }

    const credentials = await resolveCredentials(subAccountId, platform, socialAccountId);

    const mediaRows = await db.select({ id: contentMedia.id })
      .from(contentMedia)
      .where(and(eq(contentMedia.postId, postId), eq(contentMedia.subAccountId, subAccountId)))
      .orderBy(asc(contentMedia.sortOrder));
    const mediaIds = mediaRows.length > 0 ? mediaRows.map(m => m.id) : null;

    const input: PublishInput = {
      postId,
      subAccountId,
      connectionId: socialAccountId,
      platform,
      title: post.title,
      body: post.caption || post.title,
      mediaIds,
      credentials,
    };

    const validation = adapter.validate(input);
    if (!validation.valid) {
      const failResult: PublishResult = {
        success: false,
        platform,
        externalPostId: null,
        errorMessage: validation.error || "Validation failed",
      };
      results.push(failResult);
      allSucceeded = false;

      if (recordJob) {
        const [job] = await db.insert(contentPublishingJobs).values({
          subAccountId,
          postId,
          platform,
          socialAccountId,
          trigger,
          status: "failed",
          errorMessage: failResult.errorMessage,
          startedAt: new Date(),
          completedAt: new Date(),
        }).returning();
        jobIds.push(job.id);
      }
      continue;
    }

    try {
      const publishResult = await adapter.publish(input);
      results.push(publishResult);
      if (!publishResult.success) allSucceeded = false;

      if (recordJob) {
        const [job] = await db.insert(contentPublishingJobs).values({
          subAccountId,
          postId,
          platform,
          socialAccountId,
          trigger,
          status: publishResult.success ? "published" : "failed",
          externalPostId: publishResult.externalPostId,
          errorMessage: publishResult.errorMessage,
          startedAt: new Date(),
          completedAt: new Date(),
        }).returning();
        jobIds.push(job.id);
      }

      if (publishResult.success) {
        await db.update(contentPostPlatforms).set({
          platformStatus: "published",
          externalPostId: publishResult.externalPostId,
          publishedAt: new Date(),
        }).where(and(
          eq(contentPostPlatforms.postId, postId),
          eq(contentPostPlatforms.platform, platform),
        ));
      } else {
        await db.update(contentPostPlatforms).set({
          platformStatus: "failed",
          errorMessage: publishResult.errorMessage,
        }).where(and(
          eq(contentPostPlatforms.postId, postId),
          eq(contentPostPlatforms.platform, platform),
        ));
      }
    } catch (err: any) {
      const failResult: PublishResult = {
        success: false,
        platform,
        externalPostId: null,
        errorMessage: err.message || "Unknown publish error",
      };
      results.push(failResult);
      allSucceeded = false;

      if (recordJob) {
        const [job] = await db.insert(contentPublishingJobs).values({
          subAccountId,
          postId,
          platform,
          socialAccountId,
          trigger,
          status: "failed",
          errorMessage: failResult.errorMessage,
          startedAt: new Date(),
          completedAt: new Date(),
        }).returning();
        jobIds.push(job.id);
      }
    }
  }

  const newPostStatus = allSucceeded ? "published" : "failed";
  await db.update(contentPosts).set({
    status: newPostStatus,
    publishedAt: allSucceeded ? new Date() : post.publishedAt,
    updatedAt: new Date(),
  }).where(eq(contentPosts.id, postId));

  return { jobIds, results };
}
