#!/usr/bin/env node
/**
 * FLHSMV Local Agent — runs on Mac to bypass Akamai datacenter IP blocking.
 *
 * Railway's IP range is blocked by Akamai on services.flhsmv.gov regardless of
 * valid session cookies. The Mac has a residential IP that passes Akamai freely.
 *
 * Flow:
 *   1. Extract Atlas session cookie (same as refresh-flhsmv-cookie-atlas.mjs)
 *   2. Fetch pending batch from Railway (/api/admin/flhsmv-pending-batch)
 *   3. Call FLHSMV SearchReport + GetReport locally for each report
 *   4. Push results to Railway (/api/admin/flhsmv-batch-result)
 *
 * Run manually:
 *   node scripts/flhsmv-local-agent.mjs
 *
 * Add to launchd (runs automatically every 5 min):
 *   See com.apex.flhsmv-local-agent.plist
 */

import { execFileSync } from "child_process";
import { readFileSync, statSync } from "fs";

const RAILWAY_URL   = "https://apexmarketingautomations.com";
const ADMIN_SECRET  = "201120062017";
const FLHSMV_BASE   = "https://services.flhsmv.gov";
const FLHSMV_SEARCH = `${FLHSMV_BASE}/CRRService/api/CrashReport/SearchReport`;
const FLHSMV_DETAIL = `${FLHSMV_BASE}/CRRService/api/CrashReport/GetReport`;
const BATCH_LIMIT   = 5;
const MIN_SCORE     = 20;
const TIMEOUT_MS    = 30_000;
const INTER_DELAY   = 600; // ms between reports
// Cookie written by refresh-flhsmv-cookie-atlas.mjs after each successful Atlas extraction.
// We read from here to avoid the keychain ETIMEDOUT that occurs in launchd context.
const COOKIE_CACHE  = "/tmp/flhsmv-atlas-cookie.txt";
// If the cache is older than 25 min, the session has likely expired.
const COOKIE_MAX_AGE_MS = 25 * 60 * 1000;

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${msg}`);
}

// ── Atlas cookie extraction ───────────────────────────────────────────────────
// Reads and decrypts the FLHSMV session cookie from Atlas (ChatGPT) Chromium store.
// Requires that the user has previously approved "Always Allow" in the macOS
// keychain dialog (run refresh-flhsmv-cookie-atlas.mjs from Terminal to trigger it).

const PYTHON_COOKIE_HELPER = `
import sys, os, sqlite3, shutil, subprocess, hashlib, tempfile

base = os.path.expanduser(
    "~/Library/Application Support/com.openai.atlas/browser-data/host")
best_path, best_ts = None, -1
for entry in os.listdir(base):
    cp = os.path.join(base, entry, "Cookies")
    if not os.path.exists(cp):
        continue
    try:
        conn = sqlite3.connect(f"file:{cp}?mode=ro&immutable=1", uri=True)
        row = conn.execute(
            "SELECT last_access_utc FROM cookies WHERE name='ASP.NET_SessionId' "
            "ORDER BY last_access_utc DESC LIMIT 1"
        ).fetchone()
        conn.close()
        if row and row[0] > best_ts:
            best_ts, best_path = row[0], cp
    except Exception:
        pass

if not best_path:
    print("ERROR:no_cookie_db", flush=True)
    sys.exit(1)

try:
    pw = subprocess.check_output(
        ["security", "find-generic-password", "-s", "Chrome Safe Storage", "-w"],
        stderr=subprocess.DEVNULL,
    ).strip()
except subprocess.CalledProcessError as e:
    print(f"ERROR:keychain_failed:{e}", flush=True)
    sys.exit(1)

from Crypto.Cipher import AES
key = hashlib.pbkdf2_hmac("sha1", pw, b"saltysalt", 1003, dklen=16)

tmp = tempfile.mktemp(suffix=".db")
shutil.copy2(best_path, tmp)

conn = sqlite3.connect(tmp)
want = ["ASP.NET_SessionId", "bm_sv", "ak_bmsc"]
ph   = ",".join("?" * len(want))
rows = conn.execute(
    f"SELECT name, encrypted_value FROM cookies "
    f"WHERE host_key LIKE '%flhsmv%' AND name IN ({ph}) "
    f"ORDER BY last_access_utc DESC",
    want,
).fetchall()
conn.close()
os.unlink(tmp)

seen, parts = set(), []
for name, enc in rows:
    if name in seen: continue
    seen.add(name)
    enc_bytes = bytes(enc)
    if enc_bytes[:3] != b"v10": continue
    cipher = AES.new(key, AES.MODE_CBC, b" " * 16)
    dec = cipher.decrypt(enc_bytes[3:])
    pad = dec[-1]
    if 1 <= pad <= 16: dec = dec[:-pad]
    # latin-1 maps all 256 bytes 1:1 — never fails. Then strip non-printable-ASCII
    # so the cookie header stays within 0x20-0x7E (Node.js fetch ByteString limit).
    val = ''.join(c for c in dec.decode('latin-1') if 0x20 <= ord(c) <= 0x7E)
    parts.append(f"{name}={val}")

print("COOKIES:" + "; ".join(parts), flush=True)
`;

function getAtlasCookie() {
  try {
    const output = execFileSync("python3", ["-c", PYTHON_COOKIE_HELPER], {
      encoding: "utf8",
      timeout: 15_000,
    });
    for (const line of output.trim().split("\n")) {
      if (line.startsWith("COOKIES:")) {
        const cookie = line.slice(8).trim();
        if (cookie.includes("ASP.NET_SessionId")) return cookie;
        log("WARN: ASP.NET_SessionId not found — Atlas session may have expired. Open FLHSMV in Atlas to refresh.");
        return null;
      }
      if (line.startsWith("ERROR:")) {
        log(`Cookie error: ${line.slice(6)}`);
        return null;
      }
    }
    return null;
  } catch (err) {
    log(`Atlas cookie extraction failed: ${err.message}`);
    return null;
  }
}

// ── Candidate scoring (mirrors server/crashReportWorker.ts scoreCandidate) ────

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

  // Signal 1: highway / road number (+40)
  const hwMatches = locUp.match(/\b(I[-\s]?\d{2,3}|US[-\s]?\d{1,3}|SR[-\s]?\d{1,3}|CR[-\s]?\d{1,3}|FL[-\s]?\d{1,3})\b/g) ?? [];
  for (const hw of hwMatches) {
    const norm = hw.replace(/[-\s]/g, "");
    if (rFull.replace(/[-\s]/g, "").includes(norm)) {
      score += 40; signals.push(`highway(${hw.trim()})+40`); break;
    }
  }

  // Signal 2: mile marker (+25)
  const mmMatch = locUp.match(/\bMM\s*(\d+)/);
  if (mmMatch) {
    const mmNum = mmMatch[1];
    const rAll = JSON.stringify(candidate).toUpperCase();
    if (rAll.includes(`MM ${mmNum}`) || rAll.includes(`MM${mmNum}`)) {
      score += 25; signals.push(`mileMarker(${mmNum})+25`);
    }
  }

  // Signal 3: meaningful street-word overlap (+20 or +5)
  const locWords = locUp.split(/[\s,x\[\]/]+/)
    .filter(w => w.length > 4 && !STOPWORDS.has(w) && !/^(NB|SB|EB|WB|NW|SW|NE|SE)$/.test(w));
  const wordMatches = locWords.filter(w => rFull.includes(w));
  if (wordMatches.length >= 2) {
    score += 20; signals.push(`streetWords(${wordMatches.slice(0, 3).join(",")})+20`);
  } else if (wordMatches.length === 1 && score === 0) {
    score += 5; signals.push(`weakWord(${wordMatches[0]})+5`);
  }

  // Signal 4: GPS distance < 2 km (+10)
  const rLat = candidate.Latitude  ?? candidate.lat;
  const rLng = candidate.Longitude ?? candidate.lng;
  if (lat != null && lng != null && rLat != null && rLng != null) {
    const dLat = (lat - Number(rLat)) * 111_000;
    const dLng = (lng - Number(rLng)) * 111_000 * Math.cos((lat * Math.PI) / 180);
    const distM = Math.sqrt(dLat * dLat + dLng * dLng);
    if (distM < 2_000) { score += 10; signals.push(`gps(${Math.round(distM)}m)+10`); }
  }

  // Signal 5: crash time within 30 min (+5)
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

// ── FLHSMV API calls ─────────────────────────────────────────────────────────

const FLHSMV_HEADERS = (cookie) => ({
  "Content-Type":   "application/json",
  "Accept":         "application/json",
  "Cookie":         cookie,
  "Origin":         FLHSMV_BASE,
  "Referer":        `${FLHSMV_BASE}/crashreportrequest/`,
  "User-Agent":     "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Accept-Language":"en-US,en;q=0.9",
});

async function flhsmvSearch(county, crashDate, cookie) {
  // Normalize date to YYYY-MM-DD (FLHSMV expects this format)
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(crashDate)
    ? crashDate
    : crashDate.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$1-$2");

  const res = await fetch(FLHSMV_SEARCH, {
    method: "POST",
    headers: FLHSMV_HEADERS(cookie),
    body: JSON.stringify({ County: county.toUpperCase(), CrashDate: isoDate }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    return { type: "upstream_error", statusCode: res.status, errorMessage: `HTTP ${res.status}` };
  }
  const data = await res.json();
  const candidates = Array.isArray(data) ? data : (data?.ReportNumber ? [data] : []);
  return { type: "success", candidates };
}

async function flhsmvDetail(reportNumber, cookie) {
  const headers = { ...FLHSMV_HEADERS(cookie) };
  delete headers["Content-Type"];
  headers["Accept"] = "application/json";

  const res = await fetch(`${FLHSMV_DETAIL}/${encodeURIComponent(reportNumber)}`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    return { type: "upstream_error", statusCode: res.status, errorMessage: `HTTP ${res.status}` };
  }
  const data = await res.json();
  return { type: "success", data };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log("=== FLHSMV Local Agent ===");

  // Step 1: Get session cookie — prefer the cache file written by the refresher.
  // Fall back to live Atlas extraction only if the cache is missing or stale.
  let cookie = null;
  let cookieSource = "none";
  try {
    const stats = statSync(COOKIE_CACHE);
    const ageMs = Date.now() - stats.mtimeMs;
    if (ageMs < COOKIE_MAX_AGE_MS) {
      const raw = readFileSync(COOKIE_CACHE, "utf8").trim();
      // Strip any non-printable-ASCII chars that would fail Node.js fetch ByteString validation
      const cached = raw.replace(/[^\x20-\x7E]/g, "");
      if (cached.includes("ASP.NET_SessionId")) {
        cookie = cached;
        cookieSource = `cache (${Math.round(ageMs / 60_000)}m old)`;
      } else {
        log("Cache exists but no ASP.NET_SessionId — falling back to live extraction");
      }
    } else {
      log(`Cache is ${Math.round(ageMs / 60_000)}m old (> ${COOKIE_MAX_AGE_MS / 60_000}m) — falling back to live extraction`);
    }
  } catch {
    log("No cookie cache file yet — attempting live extraction from Atlas");
  }

  if (!cookie) {
    log("Extracting Atlas session cookie directly...");
    cookie = getAtlasCookie();
  }

  if (!cookie) {
    log("ERROR: No valid Atlas session cookie. Run refresh-flhsmv-cookie-atlas.mjs from Terminal first (needs keychain approval), or open FLHSMV in Atlas and wait for the refresher to cache.");
    process.exit(1);
  }
  const cookieNames = cookie.split("; ").map(p => p.split("=")[0]).join(", ");
  log(`Cookie ready [${cookieSource}]: ${cookieNames}`);

  // Step 2: Claim pending batch from Railway
  log(`Fetching pending batch (limit=${BATCH_LIMIT}) from Railway...`);
  let batch;
  try {
    const batchRes = await fetch(`${RAILWAY_URL}/api/admin/flhsmv-pending-batch?limit=${BATCH_LIMIT}`, {
      headers: { "x-admin-secret": ADMIN_SECRET },
      signal: AbortSignal.timeout(15_000),
    });
    batch = await batchRes.json();
  } catch (err) {
    log(`ERROR fetching batch from Railway: ${err.message}`);
    process.exit(1);
  }

  if (!batch.ok || !batch.reports?.length) {
    log(`No eligible reports — queue clear (returned ${batch.count ?? 0})`);
    return;
  }
  log(`Claimed ${batch.reports.length} report(s) from Railway`);

  // Step 3: Process each report via FLHSMV
  const results = [];
  for (const report of batch.reports) {
    const { id, reportNumber, county, crashDate, location, lat, lng, received } = report;

    if (!county || !crashDate) {
      log(`[${id}] Skipping — missing county or crashDate`);
      results.push({ crashReportId: id, reportNumber, type: "upstream_error", errorMessage: "missing county or crashDate in metadata" });
      continue;
    }

    log(`[${id}] ${county} / ${crashDate} — "${location ?? "?"}"`);

    // Search
    let searchOutcome;
    try {
      searchOutcome = await flhsmvSearch(county, crashDate, cookie);
    } catch (err) {
      log(`  [${id}] Search error: ${err.message}`);
      results.push({ crashReportId: id, reportNumber, type: "network_error", errorMessage: err.message });
      continue;
    }

    if (searchOutcome.type !== "success") {
      log(`  [${id}] Search failed: ${searchOutcome.errorMessage}`);
      results.push({ crashReportId: id, reportNumber, type: searchOutcome.type, statusCode: searchOutcome.statusCode, errorMessage: searchOutcome.errorMessage });
      continue;
    }

    const { candidates } = searchOutcome;
    if (candidates.length === 0) {
      log(`  [${id}] 0 candidates from FLHSMV`);
      results.push({ crashReportId: id, reportNumber, type: "not_found" });
      continue;
    }

    // Score all candidates, pick the best
    const scored = candidates
      .map(c => ({ c, ...scoreCandidate(c, location || "", lat, lng, received) }))
      .sort((a, b) => b.score - a.score);

    const best   = scored[0];
    const second = scored[1];
    log(`  [${id}] ${candidates.length} candidate(s). Best: score=${best.score} report=${best.c.ReportNumber} [${best.breakdown}]`);

    if (second && best.score - second.score <= 10 && second.score >= MIN_SCORE) {
      log(`  [${id}] WARN: ambiguous — #2 score=${second.score} report=${second.c.ReportNumber}`);
    }

    if (best.score < MIN_SCORE) {
      log(`  [${id}] Score ${best.score} < threshold ${MIN_SCORE} — treating as not_found`);
      results.push({ crashReportId: id, reportNumber, type: "not_found" });
      continue;
    }

    // Fetch full detail for the best match
    let detailData = null;
    try {
      const detailOutcome = await flhsmvDetail(best.c.ReportNumber, cookie);
      if (detailOutcome.type === "success") {
        detailData = detailOutcome.data;
        log(`  [${id}] Detail fetched for ${best.c.ReportNumber}`);
      } else {
        log(`  [${id}] Detail failed (${detailOutcome.errorMessage}) — will complete with search result only`);
      }
    } catch (err) {
      log(`  [${id}] Detail error: ${err.message} — will complete with search result only`);
    }

    results.push({
      crashReportId: id,
      reportNumber,
      type:         "success",
      searchResult: best.c,
      detail:       detailData,
    });

    // Polite delay between reports
    if (report !== batch.reports[batch.reports.length - 1]) {
      await new Promise(r => setTimeout(r, INTER_DELAY));
    }
  }

  // Step 4: Push results to Railway
  log(`Pushing ${results.length} result(s) to Railway...`);
  let pushBody;
  try {
    const pushRes = await fetch(`${RAILWAY_URL}/api/admin/flhsmv-batch-result`, {
      method: "POST",
      headers: {
        "x-admin-secret": ADMIN_SECRET,
        "Content-Type":   "application/json",
      },
      body: JSON.stringify({ results }),
      signal: AbortSignal.timeout(30_000),
    });
    pushBody = await pushRes.json().catch(() => ({}));
  } catch (err) {
    log(`ERROR pushing results to Railway: ${err.message}`);
    process.exit(1);
  }

  if (pushBody.ok) {
    const summary = (pushBody.outcomes ?? [])
      .map(o => `${o.crashReportId}→${o.action ?? o.error}`)
      .join(", ");
    log(`SUCCESS: ${pushBody.processed} result(s) processed [${summary}]`);
  } else {
    log(`ERROR from Railway: ${JSON.stringify(pushBody)}`);
    process.exit(1);
  }
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
