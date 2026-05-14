/**
 * courtFilingPipeline.ts
 *
 * Real-time FL county court filing intake for family law, domestic violence,
 * and probate leads using Nimble browser extraction (api.webit.live).
 *
 * Data flow:
 *   Nimble extract → FilingRecord[] → dedup → legalSignals → legalLeads → contacts
 *
 * Requires: NIMBLE_API_KEY  (set in Railway env vars)
 * Schedule: every 6 hours, staggered 5s between counties
 *
 * Extraction strategy:
 *   - Uses api.webit.live/api/v1/realtime/web (Basic auth)  — same pattern as countyBookingScrapers.ts
 *   - No pre-built Nimble agents required
 *   - Each county has a primary URL and optional fallback
 *   - Lee County probate: extracts from published monthly PDF report links
 *   - Form-based portals: rendered with JS wait, results parsed from markdown
 *
 * Signal types produced:
 *   divorce_filing                 → family vertical
 *   custody_modification           → family vertical
 *   domestic_violence_injunction   → family vertical  (urgency: critical)
 *   probate_filing                 → estate vertical
 *
 * Coverage enforcement:
 *   - Prints full source list before execution
 *   - Logs each county as QUEUED, FETCHING, SUCCESS, NO_DATA, SKIPPED, or FAILED
 *   - Reports: sources_attempted, sources_succeeded, sources_failed, leads_created
 */

import crypto from "crypto";
import axios  from "axios";
import { db } from "./db";
import { legalSignals, legalLeads, contacts, type InsertContact } from "@shared/schema";
import { eq } from "drizzle-orm";

// ── Nimble Config ──────────────────────────────────────────────────────────────

const NIMBLE_REALTIME_API = "https://api.webit.live/api/v1/realtime/web";
const STAGGER_BETWEEN_MS  = 5_000;   // 5 s between counties
const POLL_INTERVAL_MS    = 6 * 60 * 60 * 1_000; // 6 hours
const COVERAGE_THRESHOLD  = 0.80;

function resolveNimbleKey(): string {
  return (
    process.env.NIMBLE_API_KEY ||
    process.env.NIMBLE_TOKEN   ||
    process.env.NIMBLE_KEY     ||
    ""
  ).trim();
}

function isNimbleConfigured(): boolean { return resolveNimbleKey().length > 0; }

// ── Nimble extract helper ─────────────────────────────────────────────────────
// Identical to countyBookingScrapers.ts — Basic auth, api.webit.live

async function nimbleExtract(url: string, waitMs = 5000): Promise<string> {
  const apiKey = resolveNimbleKey();
  if (!apiKey) throw new Error("NIMBLE_API_KEY not configured");
  const resp = await axios.post(
    NIMBLE_REALTIME_API,
    { url, render: true, wait: waitMs, output_format: "markdown" },
    {
      headers: {
        Authorization: `Basic ${Buffer.from(apiKey).toString("base64")}`,
        "Content-Type": "application/json",
      },
      timeout: 60_000,
    },
  );
  return resp.data?.html_content || resp.data?.content || "";
}

// ── Domain Allowlist ──────────────────────────────────────────────────────────

const APPROVED_DOMAINS = new Set([
  "leeclerk.org",
  "matrix.leeclerk.org",
  "collierclerk.com",
  "charlotteclerk.com",
  "sarasotaclerk.com",
  "manateeclerk.com",
  "mypalmbeachclerk.com",
  "miamidadeclerk.com",
  "myflcourtaccess.com",
]);

function isDomainApproved(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return APPROVED_DOMAINS.has(host);
  // allow-silent-catch: invalid URL string → treat as not approved
  } catch { return false; }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

function fmtDate(d: Date): string { return d.toISOString().split("T")[0]; }

// ── Filing Record (output shape from each county scraper) ─────────────────────

interface FilingRecord {
  county:              string;
  source_url:          string;
  case_number:         string;
  filing_date:         string;   // ISO date or MM/DD/YYYY
  case_type:           string;   // "DR" | "DV" | "DM" | "PR" | "GD"
  case_description:    string;
  petitioner_name:     string;
  respondent_name?:    string;
  court_name?:         string;
  attorney_petitioner?: string;
  has_minor_children?: boolean;
  status?:             string;
  scrape_timestamp:    string;
}

// ── County Scrape Result ──────────────────────────────────────────────────────

interface CountyScrapeResult {
  county:   string;
  records:  FilingRecord[];
  pages:    number;
  errors:   string[];
  blocker?: string;
}

// ── Signal Classification ─────────────────────────────────────────────────────

type FilingSignalType = "divorce_filing" | "custody_modification" | "domestic_violence_injunction" | "probate_filing";
type FilingVertical   = "family" | "estate";
type FilingUrgency    = "critical" | "high" | "medium" | "low";

interface FilingClassification {
  signalType:    FilingSignalType;
  legalVertical: FilingVertical;
  urgency:       FilingUrgency;
  description:   string;
}

function classifyFiling(record: FilingRecord): FilingClassification {
  const ct  = record.case_type?.toUpperCase().trim() ?? "";
  const desc = record.case_description?.toUpperCase() ?? "";

  if (ct === "DV" || /INJUNCTION|DOMESTIC VIOLENCE|RESTRAINING/.test(desc)) {
    return { signalType: "domestic_violence_injunction", legalVertical: "family", urgency: "critical", description: "Domestic Violence / Injunction" };
  }
  if (ct === "DM" || /CUSTODY|MODIFICATION|TIME.SHARING|PARENTING PLAN/.test(desc)) {
    return { signalType: "custody_modification", legalVertical: "family", urgency: "high", description: "Custody / Modification" };
  }
  if (ct === "DR" || /DISSOLUTION|DIVORCE|MARRIAGE/.test(desc)) {
    return {
      signalType:    "divorce_filing",
      legalVertical: "family",
      urgency:       record.has_minor_children ? "high" : "medium",
      description:   record.has_minor_children ? "Divorce with Minor Children" : "Divorce / Dissolution",
    };
  }
  if (ct === "PR" || ct === "GD" || /PROBATE|ESTATE|TRUST|GUARDIANSHIP|WILL/.test(desc)) {
    return { signalType: "probate_filing", legalVertical: "estate", urgency: "medium", description: "Probate / Estate" };
  }
  return { signalType: "divorce_filing", legalVertical: "family", urgency: "low", description: "Family Court Filing" };
}

function scoreFilingRecord(cls: FilingClassification, record: FilingRecord): number {
  let score = 35;
  if (cls.urgency === "critical") score += 35;
  else if (cls.urgency === "high")   score += 20;
  else if (cls.urgency === "medium") score += 10;
  if (record.has_minor_children)  score += 10;
  if (record.attorney_petitioner) score += 5;
  if (record.respondent_name)     score += 5;
  return Math.min(100, score);
}

// ── Generic case record parser ────────────────────────────────────────────────
// Parses markdown rendered from county clerk pages.
// Looks for FL court case number patterns: YY-CASETYPE-SEQNUM or YYYY-CASETYPE-SEQNUM

function parseCaseMarkdown(
  markdown: string,
  county:   string,
  sourceUrl: string,
  caseTypeFilter?: string[],
): FilingRecord[] {
  const records: FilingRecord[] = [];
  const now = new Date().toISOString();

  // FL case number patterns: 2024-DR-001234, 24-DV-12345, 2024DR001234
  const caseNumPattern = /\b(\d{2,4}[-\s]?(DR|DV|DM|PR|GD)[-\s]?\d{4,8})\b/gi;
  const datePattern    = /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/;
  const namePattern    = /\b([A-Z][A-Z'-]+,?\s+[A-Z][A-Z'-]+(?:\s+[A-Z][A-Z'-]+)?)\b/;

  // Split into lines/blocks around each case number occurrence
  const sections = markdown.split(/(?=\b\d{2,4}[-\s]?(?:DR|DV|DM|PR|GD)[-\s]?\d{4,8}\b)/i);

  for (const section of sections) {
    const caseMatch = section.match(caseNumPattern);
    if (!caseMatch) continue;

    const rawCaseNum = caseMatch[0];
    const caseTypeMatch = rawCaseNum.match(/(?:DR|DV|DM|PR|GD)/i);
    const caseType      = caseTypeMatch ? caseTypeMatch[0].toUpperCase() : "DR";

    // Filter by requested case types
    if (caseTypeFilter && !caseTypeFilter.includes(caseType)) continue;

    const dateMatch  = section.match(datePattern);
    const nameMatch  = section.match(namePattern);

    records.push({
      county,
      source_url:       sourceUrl,
      case_number:      rawCaseNum.replace(/\s/g, ""),
      filing_date:      dateMatch ? dateMatch[1] : fmtDate(new Date()),
      case_type:        caseType,
      case_description: section.slice(0, 200).replace(/\n/g, " ").trim(),
      petitioner_name:  nameMatch ? nameMatch[0].replace(/,\s*$/, "").trim() : "Unknown",
      respondent_name:  undefined,
      scrape_timestamp: now,
    });
  }

  return records;
}

// ── Status Logger ─────────────────────────────────────────────────────────────

type SourceStatus = "QUEUED" | "FETCHING" | "SUCCESS" | "NO_DATA" | "SKIPPED" | "FAILED";

function logCountyStatus(county: string, status: SourceStatus, detail?: string) {
  const icon = { QUEUED:"⏳", FETCHING:"🔍", SUCCESS:"✅", NO_DATA:"📭", SKIPPED:"⏭", FAILED:"❌" }[status];
  const msg  = `[COURT-FILING] ${icon} [${status}] ${county}${detail ? ` — ${detail}` : ""}`;
  if (status === "FAILED") console.error(msg);
  else console.log(msg);
}

// ── County Scrapers ───────────────────────────────────────────────────────────

// LEE COUNTY
// Primary:  leeclerk.org court case records page (probate PDF reports)
// Search:   matrix.leeclerk.org (JS-rendered form — try direct render)
// Probate:  Monthly PDF listing at /departments/courts/court-case-records

async function scrapeLeeCounty(from: string, to: string): Promise<CountyScrapeResult> {
  const county = "LEE";
  const records: FilingRecord[] = [];
  const errors: string[] = [];
  let pages = 0;

  // ── Attempt 1: Court Case Records listing page (probate PDF reports) ─────
  try {
    const url  = "https://www.leeclerk.org/departments/courts/court-case-records";
    const html = await nimbleExtract(url, 4000);
    pages++;

    // Find PDF links for Probate New Estate Listings (published monthly)
    const pdfLinkPattern = /(https:\/\/www\.leeclerk\.org\/home\/showpublisheddocument\/\d+\/\d+)/g;
    const pdfLinks = [...html.matchAll(pdfLinkPattern)].map(m => m[1]);

    // Extract the most recent probate PDF
    if (pdfLinks.length > 0) {
      try {
        const pdfMd = await nimbleExtract(pdfLinks[0], 3000);
        pages++;
        const pdfRecords = parseCaseMarkdown(pdfMd, county, pdfLinks[0], ["PR", "GD"]);
        records.push(...pdfRecords);
        console.log(`[COURT-FILING] Lee County probate PDF: ${pdfRecords.length} records`);
      } catch (pdfErr: any) {
        errors.push(`probate PDF: ${pdfErr.message}`);
      }
    }
  } catch (err: any) {
    errors.push(`leeclerk.org: ${err.message}`);
  }

  // ── Attempt 2: Matrix case search (JS-rendered — try direct render) ───────
  try {
    const url  = "https://matrix.leeclerk.org/";
    const html = await nimbleExtract(url, 8000); // extra wait for form JS
    pages++;
    const parsed = parseCaseMarkdown(html, county, url, ["DR", "DV", "DM"]);
    records.push(...parsed);
    console.log(`[COURT-FILING] Lee County matrix: ${parsed.length} records`);
  } catch (err: any) {
    // form portal — expected to be limited without form submission
    errors.push(`matrix.leeclerk.org: ${err.message}`);
  }

  return { county, records, pages, errors };
}

// COLLIER COUNTY
// Portal: collierclerk.com/records-and-courts/court-records/
// Also try: apps.collierclerk.com (case search application)

async function scrapeCollierCounty(from: string, to: string): Promise<CountyScrapeResult> {
  const county = "COLLIER";
  const records: FilingRecord[] = [];
  const errors: string[] = [];
  let pages = 0;

  for (const url of [
    "https://www.collierclerk.com/records-and-courts/court-records/",
    `https://www.collierclerk.com/records-and-courts/court-records/?filingFrom=${from}&filingTo=${to}`,
  ]) {
    if (!isDomainApproved(url)) continue;
    try {
      const html   = await nimbleExtract(url, 5000);
      pages++;
      const parsed = parseCaseMarkdown(html, county, url, ["DR", "DV", "DM", "PR", "GD"]);
      records.push(...parsed);
      if (records.length > 0) break;
    } catch (err: any) {
      errors.push(`${url}: ${err.message}`);
    }
  }

  return { county, records, pages, errors };
}

// CHARLOTTE COUNTY
// Portal: charlotteclerk.com

async function scrapeCharlotteCounty(from: string, to: string): Promise<CountyScrapeResult> {
  const county = "CHARLOTTE";
  const records: FilingRecord[] = [];
  const errors: string[] = [];
  let pages = 0;

  for (const url of [
    "https://www.charlotteclerk.com/courts/court-records/",
    `https://www.charlotteclerk.com/courts/court-records/?caseType=DR,DV,PR&from=${from}&to=${to}`,
  ]) {
    if (!isDomainApproved(url)) continue;
    try {
      const html   = await nimbleExtract(url, 5000);
      pages++;
      const parsed = parseCaseMarkdown(html, county, url, ["DR", "DV", "DM", "PR", "GD"]);
      records.push(...parsed);
      if (records.length > 0) break;
    } catch (err: any) {
      errors.push(`${url}: ${err.message}`);
    }
  }

  return { county, records, pages, errors };
}

// SARASOTA COUNTY
// Portal: sarasotaclerk.com

async function scrapeSarasotaCounty(from: string, to: string): Promise<CountyScrapeResult> {
  const county = "SARASOTA";
  const records: FilingRecord[] = [];
  const errors: string[] = [];
  let pages = 0;

  for (const url of [
    `https://www.sarasotaclerk.com/index.aspx?NID=195`,
    `https://www.sarasotaclerk.com/court-records/?from=${from}&to=${to}`,
  ]) {
    if (!isDomainApproved(url)) continue;
    try {
      const html   = await nimbleExtract(url, 5000);
      pages++;
      const parsed = parseCaseMarkdown(html, county, url, ["DR", "DV", "DM", "PR", "GD"]);
      records.push(...parsed);
      if (records.length > 0) break;
    } catch (err: any) {
      errors.push(`${url}: ${err.message}`);
    }
  }

  return { county, records, pages, errors };
}

// MANATEE COUNTY
// Portal: manateeclerk.com

async function scrapeManateeCounty(from: string, to: string): Promise<CountyScrapeResult> {
  const county = "MANATEE";
  const records: FilingRecord[] = [];
  const errors: string[] = [];
  let pages = 0;

  for (const url of [
    "https://www.manateeclerk.com/online-services/case-search/",
    `https://www.manateeclerk.com/online-services/case-search/?from=${from}&to=${to}&type=DR,DV,PR`,
  ]) {
    if (!isDomainApproved(url)) continue;
    try {
      const html   = await nimbleExtract(url, 5000);
      pages++;
      const parsed = parseCaseMarkdown(html, county, url, ["DR", "DV", "DM", "PR", "GD"]);
      records.push(...parsed);
      if (records.length > 0) break;
    } catch (err: any) {
      errors.push(`${url}: ${err.message}`);
    }
  }

  return { county, records, pages, errors };
}

// PALM BEACH COUNTY
// Portal: apps.mypalmbeachclerk.com

async function scrapePalmBeachCounty(from: string, to: string): Promise<CountyScrapeResult> {
  const county = "PALM_BEACH";
  const records: FilingRecord[] = [];
  const errors: string[] = [];
  let pages = 0;

  for (const url of [
    "https://apps.mypalmbeachclerk.com/search/",
    `https://apps.mypalmbeachclerk.com/search/?caseType=DR&filingFrom=${from}&filingTo=${to}`,
  ]) {
    if (!isDomainApproved(url)) continue;
    try {
      const html   = await nimbleExtract(url, 6000);
      pages++;
      const parsed = parseCaseMarkdown(html, county, url, ["DR", "DV", "DM", "PR", "GD"]);
      records.push(...parsed);
      if (records.length > 0) break;
    } catch (err: any) {
      errors.push(`${url}: ${err.message}`);
    }
  }

  return { county, records, pages, errors };
}

// MIAMI-DADE COUNTY
// Portal: miamidadeclerk.com/ocs/

async function scrapeMiamiDadeCounty(from: string, to: string): Promise<CountyScrapeResult> {
  const county = "MIAMI_DADE";
  const records: FilingRecord[] = [];
  const errors: string[] = [];
  let pages = 0;

  for (const url of [
    "https://www2.miamidadeclerk.com/ocs/",
    `https://www2.miamidadeclerk.com/ocs/Search.aspx?caseType=DR&filingFrom=${from}&filingTo=${to}`,
  ]) {
    if (!isDomainApproved(url)) continue;
    try {
      const html   = await nimbleExtract(url, 6000);
      pages++;
      const parsed = parseCaseMarkdown(html, county, url, ["DR", "DV", "DM", "PR", "GD"]);
      records.push(...parsed);
      if (records.length > 0) break;
    } catch (err: any) {
      errors.push(`${url}: ${err.message}`);
    }
  }

  return { county, records, pages, errors };
}

// ── Dedup & Persistence ───────────────────────────────────────────────────────

function buildFilingHash(county: string, caseNumber: string, filingDate: string): string {
  return crypto.createHash("sha256")
    .update(`${county.toUpperCase()}|${caseNumber}|${filingDate}`)
    .digest("hex").slice(0, 24).toUpperCase();
}

function buildFallbackHash(county: string, record: FilingRecord): string {
  return crypto.createHash("sha256")
    .update([county, record.petitioner_name, record.respondent_name ?? "", record.filing_date].join("|"))
    .digest("hex").slice(0, 24).toUpperCase();
}

async function isHashDuplicate(hash: string): Promise<boolean> {
  const [row] = await db.select({ id: legalSignals.id })
    .from(legalSignals).where(eq(legalSignals.sourceHash, hash)).limit(1);
  return !!row;
}

async function persistFilingRecord(
  record: FilingRecord,
  county:  string,
  state:   string,
): Promise<{ inserted: boolean; signalId?: number }> {
  const cls   = classifyFiling(record);
  const score = scoreFilingRecord(cls, record);

  const primaryHash  = buildFilingHash(county, record.case_number, record.filing_date);
  const fallbackHash = buildFallbackHash(county, record);

  if (await isHashDuplicate(primaryHash))  return { inserted: false };
  if (await isHashDuplicate(fallbackHash)) return { inserted: false };

  const rawPayload = { record, county, state, pipeline: "court_filing_pipeline" };

  let filingDateTs: Date | undefined;
  try { filingDateTs = record.filing_date ? new Date(record.filing_date) : undefined; }
  catch { /* ignore */ } // allow-silent-catch: invalid date string → filingDateTs stays undefined

  const [signal] = await db.insert(legalSignals).values({
    sourceHash:        primaryHash,
    signalType:        cls.signalType,
    legalVertical:     cls.legalVertical,
    county,
    state,
    subjectName:       record.petitioner_name || undefined,
    chargeDescription: [
      cls.description,
      record.respondent_name ? `Respondent: ${record.respondent_name}` : null,
      record.has_minor_children ? "Minor children involved" : null,
    ].filter(Boolean).join(" | ").slice(0, 500),
    caseNumber:        record.case_number || undefined,
    courtName:         record.court_name  || `Circuit Court, ${county} County, FL`,
    filingDate:        filingDateTs,
    urgency:           cls.urgency,
    score,
    status:            score >= 50 ? "qualified" : "raw",
    rawData:           rawPayload,
    detectedAt:        new Date(),
  }).returning({ id: legalSignals.id });

  if (cls.urgency === "critical" || cls.urgency === "high") {
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await db.insert(legalLeads).values({
      signalId:          signal.id,
      legalVertical:     cls.legalVertical,
      signalType:        cls.signalType,
      county,
      subjectName:       record.petitioner_name || undefined,
      chargeDescription: cls.description,
      caseNumber:        record.case_number || undefined,
      urgency:           cls.urgency,
      score,
      status:            "available",
      expiresAt,
      rawData:           rawPayload,
      detectedAt:        new Date(),
    }).onConflictDoNothing();
  }

  return { inserted: true, signalId: signal.id };
}

// ── CRM Contact Routing ───────────────────────────────────────────────────────

async function resolveSentinelAccountIds(): Promise<number[]> {
  const { pool } = await import("./db");
  const r = await pool.query(
    `SELECT sub_account_id FROM sentinel_config WHERE enabled = true LIMIT 200`,
  );
  return r.rows.map((row: { sub_account_id: number }) => row.sub_account_id);
}

async function createContactFromFiling(
  record:       FilingRecord,
  cls:          FilingClassification,
  score:        number,
  subAccountId: number,
): Promise<void> {
  try {
    const tags = [
      "court-filing",
      cls.signalType.replace(/_/g, "-"),
      cls.legalVertical,
      cls.urgency === "critical" ? "urgent" : null,
      record.has_minor_children ? "minor-children" : null,
    ].filter((t): t is string => !!t);

    const notes = [
      `Court Filing — ${record.county} County, FL`,
      `Case: ${record.case_number || "N/A"}`,
      `Type: ${cls.description}`,
      `Filed: ${record.filing_date || "Unknown"}`,
      `Petitioner: ${record.petitioner_name || "Unknown"}`,
      record.respondent_name ? `Respondent: ${record.respondent_name}` : null,
      record.has_minor_children ? "⚠ Minor children involved" : null,
      record.attorney_petitioner ? `Petitioner's Attorney: ${record.attorney_petitioner}` : null,
      record.court_name ? `Court: ${record.court_name}` : null,
      `Lead Score: ${score}/100`,
      record.source_url ? `Source: ${record.source_url}` : null,
    ].filter(Boolean).join("\n");

    const nameParts = (record.petitioner_name || "Unknown").split(" ");
    const firstName = nameParts[0] || "Filing";
    const lastName  = nameParts.slice(1).join(" ") || "Lead";

    const contactData: InsertContact = {
      subAccountId,
      firstName,
      lastName,
      source:  "court_filing",
      channel: cls.legalVertical === "estate" ? "estate_law" : "family_law",
      tags,
      notes,
      state:   "FL",
    };

    await db.insert(contacts).values(contactData);
    import("./operator/apexIntelligence").then(({ reportOutcome }) =>
      reportOutcome({
        agentName:    "court-filing-pipeline",
        action:       "contact_created",
        subject:      `${firstName} ${lastName}`,
        result:       `${cls.description} — ${record.county} County (score ${score})`,
        confidence:   Math.min(1, score / 100),
        subAccountId,
        niche:        "legal",
        metadata:     { signalType: cls.signalType, county: record.county, caseNumber: record.case_number, urgency: cls.urgency, score },
      })
    ).catch((e: any) => console.warn("[APEX-OUTCOME] reportOutcome fire-and-forget error:", e?.message));
  } catch (err: any) { // allow-silent-catch: contact failure must not block signal pipeline
    console.warn(`[COURT-FILING] Contact creation failed (account=${subAccountId}):`, err?.message);
  }
}

// ── Per-county runner ─────────────────────────────────────────────────────────

interface CountySpec {
  county:  string;
  state:   string;
  enabled: boolean;
  scrape:  (from: string, to: string) => Promise<CountyScrapeResult>;
}

const COUNTY_SPECS: CountySpec[] = [
  { county: "LEE",       state: "FL", enabled: true, scrape: scrapeLeeCounty       },
  { county: "COLLIER",   state: "FL", enabled: true, scrape: scrapeCollierCounty   },
  { county: "CHARLOTTE", state: "FL", enabled: true, scrape: scrapeCharlotteCounty },
  { county: "SARASOTA",  state: "FL", enabled: true, scrape: scrapeSarasotaCounty  },
  { county: "MANATEE",   state: "FL", enabled: true, scrape: scrapeManateeCounty   },
  { county: "PALM_BEACH",state: "FL", enabled: true, scrape: scrapePalmBeachCounty },
  { county: "MIAMI_DADE",state: "FL", enabled: true, scrape: scrapeMiamiDadeCounty },
];

const CONTACT_SCORE_THRESHOLD = 40;

async function processCounty(
  spec:       CountySpec,
  from:       string,
  to:         string,
  accountIds: number[],
): Promise<{ inserted: number; skipped: number; errors: number }> {
  const stats = { inserted: 0, skipped: 0, errors: 0 };

  logCountyStatus(spec.county, "FETCHING");

  let result: CountyScrapeResult;
  try {
    result = await spec.scrape(from, to);
  } catch (err: any) {
    logCountyStatus(spec.county, "FAILED", err?.message);
    stats.errors++;
    return stats;
  }

  if (result.records.length === 0) {
    logCountyStatus(spec.county, "NO_DATA", result.errors[0] ?? result.blocker ?? "no records found");
    return stats;
  }

  for (const record of result.records) {
    try {
      const res = await persistFilingRecord(record, spec.county, spec.state);
      if (!res.inserted) { stats.skipped++; continue; }
      stats.inserted++;

      const cls   = classifyFiling(record);
      const score = scoreFilingRecord(cls, record);
      if (score >= CONTACT_SCORE_THRESHOLD && accountIds.length > 0) {
        for (const accountId of accountIds) {
          await createContactFromFiling(record, cls, score, accountId);
        }
      }
    } catch (err: any) {
      console.warn(`[COURT-FILING] Persist error (${spec.county}):`, err?.message);
      stats.errors++;
    }
  }

  logCountyStatus(
    spec.county,
    stats.inserted > 0 ? "SUCCESS" : "NO_DATA",
    `records=${result.records.length} new=${stats.inserted} dupes=${stats.skipped} errors=${stats.errors}`,
  );

  return stats;
}

// ── Pipeline Runner ───────────────────────────────────────────────────────────

export async function runCourtFilingPipeline(): Promise<void> {
  if (!isNimbleConfigured()) {
    console.warn("[COURT-FILING] ⚠ NIMBLE_API_KEY not configured — court filing scrape skipped");
    return;
  }

  const enabled = COUNTY_SPECS.filter(s => s.enabled);
  const from    = daysAgo(1);
  const to      = fmtDate(new Date());

  console.log("\n[COURT-FILING] ─────────────────────────────────────────────────");
  console.log(`[COURT-FILING] Starting court filing pipeline — ${enabled.length} counties`);
  console.log(`[COURT-FILING] Date range: ${from} → ${to}`);
  console.log("[COURT-FILING] Signal types: divorce_filing | custody_modification | domestic_violence_injunction | probate_filing");
  console.log("[COURT-FILING] Extraction: api.webit.live (direct render, no pre-built agents)");
  console.log("[COURT-FILING] Sources:");
  for (const s of enabled) logCountyStatus(s.county, "QUEUED");

  let accountIds: number[] = [];
  try {
    accountIds = await resolveSentinelAccountIds();
    console.log(`[COURT-FILING] Routing contacts to accounts: [${accountIds.join(", ")}]`);
  } catch (err: any) {
    console.warn("[COURT-FILING] Failed to resolve account IDs:", err?.message);
  }

  let sourcesAttempted = 0;
  let sourcesSucceeded = 0;
  let sourcesFailed    = 0;
  let leadsCreated     = 0;

  for (const spec of enabled) {
    await new Promise(r => setTimeout(r, STAGGER_BETWEEN_MS));
    try {
      sourcesAttempted++;
      const stats = await processCounty(spec, from, to, accountIds);
      if (stats.errors === 0 || stats.inserted > 0) sourcesSucceeded++;
      else sourcesFailed++;
      leadsCreated += stats.inserted;
    } catch (err: any) {
      console.error(`[COURT-FILING] ❌ Unhandled error in ${spec.county}:`, err?.message);
      sourcesFailed++;
    }
  }

  const coveragePct = enabled.length > 0 ? sourcesAttempted / enabled.length : 1;
  if (coveragePct < COVERAGE_THRESHOLD) {
    console.error(
      `[COURT-FILING] ⚠ COVERAGE BELOW THRESHOLD: ${(coveragePct * 100).toFixed(0)}% ` +
      `(${sourcesAttempted}/${enabled.length} attempted)`,
    );
  }

  console.log(`[COURT-FILING] ── Summary ──────────────────────────────────────`);
  console.log(`[COURT-FILING] sources_attempted: ${sourcesAttempted}`);
  console.log(`[COURT-FILING] sources_succeeded: ${sourcesSucceeded}`);
  console.log(`[COURT-FILING] sources_failed:    ${sourcesFailed}`);
  console.log(`[COURT-FILING] leads_created:     ${leadsCreated}`);
  console.log("[COURT-FILING] ─────────────────────────────────────────────────\n");
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let schedulerStarted = false;

export function startCourtFilingScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  if (!isNimbleConfigured()) {
    console.warn(
      "[COURT-FILING] ⚠ Nimble credential not configured — court filing scheduler inactive. " +
      "Set NIMBLE_API_KEY in Railway to enable family law lead intake.",
    );
    return;
  }

  console.log("[COURT-FILING] Starting scheduler — poll every 6 hours");

  // Initial run after 60s (stagger behind other pipelines)
  setTimeout(() => {
    runCourtFilingPipeline().catch(err =>
      console.error("[COURT-FILING] Initial run failed:", err?.message),
    );
  }, 60_000);

  setInterval(() => {
    runCourtFilingPipeline().catch(err =>
      console.error("[COURT-FILING] Scheduled run failed:", err?.message),
    );
  }, POLL_INTERVAL_MS);
}
