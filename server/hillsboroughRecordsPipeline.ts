/**
 * Hillsborough County Official Records Bulk Data Pipeline
 *
 * Consumes the FREE, unauthenticated daily bulk files published by the
 * Hillsborough County Clerk of Courts at:
 *   https://publicrec.hillsclerk.com/OfficialRecords/DailyIndexes/
 *
 * File format (pipe-delimited ASCII):
 *   D file: Action|CountyNum|InstrumentNum|DocType|DocDesc|LegalDesc|BookType|BookNum|PageNum|Filler|PageCount|DateRecorded|TimeRecorded|Consideration
 *   P file: Action|CountyNum|InstrumentNum|SeqNum|FrmTo|PartyName
 *   M file: DocType|FACCType  (code → FACC mapping)
 *
 * Target document types:
 *   LP   → LIS PENDENS       → signalType="lis_pendens"    (foreclosure start — real estate attorney)
 *   JUD  → JUDGMENT          → signalType="civil_judgment"  (judgment debtor — bankruptcy/debt attorney)
 *   CCJ  → CERT COPY JUDGMENT → same as JUD
 *
 * Lead flow:
 *   D file LP/JUD rows → match TO-party from P file → skip-trace name → legalSignals + legalLeads → CRM contacts
 *
 * Schedule: daily at 06:00 ET (files typically published by 11 AM but previous
 *           day's files are always available, so we lag 1 day for reliability).
 */

import crypto   from "crypto";
import { db }   from "./db";
import { legalSignals, legalLeads, contacts } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { resolveBatchDataKey } from "./vendorConfig";
import { isBatchDataDisabled } from "./skip-trace";
import { ENRICHMENT_ACCOUNT_IDS } from "./vendorConfig";

const PIPELINE_TAG  = "HILLS-RECORDS";
const BASE_URL      = "https://publicrec.hillsclerk.com/OfficialRecords/DailyIndexes";
const COUNTY        = "HILLSBOROUGH";
const COUNTY_NUM    = "29";    // Hillsborough = 29 in FL county numbering
const POLL_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

// ── Document type → lead type mapping ────────────────────────────────────────

interface DocTypeConfig {
  signalType:    string;
  legalVertical: string;
  urgency:       "high" | "medium" | "low";
  crmTags:       string[];
  description:   string;
}

const TARGET_DOC_TYPES: Record<string, DocTypeConfig> = {
  LP: {
    signalType:    "lis_pendens",
    legalVertical: "real_estate",
    urgency:       "high",
    crmTags:       ["foreclosure-lead", "lis-pendens", "real-estate-attorney", "sentinel-auto"],
    description:   "Lis Pendens — foreclosure action filed",
  },
  JUD: {
    signalType:    "civil_judgment",
    legalVertical: "real_estate",
    urgency:       "medium",
    crmTags:       ["civil-judgment", "debt-defense", "sentinel-auto"],
    description:   "Civil Judgment recorded",
  },
  CCJ: {
    signalType:    "civil_judgment",
    legalVertical: "real_estate",
    urgency:       "medium",
    crmTags:       ["civil-judgment", "debt-defense", "sentinel-auto"],
    description:   "Certified Copy of Court Judgment",
  },
};

// Business entity suffixes — skip "TO" parties that are not individuals
const ENTITY_SUFFIXES = [
  " LLC", " INC", " CORP", " NA", " N.A.", " LP", " LLP", " TRUST",
  " BANK", " ASSOC", " ASSOCIATES", " FOUNDATION", " FUND", " GROUP",
  " PARTNERS", " HOLDINGS", " MANAGEMENT", " SERVICES", " SOLUTIONS",
  " REALTY", " PROPERTIES", " INVESTMENTS", " MORTGAGE", " FINANCIAL",
  " CREDIT", " CAPITAL", " RECOVERY", " COLLECTIVE", " CO.", " COMPANY",
  " GOVERNMENT", " COUNTY", " CITY OF", "U S A", " STATE OF",
];

// ── Utility helpers ───────────────────────────────────────────────────────────
// BatchData key resolved via vendorConfig — single source of truth for all aliases.

/** sha256(county|instrumentNumber) — used as dedup key */
function buildSignalHash(instrumentNumber: string): string {
  return crypto
    .createHash("sha256")
    .update(`${COUNTY}|${instrumentNumber}`)
    .digest("hex");
}

/** YYYY-MM-DD → YYYYMMDD */
function toFileDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** Returns the filename base for a given date. Export number is always "01". */
function buildFilenames(date: Date): { dFile: string; pFile: string } {
  const ds = toFileDate(date);
  return {
    dFile: `D${ds}01id.29`,
    pFile: `P${ds}01id.29`,
  };
}

/** Split "LASTNAME FIRSTNAME MIDDLE" → { firstName, lastName }
 *  Hillsborough records are typically LAST FIRST [MIDDLE] for individuals. */
function splitRecordName(raw: string): { firstName: string; lastName: string } {
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  // Last token that's a single letter → middle initial, drop it
  const clean = parts.filter((p, i) => !(i === parts.length - 1 && p.length === 1));
  const lastName  = clean[0] ?? "";
  const firstName = clean.slice(1).join(" ");
  return { firstName, lastName };
}

/** True if the name looks like a business / government entity */
function isEntityName(name: string): boolean {
  const upper = name.toUpperCase();
  return ENTITY_SUFFIXES.some(s => upper.includes(s.toUpperCase()));
}

// ── Skip trace ────────────────────────────────────────────────────────────────

async function lookupExistingPhone(firstName: string, lastName: string): Promise<string | null> {
  const fn = firstName.trim().toLowerCase();
  const ln = lastName.trim().toLowerCase();
  try {
    const [contact] = await db.select({ phone: contacts.phone })
      .from(contacts)
      .where(sql`lower(first_name) = ${fn} AND lower(last_name) = ${ln} AND phone IS NOT NULL`)
      .limit(1);
    if (contact?.phone) return contact.phone;

    const fullName = `${firstName} ${lastName}`.trim();
    const [signal] = await db.select({ subjectPhone: legalSignals.subjectPhone })
      .from(legalSignals)
      .where(sql`lower(subject_name) = lower(${fullName}) AND subject_phone IS NOT NULL`)
      .limit(1);
    return signal?.subjectPhone ?? null;
  // allow-silent-catch: DB lookup failure falls through to fresh skip trace
  } catch {
    return null;
  }
}

async function skipTraceName(firstName: string, lastName: string): Promise<string | null> {
  const existing = await lookupExistingPhone(firstName, lastName);
  if (existing) return existing;

  if (isBatchDataDisabled()) return null;
  const key = resolveBatchDataKey();
  if (!key) return null;
  try {
    const res = await fetch("https://api.batchdata.com/api/v1/property/skip-trace/name", {
      method:  "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ firstName, lastName, state: "FL" }),
      signal:  AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return (
      data?.results?.[0]?.phones?.[0]?.number ||
      data?.results?.[0]?.phone ||
      data?.phone ||
      null
    );
  // allow-silent-catch: skip trace failure is non-fatal — returns null
  } catch {
    return null;
  }
}

// ── File download & parse ─────────────────────────────────────────────────────

interface DRecord {
  instrumentNumber: string;
  docType:          string;
  docDescription:   string;
  legalDescription: string;
  dateRecorded:     string;
  consideration:    string | null;
}

interface PRecord {
  instrumentNumber: string;
  seqNum:           string;
  frmTo:            "FRM" | "TO" | string;
  partyName:        string;
}

async function fetchFile(filename: string): Promise<string | null> {
  const url = `${BASE_URL}/${filename}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      console.warn(`[${PIPELINE_TAG}] ${filename} → HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err: any) {
    console.warn(`[${PIPELINE_TAG}] ${filename} fetch error: ${err.message}`);
    return null;
  }
}

function parseDFile(raw: string): DRecord[] {
  const records: DRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split("|");
    // Action | CountyNum | InstrumentNum | DocType | DocDesc | LegalDesc | BookType | BookNum | PageNum | Filler | PageCount | DateRecorded | TimeRecorded | Consideration
    if (cols.length < 12) continue;
    const [action, countyNum, instrumentNumber, docType, docDescription, legalDescription, , , , , , dateRecorded, , consideration] = cols;
    if (action !== "DDA" && action !== "DUP") continue; // DDA=add, DUP=update
    if (countyNum !== COUNTY_NUM) continue;
    if (!TARGET_DOC_TYPES[docType]) continue; // only target types
    records.push({ instrumentNumber, docType, docDescription, legalDescription, dateRecorded, consideration: consideration || null });
  }
  return records;
}

function parsePFile(raw: string): PRecord[] {
  const records: PRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split("|");
    // Action | CountyNum | InstrumentNum | SeqNum | FrmTo | PartyName
    if (cols.length < 6) continue;
    const [action, countyNum, instrumentNumber, seqNum, frmTo, partyName] = cols;
    if (action !== "DPA" && action !== "DUP") continue;
    if (countyNum !== COUNTY_NUM) continue;
    records.push({ instrumentNumber, seqNum, frmTo, partyName: partyName?.trim() || "" });
  }
  return records;
}

/** Build a lookup map: instrumentNumber → { FRM: string[], TO: string[] } */
function buildPartyIndex(pRecords: PRecord[]): Map<string, { frm: string[]; to: string[] }> {
  const index = new Map<string, { frm: string[]; to: string[] }>();
  for (const p of pRecords) {
    if (!index.has(p.instrumentNumber)) index.set(p.instrumentNumber, { frm: [], to: [] });
    const entry = index.get(p.instrumentNumber)!;
    if (p.frmTo === "FRM") entry.frm.push(p.partyName);
    else if (p.frmTo === "TO") entry.to.push(p.partyName);
  }
  return index;
}

// ── Dedup check ───────────────────────────────────────────────────────────────

async function isDuplicate(hash: string): Promise<boolean> {
  const rows = await db
    .select({ id: legalSignals.id })
    .from(legalSignals)
    .where(eq(legalSignals.sourceHash, hash))
    .limit(1);
  return rows.length > 0;
}

// ── CRM contact delivery ──────────────────────────────────────────────────────

async function getAllEnabledAccountIds(): Promise<number[]> {
  try {
    const { pool } = await import("./db");
    const r = await pool.query(
      "SELECT sub_account_id FROM sentinel_config WHERE enabled = true LIMIT 200"
    );
    const ids: number[] = r.rows.map((row: { sub_account_id: number }) => row.sub_account_id);
    return ids.filter(id => ENRICHMENT_ACCOUNT_IDS.has(id));
  // allow-silent-catch: fallback to parent account on DB error
  } catch {
    return [parseInt(process.env.APEX_PARENT_ACCOUNT_ID || "3")];
  }
}

async function deliverToAccounts(params: {
  firstName:        string;
  lastName:         string;
  phone:            string | null;
  docConfig:        DocTypeConfig;
  instrumentNumber: string;
  dateRecorded:     string;
  legalDescription: string;
  plaintiff:        string;
  caseNumber:       string | null;
}): Promise<number> {
  const accountIds = await getAllEnabledAccountIds();
  const { storage }  = await import("./storage");

  let delivered = 0;
  for (const subAccountId of accountIds) {
    try {
      const notes = [
        `${params.docConfig.description} — Hillsborough County, FL`,
        `Instrument #: ${params.instrumentNumber}`,
        `Date Recorded: ${params.dateRecorded}`,
        params.plaintiff ? `Plaintiff/Creditor: ${params.plaintiff}` : null,
        params.caseNumber ? `Case/Reference #: ${params.caseNumber}` : null,
        params.legalDescription ? `Property: ${params.legalDescription}` : null,
        `Source: publicrec.hillsclerk.com`,
      ].filter(Boolean).join("\n");

      await storage.createContact({
        subAccountId,
        firstName: params.firstName,
        lastName:  params.lastName,
        phone:     params.phone || undefined,
        source:    "hillsborough_official_records",
        channel:   "automated",
        tags:      params.docConfig.crmTags,
        notes,
        state:     "FL",
      });
      delivered++;

      // Report to Apex Intelligence brain
      import("./operator/apexIntelligence").then(({ reportOutcome }) =>
        reportOutcome({
          agentName:    "hillsborough-records",
          action:       "contact_created",
          subject:      `${params.firstName} ${params.lastName}`.trim(),
          result:       `${params.docConfig.signalType} lead routed — Hillsborough County (${params.instrumentNumber})`,
          confidence:   params.docConfig.urgency === "high" ? 0.75 : 0.55,
          subAccountId,
          niche:        params.docConfig.legalVertical,
          metadata: {
            instrumentNumber: params.instrumentNumber,
            docType:          params.docConfig.signalType,
            county:           COUNTY,
            hasPhone:         !!params.phone,
          },
        })
      ).catch((e: any) => console.warn("[APEX-OUTCOME] hillsborough-records reportOutcome error:", e?.message));
    } catch (err: any) {
      console.warn(`[${PIPELINE_TAG}] createContact failed (account=${subAccountId}): ${err.message}`);
    }
  }
  return delivered;
}

// ── Main processing cycle ─────────────────────────────────────────────────────

interface CycleStats {
  date:       string;
  scraped:    number;
  inserted:   number;
  skipped:    number;
  errors:     number;
  contacts:   number;
}

async function processDayFiles(targetDate: Date): Promise<CycleStats> {
  const { dFile, pFile } = buildFilenames(targetDate);
  const dateStr          = toFileDate(targetDate);

  console.log(`[${PIPELINE_TAG}] Processing ${dateStr} — D=${dFile} P=${pFile}`);

  const [dRaw, pRaw] = await Promise.all([fetchFile(dFile), fetchFile(pFile)]);
  if (!dRaw || !pRaw) {
    console.warn(`[${PIPELINE_TAG}] Missing files for ${dateStr} — skipping`);
    return { date: dateStr, scraped: 0, inserted: 0, skipped: 0, errors: 0, contacts: 0 };
  }

  const dRecords   = parseDFile(dRaw);
  const pRecords   = parsePFile(pRaw);
  const partyIndex = buildPartyIndex(pRecords);

  console.log(`[${PIPELINE_TAG}] ${dateStr}: ${dRecords.length} target-type D records, ${pRecords.length} party records`);

  const stats: CycleStats = { date: dateStr, scraped: dRecords.length, inserted: 0, skipped: 0, errors: 0, contacts: 0 };

  for (const dRec of dRecords) {
    try {
      const hash = buildSignalHash(dRec.instrumentNumber);
      if (await isDuplicate(hash)) { stats.skipped++; continue; }

      const dc = TARGET_DOC_TYPES[dRec.docType];
      const parties = partyIndex.get(dRec.instrumentNumber) ?? { frm: [], to: [] };

      // Find an individual defendant (TO party)
      const individualDefendant = parties.to.find(name => name && !isEntityName(name));
      const plaintiff = parties.frm.find(Boolean) ?? "";

      // For LP/JUD we need an identifiable individual
      if (!individualDefendant) { stats.skipped++; continue; }

      const { firstName, lastName } = splitRecordName(individualDefendant);
      if (!firstName && !lastName) { stats.skipped++; continue; }

      // Skip trace
      const phone = await skipTraceName(firstName, lastName);

      // Infer case number from legal description (often formatted "25 CC 001234")
      const caseNumMatch = dRec.legalDescription?.match(/\d{2}\s*[A-Z]{2}\s*\d{4,}/);
      const caseNumber   = caseNumMatch?.[0]?.replace(/\s+/g, " ").trim() ?? null;

      // Score: LP = 75 (high urgency, actionable), JUD/CCJ = 55
      const score = dRec.docType === "LP" ? 75 : 55;

      // ── Insert legalSignal ─────────────────────────────────────────────────
      const [signal] = await db
        .insert(legalSignals)
        .values({
          sourceHash:       hash,
          signalType:       dc.signalType,
          legalVertical:    dc.legalVertical,
          county:           COUNTY,
          state:            "FL",
          subjectName:      `${firstName} ${lastName}`.trim(),
          subjectPhone:     phone ?? undefined,
          chargeDescription: dc.description,
          caseNumber:       caseNumber ?? undefined,
          filingDate:       dRec.dateRecorded ? new Date(dRec.dateRecorded) : new Date(),
          urgency:          dc.urgency,
          score,
          status:           "raw",
          rawData: {
            instrumentNumber: dRec.instrumentNumber,
            docType:          dRec.docType,
            docDescription:   dRec.docDescription,
            legalDescription: dRec.legalDescription,
            dateRecorded:     dRec.dateRecorded,
            consideration:    dRec.consideration,
            plaintiff,
            defendant:        individualDefendant,
            allToParties:     parties.to,
            source:           `publicrec.hillsclerk.com`,
          },
        })
        .returning({ id: legalSignals.id });

      // ── Insert legalLead ───────────────────────────────────────────────────
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (dRec.docType === "LP" ? 21 : 45));

      const [lead] = await db
        .insert(legalLeads)
        .values({
          signalId:         signal.id,
          legalVertical:    dc.legalVertical,
          signalType:       dc.signalType,
          county:           COUNTY,
          subjectName:      `${firstName} ${lastName}`.trim(),
          subjectPhone:     phone ?? undefined,
          chargeDescription: dc.description,
          caseNumber:       caseNumber ?? undefined,
          urgency:          dc.urgency,
          score,
          status:           "available",
          expiresAt,
          rawData: { instrumentNumber: dRec.instrumentNumber, docType: dRec.docType, plaintiff },
        })
        .returning({ id: legalLeads.id });

      stats.inserted++;

      // ── Deliver to CRM ─────────────────────────────────────────────────────
      const delivered = await deliverToAccounts({
        firstName,
        lastName,
        phone,
        docConfig:        dc,
        instrumentNumber: dRec.instrumentNumber,
        dateRecorded:     dRec.dateRecorded,
        legalDescription: dRec.legalDescription,
        plaintiff,
        caseNumber,
      });
      stats.contacts += delivered;

      console.log(
        `[${PIPELINE_TAG}] ✅ ${dRec.docType} | ${individualDefendant} | ${dRec.instrumentNumber}` +
        `${phone ? " | phone ✓" : ""} | accounts=${delivered}`
      );
    } catch (err: any) {
      stats.errors++;
      console.error(`[${PIPELINE_TAG}] Error processing ${dRec.instrumentNumber}: ${err.message}`);
    }
  }

  return stats;
}

// ── Stats tracking ────────────────────────────────────────────────────────────

let _lastRunAt:         Date | null = null;
let _lastCycleInserted: number      = 0;
let _lastCycleSkipped:  number      = 0;
let _lastCycleErrors:   number      = 0;
let _totalInsertedEver: number      = 0;

export function getHillsboroughRecordsPipelineStats() {
  return {
    lastRunAt:          _lastRunAt?.toISOString()   ?? null,
    lastCycleInserted:  _lastCycleInserted,
    lastCycleSkipped:   _lastCycleSkipped,
    lastCycleErrors:    _lastCycleErrors,
    totalInsertedEver:  _totalInsertedEver,
    batchDataAvailable: !!resolveBatchDataKey(),
    county:             COUNTY,
  };
}

// ── Main run function (exported for manual trigger) ───────────────────────────

export async function runHillsboroughRecordsCycle(opts?: {
  daysBack?: number;
}): Promise<CycleStats[]> {
  _lastRunAt = new Date();
  const daysBack = opts?.daysBack ?? 1;
  const results: CycleStats[] = [];

  for (let i = daysBack; i >= 1; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const stats = await processDayFiles(d);
    results.push(stats);
    _lastCycleInserted += stats.inserted;
    _lastCycleSkipped  += stats.skipped;
    _lastCycleErrors   += stats.errors;
    _totalInsertedEver += stats.inserted;
  }

  console.log(
    `[${PIPELINE_TAG}] Cycle complete — ` +
    `inserted=${_lastCycleInserted} skipped=${_lastCycleSkipped} ` +
    `errors=${_lastCycleErrors} contacts=${results.reduce((s, r) => s + r.contacts, 0)}`
  );
  return results;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _schedulerStarted = false;

export function startHillsboroughRecordsScheduler(): void {
  if (_schedulerStarted) return;
  _schedulerStarted = true;

  console.log(`[${PIPELINE_TAG}] Starting scheduler — daily at 06:00 ET`);

  // Align to next 06:00 ET, then repeat every 24h
  function scheduleNext() {
    const now     = new Date();
    const next    = new Date(now);
    next.setUTCHours(11, 0, 0, 0); // 11:00 UTC = 06:00 ET (EST) / 07:00 ET (EDT)
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const delay = next.getTime() - now.getTime();
    console.log(
      `[${PIPELINE_TAG}] Next run in ${Math.round(delay / 60_000)} min ` +
      `(${next.toISOString()})`
    );
    setTimeout(async () => {
      try {
        // Reset per-cycle counters
        _lastCycleInserted = 0;
        _lastCycleSkipped  = 0;
        _lastCycleErrors   = 0;
        await runHillsboroughRecordsCycle({ daysBack: 1 });
      } catch (err: any) {
        console.error(`[${PIPELINE_TAG}] Scheduler error: ${err.message}`);
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}
