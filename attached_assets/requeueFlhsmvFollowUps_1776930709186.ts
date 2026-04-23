/**
 * requeueFlhsmvFollowUps.ts — STEP 2 of 2
 *
 * For every sentinel_auto row with no FLHSMV data, queues a sentinel_followup
 * PENDING job so the crash-report worker can fetch the full official report
 * (driver, insurance, vehicle, narrative) from FLHSMV and stamp it back.
 *
 * Idempotent: rows that already have an active follow-up job (PENDING /
 * PROCESSING / COMPLETED) are skipped. Failed follow-up jobs are reset to
 * PENDING rather than duplicated. Non-qualifying crash types are skipped —
 * they don't produce client leads and don't need full FLHSMV data.
 *
 * Run AFTER backfillCrashStatus.ts.
 *
 * Usage (from repo root):
 *   npx tsx scripts/requeueFlhsmvFollowUps.ts
 *
 * Then restart the server to trigger an immediate worker tick, or wait up
 * to 1 hour for the scheduled tick to fire.
 */

import { db } from "./server/db";
import { crashReports } from "./shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

// ── Must match crashIngestPipeline.ts ────────────────────────────────────────
const LEAD_QUALIFYING_TYPES = [
  "INJUR", "FATAL", "ENTRAP", "EXTRICAT", "TRAUMA",
  "ROADBLOCK", "HIT AND RUN", "H&R", "ROLLOVER",
];

function isQualifying(type: string | null, severity: string | null): boolean {
  if (!type) return false;
  const u = type.toUpperCase();
  return LEAD_QUALIFYING_TYPES.some(kw => u.includes(kw)) || (severity ?? "").toLowerCase() === "critical";
}

/** Extract crash date from the sentinel "received" timestamp ("04/21/2026 08:53:25") */
function extractCrashDate(received: string | undefined): string {
  if (received) {
    const part = received.split(" ")[0];
    if (part && part.includes("/")) return part;
    // ISO format fallback
    if (received.includes("T")) {
      const d = new Date(received);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
      }
    }
  }
  return new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

/** Build the canonical follow-up report number for a given sentinel row */
function buildFollowUpNumber(rawPayload: Record<string, any>, parentId: number): string {
  const incidentId: string | undefined = rawPayload?.id;
  if (incidentId) {
    return `FLHSMV-FOLLOWUP-${incidentId.replace(/[^A-Z0-9]/gi, "-").toUpperCase()}`;
  }
  return `FLHSMV-FOLLOWUP-RECOVERY-${parentId}`;
}

// Statuses that mean a follow-up job is alive — don't duplicate
const ACTIVE_STATUSES = new Set(["PENDING", "PROCESSING", "COMPLETED"]);

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  STEP 2/2 — Queue FLHSMV Follow-Up Jobs");
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ── 1. Find all sentinel_auto rows with no FLHSMV data ───────────────────
  const targets = await db
    .select()
    .from(crashReports)
    .where(
      and(
        eq(crashReports.source, "sentinel_auto"),
        sql`(${crashReports.data} -> 'officialFlhsmv') IS NULL`,
        sql`(${crashReports.data} -> 'detail')         IS NULL`,
      ),
    )
    .orderBy(crashReports.createdAt);

  console.log(`Found ${targets.length} sentinel_auto row(s) with no FLHSMV data.\n`);

  if (targets.length === 0) {
    console.log("✓ Nothing to queue — all rows already have real data.\n");
    return;
  }

  // ── 2. Check which follow-up jobs already exist ───────────────────────────
  const expectedNumbers = targets.map(r =>
    buildFollowUpNumber((r.rawPayload as Record<string, any>) ?? {}, r.id)
  );

  const existingJobs = await db
    .select({ reportNumber: crashReports.reportNumber, status: crashReports.status })
    .from(crashReports)
    .where(inArray(crashReports.reportNumber, expectedNumbers));

  const existingByNumber = new Map(existingJobs.map(j => [j.reportNumber, j.status ?? ""]));

  // ── 3. Process each target ────────────────────────────────────────────────
  let queued        = 0;
  let resetFailed   = 0;
  let skippedActive = 0;
  let skippedNQ     = 0;
  let missingCounty = 0;
  const errors: string[] = [];

  for (const row of targets) {
    const data       = (row.data       as Record<string, any>) ?? {};
    const rawPayload = (row.rawPayload as Record<string, any>) ?? {};

    const type:     string | null = data.type     ?? rawPayload.type     ?? null;
    const severity: string | null = data.severity ?? rawPayload.severity ?? null;
    const county:   string | null = data.county   ?? rawPayload.county   ?? null;
    const location: string | null = data.location ?? rawPayload.location ?? null;
    const lat:      number | null = data.lat      ?? rawPayload.lat      ?? null;
    const lng:      number | null = data.lng      ?? rawPayload.lng      ?? null;
    const received: string | null = data.received ?? rawPayload.received ?? null;
    const crashDate = extractCrashDate(received ?? undefined);

    // Non-qualifying crashes don't produce client leads — skip
    if (!isQualifying(type, severity)) {
      skippedNQ++;
      continue;
    }

    const followUpNumber = buildFollowUpNumber(rawPayload, row.id);
    const existingStatus = existingByNumber.get(followUpNumber);

    // Already has an active or completed follow-up — skip
    if (existingStatus !== undefined && ACTIVE_STATUSES.has(existingStatus)) {
      skippedActive++;
      continue;
    }

    // Can't run county/date discovery without county
    if (!county) {
      missingCounty++;
      errors.push(`id=${row.id} (${row.reportNumber}): missing county in data/rawPayload — manual fetch required`);
      continue;
    }

    const jobData = {
      sentinelReportId:     row.id,
      sentinelReportNumber: row.reportNumber,
      fhpIncidentId:        rawPayload?.id ?? null,
      county,
      crashDate,
      location:             location ?? "",
      lat,
      lng,
      received,             // passed through so worker can use for time-based scoring
      type,
      severity,
    };

    try {
      if (existingStatus !== undefined) {
        // Failed / NOT_FOUND follow-up — reset it to PENDING with refreshed metadata
        await db
          .update(crashReports)
          .set({
            status:             "PENDING",
            retryCount:         0,
            serviceFailureCount: 0,
            errorLog:           null,
            lockedAt:           null,
            lockedBy:           null,
            updatedAt:          new Date(),
            data:               jobData,
          })
          .where(eq(crashReports.reportNumber, followUpNumber));

        resetFailed++;
        console.log(`  ↺ Reset → PENDING: ${followUpNumber}  (parent id=${row.id}, county=${county}, date=${crashDate})`);
      } else {
        // No follow-up job exists at all — create one
        await db.insert(crashReports).values({
          reportNumber:       followUpNumber,
          status:             "PENDING",
          source:             "sentinel_followup",
          subAccountId:       row.subAccountId,
          ingestTraceId:      row.ingestTraceId,
          retryCount:         0,
          serviceFailureCount: 0,
          processedToLead:    false,
          data:               jobData,
        });

        queued++;
        console.log(`  + Queued: ${followUpNumber}  (parent id=${row.id}, county=${county}, date=${crashDate})`);
      }
    } catch (err: any) {
      errors.push(`id=${row.id} (${row.reportNumber}): ${err.message}`);
      console.error(`  ✗ Error queuing follow-up for id=${row.id}: ${err.message}`);
    }
  }

  // ── 4. Summary ────────────────────────────────────────────────────────────
  const totalQueued = queued + resetFailed;

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  RESULTS
  New follow-up jobs queued    : ${queued}
  Failed jobs reset → PENDING  : ${resetFailed}
  ─────────────────────────────────────────────────
  Total jobs now PENDING        : ${totalQueued}
  ─────────────────────────────────────────────────
  Skipped (active job exists)  : ${skippedActive}
  Skipped (non-qualifying type): ${skippedNQ}
  Skipped (missing county)     : ${missingCounty}
  Errors                        : ${errors.length}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (errors.length > 0) {
    console.warn("\nRows requiring manual attention:");
    errors.forEach(e => console.warn(`  ✗ ${e}`));
  }

  if (totalQueued > 0) {
    console.log(`
✓ ${totalQueued} follow-up job(s) are PENDING.

  The crash-report worker will pick them up and fetch full FLHSMV data:
    • Driver name, address, injury type
    • Insurance company per vehicle
    • Vehicle year/make/model/tag/state
    • Full crash narrative
    • Official FLHSMV report number

  Each successful fetch stamps the data onto the parent sentinel row
  and flips it to COMPLETED — your lawyers will see the full report.

  Worker runs on a 1-hour tick. To process immediately:
    → Restart the server (triggers an immediate worker tick)
`);
  } else {
    console.log("\n✓ All qualifying rows are already being processed or complete.\n");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n[REQUEUE] Fatal error:", err);
    process.exit(1);
  });
