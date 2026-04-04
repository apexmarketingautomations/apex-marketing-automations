import type { PlatformAdapter, PublishInput, PublishResult } from "./types";
import crypto from "crypto";

export const instagramAdapter: PlatformAdapter = {
  platform: "instagram",

  validate(input: PublishInput) {
    if (!input.body && (!input.mediaIds || input.mediaIds.length === 0)) {
      return { valid: false, error: "Instagram requires a caption or at least one media item" };
    }
    if (input.body && input.body.length > 2200) {
      return { valid: false, error: "Instagram caption must be 2200 characters or fewer" };
    }
    return { valid: true };
  },

  async publish(input: PublishInput): Promise<PublishResult> {
    console.log(`[CP-INSTAGRAM] Mock publish for post ${input.postId} (subAccount ${input.subAccountId})`);
    await new Promise(r => setTimeout(r, 200));
    return {
      success: true,
      platform: "instagram",
      externalPostId: `ig_mock_${crypto.randomBytes(8).toString("hex")}`,
      errorMessage: null,
    };
  },
};
