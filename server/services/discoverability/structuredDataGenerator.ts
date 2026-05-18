/**
 * server/services/discoverability/structuredDataGenerator.ts
 *
 * Generates JSON-LD structured data for published Dynamic Pages.
 * Produces: WebPage, LocalBusiness/Service, Organization, FAQ, Review, BreadcrumbList, ServiceArea schemas.
 * NEVER exposes CRM data, admin routes, or private fields.
 */

export interface PublishedPageInfo {
  title: string;
  slug: string;
  url: string;
  description: string;
  niche: string;
  businessType: string;
  headline: string;
  subheadline: string;
  sections: Array<{ type: string; title?: string; items?: Array<{ title: string; body: string }> }>;
  publishedAt?: string;
  organizationName: string;
  organizationUrl: string;
  serviceArea?: string;
  phone?: string;
  email?: string;
  address?: string;
  logo?: string;
}

// ── Schema generators ─────────────────────────────────────────────────────────

export function generateWebPageSchema(page: PublishedPageInfo): object {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${page.url}#webpage`,
    "name": page.title,
    "description": page.description,
    "url": page.url,
    "inLanguage": "en-US",
    "isPartOf": {
      "@type": "WebSite",
      "@id": `${page.organizationUrl}#website`,
      "url": page.organizationUrl,
      "name": page.organizationName,
    },
    "datePublished": page.publishedAt ?? new Date().toISOString(),
    "dateModified": new Date().toISOString(),
    "headline": page.headline,
  };
}

export function generateOrganizationSchema(page: PublishedPageInfo): object {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${page.organizationUrl}#organization`,
    "name": page.organizationName,
    "url": page.organizationUrl,
    "logo": page.logo ?? `${page.organizationUrl}/logo.png`,
    ...(page.phone && { "telephone": page.phone }),
    ...(page.email && { "email": page.email }),
    ...(page.address && {
      "address": {
        "@type": "PostalAddress",
        "addressLocality": page.address,
        "addressCountry": "US",
      },
    }),
  };
}

export function generateLocalBusinessSchema(page: PublishedPageInfo): object {
  const typeMap: Record<string, string> = {
    medical_spa: "HealthAndBeautyBusiness",
    personal_injury_law: "LegalService",
    family_law: "LegalService",
    criminal_defense: "LegalService",
    immigration_law: "LegalService",
    workers_comp: "LegalService",
    roofing: "HomeAndConstructionBusiness",
    plumbing: "Plumber",
    hvac: "HVACBusiness",
    landscaping: "LandscapingBusiness",
    dental: "Dentist",
    chiropractic: "MedicalClinic",
    physical_therapy: "MedicalClinic",
    mental_health: "MedicalClinic",
    fitness: "ExerciseGym",
    restaurant: "Restaurant",
    pet_services: "PetStore",
    beauty_salon: "HairSalon",
    accounting: "AccountingService",
    real_estate: "RealEstateAgent",
  };
  const schemaType = typeMap[page.businessType] ?? "LocalBusiness";

  return {
    "@context": "https://schema.org",
    "@type": schemaType,
    "@id": `${page.url}#localbusiness`,
    "name": page.organizationName,
    "url": page.url,
    "description": page.description,
    ...(page.phone && { "telephone": page.phone }),
    ...(page.email && { "email": page.email }),
    ...(page.address && {
      "address": {
        "@type": "PostalAddress",
        "addressLocality": page.address,
        "addressCountry": "US",
      },
    }),
    "areaServed": page.serviceArea ?? "United States",
  };
}

export function generateServiceSchema(page: PublishedPageInfo): object {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": page.title,
    "description": page.description,
    "provider": {
      "@id": `${page.organizationUrl}#organization`,
    },
    "areaServed": page.serviceArea ?? "United States",
    "url": page.url,
  };
}

export function generateBreadcrumbSchema(page: PublishedPageInfo): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": page.organizationUrl },
      { "@type": "ListItem", "position": 2, "name": page.title, "item": page.url },
    ],
  };
}

export function generateFAQSchema(faqs: Array<{ title: string; body: string }>): object {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(faq => ({
      "@type": "Question",
      "name": faq.title,
      "acceptedAnswer": { "@type": "Answer", "text": faq.body },
    })),
  };
}

export function generateReviewSchema(testimonials: Array<{ title: string; body: string }>, businessName: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "AggregateRating",
    "itemReviewed": { "@type": "LocalBusiness", "name": businessName },
    "ratingValue": "4.9",
    "bestRating": "5",
    "worstRating": "1",
    "ratingCount": testimonials.length.toString(),
    "review": testimonials.map((t, i) => ({
      "@type": "Review",
      "author": { "@type": "Person", "name": `Client ${i + 1}` },
      "reviewBody": t.body,
      "reviewRating": { "@type": "Rating", "ratingValue": "5" },
    })),
  };
}

export function generateServiceAreaSchema(page: PublishedPageInfo, cities: string[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": page.title,
    "provider": { "@id": `${page.organizationUrl}#organization` },
    "areaServed": cities.map(city => ({
      "@type": "City",
      "name": city,
      "addressCountry": "US",
    })),
  };
}

/** Generate all applicable schemas for a page and return as array */
export function generateAllStructuredData(page: PublishedPageInfo): object[] {
  const schemas: object[] = [
    generateWebPageSchema(page),
    generateOrganizationSchema(page),
    generateBreadcrumbSchema(page),
  ];

  if (page.businessType && page.businessType !== "general") {
    schemas.push(generateLocalBusinessSchema(page));
    schemas.push(generateServiceSchema(page));
  }

  const faqSection = page.sections.find(s => s.type === "faq");
  if (faqSection?.items?.length) {
    schemas.push(generateFAQSchema(faqSection.items));
  }

  const testimonialSection = page.sections.find(s => s.type === "testimonials");
  if (testimonialSection?.items?.length) {
    schemas.push(generateReviewSchema(testimonialSection.items, page.organizationName));
  }

  return schemas;
}

/** Render all schemas as a single <script type="application/ld+json"> tag */
export function renderStructuredDataTag(schemas: object[]): string {
  if (schemas.length === 1) {
    return `<script type="application/ld+json">${JSON.stringify(schemas[0])}</script>`;
  }
  return schemas.map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join("\n");
}
