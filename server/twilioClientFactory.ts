import { storage } from "./storage";

export interface TwilioClientResult {
  client: any;
  sid: string;
  authToken: string;
  isFallback: boolean;
  phoneNumber: string | null;
}

const clientCache = new Map<string, { client: any; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function structuredLog(event: string, data: Record<string, any>) {
  console.log(JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    ...data,
  }));
}

async function createTwilioClient(sid: string, authToken: string): Promise<any> {
  const cacheKey = sid;
  const cached = clientCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.client;
  }
  const twilio = await import("twilio");
  const Twilio = twilio.default || twilio;
  const client = Twilio(sid, authToken);
  clientCache.set(cacheKey, { client, expiresAt: Date.now() + CACHE_TTL_MS });
  return client;
}

export async function getTwilioClientForAccount(subAccountId: number): Promise<TwilioClientResult | null> {
  const account = await storage.getSubAccount(subAccountId);
  if (!account) {
    structuredLog("twilio_client_resolved", {
      sub_account_id: subAccountId,
      status: "error",
      reason: "account_not_found",
    });
    return null;
  }

  if (account.twilioStatus === "migrated" && account.twilioSubaccountSid && account.twilioSubaccountAuthToken) {
    try {
      const client = await createTwilioClient(account.twilioSubaccountSid, account.twilioSubaccountAuthToken);
      structuredLog("twilio_client_resolved", {
        sub_account_id: subAccountId,
        twilio_sid: account.twilioSubaccountSid,
        phone_number: account.twilioNumber,
        status: "scoped",
      });
      return {
        client,
        sid: account.twilioSubaccountSid,
        authToken: account.twilioSubaccountAuthToken,
        isFallback: false,
        phoneNumber: account.twilioNumber,
      };
    } catch (err: any) {
      structuredLog("twilio_client_resolved", {
        sub_account_id: subAccountId,
        twilio_sid: account.twilioSubaccountSid,
        status: "error",
        reason: err.message,
      });
    }
  }

  const masterSid = process.env.TWILIO_ACCOUNT_SID;
  const masterToken = process.env.TWILIO_AUTH_TOKEN;
  if (!masterSid || !masterToken) {
    structuredLog("twilio_client_resolved", {
      sub_account_id: subAccountId,
      status: "error",
      reason: "no_master_credentials",
    });
    return null;
  }

  structuredLog("twilio_fallback_used", {
    sub_account_id: subAccountId,
    phone_number: account.twilioNumber,
    twilio_status: account.twilioStatus || "legacy",
  });

  const client = await createTwilioClient(masterSid, masterToken);
  return {
    client,
    sid: masterSid,
    authToken: masterToken,
    isFallback: true,
    phoneNumber: account.twilioNumber,
  };
}

export async function getMasterTwilioClient(): Promise<any | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return createTwilioClient(sid, token);
}

export function getAuthTokenForAccount(account: { twilioStatus: string | null; twilioSubaccountAuthToken: string | null }): string | null {
  if (account.twilioStatus === "migrated" && account.twilioSubaccountAuthToken) {
    return account.twilioSubaccountAuthToken;
  }
  return process.env.TWILIO_AUTH_TOKEN || null;
}

export async function createTwilioSubAccount(friendlyName: string): Promise<{ sid: string; authToken: string }> {
  const masterClient = await getMasterTwilioClient();
  if (!masterClient) {
    throw new Error("Master Twilio credentials not configured");
  }

  const subAccount = await masterClient.api.accounts.create({ friendlyName });

  structuredLog("subaccount_created", {
    twilio_sid: subAccount.sid,
    friendly_name: friendlyName,
  });

  return {
    sid: subAccount.sid,
    authToken: subAccount.authToken,
  };
}

export async function purchasePhoneInSubAccount(
  subAccountSid: string,
  subAccountAuthToken: string,
  areaCode?: string,
  country?: string
): Promise<string> {
  const client = await createTwilioClient(subAccountSid, subAccountAuthToken);
  const countryCode = country || "US";

  const searchParams: any = { limit: 1 };
  if (areaCode) searchParams.areaCode = areaCode;

  const available = await client.availablePhoneNumbers(countryCode).local.list(searchParams);
  if (available.length === 0) {
    throw new Error(`No available phone numbers found for area code ${areaCode || "any"} in ${countryCode}`);
  }

  const purchased = await client.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
  });

  structuredLog("phone_purchased", {
    twilio_sid: subAccountSid,
    phone_number: purchased.phoneNumber,
  });

  return purchased.phoneNumber;
}

export async function configureWebhooksForSubAccount(
  subAccountSid: string,
  subAccountAuthToken: string,
  phoneNumber: string,
  subAccountId: number,
  baseUrl: string
): Promise<void> {
  const client = await createTwilioClient(subAccountSid, subAccountAuthToken);

  const numbers = await client.incomingPhoneNumbers.list({ phoneNumber });
  if (numbers.length === 0) {
    throw new Error(`Phone number ${phoneNumber} not found in sub-account ${subAccountSid}`);
  }

  const smsUrl = `${baseUrl}/api/webhook/sms/${subAccountId}`;
  const statusCallback = `${baseUrl}/api/whatsapp-status`;

  await client.incomingPhoneNumbers(numbers[0].sid).update({
    smsUrl,
    smsMethod: "POST",
    statusCallback,
    statusCallbackMethod: "POST",
  });

  structuredLog("webhook_configured", {
    sub_account_id: subAccountId,
    twilio_sid: subAccountSid,
    phone_number: phoneNumber,
    sms_url: smsUrl,
  });
}

export async function provisionTwilioForSubAccount(
  subAccountId: number,
  friendlyName: string,
  baseUrl: string,
  options?: { areaCode?: string; country?: string; existingPhoneNumber?: string }
): Promise<{ sid: string; authToken: string; phoneNumber: string }> {
  structuredLog("migration_step_completed", {
    sub_account_id: subAccountId,
    step: "provisioning_started",
  });

  const account = await storage.getSubAccount(subAccountId);
  if (account?.twilioStatus === "migrated" && account.twilioSubaccountSid && account.twilioSubaccountAuthToken) {
    structuredLog("migration_step_completed", {
      sub_account_id: subAccountId,
      step: "already_provisioned",
      twilio_sid: account.twilioSubaccountSid,
      phone_number: account.twilioNumber,
    });
    return {
      sid: account.twilioSubaccountSid,
      authToken: account.twilioSubaccountAuthToken,
      phoneNumber: account.twilioNumber || "",
    };
  }

  let sid: string;
  let authToken: string;

  if (account?.twilioSubaccountSid && account?.twilioSubaccountAuthToken) {
    sid = account.twilioSubaccountSid;
    authToken = account.twilioSubaccountAuthToken;
    structuredLog("migration_step_completed", {
      sub_account_id: subAccountId,
      step: "reusing_existing_subaccount",
      twilio_sid: sid,
    });
  } else {
    const created = await createTwilioSubAccount(friendlyName);
    sid = created.sid;
    authToken = created.authToken;

    await storage.updateSubAccount(subAccountId, {
      twilioSubaccountSid: sid,
      twilioSubaccountAuthToken: authToken,
      twilioStatus: "provisioning",
    });
  }

  structuredLog("migration_step_completed", {
    sub_account_id: subAccountId,
    step: "subaccount_ready",
    twilio_sid: sid,
  });

  let phoneNumber: string;
  if (options?.existingPhoneNumber) {
    phoneNumber = options.existingPhoneNumber;
    try {
      const masterClient = await getMasterTwilioClient();
      if (masterClient) {
        const masterNumbers = await masterClient.incomingPhoneNumbers.list({ phoneNumber: options.existingPhoneNumber });
        if (masterNumbers.length > 0) {
          await masterClient.incomingPhoneNumbers(masterNumbers[0].sid).update({
            accountSid: sid,
          });
          structuredLog("migration_step_completed", {
            sub_account_id: subAccountId,
            step: "phone_transferred",
            phone_number: phoneNumber,
            twilio_sid: sid,
          });
        }
      }
    } catch (transferErr: any) {
      console.error(`[TWILIO-PROVISION] Phone transfer failed for ${options.existingPhoneNumber}:`, transferErr.message);
      phoneNumber = await purchasePhoneInSubAccount(sid, authToken, options?.areaCode, options?.country);
    }
  } else {
    phoneNumber = await purchasePhoneInSubAccount(sid, authToken, options?.areaCode, options?.country);
  }

  structuredLog("migration_step_completed", {
    sub_account_id: subAccountId,
    step: "phone_assigned",
    phone_number: phoneNumber,
    twilio_sid: sid,
  });

  await configureWebhooksForSubAccount(sid, authToken, phoneNumber, subAccountId, baseUrl);

  structuredLog("migration_step_completed", {
    sub_account_id: subAccountId,
    step: "webhooks_configured",
    twilio_sid: sid,
  });

  await storage.updateSubAccount(subAccountId, {
    twilioSubaccountSid: sid,
    twilioSubaccountAuthToken: authToken,
    twilioNumber: phoneNumber,
    twilioStatus: "migrated",
  });

  structuredLog("migration_step_completed", {
    sub_account_id: subAccountId,
    step: "provisioning_complete",
    twilio_sid: sid,
    phone_number: phoneNumber,
  });

  return { sid, authToken, phoneNumber };
}

export async function validateOutboundMessage(subAccountId: number, phoneNumber: string): Promise<{ valid: boolean; error?: string }> {
  const account = await storage.getSubAccount(subAccountId);
  if (!account) {
    return { valid: false, error: `Sub-account ${subAccountId} not found` };
  }

  if (account.twilioStatus === "migrated" && account.twilioSubaccountSid) {
    if (account.twilioNumber !== phoneNumber) {
      structuredLog("outbound_validation_mismatch", {
        sub_account_id: subAccountId,
        expected_phone: account.twilioNumber,
        actual_phone: phoneNumber,
        twilio_sid: account.twilioSubaccountSid,
      });
      return { valid: false, error: `Phone number ${phoneNumber} does not match sub-account ${subAccountId} (expected ${account.twilioNumber})` };
    }
  }

  return { valid: true };
}
