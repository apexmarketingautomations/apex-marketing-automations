#!/usr/bin/env node
/**
 * Auto-refreshes the FLHSMV session cookie by:
 * 1. Opening the FLHSMV crash report page in Atlas (ChatGPT Atlas browser)
 * 2. Waiting for Atlas to receive and store the session cookie
 * 3. Delegating decryption to a Python helper (reads Chromium SQLite + decrypts)
 * 4. Pushing the cookie to Railway via the admin endpoint
 *
 * FIRST-RUN NOTE:
 * macOS will show a keychain access dialog on the first run (step 3).
 * Click "Always Allow" to grant permanent access — subsequent runs need no approval.
 */

import { execSync, execFileSync } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";
import os from "os";
import path from "path";
import { writeFileSync } from "fs";

// Cookie cache file — written by this refresher, read by flhsmv-local-agent.mjs.
// Avoids the keychain ETIMEDOUT issue in the agent's own extraction pass.
const COOKIE_CACHE_FILE = "/tmp/flhsmv-atlas-cookie.txt";

const execAsync = promisify(exec);

const FLHSMV_URL   = "https://services.flhsmv.gov/crashreportrequest/";
const RAILWAY_URL  = "https://apexmarketingautomations.com/api/admin/flhsmv-cookie";
const ADMIN_SECRET = "201120062017";
const PAGE_LOAD_WAIT_SEC = 20;

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${msg}`);
}

// Inline Python script that handles SQLite + keychain + decryption
const PYTHON_HELPER = `
import sys, os, glob, sqlite3, shutil, subprocess, hashlib, tempfile

# ---------- find best Atlas cookie db ----------
base = os.path.expanduser(
    "~/Library/Application Support/com.openai.atlas/browser-data/host"
)
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

print(f"INFO:db={os.path.basename(os.path.dirname(best_path))}", flush=True)

# ---------- get keychain key ----------
try:
    pw = subprocess.check_output(
        ["security", "find-generic-password", "-s", "Chrome Safe Storage", "-w"],
        stderr=subprocess.DEVNULL,
    ).strip()
except subprocess.CalledProcessError as e:
    print(f"ERROR:keychain_failed:{e}", flush=True)
    sys.exit(1)

key = hashlib.pbkdf2_hmac("sha1", pw, b"saltysalt", 1003, dklen=16)

# ---------- copy db to temp (avoid WAL lock) ----------
tmp = tempfile.mktemp(suffix=".db")
shutil.copy2(best_path, tmp)

# ---------- read + decrypt ----------
from Crypto.Cipher import AES

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
    if name in seen:
        continue
    seen.add(name)
    enc_bytes = bytes(enc)
    if enc_bytes[:3] != b"v10":
        print(f"WARN:skip_{name}_not_v10", flush=True)
        continue
    cipher = AES.new(key, AES.MODE_CBC, b" " * 16)
    dec = cipher.decrypt(enc_bytes[3:])
    pad = dec[-1]
    if 1 <= pad <= 16:
        dec = dec[:-pad]
    # latin-1 maps all 256 bytes 1:1 — never fails. Then strip non-printable-ASCII
    # so the cookie header stays within 0x20-0x7E (Node.js fetch ByteString limit).
    val = ''.join(c for c in dec.decode('latin-1') if 0x20 <= ord(c) <= 0x7E)
    parts.append(f"{name}={val}")

print("COOKIES:" + "; ".join(parts), flush=True)
`;

async function main() {
  log("Opening FLHSMV crash report page in Atlas...");
  try {
    await execAsync(`open -a "ChatGPT Atlas" "${FLHSMV_URL}"`);
  } catch (e) {
    log(`WARN: open failed: ${e.message}`);
  }

  log(`Waiting ${PAGE_LOAD_WAIT_SEC}s for Atlas to load the page...`);
  await new Promise((r) => setTimeout(r, PAGE_LOAD_WAIT_SEC * 1000));

  log("Reading and decrypting Atlas cookies (keychain dialog may appear — click Always Allow)...");
  let output;
  try {
    output = execFileSync("python3", ["-c", PYTHON_HELPER], {
      encoding: "utf8",
      timeout: 30000,
    });
  } catch (e) {
    log(`ERROR running Python helper: ${e.stderr || e.message}`);
    process.exit(1);
  }

  const lines = output.trim().split("\n");
  let cookieHeader = null;

  for (const line of lines) {
    if (line.startsWith("ERROR:")) {
      log(`Python ERROR: ${line.slice(6)}`);
      process.exit(1);
    }
    if (line.startsWith("WARN:")) {
      log(`Python WARN: ${line.slice(5)}`);
    }
    if (line.startsWith("INFO:")) {
      log(`Atlas profile: ${line.slice(5)}`);
    }
    if (line.startsWith("COOKIES:")) {
      cookieHeader = line.slice(8).trim();
    }
  }

  if (!cookieHeader) {
    log("ERROR: no COOKIES line in Python output");
    process.exit(1);
  }

  const names = cookieHeader.split("; ").map((p) => p.split("=")[0]).join(", ");
  log(`Cookies extracted: ${names}`);

  if (!cookieHeader.includes("ASP.NET_SessionId")) {
    log("ERROR: ASP.NET_SessionId missing — FLHSMV may not have responded");
    process.exit(1);
  }

  log(`Pushing ${cookieHeader.length} chars to Railway...`);
  const res = await fetch(RAILWAY_URL, {
    method: "POST",
    headers: {
      "x-admin-secret": ADMIN_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cookie: cookieHeader }),
  });
  const body = await res.json().catch(() => ({}));

  if (body.ok) {
    log("SUCCESS — cookie injected into Railway");
    // Also cache locally so flhsmv-local-agent.mjs can read it without its own
    // keychain extraction (which times out in launchd background context).
    try {
      writeFileSync(COOKIE_CACHE_FILE, cookieHeader, { mode: 0o600 });
      log(`Cached to ${COOKIE_CACHE_FILE}`);
    } catch (e) {
      log(`WARN: Could not write cookie cache: ${e.message}`);
    }
  } else {
    log(`ERROR: Railway push failed: ${JSON.stringify(body)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
