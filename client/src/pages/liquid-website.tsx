import { useEffect, useState, useCallback } from "react";
import { useSearch } from "wouter";
import {
  ShieldCheck,
  Clock,
  Sparkles,
  Star,
  Dumbbell,
  Heart,
  Zap,
  Trophy,
  CheckCircle2,
  Loader2,
  Globe,
  Settings,
  Link2,
  Code2,
  TestTube2,
  Copy,
  Check,
  X,
  ArrowRight,
  Eye,
  Users,
  FileText,
  Layers,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatWidget } from "@/components/chat-widget";
import { useActiveSubAccountId } from "@/components/account-required";
import { useToast } from "@/hooks/use-toast";

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  ShieldCheck, Clock, Sparkles, Star, Dumbbell, Heart, Zap, Trophy, CheckCircle2,
};

const STICKY_KEY = "apex_liquid_contact";

function getStickyContact(): { email?: string; phone?: string; firstName?: string } | null {
  try {
    const raw = localStorage.getItem(STICKY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setStickyContact(data: { email?: string; phone?: string; firstName?: string }) {
  try { localStorage.setItem(STICKY_KEY, JSON.stringify(data)); } catch {}
}

function resolveTemplate(text: string, vars: Record<string, string>): string {
  if (!text) return text;
  return text.replace(/\{\{([\w.]+)(?:\s*\|\s*default:\s*'([^']*)')?\}\}/g, (_match, key, fallback) => {
    const val = vars[key.trim()];
    return val || fallback || "";
  });
}

function HeroSection({ title, subtitle, cta, image, badge, theme, templateVars, onCtaClick }: any) {
  const resolvedTitle = resolveTemplate(title, templateVars);
  const resolvedSubtitle = resolveTemplate(subtitle, templateVars);
  return (
    <div
      className="relative min-h-[80vh] flex flex-col items-center justify-center text-center overflow-hidden"
      style={{ backgroundColor: theme.bg, color: theme.text }}
    >
      <div
        className="absolute inset-0 bg-cover bg-center z-0 scale-105"
        style={{ backgroundImage: `url(${image})`, filter: "blur(1px)" }}
      />
      <div className="absolute inset-0 z-0" style={{ background: `linear-gradient(180deg, ${theme.bg}ee 0%, ${theme.bg}99 40%, ${theme.bg}dd 100%)` }} />
      <div className="absolute inset-0 z-0" style={{ background: `radial-gradient(ellipse at center, ${theme.primary}15 0%, transparent 70%)` }} />
      <div className="relative z-10 max-w-4xl px-6 space-y-8">
        {badge && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold"
            style={{ border: `1px solid ${theme.primary}40`, color: theme.primary, backgroundColor: theme.primary + "10" }}
          >
            <Sparkles size={12} /> {resolveTemplate(badge, templateVars)}
          </motion.div>
        )}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1]"
          style={{ fontFamily: theme.font }}
          data-testid="text-liquid-hero-title"
        >
          {resolvedTitle}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="text-lg md:text-xl opacity-80 max-w-2xl mx-auto leading-relaxed"
        >
          {resolvedSubtitle}
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2"
        >
          <Button
            size="lg"
            className="font-bold px-8 py-3 text-base rounded-full shadow-xl"
            style={{ backgroundColor: theme.primary, color: theme.bg, boxShadow: `0 0 40px ${theme.primary}30` }}
            onClick={onCtaClick}
            data-testid="button-liquid-hero-cta"
          >
            {resolveTemplate(cta, templateVars)} <ArrowRight className="ml-2" size={18} />
          </Button>
        </motion.div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-24 z-10" style={{ background: `linear-gradient(to top, ${theme.bg}, transparent)` }} />
    </div>
  );
}

function FeatureSection({ title, subtitle, features, theme, templateVars }: any) {
  return (
    <div className="py-20 px-6 md:px-12" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-3" style={{ fontFamily: theme.font }}>
          {resolveTemplate(title, templateVars)}
        </h2>
        {subtitle && <p className="text-center opacity-80 mb-14 max-w-2xl mx-auto font-medium">{resolveTemplate(subtitle, templateVars)}</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {(features || []).map((f: any, i: number) => {
            const IconComponent = ICON_MAP[f.icon] || Star;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="group p-8 rounded-2xl transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
                style={{ border: `1px solid ${theme.text}15`, backgroundColor: theme.text + "08" }}
                data-testid={`card-liquid-feature-${i}`}
              >
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform"
                  style={{ backgroundColor: theme.primary + "15", color: theme.primary }}
                >
                  <IconComponent size={26} />
                </div>
                <h3 className="text-xl font-bold mb-3">{resolveTemplate(f.title, templateVars)}</h3>
                <p className="text-sm opacity-80 leading-relaxed font-normal">{resolveTemplate(f.desc, templateVars)}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BookingSection({ title, theme, subAccountId, templateVars, stickyContact, onFormSubmit }: any) {
  const [formData, setFormData] = useState({ name: stickyContact?.firstName || "", email: stickyContact?.email || "", phone: stickyContact?.phone || "" });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!formData.name && !formData.email && !formData.phone) return;
    setSubmitting(true);
    try {
      await fetch("/api/form-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subAccountId: subAccountId || "",
          formName: "Liquid Site Lead",
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
        }),
      });
      setStickyContact({ firstName: formData.name, email: formData.email, phone: formData.phone });
      if (onFormSubmit) onFormSubmit({ firstName: formData.name, email: formData.email, phone: formData.phone });
      setSubmitted(true);
    } catch {} finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="py-20 px-6 text-center" style={{ backgroundColor: theme.bg, color: theme.text }} id="booking-form">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-md mx-auto p-8 rounded-2xl backdrop-blur-sm"
        style={{ border: `1px solid ${theme.text}15`, backgroundColor: theme.text + "08" }}
      >
        <h2 className="text-2xl font-bold mb-6">{resolveTemplate(title, templateVars)}</h2>
        {submitted ? (
          <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="py-8 space-y-4">
            <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center" style={{ backgroundColor: theme.primary + "20" }}>
              <CheckCircle2 size={32} style={{ color: theme.primary }} />
            </div>
            <p className="text-lg font-semibold">Thank you{formData.name ? `, ${formData.name}` : ""}!</p>
            <p className="text-sm opacity-70">We'll be in touch shortly.</p>
          </motion.div>
        ) : (
          <div className="space-y-4">
            <Input
              placeholder="Full Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              style={{ borderColor: theme.text + "20", backgroundColor: theme.text + "10" }}
              data-testid="input-liquid-name"
            />
            <Input
              placeholder="Email Address"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              style={{ borderColor: theme.text + "20", backgroundColor: theme.text + "10" }}
              data-testid="input-liquid-email"
            />
            <Input
              placeholder="Phone Number"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              style={{ borderColor: theme.text + "20", backgroundColor: theme.text + "10" }}
              data-testid="input-liquid-phone"
            />
            <Button
              className="w-full font-bold rounded-full"
              style={{ backgroundColor: theme.primary, color: theme.bg }}
              onClick={handleSubmit}
              disabled={submitting}
              data-testid="button-liquid-submit"
            >
              {submitting ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
              {resolveTemplate(title, templateVars) || "Check Availability"}
            </Button>
            <p className="text-xs opacity-50 mt-4">Powered by Apex Marketing Automations</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function TestimonialsSection({ title, subtitle, testimonials, theme, templateVars }: any) {
  return (
    <div className="py-20 px-6 md:px-12" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-3" style={{ fontFamily: theme.font }}>{resolveTemplate(title, templateVars)}</h2>
        {subtitle && <p className="text-center opacity-80 mb-12 max-w-2xl mx-auto">{resolveTemplate(subtitle, templateVars)}</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(testimonials || []).map((t: any, i: number) => (
            <div key={i} className="p-6 rounded-2xl relative" style={{ border: `1px solid ${theme.text}15`, backgroundColor: theme.text + "08" }}>
              <div className="text-4xl opacity-20 absolute top-4 right-4" style={{ color: theme.primary }}>"</div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: theme.primary + "30", color: theme.primary }}>
                  {(t.name || "A").charAt(0)}
                </div>
                <div>
                  <p className="font-semibold text-sm">{t.name}</p>
                  <p className="text-xs opacity-60">{t.role}</p>
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

function CtaSection({ title, subtitle, cta, theme, templateVars, onCtaClick }: any) {
  return (
    <div className="py-20 px-6" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="text-3xl md:text-5xl font-bold mb-4" style={{ fontFamily: theme.font }}>{resolveTemplate(title, templateVars)}</h2>
        {subtitle && <p className="text-lg opacity-70 mb-8 max-w-xl mx-auto">{resolveTemplate(subtitle, templateVars)}</p>}
        <Button
          size="lg"
          className="font-bold px-8 py-3 text-lg rounded-full shadow-lg"
          style={{ backgroundColor: theme.primary, color: theme.bg, boxShadow: `0 0 30px ${theme.primary}40` }}
          onClick={onCtaClick}
          data-testid="button-liquid-cta"
        >
          {resolveTemplate(cta, templateVars) || "Get Started"} <ArrowRight className="ml-2" size={18} />
        </Button>
      </div>
    </div>
  );
}

const COMPONENT_MAP: Record<string, React.ComponentType<any>> = {
  HERO: HeroSection,
  FEATURES: FeatureSection,
  BOOKING: BookingSection,
  TESTIMONIALS: TestimonialsSection,
  CTA: CtaSection,
};

const LIQUID_RULES: Record<string, {
  theme: { primary: string; bg: string; text: string; font: string };
  headline: string;
  subtitle: string;
  cta: string;
  features?: { icon: string; title: string; desc: string }[];
}> = {
  luxury: {
    theme: { primary: "#D4AF37", bg: "#000000", text: "#ffffff", font: "'Playfair Display', serif" },
    headline: "Experience Ultimate Perfection.",
    subtitle: "Where luxury meets results. Premium treatments tailored exclusively for you.",
    cta: "Reserve Your Session",
    features: [
      { icon: "Star", title: "VIP Treatment", desc: "Private suites with personalized attention from our senior specialists." },
      { icon: "ShieldCheck", title: "Premium Products", desc: "Medical-grade formulations sourced from the world's finest labs." },
      { icon: "Trophy", title: "Award-Winning Team", desc: "Our team has been recognized nationally for excellence in aesthetics." },
    ],
  },
  student: {
    theme: { primary: "#00FF99", bg: "#111111", text: "#ffffff", font: "'Inter', sans-serif" },
    headline: "Look Great. Save Money. 20% Off.",
    subtitle: "Student specials that fit your budget without compromising on quality.",
    cta: "Claim Student Discount",
    features: [
      { icon: "Zap", title: "Quick Sessions", desc: "In and out in 30 minutes — perfect between classes." },
      { icon: "Heart", title: "Affordable Plans", desc: "Monthly packages starting at just $49 with valid student ID." },
      { icon: "Sparkles", title: "Trending Looks", desc: "Stay on top of the latest aesthetic trends your friends are loving." },
    ],
  },
  fitness: {
    theme: { primary: "#FF4444", bg: "#0a0a0a", text: "#ffffff", font: "'Oswald', sans-serif" },
    headline: "Push Beyond Your Limits.",
    subtitle: "Elite training programs designed to transform your body and mindset.",
    cta: "Start Your Transformation",
    features: [
      { icon: "Dumbbell", title: "Personal Training", desc: "1-on-1 coaching with certified strength and conditioning specialists." },
      { icon: "Trophy", title: "Proven Results", desc: "Our members see measurable progress within the first 30 days." },
      { icon: "Zap", title: "High-Intensity Programs", desc: "HIIT, CrossFit, and functional training to maximize every session." },
    ],
  },
  wellness: {
    theme: { primary: "#7C3AED", bg: "#050510", text: "#ffffff", font: "'Poppins', sans-serif" },
    headline: "Restore. Rebalance. Renew.",
    subtitle: "Holistic wellness experiences that nurture your mind, body, and spirit.",
    cta: "Book Your Wellness Journey",
    features: [
      { icon: "Heart", title: "Mindful Healing", desc: "Therapeutic treatments rooted in ancient traditions and modern science." },
      { icon: "Sparkles", title: "Energy Restoration", desc: "IV therapy, cryotherapy, and infrared sessions for full-body renewal." },
      { icon: "ShieldCheck", title: "Expert Practitioners", desc: "Licensed therapists with decades of holistic healing experience." },
    ],
  },
};

function getVisitorContext() {
  const hour = new Date().getHours();
  let timeOfDay = "morning";
  if (hour >= 12 && hour < 17) timeOfDay = "afternoon";
  else if (hour >= 17 && hour < 21) timeOfDay = "evening";
  else if (hour >= 21 || hour < 5) timeOfDay = "night";

  const isMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent);

  const referrer = document.referrer;
  let source = "direct";
  if (referrer.includes("google")) source = "google";
  else if (referrer.includes("facebook") || referrer.includes("fb.")) source = "facebook";
  else if (referrer.includes("instagram")) source = "instagram";
  else if (referrer.includes("tiktok")) source = "tiktok";
  else if (referrer.includes("twitter") || referrer.includes("x.com")) source = "twitter";
  else if (referrer) source = "referral";

  return {
    device: isMobile ? "mobile" : "desktop",
    referrer: source,
    timeOfDay,
    hour,
    language: navigator.language || "en-US",
  };
}

function applyVibeOverrides(data: any, vibe: string | null): any {
  if (!vibe || !LIQUID_RULES[vibe]) return data;
  const rule = LIQUID_RULES[vibe];
  const result = JSON.parse(JSON.stringify(data));
  result.theme = { ...result.theme, ...rule.theme };
  if (result.sections && result.sections.length > 0) {
    const heroIdx = result.sections.findIndex((s: any) => s.type === "HERO");
    if (heroIdx !== -1) {
      result.sections[heroIdx].props = { ...result.sections[heroIdx].props, title: rule.headline, subtitle: rule.subtitle, cta: rule.cta };
    }
    if (rule.features) {
      const featIdx = result.sections.findIndex((s: any) => s.type === "FEATURES");
      if (featIdx !== -1) {
        result.sections[featIdx].props = { ...result.sections[featIdx].props, features: rule.features };
      }
    }
  }
  return result;
}

function SettingsPanel({ open, onClose, subAccountId, urlParams }: { open: boolean; onClose: () => void; subAccountId: number | null; urlParams: URLSearchParams }) {
  const [copied, setCopied] = useState<string | null>(null);

  const baseUrl = window.location.origin + "/liquid";
  const exampleAdUrl = `${baseUrl}?heading=Your+Business+Name&subheading=Custom+Tagline&cta=Book+Now&vibe=luxury`;
  const exampleContactUrl = `${baseUrl}?heading=Welcome+Back&contact_email=client@example.com`;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-md"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-[#0a0a1a] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] shadow-2xl overflow-auto m-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-6 border-b border-white/10">
            <div className="flex items-center gap-3">
              <Settings size={20} className="text-indigo-400" />
              <h2 className="text-lg font-bold text-white">Liquid Website Settings</h2>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white p-2 hover:bg-white/10 rounded-lg transition-colors" data-testid="button-close-settings">
              <X size={18} />
            </button>
          </div>

          <div className="p-6 space-y-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Link2 size={16} className="text-indigo-400" />
                <h3 className="font-semibold text-white">1. Domain & Infrastructure</h3>
              </div>
              <p className="text-sm text-slate-400 mb-3">
                Connect a custom domain in Settings &gt; Domains. Once verified, your Liquid site deploys to that URL and adapts to every visitor automatically.
              </p>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 space-y-1">
                <p><span className="text-indigo-400">A Record:</span> Point your domain to <code className="bg-black/30 px-1 rounded">76.76.21.21</code></p>
                <p><span className="text-indigo-400">CNAME:</span> Point <code className="bg-black/30 px-1 rounded">www</code> to <code className="bg-black/30 px-1 rounded">cname.apex-sites.com</code></p>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Layers size={16} className="text-emerald-400" />
                <h3 className="font-semibold text-white">2. Template Variables (Liquid Components)</h3>
              </div>
              <p className="text-sm text-slate-400 mb-3">
                Use these variables in your AI prompt or site content. If a visitor is a known CRM contact, their data fills in automatically. Otherwise the default value is used.
              </p>
              <div className="space-y-2">
                {[
                  { var: "{{contact.first_name | default: 'Welcome'}}", desc: "Visitor's first name from CRM" },
                  { var: "{{contact.email | default: ''}}", desc: "Visitor's email from CRM" },
                  { var: "{{url_param.heading}}", desc: "Dynamic headline from ad URL" },
                  { var: "{{url_param.subheading}}", desc: "Dynamic subheadline from ad URL" },
                  { var: "{{url_param.cta}}", desc: "Dynamic CTA button text from ad URL" },
                  { var: "{{url_param.offer}}", desc: "Dynamic offer text from ad URL" },
                  { var: "{{visitor.device}}", desc: "mobile or desktop" },
                  { var: "{{visitor.time}}", desc: "morning, afternoon, evening, or night" },
                  { var: "{{visitor.source}}", desc: "google, facebook, instagram, direct, etc." },
                ].map((v, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex-1">
                      <code className="text-xs text-emerald-400 font-mono">{v.var}</code>
                      <p className="text-xs text-slate-500 mt-0.5">{v.desc}</p>
                    </div>
                    <button
                      onClick={() => copyToClipboard(v.var, `var-${i}`)}
                      className="ml-2 p-1.5 rounded hover:bg-white/10 text-slate-400 transition-colors"
                      data-testid={`button-copy-var-${i}`}
                    >
                      {copied === `var-${i}` ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Code2 size={16} className="text-amber-400" />
                <h3 className="font-semibold text-white">3. URL Parameter Injection (Shape-Shifting Engine)</h3>
              </div>
              <p className="text-sm text-slate-400 mb-3">
                Append URL parameters to your ad links. The Liquid site reads them and swaps content in real-time, making the page feel tailor-made for each ad group.
              </p>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
                <p className="text-xs text-slate-300 font-semibold">Example Ad Link:</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-amber-400 font-mono break-all flex-1">{exampleAdUrl}</code>
                  <button onClick={() => copyToClipboard(exampleAdUrl, "ad-url")} className="p-1.5 rounded hover:bg-white/10 text-slate-400 shrink-0" data-testid="button-copy-ad-url">
                    {copied === "ad-url" ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1">Supported params: <code className="text-amber-300">heading</code>, <code className="text-amber-300">subheading</code>, <code className="text-amber-300">cta</code>, <code className="text-amber-300">offer</code>, <code className="text-amber-300">vibe</code>, <code className="text-amber-300">badge</code></p>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Users size={16} className="text-cyan-400" />
                <h3 className="font-semibold text-white">4. Sticky Contact (Returning Visitor Recognition)</h3>
              </div>
              <p className="text-sm text-slate-400 mb-3">
                When a visitor fills out the form, their info is saved locally. On return visits, the form is pre-filled and the site greets them by name. If they exist in your CRM, their full profile is loaded.
              </p>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
                <p className="text-xs text-slate-300 font-semibold">CRM Contact Lookup URL:</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-cyan-400 font-mono break-all flex-1">{exampleContactUrl}</code>
                  <button onClick={() => copyToClipboard(exampleContactUrl, "contact-url")} className="p-1.5 rounded hover:bg-white/10 text-slate-400 shrink-0" data-testid="button-copy-contact-url">
                    {copied === "contact-url" ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>
                <p className="text-xs text-slate-500">Pass <code className="text-cyan-300">contact_email</code> or <code className="text-cyan-300">contact_phone</code> to trigger CRM lookup</p>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <TestTube2 size={16} className="text-rose-400" />
                <h3 className="font-semibold text-white">5. Testing the Telemetry</h3>
              </div>
              <ol className="text-sm text-slate-400 space-y-2 list-decimal list-inside">
                <li>Open your Liquid site URL in an Incognito Window</li>
                <li>Fill out the form with a test email and phone</li>
                <li>Check your <strong className="text-white">Unified Inbox</strong> — the submission should appear</li>
                <li>Check your <strong className="text-white">Pipeline</strong> — the contact should appear with "Site Lead" tag</li>
                <li>If a Workflow is attached, the SMS/email trigger should fire automatically</li>
              </ol>
            </div>

            <div className="border-t border-white/10 pt-4">
              <p className="text-xs text-slate-500 text-center">
                Active Sub-Account: {subAccountId || "None selected"} &bull; URL params detected: {Array.from(urlParams.entries()).length}
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default function LiquidWebsite() {
  const [siteData, setSiteData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<any>(null);
  const [stickyContact, setStickyContactState] = useState<any>(getStickyContact());
  const [crmContact, setCrmContact] = useState<any>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const subAccountId = useActiveSubAccountId();

  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const vibe = urlParams.get("vibe");

  const templateVars: Record<string, string> = {};

  const contactData = crmContact || stickyContact;
  if (contactData?.firstName) templateVars["contact.first_name"] = contactData.firstName;
  if (contactData?.lastName) templateVars["contact.last_name"] = contactData.lastName;
  if (contactData?.email) templateVars["contact.email"] = contactData.email;
  if (contactData?.phone) templateVars["contact.phone"] = contactData.phone;

  for (const [key, value] of urlParams.entries()) {
    if (key !== "vibe" && key !== "contact_email" && key !== "contact_phone") {
      templateVars[`url_param.${key}`] = value;
    }
  }

  if (context) {
    templateVars["visitor.device"] = context.device;
    templateVars["visitor.time"] = context.timeOfDay;
    templateVars["visitor.source"] = context.referrer;
  }

  const scrollToForm = useCallback(() => {
    document.getElementById("booking-form")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleFormSubmit = (data: any) => {
    setStickyContactState(data);
    if (data.firstName) templateVars["contact.first_name"] = data.firstName;
  };

  useEffect(() => {
    const ctx = getVisitorContext();
    if (vibe) (ctx as any).vibe = vibe;
    setContext(ctx);

    const contactEmail = urlParams.get("contact_email");
    const contactPhone = urlParams.get("contact_phone");
    const sticky = getStickyContact();

    const lookupEmail = contactEmail || sticky?.email;
    const lookupPhone = contactPhone || sticky?.phone;

    if ((lookupEmail || lookupPhone) && subAccountId) {
      fetch("/api/liquid/contact-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAccountId, email: lookupEmail, phone: lookupPhone }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.contact) {
            setCrmContact(data.contact);
            setStickyContact({ firstName: data.contact.firstName, email: data.contact.email, phone: data.contact.phone });
            setStickyContactState({ firstName: data.contact.firstName, email: data.contact.email, phone: data.contact.phone });
          }
        })
        .catch(() => {});
    }

    const heading = urlParams.get("heading");

    fetch("/api/generate-liquid-site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...ctx,
        contactName: sticky?.firstName || crmContact?.firstName || undefined,
        heading: heading || undefined,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to generate personalized site");
        return res.json();
      })
      .then((data) => {
        const finalData = applyVibeOverrides(data, vibe);
        setSiteData(finalData);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [vibe, subAccountId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-white">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-6">
          <div className="relative">
            <Globe className="h-16 w-16 text-indigo-500 animate-pulse" />
            <Loader2 className="h-8 w-8 text-indigo-400 animate-spin absolute -bottom-1 -right-1" />
          </div>
          <div className="text-center space-y-2">
            <p className="text-lg font-medium">Building your personalized experience...</p>
            <p className="text-sm text-neutral-400">AI is customizing this page just for you</p>
          </div>
          {context && (
            <div className="mt-4 text-xs text-neutral-500 bg-white/5 rounded-lg p-3 space-y-1" data-testid="text-liquid-context">
              <p>Device: {context.device}</p>
              <p>Time: {context.timeOfDay} ({context.hour}:00)</p>
              <p>Source: {context.referrer}</p>
              {stickyContact?.firstName && <p>Welcome back, {stickyContact.firstName}</p>}
              {urlParams.get("heading") && <p>Ad Headline: {urlParams.get("heading")}</p>}
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-white">
        <div className="text-center space-y-4">
          <p className="text-red-400 text-lg">{error}</p>
          <Button onClick={() => window.location.reload()} variant="outline" data-testid="button-liquid-retry">Try Again</Button>
        </div>
      </div>
    );
  }

  if (!siteData) return null;

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: siteData.theme?.bg || "#0a0a0a" }}>
      {stickyContact?.firstName && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-2 text-xs font-medium"
          style={{ backgroundColor: siteData.theme?.primary + "15", color: siteData.theme?.primary }}
          data-testid="text-liquid-welcome-back"
        >
          Welcome back, {stickyContact.firstName}! We remember you.
        </motion.div>
      )}

      {siteData.sections?.map((section: any, i: number) => {
        const Component = COMPONENT_MAP[section.type];
        if (!Component) return null;
        return (
          <Component
            key={i}
            {...section.props}
            theme={siteData.theme}
            templateVars={templateVars}
            subAccountId={subAccountId}
            stickyContact={stickyContact}
            onCtaClick={scrollToForm}
            onFormSubmit={handleFormSubmit}
          />
        );
      })}

      <button
        onClick={() => setSettingsOpen(true)}
        className="fixed bottom-6 left-6 z-50 p-3 rounded-full shadow-lg transition-transform hover:scale-110"
        style={{ backgroundColor: siteData.theme?.primary || "#6366f1", color: siteData.theme?.bg || "#000" }}
        data-testid="button-liquid-settings"
      >
        <Settings size={20} />
      </button>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        subAccountId={subAccountId}
        urlParams={urlParams}
      />

      <ChatWidget primaryColor={siteData.theme?.primary || "#D4AF37"} />
    </div>
  );
}
