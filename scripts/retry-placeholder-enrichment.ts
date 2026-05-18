/**
 * retry-placeholder-enrichment.ts
 *
 * Separate enrichment retry path for archived placeholder contacts produced by
 * the account-consolidation recovery. Retries identity enrichment ONLY on those
 * archived shells and un-archives any that resolve to a verified identity.
 *
 * Run this AFTER scripts/consolidate-accounts.ts --execute.
 *
 * Usage (from repo root):
 *   # dry run — counts only, no writes
 *   npx tsx scripts/retry-placeholder-enrichment.ts
 *
 *   # execute (one batch of 500)
 *   DATABASE_URL=postgres://... npx tsx scripts/retry-placeholder-enrichment.ts --execute
 *
 *   # execute a larger batch
 *   npx tsx scripts/retry-placeholder-enrichment.ts --execute --limit 1000
 */

import { runPlaceholderEnrichmentRetry } from "../server/services/placeholderEnrichmentRetry";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) || 500 : 500;

  const stats = await runPlaceholderEnrichmentRetry({ limit, dryRun: !execute });

  const line = "─".repeat(56);
  console.log(`\n${line}`);
  console.log(`PLACEHOLDER ENRICHMENT RETRY — ${stats.dryRun ? "DRY RUN" : "EXECUTED"}`);
  console.log(line);
  console.log(`Archived placeholders (before): ${stats.archivedPlaceholdersBefore}`);
  console.log(`Enrichment attempted:           ${stats.enrichmentAttempted}`);
  console.log(`Identities recovered:           ${stats.identitiesRecovered}`);
  console.log(`Un-archived (now real leads):   ${stats.unarchived}`);
  console.log(`Still archived:                 ${stats.stillArchived}`);
  console.log(line);
  if (stats.dryRun) console.log(`Dry run — nothing written. Add --execute to run.\n`);
  else console.log(`Done. Re-run to process the next batch.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[retry-placeholder-enrichment] FAILED:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
