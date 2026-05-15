# STAGE 4A — Observability Architecture Plan
**Apex Marketing OS | Production Hardening Series**
**Status:** Planned | **Target:** Railway + Neon environment | **Date:** 2026-05-15

---

## Executive Summary

Apex Marketing OS currently has no external error tracking, no durable log aggregation outside the database, and no alerting on worker failures or queue saturation. If Neon goes down — even transiently — the application loses all logging and operates completely blind. Dead-letter events accumulate silently. Provider failures (BatchData, Apify, Resend) generate `console.error()` output that vanishes into Railway's 7-day log buffer with no alert and no queryable history.

This document specifies the complete observability stack: Sentry for error tracking, Axiom via Railway log drain for aggregation, and a `/internal/health/*` endpoint suite for operational visibility. The stack is zero-Redis, zero-additional-infrastructure, and can be fully operational within one 3-hour deployment window.

---

## 1. Current Observability Gap Assessment

| Gap | Current State | Severity | Fix |
|-----|---------------|----------|-----|
| Error tracking | `console.error()` only — no capture, no dedup, no alerting | **CRITICAL** | Sentry `@sentry/node` |
| Log persistence | `server/systemLogger.ts` writes to Neon DB only — DB failure = complete log blindspot | **CRITICAL** | Axiom Railway log drain + console dual-write |
| Worker health | `server/jobQueue.ts` is in-memory; no external health signal | **HIGH** | `/internal/health/queues` endpoint |
| Dead-letter alerting | `server/eventRetryProcessor.ts` logs to console when DLQ threshold hit — no alert | **HIGH** | Sentry alert on `dead_letter` status transition |
| Provider failure alerting | None — BatchData/Apify/Resend failures are silent after retry exhaustion | **HIGH** | `captureProviderError()` → Sentry `provider_failure` tag |
| Queue depth monitoring | `server/operator/telemetry.ts` holds metrics in-process memory only | **HIGH** | Metrics flush to Axiom + alert thresholds |
| Memory monitoring | No RSS tracking; Node.js OOM kills Railway instance silently | **MEDIUM** | RSS watcher cron → Sentry alert at 450MB |
| Deployment visibility | Railway build logs only — no before/after state comparison | **MEDIUM** | Axiom log drain (Railway-native, zero code) |
| Ingestion lag tracking | No monitoring that FLHSMV/court scrapers are actually running | **MEDIUM** | `ingestion_lag_check` cron → Sentry if lag > 24h |
| Diagnostics data | `server/operator/diagnostics.ts` stores checks in-process array (lost on restart) | **MEDIUM** | Structured console emit → Axiom queryable |
| Telemetry durability | `server/operator/telemetry.ts` counters/gauges are in-process Maps | **LOW** | Periodic flush to structured console log |

---

## 2. Observability Stack Decision

### Tier 1 — Error Tracking: Sentry

**Why Sentry:**
- Industry standard for Node.js applications; native Railway integration
- Express request handler injects request context automatically
- Deduplication: same error class + stack = single issue, not 10k separate alerts
- Free tier: 5,000 errors/month — sufficient for current traffic
- DSN injection: set `SENTRY_DSN` in Railway env, zero infra to manage
- Setup time: 2 hours end-to-end including deploy

**Cost:**
- $0/month (free tier, 5k errors)
- $26/month if volume exceeds 5k/month (Team plan)

**SDK:** `@sentry/node` `@sentry/profiling-node`

**Key integrations:** Express middleware, `unhandledRejection`, `uncaughtException`, worker error capture

---

### Tier 2 — Log Aggregation: Axiom

**Why Axiom:**
- Railway has a **native Axiom log drain** — 15-minute setup, zero code change required
- All `console.log/warn/error` output automatically shipped and indexed
- APL (Axiom Processing Language) — SQL-like query syntax for log analysis
- Free tier: 10GB/month ingestion — more than adequate
- Retention: 30 days on free tier
- Alternative: BetterStack (also Railway-native, similar pricing) — either works

**Cost:**
- $0/month (free: 10GB/month, 30-day retention)
- $25/month if volume exceeds 10GB (unlikely at current scale)

**Setup:** Railway → Settings → Integrations → Log Drains → Add Axiom drain. No code required for basic log capture. Code changes in `server/systemLogger.ts` upgrade logs to structured JSON.

---

### Tier 3 — Queue Metrics (Phase 4B)

Currently `server/jobQueue.ts` is an in-memory queue (no Redis). Phase 4B introduces BullMQ + Redis, at which point BullMQ Board can be mounted behind `/internal/bull-board`, protected by the existing `internalOnly` middleware from Stage 2. This is out of scope for Stage 4A but designed for drop-in readiness.

---

## 3. Sentry Integration Plan

### Installation

```bash
npm install @sentry/node @sentry/profiling-node
```

Add to Railway environment:
```
SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
```

---

### `server/observability/sentry.ts` (new file)

```typescript
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

/**
 * Call once at process startup, before any route registration.
 * Reads SENTRY_DSN from env; silently no-ops if not configured.
 */
export function initSentry(): void {
  if (!process.env.SENTRY_DSN) {
    console.warn('[SENTRY] DSN not configured — error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'production',

    // RAILWAY_GIT_COMMIT_SHA is injected automatically by Railway on each deploy.
    // This links errors to the exact commit that produced them.
    release: process.env.RAILWAY_GIT_COMMIT_SHA,

    integrations: [
      nodeProfilingIntegration(),
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
    ],

    // Sample 10% of requests for performance tracing.
    // Does NOT affect error capture — all errors are always sent.
    tracesSampleRate: 0.1,

    // Profile 5% of sampled transactions (CPU flamegraphs in Sentry).
    profilesSampleRate: 0.05,

    beforeSend(event) {
      // Strip PII fields from error context before transmission to Sentry.
      // Apex handles personal injury plaintiff data — PII must not leave the Neon boundary.
      if (event.extra?.phone) event.extra.phone = '[REDACTED]';
      if (event.extra?.ssn) event.extra.ssn = '[REDACTED]';
      if (event.extra?.email) event.extra.email = '[REDACTED]';
      if (event.extra?.dob) event.extra.dob = '[REDACTED]';
      if (event.extra?.dlNumber) event.extra.dlNumber = '[REDACTED]';
      return event;
    },
  });

  console.log('[SENTRY] Initialized — environment:', process.env.NODE_ENV ?? 'production');
}

/**
 * Capture a worker job failure with full context tags.
 * Called from server/eventRetryProcessor.ts and individual worker modules.
 */
export function captureWorkerError(
  err: Error,
  context: {
    queue: string;        // e.g. 'apex-intake', 'apex-enrichment'
    jobType: string;      // e.g. 'crash-ingest', 'skip-trace'
    jobId?: string;
    traceId?: string;
    accountId?: number;
    subAccountId?: number;
    retryCount?: number;
    permanent?: boolean;  // true = DLQ transition, fire alert
  }
): void {
  Sentry.captureException(err, {
    level: context.permanent ? 'fatal' : 'error',
    tags: {
      queue: context.queue,
      job_type: context.jobType,
      permanent_failure: String(context.permanent ?? false),
    },
    extra: {
      jobId: context.jobId,
      traceId: context.traceId,
      accountId: context.accountId,
      subAccountId: context.subAccountId,
      retryCount: context.retryCount,
    },
  });
}

/**
 * Capture a third-party provider failure (BatchData, Apify, Resend, Twilio, OpenAI).
 * Tagged as provider_failure so Sentry alerts can target this category specifically.
 */
export function captureProviderError(
  err: Error,
  provider: string,
  operation: string,
  extra?: Record<string, unknown>
): void {
  Sentry.captureException(err, {
    tags: {
      type: 'provider_failure',
      provider,
      operation,
    },
    extra: extra ?? {},
  });
}

/**
 * Record a breadcrumb for structured event tracing within a request.
 * Breadcrumbs appear in Sentry's issue view as a timeline of events leading to the error.
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>
): void {
  Sentry.addBreadcrumb({ message, category, data, level: 'info' });
}

// Re-export Sentry request/error handlers for use in server/index.ts
export { Sentry };
```

---

### Patches to `server/index.ts`

The existing `server/index.ts` already handles `unhandledRejection` and `uncaughtException` with `logSystemEvent`. Replace those handlers and add Sentry middleware:

```typescript
// TOP OF FILE — before any other imports
import { initSentry, Sentry } from './observability/sentry';
initSentry();  // Must run before Express app creation

// After: const app = express();
// Before: all route registrations
app.use(Sentry.expressRequestHandler());  // Injects Sentry request context

// ... existing middleware stack (helmet, cors, etc.) ...
// ... existing route registrations ...

// After all routes, before custom error handler:
app.use(Sentry.expressErrorHandler());

// REPLACE the existing unhandledRejection handler:
process.on('unhandledRejection', (reason: any) => {
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  console.error('[PROCESS] Unhandled promise rejection:', reason?.message || reason);
  logSystemError('process', 'Unhandled promise rejection', {
    message: reason?.message || String(reason),
    stack: reason?.stack?.substring(0, 500),
  });
});

// REPLACE the existing uncaughtException handler:
process.on('uncaughtException', (err: Error) => {
  Sentry.captureException(err);
  console.error('[PROCESS] Uncaught exception:', err.message);
  logSystemError('process', 'Uncaught exception', {
    message: err.message,
    stack: err.stack?.substring(0, 500),
  });
  // Give Sentry 2 seconds to flush before exiting
  Sentry.close(2000).finally(() => process.exit(1));
});
```

---

### Patch to `server/eventRetryProcessor.ts`

The dead-letter transition at line 56 currently emits only `console.warn`. Add Sentry capture:

```typescript
import { captureWorkerError } from './observability/sentry';

// In the permanent failure branch (newRetryCount >= event.maxRetries):
if (newRetryCount >= event.maxRetries) {
  await storage.updateEventLogStatus(event.id, EVENT_LOG_STATUS.DEAD_LETTER, {
    failedAt: new Date(),
    errorMessage: `Max retries (${event.maxRetries}) exceeded. Last error: ${err.message}`,
    retryCount: newRetryCount,
  });

  // NEW: alert Sentry on permanent failure
  captureWorkerError(err, {
    queue: 'event-retry-processor',
    jobType: event.type,
    jobId: String(event.id),
    traceId: event.traceId,
    retryCount: newRetryCount,
    permanent: true,  // triggers 'fatal' level in Sentry → Sentry alert fires
  });

  console.warn(`[RETRY-PROCESSOR] Event ${event.id} moved to dead_letter after ${newRetryCount} retries`);
}
```

---

## 4. Axiom Integration Plan

### Setup (Railway-native, zero application code required)

1. Create Axiom account at `axiom.co` (free tier: 10GB/month, 30-day retention)
2. In Axiom UI: **New Dataset** → name it `apex-production`
3. In Axiom UI: **Settings → API Tokens** → create ingest token → copy it
4. In Railway: **Project → Settings → Integrations → Log Drains → Add Log Drain**
5. Select "Axiom" as destination → paste API token + dataset name
6. Railway will immediately begin forwarding all stdout/stderr to Axiom
7. Verify: deploy anything, check Axiom dataset within 60 seconds

**All existing `console.log/warn/error` calls throughout the codebase are automatically captured — including from `server/jobQueue.ts`, `server/operator/telemetry.ts`, `server/operator/diagnostics.ts`, and `server/mailchimp.ts`.**

### Add Railway env vars

```
AXIOM_API_KEY=<ingest-token>
AXIOM_DATASET=apex-production
```

---

### Structured logging upgrade for `server/systemLogger.ts`

The current implementation writes only to Neon DB. If Neon is unavailable, **all log writes silently fail** (the catch block calls `console.error`, which itself is the only fallback). The patch below makes console the primary, durable channel and demotes DB write to best-effort:

```typescript
// server/systemLogger.ts — patched for dual-write
import { db } from "./db";
import { systemLogs } from "@shared/schema";
import { desc, eq, and, gte } from "drizzle-orm";

export type LogSeverity = "debug" | "info" | "warn" | "error" | "critical";

export async function logSystemEvent(
  severity: LogSeverity,
  module: string,
  message: string,
  metadata?: Record<string, any>
): Promise<void> {
  // TIER 1 — Structured console emit (always runs; Axiom captures via Railway drain)
  // JSON format enables APL queries in Axiom: | where severity == "error" | where module == "crash-ingest"
  const payload = {
    severity,
    module,
    message,
    ts: new Date().toISOString(),
    ...(metadata ? { meta: metadata } : {}),
  };

  if (severity === 'error' || severity === 'critical') {
    console.error(JSON.stringify(payload));
  } else if (severity === 'warn') {
    console.warn(JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload));
  }

  // TIER 2 — DB write (best-effort, non-blocking; failure does NOT bubble up)
  // If Neon is down, logs are still durable in Axiom via the Railway drain.
  db.insert(systemLogs)
    .values({ severity, module, message, metadata: metadata ?? null })
    .catch((err: Error) => {
      // Log the DB failure to console (also captured by Axiom)
      console.error(JSON.stringify({
        severity: 'error',
        module: 'system-logger',
        message: 'DB log write failed — log captured in Axiom only',
        ts: new Date().toISOString(),
        meta: { originalModule: module, originalMessage: message, dbError: err.message },
      }));
    });
}

export async function logSystemError(
  module: string,
  message: string,
  metadata?: Record<string, any>
): Promise<void> {
  return logSystemEvent("error", module, message, metadata);
}

// getSystemLogs unchanged — continues to query Neon for the UI log viewer
export async function getSystemLogs(options?: {
  severity?: string;
  module?: string;
  limit?: number;
  offset?: number;
  since?: Date;
}) {
  const conditions = [];
  if (options?.severity) conditions.push(eq(systemLogs.severity, options.severity));
  if (options?.module) conditions.push(eq(systemLogs.module, options.module));
  if (options?.since) conditions.push(gte(systemLogs.timestamp, options.since));

  return db
    .select()
    .from(systemLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(systemLogs.timestamp))
    .limit(options?.limit ?? 100)
    .offset(options?.offset ?? 0);
}
```

---

## 5. Queue Observability

### Current state

`server/jobQueue.ts` implements an in-process `JobQueue` class backed by an in-memory array. The class has a `getStats()` method used in `server/operator/telemetry.ts` (`collectSystemMetrics()`). This data lives only in the running process and is lost on every Railway restart. There is no HTTP endpoint exposing this data.

### `GET /internal/health/queues`

New endpoint returning current queue state. Protected by `internalOnly` middleware (Stage 2 implementation — requires `x-internal-token` header matching `INTERNAL_API_SECRET` env var).

```typescript
// server/routes/internal.ts (append to existing internal routes)
import { jobQueue } from '../jobQueue';
import { collectSystemMetrics } from '../operator/telemetry';

router.get('/health/queues', internalOnly, (req, res) => {
  const queueStats = jobQueue.getStats();
  const systemMetrics = collectSystemMetrics();
  const mem = process.memoryUsage();

  const deadLetterTotal = queueStats.history?.filter(
    (j: any) => j.status === 'failed' && j.attempts >= j.maxAttempts
  ).length ?? 0;

  const response = {
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      alert: mem.rss > 450 * 1024 * 1024 ? 'RSS_THRESHOLD_EXCEEDED' : null,
    },
    queue: {
      queued: queueStats.queued,
      running: queueStats.running,
      completed: queueStats.completed,
      failed: queueStats.failed,
    },
    dead_letter_total: deadLetterTotal,
    event_bus: systemMetrics.eventBus ?? {},
    thresholds: {
      queue_waiting_max: 200,
      dead_letter_alert_at: 10,
      memory_rss_alert_mb: 450,
    },
  };

  // Emit as structured log so Axiom captures queue state on every health poll
  if (deadLetterTotal >= 10) {
    console.error(JSON.stringify({
      severity: 'error',
      module: 'queue-health',
      message: `Dead letter threshold exceeded: ${deadLetterTotal} events`,
      ts: new Date().toISOString(),
      meta: response,
    }));
  }

  res.json(response);
});
```

### Alert thresholds

```typescript
// server/observability/alertThresholds.ts
export const ALERT_THRESHOLDS = {
  // In-process job queue (current — Phase 4A)
  jobQueue: {
    queuedMax: 200,       // Alert when more than 200 jobs waiting
    failedMax: 10,        // Alert when more than 10 failed jobs in history
    runningMax: 20,       // Alert when more than 20 concurrent jobs
  },

  // Dead-letter events (server/eventRetryProcessor.ts)
  deadLetterTotal: 10,    // Alert when DLQ exceeds 10 events

  // Memory
  memoryRssMB: 450,       // Alert if RSS > 450MB on Railway (512MB hard limit)

  // Ingestion pipelines
  ingestionLagHours: {
    flhsmv: 24,           // FLHSMV crash ingest: alert if no new records in 24h
    court_listener: 48,   // CourtListener: alert if no new records in 48h
    county_booking: 72,   // County booking scrapers: alert if silent for 72h
  },
} as const;
```

---

## 6. Ingestion Lag Monitoring

The FLHSMV crash ingest pipeline, court filing pipeline, and county booking scrapers are scheduled background processes. If they stop running (exception, dependency failure, Railway OOM), there is currently no alert. The `sentinel_incidents` table provides ground truth.

### SQL lag detection (run as cron every 30 minutes)

```sql
-- Detect ingestion pipeline lag
SELECT
  source_pipeline,
  COUNT(*)                                AS ingested_24h,
  MAX(created_at)                         AS last_ingest_at,
  EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 3600 AS lag_hours
FROM sentinel_incidents
WHERE created_at > NOW() - INTERVAL '48 hours'
GROUP BY source_pipeline
ORDER BY lag_hours DESC;

-- Expected baseline (healthy state):
--   flhsmv_crash     → lag < 12 hours
--   court_listener   → lag < 36 hours
--   county_booking   → lag < 60 hours
```

### Cron job implementation

```typescript
// server/crons/ingestionLagCheck.ts
import { db } from '../db';
import { sentinelIncidents } from '@shared/schema';
import { sql, max } from 'drizzle-orm';
import { captureWorkerError } from '../observability/sentry';
import { ALERT_THRESHOLDS } from '../observability/alertThresholds';

export async function checkIngestionLag(): Promise<void> {
  const rows = await db
    .select({
      sourcePipeline: sentinelIncidents.sourcePipeline,
      lastIngestAt: max(sentinelIncidents.createdAt),
    })
    .from(sentinelIncidents)
    .groupBy(sentinelIncidents.sourcePipeline);

  for (const row of rows) {
    if (!row.lastIngestAt) continue;
    const lagHours = (Date.now() - row.lastIngestAt.getTime()) / (1000 * 60 * 60);
    const threshold = ALERT_THRESHOLDS.ingestionLagHours[
      row.sourcePipeline as keyof typeof ALERT_THRESHOLDS.ingestionLagHours
    ] ?? 48;

    if (lagHours > threshold) {
      const err = new Error(
        `Ingestion lag alert: ${row.sourcePipeline} has not ingested in ${lagHours.toFixed(1)} hours (threshold: ${threshold}h)`
      );
      captureWorkerError(err, {
        queue: 'apex-maintenance',
        jobType: 'ingestion-lag-check',
        permanent: false,
        retryCount: 0,
      });
      console.error(JSON.stringify({
        severity: 'error',
        module: 'ingestion-lag-check',
        message: err.message,
        ts: new Date().toISOString(),
        meta: { sourcePipeline: row.sourcePipeline, lagHours, threshold },
      }));
    }
  }
}
```

---

## 7. Provider Health Monitoring

### `GET /internal/health/providers`

Checks all external dependencies Apex relies on. Returns structured status for each. Protected by `internalOnly` middleware.

```typescript
// server/observability/providerHealth.ts
import { captureProviderError } from './sentry';

interface ProviderStatus {
  name: string;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: string;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

export async function checkAllProviders(): Promise<ProviderStatus[]> {
  const checks: Array<{ name: string; fn: () => Promise<void> }> = [
    {
      name: 'neon-db',
      fn: async () => {
        const { db } = await import('../db');
        await db.execute(sql`SELECT 1`);
      },
    },
    {
      name: 'resend',
      fn: async () => {
        const key = process.env.RESEND_API_KEY ?? process.env.RESEND_KEY;
        if (!key) throw new Error('RESEND_API_KEY not configured');
        const res = await fetch('https://api.resend.com/emails', {
          method: 'GET',
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!res.ok && res.status !== 405) throw new Error(`Resend status: ${res.status}`);
      },
    },
    {
      name: 'openai',
      fn: async () => {
        const key = process.env.OPENAI_API_KEY;
        if (!key) throw new Error('OPENAI_API_KEY not configured');
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!res.ok) throw new Error(`OpenAI status: ${res.status}`);
      },
    },
    {
      name: 'twilio',
      fn: async () => {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        if (!sid || !token) throw new Error('Twilio credentials not configured');
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
          headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
        });
        if (!res.ok) throw new Error(`Twilio status: ${res.status}`);
      },
    },
  ];

  const results: ProviderStatus[] = [];

  for (const check of checks) {
    const start = Date.now();
    try {
      await withTimeout(check.fn(), 5000);
      results.push({
        name: check.name,
        healthy: true,
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      captureProviderError(err, check.name, 'health-check');
      results.push({
        name: check.name,
        healthy: false,
        latencyMs: Date.now() - start,
        error: err.message,
        checkedAt: new Date().toISOString(),
      });
    }
  }

  // Emit structured log — Axiom captures; queryable as: | where healthy == false
  console.log(JSON.stringify({
    severity: 'info',
    module: 'provider-health',
    message: 'Provider health check complete',
    ts: new Date().toISOString(),
    meta: {
      healthy: results.filter(r => r.healthy).length,
      unhealthy: results.filter(r => !r.healthy).length,
      providers: results,
    },
  }));

  return results;
}
```

---

## 8. Memory Watcher

Node.js on Railway has a 512MB memory limit. Current RSS usage is unmonitored. An OOM kill restarts the process silently.

```typescript
// server/observability/memoryWatcher.ts
import { captureWorkerError } from './sentry';
import { ALERT_THRESHOLDS } from './alertThresholds';

const CHECK_INTERVAL_MS = 60_000;  // Every 60 seconds
let lastAlertAt = 0;
const ALERT_COOLDOWN_MS = 300_000;  // Don't re-alert for 5 minutes

export function startMemoryWatcher(): NodeJS.Timeout {
  return setInterval(() => {
    const mem = process.memoryUsage();
    const rssMB = Math.round(mem.rss / 1024 / 1024);

    if (rssMB > ALERT_THRESHOLDS.memoryRssMB) {
      const now = Date.now();
      if (now - lastAlertAt > ALERT_COOLDOWN_MS) {
        lastAlertAt = now;
        const err = new Error(`Memory threshold exceeded: RSS ${rssMB}MB > ${ALERT_THRESHOLDS.memoryRssMB}MB`);
        captureWorkerError(err, {
          queue: 'system',
          jobType: 'memory-watcher',
          permanent: false,
        });
      }
    }

    // Always emit for Axiom time-series queries
    if (rssMB > 350) {  // Only log when memory is elevated
      console.log(JSON.stringify({
        severity: rssMB > ALERT_THRESHOLDS.memoryRssMB ? 'warn' : 'info',
        module: 'memory-watcher',
        message: `Memory: RSS ${rssMB}MB`,
        ts: new Date().toISOString(),
        meta: {
          rss_mb: rssMB,
          heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
          heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
          external_mb: Math.round(mem.external / 1024 / 1024),
        },
      }));
    }
  }, CHECK_INTERVAL_MS);
}
```

Call `startMemoryWatcher()` in `server/index.ts` after the server starts listening.

---

## 9. Useful Axiom Queries (APL)

Once the Railway log drain is active and `systemLogger.ts` emits JSON:

```apl
// All error-level events in last 1 hour
['apex-production']
| where severity == "error" or severity == "critical"
| where _time > now() - 1h
| project _time, module, message, meta
| sort by _time desc

// Provider failures only
['apex-production']
| where isnotempty(meta.provider)
| summarize count() by meta.provider, bin(_time, 5m)
| sort by _time desc

// Ingestion lag check results
['apex-production']
| where module == "ingestion-lag-check"
| project _time, message, meta.sourcePipeline, meta.lagHours, meta.threshold

// Memory usage over time (chart)
['apex-production']
| where module == "memory-watcher"
| summarize avg(todouble(meta.rss_mb)) by bin(_time, 5m)
| render timechart

// Dead-letter events
['apex-production']
| where message contains "dead_letter"
| project _time, module, message, meta
```

---

## 10. Operational Runbook — Observability Setup

Execute in this order. Total time estimate: 3 hours.

| Step | Action | Time | Owner |
|------|--------|------|-------|
| 1 | Sign up at sentry.io → Create project "apex-production" (Node.js) → Copy DSN | 10 min | dev |
| 2 | Sign up at axiom.co → Create dataset `apex-production` → Create ingest token | 10 min | dev |
| 3 | Railway: add env vars `SENTRY_DSN`, `AXIOM_API_KEY`, `AXIOM_DATASET` | 5 min | dev |
| 4 | Railway: Settings → Integrations → Log Drains → Add Axiom | 10 min | dev |
| 5 | `npm install @sentry/node @sentry/profiling-node` | 2 min | dev |
| 6 | Create `server/observability/sentry.ts` (this document) | 15 min | dev |
| 7 | Create `server/observability/alertThresholds.ts` | 5 min | dev |
| 8 | Create `server/observability/providerHealth.ts` | 20 min | dev |
| 9 | Create `server/observability/memoryWatcher.ts` | 10 min | dev |
| 10 | Patch `server/index.ts` — Sentry init + middleware + process handlers | 15 min | dev |
| 11 | Patch `server/systemLogger.ts` — dual-write console + DB | 15 min | dev |
| 12 | Patch `server/eventRetryProcessor.ts` — `captureWorkerError` on DLQ | 10 min | dev |
| 13 | Add `/internal/health/queues` endpoint | 20 min | dev |
| 14 | Add `/internal/health/providers` endpoint | 20 min | dev |
| 15 | Add ingestion lag cron `server/crons/ingestionLagCheck.ts` | 20 min | dev |
| 16 | Deploy to Railway | 5 min | dev |
| 17 | Verify Sentry: trigger `GET /api/test-error` (if exists) or check for any startup errors → confirm Sentry receives | 10 min | dev |
| 18 | Verify Axiom: check dataset for Railway log drain output (wait 2 min after deploy) | 5 min | dev |
| 19 | Set Sentry alert: email when error rate > 10/minute for 5 minutes | 5 min | dev |
| 20 | Set Sentry alert: email on any `fatal` level event (DLQ transitions) | 5 min | dev |

---

## 11. Post-Deploy Verification Checklist

- [ ] `SENTRY_DSN` present in Railway environment
- [ ] Sentry receives at least one event within 10 minutes of deploy (startup logs or test error)
- [ ] Axiom dataset `apex-production` shows Railway log drain events
- [ ] `GET /internal/health/queues` returns 200 with valid JSON
- [ ] `GET /internal/health/providers` returns neon-db as healthy
- [ ] `server/systemLogger.ts` emitting JSON to console (check Axiom query: `| where module == "system-logger"`)
- [ ] Dead-letter Sentry alert configured and tested (manually move an event to DLQ)
- [ ] Error rate alert configured in Sentry (>10/minute threshold)
- [ ] Memory watcher running (check Axiom after 5 minutes: `| where module == "memory-watcher"`)

---

## 12. Environment Variables Required

| Variable | Source | Required | Notes |
|----------|--------|----------|-------|
| `SENTRY_DSN` | sentry.io project settings | Yes (for error tracking) | Silently disabled if absent |
| `AXIOM_API_KEY` | axiom.co API tokens | Yes (for log drain) | Used in Railway log drain config |
| `AXIOM_DATASET` | axiom.co dataset name | Yes (for log drain) | Recommend `apex-production` |
| `RAILWAY_GIT_COMMIT_SHA` | Railway built-in | Auto-injected | Links Sentry errors to commits |
| `NODE_ENV` | Railway built-in | Auto-injected | Sets Sentry environment tag |
| `INTERNAL_API_SECRET` | Railway custom | Already present (Stage 2) | Guards `/internal/health/*` endpoints |
