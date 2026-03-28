export interface SocialLink {
  label: string;
  url: string;
  icon?: string;
  platform?: string;
}

export interface CustomLink {
  label: string;
  url: string;
  type?: string;
}

export interface Service {
  label: string;
  description?: string;
  icon?: string;
  color?: string;
}

export interface Testimonial {
  quote: string;
  author: string;
  role?: string;
}

export interface SharedCardData {
  id: number;
  slug: string;
  name: string;
  preferredName?: string;
  title?: string;
  company?: string;
  phone?: string;
  email?: string;
  website?: string;
  bio?: string;
  photoUrl?: string;
  coverImageUrl?: string;
  logoUrl?: string;
  location?: string;
  tagline?: string;
  brandColor: string;
  accentColor: string;
  theme: string;
  bookingUrl?: string;
  calendarUrl?: string;
  reviewLink?: string;
  socialLinks: SocialLink[];
  links: CustomLink[];
  services: Service[];
  testimonial: Testimonial | null;
}

export type CardSource = "platform" | "standalone";

export type CardTier = "base" | "premium" | "pro";

export interface CardRenderConfig {
  source: CardSource;
  tier?: CardTier;
  showBranding: boolean;
  referralUrl?: string;
  cardUrl: string;
  trackEvent?: (eventType: string, eventTarget?: string) => void;
}
