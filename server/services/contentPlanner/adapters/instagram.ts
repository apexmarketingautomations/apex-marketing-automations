import type { PlatformAdapter, PublishInput, PublishResult } from "./types";

const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

export const instagramAdapter: PlatformAdapter = {
  platform: "instagram",

  validate(input: PublishInput) {
    if (!input.body && (!input.mediaIds || input.mediaIds.length === 0)) {
      return { valid: false, error: "Instagram requires a caption or at least one media item" };
    }
    if (input.body && input.body.length > 2200) {
      return { valid: false, error: "Instagram caption must be 2200 characters or fewer" };
    }
    if (!input.credentials) {
      return { valid: false, error: "Instagram credentials not configured for this account" };
    }
    if (!input.credentials.accessToken) {
      return { valid: false, error: "Instagram access token is missing" };
    }
    if (!input.credentials.igUserId) {
      return { valid: false, error: "Instagram Business Account ID is missing. Link an Instagram Business account to your Facebook Page first." };
    }
    return { valid: true };
  },

  async publish(input: PublishInput): Promise<PublishResult> {
    const { credentials } = input;
    if (!credentials || !credentials.accessToken || !credentials.igUserId) {
      return {
        success: false,
        platform: "instagram",
        externalPostId: null,
        errorMessage: "Missing Instagram credentials (accessToken or igUserId)",
      };
    }

    try {
      console.log(`[CP-INSTAGRAM] Publishing post ${input.postId} to IG account ${credentials.igUserId} (subAccount ${input.subAccountId})`);

      const hasMedia = input.mediaIds && input.mediaIds.length > 0;

      if (!hasMedia && input.body) {
        return {
          success: false,
          platform: "instagram",
          externalPostId: null,
          errorMessage: "Instagram requires at least one image or video to publish. Text-only posts are not supported by the Instagram API.",
        };
      }

      const containerUrl = `${GRAPH_API_BASE}/${credentials.igUserId}/media`;
      const containerParams: Record<string, string> = {
        access_token: credentials.accessToken,
      };
      if (input.body) containerParams.caption = input.body;

      const containerResponse = await fetch(containerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(containerParams),
      });

      const containerData = await containerResponse.json() as any;

      if (!containerResponse.ok || containerData.error) {
        const errMsg = containerData.error?.message || `Instagram container creation failed (${containerResponse.status})`;
        console.error(`[CP-INSTAGRAM] Container error for post ${input.postId}:`, errMsg);
        return {
          success: false,
          platform: "instagram",
          externalPostId: null,
          errorMessage: errMsg,
        };
      }

      const creationId = containerData.id;
      if (!creationId) {
        return {
          success: false,
          platform: "instagram",
          externalPostId: null,
          errorMessage: "Instagram container was created but returned no ID",
        };
      }

      const publishUrl = `${GRAPH_API_BASE}/${credentials.igUserId}/media_publish`;
      const publishResponse = await fetch(publishUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: credentials.accessToken,
        }),
      });

      const publishData = await publishResponse.json() as any;

      if (!publishResponse.ok || publishData.error) {
        const errMsg = publishData.error?.message || `Instagram publish failed (${publishResponse.status})`;
        console.error(`[CP-INSTAGRAM] Publish error for post ${input.postId}:`, errMsg);
        return {
          success: false,
          platform: "instagram",
          externalPostId: null,
          errorMessage: errMsg,
        };
      }

      console.log(`[CP-INSTAGRAM] Published post ${input.postId} -> ${publishData.id}`);
      return {
        success: true,
        platform: "instagram",
        externalPostId: publishData.id || null,
        errorMessage: null,
      };
    } catch (err: any) {
      console.error(`[CP-INSTAGRAM] Network error for post ${input.postId}:`, err.message);
      return {
        success: false,
        platform: "instagram",
        externalPostId: null,
        errorMessage: `Instagram publish failed: ${err.message}`,
      };
    }
  },
};
