import { useState, useEffect, useRef, Suspense } from "react";
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
  Sparkles, Briefcase, Image,
  Home, Hammer, Scale, Heart, Stethoscope, Car, Wrench, Zap,
  ShoppingBag, UtensilsCrossed, Leaf, Shield, TrendingUp, DollarSign,
  Camera, Music, GraduationCap, Truck, Building, Scissors
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { BuilderPreview } from "@/components/card-core";
import { IdentityPromptPanel } from "@/components/card-identity/IdentityPromptPanel";
import { WebGLIdentityScene } from "@/components/card-identity/WebGLIdentityScene";
import type { IdentityVisualDNA } from "@/lib/card-identity/schema";

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
  id?: number;
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
  identityDna?: IdentityVisualDNA | null;
}

const THEMES = [
  { id: "executive-dark", label: "Onyx", desc: "Black & cobalt — finance, law, consulting", preview: "bg-[#050507]", swatch: "from-blue-500 via-blue-600 to-indigo-700", lightText: false },
  { id: "luxury-dark", label: "Champagne", desc: "Charcoal & gold — real estate, jewelry", preview: "bg-[#0f0f10]", swatch: "from-amber-400 via-yellow-500 to-amber-600", lightText: false },
  { id: "clean-light", label: "Porcelain", desc: "Cream & black — designers, photographers", preview: "bg-[#fdfcf8]", swatch: "from-stone-900 via-stone-800 to-stone-900", lightText: true },
  { id: "bold-agency", label: "Neon Pulse", desc: "Navy & hot pink — creators, gyms, music", preview: "bg-[#0a0820]", swatch: "from-pink-500 via-fuchsia-500 to-cyan-400", lightText: false },
  { id: "modern-gradient", label: "Coastal", desc: "Sunset peach — Florida, hospitality", preview: "bg-gradient-to-br from-[#fff1e6] via-[#ffd6a5] to-[#fdb6a3]", swatch: "from-[#1a2540] via-[#2d3a5f] to-[#fdb6a3]", lightText: true },
  { id: "minimal-neutral", label: "Botanical", desc: "Forest & cream — wellness, spa, organic", preview: "bg-[#f4f1ea]", swatch: "from-[#2d5a3d] via-[#3d6a4d] to-[#5a7848]", lightText: true },
];

const SERVICE_ICONS = [
  // Home & Construction
  { id: "home", label: "Home", Icon: Home },
  { id: "hammer", label: "Roofing", Icon: Hammer },
  { id: "wrench", label: "Repair", Icon: Wrench },
  { id: "zap", label: "Electric", Icon: Zap },
  { id: "building", label: "Building", Icon: Building },
  { id: "truck", label: "Moving", Icon: Truck },
  // Legal & Finance
  { id: "scale", label: "Legal", Icon: Scale },
  { id: "shield", label: "Protection", Icon: Shield },
  { id: "dollar", label: "Finance", Icon: DollarSign },
  { id: "trending", label: "Growth", Icon: TrendingUp },
  // Health & Wellness
  { id: "heart", label: "Health", Icon: Heart },
  { id: "stethoscope", label: "Medical", Icon: Stethoscope },
  { id: "leaf", label: "Wellness", Icon: Leaf },
  { id: "scissors", label: "Beauty", Icon: Scissors },
  // Auto & Transport
  { id: "car", label: "Auto", Icon: Car },
  // Food & Retail
  { id: "food", label: "Food", Icon: UtensilsCrossed },
  { id: "shopping", label: "Retail", Icon: ShoppingBag },
  // Creative & Education
  { id: "camera", label: "Photo", Icon: Camera },
  { id: "music", label: "Music", Icon: Music },
  { id: "education", label: "Education", Icon: GraduationCap },
  // Digital / Tech
  { id: "palette", label: "Design", Icon: Palette },
  { id: "globe", label: "Web", Icon: Globe },
  { id: "analytics", label: "Analytics", Icon: BarChart3 },
  { id: "sparkles", label: "AI", Icon: Sparkles },
  { id: "briefcase", label: "Business", Icon: Briefcase },
];

// Use real CSS gradients — Tailwind gradient classes built from template
// strings get purged at build time and all render the same default color.
const SERVICE_COLORS = [
  { gradient: "linear-gradient(135deg,#ef4444,#dc2626)", label: "Red"    },
  { gradient: "linear-gradient(135deg,#f97316,#ea580c)", label: "Orange" },
  { gradient: "linear-gradient(135deg,#f59e0b,#d97706)", label: "Gold"   },
  { gradient: "linear-gradient(135deg,#10b981,#059669)", label: "Green"  },
  { gradient: "linear-gradient(135deg,#06b6d4,#0891b2)", label: "Teal"   },
  { gradient: "linear-gradient(135deg,#3b82f6,#2563eb)", label: "Blue"   },
  { gradient: "linear-gradient(135deg,#8b5cf6,#7c3aed)", label: "Purple" },
  { gradient: "linear-gradient(135deg,#ec4899,#db2777)", label: "Pink"   },
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

interface SessionRow {
  id: number;
  sessionId: string;
  visitorId: string | null;
  referrer: string | null;
  deviceType: string | null;
  browser: string | null;
  country: string | null;
  region: string | null;
  startedAt: string;
  lastSeenAt: string;
  totalTimeMs: number;
  maxScrollDepth: number;
  clickCount: number;
  returnVisit: boolean;
  intentScore: number;
  leadTier: "cold" | "warm" | "hot" | string;
  topAction: string;
}

const TOP_ACTION_LABEL: Record<string, string> = {
  save_contact: "Saved Contact", click_booking: "Booking", click_phone: "Called",
  click_email: "Emailed", click_review: "Review", click_website: "Website",
  click_link: "Link", click_social: "Social", share: "Shared",
  qr_scan: "QR Scan", scroll: "Scrolled", view: "Viewed",
};

const ACTION_PLAIN: Record<string, string> = {
  click_phone:    "Called your number",
  save_contact:   "Saved your contact",
  click_booking:  "Booked a meeting",
  click_email:    "Sent you an email",
  share:          "Shared your card",
  click_website:  "Visited your website",
  click_review:   "Left a review",
  click_link:     "Clicked a link",
  click_social:   "Checked your socials",
  qr_scan:        "Scanned your QR code",
  scroll:         "Scrolled your card",
  view:           "Viewed your card",
};

function visitorLabel(s: SessionRow): string {
  const parts: string[] = [];
  if (s.deviceType === "mobile") parts.push("📱 Mobile");
  else if (s.deviceType === "tablet") parts.push("📱 Tablet");
  else if (s.deviceType) parts.push("💻 Desktop");
  const ref = referrerHost(s.referrer);
  if (ref && ref !== "Direct") parts.push(`via ${ref}`);
  if (s.region) parts.push(s.region);
  else if (s.country) parts.push(s.country);
  return parts.length ? parts.join(" · ") : "Direct visit";
}

function intentSignals(s: SessionRow): string[] {
  const out: string[] = [];
  const sec = Math.round(s.totalTimeMs / 1000);
  if (sec >= 120) out.push(`Spent ${Math.floor(sec / 60)}m reading`);
  else if (sec >= 45)  out.push("Spent time reading");
  if (s.maxScrollDepth >= 80) out.push("Read the full card");
  else if (s.maxScrollDepth >= 50) out.push("Scrolled halfway");
  if (s.clickCount >= 3) out.push(`${s.clickCount} clicks`);
  if (s.returnVisit) out.push("Return visitor");
  return out.slice(0, 3);
}

function useCardSessions(cardId?: number) {
  return useQuery<{ sessions: SessionRow[] }>({
    queryKey: ["/api/cards", cardId, "sessions"],
    queryFn: async () => {
      const r = await fetch(`/api/cards/${cardId}/sessions?limit=200`);
      if (!r.ok) return { sessions: [] };
      return r.json();
    },
    enabled: !!cardId,
    refetchInterval: 30_000,
  });
}

function AnalyticsSummary({ card }: { card: CardConfig }) {
  const { data } = useCardSessions(card.id);
  const sessions = data?.sessions || [];
  const uniqueVisitors = new Set(sessions.map(s => s.visitorId).filter(Boolean)).size;
  const avgTimeSec = sessions.length
    ? Math.round(sessions.reduce((a, s) => a + s.totalTimeMs, 0) / sessions.length / 1000)
    : 0;
  // Conversion Events = the contact clicks defined by the FROZEN
  // CLICKY_TYPES set on the server (phone / email / website).
  const conversionEvents = sessions.reduce((a, s) => a + s.clickCount, 0);

  const isLoading = !data && !!card.id;

  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-white/10 shadow-xl" data-testid="analytics-summary">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
              <BarChart3 size={15} className="text-indigo-400" />
            </div>
            <h3 className="text-sm font-bold text-white">Card Analytics</h3>
          </div>
          {!card.id && (
            <span className="text-[10px] text-slate-500 bg-slate-700/50 px-2 py-1 rounded-full">Save card to track</span>
          )}
          {isLoading && (
            <span className="text-[10px] text-indigo-400 animate-pulse">Loading...</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Total Views" value={card.viewCount || 0} testId="stat-views" color="#818cf8" />
          <Stat label="Unique Visitors" value={uniqueVisitors} testId="stat-visitors" color="#34d399" />
          <Stat label="Avg Time" value={avgTimeSec > 0 ? `${avgTimeSec}s` : "—"} testId="stat-avgtime" color="#f59e0b" />
          <Stat label="CTA Clicks" value={conversionEvents} testId="stat-conversions" color="#f43f5e" />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, testId, color }: { label: string; value: string | number; testId: string; color?: string }) {
  return (
    <div className="text-center p-3 rounded-xl bg-white/5 border border-white/[0.06] hover:bg-white/[0.08] transition-colors" data-testid={testId}>
      <p className="text-xl font-bold" style={color ? { color } : { color: "white" }}>{value}</p>
      <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wide mt-0.5">{label}</p>
    </div>
  );
}

function tierBadge(tier: string) {
  const map: Record<string, string> = {
    hot: "bg-red-500/15 text-red-300 border-red-500/30",
    warm: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    cold: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  };
  return map[tier] || map.cold;
}

function fmtDuration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function referrerHost(ref: string | null): string {
  if (!ref) return "Direct";
  try {
    const u = new URL(ref.startsWith("http") ? ref : `https://${ref}`);
    return u.hostname || "Direct";
  } catch {
    return ref.slice(0, 40);
  }
}

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const TIER_CONFIG = {
  hot:  { emoji: "🔥", label: "Hot Lead",  bg: "bg-red-500/10",    border: "border-red-500/20",    badge: "bg-red-500/15 text-red-300 border-red-500/30",  why: "Took a strong action — called, booked, or saved your info." },
  warm: { emoji: "🌡️", label: "Warm Lead", bg: "bg-orange-500/10", border: "border-orange-500/20", badge: "bg-orange-500/15 text-orange-300 border-orange-500/30", why: "Engaged with your card but hasn't reached out yet." },
  cold: { emoji: "❄️", label: "Cold",      bg: "bg-slate-800/60",  border: "border-white/5",       badge: "bg-slate-500/15 text-slate-400 border-slate-500/30",  why: "Briefly viewed your card with no meaningful interaction." },
};

function LeadTable({ cardId }: { cardId?: number }) {
  const { data, isLoading } = useCardSessions(cardId);
  const [showAll, setShowAll] = useState(false);
  const allSessions = (data?.sessions || []).slice().sort((a, b) => b.intentScore - a.intentScore);
  const PREVIEW = 8;
  const sessions = showAll ? allSessions : allSessions.slice(0, PREVIEW);
  const hidden = allSessions.length - PREVIEW;

  if (!cardId) {
    return (
      <Card className="bg-black/40 border-white/10">
        <CardContent className="p-6 text-sm text-slate-400">Save your card first to start collecting visitor leads.</CardContent>
      </Card>
    );
  }

  const hotCount  = allSessions.filter(s => s.leadTier === "hot").length;
  const warmCount = allSessions.filter(s => s.leadTier === "warm").length;

  return (
    <Card className="bg-black/40 border-white/10">
      <CardContent className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white">Who's Looking at Your Card</h2>
            <p className="text-xs text-slate-500 mt-0.5">Every person who visited, ranked by how interested they seem.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hotCount > 0  && <span className="text-[11px] font-semibold bg-red-500/15 text-red-300 border border-red-500/30 px-2 py-0.5 rounded-full">🔥 {hotCount} hot</span>}
            {warmCount > 0 && <span className="text-[11px] font-semibold bg-orange-500/15 text-orange-300 border border-orange-500/30 px-2 py-0.5 rounded-full">🌡️ {warmCount} warm</span>}
            <span className="text-[11px] text-slate-500" data-testid="text-leads-count">{allSessions.length} total</span>
          </div>
        </div>

        {/* Legend */}
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          {(["hot","warm","cold"] as const).map(tier => (
            <div key={tier} className={`rounded-lg p-2 border ${TIER_CONFIG[tier].bg} ${TIER_CONFIG[tier].border}`}>
              <p className="font-bold text-white mb-0.5">{TIER_CONFIG[tier].emoji} {TIER_CONFIG[tier].label}</p>
              <p className="text-slate-400 leading-snug">{TIER_CONFIG[tier].why}</p>
            </div>
          ))}
        </div>

        {/* Lead list */}
        {isLoading ? (
          <div className="text-sm text-slate-400 py-6 text-center">Loading…</div>
        ) : allSessions.length === 0 ? (
          <div className="text-sm text-slate-500 py-6 text-center" data-testid="empty-leads">
            No visitors yet. Share your card to start seeing who's interested.
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map(s => {
              const tier = (TIER_CONFIG[s.leadTier as keyof typeof TIER_CONFIG] ?? TIER_CONFIG.cold);
              const signals = intentSignals(s);
              const action  = ACTION_PLAIN[s.topAction] || TOP_ACTION_LABEL[s.topAction] || "Viewed";
              return (
                <div
                  key={s.id}
                  className={`rounded-xl border px-3 py-2.5 ${tier.bg} ${tier.border} hover:brightness-110 transition-all`}
                  data-testid={`row-lead-${s.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    {/* Left: badge + identity */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${tier.badge}`}
                        data-testid={`badge-tier-${s.id}`}
                      >
                        {tier.emoji} {s.leadTier}
                      </span>
                      <span className="text-xs text-slate-300 truncate" data-testid={`text-visitor-${s.id}`}>
                        {visitorLabel(s)}
                        {s.returnVisit && <span className="ml-1 text-cyan-400 font-semibold">↻ Back again</span>}
                      </span>
                    </div>
                    {/* Right: time + score */}
                    <div className="flex items-center gap-2 shrink-0 text-[11px] text-slate-500">
                      <span data-testid={`text-time-${s.id}`}>{fmtDuration(s.totalTimeMs)}</span>
                      <span className="text-slate-600">·</span>
                      <span className="font-bold text-white" data-testid={`text-score-${s.id}`}>{s.intentScore}</span>
                      <span className="text-slate-600 text-[10px]">pts</span>
                    </div>
                  </div>
                  {/* Action + signals */}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-white/80" data-testid={`text-topaction-${s.id}`}>
                      {action}
                    </span>
                    {signals.map((sig, i) => (
                      <span key={i} className="text-[10px] text-slate-500 bg-white/5 rounded-full px-1.5 py-0.5">{sig}</span>
                    ))}
                    <span className="text-[10px] text-slate-600 ml-auto">{fmtRelative(s.startedAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Show more / less */}
        {!showAll && hidden > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full text-xs text-slate-500 hover:text-slate-300 py-1 transition-colors"
          >
            Show {hidden} more visitors ↓
          </button>
        )}
        {showAll && allSessions.length > PREVIEW && (
          <button
            onClick={() => setShowAll(false)}
            className="w-full text-xs text-slate-500 hover:text-slate-300 py-1 transition-colors"
          >
            Show less ↑
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function ImagePicker({ value, onChange, label, accept = "image/*", testId, subAccountId }: {
  value: string; onChange: (url: string) => void; label: string; accept?: string; testId: string; subAccountId: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Unsupported file", description: "Please choose an image.", variant: "destructive" });
      return;
    }
    if (!subAccountId) {
      toast({ title: "Upload failed", description: "No active account selected.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("files", file);
      fd.append("sub_account_id", String(subAccountId));
      const res = await fetch("/api/media/upload", { method: "POST", body: fd, credentials: "include" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 401) {
          toast({
            title: "You're logged out",
            description: "Sending you to log back in… your card is saved.",
            variant: "destructive",
          });
          setTimeout(() => {
            const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `/login?returnTo=${returnTo}`;
          }, 1200);
          return;
        }
        const msg = json?.error || json?.message || `Upload failed (${res.status})`;
        throw new Error(msg);
      }
      const first = json.uploaded?.[0];
      const url = first?.fileUrl || first?.url;
      if (!url) throw new Error("No URL returned");
      onChange(url);
      toast({ title: "Uploaded", description: `${label} updated.` });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Upload failed";
      toast({ title: "Upload failed", description: message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="space-y-2">
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        className={`flex items-center gap-3 rounded-xl border-2 border-dashed p-3 cursor-pointer transition ${
          dragOver
            ? "border-indigo-400/60 bg-indigo-500/10"
            : "border-white/10 hover:border-white/20 bg-white/[0.02]"
        }`}
        data-testid={`${testId}-dropzone`}
        role="button"
        aria-label={`Upload ${label}`}
      >
        {value ? (
          <img
            src={value}
            alt={`${label} preview`}
            className="w-14 h-14 rounded-lg object-cover border border-white/10 flex-shrink-0"
            data-testid={`${testId}-preview`}
          />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-slate-500 text-[10px] flex-shrink-0">
            No image
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-300 font-medium">{label}</p>
          <p className="text-[10px] text-slate-500">
            {uploading ? "Uploading…" : "Drag & drop or click to upload"}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          data-testid={`${testId}-file`}
        />
      </div>
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-[10px] text-slate-500 hover:text-red-400 transition"
          data-testid={`${testId}-clear`}
        >
          Remove image
        </button>
      )}
    </div>
  );
}

function DigitalCardBuilderInner() {
  const subAccountId = useActiveSubAccountId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPreview, setShowPreview] = useState(false);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("mobile");
  const [activeSection, setActiveSection] = useState("info");
  const [identityDna, setIdentityDna] = useState<IdentityVisualDNA | null>(null);

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

  // Initialize identityDna from server card once loaded
  useEffect(() => {
    if (cardConfig?.identityDna && !identityDna) {
      setIdentityDna(cardConfig.identityDna);
    }
  }, [cardConfig?.identityDna]);

  const saveMutation = useMutation({
    mutationFn: async (data: CardConfig) => {
      const res = await apiRequest("POST", `/api/digital-card/${subAccountId}`, data);
      return res as unknown as CardConfig;
    },
    onSuccess: (savedCard) => {
      toast({ title: "Saved ✓", description: "Your digital card has been updated." });
      // Reset local form state so config falls back to server card (with DB id)
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["/api/digital-card", subAccountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cards", savedCard?.id, "sessions"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const applyIdentityMutation = useMutation({
    mutationFn: async (dna: IdentityVisualDNA) => {
      const cardId = (cardConfig ?? config).id;
      if (!cardId) throw new Error("Save the card first before applying an identity.");
      await apiRequest("PATCH", `/api/card-identity/${cardId}/apply`, { dna, subAccountId });
      return dna;
    },
    onSuccess: (dna) => {
      setIdentityDna(dna);
      toast({ title: "Identity Applied ✓", description: "Your cinematic identity is live." });
      queryClient.invalidateQueries({ queryKey: ["/api/digital-card", subAccountId] });
    },
    onError: (err: Error) => {
      toast({ title: "Identity Error", description: err.message, variant: "destructive" });
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

  const addService = () => setForm({ ...config, services: [...(config.services || []), { label: "", description: "", icon: "briefcase", color: SERVICE_COLORS[0].gradient }] });
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

      {/* Always pass the server card for analytics so we have the real DB id */}
      <AnalyticsSummary card={cardConfig ?? config} />

      <LeadTable cardId={(cardConfig ?? config).id} />

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
                  <SlugEditor slug={config.slug} subAccountId={subAccountId ?? 0} onChange={v => update("slug", v)} />
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
                  <Label className="text-slate-300">Profile Photo</Label>
                  <ImagePicker value={config.photoUrl} onChange={v => update("photoUrl", v)} label="Profile photo" testId="input-photo" subAccountId={subAccountId ?? 0} />
                </div>
                <div>
                  <Label className="text-slate-300">Cover Image</Label>
                  <ImagePicker value={config.coverImageUrl} onChange={v => update("coverImageUrl", v)} label="Cover image" testId="input-cover" subAccountId={subAccountId ?? 0} />
                </div>
                <div>
                  <Label className="text-slate-300">Logo</Label>
                  <ImagePicker value={config.logoImageUrl} onChange={v => update("logoImageUrl", v)} label="Logo" testId="input-logo" subAccountId={subAccountId ?? 0} />
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
                          <div className="flex gap-1 flex-wrap mt-1 max-h-24 overflow-y-auto pr-1">
                            {SERVICE_ICONS.map(ic => {
                              const IconComp = ic.Icon;
                              return (
                                <button key={ic.id} onClick={() => updateService(idx, "icon", ic.id)}
                                  title={ic.label}
                                  className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${svc.icon === ic.id ? "bg-cyan-500/25 border border-cyan-400/60 text-cyan-400 scale-110" : "bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10"}`}>
                                  <IconComp size={16} />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      <div>
                        <Label className="text-slate-300 text-xs">Color</Label>
                        <div className="flex gap-2 flex-wrap mt-1">
                          {SERVICE_COLORS.map(c => (
                            <button
                              key={c.label}
                              onClick={() => updateService(idx, "color", c.gradient)}
                              title={c.label}
                              style={{ background: c.gradient }}
                              className={`w-8 h-8 rounded-full transition-all hover:scale-110 ${svc.color === c.gradient ? "ring-2 ring-white ring-offset-2 ring-offset-gray-900 scale-110" : ""}`}
                            />
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
            <>
            {/* AI Identity section at top of theme tab */}
            <Card className="bg-black/40 border-indigo-500/20">
              <CardContent className="p-6 space-y-4">
                <IdentityPromptPanel
                  currentDna={identityDna}
                  onDnaUpdate={(dna) => {
                    setIdentityDna(dna);
                    applyIdentityMutation.mutate(dna);
                  }}
                  onContentGenerated={(content) => {
                    setForm({
                      ...config,
                      bio: content.bio || config.bio,
                      tagline: content.tagline || config.tagline,
                      services: content.services?.length ? content.services : config.services,
                      testimonial: content.testimonial ?? config.testimonial,
                    });
                    toast({ title: "Content Generated ✓", description: "Bio, tagline, services & testimonial auto-filled." });
                  }}
                  profileContext={{
                    name: config.name,
                    title: config.title,
                    company: config.company,
                    bio: config.bio,
                    imageUrl: config.photoUrl,
                  }}
                  isAdmin={false}
                />

                {/* Live mini-preview when DNA is set */}
                {identityDna && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Live Preview</span>
                      <span className="text-[10px] bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full">AI Identity Active</span>
                    </div>
                    <div className="rounded-xl overflow-hidden border border-white/10">
                      <Suspense fallback={<div className="h-[150px] bg-slate-900 animate-pulse" />}>
                        <WebGLIdentityScene dna={identityDna} height="150px" />
                      </Suspense>
                    </div>
                    <p className="text-[10px] text-slate-500">Style: {identityDna.identityStyle} · {identityDna.niche}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-black/40 border-white/10">
              <CardContent className="p-6 space-y-4">
                <h2 className="text-lg font-bold text-white">Theme</h2>
                <p className="text-[11px] text-slate-400">Choose the look & feel of your card. Your brand colors apply on top.</p>
                <div className="grid grid-cols-2 gap-3">
                  {THEMES.map(t => {
                    const isSelected = config.theme === t.id;
                    return (
                      <button key={t.id} onClick={() => update("theme", t.id)}
                        className={`relative rounded-2xl overflow-hidden transition-all text-left group ${isSelected ? "ring-2 ring-cyan-400 scale-[1.03] shadow-xl shadow-cyan-500/20" : "hover:scale-[1.02] hover:ring-1 ring-white/20"}`}
                        data-testid={`button-theme-${t.id}`}
                      >
                        {/* Color preview block */}
                        <div className={`${t.preview} h-16 w-full flex items-end px-3 pb-2`}>
                          {/* Simulated card header inside preview */}
                          <div className={`w-full flex items-center gap-2`}>
                            <div className={`w-5 h-5 rounded-full bg-gradient-to-br ${t.swatch} shadow-md`} />
                            <div className="flex-1 space-y-1">
                              <div className={`h-1.5 w-14 rounded-full bg-gradient-to-r ${t.swatch} opacity-90`} />
                              <div className={`h-1 w-10 rounded-full ${t.lightText ? "bg-black/20" : "bg-white/20"}`} />
                            </div>
                            {isSelected && <div className="w-4 h-4 rounded-full bg-cyan-400 flex items-center justify-center text-[8px] text-white font-black">✓</div>}
                          </div>
                        </div>
                        {/* Label block */}
                        <div className="bg-black/60 backdrop-blur-sm px-3 py-2 border-t border-white/5">
                          <span className={`text-xs font-bold block text-white`}>{t.label}</span>
                          <span className="text-[9px] leading-tight block mt-0.5 text-slate-400">{t.desc}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
            </>
          )}

          {activeSection === "seo" && (
            <Card className="bg-black/40 border-white/10">
              <CardContent className="p-6 space-y-4">
                <h2 className="text-lg font-bold text-white">SEO & Social Sharing</h2>

                {/* Lead Capture Toggle — most important conversion feature */}
                <div className="p-4 rounded-xl border space-y-3"
                  style={{ borderColor: config.leadCaptureEnabled ? "#22c55e40" : "rgba(255,255,255,0.08)", background: config.leadCaptureEnabled ? "#22c55e08" : "rgba(255,255,255,0.02)" }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: config.leadCaptureEnabled ? "#22c55e20" : "rgba(255,255,255,0.05)" }}>
                        <span className="text-base">{config.leadCaptureEnabled ? "🟢" : "📋"}</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">Lead Capture Form</p>
                        <p className="text-[11px] text-slate-400">Collect visitor name, email & phone → saves to CRM</p>
                      </div>
                    </div>
                    <button
                      onClick={() => update("leadCaptureEnabled", !config.leadCaptureEnabled)}
                      className={`relative w-11 h-6 rounded-full transition-all ${config.leadCaptureEnabled ? "bg-green-500" : "bg-white/10"}`}
                      data-testid="toggle-lead-capture"
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all ${config.leadCaptureEnabled ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </div>
                  {config.leadCaptureEnabled && (
                    <p className="text-[11px] text-green-400/80 font-medium">
                      ✓ A contact form will appear on your card. Submissions create real CRM contacts automatically.
                    </p>
                  )}
                </div>
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
                <div
                  className="overflow-y-auto"
                  style={{ maxHeight: previewMode === "mobile" ? "700px" : "800px" }}
                  data-testid="builder-preview-scroll"
                >
                  <BuilderPreview config={config} previewMode={previewMode} />
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
