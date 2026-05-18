/**
 * server/routes/dynamicPages.ts
 *
 * API routes for the Apex Dynamic Pages prompt-driven builder.
 * Handles schema generation, patching, saving, and discoverability.
 */

import type { Express, Request, Response } from "express";
import { generatePageSchema, patchExistingPageSchema } from "../services/aiPromptToPageSchema";
import { isPlatformAdmin } from "../auth/authorization";
import { requireActiveSubscription } from "../subscriptionGuard";
import { asyncHandler } from "./helpers";
import { generateAllStructuredData } from "../services/discoverability/structuredDataGenerator";
import { generateTenantLlmsTxt } from "../services/discoverability/llmsTxtGenerator";
import { generateSitemapXml, buildSitemapEntries } from "../services/discoverability/sitemapGenerator";
import { generateRobotsTxt } from "../services/discoverability/robotsTxtGenerator";

// ── In-memory schema store (TODO: migrate to db table when schema is stable) ──
// WARNING: This is a volatile in-memory store. All saved schemas are LOST on server restart.
// [DYNAMIC-PAGES] DO NOT use this in production without DB persistence.
// Migration path: create a `dynamic_page_schemas` table in shared/schema.ts and move
// saveSchemaForAccount / getSchemasForAccount to db queries via storage layer.
// Tracking issue: server restart drops all user-saved pages.

// Emit a startup warning so Railway logs surface this clearly
if (typeof process !== "undefined") {
  console.warn("[DYNAMIC-PAGES] Using in-memory schema store — data will not survive restart. Migrate to DB persistence before production use.");
}

interface StoredSchema {
  id: string;
  subAccountId: number;
  schema: any;
  savedAt: string;
  published: boolean;
}

const schemaStore = new Map<number, StoredSchema[]>();

function getSchemasForAccount(subAccountId: number): StoredSchema[] {
  return schemaStore.get(subAccountId) ?? [];
}

function saveSchemaForAccount(subAccountId: number, schema: any): StoredSchema {
  const existing = schemaStore.get(subAccountId) ?? [];
  const entry: StoredSchema = {
    id: schema.id ?? Math.random().toString(36).slice(2, 10),
    subAccountId,
    schema,
    savedAt: new Date().toISOString(),
    published: schema.publish?.published ?? false,
  };
  const idx = existing.findIndex(s => s.id === entry.id);
  if (idx >= 0) existing[idx] = entry;
  else existing.push(entry);
  schemaStore.set(subAccountId, existing);
  return entry;
}

function getPublishedPages(subAccountId: number): StoredSchema[] {
  return getSchemasForAccount(subAccountId).filter(s => s.published);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSubAccountId(req: Request): number | null {
  const raw = req.body?.subAccountId ?? req.query.subAccountId ?? req.params.subAccountId;
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

function getOrigin(req: Request): string {
  return req.headers.origin ?? `${req.protocol}://${req.headers.host ?? "localhost"}`;
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerDynamicPagesRoutes(app: Express): void {
  const guard = requireActiveSubscription();

  /** Generate a new page schema from a prompt */
  app.post("/api/dynamic-pages/generate", guard, asyncHandler(async (req: Request, res: Response) => {
    const { prompt, subAccountId } = req.body as { prompt?: string; subAccountId?: number };
    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return res.status(400).json({ error: "prompt is required (min 3 chars)" });
    }

    // Sanitize prompt — prevent XSS / injection
    const sanitized = prompt.trim().slice(0, 2000).replace(/<[^>]*>/g, "");

    const schema = await generatePageSchema(sanitized, subAccountId);
    return res.json({ schema });
  }));

  /** Patch an existing schema with a new incremental prompt */
  app.post("/api/dynamic-pages/patch", guard, asyncHandler(async (req: Request, res: Response) => {
    const { prompt, existingSchema, subAccountId } = req.body as { prompt?: string; existingSchema?: any; subAccountId?: number };
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }
    if (!existingSchema || typeof existingSchema !== "object") {
      return res.status(400).json({ error: "existingSchema is required" });
    }

    const sanitized = prompt.trim().slice(0, 2000).replace(/<[^>]*>/g, "");
    const patched = await patchExistingPageSchema(existingSchema, sanitized);
    return res.json({ schema: patched });
  }));

  /** List saved schemas for a sub-account */
  app.get("/api/dynamic-pages/schemas/:subAccountId", guard, asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = parseInt(String(req.params.subAccountId), 10);
    if (isNaN(subAccountId)) return res.status(400).json({ error: "Invalid subAccountId" });

    const schemas = getSchemasForAccount(subAccountId).map(s => ({
      id: s.id, savedAt: s.savedAt, published: s.published,
      title: s.schema?.meta?.title ?? "Untitled",
      slug: s.schema?.meta?.slug ?? s.id,
      niche: s.schema?.meta?.niche ?? "general",
    }));
    return res.json({ schemas });
  }));

  /** Save a schema */
  app.post("/api/dynamic-pages/schemas", guard, asyncHandler(async (req: Request, res: Response) => {
    const { schema, subAccountId } = req.body as { schema?: any; subAccountId?: number };
    if (!schema || !subAccountId) return res.status(400).json({ error: "schema and subAccountId are required" });

    const entry = saveSchemaForAccount(subAccountId, schema);
    return res.json({ id: entry.id, savedAt: entry.savedAt });
  }));

  /** Publish/unpublish a schema — triggers discoverability file updates */
  app.patch("/api/dynamic-pages/schemas/:schemaId/publish", guard, asyncHandler(async (req: Request, res: Response) => {
    const { schemaId } = req.params;
    const { subAccountId, published } = req.body as { subAccountId?: number; published?: boolean };
    if (!subAccountId) return res.status(400).json({ error: "subAccountId required" });

    const schemas = schemaStore.get(subAccountId) ?? [];
    const entry = schemas.find(s => s.id === schemaId);
    if (!entry) return res.status(404).json({ error: "Schema not found" });

    entry.published = !!published;
    entry.schema.publish = { ...entry.schema.publish, published: !!published, publishedAt: published ? new Date().toISOString() : undefined };
    schemaStore.set(subAccountId, schemas);

    return res.json({ id: schemaId, published: entry.published });
  }));

  /** Delete a schema */
  app.delete("/api/dynamic-pages/schemas/:schemaId", guard, asyncHandler(async (req: Request, res: Response) => {
    const { schemaId } = req.params;
    const subAccountId = getSubAccountId(req);
    if (!subAccountId) return res.status(400).json({ error: "subAccountId required" });

    const schemas = schemaStore.get(subAccountId) ?? [];
    const next = schemas.filter(s => s.id !== schemaId);
    schemaStore.set(subAccountId, next);
    return res.json({ deleted: true });
  }));

  // ── Discoverability endpoints ─────────────────────────────────────────────

  /** robots.txt — per tenant domain */
  app.get("/robots.txt", (req: Request, res: Response) => {
    const origin = getOrigin(req);
    const sitemapUrl = `${origin}/sitemap.xml`;
    const txt = generateRobotsTxt({ sitemapUrl, allowedPaths: ["/"] });
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(txt);
  });

  /** sitemap.xml — only published pages for this tenant */
  app.get("/sitemap.xml", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = getSubAccountId(req);
    const origin = getOrigin(req);
    const published = subAccountId ? getPublishedPages(subAccountId) : [];

    const entries = buildSitemapEntries(
      published.map(s => ({
        url: s.schema?.publish?.canonicalUrl ?? `${origin}/${s.schema?.meta?.slug ?? s.id}`,
        publishedAt: s.schema?.publish?.publishedAt,
        slug: s.schema?.meta?.slug ?? s.id,
      }))
    );

    // Always include home
    entries.unshift({ url: origin, lastmod: new Date().toISOString().split("T")[0], changefreq: "daily", priority: 1.0 });

    const xml = generateSitemapXml(entries);
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(xml);
  }));

  /** llms.txt — per tenant, only published pages */
  app.get("/llms.txt", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = getSubAccountId(req);
    const origin = getOrigin(req);
    const host = req.headers.host ?? "apex.app";
    const published = subAccountId ? getPublishedPages(subAccountId) : [];

    const txt = generateTenantLlmsTxt({
      organizationName: host.split(".")[0] ?? "Apex Business",
      organizationUrl: origin,
      publishedPages: published.map(s => ({
        title: s.schema?.meta?.title ?? "Page",
        slug: s.schema?.meta?.slug ?? s.id,
        niche: s.schema?.meta?.niche ?? "general",
        businessType: s.schema?.meta?.businessType ?? "business",
        copy: s.schema?.copy,
        publish: s.schema?.publish ?? { published: true },
      })),
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=1800");
    return res.send(txt);
  }));

  /** JSON-LD structured data for a specific page */
  app.get("/api/dynamic-pages/schemas/:schemaId/structured-data", asyncHandler(async (req: Request, res: Response) => {
    const { schemaId } = req.params;
    const subAccountId = getSubAccountId(req);
    if (!subAccountId) return res.status(400).json({ error: "subAccountId required" });

    const schemas = getSchemasForAccount(subAccountId);
    const entry = schemas.find(s => s.id === schemaId);
    if (!entry) return res.status(404).json({ error: "Schema not found" });
    if (!entry.published) return res.status(403).json({ error: "Only published pages have structured data" });

    const origin = getOrigin(req);
    const schema = entry.schema;
    const structuredData = generateAllStructuredData({
      title: schema?.meta?.title ?? "Page",
      slug: schema?.meta?.slug ?? schemaId,
      url: schema?.publish?.canonicalUrl ?? `${origin}/${schema?.meta?.slug ?? schemaId}`,
      description: schema?.copy?.seoDescription ?? schema?.copy?.subheadline ?? "",
      niche: schema?.meta?.niche ?? "general",
      businessType: schema?.meta?.businessType ?? "business",
      headline: schema?.copy?.headline ?? "",
      subheadline: schema?.copy?.subheadline ?? "",
      sections: schema?.sections ?? [],
      publishedAt: schema?.publish?.publishedAt,
      organizationName: req.headers.host?.split(".")[0] ?? "Business",
      organizationUrl: origin,
    });

    return res.json({ structuredData });
  }));

  /** Admin: view all schemas across accounts */
  app.get("/api/dynamic-pages/admin/all", asyncHandler(async (req: Request, res: Response) => {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: "Admin only" });
    const all: any[] = [];
    for (const [subAccountId, schemas] of schemaStore.entries()) {
      all.push(...schemas.map(s => ({ ...s, subAccountId })));
    }
    return res.json({ schemas: all, total: all.length });
  }));
}
