import webpush from "web-push";

import { storage } from "./storage";
import { enforceSmsProvider } from "./smsGatewayGuard";
import type { NotificationPreference } from "@shared/schema";

const VAPID_SUBJECT = "mailto:alerts@apexmarketingautomations.com";

let vapidConfigured = false;

function ensureVapidKeys() {
  if (vapidConfigured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return false;
  }
  webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

async function getTwilioClientForSub(subAccountId: number) {
  const { getTwilioClientForAccount } = await import("./twilioClientFactory");
  const result = await getTwilioClientForAccount(subAccountId);
  return result?.client || null;
}


export type AlertEventType =
  | "new_lead"
  | "missed_call"
  | "payment_failed"
  | "incident"
  | "nudge_high"
  | "agent_urgent"
  | "campaign_alert"
  | "system_alert";

interface AlertPayload {
  title: string;
  body: string;
  link?: string;
  icon?: string;
  tag?: string;
  urgency?: "very-low" | "low" | "normal" | "high";
}

const EVENT_PREF_MAP: Record<AlertEventType, { push: keyof NotificationPreference; sms: keyof NotificationPreference }> = {
  new_lead: { push: "newLeadPush", sms: "newLeadSms" },
  missed_call: { push: "missedCallPush", sms: "missedCallSms" },
  payment_failed: { push: "paymentFailedPush", sms: "paymentFailedSms" },
  incident: { push: "incidentPush", sms: "incidentSms" },
  nudge_high: { push: "nudgeHighPush", sms: "nudgeHighSms" },
  agent_urgent: { push: "agentUrgentPush", sms: "agentUrgentSms" },
  campaign_alert: { push: "campaignAlertPush", sms: "campaignAlertSms" },
  system_alert: { push: "systemAlertPush", sms: "systemAlertSms" },
};

function isInQuietHours(prefs: NotificationPreference): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = (prefs.quietHoursStart || "22:00").split(":").map(Number);
  const [endH, endM] = (prefs.quietHoursEnd || "08:00").split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export async function dispatchAlert(
  subAccountId: number,
  eventType: AlertEventType,
  payload: AlertPayload
): Promise<{ pushSent: number; smsSent: boolean }> {
  let pushSent = 0;
  let smsSent = false;

  try {
    const prefs = await storage.getNotificationPreferences(subAccountId);

    const defaultPrefs: Record<string, boolean> = {
      newLeadPush: true, newLeadSms: false,
      missedCallPush: true, missedCallSms: true,
      paymentFailedPush: true, paymentFailedSms: true,
      incidentPush: true, incidentSms: true,
      nudgeHighPush: true, nudgeHighSms: false,
      agentUrgentPush: true, agentUrgentSms: true,
      campaignAlertPush: true, campaignAlertSms: false,
      systemAlertPush: true, systemAlertSms: false,
    };

    const prefMap = EVENT_PREF_MAP[eventType];
    if (!prefMap) return { pushSent: 0, smsSent: false };

    const shouldPush = prefs ? prefs[prefMap.push] : defaultPrefs[prefMap.push as string];
    const shouldSms = prefs ? prefs[prefMap.sms] : defaultPrefs[prefMap.sms as string];

    const quiet = prefs ? isInQuietHours(prefs) : false;
    const isUrgent = eventType === "agent_urgent" || eventType === "payment_failed" || eventType === "incident";

    if (shouldPush && (!quiet || isUrgent)) {
      pushSent = await sendBrowserPush(subAccountId, payload);
    }

    if (shouldSms && (!quiet || isUrgent)) {
      const phone = prefs?.smsAlertPhone || await getOwnerPhone(subAccountId);
      if (phone) {
        smsSent = await sendSmsAlert(subAccountId, phone, payload);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PUSH-ALERT] dispatch error for account ${subAccountId}, event=${eventType}:`, msg);
  }

  return { pushSent, smsSent };
}

async function sendBrowserPush(subAccountId: number, payload: AlertPayload): Promise<number> {
  if (!ensureVapidKeys()) return 0;

  const subscriptions = await storage.getPushSubscriptions(subAccountId);
  if (subscriptions.length === 0) return 0;

  const pushPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon || "/favicon.ico",
    badge: "/favicon.ico",
    tag: payload.tag || `apex-${Date.now()}`,
    data: {
      url: payload.link || "/",
    },
  });

  let sentCount = 0;
  const staleEndpoints: string[] = [];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        pushPayload,
        {
          urgency: payload.urgency || "normal",
          TTL: 86400,
        }
      );
      sentCount++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        staleEndpoints.push(sub.endpoint);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[PUSH-ALERT] browser push failed for account ${subAccountId}:`, msg);
      }
    }
  }

  for (const endpoint of staleEndpoints) {
    try {
      await storage.deletePushSubscription(endpoint, subAccountId);
    } catch (cleanupErr) {
      console.error(`[PUSH-ALERT] stale subscription cleanup failed:`, cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr));
    }
  }

  return sentCount;
}

async function sendSmsAlert(subAccountId: number, phone: string, payload: AlertPayload): Promise<boolean> {
  await enforceSmsProvider("sms", "twilio", {
    subAccountId,
    phone,
    source: "push-alert-service",
  });

  const client = await getTwilioClientForSub(subAccountId);
  if (!client) return false;

  const account = await storage.getSubAccount(subAccountId);
  const fromNumber = account?.twilioNumber;
  if (!fromNumber) return false;

  const smsBody = `[Apex Alert] ${payload.title}\n${payload.body}${payload.link ? `\nView: ${payload.link}` : ""}`;

  try {
    await client.messages.create({
      body: smsBody.substring(0, 1600),
      from: fromNumber,
      to: phone,
    });
    console.log(`[PUSH-ALERT] SMS sent to ${phone} for account ${subAccountId}`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PUSH-ALERT] SMS failed for account ${subAccountId}:`, msg);
    return false;
  }
}

async function getOwnerPhone(subAccountId: number): Promise<string | null> {
  const account = await storage.getSubAccount(subAccountId);
  return account?.ownerPhone || null;
}

export function generateDeepLink(path: string): string {
  const host = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(",")[0] || "localhost:5000";
  const protocol = host.includes("localhost") ? "http" : "https";
  return `${protocol}://${host}${path}`;
}
