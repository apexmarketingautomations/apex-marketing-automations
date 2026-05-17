// @ts-nocheck
/**
 * Hillsborough County Daily Court Filings Pipeline
 *
 * Consumes FREE, unauthenticated daily court filing CSVs published by the
 * Hillsborough County Clerk at publicrec.hillsclerk.com:
 *
 *   CivilFiling_YYYYMMDD.csv   — Civil + Family Law (CaseCategory = "CV" | "FAM")
 *     https://publicrec.hillsclerk.com/DailyNewCaseFilings/CivilandFamilyLaw/
 *
 *   ProbateFiling_YYYYMMDD.csv — Probate + Guardianship (CaseCategory = "PR")
 *     https://publicrec.hillsclerk.com/Probate/dailyfilings/
 *
 *   CriminalFiling_YYYYMMDD.csv — Criminal court filings (CaseCategory = "CR")
 *     https://publicrec.hillsclerk.com/Criminal/dailyfilings/
 *
 * CSV schema (civil/criminal):
 *   CaseCategory, CaseTypeDescription, CaseNumber, Title, FilingDate,
 *   ChargeNumber (criminal), ChargeOffenseDescription (criminal),
 *   PartyType, FirstName, MiddleName, LastName, PartyAddress, Attorney
 *
 * CSV schema (probate):
 *   same + DateofDeath column between LastName and PartyAddress
 *
 * Target rules:
 *   FAM rows  → Respondent with "No Attorney" (divorce/custody — urgent, unrepresented)
 *   PR rows   → Petitioner with "No Attorney" (probate — needs estate attorney)
 *   CV rows   → Defendant in Mortgage Foreclosure cases (real estate attorney)
 *   CR rows   → Defendant with "No Attorney", felony/DUI charges (criminal defense attorney)
 *
 * Lead flow:
 *   CSV rows → filter → address-enhanced skip trace (address already in CSV)
 *   → legalSignals + legalLeads → CRM contacts tagged by vertical
 *
 * Schedule: daily at 07:00 ET (files published overnight/early morning)
 */

import crypto from "crypto";
import { db }  from "./db";
import { legalSignals, legalLeads } from "@shared/schema";
import { eq } from "drizzle-orm";
import { resolveBatchDataKey } from "./vendorConfig";

const PIPELINE_TAG = "HILLS-FILINGS";
const COUNTY       = "HILLSBOROUGH";

const CIVIL_FILING_BASE    = "https://publicrec.hillsclerk.com/DailyNewCaseFilings/CivilandFamilyLaw";
const PROBATE_FILING_BASE  = "https://publicrec.hillsclerk.com/Probate/dailyfilings";
const CRIMINAL_FILING_BASE = "https://publicrec.hillsclerk.com/Criminal/dailyfilings";

// ── Case type → lead configuration ───────────────────────────────────────────

interface CaseTypeConfig {
  signalType:    string;
  legalVertical: string;
  urgency:       "high" | "medium" | "low";
  crmTags:       string[];
  targetParty:   "Respondent" | "Defendant" | "Petitioner";
  noAttorneyOnly: boolean; // only target parties without representation
}

const FAMILY_CASE_TYPES: Record<string, CaseTypeConfig> = {
  "Dissolution of Marriage with Children": {
    signalType: "divorce_filing", legalVertical: "family", urgency: "high",
    crmTags: ["divorce-lead", "child-custody", "family-law-attorney", "sentinel-auto"],
    targetParty: "Respondent", noAttorneyOnly: true,
  },
  "Dissolution of Marriage": {
    signalType: "divorce_filing", legalVertical: "family", urgency: "medium",
    crmTags: ["divorce-lead", "family-law-attorney", "sentinel-auto"],
    targetParty: "Respondent", noAttorneyOnly: true,
  },
  "Simplified Dissolution": {
    signalType: "divorce_filing", legalVertical: "family", urgency: "low",
    crmTags: ["divorce-lead", "family-law-attorney", "sentinel-auto"],
    targetParty: "Respondent", noAttorneyOnly: true,
  },
  "Declaration of Paternity (Non-DOR)": {
    signalType: "custody_modification", legalVertical: "family", urgency: "medium",
    crmTags: ["paternity-lead", "child-support", "family-law-attorney", "sentinel-auto"],
    targetParty: "Respondent", noAttorneyOnly: false,
  },
  "Modification of Final Judgment": {
    signalType: "custody_modification", legalVertical: "family", urgency: "medium",
    crmTags: ["custody-modification", "family-law-attorney", "sentinel-auto"],
    targetParty: "Respondent", noAttorneyOnly: true,
  },
  "Petition for Injunction for Protection Against Domestic Violence": {
    signalType: "domestic_violence_injunction", legalVertical: "family", urgency: "high",
    crmTags: ["domestic-violence", "injunction-defense", "family-law-attorney", "sentinel-auto"],
    targetParty: "Respondent", noAttorneyOnly: false,
  },
  "Domestic Violence Injunction": {
    signalType: "domestic_violence_injunction", legalVertical: "family", urgency: "high",
    crmTags: ["domestic-violence", "injunction-defense", "family-law-attorney", "sentinel-auto"],
    targetParty: "Respondent", noAttorneyOnly: false,
  },
};

// Family law case types matched by keyword (for partial matches)
const FAMILY_KEYWORDS: { keyword: string; config: CaseTypeConfig }[] = [
  { keyword: "Dissolution of Marriage with Children", config: FAMILY_CASE_TYPES["Dissolution of Marriage with Children"] },
  { keyword: "Dissolution of Marriage",               config: FAMILY_CASE_TYPES["Dissolution of Marriage"] },
  { keyword: "Simplified Dissolution",                config: FAMILY_CASE_TYPES["Simplified Dissolution"] },
  { keyword: "Paternity",                             config: FAMILY_CASE_TYPES["Declaration of Paternity (Non-DOR)"] },
  { keyword: "Modification of Final Judgment",        config: FAMILY_CASE_TYPES["Modification of Final Judgment"] },
  { keyword: "Domestic Violence",                     config: FAMILY_CASE_TYPES["Domestic Violence Injunction"] },
  { keyword: "Injunction for Protection",             config: FAMILY_CASE_TYPES["Petition for Injunction for Protection Against Domestic Violence"] },
];

const PROBATE_CASE_TYPES: Record<string, CaseTypeConfig> = {
  "Formal Administration": {
    signalType: "probate_filing", legalVertical: "estate", urgency: "medium",
    crmTags: ["probate-lead", "estate-administration", "estate-attorney", "sentinel-auto"],
    targetParty: "Petitioner", noAttorneyOnly: true,
  },
  "Summary Administration": {
    signalType: "probate_filing", legalVertical: "estate", urgency: "low",
    crmTags: ["probate-lead", "estate-administration", "estate-attorney", "sentinel-auto"],
    targetParty: "Petitioner", noAttorneyOnly: true,
  },
  "Guardianship": {
    signalType: "probate_filing", legalVertical: "estate", urgency: "high",
    crmTags: ["guardianship-lead", "elder-law-attorney", "sentinel-auto"],
    targetParty: "Petitioner", noAttorneyOnly: false,
  },
};

// Civil foreclosure — keyword match
const FORECLOSURE_KEYWORDS = [
  "Mortgage Foreclosure",
  "Homeowners Association Foreclosure",
  "Condominium Association Foreclosure",
  "Tax Certificate Foreclosure",
];

// ── Criminal case type → lead config ─────────────────────────────────────────

interface CriminalCaseConfig {
  signalType:    string;
  legalVertical: string;
  urgency:       "high" | "medium" | "low";
  crmTags:       string[];
}

const CRIMINAL_CATEGORY_CONFIGS: Record<string, CriminalCaseConfig> = {
  "FELONY DRUG OFFENSE": {
    signalType: "arrest", legalVertical: "criminal", urgency: "high",
    crmTags: ["criminal-defense", "drug-charge", "felony", "sentinel-auto"],
  },
  "FELONY CRIMES AGAINST A PERSON": {
    signalType: "arrest", legalVertical: "criminal", urgency: "high",
    crmTags: ["criminal-defense", "crimes-against-person", "felony", "sentinel-auto"],
  },
  "FELONY DUI": {
    signalType: "dui_arrest", legalVertical: "criminal", urgency: "high",
    crmTags: ["dui-defense", "criminal-defense", "felony", "sentinel-auto"],
  },
  "FELONY OTHER FELONY": {
    signalType: "arrest", legalVertical: "criminal", urgency: "high",
    crmTags: ["criminal-defense", "felony", "sentinel-auto"],
  },
  "MISDEMEANOR DUI": {
    signalType: "dui_arrest", legalVertical: "criminal", urgency: "high",
    crmTags: ["dui-defense", "criminal-defense", "sentinel-auto"],
  },
  "MISDEMEANOR": {
    signalType: "arrest", legalVertical: "criminal", urgency: "medium",
    crmTags: ["criminal-defense", "misdemeanor", "sentinel-auto"],
  },
};

function getCriminalConfig(caseType: string): CriminalCaseConfig {
  // Exact match first
  if (CRIMINAL_CATEGORY_CONFIGS[caseType]) return CRIMINAL_CATEGORY_CONFIGS[caseType];
  // DUI keyword
  if (caseType.includes("DUI") || caseType.includes("DRUNK")) return CRIMINAL_CATEGORY_CONFIGS["FELONY DUI"];
  // Felony vs misdemeanor
  if (caseType.startsWith("FELONY")) return CRIMINAL_CATEGORY_CONFIGS["FELONY OTHER FELONY"];
  return CRIMINAL_CATEGORY_CONFIGS["MISDEMEANOR"];
}

// Case types to skip entirely (fugitive, minor traffic, animal)
const SKIP_CRIMINAL_TYPES = ["FUGITIVE", "ANIMAL", "CIVIL TRAFFIC", "COUNTY ORDINANCE"];

// ── Helpers ───────────────────────────────────────────────────────────────────
// BatchData key resolved via vendorConfig — single source of truth for all aliases.

function toFileDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function buildSignalHash(caseNumber: string, partyType: string, lastName: string): string {
  return crypto
    .createHash("sha256")
    .update(`${COUNTY}|${caseNumber}|${partyType}|${lastName}`)
    .digest("hex");
}

function isEntityName(name: string): boolean {
  const upper = name.toUpperCase();
  const suffixes = [" LLC", " INC", " CORP", " TRUST", " BANK", " N.A.", " NA", " LP", " LLP",
    " ASSOC", " ASSOCIATES", " FUND", " GROUP", " PARTNERS", " HOLDINGS", "COMPANY", " CO.",
    " MORTGAGE", " FINANCIAL", " SERVICES", "GOVERNMENT", " COUNTY", " CITY OF", "U S A",
    "RECOVERY", " CAPITAL", " CREDIT"];
  return suffixes.some(s => upper.includes(s.toUpperCase()));
}

// ── CSV parsing ───────────────────────────────────────────────────────────────

interface FilingRow {
  caseCategory:      string;
  caseType:          string;
  caseNumber:        string;
  title:             string;
  filingDate:        string;
  partyType:         string;
  firstName:         string;
  middleName:        string;
  lastName:          string;
  partyAddress:      string;
  attorney:          string;
  dateOfDeath?:      string; // probate only
  chargeDescription?: string; // criminal only — aggregated from multiple charge rows
}

/** Parse a CSV line respecting double-quoted fields (including quoted commas). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCivilCSV(raw: string): FilingRow[] {
  const lines  = raw.split(/\r?\n/).filter(l => l.trim() && !l.startsWith("CaseCategory"));
  const rows: FilingRow[] = [];
  for (const line of lines) {
    const cols = parseCsvLine(line);
    if (cols.length < 11) continue;
    rows.push({
      caseCategory: cols[0],
      caseType:     cols[1],
      caseNumber:   cols[2],
      title:        cols[3],
      filingDate:   cols[4],
      partyType:    cols[5],
      firstName:    cols[6],
      middleName:   cols[7],
      lastName:     cols[8],
      partyAddress: cols[9],
      attorney:     cols[10],
    });
  }
  return rows;
}

function parseProbateCSV(raw: string): FilingRow[] {
  const lines  = raw.split(/\r?\n/).filter(l => l.trim() && !l.startsWith("CaseCategory"));
  const rows: FilingRow[] = [];
  for (const line of lines) {
    const cols = parseCsvLine(line);
    if (cols.length < 12) continue;
    // Probate has DateofDeath at index 9, shifting PartyAddress to 10, Attorney to 11
    rows.push({
      caseCategory: cols[0],
      caseType:     cols[1],
      caseNumber:   cols[2],
      title:        cols[3],
      filingDate:   cols[4],
      partyType:    cols[5],
      firstName:    cols[6],
      middleName:   cols[7],
      lastName:     cols[8],
      dateOfDeath:  cols[9],
      partyAddress: cols[10],
      attorney:     cols[11],
    });
  }
  return rows;
}

/** Criminal CSV schema:
 *  CaseCategory, CaseTypeDescription, CaseNumber, Title, FilingDate,
 *  ChargeNumber, ChargeOffenseDescription, PartyType,
 *  FirstName, MiddleName, LastName, PartyAddress, Attorney
 *
 * Returns one FilingRow per unique CaseNumber (first row = representative row,
 * chargeDescription aggregated from all charge rows). */
function parseCriminalCSV(raw: string): FilingRow[] {
  const lines = raw.split(/\r?\n/).filter(l => l.trim() && !l.startsWith("CaseCategory"));

  // First pass: collect all rows
  const allRows: (FilingRow & { chargeDesc: string })[] = [];
  for (const line of lines) {
    const cols = parseCsvLine(line);
    if (cols.length < 13) continue;
    // cols: 0=cat, 1=caseType, 2=caseNum, 3=title, 4=filingDate,
    //       5=chargeNum, 6=chargeDesc, 7=partyType,
    //       8=firstName, 9=middleName, 10=lastName, 11=address, 12=attorney
    allRows.push({
      caseCategory: cols[0],
      caseType:     cols[1],
      caseNumber:   cols[2],
      title:        cols[3],
      filingDate:   cols[4],
      partyType:    cols[7],
      firstName:    cols[8],
      middleName:   cols[9],
      lastName:     cols[10],
      partyAddress: cols[11],
      attorney:     cols[12],
      chargeDesc:   cols[6],
    });
  }

  // Deduplicate by caseNumber — one FilingRow per case/defendant
  // Aggregate charge descriptions for the chargeDescription field
  const caseMap = new Map<string, FilingRow & { charges: string[] }>();
  for (const row of allRows) {
    const key = `${row.caseNumber}|${row.lastName}|${row.firstName}`;
    if (!caseMap.has(key)) {
      caseMap.set(key, { ...row, charges: [row.chargeDesc].filter(Boolean) });
    } else {
      const existing = caseMap.get(key)!;
      if (row.chargeDesc && !existing.charges.includes(row.chargeDesc)) {
        existing.charges.push(row.chargeDesc);
      }
    }
  }

  // Return one FilingRow per case with combined charge description
  return Array.from(caseMap.values()).map(r => ({
    ...r,
    chargeDescription: r.charges.slice(0, 5).join("; "), // cap at 5 charges in description
  }));
}

// ── File fetch ────────────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      console.warn(`[${PIPELINE_TAG}] ${url} → HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err: any) {
    console.warn(`[${PIPELINE_TAG}] Fetch error (${url}): ${err.message}`);
    return null;
  }
}

// ── Skip trace ────────────────────────────────────────────────────────────────

/** Parse "123 Main St, Tampa, FL 33601" → { street, city, state, zip } */
function parseAddress(raw: string): { street: string; city: string; state: string; zip: string } | null {
  if (!raw || raw === "unknown" || raw.toLowerCase().includes("unknown")) return null;
  // Format: "123 Elm St, City, FL 33601" or "123 Elm St, City, FL 33601-1234"
  const parts = raw.split(",").map(s => s.trim());
  if (parts.length < 3) return null;
  const street = parts[0];
  const city   = parts[parts.length - 2] || "";
  const statePart = parts[parts.length - 1] || "";
  const stateZip  = statePart.trim().split(/\s+/);
  const state  = stateZip[0] || "FL";
  const zip    = stateZip[1] || "";
  return { street, city, state, zip };
}

async function skipTraceByAddress(
  firstName: string,
  lastName: string,
  address: string,
): Promise<string | null> {
  const key = resolveBatchDataKey();
  if (!key) return null;

  const addr = parseAddress(address);

  try {
    // Try address-based skip trace first (more accurate)
    if (addr) {
      const { skipTraceLookup } = await import("./skip-trace");
      const result = await skipTraceLookup(
        {
          ownerName: `${firstName} ${lastName}`.trim(),
          address:   addr.street,
          city:      addr.city,
          state:     addr.state,
          zip:       addr.zip,
        },
        key
      );
      if (result.ownerPhone) return result.ownerPhone;
    }

    // Fall back to name-only
    const res = await fetch("https://api.batchdata.com/api/v1/property/skip-trace/name", {
      method:  "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ firstName, lastName, state: "FL" }),
      signal:  AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.results?.[0]?.phones?.[0]?.number || data?.results?.[0]?.phone || null;
  // allow-silent-catch: skip trace failure is non-fatal — returns null
  } catch {
    return null;
  }
}

// ── Dedup ─────────────────────────────────────────────────────────────────────

async function isDuplicate(hash: string): Promise<boolean> {
  const rows = await db
    .select({ id: legalSignals.id })
    .from(legalSignals)
    .where(eq(legalSignals.sourceHash, hash))
    .limit(1);
  return rows.length > 0;
}

// ── CRM delivery ──────────────────────────────────────────────────────────────

async function getAllEnabledAccountIds(): Promise<number[]> {
  try {
    const { pool } = await import("./db");
    const r = await pool.query(
      "SELECT sub_account_id FROM sentinel_config WHERE enabled = true LIMIT 200"
    );
    return r.rows.map((row: { sub_account_id: number }) => row.sub_account_id);
  // allow-silent-catch: fallback to parent account on DB error
  } catch {
    return [parseInt(process.env.APEX_PARENT_ACCOUNT_ID || "3")];
  }
}

async function deliverToAccounts(params: {
  firstName:   string;
  lastName:    string;
  phone:       string | null;
  address:     string;
  config:      CaseTypeConfig;
  caseNumber:  string;
  caseType:    string;
  title:       string;
  filingDate:  string;
}): Promise<number> {
  const accountIds = await getAllEnabledAccountIds();
  const { storage }  = await import("./storage");
  let delivered = 0;

  for (const subAccountId of accountIds) {
    try {
      const notes = [
        `${params.caseType} — Hillsborough County, FL`,
        `Case #: ${params.caseNumber}`,
        `Filing Date: ${params.filingDate}`,
        `Case Style: ${params.title}`,
        params.address ? `Address: ${params.address}` : null,
        `Source: publicrec.hillsclerk.com/DailyNewCaseFilings`,
      ].filter(Boolean).join("\n");

      await storage.createContact({
        subAccountId,
        firstName: params.firstName,
        lastName:  params.lastName,
        phone:     params.phone || undefined,
        source:    "hillsborough_court_filings",
        channel:   "automated",
        tags:      params.config.crmTags,
        notes,
        address:   params.address || undefined,
        state:     "FL",
      });
      delivered++;

      // Report to Apex Intelligence brain
      import("./operator/apexIntelligence").then(({ reportOutcome }) =>
        reportOutcome({
          agentName:    "hillsborough-filings",
          action:       "contact_created",
          subject:      `${params.firstName} ${params.lastName}`.trim(),
          result:       `${params.caseType} lead routed — Hillsborough County (${params.caseNumber})`,
          confidence:   params.config.urgency === "high" ? 0.70 : params.config.urgency === "medium" ? 0.55 : 0.40,
          subAccountId,
          niche:        params.config.legalVertical,
          metadata: {
            caseNumber:   params.caseNumber,
            caseType:     params.caseType,
            signalType:   params.config.signalType,
            county:       COUNTY,
            hasPhone:     !!params.phone,
            filingDate:   params.filingDate,
          },
        })
      ).catch((e: any) => console.warn("[APEX-OUTCOME] hillsborough-filings reportOutcome error:", e?.message));
    } catch (err: any) {
      console.warn(`[${PIPELINE_TAG}] createContact failed (account=${subAccountId}): ${err.message}`);
    }
  }
  return delivered;
}

// ── Core row processor ────────────────────────────────────────────────────────

interface ProcessResult {
  inserted: number;
  skipped:  number;
  errors:   number;
  contacts: number;
}

async function processRow(
  row:    FilingRow,
  config: CaseTypeConfig,
): Promise<ProcessResult> {
  const result: ProcessResult = { inserted: 0, skipped: 0, errors: 0, contacts: 0 };
  try {
    if (!row.lastName || isEntityName(`${row.firstName} ${row.lastName}`)) {
      result.skipped++;
      return result;
    }
    if (config.noAttorneyOnly && row.attorney && row.attorney !== "No Attorney" && row.attorney.trim() !== "") {
      // Party already has counsel — skip
      result.skipped++;
      return result;
    }

    const hash = buildSignalHash(row.caseNumber, row.partyType, row.lastName);
    if (await isDuplicate(hash)) { result.skipped++; return result; }

    const phone = await skipTraceByAddress(row.firstName, row.lastName, row.partyAddress);

    // Score: high urgency family = 70, medium = 55, low = 40; probate = 60
    const scoreMap: Record<string, number> = { high: 70, medium: 55, low: 40 };
    const score = scoreMap[config.urgency] ?? 55;

    // Insert legalSignal
    const [signal] = await db
      .insert(legalSignals)
      .values({
        sourceHash:       hash,
        signalType:       config.signalType,
        legalVertical:    config.legalVertical,
        county:           COUNTY,
        state:            "FL",
        subjectName:      `${row.firstName} ${row.lastName}`.trim(),
        subjectPhone:     phone ?? undefined,
        subjectAddress:   row.partyAddress || undefined,
        caseNumber:       row.caseNumber,
        chargeDescription: row.caseType,
        filingDate:       row.filingDate ? new Date(row.filingDate) : new Date(),
        urgency:          config.urgency,
        score,
        status:           "raw",
        rawData: {
          caseCategory:  row.caseCategory,
          caseType:      row.caseType,
          caseNumber:    row.caseNumber,
          title:         row.title,
          filingDate:    row.filingDate,
          partyType:     row.partyType,
          attorney:      row.attorney,
          partyAddress:  row.partyAddress,
          source:        "publicrec.hillsclerk.com",
        },
      })
      .returning({ id: legalSignals.id });

    // Insert legalLead
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await db
      .insert(legalLeads)
      .values({
        signalId:         signal.id,
        legalVertical:    config.legalVertical,
        signalType:       config.signalType,
        county:           COUNTY,
        subjectName:      `${row.firstName} ${row.lastName}`.trim(),
        subjectPhone:     phone ?? undefined,
        subjectAddress:   row.partyAddress || undefined,
        caseNumber:       row.caseNumber,
        chargeDescription: row.caseType,
        urgency:          config.urgency,
        score,
        status:           "available",
        expiresAt,
        rawData: {
          caseCategory: row.caseCategory,
          caseType:     row.caseType,
          attorney:     row.attorney,
        },
      });

    result.inserted++;

    const delivered = await deliverToAccounts({
      firstName:   row.firstName,
      lastName:    row.lastName,
      phone,
      address:     row.partyAddress,
      config,
      caseNumber:  row.caseNumber,
      caseType:    row.caseType,
      title:       row.title,
      filingDate:  row.filingDate,
    });
    result.contacts += delivered;

    console.log(
      `[${PIPELINE_TAG}] ✅ ${row.caseCategory}/${row.caseType} | ${row.firstName} ${row.lastName}` +
      ` | ${row.caseNumber}${phone ? " | phone ✓" : ""} | accounts=${delivered}`
    );
  } catch (err: any) {
    result.errors++;
    console.error(`[${PIPELINE_TAG}] Error processing ${row.caseNumber}: ${err.message}`);
  }
  return result;
}

// ── Find config for a row ─────────────────────────────────────────────────────

function getFamilyConfig(caseType: string): CaseTypeConfig | null {
  // Exact match first
  if (FAMILY_CASE_TYPES[caseType]) return FAMILY_CASE_TYPES[caseType];
  // Keyword search
  for (const { keyword, config } of FAMILY_KEYWORDS) {
    if (caseType.includes(keyword)) return config;
  }
  return null;
}

function getProbateConfig(caseType: string): CaseTypeConfig | null {
  if (PROBATE_CASE_TYPES[caseType]) return PROBATE_CASE_TYPES[caseType];
  const lower = caseType.toLowerCase();
  if (lower.includes("guardianship")) return PROBATE_CASE_TYPES["Guardianship"];
  if (lower.includes("formal administration")) return PROBATE_CASE_TYPES["Formal Administration"];
  if (lower.includes("summary administration")) return PROBATE_CASE_TYPES["Summary Administration"];
  return PROBATE_CASE_TYPES["Formal Administration"]; // default for unknown probate types
}

function isForeclosureCase(caseType: string): boolean {
  return FORECLOSURE_KEYWORDS.some(k => caseType.includes(k));
}

// ── Day processing ────────────────────────────────────────────────────────────

interface CycleStats {
  date:     string;
  civFam:   ProcessResult;
  probate:  ProcessResult;
  criminal: ProcessResult;
}

async function processDayFilings(targetDate: Date): Promise<CycleStats> {
  const ds = toFileDate(targetDate);
  console.log(`[${PIPELINE_TAG}] Processing ${ds} filings`);

  const civilUrl    = `${CIVIL_FILING_BASE}/CivilFiling_${ds}.csv`;
  const probateUrl  = `${PROBATE_FILING_BASE}/ProbateFiling_${ds}.csv`;
  const criminalUrl = `${CRIMINAL_FILING_BASE}/CriminalFiling_${ds}.csv`;

  const [civilRaw, probateRaw, criminalRaw] = await Promise.all([
    fetchText(civilUrl),
    fetchText(probateUrl),
    fetchText(criminalUrl),
  ]);

  const civFam:   ProcessResult = { inserted: 0, skipped: 0, errors: 0, contacts: 0 };
  const probate:  ProcessResult = { inserted: 0, skipped: 0, errors: 0, contacts: 0 };
  const criminal: ProcessResult = { inserted: 0, skipped: 0, errors: 0, contacts: 0 };

  // ── Process Civil + Family Law CSV ─────────────────────────────────────────
  if (civilRaw) {
    const rows = parseCivilCSV(civilRaw);
    console.log(`[${PIPELINE_TAG}] ${ds} civil/fam: ${rows.length} total rows`);

    // Group by caseNumber to process each case's target party once
    const caseMap = new Map<string, FilingRow[]>();
    for (const row of rows) {
      if (!caseMap.has(row.caseNumber)) caseMap.set(row.caseNumber, []);
      caseMap.get(row.caseNumber)!.push(row);
    }

    for (const [, caseRows] of caseMap) {
      const sampleRow = caseRows[0];

      let config: CaseTypeConfig | null = null;

      if (sampleRow.caseCategory === "FAM") {
        config = getFamilyConfig(sampleRow.caseType);
        if (!config) continue;
        // Get Respondent rows specifically
        const targetRows = caseRows.filter(r => r.partyType === config!.targetParty);
        for (const row of targetRows) {
          const r = await processRow(row, config);
          civFam.inserted += r.inserted;
          civFam.skipped  += r.skipped;
          civFam.errors   += r.errors;
          civFam.contacts += r.contacts;
        }
      } else if (sampleRow.caseCategory === "CV" && isForeclosureCase(sampleRow.caseType)) {
        const foreclosureConfig: CaseTypeConfig = {
          signalType:    "lis_pendens",
          legalVertical: "real_estate",
          urgency:       "high",
          crmTags:       ["foreclosure-lead", "mortgage-foreclosure", "real-estate-attorney", "sentinel-auto"],
          targetParty:   "Defendant",
          noAttorneyOnly: false,
        };
        const targetRows = caseRows.filter(r => r.partyType === "Defendant");
        for (const row of targetRows) {
          if (isEntityName(row.lastName)) continue; // skip bank defendants
          const r = await processRow(row, foreclosureConfig);
          civFam.inserted += r.inserted;
          civFam.skipped  += r.skipped;
          civFam.errors   += r.errors;
          civFam.contacts += r.contacts;
        }
      }
    }
  } else {
    console.warn(`[${PIPELINE_TAG}] No civil/family filing for ${ds}`);
  }

  // ── Process Probate CSV ────────────────────────────────────────────────────
  if (probateRaw) {
    const rows = parseProbateCSV(probateRaw);
    console.log(`[${PIPELINE_TAG}] ${ds} probate: ${rows.length} total rows`);

    const caseMap = new Map<string, FilingRow[]>();
    for (const row of rows) {
      if (!caseMap.has(row.caseNumber)) caseMap.set(row.caseNumber, []);
      caseMap.get(row.caseNumber)!.push(row);
    }

    for (const [, caseRows] of caseMap) {
      const sampleRow = caseRows[0];
      const config    = getProbateConfig(sampleRow.caseType);
      if (!config) continue;

      const targetRows = caseRows.filter(r => r.partyType === "Petitioner");
      for (const row of targetRows) {
        if (isEntityName(row.lastName)) continue;
        const r = await processRow(row, config);
        probate.inserted += r.inserted;
        probate.skipped  += r.skipped;
        probate.errors   += r.errors;
        probate.contacts += r.contacts;
      }
    }
  } else {
    console.warn(`[${PIPELINE_TAG}] No probate filing for ${ds}`);
  }

  // ── Process Criminal Filing CSV ────────────────────────────────────────────
  if (criminalRaw) {
    const rows = parseCriminalCSV(criminalRaw);
    console.log(`[${PIPELINE_TAG}] ${ds} criminal: ${rows.length} unique defendants`);

    for (const row of rows) {
      // Skip non-defendant rows and entity names
      if (row.partyType !== "Defendant" || isEntityName(row.lastName)) { criminal.skipped++; continue; }
      // Skip low-value case types
      if (SKIP_CRIMINAL_TYPES.some(s => row.caseType.toUpperCase().includes(s))) { criminal.skipped++; continue; }
      // Only target unrepresented defendants
      if (row.attorney && row.attorney !== "No Attorney" && row.attorney.trim() !== "") { criminal.skipped++; continue; }

      const crConfig = getCriminalConfig(row.caseType);

      // Build a "config" compatible with processRow (which expects CaseTypeConfig)
      const compatConfig: CaseTypeConfig = {
        signalType:    crConfig.signalType,
        legalVertical: crConfig.legalVertical,
        urgency:       crConfig.urgency,
        crmTags:       crConfig.crmTags,
        targetParty:   "Defendant",
        noAttorneyOnly: false, // already filtered above
      };

      // Override chargeDescription in the row with aggregated charge list
      const enrichedRow: FilingRow = {
        ...row,
        chargeDescription: row.chargeDescription || row.caseType,
      };

      const r = await processRow(enrichedRow, compatConfig);
      criminal.inserted += r.inserted;
      criminal.skipped  += r.skipped;
      criminal.errors   += r.errors;
      criminal.contacts += r.contacts;
    }
  } else {
    console.warn(`[${PIPELINE_TAG}] No criminal filing for ${ds}`);
  }

  console.log(
    `[${PIPELINE_TAG}] ${ds} complete — ` +
    `civFam: ins=${civFam.inserted} skip=${civFam.skipped} | ` +
    `probate: ins=${probate.inserted} skip=${probate.skipped} | ` +
    `criminal: ins=${criminal.inserted} skip=${criminal.skipped}`
  );

  return { date: ds, civFam, probate, criminal };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

let _lastRunAt:          Date | null = null;
let _lastCycleInserted:  number      = 0;
let _lastCycleSkipped:   number      = 0;
let _totalInsertedEver:  number      = 0;

export function getHillsboroughFilingsPipelineStats() {
  return {
    lastRunAt:          _lastRunAt?.toISOString()   ?? null,
    lastCycleInserted:  _lastCycleInserted,
    lastCycleSkipped:   _lastCycleSkipped,
    totalInsertedEver:  _totalInsertedEver,
    batchDataAvailable: !!resolveBatchDataKey(),
    county:             COUNTY,
    sources:            ["CivilandFamilyLaw", "Probate/dailyfilings"],
  };
}

// ── Manual trigger ────────────────────────────────────────────────────────────

export async function runHillsboroughFilingsCycle(opts?: { daysBack?: number }): Promise<CycleStats[]> {
  _lastRunAt = new Date();
  _lastCycleInserted = 0;
  _lastCycleSkipped  = 0;
  const daysBack = opts?.daysBack ?? 1;
  const results: CycleStats[] = [];

  for (let i = daysBack; i >= 1; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const stats = await processDayFilings(d);
    results.push(stats);
    _lastCycleInserted += stats.civFam.inserted + stats.probate.inserted + stats.criminal.inserted;
    _lastCycleSkipped  += stats.civFam.skipped  + stats.probate.skipped  + stats.criminal.skipped;
    _totalInsertedEver += stats.civFam.inserted + stats.probate.inserted + stats.criminal.inserted;
  }

  return results;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _schedulerStarted = false;

export function startHillsboroughFilingsScheduler(): void {
  if (_schedulerStarted) return;
  _schedulerStarted = true;

  console.log(`[${PIPELINE_TAG}] Starting scheduler — daily at 07:00 ET`);

  function scheduleNext() {
    const now  = new Date();
    const next = new Date(now);
    next.setUTCHours(12, 0, 0, 0); // 12:00 UTC = 07:00 ET (EST+5) / 08:00 ET (EDT+4)
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const delay = next.getTime() - now.getTime();
    console.log(`[${PIPELINE_TAG}] Next run in ${Math.round(delay / 60_000)} min (${next.toISOString()})`);
    setTimeout(async () => {
      try {
        _lastCycleInserted = 0;
        _lastCycleSkipped  = 0;
        await runHillsboroughFilingsCycle({ daysBack: 1 });
      } catch (err: any) {
        console.error(`[${PIPELINE_TAG}] Scheduler error: ${err.message}`);
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}
