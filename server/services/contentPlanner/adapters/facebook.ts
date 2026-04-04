import type { PlatformAdapter, PublishInput, PublishResult } from "./types";
import crypto from "crypto";

export const facebookAdapter: PlatformAdapter = {
  platform: "facebook",

  validate(input: PublishInput) {
    if (!input.body && (!input.mediaIds || input.mediaIds.length === 0)) {
      return { valid: false, error: "Facebook requires text content or at least one media item" };
    }
    if (input.body && input.body.length > 63206) {
      return { valid: false, error: "Facebook post must be 63206 characters or fewer" };
    }
    return { valid: true };
  },

  async publish(input: PublishInput): Promise<PublishResult> {
    console.log(`[CP-FACEBOOK] Mock publish for post ${input.postId} (subAccount ${input.subAccountId})`);
    await new Promise(r => setTimeout(r, 200));
    return {
      success: true,
      platform: "facebook",
      externalPostId: `fb_mock_${crypto.randomBytes(8).toString("hex")}`,
      errorMessage: null,
    };
  },
};
