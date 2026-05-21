#!/usr/bin/env node
/**
 * Auto-refreshes the FLHSMV session cookie using Playwright Chromium.
 * Playwright reads cookies directly via Chrome DevTools Protocol — no SQLite
 * decryption needed, no keychain issues. HttpOnly cookies are fully accessible.
 *
 * Headless: false so the browser window is visible and Akamai sees a real
 * browser environment (helps pass the JS challenge from a residential IP).
 *
 * Writes the cookie to:
 *   1. Railway via the admin endpoint (for the server-side worker)
 *   2. /tmp/flhsmv-atlas-cookie.txt (for flhsmv-local-agent.mjs)
 */

import { chromium }    from "playwright";
import { writeFileSync } from "fs";

const FLHSMV_URL    = "https://services.flhsmv.gov/crashreportrequest/";
const RAILWAY_URL   = "https://apexmarketingautomations.com/api/admin/flhsmv-cookie";
const ADMIN_SECRET  = "201120062017";
const COOKIE_CACHE  = "/tmp/flhsmv-atlas-cookie.txt";

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${msg}`);
}

async function main() {
  log("Launching Playwright Chromium (headless:false so Akamai sees a real browser)...");
  // Use Playwright's bundled Chromium — no real Chrome installation required.
  // Residential IP + headless:false is sufficient to pass Akamai's JS challenge.
  const browser = await chromium.launch({ headless: false, slowMo: 50 });

  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale:    "en-US",
      viewport:  { width: 1280, height: 800 },
    });

    // Mask automation signals that Akamai's JS challenge checks
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins",   { get: () => [1, 2, 3] });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      window.chrome = { runtime: {} };
    });

    const page = await context.newPage();

    log("Navigating to FLHSMV crash report page...");
    await page.goto(FLHSMV_URL, { waitUntil: "networkidle", timeout: 60000 });

    // Extra wait for Akamai's JS challenge to complete and set its cookies
    await page.waitForTimeout(6000);

    // Read ALL cookies via CDP — this includes HttpOnly cookies that
    // document.cookie can never see. Values are plain strings, no decryption needed.
    const cookies = await context.cookies(FLHSMV_URL);
    const want    = new Set(["ASP.NET_SessionId", "bm_sv", "ak_bmsc"]);
    const found   = cookies.filter(c => want.has(c.name));

    log(`Cookies captured: ${found.map(c => c.name).join(", ") || "(none)"}`);

    const sessionCookie = found.find(c => c.name === "ASP.NET_SessionId");
    if (!sessionCookie) {
      log("ERROR: ASP.NET_SessionId not found — FLHSMV may be blocking the request");
      process.exit(1);
    }

    const cookieHeader = found.map(c => `${c.name}=${c.value}`).join("; ");
    log(`Cookie string: ${cookieHeader.length} chars`);

    // 1. Push to Railway
    log("Pushing to Railway...");
    const res  = await fetch(RAILWAY_URL, {
      method:  "POST",
      headers: { "x-admin-secret": ADMIN_SECRET, "Content-Type": "application/json" },
      body:    JSON.stringify({ cookie: cookieHeader }),
    });
    const body = await res.json().catch(() => ({}));

    if (!body.ok) {
      log(`ERROR: Railway push failed: ${JSON.stringify(body)}`);
      process.exit(1);
    }
    log("SUCCESS — cookie injected into Railway");

    // 2. Write cache file for flhsmv-local-agent.mjs
    try {
      writeFileSync(COOKIE_CACHE, cookieHeader, { mode: 0o600 });
      log(`Cached to ${COOKIE_CACHE}`);
    } catch (e) {
      log(`WARN: Could not write cookie cache: ${e.message}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
