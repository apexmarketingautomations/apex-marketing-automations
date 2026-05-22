#!/usr/bin/env node
/**
 * Lee Clerk Clipboard Upload
 *
 * No browser automation — no Akamai issues.
 *
 * Steps:
 *   1. Open https://matrix.leeclerk.org in Safari or Atlas
 *   2. Search for the case manually, open the case page
 *   3. Press Cmd+A  then  Cmd+C  to copy all text on the page
 *   4. Run this script — it reads your clipboard and uploads to Railway
 *
 * Required env:
 *   CASE_NUMBER=24-CT-004321
 *   CRASH_REPORT_IDS=456
 *   SUB_ACCOUNT_ID=3
 */

import { execSync } from "child_process";

const RAILWAY_URL  = process.env.RAILWAY_URL  || "https://apexmarketingautomations.com";
const ADMIN_SECRET = process.env.STANDALONE_ADMIN_SECRET || "201120062017";
const CASE_NUMBER  = String(process.env.CASE_NUMBER  || "").trim();
const CITATION_NUMBER = String(process.env.CITATION_NUMBER || "").trim();
const SUB_ACCOUNT_ID  = Number(process.env.SUB_ACCOUNT_ID  || "");
const CRASH_REPORT_IDS = String(process.env.CRASH_REPORT_IDS || "")
  .split(",")
  .map((v) => Number(v.trim()))
  .filter((id) => Number.isFinite(id) && id > 0);

function fail(msg) {
  console.error(`\n[LEE-CLERK] ${msg}\n`);
  process.exit(1);
}

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${msg}`);
}

function documentKey() {
  if (CASE_NUMBER)    return `LEE-CRI:${CASE_NUMBER}`;
  if (CITATION_NUMBER) return `LEE-CRI:CITATION:${CITATION_NUMBER}`;
  return "LEE-CRI:UNSPECIFIED";
}

async function main() {
  if (!CASE_NUMBER && !CITATION_NUMBER) fail("CASE_NUMBER or CITATION_NUMBER is required");
  if (!CRASH_REPORT_IDS.length)         fail("CRASH_REPORT_IDS is required");
  if (!SUB_ACCOUNT_ID)                  fail("SUB_ACCOUNT_ID is required");

  // Read clipboard via macOS pbpaste
  let text;
  try {
    text = execSync("pbpaste", { maxBuffer: 10 * 1024 * 1024 }).toString().trim();
  } catch (e) {
    fail(`Could not read clipboard: ${e.message}`);
  }

  if (!text || text.length < 30) {
    fail("Clipboard looks empty. Open the Lee Clerk case page, press Cmd+A then Cmd+C, then run this script.");
  }

  log(`Read ${text.length} chars from clipboard`);
  log(`Uploading as ${documentKey()} → crash reports: ${CRASH_REPORT_IDS.join(", ")}`);

  const key      = documentKey();
  const fileName = `${key.replace(/[^A-Z0-9._:-]/gi, "_")}.txt`;
  const payload  = [
    `Lee Clerk CRI Text Capture`,
    `Case Number: ${CASE_NUMBER || CITATION_NUMBER}`,
    `Document Key: ${key}`,
    `Captured At: ${new Date().toISOString()}`,
    `Source: clipboard`,
    ``,
    `--- BEGIN CAPTURE ---`,
    text,
    `--- END CAPTURE ---`,
    ``,
  ].join("\n");

  const form = new FormData();
  form.set("subAccountId",       String(SUB_ACCOUNT_ID));
  form.set("documentKey",        key);
  form.set("officialReportNumber", key);
  form.set("linkCrashReportIds", JSON.stringify(CRASH_REPORT_IDS));
  form.set("source",             "lee_clerk_cri_clipboard");
  form.set("file", new Blob([payload], { type: "text/plain" }), fileName);

  const res = await fetch(`${RAILWAY_URL}/api/admin/police-report-upload`, {
    method:  "POST",
    headers: { "x-admin-secret": ADMIN_SECRET },
    body:    form,
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.ok) {
    fail(body?.error || `Upload failed (HTTP ${res.status})`);
  }

  log(`Uploaded — document ID: ${body.documentId}`);
  log(`Linked crash reports: ${body.linkedCrashReportIds?.join(", ") ?? "none"}`);
  console.log(JSON.stringify(body, null, 2));
}

main().catch((err) => fail(err?.message || String(err)));
