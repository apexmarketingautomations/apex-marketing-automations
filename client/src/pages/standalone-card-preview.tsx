import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Phone, MessageSquare, Mail, Globe, Star, MapPin, Calendar, ExternalLink, Loader2, CheckCircle, Sparkles } from "lucide-react";

const PREMIUM_PRICE = 999;

export default function StandaloneCardPreview() {
  const [, setLocation] = useLocation();
  const [cardData, setCardData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [promo, setPromo] = useState<any>(null);
  const [premiumBump, setPremiumBump] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem("standalone_card_data");
    if (saved) {
      setCardData(JSON.parse(saved));
    } else {
      setLocation("/standalone/create");
    }
    fetch("/api/standalone/promo-status").then(r => r.json()).then(setPromo).catch(() => {});
  }, [setLocation]);

  const handleCheckout = async () => {
    if (!cardData) return;
    setLoading(true);
    try {
      const referralCode = sessionStorage.getItem("standalone_ref") || "";
      const res = await fetch("/api/standalone/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardData, referralCode, premiumBump }),
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
  const basePrice = promo?.promoActive ? promo.promoPrice : (promo?.regularPrice || 4900);
  const bumpPrice = premiumBump ? PREMIUM_PRICE : 0;
  const totalCents = basePrice + bumpPrice;

  const socialLinks = [
    cardData.instagramUrl && { label: "Instagram", url: cardData.instagramUrl },
    cardData.facebookUrl && { label: "Facebook", url: cardData.facebookUrl },
    cardData.tiktokUrl && { label: "TikTok", url: cardData.tiktokUrl },
    cardData.linkedinUrl && { label: "LinkedIn", url: cardData.linkedinUrl },
    cardData.youtubeUrl && { label: "YouTube", url: cardData.youtubeUrl },
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-[#09090b] text-white">
      <header className="container mx-auto px-4 py-5 flex items-center justify-between">
        <button data-testid="button-back" onClick={() => setLocation("/standalone/create")}
          className="flex items-center gap-2 text-neutral-400 hover:text-white transition text-sm">
          <ArrowLeft className="w-4 h-4" /> Edit
        </button>
        <span className="text-sm text-neutral-500">Preview & Checkout</span>
      </header>

      <main className="container mx-auto px-4 max-w-md pb-52">
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

        <div className="mt-6">
          <button
            data-testid="button-order-bump"
            onClick={() => setPremiumBump(!premiumBump)}
            className={`w-full text-left rounded-2xl border-2 p-4 transition ${
              premiumBump
                ? "border-cyan-500 bg-cyan-500/[0.06]"
                : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15]"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition ${
                premiumBump ? "border-cyan-500 bg-cyan-500" : "border-neutral-600"
              }`}>
                {premiumBump && <CheckCircle className="w-3.5 h-3.5 text-white" />}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span className="font-bold text-sm text-white">Add Premium Upgrade</span>
                  <span className="text-xs font-bold text-cyan-400 ml-auto">+$9.99</span>
                </div>
                <ul className="space-y-1 mt-2">
                  {[
                    "Enhanced design customization",
                    "Priority support",
                    "Optimized layout for better conversions",
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-neutral-400">
                      <CheckCircle className="w-3 h-3 text-cyan-400 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </button>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#09090b]/95 backdrop-blur-lg border-t border-white/[0.08]">
        <div className="container mx-auto max-w-md">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-neutral-400 text-xs">
              Digital Card{premiumBump ? " + Premium" : ""}
            </span>
            <span className="text-white font-bold text-lg">${(totalCents / 100).toFixed(2)}</span>
          </div>
          <button data-testid="button-checkout" onClick={handleCheckout} disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-white font-bold rounded-xl transition shadow-lg shadow-cyan-500/20">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Continue to Checkout"}
          </button>
          <p className="text-center text-neutral-500 text-xs mt-2">One-time payment &middot; Secure checkout via Stripe</p>
        </div>
      </div>
    </div>
  );
}
