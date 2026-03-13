import { db } from "./db";
import { systemLogs } from "@shared/schema";
import { desc, eq, and, gte, lte } from "drizzle-orm";

export type LogSeverity = "debug" | "info" | "warn" | "error" | "critical";

export async function logSystemEvent(
  severity: LogSeverity,
  module: string,
  message: string,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    await db.insert(systemLogs).values({
      severity,
      module,
      message,
      metadata: metadata || null,
    });
  } catch (err) {
    console.error(`[SYSTEM-LOG] Failed to write log: ${message}`, err);
  }
}

export async function logSystemError(
  module: string,
  message: string,
  metadata?: Record<string, any>
): Promise<void> {
  return logSystemEvent("error", module, message, metadata);
}

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

  const query = db
    .select()
    .from(systemLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(systemLogs.timestamp))
    .limit(options?.limit || 100)
    .offset(options?.offset || 0);

  return query;
}
