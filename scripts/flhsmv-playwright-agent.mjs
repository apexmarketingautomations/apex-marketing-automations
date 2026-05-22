#!/usr/bin/env node
/**
 * FLHSMV Playwright Agent — replaces flhsmv-local-agent.mjs.
 *
 * Problem: Akamai fingerprints the TLS handshake and blocks Node.js fetch
 * (undici JA3 ≠ Chrome JA3) even from a residential IP with valid cookies.
 *
 * Solution: route ALL FLHSMV API calls through a Playwright Chromium browser
 * window via page.evaluate(). The browser has Chrome's real TLS stack so
 * Akamai sees an indistinguishable client.
 *
 * Flow:
 *   1. Launch Chromium (headless:false for Akamai JS challenge)
 *   2. Navigate to FLHSMV portal → Akamai sets session cookies
 *   3. Fetch pending batch from Railway (Node.js — no Akamai)
 *   4. For each report: SearchReport + GetReport via page.evaluate (browser)
 *   5. Score candidates in Node.js, push results to Railway (Node.js)
 */

import { chromium } from "playwright";

const RAILWAY_URL  = "https://apexmarketingautomations.com";
const ADMIN_SECRET = "201120062017";
const FLHSMV_BASE  = "https://services.flhsmv.gov";
const FLHSMV_URL   = `${FLHSMV_BASE}/crashreportrequest/`;
const BATCH_LIMIT  = 5;
const MIN_SCORE    = 20;
const INTER_DELAY  = 1500; // ms between reports
const OUTAGE_MARKER = "We apologize for the inconvenience, our site is unavailable at this time.";

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${msg}`);
}

// ── Candidate scoring (mirrors server/crashReportWorker.ts scoreCandidate) ───

const STOPWORDS = new Set([
  "NORTH","SOUTH","EAST","WEST","BOUND","COUNTY","FLORIDA",
  "STATE","ROAD","STREET","AVENUE","BLVD","HIGHWAY","PARKWAY",
]);

function parseTimeToMinutes(s) {
  const parts = (s || "").split(":");
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return (isNaN(h) || isNaN(m)) ? null : h * 60 + m;
}

function scoreCandidate(candidate, location, lat, lng, receivedTimestamp) {
  let score = 0;
  const signals = [];

  const rStreet = ((candidate.CrashStreet || candidate.Location || "")).toUpperCase();
  const rCity   = ((candidate.CrashCity   || "")).toUpperCase();
  const rFull   = `${rStreet} ${rCity}`;
  const locUp   = (location || "").toUpperCase();

  const hwMatches = locUp.match(/\b(I[-\s]?\d{2,3}|US[-\s]?\d{1,3}|SR[-\s]?\d{1,3}|CR[-\s]?\d{1,3}|FL[-\s]?\d{1,3})\b/g) ?? [];
  for (const hw of hwMatches) {
    const norm = hw.replace(/[-\s]/g, "");
    if (rFull.replace(/[-\s]/g, "").includes(norm)) {
      score += 40; signals.push(`highway(${hw.trim()})+40`); break;
    }
  }

  const mmMatch = locUp.match(/\bMM\s*(\d+)/);
  if (mmMatch) {
    const mmNum = mmMatch[1];
    const rAll = JSON.stringify(candidate).toUpperCase();
    if (rAll.includes(`MM ${mmNum}`) || rAll.includes(`MM${mmNum}`)) {
      score += 25; signals.push(`mileMarker(${mmNum})+25`);
    }
  }

  const locWords = locUp.split(/[\s,x\[\]/]+/)
    .filter(w => w.length > 4 && !STOPWORDS.has(w) && !/^(NB|SB|EB|WB|NW|SW|NE|SE)$/.test(w));
  const wordMatches = locWords.filter(w => rFull.includes(w));
  if (wordMatches.length >= 2) {
    score += 20; signals.push(`streetWords(${wordMatches.slice(0, 3).join(",")})+20`);
  } else if (wordMatches.length === 1 && score === 0) {
    score += 5; signals.push(`weakWord(${wordMatches[0]})+5`);
  }

  const rLat = candidate.Latitude  ?? candidate.lat;
  const rLng = candidate.Longitude ?? candidate.lng;
  if (lat != null && lng != null && rLat != null && rLng != null) {
    const dLat = (lat - Number(rLat)) * 111_000;
    const dLng = (lng - Number(rLng)) * 111_000 * Math.cos((lat * Math.PI) / 180);
    const distM = Math.sqrt(dLat * dLat + dLng * dLng);
    if (distM < 2_000) { score += 10; signals.push(`gps(${Math.round(distM)}m)+10`); }
  }

  if (receivedTimestamp && candidate.CrashTime) {
    const timePart = receivedTimestamp.includes(" ") ? receivedTimestamp.split(" ")[1] : receivedTimestamp;
    const sentMin = parseTimeToMinutes(timePart);
    const flMin   = parseTimeToMinutes(candidate.CrashTime);
    if (sentMin !== null && flMin !== null && Math.abs(sentMin - flMin) <= 30) {
      score += 5; signals.push(`time(Δ${Math.abs(sentMin - flMin)}min)+5`);
    }
  }

  return { score, breakdown: signals.join(" | ") || "no signals" };
}

// ── Railway helpers (plain Node.js fetch — no Akamai) ────────────────────────

async function fetchPendingBatch() {
  const res = await fetch(
    `${RAILWAY_URL}/api/admin/flhsmv-pending-batch?limit=${BATCH_LIMIT}`,
    { headers: { "x-admin-secret": ADMIN_SECRET } }
  );
  const body = await res.json();
  return body.reports ?? [];
}

async function pushResults(results) {
  const res = await fetch(`${RAILWAY_URL}/api/admin/flhsmv-batch-result`, {
    method:  "POST",
    headers: { "x-admin-secret": ADMIN_SECRET, "Content-Type": "application/json" },
    body:    JSON.stringify({ results }),
  });
  return res.json().catch(() => ({}));
}

// ── FLHSMV API via browser (Akamai-safe) ─────────────────────────────────────

async function browserSearch(page, county, crashDate) {
  // Normalize date to YYYY-MM-DD
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(crashDate)
    ? crashDate
    : crashDate.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$1-$2");

  return page.evaluate(
    async ({ county, date }) => {
      try {
        const res = await fetch("/CRRService/api/CrashReport/SearchReport", {
          method:  "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body:    JSON.stringify({ County: county, CrashDate: date }),
        });
        if (!res.ok) return { error: res.status };
        const data = await res.json();
        return { ok: true, data };
      } catch (e) {
        return { error: e.message };
      }
    },
    { county: county.toUpperCase(), date: isoDate }
  );
}

async function browserGetReport(page, reportNumber) {
  return page.evaluate(
    async (rn) => {
      try {
        const res = await fetch(`/CRRService/api/CrashReport/GetReport/${encodeURIComponent(rn)}`, {
          headers: { "Accept": "application/json" },
        });
        if (!res.ok) return { error: res.status };
        const data = await res.json();
        return { ok: true, data };
      } catch (e) {
        return { error: e.message };
      }
    },
    reportNumber
  );
}

async function portalLooksHealthy(page, response) {
  const status = response?.status?.() ?? 0;
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const outage = status >= 500 || bodyText.includes(OUTAGE_MARKER);
  if (outage) {
    log(`FLHSMV portal unavailable (status=${status || "unknown"}) — skipping batch claim`);
    if (bodyText) {
      log(`Portal preview: ${bodyText.slice(0, 160).replace(/\s+/g, " ")}`);
    }
  }
  return !outage;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log("=== FLHSMV Playwright Agent ===");

  log("Launching Chromium and navigating to FLHSMV...");
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
  });

  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale:    "en-US",
      viewport:  { width: 1280, height: 800 },
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins",   { get: () => [1, 2, 3] });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      window.chrome = { runtime: {} };
    });

    const page = await context.newPage();
    const response = await page.goto(FLHSMV_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(6000); // let Akamai JS challenge complete

    if (!(await portalLooksHealthy(page, response))) {
      return;
    }

    log("Browser session ready — fetching pending batch from Railway...");
    let reports;
    try {
      reports = await fetchPendingBatch();
    } catch (e) {
      log(`ERROR fetching batch: ${e.message}`);
      process.exit(1);
    }

    if (reports.length === 0) {
      log("No eligible reports — queue clear");
      return;
    }
    log(`Claimed ${reports.length} report(s) from Railway`);

    const results = [];

    for (const report of reports) {
      const { id, reportNumber, county, crashDate, location, lat, lng, received } = report;
      log(`[${id}] ${county} / ${crashDate} — "${location}"`);

      await new Promise(r => setTimeout(r, INTER_DELAY));

      // Search
      const searchResp = await browserSearch(page, county || "", crashDate || "");
      if (searchResp.error) {
        log(`  [${id}] Search failed: ${searchResp.error}`);
        results.push({ crashReportId: id, reportNumber, type: "upstream_error", statusCode: searchResp.error, errorMessage: `HTTP ${searchResp.error}` });
        continue;
      }

      const raw        = searchResp.data;
      const candidates = Array.isArray(raw) ? raw : (raw?.ReportNumber ? [raw] : []);

      if (candidates.length === 0) {
        log(`  [${id}] No candidates`);
        results.push({ crashReportId: id, reportNumber, type: "not_found" });
        continue;
      }

      // Score
      let best = null, bestScore = -1;
      for (const c of candidates) {
        const { score, breakdown } = scoreCandidate(c, location, lat, lng, received);
        if (score > bestScore) { best = c; bestScore = score; }
        if (score >= MIN_SCORE) log(`  [${id}] candidate score=${score} ${breakdown}`);
      }

      if (!best || bestScore < MIN_SCORE) {
        log(`  [${id}] No candidate met MIN_SCORE (best=${bestScore})`);
        results.push({ crashReportId: id, reportNumber, type: "not_found" });
        continue;
      }

      const winnerRN = best.ReportNumber ?? best.reportNumber;
      log(`  [${id}] Winner: ${winnerRN} (score=${bestScore})`);

      // Detail
      const detailResp = await browserGetReport(page, winnerRN);
      if (detailResp.error) {
        log(`  [${id}] GetReport failed: ${detailResp.error}`);
        results.push({ crashReportId: id, reportNumber, type: "upstream_error", statusCode: detailResp.error, errorMessage: `HTTP ${detailResp.error}` });
        continue;
      }

      log(`  [${id}] Detail fetched — SUCCESS`);
      results.push({
        crashReportId: id,
        reportNumber,
        type:         "success",
        searchResult: best,
        detail:       detailResp.data,
      });
    }

    log(`Pushing ${results.length} result(s) to Railway...`);
    const pushResp = await pushResults(results);
    const summary = (pushResp.outcomes ?? [])
      .map(o => `${o.crashReportId}→${o.action}`)
      .join(", ");
    log(`SUCCESS: ${summary || JSON.stringify(pushResp)}`);

  } finally {
    await browser.close();
  }
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
