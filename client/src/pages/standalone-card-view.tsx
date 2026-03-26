import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import {
  Phone, MessageSquare, Mail, Globe, Star, MapPin, Calendar,
  ExternalLink, Share2, Download, QrCode, X, Loader2, CreditCard
} from "lucide-react";

export default function StandaloneCardView() {
  const [, params1] = useRoute("/standalone/c/:slug");
  const [, params2] = useRoute("/standalone/card/:slug");
  const params = params1 || params2;
  const [, setLocation] = useLocation();
  const [card, setCard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showShare, setShowShare] = useState(false);
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    if (!params?.slug) return;
    fetch(`/api/standalone/card/${params.slug}`)
      .then(r => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then(setCard)
      .catch(() => setCard(null))
      .finally(() => setLoading(false));
  }, [params?.slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (!card) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Card Not Found</h1>
          <p className="text-neutral-400 mb-6">This card doesn't exist or isn't published yet.</p>
          <button onClick={() => setLocation("/standalone/card")} className="px-6 py-3 bg-cyan-500 text-white rounded-xl">
            Get Your Own Card
          </button>
        </div>
      </div>
    );
  }

  const tc = card.themeColor || "#0ea5e9";
  const cardUrl = `${window.location.origin}/standalone/c/${card.slug}`;
  const referralUrl = card.referralCode ? `/standalone/card?ref=${card.referralCode}` : "/standalone/card";

  const socialLinks = [
    card.instagramUrl && { label: "Instagram", url: card.instagramUrl, icon: "📸" },
    card.facebookUrl && { label: "Facebook", url: card.facebookUrl, icon: "📘" },
    card.tiktokUrl && { label: "TikTok", url: card.tiktokUrl, icon: "🎵" },
    card.linkedinUrl && { label: "LinkedIn", url: card.linkedinUrl, icon: "💼" },
    card.youtubeUrl && { label: "YouTube", url: card.youtubeUrl, icon: "▶️" },
  ].filter(Boolean);

  const customLinks = (card.customLinks || []) as Array<{ label: string; url: string }>;

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: card.fullName, text: `Check out ${card.fullName}'s digital business card`, url: cardUrl });
      } catch {}
    } else {
      setShowShare(true);
    }
  };

  const handleSaveContact = () => {
    window.location.href = `/api/standalone/card/${card.slug}/vcard`;
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="max-w-md mx-auto">
        <div className="h-32 relative" style={{ background: `linear-gradient(135deg, ${tc}, ${tc}88)` }}>
          {card.logoUrl && (
            <img src={card.logoUrl} alt="Logo" className="absolute top-4 right-4 w-12 h-12 rounded-xl object-cover bg-white/10 shadow" />
          )}
        </div>

        <div className="px-5 pb-8 -mt-12">
          {card.profileImageUrl ? (
            <img src={card.profileImageUrl} alt={card.fullName} className="w-24 h-24 rounded-full border-4 border-neutral-950 object-cover mb-3 shadow-lg" />
          ) : (
            <div className="w-24 h-24 rounded-full border-4 border-neutral-950 flex items-center justify-center text-3xl font-bold mb-3 shadow-lg" style={{ backgroundColor: tc }}>
              {card.fullName?.charAt(0)}
            </div>
          )}

          <h1 data-testid="text-card-name" className="text-2xl font-bold">{card.fullName}</h1>
          {card.title && <p className="text-neutral-400">{card.title}</p>}
          {card.businessName && <p className="font-medium" style={{ color: tc }}>{card.businessName}</p>}
          {card.bio && <p className="text-neutral-300 text-sm mt-3 leading-relaxed">{card.bio}</p>}

          {card.address && (
            <div className="flex items-center gap-2 mt-3 text-sm text-neutral-400">
              <MapPin className="w-4 h-4" />
              {card.address}
            </div>
          )}

          <div className="grid grid-cols-4 gap-2 mt-6">
            {card.phone && (
              <a href={`tel:${card.phone}`} data-testid="button-call" className="flex flex-col items-center gap-1 py-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 transition">
                <Phone className="w-5 h-5" style={{ color: tc }} />
                <span className="text-xs text-neutral-400">Call</span>
              </a>
            )}
            {card.phone && (
              <a href={`sms:${card.phone}`} data-testid="button-text" className="flex flex-col items-center gap-1 py-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 transition">
                <MessageSquare className="w-5 h-5" style={{ color: tc }} />
                <span className="text-xs text-neutral-400">Text</span>
              </a>
            )}
            {card.email && (
              <a href={`mailto:${card.email}`} data-testid="button-email" className="flex flex-col items-center gap-1 py-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 transition">
                <Mail className="w-5 h-5" style={{ color: tc }} />
                <span className="text-xs text-neutral-400">Email</span>
              </a>
            )}
            {card.website && (
              <a href={card.website} target="_blank" rel="noopener noreferrer" data-testid="button-website" className="flex flex-col items-center gap-1 py-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 transition">
                <Globe className="w-5 h-5" style={{ color: tc }} />
                <span className="text-xs text-neutral-400">Web</span>
              </a>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <button
              data-testid="button-save-contact"
              onClick={handleSaveContact}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition"
              style={{ backgroundColor: tc, color: "white" }}
            >
              <Download className="w-4 h-4" /> Save Contact
            </button>
            <button
              data-testid="button-share"
              onClick={handleShare}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 transition text-sm"
            >
              <Share2 className="w-4 h-4" />
            </button>
            <button
              data-testid="button-qr"
              onClick={() => setShowQR(!showQR)}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 transition text-sm"
            >
              <QrCode className="w-4 h-4" />
            </button>
          </div>

          {showQR && (
            <div className="mt-4 p-4 bg-white rounded-2xl text-center">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(cardUrl)}`}
                alt="QR Code"
                className="mx-auto"
                width={200}
                height={200}
              />
              <p className="text-neutral-600 text-xs mt-2">Scan to view card</p>
            </div>
          )}

          <div className="space-y-2 mt-6">
            {card.reviewLink && (
              <a href={card.reviewLink} target="_blank" rel="noopener noreferrer" data-testid="button-review"
                className="flex items-center gap-3 px-4 py-3 bg-neutral-900 hover:bg-neutral-800 rounded-xl text-sm transition">
                <Star className="w-4 h-4" style={{ color: tc }} />
                <span>Leave a Review</span>
                <ExternalLink className="w-3 h-3 text-neutral-500 ml-auto" />
              </a>
            )}
            {card.bookingLink && (
              <a href={card.bookingLink} target="_blank" rel="noopener noreferrer" data-testid="button-booking"
                className="flex items-center gap-3 px-4 py-3 bg-neutral-900 hover:bg-neutral-800 rounded-xl text-sm transition">
                <Calendar className="w-4 h-4" style={{ color: tc }} />
                <span>Book an Appointment</span>
                <ExternalLink className="w-3 h-3 text-neutral-500 ml-auto" />
              </a>
            )}
          </div>

          {socialLinks.length > 0 && (
            <div className="mt-6">
              <p className="text-xs text-neutral-500 uppercase tracking-wide mb-3">Social</p>
              <div className="grid grid-cols-2 gap-2">
                {socialLinks.map((s: any, i: number) => (
                  <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-3 bg-neutral-900 hover:bg-neutral-800 rounded-xl text-sm transition">
                    <span>{s.icon}</span>
                    <span>{s.label}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {customLinks.length > 0 && (
            <div className="mt-6">
              <p className="text-xs text-neutral-500 uppercase tracking-wide mb-3">Links</p>
              <div className="space-y-2">
                {customLinks.filter(l => l.label && l.url).map((link, i) => (
                  <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 px-4 py-3 bg-neutral-900 hover:bg-neutral-800 rounded-xl text-sm transition">
                    <ExternalLink className="w-4 h-4" style={{ color: tc }} />
                    <span>{link.label}</span>
                    <ExternalLink className="w-3 h-3 text-neutral-500 ml-auto" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="mt-10 pt-6 border-t border-neutral-800">
            <a
              href={referralUrl}
              data-testid="button-get-your-own"
              className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold rounded-xl transition shadow-lg shadow-cyan-500/20"
            >
              <CreditCard className="w-5 h-5" /> Get Your Own Card
            </a>
            <p className="text-center text-neutral-500 text-xs mt-2">Powered by Apex Digital Cards</p>
          </div>
        </div>
      </div>

      {showShare && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center">
          <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-t-3xl sm:rounded-3xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Share Card</h3>
              <button onClick={() => setShowShare(false)} className="text-neutral-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <button
                onClick={() => { navigator.clipboard.writeText(cardUrl); setShowShare(false); }}
                className="w-full px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-sm text-left transition"
              >
                Copy Link
              </button>
              <a
                href={`sms:?body=Check out my digital business card: ${cardUrl}`}
                className="block px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-sm transition"
              >
                Share via Text
              </a>
              <a
                href={`mailto:?subject=My Digital Business Card&body=Check out my digital business card: ${cardUrl}`}
                className="block px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-sm transition"
              >
                Share via Email
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
