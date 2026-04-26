import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { motion } from "framer-motion";
import { Save, Loader2, Check, ExternalLink, AlertCircle, Plus, Trash2 } from "lucide-react";

interface SocialLink { label: string; url: string; icon?: string }
interface CustomLink { label: string; url: string; type?: string }
interface Service { label: string; description: string; icon?: string; color?: string }

export default function CardEdit() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [card, setCard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch(`/api/card/edit/${token}`)
      .then(r => { if (!r.ok) throw new Error("Not found"); return r.json(); })
      .then(data => { setCard(data); setLoading(false); })
      .catch(() => { setError("Card not found or invalid edit link."); setLoading(false); });
  }, [token]);

  const update = (field: string, value: any) => {
    setCard((c: any) => ({ ...c, [field]: value }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/card/edit/${token}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(card),
      });
      if (!res.ok) throw new Error("Save failed");
      const updated = await res.json();
      setCard(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const addSocialLink = () => {
    const links = [...(card.socialLinks || []), { label: "", url: "" }];
    update("socialLinks", links);
  };

  const updateSocialLink = (i: number, field: string, value: string) => {
    const links = [...(card.socialLinks || [])];
    links[i] = { ...links[i], [field]: value };
    update("socialLinks", links);
  };

  const removeSocialLink = (i: number) => {
    const links = [...(card.socialLinks || [])];
    links.splice(i, 1);
    update("socialLinks", links);
  };

  const addLink = () => {
    const links = [...(card.links || []), { label: "", url: "" }];
    update("links", links);
  };

  const updateLink = (i: number, field: string, value: string) => {
    const links = [...(card.links || [])];
    links[i] = { ...links[i], [field]: value };
    update("links", links);
  };

  const removeLink = (i: number) => {
    const links = [...(card.links || [])];
    links.splice(i, 1);
    update("links", links);
  };

  const addService = () => {
    const services = [...(card.services || []), { label: "", description: "" }];
    update("services", services);
  };

  const updateService = (i: number, field: string, value: string) => {
    const services = [...(card.services || [])];
    services[i] = { ...services[i], [field]: value };
    update("services", services);
  };

  const removeService = (i: number) => {
    const services = [...(card.services || [])];
    services.splice(i, 1);
    update("services", services);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 size={36} className="text-indigo-400 animate-spin" />
      </div>
    );
  }

  if (error && !card) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center p-8">
          <AlertCircle size={40} className="text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Invalid Edit Link</h2>
          <p className="text-slate-400 text-sm">{error}</p>
        </motion.div>
      </div>
    );
  }

  if (!card) return null;

  const cardUrl = `${window.location.origin}/card/${card.slug}`;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white" data-testid="card-edit-page">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-black" data-testid="text-edit-title">Edit Your Card</h1>
            <a href={cardUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-400 flex items-center gap-1 mt-1" data-testid="link-preview-card">
              <ExternalLink size={12} /> View live card
            </a>
          </div>
          <button onClick={save} disabled={saving}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${saved ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-500 hover:to-purple-500"}`}
            data-testid="button-save">
            {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : <Save size={16} />}
            {saving ? "Saving..." : saved ? "Saved!" : "Save Changes"}
          </button>
        </div>

        {error && <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}

        <div className="space-y-6">
          <Section title="Basic Info">
            <Field label="Full Name" value={card.name} onChange={(v: string) => update("name", v)} testId="input-name" />
            <Field label="Preferred Name" value={card.preferredName} onChange={(v: string) => update("preferredName", v)} testId="input-preferred-name" />
            <Field label="Title / Role" value={card.title} onChange={(v: string) => update("title", v)} testId="input-title" />
            <Field label="Company" value={card.company} onChange={(v: string) => update("company", v)} testId="input-company" />
            <Field label="Tagline" value={card.tagline} onChange={(v: string) => update("tagline", v)} testId="input-tagline" />
            <Field label="Location" value={card.location} onChange={(v: string) => update("location", v)} testId="input-location" />
            <TextArea label="Bio" value={card.bio} onChange={(v: string) => update("bio", v)} testId="input-bio" />
          </Section>

          <Section title="Contact">
            <Field label="Phone" value={card.phone} onChange={(v: string) => update("phone", v)} testId="input-phone" />
            <Field label="Email" value={card.email} onChange={(v: string) => update("email", v)} testId="input-email" />
            <Field label="Website" value={card.website} onChange={(v: string) => update("website", v)} testId="input-website" />
            <Field label="Booking URL" value={card.bookingUrl} onChange={(v: string) => update("bookingUrl", v)} testId="input-booking" />
            <Field label="Calendar URL" value={card.calendarUrl} onChange={(v: string) => update("calendarUrl", v)} testId="input-calendar" />
            <Field label="Google Review Link" value={card.googleReviewLink} onChange={(v: string) => update("googleReviewLink", v)} testId="input-review" />
          </Section>

          <Section title="Images">
            <Field label="Profile Photo URL" value={card.photoUrl} onChange={(v: string) => update("photoUrl", v)} testId="input-photo" />
            <Field label="Cover Image URL" value={card.coverImageUrl} onChange={(v: string) => update("coverImageUrl", v)} testId="input-cover" />
            <Field label="Logo Image URL" value={card.logoImageUrl} onChange={(v: string) => update("logoImageUrl", v)} testId="input-logo" />
          </Section>

          <Section title="Appearance">
            <div className="grid grid-cols-2 gap-3">
              <ColorField label="Brand Color" value={card.brandColor || "#6366f1"} onChange={(v: string) => update("brandColor", v)} testId="input-brand-color" />
              <ColorField label="Accent Color" value={card.accentColor || "#8b5cf6"} onChange={(v: string) => update("accentColor", v)} testId="input-accent-color" />
            </div>
            <div className="mt-3">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Theme</label>
              <select value={card.theme || "executive-dark"} onChange={(e) => update("theme", e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm focus:border-indigo-500/50 focus:outline-none"
                data-testid="select-theme">
                <option value="executive-dark">Onyx — Black & cobalt</option>
                <option value="luxury-dark">Champagne — Charcoal & gold</option>
                <option value="clean-light">Porcelain — Cream & black</option>
                <option value="bold-agency">Neon Pulse — Navy & hot pink</option>
                <option value="modern-gradient">Coastal — Sunset peach</option>
                <option value="minimal-neutral">Botanical — Forest & cream</option>
              </select>
            </div>
          </Section>

          <Section title="Social Links">
            {(card.socialLinks || []).map((link: SocialLink, i: number) => (
              <div key={i} className="flex gap-2 mb-2">
                <input value={link.label} onChange={(e) => updateSocialLink(i, "label", e.target.value)} placeholder="Label (e.g. Instagram)"
                  className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-sm focus:border-indigo-500/50 focus:outline-none" data-testid={`input-social-label-${i}`} />
                <input value={link.url} onChange={(e) => updateSocialLink(i, "url", e.target.value)} placeholder="URL"
                  className="flex-[2] px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-sm focus:border-indigo-500/50 focus:outline-none" data-testid={`input-social-url-${i}`} />
                <button onClick={() => removeSocialLink(i)} className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20" data-testid={`button-remove-social-${i}`}><Trash2 size={14} /></button>
              </div>
            ))}
            <button onClick={addSocialLink} className="text-sm text-indigo-400 flex items-center gap-1 mt-1" data-testid="button-add-social"><Plus size={14} /> Add Social Link</button>
          </Section>

          <Section title="Custom Links">
            {(card.links || []).map((link: CustomLink, i: number) => (
              <div key={i} className="flex gap-2 mb-2">
                <input value={link.label} onChange={(e) => updateLink(i, "label", e.target.value)} placeholder="Label"
                  className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-sm focus:border-indigo-500/50 focus:outline-none" data-testid={`input-link-label-${i}`} />
                <input value={link.url} onChange={(e) => updateLink(i, "url", e.target.value)} placeholder="URL"
                  className="flex-[2] px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-sm focus:border-indigo-500/50 focus:outline-none" data-testid={`input-link-url-${i}`} />
                <button onClick={() => removeLink(i)} className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20" data-testid={`button-remove-link-${i}`}><Trash2 size={14} /></button>
              </div>
            ))}
            <button onClick={addLink} className="text-sm text-indigo-400 flex items-center gap-1 mt-1" data-testid="button-add-link"><Plus size={14} /> Add Link</button>
          </Section>

          <Section title="Services / Expertise">
            {(card.services || []).map((svc: Service, i: number) => (
              <div key={i} className="flex gap-2 mb-2">
                <input value={svc.label} onChange={(e) => updateService(i, "label", e.target.value)} placeholder="Service name"
                  className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-sm focus:border-indigo-500/50 focus:outline-none" data-testid={`input-service-label-${i}`} />
                <input value={svc.description} onChange={(e) => updateService(i, "description", e.target.value)} placeholder="Description"
                  className="flex-[2] px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-sm focus:border-indigo-500/50 focus:outline-none" data-testid={`input-service-desc-${i}`} />
                <button onClick={() => removeService(i)} className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20" data-testid={`button-remove-service-${i}`}><Trash2 size={14} /></button>
              </div>
            ))}
            <button onClick={addService} className="text-sm text-indigo-400 flex items-center gap-1 mt-1" data-testid="button-add-service"><Plus size={14} /> Add Service</button>
          </Section>

          <Section title="SEO">
            <Field label="SEO Title" value={card.seoTitle} onChange={(v: string) => update("seoTitle", v)} testId="input-seo-title" />
            <TextArea label="SEO Description" value={card.seoDescription} onChange={(v: string) => update("seoDescription", v)} testId="input-seo-desc" />
          </Section>
        </div>

        <div className="mt-8 flex justify-center">
          <button onClick={save} disabled={saving}
            className="px-8 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-sm hover:from-indigo-500 hover:to-purple-500 transition-all flex items-center gap-2"
            data-testid="button-save-bottom">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? "Saving..." : "Save All Changes"}
          </button>
        </div>

        <p className="text-center text-xs text-slate-600 mt-8">
          Changes are saved instantly and reflected on your live card.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
      <h3 className="text-sm font-bold text-slate-300 mb-4 uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <div className="mb-3">
      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">{label}</label>
      <input value={value || ""} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm focus:border-indigo-500/50 focus:outline-none transition-colors"
        data-testid={testId} />
    </div>
  );
}

function TextArea({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <div className="mb-3">
      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">{label}</label>
      <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={3}
        className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm focus:border-indigo-500/50 focus:outline-none transition-colors resize-none"
        data-testid={testId} />
    </div>
  );
}

function ColorField({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <div>
      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 rounded-lg border-0 cursor-pointer" data-testid={testId} />
        <input value={value} onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-sm font-mono focus:border-indigo-500/50 focus:outline-none" />
      </div>
    </div>
  );
}
