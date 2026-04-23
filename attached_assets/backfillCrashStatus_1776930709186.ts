/**
 * backfillCrashStatus.ts — STEP 1 of 2
 *
 * Corrects sentinel_auto rows that were falsely marked COMPLETED before the
 * ingest pipeline fix landed. A row is a false positive when it has:
 *   - status       = COMPLETED
 *   - source       = sentinel_auto
 *   - no officialFlhsmv key in data JSONB  (FLHSMV linkback never happened)
 *   - no detail key in data JSONB          (no FLHSMV merge / manual submit)
 *
 * Safe to re-run: already-corrected rows are excluded by the same predicate.
 *
 * Usage (from repo root):
 *   npx tsx scripts/backfillCrashStatus.ts
 *
 * Then run: npx tsx scripts/requeueFlhsmvFollowUps.ts
 */

import { db } from "./server/db";
import { crashReports } from "./shared/schema";
import { and, eq, sql } from "drizzle-orm";

const FALSE_POSITIVE_PREDICATE = and(
  eq(crashReports.status, "COMPLETED"),
  eq(crashReports.source, "sentinel_auto"),
  sql`(${crashReports.data} -> 'officialFlhsmv') IS NULL`,
  sql`(${crashReports.data} -> 'detail')         IS NULL`,
);

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  STEP 1/2 — Crash Status Backfill");
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ── Dry-run: identify affected rows before touching anything ─────────────
  const candidates = await db
    .select({
      id:           crashReports.id,
      reportNumber: crashReports.reportNumber,
      subAccountId: crashReports.subAccountId,
      createdAt:    crashReports.createdAt,
    })
    .from(crashReports)
    .where(FALSE_POSITIVE_PREDICATE)
    .orderBy(crashReports.createdAt);

  console.log(`Found ${candidates.length} false-positive row(s) to correct.`);

  if (candidates.length === 0) {
    console.log("\n✓ No false positives found — database is already clean.");
    console.log("\nProceed to STEP 2: npx tsx scripts/requeueFlhsmvFollowUps.ts\n");
    return;
  }

  // Log sample so you can spot-check against the UI before committing
  console.log("\nSample rows (oldest first):");
  candidates.slice(0, 15).forEach(r =>
    console.log(`  id=${r.id}  reportNumber=${r.reportNumber}  subAccount=${r.subAccountId}  created=${r.createdAt?.toISOString() ?? "?"}`)
  );
  if (candidates.length > 15) {
    console.log(`  … and ${candidates.length - 15} more`);
  }

  // ── Perform the update ───────────────────────────────────────────────────
  console.log(`\nUpdating ${candidates.length} row(s): COMPLETED → AWAITING …`);
  const updated = await db
    .update(crashReports)
    .set({ status: "AWAITING", updatedAt: new Date() })
    .where(FALSE_POSITIVE_PREDICATE)
    .returning({ id: crashReports.id });

  console.log(`✓ Updated ${updated.length} row(s).`);

  if (updated.length !== candidates.length) {
    console.warn(
      `⚠ Count mismatch: expected ${candidates.length}, updated ${updated.length}. ` +
      `A concurrent write may have modified some rows between the select and update.`
    );
  }

  // ── Verification: confirm zero false positives remain ────────────────────
  const [{ count: remaining }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(crashReports)
    .where(FALSE_POSITIVE_PREDICATE);

  const leftover = Number(remaining ?? 0);
  if (leftover > 0) {
    console.error(`\n✗ VERIFICATION FAILED — ${leftover} false positive(s) still present.`);
    console.error("  Check for concurrent worker activity or rerun this script.");
    process.exit(1);
  }

  console.log("✓ Verification passed — zero false positives remain.");
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Dashboard Completed tile will now drop by ~${updated.length} row(s).`);
  console.log("  Those rows show as AWAITING until real FLHSMV data is fetched.");
  console.log("\n→ Next: npx tsx scripts/requeueFlhsmvFollowUps.ts");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n[BACKFILL] Fatal error:", err);
    process.exit(1);
  });
