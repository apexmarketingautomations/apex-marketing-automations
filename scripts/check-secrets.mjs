#!/usr/bin/env node
/**
 * Repo-wide secret scan (fast, blunt).
 *
 * Goal: catch accidental commits of API keys (especially header-config style)
 * without flagging known safe placeholders like Firebase example keys.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const IGNORE_DIRS = new Set([
  ".git",
  ".cache",
  "node_modules",
  "dist",
  "output",
  "attached_assets",
  "apify-actors",
  "uploads",
  "veco-pilot",
]);

const ALLOWLIST_FILE_MATCH = [
  // Known safe placeholders / docs
  /client\/public\/firebase-messaging-sw\.js$/,
  /client\/src\/lib\/firebase\.ts$/,
  /\.md$/,
];

const BLOCK_PATTERNS = [
  {
    name: "Stitch MCP header key",
    re: /stitch\.googleapis\.com\/mcp[\s\S]{0,500}X-Goog-Api-Key/i,
  },
  {
    name: "Hard-coded X-Goog-Api-Key header value",
    re: /["']X-Goog-Api-Key["']\s*:\s*["'][^"']{12,}["']/i,
  },
  {
    name: "TOML-style X-Goog-Api-Key",
    re: /X-Goog-Api-Key["']?\s*=\s*["'][^"']{12,}["']/i,
  },
  {
    name: "Neon/Railway-style postgres URL with password",
    re: /\bpostgresql:\/\/[^:\s]+:[^@\s]+@/i,
  },
];

function shouldSkipFile(rel) {
  return ALLOWLIST_FILE_MATCH.some((r) => r.test(rel));
}

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(ROOT, abs);
    if (ent.isDirectory()) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      yield* walk(abs);
      continue;
    }
    if (ent.isFile()) yield { abs, rel };
  }
}

function isProbablyText(buf) {
  // reject files with lots of NUL bytes
  const sample = buf.subarray(0, 8000);
  let nul = 0;
  for (const b of sample) if (b === 0) nul++;
  return nul === 0;
}

const findings = [];

for (const { abs, rel } of walk(ROOT)) {
  if (shouldSkipFile(rel)) continue;

  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch {
    continue;
  }
  if (!isProbablyText(buf)) continue;

  const text = buf.toString("utf8");
  for (const p of BLOCK_PATTERNS) {
    if (p.re.test(text)) {
      findings.push({ file: rel, rule: p.name });
    }
  }
}

if (findings.length) {
  console.error("\n[check-secrets] Potential secret(s) detected:\n");
  for (const f of findings) {
    console.error(`- ${f.file}  (${f.rule})`);
  }
  console.error("\nRemove secrets from git history and use env vars instead.\n");
  process.exit(2);
}

console.log("[check-secrets] OK");
