import { audit } from "./auditTrail";

const ALLOWED_SMS_PROVIDER = "twilio";

export interface SmsGuardContext {
  subAccountId: number;
  phone?: string | null;
  source: string;
  provider?: string;
}

export class SmsProviderViolationError extends Error {
  constructor(
    public readonly context: SmsGuardContext,
    attemptedProvider: string,
  ) {
    super(
      `SMS provider violation: attempted to send SMS via "${attemptedProvider}" instead of "${ALLOWED_SMS_PROVIDER}". ` +
      `Source: ${context.source}, subAccount: ${context.subAccountId}`,
    );
    this.name = "SmsProviderViolationError";
  }
}

export async function enforceSmsProvider(
  channel: string,
  provider: string,
  context: SmsGuardContext,
): Promise<void> {
  if (channel !== "sms") return;

  const resolvedProvider = provider.toLowerCase();

  if (resolvedProvider !== ALLOWED_SMS_PROVIDER) {
    const details = {
      channel,
      attemptedProvider: resolvedProvider,
      requiredProvider: ALLOWED_SMS_PROVIDER,
      subAccountId: context.subAccountId,
      phone: context.phone ? `***${String(context.phone).slice(-4)}` : undefined,
      source: context.source,
      timestamp: new Date().toISOString(),
    };

    console.error(
      `[SMS-GUARD] BLOCKED: SMS send attempted via "${resolvedProvider}" from source="${context.source}" ` +
      `for subAccount=${context.subAccountId}. Only Twilio is permitted for SMS.`,
    );

    await audit("SMS_PROVIDER_VIOLATION", "sms-gateway-guard", details);

    throw new SmsProviderViolationError(context, resolvedProvider);
  }
}
