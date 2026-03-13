import { db } from "./db";
import { auditLogs } from "@shared/schema";
import { desc, eq, and, gte, lte } from "drizzle-orm";

export type AuditAction =
  | "USER_LOGIN" | "USER_LOGOUT" | "USER_REGISTER"
  | "ACCOUNT_CREATE" | "ACCOUNT_UPDATE" | "ACCOUNT_SUSPEND" | "ACCOUNT_REACTIVATE"
  | "SUBSCRIPTION_CREATE" | "SUBSCRIPTION_UPGRADE" | "SUBSCRIPTION_DOWNGRADE"
  | "SUBSCRIPTION_CANCEL" | "SUBSCRIPTION_REACTIVATE"
  | "PAYMENT_SUCCESS" | "PAYMENT_FAILED"
  | "SMS_SENT" | "SMS_FAILED" | "SMS_OPT_OUT"
  | "EMAIL_SENT" | "EMAIL_OPT_OUT"
  | "CONTACT_CREATE" | "CONTACT_UPDATE" | "CONTACT_DELETE"
  | "WORKFLOW_CREATE" | "WORKFLOW_UPDATE" | "WORKFLOW_DELETE" | "WORKFLOW_EXECUTE"
  | "AUTOMATION_TRIGGER" | "AUTOMATION_BLOCKED"
  | "INTEGRATION_CONNECT" | "INTEGRATION_DISCONNECT"
  | "ADMIN_ACTION" | "DATA_EXPORT" | "SETTING_CHANGE"
  | "LEGACY_STATUS_REVOKED" | "LEGACY_PAYMENT_WARNING"
  | "FEATURE_FLAG_CHANGE" | "PLAN_LIMIT_HIT";

export async function audit(
  action: AuditAction | string,
  performedBy: string,
  details?: Record<string, any>
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      action,
      performedBy,
      details: details || null,
    });
  } catch (err) {
    console.error(`[AUDIT] Failed to write: ${action}`, err);
  }
}

export async function getAuditLogs(options?: {
  action?: string;
  performedBy?: string;
  limit?: number;
  offset?: number;
  since?: Date;
  until?: Date;
}) {
  const conditions = [];
  if (options?.action) conditions.push(eq(auditLogs.action, options.action));
  if (options?.performedBy) conditions.push(eq(auditLogs.performedBy, options.performedBy));
  if (options?.since) conditions.push(gte(auditLogs.createdAt, options.since));
  if (options?.until) conditions.push(lte(auditLogs.createdAt, options.until));

  return db
    .select()
    .from(auditLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(options?.limit || 100)
    .offset(options?.offset || 0);
}
