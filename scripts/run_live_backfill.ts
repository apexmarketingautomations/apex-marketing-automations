import { db } from "../server/db";
import { commentAutoReplies, ownerUnlocks, systemLogs, subAccounts } from "../shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { z } from "zod";

const backfillPayloadSchema = z.object({
  sub_account_id: z.number().int().positive(),
  owner_unlock_token: z.string().min(1),
});

interface BackfillDiff {
  commentId: string;
  commenterId: string | null;
  oldName: string | null;
  newName: string;
}

interface FacebookNameResponse {
  name?: string;
}

async function run() {
  const rawPayload: unknown = JSON.parse(process.env.AGENT_JOB_PAYLOAD || "{}");
  const parseResult = backfillPayloadSchema.safeParse(rawPayload);

  if (!parseResult.success) {
    console.error("[BACKFILL] Invalid payload:", parseResult.error.flatten().fieldErrors);
    process.exit(1);
  }

  const { sub_account_id: subAccountId, owner_unlock_token: unlockToken } = parseResult.data;

  console.log(`[BACKFILL] Starting backfill for sub_account_id=${subAccountId}`);

  const [account] = await db
    .select({ id: subAccounts.id, metaAccessToken: subAccounts.metaAccessToken, isProtected: subAccounts.isProtected })
    .from(subAccounts)
    .where(eq(subAccounts.id, subAccountId))
    .limit(1);

  if (!account) {
    console.error(`[BACKFILL] Sub-account ${subAccountId} not found`);
    process.exit(1);
  }

  if (account.isProtected) {
    console.error(`[BACKFILL] Sub-account ${subAccountId} is protected — aborting`);
    process.exit(1);
  }

  const [unlock] = await db
    .select()
    .from(ownerUnlocks)
    .where(
      and(
        eq(ownerUnlocks.subAccountId, subAccountId),
        eq(ownerUnlocks.used, false),
        eq(ownerUnlocks.purpose, "run_backfill_for_subaccount"),
        eq(ownerUnlocks.token, unlockToken)
      )
    )
    .limit(1);

  if (!unlock) {
    console.error(`[BACKFILL] No matching unused owner_unlock found for sub_account ${subAccountId}`);
    process.exit(1);
  }

  if (new Date(unlock.expiresAt) < new Date()) {
    console.error(`[BACKFILL] owner_unlock has expired for sub_account ${subAccountId}`);
    process.exit(1);
  }

  const accessToken = account.metaAccessToken;
  if (!accessToken) {
    console.error(`[BACKFILL] Sub-account ${subAccountId} has no Meta access token configured`);
    process.exit(1);
  }

  const rows = await db
    .select()
    .from(commentAutoReplies)
    .where(
      and(
        eq(commentAutoReplies.subAccountId, subAccountId),
        isNull(commentAutoReplies.commenterName)
      )
    );

  console.log(`[BACKFILL] Found ${rows.length} comment_auto_replies rows with missing commenter names`);

  const diffs: BackfillDiff[] = [];
  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.commenterId) {
      console.log(`[BACKFILL] Skipping row ${row.id} — no commenter_id`);
      continue;
    }

    try {
      const url = `https://graph.facebook.com/v19.0/${row.commenterId}?fields=name&access_token=${accessToken}`;
      const resp = await fetch(url);

      if (!resp.ok) {
        const errBody = await resp.text();
        console.warn(`[BACKFILL] Facebook API error for commenter ${row.commenterId}: ${resp.status} ${errBody.substring(0, 200)}`);
        failed++;
        continue;
      }

      const data = (await resp.json()) as FacebookNameResponse;
      const commenterName = data.name;

      if (commenterName) {
        await db
          .update(commentAutoReplies)
          .set({ commenterName })
          .where(eq(commentAutoReplies.id, row.id));

        diffs.push({
          commentId: row.commentId,
          commenterId: row.commenterId,
          oldName: null,
          newName: commenterName,
        });
        updated++;
        console.log(`[BACKFILL] Updated row ${row.id}: commenter_name = "${commenterName}"`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[BACKFILL] Error fetching name for ${row.commenterId}: ${errMsg}`);
      failed++;
    }
  }

  await db.update(ownerUnlocks)
    .set({ used: true, usedAt: new Date() })
    .where(eq(ownerUnlocks.id, unlock.id));
  console.log(`[BACKFILL] owner_unlock #${unlock.id} marked as used`);

  const summary = {
    subAccountId,
    totalRows: rows.length,
    updated,
    failed,
    skipped: rows.length - updated - failed,
    timestamp: new Date().toISOString(),
  };

  await db.insert(systemLogs).values({
    severity: "info",
    module: "agent_backfill",
    message: `Backfill completed for sub_account ${subAccountId}: ${updated} updated, ${failed} failed`,
    metadata: { ...summary, diffs },
  });

  const diffDir = path.resolve(process.cwd(), "logs");
  if (!fs.existsSync(diffDir)) {
    fs.mkdirSync(diffDir, { recursive: true });
  }
  const diffPath = path.join(diffDir, `backfill_${subAccountId}_${Date.now()}.json`);
  fs.writeFileSync(diffPath, JSON.stringify({ summary, diffs }, null, 2));
  console.log(`[BACKFILL] Diff file written to ${diffPath}`);

  console.log(`[BACKFILL] Done: ${updated} updated, ${failed} failed, ${rows.length - updated - failed} skipped`);
  process.exit(0);
}

run().catch((err: unknown) => {
  console.error("[BACKFILL] Fatal error:", err);
  process.exit(1);
});
