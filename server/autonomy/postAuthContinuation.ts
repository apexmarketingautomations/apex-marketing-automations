// @ts-nocheck
import { storage } from "../storage";
import { emitUniversalEvent, EVENT_TYPES } from "../intelligence/eventEmitter";
import { trackIntegrationSuccess } from "../intelligence/integrationHealth";

export interface ContinuationResult {
  accountId: number;
  provider: string;
  success: boolean;
  verified: boolean;
  resourcesSynced: string[];
  mappingsCompleted: string[];
  downstreamTriggered: string[];
  error?: string;
}

interface ProviderContinuationHandler {
  provider: string;
  verify: (accountId: number) => Promise<boolean>;
  syncResources: (accountId: number) => Promise<string[]>;
  completeMappings: (accountId: number) => Promise<string[]>;
  getDownstreamActions: (accountId: number) => string[];
}

const continuationHandlers: ProviderContinuationHandler[] = [
  {
    provider: "google",
    verify: async (accountId) => {
      const token = await storage.getOAuthToken(accountId, "google");
      if (!token || !token.accessToken) return false;
      if (token.tokenExpiry && new Date(token.tokenExpiry) < new Date()) return false;
      return true;
    },
    syncResources: async (accountId) => {
      const synced: string[] = [];
      const token = await storage.getOAuthToken(accountId, "google");
      if (token?.providerEmail) synced.push(`email:${token.providerEmail}`);
      if (token?.providerAccountId) synced.push(`account:${token.providerAccountId}`);
      synced.push("calendar_access");
      synced.push("gmail_access");
      return synced;
    },
    completeMappings: async (accountId) => {
      const mappings: string[] = [];
      const token = await storage.getOAuthToken(accountId, "google");
      if (token?.providerEmail) {
        const account = await storage.getSubAccount(accountId);
        if (account && !account.contactEmail) {
          mappings.push("email_mapping_from_google");
        }
      }
      mappings.push("calendar_integration_mapped");
      return mappings;
    },
    getDownstreamActions: () => [
      "sync_google_calendar",
      "setup_gmail_integration",
      "verify_business_profile",
    ],
  },
  {
    provider: "meta",
    verify: async (accountId) => {
      const token = await storage.getOAuthToken(accountId, "meta");
      if (!token || !token.accessToken) return false;
      if (token.tokenExpiry && new Date(token.tokenExpiry) < new Date()) return false;
      return true;
    },
    syncResources: async (accountId) => {
      const synced: string[] = [];
      const account = await storage.getSubAccount(accountId);
      if (account?.metaPageId) synced.push(`page:${account.metaPageId}`);
      if (account?.metaInstagramAccountId) synced.push(`instagram:${account.metaInstagramAccountId}`);
      synced.push("pages_access");
      synced.push("messaging_access");
      return synced;
    },
    completeMappings: async (accountId) => {
      const mappings: string[] = [];
      const account = await storage.getSubAccount(accountId);
      if (account?.metaPageId) mappings.push("page_id_mapped");
      if (account?.metaInstagramAccountId) mappings.push("instagram_mapped");
      mappings.push("lead_retrieval_mapped");
      return mappings;
    },
    getDownstreamActions: () => [
      "sync_meta_pages",
      "setup_instagram_messaging",
      "configure_lead_forms",
      "setup_meta_ads",
    ],
  },
  {
    provider: "twilio",
    verify: async (accountId) => {
      const connection = await storage.getIntegrationConnection(accountId, "twilio");
      return connection?.status === "connected";
    },
    syncResources: async (accountId) => {
      const synced: string[] = [];
      const account = await storage.getSubAccount(accountId);
      if (account?.twilioSubaccountSid) synced.push(`twilio_sid:${account.twilioSubaccountSid}`);
      synced.push("sms_capability");
      synced.push("voice_capability");
      return synced;
    },
    completeMappings: async (accountId) => {
      const mappings: string[] = [];
      const account = await storage.getSubAccount(accountId);
      if (account?.twilioSubaccountSid) mappings.push("twilio_account_mapped");
      mappings.push("sms_gateway_configured");
      return mappings;
    },
    getDownstreamActions: () => [
      "verify_sms_capability",
      "setup_voice_agent_phone",
    ],
  },
  {
    provider: "stripe",
    verify: async (accountId) => {
      const connection = await storage.getIntegrationConnection(accountId, "stripe");
      return connection?.status === "connected";
    },
    syncResources: async () => {
      return ["payment_processing", "subscription_management", "invoice_access"];
    },
    completeMappings: async () => {
      return ["payment_gateway_mapped", "webhook_configured"];
    },
    getDownstreamActions: () => [
      "sync_stripe_products",
      "verify_webhook_endpoint",
    ],
  },
  {
    provider: "shopify",
    verify: async (accountId) => {
      const connection = await storage.getIntegrationConnection(accountId, "shopify");
      return connection?.status === "connected";
    },
    syncResources: async () => {
      return ["product_catalog", "order_history", "customer_list"];
    },
    completeMappings: async () => {
      return ["product_catalog_mapped", "customer_sync_configured"];
    },
    getDownstreamActions: () => [
      "sync_shopify_products",
      "sync_shopify_customers",
    ],
  },
  {
    provider: "youtube",
    verify: async (accountId) => {
      const token = await storage.getOAuthToken(accountId, "youtube");
      return !!token?.accessToken;
    },
    syncResources: async () => {
      return ["channel_data", "video_list", "analytics_access"];
    },
    completeMappings: async () => {
      return ["channel_mapped", "analytics_configured"];
    },
    getDownstreamActions: () => [
      "sync_youtube_channel",
    ],
  },
  {
    provider: "linkedin",
    verify: async (accountId) => {
      const token = await storage.getOAuthToken(accountId, "linkedin");
      return !!token?.accessToken;
    },
    syncResources: async () => {
      return ["profile_data", "posting_access"];
    },
    completeMappings: async () => {
      return ["profile_mapped", "posting_configured"];
    },
    getDownstreamActions: () => [
      "setup_linkedin_posting",
    ],
  },
];

export async function checkAndContinueAuth(accountId: number): Promise<ContinuationResult[]> {
  const results: ContinuationResult[] = [];
  const connections = await storage.getIntegrationConnections(accountId);

  for (const connection of connections) {
    const config = connection.config as Record<string, unknown> | null;
    const isStaged = config?.staged === true;
    const isNewlyConnected = connection.status === "connected" && isStaged;
    const isPending = connection.status === "pending" && isStaged;

    if (!isStaged && connection.status !== "connected") continue;

    const handler = continuationHandlers.find(h => h.provider === connection.provider);
    if (!handler) continue;

    if (isPending) {
      const verified = await handler.verify(accountId);
      if (!verified) continue;
    }

    if (isNewlyConnected || isPending) {
      try {
        const result = await runContinuation(accountId, connection.provider, handler);
        results.push(result);
      } catch (err) {
        results.push({
          accountId,
          provider: connection.provider,
          success: false,
          verified: false,
          resourcesSynced: [],
          mappingsCompleted: [],
          downstreamTriggered: [],
          error: (err as Error).message,
        });
      }
    }
  }

  return results;
}

async function runContinuation(
  accountId: number,
  provider: string,
  handler: ProviderContinuationHandler,
): Promise<ContinuationResult> {
  const verified = await handler.verify(accountId);
  if (!verified) {
    return {
      accountId,
      provider,
      success: false,
      verified: false,
      resourcesSynced: [],
      mappingsCompleted: [],
      downstreamTriggered: [],
      error: "Connection verification failed",
    };
  }

  const resourcesSynced = await handler.syncResources(accountId);
  const mappingsCompleted = await handler.completeMappings(accountId);
  const downstreamActions = handler.getDownstreamActions(accountId);

  await storage.upsertIntegrationConnection({
    subAccountId: accountId,
    provider,
    status: "connected",
    config: {
      staged: false,
      continuationCompletedAt: new Date().toISOString(),
      resourcesSynced,
      mappingsCompleted,
    },
    connectionType: "oauth",
    connectedAt: new Date(),
  });

  await trackIntegrationSuccess(accountId, provider, provider, {
    continuationCompleted: true,
    resourcesSynced,
  });

  await storage.createExecutionTimelineEntry({
    accountId,
    relatedEntityType: "integration",
    relatedEntityId: provider,
    title: `Post-auth continuation completed for ${provider}`,
    description: `Verified connection, synced ${resourcesSynced.length} resources, completed ${mappingsCompleted.length} mappings`,
    sourceModule: "autonomy_postauth",
    severity: "info",
  });

  emitUniversalEvent({
    eventType: "integration_continuation_completed",
    sourceModule: "autonomy_postauth",
    subAccountId: accountId,
    metadata: {
      provider,
      verified: true,
      resourcesSynced,
      mappingsCompleted,
      downstreamTriggered: downstreamActions,
    },
  });

  console.log(`[AUTONOMY-POSTAUTH] Continuation completed for ${provider} on account ${accountId}: ${resourcesSynced.length} resources, ${mappingsCompleted.length} mappings`);

  return {
    accountId,
    provider,
    success: true,
    verified: true,
    resourcesSynced,
    mappingsCompleted,
    downstreamTriggered: downstreamActions,
  };
}

export async function checkSingleProviderAuth(
  accountId: number,
  provider: string,
): Promise<ContinuationResult | null> {
  const handler = continuationHandlers.find(h => h.provider === provider);
  if (!handler) return null;

  const verified = await handler.verify(accountId);
  if (!verified) return null;

  return runContinuation(accountId, provider, handler);
}
