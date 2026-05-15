/**
 * server/jobQueue.ts
 * -------------------
 * Phase 4A: Re-exported from the durable BullMQ adapter.
 *
 * All existing callers (routes/analytics.ts, operator/diagnostics.ts,
 * metaCampaignSync.ts, etc.) continue to work with zero changes.
 *
 * When UPSTASH_REDIS_URL is set: jobs persist to Upstash via BullMQ.
 * When UPSTASH_REDIS_URL is missing: falls back to in-memory (legacy behaviour).
 *
 * DO NOT add logic here. See server/queues/legacyAdapter.ts.
 */

export type { Job } from "./queues/legacyAdapter";
export { jobQueue } from "./queues/legacyAdapter";
