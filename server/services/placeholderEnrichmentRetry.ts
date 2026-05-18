/**
 * server/services/placeholderEnrichmentRetry.ts
 *
 * A SEPARATE enrichment retry path scoped to archived placeholder contacts.
 *
 * After account consolidation, ~14k placeholder shells (un-enriched crash
 * incidents) are archived (view_class='archived', is_placeholder=true). They
 * are not real leads yet — the crash enrichment never recovered an identity.
 *
 * This path retries enrichment ONLY on those archived placeholders and
 * un-archives any that successfully resolve to a verified identity. It is
 * deliberately separate from the main enrichment flow so it cannot interfere
 * with live ingestion, and it is explicitly triggered — never auto-run.
 *
 * Triggered via scripts/retry-placeholder-enrichment.ts.
 */

import { db } from "../db";
import { contacts } from "@shared/schema";
import { sql, and, eq } from "drizzle-orm";
import { runRetroFLHSMVEnrich } from "../retroFLHSMVEnrich";
import { PRIMARY_ACCOUNT_ID } from "./accountConsolidation";

export interface PlaceholderRetryStats {
  dryRun: boolean;
  archivedPlaceholdersBefore: number;
  enrichmentAttempted: number;
  identitiesRecovered: number;   // placeholders that became verified
  unarchived: number;            // recovered placeholders graduated out of archive
  stillArchived: number;
}

/** Counts archived placeholder contacts in the primary account. */
export async function countArchivedPlaceholders(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(
      eq(contacts.subAccountId, PRIMARY_ACCOUNT_ID),
      eq(contacts.viewClass, "archived"),
      eq(contacts.isPlaceholder, true),
    ));
  return row?.n ?? 0;
}

/**
 * Retries enrichment on archived placeholder shells.
 *
 * 1. Runs the retro FLHSMV enrichment engine (idempotent — recovers victim
 *    identity from official crash reports onto the linked contacts).
 * 2. Un-archives any placeholder that is now identity_status='verified':
 *    view_class → 'enriched_contact', is_placeholder → false.
 *
 * @param options.limit  max crash reports to process per run (default 500)
 * @param options.dryRun when true, reports counts and performs no writes
 */
export async function runPlaceholderEnrichmentRetry(
  options: { limit?: number; dryRun?: boolean } = {},
): Promise<PlaceholderRetryStats> {
  const { limit = 500, dryRun = false } = options;

  const before = await countArchivedPlaceholders();
  console.log(`[PLACEHOLDER-RETRY] ${before} archived placeholders in account ${PRIMARY_ACCOUNT_ID}`);

  if (dryRun) {
    return {
      dryRun: true,
      archivedPlaceholdersBefore: before,
      enrichmentAttempted: Math.min(before, limit),
      identitiesRecovered: 0,
      unarchived: 0,
      stillArchived: before,
    };
  }

  // 1. Run the existing FLHSMV enrichment engine (idempotent, tag-guarded).
  const enrich = await runRetroFLHSMVEnrich({ limit });

  // 2. Graduate any placeholder that now has a verified identity out of the
  //    archive. A verified, real contact is no longer a placeholder shell.
  const recovered = await db
    .update(contacts)
    .set({ viewClass: "enriched_contact", isPlaceholder: false })
    .where(and(
      eq(contacts.subAccountId, PRIMARY_ACCOUNT_ID),
      eq(contacts.viewClass, "archived"),
      eq(contacts.isPlaceholder, true),
      eq(contacts.identityStatus, "verified"),
    ))
    .returning({ id: contacts.id });

  const after = await countArchivedPlaceholders();

  console.log(`[PLACEHOLDER-RETRY] enrichment processed ${enrich.total} reports; ${recovered.length} placeholders recovered & un-archived`);

  return {
    dryRun: false,
    archivedPlaceholdersBefore: before,
    enrichmentAttempted: enrich.total,
    identitiesRecovered: recovered.length,
    unarchived: recovered.length,
    stillArchived: after,
  };
}
