import type { PlatformAdapter, PublishInput, PublishResult } from "./types";
import crypto from "crypto";

export const tiktokAdapter: PlatformAdapter = {
  platform: "tiktok",

  validate(input: PublishInput) {
    if (!input.mediaIds || input.mediaIds.length === 0) {
      return { valid: false, error: "TikTok requires at least one media item (video)" };
    }
    if (input.body && input.body.length > 2200) {
      return { valid: false, error: "TikTok caption must be 2200 characters or fewer" };
    }
    return { valid: true };
  },

  async publish(input: PublishInput): Promise<PublishResult> {
    console.log(`[CP-TIKTOK] Mock publish for post ${input.postId} (subAccount ${input.subAccountId})`);
    await new Promise(r => setTimeout(r, 250));
    return {
      success: true,
      platform: "tiktok",
      externalPostId: `tt_mock_${crypto.randomBytes(8).toString("hex")}`,
      errorMessage: null,
    };
  },
};
