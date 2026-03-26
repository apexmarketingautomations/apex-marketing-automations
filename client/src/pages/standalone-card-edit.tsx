import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft, Save, Loader2, Check, Eye, User, Briefcase, Phone, Mail,
  Globe, MapPin, Image, Palette, Star, Calendar, Link2
} from "lucide-react";

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
  const [, params] = useRoute("/standalone/edit/:cardId");
  const [, setLocation] = useLocation();
  const [card, setCard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const cardId = params?.cardId;

  useEffect(() => {
    const stored = sessionStorage.getItem("standalone_edit_email");
    if (stored && cardId) {
      setEmail(stored);
      loadCard(stored);
    } else {
      setLoading(false);
    }
  }, [cardId]);

  const loadCard = async (userEmail: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/standalone/card-edit/${cardId}?email=${encodeURIComponent(userEmail)}`);
      if (!res.ok) {
        const err = await res.json();
        setAuthError(err.error || "Could not load card");
        setAuthed(false);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setCard(data);
      setAuthed(true);
      setEmail(userEmail);
      sessionStorage.setItem("standalone_edit_email", userEmail);
    } catch {
      setAuthError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async () => {
    if (!email.trim()) return;
    setAuthLoading(true);
    setAuthError("");
    await loadCard(email.trim().toLowerCase());
    setAuthLoading(false);
  };

  const update = (field: string, value: any) => {
    setCard((prev: any) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/standalone/card-edit/${cardId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, updates: card }),
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

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white">
        <header className="px-4 py-5">
          <button onClick={() => setLocation("/standalone/dashboard")}
            className="flex items-center gap-2 text-slate-500 hover:text-white text-sm transition">
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </button>
        </header>
        <main className="max-w-md mx-auto px-4 py-16">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 flex items-center justify-center mx-auto mb-4">
              <Mail className="w-7 h-7 text-cyan-400" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Edit Your Card</h1>
            <p className="text-slate-400 text-sm">Enter the email you used to purchase your card</p>
          </div>
          <div className="space-y-4">
            <input data-testid="input-edit-email" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAuth()}
              placeholder="your@email.com"
              className="w-full px-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition" />
            {authError && <p className="text-red-400 text-sm">{authError}</p>}
            <button data-testid="button-edit-auth" onClick={handleAuth} disabled={authLoading || !email}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-white font-bold rounded-xl transition">
              {authLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Continue"}
            </button>
          </div>
        </main>
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
          <Field label="Email" value={card.email} onChange={(v: string) => update("email", v)} testId="input-email-display" type="email" />
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
