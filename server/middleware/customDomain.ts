import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { domains, savedSites } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const PLATFORM_HOSTS = new Set([
  "localhost",
  "0.0.0.0",
  "127.0.0.1",
  "apexmarketingautomations.com",
  "www.apexmarketingautomations.com",
]);

function isPlatformHost(hostname: string): boolean {
  if (PLATFORM_HOSTS.has(hostname)) return true;
  if (hostname.endsWith(".replit.dev") || hostname.endsWith(".repl.co") || hostname.endsWith(".replit.app")) return true;
  if (hostname.match(/^[\d.]+$/) || hostname.includes(":")) return true;
  return false;
}

const domainCache = new Map<string, { siteId: number | null; ts: number }>();
const CACHE_TTL = 120_000;

async function resolveDomainSite(hostname: string): Promise<number | null> {
  const cached = domainCache.get(hostname);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.siteId;

  try {
    const [row] = await db
      .select({ siteId: domains.siteId })
      .from(domains)
      .where(
        and(
          eq(domains.domainName, hostname),
          eq(domains.status, "verified"),
        )
      )
      .limit(1);

    const siteId = row?.siteId ?? null;
    domainCache.set(hostname, { siteId, ts: Date.now() });
    return siteId;
  } catch (e: any) {
    console.warn("[DOMAIN-ROUTE] DB lookup failed:", e.message);
    return null;
  }
}

export function customDomainMiddleware(renderSiteHtml: (siteId: number, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const hostname = (req.hostname || req.headers.host || "").split(":")[0].toLowerCase();

    if (isPlatformHost(hostname)) return next();

    if (req.path.startsWith("/api/") || req.path.startsWith("/live/")) return next();

    const siteId = await resolveDomainSite(hostname);
    if (!siteId) return next();

    try {
      await renderSiteHtml(siteId, res);
    } catch (e: any) {
      console.error("[DOMAIN-ROUTE] Render failed for", hostname, "siteId", siteId, e.message);
      next();
    }
  };
}

export function clearDomainCache(hostname?: string) {
  if (hostname) {
    domainCache.delete(hostname);
  } else {
    domainCache.clear();
  }
}
