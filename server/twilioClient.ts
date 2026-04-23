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
