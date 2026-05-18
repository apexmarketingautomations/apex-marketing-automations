import { useState, useEffect, Suspense } from "react";
import { useRoute, useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { CinematicCardHero } from "@/components/card-identity/CinematicCardHero";
import {
  CardLoading, CardNotFound, CardError,
  HeroSection, PrimaryActions, SaveShareBar, QRPanel,
  AboutSection, ReviewBookingLinks, LinksSection,
  SocialLinksSection, StickyActionBar, ShareModal, CardFooter, BackgroundGlow,
  adaptStandaloneCard, getCardTheme, resolveThemeForTier, canRemoveBranding,
} from "@/components/card-core";
import type { SharedCardData, CardRenderConfig } from "@/components/card-core";

// ── Sticky lead capture — same behavior as platform card ─────────────────────
function StickyLeadCapture({ card, slug, onClose }: {
  card: SharedCardData;
  slug: string;
  onClose: (submitted: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [name,     setName]     = useState("");
  const [phone,    setPhone]    = useState("");
  const [email,    setEmail]    = useState("");
  const [busy,     setBusy]     = useState(false);
  const [done,     setDone]     = useState(false);
  const [err,      setErr]      = useState("");

  const ownerFirst = (card.name || "them").split(" ")[0];
  const brand      = card.brandColor  || "#0ea5e9";
  const brandDim   = card.accentColor || "#0284c7";

  const submit = async () => {
    setErr("");
    if (!name.trim())                   { setErr("What's your name?"); return; }
    if (!phone.trim() && !email.trim()) { setErr("Phone or email — at least one."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/standalone/card/${slug}/lead`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() || null, email: email.trim() || null }),
      });
      if (!res.ok) throw new Error("Failed");
      setDone(true);
      setTimeout(() => onClose(true), 2000);
    } catch {
      setErr("Something went wrong — try again.");
      setBusy(false);
    }
  };

  const inputCls = "w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/25 text-sm outline-none focus:border-white/25 transition-colors";

  return (
    <motion.div
      initial={{ y: 120 }}
      animate={{ y: 0 }}
      exit={{ y: 120 }}
      transition={{ type: "spring", damping: 28, stiffness: 260, delay: 0.1 }}
      className="fixed bottom-0 left-0 right-0 z-40 flex justify-center px-3 pb-3 pointer-events-none"
    >
      <div className="w-full max-w-sm pointer-events-auto" style={{ filter: "drop-shadow(0 -4px 24px rgba(0,0,0,0.6))" }}>
        <div className="rounded-2xl overflow-hidden border border-white/10" style={{ background: "rgba(10,10,16,0.96)", backdropFilter: "blur(16px)" }}>
          {done ? (
            <div className="flex items-center gap-3 px-5 py-4">
              <span className="text-2xl">✅</span>
              <div>
                <p className="text-white font-bold text-sm">Sent!</p>
                <p className="text-slate-400 text-xs">{ownerFirst} will reach out to you soon.</p>
              </div>
            </div>
          ) : expanded ? (
            <div className="px-4 pt-4 pb-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-white font-bold text-sm">👋 Leave your info for {ownerFirst}</p>
                <button onClick={() => onClose(false)} className="text-slate-500 hover:text-white text-lg leading-none transition-colors px-1">✕</button>
              </div>
              <input type="text"  placeholder="Your name *"   value={name}  onChange={e => setName(e.target.value)}  className={inputCls} autoFocus />
              <input type="tel"   placeholder="Phone number"  value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} />
              <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} />
              {err && <p className="text-red-400 text-xs">{err}</p>}
              <button onClick={submit} disabled={busy} className="w-full py-3 rounded-xl font-bold text-sm text-white disabled:opacity-50 transition-opacity active:scale-[0.98]" style={{ background: brand }}>
                {busy ? "Sending…" : `Send my info to ${ownerFirst}`}
              </button>
              <button onClick={() => setExpanded(false)} className="w-full py-1 text-slate-600 text-xs hover:text-slate-400 transition-colors">Collapse</button>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: brand }} />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: brand }} />
              </span>
              <button onClick={() => setExpanded(true)} className="flex-1 text-left">
                <p className="text-white text-sm font-semibold leading-tight">Want {ownerFirst} to follow up?</p>
                <p className="text-slate-500 text-xs">Tap to drop your info — takes 10 seconds</p>
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setExpanded(true)} className="px-3 py-1.5 rounded-lg text-white text-xs font-bold transition-opacity active:opacity-70" style={{ background: brandDim }}>Yes →</button>
                <button onClick={() => onClose(false)} className="text-slate-600 hover:text-slate-400 text-base transition-colors px-1" aria-label="Dismiss">✕</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function shouldShowCapture(slug: string): boolean {
  try { return !sessionStorage.getItem(`qc_dismissed_${slug}`); } catch { return true; }
}
function markCaptureDismissed(slug: string): void {
  try { sessionStorage.setItem(`qc_dismissed_${slug}`, "1"); } catch { /* allow-silent-catch: sessionStorage unavailable */ }
}

export default function StandaloneCardView() {
  const [, params1] = useRoute("/standalone/c/:slug");
  const [, params2] = useRoute("/standalone/card/:slug");
  const params = params1 || params2;
  const [, setLocation] = useLocation();
  const [rawCard, setRawCard] = useState<any>(null);
  const [card, setCard] = useState<SharedCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showShare, setShowShare] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showCapture, setShowCapture] = useState(false);

  useEffect(() => {
    if (!params?.slug) return;
    fetch(`/api/standalone/card/${params.slug}`)
      .then(r => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then(data => {
        setRawCard(data);
        const adapted = adaptStandaloneCard(data);
        const resolvedTheme = resolveThemeForTier(data.cardTheme, data.tier);
        adapted.theme = resolvedTheme;
        setCard(adapted);
        if (params.slug && shouldShowCapture(params.slug)) {
          setTimeout(() => setShowCapture(true), 600);
        }
      })
      .catch(() => { setRawCard(null); setCard(null); })
      .finally(() => setLoading(false));
  }, [params?.slug]);

  if (loading) return <CardLoading />;
  if (!card || !rawCard) {
    return <CardNotFound ctaUrl="/standalone/card" ctaLabel="Get Your Own Card" />;
  }

  const theme = getCardTheme(card.theme);
  const cardUrl = `${window.location.origin}/standalone/card/${card.slug}`;
  const referralUrl = rawCard.referralCode ? `/standalone/card?ref=${rawCard.referralCode}` : "/standalone/card";
  const tier = rawCard.tier || "base";
  const showBranding = canRemoveBranding("standalone", tier) ? !rawCard.removeApexBranding : true;

  const config: CardRenderConfig = {
    source: "standalone",
    tier,
    showBranding,
    referralUrl,
    cardUrl,
  };

  return (
    <div className={`min-h-screen ${theme.bg} relative`} data-testid="standalone-card-page">
      <BackgroundGlow card={card} theme={theme} />

      <div className="relative z-10">
        <div className="max-w-md mx-auto">
          {rawCard.identityDna ? (
            <Suspense fallback={<HeroSection card={card} theme={theme} />}>
              <CinematicCardHero
                dna={rawCard.identityDna}
                photoUrl={card.photoUrl}
              />
            </Suspense>
          ) : (
            <HeroSection card={card} theme={theme} />
          )}

          <div className="px-5 pb-40 -mt-2">
            <AboutSection card={card} theme={theme} />
            <PrimaryActions card={card} theme={theme} />
            <SaveShareBar card={card} theme={theme} config={config}
              onShare={() => setShowShare(true)}
              onQR={() => setShowQR(!showQR)} />
            <QRPanel cardUrl={cardUrl} theme={theme} visible={showQR} brandColor={card.brandColor} />
            <ReviewBookingLinks card={card} theme={theme} />
            <SocialLinksSection card={card} theme={theme} />
            <LinksSection card={card} theme={theme} />
            <CardFooter config={config} theme={theme} />
          </div>
        </div>
      </div>

      <StickyActionBar card={card} theme={theme} config={config}
        onShare={() => setShowShare(true)} />

      <AnimatePresence>
        {showShare && <ShareModal card={card} theme={theme} config={config} onClose={() => setShowShare(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {showCapture && params?.slug && (
          <StickyLeadCapture
            card={card}
            slug={params.slug}
            onClose={(submitted) => {
              setShowCapture(false);
              if (params?.slug) markCaptureDismissed(params.slug);
              if (submitted) console.log("[STANDALONE-CARD] Lead captured via sticky bar");
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
