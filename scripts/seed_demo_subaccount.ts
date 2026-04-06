import { db } from "../server/db";
import { subAccounts } from "../shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const seedPayloadSchema = z.object({
  sub_account_id: z.number().int().positive(),
  demo_name: z.string().optional(),
});

async function run() {
  const rawPayload: unknown = JSON.parse(process.env.AGENT_JOB_PAYLOAD || "{}");
  const parseResult = seedPayloadSchema.safeParse(rawPayload);

  if (!parseResult.success) {
    console.error("[SEED-DEMO] Invalid payload:", parseResult.error.flatten().fieldErrors);
    process.exit(1);
  }

  const { sub_account_id: sourceId, demo_name: demoNameOverride } = parseResult.data;

  console.log(`[SEED-DEMO] Cloning sub_account ${sourceId} as demo copy`);

  const [source] = await db
    .select()
    .from(subAccounts)
    .where(eq(subAccounts.id, sourceId))
    .limit(1);

  if (!source) {
    console.error(`[SEED-DEMO] Source sub-account ${sourceId} not found`);
    process.exit(1);
  }

  const demoName = demoNameOverride || `${source.name} (Demo Copy)`;

  const { id, isProtected, protectedReason, ownerUserId, metaAccessToken, metaAppSecret, twilioSubaccountSid, twilioSubaccountAuthToken, ...rest } = source;

  const [demo] = await db.insert(subAccounts).values({
    ...rest,
    name: demoName,
    isProtected: false,
    protectedReason: null,
    ownerUserId: source.ownerUserId,
    metaAccessToken: null,
    metaAppSecret: null,
    twilioSubaccountSid: null,
    twilioSubaccountAuthToken: null,
    parentAccountId: sourceId,
    isDeletable: true,
    isInternal: false,
    billingExempt: true,
  }).returning();

  console.log(`[SEED-DEMO] Created demo sub-account #${demo.id} "${demoName}" from source #${sourceId}`);
  console.log(`[SEED-DEMO] Done`);
  process.exit(0);
}

run().catch((err: unknown) => {
  console.error("[SEED-DEMO] Fatal error:", err);
  process.exit(1);
});
