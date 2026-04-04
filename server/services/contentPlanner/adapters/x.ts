import type { PlatformAdapter, PublishInput, PublishResult } from "./types";
import crypto from "crypto";

export const xAdapter: PlatformAdapter = {
  platform: "x",

  validate(input: PublishInput) {
    if (!input.body) {
      return { valid: false, error: "X (Twitter) requires text content" };
    }
    if (input.body.length > 280) {
      return { valid: false, error: "X (Twitter) post must be 280 characters or fewer" };
    }
    return { valid: true };
  },

  async publish(input: PublishInput): Promise<PublishResult> {
    console.log(`[CP-X] Mock publish for post ${input.postId} (subAccount ${input.subAccountId})`);
    await new Promise(r => setTimeout(r, 150));
    return {
      success: true,
      platform: "x",
      externalPostId: `x_mock_${crypto.randomBytes(8).toString("hex")}`,
      errorMessage: null,
    };
  },
};
