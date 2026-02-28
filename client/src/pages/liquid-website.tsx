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
  EyeOff,
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
  Edit,
  Trash2,
  Plus,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Save,
  Upload,
  Crown,
  Flame,
  Camera,
  Bot,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatWidget } from "@/components/chat-widget";
import { useActiveSubAccountId } from "@/components/account-required";
import { useToast } from "@/hooks/use-toast";

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  ShieldCheck, Clock, Sparkles, Star, Dumbbell, Heart, Zap, Trophy, CheckCircle2, Crown, Flame, Camera,
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

const ARRAY_FIELD_CONFIGS: Record<string, { key: string; addLabel: string; defaultItem: any; fields: { key: string; label: string; type?: string }[] }> = {
  features: { key: "features", addLabel: "Add Feature", defaultItem: { icon: "Star", title: "New Feature", desc: "Description" }, fields: [{ key: "icon", label: "Icon", type: "select-icon" }, { key: "title", label: "Title" }, { key: "desc", label: "Description", type: "textarea" }] },
  testimonials: { key: "testimonials", addLabel: "Add Testimonial", defaultItem: { name: "Client", role: "Customer", quote: "Great service!", stars: 5 }, fields: [{ key: "name", label: "Name" }, { key: "role", label: "Role" }, { key: "quote", label: "Quote", type: "textarea" }, { key: "stars", label: "Stars", type: "number" }] },
  faqs: { key: "faqs", addLabel: "Add FAQ", defaultItem: { q: "Question?", a: "Answer." }, fields: [{ key: "q", label: "Question" }, { key: "a", label: "Answer", type: "textarea" }] },
  plans: { key: "plans", addLabel: "Add Plan", defaultItem: { name: "Plan", description: "For everyone", price: 29, period: "mo", features: ["Feature 1"], cta: "Choose" }, fields: [{ key: "name", label: "Name" }, { key: "description", label: "Description" }, { key: "price", label: "Price", type: "number" }, { key: "period", label: "Period" }, { key: "cta", label: "Button Text" }] },
  tiers: { key: "tiers", addLabel: "Add Tier", defaultItem: { name: "Tier", price: 9, perks: ["Perk 1"], cta: "Subscribe" }, fields: [{ key: "name", label: "Name" }, { key: "price", label: "Price", type: "number" }, { key: "cta", label: "Button Text" }] },
  members: { key: "members", addLabel: "Add Member", defaultItem: { name: "Name", role: "Role" }, fields: [{ key: "name", label: "Name" }, { key: "role", label: "Role" }, { key: "image", label: "Image URL" }] },
  stats: { key: "stats", addLabel: "Add Stat", defaultItem: { value: "0", label: "Label" }, fields: [{ key: "value", label: "Value" }, { key: "label", label: "Label" }] },
  events: { key: "events", addLabel: "Add Event", defaultItem: { date: "2024", title: "Event", desc: "Description" }, fields: [{ key: "date", label: "Date" }, { key: "title", label: "Title" }, { key: "desc", label: "Description", type: "textarea" }] },
  steps: { key: "steps", addLabel: "Add Step", defaultItem: { title: "Step", desc: "Description" }, fields: [{ key: "title", label: "Title" }, { key: "desc", label: "Description", type: "textarea" }] },
};

function LiquidArrayItemEditor({ item, fields, onChange, onRemove }: { item: any; fields: { key: string; label: string; type?: string }[]; onChange: (u: any) => void; onRemove: () => void }) {
  return (
    <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2 relative group/item">
      <button onClick={onRemove} className="absolute top-2 right-2 p-1 text-slate-400 hover:text-red-400 opacity-0 group-hover/item:opacity-100 transition-opacity"><Trash2 size={12} /></button>
      {fields.map((f) => (
        <div key={f.key}>
          <label className="text-[10px] text-slate-400 block mb-0.5">{f.label}</label>
          {f.type === "textarea" ? (
            <textarea value={item[f.key] || ""} onChange={(e) => onChange({ ...item, [f.key]: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-md p-2 text-xs text-white resize-none h-16 focus:outline-none focus:border-indigo-500" />
          ) : f.type === "number" ? (
            <input type="number" value={item[f.key] ?? ""} onChange={(e) => onChange({ ...item, [f.key]: parseFloat(e.target.value) || 0 })} className="w-full bg-white/5 border border-white/10 rounded-md p-2 text-xs text-white focus:outline-none focus:border-indigo-500" />
          ) : f.type === "select-icon" ? (
            <select value={item[f.key] || "Star"} onChange={(e) => onChange({ ...item, [f.key]: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-md p-2 text-xs text-white focus:outline-none focus:border-indigo-500">
              {Object.keys(ICON_MAP).map((ic) => <option key={ic} value={ic}>{ic}</option>)}
            </select>
          ) : (
            <input value={item[f.key] || ""} onChange={(e) => onChange({ ...item, [f.key]: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-md p-2 text-xs text-white focus:outline-none focus:border-indigo-500" />
          )}
        </div>
      ))}
    </div>
  );
}

function LiquidSectionEditor({ section, index, onUpdate, onClose }: { section: any; index: number; onUpdate: (idx: number, props: any) => void; onClose: () => void }) {
  const [editProps, setEditProps] = useState<Record<string, any>>(JSON.parse(JSON.stringify(section.props)));
  const [activeTab, setActiveTab] = useState<"fields" | "arrays">("fields");

  const handleChange = (key: string, value: any) => {
    setEditProps((prev: Record<string, any>) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => { onUpdate(index, editProps); onClose(); };

  const stringFields = Object.entries(editProps).filter(([, v]) => typeof v === "string" || typeof v === "number");
  const arrayFields = Object.entries(editProps).filter(([, v]) => Array.isArray(v));
  const hasArrays = arrayFields.length > 0;

  return (
    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="bg-neutral-900 border border-white/10 rounded-xl p-4 mb-2 max-h-[70vh] overflow-y-auto" data-testid={`liquid-editor-section-${index}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-indigo-400">Edit {section.type}</span>
        <button onClick={onClose} className="text-slate-200 hover:text-white"><X size={16} /></button>
      </div>
      <div className="space-y-3">
        {hasArrays && (
          <div className="flex gap-1 mb-2">
            <button onClick={() => setActiveTab("fields")} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === "fields" ? "bg-indigo-600 text-white" : "bg-white/5 text-slate-300"}`}>Content</button>
            <button onClick={() => setActiveTab("arrays")} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === "arrays" ? "bg-indigo-600 text-white" : "bg-white/5 text-slate-300"}`}>Items ({arrayFields.reduce((s, [, v]) => s + (v as any[]).length, 0)})</button>
          </div>
        )}
        {activeTab === "fields" && stringFields.map(([key, value]) => {
          if (key === "formId") return null;
          if (key === "image") {
            return (
              <div key={key}>
                <label className="text-xs text-slate-200 block mb-1 capitalize">{key}</label>
                <Input value={String(value || "")} onChange={(e) => handleChange(key, e.target.value)} className="bg-white/5 border-white/10 text-sm mb-1" data-testid={`liquid-input-edit-${key}-${index}`} />
                <label className="cursor-pointer px-2 py-1 bg-indigo-600/30 hover:bg-indigo-600/50 rounded text-[10px] text-indigo-300 inline-flex items-center gap-1">
                  <Upload size={10} /> Upload
                  <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const fd = new FormData(); fd.append("image", file); try { const res = await fetch("/api/upload-ad-image", { method: "POST", body: fd }); const d = await res.json(); if (d.url) handleChange("image", d.url); } catch {} e.target.value = ""; }} />
                </label>
              </div>
            );
          }
          return (
            <div key={key}>
              <label className="text-xs text-slate-200 block mb-1 capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</label>
              <Input value={String(value || "")} onChange={(e) => handleChange(key, typeof value === "number" ? (parseFloat(e.target.value) || 0) : e.target.value)} className="bg-white/5 border-white/10 text-sm" data-testid={`liquid-input-edit-${key}-${index}`} />
            </div>
          );
        })}
        {activeTab === "arrays" && arrayFields.map(([key, value]) => {
          const config = ARRAY_FIELD_CONFIGS[key];
          const items = value as any[];

          if (!config) {
            if (items.length > 0 && typeof items[0] === "string") {
              return (
                <div key={key}>
                  <label className="text-xs text-slate-200 block mb-2 capitalize font-semibold">{key} ({items.length})</label>
                  <div className="space-y-1">
                    {items.map((val: string, vi: number) => (
                      <div key={vi} className="flex gap-1">
                        <input value={val} onChange={(e) => { const arr = [...items]; arr[vi] = e.target.value; handleChange(key, arr); }} className="flex-1 bg-white/5 border border-white/10 rounded-md p-2 text-xs text-white focus:outline-none focus:border-indigo-500" />
                        <button onClick={() => { const arr = [...items]; arr.splice(vi, 1); handleChange(key, arr); }} className="text-slate-400 hover:text-red-400 p-1"><Trash2 size={12} /></button>
                      </div>
                    ))}
                    <button onClick={() => handleChange(key, [...items, ""])} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 mt-1"><Plus size={12} /> Add</button>
                  </div>
                </div>
              );
            }
            return null;
          }

          return (
            <div key={key}>
              <label className="text-xs text-slate-200 block mb-2 capitalize font-semibold">{key} ({items.length})</label>
              <div className="space-y-2">
                {items.map((item: any, ii: number) => (
                  <LiquidArrayItemEditor key={ii} item={item} fields={config.fields} onChange={(u) => { const arr = [...items]; arr[ii] = u; handleChange(key, arr); }} onRemove={() => { const arr = [...items]; arr.splice(ii, 1); handleChange(key, arr); }} />
                ))}
                <button onClick={() => handleChange(key, [...items, JSON.parse(JSON.stringify(config.defaultItem))])} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 w-full justify-center py-2 border border-dashed border-white/10 rounded-lg" data-testid={`liquid-add-${key}`}><Plus size={12} /> {config.addLabel}</button>
              </div>
            </div>
          );
        })}
        <div className="flex gap-2 justify-end pt-2 border-t border-white/10">
          <Button size="sm" variant="outline" className="border-white/10 text-xs" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-500 text-xs" onClick={handleSave} data-testid={`liquid-save-section-${index}`}>Apply</Button>
        </div>
      </div>
    </motion.div>
  );
}

function LiquidThemeEditor({ theme, onUpdate, onClose }: { theme: any; onUpdate: (t: any) => void; onClose: () => void }) {
  const [editTheme, setEditTheme] = useState({ ...theme });
  const FONTS = ["Inter", "Playfair Display", "Poppins", "Montserrat", "Roboto", "Lato", "Raleway", "DM Sans", "Space Grotesk"];
  const PRESETS = ["#6366f1", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#1e40af", "#d4a574", "#a3e635"];
  return (
    <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 200 }} className="fixed right-0 top-0 bottom-0 w-[300px] bg-neutral-900 border-l border-white/10 z-[70] flex flex-col shadow-2xl" data-testid="liquid-theme-editor">
      <div className="p-4 border-b border-white/5 flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2"><Palette size={18} className="text-indigo-400" /> Theme</h3>
        <button onClick={onClose} className="text-slate-200 hover:text-white"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div>
          <label className="text-xs text-slate-300 block mb-2 font-semibold uppercase tracking-wider">Primary Color</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {PRESETS.map((c) => <button key={c} onClick={() => setEditTheme((p: any) => ({ ...p, primary: c }))} className={`w-7 h-7 rounded-full border-2 hover:scale-110 transition-transform ${editTheme.primary === c ? "border-white scale-110" : "border-transparent"}`} style={{ backgroundColor: c }} />)}
          </div>
          <div className="flex gap-2 items-center">
            <input type="color" value={editTheme.primary} onChange={(e) => setEditTheme((p: any) => ({ ...p, primary: e.target.value }))} className="w-8 h-8 rounded cursor-pointer" />
            <Input value={editTheme.primary} onChange={(e) => setEditTheme((p: any) => ({ ...p, primary: e.target.value }))} className="bg-white/5 border-white/10 text-sm flex-1 font-mono" />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-300 block mb-2 font-semibold uppercase tracking-wider">Background</label>
          <div className="flex gap-2 items-center">
            <input type="color" value={editTheme.bg} onChange={(e) => setEditTheme((p: any) => ({ ...p, bg: e.target.value }))} className="w-8 h-8 rounded cursor-pointer" />
            <Input value={editTheme.bg} onChange={(e) => setEditTheme((p: any) => ({ ...p, bg: e.target.value }))} className="bg-white/5 border-white/10 text-sm flex-1 font-mono" />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-300 block mb-2 font-semibold uppercase tracking-wider">Text Color</label>
          <div className="flex gap-2 items-center">
            <input type="color" value={editTheme.text} onChange={(e) => setEditTheme((p: any) => ({ ...p, text: e.target.value }))} className="w-8 h-8 rounded cursor-pointer" />
            <Input value={editTheme.text} onChange={(e) => setEditTheme((p: any) => ({ ...p, text: e.target.value }))} className="bg-white/5 border-white/10 text-sm flex-1 font-mono" />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-300 block mb-2 font-semibold uppercase tracking-wider">Font</label>
          <select value={editTheme.font} onChange={(e) => setEditTheme((p: any) => ({ ...p, font: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-indigo-500">
            {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="p-3 rounded-xl" style={{ backgroundColor: editTheme.bg, border: `1px solid ${editTheme.text}20` }}>
          <p className="text-lg font-bold" style={{ color: editTheme.text, fontFamily: editTheme.font }}>Preview</p>
          <p className="text-sm mt-1" style={{ color: editTheme.text, opacity: 0.7 }}>Body text</p>
          <div className="mt-2 inline-block px-4 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: editTheme.primary, color: editTheme.bg }}>Button</div>
        </div>
      </div>
      <div className="p-4 border-t border-white/5 flex gap-2">
        <Button variant="outline" className="flex-1 border-white/10 text-xs" onClick={onClose}>Cancel</Button>
        <Button className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-xs" onClick={() => { onUpdate(editTheme); onClose(); }} data-testid="liquid-apply-theme">Apply</Button>
      </div>
    </motion.div>
  );
}

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
  const [editMode, setEditMode] = useState(false);
  const [editingSectionIndex, setEditingSectionIndex] = useState<number | null>(null);
  const [showThemeEditor, setShowThemeEditor] = useState(false);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [savingDesign, setSavingDesign] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");
  const subAccountId = useActiveSubAccountId();
  const { toast } = useToast();

  const handleUpdateSectionProps = (idx: number, newProps: any) => {
    setSiteData((prev: any) => {
      const sections = [...prev.sections];
      sections[idx] = { ...sections[idx], props: newProps };
      return { ...prev, sections };
    });
  };

  const handleDeleteSection = (idx: number) => {
    setSiteData((prev: any) => {
      const sections = [...prev.sections];
      sections.splice(idx, 1);
      return { ...prev, sections };
    });
    setEditingSectionIndex(null);
  };

  const handleAddSection = (type: string) => {
    const defaults: Record<string, any> = {
      HERO: { title: "Your Headline", subtitle: "Your subheadline goes here.", cta: "Get Started" },
      FEATURES: { title: "Features", features: [{ icon: "Star", title: "Feature 1", desc: "Description" }, { icon: "Zap", title: "Feature 2", desc: "Description" }, { icon: "Heart", title: "Feature 3", desc: "Description" }] },
      TESTIMONIALS: { title: "What Clients Say", testimonials: [{ name: "Client", role: "Customer", quote: "Great service!", stars: 5 }] },
      BOOKING: { title: "Book Now" },
      CTA: { title: "Ready to Get Started?", subtitle: "Take the next step today.", cta: "Contact Us" },
    };
    setSiteData((prev: any) => ({
      ...prev,
      sections: [...prev.sections, { type, props: defaults[type] || { title: "New Section" } }],
    }));
    setAddSectionOpen(false);
  };

  const handleDragStart = (idx: number) => setDragIndex(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === idx) return;
    setSiteData((prev: any) => {
      const sections = [...prev.sections];
      const dragged = sections.splice(dragIndex, 1)[0];
      sections.splice(idx, 0, dragged);
      return { ...prev, sections };
    });
    setDragIndex(idx);
  };
  const handleDrop = () => setDragIndex(null);

  const handleSaveAsDesign = async () => {
    if (!saveName.trim() || !siteData) return;
    setSavingDesign(true);
    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName.trim(), prompt: lastPrompt?.businessName || "Liquid Site", siteData }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setShowSaveDialog(false);
      setSaveName("");
      toast({ title: "Saved!", description: "Design saved to your Site Architect library." });
    } catch (err: any) {
      toast({ title: "Save Failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingDesign(false);
    }
  };

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
      {stickyContact?.firstName && !editMode && (
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

      {editMode && (
        <div className="sticky top-0 z-50 h-12 bg-neutral-900/95 backdrop-blur-md border-b border-white/10 flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-amber-400 flex items-center gap-1"><Edit size={12} /> EDIT MODE</span>
            <span className="text-xs text-slate-400">{siteData.sections?.length} sections</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowThemeEditor(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-slate-200 hover:text-white hover:border-indigo-500/30 flex items-center gap-1" data-testid="button-liquid-theme">
              <Palette size={12} /> Theme
            </button>
            <button onClick={() => { setShowSaveDialog(true); setSaveName(lastPrompt?.businessName || ""); }} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1" data-testid="button-liquid-save-design">
              <Save size={12} /> Save Design
            </button>
            <button onClick={() => { setEditMode(false); setEditingSectionIndex(null); }} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-slate-200 hover:text-white flex items-center gap-1" data-testid="button-liquid-exit-edit">
              <Eye size={12} /> Preview
            </button>
          </div>
        </div>
      )}

      {siteData.sections?.map((section: any, i: number) => {
        const Component = COMPONENT_MAP[section.type];
        if (!Component) return null;

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
              data-testid={`liquid-section-wrapper-${i}`}
            >
              <div className="absolute left-0 top-0 bottom-0 w-10 flex flex-col items-center justify-center gap-1 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-grab">
                <GripVertical size={18} className="text-white/70" />
              </div>
              <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                <button onClick={() => setEditingSectionIndex(editingSectionIndex === i ? null : i)} className="p-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500" data-testid={`button-liquid-edit-section-${i}`}><Edit size={14} /></button>
                <button onClick={() => handleDeleteSection(i)} className="p-1.5 rounded bg-red-600 text-white hover:bg-red-500" data-testid={`button-liquid-delete-section-${i}`}><Trash2 size={14} /></button>
                {i > 0 && <button onClick={() => { setSiteData((prev: any) => { const s = [...prev.sections]; [s[i-1], s[i]] = [s[i], s[i-1]]; return { ...prev, sections: s }; }); }} className="p-1.5 rounded bg-white/10 text-white hover:bg-white/20"><ArrowUp size={14} /></button>}
                {i < siteData.sections.length - 1 && <button onClick={() => { setSiteData((prev: any) => { const s = [...prev.sections]; [s[i], s[i+1]] = [s[i+1], s[i]]; return { ...prev, sections: s }; }); }} className="p-1.5 rounded bg-white/10 text-white hover:bg-white/20"><ArrowDown size={14} /></button>}
              </div>
              <AnimatePresence>
                {editingSectionIndex === i && (
                  <LiquidSectionEditor section={section} index={i} onUpdate={handleUpdateSectionProps} onClose={() => setEditingSectionIndex(null)} />
                )}
              </AnimatePresence>
              <Component {...section.props} theme={siteData.theme} templateVars={templateVars} subAccountId={subAccountId} stickyContact={stickyContact} onCtaClick={scrollToForm} onFormSubmit={handleFormSubmit} />
            </div>
          );
        }

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

      {editMode && (
        <div className="p-6 flex justify-center">
          {addSectionOpen ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap gap-2 max-w-md justify-center bg-neutral-900/90 backdrop-blur-md p-4 rounded-xl border border-white/10">
              {Object.keys(COMPONENT_MAP).map((type) => (
                <button key={type} onClick={() => handleAddSection(type)} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white hover:bg-indigo-600/20 hover:border-indigo-500/30 transition-colors" data-testid={`button-liquid-add-${type}`}>{type}</button>
              ))}
              <Button size="sm" variant="outline" className="border-white/10 text-xs" onClick={() => setAddSectionOpen(false)}>Cancel</Button>
            </motion.div>
          ) : (
            <Button variant="outline" className="border-dashed border-white/20 text-slate-200 hover:text-white hover:border-indigo-500" onClick={() => setAddSectionOpen(true)} data-testid="button-liquid-add-section">
              <Plus size={16} className="mr-2" /> Add Section
            </Button>
          )}
        </div>
      )}

      <div className="fixed bottom-6 left-6 z-50 flex gap-2">
        <button
          onClick={handleRegenerate}
          className="p-3 rounded-full shadow-lg transition-transform hover:scale-110 bg-white/10 backdrop-blur-md text-white border border-white/20"
          title="Regenerate"
          data-testid="button-liquid-regenerate"
        >
          <RotateCcw size={20} />
        </button>
        <button
          onClick={() => setEditMode(!editMode)}
          className={`p-3 rounded-full shadow-lg transition-transform hover:scale-110 backdrop-blur-md border ${editMode ? "bg-amber-500/20 border-amber-500/40 text-amber-300" : "bg-white/10 text-white border-white/20"}`}
          title={editMode ? "Exit Edit Mode" : "Edit Mode"}
          data-testid="button-liquid-toggle-edit"
        >
          {editMode ? <EyeOff size={20} /> : <Edit size={20} />}
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

      <AnimatePresence>
        {showThemeEditor && (
          <LiquidThemeEditor
            theme={siteData.theme}
            onUpdate={(newTheme) => setSiteData((prev: any) => ({ ...prev, theme: newTheme }))}
            onClose={() => setShowThemeEditor(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSaveDialog && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowSaveDialog(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-neutral-900 border border-white/10 rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="liquid-save-dialog">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">Save to My Designs</h3>
                <button onClick={() => setShowSaveDialog(false)} className="text-slate-200 hover:text-white"><X size={18} /></button>
              </div>
              <p className="text-sm text-slate-300 mb-4">Save this site to your Site Architect library for further editing and publishing.</p>
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Design name..."
                className="bg-white/5 border-white/10 mb-4 text-white"
                onKeyDown={(e) => e.key === "Enter" && saveName.trim() && handleSaveAsDesign()}
                autoFocus
                data-testid="liquid-input-save-name"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" className="border-white/10" onClick={() => setShowSaveDialog(false)}>Cancel</Button>
                <Button size="sm" className="bg-indigo-600 hover:bg-indigo-500" onClick={handleSaveAsDesign} disabled={!saveName.trim() || savingDesign} data-testid="liquid-confirm-save">
                  {savingDesign ? <Loader2 size={14} className="animate-spin mr-2" /> : <Save size={14} className="mr-2" />}
                  Save Design
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
