/**
 * recoverDuplicateFhpFollowUps.ts — one-shot recovery for Task #176
 *
 * Background: when requeueFlhsmvFollowUps.ts ran on 2026-04-25, 27 sentinel_auto
 * rows could not have a follow-up job created because their canonical follow-up
 * report number (`FLHSMV-FOLLOWUP-<FHP_INCIDENT_ID>`) already existed — the
 * unique constraint on `crash_reports.report_number` rejected the second insert.
 *
 * Investigation showed every collision is because the sentinel ingest pipeline
 * recorded the SAME FHP incident twice as two distinct sentinel_auto rows. The
 * first one ("winner") got the follow-up job created earlier in the same loop
 * pass; the second one ("loser") collided and was left with no follow-up.
 *
 * Recovery action — for each loser:
 *   • Patch the loser sentinel_auto row's `data` JSONB so it explicitly points
 *     at the winner and at the active follow-up job that will fetch FLHSMV
 *     data on the loser's behalf.
 *   • Set the loser's `error_log` to a "DUPLICATE_FHP_INCIDENT" message so the
 *     loser is explicitly closed-out with a reason recorded.
 *   • Patch the winner's follow-up `data.siblingSentinelReportIds[]` so a
 *     future worker enhancement can opportunistically stamp officialFlhsmv
 *     onto every sibling parent (not just `sentinelReportId`).
 *
 * Idempotent: safe to re-run. Skips losers whose data already carries the
 * recovery markers and dedupes follow-up sibling arrays before writing.
 *
 * Usage:
 *   npx tsx scripts/recoverDuplicateFhpFollowUps.ts          # dry-run (default)
 *   npx tsx scripts/recoverDuplicateFhpFollowUps.ts --apply  # actually write
 */

import { db } from "../server/db";
import { crashReports } from "../shared/schema";
import { eq, inArray } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

const LOSER_PARENT_IDS = [
  7561, 7562, 7567, 7612, 7630, 7881, 7895, 7948, 7984, 8070, 8086,
  8144, 8152, 8162, 8265, 8269, 8296, 8329, 8336, 8364, 8383, 8389,
  8463, 8481, 8483, 8529, 8533,
] as const;

function buildFollowUpNumber(incidentId: string): string {
  return `FLHSMV-FOLLOWUP-${incidentId.replace(/[^A-Z0-9]/gi, "-").toUpperCase()}`;
}

interface LoserPlan {
  loserParentId: number;
  loserParentNumber: string;
  loserSubAccountId: number | null;
  fhpIncidentId: string;
  followUpNumber: string;
  followUpRowId: number;
  winnerParentId: number;
  winnerParentNumber: string;
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  TASK #176 — Recover duplicate FHP follow-ups`);
  console.log(`  Mode: ${APPLY ? "APPLY (writing changes)" : "DRY-RUN (no changes — pass --apply to write)"}`);
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ── 1. Load all 27 losers ──────────────────────────────────────────────────
  const losers = await db
    .select()
    .from(crashReports)
    .where(inArray(crashReports.id, [...LOSER_PARENT_IDS]));

  if (losers.length !== LOSER_PARENT_IDS.length) {
    const found = new Set(losers.map(l => l.id));
    const missing = LOSER_PARENT_IDS.filter(id => !found.has(id));
    throw new Error(`Expected ${LOSER_PARENT_IDS.length} loser rows but found ${losers.length}. Missing: ${missing.join(",")}`);
  }

  // ── 2. Map each loser to its expected follow-up number ─────────────────────
  const plans: LoserPlan[] = [];
  const skippedAlreadyRecovered: number[] = [];

  for (const loser of losers) {
    const raw = (loser.rawPayload as Record<string, any>) ?? {};
    const data = (loser.data as Record<string, any>) ?? {};
    const incidentId: string | undefined = raw?.id;
    if (!incidentId) {
      throw new Error(`Loser id=${loser.id} (${loser.reportNumber}) has no rawPayload.id — cannot map to follow-up`);
    }
    if (data.duplicateOfSentinelReportId && data.activeFollowUpReportNumber) {
      skippedAlreadyRecovered.push(loser.id);
      continue;
    }

    const followUpNumber = buildFollowUpNumber(incidentId);
    plans.push({
      loserParentId: loser.id,
      loserParentNumber: loser.reportNumber,
      loserSubAccountId: loser.subAccountId,
      fhpIncidentId: incidentId,
      followUpNumber,
      followUpRowId: -1,
      winnerParentId: -1,
      winnerParentNumber: "",
    });
  }

  if (skippedAlreadyRecovered.length > 0) {
    console.log(`Skipping ${skippedAlreadyRecovered.length} loser(s) already recovered: ${skippedAlreadyRecovered.join(",")}\n`);
  }
  if (plans.length === 0) {
    console.log("✓ Nothing to recover — all 27 losers already carry recovery markers.\n");
    return;
  }

  // ── 3. Resolve each plan to its existing follow-up row + winner parent ─────
  const followUpNumbers = plans.map(p => p.followUpNumber);
  const followUps = await db
    .select()
    .from(crashReports)
    .where(inArray(crashReports.reportNumber, followUpNumbers));

  const followUpByNumber = new Map(followUps.map(f => [f.reportNumber, f]));

  for (const plan of plans) {
    const fu = followUpByNumber.get(plan.followUpNumber);
    if (!fu) {
      throw new Error(`No existing follow-up row found for ${plan.followUpNumber} (loser id=${plan.loserParentId}) — cannot recover`);
    }
    const fuData = (fu.data as Record<string, any>) ?? {};
    if (fu.source !== "sentinel_followup") {
      throw new Error(`Follow-up row id=${fu.id} (${fu.reportNumber}) has source=${fu.source}, expected sentinel_followup — refusing to touch`);
    }
    const winnerId = fuData.sentinelReportId;
    const winnerNumber = fuData.sentinelReportNumber;
    if (typeof winnerId !== "number" || winnerId === plan.loserParentId) {
      throw new Error(`Follow-up row id=${fu.id} has invalid sentinelReportId=${winnerId} (loser=${plan.loserParentId}) — refusing to touch`);
    }
    plan.followUpRowId = fu.id;
    plan.winnerParentId = winnerId;
    plan.winnerParentNumber = typeof winnerNumber === "string" ? winnerNumber : "";
  }

  // ── 4. Print the plan ──────────────────────────────────────────────────────
  console.log("Recovery plan:");
  console.log("  loser_id  | winner_id | follow-up #");
  console.log("  ──────────┼───────────┼───────────────────────────────────────────");
  for (const p of plans) {
    console.log(`  ${String(p.loserParentId).padEnd(9)}| ${String(p.winnerParentId).padEnd(10)}| ${p.followUpNumber}`);
  }
  console.log(`\nTotal: ${plans.length} loser(s) → ${new Set(plans.map(p => p.followUpRowId)).size} follow-up row(s)\n`);

  if (!APPLY) {
    console.log("DRY-RUN complete. Re-run with --apply to write changes.\n");
    return;
  }

  // ── 5. Apply changes inside a transaction ──────────────────────────────────
  const recoveredAt = new Date().toISOString();

  await db.transaction(async (tx) => {
    // Patch each loser sentinel_auto row (json column → merge in JS)
    const loserById = new Map(losers.map(l => [l.id, l]));
    for (const p of plans) {
      const loser = loserById.get(p.loserParentId)!;
      const existingData = (loser.data as Record<string, any>) ?? {};
      const newData = {
        ...existingData,
        duplicateOfSentinelReportId: p.winnerParentId,
        duplicateOfSentinelReportNumber: p.winnerParentNumber,
        activeFollowUpReportNumber: p.followUpNumber,
        activeFollowUpReportId: p.followUpRowId,
        recoveredAt,
        recoveredBy: "scripts/recoverDuplicateFhpFollowUps.ts (Task #176)",
      };
      const errMsg = `DUPLICATE_FHP_INCIDENT: Same FHP id (${p.fhpIncidentId}) as parent ${p.winnerParentId} (${p.winnerParentNumber}); FLHSMV data tracked via follow-up ${p.followUpNumber}`;
      await tx
        .update(crashReports)
        .set({
          data: newData,
          errorLog: errMsg,
          updatedAt: new Date(),
        })
        .where(eq(crashReports.id, p.loserParentId));
    }

    // Patch each follow-up row's siblingSentinelReportIds (dedupe per follow-up)
    const losersByFollowUp = new Map<number, number[]>();
    for (const p of plans) {
      const arr = losersByFollowUp.get(p.followUpRowId) ?? [];
      arr.push(p.loserParentId);
      losersByFollowUp.set(p.followUpRowId, arr);
    }

    for (const [followUpRowId, loserIds] of losersByFollowUp) {
      const fuRow = await tx
        .select({ data: crashReports.data })
        .from(crashReports)
        .where(eq(crashReports.id, followUpRowId))
        .for("update");
      const fuData = (fuRow[0]?.data as Record<string, any>) ?? {};
      const existingSiblings: number[] = Array.isArray(fuData.siblingSentinelReportIds)
        ? fuData.siblingSentinelReportIds.filter((x: unknown): x is number => typeof x === "number")
        : [];
      const merged = [...new Set([...existingSiblings, ...loserIds])].sort((a, b) => a - b);
      const newData = { ...fuData, siblingSentinelReportIds: merged };

      await tx
        .update(crashReports)
        .set({
          data: newData,
          updatedAt: new Date(),
        })
        .where(eq(crashReports.id, followUpRowId));
    }
  });

  console.log(`✓ APPLIED — patched ${plans.length} loser(s) and ${new Set(plans.map(p => p.followUpRowId)).size} follow-up row(s)\n`);

  // ── 6. Verification pass ───────────────────────────────────────────────────
  const verifyLosers = await db
    .select({
      id: crashReports.id,
      reportNumber: crashReports.reportNumber,
      errorLog: crashReports.errorLog,
      data: crashReports.data,
    })
    .from(crashReports)
    .where(inArray(crashReports.id, plans.map(p => p.loserParentId)));

  let badLoser = 0;
  for (const v of verifyLosers) {
    const d = (v.data as Record<string, any>) ?? {};
    if (!d.duplicateOfSentinelReportId || !d.activeFollowUpReportNumber || !v.errorLog?.startsWith("DUPLICATE_FHP_INCIDENT")) {
      console.error(`  ✗ Loser id=${v.id} (${v.reportNumber}) failed verification`);
      badLoser++;
    }
  }
  console.log(`Verification: ${verifyLosers.length - badLoser}/${verifyLosers.length} loser rows OK${badLoser > 0 ? ` — ${badLoser} BAD` : ""}`);

  const verifyFollowUps = await db
    .select({
      id: crashReports.id,
      reportNumber: crashReports.reportNumber,
      data: crashReports.data,
    })
    .from(crashReports)
    .where(inArray(crashReports.id, [...new Set(plans.map(p => p.followUpRowId))]));

  let badFu = 0;
  for (const v of verifyFollowUps) {
    const d = (v.data as Record<string, any>) ?? {};
    const sibs = d.siblingSentinelReportIds;
    if (!Array.isArray(sibs) || sibs.length === 0) {
      console.error(`  ✗ Follow-up id=${v.id} (${v.reportNumber}) has no siblingSentinelReportIds`);
      badFu++;
    }
  }
  console.log(`Verification: ${verifyFollowUps.length - badFu}/${verifyFollowUps.length} follow-up rows OK${badFu > 0 ? ` — ${badFu} BAD` : ""}\n`);

  if (badLoser > 0 || badFu > 0) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("\n[RECOVERY] Fatal error:", err);
    process.exit(1);
  });
