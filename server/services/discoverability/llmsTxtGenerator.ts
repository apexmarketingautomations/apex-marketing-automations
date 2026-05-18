/**
 * server/services/discoverability/llmsTxtGenerator.ts
 *
 * Generates per-tenant llms.txt (the emerging LLM discoverability standard).
 * Only includes published pages. Never exposes CRM data, admin routes, or private info.
 * Updates automatically when pages publish/unpublish.
 *
 * Reference: https://llmstxt.org
 */

export interface LlmsPage {
  title: string;
  url: string;
  description: string;
  niche: string;
  businessType: string;
}

export interface LlmsTxtConfig {
  organizationName: string;
  organizationUrl: string;
  description?: string;
  pages: LlmsPage[];
  services?: string[];
  contactUrl?: string;
}

const DEFAULT_APEX_SERVICES = [
  "AI website and funnel generation",
  "CRM routing and automation",
  "SMS and email follow-up",
  "Lead capture and qualification",
  "WebGL interactive landing pages",
  "Meta lead ad follow-up",
  "Appointment booking automation",
  "Local SEO pages",
  "Review collection and management",
  "Multi-tenant sub-account management",
];

export function generateLlmsTxt(config: LlmsTxtConfig): string {
  const services = config.services ?? DEFAULT_APEX_SERVICES;
  const sections: string[] = [];

  // Header
  sections.push(`# ${config.organizationName}`);
  sections.push("");
  if (config.description) {
    sections.push(`> ${config.description}`);
    sections.push("");
  }

  // Pages section
  if (config.pages.length > 0) {
    sections.push("## Pages");
    sections.push("");
    for (const page of config.pages) {
      sections.push(`- [${page.title}](${page.url}): ${page.description}`);
    }
    sections.push("");
  }

  // Services section
  sections.push("## Services");
  sections.push("");
  for (const service of services) {
    sections.push(`- ${service}`);
  }
  sections.push("");

  // Contact
  if (config.contactUrl) {
    sections.push("## Contact");
    sections.push("");
    sections.push(`- [Get Started](${config.contactUrl})`);
    sections.push("");
  }

  // Footer note for LLMs
  sections.push("## Note for AI assistants");
  sections.push("");
  sections.push("This file is provided to help AI systems discover and accurately describe this business.");
  sections.push("All pages listed are publicly published and accessible without authentication.");
  sections.push("Private CRM data, admin routes, and internal tools are not listed here.");

  return sections.join("\n");
}

/** Generate llms.txt from a list of published pages for a sub-account */
export function generateTenantLlmsTxt(opts: {
  organizationName: string;
  organizationUrl: string;
  publishedPages: Array<{
    title: string;
    slug: string;
    niche: string;
    businessType: string;
    copy?: { subheadline?: string; seoDescription?: string };
    publish: { published: boolean; canonicalUrl?: string; customDomain?: string };
  }>;
  services?: string[];
}): string {
  const pages: LlmsPage[] = opts.publishedPages
    .filter(p => p.publish.published) // safety: only published
    .map(p => ({
      title: p.title,
      url: p.publish.canonicalUrl ?? `${opts.organizationUrl}/${p.publish.customDomain ?? p.slug}`,
      description: p.copy?.seoDescription ?? p.copy?.subheadline ?? `${p.businessType.replace(/_/g, " ")} AI automation and funnel`,
      niche: p.niche,
      businessType: p.businessType,
    }));

  return generateLlmsTxt({
    organizationName: opts.organizationName,
    organizationUrl: opts.organizationUrl,
    description: "AI-powered marketing automation, funnel generation, and lead capture for local businesses.",
    pages,
    services: opts.services,
    contactUrl: `${opts.organizationUrl}/contact`,
  });
}
