let warned = false;

/**
 * Reserved for future Google Stitch integrations.
 *
 * Never commit or log the full value. This helper logs only presence/absence once.
 */
export function getStitchApiKey(): string | undefined {
  const key = process.env.STITCH_API_KEY;
  if (!key) {
    if (!warned) {
      warned = true;
      console.warn("[STITCH] STITCH_API_KEY not set; Stitch integrations are disabled.");
    }
    return undefined;
  }
  return key;
}

