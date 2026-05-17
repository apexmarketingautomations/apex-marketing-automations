import { logSystemError } from "./systemLogger";

const MAX_EXECUTION_DEPTH = 10;
const DUPLICATE_WINDOW_MS = 5_000;

const recentExecutions: Map<string, number> = new Map();

setInterval(() => {
  const cutoff = Date.now() - DUPLICATE_WINDOW_MS * 2;
  for (const [key, ts] of Array.from(recentExecutions.entries())) {
    if (ts < cutoff) recentExecutions.delete(key);
  }
}, 30_000);

export function checkAutomationSafety(options: {
  automationId: number;
  triggerId?: string;
  depth?: number;
  accountId?: number;
}): { safe: boolean; reason?: string } {
  const { automationId, triggerId, depth = 0, accountId } = options;

  if (depth > MAX_EXECUTION_DEPTH) {
    const msg = `Automation ${automationId} exceeded max depth ${MAX_EXECUTION_DEPTH}`;
    logSystemError("automation", msg, { automationId, depth, accountId });
    return { safe: false, reason: msg };
  }

  if (triggerId) {
    const key = `${automationId}:${triggerId}`;
    const lastRun = recentExecutions.get(key);
    if (lastRun && Date.now() - lastRun < DUPLICATE_WINDOW_MS) {
      const msg = `Duplicate trigger detected for automation ${automationId} within ${DUPLICATE_WINDOW_MS}ms`;
      logSystemError("automation", msg, { automationId, triggerId, accountId });
      return { safe: false, reason: msg };
    }
    recentExecutions.set(key, Date.now());
  }

  return { safe: true };
}

export function recordAutomationExecution(automationId: number, triggerId: string) {
  const key = `${automationId}:${triggerId}`;
  recentExecutions.set(key, Date.now());
}
