import { db } from "../../db";
import { eq, and, lte } from "drizzle-orm";
import { contentPosts } from "@shared/schema";

export async function processDueScheduledPosts(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  note: string;
}> {
  const duePosts = await db.select({ id: contentPosts.id }).from(contentPosts)
    .where(and(
      eq(contentPosts.status, "scheduled"),
      lte(contentPosts.scheduledAt, new Date()),
    ));

  if (duePosts.length > 0) {
    console.log(`[CP-SCHEDULER-LEGACY] ${duePosts.length} due posts found. Background worker will publish them on its next tick.`);
  }

  return {
    processed: duePosts.length,
    succeeded: 0,
    failed: 0,
    note: "Publishing is handled by the background worker (schedulerWorker.ts) to prevent duplicate jobs.",
  };
}
