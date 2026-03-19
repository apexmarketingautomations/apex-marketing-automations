import { db } from "./db";
import { contacts } from "@shared/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { audit } from "./auditTrail";
import { logSystemEvent } from "./systemLogger";

const STOP_KEYWORDS = ["stop", "unsubscribe", "cancel", "end", "quit", "optout", "opt-out", "opt out"];
const START_KEYWORDS = ["start", "subscribe", "unstop", "yes"];
const HELP_KEYWORDS = ["help", "info", "information"];

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function phoneVariants(phone: string): string[] {
  const normalized = normalizePhone(phone);
  const digits = phone.replace(/\D/g, "");
  const variants = new Set([phone, normalized, digits]);
  if (digits.length === 11 && digits.startsWith("1")) {
    variants.add(digits.substring(1));
    variants.add(`+${digits}`);
  }
  if (digits.length === 10) {
    variants.add(`1${digits}`);
    variants.add(`+1${digits}`);
  }
  return [...variants];
}

export function isOptOutMessage(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  return STOP_KEYWORDS.includes(normalized);
}

export function isOptInMessage(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  return START_KEYWORDS.includes(normalized);
}

export function isHelpMessage(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  return HELP_KEYWORDS.includes(normalized);
}

export async function handleSmsHelp(phone: string, subAccountId?: number): Promise<void> {
  try {
    await audit("SMS_HELP_REQUEST", "system", {
      phone: phone.slice(-4),
      subAccountId,
    });
    await logSystemEvent("info", "opt_out", `HELP request from ${phone.slice(-4)}`, { phone: phone.slice(-4), subAccountId });
  } catch (err) {
    console.error("[HELP] Error processing help request:", err);
  }
}

export async function handleSmsOptOut(phone: string, subAccountId?: number): Promise<boolean> {
  try {
    const variants = phoneVariants(phone);
    const phoneCondition = or(...variants.map(v => eq(contacts.phone, v)));

    const conditions = subAccountId
      ? and(phoneCondition!, eq(contacts.subAccountId, subAccountId))
      : phoneCondition;

    const matchingContacts = await db
      .select()
      .from(contacts)
      .where(conditions!);

    for (const contact of matchingContacts) {
      await db
        .update(contacts)
        .set({
          smsOptOut: true,
          optOutAt: new Date(),
        })
        .where(eq(contacts.id, contact.id));

      await audit("SMS_OPT_OUT", "system", {
        contactId: contact.id,
        phone,
        subAccountId: contact.subAccountId,
      });
    }

    if (matchingContacts.length === 0) {
      await logSystemEvent("info", "opt_out", `Opt-out from unknown number: ${phone.slice(-4)}`, { phone: phone.slice(-4) });
    }

    return matchingContacts.length > 0;
  } catch (err) {
    console.error("[OPT-OUT] Error processing opt-out:", err);
    return false;
  }
}

export async function handleSmsOptIn(phone: string, subAccountId?: number): Promise<boolean> {
  try {
    const variants = phoneVariants(phone);
    const phoneCondition = or(...variants.map(v => eq(contacts.phone, v)));

    const conditions = subAccountId
      ? and(phoneCondition!, eq(contacts.subAccountId, subAccountId))
      : phoneCondition;

    const matchingContacts = await db
      .select()
      .from(contacts)
      .where(conditions!);

    for (const contact of matchingContacts) {
      await db
        .update(contacts)
        .set({
          smsOptOut: false,
          optOutAt: null,
        })
        .where(eq(contacts.id, contact.id));

      await audit("SMS_OPT_IN", "system", {
        contactId: contact.id,
        phone,
        subAccountId: contact.subAccountId,
      });
    }

    return matchingContacts.length > 0;
  } catch (err) {
    console.error("[OPT-IN] Error processing opt-in:", err);
    return false;
  }
}

export async function isContactOptedOut(
  contactId: number,
  channel: "sms" | "email"
): Promise<boolean> {
  try {
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);

    if (!contact) return true;

    return channel === "sms" ? contact.smsOptOut : contact.emailOptOut;
  } catch {
    return false;
  }
}

export async function checkPhoneOptOut(phone: string, subAccountId: number): Promise<boolean> {
  try {
    const variants = phoneVariants(phone);
    const phoneCondition = or(...variants.map(v => eq(contacts.phone, v)));

    const [contact] = await db
      .select()
      .from(contacts)
      .where(and(phoneCondition!, eq(contacts.subAccountId, subAccountId)))
      .limit(1);

    return contact?.smsOptOut ?? false;
  } catch {
    return false;
  }
}
