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
const SUB_ACCOUNT_IDS = [13, 14]; // Apex main + Giovanni

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
  const apiKey = process.env.BATCH_DATA;
  if (!apiKey) {
    console.error("[RETRO-SKIP-TRACE] BATCH_DATA env var not set");
    return { processed: 0, found: 0, notFound: 0, failed: 0, skipped: 0 };
  }

  const stats: RetroStats = { processed: 0, found: 0, notFound: 0, failed: 0, skipped: 0 };

  console.log(`[RETRO-SKIP-TRACE] Starting retroactive skip trace for account ${subAccountId}`);

  // Get all crash leads with no phone
  const allContacts = await storage.getContacts(subAccountId, { limit: 5000 });
  const needsTrace = allContacts.filter(c =>
    (c.tags || []).includes("crash-lead") && !c.phone && c.address
  );

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

        if (result.ownerPhone || result.ownerName) {
          // Build real name
          let firstName = contact.firstName;
          let lastName = contact.lastName;

          if (result.ownerName) {
            const parts = result.ownerName.trim().split(" ");
            firstName = parts[0] || firstName;
            lastName = parts.slice(1).join(" ") || lastName;
          }

          // Update contact with real data
          await storage.updateContact(contact.id, {
            firstName,
            lastName,
            phone: result.ownerPhone || contact.phone,
            email: result.ownerEmail || contact.email,
            tags: [...new Set([...(contact.tags || []), "skip-traced", result.ownerPhone ? "has-phone" : "no-phone"])],
            notes: (contact.notes || "") + `\n\nSkip Trace Result: ${result.ownerName || "Unknown"} | ${result.ownerPhone || "No phone"} | ${result.ownerEmail || "No email"}`,
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
  console.log("[RETRO-SKIP-TRACE] Starting retroactive skip trace for all accounts...");
  for (const accountId of SUB_ACCOUNT_IDS) {
    const stats = await runRetroSkipTrace(accountId);
    console.log(`[RETRO-SKIP-TRACE] Account ${accountId} done:`, stats);
  }
}
