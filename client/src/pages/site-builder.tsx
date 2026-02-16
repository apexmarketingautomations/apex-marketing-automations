import { useState, useEffect, useCallback } from "react";
import {
  Send,
  Smartphone,
  Monitor,
  RefreshCcw,
  Save,
  Loader2,
  LayoutTemplate,
  ShieldCheck,
  Clock,
  Sparkles,
  Star,
  Dumbbell,
  Heart,
  Zap,
  Trophy,
  CheckCircle2,
  FolderOpen,
  Trash2,
  X,
  GripVertical,
  History,
  Globe,
  Users,
  Plus,
  Edit,
  Copy,
  Share2,
  QrCode,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  Info,
  Palette,
  Building2,
  Scissors,
  Stethoscope,
  UtensilsCrossed,
  GraduationCap,
  Briefcase,
  Car,
  Camera,
  Crown,
  Flame,
  Music,
  Code2,
  Bot,
  ImagePlus,
  Upload,
  Image,
  Quote,
  BarChart3,
  Users2,
  Play,
  Phone,
  MapPin,
  Mail,
  ChevronDown,
  ChevronUp,
  Award,
  Target,
  Layers,
  ArrowRight,
  ExternalLink,
  Calendar,
  MessageCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ChatWidget } from "@/components/chat-widget";
import { SiteBuilderTutorial, useSiteBuilderTutorial } from "@/components/site-builder-tutorial";

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  ShieldCheck,
  Clock,
  Sparkles,
  Star,
  Dumbbell,
  Heart,
  Zap,
  Trophy,
  CheckCircle2,
  Crown,
  Flame,
  Camera,
};

function HeroSection({ title, subtitle, cta, image, badge, theme }: any) {
  return (
    <div
      className="relative min-h-[80vh] flex flex-col items-center justify-center text-center overflow-hidden"
      style={{ backgroundColor: theme.bg, color: theme.text }}
    >
      <div
        className="absolute inset-0 bg-cover bg-center z-0 scale-105"
        style={{ backgroundImage: `url(${image})`, filter: 'blur(1px)' }}
      />
      <div className="absolute inset-0 z-0" style={{ background: `linear-gradient(180deg, ${theme.bg}ee 0%, ${theme.bg}99 40%, ${theme.bg}dd 100%)` }} />
      <div className="absolute inset-0 z-0" style={{ background: `radial-gradient(ellipse at center, ${theme.primary}15 0%, transparent 70%)` }} />
      <div className="relative z-10 max-w-4xl px-6 space-y-8">
        {badge && (
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border" style={{ borderColor: theme.primary + '40', color: theme.primary, backgroundColor: theme.primary + '10' }}>
            <Sparkles size={12} /> {badge}
          </div>
        )}
        <h1
          className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1]"
          style={{ fontFamily: theme.font }}
        >
          {title}
        </h1>
        <p className="text-lg md:text-xl opacity-80 max-w-2xl mx-auto leading-relaxed">{subtitle}</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
          <Button
            size="lg"
            className="font-bold px-8 py-3 text-base rounded-full shadow-xl"
            style={{ backgroundColor: theme.primary, color: theme.bg, boxShadow: `0 0 40px ${theme.primary}30` }}
            data-testid="button-hero-cta"
          >
            {cta}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="font-semibold px-8 py-3 text-base rounded-full"
            style={{ borderColor: theme.text + '30', color: theme.text }}
            data-testid="button-hero-secondary"
          >
            Learn More
          </Button>
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-24 z-10" style={{ background: `linear-gradient(to top, ${theme.bg}, transparent)` }} />
    </div>
  );
}

function FeatureSection({ title, subtitle, features, theme }: any) {
  return (
    <div
      className="py-20 px-6 md:px-12"
      style={{ backgroundColor: theme.primary + '05', color: theme.text }}
    >
      <div className="max-w-6xl mx-auto">
        <h2
          className="text-3xl md:text-4xl font-bold text-center mb-3"
          style={{ fontFamily: theme.font }}
        >
          {title}
        </h2>
        {subtitle && <p className="text-center opacity-60 mb-14 max-w-2xl mx-auto">{subtitle}</p>}
        {!subtitle && <div className="mb-14" />}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {(features || []).map((f: any, i: number) => {
            const IconComponent = ICON_MAP[f.icon] || Star;
            return (
              <div
                key={i}
                className="group p-8 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all duration-300 hover:border-current/20 hover:-translate-y-1 hover:shadow-xl"
                style={{ '--tw-shadow-color': theme.primary + '15' } as any}
              >
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform"
                  style={{
                    backgroundColor: theme.primary + '15',
                    color: theme.primary,
                  }}
                >
                  <IconComponent size={26} />
                </div>
                <h3 className="text-xl font-bold mb-3">{f.title}</h3>
                <p className="text-sm opacity-60 leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BookingSection({ title, theme }: any) {
  return (
    <div
      className="py-20 px-6 text-center"
      style={{ backgroundColor: theme.bg, color: theme.text }}
    >
      <div className="max-w-md mx-auto p-8 rounded-2xl border border-white/10 bg-black/20 backdrop-blur-sm">
        <h2 className="text-2xl font-bold mb-6">{title}</h2>
        <div className="space-y-4">
          <Input
            placeholder="Full Name"
            className="bg-white/10 border-white/20"
            data-testid="input-preview-name"
          />
          <Input
            placeholder="Email Address"
            className="bg-white/10 border-white/20"
            data-testid="input-preview-email"
          />
          <Button
            className="w-full font-bold"
            style={{ backgroundColor: theme.primary, color: theme.bg }}
            data-testid="button-preview-submit"
          >
            Check Availability
          </Button>
          <p className="text-xs opacity-50 mt-4">Powered by Apex Marketing Animation</p>
        </div>
      </div>
    </div>
  );
}

function PaywallSection({ title, tiers, theme }: any) {
  const [stripeProducts, setStripeProducts] = useState<any[]>([]);
  const [checkoutLoading, setCheckoutLoading] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/stripe/products")
      .then((r) => r.json())
      .then((data) => {
        if (data.products) setStripeProducts(data.products);
      })
      .catch(() => {});
  }, []);

  const handleSubscribe = async (tier: any, index: number) => {
    const priceId = tier.priceId || stripeProducts[index]?.prices?.[0]?.id;
    if (!priceId) {
      return;
    }
    setCheckoutLoading(index);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      const data = await res.json();
      if (data.url) window.open(data.url, "_blank");
    } catch {} finally {
      setCheckoutLoading(null);
    }
  };

  return (
    <div
      className="py-20 px-6"
      style={{ backgroundColor: theme.bg, color: theme.text }}
    >
      <div className="max-w-5xl mx-auto">
        <h2
          className="text-3xl font-bold text-center mb-4"
          style={{ fontFamily: theme.font }}
        >
          {title}
        </h2>
        <p className="text-center text-sm opacity-60 mb-12">Choose your access level</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(tiers || []).map((tier: any, i: number) => {
            const isPopular = i === 1;
            return (
              <div
                key={i}
                className={`relative rounded-2xl p-6 border transition-all hover:scale-[1.02] ${
                  isPopular
                    ? "border-2 shadow-lg shadow-current/10"
                    : "border-white/10"
                }`}
                style={{
                  borderColor: isPopular ? theme.primary : undefined,
                  backgroundColor: isPopular ? theme.primary + "08" : "rgba(255,255,255,0.03)",
                }}
                data-testid={`paywall-tier-${i}`}
              >
                {isPopular && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-0.5 rounded-full text-xs font-bold"
                    style={{ backgroundColor: theme.primary, color: theme.bg }}
                  >
                    MOST POPULAR
                  </div>
                )}
                <h3 className="text-lg font-bold mb-1">{tier.name}</h3>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-3xl font-black" style={{ color: theme.primary }}>
                    ${tier.price}
                  </span>
                  <span className="text-xs opacity-50">/month</span>
                </div>
                <ul className="space-y-2 mb-6 text-sm">
                  {(tier.perks || []).map((perk: string, j: number) => (
                    <li key={j} className="flex items-center gap-2">
                      <span style={{ color: theme.primary }}>&#10003;</span>
                      {perk}
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full font-bold"
                  style={{
                    backgroundColor: isPopular ? theme.primary : "transparent",
                    color: isPopular ? theme.bg : theme.text,
                    border: isPopular ? "none" : `1px solid ${theme.primary}`,
                  }}
                  onClick={() => handleSubscribe(tier, i)}
                  disabled={checkoutLoading === i}
                  data-testid={`button-subscribe-tier-${i}`}
                >
                  {checkoutLoading === i ? "Loading..." : (tier.cta || "Subscribe")}
                </Button>
              </div>
            );
          })}
        </div>
        <p className="text-center text-xs opacity-40 mt-8">
          Secure payments powered by Stripe. Cancel anytime.
        </p>
      </div>
    </div>
  );
}

function CodeSection({ title, code, theme }: any) {
  const [iframeHeight] = useState(400);
  const srcDoc = `<!DOCTYPE html><html><head><style>body{margin:0;font-family:sans-serif;}</style></head><body>${code || ""}</body></html>`;
  return (
    <div
      className="py-16 px-6 md:px-12"
      style={{ backgroundColor: theme.bg, color: theme.text }}
    >
      <div className="max-w-4xl mx-auto">
        <h2
          className="text-3xl font-bold text-center mb-8"
          style={{ fontFamily: theme.font }}
        >
          {title}
        </h2>
        <iframe
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          style={{
            border: "none",
            width: "100%",
            minHeight: `${iframeHeight}px`,
            overflow: "auto",
            borderRadius: "0.75rem",
            backgroundColor: "white",
          }}
          data-testid="code-section-preview"
        />
      </div>
    </div>
  );
}

function BotEmbedSection({ title, code, theme }: any) {
  const srcDoc = `<!DOCTYPE html><html><head><style>body{margin:0;font-family:sans-serif;background:transparent;}</style></head><body>${code || ""}</body></html>`;
  return (
    <div
      className="py-16 px-6 md:px-12"
      style={{ backgroundColor: theme.bg, color: theme.text }}
    >
      <div className="max-w-4xl mx-auto">
        <h2
          className="text-3xl font-bold text-center mb-4"
          style={{ fontFamily: theme.font }}
        >
          {title}
        </h2>
        {code ? (
          <>
            <div className="flex items-center justify-center gap-2 mb-6">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
              </span>
              <span className="text-xs font-medium opacity-70">Bot Widget Active</span>
            </div>
            <iframe
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              style={{
                border: "none",
                width: "100%",
                minHeight: "100px",
                backgroundColor: "transparent",
              }}
              data-testid="bot-embed-section-preview"
            />
          </>
        ) : (
          <p className="text-center text-sm opacity-50" data-testid="bot-embed-section-preview">
            No bot code added yet. Click Edit to paste your chatbot embed code.
          </p>
        )}
      </div>
    </div>
  );
}

function TestimonialsSection({ title, subtitle, testimonials, theme }: any) {
  return (
    <div className="py-20 px-6 md:px-12" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-3" style={{ fontFamily: theme.font }}>{title}</h2>
        {subtitle && <p className="text-center opacity-60 mb-12 max-w-2xl mx-auto">{subtitle}</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(testimonials || []).map((t: any, i: number) => (
            <div key={i} className="p-6 rounded-2xl border border-white/10 bg-white/5 relative">
              <div className="text-4xl opacity-20 absolute top-4 right-4" style={{ color: theme.primary }}>"</div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: theme.primary + '30', color: theme.primary }}>
                  {(t.name || 'A').charAt(0)}
                </div>
                <div>
                  <p className="font-semibold text-sm">{t.name}</p>
                  <p className="text-xs opacity-50">{t.role}</p>
                </div>
              </div>
              <div className="flex gap-0.5 mb-3">
                {Array.from({ length: t.stars || 5 }).map((_, j) => (
                  <Star key={j} size={14} fill={theme.primary} color={theme.primary} />
                ))}
              </div>
              <p className="text-sm opacity-80 leading-relaxed">{t.quote}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatsSection({ title, stats, theme }: any) {
  return (
    <div className="py-16 px-6" style={{ backgroundColor: theme.primary + '08', color: theme.text }}>
      <div className="max-w-6xl mx-auto">
        {title && <h2 className="text-2xl font-bold text-center mb-10" style={{ fontFamily: theme.font }}>{title}</h2>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {(stats || []).map((s: any, i: number) => (
            <div key={i} className="text-center">
              <div className="text-4xl md:text-5xl font-black mb-2" style={{ color: theme.primary }}>{s.value}</div>
              <div className="text-sm opacity-60 uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GallerySection({ title, subtitle, images, theme }: any) {
  return (
    <div className="py-20 px-6 md:px-12" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-3" style={{ fontFamily: theme.font }}>{title}</h2>
        {subtitle && <p className="text-center opacity-60 mb-10 max-w-2xl mx-auto">{subtitle}</p>}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {(images || []).map((img: any, i: number) => (
            <div key={i} className="aspect-[4/3] rounded-xl overflow-hidden border border-white/10 group relative">
              <img src={typeof img === 'string' ? img : img.url} alt={typeof img === 'string' ? '' : img.caption || ''} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
              {typeof img !== 'string' && img.caption && (
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-4 translate-y-full group-hover:translate-y-0 transition-transform">
                  <p className="text-sm text-white">{img.caption}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AboutSection({ title, text, image, stats, theme }: any) {
  return (
    <div className="py-20 px-6 md:px-12" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        <div>
          <h2 className="text-3xl md:text-4xl font-bold mb-6" style={{ fontFamily: theme.font }}>{title}</h2>
          <p className="opacity-80 leading-relaxed mb-6 text-lg">{text}</p>
          {stats && (
            <div className="grid grid-cols-3 gap-4">
              {stats.map((s: any, i: number) => (
                <div key={i}>
                  <div className="text-2xl font-black" style={{ color: theme.primary }}>{s.value}</div>
                  <div className="text-xs opacity-50 uppercase">{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {image && (
          <div className="rounded-2xl overflow-hidden border border-white/10 aspect-square">
            <img src={image} alt="" className="w-full h-full object-cover" />
          </div>
        )}
      </div>
    </div>
  );
}

function CtaSection({ title, subtitle, cta, theme }: any) {
  return (
    <div className="py-20 px-6" style={{ background: `linear-gradient(135deg, ${theme.primary}15, ${theme.primary}05)`, color: theme.text }}>
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="text-3xl md:text-5xl font-bold mb-4" style={{ fontFamily: theme.font }}>{title}</h2>
        {subtitle && <p className="text-lg opacity-70 mb-8 max-w-xl mx-auto">{subtitle}</p>}
        <Button size="lg" className="font-bold px-8 py-3 text-lg rounded-full shadow-lg" style={{ backgroundColor: theme.primary, color: theme.bg, boxShadow: `0 0 30px ${theme.primary}40` }} data-testid="button-cta-action">
          {cta || "Get Started"} <ArrowRight className="ml-2" size={18} />
        </Button>
      </div>
    </div>
  );
}

function FaqSection({ title, faqs, theme }: any) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  return (
    <div className="py-20 px-6 md:px-12" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="max-w-3xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12" style={{ fontFamily: theme.font }}>{title}</h2>
        <div className="space-y-3">
          {(faqs || []).map((faq: any, i: number) => (
            <div key={i} className="border border-white/10 rounded-xl overflow-hidden">
              <button className="w-full p-5 text-left flex items-center justify-between hover:bg-white/5 transition-colors" onClick={() => setOpenIndex(openIndex === i ? null : i)}>
                <span className="font-semibold pr-4">{faq.q}</span>
                {openIndex === i ? <ChevronUp size={18} style={{ color: theme.primary }} /> : <ChevronDown size={18} className="opacity-50" />}
              </button>
              {openIndex === i && (
                <div className="px-5 pb-5 text-sm opacity-70 leading-relaxed border-t border-white/5 pt-4">{faq.a}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PricingSection({ title, subtitle, plans, theme }: any) {
  return (
    <div className="py-20 px-6 md:px-12" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-3" style={{ fontFamily: theme.font }}>{title}</h2>
        {subtitle && <p className="text-center opacity-60 mb-12 max-w-2xl mx-auto">{subtitle}</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(plans || []).map((plan: any, i: number) => {
            const featured = plan.featured || i === 1;
            return (
              <div key={i} className={`rounded-2xl p-8 border transition-all hover:scale-[1.02] relative ${featured ? 'border-2 shadow-2xl' : 'border-white/10'}`} style={{ borderColor: featured ? theme.primary : undefined, backgroundColor: featured ? theme.primary + '08' : 'rgba(255,255,255,0.03)' }}>
                {featured && <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: theme.primary, color: theme.bg }}>RECOMMENDED</div>}
                <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
                <p className="text-xs opacity-50 mb-4">{plan.description}</p>
                <div className="flex items-baseline gap-1 mb-6"><span className="text-4xl font-black" style={{ color: theme.primary }}>${plan.price}</span><span className="text-sm opacity-50">/{plan.period || 'mo'}</span></div>
                <ul className="space-y-3 mb-8">
                  {(plan.features || []).map((f: string, j: number) => (
                    <li key={j} className="flex items-start gap-2 text-sm"><CheckCircle2 size={16} className="mt-0.5 shrink-0" style={{ color: theme.primary }} />{f}</li>
                  ))}
                </ul>
                <Button className="w-full font-bold rounded-full" style={{ backgroundColor: featured ? theme.primary : 'transparent', color: featured ? theme.bg : theme.text, border: featured ? 'none' : `1px solid ${theme.primary}` }} data-testid={`button-pricing-${i}`}>{plan.cta || 'Choose Plan'}</Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TeamSection({ title, subtitle, members, theme }: any) {
  return (
    <div className="py-20 px-6 md:px-12" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-3" style={{ fontFamily: theme.font }}>{title}</h2>
        {subtitle && <p className="text-center opacity-60 mb-12 max-w-2xl mx-auto">{subtitle}</p>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {(members || []).map((m: any, i: number) => (
            <div key={i} className="text-center group">
              <div className="w-24 h-24 rounded-full mx-auto mb-4 border-2 overflow-hidden flex items-center justify-center text-2xl font-bold" style={{ borderColor: theme.primary + '40', backgroundColor: theme.primary + '15', color: theme.primary }}>
                {m.image ? <img src={m.image} alt={m.name} className="w-full h-full object-cover" /> : (m.name || 'T').charAt(0)}
              </div>
              <h3 className="font-bold">{m.name}</h3>
              <p className="text-sm opacity-50">{m.role}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LogoBarSection({ title, logos, theme }: any) {
  return (
    <div className="py-12 px-6" style={{ backgroundColor: theme.primary + '05', color: theme.text }}>
      <div className="max-w-6xl mx-auto">
        {title && <p className="text-center text-xs uppercase tracking-widest opacity-40 mb-8">{title}</p>}
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12">
          {(logos || []).map((logo: any, i: number) => (
            <div key={i} className="opacity-40 hover:opacity-80 transition-opacity text-sm font-bold tracking-wider uppercase" style={{ fontFamily: theme.font }}>
              {typeof logo === 'string' ? logo : logo.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TimelineSection({ title, subtitle, events, theme }: any) {
  return (
    <div className="py-20 px-6 md:px-12" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="max-w-3xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-3" style={{ fontFamily: theme.font }}>{title}</h2>
        {subtitle && <p className="text-center opacity-60 mb-12">{subtitle}</p>}
        <div className="relative">
          <div className="absolute left-4 md:left-1/2 top-0 bottom-0 w-0.5" style={{ backgroundColor: theme.primary + '30' }} />
          {(events || []).map((ev: any, i: number) => (
            <div key={i} className={`relative flex items-start mb-10 ${i % 2 === 0 ? 'md:flex-row-reverse' : ''}`}>
              <div className="absolute left-4 md:left-1/2 w-3 h-3 rounded-full -translate-x-1/2 mt-2 z-10 ring-4" style={{ backgroundColor: theme.primary }} />
              <div className={`ml-10 md:ml-0 md:w-[calc(50%-2rem)] ${i % 2 === 0 ? 'md:mr-auto md:pr-8 md:text-right' : 'md:ml-auto md:pl-8'}`}>
                <span className="text-xs font-mono opacity-40">{ev.date}</span>
                <h3 className="font-bold text-lg mt-1">{ev.title}</h3>
                <p className="text-sm opacity-60 mt-1">{ev.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ContactSection({ title, subtitle, fields, theme }: any) {
  return (
    <div className="py-20 px-6 md:px-12" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12">
        <div>
          <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{ fontFamily: theme.font }}>{title}</h2>
          {subtitle && <p className="opacity-60 mb-8">{subtitle}</p>}
          <div className="space-y-4">
            <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: theme.primary + '20' }}><Mail size={18} style={{ color: theme.primary }} /></div><div><p className="text-xs opacity-50">Email</p><p className="font-semibold text-sm">hello@yourbusiness.com</p></div></div>
            <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: theme.primary + '20' }}><Phone size={18} style={{ color: theme.primary }} /></div><div><p className="text-xs opacity-50">Phone</p><p className="font-semibold text-sm">(555) 123-4567</p></div></div>
            <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: theme.primary + '20' }}><MapPin size={18} style={{ color: theme.primary }} /></div><div><p className="text-xs opacity-50">Location</p><p className="font-semibold text-sm">123 Main St, Your City</p></div></div>
          </div>
        </div>
        <div className="p-8 rounded-2xl border border-white/10 bg-white/5">
          <div className="space-y-4">
            {(fields || ['Name', 'Email', 'Phone', 'Message']).map((field: string, i: number) => (
              <div key={i}>
                <label className="text-xs opacity-50 block mb-1">{field}</label>
                {field === 'Message' ? (
                  <textarea className="w-full bg-white/10 border border-white/20 rounded-lg p-3 text-sm resize-none h-24 focus:outline-none focus:border-current" style={{ borderColor: theme.primary + '50' }} placeholder={`Your ${field.toLowerCase()}...`} />
                ) : (
                  <Input className="bg-white/10 border-white/20" placeholder={`Your ${field.toLowerCase()}...`} data-testid={`input-contact-${field.toLowerCase()}`} />
                )}
              </div>
            ))}
            <Button className="w-full font-bold rounded-full" style={{ backgroundColor: theme.primary, color: theme.bg }} data-testid="button-contact-submit">Send Message</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function VideoSection({ title, subtitle, videoUrl, theme }: any) {
  return (
    <div className="py-20 px-6 md:px-12" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-bold mb-3" style={{ fontFamily: theme.font }}>{title}</h2>
        {subtitle && <p className="opacity-60 mb-10 max-w-2xl mx-auto">{subtitle}</p>}
        <div className="aspect-video rounded-2xl overflow-hidden border border-white/10 bg-black/50 flex items-center justify-center relative group cursor-pointer">
          {videoUrl ? (
            <iframe src={videoUrl} className="w-full h-full" allow="autoplay; encrypted-media" allowFullScreen />
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full flex items-center justify-center border-2 group-hover:scale-110 transition-transform" style={{ borderColor: theme.primary, color: theme.primary }}>
                <Play size={28} fill={theme.primary} />
              </div>
              <p className="text-sm opacity-50">Watch Our Story</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BannerSection({ title, subtitle, cta, image, theme }: any) {
  return (
    <div className="py-16 px-6 md:px-12 relative overflow-hidden" style={{ color: theme.text }}>
      <div className="absolute inset-0 bg-cover bg-center z-0" style={{ backgroundImage: `url(${image})` }} />
      <div className="absolute inset-0 z-0" style={{ backgroundColor: theme.bg, opacity: 0.85 }} />
      <div className="relative z-10 max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold" style={{ fontFamily: theme.font }}>{title}</h2>
          {subtitle && <p className="opacity-70 mt-2">{subtitle}</p>}
        </div>
        {cta && (
          <Button size="lg" className="font-bold rounded-full shrink-0 px-8" style={{ backgroundColor: theme.primary, color: theme.bg }} data-testid="button-banner-cta">
            {cta} <ArrowRight className="ml-2" size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}

function ComparisonSection({ title, subtitle, headers, rows, theme }: any) {
  return (
    <div className="py-20 px-6 md:px-12" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="max-w-4xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-3" style={{ fontFamily: theme.font }}>{title}</h2>
        {subtitle && <p className="text-center opacity-60 mb-10">{subtitle}</p>}
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: theme.primary + '15' }}>
                {(headers || []).map((h: string, i: number) => (
                  <th key={i} className={`p-4 text-left font-bold ${i === 0 ? '' : 'text-center'}`} style={{ color: i > 0 ? theme.primary : undefined }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows || []).map((row: any, i: number) => (
                <tr key={i} className="border-t border-white/5 hover:bg-white/5">
                  {(row.cells || []).map((cell: string, j: number) => (
                    <td key={j} className={`p-4 ${j === 0 ? 'font-medium' : 'text-center'}`}>
                      {cell === '✓' ? <CheckCircle2 size={18} className="mx-auto" style={{ color: theme.primary }} /> : cell === '✗' ? <span className="opacity-30">—</span> : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ProcessStepsSection({ title, subtitle, steps, theme }: any) {
  return (
    <div className="py-20 px-6 md:px-12" style={{ backgroundColor: theme.primary + '05', color: theme.text }}>
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-3" style={{ fontFamily: theme.font }}>{title}</h2>
        {subtitle && <p className="text-center opacity-60 mb-14 max-w-2xl mx-auto">{subtitle}</p>}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative">
          <div className="hidden md:block absolute top-10 left-[12.5%] right-[12.5%] h-0.5" style={{ backgroundColor: theme.primary + '20' }} />
          {(steps || []).map((step: any, i: number) => (
            <div key={i} className="text-center relative">
              <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center text-lg font-black border-2 relative z-10" style={{ borderColor: theme.primary, color: theme.primary, backgroundColor: theme.bg }}>
                {i + 1}
              </div>
              <h3 className="font-bold mb-2">{step.title}</h3>
              <p className="text-sm opacity-60">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QrCodeSection({ title, subtitle, qrValue, qrLabel, cta, theme }: any) {
  const [inputUrl, setInputUrl] = useState(qrValue || "https://yoursite.com");
  const [activeUrl, setActiveUrl] = useState(qrValue || "https://yoursite.com");
  const qrSize = 280;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize}x${qrSize}&data=${encodeURIComponent(activeUrl)}&bgcolor=${theme.bg.replace('#','')}&color=${theme.primary.replace('#','')}&format=svg`;

  return (
    <div className="py-24 px-6 md:px-12" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border mb-6" style={{ borderColor: theme.primary + '40', color: theme.primary, backgroundColor: theme.primary + '10' }}>
            <QrCode size={14} /> QR Code
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-4" style={{ fontFamily: theme.font }}>{title}</h2>
          {subtitle && <p className="text-lg opacity-60 max-w-2xl mx-auto">{subtitle}</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div className="flex flex-col items-center">
            <div className="relative p-6 rounded-3xl border-2 border-dashed" style={{ borderColor: theme.primary + '30', backgroundColor: theme.primary + '05' }}>
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest" style={{ backgroundColor: theme.primary, color: theme.bg }}>
                Scan Me
              </div>
              <img
                src={qrApiUrl}
                alt="QR Code"
                width={qrSize}
                height={qrSize}
                className="rounded-xl"
                data-testid="img-qr-code"
              />
            </div>
            {qrLabel && <p className="mt-4 text-sm opacity-50 text-center">{qrLabel}</p>}
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-semibold mb-2 opacity-70">Enter URL or Text</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="https://yourwebsite.com"
                  className="flex-1 px-4 py-3 rounded-xl border bg-transparent text-sm focus:outline-none focus:ring-2"
                  style={{ borderColor: theme.text + '20', color: theme.text }}
                  data-testid="input-qr-url"
                />
                <button
                  onClick={() => setActiveUrl(inputUrl)}
                  className="px-5 py-3 rounded-xl font-bold text-sm shrink-0 transition-transform hover:scale-105"
                  style={{ backgroundColor: theme.primary, color: theme.bg }}
                  data-testid="button-generate-qr"
                >
                  Generate
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <a
                href={qrApiUrl.replace('format=svg', 'format=png') + '&size=1000x1000'}
                download="qr-code.png"
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-semibold hover:bg-white/5 transition-colors"
                style={{ borderColor: theme.text + '20' }}
                data-testid="button-download-png"
              >
                <ArrowDown size={16} /> PNG
              </a>
              <a
                href={qrApiUrl}
                download="qr-code.svg"
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-semibold hover:bg-white/5 transition-colors"
                style={{ borderColor: theme.text + '20' }}
                data-testid="button-download-svg"
              >
                <ArrowDown size={16} /> SVG
              </a>
            </div>

            {cta && (
              <button
                className="w-full py-4 rounded-xl font-bold text-base transition-all hover:scale-[1.02] shadow-lg"
                style={{ backgroundColor: theme.primary, color: theme.bg, boxShadow: `0 0 30px ${theme.primary}25` }}
                data-testid="button-qr-cta"
              >
                {cta}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SavedSite {
  id: number;
  name: string;
  prompt: string;
  siteData: any;
  createdAt: string;
  customDomain?: string;
  publishedUrl?: string;
}

interface SiteVersion {
  id: number;
  siteId: number;
  versionNumber: number;
  label: string;
  siteData: any;
  createdAt: string;
}

interface Collaborator {
  id: number;
  siteId: number;
  name: string;
  email: string;
  role: string;
  inviteCode: string;
  joinedAt: string;
}

function SectionEditor({ section, index, onUpdate, onClose }: { section: any; index: number; onUpdate: (idx: number, props: any) => void; onClose: () => void }) {
  const [editProps, setEditProps] = useState<Record<string, any>>({ ...section.props });

  const handleChange = (key: string, value: any) => {
    setEditProps((prev: Record<string, any>) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onUpdate(index, editProps);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-neutral-900 border border-white/10 rounded-xl p-4 mb-2 space-y-3"
      data-testid={`editor-section-${index}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-indigo-400">Edit {section.type} Section</span>
        <button onClick={onClose} className="text-slate-400 hover:text-white" data-testid={`button-close-editor-${index}`}>
          <X size={16} />
        </button>
      </div>
      {(section.type === "CODE" || section.type === "BOT_EMBED") && (
        <div>
          <label className="text-xs text-slate-400 block mb-1">Title</label>
          <Input
            value={editProps.title || ""}
            onChange={(e) => handleChange("title", e.target.value)}
            className="bg-white/5 border-white/10 text-sm mb-3"
            data-testid={`input-edit-title-${index}`}
          />
          <label className="text-xs text-slate-400 block mb-1 flex items-center gap-1">
            {section.type === "BOT_EMBED" ? (
              <><Bot size={12} /> Bot Embed Code</>
            ) : (
              <><Code2 size={12} /> HTML / CSS / JavaScript</>
            )}
          </label>
          <textarea
            value={editProps.code || ""}
            onChange={(e) => handleChange("code", e.target.value)}
            className="w-full h-64 bg-black/50 border border-white/10 rounded-lg p-3 text-xs font-mono text-green-400 resize-y focus:outline-none focus:border-indigo-500"
            placeholder={section.type === "BOT_EMBED" ? "Paste your chatbot embed code here (e.g. Tidio, Intercom, Drift, or custom bot script)..." : "Paste your HTML, CSS, or JavaScript here..."}
            spellCheck={false}
            data-testid={`input-edit-code-${index}`}
          />
          <div className="flex gap-2 justify-end mt-3">
            <Button size="sm" variant="outline" className="border-white/10 text-xs" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-500 text-xs" onClick={handleSave} data-testid={`button-save-section-${index}`}>Apply</Button>
          </div>
        </div>
      )}
      {section.type !== "CODE" && section.type !== "BOT_EMBED" && Object.entries(editProps).map(([key, value]) => {
        if (key === "features" || key === "formId" || typeof value === "object") return null;
        if (key === "image") {
          return (
            <div key={key}>
              <label className="text-xs text-slate-400 block mb-1 capitalize">{key}</label>
              <Input
                value={String(value || "")}
                onChange={(e) => handleChange(key, e.target.value)}
                className="bg-white/5 border-white/10 text-sm mb-2"
                placeholder="Image URL or upload below"
                data-testid={`input-edit-${key}-${index}`}
              />
              <div className="flex gap-1 flex-wrap">
                <label className="cursor-pointer px-2 py-1 bg-indigo-600/30 hover:bg-indigo-600/50 rounded text-[10px] text-indigo-300 transition-colors flex items-center gap-1">
                  <Upload size={10} /> Upload
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const formData = new FormData();
                      formData.append("image", file);
                      try {
                        const res = await fetch("/api/uploads", { method: "POST", body: formData });
                        const data = await res.json();
                        if (data.url) handleChange("image", data.url);
                      } catch {}
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
          );
        }
        return (
          <div key={key}>
            <label className="text-xs text-slate-400 block mb-1 capitalize">{key}</label>
            <Input
              value={String(value || "")}
              onChange={(e) => handleChange(key, e.target.value)}
              className="bg-white/5 border-white/10 text-sm"
              data-testid={`input-edit-${key}-${index}`}
            />
          </div>
        );
      })}
      {section.type !== "CODE" && section.type !== "BOT_EMBED" && (
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="outline" className="border-white/10 text-xs" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-500 text-xs" onClick={handleSave} data-testid={`button-save-section-${index}`}>Apply</Button>
        </div>
      )}
    </motion.div>
  );
}

export default function SiteBuilder() {
  const [prompt, setPrompt] = useState("");
  const [siteData, setSiteData] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [viewMode, setViewMode] = useState<"desktop" | "mobile">("desktop");
  const [history, setHistory] = useState<string[]>([]);
  const [lastPrompt, setLastPrompt] = useState("");
  const [savedSites, setSavedSites] = useState<SavedSite[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const [editMode, setEditMode] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [editingSectionIndex, setEditingSectionIndex] = useState<number | null>(null);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  const [showImageLibrary, setShowImageLibrary] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<{url: string; filename: string; size: number; uploadedAt?: string}[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const { showTutorial, startTutorial, closeTutorial } = useSiteBuilderTutorial();

  const fetchUploadedImages = useCallback(async () => {
    try {
      const res = await fetch("/api/uploads");
      const data = await res.json();
      if (data.files) setUploadedImages(data.files);
    } catch {}
  }, []);

  useEffect(() => {
    fetchUploadedImages();
  }, [fetchUploadedImages]);

  const handleImageUpload = async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      const data = await res.json();
      if (data.url) {
        await fetchUploadedImages();
        toast({ title: "Image Uploaded", description: file.name });
      }
    } catch {
      toast({ title: "Upload Failed", description: "Could not upload image", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteImage = async (filename: string) => {
    try {
      await fetch(`/api/uploads/${filename}`, { method: "DELETE" });
      await fetchUploadedImages();
      toast({ title: "Image Deleted" });
    } catch {}
  };

  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      handleImageUpload(file);
    }
  };

  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versions, setVersions] = useState<SiteVersion[]>([]);
  const [currentSiteId, setCurrentSiteId] = useState<number | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);

  const [domainSiteId, setDomainSiteId] = useState<number | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [savingDomain, setSavingDomain] = useState(false);

  const [collabSiteId, setCollabSiteId] = useState<number | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [collabName, setCollabName] = useState("");
  const [collabEmail, setCollabEmail] = useState("");
  const [loadingCollabs, setLoadingCollabs] = useState(false);

  useEffect(() => {
    fetchSavedSites();
  }, []);

  const fetchSavedSites = async () => {
    try {
      const res = await fetch("/api/sites");
      if (res.ok) {
        const data = await res.json();
        setSavedSites(data);
      }
    } catch {}
  };

  const fetchVersions = useCallback(async (siteId: number) => {
    setLoadingVersions(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/versions`);
      if (res.ok) setVersions(await res.json());
    } catch {} finally {
      setLoadingVersions(false);
    }
  }, []);

  const fetchCollaborators = useCallback(async (siteId: number) => {
    setLoadingCollabs(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/collaborators`);
      if (res.ok) setCollaborators(await res.json());
    } catch {} finally {
      setLoadingCollabs(false);
    }
  }, []);

  const handleGenerate = async (overridePrompt?: string) => {
    const text = overridePrompt || prompt.trim();
    if (!text) return;
    setIsGenerating(true);
    setLastPrompt(text);
    if (!overridePrompt) setHistory((prev) => [...prev, text]);

    try {
      const imageUrls = uploadedImages.map((img) => img.url);
      const res = await fetch("/api/generate-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, uploadedImages: imageUrls }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Generation failed");
      }

      const data = await res.json();
      setSiteData(data);
      setCurrentSiteId(null);
    } catch (err: any) {
      toast({
        title: "Generation Failed",
        description: err.message || "Could not generate site. Try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
      setPrompt("");
    }
  };

  const handleRegenerate = () => {
    if (lastPrompt) handleGenerate(lastPrompt);
  };

  const handleSave = async () => {
    if (!siteData || !saveName.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveName.trim(),
          prompt: lastPrompt || "Untitled prompt",
          siteData,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const saved = await res.json();
      setCurrentSiteId(saved.id);

      await fetch(`/api/sites/${saved.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: saveName.trim() }),
      });

      await fetchSavedSites();
      setShowSaveDialog(false);
      setSaveName("");
      toast({ title: "Design Saved!", description: `"${saveName.trim()}" has been saved with version snapshot.` });
    } catch (err: any) {
      toast({ title: "Save Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoad = (site: SavedSite) => {
    const data = site.siteData as any;
    if (!data?.theme || !Array.isArray(data?.sections)) {
      toast({ title: "Invalid Design", description: "This saved design has missing data and can't be loaded.", variant: "destructive" });
      return;
    }
    setSiteData(data);
    setLastPrompt(site.prompt);
    setCurrentSiteId(site.id);
    setHistory((prev) => [...prev, `Loaded: ${site.name}`]);
    setShowSaved(false);
    toast({ title: "Design Loaded", description: `"${site.name}" is now in the preview.` });
  };

  const handleDelete = async (id: number, name: string) => {
    try {
      const res = await fetch(`/api/sites/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      await fetchSavedSites();
      toast({ title: "Deleted", description: `"${name}" has been removed.` });
    } catch (err: any) {
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
    }
  };

  const handlePublish = () => {
    toast({
      title: "Site Published!",
      description: "Your landing page is now live.",
    });
  };

  const handleRestoreVersion = (version: SiteVersion) => {
    const data = version.siteData as any;
    if (!data?.theme || !Array.isArray(data?.sections)) {
      toast({ title: "Invalid Version", description: "This version has corrupt data.", variant: "destructive" });
      return;
    }
    setSiteData(data);
    toast({ title: "Version Restored", description: `Restored to v${version.versionNumber}: ${version.label}` });
  };

  const openVersionHistory = () => {
    if (currentSiteId) {
      fetchVersions(currentSiteId);
    }
    setShowVersionHistory(true);
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    setSiteData((prev: any) => {
      const sections = [...prev.sections];
      const [moved] = sections.splice(dragIndex, 1);
      sections.splice(index, 0, moved);
      setDragIndex(index);
      return { ...prev, sections };
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragIndex(null);
  };

  const handleDeleteSection = (index: number) => {
    if (!confirm("Delete this section?")) return;
    setSiteData((prev: any) => ({
      ...prev,
      sections: prev.sections.filter((_: any, i: number) => i !== index),
    }));
    toast({ title: "Section Deleted" });
  };

  const handleUpdateSectionProps = (index: number, newProps: any) => {
    setSiteData((prev: any) => {
      const sections = [...prev.sections];
      sections[index] = { ...sections[index], props: newProps };
      return { ...prev, sections };
    });
    toast({ title: "Section Updated" });
  };

  const handleAddSection = (type: string) => {
    const defaults: Record<string, any> = {
      HERO: { title: "New Hero Section", subtitle: "Your subtitle here", cta: "Get Started", image: "", badge: "New" },
      FEATURES: { title: "Our Features", subtitle: "What makes us different", features: [{ icon: "Star", title: "Feature 1", desc: "Description" }, { icon: "Zap", title: "Feature 2", desc: "Description" }, { icon: "Heart", title: "Feature 3", desc: "Description" }] },
      BOOKING: { title: "Book Now", formId: "new-form" },
      PAYWALL: { title: "Choose Your Plan", tiers: [{ name: "Basic", price: 9, perks: ["Access to basic content", "Community chat"], cta: "Subscribe" }, { name: "Premium", price: 25, perks: ["All basic perks", "Exclusive content", "Direct messages"], cta: "Go Premium" }, { name: "VIP", price: 50, perks: ["Everything included", "Custom requests", "Priority access"], cta: "Join VIP" }] },
      CODE: { title: "Custom Code", code: "<h1 style=\"text-align:center;padding:40px;color:#6366f1;\">Hello World</h1>\n<p style=\"text-align:center;\">Edit this code to add your own HTML, CSS & JavaScript</p>" },
      BOT_EMBED: { title: "Chat Bot", code: "" },
      TESTIMONIALS: { title: "What Our Clients Say", subtitle: "Real results from real people", testimonials: [{ name: "Sarah Johnson", role: "CEO, TechCorp", quote: "Absolutely transformed our business. The results speak for themselves.", stars: 5 }, { name: "Mike Chen", role: "Founder, StartupXYZ", quote: "Best decision we made this year. ROI was incredible.", stars: 5 }, { name: "Emma Davis", role: "Marketing Director", quote: "Professional, responsive, and delivered beyond expectations.", stars: 5 }] },
      STATS: { title: "By The Numbers", stats: [{ value: "500+", label: "Clients Served" }, { value: "98%", label: "Satisfaction Rate" }, { value: "10+", label: "Years Experience" }, { value: "24/7", label: "Support" }] },
      GALLERY: { title: "Our Work", subtitle: "See what we've accomplished", images: [{ url: "", caption: "Project 1" }, { url: "", caption: "Project 2" }, { url: "", caption: "Project 3" }] },
      ABOUT: { title: "About Us", text: "We are passionate about delivering exceptional results. With years of experience and a dedicated team, we help businesses achieve their goals.", image: "" },
      CTA: { title: "Ready to Get Started?", subtitle: "Join thousands of satisfied customers today.", cta: "Start Now" },
      FAQ: { title: "Frequently Asked Questions", faqs: [{ q: "How does it work?", a: "Simply sign up, choose your plan, and get started in minutes." }, { q: "Is there a free trial?", a: "Yes, we offer a 14-day free trial with no credit card required." }, { q: "Can I cancel anytime?", a: "Absolutely. No contracts, no hidden fees." }] },
      PRICING: { title: "Simple Pricing", subtitle: "Choose the plan that works for you", plans: [{ name: "Starter", description: "For individuals", price: 29, period: "mo", features: ["1 User", "5 Projects", "Basic Support"], cta: "Get Started" }, { name: "Pro", description: "For growing teams", price: 79, period: "mo", features: ["5 Users", "Unlimited Projects", "Priority Support", "Analytics"], cta: "Choose Pro", featured: true }, { name: "Enterprise", description: "For large orgs", price: 199, period: "mo", features: ["Unlimited Users", "Custom Integrations", "Dedicated Manager", "SLA"], cta: "Contact Sales" }] },
      TEAM: { title: "Meet Our Team", subtitle: "The people behind the magic", members: [{ name: "Alex Smith", role: "CEO" }, { name: "Jordan Lee", role: "CTO" }, { name: "Taylor Kim", role: "Design Lead" }, { name: "Casey Brown", role: "Marketing" }] },
      LOGO_BAR: { title: "Trusted By Leading Brands", logos: ["Google", "Apple", "Microsoft", "Amazon", "Netflix"] },
      TIMELINE: { title: "Our Journey", subtitle: "How we got here", events: [{ date: "2020", title: "Founded", desc: "Started with a vision" }, { date: "2021", title: "First 100 Clients", desc: "Rapid growth phase" }, { date: "2022", title: "Series A Funding", desc: "Raised $10M" }, { date: "2023", title: "Global Expansion", desc: "Opened 3 new offices" }] },
      CONTACT: { title: "Get In Touch", subtitle: "We'd love to hear from you", fields: ["Name", "Email", "Phone", "Message"] },
      VIDEO: { title: "See It In Action", subtitle: "Watch how we help businesses grow" },
      BANNER: { title: "Limited Time Offer", subtitle: "Get 50% off your first month", cta: "Claim Offer", image: "" },
      COMPARISON: { title: "Why Choose Us", subtitle: "See how we compare", headers: ["Feature", "Us", "Others"], rows: [{ cells: ["24/7 Support", "✓", "✗"] }, { cells: ["Custom Solutions", "✓", "✗"] }, { cells: ["Free Onboarding", "✓", "✗"] }, { cells: ["No Contracts", "✓", "✗"] }] },
      PROCESS_STEPS: { title: "How It Works", subtitle: "Get started in 4 easy steps", steps: [{ title: "Sign Up", desc: "Create your free account" }, { title: "Customize", desc: "Set up your preferences" }, { title: "Launch", desc: "Go live in minutes" }, { title: "Grow", desc: "Watch your business thrive" }] },
      QR_CODE: { title: "Scan & Connect", subtitle: "Point your phone camera at the QR code to get started instantly", qrValue: "https://yoursite.com", qrLabel: "Works with any phone camera", cta: "Get Started" },
    };
    setSiteData((prev: any) => ({
      ...prev,
      sections: [...prev.sections, { type, props: defaults[type] }],
    }));
    setAddSectionOpen(false);
    toast({ title: "Section Added", description: `Added ${type} section` });
  };

  const handleSaveDomain = async (siteId: number) => {
    setSavingDomain(true);
    try {
      const res = await fetch(`/api/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customDomain: domainInput.trim() }),
      });
      if (!res.ok) throw new Error("Failed to save domain");
      await fetchSavedSites();
      setDomainSiteId(null);
      setDomainInput("");
      toast({ title: "Domain Connected", description: `Domain "${domainInput.trim()}" has been set.` });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingDomain(false);
    }
  };

  const handleAddCollaborator = async () => {
    if (!collabSiteId || !collabName.trim() || !collabEmail.trim()) return;
    try {
      const res = await fetch(`/api/sites/${collabSiteId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: collabName.trim(), email: collabEmail.trim(), role: "editor" }),
      });
      if (!res.ok) throw new Error("Failed to add collaborator");
      setCollabName("");
      setCollabEmail("");
      await fetchCollaborators(collabSiteId);
      toast({ title: "Collaborator Added" });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleRemoveCollaborator = async (collabId: number) => {
    if (!collabSiteId) return;
    try {
      await fetch(`/api/collaborators/${collabId}`, { method: "DELETE" });
      await fetchCollaborators(collabSiteId);
      toast({ title: "Collaborator Removed" });
    } catch {}
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: "Invite code copied to clipboard." });
  };

  const SITE_TEMPLATES = [
    {
      id: "gym-aggressive",
      name: "Iron Forge Gym",
      industry: "Fitness",
      icon: Dumbbell,
      color: "#ef4444",
      description: "High-energy gym landing page with bold red/black theme and aggressive copy",
      siteData: {
        theme: { bg: "#0a0a0a", primary: "#ef4444", text: "#ffffff", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "CRUSH YOUR LIMITS", subtitle: "Elite training for those who refuse to settle. Transform your body in 90 days or your money back.", cta: "START FREE TRIAL", image: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "WHY IRON FORGE", features: [{ icon: "Dumbbell", title: "Pro Equipment", desc: "Olympic-grade free weights, machines, and functional training rigs" }, { icon: "Zap", title: "Expert Coaches", desc: "NASM-certified trainers with competition experience" }, { icon: "Trophy", title: "Results Guaranteed", desc: "90-day transformation guarantee or your money back" }] } },
          { type: "BOOKING", props: { title: "Claim Your Free Session", formId: "gym-trial" } },
        ],
      },
    },
    {
      id: "medspa-luxury",
      name: "Lumière Med Spa",
      industry: "Med Spa",
      icon: Sparkles,
      color: "#d4a574",
      description: "Elegant luxury med spa with gold/black theme and premium aesthetic",
      siteData: {
        theme: { bg: "#0c0a09", primary: "#d4a574", text: "#fafaf9", font: "Playfair Display" },
        sections: [
          { type: "HERO", props: { title: "Timeless Beauty, Refined", subtitle: "Experience the art of aesthetic medicine at Manhattan's most exclusive med spa. Botox, fillers, and advanced skincare treatments.", cta: "Book Consultation", image: "https://images.unsplash.com/photo-1560750588-73207b1ef5b8?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Our Signature Services", features: [{ icon: "Sparkles", title: "Botox & Fillers", desc: "Natural-looking results from board-certified injectors" }, { icon: "Heart", title: "Laser Treatments", desc: "Advanced laser skin resurfacing and hair removal" }, { icon: "ShieldCheck", title: "Medical Grade", desc: "FDA-approved treatments in a luxurious clinical setting" }] } },
          { type: "BOOKING", props: { title: "Schedule Your Consultation", formId: "medspa-consult" } },
        ],
      },
    },
    {
      id: "dental-clean",
      name: "Bright Smile Dental",
      industry: "Dental",
      icon: Stethoscope,
      color: "#3b82f6",
      description: "Clean, friendly dental practice with calming blue/white professional theme",
      siteData: {
        theme: { bg: "#0f172a", primary: "#3b82f6", text: "#f1f5f9", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Your Smile Deserves the Best", subtitle: "Gentle, modern dentistry for the whole family. Same-day appointments available with flexible payment plans.", cta: "Book Appointment", image: "https://images.unsplash.com/photo-1629909613654-28e377c37b09?q=80&w=2068&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Why Choose Us", features: [{ icon: "ShieldCheck", title: "Gentle Care", desc: "Anxiety-free dentistry with sedation options available" }, { icon: "Clock", title: "Same-Day Service", desc: "Emergency appointments and quick turnaround on procedures" }, { icon: "Star", title: "5-Star Rated", desc: "Over 2,000 happy patients and counting" }] } },
          { type: "BOOKING", props: { title: "Request Your Appointment", formId: "dental-appt" } },
        ],
      },
    },
    {
      id: "restaurant-warm",
      name: "Ember Kitchen",
      industry: "Restaurant",
      icon: UtensilsCrossed,
      color: "#f59e0b",
      description: "Warm, inviting restaurant page with amber tones and appetizing copy",
      siteData: {
        theme: { bg: "#1c1917", primary: "#f59e0b", text: "#fafaf9", font: "Playfair Display" },
        sections: [
          { type: "HERO", props: { title: "Farm to Table, Fire to Soul", subtitle: "Handcrafted dishes using locally sourced ingredients, wood-fired to perfection. Reserve your table tonight.", cta: "Reserve a Table", image: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "The Ember Experience", features: [{ icon: "Star", title: "Chef's Tasting Menu", desc: "A curated 7-course journey through seasonal flavors" }, { icon: "Heart", title: "Local Ingredients", desc: "Partnerships with 12+ local farms and artisan producers" }, { icon: "Trophy", title: "Award Winning", desc: "Zagat rated, James Beard nominated, community loved" }] } },
          { type: "BOOKING", props: { title: "Make a Reservation", formId: "restaurant-reserve" } },
        ],
      },
    },
    {
      id: "realestate-modern",
      name: "Apex Realty",
      industry: "Real Estate",
      icon: Building2,
      color: "#10b981",
      description: "Modern real estate agency with sleek green/dark theme and property focus",
      siteData: {
        theme: { bg: "#0f1115", primary: "#10b981", text: "#e2e8f0", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Find Your Dream Home", subtitle: "Luxury properties, expert agents, and a seamless buying experience. Browse 500+ exclusive listings today.", cta: "Browse Listings", image: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?q=80&w=2075&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Why Apex Realty", features: [{ icon: "ShieldCheck", title: "Trusted Agents", desc: "Licensed professionals with 15+ years of market experience" }, { icon: "Zap", title: "Fast Closings", desc: "Average 21-day close with our streamlined process" }, { icon: "Star", title: "Premium Listings", desc: "Exclusive access to off-market and pre-launch properties" }] } },
          { type: "BOOKING", props: { title: "Schedule a Viewing", formId: "realty-viewing" } },
        ],
      },
    },
    {
      id: "salon-chic",
      name: "Velvet Salon",
      industry: "Salon",
      icon: Scissors,
      color: "#ec4899",
      description: "Chic hair salon with pink/dark glam theme and trendy styling",
      siteData: {
        theme: { bg: "#18181b", primary: "#ec4899", text: "#fafafa", font: "Playfair Display" },
        sections: [
          { type: "HERO", props: { title: "Where Style Meets Art", subtitle: "Award-winning stylists creating looks that turn heads. Balayage, cuts, extensions, and bridal packages.", cta: "Book Your Look", image: "https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=2074&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Our Services", features: [{ icon: "Sparkles", title: "Color & Balayage", desc: "Hand-painted highlights and vivid color transformations" }, { icon: "Star", title: "Precision Cuts", desc: "Tailored cuts from NYC-trained master stylists" }, { icon: "Heart", title: "Bridal Packages", desc: "Full bridal party styling with trial sessions included" }] } },
          { type: "BOOKING", props: { title: "Book Your Appointment", formId: "salon-booking" } },
        ],
      },
    },
    {
      id: "coaching-pro",
      name: "Peak Performance",
      industry: "Coaching",
      icon: GraduationCap,
      color: "#8b5cf6",
      description: "Professional business coaching with purple/dark authority theme",
      siteData: {
        theme: { bg: "#0c0a1a", primary: "#8b5cf6", text: "#e2e8f0", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Unlock Your Full Potential", subtitle: "Executive coaching for ambitious leaders. 10x your revenue, build elite teams, and dominate your industry.", cta: "Apply Now", image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "The Peak Method", features: [{ icon: "Trophy", title: "Proven Framework", desc: "The same system used by 200+ CEOs to scale past 7 figures" }, { icon: "Zap", title: "1-on-1 Mentoring", desc: "Weekly private sessions with a dedicated success coach" }, { icon: "CheckCircle2", title: "Accountability", desc: "Daily tracking, weekly reviews, and monthly strategy pivots" }] } },
          { type: "BOOKING", props: { title: "Book a Strategy Call", formId: "coaching-call" } },
        ],
      },
    },
    {
      id: "auto-bold",
      name: "Apex Auto Detailing",
      industry: "Automotive",
      icon: Car,
      color: "#06b6d4",
      description: "Bold auto detailing shop with cyan/dark high-performance theme",
      siteData: {
        theme: { bg: "#0a0f1a", primary: "#06b6d4", text: "#f0f9ff", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Showroom Finish, Every Time", subtitle: "Professional ceramic coating, paint correction, and full detailing. Your ride deserves the best treatment.", cta: "Get a Quote", image: "https://images.unsplash.com/photo-1507136566006-cfc505b114fc?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Our Packages", features: [{ icon: "ShieldCheck", title: "Ceramic Coating", desc: "9H hardness coating with 5-year warranty and hydrophobic protection" }, { icon: "Sparkles", title: "Paint Correction", desc: "Multi-stage machine polishing to remove swirls and scratches" }, { icon: "Star", title: "Full Detail", desc: "Interior deep clean, exterior polish, and engine bay detailing" }] } },
          { type: "BOOKING", props: { title: "Schedule Your Detail", formId: "auto-detail" } },
        ],
      },
    },
    {
      id: "law-firm",
      name: "Sterling & Associates",
      industry: "Legal",
      icon: Briefcase,
      color: "#1e40af",
      description: "Authoritative law firm page with deep blue/dark professional theme",
      siteData: {
        theme: { bg: "#0c1222", primary: "#1e40af", text: "#e2e8f0", font: "Playfair Display" },
        sections: [
          { type: "HERO", props: { title: "Justice. Integrity. Results.", subtitle: "Over 30 years of trial-tested experience in personal injury, business law, and estate planning. Free consultations.", cta: "Free Consultation", image: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Practice Areas", features: [{ icon: "ShieldCheck", title: "Personal Injury", desc: "No fee unless we win. Millions recovered for our clients" }, { icon: "Star", title: "Business Law", desc: "Contracts, compliance, and corporate litigation expertise" }, { icon: "CheckCircle2", title: "Estate Planning", desc: "Wills, trusts, and comprehensive asset protection strategies" }] } },
          { type: "BOOKING", props: { title: "Request a Free Case Review", formId: "law-consult" } },
        ],
      },
    },
    {
      id: "yoga-zen",
      name: "Serenity Studio",
      industry: "Yoga & Wellness",
      icon: Heart,
      color: "#a3e635",
      description: "Zen yoga studio with calming green/dark natural wellness theme",
      siteData: {
        theme: { bg: "#0a1a0a", primary: "#a3e635", text: "#ecfccb", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Breathe. Flow. Transform.", subtitle: "Discover inner peace through yoga, meditation, and holistic wellness. All levels welcome, first class free.", cta: "Try a Free Class", image: "https://images.unsplash.com/photo-1545389336-cf090694435e?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Our Offerings", features: [{ icon: "Heart", title: "Vinyasa Flow", desc: "Dynamic movement sequences synchronized with breath" }, { icon: "Sparkles", title: "Sound Healing", desc: "Crystal bowl meditation and chakra balancing sessions" }, { icon: "Clock", title: "Flexible Schedule", desc: "Classes from 6am to 9pm, 7 days a week" }] } },
          { type: "BOOKING", props: { title: "Reserve Your Mat", formId: "yoga-class" } },
        ],
      },
    },
    {
      id: "creator-glam",
      name: "Velvet Glow",
      industry: "Adult Creator",
      icon: Crown,
      color: "#e879f9",
      description: "Premium indie creator page with purple/pink glam aesthetic and VIP subscription paywall",
      siteData: {
        theme: { bg: "#0d0015", primary: "#e879f9", text: "#fae8ff", font: "Playfair Display" },
        sections: [
          { type: "HERO", props: { title: "Exclusive. Bold. Unapologetic.", subtitle: "Your all-access pass to premium content, private messages, and behind-the-scenes drops. Join the VIP list.", cta: "Subscribe Now", image: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2064&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "What You Get", features: [{ icon: "Crown", title: "VIP Content", desc: "Exclusive photos, videos, and livestreams updated weekly" }, { icon: "Heart", title: "Direct Messages", desc: "Private 1-on-1 messaging and custom content requests" }, { icon: "Star", title: "Early Access", desc: "Be the first to see new drops and limited releases" }] } },
          { type: "PAYWALL", props: { title: "Choose Your Access", tiers: [{ name: "Peek", price: 5, perks: ["Weekly photo drops", "Community feed access"], cta: "Start Peeking" }, { name: "VIP", price: 20, perks: ["All Peek perks", "Exclusive video content", "Priority DMs"], cta: "Go VIP" }, { name: "Inner Circle", price: 50, perks: ["Everything included", "Custom content requests", "1-on-1 video calls", "Early access to collabs"], cta: "Join Inner Circle" }] } },
        ],
      },
    },
    {
      id: "creator-dark",
      name: "Midnight Muse",
      industry: "Adult Creator",
      icon: Flame,
      color: "#f43f5e",
      description: "Dark, sultry creator page with red/black bold theme and subscription tiers",
      siteData: {
        theme: { bg: "#0a0000", primary: "#f43f5e", text: "#ffe4e6", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Welcome to My World", subtitle: "Curated content, exclusive drops, and a community that gets it. All links, all platforms, one place.", cta: "See My Content", image: "https://images.unsplash.com/photo-1557682250-33bd709cbe85?q=80&w=2029&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Find Me Here", features: [{ icon: "Flame", title: "Premium Feed", desc: "Subscribe for the full uncensored experience" }, { icon: "Camera", title: "Photo Sets", desc: "Professional themed shoots released monthly" }, { icon: "Zap", title: "Live Sessions", desc: "Weekly live streams with real-time interaction" }] } },
          { type: "PAYWALL", props: { title: "Unlock the Full Experience", tiers: [{ name: "Fan", price: 7, perks: ["Access to the feed", "Monthly photo set"], cta: "Subscribe" }, { name: "Superfan", price: 25, perks: ["All Fan perks", "Behind-the-scenes content", "DM access"], cta: "Upgrade" }, { name: "Obsessed", price: 55, perks: ["Everything unlocked", "Custom requests", "Live private sessions", "Name in credits"], cta: "Go All In" }] } },
        ],
      },
    },
    {
      id: "creator-luxe",
      name: "Gilded Rose",
      industry: "Adult Creator",
      icon: Sparkles,
      color: "#fbbf24",
      description: "Luxury gold-themed creator page with high-end tiered membership paywall",
      siteData: {
        theme: { bg: "#0f0d08", primary: "#fbbf24", text: "#fef3c7", font: "Playfair Display" },
        sections: [
          { type: "HERO", props: { title: "Art. Allure. Access.", subtitle: "A curated luxury experience for discerning fans. Three tiers of exclusive membership with escalating perks.", cta: "Choose Your Tier", image: "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Membership Tiers", features: [{ icon: "Star", title: "Bronze Access", desc: "Weekly photo sets and community chat" }, { icon: "Sparkles", title: "Silver Access", desc: "Video content, DMs, and exclusive drops" }, { icon: "Crown", title: "Gold Access", desc: "Custom content, video calls, priority everything" }] } },
          { type: "PAYWALL", props: { title: "Select Your Membership", tiers: [{ name: "Bronze", price: 9, perks: ["Weekly photo sets", "Community chat access"], cta: "Join Bronze" }, { name: "Silver", price: 25, perks: ["All Bronze perks", "Video content library", "Direct messages"], cta: "Join Silver" }, { name: "Gold", price: 50, perks: ["Everything included", "Custom content requests", "Monthly video calls", "Priority access"], cta: "Join Gold" }] } },
        ],
      },
    },
    {
      id: "creator-neon",
      name: "Neon Nights",
      industry: "Adult Creator",
      icon: Camera,
      color: "#22d3ee",
      description: "Cyberpunk neon-themed creator page with electric cyan aesthetic and paywall",
      siteData: {
        theme: { bg: "#020617", primary: "#22d3ee", text: "#cffafe", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Plug In. Turn On.", subtitle: "Digital-first content creator with a vibe that hits different. Exclusive drops, collabs, and 24/7 access.", cta: "Enter the Feed", image: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "The Experience", features: [{ icon: "Zap", title: "Daily Content", desc: "Fresh uploads every single day across all platforms" }, { icon: "Camera", title: "Cinematic Quality", desc: "Studio-grade production on every piece of content" }, { icon: "Heart", title: "Fan Community", desc: "Private Discord with exclusive rooms and events" }] } },
          { type: "PAYWALL", props: { title: "Pick Your Frequency", tiers: [{ name: "Tuned In", price: 8, perks: ["Daily content feed", "Community access"], cta: "Tune In" }, { name: "Dialed Up", price: 22, perks: ["All Tuned In perks", "HD video drops", "Behind-the-scenes"], cta: "Dial Up" }, { name: "Maxed Out", price: 45, perks: ["Full access everything", "Collab requests", "Live sessions", "Merch discounts"], cta: "Max Out" }] } },
        ],
      },
    },
    {
      id: "creator-minimal",
      name: "Bare Canvas",
      industry: "Adult Creator",
      icon: Music,
      color: "#a78bfa",
      description: "Minimalist artistic creator page with soft violet tones and subscription paywall",
      siteData: {
        theme: { bg: "#0c0a15", primary: "#a78bfa", text: "#ede9fe", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Less Noise. More Art.", subtitle: "A clean, intentional space for creators who value aesthetic over everything. Minimalist content, maximum impact.", cta: "View Portfolio", image: "https://images.unsplash.com/photo-1618005198919-d3d4b5a92ead?q=80&w=2074&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "What I Offer", features: [{ icon: "Sparkles", title: "Curated Gallery", desc: "Hand-picked portfolio of my best artistic work" }, { icon: "Heart", title: "Intimate Access", desc: "Behind-the-scenes process and personal journal entries" }, { icon: "Star", title: "Prints & Merch", desc: "Limited edition prints and exclusive branded merchandise" }] } },
          { type: "PAYWALL", props: { title: "Support My Art", tiers: [{ name: "Admirer", price: 6, perks: ["Monthly curated gallery", "Journal entries"], cta: "Support" }, { name: "Patron", price: 18, perks: ["All Admirer perks", "Process videos", "Early print access"], cta: "Become Patron" }, { name: "Muse", price: 40, perks: ["Everything included", "Commission priority", "Signed prints", "Creative direction input"], cta: "Be My Muse" }] } },
        ],
      },
    },
  ];

  const handleLoadTemplate = (template: typeof SITE_TEMPLATES[0]) => {
    setSiteData(template.siteData);
    setLastPrompt(`Template: ${template.name}`);
    setHistory((prev) => [...prev, `Loaded template: ${template.name}`]);
    setCurrentSiteId(null);
    setShowTemplates(false);
    toast({ title: "Template Loaded", description: `"${template.name}" is ready to customize.` });
  };

  const COMPONENT_MAP: Record<string, React.ComponentType<any>> = {
    HERO: HeroSection,
    FEATURES: FeatureSection,
    BOOKING: BookingSection,
    PAYWALL: PaywallSection,
    CODE: CodeSection,
    BOT_EMBED: BotEmbedSection,
    TESTIMONIALS: TestimonialsSection,
    STATS: StatsSection,
    GALLERY: GallerySection,
    ABOUT: AboutSection,
    CTA: CtaSection,
    FAQ: FaqSection,
    PRICING: PricingSection,
    TEAM: TeamSection,
    LOGO_BAR: LogoBarSection,
    TIMELINE: TimelineSection,
    CONTACT: ContactSection,
    VIDEO: VideoSection,
    BANNER: BannerSection,
    COMPARISON: ComparisonSection,
    PROCESS_STEPS: ProcessStepsSection,
    QR_CODE: QrCodeSection,
  };

  return (
    <div className="min-h-screen bg-[#030014] text-white flex flex-col md:flex-row font-sans relative">
      <div className="fixed inset-0 bg-grid z-0 pointer-events-none" />
      <div className="fixed top-0 left-0 w-full h-[500px] bg-gradient-to-b from-indigo-900/10 to-transparent pointer-events-none z-0" />

      <div className="w-full md:w-[400px] border-r border-white/10 flex flex-col glass-panel z-10 md:min-h-screen relative">
        <div className="p-6 border-b border-white/5">
          <h1 className="text-xl font-bold flex items-center gap-2 glow-text">
            <LayoutTemplate className="text-indigo-400 drop-shadow-[0_0_8px_rgba(129,140,248,0.5)]" />
            Site Architect
          </h1>
          <p className="text-xs text-slate-500 mt-1 font-mono">
            AI-POWERED // DESCRIBE &rarr; GENERATE
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {history.length === 0 && (
            <div className="text-center text-slate-500 mt-10 text-sm p-4 border border-dashed border-white/10 rounded-xl glass">
              <p className="mb-3">Try prompts like:</p>
              <ul className="space-y-2 text-indigo-400">
                <li>
                  <button
                    className="hover:underline text-left"
                    onClick={() =>
                      setPrompt(
                        "Gym landing page, aggressive red/black theme"
                      )
                    }
                    data-testid="button-prompt-gym"
                  >
                    "Gym landing page, aggressive style"
                  </button>
                </li>
                <li>
                  <button
                    className="hover:underline text-left"
                    onClick={() =>
                      setPrompt(
                        "Luxury med spa funnel, gold and black theme"
                      )
                    }
                    data-testid="button-prompt-luxe"
                  >
                    "Luxury med spa, gold & black"
                  </button>
                </li>
                <li>
                  <button
                    className="hover:underline text-left"
                    onClick={() =>
                      setPrompt(
                        "Dentist funnel, clean blue/white, friendly"
                      )
                    }
                    data-testid="button-prompt-dental"
                  >
                    "Dentist funnel, clean & friendly"
                  </button>
                </li>
              </ul>
              <div className="mt-4 pt-3 border-t border-white/10">
                <button
                  onClick={() => setShowTemplates(true)}
                  className="flex items-center gap-2 mx-auto text-indigo-400 hover:text-indigo-300 transition-colors"
                  data-testid="button-browse-templates-empty"
                >
                  <Palette size={16} />
                  Or browse Template Gallery
                </button>
              </div>
            </div>
          )}
          {history.map((h, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass p-3 rounded-lg text-sm"
            >
              <span className="opacity-50 text-xs block mb-1 font-mono">YOU</span>
              {h}
            </motion.div>
          ))}
          {isGenerating && (
            <div className="flex items-center gap-2 text-indigo-400 text-sm animate-pulse">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating layout & copy...
            </div>
          )}
          {siteData && !isGenerating && history.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-indigo-500/10 p-3 rounded-lg text-sm border border-indigo-500/20 glow-box"
            >
              <span className="opacity-50 text-xs block mb-1 font-mono">AI</span>
              <div className="flex items-center gap-2 text-indigo-300">
                <CheckCircle2 className="h-4 w-4" />
                Site generated with {siteData.sections.length} sections.
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Theme: {siteData.theme.font} /{" "}
                <span
                  className="inline-block w-3 h-3 rounded-full align-middle"
                  style={{ backgroundColor: siteData.theme.primary }}
                />{" "}
                {siteData.theme.primary}
              </p>
            </motion.div>
          )}
        </div>

        <AnimatePresence>
          {showImageLibrary && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-white/10 overflow-hidden"
            >
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-indigo-400 flex items-center gap-2">
                    <ImagePlus size={14} />
                    Image Library
                  </h3>
                  <span className="text-xs text-slate-500">{uploadedImages.length} images</span>
                </div>

                <div
                  className="border-2 border-dashed border-white/10 rounded-xl p-4 text-center cursor-pointer hover:border-indigo-500/50 transition-colors relative"
                  onDrop={handleImageDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => document.getElementById("image-upload-input")?.click()}
                  data-testid="dropzone-image-upload"
                >
                  {isUploading ? (
                    <div className="flex items-center justify-center gap-2 text-indigo-400">
                      <Loader2 size={16} className="animate-spin" />
                      <span className="text-xs">Uploading...</span>
                    </div>
                  ) : (
                    <>
                      <Upload size={20} className="mx-auto text-slate-500 mb-1" />
                      <p className="text-xs text-slate-500">Drop image here or click to upload</p>
                      <p className="text-[10px] text-slate-600 mt-1">JPG, PNG, GIF, WebP, SVG (max 10MB)</p>
                    </>
                  )}
                  <input
                    id="image-upload-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(file);
                      e.target.value = "";
                    }}
                    data-testid="input-image-upload"
                  />
                </div>

                {uploadedImages.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                    {uploadedImages.map((img) => (
                      <div
                        key={img.filename}
                        className="relative group aspect-square rounded-lg overflow-hidden border border-white/10 cursor-pointer hover:border-indigo-500/50 transition-colors"
                        onClick={() => {
                          navigator.clipboard.writeText(img.url);
                          toast({ title: "URL Copied", description: "Image URL copied to clipboard" });
                        }}
                        data-testid={`image-thumbnail-${img.filename}`}
                      >
                        <img src={img.url} alt={img.filename} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <div className="text-center">
                            <Copy size={14} className="mx-auto text-white mb-1" />
                            <span className="text-[10px] text-white">Copy URL</span>
                          </div>
                        </div>
                        <button
                          className="absolute top-1 right-1 p-1 bg-red-500/80 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteImage(img.filename);
                          }}
                          data-testid={`button-delete-image-${img.filename}`}
                        >
                          <Trash2 size={10} className="text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="p-4 bg-black/40 border-t border-white/5 backdrop-blur-md space-y-2">
          <div className="flex gap-2">
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the website..."
              className="bg-white/5 border-white/10 focus:border-indigo-500"
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              data-testid="input-prompt"
            />
            <Button
              onClick={() => handleGenerate()}
              disabled={isGenerating || !prompt.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20"
              data-testid="button-generate"
            >
              <Send size={18} />
            </Button>
          </div>
          <button
            onClick={() => setShowTemplates(true)}
            className="w-full flex items-center justify-center gap-2 text-xs text-slate-400 hover:text-indigo-400 transition-colors py-1.5 rounded-lg border border-dashed border-white/10 hover:border-indigo-500/30"
            data-testid="button-open-templates"
          >
            <Palette size={14} />
            Browse Template Gallery
          </button>
          <button
            onClick={() => setShowImageLibrary(!showImageLibrary)}
            className="w-full flex items-center justify-center gap-2 text-xs text-slate-400 hover:text-indigo-400 transition-colors py-1.5 rounded-lg border border-dashed border-white/10 hover:border-indigo-500/30"
            data-testid="button-toggle-image-library"
          >
            <ImagePlus size={14} />
            {showImageLibrary ? "Hide Image Library" : "Image Library"}
          </button>
        </div>
      </div>

      <div className="flex-1 relative flex flex-col bg-black/40 backdrop-blur-sm z-10">
        <div className="h-16 border-b border-white/5 flex items-center justify-between px-6 bg-white/5 backdrop-blur-md sticky top-0 z-50">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-black/50 p-1 rounded-lg border border-white/5">
              <button
                onClick={() => setViewMode("desktop")}
                className={`p-2 rounded transition-colors ${
                  viewMode === "desktop"
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                    : "text-slate-400 hover:text-white"
                }`}
                data-testid="button-view-desktop"
              >
                <Monitor size={16} />
              </button>
              <button
                onClick={() => setViewMode("mobile")}
                className={`p-2 rounded transition-colors ${
                  viewMode === "mobile"
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                    : "text-slate-400 hover:text-white"
                }`}
                data-testid="button-view-mobile"
              >
                <Smartphone size={16} />
              </button>
            </div>
            {siteData && (
              <button
                onClick={() => setEditMode(!editMode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                  editMode
                    ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                    : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
                }`}
                data-testid="button-toggle-edit-mode"
              >
                {editMode ? <EyeOff size={14} /> : <Eye size={14} />}
                {editMode ? "Exit Edit" : "Edit Mode"}
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-white/10 hover:bg-white/5 text-slate-300"
              onClick={() => setShowSaved(true)}
              data-testid="button-load-designs"
            >
              <FolderOpen size={14} className="mr-2" /> My Designs{savedSites.length > 0 && ` (${savedSites.length})`}
            </Button>
            {currentSiteId && (
              <Button
                variant="outline"
                size="sm"
                className="border-white/10 hover:bg-white/5 text-slate-300"
                onClick={openVersionHistory}
                data-testid="button-version-history"
              >
                <History size={14} className="mr-2" /> Versions
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="border-white/10 hover:bg-white/5 text-slate-300"
              onClick={handleRegenerate}
              disabled={!lastPrompt || isGenerating}
              data-testid="button-regenerate"
            >
              <RefreshCcw size={14} className="mr-2" /> Regenerate
            </Button>
            <Button
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
              onClick={() => { setSaveName(""); setShowSaveDialog(true); }}
              disabled={!siteData}
              data-testid="button-save-design"
            >
              <Save size={14} className="mr-2" /> Save
            </Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-500/20"
              onClick={handlePublish}
              disabled={!siteData}
              data-testid="button-publish"
            >
              Publish
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-indigo-500/30 hover:bg-indigo-500/10 text-indigo-400 hover:text-indigo-300"
              onClick={startTutorial}
              data-testid="button-start-tutorial"
            >
              <Info size={14} className="mr-1" /> Tutorial
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-8 flex justify-center items-start bg-[radial-gradient(#2a2a2a_1px,transparent_1px)] [background-size:16px_16px]">
          {siteData ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className={`bg-white shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] overflow-hidden transition-all duration-500 ease-in-out ${
                viewMode === "mobile"
                  ? "w-[375px] rounded-[30px] border-[8px] border-neutral-900"
                  : "w-full max-w-5xl rounded-lg border-[8px] border-neutral-900"
              }`}
              style={{ minHeight: "800px" }}
              data-testid="preview-canvas"
            >
              {siteData.sections.map((section: any, i: number) => {
                const Component = COMPONENT_MAP[section.type];
                if (!Component) return null;
                const props = { ...section.props, theme: siteData.theme };

                if (editMode) {
                  return (
                    <div
                      key={i}
                      className={`relative group border-2 transition-colors ${dragIndex === i ? "border-indigo-500 bg-indigo-500/5" : "border-transparent hover:border-indigo-500/30"}`}
                      draggable
                      onDragStart={() => handleDragStart(i)}
                      onDragOver={(e) => handleDragOver(e, i)}
                      onDrop={handleDrop}
                      onDragEnd={() => setDragIndex(null)}
                      data-testid={`section-wrapper-${i}`}
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-10 flex flex-col items-center justify-center gap-1 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-grab">
                        <GripVertical size={18} className="text-white/70" />
                      </div>
                      <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                        <button
                          onClick={() => setEditingSectionIndex(editingSectionIndex === i ? null : i)}
                          className="p-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500"
                          data-testid={`button-edit-section-${i}`}
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteSection(i)}
                          className="p-1.5 rounded bg-red-600 text-white hover:bg-red-500"
                          data-testid={`button-delete-section-${i}`}
                        >
                          <Trash2 size={14} />
                        </button>
                        {i > 0 && (
                          <button
                            onClick={() => {
                              setSiteData((prev: any) => {
                                const s = [...prev.sections];
                                [s[i - 1], s[i]] = [s[i], s[i - 1]];
                                return { ...prev, sections: s };
                              });
                            }}
                            className="p-1.5 rounded bg-white/10 text-white hover:bg-white/20"
                            data-testid={`button-move-up-${i}`}
                          >
                            <ArrowUp size={14} />
                          </button>
                        )}
                        {i < siteData.sections.length - 1 && (
                          <button
                            onClick={() => {
                              setSiteData((prev: any) => {
                                const s = [...prev.sections];
                                [s[i], s[i + 1]] = [s[i + 1], s[i]];
                                return { ...prev, sections: s };
                              });
                            }}
                            className="p-1.5 rounded bg-white/10 text-white hover:bg-white/20"
                            data-testid={`button-move-down-${i}`}
                          >
                            <ArrowDown size={14} />
                          </button>
                        )}
                      </div>
                      <AnimatePresence>
                        {editingSectionIndex === i && (
                          <SectionEditor
                            section={section}
                            index={i}
                            onUpdate={handleUpdateSectionProps}
                            onClose={() => setEditingSectionIndex(null)}
                          />
                        )}
                      </AnimatePresence>
                      <Component {...props} />
                    </div>
                  );
                }

                return <Component key={i} {...props} />;
              })}

              {editMode && (
                <div className="p-4 flex justify-center">
                  {addSectionOpen ? (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-wrap gap-1.5 max-w-md justify-center"
                    >
                      {[
                        { type: "HERO", label: "Hero" },
                        { type: "FEATURES", label: "Features" },
                        { type: "TESTIMONIALS", label: "Reviews" },
                        { type: "STATS", label: "Stats" },
                        { type: "ABOUT", label: "About" },
                        { type: "GALLERY", label: "Gallery" },
                        { type: "CTA", label: "CTA" },
                        { type: "FAQ", label: "FAQ" },
                        { type: "PRICING", label: "Pricing" },
                        { type: "TEAM", label: "Team" },
                        { type: "LOGO_BAR", label: "Logos" },
                        { type: "TIMELINE", label: "Timeline" },
                        { type: "CONTACT", label: "Contact" },
                        { type: "VIDEO", label: "Video" },
                        { type: "BANNER", label: "Banner" },
                        { type: "COMPARISON", label: "Compare" },
                        { type: "PROCESS_STEPS", label: "Steps" },
                        { type: "QR_CODE", label: "QR Code" },
                        { type: "BOOKING", label: "Booking" },
                        { type: "PAYWALL", label: "Paywall" },
                        { type: "CODE", label: "Code" },
                        { type: "BOT_EMBED", label: "Bot" },
                      ].map(({ type, label }) => (
                        <Button
                          key={type}
                          size="sm"
                          className="bg-indigo-600 hover:bg-indigo-500 text-[10px] px-2 py-1 h-auto"
                          onClick={() => handleAddSection(type)}
                          data-testid={`button-add-${type.toLowerCase()}`}
                        >
                          <Plus size={10} className="mr-0.5" /> {label}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-white/10 text-xs"
                        onClick={() => setAddSectionOpen(false)}
                        data-testid="button-cancel-add-section"
                      >
                        Cancel
                      </Button>
                    </motion.div>
                  ) : (
                    <Button
                      variant="outline"
                      className="border-dashed border-white/20 text-slate-400 hover:text-white hover:border-indigo-500"
                      onClick={() => setAddSectionOpen(true)}
                      data-testid="button-add-section"
                    >
                      <Plus size={16} className="mr-2" /> Add Section
                    </Button>
                  )}
                </div>
              )}

              <ChatWidget primaryColor={siteData.theme.primary} />
            </motion.div>
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-600 space-y-4 mt-32">
              <div className="w-20 h-20 rounded-2xl glass flex items-center justify-center glow-box">
                <LayoutTemplate size={40} className="text-indigo-500/30" />
              </div>
              <p className="text-lg font-medium text-slate-400">Enter a prompt to generate a preview</p>
              <p className="text-sm text-slate-600">
                Describe your business type, style, and color preferences
              </p>
              {savedSites.length > 0 && (
                <Button
                  variant="outline"
                  className="mt-4 border-white/10 hover:bg-white/5 text-slate-400"
                  onClick={() => setShowSaved(true)}
                  data-testid="button-load-designs-empty"
                >
                  <FolderOpen size={16} className="mr-2" /> Load a Saved Design
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Version History Slide-out Panel */}
      <AnimatePresence>
        {showVersionHistory && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 w-[360px] bg-neutral-900 border-l border-white/10 z-[70] flex flex-col shadow-2xl"
            data-testid="panel-version-history"
          >
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <History size={18} className="text-indigo-400" />
                Version History
              </h3>
              <button onClick={() => setShowVersionHistory(false)} className="text-slate-400 hover:text-white" data-testid="button-close-versions">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {loadingVersions ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
                </div>
              ) : versions.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">
                  <History size={32} className="mx-auto mb-3 opacity-30" />
                  <p>No versions yet.</p>
                  <p className="text-xs mt-1">Save the design to create version snapshots.</p>
                </div>
              ) : (
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-px bg-indigo-500/20" />
                  <div className="space-y-4">
                    {versions.map((v) => (
                      <div key={v.id} className="relative pl-10" data-testid={`version-item-${v.id}`}>
                        <div className="absolute left-2.5 top-3 w-3 h-3 rounded-full bg-indigo-500 border-2 border-neutral-900" />
                        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-indigo-300">v{v.versionNumber}</span>
                            <span className="text-xs text-slate-500">
                              {new Date(v.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">{v.label}</p>
                          <Button
                            size="sm"
                            className="mt-2 bg-indigo-600 hover:bg-indigo-500 text-xs w-full"
                            onClick={() => handleRestoreVersion(v)}
                            data-testid={`button-restore-version-${v.id}`}
                          >
                            Restore
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Template Gallery */}
      <AnimatePresence>
        {showTemplates && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-md"
            onClick={() => setShowTemplates(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-[#0a0a1a] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[85vh] shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              data-testid="dialog-template-gallery"
            >
              <div className="flex items-center justify-between p-6 border-b border-white/10 bg-white/5">
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Palette className="text-indigo-400" size={22} />
                    Template Gallery
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">Pre-designed landing pages ready to customize</p>
                </div>
                <button
                  onClick={() => setShowTemplates(false)}
                  className="text-slate-400 hover:text-white p-2 hover:bg-white/10 rounded-lg transition-colors"
                  data-testid="button-close-templates"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="overflow-y-auto p-6" style={{ maxHeight: "calc(85vh - 80px)" }}>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {SITE_TEMPLATES.map((template) => {
                    const IconComp = template.icon;
                    return (
                      <motion.div
                        key={template.id}
                        whileHover={{ scale: 1.02, y: -4 }}
                        whileTap={{ scale: 0.98 }}
                        className="group relative rounded-xl border border-white/10 overflow-hidden cursor-pointer bg-white/5 hover:border-indigo-500/40 transition-all duration-300"
                        onClick={() => handleLoadTemplate(template)}
                        data-testid={`template-card-${template.id}`}
                      >
                        <div
                          className="h-40 relative overflow-hidden"
                          style={{ backgroundColor: template.siteData.theme.bg }}
                        >
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                            <div
                              className="w-10 h-10 rounded-full flex items-center justify-center mb-2"
                              style={{ backgroundColor: template.color + "20", color: template.color }}
                            >
                              <IconComp size={20} />
                            </div>
                            <h3
                              className="text-sm font-bold"
                              style={{ color: template.siteData.theme.text, fontFamily: template.siteData.theme.font }}
                            >
                              {template.siteData.sections[0]?.props?.title}
                            </h3>
                            <p
                              className="text-[10px] mt-1 line-clamp-2 opacity-60"
                              style={{ color: template.siteData.theme.text }}
                            >
                              {template.siteData.sections[0]?.props?.subtitle}
                            </p>
                            <div
                              className="mt-2 px-3 py-1 rounded-full text-[10px] font-bold"
                              style={{ backgroundColor: template.color, color: template.siteData.theme.bg }}
                            >
                              {template.siteData.sections[0]?.props?.cta}
                            </div>
                          </div>
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-3">
                            <span className="text-xs font-medium text-white bg-indigo-600 px-3 py-1 rounded-full">
                              Use Template
                            </span>
                          </div>
                        </div>
                        <div className="p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: template.color }}
                            />
                            <h4 className="text-sm font-bold text-white">{template.name}</h4>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-slate-400">
                              {template.industry}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-slate-400">
                              {template.siteData.theme.font}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1.5 line-clamp-2">{template.description}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Save Dialog */}
      <AnimatePresence>
        {showSaveDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowSaveDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-neutral-900 border border-white/10 rounded-xl p-6 w-full max-w-md shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              data-testid="dialog-save-design"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Save Design</h3>
                <button onClick={() => setShowSaveDialog(false)} className="text-slate-400 hover:text-white">
                  <X size={18} />
                </button>
              </div>
              <p className="text-sm text-slate-400 mb-4">Give your design a name so you can find it later.</p>
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="e.g., Med Spa Gold Theme"
                className="bg-white/5 border-white/10 mb-4"
                onKeyDown={(e) => e.key === "Enter" && saveName.trim() && handleSave()}
                autoFocus
                data-testid="input-save-name"
              />
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/10"
                  onClick={() => setShowSaveDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-indigo-600 hover:bg-indigo-500"
                  onClick={handleSave}
                  disabled={!saveName.trim() || isSaving}
                  data-testid="button-confirm-save"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin mr-2" /> : <Save size={14} className="mr-2" />}
                  Save Design
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* My Designs Modal */}
        {showSaved && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => { setShowSaved(false); setDomainSiteId(null); setCollabSiteId(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-neutral-900 border border-white/10 rounded-xl p-6 w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
              data-testid="dialog-saved-designs"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <FolderOpen size={20} className="text-indigo-400" />
                  My Saved Designs
                </h3>
                <button onClick={() => { setShowSaved(false); setDomainSiteId(null); setCollabSiteId(null); }} className="text-slate-400 hover:text-white">
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3">
                {savedSites.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <FolderOpen size={40} className="mx-auto mb-3 opacity-30" />
                    <p>No saved designs yet.</p>
                    <p className="text-xs mt-1">Generate a site and click Save to store it here.</p>
                  </div>
                ) : (
                  savedSites.map((site) => (
                    <div
                      key={site.id}
                      className="group bg-white/5 border border-white/10 rounded-lg p-4 hover:bg-white/10 transition-colors"
                      data-testid={`card-saved-site-${site.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-sm truncate">{site.name}</h4>
                            {site.customDomain && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-[10px] font-medium" data-testid={`badge-domain-${site.id}`}>
                                <Globe size={10} /> {site.customDomain}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-1 truncate">{site.prompt}</p>
                          <p className="text-xs text-slate-600 mt-1">
                            {new Date(site.createdAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            className="bg-indigo-600 hover:bg-indigo-500 h-8 text-xs"
                            onClick={() => handleLoad(site)}
                            data-testid={`button-load-site-${site.id}`}
                          >
                            Load
                          </Button>
                          <button
                            onClick={() => { setDomainSiteId(domainSiteId === site.id ? null : site.id); setDomainInput(site.customDomain || ""); setCollabSiteId(null); }}
                            className="p-2 text-slate-400 hover:text-indigo-400 transition-colors"
                            title="Connect Domain"
                            data-testid={`button-domain-${site.id}`}
                          >
                            <Globe size={14} />
                          </button>
                          <button
                            onClick={() => { setCollabSiteId(collabSiteId === site.id ? null : site.id); setDomainSiteId(null); if (collabSiteId !== site.id) fetchCollaborators(site.id); }}
                            className="p-2 text-slate-400 hover:text-indigo-400 transition-colors"
                            title="Share"
                            data-testid={`button-share-${site.id}`}
                          >
                            <Share2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(site.id, site.name)}
                            className="p-2 text-slate-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                            data-testid={`button-delete-site-${site.id}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Domain Mapping Panel */}
                      <AnimatePresence>
                        {domainSiteId === site.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 pt-3 border-t border-white/10 space-y-3" data-testid={`panel-domain-${site.id}`}>
                              <div className="flex gap-2">
                                <Input
                                  value={domainInput}
                                  onChange={(e) => setDomainInput(e.target.value)}
                                  placeholder="e.g., mybusiness.com"
                                  className="bg-white/5 border-white/10 text-sm flex-1"
                                  data-testid={`input-domain-${site.id}`}
                                />
                                <Button
                                  size="sm"
                                  className="bg-indigo-600 hover:bg-indigo-500 text-xs"
                                  onClick={() => handleSaveDomain(site.id)}
                                  disabled={!domainInput.trim() || savingDomain}
                                  data-testid={`button-save-domain-${site.id}`}
                                >
                                  {savingDomain ? <Loader2 size={12} className="animate-spin" /> : "Connect"}
                                </Button>
                              </div>
                              {site.customDomain && (
                                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3 text-xs space-y-2" data-testid={`info-dns-${site.id}`}>
                                  <div className="flex items-center gap-1 text-indigo-300 font-semibold">
                                    <Info size={12} /> DNS Setup Instructions
                                  </div>
                                  <div className="space-y-1 text-slate-300">
                                    <p><span className="text-slate-500">A Record:</span> Point <code className="bg-black/30 px-1 rounded">{site.customDomain}</code> to <code className="bg-black/30 px-1 rounded">76.76.21.21</code></p>
                                    <p><span className="text-slate-500">CNAME:</span> Point <code className="bg-black/30 px-1 rounded">www.{site.customDomain}</code> to <code className="bg-black/30 px-1 rounded">cname.apex-sites.com</code></p>
                                  </div>
                                  <p className="text-slate-500">Changes may take up to 48 hours to propagate.</p>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Collaboration Panel */}
                      <AnimatePresence>
                        {collabSiteId === site.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 pt-3 border-t border-white/10 space-y-3" data-testid={`panel-collab-${site.id}`}>
                              <div className="flex items-center gap-2 text-sm font-semibold text-indigo-300">
                                <Users size={14} /> Collaborators
                              </div>
                              <div className="flex gap-2">
                                <Input
                                  value={collabName}
                                  onChange={(e) => setCollabName(e.target.value)}
                                  placeholder="Name"
                                  className="bg-white/5 border-white/10 text-sm flex-1"
                                  data-testid={`input-collab-name-${site.id}`}
                                />
                                <Input
                                  value={collabEmail}
                                  onChange={(e) => setCollabEmail(e.target.value)}
                                  placeholder="Email"
                                  className="bg-white/5 border-white/10 text-sm flex-1"
                                  data-testid={`input-collab-email-${site.id}`}
                                />
                                <Button
                                  size="sm"
                                  className="bg-indigo-600 hover:bg-indigo-500 text-xs"
                                  onClick={handleAddCollaborator}
                                  disabled={!collabName.trim() || !collabEmail.trim()}
                                  data-testid={`button-add-collab-${site.id}`}
                                >
                                  Invite
                                </Button>
                              </div>

                              {loadingCollabs ? (
                                <div className="flex justify-center py-3">
                                  <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
                                </div>
                              ) : collaborators.length === 0 ? (
                                <p className="text-xs text-slate-500 text-center py-2">No collaborators yet. Invite someone above.</p>
                              ) : (
                                <div className="space-y-2">
                                  {collaborators.map((c) => (
                                    <div key={c.id} className="flex items-center justify-between bg-white/5 rounded-lg p-2 text-xs" data-testid={`collab-item-${c.id}`}>
                                      <div className="flex-1 min-w-0">
                                        <span className="font-medium text-white">{c.name}</span>
                                        <span className="text-slate-400 ml-2">{c.email}</span>
                                        <span className="ml-2 px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px]">{c.role}</span>
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0 ml-2">
                                        <button
                                          onClick={() => copyToClipboard(c.inviteCode)}
                                          className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-indigo-300 transition-colors"
                                          title="Copy invite code"
                                          data-testid={`button-copy-code-${c.id}`}
                                        >
                                          <Copy size={10} />
                                          <span className="font-mono">{c.inviteCode}</span>
                                        </button>
                                        <button
                                          onClick={() => handleRemoveCollaborator(c.id)}
                                          className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                                          data-testid={`button-remove-collab-${c.id}`}
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {showTutorial && <SiteBuilderTutorial onClose={closeTutorial} />}
    </div>
  );
}
