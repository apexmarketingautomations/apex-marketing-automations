import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { subAccounts, systemLogs } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getProtectedAccountIds as resolveProtectedIds } from "../services/laylaAccountResolver";

export function getProtectedAccountIds(): number[] {
  return [13];
}

export async function isProtectedAccountId(subAccountId: number): Promise<boolean> {
  try {
    const dynamicIds = await resolveProtectedIds();
    if (dynamicIds.includes(subAccountId)) return true;
    const [account] = await db.select({ isProtected: subAccounts.isProtected }).from(subAccounts).where(eq(subAccounts.id, subAccountId));
    return account?.isProtected === true;
  } catch {
    return getProtectedAccountIds().includes(subAccountId);
  }
}

export function isMutating(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) return true;
  if (method === "GET") {
    const url = req.originalUrl || req.url;
    if (/seed|trigger|execute|run|toggle|approve|send/i.test(url)) return true;
  }
  return false;
}

function getUserIdFromReq(req: Request): string {
  const user = (req as any).user;
  return user?.claims?.sub || user?.id || "anonymous";
}

function getAgentIdFromReq(req: Request): string | undefined {
  return (req as any).agentId || (req as any).headers?.["x-agent-id"];
}

async function logProtectionEvent(
  level: string,
  traceId: string,
  userId: string,
  subAccountId: number,
  action: string,
  meta: { ip?: string; agentId?: string; reason?: string }
) {
  try {
    await db.insert(systemLogs).values({
      severity: level,
      module: "protected-account-guard",
      message: `${action} on sub_account ${subAccountId} by ${userId}`,
      metadata: { level, traceId, userId, subAccountId, action, meta },
    });
  } catch {}
}

export function ensureNotProtectedAccount(
  extractSubAccountId: (req: Request) => number | null
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const subAccountId = extractSubAccountId(req);
    if (subAccountId === null) return next();

    const isProtected = await isProtectedAccountId(subAccountId);
    if (!isProtected) return next();

    const traceId = randomUUID();
    const userId = getUserIdFromReq(req);
    const agentId = getAgentIdFromReq(req);
    const ip = req.ip || req.socket?.remoteAddress;

    if (isMutating(req)) {
      await logProtectionEvent("security", traceId, userId, subAccountId, "protected_account_write_attempt", {
        ip,
        agentId,
        reason: `Blocked ${req.method} ${req.originalUrl || req.url}`,
      });
      return res.status(403).json({
        error: "This account is protected and cannot be modified",
        error_code: "sub_account_protected",
        ticketId: traceId,
      });
    }

    await logProtectionEvent("info", traceId, userId, subAccountId, "protected_account_read_audit", {
      ip,
      agentId,
      reason: `Read access ${req.method} ${req.originalUrl || req.url}`,
    });
    next();
  };
}
