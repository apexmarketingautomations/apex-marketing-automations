import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { EVENT_LOG_STATUS } from "@shared/schema";

export type ExternalIdExtractor = (req: Request) => string | null | undefined;

export interface IdempotencyOptions {
  source: string;
  extractExternalId: ExternalIdExtractor;
  eventType: string;
  maxRetries?: number;
}

export function withIdempotency(opts: IdempotencyOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const externalId = opts.extractExternalId(req);

    if (!externalId) {
      req.eventTraceId = crypto.randomUUID();
      req.eventLogId = null;
      return next();
    }

    try {
      const existing = await storage.getEventLogByExternalId(opts.source, externalId);

      if (existing) {
        if (existing.status === EVENT_LOG_STATUS.COMPLETED || existing.status === EVENT_LOG_STATUS.PROCESSING) {
          console.log(`[IDEMPOTENCY] Duplicate ${opts.source} event ${externalId} (status: ${existing.status}) — skipping`);
          return res.status(200).send(existing.status === EVENT_LOG_STATUS.COMPLETED ? "duplicate:ok" : "processing:ok");
        }
        req.eventTraceId = existing.traceId;
        req.eventLogId = existing.id;
        await storage.updateEventLogStatus(existing.id, EVENT_LOG_STATUS.PROCESSING);
        return next();
      }

      const traceId = crypto.randomUUID();
      const entry = await storage.createEventLog({
        traceId,
        type: opts.eventType,
        source: opts.source,
        externalId,
        payload: req.body || {},
        status: EVENT_LOG_STATUS.PENDING,
        maxRetries: opts.maxRetries ?? 3,
      });

      await storage.updateEventLogStatus(entry.id, EVENT_LOG_STATUS.PROCESSING);
      req.eventTraceId = traceId;
      req.eventLogId = entry.id;
      next();
    } catch (err: any) {
      console.error(`[IDEMPOTENCY] Error for ${opts.source}/${externalId}:`, err.message);
      req.eventTraceId = crypto.randomUUID();
      req.eventLogId = null;
      next();
    }
  };
}

export async function markEventCompleted(req: Request): Promise<void> {
  if (req.eventLogId) {
    await storage.updateEventLogStatus(req.eventLogId, EVENT_LOG_STATUS.COMPLETED, { processedAt: new Date() }).catch((err) => console.warn("[IDEMPOTENCY] promise rejected:", err instanceof Error ? err.message : err));
  }
}

export async function markEventFailed(req: Request, errorMessage: string): Promise<void> {
  if (req.eventLogId) {
    await storage.updateEventLogStatus(req.eventLogId, EVENT_LOG_STATUS.FAILED, {
      failedAt: new Date(),
      errorMessage,
    }).catch((err) => console.warn("[IDEMPOTENCY] promise rejected:", err instanceof Error ? err.message : err));
  }
}

declare global {
  namespace Express {
    interface Request {
      eventTraceId?: string;
      eventLogId?: number | null;
    }
  }
}
