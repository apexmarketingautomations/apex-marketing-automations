import crypto from "crypto";
import { storage } from "./storage";
import type { InsertTimelineEvent } from "@shared/schema";

export interface TraceContext {
  traceId: string;
  subAccountId: number;
  conversationId?: string;
  contactPhone?: string;
}

const FLUSH_INTERVAL_MS = 500;
const FLUSH_THRESHOLD = 20;

const eventBuffer: InsertTimelineEvent[] = [];
const sequenceCounters = new Map<string, number>();

function getNextSequence(traceId: string): number {
  const current = sequenceCounters.get(traceId) ?? 0;
  const next = current + 1;
  sequenceCounters.set(traceId, next);
  setTimeout(() => sequenceCounters.delete(traceId), 300_000);
  return next;
}

/**
 * Generate a stable, idempotent event key for deduplication.
 * The disambiguator MUST be a stable logical identifier (e.g., message SID, external event ID, DB record ID).
 * Do NOT pass time-derived or random values — those defeat idempotency.
 * When no disambiguator is available, omit eventKey by passing undefined/null from the caller.
 */
export function generateEventKey(traceId: string, step: string, disambiguator: string): string {
  return `${traceId}:${step}:${disambiguator}`;
}

async function flushBuffer(): Promise<void> {
  if (eventBuffer.length === 0) return;
  const batch = eventBuffer.splice(0, eventBuffer.length);
  try {
    await storage.batchCreateTimelineEvents(batch);
  } catch (e: any) {
    console.error("[TRACE-RECORDER] Batch flush failed:", e?.message);
  }
}

setInterval(() => {
  flushBuffer().catch(e => console.error("[TRACE-RECORDER] Flush interval error:", e?.message));
}, FLUSH_INTERVAL_MS);

function enqueueEvent(event: InsertTimelineEvent): void {
  eventBuffer.push(event);
  if (eventBuffer.length >= FLUSH_THRESHOLD) {
    flushBuffer().catch(e => console.error("[TRACE-RECORDER] Threshold flush error:", e?.message));
  }
}

export function startTrace(subAccountId: number, opts: { conversationId?: string; contactPhone?: string } = {}): TraceContext {
  return {
    traceId: crypto.randomUUID(),
    subAccountId,
    conversationId: opts.conversationId,
    contactPhone: opts.contactPhone,
  };
}

export async function recordStep(
  ctx: TraceContext,
  step: string,
  fn: () => Promise<any>,
  opts: {
    provider?: string;
    metadata?: Record<string, any>;
    /**
     * Stable logical identifier for idempotency (e.g., SID, external event ID, DB record ID).
     * When provided, the same logical event can be safely retried without creating duplicates.
     * Do NOT provide time-derived or random values.
     */
    disambiguator?: string;
  } = {}
): Promise<any> {
  const start = Date.now();
  let status: "success" | "error" = "success";
  let error: string | undefined;
  let result: any;

  try {
    result = await fn();
  } catch (err: any) {
    status = "error";
    error = err?.message || String(err);
    throw err;
  } finally {
    const latencyMs = Date.now() - start;
    const eventKey = opts.disambiguator ? generateEventKey(ctx.traceId, step, opts.disambiguator) : null;
    const sequenceNum = getNextSequence(ctx.traceId);
    const event: InsertTimelineEvent = {
      subAccountId: ctx.subAccountId,
      traceId: ctx.traceId,
      conversationId: ctx.conversationId ?? null,
      contactPhone: ctx.contactPhone ?? null,
      step,
      status,
      provider: opts.provider ?? null,
      latencyMs,
      metadata: opts.metadata ?? null,
      error: error ?? null,
      eventKey,
      sequenceNum,
    };
    try {
      enqueueEvent(event);
    } catch (e: any) {
      console.error("[TRACE-RECORDER] Enqueue failed:", e?.message);
    }
  }

  return result;
}

export function recordStepValue(
  ctx: TraceContext,
  step: string,
  status: "success" | "error",
  latencyMs: number,
  opts: {
    provider?: string;
    metadata?: Record<string, any>;
    error?: string;
    /**
     * Stable logical identifier for idempotency (e.g., SID, external event ID, DB record ID).
     * When provided, the same logical event can be safely retried without creating duplicates.
     * Do NOT provide time-derived or random values.
     */
    disambiguator?: string;
  } = {}
): void {
  try {
    const eventKey = opts.disambiguator ? generateEventKey(ctx.traceId, step, opts.disambiguator) : null;
    const sequenceNum = getNextSequence(ctx.traceId);
    const event: InsertTimelineEvent = {
      subAccountId: ctx.subAccountId,
      traceId: ctx.traceId,
      conversationId: ctx.conversationId ?? null,
      contactPhone: ctx.contactPhone ?? null,
      step,
      status,
      provider: opts.provider ?? null,
      latencyMs,
      metadata: opts.metadata ?? null,
      error: opts.error ?? null,
      eventKey,
      sequenceNum,
    };
    enqueueEvent(event);
  } catch (e: any) {
    console.error("[TRACE-RECORDER] recordStepValue failed:", e?.message);
  }
}
