import { db } from "../db";
import { routingFailures, type InsertRoutingFailure } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function persistRoutingFailure(data: {
  phone?: string;
  channel: string;
  source?: string;
  reason: string;
  rawPayload?: Record<string, any>;
}): Promise<void> {
  try {
    await db.insert(routingFailures).values({
      phone: data.phone ?? null,
      channel: data.channel,
      source: data.source ?? null,
      rawPayload: data.rawPayload ?? null,
      reason: data.reason,
      resolvedSubAccountId: null,
      resolvedAt: null,
    });
    console.error(`[ROUTING-QUEUE] Persisted routing failure: ${data.reason} (phone=${data.phone ?? "none"}, channel=${data.channel})`);
  } catch (err: any) {
    console.error("[ROUTING-QUEUE] Failed to persist routing failure:", err.message);
  }
}

export async function listRoutingFailures(unresolvedOnly = true) {
  try {
    const rows = await db.select().from(routingFailures);
    if (unresolvedOnly) {
      return rows.filter(r => r.resolvedAt === null);
    }
    return rows;
  } catch (err: any) {
    console.error("[ROUTING-QUEUE] Failed to list routing failures:", err.message);
    return [];
  }
}

export async function resolveRoutingFailure(id: number, subAccountId: number) {
  try {
    const [updated] = await db.update(routingFailures)
      .set({
        resolvedSubAccountId: subAccountId,
        resolvedAt: new Date(),
      })
      .where(eq(routingFailures.id, id))
      .returning();
    return updated ?? null;
  } catch (err: any) {
    console.error("[ROUTING-QUEUE] Failed to resolve routing failure:", err.message);
    return null;
  }
}
