import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { subAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";

const DEFAULT_ACCOUNT_ID = 13;

declare global {
  namespace Express {
    interface Request {
      tenant: {
        subAccountId: number;
      };
    }
  }
}

export function tenantMiddleware(req: Request, _res: Response, next: NextFunction) {
  let subAccountId = DEFAULT_ACCOUNT_ID;

  const headerVal = req.headers["x-sub-account-id"];
  if (headerVal) {
    const parsed = parseInt(String(headerVal), 10);
    if (!isNaN(parsed) && parsed > 0) {
      const adminUserId = process.env.ADMIN_USER_ID;
      const adminSecret = req.headers["x-admin-secret"];
      const isAdminRequest = adminSecret && adminUserId && adminSecret === adminUserId;
      if (isAdminRequest) {
        subAccountId = parsed;
      }
    }
  }

  req.tenant = { subAccountId };
  next();
}
