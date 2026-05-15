# Stage 4A — Redis Infrastructure Plan

**Status:** PLANNING  
**Authored:** 2026-05-15  
**Companion document:** `STAGE_4A_DURABLE_OPERATIONS.md`  
**Purpose:** Complete Redis infrastructure specification for Apex's durable operations layer

---

## 1. Provider Selection: Upstash Redis

### Decision Summary

**Selected: Upstash Redis** — serverless Redis with a persistent TCP endpoint, fully compatible with ioredis and BullMQ. The free tier (10,000 commands/day) covers Apex's current volume with headroom. It survives Railway restarts because it is hosted externally.

### Full Provider Comparison

| Factor | Upstash Redis | Railway Redis | Self-hosted (Docker) |
|--------|:------------:|:-------------:|:--------------------:|
| Persists across Railway restart | ✅ Yes — external host | ⚠️ Depends on volume mount config | ✅ Yes — if volume mounted |
| Cost at current volume | **$0/month** (free tier) | $5–10/month (always-on) | Ops burden + Railway volume cost |
| ioredis TCP compatible | ✅ `rediss://` endpoint | ✅ Native | ✅ |
| BullMQ compatible | ✅ Via TCP + `maxRetriesPerRequest: null` | ✅ | ✅ |
| Setup complexity | Low — 5 minutes | Medium — Railway plugin | High — Dockerfile, volume, networking |
| Managed TLS | ✅ Built-in | ✅ | ❌ Manual cert management |
| Multi-region replication | ✅ Global replication available | ❌ Single Railway region | ❌ Single node |
| REST fallback (non-TCP env) | ✅ `@upstash/redis` HTTP client | ❌ | ❌ |
| SLA | 99.9% | Railway platform SLA | N/A |
| Free tier commands | 10,000/day | N/A | N/A |
| Pricing beyond free | $0.20/100k commands | $5–10/month flat | Compute + storage |
| Connection pool complexity | None — stateless TCP | Standard | Standard |
| Data persistence (AOF/RDB) | ✅ Enabled by default | ⚠️ Requires explicit config | ⚠️ Requires explicit config |
| Vendor lock-in | Low — ioredis/BullMQ are generic | None | None |

### Why Not Railway Redis?

Railway Redis is an always-on add-on service. It costs $5–10/month regardless of usage and depends on Railway's own infrastructure. If Railway has a region-wide incident, both the app and Redis go down simultaneously. Upstash's external hosting means Redis can survive Railway restarts and is isolated from Railway failure domains.

### Why Not Inngest?

Inngest is a managed step-function platform that abstracts queuing entirely. It is the right choice for Phase 5 (complex multi-step workflows). For Phase 4A the requirements are simpler: reliable job persistence, retry, and DLQ. BullMQ over Upstash Redis satisfies these with:

- No managed service dependency beyond Redis itself
- Native BullMQ semantics: priorities, delays, rate limiting, repeatable jobs, DLQ
- Full operational control — no Inngest dashboard required for debugging
- Zero vendor lock-in on workflow logic

Inngest will be re-evaluated when Apex needs step-function workflows with durable execution across retries (e.g., multi-day contact nurture sequences).

---

## 2. Connection Architecture

### Canonical Redis Module

A single module owns the Redis connection. Every other module imports from here. No other file creates a `new Redis()` instance.

```typescript
// server/redis.ts
import { Redis } from "ioredis";

const UPSTASH_URL = process.env.UPSTASH_REDIS_URL;

if (!UPSTASH_URL && process.env.NODE_ENV === "production") {
  // This is a startup warning, not a fatal error.
  // The system falls back to in-memory for all queue operations.
  console.error(
    "[REDIS] UPSTASH_REDIS_URL not set — durable queue DISABLED. " +
    "Set DURABLE_QUEUE_ENABLED=false to suppress this warning."
  );
}

/**
 * Primary Redis connection for BullMQ and distributed locks.
 * null when UPSTASH_REDIS_URL is not configured.
 *
 * BullMQ requirements:
 *   - maxRetriesPerRequest: null   (mandatory — BullMQ blocks internally)
 *   - enableReadyCheck: false      (Upstash doesn't support CLIENT INFO)
 */
export const redis = UPSTASH_URL
  ? new Redis(UPSTASH_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      tls: { rejectUnauthorized: false },
      lazyConnect: true,
      retryStrategy: (times: number) => {
        if (times > 10) return null; // stop retrying after 10 attempts
        return Math.min(times * 200, 2000); // exponential backoff, max 2s
      },
    })
  : null;

/**
 * Separate connection for pub/sub subscriptions.
 * ioredis requires a dedicated connection for SUBSCRIBE commands
 * (a subscribed connection cannot issue regular commands).
 */
export const redisSub = UPSTASH_URL
  ? new Redis(UPSTASH_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      tls: { rejectUnauthorized: false },
      lazyConnect: true,
    })
  : null;

/** Returns true only when the connection is in ready state */
export const isRedisAvailable = (): boolean =>
  redis !== null && redis.status === "ready";

/** Health check — resolves to true if PONG received within 2 seconds */
export async function pingRedis(): Promise<boolean> {
  if (!redis) return false;
  try {
    const result = await Promise.race([
      redis.ping(),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
    ]);
    return result === "PONG";
  } catch {
    return false;
  }
}

// Connection lifecycle logging — surfaces to systemLogger after logger is initialized
if (redis) {
  redis.on("connect", () =>
    console.log("[REDIS] Connection established")
  );
  redis.on("ready", () =>
    console.log("[REDIS] Ready — commands unblocked")
  );
  redis.on("error", (err: Error) =>
    console.error(`[REDIS] Connection error: ${err.message}`)
  );
  redis.on("close", () =>
    console.warn("[REDIS] Connection closed — attempting reconnect")
  );
  redis.on("reconnecting", () =>
    console.log("[REDIS] Reconnecting...")
  );
}
```

### Connection Lifecycle

```
Railway process starts
    │
    ├─ UPSTASH_REDIS_URL present?
    │       │
    │       ├─ YES → new Redis(url, { lazyConnect: true })
    │       │         │
    │       │         ├─ First queue operation → TCP handshake → TLS → AUTH
    │       │         ├─ redis.status = "connecting" → "ready"
    │       │         └─ BullMQ workers activate
    │       │
    │       └─ NO  → redis = null
    │                 DURABLE_QUEUE_ENABLED bypass
    │                 InMemoryJobQueue activated
    │
    ├─ Express listens on PORT
    └─ Health endpoint: GET /api/admin/health → { redis: { connected, latencyMs } }
```

### Module Import Graph

```
server/index.ts
    └── server/redis.ts                  ← Single Redis connection owner
         ├── server/queues/queueManager.ts
         │       └── server/jobQueue.ts   ← BullMQ facade (Queue instances)
         ├── server/workers/*.ts          ← Worker instances
         ├── server/redisLock.ts          ← Distributed locks
         └── server/redisRateLimit.ts     ← Rate limit store
```

No circular imports. `server/redis.ts` imports nothing from the Apex codebase.

---

## 3. Key Namespace Design

All Apex Redis keys use the `apex:` prefix. This prevents collisions if the same Upstash database is ever shared across environments or projects.

### Full Namespace Map

```
apex:queue:{priority}                   BullMQ queue metadata
    apex:queue:high                       → incident alerts, sentinel events
    apex:queue:medium                     → contact enrichment, court filings
    apex:queue:low                        → skip trace retries, outbound email
    apex:queue:background                 → embeddings, OCR, analytics rollups

apex:queue:{priority}:events            BullMQ QueueEvents channel (pub/sub)
apex:queue:{priority}:{jobId}           Individual job data (managed by BullMQ)

apex:lock:{resource}:{id}               Distributed lock tokens
    apex:lock:skiptrace:{contactId}       → Prevents duplicate skip trace runs
    apex:lock:embedding:{entityType}:{id} → Prevents concurrent embedding jobs
    apex:lock:ocr:{documentId}            → Prevents concurrent OCR processing
    apex:lock:ingest:{source}:{externalId}→ Dedup for ingestion pipelines

apex:ratelimit:{limiterName}:{key}      Rate limit sliding windows
    apex:ratelimit:api:{ip}
    apex:ratelimit:auth:{ip}
    apex:ratelimit:webhook:{accountId}
    apex:ratelimit:messaging:{subAccountId}
    apex:ratelimit:upload:{userId}
    apex:ratelimit:credittopup:{userId}

apex:cache:{type}:{id}                  Short-lived read-through cache
    apex:cache:contact:{contactId}        TTL: 5 minutes
    apex:cache:territory:{zipCode}        TTL: 30 minutes
    apex:cache:vendorconfig:{accountId}   TTL: 60 minutes
    apex:cache:featureflag:{flag}:{acct}  TTL: 2 minutes
    apex:cache:courtjurisdiction:{fips}   TTL: 24 hours

apex:dedup:{jobType}:{hash}             Idempotency dedup (supplements event_logs table)
    TTL: 24 hours
    Hash: SHA256(JSON.stringify(payload))

apex:session:{sessionId}                Future: Express session data (if migrated from Neon)
    TTL: 7 days (matches SESSION_TTL in replitAuth.ts)
    Note: Phase 4A uses connect-pg-simple. This key prefix reserved for Phase 5.

apex:health:{service}                   Heartbeat timestamps for services
    apex:health:embeddingWorker           TTL: 120 seconds
    apex:health:ocrWorker                 TTL: 120 seconds
    apex:health:retryProcessor            TTL: 120 seconds
    apex:health:crashWorker               TTL: 120 seconds
```

### Key Design Principles

1. **Namespace first:** all keys start with `apex:` — safe for shared databases
2. **Resource type second:** `queue`, `lock`, `cache`, `ratelimit` — readable in Upstash UI
3. **Specific ID last:** most specific part at the end — prefix scans work efficiently
4. **No user PII in keys:** never embed email, SSN, or full name in a Redis key
5. **TTL on everything except queue data:** BullMQ manages queue TTL internally; all other keys get explicit expiration

---

## 4. Distributed Locks

Apex needs distributed locks to prevent duplicate processing across concurrent workers or future instances. The pattern used is a lightweight Redlock implementation over a single Redis node (sufficient for single-instance Railway deployment; extend to Redlock multi-node if Railway adds replicas).

```typescript
// server/redisLock.ts
import crypto from "crypto";
import { redis } from "./redis";

// Lua script for atomic compare-and-delete (safe release)
const RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

/**
 * Attempt to acquire a distributed lock.
 *
 * @param resource - Logical resource identifier (e.g., "skiptrace:contact:123")
 * @param ttlMs    - Lock expiry in milliseconds. Must be longer than the expected
 *                   operation duration. Default: 30 seconds.
 * @returns A lock token string if acquired, null if already locked.
 *
 * Usage:
 *   const token = await acquireLock("skiptrace:contact:456", 15_000);
 *   if (!token) { return; } // another worker holds the lock
 *   try { await doWork(); } finally { await releaseLock("skiptrace:contact:456", token); }
 */
export async function acquireLock(
  resource: string,
  ttlMs: number = 30_000
): Promise<string | null> {
  if (!redis) return crypto.randomUUID(); // no-op token in memory mode

  const token = crypto.randomUUID();
  const key = `apex:lock:${resource}`;

  // NX = only set if not exists; PX = expiry in milliseconds
  const result = await redis.set(key, token, "PX", ttlMs, "NX");
  return result === "OK" ? token : null;
}

/**
 * Release a lock. Only succeeds if the caller holds the token.
 * Safe to call even if lock has already expired (returns 0).
 */
export async function releaseLock(resource: string, token: string): Promise<boolean> {
  if (!redis) return true; // no-op in memory mode

  const key = `apex:lock:${resource}`;
  const result = await redis.eval(RELEASE_SCRIPT, 1, key, token) as number;
  return result === 1;
}

/**
 * Extend a lock's TTL while holding it. Useful for long-running operations.
 * Only extends if the caller holds the token (atomic check-and-extend).
 */
export async function extendLock(
  resource: string,
  token: string,
  extensionMs: number = 30_000
): Promise<boolean> {
  if (!redis) return true;

  const key = `apex:lock:${resource}`;
  const EXTEND_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("pexpire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;
  const result = await redis.eval(EXTEND_SCRIPT, 1, key, token, String(extensionMs)) as number;
  return result === 1;
}

/**
 * Higher-order function: run work with a lock. Auto-releases on completion or error.
 *
 * @example
 * await withLock("skiptrace:contact:789", 20_000, async () => {
 *   await runSkipTrace(contactId);
 * });
 */
export async function withLock<T>(
  resource: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T | null> {
  const token = await acquireLock(resource, ttlMs);
  if (!token) {
    console.log(`[LOCK] Could not acquire lock for "${resource}" — skipping (another worker holds it)`);
    return null;
  }

  try {
    return await fn();
  } finally {
    await releaseLock(resource, token);
  }
}
```

### Lock Use Cases in Apex

| Lock Resource Pattern | Protects | TTL |
|----------------------|----------|-----|
| `skiptrace:contact:{contactId}` | Prevents duplicate skip trace API calls for the same contact | 15 seconds |
| `embedding:{entityType}:{entityId}` | Prevents concurrent embedding generation for the same entity | 30 seconds |
| `ocr:{documentId}` | Prevents OCR re-processing of the same R2 document | 60 seconds |
| `ingest:{source}:{externalId}` | Supplements `event_logs` idempotency for burst scenarios | 10 seconds |
| `credittopup:{userId}` | Prevents double-charge on concurrent top-up requests | 10 seconds |

---

## 5. Rate Limiting with Redis

### Current State

`server/rateLimiter.ts` defines 6 rate limiters (`apiLimiter`, `authLimiter`, `webhookLimiter`, `messagingLimiter`, `creditTopupLimiter`, `uploadLimiter`). All 6 use `express-rate-limit` with no `store` option — they default to an in-memory map that resets on every Railway restart.

### Migration

```typescript
// server/rateLimiter.ts — Redis-backed replacement
import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { redis, isRedisAvailable } from "./redis";

/**
 * Build a Redis-backed store for express-rate-limit.
 * Falls back to default in-memory store if Redis is unavailable.
 */
function makeStore(prefix: string): ConstructorParameters<typeof rateLimit>[0]["store"] | undefined {
  if (!redis || !isRedisAvailable()) {
    console.warn(`[RATE-LIMIT] Redis unavailable — ${prefix} using in-memory store (resets on restart)`);
    return undefined; // express-rate-limit default
  }
  return new RedisStore({
    sendCommand: (...args: string[]) => redis.call(...args) as any,
    prefix: `apex:ratelimit:${prefix}:`,
  });
}

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("api"),
  message: { error: "Too many requests. Please try again in a minute." },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("auth"),
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
});

export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("webhook"),
  message: { error: "Webhook rate limit exceeded." },
});

export const messagingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("messaging"),
  message: { error: "Message sending rate limit exceeded. Please slow down." },
});

export const creditTopupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("credittopup"),
  message: { error: "Too many top-up requests. Please try again later." },
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("upload"),
  message: { error: "Too many upload requests. Please slow down." },
});
```

**No changes to call sites.** All six exports have the same names and middleware signatures. The only change is the addition of `store` — invisible to callers.

### How Redis-Backed Rate Limiting Works

```
Request arrives at POST /api/contacts
    │
    ▼
apiLimiter middleware
    │
    ├─ Redis key: apex:ratelimit:api:{clientIp}
    │   └─ INCR → count
    │   └─ EXPIRE → windowMs (60s)
    │
    ├─ count > 100?
    │       ├─ YES → 429 response
    │       └─ NO  → next()
    │
    └─ Redis unavailable?
            └─ In-memory fallback (resets on restart, degraded behavior)
```

**Key insight:** After a Railway redeploy, the Redis key still exists with the correct count. A bad actor who sent 95 requests before the redeploy will be limited after only 5 more — consistent behavior.

---

## 6. Cache Patterns

Caching in Redis reduces Neon read pressure for frequently-accessed, slowly-changing data.

### Cache Module

```typescript
// server/redisCache.ts
import { redis } from "./redis";
import crypto from "crypto";

/**
 * Generic read-through cache.
 * If the key exists in Redis, returns the cached value.
 * Otherwise calls `fetcher`, stores the result, and returns it.
 *
 * @param key     - Cache key (will be prefixed with apex:cache:)
 * @param ttlSec  - TTL in seconds
 * @param fetcher - Async function to fetch the canonical value
 */
export async function cacheGet<T>(
  key: string,
  ttlSec: number,
  fetcher: () => Promise<T>
): Promise<T> {
  if (!redis) return fetcher(); // no-op if Redis unavailable

  const cacheKey = `apex:cache:${key}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached) as T;
    }
  } catch {
    // Cache miss on parse error — fall through to fetcher
  }

  const value = await fetcher();

  try {
    await redis.set(cacheKey, JSON.stringify(value), "EX", ttlSec);
  } catch {
    // Cache write failure is non-fatal
  }

  return value;
}

/** Invalidate a specific cache entry */
export async function cacheInvalidate(key: string): Promise<void> {
  if (!redis) return;
  await redis.del(`apex:cache:${key}`).catch(() => undefined);
}

/** Invalidate all cache entries with a given prefix */
export async function cacheInvalidatePrefix(prefix: string): Promise<void> {
  if (!redis) return;
  const keys = await redis.keys(`apex:cache:${prefix}*`);
  if (keys.length > 0) {
    await redis.del(...keys).catch(() => undefined);
  }
}
```

### Cache Usage by Domain

| Cache Key | TTL | Fetcher Source | Invalidate On |
|-----------|-----|---------------|---------------|
| `contact:{contactId}` | 5 min | `storage.getContact()` | Contact update/delete |
| `territory:{zipCode}` | 30 min | `storage.getTerritoryByZip()` | Territory config change |
| `vendorconfig:{accountId}` | 60 min | `storage.getVendorConfig()` | Vendor config save |
| `featureflag:{flag}:{accountId}` | 2 min | Feature flag table | Flag toggle |
| `courtjurisdiction:{fips}` | 24 hrs | External FIPS API | Never (stable) |
| `crashreport:{incidentId}` | 10 min | `storage.getCrashReport()` | Incident update |

### Cache Usage Example

```typescript
// Before (direct DB call on every request):
const contact = await storage.getContact(contactId);

// After (Redis cache with 5-minute TTL):
import { cacheGet, cacheInvalidate } from "../redisCache";

const contact = await cacheGet(
  `contact:${contactId}`,
  300, // 5 minutes
  () => storage.getContact(contactId)
);

// On contact update, invalidate:
await cacheInvalidate(`contact:${contactId}`);
```

---

## 7. Connection Health Monitoring

### Health Check Endpoint

```typescript
// server/routes/admin.ts — add to existing admin router
import { pingRedis, isRedisAvailable } from "../redis";
import { allQueues } from "../queues/queueManager";

router.get("/health", async (req, res) => {
  const redisConnected = await pingRedis();
  const start = Date.now();
  await pingRedis(); // second ping for latency measurement
  const redisLatencyMs = Date.now() - start;

  const queueCounts = await Promise.all(
    allQueues().map(async (q) => ({
      name: q.name,
      counts: await q.getJobCounts("waiting", "active", "delayed", "failed"),
    }))
  );

  res.json({
    status: redisConnected ? "ok" : "degraded",
    redis: {
      connected: redisConnected,
      latencyMs: redisLatencyMs,
      mode: isRedisAvailable() ? "upstash" : "unavailable",
    },
    queues: queueCounts,
    queueBackend: process.env.DURABLE_QUEUE_ENABLED === "true" ? "bullmq" : "memory",
    timestamp: new Date().toISOString(),
  });
});
```

### Worker Heartbeat Pattern

Each worker writes a heartbeat to Redis every 30 seconds. If the heartbeat key expires (TTL: 120s), the worker has silently died.

```typescript
// server/workers/workerBase.ts
import { redis } from "../redis";

export function startWorkerHeartbeat(workerName: string): NodeJS.Timeout {
  const key = `apex:health:${workerName}`;
  const ttlSec = 120; // 2× the interval — gives one missed heartbeat before alert

  const tick = async () => {
    try {
      if (redis) await redis.set(key, Date.now().toString(), "EX", ttlSec);
    } catch {
      // Heartbeat failure is non-fatal
    }
  };

  tick(); // immediate first heartbeat
  return setInterval(tick, 30_000);
}

export async function checkWorkerAlive(workerName: string): Promise<boolean> {
  if (!redis) return true; // assume alive if no Redis
  const val = await redis.get(`apex:health:${workerName}`).catch(() => null);
  if (!val) return false;
  const lastBeat = parseInt(val);
  return Date.now() - lastBeat < 120_000;
}
```

### Event-Based Connection Logging

```typescript
// Called once in server/index.ts after Redis module is imported
import { redis, redisSub } from "./redis";
import { logSystemEvent } from "./systemLogger";

// Upgrade console.log to logSystemEvent after systemLogger is ready
if (redis) {
  redis.on("connect", () =>
    logSystemEvent("info", "REDIS", "TCP connection established to Upstash")
  );
  redis.on("ready", () =>
    logSystemEvent("info", "REDIS", "Ready — all queued commands released")
  );
  redis.on("error", (err: Error) =>
    logSystemEvent("error", "REDIS", `Connection error: ${err.message}`, { stack: err.stack })
  );
  redis.on("close", () =>
    logSystemEvent("warn", "REDIS", "Connection closed — ioredis will reconnect automatically")
  );
  redis.on("reconnecting", () =>
    logSystemEvent("warn", "REDIS", "Reconnecting to Upstash Redis")
  );
}
```

---

## 8. Upstash Provisioning Steps

Step-by-step setup. Estimated time: 10 minutes.

### Step 1 — Create Upstash Account

Go to [upstash.com](https://upstash.com) and sign up with your Google or GitHub account. No credit card required for the free tier.

### Step 2 — Create Redis Database

In the Upstash console:
1. Click **Create Database**
2. Name: `apex-production`
3. Type: **Regional** (not Global — simpler, free tier covers it)
4. Region: **US East 1** (matches Railway's US East region for lowest latency)
5. Enable **TLS** (required for `rediss://` connection string)
6. Click **Create**

### Step 3 — Copy Connection Details

From the database detail page, copy:
- **Redis URL** (TCP format): `rediss://default:{password}@{host}:{port}`
- **REST URL**: `https://{host}.upstash.io` (backup if TCP is blocked)
- **REST Token**: the `Bearer` token for HTTP requests

The TCP URL is what ioredis and BullMQ use. The REST URL is the fallback.

### Step 4 — Add to Railway Environment Variables

In Railway dashboard → your service → Variables:

```
UPSTASH_REDIS_URL = rediss://default:{password}@{host}:{port}
UPSTASH_REDIS_TOKEN = {rest-token}
DURABLE_QUEUE_ENABLED = true
WORKER_CONCURRENCY_HIGH = 3
WORKER_CONCURRENCY_MEDIUM = 5
WORKER_CONCURRENCY_LOW = 10
WORKER_CONCURRENCY_BACKGROUND = 2
```

Railway will restart the service after saving environment variable changes.

### Step 5 — Install Dependencies

```bash
npm install ioredis bullmq rate-limit-redis
npm install @sentry/node @axiomhq/js
```

Update `package.json` and commit before deploying.

### Step 6 — Test the Connection

After Railway restarts with the new env var:

```bash
# In Railway's shell or via curl to your health endpoint:
curl https://your-app.railway.app/api/admin/health | jq .redis
# Expected: { "connected": true, "latencyMs": 12 }
```

Or run locally against Upstash:

```bash
UPSTASH_REDIS_URL=rediss://... npx ts-node -e "
  import('./server/redis').then(async m => {
    const ok = await m.pingRedis();
    console.log('PING result:', ok ? 'PONG ✓' : 'FAILED ✗');
    process.exit(ok ? 0 : 1);
  });
"
```

### Step 7 — Verify BullMQ Round-Trip

```typescript
// Quick smoke test — run once after provisioning
import { Queue, Worker } from "bullmq";
import { redis } from "./server/redis";

async function smokeTest() {
  const queue = new Queue("apex:test", { connection: redis! });
  const start = Date.now();

  await queue.add("smoke", { test: true });
  const [job] = await queue.getJobs(["waiting"]);
  const latency = Date.now() - start;

  console.log(`BullMQ round-trip: ${latency}ms (target: <50ms)`);
  console.log("Job ID:", job?.id);

  await queue.obliterate({ force: true }); // cleanup
  process.exit(0);
}

smokeTest().catch(console.error);
```

---

## 9. Cost Projection

### Upstash Free Tier Limits

```
Commands per day:     10,000
Max data size:        256 MB
Max connections:      100 concurrent
Max database size:    Unlimited (pay-as-you-go after free tier commands)
Bandwidth:            200 MB/day
```

### Current Apex Command Estimate (Per Day)

| Operation | Commands/op | Daily ops | Daily commands |
|-----------|-------------|-----------|----------------|
| BullMQ enqueue | ~6 | 200 jobs | 1,200 |
| BullMQ dequeue + complete | ~8 | 200 jobs | 1,600 |
| Distributed lock acquire/release | ~2 | 300 ops | 600 |
| Rate limit increment | ~2 | 500 requests | 1,000 |
| Cache get (hit) | 1 | 800 ops | 800 |
| Cache get (miss) + set | 2 | 200 ops | 400 |
| Worker heartbeats | 1 | 480 (4 workers × every 30s × 1440min/day) | 480 |
| Redis pub/sub messages | 1 | 100 | 100 |
| Health check pings | 1 | 288 (every 5min) | 288 |
| **Total estimated** | | | **~6,468 / day** |

**6,468 commands/day is 64.7% of the free tier.** There is comfortable headroom for growth.

### Scale Trigger Analysis

| Traffic Multiple | Estimated Commands/Day | Monthly Cost |
|-----------------|----------------------|-------------|
| 1× (current) | ~6,500 | $0 (free tier) |
| 1.5× | ~9,750 | $0 (still within free) |
| 2× | ~13,000 | ~$0.60/month |
| 5× | ~32,500 | ~$4.50/month |
| 10× | ~65,000 | ~$11/month |
| 50× | ~325,000 | ~$63/month |

Pricing formula after free tier: $0.20 per 100,000 commands.

**Scale trigger for paid tier:** crossing 10,000 commands/day. At current growth, this occurs when:
- Daily active sub-accounts exceed ~40 (from current ~15)
- Or embedding batch jobs scale significantly

At that point, $0.20/100k is effectively infrastructure-for-pennies. Even at 50× volume, $63/month is cheaper than Railway Redis ($5–10/month flat, not including compute).

### Cost vs. Railway Redis

| Scenario | Upstash | Railway Redis |
|----------|---------|---------------|
| Current volume | $0/month | $5–10/month |
| 5× volume | ~$4.50/month | $5–10/month |
| 50× volume | ~$63/month | $30–50/month |
| Startup phase (0–12 months) | **~$0–5/month** | $60–120/year |

Upstash wins at current and near-term scale. Railway Redis becomes cost-competitive only at very high volumes (>1M commands/day) where the flat-rate pricing of an always-on instance beats per-command pricing.

---

## 10. Security Considerations

### Connection Security

- All connections use `rediss://` (TLS) — data in transit is encrypted
- The Upstash password is in `UPSTASH_REDIS_URL` env var — never hardcoded
- `rejectUnauthorized: false` is required for Upstash's self-signed TLS cert — acceptable for this provider
- The REST token (`UPSTASH_REDIS_TOKEN`) is separate from the TCP password — use it only for the REST fallback

### Key Expiration Policy

All non-queue keys have TTLs. BullMQ manages queue key expiration. This prevents unbounded memory growth on the Upstash free tier (256 MB limit).

```typescript
// Enforce TTL on all cache writes — never write without expiry
await redis.set(key, value, "EX", ttlSec); // Always include EX
// Never: await redis.set(key, value);      // Keys without TTL accumulate forever
```

### No PII in Keys

Redis keys are logged by Upstash's monitoring dashboard. Never embed:
- Email addresses
- SSNs
- Full names
- Phone numbers

Use entity IDs (integer primary keys) as key components. If you need to look up a user by email, use the DB to get the ID first, then use the ID in the Redis key.

### Access Pattern

```
Railway process → UPSTASH_REDIS_URL (TCP + TLS) → Upstash Regional (US East 1)
    Latency: ~5–15ms (same AWS region)
    Auth: password in URL (Upstash AUTH command)
    Encryption: TLS 1.2+
```

The Upstash database is not exposed to the public internet without authentication. The password in `UPSTASH_REDIS_URL` is required for every connection. Railway environment variables are encrypted at rest.

---

## 11. BullMQ Configuration Reference

### Queue Options

```typescript
// Default options applied to all queues
const QUEUE_DEFAULTS = {
  defaultJobOptions: {
    // Auto-remove completed jobs (keep last 500)
    removeOnComplete: { count: 500 },
    // Auto-remove failed jobs after DLQ write (keep last 200 for Redis inspection)
    removeOnFail: { count: 200 },
    // Default attempts for all jobs (overridable per-job)
    attempts: 3,
    // Exponential backoff: 5s, 10s, 20s
    backoff: {
      type: "exponential" as const,
      delay: 5_000,
    },
  },
};
```

### Queue-Specific Overrides

```typescript
// High priority: no backoff — retry immediately
const highPriorityOptions = {
  attempts: 5,
  backoff: { type: "fixed" as const, delay: 1_000 },
};

// Background: aggressive backoff for rate-limited APIs (embeddings, skip trace)
const backgroundOptions = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 10_000 },
};

// Notifications: give up fast — stale notifications have no value
const notificationOptions = {
  attempts: 2,
  backoff: { type: "fixed" as const, delay: 5_000 },
  removeOnFail: true,
};
```

### Repeatable Jobs (Replacing `setInterval`)

BullMQ repeatable jobs replace the 30+ scattered `setInterval` calls across the codebase. They persist in Redis — if Railway restarts, the schedule resumes automatically.

```typescript
// server/queues/scheduler.ts — centralized scheduler
import { Queue } from "bullmq";
import { getQueue } from "./queueManager";

export async function initScheduler(): Promise<void> {
  const bgQueue = getQueue("background");
  if (!bgQueue) {
    console.warn("[SCHEDULER] Redis unavailable — using setInterval fallback");
    return; // existing setInterval code continues to work
  }

  // Queue health snapshot — every 60 seconds
  await bgQueue.add(
    "snapshot_queue_health",
    {},
    { repeat: { every: 60_000 }, jobId: "snapshot_queue_health" }
  );

  // Retry processor — replaces startRetryProcessor() setInterval
  await bgQueue.add(
    "process_failed_events",
    {},
    { repeat: { every: 3_600_000 }, jobId: "process_failed_events" }
  );

  // Analytics rollup — daily at 2am UTC
  await bgQueue.add(
    "daily_analytics_rollup",
    {},
    {
      repeat: { pattern: "0 2 * * *", tz: "UTC" },
      jobId: "daily_analytics_rollup",
    }
  );

  // Embedding maintenance — every 15 minutes
  await bgQueue.add(
    "embedding_maintenance",
    {},
    { repeat: { every: 15 * 60_000 }, jobId: "embedding_maintenance" }
  );

  console.log("[SCHEDULER] Repeatable jobs registered in BullMQ");
}
```

---

## 12. Phase 4B Readiness Checklist

Phase 4B (OCR pipeline) requires all of the following to be complete:

- [ ] `UPSTASH_REDIS_URL` set in Railway and connection verified (`pingRedis()` = true)
- [ ] `DURABLE_QUEUE_ENABLED=true` confirmed in Railway env
- [ ] BullMQ facade (`server/jobQueue.ts`) deployed and tested
- [ ] `server/workers/ocrWorker.ts` stub created (handler registered, no-op body)
- [ ] `dead_letter_jobs` table created in Neon
- [ ] `queue_health_snapshots` table created in Neon
- [ ] `GET /api/admin/health` returns `{ redis: { connected: true } }`
- [ ] `GET /api/admin/queue-health` returns job counts for all 4 queues
- [ ] DLQ processor running (failed jobs appear in `dead_letter_jobs` within 60s)
- [ ] All 8 validation gates passed
- [ ] Sentry DSN set and test error confirmed in dashboard
- [ ] Axiom drain verified (log event appears in Axiom dataset within 30s)

---

*This document covers the Redis infrastructure layer. For the full migration execution order, rollback protocol, and DB schema additions, see `STAGE_4A_DURABLE_OPERATIONS.md`.*
