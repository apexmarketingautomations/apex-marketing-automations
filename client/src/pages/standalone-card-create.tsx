import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, Plus, Trash2, Palette } from "lucide-react";

interface CustomLink {
  label: string;
  url: string;
}

const THEME_COLORS = [
  "#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899",
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#14b8a6", "#06b6d4", "#1e293b", "#000000",
];

export default function StandaloneCardCreate() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    fullName: "", businessName: "", title: "", phone: "", email: "",
    website: "", address: "", bio: "", profileImageUrl: "", logoUrl: "",
    reviewLink: "", bookingLink: "", instagramUrl: "", facebookUrl: "",
    tiktokUrl: "", linkedinUrl: "", youtubeUrl: "", themeColor: "#0ea5e9",
  });
  const [customLinks, setCustomLinks] = useState<CustomLink[]>([]);

  useEffect(() => {
    const saved = sessionStorage.getItem("standalone_card_data");
    if (saved) {
      const data = JSON.parse(saved);
      if (data.customLinks) {
        setCustomLinks(data.customLinks);
        delete data.customLinks;
      }
      setForm(prev => ({ ...prev, ...data }));
    }
  }, []);

  const updateField = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleNext = () => {
    if (step === 1 && (!form.fullName || !form.email)) {
      return;
    }
    if (step < 4) setStep(step + 1);
    else {
      const cardData = { ...form, customLinks: customLinks.filter(l => l.label && l.url) };
      sessionStorage.setItem("standalone_card_data", JSON.stringify(cardData));
      setLocation("/standalone/preview");
    }
  };

  const inputClass = "w-full px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-cyan-500 transition text-sm";
  const labelClass = "block text-sm font-medium text-neutral-300 mb-1.5";

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-950 to-neutral-900 text-white">
      <header className="container mx-auto px-4 py-6">
        <button
          data-testid="button-back"
          onClick={() => step > 1 ? setStep(step - 1) : setLocation("/standalone/card")}
          className="flex items-center gap-2 text-neutral-400 hover:text-white transition text-sm"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </header>

      <main className="container mx-auto px-4 max-w-lg pb-24">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Create Your Card</h1>
          <div className="flex gap-2">
            {[1, 2, 3, 4].map(s => (
              <div key={s} className={`h-1 flex-1 rounded-full transition ${s <= step ? "bg-cyan-500" : "bg-neutral-700"}`} />
            ))}
          </div>
          <p className="text-neutral-400 text-sm mt-2">
            Step {step} of 4 — {step === 1 ? "Basic Info" : step === 2 ? "Contact & Links" : step === 3 ? "Social Media" : "Theme & Extras"}
          </p>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Full Name *</label>
              <input data-testid="input-fullName" className={inputClass} value={form.fullName} onChange={e => updateField("fullName", e.target.value)} placeholder="John Smith" />
            </div>
            <div>
              <label className={labelClass}>Email *</label>
              <input data-testid="input-email" className={inputClass} type="email" value={form.email} onChange={e => updateField("email", e.target.value)} placeholder="john@business.com" />
            </div>
            <div>
              <label className={labelClass}>Business Name</label>
              <input data-testid="input-businessName" className={inputClass} value={form.businessName} onChange={e => updateField("businessName", e.target.value)} placeholder="Smith & Co" />
            </div>
            <div>
              <label className={labelClass}>Title / Role</label>
              <input data-testid="input-title" className={inputClass} value={form.title} onChange={e => updateField("title", e.target.value)} placeholder="Owner & CEO" />
            </div>
            <div>
              <label className={labelClass}>Phone Number</label>
              <input data-testid="input-phone" className={inputClass} type="tel" value={form.phone} onChange={e => updateField("phone", e.target.value)} placeholder="(555) 123-4567" />
            </div>
            <div>
              <label className={labelClass}>Short Bio</label>
              <textarea data-testid="input-bio" className={inputClass + " min-h-[80px] resize-none"} value={form.bio} onChange={e => updateField("bio", e.target.value)} placeholder="Tell people about yourself or your business..." />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Website</label>
              <input data-testid="input-website" className={inputClass} value={form.website} onChange={e => updateField("website", e.target.value)} placeholder="https://yourbusiness.com" />
            </div>
            <div>
              <label className={labelClass}>Address</label>
              <input data-testid="input-address" className={inputClass} value={form.address} onChange={e => updateField("address", e.target.value)} placeholder="123 Main St, City, State" />
            </div>
            <div>
              <label className={labelClass}>Review Link (Google, Yelp, etc.)</label>
              <input data-testid="input-reviewLink" className={inputClass} value={form.reviewLink} onChange={e => updateField("reviewLink", e.target.value)} placeholder="https://g.page/review/..." />
            </div>
            <div>
              <label className={labelClass}>Booking Link</label>
              <input data-testid="input-bookingLink" className={inputClass} value={form.bookingLink} onChange={e => updateField("bookingLink", e.target.value)} placeholder="https://calendly.com/..." />
            </div>
            <div>
              <label className={labelClass}>Profile Photo URL</label>
              <input data-testid="input-profileImageUrl" className={inputClass} value={form.profileImageUrl} onChange={e => updateField("profileImageUrl", e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <label className={labelClass}>Logo URL</label>
              <input data-testid="input-logoUrl" className={inputClass} value={form.logoUrl} onChange={e => updateField("logoUrl", e.target.value)} placeholder="https://..." />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Instagram</label>
              <input data-testid="input-instagramUrl" className={inputClass} value={form.instagramUrl} onChange={e => updateField("instagramUrl", e.target.value)} placeholder="https://instagram.com/yourbiz" />
            </div>
            <div>
              <label className={labelClass}>Facebook</label>
              <input data-testid="input-facebookUrl" className={inputClass} value={form.facebookUrl} onChange={e => updateField("facebookUrl", e.target.value)} placeholder="https://facebook.com/yourbiz" />
            </div>
            <div>
              <label className={labelClass}>TikTok</label>
              <input data-testid="input-tiktokUrl" className={inputClass} value={form.tiktokUrl} onChange={e => updateField("tiktokUrl", e.target.value)} placeholder="https://tiktok.com/@yourbiz" />
            </div>
            <div>
              <label className={labelClass}>LinkedIn</label>
              <input data-testid="input-linkedinUrl" className={inputClass} value={form.linkedinUrl} onChange={e => updateField("linkedinUrl", e.target.value)} placeholder="https://linkedin.com/in/you" />
            </div>
            <div>
              <label className={labelClass}>YouTube</label>
              <input data-testid="input-youtubeUrl" className={inputClass} value={form.youtubeUrl} onChange={e => updateField("youtubeUrl", e.target.value)} placeholder="https://youtube.com/@yourbiz" />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <div>
              <label className={labelClass}>Accent / Theme Color</label>
              <div className="flex flex-wrap gap-3 mt-2">
                {THEME_COLORS.map(color => (
                  <button
                    key={color}
                    data-testid={`button-color-${color}`}
                    onClick={() => updateField("themeColor", color)}
                    className={`w-10 h-10 rounded-full border-2 transition ${form.themeColor === color ? "border-white scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Palette className="w-4 h-4 text-neutral-400" />
                <input
                  data-testid="input-themeColor"
                  className="px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm w-28"
                  type="text"
                  value={form.themeColor}
                  onChange={e => updateField("themeColor", e.target.value)}
                  placeholder="#0ea5e9"
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Custom Links</label>
              <div className="space-y-3">
                {customLinks.map((link, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      className={inputClass + " flex-1"}
                      value={link.label}
                      onChange={e => {
                        const updated = [...customLinks];
                        updated[i].label = e.target.value;
                        setCustomLinks(updated);
                      }}
                      placeholder="Label"
                    />
                    <input
                      className={inputClass + " flex-1"}
                      value={link.url}
                      onChange={e => {
                        const updated = [...customLinks];
                        updated[i].url = e.target.value;
                        setCustomLinks(updated);
                      }}
                      placeholder="https://..."
                    />
                    <button
                      onClick={() => setCustomLinks(customLinks.filter((_, idx) => idx !== i))}
                      className="px-3 py-2 text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  data-testid="button-add-custom-link"
                  onClick={() => setCustomLinks([...customLinks, { label: "", url: "" }])}
                  className="flex items-center gap-2 text-cyan-400 hover:text-cyan-300 text-sm"
                >
                  <Plus className="w-4 h-4" /> Add Custom Link
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="fixed bottom-0 left-0 right-0 p-4 bg-neutral-950/90 backdrop-blur border-t border-neutral-800">
          <div className="container mx-auto max-w-lg">
            <button
              data-testid="button-next"
              onClick={handleNext}
              disabled={step === 1 && (!form.fullName || !form.email)}
              className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition"
            >
              {step < 4 ? "Continue" : "Preview Your Card"} <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
