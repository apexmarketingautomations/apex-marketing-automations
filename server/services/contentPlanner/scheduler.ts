import { db } from "../../db";
import { eq, and, lte } from "drizzle-orm";
import { cpPosts } from "@shared/schema";
import { publishPost } from "./publisher";

export async function processDueScheduledPosts(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const now = new Date();

  const duePosts = await db.select().from(cpPosts)
    .where(and(
      eq(cpPosts.status, "scheduled"),
      lte(cpPosts.scheduledAt, now),
    ));

  let succeeded = 0;
  let failed = 0;

  for (const post of duePosts) {
    try {
      console.log(`[CP-SCHEDULER] Processing due post ${post.id} (subAccount ${post.subAccountId})`);
      const result = await publishPost({
        postId: post.id,
        subAccountId: post.subAccountId,
        trigger: "scheduled",
        platforms: post.platforms || undefined,
        connectionIds: post.connectionIds || undefined,
      });
      const allOk = result.results.every(r => r.success);
      if (allOk) succeeded++;
      else failed++;
    } catch (err: any) {
      console.error(`[CP-SCHEDULER] Failed to process post ${post.id}:`, err.message);
      failed++;

      await db.update(cpPosts).set({
        status: "failed",
        updatedAt: new Date(),
      }).where(eq(cpPosts.id, post.id));
    }
  }

  if (duePosts.length > 0) {
    console.log(`[CP-SCHEDULER] Processed ${duePosts.length} due posts: ${succeeded} succeeded, ${failed} failed`);
  }

  return { processed: duePosts.length, succeeded, failed };
}
