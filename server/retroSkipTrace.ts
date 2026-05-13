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
import { resolveBatchDataKey, recordBatchDataRun, CRASH_LEAD_ACCOUNT_IDS } from "./vendorConfig";

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
  contact:   { tags?: string[] | null; phone?: string | null; address?: string | null },
  crashOnly: boolean,
): boolean {
  const tags          = contact.tags || [];
  const tagSet        = new Set(tags);

  // Must have a qualifying lead tag
  const allowedSet = crashOnly ? CRASH_ONLY_TAGS : ALLOWED_LEAD_TAGS;
  const hasLeadTag = [...allowedSet].some(t => tagSet.has(t));
  if (!hasLeadTag)                 return false;

  // Must NOT have a blocked/polluted tag
  const hasBlockedTag = [...BLOCKED_TAGS].some(t => tagSet.has(t));
  if (hasBlockedTag)               return false;

  // Must not already be skip-traced
  if (tagSet.has("skip-traced"))   return false;

  // Must have an address to trace against
  if (!contact.address)            return false;

  // Must not already have a phone (skip-trace already paid for)
  if (contact.phone)               return false;

  return true;
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

        const result = await skipTraceLookup(
          { address: contact.address!, city, state },
          apiKey,
        );

        if (result.ownerPhone || result.ownerName || result.totalPersonsFound > 0) {
          let firstName = contact.firstName;
          let lastName  = contact.lastName;

          if (result.ownerName) {
            const parts = result.ownerName.trim().split(" ");
            firstName   = parts[0]              || firstName;
            lastName    = parts.slice(1).join(" ") || lastName;
          }

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
          const skipNotes = `Skip Trace (${new Date().toLocaleDateString()}):\n${personLines.join("\n") || "No data found"}`;

          // Prefer the mailing address from skip trace over the crash-scene location
          const mailingAddr = result.mailingAddress || null;

          await storage.updateContact(contact.id, {
            firstName,
            lastName,
            phone:   result.ownerPhone   || contact.phone,
            email:   result.ownerEmail   || contact.email,
            address: mailingAddr          || contact.address,
            tags:   [...new Set([
              ...(contact.tags || []),
              "skip-traced",
              result.ownerPhone ? "has-phone" : "no-phone",
            ])],
            notes:  (contact.notes || "") + `\n\n${skipNotes}`,
          });

          publishEventAsync(EVENT_TYPES.CONTACT_UPDATED, {
            subAccountId,
            contactId:  contact.id,
            source:     "retro_skip_trace",
            hasPhone:   !!result.ownerPhone,
            hasEmail:   !!result.ownerEmail,
          }, "retro-skip-trace");

          stats.found++;
          console.log(`[RETRO-SKIP-TRACE] ✓ contact=${contact.id} name=${result.ownerName} phone=${result.ownerPhone || "none"}`);

        } else {
          await storage.updateContact(contact.id, {
            tags: [...new Set([...(contact.tags || []), "skip-traced", "no-phone"])],
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
    if (CRASH_LEAD_ACCOUNT_IDS.has(acct.id) || !cfg || cfg.enabled) {
      eligibleIds.push(acct.id);
    }
  }

  console.log(`[RETRO-SKIP-TRACE] Running for ${eligibleIds.length} eligible accounts: ${eligibleIds.join(", ")} (always-included crash accounts: 3, 4)`);

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
