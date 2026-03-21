import { storage } from "./storage";
import { provisionTwilioForSubAccount, getMasterTwilioClient } from "./twilioClientFactory";

function structuredLog(event: string, data: Record<string, any>) {
  console.log(JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    ...data,
  }));
}

export async function migrateAllSubAccounts(baseUrl: string): Promise<{
  total: number;
  migrated: number;
  skipped: number;
  failed: number;
  results: Array<{ subAccountId: number; status: string; error?: string }>;
}> {
  const allAccounts = await storage.getSubAccounts();
  const results: Array<{ subAccountId: number; status: string; error?: string }> = [];
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  structuredLog("migration_step_completed", {
    step: "migration_started",
    total_accounts: allAccounts.length,
  });

  for (const account of allAccounts) {
    if (account.twilioStatus === "migrated" && account.twilioSubaccountSid) {
      structuredLog("migration_step_completed", {
        sub_account_id: account.id,
        step: "already_migrated",
        twilio_sid: account.twilioSubaccountSid,
      });
      results.push({ subAccountId: account.id, status: "already_migrated" });
      skipped++;
      continue;
    }

    if (!account.twilioNumber) {
      structuredLog("migration_step_completed", {
        sub_account_id: account.id,
        step: "skipped_no_phone",
      });
      results.push({ subAccountId: account.id, status: "skipped_no_phone" });
      skipped++;
      continue;
    }

    try {
      await provisionTwilioForSubAccount(
        account.id,
        `${account.name}`,
        baseUrl,
        { existingPhoneNumber: account.twilioNumber }
      );

      results.push({ subAccountId: account.id, status: "migrated" });
      migrated++;
    } catch (err: any) {
      structuredLog("migration_step_completed", {
        sub_account_id: account.id,
        step: "migration_failed",
        error: err.message,
      });
      results.push({ subAccountId: account.id, status: "failed", error: err.message });
      failed++;
    }
  }

  structuredLog("migration_step_completed", {
    step: "migration_complete",
    total: allAccounts.length,
    migrated,
    skipped,
    failed,
  });

  return { total: allAccounts.length, migrated, skipped, failed, results };
}

export async function migrateSingleSubAccount(subAccountId: number, baseUrl: string): Promise<{
  status: string;
  error?: string;
  twilioSid?: string;
  phoneNumber?: string;
}> {
  const account = await storage.getSubAccount(subAccountId);
  if (!account) {
    return { status: "error", error: "Account not found" };
  }

  if (account.twilioStatus === "migrated" && account.twilioSubaccountSid) {
    return { status: "already_migrated", twilioSid: account.twilioSubaccountSid, phoneNumber: account.twilioNumber };
  }

  if (!account.twilioNumber) {
    return { status: "error", error: "No phone number assigned to this account" };
  }

  try {
    const result = await provisionTwilioForSubAccount(
      subAccountId,
      account.name,
      baseUrl,
      { existingPhoneNumber: account.twilioNumber }
    );
    return { status: "migrated", twilioSid: result.sid, phoneNumber: result.phoneNumber };
  } catch (err: any) {
    return { status: "error", error: err.message };
  }
}
