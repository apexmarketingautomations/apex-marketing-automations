import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, Mail, Globe, Download, MessageSquare, QrCode, ChevronDown,
  ArrowUpRight, Star, MapPin, Calendar, Share2, Copy, Check, X,
  Palette, Code2, Megaphone, Bot, Mic, Workflow, BarChart3, Smartphone,
  Shield, ExternalLink, Briefcase, Sparkles, Play, Link2, AlertCircle, Loader2
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { downloadVCard } from "@/lib/vcard";

const ICON_MAP: Record<string, any> = {
  palette: Palette, code: Code2, globe: Globe, megaphone: Megaphone,
  bot: Bot, mic: Mic, workflow: Workflow, analytics: BarChart3,
  sms: Smartphone, shield: Shield, briefcase: Briefcase, sparkles: Sparkles,
  play: Play, star: Star, phone: Phone, mail: Mail, calendar: Calendar,
  download: Download, link: Link2, external: ExternalLink,
};

const THEMES: Record<string, {
  bg: string; cardBg: string; text: string; muted: string; accent: string;
  border: string; glass: string; heroOverlay: string; ctaBg: string; isDark: boolean;
}> = {
  "executive-dark": {
    bg: "bg-[#0a0a0f]", cardBg: "bg-white/[0.04]", text: "text-white",
    muted: "text-slate-400", accent: "text-indigo-400",
    border: "border-white/[0.08]", glass: "backdrop-blur-xl bg-black/60",
    heroOverlay: "from-[#0a0a0f] via-[#0a0a0f]/60 to-transparent",
    ctaBg: "from-indigo-600 via-purple-600 to-fuchsia-600", isDark: true,
  },
  "luxury-dark": {
    bg: "bg-[#0d0d0d]", cardBg: "bg-white/[0.03]", text: "text-white",
    muted: "text-neutral-400", accent: "text-amber-400",
    border: "border-white/[0.06]", glass: "backdrop-blur-xl bg-black/70",
    heroOverlay: "from-[#0d0d0d] via-[#0d0d0d]/60 to-transparent",
    ctaBg: "from-amber-600 via-orange-600 to-red-600", isDark: true,
  },
  "clean-light": {
    bg: "bg-[#fafafa]", cardBg: "bg-white", text: "text-gray-900",
    muted: "text-gray-500", accent: "text-blue-600",
    border: "border-gray-200", glass: "backdrop-blur-xl bg-white/90",
    heroOverlay: "from-white via-white/60 to-transparent",
    ctaBg: "from-blue-600 via-indigo-600 to-violet-600", isDark: false,
  },
  "bold-agency": {
    bg: "bg-[#0f0f23]", cardBg: "bg-white/[0.05]", text: "text-white",
    muted: "text-slate-400", accent: "text-cyan-400",
    border: "border-cyan-500/20", glass: "backdrop-blur-xl bg-[#0f0f23]/80",
    heroOverlay: "from-[#0f0f23] via-[#0f0f23]/60 to-transparent",
    ctaBg: "from-cyan-500 via-blue-600 to-indigo-600", isDark: true,
  },
  "modern-gradient": {
    bg: "bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950", cardBg: "bg-white/[0.05]",
    text: "text-white", muted: "text-indigo-200/60", accent: "text-violet-400",
    border: "border-indigo-500/15", glass: "backdrop-blur-xl bg-indigo-950/60",
    heroOverlay: "from-slate-950 via-slate-950/60 to-transparent",
    ctaBg: "from-violet-600 via-purple-600 to-pink-600", isDark: true,
  },
  "minimal-neutral": {
    bg: "bg-[#f5f5f0]", cardBg: "bg-white", text: "text-stone-900",
    muted: "text-stone-500", accent: "text-stone-700",
    border: "border-stone-200", glass: "backdrop-blur-xl bg-[#f5f5f0]/95",
    heroOverlay: "from-[#f5f5f0] via-[#f5f5f0]/60 to-transparent",
    ctaBg: "from-stone-800 via-stone-700 to-stone-600", isDark: false,
  },
};

function getTheme(name?: string) {
  return THEMES[name || ""] || THEMES["executive-dark"];
}

type Theme = ReturnType<typeof getTheme>;

interface SocialLink { label: string; url: string; icon?: string }
interface CustomLink { label: string; url: string; type?: string }
interface Service { label: string; description?: string; icon?: string; color?: string }
interface Testimonial { quote: string; author: string; role?: string }

interface CardData {
  id: number;
  name: string;
  preferredName: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  bio: string;
  photoUrl: string;
  coverImageUrl: string;
  logoImageUrl: string;
  googleReviewLink: string;
  slug: string;
  brandColor: string;
  accentColor: string;
  theme: string;
  layoutVariant: string;
  bookingUrl: string;
  calendarUrl: string;
  location: string;
  tagline: string;
  socialLinks: SocialLink[];
  links: CustomLink[];
  services: Service[];
  testimonial: Testimonial | null;
  viewCount: number;
  saveContactCount: number;
  shareCount: number;
}

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
  return safeArray(val).filter(
    (s: any) => s && typeof s === "object" && typeof s.url === "string" && s.url.length > 0
  ).map((s: any) => ({ label: String(s.label || "Link"), url: String(s.url), icon: s.icon || undefined }));
}

function safeCustomLinks(val: unknown): CustomLink[] {
  return safeArray(val).filter(
    (l: any) => l && typeof l === "object" && typeof l.url === "string" && l.url.length > 0
  ).map((l: any) => ({ label: String(l.label || "Link"), url: String(l.url), type: l.type || undefined }));
}

function safeServices(val: unknown): Service[] {
  return safeArray(val).filter(
    (s: any) => s && typeof s === "object" && typeof s.label === "string" && s.label.length > 0
  ).map((s: any) => ({ label: String(s.label), description: s.description ? String(s.description) : undefined, icon: s.icon || undefined, color: s.color || undefined }));
}

function normalizeCard(raw: any): CardData {
  return {
    ...raw,
    socialLinks: safeSocialLinks(raw.socialLinks),
    links: safeCustomLinks(raw.links),
    services: safeServices(raw.services),
    testimonial: safeTestimonial(raw.testimonial),
  };
}

type FetchState = "loading" | "success" | "not-found" | "unavailable" | "error";

function useCardAnalytics(slug: string, active: boolean) {
  const tracked = useRef(false);
  const trackEvent = useCallback((eventType: string, eventTarget?: string) => {
    if (!active) return;
    const visitorId = localStorage.getItem("card_visitor_id") || crypto.randomUUID();
    localStorage.setItem("card_visitor_id", visitorId);
    fetch(`/api/public-card/${slug}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType,
        eventTarget,
        visitorId,
        userAgent: navigator.userAgent,
        referrer: document.referrer,
      }),
    }).catch(() => {});
  }, [slug, active]);

  useEffect(() => {
    if (!tracked.current && slug && active) {
      trackEvent("view");
      tracked.current = true;
    }
  }, [slug, active, trackEvent]);

  return trackEvent;
}

function CardLoading() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
        <Loader2 size={36} className="text-indigo-400 animate-spin mx-auto mb-4" />
        <p className="text-slate-500 text-sm font-medium">Loading card...</p>
      </motion.div>
    </div>
  );
}

function CardNotFound() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center p-8">
        <div className="w-20 h-20 rounded-full bg-white/[0.05] flex items-center justify-center mx-auto mb-6">
          <X size={32} className="text-slate-500" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2" data-testid="text-not-found">Card Not Found</h1>
        <p className="text-slate-400 text-sm max-w-xs mx-auto">This digital card doesn't exist or has been removed.</p>
      </motion.div>
    </div>
  );
}

function CardUnavailable() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center p-8">
        <div className="w-20 h-20 rounded-full bg-white/[0.05] flex items-center justify-center mx-auto mb-6">
          <Shield size={32} className="text-slate-500" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2" data-testid="text-unavailable">Card Unavailable</h1>
        <p className="text-slate-400 text-sm max-w-xs mx-auto">This card is currently private or has been deactivated by its owner.</p>
      </motion.div>
    </div>
  );
}

function CardError() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center p-8">
        <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-6">
          <AlertCircle size={32} className="text-red-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2" data-testid="text-error">Something Went Wrong</h1>
        <p className="text-slate-400 text-sm max-w-xs mx-auto">We couldn't load this card right now. Please try again later.</p>
        <button onClick={() => window.location.reload()}
          className="mt-6 px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-500 transition-colors"
          data-testid="button-retry">
          Try Again
        </button>
      </motion.div>
    </div>
  );
}

function HeroSection({ card, theme }: { card: CardData; theme: Theme }) {
  const displayName = card.preferredName || card.name;
  return (
    <div className="relative h-[55vh] min-h-[400px] max-h-[600px] overflow-hidden flex items-end">
      {card.photoUrl ? (
        <div className="absolute inset-0">
          <img src={card.photoUrl} alt={displayName} className="w-full h-full object-cover object-top" loading="eager" />
          <div className={`absolute inset-0 bg-gradient-to-t ${theme.heroOverlay}`} />
          {theme.isDark && <div className="absolute inset-0 bg-gradient-to-r from-indigo-900/20 to-purple-900/15" />}
        </div>
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${theme.ctaBg} opacity-20`} />
      )}

      <div className="relative z-10 p-8 pb-10 w-full">
        {card.tagline && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
            className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full ${theme.isDark ? "bg-white/10 border-white/20" : "bg-black/5 border-black/10"} backdrop-blur-md border mb-4`}>
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className={`text-[11px] font-bold ${theme.isDark ? "text-white/90" : "text-gray-700"} tracking-wider uppercase line-clamp-1`}>
              {card.tagline.length > 60 ? card.tagline.slice(0, 57) + "..." : card.tagline}
            </span>
          </motion.div>
        )}

        <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className={`text-4xl sm:text-5xl font-black ${theme.text} tracking-tight leading-[1.1]`} data-testid="text-card-name">
          {displayName}
        </motion.h1>

        {card.title && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
            className="flex items-center gap-3 mt-3">
            <div className="h-[2px] w-10 rounded-full" style={{ background: `linear-gradient(to right, ${card.brandColor || "#6366f1"}, ${card.accentColor || "#8b5cf6"})` }} />
            <p className="text-lg font-bold" style={{ background: `linear-gradient(to right, ${card.brandColor || "#6366f1"}, ${card.accentColor || "#8b5cf6"})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              {card.title}
            </p>
          </motion.div>
        )}

        {card.company && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
            className={`${theme.muted} text-sm mt-1 font-medium`} data-testid="text-company">
            {card.company}
          </motion.p>
        )}

        {card.location && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }}
            className={`${theme.muted} text-xs mt-2 flex items-center gap-1`} data-testid="text-location">
            <MapPin size={12} /> {card.location}
          </motion.p>
        )}

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }} className="flex justify-center mt-6">
          <ChevronDown size={20} className={`${theme.isDark ? "text-white/20" : "text-gray-300"} animate-bounce`} />
        </motion.div>
      </div>
    </div>
  );
}

function PrimaryActions({ card, theme, trackEvent }: { card: CardData; theme: Theme; trackEvent: (t: string, e?: string) => void }) {
  const actions = [
    card.phone && { icon: Phone, label: "Call", href: `tel:${card.phone}`, event: "click_phone", color: "bg-green-500/15 border-green-500/30 text-green-400" },
    card.phone && { icon: MessageSquare, label: "Text", href: `sms:${card.phone}`, event: "click_phone", color: "bg-blue-500/15 border-blue-500/30 text-blue-400" },
    card.email && { icon: Mail, label: "Email", href: `mailto:${card.email}`, event: "click_email", color: "bg-purple-500/15 border-purple-500/30 text-purple-400" },
    card.website && { icon: Globe, label: "Website", href: card.website.startsWith("http") ? card.website : `https://${card.website}`, event: "click_website", color: "bg-cyan-500/15 border-cyan-500/30 text-cyan-400" },
    card.bookingUrl && { icon: Calendar, label: "Book", href: card.bookingUrl.startsWith("http") ? card.bookingUrl : `https://${card.bookingUrl}`, event: "click_booking", color: "bg-amber-500/15 border-amber-500/30 text-amber-400" },
    card.googleReviewLink && { icon: Star, label: "Review", href: card.googleReviewLink, event: "click_review", color: "bg-yellow-500/15 border-yellow-500/30 text-yellow-400" },
    card.calendarUrl && { icon: Calendar, label: "Schedule", href: card.calendarUrl.startsWith("http") ? card.calendarUrl : `https://${card.calendarUrl}`, event: "click_booking", color: "bg-teal-500/15 border-teal-500/30 text-teal-400" },
  ].filter(Boolean) as { icon: any; label: string; href: string; event: string; color: string }[];

  if (actions.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      className={`grid ${actions.length <= 3 ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-6"} gap-2 mb-8`}>
      {actions.slice(0, 6).map((action) => (
        <a key={action.label} href={action.href}
          target={action.href.startsWith("http") ? "_blank" : undefined}
          rel={action.href.startsWith("http") ? "noopener noreferrer" : undefined}
          onClick={() => trackEvent(action.event, action.label)}
          className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border ${action.color} transition-all hover:scale-105 active:scale-95`}
          data-testid={`action-${action.label.toLowerCase()}`}>
          <action.icon size={20} />
          <span className="text-[10px] font-bold tracking-wide">{action.label}</span>
        </a>
      ))}
    </motion.div>
  );
}

function SaveShareBar({ card, theme, trackEvent, onShare, onQR }: {
  card: CardData; theme: Theme; trackEvent: (t: string, e?: string) => void; onShare: () => void; onQR: () => void;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      className="flex gap-2.5 mb-8">
      <button
        onClick={() => { downloadVCard(card); trackEvent("save_contact"); }}
        className="flex-1 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all hover:scale-[1.02] active:scale-[0.98] relative overflow-hidden group cursor-pointer"
        style={{ background: `linear-gradient(135deg, ${card.brandColor || "#6366f1"}, ${card.accentColor || "#8b5cf6"})`, boxShadow: `0 10px 30px -5px ${card.brandColor || "#6366f1"}66` }}
        data-testid="button-save-contact">
        <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors" />
        <Download size={18} className="text-white relative z-10" />
        <span className="text-white relative z-10">Save Contact</span>
      </button>
      <button onClick={onShare}
        className={`w-14 h-14 rounded-2xl ${theme.cardBg} border ${theme.border} flex items-center justify-center hover:scale-105 active:scale-95 transition-all shrink-0`}
        data-testid="button-share">
        <Share2 size={20} className={theme.muted} />
      </button>
      <button onClick={onQR}
        className={`w-14 h-14 rounded-2xl ${theme.cardBg} border ${theme.border} flex items-center justify-center hover:scale-105 active:scale-95 transition-all shrink-0`}
        data-testid="button-qr">
        <QrCode size={20} className={theme.muted} />
      </button>
    </motion.div>
  );
}

function QRPanel({ card, theme, visible }: { card: CardData; theme: Theme; visible: boolean }) {
  const cardUrl = `${window.location.origin}/card/${card.slug}`;
  return (
    <AnimatePresence>
      {visible && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
          className="mb-8 flex flex-col items-center overflow-hidden">
          <div className="p-5 bg-white rounded-2xl shadow-lg" style={{ boxShadow: `0 10px 40px -10px ${card.brandColor || "#6366f1"}44` }}>
            <QRCodeSVG value={cardUrl} size={200} bgColor="#ffffff" fgColor="#000000" level="H" />
          </div>
          <p className={`text-[11px] ${theme.muted} mt-3 font-medium`}>Scan to share this card</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AboutSection({ card, theme }: { card: CardData; theme: Theme }) {
  if (!card.bio) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      className={`p-5 rounded-2xl ${theme.cardBg} border ${theme.border} mb-6`}>
      <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: card.brandColor || "#6366f1" }}>About</p>
      <p className={`${theme.text} text-[14px] leading-relaxed opacity-80`} data-testid="text-bio">{card.bio}</p>
    </motion.div>
  );
}

function ServicesSection({ card, theme }: { card: CardData; theme: Theme }) {
  const services = safeArray<Service>(card.services);
  if (services.length === 0) return null;
  return (
    <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} className="mb-6">
      <p className={`text-[11px] font-bold uppercase tracking-wider ${theme.muted} mb-3 px-1`}>Expertise</p>
      <div className="space-y-2">
        {services.map((service, i) => {
          const Icon = ICON_MAP[service.icon || ""] || Briefcase;
          return (
            <motion.div key={service.label || i}
              initial={{ opacity: 0, x: -15 }} whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }} transition={{ delay: i * 0.03 }}
              className={`flex items-start gap-3 p-3.5 rounded-xl ${theme.cardBg} border ${theme.border} transition-all hover:scale-[1.01]`}
              data-testid={`service-item-${i}`}>
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${service.color || "from-indigo-500 to-purple-500"} flex items-center justify-center shrink-0`}>
                <Icon size={18} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[13px] font-bold ${theme.text} opacity-90`}>{service.label}</p>
                {service.description && <p className={`text-[11px] ${theme.muted} mt-0.5 leading-snug`}>{service.description}</p>}
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

function TestimonialSection({ card, theme }: { card: CardData; theme: Theme }) {
  const testimonial = safeTestimonial(card.testimonial);
  if (!testimonial) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      className="mb-6 p-5 rounded-2xl relative overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${card.brandColor || "#6366f1"}15, ${card.accentColor || "#8b5cf6"}15)`, border: `1px solid ${card.brandColor || "#6366f1"}25` }}>
      <div className="absolute top-3 left-5 text-4xl font-serif" style={{ color: `${card.brandColor || "#6366f1"}30` }}>"</div>
      <p className={`${theme.text} text-[14px] leading-relaxed italic mt-4 px-2 opacity-80`} data-testid="text-testimonial">{testimonial.quote}</p>
      <div className="flex items-center gap-3 mt-4 px-2">
        {card.photoUrl && (
          <div className="w-8 h-8 rounded-full overflow-hidden" style={{ border: `1px solid ${card.brandColor || "#6366f1"}40` }}>
            <img src={card.photoUrl} alt={testimonial.author} className="w-full h-full object-cover object-top" />
          </div>
        )}
        <div>
          <p className={`text-xs font-bold ${theme.text} opacity-80`}>{testimonial.author}</p>
          {testimonial.role && <p className="text-[10px]" style={{ color: `${card.brandColor || "#6366f1"}90` }}>{testimonial.role}</p>}
        </div>
      </div>
    </motion.div>
  );
}

function LinksSection({ card, theme, trackEvent }: { card: CardData; theme: Theme; trackEvent: (t: string, e?: string) => void }) {
  const links = safeArray<CustomLink>(card.links);
  if (links.length === 0) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-6">
      <p className={`text-[11px] font-bold uppercase tracking-wider ${theme.muted} mb-3 px-1`}>Links</p>
      <div className="space-y-2">
        {links.map((link, i) => (
          <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
            onClick={() => trackEvent("click_link", link.label)}
            className={`flex items-center gap-3 p-4 rounded-xl ${theme.cardBg} border ${theme.border} hover:scale-[1.01] transition-all group`}
            data-testid={`link-custom-${i}`}>
            <div className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center group-hover:scale-110 transition-transform">
              <ExternalLink size={18} className={theme.accent} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${theme.text} opacity-90 group-hover:opacity-100`}>{link.label}</p>
              <p className={`text-[11px] ${theme.muted} truncate`}>{link.url}</p>
            </div>
            <ArrowUpRight size={14} className={`${theme.muted} opacity-0 group-hover:opacity-100 transition-opacity`} />
          </a>
        ))}
      </div>
    </motion.div>
  );
}

function SocialLinksSection({ card, theme, trackEvent }: { card: CardData; theme: Theme; trackEvent: (t: string, e?: string) => void }) {
  const socials = safeArray<SocialLink>(card.socialLinks);
  if (socials.length === 0) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-6">
      <p className={`text-[11px] font-bold uppercase tracking-wider ${theme.muted} mb-3 px-1`}>Connect</p>
      <div className="flex flex-wrap gap-2">
        {socials.map((social, i) => (
          <a key={i} href={social.url} target="_blank" rel="noopener noreferrer"
            onClick={() => trackEvent("click_social", social.label)}
            className={`px-4 py-2.5 rounded-xl ${theme.cardBg} border ${theme.border} hover:scale-105 transition-all text-sm font-medium ${theme.text} opacity-80 hover:opacity-100`}
            data-testid={`social-${(social.label || "link").toLowerCase()}`}>
            {social.label || "Link"}
          </a>
        ))}
      </div>
    </motion.div>
  );
}

function StickyActionBar({ card, theme, onShare, trackEvent }: {
  card: CardData; theme: Theme; onShare: () => void; trackEvent: (t: string, e?: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className={`fixed bottom-0 left-0 right-0 z-50 ${theme.glass} border-t ${theme.border} safe-area-bottom`}
        >
          <div className="max-w-[480px] mx-auto px-4 py-3 flex items-center gap-2">
            {card.phone && (
              <a href={`tel:${card.phone}`} onClick={() => trackEvent("click_phone")}
                className="flex-1 py-2.5 rounded-xl bg-green-500/15 border border-green-500/30 flex items-center justify-center gap-1.5" data-testid="sticky-phone">
                <Phone size={15} className="text-green-400" />
                <span className="text-green-400 text-xs font-bold">Call</span>
              </a>
            )}
            {card.email && (
              <a href={`mailto:${card.email}`} onClick={() => trackEvent("click_email")}
                className="flex-1 py-2.5 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center gap-1.5" data-testid="sticky-email">
                <Mail size={15} className="text-purple-400" />
                <span className="text-purple-400 text-xs font-bold">Email</span>
              </a>
            )}
            <button onClick={() => { downloadVCard(card); trackEvent("save_contact"); }}
              className={`flex-1 py-2.5 rounded-xl bg-gradient-to-r ${theme.ctaBg} flex items-center justify-center gap-1.5 cursor-pointer`} data-testid="sticky-save">
              <Download size={15} className="text-white" />
              <span className="text-white text-xs font-bold">Save</span>
            </button>
            <button onClick={onShare} className={`py-2.5 px-3 rounded-xl ${theme.cardBg} border ${theme.border}`} data-testid="sticky-share">
              <Share2 size={15} className={theme.muted} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ShareModal({ card, theme, onClose }: { card: CardData; theme: Theme; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const cardUrl = `${window.location.origin}/card/${card.slug}`;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share && isMobile;
  const shareTitle = `${card.preferredName || card.name}${card.company ? ` — ${card.company}` : ""}`;

  const copyLink = () => {
    navigator.clipboard.writeText(cardUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareNative = () => {
    if (navigator.share) {
      navigator.share({ title: shareTitle, url: cardUrl }).catch(() => {});
    }
  };

  const shareToSms = () => {
    window.open(`sms:?&body=${encodeURIComponent(`Check out ${shareTitle}: ${cardUrl}`)}`, "_blank");
  };

  const shareToEmail = () => {
    window.open(`mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(`Check out this card: ${cardUrl}`)}`, "_blank");
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className={`w-full max-w-md ${theme.bg} rounded-t-3xl sm:rounded-3xl border ${theme.border} p-6`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h3 className={`text-lg font-bold ${theme.text}`}>Share Card</h3>
          <button onClick={onClose} className={`p-2 rounded-xl ${theme.cardBg}`} data-testid="button-close-share"><X size={18} className={theme.muted} /></button>
        </div>
        <div className="flex justify-center mb-6">
          <div className="p-4 bg-white rounded-2xl">
            <QRCodeSVG value={cardUrl} size={180} bgColor="#ffffff" fgColor="#000000" level="H" />
          </div>
        </div>
        <div className={`flex items-center gap-2 p-3 rounded-xl ${theme.cardBg} border ${theme.border} mb-4`}>
          <Link2 size={16} className={theme.muted} />
          <span className={`flex-1 text-sm truncate ${theme.muted}`}>{cardUrl}</span>
          <button onClick={copyLink} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${copied ? "bg-green-500/20 text-green-400" : "bg-indigo-500/20 text-indigo-400"}`}
            data-testid="button-copy-link">
            {copied ? <><Check size={12} className="inline mr-1" />Copied</> : <><Copy size={12} className="inline mr-1" />Copy</>}
          </button>
        </div>
        {canNativeShare ? (
          <button onClick={shareNative} className={`w-full py-3 rounded-xl bg-gradient-to-r ${theme.ctaBg} text-white font-bold text-sm flex items-center justify-center gap-2`}
            data-testid="button-native-share">
            <Share2 size={16} /> Share via...
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={shareToEmail}
              className={`flex-1 py-3 rounded-xl ${theme.cardBg} border ${theme.border} ${theme.text} font-bold text-sm flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all`}
              data-testid="button-share-email">
              <Mail size={16} /> Email
            </button>
            <button onClick={shareToSms}
              className={`flex-1 py-3 rounded-xl ${theme.cardBg} border ${theme.border} ${theme.text} font-bold text-sm flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all`}
              data-testid="button-share-sms">
              <MessageSquare size={16} /> Text
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

export default function DigitalCard() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug?.toLowerCase();
  const [card, setCard] = useState<CardData | null>(null);
  const [state, setState] = useState<FetchState>("loading");
  const [showShare, setShowShare] = useState(false);
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    if (!slug) { setState("not-found"); return; }
    fetch(`/api/public-card/${slug}`)
      .then(r => {
        if (r.status === 404) {
          return r.json().then(body => {
            if (body?.error === "Card not available") setState("unavailable");
            else setState("not-found");
          });
        }
        if (r.status === 403) { setState("unavailable"); return; }
        if (!r.ok) throw new Error("Request failed");
        return r.json().then(data => {
          setCard(normalizeCard(data));
          setState("success");
        });
      })
      .catch(() => setState("error"));
  }, [slug]);

  const trackEvent = useCardAnalytics(slug || "", state === "success");
  const theme = getTheme(card?.theme);

  if (state === "loading") return <CardLoading />;
  if (state === "not-found") return <CardNotFound />;
  if (state === "unavailable") return <CardUnavailable />;
  if (state === "error") return <CardError />;
  if (!card) return <CardNotFound />;

  return (
    <div className={`min-h-screen ${theme.bg} relative`} data-testid="digital-card-page">
      {theme.isDark && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[120px] opacity-20"
            style={{ background: card.brandColor || "#6366f1" }} />
          <div className="absolute bottom-[20%] right-[-10%] w-[400px] h-[400px] rounded-full blur-[120px] opacity-15"
            style={{ background: card.accentColor || "#8b5cf6" }} />
        </div>
      )}

      <div className="relative z-10">
        <HeroSection card={card} theme={theme} />

        <div className="px-5 max-w-[480px] mx-auto -mt-2 pb-28">
          <PrimaryActions card={card} theme={theme} trackEvent={trackEvent} />
          <SaveShareBar card={card} theme={theme} trackEvent={trackEvent}
            onShare={() => { setShowShare(true); trackEvent("share"); }}
            onQR={() => { setShowQR(!showQR); trackEvent("qr_scan"); }} />
          <QRPanel card={card} theme={theme} visible={showQR} />
          <AboutSection card={card} theme={theme} />
          <ServicesSection card={card} theme={theme} />
          <TestimonialSection card={card} theme={theme} />
          <LinksSection card={card} theme={theme} trackEvent={trackEvent} />
          <SocialLinksSection card={card} theme={theme} trackEvent={trackEvent} />

          <div className="text-center pt-4 pb-2">
            <a href="/cards" className={`text-[10px] ${theme.muted} opacity-40 hover:opacity-70 transition-opacity font-medium`}>
              Powered by Apex Marketing Automations
            </a>
          </div>
        </div>
      </div>

      <StickyActionBar card={card} theme={theme}
        onShare={() => { setShowShare(true); trackEvent("share"); }}
        trackEvent={trackEvent} />

      <AnimatePresence>
        {showShare && <ShareModal card={card} theme={theme} onClose={() => setShowShare(false)} />}
      </AnimatePresence>
    </div>
  );
}
