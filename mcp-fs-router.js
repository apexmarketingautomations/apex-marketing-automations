/**
 * Filesystem MCP — mountable router and tool implementations.
 *
 * This module is intentionally bundle-safe: it does NOT use
 * `import.meta.url`, does NOT spawn any listener at import time, and
 * does NOT contain CLI dispatch. It can be safely imported by both:
 *
 *   - `mcp-fs-server.js` — the standalone CLI (stdio + standalone HTTP)
 *   - `server/index.ts`  — the main app, which mounts `createMcpFsRouter()`
 *                           at `/fs-mcp` and is bundled to CJS by esbuild.
 *
 * The "root" of the filesystem defaults to `process.env.MCP_FS_ROOT` and
 * falls back to `process.cwd()` (which is the repo root for both the
 * dev workflow and the published deployment). Any path that resolves
 * outside the root is rejected.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";

export const PROJECT_ROOT = path.resolve(process.env.MCP_FS_ROOT || process.cwd());
let PROJECT_ROOT_REAL = PROJECT_ROOT;
try {
  PROJECT_ROOT_REAL = fssync.realpathSync(PROJECT_ROOT);
} catch (_err) { /* allow-silent-catch: existence checked at server startup */ }

const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  "dist",
  "uploads",
  ".cache",
  ".local",
  ".replit_agent",
  ".pythonlibs",
]);

function withinRoot(absPath) {
  if (absPath === PROJECT_ROOT_REAL) return true;
  const sep = PROJECT_ROOT_REAL.endsWith(path.sep) ? PROJECT_ROOT_REAL : PROJECT_ROOT_REAL + path.sep;
  return absPath.startsWith(sep);
}

function resolveSafe(rel) {
  if (typeof rel !== "string" || rel.length === 0) {
    rel = ".";
  }
  if (rel.includes("\0")) {
    throw new Error("Path contains null byte");
  }
  const lexical = path.resolve(PROJECT_ROOT, rel);
  const lexSep = PROJECT_ROOT.endsWith(path.sep) ? PROJECT_ROOT : PROJECT_ROOT + path.sep;
  if (lexical !== PROJECT_ROOT && !lexical.startsWith(lexSep)) {
    throw new Error(`Path escapes project root: ${rel}`);
  }
  let cursor = lexical;
  let trailing = "";
  while (true) {
    try {
      const real = fssync.realpathSync(cursor);
      const candidate = trailing ? path.join(real, trailing) : real;
      if (!withinRoot(real) || !withinRoot(candidate)) {
        throw new Error(`Path escapes project root via symlink: ${rel}`);
      }
      return candidate;
    } catch (err) {
      if (err && err.code === "ENOENT") {
        const parent = path.dirname(cursor);
        if (parent === cursor) {
          throw new Error(`Path escapes project root: ${rel}`);
        }
        trailing = trailing ? path.join(path.basename(cursor), trailing) : path.basename(cursor);
        cursor = parent;
        continue;
      }
      throw err;
    }
  }
}

function relativize(abs) {
  return path.relative(PROJECT_ROOT, abs) || ".";
}

function shouldIgnore(name, ignores) {
  return ignores.has(name);
}

async function listDirectory({ path: rel = ".", recursive = false, includeIgnored = false, maxEntries = 5000 }) {
  const abs = resolveSafe(rel);
  const stat = await fs.stat(abs);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${rel}`);
  }
  const ignores = includeIgnored ? new Set() : DEFAULT_IGNORES;
  const out = [];

  async function walk(dir, depth) {
    if (out.length >= maxEntries) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (out.length >= maxEntries) return;
      if (shouldIgnore(e.name, ignores)) continue;
      const childAbs = path.join(dir, e.name);
      const childRel = relativize(childAbs);
      const item = {
        path: childRel,
        type: e.isDirectory() ? "directory" : e.isSymbolicLink() ? "symlink" : "file",
      };
      if (e.isFile()) {
        try {
          const s = await fs.stat(childAbs);
          item.size = s.size;
          item.mtime = s.mtime.toISOString();
        } catch (err) { /* allow-silent-catch: stat best-effort during dir walk */ }
      }
      out.push(item);
      if (recursive && e.isDirectory()) {
        await walk(childAbs, depth + 1);
      }
    }
  }
  await walk(abs, 0);
  return { root: relativize(abs), entries: out, truncated: out.length >= maxEntries };
}

async function readFile({ path: rel, encoding = "utf8", maxBytes = 5_000_000 }) {
  const abs = resolveSafe(rel);
  const stat = await fs.stat(abs);
  if (stat.isDirectory()) throw new Error(`Is a directory: ${rel}`);
  if (stat.size > maxBytes) {
    throw new Error(
      `File too large (${stat.size} bytes > ${maxBytes}). Pass a larger maxBytes if you really want it.`,
    );
  }
  if (encoding === "base64") {
    const buf = await fs.readFile(abs);
    return { path: relativize(abs), encoding: "base64", size: stat.size, content: buf.toString("base64") };
  }
  const content = await fs.readFile(abs, "utf8");
  return { path: relativize(abs), encoding: "utf8", size: stat.size, content };
}

async function writeFile({ path: rel, content, encoding = "utf8" }) {
  const abs = resolveSafe(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  if (encoding === "base64") {
    await fs.writeFile(abs, Buffer.from(content, "base64"));
  } else {
    await fs.writeFile(abs, content, "utf8");
  }
  const stat = await fs.stat(abs);
  return { path: relativize(abs), size: stat.size };
}

async function appendFile({ path: rel, content, encoding = "utf8" }) {
  const abs = resolveSafe(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  if (encoding === "base64") {
    await fs.appendFile(abs, Buffer.from(content, "base64"));
  } else {
    await fs.appendFile(abs, content, "utf8");
  }
  const stat = await fs.stat(abs);
  return { path: relativize(abs), size: stat.size };
}

async function createFile({ path: rel, content = "", encoding = "utf8" }) {
  const abs = resolveSafe(rel);
  try {
    await fs.access(abs);
    throw new Error(`File already exists: ${rel}`);
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  if (encoding === "base64") {
    await fs.writeFile(abs, Buffer.from(content, "base64"), { flag: "wx" });
  } else {
    await fs.writeFile(abs, content, { encoding: "utf8", flag: "wx" });
  }
  const stat = await fs.stat(abs);
  return { path: relativize(abs), size: stat.size, created: true };
}

async function deleteFile({ path: rel }) {
  const abs = resolveSafe(rel);
  const stat = await fs.stat(abs);
  if (stat.isDirectory()) throw new Error(`Is a directory; use delete_directory: ${rel}`);
  await fs.unlink(abs);
  return { path: relativize(abs), deleted: true };
}

async function moveFile({ from, to, overwrite = false }) {
  const absFrom = resolveSafe(from);
  const absTo = resolveSafe(to);
  if (!overwrite) {
    try {
      await fs.access(absTo);
      throw new Error(`Destination already exists: ${to}`);
    } catch (err) {
      if (err && err.code !== "ENOENT" && !err.message?.includes("Destination already exists")) {
        throw err;
      }
      if (err && err.message?.includes("Destination already exists")) throw err;
    }
  }
  await fs.mkdir(path.dirname(absTo), { recursive: true });
  await fs.rename(absFrom, absTo);
  return { from: relativize(absFrom), to: relativize(absTo), moved: true };
}

async function makeDirectory({ path: rel }) {
  const abs = resolveSafe(rel);
  await fs.mkdir(abs, { recursive: true });
  return { path: relativize(abs), created: true };
}

async function deleteDirectory({ path: rel, recursive = false }) {
  const abs = resolveSafe(rel);
  if (abs === PROJECT_ROOT || abs === PROJECT_ROOT_REAL) {
    throw new Error("Refusing to delete project root");
  }
  const stat = await fs.lstat(abs);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory; use delete_file: ${rel}`);
  }
  await fs.rm(abs, { recursive, force: false });
  return { path: relativize(abs), deleted: true, recursive };
}

function globToRegex(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += ".";
    } else if (".+^$()|{}[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

async function searchFiles({ pattern, path: rel = ".", includeIgnored = false, limit = 500 }) {
  if (!pattern) throw new Error("pattern is required");
  const root = resolveSafe(rel);
  const re = globToRegex(pattern);
  const ignores = includeIgnored ? new Set() : DEFAULT_IGNORES;
  const matches = [];
  async function walk(dir) {
    if (matches.length >= limit) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    for (const e of entries) {
      if (matches.length >= limit) return;
      if (shouldIgnore(e.name, ignores)) continue;
      const child = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(child);
      } else if (re.test(e.name)) {
        matches.push(relativize(child));
      }
    }
  }
  await walk(root);
  return { pattern, root: relativize(root), matches, truncated: matches.length >= limit };
}

async function searchInFiles({
  query,
  path: rel = ".",
  isRegex = false,
  caseSensitive = false,
  filePattern,
  includeIgnored = false,
  maxMatches = 200,
  contextLines = 0,
}) {
  if (!query) throw new Error("query is required");
  const root = resolveSafe(rel);
  const ignores = includeIgnored ? new Set() : DEFAULT_IGNORES;
  const filenameRe = filePattern ? globToRegex(filePattern) : null;
  const flags = caseSensitive ? "g" : "gi";
  const re = isRegex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  const results = [];

  async function walk(dir) {
    if (results.length >= maxMatches) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    for (const e of entries) {
      if (results.length >= maxMatches) return;
      if (shouldIgnore(e.name, ignores)) continue;
      const child = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(child);
      } else if (e.isFile()) {
        if (filenameRe && !filenameRe.test(e.name)) continue;
        let text;
        try {
          const stat = await fs.stat(child);
          if (stat.size > 2_000_000) continue;
          text = await fs.readFile(child, "utf8");
        } catch (err) { /* allow-silent-catch: skip unreadable / binary files during grep */ continue; }
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxMatches) break;
          if (re.test(lines[i])) {
            re.lastIndex = 0;
            const ctxStart = Math.max(0, i - contextLines);
            const ctxEnd = Math.min(lines.length, i + contextLines + 1);
            results.push({
              path: relativize(child),
              line: i + 1,
              text: lines[i],
              context: contextLines > 0 ? lines.slice(ctxStart, ctxEnd) : undefined,
            });
          }
          re.lastIndex = 0;
        }
      }
    }
  }
  await walk(root);
  return { query, isRegex, caseSensitive, root: relativize(root), matches: results, truncated: results.length >= maxMatches };
}

export const tools = [
  {
    name: "list_directory",
    description: "List files and directories under a path. Set recursive=true for a recursive walk. Default ignores: node_modules, .git, dist, uploads, .cache, .local.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from project root. Defaults to '.'." },
        recursive: { type: "boolean", default: false },
        includeIgnored: { type: "boolean", default: false, description: "If true, do not skip the default ignore list." },
        maxEntries: { type: "number", default: 5000 },
      },
    },
    handler: listDirectory,
  },
  {
    name: "read_file",
    description: "Read a file's contents. Returns utf8 text by default; pass encoding='base64' for binary.",
    inputSchema: {
      type: "object", required: ["path"],
      properties: {
        path: { type: "string" },
        encoding: { type: "string", enum: ["utf8", "base64"], default: "utf8" },
        maxBytes: { type: "number", default: 5_000_000 },
      },
    },
    handler: readFile,
  },
  {
    name: "write_file",
    description: "Overwrite (or create) a file with the given content. Creates parent directories as needed.",
    inputSchema: {
      type: "object", required: ["path", "content"],
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        encoding: { type: "string", enum: ["utf8", "base64"], default: "utf8" },
      },
    },
    handler: writeFile,
  },
  {
    name: "append_file",
    description: "Append content to the end of a file (creates the file if missing).",
    inputSchema: {
      type: "object", required: ["path", "content"],
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        encoding: { type: "string", enum: ["utf8", "base64"], default: "utf8" },
      },
    },
    handler: appendFile,
  },
  {
    name: "create_file",
    description: "Create a new file. Errors if the file already exists. Use write_file to overwrite.",
    inputSchema: {
      type: "object", required: ["path"],
      properties: {
        path: { type: "string" },
        content: { type: "string", default: "" },
        encoding: { type: "string", enum: ["utf8", "base64"], default: "utf8" },
      },
    },
    handler: createFile,
  },
  {
    name: "delete_file",
    description: "Delete a single file (not a directory).",
    inputSchema: {
      type: "object", required: ["path"],
      properties: { path: { type: "string" } },
    },
    handler: deleteFile,
  },
  {
    name: "move_file",
    description: "Move or rename a file or directory.",
    inputSchema: {
      type: "object", required: ["from", "to"],
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        overwrite: { type: "boolean", default: false },
      },
    },
    handler: moveFile,
  },
  {
    name: "make_directory",
    description: "Create a directory (mkdir -p).",
    inputSchema: {
      type: "object", required: ["path"],
      properties: { path: { type: "string" } },
    },
    handler: makeDirectory,
  },
  {
    name: "delete_directory",
    description: "Delete a directory. Pass recursive=true to remove non-empty directories.",
    inputSchema: {
      type: "object", required: ["path"],
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean", default: false },
      },
    },
    handler: deleteDirectory,
  },
  {
    name: "search_files",
    description: "Find files by filename glob pattern (supports *, **, ?). Skips ignored directories by default.",
    inputSchema: {
      type: "object", required: ["pattern"],
      properties: {
        pattern: { type: "string", description: "e.g. '*.ts', 'README*', 'index*'" },
        path: { type: "string", default: "." },
        includeIgnored: { type: "boolean", default: false },
        limit: { type: "number", default: 500 },
      },
    },
    handler: searchFiles,
  },
  {
    name: "search_in_files",
    description: "Grep file contents for a substring or regex. Returns line numbers and (optionally) surrounding context lines.",
    inputSchema: {
      type: "object", required: ["query"],
      properties: {
        query: { type: "string" },
        path: { type: "string", default: "." },
        isRegex: { type: "boolean", default: false },
        caseSensitive: { type: "boolean", default: false },
        filePattern: { type: "string", description: "Optional filename glob to restrict the search (e.g. '*.ts')." },
        includeIgnored: { type: "boolean", default: false },
        maxMatches: { type: "number", default: 200 },
        contextLines: { type: "number", default: 0 },
      },
    },
    handler: searchInFiles,
  },
];

const toolMap = new Map(tools.map((t) => [t.name, t]));

export function buildMcpServer() {
  const server = new Server(
    { name: "apex-filesystem", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = toolMap.get(req.params.name);
    if (!tool) {
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }] };
    }
    try {
      const result = await tool.handler(req.params.arguments || {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `Tool error (${tool.name}): ${err.message || err}` }],
      };
    }
  });

  return server;
}

export async function runStdio() {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[MCP-FS] stdio transport ready. Root: ${PROJECT_ROOT}\n`);
}

/**
 * Build an Express router that exposes the filesystem MCP server at
 * `/sse`, `/messages`, and `/healthz`. Pass `messagesPath` so the SSE
 * transport tells the client the absolute URL to POST messages to (when
 * mounted under `/fs-mcp`, this must be `/fs-mcp/messages`).
 *
 * Options:
 *   token        — bearer token to require. Defaults to MCP_FS_TOKEN.
 *                  Throws if missing or shorter than 8 chars.
 *   messagesPath — absolute URL path the SSE transport reports back to
 *                  the client. Defaults to "/messages" (standalone mode).
 *   jsonLimit    — express.json body limit. Defaults to "8mb".
 */
export function createMcpFsRouter({ token, messagesPath = "/messages", jsonLimit = "8mb" } = {}) {
  const tok = token ?? process.env.MCP_FS_TOKEN;
  if (!tok || tok.trim().length < 8) {
    throw new Error("MCP_FS_TOKEN must be set (min 8 chars) before the filesystem MCP router can be mounted.");
  }
  const expectedBuf = Buffer.from(tok);

  function checkAuth(req, res) {
    const header = req.header("authorization") || "";
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      res.status(401).json({ error: "Missing Authorization: Bearer <token>" });
      return false;
    }
    const provided = Buffer.from(m[1].trim());
    if (provided.length !== expectedBuf.length || !crypto.timingSafeEqual(provided, expectedBuf)) {
      res.status(401).json({ error: "Invalid bearer token" });
      return false;
    }
    return true;
  }

  const router = express.Router();
  router.use(express.json({ limit: jsonLimit }));

  router.get("/healthz", (_req, res) =>
    res.json({ ok: true, root: PROJECT_ROOT, tools: tools.length, mountedAt: messagesPath.replace(/\/messages$/, "") || "/" }),
  );

  const sessions = new Map();

  router.get("/sse", async (req, res) => {
    if (!checkAuth(req, res)) return;
    const transport = new SSEServerTransport(messagesPath, res);
    sessions.set(transport.sessionId, transport);
    res.on("close", () => sessions.delete(transport.sessionId));
    const server = buildMcpServer();
    await server.connect(transport);
  });

  router.post("/messages", async (req, res) => {
    if (!checkAuth(req, res)) return;
    const sessionId = req.query.sessionId;
    const transport = sessions.get(sessionId);
    if (!transport) {
      return res.status(404).json({ error: "Unknown sessionId" });
    }
    await transport.handlePostMessage(req, res, req.body);
  });

  return router;
}
