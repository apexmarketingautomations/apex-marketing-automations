/**
 * server/services/discoverability/metadataGenerator.ts
 *
 * Generates OpenGraph, Twitter/X Card, and canonical URL metadata for published pages.
 */

export interface PageMetadata {
  title: string;
  description: string;
  url: string;
  image?: string;
  siteName: string;
  locale?: string;
  publishedAt?: string;
  author?: string;
  twitterHandle?: string;
  type?: "website" | "article";
}

export function generateOpenGraphTags(meta: PageMetadata): string {
  const tags: string[] = [
    `<meta property="og:type" content="${meta.type ?? "website"}" />`,
    `<meta property="og:title" content="${escapeAttr(meta.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(meta.description)}" />`,
    `<meta property="og:url" content="${escapeAttr(meta.url)}" />`,
    `<meta property="og:site_name" content="${escapeAttr(meta.siteName)}" />`,
    `<meta property="og:locale" content="${meta.locale ?? "en_US"}" />`,
  ];
  if (meta.image) tags.push(`<meta property="og:image" content="${escapeAttr(meta.image)}" />`);
  if (meta.publishedAt) tags.push(`<meta property="article:published_time" content="${meta.publishedAt}" />`);
  return tags.join("\n");
}

export function generateTwitterCardTags(meta: PageMetadata): string {
  const tags: string[] = [
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${escapeAttr(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(meta.description)}" />`,
  ];
  if (meta.image) tags.push(`<meta name="twitter:image" content="${escapeAttr(meta.image)}" />`);
  if (meta.twitterHandle) tags.push(`<meta name="twitter:site" content="${escapeAttr(meta.twitterHandle)}" />`);
  return tags.join("\n");
}

export function generateCanonicalTag(url: string): string {
  return `<link rel="canonical" href="${escapeAttr(url)}" />`;
}

export function generateSEOMetaTags(meta: { title: string; description: string; robots?: string }): string {
  const robots = meta.robots ?? "index, follow";
  return [
    `<meta name="description" content="${escapeAttr(meta.description)}" />`,
    `<meta name="robots" content="${robots}" />`,
  ].join("\n");
}

/** Generate all head tags for a published page */
export function generateAllMetaTags(meta: PageMetadata): string {
  return [
    `<title>${escapeHtml(meta.title)}</title>`,
    generateSEOMetaTags(meta),
    generateCanonicalTag(meta.url),
    generateOpenGraphTags(meta),
    generateTwitterCardTags(meta),
  ].join("\n");
}

/** Returns an object safe to inject into React Helmet / document.head */
export function generateMetaObject(meta: PageMetadata): Record<string, string> {
  return {
    title: meta.title,
    description: meta.description,
    canonical: meta.url,
    "og:title": meta.title,
    "og:description": meta.description,
    "og:url": meta.url,
    "og:type": meta.type ?? "website",
    "og:site_name": meta.siteName,
    "twitter:card": meta.image ? "summary_large_image" : "summary",
    "twitter:title": meta.title,
    "twitter:description": meta.description,
    ...(meta.image && { "og:image": meta.image, "twitter:image": meta.image }),
    ...(meta.twitterHandle && { "twitter:site": meta.twitterHandle }),
  };
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
