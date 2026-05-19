/**
 * server/routes/dynamicPages.ts
 *
 * API routes for the Apex Dynamic Pages prompt-driven builder.
 * All schemas are persisted to the `dynamic_page_schemas` DB table.
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { dynamicPageSchemas } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { generatePageSchema, patchExistingPageSchema, generateScenePlan } from "../services/aiPromptToPageSchema";
import { aiGenerateImage } from "../aiGateway";
import { isPlatformAdmin } from "../auth/authorization";
import { requireActiveSubscription } from "../subscriptionGuard";
import { asyncHandler } from "./helpers";
import { generateAllStructuredData } from "../services/discoverability/structuredDataGenerator";
import { generateTenantLlmsTxt } from "../services/discoverability/llmsTxtGenerator";
import { generateSitemapXml, buildSitemapEntries } from "../services/discoverability/sitemapGenerator";
import { generateRobotsTxt } from "../services/discoverability/robotsTxtGenerator";

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getSchemasForAccount(accountId: number) {
  return db
    .select()
    .from(dynamicPageSchemas)
    .where(eq(dynamicPageSchemas.accountId, accountId))
    .orderBy(desc(dynamicPageSchemas.updatedAt));
}

async function getPublishedPages(accountId: number) {
  return db
    .select()
    .from(dynamicPageSchemas)
    .where(and(eq(dynamicPageSchemas.accountId, accountId), eq(dynamicPageSchemas.status, "published")))
    .orderBy(desc(dynamicPageSchemas.publishedAt));
}

async function upsertSchema(accountId: number, schema: any, userId?: number) {
  const schemaId: number | undefined = schema._dbId ? Number(schema._dbId) : undefined;
  const slug = schema.meta?.slug ?? "";
  const title = schema.meta?.title ?? "Untitled";
  const niche = schema.meta?.niche ?? "general";
  const isPublished = schema.publish?.published === true;
  const status = isPublished ? "published" : "draft";
  const publishedAt = isPublished ? (schema.publish?.publishedAt ? new Date(schema.publish.publishedAt) : new Date()) : null;

  if (schemaId) {
    const [updated] = await db
      .update(dynamicPageSchemas)
      .set({
        slug,
        title,
        niche,
        status,
        schemaJson: schema,
        publishedAt,
        updatedAt: new Date(),
        isPublic: isPublished,
      })
      .where(and(eq(dynamicPageSchemas.id, schemaId), eq(dynamicPageSchemas.accountId, accountId)))
      .returning();
    return updated;
  }

  const [inserted] = await db
    .insert(dynamicPageSchemas)
    .values({
      accountId,
      createdByUserId: userId ?? null,
      slug,
      title,
      niche,
      status,
      schemaJson: schema,
      publishedAt,
      isPublic: isPublished,
    })
    .returning();
  return inserted;
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
    const { prompt, subAccountId, imageUrl, generationMode } = req.body as {
      prompt?: string; subAccountId?: number; imageUrl?: string;
      generationMode?: "apex-fast" | "stitch-style" | "stitch-import";
    };
    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return res.status(400).json({ error: "prompt is required (min 3 chars)" });
    }

    const sanitized = prompt.trim().slice(0, 2000).replace(/<[^>]*>/g, "");
    const cleanImageUrl = typeof imageUrl === "string" && imageUrl.startsWith("http") ? imageUrl : undefined;
    const mode = generationMode === "apex-fast" ? "apex-fast" : "stitch-style";

    const schema = await generatePageSchema(sanitized, subAccountId, cleanImageUrl, mode);
    return res.json({ schema });
  }));

  /** Generate only the WebGL scene plan from a prompt */
  app.post("/api/dynamic-pages/generate-scene", guard, asyncHandler(async (req: Request, res: Response) => {
    const { prompt } = req.body as { prompt?: string };
    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return res.status(400).json({ error: "prompt is required (min 3 chars)" });
    }
    const sanitized = prompt.trim().slice(0, 2000).replace(/<[^>]*>/g, "");
    const scene = await generateScenePlan(sanitized);
    return res.json({ scene });
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
    const accountId = parseInt(String(req.params.subAccountId), 10);
    if (isNaN(accountId)) return res.status(400).json({ error: "Invalid subAccountId" });

    const rows = await getSchemasForAccount(accountId);
    const schemas = rows.map(r => ({
      id: r.id,
      savedAt: r.updatedAt,
      published: r.status === "published",
      title: r.title,
      slug: r.slug,
      niche: r.niche,
      status: r.status,
    }));
    return res.json({ schemas });
  }));

  /** Save (upsert) a schema */
  app.post("/api/dynamic-pages/schemas", guard, asyncHandler(async (req: Request, res: Response) => {
    const { schema, subAccountId } = req.body as { schema?: any; subAccountId?: number };
    if (!schema || !subAccountId) return res.status(400).json({ error: "schema and subAccountId are required" });

    const userId = (req as any).user?.id ?? undefined;
    const entry = await upsertSchema(Number(subAccountId), schema, userId);
    return res.json({ id: entry.id, savedAt: entry.updatedAt });
  }));

  /** Publish/unpublish a schema */
  app.patch("/api/dynamic-pages/schemas/:schemaId/publish", guard, asyncHandler(async (req: Request, res: Response) => {
    const schemaId = parseInt(String(req.params.schemaId), 10);
    if (isNaN(schemaId)) return res.status(400).json({ error: "Invalid schemaId" });

    const { subAccountId, published } = req.body as { subAccountId?: number; published?: boolean };
    if (!subAccountId) return res.status(400).json({ error: "subAccountId required" });

    const [existing] = await db
      .select()
      .from(dynamicPageSchemas)
      .where(and(eq(dynamicPageSchemas.id, schemaId), eq(dynamicPageSchemas.accountId, Number(subAccountId))));
    if (!existing) return res.status(404).json({ error: "Schema not found" });

    const isPublished = !!published;
    const schemaJson = { ...(existing.schemaJson as any), publish: { ...(existing.schemaJson as any)?.publish, published: isPublished, publishedAt: isPublished ? new Date().toISOString() : undefined } };

    await db
      .update(dynamicPageSchemas)
      .set({
        status: isPublished ? "published" : "draft",
        publishedAt: isPublished ? new Date() : null,
        isPublic: isPublished,
        schemaJson,
        updatedAt: new Date(),
      })
      .where(eq(dynamicPageSchemas.id, schemaId));

    return res.json({ id: schemaId, published: isPublished });
  }));

  /** Delete a schema */
  app.delete("/api/dynamic-pages/schemas/:schemaId", guard, asyncHandler(async (req: Request, res: Response) => {
    const schemaId = parseInt(String(req.params.schemaId), 10);
    if (isNaN(schemaId)) return res.status(400).json({ error: "Invalid schemaId" });

    const subAccountId = getSubAccountId(req);
    if (!subAccountId) return res.status(400).json({ error: "subAccountId required" });

    await db
      .delete(dynamicPageSchemas)
      .where(and(eq(dynamicPageSchemas.id, schemaId), eq(dynamicPageSchemas.accountId, subAccountId)));
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
    const published = subAccountId ? await getPublishedPages(subAccountId) : [];

    const entries = buildSitemapEntries(
      published.map(s => ({
        url: (s.schemaJson as any)?.publish?.canonicalUrl ?? `${origin}/${s.slug || s.id}`,
        publishedAt: s.publishedAt?.toISOString(),
        slug: s.slug || String(s.id),
      }))
    );

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
    const host = String(req.headers.host ?? "apex.app");
    const published = subAccountId ? await getPublishedPages(subAccountId) : [];

    const txt = generateTenantLlmsTxt({
      organizationName: host.split(".")[0] ?? "Apex Business",
      organizationUrl: origin,
      publishedPages: published.map(s => {
        const sj = s.schemaJson as any;
        return {
          title: s.title,
          slug: s.slug || String(s.id),
          niche: s.niche,
          businessType: sj?.meta?.businessType ?? "business",
          copy: sj?.copy,
          publish: sj?.publish ?? { published: true },
        };
      }),
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=1800");
    return res.send(txt);
  }));

  /** JSON-LD structured data for a specific published page */
  app.get("/api/dynamic-pages/schemas/:schemaId/structured-data", asyncHandler(async (req: Request, res: Response) => {
    const schemaId = parseInt(String(req.params.schemaId), 10);
    if (isNaN(schemaId)) return res.status(400).json({ error: "Invalid schemaId" });

    const subAccountId = getSubAccountId(req);
    if (!subAccountId) return res.status(400).json({ error: "subAccountId required" });

    const [entry] = await db
      .select()
      .from(dynamicPageSchemas)
      .where(and(eq(dynamicPageSchemas.id, schemaId), eq(dynamicPageSchemas.accountId, subAccountId)));
    if (!entry) return res.status(404).json({ error: "Schema not found" });
    if (entry.status !== "published") return res.status(403).json({ error: "Only published pages have structured data" });

    const origin = getOrigin(req);
    const sj = entry.schemaJson as any;
    const structuredData = generateAllStructuredData({
      title: entry.title,
      slug: entry.slug || String(schemaId),
      url: sj?.publish?.canonicalUrl ?? `${origin}/${entry.slug || schemaId}`,
      description: sj?.copy?.seoDescription ?? sj?.copy?.subheadline ?? "",
      niche: entry.niche,
      businessType: sj?.meta?.businessType ?? "business",
      headline: sj?.copy?.headline ?? "",
      subheadline: sj?.copy?.subheadline ?? "",
      sections: sj?.sections ?? [],
      publishedAt: entry.publishedAt?.toISOString(),
      organizationName: String(req.headers.host ?? "").split(".")[0] ?? "Business",
      organizationUrl: origin,
    });

    return res.json({ structuredData });
  }));

  /** Generate a standalone AI image for a Dynamic Page (hero backdrop, section photo) */
  app.post("/api/dynamic-pages/generate-image", guard, asyncHandler(async (req: Request, res: Response) => {
    const { prompt, niche, businessType, style } = req.body as {
      prompt?: string; niche?: string; businessType?: string; style?: string;
    };
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }

    const styleDescriptions: Record<string, string> = {
      luxury: "ultra-luxury, cinematic lighting, editorial photography, gold accents",
      dark: "dark dramatic aesthetic, moody shadows, professional photography",
      warm: "warm inviting tones, natural light, lifestyle photography",
      energetic: "dynamic energy, vibrant, action photography, bold composition",
      tech: "sleek technology, blue-purple lighting, futuristic studio photography",
      bold: "high contrast, dramatic, commercial photography",
      clean: "bright, clean, professional, trust-inspiring",
      nature: "lush natural environment, fresh outdoor photography",
      neon: "neon lights, dark background, electric nightlife atmosphere",
    };

    const styleDesc = styleDescriptions[style ?? ""] ?? "professional, high-quality, commercial photography";
    const niceName = (businessType ?? niche ?? "business").replace(/_/g, " ");
    const imagePrompt = `Professional ${niceName} marketing hero image. ${prompt.trim().slice(0, 300)}. ${styleDesc}. Photorealistic, 8K, no text or logos, centered composition for a website hero.`;

    const imageUrl = await aiGenerateImage(imagePrompt);
    if (!imageUrl) {
      return res.status(503).json({ error: "Image generation unavailable", imageUrl: null });
    }
    return res.json({ imageUrl });
  }));

  /** Admin: view all schemas across accounts */
  app.get("/api/dynamic-pages/admin/all", asyncHandler(async (req: Request, res: Response) => {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: "Admin only" });
    const all = await db.select().from(dynamicPageSchemas).orderBy(desc(dynamicPageSchemas.updatedAt));
    return res.json({ schemas: all, total: all.length });
  }));
}
