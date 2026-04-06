import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { featureFlags, systemLogs } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function isFeatureEnabled(featureName: string): Promise<boolean> {
  try {
    const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.featureName, featureName));
    if (!flag) return false;
    return flag.enabled;
  } catch (err: any) {
    try {
      await db.insert(systemLogs).values({
        severity: "error",
        module: "feature-gate",
        message: `Failed to check feature flag '${featureName}': ${err?.message || "unknown error"}. Defaulting to OFF.`,
        metadata: { featureName, error: err?.message },
      });
    } catch {}
    return false;
  }
}

export function requireFeatureFlag(featureName: string) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    const enabled = await isFeatureEnabled(featureName);
    if (!enabled) {
      return res.status(404).json({ error: "Not found" });
    }
    next();
  };
}
