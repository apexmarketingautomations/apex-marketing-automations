#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCAN_DIR = join(ROOT, "server");
const ALLOW_MARKER = "allow-silent-catch";
const LOGGING_RE = /\b(console\.(?:log|info|warn|error|debug)|logger\.|log\(|trackError|reportError|captureException|reportObservability|recordMetric|emit\()/;

function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function lineNumberAt(src, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

function lineRangeText(src, startIdx, endIdx) {
  return src.slice(startIdx, endIdx);
}

function getLineSpan(src, idx) {
  let start = idx;
  while (start > 0 && src.charCodeAt(start - 1) !== 10) start--;
  let end = idx;
  while (end < src.length && src.charCodeAt(end) !== 10) end++;
  return { start, end };
}

function getPrevLine(src, idx) {
  const { start } = getLineSpan(src, idx);
  if (start === 0) return "";
  const prev = getLineSpan(src, start - 1);
  return src.slice(prev.start, prev.end);
}

function findMatchingBrace(src, openIdx) {
  let depth = 0;
  let inStr = null; // '"', "'", '`'
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") { inBlockComment = false; i++; }
      continue;
    }
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = null;
      if (inStr === "`" && ch === "$" && next === "{") {
        // template expression — treat as code by closing string temporarily
        // For simplicity, find matching } for ${...}
        let td = 1; i += 2;
        while (i < src.length && td > 0) {
          if (src[i] === "{") td++;
          else if (src[i] === "}") td--;
          i++;
        }
        i--;
      }
      continue;
    }
    if (ch === "/" && next === "/") { inLineComment = true; i++; continue; }
    if (ch === "/" && next === "*") { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findMatchingParen(src, openIdx) {
  let depth = 0;
  let inStr = null;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "/" && next === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === "/" && next === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function bodyHasLogging(body) {
  return LOGGING_RE.test(body);
}

function hasAllowComment(src, idx) {
  const { start, end } = getLineSpan(src, idx);
  const line = src.slice(start, end);
  if (line.includes(ALLOW_MARKER)) return true;
  const prev = getPrevLine(src, idx);
  if (prev.includes(ALLOW_MARKER)) return true;
  return false;
}

function paramIsBoundAndUsable(param) {
  // Acceptable: bound to a name not starting with underscore.
  // Forbidden binders: empty, "_", "_e", "_err", "_error" etc. (treated as "intentionally unused")
  const t = param.trim();
  if (t === "") return false;
  if (/^_/.test(t)) return false;
  return true;
}

function scanFile(file) {
  const src = readFileSync(file, "utf8");
  const violations = [];

  // ---- Pattern A: } catch { ... }  and  } catch (param) { ... } ----
  // Match the literal "catch" keyword followed by either "{" or "( ... ) {"
  const catchRe = /\bcatch\s*(\([^)]*\))?\s*\{/g;
  let m;
  while ((m = catchRe.exec(src)) !== null) {
    const matchStart = m.index;
    const openBrace = matchStart + m[0].length - 1;
    const paramRaw = m[1] ? m[1].slice(1, -1) : ""; // strip ()
    const close = findMatchingBrace(src, openBrace);
    if (close === -1) continue;
    const body = src.slice(openBrace + 1, close);

    if (paramIsBoundAndUsable(paramRaw)) continue; // properly bound, e.g. (err) — caller's job to use it

    // Unbound or _ bound → must log or have allow comment
    if (bodyHasLogging(body)) continue;
    if (hasAllowComment(src, matchStart)) continue;

    violations.push({
      file,
      line: lineNumberAt(src, matchStart),
      kind: paramRaw ? `} catch (${paramRaw}) {` : "} catch {",
      snippet: src.slice(matchStart, Math.min(matchStart + 80, close + 1)).replace(/\s+/g, " ").trim(),
    });
  }

  // ---- Pattern B: .catch(...) callback ----
  // Match `.catch(` and inspect the callback body.
  const dotCatchRe = /\.catch\s*\(/g;
  while ((m = dotCatchRe.exec(src)) !== null) {
    const matchStart = m.index;
    const openParen = matchStart + m[0].length - 1;
    const closeParen = findMatchingParen(src, openParen);
    if (closeParen === -1) continue;
    const inner = src.slice(openParen + 1, closeParen);

    // Only consider arrow-function callbacks: ( ... ) => ... or x => ...
    // Skip method references like .catch(handler) — caller's responsibility.
    const arrowMatch = inner.match(/^\s*(\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>\s*/);
    if (!arrowMatch) continue;

    const param = (arrowMatch[2] ?? arrowMatch[3] ?? "").trim();
    const bodyStartRel = arrowMatch[0].length;
    const body = inner.slice(bodyStartRel);

    if (paramIsBoundAndUsable(param)) continue;

    if (bodyHasLogging(body)) continue;
    if (hasAllowComment(src, matchStart)) continue;

    violations.push({
      file,
      line: lineNumberAt(src, matchStart),
      kind: `.catch((${param}) => …)`,
      snippet: src.slice(matchStart, Math.min(matchStart + 80, closeParen + 1)).replace(/\s+/g, " ").trim(),
    });
  }

  return violations;
}

function main() {
  const files = listTsFiles(SCAN_DIR);
  const allViolations = [];
  for (const f of files) {
    allViolations.push(...scanFile(f));
  }

  if (allViolations.length === 0) {
    console.log(`[check-silent-catches] OK — scanned ${files.length} files in server/, no silent catches found.`);
    process.exit(0);
  }

  console.error(`[check-silent-catches] Found ${allViolations.length} silent catch site(s) in server/:\n`);
  for (const v of allViolations) {
    const rel = relative(ROOT, v.file);
    console.error(`  ${rel}:${v.line}  ${v.kind}`);
    console.error(`      ${v.snippet}`);
  }
  console.error(`
Each catch must EITHER:
  • bind the error and log it (e.g. console.warn("[MODULE] caught:", err instanceof Error ? err.message : err))
  • OR carry an inline justification on the same line / line above:
        // allow-silent-catch: <reason>

This rule was added in Task #166 to prevent silent error-swallowing
(see Tasks #160, #162, #167 for the original sweep).
`);
  process.exit(1);
}

main();
