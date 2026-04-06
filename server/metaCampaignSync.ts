import { jobQueue } from "./jobQueue";
import { storage } from "./storage";
import { getMetaConfig } from "./metaConfig";

const SYNC_INTERVAL_MS = 3_600_000;
let syncIntervalHandle: ReturnType<typeof setInterval> | null = null;

async function syncCampaignInsights(campaignId: number): Promise<{ synced: boolean; error?: string }> {
  const campaign = await storage.getMetaAdCampaign(campaignId);
  if (!campaign || !campaign.metaCampaignId) {
    return { synced: false, error: "No linked Meta campaign ID" };
  }

  let metaCfg;
  try {
    metaCfg = await getMetaConfig(campaign.subAccountId);
  } catch (err: any) {
    return { synced: false, error: `Meta not configured: ${err.message}` };
  }

  try {
    const fbRes = await fetch(
      `https://graph.facebook.com/v21.0/${campaign.metaCampaignId}/insights?fields=impressions,clicks,spend,cpc,ctr,actions&access_token=${metaCfg.accessToken}`,
      { signal: AbortSignal.timeout(15000) }
    );

    if (!fbRes.ok) {
      const errBody = await fbRes.text().catch(() => "");
      return { synced: false, error: `Facebook API error ${fbRes.status}: ${errBody.slice(0, 200)}` };
    }

    const fbData = await fbRes.json() as any;

    if (fbData.data && fbData.data[0]) {
      const insights = fbData.data[0];
      const leads = insights.actions?.find((a: any) => a.action_type === "lead")?.value || 0;
      await storage.updateMetaAdCampaign(campaign.id, {
        impressions: parseInt(insights.impressions || "0"),
        clicks: parseInt(insights.clicks || "0"),
        totalSpend: parseFloat(insights.spend || "0"),
        cpc: parseFloat(insights.cpc || "0"),
        ctr: parseFloat(insights.ctr || "0"),
        leads: parseInt(leads),
        lastSyncedAt: new Date(),
      });
    } else {
      await storage.updateMetaAdCampaign(campaign.id, { lastSyncedAt: new Date() });
    }

    return { synced: true };
  } catch (err: any) {
    return { synced: false, error: err.message };
  }
}

async function syncLeadsForAccount(subAccountId: number): Promise<{ synced: number; error?: string }> {
  let metaCfg;
  try {
    metaCfg = await getMetaConfig(subAccountId);
  } catch {
    return { synced: 0, error: "Meta not configured" };
  }

  try {
    const formsRes = await fetch(
      `https://graph.facebook.com/v21.0/${metaCfg.pageId}/leadgen_forms?access_token=${metaCfg.accessToken}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!formsRes.ok) {
      return { synced: 0, error: `Facebook API error ${formsRes.status} fetching lead forms` };
    }
    const formsData = await formsRes.json() as any;
    let totalSynced = 0;

    if (formsData.data) {
      for (const form of formsData.data) {
        const leadsRes = await fetch(
          `https://graph.facebook.com/v21.0/${form.id}/leads?access_token=${metaCfg.accessToken}`,
          { signal: AbortSignal.timeout(15000) }
        );
        if (!leadsRes.ok) continue;
        const leadsData = await leadsRes.json() as any;
        if (leadsData.data) {
          const existingLeads = await storage.getMetaLeads(subAccountId);
          const existingKeys = new Set(existingLeads.map(l => `${l.metaFormId}:${l.name}:${l.email}`));

          for (const lead of leadsData.data) {
            const fields = lead.field_data || [];
            const getName = (key: string) => fields.find((f: any) => f.name === key)?.values?.[0] || "";
            const name = getName("full_name") || getName("first_name") || "Unknown";
            const email = getName("email") || "";
            const dedupeKey = `${form.id}:${name}:${email}`;

            if (existingKeys.has(dedupeKey)) continue;

            await storage.createMetaLead({
              subAccountId,
              metaFormId: form.id,
              formName: form.name,
              name,
              email,
              phone: getName("phone_number"),
              customFields: fields,
            });
            existingKeys.add(dedupeKey);
            totalSynced++;
          }
        }
      }
    }

    return { synced: totalSynced };
  } catch (err: any) {
    return { synced: 0, error: err.message };
  }
}

async function runFullSync(): Promise<void> {
  console.log("[META-SYNC] Starting background campaign sync...");

  try {
    const allCampaigns = await storage.getAllMetaAdCampaigns?.() || [];
    const activeCampaigns = allCampaigns.filter(
      (c: any) => c.metaCampaignId && (c.status === "active" || c.status === "published")
    );

    if (activeCampaigns.length === 0) {
      console.log("[META-SYNC] No active campaigns to sync");
      return;
    }

    const subAccountIds = [...new Set(activeCampaigns.map((c: any) => c.subAccountId))];
    let syncedCampaigns = 0;
    let syncedLeads = 0;

    for (const campaign of activeCampaigns) {
      const result = await syncCampaignInsights(campaign.id);
      if (result.synced) syncedCampaigns++;
      else console.warn(`[META-SYNC] Campaign ${campaign.id} sync failed: ${result.error}`);
    }

    for (const subAccountId of subAccountIds) {
      const leadResult = await syncLeadsForAccount(subAccountId);
      syncedLeads += leadResult.synced;
      if (leadResult.error) {
        console.warn(`[META-SYNC] Lead sync for account ${subAccountId} failed: ${leadResult.error}`);
      }
    }

    console.log(`[META-SYNC] Completed: ${syncedCampaigns}/${activeCampaigns.length} campaigns synced, ${syncedLeads} new leads imported`);
  } catch (err: any) {
    console.error("[META-SYNC] Background sync error:", err.message);
  }
}

export function registerMetaCampaignSyncJob(): void {
  jobQueue.registerHandler("meta_campaign_sync", async () => {
    await runFullSync();
    return { syncedAt: new Date().toISOString() };
  });

  console.log("[META-SYNC] Background sync handler registered (interval: 45min)");
}

export function startMetaCampaignSyncScheduler(): void {
  if (syncIntervalHandle) return;

  syncIntervalHandle = setInterval(() => {
    jobQueue.enqueue("meta_campaign_sync", { triggeredBy: "scheduler", scheduledAt: new Date().toISOString() });
  }, SYNC_INTERVAL_MS);

  if (syncIntervalHandle && typeof syncIntervalHandle === "object" && "unref" in syncIntervalHandle) {
    syncIntervalHandle.unref();
  }

  setTimeout(() => {
    jobQueue.enqueue("meta_campaign_sync", { triggeredBy: "startup", scheduledAt: new Date().toISOString() });
  }, 60_000);

  console.log("[META-SYNC] Scheduler started — next sync in ~60 seconds, then every 45 minutes");
}

export function stopMetaCampaignSyncScheduler(): void {
  if (syncIntervalHandle) {
    clearInterval(syncIntervalHandle);
    syncIntervalHandle = null;
    console.log("[META-SYNC] Scheduler stopped");
  }
}
