// @ts-nocheck
import { db } from "../db";
import { subAccounts, contacts } from "@shared/schema";
import { eq, or } from "drizzle-orm";

export interface RoutingResolution {
  subAccountId: number;
  method: "phone_match" | "explicit_assignment" | "contact_ownership" | "campaign_source";
}

export interface RoutingFailureResult {
  error: true;
  reason: string;
  phone?: string;
  channel?: string;
  source?: string;
}

export type ResolveResult = RoutingResolution | RoutingFailureResult;

export function isRoutingFailure(result: ResolveResult): result is RoutingFailureResult {
  return (result as RoutingFailureResult).error === true;
}

function normalizePhone(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  const variants = new Set<string>([phone]);
  if (digits.length === 11 && digits.startsWith("1")) {
    variants.add(`+${digits}`);
    variants.add(digits);
    variants.add(digits.substring(1));
  } else if (digits.length === 10) {
    variants.add(`+1${digits}`);
    variants.add(`1${digits}`);
    variants.add(digits);
  }
  return [...variants];
}

export interface ResolveOptions {
  phone?: string;
  explicitSubAccountId?: number;
  channel?: string;
  source?: string;
}

export async function resolveSubAccount(options: ResolveOptions): Promise<ResolveResult> {
  const { phone, explicitSubAccountId, channel, source } = options;

  // Priority 1: Phone number match against sub-account Twilio numbers
  if (phone) {
    const phoneVariants = normalizePhone(phone);
    const allAccounts = await db.select().from(subAccounts).execute().catch((err) => { console.warn("[RESOLVER] promise rejected, using default []:", err instanceof Error ? err.message : err); return []; });
    for (const account of allAccounts) {
      if (account.twilioNumber && phoneVariants.includes(account.twilioNumber)) {
        return { subAccountId: account.id, method: "phone_match" };
      }
    }
  }

  // Priority 2: Explicit sub-account assignment
  if (explicitSubAccountId && explicitSubAccountId > 0) {
    const account = await db.select().from(subAccounts)
      .where(eq(subAccounts.id, explicitSubAccountId))
      .limit(1)
      .execute()
      .catch((err) => { console.warn("[RESOLVER] promise rejected, using default []:", err instanceof Error ? err.message : err); return []; });
    if (account.length > 0) {
      return { subAccountId: explicitSubAccountId, method: "explicit_assignment" };
    }
    return {
      error: true,
      reason: `Explicit sub-account ${explicitSubAccountId} not found`,
      phone,
      channel,
      source,
    };
  }

  // Priority 3: Contact ownership lookup by phone
  if (phone) {
    const phoneVariants = normalizePhone(phone);
    const conditions = phoneVariants.map(v => eq(contacts.phone, v));
    const matchedContacts = await db.select().from(contacts)
      .where(or(...conditions))
      .limit(1)
      .execute()
      .catch((err) => { console.warn("[RESOLVER] promise rejected, using default []:", err instanceof Error ? err.message : err); return []; });
    if (matchedContacts.length > 0) {
      return { subAccountId: matchedContacts[0].subAccountId, method: "contact_ownership" };
    }
  }

  // Priority 4: Campaign/source mapping
  if (source) {
    const allAccounts = await db.select().from(subAccounts).execute().catch((err) => { console.warn("[RESOLVER] promise rejected, using default []:", err instanceof Error ? err.message : err); return []; });
    // Attempt to match source tag pattern like "source:accountId" or check name match
    const sourceParts = source.split(":");
    if (sourceParts.length === 2 && !isNaN(parseInt(sourceParts[1]))) {
      const candidateId = parseInt(sourceParts[1]);
      const account = allAccounts.find(a => a.id === candidateId);
      if (account) {
        return { subAccountId: account.id, method: "campaign_source" };
      }
    }
    // Match by account name in source
    const nameMatch = allAccounts.find(a =>
      a.name && source.toLowerCase().includes(a.name.toLowerCase())
    );
    if (nameMatch) {
      return { subAccountId: nameMatch.id, method: "campaign_source" };
    }
  }

  return {
    error: true,
    reason: `No sub-account could be resolved for phone=${phone ?? "none"}, source=${source ?? "none"}, channel=${channel ?? "none"}`,
    phone,
    channel,
    source,
  };
}
