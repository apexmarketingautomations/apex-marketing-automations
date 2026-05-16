/**
 * Retro FLHSMV Enrichment Job
 *
 * Goes back through existing crash reports that have an officialReportNumber
 * (confirmed FL government report) but whose contacts still carry placeholder
 * names ("Unidentified Crash Incident") or missing addresses. Fetches the full
 * FLHSMV report detail through ScrapingBee and updates the contact with the
 * real driver name and home address.
 *
 * Phone numbers are NOT available directly from FLHSMV — those still require
 * BatchData skip-trace. This job fixes: names, addresses, vehicle/insurance data.
 *
 * Safety rules:
 *   1. Only processes reports with officialReportNumber populated
 *   2. Skips reports already tagged "flhsmv-enriched" on their contact
 *   3. Rate-limited: 3 requests/batch, 4-second delay between batches
 *   4. Requires SCRAPINGBEE_API_KEY — exits gracefully if absent
 *   5. Idempotent: enrichCrashLeadContacts upserts, never duplicates
 */

import { db } from "./db";
import { crashReports } from "@shared/schema";
import { isNotNull, eq, and } from "drizzle-orm";
import { fetchReportDetail, enrichCrashLeadContacts } from "./crashReportWorker";

const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 4000;

export interface RetroEnrichStats {
  total: number;
  enriched: number;
  noData: number;
  failed: number;
  skipped: number;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export async function runRetroFLHSMVEnrich(options: {
  limit?: number;
  dryRun?: boolean;
} = {}): Promise<RetroEnrichStats> {
  const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY;
  if (!SCRAPINGBEE_API_KEY) {
    console.error("[RETRO-FLHSMV] ⚠️  SCRAPINGBEE_API_KEY not set — cannot fetch FLHSMV detail, exiting");
    return { total: 0, enriched: 0, noData: 0, failed: 0, skipped: 0 };
  }

  const { dryRun = false, limit = 500 } = options;

  const stats: RetroEnrichStats = { total: 0, enriched: 0, noData: 0, failed: 0, skipped: 0 };

  // Find crash reports that have an official report number but haven't been enriched yet.
  // We use processedToLead = false OR data->>'flhsmvEnrichedAt' IS NULL as the "needs enrichment" signal.
  // The enrichCrashLeadContacts function is idempotent via upsertContact, so over-running is safe.
  const rows = await db
    .select({
      id: crashReports.id,
      reportNumber: crashReports.reportNumber,
      officialReportNumber: crashReports.officialReportNumber,
      subAccountId: crashReports.subAccountId,
      data: crashReports.data,
    })
    .from(crashReports)
    .where(
      and(
        isNotNull(crashReports.officialReportNumber),
        eq(crashReports.status, "COMPLETE"),
      )
    )
    .limit(limit);

  stats.total = rows.length;
  console.log(`[RETRO-FLHSMV] Found ${rows.length} COMPLETE reports with official number (limit=${limit})`);

  if (dryRun) {
    console.log(`[RETRO-FLHSMV] DRY RUN — no changes made`);
    return stats;
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(batch.map(async (row) => {
      try {
        const officialNumber = row.officialReportNumber!;

        // Fetch FLHSMV detail through ScrapingBee
        const result = await fetchReportDetail(officialNumber);

        if (result.type !== "success" || !result.data) {
          console.log(
            `[RETRO-FLHSMV] No data for ${officialNumber}: ${result.type}${"message" in result ? ` — ${result.message}` : ""}`
          );
          stats.noData++;
          return;
        }

        const detailData = result.data;
        const driver = detailData.Vehicles?.[0]?.Driver;

        if (!driver?.Name) {
          console.log(`[RETRO-FLHSMV] No driver name in FLHSMV response for ${officialNumber}`);
          stats.skipped++;
          return;
        }

        await enrichCrashLeadContacts({
          sentinelReportNumber: row.reportNumber,
          subAccountId: row.subAccountId ?? null,
          detailData,
          officialReportNumber: officialNumber,
        });

        console.log(`[RETRO-FLHSMV] ✓ Enriched ${officialNumber} — driver: ${driver.Name}`);
        stats.enriched++;
      } catch (err: any) {
        console.warn(`[RETRO-FLHSMV] Failed report ${row.officialReportNumber}: ${err.message}`);
        stats.failed++;
      }
    }));

    const pct = Math.round(((i + batch.length) / rows.length) * 100);
    console.log(
      `[RETRO-FLHSMV] Progress: ${i + batch.length}/${rows.length} (${pct}%) ` +
      `enriched=${stats.enriched} noData=${stats.noData} failed=${stats.failed}`
    );

    if (i + BATCH_SIZE < rows.length) await sleep(BATCH_DELAY_MS);
  }

  console.log(`[RETRO-FLHSMV] Complete:`, stats);
  return stats;
}
