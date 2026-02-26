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
  Wand2,
  RotateCcw,
  Palette,
  Building2,
  Target,
  MessageSquare,
  Briefcase,
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

const INDUSTRIES = [
  "Dental Practice", "Med Spa / Aesthetics", "Gym / Fitness", "Real Estate", "Roofing",
  "HVAC", "Plumbing", "Solar", "Auto Detailing", "Landscaping", "Pest Control",
  "Chiropractic", "Law Firm", "Restaurant", "Photography", "Wedding Services",
  "Pet Services", "E-Commerce", "Insurance", "Coaching / Consulting",
  "Pressure Washing", "Junk Removal", "Electrical", "Marketing Agency", "Other",
];

const TONES = [
  { value: "professional", label: "Professional", desc: "Clean and trustworthy" },
  { value: "luxury", label: "Luxury", desc: "Premium and elegant" },
  { value: "bold", label: "Bold & Energetic", desc: "High-energy, attention-grabbing" },
  { value: "friendly", label: "Friendly & Warm", desc: "Approachable and welcoming" },
  { value: "minimal", label: "Minimal & Modern", desc: "Simple, sleek design" },
];

const COLORS = [
  { value: "#6366f1", label: "Indigo" },
  { value: "#D4AF37", label: "Gold" },
  { value: "#10b981", label: "Emerald" },
  { value: "#ef4444", label: "Red" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#8b5cf6", label: "Purple" },
  { value: "#f59e0b", label: "Amber" },
  { value: "#ec4899", label: "Pink" },
  { value: "#14b8a6", label: "Teal" },
  { value: "#ff6b35", label: "Orange" },
];

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
  else if (referrer) source = "referral";
  return { device: isMobile ? "mobile" : "desktop", referrer: source, timeOfDay, hour, language: navigator.language || "en-US" };
}

interface PromptFormData {
  businessName: string;
  industry: string;
  description: string;
  services: string;
  targetAudience: string;
  tone: string;
  colorPreference: string;
}

function PromptBuilder({ onGenerate, generating }: { onGenerate: (data: PromptFormData) => void; generating: boolean }) {
  const [form, setForm] = useState<PromptFormData>({
    businessName: "",
    industry: "",
    description: "",
    services: "",
    targetAudience: "",
    tone: "professional",
    colorPreference: "#6366f1",
  });
  const [step, setStep] = useState(0);

  const update = (field: keyof PromptFormData, value: string) => setForm(prev => ({ ...prev, [field]: value }));
  const canGenerate = form.businessName.trim().length > 0;

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-indigo-500/30 text-indigo-400 bg-indigo-500/10 mb-6">
            <Wand2 size={14} /> Liquid Website Protocol
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-3" data-testid="text-liquid-title">
            Build Your AI Website
          </h1>
          <p className="text-lg text-neutral-400 max-w-lg mx-auto">
            Tell us about your business and AI will generate a complete, personalized landing page in seconds.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8 space-y-6"
        >
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-neutral-300 flex items-center gap-2 mb-2">
                <Building2 size={15} className="text-indigo-400" /> Business Name *
              </label>
              <Input
                placeholder="e.g. Bright Smile Dental"
                value={form.businessName}
                onChange={(e) => update("businessName", e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-neutral-500 h-12 text-base"
                data-testid="input-liquid-business-name"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-neutral-300 flex items-center gap-2 mb-2">
                <Briefcase size={15} className="text-emerald-400" /> Industry
              </label>
              <div className="flex flex-wrap gap-2">
                {INDUSTRIES.slice(0, step === 0 && !form.industry ? 10 : INDUSTRIES.length).map(ind => (
                  <button
                    key={ind}
                    onClick={() => update("industry", ind)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      form.industry === ind
                        ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
                        : "bg-white/5 text-neutral-400 hover:bg-white/10 border border-white/10"
                    }`}
                    data-testid={`button-industry-${ind.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {ind}
                  </button>
                ))}
                {step === 0 && !form.industry && (
                  <button
                    onClick={() => setStep(1)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/5 text-indigo-400 hover:bg-white/10 border border-indigo-500/20"
                  >
                    Show all...
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-neutral-300 flex items-center gap-2 mb-2">
                <MessageSquare size={15} className="text-cyan-400" /> Describe your business
              </label>
              <textarea
                placeholder="e.g. We're a family dental practice in Fort Myers, FL. We specialize in cosmetic dentistry, implants, and Invisalign. We've been serving the community for 15 years."
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                className="w-full h-24 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-neutral-500 p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                data-testid="input-liquid-description"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-neutral-300 flex items-center gap-2 mb-2">
                <FileText size={15} className="text-amber-400" /> Key Services (optional)
              </label>
              <Input
                placeholder="e.g. Teeth Whitening, Dental Implants, Invisalign, Emergency Care"
                value={form.services}
                onChange={(e) => update("services", e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-neutral-500"
                data-testid="input-liquid-services"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-neutral-300 flex items-center gap-2 mb-2">
                <Target size={15} className="text-rose-400" /> Target Audience (optional)
              </label>
              <Input
                placeholder="e.g. Families, young professionals, seniors in Southwest Florida"
                value={form.targetAudience}
                onChange={(e) => update("targetAudience", e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-neutral-500"
                data-testid="input-liquid-audience"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-neutral-300 flex items-center gap-2 mb-2">
                <Sparkles size={15} className="text-purple-400" /> Tone & Style
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {TONES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => update("tone", t.value)}
                    className={`p-3 rounded-xl text-left transition-all ${
                      form.tone === t.value
                        ? "bg-indigo-500/15 border-indigo-500/50 shadow-lg"
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    } border`}
                    data-testid={`button-tone-${t.value}`}
                  >
                    <p className="text-xs font-semibold text-white">{t.label}</p>
                    <p className="text-[10px] text-neutral-500 mt-0.5">{t.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-neutral-300 flex items-center gap-2 mb-2">
                <Palette size={15} className="text-pink-400" /> Brand Color
              </label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map(c => (
                  <button
                    key={c.value}
                    onClick={() => update("colorPreference", c.value)}
                    className={`w-9 h-9 rounded-full transition-all flex items-center justify-center ${
                      form.colorPreference === c.value ? "ring-2 ring-white ring-offset-2 ring-offset-neutral-950 scale-110" : "hover:scale-105"
                    }`}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                    data-testid={`button-color-${c.label.toLowerCase()}`}
                  >
                    {form.colorPreference === c.value && <Check size={16} className="text-white drop-shadow-lg" />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Button
            onClick={() => onGenerate(form)}
            disabled={!canGenerate || generating}
            className="w-full h-14 text-base font-bold rounded-xl shadow-xl"
            style={{
              backgroundColor: canGenerate ? form.colorPreference : undefined,
              color: "#000",
              boxShadow: canGenerate ? `0 0 40px ${form.colorPreference}30` : undefined,
            }}
            data-testid="button-generate-site"
          >
            {generating ? (
              <>
                <Loader2 className="animate-spin mr-2" size={20} />
                AI is building your site...
              </>
            ) : (
              <>
                <Wand2 className="mr-2" size={20} />
                Generate My Website
              </>
            )}
          </Button>

          {!canGenerate && (
            <p className="text-xs text-neutral-500 text-center">Enter your business name to get started</p>
          )}
        </motion.div>
      </div>
    </div>
  );
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
              <h2 className="text-lg font-bold text-white">Advanced Settings</h2>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white p-2 hover:bg-white/10 rounded-lg transition-colors" data-testid="button-close-settings">
              <X size={18} />
            </button>
          </div>

          <div className="p-6 space-y-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Link2 size={16} className="text-indigo-400" />
                <h3 className="font-semibold text-white">Domain & Infrastructure</h3>
              </div>
              <p className="text-sm text-slate-400 mb-3">
                Connect a custom domain in Settings &gt; Domains. Once verified, your Liquid site deploys to that URL.
              </p>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 space-y-1">
                <p><span className="text-indigo-400">A Record:</span> Point your domain to <code className="bg-black/30 px-1 rounded">76.76.21.21</code></p>
                <p><span className="text-indigo-400">CNAME:</span> Point <code className="bg-black/30 px-1 rounded">www</code> to <code className="bg-black/30 px-1 rounded">cname.apex-sites.com</code></p>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Layers size={16} className="text-emerald-400" />
                <h3 className="font-semibold text-white">Template Variables</h3>
              </div>
              <p className="text-sm text-slate-400 mb-3">
                Use these in your content. Known CRM contacts get personalized data automatically.
              </p>
              <div className="space-y-2">
                {[
                  { var: "{{contact.first_name | default: 'Welcome'}}", desc: "Visitor's first name from CRM" },
                  { var: "{{url_param.heading}}", desc: "Dynamic headline from ad URL" },
                  { var: "{{url_param.cta}}", desc: "Dynamic CTA from ad URL" },
                  { var: "{{url_param.offer}}", desc: "Dynamic offer from ad URL" },
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
                <h3 className="font-semibold text-white">URL Parameter Injection</h3>
              </div>
              <p className="text-sm text-slate-400 mb-3">
                Append URL parameters to your ad links. The page swaps content in real-time.
              </p>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
                <p className="text-xs text-slate-300 font-semibold">Example Ad Link:</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-amber-400 font-mono break-all flex-1">{exampleAdUrl}</code>
                  <button onClick={() => copyToClipboard(exampleAdUrl, "ad-url")} className="p-1.5 rounded hover:bg-white/10 text-slate-400 shrink-0" data-testid="button-copy-ad-url">
                    {copied === "ad-url" ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stickyContact, setStickyContactState] = useState<any>(getStickyContact());
  const [crmContact, setCrmContact] = useState<any>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lastPrompt, setLastPrompt] = useState<PromptFormData | null>(null);
  const [showPrompt, setShowPrompt] = useState(true);
  const subAccountId = useActiveSubAccountId();
  const { toast } = useToast();

  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);

  const templateVars: Record<string, string> = {};
  const contactData = crmContact || stickyContact;
  if (contactData?.firstName) templateVars["contact.first_name"] = contactData.firstName;
  if (contactData?.email) templateVars["contact.email"] = contactData.email;
  if (contactData?.phone) templateVars["contact.phone"] = contactData.phone;
  for (const [key, value] of urlParams.entries()) {
    if (key !== "vibe" && key !== "contact_email" && key !== "contact_phone") {
      templateVars[`url_param.${key}`] = value;
    }
  }

  const scrollToForm = useCallback(() => {
    document.getElementById("booking-form")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleFormSubmit = (data: any) => {
    setStickyContactState(data);
    if (data.firstName) templateVars["contact.first_name"] = data.firstName;
  };

  const generateSite = async (formData: PromptFormData) => {
    setLoading(true);
    setError(null);
    setLastPrompt(formData);
    setShowPrompt(false);

    const ctx = getVisitorContext();
    const sticky = getStickyContact();

    if ((sticky?.email || sticky?.phone) && subAccountId) {
      try {
        const lookupRes = await fetch("/api/liquid/contact-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subAccountId, email: sticky.email, phone: sticky.phone }),
        });
        const lookupData = await lookupRes.json();
        if (lookupData.contact) {
          setCrmContact(lookupData.contact);
          setStickyContact({ firstName: lookupData.contact.firstName, email: lookupData.contact.email, phone: lookupData.contact.phone });
          setStickyContactState({ firstName: lookupData.contact.firstName, email: lookupData.contact.email, phone: lookupData.contact.phone });
        }
      } catch {}
    }

    try {
      const res = await fetch("/api/generate-liquid-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...ctx,
          contactName: sticky?.firstName || crmContact?.firstName || undefined,
          heading: urlParams.get("heading") || undefined,
          businessName: formData.businessName,
          industry: formData.industry,
          description: formData.description,
          tone: formData.tone,
          targetAudience: formData.targetAudience,
          services: formData.services,
          colorPreference: formData.colorPreference,
        }),
      });
      if (!res.ok) throw new Error("Failed to generate site");
      const data = await res.json();
      if (formData.colorPreference && data.theme) {
        data.theme.primary = formData.colorPreference;
      }
      setSiteData(data);
      toast({ title: "Site generated!", description: `Your ${formData.businessName} landing page is ready.` });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = () => {
    setShowPrompt(true);
    setSiteData(null);
  };

  useEffect(() => {
    const heading = urlParams.get("heading");
    const businessName = urlParams.get("business");
    const industry = urlParams.get("industry");
    if (heading || businessName) {
      generateSite({
        businessName: businessName || "Your Business",
        industry: industry || "",
        description: "",
        services: "",
        targetAudience: "",
        tone: "professional",
        colorPreference: "#6366f1",
      });
    }
  }, []);

  if (showPrompt && !loading && !siteData) {
    return <PromptBuilder onGenerate={generateSite} generating={loading} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-white">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-6">
          <div className="relative">
            <Globe className="h-16 w-16 text-indigo-500 animate-pulse" />
            <Loader2 className="h-8 w-8 text-indigo-400 animate-spin absolute -bottom-1 -right-1" />
          </div>
          <div className="text-center space-y-2">
            <p className="text-lg font-medium">Building your {lastPrompt?.businessName || ""} website...</p>
            <p className="text-sm text-neutral-400">AI is writing copy, choosing images, and designing your page</p>
          </div>
          {lastPrompt && (
            <div className="mt-4 text-xs text-neutral-500 bg-white/5 rounded-lg p-4 space-y-1 max-w-sm" data-testid="text-liquid-context">
              <p>Business: {lastPrompt.businessName}</p>
              {lastPrompt.industry && <p>Industry: {lastPrompt.industry}</p>}
              {lastPrompt.tone && <p>Tone: {lastPrompt.tone}</p>}
              {lastPrompt.services && <p>Services: {lastPrompt.services}</p>}
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
          <div className="flex gap-3 justify-center">
            <Button onClick={handleRegenerate} variant="outline" data-testid="button-liquid-back">
              <ArrowRight className="mr-2 rotate-180" size={16} /> Back to Prompt
            </Button>
            <Button onClick={() => lastPrompt && generateSite(lastPrompt)} data-testid="button-liquid-retry">
              <RotateCcw className="mr-2" size={16} /> Try Again
            </Button>
          </div>
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

      <div className="fixed bottom-6 left-6 z-50 flex gap-2">
        <button
          onClick={handleRegenerate}
          className="p-3 rounded-full shadow-lg transition-transform hover:scale-110 bg-white/10 backdrop-blur-md text-white border border-white/20"
          title="Edit & Regenerate"
          data-testid="button-liquid-regenerate"
        >
          <RotateCcw size={20} />
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-3 rounded-full shadow-lg transition-transform hover:scale-110"
          style={{ backgroundColor: siteData.theme?.primary || "#6366f1", color: siteData.theme?.bg || "#000" }}
          title="Advanced Settings"
          data-testid="button-liquid-settings"
        >
          <Settings size={20} />
        </button>
      </div>

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
