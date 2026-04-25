import { storage } from "./storage";
import { EVENT_LOG_STATUS } from "@shared/schema";

const RETRY_INTERVALS_MS = [
  30_000,
  300_000,
  1_800_000,
];

let retryProcessorHandle: ReturnType<typeof setInterval> | null = null;

const retryHandlers = new Map<string, (payload: Record<string, any>, traceId: string) => Promise<void>>();

export function registerRetryHandler(source: string, handler: (payload: Record<string, any>, traceId: string) => Promise<void>): void {
  retryHandlers.set(source, handler);
}

export async function processFailedEvents(): Promise<void> {
  try {
    const failedEvents = await storage.getFailedEventLogs();
    if (failedEvents.length === 0) return;

    console.log(`[RETRY-PROCESSOR] Processing ${failedEvents.length} failed event(s)`);

    for (const event of failedEvents) {
      const nextRetry = retryIntervalFor(event.retryCount);
      const lastFailed = event.failedAt ? event.failedAt.getTime() : event.createdAt.getTime();
      if (Date.now() - lastFailed < nextRetry) {
        continue;
      }

      const handler = retryHandlers.get(event.source);
      if (!handler) {
        console.log(`[RETRY-PROCESSOR] No retry handler for source "${event.source}", marking dead_letter`);
        await storage.updateEventLogStatus(event.id, EVENT_LOG_STATUS.DEAD_LETTER, {
          errorMessage: `No retry handler registered for source: ${event.source}`,
        }).catch((err) => console.warn("[EVENTRETRYPROCESSOR] promise rejected:", err instanceof Error ? err.message : err));
        continue;
      }

      const newRetryCount = event.retryCount + 1;
      await storage.updateEventLogStatus(event.id, EVENT_LOG_STATUS.PROCESSING, { retryCount: newRetryCount }).catch((err) => console.warn("[EVENTRETRYPROCESSOR] promise rejected:", err instanceof Error ? err.message : err));

      try {
        await handler(event.payload as Record<string, any>, event.traceId);
        await storage.updateEventLogStatus(event.id, EVENT_LOG_STATUS.COMPLETED, { processedAt: new Date() }).catch((err) => console.warn("[EVENTRETRYPROCESSOR] promise rejected:", err instanceof Error ? err.message : err));
        console.log(`[RETRY-PROCESSOR] Event ${event.id} (${event.type}) retry #${newRetryCount} succeeded`);
      } catch (err: any) {
        console.error(`[RETRY-PROCESSOR] Event ${event.id} (${event.type}) retry #${newRetryCount} failed: ${err.message}`);

        if (newRetryCount >= event.maxRetries) {
          await storage.updateEventLogStatus(event.id, EVENT_LOG_STATUS.DEAD_LETTER, {
            failedAt: new Date(),
            errorMessage: `Max retries (${event.maxRetries}) exceeded. Last error: ${err.message}`,
            retryCount: newRetryCount,
          }).catch((err) => console.warn("[EVENTRETRYPROCESSOR] promise rejected:", err instanceof Error ? err.message : err));
          console.warn(`[RETRY-PROCESSOR] Event ${event.id} moved to dead_letter after ${newRetryCount} retries`);
        } else {
          await storage.updateEventLogStatus(event.id, EVENT_LOG_STATUS.FAILED, {
            failedAt: new Date(),
            errorMessage: err.message,
            retryCount: newRetryCount,
          }).catch((err) => console.warn("[EVENTRETRYPROCESSOR] promise rejected:", err instanceof Error ? err.message : err));
        }
      }
    }
  } catch (err: any) {
    console.error("[RETRY-PROCESSOR] Processor error:", err.message);
  }
}

function retryIntervalFor(retryCount: number): number {
  const idx = Math.min(retryCount, RETRY_INTERVALS_MS.length - 1);
  return RETRY_INTERVALS_MS[idx];
}

export function startRetryProcessor(intervalMs = 3_600_000): void {
  if (retryProcessorHandle) return;

  retryProcessorHandle = setInterval(() => {
    processFailedEvents().catch(err => console.error("[RETRY-PROCESSOR] Interval error:", err?.message));
  }, intervalMs);

  console.log(`[RETRY-PROCESSOR] Started (interval: ${intervalMs}ms)`);
}

export function stopRetryProcessor(): void {
  if (retryProcessorHandle) {
    clearInterval(retryProcessorHandle);
    retryProcessorHandle = null;
    console.log("[RETRY-PROCESSOR] Stopped");
  }
}
