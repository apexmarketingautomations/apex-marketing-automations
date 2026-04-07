import { db } from "../../db";
import { subAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { syncContactToMailchimp, sendEmailViaCampaign, applyTagsToContact, TEMPLATE_KEYS } from "../../mailchimp";

const LOG = "[ROOMOS-PROVISION]";
const ADMIN_ACCOUNT_ID = 22;

interface RoomOSProvisionInput {
  cbUsername: string;
  email: string;
  plan: "roomos_starter" | "roomos_pro";
  userId?: string;
  firstName?: string;
}

interface ProvisionResult {
  subAccountId: number;
  cbWebhookToken: string;
  cbProMode: boolean;
  welcomeEmailSent: boolean;
  onboardingEmailQueued: boolean;
}

export async function provisionRoomOSAccount(input: RoomOSProvisionInput): Promise<ProvisionResult> {
  const { cbUsername, email, plan, userId, firstName } = input;
  const cbProMode = plan === "roomos_pro";
  const cbWebhookToken = crypto.randomBytes(32).toString("hex");
  const displayName = firstName || cbUsername;

  const [existing] = await db.select().from(subAccounts)
    .where(eq(subAccounts.cbUsername, cbUsername));

  let subAccountId: number;

  if (existing) {
    await db.update(subAccounts).set({
      cbProMode,
      cbWebhookToken,
      ...(userId ? { ownerUserId: userId } : {}),
    }).where(eq(subAccounts.id, existing.id));
    subAccountId = existing.id;
    console.log(`${LOG} Upgraded existing account ${subAccountId} (${cbUsername}) to ${plan}`);
  } else {
    const [newAccount] = await db.insert(subAccounts).values({
      name: `${cbUsername} (roomOS)`,
      twilioNumber: "none",
      cbUsername,
      cbGoalTokens: 500,
      cbProMode,
      cbWebhookToken,
      plan: "starter",
      ...(userId ? { ownerUserId: userId } : {}),
    }).returning();
    subAccountId = newAccount.id;
    console.log(`${LOG} Created new account ${subAccountId} for ${cbUsername} (${plan})`);
  }

  let welcomeEmailSent = false;
  let onboardingEmailQueued = false;

  try {
    await syncContactToMailchimp(ADMIN_ACCOUNT_ID, {
      email,
      firstName: displayName,
      source: "roomos",
      tags: ["roomos", plan, "roomos_onboarding"],
    });

    const welcomeResult = await sendEmailViaCampaign(
      ADMIN_ACCOUNT_ID,
      email,
      TEMPLATE_KEYS.ROOMOS_WELCOME,
      "roomos_signup",
      undefined,
      { "{{webhook_token}}": cbWebhookToken }
    );
    welcomeEmailSent = welcomeResult.success;
    if (!welcomeResult.success) {
      console.error(`${LOG} Welcome email failed for ${email}:`, welcomeResult.error);
    } else {
      console.log(`${LOG} Welcome email sent to ${email}`);
    }

    setTimeout(async () => {
      try {
        const onboardingResult = await sendEmailViaCampaign(
          ADMIN_ACCOUNT_ID,
          email,
          TEMPLATE_KEYS.ROOMOS_ONBOARDING,
          "roomos_onboarding",
        );
        if (onboardingResult.success) {
          console.log(`${LOG} Onboarding email sent to ${email}`);
        } else {
          console.error(`${LOG} Onboarding email failed for ${email}:`, onboardingResult.error);
        }
      } catch (err: any) {
        console.error(`${LOG} Onboarding email error:`, err.message);
      }
    }, 10 * 60 * 1000);
    onboardingEmailQueued = true;
  } catch (err: any) {
    console.error(`${LOG} Mailchimp error for ${email}:`, err.message);
  }

  return {
    subAccountId,
    cbWebhookToken,
    cbProMode,
    welcomeEmailSent,
    onboardingEmailQueued,
  };
}
