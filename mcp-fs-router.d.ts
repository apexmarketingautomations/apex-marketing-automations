/**
 * Ambient type declarations for the bundle-safe filesystem MCP router.
 *
 * Mirrors the named exports from `mcp-fs-router.js`. We only type the
 * surface the main app actually uses (`createMcpFsRouter`); the CLI
 * shim `mcp-fs-server.js` imports the rest at runtime in plain JS so
 * full typings there are not worth the maintenance cost.
 */

import type { RequestHandler, Router } from "express";

export interface CreateMcpFsRouterOptions {
  /**
   * Bearer token clients must present in `Authorization: Bearer <token>`.
   * Defaults to `process.env.MCP_FS_TOKEN`. The factory throws if the
   * resolved token is missing or shorter than 8 characters.
   */
  token?: string;
  /**
   * Absolute URL path that the SSE `endpoint` event should advertise
   * for the JSON-RPC POST channel. Must include any parent mount, e.g.
   * `"/fs-mcp/messages"` when the router is mounted at `/fs-mcp`.
   * Defaults to `"/messages"` for the standalone CLI case.
   */
  messagesPath?: string;
  /**
   * Body-size limit for the router's own `express.json` parser, applied
   * only to POSTs into the `messagesPath` endpoint. Defaults to `"8mb"`.
   */
  jsonLimit?: string;
}

/**
 * Build an Express router that exposes:
 *   GET  <mount>/healthz   — unauthenticated status JSON
 *   GET  <mount>/sse       — bearer-auth SSE stream (MCP server→client)
 *   POST <messagesPath>    — bearer-auth JSON-RPC channel (client→server)
 *
 * Mount it on the main app BEFORE any global JSON parser; the router
 * supplies its own with `jsonLimit`.
 */
export function createMcpFsRouter(options?: CreateMcpFsRouterOptions): Router;

/** Number of MCP tools exported by the router (informational). */
export const tools: ReadonlyArray<unknown>;

/** Resolved project root the router operates against. */
export const PROJECT_ROOT: string;

/** Run the same tools over a stdio transport (used by the CLI shim). */
export function runStdio(): Promise<void>;
