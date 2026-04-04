import type { Request, Response, NextFunction } from "express";

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
  req.tenant = {
    subAccountId: 13,
  };
  next();
}
