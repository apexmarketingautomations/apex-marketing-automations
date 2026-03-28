import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { AnimatePresence } from "framer-motion";
import {
  CardLoading, CardNotFound, CardError,
  HeroSection, PrimaryActions, SaveShareBar, QRPanel,
  AboutSection, ReviewBookingLinks, LinksSection,
  SocialLinksSection, StickyActionBar, ShareModal, CardFooter, BackgroundGlow,
  adaptStandaloneCard, getCardTheme, resolveThemeForTier,
} from "@/components/card-core";
import type { SharedCardData, CardRenderConfig } from "@/components/card-core";

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
  const showBranding = !rawCard.removeApexBranding;

  const config: CardRenderConfig = {
    source: "standalone",
    tier: rawCard.tier || "base",
    showBranding,
    referralUrl,
    cardUrl,
  };

  return (
    <div className={`min-h-screen ${theme.bg} relative`} data-testid="standalone-card-page">
      <BackgroundGlow card={card} theme={theme} />

      <div className="relative z-10">
        <div className="max-w-md mx-auto">
          <HeroSection card={card} theme={theme} />

          <div className="px-5 pb-28 -mt-2">
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
    </div>
  );
}
