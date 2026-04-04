import { db } from "../../db";
import { eq, and } from "drizzle-orm";
import {
  cpPosts, cpPublishLogs, cpPublishJobs, cpSocialConnections,
} from "@shared/schema";
import { getAdapter } from "./adapters";
import type { PublishInput, PublishResult } from "./adapters";

interface PublishPostOptions {
  postId: number;
  subAccountId: number;
  trigger: "manual" | "scheduled";
  platforms?: string[];
  connectionIds?: number[];
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

    const input: PublishInput = {
      postId,
      subAccountId,
      connectionId,
      platform,
      title: post.title,
      body: post.body,
      mediaIds: post.mediaIds,
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
