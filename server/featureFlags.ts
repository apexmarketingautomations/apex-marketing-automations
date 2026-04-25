import { db } from "./db";
import { featureFlags } from "@shared/schema";
import { eq } from "drizzle-orm";

const flagCache: Map<string, { enabled: boolean; cachedAt: number }> = new Map();
const CACHE_TTL = 60_000;

export async function isFeatureEnabled(featureName: string): Promise<boolean> {
  const cached = flagCache.get(featureName);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.enabled;
  }

  try {
    const [flag] = await db
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.featureName, featureName))
      .limit(1);

    const enabled = flag?.enabled ?? true;
    flagCache.set(featureName, { enabled, cachedAt: Date.now() });
    return enabled;
  } catch (err) {
    console.warn("[FEATUREFLAGS] caught:", err instanceof Error ? err.message : err);
    return true;
  }
}

export async function setFeatureFlag(
  featureName: string,
  enabled: boolean,
  description?: string
): Promise<void> {
  const existing = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.featureName, featureName))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(featureFlags)
      .set({ enabled })
      .where(eq(featureFlags.featureName, featureName));
  } else {
    await db.insert(featureFlags).values({ featureName, enabled, description });
  }

  flagCache.set(featureName, { enabled, cachedAt: Date.now() });
}

export async function getAllFeatureFlags() {
  return db.select().from(featureFlags);
}

export function clearFlagCache() {
  flagCache.clear();
}
