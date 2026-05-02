import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, Mail, Globe, Download, MessageSquare, QrCode, ChevronDown,
  ArrowUpRight, Star, MapPin, Calendar, Share2, Copy, Check, X,
  Palette, Code2, Megaphone, Bot, Mic, Workflow, BarChart3, Smartphone,
  Shield, ExternalLink, Briefcase, Sparkles, Play, Link2, AlertCircle, Loader2
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState, useEffect, useCallback } from "react";
import { downloadVCard } from "@/lib/vcard";
import type { SharedCardData, CardRenderConfig, SocialLink, CustomLink, Service } from "./types";
import type { CardTheme } from "./themes";

const ICON_MAP: Record<string, any> = {
  palette: Palette, code: Code2, globe: Globe, megaphone: Megaphone,
  bot: Bot, mic: Mic, workflow: Workflow, analytics: BarChart3,
  sms: Smartphone, shield: Shield, briefcase: Briefcase, sparkles: Sparkles,
  play: Play, star: Star, phone: Phone, mail: Mail, calendar: Calendar,
  download: Download, link: Link2, external: ExternalLink,
};

const SOCIAL_PLATFORM_STYLES: Record<string, { icon: string; bg: string }> = {
  instagram: { icon: "📸", bg: "from-pink-600 to-purple-600" },
  facebook: { icon: "📘", bg: "from-blue-600 to-blue-700" },
  tiktok: { icon: "🎵", bg: "from-gray-800 to-gray-900" },
  linkedin: { icon: "💼", bg: "from-blue-700 to-blue-800" },
  youtube: { icon: "▶️", bg: "from-red-600 to-red-700" },
};

function noop() {}

export function CardLoading() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
        <Loader2 size={36} className="text-indigo-400 animate-spin mx-auto mb-4" />
        <p className="text-slate-500 text-sm font-medium">Loading card...</p>
      </motion.div>
    </div>
  );
}

export function CardNotFound({ ctaUrl, ctaLabel }: { ctaUrl?: string; ctaLabel?: string }) {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center p-8">
        <div className="w-20 h-20 rounded-full bg-white/[0.05] flex items-center justify-center mx-auto mb-6">
          <X size={32} className="text-slate-500" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2" data-testid="text-not-found">Card Not Found</h1>
        <p className="text-slate-400 text-sm max-w-xs mx-auto">This digital card doesn't exist or has been removed.</p>
        {ctaUrl && (
          <a href={ctaUrl}
            className="inline-block mt-6 px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl font-semibold text-sm">
            {ctaLabel || "Get Your Own Card"}
          </a>
        )}
      </motion.div>
    </div>
  );
}

export function CardUnavailable() {
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

export function CardError() {
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

export function HeroSection({ card, theme }: { card: SharedCardData; theme: CardTheme }) {
  const displayName = card.preferredName || card.name;
  const brand = card.brandColor || "#6366f1";
  const accent = card.accentColor || "#8b5cf6";

  return (
    <div className="relative h-[58vh] min-h-[420px] max-h-[620px] overflow-hidden flex items-end">
      {card.photoUrl ? (
        <div className="absolute inset-0">
          <img src={card.photoUrl} alt={displayName} className="w-full h-full object-cover object-top" loading="eager" />
          <div className={`absolute inset-0 bg-gradient-to-t ${theme.heroOverlay}`} />
          <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${brand}18 0%, transparent 60%, ${accent}12 100%)` }} />
        </div>
      ) : (
        /* Premium animated no-photo background */
        <div className="absolute inset-0 overflow-hidden" style={{ background: theme.isDark ? "#050508" : "#f8f7f4" }}>
          {/* Animated mesh orbs */}
          <div className="absolute inset-0" style={{
            background: `
              radial-gradient(ellipse 80% 60% at 20% 20%, ${brand}28 0%, transparent 60%),
              radial-gradient(ellipse 60% 80% at 80% 80%, ${accent}22 0%, transparent 60%),
              radial-gradient(ellipse 50% 50% at 50% 50%, ${brand}10 0%, transparent 70%)
            `
          }} />
          {/* Animated orb 1 */}
          <div className="absolute rounded-full blur-[80px] animate-pulse" style={{
            width: "45%", height: "55%", top: "-10%", left: "-5%",
            background: `radial-gradient(circle, ${brand}35 0%, transparent 70%)`,
            animationDuration: "4s",
          }} />
          {/* Animated orb 2 */}
          <div className="absolute rounded-full blur-[100px]" style={{
            width: "55%", height: "50%", bottom: "-5%", right: "-10%",
            background: `radial-gradient(circle, ${accent}28 0%, transparent 70%)`,
            animation: "pulse 5s ease-in-out infinite alternate",
          }} />
          {/* Grid lines overlay for depth */}
          <div className="absolute inset-0 opacity-[0.04]" style={{
            backgroundImage: `linear-gradient(${brand} 1px, transparent 1px), linear-gradient(90deg, ${brand} 1px, transparent 1px)`,
            backgroundSize: "40px 40px",
          }} />
          {/* Bottom fade to match card body */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        </div>
      )}

      {card.logoUrl && (
        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }}
          className="absolute top-5 right-5 z-10">
          <img src={card.logoUrl} alt="Logo"
            className="w-14 h-14 rounded-2xl object-cover bg-white/10 backdrop-blur-xl border shadow-2xl"
            style={{ borderColor: `${brand}40` }} />
        </motion.div>
      )}

      <div className="relative z-10 p-8 pb-10 w-full">
        {card.tagline && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full backdrop-blur-md border mb-4"
            style={{ borderColor: `${brand}35`, background: `${brand}15` }}>
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: brand }} />
            <span className="text-[11px] font-bold tracking-wider uppercase line-clamp-1 text-white/90">
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
            <div className="h-[2px] w-10 rounded-full" style={{ background: `linear-gradient(to right, ${brand}, ${accent})` }} />
            <p className="text-lg font-bold" style={{ background: `linear-gradient(to right, ${brand}, ${accent})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
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

export function PrimaryActions({ card, theme, trackEvent }: {
  card: SharedCardData; theme: CardTheme; trackEvent?: (t: string, e?: string) => void;
}) {
  const track = trackEvent || noop;
  const actions = [
    card.phone && { icon: Phone, label: "Call", href: `tel:${card.phone}`, event: "click_phone", color: "bg-green-500/15 border-green-500/30 text-green-400" },
    card.phone && { icon: MessageSquare, label: "Text", href: `sms:${card.phone}`, event: "click_phone", color: "bg-blue-500/15 border-blue-500/30 text-blue-400" },
    card.email && { icon: Mail, label: "Email", href: `mailto:${card.email}`, event: "click_email", color: "bg-purple-500/15 border-purple-500/30 text-purple-400" },
    card.website && { icon: Globe, label: "Website", href: card.website.startsWith("http") ? card.website : `https://${card.website}`, event: "click_website", color: "bg-cyan-500/15 border-cyan-500/30 text-cyan-400" },
    card.bookingUrl && { icon: Calendar, label: "Book", href: card.bookingUrl.startsWith("http") ? card.bookingUrl : `https://${card.bookingUrl}`, event: "click_booking", color: "bg-amber-500/15 border-amber-500/30 text-amber-400" },
    card.reviewLink && { icon: Star, label: "Review", href: card.reviewLink, event: "click_review", color: "bg-yellow-500/15 border-yellow-500/30 text-yellow-400" },
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
          onClick={() => track(action.event, action.label)}
          className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border ${action.color} transition-all hover:scale-105 active:scale-95`}
          data-testid={`action-${action.label.toLowerCase()}`}>
          <action.icon size={20} />
          <span className="text-[10px] font-bold tracking-wide">{action.label}</span>
        </a>
      ))}
    </motion.div>
  );
}

export function SaveShareBar({ card, theme, config, onShare, onQR }: {
  card: SharedCardData; theme: CardTheme; config: CardRenderConfig; onShare: () => void; onQR: () => void;
}) {
  const track = config.trackEvent || noop;
  const handleSave = () => {
    if (config.source === "standalone") {
      window.location.href = `/api/standalone/card/${card.slug}/vcard`;
    } else {
      downloadVCard({
        name: card.name,
        preferredName: card.preferredName,
        title: card.title,
        company: card.company,
        phone: card.phone,
        email: card.email,
        website: card.website,
        bookingUrl: card.bookingUrl,
        calendarUrl: card.calendarUrl,
        location: card.location,
        bio: card.bio,
        tagline: card.tagline,
        photoUrl: card.photoUrl,
        logoImageUrl: card.logoUrl,
        socialLinks: card.socialLinks,
        slug: card.slug,
      });
    }
    track("save_contact");
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      className="flex gap-2.5 mb-8">
      <button
        onClick={handleSave}
        className="flex-1 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all hover:scale-[1.02] active:scale-[0.98] relative overflow-hidden group cursor-pointer"
        style={{ background: `linear-gradient(135deg, ${card.brandColor}, ${card.accentColor})`, boxShadow: `0 10px 30px -5px ${card.brandColor}66` }}
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

export function QRPanel({ cardUrl, theme, visible, brandColor }: {
  cardUrl: string; theme: CardTheme; visible: boolean; brandColor: string;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
          className="mb-8 flex flex-col items-center overflow-hidden">
          <div className="p-5 bg-white rounded-2xl shadow-lg" style={{ boxShadow: `0 10px 40px -10px ${brandColor}44` }}>
            <QRCodeSVG value={cardUrl} size={200} bgColor="#ffffff" fgColor="#000000" level="H" />
          </div>
          <p className={`text-[11px] ${theme.muted} mt-3 font-medium`}>Scan to share this card</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AboutSection({ card, theme }: { card: SharedCardData; theme: CardTheme }) {
  if (!card.bio) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      className={`p-5 rounded-2xl ${theme.cardBg} border ${theme.border} mb-6`}>
      <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: card.brandColor }}>About</p>
      <p className={`${theme.text} text-[14px] leading-relaxed opacity-80`} data-testid="text-bio">{card.bio}</p>
    </motion.div>
  );
}

export function ServicesSection({ card, theme }: { card: SharedCardData; theme: CardTheme }) {
  if (card.services.length === 0) return null;
  return (
    <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} className="mb-6">
      <p className={`text-[11px] font-bold uppercase tracking-wider ${theme.muted} mb-3 px-1`}>Expertise</p>
      <div className="space-y-2">
        {card.services.map((service, i) => {
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

export function TestimonialSection({ card, theme }: { card: SharedCardData; theme: CardTheme }) {
  if (!card.testimonial) return null;
  const testimonial = card.testimonial;
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      className="mb-6 p-5 rounded-2xl relative overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${card.brandColor}15, ${card.accentColor}15)`, border: `1px solid ${card.brandColor}25` }}>
      <div className="absolute top-3 left-5 text-4xl font-serif" style={{ color: `${card.brandColor}30` }}>"</div>
      <p className={`${theme.text} text-[14px] leading-relaxed italic mt-4 px-2 opacity-80`} data-testid="text-testimonial">{testimonial.quote}</p>
      <div className="flex items-center gap-3 mt-4 px-2">
        {card.photoUrl && (
          <div className="w-8 h-8 rounded-full overflow-hidden" style={{ border: `1px solid ${card.brandColor}40` }}>
            <img src={card.photoUrl} alt={testimonial.author} className="w-full h-full object-cover object-top" />
          </div>
        )}
        <div>
          <p className={`text-xs font-bold ${theme.text} opacity-80`}>{testimonial.author}</p>
          {testimonial.role && <p className="text-[10px]" style={{ color: `${card.brandColor}90` }}>{testimonial.role}</p>}
        </div>
      </div>
    </motion.div>
  );
}

export function LinksSection({ card, theme, trackEvent }: {
  card: SharedCardData; theme: CardTheme; trackEvent?: (t: string, e?: string) => void;
}) {
  if (card.links.length === 0) return null;
  const track = trackEvent || noop;
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-6">
      <p className={`text-[11px] font-bold uppercase tracking-wider ${theme.muted} mb-3 px-1`}>Links</p>
      <div className="space-y-2">
        {card.links.map((link, i) => (
          <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
            onClick={() => track("click_link", link.label)}
            className={`flex items-center gap-3 p-4 rounded-xl ${theme.cardBg} border ${theme.border} hover:scale-[1.01] transition-all group`}
            data-testid={`link-custom-${i}`}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform"
              style={{ backgroundColor: `${card.brandColor}20` }}>
              <ExternalLink size={18} style={{ color: card.brandColor }} />
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

export function SocialLinksSection({ card, theme, trackEvent }: {
  card: SharedCardData; theme: CardTheme; trackEvent?: (t: string, e?: string) => void;
}) {
  if (card.socialLinks.length === 0) return null;
  const track = trackEvent || noop;

  const hasPlatformStyles = card.socialLinks.some(s => s.platform && SOCIAL_PLATFORM_STYLES[s.platform]);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-6">
      <p className={`text-[11px] font-bold uppercase tracking-wider ${theme.muted} mb-3 px-1`}>Connect</p>
      {hasPlatformStyles ? (
        <div className="grid grid-cols-2 gap-2">
          {card.socialLinks.map((social, i) => {
            const style = SOCIAL_PLATFORM_STYLES[social.platform || ""];
            if (style) {
              return (
                <a key={i} href={social.url} target="_blank" rel="noopener noreferrer"
                  onClick={() => track("click_social", social.label)}
                  className={`flex items-center gap-3 px-4 py-3.5 ${theme.cardBg} border ${theme.border} hover:scale-[1.02] hover:opacity-90 rounded-2xl text-sm transition-all active:scale-95 group`}
                  data-testid={`social-${(social.label || "link").toLowerCase()}`}>
                  <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${style.bg} flex items-center justify-center text-base shadow-lg`}>
                    {style.icon}
                  </div>
                  <span className={`${theme.text} font-medium text-sm`}>{social.label}</span>
                </a>
              );
            }
            return (
              <a key={i} href={social.url} target="_blank" rel="noopener noreferrer"
                onClick={() => track("click_social", social.label)}
                className={`px-4 py-2.5 rounded-xl ${theme.cardBg} border ${theme.border} hover:scale-105 transition-all text-sm font-medium ${theme.text} opacity-80 hover:opacity-100`}
                data-testid={`social-${(social.label || "link").toLowerCase()}`}>
                {social.label || "Link"}
              </a>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {card.socialLinks.map((social, i) => (
            <a key={i} href={social.url} target="_blank" rel="noopener noreferrer"
              onClick={() => track("click_social", social.label)}
              className={`px-4 py-2.5 rounded-xl ${theme.cardBg} border ${theme.border} hover:scale-105 transition-all text-sm font-medium ${theme.text} opacity-80 hover:opacity-100`}
              data-testid={`social-${(social.label || "link").toLowerCase()}`}>
              {social.label || "Link"}
            </a>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export function ReviewBookingLinks({ card, theme }: { card: SharedCardData; theme: CardTheme }) {
  if (!card.reviewLink && !card.bookingUrl) return null;
  return (
    <div className="space-y-2.5 mb-6">
      {card.reviewLink && (
        <motion.a href={card.reviewLink} target="_blank" rel="noopener noreferrer" data-testid="button-review"
          initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
          className={`flex items-center gap-3 px-5 py-4 ${theme.cardBg} border ${theme.border} hover:scale-[1.01] hover:opacity-90 rounded-2xl text-sm transition-all group`}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${card.brandColor}20` }}>
            <Star className="w-5 h-5" style={{ color: card.brandColor }} />
          </div>
          <span className={`${theme.text} font-medium flex-1`}>Leave a Review</span>
          <ArrowUpRight className={`w-4 h-4 ${theme.muted} opacity-60 group-hover:opacity-100 transition-opacity`} />
        </motion.a>
      )}
      {card.bookingUrl && (
        <motion.a href={card.bookingUrl} target="_blank" rel="noopener noreferrer" data-testid="button-booking"
          initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
          className={`flex items-center gap-3 px-5 py-4 ${theme.cardBg} border ${theme.border} hover:scale-[1.01] hover:opacity-90 rounded-2xl text-sm transition-all group`}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${card.brandColor}20` }}>
            <Calendar className="w-5 h-5" style={{ color: card.brandColor }} />
          </div>
          <span className={`${theme.text} font-medium flex-1`}>Book an Appointment</span>
          <ArrowUpRight className={`w-4 h-4 ${theme.muted} opacity-60 group-hover:opacity-100 transition-opacity`} />
        </motion.a>
      )}
    </div>
  );
}

export function StickyActionBar({ card, theme, config, onShare }: {
  card: SharedCardData; theme: CardTheme; config: CardRenderConfig; onShare: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const track = config.trackEvent || noop;

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleSave = () => {
    if (config.source === "standalone") {
      window.location.href = `/api/standalone/card/${card.slug}/vcard`;
    } else {
      downloadVCard({
        name: card.name,
        preferredName: card.preferredName,
        title: card.title,
        company: card.company,
        phone: card.phone,
        email: card.email,
        website: card.website,
        bookingUrl: card.bookingUrl,
        calendarUrl: card.calendarUrl,
        location: card.location,
        bio: card.bio,
        tagline: card.tagline,
        photoUrl: card.photoUrl,
        logoImageUrl: card.logoUrl,
        socialLinks: card.socialLinks,
        slug: card.slug,
      });
    }
    track("save_contact");
  };

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
              <a href={`tel:${card.phone}`} onClick={() => track("click_phone")}
                className="flex-1 py-2.5 rounded-xl bg-green-500/15 border border-green-500/30 flex items-center justify-center gap-1.5" data-testid="sticky-phone">
                <Phone size={15} className="text-green-400" />
                <span className="text-green-400 text-xs font-bold">Call</span>
              </a>
            )}
            {card.email && (
              <a href={`mailto:${card.email}`} onClick={() => track("click_email")}
                className="flex-1 py-2.5 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center gap-1.5" data-testid="sticky-email">
                <Mail size={15} className="text-purple-400" />
                <span className="text-purple-400 text-xs font-bold">Email</span>
              </a>
            )}
            <button onClick={handleSave}
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

export function ShareModal({ card, theme, config, onClose }: {
  card: SharedCardData; theme: CardTheme; config: CardRenderConfig; onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const cardUrl = config.cardUrl;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share && isMobile;
  const shareTitle = `${card.preferredName || card.name}${card.company ? ` — ${card.company}` : ""}`;

  const copyLink = () => {
    navigator.clipboard.writeText(cardUrl);
    setCopied(true);
    config.trackEvent?.("copy", "card_url");
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

export function CardFooter({ config, theme }: { config: CardRenderConfig; theme: CardTheme }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}
      className={`mt-10 pt-8 border-t ${theme.border}`}>
      {config.source === "standalone" && config.referralUrl && (
        <a href={config.referralUrl} data-testid="button-get-your-own"
          className="w-full flex items-center justify-center gap-2.5 px-6 py-4 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:via-blue-500 hover:to-indigo-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-600/20 hover:shadow-blue-500/30 hover:scale-[1.02] active:scale-[0.98]">
          <Download className="w-5 h-5" /> Get Your Own Digital Card
        </a>
      )}
      {config.showBranding && (
        <p className={`text-center ${theme.muted} text-[11px] mt-3 font-medium tracking-wide`}>
          <a href={config.source === "standalone" ? "/standalone/card" : "/cards"}
            className="opacity-70 hover:opacity-100 transition-opacity">
            Powered by Apex {config.source === "standalone" ? "Digital Cards" : "Marketing Automations"}
          </a>
        </p>
      )}
    </motion.div>
  );
}

export function BackgroundGlow({ card, theme }: { card: SharedCardData; theme: CardTheme }) {
  if (!theme.isDark) return null;
  const brand = card.brandColor || "#6366f1";
  const accent = card.accentColor || "#8b5cf6";
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[140px] opacity-15"
        style={{ background: brand }} />
      <div className="absolute bottom-[20%] right-[-10%] w-[400px] h-[400px] rounded-full blur-[120px] opacity-10"
        style={{ background: accent }} />
      <div className="absolute top-[40%] left-[30%] w-[300px] h-[300px] rounded-full blur-[100px] opacity-8"
        style={{ background: `${brand}60` }} />
    </div>
  );
}

// ── LEAD CAPTURE FORM ────────────────────────────────────────────────────────
// Real form that creates actual CRM contacts — not fake analytics events.
// Renders when card.leadCaptureEnabled === true.

type LeadFormState = "idle" | "submitting" | "success" | "error";

export function LeadCaptureForm({ card, theme, trackEvent }: {
  card: SharedCardData; theme: CardTheme; trackEvent?: (t: string, e?: string) => void;
}) {
  const [state, setState] = useState<LeadFormState>("idle");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const track = trackEvent || noop;
  const brand = card.brandColor || "#6366f1";
  const accent = card.accentColor || "#8b5cf6";

  if (!card.leadCaptureEnabled) return null;

  const handleSubmit = async () => {
    setError("");
    if (!name.trim()) { setError("Please enter your name."); return; }
    if (!email.trim() && !phone.trim()) { setError("Please enter your email or phone."); return; }

    setState("submitting");
    try {
      const res = await fetch(`/api/public-card/${card.slug}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          message: message.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Submission failed");
      }
      track("save_contact", "lead_capture_form");
      setState("success");
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setState("error");
    }
  };

  const inputClass = `w-full px-4 py-3 rounded-xl text-sm font-medium border outline-none transition-all focus:ring-2 ${
    theme.isDark
      ? "bg-white/5 border-white/10 text-white placeholder-white/30 focus:border-opacity-60 focus:ring-white/10"
      : "bg-black/5 border-black/10 text-gray-900 placeholder-gray-400 focus:border-opacity-60 focus:ring-black/10"
  }`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="mb-6 rounded-2xl overflow-hidden"
      style={{ border: `1px solid ${brand}30`, background: `linear-gradient(135deg, ${brand}10, ${accent}08)` }}
    >
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${brand}20` }}>
            <span className="text-xl">✉️</span>
          </div>
          <div>
            <p className={`text-sm font-bold ${theme.text}`}>Get in Touch</p>
            <p className={`text-[11px] ${theme.muted}`}>Drop your info — I'll reach out personally</p>
          </div>
        </div>

        {state === "success" ? (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="text-center py-6">
            <div className="text-4xl mb-3">🎉</div>
            <p className={`font-bold ${theme.text} text-base`}>Got it! I'll be in touch soon.</p>
            <p className={`text-[12px] ${theme.muted} mt-1`}>Check your inbox or phone for a message from me.</p>
          </motion.div>
        ) : (
          <div className="space-y-2.5">
            <input
              type="text"
              placeholder="Full Name *"
              value={name}
              onChange={e => setName(e.target.value)}
              className={inputClass}
              disabled={state === "submitting"}
              data-testid="lead-name"
            />
            <input
              type="email"
              placeholder="Email Address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={inputClass}
              disabled={state === "submitting"}
              data-testid="lead-email"
            />
            <input
              type="tel"
              placeholder="Phone Number"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className={inputClass}
              disabled={state === "submitting"}
              data-testid="lead-phone"
            />
            <textarea
              placeholder="Message (optional)"
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={2}
              className={`${inputClass} resize-none`}
              disabled={state === "submitting"}
              data-testid="lead-message"
            />

            {error && (
              <p className="text-red-400 text-[11px] px-1">{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={state === "submitting"}
              className="w-full py-3.5 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
              style={{ background: `linear-gradient(135deg, ${brand}, ${accent})`, boxShadow: `0 8px 24px -6px ${brand}50` }}
              data-testid="lead-submit"
            >
              {state === "submitting" ? (
                <><span className="animate-spin">⟳</span> Sending...</>
              ) : (
                <>Send My Info</>
              )}
            </button>

            <p className={`text-center text-[10px] ${theme.muted} opacity-60`}>
              Your info is private — I'll only use it to contact you.
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
