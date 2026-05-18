// @ts-nocheck
import { sendSms as sendSmsCore } from "./messaging/sendSms";

export async function sendSms(args: { to: string; body: string; subAccountId?: number; source?: string }) {
  const result = await sendSmsCore({
    subAccountId: args.subAccountId ?? 13,
    to: args.to,
    body: args.body,
    source: args.source ?? "home_service_pipeline",
  });
  if (!result.ok) {
    throw new Error(result.errorMessage || result.reason || "sendSms failed");
  }
  return result;
}

/**
 * Get Twilio client configured for a specific account/tenant.
 * Used for voice calls and advanced Twilio operations.
 */
export async function getTwilioClientForAccount(accountId: string) {
  try {
    // Import Twilio SDK
    const twilio = await import("twilio");
    
    // Get account-specific credentials from environment or database
    const accountSid = process.env.TWILIO_ACCOUNT_SID || "default";
    const authToken = process.env.TWILIO_AUTH_TOKEN || "default";
    const phoneNumber = process.env.TWILIO_PHONE_NUMBER || "";
    
    if (!accountSid || !authToken || !phoneNumber) {
      throw new Error("Twilio credentials not configured");
    }
    
    const client = twilio.default(accountSid, authToken);
    
    return {
      client,
      accountSid,
      phoneNumber,
    };
  } catch (err: any) {
    throw new Error(`Failed to get Twilio client for account ${accountId}: ${err?.message}`);
  }
}
