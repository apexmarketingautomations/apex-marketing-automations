import { storage } from "./storage";
import { db } from "./db";
import { messageBilling, messages } from "@shared/schema";
import type { MessageBilling } from "@shared/schema";
import { eq, and, sql, isNull } from "drizzle-orm";

export const CHANNEL_PRICING: Record<string, { providerCostEstimate: number; flatRate: number }> = {
  sms: { providerCostEstimate: 0.0079, flatRate: 0.02 },
  whatsapp: { providerCostEstimate: 0.005, flatRate: 0.015 },
  facebook: { providerCostEstimate: 0, flatRate: 0.01 },
  voice: { providerCostEstimate: 0.014, flatRate: 0.04 },
};

const BILLING_MULTIPLIER = 3;

export interface RecordBillingParams {
  subAccountId: number;
  messageId?: number;
  channel: string;
  provider: string;
  providerCost?: number;
  externalMessageId?: string | null;
  direction?: string;
  messageType?: string;
  billingExempt?: boolean;
  exemptReason?: string;
  metadata?: Record<string, unknown>;
}

export interface BillingResult {
  success: boolean;
  billingId?: number;
  billedAmount: number;
  margin: number;
  providerCost: number;
  walletDeducted?: boolean;
  walletRemaining?: number;
}

function calculateBilledAmount(providerCost: number, channel: string): number {
  if (providerCost > 0) {
    return parseFloat((providerCost * BILLING_MULTIPLIER).toFixed(6));
  }
  const pricing = CHANNEL_PRICING[channel];
  return pricing?.flatRate ?? 0.01;
}

export async function recordOutboundBilling(params: RecordBillingParams): Promise<BillingResult> {
  const {
    subAccountId,
    messageId,
    channel,
    provider,
    externalMessageId,
    direction = "outbound",
    messageType = "customer",
    billingExempt = false,
    exemptReason,
    metadata,
  } = params;

  const pricing = CHANNEL_PRICING[channel] || CHANNEL_PRICING.sms;
  const providerCost = params.providerCost ?? pricing.providerCostEstimate;
  const billedAmount = calculateBilledAmount(providerCost, channel);
  const margin = parseFloat((billedAmount - providerCost).toFixed(6));

  if (billingExempt) {
    console.log(JSON.stringify({
      event: "[BILLING] exempt_applied",
      subAccountId,
      channel,
      providerCost,
      billedAmount: 0,
      margin: 0,
      externalMessageId,
      exemptReason,
      timestamp: new Date().toISOString(),
    }));

    const record = await storage.createMessageBilling({
      subAccountId,
      messageId: messageId ?? null,
      channel,
      provider,
      providerCost,
      billedAmount: 0,
      margin: 0,
      externalMessageId: externalMessageId ?? null,
      direction,
      messageType,
      billingExempt: true,
      exemptReason: exemptReason ?? null,
      metadata: metadata ?? null,
    });

    return { success: true, billingId: record.id, billedAmount: 0, margin: 0, providerCost };
  }

  if (messageId) {
    const existing = await storage.getMessageBillingByMessageId(messageId);
    if (existing) {
      console.log(JSON.stringify({
        event: "[BILLING] duplicate_skipped",
        subAccountId,
        messageId,
        existingBillingId: existing.id,
        timestamp: new Date().toISOString(),
      }));
      return {
        success: true,
        billingId: existing.id,
        billedAmount: existing.billedAmount,
        margin: existing.margin,
        providerCost: existing.providerCost,
      };
    }
  }

  let record;
  try {
    record = await storage.createMessageBilling({
      subAccountId,
      messageId: messageId ?? null,
      channel,
      provider,
      providerCost,
      billedAmount,
      margin,
      externalMessageId: externalMessageId ?? null,
      direction,
      messageType,
      billingExempt: false,
      exemptReason: null,
      metadata: metadata ?? null,
    });
  } catch (insertErr: unknown) {
    const errMsg = insertErr instanceof Error ? insertErr.message : String(insertErr);
    const errStack = insertErr instanceof Error ? insertErr.stack : undefined;
    console.error(JSON.stringify({
      event: "[BILLING CRITICAL] record_failed",
      subAccountId,
      messageId,
      channel,
      provider,
      providerCost,
      billedAmount,
      error: errMsg,
      stack: errStack,
      timestamp: new Date().toISOString(),
    }));
    throw insertErr;
  }

  console.log(JSON.stringify({
    event: "[BILLING] record_created",
    billingId: record.id,
    subAccountId,
    channel,
    providerCost,
    billedAmount,
    margin,
    externalMessageId,
    timestamp: new Date().toISOString(),
  }));

  let walletDeducted = false;
  let walletRemaining: number | undefined;

  try {
    const wallet = await storage.getCreditWallet(subAccountId);
    if (wallet && wallet.balance >= billedAmount) {
      const updated = await storage.updateCreditWalletBalance(subAccountId, -billedAmount);
      walletRemaining = updated?.balance ?? 0;
      walletDeducted = true;

      await storage.createCreditTransaction({
        subAccountId,
        type: "usage",
        amount: -billedAmount,
        balanceAfter: walletRemaining,
        description: `${channel.toUpperCase()} ${messageType} message billing`,
        baseCost: providerCost,
        platformProfit: margin,
      });

      if (margin > 0) {
        await storage.createPlatformProfit({
          source: "markup",
          amount: margin,
          subAccountId,
          description: `${channel} message markup: $${providerCost.toFixed(4)} base → $${billedAmount.toFixed(4)} charged`,
        });
      }

      console.log(JSON.stringify({
        event: "[BILLING] wallet_deducted",
        subAccountId,
        channel,
        billedAmount,
        walletRemaining,
        timestamp: new Date().toISOString(),
      }));
    }
  } catch (walletErr: unknown) {
    const errMsg = walletErr instanceof Error ? walletErr.message : String(walletErr);
    console.error(`[BILLING] Wallet deduction failed for sub ${subAccountId}: ${errMsg}`);
  }

  try {
    const sub = await storage.getSubscriptionByAccountId(subAccountId);
    const stripeCustomerId = sub?.stripeCustomerId;
    if (stripeCustomerId) {
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      await stripe.billing.meterEvents.create({
        event_name: channel === "whatsapp" ? "whatsapp_message" : channel === "facebook" ? "facebook_message" : "sms_segment",
        payload: {
          value: billedAmount.toString(),
          stripe_customer_id: stripeCustomerId,
        },
      });
    }
  } catch (stripeErr: unknown) {
    const errMsg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr);
    console.log(`[BILLING] Stripe meter event skipped: ${errMsg}`);
  }

  return {
    success: true,
    billingId: record.id,
    billedAmount,
    margin,
    providerCost,
    walletDeducted,
    walletRemaining,
  };
}

interface CountRow {
  count: number;
}

interface UnbilledMessageRow {
  id: number;
  sub_account_id: number;
  channel: string;
  direction: string;
  message_sid: string | null;
  created_at: string;
}

export async function getBillingCoverage() {
  const totalOutbound = await db.select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(eq(messages.direction, "outbound"));

  const billedMessageCount = await db.execute(sql`
    SELECT count(DISTINCT message_id)::int AS count
    FROM message_billing
    WHERE message_id IS NOT NULL AND direction = 'outbound'
  `);

  const systemBillingCount = await db.select({ count: sql<number>`count(*)::int` })
    .from(messageBilling)
    .where(and(eq(messageBilling.direction, "outbound"), isNull(messageBilling.messageId)));

  const totalOutboundCount = totalOutbound[0]?.count ?? 0;
  const billedRow = billedMessageCount.rows[0] as CountRow | undefined;
  const linkedBilledCount = billedRow?.count ?? 0;
  const systemOnlyCount = systemBillingCount[0]?.count ?? 0;
  const coveragePct = totalOutboundCount > 0 ? parseFloat(((linkedBilledCount / totalOutboundCount) * 100).toFixed(2)) : 100;

  const channelBreakdown = await db.select({
    channel: messageBilling.channel,
    count: sql<number>`count(*)::int`,
    totalProviderCost: sql<number>`coalesce(sum(${messageBilling.providerCost}), 0)::real`,
    totalBilledAmount: sql<number>`coalesce(sum(${messageBilling.billedAmount}), 0)::real`,
    totalMargin: sql<number>`coalesce(sum(${messageBilling.margin}), 0)::real`,
  })
    .from(messageBilling)
    .groupBy(messageBilling.channel);

  const revenueBySubAccount = await db.select({
    subAccountId: messageBilling.subAccountId,
    totalBilled: sql<number>`coalesce(sum(${messageBilling.billedAmount}), 0)::real`,
    totalProviderCost: sql<number>`coalesce(sum(${messageBilling.providerCost}), 0)::real`,
    totalMargin: sql<number>`coalesce(sum(${messageBilling.margin}), 0)::real`,
    count: sql<number>`count(*)::int`,
  })
    .from(messageBilling)
    .groupBy(messageBilling.subAccountId);

  return {
    totalOutboundMessages: totalOutboundCount,
    totalWithBillingRecords: linkedBilledCount,
    systemBillingRecords: systemOnlyCount,
    coveragePercentage: coveragePct,
    unbilledCount: totalOutboundCount - linkedBilledCount,
    channelBreakdown,
    revenueBySubAccount,
  };
}

export async function runBillingAudit(backfill: boolean = false) {
  const unbilledMessages = await db.execute(sql`
    SELECT m.id, m.sub_account_id, m.channel, m.direction, m.message_sid, m.created_at
    FROM messages m
    LEFT JOIN message_billing mb ON mb.message_id = m.id
    WHERE m.direction = 'outbound' AND mb.id IS NULL
    ORDER BY m.created_at DESC
    LIMIT 1000
  `);

  const billedNoCost = await db.execute(sql`
    SELECT id, sub_account_id, channel, provider_cost, billed_amount, created_at
    FROM message_billing
    WHERE direction = 'outbound' AND provider_cost = 0 AND channel != 'facebook'
    LIMIT 500
  `);

  let backfilledCount = 0;
  if (backfill && unbilledMessages.rows.length > 0) {
    for (const rawRow of unbilledMessages.rows) {
      const row = rawRow as UnbilledMessageRow;
      const channel = row.channel || "sms";
      const pricing = CHANNEL_PRICING[channel] || CHANNEL_PRICING.sms;
      const providerCost = pricing.providerCostEstimate;
      const billedAmount = calculateBilledAmount(providerCost, channel);
      const margin = parseFloat((billedAmount - providerCost).toFixed(6));

      try {
        await storage.createMessageBilling({
          subAccountId: row.sub_account_id,
          messageId: row.id,
          channel,
          provider: channel === "facebook" ? "meta" : "twilio",
          providerCost,
          billedAmount,
          margin,
          externalMessageId: row.message_sid || null,
          direction: "outbound",
          messageType: "customer",
          billingExempt: false,
          exemptReason: null,
          metadata: { backfilled: true, estimatedAt: new Date().toISOString() },
        });
        backfilledCount++;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[BILLING] Backfill failed for message ${row.id}: ${errMsg}`);
      }
    }
  }

  const inconsistentChannels = await db.execute(sql`
    SELECT mb.id, mb.message_id, mb.channel AS billing_channel, m.channel AS message_channel,
           mb.sub_account_id, mb.created_at
    FROM message_billing mb
    JOIN messages m ON mb.message_id = m.id
    WHERE mb.channel != m.channel
    LIMIT 200
  `);

  return {
    unbilledMessages: unbilledMessages.rows.length,
    unbilledSample: unbilledMessages.rows.slice(0, 50),
    billedWithoutProviderCost: billedNoCost.rows.length,
    billedNoCostSample: billedNoCost.rows.slice(0, 20),
    inconsistentChannelClassification: inconsistentChannels.rows.length,
    inconsistentChannelSample: inconsistentChannels.rows.slice(0, 20),
    backfilled: backfill ? backfilledCount : undefined,
  };
}

export async function deductWalletForMessaging(params: {
  subAccountId: number;
  baseCost: number;
  channel: string;
  description?: string;
}): Promise<BillingResult> {
  return recordOutboundBilling({
    subAccountId: params.subAccountId,
    channel: params.channel,
    provider: params.channel === "facebook" ? "meta" : "twilio",
    providerCost: params.baseCost,
    direction: "outbound",
    messageType: "customer",
    metadata: { source: "wallet_deduct", description: params.description },
  });
}
