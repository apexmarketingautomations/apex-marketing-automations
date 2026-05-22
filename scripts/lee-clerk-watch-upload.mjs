#!/usr/bin/env node
/**
 * Lee Clerk Watch + Upload
 *
 * Practical v1 for free Lee County Clerk case documents:
 *   1. Opens the live CRI site in a real browser
 *   2. Lets the operator sign in / search the case manually
 *   3. Waits for a document download
 *   4. Uploads the downloaded PDF back into Apex and links it to crash report(s)
 *
 * This avoids brittle DOM assumptions while still turning free CRI documents
 * into durable Apex police-report artifacts.
 *
 * Required env:
 *   CASE_NUMBER=24-TR-012345
 *   SUB_ACCOUNT_ID=3
 *   CRASH_REPORT_IDS=123,456
 *
 * Optional env:
 *   RAILWAY_URL=https://apexmarketingautomations.com
 *   STANDALONE_ADMIN_SECRET=...
 *   DOCUMENT_KEY=LEE-CRI:24-TR-012345
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { chromium } from "playwright";

const RAILWAY_URL = process.env.RAILWAY_URL || "https://apexmarketingautomations.com";
const ADMIN_SECRET = process.env.STANDALONE_ADMIN_SECRET || "201120062017";
const CRASH_REPORT_ID = Number(process.env.CRASH_REPORT_ID || "");
const CASE_NUMBER = String(process.env.CASE_NUMBER || "").trim();
const CITATION_NUMBER = String(process.env.CITATION_NUMBER || "").trim();
const SUB_ACCOUNT_ID = Number(process.env.SUB_ACCOUNT_ID || "");
const CRASH_REPORT_IDS = String(process.env.CRASH_REPORT_IDS || "")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((id) => Number.isFinite(id) && id > 0);
const DOCUMENT_KEY_OVERRIDE = String(process.env.DOCUMENT_KEY || "").trim();
const CRI_URL = "https://matrix.leeclerk.org/";

let SEARCH_SEED = null;

function fail(message) {
  console.error(`\n[LEE-CLERK] ${message}\n`);
  process.exit(1);
}

function log(message) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${message}`);
}

function resolvedSubAccountId() {
  if (Number.isFinite(SUB_ACCOUNT_ID) && SUB_ACCOUNT_ID > 0) return SUB_ACCOUNT_ID;
  const seeded = Number(SEARCH_SEED?.subAccountId || "");
  return Number.isFinite(seeded) && seeded > 0 ? seeded : null;
}

function resolvedDocumentKey() {
  if (DOCUMENT_KEY_OVERRIDE) return DOCUMENT_KEY_OVERRIDE;
  if (CASE_NUMBER) return `LEE-CRI:${CASE_NUMBER}`;
  if (CITATION_NUMBER) return `LEE-CRI:CITATION:${CITATION_NUMBER}`;
  if (Number.isFinite(CRASH_REPORT_ID) && CRASH_REPORT_ID > 0) return `LEE-CRI:CRASH:${CRASH_REPORT_ID}`;
  return "LEE-CRI:UNSPECIFIED";
}

function isAccessDeniedText(text = "") {
  return /access denied|you don't have permission/i.test(text);
}

function extractCandidateCaseNumbers(text = "") {
  const matches = String(text)
    .toUpperCase()
    .match(/\b\d{2,4}-[A-Z]{2,20}-\d{3,}\b/g);
  return Array.from(new Set(matches || [])).slice(0, 25);
}

async function fetchSearchSeed() {
  if (!Number.isFinite(CRASH_REPORT_ID) || CRASH_REPORT_ID <= 0) return null;

  const res = await fetch(`${RAILWAY_URL}/api/admin/lee-clerk-search-seed/${CRASH_REPORT_ID}`, {
    headers: { "x-admin-secret": ADMIN_SECRET },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error || `Search seed lookup failed (HTTP ${res.status})`);
  }
  return body;
}

async function configureLeeTrafficSearch(page) {
  const allToggle = page.locator('label', { hasText: 'Check/Uncheck All' }).first();
  if (await allToggle.count()) {
    await allToggle.click();
    await page.waitForTimeout(300);
  }

  for (const selector of ['#cs_CaseTypes_5__CaseTypeChecked', '#cs_CaseTypes_18__CaseTypeChecked']) {
    const checkbox = page.locator(selector);
    if (await checkbox.count()) {
      await checkbox.check();
      await page.waitForTimeout(150);
    }
  }

  if (CASE_NUMBER) {
    await page.fill('#cs_CaseNumber', CASE_NUMBER);
  }
  if (CITATION_NUMBER) {
    await page.fill('#cs_CitationNumber', CITATION_NUMBER);
  }
  if (!CASE_NUMBER && !CITATION_NUMBER && SEARCH_SEED?.searchDateFrom) {
    await page.fill('#cs_DateFrom', SEARCH_SEED.searchDateFrom);
  }
  if (!CASE_NUMBER && !CITATION_NUMBER && SEARCH_SEED?.searchDateTo) {
    await page.fill('#cs_DateTo', SEARCH_SEED.searchDateTo);
  }
}

async function attemptAutomatedSearch(page) {
  await configureLeeTrafficSearch(page);
  await page.waitForTimeout(500);

  const searchButton = page.locator('#submit2').or(page.getByRole('button', { name: 'Search', exact: true })).first();
  await searchButton.click();
  await page.waitForTimeout(5000);

  const text = await page.textContent('body').catch(() => '');
  if (isAccessDeniedText(text || '')) {
    return { ok: false, blocked: true, url: page.url(), text: text || '' };
  }
  return { ok: true, blocked: false, url: page.url(), text: text || '' };
}

async function uploadDownloadedFile(filePath) {
  const bytes = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const form = new FormData();
  form.set("subAccountId", String(resolvedSubAccountId()));
  form.set("documentKey", resolvedDocumentKey());
  form.set("linkCrashReportIds", JSON.stringify(CRASH_REPORT_IDS));
  form.set("source", "lee_clerk_cri_manual_download");
  form.set("file", new Blob([bytes], { type: "application/pdf" }), fileName);

  const res = await fetch(`${RAILWAY_URL}/api/admin/police-report-upload`, {
    method: "POST",
    headers: { "x-admin-secret": ADMIN_SECRET },
    body: form,
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error || `Upload failed (HTTP ${res.status})`);
  }
  return body;
}

async function uploadTextCapture(text, pageUrl) {
  const fileName = `${resolvedDocumentKey().replace(/[^A-Z0-9._:-]/gi, "_")}.txt`;
  const payload = [
    `Lee Clerk CRI Text Capture`,
    `Case Number: ${CASE_NUMBER}`,
    `Document Key: ${resolvedDocumentKey()}`,
    `Captured At: ${new Date().toISOString()}`,
    `Page URL: ${pageUrl}`,
    ``,
    `--- BEGIN CAPTURE ---`,
    text.trim(),
    `--- END CAPTURE ---`,
    ``,
  ].join("\n");

  const form = new FormData();
  form.set("subAccountId", String(resolvedSubAccountId()));
  form.set("documentKey", resolvedDocumentKey());
  form.set("linkCrashReportIds", JSON.stringify(CRASH_REPORT_IDS));
  form.set("source", "lee_clerk_cri_text_capture");
  form.set("file", new Blob([payload], { type: "text/plain" }), fileName);

  const res = await fetch(`${RAILWAY_URL}/api/admin/police-report-upload`, {
    method: "POST",
    headers: { "x-admin-secret": ADMIN_SECRET },
    body: form,
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error || `Upload failed (HTTP ${res.status})`);
  }
  return body;
}

async function main() {
  if (!CASE_NUMBER && !CITATION_NUMBER && !(Number.isFinite(CRASH_REPORT_ID) && CRASH_REPORT_ID > 0)) {
    fail("CASE_NUMBER, CITATION_NUMBER, or CRASH_REPORT_ID is required");
  }
  if (!CRASH_REPORT_IDS.length) fail("CRASH_REPORT_IDS must contain at least one crash report id");

  if (!CASE_NUMBER && !CITATION_NUMBER && Number.isFinite(CRASH_REPORT_ID) && CRASH_REPORT_ID > 0) {
    SEARCH_SEED = await fetchSearchSeed();
  }
  if (!resolvedSubAccountId()) fail("SUB_ACCOUNT_ID is required (or must be derivable from CRASH_REPORT_ID)");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lee-clerk-download-"));
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({
    acceptDownloads: true,
    downloadsPath: tmpDir,
    viewport: { width: 1440, height: 960 },
    locale: "en-US",
  });
  const page = await context.newPage();
  const rl = readline.createInterface({ input, output });

  try {
    log(`Opening Lee Clerk CRI for ${
      CASE_NUMBER
        ? `case ${CASE_NUMBER}`
        : CITATION_NUMBER
          ? `citation ${CITATION_NUMBER}`
          : `crash report ${CRASH_REPORT_ID}`
    }`);
    await page.goto(CRI_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500);

    log("Auto-filling Lee Clerk traffic search...");
    const searchAttempt = await attemptAutomatedSearch(page);

    const seedSummary = SEARCH_SEED
      ? `
Crash-derived search seed:
  County: ${SEARCH_SEED.county || "LEE"}
  Date From: ${SEARCH_SEED.searchDateFrom}
  Date To: ${SEARCH_SEED.searchDateTo}
  Location: ${SEARCH_SEED.location || "n/a"}
  Tokens: ${(SEARCH_SEED.locationTokens || []).join(", ") || "n/a"}
  Remarks: ${SEARCH_SEED.remarks || "n/a"}
`
      : "";

    console.log(`
[LEE-CLERK] Manual steps:
  1. Sign into Court Records Inquiry if needed
  2. ${searchAttempt.blocked ? "The script filled the search, but Akamai blocked the automated submit." : "Review the search results / case page the script opened."}
  3. ${searchAttempt.blocked ? "Click Search manually in the browser, then open the matching case." : "Open the matching case / document view."}
  4. Either download the file OR let the script capture the visible page text
${seedSummary}

The captured file/text will be uploaded into Apex and linked to crash report(s):
  ${CRASH_REPORT_IDS.join(", ")}

Synthetic document key:
  ${resolvedDocumentKey()}
`);

    if (searchAttempt.blocked) {
      log("Akamai blocked automated submit. Reloading the search form and re-filling it for a manual click...");
      await page.goto(CRI_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(2500);
      await configureLeeTrafficSearch(page);
    } else {
      log(`Search request reached ${searchAttempt.url}`);
    }

    await rl.question("Press Enter once the result list or matching case is open...");

    const visibleText = await page.evaluate(() => document.body?.innerText || "");
    const candidateCases = extractCandidateCaseNumbers(visibleText);
    if (candidateCases.length > 0) {
      console.log(`\n[LEE-CLERK] Candidate case numbers found on page:\n  ${candidateCases.join("\n  ")}\n`);
    } else if (SEARCH_SEED) {
      console.log("\n[LEE-CLERK] No obvious case numbers were extracted from the visible page text.\n");
    }

    await rl.question("Press Enter once the matching case / document view is open and you're ready to continue...");
    const mode = (await rl.question("Type [d] to wait for a download, or [t] to capture visible page text: ")).trim().toLowerCase();

    if (mode === "t") {
      const capture = await page.evaluate(() => ({
        text: document.body?.innerText || "",
        url: window.location.href,
      }));

      if (!capture.text.trim()) {
        fail("No visible page text was captured");
      }

      const confirm = await rl.question("Upload this text capture into Apex and attach it to the crash report(s)? [Y/n] ");
      if (confirm.trim().toLowerCase() === "n") {
        log("Skipped upload at operator request");
        return;
      }

      const uploaded = await uploadTextCapture(capture.text, capture.url);
      log(`Uploaded text capture ${uploaded.documentId} and linked crash report(s): ${uploaded.linkedCrashReportIds.join(", ")}`);
      console.log(JSON.stringify(uploaded, null, 2));
      return;
    }

    log("Waiting for a Lee Clerk document download...");
    const download = await page.waitForEvent("download", { timeout: 10 * 60_000 });
    const suggestedName = download.suggestedFilename();
    const targetPath = path.join(tmpDir, suggestedName);
    await download.saveAs(targetPath);
    log(`Downloaded: ${suggestedName}`);

    const confirm = await rl.question("Upload this file into Apex and attach it to the crash report(s)? [Y/n] ");
    if (confirm.trim().toLowerCase() === "n") {
      log("Skipped upload at operator request");
      return;
    }

    const uploaded = await uploadDownloadedFile(targetPath);
    log(`Uploaded document ${uploaded.documentId} and linked crash report(s): ${uploaded.linkedCrashReportIds.join(", ")}`);
    console.log(JSON.stringify(uploaded, null, 2));
  } finally {
    rl.close();
    await browser.close().catch(() => {});
  }
}

main().catch((error) => fail(error?.message || String(error)));
