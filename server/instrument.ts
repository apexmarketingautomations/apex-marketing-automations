// @ts-nocheck
/**
 * server/instrument.ts
 * ----------------------
 * Sentry initialisation — MUST be the first import in server/index.ts.
 *
 * In the compiled CJS bundle (dist/index.cjs), require() calls execute in
 * import order, so placing this import first guarantees Sentry is active
 * before any Express middleware, DB connections, or queue workers start.
 *
 * PII policy: sendDefaultPii = FALSE
 *   Apex processes crash victims, legal signals, and insurance data.
 *   We never send raw payload bodies or request headers to a third-party
 *   error tracker. Sentry receives only: stack traces, error messages,
 *   module names, breadcrumbs, and our explicit custom tags/contexts.
 *
 * The beforeSend hook strips any field that might carry PII before the
 * event leaves the process.
 */

import * as Sentry from "@sentry/node";

const SENTRY_DSN = process.env.SENTRY_DSN;

if (!SENTRY_DSN) {
  console.warn(
    "[SENTRY] SENTRY_DSN not set — error tracking disabled. " +
    "Set SENTRY_DSN in Railway environment variables."
  );
}

// Fields to redact from Sentry event extras/contexts (case-insensitive match)
const PII_FIELD_PATTERNS = [
  /phone/i,
  /email/i,
  /address/i,
  /ssn/i,
  /dob/i,
  /birth/i,
  /license/i,
  /insurance/i,
  /vin\b/i,
  /password/i,
  /token/i,
  /secret/i,
  /key/i,
  /auth/i,
  /cookie/i,
  /credit/i,
  /card/i,
];

function redactPii(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    const isSensitive = PII_FIELD_PATTERNS.some((p) => p.test(k));
    if (isSensitive) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactPii(v as Record<string, any>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Errors we don't want filling up our Sentry quota
const IGNORED_ERROR_MESSAGES = [
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "socket hang up",
  "Client network socket disconnected",
  "read ECONNRESET",
  "write ECONNRESET",
];

Sentry.init({
  dsn: SENTRY_DSN,

  // Environment + release
  environment: process.env.NODE_ENV ?? "development",
  release: process.env.RAILWAY_GIT_COMMIT_SHA
    ? `apex-backend@${process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 8)}`
    : undefined,

  // Tracing: 10% in production to avoid quota burn
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.10 : 1.0,

  // Never send request bodies, headers, cookies, or IP addresses
  sendDefaultPii: false,

  // Show variable values in stack frames (local variables only, not request data)
  includeLocalVariables: true,

  // Enable Sentry structured logging feature
  enableLogs: true,

  // Scrub PII from every event before it leaves the process
  beforeSend(event) {
    // Drop noisy network errors
    const msg = event.exception?.values?.[0]?.value ?? "";
    if (IGNORED_ERROR_MESSAGES.some((m) => msg.includes(m))) {
      return null;
    }

    // Redact PII from extra context if present
    if (event.extra) {
      event.extra = redactPii(event.extra as Record<string, any>);
    }

    // Strip request body entirely (Apex never needs it in Sentry)
    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;
      delete (event.request as any).headers?.authorization;
      delete (event.request as any).headers?.cookie;
    }

    return event;
  },
});

// ─── Helpers for structured worker/provider error capture ────────────────────
// Import these in workers instead of calling Sentry directly.

export function captureWorkerError(
  workerName: string,
  jobType: string,
  error: Error,
  context?: Record<string, any>
): void {
  Sentry.withScope((scope) => {
    scope.setTag("worker", workerName);
    scope.setTag("job_type", jobType);
    scope.setContext("job", context ? redactPii(context) : {});
    Sentry.captureException(error);
  });
}

export function captureProviderError(
  provider: string,
  operation: string,
  error: Error,
  context?: Record<string, any>
): void {
  Sentry.withScope((scope) => {
    scope.setTag("provider", provider);
    scope.setTag("operation", operation);
    scope.setContext("provider_call", context ? redactPii(context) : {});
    Sentry.captureException(error);
  });
}

export function captureIngestionError(
  pipeline: string,
  error: Error,
  context?: Record<string, any>
): void {
  Sentry.withScope((scope) => {
    scope.setTag("pipeline", pipeline);
    scope.setContext("ingestion", context ? redactPii(context) : {});
    Sentry.captureException(error);
  });
}

export { Sentry };
