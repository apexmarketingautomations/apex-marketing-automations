import crypto from "crypto";
import { storage } from "./storage";
import type { InsertTimelineEvent } from "@shared/schema";

export interface TraceContext {
  traceId: string;
  subAccountId: number;
  conversationId?: string;
  contactPhone?: string;
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
  opts: { provider?: string; metadata?: Record<string, any> } = {}
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
    };
    storage.createTimelineEvent(event).catch(e => {
      console.error("[TRACE-RECORDER] Failed to record step:", e?.message);
    });
  }

  return result;
}

export async function recordStepValue(
  ctx: TraceContext,
  step: string,
  status: "success" | "error",
  latencyMs: number,
  opts: { provider?: string; metadata?: Record<string, any>; error?: string } = {}
): Promise<void> {
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
  };
  storage.createTimelineEvent(event).catch(e => {
    console.error("[TRACE-RECORDER] Failed to record step value:", e?.message);
  });
}
