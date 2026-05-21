#!/usr/bin/env node
/**
 * FLHSMV Police Report Agent
 *
 * Runs on a local Mac / residential connection and pulls police report PDFs for
 * crash reports that already have an official FLHSMV report number. Uses a real
 * Playwright Chromium browser so the FLHSMV download call rides Chrome's TLS
 * stack instead of Node's Akamai-blocked fingerprint.
 *
 * Flow:
 *   1. Fetch pending PDF jobs from Railway
 *   2. Launch Chromium, warm FLHSMV portal
 *   3. Download PDF/ZIP in the browser via DownloadReport/GetDocument
 *   4. Upload the file back to Railway once
 *   5. Report retry/failure states for anything not fetched yet
 */

import { chromium } from "playwright";

const RAILWAY_URL = process.env.RAILWAY_URL || "https://apexmarketingautomations.com";
const ADMIN_SECRET = process.env.STANDALONE_ADMIN_SECRET || "201120062017";
const FLHSMV_BASE = "https://services.flhsmv.gov";
const FLHSMV_URL = `${FLHSMV_BASE}/crashreportrequest/`;
const PDF_CANDIDATES = [
  "/CRRService/api/CrashReport/DownloadReport",
  "/CRRService/api/CrashReport/GetDocument",
];
const BATCH_LIMIT = Number(process.env.POLICE_REPORT_BATCH_LIMIT || 3);
const INTER_DELAY_MS = Number(process.env.POLICE_REPORT_INTER_DELAY_MS || 1500);

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sniffKindFromBase64(base64 = "") {
  if (base64.startsWith("JVBERi0")) return "pdf";
  if (base64.startsWith("UEsDB")) return "zip";
  return null;
}

async function fetchPendingBatch() {
  const res = await fetch(
    `${RAILWAY_URL}/api/admin/police-report-pending-batch?limit=${BATCH_LIMIT}`,
    { headers: { "x-admin-secret": ADMIN_SECRET } },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return body.jobs ?? [];
}

async function pushFailures(results) {
  if (!results.length) return { ok: true, processed: 0, outcomes: [] };
  const res = await fetch(`${RAILWAY_URL}/api/admin/police-report-batch-result`, {
    method: "POST",
    headers: {
      "x-admin-secret": ADMIN_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ results }),
  });
  return res.json().catch(() => ({}));
}

async function uploadPoliceReport(job, fetched) {
  const ext = fetched.kind === "zip" ? "zip" : "pdf";
  const mimeType =
    fetched.kind === "zip"
      ? "application/zip"
      : fetched.mimeType || "application/pdf";
  const fileName = `police-report-${String(job.officialReportNumber).replace(/[^A-Z0-9._-]/gi, "_")}.${ext}`;
  const bytes = Buffer.from(fetched.base64, "base64");

  const form = new FormData();
  form.set("crashReportId", String(job.crashReportId));
  form.set("subAccountId", String(job.subAccountId));
  form.set("officialReportNumber", job.officialReportNumber);
  form.set("source", "local_playwright_pdf_agent");
  form.set("file", new Blob([bytes], { type: mimeType }), fileName);

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

async function browserDownloadReport(page, officialReportNumber) {
  for (const base of PDF_CANDIDATES) {
    const url = `${base}/${encodeURIComponent(String(officialReportNumber).trim())}`;
    const result = await page.evaluate(async ({ relativeUrl }) => {
      try {
        const response = await fetch(relativeUrl, {
          method: "GET",
          headers: {
            Accept: "application/pdf,application/octet-stream,application/zip,*/*",
          },
        });

        const contentType = response.headers.get("content-type") || "";
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const signatureHex = Array.from(bytes.slice(0, 4))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");

        const blob = new Blob([arrayBuffer], {
          type: contentType || "application/octet-stream",
        });

        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
          reader.readAsDataURL(blob);
        });

        return {
          ok: response.ok,
          status: response.status,
          contentType,
          signatureHex,
          dataUrl,
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }, { relativeUrl: url });

    if (result?.error) {
      return {
        type: "error",
        endpoint: url,
        status: result.status || 0,
        message: result.error,
      };
    }

    if (!result?.ok) {
      if (result?.status === 404) {
        continue;
      }
      return {
        type: "error",
        endpoint: url,
        status: result?.status || 0,
        message: `HTTP ${result?.status || 0}`,
      };
    }

    const base64 = typeof result.dataUrl === "string" ? result.dataUrl.split(",")[1] || "" : "";
    const contentType = String(result.contentType || "").toLowerCase();
    const signatureHex = String(result.signatureHex || "").toLowerCase();
    const kind =
      contentType.includes("zip") || signatureHex.startsWith("504b")
        ? "zip"
        : contentType.includes("pdf") || signatureHex.startsWith("25504446")
          ? "pdf"
          : sniffKindFromBase64(base64);

    if (!kind) {
      continue;
    }

    return {
      type: "success",
      endpoint: url,
      base64,
      mimeType: contentType,
      kind,
    };
  }

  return { type: "not_found" };
}

async function main() {
  log("=== FLHSMV Police Report Agent ===");

  let jobs;
  try {
    jobs = await fetchPendingBatch();
  } catch (error) {
    log(`ERROR fetching pending PDF jobs: ${error.message}`);
    process.exit(1);
  }

  if (!jobs.length) {
    log("No police report PDF jobs waiting");
    return;
  }

  log(`Claimed ${jobs.length} police report job(s)`);
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
  });

  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      window.chrome = { runtime: {} };
    });

    const page = await context.newPage();
    await page.goto(FLHSMV_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(6000);

    const failures = [];
    let uploaded = 0;

    for (const job of jobs) {
      log(`[${job.crashReportId}] Downloading ${job.officialReportNumber}`);
      await sleep(INTER_DELAY_MS);

      const fetched = await browserDownloadReport(page, job.officialReportNumber);

      if (fetched.type === "success") {
        try {
          const upload = await uploadPoliceReport(job, fetched);
          uploaded += 1;
          log(`  [${job.crashReportId}] Uploaded ${fetched.kind.toUpperCase()} → doc ${upload.documentId}`);
        } catch (error) {
          log(`  [${job.crashReportId}] Upload failed: ${error.message}`);
          failures.push({
            crashReportId: job.crashReportId,
            subAccountId: job.subAccountId,
            officialReportNumber: job.officialReportNumber,
            type: "network_error",
            errorMessage: error.message,
            source: "local_playwright_pdf_agent",
          });
        }
        continue;
      }

      if (fetched.type === "not_found") {
        log(`  [${job.crashReportId}] No PDF/ZIP endpoint matched yet`);
        failures.push({
          crashReportId: job.crashReportId,
          subAccountId: job.subAccountId,
          officialReportNumber: job.officialReportNumber,
          type: "not_found",
          source: "local_playwright_pdf_agent",
        });
        continue;
      }

      log(`  [${job.crashReportId}] Download failed (${fetched.status || "?"}): ${fetched.message}`);
      failures.push({
        crashReportId: job.crashReportId,
        subAccountId: job.subAccountId,
        officialReportNumber: job.officialReportNumber,
        type: fetched.status && fetched.status >= 500 ? "upstream_error" : "network_error",
        statusCode: fetched.status || null,
        errorMessage: fetched.message || `Failed via ${fetched.endpoint}`,
        source: "local_playwright_pdf_agent",
      });
    }

    const pushResp = await pushFailures(failures);
    log(`Done — uploaded ${uploaded}, failures recorded ${failures.length}`);
    if (failures.length) {
      log(`Failure sync: ${JSON.stringify(pushResp)}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  log(`FATAL: ${error.message}`);
  process.exit(1);
});
