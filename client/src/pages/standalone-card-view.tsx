import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, MessageSquare, Mail, Globe, Star, MapPin, Calendar,
  ExternalLink, Share2, Download, QrCode, X, Loader2, CreditCard,
  ChevronDown, Copy, Check, Link2, ArrowUpRight
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

const SOCIAL_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  instagram: { icon: "📸", color: "#E4405F", bg: "from-pink-600 to-purple-600" },
  facebook: { icon: "📘", color: "#1877F2", bg: "from-blue-600 to-blue-700" },
  tiktok: { icon: "🎵", color: "#000000", bg: "from-gray-800 to-gray-900" },
  linkedin: { icon: "💼", color: "#0A66C2", bg: "from-blue-700 to-blue-800" },
  youtube: { icon: "▶️", color: "#FF0000", bg: "from-red-600 to-red-700" },
};

export default function StandaloneCardView() {
  const [, params1] = useRoute("/standalone/c/:slug");
  const [, params2] = useRoute("/standalone/card/:slug");
  const params = params1 || params2;
  const [, setLocation] = useLocation();
  const [card, setCard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showShare, setShowShare] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [copied, setCopied] = useState(false);
  const tracked = useRef(false);

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
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
          <Loader2 size={36} className="text-indigo-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-500 text-sm font-medium">Loading card...</p>
        </motion.div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center px-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center">
          <div className="w-20 h-20 rounded-full bg-white/[0.05] flex items-center justify-center mx-auto mb-6">
            <X size={32} className="text-slate-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Card Not Found</h1>
          <p className="text-slate-400 text-sm max-w-xs mx-auto mb-6">This card doesn't exist or isn't published yet.</p>
          <button onClick={() => setLocation("/standalone/card")}
            className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl font-semibold text-sm">
            Get Your Own Card
          </button>
        </motion.div>
      </div>
    );
  }

  const tc = card.themeColor || "#0ea5e9";
  const tcDark = `${tc}22`;
  const cardUrl = `${window.location.origin}/standalone/card/${card.slug}`;
  const referralUrl = card.referralCode ? `/standalone/card?ref=${card.referralCode}` : "/standalone/card";

  const socialLinks = [
    card.instagramUrl && { label: "Instagram", url: card.instagramUrl, key: "instagram" },
    card.facebookUrl && { label: "Facebook", url: card.facebookUrl, key: "facebook" },
    card.tiktokUrl && { label: "TikTok", url: card.tiktokUrl, key: "tiktok" },
    card.linkedinUrl && { label: "LinkedIn", url: card.linkedinUrl, key: "linkedin" },
    card.youtubeUrl && { label: "YouTube", url: card.youtubeUrl, key: "youtube" },
  ].filter(Boolean) as Array<{ label: string; url: string; key: string }>;

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

  const copyLink = () => {
    navigator.clipboard.writeText(cardUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const actionButtons = [
    card.phone && { href: `tel:${card.phone}`, icon: Phone, label: "Call", testId: "button-call" },
    card.phone && { href: `sms:${card.phone}`, icon: MessageSquare, label: "Text", testId: "button-text" },
    card.email && { href: `mailto:${card.email}`, icon: Mail, label: "Email", testId: "button-email" },
    card.website && { href: card.website, icon: Globe, label: "Web", testId: "button-website", external: true },
  ].filter(Boolean) as Array<{ href: string; icon: any; label: string; testId: string; external?: boolean }>;

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <div className="max-w-md mx-auto relative">

        <div className="relative h-[50vh] min-h-[360px] max-h-[500px] overflow-hidden flex items-end">
          {card.profileImageUrl ? (
            <div className="absolute inset-0">
              <img src={card.profileImageUrl} alt={card.fullName}
                className="w-full h-full object-cover object-top" loading="eager" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0f] via-[#0a0a0f]/60 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0f]/30 to-transparent" />
            </div>
          ) : (
            <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${tc}40, ${tc}15)` }}>
              <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0f] via-transparent to-transparent" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[120px] font-black opacity-10 text-white">
                {card.fullName?.charAt(0)}
              </div>
            </div>
          )}

          {card.logoUrl && (
            <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }}
              className="absolute top-5 right-5 z-10">
              <img src={card.logoUrl} alt="Logo"
                className="w-14 h-14 rounded-2xl object-cover bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl" />
            </motion.div>
          )}

          <div className="relative z-10 p-7 pb-8 w-full">
            <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-[1.1]"
              data-testid="text-card-name">
              {card.fullName}
            </motion.h1>

            {card.title && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                className="flex items-center gap-3 mt-3">
                <div className="h-[2px] w-10 rounded-full" style={{ backgroundColor: tc }} />
                <p className="text-lg font-bold" style={{ color: tc }}>{card.title}</p>
              </motion.div>
            )}

            {card.businessName && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
                className="text-slate-400 text-sm mt-1.5 font-medium" data-testid="text-business">
                {card.businessName}
              </motion.p>
            )}

            {card.address && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
                className="text-slate-500 text-xs mt-2 flex items-center gap-1.5" data-testid="text-address">
                <MapPin size={12} /> {card.address}
              </motion.p>
            )}

            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
              className="flex justify-center mt-5">
              <ChevronDown size={20} className="text-white/20 animate-bounce" />
            </motion.div>
          </div>
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="px-5 pb-10 -mt-2 relative z-10">

          {card.bio && (
            <p className="text-slate-300 text-sm leading-relaxed mb-6 px-1">{card.bio}</p>
          )}

          <div className={`grid ${actionButtons.length >= 4 ? 'grid-cols-4' : `grid-cols-${actionButtons.length}`} gap-2 mb-5`}>
            {actionButtons.map((btn, i) => (
              <motion.a key={i} href={btn.href} target={btn.external ? "_blank" : undefined}
                rel={btn.external ? "noopener noreferrer" : undefined}
                data-testid={btn.testId}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 + i * 0.05 }}
                className="flex flex-col items-center gap-2 py-4 rounded-2xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.15] active:scale-95 transition-all">
                <btn.icon className="w-5 h-5" style={{ color: tc }} />
                <span className="text-[11px] text-slate-400 font-medium">{btn.label}</span>
              </motion.a>
            ))}
          </div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
            className="flex gap-2 mb-6">
            <button data-testid="button-save-contact" onClick={handleSaveContact}
              className="flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-2xl font-bold text-sm text-white transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg"
              style={{ backgroundColor: tc, boxShadow: `0 8px 32px ${tc}40` }}>
              <Download className="w-4 h-4" /> Save Contact
            </button>
            <button data-testid="button-share" onClick={handleShare}
              className="flex items-center justify-center px-5 py-3.5 rounded-2xl bg-white/[0.06] border border-white/[0.1] hover:bg-white/[0.1] active:scale-95 transition-all">
              <Share2 className="w-4 h-4 text-slate-300" />
            </button>
            <button data-testid="button-qr" onClick={() => setShowQR(!showQR)}
              className="flex items-center justify-center px-5 py-3.5 rounded-2xl bg-white/[0.06] border border-white/[0.1] hover:bg-white/[0.1] active:scale-95 transition-all">
              <QrCode className="w-4 h-4 text-slate-300" />
            </button>
          </motion.div>

          <AnimatePresence>
            {showQR && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="mb-6 overflow-hidden">
                <div className="p-6 bg-white rounded-3xl text-center shadow-2xl">
                  <QRCodeSVG value={cardUrl} size={200} bgColor="#ffffff" fgColor="#000000" level="H"
                    className="mx-auto" />
                  <p className="text-neutral-500 text-xs mt-3 font-medium">Scan to view this card</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-2.5 mb-6">
            {card.reviewLink && (
              <motion.a href={card.reviewLink} target="_blank" rel="noopener noreferrer" data-testid="button-review"
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.75 }}
                className="flex items-center gap-3 px-5 py-4 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.15] rounded-2xl text-sm transition-all group">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${tc}20` }}>
                  <Star className="w-5 h-5" style={{ color: tc }} />
                </div>
                <span className="text-white font-medium flex-1">Leave a Review</span>
                <ArrowUpRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
              </motion.a>
            )}
            {card.bookingLink && (
              <motion.a href={card.bookingLink} target="_blank" rel="noopener noreferrer" data-testid="button-booking"
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8 }}
                className="flex items-center gap-3 px-5 py-4 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.15] rounded-2xl text-sm transition-all group">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${tc}20` }}>
                  <Calendar className="w-5 h-5" style={{ color: tc }} />
                </div>
                <span className="text-white font-medium flex-1">Book an Appointment</span>
                <ArrowUpRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
              </motion.a>
            )}
          </div>

          {socialLinks.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.85 }}
              className="mb-6">
              <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-bold mb-3 px-1">Connect</p>
              <div className="grid grid-cols-2 gap-2">
                {socialLinks.map((s, i) => {
                  const style = SOCIAL_ICONS[s.key] || { icon: "🔗", color: tc, bg: "from-gray-700 to-gray-800" };
                  return (
                    <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 px-4 py-3.5 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.15] rounded-2xl text-sm transition-all active:scale-95 group">
                      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${style.bg} flex items-center justify-center text-base shadow-lg`}>
                        {style.icon}
                      </div>
                      <span className="text-white font-medium text-sm">{s.label}</span>
                    </a>
                  );
                })}
              </div>
            </motion.div>
          )}

          {customLinks.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}
              className="mb-6">
              <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-bold mb-3 px-1">Links</p>
              <div className="space-y-2">
                {customLinks.filter(l => l.label && l.url).map((link, i) => (
                  <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 px-5 py-4 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.15] rounded-2xl text-sm transition-all group">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${tc}20` }}>
                      <ExternalLink className="w-5 h-5" style={{ color: tc }} />
                    </div>
                    <span className="text-white font-medium flex-1">{link.label}</span>
                    <ArrowUpRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
                  </a>
                ))}
              </div>
            </motion.div>
          )}

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}
            className="mt-10 pt-8 border-t border-white/[0.06]">
            <a href={referralUrl} data-testid="button-get-your-own"
              className="w-full flex items-center justify-center gap-2.5 px-6 py-4 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:via-blue-500 hover:to-indigo-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-600/20 hover:shadow-blue-500/30 hover:scale-[1.02] active:scale-[0.98]">
              <CreditCard className="w-5 h-5" /> Get Your Own Digital Card
            </a>
            <p className="text-center text-slate-600 text-[11px] mt-3 font-medium tracking-wide">Powered by Apex Digital Cards</p>
          </motion.div>
        </motion.div>
      </div>

      <AnimatePresence>
        {showShare && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center"
            onClick={() => setShowShare(false)}>
            <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
              className="w-full max-w-md bg-[#1a1a2e] border border-white/[0.1] rounded-t-3xl sm:rounded-3xl p-6"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-white">Share Card</h3>
                <button onClick={() => setShowShare(false)} className="p-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] transition">
                  <X size={18} className="text-slate-400" />
                </button>
              </div>

              <div className="flex justify-center mb-6">
                <div className="p-4 bg-white rounded-2xl shadow-xl">
                  <QRCodeSVG value={cardUrl} size={180} bgColor="#ffffff" fgColor="#000000" level="H" />
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 rounded-xl bg-white/[0.04] border border-white/[0.08] mb-4">
                <Link2 size={16} className="text-slate-500" />
                <span className="flex-1 text-sm truncate text-slate-400">{cardUrl}</span>
                <button onClick={copyLink}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    copied ? "bg-green-500/20 text-green-400" : "text-white"
                  }`}
                  style={!copied ? { backgroundColor: `${tc}30`, color: tc } : {}}>
                  {copied ? <><Check size={12} className="inline mr-1" />Copied</> : <><Copy size={12} className="inline mr-1" />Copy</>}
                </button>
              </div>

              {typeof navigator !== "undefined" && !!navigator.share && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? (
                <button onClick={() => { navigator.share({ title: card.fullName, url: cardUrl }).catch(() => {}); }}
                  className="w-full py-3.5 rounded-xl text-white font-bold text-sm flex items-center justify-center gap-2"
                  style={{ backgroundColor: tc }}>
                  <Share2 size={16} /> Share via...
                </button>
              ) : (
                <div className="flex gap-2">
                  <a href={`mailto:?subject=${encodeURIComponent(card.fullName)}&body=${encodeURIComponent(`Check out this card: ${cardUrl}`)}`}
                    className="flex-1 py-3.5 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white font-bold text-sm flex items-center justify-center gap-2 hover:bg-white/[0.1] active:scale-95 transition-all">
                    <Mail size={16} /> Email
                  </a>
                  <a href={`sms:?body=${encodeURIComponent(`Check out ${card.fullName}'s digital business card: ${cardUrl}`)}`}
                    className="flex-1 py-3.5 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white font-bold text-sm flex items-center justify-center gap-2 hover:bg-white/[0.1] active:scale-95 transition-all">
                    <MessageSquare size={16} /> Text
                  </a>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
