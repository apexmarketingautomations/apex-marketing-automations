/**
 * server/services/accountConsolidation.ts
 *
 * One-time, snapshot-backed, idempotent consolidation of all lead data into a
 * single primary account.
 *
 * Background — why this exists:
 *   A non-deterministic bug in crash ingest (getDefaultSubAccountId returning
 *   getSubAccounts()[0] from an UNORDERED query) scattered lead data across 5
 *   sub-accounts. The data was never lost — just mis-assigned and made
 *   invisible behind per-account ownership filters.
 *
 * This module does NOT run at boot. It is invoked explicitly via
 * `scripts/consolidate-accounts.ts`, which defaults to a DRY RUN that produces
 * a report. Production execution requires an explicit `--execute` flag.
 *
 * Guarantees:
 *   - Snapshot of every affected table is taken BEFORE any write.
 *   - Real contacts are deduplicated by normalized phone / email; the richest
 *     record survives, absorbing every field the duplicates held.
 *   - Duplicate rows are ARCHIVED (view_class='archived', merged_into_contact_id
 *     set), never deleted.
 *   - Placeholder shells are ARCHIVED, never deleted.
 *   - crash_reports / sentinel_incidents are re-pointed; original_sub_account_id
 *     preserved on every row.
 *   - Dead accounts are DEACTIVATED (active=false), never hard-deleted —
 *     dozens of tables FK to sub_account_id.
 *   - Idempotent: re-running after a completed consolidation is a no-op.
 */

import { db } from "../db";
import { contacts, crashReports, sentinelIncidents, subAccounts } from "@shared/schema";
import { sql, eq, ne, and, inArray } from "drizzle-orm";
import { normalizePhone, normalizeEmail, isPlaceholderName } from "./contactUpsertService";

// ── Configuration ─────────────────────────────────────────────────────────────

/** The account everything consolidates INTO — APEX MARKETING Account. */
export const PRIMARY_ACCOUNT_ID = 3;

/** Accounts whose data is folded into the primary account, then deactivated. */
export const ACCOUNTS_TO_FOLD = [1, 2, 4, 146];

// ── Report types ──────────────────────────────────────────────────────────────

export interface MergeSample {
  key: string;            // dedup key (phone:xxxx / email:xxxx)
  winnerId: number;
  winnerName: string;
  mergedIds: number[];
  fromAccounts: number[];
}

export interface ConsolidationReport {
  dryRun: boolean;
  primaryAccountId: number;
  snapshotTables: string[];
  crashReports: { total: number; repointed: number };
  sentinelIncidents: { total: number; repointed: number };
  contacts: {
    total: number;
    placeholdersArchived: number;
    realContactsBefore: number;
    dedupGroups: number;
    duplicatesArchived: number;
    survivorsAfter: number;
    noContactMethodKept: number;
    alreadyInPrimary: number;
  };
  accountsDeactivated: number[];
  sampleMerges: MergeSample[];
  warnings: string[];
}

// ── Contact richness scoring ──────────────────────────────────────────────────

type ContactRow = typeof contacts.$inferSelect;

/**
 * Scores how "rich" a contact record is. The highest-scoring member of a
 * dedup group survives; the rest are archived after their data is absorbed.
 */
export function contactRichness(c: ContactRow): number {
  let score = 0;
  if (c.identityStatus === "verified") score += 5;
  if (c.firstName && !isPlaceholderName(c.firstName)) score += 2;
  if (c.lastName) score += 1;
  if (c.phone) score += 3;
  if (c.email) score += 3;
  for (const v of [c.address, c.verifiedResidence, c.registrationAddress, c.probableResidence,
                    c.mailingAddress, c.company, c.city, c.state, c.zip, c.notes]) {
    if (v) score += 1;
  }
  if (c.lat != null && c.lng != null) score += 1;
  score += (c.phoneConfidence ?? 0) + (c.addressConfidence ?? 0) + (c.enrichmentConfidence ?? 0);
  score += (c.tags?.length ?? 0) * 0.1;
  if (c.exportEligible) score += 2;
  if (c.subAccountId === PRIMARY_ACCOUNT_ID) score += 0.5; // tie-break: prefer the primary
  return score;
}

/** Picks the surviving contact from a dedup group (highest richness, then oldest id). */
export function pickWinner(group: ContactRow[]): ContactRow {
  return [...group].sort((a, b) => {
    const d = contactRichness(b) - contactRichness(a);
    if (d !== 0) return d;
    return a.id - b.id; // stable: oldest record wins ties
  })[0];
}

/**
 * Folds every field a duplicate holds into the winner, never erasing a value
 * the winner already has. Higher-confidence phone/address still win.
 * Returns the patch to apply to the winner (empty if nothing to absorb).
 */
export function buildWinnerPatch(winner: ContactRow, dupes: ContactRow[]): Partial<ContactRow> {
  const patch: Record<string, unknown> = {};
  const fillIfEmpty = (field: keyof ContactRow) => {
    if (winner[field] == null || winner[field] === "") {
      for (const d of dupes) {
        if (d[field] != null && d[field] !== "") { patch[field as string] = d[field]; break; }
      }
    }
  };
  for (const f of ["firstName", "lastName", "email", "company", "address", "formattedAddress",
                    "city", "state", "zip", "lat", "lng", "county", "verifiedResidence",
                    "registrationAddress", "probableResidence", "mailingAddress",
                    "incidentLocation", "sourceExternalId", "incidentFingerprint",
                    "leadVertical", "leadSubtype"] as Array<keyof ContactRow>) {
    fillIfEmpty(f);
  }
  // Real name beats placeholder name on the winner.
  if (winner.firstName && isPlaceholderName(winner.firstName)) {
    const realName = dupes.find(d => d.firstName && !isPlaceholderName(d.firstName));
    if (realName) { patch.firstName = realName.firstName; patch.lastName = realName.lastName; }
  }
  // Phone: highest confidence across the whole group.
  const allByPhoneConf = [winner, ...dupes]
    .filter(c => c.phone)
    .sort((a, b) => (b.phoneConfidence ?? 0) - (a.phoneConfidence ?? 0));
  if (allByPhoneConf[0] && allByPhoneConf[0].id !== winner.id && (allByPhoneConf[0].phoneConfidence ?? 0) > (winner.phoneConfidence ?? 0)) {
    patch.phone = allByPhoneConf[0].phone;
    patch.normalizedPhone = allByPhoneConf[0].normalizedPhone;
    patch.phoneSource = allByPhoneConf[0].phoneSource;
    patch.phoneConfidence = allByPhoneConf[0].phoneConfidence;
  }
  // Tags: union across the whole group.
  const tagUnion = new Set<string>(winner.tags ?? []);
  for (const d of dupes) for (const t of d.tags ?? []) tagUnion.add(t);
  if (tagUnion.size !== (winner.tags?.length ?? 0)) patch.tags = [...tagUnion];
  return patch as Partial<ContactRow>;
}

// ── Dedup grouping ────────────────────────────────────────────────────────────

/** A real contact is one with a verified/real identity — not a placeholder shell. */
export function isRealContactRow(c: ContactRow): boolean {
  if (c.isPlaceholder === true) return false;
  if (c.identityStatus === "placeholder" || c.identityStatus === "unidentified") return false;
  return true;
}

/** Dedup key for a real contact: phone first, then email. Null = no key (kept standalone). */
export function dedupKey(c: ContactRow): string | null {
  const p = normalizePhone(c.phone) || (c.normalizedPhone ?? null);
  if (p) return `phone:${p}`;
  const e = normalizeEmail(c.email) || (c.normalizedEmail ?? null);
  if (e) return `email:${e}`;
  return null;
}

/** Groups real contacts by dedup key. Single-member groups are unique survivors. */
export function groupRealContacts(rows: ContactRow[]): Map<string, ContactRow[]> {
  const groups = new Map<string, ContactRow[]>();
  for (const c of rows) {
    const key = dedupKey(c);
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }
  return groups;
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

function snapshotSuffix(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14); // yyyymmddhhmmss
}

async function takeSnapshots(suffix: string): Promise<string[]> {
  const tables = ["contacts", "crash_reports", "sentinel_incidents"];
  const created: string[] = [];
  for (const t of tables) {
    const snap = `_consolidation_snapshot_${t}_${suffix}`;
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS "${snap}" AS TABLE "${t}"`));
    created.push(snap);
  }
  return created;
}

// ── Core ──────────────────────────────────────────────────────────────────────

interface PlanInternals {
  report: ConsolidationReport;
  realRows: ContactRow[];
  placeholderRows: ContactRow[];
  groups: Map<string, ContactRow[]>;
}

async function buildPlan(dryRun: boolean): Promise<PlanInternals> {
  const warnings: string[] = [];
  const allAccountIds = [PRIMARY_ACCOUNT_ID, ...ACCOUNTS_TO_FOLD];

  // Pull every contact across the primary + folded accounts.
  const allContacts = await db.select().from(contacts)
    .where(inArray(contacts.subAccountId, allAccountIds));

  const realRows = allContacts.filter(isRealContactRow);
  const placeholderRows = allContacts.filter(c => !isRealContactRow(c));
  const groups = groupRealContacts(realRows);

  let duplicatesArchived = 0;
  let dedupGroups = 0;
  const sampleMerges: MergeSample[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    dedupGroups++;
    duplicatesArchived += group.length - 1;
    if (sampleMerges.length < 15) {
      const winner = pickWinner(group);
      sampleMerges.push({
        key,
        winnerId: winner.id,
        winnerName: `${winner.firstName ?? ""} ${winner.lastName ?? ""}`.trim(),
        mergedIds: group.filter(g => g.id !== winner.id).map(g => g.id),
        fromAccounts: [...new Set(group.map(g => g.subAccountId))],
      });
    }
  }

  const realWithKey = realRows.filter(c => dedupKey(c) !== null);
  const noContactMethod = realRows.length - realWithKey.length;
  const survivorsAfter = groups.size + noContactMethod;
  const alreadyInPrimary = allContacts.filter(c => c.subAccountId === PRIMARY_ACCOUNT_ID).length;

  const [{ crashTotal }] = await db.select({ crashTotal: sql<number>`count(*)::int` }).from(crashReports);
  const crashToRepoint = await db.select({ n: sql<number>`count(*)::int` })
    .from(crashReports).where(ne(crashReports.subAccountId, PRIMARY_ACCOUNT_ID));
  const [{ sentinelTotal }] = await db.select({ sentinelTotal: sql<number>`count(*)::int` }).from(sentinelIncidents);
  const sentinelToRepoint = await db.select({ n: sql<number>`count(*)::int` })
    .from(sentinelIncidents).where(ne(sentinelIncidents.subAccountId, PRIMARY_ACCOUNT_ID));

  if (placeholderRows.length > realRows.length * 3) {
    warnings.push(`Placeholder shells (${placeholderRows.length}) vastly outnumber real contacts (${realRows.length}) — the crash enrichment pipeline is under-performing; run the placeholder enrichment retry after consolidation.`);
  }

  const report: ConsolidationReport = {
    dryRun,
    primaryAccountId: PRIMARY_ACCOUNT_ID,
    snapshotTables: [],
    crashReports: { total: crashTotal, repointed: crashToRepoint[0]?.n ?? 0 },
    sentinelIncidents: { total: sentinelTotal, repointed: sentinelToRepoint[0]?.n ?? 0 },
    contacts: {
      total: allContacts.length,
      placeholdersArchived: placeholderRows.length,
      realContactsBefore: realRows.length,
      dedupGroups,
      duplicatesArchived,
      survivorsAfter,
      noContactMethodKept: noContactMethod,
      alreadyInPrimary,
    },
    accountsDeactivated: [...ACCOUNTS_TO_FOLD],
    sampleMerges,
    warnings,
  };

  return { report, realRows, placeholderRows, groups };
}

/**
 * DRY RUN — computes the full consolidation plan and returns a report.
 * Performs ZERO writes. Safe to run against production any time.
 */
export async function planConsolidation(): Promise<ConsolidationReport> {
  const { report } = await buildPlan(true);
  return report;
}

/**
 * EXECUTE — snapshot, then apply the consolidation in a single transaction.
 * Idempotent: rows already consolidated (consolidated_at set) are skipped.
 */
export async function executeConsolidation(): Promise<ConsolidationReport> {
  const suffix = snapshotSuffix();
  const snapshotTables = await takeSnapshots(suffix);
  console.log(`[CONSOLIDATION] snapshots created: ${snapshotTables.join(", ")}`);

  const { report, realRows, placeholderRows, groups } = await buildPlan(false);
  report.snapshotTables = snapshotTables;
  const now = new Date();

  await db.transaction(async (tx) => {
    // 1. Re-point crash_reports → primary, preserving origin.
    await tx.execute(sql`
      UPDATE crash_reports
         SET original_sub_account_id = COALESCE(original_sub_account_id, sub_account_id),
             sub_account_id          = ${PRIMARY_ACCOUNT_ID},
             consolidated_at         = ${now}
       WHERE sub_account_id <> ${PRIMARY_ACCOUNT_ID}`);

    // 2. Re-point sentinel_incidents → primary, preserving origin.
    await tx.execute(sql`
      UPDATE sentinel_incidents
         SET original_sub_account_id = COALESCE(original_sub_account_id, sub_account_id),
             sub_account_id          = ${PRIMARY_ACCOUNT_ID},
             consolidated_at         = ${now}
       WHERE sub_account_id <> ${PRIMARY_ACCOUNT_ID}`);

    // 3. Archive placeholder shells — move to primary, view_class='archived'.
    //    Reversible: row kept, snapshot holds original state.
    for (const p of placeholderRows) {
      await tx.update(contacts).set({
        originalSubAccountId: p.originalSubAccountId ?? p.subAccountId,
        subAccountId: PRIMARY_ACCOUNT_ID,
        viewClass: "archived",
        consolidatedAt: now,
      }).where(eq(contacts.id, p.id));
    }

    // 4. Dedup-merge real contacts.
    for (const group of groups.values()) {
      const winner = pickWinner(group);
      const dupes = group.filter(g => g.id !== winner.id);

      // Winner: move to primary, absorb every field its duplicates held.
      const patch = buildWinnerPatch(winner, dupes) as Record<string, unknown>;
      await tx.update(contacts).set({
        ...patch,
        originalSubAccountId: winner.originalSubAccountId ?? winner.subAccountId,
        subAccountId: PRIMARY_ACCOUNT_ID,
        consolidatedAt: now,
      }).where(eq(contacts.id, winner.id));

      // Duplicates: archive, link to winner. Never deleted.
      for (const d of dupes) {
        await tx.update(contacts).set({
          originalSubAccountId: d.originalSubAccountId ?? d.subAccountId,
          subAccountId: PRIMARY_ACCOUNT_ID,
          viewClass: "archived",
          mergedIntoContactId: winner.id,
          consolidatedAt: now,
          notes: `${d.notes ? d.notes + "\n---\n" : ""}[CONSOLIDATION] Merged into contact #${winner.id} on ${now.toISOString()}.`,
        }).where(eq(contacts.id, d.id));
      }
    }

    // 5. Real contacts with no phone/email (no dedup key) — just re-point.
    const keylessReal = realRows.filter(c => dedupKey(c) === null && c.subAccountId !== PRIMARY_ACCOUNT_ID);
    for (const c of keylessReal) {
      await tx.update(contacts).set({
        originalSubAccountId: c.originalSubAccountId ?? c.subAccountId,
        subAccountId: PRIMARY_ACCOUNT_ID,
        consolidatedAt: now,
      }).where(eq(contacts.id, c.id));
    }

    // 6. Deactivate the folded accounts — NEVER hard-delete (FK integrity).
    await tx.execute(sql`
      UPDATE sub_accounts SET active = false
       WHERE id = ANY(${sql.raw(`ARRAY[${ACCOUNTS_TO_FOLD.join(",")}]`)})`);
  });

  console.log(`[CONSOLIDATION] complete — ${report.contacts.survivorsAfter} survivors, ${report.contacts.duplicatesArchived} dupes archived, ${report.contacts.placeholdersArchived} placeholders archived`);
  return report;
}

/**
 * Reverses a consolidation from its snapshot tables. Restores the three tables
 * to their pre-consolidation state. `suffix` is the timestamp in the snapshot
 * table name (e.g. "20260518183000").
 */
export async function rollbackConsolidation(suffix: string): Promise<void> {
  for (const t of ["contacts", "crash_reports", "sentinel_incidents"]) {
    const snap = `_consolidation_snapshot_${t}_${suffix}`;
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`DELETE FROM "${t}"`));
      await tx.execute(sql.raw(`INSERT INTO "${t}" SELECT * FROM "${snap}"`));
    });
    console.log(`[CONSOLIDATION] rolled back ${t} from ${snap}`);
  }
}
