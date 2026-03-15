import type { ToolResult } from "../types";

export function verifyTenant(record: { subAccountId?: number } | null | undefined, expectedSubAccountId: number, entityName: string): ToolResult | null {
  if (!record) return { success: false, error: `${entityName} not found` };
  if (record.subAccountId !== undefined && record.subAccountId !== expectedSubAccountId) {
    return { success: false, error: `${entityName} not found` };
  }
  return null;
}
