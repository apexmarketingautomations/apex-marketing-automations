/**
 * server/services/discoverability/robotsTxtGenerator.ts
 *
 * Generates tenant-isolated robots.txt.
 * Blocks admin routes, unpublished pages, CRM endpoints.
 * Exposes only public published pages.
 */

export interface RobotsTxtConfig {
  sitemapUrl: string;
  allowedPaths?: string[];
  /** Additional paths to always block (in addition to defaults) */
  extraDisallowed?: string[];
}

const ALWAYS_BLOCKED = [
  "/api/",
  "/admin/",
  "/internal/",
  "/_internal/",
  "/webhooks/",
  "/auth/",
  "/crm/",
  "/dashboard/",
  "/settings/",
  "/accounts/",
  "/operator/",
  "/*.json$",
];

export function generateRobotsTxt(config: RobotsTxtConfig): string {
  const disallowed = [...ALWAYS_BLOCKED, ...(config.extraDisallowed ?? [])];
  const allowed = config.allowedPaths ?? ["/"];

  const lines: string[] = [
    "User-agent: *",
    ...allowed.map(p => `Allow: ${p}`),
    ...disallowed.map(p => `Disallow: ${p}`),
    "",
    "# LLM crawlers — allow public pages",
    "User-agent: GPTBot",
    ...allowed.map(p => `Allow: ${p}`),
    ...disallowed.map(p => `Disallow: ${p}`),
    "",
    "User-agent: Claude-Web",
    ...allowed.map(p => `Allow: ${p}`),
    ...disallowed.map(p => `Disallow: ${p}`),
    "",
    "User-agent: PerplexityBot",
    ...allowed.map(p => `Allow: ${p}`),
    ...disallowed.map(p => `Disallow: ${p}`),
    "",
    `Sitemap: ${config.sitemapUrl}`,
  ];

  return lines.join("\n");
}
