/**
 * consolidate-accounts.ts
 *
 * Operator entrypoint for the account-consolidation recovery.
 *
 * Consolidates all lead data (contacts, crash_reports, sentinel_incidents)
 * scattered across sub-accounts into the single primary account, deduplicating
 * real contacts by phone/email and archiving placeholder shells.
 *
 * SAFETY: defaults to a DRY RUN. It prints a full report and writes NOTHING
 * unless you pass --execute. Execution snapshots every affected table first.
 *
 * Usage (from repo root):
 *   # dry run — safe, read-only, prints the plan
 *   npx tsx scripts/consolidate-accounts.ts
 *
 *   # production execution — snapshots, then consolidates
 *   DATABASE_URL=postgres://... npx tsx scripts/consolidate-accounts.ts --execute
 *
 *   # roll back a prior execution from its snapshot
 *   npx tsx scripts/consolidate-accounts.ts --rollback 20260518183000
 */

import {
  planConsolidation,
  executeConsolidation,
  rollbackConsolidation,
  PRIMARY_ACCOUNT_ID,
  ACCOUNTS_TO_FOLD,
  type ConsolidationReport,
} from "../server/services/accountConsolidation";

function printReport(r: ConsolidationReport): void {
  const line = "─".repeat(64);
  console.log(`\n${line}`);
  console.log(`ACCOUNT CONSOLIDATION — ${r.dryRun ? "DRY RUN (no writes)" : "EXECUTED"}`);
  console.log(line);
  console.log(`Primary account:            ${r.primaryAccountId}`);
  console.log(`Accounts folded & deactivated: ${r.accountsDeactivated.join(", ")}`);
  if (r.snapshotTables.length) console.log(`Snapshots:                  ${r.snapshotTables.join(", ")}`);
  console.log(`\ncrash_reports:              ${r.crashReports.repointed} of ${r.crashReports.total} re-pointed → account ${r.primaryAccountId}`);
  console.log(`sentinel_incidents:         ${r.sentinelIncidents.repointed} of ${r.sentinelIncidents.total} re-pointed → account ${r.primaryAccountId}`);
  console.log(`\ncontacts (${r.contacts.total} across all accounts):`);
  console.log(`  placeholder shells archived: ${r.contacts.placeholdersArchived}`);
  console.log(`  real contacts (before):      ${r.contacts.realContactsBefore}`);
  console.log(`  dedup groups (2+ rows):      ${r.contacts.dedupGroups}`);
  console.log(`  duplicate rows archived:     ${r.contacts.duplicatesArchived}`);
  console.log(`  real w/o phone or email:     ${r.contacts.noContactMethodKept}`);
  console.log(`  → unique real survivors:     ${r.contacts.survivorsAfter}`);
  if (r.sampleMerges.length) {
    console.log(`\nSample merges (first ${r.sampleMerges.length}):`);
    for (const m of r.sampleMerges) {
      console.log(`  ${m.key.padEnd(22)} winner #${m.winnerId} "${m.winnerName}" ← merges [${m.mergedIds.join(", ")}] from accounts [${m.fromAccounts.join(", ")}]`);
    }
  }
  if (r.warnings.length) {
    console.log(`\n⚠️  Warnings:`);
    for (const w of r.warnings) console.log(`  - ${w}`);
  }
  console.log(line);
  if (r.dryRun) {
    console.log(`This was a DRY RUN. Nothing was written.`);
    console.log(`To execute: npx tsx scripts/consolidate-accounts.ts --execute`);
  } else {
    console.log(`Consolidation complete. To reverse: --rollback <snapshot-suffix>`);
  }
  console.log(`${line}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const rollbackIdx = args.indexOf("--rollback");

  if (rollbackIdx !== -1) {
    const suffix = args[rollbackIdx + 1];
    if (!suffix || !/^\d{14}$/.test(suffix)) {
      console.error("--rollback requires a 14-digit snapshot suffix, e.g. --rollback 20260518183000");
      process.exit(1);
    }
    console.log(`Rolling back consolidation from snapshot suffix ${suffix}...`);
    await rollbackConsolidation(suffix);
    console.log("Rollback complete.");
    process.exit(0);
  }

  console.log(`Target: fold accounts [${ACCOUNTS_TO_FOLD.join(", ")}] into account ${PRIMARY_ACCOUNT_ID}`);

  if (execute) {
    console.log("EXECUTE mode — taking snapshots, then consolidating...\n");
    const report = await executeConsolidation();
    printReport(report);
  } else {
    const report = await planConsolidation();
    printReport(report);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[consolidate-accounts] FAILED:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
