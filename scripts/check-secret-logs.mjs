#!/usr/bin/env node
/**
 * check-secret-logs — fail when server code logs the literal value of any
 * env var whose name contains SECRET, TOKEN, API_KEY, PASSWORD, or PIN.
 *
 * Added in Task #175 as a permanent guard against regressions of #172
 * (which removed an explicit `console.log` of `STUDIO_WEBHOOK_SECRET`).
 *
 * What it flags
 * -------------
 *   const SECRET = process.env.MY_SECRET;
 *   console.log(`Secret: ${SECRET}`);                  // BAD — direct interpolation
 *   console.log("secret =", process.env.MY_SECRET);    // BAD — direct arg
 *   console.log(getSecret());                          // BAD — getSecret() returns process.env.<MATCH>
 *
 * What it allows
 * --------------
 *   • String literals that just mention the env var NAME
 *       console.warn("[X] AGENT_SECRET not set");
 *   • Boolean / length / comparison checks
 *       console.log(`hasSecret=${!!SECRET}, len=${SECRET?.length}, match=${SECRET === other}`);
 *   • Masked substrings
 *       console.log(`token=${TOKEN.substring(0, 8)}...`);
 *   • Lines explicitly justified with `// allow-secret-log: <reason>`
 *
 * Env-name detection contract
 * ---------------------------
 * `isSecretEnvName` treats an env var as secret-like when its name
 * (case-insensitively) CONTAINS any of:
 *   SECRET, TOKEN, API_KEY, APIKEY, PASSWORD, PWD, PIN
 *
 * This is true substring matching, matching the literal Task #175
 * contract ("name contains SECRET, TOKEN, API_KEY, PASSWORD, or PIN").
 * It correctly catches both standard styles (`STRIPE_API_SECRET`,
 * `META_ACCESS_TOKEN`, `GOOGLE_API_KEY`) and non-standard fragments
 * (`FOO_SECRETV2`, `MYTOKENVALUE`, `PASSWORD_HASH`, `OLD_PIN`).
 *
 * Note: substring matching means env vars whose name happens to embed
 * a secret word as part of a non-secret concept (e.g. `TOKENIZER_MODE`)
 * will be treated as secret. If that ever produces a false positive on
 * a value that is genuinely safe to log, justify the call site with a
 * `// allow-secret-log: <reason>` comment (see below).
 *
 * Scan targets
 * ------------
 * Every `.ts`, `.tsx`, `.js`, `.mjs`, and `.cjs` file under `server/` (the
 * codebase is TypeScript-first; the .js/.mjs/.cjs extensions are scanned
 * for forward-compat with future server-side JavaScript).
 *
 * Allow-list mechanism
 * --------------------
 * Add a comment on the same line OR the line immediately above the offending
 * `console.X(` call:
 *
 *   // allow-secret-log: value is already masked to first 8 chars
 *   console.log(`[CP-META-TOKEN] Updated Meta access token (masked: ${masked})`);
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCAN_DIR = join(ROOT, "server");
const ALLOW_MARKER = "allow-secret-log";

const IS_MAIN = process.argv[1] && process.argv[1].endsWith("check-secret-logs.mjs");

// Substrings that, when they appear anywhere in an env var name, mark the
// var as secret-like. Matched case-insensitively against the upper-cased
// name so both `MY_API_KEY` and `my_api_key` match. See the script header
// for the rationale (Task #175 literal "contains" contract).
const SECRET_SUBSTRINGS = ["SECRET", "TOKEN", "API_KEY", "APIKEY", "PASSWORD", "PWD", "PIN"];

function isSecretEnvName(name) {
  const upper = String(name).toUpperCase();
  for (const needle of SECRET_SUBSTRINGS) {
    if (upper.includes(needle)) return true;
  }
  return false;
}

const SCAN_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git" || entry === "tests") continue;
      out.push(...listTsFiles(full));
    } else if (SCAN_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
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

function hasAllowComment(src, idx) {
  const { start, end } = getLineSpan(src, idx);
  const line = src.slice(start, end);
  if (line.includes(ALLOW_MARKER)) return true;
  const prev = getPrevLine(src, idx);
  if (prev.includes(ALLOW_MARKER)) return true;
  return false;
}

function findMatchingBrace(src, openIdx) {
  return findMatching(src, openIdx, "{", "}");
}

function findMatchingParen(src, openIdx) {
  return findMatching(src, openIdx, "(", ")");
}

function findMatching(src, openIdx, openCh, closeCh) {
  let depth = 0;
  let inStr = null;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) { inStr = null; continue; }
      if (inStr === "`" && ch === "$" && next === "{") {
        let td = 1; i += 2;
        while (i < src.length && td > 0) {
          if (src[i] === "{") td++;
          else if (src[i] === "}") td--;
          if (td > 0) i++;
        }
      }
      continue;
    }
    if (ch === "/" && next === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === "/" && next === "*") { i += 2; while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Strip out string-literal contents (replace with spaces of equal length) so
// that string literals don't contribute identifier or process.env matches.
// Template-literal `${...}` interpolations remain as code.
function stripStrings(s) {
  let out = "";
  let inStr = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1];
    if (inStr) {
      if (ch === "\\") { out += "  "; i++; continue; }
      if (ch === inStr) { inStr = null; out += " "; continue; }
      if (inStr === "`" && ch === "$" && next === "{") {
        // Pass through the ${...} body as code, but keep the tokens.
        out += "${";
        let td = 1; i += 2;
        while (i < s.length && td > 0) {
          if (s[i] === "{") td++;
          else if (s[i] === "}") td--;
          if (td > 0) { out += s[i]; i++; }
        }
        out += "}";
        continue;
      }
      out += " ";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; out += " "; continue; }
    out += ch;
  }
  return out;
}

// Collect simple `(const|let|var) NAME = <rhs>;` declarations.
function collectDeclarations(src) {
  const out = [];
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+?)?\s*=/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    const rhsStart = m.index + m[0].length;
    // Read until end of statement: track depth and stop at top-level ; or newline-terminated assignment.
    let i = rhsStart;
    let depth = 0;
    let inStr = null;
    while (i < src.length) {
      const ch = src[i];
      const next = src[i + 1];
      if (inStr) {
        if (ch === "\\") { i += 2; continue; }
        if (ch === inStr) { inStr = null; i++; continue; }
        if (inStr === "`" && ch === "$" && next === "{") {
          let td = 1; i += 2;
          while (i < src.length && td > 0) {
            if (src[i] === "{") td++;
            else if (src[i] === "}") td--;
            i++;
          }
          continue;
        }
        i++;
        continue;
      }
      if (ch === "/" && next === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (ch === "/" && next === "*") { i += 2; while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; i++; continue; }
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") {
        if (depth === 0) break;
        depth--;
      } else if (ch === ";" && depth === 0) break;
      else if (ch === "\n" && depth === 0) {
        // Heuristic stop on bare newline only when there's no continuation.
        // Look ahead to next non-whitespace char; if it's an operator like `||`, `&&`, `+`, `,`, `.`, `?`, `:`, `(`, continue; else break.
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j])) j++;
        const c = src[j] || "";
        if (!/[|&+\-*/.?:,(){}\[\]]/.test(c)) break;
      }
      i++;
    }
    const rhs = src.slice(rhsStart, i);
    out.push({ name, rhs, start: m.index });
  }
  return out;
}

// Find function NAME(...) {...} declarations whose body returns a tainted env.
function collectFunctionDecls(src) {
  const out = [];
  const re = /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const openBrace = m.index + m[0].length - 1;
    const closeBrace = findMatchingBrace(src, openBrace);
    if (closeBrace === -1) continue;
    const body = src.slice(openBrace + 1, closeBrace);
    out.push({ name: m[1], body });
  }
  return out;
}

// Strip string literals and replace any text inside parens/brackets/braces
// with spaces, so the result reflects only "top-level" code at depth 0.
// Lets us detect value-position references (e.g. `process.env.X || ""`)
// while ignoring arguments of a wrapping call like
// `new Stripe(process.env.X, ...)` or `fn(process.env.X)`.
function depthZeroView(s) {
  // First, peel outer matched parens that wrap the whole expression: `(expr)` -> `expr`.
  let trimmed = s.trim();
  while (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    const close = findMatchingParen(trimmed, 0);
    if (close === trimmed.length - 1) trimmed = trimmed.slice(1, -1).trim();
    else break;
  }
  const stripped = stripStrings(trimmed);
  let depth = 0;
  let out = "";
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === "(" || ch === "[" || ch === "{") { depth++; out += " "; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; out += " "; continue; }
    out += depth === 0 ? ch : " ";
  }
  return out;
}

// Operators / patterns that change the resulting value so that even if a
// secret variable participates in the expression, the produced value is
// no longer the secret itself.
const VALUE_MODIFYING_OPS = [
  /===|!==|==(?!=)|!=(?!=)/, // equality
  /<=|>=|<(?![<=])|>(?![>=])/, // comparison
  /^\s*!{1,2}\s*[A-Za-z_$(]/, // !x or !!x at expression start
  /\btypeof\b/,
  /\bBoolean\s*\(/,
  /\.(length|substring|substr|slice|charAt|replace|replaceAll|split|trim|trimStart|trimEnd|match|test|indexOf|lastIndexOf|includes|startsWith|endsWith|toLowerCase|toUpperCase|search|padStart|padEnd|repeat|normalize|at|charCodeAt|codePointAt)\b/,
];

function rhsIsValueModifying(rhs) {
  const view = depthZeroView(rhs);
  for (const re of VALUE_MODIFYING_OPS) {
    if (re.test(view)) return true;
  }
  return false;
}

// Rewrite bracket-notation env reads into dot-notation BEFORE later passes
// (stripStrings / depthZeroView) eat the contents inside the brackets:
//   process.env["NAME"]   →  process.env.NAME
//   process.env['NAME']   →  process.env.NAME
// This keeps bracket-style accesses visible to the dot-style scanner.
const PROCESS_ENV_BRACKET_RE = /process\.env\[\s*(?:"([^"\n]+)"|'([^'\n]+)')\s*\]/g;

function normalizeProcessEnv(text) {
  return text.replace(PROCESS_ENV_BRACKET_RE, (_full, dq, sq) => {
    const name = dq ?? sq ?? "";
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return _full;
    return `process.env.${name}`;
  });
}

// Matches dot-notation env access. Dot property allows mixed/lowercase names
// (e.g. process.env.password) since JS treats them all as property reads on
// the same env object. Bracket notation is normalized to this form upstream.
const PROCESS_ENV_RE = /process\.env\.([A-Za-z_$][\w$]*)/g;

function* iterateEnvNames(text) {
  const normalized = normalizeProcessEnv(text);
  PROCESS_ENV_RE.lastIndex = 0;
  let m;
  while ((m = PROCESS_ENV_RE.exec(normalized)) !== null) {
    yield { name: m[1], raw: m[0] };
  }
}

function rhsReferencesSecretEnv(rhs) {
  // Normalize bracket → dot first so depthZeroView doesn't eat the name.
  const normalized = normalizeProcessEnv(rhs);
  if (rhsIsValueModifying(normalized)) return false;
  const view = depthZeroView(normalized);
  for (const { name } of iterateEnvNames(view)) {
    if (isSecretEnvName(name)) return true;
  }
  return false;
}

function rhsReferencesAnyName(rhs, names) {
  if (names.size === 0) return false;
  if (rhsIsValueModifying(rhs)) return false;
  const view = depthZeroView(rhs);
  const re = /\b([A-Za-z_$][\w$]*)\b/g;
  let m;
  while ((m = re.exec(view)) !== null) {
    const name = m[1];
    if (!names.has(name)) continue;
    // Skip when this identifier is a function call (e.g. `taintedFn()`)
    // because the result of calling it is handled by callsAnyFunction with
    // taintedFuncs; here we only want bare value references.
    const after = view.slice(m.index + name.length);
    if (/^\s*\(/.test(after) || /^\s+\(/.test(after)) continue;
    return true;
  }
  return false;
}

function isTaintedReturnBody(body, taintedVars, taintedFuncs) {
  const stripped = stripStrings(body);
  // Look for any "return <expr>" statement whose expression references secret
  // at value position (not buried in a call argument).
  const retRe = /\breturn\s+([^;]+);/g;
  let m;
  while ((m = retRe.exec(stripped)) !== null) {
    const expr = m[1];
    if (rhsReferencesSecretEnv(expr)) return true;
    if (rhsReferencesAnyName(expr, taintedVars)) return true;
    if (callsAnyFunction(expr, taintedFuncs)) return true;
  }
  return false;
}

function buildTaintSets(src) {
  const taintedVars = new Set();
  const taintedFuncs = new Set();

  const fnDecls = collectFunctionDecls(src);
  // First pass — direct env reads in function bodies.
  for (const f of fnDecls) {
    if (isTaintedReturnBody(f.body, taintedVars, taintedFuncs)) {
      taintedFuncs.add(f.name);
    }
  }

  const decls = collectDeclarations(src);

  // Closure: keep adding tainted vars while we find new ones.
  let changed = true;
  let safety = 0;
  while (changed && safety++ < 20) {
    changed = false;
    for (const d of decls) {
      if (taintedVars.has(d.name)) continue;
      if (
        rhsReferencesSecretEnv(d.rhs) ||
        rhsReferencesAnyName(d.rhs, taintedVars) ||
        callsAnyFunction(d.rhs, taintedFuncs)
      ) {
        taintedVars.add(d.name);
        changed = true;
      }
    }
    // Re-evaluate function decls in case new tainted vars expose more tainted returns.
    for (const f of fnDecls) {
      if (taintedFuncs.has(f.name)) continue;
      if (isTaintedReturnBody(f.body, taintedVars, taintedFuncs)) {
        taintedFuncs.add(f.name);
        changed = true;
      }
    }
  }

  return { taintedVars, taintedFuncs };
}

function callsAnyFunction(rhs, funcs) {
  if (funcs.size === 0) return false;
  if (rhsIsValueModifying(rhs)) return false;
  // After collapsing parens to spaces, a `fn(...)` call leaves the bare name
  // at top level — match `\bFN\b` followed by whitespace (or end).
  const view = depthZeroView(rhs);
  for (const fn of funcs) {
    const re = new RegExp(`\\b${fn}\\b\\s*$|\\b${fn}\\b\\s+(?=$|[|?&])`);
    if (re.test(view)) return true;
  }
  return false;
}

// --- Leak detection inside console call argument string ---

const MASK_HINT_RE =
  /\.(length|substring|substr|slice|charAt|replace|replaceAll|split|trim|trimStart|trimEnd|match|test|indexOf|lastIndexOf|includes|startsWith|endsWith|toLowerCase|toUpperCase|codePointAt|charCodeAt|search|padStart|padEnd|repeat|normalize|at|valueOf)\b/;
const COMPARISON_RE = /[!=<>]==?[=]?|<=|>=|<\b|>\b/;
const BOOLEAN_COERCE_RE = /^(?:!{1,2}|Boolean\s*\(|\(!{1,2})/;
const NULLISH_TEMPLATE_RE = /\?\s*['"`]/; // expr ? "yes" : "no"

function expressionLooksMasked(expr) {
  const e = expr.trim();
  if (BOOLEAN_COERCE_RE.test(e)) return true;
  if (MASK_HINT_RE.test(e)) return true;
  if (COMPARISON_RE.test(e)) return true;
  if (NULLISH_TEMPLATE_RE.test(e)) return true; // ternary with literal results
  return false;
}

function expressionLeaks(expr, taintedVars, taintedFuncs) {
  if (expressionLooksMasked(expr)) return null;
  // Direct process.env access (dot or bracket notation, any case).
  // Normalize bracket → dot BEFORE stripStrings so the name isn't eaten.
  const normalized = normalizeProcessEnv(expr);
  const stripped = stripStrings(normalized);
  for (const { name, raw } of iterateEnvNames(stripped)) {
    if (isSecretEnvName(name)) return raw;
  }
  const idRe = /\b([A-Za-z_$][\w$]*)\b/g;
  let im;
  while ((im = idRe.exec(stripped)) !== null) {
    const name = im[1];
    if (taintedVars.has(name)) return name;
    // Tainted-function calls leak if their result isn't masked.
    if (taintedFuncs.has(name)) {
      // Must look like a call: NAME(
      const after = stripped.slice(im.index + name.length).match(/^\s*\(/);
      if (after) return `${name}()`;
    }
  }
  return null;
}

// Walk a console-call argument string, yielding each "leak-checkable" expression:
//   * each top-level argument expression
//   * each ${...} interpolation inside template literals
function* enumerateExpressions(args) {
  // Top-level args, splitting on commas at depth 0 outside of strings.
  let cur = "";
  let depth = 0;
  let inStr = null;
  const flushArg = (s) => {
    const trimmed = s.trim();
    if (trimmed) yieldArg(trimmed);
  };
  const argList = [];
  const yieldArg = (a) => argList.push(a);

  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    const next = args[i + 1];
    if (inStr) {
      cur += ch;
      if (ch === "\\") { cur += args[i + 1] || ""; i++; continue; }
      if (ch === inStr) { inStr = null; continue; }
      if (inStr === "`" && ch === "$" && next === "{") {
        // Consume the ${...} as part of the template token.
        let td = 1; i++; cur += args[i]; // '{'
        while (++i < args.length && td > 0) {
          if (args[i] === "{") td++;
          else if (args[i] === "}") td--;
          cur += args[i];
        }
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; cur += ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) { flushArg(cur); cur = ""; continue; }
    cur += ch;
  }
  flushArg(cur);

  for (const arg of argList) {
    yield arg; // the whole top-level arg expression
    // Also enumerate ${...} interpolations inside if it's a template literal (or contains one).
    yield* enumerateInterpolations(arg);
  }
}

function* enumerateInterpolations(s) {
  // Find backtick template literal ranges; inside those, find ${...} interpolations.
  let i = 0;
  let inStr = null;
  while (i < s.length) {
    const ch = s[i];
    if (inStr === "`") {
      if (ch === "\\") { i += 2; continue; }
      if (ch === "`") { inStr = null; i++; continue; }
      if (ch === "$" && s[i + 1] === "{") {
        let td = 1; const startExpr = i + 2; let j = startExpr;
        while (j < s.length && td > 0) {
          if (s[j] === "{") td++;
          else if (s[j] === "}") td--;
          if (td > 0) j++;
        }
        yield s.slice(startExpr, j);
        i = j + 1;
        continue;
      }
      i++;
      continue;
    }
    if (inStr) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inStr) { inStr = null; }
      i++;
      continue;
    }
    if (ch === "`") { inStr = "`"; i++; continue; }
    if (ch === '"' || ch === "'") { inStr = ch; i++; continue; }
    i++;
  }
}

function scanFile(file) {
  const src = readFileSync(file, "utf8");
  const violations = [];
  const { taintedVars, taintedFuncs } = buildTaintSets(src);

  const consoleRe = /\bconsole\.(?:log|info|warn|error|debug|trace)\s*\(/g;
  let cm;
  while ((cm = consoleRe.exec(src)) !== null) {
    const matchStart = cm.index;
    const openParen = matchStart + cm[0].length - 1;
    const closeParen = findMatchingParen(src, openParen);
    if (closeParen === -1) continue;
    if (hasAllowComment(src, matchStart)) continue;

    const args = src.slice(openParen + 1, closeParen);
    const seen = new Set();
    for (const expr of enumerateExpressions(args)) {
      const leak = expressionLeaks(expr, taintedVars, taintedFuncs);
      if (leak && !seen.has(leak)) {
        seen.add(leak);
        violations.push({
          file,
          line: lineNumberAt(src, matchStart),
          leak,
          snippet: src.slice(matchStart, Math.min(matchStart + 140, closeParen + 1))
            .replace(/\s+/g, " ")
            .trim(),
        });
      }
    }
  }
  return violations;
}

export {
  isSecretEnvName,
  buildTaintSets,
  expressionLeaks,
  enumerateExpressions,
  scanFile,
  listTsFiles,
  SCAN_DIR,
  ROOT,
};

function main() {
  const files = listTsFiles(SCAN_DIR);
  const all = [];
  for (const f of files) all.push(...scanFile(f));

  if (all.length === 0) {
    console.log(
      `[check-secret-logs] OK — scanned ${files.length} files in server/, no env-secret leaks in console output.`,
    );
    process.exit(0);
  }

  console.error(`[check-secret-logs] Found ${all.length} suspected secret-log site(s) in server/:\n`);
  for (const v of all) {
    const rel = relative(ROOT, v.file);
    console.error(`  ${rel}:${v.line}  leaks ${v.leak}`);
    console.error(`      ${v.snippet}`);
  }
  console.error(`
Each console.* call must NOT print the value of an env var whose name contains
SECRET, TOKEN, API_KEY, PASSWORD, or PIN. Either:

  • Print only a masked form (e.g. \`\${TOKEN.substring(0, 8)}...\`), a length
    (\`\${TOKEN?.length}\`), a boolean (\`\${!!TOKEN}\`), or a comparison result.
  • OR justify the call inline with a comment on the same line / line above:
        // allow-secret-log: <reason>

This rule was added in Task #175 to permanently guard against the regression
fixed in Task #172 (an explicit log of STUDIO_WEBHOOK_SECRET).
`);
  process.exit(1);
}

if (IS_MAIN) main();
