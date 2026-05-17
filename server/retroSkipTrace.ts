// @ts-nocheck
/**
 * Retroactive Skip Trace Job
 *
 * Runs through crash-lead contacts with no phone and enriches them via BatchData.
 *
 * Safety rules:
 *   1. Only processes crash/sentinel source contacts — never legal/FDA/OSHA
 *   2. Skips contacts already tagged "skip-traced" (idempotent)
 *   3. Skips contacts with no usable address
 *   4. Skips contacts that already have a phone (BatchData already paid for them)
 *   5. Runs in batches of 10 with 2-second delays (rate-limit safe)
 *   6. Missing BATCH_DATA key → logs and exits silently (no crash)
 */

import { storage } from "./storage";
import { skipTraceLookup } from "./skip-trace";
import { publishEventAsync, EVENT_TYPES } from "./eventBus";
import { resolveBatchDataKey, recordBatchDataRun, CRASH_LEAD_ACCOUNT_IDS, ENRICHMENT_ACCOUNT_IDS } from "./vendorConfig";
import { isBatchDataDisabled } from "./skip-trace";
import { updateContactSkipTrace, isPlaceholderName } from "./services/contactUpsertService";

const BATCH_SIZE      = 10;
const BATCH_DELAY_MS  = 2000;

// Tags that disqualify a contact from skip-trace (polluted sources)
const BLOCKED_TAGS = new Set([
  "legal-lead", "attorney", "fda-recall", "osha-violation",
  "growth-lead", "attorney-lead", "cpsc-recall",
]);

// Only process contacts from these crash/sentinel sources
const ALLOWED_LEAD_TAGS = new Set(["crash-lead", "sentinel-auto", "home-service-lead"]);

// CRASH-ONLY tags for admin-triggered runs
const CRASH_ONLY_TAGS = new Set(["crash-lead", "sentinel-auto"]);

interface RetroStats {
  processed:   number;
  found:       number;
  notFound:    number;
  failed:      number;
  skipped:     number;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function isEligibleContact(
  contact: {
    tags?: string[] | null;
    phone?: string | null;
    address?: string | null;
    skipTraceStatus?: string | null;
    // Victim-centric address fields
    probableResidence?: string | null;
    registrationAddress?: string | null;
    addressConfidence?: number | null;
    addressType?: string | null;
  },
  crashOnly: boolean,
): boolean {
  const tags   = contact.tags || [];
  const tagSet = new Set(tags);

  // Must have a qualifying lead tag
  const allowedSet = crashOnly ? CRASH_ONLY_TAGS : ALLOWED_LEAD_TAGS;
  const hasLeadTag = [...allowedSet].some(t => tagSet.has(t));
  if (!hasLeadTag) return false;

  // Must NOT have a blocked/polluted tag
  const hasBlockedTag = [...BLOCKED_TAGS].some(t => tagSet.has(t));
  if (hasBlockedTag) return false;

  // Skip if already traced
  if (tagSet.has("skip-traced")) return false;
  const sts = contact.skipTraceStatus;
  if (sts && sts !== "not_attempted" && sts !== "pending") return false;

  // Must not already have a phone (skip-trace already paid for)
  if (contact.phone) return false;

  // Must have a RESIDENTIAL address to trace against.
  // The victim-centric pipeline stores skip-trace targets in:
  //   probableResidence > registrationAddress > address (if addressConfidence > 0.15)
  // Contacts whose only address is a highway/intersection reference (addressType='incident_location'
  // or addressConfidence <= 0.15) are NOT eligible — BatchData returns no_match 100% of the time.
  const hasResidentialTarget =
    !!(contact.probableResidence) ||
    !!(contact.registrationAddress) ||
    (!!contact.address && (contact.addressConfidence ?? 0) > 0.15);

  if (!hasResidentialTarget) return false;

  return true;
}

/**
 * Select the best residential address to use as the skip-trace query target.
 * Priority: probableResidence > registrationAddress > address (if residential confidence).
 * NEVER uses a highway/intersection string.
 */
function selectSkipTraceAddress(contact: {
  address?: string | null;
  probableResidence?: string | null;
  registrationAddress?: string | null;
  addressConfidence?: number | null;
}): string | null {
  if (contact.probableResidence)   return contact.probableResidence;
  if (contact.registrationAddress) return contact.registrationAddress;
  if (contact.address && (contact.addressConfidence ?? 0) > 0.15) return contact.address;
  return null;
}

export async function runRetroSkipTrace(
  subAccountId: number,
  options: { crashOnly?: boolean } = {},
): Promise<RetroStats> {
  const apiKey = resolveBatchDataKey();
  if (!apiKey) {
    console.error("[RETRO-SKIP-TRACE] BatchData not configured (BATCHDATA_API_KEY missing) — skipping");
    return { processed: 0, found: 0, notFound: 0, failed: 0, skipped: 0 };
  }
  if (isBatchDataDisabled()) {
    console.warn("[RETRO-SKIP-TRACE] BatchData disabled (exhausted or kill switch) — aborting retro job, will retry next scheduled run");
    return { processed: 0, found: 0, notFound: 0, failed: 0, skipped: 0 };
  }

  const crashOnly = options.crashOnly ?? false;
  const stats: RetroStats = { processed: 0, found: 0, notFound: 0, failed: 0, skipped: 0 };

  console.log(`[RETRO-SKIP-TRACE] Starting for account ${subAccountId} (crashOnly=${crashOnly})`);

  const allContacts  = await storage.getContacts(subAccountId, { limit: 5000 });
  const needsTrace   = allContacts.filter(c => isEligibleContact(c, crashOnly));

  console.log(
    `[RETRO-SKIP-TRACE] account=${subAccountId} total=${allContacts.length} eligible=${needsTrace.length}` +
    ` (already-traced=${allContacts.filter(c => (c.tags || []).includes("skip-traced")).length}` +
    ` has-phone=${allContacts.filter(c => !!c.phone).length})`
  );

  if (needsTrace.length === 0) {
    console.log(`[RETRO-SKIP-TRACE] Nothing to trace for account ${subAccountId}`);
    return stats;
  }

  for (let i = 0; i < needsTrace.length; i += BATCH_SIZE) {
    const batch = needsTrace.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(batch.map(async contact => {
      try {
        stats.processed++;

        const city  = contact.city?.replace(" County", "") || "";
        const state = "FL";

        // Use the best available residential address — never a highway reference
        const skipTraceTarget = selectSkipTraceAddress(contact as any);
        if (!skipTraceTarget) {
          stats.skipped++;
          console.log(`[RETRO-SKIP-TRACE] contact=${contact.id} — no residential address available, skipping`);
          return;
        }

        const result = await skipTraceLookup(
          { address: skipTraceTarget, city, state },
          apiKey,
        );

        if (result.ownerPhone || result.ownerName || result.totalPersonsFound > 0) {
          // Build rich notes listing ALL persons found
          const personLines: string[] = [];
          for (const p of result.allPersons) {
            personLines.push(
              [
                p.name || "Unknown",
                p.allPhones.length  ? `Phones: ${p.allPhones.join(", ")}`  : null,
                p.allEmails.length  ? `Emails: ${p.allEmails.join(", ")}`  : null,
                p.mailingAddress    ? `Mail: ${p.mailingAddress}`            : null,
                p.age               ? `Age: ${p.age}`                        : null,
              ].filter(Boolean).join(" | ")
            );
          }
          if (result.additionalAddresses.length > 0) {
            personLines.push(`Additional addresses: ${result.additionalAddresses.join("; ")}`);
          }
          const skipNotes = `Skip Trace BatchData (${new Date().toLocaleDateString()}):\n${personLines.join("\n") || "No data found"}`;

          // BatchData mailing address → victim-centric typed address field
          const mailingAddr = result.mailingAddress || null;
          const batchDataConf = result.totalPersonsFound > 0 ? 0.72 : 0.5; // ADDRESS_CONFIDENCE.BATCHDATA_INFERRED

          // Use the structured service to update skip-trace status + tags atomically
          await updateContactSkipTrace(contact.id, {
            status: "matched",
            phone: result.ownerPhone || null,
            firstName: result.ownerName && !isPlaceholderName(result.ownerName)
              ? result.ownerName.trim().split(" ")[0]
              : null,
            lastName: result.ownerName
              ? result.ownerName.trim().split(" ").slice(1).join(" ") || null
              : null,
            provider: "batchdata",
            confidence: batchDataConf,
          });

          // Update address fields using victim-centric hierarchy:
          // - mailingAddress field captures the BatchData mailing address
          // - contact.address upgrades to mailing address ONLY if confidence is higher than current
          //   (BatchData=0.72 wins over incident_location=0.15 but loses to FLHSMV/DHSMV >= 0.85)
          const currentConfidence = (contact as any).addressConfidence ?? 0;
          const addressUpdate: Record<string, any> = {
            email:  result.ownerEmail || (contact.email ?? undefined),
            notes: (contact.notes || "") + `\n\n${skipNotes}`,
            // Always store mailing address in its typed field
            ...(mailingAddr ? { mailingAddress: mailingAddr } : {}),
            // Upgrade contact.address only if BatchData confidence beats current
            ...(mailingAddr && batchDataConf > currentConfidence ? {
              address:           mailingAddr,
              addressConfidence: batchDataConf,
              addressType:       "mailing",
              addressSource:     "batchdata",
              // Probable residence = best non-verified address we have
              probableResidence: mailingAddr,
            } : {}),
            // Always upgrade identity + placeholder status on skip-trace match
            isPlaceholder:  false,
            viewClass:      "enriched_contact",
            workflowStage:  "scored",
          };
          await storage.updateContact(contact.id, addressUpdate);

          publishEventAsync(EVENT_TYPES.CONTACT_UPDATED, {
            subAccountId,
            contactId:  contact.id,
            source:     "retro_skip_trace",
            hasPhone:   !!result.ownerPhone,
            hasEmail:   !!result.ownerEmail,
          }, "retro-skip-trace");

          stats.found++;
          console.log(`[RETRO-SKIP-TRACE] ✓ contact=${contact.id} name=${result.ownerName} phone=${result.ownerPhone || "none"}`);

          // Report to Apex Intelligence brain (fire-and-forget)
          if (result.ownerPhone) {
            import("./operator/apexIntelligence").then(({ reportOutcome }) => reportOutcome({
              agentName:    "retro-skip-trace",
              action:       "phone_enriched",
              subject:      result.ownerName || `contact-${contact.id}`,
              result:       "Phone found via BatchData skip trace",
              confidence:   0.8,
              subAccountId,
              niche:        "crash",
              metadata: {
                contactId:   contact.id,
                hasPhone:    true,
                hasEmail:    !!result.ownerEmail,
                personsFound: result.totalPersonsFound,
              },
            // allow-silent-catch: fire-and-forget telemetry
            })).catch(() => {});
          }

        } else {
          // No match — record this formally so we don't re-trace and pay again
          await updateContactSkipTrace(contact.id, {
            status: "no_match",
            provider: "batchdata",
            confidence: 0,
          });
          stats.notFound++;
        }

      } catch (err: any) {
        stats.failed++;
        console.warn(`[RETRO-SKIP-TRACE] Failed contact=${contact.id}:`, err.message);
      }
    }));

    const pct = Math.round(((i + batch.length) / needsTrace.length) * 100);
    console.log(
      `[RETRO-SKIP-TRACE] Progress account=${subAccountId}: ${i + batch.length}/${needsTrace.length} (${pct}%)` +
      ` found=${stats.found} notFound=${stats.notFound} failed=${stats.failed}`
    );

    if (i + BATCH_SIZE < needsTrace.length) await sleep(BATCH_DELAY_MS);
  }

  console.log(`[RETRO-SKIP-TRACE] Complete account=${subAccountId}:`, stats);
  return stats;
}

// Canonical set imported from vendorConfig — single source of truth for all vendor gates.
// Contains: 3 (Apex Marketing / APEX MAIN), 4 (Crash Connect — Giovanni)

export async function runRetroSkipTraceAllAccounts(): Promise<void> {
  const { db }         = await import("./db");
  const { subAccounts } = await import("@shared/schema");
  const { ne }         = await import("drizzle-orm");
  const { pool }       = await import("./db");

  const allAccounts = await db
    .select({ id: subAccounts.id })
    .from(subAccounts)
    .where(ne(subAccounts.ownerUserId, "_archived"));

  const eligibleIds: number[] = [];
  for (const acct of allAccounts) {
    const r = await pool.query(
      `SELECT niche, enabled FROM sentinel_config WHERE sub_account_id=$1 LIMIT 1`,
      [acct.id]
    );
    const cfg = r.rows[0];
    // Always include known crash lead accounts (3, 13, 14) even if sentinel_config
    // is absent or disabled — crash leads are delivered there unconditionally.
    if ((CRASH_LEAD_ACCOUNT_IDS.has(acct.id) || !cfg || cfg.enabled) && ENRICHMENT_ACCOUNT_IDS.has(acct.id)) {
      eligibleIds.push(acct.id);
    }
  }

  console.log(`[RETRO-SKIP-TRACE] Running for ${eligibleIds.length} enrichment-allowed accounts: ${eligibleIds.join(", ")} (enrichment restricted to: ${[...ENRICHMENT_ACCOUNT_IDS].join(", ")})`);

  for (const accountId of eligibleIds) {
    const stats = await runRetroSkipTrace(accountId, { crashOnly: false });
    console.log(
      `[RETRO-SKIP-TRACE] Account ${accountId}: processed=${stats.processed}` +
      ` found=${stats.found} notFound=${stats.notFound} failed=${stats.failed}`
    );
    recordBatchDataRun(
      stats.processed,
      `retro-scheduler account=${accountId}`,
      stats.failed > 0 ? `${stats.failed} contacts failed` : null,
    );
  }
}

export function startRetroSkipTraceScheduler(): void {
  setTimeout(() => {
    runRetroSkipTraceAllAccounts().catch(err =>
      console.error("[RETRO-SKIP-TRACE] Scheduled run failed:", err?.message)
    );
  }, 2 * 60 * 1000);

  setInterval(() => {
    runRetroSkipTraceAllAccounts().catch(err =>
      console.error("[RETRO-SKIP-TRACE] Scheduled run failed:", err?.message)
    );
  }, 6 * 60 * 60 * 1000);

  console.log("[RETRO-SKIP-TRACE] Scheduler started — runs in 2min, then every 6h");
}
