import type { ToolResult } from "../types";
import { isProtectedAccountId } from "../../middleware/protectedAccount";
import { db } from "../../db";
import { systemLogs } from "@shared/schema";
import { randomUUID } from "crypto";

export function verifyTenant(record: { subAccountId?: number } | null | undefined, expectedSubAccountId: number, entityName: string): ToolResult | null {
  if (!record) return { success: false, error: `${entityName} not found` };
  if (record.subAccountId !== undefined && record.subAccountId !== expectedSubAccountId) {
    return { success: false, error: `${entityName} not found` };
  }
  return null;
}

export async function verifyNotProtectedAccount(subAccountId: number, agentId?: string, autonomyLevel?: string): Promise<ToolResult | null> {
  const isProtected = await isProtectedAccountId(subAccountId);
  if (!isProtected) return null;

  if (autonomyLevel === "observe") {
    return null;
  }

  const traceId = randomUUID();
  try {
    await db.insert(systemLogs).values({
      severity: "security",
      module: "agent-tenant-guard",
      message: `Agent attempted to target protected account ${subAccountId}. Action aborted.`,
      metadata: {
        level: "security",
        traceId,
        userId: agentId || "agent",
        subAccountId,
        action: "agent_protected_account_blocked",
        meta: { agentId, reason: "Protected account targeted by AI agent/operator" },
      },
    });
  } catch {}

  return {
    success: false,
    error: `This operation is not permitted on protected account ${subAccountId}. Read-only diagnostics are available, but modifications require manual intervention.`,
  };
}
