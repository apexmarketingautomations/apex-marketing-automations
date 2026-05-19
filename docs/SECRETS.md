# Secrets & API Keys

This repo intentionally avoids committing live credentials. Use environment variables for anything secret.

## Required / Supported Env Vars

- `STITCH_API_KEY` (server-only)
  - Purpose: Reserved for future Google Stitch MCP/API integrations.
  - Where to set: deployment environment (Railway/Render/Fly/etc) or local `.env` that is not committed.
  - Where it must NOT appear: client bundles, markdown docs, or config files committed to git.

## Rotation (If A Key Leaks)

1. Revoke/rotate the key in the provider console (Google Cloud).
2. Update the deployment environment variable (`STITCH_API_KEY`) with the new value.
3. If the key ever landed in git history, rewrite history or invalidate the old key immediately.

## CI Guardrails

CI runs a fast scanner:

- `node scripts/check-secrets.mjs`

It fails the build if it detects patterns that look like:

- A committed `X-Goog-Api-Key` value
- A committed Stitch MCP header config including `X-Goog-Api-Key`
- A committed `postgresql://user:password@host/...` URL

If CI fails, remove the secret from the repo and use environment variables.

