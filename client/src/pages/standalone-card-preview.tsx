import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Phone, MessageSquare, Mail, Globe, Star, MapPin, Calendar, ExternalLink, Loader2 } from "lucide-react";

export default function StandaloneCardPreview() {
  const [, setLocation] = useLocation();
  const [cardData, setCardData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem("standalone_card_data");
    if (saved) {
      setCardData(JSON.parse(saved));
    } else {
      setLocation("/standalone/create");
    }
  }, [setLocation]);

  const handleCheckout = async () => {
    if (!cardData) return;
    setLoading(true);
    try {
      const referralCode = sessionStorage.getItem("standalone_ref") || "";
      const res = await fetch("/api/standalone/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardData, referralCode }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error("Checkout error:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!cardData) return null;

  const tc = cardData.themeColor || "#0ea5e9";

  const socialLinks = [
    cardData.instagramUrl && { label: "Instagram", url: cardData.instagramUrl },
    cardData.facebookUrl && { label: "Facebook", url: cardData.facebookUrl },
    cardData.tiktokUrl && { label: "TikTok", url: cardData.tiktokUrl },
    cardData.linkedinUrl && { label: "LinkedIn", url: cardData.linkedinUrl },
    cardData.youtubeUrl && { label: "YouTube", url: cardData.youtubeUrl },
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <header className="container mx-auto px-4 py-6 flex items-center justify-between">
        <button
          data-testid="button-back"
          onClick={() => setLocation("/standalone/create")}
          className="flex items-center gap-2 text-neutral-400 hover:text-white transition text-sm"
        >
          <ArrowLeft className="w-4 h-4" /> Edit
        </button>
        <span className="text-sm text-neutral-500">Preview</span>
      </header>

      <main className="container mx-auto px-4 max-w-md pb-32">
        <p className="text-center text-neutral-400 text-sm mb-4">This is how your card will look</p>

        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl">
          <div className="h-24 relative" style={{ background: `linear-gradient(135deg, ${tc}, ${tc}88)` }}>
            {cardData.logoUrl && (
              <img src={cardData.logoUrl} alt="Logo" className="absolute top-3 right-3 w-10 h-10 rounded-lg object-cover bg-white/10" />
            )}
          </div>

          <div className="px-6 pb-6 -mt-10">
            {cardData.profileImageUrl ? (
              <img src={cardData.profileImageUrl} alt={cardData.fullName} className="w-20 h-20 rounded-full border-4 border-neutral-900 object-cover mb-3" />
            ) : (
              <div className="w-20 h-20 rounded-full border-4 border-neutral-900 flex items-center justify-center text-2xl font-bold mb-3" style={{ backgroundColor: tc }}>
                {cardData.fullName?.charAt(0)}
              </div>
            )}

            <h2 data-testid="text-card-name" className="text-xl font-bold">{cardData.fullName}</h2>
            {cardData.title && <p className="text-neutral-400 text-sm">{cardData.title}</p>}
            {cardData.businessName && <p className="font-medium text-sm" style={{ color: tc }}>{cardData.businessName}</p>}
            {cardData.bio && <p className="text-neutral-300 text-sm mt-3">{cardData.bio}</p>}

            <div className="grid grid-cols-4 gap-2 mt-5">
              {cardData.phone && (
                <button className="flex flex-col items-center gap-1 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 transition">
                  <Phone className="w-5 h-5" style={{ color: tc }} />
                  <span className="text-xs text-neutral-400">Call</span>
                </button>
              )}
              {cardData.phone && (
                <button className="flex flex-col items-center gap-1 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 transition">
                  <MessageSquare className="w-5 h-5" style={{ color: tc }} />
                  <span className="text-xs text-neutral-400">Text</span>
                </button>
              )}
              {cardData.email && (
                <button className="flex flex-col items-center gap-1 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 transition">
                  <Mail className="w-5 h-5" style={{ color: tc }} />
                  <span className="text-xs text-neutral-400">Email</span>
                </button>
              )}
              {cardData.website && (
                <button className="flex flex-col items-center gap-1 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 transition">
                  <Globe className="w-5 h-5" style={{ color: tc }} />
                  <span className="text-xs text-neutral-400">Web</span>
                </button>
              )}
            </div>

            {cardData.address && (
              <div className="flex items-center gap-2 mt-4 text-sm text-neutral-300">
                <MapPin className="w-4 h-4 text-neutral-500" />
                {cardData.address}
              </div>
            )}

            <div className="space-y-2 mt-4">
              {cardData.reviewLink && (
                <div className="flex items-center gap-3 px-4 py-3 bg-neutral-800 rounded-xl text-sm">
                  <Star className="w-4 h-4" style={{ color: tc }} />
                  <span>Leave a Review</span>
                </div>
              )}
              {cardData.bookingLink && (
                <div className="flex items-center gap-3 px-4 py-3 bg-neutral-800 rounded-xl text-sm">
                  <Calendar className="w-4 h-4" style={{ color: tc }} />
                  <span>Book an Appointment</span>
                </div>
              )}
            </div>

            {socialLinks.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {socialLinks.map((s: any, i: number) => (
                  <span key={i} className="px-3 py-1.5 bg-neutral-800 rounded-full text-xs text-neutral-300">{s.label}</span>
                ))}
              </div>
            )}

            {cardData.customLinks?.length > 0 && (
              <div className="space-y-2 mt-4">
                {cardData.customLinks.filter((l: any) => l.label && l.url).map((link: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 bg-neutral-800 rounded-xl text-sm">
                    <ExternalLink className="w-4 h-4" style={{ color: tc }} />
                    <span>{link.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-neutral-950/90 backdrop-blur border-t border-neutral-800">
        <div className="container mx-auto max-w-md">
          <button
            data-testid="button-checkout"
            onClick={handleCheckout}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-white font-semibold rounded-xl transition"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Continue to Checkout"}
          </button>
          <p className="text-center text-neutral-500 text-xs mt-2">One-time payment — no subscription</p>
        </div>
      </div>
    </div>
  );
}
