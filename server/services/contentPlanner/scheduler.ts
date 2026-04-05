import { db } from "../../db";
import { eq, and, lte } from "drizzle-orm";
import { contentPosts, contentPostPlatforms } from "@shared/schema";
import { publishPost } from "./publisher";

export async function processDueScheduledPosts(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const now = new Date();

  const duePosts = await db.select().from(contentPosts)
    .where(and(
      eq(contentPosts.status, "scheduled"),
      lte(contentPosts.scheduledAt, now),
    ));

  let succeeded = 0;
  let failed = 0;

  for (const post of duePosts) {
    try {
      console.log(`[CP-SCHEDULER] Processing due post ${post.id} (subAccount ${post.subAccountId})`);

      const postPlatforms = await db.select().from(contentPostPlatforms)
        .where(eq(contentPostPlatforms.postId, post.id));

      const platforms = postPlatforms.length > 0
        ? postPlatforms.map(pp => pp.platform)
        : undefined;

      const result = await publishPost({
        postId: post.id,
        subAccountId: post.subAccountId,
        trigger: "scheduled",
        platforms,
      });
      const allOk = result.results.every(r => r.success);
      if (allOk) succeeded++;
      else failed++;
    } catch (err: any) {
      console.error(`[CP-SCHEDULER] Failed to process post ${post.id}:`, err.message);
      failed++;

      await db.update(contentPosts).set({
        status: "failed",
        updatedAt: new Date(),
      }).where(eq(contentPosts.id, post.id));
    }
  }

  if (duePosts.length > 0) {
    console.log(`[CP-SCHEDULER] Processed ${duePosts.length} due posts: ${succeeded} succeeded, ${failed} failed`);
  }

  return { processed: duePosts.length, succeeded, failed };
}
