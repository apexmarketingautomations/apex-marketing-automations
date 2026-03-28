import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useActiveSubAccountId } from "@/components/account-required";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PlanGate } from "@/components/plan-gate";
import {
  ContactRound, Phone, Mail, Globe, Star, Save, Eye, Copy, QrCode,
  ExternalLink, Plus, Trash2, Monitor, Smartphone, MapPin, Calendar,
  Palette, Check, AlertCircle, BarChart3, Share2, Link2, EyeOff,
  Sparkles, Briefcase, Image
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface ServiceItem {
  label: string;
  description: string;
  icon: string;
  color: string;
}

interface TestimonialData {
  quote: string;
  author: string;
  role: string;
}

interface CardConfig {
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
  socialLinks: { label: string; url: string }[];
  links: { label: string; url: string; type: string }[];
  services: ServiceItem[];
  testimonial: TestimonialData | null;
  leadCaptureEnabled: boolean;
  seoTitle: string;
  seoDescription: string;
  ogImageUrl: string;
  status: string;
  isActive: boolean;
  isPublic: boolean;
  viewCount: number;
  saveContactCount: number;
  shareCount: number;
}

const THEMES = [
  { id: "executive-dark", label: "Executive", desc: "Premium dark", preview: "bg-gradient-to-br from-gray-900 to-indigo-950" },
  { id: "luxury-dark", label: "Luxury", desc: "Gold & amber", preview: "bg-gradient-to-br from-gray-900 to-amber-950" },
  { id: "clean-light", label: "Clean", desc: "Light & minimal", preview: "bg-gradient-to-br from-gray-50 to-blue-50" },
  { id: "bold-agency", label: "Agency", desc: "Cyan & bold", preview: "bg-gradient-to-br from-slate-900 to-cyan-950" },
  { id: "modern-gradient", label: "Gradient", desc: "Violet blend", preview: "bg-gradient-to-br from-indigo-950 to-purple-950" },
  { id: "minimal-neutral", label: "Neutral", desc: "Stone & warm", preview: "bg-gradient-to-br from-stone-100 to-stone-200" },
];

const SERVICE_ICONS = [
  { id: "palette", label: "Design" },
  { id: "code", label: "Code" },
  { id: "globe", label: "Web" },
  { id: "megaphone", label: "Marketing" },
  { id: "bot", label: "AI" },
  { id: "mic", label: "Voice" },
  { id: "workflow", label: "Automation" },
  { id: "analytics", label: "Analytics" },
  { id: "briefcase", label: "Business" },
  { id: "sparkles", label: "Creative" },
];

const SERVICE_COLORS = [
  "from-pink-500 to-rose-500",
  "from-indigo-500 to-blue-500",
  "from-cyan-500 to-teal-500",
  "from-orange-500 to-amber-500",
  "from-purple-500 to-violet-500",
  "from-emerald-500 to-green-500",
  "from-blue-500 to-indigo-500",
  "from-yellow-500 to-orange-500",
  "from-red-500 to-pink-500",
  "from-slate-500 to-zinc-500",
];

const DEFAULT_CARD: CardConfig = {
  name: "", preferredName: "", title: "", company: "", phone: "", email: "",
  website: "", bio: "", photoUrl: "", coverImageUrl: "", logoImageUrl: "",
  googleReviewLink: "", slug: "", brandColor: "#6366f1", accentColor: "#8b5cf6",
  theme: "executive-dark", layoutVariant: "standard", bookingUrl: "", calendarUrl: "",
  location: "", tagline: "", socialLinks: [], links: [], services: [],
  testimonial: null, leadCaptureEnabled: false, seoTitle: "", seoDescription: "",
  ogImageUrl: "", status: "draft", isActive: true, isPublic: true,
  viewCount: 0, saveContactCount: 0, shareCount: 0,
};

function SlugEditor({ slug, subAccountId, onChange }: { slug: string; subAccountId: number; onChange: (v: string) => void }) {
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!slug || slug.length < 2) { setAvailable(null); return; }
    setChecking(true);
    const t = setTimeout(() => {
      fetch(`/api/check-slug/${slug}?subAccountId=${subAccountId}`)
        .then(r => r.json())
        .then(data => { setAvailable(data.available); setChecking(false); })
        .catch(() => setChecking(false));
    }, 400);
    return () => clearTimeout(t);
  }, [slug, subAccountId]);

  return (
    <div>
      <Label className="text-slate-300">Card URL Slug</Label>
      <div className="relative">
        <Input
          value={slug}
          onChange={e => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          placeholder="your-name"
          className="bg-white/5 border-white/10 text-white pr-10"
          data-testid="input-slug"
        />
        {slug.length >= 2 && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {checking ? <div className="w-4 h-4 border-2 border-cyan-400/40 border-t-cyan-400 rounded-full animate-spin" /> :
              available === true ? <Check size={16} className="text-green-400" /> :
              available === false ? <AlertCircle size={16} className="text-red-400" /> : null}
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-1">
        {slug ? `yoursite.com/card/${slug}` : "Choose a unique slug for your card URL"}
        {available === false && <span className="text-red-400 ml-1">— already taken</span>}
      </p>
    </div>
  );
}

function AnalyticsSummary({ card }: { card: CardConfig }) {
  return (
    <Card className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border-indigo-500/20">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 size={16} className="text-indigo-400" />
          <h3 className="text-sm font-bold text-white">Card Analytics</h3>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-2 rounded-xl bg-white/5">
            <p className="text-lg font-bold text-white">{card.viewCount || 0}</p>
            <p className="text-[10px] text-slate-500 uppercase font-bold">Views</p>
          </div>
          <div className="text-center p-2 rounded-xl bg-white/5">
            <p className="text-lg font-bold text-white">{card.saveContactCount || 0}</p>
            <p className="text-[10px] text-slate-500 uppercase font-bold">Saves</p>
          </div>
          <div className="text-center p-2 rounded-xl bg-white/5">
            <p className="text-lg font-bold text-white">{card.shareCount || 0}</p>
            <p className="text-[10px] text-slate-500 uppercase font-bold">Shares</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DigitalCardBuilderInner() {
  const subAccountId = useActiveSubAccountId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPreview, setShowPreview] = useState(false);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("mobile");
  const [activeSection, setActiveSection] = useState("info");

  const { data: cardConfig, isLoading } = useQuery<CardConfig>({
    queryKey: ["/api/digital-card", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/digital-card/${subAccountId}`);
      if (!res.ok) return DEFAULT_CARD;
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const [form, setForm] = useState<CardConfig | null>(null);
  const config = form || cardConfig || DEFAULT_CARD;

  const saveMutation = useMutation({
    mutationFn: async (data: CardConfig) => {
      await apiRequest("POST", `/api/digital-card/${subAccountId}`, data);
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Your digital card has been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/digital-card", subAccountId] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading || !config) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>;
  }

  const update = (key: keyof CardConfig, value: any) => {
    setForm({ ...config, [key]: value });
  };

  const addLink = () => setForm({ ...config, links: [...(config.links || []), { label: "", url: "", type: "link" }] });
  const removeLink = (idx: number) => { const links = [...(config.links || [])]; links.splice(idx, 1); setForm({ ...config, links }); };
  const updateLink = (idx: number, key: string, value: string) => { const links = [...(config.links || [])]; links[idx] = { ...links[idx], [key]: value }; setForm({ ...config, links }); };

  const addSocial = () => setForm({ ...config, socialLinks: [...(config.socialLinks || []), { label: "", url: "" }] });
  const removeSocial = (idx: number) => { const s = [...(config.socialLinks || [])]; s.splice(idx, 1); setForm({ ...config, socialLinks: s }); };
  const updateSocial = (idx: number, key: string, value: string) => { const s = [...(config.socialLinks || [])]; s[idx] = { ...s[idx], [key]: value }; setForm({ ...config, socialLinks: s }); };

  const addService = () => setForm({ ...config, services: [...(config.services || []), { label: "", description: "", icon: "briefcase", color: SERVICE_COLORS[0] }] });
  const removeService = (idx: number) => { const s = [...(config.services || [])]; s.splice(idx, 1); setForm({ ...config, services: s }); };
  const updateService = (idx: number, key: string, value: string) => { const s = [...(config.services || [])]; s[idx] = { ...s[idx], [key]: value }; setForm({ ...config, services: s }); };

  const cardUrl = config.slug ? `${window.location.origin}/card/${config.slug}` : "";

  const copyLink = () => {
    if (cardUrl) {
      navigator.clipboard.writeText(cardUrl);
      toast({ title: "Copied", description: "Card link copied to clipboard." });
    }
  };

  const sections = [
    { id: "info", label: "Info", icon: ContactRound },
    { id: "contact", label: "Contact", icon: Phone },
    { id: "media", label: "Media", icon: Image },
    { id: "services", label: "Services", icon: Briefcase },
    { id: "links", label: "Links", icon: Link2 },
    { id: "theme", label: "Theme", icon: Palette },
    { id: "seo", label: "SEO", icon: Globe },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2" data-testid="text-page-title">
            <ContactRound className="text-cyan-400 shrink-0" /> Digital Identity Builder
          </h1>
          <p className="text-slate-400 mt-1 text-sm">Create a premium digital card for sharing and networking</p>
        </div>
        <div className="flex gap-2 flex-wrap w-full sm:w-auto">
          <Button variant="outline" className="border-white/10 text-slate-300 flex-1 sm:flex-none" onClick={() => setShowPreview(!showPreview)} data-testid="button-preview">
            {showPreview ? <EyeOff size={16} className="mr-1" /> : <Eye size={16} className="mr-1" />}
            {showPreview ? "Hide" : "Preview"}
          </Button>
          <select
            value={config.status}
            onChange={e => update("status", e.target.value)}
            className="bg-white/5 border border-white/10 text-white text-sm rounded-lg px-3 py-2"
            data-testid="select-status"
          >
            <option value="draft" className="bg-gray-900">Draft</option>
            <option value="published" className="bg-gray-900">Published</option>
            <option value="archived" className="bg-gray-900">Archived</option>
          </select>
          <Button
            className="bg-gradient-to-r from-cyan-600 to-indigo-600 text-white font-bold flex-1 sm:flex-none"
            onClick={() => saveMutation.mutate(config)}
            disabled={saveMutation.isPending}
            data-testid="button-save"
          >
            <Save size={16} className="mr-1" /> {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {cardUrl && config.status === "published" && (
        <Card className="bg-emerald-500/10 border-emerald-500/30">
          <CardContent className="p-4 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <ExternalLink size={16} className="text-emerald-400" />
              <span className="text-emerald-300 text-sm font-medium">Live at:</span>
              <a href={cardUrl} target="_blank" className="text-emerald-400 underline text-sm" data-testid="link-card-url">{cardUrl}</a>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="text-emerald-400" onClick={copyLink} data-testid="button-copy-link">
                <Copy size={14} className="mr-1" /> Copy
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <AnalyticsSummary card={config} />

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {sections.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all
              ${activeSection === s.id ? "bg-white/10 text-white border border-white/20" : "text-slate-500 hover:text-slate-300"}`}
            data-testid={`tab-${s.id}`}
          >
            <s.icon size={14} /> {s.label}
          </button>
        ))}
      </div>

      <div className={`grid ${showPreview ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"} gap-6`}>
        <div className="space-y-6">
          {activeSection === "info" && (
            <Card className="bg-black/40 border-white/10">
              <CardContent className="p-6 space-y-4">
                <h2 className="text-lg font-bold text-white">Personal Info</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300">Full Name</Label>
                    <Input value={config.name} onChange={e => update("name", e.target.value)} placeholder="Dante Smith" className="bg-white/5 border-white/10 text-white" data-testid="input-name" />
                  </div>
                  <div>
                    <Label className="text-slate-300">Preferred Name</Label>
                    <Input value={config.preferredName} onChange={e => update("preferredName", e.target.value)} placeholder="Dante" className="bg-white/5 border-white/10 text-white" data-testid="input-preferred-name" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300">Title / Role</Label>
                    <Input value={config.title} onChange={e => update("title", e.target.value)} placeholder="CEO & Founder" className="bg-white/5 border-white/10 text-white" data-testid="input-title" />
                  </div>
                  <div>
                    <Label className="text-slate-300">Company</Label>
                    <Input value={config.company} onChange={e => update("company", e.target.value)} placeholder="Apex Marketing" className="bg-white/5 border-white/10 text-white" data-testid="input-company" />
                  </div>
                </div>
                <div>
                  <Label className="text-slate-300">Tagline</Label>
                  <Input value={config.tagline} onChange={e => update("tagline", e.target.value)} placeholder="Building AI-powered platforms..." className="bg-white/5 border-white/10 text-white" data-testid="input-tagline" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300"><MapPin size={14} className="inline mr-1" />Location</Label>
                    <Input value={config.location} onChange={e => update("location", e.target.value)} placeholder="Fort Myers, FL" className="bg-white/5 border-white/10 text-white" data-testid="input-location" />
                  </div>
                  <SlugEditor slug={config.slug} subAccountId={subAccountId} onChange={v => update("slug", v)} />
                </div>
                <div>
                  <Label className="text-slate-300">Bio</Label>
                  <Textarea value={config.bio} onChange={e => update("bio", e.target.value)} placeholder="Tell your story..." className="bg-white/5 border-white/10 text-white min-h-[100px]" data-testid="input-bio" />
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "contact" && (
            <Card className="bg-black/40 border-white/10">
              <CardContent className="p-6 space-y-4">
                <h2 className="text-lg font-bold text-white">Contact Details</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300"><Phone size={14} className="inline mr-1" />Phone</Label>
                    <Input value={config.phone} onChange={e => update("phone", e.target.value)} placeholder="(239) 555-0123" className="bg-white/5 border-white/10 text-white" data-testid="input-phone" />
                  </div>
                  <div>
                    <Label className="text-slate-300"><Mail size={14} className="inline mr-1" />Email</Label>
                    <Input value={config.email} onChange={e => update("email", e.target.value)} placeholder="you@company.com" className="bg-white/5 border-white/10 text-white" data-testid="input-email" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300"><Globe size={14} className="inline mr-1" />Website</Label>
                    <Input value={config.website} onChange={e => update("website", e.target.value)} placeholder="https://yoursite.com" className="bg-white/5 border-white/10 text-white" data-testid="input-website" />
                  </div>
                  <div>
                    <Label className="text-slate-300"><Star size={14} className="inline mr-1" />Google Review Link</Label>
                    <Input value={config.googleReviewLink} onChange={e => update("googleReviewLink", e.target.value)} placeholder="https://g.page/r/..." className="bg-white/5 border-white/10 text-white" data-testid="input-review-link" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300"><Calendar size={14} className="inline mr-1" />Booking URL</Label>
                    <Input value={config.bookingUrl} onChange={e => update("bookingUrl", e.target.value)} placeholder="https://calendly.com/..." className="bg-white/5 border-white/10 text-white" data-testid="input-booking" />
                  </div>
                  <div>
                    <Label className="text-slate-300"><Calendar size={14} className="inline mr-1" />Calendar URL</Label>
                    <Input value={config.calendarUrl} onChange={e => update("calendarUrl", e.target.value)} placeholder="https://calendar.app/..." className="bg-white/5 border-white/10 text-white" data-testid="input-calendar" />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "media" && (
            <Card className="bg-black/40 border-white/10">
              <CardContent className="p-6 space-y-4">
                <h2 className="text-lg font-bold text-white">Photos & Branding</h2>
                <div>
                  <Label className="text-slate-300">Profile Photo URL</Label>
                  <Input value={config.photoUrl} onChange={e => update("photoUrl", e.target.value)} placeholder="https://example.com/photo.jpg" className="bg-white/5 border-white/10 text-white" data-testid="input-photo" />
                  {config.photoUrl && <img src={config.photoUrl} alt="Preview" className="w-16 h-16 rounded-full object-cover mt-2 border border-white/10" />}
                </div>
                <div>
                  <Label className="text-slate-300">Cover Image URL</Label>
                  <Input value={config.coverImageUrl} onChange={e => update("coverImageUrl", e.target.value)} placeholder="https://example.com/cover.jpg" className="bg-white/5 border-white/10 text-white" data-testid="input-cover" />
                </div>
                <div>
                  <Label className="text-slate-300">Logo URL</Label>
                  <Input value={config.logoImageUrl} onChange={e => update("logoImageUrl", e.target.value)} placeholder="https://example.com/logo.png" className="bg-white/5 border-white/10 text-white" data-testid="input-logo" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300">Brand Color</Label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={config.brandColor || "#6366f1"} onChange={e => update("brandColor", e.target.value)} className="w-10 h-10 rounded-lg border-0 bg-transparent cursor-pointer" data-testid="input-brand-color" />
                      <Input value={config.brandColor} onChange={e => update("brandColor", e.target.value)} className="bg-white/5 border-white/10 text-white flex-1" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-slate-300">Accent Color</Label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={config.accentColor || "#8b5cf6"} onChange={e => update("accentColor", e.target.value)} className="w-10 h-10 rounded-lg border-0 bg-transparent cursor-pointer" data-testid="input-accent-color" />
                      <Input value={config.accentColor} onChange={e => update("accentColor", e.target.value)} className="bg-white/5 border-white/10 text-white flex-1" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "services" && (
            <>
              <Card className="bg-black/40 border-white/10">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-white">Services / Expertise</h2>
                    <Button size="sm" variant="ghost" className="text-cyan-400" onClick={addService} data-testid="button-add-service">
                      <Plus size={14} className="mr-1" /> Add
                    </Button>
                  </div>
                  {(config.services || []).map((svc, idx) => (
                    <div key={idx} className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Label className="text-slate-300 text-xs">Service Name</Label>
                          <Input value={svc.label} onChange={e => updateService(idx, "label", e.target.value)} placeholder="AI Automation" className="bg-white/5 border-white/10 text-white" data-testid={`input-service-label-${idx}`} />
                        </div>
                        <Button size="sm" variant="ghost" className="text-red-400 self-end" onClick={() => removeService(idx)} data-testid={`button-remove-service-${idx}`}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                      <div>
                        <Label className="text-slate-300 text-xs">Description</Label>
                        <Input value={svc.description} onChange={e => updateService(idx, "description", e.target.value)} placeholder="Short description..." className="bg-white/5 border-white/10 text-white" data-testid={`input-service-desc-${idx}`} />
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <div>
                          <Label className="text-slate-300 text-xs">Icon</Label>
                          <div className="flex gap-1 flex-wrap mt-1">
                            {SERVICE_ICONS.map(ic => (
                              <button key={ic.id} onClick={() => updateService(idx, "icon", ic.id)}
                                className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${svc.icon === ic.id ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40" : "bg-white/5 text-slate-500 border border-white/10"}`}>
                                {ic.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div>
                        <Label className="text-slate-300 text-xs">Color</Label>
                        <div className="flex gap-1 flex-wrap mt-1">
                          {SERVICE_COLORS.map(c => (
                            <button key={c} onClick={() => updateService(idx, "color", c)}
                              className={`w-6 h-6 rounded-full bg-gradient-to-br ${c} ${svc.color === c ? "ring-2 ring-white ring-offset-2 ring-offset-gray-900" : ""}`} />
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="bg-black/40 border-white/10">
                <CardContent className="p-6 space-y-4">
                  <h2 className="text-lg font-bold text-white">Testimonial / Quote</h2>
                  <div>
                    <Label className="text-slate-300">Quote</Label>
                    <Textarea value={config.testimonial?.quote || ""} onChange={e => update("testimonial", { ...config.testimonial, quote: e.target.value, author: config.testimonial?.author || config.name, role: config.testimonial?.role || `${config.title}, ${config.company}` })} placeholder="A powerful quote..." className="bg-white/5 border-white/10 text-white min-h-[80px]" data-testid="input-testimonial-quote" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-slate-300">Author</Label>
                      <Input value={config.testimonial?.author || ""} onChange={e => update("testimonial", { ...config.testimonial, author: e.target.value })} placeholder="Name" className="bg-white/5 border-white/10 text-white" data-testid="input-testimonial-author" />
                    </div>
                    <div>
                      <Label className="text-slate-300">Role</Label>
                      <Input value={config.testimonial?.role || ""} onChange={e => update("testimonial", { ...config.testimonial, role: e.target.value })} placeholder="Title, Company" className="bg-white/5 border-white/10 text-white" data-testid="input-testimonial-role" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeSection === "links" && (
            <>
              <Card className="bg-black/40 border-white/10">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-white">Custom Links</h2>
                    <Button size="sm" variant="ghost" className="text-cyan-400" onClick={addLink} data-testid="button-add-link">
                      <Plus size={14} className="mr-1" /> Add Link
                    </Button>
                  </div>
                  {(config.links || []).map((link, idx) => (
                    <div key={idx} className="flex gap-2 items-end">
                      <div className="flex-1">
                        <Label className="text-slate-300 text-xs">Label</Label>
                        <Input value={link.label} onChange={e => updateLink(idx, "label", e.target.value)} placeholder="Portfolio" className="bg-white/5 border-white/10 text-white" data-testid={`input-link-label-${idx}`} />
                      </div>
                      <div className="flex-[2]">
                        <Label className="text-slate-300 text-xs">URL</Label>
                        <Input value={link.url} onChange={e => updateLink(idx, "url", e.target.value)} placeholder="https://..." className="bg-white/5 border-white/10 text-white" data-testid={`input-link-url-${idx}`} />
                      </div>
                      <Button size="sm" variant="ghost" className="text-red-400" onClick={() => removeLink(idx)} data-testid={`button-remove-link-${idx}`}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="bg-black/40 border-white/10">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-white">Social Profiles</h2>
                    <Button size="sm" variant="ghost" className="text-cyan-400" onClick={addSocial} data-testid="button-add-social">
                      <Plus size={14} className="mr-1" /> Add Social
                    </Button>
                  </div>
                  {(config.socialLinks || []).map((social, idx) => (
                    <div key={idx} className="flex gap-2 items-end">
                      <div className="flex-1">
                        <Label className="text-slate-300 text-xs">Platform</Label>
                        <Input value={social.label} onChange={e => updateSocial(idx, "label", e.target.value)} placeholder="Instagram" className="bg-white/5 border-white/10 text-white" data-testid={`input-social-label-${idx}`} />
                      </div>
                      <div className="flex-[2]">
                        <Label className="text-slate-300 text-xs">URL</Label>
                        <Input value={social.url} onChange={e => updateSocial(idx, "url", e.target.value)} placeholder="https://instagram.com/..." className="bg-white/5 border-white/10 text-white" data-testid={`input-social-url-${idx}`} />
                      </div>
                      <Button size="sm" variant="ghost" className="text-red-400" onClick={() => removeSocial(idx)} data-testid={`button-remove-social-${idx}`}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}

          {activeSection === "theme" && (
            <Card className="bg-black/40 border-white/10">
              <CardContent className="p-6 space-y-4">
                <h2 className="text-lg font-bold text-white">Theme</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {THEMES.map(t => (
                    <button key={t.id} onClick={() => update("theme", t.id)}
                      className={`p-4 rounded-2xl ${t.preview} border-2 transition-all text-left ${config.theme === t.id ? "border-cyan-400 scale-105 shadow-lg shadow-cyan-500/20" : "border-white/10 hover:border-white/20"}`}
                      data-testid={`button-theme-${t.id}`}
                    >
                      <span className="text-white text-sm font-bold block">{t.label}</span>
                      <span className="text-white/50 text-[10px]">{t.desc}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "seo" && (
            <Card className="bg-black/40 border-white/10">
              <CardContent className="p-6 space-y-4">
                <h2 className="text-lg font-bold text-white">SEO & Social Sharing</h2>
                <div>
                  <Label className="text-slate-300">SEO Title</Label>
                  <Input value={config.seoTitle} onChange={e => update("seoTitle", e.target.value)} placeholder={`${config.name} — ${config.company}`} className="bg-white/5 border-white/10 text-white" data-testid="input-seo-title" />
                </div>
                <div>
                  <Label className="text-slate-300">SEO Description</Label>
                  <Textarea value={config.seoDescription} onChange={e => update("seoDescription", e.target.value)} placeholder="A brief description for search results and social previews..." className="bg-white/5 border-white/10 text-white min-h-[80px]" data-testid="input-seo-description" />
                </div>
                <div>
                  <Label className="text-slate-300">OG Image URL</Label>
                  <Input value={config.ogImageUrl} onChange={e => update("ogImageUrl", e.target.value)} placeholder="https://example.com/og-image.jpg" className="bg-white/5 border-white/10 text-white" data-testid="input-og-image" />
                </div>
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Preview</p>
                  <div className="border border-white/10 rounded-lg overflow-hidden">
                    <div className="bg-white/5 p-3">
                      <p className="text-sm font-bold text-white">{config.seoTitle || config.name || "Card Title"}</p>
                      <p className="text-xs text-slate-400 mt-1">{config.seoDescription || config.tagline || "Card description..."}</p>
                      <p className="text-[10px] text-cyan-500 mt-1">{cardUrl || "yoursite.com/card/slug"}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {showPreview && (
          <div className="sticky top-6">
            <div className="flex gap-2 mb-3">
              <button onClick={() => setPreviewMode("mobile")}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${previewMode === "mobile" ? "bg-white/10 text-white" : "text-slate-500"}`}>
                <Smartphone size={14} /> Mobile
              </button>
              <button onClick={() => setPreviewMode("desktop")}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${previewMode === "desktop" ? "bg-white/10 text-white" : "text-slate-500"}`}>
                <Monitor size={14} /> Desktop
              </button>
            </div>
            <Card className="bg-black/40 border-white/10 overflow-hidden">
              <CardContent className="p-0">
                <div className={`${previewMode === "mobile" ? "max-w-[375px] mx-auto" : ""}`}>
                  {config.slug ? (
                    <iframe
                      src={`/card/${config.slug}`}
                      className="w-full border-0 rounded-lg"
                      style={{ height: previewMode === "mobile" ? "700px" : "800px" }}
                      title="Card Preview"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-[500px] text-slate-500">
                      <div className="text-center">
                        <QrCode size={48} className="mx-auto mb-4 opacity-30" />
                        <p className="text-sm">Set a slug to preview your card</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DigitalCardBuilder() {
  return (
    <PlanGate feature="digital_card" pageName="Digital Business Card">
      <DigitalCardBuilderInner />
    </PlanGate>
  );
}
