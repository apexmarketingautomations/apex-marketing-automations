/**
 * Retroactive Skip Trace Job
 * Runs through all crash-lead contacts with no phone number,
 * skip traces their address via BatchData, and updates the contact
 * with real name + phone. Runs in batches to respect API rate limits.
 */

import { storage } from "./storage";
import { skipTraceLookup } from "./skip-trace";
import { publishEventAsync, EVENT_TYPES } from "./eventBus";

const BATCH_SIZE = 10;         // contacts per batch
const BATCH_DELAY_MS = 2000;   // 2 seconds between batches — respect rate limits
// Account IDs fetched dynamically from DB — see runRetroSkipTraceAllAccounts

interface RetroStats {
  processed: number;
  found: number;
  notFound: number;
  failed: number;
  skipped: number;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export async function runRetroSkipTrace(subAccountId: number): Promise<RetroStats> {
  const apiKey = process.env.BATCH_DATA || process.env.BATCHDATA_API_KEY;
  if (!apiKey) {
    console.error("[RETRO-SKIP-TRACE] BATCH_DATA env var not set");
    return { processed: 0, found: 0, notFound: 0, failed: 0, skipped: 0 };
  }

  const stats: RetroStats = { processed: 0, found: 0, notFound: 0, failed: 0, skipped: 0 };

  console.log(`[RETRO-SKIP-TRACE] Starting retroactive skip trace for account ${subAccountId}`);

  // Get all contacts needing skip trace — crash leads AND home service leads with no phone
  const allContacts = await storage.getContacts(subAccountId, { limit: 5000 });
  const needsTrace = allContacts.filter(c => {
    const tags = c.tags || [];
    const isLead = tags.includes("crash-lead") || tags.includes("home-service-lead") || tags.includes("sentinel-auto");
    const noPhone = !c.phone;
    const hasAddress = !!c.address;
    const notAlreadyTraced = !tags.includes("skip-traced");
    return isLead && noPhone && hasAddress && notAlreadyTraced;
  });

  console.log(`[RETRO-SKIP-TRACE] Found ${needsTrace.length} contacts needing skip trace`);

  // Process in batches
  for (let i = 0; i < needsTrace.length; i += BATCH_SIZE) {
    const batch = needsTrace.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(batch.map(async (contact) => {
      try {
        stats.processed++;

        if (!contact.address) { stats.skipped++; return; }

        // Parse city/state from address string
        const addressParts = contact.address.split(",");
        const city = contact.city?.replace(" County", "") || "";
        const state = "FL";

        const result = await skipTraceLookup(
          { address: contact.address, city, state },
          apiKey
        );

        if (result.ownerPhone || result.ownerName || result.totalPersonsFound > 0) {
          // Build real name from primary person
          let firstName = contact.firstName;
          let lastName = contact.lastName;

          if (result.ownerName) {
            const parts = result.ownerName.trim().split(" ");
            firstName = parts[0] || firstName;
            lastName = parts.slice(1).join(" ") || lastName;
          }

          // Build rich notes with ALL persons found
          const personLines: string[] = [];
          for (const p of result.allPersons) {
            const pLine = [
              p.name || "Unknown",
              p.allPhones.length ? `Phones: ${p.allPhones.join(', ')}` : null,
              p.allEmails.length ? `Emails: ${p.allEmails.join(', ')}` : null,
              p.mailingAddress ? `Mail: ${p.mailingAddress}` : null,
              p.age ? `Age: ${p.age}` : null,
            ].filter(Boolean).join(' | ');
            personLines.push(pLine);
          }
          if (result.additionalAddresses.length > 0) {
            personLines.push(`Additional addresses: ${result.additionalAddresses.join('; ')}`);
          }
          const skipNotes = `Skip Trace (${new Date().toLocaleDateString()}):\n${personLines.join('\n') || 'No data found'}`;

          // Update contact with real data
          await storage.updateContact(contact.id, {
            firstName,
            lastName,
            phone: result.ownerPhone || contact.phone,
            email: result.ownerEmail || contact.email,
            tags: [...new Set([...(contact.tags || []), "skip-traced", result.ownerPhone ? "has-phone" : "no-phone"])],
            notes: (contact.notes || "") + `\n\n${skipNotes}`,
          });

          // Fire event so Apex Intelligence learns from this
          publishEventAsync(EVENT_TYPES.CONTACT_UPDATED, {
            subAccountId,
            contactId: contact.id,
            source: "retro_skip_trace",
            hasPhone: !!result.ownerPhone,
            hasEmail: !!result.ownerEmail,
          }, "retro-skip-trace");

          stats.found++;
          console.log(`[RETRO-SKIP-TRACE] ✓ ${contact.id}: ${result.ownerName} | ${result.ownerPhone || "no phone"}`);
        } else {
          await storage.updateContact(contact.id, {
            tags: [...new Set([...(contact.tags || []), "skip-traced", "no-phone"])],
          });
          stats.notFound++;
        }
      } catch (err: any) {
        stats.failed++;
        console.warn(`[RETRO-SKIP-TRACE] Failed for contact ${contact.id}:`, err.message);
      }
    }));

    const pct = Math.round(((i + batch.length) / needsTrace.length) * 100);
    console.log(`[RETRO-SKIP-TRACE] Progress: ${i + batch.length}/${needsTrace.length} (${pct}%) — found: ${stats.found}, not found: ${stats.notFound}, failed: ${stats.failed}`);

    // Don't delay after last batch
    if (i + BATCH_SIZE < needsTrace.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(`[RETRO-SKIP-TRACE] Complete for account ${subAccountId}:`, stats);
  return stats;
}

export async function runRetroSkipTraceAllAccounts(): Promise<void> {
  const { db } = await import("./db");
  const { subAccounts } = await import("@shared/schema");
  const { ne } = await import("drizzle-orm");
  // Only run retro skip trace on accounts that actually use crash/home-service leads
  // Skip accounts that would never receive these lead types
  const { pool } = await import("./db");
  const allAccounts = await db.select({ id: subAccounts.id }).from(subAccounts)
    .where(ne(subAccounts.ownerUserId, "_archived"));
  const eligibleIds: number[] = [];
  for (const acct of allAccounts) {
    const r = await pool.query(
      `SELECT niche, enabled FROM sentinel_config WHERE sub_account_id=$1 LIMIT 1`,
      [acct.id]
    );
    const cfg = r.rows[0];
    // Include: accounts with sentinel enabled, or Apex main (13)
    if (!cfg || cfg.enabled || acct.id === 13 || acct.id === 14) {
      eligibleIds.push(acct.id);
    }
  }
  const ids = eligibleIds;
  console.log(`[RETRO-SKIP-TRACE] Starting for ${ids.length} eligible accounts: ${ids.join(", ")}`);
  for (const accountId of ids) {
    const stats = await runRetroSkipTrace(accountId);
    console.log(`[RETRO-SKIP-TRACE] Account ${accountId}: processed=${stats.processed} found=${stats.found} notFound=${stats.notFound}`);
  }
}

export function startRetroSkipTraceScheduler(): void {
  // Run once on startup after 2 min, then every 6 hours
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
