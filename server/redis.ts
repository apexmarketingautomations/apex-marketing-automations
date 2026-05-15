/**
 * server/redis.ts
 * ---------------
 * Upstash Redis connection singleton for Apex Marketing OS.
 *
 * Design principles:
 *  - Fail-open: if UPSTASH_REDIS_URL is not set, Redis is null and callers
 *    gracefully degrade (in-memory fallback).
 *  - Single connection for cache/general use (redisClient).
 *  - Separate connection factory for BullMQ workers (BullMQ requires its own
 *    dedicated ioredis connections with maxRetriesPerRequest: null).
 *  - All connections use TLS (Upstash rediss:// protocol).
 */

import Redis from "ioredis";

// ─── Singleton for general use (cache, rate limiting, dedup keys) ───────────

let redisClient: Redis | null = null;
let _redisAvailable = false;

export function getRedis(): Redis | null {
  return redisClient;
}

export function isRedisAvailable(): boolean {
  return _redisAvailable;
}

/**
 * Creates a NEW dedicated ioredis connection — required by BullMQ.
 * BullMQ must never share an ioredis connection with other code.
 * Call this in queueFactory.ts and worker constructors.
 */
export function createRedisConnection(): Redis {
  const url = process.env.UPSTASH_REDIS_URL;
  if (!url) {
    throw new Error(
      "[REDIS] UPSTASH_REDIS_URL is not set. Cannot create BullMQ connection."
    );
  }

  return new Redis(url, {
    maxRetriesPerRequest: null, // Required for BullMQ blocking commands
    enableReadyCheck: false,    // Upstash: skip ready check
    lazyConnect: false,
    tls: {},                    // Upstash rediss:// requires TLS
    retryStrategy: (times: number) => {
      if (times > 10) {
        console.error("[REDIS] Max reconnection attempts reached");
        return null; // Stop retrying
      }
      return Math.min(times * 500, 5000); // Exponential up to 5s
    },
  });
}

/**
 * Initialise the general-use Redis singleton.
 * Called once at server startup in server/index.ts.
 *
 * Returns true if connected, false if degraded (no URL or connection failed).
 * Never throws — allows the app to start without Redis.
 */
export async function initRedis(): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_URL;

  if (!url) {
    console.warn(
      "[REDIS] UPSTASH_REDIS_URL not set — Redis features disabled, falling back to in-memory"
    );
    return false;
  }

  try {
    const client = new Redis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      tls: {},
      retryStrategy: (times: number) => {
        if (times > 5) return null;
        return Math.min(times * 500, 3000);
      },
    });

    // Test connection
    await client.ping();

    client.on("error", (err) => {
      console.error("[REDIS] Connection error:", err.message);
      _redisAvailable = false;
    });

    client.on("connect", () => {
      console.log("[REDIS] Reconnected to Upstash Redis");
      _redisAvailable = true;
    });

    client.on("close", () => {
      _redisAvailable = false;
    });

    redisClient = client;
    _redisAvailable = true;
    console.log("[REDIS] ✅ Connected to Upstash Redis");
    return true;
  } catch (err: any) {
    console.error("[REDIS] ❌ Connection failed:", err.message);
    console.warn("[REDIS] Falling back to in-memory mode (queues will not survive restarts)");
    _redisAvailable = false;
    return false;
  }
}

// ─── Distributed lock ────────────────────────────────────────────────────────

/**
 * Acquire a distributed lock.
 * Returns true if lock acquired, false if already held.
 * Lock auto-expires after ttlMs milliseconds.
 */
export async function acquireLock(
  key: string,
  ttlMs: number = 30_000
): Promise<boolean> {
  if (!redisClient) return true; // Fail-open: always "acquired" if no Redis

  const lockKey = `apex:lock:${key}`;
  const result = await redisClient.set(lockKey, "1", "PX", ttlMs, "NX");
  return result === "OK";
}

/**
 * Release a distributed lock.
 */
export async function releaseLock(key: string): Promise<void> {
  if (!redisClient) return;
  await redisClient.del(`apex:lock:${key}`);
}

// ─── Simple cache helpers ─────────────────────────────────────────────────────

export async function cacheGet(key: string): Promise<string | null> {
  if (!redisClient) return null;
  return redisClient.get(key);
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds: number = 300
): Promise<void> {
  if (!redisClient) return;
  await redisClient.set(key, value, "EX", ttlSeconds);
}

export async function cacheDel(key: string): Promise<void> {
  if (!redisClient) return;
  await redisClient.del(key);
}

// ─── Daily counter helpers (for OCR/embedding budget enforcement) ─────────────

export async function incrementDailyCounter(
  namespace: string,
  amount: number = 1
): Promise<number> {
  if (!redisClient) return 0;

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `apex:${namespace}:${date}`;

  const pipeline = redisClient.pipeline();
  pipeline.incrby(key, amount);
  pipeline.expire(key, 172_800); // 48h TTL — covers day boundaries

  const results = await pipeline.exec();
  return (results?.[0]?.[1] as number) ?? 0;
}

export async function getDailyCounter(namespace: string): Promise<number> {
  if (!redisClient) return 0;

  const date = new Date().toISOString().slice(0, 10);
  const key = `apex:${namespace}:${date}`;
  const val = await redisClient.get(key);
  return parseInt(val ?? "0", 10);
}
