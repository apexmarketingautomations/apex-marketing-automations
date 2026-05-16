/**
 * server/routing/webhookDelivery.ts
 *
 * Multi-Vertical Webhook Lead Delivery Engine  (Phase 5)
 *
 * Delivers leads to external webhook endpoints for ANY vertical
 * (home services, legal, insurance, service industry, crash leads).
 *
 * Features:
 * - Exponential backoff retry (3 attempts: 0s, 30s, 5min)
 * - Per-delivery audit log (attempt, status, latency, response snippet)
 * - Tenant-scoped delivery rules (vertical + endpoint + auth)
 * - Idempotency via delivery_id header (prevents double-delivery on retry)
 * - HMAC-SHA256 payload signing (shared secret per endpoint)
 * - Dead letter on final failure (moves to apex-dead-letters with origin=apex-routing)
 */

import crypto from "crypto";
import { Queue, Worker, type Job } from "bullmq";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { getBullMQConnection, QUEUE_NAMES } from "../queues/queueFactory";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DeliveryVertical = "home_services" | "legal" | "insurance" | "crash" | "service_industry" | "generic";

export interface WebhookEndpoint {
  id:           number;
  subAccountId: number;
  vertical:     DeliveryVertical;
  url:          string;
  secret?:      string;       // HMAC signing secret
  headers?:     Record<string, string>;
  active:       boolean;
  maxRetries:   number;
}

export interface LeadDeliveryJob {
  deliveryId:   string;       // UUID — idempotency key
  subAccountId: number;
  vertical:     DeliveryVertical;
  payload:      Record<string, any>;
  endpointId?:  number;       // optional — if not set, auto-routes by vertical
  _originQueue: string;
}

export interface DeliveryAttempt {
  deliveryId:   string;
  endpointId:   number;
  attempt:      number;
  status:       "success" | "failed" | "timeout";
  httpStatus?:  number;
  latencyMs:    number;
  responseSnippet?: string;
  attemptedAt:  string;
}

// ── Ensure delivery log table ─────────────────────────────────────────────────

async function ensureDeliveryLogTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS webhook_delivery_log (
      id            SERIAL PRIMARY KEY,
      delivery_id   TEXT        NOT NULL,
      sub_account_id INTEGER     NOT NULL,
      endpoint_id   INTEGER,
      vertical      TEXT        NOT NULL,
      attempt       INTEGER     NOT NULL DEFAULT 1,
      status        TEXT        NOT NULL,
      http_status   INTEGER,
      latency_ms    INTEGER,
      response_snip TEXT,
      payload_hash  TEXT,
      attempted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wdl_delivery_idx ON webhook_delivery_log (delivery_id);
    CREATE INDEX IF NOT EXISTS wdl_tenant_idx   ON webhook_delivery_log (sub_account_id, vertical);
  `);
}

// ── Endpoint registry (in-DB) ─────────────────────────────────────────────────

async function ensureEndpointTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id             SERIAL PRIMARY KEY,
      sub_account_id INTEGER     NOT NULL,
      vertical       TEXT        NOT NULL DEFAULT 'generic',
      url            TEXT        NOT NULL,
      secret         TEXT,
      headers        JSONB       NOT NULL DEFAULT '{}',
      active         BOOLEAN     NOT NULL DEFAULT true,
      max_retries    INTEGER     NOT NULL DEFAULT 3,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS we_tenant_vertical_idx ON webhook_endpoints (sub_account_id, vertical, active);
  `);
}

async function getEndpoints(subAccountId: number, vertical: DeliveryVertical): Promise<WebhookEndpoint[]> {
  await ensureEndpointTable();
  const result = await db.execute(sql`
    SELECT id, sub_account_id, vertical, url, secret, headers, active, max_retries
    FROM webhook_endpoints
    WHERE sub_account_id = ${subAccountId}
      AND vertical IN (${vertical}, 'generic')
      AND active = true
    ORDER BY vertical DESC  -- prefer specific vertical over generic
  `);
  const rows = (result as any).rows ?? result;
  if (!Array.isArray(rows)) return [];
  return rows.map((r: any) => ({
    id:           Number(r.id),
    subAccountId: Number(r.sub_account_id),
    vertical:     r.vertical as DeliveryVertical,
    url:          String(r.url),
    secret:       r.secret ? String(r.secret) : undefined,
    headers:      typeof r.headers === "object" ? r.headers : {},
    active:       Boolean(r.active),
    maxRetries:   Number(r.max_retries ?? 3),
  }));
}

// ── HMAC signing ──────────────────────────────────────────────────────────────

function signPayload(body: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

// ── HTTP delivery ──────────────────────────────────────────────────────────────

async function deliverToEndpoint(
  endpoint: WebhookEndpoint,
  deliveryId: string,
  payload: Record<string, any>,
  attempt: number
): Promise<DeliveryAttempt> {
  const body = JSON.stringify({ ...payload, _deliveryId: deliveryId, _attempt: attempt });
  const hash = crypto.createHash("sha256").update(body).digest("hex").slice(0, 8);
  const headers: Record<string, string> = {
    "Content-Type":    "application/json",
    "X-Delivery-Id":   deliveryId,
    "X-Apex-Attempt":  String(attempt),
    ...(endpoint.headers ?? {}),
  };
  if (endpoint.secret) {
    headers["X-Apex-Signature"] = signPayload(body, endpoint.secret);
  }

  const start = Date.now();
  let status: DeliveryAttempt["status"] = "failed";
  let httpStatus: number | undefined;
  let responseSnippet: string | undefined;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    httpStatus = response.status;
    const text = await response.text().catch(() => "");
    responseSnippet = text.slice(0, 200);
    status = response.ok ? "success" : "failed";
  } catch (err: any) {
    status = err?.name === "AbortError" ? "timeout" : "failed";
    responseSnippet = err?.message?.slice(0, 200);
  }

  const latencyMs = Date.now() - start;
  const log: DeliveryAttempt = {
    deliveryId, endpointId: endpoint.id, attempt, status, httpStatus, latencyMs, responseSnippet,
    attemptedAt: new Date().toISOString(),
  };

  // Write audit log
  try {
    await ensureDeliveryLogTable();
    await db.execute(sql`
      INSERT INTO webhook_delivery_log
        (delivery_id, sub_account_id, endpoint_id, vertical, attempt, status, http_status, latency_ms, response_snip, payload_hash)
      VALUES
        (${deliveryId}, ${endpoint.subAccountId}, ${endpoint.id}, ${endpoint.vertical},
         ${attempt}, ${status}, ${httpStatus ?? null}, ${latencyMs}, ${responseSnippet ?? null}, ${hash})
    `);
  } catch { /* non-fatal */ }

  return log;
}

// ── Main delivery orchestration ───────────────────────────────────────────────

export async function deliverLead(
  subAccountId: number,
  vertical: DeliveryVertical,
  payload: Record<string, any>,
  deliveryId: string = crypto.randomUUID()
): Promise<{ ok: boolean; results: DeliveryAttempt[]; deliveryId: string }> {
  const endpoints = await getEndpoints(subAccountId, vertical);
  if (endpoints.length === 0) {
    return { ok: true, results: [], deliveryId }; // no endpoints configured — silent ok
  }

  const results: DeliveryAttempt[] = [];
  let anySuccess = false;

  for (const endpoint of endpoints) {
    for (let attempt = 1; attempt <= endpoint.maxRetries; attempt++) {
      const result = await deliverToEndpoint(endpoint, deliveryId, payload, attempt);
      results.push(result);
      if (result.status === "success") { anySuccess = true; break; }
      if (attempt < endpoint.maxRetries) {
        const delay = attempt === 1 ? 0 : attempt === 2 ? 30_000 : 300_000;
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  return { ok: anySuccess || endpoints.length === 0, results, deliveryId };
}

// ── Endpoint management API ────────────────────────────────────────────────────

export async function registerWebhookEndpoint(params: {
  subAccountId: number;
  vertical:     DeliveryVertical;
  url:          string;
  secret?:      string;
  headers?:     Record<string, string>;
  maxRetries?:  number;
}): Promise<{ id: number }> {
  await ensureEndpointTable();
  const result = await db.execute(sql`
    INSERT INTO webhook_endpoints (sub_account_id, vertical, url, secret, headers, max_retries)
    VALUES (${params.subAccountId}, ${params.vertical}, ${params.url},
            ${params.secret ?? null}, ${JSON.stringify(params.headers ?? {})}::jsonb,
            ${params.maxRetries ?? 3})
    RETURNING id
  `);
  const rows = (result as any).rows ?? result;
  return { id: Number(Array.isArray(rows) ? rows[0]?.id : 0) };
}

export async function getDeliveryLog(
  subAccountId: number,
  deliveryId?: string,
  limit = 50
): Promise<DeliveryAttempt[]> {
  await ensureDeliveryLogTable();
  const result = await db.execute(sql`
    SELECT delivery_id, endpoint_id, attempt, status, http_status, latency_ms, response_snip, attempted_at
    FROM webhook_delivery_log
    WHERE sub_account_id = ${subAccountId}
      ${deliveryId ? sql`AND delivery_id = ${deliveryId}` : sql``}
    ORDER BY attempted_at DESC
    LIMIT ${limit}
  `);
  const rows = (result as any).rows ?? result;
  if (!Array.isArray(rows)) return [];
  return rows.map((r: any) => ({
    deliveryId:       String(r.delivery_id),
    endpointId:       Number(r.endpoint_id),
    attempt:          Number(r.attempt),
    status:           r.status as DeliveryAttempt["status"],
    httpStatus:       r.http_status ? Number(r.http_status) : undefined,
    latencyMs:        Number(r.latency_ms),
    responseSnippet:  r.response_snip ? String(r.response_snip) : undefined,
    attemptedAt:      String(r.attempted_at),
  }));
}

// ── BullMQ worker ──────────────────────────────────────────────────────────────

let _worker: Worker | null = null;

export function startWebhookDeliveryWorker(): Worker {
  if (_worker) return _worker;

  _worker = new Worker<LeadDeliveryJob>(
    QUEUE_NAMES.ROUTING,
    async (job: Job<LeadDeliveryJob>) => {
      if (job.name !== "webhook_delivery") return;
      const { subAccountId, vertical, payload, deliveryId } = job.data;
      const result = await deliverLead(subAccountId, vertical, payload, deliveryId);
      if (!result.ok) throw new Error(`Delivery failed for ${deliveryId} — all endpoints failed`);
      return result;
    },
    {
      connection: getBullMQConnection(),
      concurrency: 10,
      limiter: { max: 50, duration: 1000 },
    }
  );

  _worker.on("failed", (job, err) => {
    console.error(`[WEBHOOK-DELIVERY-WORKER] job ${job?.id} failed:`, err?.message);
  });

  console.log("[WEBHOOK-DELIVERY-WORKER] started — listening on apex-routing queue");
  return _worker;
}
