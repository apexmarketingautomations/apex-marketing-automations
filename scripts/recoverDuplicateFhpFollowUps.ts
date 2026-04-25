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
 *   1. Patch the loser sentinel_auto row's `data` so it explicitly points at
 *      the winner and at the active follow-up job that will fetch FLHSMV data
 *      on the loser's behalf, AND set the loser's `error_log` to a
 *      "DUPLICATE_FHP_INCIDENT" message (explicit close-out with reason).
 *   2. Patch the winner's follow-up `data.siblingSentinelReportIds[]` so a
 *      future worker enhancement can opportunistically stamp officialFlhsmv
 *      onto every sibling parent (not just `sentinelReportId`). Tracked as
 *      project follow-up task #182.
 *   3. Guarantee the canonical follow-up is in an ACTIVE state (PENDING /
 *      PROCESSING / COMPLETED). If it has slipped to FAILED / NOT_FOUND /
 *      anything else, reset it to PENDING with refreshed metadata (mirrors
 *      requeueFlhsmvFollowUps.ts lines 162-178).
 *
 * Strict post-apply assertion: every loser must end up linked to a follow-up
 * row in an ACTIVE state. The script throws if any loser ends up otherwise.
 *
 * Idempotent: safe to re-run. It re-checks every loser's follow-up status on
 * each run and re-resets any that have drifted out of an ACTIVE state.
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

// Statuses that mean a follow-up job is alive — won't be drained off the queue
const ACTIVE_STATUSES = new Set(["PENDING", "PROCESSING", "COMPLETED"]);

function buildFollowUpNumber(incidentId: string): string {
  return `FLHSMV-FOLLOWUP-${incidentId.replace(/[^A-Z0-9]/gi, "-").toUpperCase()}`;
}

interface LoserPlan {
  loserParentId: number;
  loserParentNumber: string;
  fhpIncidentId: string;
  followUpNumber: string;
  followUpRowId: number;
  followUpStatus: string;
  winnerParentId: number;
  winnerParentNumber: string;
  // Actions to take on apply
  needsRecoveryMarkers: boolean;     // patch loser's data + error_log
  needsSiblingFanOut: boolean;       // add loser id to followup data.siblingSentinelReportIds
  needsFollowUpReset: boolean;       // reset followup status to PENDING
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  TASK #176 — Recover duplicate FHP follow-ups`);
  console.log(`  Mode: ${APPLY ? "APPLY (writing changes)" : "DRY-RUN (no changes — pass --apply to write)"}`);
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ── 1. Load all losers ────────────────────────────────────────────────────
  const losers = await db
    .select()
    .from(crashReports)
    .where(inArray(crashReports.id, [...LOSER_PARENT_IDS]));

  if (losers.length !== LOSER_PARENT_IDS.length) {
    const found = new Set(losers.map(l => l.id));
    const missing = LOSER_PARENT_IDS.filter(id => !found.has(id));
    throw new Error(`Expected ${LOSER_PARENT_IDS.length} loser rows but found ${losers.length}. Missing: ${missing.join(",")}`);
  }
  const loserById = new Map(losers.map(l => [l.id, l]));

  // ── 2. Resolve every loser to its follow-up number ────────────────────────
  // Prefer activeFollowUpReportNumber if a previous recovery has already run;
  // otherwise rebuild it from rawPayload.id.
  const followUpNumberByLoserId = new Map<number, { followUpNumber: string; fhpIncidentId: string }>();
  for (const loser of losers) {
    const data = (loser.data as Record<string, any>) ?? {};
    const raw = (loser.rawPayload as Record<string, any>) ?? {};
    const incidentId: string | undefined = raw?.id;
    if (!incidentId) {
      throw new Error(`Loser id=${loser.id} (${loser.reportNumber}) has no rawPayload.id — cannot map to follow-up`);
    }
    const fromRecovery = typeof data.activeFollowUpReportNumber === "string" ? data.activeFollowUpReportNumber : null;
    const computed = buildFollowUpNumber(incidentId);
    if (fromRecovery && fromRecovery !== computed) {
      throw new Error(`Loser id=${loser.id}: stored activeFollowUpReportNumber=${fromRecovery} disagrees with computed=${computed} — refusing to touch`);
    }
    followUpNumberByLoserId.set(loser.id, { followUpNumber: computed, fhpIncidentId: incidentId });
  }

  // ── 3. Load all referenced follow-up rows ─────────────────────────────────
  const allFollowUpNumbers = [...new Set([...followUpNumberByLoserId.values()].map(v => v.followUpNumber))];
  const followUps = await db
    .select()
    .from(crashReports)
    .where(inArray(crashReports.reportNumber, allFollowUpNumbers));
  const followUpByNumber = new Map(followUps.map(f => [f.reportNumber, f]));

  // ── 4. Build a per-loser plan ─────────────────────────────────────────────
  const plans: LoserPlan[] = [];

  for (const loser of losers) {
    const { followUpNumber, fhpIncidentId } = followUpNumberByLoserId.get(loser.id)!;
    const fu = followUpByNumber.get(followUpNumber);
    if (!fu) {
      throw new Error(`No existing follow-up row found for ${followUpNumber} (loser id=${loser.id}) — cannot recover`);
    }
    if (fu.source !== "sentinel_followup") {
      throw new Error(`Follow-up row id=${fu.id} (${fu.reportNumber}) has source=${fu.source}, expected sentinel_followup — refusing to touch`);
    }
    const fuData = (fu.data as Record<string, any>) ?? {};
    const winnerId = fuData.sentinelReportId;
    const winnerNumber = fuData.sentinelReportNumber;
    if (typeof winnerId !== "number" || winnerId === loser.id) {
      throw new Error(`Follow-up row id=${fu.id} has invalid sentinelReportId=${winnerId} (loser=${loser.id}) — refusing to touch`);
    }

    const loserData = (loser.data as Record<string, any>) ?? {};
    const existingSiblings: number[] = Array.isArray(fuData.siblingSentinelReportIds)
      ? fuData.siblingSentinelReportIds.filter((x: unknown): x is number => typeof x === "number")
      : [];

    const needsRecoveryMarkers =
      loserData.duplicateOfSentinelReportId !== winnerId ||
      loserData.activeFollowUpReportNumber !== followUpNumber ||
      loserData.activeFollowUpReportId !== fu.id ||
      !(typeof loser.errorLog === "string" && loser.errorLog.startsWith("DUPLICATE_FHP_INCIDENT:"));

    const needsSiblingFanOut = !existingSiblings.includes(loser.id);
    const needsFollowUpReset = !ACTIVE_STATUSES.has(fu.status ?? "");

    plans.push({
      loserParentId: loser.id,
      loserParentNumber: loser.reportNumber,
      fhpIncidentId,
      followUpNumber,
      followUpRowId: fu.id,
      followUpStatus: fu.status ?? "",
      winnerParentId: winnerId,
      winnerParentNumber: typeof winnerNumber === "string" ? winnerNumber : "",
      needsRecoveryMarkers,
      needsSiblingFanOut,
      needsFollowUpReset,
    });
  }

  // ── 5. Print plan ─────────────────────────────────────────────────────────
  const cMarkers = plans.filter(p => p.needsRecoveryMarkers).length;
  const cSiblings = plans.filter(p => p.needsSiblingFanOut).length;
  const cReset = plans.filter(p => p.needsFollowUpReset).length;

  console.log("Per-loser action summary:");
  console.log(`  • Need recovery markers (loser data/error_log) : ${cMarkers}`);
  console.log(`  • Need sibling fan-out (followup data array)   : ${cSiblings}`);
  console.log(`  • Need follow-up status reset → PENDING        : ${cReset}\n`);

  console.log("Detail (loser → winner / follow-up — current followup status):");
  for (const p of plans) {
    const flags = [
      p.needsRecoveryMarkers ? "MARK" : "----",
      p.needsSiblingFanOut ? "SIB" : "---",
      p.needsFollowUpReset ? "RST" : "---",
    ].join(" ");
    console.log(
      `  ${String(p.loserParentId).padStart(5)} → ${String(p.winnerParentId).padStart(5)}  ` +
      `[${flags}]  ${p.followUpNumber.padEnd(40)}  status=${p.followUpStatus}`,
    );
  }
  console.log();

  if (cMarkers === 0 && cSiblings === 0 && cReset === 0) {
    console.log("✓ Nothing to do — every loser already linked to an active follow-up. Running final assertion only.\n");
  }

  if (!APPLY) {
    console.log("DRY-RUN complete. Re-run with --apply to write changes.\n");
    // Soft-mode assertion: report invariant violations but don't throw, so
    // operators see the plan + the gap rather than an exception.
    await assertAllLosersLinkedToActiveFollowUp(plans, { throwOnFail: false });
    return;
  }

  // ── 6. Apply changes inside a transaction ─────────────────────────────────
  const recoveredAt = new Date().toISOString();

  await db.transaction(async (tx) => {
    // 6a. Loser recovery markers
    for (const p of plans) {
      if (!p.needsRecoveryMarkers) continue;
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

    // 6b. Follow-up sibling fan-out + status reset, atomically per follow-up row
    const followUpRowIds = [...new Set(plans.map(p => p.followUpRowId))];
    for (const fuRowId of followUpRowIds) {
      const myPlans = plans.filter(p => p.followUpRowId === fuRowId);
      const needsAny = myPlans.some(p => p.needsSiblingFanOut || p.needsFollowUpReset);
      if (!needsAny) continue;

      const [fuRow] = await tx
        .select()
        .from(crashReports)
        .where(eq(crashReports.id, fuRowId))
        .for("update");
      if (!fuRow) {
        throw new Error(`Follow-up row id=${fuRowId} disappeared mid-transaction`);
      }
      const fuData = (fuRow.data as Record<string, any>) ?? {};
      const existingSiblings: number[] = Array.isArray(fuData.siblingSentinelReportIds)
        ? fuData.siblingSentinelReportIds.filter((x: unknown): x is number => typeof x === "number")
        : [];
      const losersForThisFu = myPlans.map(p => p.loserParentId);
      const mergedSiblings = [...new Set([...existingSiblings, ...losersForThisFu])].sort((a, b) => a - b);
      const newFuData = { ...fuData, siblingSentinelReportIds: mergedSiblings };

      const followUpReset = !ACTIVE_STATUSES.has(fuRow.status ?? "");

      const setObj: Record<string, any> = {
        data: newFuData,
        updatedAt: new Date(),
      };
      if (followUpReset) {
        // Mirrors requeueFlhsmvFollowUps.ts lines 162-178: reset to PENDING with
        // refreshed metadata so the worker will pick it back up cleanly.
        setObj.status = "PENDING";
        setObj.retryCount = 0;
        setObj.serviceFailureCount = 0;
        setObj.errorLog = null;
        setObj.lockedAt = null;
        setObj.lockedBy = null;
      }

      await tx.update(crashReports).set(setObj).where(eq(crashReports.id, fuRowId));
    }
  });

  console.log(`✓ APPLIED — ${cMarkers} loser-marker patch(es), ${cSiblings} sibling fan-out(s), ${cReset} follow-up reset(s)\n`);

  // ── 7. Strict post-apply assertion (always throws on failure) ─────────────
  await assertAllLosersLinkedToActiveFollowUp(
    // re-resolve from DB to pick up the post-apply state, not the in-memory plan
    plans.map(p => ({ ...p })),
    { throwOnFail: true },
  );
}

async function assertAllLosersLinkedToActiveFollowUp(
  plans: LoserPlan[],
  opts: { throwOnFail: boolean },
) {
  const loserIds = plans.map(p => p.loserParentId);
  const followUpRowIds = [...new Set(plans.map(p => p.followUpRowId))];

  const [reLosers, reFollowUps] = await Promise.all([
    db
      .select({
        id: crashReports.id,
        reportNumber: crashReports.reportNumber,
        errorLog: crashReports.errorLog,
        data: crashReports.data,
      })
      .from(crashReports)
      .where(inArray(crashReports.id, loserIds)),
    db
      .select({
        id: crashReports.id,
        reportNumber: crashReports.reportNumber,
        status: crashReports.status,
        data: crashReports.data,
      })
      .from(crashReports)
      .where(inArray(crashReports.id, followUpRowIds)),
  ]);

  const fuById = new Map(reFollowUps.map(f => [f.id, f]));
  const failures: string[] = [];

  for (const p of plans) {
    const loser = reLosers.find(l => l.id === p.loserParentId);
    const fu = fuById.get(p.followUpRowId);
    if (!loser) { failures.push(`loser ${p.loserParentId}: row missing`); continue; }
    if (!fu)    { failures.push(`loser ${p.loserParentId}: follow-up ${p.followUpRowId} missing`); continue; }

    const loserData = (loser.data as Record<string, any>) ?? {};
    const fuData = (fu.data as Record<string, any>) ?? {};

    if (loserData.activeFollowUpReportId !== p.followUpRowId) {
      failures.push(`loser ${p.loserParentId}: data.activeFollowUpReportId=${loserData.activeFollowUpReportId}, expected ${p.followUpRowId}`);
    }
    if (loserData.duplicateOfSentinelReportId !== p.winnerParentId) {
      failures.push(`loser ${p.loserParentId}: data.duplicateOfSentinelReportId=${loserData.duplicateOfSentinelReportId}, expected ${p.winnerParentId}`);
    }
    if (!loser.errorLog?.startsWith("DUPLICATE_FHP_INCIDENT:")) {
      failures.push(`loser ${p.loserParentId}: error_log does not start with DUPLICATE_FHP_INCIDENT:`);
    }
    if (!ACTIVE_STATUSES.has(fu.status ?? "")) {
      failures.push(`loser ${p.loserParentId}: follow-up ${fu.reportNumber} status=${fu.status}, must be one of ${[...ACTIVE_STATUSES].join("/")}`);
    }
    const sibs: unknown = fuData.siblingSentinelReportIds;
    if (!Array.isArray(sibs) || !sibs.includes(p.loserParentId)) {
      failures.push(`loser ${p.loserParentId}: not present in follow-up.data.siblingSentinelReportIds (${JSON.stringify(sibs)})`);
    }
  }

  if (failures.length > 0) {
    const header = opts.throwOnFail ? "✗ FINAL ASSERTION FAILED" : "⚠ Pre-apply state has invariant gaps (expected in dry-run before --apply)";
    console.error(`\n${header}:`);
    for (const f of failures) console.error(`    - ${f}`);
    if (opts.throwOnFail) {
      throw new Error(`Final assertion failed: ${failures.length} invariant violation(s) across ${plans.length} loser(s)`);
    }
    return;
  }

  console.log(`✓ Final assertion: all ${plans.length} loser(s) are linked to an ACTIVE follow-up job and carry recovery markers.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n[RECOVERY] Fatal error:", err.message ?? err);
    process.exit(1);
  });
