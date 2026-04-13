import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and, gte, lt } from "drizzle-orm";
import { universalEvents, subAccounts } from "@shared/schema";

export async function aggregateRollupsForAccount(accountId: number): Promise<void> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const metrics = await db.select({
    eventType: universalEvents.eventType,
    count: sql<number>`count(*)::int`,
  })
    .from(universalEvents)
    .where(and(
      eq(universalEvents.subAccountId, accountId),
      gte(universalEvents.occurredAt, todayStart),
      lt(universalEvents.occurredAt, todayEnd),
    ))
    .groupBy(universalEvents.eventType);

  const metricMapping: Record<string, string> = {
    page_view: "total_page_views",
    button_click: "total_clicks",
    cta_click: "total_cta_clicks",
    form_submit: "total_form_submits",
    form_start: "total_form_starts",
    form_abandon: "total_form_abandons",
    message_sent: "total_messages_sent",
    message_received: "total_messages_received",
    card_scanned: "total_card_scans",
    card_opened: "total_card_opens",
    domain_searched: "total_domain_searches",
    site_published: "total_site_publishes",
    campaign_sent: "total_campaigns_sent",
    calendar_booked: "total_bookings",
    contact_created: "total_contacts_created",
    deal_created: "total_deals_created",
    lead_created: "total_leads_created",
    review_received: "total_reviews",
    crash_detected: "total_crashes_detected",
    workflow_triggered: "total_workflows_triggered",
    ad_campaign_launched: "total_ads_launched",
  };

  let totalEvents = 0;
  for (const metric of metrics) {
    totalEvents += metric.count;
    const metricName = metricMapping[metric.eventType] || `total_${metric.eventType}`;
    await storage.upsertActivityRollup({
      accountId,
      entityType: "account",
      entityId: String(accountId),
      metricName,
      metricValue: metric.count,
      periodType: "daily",
      periodStart: todayStart,
      periodEnd: todayEnd,
    });
  }

  await storage.upsertActivityRollup({
    accountId,
    entityType: "account",
    entityId: String(accountId),
    metricName: "total_events",
    metricValue: totalEvents,
    periodType: "daily",
    periodStart: todayStart,
    periodEnd: todayEnd,
  });

  const contactMetrics = await db.select({
    contactId: universalEvents.contactId,
    eventType: universalEvents.eventType,
    count: sql<number>`count(*)::int`,
  })
    .from(universalEvents)
    .where(and(
      eq(universalEvents.subAccountId, accountId),
      gte(universalEvents.occurredAt, todayStart),
      lt(universalEvents.occurredAt, todayEnd),
      sql`${universalEvents.contactId} is not null`,
    ))
    .groupBy(universalEvents.contactId, universalEvents.eventType)
    .limit(500);

  for (const cm of contactMetrics) {
    if (!cm.contactId) continue;
    const metricName = metricMapping[cm.eventType] || `total_${cm.eventType}`;
    await storage.upsertActivityRollup({
      accountId,
      entityType: "contact",
      entityId: String(cm.contactId),
      metricName,
      metricValue: cm.count,
      periodType: "daily",
      periodStart: todayStart,
      periodEnd: todayEnd,
    });
  }
}

let rollupInterval: NodeJS.Timeout | null = null;

export function startRollupWorker(intervalMs: number = 15 * 60 * 1000): void {
  console.log(`[APEX-INTEL] Rollup worker started (interval: ${intervalMs / 60000}min)`);

  async function runCycle() {
    try {
      const accounts = await db.select({ id: subAccounts.id }).from(subAccounts);
      for (const account of accounts) {
        await aggregateRollupsForAccount(account.id);
      }
      console.log(`[APEX-INTEL] Rollup cycle complete: ${accounts.length} accounts processed`);
    } catch (err) {
      console.error(`[APEX-INTEL] Rollup cycle failed:`, (err as Error).message);
    }
  }

  setTimeout(runCycle, 30000);
  rollupInterval = setInterval(runCycle, intervalMs);
}

export function stopRollupWorker(): void {
  if (rollupInterval) {
    clearInterval(rollupInterval);
    rollupInterval = null;
  }
}
