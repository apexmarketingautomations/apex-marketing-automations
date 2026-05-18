/**
 * server/services/discoverability/sitemapGenerator.ts
 *
 * Generates tenant-isolated sitemap.xml for published Dynamic Pages.
 * Only includes published pages. Never exposes admin routes or private data.
 */

export interface SitemapEntry {
  url: string;
  lastmod: string;
  changefreq: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority: number;
}

export function generateSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map(e => `  <url>
    <loc>${escapeXml(e.url)}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority.toFixed(1)}</priority>
  </url>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

/** Build sitemap entries from a list of published pages */
export function buildSitemapEntries(pages: Array<{
  url: string;
  publishedAt?: string;
  slug: string;
}>): SitemapEntry[] {
  return pages.map(p => ({
    url: p.url,
    lastmod: p.publishedAt ? new Date(p.publishedAt).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
    changefreq: "weekly",
    priority: p.slug === "/" ? 1.0 : 0.8,
  }));
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
