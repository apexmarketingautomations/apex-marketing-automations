#!/usr/bin/env node
/**
 * Lee Clerk Auto-Finder + Upload
 *
 * Fully automated v2:
 *   1. Opens Lee County CRI in Playwright Chromium
 *   2. Auto-fills and submits the traffic search
 *   3. Scores result rows against crash seed data, navigates to best match
 *   4. Captures page text (or downloads PDF if available)
 *   5. Uploads into Apex and links to crash report(s)
 *
 * Required env:
 *   CRASH_REPORT_IDS=123,456
 *
 * One of:
 *   CASE_NUMBER=24-TR-012345        (direct case lookup — skips scoring)
 *   CITATION_NUMBER=1234567890      (direct citation lookup)
 *   CRASH_REPORT_ID=123             (derives search seed from Railway)
 *
 * Optional:
 *   SUB_ACCOUNT_ID=3
 *   RAILWAY_URL=https://apexmarketingautomations.com
 *   STANDALONE_ADMIN_SECRET=...
 *   DOCUMENT_KEY=LEE-CRI:24-TR-012345
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { chromium } from "playwright";

const RAILWAY_URL = process.env.RAILWAY_URL || "https://apexmarketingautomations.com";
const ADMIN_SECRET = process.env.STANDALONE_ADMIN_SECRET || "201120062017";
const CRASH_REPORT_ID = Number(process.env.CRASH_REPORT_ID || "");
const CASE_NUMBER = String(process.env.CASE_NUMBER || "").trim();
const CITATION_NUMBER = String(process.env.CITATION_NUMBER || "").trim();
const SUB_ACCOUNT_ID = Number(process.env.SUB_ACCOUNT_ID || "");
const CRASH_REPORT_IDS = String(process.env.CRASH_REPORT_IDS || "")
  .split(",")
  .map((v) => Number(v.trim()))
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

// ── Search seed ───────────────────────────────────────────────────────────────

async function fetchSearchSeed() {
  if (!Number.isFinite(CRASH_REPORT_ID) || CRASH_REPORT_ID <= 0) return null;

  try {
    const res = await fetch(`${RAILWAY_URL}/api/admin/lee-clerk-search-seed/${CRASH_REPORT_ID}`, {
      headers: { "x-admin-secret": ADMIN_SECRET },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.ok) {
      log(`WARN: search seed unavailable for crash report ${CRASH_REPORT_ID} — ${body?.error ?? `HTTP ${res.status}`}. Continuing without seed.`);
      return null;
    }
    return body;
  } catch (e) {
    log(`WARN: search seed fetch failed (${e.message}) — continuing without seed`);
    return null;
  }
}

// ── Lee Clerk search form helpers ─────────────────────────────────────────────

async function configureLeeTrafficSearch(page) {
  const allToggle = page.locator("label", { hasText: "Check/Uncheck All" }).first();
  if (await allToggle.count()) {
    await allToggle.click();
    await page.waitForTimeout(300);
  }

  for (const selector of ["#cs_CaseTypes_5__CaseTypeChecked", "#cs_CaseTypes_18__CaseTypeChecked"]) {
    const checkbox = page.locator(selector);
    if (await checkbox.count()) {
      await checkbox.check();
      await page.waitForTimeout(150);
    }
  }

  if (CASE_NUMBER) await page.fill("#cs_CaseNumber", CASE_NUMBER);
  if (CITATION_NUMBER) await page.fill("#cs_CitationNumber", CITATION_NUMBER);
  if (!CASE_NUMBER && !CITATION_NUMBER && SEARCH_SEED?.searchDateFrom)
    await page.fill("#cs_DateFrom", SEARCH_SEED.searchDateFrom);
  if (!CASE_NUMBER && !CITATION_NUMBER && SEARCH_SEED?.searchDateTo)
    await page.fill("#cs_DateTo", SEARCH_SEED.searchDateTo);
}

async function attemptAutomatedSearch(page) {
  await configureLeeTrafficSearch(page);

  // Realistic pause before submitting (Akamai watches interaction velocity)
  await page.waitForTimeout(1200 + Math.floor(Math.random() * 800));

  // Prefer keyboard submit on a visible input — looks more human than a button click
  let submitted = false;
  for (const sel of ["#cs_CaseNumber", "#cs_CitationNumber", "#cs_DateFrom", "#cs_DateTo"]) {
    const el = page.locator(sel);
    if (await el.count() && await el.isVisible().catch(() => false)) {
      await el.focus();
      await page.waitForTimeout(200);
      await page.keyboard.press("Enter");
      submitted = true;
      break;
    }
  }

  if (!submitted) {
    const searchButton = page
      .locator("#submit2")
      .or(page.getByRole("button", { name: "Search", exact: true }))
      .first();
    await searchButton.click();
  }

  await page.waitForTimeout(6000);

  const text = await page.textContent("body").catch(() => "");
  if (isAccessDeniedText(text || "")) {
    return { ok: false, blocked: true, url: page.url() };
  }
  return { ok: true, blocked: false, url: page.url() };
}

// ── Result scoring ────────────────────────────────────────────────────────────

/**
 * Wait up to timeoutMs for at least one link that looks like a case number or
 * a CaseDetail href to appear on the page.
 */
async function waitForCaseLinks(page, timeoutMs = 15000) {
  try {
    await page.waitForFunction(
      () => {
        return Array.from(document.querySelectorAll("a")).some((a) => {
          const t = (a.innerText || "").trim();
          return (
            /\b\d{2,4}-[A-Za-z]{2,20}-\d{3,}\b/.test(t) ||
            (a.href || "").toLowerCase().includes("casedetail")
          );
        });
      },
      { timeout: timeoutMs }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract all case links visible on the results page, including surrounding
 * row text for scoring.
 */
async function extractCaseLinks(page) {
  return page.evaluate(() => {
    const seen = new Set();
    const results = [];

    for (const a of document.querySelectorAll("a")) {
      const href = a.href || "";
      const text = (a.innerText || "").trim();
      const caseMatch = text.match(/\b(\d{2,4}-[A-Za-z]{2,20}-\d{3,})\b/);
      const isCaseLink =
        caseMatch ||
        href.toLowerCase().includes("casedetail") ||
        /caseid|casenumber/i.test(href);

      if (!isCaseLink) continue;
      const key = href || text;
      if (seen.has(key)) continue;
      seen.add(key);

      const row = a.closest("tr");
      const rowText = row ? row.innerText.replace(/\s+/g, " ").trim() : text;

      results.push({
        caseNumber: caseMatch ? caseMatch[1].toUpperCase() : "",
        href,
        rowText,
        linkText: text,
      });
    }
    return results;
  });
}

/**
 * Score a result row against our crash seed and env inputs.
 * Returns a numeric score — higher is a better match.
 */
function scoreCaseLink(info, searchSeed, caseNumberEnv, citationNumberEnv) {
  const text = (info.rowText || "").toUpperCase();
  const cn = (info.caseNumber || "").toUpperCase();

  // Exact match shortcuts
  if (caseNumberEnv && cn === caseNumberEnv.toUpperCase()) return 1000;
  if (citationNumberEnv && text.includes(citationNumberEnv.toUpperCase())) return 900;

  let score = 0;

  // Traffic / criminal-traffic case types score higher
  if (/-(TR|MM|CT|TI)-/.test(cn)) score += 30;

  // Location token overlap from crash seed
  for (const token of searchSeed?.locationTokens ?? []) {
    if (token.length > 3 && text.includes(token.toUpperCase())) score += 20;
  }

  // Keyword hits from crash remarks
  for (const word of (searchSeed?.remarks ?? "").toUpperCase().split(/\W+/).filter((w) => w.length > 4)) {
    if (text.includes(word)) score += 5;
  }

  // DUI / crash-related charge keywords
  if (/DUI|RECKLESS|CARELESS|CRASH|ACCIDENT|INJURY|LEAVING SCENE|HOMICIDE/.test(text)) score += 15;

  return score;
}

// ── Content capture ───────────────────────────────────────────────────────────

/**
 * On a case detail page, try to download an attached PDF first.
 * Falls back to capturing visible page text.
 */
async function autoCaptureCase(page, tmpDir) {
  await page.waitForTimeout(2000);

  // Look for PDF / document download links
  const docLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a"))
      .map((a) => ({ href: a.href || "", text: (a.innerText || "").trim().toUpperCase() }))
      .filter(
        ({ href, text }) =>
          /\.pdf/i.test(href) ||
          href.toLowerCase().includes("getdocument") ||
          href.toLowerCase().includes("download") ||
          /pdf|document|download/.test(text)
      )
  );

  if (docLinks.length > 0) {
    log(`Found ${docLinks.length} document link(s) — attempting download`);
    try {
      const docHref = docLinks[0].href;
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 25_000 }),
        page.locator(`a[href="${docHref}"]`).first().click(),
      ]);
      const name = download.suggestedFilename() || "lee-clerk-doc.pdf";
      const target = path.join(tmpDir, name);
      await download.saveAs(target);
      log(`Downloaded: ${name}`);
      return { type: "download", filePath: target };
    } catch (e) {
      log(`Download attempt failed (${e.message}) — falling back to text capture`);
    }
  }

  // Text capture fallback
  const capture = await page.evaluate(() => ({
    text: document.body?.innerText || "",
    url: window.location.href,
  }));

  if (!capture.text.trim()) throw new Error("No visible page text captured");
  log(`Captured ${capture.text.length} chars from ${capture.url}`);
  return { type: "text", text: capture.text, url: capture.url };
}

// ── Upload helpers ────────────────────────────────────────────────────────────

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
  if (!res.ok || !body?.ok) throw new Error(body?.error || `Upload failed (HTTP ${res.status})`);
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
  if (!res.ok || !body?.ok) throw new Error(body?.error || `Upload failed (HTTP ${res.status})`);
  return body;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!CASE_NUMBER && !CITATION_NUMBER && !(Number.isFinite(CRASH_REPORT_ID) && CRASH_REPORT_ID > 0)) {
    fail("CASE_NUMBER, CITATION_NUMBER, or CRASH_REPORT_ID is required");
  }
  if (!CRASH_REPORT_IDS.length) fail("CRASH_REPORT_IDS must contain at least one crash report ID");

  if (!CASE_NUMBER && !CITATION_NUMBER && Number.isFinite(CRASH_REPORT_ID) && CRASH_REPORT_ID > 0) {
    log("Fetching search seed from Railway...");
    SEARCH_SEED = await fetchSearchSeed();
    log(
      `Seed: county=${SEARCH_SEED?.county} dates=${SEARCH_SEED?.searchDateFrom}→${SEARCH_SEED?.searchDateTo} tokens=${(SEARCH_SEED?.locationTokens ?? []).join(",")}`
    );
  }
  if (!resolvedSubAccountId()) fail("SUB_ACCOUNT_ID is required (or derivable from CRASH_REPORT_ID)");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lee-clerk-download-"));
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext({
    acceptDownloads: true,
    downloadsPath: tmpDir,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  // Mask automation signals that Akamai's JS challenge checks
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    log(
      `Searching Lee Clerk CRI for ${
        CASE_NUMBER ? `case ${CASE_NUMBER}` : CITATION_NUMBER ? `citation ${CITATION_NUMBER}` : `crash report ${CRASH_REPORT_ID}`
      }`
    );

    await page.goto(CRI_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500);

    log("Auto-filling and submitting traffic search...");
    const searchAttempt = await attemptAutomatedSearch(page);

    if (searchAttempt.blocked) {
      log("Akamai blocked — reloading and waiting longer before retry...");
      await page.goto(CRI_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      // Give Akamai's JS challenge more time to complete
      await page.waitForTimeout(5000);
      await configureLeeTrafficSearch(page);
      await page.waitForTimeout(2000 + Math.floor(Math.random() * 1000));

      // Retry via keyboard submit
      let resubmitted = false;
      for (const sel of ["#cs_CaseNumber", "#cs_CitationNumber", "#cs_DateFrom", "#cs_DateTo"]) {
        const el = page.locator(sel);
        if (await el.count() && await el.isVisible().catch(() => false)) {
          await el.focus();
          await page.waitForTimeout(300);
          await page.keyboard.press("Enter");
          resubmitted = true;
          break;
        }
      }
      if (!resubmitted) {
        const retryBtn = page
          .locator("#submit2")
          .or(page.getByRole("button", { name: "Search", exact: true }))
          .first();
        await retryBtn.click();
      }

      await page.waitForTimeout(6000);
      const retryText = await page.textContent("body").catch(() => "");
      if (isAccessDeniedText(retryText || "")) {
        fail("Akamai is still blocking after retry. Set CASE_NUMBER= directly and retry.");
      }
    } else {
      log(`Search submitted → ${searchAttempt.url}`);
    }

    // ── Wait for results ──────────────────────────────────────────────────────
    log("Waiting for results page...");
    const hasLinks = await waitForCaseLinks(page, 15_000);

    if (!hasLinks) {
      const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
      const candidates = extractCandidateCaseNumbers(bodyText);
      if (candidates.length === 0) {
        log("No case links or case numbers found — the search may have returned no results");
        log(`Page preview: ${bodyText.slice(0, 400).replace(/\s+/g, " ")}`);
        return;
      }
      // Results visible as text but no clickable links — capture as-is
      log(`No clickable links, but found case numbers: ${candidates.join(", ")}`);
      const uploaded = await uploadTextCapture(bodyText, page.url());
      log(`Uploaded text capture ${uploaded.documentId} → linked: ${uploaded.linkedCrashReportIds.join(", ")}`);
      console.log(JSON.stringify(uploaded, null, 2));
      return;
    }

    // ── Score and select best case ────────────────────────────────────────────
    const cases = await extractCaseLinks(page);
    log(`Extracted ${cases.length} case link(s) from results`);

    if (cases.length === 0) {
      log("Results page loaded but extractCaseLinks found nothing — capturing page text");
      const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
      const uploaded = await uploadTextCapture(bodyText, page.url());
      log(`Uploaded text capture ${uploaded.documentId}`);
      return;
    }

    const scored = cases
      .map((c) => ({ ...c, score: scoreCaseLink(c, SEARCH_SEED, CASE_NUMBER, CITATION_NUMBER) }))
      .sort((a, b) => b.score - a.score);

    log("Top candidates:");
    for (const s of scored.slice(0, 6)) {
      log(`  score=${String(s.score).padStart(4)} | ${(s.caseNumber || s.linkText).padEnd(22)} | ${s.rowText.slice(0, 90)}`);
    }

    const best = scored[0];

    if (!best.href) {
      log("Best candidate has no href — capturing current page text");
      const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
      const uploaded = await uploadTextCapture(bodyText, page.url());
      log(`Uploaded text capture ${uploaded.documentId}`);
      return;
    }

    // ── Navigate to best case ─────────────────────────────────────────────────
    log(`Auto-navigating to best match: ${best.caseNumber || best.linkText} (score=${best.score})`);
    await page.goto(best.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2500);

    // ── Capture and upload ────────────────────────────────────────────────────
    const capture = await autoCaptureCase(page, tmpDir);

    let uploaded;
    if (capture.type === "download") {
      uploaded = await uploadDownloadedFile(capture.filePath);
      log(`Uploaded document ${uploaded.documentId} → linked crash reports: ${uploaded.linkedCrashReportIds.join(", ")}`);
    } else {
      uploaded = await uploadTextCapture(capture.text, capture.url);
      log(`Uploaded text capture ${uploaded.documentId} → linked crash reports: ${uploaded.linkedCrashReportIds.join(", ")}`);
    }

    console.log(JSON.stringify(uploaded, null, 2));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => fail(err?.message || String(err)));
