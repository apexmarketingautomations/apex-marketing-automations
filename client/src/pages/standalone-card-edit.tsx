import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import {
  ArrowLeft, Save, Loader2, Check, Eye, User, Phone,
  Globe, Image, Palette, Star, AlertTriangle
} from "lucide-react";
import { CARD_THEMES, getAvailableThemes, getAvailableLayouts, canRemoveBranding } from "@/components/card-core";

function Field({ label, value, onChange, testId, type = "text", placeholder = "" }: any) {
  return (
    <div>
      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">{label}</label>
      {type === "textarea" ? (
        <textarea value={value || ""} onChange={e => onChange(e.target.value)} data-testid={testId}
          placeholder={placeholder}
          className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 resize-none h-24 transition" />
      ) : (
        <input type={type} value={value || ""} onChange={e => onChange(e.target.value)} data-testid={testId}
          placeholder={placeholder}
          className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition" />
      )}
    </div>
  );
}

function ColorField({ label, value, onChange, testId }: any) {
  return (
    <div>
      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">{label}</label>
      <div className="flex items-center gap-3">
        <input type="color" value={value || "#0ea5e9"} onChange={e => onChange(e.target.value)}
          data-testid={testId}
          className="w-12 h-12 rounded-xl border border-white/[0.08] cursor-pointer bg-transparent" />
        <input type="text" value={value || "#0ea5e9"} onChange={e => onChange(e.target.value)}
          className="flex-1 px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm font-mono focus:outline-none focus:border-cyan-500/50 transition" />
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">{title}</h3>
      </div>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  );
}

export default function StandaloneCardEdit() {
  const [, params] = useRoute("/standalone/edit/:token");
  const [, setLocation] = useLocation();
  const [card, setCard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);

  const token = params?.token;

  useEffect(() => {
    if (!token) return;
    loadCard();
  }, [token]);

  const loadCard = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/standalone/card-edit/${token}`);
      if (!res.ok) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setCard(await res.json());
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  const update = (field: string, value: any) => {
    setCard((prev: any) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/standalone/card-edit/${token}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: card }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Save failed");
        return;
      }
      const updated = await res.json();
      setCard(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 size={36} className="text-cyan-400 animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="text-center max-w-sm px-4">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Invalid Edit Link</h1>
          <p className="text-slate-400 text-sm mb-6">This edit link is invalid or has expired. You can find your edit link in your dashboard.</p>
          <button onClick={() => setLocation("/standalone/dashboard")}
            data-testid="button-go-dashboard"
            className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold rounded-xl transition">
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <header className="sticky top-0 z-50 bg-[#0a0a0f]/90 backdrop-blur-xl border-b border-white/[0.06] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <button onClick={() => setLocation("/standalone/dashboard")}
            className="flex items-center gap-2 text-slate-500 hover:text-white text-sm transition">
            <ArrowLeft className="w-4 h-4" /> Dashboard
          </button>
          <div className="flex items-center gap-2">
            {card?.slug && (
              <a href={`/standalone/card/${card.slug}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.06] hover:bg-white/[0.1] rounded-lg text-xs text-slate-300 transition" data-testid="button-preview">
                <Eye className="w-3.5 h-3.5" /> Preview
              </a>
            )}
            <button data-testid="button-save" onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <><Check className="w-3.5 h-3.5" /> Saved</> : <><Save className="w-3.5 h-3.5" /> Save</>}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">{error}</div>
        )}

        <Section title="Basic Info" icon={User}>
          <Field label="Full Name" value={card.fullName} onChange={(v: string) => update("fullName", v)} testId="input-name" />
          <Field label="Title / Role" value={card.title} onChange={(v: string) => update("title", v)} testId="input-title" placeholder="e.g. CEO, Manager, Realtor" />
          <Field label="Business Name" value={card.businessName} onChange={(v: string) => update("businessName", v)} testId="input-business" />
          <Field label="Bio" value={card.bio} onChange={(v: string) => update("bio", v)} testId="input-bio" type="textarea" placeholder="Tell people about yourself or your business..." />
        </Section>

        <Section title="Contact" icon={Phone}>
          <Field label="Phone" value={card.phone} onChange={(v: string) => update("phone", v)} testId="input-phone" type="tel" />
          <Field label="Website" value={card.website} onChange={(v: string) => update("website", v)} testId="input-website" placeholder="https://..." />
          <Field label="Address" value={card.address} onChange={(v: string) => update("address", v)} testId="input-address" />
        </Section>

        <Section title="Images" icon={Image}>
          <Field label="Profile Photo URL" value={card.profileImageUrl} onChange={(v: string) => update("profileImageUrl", v)} testId="input-photo" placeholder="https://..." />
          {card.profileImageUrl && (
            <div className="flex justify-center">
              <img src={card.profileImageUrl} alt="Preview" className="w-20 h-20 rounded-full object-cover border-2 border-white/10" />
            </div>
          )}
          <Field label="Logo URL" value={card.logoUrl} onChange={(v: string) => update("logoUrl", v)} testId="input-logo" placeholder="https://..." />
        </Section>

        <Section title="Appearance" icon={Palette}>
          <ColorField label="Theme Color" value={card.themeColor} onChange={(v: string) => update("themeColor", v)} testId="input-color" />
          {(card.tier === "premium" || card.tier === "pro") && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Card Theme</label>
                <div className="grid grid-cols-2 gap-2">
                  {getAvailableThemes(card.tier).map(themeKey => {
                    const t = CARD_THEMES[themeKey];
                    const selected = (card.cardTheme || "executive-dark") === themeKey;
                    return (
                      <button key={themeKey} data-testid={`theme-${themeKey}`}
                        onClick={() => update("cardTheme", themeKey)}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          selected
                            ? "border-cyan-500/50 bg-cyan-500/10"
                            : "border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15]"
                        }`}>
                        <div className={`w-full h-6 rounded-lg mb-2 ${t.bg}`} />
                        <p className="text-xs text-white font-medium capitalize">{themeKey.replace(/-/g, " ")}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Card Layout</label>
                <select
                  data-testid="select-layout"
                  value={card.cardLayout || "default"}
                  onChange={e => update("cardLayout", e.target.value)}
                  className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm focus:outline-none focus:border-cyan-500/50 transition"
                >
                  {getAvailableLayouts(card.tier).map(layout => (
                    <option key={layout} value={layout}>{layout.charAt(0).toUpperCase() + layout.slice(1)}</option>
                  ))}
                </select>
              </div>
              {canRemoveBranding("standalone", card.tier) ? (
                <div className="flex items-center justify-between p-3 bg-white/[0.03] border border-white/[0.06] rounded-xl">
                  <div>
                    <p className="text-sm text-white font-medium">Remove Apex Branding</p>
                    <p className="text-xs text-slate-500">Hide "Powered by Apex" on your public card</p>
                  </div>
                  <button
                    data-testid="toggle-branding"
                    onClick={() => update("removeApexBranding", !card.removeApexBranding)}
                    className={`w-11 h-6 rounded-full transition-colors ${
                      card.removeApexBranding ? "bg-cyan-500" : "bg-neutral-700"
                    }`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      card.removeApexBranding ? "translate-x-[22px]" : "translate-x-[2px]"
                    }`} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 bg-white/[0.03] border border-white/[0.06] rounded-xl opacity-50">
                  <div>
                    <p className="text-sm text-white font-medium">Remove Apex Branding</p>
                    <p className="text-xs text-slate-500">Upgrade to Premium to remove branding</p>
                  </div>
                  <div className="w-11 h-6 rounded-full bg-neutral-700 cursor-not-allowed">
                    <div className="w-5 h-5 bg-white rounded-full shadow translate-x-[2px] translate-y-[2px]" />
                  </div>
                </div>
              )}
            </div>
          )}
          {card.tier === "base" && (
            <div className="p-3 bg-amber-500/5 border border-amber-500/15 rounded-xl text-xs text-amber-400/80">
              Upgrade to Premium to unlock custom layouts, remove Apex branding, and more.
            </div>
          )}
        </Section>

        <Section title="Actions" icon={Star}>
          <Field label="Google Review Link" value={card.reviewLink} onChange={(v: string) => update("reviewLink", v)} testId="input-review" placeholder="https://..." />
          <Field label="Booking Link" value={card.bookingLink} onChange={(v: string) => update("bookingLink", v)} testId="input-booking" placeholder="https://..." />
        </Section>

        <Section title="Social Media" icon={Globe}>
          <Field label="Instagram" value={card.instagramUrl} onChange={(v: string) => update("instagramUrl", v)} testId="input-instagram" placeholder="https://instagram.com/..." />
          <Field label="Facebook" value={card.facebookUrl} onChange={(v: string) => update("facebookUrl", v)} testId="input-facebook" placeholder="https://facebook.com/..." />
          <Field label="TikTok" value={card.tiktokUrl} onChange={(v: string) => update("tiktokUrl", v)} testId="input-tiktok" placeholder="https://tiktok.com/@..." />
          <Field label="LinkedIn" value={card.linkedinUrl} onChange={(v: string) => update("linkedinUrl", v)} testId="input-linkedin" placeholder="https://linkedin.com/in/..." />
          <Field label="YouTube" value={card.youtubeUrl} onChange={(v: string) => update("youtubeUrl", v)} testId="input-youtube" placeholder="https://youtube.com/..." />
        </Section>

        <div className="pt-4 pb-8">
          <button data-testid="button-save-bottom" onClick={handleSave} disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-white font-bold rounded-2xl transition shadow-lg shadow-cyan-500/20">
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : saved ? <><Check className="w-5 h-5" /> Changes Saved!</> : <><Save className="w-5 h-5" /> Save Changes</>}
          </button>
        </div>
      </main>
    </div>
  );
}
