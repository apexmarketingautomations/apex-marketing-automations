import type { TelemetryMetric } from "./types";
import { eventBus } from "../eventBus";
import { jobQueue } from "../jobQueue";

const metrics: TelemetryMetric[] = [];
const MAX_METRICS = 10000;
const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const timings = new Map<string, number[]>();

export function incrementCounter(name: string, amount = 1, tags: Record<string, string> = {}): void {
  const key = `${name}:${JSON.stringify(tags)}`;
  counters.set(key, (counters.get(key) || 0) + amount);
  recordMetric(name, (counters.get(key) || 0), "count", tags);
}

export function setGauge(name: string, value: number, tags: Record<string, string> = {}): void {
  const key = `${name}:${JSON.stringify(tags)}`;
  gauges.set(key, value);
  recordMetric(name, value, "gauge", tags);
}

export function recordTiming(name: string, durationMs: number, tags: Record<string, string> = {}): void {
  const key = `${name}:${JSON.stringify(tags)}`;
  if (!timings.has(key)) timings.set(key, []);
  const arr = timings.get(key)!;
  arr.push(durationMs);
  if (arr.length > 100) arr.shift();
  recordMetric(name, durationMs, "ms", tags);
}

function recordMetric(name: string, value: number, unit: string, tags: Record<string, string>): void {
  metrics.push({
    name,
    value,
    unit,
    tags,
    timestamp: new Date().toISOString(),
  });
  if (metrics.length > MAX_METRICS) {
    metrics.splice(0, metrics.length - MAX_METRICS);
  }
}

export function collectSystemMetrics(): Record<string, any> {
  const eventStats = eventBus.getStats();
  const queueStats = jobQueue.getStats();
  const mem = process.memoryUsage();

  return {
    timestamp: new Date().toISOString(),
    eventBus: {
      totalProcessed: eventStats.totalEvents,
      queueDepth: eventStats.queueDepth,
      subscriberCount: eventStats.subscriberCount,
      recentErrorCount: eventStats.recentErrors.length,
      eventTypes: eventStats.eventTypes.length,
    },
    jobQueue: {
      queued: queueStats.queued,
      running: queueStats.running,
      completed: queueStats.completed,
      failed: queueStats.failed,
      handlers: queueStats.registeredHandlers.length,
    },
    process: {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024),
      uptimeSeconds: Math.round(process.uptime()),
    },
    counters: Object.fromEntries(counters),
    gaugeCount: gauges.size,
    metricCount: metrics.length,
  };
}

export function getMetrics(opts: { name?: string; limit?: number; since?: string } = {}): TelemetryMetric[] {
  let result = metrics;
  if (opts.name) result = result.filter(m => m.name === opts.name);
  if (opts.since) {
    const sinceDate = new Date(opts.since);
    result = result.filter(m => new Date(m.timestamp) >= sinceDate);
  }
  return result.slice(-(opts.limit || 200));
}

export function getTimingStats(name: string): { avg: number; p50: number; p95: number; p99: number; count: number } | null {
  const key = [...timings.keys()].find(k => k.startsWith(name));
  if (!key) return null;
  const arr = timings.get(key)!;
  if (arr.length === 0) return null;

  const sorted = [...arr].sort((a, b) => a - b);
  return {
    avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
    count: sorted.length,
  };
}
