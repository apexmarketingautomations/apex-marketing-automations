#!/usr/bin/env node
/**
 * Filesystem MCP Server — CLI entrypoint.
 *
 * Standalone runner for the filesystem MCP. The actual tool
 * implementations and the mountable Express router live in the
 * bundle-safe sibling module `./mcp-fs-router.js`, so the same code
 * can be reused by the main app's `/fs-mcp` mount without dragging
 * any CLI / `import.meta.url` machinery into the production CJS
 * bundle.
 *
 * Two transports, selected by a CLI flag or env var:
 *
 *   stdio  — for Claude Desktop. No bearer token; trusted because the
 *            client launches the process locally.
 *
 *   http   — for remote MCP clients (Claude on the web). Requires an
 *            Authorization header with a bearer token that matches the
 *            MCP_FS_TOKEN env var. Refuses to start if MCP_FS_TOKEN is
 *            not set or is shorter than 8 characters.
 *
 * Modes:
 *   node mcp-fs-server.js stdio
 *   node mcp-fs-server.js http  [--port 8099]
 *
 * Or via env: MCP_FS_TRANSPORT=stdio | http
 *
 * NOTE: This file is **never** imported by the main app. The main app
 * imports `mcp-fs-router.js` directly. Keeping this file CLI-only
 * means it is safe to use ESM-only constructs like `import.meta.url`
 * here without breaking the production CJS bundle.
 */

import express from "express";
import fssync from "node:fs";
import { createMcpFsRouter, runStdio, PROJECT_ROOT, tools } from "./mcp-fs-router.js";

function runHttp({ port }) {
  let router;
  try {
    router = createMcpFsRouter({ messagesPath: "/messages" });
  } catch (err) {
    console.error(`[MCP-FS] FATAL: ${err.message}`);
    process.exit(1);
  }
  const app = express();
  app.use(router);

  app.listen(port, "0.0.0.0", () => {
    const publicHost =
      process.env.REPLIT_DEPLOYMENT_DOMAIN ||
      (process.env.REPLIT_DOMAINS?.split(",")[0]) ||
      `localhost:${port}`;
    const isPublic = publicHost && !publicHost.startsWith("localhost");
    const publicSuffix = process.env.REPLIT_DEPLOYMENT_DOMAIN ? "" : `:${port}`;
    console.log("════════════════════════════════════════════════════════════════");
    console.log(`[MCP-FS] HTTP transport listening on 0.0.0.0:${port}`);
    console.log(`[MCP-FS]   Project root:    ${PROJECT_ROOT}`);
    console.log(`[MCP-FS]   Tools exposed:   ${tools.length}`);
    console.log(`[MCP-FS]   SSE URL (local): http://localhost:${port}/sse`);
    if (isPublic) {
      console.log(`[MCP-FS]   SSE URL (public): https://${publicHost}${publicSuffix}/sse`);
    }
    console.log(`[MCP-FS]   Auth: bearer token via MCP_FS_TOKEN (set, value not logged)`);
    console.log("════════════════════════════════════════════════════════════════");
  });
}

const args = process.argv.slice(2);
const transportArg = args.find((a) => a === "stdio" || a === "http");
const portIdx = args.indexOf("--port");
const portArg = portIdx >= 0 ? Number(args[portIdx + 1]) : undefined;
const transport = transportArg || process.env.MCP_FS_TRANSPORT || "stdio";
const port = portArg || Number(process.env.MCP_FS_PORT) || 8099;

if (!fssync.existsSync(PROJECT_ROOT)) {
  console.error(`[MCP-FS] FATAL: project root does not exist: ${PROJECT_ROOT}`);
  process.exit(1);
}

if (transport === "stdio") {
  runStdio().catch((err) => {
    console.error("[MCP-FS] stdio fatal:", err);
    process.exit(1);
  });
} else if (transport === "http") {
  runHttp({ port });
} else {
  console.error(`[MCP-FS] Unknown transport: ${transport}. Use 'stdio' or 'http'.`);
  process.exit(2);
}
