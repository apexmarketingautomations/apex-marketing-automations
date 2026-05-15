/**
 * server/logger.ts
 * -----------------
 * Structured logger for Apex Marketing OS.
 *
 * Writes to stdout (always) AND ships to Axiom (when AXIOM_TOKEN is set).
 *
 * Usage:
 *   import { logger } from "./logger";
 *   logger.info("contact.routed", { contactId, firmId });
 *   logger.error("batch.failed", { pipeline: "crash-ingest" }, error);
 *   logger.warn("rate.limit", { provider: "batchdata", retryAfter: 60 });
 *
 * Log levels: debug | info | warn | error
 *
 * Axiom config (set in Railway environment variables):
 *   AXIOM_TOKEN   — ingest token (xaat-…)
 *   AXIOM_DATASET — dataset name (apex-logs)
 *
 * PII policy: never log raw payload bodies, phone numbers, SSNs,
 *   or any field matched by the PII_FIELD_PATTERNS list.
 *   Pass structured context objects; the logger will redact sensitive keys.
 */

import { Axiom } from "@axiomhq/js";

// ─── PII redaction (same patterns as instrument.ts) ───────────────────────────

const PII_FIELD_PATTERNS = [
  /phone/i,
  /email/i,
  /address/i,
  /ssn/i,
  /dob/i,
  /birth/i,
  /license/i,
  /insurance/i,
  /\bvin\b/i,
  /password/i,
  /\btoken\b/i,
  /secret/i,
  /\bkey\b/i,
  /\bauth\b/i,
  /cookie/i,
  /credit/i,
  /card/i,
];

function redactPii(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PII_FIELD_PATTERNS.some((p) => p.test(k))) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactPii(v as Record<string, any>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── Axiom client (lazy init) ─────────────────────────────────────────────────

const AXIOM_TOKEN = process.env.AXIOM_TOKEN;
const AXIOM_DATASET = process.env.AXIOM_DATASET ?? "apex-logs";

let axiomClient: Axiom | null = null;

function getAxiom(): Axiom | null {
  if (axiomClient) return axiomClient;
  if (!AXIOM_TOKEN) return null;

  try {
    axiomClient = new Axiom({ token: AXIOM_TOKEN });
    return axiomClient;
  } catch (err: any) {
    console.warn("[LOGGER] Failed to init Axiom client:", err?.message);
    return null;
  }
}

// ─── Log level types ──────────────────────────────────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_EMOJI: Record<LogLevel, string> = {
  debug: "🔍",
  info:  "ℹ️ ",
  warn:  "⚠️ ",
  error: "🔴",
};

// ─── Core log function ────────────────────────────────────────────────────────

function log(
  level: LogLevel,
  event: string,
  context: Record<string, any> = {},
  error?: Error
): void {
  const ts = new Date().toISOString();
  const safe = redactPii(context);

  // ── 1. stdout ────────────────────────────────────────────────────────────
  const prefix = `[${ts}] ${LEVEL_EMOJI[level]} [${level.toUpperCase()}] ${event}`;
  const contextStr = Object.keys(safe).length
    ? " " + JSON.stringify(safe)
    : "";
  const errStr = error ? ` — ${error.message}` : "";

  if (level === "error") {
    console.error(prefix + contextStr + errStr);
    if (error?.stack) console.error(error.stack);
  } else if (level === "warn") {
    console.warn(prefix + contextStr + errStr);
  } else {
    console.log(prefix + contextStr + errStr);
  }

  // ── 2. Axiom (fire-and-forget) ────────────────────────────────────────────
  const axiom = getAxiom();
  if (!axiom) return;

  const entry: Record<string, any> = {
    _time: ts,
    level,
    event,
    service: process.env.RAILWAY_SERVICE_NAME ?? "apex-backend",
    environment: process.env.NODE_ENV ?? "development",
    replica: process.env.RAILWAY_REPLICA_ID ?? "local",
    commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) ?? "dev",
    ...safe,
  };

  if (error) {
    entry.error_message = error.message;
    entry.error_name = error.name;
    // Don't include stack trace — too verbose for Axiom queries
  }

  axiom.ingest(AXIOM_DATASET, [entry]);
}

// ─── Flush helper (call in SIGTERM handler) ───────────────────────────────────

export async function flushLogs(): Promise<void> {
  try {
    await axiomClient?.flush();
    console.log("[LOGGER] Axiom log buffer flushed");
  } catch {
    // Non-fatal — logs are already on stdout
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const logger = {
  debug: (event: string, context?: Record<string, any>) =>
    log("debug", event, context),

  info: (event: string, context?: Record<string, any>) =>
    log("info", event, context),

  warn: (event: string, context?: Record<string, any>, error?: Error) =>
    log("warn", event, context, error),

  error: (event: string, context?: Record<string, any>, error?: Error) =>
    log("error", event, context, error),
};

// ─── Startup notice ───────────────────────────────────────────────────────────

if (AXIOM_TOKEN) {
  console.log(
    `[LOGGER] ✅ Axiom logging enabled → dataset: ${AXIOM_DATASET}`
  );
} else {
  console.warn(
    "[LOGGER] AXIOM_TOKEN not set — logs to stdout only. " +
    "Set AXIOM_TOKEN in Railway environment variables."
  );
}
