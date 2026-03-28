import type { SharedCardData, SocialLink, CustomLink, Service, Testimonial } from "./types";

function safeArray<T>(val: unknown): T[] {
  return Array.isArray(val) ? val : [];
}

function safeTestimonial(val: unknown): Testimonial | null {
  if (val && typeof val === "object" && "quote" in val && typeof (val as any).quote === "string") {
    return val as Testimonial;
  }
  return null;
}

function safeSocialLinks(val: unknown): SocialLink[] {
  return safeArray(val)
    .filter(
      (s: any) => s && typeof s === "object" && typeof s.url === "string" && s.url.length > 0
    )
    .map((s: any) => ({
      label: String(s.label || "Link"),
      url: String(s.url),
      icon: s.icon || undefined,
      platform: s.platform || s.label?.toLowerCase() || undefined,
    }));
}

function safeCustomLinks(val: unknown): CustomLink[] {
  return safeArray(val)
    .filter(
      (l: any) => l && typeof l === "object" && typeof l.url === "string" && l.url.length > 0
    )
    .map((l: any) => ({
      label: String(l.label || "Link"),
      url: String(l.url),
      type: l.type || undefined,
    }));
}

function safeServices(val: unknown): Service[] {
  return safeArray(val)
    .filter(
      (s: any) => s && typeof s === "object" && typeof s.label === "string" && s.label.length > 0
    )
    .map((s: any) => ({
      label: String(s.label),
      description: s.description ? String(s.description) : undefined,
      icon: s.icon || undefined,
      color: s.color || undefined,
    }));
}

export function adaptPlatformCard(raw: any): SharedCardData {
  return {
    id: raw.id,
    slug: raw.slug || "",
    name: raw.name || "",
    preferredName: raw.preferredName || undefined,
    title: raw.title || undefined,
    company: raw.company || undefined,
    phone: raw.phone || undefined,
    email: raw.email || undefined,
    website: raw.website || undefined,
    bio: raw.bio || undefined,
    photoUrl: raw.photoUrl || undefined,
    coverImageUrl: raw.coverImageUrl || undefined,
    logoUrl: raw.logoImageUrl || undefined,
    location: raw.location || undefined,
    tagline: raw.tagline || undefined,
    brandColor: raw.brandColor || "#6366f1",
    accentColor: raw.accentColor || "#8b5cf6",
    theme: raw.theme || "executive-dark",
    bookingUrl: raw.bookingUrl || undefined,
    calendarUrl: raw.calendarUrl || undefined,
    reviewLink: raw.googleReviewLink || undefined,
    socialLinks: safeSocialLinks(raw.socialLinks),
    links: safeCustomLinks(raw.links),
    services: safeServices(raw.services),
    testimonial: safeTestimonial(raw.testimonial),
  };
}

export function adaptStandaloneCard(raw: any): SharedCardData {
  const socialLinks: SocialLink[] = [];
  if (raw.instagramUrl) socialLinks.push({ label: "Instagram", url: raw.instagramUrl, platform: "instagram" });
  if (raw.facebookUrl) socialLinks.push({ label: "Facebook", url: raw.facebookUrl, platform: "facebook" });
  if (raw.tiktokUrl) socialLinks.push({ label: "TikTok", url: raw.tiktokUrl, platform: "tiktok" });
  if (raw.linkedinUrl) socialLinks.push({ label: "LinkedIn", url: raw.linkedinUrl, platform: "linkedin" });
  if (raw.youtubeUrl) socialLinks.push({ label: "YouTube", url: raw.youtubeUrl, platform: "youtube" });

  const customLinks = safeCustomLinks(raw.customLinks);

  return {
    id: raw.id,
    slug: raw.slug || "",
    name: raw.fullName || "",
    title: raw.title || undefined,
    company: raw.businessName || undefined,
    phone: raw.phone || undefined,
    email: raw.email || undefined,
    website: raw.website || undefined,
    bio: raw.bio || undefined,
    photoUrl: raw.profileImageUrl || undefined,
    logoUrl: raw.logoUrl || undefined,
    location: raw.address || undefined,
    brandColor: raw.themeColor || "#0ea5e9",
    accentColor: raw.themeColor || "#0ea5e9",
    theme: raw.cardTheme || "executive-dark",
    bookingUrl: raw.bookingLink || undefined,
    reviewLink: raw.reviewLink || undefined,
    socialLinks,
    links: customLinks,
    services: [],
    testimonial: null,
  };
}
