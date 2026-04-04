import { db } from "../../db";
import { eq, and } from "drizzle-orm";
import {
  cpPosts, cpPublishLogs, cpPublishJobs, cpSocialConnections, subAccounts,
} from "@shared/schema";
import { getAdapter } from "./adapters";
import type { PublishInput, PublishResult, PlatformCredentials } from "./adapters";
import { decrypt } from "../contentEncryption";

interface PublishPostOptions {
  postId: number;
  subAccountId: number;
  trigger: "manual" | "scheduled";
  platforms?: string[];
  connectionIds?: number[];
}

async function resolveCredentials(
  subAccountId: number,
  platform: string,
  connectionId: number | null,
): Promise<PlatformCredentials | null> {
  if (connectionId) {
    const [conn] = await db.select().from(cpSocialConnections)
      .where(and(
        eq(cpSocialConnections.id, connectionId),
        eq(cpSocialConnections.subAccountId, subAccountId),
      ));
    if (conn && conn.accessTokenEnc) {
      try {
        const accessToken = decrypt(conn.accessTokenEnc);
        return {
          accessToken,
          pageId: conn.accountId || undefined,
          igUserId: undefined,
        };
      } catch (e: any) {
        console.error(`[CP-PUBLISHER] Failed to decrypt token for connection ${connectionId}:`, e.message);
      }
    }
  }

  const connections = await db.select().from(cpSocialConnections)
    .where(and(
      eq(cpSocialConnections.subAccountId, subAccountId),
      eq(cpSocialConnections.platform, platform),
      eq(cpSocialConnections.isActive, true),
    ));

  if (connections.length > 0 && connections[0].accessTokenEnc) {
    try {
      const accessToken = decrypt(connections[0].accessTokenEnc);
      return {
        accessToken,
        pageId: connections[0].accountId || undefined,
        igUserId: undefined,
      };
    } catch (e: any) {
      console.error(`[CP-PUBLISHER] Failed to decrypt token for connection ${connections[0].id}:`, e.message);
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
    const url = `https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account&access_token=${accessToken}`;
    const response = await fetch(url);
    const data = await response.json() as any;
    if (data.instagram_business_account?.id) {
      return data.instagram_business_account.id;
    }
    return null;
  } catch {
    return null;
  }
}

export async function publishPost(opts: PublishPostOptions): Promise<{
  jobId: number;
  results: PublishResult[];
}> {
  const { postId, subAccountId, trigger } = opts;

  const [post] = await db.select().from(cpPosts)
    .where(and(eq(cpPosts.id, postId), eq(cpPosts.subAccountId, subAccountId)));
  if (!post) throw new Error(`Post ${postId} not found for subAccount ${subAccountId}`);

  const platforms = opts.platforms || post.platforms || [];
  if (platforms.length === 0) throw new Error("No platforms specified for publishing");

  const [job] = await db.insert(cpPublishJobs).values({
    subAccountId,
    postId,
    trigger,
    platforms,
    connectionIds: opts.connectionIds || post.connectionIds || null,
    status: "processing",
    startedAt: new Date(),
  }).returning();

  const results: PublishResult[] = [];
  let allSucceeded = true;

  for (const platform of platforms) {
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

      await db.insert(cpPublishLogs).values({
        subAccountId,
        postId,
        connectionId: null,
        platform,
        status: "failed",
        externalPostId: null,
        errorMessage: failResult.errorMessage,
      });
      continue;
    }

    let connectionId: number | null = null;
    if (opts.connectionIds && opts.connectionIds.length > 0) {
      const connections = await db.select().from(cpSocialConnections)
        .where(and(
          eq(cpSocialConnections.subAccountId, subAccountId),
          eq(cpSocialConnections.platform, platform),
        ));
      const match = connections.find(c => opts.connectionIds!.includes(c.id));
      if (match) connectionId = match.id;
    }

    const credentials = await resolveCredentials(subAccountId, platform, connectionId);

    const input: PublishInput = {
      postId,
      subAccountId,
      connectionId,
      platform,
      title: post.title,
      body: post.body,
      mediaIds: post.mediaIds,
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

      await db.insert(cpPublishLogs).values({
        subAccountId,
        postId,
        connectionId,
        platform,
        status: "failed",
        externalPostId: null,
        errorMessage: failResult.errorMessage,
      });
      continue;
    }

    try {
      const publishResult = await adapter.publish(input);
      results.push(publishResult);
      if (!publishResult.success) allSucceeded = false;

      await db.insert(cpPublishLogs).values({
        subAccountId,
        postId,
        connectionId,
        platform,
        status: publishResult.success ? "published" : "failed",
        externalPostId: publishResult.externalPostId,
        errorMessage: publishResult.errorMessage,
      });
    } catch (err: any) {
      const failResult: PublishResult = {
        success: false,
        platform,
        externalPostId: null,
        errorMessage: err.message || "Unknown publish error",
      };
      results.push(failResult);
      allSucceeded = false;

      await db.insert(cpPublishLogs).values({
        subAccountId,
        postId,
        connectionId,
        platform,
        status: "failed",
        externalPostId: null,
        errorMessage: failResult.errorMessage,
      });
    }
  }

  const finalStatus = allSucceeded ? "completed" : (results.some(r => r.success) ? "partial" : "failed");

  await db.update(cpPublishJobs).set({
    status: finalStatus,
    result: results,
    errorMessage: allSucceeded ? null : results.filter(r => !r.success).map(r => `${r.platform}: ${r.errorMessage}`).join("; "),
    completedAt: new Date(),
  }).where(eq(cpPublishJobs.id, job.id));

  const newPostStatus = allSucceeded ? "published" : "failed";
  await db.update(cpPosts).set({
    status: newPostStatus,
    publishedAt: allSucceeded ? new Date() : post.publishedAt,
    updatedAt: new Date(),
  }).where(eq(cpPosts.id, postId));

  return { jobId: job.id, results };
}
