import { storage } from "../storage";
import { emitUniversalEvent, EVENT_TYPES } from "../intelligence/eventEmitter";

export interface StagedIntegration {
  accountId: number;
  provider: string;
  integrationType: "oauth" | "api_key" | "webhook";
  status: "staged" | "pending_auth" | "auth_completed" | "failed";
  scopes: string[];
  config: Record<string, unknown>;
  humanActionRequired: string;
  humanActionUrl: string;
  entityMappings: Record<string, unknown>;
}

interface ProviderStagingConfig {
  provider: string;
  integrationType: "oauth" | "api_key" | "webhook";
  scopes: string[];
  defaultConfig: Record<string, unknown>;
  humanAction: string;
  humanActionPath: string;
  entityMappings: (accountId: number) => Promise<Record<string, unknown>>;
}

const PROVIDER_CONFIGS: ProviderStagingConfig[] = [
  {
    provider: "google",
    integrationType: "oauth",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/business.manage",
    ],
    defaultConfig: { modules: ["gmail", "calendar", "business_profile"] },
    humanAction: "Click 'Connect Google' and authorize access",
    humanActionPath: "/integrations",
    entityMappings: async (accountId) => {
      const account = await storage.getSubAccount(accountId);
      return {
        businessName: account?.name || "",
        calendarSync: true,
        gmailSync: true,
      };
    },
  },
  {
    provider: "meta",
    integrationType: "oauth",
    scopes: [
      "pages_manage_metadata",
      "pages_read_engagement",
      "pages_messaging",
      "instagram_basic",
      "instagram_manage_messages",
      "ads_read",
      "leads_retrieval",
    ],
    defaultConfig: { modules: ["pages", "instagram", "ads", "leads"] },
    humanAction: "Click 'Connect Meta' and authorize your Facebook Page",
    humanActionPath: "/integrations",
    entityMappings: async (accountId) => {
      const account = await storage.getSubAccount(accountId);
      return {
        businessName: account?.name || "",
        pageId: account?.metaPageId || null,
        instagramMapping: null,
        adAccountMapping: null,
      };
    },
  },
  {
    provider: "twilio",
    integrationType: "api_key",
    scopes: [],
    defaultConfig: { modules: ["sms", "voice"] },
    humanAction: "Enter your Twilio Account SID and Auth Token",
    humanActionPath: "/integrations",
    entityMappings: async (accountId) => {
      const account = await storage.getSubAccount(accountId);
      return {
        businessName: account?.name || "",
        twilioSid: account?.twilioSubaccountSid || null,
        smsEnabled: true,
        voiceEnabled: true,
      };
    },
  },
  {
    provider: "stripe",
    integrationType: "api_key",
    scopes: [],
    defaultConfig: { modules: ["payments", "subscriptions", "invoices"] },
    humanAction: "Enter your Stripe Secret Key to enable payments",
    humanActionPath: "/integrations",
    entityMappings: async (accountId) => {
      const account = await storage.getSubAccount(accountId);
      return {
        businessName: account?.name || "",
        paymentProcessing: true,
        subscriptionManagement: true,
      };
    },
  },
  {
    provider: "shopify",
    integrationType: "api_key",
    scopes: [],
    defaultConfig: { modules: ["products", "orders", "customers"] },
    humanAction: "Enter your Shopify store domain and access token",
    humanActionPath: "/integrations",
    entityMappings: async (accountId) => {
      const account = await storage.getSubAccount(accountId);
      return {
        businessName: account?.name || "",
        productSync: true,
        orderSync: true,
        customerSync: true,
      };
    },
  },
  {
    provider: "mailchimp",
    integrationType: "api_key",
    scopes: [],
    defaultConfig: { modules: ["audiences", "campaigns"] },
    humanAction: "Enter your Mailchimp API key to sync audiences",
    humanActionPath: "/integrations",
    entityMappings: async (accountId) => {
      const account = await storage.getSubAccount(accountId);
      return {
        businessName: account?.name || "",
        audienceSync: true,
        campaignSync: true,
      };
    },
  },
  {
    provider: "youtube",
    integrationType: "oauth",
    scopes: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
    defaultConfig: { modules: ["channel", "videos", "analytics"] },
    humanAction: "Click 'Connect YouTube' and authorize channel access",
    humanActionPath: "/integrations",
    entityMappings: async (accountId) => {
      const account = await storage.getSubAccount(accountId);
      return {
        businessName: account?.name || "",
        channelSync: true,
        analyticsSync: true,
      };
    },
  },
  {
    provider: "linkedin",
    integrationType: "oauth",
    scopes: ["openid", "profile", "email", "w_member_social"],
    defaultConfig: { modules: ["profile", "posts"] },
    humanAction: "Click 'Connect LinkedIn' and authorize posting access",
    humanActionPath: "/integrations",
    entityMappings: async (accountId) => {
      const account = await storage.getSubAccount(accountId);
      return {
        businessName: account?.name || "",
        postingEnabled: true,
      };
    },
  },
  {
    provider: "tiktok",
    integrationType: "oauth",
    scopes: [],
    defaultConfig: { modules: ["business", "ads"] },
    humanAction: "Click 'Connect TikTok' and authorize business access",
    humanActionPath: "/integrations",
    entityMappings: async (accountId) => {
      const account = await storage.getSubAccount(accountId);
      return {
        businessName: account?.name || "",
        adAccountMapping: null,
      };
    },
  },
];

export async function stageIntegration(
  accountId: number,
  provider: string,
): Promise<StagedIntegration | null> {
  const config = PROVIDER_CONFIGS.find(c => c.provider === provider);
  if (!config) {
    console.warn(`[AUTONOMY-STAGING] No staging config for provider: ${provider}`);
    return null;
  }

  try {
    const existingConnection = await storage.getIntegrationConnection(accountId, provider);
    if (existingConnection?.status === "connected" || existingConnection?.status === "pending") {
      return null;
    }

    const entityMappings = await config.entityMappings(accountId);

    await storage.upsertIntegrationConnection({
      subAccountId: accountId,
      provider: config.provider,
      status: "pending",
      config: {
        ...config.defaultConfig,
        staged: true,
        stagedAt: new Date().toISOString(),
        scopes: config.scopes,
        entityMappings,
      },
      connectionType: config.integrationType,
    });

    await storage.createIntegrationEvent({
      subAccountId: accountId,
      provider: config.provider,
      eventType: "staged",
      payload: {
        integrationType: config.integrationType,
        scopes: config.scopes,
        entityMappings,
        humanAction: config.humanAction,
      },
    });

    emitUniversalEvent({
      eventType: "integration_staged",
      sourceModule: "autonomy_preauth",
      subAccountId: accountId,
      metadata: {
        provider: config.provider,
        integrationType: config.integrationType,
        status: "pending_auth",
      },
    });

    const staged: StagedIntegration = {
      accountId,
      provider: config.provider,
      integrationType: config.integrationType,
      status: "pending_auth",
      scopes: config.scopes,
      config: config.defaultConfig,
      humanActionRequired: config.humanAction,
      humanActionUrl: config.humanActionPath,
      entityMappings,
    };

    console.log(`[AUTONOMY-STAGING] Staged ${provider} for account ${accountId} — awaiting human auth`);
    return staged;
  } catch (err) {
    console.error(`[AUTONOMY-STAGING] Failed to stage ${provider} for account ${accountId}:`, (err as Error).message);
    return null;
  }
}

export async function stageMultipleIntegrations(
  accountId: number,
  providers: string[],
): Promise<StagedIntegration[]> {
  const results: StagedIntegration[] = [];
  for (const provider of providers) {
    const staged = await stageIntegration(accountId, provider);
    if (staged) results.push(staged);
  }
  return results;
}

export function getSupportedProviders(): string[] {
  return PROVIDER_CONFIGS.map(c => c.provider);
}

export function getProviderConfig(provider: string): ProviderStagingConfig | undefined {
  return PROVIDER_CONFIGS.find(c => c.provider === provider);
}
