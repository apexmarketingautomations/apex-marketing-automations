import type { PlatformAdapter, PublishInput, PublishResult } from "./types";

const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

export const facebookAdapter: PlatformAdapter = {
  platform: "facebook",

  validate(input: PublishInput) {
    if (!input.body && (!input.mediaIds || input.mediaIds.length === 0)) {
      return { valid: false, error: "Facebook requires text content or at least one media item" };
    }
    if (input.body && input.body.length > 63206) {
      return { valid: false, error: "Facebook post must be 63206 characters or fewer" };
    }
    if (!input.credentials) {
      return { valid: false, error: "Facebook credentials not configured for this account" };
    }
    if (!input.credentials.accessToken) {
      return { valid: false, error: "Facebook access token is missing" };
    }
    if (!input.credentials.pageId) {
      return { valid: false, error: "Facebook Page ID is missing" };
    }
    return { valid: true };
  },

  async publish(input: PublishInput): Promise<PublishResult> {
    const { credentials } = input;
    if (!credentials || !credentials.accessToken || !credentials.pageId) {
      return {
        success: false,
        platform: "facebook",
        externalPostId: null,
        errorMessage: "Missing Facebook credentials (accessToken or pageId)",
      };
    }

    try {
      console.log(`[CP-FACEBOOK] Publishing post ${input.postId} to Page ${credentials.pageId} (subAccount ${input.subAccountId})`);

      const url = `${GRAPH_API_BASE}/${credentials.pageId}/feed`;
      const params: Record<string, string> = {
        access_token: credentials.accessToken,
      };
      if (input.body) params.message = input.body;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      const data = await response.json() as any;

      if (!response.ok || data.error) {
        const errMsg = data.error?.message || `Facebook API error (${response.status})`;
        console.error(`[CP-FACEBOOK] API error for post ${input.postId}:`, errMsg);
        return {
          success: false,
          platform: "facebook",
          externalPostId: null,
          errorMessage: errMsg,
        };
      }

      console.log(`[CP-FACEBOOK] Published post ${input.postId} -> ${data.id}`);
      return {
        success: true,
        platform: "facebook",
        externalPostId: data.id || null,
        errorMessage: null,
      };
    } catch (err: any) {
      console.error(`[CP-FACEBOOK] Network error for post ${input.postId}:`, err.message);
      return {
        success: false,
        platform: "facebook",
        externalPostId: null,
        errorMessage: `Facebook publish failed: ${err.message}`,
      };
    }
  },
};
